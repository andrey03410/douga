import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Actor } from "./actor";
import { actor as freshActor } from "@/server/studio/shared";
import { StudioError } from "@/server/studio/errors";
import {
  inspectStudioText,
  inspectStudioTextSchema,
} from "@/server/studio/typography";
import { typographyFonts, typographyFontAssets } from "@douga/video/font-manifest";
import { typographyStyles, typographyThemes } from "@douga/video/typography-catalog";

const key = z.string().min(1).max(200);
const pageSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    cursor: key.optional(),
  })
  .strict();
function page<T extends { id: string }>(
  items: readonly T[],
  limit: number,
  cursor?: string,
) {
  const index = cursor ? items.findIndex((e) => e.id === cursor) : -1;
  if (cursor && index < 0) throw new StudioError("NOT_FOUND");
  const selected = items.slice(index + 1, index + 1 + limit);
  return {
    version: 1,
    total: items.length,
    items: selected,
    nextCursor: index + 1 + limit < items.length ? selected.at(-1)!.id : null,
  };
}
const result = (value: object): CallToolResult => ({
  structuredContent: value as Record<string, unknown>,
  content: [
    {
      type: "text",
      text: JSON.stringify(value),
      annotations: { audience: ["assistant"] },
    },
  ],
});
export function registerTypographyTools(server: McpServer, actor: Actor) {
  const register = <S extends z.AnyZodObject>(
    name: string,
    description: string,
    schema: S,
    run: (input: z.infer<S>) => Promise<CallToolResult>,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
        annotations: { readOnlyHint: true },
      },
      async (args: Record<string, unknown>) => {
        try {
          await freshActor(actor.userId);
          return await run(schema.parse(args));
        } catch (e) {
          return {
            ...result({
              error: {
                code:
                  e instanceof z.ZodError
                    ? "SCHEMA_INVALID"
                    : e instanceof StudioError
                      ? e.code
                      : "OPERATION_FAILED",
                ...(e instanceof StudioError
                  ? { diagnostics: e.diagnostics }
                  : {}),
              },
            }),
            isError: true,
          };
        }
      },
    );
  };
  register(
    "video_font_list",
    "Built-in pinned font summaries. Filter by language ru/en/ja or real italic support; use get for faces and authoring example.",
    pageSchema
      .extend({
        language: z.enum(["ru", "en", "ja"]).optional(),
        italic: z.boolean().optional(),
      })
      .strict(),
    async (input) => {
      return result(
        page(
          typographyFonts.filter(
            (f) =>
              (!input.language || f.languages.includes(input.language)) &&
              (input.italic === undefined || f.italic === input.italic),
          ),
          input.limit,
          input.cursor,
        ),
      );
    },
  );
  register(
    "video_font_get",
    "Explicit built-in font metadata, pinned resources, supported weights/styles and a declarative text fragment. No font bytes.",
    z.object({ id: key }).strict(),
    async ({ id }) => {
      const font = typographyFonts.find((f) => f.id === id);
      if (!font) throw new StudioError("NOT_FOUND");
      return result({
        version: 1,
        font,
        faces: typographyFontAssets.filter((f) => f.font === font.id),
        fragment: { typography: { font: font.id, weight: 700 } },
        fallback: "noto-sans-jp",
      });
    },
  );
  register(
    "video_typography_list",
    "Built-in theme/style summaries. Themes coordinate eight semantic text roles; styles format one text. Use get for the full fragment.",
    pageSchema
      .extend({ category: z.enum(["theme", "style"]).optional() })
      .strict(),
    async (input) => {
      const entries = [
        ...typographyThemes.map(({ roles: _roles, ...e }) => ({
          ...e,
          id: `theme:${e.id}`,
          category: "theme",
        })),
        ...typographyStyles.map(({ style: _style, ...e }) => ({
          ...e,
          id: `style:${e.id}`,
          category: "style",
        })),
      ].filter((e) => !input.category || e.category === input.category);
      return result(page(entries, input.limit, input.cursor));
    },
  );
  register(
    "video_typography_get",
    "Explicit theme/style and ready fragment. Apply settings.typography through video_draft_patch, then validate and inspect. Catalog version is pinned to 1.",
    z.object({ id: key, category: z.enum(["theme", "style"]) }).strict(),
    async ({ id, category }) => {
      const canonical = id.replace(/^(theme|style):/, "");
      const entry =
        category === "theme"
          ? typographyThemes.find((t) => t.id === canonical)
          : typographyStyles.find((t) => t.id === canonical);
      if (!entry) throw new StudioError("NOT_FOUND");
      return result({
        version: 1,
        category,
        entry,
        fragment:
          category === "theme"
            ? { settings: { typography: { version: 1, theme: canonical } } }
            : { typography: { preset: canonical } },
        gallery: "/studio/typography",
      });
    },
  );
  register(
    "video_text_inspect",
    "Explicit measured text of an owned project/current draft, paginated and pinned to version. preview:true returns a bounded diagnostic PNG without committing. Only text overflow may bypass readiness for this diagnostic.",
    inspectStudioTextSchema.extend({ projectId: key }),
    async ({ projectId, ...input }) => {
      const inspected = await inspectStudioText(actor.userId, projectId, input);
      const { preview, ...summary } = inspected;
      const response = result({
        ...summary,
        ...(preview ? { preview: { ...preview, base64: undefined } } : {}),
      });
      if (preview)
        response.content.push({
          type: "image",
          mimeType: "image/png",
          data: preview.base64,
          annotations: { audience: ["assistant"] },
        });
      return response;
    },
  );
}
