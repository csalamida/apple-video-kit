// Synthetic demo media, generated on first run so the repo ships no footage of a real person.
//   inputs/_demo/speaker.mp4  faceless silhouette + silent audio (talking-head demo, webcam card)
//   inputs/_demo/screen.mp4   test pattern (screen-share demo)
// Both are git-ignored. Needs ffmpeg on PATH. Replace them with your own files in inputs/ when you make a real video.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const DEMO_DURATION = 21.92;

// Silhouette geometry. inputs/face-track.js (the committed demo track) uses the same head box.
const HEAD = { cx: 965, cy: 430, rx: 190, ry: 240 };

const ff = (args) => spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }).status === 0;

const MAKERS = {
  'inputs/_demo/speaker.mp4': (out) => {
    const head = `lt(pow((X-${HEAD.cx})/${HEAD.rx},2)+pow((Y-${HEAD.cy})/${HEAD.ry},2),1)`;
    const body = `lt(pow((X-${HEAD.cx})/560,2)+pow((Y-1160)/380,2),1)`;
    const neck = `lt(abs(X-${HEAD.cx}),85)*gt(Y,600)*lt(Y,860)`;
    const person = `gt(${head}+${body}+${neck},0)`;
    const glow = `exp(-(pow(X-${HEAD.cx},2)+pow(Y-420,2))/500000)`;
    const ch = (bg, fg) => `if(${person},${fg}-0.03*(Y-300),${bg[0]}+${bg[1]}*${glow})`;
    const still = out.replace(/\.mp4$/, '.png');
    return ff(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080', '-frames:v', '1',
      '-vf', `format=rgb24,geq=r='${ch([14, 30], 64)}':g='${ch([18, 34], 68)}':b='${ch([26, 48], 80)}'`, still]) &&
      ff(['-loop', '1', '-framerate', '30', '-i', still, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', String(DEMO_DURATION), '-vf', 'noise=alls=5:allf=t,format=yuv420p', '-c:v', 'libx264', '-crf', '26',
        '-c:a', 'aac', '-shortest', out]) && (fs.rmSync(still), true);
  },
  'inputs/_demo/screen.mp4': (out) => ff(['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${DEMO_DURATION}`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', out])
};

// Returns the list of sources it could not provide (not a demo file, or ffmpeg failed).
export function ensureDemoMedia(srcs, base = '.') {
  const missing = [];
  for (const src of srcs) {
    if (fs.existsSync(`${base}/${src}`)) continue;
    const make = MAKERS[src];
    fs.mkdirSync('inputs/_demo', { recursive: true });
    if (make && make(src)) { console.log('generated demo media: ' + src); continue; }
    missing.push(src);
  }
  return missing;
}

export function mediaIn(html) {
  return [...html.matchAll(/<(?:video|audio)\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

// CLI: node scripts/demo-media.mjs [index.html ...]  ensures the media every given page references.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html'];
  const missing = pages.flatMap((p) => ensureDemoMedia(mediaIn(fs.readFileSync(p, 'utf8'))));
  if (missing.length) {
    console.error('missing media -> ' + missing.join(', ') + '\nPut your files in inputs/ and point the <video> src at them.');
    process.exit(1);
  }
}
