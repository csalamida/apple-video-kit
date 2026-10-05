/* Camera choreography as DATA. index.html builds its #camera-rig tweens from this,
   and scripts/place.mjs + templates read the same moves to know where the face is
   on screen at any time. Edit here, never hard-code camera tweens in a composition.

   Each move tweens x / y / scale (any subset) from the previous state over `dur`
   seconds with the smooth spring.
     win     speaker WINDOW {x,y,w,h,r} in screen px (omit or 'full' = full frame). Radius/ring stay true pixels.
     fit     'frame' (whole frame inside win) | 'cover' (fill win, face-centred) - replaces explicit x/y/scale.
     front   true = raise above templates while windowed, false = drop back down at the end.
     chrome  {boxShadow} tweened alongside (ring + shadow).

   cuts  jump-cut times (from scripts/auto-trim.mjs). At each cut the framing alternates 1.0 / punch, so the
         jump reads as a deliberate edit. It scales #punch (a wrapper around the video), never the <video>. */
window.__hfCamera = {
  rig: "#camera-rig",
  origin: [960, 540],           // rig transform-origin (50% 50% of 1920x1080)
  cuts: [],                     // e.g. [3.42, 7.9] - paste `cuts` from auto-trim's .cuts.json
  punch: 1.06,
  moves: [
    { t: 2.0,  dur: 2.5, x: 40,   scale: 1.05 },
    { t: 5.8,  dur: 0.6, x: 35,   scale: 1.15 },
    { t: 8.8,  dur: 0.6, x: 35,   scale: 1.12 },
    { t: 11.6, dur: 0.6, x: 35,   scale: 1.14 },
    // Speaker PiP: a 451x254 squircle WINDOW (true 36px radius + ring), whole frame inside it.
    // Sits on the page margin (x=72) with its bottom edge level with the app window (y=950); the headline rail fills the column above it.
    { t: 14.5, dur: 0.8, win: { x: 72, y: 696, w: 451, h: 254, r: 36 }, fit: "frame", front: true,
      chrome: { boxShadow: "0 0 0 2.5px rgba(255, 255, 255, 0.75), 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 40px rgba(41, 151, 255, 0.45)" } },
    // Back to full bleed with the thesis punch-in
    { t: 18.2, dur: 0.8, win: "full", x: 0, y: 0, scale: 1.20, front: false,
      chrome: { boxShadow: "0 0 0 0px rgba(255, 255, 255, 0), 0 28px 70px rgba(0, 0, 0, 0), 0 0 40px rgba(41, 151, 255, 0)" } }
  ]
};
