/* Screen-share video as DATA. Edit this file; index.html never changes per video.
   Sources:  screen -> #screen <video> in index.html (silent window/screen recording)
             cam    -> #cam <video> in index.html (webcam, carries the voice)
   zooms:    at time t, ease (dur seconds, spring) to zoom z centred on (x,y) of the screen, both 0-1.
             Overview = { t, z: 1 }. Hold until the next keyframe. Aim for 1.5-1.9 when pointing at a control,
             2.0-2.5 only for small text. Zoom OUT again before the next topic.
   pip:      overrides for components/screen-stage.js DEFAULT_PIP (tall bottom-left card that tucks to
             minScale as the screen zooms in). focus = where to centre the face in the card (0-1).
   drift:    slow push-in while a zoom holds (true or { amount: 0.035, minHold: 1.5 }).
   cam:      webcam moments: { t, mode: 'full' } talk straight to the viewer, 'pip' back to the card, 'hide' tuck it away.
   cuts:     jump-cut times; the webcam alternates 1.0 / punch (1.06) framing at each so the jump reads as an edit.
   focus / callouts / redact: screen regions in 0-1 coords { x, y, w, h } that follow every zoom.
     focus    { t, end, ... dim }      darken everything else ("look at this section")
     callouts { t, end, ..., label, side: 'bottom' | 'top' | 'left' | 'right' }   ring + label ("click this")
     redact   { t?, end?, ..., style: 'blur' | 'solid' }   hide emails, keys, client names (whole video if no t/end) */
window.__hfShare = {
  duration: 21.92,                    // composition length (same as data-duration in index.html)
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
  drift: true,
  pip: { focus: { x: 0.5, y: 0.4 } },
  cam: [
    { t: 0.0, mode: 'full' },                     // open on the speaker
    { t: 2.4, mode: 'pip' },                      // then shrink to the card as the screen takes over
    { t: 13.4, mode: 'hide' },                    // dense part: get the webcam out of the way
    { t: 15.2, mode: 'pip' },
    { t: 20.0, mode: 'full' }                     // sign-off to camera
  ],
  cuts: [6.1, 11.2],
  callouts: [{ t: 9.6, end: 12.6, x: 0.38, y: 0.80, w: 0.24, h: 0.12, label: 'Press submit', side: 'top' }],
  focus: [{ t: 16.1, end: 19.2, x: 0.25, y: 0.18, w: 0.5, h: 0.26 }],
  redact: [{ x: 0.70, y: 0.04, w: 0.26, h: 0.08 }]   // e.g. an email address in the corner, hidden for the whole video
};
