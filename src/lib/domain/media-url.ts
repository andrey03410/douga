import { IMG_EXT, extOf, baseOf } from "@/lib/domain/media-ext";

// Pure policy for importing media by URL: which link is a picture the pool can
// store itself, which one belongs to the yt-dlp downloader, and which address
// the server must refuse to visit at all (SSRF guard). No network here — the
// service layer fetches and re-checks every redirect hop against these rules.

export type MediaUrlKind = "image" | "media";

/** Parsed http(s) URL, or null for anything else (ftp/file/data/garbage). */
export function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/**
 * "image" when the path ends with an extension the pool stores as a picture,
 * "media" for every other http(s) link (the downloader figures those out),
 * null when it is not an http(s) URL.
 */
export function classifyMediaUrl(raw: string): MediaUrlKind | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const ext = extOf(decodeSafe(url.pathname));
  return IMG_EXT.includes(ext) ? "image" : "media";
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Pool extension for a response's Content-Type, or null when the pool cannot
 * store that format (svg/avif/bmp) or the body is not an image at all.
 */
export function imageExtFromContentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[type] ?? null;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Host we never fetch from: machine-local names and private address literals. */
export function isBlockedHostname(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name === "localhost") return true;
  if (BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return isBlockedAddress(name);
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Address a server-side fetch must not reach: loopback, link-local (including
 * the cloud metadata endpoint), private and other special-purpose ranges.
 * Anything that is not an IP literal is not this function's business (false).
 */
export function isBlockedAddress(value: string): boolean {
  const raw = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(raw);
  if (v4) return isBlockedIpv4(v4);
  if (!raw.includes(":")) return false; // a hostname, not an address
  const v6 = parseIpv6(raw);
  // Unparseable but colon-bearing: not something a resolver hands back, and
  // not a hostname either — refuse rather than guess.
  return v6 ? isBlockedIpv6(v6) : true;
}

function isBlockedIpv4([a, b]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (docs)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * Judged on the 16 bytes, not on the spelling: WHATWG URL rewrites
 * [::ffff:127.0.0.1] to [::ffff:7f00:1], so a dotted-tail check alone misses
 * it. Forms that carry an IPv4 inside are judged by that IPv4.
 */
function isBlockedIpv6(b: number[]): boolean {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // ::/96 (IPv4-compatible, includes :: and ::1) and ::ffff:0:0/96 (IPv4-mapped)
  if (zero(0, 10) && ((b[10] === 0 && b[11] === 0) || (b[10] === 0xff && b[11] === 0xff))) {
    return isBlockedIpv4(b.slice(12));
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    // 64:ff9b::/96 NAT64 carries an IPv4; 64:ff9b:1::/48 is local-use NAT64
    if (zero(4, 12)) return isBlockedIpv4(b.slice(12));
    return b[4] === 0x00 && b[5] === 0x01;
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIpv4(b.slice(2, 6)); // 2002::/16 6to4
  if (b[0] === 0x01 && b[1] === 0x00 && zero(2, 8)) return true; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 docs
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/** 16 bytes of an IPv6 literal (with `::` and an optional dotted IPv4 tail), or null. */
function parseIpv6(value: string): number[] | null {
  const raw = value.replace(/%.*$/, ""); // zone id
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    const items = part.split(":");
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (i === items.length - 1 && item.includes(".")) {
        const v4 = parseIpv4(item);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(item)) {
        out.push(parseInt(item, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return words.flatMap((w) => [w >> 8, w & 0xff]);
}

const MAX_LABEL = 200;

/** Human label for an imported link: last path segment sans extension, else the host. */
export function urlLabel(raw: string): string | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const segment = decodeSafe(url.pathname).split("/").filter(Boolean).pop() ?? "";
  const base = segment ? baseOf(segment).replace(/\s+/g, " ").trim() : "";
  return (base || url.hostname).slice(0, MAX_LABEL);
}
