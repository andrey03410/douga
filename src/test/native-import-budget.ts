// Test-only budgets: one yt-dlp process can spend 10–15s in startup alone
// (measured --version: 10.92s wall / 0.50s CPU). A full-suite single-probe
// error took 39.852s, so allow 45s per invocation, then local media/DB work.
// Success = metadata + download (2); a 404 attempt = metadata only (1).
export const nativeInvocationMs = 45_000;
export const importCleanupMs = 20_000; // Includes the Studio 5s heartbeat abort.
export const nativeWorkMs = (invocations: number) =>
  invocations * nativeInvocationMs + 15_000;
export const nativeTestMs = (invocations: number) =>
  nativeWorkMs(invocations) + importCleanupMs;
