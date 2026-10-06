/**
 * tpl-runtime.js - shared runtime for compositions/tpl/* templates.
 *
 * Works in the browser (window.__hfTpl) and in Node (scripts/place.mjs loads it with a
 * fake `window`), so the render and the face-clear check use the SAME geometry.
 *
 *   __hfTpl.vars(defaults, window.__hyperframes)  merged variables (defaults < host data-variable-values)
 *   __hfTpl.json(v, fallback)       parse a JSON-text variable (or pass through an array/object)
 *   __hfTpl.cameraAt(t)             {x,y,scale} of the camera rig at absolute time t
 *   __hfTpl.faceAt(t)               head box on SCREEN at absolute time t (camera applied)
 *   __hfTpl.place(opts)             face-safe rect for a card (see below)
 *   __hfTpl.enter(tl, el, opts)     standard spring entrance;  __hfTpl.exit(tl, el, opts)
 */
(function (root) {
  'use strict';
  var T = {};
  var W = 1920, H = 1080;

  // Critically damped spring (same curve as __hfGlass.ease.smooth); kept local so Node needs no GSAP.
  function smooth(p) { return p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 + 8 * p) * Math.exp(-8 * p); }

  // Pass the template's own `window.__hyperframes` (scoped per mounted instance by the runtime).
  T.vars = function (defaults, hf) {
    var v = {};
    try {
      hf = hf || root.__hyperframes;
      if (hf && hf.getVariables) v = hf.getVariables() || {};
    } catch (e) { /* standalone preview: defaults only */ }
    var out = {};
    for (var k in defaults) out[k] = defaults[k];
    for (var j in v) out[j] = v[j];
    return out;
  };

  // List/object variables are declared as `string` (HyperFrames has no json type) holding JSON text;
  // a host may also pass a real array/object. Accepts both.
  T.json = function (v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fallback; } }
    return v;
  };

  // ---- camera ------------------------------------------------------------
  var FULL = { x: 0, y: 0, w: 1920, h: 1080, r: 0 };
  function winOf(m) { return m.win && m.win !== 'full' ? { x: m.win.x, y: m.win.y, w: m.win.w, h: m.win.h, r: m.win.r || 0 } : FULL; }

  function rawCenter(t0, t1) {
    var sx = 0, sy = 0, n = 0;
    for (var t = t0; t <= t1 + 1e-6; t += 0.1) { var r = rawFaceAt(t); if (r) { sx += (r.x0 + r.x1) / 2; sy += (r.y0 + r.y1) / 2; n++; } }
    return n ? { x: sx / n, y: sy / n } : { x: 960, y: 430 };
  }

  // Moves may declare `win` (speaker window) and `fit: 'frame' | 'cover'` instead of explicit x/y/scale.
  // fit is resolved once, centring on the average face position until the next move.
  var resolved = false;
  T.resolveMoves = function () {
    var cam = root.__hfCamera;
    if (resolved || !cam) return;
    var G = root.__hfGlass && root.__hfGlass.stage;
    if (!G) return;            // stage engine not loaded yet: try again on the next call
    resolved = true;
    cam.moves.forEach(function (m, i) {
      if (!m.fit) return;
      var next = cam.moves[i + 1], end = m.t + m.dur;
      var c = G.fit(winOf(m), m.fit, { zoom: m.zoom, focus: m.fit === 'cover' ? rawCenter(end, next ? next.t : end + 3) : undefined, focusY: m.focusY });
      m.x = c.x; m.y = c.y; m.scale = c.scale;
    });
  };

  T.windowAt = function (t) {
    T.resolveMoves();
    var cam = root.__hfCamera, s = FULL;
    if (!cam) return s;
    for (var i = 0; i < cam.moves.length; i++) {
      var m = cam.moves[i];
      if (t < m.t) break;
      var to = winOf(m), k = smooth((t - m.t) / m.dur);
      s = { x: s.x + (to.x - s.x) * k, y: s.y + (to.y - s.y) * k, w: s.w + (to.w - s.w) * k, h: s.h + (to.h - s.h) * k, r: s.r + (to.r - s.r) * k };
      if (t < m.t + m.dur) break;
    }
    return s;
  };

  T.cameraAt = function (t) {
    T.resolveMoves();
    var cam = root.__hfCamera;
    var s = { x: 0, y: 0, scale: 1 };
    if (!cam) return s;
    for (var i = 0; i < cam.moves.length; i++) {
      var m = cam.moves[i];
      if (t < m.t) break;
      var to = {
        x: m.x !== undefined ? m.x : s.x,
        y: m.y !== undefined ? m.y : s.y,
        scale: m.scale !== undefined ? m.scale : s.scale
      };
      var k = smooth((t - m.t) / m.dur);
      s = { x: s.x + (to.x - s.x) * k, y: s.y + (to.y - s.y) * k, scale: s.scale + (to.scale - s.scale) * k };
      if (t < m.t + m.dur) break;
    }
    return s;
  };

  // ---- face --------------------------------------------------------------
  function rawFaceAt(t) {
    var f = root.__hfFace;
    if (!f || !f.track || !f.track.length) return null;
    var tr = f.track, i = Math.max(0, Math.min(tr.length - 1, t * f.fps));
    var a = tr[Math.floor(i)], b = tr[Math.ceil(i)], k = i - Math.floor(i);
    return {
      x0: a.x0 + (b.x0 - a.x0) * k, y0: a.y0 + (b.y0 - a.y0) * k,
      x1: a.x1 + (b.x1 - a.x1) * k, y1: a.y1 + (b.y1 - a.y1) * k
    };
  }

  T.faceAt = function (t) {
    var r = rawFaceAt(t);
    if (!r) return null;
    var c = T.cameraAt(t), o = (root.__hfCamera && root.__hfCamera.origin) || [W / 2, H / 2];
    function px(x) { return o[0] + (x - o[0]) * c.scale + c.x; }
    function py(y) { return o[1] + (y - o[1]) * c.scale + c.y; }
    return { x0: px(r.x0), y0: py(r.y0), x1: px(r.x1), y1: py(r.y1) };
  };

  // Union of the head box over [start, start+dur], sampled every 0.1s.
  // Screen-share projects (window.__hfShare + __hfShareStage): the face is wherever the webcam is at that time:
  // 'pip' = the whole card (tucked by the screen zoom, scaled from its bottom-left corner), 'full' = a 480x600
  // head box around pip.focus, 'hide' = nothing. During a swap the head box follows the morphing window
  // (footage pan + card scale), clipped to it. Pure: works without a DOM.
  function shareFaceAt(S, d, t) {
    var p = S.pip(d), modes = S.camModesAt(d, t), f = p.focus || { x: 0.5, y: 0.42 };
    var head = { x0: f.x * W - 240, y0: f.y * H - 300, x1: f.x * W + 240, y1: f.y * H + 300 };
    var clip = function (b) { return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(W, b.x1), y1: Math.min(H, b.y1) }; };
    if (modes.length === 1) {
      if (modes[0] === 'hide') return null;
      if (modes[0] === 'full') return clip(head);
      var s = S.pipScale(S.stateAt(d, t).scale, p), y1 = H - p.y;
      return { x0: p.x, y0: y1 - p.h * s, x1: p.x + p.w * s, y1: y1 };
    }
    var c = S.pipAt(d, t);
    if (modes.indexOf('hide') >= 0 && c.opacity <= 0.05) return null;
    if (!c.pan) return clip(head);
    // raw frame point -> window (pan, origin 50% 50%) -> card scale from the window's bottom-left -> slide
    var bx = c.left, by = c.top + c.height, k = c.scale;
    var X = function (x) { return bx + (c.left + 960 + (x - 960) * c.pan.scale + c.pan.x - bx) * k; };
    var Y = function (y) { return by + (c.top + 540 + (y - 540) * c.pan.scale + c.pan.y - by) * k + c.y; };
    var wy0 = by + (c.top - by) * k + c.y, wx1 = bx + c.width * k;
    var b = { x0: Math.max(X(head.x0), bx), y0: Math.max(Y(head.y0), wy0), x1: Math.min(X(head.x1), wx1), y1: Math.min(Y(head.y1), by + c.y) };
    return b.x1 > b.x0 && b.y1 > b.y0 ? clip(b) : null;
  }

  T.faceUnion = function (start, dur) {
    var share = root.__hfShare && root.__hfShareStage;
    var u = null;
    for (var t = start; t <= start + dur + 1e-6; t += 0.1) {
      var f = share ? shareFaceAt(root.__hfShareStage, root.__hfShare, t) : T.faceAt(t);
      if (!f) continue;
      u = u ? { x0: Math.min(u.x0, f.x0), y0: Math.min(u.y0, f.y0), x1: Math.max(u.x1, f.x1), y1: Math.max(u.y1, f.y1) } : f;
    }
    return u;
  };

  // ---- placement ---------------------------------------------------------
  /**
   * place({start, dur, side, width, height, top, margin, gap, minWidth, safe, offsetX, offsetY})
   *  start/dur   absolute time window the template is on screen
   *  side        'left' | 'right' | 'center'
   *  settle      seconds after `start` before the card must be clear (camera still finishing its move)
 *  safe        true  -> shrink width (and flip side if needed) so the card never touches the head
   * returns {side, left, top, width, height, clear}
   */
  T.place = function (o) {
    var margin = o.margin !== undefined ? o.margin : 72;
    var gap = o.gap !== undefined ? o.gap : 40;
    var minW = o.minWidth || 360;
    var width = o.width, height = o.height || 0, top = o.top !== undefined ? o.top : 140;
    var side = o.side || 'left';
    var ox = o.offsetX || 0, oy = o.offsetY || 0;
    var settle = o.settle !== undefined ? o.settle : 0.5, tail = 0.35;
    var w0 = (o.start || 0) + settle, w1 = Math.max(w0, (o.start || 0) + (o.dur || 0) - tail);
    var u = (o.safe !== false) ? T.faceUnion(w0, w1 - w0) : null;
    var blocks = u && !(top + oy + height < u.y0 || top + oy > u.y1);   // vertical overlap with the head band

    function rect(sd, w) {
      var left = sd === 'right' ? W - margin - w : sd === 'center' ? (W - w) / 2 : margin;
      return { side: sd, left: left + ox, top: top + oy, width: w, height: height };
    }
    var r = rect(side, width);
    if (blocks && side !== 'center') {
      var avail = side === 'left' ? (u.x0 - gap) - margin : (W - margin) - (u.x1 + gap);
      if (avail < width) {
        if (avail >= minW) r = rect(side, avail);
        else {
          var other = side === 'left' ? 'right' : 'left';
          var avail2 = other === 'left' ? (u.x0 - gap) - margin : (W - margin) - (u.x1 + gap);
          r = avail2 >= minW ? rect(other, Math.min(width, avail2)) : rect(side, Math.max(avail, 0));
        }
      }
    }
    r.clear = !(u && blocks) || r.left + r.width <= u.x0 - 1 || r.left >= u.x1 + 1;
    return r;
  };

  T.intersects = function (a, b) {
    return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
  };

  // ---- shared motion -----------------------------------------------------
  function ease(name) { return (root.__hfGlass && root.__hfGlass.ease && root.__hfGlass.ease[name]) || smooth; }

  T.enter = function (tl, el, o) {
    o = o || {};
    var from = o.from || 'left', d = o.distance || 40;
    var f = { opacity: 0, scale: 0.96 };
    if (from === 'left') f.x = -d; else if (from === 'right') f.x = d; else if (from === 'up') f.y = -d; else f.y = d;
    tl.fromTo(el, f, { opacity: 1, scale: 1, x: 0, y: 0, duration: o.duration || 0.6, ease: ease(o.ease || 'snappy') }, o.at || 0);
    return tl;
  };

  // Explicit from-values (the enter() end state), so the exit never captures a mid-entrance value on short clips.
  T.exit = function (tl, el, o) {
    o = o || {};
    var to = { opacity: 0, duration: o.duration || 0.4, ease: 'power2.in', immediateRender: false }, fr = { opacity: 1 };
    var from = o.to || 'left', d = o.distance || 30;
    if (from === 'left' || from === 'right') { to.x = from === 'left' ? -d : d; fr.x = 0; } else { to.y = from === 'up' ? -d : d; fr.y = 0; }
    tl.fromTo(el, fr, to, o.at || 0);
    return tl;
  };

  root.__hfTpl = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : this);
