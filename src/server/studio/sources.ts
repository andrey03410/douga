import type { VideoDocument, Participant } from "@/video";
import { prisma } from "@/lib/db";
import { hash, canonical, type Db } from "./shared";
import { StudioError } from "./errors";
/** Fingerprint real ranks, topSize and track metadata: ranking reorder does not touch updatedAt. */
export async function reconcileSource(
  userId: string,
  input: VideoDocument,
  db: Db = prisma,
): Promise<VideoDocument> {
  const document = structuredClone(input);
  if (document.source.kind !== "tournament") return document;
  const tournament = await db.tournament.findFirst({
    where: { id: document.source.tournamentId, userId },
    include: {
      rankings: { orderBy: [{ rank: "asc" }, { trackId: "asc" }] },
      tracks: true,
    },
  });
  if (!tournament) throw new StudioError("SOURCE_NOT_FOUND");
  const fingerprint = hash(
    canonical({
      topSize: tournament.topSize,
      rankings: tournament.rankings.map((r) => ({
        trackId: r.trackId,
        rank: r.rank,
        score: r.score,
      })),
      tracks: tournament.tracks
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          filePath: t.filePath,
          durationSec: t.durationSec,
          kind: t.kind,
          sizeBytes: t.sizeBytes,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
  // The caller-supplied version is never authority for rank/label fields.
  const old = new Map(document.source.participants.map((p) => [p.id, p]));
  const ranks = tournament.rankings.slice(0, tournament.topSize ?? undefined);
  document.source.participants = ranks.map((rank) => {
    const track = tournament.tracks.find((t) => t.id === rank.trackId);
    if (!track) throw new StudioError("SOURCE_TRACK_NOT_FOUND");
    const retained = old.get(track.id);
    const participant: Participant = {
      ...retained,
      id: track.id,
      label: track.artist ? `${track.artist} — ${track.title}` : track.title,
      rank: rank.rank,
    };
    if (!retained) {
      const key = `source:${track.id}`;
      document.bindings[key] = {
        kind: "track",
        tournamentId: tournament.id,
        trackId: track.id,
      };
      participant.media = {
        audio: key,
        ...(track.kind === "video" ? { visual: key } : {}),
      };
    }
    return participant;
  });
  document.source.version = fingerprint;
  return document;
}
