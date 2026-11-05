import { it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { deleteUser } from "@/server/users";
const ids: string[] = [];
afterAll(async () => {
  await prisma.track.updateMany({
    where: { tournament: { userId: { in: ids } } },
    data: { coverArtId: null },
  });
  await prisma.tournamentSegment.updateMany({
    where: { tournament: { userId: { in: ids } } },
    data: { posterArtId: null },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});
it("deletes an account whose pool image is both a track cover and a segment poster", async () => {
  const admin = await prisma.user.create({
    data: {
      email: `segments-delete-admin-${randomUUID()}@test.local`,
      passwordHash: "x",
      role: "admin",
    },
  });
  ids.push(admin.id);
  const user = await prisma.user.create({
    data: {
      email: `segments-delete-user-${randomUUID()}@test.local`,
      passwordHash: "x",
    },
  });
  ids.push(user.id);
  const art = await prisma.art.create({
    data: {
      userId: user.id,
      kind: "image",
      filePath: `arts/${user.id}/fixture.png`,
    },
  });
  const t = await prisma.tournament.create({
    data: { userId: user.id, title: "Account deletion", scheme: "merge" },
  });
  const segment = await prisma.tournamentSegment.create({
    data: {
      tournamentId: t.id,
      title: "Segment",
      order: 0,
      posterArtId: art.id,
    },
  });
  await prisma.track.create({
    data: {
      tournamentId: t.id,
      segmentId: segment.id,
      title: "Track",
      order: 0,
      filePath: `tournaments/${t.id}/track.mp3`,
      coverArtId: art.id,
    },
  });
  await deleteUser(admin.id, user.id);
  expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  expect(await prisma.art.findUnique({ where: { id: art.id } })).toBeNull();
});
