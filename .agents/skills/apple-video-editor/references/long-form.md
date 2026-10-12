# Long-form playbook: 10 to 30 minute videos

For a tutorial or a talk that runs 10 to 30 minutes: a screen share with a webcam card, or a talking head. Commands and options are in `SKILL.md`; this file is the judgement and the measured limits. The finishing playbook (`finishing.md`) still applies for the transcript, grading and review.

## 0. Ask first (one message)

1. **Which kind:** screen share with a webcam card, talking head (centred, no screen), or talking head with a few cutout moments.
2. **Is the file already edited?** An editorially final master (already cut in CapCut or similar): keep every frame, order and the continuous audio; add graphics around it, never trim it again. Raw footage: only then are cuts and reframing allowed.
3. **The transcript:** a CapCut export is fine (`npm run polish -- ... --audio <the export>`). Its times belong to the edited file.
4. **Chapters:** wanted on screen (chapter pill), in the YouTube description, or both. Titles are the owner's: the planner's keyword titles are guesses.
5. **Audio:** is there a music bed, and is the voice clean? Target loudness (-14 LUFS is the default).
6. **Private data on screen** (emails, keys, client names) and which parts of the screen must never be covered.
7. **Their caption colours** (see `short-form.md`; the rule is the same).

## 1. Order of work

1. `npm run polish -- inputs/capcut.srt --audio inputs/export.mp4` (clean transcript, word times, filler cut list).
2. `npm run chapters -- inputs/capcut.polished.srt` (chapters, YouTube timestamps, the pill schedule, cold-open check, recap points, pattern-interrupt slots). Read `*.chapters.md` and rename every title marked review.
3. Screen share only: `npm run activity -- inputs/screen.mp4` (a draft of zooms and idle stretches). Check every suggestion against what the speaker says.
4. `npm run plan -- inputs/capcut.polished.srt --mode screen|talking` (draft of graphics). Then thin it by hand: see section 3.
5. Write the page (`share.js` plus host tags, or `camera.js` plus host tags). Mark `keepClear` regions (section 2).
6. `npm run share:check` (or `check`, `speaker:check`) until it is clean. Take snapshots of every graphic.
7. Render with `render:long` (section 4), then `npm run audio -- renders/<file>.mp4`, then `npm run qa -- renders/<file>.mp4 --page <page>`.
8. The owner reviews. Nothing that shows the speaker or holds their voice goes in git.

## 2. Share screen with a webcam card: the screen is the content

A card that covers a button the speaker is explaining is a worse edit than no card. The kit protects the webcam card by itself; the screen needs your input.

- **`keepClear`** in `share.js`: `keepClear: [{ t, end, x, y, w, h }]` in 0 to 1 screen coordinates (time window optional). Mark the button, the field, the line of code. The regions follow every zoom. A card with `safe: true` moves off them (to the other side or a free gap); `npm run share:check` FAILS a card that still covers one, and warns when a caption sits on one.
- Prefer screen-native tools over cards: zoom, callout ring, focus dim, blur box. They live inside the screen and follow the zoom.
- Cards go on the webcam side or in the margin around the screen window, not over the screen window. `place()` keeps cards off the webcam card automatically.
- The webcam: card while the screen matters, `hide` for dense stretches, `full` only for the intro, an opinion or the sign-off. Never move the card to another corner.
- `npm run activity` finds where pixels change (typing, menus, page loads) and where nothing does (idle). It does not understand meaning, and a spinner or a clock looks like activity. Idle stretches of 3 s or more are candidates for the fast-forward badge or a cut; check the audio before cutting.
- Redact first, always: emails, keys, client names, even when not spoken.

## 3. Talking head (centred): pace and variety

- Default to the speaker full frame. A visual earns the frame only when it shows something speech cannot, then clears and the speaker gets the frame back.
- Do not add a graphic to fill dead air or to match a cadence. Do not repeat the same lower-third; introduce a person once.
- A pattern interrupt about every 30 to 60 s: a zoom, a punch-in on a cut, a card, a cutaway. `*.chapters.md` lists slots at 45 s steps; fill the ones that need it, skip the ones where the picture is already moving.
- The first 30 s state what the viewer gets and a concrete result. Greet after that, not before.
- A 5 s spoken recap at the end of any chapter longer than 4 minutes, and at the end.
- Cutout in a long video: matte only the stretches that need it (the intro, a few title moments, the outro): `npm run cutout -- inputs/me.mp4 --ranges "0-25,310-330,1170-1200"`. It is resumable: stretches already done are skipped when you run it again.

## 4. Rendering a long video

Measured with `npm run stress` on a synthetic share-screen project (a test-pattern screen, the demo speaker, about 6 blocks a minute, a caption every 2.6 s, zooms and cam moves; no real footage). Run it on your machine before trusting any of this.

| Measured on one MacBook (Apple M3 Pro, 11 cores) | 2 min video | 5 min video | 20 min video |
|---|---|---|---|
| `hyperframes check` | 68 to 76 s | 78 s | not measured; it did not grow with length (about 80 s expected) |
| Plain render | 346 s (2.9x real time) | 800 s (2.7x; other jobs were running) | not measured; about 55 to 60 min if it stays linear |
| Segmented render (`render:long`) | 219 s (1.8x), measured once | not measured | not measured; about 35 to 40 min if it stays linear |
| Output file (standard quality) | 108 MB | 292 MB | about 1.1 to 1.2 GB if linear |
| Peak memory of the render process (Chrome workers are extra, about 256 MB each) | 602 MB | 793 MB | grows slowly |

- **The check does not slow down with length** (it samples the composition), so `share:check` stays usable on a 20 minute project. The Node placement check takes under a second.
- **The segmented render was faster than the plain one in this test** (1.8x against 2.9x real time). The two runs also differed in capture mode, so do not read this as "segmenting is faster": run `npm run stress -- --minutes 2 --render` and `--segmented` on your machine and compare.
- **Resume was verified.** A segmented render of the 2 minute project (2 segments of about a minute each) was stopped after both segments had finished capturing; running the same command again logged "resuming: 2 segments complete", skipped both and finished in 4 s. The output was 1920x1080, 3600 frames, 120 s, with audio. A render stopped in the middle of a segment loses that half-captured segment (about a minute of video), not the whole video.
- A 20 minute render has not been run. The stress project is synthetic: a real screen recording decodes slower than a test pattern.

- **`npm run share:render:long`** (or `render:long`, `speaker:render:long`): HyperFrames' segmented capture plus resume. Finished segments are kept; run the same command again after a crash or a closed lid and it continues. `--low-memory` for 8 GB machines; `--workers N` to tune.
- **Close other heavy apps**: a render competes with anything else using the CPU.
- Source video: screen recordings are the heavy input. A 1080p screen recording at a high bitrate decodes slower than a synthetic one: expect longer than the numbers above.
- Plan the machine for it: leave it plugged in and awake (`caffeinate -i` on macOS).

## 5. Finishing

- **Audio:** `npm run audio -- renders/<file>.mp4 [--denoise] [--music bed.mp3 --music-db -24 --duck 8]`. Measures loudness, optional rumble and noise cleanup, a music bed that ducks under the voice (levelled first, so quiet and loud recordings duck the same), two-pass normalise to -14 LUFS, the picture copied untouched. Verified by measuring the written file. It cannot judge whether it sounds good: listen to it.
- **Sound effects (optional):** `npm run sfx -- <page>` writes a quiet effects track from the cues; mix it with `npm run audio -- <render> --music inputs/sfx.wav --music-db -6`. A sound on every card is too much in a 20 minute video: keep transitions, chapter changes and chips, drop the rest.
- **Review:** `npm run qa` samples at most about 3600 frames (every 10th frame on a 20 minute video). To inspect a stretch frame by frame, cut it out and run `qa` on the part. Read every cue, every transition and the longest caption in the viewer. The checks never approve a video; the owner does.
- **YouTube:** `*.chapters.txt` pastes into the description (first line 0:00, three or more chapters, 10 s or more each). Upload a reviewed SRT, not the raw CapCut one.

## 6. Limits to say out loud

- Everything here was measured on short demos and on synthetic projects of 2 and 5 minutes, never on a real 20 minute video. The 20 minute figures above are extrapolations and are labelled as such.
- Chapter detection is a draft: it hears spoken markers, pauses and vocabulary change, not meaning.
- `activity` sees pixels change, not what they mean.
- Keep-clear regions only help if someone marks them.
- A passing check is not approval.
