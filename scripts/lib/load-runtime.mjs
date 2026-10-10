// Loads the browser runtime (camera data, face track, tpl-runtime) into Node so checks use the SAME geometry as the render.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// What every template loads itself; loaded after the page's own scripts if the page did not.
const BASE = ['components/glass-components.js', 'components/camera.js', 'components/canvas.js', 'inputs/face-track.js', 'components/tpl-runtime.js'];

// Local <script src> of a page, in order (CDN scripts such as gsap are skipped; checks never animate).
export function pageScripts(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    .filter((s) => !/^(?:[a-z]+:)?\/\//i.test(s) && !s.startsWith('data:'))
    .map((s) => s.replace(/^\.\//, ''));
}

// Resolve a script for a page: next to the page first (projects/screen-share/components is a synced copy),
// then the repo root (the canonical components/ + inputs/).
function resolveScript(src, pageDir) {
  for (const base of [pageDir, ROOT]) {
    const p = path.resolve(base, src);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// loadRuntime(pageFile?) runs the page's local scripts (components/, inputs/, its own share.js ...) and then
// the template runtime in one fake window. Returns the tpl API; T.mode is 'pip' for screen-share pages
// (templates keep off the webcam card) or 'face' (templates keep off the tracked head).
export function loadRuntime(pageFile = path.join(ROOT, 'index.html')) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  const pageDir = path.dirname(path.resolve(pageFile));
  const own = fs.existsSync(pageFile) ? pageScripts(fs.readFileSync(pageFile, 'utf8')) : [];
  const done = new Set();
  const hasOwnFace = own.some((o) => /face-track/.test(o));   // a vertical page loads face-track.vertical.js: do not overwrite it
  const order = [...own, ...BASE.filter((b) => !(hasOwnFace && /face-track/.test(b)))];
  // canvas.js must run before the runtime reads the canvas size
  order.sort((a, b) => (/canvas\.js$/.test(b) ? 1 : 0) - (/canvas\.js$/.test(a) ? 1 : 0));
  for (const src of order) {
    const key = src.replace(/\\/g, '/');
    if (done.has(key)) continue;
    done.add(key);
    const file = resolveScript(src, pageDir);
    if (!file) { if (BASE.includes(key)) throw new Error(`runtime script not found: ${src}`); continue; }
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.relative(ROOT, file) });
  }
  const T = ctx.__hfTpl;
  T.mode = ctx.__hfShare && ctx.__hfShareStage ? 'pip' : 'face';
  // Box the templates must keep clear of at time t: the PiP card at rest (screen share) or the head (camera applied).
  T.keepClearAt = (t) => T.mode === 'pip' ? T.faceUnion(t, 0) : T.faceAt(t);
  return T;
}

const unescapeAttr = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Declared defaults of a template: {id: default}
export function templateDefaults(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/data-composition-variables='([\s\S]*?)'\s*>/);
  if (!m) return {};
  const out = {};
  for (const d of JSON.parse(unescapeAttr(m[1]))) out[d.id] = d.default;
  return out;
}

// Hosts mounting compositions/tpl/*.html in a composition file.
// The tag regex is quote-aware: a '>' inside an attribute value (JSON variables, "4×" labels) does not end the tag.
const TAG = /<div\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const SRC = /\sdata-composition-src\s*=\s*(["'])(?:\.\/)?compositions\/tpl\/([\w-]+)\.html\1/;
export function templateHosts(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const hosts = [];
  for (const m of html.matchAll(TAG)) {
    const tag = m[0], src = tag.match(SRC);
    if (!src) continue;
    // value of attribute n, either quote style; (?:^|\s) so "id" never matches data-hf-id
    const attr = (n) => { const a = tag.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)); return a ? (a[1] ?? a[2]) : null; };
    const vv = attr('data-variable-values');
    const hostId = attr('id');
    hosts.push({
      template: src[2], id: hostId || attr('data-composition-id') || src[2], hostId,
      start: parseFloat(attr('data-start')), dur: parseFloat(attr('data-duration')),
      vars: vv ? JSON.parse(unescapeAttr(vv)) : {}
    });
  }
  return hosts;
}
