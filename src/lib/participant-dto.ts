/** Task 33: one participant as the site and HTTP clients see it. */
export interface ParticipantRow {
  id: string;
  title: string;
  artist: string | null;
  kind: string;
  album: string | null;
  comment: string | null;
  bestMomentSec: number | null;
  durationSec: number | null;
  coverArtId: string | null;
  coverPath: string | null;
  subtitle: string | null;
  sourceUrl: string | null;
  note: string | null;
  excluded: boolean;
}

export function participantDto(tr: ParticipantRow) {
  const hasPicture = Boolean(tr.coverArtId || tr.coverPath);
  const version = encodeURIComponent(tr.coverArtId ?? "own");
  return {
    id: tr.id,
    title: tr.title,
    artist: tr.artist,
    kind: tr.kind as "audio" | "video" | "image",
    album: tr.album,
    comment: tr.comment,
    bestMomentSec: tr.bestMomentSec,
    durationSec: tr.durationSec,
    coverArtId: tr.coverArtId,
    subtitle: tr.subtitle,
    sourceUrl: tr.sourceUrl,
    note: tr.note,
    excluded: tr.excluded,
    // a picture has nothing to listen to (the file route still serves it to the SDK)
    audioUrl: tr.kind === "image" ? null : `/api/tracks/${tr.id}/audio`,
    imageUrl: hasPicture ? `/api/tracks/${tr.id}/cover?art=${version}` : null,
    thumbUrl: hasPicture ? `/api/tracks/${tr.id}/cover?art=${version}&size=thumb` : null,
  };
}
export type ParticipantDto = ReturnType<typeof participantDto>;
