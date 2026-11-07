import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  isAudioFile,
  isVideoFile,
  mediaKind,
  deriveTitle,
  isImageFile,
  participantKind,
  extractTracksFromZip,
  extractTrackFromBuffer,
  inspectTrackArchive,
  MAX_IMAGE_BYTES,
} from "./upload";

describe("isAudioFile", () => {
  it("accepts supported audio extensions", () => {
    for (const f of ["a.mp3", "B.FLAC", "x/y.wav", "t.m4a", "z.ogg"]) {
      expect(isAudioFile(f)).toBe(true);
    }
  });
  it("rejects non-audio and junk entries", () => {
    expect(isAudioFile("cover.jpg")).toBe(false);
    expect(isAudioFile("notes.txt")).toBe(false);
    expect(isAudioFile("__MACOSX/._song.mp3")).toBe(false);
    expect(isAudioFile(".hidden.mp3")).toBe(false);
  });
});

describe("isVideoFile / mediaKind", () => {
  it("accepts supported video extensions in any case", () => {
    for (const f of ["op.mp4", "OP.MP4", "x/clip.webm", "y/z.MOV"]) {
      expect(isVideoFile(f)).toBe(true);
      expect(mediaKind(f)).toBe("video");
    }
  });
  it("rejects unsupported containers and junk entries", () => {
    for (const f of ["movie.mkv", "movie.avi", "movie.flv", "notes.txt"]) {
      expect(isVideoFile(f)).toBe(false);
      expect(mediaKind(f)).toBeNull();
    }
    expect(isVideoFile("__MACOSX/._op.mp4")).toBe(false);
    expect(isVideoFile(".hidden.mp4")).toBe(false);
  });
  it("classifies audio as audio, not video", () => {
    expect(mediaKind("song.mp3")).toBe("audio");
    expect(mediaKind("song.m4a")).toBe("audio");
  });
});

describe("deriveTitle", () => {
  it("prefers a non-empty ID3 title", () => {
    expect(deriveTitle("01 track.mp3", "Roaring Tides")).toBe("Roaring Tides");
  });
  it("falls back to filename without extension", () => {
    expect(deriveTitle("songs/01 - Intro.flac")).toBe("01 - Intro");
    expect(deriveTitle("01 - Intro.flac", "   ")).toBe("01 - Intro");
    expect(deriveTitle("Theme.mp3", null)).toBe("Theme");
  });
});

// Task 33: pictures as participants.
describe("picture participants", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = (entries: Record<string, Buffer>) => {
    const z = new AdmZip();
    for (const [name, data] of Object.entries(entries)) z.addFile(name, data);
    return z.toBuffer();
  };

  it("recognises picture files and skips junk", () => {
    for (const f of ["a.png", "B.JPG", "x/y.jpeg", "z.webp", "g.gif"]) {
      expect(isImageFile(f)).toBe(true);
      expect(participantKind(f)).toBe("image");
    }
    expect(isImageFile("__MACOSX/._a.png")).toBe(false);
    expect(participantKind("song.mp3")).toBe("audio");
    expect(participantKind("notes.txt")).toBeNull();
  });

  it("an archive of pictures alone yields picture participants named by file", async () => {
    const data = zip({ "Umineko/Beatrice.png": PNG, "Umineko/Ange.png": PNG, "readme.txt": Buffer.from("x") });
    const tracks = await extractTracksFromZip(data);
    expect(tracks.map((t) => [t.title, t.kind, t.sourceFolder])).toEqual([
      ["Ange", "image", "Umineko"],
      ["Beatrice", "image", "Umineko"],
    ]);
    // a single common folder is an archive wrapper, not a segment
    expect(inspectTrackArchive(data)).toEqual({
      folders: [],
      trackCount: 2,
      imageCount: 2,
      kind: "images",
    });
  });

  it("an archive with any audio keeps its pictures as covers, not participants", async () => {
    const data = zip({ "a.mp3": Buffer.from("fake"), "cover.jpg": PNG, "art/b.png": PNG });
    const tracks = await extractTracksFromZip(data);
    expect(tracks.map((t) => t.kind)).toEqual(["audio"]);
    expect(inspectTrackArchive(data)).toMatchObject({ trackCount: 1, imageCount: 2, kind: "media" });
  });

  it("refuses a picture above the size ceiling", async () => {
    await expect(
      extractTrackFromBuffer("huge.png", Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    ).rejects.toThrow("IMAGE_TOO_LARGE");
  });
});
