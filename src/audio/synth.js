/**
 * Procedural placeholder sounds (pure JS → Float32Array mono PCM). Used until the recorded CC0 SFX /
 * TTS voices from the R&D workflow are dropped into assets/audio (see manifest.js). No WebAudio needed,
 * so recipes are unit-testable; audio/engine.js copies them into AudioBuffers once and caches them.
 * @module audio/synth
 */

const TAU = Math.PI * 2;

/** Small deterministic RNG (xorshift32) so every render of a recipe is identical. */
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}
function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/**
 * Render `dur` seconds by calling f(t, i, noise) per sample; a one-pole low-pass with cutoff `lp` Hz
 * (or a function of t) is applied when given.
 */
function render(sr, dur, f, { seed = 1, lp = 0, hp = 0 } = {}) {
  const n = Math.max(1, Math.round(sr * dur));
  const out = new Float32Array(n);
  const rnd = rng(seed);
  let y = 0, h = 0, px = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let x = f(t, i, rnd);
    if (lp) { const c = typeof lp === 'function' ? lp(t) : lp; y += (1 - Math.exp(-TAU * c / sr)) * (x - y); x = y; }
    if (hp) { const a = Math.exp(-TAU * hp / sr); h = a * (h + x - px); px = x; x = h; }
    out[i] = x;
  }
  return normalize(out);
}
function normalize(buf, peak = 0.9) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}
const dec = (t, k) => Math.exp(-t * k); // exponential decay envelope
const att = (t, a) => Math.min(1, t / a); // linear attack
const loopFade = (t, dur) => Math.min(1, t / 0.05, (dur - t) / 0.05); // click-free loop seams

/** Recipe name → (sr, seed) => Float32Array. */
const RECIPES = {
  step: (sr, s) => render(sr, 0.12, (t, i, r) => r() * dec(t, 45), { seed: s, lp: 1800 }),
  rustle: (sr, s) => render(sr, 0.35, (t, i, r) => r() * Math.sin(Math.PI * t / 0.35) * (0.6 + 0.4 * Math.sin(t * 90)), { seed: s, lp: 4000, hp: 600 }),
  scrape: (sr, s) => render(sr, 0.45, (t, i, r) => r() * Math.sin(Math.PI * t / 0.45), { seed: s, lp: 2500, hp: 300 }),
  dig: (sr, s) => render(sr, 0.3, (t, i, r) => r() * dec(t, 12), { seed: s, lp: 1200 }),
  thud: (sr, s) => render(sr, 0.35, (t, i, r) => (Math.sin(TAU * 70 * t) + 0.3 * r()) * dec(t, 14), { seed: s, lp: 600 }),
  grunt: (sr, s) => render(sr, 0.3, (t) => Math.sign(Math.sin(TAU * (110 - 40 * t) * t)) * att(t, 0.03) * dec(t, 8), { seed: s, lp: 900 }),
  splash: (sr, s) => render(sr, 0.7, (t, i, r) => r() * att(t, 0.01) * dec(t, 6), { seed: s, lp: (t) => 6000 - 5000 * Math.min(1, t) }),
  splash_small: (sr, s) => render(sr, 0.25, (t, i, r) => r() * dec(t, 18), { seed: s, lp: 3000, hp: 400 }),
  bubbles: (sr, s) => render(sr, 1.0, (t) => Math.sin(TAU * (300 + 400 * ((t * 7) % 1)) * t) * (0.5 + 0.5 * Math.sin(TAU * 7 * t)) * loopFade(t, 1)),
  hiss: (sr, s) => render(sr, 0.6, (t, i, r) => r() * att(t, 0.02) * dec(t, 3), { seed: s, hp: 3000 }),
  stab: (sr, s) => render(sr, 0.15, (t, i, r) => (r() * 0.5 + Math.sin(TAU * 180 * t)) * dec(t, 30), { seed: s, lp: 2000 }),
  shot: (sr, s) => render(sr, 0.4, (t, i, r) => r() * (t < 0.004 ? 1 : dec(t, 16)), { seed: s, lp: (t) => 9000 * dec(t, 10) + 500 }),
  shot_big: (sr, s) => render(sr, 1.0, (t, i, r) => r() * (t < 0.006 ? 1 : dec(t, 6)) + (t > 0.15 ? 0.25 * r() * dec(t - 0.15, 5) : 0), { seed: s, lp: (t) => 8000 * dec(t, 6) + 300 }),
  click: (sr, s) => render(sr, 0.05, (t, i, r) => (r() + Math.sin(TAU * 2400 * t)) * dec(t, 120), { seed: s }),
  snap: (sr, s) => render(sr, 0.2, (t, i, r) => (r() + Math.sin(TAU * 900 * t)) * dec(t, 40), { seed: s }),
  burst: (sr, s) => render(sr, 0.6, (t, i, r) => r() * dec(t % 0.085, 40), { seed: s, lp: 5000 }),
  whoosh: (sr, s) => render(sr, 0.4, (t, i, r) => r() * Math.sin(Math.PI * t / 0.4), { seed: s, lp: (t) => 800 + 3000 * t }),
  knock: (sr, s) => render(sr, 0.15, (t, i, r) => (Math.sin(TAU * 420 * t) + 0.3 * r()) * dec(t, 35), { seed: s }),
  impact: (sr, s) => render(sr, 0.12, (t, i, r) => r() * dec(t, 50), { seed: s, lp: 3500 }),
  boom: (sr, s) => render(sr, 1.6, (t, i, r) => r() * att(t, 0.005) * dec(t, 3.2), { seed: s, lp: (t) => 2500 * dec(t, 3) + 120 }),
  boom_big: (sr, s) => render(sr, 3.0, (t, i, r) => (r() + 0.6 * Math.sin(TAU * 40 * t)) * att(t, 0.01) * dec(t, 1.4), { seed: s, lp: (t) => 1800 * dec(t, 2) + 80 }),
  tick: (sr) => render(sr, 0.04, (t) => Math.sin(TAU * 3200 * t) * dec(t, 150)),
  // menu foley (docs/menus-art-direction.md §1.8): metal, typewriter and paper, all procedural placeholders
  safety: (sr, s) => render(sr, 0.03, (t, i, r) => (0.6 * r() + Math.sin(TAU * 4200 * t) + 0.5 * Math.sin(TAU * 6100 * t)) * dec(t, 220), { seed: s, hp: 1500 }),
  bolt: (sr, s) => render(sr, 0.16, (t, i, r) => (t < 0.05 ? (0.8 * r() + Math.sin(TAU * 1800 * t)) * dec(t, 90) : 0) + (t > 0.07 ? (r() + Math.sin(TAU * 1250 * t) + 0.6 * Math.sin(TAU * 2900 * t)) * dec(t - 0.07, 70) : 0), { seed: s, hp: 250 }),
  bakelite: (sr, s) => render(sr, 0.06, (t, i, r) => (r() * 0.7 + Math.sin(TAU * 1500 * t)) * dec(t, 110), { seed: s, lp: 5000, hp: 400 }),
  detent: (sr, s) => render(sr, 0.02, (t, i, r) => (r() * 0.4 + Math.sin(TAU * 2600 * t)) * dec(t, 300), { seed: s, hp: 900 }),
  typestrike: (sr, s) => render(sr, 0.09, (t, i, r) => (r() * dec(t, 160) + 0.7 * Math.sin(TAU * 820 * t) * dec(t, 60) + 0.35 * Math.sin(TAU * 2300 * t) * dec(t, 120)), { seed: s, hp: 180 }),
  typeback: (sr, s) => render(sr, 0.04, (t, i, r) => (r() * 0.5 + Math.sin(TAU * 1900 * t)) * dec(t, 180), { seed: s, hp: 600 }),
  bell: (sr) => render(sr, 1.1, (t) => (Math.sin(TAU * 2093 * t) + 0.45 * Math.sin(TAU * 5270 * t) * dec(t, 6) + 0.25 * Math.sin(TAU * 4186 * t)) * att(t, 0.002) * dec(t, 3.2)),
  paper: (sr, s) => render(sr, 0.42, (t, i, r) => r() * Math.sin(Math.PI * Math.min(1, t / 0.42)) ** 0.6 * (0.45 + 0.55 * Math.abs(Math.sin(t * 37 + Math.sin(t * 91)))), { seed: s, lp: 6500, hp: 900 }),
  clink: (sr) => render(sr, 0.7, (t) => (Math.sin(TAU * 2637 * t) + 0.6 * Math.sin(TAU * 3951 * t) * dec(t, 9) + 0.4 * Math.sin(TAU * 6011 * t) * dec(t, 14) + (t > 0.11 ? 0.45 * Math.sin(TAU * 2637 * t) * dec(t - 0.11, 16) : 0)) * att(t, 0.001) * dec(t, 5)),
  wooddeny: (sr, s) => render(sr, 0.12, (t, i, r) => (Math.sin(TAU * 180 * t) + 0.25 * r()) * dec(t, 38), { seed: s, lp: 1200 }),
  telegraph: (sr) => render(sr, 0.13, (t) => Math.sign(Math.sin(TAU * 620 * t)) * 0.5 * Math.min(1, t / 0.004, (0.13 - t) / 0.004), { lp: 2400 }),
  projector: (sr, s) => render(sr, 2.0, (t, i, r) => (0.5 * r() * (0.5 + 0.5 * Math.sign(Math.sin(TAU * 24 * t))) + 0.25 * Math.sin(TAU * 96 * t)) * loopFade(t, 2), { seed: s, lp: 2200, hp: 120 }),
  chain: (sr, s) => render(sr, 0.22, (t, i, r) => [0, 0.05, 0.09, 0.14].reduce((a, k) => a + (t > k ? (r() * 0.5 + Math.sin(TAU * 3100 * t)) * dec(t - k, 90) : 0), 0), { seed: s, hp: 800 }),
  crackle: (sr, s) => render(sr, 2.0, (t, i, r) => (r() > 0.995 ? 1 : 0.08 * r()) * loopFade(t, 2), { seed: s, lp: 3000 }),
  noise_loop: (sr, s) => render(sr, 4.0, (t, i, r) => r() * (0.7 + 0.3 * Math.sin(TAU * 0.5 * t)) * loopFade(t, 4), { seed: s, lp: 700 }),
  // step 4w: a gust front passing the listener (3.2 s swell, the band opening as it peaks) and the halyard snap-hook
  // clanking against a steel flagpole when a gust fills the flag
  gust: (sr, s) => render(sr, 3.2, (t, i, r) => r() * Math.pow(Math.sin(Math.PI * t / 3.2), 1.6), { seed: s, lp: (t) => 260 + 1300 * Math.pow(Math.sin(Math.PI * t / 3.2), 2), hp: 90 }),
  halyard: (sr, s) => render(sr, 0.7, (t, i, r) => [0, 0.14, 0.33].reduce((a, k, j) => a + (t > k ? (Math.sin(TAU * (1850 + 260 * j) * t) + 0.55 * Math.sin(TAU * 2790 * t) + 0.3 * Math.sin(TAU * 4130 * t) + 0.25 * r()) * dec(t - k, 26 + 6 * j) * (1 - 0.3 * j) : 0), 0), { seed: s, hp: 500 }),
  noise_swell: (sr, s) => render(sr, 5.0, (t, i, r) => r() * Math.sin(Math.PI * t / 5), { seed: s, lp: 1200 }),
  beep: (sr) => render(sr, 0.12, (t) => Math.sin(TAU * 1500 * t) * Math.min(1, (0.12 - t) / 0.01)),
  hum: (sr) => render(sr, 1.0, (t) => (Math.sin(TAU * 50 * t) + 0.5 * Math.sin(TAU * 100 * t) + 0.25 * Math.sin(TAU * 150 * t)) * loopFade(t, 1)),
  zap: (sr, s) => render(sr, 0.5, (t, i, r) => (r() * 0.6 + Math.sign(Math.sin(TAU * 120 * t))) * dec(t, 6), { seed: s, lp: 5000 }),
  power_down: (sr) => render(sr, 1.2, (t) => Math.sin(TAU * (400 * dec(t, 2) + 30) * t) * dec(t, 2)),
  ring: (sr) => render(sr, 1.2, (t) => Math.sin(TAU * 900 * t) * Math.sin(TAU * 20 * t) * (t % 0.6 < 0.4 ? 1 : 0)),
  creak: (sr) => render(sr, 0.6, (t) => Math.sign(Math.sin(TAU * (90 + 60 * Math.sin(TAU * 2 * t)) * t)) * Math.sin(Math.PI * t / 0.6) * 0.5, { lp: 1500 }),
  engine: (sr, s) => render(sr, 2.0, (t, i, r) => (Math.sign(Math.sin(TAU * 48 * t)) * 0.6 + r() * 0.4) * loopFade(t, 2), { seed: s, lp: 500 }),
  engine_start: (sr, s) => render(sr, 1.2, (t, i, r) => (Math.sign(Math.sin(TAU * (20 + 30 * t) * t)) + 0.4 * r()) * att(t, 0.3), { seed: s, lp: 600 }),
  whir: (sr) => render(sr, 0.8, (t) => Math.sin(TAU * (200 + 100 * t) * t) * Math.sin(Math.PI * t / 0.8)),
  horn: (sr) => render(sr, 0.9, (t) => (Math.sign(Math.sin(TAU * 220 * t)) + Math.sign(Math.sin(TAU * 277 * t))) * att(t, 0.02) * Math.min(1, (0.9 - t) / 0.05), { lp: 1800 }),
  // §9.3 siren: hand-cranked air-raid wail rising over ~3 s, looping (8 s cycle: rise 3 s, hold, fall).
  siren: (sr) => render(sr, 8.0, (t) => {
    const f = t < 3 ? 220 + 380 * (t / 3) : t < 6 ? 600 : 600 - 300 * ((t - 6) / 2);
    return (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t)) * loopFade(t, 8);
  }),
  bird: (sr) => render(sr, 0.5, (t) => Math.sin(TAU * (2600 + 900 * Math.sin(TAU * 18 * t)) * t) * ((t % 0.16) < 0.09 ? 1 : 0) * dec(t, 3)),
  dog: (sr, s) => render(sr, 0.3, (t, i, r) => (Math.sign(Math.sin(TAU * (380 - 300 * t) * t)) + 0.4 * r()) * att(t, 0.01) * dec(t, 10), { seed: s, lp: 1600 }),
  fanfare: (sr) => notes(sr, [[523, 0.18], [659, 0.18], [784, 0.18], [1047, 0.6]], 'brass'),
};

/** Tiny note sequencer for stingers/music beds: [[hz|0, dur], …]. */
function notes(sr, seq, timbre = 'brass', lp = 2400) {
  const total = seq.reduce((a, [, d]) => a + d, 0);
  const starts = [];
  let acc = 0;
  for (const [f, d] of seq) { starts.push([acc, f, d]); acc += d; }
  return render(sr, total, (t) => {
    const n = starts.find(([s0, , d]) => t >= s0 && t < s0 + d);
    if (!n || !n[1]) return 0;
    const lt = t - n[0];
    const env = att(lt, 0.02) * Math.min(1, (n[2] - lt) / 0.04);
    const w = TAU * n[1] * t;
    return env * (timbre === 'brass' ? Math.sign(Math.sin(w)) * 0.4 + Math.sin(w) : Math.sin(w) + 0.3 * Math.sin(2 * w));
  }, { lp });
}

/** §9.1 music moods → placeholder phrases (a real orchestral cue replaces each by filename). */
const MOODS = {
  march: [[392, 0.3], [392, 0.15], [440, 0.15], [494, 0.6], [440, 0.3], [392, 0.3], [330, 0.6], [0, 0.3]],
  cold: [[147, 1.2], [165, 1.2], [131, 1.6], [0, 0.4]],
  modal: [[294, 0.5], [330, 0.5], [349, 0.5], [294, 1.0], [0, 0.5]],
  hopeful: [[392, 0.4], [494, 0.4], [587, 0.8], [523, 0.8], [0, 0.4]],
  grim: [[110, 1.0], [104, 1.0], [98, 1.6], [0, 0.4]],
  ostinato: [[220, 0.2], [262, 0.2], [220, 0.2], [247, 0.2], [220, 0.2], [262, 0.2], [196, 0.4]],
  stinger: [[294, 0.25], [294, 0.25], [440, 1.2]],
  success: [[392, 0.2], [523, 0.2], [659, 0.2], [784, 1.0]],
  fail: [[330, 0.5], [311, 0.5], [294, 0.5], [220, 1.5]],
  drone: [[55, 4.0]],
};

/**
 * Placeholder voice: a pitched formant "babble" whose length follows the text (so subtitles and
 * portrait lip-flap have a plausible duration). Speaker pitch comes from voice-lines.js.
 */
export function synthVoice(sr, text, pitch = 120) {
  const dur = Math.min(3.5, 0.25 + 0.06 * String(text).length);
  const seed = hash(text);
  return render(sr, dur, (t, i, r) => {
    const syl = Math.abs(Math.sin(Math.PI * t * 6.5));
    const f = pitch * (1 + 0.08 * Math.sin(TAU * 2.2 * t));
    const src = Math.sign(Math.sin(TAU * f * t)) * 0.6 + 0.4 * r();
    return src * syl * Math.min(1, t / 0.03, (dur - t) / 0.05);
  }, { seed, lp: (t) => 700 + 900 * Math.abs(Math.sin(TAU * 3.3 * t)) });
}

/** Render a recipe (an SFX recipe or a music mood). Returns null for unknown names. */
export function synth(recipe, sr = 22050, seed = 1) {
  if (RECIPES[recipe]) return RECIPES[recipe](sr, seed);
  if (MOODS[recipe]) return notes(sr, MOODS[recipe], recipe === 'march' || recipe === 'success' || recipe === 'stinger' ? 'brass' : 'strings', 1600);
  return null;
}

export const RECIPE_NAMES = Object.freeze([...Object.keys(RECIPES), ...Object.keys(MOODS)]);
export { hash as hashString };
