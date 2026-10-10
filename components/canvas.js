/**
 * canvas.js - the size of the video. Landscape 1920x1080 by default.
 * A vertical project (projects/short-form) gets its own copy from `scripts/sync-share.mjs --canvas vertical`,
 * so every template lays itself out on 1080x1920 and keeps captions and cards inside the platform safe zones.
 *
 *   w, h      canvas size in px
 *   safe      px the platform interface covers (top, bottom, left, right). 0 = nothing reserved.
 *   caption   where captions sit: distance from the bottom edge, and the largest font size that still fits
 */
(function (root) {
  root.__hfCanvas = { name: 'landscape', w: 1920, h: 1080, safe: { top: 0, bottom: 0, left: 0, right: 0 }, caption: { bottom: 46, size: 38 } };
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--cw', root.__hfCanvas.w + 'px');
    document.documentElement.style.setProperty('--ch', root.__hfCanvas.h + 'px');
    if (root.__hfCanvas.h > root.__hfCanvas.w) document.documentElement.classList.add('vertical');
  }
})(typeof window !== 'undefined' ? window : this);
