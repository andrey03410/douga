import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps actual Player video fragments constant across frame updates, seeks and loop boundaries", () => {
  // Production SSR runs the actual Player/Studio component tree without React's
  // development-only server useLayoutEffect warnings. No media is fetched.
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import React from "react";
    import {renderToString} from "react-dom/server";
    import {Player} from "@remotion/player";
    import {StudioVideo} from "./src/remotion/StudioVideo.tsx";
    import {createVideoDocument, compileVideo} from "./src/video/index.ts";
    const document = createVideoDocument({kind:"top"});
    document.bindings = {clip:{kind:"pool",assetId:"clip"}};
    document.scenes = [{id:"source",block:"custom",duration:{sec:12},nodes:[
      {id:"one",type:"video",asset:"clip",style:{loop:true,offsetSec:0}},
      {id:"two",type:"video",asset:"clip",style:{loop:true,offsetSec:0.2}},
    ]}];
    const manifest = {clip:{id:"clip",kind:"video",src:"https://media.invalid/clip.mp4",durationSec:8,width:1920,height:1080}};
    const sources = (plan, initialFrame) => {
      const html = renderToString(React.createElement(Player, {
        acknowledgeRemotionLicense:true, component:StudioVideo, inputProps:{plan},
        compositionWidth:plan.width, compositionHeight:plan.height, fps:plan.fps,
        durationInFrames:plan.durationInFrames, initialFrame,
      }));
      return [...html.matchAll(/<video[^>]*src="([^"]+)"/g)].map(match=>match[1]);
    };
    const moving = compileVideo(document,manifest).plan;
    const active = [31,32,239,240,255,32].map(frame=>sources(moving,frame));
    document.scenes[0].nodes[0].style = {loop:false,offsetSec:7};
    const nonloop = compileVideo(document,manifest).plan;
    console.log(JSON.stringify({active,beforeTail:sources(nonloop,0),held:sources(nonloop,45)}));
  `,
    ],
    { env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" },
  );
  const result = JSON.parse(output) as {
    active: string[][];
    beforeTail: string[];
    held: string[];
  };
  const src = "https://media.invalid/clip.mp4#t=";
  // Remotion clips the last partial Loop's end to the remaining composition
  // length. That change occurs at the loop boundary; consecutive output frames
  // within either segment must not change the media fragment.
  expect(result.active).toEqual([
    [src + "0,8", src + "0.2,8"],
    [src + "0,8", src + "0.2,8"],
    [src + "0,8", src + "0.2,4.4"],
    [src + "0,4", src + "0.2,4.4"],
    [src + "0,4", src + "0.2,4.4"],
    [src + "0,8", src + "0.2,8"],
  ]);
  expect(result.beforeTail[0]).toBe("https://media.invalid/clip.mp4#t=7,8");
  const heldSourceStart = Number(result.held[0].split("#t=")[1].split(",")[0]);
  expect(heldSourceStart).toBeCloseTo(239 / 30, 2);
}, 15_000);
