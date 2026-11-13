import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { parseVideoDocument } from "@douga/video";
import { NewStudioProject } from "./NewStudioProject";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {} }) }));

it("starts the tournament Create video form with a v2 source document and a common preset", () => {
  const html = renderToStaticMarkup(
    React.createElement(NewStudioProject, { sourceId: "owned-tournament" }),
  );
  const text = /<textarea[^>]*>([\s\S]*?)<\/textarea>/
    .exec(html)![1]
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const document = parseVideoDocument(JSON.parse(text));
  expect(document.schemaVersion).toBe(2);
  expect(document.source).toMatchObject({
    kind: "tournament",
    tournamentId: "owned-tournament",
    participants: [],
  });
  expect(document.scenes).toEqual([]);
  expect(document.segments).toEqual([]);
  expect(document.preset?.id).toBe("top.classic.wide");
});
