# inputs/

Your source media goes here. Everything in this folder except this README is git-ignored, so your footage and your face track never end up in the repo.

| File | Used by |
|---|---|
| `speaker.mp4` (any name) | Talking-head video (`index.html`, `#footage`) and the webcam card in screen-share |
| `screen.mp4` | Screen recording for `projects/screen-share` (silent; voice comes from the webcam file) |
| `face-track.js` / `.json` | Face boxes that keep cards off your face. Generated (git-ignored), see below |

The demo files in `inputs/_demo/` are generated on first run (a faceless silhouette and a test pattern). Point the `<video>` `src` at your own file to replace them.

The face track is generated too: when `inputs/face-track.js` is missing, `npm run media` (and `check:face`, `check:all`) writes a demo track that matches the silhouette. For your own footage run `npm run face -- inputs/<your video>.mp4`, which overwrites it with the real track. It stays on your machine; a track of your face is never committed.
