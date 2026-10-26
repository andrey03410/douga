import type {
  PatchOperation,
  PatchTarget,
  VideoDocument,
  VideoNode,
} from "./types";
import { parseVideoDocument } from "./schema";
function targetObject(document: VideoDocument, target: PatchTarget): object {
  if (target.type === "document") return document;
  const nodes: VideoNode[] = [];
  const collect = (items: VideoNode[]) =>
    items.forEach((n) => {
      nodes.push(n);
      if (n.type === "container") collect(n.children);
    });
  document.scenes.forEach((s) => collect(s.nodes));
  const lists = {
    participant: document.source.participants,
    round: document.source.rounds,
    card: document.source.rounds.flatMap((r) => r.cards),
    group: document.source.rounds.flatMap((r) => r.groups ?? []),
    scene: document.scenes,
    node: nodes,
  };
  const found = lists[target.type].find((v) => v.id === target.id);
  if (!found) throw new Error(`${target.type} ${target.id} does not exist`);
  return found;
}
/** Semantic stable-ID edits; no array indexes and no replacement of identity-bearing collections. */
export function patchVideoDocument(
  document: VideoDocument,
  operations: PatchOperation[],
): VideoDocument {
  const result = parseVideoDocument(document);
  operationsLoop: for (const operation of operations) {
    if (operation.op !== "set" && operation.op !== "unset")
      throw new Error("Unknown patch operation");
    if (!operation.path.length) throw new Error("A field path is required");
    for (const key of operation.path)
      if (
        [
          "__proto__",
          "prototype",
          "constructor",
          "id",
          "schemaVersion",
        ].includes(key) ||
        /^\d+$/.test(key)
      )
        throw new Error(`Protected path segment: ${key}`);
    if (
      operation.target.type === "document" &&
      ["source", "scenes"].includes(operation.path[0])
    )
      throw new Error("Use stable-ID targets for source and scene edits");
    if (["cards", "groups", "children", "nodes"].includes(operation.path[0]))
      throw new Error(
        "Replace structural collections through validated document replacement",
      );
    let value = targetObject(result, operation.target) as Record<
      string,
      unknown
    >;
    for (const key of operation.path.slice(0, -1)) {
      if (value[key] === undefined && operation.op === "unset")
        continue operationsLoop;
      if (value[key] === undefined) value[key] = {};
      if (
        typeof value[key] !== "object" ||
        value[key] === null ||
        Array.isArray(value[key])
      )
        throw new Error("Patch path must address object fields");
      value = value[key] as Record<string, unknown>;
    }
    const last = operation.path.at(-1)!;
    if (operation.op === "unset") delete value[last];
    else value[last] = structuredClone(operation.value);
  }
  return parseVideoDocument(result);
}
