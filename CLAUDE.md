# Apple Video Kit (HyperFrames project)

Apple-style motion graphics for tutorial videos: a screen-share stage (primary) and a talking-head mode, built from parameterized templates. Everything per video is data.

## Read first

- `.agents/skills/apple-video-editor/SKILL.md`: the house rules (modes, cue-to-template guide, stage engine, design rules, gates). Read it before writing or editing a composition.
- HyperFrames framework skills (`/hyperframes`, `/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-cli`): install with `npx hyperframes skills update`. Start at `/hyperframes` for framework questions.
- Docs: `npx hyperframes docs <topic>` (offline), or discover pages via `https://hyperframes.heygen.com/llms.txt` (do not guess URLs).

## Two modes

| Mode | Files | Per-video data |
|---|---|---|
| Screen share (primary) | `projects/screen-share/index.html` | `projects/screen-share/share.js` |
| Talking head | `index.html` | `components/camera.js` + template host tags |

### Screen share

Wallpaper > floating rounded screen window > tall webcam card bottom-left. `index.html` only points `#screen` (silent screen recording) and `#cam` (webcam, carries the voice) at your files. Engine: `components/screen-stage.js`.

`share.js` keys:
- `zooms: [{ t, x, y, z }]`: ease (0.7 s spring) to zoom `z` centred on screen point (x, y) in 0-1 coords; `{ t, z: 1 }` = overview. 1.5-1.9x for controls, 2.0-2.5x only for tiny text. Zoom out before each new topic.
- `drift: true`: slow +3.5% push-in while a zoom holds.
- `cam: [{ t, mode: 'full' | 'pip' | 'hide' }]`: webcam to full screen (no re-crop), back to the card, or tucked away.
- `cuts: [t...]`, `punch`: jump-cut punch on the webcam (framing alternates 1.0 / 1.06).
- `callouts`, `focus`, `redact`: screen regions `{ t, end, x, y, w, h }` in 0-1 coords that live inside the zoomed screen and follow every zoom. Redact anything private on screen (emails, keys, client names), spoken or not.
- `pip`: overrides for the card. Measured spec: 267x427 at 1920x1080, bottom-left at (26, 24), radius 42, soft shadow, no ring; tucks to 0.7x as the zoom nears 1.7x. Never move it to another corner.

The cursor is baked into the screen recording: never synthesise or restyle one.

### Talking head

- Camera moves are data in `components/camera.js` (`moves`, `cuts`, `punch`); `index.html` builds the tweens from it. Never hard-code camera tweens.
- Speaker PiP and split rail are WINDOW moves (`win`, `fit: 'frame' | 'cover'`, `front`, `chrome`) driven by `__hfGlass.stage`: the window morphs, the footage is only panned/scaled inside `#camera-pan` > `#punch`, so it never re-crops. Never animate width/height on a `<video>`.
- Speaker PiP docks bottom-left on the page margin; `app-window` with `layout:"rail"` fills the column above it.
- Face boxes: `inputs/face-track.js` (git-ignored). The demo track is generated; for your footage run `npm run face -- inputs/<video>.mp4` (installs OpenCV into `.cache/face-venv` on first run).

## Templates (compositions/tpl): use these, never copy-paste scenes

Mount a template with a host tag and per-instance values:

```html
<div id="card-1-host" class="clip subcomp-host" style="z-index: 40;"
     data-composition-id="glass-card-1" data-composition-src="compositions/tpl/glass-card.html"
     data-start="5.8" data-duration="3.0"
     data-variable-values='{"at":5.8,"dur":3.0,"titlePre":"Add someone","titleAccent":"manually","kind":"fields","items":[{"label":"Name","value":"John Smith"}]}'></div>
```

- 18 templates. Cards and panels: `glass-card`, `app-window`, `contact-card`, `checklist`, `before-after`. Overlays: `lower-third`, `notification-stack`, `spotlight`, `keys`, `link-chip`, `fast-forward`. Text: `kinetic-subtitle`, `quote`, `metric-counter`, `chapter-pill`. Titles: `title-card` (intro | outro). Devices: `imessage-phone`. Transitions: `transition` (`dip`, `flash`, `blur`, `glass-wipe`, `iris`, `light-sweep`, `chapter`; the cut sits at the midpoint).
- `at` / `dur` MUST equal the host's `data-start` / `data-duration` (templates cannot read their host).
- Host ids must not equal an id inside the template (it would render into the host); use `<name>-host`.
- z-index: cards 40, overlays 55-60, title cards 70, subtitles 75, transitions 90+.
- List/object variables are JSON text (HyperFrames has no json type); a host may pass real arrays.
- Positioned templates take `side`, `top`, `offsetX/Y`, `scale`, `safe`; `safe:true` shrinks or flips the card so it never covers the speaker's head (talking head) or the webcam card (screen share, cam-mode aware). Full-frame templates take fewer; read each template's variables.
- `app-window` hosts any mix of panels (`pipeline`, `contact`, `table`, `list`, `stats`, `chat`, `text`, `terminal`, `image`); add a kind in `components/tpl-parts.js`.
- When to use which template or motion: the library cue sheets (source `scripts/library-meta.mjs`).
- Add a template: new file in `compositions/tpl/`, a `use` + `examples` entry in `scripts/library-meta.mjs`, a footprint in `scripts/check-face-clear.mjs`, then `npm run build:library`.

## Director rules

- Punch in (1.15-1.25x) on thesis, punchlines and tonal shifts; never mid-breath or on filler; never hold a tight punch-in over 5 s without a reframe.
- Speaker to PiP (talking head) or zoom (screen share) when the speech turns to software, metrics or a diagram; back to full frame for the conclusion.
- Trim dead air over 0.45 s (`npm run trim`, default `--min-pause 0.45`) with 40 ms handles; never cut mid-word.
- Subtitles: 1-3 punch words per cue (`*word*`), sentence case, one highlight colour.
- Most cuts need no transition; never more than one `flash` per video.

## Design rules

- `components/tokens.css` is the only place for colour, type, glass and corner values. One accent (blue `#2997ff`; `--accent-text` for text over footage), green = done, yellow = attention.
- Type: `system-ui` first, weights 400-700, no text-shadow, tabular figures for numbers.
- Shape: `corner-shape: var(--corner)` on rectangles. Glass is translucent: the footage shows through.
- Motion: spring eases only (`__hfGlass.ease.smooth | snappy | bouncy`). GSAP ignores `cubic-bezier(...)` strings.
- Placeholder copy only (John Smith, Jane Doe, Acme, lorem ipsum). Icons are the kit's own set (`__hfParts.icon`); no Apple assets.

## Tools and commands

```bash
npm run dev            # talking-head preview (blocks until stopped)
npm run share:dev      # screen-share preview
npm run library        # template library + storyboard at http://localhost:4173/library/
npm run trim -- inputs/webcam.mp4 --also inputs/screen.mp4   # cut pauses; prints synced clips + jump-cut times
npm run plan -- transcript.srt --mode screen                  # draft cue plan from a transcript (.srt / .vtt)
npm run face -- inputs/speaker.mp4                            # face track for your talking-head footage (self-installing)
npm run render         # talking head to MP4
npm run share:render   # screen share to MP4
npm run check:all      # every gate below
```

Agents: use `npx hyperframes preview --background` for a persistent preview, check it with `--status`, stop it with `--stop`. Do not wrap `npm run dev` in a background shell.

The CLI is pinned (`hyperframes` 0.8.120 in package.json) so renders stay identical; the npm scripts use that local copy. To upgrade: `npx hyperframes@latest upgrade --project . --check`, then without `--check`.

## Gates: always run after changes

- `npm run check` and `npm run share:check`: lint, runtime, layout, motion and contrast. 0 errors and 0 warnings.
- `npm run check:face`: host contracts and face safety. `share:check` runs the same against the webcam card.
- `npm run check:privacy`: no footage, images, big files or denylisted names in git (optional local `.privacy-denylist`, one term per line).
- Every value must be a pure function of time (renders seek in any order): `fromTo` with explicit start values where tweens on one property meet.
- Look at real frames (`npx hyperframes snapshot <dir> --at ...`) before calling anything done.

## HyperFrames key rules

1. Every timed element needs `data-start` and a duration; give timed visual elements `class="clip"`.
2. Register one paused root timeline per composition: `window.__timelines["<composition-id>"] = gsap.timeline({ paused: true })`. Child timelines added to it must not be paused.
3. A video with sound keeps it on the `<video>` (`data-has-audio="true"`, no `muted`); silent footage gets `muted`. Animate wrappers, never the `<video>` element.
4. Sub-compositions use `data-composition-src`; template roots use `data-duration="600"` so the host governs.
5. Deterministic only: no `Date.now()`, no `Math.random()`, no network fetches.
6. Never put source files behind symlinks inside a project (the bundler reads them as empty); `scripts/sync-share.mjs` copies real files.

## Project structure

```
index.html                talking-head demo (root composition)
projects/screen-share/    screen-share demo: index.html + share.js
compositions/tpl/         the 18 templates
components/               tokens.css, glass CSS, glass-components.js (__hfGlass), screen-stage.js,
                          tpl-runtime.js (vars, place, face/PiP safety), tpl-parts.js (icons, panels), camera.js
scripts/                  auto-trim, cue-plan + cue-rules, checks, library generator, demo media, serve, face-track + detect-face.py
library/                  generated template library (npm run build:library)
assets/demo/              placeholder screens for demos
inputs/                   your footage (git-ignored except README); demo media generated into inputs/_demo/
examples/sample.srt       placeholder transcript for cue-plan
```
