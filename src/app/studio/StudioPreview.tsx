"use client";
import { useMemo } from "react";
import type { AnyZodObject } from "zod";
import { Player } from "@remotion/player";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { CompiledVideo } from "@/video";
import { sharedAudioTagCount } from "@/watch/model";
export default function StudioPreview({ plan }: { plan: CompiledVideo }) {
  // Premounted cues hold a shared tag too, so the default of five can run out.
  const audioTags = useMemo(() => sharedAudioTagCount(plan), [plan]);
  return (
    <div className="studio-player">
      <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
        component={StudioVideo}
        inputProps={{ plan, assetMode: "url" }}
        durationInFrames={Math.max(1, plan.durationInFrames)}
        compositionWidth={plan.width}
        compositionHeight={plan.height}
        fps={plan.fps}
        numberOfSharedAudioTags={audioTags}
        controls
        loop
        style={{ width: "100%", maxHeight: "65vh" }}
      />
    </div>
  );
}
