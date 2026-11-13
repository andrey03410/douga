import React from "react";
import { Composition } from "remotion";
import { StoryboardSheet, DEFAULT_STORYBOARD_SHEET, type StoryboardSheetProps } from "@douga/render/StoryboardSheet";
import {
  StudioVideo,
  DEFAULT_STUDIO_PROPS,
  type StudioVideoProps,
} from "@douga/render/StudioVideo";

export const STUDIO_COMPOSITION_ID = "Studio";

// Remotion's Composition generic is constrained to Record<string, unknown>; our
// props are a fixed shape, so we bridge with a cast at this single boundary.
type Props = Record<string, unknown>;

export const RemotionRoot: React.FC = () => {
  return (
    <><Composition
      id={STUDIO_COMPOSITION_ID}
      component={StudioVideo as unknown as React.FC<Props>}
      defaultProps={DEFAULT_STUDIO_PROPS as unknown as Props}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={90}
      calculateMetadata={({ props }) => {
        const { plan } = props as unknown as StudioVideoProps;
        return {
          durationInFrames: Math.max(1, plan.durationInFrames),
          fps: plan.fps,
          width: plan.width,
          height: plan.height,
        };
      }}
    />
    <Composition id="StoryboardSheet" component={StoryboardSheet as unknown as React.FC<Props>}
      defaultProps={DEFAULT_STORYBOARD_SHEET as unknown as Props} fps={30} width={1600} height={400} durationInFrames={1}
      calculateMetadata={({ props }) => ({ width: (props as unknown as StoryboardSheetProps).width, height: (props as unknown as StoryboardSheetProps).height })} />
    </>
  );
};
