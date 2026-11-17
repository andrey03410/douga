import "server-only";
import type { VideoContentInput } from "@douga/video/content";
import { prisma } from "@/lib/db";
import { StudioError } from "./errors";

/** Called inside the content writer after receipt/CAS checks, before draft changes.
 * Check declared assignments even when the current scene does not consume them.
 * Normal evaluation still probes the actual bytes and validates decoded media. */
export async function validateStudioContentAssets(
  userId: string,
  content: VideoContentInput,
): Promise<void> {
  const assignments: {
    id: string;
    channel: "audio" | "visual";
    path: string;
  }[] = [];
  for (const participant of content.participants ?? []) {
    if (participant.visualAssetId)
      assignments.push({
        id: participant.visualAssetId,
        channel: "visual",
        path: `participants.${participant.id}.visualAssetId`,
      });
    if (participant.audioAssetId)
      assignments.push({
        id: participant.audioAssetId,
        channel: "audio",
        path: `participants.${participant.id}.audioAssetId`,
      });
  }
  if (content.kind === "picker")
    for (const round of content.rounds ?? []) {
      if (round.musicAssetId)
        assignments.push({
          id: round.musicAssetId,
          channel: "audio",
          path: `rounds.${round.id}.musicAssetId`,
        });
      if (round.backgroundAssetId)
        assignments.push({
          id: round.backgroundAssetId,
          channel: "visual",
          path: `rounds.${round.id}.backgroundAssetId`,
        });
    }
  const ids = [...new Set(assignments.map((item) => item.id))];
  const media = new Map<string, { kind: string; hasAudio: boolean }>();
  // Keep the SQLite bind-variable count independent of document size.
  for (let offset = 0; offset < ids.length; offset += 500) {
    const rows = await prisma.art.findMany({
      where: { userId, id: { in: ids.slice(offset, offset + 500) } },
      select: { id: true, kind: true, hasAudio: true },
    });
    for (const row of rows) media.set(row.id, row);
  }
  for (const assignment of assignments) {
    const row = media.get(assignment.id);
    if (!row) throw new StudioError("ASSET_NOT_FOUND");
    const valid =
      assignment.channel === "visual"
        ? row.kind === "image" || row.kind === "video"
        : row.kind === "audio" || (row.kind === "video" && row.hasAudio);
    if (!valid)
      throw new StudioError("VALIDATION_FAILED", [
        {
          severity: "error",
          code: "ASSET_KIND_MISMATCH",
          path: assignment.path,
          message: `Назначенный материал не подходит для ${assignment.channel === "audio" ? "звука" : "изображения или видео"}.`,
        },
      ]);
  }
}
