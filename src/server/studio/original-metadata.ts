import { imageSizeFromFile } from "image-size/fromFile";
import { parseFile } from "music-metadata";

// Metadata readers inspect the original container/header without starting a decoder.
export async function originalMetadata(file: string, kind: string) {
  if (kind === "image") {
    const { width, height } = await imageSizeFromFile(file);
    return { width, height, hasAudio: false, hasVideo: true, durationSec: null };
  }
  const { format } = await parseFile(file, { skipCovers: true, duration: false });
  return { width: undefined, height: undefined, hasAudio: kind === "audio" || Boolean(format.numberOfChannels),
    hasVideo: kind === "video", durationSec: format.duration ?? null };
}
