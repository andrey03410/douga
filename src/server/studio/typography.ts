import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import {
  compileVideo,
  createVideoDocument,
  videoDocumentSchema,
  type CompiledVideo,
} from "@/video";
import {
  fontIds,
  typographyStyleIds,
  typographyThemeIds,
} from "@/video/typography-types";
import { actor, owned } from "./shared";
import { evaluate, runtime } from "./assets";
import { view, applyStudioTypographyDraft } from "./projects";
import { StudioError } from "./errors";
import { getTypographyMeasureText } from "./typography-fonts";
import { prepareStudioEngine, runStudioChild } from "./engine";
import type { StudioFrozenRevision } from "./types";

const key = z.string().min(1).max(200);
export const inspectStudioTextSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    segmentId: key.optional(),
    nodeId: key.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    lineLimit: z.number().int().min(1).max(12).default(8),
    lineOffset: z.number().int().min(0).max(10000).default(0),
    runOffset: z.number().int().min(0).max(100).default(0),
    cursor: z
      .string()
      .regex(/^\d{1,9}$/)
      .optional(),
    preview: z.boolean().default(false),
    frame: z.number().int().min(0).max(216000).default(0),
  })
  .strict();
export type InspectStudioTextInput = z.input<typeof inspectStudioTextSchema>;
export const typographyPreviewSchema = z
  .object({
    text: z.string().max(10000).default("残酷な天使のテーゼ — Любимые OST"),
    theme: z.enum(typographyThemeIds).default("clean"),
    preset: z.enum(typographyStyleIds).optional(),
    font: z.enum(fontIds).optional(),
    format: z.enum(["wide", "vertical", "square"]).default("wide"),
    width: z.number().min(0.2).max(0.96).default(0.84),
    height: z.number().min(0.08).max(0.7).default(0.3),
    background: z.enum(["dark", "light", "busy"]).default("dark"),
    sample: z.enum(["theme", "text"]).default("theme"),
  })
  .strict();

export async function previewStudioTypography(
  userId: string,
  raw: z.input<typeof typographyPreviewSchema>,
) {
  await actor(userId);
  const input = typographyPreviewSchema.parse(raw);
  const document = createVideoDocument({
    kind: "picker",
    title: "Примерка типографики",
  });
  document.source = { kind: "manual", participants: [], rounds: [] };
  document.bindings = {};
  document.output.format = input.format;
  document.settings = {
    typography: { theme: input.theme, version: 1 },
    background: input.background === "light" ? "#e8edf5" : "#101522",
  };
  document.scenes = [
    {
      id: "typography-preview",
      block: "custom",
      duration: { sec: 4 },
      nodes: [
        ...(input.background === "busy"
          ? [0, 1, 2, 3].map((i) => ({
              id: `art-${i}`,
              type: "shape" as const,
              shape: "ellipse" as const,
              fill: ["#6939a1", "#1e6584", "#843f57", "#af7541"][i],
              rect: {
                x: i * 0.25 - 0.1,
                y: i % 2 ? 0.3 : -0.2,
                width: 0.55,
                height: 0.9,
              },
            }))
          : []),
        {
          id: "sample-title",
          type: "text",
          text: input.text,
          rect: {
            x: (1 - input.width) / 2,
            y: 0.1,
            width: input.width,
            height: input.height,
          },
          typography: {
            role: "title",
            ...(input.font ? { font: input.font } : {}),
            ...(input.preset ? { preset: input.preset } : {}),
          },
        },
        ...(input.sample === "theme"
          ? [
              {
                id: "sample-subtitle",
                type: "text" as const,
                text: "サウンドトラック / Название и настроение",
                rect: { x: 0.08, y: 0.46, width: 0.84, height: 0.13 },
                typography: { role: "subtitle" as const },
              },
              {
                id: "sample-rank",
                type: "text" as const,
                text: "#1",
                rect: { x: 0.08, y: 0.68, width: 0.22, height: 0.17 },
                typography: { role: "rank" as const },
              },
              {
                id: "sample-badge",
                type: "text" as const,
                text: "選んで · Выбери",
                rect: { x: 0.33, y: 0.68, width: 0.4, height: 0.17 },
                typography: { role: "badge" as const },
              },
              {
                id: "sample-timer",
                type: "timer" as const,
                duration: { sec: 4 },
                rect: { x: 0.76, y: 0.68, width: 0.16, height: 0.17 },
                typography: { role: "timer" as const },
              },
            ]
          : []),
      ],
    },
  ];
  const parsed = videoDocumentSchema.parse(document);
  const result = compileVideo(
    parsed,
    {},
    { measureText: await getTypographyMeasureText() },
  );
  return {
    ...result,
    document: parsed,
    fragment: {
      settings: parsed.settings,
      typography: parsed.scenes[0].nodes.find((n) => n.id === "sample-title")
        ?.typography,
    },
  };
}

export const applyStudioTypographySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    theme: z.enum(typographyThemeIds),
    scope: z
      .union([
        z.object({ type: z.literal("document") }).strict(),
        z
          .object({ type: z.enum(["segment", "scene", "node"]), id: key })
          .strict(),
      ])
      .default({ type: "document" }),
    mode: z.enum(["preserve", "replace"]).default("preserve"),
    idempotencyKey: key.optional(),
  })
  .strict();
export async function applyStudioTypography(
  userId: string,
  projectId: string,
  raw: z.input<typeof applyStudioTypographySchema>,
) {
  const input = applyStudioTypographySchema.parse(raw);
  return applyStudioTypographyDraft(userId, projectId, input);
}

/** Own live draft is evaluated without saving or committing it. */
export async function inspectStudioText(
  userId: string,
  projectId: string,
  raw: InspectStudioTextInput = {},
) {
  const input = inspectStudioTextSchema.parse(raw);
  await actor(userId);
  const project = await view(await owned(userId, projectId));
  if (
    input.expectedVersion !== undefined &&
    project.version !== input.expectedVersion
  )
    throw new StudioError("VERSION_CONFLICT");
  const result = await evaluate(
    userId,
    project.draft ? project.draft.document : project.document,
  );
  const errors = result.validation.diagnostics.filter(
    (d) => d.severity === "error",
  );
  if (
    input.preview &&
    (errors.some((d) => d.code !== "TEXT_OVERFLOW") || !result.plan)
  )
    throw new StudioError("VALIDATION_FAILED", result.validation.diagnostics);
  const entries = (result.plan?.scenes ?? []).flatMap((scene) =>
    scene.nodes
      .filter(
        (node) =>
          node.textLayout &&
          (!input.segmentId || scene.segmentId === input.segmentId) &&
          (!input.nodeId || node.id === input.nodeId),
      )
      .map((node) => ({
        nodeId: node.id,
        sceneId: scene.id,
        segmentId: scene.segmentId,
        text: node.text ?? node.label ?? "",
        typography: node.typography,
        layout: node.textLayout,
        diagnostics: result.validation.diagnostics.filter(
          (d) => d.nodeId === node.id,
        ),
      })),
  );
  const offset = Number(input.cursor ?? 0);
  if (offset > entries.length) throw new StudioError("NOT_FOUND");
  let lineBudget = 100,
    runBudget = 200;
  const excerpt = (value: string, count = 240) =>
    Array.from(value).slice(0, count).join("");
  const items = entries.slice(offset, offset + input.limit).map((entry) => {
    const layout = entry.layout!;
    const selectedLines = layout.lines.slice(
      input.lineOffset,
      input.lineOffset + Math.min(input.lineLimit, lineBudget),
    );
    lineBudget -= selectedLines.length;
    const lines = selectedLines.map((line) => {
      const runs = line.runs.slice(
        input.runOffset,
        input.runOffset + Math.min(20, runBudget),
      );
      runBudget -= runs.length;
      return {
        ...line,
        text: excerpt(line.text),
        textLength: line.text.length,
        totalRuns: line.runs.length,
        nextRunOffset:
          input.runOffset + runs.length < line.runs.length
            ? input.runOffset + runs.length
            : null,
        runs: runs.map((run) => ({
          ...run,
          text: excerpt(run.text, 120),
          textLength: run.text.length,
        })),
      };
    });
    return {
      ...entry,
      text: excerpt(entry.text),
      textLength: entry.text.length,
      diagnostics: entry.diagnostics.slice(0, 10),
      layout: {
        ...layout,
        lines,
        totalLines: layout.lines.length,
        nextLineOffset:
          input.lineOffset + lines.length < layout.lines.length
            ? input.lineOffset + lines.length
            : null,
      },
    };
  });
  const preview = input.preview
    ? await diagnosticPng(
        userId,
        projectId,
        project.version,
        project.draft ? project.draft.document : project.document,
        input.frame,
      )
    : undefined;
  return {
    projectId,
    version: project.version,
    revision: project.revision,
    format: { width: result.plan?.width, height: result.plan?.height },
    ready: result.validation.ready,
    diagnostics: result.validation.diagnostics
      .filter((d) => !d.nodeId || items.some((n) => n.nodeId === d.nodeId))
      .slice(0, 100),
    diagnosticsTotal: result.validation.diagnostics.length,
    total: entries.length,
    items,
    nextCursor:
      offset + input.limit < entries.length
        ? String(offset + input.limit)
        : null,
    ...(preview ? { preview } : {}),
  };
}

/** Uses the same cross-process heavy lease as the worker, never a saved revision. */
async function diagnosticPng(
  userId: string,
  projectId: string,
  version: number,
  document: unknown,
  frame: number,
) {
  const token = randomUUID();
  const until = () => new Date(Date.now() + 30000);
  const claimed = await prisma.$transaction(async (db) => {
    await db.studioWorkerLease.upsert({
      where: { id: "heavy" },
      create: { id: "heavy" },
      update: {},
    });
    return db.studioWorkerLease.updateMany({
      where: {
        id: "heavy",
        OR: [{ until: null }, { until: { lte: new Date() } }],
      },
      data: { token, until: until() },
    });
  });
  if (!claimed.count) throw new StudioError("JOB_ACTIVE");
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void prisma.studioWorkerLease
      .updateMany({
        where: { id: "heavy", token, until: { gt: new Date() } },
        data: { until: until() },
      })
      .then((row) => {
        if (!row.count) controller.abort();
      })
      .catch(() => controller.abort());
  }, 5000);
  const directory = `studio-diagnostics/${userId}/${token}`;
  try {
    await mkdir(absPath(directory), { recursive: true });
    const result = await evaluate(userId, document, `${directory}/inputs`);
    const errors = result.validation.diagnostics.filter(
      (d) => d.severity === "error",
    );
    if (
      !result.plan ||
      !result.resolvedDocument ||
      errors.some((d) => d.code !== "TEXT_OVERFLOW")
    )
      throw new StudioError("VALIDATION_FAILED", result.validation.diagnostics);
    const current = await owned(userId, projectId);
    if (current.version !== version) throw new StudioError("VERSION_CONFLICT");
    await actor(userId);
    if (frame >= result.plan.durationInFrames)
      throw new StudioError("FRAME_OUT_OF_RANGE");
    const frozen = {
      projectId,
      revision: 0,
      snapshotId: token,
      revisionId: "diagnostic",
      sourceVersion: null,
      document: result.resolvedDocument,
      resolvedDocument: result.resolvedDocument,
      manifest: result.manifest,
      files: result.files,
      ...("fontFiles" in result ? { fontFiles: result.fontFiles } : {}),
      plan: result.plan,
      validation: result.validation,
      runtime,
      hash: "diagnostic",
    } as StudioFrozenRevision;
    await runStudioChild(
      {
        operation: "diagnostic",
        jobId: token,
        leaseToken: token,
        directory: `${directory}/render`,
        engineId: await prepareStudioEngine(),
        frozen,
        input: { kind: "still", frame },
      },
      { timeoutMs: 120000, signal: controller.signal },
    );
    const data = await readFile(
      path.join(absPath(`${directory}/render`), "frame.png"),
    );
    if (data.byteLength > 12 * 1024 * 1024)
      throw new StudioError("OUTPUT_BUDGET_EXCEEDED");
    return {
      kind: "diagnostic-draft" as const,
      version,
      frame,
      mimeType: "image/png" as const,
      bytes: data.byteLength,
      base64: data.toString("base64"),
    };
  } finally {
    clearInterval(heartbeat);
    await rm(absPath(directory), { recursive: true, force: true });
    await prisma.studioWorkerLease.updateMany({
      where: { id: "heavy", token },
      data: { token: null, until: null },
    });
  }
}
