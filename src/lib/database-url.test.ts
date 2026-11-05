import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database-url";

describe("resolveDatabaseUrl", () => {
  it("resolves a relative file: path from prisma/, as Prisma 5 did", () => {
    expect(resolveDatabaseUrl("file:./dev.db", "/repo")).toBe("file:/repo/prisma/dev.db");
    expect(resolveDatabaseUrl("file:dev.db", "/repo")).toBe("file:/repo/prisma/dev.db");
    expect(resolveDatabaseUrl("file:../storage/copy.db", "/repo")).toBe("file:/repo/storage/copy.db");
  });

  it("keeps an absolute path", () => {
    expect(resolveDatabaseUrl("file:/tmp/copy.db", "/repo")).toBe("file:/tmp/copy.db");
  });

  it("falls back to prisma/dev.db without a variable", () => {
    expect(resolveDatabaseUrl(undefined, "/repo")).toBe("file:/repo/prisma/dev.db");
    expect(resolveDatabaseUrl("", "/repo")).toBe("file:/repo/prisma/dev.db");
  });
});
