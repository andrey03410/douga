import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createVideoDocument,
  getBuiltinPresets,
  videoPresetSchema,
} from "@/video";
import { actor } from "./shared";
import { reconcileSource } from "./sources";
import { StudioError } from "./errors";
import type { StudioProjectView, StudioValidation } from "./types";

export const studioPageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
export type StudioPageInput = z.input<typeof studioPageSchema>;
export const validationCounts = (v: StudioValidation) => ({
  ready: v.ready,
  errors: v.diagnostics.filter((d) => d.severity === "error").length,
  warnings: v.diagnostics.filter((d) => d.severity === "warning").length,
});
export function studioProjectMetadata(p: StudioProjectView) {
  return {
    id: p.id,
    kind: p.kind,
    version: p.version,
    revision: p.revision,
    validation: validationCounts(p.validation),
    hasDraft: p.draft !== null,
    previewStale: p.previewStale,
    previewRevision: p.previewRevision,
    previewVersion: p.previewVersion,
    sourceVersion: p.sourceVersion,
  };
}
/** Bounded SQL projection: listing never deserializes documents, plans or draft text.
 * Source synchronization happens on individual get/write, not during a catalog query. */
export async function listStudioProjectSummaries(
  userId: string,
  input: StudioPageInput = {},
) {
  await actor(userId);
  const { limit, cursor } = studioPageSchema.parse(input);
  if (
    cursor &&
    !(await prisma.studioProject.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    }))
  )
    throw new StudioError("NOT_FOUND");
  const rows = await prisma.studioProject.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      kind: true,
      version: true,
      revision: true,
      previewVersion: true,
      previewRevision: true,
      sourceVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    items: rows
      .slice(0, limit)
      .map((p) => ({ ...p, previewStale: p.previewVersion !== p.version })),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function listStudioHistorySummaries(
  userId: string,
  projectId: string,
  input: StudioPageInput = {},
) {
  await actor(userId);
  if (
    !(await prisma.studioProject.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    }))
  )
    throw new StudioError("NOT_FOUND");
  const { limit, cursor } = studioPageSchema.parse(input);
  if (
    cursor &&
    !(await prisma.studioRevision.findFirst({
      where: { id: cursor, projectId },
      select: { id: true },
    }))
  )
    throw new StudioError("NOT_FOUND");
  const rows = await prisma.studioRevision.findMany({
    where: { projectId },
    orderBy: { revision: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      revision: true,
      reason: true,
      sourceVersion: true,
      createdAt: true,
    },
  });
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function listStudioSources(
  userId: string,
  input: StudioPageInput = {},
) {
  await actor(userId);
  const { limit, cursor } = studioPageSchema.parse(input);
  if (
    cursor &&
    !(await prisma.tournament.findFirst({ where: { id: cursor, userId } }))
  )
    throw new StudioError("NOT_FOUND");
  const rows = await prisma.tournament.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      topSize: true,
      _count: { select: { rankings: true, tracks: true } },
    },
  });
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
/** Reuse the authoritative source adapter; never reimplement its ranking/fingerprint. */
export async function getStudioSource(
  userId: string,
  sourceId: string,
  input: StudioPageInput = {},
) {
  await actor(userId);
  const { limit, cursor } = studioPageSchema.parse(input);
  const document = createVideoDocument({ kind: "top", participants: [] });
  document.source = {
    kind: "tournament",
    tournamentId: sourceId,
    participants: [],
    rounds: [],
  };
  const resolved = await reconcileSource(userId, document);
  const index = cursor
    ? resolved.source.participants.findIndex((p) => p.id === cursor)
    : -1;
  if (cursor && index === -1) throw new StudioError("NOT_FOUND");
  const items = resolved.source.participants.slice(
    index + 1,
    index + 1 + limit,
  );
  return {
    sourceId,
    version: resolved.source.version,
    items,
    bindings: Object.fromEntries(
      items.flatMap((p) =>
        Object.values(p.media ?? {}).map((key) => [
          key,
          resolved.bindings[key],
        ]),
      ),
    ),
    nextCursor:
      index + 1 + limit < resolved.source.participants.length
        ? items.at(-1)!.id
        : null,
  };
}
export async function listStudioPresetSummaries(
  userId: string,
  input: StudioPageInput = {},
) {
  await actor(userId);
  const { limit, cursor } = studioPageSchema.parse(input);
  const builtins = getBuiltinPresets().map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    version: p.version,
    output: p.output,
    personal: false,
  }));
  const builtinIndex = cursor ? builtins.findIndex((p) => p.id === cursor) : -1;
  if (
    cursor &&
    builtinIndex === -1 &&
    !(await prisma.studioPreset.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    }))
  )
    throw new StudioError("NOT_FOUND");
  const initial =
    !cursor || builtinIndex >= 0
      ? builtins.slice(builtinIndex + 1, builtinIndex + 1 + limit + 1)
      : [];
  const remaining = limit + 1 - initial.length;
  const personal =
    remaining > 0
      ? await prisma.studioPreset.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: remaining,
          ...(cursor && builtinIndex === -1
            ? { cursor: { id: cursor }, skip: 1 }
            : {}),
          select: { id: true, name: true },
        })
      : [];
  const rows = [...initial, ...personal.map((p) => ({ ...p, personal: true }))];
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function getStudioPreset(userId: string, id: string) {
  await actor(userId);
  const builtin = getBuiltinPresets().find((p) => p.id === id);
  if (builtin) return builtin;
  const row = await prisma.studioPreset.findFirst({
    where: { userId, id },
    select: { presetJson: true },
  });
  if (!row) throw new StudioError("NOT_FOUND");
  // Catalog-only metadata never enters the strict canonical preset schema.
  return videoPresetSchema.parse(JSON.parse(row.presetJson));
}
