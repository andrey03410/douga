import React from "react";
import type { CompiledNode } from "@douga/video/types";
import { getFontFace } from "@douga/video/font-manifest";
import { useTypographyFonts } from "./typography-fonts";

const clamp = (n: number) => Math.max(0,Math.min(1,n));
/** Integer frame inputs, no DOM measurements or animation clock. */
export function rankDrawAt(draw: NonNullable<CompiledNode["rankDraw"]>,frame: number) {
  const progress=clamp((frame-draw.from)/Math.max(1,draw.durationInFrames-1));
  return {stroke:progress,fill:clamp((progress-.72)/.28)};
}

/** Numeric rank uses the same pinned face and measured box as ordinary typography. */
export const RankDrawText: React.FC<{node:CompiledNode;frame:number}>=({node,frame})=>{
  const assets=useTypographyFonts(),layout=node.textLayout,style=node.typography;
  if(!layout||!style||!node.rankDraw)return null;
  const state=rankDrawAt(node.rankDraw,frame),faceId=`${style.font}-${style.weight}-${style.italic?"italic":"normal"}`;
  const face=assets.find(asset=>asset.id===faceId)??getFontFace(faceId);
  const dash=layout.fontSize*8;
  return <svg width="100%" height="100%" viewBox={`0 0 ${node.rect.width} ${node.rect.height}`} style={{position:"absolute",inset:0,overflow:"visible"}} data-rank-draw="true" aria-label={node.text}>
    {layout.lines.map((line,index)=><text key={index} x={layout.rect.x+line.x} y={layout.rect.y+line.y+layout.fontSize*.80}
      fontFamily={face?.family} fontWeight={style.weight} fontStyle={style.italic?"italic":"normal"} fontSize={layout.fontSize} letterSpacing={style.letterSpacing}
      fill={style.fill} fillOpacity={state.fill} stroke={style.fill} strokeWidth={Math.max(1,layout.fontSize*.007)} strokeLinejoin="round"
      strokeDasharray={`${dash} ${dash}`} strokeDashoffset={dash*(1-state.stroke)} style={{fontSynthesis:"none"}}>{line.text}</text>)}
  </svg>;
};
