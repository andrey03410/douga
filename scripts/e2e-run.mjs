// E2E HTTP flow against a running server: login -> upload -> compare -> finalize
// -> render config. Uses a manual cookie jar over global fetch.
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "e2e@test.local";
const PASSWORD = "password123";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
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
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function login() {
  const csrfRes = await jfetch("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: BASE + "/tournaments",
  });
  await jfetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const session = await (await jfetch("/api/auth/session")).json();
  assert(session?.user?.email === EMAIL, `authenticated as ${session?.user?.email}`);
}

async function createTournament() {
  const buf = await readFile("/tmp/e2e/ost.zip");
  const form = new FormData();
  form.append("title", "E2E Top");
  form.append("scheme", "merge");
  form.append("file", new Blob([buf]), "ost.zip");
  const res = await jfetch("/api/tournaments", { method: "POST", body: form });
  const data = await res.json();
  assert(res.status === 200 && data.id, `tournament created (${data.trackCount} tracks)`);
  return data.id;
}

// One screen = `question`, a group of 2..k tracks. The answer ranks them
// best-first: `ranked` beats everything after it, `rest` would be "about equal".
// Ranking the screen in the order shown is the old "left wins" for any k.
async function runComparisons(id) {
  let steps = 0;
  while (true) {
    const next = await (await jfetch(`/api/tournaments/${id}/next`)).json();
    if (next.isComplete) break;
    const question = next.question ?? [];
    assert(
      question.length >= 2 && question.every((t) => t.audioUrl?.includes("/audio")),
      `group of ${question.length} offered (step ${steps + 1})`,
    );
    // verify audio actually streams
    if (steps === 0) {
      const audio = await jfetch(question[0].audioUrl);
      assert(audio.status === 200, "audio streams (200)");
    }
    const r = await jfetch(`/api/tournaments/${id}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranked: question.map((t) => t.id), rest: [] }),
    });
    const rj = await r.json();
    assert(r.status === 200 && rj.ok, `comparison ${steps + 1} recorded`);
    steps++;
    if (steps > 100) throw new Error("too many comparisons");
  }
  console.log(`  → completed in ${steps} comparisons`);
}

async function finalize(id) {
  const res = await jfetch(`/api/tournaments/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topSize: 3 }),
  });
  const data = await res.json();
  assert(res.status === 200 && data.topSize === 3, "finalized with top-3");
}

async function renderConfig(id) {
  const res = await jfetch(`/api/tournaments/${id}/render/config`);
  const data = await res.json();
  assert(res.status === 200, "render config ensured");
  assert(data.config.items.length === 3, `config has 3 items (top-3)`);
  assert(data.previewPlan.segments.length === 3, "preview plan has 3 segments");
  assert(data.previewPlan.durationInFrames > 0, "preview plan has duration");
  assert(data.previewPlan.segments[2].rank === 1, "desc order: #1 is last");
}

console.log("LOGIN");
await login();
console.log("CREATE TOURNAMENT");
const id = await createTournament();
console.log("COMPARISONS");
await runComparisons(id);
console.log("FINALIZE");
await finalize(id);
console.log("RENDER CONFIG");
await renderConfig(id);
console.log("\nE2E OK ✅  tournament=" + id);
