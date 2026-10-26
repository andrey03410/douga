# Authenticated Studio website and HTTP adapter (Task 7)

Implemented 2026-10-26. All endpoints below are under `/api/studio` and use the
current web session's database ID. Fresh authorization/ownership remains in the
same Studio services as MCP. Client actor/email/path overrides are not accepted.
Mutations reject a foreign `Origin` header using the validated browser-facing
authority (`x-forwarded-host`, then `Host`) and protocol (`x-forwarded-proto`,
then the request protocol). NextRequest normalizes loopback URL hostnames, so
the internal request URL alone is not authoritative. Deployment proxies must
replace forwarding headers with their trusted public origin. Ambiguous lists
and malformed forwarding values fail closed. JSON errors and successful metadata
use `Cache-Control: private, no-store`.

## Pages and surprise boundary

- `/projects`: paginated neutral SDK summaries, external MCP setup with the
  current authenticated email, and existing legacy projects.
- `/studio/new`: explicit JSON creation with shared SDK top/picker examples.
  `?sourceId=<owned-tournament-id>` attaches the top example to that source.
  The tournament results action finalizes/persists the currently displayed top-N
  before navigating, including the first completion of comparison ranking.
- `/studio/<id>`: neutral initial status. Code, diagnostics, history content,
  asset inspection, Player and job-result media require explicit reveal.

`Открыть SDK` fetches the document. Background polling retains dirty local text
and its original `baseVersion`; another writer marks a conflict and cannot
silently move the local CAS token. Clean buffers may refresh. Explicit reload
replaces the buffer; comparison never does. Commit/restore/preset/enqueue
acknowledgements also preserve text typed while those requests are pending,
retaining its original CAS token and marking a conflict on a changed version.
Saving writes a draft and validates;
commit creates a revision. Preview is the retained successful plan with its
`previewVersion`/`previewRevision`, and is labeled stale for dirty/invalid code.
Preview does not autoplay and is loaded in a separate client chunk. It consumes
the shared `StudioVideo` renderer directly.

## Endpoints

| Method and path | Input / result |
|---|---|
| `GET /projects` | `limit,cursor` → bounded neutral project summaries |
| `POST /projects` | shared create-document or create-from-preset schema → project |
| `GET /projects/:id` | neutral `studioProjectMetadata` |
| `GET /projects/:id?content=code` | explicit full `StudioProjectView` |
| `GET /projects/:id?content=preview` | explicit plan + neutral metadata |
| `PUT /projects/:id/draft` | `saveStudioDraftSchema` → project |
| `POST /projects/:id/commit` | `commitStudioDraftSchema` → project |
| `POST /projects/:id/restore` | `restoreStudioRevisionSchema` → project |
| `POST /projects/:id/preset` | `applyStudioPresetSchema` → project |
| `DELETE /projects/:id` | `deleteStudioResourceSchema` → deletion receipt |
| `GET /projects/:id/history` | `limit,cursor` → neutral revision summaries |
| `GET /projects/:id/history/:revision` | explicit historical document |
| `DELETE /projects/:id/history/:revision` | expectedVersion / deletion schema |
| `GET /projects/:id/snapshots` | `limit,cursor` → neutral snapshot/revision/job counts |
| `DELETE /snapshots/:id` | release owned standalone snapshot; jobs prevent release |
| `GET /projects/:id/jobs` | `limit,cursor` → owned durable job views |
| `POST /projects/:id/jobs` | `startStudioJobSchema` → queued view, HTTP 202 |
| `GET /jobs/:id` | neutral job state/result descriptors |
| `POST /jobs/:id/cancel` | shared cancellation service |
| `DELETE /jobs/:id` | shared terminal-job cleanup service |
| `GET,HEAD /jobs/:id/result` | verified owned artifact, streamed with Range |
| `GET,HEAD /jobs/:id/result?download=1` | same, with attachment disposition |
| `GET /presets` | `limit,cursor` → built-in/personal catalog summaries |
| `GET /presets/:id` | explicit canonical preset, no catalog-only `personal` |
| `POST /presets` | shared `saveStudioPresetSchema` |
| `DELETE /presets/:id` | delete owned personal preset |
| `GET /sources` | `limit,cursor` → owned source summaries |
| `GET /sources/:id` | explicit source ranking/binding identities |
| `GET /assets` | pool metadata with `q,limit,cursor`, no inline media |
| `GET /assets/:id` | explicit inspection metadata, no binary payload |
| `GET,HEAD /media?path=...` | exact owned persisted file-ledger/poster membership |
| `GET,HEAD /builtin/:name` | authenticated `tick`, `reveal`, `answer` WAV |

The normal shared mutation DTO includes document/plan content because the
caller explicitly edits or creates that content. Initial and polling UI reads
are neutral until the author opens SDK. Schemas remain strict; Zod field issues
are returned with HTTP 400; malformed transport JSON returns `MALFORMED_JSON`.
CAS conflicts are HTTP 409, invalid commit validation HTTP 422, foreign/missing
resources HTTP 404 and insufficient role HTTP 403. Generic internal errors do
not serialize private filesystem paths or exception details.

## Streaming, lifecycle and worker

Results stream from `getStudioJobArtifact` after fresh owner access, safe-file
resolution and hash verification. There is no MCP 12-MiB cap on HTTP streaming.
A file-size header and byte-range response do not require whole-file buffering.
Single closed/open/suffix ranges return 206; malformed, unsatisfiable and
multiple ranges return 416. HEAD sends headers without a file stream. Streams
use backpressure and close on request abort. File responses are private/no-store.

The media path is never authorized by its textual prefix. SQL first filters
owned persisted revision/snapshot JSON candidates; the adapter then checks the
exact files/poster ledger entry and resolves the real path within safe storage.
Owned pool posters are checked against their row. Built-in generation accepts
only the three declared names after current actor authorization.

Queue mutations never execute a worker. Start `npm run studio:worker` separately;
final rendering stays subject to the shared fresh admin permission. UI results
are revealed explicitly. The loaded job-window size is independent of page
cursors. Polling re-reads the whole loaded window and replaces its rows
authoritatively, including external deletions and older job status changes.
Cancel/delete/snapshot/history/project guards come
from the shared services, including frozen revision protection.

Legacy single media/tournament deletion maps Studio reference protection to
an actionable HTTP 409. Bulk cleanup returns per-file protected reasons/messages
with successful deletions retained; the shared pool UI applies the partial
success and retains failed selection. Account deletion maps `JOB_IN_USE` to 409
with cancellation/worker-stop/job-deletion guidance.
