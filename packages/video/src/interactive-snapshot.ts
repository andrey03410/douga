/**
 * douga-interactive-snapshot@1: everything a game host needs to play an interactive
 * video without Douga running. Media, posters, fonts and stills are addressed by
 * SHA-256; the host downloads them once and compiles scenes itself.
 */
import { z } from "zod";
import type { AssetManifest, VideoDocument } from "./types";
import type { CompiledInteractiveScene, MatchData, MatchDataUse } from "./interactive-types";
import { matchDataSchema } from "./interactive-schema";

export const INTERACTIVE_SNAPSHOT_FORMAT = "douga-interactive-snapshot" as const;

export type InteractiveSnapshotFileKind = "image" | "video" | "audio" | "poster" | "font" | "still";

export interface InteractiveSnapshotFile {
  hash: string;
  ext: string;
  bytes: number;
  kind: InteractiveSnapshotFileKind;
}

export interface InteractiveSnapshotScene {
  id: string;
  sourceSceneId: string;
  segmentId?: string;
  title: string;
  from: number;
  to: number;
  holds: CompiledInteractiveScene["holds"];
  choices: { choiceId: string; cardId?: string; participantId?: string; label?: string }[];
  uses: MatchDataUse[];
  /** Hash of a PNG still of the scene (a hold frame or a stable state). */
  still?: string;
}

export interface InteractiveSnapshot {
  format: typeof INTERACTIVE_SNAPSHOT_FORMAT;
  version: 1;
  contract: 1;
  engine: { remotion: string; compilerVersion: string; packages: string };
  project: { id: string; title: string; revision: number };
  /** Resolved document with the interactive layer. */
  document: VideoDocument;
  /** Asset manifest; `src` of every asset is `<hash><ext>` of a file below. */
  manifest: AssetManifest;
  files: InteractiveSnapshotFile[];
  /** Catalog faces the host measures text with: `faceId` → file hash. */
  runtimeFonts: { faceId: string; hash: string }[];
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  scenes: InteractiveSnapshotScene[];
  segments: { id: string; title: string; from: number; to: number }[];
  sample: MatchData;
  hash: string;
}

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const ext = z.string().regex(/^\.[a-z0-9]{1,8}$/);
const id = z.string().min(1).max(400);
const frame = z.number().int().min(0).max(7200 * 60);

/** Shape check for hosts. The document itself is validated by compileVideo. */
export const interactiveSnapshotSchema = z
  .object({
    format: z.literal(INTERACTIVE_SNAPSHOT_FORMAT),
    version: z.literal(1),
    contract: z.literal(1),
    engine: z.object({ remotion: z.string().max(40), compilerVersion: z.string().max(40), packages: z.string().max(80) }).strict(),
    project: z.object({ id, title: z.string().max(500), revision: z.number().int().min(0) }).strict(),
    document: z.record(z.unknown()),
    manifest: z.record(z.object({ src: z.string().max(200) }).passthrough()),
    files: z
      .array(z.object({ hash: sha, ext, bytes: z.number().int().min(0).max(2 ** 40), kind: z.enum(["image", "video", "audio", "poster", "font", "still"]) }).strict())
      .max(5000),
    runtimeFonts: z.array(z.object({ faceId: id, hash: sha }).strict()).max(100),
    fps: z.number().int().min(1).max(120),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    durationInFrames: z.number().int().min(1),
    scenes: z
      .array(
        z
          .object({
            id,
            sourceSceneId: id,
            segmentId: id.optional(),
            title: z.string().max(500),
            from: frame,
            to: frame,
            holds: z.array(z.object({ momentId: id, frame }).strict()).max(50),
            choices: z
              .array(z.object({ choiceId: id, cardId: id.optional(), participantId: id.optional(), label: z.string().max(500).optional() }).strict())
              .max(200),
            uses: z.array(z.enum(["players", "votes", "rank", "score", "pickedBy", "answer", "texts"])),
            still: sha.optional(),
          })
          .strict(),
      )
      .max(5000),
    segments: z.array(z.object({ id, title: z.string().max(500), from: frame, to: frame }).strict()).max(500),
    sample: matchDataSchema,
    hash: sha,
  })
  .strict();

/** JSON with sorted keys: the same snapshot hashes the same everywhere. */
export function canonicalJson(value: unknown): string {
  // As JSON.stringify: an undefined array element is null on the wire, so it hashes as null.
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** SHA-256 of the canonical snapshot without its `hash` field (WebCrypto: Node and browsers). */
export async function interactiveSnapshotHash(snapshot: Omit<InteractiveSnapshot, "hash"> | InteractiveSnapshot): Promise<string> {
  const { hash: _ignored, ...content } = snapshot as InteractiveSnapshot;
  const bytes = new TextEncoder().encode(canonicalJson(content));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** File name of a snapshot file: `<hash><ext>`. */
export function snapshotFileName(file: Pick<InteractiveSnapshotFile, "hash" | "ext">): string {
  return `${file.hash}${file.ext}`;
}
