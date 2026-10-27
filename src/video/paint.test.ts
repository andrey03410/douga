import { describe, expect, it } from "vitest";
import {
  applyVideoPreset,
  compileVideo,
  createVideoDocument,
  extractVideoPreset,
  parseVideoDocument,
} from "./index";

const gradient = {
  type: "linear",
  angle: 90,
  stops: [
    { color: "#ff0000", at: 0 },
    { color: "#0000ff", at: 1 },
  ],
};
const shadow = { color: "#000000", x: 4, y: 8, blur: 20, spread: 2 };
function document(style: unknown) {
  const doc = createVideoDocument({
    kind: "picker",
    roundCount: 1,
    cardsPerRound: 3,
  });
  doc.scenes = [
    {
      id: "styled",
      block: "custom",
      duration: { sec: 2 },
      nodes: [
        {
          id: "panel",
          type: "container",
          children: [],
          style: style as import("./types").CardStyle,
        },
      ],
    },
  ];
  return doc;
}
describe("declarative paint at SDK boundary", () => {
  it("retains gradient and shadow in compiled nodes and media-free reusable presets", () => {
    const doc = parseVideoDocument(
      document({ background: "#101010", gradient, shadow }),
    );
    const result = compileVideo(doc);
    expect(result.ready).toBe(true);
    expect(result.plan.scenes[0].nodes[0].style).toMatchObject({
      gradient,
      shadow,
    });
    const preset = extractVideoPreset(doc, { id: "paint", name: "Paint" });
    expect(preset.scenes[0].nodes[0].style).toMatchObject({ gradient, shadow });
    expect(
      compileVideo(applyVideoPreset(doc, preset)).plan.scenes[0].nodes[0].style,
    ).toMatchObject({ gradient, shadow });
  });
  it("accepts an explicit radial center and hard gradient stops", () => {
    const radial = {
      type: "radial",
      center: { x: 0.2, y: 0.8 },
      stops: [
        { color: "white", at: 0 },
        { color: "white", at: 0.5 },
        { color: "transparent", at: 0.5 },
        { color: "transparent", at: 1 },
      ],
    };
    expect(
      parseVideoDocument(document({ gradient: radial })).scenes[0].nodes[0]
        .style,
    ).toMatchObject({ gradient: radial });
  });
  it.each([
    { gradient: { ...gradient, stops: [] } },
    {
      gradient: {
        ...gradient,
        stops: [
          { color: "red", at: 0.8 },
          { color: "blue", at: 0.2 },
        ],
      },
    },
    {
      gradient: {
        ...gradient,
        stops: [
          { color: "red", at: -0.1 },
          { color: "blue", at: 1 },
        ],
      },
    },
    {
      gradient: {
        ...gradient,
        stops: [
          { color: "url(https://example.com/steal)", at: 0 },
          { color: "blue", at: 1 },
        ],
      },
    },
    {
      gradient: {
        type: "radial",
        center: { x: 2, y: 0 },
        stops: gradient.stops,
      },
    },
    { shadow: { ...shadow, blur: 1000 } },
    {
      shadow: { ...shadow, color: "red; background:url(https://example.com)" },
    },
  ])("rejects unsafe or unbounded paint %j", (style) =>
    expect(() => parseVideoDocument(document(style))).toThrow(),
  );
  it("keeps absent paint optional for existing documents", () => {
    const node = compileVideo(
      parseVideoDocument(document({ background: "#123456" })),
    ).plan.scenes[0].nodes[0];
    expect(node.style.background).toBe("#123456");
    expect(node.style).not.toHaveProperty("gradient");
    expect(node.style).not.toHaveProperty("shadow");
  });
});

it("lets local null paint clear inherited panel gradients and shadows", () => {
  const doc = document({ gradient, shadow });
  const parent = doc.scenes[0].nodes[0];
  if (parent.type !== "container") throw new Error("fixture");
  parent.children = [
    {
      id: "solid-child",
      type: "container",
      children: [],
      style: { background: "white", gradient: null, shadow: null },
    },
  ];
  const parsed = parseVideoDocument(doc);
  const result = compileVideo(parsed);
  expect(result.ready).toBe(true);
  expect(result.plan.scenes[0].nodes[1].style).toMatchObject({
    background: "white",
    gradient: null,
    shadow: null,
  });
  const preset = extractVideoPreset(parsed, {
    id: "clear-paint",
    name: "Clear paint",
  });
  expect(
    compileVideo(applyVideoPreset(parsed, preset)).plan.scenes[0].nodes[1]
      .style,
  ).toMatchObject({ gradient: null, shadow: null });
});
