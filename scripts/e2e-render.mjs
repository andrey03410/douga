// Extends the E2E flow with an actual Remotion render + download.
import { readFile, writeFile } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "e2e@test.local";
const PASSWORD = "password123";
const jar = new Map();

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
async function jfetch(url, opts = {}) {
  const res = await fetch(BASE + url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Cookie: cookieHeader() },
    redirect: "manual",
  });
  storeCookies(res);
  return res;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const { csrfToken } = await (await jfetch("/api/auth/csrf")).json();
  await jfetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE }).toString(),
  });
}

async function fullFlow() {
  const buf = await readFile("/tmp/e2e/ost.zip");
  const form = new FormData();
  form.append("title", "E2E Render");
  form.append("scheme", "merge");
  form.append("file", new Blob([buf]), "ost.zip");
  const id = (await (await jfetch("/api/tournaments", { method: "POST", body: form })).json()).id;

  // Each screen is ranked in the order shown (`question` -> `{ranked, rest}`).
  for (let steps = 0; ; steps++) {
    const next = await (await jfetch(`/api/tournaments/${id}/next`)).json();
    if (next.isComplete) break;
    if (!next.question?.length || steps > 100) throw new Error("comparison loop stuck");
    const res = await jfetch(`/api/tournaments/${id}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranked: next.question.map((t) => t.id), rest: [] }),
    });
    if (!res.ok) throw new Error(`compare failed: ${res.status} ${await res.text()}`);
  }
  await jfetch(`/api/tournaments/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topSize: 3 }),
  });
  await jfetch(`/api/tournaments/${id}/render/config`); // ensure config
  return id;
}

async function render(id) {
  const start = await (await jfetch(`/api/tournaments/${id}/render`, { method: "POST" })).json();
  const jobId = start.jobId;
  console.log("  render job:", jobId);
  let last = "";
  for (let i = 0; i < 240; i++) {
    const j = await (await jfetch(`/api/render-jobs/${jobId}`)).json();
    const line = `${j.status} ${Math.round((j.progress ?? 0) * 100)}%`;
    if (line !== last) { console.log("  ", line); last = line; }
    if (j.status === "done") {
      const dl = await jfetch(j.downloadUrl);
      const bytes = Buffer.from(await dl.arrayBuffer());
      await writeFile("/tmp/e2e/top.mp4", bytes);
      console.log(`  ✓ downloaded ${bytes.length} bytes -> /tmp/e2e/top.mp4`);
      return true;
    }
    if (j.status === "failed") { console.log("  ✗ failed:", j.error); return false; }
    await sleep(2000);
  }
  console.log("  ✗ timed out");
  return false;
}

await login();
const id = await fullFlow();
console.log("RENDER", id);
const ok = await render(id);
process.exit(ok ? 0 : 1);
