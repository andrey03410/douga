import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video/builders";
import { getVideoRecipe, getVideoRecipes } from "@/video/recipes";
import {
  createStudioProject,
  deleteStudioProject,
  saveStudioDraft,
  applyStudioPreset,
} from "./projects";
import { hash } from "./shared";
import * as sources from "./sources";
const baseline = vi.hoisted(() => ({
  manifest: null as string | null,
  files: new Map<string, Buffer>(),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const file = String(args[0]);
      if (file.includes("32-storyboard-reference/baselines/")) {
        if (file.endsWith("manifest.json") && baseline.manifest !== null)
          return baseline.manifest;
        const bytes = baseline.files.get(file);
        if (bytes) return bytes;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return actual.readFile(...args);
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      const file = String(args[0]);
      if (file.includes("32-storyboard-reference/baselines")) return file;
      return actual.realpath(...args);
    },
  };
});
import {
  getStudioRecipeMedia,
  getStudioRecipePlan,
  getStudioRecipePreview,
  tryStudioRecipe,
} from "./recipe-preview";
let owner: string,
  other: string,
  projectId: string,
  customId: string,
  png: Buffer;
const extraProjects: string[] = [];
const recipeId = "recipe.clean.top.wide";
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: {
        email: `recipe-preview-${randomUUID()}@test.local`,
        role: "admin",
        passwordHash: "x",
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        email: `recipe-preview-other-${randomUUID()}@test.local`,
        role: "user",
        passwordHash: "x",
      },
    })
  ).id;
  await mkdir(absPath(`studio/${owner}`), { recursive: true });
  const file = absPath(`studio/${owner}/preview.png`);
  await promisify(execFile)(ffmpeg!, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64",
    "-frames:v",
    "1",
    file,
  ]);
  png = await readFile(file);
  const art = await prisma.art.create({
    data: {
      userId: owner,
      kind: "image",
      filePath: `studio/${owner}/preview.png`,
    },
  });
  const document = createVideoDocument({
    kind: "top",
    participants: [
      { id: "p", label: "Свой герой", rank: 1, media: { visual: "my-art" } },
    ],
  });
  document.bindings["my-art"] = { kind: "pool", assetId: art.id };
  projectId = (await createStudioProject(owner, { document })).id;
  const custom = structuredClone(document);
  custom.scenes = [
    {
      id: "custom",
      block: "custom",
      duration: { sec: 1 },
      nodes: [{ id: "owned-image", type: "image", asset: "my-art" }],
    },
  ];
  customId = (await createStudioProject(owner, { document: custom })).id;
});
afterAll(async () => {
  for (const project of [projectId, customId, ...extraProjects])
    if (project) await deleteStudioProject(owner, project);
  for (const userId of [owner, other])
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
      await removePath(`studio/${userId}`);
    }
});
beforeEach(() => {
  baseline.manifest = null;
  baseline.files.clear();
});
it("builds playable plans with authenticated, content-addressed synthetic media", async () => {
  for (const recipe of getVideoRecipes()) {
    const result = await getStudioRecipePlan(owner, recipe.id);
    expect(result.ready, recipe.id + JSON.stringify(result.diagnostics)).toBe(
      true,
    );
    expect(result.recipeId).toBe(recipe.id);
    expect(result.plan.scenes.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("fixture:");
    expect(serialized).toContain("/api/studio/recipes/media/");
  }
});
it("serves only the allowlisted fixture names with verified bytes and actor permission", async () => {
  const result = await getStudioRecipePlan(owner, recipeId);
  const match = /\/api\/studio\/recipes\/media\/([a-f0-9]{64}\.svg)/.exec(
    JSON.stringify(result.plan),
  );
  expect(match).not.toBeNull();
  const media = await getStudioRecipeMedia(owner, match![1]);
  expect(media.mimeType).toBe("image/svg+xml");
  expect(hash(await readFile(media.path))).toBe(media.hash);
  expect(path.basename(media.path)).toBe(`${media.hash}.svg`);
  await expect(
    getStudioRecipeMedia(owner, "../preview.png"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    getStudioRecipeMedia(owner, `${"f".repeat(64)}.svg`),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    getStudioRecipeMedia("unknown", match![1]),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getStudioRecipePlan("unknown", recipeId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("tries a compatible recipe on owned media without changing project, draft or source", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: projectId },
  });
  const spy = vi.spyOn(sources, "reconcileSource");
  const result = await tryStudioRecipe(owner, "recipe.neon.top.vertical", {
    projectId,
    expectedVersion: before.version,
  });
  expect(result.ready).toBe(true);
  expect(result.origin.version).toBe(before.version);
  expect(result.plan.width).toBe(1080);
  expect(JSON.stringify(result.plan)).toContain("Свой герой");
  expect(JSON.stringify(result.plan)).toContain("/api/arts/");
  expect(
    await prisma.studioProject.findUniqueOrThrow({ where: { id: projectId } }),
  ).toEqual(before);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  await expect(
    tryStudioRecipe(other, recipeId, {
      projectId,
      expectedVersion: before.version,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    tryStudioRecipe(owner, recipeId, {
      projectId,
      expectedVersion: before.version + 1,
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    tryStudioRecipe(owner, "recipe.clean.picker.wide", {
      projectId,
      expectedVersion: before.version,
    }),
  ).rejects.toMatchObject({ code: "PRESET_KIND_MISMATCH" });
});
it("preserves assigned custom structure in recipe try-on instead of resetting media", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: customId },
  });
  for (const mode of ["preserve", "replace"] as const) {
    const preview = await tryStudioRecipe(owner, recipeId, {
      projectId: customId,
      expectedVersion: before.version,
      mode,
    });
    expect(preview.ready).toBe(true);
    expect(JSON.stringify(preview.plan)).toContain("/api/arts/");
    expect(preview.plan.scenes[0].id).toBe("custom");
  }
  expect(
    await prisma.studioProject.findUniqueOrThrow({ where: { id: customId } }),
  ).toEqual(before);
});

it("never substitutes last-good media for an invalid current draft", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: projectId },
  });
  const saved = await saveStudioDraft(owner, projectId, {
    expectedVersion: before.version,
    text: "{invalid",
  });
  await expect(
    tryStudioRecipe(owner, recipeId, {
      projectId,
      expectedVersion: saved.version,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
it("returns a verified accepted baseline descriptor and declines missing or untrusted paths/hashes", async () => {
  await expect(getStudioRecipePreview(owner, recipeId)).rejects.toMatchObject({
    code: "PREVIEW_NOT_READY",
  });
  const fixtureId = `preset.${recipeId}`,
    filename = `frames/${fixtureId}/60.png`;
  const record = {
    fixtureId,
    frame: 60,
    file: filename,
    pngHash: hash(png),
    width: 64,
    height: 64,
  };
  baseline.manifest = JSON.stringify({
    version: 1,
    accepted: { reason: "test", at: "2026-11-06" },
    frames: [record],
  });
  baseline.files.set(
    path.resolve(".ai/features/32-storyboard-reference/baselines", filename),
    png,
  );
  const preview = await getStudioRecipePreview(owner, recipeId);
  expect(preview.hash).toBe(hash(png));
  expect(preview.mimeType).toBe("image/png");
  expect(preview.frame).toBe(60);
  baseline.manifest = JSON.stringify({
    version: 1,
    accepted: { reason: "test", at: "2026-11-06" },
    frames: [{ ...record, file: "../secret.png" }],
  });
  await expect(getStudioRecipePreview(owner, recipeId)).rejects.toMatchObject({
    code: "PREVIEW_NOT_READY",
  });
  baseline.manifest = JSON.stringify({
    version: 1,
    accepted: { reason: "test", at: "2026-11-06" },
    frames: [{ ...record, pngHash: "0".repeat(64) }],
  });
  await expect(getStudioRecipePreview(owner, recipeId)).rejects.toMatchObject({
    code: "PREVIEW_NOT_READY",
  });
});

it("uses the same preserving recipe application for try-on and atomic writes", async () => {
  const original = await prisma.studioProject.findUniqueOrThrow({
    where: { id: customId },
  });
  const ownBinding = JSON.parse(original.documentJson).bindings["my-art"];
  const base = getVideoRecipe("recipe.clean.top.wide")!.preset;
  const document = createVideoDocument({
    kind: "top",
    preset: base,
    participants: [
      { id: "p", label: "Свой герой", rank: 1, media: { visual: "my-art" } },
    ],
  });
  document.bindings["my-art"] = ownBinding;
  document.settings.top!.durationSec = 13;
  document.scenes[0].settings = { card: { borderRadius: 77 } };
  document.scenes.unshift({
    id: "intro",
    block: "custom",
    duration: { sec: 4 },
    nodes: [
      {
        id: "intro-title",
        type: "text",
        text: "Авторское вступление",
        rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 },
        typography: { role: "label", font: "rubik" },
      },
    ],
  });
  const created = await createStudioProject(owner, { document });
  extraProjects.push(created.id);
  const target = "recipe.cinematic.top.wide";
  const preview = await tryStudioRecipe(owner, target, {
    projectId: created.id,
    expectedVersion: created.version,
  });
  expect(preview.plan.durationInFrames).toBe(510);
  const applied = await applyStudioPreset(owner, created.id, {
    presetId: target,
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
  });
  expect(applied.plan).toEqual(preview.plan);
  const changed = applied.draft!.document as typeof document;
  expect(changed.scenes.map((scene) => scene.id)).toEqual(["intro", "main"]);
  expect(changed.scenes[1].settings!.card!.borderRadius).toBe(77);
  expect(changed.settings.typography!.theme).toBe("cinematic");
  const replacePreview = await tryStudioRecipe(owner, target, {
    projectId: created.id,
    expectedVersion: applied.version,
    mode: "replace",
  });
  const replaced = await applyStudioPreset(owner, created.id, {
    presetId: target,
    expectedVersion: applied.version,
    mode: "replace",
  });
  expect(replaced.plan).toEqual(replacePreview.plan);
  expect(replaced.plan!.durationInFrames).toBe(510);
  const replacedDoc = replaced.draft!.document as typeof document;
  expect(replacedDoc.scenes.map((scene) => scene.id)).toEqual([
    "intro",
    "main",
  ]);
  expect(replacedDoc.scenes[1].settings?.card?.borderRadius).toBeUndefined();
  expect(replacedDoc.source).toEqual(document.source);
  expect(replacedDoc.bindings).toEqual(document.bindings);
  await expect(
    applyStudioPreset(owner, created.id, {
      presetId: "top.cinematic.wide",
      expectedVersion: replaced.version,
      mode: "preserve",
    }),
  ).rejects.toMatchObject({ code: "PRESET_MODE_UNSUPPORTED" });
  expect(
    (
      await prisma.studioProject.findUniqueOrThrow({
        where: { id: created.id },
      })
    ).version,
  ).toBe(replaced.version);
  const legacy = await applyStudioPreset(owner, created.id, {
    presetId: "top.cinematic.wide",
    expectedVersion: replaced.version,
  });
  expect(
    (legacy.draft!.document as typeof document).scenes.map((scene) => scene.id),
  ).toEqual(["main"]);
  expect(legacy.plan!.durationInFrames).toBe(240);
});
