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

  // ---- single-writer tracks ---------------------------------------------------------------------------
  // Renders seek a paused timeline to any time in any order (parallel workers), so every animated value must be
  // a pure function of time. A track owns one group of properties on one element: keys [{ t, dur, to, ease }]
  // are sorted, each key starts from the exact value the track has at its t (computed here, never captured
  // from the DOM) and is clipped at the next key's t, keeping its own curve. Tweens never overlap.
  function power2in(p) { return p <= 0 ? 0 : p >= 1 ? 1 : p * p * p; }
  function spring(b) {   // same maths as __hfGlass.spring, so Node checks need no glass-components
    var z = Math.min(1, Math.max(0.35, 1 - b)), w = 8 / z, wd = w * Math.sqrt(Math.max(0, 1 - z * z));
    return function (p) {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      return z >= 1 ? 1 - (1 + w * p) * Math.exp(-w * p) : 1 - Math.exp(-z * w * p) * (Math.cos(wd * p) + (z * w / wd) * Math.sin(wd * p));
    };
  }
  function eases() {
    var g = root.__hfGlass && root.__hfGlass.ease;
    return { smooth: (g && g.smooth) || smooth, snappy: (g && g.snappy) || spring(0.15) };
  }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  S.track = function (init, keys) {
    keys = keys.map(function (k, i) { return { k: k, i: i }; })
      .sort(function (a, b) { return a.k.t - b.k.t || a.i - b.i; }).map(function (x) { return x.k; });
    init = copy(init);
    // instant keys at t <= 0 are the starting state, not a set at 0 (two writers at time 0 revert on a backward seek)
    while (keys.length && keys[0].t <= 0 && !(keys[0].dur > 0)) { for (var q in keys[0].to) init[q] = keys[0].to[q]; keys.shift(); }
    var cur = copy(init), segs = [];
    keys.forEach(function (k, i) {
      var next = keys[i + 1], full = Math.max(0, k.dur || 0);
      var len = next ? Math.max(0, Math.min(full, next.t - k.t)) : full;
      var from = {}, end = copy(cur), r = full > 0 ? len / full : 1, e = k.ease || smooth;
      for (var p in k.to) {
        from[p] = cur[p] !== undefined ? cur[p] : k.to[p];
        end[p] = full > 0 ? from[p] + (k.to[p] - from[p]) * e(r) : k.to[p];
      }
      segs.push({ t: k.t, len: len, full: full, r: r, from: from, to: k.to, ease: e });
      cur = end;
    });
    return {
      init: init, segs: segs,
      at: function (t) {
        var v = copy(init);
        for (var i = 0; i < segs.length; i++) {
          var s = segs[i];
          if (t < s.t) break;
          var q = s.full > 0 ? s.ease(Math.min(t - s.t, s.len) / s.full) : 1;
          for (var p in s.to) v[p] = s.from[p] + (s.to[p] - s.from[p]) * q;
        }
        return v;
      }
    };
  };

  // Starting values at time 0 as a short hold fromTo, not a set: a zero-duration set at 0 is skipped by a fresh
  // seek(0) unless rendered immediately, and reverts when the playhead comes back to 0 from later.
  S.hold = function (tl, target, vars, until) {
    var b = copy(vars); b.duration = Math.max(0.001, until || 0); b.ease = 'none';
    tl.fromTo(target, copy(vars), b, 0);
    return tl;
  };

  // Writes a track into tl: a hold of the starting values until the first key, then one fromTo per key.
  S.emit = function (tl, target, tr) {
    var first = tr.segs.length ? tr.segs[0].t : 0;
    if (!(tr.segs.length && first <= 0)) S.hold(tl, target, tr.init, first);
    tr.segs.forEach(function (s) {
      if (s.full === 0) { tl.set(target, copy(s.to), s.t); return; }
      if (s.len <= 0) return;
      var to = copy(s.to), e = s.ease, r = s.r;
      to.duration = s.len; to.immediateRender = s.t <= 0;
      to.ease = r >= 1 ? e : function (q) { return e(q * r); };
      tl.fromTo(target, copy(s.from), to, s.t);
    });
    return tl;
  };

  // ---- webcam modes ----------------------------------------------------------------------------------
  function camEvents(d) {
    return (d.cam || []).map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return a.e.t - b.e.t || a.i - b.i; }).map(function (x) { return x.e; });
  }
  function camDur(e) { return e.t <= 0 ? 0 : (e.dur != null ? e.dur : 0.8); }

  // Webcam mode at time t: 'pip' (default) | 'full' | 'hide'. Pure (no DOM), shared by build and the checks.
  S.camModeAt = function (d, t) {
    var m = 'pip';
    camEvents(d).forEach(function (e) { if (e.t <= t) m = e.mode; });
    return m;
  };
  // Modes visible at t: the current one plus the previous one while the swap is still running.
  S.camModesAt = function (d, t) {
    var m = 'pip', out = ['pip'];
    camEvents(d).forEach(function (e) {
      if (e.t > t) return;
      var len = e.mode === 'hide' ? camDur(e) * 0.75 : camDur(e);
      out = t < e.t + len && m !== e.mode ? [m, e.mode] : [e.mode];
      m = e.mode;
    });
    return out;
  };

  // Every #pip / #pan track as data (pure, no DOM). Used by build() and by S.pipAt for checks.
  S.plan = function (d) {
    var r = S.windowRect(d), p = S.pip(d), ez = eases(), E = ez.smooth, EB = ez.snappy;
    var ev = camEvents(d), keys = S.normalize(d), GL = root.__hfGlass;
    var winProps = function (w) { return { left: w.x, top: w.y, width: w.w, height: w.h, borderRadius: w.r }; };
    var panProps = function (w) { var c = S.camPan(d, w); return { x: c.x - w.x, y: c.y - w.y, scale: c.scale }; };
    var canPan = !!(GL && GL.stage && GL.stage.fit);
    var pw = S.camWin(d, 'pip');
    var rect = [], cpan = [], scale = [], vis = [], z = [];
    var prev = 'pip';
    ev.forEach(function (e, i) {
      var dur = camDur(e), next = ev[i + 1];
      if (e.mode === 'hide') {
        // from the full frame a 491px drop reads as a glitch: fade with a small slide instead
        if (prev !== 'hide') vis.push({ t: e.t, dur: dur * 0.75, ease: power2in, to: { y: prev === 'full' ? 40 : p.h + p.y + 40, opacity: 0 } });
      } else {
        if (prev === 'hide') vis.push({ t: e.t, dur: dur, ease: EB, to: { y: 0, opacity: 1 } });
        var w = S.camWin(d, e.mode);
        rect.push({ t: e.t, dur: dur, ease: E, to: winProps(w) });
        if (canPan) cpan.push({ t: e.t, dur: dur, ease: E, to: panProps(w) });
        scale.push({ t: e.t, dur: dur, ease: E, to: { scale: e.mode === 'full' ? 1 : S.pipScale(S.stateAt(d, e.t + dur).scale, p) } });
        z.push(e.mode === 'full' ? { t: e.t, v: 60 } : { t: next ? Math.min(e.t + dur, next.t) : e.t + dur, v: 20 });
      }
      prev = e.mode;
    });
    // pip tuck follows the screen zoom only while the webcam sits in its card
    keys.forEach(function (k) {
      if (!k.drift && S.camModeAt(d, k.t) === 'pip') scale.push({ t: k.t, dur: k.dur, ease: E, to: { scale: S.pipScale(k.z || 1, p) } });
    });
    var zoom = keys.map(function (k) {
      var tg = S.zoomTarget(r, k);
      return { t: k.t, dur: k.dur, ease: k.drift ? sine : E, to: { x: tg.x, y: tg.y, scale: tg.scale } };
    });
    var counter = zoom.map(function (k) { return { t: k.t, dur: k.dur, ease: k.ease, to: { scale: 1 / k.to.scale } }; });
    return {
      rect: S.track(winProps(pw), rect),
      cpan: canPan ? S.track(panProps(pw), cpan) : null,
      scale: S.track({ scale: 1 }, scale),
      vis: S.track({ y: 0, opacity: 1 }, vis),
      zoom: S.track({ x: 0, y: 0, scale: 1 }, zoom),
      counter: S.track({ scale: 1 }, counter),
      z0: z.filter(function (k) { return k.t <= 0; }).reduce(function (a, k) { return k.v; }, 20),
      z: z.filter(function (k) { return k.t > 0; })
    };
  };

  // Webcam card state at time t (pure): {mode, left, top, width, height, borderRadius, scale, y, opacity,
  // pan: {x, y, scale} of the footage inside the window (null without the stage engine)}.
  S.pipAt = function (d, t) {
    var pl = S.plan(d), o = pl.rect.at(t), k;
    var sc = pl.scale.at(t), vi = pl.vis.at(t);
    o.scale = sc.scale; for (k in vi) o[k] = vi[k];
    o.pan = pl.cpan ? pl.cpan.at(t) : null;
    o.mode = S.camModeAt(d, t);
    return o;
  };

  S.build = function (tl, d) {
    var p = S.pip(d), GL = root.__hfGlass, ez = eases(), E = ez.smooth, EB = ez.snappy;
    var pl = S.plan(d), cp = GL.stage.pan('#pip');
    S.hold(tl, '#pip', { x: 0, transformOrigin: '0% 100%', zIndex: pl.z0 });
    S.hold(tl, '#pan', { transformOrigin: '0 0' });

    // webcam window (rect + footage pan), card scale (cam swaps + zoom tuck), slide/fade (hide), stacking
    S.emit(tl, '#pip', pl.rect);
    if (pl.cpan) S.emit(tl, cp, pl.cpan);
    S.emit(tl, '#pip', pl.scale);
    S.emit(tl, '#pip', pl.vis);
    pl.z.forEach(function (z) { tl.set('#pip', { zIndex: z.v }, z.t); });

    // screen zooms (+ drift); labels keep their on-screen size while the screen zooms
    S.emit(tl, '#pan', pl.zoom);
    if (document.querySelector('.ss-counter')) S.emit(tl, '.ss-counter', pl.counter);
    if (document.querySelector('.ss-label')) S.hold(tl, '.ss-label', { xPercent: function (i, el) { var s = el.dataset.side; return s === 'top' || s === 'bottom' ? -50 : 0; },
      yPercent: function (i, el) { var s = el.dataset.side; return s === 'left' || s === 'right' ? -50 : 0; } });

    // annotations in/out: fully in by t + fade-in, fully out exactly at end (never past the video)
    var last = d.duration || 9999;
    var span = function (a) { var t = a.t || 0, end = a.end != null ? Math.min(a.end, last) : null; return { t: t, end: end, len: (end != null ? end : last) - t }; };
    (d.focus || []).forEach(function (a, i) {
      var s = span(a), id = '#ss-focus-' + i, fi = Math.max(0.05, Math.min(0.45, s.len / 2));
      tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: fi, ease: E, immediateRender: false }, s.t);
      if (s.end != null) { var fo = Math.max(0.05, Math.min(0.4, s.len / 2)); tl.fromTo(id, { opacity: 1 }, { opacity: 0, duration: fo, ease: power2in, immediateRender: false }, s.end - fo); }
    });
    (d.callouts || []).forEach(function (a, i) {
      var s = span(a), id = '#ss-callout-' + i, ci = Math.max(0.05, Math.min(0.5, s.len / 2));
      tl.fromTo(id, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: ci, ease: EB, immediateRender: false }, s.t);
      if (s.end != null) { var co = Math.max(0.05, Math.min(0.35, s.len / 2)); tl.fromTo(id, { opacity: 1 }, { opacity: 0, duration: co, ease: power2in, immediateRender: false }, s.end - co); }
    });
    // redact: fully opaque AT its t (never ramping in after it), out only after end
    (d.redact || []).forEach(function (a, i) {
      var id = '#ss-redact-' + i;
      if (a.t == null || a.t <= 0.15) S.hold(tl, id, { opacity: 1 });
      else {
        S.hold(tl, id, { opacity: 0 }, a.t - 0.15);
        tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none', immediateRender: false }, a.t - 0.15);
      }
      if (a.end != null) tl.fromTo(id, { opacity: 1 }, { opacity: 0, duration: 0.15, ease: 'none', immediateRender: false }, a.end);
    });

    // jump-cut punch: alternate framing on every cut so the jump reads as a deliberate edit
    var punch = d.punch || 1.06, f = p.focus || { x: 0.5, y: 0.42 };
    var cuts = (d.cuts || []).filter(function (t) { return t > 0; }).sort(function (a, b) { return a - b; });
    S.hold(tl, '#cam-punch', { scale: 1, transformOrigin: (f.x * 100) + '% ' + (f.y * 100) + '%' });
    cuts.forEach(function (t, i) { tl.set('#cam-punch', { scale: i % 2 === 0 ? punch : 1 }, t); });
    return tl;
  };

  root.__hfShareStage = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : this);
