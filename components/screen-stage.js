/**
 * screen-stage.js - screen-share composition engine (Screen Studio style).
 *
 *   wallpaper  >  floating rounded SCREEN window (pan/zoom inside it)  >  tall webcam PiP bottom-left
 *
 * Everything is data (see projects/screen-share/share.js):
 *   zooms: [{ t, dur?, x, y, z }]   at time t, ease to zoom z centred on (x,y) of the screen (0-1). z:1 = overview.
 *   pip:   { x, y, w, h, r, minScale, zoomRef, ... }   PiP tucks to minScale as the screen zooms toward zoomRef.
 * Measured from a real reference export: PiP 14% x 40% of the frame, bottom-left at ~1.3% / 2.2%, radius ~16% of its
 * width, soft shadow (no ring), 1.0x at rest and ~0.7x while the screen is zoomed in (about 25 zoom events in 6 min).
 * Works in the browser (window.__hfShare) and in Node (scripts load it with a fake window).
 */
(function (root) {
  'use strict';
  var S = {}, W = 1920, H = 1080;
  function smooth(p) { return p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 + 8 * p) * Math.exp(-8 * p); }

  S.DEFAULT_PIP = { x: 26, y: 24, w: 267, h: 427, r: 42, minScale: 0.7, zoomRef: 1.7, shadow: '0 18px 50px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.25)' };

  // Screen window rect on the 1920x1080 stage. Defaults mirror the reference (93.5% wide, centred, 18px radius).
  S.windowRect = function (d) {
    var win = d.window || {}, aspect = d.aspect || 1.825;
    var w = win.w || Math.round(W * 0.935);
    var h = win.h || Math.min(1000, Math.round(w / aspect));
    return { x: win.x !== undefined ? win.x : Math.round((W - w) / 2), y: win.y !== undefined ? win.y : Math.round((H - h) / 2), w: w, h: h, r: win.r || 18 };
  };

  S.pip = function (d) { var p = {}, k; for (k in S.DEFAULT_PIP) p[k] = S.DEFAULT_PIP[k]; for (k in (d.pip || {})) p[k] = d.pip[k]; return p; };

  // Pan target that puts (x,y) of the screen at the window centre, never exposing the window's empty edge.
  S.zoomTarget = function (rect, k) {
    var z = k.z || 1, fx = (k.x != null ? k.x : 0.5) * rect.w, fy = (k.y != null ? k.y : 0.5) * rect.h;
    return {
      x: Math.min(0, Math.max(rect.w - rect.w * z, rect.w / 2 - fx * z)),
      y: Math.min(0, Math.max(rect.h - rect.h * z, rect.h / 2 - fy * z)),
      scale: z
    };
  };

  // PiP scale for a given screen zoom.
  S.pipScale = function (z, pip) { var k = Math.max(0, Math.min(1, (z - 1) / ((pip.zoomRef || 1.7) - 1))); return 1 + ((pip.minScale || 0.7) - 1) * k; };

  // Sorted keyframes with each duration clipped to the next keyframe's start, so tweens never overlap.
  S.normalize = function (d) {
    var z = (d.zooms || []).slice().sort(function (a, b) { return a.t - b.t; });
    return z.map(function (k, i) {
      var next = z[i + 1], dur = k.dur || 0.7;
      if (next) dur = Math.max(0.05, Math.min(dur, next.t - k.t));
      return { t: k.t, x: k.x, y: k.y, z: k.z, dur: dur };
    });
  };

  // State {x,y,scale,pip} at time t (same maths as the tweens), for checks and library previews.
  S.stateAt = function (d, t) {
    var rect = S.windowRect(d), pip = S.pip(d), s = { x: 0, y: 0, scale: 1, pip: 1 };
    S.normalize(d).forEach(function (k) {
      if (t < k.t) return;
      var tg = S.zoomTarget(rect, k), pz = S.pipScale(k.z || 1, pip), kk = smooth((t - k.t) / k.dur);
      s = { x: s.x + (tg.x - s.x) * kk, y: s.y + (tg.y - s.y) * kk, scale: s.scale + (tg.scale - s.scale) * kk, pip: s.pip + (pz - s.pip) * kk };
    });
    return s;
  };

  // Lays out the DOM (ids: #wall #win #pan #pip) and adds the zoom tweens to `tl`.
  S.layout = function (d) {
    var r = S.windowRect(d), p = S.pip(d), $ = function (id) { return document.getElementById(id); };
    var win = $('win'), pip = $('pip');
    win.style.cssText += ';left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;border-radius:' + r.r + 'px';
    pip.style.cssText += ';left:' + p.x + 'px;top:' + (H - p.y - p.h) + 'px;width:' + p.w + 'px;height:' + p.h + 'px;border-radius:' + p.r + 'px;box-shadow:' + p.shadow;
    var cam = $('cam');
    if (cam && p.focus) cam.style.objectPosition = (p.focus.x * 100) + '% ' + (p.focus.y * 100) + '%';
    var wall = $('wall'); if (wall && d.wallpaper) wall.style.background = d.wallpaper;
  };

  S.build = function (tl, d) {
    var r = S.windowRect(d), p = S.pip(d), E = (root.__hfGlass && root.__hfGlass.ease && root.__hfGlass.ease.smooth) || smooth;
    tl.set('#pan', { x: 0, y: 0, scale: 1, transformOrigin: '0 0' }, 0);
    tl.set('#pip', { scale: 1, transformOrigin: '0% 100%' }, 0);
    S.normalize(d).forEach(function (k) {
      var tg = S.zoomTarget(r, k), dur = k.dur;
      tl.to('#pan', { x: tg.x, y: tg.y, scale: tg.scale, duration: dur, ease: E }, k.t);
      tl.to('#pip', { scale: S.pipScale(k.z || 1, p), duration: dur, ease: E }, k.t);
    });
    return tl;
  };

  root.__hfShareStage = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : this);
