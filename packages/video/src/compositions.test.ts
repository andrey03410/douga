import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { createMeasureText } from "@douga/node";
import { createVideoDocument } from "./builders";
import { compileVideo } from "./compiler";
import { getBuiltinPreset } from "./presets";
import { settingsSchema, videoPresetSchema } from "./schema";
import { getCompositionPresets, getCompositionPreset } from "./composition-presets";
import { typographyFontAssets } from "./font-manifest";
import { evaluateNode } from "../../render/src/studio-frame";
import { transitionLayers } from "../../render/src/motion-transition";
import type { AssetManifest, CompiledScene, VideoDocument, VideoFormat } from "./types";
import type { MeasureText } from "./typography-types";
import legacy from "../../../.ai/features/35-studio-design-quality/legacy-ir.json";

let measureText: MeasureText;
beforeAll(async () => {
  measureText = await createMeasureText({ load: asset => readFile(path.join(process.cwd(), "public", asset.src)) });
});
const visual = { id: "portrait", kind: "image" as const, src: "https://example.test/portrait.png", width: 800, height: 1200 };
const manifest: AssetManifest = { art: visual, ost: { id: "ost", kind: "audio", src: "https://example.test/ost.mp3", durationSec: 90 } };
function top(format: VideoFormat, music = false): VideoDocument {
  const doc = createVideoDocument({kind:"top", preset:getCompositionPreset(`composition.top.${music ? "music" : "portrait"}.${format}`)!,
    participants:[{id:"p", label:"Фрирен: за гранью отправляющихся в последний путь", subtitle:"葬送のフリーレン", rank:70,
      media:{visual:"art", ...(music ? {audio:"ost"} : {})}, bestMomentSec:3}]});
  doc.bindings = {art:{kind:"pool",assetId:"portrait"}, ...(music ? {ost:{kind:"pool",assetId:"ost"}} : {})};
  return doc;
}
function picker(format: VideoFormat): VideoDocument {
  const doc = createVideoDocument({kind:"picker", preset:getCompositionPreset(`composition.picker.${format}`)!, participants:Array.from({length:6},(_,i)=>({id:`p${i}`, label:`Персонаж с длинным именем ${i+1}`, media:{visual:"art"}})),
    rounds:[{id:"r",prompt:"Кого выберешь?",cards:Array.from({length:6},(_,i)=>({id:`c${i}`,participantId:`p${i}`})),groups:Array.from({length:3},(_,i)=>({id:`g${i}`,label:["Мудрые наставники","Тихие герои","Сильные соперники"][i],cardIds:[`c${i*2}`,`c${i*2+1}`]}))}]});
  doc.bindings={art:{kind:"pool",assetId:"portrait"}};
  return doc;
}
function compile(doc: VideoDocument) {
  const result = compileVideo(doc,manifest,{measureText});
  expect(result.ready,JSON.stringify(result.diagnostics)).toBe(true);
  return result.plan;
}
const text = (scene: CompiledScene, name: string) => scene.nodes.find(node=>node.id.endsWith(`/${name}`))!;
describe("versioned compositions",()=>{
  it("accepts only explicit supported markers and never installs one implicitly",()=>{
    expect(settingsSchema.parse({})).not.toHaveProperty("composition");
    expect(settingsSchema.parse({composition:null}).composition).toBeNull();
    expect(settingsSchema.safeParse({composition:{version:1,variant:"music-top",accent:"#d8b874",palette:["#111827","#e5c384"]}}).success).toBe(true);
    for(const marker of [{version:2,variant:"music-top"},{version:1,variant:"cinematic"},{version:1,variant:"picker",css:"body{}"}])
      expect(settingsSchema.safeParse({composition:marker}).success).toBe(false);
  });
  it("offers exactly twelve independent type-first compositions",()=>{
    const presets=getCompositionPresets();
    expect(presets.map(p=>p.id).sort()).toEqual(["top.portrait","top.music","picker","tier-list"].flatMap(kind=>["wide","vertical","square"].map(format=>`composition.${kind}.${format}`)).sort());
    for(const preset of presets) expect(videoPresetSchema.safeParse(preset).success,preset.id).toBe(true);
    presets[0].settings.composition!.accent="#000000";
    expect(getCompositionPreset(presets[0].id)!.settings.composition!.accent).not.toBe("#000000");
  });
  it("preserves every pre-existing preset IR at five frame rates",()=>{
    for(const baseline of legacy) {
      const preset=getBuiltinPreset(baseline.id)!;
      const result=compileVideo(createVideoDocument({kind:preset.kind,preset,fps:baseline.fps}));
      expect(createHash("sha256").update(JSON.stringify(result)).digest("hex"),`${baseline.id}/${baseline.fps}`).toBe(baseline.hash);
    }
  });
  for(const format of ["wide","vertical","square"] as const) {
    it(`uses separate large art, rank and readable titles for portrait top in ${format}`,()=>{
      const plan=compile(top(format)); const scene=plan.scenes[0];
      expect(scene.nodes.find(n=>n.type==="card")!.rect.height).toBeGreaterThan(plan.height*.45);
      for(const role of ["rank","title","subtitle"]) expect(text(scene,role)?.text).toBeTruthy();
      expect(text(scene,"title").textLayout!.truncated).toBe(false);
      expect(scene.nodes.filter(n=>n.type==="card").every(n=>!n.label)).toBe(true);
    });
    it(`uses a full backdrop and outlined musical rank without a label plate in ${format}`,()=>{
      const doc=top(format,true); const plan=compile(doc); const scene=plan.scenes[0];
      expect(scene.backdrop?.layers).toHaveLength(1);
      expect(text(scene,"rank").rankDraw!.durationInFrames).toBeGreaterThan(0);
      expect(text(scene,"rank").typography!.font).toBe("cinzel");
      expect(text(scene,"title").typography!.font).toBe("cormorant-garamond");
      expect(scene.nodes.some(n=>n.type==="card"&&n.label)).toBe(false);
      expect(plan.audio).toHaveLength(1);
      expect(plan.audio[0]).toMatchObject({from:0,offsetFrames:90,durationInFrames:scene.durationInFrames});
    });
    it(`fills 3×2 picker groups with equal tall portraits and gives a settled choice window in ${format}`,()=>{
      const plan=compile(picker(format));const scene=plan.scenes[0];const cards=scene.nodes.filter(n=>n.type==="card");
      expect(cards).toHaveLength(6);
      const first=cards[0].rect;
      for(const card of cards) {
        expect(card.rect.width/card.rect.height).toBeLessThan(.9);
        expect(card.rect.width).toBeCloseTo(first.width,4);
        expect(card.rect.height).toBeCloseTo(first.height,4);
        const settle=Math.max(0,...(card.motion??[]).filter(m=>m.channel==="enter").map(m=>m.from+m.durationInFrames));
        expect(settle).toBeLessThanOrEqual(scene.phases.timerStartFrame!);
        expect(evaluateNode(card,scene.phases.timerStartFrame!,plan.fps).visible).toBe(true);
        const group=scene.nodes.find(node=>node.type==="group"&&node.groupId===card.groupId);
        if(group) expect(group.layer).toBeLessThan(card.layer);
      }
      expect(first.height/plan.height).toBeGreaterThan(format==="wide"?.47:.19);
      expect(scene.durationInFrames-scene.phases.timerStartFrame!).toBeGreaterThanOrEqual(60);
      expect(scene.nodes.some(n=>n.id.endsWith("/round-wipe"))).toBe(true);
    });
  }
  it("reports authored geometry conflicts and excessive picker density instead of silently shrinking",()=>{
    const doc=picker("wide");doc.settings.layout={type:"free",positions:[]};
    expect(compileVideo(doc,manifest,{measureText}).diagnostics.some(d=>d.code==="COMPOSITION_GEOMETRY_CONFLICT")).toBe(true);
    const dense=picker("vertical");dense.source.rounds[0].cards=Array.from({length:30},(_,i)=>({id:`many${i}`,participantId:"p0"}));delete dense.source.rounds[0].groups;
    expect(compileVideo(dense,manifest,{measureText}).diagnostics.some(d=>d.code==="COMPOSITION_DENSITY_EXCEEDED"&&d.path.includes("r"))).toBe(true);
  });
  it.each(["vertical", "square"] as const)("keeps ungrouped six-option %s pickers recognizable", format => {
    const doc=picker(format); delete doc.source.rounds[0].groups;
    const plan=compile(doc), cards=plan.scenes[0].nodes.filter(n=>n.type==="card");
    expect(new Set(cards.map(n=>n.rect.y)).size).toBeGreaterThan(1);
    for(const card of cards) {
      expect(card.rect.width/card.rect.height).toBeGreaterThanOrEqual(.4);
      expect(card.rect.height/plan.height).toBeGreaterThan(.2);
      expect(card.rect.x+card.rect.width).toBeLessThanOrEqual(plan.width);
      expect(card.rect.y+card.rect.height).toBeLessThanOrEqual(plan.height*.9);
    }
    expect(plan.scenes[0].nodes.some(n=>n.id.includes("group-number/"))).toBe(false);
  });
  it("adapts a square picker with two groups of three without turning portraits into strips",()=>{
    const doc=picker("square"); doc.source.rounds[0].groups=[
      {id:"a",label:"Первая команда",cardIds:["c0","c1","c2"]},
      {id:"b",label:"Вторая команда",cardIds:["c3","c4","c5"]},
    ];
    const cards=compile(doc).scenes[0].nodes.filter(n=>n.type==="card");
    for(const card of cards) expect(card.rect.width/card.rect.height).toBeGreaterThanOrEqual(.4);
    expect(new Set(cards.map(n=>n.rect.y)).size).toBeGreaterThan(1);
  });
  it("keeps authored media backgrounds visible beneath composition lighting",()=>{
    const tier=createVideoDocument({kind:"board",preset:getCompositionPreset("composition.tier-list.wide")!});
    const separate=picker("wide"); separate.settings.picker!.answerMode="separate";
    separate.source.rounds[0].answer={groupIds:["g0"]};
    const documents=[top("wide"),picker("wide"),tier,separate];
    for(const doc of documents) {
      (doc.segments?.[0].scenes??doc.scenes)[0].background="art";
      doc.bindings.art={kind:"pool",assetId:"portrait"};
      const plan=compile(doc);
      for(const scene of plan.scenes) {
        const background=scene.nodes.find(n=>n.id.endsWith("/background"))!;
        expect(background?.media).toBeDefined();
        const light=scene.nodes.find(n=>/\/(?:picker-ambient|ambient)(?:\/answer)?$/.test(n.id))!;
        expect(light.opacity??1).toBeLessThan(1);
      }
    }
  });
  it("keeps the group ordinal beside its heading after a tall panel reflows",()=>{
    const doc=picker("vertical");
    doc.source.rounds[0].groups=[{id:"one",label:"Команда",cardIds:doc.source.rounds[0].cards.map(c=>c.id)}];
    const nodes=compile(doc).scenes[0].nodes;
    const heading=nodes.find(n=>n.id.includes("group-title/"))!.rect;
    const badge=nodes.find(n=>n.id.includes("group-badge/"))!.rect;
    expect(badge.y+badge.height/2).toBeCloseTo(heading.y+heading.height/2,4);
  });
  it("keeps the round number whole during its hold and allows typography and motion profile overrides",()=>{
    const doc=picker("wide");
    doc.settings.typography!.roles!.prompt!.font="rubik";
    doc.settings.typography!.roles!.rank!.font="rubik";
    doc.settings.motion={profile:"snappy",intensity:"normal",duration:{sec:.2}};
    const plan=compile(doc),scene=plan.scenes[0];
    expect(transitionLayers(scene.transition,6,scene.durationInFrames,plan.width,plan.height).incoming.clipPath).toBeUndefined();
    expect(scene.nodes.find(n=>n.id.endsWith("/round-number"))!.typography!.font).toBe("rubik");
    expect(scene.nodes.find(n=>n.id.includes("/group-title/"))!.typography!.font).toBe("rubik");
    expect(scene.nodes.flatMap(n=>n.motion??[]).every(clip=>clip.profile==="snappy")).toBe(true);
    expect(scene.nodes.find(n=>n.type==="card")!.motion!.find(clip=>clip.channel==="enter")!.durationInFrames).toBe(6);
    expect(scene.nodes.find(n=>n.id.endsWith("/prompt"))!.style.borderWidth).toBe(0);
    expect(scene.nodes.find(n=>n.type==="timer")!.style.background).toBe("transparent");
  });
  it("keeps label parents and protective shades in a separate answer scene",()=>{
    const doc=picker("wide");doc.settings.picker!.answerMode="separate";doc.source.rounds[0].answer={groupIds:["g0"]};
    const scene=compile(doc).scenes[1],ids=new Set(scene.nodes.map(node=>node.id));
    expect(scene.nodes.some(node=>node.id.includes("card-shade"))).toBe(true);
    expect(scene.nodes.filter(node=>node.parentId).every(node=>ids.has(node.parentId!))).toBe(true);
    expect(scene.nodes.some(node=>node.id.endsWith("/round-wipe/answer"))).toBe(false);
    expect(scene.nodes.filter(node=>node.id.includes("card-label")).every(node=>evaluateNode(node,0,30).visible)).toBe(true);
  });
  it("presents authored tier distribution without candidate timers, and addresses unreadable rows",()=>{
    const preset=getCompositionPreset("composition.tier-list.wide")!;
    const doc=createVideoDocument({kind:"board",preset,participants:[{id:"a",label:"Лелуш Ламперуж",media:{visual:"art"}},{id:"b",label:"Вайолет Эвергарден",media:{visual:"art"}}],roundCount:0});
    const board=doc.segments![0].scenes[0].board!;
    board.rounds=[{id:"assigned",cards:[{id:"a",participantId:"a"},{id:"b",participantId:"b"}],actions:[{id:"a",type:"place",cardId:"a",slotId:board.slots[0].id},{id:"b",type:"place",cardId:"b",slotId:board.slots[2].id}]}];
    doc.bindings={art:{kind:"pool",assetId:"portrait"}};
    const plan=compile(doc);
    expect(plan.scenes.every(scene=>scene.nodes.every(node=>node.type!=="timer"))).toBe(true);
    expect(plan.scenes.at(-1)!.boardState!.placements).toEqual({a:board.slots[0].id,b:board.slots[2].id});
    expect(plan.scenes.some(scene=>scene.boardEvents?.some(event=>event.slotId===board.slots[0].id))).toBe(true);
    expect(plan.scenes[0].nodes.find(node=>node.id.includes("slot-label"))!.typography!.verticalAlign).toBe("middle");
    board.rounds[0].cards=Array.from({length:100},(_,i)=>({id:`c${i}`,participantId:"a"}));board.allowRepeatParticipants=true;
    board.rounds[0].actions=board.rounds[0].cards.map(card=>({id:card.id,type:"place",cardId:card.id,slotId:board.slots[0].id}));
    expect(compileVideo(doc,manifest,{measureText}).diagnostics.some(d=>d.code==="COMPOSITION_DENSITY_EXCEEDED")).toBe(true);
  });
  it("pins the new serif font bytes and license, and measures real Cyrillic and Japanese",async()=>{
    for(const font of ["cinzel","cormorant-garamond"] as const) {
      const assets=typographyFontAssets.filter(a=>a.font===font);expect(assets.length).toBeGreaterThanOrEqual(2);
      for(const asset of assets) {
        const bytes=await readFile(path.join(process.cwd(),"public",asset.src));
        const license=await readFile(path.join(process.cwd(),"public",asset.license));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.hash);
        expect(createHash("sha256").update(license).digest("hex")).toBe(asset.licenseHash);
        expect(asset.source).toMatch(/google\/fonts\/[a-f0-9]{40}\//);
      }
    }
    const scene=compile(top("wide",true)).scenes[0];
    for(const role of ["title","subtitle"]) expect(text(scene,role).textLayout!.missing).toEqual([]);
  });
});
