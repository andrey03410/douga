import type { VideoContentInput } from "../src/video/content";
/** Consume the short form actually advertised to a client; never synthesize render nodes. */
export function ownedScenarioContent(example: VideoContentInput, media: { visualAssetIds: string[]; audioAssetId: string }, title: string): VideoContentInput {
  if (!media.visualAssetIds.length || !media.audioAssetId) throw new Error("OWNED_MEDIA_REQUIRED");
  const content = structuredClone(example);
  content.title = title;
  content.participants = content.participants?.map((p, i) => ({ ...p, visualAssetId: media.visualAssetIds[i % media.visualAssetIds.length], audioAssetId: media.audioAssetId }));
  return content;
}
export function measurePcm16(pcm: Buffer, sampleRate: number) {
  if (!pcm.length || pcm.length % 2 || !Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error("INVALID_PCM");
  let energy = 0, peak = 0;
  for (let i = 0; i < pcm.length; i += 2) { const sample = pcm.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
  const sampleCount = pcm.length / 2, rms = Math.sqrt(energy / sampleCount);
  return { sampleRate, sampleCount, durationSec: sampleCount / sampleRate, rms, peak, meanDb: rms === 0 ? null : 20 * Math.log10(rms), peakDb: peak === 0 ? null : 20 * Math.log10(peak), silent: peak <= 10 ** (-70 / 20) };
}
export function parseMcpToolData(value: unknown): any {
  if (!value || typeof value !== "object") throw new Error("MCP_STRUCTURED_RESPONSE_REQUIRED");
  const response = value as { isError?: unknown; structuredContent?: any; content?: unknown };
  const content = response.content as { type: string; text?: string }[] | undefined;
  const raw = response.structuredContent ?? JSON.parse(content?.find((item) => item.type === "text")?.text ?? "null");
  if (response.isError) throw new Error(raw?.error?.code ?? "MCP_TOOL_FAILED");
  if (!raw || typeof raw !== "object") throw new Error("MCP_STRUCTURED_RESPONSE_REQUIRED");
  return raw;
}
