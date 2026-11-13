import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import {
  createVideoDocument,
  interactiveExample,
  interactiveSnapshotHash,
  interactiveSnapshotSchema,
  type InteractiveSnapshot,
  type VideoDocument,
} from "@douga/video";
import * as studio from "@/server/studio";
import {
  interactiveFileResponse,
  interactiveManifestResponse,
  interactiveTestHooks,
} from "@/server/studio/interactive";

let owner: string;
let other: string;

/** The archetypes example without owned media: every studio account can save it. */
function archetypes(): VideoDocument {
  const d = interactiveExample();
  for (const p of d.source.participants) delete p.media;
  delete d.audio;
  d.settings.typography = { version: 1, theme: "clean" };
  return d;
}

beforeAll(async () => {
  interactiveTestHooks.stills = false;
  for (const name of ["owner", "other"] as const) {
    const id = (await prisma.user.create({ data: { email: `int-${randomUUID()}@test.local`, passwordHash: "x" } })).id;
    if (name === "owner") owner = id;
    else other = id;
  }
});

afterAll(async () => {
  interactiveTestHooks.stills = true;
  for (const id of [owner, other]) {
    if (!id) continue;
    const projects = await studio.listStudioProjects(id).catch(() => []);
    for (const row of projects) await studio.deleteStudioProject(id, row.id).catch(() => {});
    await prisma.user.delete({ where: { id } }).catch(() => {});
    await removePath(`studio/${id}`);
  }
});

describe("interactive publication", () => {
  it("copies a finished project and publishes an interactive snapshot by token", async () => {
    const original = await studio.createStudioProject(owner, { document: archetypes(), idempotencyKey: randomUUID() });
    expect(original.validation.ready).toBe(true);
    const copy = await studio.copyStudioProject(owner, original.id, { title: "Архетипы: игра" });
    expect(copy.id).not.toBe(original.id);
    expect(copy.document.title).toBe("Архетипы: игра");

    const published = await studio.publishInteractive(owner, copy.id, { idempotencyKey: randomUUID() });
    expect(published.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(published.status).toBe("ready");
    expect(published.stills).toBe("missing");
    expect(published.scenes).toBeGreaterThan(3);
    expect(published.manifestUrl).toContain(`/api/interactive/${published.token}/manifest`);

    const response = await interactiveManifestResponse(published.token);
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as InteractiveSnapshot;
    expect(interactiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(await interactiveSnapshotHash(snapshot)).toBe(snapshot.hash);
    expect(snapshot.document.interactive?.choices[0].id).toBe("favourite");
    expect(snapshot.scenes.some((s) => s.holds.length && s.choices.length === 3)).toBe(true);
    expect(snapshot.runtimeFonts.length).toBeGreaterThan(0);

    // Every listed file streams with its exact bytes; unknown names are 404.
    const font = snapshot.files.find((f) => f.kind === "font" && f.ext === ".ttf")!;
    const file = await interactiveFileResponse(published.token, `${font.hash}${font.ext}`, new Request("http://x/"));
    expect(file.status).toBe(200);
    expect(Number(file.headers.get("content-length"))).toBe(font.bytes);
    expect((await interactiveFileResponse(published.token, `${"0".repeat(64)}.png`, new Request("http://x/"))).status).toBe(404);
    expect((await interactiveFileResponse(published.token, "../secret.txt", new Request("http://x/"))).status).toBe(404);

    // Republishing the same revision keeps the token; unpublish kills the link.
    const again = await studio.publishInteractive(owner, copy.id);
    expect(again.token).toBe(published.token);
    expect(again.updated).toBe(false);
    expect((await studio.unpublishInteractive(owner, copy.id)).removed).toBe(true);
    expect((await interactiveManifestResponse(published.token)).status).toBe(404);
  });

  it("refuses projects without an interactive layer and other owners", async () => {
    const plain = await studio.createStudioProject(owner, {
      document: createVideoDocument({ kind: "top", participants: [{ id: "x", label: "X" }] }),
      idempotencyKey: randomUUID(),
    });
    await expect(studio.publishInteractive(owner, plain.id)).rejects.toMatchObject({ code: "INTERACTIVE_LAYER_MISSING" });
    const game = await studio.createStudioProject(owner, { document: archetypes(), idempotencyKey: randomUUID() });
    await expect(studio.publishInteractive(other, game.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(studio.copyStudioProject(other, game.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers 409 while scene stills are prepared", async () => {
    const game = await studio.createStudioProject(owner, { document: archetypes(), idempotencyKey: randomUUID() });
    const published = await studio.publishInteractive(owner, game.id);
    const job = await prisma.studioJob.create({
      data: { userId: owner, projectId: game.id, kind: "storyboard", engineId: "test", inputJson: "{}", status: "queued" },
    });
    await prisma.studioInteractivePublication.update({ where: { projectId: game.id }, data: { stillJobId: job.id } });
    expect((await studio.getInteractivePublication(owner, game.id))?.status).toBe("preparing");
    const pending = await interactiveManifestResponse(published.token);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toEqual({ error: "SNAPSHOT_NOT_READY" });
    await prisma.studioJob.update({ where: { id: job.id }, data: { status: "failed" } });
    expect((await interactiveManifestResponse(published.token)).status).toBe(200);
  });
});
