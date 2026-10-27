import type * as Dns from "node:dns/promises";

// Deterministic DNS for SSRF tests: one public-looking name that resolves into
// the LAN and one that does not resolve at all. Everything else goes to the
// real resolver. Use from a vi.mock("node:dns/promises") factory.

export const PRIVATE_NAME = "intranet.ssrf-fixture.test";
export const UNRESOLVED_NAME = "missing.ssrf-fixture.test";

export function fakeDns(real: typeof Dns): typeof Dns {
  const lookup = (async (host: string, options?: unknown) => {
    if (host === PRIVATE_NAME) return [{ address: "10.0.0.7", family: 4 }];
    if (host === UNRESOLVED_NAME)
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
        code: "ENOTFOUND",
      });
    return real.lookup(host, options as never);
  }) as typeof real.lookup;
  // Vitest exposes a builtin's CommonJS object as `default` too; patch both.
  const original = (real as { default?: object }).default;
  return { ...real, lookup, default: { ...original, lookup } } as typeof Dns;
}
