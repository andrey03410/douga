import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { createVideoDocument } from "@/video";
import * as studio from "@/server/studio";
import type { NextConfig } from "next";
import { getMiddlewareMatchers } from "next/dist/build/analysis/get-page-static-info";
import { config, middleware } from "@/middleware";
import { WATCH_CHROME, withWatchChrome } from "@/watch/chrome";

let owner: string;
let other: string;

const doc = () =>
  createVideoDocument({
    kind: "top",
    title: "Публичный ролик",
    participants: [{ id: "object", label: "Стул" }],
  });

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `watch-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: `watch-${randomUUID()}@test.local`, passwordHash: "x" },
    })
  ).id;
});

afterAll(async () => {
  for (const id of [owner, other]) {
    if (!id) continue;
    const projects = await studio.listStudioProjects(id).catch(() => []);
    for (const row of projects) await studio.deleteStudioProject(id, row.id);
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await removePath(`studio/${id}`);
  }
});

async function publishedWithFile() {
  const created = await studio.createStudioProject(owner, {
    document: doc(),
    idempotencyKey: randomUUID(),
  });
  const pub = await studio.publishStudioProject(owner, created.id, {
    idempotencyKey: randomUUID(),
  });
  const body = Buffer.from("0123456789");
  const hash = createHash("sha256").update(body).digest("hex");
  const relative = `studio/${owner}/${created.id}/versions/watch/${hash}.bin`;
  await mkdir(absPath(`studio/${owner}/${created.id}/versions/watch`), {
    recursive: true,
  });
  await writeFile(absPath(relative), body);
  const snapshot = await prisma.studioSnapshot.findUniqueOrThrow({
    where: { id: pub.snapshotId },
  });
  const payload = JSON.parse(snapshot.payloadJson) as {
    files: Record<string, unknown>;
    plan: {
      audio: unknown[];
      scenes: unknown[];
    };
    document: unknown;
    manifest: unknown;
  };
  payload.files = {
    ...payload.files,
    clip: { path: relative, hash, bytes: body.length },
  };
  payload.plan.audio = [
    {
      id: "cue",
      asset: {
        id: "asset",
        kind: "audio",
        src: `/api/studio/media?path=${encodeURIComponent(relative)}`,
        hash,
        durationSec: 1,
      },
      role: "music",
      from: 0,
      durationInFrames: 30,
      offsetFrames: 0,
      loopFrames: null,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      duckVolume: 1,
      duckWindows: [],
      muteWindows: [],
    },
  ];
  await prisma.studioSnapshot.update({
    where: { id: pub.snapshotId },
    data: { payloadJson: JSON.stringify(payload) },
  });
  return { created, pub, hash, relative };
}

describe("public watch", () => {
  it("gives a guest the plan and title, without the document or studio paths", async () => {
    const { pub, hash } = await publishedWithFile();
    const page = await studio.loadPublicWatch(pub.token);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.title).toBe("Публичный ролик");
    expect(page.plan.audio[0].asset.src).toBe(
      `/api/watch/${encodeURIComponent(pub.token)}/media/${hash}.bin`,
    );
    const dumped = JSON.stringify(page);
    expect(dumped).not.toContain("document");
    expect(dumped).not.toContain("/api/studio");
    expect(dumped).not.toContain("/api/arts");
    expect(dumped).not.toContain("studio/");
    expect(await studio.loadPublicWatch("missing-token")).toEqual({ ok: false });
    await studio.unpublishStudioProject(owner, pub.projectId, {
      idempotencyKey: randomUUID(),
    });
    expect(await studio.loadPublicWatch(pub.token)).toEqual({ ok: false });
  });

  it("streams a snapshot file with suffix ranges and rejects everything else", async () => {
    const { pub, hash } = await publishedWithFile();
    const suffix = await studio.publicWatchMedia(
      pub.token,
      `${hash}.bin`,
      new Request("http://localhost/media", { headers: { range: "bytes=-3" } }),
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(suffix.headers.get("content-length")).toBe("3");
    // The name carries the file hash, so the bytes behind it never change.
    expect(suffix.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(suffix.headers.get("etag")).toBe(`"${hash}"`);
    expect(await suffix.text()).toBe("789");
    const otherProject = await studio.createStudioProject(other, {
      document: doc(),
      idempotencyKey: randomUUID(),
    });
    const foreign = await studio.publishStudioProject(other, otherProject.id, {
      idempotencyKey: randomUUID(),
    });
    expect(
      (
        await studio.publicWatchMedia(
          foreign.token,
          `${hash}.bin`,
          new Request("http://localhost/media"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await studio.publicWatchMedia(
          pub.token,
          "../secret.bin",
          new Request("http://localhost/media"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await studio.publicWatchMedia(
          "no-such-token",
          `${hash}.bin`,
          new Request("http://localhost/media"),
        )
      ).status,
    ).toBe(404);
    await studio.unpublishStudioProject(owner, pub.projectId, {
      idempotencyKey: randomUUID(),
    });
    expect(
      (
        await studio.publicWatchMedia(
          pub.token,
          `${hash}.bin`,
          new Request("http://localhost/media"),
        )
      ).status,
    ).toBe(404);
  });

  it("marks only the watch route as a bare page", async () => {
    expect(withWatchChrome(new Headers(), "/watch/abc").get(WATCH_CHROME)).toBe(
      "bare",
    );
    expect(
      withWatchChrome(new Headers({ [WATCH_CHROME]: "bare" }), "/projects").get(
        WATCH_CHROME,
      ),
    ).toBeNull();
    const watch = await middleware(new NextRequest("http://localhost/watch/abc"));
    expect(watch.headers.get("referrer-policy")).toBe("no-referrer");
    expect(watch.headers.get("x-robots-tag")).toBe("noindex");
    const projects = await middleware(
      new NextRequest("http://localhost/projects"),
    );
    expect(projects.headers.get("referrer-policy")).toBeNull();
  });

  it("runs the middleware on every page, so a forged bare header is dropped", async () => {
    const matchers = getMiddlewareMatchers(config.matcher, {} as NextConfig);
    const runs = (pathname: string) =>
      matchers.some((matcher) => new RegExp(matcher.regexp).test(pathname));
    for (const page of ["/", "/projects", "/studio/abc", "/watch/abc"])
      expect(runs(page), page).toBe(true);
    for (const skipped of ["/_next/static/chunk.js", "/favicon.ico", "/api/studio/projects"])
      expect(runs(skipped), skipped).toBe(false);
    const forged = await middleware(
      new NextRequest("http://localhost/projects", {
        headers: { [WATCH_CHROME]: "bare" },
      }),
    );
    expect(forged.headers.get("x-middleware-override-headers")).not.toContain(
      WATCH_CHROME,
    );
    expect(forged.headers.get(`x-middleware-request-${WATCH_CHROME}`)).toBeNull();
  });
});
