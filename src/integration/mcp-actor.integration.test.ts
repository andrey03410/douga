import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolveActor } from "@/mcp/actor";

const EMAIL = "integration-mcp-actor@test.local";
// Created before registration lowercased emails (T08): stored as typed.
const EMAIL_LEGACY = "Integration-MCP-Actor-Legacy@Test.Local";
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.MCP_ACTOR_EMAIL;
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_LEGACY] } } });
  await prisma.user.create({ data: { email: EMAIL, passwordHash: "x", role: "admin" } });
  await prisma.user.create({ data: { email: EMAIL_LEGACY, passwordHash: "x" } });
});

afterAll(async () => {
  if (saved === undefined) delete process.env.MCP_ACTOR_EMAIL;
  else process.env.MCP_ACTOR_EMAIL = saved;
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_LEGACY] } } });
});

describe("resolveActor", () => {
  it("resolves userId + role from MCP_ACTOR_EMAIL", async () => {
    process.env.MCP_ACTOR_EMAIL = EMAIL;
    const actor = await resolveActor();
    expect(actor.email).toBe(EMAIL);
    expect(actor.role).toBe("admin");
    expect(actor.userId).toMatch(/.+/);
  });
  it("throws a clear error when the env var is unset", async () => {
    delete process.env.MCP_ACTOR_EMAIL;
    await expect(resolveActor()).rejects.toThrow(/MCP_ACTOR_EMAIL/);
  });
  it("ignores the case of MCP_ACTOR_EMAIL", async () => {
    process.env.MCP_ACTOR_EMAIL = ` ${EMAIL.toUpperCase()} `;
    const actor = await resolveActor();
    expect(actor.email).toBe(EMAIL);
    expect(actor.role).toBe("admin");
  });
  it("finds a legacy mixed-case account by its lowercase email", async () => {
    process.env.MCP_ACTOR_EMAIL = EMAIL_LEGACY.toLowerCase();
    const actor = await resolveActor();
    expect(actor.email).toBe(EMAIL_LEGACY);
    expect(actor.role).toBe("user");
  });
  it("throws when no account matches", async () => {
    process.env.MCP_ACTOR_EMAIL = "nobody@test.local";
    await expect(resolveActor()).rejects.toThrow(/nobody@test.local/);
  });
});
