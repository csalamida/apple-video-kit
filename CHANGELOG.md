# Changelog

Update an existing project with `npx github:csalamida/apple-video-kit update` (add `--dry-run` to preview).

## 0.6.0

**Short-form reels (vertical 1080x1920)**
- New mode: `projects/short-form/` with `npm run short:dev | short:check | short:render`.
- Phone safe zones (top 230, bottom 430, right 150 px): every template lays itself out on the canvas and keeps text out of them. The canvas is one file, `components/canvas.js`; landscape is unchanged.
- `npm run reel`: captions must hold readable for 0.5 s after entrance and before exit, never overlap, stay above the bottom zone, and meet contrast (4.5:1 text, 3:1 highlight) on the pill you chose.
- `npm run check:glyphs`: renders every caption cue in headless Chrome at five moments, with and without clips, and fails if lettering is cut. Includes regression words with descenders.
- Captions: `mode: "cumulative"` builds each line word by word (words land on real times from `npm run polish --audio`); `entrance: "edge-fly"` flies words in from alternating sides. Text, highlight and pill colours, opacity and no-pill are all settings.
- `npm run script -- inputs/script.txt`: plan a reel before filming (length, hook inside 3 s, flat stretches, ending action, block ideas, teleprompter file, estimated SRT).
- Four new blocks (23 in total): `progress-bar`, `pointer` (arrow or ring), `sticker`, `media-panel`.
- `npm run face` writes `inputs/face-track.vertical.*` for portrait footage.
- Playbook: `.agents/skills/apple-video-editor/references/short-form.md`.

## 0.5.0
- `npm run polish`: clean up a CapCut transcript (names, punctuation, fillers, word timings, a cut list and a change report).
- `npm run grade`: colour grading with a skin-tone guard that rejects bad grades.
- `npm run qa`: frame-by-frame review of the encoded file, plus a QA page in the library.
- Cutout polish: light wrap, `--erase` for leftovers, `--scale` for speed.
- README rewritten in plain language.

## 0.4.x
- Foreground props (`npm run prop`) keep a microphone in front of the speaker; `npm run plate` removes the person from a generated room; the skill asks which background you want first.

## 0.3.x
- Speaker cutout mode: photoreal scene backgrounds that follow your camera angle, a title behind your head, `npm run backdrop` prompts.

## 0.2.x and earlier
- `npx` installer and updater, the Components and Animations library, screen-share and talking-head modes, face-safe placement, 19 templates, privacy check.
