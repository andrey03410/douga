"use client";
import type { AnyZodObject } from "zod";
import { Player } from "@remotion/player";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { CompiledVideo } from "@/video";
export default function StudioPreview({ plan }: { plan: CompiledVideo }) {
  return (
    <div className="studio-player">
      <Player<AnyZodObject, { plan: CompiledVideo; assetMode: "url" }>
        component={StudioVideo}
        inputProps={{ plan, assetMode: "url" }}
        durationInFrames={Math.max(1, plan.durationInFrames)}
        compositionWidth={plan.width}
        compositionHeight={plan.height}
        fps={plan.fps}
        controls
        loop
        style={{ width: "100%", maxHeight: "65vh" }}
      />
    </div>
  );
}
