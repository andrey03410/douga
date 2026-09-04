import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";
import { createArt } from "@/server/arts";

const email = `mcp-top-${randomUUID()}@test.local`;
const otherEmail = `mcp-top-other-${randomUUID()}@test.local`;
let uid: string, otherUid: string, audio: string, audio2: string, visual: string, foreign: string;
let client: Client;
let projectId: string;

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse((result.content as { type: string; text: string }[]).map(c => c.text).join(""));
  if (result.isError) throw new Error(data.error ?? JSON.stringify(data));
  return data;
}

beforeAll(async () => {
  uid = (await prisma.user.create({ data: { email, passwordHash: "test", role: "admin" } })).id;
  otherUid = (await prisma.user.create({ data: { email: otherEmail, passwordHash: "test", role: "user" } })).id;
  const rel = `tmp/${uid}/tone.wav`;
  await saveFile(rel, Buffer.alloc(0));
  execFileSync(ffmpegPath as unknown as string, [
    "-y", "-f", "lavfi", "-i", "aevalsrc=if(lt(t\\,2)\\,0.01\\,0.6)*sin(2*PI*440*t):s=8000:d=4", absPath(rel),
  ], { stdio: "ignore" });
  const bytes = await readFile(absPath(rel));
  audio = (await createArt(uid, { fileName: "a.wav", data: bytes })).id;
  audio2 = (await createArt(uid, { fileName: "b.wav", data: bytes })).id;
  foreign = (await createArt(otherUid, { fileName: "foreign.wav", data: bytes })).id;
  visual = (await createArt(uid, { fileName: "art.png", data: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64",
  ) })).id;
  client = new Client({ name: "manual-top-test", version: "1.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: process.cwd(), env: { ...getDefaultEnvironment(), DATABASE_URL: process.env.DATABASE_URL!, MCP_ACTOR_EMAIL: email },
  }));
}, 30000);

afterAll(async () => {
  await client?.close();
  for (const id of [uid, otherUid].filter(Boolean)) {
    await removePath(`arts/${id}`);
    await removePath(`tmp/${id}`);
    await prisma.user.delete({ where: { id } });
  }
});

describe("manual tops through the real MCP transport", () => {
  it("builds a countdown with backgrounds and resolves the loudest windows", async () => {
    projectId = (await call("create_top_project", { title: "MCP top" })).projectId;
    await call("set_top_items", { projectId, clipSec: 1, introText: "", outroText: "", items: [
      { audioArtId: audio, artId: visual, customLabel: "Best" },
      { audioArtId: audio2, artId: visual, customLabel: "Second" },
    ] });
    const summary = await call("get_project", { projectId });
    expect(summary).toMatchObject({ kind: "top", intro: null, outro: null, order: "desc", readyToRender: true, warnings: [] });
    expect(summary.items.map((i: { label: string }) => i.label)).toEqual(["Best", "Second"]);
    expect(summary.items[0].timelineStartSec).toBeGreaterThan(summary.items[1].timelineStartSec);
    for (const item of summary.items) {
      expect(item.clipSec).toBe(1);
      expect(item.clipStartSec).toBeGreaterThanOrEqual(1.99);
      expect(item.artId).toBe(visual);
    }
  });

  it("rejects foreign audio and visuals without deleting the existing top", async () => {
    const before = await call("get_project", { projectId });
    await expect(call("set_top_items", { projectId, items: [{ audioArtId: foreign }] })).rejects.toThrow("NO_AUDIO_SOURCE");
    await expect(call("set_top_items", { projectId, items: [{ audioArtId: audio, artId: foreign }] })).rejects.toThrow("BAD_VISUAL");
    const after = await call("get_project", { projectId });
    expect(after.items).toEqual(before.items);
  });

  it("rejects a foreign project, duplicates, and invalid duration", async () => {
    const other = await prisma.videoProject.create({ data: { userId: otherUid, title: "Other", kind: "top" } });
    await expect(call("set_top_items", { projectId: other.id, items: [{ audioArtId: audio }] })).rejects.toThrow("NOT_FOUND");
    await expect(call("set_top_items", { projectId, items: [{ audioArtId: audio }, { audioArtId: audio }] })).rejects.toThrow("DUPLICATE_AUDIO");
    await expect(call("set_top_items", { projectId, clipSec: 0, items: [{ audioArtId: audio }] })).rejects.toThrow();
  });

  it("reports missing media instead of claiming a render-ready project", async () => {
    const art = await prisma.art.findUniqueOrThrow({ where: { id: visual } });
    await removePath(art.filePath);
    const result = await call("get_project", { projectId });
    expect(result.readyToRender).toBe(false);
    expect(result.warnings.join(" ")).toContain("MISSING_FILE");
  });
});
