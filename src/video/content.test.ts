import { describe, expect, it } from "vitest";
import { createVideoDocument } from "./builders";
import { boardFamilies } from "./board-presets";
import {
  buildVideoContent,
  getVideoContentMissingInputs,
  videoContentInputSchema,
} from "./content";
import { compileVideo } from "./compiler";

describe("semantic video content", () => {
  it("keeps generated binding and card IDs valid for maximum-length authored IDs", () => {
    const doc = createVideoDocument({ kind: "picker", roundCount: 0 });
    const participantId = "p".repeat(200), roundId = "r".repeat(200);
    const input = { kind: "picker" as const, mode: "replace" as const,
      participants: [{ id: participantId, label: "Герой", visualAssetId: "art" }],
      rounds: [{ id: roundId, cards: [{ participantId }] }] };
    expect(videoContentInputSchema.safeParse(input).success).toBe(true);
    const result = buildVideoContent(doc, input);
    expect(result.source.rounds[0].cards[0].id.length).toBeLessThanOrEqual(200);
    expect(result.source.participants[0].media!.visual!.length).toBeLessThanOrEqual(200);
    expect(buildVideoContent(doc, input)).toEqual(result);
    const other = buildVideoContent(doc, { ...input, participants: [{ ...input.participants[0], id: `${"p".repeat(199)}q` }], rounds: [{ id: roundId, cards: [{ participantId: `${"p".repeat(199)}q` }] }] });
    expect(other.source.rounds[0].cards[0].id).not.toBe(result.source.rounds[0].cards[0].id);
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
