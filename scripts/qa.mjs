#!/usr/bin/env node
// Frame-by-frame QA of an ENCODED video (the encoded file is the acceptance artifact, not the preview).
//   npm run qa -- <video.mp4> [options]         (any cwd; paths are relative to cwd or the repo root)
//
//   --name <run>        run name, the folder is qa/<run>/ (default: the video's file name without extension)
//   --page <html>       the composition that produced the video (index.html, projects/screen-share/index.html ...):
//                       reads the expected duration, the audio expectation and the cue times (templates, camera, zooms)
//   --every N           extract every Nth frame (default 1 when the video has <= 3600 frames, else 5)
//   --width 960         JPEG width of the extracted frames (quality q 3)
//   --compare <run>     adds another QA run as a second variant in the viewer (same frame number, e.g. before/after grading)
//
// Steps: gates (ffprobe) -> frames (one ffmpeg pass) -> automated checks (one ffmpeg pass: black, frozen, duplicate
// frames, flash safety, loudness) -> cues -> manifest.json + report.json + qa/index.json.
// Then:  npm run library   and open  http://localhost:4173/library/qa.html
//
// Exit code 1 only when a gate or a failing check fails (duration mismatch, missing audio, black run over 1.2 s,
// more than 3 flashes in one second). Warnings exit 0. This script NEVER sets the human checklist or the owner
// approval to PASS: those stay PENDING until a person reviews the frames.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { templateHosts, pageScripts } from './lib/load-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Thresholds (documented in the report and the viewer)
const T = {
  maxBlackDip: 1.2,        // s: a black run up to this long is a dip-to-black transition (warn if mid-video); longer FAILS
  freezeTol: '-50dB',      // freezedetect noise tolerance (about 0.8/255 mean difference)
  freezeMin: 1.5,          // s: a frozen stretch at least this long is reported (warning only)
  dupDiff: 0.02,           // luma difference (0-255) under which a frame counts as a duplicate of the previous one
  flashSwing: 0.10,        // adjacent-frame luma swing, as a fraction of the display range, that counts as a flash edge
  maxFlashes: 3,           // more than this many flashes in any 1 s window FAILS
  lufsTarget: -14, lufsTol: 2, truePeak: -1
};

const CATEGORIES = ['overlap_and_collisions', 'clipping_and_bounds', 'blank_black_stale_frames', 'caption_timing_and_persistence',
  'caption_safe_zones', 'transitions_and_cue_timing', 'motion_easing_and_continuity', 'stacking_masks_and_pip',
  'typography_contrast_and_readability', 'asset_fit_and_truth', 'deterministic_seeking'];

const validName = (n) => /^[\w-][\w.-]*$/.test(n);
const HELP = `usage: npm run qa -- <video.mp4> [--name run] [--page index.html] [--every N] [--width 960] [--compare other-run]`;
const fail = (msg) => { console.error('qa: ' + msg); process.exit(1); };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const r3 = (x) => Math.round(x * 1000) / 1000;
const fmtT = (t) => t.toFixed(2) + 's';
const pad5 = (n) => String(n).padStart(5, '0');
const resolveIn = (arg) => (fs.existsSync(arg) ? path.resolve(arg) : path.join(ROOT, arg));
const FFMPEG_MISSING = 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error && r.error.code === 'ENOENT') fail(FFMPEG_MISSING);
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  return r;
}

// ---------- 1. gates ----------
function probe(video) {
  const r = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]);
  if (r.status !== 0) fail(`ffprobe could not read ${video}: ${(r.stderr || '').trim().split('\n').pop()}`);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!v) fail(`${video} has no video stream`);
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const [n, d] = String(v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate).split('/').map(Number);
  const fps = d ? n / d : n;
  const duration = parseFloat(v.duration || (j.format && j.format.duration));
  let frames = parseInt(v.nb_frames, 10);
  if (!Number.isFinite(frames)) {
    const c = run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', video]);
    frames = parseInt(c.stdout, 10) || Math.round(duration * fps);
  }
  return { width: v.width, height: v.height, fps: r3(fps), frames, duration: r3(duration), audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: a.sample_rate } : null };
}

// Root composition duration + whether the page expects audio (a <video data-has-audio="true"> or an <audio>).
const TAGS = /<(\w+)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
function readPage(file) {
  const html = fs.readFileSync(file, 'utf8');
  let expectsAudio = false, main = null, first = null;
  const dur = (tag) => { const d = tag.match(/\sdata-duration\s*=\s*["']([\d.]+)["']/); return d ? parseFloat(d[1]) : null; };
  for (const m of html.matchAll(TAGS)) {
    const tag = m[0], name = m[1].toLowerCase();
    if (main === null && /\sdata-composition-id\s*=\s*["']main["']/.test(tag) && dur(tag) !== null) main = dur(tag);
    if (first === null && /\sdata-width\s*=/.test(tag) && dur(tag) !== null) first = dur(tag);
    if (name === 'audio') expectsAudio = true;
    if (name === 'video' && /\sdata-has-audio\s*=\s*["']true["']/.test(tag)) expectsAudio = true;
  }
  const duration = main !== null ? main : first;
  return { html, duration, expectsAudio, rootSource: main !== null ? 'data-composition-id="main"' : first !== null ? 'first element with data-width and data-duration' : null };
}

function buildGates(info, page) {
  const g = [];
  const okSize = (info.width === 1920 && info.height === 1080) || (info.width === 1080 && info.height === 1920);
  g.push({ id: 'resolution', label: 'Resolution', status: okSize ? 'pass' : 'warn', detail: `${info.width}x${info.height}${okSize ? '' : ' (expected 1920x1080 or 1080x1920)'}` });
  g.push({ id: 'fps', label: 'Frame rate', status: 'info', detail: `${info.fps} fps` });
  g.push({ id: 'frames', label: 'Frames / duration', status: 'info', detail: `${info.frames} frames, ${info.duration} s` });
  if (page && page.duration !== null) {
    const diff = Math.abs(info.duration - page.duration);
    g.push({ id: 'duration', label: 'Duration vs page', status: diff > 0.1 ? 'fail' : 'pass', detail: `video ${info.duration} s, page data-duration ${page.duration} s from ${page.rootSource} (off by ${r3(diff)} s, limit 0.1 s)` });
  } else if (page) {
    g.push({ id: 'duration', label: 'Duration vs page', status: 'warn', detail: 'no root data-duration found in the page' });
  }
  if (page && page.expectsAudio) g.push({ id: 'audio', label: 'Audio stream', status: info.audio ? 'pass' : 'fail', detail: info.audio ? `${info.audio.codec}, ${info.audio.channels} ch` : 'the page has audio (video data-has-audio or <audio>) but the render has no audio stream' });
  else g.push({ id: 'audio', label: 'Audio stream', status: info.audio ? 'pass' : 'info', detail: info.audio ? `${info.audio.codec}, ${info.audio.channels} ch` : 'no audio stream' + (page ? ' (the page expects none)' : ' (pass --page to check it against the composition)') });
  return g;
}

// ---------- 2. frames ----------
function extractFrames(video, outDir, step, width, expected) {
  for (const f of fs.readdirSync(outDir)) if (/^f\d{5,}\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));
  const tmp = path.join(outDir, '_tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  const vf = [step > 1 ? `select='not(mod(n,${step}))'` : null, `scale='min(${width},iw)':-2`].filter(Boolean).join(',');
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', vf, '-fps_mode', 'vfr', '-q:v', '3', '-start_number', '0', path.join(tmp, '%05d.jpg')]);
  if (r.status !== 0) fail('ffmpeg frame extraction failed: ' + (r.stderr || '').trim().split('\n').pop());
  const got = fs.readdirSync(tmp).filter((f) => /^\d{5}\.jpg$/.test(f)).sort();
  // file names carry SOURCE frame numbers: sequential output i is source frame i * step
  got.forEach((f, i) => fs.renameSync(path.join(tmp, f), path.join(outDir, `f${pad5(i * step)}.jpg`)));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (got.length !== expected) console.warn(`qa: warning: extracted ${got.length} frames, expected ${expected}`);
  return got.length;
}

// ---------- 3. automated checks (one ffmpeg pass) ----------
function analyse(video, info, fps) {
  const chain = [
    `blackdetect=d=${r3(0.9 / fps)}:pic_th=0.98:pix_th=0.10`,
    `freezedetect=n=${T.freezeTol}:d=0.5`,
    'signalstats',
    'metadata=mode=print:file=-'
  ].join(',');
  const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-i', video, '-map', '0:v:0', '-vf', chain];
  if (info.audio) args.push('-map', '0:a:0', '-af', `loudnorm=I=${T.lufsTarget}:TP=${T.truePeak}:print_format=json`);
  args.push('-f', 'null', '-');
  const r = run('ffmpeg', args);
  if (r.status !== 0) fail('ffmpeg analysis failed: ' + (r.stderr || '').trim().split('\n').slice(-3).join(' | '));

  // per-frame luma + difference from stdout (metadata print)
  const yavg = [], ydif = [];
  let n = -1;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('frame:')) { n = parseInt(line.slice(6), 10); continue; }
    const eq = line.indexOf('=');
    if (eq < 0 || n < 0) continue;
    const k = line.slice(0, eq);
    if (k === 'lavfi.signalstats.YAVG') yavg[n] = parseFloat(line.slice(eq + 1));
    else if (k === 'lavfi.signalstats.YDIF') ydif[n] = parseFloat(line.slice(eq + 1));
  }

  // black / freeze ranges from the filter logs
  const black = [...r.stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)]
    .map((m) => ({ start: r3(+m[1]), end: r3(+m[2]), dur: r3(+m[3]) }));
  const freeze = [];
  let cur = null;
  for (const m of r.stderr.matchAll(/lavfi\.freezedetect\.freeze_(start|end|duration):\s*([\d.]+)/g)) {
    if (m[1] === 'start') cur = { start: +m[2] };
    else if (m[1] === 'end' && cur) { cur.end = +m[2]; }
    else if (m[1] === 'duration' && cur) { cur.dur = +m[2]; freeze.push(cur); cur = null; }
  }
  if (cur) freeze.push({ start: cur.start, end: info.duration, dur: info.duration - cur.start });   // still frozen at the end
  const frozen = freeze.map((f) => ({ start: r3(f.start), end: r3(f.end ?? f.start + f.dur), dur: r3(f.dur) }));

  let loudness = null;
  if (info.audio) {
    const m = [...r.stderr.matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)].pop();
    if (m) {
      const j = JSON.parse(m[0]), num = (x) => (x === '-inf' ? -Infinity : parseFloat(x));
      loudness = { integrated: num(j.input_i), truePeak: num(j.input_tp), range: num(j.input_lra) };
    }
  }
  return { yavg, ydif, black, frozen, loudness };
}

// Flash safety from per-frame mean luma: an approximation of WCAG 2.3.1 (general flash threshold).
// Luma is mapped to the display range (16-235 -> 0-1); a swing of >= 10% between adjacent frames is a flash edge;
// two consecutive edges of opposite sign are one flash; more than 3 flashes inside any 1 s window fails.
// It does not use linear relative luminance, the 25% area rule or the red-flash test, so treat it as a screen, not a certificate.
function flashCheck(yavg, fps) {
  const L = yavg.map((y) => Math.min(1, Math.max(0, (y - 16) / 219)));
  const edges = [];
  for (let i = 1; i < L.length; i++) {
    if (L[i] === undefined || L[i - 1] === undefined) continue;
    const d = L[i] - L[i - 1];
    if (Math.abs(d) >= T.flashSwing) edges.push({ i, sign: Math.sign(d) });
  }
  const flashes = [];   // frame index where each flash (a pair of opposing edges) completes
  for (let k = 1; k < edges.length; k++) if (edges[k].sign !== edges[k - 1].sign) { flashes.push(edges[k].i); k++; }
  const win = Math.round(fps);
  const windows = [];
  let max = 0;
  for (let k = 0; k < flashes.length; k++) {
    let c = 1;
    for (let j = k + 1; j < flashes.length && flashes[j] - flashes[k] < win; j++) c++;
    max = Math.max(max, c);
    if (c > T.maxFlashes) {
      const last = flashes.filter((f) => f >= flashes[k] && f - flashes[k] < win).pop();
      const w = { start: r3(flashes[k] / fps), end: r3(last / fps), flashes: c };
      const prev = windows[windows.length - 1];
      if (prev && w.start <= prev.end) { prev.end = Math.max(prev.end, w.end); prev.flashes = Math.max(prev.flashes, c); } else windows.push(w);
    }
  }
  return { edges: edges.length, flashes: flashes.length, maxPerSecond: max, windows };
}

// ---------- 4. cues ----------
function loadData(pageFile, html) {
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const dir = path.dirname(pageFile);
  for (const src of pageScripts(html)) {
    if (!/(?:^|\/)(camera|share|cutout)\.js$/.test(src)) continue;
    const file = [dir, ROOT].map((b) => path.resolve(b, src)).find((p) => fs.existsSync(p));
    if (!file) continue;
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel(file) }); } catch (e) { console.warn(`qa: warning: could not read ${src}: ${e.message}`); }
  }
  return ctx;
}

function buildCues(pageFile, html) {
  const cues = [];
  const add = (t, label, kind) => { if (Number.isFinite(t)) cues.push({ t: r3(t), label, kind }); };
  for (const h of templateHosts(pageFile)) {
    if (!Number.isFinite(h.start) || !Number.isFinite(h.dur)) continue;
    add(h.start, `${h.template} in (${h.id})`, 'enter');
    add(h.start + h.dur, `${h.template} out (${h.id})`, 'exit');
  }
  const D = loadData(pageFile, html);
  const camera = D.__hfCamera, share = D.__hfShare, cutout = D.__hfCutout;
  if (camera) {
    for (const m of camera.moves || []) add(m.t, m.win === 'full' ? 'camera: back to full frame' : m.win ? 'camera: speaker PiP window' : `camera: punch ${m.scale ?? ''}x`.replace(' x', 'x'), 'camera');
    for (const t of camera.cuts || []) add(t, 'camera: jump cut', 'camera');
  }
  if (share) {
    for (const z of share.zooms || []) add(z.t, z.z === 1 ? 'zoom: out to overview' : `zoom: ${z.z}x at ${z.x}, ${z.y}`, 'camera');
    for (const c of share.cam || []) add(c.t, `webcam: ${c.mode}`, 'camera');
    for (const t of share.cuts || []) add(t, 'webcam: jump cut', 'camera');
  }
  if (cutout) {
    for (const b of cutout.backgrounds || []) add(b.t, `background: ${b.kind}${b.preset ? ' ' + b.preset : ''}`, 'camera');
    for (const m of cutout.moves || []) add(m.t, `speaker move: x ${m.x ?? 0}, scale ${m.scale ?? 1}`, 'camera');
  }
  return cues;
}

// ---------- main ----------
function main() {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: {
      name: { type: 'string' }, page: { type: 'string' }, every: { type: 'string' }, width: { type: 'string' }, compare: { type: 'string' }, help: { type: 'boolean', short: 'h' }
    } });
  } catch (e) { fail(`${e.message}\n${HELP}`); }
  const { values: o, positionals } = parsed;
  if (o.help || !positionals[0]) { console.log(HELP); process.exit(o.help ? 0 : 1); }

  const videoArg = positionals[0];
  const video = resolveIn(videoArg);
  if (!fs.existsSync(video)) fail(`video not found: ${videoArg}`);
  const name = o.name || path.basename(video, path.extname(video));
  if (!validName(name)) fail(`run name "${name}" is not allowed: use letters, digits, dot, dash and underscore, and do not start with a dot (pass --name)`);
  const width = o.width ? parseInt(o.width, 10) : 960;
  if (!(width >= 64)) fail('--width must be a number of pixels (64 or more)');
  let pageFile = null, page = null;
  if (o.page) {
    pageFile = resolveIn(o.page);
    if (!fs.existsSync(pageFile)) fail(`page not found: ${o.page}`);
    page = readPage(pageFile);
  }
  let other = null;
  if (o.compare) {
    if (!validName(o.compare)) fail(`--compare "${o.compare}" is not a QA run name (letters, digits, dot, dash, underscore; no leading dot)`);
    const mf = path.join(ROOT, 'qa', o.compare, 'manifest.json');
    if (!fs.existsSync(mf)) fail(`--compare: no QA run named "${o.compare}" (expected ${rel(mf)}); run npm run qa on that video first`);
    try { other = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { fail(`--compare: ${rel(mf)} is not valid JSON (${e.message})`); }
    if (!other || typeof other.files !== 'string' || !(other.frames >= 1) || !(other.step >= 1) || !(other.fps > 0)) fail(`--compare: ${rel(mf)} is not a QA run manifest (needs files, frames, step, fps); re-run npm run qa for "${o.compare}"`);
    other.name = o.compare;
  }

  const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (hasFfmpeg.error) fail(FFMPEG_MISSING);

  // 1. gates
  const info = probe(video);
  let step;
  if (o.every) { step = parseInt(o.every, 10); if (!(step >= 1)) fail('--every must be a whole number, 1 or more'); }
  else { step = info.frames <= 3600 ? 1 : 5; console.log(`qa: ${info.frames} frames -> extracting ${step === 1 ? 'every frame' : 'every ' + step + ' frames'} (default for ${info.frames <= 3600 ? 'up to 3600' : 'more than 3600'} frames; override with --every N)`); }
  const gates = buildGates(info, page);

  const outDir = path.join(ROOT, 'qa', name);
  fs.mkdirSync(outDir, { recursive: true });

  // 2. frames
  const expected = Math.ceil(info.frames / step);
  console.log(`qa: extracting ${expected} frames at ${width}px ...`);
  const extracted = extractFrames(video, outDir, step, width, expected);

  // 3. automated checks
  console.log('qa: analysing (black, frozen, duplicates, flashes, loudness) ...');
  const A = analyse(video, info, info.fps);
  const checks = {};
  const auto = {};

  const longBlack = A.black.filter((b) => b.dur > T.maxBlackDip);
  const dips = A.black.filter((b) => b.dur <= T.maxBlackDip && b.start > 0.05 && b.end < info.duration - 0.05);
  checks.black = { ranges: A.black, maxDip: T.maxBlackDip };
  auto.black = longBlack.length ? { status: 'fail', summary: `${longBlack.length} black run(s) over ${T.maxBlackDip} s: ${longBlack.map((b) => `${fmtT(b.start)}-${fmtT(b.end)}`).join(', ')}` }
    : dips.length ? { status: 'warn', summary: `${dips.length} short black run(s) mid-video (fine if an intended dip-to-black): ${dips.slice(0, 4).map((b) => `${fmtT(b.start)}-${fmtT(b.end)}`).join(', ')}${dips.length > 4 ? ` +${dips.length - 4} more` : ''}` }
    : { status: 'pass', summary: A.black.length ? 'black only at the start/end (fade in or out)' : 'no black frames' };

  const blackCover = (f) => A.black.some((b) => f.start >= b.start - 0.1 && f.end <= b.end + 0.1);
  const longFrozen = A.frozen.filter((f) => f.dur >= T.freezeMin && !blackCover(f));
  checks.frozen = { ranges: A.frozen.filter((f) => !blackCover(f)), tolerance: T.freezeTol, minReported: T.freezeMin };
  auto.frozen = longFrozen.length ? { status: 'warn', summary: `${longFrozen.length} frozen stretch(es) of ${T.freezeMin} s or more: ${longFrozen.map((f) => `${fmtT(f.start)}-${fmtT(f.end)}`).join(', ')}` }
    : { status: 'pass', summary: `no frozen stretch of ${T.freezeMin} s or more` };

  const dupes = A.ydif.reduce((c, d, i) => c + (i > 0 && d !== undefined && d < T.dupDiff ? 1 : 0), 0);
  const ratio = A.ydif.length > 1 ? dupes / (A.ydif.length - 1) : 0;
  checks.duplicates = { frames: dupes, ratio: r3(ratio), threshold: T.dupDiff };
  auto.duplicates = { status: 'info', summary: `${dupes} duplicate frame(s), ${(ratio * 100).toFixed(1)}% (informational: a 24 fps source in a 30 fps file duplicates on purpose)` };

  const fl = flashCheck(A.yavg, info.fps);
  checks.flash = { ...fl, swing: T.flashSwing, maxAllowedPerSecond: T.maxFlashes, approximation: 'mean-luma WCAG 2.3.1 screen, not a certificate' };
  auto.flash = fl.windows.length ? { status: 'fail', summary: `more than ${T.maxFlashes} flashes in 1 s at ${fl.windows.map((w) => `${fmtT(w.start)}-${fmtT(w.end)} (${w.flashes})`).join(', ')}` }
    : { status: 'pass', summary: `max ${fl.maxPerSecond} flash(es) in any 1 s window (limit ${T.maxFlashes}); approximation of WCAG 2.3.1` };

  const L = A.loudness;
  if (!info.audio) auto.loudness = { status: 'skip', summary: 'no audio stream' };
  else if (!L) auto.loudness = { status: 'warn', summary: 'loudness could not be measured' };
  else if (!Number.isFinite(L.integrated) || L.integrated < -60) auto.loudness = { status: 'warn', summary: 'the audio track is silent' };
  else {
    const off = Math.abs(L.integrated - T.lufsTarget) > T.lufsTol, hot = L.truePeak > T.truePeak;
    auto.loudness = { status: off || hot ? 'warn' : 'pass', summary: `${L.integrated.toFixed(1)} LUFS (target ${T.lufsTarget} +-${T.lufsTol}), true peak ${L.truePeak.toFixed(1)} dBTP (max ${T.truePeak})` };
  }
  const loudness = L ? { ...L, target: T.lufsTarget, tolerance: T.lufsTol, truePeakMax: T.truePeak } : null;
  for (const g of gates) auto[`gate:${g.id}`] = { status: g.status, summary: g.detail };

  // 4. cues
  const cues = pageFile ? buildCues(pageFile, page.html) : [];
  const checkCue = (t, label) => cues.push({ t: r3(t), label, kind: 'check' });
  const inFlash = (b) => fl.windows.some((w) => b.start >= w.start - 0.1 && b.end <= w.end + 0.1);   // strobe blacks are reported once, as the flash
  A.black.filter((b) => !inFlash(b)).forEach((b) => checkCue(b.start, `black ${fmtT(b.start)}-${fmtT(b.end)}${b.dur > T.maxBlackDip ? ' (too long)' : ''}`));
  checks.frozen.ranges.filter((f) => f.dur >= T.freezeMin).forEach((f) => checkCue(f.start, `frozen ${fmtT(f.start)}-${fmtT(f.end)}`));
  fl.windows.forEach((w) => checkCue(w.start, `flash risk ${fmtT(w.start)}-${fmtT(w.end)} (${w.flashes} flashes)`));
  cues.sort((a, b) => a.t - b.t);

  // 5. manifest, report, index
  const created = new Date().toISOString();
  const inKit = video.startsWith(ROOT + path.sep);
  const own = { name, files: 'f%05d.jpg', step, frames: info.frames, fps: info.fps, width: Math.min(width, info.width) };
  const manifest = {
    name, created, video: inKit ? rel(video) : video, page: pageFile ? rel(pageFile) : null,
    fps: info.fps, width: info.width, height: info.height, frames: info.frames, extracted, step, firstFrame: 0,
    files: 'f%05d.jpg', jpegWidth: own.width, duration: info.duration, cues, gates, checks, loudness,
    thresholds: T, variants: other ? [own, { name: other.name, files: other.files, step: other.step, frames: other.frames, fps: other.fps, width: other.jpegWidth }] : [own]
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const reportFile = path.join(outDir, 'report.json');
  if (fs.existsSync(reportFile)) fs.copyFileSync(reportFile, path.join(outDir, `report.${new Date().toISOString().replace(/[:.]/g, '-')}.json`));   // one timestamped backup per re-run; a hand-saved review is never overwritten
  const checklist = {};
  for (const c of CATEGORIES) checklist[c] = { status: 'PENDING', notes: '' };
  const report = {
    generated: created, checklist, coverage: { framesReviewed: 0, framesTotal: info.frames, step },
    issues: [], autoChecks: Object.fromEntries(Object.entries(auto).map(([k, v]) => [k, { status: v.status, summary: v.summary }])),
    verdict: 'PENDING', render_approval: 'PENDING'
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));

  const indexFile = path.join(ROOT, 'qa', 'index.json');
  let index = [];
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* first run */ }
  index = index.filter((r) => r.name !== name);
  index.push({ name, created, frames: info.frames, verdict: report.verdict });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));

  // 6. summary
  console.log(`\nqa/${name}  ${info.width}x${info.height} @ ${info.fps} fps, ${info.frames} frames, ${info.duration} s, ${extracted} JPEGs (${step === 1 ? 'every frame' : 'every ' + step + ' frames'})`);
  const rows = Object.entries(auto);
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${v.status.toUpperCase().padEnd(4)}  ${v.summary}`);
  console.log(`  cues: ${cues.length}   visual QA and owner approval: PENDING (the script never sets them)`);
  const failed = rows.filter(([, v]) => v.status === 'fail');
  console.log(failed.length ? `\nx ${failed.length} failing check(s): ${failed.map(([k]) => k).join(', ')}` : '\nok: no failing checks');
  console.log(`review: npm run library  ->  /library/qa.html?run=${name}`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
