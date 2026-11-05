import { NextResponse } from "next/server";
import { permissionOr403, badRequest, tooLarge } from "@/lib/api";
import { quotasFor } from "@/lib/domain/permissions";
import { inspectTrackArchive } from "@/lib/upload";
export async function POST(req: Request) {
  const auth = await permissionOr403(
    "tournament:create",
    "Создание турниров недоступно вашей роли",
  );
  if ("response" in auth) return auth.response;
  const max = quotasFor(auth.user.role).maxArchiveBytes;
  if (Number(req.headers.get("content-length") ?? 0) > max)
    return tooLarge("Архив слишком большой");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Прикрепите ZIP-архив");
  if (file.size > max) return tooLarge("Архив слишком большой");
  try {
    return NextResponse.json(
      inspectTrackArchive(Buffer.from(await file.arrayBuffer())),
    );
  } catch {
    return badRequest("Не удалось прочитать архив");
  }
}
