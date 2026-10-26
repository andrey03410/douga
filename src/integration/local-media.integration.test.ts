import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, mkdir, symlink, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { absPath, removePath } from "@/lib/storage";
import { listLocalMedia, importLocalMedia, mediaDirs } from "@/server/local-media";

// Integration tests for the local-disk import (phase 15) on real files: the
// allowlist, kind filtering, quota and — most important — that the user's
// original files survive the import.

const EMAIL = "integration-local-media@test.local";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const FFMPEG = ffmpegPath as unknown as string;
function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-300)}`)),
    );
  });
}

let userId: string;
let root: string; // allowlisted directory
let outside: string; // directory outside the allowlist
let mp3: string;
let jpg: string;
let txt: string;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  for (const u of users) await removePath(`arts/${u.id}`);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  userId = user.id;

  const base = await realpath(await mkdtemp(path.join(tmpdir(), "local-media-")));
  root = path.join(base, "ost");
  outside = path.join(base, "secrets");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(path.join(root, "nested"), { recursive: true });

  mp3 = path.join(root, "01. Nagisa.mp3");
  jpg = path.join(root, "cover.jpg");
  txt = path.join(root, "notes.txt");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", mp3]);
  await writeFile(jpg, PNG);
  await writeFile(txt, "not media");
  await writeFile(path.join(outside, "passwords.mp3"), "secret");
  await writeFile(path.join(root, ".hidden.mp3"), "junk");
  await symlink(path.join(outside, "passwords.mp3"), path.join(root, "escape.mp3"));

  process.env.MCP_LOCAL_MEDIA_DIRS = root;
});

afterAll(async () => {
  delete process.env.MCP_LOCAL_MEDIA_DIRS;
  await cleanup();
});

describe("allowlist", () => {
  it("reads the roots from the environment", () => {
    expect(mediaDirs()).toEqual([root]);
  });

  it("without the env var every call is refused", async () => {
    const saved = process.env.MCP_LOCAL_MEDIA_DIRS;
    delete process.env.MCP_LOCAL_MEDIA_DIRS;
    await expect(listLocalMedia(root)).rejects.toThrow("LOCAL_MEDIA_DISABLED");
    process.env.MCP_LOCAL_MEDIA_DIRS = saved;
  });

  it("refuses a directory outside the roots", async () => {
    await expect(listLocalMedia(outside)).rejects.toThrow("PATH_NOT_ALLOWED");
    await expect(listLocalMedia(path.join(root, "..", "secrets"))).rejects.toThrow(
      "PATH_NOT_ALLOWED",
    );
  });

  it("refuses a file at all when it is not a directory", async () => {
    await expect(listLocalMedia(mp3)).rejects.toThrow("NOT_A_DIR");
  });
});

describe("listLocalMedia", () => {
  it("lists only supported media of the directory itself, sorted by name", async () => {
    const { dir, files } = await listLocalMedia(root);
    expect(dir).toBe(root);
    expect(files.map((f) => f.name)).toEqual(["01. Nagisa.mp3", "cover.jpg", "escape.mp3"]);
    const track = files[0];
    expect(track.kind).toBe("audio");
    expect(track.path).toBe(mp3);
    expect(track.sizeBytes).toBeGreaterThan(1000);
    expect(files[1].kind).toBe("image");
  });
});

describe("importLocalMedia", () => {
  it("imports a track, probes it and leaves the original file in place", async () => {
    const { items, failed } = await importLocalMedia(userId, { paths: [mp3, jpg] });
    expect(failed).toEqual([]);
    expect(items).toHaveLength(2);

    const track = items.find((i) => i.kind === "audio")!;
    expect(track.label).toBe("01. Nagisa");
    expect(track.durationSec).toBeGreaterThan(1.5);
    expect(track.durationSec).toBeLessThan(2.5);
    const row = await prisma.art.findUnique({ where: { id: track.artId } });
    expect(existsSync(absPath(row!.filePath))).toBe(true);

    // the user's own files must survive
    expect(existsSync(mp3)).toBe(true);
    expect(existsSync(jpg)).toBe(true);
  });

  it("reports per-file failures and still imports the good ones", async () => {
    const { items, failed } = await importLocalMedia(userId, {
      paths: [txt, path.join(outside, "passwords.mp3"), path.join(root, "missing.mp3"), jpg],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("image");
    expect(failed).toEqual([
      { path: txt, error: "BAD_EXT" },
      { path: path.join(outside, "passwords.mp3"), error: "PATH_NOT_ALLOWED" },
      { path: path.join(root, "missing.mp3"), error: "NOT_FOUND" },
    ]);
  });

  it("does not let a symlink smuggle a file from outside the roots", async () => {
    const { items, failed } = await importLocalMedia(userId, {
      paths: [path.join(root, "escape.mp3")],
    });
    expect(items).toEqual([]);
    expect(failed).toEqual([{ path: path.join(root, "escape.mp3"), error: "PATH_NOT_ALLOWED" }]);
  });

  it("respects the pool quota and leaves no temp copy behind", async () => {
    const before = await prisma.art.count({ where: { userId } });
    const { items, failed } = await importLocalMedia(userId, { paths: [mp3], maxPoolBytes: 10 });
    expect(items).toEqual([]);
    expect(failed).toEqual([{ path: mp3, error: "POOL_QUOTA" }]);
    expect(await prisma.art.count({ where: { userId } })).toBe(before);

    const leftovers = await readdir(absPath("tmp")).catch(() => []);
    expect(leftovers.filter((f) => f.startsWith("local-"))).toEqual([]);
  });

  it("refuses an absurd batch instead of importing thousands of files", async () => {
    const paths = Array.from({ length: 51 }, (_, i) => path.join(root, `t${i}.mp3`));
    await expect(importLocalMedia(userId, { paths })).rejects.toThrow("TOO_MANY_FILES");
  });
});
