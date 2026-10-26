import type { Settings, VideoDocument, VideoNode } from "./types";
/** Includes unused declared bindings: drafts/history must protect those assets too. */
export function collectVideoAssetKeys(document: VideoDocument): string[] {
  const keys = new Set(Object.keys(document.bindings));
  const add = (key: string | null | undefined) => {
    if (key) keys.add(key);
  };
  const settings = (value: Settings | undefined) => add(value?.picker?.tick);
  const nodes = (items: VideoNode[]) =>
    items.forEach((node) => {
      if (node.type === "container") nodes(node.children);
      if (
        node.type === "image" ||
        node.type === "video" ||
        node.type === "audio"
      )
        add(node.asset);
    });
  settings(document.settings);
  Object.values(document.formatSettings ?? {}).forEach(settings);
  document.source.participants.forEach((p) => {
    add(p.media?.visual);
    add(p.media?.audio);
    settings(p.settings);
  });
  document.source.rounds.forEach((r) => {
    add(r.background);
    add(r.music);
    settings(r.settings);
    r.cards.forEach((c) => settings(c.settings));
    r.groups?.forEach((g) => settings(g.settings));
  });
  document.scenes.forEach((s) => {
    add(s.background);
    settings(s.settings);
    nodes(s.nodes);
  });
  document.audio?.playlist?.tracks.forEach(add);
  document.audio?.cues?.forEach((c) => add(c.asset));
  return [...keys].sort();
}
