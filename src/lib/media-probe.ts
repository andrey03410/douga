import "server-only";
import type { ChildProcess } from "node:child_process";

export const mediaProbeLimits = Object.freeze({
  timeoutMs: 30_000,
  maxDiagnosticBytes: 1024 * 1024,
  killGraceMs: 200,
});
export class MediaProbeError extends Error {
  constructor(public code: "MEDIA_PROBE_TIMEOUT" | "MEDIA_PROBE_OUTPUT_LIMIT") {
    super(code);
    this.name = "MediaProbeError";
  }
}
interface MediaProbeCaptureLimits {
  timeoutMs: number;
  maxDiagnosticBytes: number;
  killGraceMs: number;
}

/** Capture FFmpeg's stderr with a real process deadline. The caller spawns its
 * trusted probe with unused stdout ignored. On either limit, discard further
 * diagnostics, terminate/escalate, and settle only after the child is reaped. */
export function captureMediaProbe(
  child: ChildProcess,
  options: Partial<MediaProbeCaptureLimits> = {},
): Promise<string> {
  const limits = { ...mediaProbeLimits, ...options };
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let limitError: MediaProbeError | undefined;
    let spawnFailed = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const terminate = (code: MediaProbeError["code"]) => {
      if (limitError) return;
      limitError = new MediaProbeError(code);
      chunks.length = 0;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), limits.killGraceMs);
    };
    const deadline = setTimeout(
      () => terminate("MEDIA_PROBE_TIMEOUT"),
      limits.timeoutMs,
    );
    child.stderr?.on("data", (data: Buffer) => {
      if (limitError) return; // Keep draining without retaining unbounded output.
      if (bytes + data.length > limits.maxDiagnosticBytes) {
        terminate("MEDIA_PROBE_OUTPUT_LIMIT");
        return;
      }
      bytes += data.length;
      chunks.push(data);
    });
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", () => {
      clearTimeout(deadline);
      if (forceKill) clearTimeout(forceKill);
      if (limitError) reject(limitError);
      else resolve(spawnFailed ? "" : Buffer.concat(chunks).toString());
    });
  });
}
