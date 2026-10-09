#!/usr/bin/env node
// Backdrop brief: measures how YOU are framed and lit, then writes the prompt (and reference files) for an image
// generator, so the scene it makes (an office, a studio, a living room ...) matches your camera angle and light.
//
//   npm run backdrop -- inputs/me.mp4 --scene office
//   npm run backdrop -- inputs/me.mp4 --describe "a bright loft with brick walls and a big window"
// Options: --scene office|studio|living-room|cafe|library|conference-room   --describe "<free text>"
//          --at <seconds> (frame to measure, default the middle)   --name <output name>
//
// What it measures from a frame of your video (no AI, no upload): where your eyes sit in the frame (the horizon line
// the scene must share), how big your head is (shot type), which side the key light comes from, how bright you are,
// and how warm or cool the room's light is. Needs `npm run face` once (it runs it for you if no track matches).
// Writes next to the video (inputs/ is git-ignored, your face never reaches git):
//   <name>.backdrop.json    the measurements and ready-to-paste cutout.js settings
//   <name>.backdrop.txt     the prompt: (A) text-only, any image model  (B) image-edit with the reference frame
//   <name>.frame.png        reference frame (you, original background): attach it for prompt B
//   <name>.mask.png         white = background to replace (needs <name>.cutout.webm from `npm run cutout`)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error('backdrop: ' + m); process.exit(1); };

export const SCENES = {
  office: 'a modern, uncluttered home office: a light-grey wall, a tall bookshelf with books and a couple of plants on one side, a large window letting in soft daylight on the other, one or two framed abstract prints, a hint of a wooden desk edge far from the camera',
  studio: 'a creator studio: a dark textured wall with acoustic panels, warm practical lamps and soft out-of-focus fairy lights, a neon-free, tasteful and moody look',
  'living-room': 'a calm living room: a neutral plaster wall, a cosy sofa edge and a floor lamp, a plant, framed art, warm evening light from a window',
  cafe: 'a quiet specialty cafe: exposed brick and wood, hanging pendant lights, shelves with cups, a few blurred tables far behind',
  library: 'a private library: floor-to-ceiling wooden bookshelves full of books, a brass reading lamp, warm light',
  'conference-room': 'a bright modern conference room: a glass wall to a softly blurred open-plan office, a whiteboard edge, neutral grey tones'
};

function parseArgs(argv) {
  const o = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2), v = argv[++i]; if (v === undefined) fail(`--${k} needs a value`); o[k] = v; } else rest.push(argv[i]);
  }
  o.input = rest[0];
  return o;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') fail('ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)');
  return r;
}
function ff(args) { const r = run('ffmpeg', ['-loglevel', 'error', '-y', ...args]); if (r.status !== 0) fail('ffmpeg failed:\n' + (r.stderr || '').trim()); }

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  if (r.status !== 0) fail('ffprobe could not read ' + file);
  const j = JSON.parse(r.stdout), s = (j.streams || [])[0];
  if (!s) fail('no video stream in ' + file);
  return { w: s.width, h: s.height, duration: parseFloat(j.format.duration) };
}

// signalstats of a crop of the frame: { y, u, v } averages (YUV 0-255)
function stats(frame, x, y, w, h) {
  const r = run('ffmpeg', ['-v', 'error', '-i', frame, '-vf', `crop=${w}:${h}:${x}:${y},signalstats,metadata=print:file=-`, '-f', 'null', '-']);
  const get = (k) => { const m = (r.stdout + r.stderr).match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`)); return m ? parseFloat(m[1]) : NaN; };
  return { y: get('YAVG'), u: get('UAVG'), v: get('VAVG') };
}

// Head box (hair to chin) in source pixels: a matching face track, or run the face detector for this video.
function headBox(video, t, size) {
  const name = path.basename(video);
  const readTrack = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let tr = readTrack(path.join(ROOT, 'inputs/face-track.json'));
  if (!tr || path.basename(String(tr.source || '')) !== name) {
    const tmp = path.join(os.tmpdir(), 'hf-backdrop-track.json');
    console.log('  no face track for this video yet: running face detection once (installs OpenCV on first use)');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/face-track.mjs'), video, tmp], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) fail('face detection failed (see above)');
    tr = readTrack(tmp);
    try { fs.rmSync(tmp); fs.rmSync(tmp.replace(/\.json$/, '.js')); } catch { /* ignore */ }
  }
  const sx = size.w / (tr.frame ? tr.frame[0] : size.w), sy = size.h / (tr.frame ? tr.frame[1] : size.h);
  const pts = tr.track.filter((p) => Math.abs(p.t - t) <= 1.5);
  const use = pts.length ? pts : tr.track;
  const avg = (k) => use.reduce((a, p) => a + p[k], 0) / use.length;
  return { x0: avg('x0') * sx, y0: avg('y0') * sy, x1: avg('x1') * sx, y1: avg('y1') * sy };
}

export function measure(video, t, size) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-backdrop-'));
  const frame = path.join(tmp, 'frame.png');
  ff(['-ss', String(t), '-i', video, '-frames:v', '1', frame]);
  const b = headBox(video, t, size);
  const hw = b.x1 - b.x0, hh = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2;
  const face = stats(frame, Math.round(b.x0 + hw * 0.18), Math.round(b.y0 + hh * 0.3), Math.round(hw * 0.64), Math.round(hh * 0.5));
  const left = stats(frame, Math.round(b.x0 + hw * 0.18), Math.round(b.y0 + hh * 0.3), Math.round(hw * 0.3), Math.round(hh * 0.5));
  const right = stats(frame, Math.round(b.x0 + hw * 0.52), Math.round(b.y0 + hh * 0.3), Math.round(hw * 0.3), Math.round(hh * 0.5));
  const cw = Math.round(size.w * 0.1), ch = Math.round(size.h * 0.12);
  const bgL = stats(frame, 0, 0, cw, ch), bgR = stats(frame, size.w - cw, 0, cw, ch);
  const bgU = (bgL.u + bgR.u) / 2, bgV = (bgL.v + bgR.v) / 2;
  fs.rmSync(tmp, { recursive: true, force: true });
  const eyeY = b.y0 + hh * 0.46, headFrac = hh / size.h;
  const lean = (left.y - right.y) / Math.max(1, (left.y + right.y) / 2);
  const warmth = (bgV - 128) - (bgU - 128);          // > 0 leans warm (red), < 0 leans cool (blue)
  return {
    frame: { width: size.w, height: size.h, at: t },
    head: { x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) },
    eyeLinePct: Math.round(eyeY / size.h * 100),
    headHeightPct: Math.round(headFrac * 100),
    shot: headFrac > 0.42 ? 'close-up' : headFrac > 0.26 ? 'medium close-up' : 'medium shot',
    subjectSide: cx < size.w * 0.45 ? 'left of centre' : cx > size.w * 0.55 ? 'right of centre' : 'centred',
    keyLight: Math.abs(lean) < 0.04 ? 'front-on, even' : lean > 0 ? 'from the left' : 'from the right',
    exposure: face.y < 95 ? 'dim' : face.y > 150 ? 'bright' : 'normal',
    faceLuma: Math.round(face.y),
    roomLight: warmth > 5 ? 'warm' : warmth < -5 ? 'cool' : 'neutral'
  };
}

export function buildPrompts(m, sceneText) {
  const clearL = Math.max(0, Math.round((m.head.x0 / m.frame.width) * 100 - 6)), clearR = Math.min(100, Math.round((m.head.x1 / m.frame.width) * 100 + 6));
  const light = { 'from the left': 'soft key light from the left side of the frame', 'from the right': 'soft key light from the right side of the frame', 'front-on, even': 'soft, even front light' }[m.keyLight];
  const temp = { warm: 'warm (about 3500 K) practical light', neutral: 'neutral daylight (about 5000 K)', cool: 'cool daylight (about 6000 K)' }[m.roomLight];
  const common = `Perspective: a camera at the person's eye level, shot on a 35 mm lens, the horizon (eye level) sits ${m.eyeLinePct}% down from the top of the frame, so vertical lines stay straight and the floor and ceiling lines converge toward that horizon. ` +
    `The person sits ${m.subjectSide}; keep the area from ${clearL}% to ${clearR}% across the frame, from ${Math.max(0, m.eyeLinePct - 22)}% down to the bottom, free of furniture and objects (a ${m.shot}). ` +
    `Lighting: ${light}, ${temp}, ${m.exposure === 'dim' ? 'low-key and moody' : m.exposure === 'bright' ? 'bright and airy' : 'balanced exposure'}. ` +
    'Shallow depth of field (about f/2): the background is softly out of focus with natural bokeh. 16:9 landscape, 1920x1080, photoreal, natural colour, no text, no logos, no watermarks.';
  const A = `Photorealistic background plate for a talking-head video, with no people in it: ${sceneText}. ${common}`;
  const B = `Edit the attached frame: keep the person exactly as they are (face, hair, glasses, clothes, pose, lighting on them) and replace ONLY the background with ${sceneText}. ` +
    `Match the attached frame's camera angle and perspective: ${common.replace(/^Perspective: /, '')} The new background must look lit by the same light as the person.`;
  return { A, B };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.input) fail('usage: npm run backdrop -- <video> --scene office|studio|living-room|cafe|library|conference-room  (or --describe "...")');
  const video = path.resolve(o.input);
  if (!fs.existsSync(video)) fail(`${o.input} not found`);
  const sceneKey = o.scene || (o.describe ? null : 'office');
  if (sceneKey && !SCENES[sceneKey]) fail(`unknown scene "${sceneKey}". Choose one of: ${Object.keys(SCENES).join(', ')}, or use --describe "..."`);
  const sceneText = o.describe || SCENES[sceneKey];
  const size = probe(video), t = o.at !== undefined ? parseFloat(o.at) : Math.round(size.duration / 2 * 10) / 10;
  const base = path.join(path.dirname(video), o.name || path.basename(video).replace(/\.[^.]+$/, ''));

  console.log(`backdrop: measuring ${path.basename(video)} at ${t}s`);
  const m = measure(video, t, size);
  const { A, B } = buildPrompts(m, sceneText);
  const brightness = m.exposure === 'dim' ? 0.82 : m.exposure === 'bright' ? 1.04 : 0.96;
  const sceneName = sceneKey || 'scene';
  const snippet = `{ t: 0, kind: 'scene', src: 'inputs/${sceneName}.png', blur: 3, brightness: ${brightness}, tone: '${m.roomLight}' }`;

  ff(['-ss', String(t), '-i', video, '-frames:v', '1', base + '.frame.png']);
  const cutout = base + '.cutout.webm';
  let maskNote = '';
  if (fs.existsSync(cutout)) {
    ff(['-c:v', 'libvpx-vp9', '-ss', String(Math.max(0, t - (parseFloat(o.from) || 0))), '-i', cutout, '-frames:v', '1', '-vf', 'format=yuva420p,alphaextract,negate,erosion', base + '.mask.png']);
    maskNote = `\n  mask:      ${path.relative(ROOT, base)}.mask.png (white = background to replace)`;
  }
  fs.writeFileSync(base + '.backdrop.json', JSON.stringify({ ...m, scene: sceneText, cutoutSettings: snippet }, null, 2) + '\n');
  fs.writeFileSync(base + '.backdrop.txt', `PROMPT A - text only (any image model; pick the size 1920x1080 or 16:9)\n\n${A}\n\n\nPROMPT B - image edit (attach ${path.basename(base)}.frame.png${maskNote ? ' and ' + path.basename(base) + '.mask.png' : ''})\n\n${B}\n\n\nThen save the result as inputs/${sceneName}.png and add to projects/speaker-cutout/cutout.js:\n  ${snippet}\n`);

  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
  console.log(`
measured: eyes at ${m.eyeLinePct}% from the top, head ${m.headHeightPct}% of the frame (${m.shot}), you are ${m.subjectSide}, light ${m.keyLight}, ${m.exposure}, room light ${m.roomLight}
wrote:    ${rel(base)}.backdrop.txt  (the prompts)   ${rel(base)}.backdrop.json  ${rel(base)}.frame.png${maskNote}

PROMPT A (text only):
${A}

Then save the image as inputs/${sceneName}.png and use it as a background in projects/speaker-cutout/cutout.js:
  ${snippet}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
