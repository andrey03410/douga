# AI Video SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track steps with checkboxes.

**Goal:** Ship the approved agent-first top/picker video generator, preserving the existing creation capabilities and adding flexible SDK scenes, presets, previews, revisions, source sync and autonomous rendering.

**Architecture:** A versioned JSON document and TypeScript builder compile into one deterministic scene/audio plan consumed by a shared Remotion renderer. Additive Prisma models persist studio projects, revisions, drafts, asset references, presets and durable jobs; authenticated services power both stdio MCP and the code/preview website. Old projects remain readable and are not migrated or deleted.

**Tech Stack:** Existing Next.js 14 / React 18 / TypeScript / Prisma 5 SQLite / Zod / Remotion 4.0.475 / ffmpeg / Vitest. Use existing dependencies unless a concrete requirement needs one.

**Spec:** `.ai/specs/20-ai-video-product.md`, `.ai/specs/21-ai-video-technical-discussion.md` (all decisions approved).

## Global Constraints

- Branch `codex/ai-video-sdk` starts at main commit `69c05a0`; do not merge or push. The user will review manually.
- Keep project AI documents under `.ai/` (CLAUDE.md).
- Entry points are top and picker; editing is SDK JSON / external MCP, no in-app AI chat or new visual settings forms.
- JSON is the canonical document; TypeScript builders emit it. Developer-registered blocks enable new effects; do not execute arbitrary project JS/TSX on the server.
- Presets contain no actual media bindings, participant identities, specific questions or answers. Include personal and built-in presets.
- Source ranking updates automatically. Bind styling/media by stable participant ID; preserve previous versions and frozen render inputs. Editing never automatically restarts final rendering.
- Preserve picker single/groups, portrait/landscape cards, reveal/hide, label modes, countdown/tick, optional card/group answers, intro/outro, video sound, offsets/crop/fit/loop, playlists/crossfade and round overrides. Preserve top ordering, labels, manual/full/active snippets, separate audio and footage, crop, offsets and bookends; allow no-audio objects.
- Three output formats: 1920×1080, 1080×1920, 1080×1080 at default 30 FPS. No inherited 9-card/50-round product cap.
- Permissions and quotas apply to MCP and API; final rendering remains admin-only. Asset ownership and source ownership must be checked. Protect assets used by drafts, revisions and jobs.
- Ordinary responses must not auto-open spoiler previews. Inspection is explicit; report external-client modality/display limitations accurately.
- One renderer/plan for Player, stills, clips and final MP4. Use H.264/AAC. Jobs survive app restarts, support cancellation and identify their frozen revision.
- Follow TDD for new behavior; never claim parity from types or unit tests alone. Run full suite, production build, real MCP, browser interactions and real MP4 inspections.

## Review Focus

- Ranking reorder plus addition/removal must preserve the correct participant's media and local overrides, never positional assignment.
- A source change or concurrent SDK save during a render must neither overwrite newer work nor change that job's frozen inputs.
- Portrait/square layouts, many cards, long Cyrillic captions and short video loops must not produce missing content or accidental black intervals.
- Missing/wrong-owner media, invalid nested values, stale revisions and replayed mutation requests must fail atomically with actionable diagnostics.
- Preset extraction and media deletion must not leak user content or destroy assets required by a historical revision.

## File Structure

- `src/video/`: public, browser-safe domain SDK, focused schema/types, builders, compiler/layout/timeline, patches, presets, validation and unit tests; barrel `index.ts`.
- `src/remotion/StudioVideo.tsx`: plan interpreter with scoped helpers; `Root.tsx` adds `Studio` composition.
- `src/server/studio/`: persistence/services, manifests/source sync/presets, jobs and worker rendering.
- `src/mcp/studio-tools.ts`: MCP adapter, discovery and typed results.
- `src/app/api/studio/`: authenticated thin endpoints; `src/app/studio/`: SDK editor, preview, revisions, presets/jobs.
- `src/integration/studio*.test.ts`: real DB/MCP/service tests; `scripts/studio-worker.ts`, `scripts/verify-studio.mjs`: worker entry and repeatable real render acceptance.

### Task 1: Domain SDK, compiler and media-free presets

**Files:** Create `src/video/{schema,types,builders,compiler,layout,presets,patches,index}.ts` and meaningful `*.test.ts`; smaller adjacent modules are allowed for cohesive responsibilities. Add SDK documentation/examples in `.ai/specs/22-ai-video-sdk-contract.md` with exact emitted JSON.

**Interfaces:**
- Produce exported `VideoDocument`, `VideoPreset`, `AssetManifest`, `ResolvedAsset`, `CompiledVideo`, `Diagnostic`, `CompileResult` types.
- `parseVideoDocument(input: unknown): VideoDocument`; `compileVideo(document: VideoDocument, manifest?: AssetManifest): CompileResult` where result has `{plan, diagnostics, ready}`. Plan is fully serializable, has `width,height,fps,durationInFrames,scenes`, resolved nodes and timed audio; no functions or fetching.
- `createVideoDocument(options): VideoDocument`, `getBuiltinPresets(): VideoPreset[]`, `getBuiltinPreset(id): VideoPreset | undefined`, `extractVideoPreset(document, metadata): VideoPreset`, `applyVideoPreset(document,preset): VideoDocument`, `patchVideoDocument(document,operations): VideoDocument`.
- `ResolvedAsset` includes `id,kind,src,durationSec?,hasAudio?,posterSrc?,width?,height?,hash?`; manifest resolves document's media keys. Bindings support pool art, owned tournament track and standard built-in sounds.
- Lock exact additional shape names in schema and contract documentation before reporting; later tasks consume those actual types instead of inventing another model.

- [x] Write failing tests covering all approved feature families, compile the full module (not mocks): source-order vs display-order, inherited/local values, grid/arc/free layout, groups/answer-scene, card/video/crop/fit/offset/loop, all label phases, music/sfx/voice layers, geometry in all formats and >9 cards, unknown fields/types and nonfinite values, protected stable IDs, media-free extraction and preset application preserving content.
- [x] Run `npx vitest run src/video`; expected missing SDK failure before implementation.
- [x] Implement a practical recursively composable node/scene schema; ready-made top/picker blocks plus custom nodes with keyframes, timing and layers. Support dynamic source repetition so ranked participants are never hardcoded into fixed scene indexes. Include top and picker feature parity listed in Global Constraints.
- [x] Generate built-in preset families for top classic/minimal/cinematic and picker classic/portrait/memory/arc/two-groups/three-groups/separate-answer in all three formats. Default picker skeleton is 30 rounds ×4 where appropriate; allow test/agent overrides for shorter content. Presets carry structure and generic placeholder slots, no media or thematic answers. Include schema-discoverable builders and examples usable by external agents.
- [x] Run focused tests and `npx tsc --noEmit`; report exact failing pre-existing checks if any. Commit domain deliverable only.

### Task 2: Shared Remotion renderer

**Files:** Create `src/remotion/StudioVideo.tsx` and focused helpers if needed, modify `src/remotion/Root.tsx`; add rendering-boundary tests in `src/video/` or `src/integration/studio-render.test.ts`. A bounded parity correction in `src/video/blocks.ts` / layout and its regression tests is included for equal automatic card sizes in asymmetric groups.

**Interfaces:** Consume actual Task 1 `CompiledVideo` and nodes/audio. Produce `StudioVideo({plan}: {plan:CompiledVideo})` and composition ID `Studio`. Asset refs in the passed plan are usable URLs (Player) or worker-prepared URLs (render); renderer does not read the database or mutate inputs.

- [x] Write failing tests for frame evaluation of custom keyframes, appearance/answer phases, video synchronization and audio envelopes; run and observe failures.
- [x] Add regression coverage for one automatic card size across asymmetric grouped rounds, in all formats/orientations; preserve intentional explicit free-layout/group exceptions and fix the compiler geometry if needed.
- [x] Implement visual primitives, cards/groups, text wrapping, timer, transforms/style/layers, custom nodes, transitions, backgrounds and all compiled audio cues. Respect crop/fit/start/loop and distinguish primary/voice/music/sfx with consistent volume envelopes.
- [x] Register dynamic format/fps/duration metadata; use frame-driven animation and deterministic seed, not wall time.
- [x] Run tests and TypeScript. Render a small real frame/MP4 via a temporary fixture after building the bundle; inspect output before claiming renderer completion.
- [x] Commit renderer and evidence in task report.

### Task 3: Persistent projects, source sync, assets, drafts and history

**Files:** Additive `prisma/schema.prisma` models; `src/server/studio/{types,projects,revisions,assets,sources,presets,errors,index}.ts` (split focused modules as needed); relevant arts/users/tournaments/domain-usage updates; `src/integration/studio-projects.integration.test.ts` and domain caption regressions. Back up local DB before schema push. Read `task-3-handoff.md` for concrete existing-code hazards.

**Interfaces:** Consume Task1 document/compiler and Task2 renderer contract. Export from `src/server/studio/index.ts`: `createStudioProject(userId,input)`, `listStudioProjects(userId)`, `getStudioProject(userId,id)`, `saveStudioDraft(userId,id,input)`, `commitStudioDraft(userId,id,input)`, `restoreStudioRevision(userId,id,input)`, `listStudioRevisions(userId,id)`, `listStudioPresets(userId)`, `saveStudioPreset(userId,input)`, `getStudioManifest(userId,document,mode)`, `freezeStudioProject(userId,id,input?)` and owner-checked deletion of projects/presets/old revisions.
- Project view includes `{id,title,kind,revision,document,draft,validation,plan,sourceVersion}`; exact DTOs/input schemas are documented in service types and SDK contract before downstream implementation.
- CAS covers draft saves, commits and source updates; mutations accept idempotency keys. `freezeStudioProject` returns an immutable, owned, validated revision snapshot with resolved plan and copied/hashed media manifest for Task4; requested invalid/current drafts do not silently render a different version.

- [x] Write failing real-DB tests for create/read/ownership, arbitrary-object tops, invalid draft retention/last-good preview, draft and commit CAS, idempotency replay/conflicts, rollback, media-free personal presets, asset deletion protection and source reorder/add/remove with per-ID media/captions/settings retained. Observe RED.
- [x] Add optional participant `caption` separate from source `label`, use it in standard cards/top below closer card-label overrides, and retain it across source updates; cover domain and service regressions RED→GREEN. Complete approved event-relative audio cue anchors and media-free preset sound-rule preservation (see handoff); existing absolute cues remain valid.
- [x] Implement additive tables, typed services, transactions, stable source binding and automatic synchronization using actual ranking/topSize hashes (reorder does not update tournament timestamp). Preserve old projects/data. Persist source snapshots/history and mark stale verification/last-good previews accurately.
- [x] Resolve owned pool/track/builtin media and fonts/runtime metadata; preserve immutable file bytes with content hashes; implement actual absent-active-window RMS resolution using existing utilities. Protect draft/revision references before filesystem deletion; integrate usage counts/account information and safe lifecycle release. Include owner-checked cleanup/old-version deletion without deleting current/last-good state.
- [x] Run focused tests, TypeScript and full suite once. Generate client/apply only additive schema after backup; document exact exports and snapshot/static-asset conventions. Commit service deliverable and detailed report.

### Task 4: Durable preview and render worker

**Files:** Additive studio-job models in `prisma/schema.prisma`; `src/server/studio/{jobs,worker,render,types,index}.ts` or adjacent focused modules; `scripts/studio-worker.ts`; package worker script; `src/integration/studio-jobs.integration.test.ts`.

**Interfaces:** Consume Task3 frozen revision/manifests and Task2 `StudioVideo`/Studio composition. Export `startStudioJob(userId,projectId,input)`, `getStudioJob(userId,jobId)`, `cancelStudioJob(userId,jobId)`, `deleteStudioJob(userId,jobId)`, `runStudioWorkerOnce(options?:{jobId?:string;workerId?:string})` from the service barrel. This task implements composition still/clip/audio/render jobs; the same queue/worker is extended by Task5 for standalone durable URL imports; exact discriminated inputs/results are documented before Task5. Freeze at enqueue; no mutable-head reread at worker start.

- [ ] Write failing DB tests for frozen inputs across source/document changes, one claim per job, leases/recovery/retry, idempotent enqueue, cancellation, permission/ownership/quota, preview budgets vs final admin render, protected artifacts and safe cleanup. Test workers scope themselves to their own generated job ID. Observe RED.
- [ ] Implement separate Node worker with durable SQLite queue, lease/heartbeat, bounded retry/resource budgets, status/progress and cancellation. Default one heavy render at a time. Source reconciliation can run in the worker and on current-project reads.
- [ ] Prepare immutable per-job static assets, build/cache versioned Remotion bundle with existing @ alias, render still/short clip/audio/full MP4 via the common plan. Static mode rewrites all visual/audio/poster sources to copied publicDir-relative paths. Return authenticated resource metadata and exact revision/hash. Preview jobs are available to authors under limited duration/resolution; final render checks fresh admin role.
- [ ] Integrate job-aware revision/project/asset deletion guards and user usage/results. Preserve actual bytes for historical rerendering; canceled output must never later become done. Inspect real frame and MP4 through actual worker execution.
- [ ] Run focused job tests, TypeScript and full suite once; commit worker, script and docs with detailed evidence/report.

### Task 5: Durable media imports through the shared worker

**Files:** `src/server/studio/{imports,jobs,worker,types,index}.ts` or focused adjacent modules; additive job/asset relations in `prisma/schema.prisma` if required; reuse `src/lib/ytdlp.ts`, `src/server/arts.ts` and existing upload/import quota utilities. `src/integration/studio-imports.integration.test.ts`; update the actual job contract.

**Interfaces:** Add `startStudioImport(userId,input)` for `{url,mode:'audio'|'video',quality?,idempotencyKey?}`; standalone import jobs use the same status/cancel/delete/worker contract as Task4. They do not require an existing video project. Successful result identifies an owned pool asset with media metadata. Small synchronous local/image imports may keep existing services; long new SDK URL imports are durable rather than delegated to the legacy in-process DownloadJob runner.

- [ ] Write RED real-DB/loopback-yt-dlp tests for enqueue without execution, scoped worker import, ownership/fresh roles/pool quota, idempotent replay and conflicting payload, cancellation, recovery/retry and exactly one imported pool result. Test fixtures explicitly disable configured YTDLP_PROXY only for loopback calls.
- [ ] Extend the shared durable queue/worker with URL imports, fresh permissions and quota at execution/publication, process cancellation/lease loss and bounded retry. Reuse probe/download/normalization/pool utilities. Do not execute imports in the web/MCP process or let a losing/canceled attempt publish an unexpected duplicate asset. Existing user DownloadJob records remain untouched.
- [ ] Verify actual downloaded bytes/streams and restart-safe queued state. Integrate safe result cleanup/account usage while preserving an imported asset that is now used by a project; report protected references clearly.
- [ ] Run covering import/queue/quota tests, TypeScript and full suite once; commit and document exact schemas/results for MCP/UI consumers. Controller owns subsequent task-scoped review.

### Task 6: MCP discovery, editing, inspection and rendering

**Files:** Create `src/mcp/studio-tools.ts`, modify `src/mcp/server.ts`, add `src/integration/studio-mcp.integration.test.ts` and exact protocol examples to SDK contract.

**Interfaces:** `registerStudioTools(server: McpServer, actor: Actor): void` uses Task 3 project services and Task 4 jobs. Namespace new tools `video_*`; preserve useful existing media/discovery tools, no old contract compatibility requirement. Server schemas are derived from SDK/service schemas, not independently maintained.

- [ ] Write a real stdio MCP client test that discovers schemas/presets/examples, creates a project, binds media, edits/validates/commits, gets explicit image/audio preview, starts/polls/cancels a job and checks permission denial/isolation/CAS/idempotent retry. Observe RED.
- [ ] Expose capabilities, document/schema/examples, preset catalog/save/apply, project list/create/read, draft replace/semantic patch/validate/commit/restore/history, asset inspection/import access, still/clip/audio preview, final render/job status/cancel.
- [ ] Return structured diagnostics and paginated collections. Inspection returns real image/audio resource content when requested; clips use accessible resources/links. Ordinary output is neutral and does not auto-display project content. Include client limitation and current supported API/protocol info.
- [ ] Recheck role fresh for mutations/render. Do not use stale cached role to bypass permissions or leak another user's absolute media paths.
- [ ] Run MCP tests and TypeScript; commit adapter and docs.

### Task 7: Authenticated SDK website and preview parity

**Files:** Create `src/app/studio/[id]/page.tsx`, editor components, `src/app/api/studio/` routes using Task 3 services; modify project listing/navigation and tournament results/render entry links as needed; personal preset browsing. New creation flows point users to external MCP/code; preserve access to existing old projects.

**Interfaces:** All routes call the same Task3/Task4 services as MCP. JSON editor supports draft/save/validate/commit with revision conflict handling; preview consumes Task 1 plan and Task 2 StudioVideo. Media/result URLs enforce owner access and support Range. UI does not maintain a competing visual settings model.

- [ ] Write focused route/service tests for auth, CAS, malformed JSON, last-good-preview behavior and media Range. Observe RED.
- [ ] Build readable Russian SDK workspace: code editing, diagnostics linked to node/field, explicit preview reveal, asset browsing/inspection, versions/diff/restore, preset save/catalog and job status/cancel/download. Keep surprise preview hidden until requested.
- [ ] Integrate existing pool/discovery entry points without breaking tournament/manual-top sources. New project listing clearly exposes SDK projects and sample MCP commands; no built-in agent/chat.
- [ ] Run tests, TypeScript and production build. Check the running site through CUA: project listing, edit/invalid draft/conflict, preview, presets, revisions and job result. Fix usability issues found against this workflow.
- [ ] Commit UI deliverable with actual browser evidence in task report.

### Task 8: End-to-end acceptance, regression repairs and handoff

**Files:** Add `scripts/verify-studio.mjs` and integration acceptance fixtures/tests as needed; update README/CLAUDE.md and `.ai/phases/phase-20-verification.md` with real evidence.

**Interfaces:** Exercise public MCP/API/UI and real worker, not private mocks; keep disposable test data separate from the user's existing projects. Use generated image/video/audio fixtures and short scenes so checks are reproducible.

- [x] Establish and repair pre-existing baseline failures with minimal reproducible tests: canonical macOS temp paths, concurrent file-size backfill deletion race, localhost yt-dlp fixture proxy handling. Document their initial failures separately.
- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`. All meaningful new scenario tests must run; do not silence/skip failures to obtain a green summary.
- [ ] Create/inspect/render real top and picker variants across wide/vertical/square; single/group/memory/portrait/arc/separate-answer; verify duration, dimensions, representative frame pixels, captions, nonblack content, sound and scene/audio timing. Save reviewable artifacts in ignored storage.
- [ ] Through the user's open browser or a visible app browser, verify SDK project creation via MCP, source edits auto-sync, code edit/validation, explicit preview, personal preset save/reuse, history restore, completed MP4 and download/playback. Preserve existing user data.
- [ ] Dispatch fresh whole-branch review, fix material findings with regression tests, rerun affected checks and required final suite/build. Commit all feature work on `codex/ai-video-sdk`; keep main untouched and present branch, tests, artifacts and any remaining concrete limitations for manual review.
