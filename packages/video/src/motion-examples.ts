/** Browser-safe, local synthetic demos. The manifest is a compiler stand-in, not
 * an owned pool: replace pool bindings with your own assets before saving. */
import { createVideoDocument } from "./builders";
import { parseVideoDocument } from "./schema";
import { motionCatalog, type MotionCatalogEntry } from "./motion-catalog";
import type { AssetManifest, VideoDocument, VideoNode } from "./types";
import type {
  ChoreographyName,
  MotionIntensity,
  MotionName,
  MotionProfile,
  TimerSettings,
  VersusSettings,
} from "./motion-types";
export interface MotionExampleOptions {
  profile?: MotionProfile;
  intensity?: MotionIntensity;
  variant?: string;
}
const palettes = [
  ["#ffb86c", "#e4568f"],
  ["#65e6cf", "#347fc4"],
  ["#b8a1ff", "#6451ab"],
];
export const motionStandInManifest: AssetManifest = Object.fromEntries(
  palettes.map(([a, b], i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="800" fill="#101728"/><circle cx="320" cy="310" r="230" fill="url(#g)"/><path d="M80 800L320 240L560 800Z" fill="#18263a"/><circle cx="320" cy="300" r="90" fill="${a}"/><path d="M220 340Q320 430 420 340L460 610H180Z" fill="${b}"/><circle cx="130" cy="130" r="28" fill="${a}"/><path d="M70 700H570" stroke="${a}" stroke-width="4"/></svg>`;
    return [
      `demo-${i}`,
      {
        id: `synthetic-${i}`,
        kind: "image" as const,
        width: 640,
        height: 800,
        src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      },
    ];
  }),
);
function base(): VideoDocument {
  const doc = createVideoDocument({ kind: "top", participants: [] });
  delete doc.preset;
  doc.id = "motion-demo";
  doc.title = "Douga • Моушен-кит";
  doc.settings = {
    background: "#101728",
    card: { color: "#f7f6ff", fontSize: 64 },
  };
  doc.bindings = Object.fromEntries(
    Object.keys(motionStandInManifest).map((key) => [
      key,
      { kind: "pool", assetId: `synthetic-${key.slice(-1)}` },
    ]),
  );
  doc.scenes = [
    { id: "demo", block: "custom", duration: { sec: 4 }, nodes: [] },
  ];
  return doc;
}
const title = (text = "Выбери свою историю"): VideoNode => ({
  id: "title",
  type: "text",
  text,
  rect: { x: 0.08, y: 0.12, width: 0.84, height: 0.2 },
  style: { fontSize: 82 },
});
function artwork(): VideoNode {
  return {
    id: "artwork",
    type: "container",
    rect: { x: 0.32, y: 0.12, width: 0.36, height: 0.76 },
    children: [
      {
        id: "art",
        type: "image",
        asset: "demo-0",
        rect: { x: 0, y: 0, width: 1, height: 0.82 },
        style: { borderRadius: 28 },
      },
      {
        id: "label",
        type: "text",
        text: "АКИРА / 01",
        rect: { x: 0, y: 0.84, width: 1, height: 0.16 },
        style: { fontSize: 46 },
      },
    ],
  };
}
function uniqueNodeIds(document: VideoDocument) {
  const visit = (nodes: VideoNode[], prefix: string) =>
    nodes.forEach((node) => {
      node.id = `${prefix}-${node.id}`;
      if (node.type === "container") visit(node.children, node.id);
    });
  for (const scene of [
    ...document.scenes,
    ...(document.segments ?? []).flatMap((segment) => segment.scenes),
  ])
    visit(scene.nodes, scene.id);
  return document;
}
export function createMotionExample(
  entry: MotionCatalogEntry,
  options: MotionExampleOptions = {},
) {
  let document = base();
  const profile = options.profile ?? "smooth",
    intensity = options.intensity ?? "normal";
  const settings = { profile, intensity };
  let fragment: Record<string, unknown> = entry.example;
  let fragmentKind = "settings";
  if (entry.category === "effect") {
    const channel = entry.channels[0];
    const motion = {
      ...settings,
      [channel]: {
        name: entry.name as MotionName,
        duration: { sec: channel === "loop" ? 2 : 0.9 },
        ...(channel === "emphasis" ? { at: { sec: 1 } } : {}),
      },
    };
    const node = entry.name.startsWith("text-")
      ? title(
          entry.name === "text-counter"
            ? "9000"
            : entry.name === "text-lines"
              ? "ТВОЙ ВЫБОР\nТВОЯ ИСТОРИЯ"
              : "Выбери свою историю",
        )
      : artwork();
    if (node.type === "text")
      node.rect = { x: 0.08, y: 0.35, width: 0.84, height: 0.3 };
    node.motion = motion;
    document.scenes[0].nodes = [node];
    fragment = { motion };
    fragmentKind = "node";
  } else if (entry.category === "choreography") {
    const name = entry.name as ChoreographyName;
    if (name === "board-place" || name === "board-swap") {
      document = createVideoDocument({
        kind: "board",
        participants: [0, 1].map((i) => ({
          id: `p${i}`,
          label: i ? "Юки" : "Акира",
          media: { visual: `demo-${i}` },
        })),
        board: {
          version: 1,
          mode: "accumulate",
          allowMoves: true,
          requireAllAssigned: true,
          slots: [
            { id: "s0", label: "S", capacity: 1 },
            { id: "s1", label: "A", capacity: 1 },
          ],
          presentation: {
            leadSec: 0.3,
            revealSec: 0.5,
            thinkSec: 0.5,
            moveSec: 0.7,
            holdSec: 0.5,
            finalSec: 0.8,
          },
          rounds: [
            {
              id: "round",
              cards: [
                { id: "c0", participantId: "p0" },
                { id: "c1", participantId: "p1" },
              ],
              actions: [
                { id: "place0", type: "place", cardId: "c0", slotId: "s0" },
                { id: "place1", type: "place", cardId: "c1", slotId: "s1" },
                ...(name === "board-swap"
                  ? [
                      {
                        id: "swap",
                        type: "swap" as const,
                        cardId: "c0",
                        otherCardId: "c1",
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      });
    } else if (name === "rank-reveal" || name === "podium-finale") {
      document = createVideoDocument({
        kind: "top",
        participants: [0, 1, 2].map((i) => ({
          id: `p${i}`,
          label: ["Акира", "Юки", "Рэн"][i],
          rank: i + 1,
          media: { visual: `demo-${i}` },
        })),
      });
      document.settings.top = { durationSec: 2.5 };
    } else if (
      [
        "versus-impact",
        "picker-cascade",
        "winner-spotlight",
        "round-intro",
      ].includes(name)
    ) {
      document = createVideoDocument({
        kind: "picker",
        roundCount: 1,
        cardsPerRound: 2,
      });
      document.source.participants.forEach((p, i) => {
        p.label = i ? "Юки" : "Акира";
        p.media = { visual: `demo-${i}` };
      });
      document.source.rounds[0].prompt = "Кого выберешь?";
      document.source.rounds[0].answer = {
        cardIds: [document.source.rounds[0].cards[0].id],
      };
      document.settings.picker = {
        leadSec: 0.4,
        revealSec: 0.6,
        timerSec: 2,
        answerSec: 1.5,
      };
      document.scenes[0].nodes.push({
        id: "vs",
        type: "versus",
        variant: "impact",
        rect: { x: 0.43, y: 0.4, width: 0.14, height: 0.2 },
      });
    } else
      document.scenes[0].nodes =
        name === "title-reveal" ? [title()] : [artwork()];
    document.settings.motion = { ...settings, choreography: name };
    fragment = { motion: document.settings.motion };
    document.bindings = base().bindings;
  } else if (entry.category === "transition") {
    const incoming = document.scenes[0];
    incoming.id = "incoming";
    incoming.duration = { sec: 2.5 };
    incoming.settings = { background: "#38264a" };
    incoming.nodes = [
      title("НОВАЯ ИСТОРИЯ"),
      {
        id: "art",
        type: "image",
        asset: "demo-1",
        rect: { x: 0.38, y: 0.35, width: 0.24, height: 0.6 },
      },
    ];
    incoming.transition = {
      type: entry.name as NonNullable<typeof incoming.transition>["type"],
      duration: { sec: 0.8 },
      direction: "left",
      color: "#ffdb99",
    };
    document.scenes = [
      {
        id: "outgoing",
        block: "custom",
        duration: { sec: 1.5 },
        nodes: [artwork()],
        settings: { background: "#102b3a" },
      },
      incoming,
    ];
    fragment = { transition: incoming.transition };
    fragmentKind = "scene";
  } else if (entry.category === "backdrop") {
    document.settings.backdrop = {
      preset: entry.name as NonNullable<
        typeof document.settings.backdrop
      >["preset"],
      colors: ["#101728", "#83456d", "#367b8b"],
      intensity,
      particles: 18,
      ...(entry.name === "art-blur"
        ? { source: "asset", asset: "demo-0" }
        : {}),
    };
    document.scenes[0].nodes = [
      title(),
      {
        id: "subtitle",
        type: "text",
        text: "Фон, который поддерживает историю",
        rect: { x: 0.1, y: 0.63, width: 0.8, height: 0.15 },
        style: { fontSize: 46 },
      },
    ];
    fragment = { backdrop: document.settings.backdrop };
  } else {
    const rect = { x: 0.28, y: 0.25, width: 0.44, height: 0.5 };
    let node: VideoNode;
    if (entry.name === "timer")
      node = {
        id: "timer",
        type: "timer",
        variant: (options.variant ?? "ring") as TimerSettings["variant"],
        duration: { sec: 4 },
        color: "#79e5ce",
        trackColor: "#303b50",
        strokeWidth: 16,
        rect,
      };
    else if (entry.name === "versus")
      node = {
        id: "versus",
        type: "versus",
        variant: (options.variant ?? "neon") as VersusSettings["variant"],
        color: "#ffb86c",
        rect,
      };
    else if (entry.name === "badge")
      node = {
        id: "badge",
        type: "badge",
        kind: "winner",
        text: "ПОБЕДИТЕЛЬ",
        color: "#ffb86c",
        rect: { x: 0.22, y: 0.38, width: 0.56, height: 0.24 },
      };
    else
      node = {
        id: "progress",
        type: "progress",
        scope: "scene",
        color: "#79e5ce",
        strokeWidth: 22,
        rect: { x: 0.15, y: 0.5, width: 0.7, height: 0.08 },
      };
    document.scenes[0].nodes = [node];
    fragment = node as unknown as Record<string, unknown>;
    fragmentKind = "node";
  }
  document.title = `${entry.category} / ${entry.name}`;
  return {
    id: `motion-${entry.category}-${entry.name}`,
    document: parseVideoDocument(uniqueNodeIds(document)),
    standInManifest: motionStandInManifest,
    manifestNote:
      "Локальные синтетические SVG. Stand-in manifest для compileVideo; перед сохранением замените pool bindings собственными assetId.",
    fragmentKind,
    fragment,
  };
}
/** Explicit whole-document recipes stay small for MCP context. The local
 * gallery builder above covers every catalog entry independently. */
export function motionExamples() {
  const entries = motionCatalog.entries;
  const recipes = entries
    .filter((entry) => entry.category === "choreography")
    .map((entry) => createMotionExample(entry));
  recipes.push(
    createMotionExample(entries.find((entry) => entry.name === "text-slam")!),
  );
  const sampler = createMotionExample(
    entries.find((entry) => entry.name === "timer")!,
  );
  sampler.id = "motion-widget-backdrop-transition-sampler";
  sampler.document.scenes = ["ring", "segments", "bar"].map((variant, i) => {
    const scene = createMotionExample(
      entries.find((entry) => entry.name === "timer")!,
      { variant },
    ).document.scenes[0];
    scene.id = `sample-${i}`;
    scene.settings = {
      backdrop: {
        preset:
          i === 0 ? "gradient-flow" : i === 1 ? "light-orbs" : "particles",
        particles: 12,
      },
    };
    scene.transition = {
      type: i === 1 ? "wipe" : "crossfade",
      duration: { sec: 0.5 },
    };
    return scene;
  });
  sampler.document = parseVideoDocument(uniqueNodeIds(sampler.document));
  recipes.push(sampler);
  // Stand-ins describe compilation inputs; they are not real owned assets or
  // fetchable owner URLs. The gallery uses the in-memory SVG manifest instead.
  const standInManifest = Object.fromEntries(
    Object.entries(motionStandInManifest).map(([key, asset]) => [
      key,
      { ...asset, src: `${key}.svg` },
    ]),
  );
  return recipes.map(
    ({ fragment: _fragment, fragmentKind: _kind, ...example }) => ({
      ...example,
      standInManifest,
    }),
  );
}
