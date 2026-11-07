import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createArt } from "@/server/arts";
import { POST as upload } from "@/app/api/tournaments/route";
import { POST as inspect } from "@/app/api/tournaments/inspect/route";
import { GET as next } from "@/app/api/tournaments/[id]/next/route";
import { POST as compare } from "@/app/api/tournaments/[id]/compare/route";
import { POST as scheme } from "@/app/api/tournaments/[id]/scheme/route";
import { POST as tier } from "@/app/api/tournaments/[id]/tier/route";
import { POST as addItems, DELETE as deleteItems } from "@/app/api/tournaments/[id]/items/route";
import { PATCH as metadata } from "@/app/api/tracks/[id]/route";
import { GET as cover } from "@/app/api/tracks/[id]/cover/route";

// Task 33 HTTP contract: picture tournaments from archives and loose files,
// the algorithm chosen after creation, pick/tier answers, thumbnails and the
// composition endpoints.

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({
  requireUser: async () => {
    if (!session.id) throw new Error("UNAUTHENTICATED");
    return { id: session.id, email: "images-http@test.local", role: "admin" };
  },
}));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let userId = "";
const req = (p: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${p}`, {
    method,
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: { id } });

function zip(entries: Record<string, Buffer>) {
  const z = new AdmZip();
  for (const [name, data] of Object.entries(entries)) z.addFile(name, data);
  return z.toBuffer();
}
function form(files: { name: string; data: Buffer }[], fields: Record<string, string> = {}) {
  const f = new FormData();
  f.set("title", "Images");
  for (const file of files) f.append("file", new File([new Uint8Array(file.data)], file.name));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `images-http-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" },
    })
  ).id;
  session.id = userId;
});
async function clear() {
  for (const t of await prisma.tournament.findMany({ where: { userId } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.tournament.deleteMany({ where: { userId } });
  for (const a of await prisma.art.findMany({ where: { userId } })) await removePath(a.filePath);
  await prisma.art.deleteMany({ where: { userId } });
}
beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.user.deleteMany({ where: { id: userId } });
});

async function nextOf(id: string, segmentId?: string) {
  const res = await next(req(`/api/tournaments/${id}/next${segmentId ? `?segmentId=${segmentId}` : ""}`), ctx(id));
  expect(res.status).toBe(200);
  return res.json();
}

it("a picture archive becomes picture participants, split by folders, without a scheme", async () => {
  const data = zip({
    "Chars/Umineko/Beatrice.png": PNG,
    "Chars/Umineko/Battler.png": PNG,
    "Chars/Higurashi/Rika.png": PNG,
    "Chars/Higurashi/Mion.png": PNG,
  });
  const preview = await inspect(req("/api/tournaments/inspect", "POST", form([{ name: "c.zip", data }])));
  expect(await preview.json()).toEqual({
    folders: ["Higurashi", "Umineko"],
    trackCount: 4,
    imageCount: 4,
    kind: "images",
  });
  const res = await upload(req("/api/tournaments", "POST", form([{ name: "c.zip", data }], { splitFolders: "true" })));
  expect(res.status).toBe(200);
  const { id, trackCount } = await res.json();
  expect(trackCount).toBe(4);
  const tracks = await prisma.track.findMany({ where: { tournamentId: id }, orderBy: { title: "asc" } });
  expect(tracks.map((t) => t.title)).toEqual(["Battler", "Beatrice", "Mion", "Rika"]);
  expect(tracks.every((t) => t.kind === "image" && t.coverPath === t.filePath)).toBe(true);
  const step = await nextOf(id);
  expect(step.schemeRequired).toBe(true);
  expect(step.question).toBeNull();
  expect(step.kinds).toEqual(["image"]);
  expect(step.segmentCount).toBe(2);
});

it("creates from a draft of pool pictures split into segments", async () => {
  const arts = [];
  for (const label of ["Беатриче", "Батлер", "Рика"])
    arts.push(await createArt(userId, { fileName: `${label}.png`, data: PNG, label }));
  const f = form([]);
  f.set(
    "sources",
    JSON.stringify([
      { assetId: arts[0].id, segment: "Umineko", note: "главная" },
      { assetId: arts[1].id, segment: "Umineko" },
      { assetId: arts[2].id, segment: "Higurashi", subtitle: "2006" },
    ]),
  );
  const res = await upload(req("/api/tournaments", "POST", f));
  expect(res.status).toBe(200);
  const { id, skipped } = await res.json();
  expect(skipped).toEqual([]);
  const segments = await prisma.tournamentSegment.findMany({
    where: { tournamentId: id },
    orderBy: { order: "asc" },
    include: { tracks: { orderBy: { order: "asc" } } },
  });
  expect(segments.map((s) => [s.title, s.tracks.map((t) => t.title)])).toEqual([
    ["Umineko", ["Беатриче", "Батлер"]],
    ["Higurashi", ["Рика"]],
  ]);
  expect(segments[0].tracks[0].note).toBe("главная");
  expect(segments[1].tracks[0].subtitle).toBe("2006");
  const bad = form([]);
  bad.set("sources", JSON.stringify([{ assetId: arts[0].id, extra: 1 }]));
  expect((await upload(req("/api/tournaments", "POST", bad))).status).toBe(400);
});

it("an OST archive with covers stays a track archive", async () => {
  const data = zip({ "a.mp3": Buffer.from("fake"), "b.mp3": Buffer.from("fake"), "cover.jpg": PNG });
  const res = await upload(req("/api/tournaments", "POST", form([{ name: "ost.zip", data }], { scheme: "merge" })));
  const { id, trackCount } = await res.json();
  expect(trackCount).toBe(2);
  const step = await nextOf(id);
  expect(step.scheme).toBe("merge");
  expect(step.kinds).toEqual(["audio"]);
});

it("chooses the algorithm later and answers pick and tier screens", async () => {
  const files = ["a", "b", "c", "d", "e"].map((n) => ({ name: `${n}.png`, data: PNG }));
  const { id } = await (await upload(req("/api/tournaments", "POST", form(files)))).json();
  const bad = await scheme(req(`/api/tournaments/${id}/scheme`, "POST", { scheme: "top_k", settings: { k: 0 } }), ctx(id));
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toBe("Некорректные настройки алгоритма");
  expect(
    (await scheme(req(`/api/tournaments/${id}/scheme`, "POST", { scheme: "bracket", allSegments: true }), ctx(id))).status,
  ).toBe(200);
  await prisma.tournament.update({ where: { id }, data: { groupSize: 3 } });
  let step = await nextOf(id);
  expect(step.questionKind).toBe("pick");
  expect(step.question[0].imageUrl).toContain("/cover");
  expect(step.preload).toHaveLength(5);
  const wrong = await compare(req(`/api/tournaments/${id}/compare`, "POST", { pick: "nope" }), ctx(id));
  expect((await wrong.json()).error).toMatch(/Экран устарел/);
  const ok = await compare(req(`/api/tournaments/${id}/compare`, "POST", { pick: step.question[1].id }), ctx(id));
  expect(ok.status).toBe(200);

  await scheme(
    req(`/api/tournaments/${id}/scheme`, "POST", {
      scheme: "tiers",
      settings: { tiers: ["Топ", "Ок"], rankTop: 0 },
      allSegments: true,
    }),
    ctx(id),
  );
  step = await nextOf(id);
  expect(step.questionKind).toBe("tier");
  expect(step.tierNames).toEqual(["Топ", "Ок"]);
  const item = step.question[0].id;
  expect(
    (await compare(req(`/api/tournaments/${id}/compare`, "POST", { itemId: item, tier: 0 }), ctx(id))).status,
  ).toBe(200);
  const board = await tier(req(`/api/tournaments/${id}/tier`, "POST", { itemId: item, tier: 1 }), ctx(id));
  expect(await board.json()).toEqual({ ok: true, reopened: false });
  const batches = await prisma.comparisonBatch.findMany({ where: { tournamentId: id, kind: "tier" } });
  expect(batches.map((b) => b.tier)).toEqual([0, 1]);
});

it("excludes, adds and deletes participants over HTTP", async () => {
  const files = ["a", "b", "c"].map((n) => ({ name: `${n}.png`, data: PNG }));
  const { id } = await (
    await upload(req("/api/tournaments", "POST", form(files, { scheme: "insertion" })))
  ).json();
  const [first] = await prisma.track.findMany({ where: { tournamentId: id }, orderBy: { order: "asc" } });
  const patched = await metadata(
    req(`/api/tracks/${first.id}`, "PATCH", { excluded: true, subtitle: "Umineko", note: "главная роль" }),
    ctx(first.id),
  );
  expect(patched.status).toBe(200);
  const row = await prisma.track.findUniqueOrThrow({ where: { id: first.id } });
  expect([row.excluded, row.subtitle, row.note]).toEqual([true, "Umineko", "главная роль"]);
  expect((await nextOf(id)).itemCount).toBe(2);

  const add = new FormData();
  add.append("file", new File([new Uint8Array(PNG)], "Rika.png"));
  const added = await addItems(req(`/api/tournaments/${id}/items`, "POST", add), ctx(id));
  expect(added.status).toBe(200);
  const { added: ids } = await added.json();
  expect(ids).toHaveLength(1);
  expect((await nextOf(id)).itemCount).toBe(3);

  const del = await deleteItems(req(`/api/tournaments/${id}/items`, "DELETE", { trackIds: ids }), ctx(id));
  expect(await del.json()).toEqual({ requiresConfirmation: false, answersToReset: 0 });
  expect(await prisma.track.count({ where: { tournamentId: id } })).toBe(3);
});

it("serves a thumbnail for a big picture and the original for a small one", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thumb-"));
  try {
    const big = path.join(dir, "big.png");
    await promisify(execFile)(ffmpegPath as unknown as string, [
      "-y", "-f", "lavfi", "-i", "nullsrc=s=1600x1600,geq=random(1)*255:128:128", "-frames:v", "1", big,
    ]);
    const data = await readFile(big);
    expect(data.length).toBeGreaterThan(400 * 1024);
    const { id } = await (
      await upload(req("/api/tournaments", "POST", form([{ name: "Big.png", data }, { name: "Small.png", data: PNG }])))
    ).json();
    const tracks = await prisma.track.findMany({ where: { tournamentId: id }, orderBy: { order: "asc" } });
    const bigTrack = tracks.find((t) => t.title === "Big")!;
    const thumb = await cover(req(`/api/tracks/${bigTrack.id}/cover?art=own&size=thumb`), ctx(bigTrack.id));
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    const thumbBytes = Buffer.from(await thumb.arrayBuffer());
    expect(thumbBytes.length).toBeLessThan(data.length / 2);
    const small = tracks.find((t) => t.title === "Small")!;
    const orig = await cover(req(`/api/tracks/${small.id}/cover?art=own&size=thumb`), ctx(small.id));
    expect(orig.headers.get("content-type")).toBe("image/png");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("the site never reads the disk: a path source is refused on create and add; a foreign id is refused before work", async () => {
  const outside = path.join(process.cwd(), "package.json");
  const created = await upload(
    req("/api/tournaments", "POST", form([], { sources: JSON.stringify([{ path: outside }]) })),
  );
  expect(created.status).toBe(400);
  expect((await created.json()).error).toBe("Некорректный список участников");
  expect(await prisma.tournament.count({ where: { userId } })).toBe(0);

  const ok = await upload(req("/api/tournaments", "POST", form([{ name: "a.png", data: PNG }, { name: "b.png", data: PNG }])));
  const { id } = await ok.json();
  const before = await prisma.track.count({ where: { tournamentId: id } });
  const sources = new FormData();
  sources.set("sources", JSON.stringify([{ path: outside }]));
  const added = await addItems(req(`/api/tournaments/${id}/items`, "POST", sources), ctx(id));
  expect(added.status).toBe(400);
  expect(await prisma.track.count({ where: { tournamentId: id } })).toBe(before);

  const foreign = new FormData();
  foreign.set("sources", JSON.stringify([{ shikimori: { type: "character", id: 1 } }]));
  const missing = await addItems(req("/api/tournaments/not-mine/items", "POST", foreign), ctx("not-mine"));
  expect(missing.status).toBe(404);
});
