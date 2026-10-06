#!/usr/bin/env node
// Cut the pauses. Finds the silent gaps in the voice track and builds a jump-cut edit that keeps only the speech.
//
//   node scripts/auto-trim.mjs <media> [--also <second-media>] [--noise -35] [--min-pause 0.45] [--handle 0.04]
//                                      [--apply] [--out <dir>] [--id cam]
//
//   <media>        the file that carries the voice (talking-head video, or the webcam file in a screen share)
//   --also         a second file recorded at the same time (the silent screen recording); gets the same cuts
//   --noise        silence threshold in dB (raise to -30 in a noisy room, lower to -40 for a quiet mic)
//   --min-pause    only pauses longer than this (s) are cut; shorter ones are natural rhythm
//   --handle       audio kept on each side of speech (s), so a word is never clipped
//   --apply        also write <basename>.trimmed.mp4 (re-encoded h264/aac) for people who want one clean file
//   --out          where to write; default = the folder of <media>
//   --id           id of the first printed <video> clip (default: cam with --also, else footage)
//
// Writes <out>/<basename>.cuts.json:
//   { source, duration, removed, segments: [{ start, end }], cuts: [t, ...] }
// `segments` are in SOURCE time, `cuts` are in OUTPUT time (where each jump cut lands): paste them into share.js `cuts`.
// Prints HyperFrames <video> clips that play the segments back to back with no re-encode
// (src paths are repo-relative, which is what index.html and projects/screen-share resolve).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MERGE_GAP = 0.1;     // keep segments closer than this are joined (a 0.08 s cut is a glitch, not an edit)
const MIN_KEEP = 0.25;     // shortest segment we ever output

function fail(msg) { console.error('auto-trim: ' + msg); process.exit(1); }

// ---- args ----
function parseArgs(argv) {
  const o = { noise: -35, minPause: 0.45, handle: 0.04, apply: false, also: null, out: null, id: null, media: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) fail('missing value for ' + a); return argv[++i]; };
    if (a === '--also') o.also = next();
    else if (a === '--noise') o.noise = Number(next());
    else if (a === '--min-pause') o.minPause = Number(next());
    else if (a === '--handle') o.handle = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--id') o.id = next();
    else if (a === '--apply') o.apply = true;
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^#!.*\n/, '').replace(/^\/\/ ?/gm, '')); process.exit(0); }
    else if (a.startsWith('--')) fail('unknown option ' + a);
    else if (!o.media) o.media = a;
    else fail('unexpected argument ' + a);
  }
  if (!o.media) fail('usage: node scripts/auto-trim.mjs <media> [--also <file>] [--noise -35] [--min-pause 0.45] [--handle 0.04] [--apply] [--out <dir>] [--id cam]');
  for (const k of ['noise', 'minPause', 'handle']) if (!Number.isFinite(o[k])) fail('--' + k.replace(/[A-Z]/, (c) => '-' + c.toLowerCase()) + ' must be a number');
  if (o.minPause <= 2 * o.handle) fail('--min-pause must be more than twice --handle');
  return o;
}

// ---- ffmpeg helpers ----
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function requireTools() {
  for (const t of ['ffmpeg', 'ffprobe']) {
    const r = run(t, ['-version']);
    if (r.error || r.status !== 0) fail(t === 'ffmpeg' ? 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)'
      : 'ffprobe not found on PATH - it ships with ffmpeg (macOS: brew install ffmpeg, Windows: winget install ffmpeg)');
  }
}

function probe(file) {
  if (!fs.existsSync(file)) fail('file not found: ' + file);
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,avg_frame_rate', '-of', 'json', file]);
  if (r.status !== 0) fail('ffprobe could not read ' + file + '\n' + r.stderr.trim());
  const j = JSON.parse(r.stdout || '{}');
  const streams = j.streams || [], types = streams.map((s) => s.codec_type);
  const v = streams.find((s) => s.codec_type === 'video'), [n, d] = String(v && v.avg_frame_rate || '0/0').split('/').map(Number);
  return { duration: Number(j.format && j.format.duration) || 0, hasAudio: types.includes('audio'), hasVideo: !!v, fps: d ? n / d : 0 };
}

// Silent ranges [{ start, end }] in source seconds.
function detectSilence(file, o, duration) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af',
    `silencedetect=noise=${o.noise}dB:d=${o.minPause}`, '-f', 'null', '-']);
  if (r.status !== 0) fail('ffmpeg silencedetect failed on ' + file + '\n' + r.stderr.trim().split('\n').slice(-3).join('\n'));
  const out = [];
  let open = null;
  for (const line of r.stderr.split('\n')) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) { open = Math.max(0, Number(m[1])); continue; }
    m = line.match(/silence_end: (-?[\d.]+)/);
    if (m && open !== null) { out.push({ start: open, end: Math.min(duration, Number(m[1])) }); open = null; }
  }
  if (open !== null) out.push({ start: open, end: duration });   // file ends in silence
  return out;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// Speech = everything that is not a long pause, padded by `handle` on both sides.
export function keepSegments(silences, duration, handle, fps = 0) {
  let segs = [], cursor = 0;
  for (const s of silences) {
    const cutFrom = s.start <= 0.001 ? 0 : s.start + handle;              // leading silence: no handle needed before it
    const cutTo = s.end >= duration - 0.001 ? duration : s.end - handle;  // trailing silence: same
    if (cutTo - cutFrom <= 0) continue;
    if (cutFrom > cursor) segs.push({ start: cursor, end: cutFrom });
    cursor = Math.max(cursor, cutTo);
  }
  if (cursor < duration) segs.push({ start: cursor, end: duration });

  // A blip shorter than MIN_KEEP (a click, a short "uh") is padded out to MIN_KEEP rather than dropped: never lose a word.
  segs = segs.map((s) => {
    const len = s.end - s.start;
    if (len >= MIN_KEEP) return s;
    const pad = (MIN_KEEP - len) / 2;
    let a = s.start - pad, b = s.end + pad;
    if (a < 0) { b -= a; a = 0; }
    if (b > duration) { a -= b - duration; b = duration; }
    return { start: Math.max(0, a), end: Math.min(duration, b) };
  });

  // snap to whole video frames (start down, end up: only ever keeps a little more), so every clip is an exact frame count
  if (fps > 0) segs = segs.map((s) => ({ start: Math.floor(s.start * fps + 1e-6) / fps, end: Math.min(duration, Math.ceil(s.end * fps - 1e-6) / fps) }));

  // merge overlapping / nearly touching segments
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < MERGE_GAP) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged.filter((s) => s.end - s.start >= MIN_KEEP - 1e-6 || merged.length === 1)
    .map((s) => ({ start: r3(s.start), end: r3(s.end) }));
}

// Output-timeline position of each segment (rounded durations summed, so clips butt together exactly).
function timeline(segs) {
  let t = 0;
  return segs.map((s) => { const len = r3(s.end - s.start), row = { at: r3(t), len, from: s.start }; t = r3(t + len); return row; });
}

function clipsHtml(rows, src, id, voice) {
  const style = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  return rows.map((r, i) => `<video ${i === 0 ? `id="${id}" ` : `id="${id}-${i + 1}" `}class="clip" src="${src}" ` +
    `data-start="${r.at}" data-duration="${r.len}" data-media-start="${r.from}"` +
    (voice ? ' data-has-audio="true"' : ' muted') + ` style="${style}" playsinline></video>`).join('\n');
}

// Re-encode just the kept segments into one file (trim + concat in one filter graph).
// Cuts are by TIME, never by frame number: screen recordings are often variable frame rate, where frame N is not
// at N / fps. Video is first normalised to a constant rate (`fps`, the voice file's rate, which the segments are
// snapped to), so every file gets the same cut points and the screen stays in sync with the voice.
function applyTrim(file, segs, outFile, info, fps) {
  const parts = [], labels = [];
  const cfr = fps > 0 ? `fps=${fps},` : '';
  segs.forEach((s, i) => {
    if (info.hasVideo) parts.push(`[0:v]${cfr}trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
    if (info.hasAudio) parts.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push((info.hasVideo ? `[v${i}]` : '') + (info.hasAudio ? `[a${i}]` : ''));
  });
  const v = info.hasVideo ? 1 : 0, a = info.hasAudio ? 1 : 0;
  parts.push(`${labels.join('')}concat=n=${segs.length}:v=${v}:a=${a}` + (v ? '[vo]' : '') + (a ? '[ao]' : ''));
  const graphFile = outFile + '.filter.txt';
  fs.writeFileSync(graphFile, parts.join(';\n'));   // long edits overflow the command line; a script file does not
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-filter_complex_script', graphFile];
  if (v) args.push('-map', '[vo]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium');
  if (a) args.push('-map', '[ao]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outFile);
  const r = run('ffmpeg', args);
  fs.rmSync(graphFile, { force: true });
  if (r.status !== 0) fail('ffmpeg could not write ' + outFile + '\n' + r.stderr.trim());
  const p = probe(outFile);
  return p;
}

// <video src> as the compositions see it: repo-relative with forward slashes (index.html sits at the root and
// projects/screen-share links inputs/ in, so "inputs/x.mp4" works in both).
function srcFor(file) {
  const rel = path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) {
    console.warn(`auto-trim: note: ${file} is outside the repo; move it into inputs/ so the composition can load it.`);
    return path.resolve(file).split(path.sep).join('/');
  }
  return rel;
}

// ---- main ----
function main() {
  const o = parseArgs(process.argv.slice(2));
  requireTools();
  const info = probe(o.media);
  if (!info.hasAudio) fail(o.media + ' has no audio stream. Pass the file that carries the voice (the webcam / talking-head file), and the silent screen recording with --also.');
  if (!info.duration) fail('could not read the duration of ' + o.media);
  const also = o.also ? { file: o.also, ...probe(o.also) } : null;
  if (also && Math.abs(also.duration - info.duration) > 0.5) {
    console.warn(`auto-trim: warning: ${o.also} is ${also.duration.toFixed(2)} s but ${o.media} is ${info.duration.toFixed(2)} s. ` +
      'The cuts assume both start at the same moment; trim the head of the longer one first if they do not.');
  }

  const silences = detectSilence(o.media, o, info.duration);
  const speech = info.duration - silences.reduce((n, s) => n + (s.end - s.start), 0);
  if (speech < MIN_KEEP) {
    console.log(`auto-trim: ${o.media} is silent from start to end (${info.duration.toFixed(2)} s below ${o.noise} dB), so there is nothing to keep.\n` +
      '  - Is this the right file? Pass the one that carries the voice.\n' +
      '  - Quiet mic? Try a lower threshold, e.g. --noise -45.\n' +
      'No cut list written.');
    process.exit(0);
  }

  const segments = keepSegments(silences, info.duration, o.handle, info.fps);
  const rows = timeline(segments);
  const newLen = rows.length ? r3(rows[rows.length - 1].at + rows[rows.length - 1].len) : 0;
  const removed = r3(info.duration - newLen);
  const cuts = rows.slice(1).map((r) => r.at);
  const pauses = cuts.length + (segments[0].start > 0 ? 1 : 0) + (segments[segments.length - 1].end < info.duration - 0.001 ? 1 : 0);

  const outDir = o.out || path.dirname(o.media);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(o.media).replace(/\.[^.]+$/, '');
  const jsonFile = path.join(outDir, base + '.cuts.json');
  fs.writeFileSync(jsonFile, JSON.stringify({ source: o.media, duration: r3(info.duration), removed, segments, cuts }, null, 2) + '\n');

  const pct = Math.round((removed / info.duration) * 100);
  console.log(`\n${o.media}: ${pauses} pause${pauses === 1 ? '' : 's'} removed, ${removed.toFixed(2)} s saved (${pct}%), ` +
    `${r3(info.duration).toFixed(2)} s -> ${newLen.toFixed(2)} s, ${segments.length} segment${segments.length === 1 ? '' : 's'}, ${cuts.length} jump cut${cuts.length === 1 ? '' : 's'}.`);
  console.log('wrote ' + jsonFile);
  if (!cuts.length) console.log('No pause longer than ' + o.minPause + ' s: nothing to cut.');

  const id = o.id || (also ? 'cam' : 'footage');
  console.log(`\n<!-- voice: ${segments.length} clips, no re-encode. Set the composition data-duration to ${newLen}. -->`);
  console.log(clipsHtml(rows, srcFor(o.media), id, true));
  if (also) {
    console.log(`\n<!-- ${srcFor(o.also)}: same cuts, muted, so screen and voice stay in sync -->`);
    console.log(clipsHtml(rows, srcFor(o.also), 'screen', false));
  }
  if (cuts.length) console.log(`\n// share.js (output time): duration: ${newLen},\ncuts: [${cuts.join(', ')}],`);

  if (o.apply) {
    for (const f of [{ file: o.media, ...info }, also].filter(Boolean)) {
      const outFile = path.join(outDir, path.basename(f.file).replace(/\.[^.]+$/, '') + '.trimmed.mp4');
      process.stdout.write(`\nencoding ${outFile} ... `);
      const got = applyTrim(f.file, segments, outFile, f, info.fps || f.fps);
      console.log(`${got.duration.toFixed(3)} s (expected ${newLen.toFixed(3)} s; AAC adds up to ~0.05 s of padding)`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
