// Remove E2E/integration test users with their data from the dev database.
import { deleteUsersByEmail, openDevDb } from "./script-db.mjs";

const prisma = openDevDb();
try {
  const count = await deleteUsersByEmail(prisma, ["e2e@test.local", "integration-flow@test.local"]);
  console.log("cleaned users:", count);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
