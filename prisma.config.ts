import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/lib/database-url";

// Prisma 7 does not read .env on its own. Variables exported in the shell win
// (process.loadEnvFile never overrides them), so
// `DATABASE_URL=file:/abs/copy.db npx prisma db push` still targets the copy.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  // A relative file: path counts from prisma/, as in Prisma 5 (see database-url.ts).
  // `generate` needs no database, so `npm install` works without a .env.
  datasource: { url: resolveDatabaseUrl(process.env.DATABASE_URL) },
});
