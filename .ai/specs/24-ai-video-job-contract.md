# Durable Studio jobs (Tasks 4–5)

Implemented server entry point: `src/server/studio/index.ts`. This extends
[23-ai-video-service-contract.md](23-ai-video-service-contract.md). No API, UI or
MCP adapters are implemented here. Do not expose internal storage paths.

## Public operations

All `userId` arguments are trusted authenticated database IDs. Ownership and
fresh account role are checked on each service call; authors require
`media:upload`. Enqueue and execution/publish of `render` also require fresh
`render:run` (currently admin). Other accounts, including other admins, cannot
read/cancel/delete an owner's jobs via these functions.

- `startStudioJob(userId, projectId, input): Promise<StudioJobView>`
- `getStudioJob(userId, jobId): Promise<StudioJobView>`
- `cancelStudioJob(userId, jobId): Promise<StudioJobView>`
- `deleteStudioJob(userId, jobId): Promise<{deleted:true,id:string}>`
- `runStudioWorkerOnce(options?:{jobId?:string;workerId?:string}): Promise<StudioJobView|null>`
- `getStudioJobArtifact(userId, jobId)` is a **server-only adapter boundary**.
  Returns `{path,jobId,name,mimeType,bytes,hash}` after fresh owner authorization,
  done-state check, safe storage resolution and content hash verification.
  Stream that path through an authenticated route/resource; never serialize its
  `path` to clients, accept a client-supplied path, or serve the job directories
  as public web assets. Ordinary job reads return metadata, not inline previews.

`startStudioJobSchema` is a strict discriminated Zod union. All variants accept
optional `expectedVersion` / `revision` as in freeze, and an optional 1–200
character `idempotencyKey`:

```ts
type StartStudioJobInput =
 | {kind:'still'; frame:number; expectedVersion?:number; revision?:number; idempotencyKey?:string}
 | {kind:'clip'; fromFrame:number; durationFrames:number; expectedVersion?:number; revision?:number; idempotencyKey?:string}
 | {kind:'audio'; fromFrame:number; durationFrames:number; expectedVersion?:number; revision?:number; idempotencyKey?:string}
 | {kind:'render'; expectedVersion?:number; revision?:number; idempotencyKey?:string};
```

Frames are zero-based nonnegative integers; lengths are positive integers.
The requested interval must fit the frozen plan. Stills are PNG, clips/finals
are H.264/AAC MP4, audio previews are AAC. Silence is encoded when the plan has
no audio. Clips/audio preserve absolute source-plan offsets and envelopes.

## Exact DTO

Types live in `job-types.ts`, re-exported by the service barrel:

```ts
interface StudioJobView {
 id:string; projectId:string|null; snapshotId:string|null;
 kind:'still'|'clip'|'audio'|'render'|'import';
 status:'queued'|'running'|'done'|'failed'|'canceled';
 progress:number; attempts:number; error:string|null;
 revision:number|null; revisionId:string|null; snapshotHash:string|null;
 engineId:string;
 result:StudioJobOutput|null; // composition result or StudioImportResult below
 createdAt:string; updatedAt:string; // ISO timestamps
}
interface StudioJobResult {
 kind:'still'|'clip'|'audio'|'render';
 resource:{jobId:string;name:string;mimeType:string;bytes:number;hash:string};
 width:number|null; height:number|null; fps:number;
 fromFrame:number; durationFrames:number;
 videoCodec:'h264'|null; audioCodec:'aac'|null;
}
```

Audio dimensions are null. `durationFrames/fps` describes the requested
composition interval; AAC/container duration may include encoder padding.
`resource.hash` is SHA-256 of output bytes; `snapshotHash` identifies exact
frozen input content, and `revisionId/revision` identify saved history.
`engineId` identifies cached bundle inputs and lockfile. No public result URL is
invented before an authenticated adapter exists. Resource identifiers and
metadata do not grant access by themselves.

## Durability, idempotency, engine and cancellation

Enqueue prepares an immutable engine bundle, then freezes the requested saved
revision or commits/freeze the valid draft. The job stores its snapshot FK;
workers never reread mutable source bindings, drafts or head ranking. Input
media/posters are the Task 3 immutable copies with verified byte hashes.

Enqueue receipts share Task 3 account-wide keys. Identical concurrent requests
return one logical job and one snapshot, including valid draft commits. A
bounded derived `job-freeze:<sha256>` internal key prevents collision with the
outer receipt. Conflicting key payloads/actions fail `IDEMPOTENCY_CONFLICT`.
Failed enqueue releases an unclaimed snapshot and its private freeze receipt.
The outer receipt returns the original enqueue response even after completion
or deletion; get the job to read current state. Deleted jobs are not recreated.

SQLite transactions acquire one global heavy-work slot plus a per-job attempt
UUID. Leases last 30 seconds, renewed every 5 seconds. Claim, progress and
publication check ownership of the lease; only an unexpired running attempt
can publish `done`. Expired attempts are recovered, with at most 3 attempts.
Transient failures retry after 1/2 seconds; role/hash/runtime/quota/time-budget
failures are terminal. Canceled jobs are never reclaimed or published.

Work executes in a separate Node child process; browser/media descendants are
killed as a process group on Unix on cancellation, timeout, or parent IPC loss.
The child independently checks the job lease every 5 seconds and before work.
Windows uses child termination but has not been validated for descendant-tree
cleanup; this implementation is validated on the repository's macOS host.

`cancelStudioJob` changes queued/running jobs to canceled atomically; terminal
states remain terminal. Cancellation is observed by active work within the
5-second checks, or at publication. `deleteStudioJob` rejects queued/running
jobs and canceled attempts with an unexpired lease (`JOB_ACTIVE`); wait until
the attempt stops or its lease expires. Deletion removes result bytes, job row
and its now-unreferenced snapshot. All job states protect their project and
snapshot until explicit job deletion (`JOB_IN_USE`). Revision deletion is
already protected by the snapshot FK. Account deletion is blocked
(`JOB_IN_USE`) only while one of the account's jobs is active by the same rule
as job deletion: queued/running, or a canceled attempt with an unexpired lease;
cancel it and wait for the lease to expire. Otherwise the account's job rows
are deleted in the same transaction as its snapshots and projects, then its
result bytes under `studio-jobs/<userId>`; shared engines are kept. Input pool/source
references remain protected by the saved revision. Result deletion never
removes revision media or a shared engine.

Engines are cached under storage by a hash of renderer, SDK, imported lib
sources and package lockfile. A bounded child bundles the actual code with the
existing `@` alias into a private staging directory, publishes atomically,
and records file hashes + Remotion version. Jobs retain that engine. Retries
verify and use the stored bundle, not rebuilt current renderer code. Changing
the installed Remotion version yields `ENGINE_RUNTIME_MISMATCH`; retain a
compatible installation to execute old engines. Cached engines are deliberately
retained for historical renders; automated engine garbage collection is not
part of this version.

Every attempt copies the cached bundle to an isolated serve directory and
copies full frozen media/posters into its `public/` folder. All compiled visual,
poster and audio sources are rewritten to relative static filenames. Bundle
build output/publicDir are siblings. No trimming or second audio envelope is
applied. Successful attempts retain output only; failed live attempts clean
all their files. A process crash may leave attempt directories, removed when
the owner deletes the job. Output storage is private.

## Published technical limits

`studioJobLimits` and `videoResourceLimits` are exported for adapters/MCP.
These are resource budgets, not old top/card/round product restrictions:

| Budget | Value |
|---|---:|
| Ordinary clip/audio preview | 15 seconds |
| Preview longest edge | ≤720 pixels; actual wide/vertical 704×396 / 396×704, square 704×704, avoiding odd H.264 dimensions |
| Final dimensions | native 1920×1080 / 1080×1920 / 1080×1080 |
| Active jobs per account, including admins | 4 |
| Ordinary-author retained output quota | 512 MiB; admins exempt from account byte quota |
| Input bytes per job, including posters | 2 GiB |
| Output bytes per job | 512 MiB; measured before publishing |
| Node child heap | 2048 MiB |
| Each Remotion media/offthread-video cache | 256 MiB |
| Per-frame renderer timeout | 60 seconds |
| Preview / final wall-clock timeout | 20 minutes / 4 hours |
| First engine build timeout | 2 minutes |
| Maximum composition duration | 2 hours |
| Authored node nesting / total JSON values | 32 levels / 100,000 values |
| Expanded scenes / conservative node estimate | 2,000 / 20,000 |
| Emitted audio cues / audio policy-window estimate | 20,000 / 200,000 |

The heap/cache bounds are not an OS-wide RSS cap for Chromium/FFmpeg. The output
limit is checked before publication, so temporary encoding space can exceed it.
Time/numeric bounds and iterative preflight run before recursive schema parsing,
active-snippet expansion and compilation. Sound-rule anchors are conservatively
multiplied by their repeated scene counts before media probing or active-snippet
analysis; that estimate shares the 20,000-cue budget. The audio policy estimate
adds playlist mute-window copies and music duck-window copies together and
checks the 200,000 total before either list is attached or JSON-cloned.
Excessive repetition returns
`RESOURCE_BUDGET_EXCEEDED` diagnostics instead of allocating a giant plan.
The node estimate conservatively includes generated card/group/layout nodes;
it may reject a document before the exact emitted-node count reaches 20,000.

Account `usageSummary().studio` adds `jobs` and `resultBytes`; existing `bytes`
continues to measure retained revision-media copies separately. Ordinary
account output quota is checked at enqueue and again atomically at publication.

Useful error codes: `NOT_FOUND`, `FORBIDDEN`, `VERSION_CONFLICT`,
`IDEMPOTENCY_CONFLICT`, `FRAME_RANGE_INVALID`, `PREVIEW_BUDGET_EXCEEDED`,
`INPUT_BUDGET_EXCEEDED`, `OUTPUT_BUDGET_EXCEEDED`, `JOB_QUOTA_EXCEEDED`,
`JOB_ACTIVE`, `JOB_IN_USE`, `JOB_TIMEOUT`, `LEASE_EXPIRED`, `LEASE_LOST`,
`SNAPSHOT_HASH_MISMATCH`, `ENGINE_RUNTIME_MISMATCH`, `ENGINE_HASH_MISMATCH`,
`RENDER_FAILED`, `WORKER_PROCESS_FAILED`, `RESULT_NOT_READY`,
`RESULT_HASH_MISMATCH`. Child exception text/paths are not returned to clients.
Schema failures are ZodError. Progress is 0–0.99 while running and 1 on done;
stills may go straight from 0 to 1. Retry resets progress and increments attempts.

## Worker entry point and Task 5 extension

```sh
npm run studio:worker
npm run studio:worker -- --once --job <owned-job-id>
```

The first command is a long-lived queue consumer. The second is a scoped single
attempt (possibly null if not eligible); tests and manual acceptance must use
it or `runStudioWorkerOnce({jobId})`, never an unscoped worker against shared
user data. Stop the loop with SIGINT/SIGTERM; current work finishes gracefully.
The macOS integration test also kills an actual CLI parent with SIGKILL after
its renderer has launched Chromium, observes the renderer stop without publishing,
then restarts a scoped CLI and completes the same frozen snapshot on attempt 2.
It shortens only that owned attempt's persisted lease to avoid a 30-second wait.
After a hard kill, leases recover from SQLite. There is no in-process render
promise required for durability.

`StudioJob` owns `userId` directly, with nullable project/snapshot FKs. Current
composition service requires both. Task 5 can add an `import` input/result and
worker dispatch branch in this same queue, with no project requirement. It
must preserve lease fencing, account authorization, scoped claims, quotas and
private result boundaries. Task 5 implements this extension below.

## Task 5: standalone durable URL imports

`startStudioImport(userId, input): Promise<StudioJobView>` is exported from the
same server barrel. `startStudioImportSchema` is strict (unknown fields fail):

```ts
type StartStudioImportInput = {
  url: string; // trimmed, absolute HTTP(S), at most 4096 chars, no URL credentials
  mode: 'audio' | 'video';
  quality?: 480 | 720 | 1080; // default 1080; video height ceiling, ignored for audio
  idempotencyKey?: string; // 1–200 chars, existing account-wide receipt semantics
};
```

The trusted actor supplies `userId`; clients cannot supply quota, destination,
project, snapshot, Art ID, process arguments, or a job kind here. Enqueue only
writes SQLite: no network/probe/download/bundle process runs in the web/MCP
request. Imports share the four-active-jobs limit and global heavy worker slot
with composition jobs. No project is required or created; project/snapshot and
revision/hash fields are null. `kind` is `import`; `engineId` is
`yt-dlp-pool-v1`, the import protocol identifier (not a frozen renderer bundle
or a promise that a remote URL's bytes cannot change before execution).

`StudioJobView.result` is now `StudioJobOutput | null`, a discriminated union of
the existing `StudioJobResult` (composition outputs) and:

```ts
interface StudioImportResult {
  kind: 'import';
  asset: {
    id: string; // owned pool Art ID
    kind: 'audio' | 'video';
    bytes: number; hash: string; mimeType: 'audio/mp4' | 'video/mp4';
    durationSec: number; hasAudio: boolean; hasVideo: boolean;
    poster: boolean;
  };
}
```

Discriminate on `result.kind` before reading composition `result.resource`.
Ordinary import start/status/cancel responses expose only this neutral asset
descriptor, never the imported title. This also applies to previously persisted
completion payloads containing a label. The title remains in owned pool metadata
and is available through explicit asset inspection; result artifact access and
publication ownership/hash checks are unchanged.
The import metadata describes actual normalized output bytes. Video is MP4
H.264 with optional AAC audio; silent video remains silent. Audio is M4A/AAC.
Video height is capped even for generic direct URLs. Posters use the existing
pool extractor and are best effort. Result does not contain a filesystem path
or inline preview. Existing authenticated pool routes/resources can resolve
`asset.id`; `getStudioJobArtifact` also accepts an owned completed import job
and rechecks its current pool ownership and file hash before returning its
server-only path. Job reads retain historical metadata; if the owner later
explicitly deletes the unused Art, artifact lookup returns `ASSET_NOT_FOUND`
instead of serving a stale path. Changed bytes return `RESULT_HASH_MISMATCH`.

Imports run through the same separate Node child, process-group termination,
lease heartbeat, three-attempt recovery, cancellation and scoped worker CLI.
The child reuses yt-dlp probe/download and pool probe/poster utilities. It never
inserts Art rows. Complete normalized bytes are moved from attempt staging to
an attempt-specific pool directory; only an unexpired current running attempt
can atomically insert the complete Art and mark its job done. Fresh
`media:upload` authorization and the role's pool quota are checked at enqueue,
execution and inside this publication transaction. A canceled/losing attempt
cannot expose an empty-path Art or duplicate logical result. Recovering/deleting
an import cleans abandoned permanent staging directories only when no owned
Art points into them. Attempt cleanup never removes another attempt's output.
Crashes between the move and the transaction therefore leave recoverable
private orphan bytes, not visible pool records.

Ordinary imports use the existing 100 MiB account pool quota; admins have no
account pool-byte ceiling. The technical budgets apply to both: 512 MiB final
media, a 20-minute attempt timeout, at most 2 hours of media, the existing
2048 MiB child heap, and a 2 GiB temporary-attempt disk budget checked every
second, including downloaded, normalized and staged copies. yt-dlp also gets
the execution-time remaining pool/output ceiling via `--max-filesize`, and
actual downloaded/final sizes are checked. Sampling permits transient disk
overshoot; it is not an OS quota. Encoded normalization beyond the duration
limit is stopped and rejected, never silently published as a truncated import.
Transient download failures use `IMPORT_FAILED`, retry after 1/2 seconds and
fail after attempt 3; no automatic yt-dlp self-update mutates a shared binary.
`POOL_QUOTA`, `IMPORT_DURATION_EXCEEDED`, `IMPORT_MEDIA_INVALID` and technical
budget/permission failures are terminal. Child error text does not expose
URLs, credentials, local paths or upstream stderr to callers.

Completed imported media belongs to the pool independently of job history.
`deleteStudioJob` retains its normal active/lease guard and, for imports,
returns `{deleted:true,id,preservedAssetId:string|null}`. It always preserves
an existing imported Art, used or unused, and removes attempt scratch/orphans.
Use explicit pool deletion to remove that Art; existing project/draft/history
reference guards still report `STUDIO_ASSET_IN_USE`. A deleted Art produces
`preservedAssetId:null`. Import media counts once in ordinary pool usage
(`Art.sizeBytes`, with the same poster accounting as existing pool uploads),
not again in `studio.resultBytes`; import job `outputBytes` is zero. Account
job guards and account pool-directory cleanup remain unchanged. There is no
relation to legacy `DownloadJob` records, whose services/UI remain available.

Test fixtures explicitly clear `YTDLP_PROXY` only in their own test/child
environment, serve generated media on loopback, use unique accounts and scoped
job IDs, and never change production `.env` or start an unscoped worker.
