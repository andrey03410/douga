import { describe, expect, it } from "vitest";
import type { CompiledAudio, CompiledNode, CompiledVideo } from "@/video";
import {
  CONTROLS_HIDE_MS,
  HTML_MAX_ASSET_BASE64,
  HTML_MAX_BYTES,
  HTML_WARN_BYTES,
  applySlices,
  base64Length,
  chapters,
  controlsHidden,
  htmlByteSize,
  htmlContentDisposition,
  htmlExportLimit,
  keyAction,
  mediaSlices,
  nextChapterFrame,
  previousChapterFrame,
  rewritePlanMedia,
  seekBySeconds,
  sharedAudioTagCount,
  watchMediaPath,
} from "./model";

const hash = "a".repeat(64);
const hashB = "b".repeat(64);

function plan(patch: Partial<CompiledVideo> = {}): CompiledVideo {
  return {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    seed: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
    scenes: [],
    audio: [],
    ...patch,
  };
}

function cue(
  patch: Partial<CompiledAudio> & { hash?: string; offsetFrames?: number },
): CompiledAudio {
  const digest = patch.hash ?? hash;
  return {
    id: patch.id ?? "cue",
    asset: {
      id: "asset",
      kind: "audio",
      src: `/api/studio/media?path=studio%2Fuser%2Fproj%2F${digest}.m4a`,
      hash: digest,
      durationSec: 10,
      ...patch.asset,
    },
    role: "music",
    from: 0,
    durationInFrames: 30,
    offsetFrames: 0,
    loopFrames: null,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    duckVolume: 1,
    duckWindows: [],
    muteWindows: [],
    ...patch,
  };
}

function videoNode(
  patch: Partial<CompiledNode> & { hash?: string } = {},
): CompiledNode {
  const digest = patch.hash ?? hashB;
  return {
    id: patch.id ?? "video",
    type: "video",
    from: 0,
    durationInFrames: 60,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    layer: 1,
    visible: [],
    style: {},
    opacity: 1,
    rotate: 0,
    scale: 1,
    animation: [],
    media: {
      asset: {
        id: "vid",
        kind: "video",
        src: `/api/arts/secret`,
        hash: digest,
        durationSec: 10,
        posterSrc: `/api/studio/media?path=studio%2Fposter.jpg`,
      },
      offsetFrames: 90,
      loopFrames: null,
      fit: "cover",
    },
    ...patch,
  } as CompiledNode;
}

describe("chapters", () => {
  it("marks the first scene of each round and skips the answer scene", () => {
    const video = plan({
      scenes: [
        {
          id: "intro",
          kind: "custom",
          from: 0,
          durationInFrames: 30,
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
        {
          id: "r1",
          kind: "picker",
          from: 30,
          durationInFrames: 90,
          roundId: "round-a",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
        {
          id: "r1-answer",
          kind: "answer",
          from: 120,
          durationInFrames: 40,
          roundId: "round-a",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
        {
          id: "r2",
          kind: "picker",
          from: 160,
          durationInFrames: 90,
          roundId: "round-b",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
      ],
    });
    expect(chapters(video)).toEqual([
      { frame: 30, label: "Раунд 1" },
      { frame: 160, label: "Раунд 2" },
    ]);
  });

  it("marks top positions when a scene has no round", () => {
    const video = plan({
      scenes: [
        {
          id: "p1",
          kind: "top",
          from: 15,
          durationInFrames: 60,
          participantId: "one",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
        {
          id: "p1-again",
          kind: "top",
          from: 75,
          durationInFrames: 10,
          participantId: "one",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
        {
          id: "p2",
          kind: "top",
          from: 90,
          durationInFrames: 60,
          participantId: "two",
          background: "#000",
          nodes: [],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
      ],
    });
    expect(chapters(video).map((c) => c.label)).toEqual([
      "Позиция 1",
      "Позиция 2",
    ]);
  });
});

describe("chapter seeking", () => {
  const marks = [
    { frame: 30, label: "Раунд 1" },
    { frame: 160, label: "Раунд 2" },
  ];

  it("restarts the current chapter after one second, otherwise steps back, and the first chapter goes to 0", () => {
    expect(previousChapterFrame(marks, 30 + 30, 30)).toBe(0);
    expect(previousChapterFrame(marks, 30 + 30 + 1, 30)).toBe(30);
    expect(previousChapterFrame(marks, 31, 30)).toBe(0);
    expect(previousChapterFrame(marks, 160, 30)).toBe(30);
    expect(previousChapterFrame(marks, 10, 30)).toBe(0);
  });

  it("steps to the next chapter or the last frame", () => {
    expect(nextChapterFrame(marks, 40, 300)).toBe(160);
    expect(nextChapterFrame(marks, 160, 300)).toBe(299);
    expect(nextChapterFrame(marks, 200, 300)).toBe(299);
  });
});

describe("seek and audio tags", () => {
  it("seeks by five seconds and clamps to the timeline", () => {
    expect(seekBySeconds(0, -5, 30, 300)).toBe(0);
    expect(seekBySeconds(10, 5, 30, 300)).toBe(160);
    expect(seekBySeconds(290, 5, 30, 300)).toBe(299);
  });

  it("counts overlapping cues and never goes below five shared tags", () => {
    expect(sharedAudioTagCount(plan())).toBe(5);
    const video = plan({
      audio: [
        cue({ id: "a", from: 0, durationInFrames: 100 }),
        cue({ id: "b", from: 50, durationInFrames: 100 }),
        cue({ id: "c", from: 80, durationInFrames: 10 }),
        cue({ id: "d", from: 200, durationInFrames: 10 }),
        cue({ id: "e", from: 0, durationInFrames: 0 }),
      ],
    });
    expect(sharedAudioTagCount(video)).toBe(5);
    const busy = plan({
      audio: Array.from({ length: 6 }, (_, i) =>
        cue({ id: `c${i}`, from: 0, durationInFrames: 40 }),
      ),
    });
    expect(sharedAudioTagCount(busy)).toBe(6);
  });
});

describe("keys and control visibility", () => {
  const body = { tagName: "BODY" };

  it("maps the player keys and ignores text fields and arrows on a range", () => {
    expect(keyAction(" ", body)).toBe("toggle");
    expect(keyAction("ArrowLeft", body)).toBe("seek-back");
    expect(keyAction("ArrowRight", body)).toBe("seek-forward");
    expect(keyAction("f", body)).toBe("fullscreen");
    expect(keyAction("M", body)).toBe("mute");
    expect(keyAction("PageUp", body)).toBe("chapter-prev");
    expect(keyAction("PageDown", body)).toBe("chapter-next");
    expect(keyAction("k", body)).toBeNull();
    expect(keyAction(" ", { tagName: "INPUT", type: "text" })).toBeNull();
    expect(keyAction("ArrowLeft", { tagName: "TEXTAREA" })).toBeNull();
    expect(
      keyAction("ArrowRight", { tagName: "INPUT", type: "range" }),
    ).toBeNull();
    expect(keyAction(" ", { tagName: "INPUT", type: "range" })).toBe("toggle");
    expect(
      keyAction("f", { tagName: "DIV", isContentEditable: true }),
    ).toBeNull();
  });

  it("hides controls after 2.5s of playback and keeps them while paused or loading", () => {
    expect(CONTROLS_HIDE_MS).toBe(2500);
    expect(controlsHidden({ playing: true, loading: false, idleMs: 2499 })).toBe(
      false,
    );
    expect(controlsHidden({ playing: true, loading: false, idleMs: 2500 })).toBe(
      true,
    );
    expect(controlsHidden({ playing: false, loading: false, idleMs: 9000 })).toBe(
      false,
    );
    expect(controlsHidden({ playing: true, loading: true, idleMs: 9000 })).toBe(
      false,
    );
  });
});

describe("public media urls", () => {
  it("rewrites sources to the watch route and drops studio paths", () => {
    const node = videoNode();
    const video = plan({
      audio: [cue({ hash })],
      scenes: [
        {
          id: "s",
          kind: "custom",
          from: 0,
          durationInFrames: 30,
          background: "#000",
          nodes: [node],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
      ],
    });
    const token = "tok_en";
    const next = rewritePlanMedia(video, {
      [hash]: { file: `${hash}.m4a` },
      [hashB]: { file: `${hashB}.mp4`, poster: `${hashB}-poster.jpg` },
    }, token);
    expect(next.audio[0].asset.src).toBe(watchMediaPath(token, `${hash}.m4a`));
    expect(next.scenes[0].nodes[0].media?.asset.src).toBe(
      watchMediaPath(token, `${hashB}.mp4`),
    );
    expect(next.scenes[0].nodes[0].media?.asset.posterSrc).toBe(
      watchMediaPath(token, `${hashB}-poster.jpg`),
    );
    const dumped = JSON.stringify(next);
    expect(dumped).not.toContain("/api/studio");
    expect(dumped).not.toContain("/api/arts");
    expect(dumped).not.toContain("studio/");
    expect(dumped).not.toMatch(/files/);
  });
});

describe("slice windows", () => {
  it("pads a partial window by half a second and shifts the offset", () => {
    const video = plan({
      audio: [cue({ id: "part", offsetFrames: 100, durationInFrames: 30 })],
    });
    const slices = mediaSlices(video);
    expect(slices).toEqual([
      expect.objectContaining({
        hash,
        kind: "audio",
        startFrame: 85,
        endFrame: 145,
        copyWhole: false,
      }),
    ]);
    const sliced = applySlices(video);
    expect(sliced.audio[0].offsetFrames).toBe(15);
    expect(sliced.audio[0].asset.src).toBe(`slice:${slices[0].id}`);
    expect(sliced.audio[0].asset.durationSec).toBeCloseTo(60 / 30, 5);
  });

  it("copies a file that is already used edge to edge", () => {
    const video = plan({
      audio: [cue({ id: "all", offsetFrames: 0, durationInFrames: 290 })],
    });
    expect(mediaSlices(video)[0].copyWhole).toBe(true);
    expect(applySlices(video).audio[0].offsetFrames).toBe(0);
  });

  it("keeps distant windows apart and extends a video slice to the freeze frame", () => {
    const node = videoNode();
    node.media!.freezeAtFrame = 200;
    node.media!.offsetFrames = 90;
    node.durationInFrames = 30;
    const video = plan({
      fps: 30,
      audio: [
        cue({ id: "early", hash, offsetFrames: 0, durationInFrames: 20 }),
        cue({ id: "late", hash, offsetFrames: 240, durationInFrames: 20 }),
      ],
      scenes: [
        {
          id: "s",
          kind: "custom",
          from: 0,
          durationInFrames: 30,
          background: "#000",
          nodes: [node],
          phases: {},
          transition: { type: "none", durationInFrames: 0 },
        },
      ],
    });
    const slices = mediaSlices(video);
    const audioSlices = slices.filter((s) => s.hash === hash);
    expect(audioSlices).toHaveLength(2);
    const picture = slices.find((s) => s.hash === hashB);
    expect(picture?.endFrame).toBe(200 + 1 + 15);
    const sliced = applySlices(video);
    expect(sliced.scenes[0].nodes[0].media?.offsetFrames).toBe(15);
    expect(sliced.scenes[0].nodes[0].media?.freezeAtFrame).toBe(
      200 - (picture!.startFrame),
    );
  });

  it("merges windows that sit less than a second apart", () => {
    const video = plan({
      audio: [
        cue({ id: "a", offsetFrames: 0, durationInFrames: 30 }),
        cue({ id: "b", offsetFrames: 40, durationInFrames: 30 }),
      ],
    });
    expect(mediaSlices(video)).toHaveLength(1);
    expect(mediaSlices(video)[0].endFrame).toBe(70 + 15);
  });
});

describe("html size and disposition", () => {
  it("sums base64 parts without building the file", () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(
      htmlByteSize({
        skeletonBytes: 10,
        bundleBytes: 20,
        fontBase64Chars: 5,
        assets: [{ bytes: 3, wrapperBytes: 7 }],
      }),
    ).toBe(10 + 20 + 5 + 4 + 7);
  });

  it("warns at 80 MiB and refuses at 400 MiB or a huge asset string", () => {
    expect(htmlExportLimit(HTML_WARN_BYTES - 1, 10)).toBe("ok");
    expect(htmlExportLimit(HTML_WARN_BYTES, 10)).toBe("warn");
    expect(htmlExportLimit(HTML_MAX_BYTES - 1, 10)).toBe("warn");
    expect(htmlExportLimit(HTML_MAX_BYTES, 10)).toBe("refuse");
    expect(htmlExportLimit(100, HTML_MAX_ASSET_BASE64)).toBe("refuse");
  });

  it("names the download like a render, with an html extension", () => {
    expect(htmlContentDisposition("cm123", "Топ: аниме (2024)")).toBe(
      "attachment; filename=\"douga-cm123.html\"; " +
        "filename*=UTF-8''%D0%A2%D0%BE%D0%BF%20%D0%B0%D0%BD%D0%B8%D0%BC%D0%B5%20%282024%29.html",
    );
    expect(htmlContentDisposition("cm123", null)).toBe(
      'attachment; filename="douga-cm123.html"',
    );
    const header = htmlContentDisposition("cm123", "Выбери вайфу 💖");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });
});
