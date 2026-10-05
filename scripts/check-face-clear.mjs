#!/usr/bin/env node
// Fails when a mounted template's footprint overlaps the speaker's head (camera applied) while it is on screen.
//   node scripts/check-face-clear.mjs [index.html]
import path from 'node:path';
import { loadRuntime, templateDefaults, templateHosts } from './lib/load-runtime.mjs';

const T = loadRuntime();
const file = process.argv[2] || 'index.html';
const MARGIN = 0;           // px of breathing room required beyond the head box
const SETTLE = 0.5, TAIL = 0.35;

// Footprint (width x height) per template, mirroring each template's own placement code.
const FOOT = {
  'glass-card': (v) => ({ w: v.width, h: v.height }),
  'contact-card': (v) => ({ w: v.width, h: v.height }),
  'app-window': (v) => ({ w: v.width, h: v.height }),
  'notification-stack': (v) => ({ w: v.width * v.scale, h: 110 * v.scale }),
  'metric-counter': (v) => ({ w: v.width, h: 230 * v.scale }),
  'imessage-phone': (v) => ({ w: 280 * v.scale, h: 520 * v.scale }),
  'lower-third': (v) => ({ w: 560, h: 76 * v.scale })
};
// Chrome that is allowed to sit near the head but is reported (warn only)
const CHROME = {
  'chapter-pill': { x0: 680, x1: 1240, y0: 40, y1: 86 },
  'kinetic-subtitle': { x0: 560, x1: 1360, y0: 955, y1: 1036 }
};

let fail = 0, warn = 0;
const rows = [];
for (const h of templateHosts(file)) {
  const defs = templateDefaults(path.join('compositions/tpl', h.template + '.html'));
  const v = { ...defs, ...h.vars };
  if (v.at !== undefined && Math.abs(v.at - h.start) > 1e-6) { console.error(`✗ ${h.id}: variable at=${v.at} but data-start=${h.start}`); fail++; }
  if (v.dur !== undefined && Math.abs(v.dur - h.dur) > 1e-6) { console.error(`✗ ${h.id}: variable dur=${v.dur} but data-duration=${h.dur}`); fail++; }
  const t0 = h.start + SETTLE, t1 = Math.max(t0, h.start + h.dur - TAIL);

  if (CHROME[h.template]) {
    let worst = 0;
    for (let t = h.start; t <= h.start + h.dur; t += 0.1) {
      const f = T.faceAt(t); if (!f) continue;
      const c = CHROME[h.template];
      const ox = Math.min(c.x1, f.x1) - Math.max(c.x0, f.x0), oy = Math.min(c.y1, f.y1) - Math.max(c.y0, f.y0);
      if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
    }
    rows.push([h.id, h.template, worst > 2 ? `WARN overlaps head by ${Math.round(worst)}px (chrome)` : 'clear']);
    if (worst > 2) warn++;
    continue;
  }
  const foot = FOOT[h.template]; if (!foot) continue;
  const { w, h: hh } = foot(v);
  const pl = T.place({ start: h.start, dur: h.dur, side: v.side, width: w, height: hh, top: v.top, safe: v.safe, offsetX: v.offsetX, offsetY: v.offsetY, minWidth: 200 });
  const rect = { x0: pl.left - MARGIN, y0: pl.top - MARGIN, x1: pl.left + pl.width + MARGIN, y1: pl.top + hh + MARGIN };
  let worst = 0, at = 0;
  for (let t = t0; t <= t1 + 1e-6; t += 0.1) {
    const f = T.faceAt(t); if (!f) continue;
    const ox = Math.min(rect.x1, f.x1) - Math.max(rect.x0, f.x0), oy = Math.min(rect.y1, f.y1) - Math.max(rect.y0, f.y0);
    if (ox > 0 && oy > 0 && ox > worst) { worst = ox; at = t; }
  }
  const note = `${pl.side} x ${Math.round(pl.left)}-${Math.round(pl.left + pl.width)}${pl.width < w ? ` (auto-narrowed from ${w})` : ''}`;
  if (worst > 2) { fail++; rows.push([h.id, h.template, `FAIL ${note} covers head by ${Math.round(worst)}px at ${at.toFixed(1)}s`]); }
  else rows.push([h.id, h.template, `ok   ${note}`]);
}
for (const r of rows) console.log(r[0].padEnd(20), r[1].padEnd(18), r[2]);
console.log(fail ? `\n✗ ${fail} face overlap(s)` : `\n✓ face clear (${rows.length} mounts)`, warn ? `· ${warn} chrome warning(s)` : '');
process.exit(fail ? 1 : 0);
