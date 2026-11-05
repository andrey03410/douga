// Remove E2E/integration test users (cascade) from the dev database.
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const url = "file:" + path.join(process.cwd(), "prisma", "dev.db");
const p = new PrismaClient({ datasources: { db: { url } } });
p.user
  .deleteMany({ where: { email: { in: ["e2e@test.local", "integration-flow@test.local"] } } })
  .then((r) => { console.log("cleaned users:", r.count); return p.$disconnect(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
