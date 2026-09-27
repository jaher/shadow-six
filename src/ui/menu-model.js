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

/** B1 camera: a hand-shaped loop of 6 keys over the map interior, starting at the mission's opening view. */
export function dioramaPath(def, n = 6) {
  const [w, d] = def?.size || [100, 100];
  // polish: fly between the map's biggest buildings (ordered around their centroid) instead of starting on the
  // squad's start corner, where the view showed empty snow and the void past the map edge
  const big = (def?.structures || []).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z) && (s.w ?? 0) * (s.d ?? 0) >= 12)
    .sort((a, b) => (b.w * b.d) - (a.w * a.d) || String(a.id).localeCompare(String(b.id))).slice(0, n);
  if (big.length >= 3) {
    // keep ~26 m (about half the menu view) off the map edge; the camo frame hides what is left of the void
    const mX = Math.min(w * 0.5, Math.max(w * 0.2, 26)), mZ = Math.min(d * 0.5, Math.max(d * 0.2, 16));
    const clampX = (x) => Math.min(w - mX, Math.max(mX, x)), clampZ = (z) => Math.min(d - mZ, Math.max(mZ, z));
    const mx = big.reduce((a, s) => a + s.x, 0) / big.length, mz = big.reduce((a, s) => a + s.z, 0) / big.length;
    const keys = big.map((s) => ({ x: clampX(s.x), z: clampZ(s.z), a: Math.atan2(s.z - mz, s.x - mx) }))
      .sort((a, b) => a.a - b.a).map(({ x, z }) => ({ x, z }));
    return { keys, period: 90 };
  }
  const c0 = def?.cameraStart || { x: w / 2, z: d / 2 };
  // small maps (e.g. the BCD sandbox) often start the camera near a corner: keep the first key off the edge too
  const cs = { x: Math.min(w * 0.8, Math.max(w * 0.2, c0.x)), z: Math.min(d * 0.8, Math.max(d * 0.2, c0.z)) };
  const cx = w / 2, cz = d / 2, rx = w * 0.22, rz = d * 0.2;
  const keys = [{ x: cs.x, z: cs.z }];
  const a0 = Math.atan2(cs.z - cz, cs.x - cx);
  for (let i = 1; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const wob = 1 + 0.18 * Math.sin(i * 2.3);
    keys.push({ x: cx + Math.cos(a) * rx * wob, z: cz + Math.sin(a) * rz * wob });
  }
  return { keys, period: 90 };
}

/** Position on the loop at time t (s): evenly timed keys, --ease-io between them. */
export function samplePath(path, t) {
  const k = path.keys, n = k.length;
  if (!n) return { x: 0, z: 0 };
  const seg = path.period / n;
  const tt = ((t % path.period) + path.period) % path.period;
  const i = Math.floor(tt / seg) % n;
  const u = (tt - i * seg) / seg;
  const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const a = k[i], b = k[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e };
}
