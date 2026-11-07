/** Task 33: one place that turns tournament service codes into Russian messages. */
const MESSAGES: Record<string, string> = {
  GROUP_MISMATCH: "Экран устарел — обновите страницу и ответьте заново",
  NOTHING_TO_ANSWER: "Сравнивать больше нечего",
  SCHEME_REQUIRED: "Сначала выберите алгоритм расстановки",
  INVALID_PAIR: "Некорректные данные сравнения",
  INVALID_TIER: "Нет такой корзины",
  NOT_TIERS: "У этого сегмента алгоритм без корзин",
  UNKNOWN_SCHEME: "Неизвестный алгоритм",
  INVALID_SCHEME_SETTINGS: "Некорректные настройки алгоритма",
  ARCHIVE_QUOTA: "Не хватает квоты турнира на эти файлы",
  TOO_MANY_PARTICIPANTS: "В турнире слишком много участников (не больше 2000)",
  TOO_MANY_SHIKIMORI: "За один раз — не больше 300 участников из Shikimori",
  NOTHING_TO_ADD: "Нечего добавлять",
  NOTHING_TO_DELETE: "Не выбраны участники",
  STUDIO_ASSET_IN_USE: "Участник используется в проекте студии — сначала уберите его оттуда",
  IMAGE_TOO_LARGE: "Картинка больше 32 МБ",
  BAD_EXT: "Такой формат не поддерживается",
  NOT_COMPLETE: "Сегмент ещё не завершён",
  NOTHING_MORE_TO_ASK: "Все возможные сравнения уже сделаны",
  ALREADY_FINALIZED: "Топ уже сохранён",
  NOTHING_TO_UNDO: "Отменять нечего",
  UNDO_BEFORE_REOPEN: "Ответы, данные до добавления новичков, не отменяются",
};

export function tournamentErrorMessage(code: string): string {
  if (code.startsWith("DUPLICATE_ITEM:"))
    return `«${code.slice("DUPLICATE_ITEM:".length)}» уже есть в этом сегменте`;
  return MESSAGES[code] ?? code;
}

/** Segment id from the JSON body, else from the query string. */
export function segmentIdOf(req: Request, body?: unknown): string | undefined {
  const fromBody = (body as { segmentId?: unknown } | null)?.segmentId;
  if (typeof fromBody === "string") return fromBody;
  return new URL(req.url).searchParams.get("segmentId") ?? undefined;
}
