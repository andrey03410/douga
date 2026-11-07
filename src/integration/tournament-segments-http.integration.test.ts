import { afterAll, beforeAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";
import { removePath, saveFile } from "@/lib/storage";
import { POST as upload } from "@/app/api/tournaments/route";
import { POST as inspect } from "@/app/api/tournaments/inspect/route";
import {
  GET as segmentsGet,
  PUT as segmentsPut,
} from "@/app/api/tournaments/[id]/segments/route";
import { GET as next } from "@/app/api/tournaments/[id]/next/route";
import { POST as compare } from "@/app/api/tournaments/[id]/compare/route";
import { PATCH as metadata } from "@/app/api/tracks/[id]/route";
import { GET as cover } from "@/app/api/tracks/[id]/cover/route";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/auth", () => ({
  requireUser: async () => {
    if (!session.id) throw new Error("UNAUTHENTICATED");
    return { id: session.id, email: "http-segments@test.local", role: "admin" };
  },
}));
let userId: string, foreign: string;
const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
function archive(names: string[]) {
  const zip = new AdmZip();
  for (const name of names) zip.addFile(name, Buffer.from("fake audio"));
  return zip.toBuffer();
}
const form = (
  files: { name: string; names: string[] }[],
  fields: Record<string, string> = {},
) => {
  const f = new FormData();
  f.set("title", "HTTP segments");
  f.set("scheme", "round_robin");
  for (const file of files)
    f.append(
      "file",
      new File([new Uint8Array(archive(file.names))], file.name),
    );
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
beforeAll(async () => {
  for (const assign of [
    (id: string) => (userId = id),
    (id: string) => (foreign = id),
  ])
    assign(
      (
        await prisma.user.create({
          data: {
            email: `segments-http-${randomUUID()}@test.local`,
            passwordHash: "x",
            role: "admin",
          },
        })
      ).id,
    );
  session.id = userId;
});
afterAll(async () => {
  for (const t of await prisma.tournament.findMany({ where: { userId } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.user.deleteMany({ where: { id: { in: [userId, foreign] } } });
});
it("inspects wrapper folders and splits a single archive without losing singleton segments", async () => {
  const data = form(
    [
      {
        name: "OST.zip",
        names: ["OST/Episode 1/a.mp3", "OST/Episode 2/b.mp3"],
      },
    ],
    { splitFolders: "true" },
  );
  const preview = await inspect(req("/api/tournaments/inspect", "POST", data));
  expect(preview.status).toBe(200);
  expect(await preview.json()).toEqual({
    folders: ["Episode 1", "Episode 2"],
    trackCount: 2,
    imageCount: 0,
    kind: "media",
  });
  const result = await upload(req("/api/tournaments", "POST", data));
  expect(result.status).toBe(200);
  const { id } = await result.json();
  const value = await (
    await segmentsGet(req(`/api/tournaments/${id}/segments`), {
      params: { id },
    })
  ).json();
  expect(value.segments.map((s: { title: string }) => s.title)).toEqual([
    "Episode 1",
    "Episode 2",
  ]);
  expect(
    value.segments.every((s: { status: string }) => s.status === "completed"),
  ).toBe(true);
});
it("uploads multiple archives and routes answers by selected segment in query or body", async () => {
  const response = await upload(
    req(
      "/api/tournaments",
      "POST",
      form(
        [
          { name: "one.zip", names: ["a.mp3", "b.mp3"] },
          { name: "two.zip", names: ["c.mp3", "d.mp3"] },
        ],
        { segmentTitles: JSON.stringify(["One", "Two"]) },
      ),
    ),
  );
  const { id } = await response.json();
  const dto = await (
    await segmentsGet(req(`/api/tournaments/${id}/segments`), {
      params: { id },
    })
  ).json();
  const second = dto.segments[1].id;
  const step = await (
    await next(req(`/api/tournaments/${id}/next?segmentId=${second}`), {
      params: { id },
    })
  ).json();
  expect(step.activeSegmentId).toBe(second);
  expect(step.segmentTitle).toBe("Two");
  const answer = await compare(
    req(`/api/tournaments/${id}/compare`, "POST", {
      segmentId: second,
      ranked: step.question.map((q: { id: string }) => q.id),
      rest: [],
    }),
    { params: { id } },
  );
  expect(answer.status).toBe(200);
  const loaded = await (
    await segmentsGet(req(`/api/tournaments/${id}/segments`), {
      params: { id },
    })
  ).json();
  expect(
    loaded.segments.map((s: { answeredScreens: number }) => s.answeredScreens),
  ).toEqual([0, 1]);
  const bad = await segmentsPut(
    req(`/api/tournaments/${id}/segments`, "PUT", {
      segments: [{ id: dto.segments[0].id, title: "Bad", trackIds: [] }],
    }),
    { params: { id } },
  );
  expect(bad.status).toBe(400);
  const trackId = loaded.segments[0].tracks[0].id;
  const patch = await metadata(
    req(`/api/tracks/${trackId}`, "PATCH", {
      title: "Fixed",
      comment: "My comment",
      bestMomentSec: 0,
    }),
    { params: { id: trackId } },
  );
  expect(await patch.json()).toMatchObject({
    title: "Fixed",
    comment: "My comment",
    bestMomentSec: 0,
  });
  const rel = await saveFile(
    `tournaments/${id}/cover.png`,
    Buffer.from("test cover"),
  );
  await prisma.track.update({
    where: { id: trackId },
    data: { coverPath: rel },
  });
  const image = await cover(req(`/api/tracks/${trackId}/cover`), {
    params: { id: trackId },
  });
  expect(image.status).toBe(200);
  expect(image.headers.get("cache-control")).toContain("no-cache");
  expect(image.headers.get("content-type")).toBe("image/png");
  session.id = foreign;
  expect(
    (
      await cover(req(`/api/tracks/${trackId}/cover`), {
        params: { id: trackId },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await metadata(
        req(`/api/tracks/${trackId}`, "PATCH", { title: "stolen" }),
        { params: { id: trackId } },
      )
    ).status,
  ).toBe(404);
  session.id = userId;
});
it("requires authentication to inspect private archive structure", async () => {
  session.id = "";
  expect(
    (
      await inspect(
        req(
          "/api/tournaments/inspect",
          "POST",
          form([{ name: "a.zip", names: ["a.mp3"] }]),
        ),
      )
    ).status,
  ).toBe(401);
  session.id = userId;
});
