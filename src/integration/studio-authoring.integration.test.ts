import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import * as studio from "@/server/studio";
import { studioHttp } from "@/server/studio/http";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({ requireUser: async () => ({ id: session.id, email: "authoring@test.local", role: "admin" }) }));
let owner: string;
const created: string[] = [];
const request = (body: unknown) => studioHttp(new Request("http://localhost/api/studio/projects", { method: "POST", body: JSON.stringify(body) }));
beforeAll(async () => { owner = (await prisma.user.create({ data: { email: `authoring-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id; session.id = owner; });
afterAll(async () => {
  for (const { id } of await prisma.studioProject.findMany({ where: { userId: owner } })) await studio.deleteStudioProject(owner, id);
  await prisma.user.delete({ where: { id: owner } });
  await removePath(`studio/${owner}`);
});
it.each([
  { kind: "top", subject: "characters", variant: "portrait-top" },
  { kind: "top", subject: "music", variant: "music-top" },
  { kind: "picker", subject: "characters", variant: "picker" },
  { kind: "tier-list", subject: "characters", variant: "tier-list" },
])("creates a curated $kind/$subject without guessing a preset", async ({ kind, subject, variant }) => {
  const key = randomUUID();
  const body = { kind, subject, format: "wide", title: "Проверка типа", design: { accent: "#cba66d" }, idempotencyKey: key };
  const response = await request(body);
  expect(response.status).toBe(201);
  const p = await response.json(); created.push(p.id);
  expect(p.document.settings.composition).toMatchObject({ version: 1, variant, accent: "#cba66d" });
  expect(p.document.preset.id).toMatch(/^composition\./);
  expect(p.kind).toBe(kind === "tier-list" ? "board" : kind);
  expect((await (await request(body)).json()).id).toBe(p.id);
});
it("does not offer retired built-ins or create them by ID, while retaining raw SDK compatibility", async () => {
  const response = await request({ presetId: "top.classic.wide" });
  expect(response.status).toBe(422);
  expect((await response.json()).error).toBe("PRESET_RETIRED");
  const summaries = await studio.listStudioPresetSummaries(owner, { limit: 100 });
  expect(summaries.items.every(p => p.id.startsWith("composition.") || p.personal)).toBe(true);
});
it("returns concrete allocation diagnostics before expanding a huge intent", async () => {
  const before = await prisma.studioProject.count({ where: { userId: owner } });
  const response = await request({ kind: "picker", roundCount: 20, cardsPerRound: 6000 });
  expect(response.status).toBe(400);
  const error = await response.json();
  expect(error.error).toBe("RESOURCE_BUDGET_EXCEEDED");
  expect(error.diagnostics[0].message).toContain("resource=expandedNodes; used=120000; limit=100000");
  expect(await prisma.studioProject.count({ where: { userId: owner } })).toBe(before);
});
it("rejects a palette beyond the composition budget before creating a project", async () => {
  const before = await prisma.studioProject.count({ where: { userId: owner } });
  const response = await request({ kind: "picker", design: { palette: Array(9).fill("#abcdef") } });
  expect(response.status).toBe(400);
  expect(await prisma.studioProject.count({ where: { userId: owner } })).toBe(before);
});
