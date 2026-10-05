# HyperFrames Composition Project

## Skills — USE THESE FIRST

**Always invoke the relevant skill before writing or modifying compositions.** Skills encode framework-specific patterns (e.g., `window.__timelines` registration, `data-*` attribute semantics, shader-compatible CSS rules) that are NOT in generic web docs. Skipping them produces broken compositions.

**Doing anything with HyperFrames?** Start at `/hyperframes` — it tells you what HyperFrames can do and which skill or workflow handles your intent (make a video, TTS / BGM, prep footage, author / animate, render, install blocks), confirms your brief up front (the intent layer), and routes every "make me a…" request (a video, a deck, a composition port) to the right workflow. Read it first, especially when there's no project context to orient you. The workflows it routes to:

- `/product-launch-video` — any **website** URL or brief / script → a product launch / SaaS / promo video, or a site tour / showcase featuring the site's own captured visuals.
- `/faceless-explainer` — arbitrary text (topic / article / notes), **no URL, no website capture** → 60-90s faceless explainer.
- `/embedded-captions` — an existing talking-head video (MP4) → the same footage with captions / subtitles added (rail + embed, or pure-cinematic embed); the footage itself is untouched.
- `/talking-head-recut` — an existing talking-head / interview / podcast video (MP4) → the same footage **packaged with designed graphic overlays** (kinetic titles, lower-thirds, data callouts, pull-quotes, side panels, pip) synced to the transcript; the clip plays unchanged underneath. (Plain captions/subtitles → `/embedded-captions`.)
- `/pr-to-video` — a GitHub PR (URL / `owner/repo#N` / "this PR") → 30-90s code-change explainer (changelog / feature reveal / fix / refactor).
- `/motion-graphics` — a short (typically under 10s) design-led **motion graphic**, motion-is-the-message, no narration: kinetic type, a stat / number count-up, a chart, a logo sting, a lower-third / overlay, or an animated tweet / headline / captured-page highlight; rendered to MP4 or a transparent overlay. Longer / narrated / custom → `/general-video`.
- `/music-to-video` — a **music track** (audio file, video to pull audio from, or one generated from a mood brief) → beat-synced video (lyric / slideshow / kinetic promo). Music drives pacing; user-supplied images / videos are cut onto the same beat grid.
- `/slideshow` — a **presentation / pitch deck / interactive deck** — discrete slides, fragment reveals, branching, hotspot navigation, presenter mode. Output is a navigable deck, not a rendered video.
- `/general-video` — fallback for any other video (title card, longer brand / sizzle reel, multi-scene montage, static loop, custom composition) and the home of **companion mode** — co-create with the full HyperFrames toolbox; the original hyperframes authoring flow, any length.

**Porting an existing composition?** `/remotion-to-hyperframes` translates a Remotion (React) composition into HyperFrames HTML — a source migration, separate from the creation workflows above.

The domain skills (`/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-keyframes`, `/hyperframes-creative`, `/hyperframes-cli`, `/media-use`, `/hyperframes-audio`, `/hyperframes-registry`, `/figma`) and the specialized production suite (`/apple-video-editor`, `/lottie-video-sync`, `/kinetic-animejs-typography`, `/svg-asset-generator`, `/logo-designer`) live inside `/hyperframes` — they work hand-in-hand automatically.

### Unified Video Production Stack (Auto-Invoked)
When creating or editing video content with footage and subtitles (MP4 + SRT):
- **`/apple-video-editor`** — Governs visual architecture: Apple glassmorphism (`backdrop-filter: blur(32px)`), continuous curvature, SF Pro typography, seek-safe dolly zooms, and fluid Picture-in-Picture (PiP) docking.
- **`/lottie-video-sync`** — Integrates and seeks deterministic vector Lottie animations (`window.__hfLottie`).
- **`/kinetic-animejs-typography`** — Drives kinetic text splitting, scrambles, and line-drawn SVG paths (`window.__hfAnime`).
- **`/svg-asset-generator`** — Generates razor-sharp device frames (macOS/iOS), audio waveforms, and AI asset cutouts (`remove-background`).
- **`/hyperframes-core` & `/hyperframes-keyframes`** — Guarantees seek-safe GSAP timeline execution (`window.__timelines["main"]`), deterministic audio sync, and 0-error check passes.

### Video Director Guardrails & Editing Rules (Do's & Don'ts)
When directing video pacing from SRT timestamps:
1. **Camera Punch-Ins / Zooms:**
   - **DO:** Punch in (1.15x–1.25x) on emotional emphasis, core thesis statements, punchlines, or tonal shifts. Accompany with an edge-defocus pulse (`0.35s`).
   - **DON'T:** Zoom in during mid-sentence breaths, filler words, or continuous flat narrative. Never hold a tight punch-in longer than 5 seconds without a reframe.
2. **Picture-in-Picture (PiP) Transitions:**
   - **DO:** Dock the speaker to the top-right corner card whenever the speech pivots to explaining a concept, metric, code snippet, or diagram.
   - **DON'T:** Leave the speaker full-bleed while describing visual concepts off-screen.
   - **DO:** Return the speaker to full-bleed when delivering the conclusion or summary takeaway.
3. **Jumpcuts & Silence Snapping:**
   - **DO:** Trim dead air pauses (>0.4s) using `data-start`, `data-duration`, and `data-media-start` on `<video>` clips.
   - **DON'T:** Cut audio mid-word; preserve 40ms audio pre-roll and post-roll handles.
4. **Kinetic Typography & Highlights:**
   - **DO:** Highlight exactly 1–3 punch words per sentence in Apple Electric Blue (`#2997ff`) synchronized to the exact spoken second.
   - **DON'T:** Highlight every word or create chaotic karaoke-style flashing that exhausts the viewer.
5. **Technical Execution:**
   - **DO:** Animate inner wrappers (`#video-card`), never the `<video>` element directly.
   - **DO:** Always verify using `npm run check` and ensure 0 errors and 0 warnings.
   - **DON'T:** Use non-deterministic code (`Date.now()`, unseeded `Math.random()`, or network fetches).

**Changing how real footage or images look or reveal?** Load `/media-use` and read its `references/media-treatments.md` before editing, even when the request only says dark, flat, boring, retro, private, or “make the reveal cooler.” It governs how footage is treated, never whether media may be used. Use canonical media treatments and seek-safe motion; do not improvise equivalent CSS/SVG filters or overlays.

> **Tailwind v4 projects** (`hyperframes init --tailwind`): see `/hyperframes-core` → `references/tailwind.md`.

> **Using a HyperFrames plugin?** Load skills from that installed bundle and follow
> its `hyperframes/references/plugin-installation.md` execution rules. Update via
> the plugin manager, not the standalone commands below.
>
> **Standalone skill missing or stale?** Run `npx hyperframes skills update <name>` to install/refresh
> the specific skill you need (the `/hyperframes` router does this automatically before
> entering a workflow), or bare `npx hyperframes skills update` to refresh the core set plus
> everything already installed — neither pulls the full set. Restart the agent session so
> newly installed skills load.

## Screen-share videos (main format): projects/screen-share

Most videos are a screen recording plus a webcam, Screen Studio style: wallpaper > floating rounded screen window > tall webcam PiP bottom-left.
Everything per video is DATA in `projects/screen-share/share.js` (zooms + PiP overrides); `index.html` only points at the two videos
(`#screen` silent screen recording, `#cam` webcam with the voice). Engine: `components/screen-stage.js`.

- Zooms: `{ t, x, y, z }` = at time t ease (0.7 s spring) to zoom z centred on (x,y) of the screen (0-1); `{ t, z: 1 }` = overview. 1.5-1.9x for controls, 2.0-2.5x only for tiny text, zoom out between topics.
- PiP (measured from a real reference): 267x427 at 1920x1080 (14% x 40%, ~5:8), bottom-left at (26, 24), radius 42, soft shadow and NO ring. It stays on screen while the screen zooms and tucks to 0.7x (scale from its bottom-left corner) as the zoom reaches ~1.7x. Never move it to another corner.
- Templates (captions, lower-third, notification, spotlight) work on top: mount them with `data-composition-src="compositions/tpl/..."`; in this project `place()` keeps them off the PiP rectangle instead of the face. Use `kinetic-subtitle` bottom-centre.
- Commands: `npm run share:dev` (preview), `npm run share:check`, `npm run share:render`. Sources are not committed: put your files in `inputs/` and point `#screen` / `#cam` at them; if `inputs/_demo/screen.mp4` is missing the share:* scripts generate a synthetic test clip. `inputs/` and `assets/` are linked in by `scripts/sync-share.mjs` (not tracked symlinks, so Windows works).
- The cursor is baked into the screen recording: never synthesise or restyle one.
- Cue sheet: the library lists the SCREEN SHARE motion cues; edit `scripts/library-meta.mjs`.

## Templates (compositions/tpl) - USE THESE, DON'T COPY-PASTE SCENES

Every on-screen graphic is a parameterized HyperFrames template: one HTML file declares typed variables
(`data-composition-variables`), you mount it with a host tag and per-instance values (`data-variable-values`).
Browse, edit and preview them live at `npm run build:library` then `http://localhost:4173/library/`.

```html
<div id="card-1" class="clip subcomp-host" style="z-index: 40;"
     data-composition-id="glass-card-1" data-composition-src="compositions/tpl/glass-card.html"
     data-start="5.8" data-duration="3.0"
     data-variable-values='{"at":5.8,"dur":3.0,"titlePre":"Add Someone","titleAccent":"Manually","kind":"fields","items":[{"label":"Name","value":"Alex"}]}'></div>
```

- Core 10: `glass-card`, `app-window`, `contact-card`, `lower-third`, `chapter-pill`, `notification-stack`, `spotlight`, `kinetic-subtitle`, `metric-counter`, `imessage-phone`.
- `at` / `dur` variables MUST equal the host's `data-start` / `data-duration` (templates cannot read their host; `npm run check:face` enforces it).
- List/object variables are JSON text (HyperFrames has no json type); a host may pass a real array/object.
- WHEN to use which template or motion: the cue sheet at the top of the library (spoken cue to template, and cue to camera/animation). Source: `scripts/library-meta.mjs` (`use`, `examples`, `MOTION`); edit it, then `npm run build:library`. Every template page card also has a "When to use" block.
- `app-window` hosts any mix of panels (`pipeline`, `contact`, `table`, `list`, `stats`, `chat`, `text`, `terminal`, `image`); add a kind in `components/tpl-parts.js` (PANELS). `layout:"rail"` puts the headline in the free left column above the speaker PiP.
- Every template has `side`, `top`, `offsetX/Y`, `scale`, `safe`. With `safe:true` the card shrinks or flips so it never covers the speaker's head.
- Camera moves are DATA in `components/camera.js` (index.html builds its tweens from it). Face boxes live in `inputs/face-track.js`; regenerate with `scripts/detect-face.py` (opencv in a temp venv) if the footage changes.
- Speaker PiP / split rail are WINDOW moves in `camera.js` (`win`, `fit: 'frame'|'cover'`, `front`, `chrome`) driven by `__hfGlass.stage` (`dockPiP`, `undockPiP`, `splitStage`, `keynoteEmphasis` all use it). The window morphs; footage is only panned/scaled, so it never re-crops, and radius/ring stay true pixels. Never animate `width`/`height` on the `<video>`.
- Use the spring eases `__hfGlass.ease.smooth|snappy|bouncy`. GSAP ignores `cubic-bezier(...)` strings.
- Tokens: `components/tokens.css` is the only place for colour, type, glass and corner values. One accent (blue), weights 400-700, no text-shadow. Use `--accent-text` for text over footage.
- Gates: `npm run check` (lint/layout/motion/contrast) and `npm run check:face` must both pass.

## Commands

```bash
npm run dev          # human-operated foreground preview (blocks until stopped)
npx hyperframes preview --background  # agent-safe persistent Studio preview
npx hyperframes preview --status      # verify the persistent preview is listening
npx hyperframes preview --stop        # stop it when review is finished
npm run check        # lint + runtime + layout + motion + contrast (one command)
npm run render       # render to MP4
npm run publish      # publish and get a shareable link
npx hyperframes lint --verbose  # include info-level findings
npx hyperframes lint --json     # machine-readable output for CI
npx hyperframes docs <topic> # reference docs in terminal
```

> **Agents must use `npx hyperframes preview --background` for Studio handoff.** Do not rely
> on a shell/tool `run_in_background` wrapper around `npm run dev`: that foreground process
> remains owned by the invoking session and can disappear while the browser stays open,
> leaving refreshes at `ERR_CONNECTION_TIMED_OUT`. Verify with `preview --status`, keep it
> alive through review, and stop it explicitly with `preview --stop` afterward.

> **Pinned CLI version.** These scripts pin an exact `hyperframes@X.Y.Z` so this project re-renders identically over time. Weeks later that pin lags fixes shipped since. To move up: `npx hyperframes@latest upgrade --project . --check` (shows the delta), then `npx hyperframes@latest upgrade --project .` to rewrite the pins. Always unpinned — the pinned script re-runs the old version against itself.

## Documentation

**For quick reference**, use the local CLI docs command (no network required):

```bash
npx hyperframes docs <topic>
```

Topics: `data-attributes`, `gsap`, `compositions`, `rendering`, `examples`, `troubleshooting`

**For full documentation**, discover pages via the machine-readable index — do NOT guess URLs:

```
https://hyperframes.heygen.com/llms.txt
```

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `meta.json` — project metadata (id, name)
- `transcript.json` — whisper word-level transcript (if generated)

## Linting — ALWAYS RUN AFTER CHANGES

After creating or editing any `.html` composition, **always** run the full check before considering the task complete:

```bash
npm run check
```

Fix all errors before presenting the result. Warnings should be reviewed before rendering.

## Key Rules

1. Every timed element needs `data-start` and a duration. `data-start` is what marks it as timed; `data-track-index` is an optional Studio display lane the render never reads
2. Give timed visual elements `class="clip"`. The framework keys visibility off `data-start`, not the class, but the shared `.clip` CSS is what gives a scene its full-frame box, and `lint` warns without it
3. Register one paused root timeline per composition on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
   Scene timelines manually added to this root must not be paused. A paused
   child does not advance when the root is seeked. The runtime activates
   registered composition siblings, not arbitrary nested scene timelines.
4. A video with sound keeps it on the `<video>` (`data-has-audio="true"`, no `muted`). Use a separate `<audio>` for music, voiceover, replacement audio, J/L cuts, or audio detached in Studio. Silent footage and b-roll: `muted`.
5. Sub-compositions use `data-composition-src="compositions/file.html"` to reference other HTML files
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches
