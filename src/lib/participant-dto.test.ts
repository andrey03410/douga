import { describe, expect, it } from "vitest";
import { participantDto, type ParticipantRow } from "./participant-dto";

const row = (over: Partial<ParticipantRow>): ParticipantRow => ({
  id: "t1",
  title: "Нана Осаки",
  artist: null,
  kind: "image",
  album: null,
  comment: null,
  bestMomentSec: null,
  durationSec: null,
  coverArtId: null,
  coverPath: "tournaments/x/tracks/t1.png",
  subtitle: "Нана",
  sourceUrl: "https://shikimori.io/characters/702",
  note: null,
  excluded: false,
  ...over,
});

describe("participantDto", () => {
  it("a picture has a picture and nothing to listen to", () => {
    const dto = participantDto(row({}));
    expect(dto.audioUrl).toBeNull();
    expect(dto.imageUrl).toBe("/api/tracks/t1/cover?art=own");
    expect(dto.thumbUrl).toBe("/api/tracks/t1/cover?art=own&size=thumb");
  });

  it("a track streams its file; a pool cover versions the picture url", () => {
    const dto = participantDto(row({ kind: "audio", coverPath: null, coverArtId: "art 1" }));
    expect(dto.audioUrl).toBe("/api/tracks/t1/audio");
    expect(dto.imageUrl).toBe("/api/tracks/t1/cover?art=art%201");
  });

  it("a track without any cover has no picture", () => {
    const dto = participantDto(row({ kind: "video", coverPath: null }));
    expect(dto.imageUrl).toBeNull();
    expect(dto.thumbUrl).toBeNull();
  });
});
