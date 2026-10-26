import type {
  AssetManifest,
  CompiledAudio,
  Diagnostic,
  ResolvedAsset,
  Settings,
  VideoDocument,
} from "./types";
import { mergeSettings, DEFAULT_SETTINGS } from "./settings";
export interface CompileContext {
  document: VideoDocument;
  manifest: AssetManifest;
  fps: number;
  width: number;
  height: number;
  diagnostics: Diagnostic[];
  audio: CompiledAudio[];
  settings: Settings;
}
export function diagnostic(
  ctx: CompileContext,
  code: string,
  message: string,
  path: string,
  nodeId?: string,
  severity: Diagnostic["severity"] = "error",
): void {
  ctx.diagnostics.push({
    severity,
    code,
    message,
    path,
    ...(nodeId ? { nodeId } : {}),
  });
}
export function resolveAsset(
  ctx: CompileContext,
  key: string | undefined,
  path: string,
  kind: "visual" | "audio" | "any" = "any",
  required = true,
): ResolvedAsset | undefined {
  if (!key) return;
  const asset = ctx.manifest[key];
  if (!asset) {
    diagnostic(
      ctx,
      "ASSET_NOT_FOUND",
      `Resolve media key "${key}" in the asset manifest.`,
      path,
      undefined,
      required && !key.startsWith("slot:") ? "error" : "warning",
    );
    return;
  }
  if (
    (kind === "visual" && asset.kind === "audio") ||
    (kind === "audio" &&
      (asset.kind === "image" ||
        (asset.kind === "video" && asset.hasAudio === false)))
  ) {
    diagnostic(
      ctx,
      "ASSET_KIND_MISMATCH",
      `Media key "${key}" cannot be used as ${kind}.`,
      path,
    );
    return;
  }
  const binding = ctx.document.bindings[key];
  if (binding?.kind === "pool" && binding.assetId !== asset.id) {
    diagnostic(
      ctx,
      "ASSET_ID_MISMATCH",
      `Media key "${key}" resolved a different pool asset.`,
      path,
    );
    return;
  }
  if (
    binding &&
    "hash" in binding &&
    binding.hash &&
    binding.hash !== asset.hash
  ) {
    diagnostic(
      ctx,
      "ASSET_HASH_MISMATCH",
      `Media key "${key}" differs from its pinned hash.`,
      path,
    );
    return;
  }
  return asset;
}
export function effectiveSettings(
  ctx: CompileContext,
  ...layers: (Settings | undefined)[]
): Settings {
  return mergeSettings(DEFAULT_SETTINGS, ctx.settings, ...layers);
}
