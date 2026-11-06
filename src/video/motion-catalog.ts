import {
  backdropNames,
  choreographyNames,
  motionNames,
  transitionNames,
} from "./motion-types";
import type { MotionChannel, MotionName } from "./motion-types";
export type MotionCatalogCategory =
  | "effect"
  | "choreography"
  | "transition"
  | "backdrop"
  | "widget";
export interface MotionCatalogEntry {
  name: string;
  category: MotionCatalogCategory;
  description: string;
  channels: MotionChannel[];
  blocks: ("custom" | "top" | "picker" | "board")[];
  nodes: string[];
  parameters: string[];
  example: Record<string, unknown>;
}
export function motionChannels(name: MotionName): MotionChannel[] {
  if (
    [
      "float",
      "breathe",
      "sway",
      "drift",
      "ken-burns",
      "shimmer",
      "orbit",
    ].includes(name)
  )
    return ["loop"];
  if (
    [
      "pulse",
      "bounce",
      "shake",
      "nudge",
      "glow",
      "outline",
      "stamp",
      "spotlight",
      "flash",
      "strike",
      "wiggle",
    ].includes(name)
  )
    return ["emphasis"];
  return ["enter", "exit"];
}
const descriptions: Record<MotionName, string> = {
  fade: "Плавное появление прозрачностью",
  pop: "Быстрое появление с увеличением",
  "slide-up": "Вход снизу вверх",
  "slide-down": "Вход сверху вниз",
  "slide-left": "Вход справа налево",
  "slide-right": "Вход слева направо",
  "zoom-in": "Приближение из уменьшенного размера",
  "zoom-out": "Уменьшение из крупного плана",
  "flip-x": "Переворот вокруг горизонтальной оси",
  "flip-y": "Переворот вокруг вертикальной оси",
  tilt: "Наклон с раскрытием",
  "blur-reveal": "Раскрытие из размытия",
  "wipe-reveal": "Направленная маска раскрытия",
  iris: "Круговая маска раскрытия",
  elastic: "Пружинное появление",
  spin: "Появление с вращением",
  float: "Плавное вертикальное парение",
  breathe: "Медленная пульсация размера",
  sway: "Плавное покачивание",
  drift: "Горизонтальный дрейф",
  "ken-burns": "Медленное приближение и панорама",
  shimmer: "Бегущий световой блик",
  orbit: "Движение по орбите",
  pulse: "Короткая пульсация",
  bounce: "Короткий подскок",
  shake: "Горизонтальная тряска",
  nudge: "Короткий направленный толчок",
  glow: "Вспышка мягкого свечения",
  outline: "Акцент обводкой",
  stamp: "Ударное увеличение",
  spotlight: "Выделение световым пятном",
  flash: "Короткая цветовая вспышка",
  strike: "Резкая диагональная черта",
  wiggle: "Короткое вращательное покачивание",
  "text-words": "Последовательное раскрытие слов",
  "text-lines": "Последовательное раскрытие строк",
  "text-letters": "Последовательное раскрытие букв",
  "text-wipe": "Маска раскрытия текста",
  "text-counter": "Изменение числового значения",
  "text-slam": "Ударное появление текста",
};
const effects: MotionCatalogEntry[] = motionNames.map((name) => ({
  name,
  category: "effect",
  blocks: ["custom", "top", "picker", "board"],
  description: descriptions[name],
  channels: motionChannels(name),
  nodes: name.startsWith("text-")
    ? ["text", "badge"]
    : [
        "container",
        "text",
        "shape",
        "image",
        "video",
        "card",
        "timer",
        "group",
        "versus",
        "badge",
        "progress",
      ],
  parameters: ["duration", "delay", "intensity", "direction", "at"],
  example: { motion: { [motionChannels(name)[0]]: name } },
}));
const choreographies = choreographyNames.map((name) => ({
  name,
  category: "choreography" as const,
  blocks: (name === "board-place" || name === "board-swap"
    ? ["board"]
    : name === "rank-reveal"
      ? ["top"]
      : ["versus-impact", "picker-cascade", "winner-spotlight"].includes(name)
        ? ["picker"]
        : name === "round-intro"
          ? ["picker", "board"]
          : [
              "custom",
              "top",
              "picker",
              "board",
            ]) as MotionCatalogEntry["blocks"],
  description: {
    "versus-impact": "Встречные карточки и ударный VS",
    "picker-cascade": "Каскад входов, таймер и акцент ответа",
    "winner-spotlight": "Световой акцент раскрытого победителя",
    "rank-reveal": "Раскрытие места, арта и подписи",
    "podium-finale": "Каскад призовых мест",
    "board-place": "Акцент размещения карточки",
    "board-swap": "Акцент обмена карточек",
    "title-reveal": "Появление заголовка по словам",
    "cinematic-pan": "Медленная панорама медиа",
    "round-intro": "Вступление и номер раунда",
  }[name],
  channels: [],
  nodes: [],
  parameters: [
    "profile",
    "intensity",
    "enter",
    "exit",
    "loop",
    "emphasis",
    "stagger",
  ],
  example: { settings: { motion: { choreography: name } } },
}));
export const motionCatalog = {
  version: 1 as const,
  entries: [
    ...effects,
    ...choreographies,
    ...transitionNames
      .filter((n) => !["none", "fade", "slide"].includes(n))
      .map((name) => ({
        name,
        category: "transition" as const,
        blocks: [
          "custom",
          "top",
          "picker",
          "board",
        ] as MotionCatalogEntry["blocks"],
        description: `Переход ${name} с удержанием предыдущего кадра`,
        channels: [],
        nodes: [],
        parameters: ["duration", "direction", "color"],
        example: { transition: { type: name, duration: { sec: 0.4 } } },
      })),
    ...backdropNames.map((name) => ({
      name,
      category: "backdrop" as const,
      blocks: [
        "custom",
        "top",
        "picker",
        "board",
      ] as MotionCatalogEntry["blocks"],
      description: `Детерминированный фон ${name}`,
      channels: [],
      nodes: [],
      parameters: [
        "source",
        "asset",
        "colors",
        "blur",
        "dim",
        "motion",
        "intensity",
        "particles",
      ],
      example: { settings: { backdrop: { preset: name } } },
    })),
    ...["timer", "versus", "badge", "progress"].map((name) => ({
      name,
      category: "widget" as const,
      blocks: [
        "custom",
        "top",
        "picker",
        "board",
      ] as MotionCatalogEntry["blocks"],
      description: `Виджет ${name}`,
      channels: [],
      nodes: [name],
      parameters:
        name === "timer"
          ? [
              "variant",
              "color",
              "trackColor",
              "strokeWidth",
              "showValue",
              "warningSec",
            ]
          : name === "versus"
            ? ["variant", "color"]
            : name === "badge"
              ? ["kind", "text", "color"]
              : ["scope", "color", "trackColor", "strokeWidth"],
      example: {
        id: name,
        type: name,
        ...(name === "badge" ? { kind: "label", text: "Раунд" } : {}),
      },
    })),
  ] satisfies MotionCatalogEntry[],
};
export function getMotionCatalogEntry(
  name: string,
  category?: MotionCatalogCategory,
): MotionCatalogEntry | undefined {
  return motionCatalog.entries.find(
    (e) =>
      e.name === (name === "flip" ? "flip-y" : name) &&
      (!category || category === e.category),
  );
}
