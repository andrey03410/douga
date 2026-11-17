import { createVideoDocument } from "./builders";
import type { VideoDocument } from "./types";

/** 260,000 explicit keyframes contain over one million authored JSON values. */
export function largeKeyframeDocument(): VideoDocument {
  const document = createVideoDocument({ kind: "top", participants: [] });
  document.scenes = [{
    id: "large-keyframes", block: "custom", duration: { frame: 2600 },
    nodes: Array.from({ length: 100 }, (_, node) => ({
      id: `text-${node}`, type: "text", text: "Большой документ",
      animation: [{ property: "opacity", keyframes: Array.from({ length: 2600 }, (_, frame) => ({
        at: { frame }, value: frame % 2,
      })) }],
    })),
  }];
  return document;
}

export function largePickerDocument(): VideoDocument {
  const document = createVideoDocument({ kind: "picker", roundCount: 300, cardsPerRound: 6 });
  document.settings.picker = { ...document.settings.picker, timerSec: 1, revealSec: 0.1, answerSec: 0.1 };
  document.bindings.ost = { kind: "builtin", name: "tick" };
  for (const round of document.source.rounds) {
    round.music = "ost";
    round.groups = Array.from({ length: 3 }, (_, group) => ({
      id: `${round.id}-group-${group}`, label: `Панель ${group + 1}`,
      cardIds: round.cards.slice(group * 2, group * 2 + 2).map((card) => card.id),
    }));
  }
  return document;
}
