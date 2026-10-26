import type { CardStyle, CompiledMedia, ResolvedAsset } from "./types";
import { diagnostic, type CompileContext } from "./context";
export function compileMedia(
  ctx: CompileContext,
  asset: ResolvedAsset,
  style: CardStyle,
  path: string,
): CompiledMedia {
  const offsetFrames =
    asset.kind === "image" ? 0 : Math.round((style.offsetSec ?? 0) * ctx.fps);
  const available =
    asset.durationSec === undefined
      ? undefined
      : Math.floor(asset.durationSec * ctx.fps) - offsetFrames;
  if (available !== undefined && available < 1)
    diagnostic(
      ctx,
      "MEDIA_OFFSET_OUT_OF_RANGE",
      "Media offset must leave at least one source frame.",
      path,
    );
  if (asset.kind === "video" && asset.durationSec === undefined)
    diagnostic(
      ctx,
      "MEDIA_DURATION_REQUIRED",
      "Video duration metadata is required for safe looping and end-frame hold.",
      path,
    );
  return {
    asset,
    offsetFrames,
    loopFrames:
      asset.kind === "video" && (style.loop ?? true) && available !== undefined
        ? Math.max(1, available)
        : null,
    fit: style.fit ?? "cover",
    ...(style.crop ? { crop: style.crop } : {}),
    ...(asset.kind === "video" && available !== undefined
      ? { freezeAtFrame: Math.max(offsetFrames, offsetFrames + available - 1) }
      : {}),
  };
}
