/**
 * Reference copy of sneak.mjs routeClearGen / walkerSees / staticSees / headsOf as they were before the M16 perf pass
 * (master 9bae3a038), with the small private helpers they use: the oracle of sneak-routeclear-exact.test.mjs. The
 * shared helpers that pass did not change (predict, walking, wheeling, postHeadings, viewersOf, seesAny, walkerViews,
 * dummyAt) are the live ones: both sides must use the same.
 */
import { predict, walking, wheeling, postHeadings, viewersOf, seesAny, walkerViews, dummyAt, HULL } from '../../../tools/solutions/sneak.mjs';
import { mirrorOf, ghostOn } from '../../../tools/solutions/ghost.mjs';
import { canSee as canSee0, coneAt, pointInCone, ellipseFar } from '../../../src/ai/perception.js';
import { CONFIG } from '../../../src/config.js';
import { hypot2 } from '../../../src/core/math.js';

const TAU = Math.PI * 2;
function canSee(e, d, w, o = {}) {
  const r = canSee0(e, d, w, o);
  if (r !== 'none' || !d?.hull) return r;
  const cone = o.cone ?? coneAt(e, w.time);
  if (!cone || !pointInCone(cone, d.x, d.z)) return 'none';
  return w.grid.lineOfSight(e.x, e.z, d.x, d.z, { viewerElevated: !!e.vision?.elevated, ownHull: e.ownHull }) ? 'far' : 'none';
}
function cryHeadings(q, w, tAbs) {
  const out = [];
  for (const c of w.sneakCries || []) {
    if (tAbs < c.t || hypot2(q.x - c.x, q.z - c.z) > c.r) continue;
    const to = Math.atan2(c.z - q.z, c.x - q.x), d = Math.atan2(Math.sin(to - q.heading), Math.cos(to - q.heading)), ad = Math.abs(d);
    for (const sg of ad > Math.PI - 0.3 ? [1, -1] : [Math.sign(d) || 1]) {
      const full = Math.sign(d) === sg ? ad : 2 * Math.PI - ad;
      for (let a = 0.2; a < full; a += 0.2) out.push(q.heading + sg * a);
    }
    out.push(to);
  }
  return out;
}
const TURN_RATE = CONFIG.units?.enemyTurnRate ?? Math.PI;
function turnHeadings(q, w = null) {
  if (q.turnFrom == null) return [];
  const d = Math.atan2(Math.sin(q.heading - q.turnFrom), Math.cos(q.heading - q.turnFrom)), ad = Math.abs(d);
  if (ad < 0.15 || q.turnT > ad / TURN_RATE + 0.4) return [];
  const out = [], a0 = Math.max(0, q.turnT - 0.4) * TURN_RATE, a1 = (q.turnT + 0.4) * TURN_RATE;
  for (const sg of ad > Math.PI - (w?.sneakTurnTie ?? 0.1) ? [1, -1] : [Math.sign(d)]) {
    const full = Math.sign(d) === sg ? ad : 2 * Math.PI - ad;
    for (let a = a0; a <= Math.min(full, a1) + 1e-6; a += 0.2) out.push(q.turnFrom + sg * a);
  }
  return out;
}
function dummyFor(w, mode, x, z, vx, vz) {
  if (mode !== 'boat') return dummyAt(w, mode, x, z);
  const d = hypot2(vx - x, vz - z) || 1, f = Math.min(HULL, d * 0.5) / d;
  return dummyAt(w, mode, x + (vx - x) * f, z + (vz - z) * f);
}
function padded(d, y0) { if (d.state !== 'inVehicle') d.y = y0; return d; }

export function refHeadsOf(e, q, w, tAbs) {
  const pw = CONFIG.stealth.vision.patrolWatch;
  if (q.halt && w.sneakHaltExact != null && pw && e.vision) {
    const A = (pw.sweep * Math.PI) / 180, P = pw.period, ph = e.vision.phase || 0, dt = w.sneakHaltExact;
    const offs = [0, -dt, dt, -dt / 2, dt / 2].map((tau) => A * Math.sin((2 * Math.PI * (tAbs + tau + ph)) / P));
    return { hds: [q.heading, ...(q.alt != null ? [q.alt] : []), ...cryHeadings(q, w, tAbs)], offs };
  }
  const amp = (q.halt === false ? (w.sneakWalkAmp ?? 0.25) : (q.halt ? (CONFIG.stealth.vision.patrolWatch?.sweep ?? 50) * Math.PI / 180 : e.sweepAmp ?? e.vision?.sweep ?? 0))
    + (w.sneakMargin ?? 0);
  const n = w.sneakSweepSteps ?? 2, offs = [0];
  if (amp) for (let k = 1; k <= n; k++) offs.push((amp * k) / n, (-amp * k) / n);
  return { hds: [q.heading, ...(q.alt != null ? [q.alt] : []), ...((w.sneakTurns === true || w.sneakTurns?.has?.(e.tag)) ? turnHeadings(q, w) : []), ...cryHeadings(q, w, tAbs)], offs };
}

export function refWalkerSees(e, q, dummy, w, tAbs) {
  const v = e.vision, a = v ? v.far ?? v.range : NaN, ratio = v?.ellipseRatio === undefined ? CONFIG.stealth.ellipseRatio : v.ellipseRatio;
  if (e.vehEye || !(a > 0) || (v.elliptical && !(ratio > 0))) return seesAny(walkerViews(e, q, w, tAbs), dummy, w);
  const dx = dummy.x - q.x, dz = dummy.z - q.z, d2 = dx * dx + dz * dz;
  const R = (v.elliptical ? Math.max(a, a * ratio) : a) * (1 + 1e-9);
  if (d2 > R * R) return false;
  const { hds, offs } = refHeadsOf(e, q, w, tAbs);
  const half = v.fov / 2, bear = d2 > 1e-12 ? Math.atan2(dz, dx) : 0;
  const far2 = offs.map((off) => { const f = v.elliptical ? ellipseFar(a, (off || 0) + 0, v.ellipseRatio) : a; return f * f; });
  let maxOff = 0;
  for (const off of offs) maxOff = Math.max(maxOff, Math.abs((off || 0) + 0));
  const lim = half + maxOff + 1e-6;
  let m = null;
  for (const hd of hds) {
    if (d2 > 1e-12) { let an = bear - hd; an -= TAU * Math.round(an / TAU); if (Math.abs(an) > lim) continue; }
    for (let k = 0; k < offs.length; k++) {
      if (d2 > far2[k]) continue;
      const off = offs[k];
      if (d2 > 1e-12) {
        let an = bear - (hd + ((off || 0) + 0));
        an -= TAU * Math.round(an / TAU);
        if (Math.abs(an) > half) continue;
      }
      const g = ghostOn(m ??= mirrorOf(e));
      g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; g.headCarry = 0;
      const cone = coneAt(g, tAbs);
      if (pointInCone(cone, dummy.x, dummy.z) && canSee(g, dummy, w, { cone }) !== 'none') return true;
    }
  }
  return false;
}

export function refStaticSees(e, d, w, t) {
  const v = e.vision, a = v ? v.far ?? v.range : NaN, ratio = v?.ellipseRatio === undefined ? CONFIG.stealth.ellipseRatio : v.ellipseRatio;
  const ch = cryHeadings(e, w, w.time + t), hs = postHeadings(e);
  if (a > 0 && (!v.elliptical || ratio > 0)) {
    const R = (v.elliptical ? Math.max(a, a * ratio) : a) * (1 + 1e-9), dx = d.x - e.x, dz = d.z - e.z, d2 = dx * dx + dz * dz;
    if (d2 > R * R) return false;
    const half = v.fov / 2, base = (e.headOffset || 0) + (e.headCarry || 0);
    const sw = e.sweepActive ? Math.abs((e.sweepW ?? 1) * (e.sweepAmp ?? v.sweep ?? 0)) : 0;
    if (d2 > 1e-12 && Number.isFinite(half + base + sw)) {
      const bear = Math.atan2(dz, dx), lim = half + sw + 1e-6;
      const within = (h, l) => { let an = bear - h; an -= TAU * Math.round(an / TAU); return !(Math.abs(an) > l); };
      if (!ch.some((h) => within(h, half + 1e-6)) && !(hs ? hs.some((h) => within(h + base, lim)) : within(e.heading + base, lim))) return false;
    }
  }
  const m = ch.length || hs ? mirrorOf(e) : null;
  if (ch.length && ch.some((h) => { const g = ghostOn(m); g.heading = h; g.sweepActive = false; g.headOffset = 0; g.headCarry = 0; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; })) return true;
  if (!hs) return canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none';
  return hs.some((h) => { const g = ghostOn(m); g.heading = h; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; });
}

/** The old routeClearGen (no `hint`: every caller of the exact test goes the plain way, and the hint way is the same
 *  seenBy), and its synchronous driver. */
export function* refRouteClearGen(D, pts, { mode = 'walk', from, speed, delay = 0, step = 0.75, slack = 0.5, slackRate = 0, hold = 0, why = null, except = null, keepWalker = 4, pad = 0, wheel = true } = {}) {
  const w = D.world;
  const sp = speed ?? (mode === 'boat' ? 2.5 : mode === 'crawl' ? 0.9 : 1.5);
  let [x, z] = from;
  let t = delay;
  const samples = [[x, z, t]];
  for (const [px, pz] of pts) {
    const L = hypot2(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / sp]);
    t += L / sp; x = px; z = pz;
  }
  for (let h = 0.5; h <= hold + 1e-6; h += 0.5) samples.push([x, z, t + h]);
  let looks = 0;
  const seenBy = function* seenBy(e, moving) {
    const far = (e.vision.far ?? 36) + 1;
    const ostep = Math.min(!moving && e.sweepActive ? 0.15 : 0.5, Math.max(0.1, slack));
    for (const [sx, sz, st] of samples) {
      const sl = slack + slackRate * st;
      for (let o = -sl; o <= sl + 1e-6; o += ostep) {
        if ((++looks & 15) === 0) yield;
        const tt = Math.max(0, st + o), hull = mode === 'boat' ? HULL : 0;
        let seen;
        const near = (vx, vz) => { const d = hypot2(vx - sx, vz - sz); return pad && d > pad ? [sx + ((vx - sx) * pad) / d, sz + ((vz - sz) * pad) / d] : null; };
        if (moving) {
          const q = predict(e, tt), dd = hypot2(q.x - sx, q.z - sz);
          if (dd > far + hull + pad) continue;
          const p2 = near(q.x, q.z);
          seen = dd < keepWalker || refWalkerSees(e, q, dummyFor(w, mode, sx, sz, q.x, q.z), w, w.time + tt)
            || (p2 && refWalkerSees(e, q, padded(dummyFor(w, mode, p2[0], p2[1], q.x, q.z), w.grid.elevAt?.(sx, sz) ?? 0), w, w.time + tt))
            || (wheel && wheeling(e, tt) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => refWalkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, dummyFor(w, mode, sx, sz, q.x, q.z), w, w.time + tt)));
        } else {
          if (hypot2(e.x - sx, e.z - sz) > far + hull + pad) continue;
          const p2 = near(e.x, e.z);
          seen = refStaticSees(e, dummyFor(w, mode, sx, sz, e.x, e.z), w, tt)
            || (!!p2 && refStaticSees(e, padded(dummyFor(w, mode, p2[0], p2[1], e.x, e.z), w.grid.elevAt?.(sx, sz) ?? 0), w, tt));
        }
        if (seen) return `${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`;
      }
    }
    return null;
  };
  for (const e of viewersOf(w)) {
    if (except?.includes?.(e)) continue;
    const r = yield* seenBy(e, walking(e));
    if (r) { why?.push(r); return false; }
  }
  return true;
}
export function refRouteClear(D, pts, o = {}) {
  const it = refRouteClearGen(D, pts, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
