import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StudioWorkspace } from "./StudioWorkspace";
it("initial SSR contains only neutral metadata with explicit code/media/preview reveal controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(StudioWorkspace, {
      initial: {
        id: "owned-project",
        kind: "top",
        version: 4,
        revision: 2,
        hasDraft: true,
        previewStale: true,
        previewRevision: 1,
        previewVersion: 1,
        sourceVersion: null,
        validation: { ready: false, errors: 1, warnings: 0 },
      },
      isAdmin: true,
    }),
  );
  expect(html).toContain("Открыть SDK");
  expect(html).toContain("Показать превью");
  expect(html).toContain("Открыть медиа");
  expect(html).not.toMatch(/<textarea|<video|<audio|<img|secret-answer/);
  expect(html).not.toContain('"bindings"');
});
