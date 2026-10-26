import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { owned, replay, receipt, requestHash, hash, canonical } from "./shared";
import {
  fileHash,
  safeFile,
  cleanupDirectory,
  evaluate,
  setReferences,
  runtime,
} from "./assets";
import {
  getStudioProject,
  addRevision,
  directoryFor,
  assertProjectSourcesUnchanged,
} from "./projects";
import { parseVideoDocument, type VideoDocument } from "@/video";
import { reconcileSource } from "./sources";
import { StudioError } from "./errors";
import {
  freezeStudioProjectSchema,
  type FreezeStudioProjectInput,
  type StudioFrozenRevision,
  type StudioRevisionView,
  deleteStudioResourceSchema,
  type DeleteStudioResourceInput,
} from "./types";
export async function listStudioRevisions(
  userId: string,
  id: string,
): Promise<StudioRevisionView[]> {
  await owned(userId, id);
  const rows = await prisma.studioRevision.findMany({
    where: { projectId: id },
    orderBy: { revision: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    reason: r.reason,
    document: JSON.parse(r.documentJson),
    sourceVersion: r.sourceVersion,
    validation: JSON.parse(r.validationJson),
    createdAt: r.createdAt.toISOString(),
  }));
}
/** Freeze exact requested history, or commit the current valid draft before freezing. Never falls back to last-good. */
export async function freezeStudioProject(
  userId: string,
  id: string,
  raw: FreezeStudioProjectInput = {},
): Promise<StudioFrozenRevision> {
  const input = freezeStudioProjectSchema.parse(raw);
  await owned(userId, id);
  const request = requestHash(`freeze:${id}`, input);
  const old = await replay<StudioFrozenRevision>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  const project = await getStudioProject(userId, id);
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== project.version
  )
    throw new StudioError("VERSION_CONFLICT");
  if (input.revision === undefined && !project.validation.ready)
    throw new StudioError("VALIDATION_FAILED", project.validation.diagnostics);
  const directory =
    input.revision === undefined && project.draft
      ? directoryFor(userId, id)
      : undefined;
  let persisted = false;
  try {
    const draft = directory
      ? await reconcileSource(
          userId,
          parseVideoDocument(project.draft!.document),
        )
      : undefined;
    const prepared = draft
      ? await evaluate(userId, draft, directory)
      : undefined;
    if (prepared && !prepared.validation.ready)
      throw new StudioError(
        "VALIDATION_FAILED",
        prepared.validation.diagnostics,
      );
    const revision = prepared
      ? undefined
      : await prisma.studioRevision.findUnique({
          where: {
            projectId_revision: {
              projectId: id,
              revision: input.revision ?? project.revision,
            },
          },
        });
    if (!prepared && !revision) throw new StudioError("NOT_FOUND");
    const validation =
      prepared?.validation ?? JSON.parse(revision!.validationJson);
    if (
      !validation.ready ||
      (!prepared && (!revision!.assetsJson || !revision!.planJson))
    )
      throw new StudioError("VALIDATION_FAILED", validation.diagnostics);
    const assets: Pick<
      StudioFrozenRevision,
      "resolvedDocument" | "manifest" | "files" | "runtime"
    > = prepared
      ? {
          resolvedDocument: prepared.resolvedDocument!,
          manifest: prepared.manifest,
          files: prepared.files,
          runtime,
        }
      : JSON.parse(revision!.assetsJson!);
    for (const file of Object.values(assets.files)) {
      if ((await fileHash(await safeFile(file.path))) !== file.hash)
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
      if (
        file.posterPath &&
        (await fileHash(await safeFile(file.posterPath))) !== file.posterHash
      )
        throw new StudioError("SNAPSHOT_HASH_MISMATCH");
    }
    const frozen = await prisma.$transaction(async (db) => {
      const row = await owned(userId, id, db);
      const old = await replay<StudioFrozenRevision>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (old) return old;
      if (input.revision === undefined) {
        if (row.version !== project.version)
          throw new StudioError("VERSION_CONFLICT");
        await assertProjectSourcesUnchanged(userId, project, db);
      }
      let saved = revision;
      if (prepared && draft) {
        const currentSource = await reconcileSource(userId, draft, db);
        if (currentSource.source.version !== draft.source.version)
          throw new StudioError("VERSION_CONFLICT");
        const next = project.revision + 1,
          version = project.version + 1;
        const update = await db.studioProject.updateMany({
          where: { id, version: project.version },
          data: {
            version,
            revision: next,
            documentJson: JSON.stringify(draft),
            title: draft.title,
            kind: draft.kind,
            sourceVersion: draft.source.version ?? null,
            draftText: null,
            draftValidationJson: null,
            lastGoodRevision: next,
            previewJson: JSON.stringify(prepared.plan),
            previewVersion: version,
            previewRevision: next,
          },
        });
        if (!update.count) throw new StudioError("VERSION_CONFLICT");
        saved = await addRevision(
          db,
          userId,
          id,
          next,
          draft,
          prepared,
          "freeze",
        );
        await setReferences(db, userId, id, "head", draft);
        await db.studioAssetReference.deleteMany({
          where: { projectId: id, scope: "draft" },
        });
      }
      const content = {
        projectId: id,
        revisionId: saved!.id,
        revision: saved!.revision,
        sourceVersion: saved!.sourceVersion,
        document: JSON.parse(saved!.documentJson) as VideoDocument,
        ...assets,
        plan: JSON.parse(saved!.planJson!),
        validation,
      };
      const frozen: StudioFrozenRevision = {
        ...content,
        snapshotId: randomUUID(),
        hash: hash(canonical(content)),
      };
      await db.studioSnapshot.create({
        data: {
          id: frozen.snapshotId,
          projectId: id,
          revisionId: saved!.id,
          payloadJson: JSON.stringify(frozen),
          bytes: Object.values(frozen.files).reduce(
            (n, f) => n + f.bytes + (f.posterBytes ?? 0),
            0,
          ),
        },
      });
      await receipt(db, userId, input.idempotencyKey, request, frozen);
      persisted = true;
      return frozen;
    });
    if (directory && !persisted) await cleanupDirectory(directory);
    return frozen;
  } catch (error) {
    if (directory) await cleanupDirectory(directory);
    // A concurrent identical freeze may already have completed the atomic receipt.
    const old = await replay<StudioFrozenRevision>(
      prisma,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    throw error;
  }
}
export async function deleteStudioRevision(
  userId: string,
  id: string,
  revision: number,
  raw: DeleteStudioResourceInput = {},
) {
  const input = deleteStudioResourceSchema.parse(raw);
  const row = await owned(userId, id);
  if (!Number.isInteger(revision) || revision < 1)
    throw new StudioError("INVALID_REVISION");
  const request = requestHash(`delete-revision:${id}:${revision}`, input);
  const replayed = await replay<{ deleted: true; revision: number }>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (replayed) return replayed;
  const old = await prisma.studioRevision.findUnique({
    where: { projectId_revision: { projectId: id, revision } },
  });
  if (!old) throw new StudioError("NOT_FOUND");
  const result = await prisma.$transaction(async (db) => {
    const current = await owned(userId, id, db);
    const replayed = await replay<{ deleted: true; revision: number }>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (replayed) return replayed;
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version
    )
      throw new StudioError("VERSION_CONFLICT");
    if (
      current.revision === revision ||
      current.lastGoodRevision === revision ||
      current.previewRevision === revision ||
      (await db.studioSnapshot.count({ where: { revisionId: old.id } }))
    )
      throw new StudioError("REVISION_IN_USE");
    await db.studioAssetReference.deleteMany({
      where: { projectId: id, scope: `revision:${revision}` },
    });
    await db.studioRevision.delete({ where: { id: old.id } });
    const result = { deleted: true as const, revision };
    await receipt(db, userId, input.idempotencyKey, request, result);
    return result;
  });
  if (old.assetsJson) {
    const assets = JSON.parse(old.assetsJson) as Pick<
      StudioFrozenRevision,
      "files"
    >;
    for (const dir of new Set(
      Object.values(assets.files).map((f) => path.dirname(f.path)),
    ))
      if (dir.startsWith(`studio/${row.userId}/${id}/versions/`))
        await cleanupDirectory(dir);
  }
  return result;
}
/** Job FK protects the frozen revision until its result is explicitly released. */
export async function deleteStudioSnapshot(userId: string, snapshotId: string) {
  const snapshot = await prisma.studioSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new StudioError("NOT_FOUND");
  await owned(userId, snapshot.projectId);
  await prisma.$transaction(async (db) => {
    if (await db.studioJob.count({ where: { snapshotId } }))
      throw new StudioError("JOB_IN_USE");
    await db.studioSnapshot.delete({ where: { id: snapshotId } });
  });
}
