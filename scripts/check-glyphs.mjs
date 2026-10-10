#!/usr/bin/env node
// Glyph-clipping preflight for captions. Renders every caption cue in a real browser at the moments letters are most at risk
// (just after entry, mid-entry at peak rotation and scale, the readable hold, the start of the exit), then renders the SAME
// moment again with every clip, overflow and mask switched off. If the two pictures differ, something was cutting letters.
//
//   node scripts/check-glyphs.mjs [projects/short-form/index.html] [--words "good,Believe,video"] [--font-css file.css] [--keep]
//
//   Tests the cues of every kinetic-subtitle host on the page, plus extra regression words with descenders (g j p q y),
//   italic-looking shapes and long words. Needs the project synced (npm run short:check does it), Chrome (the one
//   HyperFrames uses: `npx hyperframes browser ensure`) and a connection once (GSAP loads from cdnjs).
//   --font-css  a stylesheet with @font-face rules for the web font your render loads, so the test uses that font
//   --keep      write the first failing frame pair to inputs/glyph-fail-*.png
// What it proves: no overflow / clip-path / mask in the caption's own chain removes ink. What it does not prove: that a
// gradient fill (background-clip: text) keeps its descenders (the paint box is not removable), or that the font you
// render with is the font it tested: it prints the font that was used. Look at the encoded frames either way.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { templateHosts, templateDefaults, ROOT } from './lib/load-runtime.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const valueIdx = new Set(['--words', '--font-css'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const arg = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i)) || 'projects/short-form/index.html';
const KEEP = args.includes('--keep');
const WORDS = (flag('--words') || 'good,Believe,video,typography,gypsy quickly').split(',').map((s) => s.trim()).filter(Boolean);
const fontCss = flag('--font-css') ? fs.readFileSync(path.resolve(flag('--font-css')), 'utf8') : '';
const fail = (m) => { console.error('glyphs: ' + m); process.exit(1); };

const file = fs.existsSync(arg) ? path.resolve(arg) : path.join(ROOT, arg);
if (!fs.existsSync(file)) fail('file not found: ' + arg);
const dir = path.dirname(file);
const tpl = path.join(dir, 'compositions/tpl/kinetic-subtitle.html');
if (!fs.existsSync(tpl)) fail(`${path.relative(ROOT, dir)} has no compositions/tpl/kinetic-subtitle.html: sync the project first (npm run short:check)`);

// ---- the hosts to test
const hosts = templateHosts(file).filter((h) => h.template === 'kinetic-subtitle');
if (!hosts.length) fail('no kinetic-subtitle host on this page');
const defs = templateDefaults(path.join(ROOT, 'compositions/tpl/kinetic-subtitle.html'));
const canvas = /data-width="(\d+)" data-height="(\d+)"/.exec(fs.readFileSync(file, 'utf8')) || [0, 1920, 1080];
const W = +canvas[1], H = +canvas[2];

// ---- Chrome
function chrome() {
  if (process.env.HYPERFRAMES_CHROME && fs.existsSync(process.env.HYPERFRAMES_CHROME)) return process.env.HYPERFRAMES_CHROME;
  const bin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');
  const r = spawnSync(bin, ['browser', 'path'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const p = (r.stdout || '').split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).pop();
  if (p && fs.existsSync(p)) return p;
  fail('no Chrome found. Run:  npx hyperframes browser ensure');
}
let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch { fail('puppeteer-core is missing: run npm install'); }

// ---- static server for the project folder (templates load components/ and inputs/ relative to it)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  // HyperFrames resolves a template's relative paths from the project root, a browser from the template's own folder: serve both
  let url = decodeURIComponent(req.url.split('?')[0]);
  let p = path.join(dir, url);
  if (!fs.existsSync(p) && url.startsWith('/compositions/tpl/')) p = path.join(dir, url.slice('/compositions/tpl/'.length));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const OFF = '*{overflow:visible!important;clip-path:none!important;-webkit-mask:none!important;mask:none!important;contain:none!important}';
const browser = await puppeteer.launch({ executablePath: chrome(), headless: true, protocolTimeout: 40000, args: ['--no-sandbox', '--font-render-hinting=none'] });
let problems = 0, tested = 0, fontUsed = '';
try {
  for (const h of hosts) {
    const vars = { ...defs, ...h.vars, at: h.start, dur: h.dur, safe: false };
    let cues = (typeof vars.cues === 'string' ? JSON.parse(vars.cues) : vars.cues) || [];
    // regression words: each as its own cue after the last real one, long enough to show every state
    let t = (cues.length ? Math.max(...cues.map((c) => c.end)) : h.start) + 0.5;
    const extra = WORDS.map((w) => { const c = { start: t, end: t + 2.4, text: `*${w}* ${w}`, extra: true }; t += 2.6; return c; });
    cues = [...cues, ...extra];
    vars.cues = JSON.stringify(cues); vars.dur = Math.max(vars.dur, t - h.start + 1);

    const page = await browser.newPage();
    const logs = [];
    page.on('pageerror', (e) => logs.push(e.message)); page.on('requestfailed', (r) => logs.push('request failed: ' + r.url()));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument((v) => { window.__hyperframes = { getVariables: () => v }; }, vars);
    await page.goto(`http://127.0.0.1:${port}/compositions/tpl/kinetic-subtitle.html`, { waitUntil: 'networkidle0', timeout: 60000 }).catch((e) => fail('could not load the template (GSAP is fetched from cdnjs: are you online?): ' + e.message));
    if (fontCss) await page.addStyleTag({ content: fontCss });
    await page.addStyleTag({ content: 'html,body{background:#555!important}' });
    await Promise.race([page.evaluate(() => document.fonts.ready), new Promise((r) => setTimeout(r, 8000))]);   // a web font that never answers must not hang the check
    const ok = await page.evaluate(() => !!(window.__timelines && window.__timelines['kinetic-subtitle']));
    if (!ok) fail('the caption timeline did not build. ' + (logs.slice(0, 3).join(' | ') || 'No error was reported.'));
    fontUsed = await page.evaluate(() => { const c = document.querySelector('.cue'); return c ? getComputedStyle(c).fontFamily.split(',')[0].replace(/["']/g, '') + ' ' + getComputedStyle(c).fontWeight : ''; });

    for (const [i, c] of cues.entries()) {
      const s = c.start - vars.at, e = c.end - vars.at;
      const samples = [['entry', s + 0.06], ['mid-entry', s + 0.14], ['peak', s + 0.3], ['hold', e - 0.4], ['exit', e - 0.08]];
      for (const [label, tt] of samples) {
        await page.evaluate((x) => { window.__timelines['kinetic-subtitle'].time(x); }, tt);   // braces: a GSAP timeline is thenable, returning it would hang evaluate
        const box = await page.evaluate(() => { const d = document.getElementById('dock').getBoundingClientRect(); return { x: d.x, y: d.y, w: d.width, h: d.height }; });
        if (!box.w || !box.h) continue;
        const clip = { x: Math.max(0, box.x - 120), y: Math.max(0, box.y - 120), width: Math.min(W, box.w + 240), height: Math.min(H, box.h + 240) };
        clip.width = Math.min(clip.width, W - clip.x); clip.height = Math.min(clip.height, H - clip.y);
        const a = await page.screenshot({ clip, encoding: 'base64' });
        const style = await page.addStyleTag({ content: OFF });
        const b = await page.screenshot({ clip, encoding: 'base64' });
        await page.evaluate((el) => el.remove(), style);
        const diff = await page.evaluate(async (A, B) => {
          const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d; });
          const [ia, ib] = await Promise.all([load(A), load(B)]);
          const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(ia, 0, 0); const da = cx.getImageData(0, 0, cv.width, cv.height).data;
          cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(ib, 0, 0); const db = cx.getImageData(0, 0, cv.width, cv.height).data;
          let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let p = 0; p < da.length; p += 4) {
            if (Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2])) > 24) {
              n++; const q = p / 4, x = q % cv.width, y = (q / cv.width) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            }
          }
          return { n, box: n ? [x0, y0, x1, y1] : null };
        }, a, b);
        tested++;
        if (diff.n > 12) {
          problems++;
          console.error(`  FAIL  "${String(c.text).replace(/\*/g, '')}"${c.extra ? ' (regression word)' : ` (cue ${i + 1})`} at ${label} (${(tt + vars.at).toFixed(2)}s): ${diff.n} px of lettering are cut off by a clip, overflow or mask`);
          if (KEEP && problems === 1) {
            fs.mkdirSync(path.join(ROOT, 'inputs'), { recursive: true });
            fs.writeFileSync(path.join(ROOT, 'inputs/glyph-fail-clipped.png'), Buffer.from(a, 'base64'));
            fs.writeFileSync(path.join(ROOT, 'inputs/glyph-fail-unclipped.png'), Buffer.from(b, 'base64'));
          }
        }
      }
    }
    await page.close();
  }
} finally { await browser.close(); server.close(); }

console.log(`${path.relative(ROOT, file).replace(/\\/g, '/')}  font: ${fontUsed || 'unknown'}  ${tested} moments tested (${hosts.length} caption host${hosts.length > 1 ? 's' : ''}, regression words: ${WORDS.join(', ')})`);
if (/^(system-ui|-apple-system|BlinkMacSystemFont|sans-serif)\b/i.test(fontUsed)) console.log('  note  the page uses the system font here; if your render loads a web font, pass --font-css so that font is tested');
console.log('  note  gradient fills (background-clip: text) are not covered; look at the encoded frames of the longest, most descender-heavy cues');
console.log(problems ? `\n✗ ${problems} clipped moment(s)` : '\n✓ no lettering is clipped at any tested moment');
process.exit(problems ? 1 : 0);
