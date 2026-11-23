import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireUser, signIn } = vi.hoisted(() => ({ requireUser: vi.fn(), signIn: vi.fn() }));
vi.mock("@/auth", () => ({
  requireUser, currentUser: () => requireUser().catch(() => null), signIn,
}));
vi.mock("./KanameAdmin", () => ({ KanameAdmin: () => null }));
vi.mock("./AdminUsers", () => ({ AdminUsers: () => null }));

import AdminPage from "./page";
import { GET } from "../api/auth/kaname/login/route";

beforeEach(() => { vi.stubEnv("KANAME_ENABLED", "1"); vi.resetAllMocks(); });
afterEach(() => vi.unstubAllEnvs());

it("sends a first visit from the hub through OIDC and back to local management", async () => {
  requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
  await expect(AdminPage()).rejects.toMatchObject({ digest: expect.stringContaining("/api/auth/kaname/login?next=/admin") });
  await GET(new Request("https://douga.example/api/auth/kaname/login?next=/admin"));
  expect(signIn).toHaveBeenCalledWith("keycloak", { redirectTo: "/admin" });
});
it("does not re-enter OIDC for an authenticated user or revoked grant", async () => {
  requireUser.mockResolvedValueOnce({ id: "reader", role: "kaname-user" }).mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(AdminPage()).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  await expect(AdminPage()).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
});
it.each(["", "?next=/projects", "?next=https://elsewhere.example", "?next=//elsewhere.example", "?next=%2Fadmin%2F..%2Fother"])(
  "keeps the default local destination for %s", async query => {
    await GET(new Request("https://douga.example/api/auth/kaname/login"+query));
    expect(signIn).toHaveBeenCalledWith("keycloak", { redirectTo: "/projects" });
  },
);
it("keeps the standalone admin page and the disabled OIDC endpoint private", async () => {
  vi.stubEnv("KANAME_ENABLED", "0");
  requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
  await expect(AdminPage()).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  expect((await GET(new Request("https://douga.example/api/auth/kaname/login?next=/admin"))).status).toBe(404);
  expect(signIn).not.toHaveBeenCalled();
});
