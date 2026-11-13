import "server-only";
import { applyMatchData, compileVideo, matchDataSchema, type MatchData } from "@douga/video";
import { StudioError } from "./errors";
import { canonical, hash } from "./shared";
import { freezeTypographyFonts, getTypographyMeasureText } from "./typography-fonts";
import type { StudioFrozenRevision } from "./types";

/** Optional match data of storyboard, review, jobs and timeline: checked, never saved into the document. */
export const matchDataInput = matchDataSchema.optional();

/** The frozen revision as a game would show it with this match data. */
export async function frozenWithMatchData(
  frozen: StudioFrozenRevision,
  matchData: MatchData,
  fontDirectory?: string,
): Promise<StudioFrozenRevision> {
  if (!frozen.resolvedDocument.interactive) throw new StudioError("INTERACTIVE_LAYER_MISSING");
  // Parts the request leaves out come from the sample, as in a linear render.
  const document = applyMatchData(frozen.resolvedDocument, { ...frozen.resolvedDocument.interactive.sample, ...matchData });
  const measureText = frozen.plan.fonts?.length ? await getTypographyMeasureText() : undefined;
  const compiled = compileVideo(document, frozen.manifest, { measureText });
  const errors = compiled.diagnostics.filter((d) => d.severity === "error" && d.code !== "TEXT_OVERFLOW");
  if (errors.length) throw new StudioError("VALIDATION_FAILED", errors.slice(0, 100));
  const { snapshotId, hash: _old, ...rest } = structuredClone(frozen);
  const content = {
    ...rest,
    plan: compiled.plan,
    validation: { ready: true, diagnostics: compiled.diagnostics },
    // Inspection copies refreeze fonts from the catalog; the worker freezes them here.
    fontFiles: fontDirectory && compiled.plan.fonts?.length
      ? await freezeTypographyFonts(compiled.plan.fonts, fontDirectory)
      : {},
  } as Omit<StudioFrozenRevision, "snapshotId" | "hash">;
  return { ...content, snapshotId, hash: hash(canonical(content)) };
}

/** Part of a cache key: the same request with other data is another inspection. */
export const matchDataHash = (matchData: MatchData | undefined) =>
  matchData ? hash(canonical(matchData)) : undefined;
