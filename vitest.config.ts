import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // Server modules mark themselves with `import "server-only"`, which throws
      // outside a React Server environment; integration tests run in plain node.
      "server-only": resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    // Integration files share SQLite and the single Studio heavy-work slot.
    // Explicit Promise-based concurrency tests still exercise races within a file.
    fileParallelism: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: `file:${resolve(__dirname, "prisma", "dev.db")}`,
    },
  },
});
