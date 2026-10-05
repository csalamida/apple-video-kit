/**
 * screen-stage.js - screen-share composition engine (Screen Studio style).
 *
 *   wallpaper  >  floating rounded SCREEN window (pan/zoom inside it)  >  tall webcam PiP bottom-left
 *
 * Everything is data (see projects/screen-share/share.js):
 *   zooms: [{ t, dur?, x, y, z }]   at time t, ease to zoom z centred on (x,y) of the screen (0-1). z:1 = overview.
 *   pip:   { x, y, w, h, r, minScale, zoomRef, focus }   PiP tucks to minScale as the screen zooms toward zoomRef.
 *   drift: true | { amount, minHold }   slow push-in while a zoom holds, so a long zoom never looks frozen.
 *   cam:   [{ t, mode: 'full' | 'pip' | 'hide', dur? }]   webcam swap to full screen, back to the card, or tucked away.
 *   cuts:  [t, ...]  jump-cut punch on the webcam (alternates 1.0 / punch scale at each cut), punch: 1.06.
 *   focus:    [{ t, end, x, y, w, h, dim?, r? }]          dim everything except a screen region (0-1 coords).
 *   callouts: [{ t, end, x, y, w, h, label, side? }]      ring + label around a screen region.
 *   redact:   [{ t?, end?, x, y, w, h, style? }]          blur ('blur', default) or cover ('solid') private info.
 * Annotations live INSIDE the zoomed screen, so they stay locked to their spot while the screen zooms.
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
    var out = [], dr = d.drift === true ? {} : d.drift;
    z.forEach(function (k, i) {
      var next = z[i + 1], dur = k.dur || 0.7;
      if (next) dur = Math.max(0.05, Math.min(dur, next.t - k.t));
      out.push({ t: k.t, x: k.x, y: k.y, z: k.z, dur: dur });
      // drift: from the end of a zoom-in until the next keyframe, push in a little further on the same point
      var hold = (next ? next.t : (d.duration || k.t + 4)) - (k.t + dur);
      if (dr && (k.z || 1) > 1.05 && hold >= (dr.minHold || 1.5)) {
        out.push({ t: k.t + dur, x: k.x, y: k.y, z: (k.z || 1) * (1 + (dr.amount || 0.035)), dur: hold, drift: true });
      }
    });
    return out;
  };
  function sine(p) { return p <= 0 ? 0 : p >= 1 ? 1 : -(Math.cos(Math.PI * p) - 1) / 2; }

  // State {x,y,scale,pip} at time t (same maths as the tweens), for checks and library previews.
  S.stateAt = function (d, t) {
    var rect = S.windowRect(d), pip = S.pip(d), s = { x: 0, y: 0, scale: 1, pip: 1 };
    S.normalize(d).forEach(function (k) {
      if (t < k.t) return;
      var tg = S.zoomTarget(rect, k), pz = k.drift ? s.pip : S.pipScale(k.z || 1, pip), kk = (k.drift ? sine : smooth)((t - k.t) / k.dur);
      s = { x: s.x + (tg.x - s.x) * kk, y: s.y + (tg.y - s.y) * kk, scale: s.scale + (tg.scale - s.scale) * kk, pip: s.pip + (pz - s.pip) * kk };
    });
    return s;
  };

  var PX = function (v) { return Math.round(v * 100) / 100 + 'px'; };

  // Webcam window rect + pan for a cam mode ('pip' | 'full'), using the shared stage engine (no re-crop).
  S.camWin = function (d, mode) {
    var p = S.pip(d);
    return mode === 'full' ? { x: 0, y: 0, w: W, h: H, r: 0 } : { x: p.x, y: H - p.y - p.h, w: p.w, h: p.h, r: p.r };
  };
  S.camPan = function (d, win) {
    var G = root.__hfGlass.stage, f = S.pip(d).focus || { x: 0.5, y: 0.42 };
    return G.fit(win, 'cover', { focus: { x: f.x * W, y: f.y * H }, focusY: 0.5 });
  };

  // Lays out the DOM (ids: #wall #win #pan #pip #cam) and the screen annotations.
  S.layout = function (d) {
    var r = S.windowRect(d), p = S.pip(d), $ = function (id) { return document.getElementById(id); };
    var win = $('win'), pip = $('pip'), pan = $('pan');
    win.style.cssText += ';left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;border-radius:' + r.r + 'px';
    pip.style.boxShadow = p.shadow;
    var G = root.__hfGlass.stage, cp = G.pan(pip);
    // punch wrapper between the pan and the webcam clip(s) (jump-cut punch scales it, never a <video>).
    // Several clips (auto-trim output: #cam, #cam-2, ...) all go inside it.
    if (!$('cam-punch')) {
      var pw = document.createElement('div'); pw.id = 'cam-punch'; pw.style.cssText = 'position:absolute;inset:0';
      while (cp.firstChild) pw.appendChild(cp.firstChild);
      cp.appendChild(pw);
    }
    Array.prototype.forEach.call($('cam-punch').children, function (c) { c.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;object-fit:cover'; });
    var wall = $('wall'); if (wall && d.wallpaper) wall.style.background = d.wallpaper;

    // annotations, in screen coordinates inside #pan so they follow every zoom
    var ann = document.createElement('div');
    ann.id = 'ss-ann'; ann.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    var box = function (a) { return 'position:absolute;left:' + PX(a.x * r.w) + ';top:' + PX(a.y * r.h) + ';width:' + PX(a.w * r.w) + ';height:' + PX(a.h * r.h) + ';'; };
    (d.redact || []).forEach(function (a, i) {
      var el = document.createElement('div'); el.id = 'ss-redact-' + i; el.className = 'ss-redact';
      el.style.cssText = box(a) + 'border-radius:' + (a.r != null ? a.r : 8) + 'px;' + (a.style === 'solid'
        ? 'background:#1c1c1e'
        : 'background:rgba(120,120,128,0.18);-webkit-backdrop-filter:blur(' + (a.blur || 16) + 'px);backdrop-filter:blur(' + (a.blur || 16) + 'px)');
      ann.appendChild(el);
    });
    (d.focus || []).forEach(function (a, i) {
      var el = document.createElement('div'); el.id = 'ss-focus-' + i;
      el.style.cssText = box(a) + 'opacity:0;border-radius:' + (a.r != null ? a.r : 14) + 'px;box-shadow:0 0 0 6000px rgba(0,0,0,' + (a.dim != null ? a.dim : 0.55) + ')';
      ann.appendChild(el);
    });
    (d.callouts || []).forEach(function (a, i) {
      var el = document.createElement('div'); el.id = 'ss-callout-' + i;
      el.style.cssText = box(a) + 'opacity:0;border-radius:' + (a.r != null ? a.r : 14) + 'px;box-shadow:0 0 0 3px var(--accent,#2997ff),0 0 0 9px rgba(41,151,255,0.22),0 10px 30px rgba(0,0,0,0.25)';
      if (a.label) {
        var side = a.side || 'bottom', lb = document.createElement('div');
        lb.className = 'ss-label ss-counter';
        var pos = { bottom: 'top:calc(100% + 14px);left:50%;transform-origin:50% 0', top: 'bottom:calc(100% + 14px);left:50%;transform-origin:50% 100%',
          left: 'right:calc(100% + 14px);top:50%;transform-origin:100% 50%', right: 'left:calc(100% + 14px);top:50%;transform-origin:0 50%' }[side];
        lb.style.cssText = 'position:absolute;' + pos + ';white-space:nowrap;padding:10px 18px;border-radius:999px;background:var(--accent-deep,#0a60d0);color:#fff;font:600 22px/1.2 var(--font-ui);letter-spacing:-0.01em;box-shadow:0 8px 24px rgba(0,0,0,0.3)';
        lb.dataset.side = side; lb.textContent = a.label; el.appendChild(lb);
      }
      ann.appendChild(el);
    });
    pan.appendChild(ann);
  };

  S.build = function (tl, d) {
    var r = S.windowRect(d), p = S.pip(d), GL = root.__hfGlass, E = (GL && GL.ease && GL.ease.smooth) || smooth;
    var EB = (GL && GL.ease && GL.ease.snappy) || E;
    tl.set('#pan', { x: 0, y: 0, scale: 1, transformOrigin: '0 0' }, 0);
    tl.set('#pip', { scale: 1, x: 0, y: 0, opacity: 1, transformOrigin: '0% 100%' }, 0);

    // webcam window: pip at rest, then cam events (full / pip / hide)
    var cp = GL.stage.pan('#pip'), pw = S.camWin(d, 'pip'), pc = S.camPan(d, pw);
    tl.set('#pip', { left: pw.x, top: pw.y, width: pw.w, height: pw.h, borderRadius: pw.r, zIndex: 20 }, 0);
    tl.set(cp, { x: pc.x - pw.x, y: pc.y - pw.y, scale: pc.scale }, 0);
    var camEv = (d.cam || []).slice().sort(function (a, b) { return a.t - b.t; });
    var modeAt = function (t) { var m = 'pip'; camEv.forEach(function (e) { if (e.t <= t) m = e.mode; }); return m; };
    var prev = 'pip';
    camEv.forEach(function (e) {
      var dur = e.t <= 0 ? 0 : (e.dur || 0.8);
      if (e.mode === 'hide') {
        tl.to('#pip', { y: p.h + p.y + 40, opacity: 0, duration: dur * 0.75, ease: 'power2.in' }, e.t);
      } else {
        if (prev === 'hide') tl.to('#pip', { y: 0, opacity: 1, duration: dur, ease: EB }, e.t);
        var w = S.camWin(d, e.mode), c = S.camPan(d, w);
        if (e.mode === 'full') tl.set('#pip', { zIndex: 60 }, e.t);
        GL.stage.to(tl, '#pip', w, c, { start: e.t, duration: dur, ease: E });
        var sc = e.mode === 'full' ? 1 : S.pipScale(S.stateAt(d, e.t + dur).scale, p);
        tl.to('#pip', { scale: sc, duration: dur, ease: E }, e.t);
        if (e.mode === 'pip') tl.set('#pip', { zIndex: 20 }, e.t + dur);
      }
      prev = e.mode;
    });

    // screen zooms (+ drift), pip tuck only while the webcam is in its card
    var keys = S.normalize(d);
    keys.forEach(function (k) {
      var tg = S.zoomTarget(r, k), dur = k.dur;
      tl.to('#pan', { x: tg.x, y: tg.y, scale: tg.scale, duration: dur, ease: k.drift ? 'sine.inOut' : E }, k.t);
      if (!k.drift && modeAt(k.t) === 'pip') tl.to('#pip', { scale: S.pipScale(k.z || 1, p), duration: dur, ease: E }, k.t);
      // labels keep their on-screen size while the screen zooms
      if (document.querySelector('.ss-counter')) tl.to('.ss-counter', { scale: 1 / tg.scale, duration: dur, ease: k.drift ? 'sine.inOut' : E }, k.t);
    });
    tl.set('.ss-label', { xPercent: function (i, el) { var s = el.dataset.side; return s === 'top' || s === 'bottom' ? -50 : 0; },
      yPercent: function (i, el) { var s = el.dataset.side; return s === 'left' || s === 'right' ? -50 : 0; } }, 0);

    // annotations in/out
    var span = function (a) { return { t: a.t || 0, end: a.end != null ? a.end : (d.duration || 9999) }; };
    (d.focus || []).forEach(function (a, i) {
      var s = span(a), id = '#ss-focus-' + i;
      tl.to(id, { opacity: 1, duration: 0.45, ease: E }, s.t);
      tl.to(id, { opacity: 0, duration: 0.4, ease: 'power2.in' }, Math.max(s.t + 0.45, s.end - 0.4));
    });
    (d.callouts || []).forEach(function (a, i) {
      var s = span(a), id = '#ss-callout-' + i;
      tl.fromTo(id, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.5, ease: EB, immediateRender: false }, s.t);
      tl.to(id, { opacity: 0, duration: 0.35, ease: 'power2.in' }, Math.max(s.t + 0.5, s.end - 0.35));
    });
    (d.redact || []).forEach(function (a, i) {
      var s = span(a), id = '#ss-redact-' + i;
      if (a.t != null) tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: 0.15, immediateRender: true }, Math.max(0, s.t - 0.15));
      if (a.end != null) tl.to(id, { opacity: 0, duration: 0.15 }, s.end);
    });

    // jump-cut punch: alternate framing on every cut so the jump reads as a deliberate edit
    var punch = d.punch || 1.06, f = p.focus || { x: 0.5, y: 0.42 };
    tl.set('#cam-punch', { scale: 1, transformOrigin: (f.x * 100) + '% ' + (f.y * 100) + '%' }, 0);
    (d.cuts || []).slice().sort(function (a, b) { return a - b; }).forEach(function (t, i) {
      tl.set('#cam-punch', { scale: i % 2 === 0 ? punch : 1 }, t);
    });
    return tl;
  };

  root.__hfShareStage = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : this);
