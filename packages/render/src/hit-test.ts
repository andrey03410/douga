import type { ChoiceHit, CompiledNode, CompiledVideo, Rect } from "@douga/video";
import { evaluateNode } from "./studio-frame";

/** Nodes fainter than this are not pressable: they are leaving or not there yet. */
const MIN_OPACITY = 0.05;

function sceneAt(plan: CompiledVideo, frame: number) {
  return plan.scenes.find((s) => frame >= s.from && frame < s.from + s.durationInFrames);
}

/**
 * The on-screen box of a node at a scene-local frame, in composition pixels: the
 * authored rect, moved by its own and its ancestors' offsets and scaled around its
 * centre. Rotation is ignored: a pressable card is upright in every preset.
 */
function boxAt(node: CompiledNode, nodes: Map<string, CompiledNode>, frame: number, fps: number): Rect | null {
  const own = evaluateNode(node, frame, fps);
  if (!own.visible || own.opacity < MIN_OPACITY) return null;
  let dx = own.x;
  let dy = own.y;
  let scale = own.scale * (own.scaleX ?? 1);
  let opacity = own.opacity;
  for (let parent = node.parentId ? nodes.get(node.parentId) : undefined; parent; parent = parent.parentId ? nodes.get(parent.parentId) : undefined) {
    const state = evaluateNode(parent, frame, fps);
    if (!state.visible) return null;
    dx += state.x;
    dy += state.y;
    scale *= state.scale;
    opacity *= state.opacity;
  }
  if (opacity < MIN_OPACITY) return null;
  const width = node.rect.width * scale;
  const height = node.rect.height * scale * ((own.scaleY ?? 1) / (own.scaleX ?? 1));
  return {
    x: node.rect.x + dx + (node.rect.width - width) / 2,
    y: node.rect.y + dy + (node.rect.height - height) / 2,
    width,
    height,
  };
}

/** Pressable boxes of the frame (plan-absolute), top layer first. */
export function choiceRects(plan: CompiledVideo, frame: number): (ChoiceHit & { rect: Rect; layer: number })[] {
  const scene = sceneAt(plan, frame);
  const facts = scene && plan.interaction?.scenes.find((s) => s.id === scene.id);
  if (!scene || !facts) return [];
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  const local = frame - scene.from;
  const out: (ChoiceHit & { rect: Rect; layer: number })[] = [];
  for (const choice of facts.choices) {
    const node = nodes.get(choice.nodeId);
    if (!node) continue;
    const rect = boxAt(node, nodes, local, plan.fps);
    if (!rect) continue;
    out.push({
      choiceId: choice.choiceId,
      nodeId: choice.nodeId,
      ...(choice.cardId ? { cardId: choice.cardId } : {}),
      ...(choice.participantId ? { participantId: choice.participantId } : {}),
      rect,
      layer: node.layer,
    });
  }
  return out.sort((a, b) => b.layer - a.layer);
}

/** The pressable card under a point in composition pixels, or null. */
export function hitTest(plan: CompiledVideo, frame: number, point: { x: number; y: number }): ChoiceHit | null {
  const hit = choiceRects(plan, frame).find(
    ({ rect }) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height,
  );
  if (!hit) return null;
  const { rect: _rect, layer: _layer, ...choice } = hit;
  return choice;
}
