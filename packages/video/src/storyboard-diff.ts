import type {
  AssetManifest,
  CompiledVideo,
  Diagnostic,
  VideoDocument,
} from "./types";
import {
  reviewVideo,
  type VideoReviewIssue,
  type VideoReviewProfile,
  type VideoReviewReport,
} from "./video-review";

export interface StoryboardComparisonInput {
  document: VideoDocument;
  plan: CompiledVideo;
  diagnostics: Diagnostic[];
  manifest?: AssetManifest;
}
export interface StoryboardComparisonOptions {
  maxChanges?: number;
  maxIssues?: number;
  profile?: VideoReviewProfile;
}
export interface StoryboardPropertyChange {
  path: string[];
  label: string;
  kind: "added" | "removed" | "changed" | "reordered";
  before: string;
  after: string;
}
export interface StoryboardComparisonIssue {
  id: string;
  code: string;
  severity: VideoReviewIssue["severity"];
  sceneId?: string;
  segmentId?: string;
  nodeId?: string;
  frame?: number;
  message: string;
}
export type StoryboardComparisonCoverage = VideoReviewReport["coverage"] & {
  framesTruncated: boolean;
};
export interface StoryboardDocumentDiff {
  changes: StoryboardPropertyChange[];
  changesTotal: number;
  changesTruncated: boolean;
  resolvedIssues: StoryboardComparisonIssue[];
  newIssues: StoryboardComparisonIssue[];
  remainingIssues: StoryboardComparisonIssue[];
  totals: { resolved: number; new: number; remaining: number };
  coverage: {
    mode: "static-document-and-plan";
    before: StoryboardComparisonCoverage;
    after: StoryboardComparisonCoverage;
    notChecked: (
      | "renderedFrames"
      | "motion"
      | "audio"
      | "pixelContrast"
      | "mediaContent"
    )[];
  };
  /** Semantic authoring/media differences; this is never a visual-regression verdict. */
  contentChanged: boolean;
}
function canonical(value: unknown): string {
  return (
    JSON.stringify(value, (_key, entry: unknown) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : entry,
    ) ?? "undefined"
  );
}
function excerpt(value: unknown): string {
  const text =
    value === undefined
      ? "—"
      : typeof value === "string"
        ? value
        : canonical(value);
  if (text.length <= 160) return text;
  let end = 159;
  if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return `${text.slice(0, end)}…`;
}
function limit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const actual = value ?? fallback;
  if (!Number.isInteger(actual) || actual < 1 || actual > 50)
    throw Error(`${name} must be an integer from 1 to 50`);
  return actual;
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function byStableId(
  value: unknown[],
): Map<string, Record<string, unknown>> | null {
  const items = new Map<string, Record<string, unknown>>();
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.id !== "string" || items.has(entry.id))
      return null;
    items.set(entry.id, entry);
  }
  return items;
}
const collectionLabels: Record<string, string> = {
  scenes: "Сцены",
  segments: "Сегменты",
  nodes: "Элементы",
  children: "Дочерние элементы",
  participants: "Участники",
  rounds: "Раунды",
  cards: "Карточки",
  groups: "Группы",
  slots: "Слоты доски",
  actions: "Действия доски",
  cues: "Звуковые события",
};
const propertyLabels: Record<string, string> = {
  title: "Заголовок",
  subtitle: "Подзаголовок",
  text: "Текст",
  label: "Подпись",
  caption: "Подпись участника",
  prompt: "Вопрос раунда",
  fontSize: "Размер текста",
  minFontSize: "Минимальный размер текста",
  font: "Шрифт",
  weight: "Насыщенность шрифта",
  italic: "Курсив",
  lineHeight: "Межстрочный интервал",
  letterSpacing: "Межбуквенный интервал",
  maxLines: "Число строк",
  fit: "Подгонка содержимого",
  overflow: "Обрезка текста",
  wrap: "Перенос текста",
  role: "Роль текста",
  typography: "Типографика",
  theme: "Тема текста",
  plate: "Плашка подписи",
  outlines: "Обводка текста",
  shadows: "Тень текста",
  background: "Фон",
  fill: "Цвет заливки",
  color: "Цвет",
  gradient: "Градиент",
  shadow: "Тень",
  rect: "Область элемента",
  x: "Положение по горизонтали",
  y: "Положение по вертикали",
  width: "Ширина",
  height: "Высота",
  opacity: "Непрозрачность",
  rotate: "Поворот",
  scale: "Масштаб",
  layout: "Раскладка",
  padding: "Внутренние отступы",
  gap: "Расстояние между элементами",
  borderRadius: "Скругление",
  borderColor: "Цвет границы",
  borderWidth: "Толщина границы",
  duration: "Длительность",
  durationSec: "Длительность",
  durationFrames: "Длительность",
  durationInFrames: "Длительность",
  timing: "Время показа",
  at: "Начало показа",
  leadSec: "Вступление раунда",
  revealSec: "Время раскрытия",
  timerSec: "Время выбора",
  answerSec: "Время ответа",
  holdSec: "Время удержания",
  transition: "Переход",
  motion: "Движение",
  backdrop: "Динамический фон",
  output: "Формат вывода",
  format: "Формат вывода",
  fps: "Частота кадров",
  rank: "Место участника",
  score: "Оценка",
  comment: "Комментарий",
  album: "Альбом",
  media: "Медиа участника",
  asset: "Медиа элемента",
  audio: "Звук",
  visual: "Изображение или видео",
  volume: "Громкость",
  offsetSec: "Начало медиафрагмента",
  loop: "Повтор медиа",
  seed: "Начальное значение случайности",
  answer: "Авторский ответ",
  participantId: "Участник карточки",
  participantIds: "Состав участников",
  roundId: "Раунд",
  roundIds: "Состав раундов",
  cardIds: "Состав карточек",
  groupIds: "Состав групп",
  slotId: "Слот доски",
  cardId: "Карточка действия",
  bindings: "Привязки медиа",
  source: "Содержимое видео",
  board: "Сценарий доски",
  settings: "Настройки",
  enabled: "Включение сегмента",
  repeat: "Повтор сцен",
  type: "Тип элемента",
  kind: "Тип видео",
  mode: "Режим",
  order: "Порядок показа",
  preset: "Рецепт",
  id: "Идентификатор",
  hash: "Содержимое медиа",
  src: "Источник медиа",
  manifest: "Разрешённые медиа",
};
function labelFor(path: string[]): string {
  const key = path.at(-1) ?? "";
  if (key === "$order")
    return `Порядок ${path.at(-2) === "scenes" ? "сцен" : path.at(-2) === "segments" ? "сегментов" : path.at(-2) === "nodes" || path.at(-2) === "children" ? "элементов" : path.at(-2) === "participants" ? "участников" : path.at(-2) === "rounds" ? "раундов" : path.at(-2) === "cards" ? "карточек" : "элементов"}`;
  if ((key === "sec" || key === "frame") && path.includes("duration"))
    return "Длительность";
  if (key === "fill" && path.includes("typography")) return "Цвет текста";
  return (
    propertyLabels[key] ??
    collectionLabels[key] ??
    (collectionLabels[path.at(-2) ?? ""]
      ? `${collectionLabels[path.at(-2)!]}: состав`
      : "Свойство элемента")
  );
}
/** Presentation-only edits remain explicit changes without suggesting new story/media content. */
function isContentChange(
  path: string[],
  kind: StoryboardPropertyChange["kind"],
): boolean {
  if (path[0] === "manifest") return true;
  if (["output", "preset", "id", "schemaVersion"].includes(path[0] ?? ""))
    return false;
  if (
    path.some((key) =>
      [
        "typography",
        "style",
        "rect",
        "layout",
        "motion",
        "backdrop",
        "background",
        "gradient",
        "shadow",
      ].includes(key),
    )
  )
    return false;
  if (
    [
      "fontSize",
      "minFontSize",
      "font",
      "color",
      "fill",
      "padding",
      "opacity",
      "scale",
      "rotate",
      "layer",
      "units",
      "anchor",
      "borderRadius",
      "borderWidth",
      "borderColor",
    ].includes(path.at(-1) ?? "")
  )
    return false;
  if (path[0] === "source" || path[0] === "bindings") return true;
  if (
    ["added", "removed", "reordered"].includes(kind) &&
    path.some((key) => Object.hasOwn(collectionLabels, key))
  )
    return true;
  return path.some((key) =>
    [
      "title",
      "subtitle",
      "text",
      "label",
      "caption",
      "prompt",
      "comment",
      "answer",
      "board",
      "duration",
      "timing",
      "participantIds",
      "roundIds",
      "participantId",
      "roundId",
      "asset",
      "media",
      "audio",
      "visual",
      "repeat",
      "enabled",
      "seed",
      "top",
      "picker",
      "labels",
    ].includes(key),
  );
}
function normalizedManifest(manifest: AssetManifest): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest).map(([key, asset]) => [
      key,
      {
        id: asset.id,
        kind: asset.kind,
        ...(asset.hash ? { hash: asset.hash } : { src: asset.src }),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
        ...(asset.durationSec !== undefined
          ? { durationSec: asset.durationSec }
          : {}),
        ...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
      },
    ]),
  );
}
function compactIssue(issue: VideoReviewIssue): StoryboardComparisonIssue {
  return {
    id: issue.id,
    code: issue.code,
    severity: issue.severity,
    ...(issue.sceneId !== undefined ? { sceneId: issue.sceneId } : {}),
    ...(issue.segmentId !== undefined ? { segmentId: issue.segmentId } : {}),
    ...(issue.nodeId !== undefined ? { nodeId: issue.nodeId } : {}),
    ...(issue.frame !== undefined ? { frame: issue.frame } : {}),
    message: excerpt(issue.message),
  };
}
function compactCoverage(
  report: VideoReviewReport,
): StoryboardComparisonCoverage {
  return {
    ...report.coverage,
    examinedFrames: report.coverage.examinedFrames.slice(0, 24),
    framesTruncated: report.coverage.examinedFrames.length > 24,
  };
}
/** Static differences are observations of two origins, never a beauty or pixel-regression score. */
export function compareStoryboardDocuments(
  before: StoryboardComparisonInput,
  after: StoryboardComparisonInput,
  options: StoryboardComparisonOptions = {},
): StoryboardDocumentDiff {
  const maxChanges = limit(options.maxChanges, 50, "maxChanges"),
    maxIssues = limit(options.maxIssues, 20, "maxIssues");
  const changes: StoryboardPropertyChange[] = [];
  let changesTotal = 0,
    contentChanged = false;
  const record = (
    path: string[],
    kind: StoryboardPropertyChange["kind"],
    old: unknown,
    next: unknown,
  ) => {
    changesTotal++;
    contentChanged ||= isContentChange(path, kind);
    if (changes.length < maxChanges)
      changes.push({
        path,
        kind,
        label: labelFor(path),
        before: excerpt(old),
        after: excerpt(next),
      });
  };
  const walk = (old: unknown, next: unknown, path: string[]) => {
    if (canonical(old) === canonical(next)) return;
    if (old === undefined || next === undefined) {
      record(path, old === undefined ? "added" : "removed", old, next);
      return;
    }
    if (Array.isArray(old) && Array.isArray(next)) {
      const beforeItems = byStableId(old),
        afterItems = byStableId(next);
      if (beforeItems && afterItems) {
        for (const [id, value] of beforeItems)
          if (!afterItems.has(id))
            record([...path, id], "removed", value, undefined);
        for (const [id, value] of afterItems)
          if (!beforeItems.has(id))
            record([...path, id], "added", undefined, value);
        const retainedBefore = [...beforeItems.keys()].filter((id) =>
          afterItems.has(id),
        );
        const retainedAfter = [...afterItems.keys()].filter((id) =>
          beforeItems.has(id),
        );
        if (canonical(retainedBefore) !== canonical(retainedAfter))
          record(
            [...path, "$order"],
            "reordered",
            retainedBefore,
            retainedAfter,
          );
        for (const [id, value] of beforeItems)
          if (afterItems.has(id))
            walk(value, afterItems.get(id), [...path, id]);
        return;
      }
      if (
        old.every((v) => typeof v === "string") &&
        next.every((v) => typeof v === "string") &&
        new Set(old).size === old.length &&
        new Set(next).size === next.length &&
        canonical([...old].sort()) === canonical([...next].sort())
      )
        record([...path, "$order"], "reordered", old, next);
      else record(path, "changed", old, next);
      return;
    }
    if (isObject(old) && isObject(next)) {
      const keys = [
        ...new Set([...Object.keys(old), ...Object.keys(next)]),
      ].sort();
      for (const key of keys) walk(old[key], next[key], [...path, key]);
      return;
    }
    record(path, "changed", old, next);
  };
  walk(before.document, after.document, []);
  if (before.manifest && after.manifest)
    walk(
      normalizedManifest(before.manifest),
      normalizedManifest(after.manifest),
      ["manifest"],
    );
  const oldReview = reviewVideo(
      before.plan,
      before.diagnostics,
      before.document,
      options.profile,
    ),
    nextReview = reviewVideo(
      after.plan,
      after.diagnostics,
      after.document,
      options.profile,
    );
  const oldIds = new Set(oldReview.issues.map((i) => i.id)),
    nextIds = new Set(nextReview.issues.map((i) => i.id));
  const resolved = oldReview.issues.filter((i) => !nextIds.has(i.id)),
    added = nextReview.issues.filter((i) => !oldIds.has(i.id)),
    remaining = nextReview.issues.filter((i) => oldIds.has(i.id));
  const notChecked: StoryboardDocumentDiff["coverage"]["notChecked"] = [
    "renderedFrames",
    "motion",
    "audio",
    "pixelContrast",
  ];
  if (
    !before.manifest ||
    !after.manifest ||
    [...Object.values(before.manifest), ...Object.values(after.manifest)].some(
      (asset) => !asset.hash,
    )
  )
    notChecked.push("mediaContent");
  return {
    changes,
    changesTotal,
    changesTruncated: changesTotal > changes.length,
    resolvedIssues: resolved.slice(0, maxIssues).map(compactIssue),
    newIssues: added.slice(0, maxIssues).map(compactIssue),
    remainingIssues: remaining.slice(0, maxIssues).map(compactIssue),
    totals: {
      resolved: resolved.length,
      new: added.length,
      remaining: remaining.length,
    },
    coverage: {
      mode: "static-document-and-plan",
      before: compactCoverage(oldReview),
      after: compactCoverage(nextReview),
      notChecked,
    },
    contentChanged,
  };
}
