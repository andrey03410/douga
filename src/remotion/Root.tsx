import React from "react";
import { Composition } from "remotion";
import {
  StudioVideo,
  DEFAULT_STUDIO_PROPS,
  type StudioVideoProps,
} from "./StudioVideo";
import { TopVideo } from "./TopVideo";
import { PickerVideo, type PickerVideoProps } from "./PickerVideo";
import {
  DEFAULT_PROPS,
  DEFAULT_PICKER_PROPS,
  type TopVideoProps,
} from "./types";

export const COMPOSITION_ID = "Top";
export const PICKER_COMPOSITION_ID = "Picker";
export const STUDIO_COMPOSITION_ID = "Studio";

// Remotion's Composition generic is constrained to Record<string, unknown>; our
// props are a fixed shape, so we bridge with casts at this single boundary.
type Props = Record<string, unknown>;
const Comp = TopVideo as unknown as React.FC<Props>;
const PickerComp = PickerVideo as unknown as React.FC<Props>;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
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
      <Composition
        id={COMPOSITION_ID}
        component={Comp}
        defaultProps={DEFAULT_PROPS as unknown as Props}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={90}
        calculateMetadata={({ props }) => {
          const plan = (props as unknown as TopVideoProps).plan;
          return {
            durationInFrames: Math.max(1, plan.durationInFrames),
            fps: plan.fps,
            width: plan.width,
            height: plan.height,
          };
        }}
      />
      <Composition
        id={PICKER_COMPOSITION_ID}
        component={PickerComp}
        defaultProps={DEFAULT_PICKER_PROPS as unknown as Props}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={90}
        calculateMetadata={({ props }) => {
          const plan = (props as unknown as PickerVideoProps).plan;
          return {
            durationInFrames: Math.max(1, plan.durationInFrames),
            fps: plan.fps,
            width: plan.width,
            height: plan.height,
          };
        }}
      />
    </>
  );
};
