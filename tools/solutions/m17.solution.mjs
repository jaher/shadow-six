/**
 * M17 "Before Dawn" (src/missions/m17_before_dawn.js, docs/missions/m17.md): the full solution, player orders only.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m17 (also tests/m17-solution.test.mjs). Walkthrough: m17.walkthrough.mjs.
 * (Outline: see STAGES.)
 */
import { CONFIG } from '../../src/config.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { injectionPlan } from '../../src/abilities/spy-actions.js';
import { dropSpot } from '../../src/abilities/common.js';
import { mirrorOf, ghostOn } from './ghost.mjs';
import { dummyAt, clearFor as clearFor0, routeClear as routeClear0, unwitnessed as unwitnessed0, bodySeen as bodySeen1, predict as predict0, viewersOf, walking, walkerSees, staticSees, wheeling } from './sneak.mjs';

const DBG = !!(globalThis.process?.env?.M17DBG || globalThis.__M3DBG);
/** (development) the cost of the waits' checks: the longest per label, the count, the total ms */
export const PERF = { max: {}, n: 0, total: 0, prim: {}, sum: {}, cnt: {} };
/** run generator `g` to its end at once (the headless way: nothing to hand back) */
const drain = (g) => { for (;;) { const r = g.next(); if (r.done) return r.value; } };
const isGen = (f) => f?.constructor?.name === 'GeneratorFunction';
/** (development) time one primitive check into PERF.prim */
const timedPrim = (name, f) => (...a) => { const c0 = performance.now(); try { return f(...a); } finally { const ms = performance.now() - c0; PERF.prim[name] = Math.max(PERF.prim[name] ?? 0, ms); } };
/** sneak.predict, remembered for the tick (the same man, the same time ahead: the same answer while nothing ticks;
 *  `asIfReleased` and the sneakTurns switch start afresh) */
const PM = { key: null, maps: [new Map(), new Map(), new Map(), new Map()], turn: [new Map(), new Map(), new Map(), new Map()] };
let releaseEpoch = 0; // (0: as they are; 1: the held men walking again — asIfReleased)
/** this tick's memo for `e` (by release state and the sneakTurns switch): a Map keyed by ms ahead */
function pmFor(e, which = 'maps') {
  const w = e.world;
  if (PM.key !== w?.time) { PM.key = w?.time; for (const m of PM.maps) m.clear(); for (const m of PM.turn) m.clear(); }
  const top = PM[which][releaseEpoch * 2 + (w?.sneakTurns ? 1 : 0)];
  let m = top.get(e);
  if (!m) top.set(e, m = new Map());
  return m;
}
function predict(e, t) {
  const m = pmFor(e), k = Math.round(t * 1000);
  let q = m.get(k);
  if (!q) { q = predict0(e, t); m.set(k, q); }
  return q;
}
/**
 * walkerSees, after a cheap test of the bearing: a walker predicted at `q` facing straight on (no about-turn, no turn
 * just begun, no cry about) cannot see a point further round than his widest head swing plus his half field — the
 * heads sneak.walkerViews would try (the same answer, without building them).
 */
const PATROL_AMP = ((CONFIG.stealth.vision.patrolWatch?.sweep ?? 50) * Math.PI) / 180;
function walkerSeesF(e, q, d, w, tAbs) {
  if (q.alt == null && q.turnFrom == null && !w.sneakCries?.length && e.vision && !e.vehEye) {
    const amp = Math.max(w.sneakWalkAmp ?? 0.25, PATROL_AMP, e.sweepAmp ?? e.vision.sweep ?? 0) + (w.sneakMargin ?? 0);
    let a = Math.atan2(d.z - q.z, d.x - q.x) - q.heading;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) > amp + e.vision.fov / 2 + 0.05) return false;
    const far = (e.vision.far ?? e.vision.range ?? 36) + 0.5;
    if ((d.x - q.x) ** 2 + (d.z - q.z) ** 2 > far * far) return false;
  }
  return walkerSees(e, q, d, w, tAbs);
}
/** walkerSees with his body turned to heading `h` (a turn about at a halt) */
const walkerSeesH = (e, q, h, d, w, tAbs) => walkerSeesF(e, { ...q, heading: h }, d, w, tAbs);
/** A squad man turning about at `t` (sneak.wheeling; and the patrol's leader at his halt too, which wheeling leaves
 *  out: p26a turned round by the N at his W halt and saw a body predict had behind him): any heading of the turn,
 *  either way round. A file man's turn other than at a halt: wheeling's own test. */
function turning(e, t) {
  const m = pmFor(e, 'turn'), k = Math.round(t * 1000);
  let r = m.get(k);
  if (r !== undefined) return r;
  r = false;
  const L = e.squad?.id != null ? e.brain?._leader?.() : null;
  // (sneak.wheeling: at the leader's halt the file men step up beside him, facing any way)
  if (!L) r = false; // (a lone walker turns the way predict says: sneak.wheeling leaves him out too)
  else if (L !== e && L.alive && e.world?.sneakPaths && [0, -2, 2].some((o) => predict(L, Math.max(0, t + o)).halt)) r = true;
  else {
    const a = predict(e, Math.max(0, t - 3)).heading, b = predict(e, t + 3).heading;
    let dh = Math.abs(a - b) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    r = dh > 1;
  }
  m.set(k, r);
  return r;
}
/** sneak.bodySeen, with walkers turning about at their halts seen at every heading of the turn (a generator: it
 *  yields after each viewer, for the sliced waits of the live replay) */
function* bodySeenG(D, x, z, dur = 120, { step = 0.5, except = [] } = {}) {
  const w = D.world, out = [];
  const d = dummyAt(w, 'body', x, z);
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue; // (a vehicle's eye looks for men only)
    const far = (e.vision.far ?? 36) + 1;
    if (!walking(e)) {
      for (let t = 0; t <= dur; t += step) {
        if (Math.hypot(e.x - x, e.z - z) > far) break;
        if (canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none') { out.push(e.tag); break; }
      }
      yield;
      continue;
    }
    for (let t = 0; t <= dur; t += step) {
      const q = predict(e, t), L = Math.hypot(q.x - x, q.z - z);
      if (L > far) continue;
      // (far off, at the edge of his sight, a patrol's file man a step nearer than predicted — at a halt he stands
      // where there is room — sees the body: the spot a metre nearer is judged too)
      const dn = L > 25 && e.squad?.id != null ? { ...d, x: x + ((q.x - x) * 1.0) / L, z: z + ((q.z - z) * 1.0) / L } : null;
      if (walkerSeesF(e, q, d, w, w.time + t) || (dn && walkerSeesF(e, q, dn, w, w.time + t))
        || (turning(e, t) && wheelHeadings(e, t).some((h) => walkerSeesH(e, q, h, d, w, w.time + t) || (dn && walkerSeesH(e, q, h, dn, w, w.time + t))))) { out.push(e.tag); break; }
    }
    yield;
  }
  return out;
}
const bodySeen0 = (...a) => drain(bodySeenG(...a));
/** sneak.routeClear one viewer at a time (the same viewers in the same order: the same answer), yielding between */
function* routeClearG(D, pts, o = {}) {
  const vs = viewersOf(D.world).filter((e) => !o.except?.includes?.(e));
  for (const v of vs) {
    if (!routeClear0(D, pts, { ...o, except: [...(o.except || []), ...vs.filter((e) => e !== v)] })) return false;
    yield;
  }
  return true;
}
const routeClear = timedPrim('routeClear', routeClear0), clearFor = timedPrim('clearFor', clearFor0), unwitnessed = timedPrim('unwitnessed', unwitnessed0), bodySeen = timedPrim('bodySeen', bodySeen0);
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };

// ---------------------------------------------------------------- helpers

/** wait until `pred(why)` holds (tried every `every` s); the reasons it does not go into the timeout error */
async function waitFor(D, pred, maxSec, label, every = 0.2) {
  const why = [], stats = new Map();
  let next = -1, n = 0;
  if (isGen(pred)) {
    // (a generator: run sliced — the live replay hands the frame back while it thinks, nothing ticking meanwhile —
    // at the same moments as the plain predicate would be asked: every `every` s)
    const tEnd = D.t + maxSec;
    let noted = false;
    try {
      for (;;) {
        why.length = 0;
        const w = D.world, t0 = w.sneakTurns;
        let ok;
        const c0 = performance.now();
        const unfix = fixHeldPosts(D);
        try { w.sneakTurns = true; ok = await D.runSliced((function* () { w.sneakTurns = true; return yield* pred(why); })()); } finally { w.sneakTurns = t0; unfix(); }
        const ms = performance.now() - c0;
        if (ms > (PERF.max[label] ?? 0)) PERF.max[label] = ms;
        PERF.n++; PERF.total += ms; PERF.sum[label] = (PERF.sum[label] ?? 0) + ms; PERF.cnt[label] = (PERF.cnt[label] ?? 0) + 1;
        if (!ok && why[0]) { const k = (why.find((r) => !/no footing|cannot catch/.test(r)) ?? why[0]).replace(/[@(+~].*$/, ''); stats.set(k, (stats.get(k) || 0) + 1); }
        if (!ok && DBG && n++ % 50 === 0) dbg(D, `${label}: ${why.slice(0, 6).join(' ')}`);
        if (ok) return;
        next = D.t + every;
        if (D.t + 1e-9 >= tEnd) throw new Error(`timeout ${maxSec}s waiting ${label}`);
        // (the wait's label stands for the whole wait, set once after the first failed check: an until's own label drops
        // at the end of every gap, and video mode's time-lapse and its tag then stopped and started again at every check
        // — 1100 blinks in a run; the same ticks either way, nothing in the run changes)
        if (!noted) { noted = true; D.waitNote?.(label); }
        await D.until(() => D.t + 1e-9 >= next, every + 1);
      }
    } catch (e) { throw new Error(`${e.message} [${why.slice(0, 5).join(' ')}] {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ')}}`); } finally { if (noted) D.waitNote?.(null); }
  }
  await D.until(() => {
    if (D.t + 1e-9 < next) return false;
    next = D.t + every;
    why.length = 0;
    const w = D.world, t0 = w.sneakTurns;
    w.sneakTurns = true;
    let ok;
    const c0 = performance.now();
    try { ok = pred(why); } finally { w.sneakTurns = t0; }
    const ms = performance.now() - c0;
    if (ms > (PERF.max[label] ?? 0)) PERF.max[label] = ms;
    PERF.n++; PERF.total += ms; PERF.sum[label] = (PERF.sum[label] ?? 0) + ms; PERF.cnt[label] = (PERF.cnt[label] ?? 0) + 1;
    if (!ok && why[0]) { const k = (why.find((r) => !/no footing|cannot catch/.test(r)) ?? why[0]).replace(/[@(+~].*$/, ''); stats.set(k, (stats.get(k) || 0) + 1); }
    if (!ok && DBG && n++ % 50 === 0) dbg(D, `${label}: ${why.slice(0, 6).join(' ')}`);
    return ok;
  }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 5).join(' ')}] {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ')}}`); });
}

/** The headings a squad man wheeling at `t` may face (sneak.wheeling). */
function wheelHeadings(e, t) {
  const L = e.brain?._leader?.();
  if (L && L !== e && [0, -2, 2].some((o) => predict(L, Math.max(0, t + o)).halt)) return [0, 1, 2, 3, 4, 5, 6, 7].map((r) => (r * Math.PI) / 4);
  const a = predict(e, Math.max(0, t - 3)).heading, b = predict(e, t + 3).heading;
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)), out = [];
  for (const sg of Math.abs(d) > Math.PI - 0.3 ? [1, -1] : [Math.sign(d) || 1]) {
    const full = Math.sign(d) === sg ? Math.abs(d) : 2 * Math.PI - Math.abs(d);
    for (let k = 0; k <= full + 1e-6; k += 0.25) out.push(a + sg * k);
  }
  return out;
}

/**
 * Would anyone see a man standing at the timed spots `samples` ([x, z, y, t]: t s from now), each tried `slack` s
 * early and late (walkers along their predicted beat, the turns at their halts too; posts by their sweep)?
 * `body`: the spots are a body lying there (full cone, low line of sight).
 */
const standSeen = (...a) => timedPrim('standSeen', (...b) => drain(standSeenG(...b)))(...a);
function* standSeenG(D, samples, { slack = 1, why = null, except = [], only = null, keepWalker = 3, low = false, pad = 0.75, body = false, lat = 0, turn = 0.45 } = {}) {
  const w = D.world, t0 = w.sneakTurns;
  w.sneakTurns = true;
  try {
    for (const e of viewersOf(w)) {
      if (except.includes(e) || (only && e !== only)) continue;
      const far = (e.vision?.far ?? 36) + 2, moving = walking(e);
      for (const [x, z, y, t] of samples) {
        if (!moving && Math.hypot(e.x - x, e.z - z) > far) continue;
        for (let o = -slack; o <= slack + 1e-6; o += 0.25) {
          const tt = Math.max(0, t + o);
          const d = body ? { x, z, y, kind: 'body' } : { x, z, y, isLow: low, isVisibleToEnemies: true, alive: true, kind: 'commando' };
          const nearer = (vx, vz) => { const L = Math.hypot(vx - x, vz - z); return pad && L > pad ? { ...d, x: x + ((vx - x) * pad) / L, z: z + ((vz - z) * pad) / L } : null; };
          // (`lat`: a man a step to either side of where he is planned — at a cone's side edge that is what matters)
          const aside = (vx, vz) => { if (!lat) return []; const L = Math.hypot(vx - x, vz - z) || 1, px = -(vz - z) / L, pz = (vx - x) / L; return [{ ...d, x: x + px * lat, z: z + pz * lat }, { ...d, x: x - px * lat, z: z - pz * lat }]; };
          let seen;
          if (moving) {
            const q = predict(e, tt), dd = Math.hypot(q.x - x, q.z - z);
            if (dd > far) continue;
            const d2 = nearer(q.x, q.z);
            // (`turn`: a walker's way round a corner or an obstacle is not the straight line the prediction draws: his
            // heading a little either way too)
            seen = dd < keepWalker || walkerSeesF(e, q, d, w, w.time + tt) || (!!d2 && walkerSeesF(e, q, d2, w, w.time + tt))
              || (turn > 0 && dd < far && [turn, -turn].some((dh) => walkerSees(e, { ...q, heading: q.heading + dh }, d, w, w.time + tt)))
              || aside(q.x, q.z).some((d3) => walkerSees(e, q, d3, w, w.time + tt))
              || (turning(e, tt) && wheelHeadings(e, tt).some((h) => walkerSees(e, { ...q, heading: h }, d, w, w.time + tt)));
          } else {
            const d2 = nearer(e.x, e.z);
            seen = staticSees(e, d, w, tt) || (!!d2 && staticSees(e, d2, w, tt)) || aside(e.x, e.z).some((d3) => staticSees(e, d3, w, tt));
          }
          if (seen) { why?.push(`${e.tag}@(${x.toFixed(1)},${z.toFixed(1)})+${tt.toFixed(1)}`); return true; }
        }
      }
      w.sneakTurns = t0;
      yield;
      w.sneakTurns = true;
    }
    return false;
  } finally { w.sneakTurns = t0; }
}

/** timed spots along straight legs `pts` from `from` at `speed` m/s, from `t0` s: [[x, z, y, t]…] */
function timed(from, pts, speed, t0, y = 0) {
  const out = [];
  let [x, z] = from, t = t0;
  out.push([x, z, y, t]);
  for (const [px, pz] of pts) {
    const l = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 1; k <= n; k++) out.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, y, t + (l * k) / n / speed]);
    t += l / speed; x = px; z = pz;
  }
  return out;
}
/**
 * The walkable way from `from` through `pts` (the pathfinder's cells, pulled taut as a player's man walks them),
 * thinned to ~1 m. `who` (a role or a man): as his own move order would plan it (Unit.planFrom: the body clearance he
 * keeps round rocks, lorries and props — in the game the drawn models' solids — which a bare search does not), in
 * `stance` (default: his own). A point he cannot stand on is reached at the pathfinder's stand-in cell, where he would
 * really stop; `short` on the result then says so.
 */
function way(D, from, pts, who = null, stance = null) {
  const u = who ? (typeof who === 'string' ? D.c(who) : who) : null, s0 = u?.stance;
  const out = [];
  let [x, z] = from, short = false;
  if (u && stance) u.stance = stance;
  try {
    for (const [tx, tz] of pts) {
      const p = u ? u.planFrom(x, z, tx, tz) : D.world.findPath(x, z, tx, tz, { taut: true });
      // (no way there at all — behind a wall: the straight line stands in, but out of reach)
      if (!p && Math.hypot(tx - x, tz - z) > 0.6) short = true;
      if (p) for (const q of p.slice(1)) out.push([q.x, q.z]);
      const end = out.at(-1);
      if (p && end && Math.hypot(end[0] - tx, end[1] - tz) > 0.6) { short = true; [x, z] = end; continue; }
      if (!out.length || Math.hypot(out.at(-1)[0] - tx, out.at(-1)[1] - tz) > 0.3) out.push([tx, tz]);
      [x, z] = [tx, tz];
    }
  } finally { if (u && stance) u.stance = s0; }
  const thin = [];
  for (const q of out) { const l = thin.at(-1); if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 1 || q === out.at(-1)) thin.push(q); }
  if (short) thin.short = true;
  return thin;
}
const pathLen = (from, pts) => { let L = 0, p = from; for (const q of pts) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return L; };

/** Walk through `pts` (a man who stops short — a guard in his way — waits and goes on). */
async function walk(D, role, pts, { tol = 0.6, max = 200 } = {}) {
  for (const [x, z] of pts) {
    for (let k = 0; ; k++) {
      try { await D.go(role, x, z, { tol, max }); break; } catch (e) {
        if (k >= 8 || !/stopped at/.test(e.message)) throw e;
        await D.wait(1.5);
      }
    }
  }
}

/**
 * Shoulder body `e` to (x, z) along `via` and put it down there: a shouldered man is laid 0.6 m ahead of the carrier
 * (abilities/common.js dropSpot), so he stops that much short of the spot, facing it.
 */
async function carryTo(D, role, e, [x, z], via = []) {
  const u = D.c(role);
  await D.idle(role);
  // (the way the waits judged: from where the body lies, through `via`, to the spot — walked point by point, not left
  // to the order's own path from wherever she stands as she lifts him: from his back that is round the other side of a
  // rock, in someone's sight)
  const route = way(D, [e.x, e.z], [...via, [x, z]], role, 'stand').slice(0, -1);
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 20, `grab ${e.tag}`);
  D.world.__carryT?.();
  for (const [px, pz] of route) { try { await D.go(role, px, pz, { tol: 0.7, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - px, u.z - pz) > 2.5) throw err; } }
  const L = Math.hypot(x - u.x, z - u.z), g = D.world.grid;
  let [sx, sz] = L > 0.8 ? [x - ((x - u.x) / L) * 0.6, z - ((z - u.z) / L) * 0.6] : [u.x, u.z];
  if (!g.walkableAt(sx, sz)) [sx, sz] = [x, z];
  // (the put-down lays him ahead of her if that is clear and he has room to lie there, else to one side or shifted
  // up to 1.5 m: abilities/common.js dropSpot. Where he would land from the straight way in is worked out first; off
  // the spot, she comes in from the side from which he lands on it)
  const landing = (ax, az) => { const p = dropSpot({ world: D.world, x: ax, z: az, y: 0, heading: Math.atan2(z - az, x - ax), carrying: e, carryMode: 'shoulder' }, 'gentle', e, 'shoulder'); return p ? Math.hypot(p.x - x, p.z - z) : 9; };
  const clearTo = (ax, az) => g.walkableAt(ax, az) && landing(ax, az) < 0.45;
  if (L > 0.8 && !clearTo(sx, sz)) {
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8, ax = x + Math.cos(a) * 0.6, az = z + Math.sin(a) * 0.6, bx = x + Math.cos(a) * 1.4, bz = z + Math.sin(a) * 1.4;
      if (!clearTo(ax, az) || !g.walkableAt(bx, bz)) continue;
      const d = Math.hypot(bx - u.x, bz - u.z);
      if (!best || d < best.d) best = { d, ax, az, bx, bz };
    }
    if (best) {
      try { await D.go(role, best.bx, best.bz, { tol: 0.35, max: 60 }); } catch (err) { if (!/short of/.test(err.message)) throw err; }
      [sx, sz] = [best.ax, best.az];
    }
  }
  try { await D.go(role, sx, sz, { tol: 0.35, max: 60 }); } catch (err) {
    if (/refused/.test(err.message)) throw new Error(`carry ${e.tag}: (${x},${z}) out of reach: ${err.message}`);
    if (!/short of|stopped at/.test(err.message) || Math.hypot(u.x - sx, u.z - sz) > 1.6) throw err;
  }
  // (where he would land with her as she stands now, facing the way she came in)
  const landsAt = () => { const p = dropSpot({ world: D.world, x: u.x, z: u.z, y: 0, heading: u.heading, carrying: e, carryMode: 'shoulder' }, 'gentle', e, 'shoulder'); return p ? Math.hypot(p.x - x, p.z - z) : 9; };
  // (stopped short — a corner in the way — or not facing the spot: from wherever round it he would land on it from,
  // a step out and in again towards it)
  if (Math.hypot(u.x - sx, u.z - sz) > 0.45 || landing(u.x, u.z) > 0.45 || landsAt() > 0.45) {
    const cands = [];
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8, ax = x + Math.cos(a) * 0.6, az = z + Math.sin(a) * 0.6;
      const bx = x + Math.cos(a) * 1.3, bz = z + Math.sin(a) * 1.3;
      if (clearTo(ax, az) && g.walkableAt(bx, bz)) cands.push([Math.hypot(bx - u.x, bz - u.z), ax, az, bx, bz]);
    }
    cands.sort((p1, p2) => p1[0] - p2[0]);
    // (out a step, then in towards the spot: she faces it as she puts him down)
    for (const [, ax, az, bx, bz] of cands.slice(0, 4)) {
      try { await D.go(role, bx, bz, { tol: 0.3, max: 30 }); await D.go(role, ax, az, { tol: 0.3, max: 30 }); } catch { /* try the next side */ }
      if (Math.hypot(u.x - ax, u.z - az) <= 0.45) break;
    }
    if (DBG) D.log(`DBG carry ${e.tag}: short of the spot, came round to (${u.x.toFixed(2)},${u.z.toFixed(2)})`);
  }
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `let go of ${e.tag}`);
  await D.idle(role);
  if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${e.tag}'s body laid at (${e.x.toFixed(2)},${e.z.toFixed(2)}) for (${x},${z})`);
}

/**
 * Where the put-down left body `e` would be seen within `quiet` s (but by `later`): carry him on to the first of
 * `cands` nobody would see him carried to, nor lying at (a put-down may lay a man a metre off the spot aimed at).
 */
async function settleBody(D, role, e, cands, { quiet = 300, later = [], maxSec = 120 } = {}) {
  // (the body comes to rest first: the fall, the ragdoll)
  const t0 = D.t;
  await D.until(() => e.settled || D.t > t0 + 4, 6, `${e.tag}'s body at rest`);
  for (let k = 0; k < 4; k++) {
    const seen = await sliced(D, asIfReleasedG(D, bodySeenG(D, e.x, e.z, quiet, { except: [e, ...later] })));
    if (!seen.length) return;
    D.log(`WARN ${e.tag}'s body at (${e.x.toFixed(1)},${e.z.toFixed(1)}) would be seen by ${seen.join(',')}: moved on`);
    let pick = null;
    await waitFor(D, function* (why) {
      for (const c of cands) {
        if (Math.hypot(c[0] - e.x, c[1] - e.z) < 0.5) continue;
        if ((yield* stashSeenMemoG(D, c[0], c[1], quiet, [e, ...later])).length) continue;
        const u = D.c(role), w0 = way(D, [u.x, u.z], [[e.x, e.z]], role, 'stand'), w1 = way(D, [e.x, e.z], [c], role, 'stand');
        if (w1.short) continue;
        const t0 = pathLen([u.x, u.z], w0) / 2 + 1.2;
        if (yield* standSeenG(D, [...timed([e.x, e.z], w1, 1.5, t0), [c[0], c[1], 0, t0 + pathLen([e.x, e.z], w1) / 1.5 + 0.9]], { slack: 0.8, why })) continue;
        pick = c; return true;
      }
      return false;
    }, maxSec, `move ${e.tag}'s body on`);
    await carryTo(D, role, e, pick);
  }
}

/** stashSeen, remembered for 2 s of game time (the waits ask it every 0.2 s) */
const _ssMemo = new Map();
function* stashSeenMemoG(D, x, z, quiet, except, ring = 0.8) {
  const k = `${x.toFixed(2)},${z.toFixed(2)},${quiet},${ring},${Math.floor(D.t / 2)},${except.map((e) => e.tag).join()}`;
  let r = _ssMemo.get(k);
  if (!r) { r = yield* stashSeenG(D, x, z, quiet, except, ring); if (_ssMemo.size > 5000) _ssMemo.clear(); _ssMemo.set(k, r); }
  return r;
}

/**
 * Run `fn` with every walker the Spy is holding seen as if he walked his beat again (he will, once she leaves him): a
 * body's hiding place must be out of his sight then too. Nothing ticks meanwhile; his state is put back after.
 */
function asIfReleased(D, fn) {
  const held = D.world.enemies.filter((e) => e.alive && e.brain?.state === 'DISTRACTED' && e.route?.length > 1);
  const saved = held.map((e) => [e, e.brain.state, e.brain.distractedBy, e.path]);
  const posts = D.world.enemies.some((e) => e._realPost != null);
  if (!held.length && !posts) return fn();
  // (an empty path: sneak.walking takes a man standing still for more than 3 s off his halt for one stuck)
  for (const e of held) { e.brain.state = 'IDLE'; e.brain.distractedBy = null; if (!e.path) e.path = []; }
  realPosts(D, true);
  const ep = releaseEpoch;
  releaseEpoch = 1;
  try { return fn(); } finally { for (const [e, st, by, pa] of saved) { e.brain.state = st; e.brain.distractedBy = by; e.path = pa; } realPosts(D, false); releaseEpoch = ep; }
}

/**
 * A post the Spy is talking to faces her for as long as she talks (enemy-brain _distracted: no time limit, no sweep);
 * sneak's static model would turn him back to his post any moment. While a wait thinks, such a post's post heading is
 * his heading (`_realPost` keeps the true one; asIfReleased puts it back: once she goes, he faces his post again).
 */
function fixHeldPosts(D) {
  const sp = D.c('spy'), w = D.world;
  const held = w.enemies.filter((e) => e.alive && e.post && e.brain?.state === 'DISTRACTED' && e.brain.distractedBy === sp && !(e.route?.length > 1) && e._realPost == null);
  for (const e of held) { e._realPost = e.post.heading; e.post.heading = e.heading; }
  // (and a post turned to a beeping decoy — the bunker gunner: he faces it, sweeping about it, as long as it sounds,
  // and it sounds to the end: his post heading is the decoy's bearing; no asIfReleased puts that back)
  const decoys = w.interactables.filter((i) => i.interactKind === 'decoy' && i.on && !i.removed);
  const R = CONFIG.ai.decoy.radius;
  const lured = decoys.length ? w.enemies.filter((e) => e.alive && e.post && !held.includes(e) && !(e.route?.length > 1) && e._lurePost == null
    && decoys.some((d) => Math.hypot(d.x - e.x, d.z - e.z) <= R)) : [];
  for (const e of lured) {
    const d = decoys.find((q) => Math.hypot(q.x - e.x, q.z - e.z) <= R), b = Math.atan2(d.z - e.z, d.x - e.x);
    if (Math.abs(Math.atan2(Math.sin(e.heading - b), Math.cos(e.heading - b))) > 0.2) continue; // (not turned to it yet)
    e._lurePost = e.post.heading; e.post.heading = e.heading;
  }
  return () => {
    for (const e of held) { e.post.heading = e._realPost; e._realPost = null; }
    for (const e of lured) if (e._lurePost != null) { e.post.heading = e._lurePost; e._lurePost = null; }
  };
}
/** D.runSliced with the held and lured posts modelled as in the waits (fixHeldPosts) */
async function sliced(D, g) { const unfix = fixHeldPosts(D); try { return await D.runSliced(g); } finally { unfix(); } }
const realPosts = (D, on) => { for (const e of D.world.enemies) if (e._realPost != null) e.post.heading = on ? e._realPost : e.heading; };
/** asIfReleased for a generator: the held men walk again for its whole run (put back while it hands the frame back) */
function* asIfReleasedG(D, g) {
  const held = D.world.enemies.filter((e) => e.alive && e.brain?.state === 'DISTRACTED' && e.route?.length > 1);
  const posts = D.world.enemies.some((e) => e._realPost != null);
  if (!held.length && !posts) return yield* g;
  const saved = held.map((e) => [e, e.brain.state, e.brain.distractedBy, e.path]);
  const ep = releaseEpoch;
  const on = () => { for (const e of held) { e.brain.state = 'IDLE'; e.brain.distractedBy = null; if (!e.path) e.path = []; } realPosts(D, true); releaseEpoch = 1; };
  const off = () => { for (const [e, st, by, pa] of saved) { e.brain.state = st; e.brain.distractedBy = by; e.path = pa; } realPosts(D, false); releaseEpoch = ep; };
  on();
  try {
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      off(); yield; on();
    }
  } finally { off(); }
}
/** Would a body at (x, z) — or a step off it, where a put-down may leave it — be seen within `quiet` s? (settleBody
 *  moves one that lands further off) */
const STASH_RING = [[0, 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0.8 * Math.cos((k * Math.PI) / 4), 0.8 * Math.sin((k * Math.PI) / 4)])];
function* stashSeenG(D, x, z, quiet, except, ring = 0.8) {
  return yield* asIfReleasedG(D, (function* () {
    for (const [dx, dz] of STASH_RING) {
      if (ring !== 0.8 && (dx || dz)) { const s = yield* bodySeenG(D, x + (dx * ring) / 0.8, z + (dz * ring) / 0.8, quiet, { except }); if (s.length) return s; continue; }
      const s = yield* bodySeenG(D, x + dx, z + dz, quiet, { except });
      if (s.length) return s;
    }
    return [];
  })());
}
const stashSeen = (...a) => drain(stashSeenG(...a));

/**
 * Would a man walking `pts` (looking any way: his sweeps, his turns) see a body lying at (x, z)? For a guard's future
 * way the waits' predictions know nothing of: e5, drawn out of the yard by the decoy (stage E), goes round by the back
 * gate and the river path to the yard's north-west corner — in sight of most of the west strip.
 */
/** Spots on the west strip out of sight of e5's way to the decoy (E5_WAY), nearest `from` first (a third number: the
 *  ring the put-down may lay a body off them) */
function stripHidden(D, from, n = 14) {
  const g = D.world.grid, e5 = D.get('e5'), out = [];
  for (let x = 1; x <= 29; x += 1) for (let z = 108; z <= 125; z += 1) if (standable(g, x, z) && !seenFromWay(D, e5, E5_WAY, x, z)) out.push([x, z, 0.45]);
  return out.sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1])).slice(0, n);
}
/** Spots west of Patrol 16's west halt beyond the bunker gunner's sight of a body (36 m; 37.5 kept), nearest `from` first */
function p16Stashes(D, from, n = 12) {
  const g = D.world.grid, bk = D.get('e_bk'), out = [];
  for (let x = 18; x <= 31; x += 1) for (let z = 97; z <= 108; z += 1) if (standable(g, x, z) && Math.hypot(x - bk.x, z - bk.z) >= 37.5) out.push([x, z, 0.45]);
  return out.sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1])).slice(0, n);
}
function seenFromWay(D, proto, pts, x, z) {
  const w = D.world, d = dummyAt(w, 'body', x, z), far = proto.vision?.far ?? 36, m = mirrorOf(proto);
  for (const [px, pz] of pts) {
    if (Math.hypot(px - x, pz - z) > far) continue;
    for (let k = 0; k < 8; k++) {
      const g = ghostOn(m); g.x = px; g.z = pz; g.heading = (k * Math.PI) / 4;
      if (canSee(g, d, w, { cone: coneAt(g, w.time) }) !== 'none') return true;
    }
  }
  return false;
}

/** Where `e` will stand and face `t` s from now: a walker on his beat (predict), a post where he stands, square to his post. */
function poseAt(e, t) {
  if (walking(e)) return predict(e, t);
  return { x: e.x, z: e.z, heading: e.post?.heading ?? e.heading };
}

/**
 * The Spy (in uniform: nobody minds her walking up) injects `victim` from behind and shoulders him to `stash` along
 * `via` (no stash: he lies where he falls). She strikes only when, from the moment the needle goes in (a suspicious
 * act: judged as if she wore no uniform), nobody but him would see her at his back, the body falling, her carrying it
 * and putting it down; he does not see her at his back; nobody but the men in `later` would find the body for `quiet`
 * s where it ends up. `ready(e)`: the moment's other conditions (where he is on his beat).
 */
async function strike(D, victim, { stash = null, stashes = null, via = [], ready = () => true, later = [], quiet = 300, maxSec = 600, reach = 1.1, slack = 0.8, label = '', maxT = 16, sides = null, tries = 25, every = 0.2, laterT = [], turn: turnM = 0.45 } = {}) {
  const sp = D.c('spy');
  // (`victim` a list: whichever of them can be taken first; `stashes` then a function of the man)
  const pick = Array.isArray(victim) ? victim.map((t) => (typeof t === 'string' ? D.get(t) : t)) : null;
  if (pick) victim = pick[0];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  // each option: { at: [x, z] | null (he lies where he falls), via: [...] }
  const optsMemo = new Map();
  function* optsOfG(v) {
    const m = optsMemo.get(v);
    if (m && D.t - m.t < 20) return m.list;
    let raw = typeof stashes === 'function' ? stashes(v) : (stashes ?? [stash]);
    if (raw && typeof raw.next === 'function') raw = yield* raw;
    const list = raw.map((o) => (Array.isArray(o) || o == null ? { at: o, via } : o));
    optsMemo.set(v, { t: D.t, list });
    return list;
  }
  let opts = pick ? null : drain(optsOfG(victim));
  /**
   * Would the needle go in unseen with her at `back` (the victim at `q`, `side` rad off his back) `tHit` s from now,
   * and the body be carried unseen to one of `opts`? → the plan, or null (why[] says who would see).
   */
  function* judgeG(back, side, tHit, q, why, sl = slack) {
    const fh = q.heading + side;
    // the contact injection as the game will lay it out (abilities/spy-actions.js injectionPlan): her step in to his
    // back, his body laid on its back ahead of where he stood (his hips where his feet were), her step back
    const P = injectionPlan(D.world, { x: back[0], z: back[1], y: 0, heading: fh, stance: 'stand', kind: 'commando' },
      { x: q.x, z: q.z, y: 0, heading: q.heading, stance: 'stand', kind: 'enemy', soldierType: victim.soldierType });
    const lie = P?.lie ? [P.lie.x, P.lie.z] : [q.x, q.z];
    const spyAt = [back, P?.to ? [P.to.x, P.to.z] : [q.x, q.z], P?.back ? [P.back.x, P.back.z] : back];
    // (judged without the uniform only while she does something suspicious: the needle — the order, the blow, his
    // fall — and the carrying; stooping over him and lifting him she is a German soldier by a fallen comrade, whose
    // body is what anyone would see then)
    const atBack = []; for (let t = tHit - 0.4; t <= tHit + 1.0; t += 0.2) for (const p of spyAt) atBack.push([p[0], p[1], 0, t]);
    for (let t = tHit + 3.0; t <= tHit + 4.2; t += 0.3) atBack.push([lie[0], lie[1], 0, t]);
    // he must not see her at his back, as he would without the uniform
    if (yield* standSeenG(D, [[back[0], back[1], 0, tHit]], { slack: Math.min(sl, 0.5), why, keepWalker: 0, only: victim, pad: 0, turn: turnM })) return null;
    // (`lat`: she may end up a little to one side of the planned spot — a third of a metre; judged again from where she
    // really stands before the needle, a few centimetres)
    if (yield* standSeenG(D, atBack, { slack: sl, why, except: [victim], lat: sl === slack ? 0.3 : 0.15, turn: turnM })) return null;
    // his fall (seen upright: the kill rule, enemy-brain notifyKill), then the body where it lies until she lifts it
    const fallAt = []; for (let t = tHit + 0.3; t <= tHit + 0.9; t += 0.2) fallAt.push([lie[0], lie[1], 0, t], [q.x, q.z, 0, t]);
    if (yield* standSeenG(D, fallAt, { slack: sl, why, except: [victim], pad: 0, turn: turnM })) return null;
    const bodyAt = []; for (let t = tHit + 0.8; t <= tHit + 4.0; t += 0.5) bodyAt.push([lie[0], lie[1], 0, t]);
    if (yield* standSeenG(D, bodyAt, { slack: sl, why, except: [victim], body: true, pad: 0, turn: turnM })) return null;
    // (the stashes for this man worked out only now: the costly part, and most moments fail before it)
    if (pick) opts = yield* optsOfG(victim);
    for (const o of opts) {
      const dropAt = o.at || lie;
      let w = [];
      if (o.at) {
        w = way(D, lie, [...o.via, o.at], 'spy', 'stand');
        if (w.short) { why.push(`stash (${o.at}) out of reach`); continue; }
        // (she has him on her shoulder 1.9–3.0 s after the needle, as the game times the death throes and the grab)
        const carryWay = timed(lie, w, 1.5, tHit + 2.4);
        if (yield* standSeenG(D, [[lie[0], lie[1], 0, tHit + 1.8], ...carryWay, [...o.at, 0, carryWay.at(-1)[3] + 1.2]], { slack: sl + 0.4, why, except: [victim], lat: 0.6, turn: turnM })) continue;
      }
      const finders = (yield* stashSeenMemoG(D, dropAt[0], dropAt[1], quiet, [victim, ...later], o.at ? (o.at[2] ?? o.ring ?? 0.8) : 0.8));
      if (finders.length) { why.push(`body at (${dropAt}) seen by ${finders.join(',')}`); continue; }
      return { tHit, back, o, q, side, lie, way: w };
    }
    return null;
  }
  for (let attempt = 0; ; attempt++) {
    let plan = null;
    await waitFor(D, function* (why) {
      plan = null;
      const firsts = [];
      for (const v of pick ? pick.filter((e) => e.alive) : [victim]) {
      victim = v;
      const n0 = why.length;

      if (!victim.alive) { why.push('dead'); return false; }
      if (!ready(victim)) { why.push('not-ready'); continue; }
      // (from straight behind him; a man standing still also from behind on either side: his cone is ±65° at most)
      const sideList = sides ?? (walking(victim) ? [0] : [0, 0.5, -0.5, 1.0, -1.0]);
      for (const side of sideList) {
        // where she catches him: walking (2.25 m/s, ~2.0 with the turns) to arm's length behind him
        let tHit = null, q = null, back = null;
        for (let t = 0.3; t <= maxT; t += 0.2) {
          q = poseAt(victim, t);
          back = [q.x - Math.cos(q.heading + side) * reach, q.z - Math.sin(q.heading + side) * reach];
          if (Math.hypot(back[0] - sp.x, back[1] - sp.z) / 2.0 + 0.2 <= t) { tHit = t; break; }
        }
        if (tHit == null) { why.push('cannot catch him'); continue; }
        // (`later`: a few later moments too — she can walk on behind him: a walker turning at the end of his beat sees
        // her at the first)
        for (const dt of [0, ...laterT]) {
          const th = tHit + dt;
          if (th > maxT) break;
          const qq = dt ? poseAt(victim, th) : q;
          const bb = dt ? [qq.x - Math.cos(qq.heading + side) * reach, qq.z - Math.sin(qq.heading + side) * reach] : back;
          if (!D.world.grid.walkableAt(bb[0], bb[1])) { why.push('no footing behind him'); continue; }
          plan = yield* judgeG(bb, side, th, qq, why);
          if (plan) return true;
        }
      }
      if (pick && why.length > n0) firsts.push(`${v.tag}:${why.slice(n0).find((r) => !/no footing|cannot catch/.test(r)) ?? why[n0]}`);
      }
      // (several men: the first reason for each)
      if (pick) { why.length = 0; why.push(...firsts); }
      return false;
    }, maxSec, `${pick ? pick.map((e) => e.tag).join('|') : victim.tag} unwatched${label ? ' ' + label : ''}`, every);
    dbg(D, `strike ${victim.tag}: hit in ${plan.tHit.toFixed(1)} s at (${plan.q.x.toFixed(1)},${plan.q.z.toFixed(1)}) h${Math.round(plan.q.heading * 180 / Math.PI)} back (${plan.back.map((v) => v.toFixed(1))}), body to ${plan.o.at ?? 'where he falls'} lie (${plan.lie.map((v) => v.toFixed(1))}) way ${plan.way.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}`);
    await D.stance('spy', 'stand');
    const t0 = D.t;
    // (to her spot at his back as planned, and the needle at the planned moment: early, she waits there)
    for (let n = 0; n < 200 && D.t < t0 + plan.tHit - 0.05; n++) {
      const q = poseAt(victim, Math.max(0, plan.tHit - (D.t - t0)));
      const bx = q.x - Math.cos(q.heading + plan.side) * reach, bz = q.z - Math.sin(q.heading + plan.side) * reach;
      if (Math.hypot(bx - sp.x, bz - sp.z) > 0.25) D.order('spy', { type: 'move', x: bx, z: bz });
      await D.wait(Math.min(0.2, Math.max(D.dt, t0 + plan.tHit - 0.05 - D.t)));
    }
    // where she really stands (a stone or his own body may keep her a little off the planned spot): judged again from
    // there, now; not clear, or not behind him: no needle, plan it again
    const q = poseAt(victim, 0.05), off = Math.atan2(q.z - sp.z, q.x - sp.x) - q.heading;
    const behindNow = Math.cos(off) > Math.cos((65 * Math.PI) / 180) && Math.hypot(q.x - sp.x, q.z - sp.z) <= 1.3;
    const why = [], now = behindNow ? await sliced(D, judgeG([sp.x, sp.z], Math.atan2(Math.sin(off), Math.cos(off)), 0.05, q, why, 0.4)) : null;
    if (!now) {
      if (attempt >= tries) throw new Error(`strike ${victim.tag}: no clean moment from where she stands (${why.slice(0, 3).join(' ')})`);
      D.log(`WARN strike ${victim.tag}: at (${sp.x.toFixed(1)},${sp.z.toFixed(1)}) ${behindNow ? `seen [${why.slice(0, 2).join(' ')}]` : 'not at his back'}: again`);
      // (a step back from him first, to come at him afresh: in uniform, nobody minds)
      if (!behindNow) {
        const h = Math.atan2(sp.z - q.z, sp.x - q.x), g = D.world.grid;
        for (const d of [2.5, 2.0, 3.0]) { const x = q.x + Math.cos(h) * d, z = q.z + Math.sin(h) * d; if (g.walkableAt(x, z)) { try { await D.go('spy', x, z, { tol: 0.5, max: 10 }); } catch { /* close enough */ } break; } }
      }
      continue;
    }
    if (DBG) D.log(`DBG strike ${victim.tag} now: ${D.world.enemies.filter((e) => e.alive && e !== victim && Math.hypot(e.x - sp.x, e.z - sp.z) < 25).map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)} ${e.brain?.state}${e.brain?.atWait ? ' wait' : ''}`).join(' | ')}`);
    D.ability('spy', 'syringe', victim);
    const tS = D.t;
    await D.until(() => !victim.alive, 6, `${victim.tag} injected`);
    const tK = D.t;
    await D.idle('spy', 5);
    if (DBG && now.o.at) { const v0 = victim; D.world.__carryT = () => { if (sp.carrying === v0) { dbg(D, `TIMELINE ${v0.tag}: needle +0, dead +${(tK - tS).toFixed(2)}, idle +${(D.t - tS).toFixed(2)}`); D.world.__carryT = null; } }; }
    if (now.o.at) await carryTo(D, 'spy', victim, now.o.at, now.o.via);
    await settleBody(D, 'spy', victim, opts.map((o) => o.at).filter((c) => c && c !== now.o.at), { quiet, later });
    return { victim, at: now.o.at };
  }
}

/**
 * One go along `pts` without stopping (crawling, walking or running), once nobody would see him anywhere on the way at
 * the pace he goes (tried slow and fast), nor at its end for `hold` s. `pts` may be a function (the way laid afresh).
 */
async function dash(D, role, pts, { mode = 'crawl', maxSec = 300, label = '', pad = null, slack = 1, slackRate = 0, hold = 0, keepWalker = 4, except = null, ready = null, onGo = null, speeds: sp0 = null, every = 0.2, tol = 0.5 } = {}) {
  const u = D.c(role), w = D.world;
  if (pad == null) pad = mode === 'crawl' ? 2.5 : 1.2; // (a crawler's band edge, 18 m: a file man's place at a halt is loose)
  const speeds = sp0 ?? (mode === 'crawl' ? [0.7, 0.8, 0.9] : mode === 'run' ? [4.0, 4.5] : [1.9, 2.3]);
  const want = mode === 'crawl' ? 'crawl' : 'stand';
  const up = u.stance === want ? 0 : 0.7;
  let route = null;
  await waitFor(D, function* (why) {
    if (ready && !ready()) { why.push('not-ready'); return false; }
    route = typeof pts === 'function' ? pts() : pts;
    if (up && mode !== 'crawl' && (yield* standSeenG(D, [[u.x, u.z, u.y || 0, 0.3], [u.x, u.z, u.y || 0, up]], { slack: 0.4, why, except: except || [] }))) return false;
    for (const speed of speeds) if (!(yield* routeClearG(D, route, { mode: mode === 'run' ? 'walk' : mode, from: [u.x, u.z], speed, delay: up, slack, slackRate, hold, keepWalker, pad, why, except }))) return false;
    return true;
  }, maxSec, label || `${role} along ${JSON.stringify(typeof pts === 'function' ? '(way)' : pts)}`, every);
  await D.stance(role, want);
  if (DBG) dbg(D, `${label || role}: go ${route.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}`);
  onGo?.();
  for (const [x, z] of route) {
    try { await D.go(role, x, z, { tol, max: 90, run: mode === 'run' }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  }
}

/**
 * A spot `d` m behind `v` (his back), walkable and reached from where `role` is without a long way round (a spot
 * against a wall is reached through the camp gate otherwise): the nearest of a few distances and side offsets.
 */
function behind(D, role, v, d = 2.5) { return behindAll(D, role, v, d)[0] ?? null; }
/** every such spot behind `v`, the straightest first */
function behindAll(D, role, v, d = 2.5) {
  const u = D.c(role), g = D.world.grid, out = [];
  // (a post's cone reaches at most 80° either side of his post heading: from 1.6 rad off his back he is still behind)
  for (const side of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) for (const dd of [d, d - 1]) {
    const h = v.heading + Math.PI + side, x = v.x + Math.cos(h) * dd, z = v.z + Math.sin(h) * dd;
    if (!g.walkableAt(x, z) || !g.walkableAt(x + 0.35, z) || !g.walkableAt(x - 0.35, z) || !g.walkableAt(x, z + 0.35) || !g.walkableAt(x, z - 0.35)) continue;
    const w = way(D, [u.x, u.z], [[x, z]], u);
    if (pathLen([u.x, u.z], w) < Math.hypot(x - u.x, z - u.z) * 1.4 + 3) out.push([x, z]);
  }
  return out;
}

/** The man as the guards would see him (a standing stand-in; for the Spy: without the uniform). */
const bare = (u, x = u.x, z = u.z) => ({ x, z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/** Does `e` (now, and over the next `ahead` s as predicted) have `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world, m = mirrorOf(e);
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = ghostOn(m); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
  }
  return false;
}

/**
 * The Green Beret knifes `victim` (walking up to him from where he stands, on his feet), once `ready()` holds, the
 * victim does not see him coming and nobody else sees the blow, him or the body falling; nobody but `later` would
 * find the body for `quiet` s (or, with `carry`, where he carries it, unseen on the way).
 */
async function knife(D, victim, { ready = () => true, later = [], quiet = 120, maxSec = 300, reach = 3.5, label = '', carry = null, via = [], carrySlack = 1.5 } = {}) {
  const gb = D.c('greenberet');
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  const carries = carry == null ? [null] : (carry[0] === null || Array.isArray(carry[0])) ? carry : [carry];
  let pick = null;
  await waitFor(D, function* (why) {
    if (!ready()) { why.push('not-ready'); return false; }
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > reach) { why.push('far'); return false; }
    const me = bare(gb);
    if (eyesOn(D, victim, me, 1.6)) { why.push('victim looks'); return false; }
    const held = []; // (men held by the Spy still see what is in front of them: their cones count)
    if (!unwitnessed(D, victim, me, { ahead: 1.6, strict: true, why, except: held })) return false;
    const L = Math.hypot(victim.x - gb.x, victim.z - gb.z);
    const approach = timed([gb.x, gb.z], [[victim.x, victim.z]], 2.0, 0.5);
    if (yield* standSeenG(D, [...approach, [victim.x, victim.z, 0, L / 2 + 1.5], [victim.x, victim.z, 0, L / 2 + 3]], { slack: 0.6, why, except: [victim, ...held] })) return false;
    for (const c of carries) {
      // (the lift and the carry, timed loosely: he gets up, walks over, strikes, stoops — a second or two either way)
      const cw = c ? way(D, [victim.x, victim.z], [...via, c], 'greenberet', 'stand') : null;
      if (cw?.short) continue;
      // (the carry sets off as the game times it: up off his belly 0.6 s, the walk over, the blow, the lift 1.3 s)
      const t0c = (gb.stance === 'stand' ? 0 : 0.6) + L / 2 + 1.9;
      if (c && (yield* standSeenG(D, timed([victim.x, victim.z], cw, 1.5, t0c), { slack: carrySlack, why, except: [victim, ...held], lat: 0.6 }))) continue;
      const at = c || [victim.x, victim.z];
      const finders = (yield* stashSeenMemoG(D, at[0], at[1], quiet, [victim, ...later], c?.[2] ?? 0.8));
      if (finders.length) { why.push(`body at (${at}) seen by ${finders.join(',')}`); continue; }
      pick = c;
      return true;
    }
    return false;
  }, maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  if (gb.stance !== 'stand') await D.stance('greenberet', 'stand');
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run: false });
  await D.until(() => !victim.alive, 10, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
  if (pick) await carryTo(D, 'greenberet', victim, pick, via);
  // (where the body really lies: a man knifed falls ahead of where he stood, a ragdoll may roll him on)
  await settleBody(D, 'greenberet', victim, carries.filter((c) => c && c !== pick), { quiet, later });
  return pick;
}

/**
 * The Green Beret takes `v` (one of the held squad `pt`, the others listening to the Spy) from behind: he crawls up
 * to a spot at his back once nobody would see him on the way nor lying there for a while, knifes him and carries him
 * to `stash`; if the knife's moment does not come soon, he crawls back to where he came from and tries again.
 */
async function gbTakes(D, v, pt, stash, { maxTries = 12, ready = null, later = [], hold = 14, pad = 2.5, quiet = 120, carrySlack = 1.5 } = {}) {
  const gb = D.c('greenberet'), home = [gb.x, gb.z];
  for (let k = 0; ; k++) {
    // (a spot at his back he can crawl to and lie on a while unseen: the straightest that is clear now)
    let route = null;
    await waitFor(D, function* (why) {
      if (ready && !ready()) { why.push('not-ready'); return false; }
      const others = pt.filter((e) => e.alive);
      for (const stand of behindAll(D, 'greenberet', v).slice(0, 12)) {
        const r = way(D, [gb.x, gb.z], [stand], gb, 'crawl');
        let clear = true;
        for (const speed of [0.7, 0.9]) if (!(yield* routeClearG(D, r, { mode: 'crawl', from: [gb.x, gb.z], speed, slack: 1, hold, keepWalker: 4, pad, why, except: others }))) { clear = false; break; }
        if (!clear) continue;
        // (and the knife likely then: nobody but him would see him get up at his back, strike and the man fall, as
        // the cones are predicted for when he gets there)
        const ta = pathLen([gb.x, gb.z], r) / 0.8 + 0.7, vq = poseAt(v, ta);
        const spots = []; for (let t = ta; t <= ta + 3; t += 0.5) spots.push([stand[0], stand[1], 0, t], [vq.x, vq.z, 0, t + 0.6]);
        if (yield* standSeenG(D, spots, { slack: 1, why, except: [v] })) continue;
        route = r; return true;
      }
      return false;
    }, 600, `the Green Beret behind ${v.tag}`, 0.5).catch((err) => {
      const tags = [...new Set((err.message.match(/\b(e\d+|p\d+\w)@/g) || []).map((q) => q.slice(0, -1)))];
      D.log(`DBG gbTakes ${v.tag} viewers: ${tags.map((t) => { const e = D.get(t); return `${t}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(e.heading * 180 / Math.PI)} ${e.brain?.state} walking=${walking(e)} path=${!!e.path} moving=${!!e.isMoving} sweep=${e.sweepActive}`; }).join(' | ')}`);
      throw err;
    });
    await D.stance('greenberet', 'crawl');
    for (const [x, z] of route) { try { await D.go('greenberet', x, z, { tol: 0.5, max: 60 }); } catch (err) { if (!/short of|refused/.test(err.message)) throw err; } }
    try {
      const used = await knife(D, v, { later: [...pt.filter((e) => e.alive && e !== v), ...later.filter((e) => e !== v)], carry: stash, maxSec: 8, quiet, carrySlack });
      await D.stance('greenberet', 'crawl');
      return used;
    } catch (e) {
      if (!/timeout/.test(e.message) || k >= maxTries) throw e;
      dbg(D, `gbTakes ${v.tag}: no moment (${e.message.slice(0, 120)}), back to (${home.map((q) => q.toFixed(1))})`);
      // (back the way he came, as soon as nobody would see him on it: the spot was chosen clear for 14 s, he has
      // waited 8 of them; meanwhile the knife may still come)
      for (let r = 0; ; r++) {
        try { await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [home], gb, 'crawl'), { mode: 'crawl', except: pt.filter((e) => e.alive), hold: 6, pad, maxSec: 2, label: 'the Green Beret back' }); break; } catch (e2) {
          if (!/timeout/.test(e2.message) || r > 20) throw e2;
        }
        try { const used = await knife(D, v, { later: [...pt.filter((e) => e.alive && e !== v), ...later.filter((e) => e !== v)], carry: stash, maxSec: 1, quiet, carrySlack }); await D.stance('greenberet', 'crawl'); return used; } catch (e3) {
          if (!/timeout/.test(e3.message)) throw e3;
        }
      }
    }
  }
}

/** Body stashes nobody ever looks at (static scans), each used once; `strikeAuto` picks the nearest free ones. */
const usedStash = new Set();
/** a stash's key in usedStash: its place (a third number, its own ring, left out) */
const sk = (p) => `${p[0]},${p[1]}`;
/** Body stashes for `v`: the free static ones and spots round him (2–12 m) nobody would look at for `quiet` s, nearest first. */
/** a walker on his way to (x, z) (his path ends there) */
const walkingTo = (e, x, z) => { const p = e.path?.at?.(-1) ?? e.path?.points?.at?.(-1); return !!p && Math.hypot(p.x - x, p.z - z) < 2; };
function* stashCandsG(D, v, { pool = YARD_STASH, n = 8, quiet = 300, later = [], minNb = 4, ring: ringR = 0.8, noRing = false, who = 'spy', notFrom = null } = {}) {
  const g = D.world.grid, ring = [];
  for (let r = 2; r <= (noRing ? 0 : 12); r += 1.5) for (let a = 0; a < 2 * Math.PI; a += 1.5 / r) {
    const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
    if (g.walkableAt(x, z)) { const wy = way(D, [v.x, v.z], [[x, z]], who, 'stand'); if (!wy.short && pathLen([v.x, v.z], wy) < r * 1.5 + 2) ring.push([+x.toFixed(2), +z.toFixed(2)]); }
    yield;
  }
  const near = (p) => Math.hypot(p[0] - v.x, p[1] - v.z);
  const cands = [...pool.filter((p) => !usedStash.has(sk(p))), ...ring].sort((a, b) => near(a) - near(b));
  const free = [];
  for (const p of cands) {
    if (free.length >= n) break;
    if (free.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2)) continue;
    // (a spot a man can stand on and reach the short way: not under a tank's legs, not round a hut)
    if (!g.walkableAt(p[0], p[1]) || [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]].filter(([a, b]) => g.walkableAt(p[0] + a, p[1] + b)).length < minNb) continue;
    { const wy = way(D, [v.x, v.z], [p], who, 'stand'); if (wy.short || pathLen([v.x, v.z], wy) > Math.hypot(p[0] - v.x, p[1] - v.z) * 1.6 + 4) continue; }
    // (`notFrom`: {proto, pts}, a guard's way to come that must not overlook the spot)
    if (notFrom && seenFromWay(D, notFrom.proto, notFrom.pts, p[0], p[1])) continue;
    yield;
    // (a third number: that spot's own ring — a pocket the put-down lays a man in exactly, judged exactly)
    const rr = p[2] ?? ringR;
    if (!(yield* stashSeenG(D, p[0], p[1], quiet, [v, ...later], rr)).length) free.push(rr !== 0.8 ? [p[0], p[1], rr] : [p[0], p[1]]);
  }
  return free;
}
async function strikeAuto(D, tag, { pool = YARD_STASH, n = 8, quiet = 300, ...o } = {}) {
  const v = D.get(tag), sp = D.c('spy');
  // (in uniform she walks up to within a few steps of him first: nobody minds a German soldier)
  for (let k = 0; k < 6 && Math.hypot(v.x - sp.x, v.z - sp.z) > 9; k++) {
    const h = Math.atan2(sp.z - v.z, sp.x - v.x), g = D.world.grid;
    let went = false;
    for (const d of [5, 6.5, 4, 8]) for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const x = v.x + Math.cos(h + da) * d, z = v.z + Math.sin(h + da) * d;
      if (went || !g.walkableAt(x, z)) continue;
      // (a spot he can really get to: one reached the short way, not through a fence or round a wall)
      if (pathLen([sp.x, sp.z], way(D, [sp.x, sp.z], [[x, z]], sp)) > Math.hypot(x - sp.x, z - sp.z) * 1.6 + 6) continue;
      try { await D.go('spy', x, z, { tol: 1.0, max: 120 }); went = true; } catch (e) { if (/short of/.test(e.message)) went = true; else if (!/refused/.test(e.message)) throw e; }
    }
    if (!went) break;
  }
  const free = await sliced(D, stashCandsG(D, v, { pool, n, quiet }));
  dbg(D, `strikeAuto ${tag}: stashes ${JSON.stringify(free)}`);
  // (first choice: he lies where he falls, if nobody would ever see him there; else the nearest stash)
  await strike(D, v, { stashes: [null, ...free], quiet, ...o });
  if (free.length) usedStash.add(sk(free.reduce((b, p) => (Math.hypot(p[0] - v.x, p[1] - v.z) < Math.hypot(b[0] - v.x, b[1] - v.z) ? p : b), free[0])));
}

/**
 * The Spy takes whichever of `tags` she can first (strike, the man chosen afresh at every check), until all are dead;
 * `onKill(tag)` after each. She waits at `wait` (or where she is) between kills.
 */
async function strikeAny(D, tags, { pool = [], n = 8, quiet = 300, wait = null, maxSec = 3000, onKill = null, minNb = 4, ring = 0.8, noRing = false, ...o } = {}) {
  const left = tags.map((t) => D.get(t));
  while (left.some((e) => e.alive)) {
    if (wait) await walk(D, 'spy', [wait]);
    const r = await strike(D, left.filter((e) => e.alive), { laterT: [1.5, 3, 4.5], turn: 0.15, stashes: function* (v) { return [null, ...(yield* stashCandsG(D, v, { pool, n, quiet, minNb, ring, noRing }))]; }, quiet, maxSec, ...o });
    if (r.at) usedStash.add(sk(r.at));
    await onKill?.(r.victim.tag);
  }
}

/**
 * The Spy draws `tag` away from his beat and the men who watch him: from `at` (in uniform, out of everyone's sight)
 * she fires her pistol into the ground; he alone hears it (18 m) and comes over to look, she steps off to `aside`, and
 * injects him from behind as he looks about or walks back, when nobody else sees it.
 */
async function lureAndStrike(D, tag, at, aside, { pool = [], hear = 17.8, maxSec = 900 } = {}) {
  const v = D.get(tag), sp = D.c('spy'), w = D.world;
  await walk(D, 'spy', [at]);
  // (the shot: when he is within earshot and nobody would see her fire it, judged as if she wore no uniform)
  await waitFor(D, function* (why) {
    if (Math.hypot(v.x - at[0], v.z - at[1]) > hear) { why.push('out of earshot'); return false; }
    const others = w.enemies.filter((e) => e.alive && e !== v && Math.hypot(e.x - at[0], e.z - at[1]) < 18.5);
    if (others.length) { why.push(`${others.map((e) => e.tag).join(',')} would hear it too`); return false; }
    return !(yield* standSeenG(D, [[sp.x, sp.z, 0, 0], [sp.x, sp.z, 0, 0.8]], { slack: 0.4, why, keepWalker: 0 }));
  }, maxSec, `the moment to draw ${tag} off`);
  D.order('spy', { type: 'ability', id: 'pistol', target: { x: sp.x + 1.2, z: sp.z - 1.2 } });
  await D.until(() => v.brain?.state === 'INVESTIGATE', 4, `${tag} hears the shot`);
  await D.idle('spy', 3);
  // (the pistol back in its holster: drawn, she cannot walk)
  if (sp.armed) D.order('spy', { type: 'cancel' });
  await walk(D, 'spy', [aside]);
  const cands = await sliced(D, stashCandsG(D, v, { pool, minNb: 2, ring: 0.4 }));
  // (while he looks about at the shot's spot: back on his beat the men he walks among see him again — another shot then)
  await strike(D, v, { stashes: [null, ...cands], maxSec: 30, maxT: 24, every: 0.2, laterT: [1.5, 3, 4.5], label: 'drawn off' });
}

/** Patrol 16 well off east on the riverside path (its sergeant past the back gate, or walking away from the strip) */
function p16away(D) {
  const p = D.get('p16a');
  if (!p?.alive) return true;
  return p.x > 44 || (p.x > 36 && Math.cos(p.heading) > 0.3 && !p.brain?.atWait);
}

/**
 * The Spy injects `victim`, the man she is talking to (he faces her, fooled by the uniform: the contact injection from
 * the front, abilities/spy-actions.js), once nobody else would see the needle, him fall, his body lie before she lifts
 * it, nor her carry it to the first of `stashes` (null: he stays where he falls) and put it down; nobody but `later`
 * would find the body there for `quiet` s.
 */
async function injectHeld(D, victim, { stashes = [null], quiet = 300, later = [], maxSec = 600, label = '', slack = 0.8 } = {}) {
  const sp = D.c('spy');
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  let plan = null;
  await waitFor(D, function* (why) {
    plan = null;
    if (!victim.alive) { why.push('dead'); return false; }
    if (victim.brain?.state !== 'DISTRACTED') { why.push('not listening'); return false; }
    const P = injectionPlan(D.world, { x: sp.x, z: sp.z, y: 0, heading: Math.atan2(victim.z - sp.z, victim.x - sp.x), stance: 'stand', kind: 'commando' },
      { x: victim.x, z: victim.z, y: 0, heading: victim.heading, stance: 'stand', kind: 'enemy', soldierType: victim.soldierType });
    const lie = P?.lie ? [P.lie.x, P.lie.z] : [victim.x, victim.z], tHit = 0.6;
    const spyAt = [[sp.x, sp.z], P?.to ? [P.to.x, P.to.z] : [sp.x, sp.z]];
    const ex = { except: [victim], why, slack };
    // the needle (judged without the uniform), her stoop over him and the lift
    const atSpy = []; for (let t = 0; t <= tHit + 1.0; t += 0.2) for (const p of spyAt) atSpy.push([p[0], p[1], 0, t]);
    for (let t = tHit + 2.6; t <= tHit + 4.2; t += 0.3) atSpy.push([lie[0], lie[1], 0, t]);
    if (yield* standSeenG(D, atSpy, { ...ex, lat: 0.3, turn: 0.15 })) return false;
    // his fall, seen upright; then the body until she lifts it
    const fallAt = []; for (let t = tHit + 0.1; t <= tHit + 0.9; t += 0.2) fallAt.push([lie[0], lie[1], 0, t], [victim.x, victim.z, 0, t]);
    if (yield* standSeenG(D, fallAt, { ...ex, pad: 0, turn: 0.15 })) return false;
    const bodyAt = []; for (let t = tHit + 0.8; t <= tHit + 3.6; t += 0.5) bodyAt.push([lie[0], lie[1], 0, t]);
    if (yield* standSeenG(D, bodyAt, { ...ex, body: true, pad: 0, turn: 0.15 })) return false;
    for (const s of stashes) {
      const dropAt = s || lie;
      let w = [];
      if (s) {
        w = way(D, lie, [s], 'spy', 'stand');
        if (w.short) continue;
        const carryWay = timed(lie, w, 1.5, tHit + 2.4);
        if (yield* standSeenG(D, [...carryWay, [s[0], s[1], 0, carryWay.at(-1)[3] + 1.2]], { ...ex, slack: slack + 0.4, lat: 0.6, turn: 0.15 })) continue;
      }
      const finders = yield* stashSeenMemoG(D, dropAt[0], dropAt[1], quiet, [victim, ...later]);
      if (finders.length) { why.push(`body at (${dropAt.map((v) => v.toFixed(1))}) seen by ${finders.join(',')}`); continue; }
      plan = { at: s, lie };
      return true;
    }
    return false;
  }, maxSec, `${victim.tag} listening, unwatched${label ? ' ' + label : ''}`, 0.2);
  dbg(D, `injectHeld ${victim.tag}: body to ${plan.at ?? 'where he falls'}`);
  D.ability('spy', 'syringe', victim);
  await D.until(() => !victim.alive, 6, `${victim.tag} injected`);
  await D.idle('spy', 5);
  if (plan.at) await carryTo(D, 'spy', victim, plan.at);
  await settleBody(D, 'spy', victim, stashes.filter((c) => c && c !== plan.at), { quiet, later });
  return plan.at;
}

/**
 * The Marine, under water, spears `victim` once `ready()` holds: he comes up for the shot (0.4 s) where nobody but the
 * victim's own back would see him, nobody else sees the man fall, and the body (where it falls, or `hidden`) is found
 * by nobody but `later` for `quiet` s; then he is under water again. `from`: where he waits for the shot (in reach).
 */
async function spear(D, victim, { ready = () => true, later = [], quiet = 60, maxSec = 600, label = '' } = {}) {
  const m = D.c('diver');
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  const me = () => ({ x: m.x, z: m.z, y: 0, isLow: true, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  await waitFor(D, function* (why) {
    if (!victim.alive) return true;
    if (!ready(victim)) { why.push('not-ready'); return false; }
    if (D.t < (m._harpoonT ?? -1)) { why.push('reloading'); return false; }
    if (Math.hypot(victim.x - m.x, victim.z - m.z) > 8.5) { why.push('out of reach'); return false; }
    // (he comes up for 0.4 s: nobody may see him, the victim included; the man falls where he stands)
    if (yield* standSeenG(D, [[m.x, m.z, 0, 0], [m.x, m.z, 0, 0.5]], { slack: 0.3, why, keepWalker: 0, low: true })) return false;
    if (!unwitnessed(D, victim, me(), { ahead: 0.6, strict: true, why })) return false;
    const q = poseAt(victim, 0.25);
    const finders = (yield* stashSeenMemoG(D, q.x, q.z, quiet, [victim, ...later]));
    if (finders.length) { why.push(`body seen by ${finders.join(',')}`); return false; }
    return true;
  }, maxSec, `spear ${victim.tag}${label ? ' ' + label : ''}`, 0.05);
  D.ability('diver', 'harpoon', victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} speared`);
  await D.idle('diver', 3);
}


/**
 * `role` (the Spy or the Green Beret) walks over to body `e` and shoulders it to the first of `cands` nobody would see
 * him carry it to, nor see lying there for `quiet` s: he sets off once the whole way (to the body, the lift, the carry,
 * the put-down) is clear of every cone as predicted. A man lying down gets up for it.
 */
async function fetchBody(D, role, e, cands, { quiet = 300, later = [], maxSec = 300, label = '' } = {}) {
  const u = D.c(role);
  let pick = null, w0 = null, w1 = null;
  await waitFor(D, function* (why) {
    for (const c of cands) {
      if ((yield* stashSeenMemoG(D, c[0], c[1], quiet, [e, ...later])).length) { why.push(`stash (${c}) seen`); continue; }
      w0 = way(D, [u.x, u.z], [[e.x, e.z]], u, 'stand'); w1 = way(D, [e.x, e.z], [c], u, 'stand');
      if (w1.short) continue;
      const up = u.stance === 'stand' ? 0 : 0.7, ta = up + pathLen([u.x, u.z], w0) / 2.0;
      const spots = [...(role === 'spy' ? [] : timed([u.x, u.z], w0, 2.0, up)), [e.x, e.z, 0, ta + 0.5], [e.x, e.z, 0, ta + 1.2],
        ...timed([e.x, e.z], w1, 1.5, ta + 1.2), [c[0], c[1], 0, ta + 1.2 + pathLen([e.x, e.z], w1) / 1.5 + 0.9]];
      if (yield* standSeenG(D, spots, { slack: 0.8, why })) continue;
      pick = c; return true;
    }
    return false;
  }, maxSec, `${role} fetches ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  await carryTo(D, role, e, pick);
  await settleBody(D, role, e, cands.filter((c) => c !== pick), { quiet, later });
  return pick;
}

/**
 * The Spy talks to `holder` from his far side from `victim` (so that he turns his back on him): she walks round to a
 * spot 2.5 m from him on that side (in uniform, nobody minds), then speaks; he turns to her and stands.
 */
async function holdFacingAway(D, holderTag, victim, { face = null, maxSec = 120 } = {}) {
  const h = D.get(holderTag), sp = D.c('spy'), g = D.world.grid, gb = D.c('greenberet');
  if (h.brain?.state === 'DISTRACTED' && h.brain?.distractedBy === sp) return;
  // (holding the victim himself: he turns his back on the Green Beret, who comes for him; `face`: the heading he is to
  // face, given outright)
  const from = h === victim ? gb : victim;
  const away = face ?? Math.atan2(h.z - from.z, h.x - from.x);
  const off = () => Math.abs(Math.atan2(Math.sin(Math.atan2(sp.z - h.z, sp.x - h.x) - away), Math.cos(Math.atan2(sp.z - h.z, sp.x - h.x) - away)));
  const t0 = D.t;
  for (;;) {
    if (D.t - t0 > maxSec) throw new Error(`hold ${holderTag}: could not get round to his side`);
    // (a walker keeps walking: she keeps to the spot on his `away` side as he goes, and speaks once she is there)
    if (Math.hypot(h.x - sp.x, h.z - sp.z) < 2.8 && off() < 0.45) {
      D.ability('spy', 'distract', h);
      await D.until(() => h.brain?.state === 'DISTRACTED' || D.t - t0 > maxSec, maxSec, `${holderTag} listens to the Spy`);
      await D.wait(1.0);
      const hoff = Math.abs(Math.atan2(Math.sin(h.heading - away), Math.cos(h.heading - away)));
      if (hoff < 0.6) return;
      D.log(`WARN hold ${holderTag}: he faces ${Math.round(h.heading * 180 / Math.PI)}°, not ${Math.round(away * 180 / Math.PI)}°: again`);
      D.order('spy', { type: 'stop' });
      await D.wait(1.0);
      continue;
    }
    let spot = null;
    for (const da of [0, 0.25, -0.25, 0.4, -0.4]) for (const d of [2.0, 2.4, 1.7]) {
      const x = h.x + Math.cos(away + da) * d, z = h.z + Math.sin(away + da) * d;
      if (!spot && g.walkableAt(x, z)) spot = [x, z];
    }
    if (spot) { try { D.order('spy', { type: 'move', x: spot[0], z: spot[1] }); } catch { /* refused: try again */ } }
    await D.wait(0.3);
  }
}

/**
 * The Marine spears `victim` from the water (he must be in reach, 9 m) and the Spy, standing by in uniform, at once
 * shoulders the body to the first of `stashes` nobody would see: they go only when nobody would see the Marine come up,
 * the man fall, the Spy carry him there, nor the body lie there for `quiet` s. `ready()`: the moment's other conditions.
 */
async function spearAndCarry(D, victim, stashes, { ready = () => true, quiet = 300, later = [], maxSec = 900, label = '', release = false, carrier = 'spy' } = {}) {
  const m = D.c('diver'), sp = D.c(carrier), bare0 = carrier !== 'spy';
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  let pick = null;
  await waitFor(D, function* (why) {
    pick = null;
    if (!victim.alive) { why.push('dead'); return false; }
    if (!ready(victim)) { why.push('not-ready'); return false; }
    if (D.t < (m._harpoonT ?? -1)) { why.push('reloading'); return false; }
    if (Math.hypot(victim.x - m.x, victim.z - m.z) > 8.5) { why.push('out of reach'); return false; }
    // he comes up for 0.4 s: nobody may see him, the victim included
    if (yield* standSeenG(D, [[m.x, m.z, 0, 0], [m.x, m.z, 0, 0.5]], { slack: 0.3, why, keepWalker: 0, low: true })) return false;
    // the man falls where he stands (seen upright as he drops)
    const q = poseAt(victim, 0.25);
    if (yield* standSeenG(D, [[q.x, q.z, 0, 0.3], [q.x, q.z, 0, 0.6]], { slack: 0.4, why, except: [victim], pad: 0, lat: 0.5 })) return false;
    // the Spy walks over (she is a German soldier until she lifts him), lifts him and carries him off (the Green Beret
    // gets up and walks over, seen as he is)
    const up = bare0 && sp.stance !== 'stand' ? 0.7 : 0;
    const w0 = way(D, [sp.x, sp.z], [[q.x, q.z]], sp, 'stand'), ta = Math.max(1.0, up + pathLen([sp.x, sp.z], w0) / 2.0);
    if (bare0 && (yield* standSeenG(D, timed([sp.x, sp.z], w0, 2.0, up), { slack: 0.6, why, except: [victim], lat: 0.4 }))) return false;
    const bodyAt = []; for (let t = 0.6; t <= ta + 1.2; t += 0.5) bodyAt.push([q.x, q.z, 0, t]);
    if (yield* standSeenG(D, bodyAt, { slack: 0.6, why, except: [victim], body: true, pad: 0 })) return false;
    for (const c of stashes) {
      if ((yield* stashSeenMemoG(D, c[0], c[1], quiet, [victim, ...later])).length) { why.push(`stash (${c}) seen`); continue; }
      const w1 = way(D, [q.x, q.z], [c], sp, 'stand');
      if (w1.short) continue;
      // (she has him on her shoulder 1–3 s after she gets to him: the grab as the game times it)
      const carry = timed([q.x, q.z], w1, 1.5, ta + 2.0);
      if (yield* standSeenG(D, [[q.x, q.z, 0, ta + 1.0], ...carry, [c[0], c[1], 0, carry.at(-1)[3] + 1.2]], { slack: 1.4, why, except: [victim], lat: 0.6 })) continue;
      pick = c; return true;
    }
    return false;
  }, maxSec, `spear and carry ${victim.tag}${label ? ' ' + label : ''}`, 0.1);
  // (`release`: she was talking to someone: she leaves him as the harpoon flies)
  if (release) D.order('spy', { type: 'stop' });
  D.ability('diver', 'harpoon', victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} speared`);
  if (bare0) await D.stance(carrier, 'stand');
  await carryTo(D, carrier, victim, pick);
  await settleBody(D, carrier, victim, stashes.filter((c) => c !== pick), { quiet, later });
  if (bare0) await D.stance(carrier, 'crawl');
  return pick;
}


// ---------------------------------------------------------------- places (m)
/** inside the camp: through the main gate, across the lower camp, the gateway by the fuel tanks, the upper yard */
const CAMP_WAY = [[72.5, 161], [60.5, 123.3]];
/** the back gate's control box (inside, left of the gate), the gate, a step outside */
const BOX = [47.26, 96];
const OUTSIDE_GATE = [49.2, 91];
/** body stashes on the west strip nobody ever looks at: south of the crane's foot, behind the west rocks */
const ROCK_SMALL_S = [14.5, 110.7], ROCK_SMALL_S2 = [15.6, 111], CRANE_FOOT = [19.5, 114.6], CRANE_FOOT2 = [20.6, 115.2], ROCK_W_BACK = [4.5, 124.4], ROCK_W_BACK2 = [3.2, 124.6];
const P17_SPY = [21.2, 99.6], E2_WAIT = [4.5, 117.5];
/** the west strip's pockets nobody looks at (in the game): behind the west rock's east side, out of the bridge sentry
 *  e4's sight and, for a body laid exactly there, of e3's; behind e1's post (a third number: the pocket's own ring) */
const STRIP_POOL = [[6.6, 125.0, 0.45], [6.5, 125.3, 0.45], [6.4, 124.8, 0.45], [13.5, 118.9, 0.3], [13.5, 119.4, 0.3]];
/** e5's way to the decoy outside the yard's west wall (stage E), as the game walks him: out by the back gate, west along
 *  the river path to the yard's north-west corner, and down to the decoy */
const E5_WAY = [[49.25, 94.5], [48.28, 92.27], [46.43, 93.31], [44.12, 94.7], [40.4, 96.61], [37.88, 97.81], [35.28, 98.83], [32.83, 100.17],
  [30.39, 101.51], [28.41, 102.6], [25.97, 103.94], [23.52, 105.28], [21.07, 106.57], [21.5, 108.5], [22.3, 110.5]];
/** on the river side of Patrol 16's west halt; along the foot of the camp's north wall (1 m off it) to the back gate;
 *  past the gate, and on along the wall behind the bunker to the decoy's spot east of it */
const P16_SPY_W = [31.6, 102.4];
/** along the water's edge behind the held patrol (out of the gunner's near band: he cannot make out a man lying there) */
const WATER_BACK = [[54.5, 86.6], [50, 88.2], [46.5, 91.0], [44.5, 93.6]];
// (GB_FAR_W: on the line from the decoy out through the west rocks, 2.5 m beyond where he lay before — there he was
// 18.4 m from e5 staring at the decoy, 0.4 m outside the band in which a man lying down is seen)
const W_HIDE = [14.8, 118.6], DECOY_N = [20, 109.2], DECOY_W = [23, 112.2], GB_FAR_W = [6.4, 122.9], SPY_DECOY_W = [21.6, 107.6];
/** the Spy's place by Patrol 26's east halt; the lorry's side, where she gets in */
const P26_SPY = [64.5, 20.5], LORRY_SIDE = [9.5, 15.5];
/** e22 drawn off by a shot into the ground north-east of his beat (only he hears it there; nobody but Patrol 26 ever
 *  looks there), where the Spy then waits; his body behind the mill or in the far north-east corner */
const LURE_E22 = [72.5, 34.5], LURE_E22_ASIDE = [75.5, 32];
const E22_LURE_HIDE = [[83.5, 40.5], [84.5, 41.5], [85.5, 42.5], [86.5, 43.5], [86.5, 45.5], [84.5, 22.5], [85.5, 21.5], [86.5, 23.5], [84.5, 24.5], [87.5, 22.5]];
/** the Spy behind e24, round the headquarters' corner; the Marine's places in the river: east of the bridge's sentry e18
 *  (out of his eyes: he watches the deck), behind e15's east end, at the west shore's far end */
const SPY_E24 = [20.5, 46.5], MA_E18 = [54, 63], MA_E15 = [62.5, 62.2], MA_E19 = [13, 64.5];
const PEN_DOOR_STAND = [67.6, 105.8];
/** Gilbert's way: past the cage to the back gate, out, west along the river path, over the road bridge, the north road */
const MARCH = [[57.5, 106.5], [50.5, 95.8], [46, 93.8], [30.5, 99.8], [17.8, 97.2], [44.6, 63.4], [42.5, 52], [20, 47.5], [8.5, 22], [8, 16.5]];
/** the Marine: under water to the north bank's west end, gear off in the shallows */
const MA_NORTH = [6.5, 60.0];
const STRIP_WEST = [[10.5, 106], [13.5, 100.5]];
const WATER_LOW = [[15, 100], [20, 99.2], [28, 98.2], [36, 96.2], [42, 93.9], [45.2, 93.6]];
// the decoy's spot, east of the pillbox and a little south: the gunner faces it (10° south of east) and his sweep then
// reaches neither the bridge, nor the north bank east of it, nor the cage
const DECOY_WAY = [[56, 89.0], [60, 86.9], [64, 84.9], [68, 82.6], [72.6, 82.4]];
/** the west strip's south end, south of the small rock and the crane: nobody but the dead and Patrol 16 at its west halt looks there */
const W_STASH = [[16.5, 116.5], [18.5, 118.5], [14.5, 119.5], [16.5, 120.5], [19.5, 120.8], [12.5, 121.5], [10.5, 120.5], [13.5, 117.5], [11, 123.5]];
const PAST_GATE = [[47.5, 93.6], [50.5, 92.2], [53, 91.1]], GATE_W = [47.9, 93.1], GATE_E = [53.5, 89.6];
/** in front of the open back gate, round its posts' footings as close as a man lying can go (in the game's grid) */
/** the Spy's way round behind the bunker (past the gate, along the wall's foot, round its south side) to the spot north
 *  of it where she fires into the ground, and the shot's bearing from the gunner */
const SPY_SHOT_WAY = [[54.5, 89.2], [60, 86.6], [64.5, 84.4], [68.5, 81.5], [66, 77.6]], SHOT_BEARING = Math.atan2(77.6 - 81, 66 - 63);
const GB_BRIDGE_S = [16.5, 99], MA_E23 = [46.9, 50.0];
/** where the Spy waits for e20 on his way east, ahead of him and north of his path: she stops him at x ~ 37.5, where
 * the machine-gunner's sweep (105 +- 40 deg from his nest) cannot see a man rise at e20's back (further east, at
 * x ~ 39.7, it always can: the Green Beret waited 600 s there in vain) */
const SPY_E20 = [38.2, 53.3];
const GATE_IN = [49.8, 93.8], GB_P16 = [28.4, 98.3], GATE_CORNER = [49.25, 93.25], GATE_WAIT = [46.6, 93.4], E8_SPY = [51.3, 108.4];
/** outside the yard's north wall, west of the gate: behind the wall from the yard, out of the turned gunner's sight */
const GATE_W_STASH = [[45.6, 93.7], [44.6, 93.9], [43.6, 94.2], [42.6, 94.5], [47.4, 93.2]];
/** the decoy's bearing from the gunner: just south of the bunker, behind him (DECOY_WAY's third point) */
const DECOY_BEARING = Math.atan2(84.55 - 81, 63.65 - 63);
/** the Marine: into the river from the west strip's bank (the shallows), and his spot behind Patrol 16's west halt */
const MA_BANK = [8, 97.6], MA_SHORE = [8, 96.5], MA_P16 = [29.5, 95.6];
/** inside the back gate; the yard's order of play; stashes (never seen in a 500 s scan, the W strip and Patrol 17 gone) */
const INSIDE_GATE = [50.5, 97.5];
const BRIDGE_S = [17.5, 96.5], BRIDGE_N = [44.2, 63.6];
// cells of the N bank nobody looks at (scratch map, the S side cleared, everyone N alive)
const NORTH_HIDDEN = [[0.5, 12.5], [0.5, 14.5], [0.5, 16.5], [0.5, 23.5], [1.5, 13.5], [1.5, 15.5], [1.5, 22.5], [1.5, 24.5], [2.5, 12.5], [2.5, 14.5], [2.5, 16.5], [2.5, 23.5], [2.5, 25.5], [3.5, 13.5], [3.5, 15.5], [3.5, 22.5], [3.5, 24.5], [3.5, 26.5], [4.5, 12.5], [4.5, 14.5], [4.5, 16.5], [4.5, 21.5], [4.5, 23.5], [4.5, 25.5], [4.5, 28.5], [5.5, 13.5], [5.5, 15.5], [5.5, 22.5], [5.5, 24.5], [5.5, 26.5], [5.5, 29.5], [6.5, 12.5], [6.5, 14.5], [6.5, 21.5], [6.5, 23.5], [6.5, 25.5], [6.5, 28.5], [6.5, 30.5], [7.5, 13.5], [7.5, 15.5], [7.5, 20.5], [7.5, 22.5], [7.5, 24.5], [7.5, 27.5], [7.5, 29.5], [7.5, 31.5], [8.5, 12.5], [8.5, 14.5], [8.5, 21.5], [8.5, 23.5], [9.5, 13.5], [9.5, 15.5], [9.5, 19.5], [9.5, 22.5], [9.5, 24.5], [9.5, 26.5], [10.5, 12.5], [10.5, 14.5], [10.5, 20.5], [10.5, 23.5], [10.5, 27.5], [11.5, 19.5], [11.5, 21.5], [12.5, 23.5], [19.5, 44.5], [20.5, 45.5], [21.5, 46.5], [39.5, 64.5], [40.5, 63.5], [41.5, 62.5], [44.5, 53.5], [79.5, 52.5], [81.5, 51.5], [82.5, 20.5], [82.5, 50.5], [84.5, 20.5], [84.5, 22.5], [84.5, 41.5], [84.5, 49.5], [84.5, 51.5], [85.5, 21.5], [85.5, 43.5], [85.5, 50.5], [86.5, 45.5], [86.5, 48.5], [87.5, 47.5], [87.5, 49.5]];
/** never seen in a 500 s scan: by the road bridge's north end (west of it, by the rock), the truck's corner, east of the mill */
/** pockets by the MG nest's sandbags and the bridge's north end: hidden for a body laid exactly there */
const NORTH_EXACT = [[44.6, 53.6, 0.1], [45.0, 53.4, 0.1]];
const NORTH_STASH = [[41.5, 62.5], [40.5, 63.5], [39.5, 64.5], [42, 61.5], [38, 61], [3, 13], [5, 12.5], [8, 12.3], [2, 22], [4, 21.5], [6, 25], [3, 27],
  [86.5, 44], [87.5, 46], [86.5, 48]];
/** behind the cage, where nobody ever looks; the gate's outer post, where e8 never sees a man lying */
const GB_CAGE_HIDE = [66.7, 113.2], GB_E9_WAIT = [51, 91.5];
const GATE_OUT = [[53.5, 91.3], [55, 90.6], [56.5, 89.9], [52.2, 91.9], [58, 89.2]];
const YARD_STASH = [[31.6, 121.7], [32.5, 123.4], [33.0, 124.3], [32.0, 120.3], [33.4, 123.0], [34.3, 124.7], [32.9, 119.8], [34.3, 122.5],
  [35.2, 124.3], [33.3, 118.5], [34.7, 121.1], [36.1, 123.8], [37.5, 124.2], [38.8, 122.4], [40.1, 122.8], [41.4, 121.0], [42.8, 121.4],
  [44.1, 121.8], [45.8, 118.6], [44.2, 126.3], [46.0, 125.3], [31.1, 103.8], [32.0, 103.3], [32.9, 102.8], [33.8, 102.4],
  [65.6, 85.5]];
// never-seen cells by the yard's east corner and behind the cage, once e9, e11, e12 are gone and e13 stares at the decoy
const YARD_E = [[76.7, 102.2], [77.6, 101.7], [78.5, 101.3], [79.0, 102.1], [76.3, 103.5], [78.1, 102.6], [79.4, 103.0],
  [66.7, 113.2], [67.6, 112.7], [68.5, 112.2], [69.8, 112.7], [67.1, 111.8], [65.8, 111.4]];
const LEVER_STAND = [15.8, 121.5], GB_HIDE = [1.5, 123.5], MA_HIDE = [2.2, 124.9];

/** Can a man stand at (x, z): his cell and the ground a body's half-width round it open (`o`: the grid's walk options) */
const standable = (g, x, z, o) => g.walkableAt(x, z, o) && [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].every(([a, b]) => g.walkableAt(x + a, z + b, o));
/** move spot `p` (in place) to the nearest point within 3 m a man can stand on; → how far it moved (-1: none) */
function snapSpot(g, p, o) {
  if (standable(g, p[0], p[1], o)) return 0;
  for (let r = 0.25; r <= 3; r += 0.25) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12, x = p[0] + Math.cos(a) * r, z = p[1] + Math.sin(a) * r;
      if (standable(g, x, z, o)) { best = [x, z]; break; }
    }
    if (best) { p[0] = +best[0].toFixed(2); p[1] = +best[1].toFixed(2); return r; }
  }
  return -1;
}
/**
 * The places above were laid out on a nav grid without the drawn meshes' margins (rocks, walls, props: the game's
 * navBlock keeps men off them); in the game a few fall inside such a margin, where nobody can stand or lay a body. Each
 * is moved to the nearest spot a man can stand on in this world (in place; once per world). Every world starts from the
 * authored places (AUTHORED): a page that solves again — video mode's 'Again', a jump back on its timeline: the same
 * module instance — must snap them as a fresh page does (a snapped spot, rounded to 0.01 m, may fail `standable` and move
 * again: the second run was another run, G3 454 s early).
 */
const snapped = new WeakSet();
const AUTHORED = new Map();
function snapSpots(D) {
  const w = D.world, g = w.grid;
  if (snapped.has(w)) return;
  snapped.add(w);
  const land = [OUTSIDE_GATE, E2_WAIT, ROCK_SMALL_S, ROCK_SMALL_S2, CRANE_FOOT, CRANE_FOOT2, ROCK_W_BACK, ROCK_W_BACK2, P17_SPY, P16_SPY_W, W_HIDE, DECOY_W,
    GB_FAR_W, SPY_DECOY_W, DECOY_N, GATE_W, GATE_E, GATE_IN, GB_P16, GATE_CORNER, GATE_WAIT, E8_SPY, GB_BRIDGE_S, MA_E23, P26_SPY,
    ...GATE_W_STASH, LORRY_SIDE, LURE_E22, LURE_E22_ASIDE, SPY_E24, PEN_DOOR_STAND, MA_BANK, MA_SHORE, MA_NORTH, INSIDE_GATE,
    BRIDGE_S, BRIDGE_N, GB_CAGE_HIDE, GB_E9_WAIT, LEVER_STAND, GB_HIDE, MA_HIDE, SPY_E20,
    ...CAMP_WAY, ...SPY_SHOT_WAY, ...WATER_BACK, ...E22_LURE_HIDE, ...MARCH, ...STRIP_WEST, ...WATER_LOW, ...DECOY_WAY, ...W_STASH, ...PAST_GATE, ...NORTH_HIDDEN,
    ...NORTH_EXACT, ...NORTH_STASH, ...GATE_OUT, ...YARD_STASH, ...YARD_E];
  const water = [MA_E18, MA_E15, MA_E19, MA_P16];
  // (all put back before any is snapped: a spot may be listed twice)
  for (const p of [...land, ...water]) { const o = AUTHORED.get(p); if (o) { p[0] = o[0]; p[1] = o[1]; } else AUTHORED.set(p, [p[0], p[1]]); }
  const moved = [];
  for (const p of land) { const was = `${p[0]},${p[1]}`, d = snapSpot(g, p); if (d) moved.push(`${was}->${p[0]},${p[1]}${d < 0 ? ' (none!)' : ''}`); }
  // (the Marine's spots in the river: open water a diver can be in)
  for (const p of water) { const was = `${p[0]},${p[1]}`, d = snapSpot(g, p, { dive: true }); if (d) moved.push(`${was}->${p[0]},${p[1]} (water)${d < 0 ? ' (none!)' : ''}`); }
  if (moved.length) dbg(D, `spots moved onto standable ground: ${moved.join(' ')}`);
}

export const STAGES = [
  ['A', 'Through the camp in uniform', async (D) => {
    D.checkpoint('A0 the team at the start; the Spy in German uniform');
    // the Spy, in German uniform, walks along the south road, in at the camp's open main gate, across the lower camp
    // and through the gateway into the prison yard: nobody looks twice at a German soldier
    await walk(D, 'spy', CAMP_WAY);
    D.checkpoint('A1 the Spy walks through the camp into the prison yard');
    await walk(D, 'spy', [BOX], { tol: 1.2 });
    D.ability('spy', 'use', D.item('gate_box'));
    await D.idle('spy', 10);
    D.checkpoint('A2 the Spy opens the back gate from its control box');
    await walk(D, 'spy', [OUTSIDE_GATE]);
    D.checkpoint('A3 out through the back gate');
  }],
  ['B', 'The west strip', async (D) => {
    await walk(D, 'spy', [[30, 101.5], [16, 107]]);
    D.checkpoint('B1 the Spy walks west along the river to the strip');
    // (she waits west of the sentry e2, behind him: the rock at his back leaves room to step in from that side only —
    // from the east she would have to pass him)
    await walk(D, 'spy', [E2_WAIT]);
    // (each body to a spot nobody would see it lie at for five minutes — the pockets behind the west rock's east side and
    // behind e1, or any such spot round the man — carried there the way his own feet would take her, unseen on it)
    const notFrom = { proto: D.get('e5'), pts: E5_WAY };
    const stashes = function* (v) { return yield* stashCandsG(D, v, { pool: STRIP_POOL, n: 8, quiet: 300, minNb: 1, ring: 0.45, notFrom }); };
    await strike(D, ['e2'], { stashes, maxSec: 600 });
    D.checkpoint('B2 the Spy injects the sentry e2 and carries him behind the west rock');
    // (checked every 0.4 s, not 0.2, and only from his right side: his checks are the costliest of the strip — 54 ms
    // each, five sides — and video mode's time-lapse played them at 0.8x; his moment falls on the coarser grid too, and
    // it is from that side that it comes: the same plan, the same blow)
    await strike(D, ['e1'], { stashes, maxSec: 600, every: 0.4, sides: [1.0] });
    D.checkpoint('B3 the Spy injects the sentry e1');
    await walk(D, 'spy', [[15, 105.5]]);
    await strike(D, ['e3'], { stashes, ready: (e) => e.z > 103.5 && e.z < 111 && Math.sin(e.heading) > 0.9, maxSec: 900, maxT: 4 });
    D.checkpoint('B4 the Spy injects the walker e3');
    await walk(D, 'spy', [[19, 104]]);
    await strike(D, ['e4'], { stashes, maxSec: 600 });
    D.checkpoint('B5 the Spy injects e4 by the road bridge');
  }],
  ['C', 'Over the gorge', async (D) => {
    const ps = ['psa', 'psb', 'psc'].map((t) => D.get(t)), br = D.world.entities.find((e) => e.tag === 'mbridge');
    // the Spy walks to the winch lorry by the gorge and slides the bridge out at once (a bridge moving is nothing a guard
    // looks for; the men cross only when the south road's patrol, whose west halt looks straight at the bridge's south
    // landing, walks away east)
    await walk(D, 'spy', [LEVER_STAND]);
    D.checkpoint('C1 the Spy at the bridge lever on the winch lorry');
    D.ability('spy', 'use', D.item('lever_bridge'));
    await D.until(() => br.extended && !(br.moving > 0), 20, 'the bridge out');
    D.checkpoint('C2 the Spy slides the bridge out over the gorge');
    // the Green Beret and the Marine cross on their bellies and lie down behind the west rocks, where nobody looks
    // (both together, the Marine a few steps behind: on their feet, while the patrol walks away east)
    const ready = () => ps.every((e) => e.x > 30) && Math.cos(ps[0].heading) > 0.3;
    await dash(D, 'greenberet', () => way(D, [D.c('greenberet').x, D.c('greenberet').z], [GB_HIDE], 'greenberet', 'stand'), { mode: 'walk', ready, hold: 8, maxSec: 600, label: 'the Green Beret over the gorge' });
    // (and lies down at once: on his belly nobody makes him out from further off than 18 m)
    await D.stance('greenberet', 'crawl');
    D.checkpoint('C3 the Green Beret crosses the gorge');
    await dash(D, 'diver', () => way(D, [D.c('diver').x, D.c('diver').z], [MA_HIDE], 'diver', 'stand'), { mode: 'walk', hold: 8, maxSec: 600, label: 'the Marine over the gorge' });
    await D.stance('diver', 'crawl');
    D.checkpoint('C4 the Marine crosses the gorge');
    // and slides it back: nothing from the south side can follow (the road patrol, the camp's garrison)
    await D.until(() => !D.world.commandos.some((c) => c.alive && Math.hypot(c.x - 15, c.z - 135) < 11), 30, 'nobody on the deck');
    D.ability('spy', 'use', D.item('lever_bridge'));
    await D.until(() => !br.extended && !(br.moving > 0), 20, 'the bridge back');
    D.checkpoint('C5 the Spy slides the bridge back');
  }],
  ['D', 'Patrol 17 at the bridge', async (D) => {
    const pt = ['p17a', 'p17b', 'p17c'].map((t) => D.get(t)), [lead] = pt, sp = D.c('spy');
    // the Spy waits by the road bridge's south end, where Patrol 17 halts looking south over the strip
    await walk(D, 'spy', [P17_SPY]);
    D.checkpoint('D1 the Spy waits by the road bridge for Patrol 17');
    await D.until(() => lead.brain?.atWait && Math.hypot(lead.x - 20, lead.z - 101) < 1, 400, 'Patrol 17 at its south halt');
    D.ability('spy', 'distract', lead);
    await D.until(() => pt.every((e) => e.brain?.state === 'DISTRACTED'), 6, 'the patrol listens to the Spy');
    await D.wait(1.0);
    dbg(D, `patrol ${pt.map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)}`).join(' ')} spy@${sp.x.toFixed(1)},${sp.z.toFixed(1)}`);
    D.checkpoint('D2 the Spy holds Patrol 17: the three turn their backs on the strip');
    // the Green Beret comes up behind them and knifes them one by one, the rear man first, carrying each off to the
    // south of the strip, where nobody looks now
    const order = [...pt].sort((a, b) => Math.hypot(b.x - lead.x, b.z - lead.z) - Math.hypot(a.x - lead.x, a.z - lead.z));
    // (to spots out of sight of e5's way round to the decoy, later: stage E)
    const stashes = stripHidden(D, [lead.x, lead.z]);
    dbg(D, `Patrol 17's stashes ${JSON.stringify(stashes)}`);
    // (while Patrol 16, on the riverside path, is off east: back at its west end it looks straight down the strip)
    const take = async (v) => { const used = await gbTakes(D, v, pt, stashes, { ready: () => p16away(D), quiet: 300 }); stashes.splice(stashes.findIndex((q) => q === used), 1); };
    await take(order[0]);
    D.checkpoint(`D3 the Green Beret knifes ${order[0].tag}, the rear man, and carries him off`);
    await take(order[1]);
    D.checkpoint(`D4 the Green Beret knifes ${order[1].tag} and carries him off`);
    await take(order[2]);
    D.checkpoint(`D5 the Green Beret knifes the sergeant ${order[2].tag} and carries him off`);
  }],
  ['E', 'A decoy for e5', async (D) => {
    const gb = D.c('greenberet'), sp = D.c('spy'), e5 = D.get('e5'), p16 = D.get('p16a');
    // e5 walks the prison yard's west half and sees most of it. The Green Beret leaves his decoy just outside the yard's
    // west wall, by the north-west corner, where nobody looks now the strip is clear, and lies down well off it
    // (over the open strip a crawler's band edge is judged loosely, 2.5 m; the last steps along the wall to the decoy's
    // spot tightly: the yard's men inside cannot see a man lying behind the wall, the loose rule would put him on it)
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [DECOY_N], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 4, label: 'the Green Beret up the strip' });
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [DECOY_W], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 6, pad: 0.6, label: 'the Green Beret to the yard\'s west wall' });
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [DECOY_N], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 4, pad: 0.6, label: 'the Green Beret back from the wall' });
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [GB_FAR_W], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 6, label: 'the Green Beret off to the west rocks' });
    D.checkpoint('E1 the Green Beret leaves his decoy outside the yard\'s west wall');
    // the Spy waits by the corner, where e5 will come from; when e5 is near the west end of his beat (and Patrol 16 off
    // east), the decoy goes on: e5 walks out of the yard round to it and stands staring at it
    await walk(D, 'spy', [SPY_DECOY_W]);
    await D.until(() => Math.hypot(e5.x - 30.5, e5.z - 110) < 4 && p16away(D), 600, 'e5 near his west halt, Patrol 16 off east');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e5.brain?.state === 'DECOY', 30, 'e5 hears the decoy');
    D.checkpoint('E2 the decoy beeps: e5 walks out of the yard to look');
    await D.until(() => e5.brain?.state === 'DECOY' && !e5.path && !e5.isMoving && Math.hypot(e5.x - DECOY_W[0], e5.z - DECOY_W[1]) < 4, 120, 'e5 at the decoy');
    await strike(D, e5, { stashes: [null], quiet: 600, maxSec: 300, label: 'at the decoy' });
    D.checkpoint('E3 the Spy injects e5 as he stares at the decoy');
    // decoy off and back in the Green Beret's pack
    D.ability('greenberet', 'decoyToggle');
    const decoy = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed && i.alive !== false);
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [DECOY_N], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 4, label: 'the Green Beret up the strip again' });
    // (to a free spot beside it: e5 lies at its foot)
    const g = D.world.grid, beside = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [decoy.x + Math.cos((k * Math.PI) / 4) * 1.1, decoy.z + Math.sin((k * Math.PI) / 4) * 1.1])
      .filter(([x, z]) => standable(g, x, z) && Math.hypot(x - e5.x, z - e5.z) > 1.4).sort((p, q) => Math.hypot(p[0] - gb.x, p[1] - gb.z) - Math.hypot(q[0] - gb.x, q[1] - gb.z));
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [beside[0] ?? DECOY_W], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 4, pad: 0.6, label: 'the Green Beret back to the decoy' });
    D.ability('greenberet', 'hand', decoy);
    await D.until(() => gb.has?.('decoy') || (gb.inventory?.decoy ?? 0) > 0, 10, 'decoy picked up');
    await D.idle('greenberet', 3);
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [DECOY_N], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 4, pad: 0.6, label: 'the Green Beret away from the wall' });
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [W_HIDE], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 6, label: 'the Green Beret back onto the strip' });
    D.checkpoint('E4 the Green Beret takes his decoy back');
  }],
  ['F', 'Patrol 16 and the bunker gunner', async (D) => {
    const pt = ['p16a', 'p16b', 'p16c'].map((t) => D.get(t)), [lead] = pt, sp = D.c('spy'), gb = D.c('greenberet'), m = D.c('diver');
    const bk = D.get('e_bk'), e13 = D.get('e13');
    // the Marine slips into the river by the road bridge's south end, puts his diving gear on in the shallows and swims
    // under water along the bank to Patrol 16's west halt
    await dash(D, 'diver', () => way(D, [m.x, m.z], [MA_BANK], 'diver', 'crawl'), { mode: 'crawl', maxSec: 600, hold: 4, label: 'the Marine to the river' });
    await waitFor(D, (why) => !standSeen(D, [[m.x, m.z, 0, 0.3], [MA_SHORE[0], MA_SHORE[1], 0, 1], [MA_SHORE[0], MA_SHORE[1], 0, 3.5]], { slack: 0.5, why }), 600, 'the Marine unseen at the water');
    await D.stance('diver', 'stand');
    await D.go('diver', ...MA_SHORE, { tol: 0.4, max: 10 });
    D.ability('diver', 'dive');
    await D.until(() => m.underwater, 5, 'the Marine under water');
    await D.idle('diver', 3);
    await walk(D, 'diver', [MA_P16]);
    D.checkpoint('F1 the Marine dives into the river and swims along the bank');
    // Patrol 16 walks the path between the camp's north wall and the river, from the road bridge to past the back
    // gate. At its west halt by the bridge the Spy talks to the sergeant from the wall's side: all three turn their
    // backs on the river
    await walk(D, 'spy', [P16_SPY_W]);
    await D.until(() => lead.brain?.atWait && Math.hypot(lead.x - 30, lead.z - 100.5) < 1, 600, 'Patrol 16 at its west halt');
    D.ability('spy', 'distract', lead);
    await D.until(() => pt.every((e) => e.brain?.state === 'DISTRACTED'), 6, 'the patrol listens to the Spy');
    await D.wait(1.0);
    dbg(D, `patrol ${pt.map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)}`).join(' ')} spy@${sp.x.toFixed(1)},${sp.z.toFixed(1)}`);
    D.checkpoint('F2 the Spy holds Patrol 16 at its west halt, its back to the river');
    // the bunker gunner watches the road bridge and the river path (he would see a body lying at the halt's east end:
    // 35.7 m, his sight reaches 36). The Green Beret crawls along the water's edge behind the held patrol to the open
    // back gate (out of the gunner's cone), into the gateway, round its east post and along the wall's foot to just south
    // of the bunker, behind the gunner's back, and leaves his decoy there
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], STRIP_WEST, 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 900, hold: 8, label: 'the Green Beret to the river' });
    const along = (pts) => () => way(D, [gb.x, gb.z], pts, gb, 'crawl');
    await dash(D, 'greenberet', along(WATER_LOW.slice(1)), { mode: 'crawl', maxSec: 900, hold: 6, label: 'the Green Beret along the water' });
    await dash(D, 'greenberet', along([GATE_W, GATE_IN]), { mode: 'crawl', maxSec: 900, hold: 4, pad: 0.6, slack: 0.4, speeds: [0.8, 0.9], every: 0.05, tol: 0.3, label: 'the Green Beret into the gateway' });
    D.checkpoint('F3 the Green Beret crawls along the river behind the held patrol into the open gateway');
    await dash(D, 'greenberet', along([GATE_E, ...DECOY_WAY.slice(1, 3)]), { mode: 'crawl', maxSec: 900, hold: 6, pad: 0.6, slack: 0.4, speeds: [0.8, 0.9], every: 0.05, label: 'the Green Beret round the gate\'s post, along the wall behind the bunker' });
    D.checkpoint('F4 the Green Beret slips round the gate\'s post and crawls along the wall to behind the bunker');
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    // back along the wall, through the gateway and west along the water; then on, by radio: its beeping turns the gunner
    // round to it, his back to the bridge and the river path, for as long as it sounds (to the end), and e13 in the yard
    // will come out round by the gate to stare at it
    await dash(D, 'greenberet', along([DECOY_WAY[1], GATE_E, GATE_IN, GATE_W, WATER_LOW[3]]), { mode: 'crawl', maxSec: 900, hold: 8, pad: 0.6, slack: 0.4, speeds: [0.8, 0.9], every: 0.05, label: 'the Green Beret back to the water' });
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => Math.cos(bk.heading - DECOY_BEARING) > 0.9, 15, 'the gunner turns to the decoy');
    D.checkpoint('F5 the Green Beret switches his decoy on: the gunner turns his back on the bridge and the river path');
    // from the water, the rear men first, the sergeant last, still listening to the Spy
    const order = [...pt].sort((a, b) => Math.hypot(b.x - lead.x, b.z - lead.z) - Math.hypot(a.x - lead.x, a.z - lead.z));
    await spear(D, order[0], { quiet: 600, later: order.slice(1) });
    D.checkpoint(`F6 the Marine spears ${order[0].tag}, the rear man, from the water`);
    await spear(D, order[1], { quiet: 600, later: order.slice(2) });
    D.checkpoint(`F7 the Marine spears ${order[1].tag} from the water`);
    await spear(D, order[2], { quiet: 600, later: [] });
    D.checkpoint(`F8 the Marine spears the sergeant ${order[2].tag}: Patrol 16 is gone`);
  }],
  ['G', 'The prison yard', async (D) => {
    const gb = D.c('greenberet'), e8 = D.get('e8'), e13 = D.get('e13');
    // back in through the open gate. The cage sentry e12 stands with his back to a hut and watches the gate and its
    // sentry e9, who in turn looks at him every few seconds as his head sweeps: the Spy talks to e12 from the south —
    // he turns from the gate — while the Green Beret takes e9
    await walk(D, 'spy', [OUTSIDE_GATE, INSIDE_GATE]);
    D.checkpoint('G1 the Spy walks back into the prison yard');
    await holdFacingAway(D, 'e12', null, { face: Math.PI / 2 });
    D.checkpoint('G2 the Spy talks to the cage sentry e12: he turns his back on the gate');
    {
      // (to the wall's foot just west of the gate — out of sight through the gateway — once e13 is out at the decoy;
      // then in behind e9 as e8 walks away south, and out west along the wall's foot with his body, where the gunner —
      // turned to the decoy — and the yard do not look)
      await D.until(() => !e13.alive || (e13.brain?.state === 'DECOY' && !e13.path && Math.hypot(e13.x - DECOY_WAY[2][0], e13.z - DECOY_WAY[2][1]) < 5), 300, 'e13 out at the decoy');
      await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [GATE_WAIT], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 600, hold: 10, pad: 1.0, label: 'the Green Beret to the gate\'s west post' });
      const v = D.get('e9');
      const cands = await sliced(D, stashCandsG(D, v, { pool: [...GATE_W_STASH], n: 6, who: 'greenberet', ring: 0.45, minNb: 2 }));
      dbg(D, `gb e9: stashes ${JSON.stringify(cands)}`);
      const used = await gbTakes(D, v, [], cands, { maxTries: 200, later: [], hold: 4, pad: 1.0, quiet: 300, carrySlack: 1.0 });
      if (used) usedStash.add(sk(used));
    }
    D.checkpoint('G3 the Green Beret knifes the gate\'s sentry e9 and carries him out along the wall');
    // she leaves off talking (he turns back to his post) and injects e11 at the east end of his beat, a few steps behind
    // e12's back, when e8 looks away
    D.order('spy', { type: 'stop' });
    await D.wait(1.0);
    await D.until(() => Math.hypot(D.get('e11').x - 73.7, D.get('e11').z - 106) < 9 && !walkingTo(D.get('e11'), 60.9, 111.2), 300, 'e11 off east');
    await strikeAuto(D, 'e11', { pool: [...YARD_E, ...YARD_STASH], maxSec: 3000 });
    D.checkpoint('G4 the Spy injects e11 at the east end of his beat');
    // then e12 himself, from his side — his back is to the hut — when e8 looks away; his body behind the hut, where nobody
    // looks (face to face, as he listened, he would have seen the needle)
    await strikeAuto(D, 'e12', { pool: [...YARD_E], maxSec: 1500, sides: [1.0, -1.0, 1.3, -1.3, 1.6, -1.6, 0.5, -0.5] });
    D.checkpoint('G5 the Spy injects e12 from his side');
    // e8 walks the middle of the yard; the west half's sentries e6 and e7 watch its southern end. The Spy waits west of
    // the north end of his beat and talks to him as he halts there: he faces her, west, his back to the cage door
    await walk(D, 'spy', [E8_SPY]);
    await D.until(() => Math.hypot(e8.x - 53.4, e8.z - 108.4) < 1.0 && (e8.brain?.atWait || !e8.path), 300, 'e8 at the north end of his beat');
    await holdFacingAway(D, 'e8', null, { face: Math.PI });
    D.checkpoint('G6 the Spy stops e8 at the north end of his beat and talks to him from the west');
    // the Green Beret comes in at the gate behind him and knifes e10 by the cage door (e8, still listening, is next:
    // where e10 lies only has to be out of everyone else's sight)
    {
      const v = D.get('e10');
      const cands = await sliced(D, stashCandsG(D, v, { pool: [...YARD_E, ...YARD_STASH], later: [e8], who: 'greenberet' }));
      dbg(D, `gb e10: stashes ${JSON.stringify(cands)}`);
      const used = await gbTakes(D, v, [], [null, ...cands], { maxTries: 80, later: [e8], hold: 8, pad: 1.0 });
      if (used) usedStash.add(sk(used));
    }
    D.checkpoint('G7 the Green Beret knifes e10 by the cage door while the Spy holds e8');
    // and e8 himself, from behind (east of him: out of e6's and e7's sight), still listening to the Spy
    {
      const cands = await sliced(D, stashCandsG(D, e8, { pool: [...YARD_E, ...YARD_STASH], who: 'greenberet' }));
      dbg(D, `gb e8: stashes ${JSON.stringify(cands)}`);
      const used = await gbTakes(D, e8, [e8], [null, ...cands], { maxTries: 80, later: [], hold: 8, pad: 1.0 });
      if (used) usedStash.add(sk(used));
    }
    D.checkpoint('G8 the Green Beret knifes e8, still listening to the Spy: the way from the cage to the gate is clear');
    // the Green Beret crawls out by the gate and west along the water's edge to the road bridge's south end (the gunner
    // looks at the decoy; nobody is left on this side of the river to see a man lying there)
    await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [GATE_IN, WATER_LOW[3], WATER_LOW[2], GB_BRIDGE_S], 'greenberet', 'crawl'), { mode: 'crawl', maxSec: 600, hold: 30, pad: 1.0, label: 'the Green Beret to the road bridge' });
  }],
  ['H', 'The north bank', async (D) => {
    const m = D.c('diver'), gb = D.c('greenberet');
    // (a man's about-turn at a halt goes the short way round as the engine turns him; only a turn within 0.05 rad of a
    // half turn is tried both ways: e15's at the east end of his beat, 174°, goes by the north)
    D.world.sneakTurnTie = 0.05;
    // (and a man walking his beat on this bank looks straight ahead: his head sweeps only at his halts — the walk's
    // glance margin is cut to 3°)
    D.world.sneakWalkAmp = 0.05;
    // (a man at a halt sweeps his head as his own clock and phase have it: judged where it will be, ± 0.3 s)
    D.world.sneakHaltExact = 0.3;
    // over the road bridge in uniform (the bunker gunner stares at the decoy): the Spy clears the north bank, man by
    // man, from behind; then she holds e20, the man who sees most of the bank's middle, while the Marine harpoons the
    // shore guards from the river and the Green Beret knifes e20 himself
    // the decoy still beeps behind the bunker (on since F5, no dwell cap): the gunner keeps his back to the bridge
    await D.until(() => Math.cos(D.get('e_bk').heading - DECOY_BEARING) > 0.9, 15, 'the gunner faces the decoy');
    // (the Marine swims across under water meanwhile, to the north bank's shore east of the bridge)
    D.order('diver', { type: 'move', x: MA_E18[0], z: MA_E18[1] });
    await walk(D, 'spy', [OUTSIDE_GATE, [30, 100.5], BRIDGE_S, BRIDGE_N]);
    D.checkpoint('H0 the decoy beeps on; the Spy walks over the road bridge, the Marine swims across under water');
    // the far men first, whichever she can take first: e14 behind the mill, e27 by the lorry, e25 on the west road;
    // each body to a corner nobody looks at
    const far = [(t) => D.checkpoint(`H1 the Spy injects ${t}, out on his own`), (t) => D.checkpoint(`H2 the Spy injects ${t}, out on his own`),
      (t) => D.checkpoint(`H3 the Spy injects ${t}, out on his own`)];
    let k = 0;
    // (their bodies to the map's west edge and east of the mill: the few corners in the middle are kept for the others)
    const farPool = [...NORTH_HIDDEN, ...NORTH_STASH].filter(([x]) => x < 13 || x > 79);
    const pool = [...NORTH_EXACT, ...NORTH_HIDDEN, ...NORTH_STASH];
    await strikeAny(D, ['e14', 'e27', 'e25'], { pool: farPool, wait: [42, 52.5], maxT: 24, every: 0.6, maxSec: 4000, minNb: 2, ring: 0.4, noRing: true, onKill: (t) => far[k++](t) });
    // then the men whom e20, under the tree by the bridge, and the shore men watch from afar: e22 north of the nest
    // (drawn off, behind the mill) and e24 by the headquarters' corner (she waits behind him, round the corner, and
    // lays him there)
    const e20 = D.get('e20'), e15 = D.get('e15'), e21 = D.get('e21'), e22 = D.get('e22');
    // e22 north of the machine-gun nest is watched by e20, e19 and e15 from three sides: the Spy draws him off alone with
    // a shot into the ground north-east of his beat, out of everyone else's earshot, and injects him there when Patrol 26
    // is off west; his body goes behind the mill
    for (let k = 0; e22.alive && k < 12; k++) {
      try { await lureAndStrike(D, 'e22', LURE_E22, LURE_E22_ASIDE, { pool: E22_LURE_HIDE, maxSec: 600 }); } catch (err) {
        if (!/timeout|no clean moment/.test(err.message)) throw err;
        dbg(D, `lure e22: ${err.message.slice(0, 160)}`);
      }
    }
    if (e22.alive) throw new Error('e22 still alive');
    D.checkpoint('H4 the Spy draws e22 off with a shot and injects him behind the mill');
    // then, back west, the sentry e24 by the headquarters: she waits round its corner, behind him, and lays him in the
    // corner (e22 first: his lure spot is a few steps from e14's, and the Spy no longer stands at the corner for
    // three minutes while e20's and e21's beats line up)
    await walk(D, 'spy', [SPY_E24]);
    await strikeAny(D, ['e24'], { pool, maxT: 24, every: 0.4, maxSec: 1500, minNb: 2, ring: 0.4, onKill: () => D.checkpoint('H5 the Spy injects e24 and lays him round the headquarters\' corner') });
    // e20 walks under the tree between the bridge and the headquarters and sees most of the bank's middle and both
    // shores. The Spy waits ahead of him and stops him on his way east, short of the east end of his beat, and talks to
    // him from the north: his back to the river
    await walk(D, 'diver', [MA_E18]);
    await walk(D, 'spy', [SPY_E20]);
    await D.until(() => walkingTo(e20, 40, 56) && e20.x > 36.0 && e20.x < 37.2, 600, 'e20 on his way east');
    await holdFacingAway(D, 'e20', null, { face: -Math.PI / 2, maxSec: 120 });
    D.checkpoint('H6 the Spy stops e20 under the tree and talks to him: his back to the river');
    // behind his back the Marine harpoons the shore guards from the river: e21 on the shore road while e15 walks away
    // east, then e15 at the far end of his beat before he turns back to see the body
    await spear(D, e21, { later: [e20, e15], quiet: 600, maxSec: 900, label: 'while e15 walks off east',
      ready: (e) => e.x > 47.5 && e15.alive && Math.cos(e15.heading) > 0.5 && e15.x < 60 && !e15.brain?.atWait });
    D.checkpoint('H7 the Marine harpoons e21 on the shore road while e15 walks away');
    await walk(D, 'diver', [MA_E15]);
    await spear(D, e15, { later: [e20], quiet: 600, maxSec: 30, label: 'at the east end of his beat' });
    D.checkpoint('H8 the Marine harpoons e15 at the east end of his beat, before he turns back');
    // the bridge's sentry e18, then, under the bridge, e19 at the far end of the west shore
    await walk(D, 'diver', [MA_E18]);
    await spear(D, 'e18', { later: [e20], quiet: 600, maxSec: 600, label: 'from the river' });
    D.checkpoint('H9 the Marine harpoons the bridge\'s sentry e18');
    await walk(D, 'diver', [MA_E19]);
    await spear(D, 'e19', { later: [e20], quiet: 600, maxSec: 600, label: 'at the west end of his beat', ready: (e) => e.x < 17 });
    D.checkpoint('H10 the Marine harpoons e19 at the west end of the shore');
    // then she injects e20 himself, still talking to him (he never suspects the uniform)
    // then the Green Beret crawls over the road bridge (nobody left by it can make out a man lying on the deck: the
    // machine-gunner's sandbags hide anything low from him) and knifes e20 from behind, still listening to the Spy (face
    // to face her needle would be seen by him)
    {
      const cands = await sliced(D, stashCandsG(D, e20, { pool: [...NORTH_EXACT, ...NORTH_HIDDEN], who: 'greenberet', minNb: 2, ring: 0.4 }));
      const used = await gbTakes(D, e20, [e20], [null, ...cands], { maxTries: 80, later: [], hold: 6, pad: 1.0, quiet: 600 });
      if (used) usedStash.add(sk(used));
    }
    D.checkpoint('H11 the Green Beret crosses the bridge and knifes e20 as he listens to the Spy');
    // last the machine-gunner, whom nobody watches now
    // last the machine-gunner e23 in his nest: in the game its sandbags leave no footing within arm's reach of him, and a
    // pistol needs two hits. The Marine swims under the bridge to the bank's west end, takes his gear off in the
    // shallows, walks round behind the nest (the gun cannot traverse that way) and harpoons him: one silent shot
    {
      const e23 = D.get('e23');
      await walk(D, 'diver', [MA_NORTH]);
      D.ability('diver', 'dive');
      await D.until(() => !m.underwater && !m.diving, 6, 'the Marine out of his gear');
      await D.idle('diver', 3);
      await dash(D, 'diver', () => way(D, [m.x, m.z], [MA_E23], 'diver', 'stand'), { mode: 'walk', maxSec: 600, hold: 3, label: 'the Marine round behind the nest' });
      await waitFor(D, function* (why) {
        if (D.t < (m._harpoonT ?? -1)) { why.push('reloading'); return false; }
        if (yield* standSeenG(D, [[m.x, m.z, 0, 0], [m.x, m.z, 0, 0.8]], { slack: 0.4, why, keepWalker: 0 })) return false;
        return !(yield* standSeenG(D, [[e23.x, e23.z, 0, 0.3], [e23.x, e23.z, 0, 0.8]], { slack: 0.4, why, except: [e23], pad: 0 }));
      }, 300, 'the moment to harpoon e23');
      D.ability('diver', 'harpoon', e23);
      await D.until(() => !e23.alive, 3, 'e23 harpooned');
      await D.idle('diver', 3);
    }
    D.checkpoint('H12 the Marine harpoons the machine-gunner e23 from behind his nest: the north bank is clear');
  }],
  ['I', 'Out before dawn', async (D) => {
    const w = D.world, m = D.c('diver');
    const guests = ['gilbert', 'fr1', 'fr2', 'fr3', 'fr4'].map((t) => w.commandos.find((c) => c.tag === t));
    const p26 = ['p26a', 'p26b', 'p26c'].map((t) => D.get(t));
    // Patrol 26 walks the road by the lorry. The Spy waits for it at the far east end of its beat and talks to the
    // sergeant there: the three stand listening, fifty metres from the lorry, for as long as she talks
    await walk(D, 'spy', [P26_SPY]);
    await D.until(() => p26[0].brain?.atWait && Math.hypot(p26[0].x - 62, p26[0].z - 18) < 1.5, 900, 'Patrol 26 at its east halt');
    D.ability('spy', 'distract', p26[0]);
    await D.until(() => p26.every((e) => e.brain?.state === 'DISTRACTED'), 6, 'Patrol 26 listens to the Spy');
    D.checkpoint('I1 the Spy holds Patrol 26 at the far east end of its beat');
    // meanwhile the Marine, done on the north bank, walks down the north road to the lorry and climbs in (nobody is
    // left there; the lorry waits from the start and leaves only once everyone is aboard)
    const truck = w.vehicles.find((v) => (v.tag ?? v.spawn?.id) === 'truck'), gb = D.c('greenberet');
    if (m.diving || m.underwater) {
      await walk(D, 'diver', [MA_NORTH]);
      D.ability('diver', 'dive');
      await D.until(() => !m.underwater && !m.diving, 6, 'the Marine out of his gear');
    }
    D.ability('diver', 'enterVehicle', truck);
    // the Green Beret walks back over the road bridge (the bunker's gunner still faces the decoy) and crawls along the
    // river path and into the yard to the cage's door; he opens it: all five come out
    try {
      await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], [BRIDGE_N, BRIDGE_S], gb, 'stand'), { mode: 'walk', maxSec: 10, label: 'the Green Beret back over the bridge' });
    } catch (e) { if (!/timeout/.test(e.message)) throw e; }
    await D.stance('greenberet', 'crawl');
    await walk(D, 'greenberet', [PEN_DOOR_STAND]);
    D.ability('greenberet', 'use', D.item('pen_door'));
    await D.until(() => w.objectives.find((o) => o.id === 'o1').done, 20, 'the five out of the cage');
    await D.idle('greenberet', 5);
    D.checkpoint('I2 the Green Beret opens the cage: Gilbert and his four men are free');
    // Gilbert leads his men out through the back gate, along the river path, over the road bridge and up the north
    // road to the lorry; the Green Beret behind them
    const go = async (role, pts, o = {}) => { for (const [x, z] of pts) { try { await D.go(role, x, z, { tol: 0.9, max: 200, ...o }); } catch (e) { if (!/short of/.test(e.message)) throw e; } } };
    // (the Green Beret a waypoint behind the last of the file: never in its way at the gate or the bridge's end)
    await go('gilbert', MARCH.slice(0, 3));
    D.order('greenberet', { type: 'move', x: MARCH[0][0], z: MARCH[0][1] });
    D.checkpoint('I3 Gilbert and his men walk out through the back gate');
    await go('gilbert', MARCH.slice(3, 5));
    D.order('greenberet', { type: 'move', x: MARCH[2][0], z: MARCH[2][1] });
    D.checkpoint('I4 over the road bridge');
    await go('gilbert', MARCH.slice(5));
    D.order('greenberet', { type: 'move', x: MARCH[3][0], z: MARCH[3][1] });
    D.checkpoint('I5 along the north road to the lorry');
    // the lorry waits for them; the five climb in
    for (const g of guests) {
      D.order(g.tag, { type: 'ability', id: 'enterVehicle', target: truck });
      await D.until(() => g.vehicle === truck, 60, `${g.tag} into the lorry`);
    }
    D.checkpoint('I6 the five climb into the lorry');
    // the Green Beret gets up and walks after them (a crawl the whole way took three minutes), then climbs in too
    try {
      await dash(D, 'greenberet', () => way(D, [gb.x, gb.z], MARCH.slice(4), gb, 'stand'), { mode: 'walk', maxSec: 20, label: 'the Green Beret up and after them' });
    } catch (e) { if (!/timeout/.test(e.message)) throw e; await go('greenberet', MARCH.slice(4)); }
    await D.until(() => m.vehicle === truck, 180, 'the Marine into the lorry');
    D.ability('greenberet', 'enterVehicle', truck);
    await D.until(() => gb.vehicle === truck, 180, 'the Green Beret into the lorry');
    D.checkpoint('I7 the Green Beret climbs in after the Marine');
    // the Spy last: she leaves the patrol and walks to the lorry; it drives off west
    D.order('spy', { type: 'stop' });
    // (walking, in uniform: a running man is suspect; she gets in at the lorry's side)
    await walk(D, 'spy', [[34, 18.5], LORRY_SIDE]);
    D.ability('spy', 'enterVehicle', truck);
    await D.until(() => D.c('spy').vehicle === truck, 180, 'the Spy into the lorry');
    await D.until(() => w.objectives.find((o) => o.id === 'o2').done, 90, 'the lorry drives off');
    D.checkpoint('I8 the Spy climbs in last and the lorry drives off west: mission complete');
  }],
];

/** A run starts from nothing an earlier run in this page left (video mode's 'Again', a jump back: the same module
 *  instance must play the scripted run again): no stash taken, no remembered sighting or prediction. */
function freshRun() {
  usedStash.clear();
  _ssMemo.clear();
  PM.key = null;
  for (const m of [...PM.maps, ...PM.turn]) m.clear();
  releaseEpoch = 0;
}

export async function solve(D, ctx = {}) {
  const w = D.world;
  w.sneakPaths = true;
  freshRun();
  snapSpots(D);
  const skip = new Set([...(globalThis.process?.env?.M17SKIP ?? '').split(',').filter(Boolean), ...(ctx.skip || [])]);
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    if (skip.has(id)) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
export const __dev = { standSeen: (...a) => standSeen(...a), bodySeen: (...a) => bodySeen0(...a), fixHeldPosts: (D) => fixHeldPosts(D), predict: (e, t) => predict(e, t), asIfReleased: (D, f) => asIfReleased(D, f), holdFacingAway: (...a) => holdFacingAway(...a), stashCands: (D, v, o) => sliced(D, asIfReleasedG(D, stashCandsG(D, v, o))), YARD_E };
