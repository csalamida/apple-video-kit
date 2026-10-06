# Apple Video Kit

Apple-style motion graphics for tutorial videos, built on [HyperFrames](https://hyperframes.heygen.com) (videos written as HTML + GSAP, rendered to MP4).

Two formats:

- **Screen share**: your screen recording floats on a wallpaper, zooms in on what you are talking about, and your webcam sits in a tall card bottom-left that tucks away while the screen zooms.
- **Talking head**: your camera full frame, with glass cards, lower-thirds, subtitles and a speaker picture-in-picture that keep clear of your face automatically.

Everything is data. You describe a video as times and settings ("at 3.2 s zoom to the form", "at 9 s put a callout on the submit button"); the kit does the motion.

> Not affiliated with Apple Inc. "Apple-style" describes the design language (springs, glass, squircles, system type). No Apple assets are included: icons are original, fonts are your system's.

## Quick start

Needs Node 22+ and ffmpeg. Python 3.9+ only for face detection on your own talking-head footage (its OpenCV dependency installs itself on first use).

```bash
npm install
npm run dev            # talking-head demo in the HyperFrames studio
npm run share:dev      # screen-share demo
npm run library        # then open http://localhost:4173/library/
```

The demos ship with no real footage. On first run the kit generates a faceless placeholder speaker, a test-pattern screen and a matching demo face track (all git-ignored).

## Use your own footage

1. Put your files in `inputs/` (git-ignored, so they never end up in the repo).
2. Screen share: point `#screen` (silent screen recording) and `#cam` (webcam with your voice) in `projects/screen-share/index.html` at them. Talking head: point `#footage` in `index.html` at your video.
3. Talking head only: `npm run face -- inputs/your-video.mp4` once so cards know where your face is. The first run sets up a private Python environment in `.cache/` and installs OpenCV (about 40 MB); it writes `inputs/face-track.js`, which stays out of git.
4. Describe the video:
   - screen share: `projects/screen-share/share.js` (zooms, webcam moments, callouts, focus, redaction, jump cuts)
   - talking head: `components/camera.js` (camera moves) and template host tags in `index.html`
5. `npm run share:render` or `npm run render`.

## What is in the box

**The library** (`npm run library`, then `/library/`) is the menu: every block with a live preview, editable props, a "when to use it" note with the spoken cues that call for it, and a storyboard you can fill in and copy out as host tags or as a plan to hand to an AI editor.

| Blocks (`compositions/tpl/`) | Use it when you say... |
|---|---|
| `glass-card`, `app-window`, `contact-card` | "here is how it works", "let me show you", "this record" |
| `lower-third`, `title-card` | first seconds of the video, intro and end cards |
| `chapter-pill`, `checklist` | "three ways", "step two", "to recap" |
| `kinetic-subtitle`, `quote` | every sentence; "the key is" |
| `metric-counter` | a number |
| `notification-stack`, `imessage-phone` | "you get a text", "an alert fires" |
| `keys` | "press Command K" |
| `before-after` | "before", "after", "it used to look like" |
| `link-chip` | "link in the description" |
| `fast-forward` | a sped-up or skipped stretch |
| `spotlight` | "look at this part" (talking head) |
| `transition` | section changes: dip, flash, blur, glass wipe, iris, light sweep, chapter |

**Screen-share moves** (`projects/screen-share/share.js`): zoom + slow drift, callout, focus dim, redact, webcam full / card / hidden, jump-cut punch.

**Editing tools**

```bash
node scripts/auto-trim.mjs inputs/webcam.mp4 --also inputs/screen.mp4   # cut pauses; prints synced clips + jump-cut times
node scripts/cue-plan.mjs inputs/transcript.srt --mode screen            # transcript -> suggested blocks and moves
```

**Checks**

```bash
npm run check:all      # everything below
npm run check          # HyperFrames lint, layout, motion and contrast (talking head)
npm run share:check    # same for screen share, plus cards vs the webcam card
npm run check:face     # host contracts + no card covers the speaker's face
npm run check:privacy  # no footage, images, big files or denylisted names in git
```

`check:privacy` reads an optional, git-ignored `.privacy-denylist` (one name per line) so you can block your own name, clients or emails from ever being committed. Hook it up as a pre-commit hook:

```bash
printf '#!/bin/sh\nnode scripts/check-privacy.mjs || exit 1\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## Working with an AI editor

`CLAUDE.md` / `AGENTS.md` and `.agents/skills/apple-video-editor/SKILL.md` hold the house rules (design, timing, gates), so Claude Code, Codex and similar agents can direct and edit with the kit. A good loop: run `cue-plan` on your transcript, pick blocks in the library storyboard, paste the plan to the agent, review the render.

## License

MIT. See `LICENSE`.
