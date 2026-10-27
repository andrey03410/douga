import { describe, expect, it } from "vitest";
import { startStudioImportSchema } from "./job-types";

describe("startStudioImportSchema", () => {
  // The SSRF guard judges `new URL(url)`, and yt-dlp must get that same URL:
  // Python's urlparse reads `http://example.com\@127.0.0.1/` as host 127.0.0.1,
  // while WHATWG reads host example.com.
  it("hands on the WHATWG-normalized URL the guard checked", () => {
    const input = startStudioImportSchema.parse({
      url: "http://example.com\\@127.0.0.1:8080/secret",
      mode: "audio",
    });
    expect(input.url).toBe("http://example.com/@127.0.0.1:8080/secret");
    expect(new URL(input.url).hostname).toBe("example.com");
  });

  it("is stable when parsed again (the worker re-parses frozen input)", () => {
    const once = startStudioImportSchema.parse({ url: "HTTPS://Example.COM/a b", mode: "video" });
    expect(once.url).toBe("https://example.com/a%20b");
    expect(startStudioImportSchema.parse(once).url).toBe(once.url);
  });
});
