/**
 * cutout-stage.js - speaker cutout composition: swap the background behind you, put a title BEHIND your head,
 * glide the speaker aside. Layers, bottom to top:
 *
 *   #orig       your original video (carries the voice; also what a 'blur' background blurs)   z 5
 *   #bgs > ...  background layers built from `backgrounds`                                    z 10+
 *   title-behind hosts (compositions/tpl/title-behind.html), mounted at z-index 30            z 30
 *   #cut        the transparent cutout (npm run cutout)                                       z 50
 *   your lower-thirds, subtitles, cards ...                                                   z 55+
 *
 * Data (projects/speaker-cutout/cutout.js):
 *   backgrounds: [{ t, dur?, kind, ... }]   first entry t:0. Later entries crossfade in over `dur` (0.8 s) on top.
 *       kind 'gradient'  preset: aurora | midnight | studio | graphite | paper   (or css: 'any CSS background')
 *       kind 'color'     color: '#0b0b0f'
 *       kind 'image'     src: 'inputs/office.jpg', blur?: px
 *       kind 'scene'     src: 'inputs/office.png', blur: 3 (depth of field), brightness: 0.96, tone: 'warm'|'cool'|'neutral'
 *                        a photoreal room that follows your angle: write it with `npm run backdrop` (measures your framing and
 *                        light, writes the image prompt), save the image, then point src at it
 *       kind 'blur'      blur: 36 (px), dim: 0.55   blurs and darkens your own original footage
 *   speaker:  { shadow: true, x, y, scale, origin }   starting framing of the cutout (px offset, scale); origin defaults to '50% 100%'
 *   moves:    [{ t, dur?, x, y, scale }]              the speaker glides; each move starts where the last one ended
 *   parallax: 0.12                                    backgrounds drift this fraction of the speaker's move (depth)
 * Every value is a pure function of time (fromTo with computed start values), so renders can seek in any order.
 */
(function (root) {
  'use strict';
  var S = {};

  S.PRESETS = {
    aurora: 'radial-gradient(90% 90% at 70% 15%, #2e86de 0%, #0a60d0 42%, #06285c 100%)',
    midnight: 'radial-gradient(100% 100% at 50% 0%, #1b2440 0%, #0b0f1c 70%)',
    studio: 'linear-gradient(160deg, #3a3f4c 0%, #1b1e26 100%)',
    graphite: 'radial-gradient(110% 100% at 30% 10%, #2a2a2e 0%, #0b0b0f 75%)',
    paper: 'radial-gradient(100% 90% at 50% 0%, #ffffff 0%, #e9ebf0 100%)'
  };

  function ease() { return (root.__hfGlass && root.__hfGlass.ease && root.__hfGlass.ease.smooth) || 'power2.inOut'; }

  // Style object for one background spec.
  S.bgStyle = function (b) {
    switch (b.kind) {
      case 'color': return { background: b.color || '#0b0b0f' };
      case 'image': return { background: 'center / cover no-repeat url(' + b.src + ')', filter: b.blur ? 'blur(' + b.blur + 'px)' : '' };
      case 'scene': {
        var sf = 'blur(' + (b.blur != null ? b.blur : 3) + 'px) brightness(' + (b.brightness || 1) + ') saturate(' + (b.saturate || 1.03) + ')';
        if (b.tone === 'warm') sf += ' sepia(0.12)'; else if (b.tone === 'cool') sf += ' hue-rotate(-6deg)';
        // slightly oversized so the blur never shows an edge; a soft vignette seats the speaker in the room
        return { background: 'center / cover no-repeat url(' + b.src + ')', filter: sf, transform: 'scale(1.06)', boxShadow: 'inset 0 0 220px rgba(0,0,0,0.32)' };
      }
      case 'blur': {
        var f = 'blur(' + (b.blur != null ? b.blur : 36) + 'px) brightness(' + (b.dim != null ? 1 - b.dim : 0.45) + ') saturate(1.15)';
        return { backdropFilter: f, webkitBackdropFilter: f };
      }
      default: return { background: b.css || S.PRESETS[b.preset || 'midnight'] || S.PRESETS.midnight };
    }
  };

  // Builds the background layers (#bgs) and frames the cutout (#cut).
  S.layout = function (cfg) {
    var host = document.getElementById('bgs'), cut = document.getElementById('cut');
    // explicit z-index: a transform (parallax) makes #bgs its own stacking layer, so it must sit above #orig (5) and below titles (30)
    host.style.cssText = 'position:absolute;inset:0;z-index:10' + (cfg.parallax ? ';transform:scale(1.1)' : '');
    (cfg.backgrounds || []).forEach(function (b, i) {
      var el = document.createElement('div');
      el.id = 'bg-' + i; el.className = 'cs-bg';
      el.style.cssText = 'position:absolute;inset:0;z-index:' + (10 + i) + ';opacity:' + (i === 0 ? 1 : 0);
      var st = S.bgStyle(b); for (var k in st) el.style[k] = st[k];
      host.appendChild(el);
    });
    var sp = cfg.speaker || {};
    if (sp.shadow !== false) cut.style.filter = 'drop-shadow(0 30px 50px rgba(0,0,0,0.45))';
    // pivot at the bottom centre: when the speaker shrinks or glides, the cut-off bust stays on the bottom edge of the frame
    cut.style.transformOrigin = sp.origin || '50% 100%';
    cut.style.transform = 'translate(' + (sp.x || 0) + 'px,' + (sp.y || 0) + 'px) scale(' + (sp.scale || 1) + ')';
  };

  // Speaker state {x,y,scale} at time t, same maths as the tweens (checks, previews).
  S.speakerAt = function (cfg, t) {
    var sp = cfg.speaker || {}, cur = { x: sp.x || 0, y: sp.y || 0, scale: sp.scale || 1 };
    var mv = (cfg.moves || []).slice().sort(function (a, b) { return a.t - b.t; });
    mv.forEach(function (m, i) {
      var next = mv[i + 1], dur = m.dur || 0.9;
      if (next) dur = Math.max(0.05, Math.min(dur, next.t - m.t));
      var to = { x: m.x != null ? m.x : cur.x, y: m.y != null ? m.y : cur.y, scale: m.scale != null ? m.scale : cur.scale };
      var p = t <= m.t ? 0 : t >= m.t + dur ? 1 : (t - m.t) / dur;
      var k = p >= 1 ? 1 : p <= 0 ? 0 : 1 - (1 + 8 * p) * Math.exp(-8 * p);
      cur = { x: cur.x + (to.x - cur.x) * k, y: cur.y + (to.y - cur.y) * k, scale: cur.scale + (to.scale - cur.scale) * k };
    });
    return cur;
  };

  S.build = function (tl, cfg) {
    var E = ease();
    // later backgrounds fade in over the earlier ones (one tween per layer: seek-safe)
    (cfg.backgrounds || []).forEach(function (b, i) {
      if (i === 0) return;
      tl.fromTo('#bg-' + i, { opacity: 0 }, { opacity: 1, duration: b.dur || 0.8, ease: E, immediateRender: false }, b.t);
    });
    // speaker moves: each tween starts from the computed end of the previous one
    var sp = cfg.speaker || {}, cur = { x: sp.x || 0, y: sp.y || 0, scale: sp.scale || 1 };
    var mv = (cfg.moves || []).slice().sort(function (a, b) { return a.t - b.t; });
    mv.forEach(function (m, i) {
      var next = mv[i + 1], dur = m.dur || 0.9;
      if (next) dur = Math.max(0.05, Math.min(dur, next.t - m.t));
      var to = { x: m.x != null ? m.x : cur.x, y: m.y != null ? m.y : cur.y, scale: m.scale != null ? m.scale : cur.scale };
      tl.fromTo('#cut', { x: cur.x, y: cur.y, scale: cur.scale }, { x: to.x, y: to.y, scale: to.scale, duration: dur, ease: E, immediateRender: false }, m.t);
      cur = to;
    });
    // parallax: the room drifts a fraction of the speaker's move, one tween chain like the speaker's (seek-safe)
    var par = cfg.parallax || 0;
    if (par) {
      var pc = { x: (sp.x || 0), y: (sp.y || 0) };
      mv.forEach(function (m, i) {
        var next = mv[i + 1], dur = m.dur || 0.9;
        if (next) dur = Math.max(0.05, Math.min(dur, next.t - m.t));
        var to = { x: m.x != null ? m.x : pc.x, y: m.y != null ? m.y : pc.y };
        tl.fromTo('#bgs', { x: pc.x * par, y: pc.y * par, scale: 1.1 }, { x: to.x * par, y: to.y * par, scale: 1.1, duration: dur, ease: E, immediateRender: false }, m.t);
        pc = to;
      });
    }
    return tl;
  };

  root.__hfCutoutStage = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : this);
