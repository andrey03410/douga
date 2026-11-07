// E2E HTTP flow against a running server: login -> upload -> compare -> finalize.
// Uses a manual cookie jar over global fetch.
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

// One screen = `question`, a group of 2..k participants. `questionKind` says
// how to answer it: "rank" orders the screen best-first (`ranked` beats
// everything after it, `rest` would be "about equal"), "pick" names one winner,
// "tier" puts one participant into a tier (0 = the best). Answering in the order
// shown is the old "left wins" for any k. A tournament created without an
// algorithm asks for one first (`schemeRequired`).
async function answer(id, body) {
  const r = await jfetch(`/api/tournaments/${id}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function runComparisons(id) {
  let steps = 0;
  while (true) {
    const next = await (await jfetch(`/api/tournaments/${id}/next`)).json();
    if (next.isComplete) break;
    if (next.schemeRequired) {
      const r = await jfetch(`/api/tournaments/${id}/scheme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme: "merge", allSegments: true }),
      });
      assert(r.status === 200, "algorithm chosen for all segments");
      continue;
    }
    const question = next.question ?? [];
    const kind = next.questionKind ?? "rank";
    assert(
      question.length >= (kind === "tier" ? 1 : 2) &&
        question.every((t) => (t.kind === "image" ? t.imageUrl : t.audioUrl?.includes("/audio"))),
      `${kind} screen of ${question.length} offered (step ${steps + 1})`,
    );
    // verify the media actually streams
    if (steps === 0) {
      const media = await jfetch(question[0].kind === "image" ? question[0].imageUrl : question[0].audioUrl);
      assert(media.status === 200, `${question[0].kind === "image" ? "picture" : "audio"} streams (200)`);
    }
    const body =
      kind === "pick"
        ? { pick: question[0].id }
        : kind === "tier"
          ? { itemId: question[0].id, tier: 0 }
          : { ranked: question.map((t) => t.id), rest: [] };
    const r = await answer(id, body);
    assert(r.status === 200 && r.body.ok, `${kind} answer ${steps + 1} recorded`);
    steps++;
    if (steps > 200) throw new Error("too many comparisons");
  }
  console.log(`  → completed in ${steps} screens`);
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

console.log("LOGIN");
await login();
console.log("CREATE TOURNAMENT");
const id = await createTournament();
console.log("COMPARISONS");
await runComparisons(id);
console.log("FINALIZE");
await finalize(id);
console.log("\nE2E OK ✅  tournament=" + id);
