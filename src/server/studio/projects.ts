import "server-only";
import { randomUUID } from "node:crypto";
import type { StudioProject } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import {
  parseVideoDocument,
  videoDocumentSchema,
  patchVideoDocument,
  applyVideoPreset,
  PresetIncompatibleError,
  createVideoDocument,
  type VideoDocument,
} from "@/video";
import {
  actor,
  owned,
  replay,
  receipt,
  requestHash,
  jsonText,
  type Db,
} from "./shared";
import {
  evaluate,
  setReferences,
  references,
  cleanupDirectory,
  runtime,
} from "./assets";
import { reconcileSource } from "./sources";
import { StudioError } from "./errors";
import { getStudioPreset } from "./queries";
import {
  createStudioProjectSchema,
  saveStudioDraftSchema,
  commitStudioDraftSchema,
  restoreStudioRevisionSchema,
  type CreateStudioProjectInput,
  type SaveStudioDraftInput,
  type CommitStudioDraftInput,
  type RestoreStudioRevisionInput,
  type StudioProjectView,
  type StudioValidation,
  deleteStudioResourceSchema,
  type DeleteStudioResourceInput,
  patchStudioDraftSchema,
  applyStudioPresetSchema,
  type PatchStudioDraftInput,
  type ApplyStudioPresetInput,
  createStudioProjectFromPresetSchema,
  type CreateStudioProjectFromPresetInput,
} from "./types";

export const directoryFor = (userId: string, id: string) =>
  `studio/${userId}/${id}/versions/${randomUUID()}`;
export function parseDraft(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
export async function view(
  row: StudioProject,
  db: Db = prisma,
): Promise<StudioProjectView> {
  const revision = await db.studioRevision.findUniqueOrThrow({
    where: {
      projectId_revision: { projectId: row.id, revision: row.revision },
    },
  });
  const validation = JSON.parse(
    row.draftText !== null ? row.draftValidationJson! : revision.validationJson,
  ) as StudioValidation;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as "top" | "picker",
    version: row.version,
    revision: row.revision,
    document: JSON.parse(row.documentJson),
    draft:
      row.draftText !== null
        ? { text: row.draftText, document: parseDraft(row.draftText) }
        : null,
    validation,
    plan: row.previewJson ? JSON.parse(row.previewJson) : null,
    previewStale: row.previewVersion !== row.version,
    previewRevision: row.previewRevision,
    previewVersion: row.previewVersion,
    sourceVersion: row.sourceVersion,
  };
}
export async function addRevision(
  db: Db,
  userId: string,
  projectId: string,
  revision: number,
  document: VideoDocument,
  result: Awaited<ReturnType<typeof evaluate>>,
  reason: string,
) {
  const saved = await db.studioRevision.create({
    data: {
      projectId,
      revision,
      reason,
      documentJson: jsonText(document),
      sourceVersion: document.source.version ?? null,
      validationJson: JSON.stringify(result.validation),
      planJson: result.validation.ready ? JSON.stringify(result.plan) : null,
      assetsJson: JSON.stringify({
        resolvedDocument: result.resolvedDocument,
        manifest: result.manifest,
        files: result.files,
        runtime,
      }),
    },
  });
  await setReferences(db, userId, projectId, `revision:${revision}`, document);
  return saved;
}
async function assertSourceUnchanged(
  userId: string,
  document: VideoDocument,
  db: Db,
) {
  const current = await reconcileSource(userId, document, db);
  if (current.source.version !== document.source.version)
    throw new StudioError("VERSION_CONFLICT");
}
/** Recheck all sources represented by the edit token, including a switched draft. */
export async function assertProjectSourcesUnchanged(
  userId: string,
  project: Pick<StudioProjectView, "document" | "draft">,
  db: Db,
) {
  await assertSourceUnchanged(userId, project.document, db);
  if (project.draft) {
    const parsed = videoDocumentSchema.safeParse(project.draft.document);
    if (parsed.success) await assertSourceUnchanged(userId, parsed.data, db);
  }
}
async function cas(
  db: Db,
  id: string,
  version: number,
  data: Parameters<Db["studioProject"]["updateMany"]>[0]["data"],
) {
  const result = await db.studioProject.updateMany({
    where: { id, version },
    data,
  });
  if (!result.count) throw new StudioError("VERSION_CONFLICT");
}
/** Every read reconciles the actual source fingerprint. Revisions remain untouched. */
export async function getStudioProject(
  userId: string,
  id: string,
): Promise<StudioProjectView> {
  return readProject(userId, id, 2);
}
async function readProject(
  userId: string,
  id: string,
  retries: number,
): Promise<StudioProjectView> {
  const row = await owned(userId, id);
  const old = JSON.parse(row.documentJson) as VideoDocument;
  const document = await reconcileSource(userId, old);
  const headChanged = document.source.version !== old.source.version;
  const parsedDraft = videoDocumentSchema.safeParse(
    row.draftText === null ? null : parseDraft(row.draftText),
  );
  const draftDocument = parsedDraft.success
    ? await reconcileSource(userId, parsedDraft.data)
    : undefined;
  const draftChanged =
    parsedDraft.success &&
    draftDocument!.source.version !== parsedDraft.data.source.version;
  if (!headChanged && !draftChanged) return view(row);
  const directory = headChanged ? directoryFor(userId, id) : undefined;
  try {
    const result = headChanged
      ? await evaluate(userId, document, directory)
      : undefined;
    let draftText = row.draftText;
    let draftResult: Awaited<ReturnType<typeof evaluate>> | undefined;
    if (draftText !== null) {
      if (draftDocument) draftText = jsonText(draftDocument);
      draftResult = await evaluate(userId, parseDraft(draftText));
      if (!parsedDraft.success)
        draftResult.validation.diagnostics.push({
          severity: "warning",
          code: "DRAFT_SOURCE_STALE",
          message: "Source changed; repair the draft before committing.",
          path: "source",
        });
    }
    return await prisma.$transaction(async (db) => {
      await owned(userId, id, db);
      await assertSourceUnchanged(userId, document, db);
      if (draftDocument) await assertSourceUnchanged(userId, draftDocument, db);
      const revision = row.revision + (headChanged ? 1 : 0),
        version = row.version + 1;
      const preview = (draftResult ?? result)!;
      await cas(db, id, row.version, {
        ...(headChanged
          ? {
              documentJson: jsonText(document),
              sourceVersion: document.source.version ?? null,
              revision,
            }
          : {}),
        version,
        draftText,
        draftValidationJson: draftResult
          ? JSON.stringify(draftResult.validation)
          : null,
        ...(result?.validation.ready ? { lastGoodRevision: revision } : {}),
        ...(preview.validation.ready
          ? {
              previewJson: JSON.stringify(preview.plan),
              previewVersion: version,
              previewRevision: draftResult ? null : revision,
            }
          : {}),
      });
      if (result) {
        await addRevision(db, userId, id, revision, document, result, "source");
        await setReferences(db, userId, id, "head", document);
      }
      if (draftText !== null)
        await setReferences(
          db,
          userId,
          id,
          "draft",
          parseDraft(draftText),
          !draftResult?.validation.ready,
        );
      return view(
        await db.studioProject.findUniqueOrThrow({ where: { id } }),
        db,
      );
    });
  } catch (e) {
    if (directory) await cleanupDirectory(directory);
    if (
      e instanceof StudioError &&
      e.code === "VERSION_CONFLICT" &&
      retries > 0
    )
      return readProject(userId, id, retries - 1);
    throw e;
  }
}
export async function createStudioProject(
  userId: string,
  raw: CreateStudioProjectInput,
): Promise<StudioProjectView> {
  const input = createStudioProjectSchema.parse(raw);
  jsonText(input.document);
  return createFromDocument(
    userId,
    input,
    requestHash("create", input),
    () => input.document,
  );
}
export async function createStudioProjectFromPreset(
  userId: string,
  raw: CreateStudioProjectFromPresetInput,
) {
  const input = createStudioProjectFromPresetSchema.parse(raw);
  return createFromDocument(
    userId,
    input,
    requestHash("create-from-preset", input),
    async () => {
      const preset = await getStudioPreset(userId, input.presetId);
      const document = createVideoDocument({
        kind: preset.kind,
        preset,
        title: input.title,
        roundCount: input.roundCount,
        cardsPerRound: input.cardsPerRound,
      });
      if (input.sourceId) {
        if (preset.kind !== "top") throw new StudioError("SOURCE_KIND_INVALID");
        document.source = {
          kind: "tournament",
          tournamentId: input.sourceId,
          participants: [],
          rounds: [],
        };
      }
      return document;
    },
  );
}
/** The factory resolves mutable owned inputs only after checking its semantic receipt. */
async function createFromDocument(
  userId: string,
  input: { idempotencyKey?: string },
  request: string,
  makeDocument: () => unknown | Promise<unknown>,
): Promise<StudioProjectView> {
  await actor(userId);
  const old = await replay<StudioProjectView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  const rawDocument = await makeDocument();
  jsonText(rawDocument);
  const id = randomUUID();
  const directory = directoryFor(userId, id);
  const document = await reconcileSource(
    userId,
    parseVideoDocument(rawDocument),
  );
  try {
    const result = await evaluate(userId, document, directory);
    const saved = await prisma.$transaction(async (db) => {
      await actor(userId, db);
      const old = await replay<StudioProjectView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (old) return old;
      await assertSourceUnchanged(userId, document, db);
      await db.studioProject.create({
        data: {
          id,
          userId,
          title: document.title,
          kind: document.kind,
          documentJson: jsonText(document),
          sourceVersion: document.source.version ?? null,
          ...(result.validation.ready
            ? {
                lastGoodRevision: 1,
                previewJson: JSON.stringify(result.plan),
                previewVersion: 1,
                previewRevision: 1,
              }
            : {}),
        },
      });
      await addRevision(db, userId, id, 1, document, result, "create");
      await setReferences(db, userId, id, "head", document);
      const value = await view(
        await db.studioProject.findUniqueOrThrow({ where: { id } }),
        db,
      );
      await receipt(db, userId, input.idempotencyKey, request, value);
      return value;
    });
    if (saved.id !== id) await cleanupDirectory(`studio/${userId}/${id}`);
    return saved;
  } catch (e) {
    await cleanupDirectory(`studio/${userId}/${id}`);
    throw e;
  }
}
export async function listStudioProjects(
  userId: string,
): Promise<StudioProjectView[]> {
  await actor(userId);
  const rows = await prisma.studioProject.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  const result: StudioProjectView[] = [];
  for (const row of rows) result.push(await getStudioProject(userId, row.id));
  return result;
}
export async function saveStudioDraft(
  userId: string,
  id: string,
  raw: SaveStudioDraftInput,
): Promise<StudioProjectView> {
  const input = saveStudioDraftSchema.parse(raw);
  return writeDraft(
    userId,
    id,
    input,
    requestHash(`draft:${id}`, input),
    () => input,
  );
}
export async function patchStudioDraft(
  userId: string,
  id: string,
  raw: PatchStudioDraftInput,
) {
  const input = patchStudioDraftSchema.parse(raw);
  return writeDraft(
    userId,
    id,
    input,
    requestHash(`patch:${id}`, input),
    (current) => {
      const document = editableDocument(current);
      try {
        return {
          document: patchVideoDocument(
            document,
            input.operations.map((op) =>
              op.op === "set" ? { ...op, value: op.value } : op,
            ),
          ),
        };
      } catch (e) {
        if (e instanceof ZodError) throw e;
        throw new StudioError("PATCH_INVALID", [
          {
            severity: "error",
            code: "PATCH_INVALID",
            path: "operations",
            message: e instanceof Error ? e.message : "Invalid semantic patch",
          },
        ]);
      }
    },
  );
}
export async function applyStudioPreset(
  userId: string,
  id: string,
  raw: ApplyStudioPresetInput,
) {
  const input = applyStudioPresetSchema.parse(raw);
  return writeDraft(
    userId,
    id,
    input,
    requestHash(`apply-preset:${id}`, input),
    async (current) => {
      try {
        return {
          document: applyVideoPreset(
            editableDocument(current),
            await getStudioPreset(userId, input.presetId),
          ),
        };
      } catch (error) {
        if (error instanceof PresetIncompatibleError)
          throw new StudioError("PRESET_INCOMPATIBLE", [
            {
              severity: "error",
              code: "PRESET_INCOMPATIBLE",
              path: error.path,
              message: error.message,
            },
          ]);
        throw error;
      }
    },
  );
}
function editableDocument(current: StudioProjectView) {
  const parsed = videoDocumentSchema.safeParse(
    current.draft ? current.draft.document : current.document,
  );
  if (!parsed.success) throw new StudioError("DRAFT_REPLACEMENT_REQUIRED");
  return parsed.data;
}
/** Trusted request identity is constructed by each public operation, never supplied by callers.
 * All three editor paths share source guards, evaluation, CAS and atomic receipt publication. */
async function writeDraft(
  userId: string,
  id: string,
  input: { expectedVersion: number; idempotencyKey?: string },
  request: string,
  content: (
    current: StudioProjectView,
  ) =>
    | { document?: unknown; text?: string }
    | Promise<{ document?: unknown; text?: string }>,
): Promise<StudioProjectView> {
  await owned(userId, id);
  const old = await replay<StudioProjectView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  const current = await getStudioProject(userId, id);
  if (current.version !== input.expectedVersion) {
    // An identical in-flight operation may have committed while get reconciled.
    const replayed = await replay<StudioProjectView>(
      prisma,
      userId,
      input.idempotencyKey,
      request,
    );
    if (replayed) return replayed;
    throw new StudioError("VERSION_CONFLICT");
  }
  const replacement = await content(current);
  let text = replacement.text ?? jsonText(replacement.document);
  let value = parseDraft(text);
  const parsed = videoDocumentSchema.safeParse(value);
  if (parsed.success) {
    value = await reconcileSource(userId, parsed.data);
    text = jsonText(value);
  }
  const result = await evaluate(userId, value);
  return prisma.$transaction(async (db) => {
    await owned(userId, id, db);
    const old = await replay<StudioProjectView>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    await assertProjectSourcesUnchanged(userId, current, db);
    if (parsed.success)
      await assertSourceUnchanged(userId, value as VideoDocument, db);
    await references(userId, value, db);
    const version = input.expectedVersion + 1;
    await cas(db, id, input.expectedVersion, {
      version,
      draftText: text,
      draftValidationJson: JSON.stringify(result.validation),
      ...(result.validation.ready
        ? {
            previewJson: JSON.stringify(result.plan),
            previewVersion: version,
            previewRevision: null,
          }
        : {}),
    });
    await setReferences(
      db,
      userId,
      id,
      "draft",
      value,
      !result.validation.ready,
    );
    const saved = await view(
      await db.studioProject.findUniqueOrThrow({ where: { id } }),
      db,
    );
    await receipt(db, userId, input.idempotencyKey, request, saved);
    return saved;
  });
}
async function commit(
  userId: string,
  id: string,
  input: CommitStudioDraftInput,
  restore?: number,
): Promise<StudioProjectView> {
  await owned(userId, id);
  const request = requestHash(`${restore ? "restore" : "commit"}:${id}`, {
    ...input,
    restore,
  });
  const old = await replay<StudioProjectView>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  const current = await getStudioProject(userId, id);
  if (current.version !== input.expectedVersion)
    throw new StudioError("VERSION_CONFLICT");
  let value: unknown;
  if (restore) {
    const revision = await prisma.studioRevision.findUnique({
      where: { projectId_revision: { projectId: id, revision: restore } },
    });
    if (!revision) throw new StudioError("NOT_FOUND");
    value = JSON.parse(revision.documentJson);
  } else value = current.draft ? current.draft.document : current.document;
  const parsed = videoDocumentSchema.safeParse(value);
  if (!parsed.success)
    throw new StudioError("VALIDATION_FAILED", current.validation.diagnostics);
  const document = await reconcileSource(userId, parsed.data);
  const directory = directoryFor(userId, id);
  let persisted = false;
  try {
    const result = await evaluate(userId, document, directory);
    if (!result.validation.ready)
      throw new StudioError("VALIDATION_FAILED", result.validation.diagnostics);
    const saved = await prisma.$transaction(async (db) => {
      await owned(userId, id, db);
      const old = await replay<StudioProjectView>(
        db,
        userId,
        input.idempotencyKey,
        request,
      );
      if (old) return old;
      await assertProjectSourcesUnchanged(userId, current, db);
      await assertSourceUnchanged(userId, document, db);
      const revision = current.revision + 1,
        version = current.version + 1;
      await cas(db, id, current.version, {
        version,
        revision,
        documentJson: jsonText(document),
        title: document.title,
        kind: document.kind,
        sourceVersion: document.source.version ?? null,
        draftText: null,
        draftValidationJson: null,
        lastGoodRevision: revision,
        previewJson: JSON.stringify(result.plan),
        previewVersion: version,
        previewRevision: revision,
      });
      await addRevision(
        db,
        userId,
        id,
        revision,
        document,
        result,
        restore ? "restore" : "commit",
      );
      await setReferences(db, userId, id, "head", document);
      await db.studioAssetReference.deleteMany({
        where: { projectId: id, scope: "draft" },
      });
      const saved = await view(
        await db.studioProject.findUniqueOrThrow({ where: { id } }),
        db,
      );
      await receipt(db, userId, input.idempotencyKey, request, saved);
      persisted = true;
      return saved;
    });
    if (!persisted) await cleanupDirectory(directory);
    return saved;
  } catch (e) {
    await cleanupDirectory(directory);
    throw e;
  }
}
export async function commitStudioDraft(
  userId: string,
  id: string,
  input: CommitStudioDraftInput,
) {
  return commit(userId, id, commitStudioDraftSchema.parse(input));
}
export async function restoreStudioRevision(
  userId: string,
  id: string,
  raw: RestoreStudioRevisionInput,
) {
  const input = restoreStudioRevisionSchema.parse(raw);
  return commit(userId, id, input, input.revision);
}
export async function deleteStudioProject(
  userId: string,
  id: string,
  raw: DeleteStudioResourceInput = {},
) {
  const input = deleteStudioResourceSchema.parse(raw);
  await actor(userId);
  const request = requestHash(`delete-project:${id}`, input);
  const old = await replay<{ deleted: true; id: string }>(
    prisma,
    userId,
    input.idempotencyKey,
    request,
  );
  if (old) return old;
  await owned(userId, id);
  const result = await prisma.$transaction(async (db) => {
    const old = await replay<{ deleted: true; id: string }>(
      db,
      userId,
      input.idempotencyKey,
      request,
    );
    if (old) return old;
    const row = await owned(userId, id, db);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== row.version
    )
      throw new StudioError("VERSION_CONFLICT");
    if (await db.studioJob.count({ where: { projectId: id } }))
      throw new StudioError("JOB_IN_USE");
    await db.studioSnapshot.deleteMany({ where: { projectId: id } });
    await db.studioProject.delete({ where: { id } });
    const result = { deleted: true as const, id };
    await receipt(db, userId, input.idempotencyKey, request, result);
    return result;
  });
  await cleanupDirectory(`studio/${userId}/${id}`);
  return result;
}
