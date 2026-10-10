// Shared transcript helpers: parse / format SRT, VTT and plain TXT, clean up cue timing, and align two word lists.
// Used by scripts/polish.mjs. Pure functions, no I/O except readTranscriptFile.
//
//   readTranscriptFile(file)  -> { kind: 'srt' | 'vtt' | 'txt', cues: [{ start, end, text }], timed }   (TXT cues have no start / end)
//   parseSubtitles(raw)       -> cues from SRT / VTT text (BOM, CRLF, tags, multi-line cues, "," or "." millis, h:mm:ss)
//   parseTxt(raw)             -> [{ text }] one per paragraph (blank-line separated) or per line
//   cleanCues(cues)           -> { cues, notes }   fixes overlaps and zero / negative lengths, merges duplicates
//   formatSrt(cues)           -> SRT text
//   alignSequences(a, b)      -> for every key in a, { j, sim } (matched index in b) or null   (Needleman-Wunsch)
import fs from 'node:fs';
import { normalizeQuotes } from '../cue-rules.mjs';

export { normalizeQuotes };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const secs = (m) => (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;

export const r3 = (v) => Math.round(v * 1000) / 1000;
export const pad2 = (n) => String(n).padStart(2, '0');

// "01:05" style stamp for reports
export function mmss(t) {
  const s = Math.max(0, Math.floor(t + 1e-6));
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}

export function formatSrtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  return pad2(Math.floor(ms / 3600000)) + ':' + pad2(Math.floor(ms / 60000) % 60) + ':' + pad2(Math.floor(ms / 1000) % 60) + ',' + String(ms % 1000).padStart(3, '0');
}

export const normalizeSpaces = (s) => String(s).replace(/[ ​ ]/g, ' ').replace(/\s+/g, ' ').trim();

export function cleanText(s) {
  return normalizeSpaces(normalizeQuotes(s).replace(/<\/?(?:i|b|u|font|c|v|ruby|rt|lang)(?:[.\s][^<>]*)?>/gi, '').replace(/<\d+:\d\d(?::\d\d)?[.,]\d+>/g, '').replace(/\{\\[^}]*\}/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
}

export function parseSubtitles(raw) {
  const blocks = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;                                   // WEBVTT header, NOTE, STYLE, stray numbers
    const [l, r] = lines[k].split('-->');
    const a = l.match(TIME), z = r && r.match(TIME);
    if (!a || !z) continue;
    const text = cleanText(lines.slice(k + 1).join(' '));
    if (text) cues.push({ start: secs(a), end: secs(z), text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

// Plain text: paragraphs when there are blank lines, otherwise one cue per line. No timing.
export function parseTxt(raw) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const parts = /\n\s*\n/.test(text) ? text.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ')) : text.split('\n');
  return parts.map((p) => cleanText(p)).filter(Boolean).map((t) => ({ text: t }));
}

export function readTranscriptFile(file) {
  if (!fs.existsSync(file)) throw new Error('file not found: ' + file);
  const raw = fs.readFileSync(file, 'utf8');
  const ext = file.toLowerCase().match(/\.([a-z0-9]+)$/);
  const looksTimed = /-->/.test(raw);
  if (looksTimed) return { kind: /^\s*﻿?WEBVTT/i.test(raw) || (ext && ext[1] === 'vtt') ? 'vtt' : 'srt', cues: parseSubtitles(raw), timed: true };
  if (ext && (ext[1] === 'srt' || ext[1] === 'vtt')) throw new Error(file + ' has no "-->" timing lines: is it really an SRT / VTT file?');
  return { kind: 'txt', cues: parseTxt(raw), timed: false };
}

const normKey = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Fix overlaps, zero / negative lengths and duplicate cues. Cues must be timed.
export function cleanCues(input) {
  const notes = [];
  const cues = input.filter((c) => c.text).map((c) => ({ ...c })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of cues) {
    if (!(c.end > c.start)) {
      const was = c.end;
      c.end = c.start + Math.min(3, Math.max(0.4, c.text.length * 0.06));
      notes.push({ t: c.start, text: `cue "${c.text.slice(0, 30)}" had length ${r3(was - c.start)} s, set to ${r3(c.end - c.start)} s` });
    }
    const p = out[out.length - 1];
    if (p) {
      if (normKey(p.text) === normKey(c.text) && c.start - p.end < 0.5) {
        p.end = Math.max(p.end, c.end);
        notes.push({ t: c.start, text: `merged duplicate cue "${c.text.slice(0, 40)}"` });
        continue;
      }
      if (c.start < p.end) {
        const ov = p.end - c.start;
        if (p.start + 0.2 <= c.start) p.end = c.start;                 // trim the earlier cue back
        else c.start = Math.min(p.end, c.end - 0.05);                  // earlier cue is tiny: push this one later
        notes.push({ t: c.start, text: `fixed ${r3(ov)} s overlap before "${c.text.slice(0, 30)}"` });
      }
    }
    out.push(c);
  }
  return { cues: out, notes };
}

export function formatSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`).join('\n');
}

// ---------- word alignment ----------
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// 1 = same, 0 = unrelated. Short words must match exactly.
export function tokenSim(a, b) {
  if (a === b) return 1;
  const L = Math.max(a.length, b.length);
  if (L < 4 || Math.min(a.length, b.length) < 3 || L - Math.min(a.length, b.length) > 0.4 * L) return 0;
  if (a[0] !== b[0] && a[a.length - 1] !== b[b.length - 1]) return 0;     // cheap prune: near matches share an end letter
  const s = 1 - levenshtein(a, b) / L;
  return s >= 0.6 ? s : 0;
}

// Needleman-Wunsch over two normalised token lists. Substitutions are cheaper than two gaps, so a misheard word
// between two good anchors stays in place. Returns for each a[i]: { j, sim } if it pairs with a recognisably similar
// b[j] (sim >= 0.6), else null. O(n*m) time and memory (1 byte of trace + 4 bytes of score per cell).
export function alignSequences(a, b) {
  const n = a.length, m = b.length, W = m + 1;
  if (!n || !m) return a.map(() => null);
  if (n * m > 60e6) throw new Error(`transcript too long to align (${n} x ${m} words)`);
  const GAP = -1, MISS = -1.5;
  const score = new Float32Array((n + 1) * W), tr = new Uint8Array((n + 1) * W);   // tr: 1 diag, 2 up (gap in b), 3 left (gap in a)
  // banded DP: only cells within `band` of the diagonal are filled (the two lists describe the same speech, so they stay close)
  const band = Math.abs(n - m) + Math.max(300, Math.ceil(0.15 * Math.max(n, m)));
  if (band * 2 < Math.max(n, m)) score.fill(-1e9);
  for (let i = 1; i <= n; i++) { score[i * W] = i * GAP; tr[i * W] = 2; }
  for (let j = 1; j <= m; j++) { score[j] = j * GAP; tr[j] = 3; }
  for (let i = 1; i <= n; i++) {
    const c = (i * m) / n, lo = Math.max(1, Math.floor(c - band)), hi = Math.min(m, Math.ceil(c + band));
    for (let j = lo; j <= hi; j++) {
      const s = tokenSim(a[i - 1], b[j - 1]);
      const diag = score[(i - 1) * W + j - 1] + (s >= 0.6 ? 3 * s * s : MISS);
      const up = score[(i - 1) * W + j] + GAP, left = score[i * W + j - 1] + GAP;
      let best = diag, t = 1;
      if (up > best) { best = up; t = 2; }
      if (left > best) { best = left; t = 3; }
      score[i * W + j] = best; tr[i * W + j] = t;
    }
  }
  const out = a.map(() => null);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const t = tr[i * W + j];
    if (i > 0 && j > 0 && t === 1) {
      const s = tokenSim(a[i - 1], b[j - 1]);
      if (s >= 0.6) out[i - 1] = { j: j - 1, sim: s };
      i--; j--;
    } else if (i > 0 && (t === 2 || j === 0)) i--;
    else j--;
  }
  return out;
}
