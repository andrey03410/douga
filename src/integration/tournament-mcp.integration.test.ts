import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
let client: Client, transport: StdioClientTransport, userId: string;
const email = `tournament-mcp-${randomUUID()}@test.local`;
let root: string, poolId: string;
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(
    (result.content as { type: string; text: string }[]).find(
      (c) => c.type === "text",
    )!.text,
  );
  if (result.isError) throw new Error(JSON.stringify(data));
  return data;
}
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email, passwordHash: "x", role: "admin" },
    })
  ).id;
  root = absPath(`verification/27-segments/mcp-${userId}`);
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/track.mp3`, "fixture");
  const rel = `verification/27-segments/mcp-${userId}/pool.mp3`;
  await writeFile(absPath(rel), "pool fixture");
  poolId = (
    await prisma.art.create({
      data: { userId, kind: "audio", label: "Pool track", filePath: rel },
    })
  ).id;
  client = new Client({ name: "test-tournaments", version: "1" });
  transport = new StdioClientTransport({
    command: resolve(process.cwd(), "node_modules/.bin/tsx"),
    args: ["--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL!,
      MCP_ACTOR_EMAIL: email,
      MCP_LOCAL_MEDIA_DIRS: root,
    },
  });
  await client.connect(transport);
}, 20000);
afterAll(async () => {
  await client?.close();
  const tournaments = await prisma.tournament.findMany({ where: { userId } });
  for (const t of tournaments) await removePath(`tournaments/${t.id}`);
  await prisma.user.deleteMany({ where: { id: userId } });
  if (userId) await removePath(`verification/27-segments/mcp-${userId}`);
});
it("prepares owned segments from allowed disk files and pool without exposing human answer tools", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toContain("tournament_create");
  expect(names.filter((n) => n.startsWith("tournament_"))).toEqual(
    expect.arrayContaining([
      "tournament_list",
      "tournament_get",
      "tournament_create",
      "tournament_segments_update",
    ]),
  );
  expect(
    names.filter((n) => /tournament_.*(answer|rank|finalize|compare)/.test(n)),
  ).toEqual([]);
  const created = await call("tournament_create", {
    title: "Prepared",
    scheme: "merge",
    segments: [
      { title: "Disk", tracks: [{ path: `${root}/track.mp3` }] },
      { title: "Pool", tracks: [{ assetId: poolId }] },
    ],
  });
  const loaded = await call("tournament_get", { id: created.id });
  expect(loaded.segments).toHaveLength(2);
  expect(loaded.segments.map((s: { title: string }) => s.title)).toEqual([
    "Disk",
    "Pool",
  ]);
  expect((await readFile(`${root}/track.mp3`)).toString()).toBe("fixture");
  expect(
    (await call("tournament_list")).tournaments.some(
      (t: { id: string }) => t.id === created.id,
    ),
  ).toBe(true);
  const segments = loaded.segments.map(
    (s: { id: string; title: string; tracks: { id: string }[] }) => ({
      id: s.id,
      title: s.title + " fixed",
      trackIds: s.tracks.map((t) => t.id),
    }),
  );
  await call("tournament_segments_update", { id: created.id, segments });
  expect(
    (await call("tournament_get", { id: created.id })).segments[0].title,
  ).toBe("Disk fixed");
  await expect(
    call("tournament_create", {
      title: "Bad",
      scheme: "merge",
      segments: [{ title: "No", tracks: [{ path: "/etc/passwd" }] }],
    }),
  ).rejects.toThrow("PATH_NOT_ALLOWED");
  await expect(
    call("tournament_create", {
      title: "Bad",
      scheme: "merge",
      segments: [{ title: "No", tracks: [{ assetId: "foreign" }] }],
    }),
  ).rejects.toThrow("NOT_FOUND");
});
