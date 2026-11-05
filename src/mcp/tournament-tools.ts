import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import { quotasFor } from "@/lib/domain/permissions";
import { extractTrackFromBuffer, type ExtractedTrack } from "@/lib/upload";
import { actor as authorizeActor } from "@/server/studio/shared";
import { readLocalTournamentTrack } from "@/server/local-media";
import {
  createTournament,
  getTournament,
  listTournaments,
  updateTournamentSegments,
} from "@/server/tournaments";
import { segmentsUpdateSchema } from "@/server/tournament-segments";
import type { Actor } from "./actor";

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
            text: JSON.stringify({ error: (e as Error).message }),
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
        "Турнир, все сегменты с треками/прогрессом и активный срез. Читать можно; отвечать и назначать места нельзя.",
      inputSchema: { id: z.string(), segmentId: z.string().optional() },
    },
    ({ id, segmentId }) =>
      guard(async () => {
        const t = await getTournament(actor.userId, id, segmentId);
        if (!t) throw new Error("NOT_FOUND");
        return t;
      }),
  );
  const track = z
    .object({ path: z.string().optional(), assetId: z.string().optional() })
    .strict()
    .refine(
      (t) => Boolean(t.path) !== Boolean(t.assetId),
      "Укажите path либо assetId",
    );
  server.registerTool(
    "tournament_create",
    {
      description:
        "Подготовить турнир из сегментов. tracks: {path} в MCP_LOCAL_MEDIA_DIRS либо {assetId} собственного аудио/видео пула. Оригиналы сохраняются. Ранги и ответы недоступны агенту.",
      inputSchema: {
        title: z.string().trim().min(1).max(300),
        scheme: z.enum(["merge", "swiss", "round_robin"]).default("swiss"),
        blindMode: z.boolean().default(false),
        groupSize: z.number().int().min(2).max(7).optional(),
        segments: z
          .array(
            z
              .object({
                title: z.string().trim().min(1).max(300),
                subtitle: z.string().max(2000).optional(),
                posterArtId: z.string().optional(),
                tracks: z.array(track).min(1),
              })
              .strict(),
          )
          .min(1)
          .max(500),
      },
    },
    (input) =>
      guard(async (role) => {
        const tracks: ExtractedTrack[] = [];
        const layout: {
          title: string;
          subtitle?: string;
          posterArtId?: string;
          trackIndexes: number[];
        }[] = [];
        let bytes = 0;
        const max = quotasFor(role).maxArchiveBytes;
        for (const s of input.segments) {
          const trackIndexes: number[] = [];
          for (const source of s.tracks) {
            let extracted: ExtractedTrack;
            if (source.path)
              extracted = await readLocalTournamentTrack(
                source.path,
                max - bytes,
              );
            else {
              const art = await prisma.art.findFirst({
                where: {
                  id: source.assetId,
                  userId: actor.userId,
                  kind: { in: ["audio", "video"] },
                },
              });
              if (!art) throw new Error("NOT_FOUND");
              const full = absPath(art.filePath);
              if ((await stat(full)).size > max - bytes)
                throw new Error("ARCHIVE_QUOTA");
              extracted = await extractTrackFromBuffer(
                path.basename(art.filePath),
                await readFile(full),
              );
              extracted.title = art.label ?? extracted.title;
              extracted.durationSec = art.durationSec ?? extracted.durationSec;
            }
            bytes +=
              extracted.data.length + (extracted.cover?.data.length ?? 0);
            if (bytes > max) throw new Error("ARCHIVE_QUOTA");
            trackIndexes.push(tracks.length);
            tracks.push(extracted);
          }
          layout.push({
            title: s.title,
            subtitle: s.subtitle,
            posterArtId: s.posterArtId,
            trackIndexes,
          });
        }
        const t = await createTournament(
          actor.userId,
          { ...input, segments: layout },
          tracks,
        );
        return {
          id: t.id,
          url: `/tournaments/${t.id}`,
          trackCount: tracks.length,
        };
      }),
  );
  server.registerTool(
    "tournament_segments_update",
    {
      description:
        "Полный состав сегментов: каждый трек ровно один раз. Не принимает rank/topSize/ответы. При requiresConfirmation:true покажите человеку answersToReset; повторите с confirmReset:true только при явном согласии на снятие ответов.",
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
