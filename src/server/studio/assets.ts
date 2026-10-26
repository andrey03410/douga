import { preflightVideoResources } from "@/video/resource-limits";
import "server-only";
import path from "node:path";
import { createReadStream } from "node:fs";
import {
  mkdir,
  copyFile,
  realpath,
  stat,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { VERSION } from "remotion";
import { prisma } from "@/lib/db";
import { absPath, STORAGE_ROOT } from "@/lib/storage";
import { findActiveSnippet, probeMediaInfo } from "@/lib/audio";
import {
  collectVideoAssetKeys,
  compileVideo,
  videoDocumentSchema,
  type AssetManifest,
  type VideoDocument,
  type Diagnostic,
  type AssetBinding,
  type VideoNode,
  type VideoScene,
  type Participant,
} from "@/video";
import { mergeSettings } from "@/video/settings";
import { actor, type Db } from "./shared";
import { StudioError } from "./errors";
import { studioManifestModeSchema } from "./types";
import type {
  StudioFile,
  StudioManifestMode,
  StudioRuntime,
  StudioValidation,
} from "./types";

export const runtime: StudioRuntime = {
  schemaVersion: 1,
  compilerVersion: "1.0.0",
  fontFamily: '"Arial", "Helvetica Neue", sans-serif',
  remotionVersion: VERSION,
};
export async function safeFile(relative: string): Promise<string> {
  const root = await realpath(STORAGE_ROOT);
  const file = await realpath(absPath(relative));
  if (!file.startsWith(root + path.sep))
    throw new StudioError("ASSET_PATH_INVALID");
  if (!(await stat(file)).isFile()) throw new StudioError("ASSET_FILE_MISSING");
  return file;
}
export async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function ffmpeg(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve(err));
  });
}
async function builtin(name: string) {
  const relative = `studio/builtin/${name}.wav`;
  try {
    await safeFile(relative);
  } catch {
    await mkdir(path.dirname(absPath(relative)), { recursive: true });
    const tmp = absPath(`studio/builtin/${randomUUID()}.wav`);
    await ffmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${name === "tick" ? 1300 : name === "reveal" ? 880 : 660}:duration=${name === "tick" ? 0.12 : 0.4}`,
      "-af",
      "afade=t=out:st=0.03:d=0.09",
      tmp,
    ]);
    await rename(tmp, absPath(relative));
  }
  return relative;
}
/** References are intentionally recovered before schema validation, including unused bindings. */
export async function references(
  userId: string,
  value: unknown,
  db: Db = prisma,
) {
  const refs: { artId?: string; trackId?: string; tournamentId?: string }[] =
    [];
  if (!value || typeof value !== "object") return refs;
  const input = value as {
    bindings?: unknown;
    source?: { kind?: string; tournamentId?: unknown };
  };
  if (
    input.source?.kind === "tournament" &&
    typeof input.source.tournamentId === "string"
  ) {
    if (
      !(await db.tournament.findFirst({
        where: { id: input.source.tournamentId, userId },
      }))
    )
      throw new StudioError("SOURCE_NOT_FOUND");
    refs.push({ tournamentId: input.source.tournamentId });
  }
  if (input.bindings && typeof input.bindings === "object")
    for (const raw of Object.values(input.bindings)) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as {
        kind?: unknown;
        assetId?: unknown;
        trackId?: unknown;
        tournamentId?: unknown;
      };
      // A malformed hash/style must never disable protection of an identifiable owned file.
      if (b.kind === "pool" && typeof b.assetId === "string") {
        if (!(await db.art.findFirst({ where: { id: b.assetId, userId } })))
          throw new StudioError("ASSET_NOT_FOUND");
        refs.push({ artId: b.assetId });
      } else if (
        b.kind === "track" &&
        typeof b.trackId === "string" &&
        typeof b.tournamentId === "string"
      ) {
        if (
          !(await db.track.findFirst({
            where: {
              id: b.trackId,
              tournamentId: b.tournamentId,
              tournament: { userId },
            },
          }))
        )
          throw new StudioError("ASSET_NOT_FOUND");
        refs.push({ trackId: b.trackId, tournamentId: b.tournamentId });
      }
    }
  return [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()];
}
export async function setReferences(
  db: Db,
  userId: string,
  projectId: string,
  scope: string,
  value: unknown,
  retain = false,
) {
  const refs = await references(userId, value, db);
  if (!retain)
    await db.studioAssetReference.deleteMany({ where: { projectId, scope } });
  const old = retain
    ? await db.studioAssetReference.findMany({ where: { projectId, scope } })
    : [];
  for (const r of refs)
    if (
      !old.some(
        (o) =>
          (o.artId ?? undefined) === r.artId &&
          (o.trackId ?? undefined) === r.trackId &&
          (o.tournamentId ?? undefined) === r.tournamentId,
      )
    )
      await db.studioAssetReference.create({
        data: { projectId, scope, ...r },
      });
}
async function bindingFile(userId: string, b: AssetBinding) {
  if (b.kind === "builtin")
    return {
      id: `builtin:${b.name}`,
      kind: "audio" as const,
      filePath: await builtin(b.name),
      posterPath: null,
    };
  if (b.kind === "pool") {
    const a = await prisma.art.findFirst({ where: { id: b.assetId, userId } });
    if (!a) throw new StudioError("ASSET_NOT_FOUND");
    return a;
  }
  const t = await prisma.track.findFirst({
    where: {
      id: b.trackId,
      tournamentId: b.tournamentId,
      tournament: { userId },
    },
  });
  if (!t) throw new StudioError("ASSET_NOT_FOUND");
  return { ...t, posterPath: null };
}
export async function resolveAssets(
  userId: string,
  document: VideoDocument,
  mode: StudioManifestMode = "url",
  directory?: string,
) {
  await actor(userId);
  await references(userId, document);
  const manifest: AssetManifest = {};
  const files: Record<string, StudioFile> = {};
  const diagnostics: Diagnostic[] = [];
  for (const key of collectVideoAssetKeys(document)) {
    const binding = document.bindings[key];
    if (!binding) continue;
    try {
      const row = await bindingFile(userId, binding);
      let relative = row.filePath;
      const source = await safeFile(relative);
      const digest = await fileHash(source);
      if ("hash" in binding && binding.hash && binding.hash !== digest)
        throw new StudioError("ASSET_HASH_MISMATCH");
      if (directory) {
        relative = `${directory}/${digest}${path.extname(source)}`;
        await mkdir(absPath(directory), { recursive: true });
        await copyFile(source, absPath(relative));
        if ((await fileHash(absPath(relative))) !== digest)
          throw new StudioError("ASSET_CHANGED_DURING_FREEZE");
      }
      const file = await safeFile(relative);
      const metadata = await probeMediaInfo(file);
      const output = await ffmpeg(["-i", file]);
      const videoLine = output
        .split("\n")
        .find((l) => /Stream #.*Video:/.test(l));
      const dimensions = videoLine
        ? /(?:,|\s)(\d{1,6})x(\d{1,6})(?:[\s,\[])/.exec(videoLine)
        : null;
      if (
        (row.kind === "image" && !dimensions) ||
        (row.kind === "video" &&
          (!metadata.hasVideo || !metadata.durationSec)) ||
        (row.kind === "audio" && (!metadata.hasAudio || !metadata.durationSec))
      )
        throw new StudioError("ASSET_MEDIA_INVALID");
      const url = directory
        ? `/api/studio/media?path=${encodeURIComponent(relative)}`
        : binding.kind === "pool"
          ? `/api/arts/${row.id}`
          : binding.kind === "track"
            ? `/api/tracks/${row.id}/audio`
            : `/api/studio/builtin/${binding.name}`;
      manifest[key] = {
        id: row.id,
        kind: row.kind as "image" | "video" | "audio",
        src: mode === "file" ? file : url,
        hash: digest,
        ...(metadata.durationSec ? { durationSec: metadata.durationSec } : {}),
        hasAudio: metadata.hasAudio,
        ...(dimensions
          ? { width: Number(dimensions[1]), height: Number(dimensions[2]) }
          : {}),
      };
      files[key] = {
        path: relative,
        hash: digest,
        bytes: (await stat(file)).size,
      };
      if (row.posterPath) {
        const poster = await safeFile(row.posterPath);
        const posterHash = await fileHash(poster);
        let posterRelative = row.posterPath;
        if (directory) {
          posterRelative = `${directory}/${posterHash}.jpg`;
          await copyFile(poster, absPath(posterRelative));
        }
        files[key].posterPath = posterRelative;
        files[key].posterHash = posterHash;
        files[key].posterBytes = (await stat(poster)).size;
        manifest[key].posterSrc =
          mode === "file"
            ? absPath(posterRelative)
            : `/api/studio/media?path=${encodeURIComponent(posterRelative)}`;
      }
    } catch (error) {
      const code =
        error instanceof StudioError ? error.code : "ASSET_FILE_MISSING";
      diagnostics.push({
        severity: "error",
        code,
        message: `Cannot resolve media binding ${key}: ${code}.`,
        path: `bindings.${key}`,
      });
    }
  }
  if (directory) {
    // Each evaluation owns its UUID directory. Keep successful aliases/posters,
    // but never persist copied bytes that failed before entering the file ledger.
    const recorded = new Set(
      Object.values(files).flatMap((file) =>
        file.posterPath ? [file.path, file.posterPath] : [file.path],
      ),
    );
    if (!recorded.size) await cleanupDirectory(directory);
    else {
      for (const name of await readdir(absPath(directory))) {
        const relative = `${directory}/${name}`;
        if (!recorded.has(relative))
          await rm(absPath(relative), { force: true });
      }
    }
  }
  return { manifest, files, diagnostics };
}
export async function getStudioManifest(
  userId: string,
  document: VideoDocument,
  mode: StudioManifestMode = "url",
): Promise<AssetManifest> {
  studioManifestModeSchema.parse(mode);
  const parsed = videoDocumentSchema.parse(document);
  const result = await resolveAssets(userId, parsed, mode);
  if (result.diagnostics.length)
    throw new StudioError("ASSET_RESOLUTION_FAILED", result.diagnostics);
  return result.manifest;
}
/** Analyze real PCM only when no authored active interval exists. Cache by bytes and requested window. */
async function activeDocument(
  document: VideoDocument,
  manifest: AssetManifest,
  files: Record<string, StudioFile>,
) {
  const result = structuredClone(document);
  const expanded = new Map<string, string[]>();
  const output: VideoScene[] = [];
  for (const scene of result.scenes) {
    if (scene.block !== "top") {
      output.push(scene);
      continue;
    }
    const base = mergeSettings(
      result.settings,
      result.formatSettings?.[result.output.format],
      scene.settings,
    );
    const participants =
      scene.repeat === "participants"
        ? [...result.source.participants]
        : result.source.participants.filter(
            (p) => p.id === scene.participantId,
          );
    if (
      scene.repeat === "participants" &&
      (base.top?.order === "ascending" || base.top?.order === "descending")
    )
      participants.sort(
        (a, b) =>
          ((a.rank ?? Infinity) - (b.rank ?? Infinity)) *
          (base.top?.order === "ascending" ? 1 : -1),
      );
    const resolveWindow = async (p: Participant) => {
      const settings = mergeSettings(base, p.settings);
      const snippet = settings.top?.snippet;
      const key = p.media?.audio ?? p.media?.visual;
      const asset = key ? manifest[key] : undefined;
      if (
        snippet?.mode !== "active" ||
        snippet.activeEndSec !== undefined ||
        !key ||
        !asset ||
        !files[key] ||
        !(asset.kind === "audio" || asset.hasAudio)
      )
        return undefined;
      const length = snippet.durationSec ?? settings.top?.durationSec ?? 5;
      const cacheKey = `${asset.hash}:${length}`;
      let window = await prisma.studioAnalysis.findUnique({
        where: { key: cacheKey },
      });
      if (!window) {
        const bounds = await findActiveSnippet(
          await safeFile(files[key].path),
          length,
        );
        window = await prisma.studioAnalysis.upsert({
          where: { key: cacheKey },
          create: { key: cacheKey, ...bounds },
          update: {},
        });
      }
      return {
        ...snippet,
        activeStartSec: snippet.activeStartSec ?? window.startSec,
        activeEndSec: window.endSec,
      };
    };
    const windows: Awaited<ReturnType<typeof resolveWindow>>[] = [];
    // Bound decoder concurrency independently of participant count.
    for (const participant of participants)
      windows.push(await resolveWindow(participant));
    if (windows.every((w) => !w)) {
      output.push(scene);
      continue;
    }
    const ids: string[] = [];
    participants.forEach((p, i) => {
      const copy = structuredClone(scene);
      copy.id = `resolved:${encodeURIComponent(scene.id)}:${encodeURIComponent(p.id)}`;
      ids.push(copy.id);
      delete copy.repeat;
      copy.participantId = p.id;
      if (windows[i])
        copy.settings = {
          ...copy.settings,
          top: { ...copy.settings?.top, snippet: windows[i] },
        };
      const rename = (nodes: VideoNode[]) =>
        nodes.forEach((n) => {
          n.id = `${copy.id}:${n.id}`;
          if (n.type === "container") rename(n.children);
        });
      rename(copy.nodes);
      output.push(copy);
    });
    expanded.set(scene.id, ids);
  }
  result.scenes = output;
  if (result.audio?.cues)
    result.audio.cues = result.audio.cues.flatMap((cue) => {
      const ids = cue.anchor?.sceneId
        ? expanded.get(cue.anchor.sceneId)
        : undefined;
      return ids
        ? ids.map((id, i) => ({
            ...cue,
            id: `${cue.id}:resolved:${i}`,
            anchor: { ...cue.anchor!, sceneId: id },
          }))
        : [cue];
    });
  return result;
}
export async function evaluate(
  userId: string,
  input: unknown,
  directory?: string,
) {
  await references(userId, input);
  const budget = preflightVideoResources(input);
  if (budget.length)
    return {
      validation: { ready: false, diagnostics: budget },
      plan: null,
      resolvedDocument: null,
      manifest: {},
      files: {},
    };
  const parsed = videoDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const result = compileVideo(input as VideoDocument);
    return {
      validation: {
        ready: false,
        diagnostics: result.diagnostics,
      } as StudioValidation,
      plan: null,
      resolvedDocument: null,
      manifest: {},
      files: {},
    };
  }
  const assets = await resolveAssets(userId, parsed.data, "url", directory);
  let resolvedDocument = parsed.data;
  try {
    resolvedDocument = await activeDocument(
      parsed.data,
      assets.manifest,
      assets.files,
    );
  } catch {
    assets.diagnostics.push({
      severity: "error",
      code: "AUDIO_ANALYSIS_FAILED",
      message: "Active snippet analysis failed.",
      path: "settings.top.snippet",
    });
  }
  const compiled = compileVideo(resolvedDocument, assets.manifest);
  const diagnostics = [...assets.diagnostics, ...compiled.diagnostics];
  return {
    validation: {
      ready: !diagnostics.some((d) => d.severity === "error"),
      diagnostics,
    },
    plan: compiled.plan,
    resolvedDocument,
    manifest: assets.manifest,
    files: assets.files,
  };
}
export async function cleanupDirectory(directory: string) {
  await rm(absPath(directory), { recursive: true, force: true });
}
