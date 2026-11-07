import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { quotasFor } from "@/lib/domain/permissions";
import type { ExtractedTrack } from "@/lib/upload";
import { SCHEMES, type Scheme } from "@/lib/domain/types";
import { MAX_GROUP_SIZE } from "@/lib/domain/group-answer";
import { engineGroupSize, plannedScreens } from "@/lib/domain/engines";
import { defaultSchemeSettings, type SchemeSettings } from "@/lib/domain/scheme-settings";
import { actor as authorizeActor } from "@/server/studio/shared";
import {
  createTournament,
  getTournament,
  listTournaments,
  updateTournamentSegments,
} from "@/server/tournaments";
import { assertOwnedImage, segmentsUpdateSchema } from "@/server/tournament-segments";
import {
  addParticipants,
  deleteParticipants,
  itemSourceSchema,
  resolveItemSources,
  setExcluded,
  type ItemSource,
} from "@/server/tournament-items";
import type { SkippedItem } from "@/server/shikimori";
import { updateTrackMetadata } from "@/server/track-metadata";
import type { Actor } from "./actor";

/** An error the agent can act on: the code plus what it needs to fix the call. */
class ToolError extends Error {
  constructor(
    code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}

/**
 * Task 33 (P25): the base-building recipe the agent follows. Lives in the
 * tool description so the agent sees it exactly when it builds a base.
 */
const CREATE_DESCRIPTION = [
  "Подготовить турнир: состав из сегментов. Сравнивает и расставляет места только человек на сайте.",
  "Участник в items (tracks — синоним): {shikimori:{type:\"character\"|\"anime\",id}} — картинка, имя и ссылка с Shikimori, до 300 за вызов; {assetId} картинки/аудио/видео своего пула; {path} в MCP_LOCAL_MEDIA_DIRS. У любого title?/subtitle?/note? (note — основание включения).",
  "Сбой отдельного Shikimori-участника уходит в skipped[], остальные создаются. Повтор в сегменте отклоняется (DUPLICATE_ITEM). Пути, чужой пул и квота отклоняют весь вызов.",
  "scheme не передавайте: алгоритм выбирает человек (schemeRequired:true). Только по его прямой просьбе: scheme и schemeSettings. estimates — экраны по алгоритмам для отчёта.",
  "База по профилю Shikimori: shikimori_find_user → shikimori_user_anime_list (смотрел = completed, watching, rewatching; on_hold/dropped только по просьбе; planned никогда) → без kind music/pv/cm → фильтр тайтлов (студия: shikimori_find_studio → id, затем shikimori_anime.studios каждого тайтла; shikimori_studio_animes отдаёт не больше 50 и для крупной студии неполон) → shikimori_anime_characters role Main → склейте персонажей по id; subtitle — самый ранний просмотренный тайтл с ним.",
  "Признаки, которых нет в Shikimori (пол, «злодей»), определите сами, основание — в note; сомнительных назовите в отчёте. Сегмент один; по тайтлам — если человек попросил.",
  "Отчёт человеку: сколько участников и из скольких тайтлов, кто пропущен и почему, сомнительные, ссылка url.",
].join(" ");

const segmentInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().max(2000).optional(),
    posterArtId: z.string().optional(),
    items: z.array(itemSourceSchema).min(1).optional(),
    tracks: z.array(itemSourceSchema).min(1).optional(),
  })
  .strict()
  .refine((s) => Boolean(s.items) !== Boolean(s.tracks), "Укажите items (или tracks), но не оба");

/** Screens each algorithm would take for these segments, with default settings. */
function screenEstimates(sizes: number[], groupSize: number) {
  const out: Partial<Record<Scheme, number>> = {};
  for (const scheme of SCHEMES)
    out[scheme] = sizes.reduce(
      (sum, n) =>
        n < 2
          ? sum
          : sum + plannedScreens(scheme, n, engineGroupSize(scheme, groupSize, n), defaultSchemeSettings(scheme)),
      0,
    );
  return out;
}

/** Report a skip by where the agent put the item. */
function locate(skipped: SkippedItem[], where: { segmentIndex: number; itemIndex: number }[]) {
  return skipped.map(({ index, ...rest }) => ({ ...where[index], ...rest }));
}

export function registerTournamentTools(server: McpServer, actor: Actor) {
  const guard = (fn: (role: string) => Promise<unknown>) =>
    authorizeActor(actor.userId)
      .then((user) => fn(user.role))
      .then((data) => ({
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
      }))
      .catch((e) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: (e as Error).message,
              ...(e instanceof ToolError ? e.details : {}),
            }),
          },
        ],
        isError: true,
      }));
  server.registerTool(
    "tournament_list",
    {
      description:
        "Турниры владельца. Агент готовит состав; ответы и места определяет человек.",
      inputSchema: {},
    },
    () =>
      guard(async () => ({ tournaments: await listTournaments(actor.userId) })),
  );
  server.registerTool(
    "tournament_get",
    {
      description:
        "Турнир, все сегменты с участниками (kind, subtitle, note, excluded) и прогрессом, активный срез. Читать можно; отвечать и назначать места нельзя.",
      inputSchema: { id: z.string(), segmentId: z.string().optional() },
    },
    ({ id, segmentId }) =>
      guard(async () => {
        const t = await getTournament(actor.userId, id, segmentId);
        if (!t) throw new Error("NOT_FOUND");
        return t;
      }),
  );
  server.registerTool(
    "tournament_create",
    {
      description: CREATE_DESCRIPTION,
      inputSchema: {
        title: z.string().trim().min(1).max(300),
        scheme: z.enum(SCHEMES).optional(),
        schemeSettings: z.record(z.unknown()).optional(),
        blindMode: z.boolean().default(false),
        groupSize: z.number().int().min(2).max(MAX_GROUP_SIZE).optional(),
        segments: z.array(segmentInput).min(1).max(500),
      },
    },
    (input) =>
      guard(async (role) => {
        const sources: ItemSource[] = [];
        const where: { segmentIndex: number; itemIndex: number }[] = [];
        input.segments.forEach((s, segmentIndex) =>
          (s.items ?? s.tracks ?? []).forEach((item, itemIndex) => {
            sources.push(item);
            where.push({ segmentIndex, itemIndex });
          }),
        );
        const resolved = await resolveItemSources(actor.userId, sources, quotasFor(role).maxArchiveBytes);
        const skipped = locate(resolved.skipped, where);
        const tracks: ExtractedTrack[] = [];
        const layout: { title: string; subtitle?: string; posterArtId?: string; trackIndexes: number[] }[] = [];
        let cursor = 0;
        const emptySegments: string[] = [];
        for (const s of input.segments) {
          const trackIndexes: number[] = [];
          for (const _ of s.items ?? s.tracks ?? []) {
            const t = resolved.tracks[cursor++];
            if (!t) continue;
            trackIndexes.push(tracks.length);
            tracks.push(t);
          }
          if (trackIndexes.length)
            layout.push({ title: s.title, subtitle: s.subtitle, posterArtId: s.posterArtId, trackIndexes });
          else emptySegments.push(s.title);
        }
        if (!tracks.length) throw new ToolError("ALL_ITEMS_SKIPPED", { skipped });
        const t = await createTournament(
          actor.userId,
          {
            title: input.title,
            scheme: input.scheme,
            schemeSettings: input.schemeSettings as SchemeSettings | undefined,
            blindMode: input.blindMode,
            groupSize: input.groupSize,
            segments: layout,
          },
          tracks,
        );
        const groupSize = t.groupSize;
        return {
          id: t.id,
          url: `/tournaments/${t.id}`,
          itemCount: tracks.length,
          trackCount: tracks.length,
          segments: layout.map((s) => ({ title: s.title, itemCount: s.trackIndexes.length })),
          emptySegments,
          skipped,
          schemeRequired: !input.scheme,
          estimates: screenEstimates(layout.map((s) => s.trackIndexes.length), groupSize),
        };
      }),
  );
  server.registerTool(
    "tournament_items_add",
    {
      description:
        "Добавить участников (формы items как в tournament_create) в сегмент segmentId, в новый сегмент segmentTitle или в первый. Готовый сегмент снова откроется: новички встанут в прежний порядок через сравнения человека, сохранённый топ снимется до их вставки — сначала requiresConfirmation, повтор с confirmReset:true только при явном согласии. Сбои Shikimori → skipped[].",
      inputSchema: {
        id: z.string(),
        segmentId: z.string().optional(),
        segmentTitle: z.string().trim().min(1).max(300).optional(),
        items: z.array(itemSourceSchema).min(1),
        confirmReset: z.boolean().default(false),
      },
    },
    ({ id, segmentId, segmentTitle, items, confirmReset }) =>
      guard(async (role) => {
        if (segmentId && segmentTitle) throw new Error("SEGMENT_ID_OR_TITLE");
        // P24: reopening a finished segment changes the person's result.
        const t = await getTournament(actor.userId, id);
        if (!t) throw new Error("NOT_FOUND");
        const target = segmentId ? t.segments.find((s) => s.id === segmentId) : segmentTitle ? undefined : t.segments[0];
        if (segmentId && !target) throw new Error("NOT_FOUND");
        const ask = {
          requiresConfirmation: true,
          segmentsToReopen: target ? [{ segmentId: target.id, title: target.title }] : [],
        };
        if (target?.status === "completed" && target.activeCount > 1 && !confirmReset) return ask;
        const resolved = await resolveItemSources(actor.userId, items, quotasFor(role).maxArchiveBytes);
        const skipped = locate(
          resolved.skipped,
          items.map((_, itemIndex) => ({ segmentIndex: 0, itemIndex })),
        ).map(({ segmentIndex: _s, ...rest }) => rest);
        const tracks = resolved.tracks.filter((t): t is ExtractedTrack => Boolean(t));
        if (!tracks.length) throw new ToolError("ALL_ITEMS_SKIPPED", { skipped });
        try {
          // re-checked inside the write: the person may have saved the top while pictures downloaded
          const result = await addParticipants(actor.userId, id, { segmentId, segmentTitle }, tracks, {
            reopenFinished: confirmReset,
          });
          return { ...result, skipped };
        } catch (e) {
          if ((e as Error).message === "REOPEN_NEEDS_CONFIRMATION") return ask;
          throw e;
        }
      }),
  );
  server.registerTool(
    "tournament_items_update",
    {
      description:
        "Подписи участников: title, subtitle, note (основание), coverArtId (картинка пула), excluded (исключить из сравнения без удаления; ответы сохраняются, возврат вставит обратно). Исключение или возврат в готовом сегменте меняет топ человека: сначала requiresConfirmation, повтор с confirmReset:true только при явном согласии.",
      inputSchema: {
        id: z.string(),
        confirmReset: z.boolean().default(false),
        items: z
          .array(
            z
              .object({
                trackId: z.string(),
                title: z.string().trim().min(1).max(500).optional(),
                subtitle: z.string().trim().max(500).nullable().optional(),
                note: z.string().trim().max(2000).nullable().optional(),
                coverArtId: z.string().min(1).nullable().optional(),
                excluded: z.boolean().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(2000),
      },
    },
    ({ id, items, confirmReset }) =>
      guard(async () => {
        const ids = items.map((i) => i.trackId);
        // P24: excluding from or returning into a finished top changes the person's result.
        const readFinished = async () => {
          const tracks = await prisma.track.findMany({
            where: { id: { in: ids }, tournamentId: id, tournament: { userId: actor.userId } },
            include: { segment: true },
          });
          if (tracks.length !== new Set(ids).size) throw new Error("NOT_FOUND");
          const byId = new Map(tracks.map((t) => [t.id, t]));
          const changing = items
            .filter((item) => item.excluded !== undefined && item.excluded !== byId.get(item.trackId)!.excluded)
            .map((item) => byId.get(item.trackId)!)
            .filter((t) => t.segment?.status === "completed");
          const active = new Map(
            (
              await prisma.track.groupBy({
                by: ["segmentId"],
                where: { segmentId: { in: [...new Set(changing.map((t) => t.segmentId!))] }, excluded: false },
                _count: { _all: true },
              })
            ).map((g) => [g.segmentId, g._count._all]),
          );
          const finished = new Map<string, string>();
          // a lone participant is "finished" automatically: nothing of the person's to lose
          for (const t of changing) if ((active.get(t.segmentId) ?? 0) > 1) finished.set(t.segment!.id, t.segment!.title);
          return [...finished].map(([segmentId, title]) => ({ segmentId, title }));
        };
        const segmentsToReopen = await readFinished();
        if (segmentsToReopen.length && !confirmReset) return { requiresConfirmation: true, segmentsToReopen };
        // Validate everything first so a bad cover does not leave half the batch applied.
        for (const item of items) await assertOwnedImage(prisma, actor.userId, item.coverArtId);
        for (const { trackId, excluded: _excluded, ...fields } of items)
          if (Object.keys(fields).length) await updateTrackMetadata(actor.userId, trackId, fields);
        try {
          // re-checked inside each write: the person may have saved the top meanwhile
          for (const { trackId, excluded } of items)
            if (excluded !== undefined)
              await setExcluded(actor.userId, trackId, excluded, { reopenFinished: confirmReset });
        } catch (e) {
          if ((e as Error).message !== "REOPEN_NEEDS_CONFIRMATION") throw e;
          // what is left to change, read again: the person saved a top meanwhile
          return { requiresConfirmation: true, segmentsToReopen: await readFinished(), partiallyApplied: true };
        }
        return { updated: items.length };
      }),
  );
  server.registerTool(
    "tournament_items_remove",
    {
      description:
        "Удалить участников насовсем. Экраны с ними снимаются: при requiresConfirmation:true покажите человеку answersToReset и повторите с confirmReset:true только при его явном согласии. Убрать из сравнения без потерь — tournament_items_update excluded:true.",
      inputSchema: {
        id: z.string(),
        trackIds: z.array(z.string()).min(1).max(2000),
        confirmReset: z.boolean().default(false),
      },
    },
    ({ id, trackIds, confirmReset }) =>
      guard(() => deleteParticipants(actor.userId, id, trackIds, confirmReset)),
  );
  server.registerTool(
    "tournament_segments_update",
    {
      description:
        "Полный состав сегментов: каждый трек ровно один раз. Не принимает rank/topSize/ответы. При requiresConfirmation:true покажите человеку answersToReset и segmentsToReopen (готовые топы, которые откроются); повторите с confirmReset:true только при явном согласии.",
      inputSchema: { id: z.string(), ...segmentsUpdateSchema.shape },
    },
    ({ id, ...input }) =>
      guard(async () => {
        const result = await updateTournamentSegments(actor.userId, id, input);
        const t = await getTournament(actor.userId, id);
        return {
          ...result,
          segments: t?.segments,
          activeSegmentId: t?.activeSegmentId,
        };
      }),
  );
}
