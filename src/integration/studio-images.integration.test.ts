import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import type { ExtractedTrack } from "@/lib/upload";
import {
  createTournament,
  finalize,
  getTournament,
  nextComparison,
  recordAnswer,
  setSegmentScheme,
} from "@/server/tournaments";
import { createStudioProjectFromPreset, deleteStudioProject } from "@/server/studio/projects";
import { listStudioSources } from "@/server/studio/queries";
import { evaluate, resolveAssets } from "@/server/studio/assets";

// Task 33 (T16, P23): a tournament of pictures becomes an SDK source whose
// participants are images without sound, named by title, with subtitle, link
// and tier from the tournament; the project compiles with the cover visuals.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let owner = "";

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { email: `studio-images-${randomUUID()}@test.local`, passwordHash: "x", role: "admin" },
    })
  ).id;
});
afterAll(async () => {
  for (const p of await prisma.studioProject.findMany({ where: { userId: owner } }))
    await deleteStudioProject(owner, p.id);
  for (const t of await prisma.tournament.findMany({ where: { userId: owner } }))
    await removePath(`tournaments/${t.id}`);
  await prisma.tournament.deleteMany({ where: { userId: owner } });
  await prisma.user.deleteMany({ where: { id: owner } });
});

const picture = (title: string, subtitle: string, id: number): ExtractedTrack => ({
  filename: `shikimori-character-${id}.png`,
  kind: "image",
  title,
  artist: null,
  durationSec: null,
  data: PNG,
  subtitle,
  sourceUrl: `https://shikimori.one/characters/${id}`,
  sourceKey: `shikimori:character:${id}`,
  note: "главная роль",
});

it("a finished picture tier list becomes a silent SDK source with names, subtitles, links and tiers", async () => {
  const created = await createTournament(owner, { title: "Героини", blindMode: false, groupSize: 3 }, [
    picture("Беатриче", "Umineko", 1),
    picture("Рика Фурудэ", "Higurashi", 2),
    picture("Нана Осаки", "Nana", 3),
    picture("Мион Сонодзаки", "Higurashi", 4),
  ]);
  await setSegmentScheme(owner, created.id, {
    scheme: "tiers",
    settings: { tiers: ["Топ", "Ок", "Мимо"], rankTop: 1 },
  });
  // The person's answers: two in the top tier, one okay, one out.
  const plan: Record<string, number> = { Беатриче: 0, "Рика Фурудэ": 0, "Нана Осаки": 1, "Мион Сонодзаки": -1 };
  for (let i = 0; i < 20; i++) {
    const t = (await getTournament(owner, created.id))!;
    const step = nextComparison(t);
    if (!step.question) break;
    const byId = new Map(t.tracks.map((tr) => [tr.id, tr.title]));
    if (step.questionKind === "tier")
      await recordAnswer(t, { kind: "tier", itemId: step.question[0], tier: plan[byId.get(step.question[0])!] });
    else {
      const order = ["Беатриче", "Рика Фурудэ"];
      const ranked = [...step.question].sort((a, b) => order.indexOf(byId.get(a)!) - order.indexOf(byId.get(b)!));
      await recordAnswer(t, { kind: "rank", ranked, rest: [] });
    }
  }
  const done = (await getTournament(owner, created.id))!;
  expect(nextComparison(done).isComplete).toBe(true);
  await finalize(done, 10);

  const sources = await listStudioSources(owner);
  const source = sources.items.find((s) => s.id === created.id)!;
  expect(source).toMatchObject({ kinds: ["image"], needsMusic: true });
  expect(source.segments[0].kinds).toEqual(["image"]);

  const project = await createStudioProjectFromPreset(owner, {
    presetId: "top.classic.wide",
    sourceId: created.id,
    title: "Героини",
  });
  const people = project.document.source.participants;
  // only strict places go into the video: the top tier, ordered by the person
  expect(people.map((p) => [p.rank, p.label, p.subtitle, p.tier, p.kind])).toEqual([
    [1, "Беатриче", "Umineko", "Топ", "image"],
    [2, "Рика Фурудэ", "Higurashi", "Топ", "image"],
  ]);
  expect(people[0].link).toBe("https://shikimori.one/characters/1");
  for (const p of people) {
    expect(p.media).toEqual({ visual: `source:${p.id}:cover` });
    expect(project.document.bindings[`source:${p.id}`]).toBeUndefined();
    expect(project.document.bindings[`source:${p.id}:cover`]).toMatchObject({ kind: "track", media: "cover" });
  }
  const assets = await resolveAssets(owner, project.document);
  expect(assets.diagnostics).toEqual([]);
  expect(assets.manifest[`source:${people[0].id}:cover`]).toMatchObject({ kind: "image", width: 1, height: 1 });
  const evaluated = await evaluate(owner, project.document);
  expect(evaluated.validation).toEqual({ ready: true, diagnostics: [] });
  // no participant has sound of its own: nothing but the preset's own cues may play
  expect(evaluated.plan!.audio.filter((a) => people.some((p) => a.asset.id === p.id))).toEqual([]);
  expect(evaluated.plan!.audio.filter((a) => a.role === "primary")).toEqual([]);
});
