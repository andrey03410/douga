import { describe, it, expect } from "vitest";
import { DOWNLOAD_TITLE_MAX, downloadTitleStem } from "./download-name";

describe("downloadTitleStem", () => {
  it("оставляет обычное название как есть, включая кириллицу и эмодзи", () => {
    expect(downloadTitleStem("Топ-10 OST 2024 🎵")).toBe("Топ-10 OST 2024 🎵");
  });

  it("вычищает запрещённые в имени файла символы и управляющие коды", () => {
    expect(downloadTitleStem('Re:Zero / Топ "лучших" <OST>?*|\\')).toBe("Re Zero Топ лучших OST");
    expect(downloadTitleStem("строка\nвторая\tтаб\u0000\u007f")).toBe("строка вторая таб");
  });

  it("схлопывает пробелы и срезает точки и пробелы по краям", () => {
    expect(downloadTitleStem("  ..Мой   топ..  ")).toBe("Мой топ");
  });

  it("обрезает длинное название по символам, не разрывая суррогатные пары", () => {
    const long = "я".repeat(DOWNLOAD_TITLE_MAX - 1) + "🎵🎵🎵";
    const stem = downloadTitleStem(long);
    expect(Array.from(stem)).toHaveLength(DOWNLOAD_TITLE_MAX);
    expect(stem.endsWith("🎵")).toBe(true);
    expect(stem).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("возвращает пустую строку, если от названия ничего не осталось", () => {
    expect(downloadTitleStem(null)).toBe("");
    expect(downloadTitleStem("   ")).toBe("");
    expect(downloadTitleStem('/\\:*?"<>| ...')).toBe("");
  });
});
