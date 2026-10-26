import type { Rect, Settings, VideoFormat } from "./types";
export const OUTPUT_DIMENSIONS: Record<
  VideoFormat,
  { width: number; height: number }
> = {
  wide: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};
/** No card-count caps. Grid searches row/column combinations for maximum card area. */
export function layoutCards(
  count: number,
  area: Rect,
  layout: Settings["layout"] = { type: "grid" },
  orientation: "landscape" | "portrait" = "landscape",
): Rect[] {
  if (count === 0) return [];
  const gap = Math.min(
    layout.gap ?? 20,
    Math.min(area.width, area.height) / (count + 1),
  );
  const padding = Math.min(
    layout.padding ?? 20,
    Math.min(area.width, area.height) / 5,
  );
  const a = {
    x: area.x + padding,
    y: area.y + padding,
    width: area.width - 2 * padding,
    height: area.height - 2 * padding,
  };
  if (layout.type === "free" && layout.positions?.length === count)
    return layout.positions.map((r) => ({
      x: area.x + r.x * area.width,
      y: area.y + r.y * area.height,
      width: r.width * area.width,
      height: r.height * area.height,
    }));
  const ratio = orientation === "portrait" ? 2 / 3 : 16 / 9;
  const arc = layout.type === "arc";
  // A curve needs at least three points. Small rosters share one arc; larger
  // rosters may wrap, but automatic rows must still be able to show curvature.
  const minimumColumns = arc ? (count <= 4 ? count : 3) : 1;
  const rowHeight = arc && count >= 3 ? 1.35 : 1;
  let best = { columns: 1, width: 1, height: 1, area: 0 };
  for (let columns = 1; columns <= count; columns++) {
    if (layout.columns && columns !== Math.min(count, layout.columns)) continue;
    if (!layout.columns && columns < minimumColumns) continue;
    const rows = Math.ceil(count / columns);
    const width = Math.max(
      1,
      Math.min(
        (a.width - gap * (columns - 1)) / columns,
        ((a.height - gap * (rows - 1)) / (rows * rowHeight)) * ratio,
      ),
    );
    const height = width / ratio;
    if (width * height > best.area)
      best = { columns, width, height, area: width * height };
  }
  const rows = Math.ceil(count / best.columns);
  const grid = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / best.columns);
    const columnsHere = Math.min(best.columns, count - row * best.columns);
    return {
      x:
        a.x +
        (a.width - columnsHere * best.width - (columnsHere - 1) * gap) / 2 +
        (i % best.columns) * (best.width + gap),
      y:
        a.y +
        (a.height - rows * best.height * rowHeight - (rows - 1) * gap) / 2 +
        row * (best.height * rowHeight + gap),
      width: best.width,
      height: best.height,
    };
  });
  if (!arc || count < 3) return grid;
  // Reserve the curve's full height during sizing, preserving card aspect ratio.
  const amplitude = best.height * (rowHeight - 1);
  return grid.map((r, i) => {
    const row = Math.floor(i / best.columns),
      rowCount = Math.min(best.columns, count - row * best.columns);
    const angle =
      rowCount < 3 ? 0 : ((i % best.columns) / (rowCount - 1) - 0.5) * Math.PI;
    return {
      ...r,
      y: r.y + amplitude * (1 - Math.cos(angle)),
    };
  });
}
export function resolveRect(
  rect: Rect | undefined,
  parent: Rect,
  units: "relative" | "px" = "relative",
  anchor: "topLeft" | "center" | "bottomRight" = "topLeft",
): Rect {
  if (!rect) return { ...parent };
  const r =
    units === "relative"
      ? {
          x: rect.x * parent.width,
          y: rect.y * parent.height,
          width: rect.width * parent.width,
          height: rect.height * parent.height,
        }
      : { ...rect };
  const factor = anchor === "center" ? 0.5 : anchor === "bottomRight" ? 1 : 0;
  return {
    ...r,
    x: parent.x + r.x - factor * r.width,
    y: parent.y + r.y - factor * r.height,
  };
}
