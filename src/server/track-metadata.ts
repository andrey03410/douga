import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertOwnedImage } from "./tournament-segments";

export const trackMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    artist: z.string().trim().max(500).nullable().optional(),
    comment: z.string().max(5000).nullable().optional(),
    bestMomentSec: z.number().finite().nonnegative().nullable().optional(),
    coverArtId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export type TrackMetadataInput = z.infer<typeof trackMetadataSchema>;

export async function updateTrackMetadata(
  userId: string,
  id: string,
  input: TrackMetadataInput,
) {
  const parsed = trackMetadataSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_TRACK_METADATA");
  return prisma.$transaction(async (db) => {
    const track = await db.track.findFirst({
      where: { id, tournament: { userId } },
    });
    if (!track) throw new Error("NOT_FOUND");
    const data = parsed.data;
    if (
      data.bestMomentSec != null &&
      track.durationSec != null &&
      data.bestMomentSec > track.durationSec
    )
      throw new Error("INVALID_BEST_MOMENT");
    await assertOwnedImage(db, userId, data.coverArtId);
    await db.tournament.update({
      where: { id: track.tournamentId },
      data: { updatedAt: new Date() },
    });
    return db.track.update({ where: { id }, data });
  });
}
