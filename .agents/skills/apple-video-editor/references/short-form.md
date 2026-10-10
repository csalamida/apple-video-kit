# Short-form playbook: vertical 9:16 reels

For Reels, TikTok and YouTube Shorts: 1080x1920, usually 15 to 60 seconds, a person talking to camera. Commands and options
are in `SKILL.md`; this file is the judgement. Everything else in the kit still applies (templates, `place()`, face check,
polish, grade, qa).

## 0. Ask first (one message)

0. Their caption colours: text, highlight word, pill (or no pill). If they have none, offer 2 or 3 readable pairs and let them pick.
1. The footage: portrait 1080x1920 (shot vertically), or landscape that must be cropped? Ask for portrait; do not stretch a landscape clip.
2. The transcript: a CapCut export is fine (`npm run polish`, see `finishing.md`). Short-form wants shorter cues than long-form.
3. The one idea of the reel and the action at the end (follow, comment, a link). One reel, one idea, one action.
4. Which platform first. The safe zones below fit all three; if only one platform matters you can relax them.
5. Any private data on screen (emails, keys, client names) or logos that need clearing.

## 1. The canvas and the safe zones

`npm run short:dev` syncs `projects/short-form/` with `--canvas vertical`, which writes `components/canvas.js`:

| Zone | Size | Why |
|---|---|---|
| Top | 230 px | platform header, search, "following" tabs |
| Bottom | 430 px | caption, username, sound, progress bar |
| Right | 150 px | like, comment, share buttons |
| Left | 64 px | breathing room |

Rules the tools enforce (`npm run reel`, also run by `short:check` and `short:render`):
- Captions sit with their bottom edge at least 430 px from the bottom (`bottom: 470` by default) and are at least 44 px tall text (52 to 72 px reads on a phone).
- Cards (lower-third, metric, link chip, quote ...) keep their whole footprint inside the top and bottom zones. `place()` also keeps them inside the side zones and off the face.
- The page is 1080x1920 and every host covers the whole frame.
- Numbers are conservative, not official. If a platform changes its interface, edit them in `scripts/sync-share.mjs`.

Templates scale with `scale`, not with the canvas: on a phone the default sizes are small. Start from lower-third `1.6-1.8`, link chip `1.5-1.7`, metric counter `1.0-1.1`.

## 2. Shape of a reel

- **0 to 3 s is the hook.** The first caption starts within 1 s of the first word. Say the promise or the problem, not "hi, I'm...". A title card or a `title-behind` line may carry it; a lower-third with a name does not.
- **One beat every 2 to 3 seconds.** A new caption, a card, a zoom or a cut. A talking head with nothing changing for 5 seconds loses people; a card that appears every second is noise.
- **Land the action in the last 3 seconds.** The link chip or an end card, with the spoken ask under it.
- Keep the speaker's face in the upper-middle. Face at 25 to 45 percent of the height leaves the bottom for captions.

## 3. Captions

The reading rules matter more than the style.

- **Settled hold.** A cue is on screen `entrance 0.24 s + readable hold + exit 0.16 s`. The readable hold must be at least 0.5 s (`--min-hold` to change it). A short word timestamp must never become a flash: merge it with its neighbour or lengthen the cue. `npm run reel` fails on this.
- **About 6 words per cue, at most 4 words per second.** Warnings, not failures.
- **Cues never overlap.** One caption on screen at a time.
- **Cumulative reveal:** `"mode": "cumulative"` makes the line build word by word as it is spoken. The pill keeps its final size from the first word, so nothing jumps. Without word times the words spread over the first part of the cue and the last 0.5 s is left to read. With real times, pass `"times": [s1, s2, ...]` (absolute seconds, one per word, from `*.words.json` after `npm run polish --audio`) on the cue. `"mode": "whole"` (default) shows the whole cue at once. With cumulative, `"entrance": "edge-fly"` makes each word fly in from alternating sides and settle (words wrapped in `*stars*` travel farther, rotate more and settle slower); the default `rise` is a short lift. Travel shrinks on a narrow canvas so words do not leave the frame. Earlier words stay; the finished phrase holds still.
- **Colours are the owner's choice.** Ask for them; never pick a brand look for someone. `color` (text), `accent` (the `*star*` words), `bg` + `bgAlpha` (pill) or `"pill": false` (plain text with a soft shadow), all hex values on the `kinetic-subtitle` host. `npm run reel` fails text under 4.5:1 and highlight under 3:1 against the pill colour, and warns on a see-through pill or no pill (the footage decides the contrast then; look at the lightest frames).
- **Emphasis:** wrap 1 to 3 punch words per cue in `*stars*`. They take the accent colour and a small pulse.
- **Position and motion never share a transform.** If you add your own caption animation, put the layout anchor (where it sits) on one wrapper and the entrance motion on an inner one. Two writers on the same `y` make captions jump on seek. Single writer per property is already the kit rule; this is where captions break it.
- **No clipping of glyphs.** Never put `overflow: hidden`, `clip-path` or a `mask` on a cue or its words: it cuts descenders (g, j, p, q, y), italic overhangs and gradient edges. A bounding box that fits is not proof the letters are whole. `npm run reel` fails on a clipping rule in the page or the template, and warns on `background-clip: text` (gradient paint boxes crop). Always look at the encoded frames of the longest and most descender-heavy cues.
- Captions come from the polished transcript: `npm run polish -- inputs/capcut.srt --audio inputs/reel.mp4`, then paste `*.cues.json` into the host's `cues`. The CapCut export is already edited, so its timings belong to that file.

## 4. Which block for which job (vertical)

Match the block to the job the beat is doing, never to "it would look cool here". If you cannot name the job in one sentence, you do not need a block yet.

| Block | Reach for it when | Do not when |
|---|---|---|
| `kinetic-subtitle` | Always. Every spoken word that carries the idea | The beat is silent or music only |
| `lower-third` | A guest or a new person is introduced; once, in the first 5 s | It is only the creator's own name, again |
| `metric-counter` | A number is the point ("42%", "3x") and it is spoken | The number is decoration |
| `link-chip` | The ask in the last 3 s: link, code, handle | Anywhere else, or more than once |
| `glass-card` / `checklist` | 2 to 4 parallel points the speaker lists | Anything more than 4 (use two reels) |
| `quote` | A line from someone else, with attribution | Your own tagline |
| `notification-stack`, `imessage-phone` | The story literally is a message or a notification | A generic "social proof" feel |
| `fast-forward` | Skipping a wait on a screen recording | Talking-head footage |
| `transition` | A real change of topic or scene. Prefer `blur` or `dip`; `flash` counts toward the flash-safety check (at most 3 big flashes per second) | Between every caption |
| `title-behind` | Speaker cutout with a clear head and shoulders | No cutout: the text would sit on the face |
| `spotlight`, `before-after`, `app-window`, `keys` | Screen content is shown; give it room above the caption zone | The frame is only a face |

Blocks that need a wide frame (`app-window` split, `before-after`) work in portrait only at the narrower width; check the snapshot.

## 5. Build

```bash
npm run short:dev      # preview (demo with a faceless silhouette, no footage needed)
npm run face -- inputs/reel.mp4        # portrait footage writes inputs/face-track.vertical.json + .js (git-ignored)
npm run short:check    # face clear + reel rules + HyperFrames lint, layout, motion, contrast
npm run short:render   # blocks on the reel rules, then renders 1080x1920 @ 30 fps
npm run qa -- renders/<file>.mp4 --page projects/short-form/index.html
```

1. Put the vertical clip in `inputs/` and point `<video id="footage">` in `projects/short-form/index.html` at it. Set `data-duration` on it and on `#root`.
2. Replace the demo host tags with the reel's own. Host ids end in `-host` and never equal an id inside the template; `at` and `dur` equal the host's `data-start` and `data-duration`.
3. `npm run short:check`. Fix every failure; a warning needs a reason.
4. Take snapshots (`npx hyperframes snapshot projects/short-form --at ...`) at the first caption, each card, each transition and the end, and look at them.
5. Render, run `qa` with `--page`, and review the encoded frames in `/library/qa.html`: every cue enter, hold and exit; the frames either side of each transition; the longest caption. The checks never approve a reel; the owner does.

## 6. Limits to say out loud

- Safe zones are estimates. Check the first export on a real phone in the target app before posting.
- The demo uses a silhouette. Face-safe placement on real footage needs `npm run face` to find the face; if the track misses (hand over face, turned head) cards can land on it, so look at the frames.
- Landscape-only blocks and the screen-share stage are not made for 9:16.
- The cumulative reveal is the kit's own generic version, not a copy of any named style. Fonts and gradient fills are not settings yet. There is no ink-level glyph detector: the only proof letters are whole is a focused render of the real phrases (plus the words with the tallest descenders and italics) compared with plain unclipped text, looked at before entry, mid-entry, at peak, in the hold and at exit.
- Nothing that shows the speaker or contains their voice goes in git: it lives in `inputs/`, `renders/` and `qa/`.
