import type { Rect } from "./types";
import { graphemes } from "./typography-schema";
import type {
  CompiledTextLayout,
  CompiledTextLine,
  CompiledTextRun,
  MeasureText,
  ResolvedTextRun,
  ResolvedTypography,
  TextPadding,
} from "./typography-types";

interface Glyph {
  text: string;
  run: ResolvedTextRun;
  source: number;
}
const closing =
  /^[、。，．・：；？！‼⁇⁈⁉ー〜～…‥）〕］｝〉》」』】〙〗〟’”»ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞヽヾ]/u;
const opening = /[（〔［｛〈《「『【〘〖〝‘“«]$/u;
const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const whitespace = /^\s+$/u;
const round = (n: number) => Math.round(n * 10000) / 10000;
export function normalizeTextPadding(
  value: number | Partial<TextPadding> | undefined,
): TextPadding {
  return typeof value === "number"
    ? { top: value, right: value, bottom: value, left: value }
    : { top: 0, right: 0, bottom: 0, left: 0, ...value };
}
/** Reserve the union of glyph effects and the plate, before fitting. */
export function typographyTextRect(
  rect: Rect,
  style: ResolvedTypography,
): Rect {
  const stroke = Math.max(0, ...style.outlines.map((o) => o.width));
  let left = stroke,
    right = stroke,
    top = stroke,
    bottom = stroke;
  for (const s of style.shadows) {
    left = Math.max(left, stroke + (s.blur ?? 0) - (s.x ?? 0));
    right = Math.max(right, stroke + (s.blur ?? 0) + (s.x ?? 0));
    top = Math.max(top, stroke + (s.blur ?? 0) - (s.y ?? 0));
    bottom = Math.max(bottom, stroke + (s.blur ?? 0) + (s.y ?? 0));
  }
  const plate = style.plate?.padding ?? 0,
    p = style.padding;
  left += p.left + plate;
  right += p.right + plate;
  top += p.top + plate;
  bottom += p.bottom + plate;
  return {
    x: round(left),
    y: round(top),
    width: round(Math.max(0, rect.width - left - right)),
    height: round(Math.max(0, rect.height - top - bottom)),
  };
}
function runStyle(
  style: ResolvedTypography,
  run: ResolvedTextRun,
): ResolvedTypography {
  return {
    ...style,
    ...(run.weight !== undefined ? { weight: run.weight } : {}),
    ...(run.italic !== undefined ? { italic: run.italic } : {}),
    ...(run.color ? { fill: run.color } : {}),
    ...(run.decoration ? { decoration: run.decoration } : {}),
  };
}
const legalBreak = (glyphs: Glyph[], index: number) =>
  index === glyphs.length ||
  (!closing.test(glyphs[index]?.text ?? "") &&
    !opening.test(glyphs[index - 1]?.text ?? ""));
const wordBreak = (glyphs: Glyph[], index: number) =>
  whitespace.test(glyphs[index - 1]?.text ?? "") ||
  whitespace.test(glyphs[index]?.text ?? "") ||
  japanese.test(glyphs[index - 1]?.text ?? "") ||
  japanese.test(glyphs[index]?.text ?? "");
function trimLine(glyphs: Glyph[]): Glyph[] {
  let start = 0,
    end = glyphs.length;
  while (start < end && whitespace.test(glyphs[start].text)) start++;
  while (end > start && whitespace.test(glyphs[end - 1].text)) end--;
  return glyphs.slice(start, end);
}
/** Pure measured layout. No font/files/DOM access and no renderer-time wrapping. */
export function layoutTypographyText(
  runs: ResolvedTextRun[],
  style: ResolvedTypography,
  box: Rect,
  measureText: MeasureText,
  fixedSize?: number,
): CompiledTextLayout {
  const glyphs: Glyph[] = runs.flatMap((run, source) =>
    graphemes(run.text.replace(/\r\n?/g, "\n")).map((text) => ({
      text,
      run,
      source,
    })),
  );
  const rect = typographyTextRect(box, style),
    measurementCache = new Map<string, ReturnType<MeasureText>>();
  const seenMissing = new Set<string>();
  const measure = (text: string, run: ResolvedTextRun, size: number) => {
    const resolved = runStyle({ ...style, fontSize: size }, run),
      key = JSON.stringify([
        text,
        resolved.font,
        resolved.weight,
        resolved.italic,
        size,
        resolved.letterSpacing,
      ]);
    let result = measurementCache.get(key);
    if (!result) {
      result = measureText(text, resolved);
      if (
        !Number.isFinite(result.width) ||
        result.width < 0 ||
        !Array.isArray(result.fonts) ||
        !Array.isArray(result.missing)
      )
        throw new Error("Text measurement returned invalid metrics");
      measurementCache.set(key, result);
    }
    result.missing.forEach((c) => seenMissing.add(c));
    return result;
  };
  const line = (items: Glyph[], size: number): CompiledTextLine => {
    const grouped: { text: string; run: ResolvedTextRun; source: number }[] =
      [];
    for (const g of items) {
      const previous = grouped.at(-1);
      if (previous?.source === g.source) previous.text += g.text;
      else grouped.push({ text: g.text, run: g.run, source: g.source });
    }
    let width = 0;
    const result: CompiledTextRun[] = grouped.map(({ text, run }, i) => {
      if (i) width += style.letterSpacing;
      const m = measure(text, run, size),
        x = width;
      width += m.width;
      return {
        ...run,
        text,
        width: round(m.width),
        x: round(x),
        fonts: [...new Set(m.fonts)],
      };
    });
    return {
      text: items.map((g) => g.text).join(""),
      width: round(Math.max(0, width)),
      x: 0,
      y: 0,
      runs: result,
    };
  };
  const wrap = (size: number, width = rect.width): CompiledTextLine[] => {
    const paragraphs: Glyph[][] = [[]];
    for (const glyph of glyphs) {
      if (glyph.text === "\n") paragraphs.push([]);
      else paragraphs.at(-1)!.push(glyph);
    }
    const lines: CompiledTextLine[] = [];
    for (const paragraph of paragraphs) {
      if (style.wrap === "none" || !paragraph.length) {
        lines.push(line(paragraph, size));
        continue;
      }
      let offset = 0;
      while (offset < paragraph.length) {
        let end = offset + 1;
        // Exponential probing plus binary search bounds expensive shaping on long strings.
        let high = end;
        while (
          high < paragraph.length &&
          line(paragraph.slice(offset, high), size).width <= width
        ) {
          end = high;
          high = Math.min(paragraph.length, offset + (high - offset) * 2);
        }
        if (line(paragraph.slice(offset, high), size).width <= width)
          end = high;
        else {
          let low = end;
          while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (line(paragraph.slice(offset, middle), size).width <= width)
              low = middle;
            else high = middle;
          }
          end = Math.max(offset + 1, low);
        }
        if (end < paragraph.length) {
          let legal = end;
          while (legal > offset + 1 && !legalBreak(paragraph, legal)) legal--;
          if (!legalBreak(paragraph, legal)) {
            // An indivisible kinsoku pair can overflow; shrink reports it honestly.
            legal = end;
            while (legal < paragraph.length && !legalBreak(paragraph, legal))
              legal++;
          }
          if (style.wrap === "word") {
            let word = legal;
            while (word > offset + 1 && !wordBreak(paragraph, word)) word--;
            if (word > offset + 1 && legalBreak(paragraph, word)) legal = word;
          }
          end = legal;
        }
        lines.push(line(trimLine(paragraph.slice(offset, end)), size));
        offset = end;
        while (
          offset < paragraph.length &&
          whitespace.test(paragraph[offset].text)
        )
          offset++;
      }
    }
    return lines;
  };
  const fits = (lines: CompiledTextLine[], size: number) =>
    rect.width > 0 &&
    rect.height > 0 &&
    lines.length <= style.maxLines &&
    lines.length * size * style.lineHeight <= rect.height + 0.001 &&
    lines.every((l) => l.width <= rect.width + 0.001);
  let size = fixedSize ?? style.fontSize,
    lines = wrap(size);
  if (fixedSize === undefined && style.fit === "shrink" && !fits(lines, size)) {
    let low = style.minFontSize,
      high = style.fontSize;
    const minimum = wrap(low);
    if (!fits(minimum, low)) {
      size = low;
      lines = minimum;
    } else {
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (fits(wrap(mid), mid)) low = mid;
        else high = mid;
      }
      size = Math.floor(low * 100) / 100;
      lines = wrap(size);
    }
  }
  // Find the narrowest column retaining the same line count; this distributes words
  // more evenly without changing hard newlines or the fitted font size.
  if (
    style.balance &&
    style.wrap !== "none" &&
    lines.length > 1 &&
    lines.length <= style.maxLines
  ) {
    let low = Math.max(...lines.map((l) => l.width)) / 2,
      high = rect.width;
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2,
        candidate = wrap(size, mid);
      if (
        candidate.length <= lines.length &&
        candidate.every((l) => l.width <= mid + 0.001)
      )
        high = mid;
      else low = mid;
    }
    const balanced = wrap(size, high);
    if (balanced.length === lines.length) lines = balanced;
  }
  const overflow = !fits(lines, size);
  let truncated = false;
  const capacity = Math.max(
    0,
    Math.min(
      style.maxLines,
      Math.floor((rect.height + 0.001) / (size * style.lineHeight)),
    ),
  );
  if (overflow && style.overflow !== "error") {
    if (lines.length > capacity) {
      lines = lines.slice(0, capacity);
      truncated = true;
    }
    if (style.overflow === "ellipsis") {
      lines = lines.map((current, index) => {
        if (
          current.width <= rect.width &&
          !(truncated && index === lines.length - 1)
        )
          return current;
        const original: Glyph[] = current.runs.flatMap((r, source) =>
          graphemes(r.text).map((text) => ({ text, run: r, source })),
        );
        const last = original.at(-1) ?? {
          text: "",
          run: runs[0] ?? { text: "" },
          source: 0,
        };
        const ellipsis = { ...last, text: "…" };
        while (
          original.length &&
          line([...original, ellipsis], size).width > rect.width
        )
          original.pop();
        while (original.length && opening.test(original.at(-1)!.text))
          original.pop();
        truncated = true;
        return line(
          line([ellipsis], size).width <= rect.width
            ? [...original, ellipsis]
            : [],
          size,
        );
      });
    }
  }
  const height = lines.length * size * style.lineHeight;
  const y =
    style.verticalAlign === "middle"
      ? (rect.height - height) / 2
      : style.verticalAlign === "bottom"
        ? rect.height - height
        : 0;
  lines = lines.map((l, i) => ({
    ...l,
    x: round(
      style.align === "center"
        ? (rect.width - l.width) / 2
        : style.align === "right"
          ? rect.width - l.width
          : 0,
    ),
    y: round(y + i * size * style.lineHeight),
  }));
  return {
    fontSize: size,
    lineHeight: round(size * style.lineHeight),
    rect,
    lines,
    overflow,
    truncated,
    fonts: [
      ...new Set(lines.flatMap((l) => l.runs.flatMap((r) => r.fonts))),
    ].sort(),
    missing: [...seenMissing],
  };
}
