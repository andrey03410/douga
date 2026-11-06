import type { StoryboardSelection, StoryboardTile } from "@/video/storyboard";
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
  scope?: { mode: "overview" | "scene" | "compare"; sceneId?: string; segmentId?: string; pageSize: number };
  compareOrigin?: InspectionOrigin;
  diagnostic?: { ready: false; codes: string[] };
}
export interface StoryboardRenderInput {
  kind: "storyboard";
  tiles: (StoryboardTile & { side?: "before" | "after"; source?: number; missing?: boolean })[];
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
  side?: "before" | "after";
}
