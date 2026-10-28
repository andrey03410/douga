import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { userOr401 } from "@/lib/api";
import { prisma } from "@/lib/db";
import { listArts } from "@/server/arts";
import { artDto } from "@/lib/art-dto";
import * as studio from "./index";
import { actor, owned } from "./shared";
import { safeFile, builtin } from "./assets";
import { ownedStudioMedia, streamStudioFile } from "./http-media";
import { isStudioMutationOriginAllowed } from "./http-origin";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export function studioHttpError(error: unknown): Response {
  if (error instanceof ZodError)
    return json({ error: "INVALID_INPUT", issues: error.issues }, 400);
  if (error instanceof SyntaxError)
    return json({ error: "MALFORMED_JSON" }, 400);
  if (error instanceof studio.StudioError) {
    const code = error.code;
    const status =
      code === "FORBIDDEN"
        ? 403
        : /NOT_FOUND$/.test(code)
          ? 404
          : /CONFLICT|IN_USE|JOB_ACTIVE|RESULT_NOT_READY/.test(code)
            ? 409
            : /QUOTA|LIMIT/.test(code)
              ? 429
              : /VALIDATION|ASSET_RESOLUTION/.test(code)
                ? 422
                : 400;
    return json({ error: code, diagnostics: error.diagnostics }, status);
  }
  console.error("Studio HTTP failed", error);
  return json({ error: "INTERNAL_ERROR" }, 500);
}
const page = (url: URL) => ({
  ...(url.searchParams.has("limit")
    ? { limit: Number(url.searchParams.get("limit")) }
    : {}),
  ...(url.searchParams.has("cursor")
    ? { cursor: url.searchParams.get("cursor")! }
    : {}),
});
/** Trusted session is the only actor; external MCP and HTTP use the same services. */
export async function studioHttp(
  req: Request,
  _path: string[] = [],
): Promise<Response> {
  const auth = await userOr401();
  if ("response" in auth) return auth.response;
  const uid = auth.userId,
    url = new URL(req.url),
    parts = url.pathname
      .replace(/^\/api\/studio\/?/, "")
      .split("/")
      .filter(Boolean);
  const [collection, id, action, detail] = parts;
  const read = req.method === "GET" || req.method === "HEAD";
  try {
    if (!read && !isStudioMutationOriginAllowed(req))
      return json({ error: "FORBIDDEN_ORIGIN" }, 403);
    await actor(uid);
    if (collection === "media" && read)
      return streamStudioFile(
        req,
        await ownedStudioMedia(uid, url.searchParams.get("path") ?? ""),
      );
    if (
      collection === "builtin" &&
      read &&
      ["tick", "reveal", "answer"].includes(id)
    )
      return streamStudioFile(req, {
        path: await safeFile(await builtin(id)),
        mimeType: "audio/wav",
      });
    if (collection === "projects") {
      if (!id) {
        if (read)
          return json(await studio.listStudioProjectSummaries(uid, page(url)));
        if (req.method === "POST") {
          const body = await req.json();
          return json(
            body && typeof body === "object" && "presetId" in body
              ? await studio.createStudioProjectFromPreset(
                  uid,
                  studio.createStudioProjectFromPresetSchema.parse(body),
                )
              : await studio.createStudioProject(
                  uid,
                  studio.createStudioProjectSchema.parse(body),
                ),
            201,
          );
        }
      } else if (!action) {
        if (read) {
          const p = await studio.getStudioProject(uid, id);
          const meta = studio.studioProjectMetadata(p);
          const content = url.searchParams.get("content");
          return json(
            content === "code"
              ? p
              : content === "preview"
                ? { ...meta, plan: p.plan }
                : meta,
          );
        }
        if (req.method === "DELETE")
          return json(
            await studio.deleteStudioProject(
              uid,
              id,
              studio.deleteStudioResourceSchema.parse(await req.json()),
            ),
          );
      } else {
        if (read && action === "history") {
          if (!detail)
            return json(
              await studio.listStudioHistorySummaries(uid, id, page(url)),
            );
          await owned(uid, id);
          const r = await prisma.studioRevision.findUnique({
            where: {
              projectId_revision: { projectId: id, revision: Number(detail) },
            },
          });
          if (!r) throw new studio.StudioError("NOT_FOUND");
          return json({
            revision: r.revision,
            document: JSON.parse(r.documentJson),
            createdAt: r.createdAt,
          });
        }
        if (read && action === "snapshots") {
          await owned(uid, id);
          const { limit, cursor } = studio.studioPageSchema.parse(page(url));
          if (
            cursor &&
            !(await prisma.studioSnapshot.findFirst({
              where: { id: cursor, projectId: id },
              select: { id: true },
            }))
          )
            throw new studio.StudioError("NOT_FOUND");
          const rows = await prisma.studioSnapshot.findMany({
            where: { projectId: id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
              id: true,
              createdAt: true,
              revision: { select: { revision: true } },
              _count: { select: { jobs: true } },
            },
          });
          return json({
            items: rows.slice(0, limit).map((r) => ({
              id: r.id,
              createdAt: r.createdAt,
              revision: r.revision.revision,
              jobs: r._count.jobs,
            })),
            nextCursor: rows.length > limit ? rows[limit - 1].id : null,
          });
        }
        if (read && action === "jobs") {
          await owned(uid, id);
          const limit = studio.studioPageSchema.parse(page(url)).limit;
          const cursor = url.searchParams.get("cursor");
          if (
            cursor &&
            !(await prisma.studioJob.findFirst({
              where: { id: cursor, userId: uid, projectId: id },
              select: { id: true },
            }))
          )
            throw new studio.StudioError("NOT_FOUND");
          const rows = await prisma.studioJob.findMany({
            where: { userId: uid, projectId: id },
            select: { id: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          return json({
            items: await Promise.all(
              rows.slice(0, limit).map((r) => studio.getStudioJob(uid, r.id)),
            ),
            nextCursor: rows.length > limit ? rows[limit - 1].id : null,
          });
        }
        if (action === "publication") {
          // An empty body means no options; a broken one is MALFORMED_JSON, as elsewhere.
          const text = read ? "" : await req.text();
          const raw = text.trim() ? JSON.parse(text) : {};
          if (read) {
            const row = await studio.getStudioPublication(uid, id);
            if (!row) throw new studio.StudioError("NOT_FOUND");
            return json(row);
          }
          if (req.method === "POST")
            return json(
              await studio.publishStudioProject(
                uid,
                id,
                studio.publishStudioProjectSchema.parse(raw),
              ),
            );
          if (req.method === "DELETE")
            return json(
              await studio.unpublishStudioProject(
                uid,
                id,
                studio.unpublishStudioProjectSchema.parse(raw),
              ),
            );
        }
        if (read && action === "export.html") {
          if (url.searchParams.get("estimate") === "1")
            return json(await studio.estimateStudioExport(uid, id));
          return studio.streamStudioExport(uid, id, { head: req.method === "HEAD" });
        }
        if (req.method === "PUT" && action === "draft")
          return json(
            await studio.saveStudioDraft(
              uid,
              id,
              studio.saveStudioDraftSchema.parse(await req.json()),
            ),
          );
        if (req.method === "POST") {
          const body = await req.json();
          if (action === "commit")
            return json(
              await studio.commitStudioDraft(
                uid,
                id,
                studio.commitStudioDraftSchema.parse(body),
              ),
            );
          if (action === "restore")
            return json(
              await studio.restoreStudioRevision(
                uid,
                id,
                studio.restoreStudioRevisionSchema.parse(body),
              ),
            );
          if (action === "preset")
            return json(
              await studio.applyStudioPreset(
                uid,
                id,
                studio.applyStudioPresetSchema.parse(body),
              ),
            );
          if (action === "jobs")
            return json(
              await studio.startStudioJob(
                uid,
                id,
                studio.startStudioJobSchema.parse(body),
              ),
              202,
            );
        }
        if (req.method === "DELETE" && action === "history" && detail)
          return json(
            await studio.deleteStudioRevision(
              uid,
              id,
              Number(detail),
              studio.deleteStudioResourceSchema.parse(await req.json()),
            ),
          );
      }
    }
    if (collection === "snapshots" && id && req.method === "DELETE") {
      await studio.deleteStudioSnapshot(uid, id);
      return json({ deleted: true, id });
    }
    if (collection === "jobs" && id) {
      if (read && action === "result")
        return streamStudioFile(
          req,
          await studio.getStudioJobArtifact(uid, id),
        );
      if (read && !action) return json(await studio.getStudioJob(uid, id));
      if (req.method === "POST" && action === "cancel")
        return json(await studio.cancelStudioJob(uid, id));
      if (req.method === "DELETE" && !action)
        return json(await studio.deleteStudioJob(uid, id));
    }
    if (collection === "presets") {
      if (read)
        return json(
          id
            ? await studio.getStudioPreset(uid, id)
            : await studio.listStudioPresetSummaries(uid, page(url)),
        );
      if (req.method === "POST" && !id)
        return json(
          await studio.saveStudioPreset(
            uid,
            studio.saveStudioPresetSchema.parse(await req.json()),
          ),
          201,
        );
      if (req.method === "DELETE" && id)
        return json(await studio.deleteStudioPreset(uid, id));
    }
    if (collection === "sources" && read)
      return json(
        id
          ? await studio.getStudioSource(uid, id, page(url))
          : await studio.listStudioSources(uid, page(url)),
      );
    if (collection === "assets" && read) {
      if (id)
        return json(
          await studio.inspectStudioAsset(uid, id, { content: false }),
        );
      const { arts, nextCursor } = await listArts(uid, {
        ...page(url),
        q: url.searchParams.get("q") ?? undefined,
      });
      return json({ items: arts.map(artDto), nextCursor });
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    return studioHttpError(error);
  }
}
