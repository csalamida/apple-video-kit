#!/usr/bin/env node
// Sound effects from the page's own cue data. Reads the template hosts of a page (what appears when, and on which side) and
// synthesizes a quiet effects track in code: a soft whoosh for cards and transitions, a pop for chips, stickers and pointers, a tick for
// each key, a rising sweep for fast-forward. No stock audio, no licences, and identical output on every run.
//
//   node scripts/sfx.mjs [page.html] [--out inputs/sfx.wav] [--level -16]
//
//   page    the composition (default index.html; any project page works)
//   --out   the WAV to write (default inputs/sfx.wav, git-ignored)
//   --level peak level of the loudest effect in dBFS (default -16: effects sit UNDER a voice)
// Mix it under the voice with ducking:  npm run audio -- renders/<video>.mp4 --music inputs/sfx.wav --music-db -6
// Effects are panned toward the side the block sits on. It cannot hear the video: it places a sound at every block's start, so
// listen once and delete what is too busy (a sound on every card is a choice, not a default: fewer is usually better).
import fs from 'node:fs';
import path from 'node:path';
import { templateHosts, templateDefaults, ROOT } from './lib/load-runtime.mjs';

const fail = (m) => { console.error('sfx: ' + m); process.exit(1); };
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const idx = new Set(['--out', '--level'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const page = args.find((a, i) => !a.startsWith('--') && !idx.has(i)) || 'index.html';
const LEVEL = +val('--level', -16);
if (!(LEVEL <= -3 && LEVEL >= -40)) fail('--level must be between -40 and -3');
const file = fs.existsSync(page) ? path.resolve(page) : path.join(ROOT, page);
if (!fs.existsSync(file)) fail('file not found: ' + page);
const html = fs.readFileSync(file, 'utf8');
const dm = html.match(/id="root"[^>]*data-duration="([\d.]+)"/) || html.match(/data-composition-id="main"[^>]*data-duration="([\d.]+)"/);
const duration = dm ? +dm[1] : 0;
if (!(duration > 0)) fail('could not read the page duration (data-duration on #root)');
const out = path.resolve(val('--out', path.join(ROOT, 'inputs/sfx.wav')));

const SR = 48000, N = Math.ceil((duration + 1) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 7; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
const add = (t, buf, pan, gain = 1) => {   // pan -1 left .. 1 right, equal power
  const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * gain, gr = Math.sin(a) * gain, s0 = Math.round(t * SR);
  for (let i = 0; i < buf.length && s0 + i < N; i++) { if (s0 + i < 0) continue; L[s0 + i] += buf[i] * gl; R[s0 + i] += buf[i] * gr; }
};
const env = (i, n, a, r) => Math.min(1, i / (a * SR)) * Math.min(1, (n - i) / (r * SR));
// whoosh: filtered noise whose band sweeps up and settles, with a soft attack
function whoosh(sec, f0 = 400, f1 = 2600) {
  const n = Math.round(sec * SR), b = new Float32Array(n); let lp = 0, hp = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n, f = f0 + (f1 - f0) * Math.sin(k * Math.PI / 2), c = Math.min(0.95, 2 * Math.PI * f / SR);
    const x = rnd(); lp += c * (x - lp); hp += 0.02 * (lp - hp);
    b[i] = (lp - hp) * env(i, n, sec * 0.35, sec * 0.5) * 2.2;
  }
  return b;
}
const pop = (f = 760) => { const n = Math.round(0.11 * SR), b = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const k = i / n; ph += 2 * Math.PI * (f * (1.6 - 0.6 * k)) / SR; b[i] = Math.sin(ph) * Math.exp(-k * 7) * Math.min(1, i / (0.002 * SR)); } return b; };
const tick = () => { const n = Math.round(0.035 * SR), b = new Float32Array(n); for (let i = 0; i < n; i++) { const k = i / n; b[i] = (Math.sin(2 * Math.PI * 1500 * i / SR) * 0.7 + rnd() * 0.3) * Math.exp(-k * 14); } return b; };
const sweep = (sec) => { const n = Math.round(sec * SR), b = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const k = i / n; ph += 2 * Math.PI * (300 + 1700 * k * k) / SR; b[i] = (Math.sin(ph) * 0.5 + rnd() * 0.12) * env(i, n, 0.15, 0.2); } return b; };
const chime = () => { const n = Math.round(0.6 * SR), b = new Float32Array(n); for (let i = 0; i < n; i++) { const k = i / n; b[i] = (Math.sin(2 * Math.PI * 1318 * i / SR) + 0.5 * Math.sin(2 * Math.PI * 1976 * i / SR)) * Math.exp(-k * 6) * Math.min(1, i / (0.003 * SR)); } return b; };

const CARDS = new Set(['glass-card', 'checklist', 'quote', 'app-window', 'contact-card', 'metric-counter', 'notification-stack', 'lower-third', 'before-after', 'imessage-phone', 'media-panel']);
const hosts = templateHosts(file);
const log = [];
for (const h of hosts) {
  const defs = templateDefaults(path.join(ROOT, 'compositions/tpl', h.template + '.html'));
  const v = { ...defs, ...h.vars };
  const pan = v.side === 'left' ? -0.55 : v.side === 'right' ? 0.55 : v.x !== undefined ? Math.max(-0.7, Math.min(0.7, (v.x - (html.includes('data-width="1080"') ? 540 : 960)) / (html.includes('data-width="1080"') ? 540 : 960))) : 0;
  const t = h.start;
  if (h.template === 'transition') {
    const d = Math.min(h.dur, 1.2);
    add(t, whoosh(d, 300, 3200), 0, 1);
    if (v.kind === 'chapter' || v.kind === 'light-sweep') add(t + d * 0.5, chime(), 0, 0.35);
    log.push([t, 'transition ' + v.kind]);
  } else if (CARDS.has(h.template)) { add(t, whoosh(0.32, 500, 2200), pan, 0.7); log.push([t, h.template + ' whoosh']); }
  else if (h.template === 'title-card') { add(t, whoosh(0.6, 250, 1800), 0, 0.9); log.push([t, 'title-card whoosh']); }
  else if (h.template === 'link-chip' || h.template === 'sticker' || h.template === 'pointer') { add(t + 0.05, pop(h.template === 'sticker' ? 620 : 820), pan, 0.9); log.push([t, h.template + ' pop']); }
  else if (h.template === 'keys') { const keys = Array.isArray(v.keys) ? v.keys : []; (keys.length ? keys : ['x']).forEach((_, i) => add(t + 0.18 + i * 0.16, tick(), pan, 0.8)); log.push([t, 'keys ticks']); }
  else if (h.template === 'fast-forward') { add(t, sweep(Math.min(h.dur, 1.6)), 0, 0.6); log.push([t, 'fast-forward sweep']); }
}
// normalise to the loudest effect = LEVEL dBFS, then write 16-bit stereo WAV
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
if (!peak) fail('this page has no block that makes a sound (cards, transitions, chips, stickers, keys, fast-forward)');
const g = Math.pow(10, LEVEL / 20) / peak;
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * g * 32767))), i * 4); data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * g * 32767))), i * 4 + 2); }
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([hdr, data]));
console.log(`${path.relative(ROOT, file)}: ${log.length} sound(s) over ${duration.toFixed(1)} s -> ${path.relative(process.cwd(), out)} (peak ${LEVEL} dBFS)`);
log.sort((a, b) => a[0] - b[0]).forEach(([t, w]) => console.log(`  ${t.toFixed(1).padStart(6)} s  ${w}`));
console.log('Mix it under the voice:  npm run audio -- renders/<video>.mp4 --music ' + path.relative(process.cwd(), out) + ' --music-db -6\nListen once: a sound on every card is usually too much.');
