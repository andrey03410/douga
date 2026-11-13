import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { issueApiToken, listApiTokens, resolveApiToken, revokeApiToken } from "@/server/api-tokens";

let owner: string;

beforeAll(async () => {
  owner = (await prisma.user.create({ data: { email: `tok-${randomUUID()}@test.local`, passwordHash: "x" } })).id;
});
afterAll(async () => {
  if (owner) await prisma.user.delete({ where: { id: owner } }).catch(() => {});
});

describe("api tokens", () => {
  it("issues a dga_ token once, stores only its hash and resolves the owner", async () => {
    const issued = await issueApiToken(owner, { name: "ноутбук" });
    expect(issued.token).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.tokenHash).not.toContain(issued.token.slice(4));
    expect(JSON.stringify(await listApiTokens(owner))).not.toContain(issued.token);
    expect((await resolveApiToken(issued.token))?.userId).toBe(owner);
    expect(await resolveApiToken("dga_" + "x".repeat(43))).toBeNull();
    expect(await resolveApiToken("Bearer junk")).toBeNull();
    await revokeApiToken(owner, issued.id);
    expect(await resolveApiToken(issued.token)).toBeNull();
  });

  it("limits active tokens per account", async () => {
    const active = await prisma.apiToken.count({ where: { userId: owner, revokedAt: null } });
    for (let i = active; i < 10; i++) await issueApiToken(owner, { name: `t${i}` });
    await expect(issueApiToken(owner, { name: "лишний" })).rejects.toMatchObject({ code: "TOKEN_LIMIT" });
  });
});
