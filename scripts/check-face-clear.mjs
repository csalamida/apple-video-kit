#!/usr/bin/env node
// Fails when a mounted template's footprint overlaps the speaker's head (camera applied) while it is on screen,
// or when a host breaks the template contract (at/dur mismatch, host id collision).
// Screen-share pages (window.__hfShare) are measured against the webcam PiP card instead of the head.
//   node scripts/check-face-clear.mjs [index.html]      (any cwd; the path is relative to cwd or the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { loadRuntime, templateDefaults, templateHosts, ROOT } from './lib/load-runtime.mjs';
import { ensureFaceTrack, VERTICAL } from './demo-media.mjs';

const arg = process.argv[2] || 'index.html';
const file = fs.existsSync(arg) ? path.resolve(arg) : path.join(ROOT, arg);
if (!fs.existsSync(file)) { console.error('check-face-clear: file not found: ' + arg); process.exit(1); }
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const tplFile = (name) => path.join(ROOT, 'compositions/tpl', name + '.html');

const pageHtml = fs.readFileSync(file, 'utf8');
if (/face-track\.vertical/.test(pageHtml)) ensureFaceTrack(VERTICAL); else ensureFaceTrack();
const T = loadRuntime(file);
const MARGIN = 0;           // px of breathing room required beyond the head box
const SETTLE = 0.5, TAIL = 0.35;

// Footprint (width x height) per template, mirroring each template's own placement code.
// null = full-frame on purpose (nothing to measure).
const FOOT = {
  'glass-card': (v) => ({ w: v.width, h: v.height }),
  'contact-card': (v) => ({ w: v.width, h: v.height }),
  'app-window': (v) => ({ w: v.width, h: v.height }),
  'notification-stack': (v) => ({ w: v.width * v.scale, h: 110 * v.scale }),
  'metric-counter': (v) => ({ w: v.width, h: 230 * v.scale }),
  'imessage-phone': (v) => ({ w: 280 * v.scale, h: 520 * v.scale }),
  'lower-third': (v) => ({ w: 560, h: 76 * v.scale }),
  'keys': (v) => ({ w: 640 * v.scale, h: 130 * v.scale }),
  'checklist': (v) => ({ w: v.width, h: (118 + 60 * (typeof v.items === 'string' ? JSON.parse(v.items || '[]') : v.items || []).length) * v.scale }),
  'quote': (v) => ({ w: v.width, h: 340 * v.scale }),
  'before-after': (v) => ({ w: v.width, h: Math.round((v.width - 20) / v.aspect + 20) }),
  'link-chip': (v) => ({ w: 420 * v.scale, h: 70 * v.scale }),
  'fast-forward': (v) => ({ w: 300 * v.scale, h: 60 * v.scale }),
  'progress-bar': () => null,   // a thin strip on an edge
  'title-behind': () => null,   // sits BEHIND the speaker on purpose (z-index 30 under the cutout)
  'title-card': (v) => v.mode === 'outro' ? ({ w: v.width, h: 475 * v.scale }) : null,   // intro is a full-frame scrim on purpose
  'transition': () => null,   // full-frame wipe / chapter slate
  'spotlight': () => null     // full-frame dim with a hole
};
// Templates placed at an exact spot (x, y) or on an edge: a rectangle on the frame instead of place().
const ABS = {
  pointer: (v) => v.kind === 'ring' ? { x0: v.x - v.size / 2, y0: v.y - v.size / 2, x1: v.x + v.size / 2, y1: v.y + v.size / 2 }
    : { x0: v.x - v.size * 0.28, y0: v.from === 'up' ? v.y - v.size : v.y, x1: v.x + v.size * 0.28, y1: v.from === 'up' ? v.y : v.y + v.size },   // the arrow body (a left/right arrow is measured as a vertical one: close enough for a clearance check)
  sticker: (v) => ({ x0: v.x - 150 * v.scale, y0: v.y - 40 * v.scale, x1: v.x + 150 * v.scale, y1: v.y + 40 * v.scale }),
  'media-panel': (v) => { const h = v.height > 0 ? v.height : Math.round(T.H * 0.42); return v.edge === 'bottom' ? { x0: 0, y0: T.H - h, x1: T.W, y1: T.H } : { x0: 0, y0: 0, x1: T.W, y1: h }; }
};
// Chrome that is allowed to sit near the head but is reported (warn only)
const LAND_CHROME = {
  'chapter-pill': { x0: 680, x1: 1240, y0: 40, y1: 86 },
  'kinetic-subtitle': { x0: 560, x1: 1360, y0: 955, y1: 1036 }
};
// vertical: the caption band sits just above the bottom safe zone
const CVS = T.canvas;
const CHROME = CVS.h > CVS.w ? {
  'chapter-pill': { x0: 200, x1: CVS.w - 200, y0: CVS.safe.top, y1: CVS.safe.top + 60 },
  'kinetic-subtitle': { x0: 100, x1: CVS.w - 100, y0: CVS.h - CVS.caption.bottom - 200, y1: CVS.h - CVS.caption.bottom }
} : LAND_CHROME;

let contract = 0, overlap = 0, warn = 0;
const rows = [];
for (const h of templateHosts(file)) {
  const id = h.id;
  if (!fs.existsSync(tplFile(h.template))) { console.error(`✗ ${id}: compositions/tpl/${h.template}.html does not exist`); contract++; rows.push([id, h.template, 'FAIL missing template']); continue; }
  const defs = templateDefaults(tplFile(h.template));
  const v = { ...defs, ...h.vars };
  if (v.at !== undefined && Math.abs(v.at - h.start) > 1e-6) { console.error(`✗ ${id}: variable at=${v.at} but data-start=${h.start}`); contract++; }
  if (v.dur !== undefined && Math.abs(v.dur - h.dur) > 1e-6) { console.error(`✗ ${id}: variable dur=${v.dur} but data-duration=${h.dur}`); contract++; }
  // A host id that equals an id inside its template hijacks the template's getElementById (it renders into the host).
  const inner = new Set([...fs.readFileSync(tplFile(h.template), 'utf8').matchAll(/(?:^|\s)id="([\w-]+)"/g)].map((m) => m[1]));
  if (h.hostId && inner.has(h.hostId)) { console.error(`✗ host id="${h.hostId}" collides with an id inside ${h.template}.html; rename the host (e.g. "${h.hostId}-host")`); contract++; }
  const t0 = h.start + SETTLE, t1 = Math.max(t0, h.start + h.dur - TAIL);

  if (CHROME[h.template]) {
    let worst = 0;
    for (let t = h.start; t <= h.start + h.dur; t += 0.1) {
      const f = T.keepClearAt(t); if (!f) continue;
      const c = CHROME[h.template];
      const ox = Math.min(c.x1, f.x1) - Math.max(c.x0, f.x0), oy = Math.min(c.y1, f.y1) - Math.max(c.y0, f.y0);
      if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
    }
    rows.push([id, h.template, worst > 2 ? `WARN overlaps ${T.mode === 'pip' ? 'PiP' : 'head'} by ${Math.round(worst)}px (chrome)` : 'clear (chrome)']);
    if (worst > 2) warn++;
    continue;
  }
  if (ABS[h.template]) {
    const r = ABS[h.template](v);
    let worst = 0, at = 0;
    for (let t = t0; t <= t1 + 1e-6; t += 0.1) {
      const f = T.keepClearAt(t); if (!f) continue;
      const ox = Math.min(r.x1, f.x1) - Math.max(r.x0, f.x0), oy = Math.min(r.y1, f.y1) - Math.max(r.y0, f.y0);
      if (ox > 0 && oy > 0 && Math.min(ox, oy) > worst) { worst = Math.min(ox, oy); at = t; }
    }
    if (worst > 2) { overlap++; rows.push([id, h.template, `FAIL covers ${T.mode === 'pip' ? 'PiP' : 'head'} by ${Math.round(worst)}px at ${at.toFixed(1)}s (x ${Math.round(r.x0)}-${Math.round(r.x1)}, y ${Math.round(r.y0)}-${Math.round(r.y1)})`]); }
    else rows.push([id, h.template, `ok   x ${Math.round(r.x0)}-${Math.round(r.x1)}, y ${Math.round(r.y0)}-${Math.round(r.y1)}`]);
    continue;
  }
  const foot = FOOT[h.template];
  if (!foot) { rows.push([id, h.template, 'not measured (no footprint known)']); continue; }
  const fp = foot(v);
  if (!fp) { rows.push([id, h.template, 'not measured (full-frame)']); continue; }
  const { w, h: hh } = fp;
  const pl = T.place({ start: h.start, dur: h.dur, side: v.side, width: w, height: hh, top: v.top, safe: v.safe, offsetX: v.offsetX, offsetY: v.offsetY, minWidth: 200 });
  const rect = { x0: pl.left - MARGIN, y0: pl.top - MARGIN, x1: pl.left + pl.width + MARGIN, y1: pl.top + hh + MARGIN };
  let worst = 0, at = 0;
  for (let t = t0; t <= t1 + 1e-6; t += 0.1) {
    const f = T.keepClearAt(t); if (!f) continue;
    const ox = Math.min(rect.x1, f.x1) - Math.max(rect.x0, f.x0), oy = Math.min(rect.y1, f.y1) - Math.max(rect.y0, f.y0);
    if (ox > 0 && oy > 0 && ox > worst) { worst = ox; at = t; }
  }
  const note = `${pl.side} x ${Math.round(pl.left)}-${Math.round(pl.left + pl.width)}${pl.width < w ? ` (auto-narrowed from ${w})` : ''}`;
  if (worst > 2) { overlap++; rows.push([id, h.template, `FAIL ${note} covers ${T.mode === 'pip' ? 'PiP' : 'head'} by ${Math.round(worst)}px at ${at.toFixed(1)}s`]); }
  else rows.push([id, h.template, `ok   ${note}`]);
}

console.log(`${rel(file)}  (mode: ${T.mode}${T.mode === 'pip' ? ', measured against the webcam PiP card' : ', measured against the face track'})`);
for (const r of rows) console.log(String(r[0]).padEnd(20), r[1].padEnd(18), r[2]);
const parts = [];
if (contract) parts.push(`${contract} contract error(s)`);
if (overlap) parts.push(`${overlap} ${T.mode === 'pip' ? 'PiP' : 'face'} overlap(s)`);
console.log(parts.length ? `\n✗ ${parts.join(', ')} (${rows.length} mounts)` : `\n✓ ${T.mode === 'pip' ? 'PiP' : 'face'} clear (${rows.length} mounts)`,
  warn ? `· ${warn} chrome warning(s)` : '');
process.exit(contract || overlap ? 1 : 0);
