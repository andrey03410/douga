import { describe, expect, it } from "vitest";
import {
  buildPickerPlan,
  buildMusicCues,
  ANSWER_SEC,
  BOOKEND_SEC,
  MUSIC_FADE_SEC,
  PROMPT_INTRO_SEC,
  NO_PROMPT_INTRO_SEC,
  ROUND_GAP_SEC,
  GROUP_STAGGER_SEC,
  groupName,
  roundIsRenderable,
  unrenderableRounds,
  type PickerDefaults,
  type PlanRoundInput,
  type PlanTileInput,
} from "./picker-plan";

const DEFAULTS: PickerDefaults = {
  revealSec: 4,
  hideAfterReveal: false,
  timerSec: 5,
  tickSound: true,
};

function imageTile(over: Partial<PlanTileInput> = {}): PlanTileInput {
  return {
    media: { kind: "image", ref: "img.png", posterRef: null, durationSec: null, hasAudio: false },
    crop: null,
    startSec: null,
    label: null,
    isAnswer: false,
    playSound: true,
    fitMode: "cover",
    ...over,
  };
}

function videoTile(
  durationSec: number,
  over: Partial<PlanTileInput> = {},
): PlanTileInput {
  return {
    media: { kind: "video", ref: "clip.mp4", posterRef: "poster.jpg", durationSec, hasAudio: true },
    crop: null,
    startSec: null,
    label: null,
    isAnswer: false,
    playSound: true,
    fitMode: "cover",
    ...over,
  };
}

function round(tiles: PlanTileInput[], over: Partial<PlanRoundInput> = {}): PlanRoundInput {
  return {
    prompt: "Выбери персонажа",
    showPrompt: true,
    labelsMode: "finale",
    revealSec: null,
    hideAfterReveal: null,
    timerSec: null,
    bg: null,
    bgMusic: null,
    orientation: "landscape",
    tiles,
    ...over,
  };
}

describe("buildPickerPlan timings", () => {
  it("sequences tiles by revealSec after the prompt intro", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([imageTile(), imageTile(), imageTile()])]);
    const r = plan.rounds[0];
    expect(r.tiles.map((t) => t.revealAtSec)).toEqual([
      PROMPT_INTRO_SEC,
      PROMPT_INTRO_SEC + 4,
      PROMPT_INTRO_SEC + 8,
    ]);
    expect(r.finaleAtSec).toBe(PROMPT_INTRO_SEC + 12);
    expect(r.answerAtSec).toBeNull();
    expect(r.endSec).toBeCloseTo(r.finaleAtSec + 5 + ROUND_GAP_SEC, 9);
    expect(plan.durationSec).toBeCloseTo(r.endSec, 9);
  });

  it("hidden prompt uses the short intro and drops the text from the plan", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile(), imageTile()], { showPrompt: false }),
    ]);
    expect(plan.rounds[0].prompt).toBeNull();
    expect(plan.rounds[0].tiles[0].revealAtSec).toBe(NO_PROMPT_INTRO_SEC);
  });

  it("round overrides beat project defaults; second round starts where the first ended", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile(), imageTile()], { revealSec: 2, timerSec: 3 }),
      round([imageTile(), imageTile()]),
    ]);
    const [a, b] = plan.rounds;
    expect(a.finaleAtSec).toBe(PROMPT_INTRO_SEC + 4); // 2 tiles * 2s
    expect(a.timerSec).toBe(3);
    expect(b.startSec).toBeCloseTo(a.endSec, 9);
    expect(b.timerSec).toBe(5); // default
  });

  it("hideAfterReveal closes each tile window; default keeps tiles open until finale", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile(), imageTile()], { hideAfterReveal: true }),
      round([imageTile(), imageTile()]),
    ]);
    const hidden = plan.rounds[0].tiles;
    expect(hidden[0].hideAtSec).toBe(hidden[0].revealAtSec + 4);
    const open = plan.rounds[1].tiles;
    expect(open.every((t) => t.hideAtSec === null)).toBe(true);
  });

  it("answer round gets the highlight phase after the timer", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile(), imageTile({ isAnswer: true })]),
    ]);
    const r = plan.rounds[0];
    expect(r.answerAtSec).toBeCloseTo(r.finaleAtSec + r.timerSec, 9);
    expect(r.endSec).toBeCloseTo(r.finaleAtSec + r.timerSec + ANSWER_SEC + ROUND_GAP_SEC, 9);
  });

  it("empty rounds are skipped without breaking the timeline", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([]),
      round([imageTile(), imageTile()]),
    ]);
    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0].startSec).toBe(0);
  });
});

describe("buildPickerPlan sound & footage", () => {
  it("sounded video tile ducks the round music during its window", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([videoTile(30), imageTile()], {
        bgMusic: { ref: "music.mp3", durationSec: 60 },
      }),
    ]);
    const r = plan.rounds[0];
    const tile = r.tiles[0];
    expect(tile.sound).toEqual({
      fromSec: tile.revealAtSec,
      durationSec: 4,
      ref: "clip.mp4",
      startSec: 0,
    });
    expect(r.bgMusic!.duckWindows).toEqual([
      { fromSec: tile.revealAtSec, toSec: tile.revealAtSec + 4 },
    ]);
  });

  it("short video loops its footage but the sound is not stretched", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([videoTile(1.5), imageTile()])]);
    const tile = plan.rounds[0].tiles[0];
    expect(tile.visual.loopSec).toBeCloseTo(1.5, 9);
    expect(tile.sound!.durationSec).toBeCloseTo(1.5, 9);
  });

  it("startSec shifts the footage and shrinks the sound window", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([videoTile(10, { startSec: 7 }), imageTile()]),
    ]);
    const tile = plan.rounds[0].tiles[0];
    expect(tile.visual.startSec).toBe(7);
    expect(tile.visual.loopSec).toBeCloseTo(3, 9); // 3s left < 4s reveal
    expect(tile.sound!.durationSec).toBeCloseTo(3, 9);
  });

  it("muted tiles and images produce no sound and no ducking", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round(
        [
          videoTile(30, { playSound: false }),
          videoTile(30, { media: { kind: "video", ref: "silent.mp4", posterRef: null, durationSec: 30, hasAudio: false } }),
          imageTile(),
        ],
        { bgMusic: { ref: "music.mp3", durationSec: 60 } },
      ),
    ]);
    const r = plan.rounds[0];
    expect(r.tiles.every((t) => t.sound === null)).toBe(true);
    expect(r.bgMusic!.duckWindows).toEqual([]);
  });
});

describe("buildPickerPlan labels", () => {
  it("labelsMode drives when a label may show", () => {
    const mk = (mode: "always" | "finale" | "never") =>
      buildPickerPlan(DEFAULTS, [
        round([imageTile({ label: "Rem" }), imageTile()], { labelsMode: mode }),
      ]).rounds[0].tiles[0];
    expect(mk("always")).toMatchObject({ showLabelDuringReveal: true, showLabelAtFinale: true });
    expect(mk("finale")).toMatchObject({ showLabelDuringReveal: false, showLabelAtFinale: true });
    expect(mk("never")).toMatchObject({ showLabelDuringReveal: false, showLabelAtFinale: false });
  });

  it("blank labels are normalized to null", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile({ label: "  " }), imageTile()]),
    ]);
    expect(plan.rounds[0].tiles[0].label).toBeNull();
  });
});

describe("buildMusicCues / plan.music", () => {
  const track = (ref: string, durationSec: number) => ({ ref, durationSec });

  it("lays tracks back to back with a crossfade overlap and loops to cover the video", () => {
    const cues = buildMusicCues([track("a.mp3", 10), track("b.mp3", 6)], 25);
    expect(cues.map((c) => c.ref)).toEqual(["a.mp3", "b.mp3", "a.mp3", "b.mp3"]);
    // each next cue starts one fade before the previous ends (overlap)
    expect(cues[1].fromSec).toBeCloseTo(10 - MUSIC_FADE_SEC, 9);
    expect(cues[2].fromSec).toBeCloseTo(9 + 6 - MUSIC_FADE_SEC, 9);
    // coverage reaches the end of the video
    const last = cues[cues.length - 1];
    expect(last.fromSec + last.durationSec).toBeGreaterThanOrEqual(25);
  });

  it("a single short track loops with crossfades", () => {
    const cues = buildMusicCues([track("a.mp3", 4)], 10);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cues.map((c) => c.ref))).toEqual(new Set(["a.mp3"]));
  });

  it("last cue is clipped to the video end (plus the fade allowance)", () => {
    const cues = buildMusicCues([track("a.mp3", 100)], 20);
    expect(cues).toHaveLength(1);
    expect(cues[0].durationSec).toBeCloseTo(20 + MUSIC_FADE_SEC, 9);
  });

  it("empty or unusable playlists produce no cues", () => {
    expect(buildMusicCues([], 20)).toEqual([]);
    expect(buildMusicCues([track("a.mp3", 0)], 20)).toEqual([]);
  });

  it("plan.music: override rounds become mute windows; their ducks are excluded", () => {
    const plan = buildPickerPlan(
      DEFAULTS,
      [
        round([videoTile(30), imageTile()]), // playlist round with a sounded tile
        round([videoTile(30), imageTile()], {
          bgMusic: { ref: "own.mp3", durationSec: 60 }, // override round
        }),
      ],
      [track("pl.mp3", 60)],
    );
    const [r1, r2] = plan.rounds;
    expect(plan.music).not.toBeNull();
    expect(plan.music!.muteWindows).toEqual([{ fromSec: r2.startSec, toSec: r2.endSec }]);
    // playlist ducks only under the non-override round's tile sound
    expect(plan.music!.duckWindows).toEqual(r1.duckWindows);
    expect(plan.music!.duckWindows).toHaveLength(1);
    // the override round still carries its own duck windows
    expect(r2.bgMusic!.duckWindows).toHaveLength(1);
    // cues cover the whole two-round video
    const last = plan.music!.cues[plan.music!.cues.length - 1];
    expect(last.fromSec + last.durationSec).toBeGreaterThanOrEqual(plan.durationSec);
  });

  it("no playlist -> plan.music is null", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([imageTile(), imageTile()])]);
    expect(plan.music).toBeNull();
  });
});

describe("buildPickerPlan intro/outro cards", () => {
  const BOOKENDS = { intro: { text: "Топ персонажей" }, outro: { text: "Спасибо" } };

  it("no bookends by default: rounds still start at 0", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([imageTile(), imageTile()])]);
    expect(plan.intro).toBeNull();
    expect(plan.outro).toBeNull();
    expect(plan.rounds[0].startSec).toBe(0);
  });

  it("intro shifts the whole timeline; outro extends the duration", () => {
    const bare = buildPickerPlan(DEFAULTS, [
      round([imageTile(), imageTile()]),
      round([imageTile(), imageTile()]),
    ]);
    const plan = buildPickerPlan(
      DEFAULTS,
      [round([imageTile(), imageTile()]), round([imageTile(), imageTile()])],
      [],
      BOOKENDS,
    );

    expect(plan.intro).toEqual({ text: "Топ персонажей", fromSec: 0, durationSec: BOOKEND_SEC });
    // every round (and every tile inside it) moves by the intro length
    expect(plan.rounds[0].startSec).toBe(BOOKEND_SEC);
    expect(plan.rounds[0].tiles[0].revealAtSec).toBeCloseTo(
      bare.rounds[0].tiles[0].revealAtSec + BOOKEND_SEC,
      9,
    );
    expect(plan.rounds[1].startSec).toBeCloseTo(bare.rounds[1].startSec + BOOKEND_SEC, 9);
    // the outro sits right after the last round and closes the video
    const lastEnd = plan.rounds[1].endSec;
    expect(plan.outro).toEqual({ text: "Спасибо", fromSec: lastEnd, durationSec: BOOKEND_SEC });
    expect(plan.durationSec).toBeCloseTo(lastEnd + BOOKEND_SEC, 9);
    expect(plan.durationSec).toBeCloseTo(bare.durationSec + 2 * BOOKEND_SEC, 9);
    expect(plan.durationInFrames).toBe(Math.round(plan.durationSec * plan.fps));
  });

  it("each card can be enabled on its own", () => {
    const introOnly = buildPickerPlan(DEFAULTS, [round([imageTile(), imageTile()])], [], {
      intro: { text: "Старт" },
      outro: null,
    });
    expect(introOnly.intro!.text).toBe("Старт");
    expect(introOnly.outro).toBeNull();
    expect(introOnly.durationSec).toBeCloseTo(introOnly.rounds[0].endSec, 9);

    const outroOnly = buildPickerPlan(DEFAULTS, [round([imageTile(), imageTile()])], [], {
      intro: null,
      outro: { text: "Конец" },
    });
    expect(outroOnly.intro).toBeNull();
    expect(outroOnly.rounds[0].startSec).toBe(0);
    expect(outroOnly.outro!.fromSec).toBeCloseTo(outroOnly.rounds[0].endSec, 9);
  });

  it("a project without renderable rounds gets no cards at all", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([])], [], BOOKENDS);
    expect(plan.rounds).toEqual([]);
    expect(plan.intro).toBeNull();
    expect(plan.outro).toBeNull();
    expect(plan.durationSec).toBe(1);
  });

  it("background music covers the cards too (no mute windows added)", () => {
    const plan = buildPickerPlan(
      DEFAULTS,
      [round([imageTile(), imageTile()])],
      [{ ref: "pl.mp3", durationSec: 30 }],
      BOOKENDS,
    );
    const cues = plan.music!.cues;
    expect(cues[0].fromSec).toBe(0); // starts on the title card
    const last = cues[cues.length - 1];
    expect(last.fromSec + last.durationSec).toBeGreaterThanOrEqual(plan.durationSec);
    expect(plan.music!.muteWindows).toEqual([]);
  });
});

describe("buildPickerPlan orientation & fitMode", () => {
  it("uses the round orientation for the layout and carries fitMode", () => {
    const plan = buildPickerPlan(
      { revealSec: 3, hideAfterReveal: false, timerSec: 5, tickSound: false },
      [
        {
          prompt: null, showPrompt: false, labelsMode: "always",
          revealSec: null, hideAfterReveal: null, timerSec: null,
          bg: null, bgMusic: null,
          orientation: "portrait",
          tiles: [
            { media: { kind: "image", ref: "a", posterRef: null, durationSec: null, hasAudio: false }, crop: null, startSec: null, label: "A", isAnswer: true, playSound: false, fitMode: "contain" },
            { media: { kind: "image", ref: "b", posterRef: null, durationSec: null, hasAudio: false }, crop: null, startSec: null, label: "B", isAnswer: false, playSound: false, fitMode: "cover" },
          ],
        },
      ],
    );
    const round = plan.rounds[0];
    // portrait 2 tiles -> 2:3 rects (w/h * 16/9 ≈ 0.667)
    const r0 = round.tiles[0].rect;
    expect((r0.w / r0.h) * (16 / 9)).toBeCloseTo(2 / 3, 2);
    expect(round.tiles[0].visual.fitMode).toBe("contain");
    expect(round.tiles[1].visual.fitMode).toBe("cover");
  });
});

// ---- Phase 16: group comparison rounds ----

function groupRound(
  blocks: PlanTileInput[][],
  over: Partial<PlanRoundInput> = {},
): PlanRoundInput {
  return round([], {
    mode: "groups",
    groups: blocks.map((tiles, i) => ({
      label: i === 0 ? "Тройка А" : null,
      isAnswer: false,
      tiles,
    })),
    ...over,
  });
}

describe("groupName", () => {
  it("falls back to the positional name", () => {
    expect(groupName(0, null)).toBe("Блок А");
    expect(groupName(1, "  ")).toBe("Блок Б");
    expect(groupName(2, "Тройка Key")).toBe("Тройка Key");
    expect(groupName(3, null)).toBe("Блок 4");
  });
});

describe("buildPickerPlan group rounds", () => {
  it("steps the timeline by block, not by card", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile(), imageTile(), imageTile()], [imageTile(), imageTile()]]),
    ]);
    const r = plan.rounds[0];
    expect(r.mode).toBe("groups");
    expect(r.tiles).toEqual([]); // cards live inside the blocks
    expect(r.groups.map((g) => g.revealAtSec)).toEqual([
      PROMPT_INTRO_SEC,
      PROMPT_INTRO_SEC + DEFAULTS.revealSec,
    ]);
    // two blocks * revealSec, not five cards * revealSec
    expect(r.finaleAtSec).toBeCloseTo(PROMPT_INTRO_SEC + 2 * DEFAULTS.revealSec, 10);
    expect(r.endSec).toBeCloseTo(r.finaleAtSec + DEFAULTS.timerSec + ROUND_GAP_SEC, 10);
  });

  it("cascades the cards inside a block and keeps them within the block window", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile(), imageTile(), imageTile()], [imageTile()]]),
    ]);
    const first = plan.rounds[0].groups[0];
    const offsets = first.tiles.map((t) => t.revealAtSec - first.revealAtSec);
    offsets.forEach((off, i) => expect(off).toBeCloseTo(i * GROUP_STAGGER_SEC, 10));
    for (const off of offsets) expect(off).toBeLessThan(DEFAULTS.revealSec);
    // a single-card block has no cascade
    expect(plan.rounds[0].groups[1].tiles[0].revealAtSec).toBe(
      plan.rounds[0].groups[1].revealAtSec,
    );
  });

  it("squeezes the cascade into a short reveal window", () => {
    const plan = buildPickerPlan({ ...DEFAULTS, revealSec: 0.6 }, [
      groupRound([[imageTile(), imageTile(), imageTile(), imageTile(), imageTile()], [imageTile()]]),
    ]);
    const g = plan.rounds[0].groups[0];
    const last = g.tiles[4].revealAtSec - g.revealAtSec;
    expect(last).toBeLessThanOrEqual(0.6 - 0.2 + 1e-9);
    expect(last).toBeGreaterThan(0);
  });

  it("hideAfterReveal hides the whole block, otherwise cards stay to the finale", () => {
    const hidden = buildPickerPlan({ ...DEFAULTS, hideAfterReveal: true }, [
      groupRound([[imageTile(), imageTile()], [imageTile()]]),
    ]).rounds[0];
    expect(hidden.groups[0].hideAtSec).toBeCloseTo(
      hidden.groups[0].revealAtSec + DEFAULTS.revealSec,
      10,
    );
    for (const t of hidden.groups[0].tiles) expect(t.hideAtSec).toBe(hidden.groups[0].hideAtSec);

    const kept = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile(), imageTile()], [imageTile()]]),
    ]).rounds[0];
    expect(kept.groups[0].hideAtSec).toBeNull();
  });

  it("lays panels and cards out through groupLayout (uniform card size)", () => {
    const r = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile(), imageTile(), imageTile()], [imageTile(), imageTile()]]),
    ]).rounds[0];
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].panel.w).toBeGreaterThan(r.groups[1].panel.w);
    const sizes = new Set(
      r.groups.flatMap((g) => g.tiles.map((t) => `${t.rect.w.toFixed(9)}x${t.rect.h.toFixed(9)}`)),
    );
    expect(sizes.size).toBe(1);
    expect(r.groups[0].label).toBe("Тройка А");
    expect(r.groups[1].label).toBeNull(); // the frame falls back to «Блок Б»
  });

  it("marks the winning block and dims nothing when no block is marked", () => {
    const withAnswer = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile()], [imageTile()]], {
        mode: "groups",
        groups: [
          { label: null, isAnswer: false, tiles: [imageTile()] },
          { label: null, isAnswer: true, tiles: [imageTile()] },
        ],
      }),
    ]).rounds[0];
    expect(withAnswer.groups.map((g) => g.isAnswer)).toEqual([false, true]);
    expect(withAnswer.answerAtSec).toBeCloseTo(withAnswer.finaleAtSec + DEFAULTS.timerSec, 10);
    expect(withAnswer.endSec - withAnswer.finaleAtSec).toBeCloseTo(
      DEFAULTS.timerSec + ANSWER_SEC + ROUND_GAP_SEC,
      10,
    );

    const plain = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile()], [imageTile()]]),
    ]).rounds[0];
    expect(plain.answerAtSec).toBeNull();
  });

  it("gives one sound and one duck window per block (the first sounded card)", () => {
    const r = buildPickerPlan(DEFAULTS, [
      groupRound([
        [videoTile(10), videoTile(10), imageTile()],
        [imageTile(), videoTile(10, { playSound: false })],
      ]),
    ]).rounds[0];
    const sounded = r.groups[0].tiles.filter((t) => t.sound);
    expect(sounded).toHaveLength(1);
    expect(sounded[0].sound!.fromSec).toBe(r.groups[0].tiles[0].revealAtSec);
    expect(r.groups[1].tiles.some((t) => t.sound)).toBe(false);
    expect(r.duckWindows).toHaveLength(1);
  });

  it("skips a group round that is not renderable yet (one block or an empty block)", () => {
    const oneBlock = buildPickerPlan(DEFAULTS, [groupRound([[imageTile(), imageTile()]])]);
    expect(oneBlock.rounds).toEqual([]);
    expect(oneBlock.durationSec).toBe(1);

    const emptyBlock = buildPickerPlan(DEFAULTS, [groupRound([[imageTile()], []])]);
    expect(emptyBlock.rounds).toEqual([]);

    // ...and such a round does not earn the project its bookends either
    const withCards = buildPickerPlan(
      DEFAULTS,
      [groupRound([[imageTile()], []])],
      [],
      { intro: { text: "Топ" }, outro: { text: "Пока" } },
    );
    expect(withCards.intro).toBeNull();
  });

  it("keeps a mixed project continuous: group round then single round", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      groupRound([[imageTile()], [imageTile()]]),
      round([imageTile(), imageTile()]),
    ]);
    expect(plan.rounds).toHaveLength(2);
    expect(plan.rounds[0].mode).toBe("groups");
    expect(plan.rounds[1].mode).toBe("single");
    expect(plan.rounds[1].startSec).toBeCloseTo(plan.rounds[0].endSec, 10);
    expect(plan.durationSec).toBeCloseTo(plan.rounds[1].endSec, 10);
  });
});

// ---- Task 23 (T06): one renderability rule for preview, render and UI ----

describe("roundIsRenderable", () => {
  it("a plain round needs at least two tiles", () => {
    expect(roundIsRenderable(round([]))).toBe(false);
    expect(roundIsRenderable(round([imageTile()]))).toBe(false);
    expect(roundIsRenderable(round([imageTile(), imageTile()]))).toBe(true);
  });

  it("a group round needs two blocks with a card in each", () => {
    expect(roundIsRenderable(groupRound([[imageTile(), imageTile()]]))).toBe(false);
    expect(roundIsRenderable(groupRound([[imageTile()], []]))).toBe(false);
    expect(roundIsRenderable(groupRound([[imageTile()], [imageTile()]]))).toBe(true);
  });

  it("takes DB rows too: mode is a plain string, cards hang off the round", () => {
    const row = (mode: string, tiles: number, blocks: number[]) => ({
      mode,
      tiles: Array.from({ length: tiles }, (_, i) => ({ id: `t${i}` })),
      groups: blocks.map((n) => ({ tiles: Array.from({ length: n }, () => ({ id: "c" })) })),
    });
    expect(roundIsRenderable(row("single", 1, []))).toBe(false);
    expect(roundIsRenderable(row("single", 2, []))).toBe(true);
    expect(roundIsRenderable(row("groups", 3, [3, 0]))).toBe(false);
    expect(roundIsRenderable(row("groups", 3, [2, 1]))).toBe(true);
  });
});

describe("unrenderableRounds", () => {
  it("lists 1-based numbers of rounds that have cards but cannot render", () => {
    expect(
      unrenderableRounds([
        round([imageTile(), imageTile()]),
        round([imageTile()]),
        groupRound([[imageTile()], []]),
        groupRound([[imageTile()], [imageTile()]]),
      ]),
    ).toEqual([2, 3]);
  });

  it("leaves out empty rounds: preview and render both skip them silently", () => {
    expect(unrenderableRounds([round([]), groupRound([[], []]), round([imageTile(), imageTile()])]))
      .toEqual([]);
  });
});

describe("buildPickerPlan drops exactly the rounds the render rejects", () => {
  it("skips a one-tile round and keeps the timeline continuous", () => {
    const plan = buildPickerPlan(DEFAULTS, [
      round([imageTile()]),
      round([imageTile(), imageTile()]),
    ]);
    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0].index).toBe(1);
    expect(plan.rounds[0].startSec).toBe(0);
  });

  it("a one-tile round alone earns no bookends", () => {
    const plan = buildPickerPlan(DEFAULTS, [round([imageTile()])], [], {
      intro: { text: "Топ" },
      outro: { text: "Пока" },
    });
    expect(plan.rounds).toEqual([]);
    expect(plan.intro).toBeNull();
    expect(plan.outro).toBeNull();
  });

  it("the plan keeps a round iff roundIsRenderable says so", () => {
    const rounds = [
      round([]),
      round([imageTile()]),
      round([imageTile(), imageTile()]),
      groupRound([[imageTile(), imageTile()]]),
      groupRound([[imageTile()], []]),
      groupRound([[imageTile()], [imageTile()]]),
    ];
    const kept = buildPickerPlan(DEFAULTS, rounds).rounds.map((r) => r.index);
    expect(kept).toEqual(
      rounds.map((r, i) => (roundIsRenderable(r) ? i : -1)).filter((i) => i >= 0),
    );
    expect(kept).toEqual([2, 5]);
  });
});
