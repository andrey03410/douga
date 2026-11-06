import { createVideoDocument } from "./builders";
import { compileVideo } from "./compiler";
import { getBuiltinPresets } from "./presets";
import { motionCatalog } from "./motion-catalog";
import { createTypographyExample, typographyExampleIds } from "./typography-examples";
import { applyTypographyTheme, typographyStyles, typographyThemes } from "./typography-catalog";
import type { AssetManifest, CompiledVideo, VideoDocument, VideoNode, VideoScene } from "./types";
import type { BackdropSettings, ChoreographyName, MotionName, TransitionName } from "./motion-types";
export const visualFixtureVersion = 1;
export interface VisualFixture {
  id: string; document: VideoDocument; manifest: AssetManifest;
  frames: { frame: number; phase: "before" | "during" | "after"; reason: string }[];
  sampling: { strategy: "representative-events-v1"; sampled: boolean; available: VisualFixture["frames"]; selected: number[] };
  coverage: { presets?: string[]; recipes?: string[]; motion?: string[]; typographyExamples?: string[]; typographyStyles?: string[]; typographyThemes?: string[]; cases?: string[] };
}
export function visualFixtureMedia(): { id: string; filename: string; data: Uint8Array }[] {
  const colors = ["#ff795e", "#79d3ed", "#a1ed83", "#d8a0ff"];
  const result = colors.map((color, i) => ({ id: `art-${i}`, filename: `art-${i}.svg`, data: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800"><rect width="640" height="800" fill="#10243b"/><circle cx="${210 + i * 50}" cy="260" r="180" fill="${color}"/><path d="M80 800 L320 360 L560 800Z" fill="${color}"/><path d="M0 80 L640 720 M0 240 L640 80" stroke="#ffffff" stroke-width="12"/><circle cx="280" cy="240" r="18" fill="#10243b"/><circle cx="380" cy="240" r="18" fill="#10243b"/></svg>`) }));
  // PCM mono, 48 kHz, exactly two seconds, generated without a network or clock.
  const samples = 96000, data = new Uint8Array(44 + samples * 2), view = new DataView(data.buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, data.length - 8, true); ascii(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 5000 * Math.min(1, i / 480, (samples - i - 1) / 480)), true);
  return [...result, { id: "tone", filename: "tone.wav", data }];
}
function scenes(document: VideoDocument): VideoScene[] { return [...document.scenes, ...(document.segments ?? []).flatMap((s) => s.scenes)]; }
function populate(document: VideoDocument): AssetManifest {
  document.settings.typography ??= { version: 1, defaults: { font: "arimo" } };
  document.seed = 3201; document.title = "История света / 光の物語";
  const manifest: AssetManifest = {};
  for (let i = 0; i < 4; i++) {
    const id = `art-${i}`; document.bindings[id] = { kind: "pool", assetId: id };
    manifest[id] = { id, kind: "image", src: `fixture:${id}`, width: 640, height: 800 };
  }
  document.bindings.tone = { kind: "pool", assetId: "tone" };
  manifest.tone = { id: "tone", kind: "audio", src: "fixture:tone", durationSec: 2, hasAudio: true };
  document.source.participants.forEach((p, i) => { p.label = ["Акира / 光", "Хару / 春", "Миса / 未来", "Рэн / 蓮"][i % 4]; if (document.kind === "board") p.label = ["光", "春", "蓮", "空"][i % 4];
    p.caption = document.kind === "board" ? undefined : "Музыка далёкого мира"; p.media = { visual: `art-${i % 4}`, audio: "tone" }; });
  for (const round of document.source.rounds) { round.prompt = "Кого выберешь / 誰を選ぶ？"; round.answer ??= { cardIds: [round.cards[0].id] }; }
  for (const scene of scenes(document)) if (scene.board) {
    scene.board.slots.forEach((slot, i) => { slot.label = `${i + 1} · Герои / 仲間`; });
    scene.board.rounds.forEach((round) => { round.prompt = "Распредели героев / 物語"; });
  }
  return manifest;
}
function semanticFrames(plan: CompiledVideo): VisualFixture["frames"] {
  const selected: VisualFixture["frames"] = [];
  const add = (frame: number, phase: VisualFixture["frames"][number]["phase"], reason: string) => {
    frame = Math.max(0, Math.min(plan.durationInFrames - 1, Math.round(frame)));
    if (!selected.some((f) => f.frame === frame && f.phase === phase && f.reason === reason)) selected.push({ frame, phase, reason });
  };
  for (const scene of plan.scenes) {
    add(scene.from, "before", `${scene.id}:start`);
    add(scene.from + Math.min(6, Math.floor((scene.durationInFrames) / 2)), "during", `${scene.id}:enter`);
    add(scene.from + scene.durationInFrames - 1, "after", `${scene.id}:end`);
    if (scene.transition) { add(scene.from + Math.floor(scene.transition.durationInFrames / 2), "during", `${scene.id}:transition`); add(scene.from + scene.transition.durationInFrames, "after", `${scene.id}:transition-end`); }
    for (const event of scene.boardEvents ?? []) {
      add(scene.from + event.frame - 1, "before", `${scene.id}:${event.event}`);
      add(scene.from + event.frame, "during", `${scene.id}:${event.event}`);
      add(scene.from + event.frame + 6, "after", `${scene.id}:${event.event}`);
    }
    for (const [name, value] of Object.entries(scene.phases)) if (value !== undefined) {
      add(scene.from + value - 1, "before", `${scene.id}:${name}`); add(scene.from + value, "during", `${scene.id}:${name}`); add(scene.from + value + 6, "after", `${scene.id}:${name}`);
    }
    for (const node of scene.nodes) for (const motion of node.motion ?? []) {
      add(scene.from + motion.from - 1, "before", `${node.id}:${motion.channel}`);
      add(scene.from + motion.from + Math.floor(motion.durationInFrames / 2), "during", `${node.id}:${motion.channel}`);
      add(scene.from + motion.from + motion.durationInFrames, "after", `${node.id}:${motion.channel}`);
    }
  }
  return selected;
}
function fixture(id: string, document: VideoDocument, coverage: VisualFixture["coverage"]): VisualFixture {
  document.id = `visual-${id}`;
  const manifest = populate(document), result = compileVideo(document, manifest);
  const errors = result.diagnostics.filter((d) => d.severity === "error" && d.code !== "TEXT_LAYOUT_REQUIRED");
  if (errors.length) throw new Error(`${id}: ${JSON.stringify(errors)}`);
  const available = semanticFrames(result.plan), selected = new Set<number>();
  const add = (frame: number | undefined) => { if (frame !== undefined && selected.size < 12) selected.add(frame); };
  // Fixtures protect representative rendering; storyboard pagination owns full scene coverage.
  add(0); add(result.plan.durationInFrames - 1);
  const event = available.find((f) => /board\.swap/.test(f.reason))
    ?? available.find((f) => /board\.place/.test(f.reason))
    ?? available.find((f) => /answerStartFrame/.test(f.reason))
    ?? available.find((f) => /:(enter|emphasis|loop|exit)$/.test(f.reason))
    ?? available.find((f) => f.reason.endsWith(":transition"));
  if (event) for (const phase of ["before", "during", "after"] as const) add(available.find((f) => f.reason === event.reason && f.phase === phase)?.frame);
  for (const phase of ["before", "during", "after"] as const) add(available.find((f) => f.phase === phase)?.frame);
  // The second scene exercises transition source/destination. A late overview protects summary.
  const second = result.plan.scenes[1];
  if (second) { add(second.from); add(Math.min(second.from + Math.floor(second.transition.durationInFrames / 2), result.plan.durationInFrames - 1)); add(second.from + Math.min(6, second.durationInFrames - 1)); }
  const last = result.plan.scenes.at(-1)!;
  add(last.from + Math.floor(last.durationInFrames / 2));
  const timeline = [...new Set(available.map((f) => f.frame))].sort((a, b) => a - b);
  for (const fraction of [0.25, 0.5, 0.75]) add(timeline[Math.floor((timeline.length - 1) * fraction)]);
  const selectedFrames = [...selected].sort((a, b) => a - b);
  return { id, document, manifest, coverage, frames: available.filter((f) => selected.has(f.frame)), sampling: { strategy: "representative-events-v1", sampled: timeline.length > selectedFrames.length, available, selected: selectedFrames } };
}
function base(kind: VideoDocument["kind"] = "picker", presetId?: string): VideoDocument {
  return createVideoDocument({ kind, ...(presetId ? { presetId } : {}), roundCount: kind === "top" ? undefined : 2, cardsPerRound: kind === "board" ? undefined : 3, ...(kind === "top" ? { participants: [1, 2, 3].map((rank) => ({ id: `p${rank}`, label: `Герой ${rank}`, rank })) } : {}) });
}
export function buildVisualFixtures(): VisualFixture[] {
  const fixtures = getBuiltinPresets().map((preset) => fixture(`preset.${preset.id}`, base(preset.kind, preset.id), preset.id.startsWith("recipe.") ? { recipes: [preset.id] } : { presets: [preset.id] }));
  for (const entry of motionCatalog.entries) {
    const kind = entry.category === "choreography" ? entry.blocks[0] === "custom" ? "picker" : entry.blocks[0] : "picker";
    const document = base(entry.name === "podium-finale" ? "top" : kind);
    if (entry.name === "versus-impact") document.source.rounds.forEach((r) => { r.cards = r.cards.slice(0, 2); });
    if (entry.name === "title-reveal") scenes(document).forEach((s) => s.nodes.push({ id: "title", type: "text", text: "История / 光", rect: { x: 0.1, y: 0.01, width: 0.8, height: 0.12 } }));
    if (entry.name === "board-swap") {
      const board = scenes(document)[0].board!;
      const first = board.rounds[0].cards[0], second = board.rounds[1].cards[0];
      board.rounds[1].actions.push({ id: "fixture-swap", type: "swap", cardId: first.id, otherCardId: second.id });
    }
    if (entry.category === "effect") {
      document.scenes = [{ id: "effect", block: "custom", duration: { sec: 4 }, nodes: [
        { id: "art", type: "image", asset: "art-0", rect: { x: 0.08, y: 0.08, width: 0.35, height: 0.8 } },
        { id: "motion-label", type: "text", text: entry.name === "text-counter" ? "3201" : "История света / 光の物語", rect: { x: 0.46, y: 0.3, width: 0.48, height: 0.3 }, motion: { [entry.channels[0]]: { name: entry.name as MotionName, duration: { sec: 0.8 }, at: { sec: 1 } } } },
      ] }];
      if (!entry.name.startsWith("text-")) document.scenes[0].nodes[0].motion = document.scenes[0].nodes[1].motion;
    } else if (entry.category === "choreography") document.settings.motion = { choreography: entry.name as ChoreographyName };
    else if (entry.category === "transition") document.scenes.forEach((scene) => { scene.transition = { type: entry.name as TransitionName, duration: { sec: 0.4 } }; });
    else if (entry.category === "backdrop") document.settings.backdrop = { preset: entry.name as BackdropSettings["preset"], source: "asset", asset: "art-0" };
    else {
      // Variant coverage is represented in actual nodes rather than just metadata.
      const variants = entry.variants ?? [undefined];
      document.scenes = [{ id: "widgets", block: "custom", duration: { sec: 4 }, nodes: variants.map((variant, i) => ({ id: `${entry.name}-${i}`, type: entry.name, ...(variant ? { variant } : {}), ...(entry.name === "badge" ? { kind: "label", text: "Герой / 光" } : {}), rect: { x: 0.04 + i * 0.24, y: 0.35, width: 0.2, height: 0.3 } } as VideoNode)) }];
    }
    fixtures.push(fixture(`motion.${entry.category}.${entry.name}`, document, { motion: [`${entry.category}:${entry.name}`] }));
  }
  for (const id of typographyExampleIds) for (const format of ["wide", "vertical", "square"] as const) fixtures.push(fixture(`typography.example.${id}.${format}`, createTypographyExample(id, { format }).document, { typographyExamples: [id] }));
  for (const style of typographyStyles) {
    const document = createTypographyExample("mixed-title").document;
    document.scenes[0].nodes[0].typography = { ...style.style, maxLines: 4 };
    fixtures.push(fixture(`typography.style.${style.id}`, document, { typographyStyles: [style.id] }));
  }
  for (const theme of typographyThemes) fixtures.push(fixture(`typography.theme.${theme.id}`, applyTypographyTheme(base(), theme.id), { typographyThemes: [theme.id] }));
  const boundary = createTypographyExample("mixed-title", { format: "vertical" }).document;
  boundary.scenes[0].nodes.push({ id: "edge-label", type: "text", text: "Очень длинное русское имя / 遥かなる未来の物語", rect: { x: 0.02, y: 0.82, width: 0.96, height: 0.14 }, typography: { fontSize: 30, maxLines: 4 } });
  fixtures.push(fixture("boundary.long-ru-jp", boundary, { cases: ["long-ru", "long-jp", "mixed", "edge"] }));
  const dense = createVideoDocument({ kind: "picker", format: "vertical", roundCount: 1, cardsPerRound: 8 });
  fixtures.push(fixture("boundary.dense-picker.vertical", dense, { cases: ["dense"] }));
  const empty = base("board");
  empty.source.participants = [];
  for (const scene of scenes(empty)) if (scene.board) { scene.board.requireAllAssigned = false; scene.board.rounds = [{ id: "empty", prompt: "Пустая доска / 空", cards: [], actions: [] }]; }
  fixtures.push(fixture("boundary.empty-board", empty, { cases: ["empty-board"] }));
  return fixtures;
}
export function visualFixtureCoverage(fixtures: VisualFixture[]) {
  const keys = ["presets", "recipes", "motion", "typographyExamples", "typographyStyles", "typographyThemes", "cases"] as const;
  return Object.fromEntries(keys.map((key) => [key, [...new Set(fixtures.flatMap((f) => f.coverage[key] ?? []))].sort()])) as Record<typeof keys[number], string[]>;
}
