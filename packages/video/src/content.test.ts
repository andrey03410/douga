import { describe, expect, it } from "vitest";
import { createVideoDocument } from "./builders";
import { boardFamilies } from "./board-presets";
import {
  buildVideoContent,
  getVideoContentMissingInputs,
  videoContentInputSchema,
} from "./content";
import { compileVideo } from "./compiler";
import { resolveBoard } from "./board-state";

describe("semantic video content", () => {
  it("fills participant metadata and clears nullable fields without losing unrelated overrides", () => {
    const doc = createVideoDocument({
      kind: "top",
      participants: [
        {
          id: "p",
          label: "Герой",
          rank: 1,
          settings: { card: { borderRadius: 9 } },
        },
      ],
    });
    const filled = buildVideoContent(doc, {
      kind: "top",
      mode: "merge",
      participants: [{ id: "p", subtitle: "作品", kind: "image", tier: "S" }],
    });
    expect(filled.source.participants[0]).toMatchObject({
      subtitle: "作品",
      kind: "image",
      tier: "S",
      rank: 1,
    });
    const cleared = buildVideoContent(filled, {
      kind: "top",
      mode: "merge",
      participants: [{ id: "p", subtitle: null, kind: null, tier: null }],
    });
    expect(cleared.source.participants[0]).toEqual(doc.source.participants[0]);
  });
  it("authors three named groups of two with independent round music and background", () => {
    const doc = createVideoDocument({ kind: "picker", roundCount: 0 });
    const participants = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      id,
      label: id,
    }));
    const filled = buildVideoContent(doc, {
      kind: "picker",
      mode: "replace",
      participants,
      rounds: [
        {
          id: "r",
          cards: participants.map((p) => ({
            id: `card-${p.id}`,
            participantId: p.id,
          })),
          groups: [
            { id: "g1", label: "Маги", cardIds: ["card-a", "card-b"] },
            { id: "g2", label: "Воины", cardIds: ["card-c", "card-d"] },
            { id: "g3", label: "Герои", cardIds: ["card-e", "card-f"] },
          ],
          musicAssetId: "ost",
          backgroundAssetId: "landscape",
        },
      ],
    });
    const round = filled.source.rounds[0];
    expect(round.groups?.map((g) => [g.id, g.label, g.cardIds.length])).toEqual(
      [
        ["g1", "Маги", 2],
        ["g2", "Воины", 2],
        ["g3", "Герои", 2],
      ],
    );
    expect(round.answer).toBeUndefined();
    expect(filled.bindings[round.music!]).toEqual({
      kind: "pool",
      assetId: "ost",
    });
    expect(filled.bindings[round.background!]).toEqual({
      kind: "pool",
      assetId: "landscape",
    });
    const compiled = compileVideo(filled, {
      [round.music!]: {
        id: "ost",
        kind: "audio",
        src: "ost.wav",
        hasAudio: true,
        durationSec: 30,
      },
      [round.background!]: {
        id: "landscape",
        kind: "image",
        src: "landscape.png",
        width: 1920,
        height: 1080,
      },
    });
    expect(compiled.ready).toBe(true);
    expect(compiled.plan.audio.some((cue) => cue.asset.id === "ost")).toBe(
      true,
    );
    expect(
      compiled.plan.scenes.some((scene) =>
        scene.nodes.some((node) => node.media?.asset.id === "landscape"),
      ),
    ).toBe(true);
  });
  it("merges named groups and answer channels while null disables only the named assignments", () => {
    const doc = createVideoDocument({
      kind: "picker",
      participants: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      rounds: [
        {
          id: "r",
          cards: [
            { id: "ca", participantId: "a" },
            { id: "cb", participantId: "b" },
          ],
          groups: [
            {
              id: "g1",
              label: "Before",
              cardIds: ["ca"],
              settings: { card: { borderRadius: 17 } },
            },
            { id: "g2", label: "Keep", cardIds: ["cb"] },
          ],
          answer: { cardIds: ["ca"], groupIds: ["g2"] },
          music: "shared",
          background: "background",
        },
      ],
    });
    doc.bindings.shared = { kind: "pool", assetId: "old-ost" };
    doc.bindings.background = { kind: "pool", assetId: "old-bg" };
    doc.scenes[0].nodes.push({
      id: "unrelated",
      type: "audio",
      asset: "shared",
      role: "sfx",
    });
    const renamed = buildVideoContent(doc, {
      kind: "picker",
      mode: "merge",
      rounds: [
        {
          id: "r",
          groups: [{ id: "g1", label: "After" }],
          musicAssetId: "new-ost",
        },
      ],
    });
    expect(renamed.source.rounds[0].groups).toEqual([
      { ...doc.source.rounds[0].groups![0], label: "After" },
      doc.source.rounds[0].groups![1],
    ]);
    expect(renamed.source.rounds[0].cards).toEqual(doc.source.rounds[0].cards);
    expect(renamed.source.rounds[0].answer).toEqual(
      doc.source.rounds[0].answer,
    );
    expect(renamed.bindings.shared).toEqual({
      kind: "pool",
      assetId: "old-ost",
    });
    expect(
      buildVideoContent(renamed, {
        kind: "picker",
        mode: "merge",
        rounds: [{ id: "r", musicAssetId: "new-ost" }],
      }),
    ).toEqual(renamed);
    const cleared = buildVideoContent(renamed, {
      kind: "picker",
      mode: "merge",
      rounds: [
        {
          id: "r",
          answerGroupIds: null,
          musicAssetId: null,
          backgroundAssetId: null,
        },
      ],
    });
    expect(cleared.source.rounds[0]).toMatchObject({
      music: null,
      answer: { cardIds: ["ca"] },
    });
    expect(cleared.source.rounds[0].background).toBeUndefined();
    expect(cleared.source.rounds[0].answer?.groupIds).toBeUndefined();
    const answered = buildVideoContent(cleared, {
      kind: "picker",
      mode: "merge",
      rounds: [{ id: "r", answerParticipantIds: null, answerGroupIds: ["g1"] }],
    });
    expect(answered.source.rounds[0].answer).toEqual({ groupIds: ["g1"] });
    const ungrouped = buildVideoContent(answered, {
      kind: "picker",
      mode: "merge",
      rounds: [{ id: "r", groups: null, answerGroupIds: null }],
    });
    expect(ungrouped.source.rounds[0].groups).toBeUndefined();
    expect(ungrouped.source.rounds[0].answer).toBeUndefined();
  });
  it.each([
    { groups: [{ id: "g", cardIds: ["missing"] }] },
    { groups: [{ id: "g", cardIds: ["c", "c"] }] },
    {
      groups: [
        { id: "g", cardIds: ["c"] },
        { id: "g", cardIds: [] },
      ],
    },
    { groups: [{ id: "g", cardIds: ["c"] }], answerGroupIds: ["missing"] },
  ])("rejects broken group references atomically: %j", (update) => {
    const doc = createVideoDocument({
      kind: "picker",
      participants: [{ id: "p", label: "P" }],
      rounds: [{ id: "r", cards: [{ id: "c", participantId: "p" }] }],
    });
    const before = structuredClone(doc);
    expect(() =>
      buildVideoContent(doc, {
        kind: "picker",
        mode: "merge",
        rounds: [{ id: "r", ...update }],
      }),
    ).toThrow(/CONTENT_(GROUP|DUPLICATE|ANSWER)/);
    expect(doc).toEqual(before);
  });
  it("replaces grouped round semantics explicitly while retaining style and card identities", () => {
    const doc = createVideoDocument({
      kind: "picker",
      participants: [{ id: "p", label: "P" }],
      rounds: [
        {
          id: "r",
          cards: [{ id: "c", participantId: "p" }],
          groups: [{ id: "g", label: "G", cardIds: ["c"] }],
          answer: { groupIds: ["g"] },
          music: null,
          settings: { picker: { timerSec: 9 } },
        },
      ],
    });
    const replaced = buildVideoContent(doc, {
      kind: "picker",
      mode: "replace",
      participants: [{ id: "p", label: "P" }],
      rounds: [{ id: "r", cards: [{ participantId: "p" }] }],
    });
    expect(replaced.source.rounds[0]).toEqual({
      id: "r",
      cards: [{ id: "c", participantId: "p" }],
      settings: { picker: { timerSec: 9 } },
    });
  });
  it("turns authored tiers into existing board placements and retains row focus", () => {
    const doc = createVideoDocument({
      kind: "board",
      presetId: "board.tier.wide",
      roundCount: 0,
    });
    const next = buildVideoContent(doc, {
      kind: "board",
      mode: "replace",
      participants: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      tiers: [
        {
          id: "s",
          label: "Лучшие",
          participantIds: ["a"],
          background: "#554433",
        },
        { id: "b", label: "Хорошие", participantIds: ["b"] },
        { id: "empty", label: "Пока пусто", participantIds: [] },
      ],
    });
    const board = next.segments![0].scenes[0].board!;
    expect(board.slots.map((slot) => [slot.id, slot.label])).toEqual([
      ["s", "Лучшие"],
      ["b", "Хорошие"],
      ["empty", "Пока пусто"],
    ]);
    expect(board.slots[0].background).toBe("#554433");
    expect(board.presentation?.rowFocusSec).toBe(1);
    const resolved = resolveBoard(board, next.source.participants);
    expect(resolved.diagnostics).toEqual([]);
    const cards = new Map(
      board.rounds
        .flatMap((round) => round.cards)
        .map((card) => [card.id, card.participantId]),
    );
    expect(
      Object.entries(resolved.final.placements).map(([cardId, tierId]) => [
        cards.get(cardId),
        tierId,
      ]),
    ).toEqual([
      ["a", "s"],
      ["b", "b"],
    ]);
    expect(
      board.rounds
        .flatMap((round) => round.actions)
        .every((action) => action.type === "place"),
    ).toBe(true);
    const compiled = compileVideo(next);
    expect(compiled.ready).toBe(true);
    expect(
      compiled.plan.scenes.some((scene) =>
        scene.boardEvents?.some(
          (event) => event.event === "board.summary" && event.slotId === "s",
        ),
      ),
    ).toBe(true);
  });
  it("merges tier labels and assignments without changing stable IDs or untouched tiers", () => {
    const base = buildVideoContent(
      createVideoDocument({
        kind: "board",
        presetId: "board.tier.wide",
        roundCount: 0,
      }),
      {
        kind: "board",
        mode: "replace",
        participants: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        tiers: [
          { id: "s", label: "S", participantIds: ["a"] },
          { id: "b", label: "B", participantIds: ["b"] },
        ],
      },
    );
    base.segments![0].scenes[0].board!.slots[0].style = { borderRadius: 23 };
    const oldBoard = base.segments![0].scenes[0].board!;
    const renamed = buildVideoContent(base, {
      kind: "board",
      mode: "merge",
      tiers: [{ id: "s", label: "Любимые" }],
    });
    const board = renamed.segments![0].scenes[0].board!;
    expect(board.slots[0]).toMatchObject({
      id: "s",
      label: "Любимые",
      style: { borderRadius: 23 },
    });
    expect(board.slots[1]).toEqual(oldBoard.slots[1]);
    expect(board.rounds).toEqual(oldBoard.rounds);
    const moved = buildVideoContent(renamed, {
      kind: "board",
      mode: "merge",
      tiers: [
        { id: "s", participantIds: [] },
        { id: "b", participantIds: ["b", "a"] },
      ],
    });
    const movedBoard = moved.segments![0].scenes[0].board!;
    expect(
      movedBoard.rounds
        .flatMap((round) => round.cards)
        .map((card) => card.id)
        .sort(),
    ).toEqual(
      oldBoard.rounds
        .flatMap((round) => round.cards)
        .map((card) => card.id)
        .sort(),
    );
    expect(
      new Set(
        Object.values(
          resolveBoard(movedBoard, moved.source.participants).final.placements,
        ),
      ),
    ).toEqual(new Set(["b"]));
  });
  it("allocates tier card and action IDs without colliding with existing authored identities", () => {
    const doc = createVideoDocument({
      kind: "board",
      presetId: "board.tier.wide",
      roundCount: 0,
    });
    doc.source.participants = [{ id: "p", label: "P" }];
    const board = doc.segments![0].scenes[0].board!;
    board.slots = [{ id: "s", label: "S" }];
    board.rounds = [
      {
        id: "old",
        cards: [{ id: "tiers:card:q", participantId: "p" }],
        actions: [
          {
            id: "tiers:place:q",
            type: "place",
            cardId: "tiers:card:q",
            slotId: "s",
          },
        ],
      },
    ];
    const next = buildVideoContent(doc, {
      kind: "board",
      mode: "merge",
      participants: [{ id: "q", label: "Q" }],
      tiers: [{ id: "s", participantIds: ["p", "q"] }],
    });
    const changed = next.segments![0].scenes[0].board!;
    const cards = changed.rounds.flatMap((round) => round.cards),
      actions = changed.rounds.flatMap((round) => round.actions);
    expect(cards.find((card) => card.participantId === "p")?.id).toBe(
      "tiers:card:q",
    );
    expect(new Set(cards.map((card) => card.id)).size).toBe(2);
    expect(new Set(actions.map((action) => action.id)).size).toBe(2);
    expect(resolveBoard(changed, next.source.participants).diagnostics).toEqual(
      [],
    );
  });
  it("keeps long tier, card and round-media identities bounded and repeatable", () => {
    const participantId = "p".repeat(200),
      roundId = "r".repeat(200),
      tierId = "t".repeat(200);
    const picker = buildVideoContent(
      createVideoDocument({ kind: "picker", roundCount: 0 }),
      {
        kind: "picker",
        mode: "replace",
        participants: [{ id: participantId, label: "P" }],
        rounds: [
          {
            id: roundId,
            cards: [{ participantId }],
            musicAssetId: "ost",
            backgroundAssetId: "background",
          },
        ],
      },
    );
    expect(Object.keys(picker.bindings).every((key) => key.length <= 200)).toBe(
      true,
    );
    const input = {
      kind: "board" as const,
      mode: "replace" as const,
      participants: [{ id: participantId, label: "P" }],
      tiers: [{ id: tierId, label: "S", participantIds: [participantId] }],
    };
    const board = buildVideoContent(
      createVideoDocument({
        kind: "board",
        presetId: "board.tier.wide",
        roundCount: 0,
      }),
      input,
    );
    const round = board.segments![0].scenes[0].board!.rounds[0];
    expect(
      [round.id, round.cards[0].id, round.actions[0].id].every(
        (id) => id.length <= 200,
      ),
    ).toBe(true);
    expect(
      buildVideoContent(board, {
        kind: "board",
        mode: "merge",
        tiers: [{ id: tierId, label: "S" }],
      }),
    ).toEqual(board);
  });
  it.each([
    [{ id: "s", label: "S", participantIds: ["unknown"] }],
    [{ id: "s", label: "S", participantIds: ["p", "p"] }],
    [
      { id: "s", label: "S", participantIds: ["p"] },
      { id: "a", label: "A", participantIds: ["p"] },
    ],
    [
      { id: "s", label: "S", participantIds: [] },
      { id: "s", label: "Again", participantIds: [] },
    ],
  ])(
    "refuses invalid tier membership without mutating the source: %j",
    (...tiers) => {
      const doc = createVideoDocument({
        kind: "board",
        presetId: "board.tier.wide",
        roundCount: 0,
      });
      const before = structuredClone(doc);
      expect(() =>
        buildVideoContent(doc, {
          kind: "board",
          mode: "replace",
          participants: [{ id: "p", label: "P" }],
          tiers,
        }),
      ).toThrow(/CONTENT_(TIER|DUPLICATE)/);
      expect(doc).toEqual(before);
    },
  );
  it("keeps generated binding and card IDs valid for maximum-length authored IDs", () => {
    const doc = createVideoDocument({ kind: "picker", roundCount: 0 });
    const participantId = "p".repeat(200),
      roundId = "r".repeat(200);
    const input = {
      kind: "picker" as const,
      mode: "replace" as const,
      participants: [
        { id: participantId, label: "Герой", visualAssetId: "art" },
      ],
      rounds: [{ id: roundId, cards: [{ participantId }] }],
    };
    expect(videoContentInputSchema.safeParse(input).success).toBe(true);
    const result = buildVideoContent(doc, input);
    expect(result.source.rounds[0].cards[0].id.length).toBeLessThanOrEqual(200);
    expect(
      result.source.participants[0].media!.visual!.length,
    ).toBeLessThanOrEqual(200);
    expect(buildVideoContent(doc, input)).toEqual(result);
    const other = buildVideoContent(doc, {
      ...input,
      participants: [{ ...input.participants[0], id: `${"p".repeat(199)}q` }],
      rounds: [
        { id: roundId, cards: [{ participantId: `${"p".repeat(199)}q` }] },
      ],
    });
    expect(other.source.rounds[0].cards[0].id).not.toBe(
      result.source.rounds[0].cards[0].id,
    );
  });
  it("fills a manual top without changing styling or inventing ranks", () => {
    const doc = createVideoDocument({ kind: "top" });
    doc.settings!.card = { borderRadius: 41 };
    const next = buildVideoContent(doc, {
      kind: "top",
      mode: "replace",
      title: "Мой топ",
      participants: [{ id: "p", label: "作品", rank: 2, visualAssetId: "art" }],
    });
    expect(next.source.participants).toEqual([
      {
        id: "p",
        label: "作品",
        rank: 2,
        media: { visual: "content:p:visual" },
      },
    ]);
    expect(next.bindings["content:p:visual"]).toEqual({
      kind: "pool",
      assetId: "art",
    });
    expect(next.settings).toEqual(doc.settings);
    expect(next.scenes).toEqual(doc.scenes);
    expect(doc.title).not.toBe("Мой топ");
    expect(() =>
      buildVideoContent(doc, {
        kind: "top",
        mode: "replace",
        participants: [{ id: "p", label: "No rank" }],
      }),
    ).toThrow(/RANK_REQUIRED/);
  });
  it("merges participant fields and media while preserving overrides and unrelated assignments", () => {
    const doc = createVideoDocument({
      kind: "top",
      participants: [
        {
          id: "p",
          label: "Before",
          rank: 1,
          media: { visual: "shared" },
          settings: { card: { borderRadius: 31 } },
        },
      ],
    });
    doc.bindings.shared = { kind: "pool", assetId: "old" };
    doc.scenes[0].nodes.push({
      id: "unrelated",
      type: "image",
      asset: "shared",
    });
    const next = buildVideoContent(doc, {
      kind: "top",
      mode: "merge",
      participants: [{ id: "p", label: "After", visualAssetId: "new" }],
    });
    expect(next.source.participants[0].settings).toEqual({
      card: { borderRadius: 31 },
    });
    expect(next.source.participants[0].rank).toBe(1);
    expect(next.bindings.shared).toEqual({ kind: "pool", assetId: "old" });
    expect(next.source.participants[0].media!.visual).not.toBe("shared");
    expect(
      buildVideoContent(next, {
        kind: "top",
        mode: "merge",
        participants: [{ id: "p", visualAssetId: "new" }],
      }),
    ).toEqual(next);
  });
  it("keeps stable card IDs, round overrides and an explicitly authored answer", () => {
    const doc = createVideoDocument({
      kind: "picker",
      participants: [{ id: "p", label: "Old" }],
      rounds: [
        {
          id: "r",
          cards: [
            {
              id: "existing",
              participantId: "p",
              settings: { card: { borderRadius: 19 } },
            },
          ],
          settings: { picker: { timerSec: 9 } },
        },
      ],
    });
    const next = buildVideoContent(doc, {
      kind: "picker",
      mode: "merge",
      participants: [{ id: "q", label: "New" }],
      rounds: [
        {
          id: "r",
          cards: [{ participantId: "p" }, { participantId: "q" }],
          answerParticipantIds: ["q"],
        },
      ],
    });
    expect(next.source.rounds[0].cards[0]).toEqual(
      doc.source.rounds[0].cards[0],
    );
    expect(next.source.rounds[0].settings).toEqual(
      doc.source.rounds[0].settings,
    );
    expect(next.source.rounds[0].answer).toEqual({ cardIds: ["r:card:q"] });
    expect(() =>
      buildVideoContent(doc, {
        kind: "picker",
        mode: "merge",
        rounds: [{ id: "r", answerParticipantIds: ["missing"] }],
      }),
    ).toThrow(/ANSWER/);
  });
  it.each(boardFamilies)(
    "accepts only authored actions in existing %s slots",
    (family) => {
      const doc = createVideoDocument({
        kind: "board",
        presetId: `board.${family}.wide`,
      });
      const scene = doc.segments![0].scenes[0];
      const round = {
        id: "authored",
        cards: [{ id: "c", participantId: "p", cost: 2 }],
        actions: [
          {
            id: "a",
            type: "place" as const,
            cardId: "c",
            slotId: scene.board!.slots[0].id,
          },
        ],
      };
      const next = buildVideoContent(doc, {
        kind: "board",
        mode: "replace",
        participants: [{ id: "p", label: "Автор" }],
        boards: [{ sceneId: scene.id, rounds: [round] }],
      });
      expect(next.segments![0].scenes[0].board!.rounds).toEqual([round]);
      expect(compileVideo(next).ready).toBe(true);
      expect(() =>
        buildVideoContent(doc, {
          kind: "board",
          mode: "replace",
          participants: [{ id: "p", label: "Автор" }],
          boards: [
            {
              sceneId: scene.id,
              rounds: [
                {
                  ...round,
                  actions: [{ ...round.actions[0], slotId: "nonexistent" }],
                },
              ],
            },
          ],
        }),
      ).toThrow(/BOARD/);
    },
  );
  it("refuses unsupported mixed documents, tournament mutations and broken deletions", () => {
    const doc = createVideoDocument({
      kind: "picker",
      roundCount: 1,
      cardsPerRound: 1,
    });
    expect(() =>
      buildVideoContent(doc, { kind: "top", mode: "merge", title: "Wrong" }),
    ).toThrow(/KIND/);
    const custom = structuredClone(doc);
    custom.scenes[0].block = "custom";
    expect(() =>
      buildVideoContent(custom, {
        kind: "picker",
        mode: "merge",
        title: "Wrong",
      }),
    ).toThrow(/UNSUPPORTED/);
    const tournament = structuredClone(doc);
    tournament.source.kind = "tournament";
    tournament.source.tournamentId = "t";
    expect(() =>
      buildVideoContent(tournament, {
        kind: "picker",
        mode: "merge",
        participants: [{ id: "p", label: "No" }],
      }),
    ).toThrow(/TOURNAMENT/);
    expect(
      buildVideoContent(tournament, {
        kind: "picker",
        mode: "merge",
        title: "Allowed",
      }).title,
    ).toBe("Allowed");
    expect(() =>
      buildVideoContent(doc, {
        kind: "picker",
        mode: "merge",
        deleteParticipantIds: [doc.source.participants[0].id],
      }),
    ).toThrow(/REFERENCE/);
  });
  it("explicit replacement clears omitted semantic fields but retains existing style overrides", () => {
    const doc = createVideoDocument({
      kind: "picker",
      participants: [
        {
          id: "p",
          label: "Old",
          caption: "Old caption",
          media: { visual: "art" },
          settings: { card: { borderRadius: 13 } },
        },
      ],
      rounds: [
        {
          id: "r",
          prompt: "Old prompt",
          cards: [
            {
              id: "c",
              participantId: "p",
              settings: { card: { borderRadius: 7 } },
            },
          ],
          answer: { cardIds: ["c"] },
          settings: { picker: { timerSec: 8 } },
        },
      ],
    });
    doc.bindings.art = { kind: "pool", assetId: "old-art" };
    const result = buildVideoContent(doc, {
      kind: "picker",
      mode: "replace",
      participants: [{ id: "p", label: "New" }],
      rounds: [{ id: "r", cards: [{ id: "c", participantId: "p" }] }],
    });
    expect(result.source.participants[0]).toEqual({
      id: "p",
      label: "New",
      settings: { card: { borderRadius: 13 } },
    });
    expect(result.source.rounds[0].answer).toBeUndefined();
    expect(result.source.rounds[0].prompt).toBeUndefined();
    expect(result.source.rounds[0].settings).toEqual({
      picker: { timerSec: 8 },
    });
    expect(result.source.rounds[0].cards[0].settings).toEqual({
      card: { borderRadius: 7 },
    });
  });
  it("refuses unknown deletions and conflicting edits before modifying named content", () => {
    const doc = createVideoDocument({ kind: "top" });
    expect(() =>
      buildVideoContent(doc, {
        kind: "top",
        mode: "merge",
        deleteParticipantIds: ["unknown"],
      }),
    ).toThrow(/ID_UNKNOWN/);
    expect(() =>
      buildVideoContent(doc, {
        kind: "top",
        mode: "merge",
        deleteParticipantIds: ["participant-1"],
        participants: [{ id: "participant-1", label: "Ambiguous" }],
      }),
    ).toThrow(/DELETE_UPDATE_CONFLICT/);
  });
  it("rejects unknown fields, duplicate IDs, invalid asset IDs and implicit replacement", () => {
    expect(
      videoContentInputSchema.safeParse({ kind: "top", participants: [] })
        .success,
    ).toBe(false);
    expect(
      videoContentInputSchema.safeParse({
        kind: "top",
        mode: "replace",
        nodes: [],
      }).success,
    ).toBe(false);
    expect(
      videoContentInputSchema.safeParse({
        kind: "top",
        mode: "merge",
        participants: [{ id: "p", visualAssetId: "" }],
      }).success,
    ).toBe(false);
    const doc = createVideoDocument({ kind: "top" });
    expect(() =>
      buildVideoContent(doc, {
        kind: "top",
        mode: "merge",
        participants: [
          { id: "p", label: "A", rank: 1 },
          { id: "p", label: "B", rank: 2 },
        ],
      }),
    ).toThrow(/DUPLICATE/);
    expect(getVideoContentMissingInputs(doc)).toContain(
      "participants.participant-1.visualAssetId",
    );
  });
});
