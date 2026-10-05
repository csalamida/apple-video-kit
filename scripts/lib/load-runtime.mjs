// Loads the browser runtime (camera data, face track, tpl-runtime) into Node so checks use the SAME geometry as the render.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

export function loadRuntime(root = process.cwd()) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['components/glass-components.js', 'components/camera.js', 'inputs/face-track.js', 'components/tpl-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.__hfTpl;
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
export function templateHosts(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const hosts = [];
  for (const m of html.matchAll(/<div\b[^>]*data-composition-src="compositions\/tpl\/([\w-]+)\.html"[^>]*>/g)) {
    const tag = m[0];
    const attr = (n) => { const a = tag.match(new RegExp(n + `="([^"]*)"`)); return a ? a[1] : null; };
    const vv = tag.match(/data-variable-values='([^']*)'/);
    hosts.push({
      template: m[1], id: attr('id'), start: parseFloat(attr('data-start')), dur: parseFloat(attr('data-duration')),
      vars: vv ? JSON.parse(unescapeAttr(vv[1])) : {}
    });
  }
  return hosts;
}
