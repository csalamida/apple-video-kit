#!/usr/bin/env node
// Short-form checks that need no browser. Run on a vertical page:  node scripts/check-reel.mjs [projects/short-form/index.html]
//   captions   every cue finite, ordered, not overlapping, inside its host window, and held readable for at least
//              MIN_HOLD seconds AFTER its entrance and BEFORE its exit (a short word timestamp must not become a flash)
//   safe zone  captions sit above the bottom safe zone; card footprints stay inside top/bottom/side safe zones
//   clipping   caption CSS (template + page) never clips its own glyphs (overflow hidden / clip-path / mask on a cue)
//   canvas     the page is 1080x1920 and every host covers the whole frame
import fs from 'node:fs';
import path from 'node:path';
import { loadRuntime, templateDefaults, templateHosts, ROOT } from './lib/load-runtime.mjs';

const args = process.argv.slice(2);
const mh = args.indexOf('--min-hold');
const arg = args.find((a, i) => !a.startsWith('--') && (mh < 0 || i !== mh + 1)) || 'projects/short-form/index.html';
const MIN_HOLD = mh >= 0 ? +args[mh + 1] : 0.5;
const ENTER = 0.24, EXIT = 0.16;     // kinetic-subtitle entrance and exit
const file = fs.existsSync(arg) ? path.resolve(arg) : path.join(ROOT, arg);
if (!fs.existsSync(file)) { console.error('check-reel: file not found: ' + arg); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');
const T = loadRuntime(file), C = T.canvas, S = C.safe;
const errors = [], warns = [];
const fail = (m) => errors.push(m), warn = (m) => warns.push(m);
const tplFile = (n) => path.join(ROOT, 'compositions/tpl', n + '.html');

if (!(C.w === 1080 && C.h === 1920)) fail(`canvas is ${C.w}x${C.h}; short-form pages are 1080x1920 (sync with --canvas vertical)`);
const root = html.match(/id="root"[^>]*data-width="(\d+)"[^>]*data-height="(\d+)"/);
if (root && (+root[1] !== C.w || +root[2] !== C.h)) fail(`#root is ${root[1]}x${root[2]} but the canvas is ${C.w}x${C.h}`);

let cueCount = 0, hosts = 0;
for (const h of templateHosts(file)) {
  hosts++;
  const v = { ...templateDefaults(tplFile(h.template)), ...h.vars };
  if (h.template === 'kinetic-subtitle') {
    const cues = T.json(v.cues, []);
    if (!cues.length) warn(`${h.id}: no caption cues`);
    if (v.bottom < S.bottom) fail(`${h.id}: captions bottom=${v.bottom}px sit inside the bottom platform zone (${S.bottom}px). Raise them`);
    const lum = (hex) => { const h = String(hex).replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'); if (!/^[0-9a-f]{6}$/i.test(h)) return null; const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return x == null || y == null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    if (v.mode && !['whole', 'cumulative'].includes(v.mode)) fail(`${h.id}: mode "${v.mode}" must be whole or cumulative`);
    if (v.entrance && !['rise', 'edge-fly'].includes(v.entrance)) fail(`${h.id}: entrance "${v.entrance}" must be rise or edge-fly`);
    if (v.entrance === 'edge-fly' && v.mode !== 'cumulative') warn(`${h.id}: entrance edge-fly only applies with mode cumulative`);
    if (v.pill !== false) {
      // the pill is mostly opaque, so its colour decides the contrast
      const r = ratio(v.color, v.bg), ra = ratio(v.accent, v.bg);
      if (r != null && r < 4.5) fail(`${h.id}: caption text ${v.color} on the pill ${v.bg} is ${r.toFixed(1)}:1 (needs 4.5:1). Pick a lighter text or a darker pill`);
      if (ra != null && ra < 3) fail(`${h.id}: highlight ${v.accent} on the pill ${v.bg} is ${ra.toFixed(1)}:1 (needs 3:1 for large text)`);
      if (+v.bgAlpha < 0.45) warn(`${h.id}: pill opacity ${v.bgAlpha} lets busy footage through; contrast can drop below the ratio above`);
    } else warn(`${h.id}: captions without a pill sit straight on the footage; check contrast on the lightest frames (a soft shadow is added)`);
    if (v.size < 44) warn(`${h.id}: caption size ${v.size}px is small for a phone (use 52-72px)`);
    let prev = null;
    cues.forEach((c, i) => {
      cueCount++;
      const tag = `${h.id} cue ${i + 1} "${String(c.text).replace(/\*/g, '').slice(0, 28)}"`;
      if (![c.start, c.end].every(Number.isFinite)) return fail(`${tag}: start/end must be numbers`);
      if (c.end <= c.start) return fail(`${tag}: end ${c.end} is not after start ${c.start}`);
      const hold = c.end - c.start - ENTER - EXIT;
      if (hold < MIN_HOLD - 1e-6) fail(`${tag}: ${c.start}-${c.end}s leaves only ${hold.toFixed(2)}s settled to read (need ${MIN_HOLD}s after the ${ENTER + EXIT}s of entrance and exit). Merge it with a neighbour or lengthen it`);
      if (c.start < h.start - 1e-6 || c.end > h.start + h.dur + 1e-6) fail(`${tag}: outside its host window ${h.start}-${(h.start + h.dur).toFixed(2)}s`);
      if (prev && c.start < prev.end - 1e-6) fail(`${tag}: overlaps the previous cue (${prev.end}s)`);
      const words = String(c.text).replace(/\*/g, '').split(/\s+/).filter(Boolean).length;
      if (words > 7) warn(`${tag}: ${words} words; keep a cue to about 6 so it reads at a glance`);
      if (words / Math.max(0.01, c.end - c.start) > 4.5) warn(`${tag}: ${words} words in ${(c.end - c.start).toFixed(1)}s is faster than most people read`);
      prev = c;
    });
    continue;
  }
  // card footprints against the platform zones (same footprints as check-face-clear)
  const FOOT = {
    'glass-card': () => ({ w: v.width, h: v.height }), 'contact-card': () => ({ w: v.width, h: v.height }),
    'app-window': () => ({ w: v.width, h: v.height }), 'notification-stack': () => ({ w: v.width * v.scale, h: 110 * v.scale }),
    'metric-counter': () => ({ w: v.width, h: 230 * v.scale }), 'imessage-phone': () => ({ w: 280 * v.scale, h: 520 * v.scale }),
    'lower-third': () => ({ w: 560, h: 76 * v.scale }), 'keys': () => ({ w: 640 * v.scale, h: 130 * v.scale }),
    'quote': () => ({ w: v.width, h: 340 * v.scale }), 'link-chip': () => ({ w: 420 * v.scale, h: 70 * v.scale }),
    'fast-forward': () => ({ w: 300 * v.scale, h: 60 * v.scale })
  };
  const f = FOOT[h.template] && FOOT[h.template]();
  if (!f) continue;
  const top = Math.max(S.top, v.top + (v.offsetY || 0));
  if (v.top + (v.offsetY || 0) < S.top) fail(`${h.id}: top=${v.top} is inside the top platform zone (${S.top}px)`);
  if (top + f.h > C.h - S.bottom) fail(`${h.id}: bottom edge ${Math.round(top + f.h)}px is inside the bottom platform zone (starts at ${C.h - S.bottom}px)`);
  if (f.w > C.w - S.left - S.right) warn(`${h.id}: ${h.template} is ${Math.round(f.w)}px wide; the safe width is ${C.w - S.left - S.right}px (it will be narrowed)`);
}

// glyph clipping: a cue that clips its own paint cuts descenders (g, y), italic overhangs and gradient edges
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') + '\n' +
  fs.readFileSync(tplFile('kinetic-subtitle'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (/\.(cue|w|kw|kp)\b|#dock/.test(m[1]) && /overflow\s*:\s*(hidden|clip)|clip-path\s*:|mask(-image)?\s*:/.test(m[2])) fail(`caption CSS "${m[1].trim()}" clips its own glyphs (overflow/clip-path/mask). Remove it or add padding of at least 0.3em`);
}
if (/background-clip\s*:\s*text/.test(css)) warn('caption CSS uses background-clip:text: check descenders and italic overhang in the encoded frames (gradient paint boxes crop them)');

console.log(`${path.relative(ROOT, file).replace(/\\/g, '/')}  (${C.w}x${C.h}, safe top ${S.top} / bottom ${S.bottom} / sides ${S.left}+${S.right})`);
console.log(`${hosts} mounts, ${cueCount} caption cues, minimum settled hold ${MIN_HOLD}s`);
warns.forEach((w) => console.log('  warn  ' + w));
errors.forEach((e) => console.error('  FAIL  ' + e));
console.log(errors.length ? `\n✗ ${errors.length} problem(s)` : `\n✓ reel rules pass${warns.length ? ` · ${warns.length} warning(s)` : ''}`);
process.exit(errors.length ? 1 : 0);
