#!/usr/bin/env node
// Script -> beat sheet. Plan a reel BEFORE you film it: how long it will run, whether the hook lands in 3 seconds,
// where nothing changes for too long, whether it ends on an ask, and which block fits each line.
//
//   node scripts/script-beats.mjs <script.txt|.md> [--wps 2.6] [--max 60] [--mode talking|screen] [--out <prefix>]
//
//   --wps   speaking speed in words per second (default 2.6, about 155 words a minute; slower for tutorials: 2.2)
//   --max   longest acceptable length in seconds (default 60; reels over that lose people, long-form is another mode)
//   --mode  which suggestion rules to use for the blocks (default talking)
//   --out   output prefix; default inputs/<script name> (git-ignored)
//
// Writes <out>.beats.md (the sheet), <out>.beats.json, <out>.teleprompter.txt (one line per beat, big gaps) and
// <out>.script.srt (estimated timings: run `npm run plan -- <out>.script.srt --mode talking` for a draft cue plan).
// Times are ESTIMATES from the word count. Film, run `npm run polish` on the real transcript, and use those times.
// Lines starting with # or // or [ in the script are notes: they are kept out of the timing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, normalizeQuotes } from './cue-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error('script: ' + m); process.exit(1); };

const args = process.argv.slice(2);
const o = { file: null, wps: 2.6, max: 60, mode: 'talking', out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i], next = () => args[++i];
  if (a === '--wps') o.wps = +next();
  else if (a === '--max') o.max = +next();
  else if (a === '--mode') o.mode = next();
  else if (a === '--out') o.out = next();
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^#!.*\n/, '').replace(/^\/\/ ?/gm, '')); process.exit(0); }
  else if (a.startsWith('--')) fail('unknown option ' + a);
  else o.file = a;
}
if (!o.file) fail('usage: node scripts/script-beats.mjs <script.txt> [--wps 2.6] [--max 60] [--mode talking|screen] [--out <prefix>]');
if (!(o.wps >= 1 && o.wps <= 5)) fail('--wps must be between 1 and 5');
if (!(o.max > 0)) fail('--max must be a number of seconds');
if (!['talking', 'screen'].includes(o.mode)) fail('--mode must be talking or screen');
const file = fs.existsSync(o.file) ? path.resolve(o.file) : path.join(ROOT, o.file);
if (!fs.existsSync(file)) fail('file not found: ' + o.file);

// ---------------------------------------------------------------- beats
const text = normalizeQuotes(fs.readFileSync(file, 'utf8')).replace(/\r/g, '');
const notes = [];
const body = text.split('\n').filter((l) => { if (/^\s*(#|\/\/|\[)/.test(l)) { notes.push(l.trim()); return false; } return true; }).join('\n');
const words = (s) => s.replace(/\*/g, '').split(/\s+/).filter(Boolean);
const PAUSE = 0.35;                                         // a breath after every beat

// a beat is a sentence or a line; long ones split at a comma or a joining word so every beat reads in one caption
function split(sentence) {
  if (words(sentence).length <= 12) return [sentence];
  const parts = sentence.split(/(?<=,)\s+|\s+(?=(?:and|but|so|because|then|which|while)\s)/i).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length && words(out[out.length - 1]).length + words(p).length <= 10) out[out.length - 1] += ' ' + p; else out.push(p);
  }
  return out.length ? out : [sentence];
}
let raw = [];
for (const para of body.split(/\n+/)) {
  for (const s of para.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || []) { const t = s.trim(); if (t) raw.push(...split(t)); }
}
// a beat of 1 or 2 words joins the next one (it would flash by)
const sentences = [];
for (let i = 0; i < raw.length; i++) {
  let t = raw[i];
  if (words(t).length < 3 && i + 1 < raw.length) { raw[i + 1] = t + ' ' + raw[i + 1]; continue; }
  sentences.push(t);
}
if (!sentences.length) fail('the script has no spoken text');

let clock = 0;
const beats = sentences.map((t, i) => {
  const n = words(t).length, dur = n / o.wps, start = clock, end = clock + dur;
  clock = end + PAUSE;
  return { n: i + 1, start: +start.toFixed(2), end: +end.toFixed(2), words: n, text: t.replace(/\s+/g, ' ') };
});
const total = beats[beats.length - 1].end;
const totalWords = beats.reduce((a, b) => a + b.words, 0);

// ---------------------------------------------------------------- block suggestions (the same rules as `npm run plan`)
const ctxBase = { total, count: beats.length };
for (const b of beats) {
  const cue = { start: b.start, end: b.end, text: b.text, index: b.n - 1 };
  b.blocks = [];
  for (const r of RULES) {
    if (r.modes && !r.modes.includes(o.mode)) continue;
    if (r.when && !r.when(cue, { ...ctxBase, index: b.n - 1 })) continue;
    if (!new RegExp(r.match.source, r.match.flags.replace('g', '')).test(b.text)) continue;
    b.blocks.push({ id: r.suggest, kind: r.kind, why: r.why, privacy: !!r.privacy });
  }
}

// ---------------------------------------------------------------- the director's checks
const flags = [];   // { level: 'fix' | 'watch' | 'note', at, msg }
const add = (level, at, msg) => flags.push({ level, at, msg });
const first = beats[0], last = beats[beats.length - 1];

if (/^\s*(hi|hey|hello|what'?s up|welcome|good (morning|afternoon|evening)|my name is|in this video|today (i|we)|so today)\b/i.test(first.text))
  add('fix', first.start, `The reel opens with a greeting or an introduction ("${first.text.slice(0, 40)}..."). Start on the promise or the problem; say who you are later, or on screen.`);
if (first.end > 3.5) add('fix', first.start, `The first beat runs ${first.end.toFixed(1)} s. The hook has to land inside about 3 s (roughly ${Math.round(3.5 * o.wps)} words).`);
if (!/[?!]|\d|\b(stop|never|why|how|secret|mistake|wrong|nobody|most people|biggest|only|without|before you|don't|do not|nothing|everything)\b/i.test(first.text))
  add('note', first.start, 'The first beat is not obviously a promise, a question, a number or a problem. Read it aloud: would you keep watching?');
beats.forEach((b) => {
  const d = b.end - b.start;
  if (d > 4.5) add('watch', b.start, `Beat ${b.n} runs ${d.toFixed(1)} s (${b.words} words). Split it, or give it a block or a punch-in so something changes.`);
});
// flat stretch: more than 6 s with no suggested block (captions are always on; this asks for a real visual change). One flag per stretch.
{
  let from = 0;
  const report = (to) => { if (to - from > 6) add('watch', from, `Nothing visual changes from ${from.toFixed(1)} s to ${to.toFixed(1)} s. Add a card, a number, a punch-in or a cut at about ${(from + 3).toFixed(1)} s and again every 2-3 s after.`); };
  for (const b of beats) if (b.blocks.some((x) => x.kind !== 'screen')) { report(b.start); from = b.start; }
  report(total);
}
if (!beats.slice(-2).some((b) => /\b(follow|comment|save|share|subscribe|dm|message|link|click|tap|try|download|join|sign up|book|reply|send|check out|watch)\b/i.test(b.text)))
  add('fix', last.start, 'No ending action in the last two beats (follow, comment, save, share, link...). One reel, one idea, one action.');
if (last.end - last.start > 4) add('watch', last.start, `The last beat runs ${(last.end - last.start).toFixed(1)} s. Keep the ask to one short line.`);
if (total > o.max) add('fix', 0, `The reel runs about ${total.toFixed(0)} s; the limit is ${o.max} s. Cut about ${Math.ceil((total - o.max) * o.wps)} words.`);
else if (total < 10) add('watch', 0, `Only about ${total.toFixed(0)} s. Fine for a punchline, thin for a message.`);
for (const b of beats) {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(b.text) || /\b(api[_ -]?key|password|token|secret key)\b/i.test(b.text)) add('note', b.start, `Beat ${b.n} mentions an email or a credential: blur it if it is ever shown on screen.`);
}
const lists = beats.filter((b) => /^\s*(first|second|third|number (one|two|three)|step \d|\d[.)])/i.test(b.text));
if (lists.length >= 3) add('note', lists[0].start, `${lists.length} numbered beats: one card each (glass-card or checklist) keeps them readable.`);

flags.sort((a, b) => a.at - b.at);
const verdict = flags.some((f) => f.level === 'fix') ? 'FIX BEFORE FILMING' : flags.some((f) => f.level === 'watch') ? 'GOOD, WITH THINGS TO WATCH' : 'READY TO FILM';

// ---------------------------------------------------------------- outputs
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const prefix = o.out || (file.startsWith(ROOT + path.sep) ? path.join(ROOT, 'inputs', path.basename(file, path.extname(file))) : file.slice(0, -path.extname(file).length));
const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');
fs.mkdirSync(path.dirname(prefix), { recursive: true });

const srtT = (s) => { const ms = Math.round(s * 1000), z = (n, w = 2) => String(n).padStart(w, '0'); return `${z(Math.floor(ms / 3600000))}:${z(Math.floor(ms / 60000) % 60)}:${z(Math.floor(ms / 1000) % 60)},${z(ms % 1000, 3)}`; };
fs.writeFileSync(prefix + '.script.srt', beats.map((b) => `${b.n}\n${srtT(b.start)} --> ${srtT(b.end)}\n${b.text}\n`).join('\n'));
fs.writeFileSync(prefix + '.teleprompter.txt', beats.map((b) => b.text.replace(/\*/g, '')).join('\n\n\n') + '\n');
fs.writeFileSync(prefix + '.beats.json', JSON.stringify({ source: path.basename(file), wps: o.wps, estimatedSeconds: +total.toFixed(1), words: totalWords, verdict, flags, beats }, null, 2) + '\n');

const L = [];
L.push(`# Beat sheet: ${path.basename(file)}`, '',
  `- Estimated length: **${total.toFixed(1)} s** (${totalWords} words at ${o.wps} words/s, ${PAUSE} s breath between beats). Limit ${o.max} s.`,
  `- Verdict: **${verdict}** (${flags.filter((f) => f.level === 'fix').length} to fix, ${flags.filter((f) => f.level === 'watch').length} to watch, ${flags.filter((f) => f.level === 'note').length} notes)`,
  `- These times are estimates. After filming, polish the real transcript and use its times.`, '');
if (flags.length) { L.push('## Director\'s notes', ''); for (const f of flags) L.push(`- **${f.level}** at ${mmss(f.at)}: ${f.msg}`); L.push(''); }
L.push('## Beats', '', '| # | Time | Words | Line | Block ideas |', '|---|---|---|---|---|');
for (const b of beats) L.push(`| ${b.n} | ${mmss(b.start)}-${mmss(b.end)} | ${b.words} | ${b.text.replace(/\|/g, '/')} | ${[...new Set(b.blocks.map((x) => x.id))].join(', ') || '-'} |`);
L.push('', 'Block ideas come from the same rules as `npm run plan` and are drafts: keep one change every 2 to 3 seconds, not one per beat.', '');
if (notes.length) L.push('## Notes in the script (kept out of the timing)', '', ...notes.map((n) => '- ' + n), '');
fs.writeFileSync(prefix + '.beats.md', L.join('\n'));

console.log(`${path.basename(file)}: ${beats.length} beats, about ${total.toFixed(1)} s, ${totalWords} words -> ${verdict}`);
for (const f of flags) console.log(`  ${f.level.padEnd(5)} ${mmss(f.at)}  ${f.msg}`);
for (const e of ['.beats.md', '.beats.json', '.teleprompter.txt', '.script.srt']) console.log('wrote ' + rel(prefix + e));
console.log(`next:\n  npm run plan -- ${rel(prefix + '.script.srt')} --mode ${o.mode}`);
