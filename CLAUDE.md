# Apple Video Kit (HyperFrames project)

Apple-style motion graphics for tutorial videos: a screen-share stage (primary) and a talking-head mode, built from parameterized templates. Everything per video is data.

## Read first

- `.agents/skills/apple-video-editor/SKILL.md`: the house rules (modes, cue-to-template guide, stage engine, design rules, gates). Read it before writing or editing a composition.
- HyperFrames framework skills (`/hyperframes`, `/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-cli`): install with `npx hyperframes skills update`. Start at `/hyperframes` for framework questions.
- Docs: `npx hyperframes docs <topic>` (offline), or discover pages via `https://hyperframes.heygen.com/llms.txt` (do not guess URLs).

## Three modes

| Mode | Files | Per-video data |
|---|---|---|
| Screen share (primary) | `projects/screen-share/index.html` | `projects/screen-share/share.js` |
| Talking head | `index.html` | `components/camera.js` + template host tags |
| Speaker cutout (scenes) | `projects/speaker-cutout/index.html` | `projects/speaker-cutout/cutout.js` |

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

### Speaker cutout (scenes)

Read `.agents/skills/apple-video-editor/references/speaker-cutout.md` before running the cutout commands (shooting, plates, props, verification, troubleshooting). Start by asking the person which place they want (office by default), which stretches need the cutout, and whether a mic must stay in front of them; hand over the `npm run backdrop` prompt and ask for the image in a message by itself or saved as `inputs/<scene>.png`.

Layers bottom to top: `#orig` (your video, voice) z5, `#bgs` backgrounds z10, `title-behind` hosts z30, `#cut` (transparent cutout) z50, your overlays z55+. Engine: `components/cutout-stage.js`.

`cutout.js` keys: `backgrounds: [{ t, dur?, kind: 'scene' | 'gradient' | 'color' | 'image' | 'blur', ... }]` (first entry t:0, later ones crossfade in), `speaker: { shadow, x, y, scale }`, `moves: [{ t, dur, x, y, scale }]`, `parallax: 0.12`, `foreground: [{ src }]` (props in front of the speaker, z 52).
- `npm run cutout -- <video> [--from s --to s] [--edge 0-3]`: transparent VP9 via HyperFrames' local `remove-background`. Slow (about 0.5-1 frame/s): matte only the stretches that use it. Output is git-ignored (`inputs/`).
- `npm run backdrop -- <video> --scene office|studio|living-room|cafe|library|conference-room` (or `--describe "..."`): measures the speaker's framing and light and writes the prompt for a scene that matches the camera angle (eye-line = horizon, shot type, key light side, warmth). Save the generated image as `inputs/<scene>.png` and use `{ kind: 'scene', src }`.
- `npm run plate -- <image with the person in it>`: removes the person (matte + inpaint) so the image works as an empty plate; prefer an empty room from backdrop prompt A.
- `npm run prop -- <video> --at s --box x,y,w,h --name mic --keep dark [--exclude "x,y,w,h;..."]`: the cutout model keeps people only, so a mic or mug in front of the speaker is dropped. This cuts it once from a frame (OpenCV GrabCut, installs itself) into `inputs/<name>.prop.png`, a full-frame transparent PNG for `foreground`. Static objects only; check the `.preview.png` it writes.
- Face safety assumes the speaker does not move; with `moves`, mount cards with `safe:false` on the freed side. Never use `title-behind` without the cutout above it; the template marks its own text `data-layout-allow-occlusion` (the layout check reads that flag on the text, not on the cover).

## Finishing (every mode)

Read `.agents/skills/apple-video-editor/references/finishing.md` first. Three steps after the design is built:
- `npm run polish -- inputs/capcut.srt --audio inputs/export.mp4 --glossary inputs/glossary.json`: a CapCut transcript becomes clean captions (`.polished.srt`), kinetic-subtitle `cues` (`.cues.json`), word timings, a filler cut list (`.fillers.json`, use with `npm run trim -- <voice file> --cut-list ...`) and a report of every change. The CapCut export is already edited: its timings belong to that file, never silence-trim it again. Read the report, fix what rules cannot hear, ask about new names, keep a local `inputs/glossary.json`.
- `npm run grade -- <speaker video or cutout.webm> [--look clean|warm-daylight|studio-cool|soft-film|none] [--strength 0.7] [--match <plate>]`: capped correction first (white balance, exposure from the face), then a look, then a skin guard that rejects the file if skin hue moves over 8 degrees or the face clips. Speaker only, never screen recordings. Look at the `.grade.jpg` sheet.
- `npm run qa -- renders/<file>.mp4 --page <composition>`: gates (size, duration vs the page, audio), black, frozen, flash safety and loudness checks, every frame saved to `qa/<name>/`, reviewed in `/library/qa.html` (cue strip, Mark A/B feedback cues, the 11-category checklist). It never approves a video; the person signs off.

## Templates (compositions/tpl): use these, never copy-paste scenes

Mount a template with a host tag and per-instance values:

```html
<div id="card-1-host" class="clip subcomp-host" style="z-index: 40;"
     data-composition-id="glass-card-1" data-composition-src="compositions/tpl/glass-card.html"
     data-start="5.8" data-duration="3.0"
     data-variable-values='{"at":5.8,"dur":3.0,"titlePre":"Add someone","titleAccent":"manually","kind":"fields","items":[{"label":"Name","value":"John Smith"}]}'></div>
```

- 19 templates. Cards and panels: `glass-card`, `app-window`, `contact-card`, `checklist`, `before-after`. Overlays: `lower-third`, `notification-stack`, `spotlight`, `keys`, `link-chip`, `fast-forward`. Text: `kinetic-subtitle`, `quote`, `metric-counter`, `chapter-pill`. Titles: `title-card` (intro | outro), `title-behind` (needs the speaker cutout). Devices: `imessage-phone`. Transitions: `transition` (`dip`, `flash`, `blur`, `glass-wipe`, `iris`, `light-sweep`, `chapter`; the cut sits at the midpoint).
- `at` / `dur` MUST equal the host's `data-start` / `data-duration` (templates cannot read their host).
- Host ids must not equal an id inside the template (it would render into the host); use `<name>-host`.
- z-index: title-behind 30 (under the cutout), cards 40, cutout 50, overlays 55-60, title cards 70, subtitles 75, transitions 90+.
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
npm run library        # Components (http://localhost:4173/library/) + Animations (/library/motion.html), storyboard drawer
npm run trim -- inputs/webcam.mp4 --also inputs/screen.mp4   # cut pauses; prints synced clips + jump-cut times
npm run plan -- transcript.srt --mode screen                  # draft cue plan from a transcript (.srt / .vtt)
npm run face -- inputs/speaker.mp4                            # face track for your talking-head footage (self-installing)
npm run speaker:dev    # speaker-cutout demo (scenes, title behind you)
npm run cutout -- inputs/me.mp4 --from 10 --to 25      # transparent video of the speaker (slow, local)
npm run backdrop -- inputs/me.mp4 --scene office       # prompt for a scene that matches the camera angle
npm run render         # talking head to MP4
npm run share:render   # screen share to MP4
npm run polish -- inputs/capcut.srt --audio inputs/export.mp4   # clean a CapCut transcript
npm run grade -- inputs/me.cutout.webm --dry-run               # colour grade the speaker with a skin guard
npm run qa -- renders/video.mp4 --page index.html              # frame-by-frame QA of the render
npm run check:all      # every gate below
```

Kit updates: `npx github:csalamida/apple-video-kit update` (the CLI is `bin/apple-video-kit.mjs`). It replaces kit files only and never touches `inputs/`, `index.html`, `components/camera.js`, `projects/**`, `meta.json`, `hyperframes.json`. Edited kit files are backed up to `.kit/backup/`. Put per-video changes in your files, not in kit files.

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
projects/speaker-cutout/  speaker-cutout demo: index.html + cutout.js
compositions/tpl/         the 19 templates
components/               tokens.css, glass CSS, glass-components.js (__hfGlass), screen-stage.js,
                          tpl-runtime.js (vars, place, face/PiP safety), tpl-parts.js (icons, panels), camera.js, cutout-stage.js
scripts/                  auto-trim, cue-plan + cue-rules, cutout, backdrop, plate, prop, polish, grade, qa, checks, library generator, demo media, serve, face-track + detect-face.py
library/                  generated template library (npm run build:library)
assets/demo/              placeholder screens for demos
inputs/                   your footage (git-ignored except README); demo media generated into inputs/_demo/
examples/sample.srt       placeholder transcript for cue-plan
```
