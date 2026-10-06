#!/usr/bin/env node
// Transcript -> cue plan. Reads what the speaker says and suggests the edit: which template, zoom, callout,
// camera move or redaction goes where, and why. Rules live in scripts/cue-rules.mjs.
//
//   node scripts/cue-plan.mjs <transcript.srt|.vtt> [--mode screen|talking] [--json plan.json] [--all]
//
//   --mode screen   screen-share video: prints a draft for projects/screen-share/share.js (+ template hosts)
//   --mode talking  talking-head video (default): prints template host <div>s + camera moves for index.html
//   --json          also write the full machine-readable plan (kept + skipped suggestions)
//   --all           also list the ideas that were thinned out
//
// It is a DRAFT for an editor, not a finished edit: screen coordinates are TODO, labels are guesses from the words.
// Density rules keep the video clean: max one new graphic per 3 s, the same template never twice within 4 s,
// the higher-priority idea wins a clash. PRIVACY flags are never dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, normalizeQuotes } from './cue-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPHIC_GAP = 3;     // s between two new graphics
const SAME_GAP = 4;        // s between two of the same suggestion
const SCREEN_GAP = 2;      // s between two screen moves (zoom / callout / focus)
const CAMERA_GAP = 3;      // s between two camera moves
const PERSISTENT = new Set(['chapter-pill']);   // mounted once for the whole video; does not count as a new graphic
const Z = { 'title-card': 70, transition: 80, 'kinetic-subtitle': 75, 'chapter-pill': 60, 'lower-third': 55, 'link-chip': 50, keys: 50, 'fast-forward': 50 };

function fail(msg) { console.error('cue-plan: ' + msg); process.exit(1); }

// ---------- args ----------
const args = process.argv.slice(2);
const opt = { file: null, mode: 'talking', json: null, all: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mode') opt.mode = args[++i];
  else if (a === '--json') opt.json = args[++i];
  else if (a === '--all') opt.all = true;
  else if (a === '-h' || a === '--help') { console.log('usage: node scripts/cue-plan.mjs <transcript.srt|.vtt> [--mode screen|talking] [--json out.json] [--all]'); process.exit(0); }
  else if (a.startsWith('--')) fail('unknown option ' + a);
  else opt.file = a;
}
if (!opt.file) fail('usage: node scripts/cue-plan.mjs <transcript.srt|.vtt> [--mode screen|talking] [--json out.json]');
if (!['screen', 'talking'].includes(opt.mode)) fail('--mode must be "screen" or "talking"');
if (!fs.existsSync(opt.file)) fail('file not found: ' + opt.file);

// ---------- SRT / VTT parser ----------
// Handles: BOM, CRLF, SRT (00:00:01,000) and VTT (00:01.000 / 00:00:01.000) times, cue settings, multi-line cues,
// VTT header / NOTE / STYLE / REGION blocks, <v Speaker> and <b> tags, {\an8} SSA tags.
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const secs = (m) => (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;

export function parseTranscript(raw) {
  const blocks = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;                                     // WEBVTT header, NOTE, STYLE, stray numbers
    const [l, r] = lines[k].split('-->');
    const a = l.match(TIME), z = r && r.match(TIME);
    if (!a || !z) continue;
    const text = normalizeQuotes(lines.slice(k + 1).join(' ')).replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start: secs(a), end: secs(z), text });
  }
  return cues.sort((x, y) => x.start - y.start).map((c, i) => ({ ...c, index: i }));
}

// ---------- template variables (read from compositions/tpl/<id>.html, so drafts only use real vars) ----------
const tplCache = {};
function tplVars(id) {
  if (id in tplCache) return tplCache[id];
  const f = path.join(ROOT, 'compositions/tpl', id + '.html');
  let ids = null;
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/data-composition-variables='(\[[\s\S]*?\])'/);
    try { ids = m ? new Set(JSON.parse(m[1]).map((v) => v.id)) : new Set(); } catch { ids = new Set(); }
  }
  return (tplCache[id] = ids);
}

// ---------- match ----------
const r1 = (v) => Math.round(v * 10) / 10;

function candidates(cues) {
  const total = cues.length ? cues[cues.length - 1].end : 0, out = [];
  for (const cue of cues) {
    const ctx = { total, index: cue.index, count: cues.length };
    for (const rule of RULES) {
      if (rule.modes && !rule.modes.includes(opt.mode)) continue;
      if (rule.when && !rule.when(cue, ctx)) continue;
      const re = new RegExp(rule.match.source, rule.match.flags.replace('g', ''));
      const m = re.exec(cue.text);
      if (!m) continue;
      // land on the spoken word: interpolate its position inside the cue
      const word = cue.start + (cue.end - cue.start) * Math.min(0.9, m.index / Math.max(1, cue.text.length));
      const lead = rule.kind === 'screen' ? 0.3 : rule.kind === 'camera' ? 0.1 : 0.15;
      let vars = {};
      try { vars = rule.vars ? rule.vars(cue, m) : {}; } catch (e) { vars = { error: String(e.message) }; }
      out.push({ t: r1(Math.max(0, word - lead)), cue, rule, match: m[0], vars });
    }
  }
  return { total, list: out };
}

// ---------- thin out: priority first, then density ----------
function select(list) {
  const kept = [], skipped = [];
  const sorted = list.slice().sort((a, b) => (b.rule.priority - a.rule.priority) || (a.t - b.t));
  const near = (c, pred, gap) => kept.find((k) => pred(k) && Math.abs(k.t - c.t) < gap);
  const graphic = (c) => (c.rule.kind === 'template' || c.rule.kind === 'transition') && !PERSISTENT.has(c.rule.suggest);
  for (const c of sorted) {
    let why = null, k;
    if (c.rule.privacy) {
      if ((k = near(c, (x) => x.rule.privacy && x.cue === c.cue, 99))) why = 'same line already flagged';
    } else if ((k = near(c, (x) => x.rule.suggest === c.rule.suggest, SAME_GAP))) why = `${c.rule.suggest} already at ${k.t}s`;
    else if (graphic(c) && (k = near(c, graphic, GRAPHIC_GAP))) why = `${k.rule.suggest} already on screen at ${k.t}s`;
    else if (c.rule.kind === 'screen' && (k = near(c, (x) => x.rule.kind === 'screen' && !x.rule.privacy, SCREEN_GAP))) why = `${k.rule.suggest} at ${k.t}s`;
    else if (c.rule.kind === 'camera' && (k = near(c, (x) => x.rule.kind === 'camera', CAMERA_GAP))) why = `${k.rule.suggest} at ${k.t}s`;
    if (why) skipped.push({ ...c, skipped: why }); else kept.push(c);
  }
  const byT = (a, b) => a.t - b.t || b.rule.priority - a.rule.priority;
  return { kept: kept.sort(byT), skipped: skipped.sort(byT) };
}

// ---------- enrich: durations, list items from the words, chapter schedule ----------
function listItems(text) {
  const after = text.includes(':') ? text.slice(text.indexOf(':') + 1) : '';
  return after.split(/,\s*(?:and\s+)?|\s+and\s+/i).map((s) => s.replace(/[.!?]+$/, '').trim()).filter((s) => s && s.split(' ').length <= 6)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

function enrich(kept, total) {
  const steps = kept.filter((c) => c.rule.suggest === 'chapter-pill');
  const graphics = kept.filter((c) => (c.rule.kind === 'template' || c.rule.kind === 'transition') && !PERSISTENT.has(c.rule.suggest));
  graphics.forEach((c, i) => {
    const next = graphics[i + 1];
    let dur = Math.min(4, Math.max(2.4, c.cue.end - c.t + 0.6));
    if (c.rule.id === 'intro-title') dur = 3;
    if (c.rule.suggest === 'app-window') dur = 4;          // a window needs time to be read
    if (c.rule.id === 'outro-title') dur = Math.max(2.4, total - c.t);
    if (c.rule.kind === 'transition') {
      dur = 1.8;
      const step = steps.find((s) => Math.abs(s.t - c.t) < 3);   // name the chapter after the step it opens
      if (step) Object.assign(c.vars, { eyebrow: 'Step ' + String(steps.indexOf(step) + 1).padStart(2, '0'), title: step.vars.label });
    }
    if (next) dur = Math.min(dur, Math.max(2, next.t - c.t - 0.15));
    c.dur = r1(dur);
    if (c.rule.suggest === 'checklist') {
      const items = listItems(c.cue.text);
      c.vars.items = items.length >= 2 ? items : steps.map((s) => s.vars.label);
    }
  });
  kept.filter((c) => !c.dur).forEach((c) => { c.dur = r1(Math.max(1.5, Math.min(4, c.cue.end - c.t + 0.4))); });
  return steps;
}

// ---------- print ----------
const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
function excerpt(c) {
  const t = c.cue.text, i = t.indexOf(c.match), from = Math.max(0, i - 14);
  return (from > 0 ? '…' : '') + t.slice(from, from + 40) + (from + 40 < t.length ? '…' : '');
}
function label(c) {
  const v = c.vars, s = c.rule.suggest;
  const extra = v.label || v.title || (v.keys && v.keys.join(' ')) || (v.what && s !== 'zoom' ? v.what : '') ||
    (v.to != null ? `${v.prefix || ''}${v.to}${v.suffix || ''}` : '') || (v.mode || '');
  return (c.rule.privacy ? '!! REDACT ' : '') + s + (extra && !c.rule.privacy ? '  ' + extra : extra ? ' (' + extra + ')' : '');
}

function table(rows) {
  console.log(`  ${'TIME'.padEnd(8)}${'LINE'.padEnd(44)}${'SUGGESTION'.padEnd(34)}WHY`);
  console.log('  ' + '-'.repeat(120));
  for (const c of rows) console.log(`  ${mmss(c.t).padEnd(8)}${pad(excerpt(c), 43)} ${pad(label(c), 33)} ${c.skipped ? '(skipped: ' + c.skipped + ')' : c.rule.why}`);
}

// template host <div>, vars filtered to the template's real variables
const counters = {};
function hostDiv(c, extra = {}) {
  const id = c.rule.suggest, known = tplVars(id), n = (counters[id] = (counters[id] ?? -1) + 1);
  const raw = { at: c.t, dur: c.dur, ...c.vars, ...extra };
  delete raw.what; delete raw.error;
  const vars = {}, unknown = [];
  for (const [k, v] of Object.entries(raw)) {
    if (known && !known.has(k)) { if (k !== 'safe') unknown.push(k); } else vars[k] = v;
  }
  const note = !known ? `  <!-- TODO: compositions/tpl/${id}.html not found yet; check its variable names -->`
    : unknown.length ? `  <!-- dropped vars this template does not have: ${unknown.join(', ')} -->` : '';
  return `<div id="${id}-${n}" class="clip subcomp-host" style="z-index: ${Z[id] || 40};" data-composition-id="${id}-${n}" ` +
    `data-composition-src="compositions/tpl/${id}.html" data-start="${c.t}" data-duration="${c.dur}" ` +
    `data-variable-values='${JSON.stringify(vars).replace(/'/g, '&#39;')}'></div>${note}`;
}

function chapterPill(steps, total) {
  if (!steps.length) return null;
  const n = steps.length, ids = steps.map((_, i) => String(i + 1).padStart(2, '0')).concat('✓');
  const schedule = steps.map((s, i) => ({ t: s.t, step: i + 1, label: `Step ${ids[i]}: ${s.vars.label}` }));
  return hostDiv({ t: 0, dur: r1(total), rule: { suggest: 'chapter-pill' }, vars: {} },
    { label: 'TODO video title', steps: ids, initialLabel: `${n} Steps`, schedule });
}

function subtitles(cues, total) {
  // kinetic-subtitle cues straight from the transcript; numbers get the *punch* highlight
  // long lines are split into ~6-word capsules, timed by their share of the characters
  const list = [];
  for (const c of cues) {
    const words = c.text.split(' '), n = Math.max(1, Math.round(words.length / 6)), per = Math.ceil(words.length / n);
    let at = c.start;
    for (let i = 0; i < words.length; i += per) {
      const text = words.slice(i, i + per).join(' '), end = i + per >= words.length ? c.end : at + (c.end - c.start) * (text.length + 1) / (c.text.length + 1);
      list.push({ start: r1(at), end: r1(end), text: text.replace(/(\$?\d[\d,.]*\d%?|\$?\d%?)/, '*$1*') });
      at = end;
    }
  }
  return hostDiv({ t: 0, dur: r1(total), rule: { suggest: 'kinetic-subtitle' }, vars: {} }, { cues: list });
}

const js = (o) => JSON.stringify(o).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+: )/g, ', ').replace(/"/g, "'");

function screenDraft(kept, steps, total, cues) {
  const by = (s) => kept.filter((c) => c.rule.suggest === s);
  const screenMoves = kept.filter((c) => c.rule.kind === 'screen' && !c.rule.privacy && c.rule.suggest !== 'focus');
  const zooms = [];
  screenMoves.forEach((c, i) => {
    const next = screenMoves[i + 1], nextT = next ? next.t : total;
    const z = c.vars.z || 1.7, out = Math.min(c.cue.end + 0.6, nextT - 0.8);
    zooms.push(`    { t: ${c.t}, x: 0.50, y: 0.50, z: ${z} },   // TODO x,y of "${c.match.slice(0, 32)}"`);
    if (out - c.t >= 1.2) zooms.push(`    { t: ${r1(out)}, z: 1 },`);
  });
  // a chapter transition always resets to the overview first
  by('transition').forEach((c) => zooms.push(`    { t: ${r1(Math.max(0, c.t - 0.2))}, z: 1 },   // chapter change`));
  zooms.sort((a, b) => parseFloat(a.match(/t: ([\d.]+)/)[1]) - parseFloat(b.match(/t: ([\d.]+)/)[1]));

  const cam = [`    { t: 0, mode: 'full' },`];
  const firstScreen = kept.find((c) => (c.rule.kind === 'screen' && !c.rule.privacy) || c.rule.suggest === 'cam-pip');
  let pipAt = firstScreen ? r1(Math.max(0.5, firstScreen.t - 0.5)) : 3;
  cam.push(`    { t: ${pipAt}, mode: 'pip' },`);
  kept.filter((c) => c.rule.kind === 'camera' && c.t > pipAt + 1).forEach((c) => {
    if (c.rule.suggest === 'cam-full') {
      if (cam[cam.length - 1].includes("'full'")) return;   // already full
      cam.push(`    { t: ${c.t}, mode: 'full' },   // ${c.rule.id === 'outro-cam' ? 'sign-off' : '"' + c.match + '"'}`);
      if (c.rule.id !== 'outro-cam') cam.push(`    { t: ${r1(Math.min(total, c.cue.end + 0.3))}, mode: 'pip' },`);
    } else if (c.rule.suggest === 'cam-pip' && !cam[cam.length - 1].includes("'pip'")) cam.push(`    { t: ${c.t}, mode: 'pip' },`);
  });

  const box = (c, extra) => `    { t: ${c.t}, end: ${r1(c.t + c.dur)}, x: 0.40, y: 0.40, w: 0.20, h: 0.10${extra} },   // TODO region`;
  const lines = [
    '// Draft for projects/screen-share/share.js  (from ' + opt.file + ')',
    '// Fill in every TODO: open the screen recording, pause at the time and read x/y as a fraction of the width/height.',
    'window.__hfShare = {',
    `  duration: ${r1(total)},                    // or the new length printed by auto-trim`,
    '  aspect: 1.825,',
    '  window: { r: 18 },',
    '  zooms: [', ...zooms, '  ],',
    '  drift: true,',
    '  pip: { focus: { x: 0.5, y: 0.4 } },',
    '  cam: [', ...cam, '  ],',
    '  cuts: [],                         // paste `cuts` from scripts/auto-trim.mjs',
    '  callouts: [', ...by('callout').map((c) => box(c, `, label: ${JSON.stringify(c.vars.label).replace(/"/g, "'")}, side: 'bottom'`)), '  ],',
    '  focus: [', ...by('focus').map((c) => box(c, '')), '  ],',
    '  redact: [', ...by('redact').map((c) => `    { x: 0.40, y: 0.40, w: 0.25, h: 0.06, style: 'blur' },   // PRIVACY ${c.t}s "${c.match}": TODO region; no t/end = whole video (safest)`), '  ]',
    '};'
  ];
  console.log('\n' + lines.join('\n'));
  const tpls = kept.filter((c) => (c.rule.kind === 'template' || c.rule.kind === 'transition') && !PERSISTENT.has(c.rule.suggest));
  console.log('\n<!-- Template hosts for projects/screen-share/index.html (inside #root, after #pip). safe:false: no face to avoid on a screen. -->');
  const pill = chapterPill(steps, total);
  if (pill) console.log(pill);
  tpls.forEach((c) => console.log(hostDiv(c, { safe: false })));
  console.log(subtitles(cues, total));
}

function talkingDraft(kept, steps, total, cues) {
  console.log('\n<!-- Template hosts for index.html (inside #root). at/dur come from the transcript; edit the TODO text. -->');
  const pill = chapterPill(steps, total);
  if (pill) console.log(pill);
  kept.filter((c) => (c.rule.kind === 'template' || c.rule.kind === 'transition') && !PERSISTENT.has(c.rule.suggest))
    .forEach((c) => console.log(hostDiv(c)));
  console.log(subtitles(cues, total));

  const moves = [];
  const isFull = () => moves.length && /win: 'full'.*scale: 1\.[1-9]/.test(moves[moves.length - 1]);
  // every app window gets the speaker PiP beside it (and back to full frame after)
  const apps = kept.filter((c) => c.rule.suggest === 'app-window');
  const events = kept.filter((c) => c.rule.kind === 'camera').concat(apps).sort((a, b) => a.t - b.t);
  events.forEach((c) => {
    const s = c.rule.suggest, back = r1(Math.min(total, c.cue.end + 0.2));
    if (s === 'app-window') {
      moves.push(`    { t: ${c.t}, dur: 0.8, win: { x: 72, y: 696, w: 451, h: 254, r: 36 }, fit: 'frame', front: true },   // to-pip: speaker beside the app window`,
        `    { t: ${r1(c.t + c.dur)}, dur: 0.8, win: 'full', x: 0, y: 0, scale: 1.0, front: false },`);
    } else if (s === 'punch-in') {
      if (apps.some((a) => c.t >= a.t - 0.5 && c.t <= a.t + a.dur + 0.5)) return;   // no punch-in while the speaker is a PiP
      moves.push(`    { t: ${c.t}, dur: 0.6, scale: ${c.vars.scale || 1.18} },   // "${c.match.trim()}"`, `    { t: ${back}, dur: 0.8, scale: 1.0 },`);
    } else if (s === 'cam-full' && !isFull()) {
      moves.push(`    { t: ${c.t}, dur: 0.8, win: 'full', x: 0, y: 0, scale: ${c.vars.scale || 1.2}, front: false },   // wrap-up punch-in`);
    }
  });
  if (moves.length) console.log('\n// components/camera.js: merge into window.__hfCamera.moves (keep them sorted by t)\n  moves: [\n' + moves.join('\n') + '\n  ]');
}

// ---------- main ----------
const cues = parseTranscript(fs.readFileSync(opt.file, 'utf8'));
if (!cues.length) fail('no cues found in ' + opt.file + ' (expected SRT or WebVTT with "00:00:01,000 --> 00:00:02,000" lines)');
const { total, list } = candidates(cues);
const { kept, skipped } = select(list);
const steps = enrich(kept, total);
const privacy = kept.filter((c) => c.rule.privacy);

console.log(`\ncue plan: ${opt.file}  (${cues.length} lines, ${mmss(total)}, mode: ${opt.mode})`);
console.log(`${kept.length} suggestions from ${list.length} rule matches` + (privacy.length ? `, ${privacy.length} PRIVACY flag${privacy.length > 1 ? 's' : ''}` : '') + '\n');
table(kept);
if (skipped.length) console.log(`\n  ${skipped.length} weaker or repeated ideas thinned out (max one graphic / 3 s, no repeat within 4 s).` + (opt.all ? '' : ' --all lists them.'));
if (opt.all && skipped.length) { console.log(''); table(skipped); }
if (privacy.length) console.log('\n  !! PRIVACY: ' + privacy.map((c) => `${mmss(c.t)} "${c.match}"`).join(', ') + '. Review those frames and add redact regions before export.');

if (opt.mode === 'screen') screenDraft(kept, steps, total, cues); else talkingDraft(kept, steps, total, cues);

if (opt.json) {
  const row = (c) => ({ t: c.t, dur: c.dur, end: c.dur != null ? r1(c.t + c.dur) : undefined, rule: c.rule.id, suggest: c.rule.suggest, kind: c.rule.kind,
    priority: c.rule.priority, privacy: !!c.rule.privacy, why: c.rule.why, line: c.cue.text, cueStart: c.cue.start, cueEnd: c.cue.end,
    match: c.match, vars: c.vars, skipped: c.skipped });
  fs.writeFileSync(opt.json, JSON.stringify({ source: opt.file, mode: opt.mode, duration: total, cues,
    plan: kept.map(row), skipped: skipped.map(row) }, null, 2) + '\n');
  console.log('\nwrote ' + opt.json);
}
