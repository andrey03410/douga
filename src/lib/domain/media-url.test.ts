import { describe, it, expect } from "vitest";
import {
  classifyMediaUrl,
  imageExtFromContentType,
  isBlockedHostname,
  isBlockedAddress,
  urlLabel,
} from "./media-url";

describe("classifyMediaUrl", () => {
  it("calls a supported image extension an image, whatever the case and query", () => {
    expect(classifyMediaUrl("https://cdn.example.com/poster.jpg")).toBe("image");
    expect(classifyMediaUrl("https://cdn.example.com/a/b/POSTER.JPEG?x=1&y=2")).toBe("image");
    expect(classifyMediaUrl("http://cdn.example.com/p.webp#frag")).toBe("image");
    expect(classifyMediaUrl("https://cdn.example.com/p.png")).toBe("image");
    expect(classifyMediaUrl("https://cdn.example.com/p.gif")).toBe("image");
  });

  it("routes everything else playable to the downloader", () => {
    expect(classifyMediaUrl("https://www.youtube.com/watch?v=abc")).toBe("media");
    expect(classifyMediaUrl("https://cdn.example.com/clip.mp4")).toBe("media");
    expect(classifyMediaUrl("https://cdn.example.com/song.m4a")).toBe("media");
    // no extension at all: only the downloader can tell what this is
    expect(classifyMediaUrl("https://example.com/gallery/12345")).toBe("media");
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(classifyMediaUrl("ftp://example.com/p.jpg")).toBeNull();
    expect(classifyMediaUrl("file:///home/u/p.jpg")).toBeNull();
    expect(classifyMediaUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(classifyMediaUrl("не ссылка вовсе")).toBeNull();
    expect(classifyMediaUrl("")).toBeNull();
  });

  it("ignores surrounding whitespace", () => {
    expect(classifyMediaUrl("  https://cdn.example.com/poster.jpg\n")).toBe("image");
  });

  it("does not treat an unsupported image format as an image", () => {
    // the pool cannot store svg/bmp/avif, so they must not take the image path
    expect(classifyMediaUrl("https://cdn.example.com/logo.svg")).toBe("media");
  });
});

describe("imageExtFromContentType", () => {
  it("maps supported image types to the pool extension", () => {
    expect(imageExtFromContentType("image/jpeg")).toBe(".jpg");
    expect(imageExtFromContentType("IMAGE/JPG; charset=binary")).toBe(".jpg");
    expect(imageExtFromContentType("image/png")).toBe(".png");
    expect(imageExtFromContentType(" image/webp ")).toBe(".webp");
    expect(imageExtFromContentType("image/gif")).toBe(".gif");
  });

  it("refuses image formats the pool cannot store, and non-images", () => {
    expect(imageExtFromContentType("image/svg+xml")).toBeNull();
    expect(imageExtFromContentType("image/avif")).toBeNull();
    expect(imageExtFromContentType("text/html")).toBeNull();
    expect(imageExtFromContentType("application/octet-stream")).toBeNull();
    expect(imageExtFromContentType(null)).toBeNull();
    expect(imageExtFromContentType("")).toBeNull();
  });
});

describe("isBlockedHostname", () => {
  it("blocks loopback and machine-local names", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("LOCALHOST.")).toBe(true);
    expect(isBlockedHostname("db.localhost")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("api.internal")).toBe(true);
    expect(isBlockedHostname("router.home.arpa")).toBe(true);
    expect(isBlockedHostname("")).toBe(true);
  });

  it("blocks a hostname that is itself a private address literal", () => {
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("[::1]")).toBe(true);
    expect(isBlockedHostname("169.254.169.254")).toBe(true);
  });

  it("lets ordinary public hosts through", () => {
    expect(isBlockedHostname("shikimori.one")).toBe(false);
    expect(isBlockedHostname("cdn.example.com")).toBe(false);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
  });
});

describe("isBlockedAddress", () => {
  it("blocks the private and special-purpose IPv4 ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1", // CGNAT
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.5",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "100.63.255.255"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local and link-local", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "FE80::abcd"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("sees through an IPv4-mapped IPv6 address", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6 and ignores non-addresses", () => {
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
    expect(isBlockedAddress("example.com")).toBe(false);
  });

  // WHATWG URL rewrites an embedded IPv4 into hex groups: http://[::ffff:127.0.0.1]/
  // has the hostname [::ffff:7f00:1]. The guard must judge the hostname that the
  // fetcher actually sees, not only the dotted spelling.
  it("blocks IPv6 forms that embed a private IPv4, as new URL spells them", () => {
    for (const literal of [
      "[::ffff:127.0.0.1]", // IPv4-mapped
      "[::ffff:169.254.169.254]", // mapped cloud metadata
      "[::ffff:10.0.0.1]",
      "[::127.0.0.1]", // IPv4-compatible
      "[64:ff9b::7f00:1]", // NAT64 well-known prefix
      "[64:ff9b:1::a00:1]", // NAT64 local-use prefix
      "[2002:7f00:1::]", // 6to4 of 127.0.0.1
      "[0:0:0:0:0:ffff:7f00:1]",
    ]) {
      const host = new URL(`http://${literal}/`).hostname;
      expect(isBlockedHostname(host), `${literal} -> ${host}`).toBe(true);
      expect(isBlockedAddress(host), `${literal} -> ${host}`).toBe(true);
    }
  });

  it("blocks other special-purpose IPv6 ranges", () => {
    for (const ip of ["ff02::1", "fec0::1", "2001:db8::1", "100::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses behind the same IPv6 prefixes", () => {
    for (const literal of ["[::ffff:8.8.8.8]", "[64:ff9b::808:808]", "[2002:808:808::]"]) {
      const host = new URL(`http://${literal}/`).hostname;
      expect(isBlockedHostname(host), `${literal} -> ${host}`).toBe(false);
    }
  });

  it("normalizes decimal and hex IPv4 spellings before judging them", () => {
    for (const raw of ["http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://127.1/"]) {
      expect(isBlockedHostname(new URL(raw).hostname), raw).toBe(true);
    }
  });
});

describe("urlLabel", () => {
  it("takes the last path segment without the extension", () => {
    expect(urlLabel("https://cdn.example.com/posters/nagisa.jpg")).toBe("nagisa");
  });

  it("decodes percent-escapes, including Cyrillic", () => {
    expect(urlLabel("https://cdn.example.com/%D0%9D%D0%B0%D0%B3%D0%B8%D1%81%D0%B0%20%D0%B7%D0%BE%D0%BD%D1%82.png")).toBe(
      "Нагиса зонт",
    );
  });

  it("falls back to the host when there is no usable segment", () => {
    expect(urlLabel("https://cdn.example.com/")).toBe("cdn.example.com");
    expect(urlLabel("https://cdn.example.com")).toBe("cdn.example.com");
  });

  it("caps the length and collapses whitespace", () => {
    const long = `https://cdn.example.com/${"a".repeat(300)}.jpg`;
    expect(urlLabel(long)).toHaveLength(200);
    expect(urlLabel("https://cdn.example.com/a%20%20%20b.jpg")).toBe("a b");
  });

  it("is null for a non-URL", () => {
    expect(urlLabel("не ссылка")).toBeNull();
  });
});
