# Durable Studio composition jobs (Task 4)

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
 kind:'still'|'clip'|'audio'|'render';
 status:'queued'|'running'|'done'|'failed'|'canceled';
 progress:number; attempts:number; error:string|null;
 revision:number|null; revisionId:string|null; snapshotHash:string|null;
 engineId:string;
 result:StudioJobResult|null;
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
already protected by the snapshot FK. Account deletion is also blocked while
any Studio job record remains; cancel/delete jobs first. Input pool/source
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
active-snippet expansion and compilation. Excessive repetition returns
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
After a hard kill, leases recover from SQLite. There is no in-process render
promise required for durability.

`StudioJob` owns `userId` directly, with nullable project/snapshot FKs. Current
composition service requires both. Task 5 can add an `import` input/result and
worker dispatch branch in this same queue, with no project requirement. It
must preserve lease fencing, account authorization, scoped claims, quotas and
private result boundaries. This task does not implement imports.
