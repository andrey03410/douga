import type { Settings, VideoFormat, VideoPreset } from "./types";
import type { CompositionSettings } from "./composition-settings";
import { getBoardPresets } from "./board-presets";

const variants = ["portrait-top", "music-top", "picker", "tier-list"] as const;
const formats: VideoFormat[] = ["wide", "vertical", "square"];
function preset(variant: CompositionSettings["variant"], format: VideoFormat): VideoPreset {
  const music = variant === "music-top";
  const kind = variant === "picker" ? "picker" : variant === "tier-list" ? "board" : "top";
  const id = variant === "portrait-top" ? "top.portrait" : variant === "music-top" ? "top.music" : variant;
  const settings: Settings = {
    composition: { version: 1, variant, accent: music ? "#ddbd7f" : "#d9b971" },
    background: music ? "#0b0b10" : "#0c101a",
    card: { orientation: "portrait", fit: "cover", borderRadius: 14, borderWidth: 1, borderColor: "#a8936b", background: "#18202d", color: "#f7f4ed" },
    typography: { version:1, roles: {
      title: { font: music ? "cormorant-garamond" : "oswald", weight:700, fontSize:music ? 76 : 72, minFontSize:music ? 42 : 38, maxLines:3, padding:0, align:"left", plate:null, outlines:null },
      subtitle: { font: music ? "cormorant-garamond" : "manrope", weight:400, italic:music, fontSize:36, minFontSize:26, maxLines:2, align:"left", fill:"#c5c8d0", plate:null },
      label: { font:"manrope", weight:700, fontSize:32, minFontSize:24, maxLines:3, padding:0, align:"center", verticalAlign:"bottom", plate:null },
      prompt: { font:"oswald", weight:700, fontSize:58, minFontSize:36, maxLines:2, align:"center", padding:0, plate:null },
      rank: { font:music ? "cinzel" : "oswald", weight:700, fontSize:music ? 240 : 170, minFontSize:72, maxLines:1, wrap:"none", align:music ? "center" : "left", padding:0, fill:music ? "#ddbd7f" : "#d9b971", plate:null },
      timer: { font:"oswald", weight:700, fontSize:54, minFontSize:32, padding:0, plate:null },
      caption: { font:"manrope", weight:400, fontSize:28, minFontSize:22, maxLines:2, plate:null },
    } },
    motion: { profile:music ? "cinematic" : "smooth", intensity:"subtle" },
    labels:{mode:"always",showRank:false},
    ...(kind === "top" ? {top:{durationSec:music ? 30 : 6, order:"descending",snippet:{mode:"manual",startSec:0}} as Settings["top"]} : {}),
    ...(kind === "picker" ? {picker:{leadSec:.9,revealSec:.65,staggerSec:.12,timerSec:2,answerSec:1.8,answerMode:"inline",showPrompt:true} as Settings["picker"]} : {}),
    ...(music ? {backdrop:{preset:"art-blur",source:"current-card",blur:12,dim:.66,motion:true,intensity:"subtle"} as Settings["backdrop"]} : {}),
    timer:{variant:"ring",color:"#d9b971",trackColor:"#ffffff20",strokeWidth:3,showValue:true,warningSec:0},
  };
  const board = kind === "board" ? structuredClone(getBoardPresets().find(p=>p.id===`board.tier.${format}`)!.scenes) : undefined;
  if (board) {
    board[0].board!.presentation={...board[0].board!.presentation,leadSec:.6,rowFocusSec:2.5,finalSec:3};
    board[0].transition={type:"crossfade",duration:{sec:.4}};
  }
  return { schemaVersion:1,id:`composition.${id}.${format}`,version:1,name:variant==="portrait-top"?"Топ персонажей":music?"Топ музыки":kind==="picker"?"Пикер":"Тир-лист",kind,output:{format,fps:30},settings,
    scenes:board??[{id:"main",block:kind,repeat:kind==="top"?"participants":"rounds",nodes:[],transition:{type:"crossfade",duration:{sec:kind==="picker"?.12:.6}}}],
    skeleton:{roundCount:kind==="top"?0:1,cardsPerRound:kind==="picker"?6:1,groupCount:kind==="picker"?3:0},
  };
}
/** Fresh values and no builders/presets imports: safe in browsers and registry. */
export function getCompositionPresets(): VideoPreset[] { return variants.flatMap(variant=>formats.map(format=>preset(variant,format))); }
export function getCompositionPreset(id: string): VideoPreset | undefined {
  return getCompositionPresets().find(preset => preset.id === id);
}
