// Colour looks for scripts/grade.mjs, as data. Each look = { name, intent, filter(strength) -> ffmpeg filter string }.
//
// A look is a small set of parameters (see PARAM_KEYS) that describe a delta from "no change". filter(strength)
// scales every delta by the strength (0 = untouched, 1 = the full look) and renders it as ffmpeg filters. Scaling the
// parameters, instead of blending a graded copy over the original, keeps one pass over the frames, makes the result at
// 0.4 exactly "40 % of the way" on every control, and lets the skin guard reason about a single transform.
//
// The filters run on 16-bit planar RGB (grade.mjs converts to and from the file's YUV with its own colour matrix):
//   curves          one monotone (pchip) curve per channel: contrast, lift, fade, and the tints
//   colorchannelmixer   saturation
// Tints are applied with soft weights that overlap SKIN LESS than ffmpeg's own colorbalance does: colorbalance's
// "highlights" zone starts around 40 % luma, which is exactly where lit skin sits, so a cyan highlight tint turns skin
// cyan. Here the shadow weight is gone by 42 % luma and the highlight weight only starts at 72 %.
//
// Offsets are fractions of full scale at the weight's peak (0.02 = 2 % of the range).

export const DEFAULT_LOOK = 'clean';

const NEUTRAL = { contrast: 1, lift: 0, white: 1, sat: 1, shadow: [0, 0, 0], mid: [0, 0, 0], high: [0, 0, 0] };

export const LOOKS = {
  none: {
    name: 'none',
    intent: 'Correction only: white balance and exposure, no stylistic grade.',
    filter: () => '',
  },
  clean: {
    name: 'clean',
    intent: 'Neutral and crisp: a touch more contrast and saturation, no colour cast.',
    params: { contrast: 1.06, sat: 1.05 },
  },
  'warm-daylight': {
    name: 'warm-daylight',
    intent: 'Gentle warm highlights over lifted shadows, so skin reads like soft window light.',
    params: { contrast: 1.03, lift: 0.025, sat: 1.04, shadow: [0.004, 0.002, -0.004], mid: [0.006, 0.002, -0.008], high: [0.012, 0.005, -0.026] },
  },
  'studio-cool': {
    name: 'studio-cool',
    intent: 'Cool navy shadows and restrained cyan highlights around skin that stays neutral and warm (skin first, never cyan).',
    params: { contrast: 1.1, sat: 0.99, shadow: [-0.04, -0.006, 0.075], mid: [0, 0, 0], high: [-0.03, 0.005, 0.014] },
  },
  'soft-film': {
    name: 'soft-film',
    intent: 'Low contrast, a lifted faded black and a rolled-off white with muted but alive saturation.',
    params: { contrast: 0.94, lift: 0.025, white: 0.97, sat: 0.93, shadow: [0.002, 0.002, 0], mid: [0.006, 0.002, -0.006], high: [0.008, 0.004, -0.006] },
  },
  // Deliberately wrong: pushes skin toward cyan and over-saturates. Only for proving the skin guard fails loudly.
  'test-extreme': {
    name: 'test-extreme',
    hidden: true,
    intent: 'Test only: a destructive grade that must trip the skin guard.',
    params: { contrast: 1.6, sat: 1.9, shadow: [-0.1, 0, 0.15], mid: [-0.16, 0.06, 0.16], high: [-0.12, 0.05, 0.1] },
  },
  // Deliberately wrong in one way only: a mid-tone cyan push that turns skin cyan and nothing else.
  'test-cyan': {
    name: 'test-cyan',
    hidden: true,
    intent: 'Test only: cyan skin, which the guard must catch by hue.',
    params: { mid: [-0.16, 0.05, 0.12] },
  },
};

// Soft weights over luma 0..1.
const wShadow = (x) => (x < 0.42 ? (1 - x / 0.42) ** 2 : 0);
const wHigh = (x) => (x > 0.72 ? ((x - 0.72) / 0.28) ** 2 : 0);
const wMid = (x) => (Math.abs(x - 0.55) < 0.3 ? Math.cos((Math.PI * (x - 0.55)) / 0.6) ** 2 : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const f4 = (v) => (Math.round(v * 10000) / 10000).toString();
const XS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];

// S-curve with fixed ends: slope 1 + a/2 at 0.5; contrast 1.1 -> a = 0.2.
const sCurve = (x, contrast) => x + 2 * (contrast - 1) * x * (1 - x) * (2 * x - 1);

function scaleParams(p, s) {
  const q = { ...NEUTRAL, ...p };
  const lerp = (a, b) => a + (b - a) * s;
  return {
    contrast: lerp(1, q.contrast), lift: lerp(0, q.lift), white: lerp(1, q.white), sat: lerp(1, q.sat),
    shadow: q.shadow.map((v) => v * s), mid: q.mid.map((v) => v * s), high: q.high.map((v) => v * s),
  };
}

// Saturation as an exact matrix (Rec.709 luma weights) so it needs no YUV round trip.
export function satFilter(sat) {
  if (Math.abs(sat - 1) < 0.0005) return '';
  const L = [0.2126, 0.7152, 0.0722], m = (r, c) => L[c] * (1 - sat) + (r === c ? sat : 0);
  const names = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
  return 'colorchannelmixer=' + names.map((n, i) => `${n}=${f4(m(Math.floor(i / 3), i % 3))}`).join(':');
}

export function renderParams(p) {
  const out = [];
  const flat = p.contrast === 1 && p.lift === 0 && p.white === 1 && [...p.shadow, ...p.mid, ...p.high].every((v) => v === 0);
  if (!flat) {
    const ch = [0, 1, 2].map((c) => XS.map((x) => {
      let y = sCurve(x, p.contrast);
      y = p.lift + (p.white - p.lift) * y;                       // lifted black, rolled-off white
      y += p.shadow[c] * wShadow(x) + p.mid[c] * wMid(x) + p.high[c] * wHigh(x);
      return `${f4(x)}/${f4(clamp01(y))}`;
    }).join(' '));
    out.push(`curves=r='${ch[0]}':g='${ch[1]}':b='${ch[2]}':interp=pchip`);
  }
  const sat = satFilter(p.sat);
  if (sat) out.push(sat);
  return out.join(',');
}

for (const look of Object.values(LOOKS)) {
  if (look.params) look.filter = (strength) => renderParams(scaleParams(look.params, strength));
}

export const visibleLooks = () => Object.values(LOOKS).filter((l) => !l.hidden);
