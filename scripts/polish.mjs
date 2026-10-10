#!/usr/bin/env node
// Transcript polisher. Turns a rough CapCut transcript (line-level SRT / VTT, or plain TXT) into clean captions,
// word timings, kinetic-subtitle cues and a filler cut list.
//
//   node scripts/polish.mjs <transcript.srt|.vtt|.txt> [--glossary g.json] [--audio <video|audio>] [--mode caption|karaoke]
//                           [--fillers keep|flag|remove] [--lang en|tl|auto] [--numbers] [--out <path prefix>]
//
//   --glossary   { "terms": [...], "fixes": { "misheard": "Right" }, "punch": [...] }
//                default: inputs/glossary.json if it exists, else examples/glossary.json
//   --audio      the SAME exported file the transcript belongs to (CapCut timings are for the edited export). Runs the local
//                transcriber (`hyperframes transcribe`, whisper.cpp: the first run downloads a model, so it needs a connection)
//                and aligns the polished words to the recognised ones for real word times. Needed for plain TXT.
//   --mode       caption (default): max 2 lines x 42 chars, 1-6 s per cue. karaoke: 2-4 words per cue, blank over pauses.
//   --fillers    flag (default): ums, you know... stay in the captions but are marked in words.json and the cut list.
//                remove: they are also dropped from the captions. keep: ignore fillers (no marks, empty cut list).
//                Repeated words, stutters and false starts are always collapsed in the captions.
//   --lang       en (default via auto), tl = Tagalog / Taglish (its fillers are flag-only). auto guesses from the words.
//   --numbers    spoken numbers to digits ("twenty percent" -> "20%", "three hundred dollars" -> "$300"). Conservative.
//   --out        output prefix; default = the input path without its extension (inputs/capcut -> inputs/capcut.polished.srt ...)
//
// Writes <out>.polished.srt, <out>.words.json, <out>.cues.json (kinetic-subtitle `cues`, punch words as *word*),
// <out>.fillers.json (cut list for `npm run trim -- <voice file> --cut-list <out>.fillers.json`) and <out>.polish-report.md.
// It never re-cuts anything by silence: timings stay on the timeline of the file the transcript came from.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTranscriptFile, cleanCues, formatSrt, alignSequences, levenshtein, mmss, r3 } from './lib/transcript.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- configuration (edit these lists)
const HANDLE = 0.04;                 // s kept on each side of a filler cut so a neighbouring word is never clipped
const PAUSE = 0.6;                   // s of silence between cues that ends a sentence
const MIN_CUT = 0.06;                // a filler range shorter than this (after handles) is not worth a cut

const FILLERS = {
  en: {
    hesitations: /^(u+h+m*|u+m+|e+r+m?|a+h+|h+m+|m{2,})$/,        // um uh uhm er erm ah hmm mm: removable
    phrases: [['you', 'know'], ['i', 'mean']],                    // removable when comma-delimited
    like: true,                                                   // removable only as ", like,"
    hedges: [['sort', 'of'], ['kind', 'of'], ['basically'], ['actually'], ['literally']],   // flag-only, never removed
  },
  tl: {
    hesitations: /^(u+h+m*|u+m+|e+r+m?|h+m+|m{2,})$/,            // language-neutral sounds stay removable
    flagOnly: ['ano', 'eh', 'ah'],                                // flagged when delimited by a comma or a pause
    sentenceInitialAfterPause: ['kasi'],                          // flagged only at the start of a sentence after a pause
    hedges: [],
  },
};
// words that make a transcript read as Tagalog / Taglish (for --lang auto)
const TL_HINTS = new Set(['ang', 'ng', 'sa', 'na', 'ako', 'ka', 'ko', 'mo', 'kasi', 'yung', 'mga', 'naman', 'lang', 'po', 'opo', 'hindi', 'ito', 'iyan', 'dito', 'doon', 'kayo', 'tayo', 'natin', 'siya', 'pero', 'kaya', 'talaga', 'sige', 'para', 'din', 'rin', 'ba', 'pa', 'may', 'wala', 'ano', 'paano', 'bakit', 'yan', 'ay', 'at', 'ni', 'nito', 'nyo', 'niyo']);

const REPEAT_OK = new Set(['had', 'that', 'very', 'no', 'bye', 'ha', 'really', 'many']);   // "had had", "very very": legitimate doubles
const STOP = new Set(('a an the and or but so if as of to in on at by for with from into onto up out off over about than then that this these those ' +
  'is are was were be been being am do does did done have has had having i you he she it we they me him her us them my your his its our their ' +
  'can could will would shall should may might must not no yes just very too also there here what when where who why how which while ' +
  'ng sa na ang mga ay at ako ka ko mo yung ito iyan siya kami tayo kayo sila').split(' '));
const WEAK = new Set(['think', 'know', 'want', 'hear', 'turn', 'make', 'take', 'takes', 'need', 'get', 'got', 'going', 'show', 'look', 'used', 'something', 'thing', 'things', 'really', 'right', 'okay', 'well', 'while']);   // content words that make poor punch words
const CONJ = new Set(['and', 'but', 'so', 'or', 'because', 'which', 'that', 'when', 'if', 'then', 'while', 'where', 'who', 'as']);
const CONTINUE = new Set(['and', 'or', 'to', 'of', 'with', 'which', 'that', 'because', 'for', 'in', 'on', 'as', 'if', 'when']);   // a cue starting with these continues the sentence
const EMPHASIS = {
  en: ['never', 'always', 'only', 'free', 'secret', 'mistake', 'mistakes', 'biggest', 'fastest', 'easiest', 'zero', 'every', 'nothing', 'everything', 'instantly', 'million', 'billion', 'best', 'worst', 'huge', 'impossible', 'guaranteed', 'hidden', 'wrong', 'exactly', 'stop', 'must', 'entire'],
  tl: ['hindi', 'wala', 'libre', 'lahat', 'palagi', 'laging', 'pinakamabilis', 'sikreto', 'mali', 'agad'],
};
const UNIT_WORDS = new Set(['minutes', 'minute', 'seconds', 'second', 'hours', 'hour', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year', 'percent', 'dollars', 'euros', 'pesos', 'steps', 'times', 'x', 'k', 'mb', 'gb', 'ms']);

// ---------------------------------------------------------------- small helpers
function fail(msg) { console.error('polish: ' + msg); process.exit(1); }
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const keyOf = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const isTerminal = (t) => /[.?!]["')\]]*$/.test(t);
const isDelim = (t) => /[,;:.?!]["')\]]*$|[-\u2013\u2014]$|\.\.\.$/.test(t);

function parseArgs(argv) {
  const o = { input: null, glossary: null, audio: null, mode: 'caption', fillers: 'flag', lang: 'auto', numbers: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) fail('missing value for ' + a); return argv[++i]; };
    if (a === '--glossary') o.glossary = next();
    else if (a === '--audio') o.audio = next();
    else if (a === '--mode') o.mode = next();
    else if (a === '--fillers') o.fillers = next();
    else if (a === '--lang') o.lang = next();
    else if (a === '--out') o.out = next();
    else if (a === '--numbers') o.numbers = true;
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^#!.*\n/, '').replace(/^\/\/ ?/gm, '')); process.exit(0); }
    else if (a.startsWith('--')) fail('unknown option ' + a);
    else if (!o.input) o.input = a;
    else fail('unexpected argument ' + a);
  }
  if (!o.input) fail('usage: node scripts/polish.mjs <transcript.srt|.vtt|.txt> [--glossary g.json] [--audio <file>] [--mode caption|karaoke] [--fillers keep|flag|remove] [--lang en|tl|auto] [--numbers] [--out <prefix>]');
  if (!['caption', 'karaoke'].includes(o.mode)) fail('--mode must be caption or karaoke');
  if (!['keep', 'flag', 'remove'].includes(o.fillers)) fail('--fillers must be keep, flag or remove');
  if (!['en', 'tl', 'auto'].includes(o.lang)) fail('--lang must be en, tl or auto');
  return o;
}

function loadGlossary(file) {
  const auto = path.join(ROOT, 'inputs/glossary.json');
  const f = file || (fs.existsSync(auto) ? auto : null);
  if (!f) {
    console.warn('polish: no glossary: inputs/glossary.json does not exist, so no word fixes are applied. Pass --glossary <file> (examples/glossary.json is a placeholder demo).');
    return { file: null, terms: [], fixes: {}, punch: [] };
  }
  if (!fs.existsSync(f)) fail('glossary not found: ' + f);
  console.log('polish: using glossary ' + path.relative(process.cwd(), f));
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(`${f} is not valid JSON: ${e.message}`); }
  const terms = Array.isArray(j.terms) ? j.terms.map(String) : [], punch = Array.isArray(j.punch) ? j.punch.map(String) : [];
  const fixes = j.fixes && typeof j.fixes === 'object' && !Array.isArray(j.fixes) ? Object.fromEntries(Object.entries(j.fixes).map(([k, v]) => [k, String(v)])) : {};
  return { file: f, terms, fixes, punch };
}

// ---------------------------------------------------------------- tokens
// A word is { lead, core, trail, key, start, end, source, cue, ... }. Display text = lead + core + trail.
const TOKEN = /^([^\p{L}\p{N}$€£₱]*)(.*?)([^\p{L}\p{N}%]*)$/u;
const display = (w) => w.lead + w.core + w.trail;
const TENS_ONES = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)$/i;

function tokenizeCues(cues) {
  const ws = [];
  cues.forEach((cue, ci) => {
    const toks = [];
    for (const raw of cue.text.split(/\s+/).filter(Boolean)) {
      const m = raw.match(TOKEN);
      if (!m[2] && /^[.,;:!?\u2026"')\]-]+$/.test(raw)) { if (toks.length) toks[toks.length - 1].trail += raw; continue; }
      if (!m[2]) { toks.push({ lead: '', core: raw, trail: '' }); continue; }       // a lone symbol ("<", "&") stays a word     // lone punctuation sticks to the word before it
      const hy = m[2].match(TENS_ONES);
      if (hy) { toks.push({ lead: m[1], core: hy[1], trail: '' }); toks.push({ lead: '', core: hy[2], trail: m[3] }); }
      else toks.push({ lead: m[1], core: m[2], trail: m[3] });
    }
    const total = toks.reduce((n, t) => n + t.core.length + 2, 0) || 1;
    let acc = 0;
    for (const t of toks) {
      const a = acc, b = acc + t.core.length + 2;
      acc = b;
      ws.push({ ...t, key: keyOf(t.core) || t.core, start: cue.start + (cue.end - cue.start) * (a / total), end: cue.start + (cue.end - cue.start) * (b / total), source: 'interpolated', cue: ci });
    }
  });
  return ws.filter((w) => w.key);
}

function replaceSpan(ws, i, j, replText, extra) {
  const old = ws.slice(i, j + 1), toks = replText.split(/\s+/).filter(Boolean);
  const first = old[0], last = old[old.length - 1];
  let nw;
  if (toks.length === old.length) {
    nw = old.map((w, k) => ({ ...w, core: toks[k], key: keyOf(toks[k]), lead: k === 0 ? first.lead : '', trail: k === old.length - 1 ? last.trail : (w.trail && /[,;:]$/.test(w.trail) ? w.trail : ''), ...extra }));
  } else {
    const total = toks.reduce((n, t) => n + t.length + 2, 0);
    let acc = 0;
    nw = toks.map((t, k) => {
      const a = acc, b = acc + t.length + 2;
      acc = b;
      return { ...first, lead: k === 0 ? first.lead : '', core: t, trail: k === toks.length - 1 ? last.trail : '', key: keyOf(t), start: first.start + (last.end - first.start) * (a / total), end: first.start + (last.end - first.start) * (b / total), ...extra };
    });
  }
  ws.splice(i, old.length, ...nw);
  return nw.length;
}

// first span of whole words starting at i whose letters, joined without spaces, equal K (so "hyper frames" matches "hyperframes")
function spanAt(ws, i, K) {
  let acc = '';
  for (let j = i; j < ws.length; j++) {
    if (ws[j].locked) return null;
    if (j > i && isTerminal(ws[j - 1].trail)) return null;     // never across a sentence end
    acc += ws[j].key;
    if (acc === K) return j;
    if (!K.startsWith(acc)) return null;
  }
  return null;
}

// ---------------------------------------------------------------- glossary
function applyGlossary(ws, gl, ops) {
  let termId = 0;
  const jobs = [
    ...Object.entries(gl.fixes).map(([k, v]) => ({ K: keyOf(k), repl: v, kind: 'glossary' })),
    ...gl.terms.map((t) => ({ K: keyOf(t), repl: t, kind: 'term' })),
  ].filter((j) => j.K).sort((a, b) => b.K.length - a.K.length || (a.kind === 'glossary' ? -1 : 1));
  for (const job of jobs) {
    for (let i = 0; i < ws.length;) {
      const j = ws[i].locked ? null : spanAt(ws, i, job.K);
      if (j === null) { i++; continue; }
      const before = ws.slice(i, j + 1).map((w) => w.core).join(' ');
      termId++;
      const n = replaceSpan(ws, i, j, job.repl, { locked: true, termId });
      if (before !== job.repl) ops.push({ cue: ws[i].cue, t: ws[i].start, kind: job.kind === 'term' ? 'term-case' : 'glossary', before, after: job.repl });
      i += n;
    }
  }
  // fuzzy: a single-word term that is one letter off ("hyperframe" -> "HyperFrames"): applied, but listed for review.
  // Inflections (Pipeline -> pipelines) are never rewritten: they are listed as possible plurals instead.
  const inflected = (key, K) => (key.startsWith(K) && ['s', 'es', 'ed', 'd', 'ing'].includes(key.slice(K.length))) || (K.endsWith('e') && key === K.slice(0, -1) + 'ing');
  for (const t of gl.terms.filter((x) => !/\s/.test(x.trim()) && keyOf(x).length >= 5)) {
    const K = keyOf(t);
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (w.locked || w.key.length < 5 || w.key === K || STOP.has(w.key)) continue;
      if (inflected(w.key, K)) { ops.push({ cue: w.cue, t: w.start, kind: 'possible-inflection', before: w.core, after: w.core, review: `"${w.core}" may be a plural / inflection of the term "${t}": left as spoken` }); continue; }
      if (levenshtein(w.key, K) !== 1) continue;
      termId++;
      ops.push({ cue: w.cue, t: w.start, kind: 'fuzzy-term', before: w.core, after: t, review: `"${w.core}" looks like the term "${t}" (one letter off)` });
      replaceSpan(ws, i, i, t, { locked: true, termId });
    }
  }
}

// ---------------------------------------------------------------- fillers
function markFiller(w, kind, action, text) { w.filler = kind; w.fAction = action; w.fText = text; }

function detectFillers(ws, cfg, lang, ops) {
  const live = () => ws.filter((w) => !w.filler);
  const op = (w, kind, text, review) => ops.push({ cue: w.cue, t: w.start, kind: 'filler:' + kind, before: text, after: '', review, w });

  // 1. cut-off fragments "I- I", "th- the": the fragment goes
  {
    const arr0 = live();
    for (let i = 0; i < arr0.length; i++) {
      const w = arr0[i];
      if (!/^-+$/.test(w.trail) || w.locked) continue;
      const nx = arr0[i + 1];
      if (nx && nx.key.startsWith(w.key) && nx.cue === w.cue) { markFiller(w, 'stutter', 'remove', w.core + '-'); op(w, 'stutter', w.core + '-'); }
      else if (nx) { markFiller(w, 'false-start', 'remove', w.core + '-'); op(w, 'false-start', w.core + '-', `cut-off word "${w.core}-" dropped from the captions`); }
    }
  }
  // 2. hesitation sounds
  for (const w of ws) if (!w.filler && !w.locked && cfg.hesitations.test(w.key)) { markFiller(w, 'hesitation', 'remove', w.core); op(w, 'hesitation', w.core); }
  // 3. repeated words
  let arr = live();
  for (let i = 0; i + 1 < arr.length; i++) {
    const a = arr[i], b = arr[i + 1];
    if (a.key !== b.key || a.locked || /^\d/.test(a.key) || REPEAT_OK.has(a.key) || /[.?!;:]/.test(a.trail)) continue;
    markFiller(a, 'repeat', 'remove', a.core); op(a, 'repeat', `${a.core} ${b.core}`);
  }
  // 4. false starts: a 2-4 word phrase said twice ("you can you can add"): the first try goes
  arr = live();
  for (let i = 0; i < arr.length; i++) {
    for (let n = 4; n >= 2; n--) {
      if (i + 2 * n > arr.length) continue;
      const A = arr.slice(i, i + n), B = arr.slice(i + n, i + 2 * n);
      if (A.some((w) => w.locked) || /[.?!]/.test(A[n - 1].trail) || !A.every((w, k) => w.key === B[k].key)) continue;
      const txt = A.map((w) => w.core).join(' ');
      A.forEach((w) => markFiller(w, 'false-start', 'remove', txt));
      ops.push({ cue: A[0].cue, t: A[0].start, kind: 'filler:false-start', before: `${txt} ${txt}`, after: txt, w: A[0], review: `repeated phrase "${txt}": first try dropped` });
      i += n - 1;
      break;
    }
  }
  // 5. phrases that are fillers only when comma-delimited
  arr = live();
  const pos = new Map(ws.map((w, k) => [w, k]));
  const before = (w) => { const p = ws[pos.get(w) - 1]; return !p || p.filler || isDelim(p.trail) || p.cue !== w.cue; };
  const after = (last) => { const nx = ws[pos.get(last) + 1]; return /[,;:.?!]$/.test(last.trail) || !nx || nx.cue !== last.cue || (nx.filler && nx.filler === 'hesitation'); };
  if (cfg.phrases) {
    for (let i = 0; i < arr.length; i++) {
      for (const ph of cfg.phrases) {
        const seq = arr.slice(i, i + ph.length);
        if (seq.length < ph.length || !seq.every((w, k) => w.key === ph[k]) || seq.some((w) => w.locked)) continue;
        if (!before(seq[0]) || !after(seq[seq.length - 1])) continue;
        const txt = seq.map((w) => w.core).join(' ');
        seq.forEach((w) => markFiller(w, 'discourse', 'remove', txt));
        op(seq[0], 'discourse', txt);
        i += ph.length - 1;
        break;
      }
    }
    if (cfg.like) {
      for (const w of live()) {
        if (w.key !== 'like' || w.locked || !/,$/.test(w.trail)) continue;
        const p = ws[pos.get(w) - 1];
        if (!p || p.filler || /[,;:.?!]$/.test(p.trail)) { markFiller(w, 'discourse', 'remove', 'like'); op(w, 'discourse', 'like', '"like" removed (comma-delimited both sides)'); }
      }
    }
  }
  // 6. flag-only: hedges and Tagalog fillers
  arr = live();
  for (let i = 0; i < arr.length; i++) {
    for (const h of cfg.hedges || []) {
      const seq = arr.slice(i, i + h.length);
      if (seq.length === h.length && seq.every((w, k) => w.key === h[k]) && !seq.some((w) => w.locked)) {
        const txt = seq.map((w) => w.core).join(' ');
        seq.forEach((w) => markFiller(w, 'hedge', 'flag', txt));
        op(seq[0], 'hedge', txt);
        i += h.length - 1;
        break;
      }
    }
  }
  if (cfg.flagOnly) {
    for (const w of live()) {
      const p = ws[pos.get(w) - 1], gapBefore = p ? w.start - p.end : 9;
      if (cfg.flagOnly.includes(w.key) && !w.locked && ((p ? isDelim(p.trail) : true) || gapBefore >= PAUSE) && /[,;:.?!]$/.test(w.trail)) { markFiller(w, 'tl-filler', 'flag', w.core); op(w, 'tl-filler', w.core); }
      else if (cfg.sentenceInitialAfterPause.includes(w.key) && !w.locked && (!p || (isTerminal(p.trail) && gapBefore >= PAUSE) || gapBefore >= PAUSE)) { markFiller(w, 'tl-filler', 'flag', w.core); op(w, 'tl-filler', w.core); }
    }
  }
}

// ---------------------------------------------------------------- numbers
const ONES = Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ').map((w, i) => [w, i]));
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9 };

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function parseNumber(keys, i) {
  let j = i, total = 0, cur = 0, used = 0, hasScale = false, sawHundred = false;
  if (keys[j] === 'a' && (keys[j + 1] === 'hundred' || has(SCALE, keys[j + 1]))) j++;      // "a hundred"
  for (; j < keys.length; j++) {
    const k = keys[j];
    if (has(ONES, k) && k !== 'zero' && (cur % 100 === 0 || (cur % 100 >= 20 && cur % 10 === 0 && ONES[k] < 10))) { cur += ONES[k]; used = j - i + 1; }
    else if (has(TENS, k) && cur % 100 === 0) { cur += TENS[k]; used = j - i + 1; }
    else if (k === 'hundred' && (cur === 0 || cur < 100)) { cur = (cur || 1) * 100; sawHundred = true; hasScale = true; used = j - i + 1; }
    else if (has(SCALE, k)) { total += (cur || 1) * SCALE[k]; cur = 0; hasScale = true; sawHundred = false; used = j - i + 1; }
    else if (k === 'and' && sawHundred && (has(TENS, keys[j + 1]) || (has(ONES, keys[j + 1]) && keys[j + 1] !== 'zero'))) continue;
    else break;
  }
  if (!used) return null;
  let value = total + cur, len = used;
  if (keys[i + len] === 'point' && has(ONES, keys[i + len + 1]) && ONES[keys[i + len + 1]] < 10) {
    let frac = '', k = i + len + 1;
    while (k < keys.length && has(ONES, keys[k]) && ONES[keys[k]] < 10) { frac += ONES[keys[k]]; k++; }
    value = Number(value + '.' + frac); len = k - i;
  }
  return { value, len, hasScale };
}

function convertNumbers(ws, ops) {
  for (let i = 0; i < ws.length; i++) {
    if (ws[i].filler || ws[i].locked) continue;
    const keys = []; for (let k = i; k < Math.min(ws.length, i + 12); k++) keys.push(ws[k].filler ? '#' : ws[k].key);
    const num = parseNumber(keys, 0);
    if (!num) continue;
    const nxt = ws[i + num.len] && !ws[i + num.len].filler ? ws[i + num.len].key : '';
    const prevEnd = i + num.len - 1;
    if (ws.slice(i, prevEnd).some((w) => /[.?!,;:]$/.test(w.trail))) continue;       // never across punctuation
    let out, used = num.len;
    const fmt = (v, comma) => (comma || v >= 10000 ? v.toLocaleString('en-US') : String(v));
    if (nxt === 'percent') { out = fmt(num.value) + '%'; used++; }
    else if (['dollars', 'dollar', 'bucks'].includes(nxt)) { out = '$' + fmt(num.value, true); used++; }
    else if (nxt === 'euros') { out = '€' + fmt(num.value, true); used++; }
    else if (nxt === 'pesos') { out = '₱' + fmt(num.value, true); used++; }
    else if (UNIT_WORDS.has(nxt)) out = fmt(num.value);
    else if (num.len >= 2 && (num.hasScale || num.value >= 21)) out = fmt(num.value);
    else continue;
    const span = ws.slice(i, i + used), before = span.map((w) => w.core).join(' ');
    const nw = { ...span[0], core: out, key: keyOf(out), lead: span[0].lead, trail: span[span.length - 1].trail, end: span[span.length - 1].end, number: true };
    ws.splice(i, used, nw);
    ops.push({ cue: nw.cue, t: nw.start, kind: 'number', before, after: out });
  }
}

// ---------------------------------------------------------------- transcription + alignment
function hyperframesCommand() {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/hyperframes/package.json'), 'utf8'));
    const bin = typeof pj.bin === 'string' ? pj.bin : pj.bin && (pj.bin.hyperframes || Object.values(pj.bin)[0]);
    if (bin) return { cmd: process.execPath, pre: [path.join(ROOT, 'node_modules/hyperframes', bin)] };
  } catch { /* fall through to npx */ }
  // never a shell: on Windows run npm's own npx script with node, so paths with spaces or & ^ % stay plain arguments
  if (process.platform === 'win32') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (fs.existsSync(cli)) return { cmd: process.execPath, pre: [cli, 'hyperframes'] };
    return null;
  }
  return { cmd: 'npx', pre: ['hyperframes'] };
}

function requireFfmpeg() {
  for (const t of ['ffmpeg', 'ffprobe']) {
    const r = run(t, ['-version']);
    if (r.error || r.status !== 0) fail(t === 'ffmpeg' ? 'ffmpeg not found on PATH - install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg)'
      : 'ffprobe not found on PATH - it ships with ffmpeg (macOS: brew install ffmpeg, Windows: winget install ffmpeg)');
  }
}

// Voiced stretches [{ start, end }] of the audio (ffmpeg silencedetect, same -35 dB as auto-trim). Used to correct recogniser times.
function speechIslands(file, duration) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'silencedetect=noise=-35dB:d=0.2', '-f', 'null', '-']);
  if (r.status !== 0) return [];
  const sil = [];
  let open = null;
  for (const line of String(r.stderr).split('\n')) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) { open = Math.max(0, Number(m[1])); continue; }
    m = line.match(/silence_end: (-?[\d.]+)/);
    if (m && open !== null) { sil.push({ start: open, end: Number(m[1]) }); open = null; }
  }
  if (open !== null) sil.push({ start: open, end: duration });
  const isl = [];
  let cur = 0;
  for (const s of sil) { if (s.start - cur >= 0.12) isl.push({ start: cur, end: s.start }); cur = Math.max(cur, s.end); }
  if (duration - cur >= 0.12) isl.push({ start: cur, end: duration });
  return isl;
}

// -> { words: [{ text, start, end }], duration } or { error }
function transcribeAudio(file, lang) {
  if (!fs.existsSync(file)) fail('audio file not found: ' + file);
  requireFfmpeg();
  const p = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const duration = Number(String(p.stdout).trim()) || 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polish-'));
  try {
    const wav = path.join(tmp, 'voice.wav');
    const ex = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav]);
    if (ex.status !== 0) return { error: 'ffmpeg could not read audio from ' + file + ': ' + String(ex.stderr).trim().split('\n').pop(), duration };
    const hf = hyperframesCommand();
    if (!hf) return { error: 'hyperframes is not installed here (run npm install in the kit folder).', duration };
    const args = [...hf.pre, 'transcribe', wav, '--dir', tmp, '--json'];
    if (lang === 'en') args.push('--language', 'en');
    const r = run(hf.cmd, args, { cwd: ROOT });
    const out = String(r.stdout).trim().split('\n').pop();
    let info = null;
    try { info = JSON.parse(out); } catch { /* not json */ }
    if (r.status !== 0 || !info || !info.ok) {
      const why = (info && (info.error || info.message)) || String(r.stderr || r.stdout || r.error || '').trim().split('\n').slice(-3).join(' | ');
      return { error: 'hyperframes transcribe failed (' + (why || 'no output') + '). The first run downloads a whisper model and needs a connection.', duration };
    }
    const j = JSON.parse(fs.readFileSync(info.transcriptPath || path.join(tmp, 'transcript.json'), 'utf8'));
    const words = (Array.isArray(j) ? j : j.words || []).filter((w) => w && typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
    if (!words.length) return { error: 'the transcriber returned no words (is there speech in ' + file + '?)', duration };
    return { words, duration, islands: speechIslands(file, duration) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// whisper.cpp word times can sit well away from the audio (leading words squeezed into the silence before the first
// phrase, a phrase stretched past its end). Per voiced island: if the aligned words overshoot the island edges, map them
// affinely onto the island. Islands that already agree within ~0.2 s are left alone. Returns how many words moved > 0.1 s.
function refineToIslands(ws, islands) {
  const al = ws.filter((w) => w.source === 'aligned');
  if (!al.length || !islands.length) return 0;
  const groups = islands.map(() => []);
  let idx = 0;
  for (const w of al) {
    const m = (w.start + w.end) / 2;
    let best = idx, bd = Infinity;
    for (let k = idx; k < islands.length; k++) {
      const d = m < islands[k].start ? islands[k].start - m : m > islands[k].end ? m - islands[k].end : 0;
      if (d < bd) { bd = d; best = k; }
      if (islands[k].start > m) break;
    }
    idx = best;
    groups[best].push(w);
  }
  let moved = 0;
  groups.forEach((g, k) => {
    const isl = islands[k];
    if (g.length < 2 || isl.end - isl.start < 0.3) return;
    const a = g[0].start, b = g[g.length - 1].end;
    if (Math.abs(a - isl.start) <= 0.2 && b <= isl.end + 0.25 && b >= isl.end - 0.4) return;
    const f = (isl.end - isl.start) / Math.max(0.05, b - a);
    if (f < 0.5 || f > 2.2) return;                                           // too different to trust either side
    for (const w of g) {
      const s0 = w.start, e0 = w.end;
      w.start = isl.start + (w.start - a) * f; w.end = isl.start + (w.end - a) * f;
      if (Math.abs(w.start - s0) > 0.1 || Math.abs(w.end - e0) > 0.1) moved++;
    }
  });
  return moved;
}

// Replace interpolated times with recognised ones where the words line up. Returns { aligned, total, drift, moved }.
export function alignWords(ws, recognised, islands = []) {
  const a = ws.map((w) => w.key), want = new Set(a);
  let rec = recognised.map((r) => ({ ...r, key: keyOf(r.text) })).filter((r) => r.key);
  // the recogniser says "hyper frames" where the polished text has "HyperFrames": join neighbours that spell a polished word
  rec = rec.reduce((out, r) => {
    const p = out[out.length - 1];
    if (p && !want.has(p.key) && want.has(p.key + r.key)) { p.key += r.key; p.end = r.end; p.text += r.text; }
    else out.push({ ...r });
    return out;
  }, []);
  const pairs = alignSequences(a, rec.map((r) => r.key));
  const drift = [];
  let aligned = 0;
  ws.forEach((w, i) => {
    const p = pairs[i];
    if (!p) return;
    const r = rec[p.j];
    drift.push(Math.abs(r.start - w.start));
    w.start = r.start; w.end = Math.max(r.end, r.start + 0.02); w.source = 'aligned'; aligned++;
  });
  const moved = refineToIslands(ws, islands);
  // unaligned runs between two aligned words are re-spread inside that gap (a filler the recogniser dropped sits there)
  for (let i = 0; i < ws.length;) {
    if (ws[i].source === 'aligned') { i++; continue; }
    let j = i; while (j < ws.length && ws[j].source !== 'aligned') j++;
    const run_ = ws.slice(i, j), prev = ws[i - 1], next = ws[j];
    const oldDur = Math.max(0.05, run_[run_.length - 1].end - run_[0].start);
    let a0 = prev ? prev.end : null, b0 = next ? next.start : null;
    if (a0 === null && b0 === null) { i = j; continue; }
    if (a0 === null) a0 = Math.max(0, b0 - oldDur);
    if (b0 === null) b0 = a0 + oldDur;
    if (b0 < a0) b0 = a0;
    const total = run_.reduce((n, w) => n + w.core.length + 2, 0);
    let acc = 0;
    for (const w of run_) { const s = acc, e = acc + w.core.length + 2; acc = e; w.start = a0 + (b0 - a0) * (s / total); w.end = a0 + (b0 - a0) * (e / total); }
    i = j;
  }
  for (let i = 1; i < ws.length; i++) if (ws[i].start < ws[i - 1].start) ws[i].start = ws[i - 1].start;
  for (const w of ws) if (w.end < w.start) w.end = w.start;
  return { aligned, total: ws.length, drift, moved };
}

// ---------------------------------------------------------------- punctuation + casing
const isCleanup = (k) => k === 'repeat' || k === 'stutter' || k === 'false-start';
const isDropped = (w, mode) => !!w.filler && (isCleanup(w.filler) || (mode === 'remove' && w.fAction === 'remove'));

function finalise(ws, mode, gl, stats, capRule) {
  // 1. punctuation that sat on a dropped filler moves to the word before it ("so, um, we" -> "so, we")
  let last = null;
  for (const w of ws) {
    if (!isDropped(w, mode)) { last = w; continue; }
    if (!last || isCleanup(w.filler) || /[.,;:?!]$/.test(last.trail)) continue;
    const m = w.trail.match(/[.?!]|,/);
    if (m) last.trail += m[0];
  }
  const kept = ws.filter((w) => !isDropped(w, mode));
  // 2. terminal punctuation where a cue ends a sentence by a pause or because the next cue starts with a capital
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i], nx = kept[i + 1];
    if (nx && nx.cue === w.cue) continue;                                    // inside a cue
    if (/[.,;:?!…]["')\]]*$|[-\u2013\u2014]$/.test(w.trail)) continue;
    const pause = nx ? nx.start - w.end >= PAUSE && !CONTINUE.has(nx.key) : true;
    const cap = nx ? capRule && /^\p{Lu}/u.test(nx.core) && !nx.termId && nx.key !== 'i' : true;
    if (pause || cap) { w.trail += '.'; stats.punct++; }
  }
  // 3. sentence casing
  let start = true;
  for (const w of kept) {
    const keep = w.termId && /^\p{Ll}/u.test(w.core);                        // glossary term that is deliberately lower-case ("iPhone")
    if (/^i('m|'ll|'ve|'d)?$/.test(w.core)) { w.core = 'I' + w.core.slice(1); stats.caps++; }
    else if (start && !keep && /^\p{Ll}/u.test(w.core)) { w.core = w.core[0].toUpperCase() + w.core.slice(1); stats.caps++; }
    start = isTerminal(w.trail);
  }
  return kept;
}

// ---------------------------------------------------------------- chunking
const weakEnd = (w) => STOP.has(w.key) && !/[,;:.?!]$/.test(w.trail);
const gapOf = (a, b) => b.start - a.end;

function breakQuality(W, b) {
  if (b >= W.length) return 0;
  const last = W[b - 1], next = W[b], g = gapOf(last, next);
  let q = 0;
  if (isTerminal(last.trail)) q -= 7; else if (/[,;:]$/.test(last.trail)) q -= 2.5;
  if (CONJ.has(next.key)) q -= 1.5;
  if (weakEnd(last)) q += 3.5;
  if (g >= 0.3) q -= 2;
  if (g >= PAUSE) q -= 2;
  if (last.cue !== next.cue) q -= 3;                                         // the editor's own line end
  return q;
}

// Optimal segmentation by dynamic programming: cost(a, b) returns a number or null (infeasible).
function segment(W, hardGap, cost, ignoreGlue = false) {
  const n = W.length, best = new Array(n + 1).fill(Infinity), from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let b = 1; b <= n; b++) {
    if (!ignoreGlue && b < n && W[b - 1].glue && gapOf(W[b - 1], W[b]) <= hardGap) continue;
    for (let a = b - 1; a >= Math.max(0, b - 40); a--) {
      if (a < b - 1 && gapOf(W[a], W[a + 1]) > hardGap) break;                // a cue never spans a long pause
      if (!ignoreGlue && a > 0 && W[a - 1].glue && gapOf(W[a - 1], W[a]) <= hardGap) continue;
      if (best[a] === Infinity) continue;
      const c = cost(a, b);
      if (c === null) continue;
      if (best[a] + c < best[b]) { best[b] = best[a] + c; from[b] = a; }
    }
  }
  if (best[n] === Infinity) return null;
  const segs = [];
  for (let b = n; b > 0; b = from[b]) segs.unshift([from[b], b]);
  return segs;
}

const joinText = (W) => W.map(display).join(' ');

// two lines of at most `width` chars, or null. Prefers a break at punctuation / before a conjunction, avoids a one-word widow.
function layoutLines(words, width) {
  const full = joinText(words);
  if (full.length <= width) return [full];
  let best = null;
  for (let k = 1; k < words.length; k++) {
    if (words[k - 1].glue) continue;
    const l1 = joinText(words.slice(0, k)), l2 = joinText(words.slice(k));
    if (l1.length > width || l2.length > width) continue;
    let s = Math.abs(l1.length - l2.length) * 0.25;
    if (/[,;:.?!]$/.test(words[k - 1].trail)) s -= 5;
    if (CONJ.has(words[k].key)) s -= 4;
    if (weakEnd(words[k - 1])) s += 4;
    if (words.length - k === 1 && l2.length < 7) s += 9;                       // widow
    if (!best || s < best.s) best = { s, lines: [l1, l2] };
  }
  return best ? best.lines : null;
}

function captionCues(W) {
  const W_ = 42, cost = (a, b) => {
    const seg = W.slice(a, b), dur = seg[seg.length - 1].end - seg[0].start;
    if (dur > 6.0) return null;
    const lines = layoutLines(seg, W_);
    if (!lines) return null;
    const chars = joinText(seg).length;
    let c = 5 + (chars < 18 ? (18 - chars) * 0.25 : 0) + (chars > W_ ? 1.5 + (chars - W_) * 0.12 : 0) + (dur < 1 ? 3 * (1 - dur) : 0) + (b - a === 1 ? 3 : 0);
    if (lines.length === 2 && W.slice(a, b).length - 1 > 0 && lines[1].split(' ').length === 1 && lines[1].length < 7) c += 6;
    return c + breakQuality(W, b);
  };
  const segs = segment(W, 0.8, cost) || segment(W, 0.8, cost, true) || W.map((_, i) => [i, i + 1]);
  const cues = segs.map(([a, b]) => ({ words: W.slice(a, b), start: W[a].start, end: W[b - 1].end, lines: layoutLines(W.slice(a, b), W_) || [joinText(W.slice(a, b))] }));
  // timing: abut when the gap is small, hold a little, at least 1 s where the next cue allows, at most 6 s
  cues.forEach((c, i) => {
    const nx = cues[i + 1], limit = nx ? nx.start : Infinity;
    let end = c.end + 0.15;
    if (nx && nx.start - c.end < 0.3) end = nx.start;
    end = Math.max(end, c.start + 1.0);
    end = Math.min(end, limit, c.start + 6.0);
    c.end = Math.max(end, c.words[c.words.length - 1].end);
  });
  return cues;
}

// short single-line phrases (kinetic-subtitle pill) and karaoke chunks share one chunker
function phraseCues(W, p) {
  const n = W.length;
  const cost = (a, b) => {
    const seg = W.slice(a, b), nw = b - a, chars = joinText(seg).length, dur = seg[nw - 1].end - seg[0].start;
    if (nw > p.maxWords || chars > p.maxChars || dur > p.maxDur) return null;
    const isolated = (a === 0 || gapOf(W[a - 1], W[a]) > p.hardGap) && (b === n || gapOf(W[b - 1], W[b]) > p.hardGap);
    let c = 3 + Math.pow(nw - p.target, 2) * 0.8;
    if (nw === 1 && b !== n && !isolated) c += 9;
    if (nw === 1 && b === n) c += 1;
    if (dur < p.minDur && !(b < n && gapOf(W[b - 1], W[b]) >= p.minDur - dur)) c += 6;      // too short and no room to hold it
    return c + breakQuality(W, b);
  };
  const segs = segment(W, p.hardGap, cost) || segment(W, p.hardGap, cost, true) || W.map((_, i) => [i, i + 1]);
  const cues = segs.map(([a, b]) => ({ words: W.slice(a, b), start: W[a].start, end: W[b - 1].end }));
  cues.forEach((c, i) => {
    const nx = cues[i + 1], limit = nx ? nx.start : Infinity;
    let end = c.end;
    if (nx && nx.start - c.end <= p.hardGap) end = nx.start;                 // short gap: no flicker
    else end = c.end + p.hold;
    end = Math.max(end, Math.min(c.start + p.minDur, limit));
    c.end = Math.min(Math.max(end, c.words[c.words.length - 1].end), limit);
  });
  return cues;
}
const KINETIC = { maxWords: 5, maxChars: 30, maxDur: 3.2, hardGap: 0.5, target: 3, hold: 0.12, minDur: 0.6 };
const KARAOKE = { maxWords: 4, maxChars: 30, maxDur: 2.5, hardGap: 0.35, target: 3, hold: 0, minDur: 0.35 };

// ---------------------------------------------------------------- punch words
function punchText(cue, gl, lang) {
  const emph = new Set(EMPHASIS[lang === 'tl' ? 'tl' : 'en']), punch = new Set(gl.punch.map(keyOf));
  const words = cue.words, units = [];
  for (let i = 0; i < words.length;) {
    let j = i;
    if (words[i].termId) while (j + 1 < words.length && words[j + 1].termId === words[i].termId) j++;
    units.push({ i, j, w: words.slice(i, j + 1) });
    i = j + 1;
  }
  units.forEach((u, k) => {
    const w = u.w[0], key = u.w.map((x) => x.key).join('');
    let s = 0;
    if (u.w.some((x) => x.filler)) s = -1;
    else if (/\d/.test(w.core) || /^[$€£₱]/.test(w.core)) s = 10;
    else if (w.termId) s = 9;
    else if (punch.has(key)) s = 8;
    else if (emph.has(key)) s = 7;
    else if (WEAK.has(key)) s = 0.3;
    else if (!STOP.has(key) && key.length >= 4) s = 1 + key.length / 20;
    u.s = s;
  });
  const max = Math.min(3, Math.max(1, Math.floor(words.length / 4)));
  const pick = [];
  for (const u of units.filter((x) => x.s > 0).sort((a, b) => b.s - a.s)) {
    if (pick.length >= max) break;
    if (units.some((v) => pick.includes(v.i) && (v.j + 1 === u.i || u.j + 1 === v.i))) continue;       // never two neighbours
    pick.push(u.i);
  }
  const parts = [];
  for (const u of units) {
    const t = u.w.map(display).join(' ');
    parts.push(pick.includes(u.i) ? `*${t}*` : t);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------- fillers.json ranges
function fillerRanges(ws, mode) {
  const out = [];
  for (let wi = 0; wi < ws.length; wi++) {
    const w = ws[wi];
    if (!w.filler || w.fAction !== 'remove') continue;
    const prev = out[out.length - 1];
    const conf = w.source === 'aligned' ? 'high' : 'low';
    if (prev && prev.lastIdx === wi - 1 && w.start - prev.rawEnd < 0.05 && prev.kind === w.filler) { prev.lastIdx = wi; prev.rawEnd = Math.max(prev.rawEnd, w.end); if (w.fText !== prev.fText) prev.text += ' ' + w.core; if (conf === 'low') prev.confidence = 'low'; continue; }
    out.push({ lastIdx: wi, rawStart: w.start, rawEnd: w.end, text: w.fText, fText: w.fText, kind: w.filler, confidence: conf });
  }
  const ranges = [], tooShort = [];
  for (const r of out) {
    const start = r.rawStart + HANDLE, end = r.rawEnd - HANDLE;
    if (end - start < MIN_CUT) { tooShort.push(r); continue; }
    ranges.push({ start: r3(start), end: r3(end), text: r.text, kind: r.kind, confidence: r.confidence });
  }
  return { ranges, tooShort };
}

// ---------------------------------------------------------------- main
function main() {
  const o = parseArgs(process.argv.slice(2));
  let tr;
  try { tr = readTranscriptFile(o.input); } catch (e) { fail(e.message); }
  if (!tr.cues.length) fail('no cues found in ' + o.input);
  const gl = loadGlossary(o.glossary);
  let prefix = o.out || o.input.replace(/\.[^./\\]+$/, '');
  if (!o.out) {
    const rel = path.relative(ROOT, path.resolve(o.input));
    const inRepo = !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inRepo && !/^inputs[\\/]/.test(rel)) {
      prefix = path.join(ROOT, 'inputs', path.basename(o.input).replace(/\.[^.]+$/, ''));
      console.log('polish: the input is inside the repo, so outputs go to inputs/ (git-ignored) instead of next to it. Use --out to choose.');
    }
  }
  const notes = [];
  const warnings = [];

  // audio first when we need it (plain TXT has no timing at all)
  let rec = null, mediaDuration = null, islands = [];
  if (o.audio) {
    const t = transcribeAudio(o.audio, o.lang);
    mediaDuration = t.duration || null;
    if (t.error) {
      if (!tr.timed) fail('plain TXT has no timings and ' + t.error);
      warnings.push('Word alignment unavailable: ' + t.error + ' Falling back to interpolated word times.');
    } else { rec = t.words; islands = t.islands || []; }
  } else if (!tr.timed) fail('plain TXT has no timings: pass --audio <the video or audio file> so the words can be timed by transcription.');

  let cues = tr.cues;
  if (tr.timed) { const c = cleanCues(cues); cues = c.cues; notes.push(...c.notes); }
  else {
    // provisional times: spread the text over the recognised span by character count; alignment replaces them
    const t0 = rec[0].start, t1 = rec[rec.length - 1].end, total = cues.reduce((n, c) => n + c.text.length, 0);
    let acc = 0;
    cues = cues.map((c) => { const a = acc; acc += c.text.length; return { ...c, start: t0 + (t1 - t0) * (a / total), end: t0 + (t1 - t0) * (acc / total) }; });
  }
  const cueText = cues.map((c) => c.text);

  const allWords = cues.flatMap((c) => c.text.split(/\s+/));
  const lang = o.lang === 'auto' ? (allWords.filter((w) => TL_HINTS.has(keyOf(w))).length / Math.max(1, allWords.length) >= 0.12 ? 'tl' : 'en') : o.lang;
  const cfg = FILLERS[lang];

  // ---- text cleaning on the word stream
  const ops = [];
  const ws = tokenizeCues(cues);
  if (!ws.length) fail('the transcript has no words');
  applyGlossary(ws, gl, ops);
  detectFillers(ws, cfg, lang, ops);
  if (o.fillers === 'keep') for (const w of ws) if (w.filler && !isCleanup(w.filler)) { delete w.filler; delete w.fAction; delete w.fText; }
  if (o.numbers) convertNumbers(ws, ops);

  // ---- word timing
  let align = null;
  if (rec) {
    try { align = alignWords(ws, rec, islands); }
    catch (e) {
      if (!tr.timed) fail('could not align the TXT to the audio (' + e.message + '). A plain TXT has no timings of its own: split the audio into shorter parts or use an SRT.');
      warnings.push('Word alignment failed: ' + e.message + '. Falling back to interpolated word times.'); }
  }
  if (align && !tr.timed && !align.aligned) fail('could not align the TXT to the audio: no words matched. Is --audio the file the text was written for?');
  const alignedPct = align ? Math.round((align.aligned / ws.length) * 1000) / 10 : 0;
  const medDrift = align ? median(align.drift) : 0;
  if (align && tr.timed && medDrift > 0.5) warnings.push(`Aligned word times sit a median ${medDrift.toFixed(2)} s away from the transcript's cue times. The transcript and the audio may not be the same export.`);
  if (align && alignedPct < 60) warnings.push(`Only ${alignedPct}% of the words aligned: check that --audio is the file the transcript belongs to.`);

  // ---- captions text
  const stats = { punct: 0, caps: 0 };
  const capRate = cues.filter((c) => /^\p{Lu}/u.test(c.text)).length / cues.length;     // a transcript that capitalises every line says nothing
  const kept = finalise(ws, o.fillers, gl, stats, capRate < 0.8);
  if (!kept.length) fail('nothing left after cleaning');
  // glue: never break inside a glossary term or a number with its unit
  kept.forEach((w, k) => {
    const nx = kept[k + 1];
    w.glue = !!(nx && ((w.termId && w.termId === nx.termId) || (/^[$€£₱]?\d[\d,.]*%?$/.test(w.core) && UNIT_WORDS.has(nx.key) && !isTerminal(w.trail))));
  });

  const caps = o.mode === 'karaoke' ? phraseCues(kept, KARAOKE) : captionCues(kept);
  const kin = o.mode === 'karaoke' ? caps : phraseCues(kept, KINETIC);
  const srt = formatSrt(caps.map((c) => ({ start: c.start, end: c.end, text: c.lines ? c.lines.join('\n') : joinText(c.words) })));
  // `times`: the start of every word (absolute seconds). A kinetic-subtitle host with mode "cumulative" lands each word on its time,
  // so the caption builds as it is spoken. Written only when the text still has one token per word; `timing` says how good the times are.
  const cuesJson = kin.map((c) => {
    const text = punchText(c, gl, lang), row = { start: r3(c.start), end: r3(c.end), text };
    if (text.replace(/\*/g, '').split(/\s+/).filter(Boolean).length === c.words.length) {
      row.times = c.words.map((w) => r3(w.start));
      row.timing = c.words.every((w) => w.source === 'aligned') ? 'aligned' : 'interpolated';
    }
    return row;
  });

  // ---- fillers.json
  const { ranges, tooShort } = o.fillers === 'keep' ? { ranges: [], tooShort: [] } : fillerRanges(ws, o.fillers);
  const transcriptEnd = r3(Math.max(...ws.map((w) => w.end)));
  const fillersJson = { source: path.basename(o.input), handle: HANDLE, duration: mediaDuration ? r3(mediaDuration) : null, transcriptEnd, ranges };
  const wordsJson = ws.map((w) => {
    const row = { w: display(w), start: r3(w.start), end: r3(w.end), source: w.source };
    if (w.filler && (o.fillers !== 'keep' || isCleanup(w.filler))) row.filler = w.filler;
    if (isDropped(w, o.fillers)) row.dropped = true;
    return row;
  });

  fs.mkdirSync(path.dirname(path.resolve(prefix + '.x')), { recursive: true });
  fs.writeFileSync(prefix + '.polished.srt', srt);
  fs.writeFileSync(prefix + '.words.json', JSON.stringify(wordsJson, null, 2) + '\n');
  fs.writeFileSync(prefix + '.cues.json', JSON.stringify(cuesJson, null, 2) + '\n');
  fs.writeFileSync(prefix + '.fillers.json', JSON.stringify(fillersJson, null, 2) + '\n');

  // ---- report
  const count = (k) => ops.filter((x) => x.kind === k).length;
  const fillerOps = ops.filter((x) => x.kind.startsWith('filler:'));
  const byKind = {};
  for (const x of fillerOps) byKind[x.kind.slice(7)] = (byKind[x.kind.slice(7)] || 0) + 1;
  const review = [];
  for (const x of ops) if (x.review) review.push(`${mmss(x.t)}  ${x.review}`);
  if (align) for (const r of ranges.filter((r) => r.confidence === 'low')) review.push(`${mmss(r.start)}  filler "${r.text}" has an interpolated (low confidence) time: check the cut before using the cut list`);
  else if (ranges.length) review.push(`All ${ranges.length} filler ranges use interpolated times (no --audio): they are good to about a second, not 50 ms. Run with --audio before cutting.`);
  for (const r of tooShort) review.push(`${mmss(r.rawStart)}  filler "${r.text}" is shorter than ${MIN_CUT} s after handles: left out of the cut list`);
  if (align && tr.timed && medDrift > 0.5) review.push(`Transcript and audio disagree by a median ${medDrift.toFixed(2)} s`);

  // glossary candidates: capitalised words in the source text, mid-sentence, that the glossary does not know
  const known = new Set();
  for (const t of [...gl.terms, ...Object.values(gl.fixes)]) { known.add(keyOf(t)); t.split(/\s+/).forEach((x) => known.add(keyOf(x))); }
  const cand = new Map();
  for (const t of cueText) {
    const toks = t.split(/\s+/).filter(Boolean);
    let run = [];
    const flush = () => { if (run.length) { const name = run.join(' '); if (!known.has(keyOf(name)) && !run.every((x) => known.has(keyOf(x)))) cand.set(name, (cand.get(name) || 0) + 1); } run = []; };
    toks.forEach((tk, k) => {
      const core = tk.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const sentenceStart = k === 0 || /[.?!]["')\]]*$/.test(toks[k - 1]);
      if (core && /^\p{Lu}/u.test(core) && !/^I('|$)/.test(core) && !STOP.has(keyOf(core)) && (!sentenceStart || run.length)) run.push(core);
      else flush();
      if (/[.?!,;:]$/.test(tk)) flush();
    });
    flush();
  }

  const L = [];
  L.push('# Polish report', '', `- Input: \`${path.basename(o.input)}\` (${tr.kind.toUpperCase()}, ${tr.cues.length} cues)`,
    `- Glossary: ${gl.file ? '`' + path.relative(ROOT, gl.file).split(path.sep).join('/') + '`' : 'none'} (${gl.terms.length} terms, ${Object.keys(gl.fixes).length} fixes, ${gl.punch.length} punch words)`,
    `- Language: ${lang}, mode: ${o.mode}, fillers: ${o.fillers}, numbers: ${o.numbers ? 'on' : 'off'}`,
    `- Output: ${caps.length} caption cues, ${cuesJson.length} kinetic cues`, '');
  L.push('## Counts', '',
    `- Glossary fixes: ${count('glossary')}, term casing: ${count('term-case')}, fuzzy term matches: ${count('fuzzy-term')}`,
    `- Fillers found: ${fillerOps.length} (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}); ${fillerOps.filter((x) => x.w && x.w.fAction === 'remove').length} removable, ${fillerOps.filter((x) => x.w && x.w.fAction === 'flag').length} flag-only; ${ranges.length} cut ranges after handles and merging`,
    `- Numbers converted: ${count('number')}`,
    `- Sentence starts / "I" capitalised: ${stats.caps}, terminal punctuation added: ${stats.punct}`,
    `- Timing cleanups: ${notes.length}`,
    `- Word times: ${align ? `${alignedPct}% aligned to the audio (${align.aligned}/${ws.length}), ${r3(100 - alignedPct)}% interpolated; ${align.moved} words re-timed onto the voiced stretches of the audio` : '100% interpolated inside each cue (no --audio): good to about half a second'}`, '');
  L.push('## Needs your review', '');
  L.push(...(review.length ? review.map((r) => '- ' + r) : ['- Nothing flagged.']), '');
  if (warnings.length) L.push('## Warnings', '', ...warnings.map((x) => '- ' + x), '');
  L.push('## Possible terms to add to the glossary', '');
  L.push(...(cand.size ? [...cand].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k} (${n}x)`) : ['- None found (names that are all lower-case in the transcript cannot be detected).']), '');
  L.push('## Every change, as before -> after', '');
  const byCue = new Map();
  for (const x of ops) { if (!byCue.has(x.cue)) byCue.set(x.cue, []); byCue.get(x.cue).push(x); }
  const afterByCue = new Map();
  for (const w of kept) afterByCue.set(w.cue, (afterByCue.get(w.cue) ? afterByCue.get(w.cue) + ' ' : '') + display(w));
  let changed = 0;
  cues.forEach((c, i) => {
    const after = afterByCue.get(i) || '', before = cueText[i];
    if (after === before) return;
    changed++;
    L.push(`${mmss(c.start)}  ${before} -> ${after || '(removed)'}`);
    for (const x of byCue.get(i) || []) {
      const to = x.w ? (isDropped(x.w, o.fillers) ? (x.after ? `"${x.after}"` : 'removed') : 'kept, flagged') : `"${x.after}"`;
      L.push(`    - ${x.kind}: "${x.before}" -> ${to}`);
    }
  });
  if (!changed) L.push('No cue changed.');
  if (notes.length) { L.push('', '### Timing cleanups', ''); for (const n of notes) L.push(`- ${mmss(n.t)}  ${n.text}`); }
  L.push('');
  fs.writeFileSync(prefix + '.polish-report.md', L.join('\n'));

  // ---- summary
  const rel = (f) => path.relative(process.cwd(), f) || f;
  console.log(`\npolished ${o.input}: ${tr.cues.length} cues -> ${caps.length} ${o.mode} cues, language ${lang}`);
  console.log(`  glossary ${count('glossary') + count('term-case') + count('fuzzy-term')} fixes, fillers ${fillerOps.length} (${ranges.length} cut ranges), numbers ${count('number')}, ` +
    (align ? `aligned ${alignedPct}%` : 'times interpolated (not aligned to audio)') + `, ${review.length} to review`);
  for (const w of warnings) console.warn('polish: warning: ' + w);
  for (const f of ['.polished.srt', '.words.json', '.cues.json', '.fillers.json', '.polish-report.md']) console.log('wrote ' + rel(prefix + f));
  console.log('\nnext:');
  console.log(`  npm run plan -- ${rel(prefix + '.polished.srt')} --mode screen`);
  console.log(`  npm run trim -- <voice file> --cut-list ${rel(prefix + '.fillers.json')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
