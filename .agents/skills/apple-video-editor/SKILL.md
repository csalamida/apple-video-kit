---
name: apple-video-editor
description: >
  Directs, packages and edits video to Apple design standards (Liquid Glass materials, continuous-curvature
  squircles, SF type, spring physics) in HyperFrames. Two modes: SCREEN SHARE (primary: screen recording +
  webcam PiP, Screen Studio style, zooms as data) and TALKING HEAD (face-safe graphics over footage).
  Everything on screen is a parameterized template mounted with a host tag; camera moves, zooms and PiP are data.
  Includes a generated library with when-to-use cues, a stage engine (window + pan, no re-crop), spring easing,
  a face-safety check, and a design-token layer. Use for any "package / edit / add overlays / screen-share" request.
license: MIT
metadata:
  author: Antigravity & Apple Design Integration
  version: "4.0.0"
---

# Apple Video Editor & Director Handbook

## 1. Mission, Modes & Triggers

Turn raw footage into Apple-grade broadcast video without hand-animating each scene. Pick the mode first:

| Mode | When | Where | Camera |
|---|---|---|---|
| **Screen share (primary)** | Screen/window recording + webcam. Most videos. | `projects/screen-share/` | `share.js` zooms; tall webcam PiP bottom-left |
| **Talking head** | Webcam/interview footage with graphic cards | `index.html` | `components/camera.js` moves; templates stay off the face |

Trigger on: an `.mp4/.mov/.webm` + optional `.srt/transcript.json`; "package this video", "add overlays/captions",
"make it look like Screen Studio / Apple keynote", "screen share with a PiP", "edit this talking head".

---

## 2. Workflow

**Screen share**
1. Sources: a silent screen/window recording -> `#screen`, the webcam (carries the voice) -> `#cam` in `projects/screen-share/index.html`. Set `data-duration` on both.
2. Read the script/transcript; write zoom keyframes in `share.js`: `{ t, x, y, z }` (zoom to z centred on x,y of the screen, 0-1), `{ t, z: 1 }` to return to overview. Overview before each new topic.
3. Mount templates on top (captions at minimum): host tags with `data-variable-values`. `place()` keeps them off the PiP rectangle.
4. `npm run share:check` (lint, runtime, layout, motion, contrast) then `npm run share:render`.
5. The cursor is baked into the screen recording; do not synthesise one.

**Talking head**
1. Footage -> `index.html`; transcript for cues. Camera moves go in `components/camera.js`, never inline tweens.
2. Mount templates as host tags; set `at`/`dur` equal to the host's `data-start`/`data-duration`.
3. `npm run check` and `npm run check:face` must both pass; then `npm run render`.

---

## 3. Storyboard Decision Guide (Cue to Template to Motion)

Editorial guide, not an automated parser. The full, editable version is the cue sheet at the top of the library
(`npm run build:library`, open `http://localhost:4173/library/`; source `scripts/library-meta.mjs`).

| Spoken cue | Template | Motion / camera |
|---|---|---|
| Video start (0-4 s) | `lower-third` + `chapter-pill` | none; first caption at 1.8 s |
| "method one / first / three ways" | `glass-card` (one per step) | chapter-pill advances; snappy spring from the side away from the face |
| "let me show you / dashboard / open the..." | `app-window` (+ `spotlight`) | talking head: speaker PiP/split rail, `layout:"rail"`. Screen share: zoom to the target |
| "the contact / this lead / details" | `contact-card` or an `app-window` contact panel | none |
| "incoming / notification / alert" | `notification-stack` | bouncy drop-in |
| "text / SMS / reply" | `imessage-phone` (or `glass-card` with `aside`) | typing indicator then message |
| "percent / seconds / money" | `metric-counter` (or `app-window` stats panel) | counter roll 1.4 s |
| thesis / punchline | `kinetic-subtitle` punch word | camera punch-in 1.2x + edge defocus |
| screen share: pointing at a control | none | zoom 1.5-1.9x (0.7 s spring), PiP tucks to 0.7x |
| screen share: tiny text / modal | none | zoom 2.0-2.5x, hold 2-4 s, then back to overview |
| conclusion / CTA | none | undock to full bleed + 1.2x punch-in (talking head) |
| breath / filler / mid-sentence pause | none | no motion; trim dead air > 0.4 s |

---

## 4. Architecture

```
projects/screen-share/   index.html + share.js (zooms, PiP overrides)        <- primary mode
index.html               talking-head root; mounts templates, builds camera from camera.js
compositions/tpl/        10 templates (variables = the API)
components/
  tokens.css             ONLY place for colour, type, glass, corner values
  glass-components.js    __hfGlass: spring eases + stage engine + presets
  tpl-runtime.js         vars(), place() (face/PiP-safe), cameraAt/windowAt/faceAt, enter/exit
  tpl-parts.js           SF symbols, iPhone, panel registry (pipeline|contact|table|list|stats|chat|text|terminal|image)
  screen-stage.js        screen-share engine (window, zooms, PiP scale)
  camera.js              talking-head camera + speaker window moves as DATA
inputs/face-track.js     face boxes (scripts/detect-face.py, opencv in a temp venv)
library/                 generated catalog (live previews, props editor, cue sheets)
scripts/                 check-face-clear.mjs, build-library.mjs, library-meta.mjs, sync-share.mjs
```

**Templates (`compositions/tpl/*.html`)** - `glass-card`, `app-window`, `contact-card`, `lower-third`, `chapter-pill`,
`notification-stack`, `spotlight`, `kinetic-subtitle`, `metric-counter`, `imessage-phone`. Mount:

```html
<div id="card-1" class="clip subcomp-host" style="z-index: 40;"
     data-composition-id="glass-card-1" data-composition-src="compositions/tpl/glass-card.html"
     data-start="5.8" data-duration="3.0"
     data-variable-values='{"at":5.8,"dur":3.0,"titlePre":"Add Someone","titleAccent":"Manually","kind":"fields","items":[{"label":"Name","value":"Alex"}]}'></div>
```

Rules every template follows:
- `at` / `dur` variables MUST equal the host's `data-start` / `data-duration` (templates cannot read their host; the check enforces it). Template root `data-duration` is large (600) so the host governs.
- Lists/objects are JSON text variables (HyperFrames has no json type); a host may pass real arrays.
- Common props: `side`, `top`, `offsetX/Y`, `scale`, `safe`. `safe:true` shrinks or flips the card so it never covers the head (talking head) or the PiP (screen share).
- `app-window` hosts any mix of panels (add a kind in `tpl-parts.js` PANELS); `layout:"rail"` puts the headline in the free left column above the PiP.
- Add a template: new file in `compositions/tpl/`, an entry (`use`, `examples`) in `scripts/library-meta.mjs`, then `npm run build:library`.

**Stage engine (`__hfGlass.stage`)** - the speaker is a WINDOW (left/top/width/height/radius, squircle, ring+shadow as box-shadow) whose footage lives in a fixed-size `.hf-pan` that is only translated/scaled. Nothing re-crops while it morphs and radius/ring stay true pixels. `dockPiP`, `undockPiP`, `splitStage`, `unsplitStage`, `keynoteEmphasis` all use it. Never animate `width`/`height` on a `<video>`. Moves in `camera.js`: `win`, `fit: 'frame'|'cover'` (cover is face-centred), `front`, `chrome`.

**Screen-share PiP spec (measured from a real reference export)** - 267x427 at 1920x1080 (14% x 40%, about 5:8), bottom-left at (26, 24), radius 42, soft shadow, NO ring. Stays on screen while the screen zooms and tucks to 0.7x from its bottom-left corner as the zoom nears 1.7x. Never move it to another corner. Screen window: about 93.5% wide, centred, 18px radius, soft shadow, over a macOS-style wallpaper.

**Design rules (enforced by `tokens.css`)**
- Colour: Apple system dark palette; ONE accent (blue `#2997ff`; use `--accent-text` for text over footage); green = complete, yellow = caution. No cobalt/cream/purple.
- Type: `system-ui` first (SF Pro on macOS, automatic optical sizing); weights 400-700 only; no `text-shadow`; tabular figures for numbers; uppercase labels tracked about 0.06em.
- Shape: `corner-shape: var(--corner)` (superellipse) on rectangles; capsules and circles stay true arcs.
- Glass: about 50% translucent base + blur + saturate + dim, specular top rim. The footage must show through.
- Motion: spring eases only (`__hfGlass.ease.smooth | snappy | bouncy`). GSAP silently ignores `cubic-bezier(...)` strings and falls back to `power1.out`.
- Subtitles: one highlight colour, 1-3 punch words per cue (`*star*` them), sentence case.
- Determinism: no `Date.now()`, unseeded `Math.random()`, or network fetches; no CDN fonts.

---

## 5. Low-Level Preset API (what the templates use)

Presets reside in `components/glass-components.js` under `window.__hfGlass`. Prefer templates and `camera.js`/`share.js` data; reach for these directly only for something no template covers. PiP, split-stage and emphasis presets run on the stage engine (section 4); easing is spring-based.

### 1. Camera Punch-In / Punch-Out
```javascript
window.__hfGlass.cameraPunchIn(tl, "#speaker-card", { start: 2.4, scale: 1.20 });
window.__hfGlass.cameraPunchOut(tl, "#speaker-card", { start: 5.8 });
```

### 2. Screen Studio PiP Docking
```javascript
window.__hfGlass.dockPiP(tl, "#speaker-card", { start: 6.0, orientation: "vertical", x: 96, y: 560 });
window.__hfGlass.undockPiP(tl, "#speaker-card", { start: 11.5 });
```

### 3. Apple Fluid Spring Card Reveal
```javascript
window.__hfGlass.revealCard(tl, "#target-card", { start: 3.2, duration: 0.48 });
```

### 4. macOS / iPhone Stacked Notification Center Banner
Faithfully replicates macOS Sequoia and iOS 18 Notification Center stacked notifications with physical background tiers, squircle app icons, corner Apple Color Emoji badges, channel context, and optional right avatar thumbnails:
```html
<div class="apple-notification-stack">
  <div class="apple-notif-stack-layer apple-notif-stack-layer-2"></div>
  <div class="apple-notif-stack-layer apple-notif-stack-layer-1"></div>
  <div class="apple-notification-card">
    <div class="apple-notif-dismiss">✕</div>
    <div class="apple-notif-icon-wrap">
      <div class="apple-notif-app-icon"><svg>...</svg></div>
      <div class="apple-notif-badge"><img class="apple-emoji" src="assets/emojis/zap.png" /></div>
    </div>
    <div class="apple-notif-content">
      <div class="apple-notif-header">
        <div class="apple-notif-header-left">
          <span class="apple-notif-title">Acme CRM VIP</span>
          <span class="apple-notif-context">(#inbound-leads)</span>
        </div>
        <span class="apple-notif-time">now</span>
      </div>
      <div class="apple-notif-msg"><strong>New Lead:</strong> Jane Doe booked call.</div>
    </div>
    <div class="apple-notif-right-avatar"><img src="avatar.jpg" /></div>
  </div>
</div>
```
```javascript
window.__hfGlass.toastDropIn(tl, "#toast-stack", { start: 8.5, duration: 0.55 });
window.__hfGlass.toggleNotificationStack(tl, "#toast-stack", { start: 10.5, expand: true });
window.__hfGlass.toastDismiss(tl, "#toast-stack", { start: 13.0 });
```

### 5. Milestone Checklist Pop
```javascript
window.__hfGlass.popCheckmark(tl, "#checklist-row-1", { start: 4.2 });
window.__hfGlass.popCheckmark(tl, "#checklist-row-2", { start: 5.1 });
```

### 6. Tabular Numeric Counter Roll
```javascript
window.__hfGlass.animateCounter(tl, "#metric-num", {
  start: 12.0, duration: 1.2, from: 0, to: 318, suffix: "%", decimals: 0
});
```

### 7. Kinetic Subtitle Capsule
```javascript
window.__hfGlass.kineticSubtitleWord(tl, "#word-speed", { start: 3.1, accentColor: "#2997ff" });
```

### 8. Stepper Engine State Change
```javascript
window.__hfGlass.stepperNext(tl, "#workflow-stepper", { start: 7.0, step: 2 });
```

### 9. iPhone 16 Pro iMessage Alert
```javascript
window.__hfGlass.chatBubblePop(tl, ".chat-bubble.incoming", { start: 9.2 });
```

### 10. Node-to-Node Pipeline Flow
```javascript
window.__hfGlass.pulsePipeline(tl, "#pipeline-flow", { start: 6.5, duration: 2.0 });
```

### 11. macOS Developer Terminal
```javascript
window.__hfGlass.typeTerminalLine(tl, "#terminal-output", "POST /api/v1/dispatch -> 200 OK", { start: 8.0 });
```

### 12. Screen Studio Spotlight & Focus Dimmer
```javascript
window.__hfGlass.focusSpotlight(tl, "#stage-canvas", "#focal-lead-card", { start: 14.0, duration: 0.45 });
window.__hfGlass.unfocusSpotlight(tl, "#stage-canvas", { start: 18.5 });
```

### 13. macOS Interactive Pointer & Tactile Toggle
```javascript
window.__hfGlass.cursorClick(tl, "#macos-pointer", "#feature-toggle", { start: 13.2, moveDuration: 0.55 });
```

### 14. Keynote Glass Lower-Third
```javascript
window.__hfGlass.keynoteLowerThird(tl, "#speaker-lower-third", "#specular-sweep", { start: 0.8, duration: 0.45 });
```

### 15. Center-Stage Thesis & Corner PiP Dock
```javascript
window.__hfGlass.keynoteEmphasis(tl, "#thesis-content", "#speaker-card", {
  start: 4.5, duration: 0.78, position: "bottom-right", punchSelector: ".punch-blue"
});
window.__hfGlass.undockKeynoteEmphasis(tl, "#thesis-content", "#speaker-card", { start: 10.2 });
```

### 16. Apple Split-Stage (Speaker 38% Left + Live App Canvas 60% Right)
```javascript
window.__hfGlass.splitStage(tl, "#speaker-card", "#macos-app-window", { start: 7.5, duration: 0.8 });
window.__hfGlass.unsplitStage(tl, "#speaker-card", "#macos-app-window", { start: 22.0 });
```

---

## 6. Apple Color Emoji Asset Library (`assets/emojis/`)

Always use the **36 local 160×160 Apple Color Emoji PNG assets** in `assets/emojis/` to ensure offline, broadcast-safe rendering without system font fallbacks:

* **Available Emojis:** `rocket`, `zap`, `fire`, `sparkles`, `target`, `robot`, `brain`, `bulb`, `phone`, `chat`, `bell`, `clock`, `stopwatch`, `check`, `chart`, `barchart`, `money`, `lock`, `shield`, `diamond`, `trophy`, `crown`, `star`, `handshake`, `alert`, `mail`, `globe`, `mic`, `gear`, `package`, `thumbsup`, `heart`, `pin`, `warning`, `key`, `calendar`.

### Usage:
* **HTML:** `<img class="apple-emoji" src="assets/emojis/zap.png" alt="zap" />`
* **Frosted Pill:** `<div class="apple-emoji-pill"><img class="apple-emoji" src="assets/emojis/robot.png" /><span>Autonomous AI</span></div>`
* **JavaScript:** `window.__hfGlass.emoji('rocket', { size: 'lg' })`

---

## 7. Verification & Quality Gate

```bash
npm run check          # talking head: lint + runtime + layout + motion + contrast (0 errors, 0 warnings)
npm run check:face     # no template covers the speaker's head (fails with px + time)
npm run share:check    # screen share: same gates (syncs shared files first)
npm run build:library  # regenerate library/ after editing templates or scripts/library-meta.mjs
npx hyperframes snapshot [DIR] --at 3.5,7,13   # look at real frames before claiming it works
```

- Required: 0 errors, 0 warnings, WCAG AA contrast passes. Look at frames at every template's entry, hold and the camera transitions.
- Never claim done without frame evidence or a render. Do not use symlinked source files inside a project (the bundler reads them as empty); `scripts/sync-share.mjs` copies real files.
- Preview: `npx hyperframes preview --background`, stop with `--stop`. Library: `npm run build:library`, serve the repo root and open `/library/`.
