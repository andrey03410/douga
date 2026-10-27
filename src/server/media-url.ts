import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { absPath } from "@/lib/storage";
import {
  parseHttpUrl,
  imageExtFromContentType,
  isBlockedHostname,
  isBlockedAddress,
  urlLabel,
} from "@/lib/domain/media-url";
import { createArtFromFile } from "@/server/arts";

// Import a picture straight from a link (phase 17). Unlike the yt-dlp path this
// is synchronous — a poster is a few hundred kilobytes, so a background job
// would only add latency and moving parts. Everything risky about fetching a
// user-supplied URL is bounded here: host policy, size, time, redirects.

/** Pictures are small; anything bigger is a mistake, not a poster. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "douga/1.0 (+media import)";

export interface ImportImageInput {
  url: string;
  label?: string | null;
  /** Pool ceiling for this user in bytes; null = unlimited. */
  maxPoolBytes?: number | null;
}

/**
 * Loopback and LAN addresses are refused by default (SSRF). A self-hosted
 * install that keeps its media on a NAS can allow them with
 * MEDIA_URL_ALLOW_PRIVATE=1; tests use the same switch for their fixture server.
 */
function allowPrivate(): boolean {
  return process.env.MEDIA_URL_ALLOW_PRIVATE === "1";
}

/**
 * SSRF guard for every server-side visit of a user link: this picture import,
 * yt-dlp downloads and Studio imports. Throws BLOCKED_HOST unless the host and
 * every address it resolves to are public, HOST_UNRESOLVED when DNS has no
 * answer. yt-dlp follows redirects itself, so for it only the first hop is
 * checked; the picture import re-checks every hop.
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (allowPrivate()) return;
  if (isBlockedHostname(url.hostname)) throw new Error("BLOCKED_HOST");
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new Error("HOST_UNRESOLVED");
  }
  if (!addresses.length) throw new Error("HOST_UNRESOLVED");
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new Error("BLOCKED_HOST");
}

/** Fetch following redirects by hand, so every hop is checked against the host policy. */
async function fetchImage(start: URL): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current).catch((e: Error) => {
      // the picture API reports DNS trouble as a failed download
      throw e.message === "HOST_UNRESOLVED" ? new Error("FETCH_FAILED") : e;
    });
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "image/*,*/*;q=0.8", "user-agent": USER_AGENT },
      });
    } catch {
      throw new Error("FETCH_FAILED");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) {
      if (!res.ok) throw new Error("FETCH_FAILED");
      return res;
    }
    await res.body?.cancel().catch(() => {});
    const next = parseHttpUrl(new URL(location, current).toString());
    if (!next) throw new Error("BLOCKED_HOST");
    current = next;
  }
  throw new Error("FETCH_FAILED"); // too many redirects
}

/**
 * Download the picture at `url` into the user's pool. Errors: BAD_URL,
 * BLOCKED_HOST, NOT_IMAGE, TOO_LARGE, FETCH_FAILED, POOL_QUOTA.
 */
export async function importImageFromUrl(userId: string, input: ImportImageInput) {
  const url = parseHttpUrl(input.url);
  if (!url) throw new Error("BAD_URL");

  const res = await fetchImage(url);
  const ext = imageExtFromContentType(res.headers.get("content-type"));
  if (!ext) {
    await res.body?.cancel().catch(() => {});
    throw new Error("NOT_IMAGE");
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error("TOO_LARGE");
  }

  const tmpDir = absPath("tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `url-${randomUUID()}${ext}`);

  try {
    const file = await open(tmpPath, "w");
    let total = 0;
    try {
      // The declared length can lie; the counter is what actually stops us.
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > MAX_IMAGE_BYTES) throw new Error("TOO_LARGE");
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    if (!total) throw new Error("FETCH_FAILED");

    const label = input.label?.trim() || urlLabel(input.url);
    return await createArtFromFile(userId, {
      sourcePath: tmpPath, // absorbed (moved) into the pool on success
      fileName: `image${ext}`,
      label,
      maxPoolBytes: input.maxPoolBytes ?? null,
    });
  } finally {
    await unlink(tmpPath).catch(() => {}); // no-op once the file was absorbed
  }
}
