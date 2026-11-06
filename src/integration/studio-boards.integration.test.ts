import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import * as studio from "@/server/studio";
let owner: string;
beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `boards-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" } })).id;
});
afterAll(async () => {
  if (!owner) return;
  for (const p of await studio.listStudioProjects(owner)) await studio.deleteStudioProject(owner, p.id);
  await prisma.user.delete({ where: { id: owner } });
});
describe("persistent SDK boards", () => {
  it("creates from a short preset ID and keeps the canonical preset identity", async () => {
    const p = await studio.createStudioProjectFromPreset(owner, { presetId: "board.tier" });
    expect(p.kind).toBe("board"); expect(p.validation.ready).toBe(true);
    expect(p.document.preset!.id).toBe("board.tier.wide");
  });
  it("persists a slot patch, saves a reusable design and freezes the applied choices", async () => {
    let p = await studio.createStudioProjectFromPreset(owner, { presetId: "board.budget-draft.square" });
    const board = p.document.segments![0].scenes[0].board!;
    const original = board.rounds;
    p = await studio.patchStudioDraft(owner, p.id, { expectedVersion: p.version, operations: [{ op: "set", target: { type: "boardSlot", id: board.slots[0].id }, path: ["label"], value: "Leader" }] });
    p = await studio.commitStudioDraft(owner, p.id, { expectedVersion: p.version });
    const saved = await studio.saveStudioPreset(owner, { document: p.document, name: "Budget board" });
    const canonical = await studio.getStudioPreset(owner, saved.id);
    expect(canonical.scenes[0].board!.rounds).toEqual([]);
    p = await studio.applyStudioPreset(owner, p.id, { expectedVersion: p.version, presetId: saved.id });
    expect(p.validation.ready).toBe(true);
    p = await studio.commitStudioDraft(owner, p.id, { expectedVersion: p.version });
    expect(p.document.segments![0].scenes[0].board!.rounds).toEqual(original);
    const snapshot = await studio.freezeStudioProject(owner, p.id);
    expect(snapshot.plan.scenes.at(-1)!.boardState!.spent).toBe(15);
  });
});
