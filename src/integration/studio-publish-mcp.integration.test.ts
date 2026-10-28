import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import { registerStudioTools } from "@/mcp/studio-tools";
import * as studio from "@/server/studio";

let owner: string;
let other: string;
let client: Client;

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `mcp-pub-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `mcp-pub-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  const server = new McpServer({ name: "douga-test", version: "0" });
  registerStudioTools(server, {
    userId: owner,
    email: "owner@test.local",
    role: "user",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
  for (const id of [owner, other]) {
    if (!id) continue;
    const projects = await studio.listStudioProjects(id).catch(() => []);
    for (const row of projects) await studio.deleteStudioProject(id, row.id);
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await removePath(`studio/${id}`);
  }
});

function text(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find((item) => item.type === "text")!.text!);
}

describe("video_publish over MCP", () => {
  it("registers the tools and returns a watch link without throwing on a foreign project", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "video_publish",
        "video_unpublish",
        "video_publication_get",
      ]),
    );
    process.env.DOUGA_PUBLIC_URL = "http://127.0.0.1:3999/";
    const created = await studio.createStudioProject(owner, {
      document: createVideoDocument({
        kind: "top",
        title: "MCP",
        participants: [{ id: "object", label: "Стул" }],
      }),
      idempotencyKey: randomUUID(),
    });
    const published = text(
      await client.callTool({
        name: "video_publish",
        arguments: { projectId: created.id },
      }),
    );
    expect(published.updated).toBe(false);
    expect(published.revision).toBe(created.revision);
    expect(published.url).toMatch(
      /^http:\/\/127\.0\.0\.1:3999\/watch\/[A-Za-z0-9_-]{22}$/,
    );
    const foreign = await studio.createStudioProject(other, {
      document: createVideoDocument({
        kind: "top",
        title: "Чужой",
        participants: [{ id: "object", label: "Стул" }],
      }),
      idempotencyKey: randomUUID(),
    });
    const denied = await client.callTool({
      name: "video_publish",
      arguments: { projectId: foreign.id },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain("NOT_FOUND");
    const status = text(
      await client.callTool({
        name: "video_publication_get",
        arguments: { projectId: created.id },
      }),
    );
    expect(status.publication.url).toBe(published.url);
    await client.callTool({
      name: "video_unpublish",
      arguments: { projectId: created.id },
    });
    const gone = text(
      await client.callTool({
        name: "video_publication_get",
        arguments: { projectId: created.id },
      }),
    );
    expect(gone.publication).toBeNull();
  });
});
