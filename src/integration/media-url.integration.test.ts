import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { importImageFromUrl } from "@/server/media-url";

// Integration tests for the by-link image import (phase 17) against a real HTTP
// server: content-type policy, size ceiling, redirect handling and the SSRF
// guard. The loopback allowance (MEDIA_URL_ALLOW_PRIVATE) is what makes a local
// fixture server reachable at all, so one test turns it off again.

const EMAIL = "integration-media-url@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let userId: string;
let server: Server;
let base: string;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

/** Files left behind in storage/tmp — an aborted import must not leak any. */
function tmpLeftovers(): string[] {
  const dir = absPath("tmp");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith("url-"));
}

beforeAll(async () => {
  process.env.MEDIA_URL_ALLOW_PRIVATE = "1";
  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  userId = user.id;

  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/poster.png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(PNG.length) });
      res.end(PNG);
    } else if (url.startsWith("/no-extension")) {
      // a CDN link without an extension is still an image if it says so
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(PNG);
    } else if (url.startsWith("/page")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not a picture</html>");
    } else if (url.startsWith("/vector")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end("<svg/>");
    } else if (url.startsWith("/huge-declared")) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(64 * 1024 * 1024),
      });
      res.end(PNG);
    } else if (url.startsWith("/huge-streamed")) {
      // lies about its size: only the byte counter can stop this one
      res.writeHead(200, { "Content-Type": "image/png" });
      const chunk = Buffer.alloc(1024 * 1024, 7);
      for (let i = 0; i < 40; i++) res.write(chunk);
      res.end();
    } else if (url.startsWith("/redirect-ok")) {
      res.writeHead(302, { Location: "/poster.png" });
      res.end();
    } else if (url.startsWith("/redirect-loop")) {
      res.writeHead(302, { Location: "/redirect-loop" });
      res.end();
    } else if (url.startsWith("/missing")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("nope");
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MEDIA_URL_ALLOW_PRIVATE;
  await cleanup();
  await prisma.$disconnect();
});

describe("importImageFromUrl", () => {
  it("stores the picture in the pool with a label from the link", async () => {
    const art = await importImageFromUrl(userId, { url: `${base}/poster.png` });
    expect(art.kind).toBe("image");
    expect(art.label).toBe("poster");
    expect(art.sizeBytes).toBe(PNG.length);
    expect(existsSync(absPath(art.filePath))).toBe(true);
    expect(art.filePath.endsWith(".png")).toBe(true);
    expect(tmpLeftovers()).toEqual([]);
  });

  it("keeps an explicit label and trusts the content type over the missing extension", async () => {
    const art = await importImageFromUrl(userId, {
      url: `${base}/no-extension?id=7`,
      label: "Нагиса с зонтиком",
    });
    expect(art.label).toBe("Нагиса с зонтиком");
    expect(art.filePath.endsWith(".jpg")).toBe(true);
  });

  it("follows a redirect to the picture", async () => {
    const art = await importImageFromUrl(userId, { url: `${base}/redirect-ok` });
    expect(art.kind).toBe("image");
  });

  it("refuses a page and an image format the pool cannot store", async () => {
    await expect(importImageFromUrl(userId, { url: `${base}/page` })).rejects.toThrow("NOT_IMAGE");
    await expect(importImageFromUrl(userId, { url: `${base}/vector` })).rejects.toThrow(
      "NOT_IMAGE",
    );
  });

  it("refuses an oversized picture by the header and by the actual bytes", async () => {
    await expect(importImageFromUrl(userId, { url: `${base}/huge-declared` })).rejects.toThrow(
      "TOO_LARGE",
    );
    await expect(importImageFromUrl(userId, { url: `${base}/huge-streamed` })).rejects.toThrow(
      "TOO_LARGE",
    );
    expect(tmpLeftovers()).toEqual([]);
  });

  it("reports a failed fetch instead of creating an empty art", async () => {
    const before = await prisma.art.count({ where: { userId } });
    await expect(importImageFromUrl(userId, { url: `${base}/missing` })).rejects.toThrow(
      "FETCH_FAILED",
    );
    await expect(importImageFromUrl(userId, { url: `${base}/redirect-loop` })).rejects.toThrow(
      "FETCH_FAILED",
    );
    expect(await prisma.art.count({ where: { userId } })).toBe(before);
  });

  it("rejects a non-http link outright", async () => {
    await expect(importImageFromUrl(userId, { url: "file:///etc/passwd" })).rejects.toThrow(
      "BAD_URL",
    );
    await expect(importImageFromUrl(userId, { url: "ftp://host/p.jpg" })).rejects.toThrow(
      "BAD_URL",
    );
  });

  it("refuses to visit a private address when the loopback allowance is off", async () => {
    delete process.env.MEDIA_URL_ALLOW_PRIVATE;
    try {
      await expect(importImageFromUrl(userId, { url: `${base}/poster.png` })).rejects.toThrow(
        "BLOCKED_HOST",
      );
      await expect(
        importImageFromUrl(userId, { url: "http://169.254.169.254/latest/meta-data/" }),
      ).rejects.toThrow("BLOCKED_HOST");
      // the shared guard says HOST_UNRESOLVED; this API keeps FETCH_FAILED
      await expect(
        importImageFromUrl(userId, { url: "http://nothing-here.invalid/p.png" }),
      ).rejects.toThrow("FETCH_FAILED");
    } finally {
      process.env.MEDIA_URL_ALLOW_PRIVATE = "1";
    }
  });

  it("honors the pool quota and leaves nothing behind when it is full", async () => {
    const before = await prisma.art.count({ where: { userId } });
    await expect(
      importImageFromUrl(userId, { url: `${base}/poster.png`, maxPoolBytes: 1 }),
    ).rejects.toThrow("POOL_QUOTA");
    expect(await prisma.art.count({ where: { userId } })).toBe(before);
    expect(tmpLeftovers()).toEqual([]);
  });
});
