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
    import {StudioVideo} from "./packages/render/src/StudioVideo.tsx";
    import {createVideoDocument, compileVideo} from "./packages/video/src/index.ts";
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

it("renders blur for image, video and card visuals", () => {
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
    import {StudioVideo} from "./packages/render/src/StudioVideo.tsx";
    import {createVideoDocument,compileVideo} from "./packages/video/src/index.ts";
    const doc=createVideoDocument({kind:"top",participants:[{id:"p",label:"P",media:{visual:"image"}}]});
    doc.scenes=[{id:"s",block:"custom",duration:{sec:1},nodes:[
      {id:"image",type:"image",asset:"image",style:{blur:4}},
      {id:"video",type:"video",asset:"video",style:{blur:6}},
      {id:"card",type:"card",participantId:"p",style:{blur:8}},
    ]}];
    const plan=compileVideo(doc,{image:{id:"i",kind:"image",src:"https://media.invalid/i.png"},video:{id:"v",kind:"video",src:"https://media.invalid/v.mp4",durationSec:2}}).plan;
    console.log(renderToString(React.createElement(Player,{acknowledgeRemotionLicense:true,component:StudioVideo,inputProps:{plan},compositionWidth:plan.width,compositionHeight:plan.height,fps:plan.fps,durationInFrames:plan.durationInFrames})));
  `,
    ],
    { env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" },
  );
  expect(output).toContain("filter:blur(4px)");
  expect(output).toContain("filter:blur(6px)");
  expect(output).toContain("filter:blur(8px)");
}, 15_000);

it("holds outgoing last frames for all new transitions across scene and segment boundaries", () => {
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
    import {StudioVideo} from "./packages/render/src/StudioVideo.tsx";
    import {plan,videoNode} from "./packages/player/src/fixtures.ts";
    const node=videoNode({from:0,durationInFrames:60,visible:[{from:0,to:60}],animation:[{property:'x',easing:'linear',keyframes:[{frame:0,value:0},{frame:59,value:59}]}]});
    node.media.asset.src='https://media.invalid/previous.mp4';
    node.media.asset.posterSrc='https://media.invalid/poster.jpg';
    const previous={id:'previous',segmentId:'a',kind:'custom',from:0,durationInFrames:60,background:'#000',nodes:[node],phases:{},transition:{type:'fade',durationInFrames:10}};
    const result=[];
    for(const type of ['wipe','zoom','push','flash','iris','split','blur','crossfade']) {
      const next={...previous,id:'next',segmentId:'b',from:60,durationInFrames:50,nodes:[],transition:{type,durationInFrames:11}};
      const video=plan({durationInFrames:110,scenes:[previous,next]});
      const frames=[60,65,70,71,65].map(initialFrame=>{
        const html=renderToString(React.createElement(Player,{acknowledgeRemotionLicense:true,component:StudioVideo,inputProps:{plan:video},compositionWidth:video.width,compositionHeight:video.height,fps:video.fps,durationInFrames:video.durationInFrames,initialFrame}));
        return {sources:[...html.matchAll(/<video[^>]*src="([^"]+)"/g)].map(m=>m[1]),lastPosition:html.includes('translate(59px, 0px)'),poster:html.includes('src="https://media.invalid/poster.jpg"')};
      });
      const first=plan({durationInFrames:50,scenes:[{...next,from:0}]});
      const firstHtml=renderToString(React.createElement(Player,{acknowledgeRemotionLicense:true,component:StudioVideo,inputProps:{plan:first},compositionWidth:first.width,compositionHeight:first.height,fps:first.fps,durationInFrames:first.durationInFrames}));
      result.push({type,frames,firstInvalid:/NaN|Infinity/.test(firstHtml)});
    }
    console.log(JSON.stringify(result));
  `,
    ],
    { env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" },
  );
  const result = JSON.parse(output) as {
    type: string;
    frames: { sources: string[]; lastPosition: boolean; poster: boolean }[];
    firstInvalid: boolean;
  }[];
  for (const { frames, firstInvalid } of result) {
    expect(firstInvalid).toBe(false);
    for (const index of [0, 1, 2, 4]) {
      expect(frames[index].sources).toEqual(frames[0].sources);
      expect(frames[index].lastPosition).toBe(true);
      expect(frames[index].poster).toBe(false);
      expect(
        Number(frames[index].sources[0].split("#t=")[1].split(",")[0]),
      ).toBeCloseTo(149 / 30, 2);
    }
    expect(frames[3].sources).toEqual([]);
  }
}, 15000);
