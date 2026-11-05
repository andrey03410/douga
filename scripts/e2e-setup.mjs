// E2E setup: create a test user and a ZIP of real audio tones.
import { spawnSync } from "node:child_process";
import path from "node:path";
import bcrypt from "bcryptjs";
import AdmZip from "adm-zip";
import ffmpegPath from "ffmpeg-static";
import { deleteUsersByEmail, openDevDb } from "./script-db.mjs";

const EMAIL = "e2e@test.local";
const PASSWORD = "password123";
const prisma = openDevDb();

const tmp = "/tmp/e2e";
spawnSync("mkdir", ["-p", tmp]);

// 4 tones with different durations/freqs so RMS/active-snippet has signal
const tracks = [
  { name: "01-alpha.mp3", freq: 220, dur: 5 },
  { name: "02-bravo.mp3", freq: 440, dur: 5 },
  { name: "03-charlie.mp3", freq: 660, dur: 5 },
  { name: "04-delta.mp3", freq: 880, dur: 5 },
];

const zip = new AdmZip();
for (const t of tracks) {
  const out = path.join(tmp, t.name);
  const r = spawnSync(ffmpegPath, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${t.freq}:duration=${t.dur}`,
    "-ac", "2", out,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${t.name}: ${r.stderr}`);
  zip.addLocalFile(out);
}
const zipPath = path.join(tmp, "ost.zip");
zip.writeZip(zipPath);

// The e2e account is an admin: verify flows exercise render and the admin
// panel. Limited-role flows create their own throwaway "user" accounts.
await deleteUsersByEmail(prisma, [EMAIL]);
const hash = await bcrypt.hash(PASSWORD, 10);
await prisma.user.create({ data: { email: EMAIL, passwordHash: hash, role: "admin" } });
await prisma.$disconnect();

console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, zipPath }));
