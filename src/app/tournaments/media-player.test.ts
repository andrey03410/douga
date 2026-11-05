import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import { MediaPlayer, mediaClock, playableDuration } from "./MediaPlayer";
it("shows themed accessible controls and real initial duration without browser audio chrome", () => {
  const html = renderToStaticMarkup(
    React.createElement(MediaPlayer, {
      src: "/track.mp3",
      title: "Golden Witch",
      durationSec: 125,
    }),
  );
  expect(html).toContain('aria-label="Воспроизвести Golden Witch"');
  expect(html).toContain('aria-label="Позиция воспроизведения"');
  expect(html).toContain("2:05");
  expect(html).not.toMatch(/<audio[^>]*\scontrols/);
});
it("formats long tracks and ignores non-finite browser metadata", () => {
  expect(mediaClock(3661)).toBe("1:01:01");
  expect(mediaClock(Number.NaN)).toBe("0:00");
  expect(playableDuration(Infinity, 125)).toBe(125);
  expect(playableDuration(124.7, 125)).toBe(124.7);
});

it("restores sound when the volume slider was dragged to zero", async () => {
  const { toggleMediaSound } = await import("./MediaPlayer");
  const media = { muted: false, volume: 0 };
  toggleMediaSound(media);
  expect(media).toEqual({ muted: false, volume: 1 });
  toggleMediaSound(media);
  expect(media.muted).toBe(true);
  toggleMediaSound(media);
  expect(media.muted).toBe(false);
});
