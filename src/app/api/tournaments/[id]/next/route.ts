import { NextResponse } from "next/server";
import { userOr401, notFound } from "@/lib/api";
import { getTournament, nextComparison } from "@/server/tournaments";
import { MAX_GROUP_SIZE } from "@/lib/domain/group-answer";
import { SCHEME_INFO } from "@/lib/domain/scheme-settings";
import { participantDto } from "@/lib/participant-dto";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;

  const t = await getTournament(
    auth.userId,
    params.id,
    new URL(req.url).searchParams.get("segmentId") ?? undefined,
  );
  if (!t) return notFound();

  const step = nextComparison(t);
  const byId = new Map(t.tracks.map((tr) => [tr.id, tr]));
  const active = t.tracks.filter((tr) => !tr.excluded);

  return NextResponse.json({
    activeSegmentId: t.activeSegmentId,
    segmentTitle: t.segments.find((s) => s.id === t.activeSegmentId)?.title,
    segmentCount: t.segments.length,
    blindMode: t.blindMode,
    // Task 33: algorithm of this segment (null until the person chooses).
    scheme: step.scheme,
    schemeLabel: step.scheme ? SCHEME_INFO[step.scheme].label : null,
    schemeRequired: step.schemeRequired,
    settings: step.settings,
    tierNames: step.scheme === "tiers" ? (step.settings.tiers ?? []) : null,
    itemCount: active.length,
    kinds: [...new Set(active.map((tr) => tr.kind))],
    isComplete: step.isComplete,
    canExtend: step.canExtend,
    canUndo: step.canUndo,
    groupSize: step.groupSize,
    // Upper bound the picker offers: the engine's own cap, the global cap and
    // the field size, whichever is smallest.
    maxGroupSize: Math.min(step.maxGroupSize, MAX_GROUP_SIZE, Math.max(2, active.length)),
    progress: step.progress,
    screens: step.screens,
    coverage: step.coverage,
    standings: step.standings, // provisional top, or null for schemes without one
    questionKind: step.questionKind,
    question: step.question ? step.question.map((id) => participantDto(byId.get(id)!)) : null,
    // Thumbnails of every active participant: the page preloads them so the
    // next screen opens without a visible load.
    preload: active.filter((tr) => tr.kind === "image").map((tr) => participantDto(tr).thumbUrl),
  });
}
