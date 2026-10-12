#!/usr/bin/env node
// Audio finishing for a rendered video: measure loudness, clean the voice, mix a music bed that ducks under it, and normalise to a
// target loudness. The picture is copied, never re-encoded; the original file is never touched.
//
//   node scripts/audio.mjs <video.mp4> [--out <file>] [--lufs -14] [--tp -1.5] [--denoise] [--music <audio file>] [--music-db -24]
//                          [--duck 8] [--dry-run]
//
//   --lufs      target integrated loudness (default -14, the level YouTube and most feeds normalise to)
//   --tp        true-peak ceiling in dBTP (default -1.5)
//   --denoise   high-pass at 70 Hz (rumble) and FFT noise reduction on the voice before anything else
//   --music     a music bed to mix under the voice; it loops to the length of the video and is faded in and out
//   --music-db  music level before ducking, relative to the voice (default -24 dB)
//   --duck      how hard the music drops while you speak, ratio 2-20 (default 8)
//   --dry-run   measure and print the plan, write nothing
// Default output: <video>.audio.mp4 next to the input. Needs ffmpeg. Measures with ffmpeg's ebur128/loudnorm (two passes, so the
// result lands within about 0.5 LU of the target). What it cannot do: remove music or speech from the original, fix clipping that
// is already baked in, or judge whether it SOUNDS good. Listen to it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const fail = (m) => { console.error('audio: ' + m); process.exit(1); };
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flagIdx = new Set(['--out', '--lufs', '--tp', '--music', '--music-db', '--duck'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const input = args.find((a, i) => !a.startsWith('--') && !flagIdx.has(i));
if (!input) fail('usage: node scripts/audio.mjs <video.mp4> [--out file] [--lufs -14] [--tp -1.5] [--denoise] [--music file] [--music-db -24] [--duck 8] [--dry-run]');
const LUFS = +val('--lufs', -14), TP = +val('--tp', -1.5), MUSIC_DB = +val('--music-db', -24), DUCK = +val('--duck', 8);
const DENOISE = args.includes('--denoise'), DRY = args.includes('--dry-run');
const music = val('--music', null);
if (!(LUFS <= -5 && LUFS >= -30)) fail('--lufs must be between -30 and -5');
if (!(TP <= 0 && TP >= -9)) fail('--tp must be between -9 and 0');
if (!(DUCK >= 2 && DUCK <= 20)) fail('--duck must be between 2 and 20');
if (!fs.existsSync(input)) fail('file not found: ' + input);
if (music && !fs.existsSync(music)) fail('music file not found: ' + music);
const out = val('--out', null) || input.replace(/(\.[^.]+)?$/, '.audio.mp4');
if (path.resolve(out) === path.resolve(input)) fail('the output would overwrite the input; choose another --out');

const ff = (a) => spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (ff(['-version']).error) fail('ffmpeg not found on PATH (macOS: brew install ffmpeg, Windows: winget install ffmpeg)');
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', input], { encoding: 'utf8' });
const streams = (JSON.parse(probe.stdout || '{}').streams || []);
if (!streams.some((s) => s.codec_type === 'audio')) fail('the video has no audio track');
const hasVideo = streams.some((s) => s.codec_type === 'video');
const dur = Math.max(...streams.map((s) => +s.duration || 0));

// the voice chain, then (with music) the ducked mix; loudnorm last so it measures what will be heard
const voice = [DENOISE ? 'highpass=f=70,afftdn=nf=-25' : null].filter(Boolean).join(',');
function graph(norm) {
  const ln = norm || `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`;
  if (!music) return { fc: `[0:a]${voice ? voice + ',' : ''}aresample=48000,${ln}[a]`, inputs: ['-i', input] };
  const fade = Math.min(2, dur / 6).toFixed(2);
  return {
    inputs: ['-i', input, '-stream_loop', '-1', '-i', music],
    fc: `[0:a]${voice ? voice + ',' : ''}aresample=48000,${voiceLevel},asplit=2[v][sc];` +
      `[1:a]aresample=48000,volume=${MUSIC_DB}dB,atrim=0:${dur.toFixed(2)},afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, dur - +fade).toFixed(2)}:d=${fade}[m];` +
      `[m][sc]sidechaincompress=threshold=0.03:ratio=${DUCK}:attack=20:release=450[md];` +
      `[v][md]amix=inputs=2:duration=first:normalize=0,${ln}[a]`
  };
}
const parseJson0 = null;
const parseJson = (s) => { const m = s.match(/\{[^{}]*"input_i"[^{}]*\}/); return m ? JSON.parse(m[0]) : null; };

// With music, level the VOICE alone first (to -16 LUFS), so the ducking threshold means the same thing for a quiet or a loud recording.
let voiceLevel = '';
if (music) {
  const pv = ff(['-i', input, '-af', `${voice ? voice + ',' : ''}aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, '-vn', '-f', 'null', '-']);
  const mv = parseJson(pv.stderr || '');
  if (!mv) fail('could not measure the voice');
  voiceLevel = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${mv.input_i}:measured_TP=${mv.input_tp}:measured_LRA=${mv.input_lra}:measured_thresh=${mv.input_thresh}:offset=${mv.target_offset}:linear=true`;
}

// pass 1: measure what the chain produces
const g1 = graph();
const p1 = ff([...g1.inputs, '-filter_complex', g1.fc, '-map', '[a]', '-t', String(dur), '-f', 'null', '-']);
const m = parseJson(p1.stderr || '');
if (p1.status !== 0 || !m) fail('could not measure the audio:\n' + (p1.stderr || '').split('\n').slice(-6).join('\n'));
// the unprocessed original, for the before/after
const before = parseJson((ff(['-i', input, '-af', `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`, '-vn', '-f', 'null', '-']).stderr) || '');
const num = (x) => (x === undefined || x === null ? NaN : +x);
console.log(`${path.basename(input)}  ${dur.toFixed(1)} s`);
if (before) console.log(`  before   ${num(before.input_i).toFixed(1)} LUFS   true peak ${num(before.input_tp).toFixed(1)} dBTP   range ${num(before.input_lra).toFixed(1)} LU`);
console.log(`  plan     ${DENOISE ? 'high-pass 70 Hz + noise reduction, ' : ''}${music ? `music ${MUSIC_DB} dB ducking x${DUCK}, ` : ''}two-pass normalise to ${LUFS} LUFS / ${TP} dBTP`);
if (Math.abs(num(m.input_i) - LUFS) < 0.3 && !music && !DENOISE) console.log('  note     already within 0.3 LU of the target; nothing to do');
if (num(before && before.input_tp) > -0.5) console.log('  warn     the original peaks at ' + num(before.input_tp).toFixed(1) + ' dBTP: if it is distorted, normalising cannot repair it');
if (DRY) { console.log('  dry run: nothing written'); process.exit(0); }

// pass 2: apply with the measured values (linear when it can be)
const norm = `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
const g2 = graph(norm);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const tmp = out.replace(/(\.[^.]+)?$/, '.part$1');
const p2 = ff(['-y', ...g2.inputs, '-filter_complex', g2.fc, '-map', '[a]', ...(hasVideo ? ['-map', '0:v', '-c:v', 'copy'] : []), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(dur), '-movflags', '+faststart', tmp]);
if (p2.status !== 0) { fs.rmSync(tmp, { force: true }); fail('the render failed:\n' + (p2.stderr || '').split('\n').slice(-6).join('\n')); }
fs.renameSync(tmp, out);

// verify the file we wrote, not the plan
const after = parseJson(ff(['-i', out, '-af', `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`, '-vn', '-f', 'null', '-']).stderr || '');
if (after) {
  const off = num(after.input_i) - LUFS;
  console.log(`  after    ${num(after.input_i).toFixed(1)} LUFS   true peak ${num(after.input_tp).toFixed(1)} dBTP   range ${num(after.input_lra).toFixed(1)} LU`);
  console.log(Math.abs(off) <= 1 ? `  ok       within ${Math.abs(off).toFixed(1)} LU of ${LUFS}` : `  WARN     ${off.toFixed(1)} LU from the target (very quiet or very dynamic material cannot be raised without clipping)`);
}
console.log('wrote ' + out + '\nListen to it: numbers cannot tell you whether the music masks a word.');
