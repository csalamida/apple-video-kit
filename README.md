# Apple Video Kit

Apple-style motion graphics for tutorial videos, built on [HyperFrames](https://hyperframes.heygen.com) (videos written as HTML + GSAP, rendered to MP4).

Two formats:

- **Screen share**: your screen recording floats on a wallpaper, zooms in on what you are talking about, and your webcam sits in a tall card bottom-left that tucks away while the screen zooms.
- **Talking head**: your camera full frame, with glass cards, lower-thirds, subtitles and a speaker picture-in-picture that keep clear of your face automatically.

Everything is data. You describe a video as times and settings ("at 3.2 s zoom to the form", "at 9 s put a callout on the submit button"); the kit does the motion.

> Not affiliated with Apple Inc. "Apple-style" describes the design language (springs, glass, squircles, system type). No Apple assets are included: icons are original, fonts are your system's.

## Quick start

Needs Node 22+ and ffmpeg. Python 3.9+ only for face detection on your own talking-head footage (its OpenCV dependency installs itself on first use).

Start a new project:

```bash
npx github:csalamida/apple-video-kit init my-video
cd my-video
npm install
npm run library        # browse the components and animations at http://localhost:4173/library/
npm run share:dev      # screen-share demo
npm run dev            # talking-head demo
```

Or clone this repo and run `npm install` in it.

The demos ship with no real footage. On first run the kit generates a faceless placeholder speaker, a test-pattern screen and a matching demo face track (all git-ignored).

## Updating

Get the latest templates, moves, tools and docs without losing your work. Run inside your project:

```bash
npx github:csalamida/apple-video-kit update --dry-run   # see what would change
npx github:csalamida/apple-video-kit update
npm install && npm run build:library && npm run check:all
```

- **Updated:** the kit's own files: `compositions/tpl/`, `components/` (except `camera.js`), `scripts/`, `library/`, `assets/demo/`, the docs and the skill. New `package.json` scripts and versions are merged in; your name, version and extra scripts stay.
- **Never touched:** your files: `inputs/` (footage and face track), `index.html`, `components/camera.js`, everything in `projects/` (your `share.js` and pages), `meta.json`, `hyperframes.json` and `.privacy-denylist`.
- **Your edits are safe:** if you changed a kit file (say you tweaked a template), your version is copied to `.kit/backup/<time>/` before it is replaced, and the update lists those files.
- The kit records what it installed in `.kit/manifest.json`; commit it so the next update can tell your edits apart from old kit files. Cloned this repo instead? `git pull` works too, or run the update command in your clone.

## Use your own footage

1. Put your files in `inputs/` (git-ignored, so they never end up in the repo).
2. Screen share: point `#screen` (silent screen recording) and `#cam` (webcam with your voice) in `projects/screen-share/index.html` at them. Talking head: point `#footage` in `index.html` at your video.
3. Talking head only: `npm run face -- inputs/your-video.mp4` once so cards know where your face is. The first run sets up a private Python environment in `.cache/` and installs OpenCV (about 40 MB); it writes `inputs/face-track.js`, which stays out of git.
4. Describe the video:
   - screen share: `projects/screen-share/share.js` (zooms, webcam moments, callouts, focus, redaction, jump cuts)
   - talking head: `components/camera.js` (camera moves) and template host tags in `index.html`
5. `npm run share:render` or `npm run render`.

## What is in the box

**The library** (`npm run library`) has two pages:
- **Components** (`/library/`): a gallery of every block. Hover to play, click to open it with a live preview over the speaker, editable props, a "when to use it" note and the copy-ready host tag. A storyboard drawer collects blocks with times and copies them out as host tags or as a plan for an AI editor.
- **Animations** (`/library/motion.html`): every move, playable: screen-share moves, camera moves, the transition library, the three springs, and a "which motion when" cheat sheet.

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
| `title-behind` | the hook or the one idea, with the cutout (type behind your head) |

**Speaker cutout and scenes** (`projects/speaker-cutout/`): remove the background behind you and put yourself in a place.
- **Background:** a photoreal room (office, studio, living room, cafe, library, conference room) that matches your camera angle, a studio colour, your own room blurred, or your own image. Backgrounds crossfade, and the room drifts slightly when you move (parallax).
- **Title behind you:** big type that sits behind your head while you talk in front of it (`title-behind`).
- **Speaker aside:** you glide to one side and shrink to make room for a card or a number.

```bash
npm run cutout -- inputs/me.mp4 --from 10 --to 25     # transparent video of you (local AI, nothing uploaded)
npm run backdrop -- inputs/me.mp4 --scene office       # measures your framing and light, writes the image prompt
npm run prop -- inputs/me.mp4 --at 8 --box 230,770,560,310 --name mic --keep dark   # bring your mic back (see below)
npm run speaker:dev                                    # the demo: faceless placeholder, stylised office
```

The matting model keeps people only, so a microphone or mug in front of you disappears. `npm run prop` cuts such an object out of one frame (OpenCV GrabCut inside the box you give it; the Python packages install themselves) into a transparent full-frame PNG, and `foreground: [{ src: 'inputs/mic.prop.png' }]` in `cutout.js` layers it back in front of you, exactly where it is in the footage. It writes a `.preview.png`; use `--exclude "x,y,w,h;..."` to clear leftovers. For things that do not move.

`npm run cutout` uses HyperFrames' own background-removal model. It is slow (about 0.5 to 1 frame per second on a laptop, 10 s of 30 fps video is roughly 5 minutes), so cut only the stretches that use it with `--from` and `--to`. The first run downloads the model (about 170 MB). Hair and shoulders come out clean; a piece of a chair or object right behind you can survive (re-record against a plain background, or keep it out of frame).

The full workflow, with the reasons and a troubleshooting table, is in `.agents/skills/apple-video-editor/references/speaker-cutout.md`.

`npm run backdrop` makes the scene match you. It measures from a frame of your video (no upload): where your eyes sit (the horizon the room must share), how big your head is, which side the light comes from, how bright you are and how warm the room is. It writes two prompts: a text-only one for any image model, and an image-edit one to use with the reference frame it saves. Generate the image with the tool you prefer (ask for an empty room; if you only get an image with you in it, `npm run plate -- inputs/room-with-me.png --out inputs/office.png` removes you), save it as `inputs/office.png`, and add `{ kind: 'scene', src: 'inputs/office.png', blur: 3 }` to `cutout.js`. Not included: automatic light wrap on the edges (the matte edge is cleaned, not re-lit).

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
npm run speaker:check  # same for the speaker-cutout demo
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
