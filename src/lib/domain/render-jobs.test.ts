import { describe, it, expect } from "vitest";
import {
  DOWNLOAD_TITLE_MAX,
  downloadTitleStem,
  isActiveRenderJob,
  renderDownloadDisposition,
  renderJobDto,
} from "./render-jobs";

describe("isActiveRenderJob", () => {
  it("считает активными queued и running", () => {
    expect(isActiveRenderJob("queued")).toBe(true);
    expect(isActiveRenderJob("running")).toBe(true);
  });

  it("считает завершёнными done и failed", () => {
    expect(isActiveRenderJob("done")).toBe(false);
    expect(isActiveRenderJob("failed")).toBe(false);
  });
});

describe("renderJobDto", () => {
  const base = { id: "job1", status: "running", progress: 0.5, error: null, outputPath: null };

  it("маппит поля и не даёт ссылку без готового файла", () => {
    expect(renderJobDto(base)).toEqual({
      id: "job1",
      status: "running",
      progress: 0.5,
      error: null,
      downloadUrl: null,
    });
  });

  it("даёт ссылку на скачивание при наличии outputPath", () => {
    const dto = renderJobDto({ ...base, status: "done", progress: 1, outputPath: "renders/job1.mp4" });
    expect(dto.downloadUrl).toBe("/api/render-jobs/job1/download");
  });

  it("пробрасывает ошибку упавшего задания", () => {
    const dto = renderJobDto({ ...base, status: "failed", error: "boom" });
    expect(dto.status).toBe("failed");
    expect(dto.error).toBe("boom");
    expect(dto.downloadUrl).toBeNull();
  });
});

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

describe("renderDownloadDisposition", () => {
  it("даёт ASCII-фолбэк и UTF-8 название по RFC 6266/5987", () => {
    expect(renderDownloadDisposition("cm123", "Топ: аниме (2024)")).toBe(
      "attachment; filename=\"douga-cm123.mp4\"; " +
        "filename*=UTF-8''%D0%A2%D0%BE%D0%BF%20%D0%B0%D0%BD%D0%B8%D0%BC%D0%B5%20%282024%29.mp4",
    );
  });

  it("кодирует символы вне attr-char из RFC 5987", () => {
    const header = renderDownloadDisposition("id1", "It's 100% #1 & co");
    expect(header).toContain("filename*=UTF-8''It%27s%20100%25%20%231%20%26%20co.mp4");
  });

  it("без пригодного названия отдаёт только ASCII-имя", () => {
    expect(renderDownloadDisposition("cm123", "  ???  ")).toBe(
      'attachment; filename="douga-cm123.mp4"',
    );
    expect(renderDownloadDisposition("cm123", null)).toBe('attachment; filename="douga-cm123.mp4"');
  });

  it("заголовок целиком в ASCII (иначе Headers его не примет)", () => {
    const header = renderDownloadDisposition("cm123", "Выбери вайфу 💖");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });
});
