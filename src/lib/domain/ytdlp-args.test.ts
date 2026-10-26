import { describe, expect, it } from "vitest";
import {
  buildDownloadArgs,
  describeDownloadError,
  formatSelector,
  isQuality,
  looksLikeExtractorBreakage,
  parseProbeJson,
  parseProgressLine,
} from "./ytdlp-args";

describe("formatSelector", () => {
  it("video pins avc1+mp4a within the height cap (browser/render compatible)", () => {
    const f = formatSelector("video", 720);
    expect(f).toContain("bestvideo[height<=720][vcodec^=avc1]");
    expect(f).toContain("bestaudio[acodec^=mp4a]");
    expect(f).toContain("best[height<=720]");
  });

  it("audio prefers m4a and can extract a direct multiplexed file", () => {
    expect(formatSelector("audio", 1080)).toBe("bestaudio[ext=m4a]/bestaudio/best");
  });

  it("isQuality accepts only the offered rungs", () => {
    expect(isQuality(720)).toBe(true);
    expect(isQuality(360)).toBe(false);
  });
});

describe("buildDownloadArgs", () => {
  const base = {
    url: "https://youtu.be/x",
    quality: 1080,
    dir: "/tmp/dl",
    markerFile: "/tmp/dl/final.txt",
    ffmpegPath: "/opt/ffmpeg",
    maxBytes: 1000,
  };

  it("video: merges to mp4, caps filesize, guards the url behind --", () => {
    const args = buildDownloadArgs({ ...base, mode: "video" });
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("--no-playlist");
    expect(args.join(" ")).toContain("--max-filesize 1000");
    // url must come after "--" so a crafted "-..." string can't inject flags
    expect(args.slice(-2)).toEqual(["--", "https://youtu.be/x"]);
    expect(args).toContain("--ffmpeg-location");
    // fail-fast network settings + JS runtime for YouTube challenges
    expect(args.join(" ")).toContain("--socket-timeout 15");
    expect(args.join(" ")).toContain("--js-runtimes node");
  });

  it("audio: extracts m4a, no merge flag", () => {
    const args = buildDownloadArgs({ ...base, mode: "audio", maxBytes: null });
    expect(args).toContain("-x");
    expect(args).toContain("m4a");
    expect(args).not.toContain("--merge-output-format");
    expect(args).not.toContain("--max-filesize");
    expect(args).not.toContain("--proxy");
  });

  it("proxy is passed through when configured", () => {
    const args = buildDownloadArgs({ ...base, mode: "video", proxy: "socks5://127.0.0.1:1080" });
    expect(args.join(" ")).toContain("--proxy socks5://127.0.0.1:1080");
  });
});

describe("parseProgressLine", () => {
  it("reads [download] percentages and clamps to 0..1", () => {
    expect(parseProgressLine("[download]  42.3% of 10MiB at 1MiB/s")).toBeCloseTo(0.423, 6);
    expect(parseProgressLine("[download] 100% of 10MiB")).toBe(1);
    expect(parseProgressLine("[merger] Merging formats")).toBeNull();
    expect(parseProgressLine("random text 50%")).toBeNull();
  });
});

describe("parseProbeJson", () => {
  const info = {
    title: "Epic Opening",
    duration: 90,
    formats: [
      { vcodec: "none", acodec: "mp4a.40.2", ext: "m4a", filesize: 1_000_000 },
      { vcodec: "none", acodec: "opus", ext: "webm", filesize: 900_000 },
      { vcodec: "avc1.64001f", acodec: "none", height: 720, filesize: 8_000_000 },
      { vcodec: "avc1.640028", acodec: "none", height: 1080, filesize_approx: 20_000_000 },
      { vcodec: "vp9", acodec: "none", height: 1080, filesize: 15_000_000 },
    ],
  };

  it("video estimate = best avc1 within cap + best mp4a audio", () => {
    const r = parseProbeJson(info, "video", 1080);
    expect(r.title).toBe("Epic Opening");
    expect(r.durationSec).toBe(90);
    expect(r.estimatedBytes).toBe(21_000_000); // 1080p avc1 approx + m4a
  });

  it("height cap changes the picked video format", () => {
    expect(parseProbeJson(info, "video", 720).estimatedBytes).toBe(9_000_000);
  });

  it("audio estimate = the m4a track", () => {
    expect(parseProbeJson(info, "audio", 1080).estimatedBytes).toBe(1_000_000);
  });

  it("unknown sizes stay unknown (no lowball guesses)", () => {
    const r = parseProbeJson({ title: "x", formats: [] }, "video", 1080);
    expect(r.estimatedBytes).toBeNull();
  });
});

describe("error classification", () => {
  it("extractor breakage patterns trigger the update-and-retry path", () => {
    expect(looksLikeExtractorBreakage("ERROR: Precondition check failed")).toBe(true);
    expect(looksLikeExtractorBreakage("ERROR: Unable to extract player version")).toBe(true);
    expect(looksLikeExtractorBreakage("ERROR: Unsupported URL: http://x")).toBe(false);
  });

  it("describeDownloadError maps common failures to human text", () => {
    expect(describeDownloadError("ERROR: Unsupported URL: htp://x")).toContain("не распознана");
    expect(describeDownloadError("ERROR: Video unavailable")).toContain("недоступно");
    expect(
      describeDownloadError("File is larger than max-filesize"),
    ).toContain("квоты");
    expect(describeDownloadError("")).toContain("Не удалось");
    expect(
      describeDownloadError("[download] Got error: _ssl.c:983: The handshake operation timed out"),
    ).toContain("CDN");
  });
});
