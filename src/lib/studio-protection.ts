import { NextResponse } from "next/server";
export const studioProtectionMessage = (code: string): string | null =>
  (
    ({
      STUDIO_ASSET_IN_USE:
        "Медиа используется в SDK-проекте, черновике или истории. Удалите привязки и неиспользуемые ревизии; сначала удалите связанные задания и снимки.",
      STUDIO_SOURCE_IN_USE:
        "Турнир используется как источник SDK-проекта или его истории. Удалите связанные SDK-проекты либо освободите источник, ревизии и задания.",
      JOB_IN_USE:
        "У аккаунта есть активные SDK-задания. Отмените их и дождитесь, пока worker остановит попытку (аренда истекает за 30 секунд), затем повторите удаление. Завершённые задания удалятся вместе с аккаунтом.",
    }) as Record<string, string>
  )[code] ?? null;
export function studioProtectionResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const message = studioProtectionMessage(code);
  return message
    ? NextResponse.json({ error: message, code }, { status: 409 })
    : null;
}
