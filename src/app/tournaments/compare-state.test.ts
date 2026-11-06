import { describe, expect, it } from "vitest";
import { digitIndex, rankClick, tierFromKey, unplacedReason, wrapIndex } from "./compare-state";
import {
  allEstimates,
  chooserEstimate,
  maxGroupFor,
  parseTierNames,
  recommendedSchemes,
  settingsSummary,
} from "./scheme-chooser";
import { addToDraft, draftGroups, draftSources, shikimoriCount, type DraftItem } from "./participant-draft";

describe("compare screen", () => {
  it("ranks by clicks; the last one is implied", () => {
    const q = ["a", "b", "c"];
    const first = rankClick([], "b", q);
    expect(first).toEqual({ kind: "pick", picks: ["b"] });
    expect(rankClick(["b"], "c", q)).toEqual({ kind: "submit", ranked: ["b", "c", "a"], rest: [] });
    // a pair is answered by one click
    expect(rankClick([], "y", ["x", "y"])).toEqual({ kind: "submit", ranked: ["y", "x"], rest: [] });
    // repeated or foreign clicks change nothing
    expect(rankClick(["b"], "b", q)).toEqual({ kind: "pick", picks: ["b"] });
    expect(rankClick(["b"], "z", q)).toEqual({ kind: "pick", picks: ["b"] });
  });

  it("maps keys to participants and tiers", () => {
    expect(digitIndex("3", 5)).toBe(2);
    expect(digitIndex("6", 5)).toBeNull();
    expect(digitIndex("0", 5)).toBeNull();
    expect(digitIndex("a", 5)).toBeNull();
    expect(tierFromKey("1", 5)).toBe(0);
    expect(tierFromKey("5", 5)).toBe(4);
    expect(tierFromKey("6", 5)).toBeNull();
    expect(tierFromKey("0", 5)).toBe(-1);
  });

  it("wraps zoom paging", () => {
    expect(wrapIndex(0, -1, 4)).toBe(3);
    expect(wrapIndex(3, 1, 4)).toBe(0);
    expect(wrapIndex(1, 1, 4)).toBe(2);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });

  it("explains a missing place", () => {
    expect(unplacedReason({ tier: 1 }, ["S", "A"], "tiers")).toBe("корзина A");
    expect(unplacedReason({}, ["S", "A"], "tiers")).toBe("ещё без корзины");
    expect(unplacedReason({ stage: 2 }, null, "bracket")).toBe("вылет в раунде 2");
    expect(unplacedReason({}, null, "top_k")).toBe("не вошли");
  });
});

describe("algorithm chooser", () => {
  it("suggests by field size (P19)", () => {
    expect(recommendedSchemes(8)).toEqual(["round_robin"]);
    expect(recommendedSchemes(12)).toEqual(["round_robin"]);
    expect(recommendedSchemes(40)).toEqual(["insertion"]);
    expect(recommendedSchemes(200)).toEqual(["top_k", "rating", "tiers"]);
  });

  it("estimates with the engine itself and caps pair-only schemes", () => {
    expect(maxGroupFor("merge")).toBe(2);
    expect(maxGroupFor("insertion")).toBeGreaterThan(2);
    // merge ignores the group size: pairs either way
    expect(chooserEstimate("merge", 30, 5, {})).toBe(chooserEstimate("merge", 30, 2, {}));
    const all = allEstimates(120, 5);
    expect(Object.keys(all)).toHaveLength(8);
    // the product targets (P19): top-10 of 120 within ~100, insertion about half of merge
    expect(all.top_k).toBeLessThanOrEqual(110);
    expect(all.insertion).toBeLessThan(all.merge * 0.6);
    expect(all.tiers).toBe(120);
  });

  it("parses tier names", () => {
    expect(parseTierNames("S, A, B")).toEqual(["S", "A", "B"]);
    expect(parseTierNames("Топ\nОк\nМимо")).toEqual(["Топ", "Ок", "Мимо"]);
    expect(parseTierNames("S")).toBeNull();
    expect(parseTierNames("S, S")).toBeNull();
    expect(parseTierNames("1,2,3,4,5,6,7,8")).toBeNull();
  });

  it("summarises settings in one line", () => {
    expect(settingsSummary("top_k", { k: 15 })).toBe("K = 15");
    expect(settingsSummary("tiers", { tiers: ["S", "A", "B"], rankTop: 2 })).toBe(
      "S · A · B; упорядочить: S, A",
    );
    expect(settingsSummary("rating", { accuracy: "precise" })).toBe("точность: точно");
    expect(settingsSummary("merge", {})).toBe("");
  });
});

describe("participant draft", () => {
  const ch = (id: number, group: string | null, label = `#${id}`): DraftItem => ({
    sourceKey: `shikimori:character:${id}`,
    source: { shikimori: { type: "character", id } },
    label,
    thumbUrl: null,
    group,
    subtitle: group,
  });

  it("keeps one entry per participant and title", () => {
    const d = addToDraft(addToDraft([], [ch(1, "Umineko"), ch(2, "Umineko")]), [ch(1, "Umineko"), ch(1, "Higurashi")]);
    expect(d.map((x) => `${x.sourceKey}@${x.group}`)).toEqual([
      "shikimori:character:1@Umineko",
      "shikimori:character:2@Umineko",
      "shikimori:character:1@Higurashi",
    ]);
    expect(draftGroups(d)).toEqual(["Umineko", "Higurashi"]);
  });

  it("one segment merges a participant met in several titles, keeping the first title", () => {
    const d = [ch(1, "Umineko"), ch(2, "Umineko"), ch(1, "Higurashi")];
    expect(draftSources(d, false)).toEqual([
      { shikimori: { type: "character", id: 1 }, subtitle: "Umineko" },
      { shikimori: { type: "character", id: 2 }, subtitle: "Umineko" },
    ]);
  });

  it("a segment per title keeps the participant in each title", () => {
    const d = [ch(1, "Umineko"), ch(1, "Higurashi"), { ...ch(3, null), source: { assetId: "a" }, sourceKey: "art:a" }];
    const sources = draftSources(d, true);
    expect(sources.map((s) => s.segment ?? null)).toEqual(["Umineko", "Higurashi", null]);
    expect(shikimoriCount(sources)).toBe(2);
  });
});
