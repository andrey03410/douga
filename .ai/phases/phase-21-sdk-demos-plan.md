# SDK visual demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Deliver three varied real SDK videos, extending safe paint controls where needed.
**Architecture:** Optional structured gradient/shadow in CardStyle; schema validates, compiler/presets carry fields, StudioVideo renders them. Public MCP handles all demo asset/project/job operations.
**Tech Stack:** Existing TypeScript/Zod/Remotion/Next/Prisma/MCP, no new dependencies.
**Spec:** `.ai/specs/26-sdk-visual-demos.md`.

## Global Constraints
- Continue codex/ai-video-sdk from a64e98b, no main merge/push.
- Keep previous projects and credentials untouched; artifacts under ignored storage/sdk-demos-20261027.
- Strict finite bounded data; no arbitrary CSS/URL paint or executed JS.
- No global worker while integration tests run; exact scoped job workers for demo renders.

## Review Focus
- Gradient stops must reject URLs, unsorted/out-of-range/empty stops: task1 schema tests.
- Missing paint fields must preserve old output: task1 defaults and full suite.
- Paint must survive preset extraction/application: task1 compiler/preset assertions.
- Actual renderer must use both linear and radial gradients and shadow: task1 real pixels.
- Group2 contains24 distinct avatars and group3 characters belong to their anime: task2 discovery manifest plus real frames.

## Task1: Safe paint styles
**Files:** src/video/types.ts, src/video/schema.ts, src/remotion/studio-paint.ts, src/remotion/StudioVideo.tsx; tests src/video/paint.test.ts and src/integration/studio-paint-render.test.ts.
**Interfaces:** gradientToCss(gradient) and shadowToCss(shadow); optional gradient/shadow on CardStyle.
- [x] Write schema/compile/preset and actual render assertions; observe RED.
- [x] Implement bounded strict paint schemas and types; use helpers in shared renderer, preserve default answer glow.
- [x] Run focused tests/tsc, commit; full suite and fresh build after demo completion before final handoff.

## Task2: Three real demos and final verification
**Files:** ignored storage/sdk-demos-20261027 scripts/documents/media/proofs; permanent contract26 plus SDK contract22 updates and evidence doc.
- [x] Discover/import real Shikimori media through MCP, synthesize three original sound designs and import them.
- [x] Author three documents with structural assertions; create/validate through MCP.
- [x] Render all three through real scoped workers; inspect early/middle/final frames and decoded audio; correct any defects.
- [x] Build and check live site, download/playback demo results; keep user-facing tabs.
- [x] Run npm test/tsc/build, fresh review of a64e98b..newhead, address material findings, commit evidence and leave branch for manual review.
