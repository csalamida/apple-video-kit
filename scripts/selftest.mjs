#!/usr/bin/env node
// Self-test for the placement guards: each guard must PASS a good case and FAIL a deliberately bad one, otherwise it is decoration.
//   node scripts/selftest.mjs        (part of npm run check:all)
// 1. keep-clear regions (share.js `keepClear`): a card with safe:true must move off the region; the same card with safe:false must fail the check.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './demo-media.mjs';

const dir = path.join(ROOT, 'projects/_selftest');
const run = (args) => spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
let bad = 0;
const expect = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  ' + detail}`); if (!cond) bad++; };
try {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['index.html', 'share.js', 'meta.json', 'hyperframes.json']) fs.copyFileSync(path.join(ROOT, 'projects/screen-share', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'share.js'), fs.readFileSync(path.join(dir, 'share.js'), 'utf8').replace('  redact:', "  keepClear: [{ t: 4, end: 9.5, x: 0.70, y: 0.20, w: 0.25, h: 0.30 }],\n  redact:"));
  const host = (id, safe) => `\n      <div id="${id}-host" class="clip subcomp-host" style="z-index: 60;" data-composition-id="${id}" data-composition-src="compositions/tpl/checklist.html" data-start="5" data-duration="4" data-variable-values='{"at": 5, "dur": 4, "safe": ${safe}, "side": "right", "top": 200}'></div>`;
  fs.writeFileSync(path.join(dir, 'index.html'), fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('</div>\n    <script>', host('cl-safe', true) + host('cl-unsafe', false) + '\n    </div>\n    <script>'));
  const s = run(['scripts/sync-share.mjs', 'projects/_selftest']);
  expect('selftest project syncs', s.status === 0, s.stderr);
  const c = run(['scripts/check-face-clear.mjs', 'projects/_selftest/index.html']);
  const out = c.stdout + c.stderr;
  const row = (id) => out.split('\n').find((l) => l.startsWith(id)) || '';
  expect('keep-clear: a safe card is moved off the region', /cl-safe-host\s+checklist\s+ok\s+left/.test(row('cl-safe-host')), row('cl-safe-host'));
  expect('keep-clear: an unsafe card over the region FAILS', /cl-unsafe-host\s+checklist\s+FAIL.*keep-clear region/.test(row('cl-unsafe-host')), row('cl-unsafe-host'));
  expect('keep-clear: the check exits 1 when a card covers a region', c.status === 1, 'exit ' + c.status);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(bad ? `\n✗ ${bad} guard self-test(s) failed` : '\n✓ every guard fails a bad case and passes a good one');
process.exit(bad ? 1 : 0);
