# Task 2 — shared Remotion renderer

Completed on `codex/ai-video-sdk`, starting from reviewed domain commit `5934773`.

## Delivered

- `src/remotion/StudioVideo.tsx` consumes the actual serializable `CompiledVideo`; no database, server execution, document JavaScript or input mutation.
- Dynamic `Studio` composition metadata uses plan width/height/fps/duration. Existing Top/Picker compositions remain registered.
- All compiled visual kinds: container, text, shape (rect/ellipse/SVG path), image/video, card, timer, group. Scene backgrounds, scene-local visibility/labels/answers, node-local keyframes and easing, hierarchy visibility/opacity/transforms, relative child positioning from already-absolute IR rectangles, layers, countdowns, card/group answer glow/scale/loser dimming, transition fades/slides, wrapping and bounded caption sizing.
- Muted footage with source offset, available-segment loop, active-card poster/final frame, separate-answer held frame and straight-video source-tail hold. A real render found Remotion's late-scene Freeze timeline clamp: use `Freeze(frame=0)` plus the exact source trim instead of freezing a large source frame on the output timeline.
- All compiled primary/music/sfx/voice cues share the same volume/fade/mute envelope. Music additionally ducks in composition-absolute policy windows. Offset loops do not reset the envelope. Tick/playlist scheduling remains the compiler's responsibility; every emitted cue is rendered.
- Controller-authorized bounded compiler parity extension: default asymmetric group cards share one size after automatic layout. Explicit group layout/orientation and global free layouts retain authored geometry. This changes resolved rectangles only, without a new public contract.

## RED / GREEN evidence

Read the TDD skill and its `writing-good-tests.md` reference first.

1. `npx vitest run src/remotion/studio-frame.test.ts`
   - Initial missing-module result, then loadable no-op boundaries: **18 assertion failures** (14:55 UTC/local tool clock). No-op implementations were replaced only after observing those failures.
   - Added separate-answer loop hold regression: RED (`answerCardFrames` missing), then GREEN.
   - Real frame inspection found long Cyrillic caption overflow; added fitting regression: RED (`fitTextSize` missing), then GREEN. Short captions keep their requested size.
   - Added answer winner scale/loser dim regression: RED missing `opacity:0.25`, then GREEN.
   - Final focused file: **21 passed**.
2. `npx vitest run src/integration/studio-render.test.ts`
   - Initial fixture publicDir/outDir nesting error was corrected in test setup.
   - Real late-scene still RED: expected blue source frame 25 but blue channel was 0 (red output-local frame 1).
   - After the Freeze/source trim correction, the pixel assertion passed.
   - AAC RMS assertions were placed in the steady interiors of their windows, avoiding encoding/transition edges. Final test verifies late source offset pixels, offset-segment loop restart pixels, nonblack held tail pixels, decoded 880 Hz selected source segment (discarded prefix 220 Hz), continuous loop envelope, quarter-volume duck, mute and cue end silence.
   - Final focused run: **1 passed**, real bundle + two stills + H.264/AAC MP4 + decoded pixels/audio (11.12 s).
3. `npx vitest run src/video/group-render-geometry.test.ts`
   - RED: **5 failed, 2 passed**. Independent panel sizing enlarged the two-card group's cards in five format/orientation combinations; vertical portrait already had equal sizes. Explicit group override case already passed.
   - After bounded compiler fix: **7 passed** (wide/vertical/square × landscape/portrait, equal dimensions and bounds, explicit free/orientation exceptions).
4. `npx vitest run src/video src/remotion/studio-frame.test.ts`
   - **4 files, 91 tests passed**.
5. `npx tsc --noEmit`
   - **Exit 0**, including the final renderer/integration/geometry files.
6. `npm test > storage/studio-renderer-proof/full-test.log 2>&1`
   - **52 files, 768 tests passed**, 85.15 s. No failing tests were omitted or skipped. Includes the real renderer integration regression (13.51 s in the full run).
7. `git diff --check`
   - **Exit 0**.

## Real render artifacts and exact commands

Review artifacts are ignored under the absolute directory:
`/Users/gel/my_projects/tournament-bracket-video/storage/studio-renderer-proof/`.
Only copied/generated review-user media were used; original user files were not changed.

Standalone fixture and repeatable render command (no application server):

```sh
npx tsx --env-file=.env storage/studio-renderer-proof/render.ts > storage/studio-renderer-proof/render.log 2>&1
```

The saved script compiles real SDK documents, bundles `src/remotion/index.ts` with `@` aliased to `resolve('src')`, uses sibling `public/` and `bundle/` directories, selects composition `Studio`, calls `renderStill` and `renderMedia({codec:'h264',audioCodec:'aac',concurrency:2})`. It uses the existing `REMOTION_BROWSER_EXECUTABLE` setting. It is a disposable local fixture, while `src/integration/studio-render.test.ts` permanently reproduces the important media boundaries with self-generated fixtures and cleanup.

Artifacts:

- `studio.mp4`: 1080×1080, 30 FPS, 93 video frames / 3.1 s, H.264 video + AAC audio. AAC/container duration is 3.157333 s because of encoder padding.
- `frame-10.png`: transformed nested container, text, ellipse, SVG path; visually inspected.
- `frame-24.png`, `frame-35.png`: grouped reveal/visibility phases.
- `frame-50.png`, `frame-65.png`: timer and wrapped long Cyrillic caption; visually inspected after the caption fix.
- `frame-75.png`: separate group answer, winner glow/scale and dimmed loser; visually inspected.
- `frame-90.png`: standalone nonlooping footage held at source frame 35 / 1.167 s, correct after late-scene clamp fix; visually inspected.
- `wide-timer.png`, `wide-answer.png`: 1920×1080 asymmetric 3-vs-2 groups with equal automatic card dimensions; visually inspected.
- `vertical-timer.png`, `vertical-answer.png`: 1080×1920 twelve portrait cards, wrapped labels and answer phase; visually inspected.
- `props.json`, `document.json`, `wide-props.json`, `vertical-props.json`, `render.ts`, `render.log`, `probe.json`, `audio-stats.log`, `blackdetect.log`, `full-test.log` retain exact inputs and evidence.

Probe command:

```sh
DYLD_LIBRARY_PATH=node_modules/@remotion/compositor-darwin-arm64 node_modules/@remotion/compositor-darwin-arm64/ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,duration -show_entries format=duration -of json storage/studio-renderer-proof/studio.mp4 > storage/studio-renderer-proof/probe.json
```

Additional inspection commands:

```sh
node_modules/ffmpeg-static/ffmpeg -hide_banner -i storage/studio-renderer-proof/studio.mp4 -vn -af astats=metadata=1:reset=0 -f null /dev/null > storage/studio-renderer-proof/audio-stats.log 2>&1
node_modules/ffmpeg-static/ffmpeg -hide_banner -i storage/studio-renderer-proof/studio.mp4 -an -vf blackdetect=d=0.1:pix_th=0.02:pic_th=0.98 -f null /dev/null > storage/studio-renderer-proof/blackdetect.log 2>&1
```

Audio peak −18.70 dBFS, RMS −31.98 dBFS; no black interval of at least 0.1 s under the specified blackdetect thresholds.

## Exact Task 3 asset convention

Player/default props: `{plan, assetMode:'url'}` (assetMode may be omitted). Every `src` and `posterSrc` is already a usable URL; the renderer passes it verbatim.

Worker/stills/clips/final render: `{plan, assetMode:'static'}`. Copy immutable bytes into that job's Remotion `publicDir`. Rewrite **every** `scene.nodes[].media.asset.src`, optional `media.asset.posterSrc`, and `plan.audio[].asset.src` to a relative path or basename within that publicDir, e.g. `clip-<hash>.mp4`, `poster-<hash>.jpg`, `music-<hash>.wav` (no leading slash and no filesystem absolute path). The renderer calls `staticFile` for each of those references. Keep media offsets/timing unchanged: these are full selected source assets, not already-trimmed audio/video files. Do not reset offsets or preapply the same fades in the worker. Preserve resolved duration and dimensions.

Use the existing bundle webpack alias (`@` → `<repo>/src`) because Root also imports legacy compositions. Keep publicDir and bundle outDir as siblings; putting bundle output under publicDir causes recursive bundler copying.

## Limits and follow-up verification

- Exact source crop + contain/cover sizing uses resolved asset width/height. When absent, the renderer retains normalized CSS crop fallback; Task 3 should probe and provide dimensions for accurate cropped aspect fitting.
- Footage uses deterministic frame seeking so held/looped/offset frames are identical in render and preview. Live Player interaction/performance still needs Task 5's browser acceptance; this task does not claim that UI verification.
- Conservative font fitting protects the tested long captions, but exceptionally dense content can still become small; visual acceptance remains necessary.
- No service, Prisma, MCP, UI or controller plan checkbox edits were included.
