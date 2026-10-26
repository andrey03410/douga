# AI Video SDK v1 contract

Status: Task 1 domain contract, 2026-10-26. The public entry point is
`src/video/index.ts`. JSON is canonical; no document JavaScript is evaluated.
This contract locks the actual names consumed by the renderer, service, MCP and
website. Runtime types are in `src/video/types.ts`, strict schemas in
`src/video/schema.ts`. `getVideoDocumentJsonSchema()` derives recursive JSON
Schema from the same Zod objects using the explicit `zod-to-json-schema`
dependency. Runtime semantic checks remain authoritative for crop bounds,
stable-ID uniqueness, positive scene durations, mutually exclusive repetition/explicit
scene references, and preset content stripping.

## Public functions and types

- `parseVideoDocument(input: unknown): VideoDocument`: validates, clones and
  rejects unknown fields. Throws a ZodError with paths on malformed input.
- `createVideoDocument(options: CreateVideoOptions): VideoDocument`: top or
  picker, optional `id`, `title`, `format`, `fps`, `seed`, `presetId`,
  `participants`, `rounds`, `roundCount`, `cardsPerRound`. No random IDs or clock.
  A new media-free top has four generic participants; a picker has 30 rounds
  of four generic participants unless content/count overrides are supplied.
- `compileVideo(document: VideoDocument, manifest?: AssetManifest): CompileResult`:
  `{ plan, diagnostics, ready }`. Invalid input returns diagnostics and an empty
  one-frame plan; valid inputs compile without I/O. Errors prevent ready status;
  warnings require inspection but do not block it. A plan is a JSON-round-trippable
  snapshot, with no closures, live references or fetching.
- `getBuiltinPresets(): VideoPreset[]`, `getBuiltinPreset(id)`:
  independent copies; unknown ID returns `undefined`.
- `extractVideoPreset(document, {id,name,version?}): VideoPreset` and
  `applyVideoPreset(document,preset): VideoDocument`: explicit extraction and
  copy-on-apply, no live preset dependency.
- `patchVideoDocument(document, operations: PatchOperation[])`: atomic semantic
  edits, returning a separately validated document. Target types are `document`,
  `participant`, `round`, `card`, `group`, `scene`, `node`. All except document
  take `id`. Operations are `{op:"set",target,path:string[],value}` and
  `{op:"unset",target,path:string[]}`. Missing unset ancestors are a no-op.
  Identity fields, array indices and prototype traversal are forbidden. Adding
  content or replacing structural collections uses full document replacement.
- `collectVideoAssetKeys(document): string[]`: sorted unique media keys from all
  content, custom nodes, audio, format/round/participant overrides and declared
  bindings, including unused bindings. Services must protect those references in
  drafts, revisions and jobs, not only media used by the current render plan.
- Builders `scene(options)`, `node(options:VideoNode)`, `textNode(options)`,
  `containerNode(options)`, `time(seconds)`, `frame(integer)` validate/emit JSON.
  `layoutCards`, `resolveRect`, `OUTPUT_DIMENSIONS` are also exported.
- Exported schemas: `videoDocumentSchema`, `videoPresetSchema`,
  `videoNodeSchema`, `sceneSchema`, `participantSchema`, `roundSchema`,
  `settingsSchema`, `cardStyleSchema`, `layoutSchema`, `timeSchema`,
  `rectSchema`, `assetBindingSchema`, `assetManifestSchema`,
  `resolvedAssetSchema`, `audioCueSchema`.
- Exported types include `VideoDocument`, `VideoPreset`, `AssetManifest`,
  `ResolvedAsset`, `CompiledVideo`, `CompiledScene`, `CompiledNode`,
  `CompiledMedia`, `CompiledAudio`, `CompiledAnimation`, `Diagnostic`,
  `CompileResult`, `Source`, `Participant`, `PickerRound`, `PickerCard`,
  `PickerGroup`, `Settings`, `VideoNode`, `VideoScene`, `Animation`, `AudioCue`,
  `Playlist`, `AssetBinding`, `Time`, `Rect`, `Window`, `VideoFormat`,
  `PatchOperation`, `PatchTarget`, `CreateVideoOptions`.

## Document, source and assets

`VideoDocument` has `schemaVersion:1`, `id`, `title`, `kind:top|picker`, `seed`,
`output`, `source`, `bindings`, `settings`, `scenes`, optional `formatSettings`,
`audio`, `preset`. Output formats are `wide` 1920×1080, `vertical` 1080×1920,
`square` 1080×1080. FPS is one of 24/25/30/50/60, default 30. No inherited
nine-card or fifty-round limit. Service quotas are separate from this schema.

`source` is `{kind:"manual"|"tournament",tournamentId?,version?,participants,
rounds}`. Tournament sources require tournamentId. Participant fields are
`id,label,rank?,media?:{visual?,audio?},settings?`. A participant can be any
object with a label and optional visual/audio; audio is not required.
`rank` belongs to the source. `settings.top.order` chooses source, ascending,
or descending display order without changing that rank.

A round is `{id,prompt?,cards,groups?,answer?,settings?,music?,background?}`.
Cards are `{id,participantId,label?,settings?}`. Groups are
`{id,label?,cardIds,settings?}`. Answers are optional
`{cardIds?:string[],groupIds?:string[]}`. Every grouped card must be assigned
once; missing/duplicate group references are errors. `music:null` explicitly
mutes the global playlist during the round; omission inherits it. A string
replaces it with a round-local looping music asset. Scene and round backgrounds
are media keys; `settings.background` is a CSS color only.

Dynamic scenes use `repeat:"participants"` or `repeat:"rounds"`; no fixed source
array indices are stored in composition. A repeated scene cannot also declare
participantId or roundId; choose either dynamic repetition or one explicit
identity. Contradictory combinations fail validation, including deleted IDs.
Stable participant IDs retain their
local media/settings when the service reconciles source ranking updates.
The source adapter must merge source-owned rank/label fields into retained
participants by ID; never zip arrays by position. New participants inherit the
template. Deleted explicit scene/card references diagnose errors instead of
being silently rebound. Previous source snapshots remain the service's job.

Media keys are resolved by `AssetManifest = Record<string,ResolvedAsset>`.
A resolved asset is `{id,kind:"image"|"video"|"audio",src,durationSec?,hasAudio?,
posterSrc?,width?,height?,hash?}`. `bindings[key]` is one of:

```json
{"kind":"pool","assetId":"owned-art-id","hash":"optional-immutable-hash"}
```

```json
{"kind":"track","tournamentId":"owned-tournament-id","trackId":"track-id"}
```

```json
{"kind":"builtin","name":"tick"}
```

Builtin names are `tick`, `reveal`, `answer`. Presets carry no bindings; a
project can assign these keys to countdowns or ordinary sfx cues. The service
must check ownership, actual file existence, allowed paths and immutable hashes.
The domain compiler checks media kind, pool asset-ID and optional pinned-hash
agreement. `src` is a resolved URL for Player or prepared URL for worker; the
compiler does not fetch it. Video duration metadata is required to safely
loop/hold the final source frame. Audio playlists and looping audio also require
duration metadata. Intrinsic `width` and `height` remain optional for ordinary
uncropped media and crop with `fit:"fill"`. A crop with `fit:"contain"` or
`fit:"cover"` (including the default cover fit) requires both dimensions;
otherwise compilation returns `MEDIA_DIMENSIONS_REQUIRED` and `ready:false`.
Preview and worker asset preparation must probe the actual source dimensions.
The renderer also rejects this incomplete cropped-media IR explicitly if a caller
bypasses compilation, rather than silently stretching the selected crop.
Unspecified `hasAudio` does not activate embedded sound.

## Settings and layout

Effective order: block defaults → document settings → current output format
settings → scene settings → round settings → participant settings → group
settings → card/node style. Missing fields inherit; explicit false/zero values
survive. Snippet subfields merge too. Unsetting removes a local exception.
`applyVideoPreset` replaces project design and output, while source/round/card
content, source-level exceptions, media keys, bindings, title and actual audio
assignments remain. Preset playlist policy replaces only compatible music rules.

Settings have optional `background`, `card`, `labels`, `layout`, `top`, `picker`.
Card style supports orientation landscape/portrait, fit cover/contain/fill,
normalized crop `{x,y,width,height}`, offsetSec, loop, playSound, volume,
borderRadius/background/color/borderColor/borderWidth/fontSize. Crop must stay
inside [0,1] media bounds. Colors reject CSS URLs. `labels.mode` is `always`,
`finale`, `never`, `active` or `answer`, with optional showRank, delaySec, holdSec.
Top snippets are manual (durationSec/startSec), full (entire source), or active
(activeStartSec/activeEndSec); footage offset and primary audio offset are
separate when explicitly configured. When visual and primary audio resolve to
the same video and no document/format/scene/participant layer explicitly provides
a footage offset, the picture follows the selected snippet offset. An explicit
footage offset (including zero) retains independent positioning. Full/active timing determines the position's scene duration; manual
uses snippet.durationSec, falling back to top.durationSec. With no audio, a
manual top scene still renders normally.

Picker settings: leadSec, revealSec, timerSec, answerSec, hideAfterReveal,
answerMode inline/separate, staggerSec, tick media key, timerRect, showPrompt.
Cards reveal sequentially; grouped rounds reveal groups sequentially with a
bounded card cascade and a single primary sound source per group. Memory cards
hide after their reveal and reappear at the timer phase. Optional answers add
an inline answer phase or a separate answer scene. Separate answer scenes retain
all cards for context and mark winners; no answer means no answer scene.

Layout is `{type:"grid"|"arc"|"free",gap?,padding?,columns?,positions?}`. Grid
searches feasible rows/columns for maximum card area; arc curves each row while
keeping cards in frame. Free positions are normalized output rectangles, one
per card. Missing free positions produce a diagnostic; fallback layout exists
only to aid inspection. Top layouts fill the output; picker automatic layout
reserves prompt/timer regions. Containers can have their own layout.

## Composable nodes and timeline

Scenes have `id`, `block:"custom"|"top"|"picker"`, `nodes`, optional `repeat`,
`participantId`, `roundId`, `duration`, `settings`, `background`, `transition`.
The scene list is sequential; custom scenes default to three seconds. Top/picker
blocks expand source content, and `nodes` add arbitrary overlays. Bookends are
ordinary custom scenes before/after repetition. A transition is
`{type:"none"|"fade"|"slide",duration:Time}` and occurs within that scene's own
interval; it does not secretly shorten the scene list or overlap scene audio.

`Time` is exactly `{sec:number}` or `{frame:integer}`; compilation rounds seconds
once to integer frames. `VideoNode` types are container, text, shape, image,
video, card, timer, audio. Shared fields: id, rect, units relative/px, anchor
(topLeft/center/bottomRight), layer, timing `{at?,duration?}`, style, animation,
opacity, rotate, scale. Rectangles are relative to the parent unless units=px.
Container children support parallel or sequence flow; `at` adds an offset to
the parent start or preceding sibling end. Child time is clipped to its parent.

Text can be literal or `{bind,groupId?,prefix?,suffix?}`. Bindings are document.title,
participant.label, participant.rank, round.prompt, group.label. A binding absent
from the scene context emits a warning. For `group.label`, supply `groupId`
within the current round; it can be omitted when that round has exactly one
group. Built-in group panels already resolve their label.
Custom cards bind `participantId`, with `$participant` meaning the current
participant-repetition context. Shapes support rect/ellipse/path and SVG path
`d` data via `path`. Audio nodes support role, volume, offset/loop and fades.

Animations have property opacity/x/y/scale/rotate, easing
linear/easeIn/easeOut/easeInOut/spring, and `{at:Time,value}` keyframes. Duplicate
rounded keyframe times are errors. The renderer interprets easing deterministically
using local frames; x/y add pixel translations, rotate adds degrees, scale
and opacity multiply their base node values. Values clamp to the first/last
keyframe outside the keyframe interval; repeated tracks of the same property
compose in array order. No wall clock, random JS or string-evaluated expressions.
New effects require a developer to extend the versioned union/schema/compiler
and renderer. Arbitrary shapes/composition do not require a new effect.

## Compiled IR: exact renderer conventions

`CompiledVideo` contains schemaVersion=1, compilerVersion="1.0.0", seed, width,
height, fps, durationInFrames, scenes, audio. All intervals are half-open
`[from,to)`; a node on frame `to` is already outside that window.

- Scene `from` is composition-absolute. `durationInFrames` is its length.
  `kind` is custom/top/picker/answer, `background` is a color, `participantId`
  and `roundId` identify source context. `phases` contains scene-local
  revealStartFrame/timerStartFrame/answerStartFrame. Transition duration is frames.
- Node `rect` is output-absolute pixels. `from`, `visible`, `labelWindows`,
  `activeWindow`, `answerFrom` are scene-relative. Keyframe `frame` is node-local
  (`compositionFrame - scene.from - node.from`). `durationInFrames` is a length.
  `layer` sorts paint order; `parentId` identifies a flattened container hierarchy.
  Renderers must inherit ancestor visibility/opacity/transforms; rects already
  include parent offsets and must not have those offsets applied a second time.
- Node types are container/text/shape/image/video/card/timer/group. Card `label`
  is resolved text, `rank` is source rank, and `showRank` controls rank display.
  Picker cards retain `cardId` as well as participantId for source-specific edits.
  `answer` marks a winner; do not highlight until `answerFrom`. The card's
  `labelWindows` are additionally gated by `visible`. Group text is its label.
  Timer `timerFrames` is the countdown length from node.from.
- Media is `{asset,offsetFrames,loopFrames,fit,crop?,freezeAtFrame?}`.
  `loopFrames:null` means no loop; otherwise it is the available source segment
  length after offset. Videos are always visually muted: all sound is in audio.
  A straight video holds at freezeAtFrame after exhausting available footage,
  preventing black tails. Card videos advance during activeWindow and use the
  held final active frame or supplied poster outside it; standalone videos use
  node-local time. Loop modulo is applied after offset, never to the entire file.
- Audio cues use composition-absolute `from`, `duckWindows`, `muteWindows`.
  Fields: id, asset, role primary/music/sfx/voice, durationInFrames, offsetFrames,
  loopFrames, volume, fadeInFrames, fadeOutFrames, duckVolume. Rendering combines
  cue volume and linear fades, multiplies music by duckVolume in duckWindows,
  and sets it to zero in muteWindows. Audio loops use the available source
  segment; non-looping cues stop at the real source tail. Tick sounds are separate
  once-per-second cues, with no fabricated long loop of a short tick waveform.
  Playlist overlap is limited to half of either adjacent track to guarantee
  progress for very short tracks; looping playlists continue to the video end.
- Generated identifiers percent-encode source/template ID path segments.
  Source identity fields remain the exact original IDs. Custom nodes use the
  `/node/` namespace, generated picker cards `/card/`, groups `/group/`.
  Consumers should read typed identity fields, not parse generated IDs.

## Presets, limitations and diagnostics

IDs: `top.{classic|minimal|cinematic}.{wide|vertical|square}` and
`picker.{classic|portrait|memory|arc|two-groups|three-groups|separate-answer}.
{wide|vertical|square}` — thirty presets. All are media-free. Picker skeletons
are 30×4; group presets assign those four generic cards among two/three groups.
There is no default thematic question/answer. Built-in presets are fresh copies.

Preset schema has schemaVersion,id,version,name,kind,output,settings,
formatSettings?,scenes,skeleton `{roundCount,cardsPerRound,groupCount}`, optional
playlist audio policy. Extraction replaces literal text with `Text`, strips
binding prefixes/suffixes, remaps node/scene IDs, removes source references,
background media and tick bindings, replaces asset references with generic
`slot:<node-type>:<number>`, and replaces custom participant refs with `$participant`.
Explicitly bound top/round scenes become source-repetition templates. SVG path
content is stripped on extraction. This intentionally requires an author to
restore any desired universal copy/path after extraction; it does not guess
whether private text is safe to publish. User-supplied presets reject actual
asset keys and participant IDs. Slot assets are unfilled design placeholders,
reported as warnings; a service should expose them as fillable slots.

Multiple explicitly bound source scenes become multiple repeated templates;
they are not collapsed silently. A custom card using `$participant` requires a
participant repetition/context. Preset application does not invent a mapping
from arbitrary literal custom text into participant content. Group
label bindings require a round context as noted above.

Diagnostics contain severity, code, message, path and optional nodeId. Important
codes: SCHEMA_INVALID, MANIFEST_INVALID, EMPTY_TIMELINE, PARTICIPANT_NOT_FOUND,
ROUND_NOT_FOUND, CARD_NOT_FOUND, ANSWER_NOT_FOUND, GROUP_MEMBERSHIP_INVALID,
GROUP_EMPTY, ROUND_EMPTY, ASSET_NOT_FOUND, ASSET_KIND_MISMATCH, ASSET_ID_MISMATCH,
ASSET_HASH_MISMATCH, MEDIA_DURATION_REQUIRED, MEDIA_DIMENSIONS_REQUIRED,
MEDIA_OFFSET_OUT_OF_RANGE, AUDIO_OFFSET_OUT_OF_RANGE, SNIPPET_DURATION_REQUIRED, SNIPPET_RANGE_INVALID,
NODE_OUTSIDE_SCENE, ANIMATION_KEYFRAMES_INVALID, LAYOUT_POSITIONS_MISMATCH.
Warnings include NODE_OUT_OF_BOUNDS, TEXT_MAY_BE_SMALL and
TEXT_BINDING_UNRESOLVED. Visual readability, actual file content and ownership
must still be checked by the later renderer/services; passing domain tests is
not a claim of rendered parity. Missing client video/audio modality is a disclosed
inspection limitation, not a document validation error.

## Complete emitted JSON examples

The following are complete documents generated with the public builders and
validated with `parseVideoDocument`/`compileVideo`. They deliberately render
without external media; add owned bindings and a service-resolved manifest to
replace the visible generic/object cards. They are real source documents,
not fragments with omitted required fields.

### Top with stable source ranks, local style and animated intro

```json
{
  "schemaVersion": 1,
  "id": "planets",
  "title": "Планеты",
  "kind": "top",
  "seed": 1,
  "output": {
    "format": "square",
    "fps": 30
  },
  "source": {
    "kind": "manual",
    "participants": [
      {
        "id": "earth",
        "label": "Земля",
        "rank": 1
      },
      {
        "id": "mars",
        "label": "Марс",
        "rank": 2,
        "settings": {
          "card": {
            "fit": "contain",
            "borderColor": "#ff8040"
          }
        }
      }
    ],
    "rounds": []
  },
  "bindings": {},
  "settings": {
    "background": "#101522",
    "card": {
      "borderRadius": 18,
      "orientation": "landscape"
    },
    "layout": {
      "type": "grid"
    },
    "top": {
      "order": "descending",
      "durationSec": 3
    }
  },
  "scenes": [
    {
      "id": "intro",
      "block": "custom",
      "duration": {
        "sec": 2
      },
      "nodes": [
        {
          "id": "title",
          "rect": {
            "x": 0.1,
            "y": 0.3,
            "width": 0.8,
            "height": 0.4
          },
          "animation": [
            {
              "property": "opacity",
              "keyframes": [
                {
                  "at": {
                    "frame": 0
                  },
                  "value": 0
                },
                {
                  "at": {
                    "frame": 15
                  },
                  "value": 1
                }
              ]
            }
          ],
          "type": "text",
          "text": {
            "bind": "document.title"
          }
        }
      ]
    },
    {
      "id": "main",
      "block": "top",
      "repeat": "participants",
      "nodes": []
    }
  ],
  "preset": {
    "id": "top.classic.square",
    "version": 1
  }
}
```

Compiled output: 1080×1080, 30 FPS, 240 frames, 3 scenes.

### Grouped portrait picker with memory, separate answer and sequential outro

```json
{
  "schemaVersion": 1,
  "id": "compare",
  "title": "Выбор",
  "kind": "picker",
  "seed": 1,
  "output": {
    "format": "vertical",
    "fps": 30
  },
  "source": {
    "kind": "manual",
    "participants": [
      {
        "id": "one",
        "label": "Первый"
      },
      {
        "id": "two",
        "label": "Второй"
      },
      {
        "id": "three",
        "label": "Третий"
      },
      {
        "id": "four",
        "label": "Четвёртый"
      }
    ],
    "rounds": [
      {
        "id": "round-one",
        "prompt": "Выбери группу",
        "cards": [
          {
            "id": "c1",
            "participantId": "one"
          },
          {
            "id": "c2",
            "participantId": "two"
          },
          {
            "id": "c3",
            "participantId": "three"
          },
          {
            "id": "c4",
            "participantId": "four"
          }
        ],
        "groups": [
          {
            "id": "left",
            "label": "Группа А",
            "cardIds": [
              "c1",
              "c2"
            ]
          },
          {
            "id": "right",
            "label": "Группа Б",
            "cardIds": [
              "c3",
              "c4"
            ]
          }
        ],
        "answer": {
          "groupIds": [
            "right"
          ]
        }
      }
    ]
  },
  "bindings": {},
  "settings": {
    "background": "#101522",
    "card": {
      "orientation": "portrait"
    },
    "layout": {
      "type": "grid"
    },
    "picker": {
      "leadSec": 0.5,
      "revealSec": 1,
      "timerSec": 2,
      "answerSec": 1,
      "answerMode": "separate",
      "hideAfterReveal": true
    }
  },
  "scenes": [
    {
      "id": "main",
      "block": "picker",
      "repeat": "rounds",
      "nodes": []
    },
    {
      "id": "outro",
      "block": "custom",
      "duration": {
        "sec": 2
      },
      "nodes": [
        {
          "id": "closing",
          "type": "container",
          "children": [
            {
              "id": "thanks",
              "timing": {
                "duration": {
                  "sec": 1
                }
              },
              "type": "text",
              "text": "Спасибо за просмотр"
            },
            {
              "id": "final-shape",
              "rect": {
                "x": 0.4,
                "y": 0.4,
                "width": 0.2,
                "height": 0.2
              },
              "timing": {
                "duration": {
                  "sec": 1
                }
              },
              "type": "shape",
              "shape": "ellipse",
              "fill": "#80aaff"
            }
          ],
          "flow": "sequence"
        }
      ]
    }
  ],
  "preset": {
    "id": "picker.separate-answer.vertical",
    "version": 1
  }
}
```

Compiled output: 1080×1920, 30 FPS, 225 frames, 3 scenes.

## Task 3 parity additions and service boundary (2026-10-26)

Participant now has optional `caption:string`. `label` remains source-owned and
is synchronized from tournament metadata. Standard top/card captions resolve
card/node label override → participant.caption → participant.label. Custom text
binding `participant.label` still explicitly reads the source label. Stable-ID
source synchronization retains caption, local media and settings. Full service
DTOs, schemas, CAS/version semantics and immutable-media conventions are in
[23-ai-video-service-contract.md](23-ai-video-service-contract.md).

AudioCue retains required `at:Time` and now accepts optional:

```ts
anchor?: {
  event: 'scene.start'|'card.reveal'|'timer.start'|'answer.start'|'transition.start';
  sceneId?: string;      // authored scene template ID, applies to repeated instances
  participantId?: string; // top scene participant, or card.reveal participant
  roundId?: string;
  cardId?: string;       // for card.reveal
}
```

Without anchor, `at` is absolute as before. With anchor, `at` is an offset from
each matching actual compiled event. Repetition yields distinct cue IDs.
Card events use the card active-window start; timer/answer use compiled phases,
including separate answer scenes. Transition start is the scene entrance when
it has a nonzero transition. Missing matching events emit
`AUDIO_ANCHOR_NOT_FOUND`. Timing/reordering changes move cues with their events.
The schema validates field shapes; event applicability is diagnosed by compile.

Preset audio can contain `cues:AudioCue[]` in addition to playlist policy.
Extraction replaces media with `slot:sound:<n>` and countdown assignments with
`slot:tick:<n>`, normalizes cue IDs, maps scene selectors to extracted scene IDs,
and removes participant/round/card selectors. Roles, anchor event, offset,
duration, source offset, gain, loop and fades survive. Preset validation forbids
concrete media keys and participant targets. Distinct countdown assignments
remain distinct slots. Applying a preset preserves destination bindings and
fills still-unassigned sound slots from the destination's corresponding sound
rule/countdown setting; presets never carry those concrete bindings. A fresh
project must bind its slots, otherwise ordinary missing-media diagnostics apply.

The service computes absent active-snippet ranges from actual PCM/RMS per
scene/participant/window length; it does not ask the caller to approximate them.
Text/image-only and silent-video objects can use an active template without
mandatory audio analysis. Explicit intervals still compile as authored.
