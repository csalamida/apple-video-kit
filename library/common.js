/* Shared helpers for the generated library pages. MANIFEST is injected by scripts/build-library.mjs. */
const ROOT = new URL('../', location.href).href;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const isJson = (d) => d.type === 'string' && typeof d.default === 'string' && /^[\[{]/.test(d.default.trim());
const srcCache = {};
const getSrc = (file) => srcCache[file] || (srcCache[file] = fetch(ROOT + file).then((r) => r.text()));
const byId = (id) => MANIFEST.templates.find((t) => t.id === id);

// Stacking order of a mounted host (same scale as cue-plan.mjs): by template id first, then by category.
const Z_ID = { 'kinetic-subtitle': 75, 'title-card': 70, 'chapter-pill': 60, 'lower-third': 55 };
const Z_CAT = { Transitions: 90, Overlays: 60, Titles: 70, 'Cards & Panels': 40 };
const zFor = (t) => Z_ID[t.id] ?? Z_CAT[t.category] ?? 40;
// JSON-typed variables are strings; compare them by parsed value so re-formatted but unchanged lists are not emitted.
const norm = (d, v) => { if (!isJson(d) || typeof v !== 'string') return JSON.stringify(v); try { return JSON.stringify(JSON.parse(v)); } catch (e) { return v; } };

// Starting values for a template: declared defaults < library-meta vars < example vars. JSON vars stay strings.
function valsFor(t, ex) {
  const v = {};
  t.variables.forEach((d) => { v[d.id] = d.default; });
  Object.assign(v, t.vars, ex || {});
  t.variables.forEach((d) => { if (isJson(d) && typeof v[d.id] !== 'string') v[d.id] = JSON.stringify(v[d.id]); });
  return v;
}

function hostTagFor(t, V, n) {
  const changed = {};
  t.variables.forEach((d) => { if (norm(d, V[d.id]) !== norm(d, d.default)) changed[d.id] = isJson(d) ? JSON.parse(V[d.id]) : V[d.id]; });
  changed.at = V.at; changed.dur = V.dur;
  return `<div id="${t.id}-${n}-host" class="clip subcomp-host" style="z-index: ${zFor(t)};" data-composition-id="${t.id}-${n}" data-composition-src="${t.file}" data-start="${V.at}" data-duration="${V.dur}" data-variable-values='${JSON.stringify(changed).replace(/'/g, '&#39;')}'></div>`;
}

// Loads a template into an iframe with the given variables. Resolves with { tl } (its paused timeline).
// Wrapped on purpose: a GSAP timeline has .then(), so resolving with it directly would wait for it to finish.
async function loadFrame(frame, t, V) {
  let src = await getSrc(t.file);
  src = src.replace(/<head>/, `<head><base href="${ROOT}"><script>window.__hyperframes={getVariables:function(){return ${JSON.stringify(V).replace(/</g, '\\u003c')}}}<\/script>`);
  // A fresh iframe also fires load for its initial about:blank; wait for the load that has the template's timeline.
  return new Promise((res) => {
    if (frame._hfOnLoad) frame.removeEventListener('load', frame._hfOnLoad);
    const onLoad = () => {
      let tl = null;
      try { tl = frame.contentWindow.__timelines && frame.contentWindow.__timelines[t.id]; } catch (e) { /* not ready */ }
      if (tl) { frame.removeEventListener('load', onLoad); frame._hfOnLoad = null; res({ tl }); }
    };
    frame._hfOnLoad = onLoad;
    frame.addEventListener('load', onLoad);
    frame.srcdoc = src;
  });
}

// Keeps a .scale child sized to its .stage (1920x1080 world scaled to the box).
function fitStage(stage, scale) {
  const fit = () => { scale.style.transform = `scale(${stage.clientWidth / 1920})`; };
  new ResizeObserver(fit).observe(stage); fit();
}

// A small looping preview: shows `t.t` at rest, plays the whole template on hover (or when play() is called).
function tilePreview(stage, t, V, opts) {
  opts = opts || {};
  stage.innerHTML = `<div class="scale"><div class="bg"><div class="pan" style="background-image:url(${ROOT}${opts.bg || 'library/stage.jpg'})"></div></div><iframe tabindex="-1" aria-hidden="true" title=""></iframe></div>`;
  const scale = $('.scale', stage), frame = $('iframe', stage);
  let tl = null, raf = 0, started = false;
  const rest = opts.rest != null ? opts.rest : t.t;
  const load = async () => {
    if (started) return; started = true;
    tl = (await loadFrame(frame, t, V)).tl;
    if (tl) { tl.pause(); tl.time(Math.min(rest, tl.duration())); }
    if (opts.zoom !== false) zoomToContent();
  };
  // Small blocks (a pill, a badge) are tiny in a 16:9 thumbnail: frame the tile around what is visible at rest.
  function zoomToContent() {
    const doc = frame.contentDocument, win = frame.contentWindow;
    if (!doc || !doc.body) return;
    const vis = (el) => { for (let e = el; e && e !== doc.body; e = e.parentElement) { const cs = win.getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) return false; } return true; };
    let x0 = 1920, y0 = 1080, x1 = 0, y1 = 0;
    doc.body.querySelectorAll('*').forEach((el) => {
      if (/^(SCRIPT|STYLE|DEFS|SYMBOL|MASK|PATH|USE)$/i.test(el.tagName)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.width > 1880 || r.height > 1040 || !vis(el)) return;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    });
    if (x1 <= x0 || y1 <= y0) return;
    const pad = 70, bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2;
    const z = Math.min(3, Math.max(1, Math.min(1920 / bw, 1080 / bh)));
    if (z < 1.15) return;                                   // already fills the tile
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tx = Math.min(0, Math.max(1920 - 1920 * z, 960 - cx * z)), ty = Math.min(0, Math.max(1080 - 1080 * z, 540 - cy * z));
    zoom = `translate(${tx}px, ${ty}px) scale(${z})`;
    fit();
  }
  let zoom = '';
  const fit = () => { scale.style.transform = `scale(${stage.clientWidth / 1920}) ${zoom}`; };
  new ResizeObserver(fit).observe(stage);
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '200px' });
  io.observe(stage);
  // also load in the background (staggered), so tiles fill in even before they are scrolled to
  setTimeout(load, opts.delay != null ? opts.delay : 600);
  return {
    play() {
      if (!tl) return; cancelAnimationFrame(raf);
      const dur = Math.min(V.dur || tl.duration(), tl.duration()), t0 = performance.now();
      const step = (n) => { tl.time(((n - t0) / 1000) % dur); raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    },
    stop() { cancelAnimationFrame(raf); if (tl) tl.time(Math.min(rest, tl.duration())); }
  };
}

// Storyboard: picked blocks with times, kept in this browser only (localStorage, best effort).
const Board = (() => {
  let items = [];
  try { items = JSON.parse(localStorage.getItem('avk-board') || '[]'); } catch (e) { items = []; }
  if (!Array.isArray(items)) items = [];
  const save = () => { try { localStorage.setItem('avk-board', JSON.stringify(items)); } catch (e) { /* private mode */ } };
  const before = items.length;
  items = items.filter((it) => it && it.V && byId(it.id));   // drop blocks whose template was renamed or removed
  if (items.length !== before) save();
  const listeners = [];
  const changed = () => { save(); listeners.forEach((f) => f(items)); };
  return {
    get items() { return items; },
    onChange(f) { listeners.push(f); f(items); },
    add(t, V) { const at = items.length ? Math.max(...items.map((x) => x.V.at + x.V.dur)) : V.at; items.push({ id: t.id, V: { ...V, at: +at.toFixed(1) } }); changed(); },
    set(i, k, v) { if (k === 'note') items[i].note = v; else items[i].V[k] = parseFloat(v) || 0; items.sort((a, b) => a.V.at - b.V.at); changed(); },
    remove(i) { items.splice(i, 1); changed(); },
    clear() { items = []; changed(); },
    tags() { return items.map((it, i) => hostTagFor(byId(it.id), it.V, i + 1)).join('\n'); },
    plan() { return 'Storyboard plan:\n' + items.map((it) => `- ${it.V.at.toFixed(1)}s to ${(it.V.at + it.V.dur).toFixed(1)}s: ${it.id}${it.note ? ' ("' + it.note + '")' : ''} ${JSON.stringify(Object.fromEntries(Object.entries(it.V).filter(([k]) => k !== 'at' && k !== 'dur')))}`).join('\n'); }
  };
})();

async function copyText(text, btn) {
  const label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch (e) { btn.textContent = 'Copy failed'; }
  setTimeout(() => (btn.textContent = label), 1200);
}
