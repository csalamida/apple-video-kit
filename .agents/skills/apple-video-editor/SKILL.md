---
name: apple-video-editor
description: >
  Directs, packages and edits video to Apple design standards (Liquid Glass materials, continuous-curvature
  squircles, SF type, spring physics) in HyperFrames. Two modes: SCREEN SHARE (primary: screen recording +
  webcam PiP with auto-style zooms as data) and TALKING HEAD (face-safe graphics over footage).
  Everything on screen is a parameterized template mounted with a host tag; camera moves, zooms and PiP are data.
  Includes a generated library with when-to-use cues, a stage engine (window + pan, no re-crop), spring easing,
  a face-safety check, and a design-token layer. Use for any "package / edit / add overlays / screen-share" request.
license: MIT
metadata:
  author: Apple Video Kit contributors
  version: "5.1.0"
---

# Apple Video Editor & Director Handbook

## 1. Mission, Modes & Triggers

Turn raw footage into Apple-grade broadcast video without hand-animating each scene. Pick the mode first:

| Mode | When | Where | Camera |
|---|---|---|---|
| **Screen share (primary)** | Screen/window recording + webcam. Most videos. | `projects/screen-share/` | `share.js` zooms; tall webcam PiP bottom-left |
| **Talking head** | Webcam/interview footage with graphic cards | `index.html` | `components/camera.js` moves; templates stay off the face |

Trigger on: an `.mp4/.mov/.webm` + optional `.srt/.vtt` transcript; "package this video", "add overlays/captions",
"make it look like a polished screen recording / Apple keynote", "screen share with a PiP", "edit this talking head".

---

## 2. Workflow

**Screen share**
1. Sources: a silent screen/window recording -> `#screen`, the webcam (carries the voice) -> `#cam` in `projects/screen-share/index.html`. Set `data-duration` on both.
2. Optional: `npm run trim -- inputs/webcam.mp4 --also inputs/screen.mp4` cuts pauses; paste its clips into index.html and its `cuts` into share.js.
3. `npm run plan -- transcript.srt --mode screen` drafts the cue plan (zooms, callouts, focus, redact, webcam moments, templates). Review it: it is a draft, coordinates are TODOs.
4. Write `share.js`: `zooms` `{ t, x, y, z }` (screen 0-1 coords) and `{ t, z: 1 }` for overview before each new topic; `drift: true`; `cam` moments (`full` / `pip` / `hide`); `callouts`, `focus`, `redact` regions; `cuts`.
5. Mount templates on top (captions at minimum): host tags with `data-variable-values`. `place()` keeps them off the PiP rectangle. Host ids must not equal an id inside the template (use `<name>-host`).
6. `npm run share:check` (host checks + lint, runtime, layout, motion, contrast) then `npm run share:render`.
7. The cursor is baked into the screen recording; do not synthesise one. Redact anything private you see (emails, keys, client names) even if it is not spoken.

**Talking head**
1. Footage -> `index.html` (`#footage` inside `#punch`); `npm run plan -- transcript.srt --mode talking` for cues. Camera moves and jump `cuts` go in `components/camera.js`, never inline tweens.
2. Mount templates as host tags; set `at`/`dur` equal to the host's `data-start`/`data-duration`.
3. `npm run check` and `npm run check:face` must both pass; then `npm run render`.

---

## 3. Storyboard Decision Guide (Cue to Template to Motion)

Editorial guide, not an automated parser. The full, editable version is the cue sheet at the top of the library
(`npm run build:library`, open `http://localhost:4173/library/`; source `scripts/library-meta.mjs`).

| Spoken cue | Template | Motion / camera |
|---|---|---|
| Video start (0-4 s), "in this video" | `title-card` intro, then `lower-third` + `chapter-pill` | screen share: `cam` full, then `pip` |
| "method one / first / three ways" | `glass-card` (one per step) | chapter-pill advances; snappy spring from the side away from the face |
| "let me show you / dashboard / open the..." | `app-window` (+ `spotlight`) | talking head: speaker PiP/split rail, `layout:"rail"`. Screen share: zoom to the target |
| "click / press / this button" | none | screen share: zoom 1.5-1.9x + `callouts` ring and label |
| "press command K" | `keys` | none |
| "look at / notice this section" | `spotlight` (talking head) | screen share: `focus` dim |
| email, API key, phone, client name on screen | none | screen share: `redact` (blur), always, spoken or not |
| "the contact / this lead / details" | `contact-card` or an `app-window` contact panel | none |
| "incoming / notification / alert" | `notification-stack` | bouncy drop-in |
| "text / SMS / reply" | `imessage-phone` (or `glass-card` with `aside`) | typing indicator then message |
| "percent / seconds / money" | `metric-counter` (or `app-window` stats panel) | counter roll 1.4 s |
| "before / after / it used to" | `before-after` | speaker PiP while it plays |
| "the key is / remember this" | `quote` | camera punch-in; screen share: `cam` full |
| thesis / punchline | `kinetic-subtitle` punch word | camera punch-in 1.2x + edge defocus |
| "wait / loading / this takes a minute" | `fast-forward` (and speed up or trim the footage) | none |
| "moving on / now let's / step two" | `transition` (`chapter` kind 1.6 s, or `blur` 0.8 s) | zoom back to overview |
| "to recap" | `checklist` | none |
| "link in the description" | `link-chip` | none |
| sign-off, "see you next time" | `title-card` outro | screen share: `cam` full; talking head: full bleed + 1.2x |
| screen share: zoom held > 2 s | none | `drift: true` |
| screen share: dense screen, webcam in the way | none | `cam` hide, then pip |
| breath / filler / mid-sentence pause | none | no motion; `npm run trim` and jump-cut punch (`cuts`) |

---

## 4. Architecture

```
projects/screen-share/   index.html + share.js (zooms, cam, callouts, focus, redact, cuts) <- primary mode
index.html               talking-head root; mounts templates, builds camera from camera.js
compositions/tpl/        18 templates (variables = the API), incl. the transition library
components/
  tokens.css             ONLY place for colour, type, glass, corner values
  glass-components.js    __hfGlass: spring eases + stage engine + presets
  tpl-runtime.js         vars(), place() (face/PiP-safe), cameraAt/windowAt/faceAt, enter/exit
  tpl-parts.js           icon set, iPhone, panel registry (pipeline|contact|table|list|stats|chat|text|terminal|image)
  screen-stage.js        screen-share engine (window, zooms + drift, webcam modes, annotations, jump-cut punch)
  camera.js              talking-head camera + speaker window moves as DATA
inputs/face-track.js     face boxes, git-ignored: generated for the placeholder, scripts/detect-face.py (opencv in a temp venv) writes yours
inputs/_demo/            generated placeholder media (scripts/demo-media.mjs); your footage in inputs/ is git-ignored
library/                 generated catalog (live previews, props editor, cue sheets)
scripts/                 auto-trim, cue-plan (+ cue-rules), check-face-clear (+ lib/load-runtime), check-privacy, build-library, library-meta, library-page, sync-share, demo-media, serve, detect-face.py
```

**Templates (`compositions/tpl/*.html`)** - cards and panels: `glass-card`, `app-window`, `contact-card`, `checklist`, `before-after`; overlays: `lower-third`, `notification-stack`, `spotlight`, `keys`, `link-chip`, `fast-forward`; text: `kinetic-subtitle`, `quote`, `metric-counter`, `chapter-pill`; titles: `title-card` (intro | outro); devices: `imessage-phone`; transitions: `transition` (`dip`, `flash`, `blur`, `glass-wipe`, `iris`, `light-sweep`, `chapter`; the cut sits at the midpoint, z-index 90+). Mount:

```html
<div id="card-1" class="clip subcomp-host" style="z-index: 40;"
     data-composition-id="glass-card-1" data-composition-src="compositions/tpl/glass-card.html"
     data-start="5.8" data-duration="3.0"
     data-variable-values='{"at":5.8,"dur":3.0,"titlePre":"Add Someone","titleAccent":"Manually","kind":"fields","items":[{"label":"Name","value":"John Smith"}]}'></div>
```

Rules every template follows:
- `at` / `dur` variables MUST equal the host's `data-start` / `data-duration` (templates cannot read their host; the check enforces it). Template root `data-duration` is large (600) so the host governs.
- Lists/objects are JSON text variables (HyperFrames has no json type); a host may pass real arrays.
- Positioned templates take `side`, `top`, `offsetX/Y`, `scale`, `safe` (full-frame ones such as `transition`, `spotlight`, `kinetic-subtitle`, `chapter-pill` take fewer; read each template's variables). `safe:true` shrinks or flips the card so it never covers the head (talking head) or the PiP (screen share).
- `app-window` hosts any mix of panels (add a kind in `tpl-parts.js` PANELS); `layout:"rail"` puts the headline in the free left column above the PiP.
- Host ids must not equal an id inside the template (it would render into the host); use `<name>-host`. The checks catch it.
- Placeholder copy only in defaults and examples (John Smith, Jane Doe, Acme, lorem ipsum).
- Add a template: new file in `compositions/tpl/`, an entry (`use`, `examples`) in `scripts/library-meta.mjs`, then `npm run build:library`.

**Stage engine (`__hfGlass.stage`)** - the speaker is a WINDOW (left/top/width/height/radius, squircle, ring+shadow as box-shadow) whose footage lives in a fixed-size `.hf-pan` that is only translated/scaled. Nothing re-crops while it morphs and radius/ring stay true pixels. `dockPiP`, `undockPiP`, `splitStage`, `unsplitStage`, `keynoteEmphasis` all use it. Never animate `width`/`height` on a `<video>`. Moves in `camera.js`: `win`, `fit: 'frame'|'cover'` (cover is face-centred), `front`, `chrome`.

**Screen-share moves (`share.js`, engine `components/screen-stage.js`)** - `drift` (slow +3.5% push-in while a zoom holds), `cam: [{t, mode: 'full'|'pip'|'hide'}]` (webcam to full screen without re-crop, back to the card, or tucked away), `cuts` + `punch` (jump-cut punch on the webcam), and screen-space annotations that live inside the zoomed screen so they stay locked to their spot: `callouts` (ring + label, label keeps its size), `focus` (dim the rest), `redact` (blur or solid; whole video when no t/end).

**Screen-share PiP spec (measured from a real reference export)** - 267x427 at 1920x1080 (14% x 40%, about 5:8), bottom-left at (26, 24), radius 42, soft shadow, NO ring. Stays on screen while the screen zooms and tucks to 0.7x from its bottom-left corner as the zoom nears 1.7x. Never move it to another corner. Screen window: about 93.5% wide, centred, 18px radius, soft shadow, over a macOS-style wallpaper.

**Design rules (enforced by `tokens.css`)**
- Colour: Apple system dark palette; ONE accent (blue `#2997ff`; use `--accent-text` for text over footage); green = complete, yellow = caution. No cobalt/cream/purple.
- Type: `system-ui` first (SF Pro on macOS, automatic optical sizing); weights 400-700 only; no `text-shadow`; tabular figures for numbers; uppercase labels tracked about 0.06em.
- Shape: `corner-shape: var(--corner)` (superellipse) on rectangles; capsules and circles stay true arcs.
- Glass: about 50% translucent base + blur + saturate + dim, specular top rim. The footage must show through.
- Motion: spring eases only (`__hfGlass.ease.smooth | snappy | bouncy`). GSAP silently ignores `cubic-bezier(...)` strings and falls back to `power1.out`.
- Subtitles: one highlight colour, 1-3 punch words per cue (`*star*` them), sentence case.
- Privacy: never commit footage or real names; `npm run check:privacy` (with a local `.privacy-denylist`) guards it.
- Determinism: no `Date.now()`, unseeded `Math.random()`, or network fetches; no CDN fonts.

---

## 5. Low-Level Preset API (`window.__hfGlass`, used by the templates)

Prefer templates. Reach for these only when hand-building a custom composition. Every preset adds tweens to the timeline you pass (`tl`) at `opts.start`; all are seek-safe. Signatures (`components/glass-components.js`):

| Preset | Signature | Use |
|---|---|---|
| `spring` | `spring(bounce)` | ease function; `ease.smooth` = 0, `snappy` = 0.15, `bouncy` = 0.3 |
| `revealCard` / `hideCard` | `(tl, target, opts)` | spring card in / out |
| `cameraPunchIn` / `cameraPunchOut` / `counterbalancePan` | `(tl, cameraSelector, opts)` | talking-head punch-in 1.15-1.25x and back |
| `dockPiP` / `undockPiP` | `(tl, cameraSelector, opts)` | speaker to a PiP window and back (stage engine, no re-crop) |
| `keynoteEmphasis` / `undockKeynoteEmphasis` | `(tl, textContainer, pipSelector, opts)` | centre-stage thesis text with the speaker docked |
| `splitStage` / `unsplitStage` | `(tl, speakerSelector, appCanvasSelector, opts)` | speaker rail left, app canvas right |
| `toastDropIn` / `toastDismiss` | `(tl, toastSelector, opts)` | notification banner |
| `toggleNotificationStack` | `(tl, stackSelector, opts)` | expand / collapse a stack |
| `revealList` | `(tl, itemsSelector, opts)` | staggered list |
| `popCheckmark` | `(tl, itemSelector, opts)` | tick a row |
| `animateCounter` | `(tl, elSelector, opts)` | number roll, tabular figures |
| `chatBubblePop` | `(tl, bubbleSelector, opts)` | message bubble |
| `kineticTextBurst` | `(tl, capsuleSelector, opts)` | caption capsule burst |
| `updateStepper` | `(badgeElements, activeIndex, completedIndices)` | sets stepper state directly (no timeline) |
| `pipelinePulse` | `(tl, wireSelector, opts)` | pulse along a pipeline wire |
| `focusSpotlight` | `(tl, targetSelector, contextSelectors, opts)` | dim the context, keep the target lit |
| `keynoteLowerThird` | `(tl, containerSelector, sweepSelector, opts)` | lower-third with a specular sweep |
| `cursorClick` | `(tl, cursorSelector, targetSelector, opts)` | synthetic pointer for mockups only; never in screen share (the real cursor is in the recording) |

The stage engine behind the PiP presets is `__hfGlass.stage` (`fit`, `pan`, `to`), described in section 4.

## 6. Icons (`__hfParts.icon`)

The kit ships its own 24x24 icon set (MIT, `components/tpl-parts.js`); no Apple SF Symbols or Apple Color Emoji are included, because their licences do not allow redistribution.

* **Names:** `check`, `seal`, `cellular`, `wifi`, `battery`, `chevron-left`, `chevron-right`, `arrow-right`, `video`, `plus-circle`, `arrow-up-circle`, `waveform`, `person-plus`, `table`, `doc`, `bolt`, `bell`, `money`, `chat`, `mail`, `calendar`, `sparkle`, `lock`, `link`, `play`, `star`, `chart`, `clock`, `eye-off` (aliases: `zap` = bolt, `dollar` = money, `message` = chat).
* **Usage:** `__hfParts.icon('bolt', 20)` returns an inline `<svg>`; call `__hfParts.ensureSymbols()` once after inserting. Icons use `currentColor`.

## 7. Verification & Quality Gate

```bash
npm run check:all      # everything below in one go
npm run check          # talking head: lint + runtime + layout + motion + contrast
npm run check:face     # host contracts (at/dur, host ids) + no template covers the speaker's head
npm run share:check    # screen share: same, measured against the webcam card (syncs shared files first)
npm run check:privacy  # no footage, images, big files or denylisted names in git
npm run build:library  # regenerate library/ after editing templates or scripts/library-meta.mjs
npx hyperframes snapshot [DIR] --at 3.5,7,13   # look at real frames before claiming it works
```

- Required: 0 errors and 0 warnings from the checks, WCAG AA contrast passing. Look at frames at every template's entry, hold and exit, and at every camera, cam-mode and zoom transition.
- Every value must be a pure function of time: renders seek the paused timeline in any order. Use `fromTo` with explicit start values where tweens on the same property meet; never let two tweens write one property at the same time.
- Never claim done without frame evidence or a render. Do not use symlinked source files inside a project (the bundler reads them as empty); `scripts/sync-share.mjs` copies real files.
- Preview: `npx hyperframes preview --background`, stop with `--stop`. Library: `npm run library`, open `http://localhost:4173/library/`.
