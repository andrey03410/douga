import { access } from "node:fs/promises";
import { absPath } from "@/lib/storage";
import { buildPreviewPlan, getProjectRenderConfig, resolveActiveSnippetsFor } from "@/server/render";

/** Read the actual render config, including cached RMS windows and missing assets. */
export async function topSummary(userId: string, projectId: string) {
  let config = await getProjectRenderConfig(userId, projectId);
  if (!config) throw new Error("NO_CONFIG");
  await resolveActiveSnippetsFor(config);
  config = await getProjectRenderConfig(userId, projectId);
  if (!config) throw new Error("NO_CONFIG");
  const plan = buildPreviewPlan(config);
  const warnings: string[] = [];
  if (!config.items.length) warnings.push("EMPTY_TOP");
  const files = new Map<string, boolean>();
  for (const item of config.items) {
    for (const asset of [item.audioArt, item.art]) {
      if (asset && !files.has(asset.filePath)) {
        files.set(asset.filePath, await access(absPath(asset.filePath)).then(() => true, () => false));
      }
      if (asset && !files.get(asset.filePath)) warnings.push(`MISSING_FILE:rank=${item.rank}:art=${asset.id}`);
    }
    if (item.clipMode === "active_snippet" && item.resolvedStartSec === null)
      warnings.push(`UNRESOLVED_SNIPPET:rank=${item.rank}`);
  }
  return {
    order: config.order, intro: config.introEnabled ? config.introText : null,
    outro: config.outroEnabled ? config.outroText : null,
    durationSec: plan.durationInFrames / plan.fps,
    readyToRender: warnings.length === 0, warnings,
    items: config.items.map(item => {
      const segment = plan.segments.find(s => s.rank === item.rank)!;
      return {
        id: item.id, rank: item.rank, label: segment.label,
        audioArtId: item.audioArtId, artId: item.artId,
        clipMode: item.clipMode, clipStartSec: segment.clipStartSec, clipSec: segment.clipSec,
        timelineStartSec: segment.startFrame / plan.fps,
      };
    }),
  };
}
