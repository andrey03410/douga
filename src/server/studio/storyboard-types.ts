import type { StoryboardSelection, StoryboardTile } from "@douga/video/storyboard";
import type { StudioFrozenRevision } from "./types";

export interface InspectionOrigin {
  projectId: string;
  version: number | null;
  revision: number | null;
  documentHash: string;
  contentHash: string;
  format: { width: number; height: number; fps: number };
}
export interface InspectionSummary {
  origin: InspectionOrigin;
  selection: StoryboardSelection;
  scope?: { mode: "overview" | "scene" | "compare"; sceneId?: string; segmentId?: string; pageSize: number; pixelDiff?: boolean };
  compareOrigin?: InspectionOrigin;
  diagnostic?: { ready: false; codes: string[] };
  comparison?: import("@douga/video/storyboard-diff").StoryboardDocumentDiff;
}
export interface StoryboardRenderInput {
  kind: "storyboard";
  tiles: (StoryboardTile & { side?: "before" | "after" | "diff"; source?: number; missing?: boolean })[];
  summary: InspectionSummary;
}
export interface InspectionJobInput {
  inspectionVersion: 1;
  frozen: StudioFrozenRevision;
  compareFrozen?: StudioFrozenRevision;
  origin: InspectionOrigin;
  summary: InspectionSummary;
  render: import("./job-types").StartStudioJobInput | StoryboardRenderInput;
  cacheKey: string;
}
export interface StoryboardFrameArtifact {
  id: string;
  name: string;
  hash: string;
  bytes: number;
  frame: number;
  sceneId: string;
  state: string;
  side?: "before" | "after" | "diff";
}
