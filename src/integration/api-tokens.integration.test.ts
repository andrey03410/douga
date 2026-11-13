import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("MCP over HTTP", () => {
  const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };

  it("refuses without a token and never exposes or reads the server's disk", async () => {
    // A real allowed folder with a picture: only the transport may stop the read.
    const dir = await mkdtemp(join(tmpdir(), "douga-http-mcp-"));
    const png = join(dir, "a.png");
    await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    const before = process.env.MCP_LOCAL_MEDIA_DIRS;
    process.env.MCP_LOCAL_MEDIA_DIRS = dir;
    onTestFinished(async () => {
      if (before === undefined) delete process.env.MCP_LOCAL_MEDIA_DIRS;
      else process.env.MCP_LOCAL_MEDIA_DIRS = before;
      await rm(dir, { recursive: true, force: true });
    });
    await prisma.apiToken.updateMany({ where: { userId: owner }, data: { revokedAt: new Date() } });
    const { token } = await issueApiToken(owner, { name: "http" });
    expect((await rpc("dga_" + "x".repeat(43), "tools/list")).status).toBe(401);
    const tools = (await rpc(token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("video_interactive_publish");
    expect(tools).not.toContain("list_local_media");
    expect(tools).not.toContain("import_local_media");
    const call = await rpc(token, "tools/call", {
      name: "tournament_create",
      arguments: { title: "диск", segments: [{ title: "s", items: [{ path: png }, { path: png }] }] },
    });
    expect(call.body.result.content[0].text).toContain("LOCAL_MEDIA_DISABLED");
    expect(await prisma.tournament.count({ where: { userId: owner } })).toBe(0);
  });
});
