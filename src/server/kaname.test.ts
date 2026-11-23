import { afterEach, expect, it, vi } from "vitest";
import { effectiveLimit, fetchGrant, localIdentityId } from "./kaname";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("binds the issuer and subject independently of login and email", () => {
  expect(localIdentityId("one", "sub")).toBe(localIdentityId("one", "sub"));
  expect(localIdentityId("one", "sub")).not.toBe(localIdentityId("two", "sub"));
});
it("rejects a grant for another site or subject and heavy permissions on a local admin", async () => {
  vi.stubEnv("KANAME_URL", "http://kaname.test");
  vi.stubEnv("KANAME_SERVICE_TOKEN", "fixture");
  for (const delta of [{ service: "hibiki" }, { subject: "other" }, { permissions: { heavy: true, html: true } }]) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      service: "douga", subject: "sub", login: "friend", role: "admin",
      permissions: { heavy: false, html: true }, limits: { storageBytes: 1000000000, projects: 3, publications: 2 }, ...delta,
    })));
    await expect(fetchGrant("sub")).rejects.toThrow();
  }
});

it("honors owner-assigned raised and unlimited caps without changing a user's compute rights", async () => {
  vi.stubEnv("KANAME_URL", "http://kaname.test");
  vi.stubEnv("KANAME_SERVICE_TOKEN", "fixture");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ service: "douga", subject: "friend", login: "friend", role: "user",
    permissions: { html: true, heavy: false }, limits: { storageBytes: 2_000_000_000, projects: 7, publications: null } })));
  const grant = await fetchGrant("friend");
  expect(effectiveLimit(grant, "projects")).toBe(7);
  expect(effectiveLimit(grant, "publications")).toBeNull();
  expect(effectiveLimit(grant, "storageBytes")).toBe(2_000_000_000);
  expect(grant.permissions.heavy).toBe(false);
});
it("distinguishes an unavailable central service from a revoked grant", async () => {
  vi.stubEnv("KANAME_URL", "http://kaname.test");
  vi.stubEnv("KANAME_SERVICE_TOKEN", "fixture");
  for (const [status, code] of [[503, "KANAME_UNAVAILABLE"], [403, "FORBIDDEN"]] as const) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    await expect(fetchGrant("friend")).rejects.toThrow(code);
  }
});
