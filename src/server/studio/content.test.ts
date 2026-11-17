import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { absPath } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { removePath } from "@/lib/storage";
import { createVideoDocument } from "@douga/video/builders";
import {
  createStudioProject,
  deleteStudioProject,
  transformStudioDraft,
} from "./projects";
import { setStudioContent } from "./content";
import { selectStudioRecipes } from "./recipes";
import { StudioError } from "./errors";
import * as source from "./sources";
let owner: string,
  other: string,
  project: string,
  audio: string,
  image: string,
  foreignAudio: string;
const extraProjects: string[] = [];
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: {
        email: `content-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "admin",
      },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: {
        email: `other-content-${randomUUID()}@test.local`,
        passwordHash: "x",
        role: "user",
      },
    })
  ).id;
  const wave = Buffer.alloc(44 + 16000);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(16000, 40);
  await mkdir(absPath(`studio/${owner}`), { recursive: true });
  await writeFile(absPath(`studio/${owner}/content-test.wav`), wave);
  audio = (
    await prisma.art.create({
      data: {
        userId: owner,
        filePath: `studio/${owner}/content-test.wav`,
        kind: "audio",
        hasAudio: true,
        durationSec: 1,
      },
    })
  ).id;
  await writeFile(
    absPath(`studio/${owner}/content-test.png`),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  image = (
    await prisma.art.create({
      data: {
        userId: owner,
        filePath: `studio/${owner}/content-test.png`,
        kind: "image",
      },
    })
  ).id;
  foreignAudio = (
    await prisma.art.create({
      data: {
        userId: other,
        filePath: `studio/${owner}/content-test.wav`,
        kind: "audio",
        hasAudio: true,
        durationSec: 1,
      },
    })
  ).id;
  project = (
    await createStudioProject(owner, {
      document: createVideoDocument({ kind: "top" }),
    })
  ).id;
});
afterAll(async () => {
  for (const id of extraProjects) await deleteStudioProject(owner, id);
  if (project) await deleteStudioProject(owner, project);
  for (const id of [owner, other])
    if (id) {
      await prisma.user.delete({ where: { id } });
      await removePath(`studio/${id}`);
    }
});
it("persists named groups, explicit group answers and per-round media with atomic replay", async () => {
  const created = await createStudioProject(owner, {
    document: createVideoDocument({ kind: "picker", roundCount: 0 }),
  });
  extraProjects.push(created.id);
  const input = {
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
    content: {
      kind: "picker" as const,
      mode: "replace" as const,
      participants: [
        {
          id: "a",
          label: "A",
          subtitle: "Anime A",
          kind: "image" as const,
          tier: "S",
          visualAssetId: image,
        },
        { id: "b", label: "B", visualAssetId: image },
      ],
      rounds: [
        {
          id: "r",
          cards: [
            { id: "ca", participantId: "a" },
            { id: "cb", participantId: "b" },
          ],
          groups: [{ id: "g", label: "Команда", cardIds: ["ca", "cb"] }],
          answerGroupIds: ["g"],
          musicAssetId: audio,
          backgroundAssetId: image,
        },
      ],
    },
  };
  const saved = await setStudioContent(owner, created.id, input);
  expect(saved.validation.ready).toBe(true);
  const document = saved.draft!.document as typeof saved.document;
  expect(document.source.participants[0]).toMatchObject({
    subtitle: "Anime A",
    kind: "image",
    tier: "S",
  });
  expect(document.source.rounds[0]).toMatchObject({
    groups: [{ id: "g", label: "Команда", cardIds: ["ca", "cb"] }],
    answer: { groupIds: ["g"] },
  });
  expect(saved.plan!.audio.some((cue) => cue.asset.id === audio)).toBe(true);
  expect(await setStudioContent(owner, created.id, input)).toEqual(saved);
  const refs = await prisma.studioAssetReference.findMany({
    where: { projectId: created.id, scope: "draft" },
  });
  expect(refs.map((ref) => ref.artId)).toEqual(
    expect.arrayContaining([image, audio]),
  );
  const cleared = await setStudioContent(owner, created.id, {
    expectedVersion: saved.version,
    content: {
      kind: "picker",
      mode: "merge",
      rounds: [
        {
          id: "r",
          musicAssetId: null,
          backgroundAssetId: null,
          answerGroupIds: null,
        },
      ],
    },
  });
  expect(
    (cleared.draft!.document as typeof document).source.rounds[0],
  ).toMatchObject({ music: null });
  expect(
    (cleared.draft!.document as typeof document).source.rounds[0].background,
  ).toBeUndefined();
  expect(
    (cleared.draft!.document as typeof document).source.rounds[0].answer,
  ).toBeUndefined();
  expect(cleared.plan!.audio.some((cue) => cue.asset.id === audio)).toBe(false);
});
it.each([
  "foreign-music",
  "foreign-background",
  "image-music",
  "audio-background",
  "unused-image-audio",
  "unused-audio-visual",
] as const)(
  "rejects %s without writing draft, references or receipt",
  async (reason) => {
    const created = await createStudioProject(owner, {
      document: createVideoDocument({
        kind: "picker",
        roundCount: 1,
        cardsPerRound: 1,
      }),
    });
    extraProjects.push(created.id);
    const before = await prisma.studioProject.findUniqueOrThrow({
      where: { id: created.id },
    });
    const referenceCount = await prisma.studioAssetReference.count({
      where: { projectId: created.id },
    });
    const idempotencyKey = randomUUID();
    const round = {
      id: "round-1",
      ...(reason === "foreign-music"
        ? { musicAssetId: foreignAudio }
        : reason === "foreign-background"
          ? { backgroundAssetId: foreignAudio }
          : reason === "image-music"
            ? { musicAssetId: image }
            : reason === "audio-background"
              ? { backgroundAssetId: audio }
              : {}),
    };
    await expect(
      setStudioContent(owner, created.id, {
        expectedVersion: created.version,
        idempotencyKey,
        content: {
          kind: "picker",
          mode: "merge",
          rounds: [round],
          ...(reason === "unused-image-audio"
            ? {
                participants: [
                  { id: "not-on-screen", label: "Unused", audioAssetId: image },
                ],
              }
            : reason === "unused-audio-visual"
              ? {
                  participants: [
                    {
                      id: "not-on-screen",
                      label: "Unused",
                      visualAssetId: audio,
                    },
                  ],
                }
              : {}),
        },
      }),
    ).rejects.toMatchObject(
      reason.startsWith("foreign")
        ? { code: "ASSET_NOT_FOUND" }
        : {
            code: "VALIDATION_FAILED",
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "ASSET_KIND_MISMATCH" }),
            ]),
          },
    );
    expect(
      await prisma.studioProject.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).toEqual(before);
    expect(
      await prisma.studioAssetReference.count({
        where: { projectId: created.id },
      }),
    ).toBe(referenceCount);
    expect(
      await prisma.studioMutation.count({
        where: { userId: owner, key: idempotencyKey },
      }),
    ).toBe(0);
  },
);
it("rejects broken group references and only one simultaneous grouped mutation commits", async () => {
  const created = await createStudioProject(owner, {
    document: createVideoDocument({
      kind: "picker",
      roundCount: 1,
      cardsPerRound: 1,
    }),
  });
  extraProjects.push(created.id);
  const cardId = created.document.source.rounds[0].cards[0].id;
  await expect(
    setStudioContent(owner, created.id, {
      expectedVersion: created.version,
      content: {
        kind: "picker",
        mode: "merge",
        rounds: [
          { id: "round-1", groups: [{ id: "g", cardIds: ["missing"] }] },
        ],
      },
    }),
  ).rejects.toMatchObject({ code: "CONTENT_GROUP_REFERENCE_INVALID" });
  const results = await Promise.allSettled(
    ["A", "B"].map((label) =>
      setStudioContent(owner, created.id, {
        expectedVersion: created.version,
        content: {
          kind: "picker",
          mode: "merge",
          rounds: [
            { id: "round-1", groups: [{ id: "g", label, cardIds: [cardId] }] },
          ],
        },
      }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "VERSION_CONFLICT" },
  });
  const stored = await prisma.studioProject.findUniqueOrThrow({
    where: { id: created.id },
  });
  expect(stored.version).toBe(created.version + 1);
});
it("saves a semantic tier distribution and rejects contradictory membership atomically", async () => {
  const created = await createStudioProject(owner, {
    document: createVideoDocument({
      kind: "board",
      presetId: "board.tier.wide",
      roundCount: 0,
    }),
  });
  extraProjects.push(created.id);
  const saved = await setStudioContent(owner, created.id, {
    expectedVersion: created.version,
    content: {
      kind: "board",
      mode: "replace",
      participants: [{ id: "p", label: "Герой", visualAssetId: image }],
      tiers: [
        { id: "s", label: "Любимые", participantIds: ["p"] },
        { id: "a", label: "Хорошие", participantIds: [] },
      ],
    },
  });
  expect(saved.validation.ready).toBe(true);
  const document = saved.draft!.document as typeof saved.document;
  const board = document.segments![0].scenes[0].board!;
  expect(board.slots.map((slot) => slot.label)).toEqual(["Любимые", "Хорошие"]);
  expect(board.rounds.flatMap((round) => round.actions)).toEqual([
    expect.objectContaining({ type: "place", slotId: "s" }),
  ]);
  expect(
    saved.plan!.scenes.some((scene) =>
      scene.boardEvents?.some(
        (event) => event.event === "board.summary" && event.slotId === "s",
      ),
    ),
  ).toBe(true);
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: created.id },
  });
  await expect(
    setStudioContent(owner, created.id, {
      expectedVersion: saved.version,
      content: {
        kind: "board",
        mode: "merge",
        tiers: [{ id: "a", participantIds: ["p"] }],
      },
    }),
  ).rejects.toMatchObject({ code: "CONTENT_TIER_PARTICIPANT_REPEATED" });
  expect(
    await prisma.studioProject.findUniqueOrThrow({ where: { id: created.id } }),
  ).toEqual(before);
});
it("sets content atomically with replay and rejects stale or foreign mutations", async () => {
  const before = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const input = {
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    content: {
      kind: "top" as const,
      mode: "merge" as const,
      title: "Новое имя",
    },
  };
  const result = await setStudioContent(owner, project, input);
  expect(result.version).toBe(before.version + 1);
  expect(result.draft!.document).toMatchObject({ title: "Новое имя" });
  expect(result.revision).toBe(before.revision);
  expect((await setStudioContent(owner, project, input)).version).toBe(
    result.version,
  );
  await expect(
    setStudioContent(owner, project, {
      ...input,
      content: { ...input.content, title: "Другое" },
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    setStudioContent(owner, project, { ...input, idempotencyKey: undefined }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    setStudioContent(other, project, {
      ...input,
      expectedVersion: result.version,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .version,
  ).toBe(result.version);
});
it("does not source-reconcile stale content or overwrite after a concurrent mutation", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const spy = vi.spyOn(source, "reconcileSource");
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version - 1,
      content: { kind: "top", mode: "merge", title: "Stale" },
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  const inputs = ["One", "Two"].map((title) => ({
    expectedVersion: row.version,
    content: { kind: "top" as const, mode: "merge" as const, title },
  }));
  const results = await Promise.allSettled(
    inputs.map((input) => setStudioContent(owner, project, input)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("checks asset ownership instead of saving unauthorized assignments", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: {
        kind: "top",
        mode: "merge",
        participants: [{ id: "participant-1", visualAssetId: "not-owned" }],
      },
    }),
  ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .version,
  ).toBe(row.version);
});
it("rejects an owned audio asset assigned as a visual without changing the draft", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: {
        kind: "top",
        mode: "merge",
        participants: [{ id: "participant-1", visualAssetId: audio }],
      },
    }),
  ).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "ASSET_KIND_MISMATCH" }),
    ]),
  });
  expect(
    (await prisma.studioProject.findUniqueOrThrow({ where: { id: project } }))
      .draftText,
  ).toBe(row.draftText);
});
it("binds internal transform receipts to the full trusted identity", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  const input = {
    expectedVersion: row.version,
    idempotencyKey: randomUUID(),
    identity: { fixes: ["a"] },
  };
  const result = await transformStudioDraft(owner, project, input, (doc) => ({
    ...doc,
    title: "Transform",
  }));
  expect(result.draft!.document).toMatchObject({ title: "Transform" });
  await expect(
    transformStudioDraft(
      owner,
      project,
      { ...input, identity: { fixes: ["b"] } },
      (doc) => doc,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("recommends at most three compatible metadata cards and explains unsupported requests", async () => {
  const result = await selectStudioRecipes(owner, {
    kind: "picker",
    format: "vertical",
  });
  expect(result.items.length).toBeLessThanOrEqual(3);
  expect(result.recommended).toBe("composition.picker.vertical");
  expect(
    result.items.every((r) => r.kind === "picker" && r.format === "vertical"),
  ).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(12000);
  const unsupported = await selectStudioRecipes(owner, {
    kind: "board",
    style: "cinematic",
  });
  expect(unsupported.items).toEqual([]);
  expect(unsupported.reason).toBeTruthy();
  expect(unsupported.alternatives).toContain("composition.tier-list.wide");
});

it("returns domain content errors through the normal Studio error contract", async () => {
  const row = await prisma.studioProject.findUniqueOrThrow({
    where: { id: project },
  });
  await expect(
    setStudioContent(owner, project, {
      expectedVersion: row.version,
      content: { kind: "picker", mode: "merge", title: "Wrong" },
    }),
  ).rejects.toBeInstanceOf(StudioError);
});
