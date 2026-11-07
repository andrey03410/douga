import { describe, it, expect } from "vitest";
import {
  SCHEME_INFO,
  defaultSchemeSettings,
  parseSchemeSettings,
  readSchemeSettings,
} from "./scheme-settings";
import { SCHEMES } from "./types";

describe("scheme settings", () => {
  it("has a label and description for every scheme", () => {
    for (const s of SCHEMES) {
      expect(SCHEME_INFO[s].label).toBeTruthy();
      expect(SCHEME_INFO[s].when).toBeTruthy();
    }
  });

  it("fills defaults", () => {
    expect(parseSchemeSettings("top_k", {})).toEqual({ k: 10 });
    expect(parseSchemeSettings("tiers", undefined)).toEqual({
      tiers: ["S", "A", "B", "C", "D"],
      rankTop: 0,
    });
    expect(parseSchemeSettings("swiss", {})).toEqual({});
  });

  it("accepts valid knobs", () => {
    expect(parseSchemeSettings("top_k", { k: 25 })).toEqual({ k: 25 });
    expect(parseSchemeSettings("tiers", { tiers: ["Топ", "Норм", "Мимо"], rankTop: 1 })).toEqual({
      tiers: ["Топ", "Норм", "Мимо"],
      rankTop: 1,
    });
    expect(parseSchemeSettings("rating", { accuracy: "precise" })).toEqual({ accuracy: "precise" });
    expect(parseSchemeSettings("bracket", { thirdPlace: true })).toEqual({ thirdPlace: true });
  });

  it.each([
    ["top_k", { k: 0 }],
    ["top_k", { k: 2.5 }],
    ["tiers", { tiers: ["S"] }],
    ["tiers", { tiers: ["1", "2", "3", "4", "5", "6", "7", "8"] }],
    ["tiers", { tiers: ["S", "A"], rankTop: 3 }],
    ["tiers", { tiers: ["Топ", "топ", "Мимо"], rankTop: 0 }],
    ["rating", { accuracy: "max" }],
    ["swiss", { k: 3 }],
    ["merge", { thirdPlace: true }],
  ] as const)("rejects %s %j", (scheme, raw) => {
    expect(() => parseSchemeSettings(scheme, raw)).toThrow("INVALID_SCHEME_SETTINGS");
  });

  it("falls back to defaults on stored garbage", () => {
    expect(readSchemeSettings("top_k", "{not json")).toEqual(defaultSchemeSettings("top_k"));
    expect(readSchemeSettings("top_k", JSON.stringify({ k: -1 }))).toEqual({ k: 10 });
    expect(readSchemeSettings("top_k", null)).toEqual({ k: 10 });
  });
});
