# inputs/

Your source media goes here. Everything in this folder except this README and the demo face track is git-ignored, so your footage never ends up in the repo.

| File | Used by |
|---|---|
| `speaker.mp4` (any name) | Talking-head video (`index.html`, `#footage`) and the webcam card in screen-share |
| `screen.mp4` | Screen recording for `projects/screen-share` (silent; voice comes from the webcam file) |
| `face-track.js` / `.json` | Face boxes that keep cards off your face. Regenerate with `scripts/detect-face.py` |

The demo files in `inputs/_demo/` are generated on first run (a faceless silhouette and a test pattern). Point the `<video>` `src` at your own file to replace them.
