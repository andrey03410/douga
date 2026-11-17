import "server-only";
import { z } from "zod";
import { getVideoRecipe, videoRecipeStyles } from "@douga/video/recipes";
import { getCompositionRecipes, getVideoDesignGuide } from "@douga/video/authoring";
import { actor } from "./shared";
import { StudioError } from "./errors";
export const selectStudioRecipesSchema = z.object({
  kind: z.enum(["top", "picker", "board", "tier-list"]).optional(),
  subject: z.enum(["characters", "anime", "music"]).optional(),
  format: z.enum(["wide", "vertical", "square"]).optional(),
  style: z.enum(videoRecipeStyles).optional(), query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(3).default(3),
}).strict();
export type SelectStudioRecipesInput = z.input<typeof selectStudioRecipesSchema>;
export async function selectStudioRecipes(userId: string, raw: SelectStudioRecipesInput = {}) {
  const input = selectStudioRecipesSchema.parse(raw); await actor(userId);
  const kind = input.kind === "tier-list" ? "board" : input.kind;
  const musical = input.subject === "music" || /музык|ost|трек|music/i.test(input.query ?? "");
  const compatible = getCompositionRecipes().filter(r => (!kind || r.kind === kind) && r.format === (input.format ?? "wide"));
  const items = compatible.filter(r => !input.style || r.style === input.style)
    .sort((a,b) => Number(b.id.includes(".music.") === musical) - Number(a.id.includes(".music.") === musical))
    .slice(0,input.limit).map(({preset: _preset, example: _example,...metadata}) => ({ ...metadata, quality: "curated", authoringKind: metadata.kind === "board" ? "tier-list" : metadata.kind }));
  return { items, recommended: items[0]?.id ?? null, reason: items.length ? null : "Для выбранного типа нет такого сочетания. Начните с типа ролика и уточните стиль на проверенной основе.", alternatives: items.length ? [] : compatible.map(r=>r.id).slice(0,3),
    designGuide: input.kind ? getVideoDesignGuide(input.kind === "board" ? "tier-list" : input.kind, input.subject ?? (musical ? "music" : "characters"), input.format ?? "wide") : null };
}
export async function getVideoRecipeForActor(userId: string, id: string) { await actor(userId); const recipe=getVideoRecipe(id); if(!recipe)throw new StudioError("NOT_FOUND");return recipe; }
export async function listStudioRecipeGallery(userId: string, raw: SelectStudioRecipesInput & {all?:boolean} = {}) {
  const {all,...filters}=z.object({...selectStudioRecipesSchema.shape,all:z.boolean().default(false)}).strict().parse(raw);
  const selected=await selectStudioRecipes(userId,filters);if(!all)return selected;
  const kind=filters.kind==="tier-list"?"board":filters.kind;
  const items=getCompositionRecipes().filter(r=>(!kind||r.kind===kind)&&(!filters.format||r.format===filters.format))
    .map(({preset:_,example:__,...metadata})=>({...metadata,quality:"curated",authoringKind:metadata.kind==="board"?"tier-list":metadata.kind}));
  return {...selected,items,total:items.length};
}
