/**
 * Pure menu logic (docs/menus-art-direction.md §1.5, §1.6, §1.9), shared by menu-kit.js and the Node unit tests:
 * focus movement over rows (wrap, skip separators, disabled rows stay focusable), `(X)` hotkey grammar, slider
 * steps, toggle flips, password cells (O→0, I→1), the key-buffer used while a card animates (amendment B4),
 * and the tip picker. No DOM here.
 * @module ui/menu-model
 */

/** Row kinds that can hold focus. Rules (`rule`) and headings (`head`) are skipped. */
export const FOCUSABLE = new Set(['item', 'toggle', 'slider', 'slot', 'bind', 'field', 'hotkey']);

/** Can row `r` take focus? Disabled / locked rows can (the reason is read out, §1.5.3). */
export function focusable(r) {
  return !!r && FOCUSABLE.has(r.kind || 'item') && !r.hidden;
}

/**
 * Next focusable row index from `i` in direction `dir` (+1 / -1), wrapping (§1.9 "↑↓ move and wrap").
 * @param {object[]} rows
 * @param {number} i current index (-1 = none)
 * @param {number} dir +1 | -1
 * @returns {number} index, or -1 when nothing can be focused
 */
export function nextFocus(rows, i, dir = 1) {
  const n = rows.length;
  if (!n) return -1;
  let k = i;
  for (let step = 0; step < n; step++) {
    k = (((k + dir) % n) + n) % n;
    if (focusable(rows[k])) return k;
  }
  return focusable(rows[i]) ? i : -1;
}

/** First (`dir` = +1) or last (-1) focusable row (Home / End). */
export function edgeFocus(rows, dir = 1) {
  return dir > 0 ? nextFocus(rows, -1, 1) : nextFocus(rows, rows.length, -1);
}

/** First enabled focusable row; else the first focusable (§1.9 "focus goes to the first enabled row"). */
export function firstEnabled(rows) {
  const k = rows.findIndex((r) => focusable(r) && !r.disabled && !r.locked);
  return k >= 0 ? k : rows.findIndex(focusable);
}

/**
 * The hotkey of a label written in BEL's grammar: '(N)EXT MISSION' → 'N', '(Y)ES' → 'Y', 'LOAD (Q)UICK' → 'Q'.
 * @param {string} label
 * @returns {string|null} upper-case letter / digit
 */
export function hotkeyOf(label) {
  const m = /\(([A-Z0-9])\)/i.exec(String(label || ''));
  return m ? m[1].toUpperCase() : null;
}

/** Split a hotkey label into parts for rendering: '(N)EXT' → {pre:'', key:'N', post:'EXT'}. */
export function splitHotkey(label) {
  const s = String(label || '');
  const m = /\(([A-Z0-9])\)/i.exec(s);
  if (!m) return { pre: s, key: null, post: '' };
  return { pre: s.slice(0, m.index), key: m[1], post: s.slice(m.index + m[0].length) };
}

/** KeyboardEvent.code for a hotkey letter ('N' → 'KeyN', '3' → 'Digit3'). */
export function codeForHotkey(k) {
  if (!k) return null;
  return /[0-9]/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`;
}

/** Row index whose hotkey matches a KeyboardEvent.code, or -1. */
export function rowForCode(rows, code) {
  return rows.findIndex((r) => focusable(r) && r.hotkey && codeForHotkey(r.hotkey) === code);
}

/**
 * Slider step (§1.5.6): ←→ 5 %, Shift 1 %, clamped to [min, max].
 * @param {number} v current value (0..1 unless min/max given)
 * @param {number} dir +1 | -1
 * @param {{fine?:boolean, min?:number, max?:number, step?:number, fineStep?:number}} [o]
 */
export function stepSlider(v, dir, o = {}) {
  const min = o.min ?? 0, max = o.max ?? 1;
  const span = max - min;
  const st = o.fine ? (o.fineStep ?? span * 0.01) : (o.step ?? span * 0.05);
  const raw = v + dir * st;
  const snapped = Math.round((raw - min) / st) * st + min; // stays on the step grid
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/** Did a slider move across a 10 % detent (§1.8 `ui.detent`)? */
export function crossedDetent(a, b, min = 0, max = 1) {
  const f = (v) => Math.floor(((v - min) / (max - min)) * 10 + 1e-9);
  return f(a) !== f(b);
}

/** Toggle / choice flip (§1.5.5): the next value of `choices` in direction `dir`, wrapping. */
export function flipChoice(choices, v, dir = 1) {
  const n = choices.length;
  if (!n) return v;
  const i = choices.findIndex((c) => c === v);
  return choices[(((i < 0 ? 0 : i + dir) % n) + n) % n];
}

/** §8.3 password alphabet (passwords.js): A–Z and 0–9; the menu reads O as 0 and I as 1. */
export function passwordChar(ch) {
  const c = String(ch || '').toUpperCase();
  if (c === 'O') return '0';
  if (c === 'I') return '1';
  return /^[A-Z0-9]$/.test(c) ? c : null;
}

/** Normalise pasted text into at most `n` password characters (trim, upper-case, O→0, I→1, drop the rest). */
export function normalizePassword(text, n = 5) {
  let out = '';
  for (const ch of String(text || '')) {
    const c = passwordChar(ch);
    if (c) out += c;
    if (out.length >= n) break;
  }
  return out;
}

/** Service-book name field (S04): A–Z, 0–9, space and '-', max 12, upper-case. */
export function profileNameChar(ch) {
  const c = String(ch || '').toUpperCase();
  return /^[A-Z0-9 -]$/.test(c) ? c : null;
}

/**
 * Key buffer for card transitions (amendment B4): keys pressed while a card animates are queued, never dropped,
 * and replayed on the new card in order.
 */
export class KeyBuffer {
  constructor(max = 16) {
    this.max = max;
    this.q = [];
  }

  push(code) {
    if (this.q.length < this.max) this.q.push(code);
  }

  drain() {
    const q = this.q;
    this.q = [];
    return q;
  }

  get size() {
    return this.q.length;
  }
}

/**
 * Pick the next loading tip (S14): matching the mission / theatre first, unseen before seen; deterministic for a
 * given `seen` set and `rnd` value.
 * @param {{id:string, text:string, theaters?:string[], missions?:string[]}[]} tips
 * @param {{theater?:string, mission?:string, seen?:Set<string>, rnd?:number}} ctx
 */
export function pickTip(tips, ctx = {}) {
  const seen = ctx.seen || new Set();
  const relevant = (t) => (!t.theaters || t.theaters.includes(ctx.theater)) && (!t.missions || t.missions.includes(ctx.mission));
  const pools = [
    tips.filter((t) => relevant(t) && (t.theaters || t.missions) && !seen.has(t.id)),
    tips.filter((t) => relevant(t) && !seen.has(t.id)),
    tips.filter(relevant),
    tips,
  ];
  const pool = pools.find((p) => p.length) || [];
  if (!pool.length) return null;
  const r = Math.min(0.999999, Math.max(0, ctx.rnd ?? 0));
  return pool[Math.floor(r * pool.length)];
}

/** Rank display for an index (CONFIG.mission.ranks), upper-cased for the menus. */
export function rankLabel(ranks, i) {
  const r = ranks?.[Math.max(0, Math.min((ranks?.length || 1) - 1, i | 0))];
  return r ? String(r).toUpperCase() : '';
}

/** Loading bar easing (S14): never jumps backwards, eases toward the target. */
export function easeProgress(shown, target, dt, rate = 6) {
  const t = Math.max(shown, Math.min(1, target));
  return shown + (t - shown) * Math.min(1, dt * rate);
}

// ---------------------------------------------------------------- backgrounds (§1.10 B1, B2 + A2)

const hex3 = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
/** A2: the measured oxblood stops, highlights kept (snow ≈ #8a6a60, never crushed). */
export const OXBLOOD_STOPS = [[0, 0x0e0707], [0.35, 0x3a2622], [0.7, 0x6a4a40], [1, 0x8a6a60]];

/** 256-entry RGB lookup (Uint8Array of 768) from luminance to the oxblood duotone. */
export function oxbloodLUT(stops = OXBLOOD_STOPS) {
  const lut = new Uint8Array(768);
  for (let y = 0; y < 256; y++) {
    const v = y / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ca] = stops[k], [b, cb] = stops[k + 1];
    const u = Math.min(1, Math.max(0, (v - a) / (b - a || 1)));
    const A = hex3(ca), B = hex3(cb);
    for (let c = 0; c < 3; c++) lut[y * 3 + c] = Math.round(A[c] + (B[c] - A[c]) * u);
  }
  return lut;
}

/**
 * Missions with a baked loading-card still (S14: assets/ui/loading/<id>.webp, tools/ui/bake_mission_stills.mjs — a
 * graded engine render of the mission's signature spot). Listed, not probed: a mission without one never requests it.
 */
export const LOADING_STILLS = new Set(Array.from({ length: 21 }, (_, i) => `m${String(i).padStart(2, '0')}`));

/** Theatres with a baked B1s backdrop still (assets/ui/diorama/<theater>.webp, the same baker). */
export const STILL_THEATERS = ['temperate', 'snow', 'desert', 'coast'];

/** The B1s still of a theatre (temperate stands in for one without its own). */
export function theaterStillURL(theater) {
  return `assets/ui/diorama/${STILL_THEATERS.includes(theater) ? theater : 'temperate'}.webp`;
}

/**
 * The loading card's photo for a mission, best first: its own still, then its theatre's backdrop still (the card
 * shows the Europe map when none of them loads).
 * @param {string|null|undefined} id @param {string} [theater] @returns {string[]}
 */
export function loadingPhotos(id, theater = 'temperate') {
  const out = [];
  if (id && LOADING_STILLS.has(id)) out.push(`assets/ui/loading/${id}.webp`);
  out.push(theaterStillURL(theater));
  return out;
}

/**
 * The front end's scene in each theatre still (assets/ui/diorama/<theater>.webp, 1920×1080; menu-bombers.js flies
 * over it), hand-measured on the stills — re-check after a re-bake. `fly`: the band of open sky the formation's
 * centre line may take (fractions of the still's height), clear of every tree, roof, mast, crane and derrick under
 * the planes. `zones`: the far-ground patches a stick may hit — x range and ground line y (fractions of the width /
 * height), `pxm` the scale there (px per metre on the 1920 px still: the section flying over the patch and its bursts
 * are drawn to it), `clip` an optional nearer occluder's top edge ([x, y] points, left to right) the bursts rise from
 * behind. `dust`: the colour the ground throws up there (soil, snow, sand). `grade`: the still's own balance before
 * the front end's one filmic grade (backdrop.js menuGradeFilter): channel gains taking its highlights to the same
 * warm neutral and a saturation factor bringing its colour to the same muted level (the baked stills differ: the
 * harbour near-monochrome, the desert sepia, the river in colour). `sky`: the skyline — the top of the far ground,
 * the trees, roofs, masts and cranes (fractions of the height at 65 points across, every 1/64 of the width; measured by
 * tools/ui/still_skyline.py): menu-dogfight.js keeps its fight above it and the hit 109 goes down behind it.
 */
export const STILL_SCENES = {
  temperate: { grade: { gain: [1.018, 1.029, 1.092], sat: 0.85 }, dust: [128, 116, 96], fly: [0.05, 0.115], sky: [
    0.234, 0.229, 0.221, 0.221, 0.219, 0.219, 0.209, 0.235, 0.236, 0.236, 0.236, 0.231, 0.235,
    0.232, 0.23, 0.23, 0.199, 0.177, 0.205, 0.196, 0.194, 0.224, 0.234, 0.231, 0.225, 0.23,
    0.229, 0.231, 0.232, 0.23, 0.222, 0.229, 0.231, 0.231, 0.231, 0.231, 0.231, 0.207, 0.192,
    0.218, 0.206, 0.201, 0.23, 0.196, 0.195, 0.199, 0.194, 0.202, 0.197, 0.192, 0.16, 0.172,
    0.167, 0.163, 0.184, 0.181, 0.203, 0.194, 0.182, 0.182, 0.181, 0.171, 0.175, 0.2, 0.218,
  ], zones: [
    { x: [0.06, 0.30], y: 0.300, pxm: 7.0 },  // the wood behind the village
    { x: [0.66, 0.80], y: 0.298, pxm: 7.0 },  // the far bank's fields under the treeline
  ] },
  snow: { grade: { gain: [1.014, 1.005, 1.015], sat: 1.5 }, dust: [176, 174, 166], fly: [0.05, 0.125], sky: [
    0.2, 0.199, 0.196, 0.214, 0.21, 0.244, 0.237, 0.197, 0.185, 0.192, 0.216, 0.204, 0.215,
    0.194, 0.188, 0.218, 0.207, 0.196, 0.199, 0.204, 0.201, 0.19, 0.201, 0.197, 0.198, 0.2,
    0.201, 0.21, 0.215, 0.235, 0.21, 0.205, 0.239, 0.243, 0.263, 0.251, 0.274, 0.229, 0.223,
    0.251, 0.269, 0.27, 0.27, 0.271, 0.272, 0.273, 0.274, 0.275, 0.276, 0.245, 0.19, 0.185,
    0.212, 0.28, 0.281, 0.281, 0.276, 0.214, 0.225, 0.244, 0.26, 0.268, 0.286, 0.288, 0.288,
  ], zones: [
    { x: [0.31, 0.42], y: 0.252, pxm: 6.0 },  // the hillside above the town
    { x: [0.03, 0.17], y: 0.262, pxm: 6.0 },  // the wooded slope above the west houses
  ] },
  desert: { grade: { gain: [0.985, 1.0, 1.07], sat: 0.78 }, dust: [178, 158, 122], fly: [0.05, 0.10], sky: [
    0.281, 0.28, 0.279, 0.277, 0.276, 0.274, 0.273, 0.271, 0.27, 0.269, 0.268, 0.266, 0.265,
    0.262, 0.262, 0.258, 0.259, 0.256, 0.256, 0.255, 0.253, 0.251, 0.25, 0.251, 0.252, 0.253,
    0.264, 0.305, 0.296, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.301, 0.306, 0.31,
    0.3, 0.3, 0.3, 0.325, 0.329, 0.328, 0.337, 0.33, 0.322, 0.347, 0.292, 0.3, 0.386,
    0.335, 0.324, 0.304, 0.3, 0.3, 0.3, 0.3, 0.326, 0.3, 0.325, 0.323, 0.329, 0.341,
  ], zones: [
    { x: [0.67, 0.81], y: 0.293, pxm: 6.5 },  // the open desert beyond the derricks
    { x: [0.05, 0.30], y: 0.272, pxm: 5.5, clip: [[0, 0.283], [0.26, 0.264], [0.27, 0.258], [0.40, 0.256]] }, // behind the fort
  ] },
  coast: { grade: { gain: [1.047, 1.029, 1.069], sat: 1.1 }, dust: [146, 138, 122], fly: [0.05, 0.12], sky: [
    0.249, 0.253, 0.234, 0.248, 0.249, 0.241, 0.239, 0.235, 0.226, 0.24, 0.226, 0.227, 0.233,
    0.229, 0.229, 0.229, 0.229, 0.228, 0.222, 0.189, 0.187, 0.184, 0.182, 0.18, 0.178, 0.175,
    0.172, 0.174, 0.191, 0.221, 0.219, 0.219, 0.22, 0.219, 0.23, 0.23, 0.229, 0.229, 0.229,
    0.225, 0.228, 0.226, 0.229, 0.229, 0.225, 0.228, 0.219, 0.227, 0.228, 0.214, 0.223, 0.228,
    0.228, 0.228, 0.233, 0.232, 0.233, 0.221, 0.205, 0.234, 0.234, 0.235, 0.249, 0.229, 0.227,
  ], zones: [
    { x: [0.56, 0.76], y: 0.240, pxm: 4.5 },  // the headland's top
    { x: [0.80, 0.92], y: 0.342, pxm: 8.0 },  // the far quay
  ] },
};
