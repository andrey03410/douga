import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  extractVideoPreset,
  parseVideoDocument,
  getBuiltinPresets,
} from "@/video";
import { actor, replay, receipt, requestHash, jsonText } from "./shared";
import { StudioError } from "./errors";
import {
  saveStudioPresetSchema,
  type SaveStudioPresetInput,
  type StudioPresetView,
  deleteStudioResourceSchema,
  type DeleteStudioResourceInput,
} from "./types";
export async function listStudioPresets(
  userId: string,
): Promise<StudioPresetView[]> {
  await actor(userId);
  const rows = await prisma.studioPreset.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return [
    ...getBuiltinPresets(),
    ...rows.map((p) => ({ ...JSON.parse(p.presetJson), personal: true })),
  ];
}
export async function saveStudioPreset(
  userId: string,
  raw: SaveStudioPresetInput,
): Promise<StudioPresetView> {
  const input = saveStudioPresetSchema.parse(raw);
  jsonText(input.document);
  await actor(userId);
  const request = requestHash("preset", input);
  const old = await replay<StudioPresetView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  const id = randomUUID();
  const preset = extractVideoPreset(parseVideoDocument(input.document), {
    id,
    name: input.name,
  });
  return prisma.$transaction(async (db) => {
    await actor(userId, db);
    const old = await replay<StudioPresetView>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    await db.studioPreset.create({
      data: {
        id,
        userId,
        name: input.name,
        presetJson: JSON.stringify(preset),
      },
    });
    const result = { ...preset, personal: true };
    await receipt(db, userId, input.idempotencyKey, request, result);
    return result;
  });
}
export async function deleteStudioPreset(
  userId: string,
  id: string,
  raw: DeleteStudioResourceInput = {},
) {
  const input = deleteStudioResourceSchema.parse(raw);
  await actor(userId);
  const request = requestHash(`delete-preset:${id}`, input);
  return prisma.$transaction(async (db) => {
    await actor(userId, db);
    const old = await replay<{ deleted: true; id: string }>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    const row = await db.studioPreset.findFirst({ where: { id, userId } });
    if (!row) throw new StudioError("NOT_FOUND");
    await db.studioPreset.delete({ where: { id } });
    const result = { deleted: true as const, id };
    await receipt(db, userId, input.idempotencyKey, request, result);
    return result;
  });
}
