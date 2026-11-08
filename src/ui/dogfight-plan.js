/**
 * The main menu's dogfight as data and pure functions (user: "Can we have a dog fight between airplanes after planes
 * pass by in the main menu", 2026-11-08): a few seeded choreographies — Bf 109s bounce a section of Spitfires, a
 * scissors / turning fight, a climbing turn, a head-on pass, short bursts, one 109 hit and diving away smoking behind
 * the far horizon, the rest breaking off — flown in a small 3D stage (metres: X across the scene, Y up, Z away from
 * the viewer) and placed on the screen per form factor in the still's open sky, clear of the card's text and as little
 * as possible behind the badge. menu-dogfight.js draws it; everything here is deterministic for a seed (unit tests).
 * @module ui/dogfight-plan
 */

export const DT = 1 / 30;                 // s per path sample
export const G = 9.81;                    // m/s²: banks from the turn rate, as in a coordinated turn
export const V = 52;                      // m/s: a fighter's pace eased for the eye (the bombers fly 62)
export const D0 = 600;                    // m from the viewer to the stage centre (the depth scale: r = D0 / (D0 + Z))
export const KAP = 110;                   // m: the stage is seen from below — the far side of a turn sinks toward the horizon
export const LEN = { spit: 9.47, bf109: 9.02 };
export const FADE = [0.62, 0.8];          // depth scale r: a plane further than D0 / 0.62 is lost in the haze, clear by 0.8
const DEG = Math.PI / 180;
const TAU_W = 0.32, TAU_C = 0.5, TAU_V = 1.2;   // s: roll-in / pitch / speed responses

/** Seeded uniform 0..1 (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The cast of one fight: each plane's path sampled every DT s for the fight's length. A plane flies a program —
 * [seconds, turn rate deg/s (+ = heading swings toward the far side when flying right), climb deg, speed factor] —
 * from a start state, rolls into each turn and pitches with lags; or follows another plane's path some seconds behind
 * at an offset in that plane's frame; and can be handed a new program from its state at any time (a break, a dive).
 */
export class Cast {
  constructor(dur) {
    this.dur = dur;
    this.n = Math.round(dur / DT) + 1;
    this.planes = [];
    this.bursts = [];
    this.kill = null;
  }

  _new(kind) {
    const n = this.n, p = { kind, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
    this.planes.push(p);
    return this.planes.length - 1;
  }

  /** A plane from [x, y, z, heading deg, climb deg] flying `prog`; its index. */
  fly(kind, [x, y, z, hd, cl = 0], prog, v = V) {
    const i = this._new(kind);
    this._integrate(i, 0, { x, y, z, hd: hd * DEG, cl: cl * DEG, w: 0, v }, prog, v);
    return i;
  }

  /** From time t on, plane i flies `prog` from where it is (heading, climb, turn rate and speed carried over). */
  then(i, t, prog, v = V) {
    const k = Math.max(1, Math.min(this.n - 2, Math.round(t / DT))), p = this.planes[i];
    const s0 = this.state(i, k - 1), s1 = this.state(i, k);
    const w = wrap(s1.hd - s0.hd) / DT;
    this._integrate(i, k, { x: p.x[k], y: p.y[k], z: p.z[k], hd: s1.hd, cl: s1.cl, w, v: s1.v }, prog, v);
  }

  /**
   * A plane that is at [x, y, z, heading deg, climb deg] at time tm (a head-on pass, a meeting): `before` is what it
   * flew up to then, latest segment first (integrated backwards from tm), `after` what it flies from tm on.
   */
  meet(kind, [x, y, z, hd, cl = 0], tm, before, after, v = V) {
    const i = this._new(kind), p = this.planes[i], k0 = Math.round(tm / DT);
    this._integrate(i, k0, { x, y, z, hd: hd * DEG, cl: cl * DEG, w: after[0][1] * DEG, v }, after, v);
    const fw = 1 - Math.exp(-DT / TAU_W), fc = 1 - Math.exp(-DT / TAU_C);
    let h = hd * DEG, c = cl * DEG, w = before[0][1] * DEG, seg = 0, end = tm - before[0][0];
    let px = x, py = y, pz = z;
    for (let k = k0 - 1; k >= 0; k--) {
      while (seg < before.length - 1 && k * DT < end) end -= before[++seg][0];
      const [, rate, climb, sp = 1] = before[seg];
      w += (rate * DEG - w) * fw;
      c += (climb * DEG - c) * fc;
      h -= w * DT;
      px -= v * sp * Math.cos(c) * Math.cos(h) * DT;
      pz -= v * sp * Math.cos(c) * Math.sin(h) * DT;
      py -= v * sp * Math.sin(c) * DT;
      p.x[k] = px; p.y[k] = py; p.z[k] = pz;
    }
    return i;
  }

  /** Plane i's path eases from its own into plane j's over [t0, t1] and is j's from then on (j: a ghost, not drawn). */
  blend(i, j, t0, t1) {
    const p = this.planes[i], q = this.planes[j];
    q.ghost = true;
    for (let k = Math.max(0, Math.floor(t0 / DT)); k < this.n; k++) {
      const u = Math.min(1, Math.max(0, (k * DT - t0) / (t1 - t0))), w = u * u * (3 - 2 * u);
      p.x[k] += (q.x[k] - p.x[k]) * w; p.y[k] += (q.y[k] - p.y[k]) * w; p.z[k] += (q.z[k] - p.z[k]) * w;
    }
  }

  /**
   * A plane `lag` s behind plane a on its path, offset [back, up, right] m in a's frame (or a function of the time
   * giving it: one diving onto a tail, a wingman closing up); its index.
   */
  follow(kind, a, lag, off = [0, 0, 0]) {
    const i = this._new(kind), p = this.planes[i], q = this.planes[a], L = Math.round(lag / DT);
    for (let k = 0; k < this.n; k++) {
      const [back, up, right] = typeof off === 'function' ? off(k * DT) : off;
      const j = k - L, s = this.state(a, Math.max(1, j));
      const ex = j < 0 ? j * DT * s.v : 0; // before the leader's first sample: its entry line, carried back
      const cx = Math.cos(s.hd) * Math.cos(s.cl), cz = Math.sin(s.hd) * Math.cos(s.cl), cy = Math.sin(s.cl);
      const jj = Math.max(0, j);
      p.x[k] = q.x[jj] + cx * (ex - back) + Math.sin(s.hd) * right;
      p.y[k] = q.y[jj] + cy * (ex - back) + up;
      p.z[k] = q.z[jj] + cz * (ex - back) - Math.cos(s.hd) * right;
    }
    return i;
  }

  /** A plane flying a given path: fn(t) -> [x, y, z] (a weave around a mean track, a circle); its index. */
  path(kind, fn) {
    const i = this._new(kind), p = this.planes[i];
    for (let k = 0; k < this.n; k++) { const [x, y, z] = fn(k * DT); p.x[k] = x; p.y[k] = y; p.z[k] = z; }
    return i;
  }

  /** The time in [t0, t1] when plane i's state scores highest (f({hd, cl, v, x, y, z})): a kill heading away. */
  when(i, t0, t1, f) {
    let best = t0, sc = -Infinity;
    for (let t = t0; t <= t1 + 1e-9; t += DT) {
      const k = Math.round(t / DT), p = this.planes[i], v = f({ ...this.state(i, k), x: p.x[k], y: p.y[k], z: p.z[k] });
      if (v > sc) { sc = v; best = t; }
    }
    return Math.round(best / DT) * DT;
  }

  /**
   * From time t, plane i leaves: it turns the shorter way onto heading `hd` deg (the outer side, a little toward the
   * viewer: it leaves the frame by the edge it came in from, never across the badge) and climbs away.
   */
  exit(i, t, hd = 195, climb = 18, rate = 46) {
    const k = Math.max(1, Math.min(this.n - 2, Math.round(t / DT))), d = wrap(hd * DEG - this.state(i, k).hd) / DEG;
    this.then(i, t, [[Math.abs(d) / rate, Math.sign(d) * rate, climb * 0.5], [30, 0, climb]]);
  }

  /** Plane s fires a burst at plane g: from t0 for dur s. */
  burst(s, g, t0, dur) { this.bursts.push({ s, g, t0, dur }); }

  /** Plane g is hit by plane s at t: a puff at its engine, smoke from then on, and `dive` flown from t + 0.4 s. */
  hit(g, s, t, dive) {
    this.kill = { g, s, t };
    this.then(g, t + 0.4, dive);
  }

  /** Heading, climb (rad) and speed of plane i at sample k (finite differences). */
  state(i, k) {
    const p = this.planes[i], a = Math.max(0, Math.min(this.n - 2, k - 1)), b = a + 1;
    const dx = p.x[b] - p.x[a], dy = p.y[b] - p.y[a], dz = p.z[b] - p.z[a], h = Math.hypot(dx, dz);
    return { hd: Math.atan2(dz, dx), cl: Math.atan2(dy, h), v: Math.hypot(h, dy) / DT };
  }

  _integrate(i, k0, s, prog, v0) {
    const p = this.planes[i];
    let { x, y, z, hd, cl, w, v } = s, seg = 0, end = k0 * DT + prog[0][0];
    p.x[k0] = x; p.y[k0] = y; p.z[k0] = z;
    const fw = 1 - Math.exp(-DT / TAU_W), fc = 1 - Math.exp(-DT / TAU_C), fv = 1 - Math.exp(-DT / TAU_V);
    for (let k = k0 + 1; k < this.n; k++) {
      while (seg < prog.length - 1 && k * DT > end) end += prog[++seg][0];
      const [, rate, climb, sp = 1] = prog[seg];
      w += (rate * DEG - w) * fw;
      cl += (climb * DEG - cl) * fc;
      v += (v0 * sp - v) * fv;
      hd += w * DT;
      x += v * Math.cos(cl) * Math.cos(hd) * DT;
      z += v * Math.cos(cl) * Math.sin(hd) * DT;
      y += v * Math.sin(cl) * DT;
      p.x[k] = x; p.y[k] = y; p.z[k] = z;
    }
  }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Each plane's attitude along its path: heading and climb from its velocity, speed, and the bank of a coordinated turn
 * (atan(v·ω / g), right wing down +), smoothed both ways so the roll leads the turn a little, as a pilot's does.
 */
export function attitude(cast) {
  const n = cast.n;
  for (let i = 0; i < cast.planes.length; i++) {
    const p = cast.planes[i];
    p.hd = new Float32Array(n); p.cl = new Float32Array(n); p.v = new Float32Array(n); p.bk = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      const dx = p.x[b] - p.x[a], dy = p.y[b] - p.y[a], dz = p.z[b] - p.z[a], h = Math.hypot(dx, dz), dt = (b - a) * DT;
      p.hd[k] = Math.atan2(dz, dx); p.cl[k] = Math.atan2(dy, h); p.v[k] = Math.hypot(h, dy) / dt;
    }
    const raw = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2), w = wrap(p.hd[b] - p.hd[a]) / ((b - a) * DT);
      raw[k] = Math.max(-80 * DEG, Math.min(80 * DEG, -Math.atan(p.v[k] * Math.cos(p.cl[k]) * w / G)));
    }
    const f = 1 - Math.exp(-DT / 0.12);
    for (let k = 1; k < n; k++) raw[k] = raw[k - 1] + (raw[k] - raw[k - 1]) * f;
    for (let k = n - 2; k >= 0; k--) raw[k] = raw[k + 1] + (raw[k] - raw[k + 1]) * f;
    p.bk = raw;
  }
  return cast;
}

/**
 * The stage on the screen: its depth and heights squashed by `q` (a small screen's fight: tighter in depth, flatter),
 * rotated `rot` rad about the vertical and mirrored (`mirror` ±1), `s` px per metre at the stage's depth (the planes'
 * size) and its distances drawn `c` times that (below 1: a small screen's fight drawn tighter around its planes), its
 * centre at (cx, cy) px. A plane further away is smaller (r = D0 / (D0 + Z)) and sinks a little toward the horizon.
 * @returns {[number, number, number]} x, y px and the depth scale r
 */
export function project(pl, X, Y, Z) {
  const q = pl.q ?? 1, k = pl.s * (pl.c ?? 1), c = Math.cos(pl.rot), s = Math.sin(pl.rot), z = Z * q, x1 = X * c - z * s;
  const r = D0 / (D0 + Math.max(-0.6 * D0, X * s + z * c));
  return [pl.cx + pl.mirror * x1 * k * r, pl.cy + (KAP * (1 - r) - Y * q * r) * k, r];
}

/**
 * Plane i at time t (s), linearly between samples: position, heading / climb / bank (rad), speed. Before 0 it flies
 * its entry line straight back (a small screen's fight starts earlier, so every plane still flies in from off it).
 */
export function sample(p, t) {
  if (t < 0) {
    const e = (p.x[1] - p.x[0]) / DT, g = (p.y[1] - p.y[0]) / DT, h = (p.z[1] - p.z[0]) / DT;
    return { x: p.x[0] + e * t, y: p.y[0] + g * t, z: p.z[0] + h * t, hd: p.hd[0], cl: p.cl[0], bk: 0, v: p.v[0] };
  }
  const n = p.x.length, u = Math.min(n - 1.001, t / DT), k = Math.floor(u), f = u - k;
  const L = (a) => a[k] + (a[k + 1] - a[k]) * f;
  return { x: L(p.x), y: L(p.y), z: L(p.z), hd: p.hd[k] + wrap(p.hd[k + 1] - p.hd[k]) * f, cl: L(p.cl), bk: L(p.bk), v: L(p.v) };
}

export const PRE = 4;                     // s a fight may start before its choreography's 0 (see sample)

/**
 * How plane p shows at time t on the placed stage: where (px), how big (r, its length px), and which way — for the
 * turntable cells: `yaw` deg (+ nose toward the viewer, -90..90), `bank` deg (+ near wing down), `flip` (the cell
 * mirrored: it flies leftward) and `pitch` deg (the cell turned in the screen plane, nose up +, fading as it points
 * at or away from the viewer).
 */
export function view(p, pl, t) {
  const q = sample(p, t), [x, y, r] = project(pl, q.x, q.y, q.z);
  const sq = pl.q ?? 1, ch = Math.cos(q.hd), sh = Math.sin(q.hd) * sq;
  let hd = Math.atan2(sh, ch) + pl.rot, bk = q.bk;
  q.cl = Math.atan2(Math.sin(q.cl) * sq, Math.cos(q.cl) * Math.hypot(ch, sh));
  if (pl.mirror < 0) { hd = Math.PI - hd; bk = -bk; }
  const flip = Math.cos(hd) < 0, yaw = Math.atan2(-Math.sin(hd), Math.abs(Math.cos(hd)));
  return { x, y, r, len: LEN[p.kind] * pl.s * r, yaw: yaw / DEG, bank: (flip ? -bk : bk) / DEG, flip, pitch: q.cl * Math.abs(Math.cos(yaw)) / DEG, q };
}

/** The compactions tried in turn, [c, q] (see project): as flown, flatter, then tighter around the planes. */
const LEVELS = [[1, 1], [1, 0.7], [0.82, 0.7], [0.68, 0.55], [0.56, 0.5], [0.46, 0.45]];
const pct = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];

/**
 * Seat a fight on this screen. `region`: {w, h, cols, rows, badge: Uint8Array (1 = a cell behind the badge),
 * sky: Float32Array (the skyline's y at each column edge), text: [l, t, r, b] (the card's text, with its margin),
 * sMin, sMax (px per m)}. Candidates (compaction, mirror, rotation, size, centre) are scored on the planes' time in
 * open sky, then their size; one is out if a plane crosses the text or dips under the skyline (but the hit plane's
 * dive), if a plane is on screen at the start or the end, or if the hit isn't in open sky. `t0`: when the fight
 * starts — 0, or earlier (to -PRE) when a plane would otherwise be on screen at once. opt: {step} the sampling (s),
 * {why} an object to count the rejections by reason in (diagnostics).
 * @returns {{c:number, q:number, mirror:number, rot:number, s:number, cx:number, cy:number, t0:number, score:number,
 *   open:number}|null}
 */
export function place(plan, region, opt) {
  const it = placing(plan, region, opt);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** place() a piece at a time: it yields after each size tried (a phone's frames stay smooth while it seats a fight). */
export function* placing(plan, region, { step = 0.25, why = null } = {}) {
  const { w, h, cols, rows, badge, sky, text, sMin, sMax } = region, cw = w / cols, ch = h / rows;
  const skyAt = (x) => { const u = Math.max(0, Math.min(cols - 1e-6, x / cw)), i = Math.floor(u); return sky[i] + (sky[i + 1] - sky[i]) * (u - i); };
  const skyLow = Math.max(...sky);
  const planes = plan.cast.planes.filter((p) => !p.ghost), kill = plan.cast.kill, dive = kill ? plan.cast.planes[kill.g] : null;
  const ts = []; for (let t = -PRE; t <= plan.dur + 1e-6; t += step) ts.push(t);
  const killT = kill ? kill.t : -1, g = { w, h, cw, ch, cols, rows, badge, text, skyAt, why, ts };
  let best = null;
  for (const [c, q] of LEVELS) {
    for (const mirror of [1, -1]) {
      for (const rot of [0, -0.6, 0.6]) {
        const base = { mirror, rot, q, c: 1, s: 1, cx: 0, cy: 0 }, ax = [], by = [];
        const S = planes.map((p) => ts.map((t) => {
          const v = sample(p, t), [a, b, r] = project(base, v.x, v.y, v.z), core = t > 2.5 && t < (p === dive ? killT + 2.5 : plan.dur - 3.5);
          if (core && r > FADE[0]) { ax.push(a); by.push(b); }
          return [a, b, r, p === dive && t > killT + 0.6, core];
        }));
        ax.sort((m, n) => m - n); by.sort((m, n) => m - n);
        const [a0, a1, b0, b1] = [pct(ax, 0.06), pct(ax, 0.94), pct(by, 0.06), pct(by, 0.94)];
        const hit = dive ? (() => { const v = sample(dive, killT); return project(base, v.x, v.y, v.z); })() : null;
        for (let s = sMax; s >= sMin * 0.999; s *= 0.88) {
          const k = s * c, W = (a1 - a0) * k, H = (b1 - b0) * k;
          if (W > 1.1 * w || H > 1.1 * skyLow) { if (why) why.size = (why.size || 0) + 1; continue; } // its middle can't fit
          const x0 = -a0 * k - 0.15 * W, x1 = w - a1 * k + 0.15 * W, y0 = -b0 * k - 0.15 * H, y1 = skyLow - b1 * k;
          const dx = Math.max(w / 48, (x1 - x0) / 16), dy = Math.max(h / 80, (y1 - y0) / 9);
          for (let cy = y0; cy <= y1 + 1e-6; cy += dy) {
            for (let cx = x0; cx <= x1 + 1e-6; cx += dx) {
              const pl = { c, q, mirror, rot, s, cx, cy }, sc = judge(pl, S, hit, planes, g);
              if (sc && (!best || sc.score * c * q ** 0.3 > best.score)) best = { ...pl, ...sc, score: sc.score * c * q ** 0.3 };
            }
          }
          if (best && best.c === c && best.q === q && best.s >= s * 0.999 && best.open > 0.8) break; // a good seat at this size
          yield;
        }
      }
    }
    if (best && best.open > 0.8) break; // a good seat at this compaction: no tighter one is needed
  }
  return best;
}

/**
 * One candidate's score (null: ruled out): the share of the fight's middle — from 2.5 s in to 3.5 s before the end,
 * the hit plane's to 2.5 s into its dive — each plane spends wholly on screen in open sky (not off the edges, not
 * behind the badge), and the stage's size.
 */
function judge(pl, S, hit, planes, g) {
  const { w, h, cw, ch, cols, rows, badge, text, skyAt, why, ts } = g, [tl, tt, tr, tb] = text, k = pl.s * pl.c;
  const no = (m) => { if (why) why[m] = (why[m] || 0) + 1; return null; };
  let open = 0, span = 0, t0 = 0;
  for (let i = 0; i < S.length; i++) {
    const L = 0.5 * LEN[planes[i].kind] * pl.s, row = S[i], n = row.length;
    let first = -1, last = -1;
    for (let j = 0; j < n; j++) {
      const [a, b, r, diving, core] = row[j], x = pl.cx + a * k, y = pl.cy + b * k, e = L * r;
      if (core) span++;
      if (x < -e || x > w + e || y < -e || y > h + e || r < FADE[0]) continue;
      if (x + e > tl && x - e < tr && y + e > tt && y - e < tb) return no('text');      // over the card's text
      if (diving ? y - 0.2 * e > skyAt(x) : y + 0.9 * e > skyAt(x)) { if (!diving) return no('ground'); continue; } // only the hit 109 goes down
      if (first < 0) first = j;
      last = j;
      if (core && x > e && x < w - e && y > e && !badge[Math.min(cols - 1, Math.floor(x / cw)) + Math.min(rows - 1, Math.floor(y / ch)) * cols]) open++;
    }
    if (first <= 0 || last >= n - 1) return no(first < 0 ? 'unseen' : first === 0 ? 'start' : 'end'); // enters, leaves
    t0 = Math.min(t0, ts[first] - 0.5);
  }
  if (hit) {
    const x = pl.cx + hit[0] * k, y = pl.cy + hit[1] * k;
    if (x < 0 || x > w || y < 0 || y > skyAt(x)) return no('hit off');
    if (badge[Math.min(cols - 1, Math.floor(x / cw)) + Math.min(rows - 1, Math.max(0, Math.floor(y / ch))) * cols]) return no('hit hidden');
  }
  const seen = open / Math.max(1, span);
  return { score: seen ** 3 * Math.pow(pl.s, 0.5), open: seen, t0: Math.max(-PRE, t0) };
}

/** The still's skyline (`sky`: fractions of its height at points evenly across it) as y px at a screen's column edges. */
export function skyline(sky, w, k, ox, cols) {
  const out = new Float32Array(cols + 1), N = sky.length - 1;
  for (let j = 0; j <= cols; j++) {
    const u = Math.max(0, Math.min(N - 1e-6, (j * w / cols - ox) / (1920 * k) * N)), i = Math.floor(u);
    out[j] = (sky[i] + (sky[i + 1] - sky[i]) * (u - i)) * 1080 * k;
  }
  return out;
}

/**
 * A screen's region for place(): the still's skyline on it, the card's text box grown by a margin (the Ken Burns
 * drift included), and the sizes a fight may take — at most 0.8x the scene's own scale over its far ground (`pxm`:
 * px per m on the 1920 px still, as the bombers fly), at least 14 px a Spitfire.
 */
export function regionOf({ w, h, k, ox, sky, pxm, badge, cols, rows, text }) {
  const m = Math.max(12, 0.03 * w), sMax = 0.8 * pxm * k;
  return { w, h, cols, rows, badge, sky: skyline(sky, w, k, ox, cols),
    text: text ? [text[0] - m, text[1] - m, text[2] + m, text[3] + m] : [-1e9, -1e9, -1e9, -1e9],
    sMax, sMin: Math.min(sMax, 14 / LEN.spit) };
}

const ss = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * The choreographies. Programs: [s, turn deg/s (+ swings the nose to the far side when flying right), climb deg,
 * speed factor]; J() jitters a number by the seed, so no two fights fly quite alike.
 */
/** Segments turning `deg` degrees at `rate` deg/s, split evenly over the climb angles given (a tilted circle). */
const turn = (deg, rate, climbs, sp = 1) => climbs.map((c) => [Math.abs(deg / rate) / climbs.length, rate, c, sp]);
/** A kill reads best with the 109 heading to the far side, fairly level: it then dives away from the viewer. */
const away = (q) => Math.sin(q.hd) - 0.5 * Math.abs(Math.sin(q.cl));
/** The hit 109: a puff, a lurch, the nose drops and it goes down away from the viewer, steepening. */
const DIVE = [[0.5, 3, -10], [1.0, 6, -30], [8, 2, -50, 1.25]];
const at = (c, i, t) => { const k = Math.round(t / DT), q = c.planes[i]; return [q.x[k], q.y[k], q.z[k], c.state(i, k).hd / DEG]; };

export const FIGHTS = {
  /**
   * Bf 109s bounce a pair of Spitfires from above and behind; the Spitfires break into turns, opposite ways, each with
   * a 109 on its tail; their top cover comes down on the second 109 and gets it; the other breaks off; all climb away.
   */
  bounce(J) {
    const c = new Cast(20);
    const s1 = c.fly('spit', [-360, 0, 0, 0], [[3.6, 0, 0], ...turn(360, J(48), [16, 8, -12, -6]), ...turn(150, J(48), [10, 4])]);
    const s2 = c.follow('spit', s1, 0, [22, -3, 28]);
    c.then(s2, 3.4, [...turn(360, J(-46), [-10, -4, 12, 6]), ...turn(120, J(-46), [0, 6])]);
    const b1 = c.follow('bf109', s1, 1.1, (t) => [0, 38 * (1 - ss(0.3, 3.3, t)), -10 * (1 - ss(0.3, 3.3, t))]);
    const b2 = c.follow('bf109', s2, 1.0, (t) => [0, 46 * (1 - ss(0.5, 3.4, t)), 12 * (1 - ss(0.5, 3.4, t))]);
    const s3 = c.follow('spit', b2, 1.3, (t) => [0, 40 * (1 - ss(4.5, 8.5, t)), 16 * (1 - ss(4.5, 8.5, t))]);
    const tk = c.when(b2, 9.4, 11.4, away);
    c.burst(b1, s1, 2.9, 0.4); c.burst(b2, s2, 3.2, 0.35); c.burst(b1, s1, 5.8, 0.4); c.burst(b2, s2, 6.6, 0.4);
    c.burst(s3, b2, tk - 1.1, 0.35); c.burst(s3, b2, tk - 0.5, 0.5);
    c.hit(b2, s3, tk, DIVE);
    c.exit(s3, tk + 0.9, J(190, 0.03), 20);
    c.exit(b1, tk + 0.5, J(200, 0.03), 16);
    c.exit(s1, tk + 1.6, J(185, 0.03), 18);
    c.exit(s2, tk + 2.3, J(200, 0.03), 16);
    return c;
  },

  /**
   * Two 109s come down out of the sun in front of the Spitfires and meet them head-on: both leaders fire and the lead
   * 109 is hit; the other pulls a climbing turn onto the second Spitfire's tail and chases it round until it breaks off.
   */
  headon(J) {
    const c = new Cast(20), tp = 5.4;
    const s1 = c.fly('spit', [-330, 0, 0, 0], [[tp + 0.5, 0, 0], ...turn(300, J(46), [16, 8, -4, -8]), [9, J(10), 0]]);
    const s2 = c.follow('spit', s1, 0.45, [0, -4, 30]);
    c.then(s2, tp + 0.9, [...turn(400, J(-46), [14, 4, -10, -4]), [9, J(-10), 0]]);
    const [x1, y1, z1, h1] = at(c, s1, tp);
    const b1 = c.meet('bf109', [x1, y1 + 7, z1 + 14, h1 + 180], tp, [[1.4, 0, -4, 1.2], [1.6, J(-40), -26, 1.3], [6, 0, -32, 1.35]], [[0.4, 0, 0]]);
    c.burst(s1, b1, tp - 0.75, 0.5); c.burst(b1, s1, tp - 0.7, 0.4);
    c.hit(b1, s1, tp - 0.15, [[0.4, -10, -8], [1.6, J(-40), -24], [8, -4, -36, 1.15]]);
    const [x2, y2, z2, h2] = at(c, s2, tp + 0.45);
    const b2 = c.meet('bf109', [x2, y2 + 6, z2 - 12, h2 + 180], tp + 0.45, [[1.3, 0, -4, 1.2], [1.6, J(-36), -24, 1.3], [6, 0, -30, 1.35]],
      [[0.4, 0, 10], [2.0, J(-70), 28], [9, 0, 0]]);
    c.blend(b2, c.follow('bf109', s2, 1.0, [0, 3, 0]), tp + 2.0, tp + 4.0);
    c.burst(b2, s2, tp + 4.6, 0.4); c.burst(b2, s2, tp + 7.0, 0.45); c.burst(s1, b2, tp + 8.1, 0.4);
    c.exit(b2, tp + 8.6, J(200, 0.03), 18);
    c.exit(s1, tp + 9.3, J(185, 0.03), 16);
    c.exit(s2, tp + 9.9, J(195, 0.03), 18);
    return c;
  },

  /**
   * A Spitfire and a 109 in a flat scissors — weaving across each other's track, each reversal tighter — while a
   * second pair turn circles further off; the 109 overshoots, the Spitfire reverses onto its tail and gets it.
   */
  scissors(J) {
    const c = new Cast(20), T0 = 2.6, per = J(3.2, 0.05), A = J(36, 0.1), T1 = T0 + 2 * per;
    const n = c.n, mx = new Float32Array(n), mz = new Float32Array(n), nx = new Float32Array(n), nz = new Float32Array(n);
    for (let k = 0, x = -400, z = 0, hd = 0; k < n; k++) {      // the mean track: in, then slowing and turning away
      const t = k * DT, u = V * (1 - 0.55 * ss(T0 - 0.5, T0 + 1.5, t));   // (so the weave runs across the view)
      hd = 55 * DEG * ss(T0 - 0.4, T0 + 1.2, t) + 6 * DEG * Math.max(0, t - T0 - 1.2) * (1 - 0.4 * ss(T1, T1 + 3, t));
      mx[k] = x; mz[k] = z; nx[k] = Math.sin(hd); nz[k] = -Math.cos(hd);
      x += u * Math.cos(hd) * DT; z += u * Math.sin(hd) * DT;
    }
    const weave = (t) => A * Math.sin(2 * Math.PI * (t - T0) / per) * ss(T0, T0 + 0.8, t) * (1 - 0.35 * ss(T0, T1, t));
    const k = (t) => Math.max(0, Math.min(n - 1, Math.round(t / DT)));
    const rise = (t) => 9 * (1 - Math.cos(4 * Math.PI * (t - T0) / per)) / 2 * ss(T0, T0 + 0.8, t) * (1 - ss(T1 - 0.5, T1 + 0.5, t)); // up at each reversal
    const s1 = c.path('spit', (t) => { const i = k(t), d = weave(t); return [mx[i] + nx[i] * d, 4 * Math.sin(t * 1.3) + rise(t), mz[i] + nz[i] * d]; });
    const b1 = c.path('bf109', (t) => { const i = k(t - 0.55), d = -0.9 * weave(t); return [mx[i] + nx[i] * d, 6 + 5 * Math.sin(t * 1.1 + 1) + rise(t - 0.3), mz[i] + nz[i] * d]; });
    c.exit(b1, T1, J(75, 0.05), 2, 40);                  // it overshoots and runs for the far side
    c.blend(s1, c.follow('spit', b1, 0.75, [0, -2, 0]), T1 - 0.6, T1 + 0.9);
    const tk = c.when(b1, T1 + 0.9, T1 + 1.8, away);
    c.burst(b1, s1, T0 + 1.9, 0.3); c.burst(b1, s1, T0 + 5.5, 0.35); c.burst(s1, b1, tk - 0.9, 0.3); c.burst(s1, b1, tk - 0.45, 0.45);
    c.hit(b1, s1, tk, DIVE);
    c.exit(s1, tk + 0.9, J(190, 0.03), 18);
    const s2 = c.fly('spit', [-410, 20, 100, 0], [[3.2, 0, 0], ...turn(450, J(44), [10, 4, -8, -4, 8]), [9, J(14), 0]]);
    const b2 = c.follow('bf109', s2, 1.4, [0, 4, 0]);
    c.burst(b2, s2, 5.8, 0.4); c.burst(b2, s2, 9.0, 0.4);
    c.exit(b2, 11.6, J(200, 0.03), 16);
    c.exit(s2, 12.4, J(185, 0.03), 18);
    return c;
  },
};

/**
 * A fight for a seed: its choreography (the seed picks it, then jitters it), every plane's path and attitude.
 * @returns {{name:string, seed:number, dur:number, cast:Cast}}
 */
export function plan(seed, name = null) {
  const names = Object.keys(FIGHTS), r = rng(seed * 7919 + 17);
  const pick = name || names[(seed >>> 0) % names.length];
  const J = (v, f = 0.07) => v * (1 + (r() * 2 - 1) * f);
  const cast = FIGHTS[pick](J);
  // centred on its middle: the stage turns about it and the far planes sink toward it, not toward some corner
  let mx = 0, my = 0, mz = 0, n = 0;
  for (const p of cast.planes) {
    if (p.ghost) continue;
    for (let k = Math.round(2.5 / DT); k < cast.n - Math.round(3.5 / DT); k += 3) { mx += p.x[k]; my += p.y[k]; mz += p.z[k]; n++; }
  }
  for (const p of cast.planes) for (let k = 0; k < cast.n; k++) { p.x[k] -= mx / n; p.y[k] -= my / n; p.z[k] -= mz / n; }
  return { name: pick, seed, dur: cast.dur, cast: attitude(cast) };
}
