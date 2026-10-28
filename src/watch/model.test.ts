import { describe, expect, it } from "vitest";
import type { CompiledScene } from "@/video";
import { cue, hash, hashB, imageNode, plan, videoNode } from "./fixtures";
import {
  CONTROLS_HIDE_MS,
  chapters,
  controlsHidden,
  coverFrame,
  formatClock,
  keyAction,
  nextChapterFrame,
  previousChapterFrame,
  rewritePlanMedia,
  chapterAt,
  seekBySeconds,
  sharedAudioTagCount,
  upcomingMedia,
  watchMediaPath,
} from "./model";

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

  it("reserves twice the busiest overlap, so a seek between two busy regions fits", () => {
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
    expect(sharedAudioTagCount(video)).toBe(6);
    // Premounting two seconds early, a cue right after another one overlaps it.
    const premounted = plan({
      audio: [
        cue({ id: "a", from: 0, durationInFrames: 300 }),
        cue({ id: "b", from: 0, durationInFrames: 300 }),
        cue({ id: "c", from: 310, durationInFrames: 100 }),
      ],
    });
    expect(sharedAudioTagCount(premounted)).toBe(6);
    const busy = plan({
      audio: Array.from({ length: 6 }, (_, i) =>
        cue({ id: `c${i}`, from: 0, durationInFrames: 40 }),
      ),
    });
    expect(sharedAudioTagCount(busy)).toBe(12);
  });
});

describe("clock", () => {
  it("rounds down, so the end reads the same as the total", () => {
    expect(formatClock(0, 30)).toBe("0:00");
    expect(formatClock(29, 30)).toBe("0:00");
    expect(formatClock(764, 30)).toBe("0:25");
    expect(formatClock(765, 30)).toBe("0:25");
    expect(formatClock(30 * 61, 30)).toBe("1:01");
  });
});

describe("keys and control visibility", () => {
  const body = { tagName: "BODY" };
  const key = (code: string, extra: Partial<Parameters<typeof keyAction>[0]> = {}) => ({
    code,
    ...extra,
  });

  it("maps physical keys, so F and M work in the Russian layout", () => {
    expect(keyAction(key("Space"), body)).toBe("toggle");
    expect(keyAction(key("ArrowLeft"), body)).toBe("seek-back");
    expect(keyAction(key("ArrowRight"), body)).toBe("seek-forward");
    expect(keyAction(key("KeyF"), body)).toBe("fullscreen");
    expect(keyAction(key("KeyM"), body)).toBe("mute");
    expect(keyAction(key("PageUp"), body)).toBe("chapter-prev");
    expect(keyAction(key("PageDown"), body)).toBe("chapter-next");
    expect(keyAction(key("KeyK"), body)).toBeNull();
  });

  it("leaves browser shortcuts and held toggles alone", () => {
    expect(keyAction(key("KeyF", { ctrlKey: true }), body)).toBeNull();
    expect(keyAction(key("KeyF", { metaKey: true }), body)).toBeNull();
    expect(keyAction(key("ArrowLeft", { altKey: true }), body)).toBeNull();
    expect(keyAction(key("ArrowLeft", { metaKey: true }), body)).toBeNull();
    expect(keyAction(key("Space", { repeat: true }), body)).toBeNull();
    expect(keyAction(key("KeyF", { repeat: true }), body)).toBeNull();
    expect(keyAction(key("KeyM", { repeat: true }), body)).toBeNull();
    expect(keyAction(key("ArrowRight", { repeat: true }), body)).toBe("seek-forward");
    expect(keyAction(key("PageDown", { repeat: true }), body)).toBe("chapter-next");
  });

  it("ignores text fields and keeps native arrows only where a range asks for them", () => {
    expect(keyAction(key("Space"), { tagName: "INPUT", type: "text" })).toBeNull();
    expect(keyAction(key("ArrowLeft"), { tagName: "TEXTAREA" })).toBeNull();
    expect(keyAction(key("KeyF"), { tagName: "DIV", isContentEditable: true })).toBeNull();
    const seekBar = { tagName: "INPUT", type: "range" };
    expect(keyAction(key("ArrowRight"), seekBar)).toBe("seek-forward");
    expect(keyAction(key("Space"), seekBar)).toBe("toggle");
    const volume = { tagName: "INPUT", type: "range", nativeArrows: true };
    expect(keyAction(key("ArrowRight"), volume)).toBeNull();
    expect(keyAction(key("ArrowLeft"), volume)).toBeNull();
    expect(keyAction(key("KeyM"), volume)).toBe("mute");
    expect(keyAction(key("Space"), { tagName: "BUTTON" })).toBe("toggle");
  });

  it("hides controls after 2.5s of playback and keeps them while paused, loading or pinned", () => {
    expect(CONTROLS_HIDE_MS).toBe(2500);
    const idle = { playing: true, loading: false, pinned: false };
    expect(controlsHidden({ ...idle, idleMs: 2499 })).toBe(false);
    expect(controlsHidden({ ...idle, idleMs: 2500 })).toBe(true);
    expect(controlsHidden({ ...idle, playing: false, idleMs: 9000 })).toBe(false);
    expect(controlsHidden({ ...idle, loading: true, idleMs: 9000 })).toBe(false);
    expect(controlsHidden({ ...idle, pinned: true, idleMs: 9000 })).toBe(false);
  });
});

function scene(patch: Partial<CompiledScene>): CompiledScene {
  return {
    id: "s",
    kind: "custom",
    from: 0,
    durationInFrames: 100,
    background: "#000",
    nodes: [],
    phases: {},
    transition: { type: "none", durationInFrames: 0 },
    ...patch,
  };
}

describe("current chapter", () => {
  it("names the last mark at or before the frame", () => {
    const marks = [
      { frame: 30, label: "Раунд 1" },
      { frame: 120, label: "Раунд 2" },
    ];
    expect(chapterAt(marks, 0)).toBeNull();
    expect(chapterAt(marks, 30)?.label).toBe("Раунд 1");
    expect(chapterAt(marks, 119)?.label).toBe("Раунд 1");
    expect(chapterAt(marks, 500)?.label).toBe("Раунд 2");
  });
});

describe("cover frame", () => {
  it("shows the first picker round with every card open and no answer yet", () => {
    const video = plan({
      scenes: [
        scene({ id: "r1", kind: "picker", from: 0, durationInFrames: 300, phases: { revealStartFrame: 20, timerStartFrame: 150, answerStartFrame: 240 } }),
      ],
    });
    expect(coverFrame(video)).toBe(150);
  });

  it("stops before the answer when there is no timer, else takes 60% of the first scene", () => {
    expect(coverFrame(plan({ scenes: [scene({ from: 0, durationInFrames: 100, phases: { answerStartFrame: 40 } })] }))).toBe(39);
    expect(coverFrame(plan({ scenes: [scene({ id: "empty", durationInFrames: 0 }), scene({ id: "intro", from: 0, durationInFrames: 255 })] }))).toBe(153);
    expect(coverFrame(plan({ durationInFrames: 0 }))).toBe(0);
  });
});

describe("preload window", () => {
  it("prefetches sound that starts ahead and decodes stills of every scene in reach", () => {
    const video = plan({
      durationInFrames: 900,
      audio: [
        cue({ id: "now", from: 0, durationInFrames: 255, asset: { src: "/api/watch/t/media/now.wav" } as never }),
        cue({ id: "soon", from: 255, durationInFrames: 255, asset: { src: "/api/watch/t/media/soon.wav" } as never }),
        cue({ id: "late", from: 800, durationInFrames: 30, asset: { src: "/api/watch/t/media/late.wav" } as never }),
        cue({ id: "offline", from: 100, durationInFrames: 30, asset: { src: "blob:null/1" } as never }),
      ],
      scenes: [
        scene({ id: "a", from: 0, durationInFrames: 255, nodes: [imageNode("/api/watch/t/media/a.png"), videoNode()] }),
        scene({ id: "b", from: 255, durationInFrames: 255, nodes: [imageNode("blob:null/b", "d".repeat(64))] }),
        scene({ id: "c", from: 800, durationInFrames: 100, nodes: [imageNode("/api/watch/t/media/c.png", "e".repeat(64))] }),
      ],
    });
    // Before the first play everything from frame 0 counts.
    const start = upcomingMedia(video, -1, 300);
    expect(start.sounds.sort()).toEqual([
      "/api/watch/t/media/now.wav",
      "/api/watch/t/media/soon.wav",
    ]);
    expect(start.stills.sort()).toEqual([
      "/api/studio/media?path=studio%2Fposter.jpg",
      "/api/watch/t/media/a.png",
      "blob:null/b",
    ]);
    // While playing, a cue that already started is left alone; its scene's stills are not.
    const playing = upcomingMedia(video, 10, 300);
    expect(playing.sounds).toEqual(["/api/watch/t/media/soon.wav"]);
    expect(playing.stills.sort()).toEqual([
      "/api/studio/media?path=studio%2Fposter.jpg",
      "/api/watch/t/media/a.png",
      "blob:null/b",
    ]);
    const late = upcomingMedia(video, 520, 300);
    expect(late.sounds).toEqual(["/api/watch/t/media/late.wav"]);
    expect(late.stills).toEqual(["/api/watch/t/media/c.png"]);
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

