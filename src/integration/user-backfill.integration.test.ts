import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { absPath, removePath, saveFile } from "@/lib/storage";

// Coordinate a real deletion at the filesystem boundary, after the legacy row
// has been read and before its measured size is written back to the database.
const race = vi.hoisted(() => ({ path: "", remove: null as null | (() => Promise<unknown>) }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    stat: async (...args: Parameters<typeof fs.stat>) => {
      const result = await fs.stat(...args);
      if (String(args[0]) === race.path && race.remove) {
        const remove = race.remove;
        race.remove = null;
        await remove();
      }
      return result;
    },
  };
});

import { usageSummary } from "@/server/users";

const email = "backfill-race@test.local";
const file = "tmp/backfill-race.bin";

afterEach(async () => {
  race.path = "";
  race.remove = null;
  await prisma.user.deleteMany({ where: { email } });
  await removePath(file);
});

describe("legacy size backfill during concurrent deletion", () => {
  it.each(["track", "art", "render"] as const)("keeps the account usable when a %s disappears", async (kind) => {
    const user = await prisma.user.create({ data: { email, passwordHash: "test" } });
    const tournament = await prisma.tournament.create({
      data: { userId: user.id, title: "Backfill race", scheme: "merge" },
    });
    await saveFile(file, Buffer.alloc(24));
    if (kind === "track") {
      const row = await prisma.track.create({
        data: { tournamentId: tournament.id, title: "A", filePath: file, order: 0 },
      });
      race.remove = () => prisma.track.delete({ where: { id: row.id } });
    } else if (kind === "art") {
      const row = await prisma.art.create({ data: { userId: user.id, filePath: file } });
      race.remove = () => prisma.art.delete({ where: { id: row.id } });
    } else {
      const row = await prisma.renderJob.create({
        data: { tournamentId: tournament.id, status: "done", outputPath: file },
      });
      race.remove = () => prisma.renderJob.delete({ where: { id: row.id } });
    }
    race.path = absPath(file);
    const summary = await usageSummary(user.id);
    expect(summary.pool.count).toBe(0);
    expect(summary.archives.bytes).toBe(0);
    expect(summary.renders.count).toBe(0);
  });
});
