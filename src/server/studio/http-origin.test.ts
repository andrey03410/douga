import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isStudioMutationOriginAllowed } from "./http-origin";
it("accepts a loopback browser origin after actual NextRequest hostname normalization", () => {
  const req = new NextRequest("http://127.0.0.1:3000/api/studio/projects", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3000",
      host: "127.0.0.1:3000",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-proto": "http",
    },
  });
  expect(req.url).toBe("http://localhost:3000/api/studio/projects");
  expect(isStudioMutationOriginAllowed(req)).toBe(true);
});
it("accepts the external deployment authority and protocol behind a forwarding proxy", () => {
  const req = new Request("http://internal:3000/api/studio/projects", {
    headers: {
      origin: "https://video.example.com",
      host: "internal:3000",
      "x-forwarded-host": "video.example.com",
      "x-forwarded-proto": "https",
    },
  });
  expect(isStudioMutationOriginAllowed(req)).toBe(true);
});
it("uses Host when forwarding headers are unavailable without treating loopback aliases as equivalent", () => {
  expect(
    isStudioMutationOriginAllowed(
      new Request("http://localhost:3000/api/studio/projects", {
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      }),
    ),
  ).toBe(true);
  expect(
    isStudioMutationOriginAllowed(
      new Request("http://localhost:3000/api/studio/projects", {
        headers: { origin: "http://127.0.0.1:3000", host: "localhost:3000" },
      }),
    ),
  ).toBe(false);
});
it("rejects a malicious foreign origin, scheme mismatch, opaque origin and ambiguous forwarding headers", () => {
  const make = (origin: string, extras: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/studio/projects", {
      headers: {
        origin,
        host: "127.0.0.1:3000",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
        ...extras,
      },
    });
  expect(isStudioMutationOriginAllowed(make("https://foreign.example"))).toBe(
    false,
  );
  expect(isStudioMutationOriginAllowed(make("https://127.0.0.1:3000"))).toBe(
    false,
  );
  expect(isStudioMutationOriginAllowed(make("null"))).toBe(false);
  expect(
    isStudioMutationOriginAllowed(
      make("http://127.0.0.1:3000", {
        "x-forwarded-host": "127.0.0.1:3000, foreign.example",
      }),
    ),
  ).toBe(false);
  expect(
    isStudioMutationOriginAllowed(
      make("http://127.0.0.1:3000", { "x-forwarded-proto": "http, https" }),
    ),
  ).toBe(false);
  expect(
    isStudioMutationOriginAllowed(
      make("http://127.0.0.1:3000", {
        "x-forwarded-host": "foreign.example@127.0.0.1:3000",
      }),
    ),
  ).toBe(false);
});
it("preserves headerless programmatic requests and URL fallback when Host is unavailable", () => {
  expect(
    isStudioMutationOriginAllowed(
      new Request("http://localhost/api/studio/projects"),
    ),
  ).toBe(true);
  expect(
    isStudioMutationOriginAllowed(
      new Request("https://video.example.com/api/studio/projects", {
        headers: { origin: "https://video.example.com" },
      }),
    ),
  ).toBe(true);
});
