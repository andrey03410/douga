import { NextResponse } from "next/server";
import { permissionOr403, badRequest } from "@/lib/api";
import { animeCharacters } from "@/server/shikimori";

/** Task 33: characters of one anime for the tournament form (main or all). */
export async function GET(req: Request) {
  const auth = await permissionOr403("tournament:create", "Создание турниров недоступно вашей роли");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const animeId = Number(url.searchParams.get("animeId"));
  const role = url.searchParams.get("role") === "all" ? "all" : "Main";
  if (!Number.isInteger(animeId) || animeId <= 0) return badRequest("animeId обязателен");
  try {
    return NextResponse.json({ results: await animeCharacters(animeId, { role }) });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "RATE_LIMITED") return badRequest("Shikimori: слишком много запросов, подождите");
    return badRequest("Shikimori недоступен — попробуйте позже");
  }
}
