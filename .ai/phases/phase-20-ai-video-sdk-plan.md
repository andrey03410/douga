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

- [ ] Write failing tests covering all approved feature families, compile the full module (not mocks): source-order vs display-order, inherited/local values, grid/arc/free layout, groups/answer-scene, card/video/crop/fit/offset/loop, all label phases, music/sfx/voice layers, geometry in all formats and >9 cards, unknown fields/types and nonfinite values, protected stable IDs, media-free extraction and preset application preserving content.
- [ ] Run `npx vitest run src/video`; expected missing SDK failure before implementation.
- [ ] Implement a practical recursively composable node/scene schema; ready-made top/picker blocks plus custom nodes with keyframes, timing and layers. Support dynamic source repetition so ranked participants are never hardcoded into fixed scene indexes. Include top and picker feature parity listed in Global Constraints.
- [ ] Generate built-in preset families for top classic/minimal/cinematic and picker classic/portrait/memory/arc/two-groups/three-groups/separate-answer in all three formats. Default picker skeleton is 30 rounds ×4 where appropriate; allow test/agent overrides for shorter content. Presets carry structure and generic placeholder slots, no media or thematic answers. Include schema-discoverable builders and examples usable by external agents.
- [ ] Run focused tests and `npx tsc --noEmit`; report exact failing pre-existing checks if any. Commit domain deliverable only.

### Task 2: Shared Remotion renderer

**Files:** Create `src/remotion/StudioVideo.tsx` and focused helpers if needed, modify `src/remotion/Root.tsx`; add rendering-boundary tests in `src/video/` or `src/integration/studio-render.test.ts`.

**Interfaces:** Consume actual Task 1 `CompiledVideo` and nodes/audio. Produce `StudioVideo({plan}: {plan:CompiledVideo})` and composition ID `Studio`. Asset refs in the passed plan are usable URLs (Player) or worker-prepared URLs (render); renderer does not read the database or mutate inputs.

- [ ] Write failing tests for frame evaluation of custom keyframes, appearance/answer phases, video synchronization and audio envelopes; run and observe failures.
- [ ] Implement visual primitives, cards/groups, text wrapping, timer, transforms/style/layers, custom nodes, transitions, backgrounds and all compiled audio cues. Respect crop/fit/start/loop and distinguish primary/voice/music/sfx with consistent volume envelopes.
- [ ] Register dynamic format/fps/duration metadata; use frame-driven animation and deterministic seed, not wall time.
- [ ] Run tests and TypeScript. Render a small real frame/MP4 via a temporary fixture after building the bundle; inspect output before claiming renderer completion.
- [ ] Commit renderer and evidence in task report.

### Task 3: Persistent studio services, source sync, assets, revisions and worker

**Files:** Modify `prisma/schema.prisma`, `src/server/{arts,users,tournaments}.ts` only as required for references/source events; create `src/server/studio/` modules, `scripts/studio-worker.ts`, integration tests and package worker script. Additive schema only; back up local DB before `prisma db push`.

**Interfaces:** Consume Task 1 SDK and Task 2 renderer. Export from `src/server/studio/index.ts`: `createStudioProject(userId,input)`, `listStudioProjects(userId)`, `getStudioProject(userId,id)`, `saveStudioDraft(userId,id,input)`, `commitStudioDraft(userId,id,input)`, `restoreStudioRevision(userId,id,input)`, `listStudioRevisions(userId,id)`, `listStudioPresets(userId)`, `saveStudioPreset(userId,input)`, `getStudioManifest(userId,document,mode)`, `startStudioJob(userId,projectId,input)`, `getStudioJob(userId,jobId)`, `cancelStudioJob(userId,jobId)`, `runStudioWorkerOnce(options?)`.
- Project view returns at least `{id,title,kind,revision,document,draft,validation,plan,sourceVersion}`; draft/commit inputs use `expectedRevision` and optional idempotency key. Jobs fix document+source revision+resolved plan+asset manifest, have type still/clip/audio/render, status/progress/result and cancellation.
- Choose and document exact service input/output types in `src/server/studio/types.ts` and SDK contract, then MCP/UI consume them. Use project/draft/revision/job asset reference records with Restrict semantics.

- [ ] Write failing DB tests for create/read ownership, arbitrary-object tops, draft validation/commit/rollback, CAS conflicts and idempotency, preset media stripping, asset deletion protection (including historical/draft bindings), automatic tournament reorder/add/remove retaining correct media/styles, missing source/media and frozen job snapshots. Observe RED.
- [ ] Add new studio tables; keep old project source models and data intact. Implement transactions, stable source binding, persistent source-change events or revision comparison that guarantees automatic current reads plus worker reconciliation. Account for simultaneous source and document edits.
- [ ] Resolve owned pool/track/builtin media with hashes and immutable imports, include usable metadata, generated standard sounds, resource URLs and durable references. Preserve old media import quota rules. Reject foreign/missing media and unsafe media paths atomically.
- [ ] Implement durable SQLite jobs with lease/heartbeat/retry/cancel and separate worker; build/cache versioned Remotion bundle, prepare per-job static assets, render still/clip/audio/full MP4, persist source/input hashes and exact revision. A queued job must not reread mutable head content.
- [ ] Verify tests, run additive schema setup and real worker rendering; record backup path without exposing credentials. Commit service deliverable and worker documentation.

### Task 4: MCP discovery, editing, inspection and rendering

**Files:** Create `src/mcp/studio-tools.ts`, modify `src/mcp/server.ts`, add `src/integration/studio-mcp.integration.test.ts` and exact protocol examples to SDK contract.

**Interfaces:** `registerStudioTools(server: McpServer, actor: Actor): void` uses Task 3 services. Namespace new tools `video_*`; preserve useful existing media/discovery tools, no old contract compatibility requirement. Server schemas are derived from SDK/service schemas, not independently maintained.

- [ ] Write a real stdio MCP client test that discovers schemas/presets/examples, creates a project, binds media, edits/validates/commits, gets explicit image/audio preview, starts/polls/cancels a job and checks permission denial/isolation/CAS/idempotent retry. Observe RED.
- [ ] Expose capabilities, document/schema/examples, preset catalog/save/apply, project list/create/read, draft replace/semantic patch/validate/commit/restore/history, asset inspection/import access, still/clip/audio preview, final render/job status/cancel.
- [ ] Return structured diagnostics and paginated collections. Inspection returns real image/audio resource content when requested; clips use accessible resources/links. Ordinary output is neutral and does not auto-display project content. Include client limitation and current supported API/protocol info.
- [ ] Recheck role fresh for mutations/render. Do not use stale cached role to bypass permissions or leak another user's absolute media paths.
- [ ] Run MCP tests and TypeScript; commit adapter and docs.

### Task 5: Authenticated SDK website and preview parity

**Files:** Create `src/app/studio/[id]/page.tsx`, editor components, `src/app/api/studio/` routes using Task 3 services; modify project listing/navigation and tournament results/render entry links as needed; personal preset browsing. New creation flows point users to external MCP/code; preserve access to existing old projects.

**Interfaces:** All routes call the same services as MCP. JSON editor supports draft/save/validate/commit with revision conflict handling; preview consumes Task 1 plan and Task 2 StudioVideo. Media/result URLs enforce owner access and support Range. UI does not maintain a competing visual settings model.

- [ ] Write focused route/service tests for auth, CAS, malformed JSON, last-good-preview behavior and media Range. Observe RED.
- [ ] Build readable Russian SDK workspace: code editing, diagnostics linked to node/field, explicit preview reveal, asset browsing/inspection, versions/diff/restore, preset save/catalog and job status/cancel/download. Keep surprise preview hidden until requested.
- [ ] Integrate existing pool/discovery entry points without breaking tournament/manual-top sources. New project listing clearly exposes SDK projects and sample MCP commands; no built-in agent/chat.
- [ ] Run tests, TypeScript and production build. Check the running site through CUA: project listing, edit/invalid draft/conflict, preview, presets, revisions and job result. Fix usability issues found against this workflow.
- [ ] Commit UI deliverable with actual browser evidence in task report.

### Task 6: End-to-end acceptance, regression repairs and handoff

**Files:** Add `scripts/verify-studio.mjs` and integration acceptance fixtures/tests as needed; update README/CLAUDE.md and `.ai/phases/phase-20-verification.md` with real evidence.

**Interfaces:** Exercise public MCP/API/UI and real worker, not private mocks; keep disposable test data separate from the user's existing projects. Use generated image/video/audio fixtures and short scenes so checks are reproducible.

- [ ] Establish and repair pre-existing baseline failures with minimal reproducible tests: canonical macOS temp paths, concurrent file-size backfill deletion race, localhost yt-dlp fixture proxy handling. Document their initial failures separately.
- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`. All meaningful new scenario tests must run; do not silence/skip failures to obtain a green summary.
- [ ] Create/inspect/render real top and picker variants across wide/vertical/square; single/group/memory/portrait/arc/separate-answer; verify duration, dimensions, representative frame pixels, captions, nonblack content, sound and scene/audio timing. Save reviewable artifacts in ignored storage.
- [ ] Through the user's open browser or a visible app browser, verify SDK project creation via MCP, source edits auto-sync, code edit/validation, explicit preview, personal preset save/reuse, history restore, completed MP4 and download/playback. Preserve existing user data.
- [ ] Dispatch fresh whole-branch review, fix material findings with regression tests, rerun affected checks and required final suite/build. Commit all feature work on `codex/ai-video-sdk`; keep main untouched and present branch, tests, artifacts and any remaining concrete limitations for manual review.
