#!/usr/bin/env node
// Chapters for a long video, from its transcript. Finds where the topic changes (spoken markers like "step two" or "moving on",
// long pauses, a change of vocabulary), proposes chapters with titles, and writes everything you need around them:
//
//   node scripts/chapters.mjs <transcript.srt|.vtt> [--min 60] [--max 14] [--out <prefix>] [--title "Video title"]
//
//   --min     shortest chapter in seconds (default 60)
//   --max     most chapters (default: about one per 2 minutes, at most 14)
//   --out     output prefix; default inputs/<name> (git-ignored)
//
// Writes <out>.chapters.json, <out>.chapters.txt (paste into a YouTube description: first line 0:00, 3+ chapters, 10 s+ each),
// <out>.pill.json (the `steps` and `schedule` for the chapter-pill template) and <out>.chapters.md (the review sheet: the
// cold-open check, recap points and pattern-interrupt slots). Titles from a spoken marker are real words; titles from keywords
// are GUESSES and are marked "review". Times come from the transcript: use the polished one (npm run polish) with word times.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error('chapters: ' + m); process.exit(1); };
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const valueIdx = new Set(['--min', '--max', '--out', '--title'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const input = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i));
if (!input) fail('usage: node scripts/chapters.mjs <transcript.srt|.vtt> [--min 60] [--max 14] [--out prefix] [--title "..."]');
const MIN = +val('--min', 60);
if (!(MIN >= 10)) fail('--min must be at least 10 seconds');
const file = fs.existsSync(input) ? path.resolve(input) : path.join(ROOT, input);
if (!fs.existsSync(file)) fail('file not found: ' + input);

// ---------------------------------------------------------------- transcript
const TIME = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})|(\d\d):(\d\d)[,.](\d{1,3})/;
const secs = (m) => m[1] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : +m[5] * 60 + +m[6] + +m[7].padEnd(3, '0') / 1000;
const cues = [];
for (const block of fs.readFileSync(file, 'utf8').replace(/\r/g, '').split(/\n\s*\n/)) {
  const lines = block.split('\n').filter((l) => l.trim());
  const k = lines.findIndex((l) => l.includes('-->'));
  if (k < 0) continue;
  const [l, r] = lines[k].split('-->'), a = l.match(TIME), z = r && r.match(TIME);
  if (!a || !z) continue;
  const text = lines.slice(k + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  if (text) cues.push({ start: secs(a), end: secs(z), text });
}
cues.sort((a, b) => a.start - b.start);
if (cues.length < 5) fail('too few cues in the transcript (' + cues.length + ')');
const total = cues[cues.length - 1].end;
if (total < 3 * MIN) fail(`the video is ${Math.round(total)} s; chapters need at least 3 x ${MIN} s. Use --min ${Math.max(10, Math.floor(total / 4))} or a longer transcript`);


// ---------------------------------------------------------------- boundary scores
const NUM = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|next|last|final)';
const STRONG = new RegExp(`^(?:(?:ok(?:ay)?|alright|so)[,.]?\\s+)?(?:step\\s+${NUM}|number\\s+${NUM}|part\\s+${NUM}|tip\\s+${NUM}|moving on|move on|the next (?:thing|part|step|section)|next up|let's (?:move|go) (?:on|to|into)|on to|now for|finally|last but not least)\\b`, 'i');
const MEDIUM = /^(?:(?:ok(?:ay)?|alright|so)[,.]?\s+)?(?:now,?\s+(?:let's|we|i'?ll|it's)|let's (?:talk|look|see|start|dive|get)|first(?:ly)?[, ]|second(?:ly)?[, ]|third(?:ly)?[, ]|next,|then,|here's (?:how|the|what))/i;
const WEAK = /^(?:ok(?:ay)?|alright|so|now|right)[,.!]?\s/i;
const STOP = new Set('a an the and or but if then so to of in on at for with from by as is are was were be been it its this that these those i you we they he she my your our their me us them do does did have has had not no yes can could will would should just really very like um uh you know about into out up down over than too also there here what when where which who how why all any some more most other such only own same so than very s t don doesn isn wasn aren let get got going gonna want need make makes made one two thing things way okay ok yeah right well actually basically'.split(' '));
const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const bag = (a, b) => { const m = new Map(); for (const c of cues) if (c.start >= a && c.start < b) for (const w of words(c.text)) m.set(w, (m.get(w) || 0) + 1); return m; };
const jaccard = (A, B) => { let i = 0; for (const k of A.keys()) if (B.has(k)) i++; const u = A.size + B.size - i; return u ? 1 - i / u : 0; };

const strongCount = cues.filter((c) => STRONG.test(c.text)).length;
// default cap: about one chapter per 2 minutes, but never fewer than the spoken markers say there are
const MAXC = Math.min(14, Math.max(3, +val('--max', Math.max(Math.round(total / 120), strongCount + 1))));

const cand = cues.map((c, i) => {
  let s = 0, why = [], title = null;
  const gap = i ? c.start - cues[i - 1].end : 0;
  if (STRONG.test(c.text)) { s += 3; why.push('spoken marker'); title = c.text; }
  else if (MEDIUM.test(c.text)) { s += 2; why.push('topic phrase'); title = c.text; }
  else if (WEAK.test(c.text)) { s += 0.5; }
  if (gap >= 3) { s += 2; why.push(`${gap.toFixed(1)} s pause`); } else if (gap >= 1.5) { s += 1; why.push(`${gap.toFixed(1)} s pause`); }
  const d = jaccard(bag(c.start - 40, c.start), bag(c.start, c.start + 40));
  if (c.start > 40 && c.start < total - 40 && d > 0.88) { s += 1.5; why.push('vocabulary shift'); } else if (d > 0.8 && c.start > 40) s += 0.5;
  return { i, t: c.start, s, why, title };
});

// pick the best boundaries: highest score first, no two closer than MIN seconds, never the first MIN seconds or the last MIN seconds as a start
const picked = [{ i: 0, t: cues[0].start < 1 ? 0 : cues[0].start, s: 99, why: ['start'], title: null }];
for (const c of cand.slice().sort((a, b) => b.s - a.s || a.t - b.t)) {
  if (picked.length >= MAXC) break;
  if (c.s < 2 || c.t < MIN || c.t > total - MIN) continue;
  if (picked.some((p) => Math.abs(p.t - c.t) < MIN)) continue;
  picked.push(c);
}
picked.sort((a, b) => a.t - b.t);
picked[0].t = 0;
if (picked.length < 3) {
  // too few real signals: fall back to even splits at the nearest pause, and say so
  const n = Math.max(3, Math.round(total / 150));
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    const best = cand.filter((c) => c.t > MIN && c.t < total - MIN && !picked.some((p) => Math.abs(p.t - c.t) < MIN)).sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target))[0];
    if (best) picked.push({ ...best, why: [...best.why, 'even split (no spoken marker found)'], s: 0 });
  }
  picked.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- titles
const Title = (s) => s.replace(/\b([a-z])([a-z']*)/g, (m, a, b) => ['and', 'or', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with'].includes(m) ? m : a.toUpperCase() + b);
const df = new Map(); const chBags = picked.map((p, k) => bag(p.t, k + 1 < picked.length ? picked[k + 1].t : total + 1));
for (const b of chBags) for (const w of b.keys()) df.set(w, (df.get(w) || 0) + 1);
const chapters = picked.map((p, k) => {
  const end = k + 1 < picked.length ? picked[k + 1].t : total;
  let title, source;
  if (p.title && k > 0) {
    {
      // "Step one. Connect the inbox." -> "Step one: connect the inbox"; "Moving on. Build the pipeline." -> "Build the pipeline"
      const sent = p.title.replace(/^(?:ok(?:ay)?|alright|so)[,.]?\s+/i, '').split(/(?<=[.!?])\s+/).filter(Boolean);
      const lead = sent[0] ? sent[0].replace(/[.,!?;:]+$/, '') : '';
      if (sent.length > 1 && lead.split(/\s+/).length <= 4) title = /^(?:step|number|part|tip)\b/i.test(lead) ? `${lead}: ${sent[1].replace(/[.,!?;:]+$/, '')}` : sent[1].replace(/[.,!?;:]+$/, '');
      else title = lead.replace(/^(?:now,?\s+|let's\s+|here's\s+)/i, '');
    }
    { const w = title.split(/\s+/).slice(0, 7); while (w.length > 2 && /^(?:a|an|the|that|and|or|to|of|in|on|for|with|so|then|we|you|i|it|is|are)$/i.test(w[w.length - 1])) w.pop(); title = w.join(' '); }
    source = 'spoken';
  } else {
    const scored = [...chBags[k]].map(([w, n]) => [w, n * Math.log(1 + picked.length / (df.get(w) || 1))]).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
    title = scored.length ? scored.join(' and ') : 'Part ' + (k + 1); source = 'keywords';
  }
  if (k === 0) { title = 'Intro'; source = 'default'; }
  return { n: k + 1, t: Math.round(p.t * 10) / 10, end: Math.round(end * 10) / 10, dur: Math.round((end - p.t) * 10) / 10, title: Title(title), titleSource: source, review: source === 'keywords' || (source === 'spoken' && !STRONG.test(p.title || '')), why: p.why.join(', ') || 'even split' };
});

// ---------------------------------------------------------------- outputs
const stamp = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const prefix = val('--out', null) || (file.startsWith(ROOT + path.sep) ? path.join(ROOT, 'inputs', path.basename(file).replace(/\.[^.]+$/, '')) : file.replace(/\.[^.]+$/, ''));
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');
fs.writeFileSync(prefix + '.chapters.json', JSON.stringify({ source: path.basename(file), seconds: Math.round(total * 10) / 10, chapters }, null, 2) + '\n');
fs.writeFileSync(prefix + '.chapters.txt', chapters.map((c) => `${stamp(c.t)} ${c.title}`).join('\n') + '\n');
const badges = chapters.length <= 6;
fs.writeFileSync(prefix + '.pill.json', JSON.stringify({
  steps: badges ? chapters.slice(1).map((c, i) => String(i + 1).padStart(2, '0')) : [],
  initialLabel: chapters[0].title,
  schedule: chapters.slice(1).map((c, i) => ({ t: c.t, step: badges ? i + 1 : 0, label: c.title }))
}, null, 2) + '\n');

// review sheet: cold open, recap points, pattern-interrupt slots
const L = [`# Chapters: ${path.basename(file)}`, '', `- Length: ${stamp(total)} (${Math.round(total)} s), ${cues.length} cues, ${chapters.length} chapters`, `- Titles marked **review** are keyword guesses: rename them before they go on screen or in a description.`, '', '## Chapters', '', '| # | Time | Length | Title | Why here |', '|---|---|---|---|---|'];
for (const c of chapters) L.push(`| ${c.n} | ${stamp(c.t)} | ${stamp(c.dur)} | ${c.title}${c.review ? ' **(review)**' : ''} | ${c.why} |`);
const issues = [];
if (chapters.length < 3) issues.push('Fewer than 3 chapters: YouTube will not show them.');
chapters.forEach((c) => { if (c.dur < 10) issues.push(`Chapter ${c.n} is under 10 s: YouTube needs 10 s or more.`); if (c.dur > 360) issues.push(`Chapter ${c.n} (${c.title}) runs ${stamp(c.dur)}: add a sub-chapter or plan pattern interrupts in it.`); });
const first30 = cues.filter((c) => c.start < 30).map((c) => c.text).join(' ');
const hook = [];
if (/^\s*(hi|hey|hello|what'?s up|welcome|good (morning|afternoon|evening)|my name is)\b/i.test(first30)) hook.push('The video opens with a greeting. For a long video, say what the viewer will get (and the result) in the first 15 to 30 s, then greet.');
if (!/\b(you'?ll|you will|by the end|in this video|today|learn|show you|going to|how to|here'?s)\b/i.test(first30)) hook.push('The first 30 s never says what the viewer will get. Add a promise: "by the end you will have ...".');
if (!/\d|\b(result|mistake|secret|faster|easier|without|never|stop)\b/i.test(first30)) hook.push('No concrete result or number in the first 30 s: a specific outcome holds people better than a topic.');
L.push('', '## Cold open (first 30 s)', '', ...(hook.length ? hook.map((h) => '- ' + h) : ['- Looks fine: it names what the viewer gets.']), '', `First 30 s: "${first30.slice(0, 220)}${first30.length > 220 ? '...' : ''}"`);
L.push('', '## Recap points', '', 'A 5 s spoken recap (one line, optionally the checklist block) at the end of long chapters keeps people oriented:');
const recaps = chapters.filter((c) => c.dur >= 240 || c.n === chapters.length);
L.push(...(recaps.length ? recaps.map((c) => `- end of chapter ${c.n} "${c.title}" at about ${stamp(c.end - 8)}`) : ['- No chapter is long enough to need one.']));
const slots = []; for (let t = 45; t < total - 20; t += 45) { const c = cues.find((x) => x.start >= t); if (c && !chapters.some((ch) => Math.abs(ch.t - c.start) < 6)) slots.push(c); }
L.push('', '## Pattern-interrupt slots', '', 'Nothing in the transcript changes the picture for 45 s at a time. At these cue starts, fill the slot with a zoom, a card, a cutaway or a punch-in (skip it where the screen is already moving):', '', ...slots.map((c) => `- ${stamp(c.start)}  "${c.text.slice(0, 60)}"`));
if (issues.length) L.push('', '## Fix before publishing', '', ...issues.map((x) => '- ' + x));
fs.writeFileSync(prefix + '.chapters.md', L.join('\n') + '\n');

console.log(`${path.basename(file)}: ${stamp(total)}, ${chapters.length} chapters`);
for (const c of chapters) console.log(`  ${stamp(c.t).padStart(7)}  ${c.title}${c.review ? '  (review: keyword guess)' : ''}`);
for (const i of issues) console.log('  fix  ' + i);
for (const h of hook) console.log('  open ' + h);
for (const e of ['.chapters.txt', '.chapters.json', '.pill.json', '.chapters.md']) console.log('wrote ' + rel(prefix + e));
