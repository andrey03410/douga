/** Browser-safe, lossless RGBA comparison. No average score can waive a failed ROI. */
export interface RgbaImage { width: number; height: number; data: Uint8Array }
export interface VisualEnvironment {
  platform: string; arch: string; node: string; osVersion?: string; ffmpeg?: string; colorSpace?: "srgb"; browser: string; remotion: string;
  fontHashes: string[]; pixelFormat: "rgba"; scale: number; rasterizer?: "swangle";
}
export interface PixelTolerance { maxChangedPixelRatio?: number; maxDelta?: number; minPsnr?: number }
export interface VisualRegion { id: string; x: number; y: number; width: number; height: number; tolerance?: PixelTolerance }
export interface PixelMetrics { psnr: number; mse: number; changedPixelRatio: number; changedPixels: number; totalPixels: number; maxDelta: number }
export type VisualStatus = "passed" | "failed" | "missing-baseline" | "dimension-mismatch" | "environment-mismatch";
export interface VisualFrameResult {
  id: string; status: VisualStatus; mandatory: boolean; metrics?: PixelMetrics;
  regions: { id: string; status: "passed" | "failed"; metrics: PixelMetrics }[];
  diff?: RgbaImage; engineId?: string; referenceEngineId?: string;
}
function validate(image: RgbaImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data.length !== image.width * image.height * 4)
    throw new Error("INVALID_RGBA_IMAGE");
}
function metrics(actual: RgbaImage, reference: RgbaImage, roi: Omit<VisualRegion, "id">): PixelMetrics {
  if (![roi.x, roi.y, roi.width, roi.height].every(Number.isInteger) || roi.x < 0 || roi.y < 0 || roi.width <= 0 || roi.height <= 0 || roi.x + roi.width > actual.width || roi.y + roi.height > actual.height)
    throw new Error("INVALID_VISUAL_REGION");
  let squared = 0, changedPixels = 0, maxDelta = 0;
  for (let y = roi.y; y < roi.y + roi.height; y++)
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      let changed = false;
      for (let c = 0; c < 4; c++) {
        const i = (y * actual.width + x) * 4 + c, delta = Math.abs(actual.data[i] - reference.data[i]);
        squared += delta * delta; maxDelta = Math.max(maxDelta, delta); changed ||= delta !== 0;
      }
      if (changed) changedPixels++;
    }
  const totalPixels = roi.width * roi.height, mse = squared / (totalPixels * 4);
  return { mse, psnr: mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse), changedPixelRatio: changedPixels / totalPixels, changedPixels, totalPixels, maxDelta };
}
function passes(m: PixelMetrics, t: PixelTolerance = {}): boolean {
  const ratio = t.maxChangedPixelRatio ?? 0, delta = t.maxDelta ?? 0, psnr = t.minPsnr ?? 0;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1 || !Number.isFinite(delta) || delta < 0 || delta > 255 || !Number.isFinite(psnr) || psnr < 0)
    throw new Error("INVALID_VISUAL_TOLERANCE");
  return m.changedPixelRatio <= ratio && m.maxDelta <= delta && m.psnr >= psnr;
}
export function visualEnvironmentsMatch(a: VisualEnvironment, b: VisualEnvironment): boolean {
  return a.platform === b.platform && a.arch === b.arch && a.node === b.node && a.osVersion === b.osVersion && a.ffmpeg === b.ffmpeg && a.colorSpace === b.colorSpace && a.browser === b.browser && a.remotion === b.remotion && a.pixelFormat === b.pixelFormat && a.scale === b.scale && a.rasterizer === b.rasterizer && JSON.stringify([...a.fontHashes].sort()) === JSON.stringify([...b.fontHashes].sort());
}
export function compareVisualFrame(input: {
  id: string; actual: RgbaImage; reference?: RgbaImage; environment: VisualEnvironment;
  referenceEnvironment?: VisualEnvironment; rois?: VisualRegion[]; tolerance?: PixelTolerance;
  mandatory?: boolean; engineId?: string; referenceEngineId?: string;
}): VisualFrameResult {
  validate(input.actual);
  const base: VisualFrameResult = { id: input.id, status: "passed", mandatory: input.mandatory ?? true, regions: [], engineId: input.engineId, referenceEngineId: input.referenceEngineId };
  if (!input.reference) return { ...base, status: "missing-baseline" };
  validate(input.reference);
  if (input.actual.width !== input.reference.width || input.actual.height !== input.reference.height) return { ...base, status: "dimension-mismatch" };
  if (!input.referenceEnvironment || !visualEnvironmentsMatch(input.environment, input.referenceEnvironment)) return { ...base, status: "environment-mismatch" };
  base.metrics = metrics(input.actual, input.reference, { x: 0, y: 0, width: input.actual.width, height: input.actual.height });
  base.regions = (input.rois ?? []).map((roi) => {
    const m = metrics(input.actual, input.reference!, roi);
    return { id: roi.id, metrics: m, status: passes(m, roi.tolerance) ? "passed" : "failed" };
  });
  base.status = passes(base.metrics, input.tolerance) && base.regions.every((r) => r.status === "passed") ? "passed" : "failed";
  const data = new Uint8Array(input.actual.data.length);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : Math.max(Math.abs(input.actual.data[i] - input.reference.data[i]), Math.abs(input.actual.data[i - i % 4 + 3] - input.reference.data[i - i % 4 + 3]));
  return { ...base, diff: { width: input.actual.width, height: input.actual.height, data } };
}
export function summarizeVisualSuite(results: VisualFrameResult[]) {
  const mandatory = results.filter((r) => r.mandatory), failed = mandatory.filter((r) => r.status !== "passed");
  return { passed: mandatory.length > 0 && failed.length === 0, total: results.length, mandatory: mandatory.length, failed: failed.map((r) => ({ id: r.id, status: r.status })) };
}
