import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { StudioError } from "./errors";
export interface PreviewMeasurements {
  decoded: true;
  audio: { meanDb: number | null; peakDb: number | null; silent: boolean; rule: string } | null;
  visualAssessment: "notChecked";
}
/** Evidence from decoded samples, not from a container's hasAudio flag. */
export async function measureInspectionPreview(file: string): Promise<PreviewMeasurements> {
  const run = promisify(execFile);
  let log: string;
  try {
    const result = await run(ffmpeg!, ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    log = result.stderr;
  } catch { throw new StudioError("PREVIEW_DECODE_FAILED"); }
  const mean = log.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/), peak = log.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
  return { decoded: true, visualAssessment: "notChecked", audio: peak && mean ? {
    meanDb: mean[1] === "-inf" ? null : Number(mean[1]), peakDb: peak[1] === "-inf" ? null : Number(peak[1]),
    silent: peak[1] === "-inf" || Number(peak[1]) <= -70, rule: "peak <= -70 dBFS in this decoded preview only",
  } : null };
}
