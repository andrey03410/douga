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
| `createStudioProjectFromPreset(userId,input)` | `{presetId,title?,sourceId?,roundCount?,cardsPerRound?,idempotencyKey?}` | shared factory + normal saved project |
| `listStudioProjects(userId)` | none | `StudioProjectView[]`, newest first, reconciled |
| `getStudioProject(userId,id)` | none | reconciled `StudioProjectView` |
| `saveStudioDraft(userId,id,input)` | `{expectedVersion,idempotencyKey?,document?:unknown,text?:string}`; exactly one content field | `StudioProjectView` |
| `patchStudioDraft(userId,id,input)` | `{expectedVersion,idempotencyKey?,operations:PatchOperation[]}` | semantic edit of current draft/head |
| `applyStudioPreset(userId,id,input)` | `{expectedVersion,idempotencyKey?,presetId}` | design-only draft edit, preserving source content |
| `commitStudioDraft(userId,id,input)` | `{expectedVersion,idempotencyKey?}` | new saved revision; clears draft |
| `restoreStudioRevision(userId,id,input)` | same plus `revision:number` | new revision copied from history, reconciled to current source |
| `listStudioRevisions(userId,id)` | none | `StudioRevisionView[]`, newest first |
| `listStudioPresets(userId)` | none | builtins and owned `StudioPresetView[]` |
| `saveStudioPreset(userId,input)` | `{name,idempotencyKey?,document?:unknown,preset?:unknown}`; exactly one content field | validated media-free personal preset |
| `getStudioManifest(userId,document,mode?)` | `mode:'url'|'file'`, default URL | `AssetManifest`; throws if resolution fails |
| `freezeStudioProject(userId,id,input?)` | `{expectedVersion?,revision?,idempotencyKey?}` | `StudioFrozenRevision` |
| `deleteStudioProject(userId,id,input?)` | `{expectedVersion?,idempotencyKey?}` | `{deleted:true,id}` |
| `deleteStudioPreset(userId,id,input?)` | `{idempotencyKey?}` (generic deletion input type) | `{deleted:true,id}` |
| `deleteStudioRevision(userId,id,revision,input?)` | `{expectedVersion?,idempotencyKey?}` | `{deleted:true,revision}` |
| `deleteStudioSnapshot(userId,snapshotId)` | owned snapshot ID | releases the frozen-reference row |

Schema exports are `mutationSchema`, `createStudioProjectSchema`,
`createStudioProjectFromPresetSchema`, `patchStudioDraftSchema`, `applyStudioPresetSchema`,
`saveStudioDraftSchema`, `commitStudioDraftSchema`,
`restoreStudioRevisionSchema`, `freezeStudioProjectSchema`,
`saveStudioPresetSchema`, `deleteStudioResourceSchema`, and
`studioManifestModeSchema`.

Factory creation resolves a canonical owned/built-in preset and uses the shared
SDK `createVideoDocument({kind,preset,...})` factory. Personal round/card/group
skeletons, format settings, sound rules and media-free playlist policy survive.
`sourceId` attaches an owned tournament to a top; picker source attachment fails
`SOURCE_KIND_INVALID`. Counts use the SDK technical resource budgets. It never
creates a legacy VideoProject. Applying a preset to an existing project preserves
its content/counts/answers/bindings; it does not use the new-project skeleton.
Custom media transfers only through the SDK's deterministic scene/node
correspondence (contract 22). Incompatible assigned content returns
`PRESET_INCOMPATIBLE` with an actionable diagnostic before changing the draft,
version or receipt. Corresponding authored text/card selectors remain content.
Missing required custom image/video references block validation, commit and
current freeze/final rendering, including `slot:` keys; only `required:false`
permits an unfilled visual placeholder. Explicit valid historical revisions
remain independently renderable.

Factory creation, replace, semantic patch and preset application use shared
private create/draft primitives. Semantic request hashes are constructed on the
server; no input can override a receipt identity. Receipts are checked before
reading mutable head/preset/source, then again in the transaction. A retry after
an intervening edit or deletion of its personal preset returns the original
response. Concurrent identical requests produce one mutation; version mismatch
rechecks the receipt before returning `VERSION_CONFLICT`. Different actions or
inputs with the same account key still fail `IDEMPOTENCY_CONFLICT`.
Patch operations are a bounded 1–1000 array of SDK `videoPatchOperationSchema`
values. Schema-valid drafts with semantic diagnostics can be repaired by patch.
Malformed/schema-invalid drafts fail `DRAFT_REPLACEMENT_REQUIRED` for patch/apply;
they never fall back to the committed head. Replace remains the repair path.
Missing stable-ID targets or protected semantic paths return `PATCH_INVALID`
with operation diagnostics; resulting schema errors retain field issues.

## Bounded queries and original inspection (Task 6)

`studioPageSchema` accepts `{limit?:1..100,cursor?:string}`, default 20.
`listStudioProjectSummaries`, `listStudioHistorySummaries`,
`listStudioPresetSummaries`, `listStudioSources` return `{items,nextCursor}`.
Project/history queries select neutral scalar metadata in SQL and never load
every document, draft or plan. Listing does not reconcile sources; individual
get/write remains authoritative. Cursors are owner/collection checked before
querying. Preset summaries contain complete built-in metadata and owned personal
ID/name metadata; `getStudioPreset(userId,id)` reads the strict canonical template
without catalog-only `personal`. `getStudioSource(userId,sourceId,page?)` reuses
`reconcileSource`, returning the current fingerprint, bounded stable-ID ranking
items and their binding identities, without paths. It is an explicit content read.

`inspectStudioAsset(userId,assetId,input?)` uses the shared strict
`inspectStudioAssetSchema`:

```ts
{content?:boolean; mode?:'auto'|'image'|'audio'|'clip'; fromSec?:number; durationSec?:number}
// defaults content=false, mode=auto, fromSec=0
// fromSec: finite, 0..7200; durationSec: finite, >0 and <=15
```

Auto chooses PNG for image/video and AAC for audio. Video may explicitly request
a later image, an audible excerpt, or an H.264/AAC MP4 fragment. Actual streams
and source duration are probed. A missing stream fails `ASSET_KIND_MISMATCH`;
an interval outside the source or a duration on an image request fails
`ASSET_RANGE_INVALID`. Omitted excerpt duration uses the available tail, at most
15 seconds. The metadata describes the original asset and its preview interval;
it never contains an absolute path. Explicit image/audio content is returned
only when requested. Clips return a descriptor and encode only when read through
`readStudioAssetResource`. PNG longest edge is <=720, MP4 is even-sized <=720,
each subprocess is limited to 30 seconds and 12 MiB output. Fresh permission and
ownership are rechecked after encoding. Only owned Art IDs resolve files through
the existing safe-storage boundary; caller-supplied filesystem paths are absent.

Initial stream probing is also bounded, including metadata-only (`content:false`)
inspection and resource reads: `probeMediaInfo` uses the shared capture helper's
30-second deadline and 1-MiB diagnostic cap. Hitting either bound sends SIGTERM,
escalates to SIGKILL after 200 ms if necessary, and waits for the actual child
`close` event before rejecting. No promise race leaves a probe running. Studio
inspection surfaces structured `MEDIA_PROBE_TIMEOUT` or
`MEDIA_PROBE_OUTPUT_LIMIT`, without returning stderr or private paths. These probe
limits are published as `studioInspectionLimits.probe` in MCP capabilities.
Normal stream/duration parsing and legacy missing-input null/false fallback
remain unchanged. Encoder output retains its separate 12-MiB/30-second bounds.

`readStudioJobResource(userId,jobId)` reuses the verified job-artifact boundary
and returns at most 12 MiB of base64 bytes. Larger outputs fail
`INSPECTION_BYTE_LIMIT`; this is an MCP inspection budget, not a render limit.
Task 7's authenticated streaming/download routes serve larger complete outputs.
The MCP resource forms and client-display caveat are specified in contract 22.

`saveStudioPreset` has two explicit modes. `document` parses a `VideoDocument`
and conservatively extracts a preset: thematic literal text becomes `Text`,
media becomes abstract slots and participant identities are removed. `preset`
parses a complete canonical `VideoPreset` using `videoPresetSchema`: generic
author-declared text such as «Выбери персонажа», SVG path geometry and valid
slots remain exactly authored. The service does not guess whether text is
reusable. Concrete media keys, participant/group targets and unknown document fields
are rejected; supplying both/neither content field is rejected. The server
assigns a new ID, the request's `name` and version1, overriding the validated
input preset's metadata. Idempotent replay returns the original saved template.
SVG shape geometry is design and also survives ordinary document extraction.

`StudioPresetView.personal` is catalog metadata, not a `VideoPreset` field.
Remove it before passing a catalog result to `applyVideoPreset`,
`videoPresetSchema`, or the explicit `preset` input, e.g.
`const {personal, ...preset} = view`. The canonical preset schema stays strict.

Mutating request keys are optional strings of
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
ranking change produces `VERSION_CONFLICT`. Reads reconcile both the committed
source and a valid draft's own source, including manual→tournament and source
A→source B switches. A draft-only source update advances `version` without
creating a redundant committed revision. `sourceVersion` identifies the head;
the draft's fingerprint is `draft.document.source.version`. The database
transaction rechecks the head, the prior valid draft and the candidate's source
fingerprints before accepting a save/commit/freeze, as well as the edit token. A conflict does not
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
`source:<trackId>`. Initial video assignments probe the owned local stream:
silent videos receive only visual media, voiced videos receive visual and audio,
and audio tracks receive audio. This initialization never rewrites retained
authored media assignments. Missing/unavailable video bytes cannot prove silence
and remain actionable manifest diagnostics.
Explicit scene/card references to removed participants remain diagnostic;
there is no index rebinding. Existing declared bindings remain explicit
references even when unused. Every committed-source change saves a new source revision;
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
are copied too. Before an evaluation returns, its exclusively owned staging
directory is swept against the successful file ledger: failed/unrecorded copies
are removed, including all-copy-failed directories. Shared-hash copies already
recorded for a successful binding remain intact. Invalid revisions therefore
cannot hide staged bytes from account usage or historical cleanup. The revision stores the original document, a resolved document,
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
restrict revision deletion. Current, last-good and the saved revision actually backing the retained
preview (`previewRevision`) cannot be deleted. Release snapshots, then unused old revisions, to free old media;
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

## Compiled timeline inspection (Task 6)

`getStudioTimeline(userId,projectId,input?)` uses `studioTimelineSchema`:
`{revision?:positiveInteger,limit?:1..100,cursor?:string}`. Scene cursors allow
4096 characters because generated IDs percent-encode authored/source ID segments.
It authorizes/reconciles the current project through the existing service, then
reads its retained last-good preview, or reads the requested owned immutable
revision's `planJson`. It never expands a document or implements a compiler.
The response has current `version/revision`, `available`, `stale`, `previewStale`,
`origin:{kind:'preview'|'revision',version,revision}`, plan FPS/dimensions/duration,
and bounded `{items,nextCursor}`. A historical origin has null edit version and
is not stale; a current preview names its actual edit token and saved revision
(null for draft previews). An unavailable plan is explicit and does not fall
back to a different origin.

Scene summaries expose the actual absolute `[from,to)` interval, kind, stable
participant/round IDs, absolute phase boundaries and sorted unique recommended
still-frame points. Points are selected from stored scene/transition, visibility,
label, active-window, answer and animation-keyframe boundaries; no asset paths,
compiled media sources or raw plan nodes are serialized. External agents can
pass these frame indices directly to still/clip/audio jobs. Given a job's
`projectId` and `revision`, requesting that historical timeline inspects the
same saved plan rather than a later draft preview.
