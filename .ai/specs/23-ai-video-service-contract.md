# Studio persistence service contract (Task 3)

Status: implemented 2026-10-26. Server-only public entry point:
`src/server/studio/index.ts`. Browser-safe DTOs and strict Zod input schemas:
`src/server/studio/types.ts`. This document complements SDK contract 22.
No API routes, MCP handlers, UI, job table or worker are implemented by Task 3.

## Services and inputs

Every service takes the trusted database `userId`, never an email or a client
path. Read fresh account role/ownership on every operation. Studio authoring
uses the existing `media:upload` capability; users and admins can author.
`render:run` checks and preview budgets belong to Task 4. Existing upload/pool
quotas stay in force; there is no invented Studio project/card/round cap.
Serialized documents/draft text are bounded to 2,000,000 JS string code units.
Studio immutable-version bytes are separately reported in account usage and
are not charged again to the original media-pool quota.

| Export | Input after userId/projectId | Result |
|---|---|---|
| `createStudioProject(userId,input)` | `{document:unknown,idempotencyKey?}` | `StudioProjectView` |
| `listStudioProjects(userId)` | none | `StudioProjectView[]`, newest first, reconciled |
| `getStudioProject(userId,id)` | none | reconciled `StudioProjectView` |
| `saveStudioDraft(userId,id,input)` | `{expectedVersion,idempotencyKey?,document?:unknown,text?:string}`; exactly one content field | `StudioProjectView` |
| `commitStudioDraft(userId,id,input)` | `{expectedVersion,idempotencyKey?}` | new saved revision; clears draft |
| `restoreStudioRevision(userId,id,input)` | same plus `revision:number` | new revision copied from history, reconciled to current source |
| `listStudioRevisions(userId,id)` | none | `StudioRevisionView[]`, newest first |
| `listStudioPresets(userId)` | none | builtins and owned `StudioPresetView[]` |
| `saveStudioPreset(userId,input)` | `{document:unknown,name,idempotencyKey?}` | extracted media-free personal preset |
| `getStudioManifest(userId,document,mode?)` | `mode:'url'|'file'`, default URL | `AssetManifest`; throws if resolution fails |
| `freezeStudioProject(userId,id,input?)` | `{expectedVersion?,revision?,idempotencyKey?}` | `StudioFrozenRevision` |
| `deleteStudioProject(userId,id,input?)` | `{expectedVersion?,idempotencyKey?}` | `{deleted:true,id}` |
| `deleteStudioPreset(userId,id,input?)` | `{idempotencyKey?}` (generic deletion input type) | `{deleted:true,id}` |
| `deleteStudioRevision(userId,id,revision,input?)` | `{expectedVersion?,idempotencyKey?}` | `{deleted:true,revision}` |
| `deleteStudioSnapshot(userId,snapshotId)` | owned snapshot ID | releases the frozen-reference row |

Schema exports are `mutationSchema`, `createStudioProjectSchema`,
`saveStudioDraftSchema`, `commitStudioDraftSchema`,
`restoreStudioRevisionSchema`, `freezeStudioProjectSchema`,
`saveStudioPresetSchema`, `deleteStudioResourceSchema`, and
`studioManifestModeSchema`. Mutating request keys are optional strings of
1–200 characters. Adapters should generate a key once and reuse it on retry.

Idempotency keys are scoped to an account across all operations. Receipts store
a canonical action/input hash and the exact original response in the same
transaction as the mutation. Different input/action with the same key throws
`IDEMPOTENCY_CONFLICT`. A replay returns the original response, not the latest
head; call `getStudioProject` for current state. Receipts are retained until
account deletion, including deletion receipts. Project writes check ownership
before replay; deleted creation results are historical receipts, not recreated
projects. Concurrent identical creates/freeze requests return one logical
result and dispose duplicate staged media copies.

## Head, draft, revision, preview and CAS

`StudioProjectView` is:

```ts
{
  id, title, kind, version, revision,
  document: VideoDocument,
  draft: null | {text:string,document:unknown|null},
  validation: {ready:boolean,diagnostics:Diagnostic[]},
  plan: CompiledVideo|null,
  previewStale:boolean,
  previewRevision:number|null,
  previewVersion:number|null,
  sourceVersion:string|null
}
```

`document` is the committed head, including automatic source reconciliation.
`draft` is separate editor content. Malformed raw JSON is retained verbatim;
structurally invalid parsed JSON is also retained. Successful source
reconciliation may normalize valid draft JSON. `validation` describes the
current draft when present, otherwise the head. `plan` is the last successful
preview, never an invalid partial plan. `previewVersion` names the edit token
that produced that plan, and `previewRevision` is null for a draft-origin
preview. `previewStale` means that preview token differs from current `version`.
An invalid document can exist as an initial/source-generated revision, but
cannot be committed manually or frozen for rendering.

`version` is a monotonically increasing edit/CAS token. Every draft save,
commit, restore or automatic source reconciliation increments it. `revision`
identifies saved history; merely saving a draft does not create a revision.
All draft saves/commits/restores require the exact current `expectedVersion`.
Source changes are reconciled before a write, so a token issued before a
ranking change produces `VERSION_CONFLICT`. The database transaction rechecks
source fingerprint and token before accepting the write. A conflict does not
clear editor content or overwrite the winner. Automatic read reconciliation
retries a competing reconciliation up to twice.

A valid draft frozen without an explicit revision is committed and frozen in
one transaction. An invalid draft causes `VALIDATION_FAILED`; it never falls
back to an older successful preview. Passing `revision` explicitly selects
that immutable history even when the current draft is invalid. Historical
restore is an editable new revision and therefore reconciles current source;
use explicit historical freeze for the exact older source snapshot.

## Authoritative source synchronization

The hash includes ordered ranks/track IDs/scores, topSize and track
label/media metadata. It does not rely on Tournament.updatedAt, since ordinary
reordering does not update that timestamp. The full current ranking is read,
then topSize selects source participants. The adapter always restores
source-owned `id/rank/label`, even when a client supplies a matching version
string. Participant `caption`, `media` and `settings` are retained by stable
ID, never position. New participants receive owned track bindings under
`source:<trackId>`; missing track bytes become actionable diagnostics.
Explicit scene/card references to removed participants remain diagnostic;
there is no index rebinding. Existing declared bindings remain explicit
references even when unused. Every source change saves a new source revision;
older source documents, resolved plans and media copies remain untouched.

## Media resolution and immutability

Pool, track and builtin bindings resolve ownership before file access. Real
paths must remain within storage after realpath resolution (including symlinks).
All declared bindings, including unused ones, are included. ffmpeg probes
actual duration, stream presence and visual dimensions; corrupt/absent media
produces diagnostics. Optional pinned binding hashes are enforced. Builtin
`tick`, `reveal`, `answer` sounds are generated locally; no network media URL is
accepted. Pool URLs use `/api/arts/<id>`; tracks use
`/api/tracks/<id>/audio`. `file` mode returns local absolute source paths for
trusted server inspection, not an immutable render input.

Every saved revision materializes its available media under
`storage/studio/<userId>/<projectId>/versions/<operation-uuid>/<sha256>.<ext>`.
Source bytes are copied and their hash rechecked before persistence; posters
are copied too. The revision stores the original document, a resolved document,
manifest/files/runtime metadata and its resolved plan. Source-file replacement
after a save cannot change the saved revision. A freeze verifies copied hashes
and stores an immutable snapshot envelope pointing to that saved revision.

`StudioFrozenRevision` contains:

```ts
{
 snapshotId, projectId, revisionId, revision, sourceVersion,
 document, resolvedDocument, manifest, files, plan, validation,
 runtime: {schemaVersion:1,compilerVersion:'1.0.0',remotionVersion,fontFamily},
 hash // SHA-256 of canonical envelope content, excluding snapshotId/hash
}
// files[assetKey]:
{path,hash,bytes,posterPath?,posterHash?,posterBytes?}
```

File paths in this DTO are storage-relative, not arbitrary client paths. The
runtime records the renderer's actual fixed Arial/Helvetica Neue/sans-serif
font stack; there is no custom-font upload API in SDK v1. `document` preserves
authored settings. `resolvedDocument` fills missing active audio windows using
real decoded PCM/RMS, cached by file hash and desired window length. Distinct
scene/participant effective settings get distinct analyses. Explicit bounds,
separate footage offsets and same-source video synchronization survive.
Resolution expands only scenes that require per-participant active windows,
with namespaced generated IDs and remapped scene sound anchors. Original
source and authored document identities remain unchanged. Decoder concurrency
is bounded independently of the number of participants. Text/image-only and
silent-video objects do not require audio analysis.

## Worker and HTTP integration requirements (Tasks 4–6)

Freeze at enqueue. Persist/reuse the returned snapshot and never reread mutable
head/source when the worker begins. Job rows must reference the snapshot with
a restrictive FK and enforce cancellation/active-job deletion rules before
releasing it. Task 4 must extend `deleteStudioSnapshot`, project/account cleanup
and revision/job usage with those job relations. This deliverable intentionally
has no job table and cannot enforce future job references yet.

The renderer consumes `{plan,assetMode:'url'|'static'}`. For static rendering,
copy every frozen media/poster file into job publicDir; rewrite every
`node.media.asset.src`, `posterSrc`, and `plan.audio[].asset.src` to a basename
relative to publicDir (no leading slash), then use `assetMode:'static'`.
Do not give absolute filesystem paths to browser media elements. Frozen
manifest URLs use `/api/studio/media?path=<encoded-storage-relative-path>`;
builtin URLs use `/api/studio/builtin/<name>`. These routes are a declared
Task 6 boundary, not implemented here. The media route must authenticate and
match the requested path against the owned persisted revision/snapshot or
owned pool poster; never serve a path just because its prefix looks safe.
Return ranges for audio/video and enforce ownership for previews/results.

## References, cleanup and errors

StudioAssetReference rows protect heads, every saved revision and drafts.
They include unused bindings. Invalid binding metadata (for example an invalid
hash type) does not disable protection of identifiable pool/track IDs. Invalid
replacement drafts retain previous references to keep the last-good preview
usable; a valid replacement releases obsolete draft references. Foreign-owned
identities are rejected atomically even in invalid drafts. Frozen snapshots
restrict revision deletion. Current and last-good saved revisions cannot be
deleted. Release snapshots, then unused old revisions, to free old media;
deleting a preset never changes applied project copies.

Pool/tournament deletion checks and deletes database rows in a transaction
before unlinking files. Restrictive FKs also prevent a concurrent reference
from being silently invalidated. Pool usage counts include Studio references
and explain why deletion is unavailable. Account usage adds
`studio:{projects,revisions,snapshots,bytes}`, counting copied paths once per
stored version, including posters. Account deletion deletes references/rows
before its media directories. Project deletion removes its snapshots/history,
references and owned version files; no old tournament/manual-top records are
migrated by this feature.

`StudioError` has `code` and optional `diagnostics`; its message equals code.
Important codes: `NOT_FOUND`, `FORBIDDEN`, `VERSION_CONFLICT`,
`IDEMPOTENCY_CONFLICT`, `VALIDATION_FAILED`, `SOURCE_NOT_FOUND`,
`ASSET_NOT_FOUND`, `ASSET_RESOLUTION_FAILED`, `REVISION_IN_USE`,
`SNAPSHOT_HASH_MISMATCH`, `DOCUMENT_TOO_LARGE`. Media diagnostics include
`ASSET_FILE_MISSING`, `ASSET_PATH_INVALID`, `ASSET_MEDIA_INVALID`,
`ASSET_HASH_MISMATCH`, `AUDIO_ANALYSIS_FAILED`. Legacy deletion guards report
`STUDIO_ASSET_IN_USE` / `STUDIO_SOURCE_IN_USE`. Runtime input schemas may throw
ZodError; adapters should return field issues, not a generic server error.
