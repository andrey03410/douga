import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { provisionedAccountEmail } from "@/lib/domain/account-login";

if (process.env.KANAME_ENABLED === "1") throw new Error("Credentials are managed by Kaname");
const login = process.argv[2]?.trim().toLowerCase();
const role = process.argv[3];
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (!login || !/^[a-z0-9_-]{3,40}$/.test(login) || !password || Buffer.byteLength(password) > 72 || (role !== "admin" && role !== "member")) {
  throw new Error("Expected a login, admin or member role, and a password on stdin");
}
const email = provisionedAccountEmail(login);
try {
  const thatAccount = await prisma.user.findUnique({ where: { email } });
  if (thatAccount && thatAccount.role !== role) throw new Error("Account already exists with a different role");
  if (!thatAccount) {
    await prisma.user.create({ data: { email, role, passwordHash: await bcrypt.hash(password, 10) } });
  }
  console.log(`Account ready: ${login}`);
} finally {
  await prisma.$disconnect();
}
