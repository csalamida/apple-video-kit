// Synthetic demo media, generated on first run so the repo ships no footage of a real person.
//   inputs/_demo/speaker.mp4  faceless silhouette + silent audio (talking-head demo, webcam card)
//   inputs/_demo/speaker-cutout.webm  the same silhouette with a transparent background (speaker-cutout demo)
//   inputs/_demo/screen.mp4   test pattern (screen-share demo)
//   inputs/face-track.js/.json  head boxes for the silhouette (only written when missing; detect-face.py
//                               overwrites them with the track of your own footage)
// All of it is git-ignored. Video needs ffmpeg on PATH. Replace them with your own files in inputs/ when you make a real video.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DURATION = 21.92;

// Silhouette geometry. The generated demo face track uses the head box around it.
const HEAD = { cx: 965, cy: 430, rx: 190, ry: 240, bodyY: 1160, bodyRx: 560, bodyRy: 380, neck: [600, 860], neckHalf: 85 };
const HEAD_BOX = { x0: 745, y0: 170, x1: 1185, y1: 690 };
const FACE_FPS = 10;

// Portrait (1080x1920) silhouette for the short-form demo: same faceless shape, head in the upper third.
export const VERTICAL = {
  suffix: '.vertical', frame: [1080, 1920], media: 'inputs/_demo/speaker-vertical.mp4',
  head: { cx: 540, cy: 760, rx: 200, ry: 250, bodyY: 1620, bodyRx: 560, bodyRy: 470, neck: [980, 1260], neckHalf: 90 },
  box: { x0: 320, y0: 490, x1: 760, y1: 1030 }
};

export const FFMPEG_MISSING = 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)';

const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.error && r.error.code === 'ENOENT') { console.error(FFMPEG_MISSING); return false; }
  return r.status === 0;
};

// The faceless silhouette as ffmpeg expressions: `person` is 1 inside it, `ch(bg, fg)` is one colour channel.
function shape(g = HEAD) {
  const head = `lt(pow((X-${g.cx})/${g.rx},2)+pow((Y-${g.cy})/${g.ry},2),1)`;
  const body = `lt(pow((X-${g.cx})/${g.bodyRx},2)+pow((Y-${g.bodyY})/${g.bodyRy},2),1)`;
  const neck = `lt(abs(X-${g.cx}),${g.neckHalf})*gt(Y,${g.neck[0]})*lt(Y,${g.neck[1]})`;
  const person = `gt(${head}+${body}+${neck},0)`;
  const glow = `exp(-(pow(X-${g.cx},2)+pow(Y-${g.cy - 10},2))/500000)`;
  const ch = (bg, fg) => `if(${person},${fg}-0.03*(Y-${g.cy - 130}),${bg[0]}+${bg[1]}*${glow})`;
  return { person, ch };
}
const rgb = (ch) => `r='${ch([14, 30], 64)}':g='${ch([18, 34], 68)}':b='${ch([26, 48], 80)}'`;

// One PNG of the silhouette with a transparent background (the demo "cutout"); also used by the library previews.
export function silhouetteStill(out) {
  const { person, ch } = shape();
  return ff(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080', '-frames:v', '1',
    '-vf', `format=rgba,geq=${rgb(ch)}:a='if(${person},255,0)'`, out]);
}

const MAKERS = {
  'inputs/_demo/speaker.mp4': (out) => {
    const { ch } = shape();
    const still = out.replace(/\.mp4$/, '.png');
    return ff(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080', '-frames:v', '1',
      '-vf', `format=rgb24,geq=${rgb(ch)}`, still]) &&
      ff(['-loop', '1', '-framerate', '30', '-i', still, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', String(DEMO_DURATION), '-vf', 'noise=alls=5:allf=t,format=yuv420p', '-c:v', 'libx264', '-crf', '26',
        '-c:a', 'aac', '-shortest', out]) && (fs.rmSync(still), true);
  },
  // the same silhouette as a transparent VP9 video: stands in for `npm run cutout` output in the speaker-cutout demo
  'inputs/_demo/speaker-cutout.webm': (out) => {
    const still = out.replace(/\.webm$/, '.png');
    return silhouetteStill(still) &&
      ff(['-loop', '1', '-framerate', '30', '-i', still, '-t', String(DEMO_DURATION), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0', '-an', out]) && (fs.rmSync(still), true);
  },
  // portrait speaker for the short-form demo (1080x1920, silent)
  'inputs/_demo/speaker-vertical.mp4': (out) => {
    const { ch } = shape(VERTICAL.head);
    const still = out.replace(/\.mp4$/, '.png');
    return ff(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920', '-frames:v', '1',
      '-vf', `format=rgb24,geq=${rgb(ch)}`, still]) &&
      ff(['-loop', '1', '-framerate', '30', '-i', still, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', String(DEMO_DURATION), '-vf', 'noise=alls=5:allf=t,format=yuv420p', '-c:v', 'libx264', '-crf', '26',
        '-c:a', 'aac', '-shortest', out]) && (fs.rmSync(still), true);
  },
  'inputs/_demo/screen.mp4': (out) => ff(['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${DEMO_DURATION}`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', out])
};

// Writes inputs/face-track.js + .json for the demo silhouette when they are missing. Never overwrites:
// once detect-face.py has written the track of your footage, that track stays. Returns true if it wrote.
export function ensureFaceTrack(variant) {
  const sfx = variant ? variant.suffix : '', box = variant ? variant.box : HEAD_BOX, frame = variant ? variant.frame : [1920, 1080];
  const json = path.join(ROOT, 'inputs/face-track' + sfx + '.json'), js = path.join(ROOT, 'inputs/face-track' + sfx + '.js');
  if (fs.existsSync(json) && fs.existsSync(js)) return false;
  const n = Math.ceil(DEMO_DURATION * FACE_FPS) + 1;   // covers 0 .. DEMO_DURATION
  const track = Array.from({ length: n }, (_, i) => ({ t: Math.round(i * 100 / FACE_FPS) / 100, ...box }));
  const data = { source: (variant ? '_demo/speaker-vertical.mp4' : '_demo/speaker.mp4') + ' (synthetic silhouette)', fps: FACE_FPS, frame, detected: n, total: n, track };
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(json, JSON.stringify(data, null, 1) + '\n');
  fs.writeFileSync(js, '/* demo face track for inputs/_demo/speaker.mp4 (generated by scripts/demo-media.mjs).\n' +
    '   scripts/detect-face.py replaces it with the track of your own footage. Git-ignored. */\n' +
    'window.__hfFace = ' + JSON.stringify(data) + ';\n');
  console.log('generated demo face track: inputs/face-track' + sfx + '.js');
  return true;
}

// Returns the list of sources it could not provide (not a demo file, or ffmpeg failed).
// `base` is the folder the page lives in (sources are relative to it); demo clips are always made under ROOT.
export function ensureDemoMedia(srcs, base = ROOT) {
  const missing = [];
  for (const src of srcs) {
    if (fs.existsSync(path.resolve(base, src))) continue;
    const make = MAKERS[src];
    if (make) {
      fs.mkdirSync(path.join(ROOT, 'inputs/_demo'), { recursive: true });
      const out = path.join(ROOT, src);
      if (fs.existsSync(out) || make(out)) { console.log('generated demo media: ' + src); continue; }
    }
    missing.push(src);
  }
  return missing;
}

export function mediaIn(html) {
  return [...html.matchAll(/<(?:video|audio)\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

// CLI: node scripts/demo-media.mjs [index.html ...]  ensures the face track and the media every given page references.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html'];
  ensureFaceTrack();
  const missing = pages.flatMap((p) => {
    const file = fs.existsSync(p) ? p : path.join(ROOT, p);
    return ensureDemoMedia(mediaIn(fs.readFileSync(file, 'utf8')), path.dirname(path.resolve(file)));
  });
  if (missing.length) {
    console.error('missing media -> ' + missing.join(', ') + '\nPut your files in inputs/ and point the <video> src at them.');
    process.exit(1);
  }
}
