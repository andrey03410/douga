import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video";
import * as studio from "@/server/studio";
let owner: string, other: string, projectId: string;
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: {
        email: `type-author-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "admin",
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        email: `type-other-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "user",
      },
    })
  ).id;
  const document = createVideoDocument({
    kind: "top",
    title: "Типографика",
    participants: [],
  });
  document.schemaVersion = 1;
  delete document.segments;
  document.scenes = [
    {
      id: "scene",
      block: "custom",
      duration: { sec: 1 },
      nodes: [
        {
          id: "title",
          type: "text",
          text: "名前 — Имя",
          rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 },
          style: { fontSize: 60, color: "#00ff00" },
        },
      ],
    },
  ];
  projectId = (await studio.createStudioProject(owner, { document })).id;
});
afterAll(async () => {
  if (projectId) await studio.deleteStudioProject(owner, projectId);
  for (const id of [owner, other])
    if (id) {
      await prisma.user.delete({ where: { id } });
      await removePath(`studio/${id}`);
    }
});
it("applies themes atomically with CAS, replay, scope and legacy overrides", async () => {
  const before = await studio.getStudioProject(owner, projectId);
  const input = {
    expectedVersion: before.version,
    theme: "cinematic" as const,
    mode: "preserve" as const,
    idempotencyKey: randomUUID(),
  };
  const updated = await studio.applyStudioTypography(owner, projectId, input);
  expect(updated.version).toBe(before.version + 1);
  expect(updated.revision).toBe(before.revision);
  expect(updated.plan!.scenes[0].nodes[0].typography!.fill).toBe("#00ff00");
  expect(updated.plan!.scenes[0].nodes[0].textLayout!.fontSize).toBe(60);
  expect(
    (await studio.applyStudioTypography(owner, projectId, input)).version,
  ).toBe(updated.version);
  await expect(
    studio.applyStudioTypography(owner, projectId, { ...input, theme: "neon" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    studio.applyStudioTypography(owner, projectId, {
      expectedVersion: before.version,
      theme: "clean",
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    studio.applyStudioTypography(other, projectId, {
      expectedVersion: updated.version,
      theme: "clean",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const replaced = await studio.applyStudioTypography(owner, projectId, {
    expectedVersion: updated.version,
    theme: "clean",
    mode: "replace",
  });
  expect(replaced.plan!.scenes[0].nodes[0].typography!.fill).not.toBe(
    "#00ff00",
  );
  const report = await studio.inspectStudioText(owner, projectId, {
    expectedVersion: replaced.version,
    nodeId: replaced.plan!.scenes[0].nodes[0].id,
  });
  expect(report.ready).toBe(true);
  expect(report.total).toBe(1);
});
it("does not replace a malformed draft while applying a theme", async () => {
  const p = await studio.getStudioProject(owner, projectId);
  const malformed = await studio.saveStudioDraft(owner, projectId, {
    expectedVersion: p.version,
    text: "{unfinished",
  });
  await expect(
    studio.applyStudioTypography(owner, projectId, {
      expectedVersion: malformed.version,
      theme: "manga",
    }),
  ).rejects.toMatchObject({ code: "DRAFT_REPLACEMENT_REQUIRED" });
  expect((await studio.getStudioProject(owner, projectId)).draft!.text).toBe(
    "{unfinished",
  );
});
it("prepares all built-in gallery themes, styles and fonts in every format using real font metrics", async () => {
  const { typographyThemes, typographyStyles, typographyFonts } =
    await import("@douga/video");
  for (const format of ["wide", "vertical", "square"] as const) {
    for (const theme of typographyThemes) {
      const r = await studio.previewStudioTypography(owner, {
        theme: theme.id,
        format,
      });
      expect(
        r.diagnostics.filter((d) => d.severity === "error"),
        `${theme.id}/${format}`,
      ).toEqual([]);
      expect(r.plan.fonts!.length).toBeGreaterThan(0);
    }
    for (const preset of typographyStyles) {
      const r = await studio.previewStudioTypography(owner, {
        preset: preset.id,
        format,
        sample: "text",
      });
      expect(
        r.ready,
        `${preset.id}/${format}: ${JSON.stringify(r.diagnostics)}`,
      ).toBe(true);
    }
    for (const font of typographyFonts) {
      const r = await studio.previewStudioTypography(owner, {
        font: font.id,
        format,
        sample: "text",
      });
      expect(r.ready, `${font.id}/${format}`).toBe(true);
    }
  }
}, 30000);

it("keeps every populated factory preset ready with clean typography in all three formats", async () => {
  const { getBuiltinPresets, applyTypographyTheme, compileVideo } =
    await import("@douga/video");
  const { getTypographyMeasureText } =
    await import("@/server/studio/typography-fonts");
  const measureText = await getTypographyMeasureText();
  for (const preset of getBuiltinPresets())
    for (const format of ["wide", "vertical", "square"] as const) {
      const document = applyTypographyTheme(
        createVideoDocument({ kind: preset.kind, preset }),
        "clean",
      );
      document.output.format = format;
      const compiled = compileVideo(document, {}, { measureText });
      expect(
        compiled.diagnostics.filter((d) => d.severity === "error"),
        `${preset.id}/${format}`,
      ).toEqual([]);
      expect(compiled.ready).toBe(true);
    }
}, 60000);
