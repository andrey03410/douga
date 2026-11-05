import type {
  VideoDocument,
  Participant,
  VideoSegment,
  VideoScene,
  VideoNode,
} from "@/video";
import { getBuiltinPresets, videoPresetSchema } from "@/video";
import { prisma } from "@/lib/db";
import { probeMediaInfo } from "@/lib/audio";
import { ensureTournamentSegments } from "@/server/tournament-segments";
import { safeFile } from "./assets";
import { hash, canonical, type Db } from "./shared";
import { StudioError } from "./errors";

async function loadSource(db: Db, userId: string, id: string) {
  const include = {
    segments: { orderBy: [{ order: "asc" as const }, { id: "asc" as const }] },
    rankings: {
      orderBy: [{ rank: "asc" as const }, { trackId: "asc" as const }],
    },
    tracks: true,
  };
  const tournament = await db.tournament.findFirst({
    where: { id, userId },
    include,
  });
  if (!tournament) throw new StudioError("SOURCE_NOT_FOUND");
  if (tournament.segments.length) {
    // Old integrations may append a track without segmentId after the first migration.
    if (
      tournament.segments.length === 1 &&
      tournament.tracks.some((track) => track.segmentId === null)
    ) {
      const segmentId = tournament.segments[0].id;
      await db.track.updateMany({
        where: { tournamentId: id, segmentId: null },
        data: { segmentId },
      });
      await db.ranking.updateMany({
        where: { tournamentId: id, segmentId: null },
        data: { segmentId },
      });
      return db.tournament.findFirstOrThrow({ where: { id, userId }, include });
    }
    return tournament;
  }
  // Use the tournament migration too: it preserves old rankings and assignments.
  await ensureTournamentSegments(db, id);
  return db.tournament.findFirstOrThrow({ where: { id, userId }, include });
}

/** New ready segments inherit the common preset, never another segment's local edits. */
async function sourceTemplate(userId: string, document: VideoDocument, db: Db) {
  const builtin = getBuiltinPresets().find((p) => p.id === document.preset?.id);
  const saved =
    !builtin && document.preset
      ? await db.studioPreset.findFirst({
          where: { id: document.preset.id, userId },
        })
      : null;
  const preset =
    builtin ??
    (saved ? videoPresetSchema.parse(JSON.parse(saved.presetJson)) : undefined);
  return {
    scenes: preset?.scenes ?? document.scenes,
    audio: preset?.audio?.cues ? { cues: preset.audio.cues } : undefined,
  };
}

function newSegment(
  id: string,
  title: string,
  template: { scenes: VideoScene[]; audio?: VideoDocument["audio"] },
): VideoSegment {
  const prefix = `segment:${id}:`;
  const scenes = structuredClone(template.scenes);
  const rename = (nodes: VideoNode[]) =>
    nodes.forEach((node) => {
      node.id = prefix + node.id;
      if (node.type === "container") rename(node.children);
    });
  scenes.forEach((scene) => {
    scene.id = prefix + scene.id;
    rename(scene.nodes);
  });
  const audio = structuredClone(template.audio);
  audio?.cues?.forEach((cue) => {
    cue.id = prefix + cue.id;
    if (cue.anchor?.sceneId) cue.anchor.sceneId = prefix + cue.anchor.sceneId;
  });
  return {
    id: `segment:${id}`,
    kind: "top",
    title,
    sourceSegmentId: id,
    scenes,
    ...(audio ? { audio } : {}),
  };
}

/** Fingerprint actual ranks, readiness, order and media metadata; updatedAt is insufficient. */
export async function reconcileSource(
  userId: string,
  input: VideoDocument,
  db: Db = prisma,
): Promise<VideoDocument> {
  const document = structuredClone(input);
  if (document.source.kind !== "tournament") return document;
  const tournamentId = document.source.tournamentId!;
  const tournament =
    db === prisma
      ? await prisma.$transaction((tx) => loadSource(tx, userId, tournamentId))
      : await loadSource(db, userId, tournamentId);
  const byTrack = new Map(tournament.tracks.map((track) => [track.id, track]));
  const old = new Map(document.source.participants.map((p) => [p.id, p]));
  const v2 = document.schemaVersion === 2;
  let selected = tournament.segments;
  if (!v2) {
    // Once pinned, deleting/reordering a segment must never switch a v1 project's source.
    const pinned = document.source.segmentId;
    const overlap = (id: string) =>
      tournament.tracks.filter((t) => t.segmentId === id && old.has(t.id))
        .length;
    const best = pinned
      ? tournament.segments.find((segment) => segment.id === pinned)
      : [...tournament.segments].sort(
          (a, b) => overlap(b.id) - overlap(a.id),
        )[0];
    selected = best ? [best] : [];
    if (best) document.source.segmentId = best.id;
  }
  const fingerprint = hash(
    canonical({
      segmentId: !v2 ? document.source.segmentId : undefined,
      // Keep the legacy single-segment topSize projection authoritative for v1 callers.
      topSize:
        !v2 && tournament.segments.length === 1
          ? tournament.topSize
          : undefined,
      segments: selected,
      rankings: tournament.rankings.map((r) => ({
        segmentId: r.segmentId,
        trackId: r.trackId,
        rank: r.rank,
        score: r.score,
      })),
      tracks: [...tournament.tracks].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
  const participants: Participant[] = [];
  const sourceSegments: NonNullable<VideoDocument["source"]["segments"]> = [];
  for (const segment of selected) {
    if (v2 && segment.status !== "completed") continue;
    const size =
      !v2 && tournament.segments.length === 1
        ? tournament.topSize
        : segment.topSize;
    const ranks = tournament.rankings
      .filter((rank) => byTrack.get(rank.trackId)?.segmentId === segment.id)
      .slice(0, size ?? undefined);
    if (!ranks.length) continue;
    const participantIds: string[] = [];
    for (const rank of ranks) {
      const track = byTrack.get(rank.trackId);
      if (!track) throw new StudioError("SOURCE_TRACK_NOT_FOUND");
      const retained = old.get(track.id);
      const participant: Participant = {
        ...retained,
        id: track.id,
        label: track.artist ? `${track.artist} — ${track.title}` : track.title,
        rank: rank.rank,
        score: rank.score,
      };
      // These fields belong to the source. Removing a DB value also removes stale authored data.
      for (const key of ["comment", "album", "bestMomentSec"] as const) {
        delete participant[key];
        if (track[key] !== null)
          Object.assign(participant, { [key]: track[key] });
      }
      const key = `source:${track.id}`;
      const coverKey = `${key}:cover`;
      if (!retained) {
        document.bindings[key] = {
          kind: "track",
          tournamentId: tournament.id,
          trackId: track.id,
        };
        let hasAudio = true;
        if (track.kind === "video") {
          try {
            hasAudio = (await probeMediaInfo(await safeFile(track.filePath)))
              .hasAudio;
          } catch {
            /* Manifest resolution diagnoses unavailable media. */
          }
        }
        participant.media = {
          ...(hasAudio ? { audio: key } : {}),
          ...(track.kind === "video" ? { visual: key } : {}),
        };
      }
      // Keep authored media. Only the adapter-owned cover follows later cover changes.
      const managedVisual = participant.media?.visual === coverKey;
      if (
        (!retained || v2 || managedVisual) &&
        (!participant.media?.visual || managedVisual)
      ) {
        if (track.coverPath || track.coverArtId) {
          document.bindings[coverKey] = {
            kind: "track",
            tournamentId: tournament.id,
            trackId: track.id,
            media: "cover",
          };
          participant.media = { ...participant.media, visual: coverKey };
        } else if (managedVisual) {
          delete participant.media!.visual;
          delete document.bindings[coverKey];
        }
      }
      participants.push(participant);
      participantIds.push(track.id);
    }
    const poster = segment.posterArtId
      ? `source:segment:${segment.id}:poster`
      : undefined;
    if (poster)
      document.bindings[poster] = {
        kind: "pool",
        assetId: segment.posterArtId!,
      };
    sourceSegments.push({
      id: segment.id,
      title: segment.title,
      ...(segment.subtitle !== null ? { subtitle: segment.subtitle } : {}),
      ...(poster ? { poster } : {}),
      participantIds,
    });
  }
  if (v2) {
    const template = await sourceTemplate(userId, document, db);
    const oldSegments = document.segments ?? [];
    const previousDormant = new Map(
      document.source.dormantSegments?.map((segment) => [segment.id, segment]),
    );
    const previousSourceIds = new Set([
      ...(document.source.segments?.map((segment) => segment.id) ?? []),
      ...[...previousDormant.values()].map(
        (segment) => segment.sourceSegmentId,
      ),
    ]);
    const authoredSourceIds = new Set(
      oldSegments.flatMap((segment) =>
        segment.sourceSegmentId ? [segment.sourceSegmentId] : [],
      ),
    );
    const suppressed = new Set(document.source.suppressedSegmentIds);
    for (const id of previousSourceIds)
      if (!authoredSourceIds.has(id)) suppressed.add(id);
    // Explicitly adding a source-backed segment is the author's opt-in to restore it.
    for (const id of authoredSourceIds) suppressed.delete(id);
    if (suppressed.size)
      document.source.suppressedSegmentIds = [...suppressed].sort();
    else delete document.source.suppressedSegmentIds;
    const ready = new Map(
      sourceSegments.map((segment) => [segment.id, segment]),
    );
    const resolved: VideoSegment[] = [];
    const dormant: NonNullable<VideoDocument["source"]["dormantSegments"]> = [];
    for (const segment of oldSegments) {
      if (!segment.sourceSegmentId) continue;
      const source = ready.get(segment.sourceSegmentId);
      const saved = previousDormant.get(segment.id);
      const authored =
        saved?.sourceSegmentId === segment.sourceSegmentId ? saved : undefined;
      const current = { ...segment };
      if (!source) {
        // enabled is projected false during the pause; the tuple owns the author's state.
        dormant.push(
          authored ?? {
            id: segment.id,
            sourceSegmentId: segment.sourceSegmentId,
            ...(segment.enabled !== undefined
              ? { enabled: segment.enabled }
              : {}),
          },
        );
        current.enabled = false;
      } else if (authored) {
        if (authored.enabled === undefined) delete current.enabled;
        else current.enabled = authored.enabled;
      }
      if (source) {
        current.title = source.title;
        current.participantIds = source.participantIds;
        delete current.subtitle;
        delete current.poster;
        if (source.subtitle !== undefined) current.subtitle = source.subtitle;
        if (source.poster !== undefined) current.poster = source.poster;
      }
      resolved.push(current);
    }
    if (dormant.length) document.source.dormantSegments = dormant;
    else delete document.source.dormantSegments;
    const added: VideoSegment[] = [];
    for (const source of sourceSegments)
      if (
        !suppressed.has(source.id) &&
        !resolved.some((segment) => segment.sourceSegmentId === source.id)
      ) {
        const segment = newSegment(source.id, source.title, template);
        Object.assign(
          segment,
          { participantIds: source.participantIds },
          source.subtitle !== undefined ? { subtitle: source.subtitle } : {},
          source.poster !== undefined ? { poster: source.poster } : {},
        );
        added.push(segment);
      }
    // Preserve the authored montage order. New source IDs arrive before an existing outro.
    const segments: VideoSegment[] = [];
    let index = 0;
    let lastSourceSlot = -1;
    for (const segment of oldSegments) {
      if (segment.sourceSegmentId) {
        segments.push(resolved[index++]);
        lastSourceSlot = segments.length;
      } else segments.push(segment);
    }
    segments.splice(
      lastSourceSlot < 0 ? segments.length : lastSourceSlot,
      0,
      ...added,
    );
    document.segments = segments;
    // Dormant participants retain per-ID customizations while their segment is disabled.
    const activeIds = new Set(participants.map((p) => p.id));
    const dormantIds = new Set(
      segments
        .filter((s) => s.sourceSegmentId && s.enabled === false)
        .flatMap((s) => s.participantIds ?? []),
    );
    for (const participant of old.values())
      if (dormantIds.has(participant.id) && !activeIds.has(participant.id))
        participants.push(participant);
  }
  document.source.participants = participants;
  document.source.segments = sourceSegments;
  document.source.version = fingerprint;
  return document;
}
