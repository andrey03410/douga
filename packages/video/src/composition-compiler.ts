import type { BoardState, CompiledNode, CompiledScene, Participant, PickerRound, Rect, Settings, VideoScene } from "./types";
import type { MotionSettings } from "./motion-types";
import type { TextTypography, TypographyRole } from "./typography-types";
import { diagnostic, effectiveSettings, type CompileContext } from "./context";
import { baseNode } from "./nodes";
import { setNodeTypography } from "./typography-compiler";
import { setNodeMotion } from "./motion-compiler";

const quiet: MotionSettings = {choreography:null, enter:null, exit:null, loop:null, emphasis:null, stagger:null};
const authoredSettings = new WeakMap<CompiledNode, Settings>();
const localMotion = (node: CompiledNode, motion: MotionSettings = {}) => {
  const value = {...quiet,...motion}; setNodeMotion(node,value,value);
};
const frame = (ctx: CompileContext, sec: number) => Math.max(1,Math.round(sec*ctx.fps));
const accent = (settings: Settings) => settings.composition?.accent ?? "#d9b971";
const tint = (color: string, opacity: number) => /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(opacity*255).toString(16).padStart(2,"0")}` : color;
function text(ctx: CompileContext, scene: CompiledScene, settings: Settings, id: string, value: string, rect: Rect, role: TypographyRole, own?: TextTypography) {
  const node=baseNode(`${scene.id}/${id}`,"text",rect,scene.durationInFrames,{background:"transparent",borderWidth:0});
  node.text=value;node.layer=12;setNodeTypography(node,settings,own,role);authoredSettings.set(node,settings);localMotion(node);scene.nodes.push(node);return node;
}
function shape(scene: CompiledScene,id: string,rect: Rect,fill: string,layer: number) {
  const node=baseNode(`${scene.id}/${id}`,"shape",rect,scene.durationInFrames,{borderWidth:0,background:"transparent"});
  node.shape="rect";node.fill=fill;node.layer=layer;localMotion(node);scene.nodes.push(node);return node;
}
function checkGeometry(ctx: CompileContext, settings: Settings, path: string) {
  if(settings.layout?.type==="free") diagnostic(ctx,"COMPOSITION_GEOMETRY_CONFLICT","The composition cannot replace authored free positions. Keep the existing layout or explicitly remove the free layout before trying this composition.",path);
}
function entrance(ctx: CompileContext,node: CompiledNode,delay=0,duration=.55,name: "blur-reveal"|"wipe-reveal"|"slide-up"|"fade"="fade") {
  const authored=(authoredSettings.get(node)??ctx.settings).motion?.duration;
  localMotion(node,{enter:{name,duration:authored??{frame:frame(ctx,duration)},delay:{frame:Math.max(0,Math.round(delay*ctx.fps))}}});
}
/** Reuses the original top card/audio calculation; only opted-in geometry is replaced. */
export function composeTop(ctx: CompileContext,scene: CompiledScene,person: Participant,settings: Settings): void {
  const composition=settings.composition;if(!composition)return;
  if(!["portrait-top","music-top"].includes(composition.variant)) {
    diagnostic(ctx,"COMPOSITION_KIND_MISMATCH","This composition requires a top variant.",`source.participants.${person.id}.settings.composition`);return;
  }
  checkGeometry(ctx,settings,`source.participants.${person.id}.settings.layout`);
  const music=composition.variant==="music-top",wide=ctx.width>ctx.height,square=ctx.width===ctx.height;
  const w=ctx.width,h=ctx.height,card=scene.nodes.find(node=>node.type==="card")!;
  card.label="";card.showRank=false;card.labelWindows=[];
  card.style={...card.style,borderWidth:music?0:1,borderColor:accent(settings),borderRadius:music?0:18,background:music?"transparent":"#192330",shadow:music?null:{color:"#00000090",blur:40,y:20}};
  setNodeTypography(card,settings,null);localMotion(card);
  authoredSettings.set(card,settings);
  if(music) {
    // A service card keeps current-card media resolution and existing interaction IDs.
    // The backdrop paints the artwork; the service card has no visible label or media.
    card.rect={x:0,y:0,width:w,height:h};card.opacity=0;card.layer=-90;
    const vignette=shape(scene,"vignette",{x:0,y:0,width:w,height:h},"transparent",-20);
    vignette.style.gradient={type:"radial",center:{x:.5,y:.4},stops:[{at:0,color:"#05060b00"},{at:1,color:"#05060be8"}]};
    const light=shape(scene,"music-light",{x:w*.15,y:0,width:w*.7,height:h*.6},"transparent",-15);
    light.style.gradient={type:"radial",center:{x:.5,y:.35},stops:[{at:0,color:accent(settings)},{at:1,color:"transparent"}]};
    light.opacity=.07;localMotion(light);
    const rankRect={x:w*.08,y:h*(wide?.13:.16),width:w*.84,height:h*(square?.30:.27)};
    const rank=text(ctx,scene,settings,"rank",String(person.rank??""),rankRect,"rank",{align:"center",verticalAlign:"middle",fill:accent(settings),fontSize:Math.min(w*.23,h*.27),minFontSize:Math.min(w*.12,h*.14),lineHeight:1.05});
    const reveal=Math.min(frame(ctx,2.2),Math.max(1,Math.floor(scene.durationInFrames*.24)));
    rank.rankDraw={from:0,durationInFrames:reveal};
    const title=text(ctx,scene,settings,"title",person.caption??person.label,{x:w*.10,y:h*(wide?.46:.49),width:w*.8,height:h*.22},"title",{align:"center",verticalAlign:"middle"});
    const subtitle=text(ctx,scene,settings,"subtitle",person.subtitle??person.album??person.comment??"",{x:w*.13,y:h*.735,width:w*.74,height:h*.11},"subtitle",{align:"center",verticalAlign:"top"});
    const timeScale=Math.min(1,scene.durationInFrames/(ctx.fps*8));
    entrance(ctx,title,1.6*timeScale,.85*timeScale,"blur-reveal");entrance(ctx,subtitle,2.1*timeScale,.6*timeScale);
    const line=shape(scene,"accent-line",{x:w*.42,y:h*.71,width:w*.16,height:2},accent(settings),10);entrance(ctx,line,1.5*timeScale,.6*timeScale);
  } else {
    card.rect=wide?{x:w*.075,y:h*.11,width:w*.345,height:h*.78}:square?{x:w*.06,y:h*.13,width:w*.43,height:h*.74}:{x:w*.15,y:h*.07,width:w*.70,height:h*.49};
    const panel=shape(scene,"ambient",{x:0,y:0,width:w,height:h},"transparent",-20);
    panel.style.gradient={type:"radial",center:{x:wide?.2:.5,y:.4},stops:[{at:0,color:"#263441"},{at:1,color:"#0c101a"}]};
    if(settings.backdrop)panel.opacity=.55;
    const x=wide?w*.49:square?w*.55:w*.09,width=wide?w*.43:square?w*.4:w*.82;
    const rank=text(ctx,scene,settings,"rank",String(person.rank??""),{x,y:h*(wide?.19:square?.17:.58),width,height:h*(wide?.19:square?.20:.10)},"rank",{fill:accent(settings),fontSize:wide?170:square?140:118,minFontSize:72,lineHeight:1.05});
    const title=text(ctx,scene,settings,"title",person.caption??person.label,{x,y:h*(wide?.43:square?.41:.70),width,height:h*(wide?.25:square?.29:.14)},"title");
    const subtitle=text(ctx,scene,settings,"subtitle",person.subtitle??person.album??person.comment??"",{x,y:h*(wide?.73:square?.76:.865),width,height:h*.095},"subtitle");
    entrance(ctx,card,.15,.65,"wipe-reveal");entrance(ctx,rank,0,.45,"slide-up");entrance(ctx,title,.42,.5,"blur-reveal");entrance(ctx,subtitle,.7,.4);
    shape(scene,"accent-line",{x,y:h*(wide?.395:square?.385:.69),width:Math.min(width*.25,110),height:3},accent(settings),10);
  }
}

/** Exact compositions avoid recursively fitting a portrait inside a fitted portrait panel. */
export function composePicker(ctx: CompileContext,scene: CompiledScene,round: PickerRound,settings: Settings): void {
  if(!settings.composition)return;
  if(settings.composition.variant!=="picker") {diagnostic(ctx,"COMPOSITION_KIND_MISMATCH","Picker scenes require the picker composition.",`source.rounds.${round.id}.settings.composition`);return;}
  checkGeometry(ctx,settings,`source.rounds.${round.id}.settings.layout`);
  for(const group of round.groups??[]) checkGeometry(ctx,group.settings??{},`source.rounds.${round.id}.groups.${group.id}.settings.layout`);
  const w=ctx.width,h=ctx.height,wide=w>h,square=w===h;
  const grouped=Boolean(round.groups?.length);
  const groups=round.groups?.length?round.groups:[{id:"all",label:"",cardIds:round.cards.map(card=>card.id)}];
  const cards=scene.nodes.filter(node=>node.type==="card");
  const maxCards=wide?8:square?6:6;
  if(cards.length>maxCards||groups.length>(wide?4:3)) diagnostic(ctx,"COMPOSITION_DENSITY_EXCEEDED",`This ${ctx.document.output.format} picker has ${cards.length} cards in ${groups.length} groups. Split the round or use fewer options so portraits and names remain readable.`,`source.rounds.${round.id}.cards`);
  const prompt=scene.nodes.find(node=>node.id.endsWith("/prompt"));
  if(prompt) {prompt.rect={x:w*.06,y:h*.035,width:w*.88,height:h*(wide?.105:.09)};prompt.style={background:"transparent",borderWidth:0};localMotion(prompt);}
  const timer=scene.nodes.find(node=>node.type==="timer");
  if(timer) {timer.rect={x:w*.38,y:h*.91,width:w*.24,height:h*.06};timer.style={background:"transparent",borderWidth:0,color:accent(settings)};localMotion(timer);}
  const ambient=shape(scene,"picker-ambient",{x:0,y:0,width:w,height:h},"transparent",-80);
  ambient.style.gradient={type:"linear",angle:135,stops:[{at:0,color:"#182334"},{at:.55,color:"#101521"},{at:1,color:"#090d15"}]};
  if(settings.backdrop||round.background)ambient.opacity=.42;
  const area={x:w*.045,y:h*(wide?.205:square?.17:.15),width:w*.91,height:h*(wide?.64:square?.70:.72)};
  const columns=wide||square?groups.length:1,gap=wide?32:22;
  const rows=Math.ceil(groups.length/columns);
  const panelW=(area.width-gap*(columns-1))/columns,panelH=(area.height-gap*(rows-1))/rows;
  const palette=settings.composition.palette??[accent(settings),"#77c4c2","#b499d9"];
  groups.forEach((group,index)=>{
    const authoredGroup=round.groups?.find(item=>item.id===group.id);
    const groupSettings=effectiveSettings(ctx,settings,authoredGroup?.settings);
    const panel={x:area.x+(index%columns)*(panelW+gap),y:area.y+Math.floor(index/columns)*(panelH+gap),width:panelW,height:panelH};
    const headerH=grouped?(wide?70:square?66:54):0;
    const existing=scene.nodes.find(node=>node.type==="group"&&node.groupId===group.id);
    if(existing) {existing.text="";setNodeTypography(existing,settings,null);localMotion(existing);}
    const header=grouped?text(ctx,scene,groupSettings,`group-title/${encodeURIComponent(group.id)}`,group.label??"",{x:panel.x,y:panel.y,width:panel.width,height:headerH},"prompt",{fontSize:wide?42:34,minFontSize:26,maxLines:2,align:"center",verticalAlign:"middle",fill:palette[index%palette.length]}):undefined;
    const first=cards.find(card=>group.cardIds.includes(card.cardId??""));
    const visibility=first?.visible??[{from:0,to:scene.durationInFrames}];
    if(header){header.visible=visibility;entrance(ctx,header,0,.35,"slide-up");}
    const stack=square&&groups.length>=3;
    const count=group.cardIds.length,innerGap=wide?16:12;
    let cardH=stack?(panel.height-headerH-innerGap*(count-1))/Math.max(1,count):panel.height-headerH;
    let cardW=Math.min(stack?panel.width:(panel.width-innerGap*(count-1))/Math.max(1,count),cardH*.74);
    let cardColumns=stack?1:Math.max(1,count),cardRows=stack?Math.max(1,count):1;
    // Preserve spacious authored groups; reflow narrow strips into recognizable portraits.
    if(cardH>0&&cardW/cardH<.4) {
      let bestArea=0;
      for(let columns=1;columns<=count;columns++) {
        const rows=Math.ceil(count/columns);
        const height=Math.min((panel.height-headerH-innerGap*(rows-1))/rows,((panel.width-innerGap*(columns-1))/columns)/.68);
        const width=height*.68;
        if(height>0&&width*height>bestArea){bestArea=width*height;cardColumns=columns;cardRows=rows;cardW=width;cardH=height;}
      }
    }
    const usedWidth=cardColumns*cardW+innerGap*(cardColumns-1);
    const usedHeight=cardRows*cardH+innerGap*(cardRows-1);
    const gridTop=panel.y+headerH+(panel.height-headerH-usedHeight)/2;
    const frameRect={x:panel.x+(panel.width-usedWidth)/2-12,y:gridTop-headerH-6,width:usedWidth+24,height:headerH+usedHeight+18};
    if(existing) {existing.rect=frameRect;existing.layer=-5;existing.style={background:"#17203055",borderWidth:1,borderColor:tint(palette[index%palette.length],.33),borderRadius:18,shadow:{color:tint(palette[index%palette.length],.10),blur:30}};}
    const glow=shape(scene,`group-light/${encodeURIComponent(group.id)}`,{x:Math.max(0,frameRect.x-20),y:frameRect.y,width:Math.min(w-Math.max(0,frameRect.x-20),frameRect.width+40),height:frameRect.height},"transparent",-30);
    glow.style.gradient={type:"radial",center:{x:.5,y:.35},stops:[{at:0,color:palette[index%palette.length]},{at:1,color:"transparent"}]};glow.opacity=.16;glow.visible=visibility;
    localMotion(glow);
    if(header) {
    header.rect={x:frameRect.x+42,y:gridTop-headerH,width:frameRect.width-54,height:headerH};
    const badge=shape(scene,`group-badge/${encodeURIComponent(group.id)}`,{x:frameRect.x+12,y:gridTop-headerH*.5-15,width:28,height:30},tint(palette[index%palette.length],.16),8);
    badge.style.borderRadius=6;badge.visible=header.visible;
    const ordinal=text(ctx,scene,settings,`group-number/${encodeURIComponent(group.id)}`,String(index+1),badge.rect,"caption",{fontSize:19,minFontSize:18,maxLines:1,align:"center",verticalAlign:"middle",fill:palette[index%palette.length]});ordinal.visible=header.visible;
    }
    group.cardIds.forEach((cardId,ci)=>{
      const card=cards.find(candidate=>candidate.cardId===cardId);if(!card)return;
      const authoredCard=round.cards.find(item=>item.id===cardId);
      const person=ctx.document.source.participants.find(item=>item.id===card.participantId);
      const local=effectiveSettings(ctx,settings,person?.settings,authoredGroup?.settings,authoredCard?.settings);
      authoredSettings.set(card,local);
      const label=card.label??"";
      const row=Math.floor(ci/cardColumns),column=ci%cardColumns;
      const rowCards=Math.min(cardColumns,count-row*cardColumns),rowWidth=rowCards*cardW+innerGap*(rowCards-1);
      card.rect={x:panel.x+(panel.width-rowWidth)/2+column*(cardW+innerGap),y:gridTop+row*(cardH+innerGap),width:cardW,height:cardH};
      card.style={...card.style,borderRadius:12,borderWidth:1,borderColor:palette[index%palette.length],shadow:{color:"#00000090",y:12,blur:24}};
      card.label="";card.showRank=false;setNodeTypography(card,settings,null);
      const oldWindows=card.labelWindows;card.labelWindows=[];
      entrance(ctx,card,0,.5,"wipe-reveal");
      const shade=shape(scene,`card-shade/${encodeURIComponent(cardId)}`,{x:card.rect.x,y:card.rect.y+card.rect.height*.56,width:card.rect.width,height:card.rect.height*.44},"transparent",5);
      shade.parentId=card.id;shade.visible=card.visible;
      shade.style.gradient={type:"linear",angle:180,stops:[{at:0,color:"#05091100"},{at:.65,color:"#050911df"},{at:1,color:"#050911fa"}]};
      const caption=text(ctx,scene,local,`card-label/${encodeURIComponent(cardId)}`,label,{x:card.rect.x+cardW*.045,y:card.rect.y+cardH*.64,width:cardW*.91,height:cardH*.31},"label",{fontSize:wide?32:square?27:30,minFontSize:wide?24:22,maxLines:3,verticalAlign:"bottom",align:"center",shadows:[{color:"#000000",blur:4,y:1}]});
      caption.participantId=card.participantId;caption.cardId=card.cardId;caption.groupId=card.groupId;
      caption.parentId=card.id;caption.visible=oldWindows??card.visible;
      entrance(ctx,caption,.2,.25);
    });
  });
  const roundNumber=ctx.document.source.rounds.findIndex(item=>item.id===round.id)+1;
  const counter=text(ctx,scene,settings,"round-counter",`${String(roundNumber).padStart(2,"0")} / ${ctx.document.source.rounds.length}`,{x:w*.79,y:h*.135,width:w*.16,height:h*.035},"caption",{fontSize:24,minFontSize:18,maxLines:1,align:"right",verticalAlign:"middle",fill:"#a0aabd"});
  counter.layer=12;
  // The transition holds the preceding frame; the numbered shutter occupies lead time.
  const lead=scene.phases.revealStartFrame??0;
  if(lead>0) {
    const wipe=shape(scene,"round-wipe",{x:0,y:0,width:w,height:h},"#101622",90);
    wipe.shape="path";wipe.path=`M0 0 H${w} V${h} H0 Z`;
    wipe.visible=[{from:0,to:lead}];
    wipe.animation=[{property:"x",easing:"easeInOut",keyframes:[{frame:0,value:0},{frame:Math.floor(lead*.30),value:0},{frame:Math.max(1,lead-1),value:-w*1.2}]}];
    wipe.animation.push({property:"rotate",easing:"easeInOut",keyframes:[{frame:0,value:0},{frame:Math.floor(lead*.30),value:0},{frame:Math.max(1,lead-1),value:-12}]});
    const stripe=shape(scene,"wipe-accent",{x:0,y:0,width:w,height:h},accent(settings),91);
    stripe.shape="path";stripe.path=`M${w*.76} 0 H${w*.79} L${w*.60} ${h} H${w*.57} Z`;stripe.visible=wipe.visible;stripe.animation=structuredClone(wipe.animation);
    const number=ctx.document.source.rounds.findIndex(item=>item.id===round.id)+1;
    const badge=text(ctx,scene,settings,"round-number",String(number).padStart(2,"0"),{x:w*.3,y:h*.26,width:w*.4,height:h*.43},"rank",{fontSize:Math.min(h*.32,w*.28),minFontSize:64,fill:"#f6f0e4",align:"center",verticalAlign:"middle"});
    badge.layer=92;badge.visible=[{from:0,to:Math.max(1,Math.floor(lead*.7))}];
    badge.animation=[{property:"opacity",easing:"easeOut",keyframes:[{frame:0,value:1},{frame:Math.floor(lead*.30),value:1},{frame:Math.max(1,Math.floor(lead*.7)),value:0}]}];
  }
}

/** Readability gate shared by the distribution overview and focused row geometry. */
export function tierTileRects(ctx: CompileContext,count: number,rect: Rect,settings: Settings,path: string): Rect[] {
  if(!count)return[];
  const gap=Math.min(ctx.width,ctx.height)*.008;
  let best={columns:1,width:0,height:0};
  for(let columns=1;columns<=count;columns++) {
    const rows=Math.ceil(count/columns),height=Math.min((rect.height-(rows-1)*gap)/rows,((rect.width-(columns-1)*gap)/columns)/2.8);
    if(height>best.height)best={columns,width:height*2.8,height};
  }
  if(best.height<Math.min(ctx.width,ctx.height)*.09) diagnostic(ctx,"COMPOSITION_DENSITY_EXCEEDED",`This tier row has ${count} portraits and cannot keep names readable. Split the distribution into sections or focus on fewer participants.`,path);
  return Array.from({length:count},(_,i)=>({x:rect.x+(i%best.columns)*(best.width+gap),y:rect.y+Math.floor(i/best.columns)*(best.height+gap),width:Math.max(1,best.width),height:Math.max(1,best.height)}));
}

export function prepareTierComposition(ctx: CompileContext,settings: Settings,template: VideoScene): void {
  if(!settings.composition)return;
  if(settings.composition.variant!=="tier-list") diagnostic(ctx,"COMPOSITION_KIND_MISMATCH","Board presentation requires the tier-list composition.",`scenes.${template.id}.settings.composition`);
  checkGeometry(ctx,settings,`scenes.${template.id}.settings.layout`);
}
export function styleTierCard(ctx: CompileContext,scene: CompiledScene,node: CompiledNode,settings: Settings): void {
  const label=node.label??"",footprint={...node.rect};node.rect.width=Math.min(footprint.width*.32,footprint.height*.74);
  node.label="";node.labelWindows=[];node.style={...node.style,borderWidth:1,borderColor:"#5a6375",borderRadius:9};
  setNodeTypography(node,settings,null);localMotion(node);
  const caption=text(ctx,scene,settings,`label/${encodeURIComponent(node.cardId??node.id)}`,label,{x:node.rect.x+node.rect.width+footprint.height*.10,y:node.rect.y+footprint.height*.08,width:Math.max(1,footprint.width-node.rect.width-footprint.height*.16),height:footprint.height*.84},"label",{fontSize:Math.min(54,Math.max(26,node.rect.height*.22)),minFontSize:22,maxLines:3,verticalAlign:"middle",align:"left"});
  caption.parentId=node.id;localMotion(caption);
}

export function settleTierScene(scene: CompiledScene,settings: Settings,state: BoardState) {
  scene.boardState=structuredClone(state);
  for(const node of scene.nodes) if(!node.parentId) localMotion(node);
}
