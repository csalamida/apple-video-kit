# Finishing playbook: transcript, colour, QA

What happens after the edit is designed and before anyone sees it: a clean transcript, colour that is correct and
natural, and a frame-by-frame review of the ENCODED file. Commands and options are in `SKILL.md`; this file is the
judgement around them. Everything here works on any mode (screen share, talking head, speaker cutout).

## 1. Transcript polish (the CapCut flow)

The usual input is a CapCut export: an SRT (sometimes a plain TXT) of auto-captions made from the video AFTER it was edited
in CapCut. So its timings belong to the exported video, not to the raw recording. Never silence-trim the export again
unless the person asks; the only cuts that make sense are filler words they want gone.

CapCut captions are line-level (no word timings), usually lowercase with weak punctuation, they misspell names and product
terms, and they keep "um / uh / you know".

**Ask first (one message):** which file was the export (the timings belong to it); the language (English, or Taglish);
the names and terms that must be spelled exactly (people, products, tools); caption style (readable lines, or fast 2-4 word
karaoke cues); and whether filler words should be cut from the video or only left out of the captions.

**Run:**
```bash
npm run polish -- inputs/capcut.srt --audio inputs/export.mp4 --glossary inputs/glossary.json
```
`--audio` (the same file the transcript came from) enables real word timings through the local transcriber; without it
times are interpolated inside each CapCut cue and are good to about half a second. A plain TXT needs `--audio`.

**Outputs** (next to the input, in git-ignored `inputs/`):
- `*.polished.srt`: clean captions (sentence case, punctuation only where a pause supports it, repeats and stutters collapsed).
- `*.cues.json`: the `cues` array for the `kinetic-subtitle` template, with 1 to 3 `*punch*` words per cue.
- `*.words.json`: every word with start and end and whether the time was `aligned` or `interpolated`.
- `*.fillers.json`: ranges of removable fillers (ums, repeats, false starts, comma-delimited you know / I mean / like) with
  40 ms handles. Feed it to `npm run trim -- <voice file> --cut-list inputs/capcut.fillers.json`.
- `*.polish-report.md`: counts, EVERY change as before and after with a timestamp, and a "needs your review" list.

**Then do the human part, because rules cannot hear meaning:**
1. Read the report and the polished SRT end to end. Fix homophones, names the glossary missed, wrong sentence breaks,
   missing question marks. Do not invent words or change what the speaker said.
2. Take the "possible terms to add to the glossary" list to the person and ask; append confirmed fixes to their local
   `inputs/glossary.json` so the next video is cleaner.
3. Check timing where it matters: fillers you will cut, punch words, the first and last cue.
4. Run `npm run plan -- <polished.srt> --mode screen` (or `talking`) to turn the transcript into a draft cue plan.

**Limits to say out loud:** aligned times are about 50 to 200 ms, interpolated ones about half a second; filler ranges that
are interpolated are low confidence (listed in the report); cut fillers only after listening to a few; `--numbers`
converts spoken numbers only with a unit or a compound number.

## 2. Colour grading

Order of priority: correct first, then a look, never a damaged skin tone. Grading is a prep step that writes a new file, so
the render stays deterministic.

- **Grade only the speaker** (the webcam, the talking head, the speaker cutout). **Never grade a screen recording:** UI
  colours are the truth.
- **Where in the pipeline:** for a cutout, matte first (with the plate and light wrap), then grade the cutout with
  `--match inputs/<plate>` so the speaker sits in the room's colour. For plain footage, grade the source before editing.
- **Process:**
  ```bash
  npm run grade -- inputs/me.cutout.webm --dry-run             # measure and show what it would do
  npm run grade -- inputs/me.cutout.webm --look clean --strength 0.7 --match inputs/office.png
  ```
  It measures 6 frames (exposure, colour cast, clipping, skin hue in the face region), always applies a capped correction
  (white balance within +-600 K, exposure within +-1/3 stop toward a face luma of 115 to 150), then the look, then re-measures
  the written file.
- **Looks:** `clean` (default, neutral, slight contrast), `warm-daylight`, `studio-cool` (cool navy shadows, natural warm
  skin, restrained cyan highlights; subtle by design), `soft-film` (lifted and muted), `none` (correction only). Strength
  0.4 to 0.7 is the working range; 1.0 is for a deliberate look.
- **The skin guard decides, not your eye alone.** It rejects the file (exit 1, output renamed `.rejected`) when skin hue moves
  more than 8 degrees or leaves the skin band, face highlights clip (more than 1%), face shadows crush (more than 2%) or the
  frame clips (more than 3%). Do not use `--force` unless the owner of the video says so, and then say what failed.
- **The face box matters.** The tool reads `inputs/face-track.json`, or `--face x,y,w,h`. A box that misses the face gives a
  weak skin read; it warns and fails the guard instead of passing blindly. Run `npm run face` for real footage.
- Always look at the before/after sheet it writes (`*.grade.jpg`). A white shirt on a pale wall limits what any grade can do.
- Different skin tones sit on the same skin line; if a result looks off anyway, trust the eye, lower the strength, and report it.

## 3. Frame-by-frame QA on the ENCODED file

The preview lies in small ways (fonts, seeking, codec). The acceptance artifact is the rendered MP4.

```bash
npm run render            # or npm run share:render / speaker:render
npm run qa -- renders/<file>.mp4 --page index.html
npm run library           # open http://localhost:4173/library/qa.html
```
`--page` is the composition that made the video: it supplies the expected duration and the cue times (every card enter and
exit, every zoom, camera and scene move). Use `--compare <earlier run>` after a fix to flip between versions on the same frame.

**Automatic checks** (exit code 1 on a failing gate or check, warnings exit 0): resolution; duration against the page (off by
more than 0.1 s fails); audio present when the page expects it; black runs (over 1.2 s fails, shorter mid-video runs warn);
frozen stretches (warn only: static slides and screens freeze legitimately); flash safety (more than 3 large luminance
flashes in any second fails; an approximation of the WCAG 2.3.1 idea); loudness (warns outside -14 LUFS +-2 or above -1 dBTP).

**The human part is the point.** In the viewer: scrub every cue (enter, hold, exit), step frame by frame around each
transition and around every zoom, then fill the 11-category checklist (overlap and collisions; clipping and bounds; blank,
black or stale frames; caption timing; caption safe zones; transition and cue timing; motion and easing; stacking, masks
and PiP; contrast and readability; asset fit and truth; deterministic seeking). Mark a range with A and B and copy the
feedback cue into the chat to say exactly which frames to fix.

- The best verdict the viewer gives is "ready for human sign-off". Automated checks never approve a video; the owner does.
- After a fix, re-render, re-run `qa` with the same `--page`, and re-check the range that failed plus 2 frames either side.
- State a negative plainly. If the flash check fails on a flash transition, change the transition, not the threshold.

## 4. Order of operations for a full video

1. Ask what the video is (mode, place, props, glossary terms) and get the CapCut export.
2. `polish` the transcript; `plan` a draft edit from it.
3. Build the composition (`share.js`, `cutout.js` or `camera.js` plus host tags); matte only what needs it.
4. `grade` the speaker (and cutout) with the skin guard; look at the sheet.
5. `check:all`, snapshots of every cue, then `render`.
6. `qa` the render, review in the viewer, fix, repeat; the person signs off.
7. Nothing that shows the speaker or contains their voice goes in git: it all lives in `inputs/`, `renders/` and `qa/`.
