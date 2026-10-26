import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { CompiledScene, CompiledVideo } from "@/video";
import { getStudioProject } from "./projects";
import { studioPageSchema } from "./queries";
import { StudioError } from "./errors";

export const studioTimelineSchema = studioPageSchema.extend({
  // Generated IDs contain percent-encoded template + stable source identity.
  cursor: z.string().min(1).max(4096).optional(),
  revision: z.number().int().positive().optional(),
});
export type StudioTimelineInput = z.input<typeof studioTimelineSchema>;

/** Inspection points come only from existing IR intervals/keyframes. No authoring
 * settings, timeline expansion, layout, asset resolution or compiler lives here. */
function sceneSummary(scene: CompiledScene) {
  const frames = new Set<number>();
  const end = scene.from + scene.durationInFrames;
  const add = (frame: number) => {
    if (frame >= scene.from && frame < end) frames.add(frame);
  };
  add(scene.from);
  add(end - 1);
  for (const frame of Object.values(scene.phases)) {
    add(scene.from + frame);
    add(scene.from + frame - 1);
  }
  if (scene.transition.durationInFrames)
    add(scene.from + scene.transition.durationInFrames - 1);
  for (const node of scene.nodes) {
    add(scene.from + node.from);
    add(scene.from + node.from + node.durationInFrames - 1);
    if (node.answerFrom !== undefined) add(scene.from + node.answerFrom);
    for (const window of [
      ...node.visible,
      ...(node.labelWindows ?? []),
      ...(node.activeWindow ? [node.activeWindow] : []),
    ]) {
      add(scene.from + window.from);
      add(scene.from + window.to - 1);
    }
    for (const animation of node.animation)
      for (const keyframe of animation.keyframes)
        add(scene.from + node.from + keyframe.frame);
  }
  return {
    id: scene.id,
    kind: scene.kind,
    from: scene.from,
    to: end,
    durationInFrames: scene.durationInFrames,
    participantId: scene.participantId ?? null,
    roundId: scene.roundId ?? null,
    phases: Object.fromEntries(
      Object.entries(scene.phases).map(([name, frame]) => [
        name,
        scene.from + frame,
      ]),
    ),
    recommendedFrames: [...frames].sort((a, b) => a - b),
  };
}

export async function getStudioTimeline(
  userId: string,
  projectId: string,
  raw: StudioTimelineInput = {},
) {
  const input = studioTimelineSchema.parse(raw);
  const current = await getStudioProject(userId, projectId);
  let plan = current.plan;
  if (input.revision) {
    const saved = await prisma.studioRevision.findFirst({
      where: { projectId, revision: input.revision },
      select: { planJson: true },
    });
    if (!saved) throw new StudioError("NOT_FOUND");
    plan = saved.planJson
      ? (JSON.parse(saved.planJson) as CompiledVideo)
      : null;
  }
  const index =
    input.cursor && plan
      ? plan.scenes.findIndex((scene) => scene.id === input.cursor)
      : -1;
  if (input.cursor && index === -1) throw new StudioError("NOT_FOUND");
  const items =
    plan?.scenes.slice(index + 1, index + 1 + input.limit).map(sceneSummary) ??
    [];
  return {
    projectId,
    version: current.version,
    revision: current.revision,
    available: plan !== null,
    stale: input.revision ? false : current.previewStale,
    previewStale: current.previewStale,
    origin: input.revision
      ? { kind: "revision" as const, revision: input.revision, version: null }
      : {
          kind: "preview" as const,
          revision: current.previewRevision,
          version: current.previewVersion,
        },
    fps: plan?.fps ?? null,
    width: plan?.width ?? null,
    height: plan?.height ?? null,
    durationInFrames: plan?.durationInFrames ?? null,
    frameConvention:
      "composition-absolute, zero-based; intervals [from,to); recommendedFrames are valid still frame indices from existing phase/visibility/active/animation boundaries",
    items,
    nextCursor:
      plan && index + 1 + input.limit < plan.scenes.length
        ? items.at(-1)!.id
        : null,
  };
}
