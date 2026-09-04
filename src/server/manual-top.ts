import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const topItemsSchema = z.object({
  projectId: z.string().min(1),
  items: z.array(z.object({
    audioArtId: z.string().min(1),
    artId: z.string().nullable().optional(),
    customLabel: z.string().max(200).optional(),
  })).min(1).max(200),
  clipSec: z.number().finite().positive().max(600).default(30),
  order: z.enum(["desc", "asc"]).default("desc"),
  introText: z.string().max(200).optional(),
  outroText: z.string().max(200).optional(),
});

/** Replace a manual top atomically. Input order is rank 1 (best) through N. */
export async function setTopItems(userId: string, input: z.input<typeof topItemsSchema>) {
  const args = topItemsSchema.parse(input);
  const audioIds = args.items.map(i => i.audioArtId);
  if (new Set(audioIds).size !== audioIds.length) throw new Error("DUPLICATE_AUDIO");
  const ids = [...new Set(args.items.flatMap(i => [i.audioArtId, ...(i.artId ? [i.artId] : [])]))];

  return prisma.$transaction(async tx => {
    const project = await tx.videoProject.findFirst({
      where: { id: args.projectId, userId }, include: { renderConfig: true },
    });
    if (!project) throw new Error("NOT_FOUND");
    if (project.kind !== "top") throw new Error("NOT_TOP");
    if (!project.renderConfig) throw new Error("NO_CONFIG");
    const arts = await tx.art.findMany({ where: { id: { in: ids }, userId } });
    const byId = new Map(arts.map(a => [a.id, a]));
    for (const item of args.items) {
      const audio = byId.get(item.audioArtId);
      if (!audio || !["audio", "video"].includes(audio.kind) || !audio.hasAudio)
        throw new Error("NO_AUDIO_SOURCE");
      if (item.artId) {
        const visual = byId.get(item.artId);
        if (!visual || !["image", "video"].includes(visual.kind)) throw new Error("BAD_VISUAL");
      }
    }
    const configId = project.renderConfig.id;
    await tx.renderItem.deleteMany({ where: { renderConfigId: configId } });
    for (const [index, item] of args.items.entries()) {
      await tx.renderItem.create({ data: {
        renderConfigId: configId, rank: index + 1, audioArtId: item.audioArtId,
        artId: item.artId ?? null, customLabel: item.customLabel ?? null,
        clipMode: "active_snippet", snippetLenSec: args.clipSec, audioSource: "track",
      } });
    }
    await tx.renderConfig.update({ where: { id: configId }, data: {
      order: args.order, defaultClipSec: args.clipSec,
      ...(args.introText !== undefined ? { introText: args.introText, introEnabled: !!args.introText.trim() } : {}),
      ...(args.outroText !== undefined ? { outroText: args.outroText, outroEnabled: !!args.outroText.trim() } : {}),
    } });
    await tx.art.updateMany({ where: { id: { in: ids }, userId }, data: { lastUsedAt: new Date() } });
    await tx.videoProject.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    return { projectId: project.id, itemCount: args.items.length };
  }, { timeout: 15000 });
}
