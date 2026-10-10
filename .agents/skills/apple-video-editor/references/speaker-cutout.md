# Speaker cutout playbook

How to take, prepare and manage the pieces of a speaker-cutout video: the transparent speaker, the room behind them,
props in front of them, and the titles in between. Read this before running `npm run cutout`, `backdrop`, `plate` or
`prop`. Commands and keys are in `SKILL.md` section 4; this file is the knowledge around them.

## 0. Intake: ask before you run anything

A cutout job depends on choices only the person can make, and the slow steps (matting) are expensive to redo. Ask these in
ONE message, with a default for each, then wait:

1. **Which place?** "An office (default), a studio, a living room, a cafe, a library, a conference room, or describe your own.
   Do you already have an image of it?"
2. **Which parts of the video need the cutout?** The hook? A topic change? Give time ranges; matting runs at about 1 frame per
   second, so only those stretches get matted.
3. **Is anything in front of you that has to stay?** A microphone, a mug. If yes: at which time is it clearly visible?
4. **A title behind your head?** What does it say, and when?
5. **Who generates the room?** You give them the prompt (`npm run backdrop`); they generate it with their own tool, or say so
   if you may use a connected tool. Some tools charge per image: never spend someone's credits without a clear yes.

Then the handoff:
- Run `npm run backdrop -- <video> --scene <place>` and hand over **prompt A** (an empty room). Offer prompt B (image edit,
  with the reference frame) only if the generator cannot match the angle from text.
- Ask them to **paste the finished image in a message by itself**, or save it as `inputs/<scene>.png`. An image pasted in
  the middle of a task is visible to you but is not saved as a file, so you cannot use its pixels; only a normal message's
  attachment is saved. Say this up front so the round trip works the first time.
- If the image still has a person in it, `npm run plate`. If they decline a background altogether, use a gradient or their own
  blurred room and carry on: never block the video on the plate.
- Check the image with the section 4 checklist and tell them plainly what is wrong ("the horizon is too high", "there is a
  chair in the middle") instead of silently compositing a bad plate.

## 1. What it is, and when to use it

The speaker is cut out of the footage and layered between a background (a room, a colour, their own blurred room) and
whatever is in front of them (a mic). That unlocks: a scene that matches the camera angle, type BEHIND the head, and the
speaker gliding aside to make room for a card.

Use it for the moments that earn it: the hook, a thesis line, a topic change, a sign-off. Do not matte a whole 10-minute
video: matting runs at about 0.5-1 frame per second on a laptop (10 s of 30 fps video is roughly 5 minutes). In screen share,
the webcam card does not need it.

## 2. Shooting for a clean matte

The model keeps people only. Make its job easy at recording time; no edit fixes a bad matte as well as a good take.

- Even, soft light on the face; no hard shadows across the hair or shoulders.
- Clothing that contrasts with the wall behind. A white shirt on a pale wall is the hard case; a mid-tone shirt is easy.
- Keep objects away from the body: a chair back, headphones, a lamp behind the head all leave remnants (a piece of the
  chair beside the neck is the classic). If a chair must show, it belongs in the plate, not the matte.
- Hold one framing and one lens for the whole video. The plate is matched to one angle; a changed zoom breaks the match.
- Gear in front of you (a mic on an arm) is dropped by the matte: plan to bring it back as a prop (section 6).
- Avoid fast hand motion across the face (motion blur gives a ragged matte).

## 3. The pipeline, in order

All outputs go to `inputs/`, which is git-ignored: your face never reaches git.

| Step | Command | Produces | Check it |
|---|---|---|---|
| 1. Face track (optional, enables auto title placement) | `npm run face -- inputs/me.mp4` | `inputs/face-track.js` | `npm run check:face` |
| 2. Transparent speaker | `npm run cutout -- inputs/me.mp4 --from 10 --to 25 [--plate inputs/office.png --wrap 0.3] [--erase "x,y,w,h"]` | `inputs/me.cutout.webm` | composite over a bright flat colour AND over the plate; look at hair, glasses, shoulders, neck |
| 3. Scene prompt | `npm run backdrop -- inputs/me.mp4 --scene office` | `me.backdrop.txt`, `.json`, `.frame.png` | numbers sensible (eye-line, shot size, light side) |
| 4. Generate the room | any image generator, with prompt A (or B) | an image | section 4 checklist |
| 5. Plate (only if the image has a person in it) | `npm run plate -- inputs/room-with-me.png --out inputs/office.png` | `inputs/office.png` | no ghost of the person |
| 6. Props | `npm run prop -- inputs/me.mp4 --at 8 --box x,y,w,h --name mic --keep dark` | `inputs/mic.prop.png` + `.preview.png` | open the preview |
| 7. Compose | edit `projects/speaker-cutout/cutout.js`, `index.html` | | `npm run speaker:check`, snapshots |

The finishing pass (OpenCV, one frame at a time) takes colour from your original footage, refines the edge against the full-resolution picture, drops stray islands (`--despeckle`, default 3% of the largest piece) and can bake a light wrap into the edge (`--plate` + `--wrap`). `--scale 0.5` mattes a half-size copy (about 1.4x faster here, near-identical edges; try it on long takes). Python 3.9+ is needed; OpenCV installs itself on first use.

`--from/--to` give the cutout the same time offset as the source: the printed `<video>` tag already carries the matching
`data-start`. Matte every stretch that uses the cutout, nothing else.

## 4. Getting the room (the part that decides realism)

`npm run backdrop` measures a frame of the footage (no AI, no upload) and writes two prompts:

| Prompt | Input | Gives | Use when |
|---|---|---|---|
| A, text only | nothing | an EMPTY room | default. Cleanest plate, no chair or gear, nothing to remove |
| B, image edit | the saved `.frame.png` | the same photo with a new room behind the person | the generator cannot match the angle from text alone |

What the numbers encode, and why they matter:
- **Eye-line (% from the top)** is the horizon. The room must share it, or the speaker looks pasted in.
- **Shot size (head height %)** sets how much room is visible and how blurred it should be.
- **Key-light side and warmth** decide where the window light comes from and the colour temperature; a mismatch is the
  fastest way to look fake. `brightness` and `tone` in the scene settings nudge the plate toward the speaker.

Checklist before accepting a generated room: horizon near the stated eye-line; verticals straight; light from the stated
side; 16:9, at least 1920x1080; no people, no text or logos; nothing important in the area behind the head (type and the
speaker cover it); depth of field soft, not a flat illustration.

If the image still has the person (prompt B): run `npm run plate`. It mattes the person, grows the matte, inpaints that area
(hidden behind the live cutout) and scales to 1920x1080. Chairs and gear in the image stay in the plate. Prefer prompt A:
a plate made this way shows a blurred patch where the person sat as soon as the speaker glides aside.

## 5. Composing

Layers, bottom to top: `#orig` z5 (the voice), `#bgs` z10, `title-behind` z30, `#cut` z50, props z52, overlays z55+.

- **Backgrounds** crossfade over `dur` (default 0.8 s). One plate for most of a video; change scene only at a topic or mood
  change, and keep changes at least 4 s apart. A gradient or the blurred own room is the fallback when no plate exists.
- **`blur` on a scene** is depth of field: 3 for a sharp-but-soft room, 6 to 9 to hide plate flaws, never more than 16.
- **`parallax`** 0.08 to 0.15. The room drifts that fraction of the speaker's glide; more looks like a rocking boat.
- **`title-behind`**: one per minute at most, 3 to 4 s, at least 200 px type, 2 lines. It centres itself on the upper head
  from the face track; the head covers about a third of the words, so choose words that survive that. It only works with
  the cutout above it.
- **Speaker aside**: `moves` with `x` (px) and `scale`; the speaker pivots from the bottom edge so the bust stays on the
  frame edge. Face safety assumes the speaker stays put: mount cards with `safe:false` on the freed side.
- **Z and layout checks:** nothing to do for `title-behind` (it marks its own text as intentionally covered).

## 6. Props in front of the speaker

The matte drops anything that is not a person, so a mic, mug or laptop corner vanishes. `npm run prop` cuts it once from a
frame (OpenCV GrabCut inside `--box`) and `foreground: [{ src }]` layers it back at z 52 exactly where it was.

- Static objects only (a mic on an arm). Something that moves needs a different approach.
- `--keep dark` for a dark object on a lighter room: it drops bright, warm and saturated pixels (wood, wall, shelf books)
  and keeps a lit ring or LED.
- Open the `.preview.png` (the prop on a flat colour). Grabbed too much: add `--exclude "x,y,w,h;..."` boxes around the
  leftovers. Lost parts: widen `--box` or raise `--dark`.
- Cut from a frame where the object is not blurred and nothing is held in front of it.

## 7. Verifying

`npm run speaker:check` (host contracts, lint, layout, motion, contrast), then snapshots at: the cutout's first frame, a hold,
the title-behind peak, a scene change mid-crossfade, the speaker aside. Judge by eye:

- Light wrap, if used: visible as a soft room-coloured rim, never a hard grey outline.
- Edges: no dark halo on a light shirt, no light halo on dark hair (`--edge 2` for a stronger clean-up, `0` to disable).
- The speaker's light matches the room's (side, warmth, brightness).
- Props sit on the desk, not floating; the mic overlaps the shirt, not the face.
- No ghost of a person in the plate; no smear visible when the speaker moves.
- Text behind the head is still readable.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Piece of the chair beside the neck | model keeps what touches the body; despeckle cannot remove what is connected to you | `--erase "x,y,w,h"` on a frame you looked at (find the coordinates on YOUR footage; boxes are rectangles, so keep them clear of the face and accept a thin sliver along a slanted jaw), or re-shoot without the chair |
| Dark fringe on a light shirt | matte edge | the finishing pass already pulls colour from the original; `--edge 2` for more |
| Light wrap looks like a grey rim | `--wrap` too high for this plate | 0.2 to 0.4 is the tasteful range; 1.0 is heavy |
| Flickering matte edge | low-contrast edge or motion blur | `--quality best`, better light, avoid fast motion |
| Ghost of the person at the edges | the plate has the person in it | `npm run plate`, or generate an empty room with prompt A |
| Blurry patch behind the speaker when they glide | inpainted fill from `npm run plate` | use an empty plate (prompt A) |
| Mic or mug missing | matte keeps people only | `npm run prop` and `foreground` |
| Horizontal cut across the chest after scaling | wrong pivot (old versions) | update the kit; the origin is the bottom edge |
| Scene does not show, speaker silhouette video visible | background container under the original video | update the kit (`#bgs` has z-index 10) |
| Room looks pasted on | horizon, light side or warmth mismatch | regenerate with the measured prompt; adjust `brightness` and `tone` |
| Layout check says text is hidden | title behind the cutout | use the `title-behind` template (it marks its text); do not hand-write it |
| Cutout takes hours | 1 frame/s model | matte only the stretches that use it |

## 9. Privacy and managing the files

- Everything that contains the speaker (cutouts, reference frames, masks, prompts with measured numbers, face tracks,
  prop cut-outs) lives in `inputs/`, which is git-ignored. `npm run check:privacy` blocks videos, images (except the kit's
  demo assets) and any name on the local `.privacy-denylist`.
- The kit ships only faceless demo material: a generated silhouette, a stylised office, a silhouette cutout. Never add a
  photo or a real name to the repo, to docs, to this skill or to examples.
- The reference frame shows the face: attach it only to an image tool you trust, and prefer prompt A (text only).
- Some image generators charge per image. Say so before generating on someone's account.
- Naming: `inputs/<video>.cutout.webm`, `inputs/<scene>.png`, `inputs/<name>.prop.png`, `inputs/<video>.backdrop.txt`.
  Regenerate rather than hand-edit: every step is a command.
- Keep the kit current with `npx github:csalamida/apple-video-kit update`; it never touches `inputs/`, your page or `cutout.js`.
