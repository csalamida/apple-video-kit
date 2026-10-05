/* Screen-share video as DATA. Edit this file; index.html never changes per video.
   Sources:  screen -> #screen <video> in index.html (silent window/screen recording)
             cam    -> #cam <video> in index.html (webcam, carries the voice)
   zooms:    at time t, ease (dur seconds, spring) to zoom z centred on (x,y) of the screen, both 0-1.
             Overview = { t, z: 1 }. Hold until the next keyframe. Aim for 1.5-1.9 when pointing at a control,
             2.0-2.5 only for small text. Zoom OUT again before the next topic.
   pip:      overrides for components/screen-stage.js DEFAULT_PIP (tall bottom-left card that tucks to
             minScale as the screen zooms in). focus = where to centre the face in the card (0-1). */
window.__hfShare = {
  aspect: 1.825,                      // source screen aspect (width / height); sets the window height
  window: { r: 18 },                  // x/y/w/h default to the reference geometry (93.5% wide, centred)
  zooms: [
    { t: 3.2,  x: 0.50, y: 0.42, z: 1.6 },   // "fill out the form"
    { t: 7.4,  z: 1 },
    { t: 9.0,  x: 0.50, y: 0.86, z: 1.7 },   // "press submit"
    { t: 13.0, z: 1 },
    { t: 15.5, x: 0.50, y: 0.30, z: 1.9 },   // "check the details"
    { t: 19.5, z: 1 }
  ],
  pip: { focus: { x: 0.52, y: 0.4 } }
};
