/**
 * M15 "The End of the Butcher" (src/missions/m15_the_end_of_the_butcher.js, docs/missions/m15.md): the full solution,
 * player orders only. The HQ goes down to a tram "accident" (o2, no alarm), the general is shot at the corner of his
 * garden (o1) and the team leaves in the van by the north-west road (o3). Nobody is seen while he lives: the only alarm
 * is the one the mission forces, his body found after the shot. Mission retune this rests on: e6 faces east (see the
 * mission file); with him facing north no window ever opened on the square.
 *   A–C  the south bank: the three who wait crawl a few steps back among the wrecks; the Spy injects e1, e2 (bodies in
 *        the burned-out house) and e5 (behind the sentry box); the Marine swims under the central basin and spears e4
 *        on the sunken west stairs.
 *   D–E  the west lawn: the Spy takes e12 and e13 (bodies in the lawn's corner, the only spots nobody ever sees) and
 *        climbs ladder L1 for the German uniform on the balcony.
 *   F    in uniform she stops patrol p17 in the garden street; the Driver, the Sniper and the Marine crawl north, one at
 *        a time, from one hidden spot to the next (crawlLeg) up to the north-west road.
 *   G    she injects e24 (cemetery; body behind the tombs) and e20 (body in the north-west road).
 *   H    the Driver rides the tram; she stops the cemetery patrol p22 and lets it go as the west-bound tram stops at S2
 *        (its round lasts as long as the tram's run: from then on it is away at every such stop), stops e19; the
 *        Driver gets off at S2, into the van, and drives it to the north-west road for the Sniper and the Marine.
 *   I    she stops e21; the Driver crawls into the fuel lot and takes the tanker; he parks it behind the tram at the
 *        line's east end, by the corner of the HQ's service range, and jumps into the tram: it sets off and blows the
 *        tanker, the range and the house behind it up.
 *   J    he rides to the west end and back to the van; the van stops by the townhouse; the Sniper fires once (silent)
 *        at the pause, when nobody would see him climb back in; everyone gets in and the van drives out.
 * Walkthrough (debug video mode): m15.walkthrough.mjs. Regression test: tests/m15-solution.test.mjs.
 * It plays the same in the headless sim (run-headless) and in the real game (run-browser), whose nav grid also has
 * the meshes' clearance (map-builder rule e): the guards walk slightly other ways there, halt a little short of their
 * points, lamp posts and the tram-stop shelters stop a vehicle. So every wait is decided on what the guards will do
 * (sneak.mjs with sneakPaths / sneakSweepSteps / withoutMovers), not on fixed times, and the routes keep clear of
 * the posts.
 */
import { CONFIG } from '../../src/config.js';
import { onLowerStairs } from '../../src/missions/scripts/m15.js';
import { GENERAL_PAUSE } from '../../src/missions/m15_the_end_of_the_butcher.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { shotSight } from '../../src/abilities/common.js';
import { sneak, clearFor, clearForGen, routeClear, routeClearGen, unwitnessed, bodySeen, bodySeenGen, predict, viewersOf, walking, walkerSees, staticSees, withoutMovers, moversOff, wheeling } from './sneak.mjs';
import { ghost } from './ghost.mjs';

const DBG = !!(globalThis.process?.env?.M15DBG || globalThis.__M3DBG);
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };

/** crawl to (x, z) on a space-time plan (waits only where nobody looks) */
async function crawl(D, role, x, z, { turns = false, ...o } = {}) {
  const w = D.world, t0 = w.sneakTurns;
  if (turns) w.sneakTurns = Array.isArray(turns) ? new Set(turns) : true; // (the walkers' turns as they set off: a man about-turning at a halt sweeps his eyes across)
  try { await sneak(D, x, z, { mode: 'crawl', role, box: 8, label: `${role} → (${x},${z})`, ...o }); } finally { w.sneakTurns = t0; }
}

/**
 * One go along `pts` without stopping (crawling, or walking), once nobody would see him anywhere on the way at the
 * pace he goes (tried slow and fast), the walkers' turns at their halts included.
 */
async function dash(D, role, pts, { mode = 'crawl', maxSec = 300, label = '', pad = 1.2, slack = 1, slackRate = 0, hold = 0, keepWalker = 4, except = null, turns = null } = {}) {
  const u = D.c(role), w = D.world, t00 = w.sneakTurns;
  if (turns) w.sneakTurns = new Set(turns);
  try { await dash0(D, role, pts, { mode, maxSec, label, pad, slack, slackRate, hold, keepWalker, except }); } finally { w.sneakTurns = t00; }
}
async function dash0(D, role, pts, { mode, maxSec, label, pad, slack, slackRate, hold, keepWalker, except }) {
  const u = D.c(role), w = D.world;
  // (a crawler goes ~0.9 m/s, a little less round corners: with a slack that grows along the leg (slackRate) two speeds
  // bracket him; without, a wider spread)
  const run = mode === 'run', speeds = mode === 'crawl' ? (slackRate ? [0.85, 0.9] : [0.7, 0.8, 0.9]) : run ? [4.0, 4.5] : [2.0, 2.3];
  const want = mode === 'crawl' ? 'crawl' : 'stand';
  // (he gets up, or down, only when he goes: the change of stance first, ~0.6 s, where he lies)
  const up = u.stance === want ? 0 : 0.7;
  // (`pts` may be a function: the way, laid afresh every couple of seconds — round what stands in it now: a tram at
  // its stop is gone a minute later)
  let way = typeof pts === 'function' ? null : pts, wayT = -1;
  const wayNow = () => { if (typeof pts === 'function' && (!way || D.t - wayT >= 2)) { way = pts(); wayT = D.t; } return way; };
  // (the look along the whole way against every guard, at each pace: sliced over frames in the live replay)
  await waitForSliced(D, function* (why) {
    const P = wayNow();
    if (up && mode !== 'crawl' && standSeen(D, [[u.x, u.z, u.y || 0, 0.3], [u.x, u.z, u.y || 0, up]], { slack: 0.4, why, except: except || [] })) return false;
    if (run && heardRunning(D, [u.x, u.z], P, speeds[0], up, why)) return false;
    for (const speed of speeds) if (!(yield* routeClearGen(D, P, { mode: run ? 'walk' : mode, from: [u.x, u.z], speed, delay: up, slack, slackRate, hold, keepWalker, pad, why, except }))) return false;
    return true;
  }, maxSec, label || `${role} along ${JSON.stringify(typeof pts === 'function' ? '(way)' : pts)}`);
  await D.stance(role, want);
  for (const [x, z] of way) {
    try { await D.go(role, x, z, { tol: 0.5, max: 60, run }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  }
}

/**
 * the walkable way through `pts`, as the man's own planner lays it (Unit._planPath: round the vehicles' hulls and the
 * other solid things with his body's clearance, as he will really go), corners kept; a crawler's
 */
function wayThrough(D, role, pts, { stance = 'crawl' } = {}) {
  const u = D.c(role), out = [];
  let [x, z] = [u.x, u.z];
  let own = false;
  const plan = (x0, z0, tx, tz) => {
    own = false;
    if (typeof u._planPath !== 'function') return D.world.findPath(x0, z0, tx, tz, { role: u.role });
    const g = ghost(u); // (him, standing at (x0, z0) in that stance: no dodge lane, no corner curve — through his mirror: ghost.mjs)
    Object.assign(g, { x: x0, z: z0, stance, _laneX: 0, _laneZ: 0, _curveX: 0, _curveZ: 0 });
    const p = g._planPath(tx, tz);
    if (p) { own = true; return p; }
    return D.world.findPath(x0, z0, tx, tz, { role: u.role });
  };
  for (const [tx, tz] of pts) {
    const p = plan(x, z, tx, tz);
    if (!p) throw new Error(`no way from (${x.toFixed(1)},${z.toFixed(1)}) to (${tx},${tz})`);
    for (const q of p.slice(1)) out.push([q.x, q.z]);
    // (his own planner ends where he can lie — a point a hull's or a mesh's clearance keeps him off: short of it;
    // the grid's pathfinder ends on the cell, so the point itself, when walkable)
    if (!out.length || (!own && Math.hypot(out.at(-1)[0] - tx, out.at(-1)[1] - tz) > 0.3 && D.world.grid.walkableAt(tx, tz))) out.push([tx, tz]);
    [x, z] = out.length ? out.at(-1) : [tx, tz];
  }
  // (thinned: a point every ~2 m, the corners kept)
  const thin = [];
  for (const q of out) { const l = thin.at(-1); if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 2 || q === out.at(-1)) thin.push(q); }
  return thin;
}

/** one crawl along the walkable way through `pts`, once nobody would see him anywhere on it (from a spot nobody sees) */
async function crawlLeg(D, role, pts, { maxSec = 900, label = '', slack = 1, slackRate = 0.04, hold = 0, keepWalker = 4, pad = 1, turns = null } = {}) {
  // (the farther along the leg, the less sure the guards' timing: 1 s of slack + 4 % of the time ahead)
  await dash(D, role, () => wayThrough(D, role, pts), { mode: 'crawl', maxSec, slack, slackRate, hold, keepWalker, pad, turns, label: label || `${role} to (${pts.at(-1)})` });
}

/**
 * Would anyone hear him run along `pts` (his steps carry ~10 m on the cobbles, CONFIG.stealth.runNoise; 1 m to spare)?
 */
function heardRunning(D, from, pts, speed, delay, why = null) {
  const R = (CONFIG.stealth?.runNoise?.radius?.road ?? 10) + 1, samples = timed(from, pts, speed, delay);
  for (const e of viewersOf(D.world)) {
    if (e.vehEye) continue;
    for (const [x, z, , t] of samples) {
      for (const o of [-0.5, 0, 0.5]) {
        const q = walking(e) ? predict(e, Math.max(0, t + o)) : e;
        if (Math.hypot(q.x - x, q.z - z) < R) { why?.push(`${e.tag} hears@(${x.toFixed(1)},${z.toFixed(1)})+${t.toFixed(1)}`); return true; }
      }
    }
  }
  return false;
}

/**
 * waitFor for a check written as a generator (`yield*` sneak.mjs routeClearGen…): the same check at the same ticks,
 * sliced over frames in the live replay (driver runSliced: the frame is handed back every PLAN_SLICE_MS with no tick in
 * between; the line-of-sight layer is the game's for those frames, without the movers again for the next slice), at once
 * headless. A dash's look along its whole way against every guard otherwise took 60-130 ms of one frame (stage I).
 */
async function waitForSliced(D, gen, maxSec, label, every = 0.2, { keep = 0 } = {}) {
  const why = [], stats = new Map();
  let next = -1;
  await D.untilAsync(async () => {
    if (D.t + 1e-9 < next) return false;
    next = D.t + every;
    why.length = 0;
    // (as waitFor: movers off the sight layer, the walkers' turns at their halts on — for the slices only)
    const w = D.world, off = moversOff(w, { keep });
    let t0;
    const ok = await D.runSliced(gen(why), {
      enter() { t0 = w.sneakTurns; w.sneakTurns = true; off?.enter(); },
      leave() { off?.leave(); w.sneakTurns = t0; },
    });
    if (!ok && why[0]) { const k = why[0].replace(/[@(+].*$/, ''); stats.set(k, (stats.get(k) || 0) + 1); }
    if (!ok && DBG && why[0] && why[0] !== 'not-ready' && globalThis.process?.env?.M15DBGLABEL && label.includes(globalThis.process.env.M15DBGLABEL)) dbg(D, `${label}: ${why.slice(0, 6).join(' ')}`);
    return ok;
  }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 5).join(' ')}] {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(' ')}}`); });
}

/** wait until `pred` holds (tried every `every` s: the checks look far ahead); the reasons it does not (why[]) go into
 * the timeout error */
async function waitFor(D, pred, maxSec, label, every = 0.2, { keep = 0 } = {}) {
  const why = [], stats = new Map();
  let next = -1;
  await D.until(() => {
    if (D.t + 1e-9 < next) return false;
    next = D.t + every;
    why.length = 0;
    // (looking ahead, a tram or a moving truck that hides him now is no cover: sneak.withoutMovers; and a man setting
    // off from a halt may turn either way round, his eyes sweeping all between: sneakTurns)
    const w = D.world, t0 = w.sneakTurns;
    w.sneakTurns = true;
    let ok;
    try { ok = withoutMovers(w, () => pred(why), { keep }); } finally { w.sneakTurns = t0; }
    if (!ok && why[0]) { const k = why[0].replace(/[@(+].*$/, ''); stats.set(k, (stats.get(k) || 0) + 1); }
    if (!ok && DBG && why[0] && why[0] !== 'not-ready' && globalThis.process?.env?.M15DBGLABEL && label.includes(globalThis.process.env.M15DBGLABEL)) dbg(D, `${label}: ${why.slice(0, 6).join(' ')}`);
    return ok;
  }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 5).join(' ')}] {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(' ')}}`); });
}

/** shoulder (Spy) or drag (anyone else) body `e` to (x, z) along `via` and let go */
async function carryTo(D, role, e, [x, z], via = []) {
  const u = D.c(role);
  await D.idle(role);
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 20, `grab ${e.tag}`);
  for (const [px, pz] of via) { try { await D.go(role, px, pz, { tol: 0.7, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - px, u.z - pz) > 2.5) throw err; } }
  try { await D.go(role, x, z, { tol: 0.5, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `let go of ${e.tag}`);
  await D.idle(role);
}

/**
 * Would anyone see a man standing at the timed spots `samples` ([x, z, y, t]: t s from now), each tried `slack` s
 * early and late (walkers along their predicted beat, the turns at their halts too; posts by their sweep)?
 */
function standSeen(D, samples, o = {}) {
  const it = standSeenGen(D, samples, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** standSeen as a generator (the same answer; it yields every few looks: a sliced wait hands the frame back) */
function* standSeenGen(D, samples, { slack = 1, why = null, except = [], only = null, keepWalker = 3, low = false, pad = 0.75 } = {}) {
  const w = D.world, t0 = w.sneakTurns;
  w.sneakTurns = true;
  let looks = 0;
  try {
    for (const e of viewersOf(w)) {
      if (except.includes(e) || (only && e !== only)) continue;
      const far = (e.vision?.far ?? 36) + 2, moving = walking(e);
      for (const [x, z, y, t] of samples) {
        for (let o = -slack; o <= slack + 1e-6; o += 0.25) {
          if ((++looks & 15) === 0) { w.sneakTurns = t0; yield; w.sneakTurns = true; }
          const tt = Math.max(0, t + o);
          const d = { x, z, y, isLow: low, isVisibleToEnemies: true, alive: true, kind: 'commando' };
          // (`pad`: at the very edge of a band he may be a step nearer than timed: the spot `pad` m nearer too)
          const nearer = (vx, vz) => { const L = Math.hypot(vx - x, vz - z); return pad && L > pad ? { ...d, x: x + ((vx - x) * pad) / L, z: z + ((vz - z) * pad) / L } : null; };
          let seen;
          if (moving) {
            const q = predict(e, tt), dd = Math.hypot(q.x - x, q.z - z);
            if (dd > far) continue;
            const d2 = nearer(q.x, q.z);
            seen = dd < keepWalker || walkerSees(e, q, d, w, w.time + tt) || (!!d2 && walkerSees(e, q, d2, w, w.time + tt))
              // (a squad man wheeling round a corner of the round: from the heading he comes with round to the one he
              // leaves with; stepping up beside his halted leader: any way)
              || (wheeling(e, tt) && wheelHeadings(e, tt).some((h) => walkerSees(e, { ...q, heading: h }, d, w, w.time + tt)));
          } else {
            if (Math.hypot(e.x - x, e.z - z) > far) continue;
            const d2 = nearer(e.x, e.z);
            seen = staticSees(e, d, w, tt) || (!!d2 && staticSees(e, d2, w, tt));
          }
          if (seen) { why?.push(`${e.tag}@(${x.toFixed(1)},${z.toFixed(1)},y${y.toFixed(1)})+${tt.toFixed(1)}`); return true; }
        }
      }
    }
    return false;
  } finally { w.sneakTurns = t0; }
}

/** The headings a squad man wheeling at `t` may face (sneak.wheeling): round a corner, between the heading he comes
 * with and the one he leaves with (the short way); by his halted leader, any. */
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

/** timed spots along straight legs `pts` from `from` (y from `y(t)` or 0) at `speed` m/s, from `t0` s: [[x, z, y, t]…] */
function timed(from, pts, speed, t0, y0 = 0, y1 = y0) {
  const out = [];
  let [x, z] = from, t = t0;
  const L = pts.reduce((a, p, k) => a + Math.hypot(p[0] - (k ? pts[k - 1][0] : from[0]), p[1] - (k ? pts[k - 1][1] : from[1])), 0) || 1;
  let done = 0;
  out.push([x, z, y0, t]);
  for (const [px, pz] of pts) {
    const l = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 1; k <= n; k++) { const f = (done + (l * k) / n) / L; out.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, y0 + (y1 - y0) * f, t + (l * k) / n / speed]); }
    done += l; t += l / speed; x = px; z = pz;
  }
  return out;
}

/** a standing stand-in for `u` (where he will get up to strike) */
const standing = (u, x = u.x, z = u.z) => ({ x, z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

// ---------------------------------------------------------------- places (m)
/** the burned-out house south-west of the start: its gap in the east wall, the Spy's ambush spot by e1's halt, and
 * its north-west inner corner (no line of sight from anywhere outside reaches a body lying there) */
const RUIN_GAP = [25.2, 131];
const RUIN_IN = [22.5, 131];
const E1_AMBUSH = [22.4, 127.6];
const RUIN_NW = [6.6, 124.4];
/** e2's west halt; inside the house by its north wall (nobody sees in there); the way out through the gap and round
 * the north-east corner (from the body's end) */
const E2_WEST = [22.29, 121.05];
const RUIN_WAIT = [22.5, 127.5];
const RUIN_BODY2 = [21.5, 126.0];
const RUIN_OUT = [[25.3, 124.2], [25.2, 130.5], [22.5, 130.5]];
/** on the lawn behind the broken fence west of the fountain square, a step from the gap */
const LAWN_NEAR = [1.5, 80.5];
/** out of the house through the gap, round its north-east corner, west along its north wall to behind the sentry box */
const RUIN_TO_BOX = [[22.8, 130.3], [25, 129.2], [25.3, 123.6], [23, 121.8], [4.5, 121.2], [1.0, 126.0]]; // (the walkable way through: wayThrough)
/** the east stairs' foot on the street and a step into their shallows; under water below the west stairs */
const S2_FOOT = [48.5, 121.5];
const S2_IN = [48.6, 119.5];
const S1_WATER = [29, 106.5];
/** under water at the foot of the east stairs; their dry upper steps; the Marine's place among the wrecks */
/** where the three who wait lie among the wrecks (e1 and e2 look at the start's open end of the wrecks while they live:
 * a step back south, nobody ever sees them) */
const START_SPOTS = { sniper: [35, 138.25], driver: [37.5, 138.5], diver: [39.5, 138.5] };
const S2_UNDER = [48.8, 119.8], S2_DRY = [50.3, 120.6], START_MARINE = START_SPOTS.diver;
/** the sentry box at the west end of the south street: e5's south halt and the body's place behind it */
const E5_SOUTH = [4.97, 119.21];
const BOX_BODY = [1.5, 125.4];

/** the corner block: ladder L1 (street to balcony) and the clothes rack on the balcony */
const L1_FOOT = [22.1, 63.4];
const L1_TOP = [22.75, 60.99];
/** a step off the ladder's foot, on the street */
const L1_DOWN = [23.4, 64.6];
/** round the armoured car (it blocks the corner) into the garden street's south end */
const TO_GARDEN_ST = [[26.5, 71.5], [33.5, 71.5], [36.5, 64]];
/** where she meets patrol p17 coming down the garden street */
const P17_STOP = [35.6, 58.4];
const CLIMB_START = [22.4, 64.3];
const RACK_STEPS = [[20.5, 60.1], [21.46, 59.53]];
/** under the balcony, a few steps west of the ladder (with e13 gone nobody looks along the block's south face) */
const FACADE_WAIT = [19.5, 62.5];
const BAL = 4.5;

/**
 * Would anyone see the Spy's climb to the clothes rack, starting now from where she lies: on her belly to the ladder's
 * foot, up (0.7 s), a step to the rungs, up them (~6.3 s, measured), along the balcony to the rack and dressing behind
 * the laundry (~4.1 s)?
 */
/** Would anyone see the Spy crawl to the ladder's foot and climb to the uniform? (climbSeenGen at once: dev tools) */
function climbSeen(D, why) { const it = climbSeenGen(D, why); for (;;) { const r = it.next(); if (r.done) return r.value; } }
function* climbSeenGen(D, why) {
  const sp = D.c('spy'), from = [sp.x, sp.z];
  const L = Math.hypot(CLIMB_START[0] - from[0], CLIMB_START[1] - from[1]);
  for (const speed of [0.7, 0.9]) if (L > 0.3 && !(yield* routeClearGen(D, [CLIMB_START], { mode: 'crawl', from, speed, slack: 1, pad: 1, why }))) return true;
  const tf = L / 0.85, ts = L / 0.7, tm = (tf + ts) / 2, sl = (ts - tf) / 2 + 1;
  const up = tm + 0.7, foot = up + 1.0, top = foot + 6.3;
  const spots = [[...CLIMB_START, 0, up], ...timed(CLIMB_START, [L1_FOOT], 1.2, up),
    ...timed(L1_FOOT, [L1_TOP], Math.hypot(L1_TOP[0] - L1_FOOT[0], L1_TOP[1] - L1_FOOT[1]) / 6.3, foot, 0, BAL),
    ...timed(L1_TOP, RACK_STEPS, 1.0, top, BAL, BAL), [...RACK_STEPS[1], BAL, top + 3.5], [...RACK_STEPS[1], BAL, top + 4.5]];
  return yield* standSeenGen(D, spots, { slack: sl, why });
}

/** the broken fence's gap onto the square, e12's west halt, the lawn's north-west corner where a body lies unseen */
const FENCE_GAP = [5.6, 77.8];
const E12_HALT = [4, 70];
const LAWN_BODIES = [[2.5, 82.5], [3.0, 82.75]]; // (behind the crate in the corner: no man on his way, in his halts' sweeps, ever sees a body there — static scan, both navs)
/** (the look-ahead's file-man predictions say p17 sees those corners; the game's own cones over 2000 s say nobody does) */
const lawnCorner = (x, z) => LAWN_BODIES.some(([a, b]) => Math.hypot(x - a, z - b) < 0.3);

/**
 * The Spy (out of uniform) injects walker `victim` from behind as he stands at his halt `at` (or turns away from it)
 * and shoulders him to `carry` along `via`: once nobody but him would see her get up, walk to him, and carry him
 * off (standing all the while), he does not see her coming, the body is not seen where it falls before she lifts it,
 * and nobody will ever see it where she leaves it.
 */
async function ambush(D, victim, { ready = () => true, carry, via = [], carryVia = null, approachVia = null, strikeAt = null, hidden = () => false, stash = null, stashFor = 40, maxSec = 400, reach = 1.0, speed = 2.0, slack = 0.8, haltExact = null, maxT = 14 } = {}) {
  const sp = D.c('spy'), cvia = carryVia ?? via;
  const seenBy = hidden(...carry) ? [] : await D.runSliced(bodySeenGen(D, carry[0], carry[1], 300, { except: [victim] })); // (300 s of look: sliced)
  if (seenBy.length) D.log(`WARN body spot (${carry}) is seen: ${seenBy.join(',')}`);
  // (sliced over frames in the live replay: waitForSliced)
  await waitForSliced(D, function* (why) {
    if (!ready(victim)) { why.push('not-ready'); return false; }
    // (a body left a while where she can carry it no farther at once: nobody may see it there meanwhile)
    if (stash && bodySeen(D, stash[0], stash[1], stashFor, { except: [victim] }).length) { why.push('stash seen'); return false; }
    // where she catches him: on her feet (0.6 s), walking straight to arm's length behind him as predicted
    const go = approachVia ?? [...via].reverse();
    let tHit = null, q = null;
    for (let t = 0.8; t <= maxT; t += 0.2) {
      q = predict(victim, t);
      const back = strikeAt ?? [q.x - Math.cos(q.heading) * reach, q.z - Math.sin(q.heading) * reach];
      let L = 0, p = [sp.x, sp.z];
      for (const r of [...go, back]) { L += Math.hypot(r[0] - p[0], r[1] - p[1]); p = r; }
      if (0.6 + L / speed <= t) { tHit = t; break; }
    }
    if (tHit == null) { why.push('cannot catch him'); return false; }
    const back = strikeAt ?? [q.x - Math.cos(q.heading) * reach, q.z - Math.sin(q.heading) * reach];
    const way = timed([sp.x, sp.z], [...go, back], speed, 0.6);
    // (the needle 0.9 s, the man falling, the lift onto her shoulder: she walks off with him ~2.9 s after she reaches
    // his back — measured)
    const dropAt = stash || carry, carryWay = timed(back, [...cvia, dropAt], 1.6, tHit + 2.9);
    const h0 = D.world.sneakHaltExact;
    if (haltExact != null) D.world.sneakHaltExact = haltExact; // (a halted man's head where his sweep puts it, ± that)
    // (and on her feet at his back meanwhile: the needle, his fall, the lift)
    const atBack = []; for (let t = tHit; t < tHit + 2.9; t += 0.5) atBack.push([back[0], back[1], 0, t]);
    try { if (yield* standSeenGen(D, [...way, ...atBack, ...carryWay, [...dropAt, 0, carryWay.at(-1)[3] + 0.8]], { slack, why, except: [victim] })) return false; } finally { D.world.sneakHaltExact = h0; }
    // (he must not see her coming: his cone as predicted, her on her feet, until she is at his back)
    if (yield* standSeenGen(D, way.filter((r) => Math.hypot(r[0] - back[0], r[1] - back[1]) > 1.5), { slack: 0.4, why, keepWalker: 0, only: victim })) return false;
    // the body where he falls, until she has him on her shoulder
    if (bodySeen(D, q.x, q.z, tHit + 4, { except: [victim] }).length) { why.push('body seen where he falls'); return false; }
    return true;
  }, maxSec, `${victim.tag} unwatched`);
  await D.stance('spy', 'stand');
  for (const r of approachVia ?? [...via].reverse()) await D.go('spy', ...r, { tol: 0.6, max: 20 });
  if (strikeAt) await D.go('spy', ...strikeAt, { tol: 0.35, max: 10 });
  // (after him, a step behind his back, then the needle)
  for (let n = 0; n < 80 && Math.hypot(victim.x - sp.x, victim.z - sp.z) > reach + 0.15; n++) {
    D.order('spy', { type: 'move', x: victim.x - Math.cos(victim.heading) * 0.8, z: victim.z - Math.sin(victim.heading) * 0.8 });
    await D.wait(0.2);
  }
  D.ability('spy', 'syringe', victim);
  await D.until(() => !victim.alive, 6, `${victim.tag} injected`);
  await D.idle('spy', 5);
  await carryTo(D, 'spy', victim, stash || carry, cvia);
  await D.stance('spy', 'crawl');
  if (stash) await moveBody(D, victim, carry, { maxSec: stashFor });
}

/**
 * The Marine, under water, spears `victim` once `ready()` holds: he comes up for the shot (0.4 s) where nobody sees him,
 * the victim has his back to him, nobody else sees the man fall (or `hidden(x, z)`: where he falls nobody can see him
 * lying), and he goes under again.
 */
async function spear(D, victim, { ready = () => true, hidden = () => false, quiet = 60, maxSec = 300, label = '' } = {}) {
  const m = D.c('diver');
  const me = () => ({ x: m.x, z: m.z, y: 0, isLow: true, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  await waitFor(D, (why) => {
    if (!victim.alive) return true;
    if (!ready(victim)) { why.push('not-ready'); return false; }
    if (Math.hypot(victim.x - m.x, victim.z - m.z) > 8.5) { why.push('out of reach'); return false; }
    // (he must not see the head come up: his cone as predicted over the shot)
    if (standSeen(D, [[m.x, m.z, 0, 0], [m.x, m.z, 0, 0.5]], { slack: 0.3, why, keepWalker: 0, only: victim, low: true })) return false;
    if (!clearFor(D, [[m.x, m.z]], 1.0, { mode: 'crawl', except: [victim], why })) return false;
    if (!unwitnessed(D, victim, me(), { ahead: 0.5, why })) return false;
    const q = predict(victim, 0.25);
    if (!hidden(q.x, q.z) && bodySeen(D, q.x, q.z, quiet, { except: [victim] }).length) { why.push('body seen'); return false; }
    return true;
  }, maxSec, `spear ${victim.tag}${label ? ' ' + label : ''}`, 0.05);
  D.ability('diver', 'harpoon', victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} speared`);
  await D.idle('diver', 3);
}

/**
 * The Spy (lying beside it) takes body `e` on to `to` along `via` when nobody would see her get up, lift it, carry
 * it and put it down (on her feet all the while).
 */
async function moveBody(D, e, to, { via = [], maxSec = 120 } = {}) {
  const sp = D.c('spy');
  await waitFor(D, (why) => {
    const way = timed([e.x, e.z], [...via, to], 1.6, 0.6 + 1.0);
    return !standSeen(D, [[sp.x, sp.z, 0, 0.3], [e.x, e.z, 0, 1.6], ...way, [...to, 0, way.at(-1)[3] + 0.8]], { slack: 0.6, why });
  }, maxSec, `carry ${e.tag} on unseen`);
  await D.stance('spy', 'stand');
  await carryTo(D, 'spy', e, to, via);
  await D.stance('spy', 'crawl');
}

/** where each man lies on the north-west road, out of every cone, waiting for the van */
const NW_SLOTS = { spy: [12, 5], driver: [13.5, 7], sniper: [10.5, 6.5], diver: [14, 4.5] };
/** the crossing's resting places (2000 s scans: nobody ever sees a man lying there) */
const W1_CORNER = [0.6, 108.2], LAWN_WAIT = [1.5, 84.5], AVENUE_TOP = [1.5, 40];

/**
 * From the wrecks at the start (or, the Marine, from the foot of the west stairs) to the north-west road, on his belly
 * from one spot nobody looks at to the next, each stretch in one go when nobody would see him anywhere along it: into
 * the burned-out house; out round its north-east corner, west along its north wall and up the street's west edge to
 * the corner of the west basin; along it and north over the west bridge (behind the canal
 * patrol p7) to the lawn behind the broken fence; up the west avenue (e12 and e13 are gone, p17 held by the Spy) to its
 * north end; across the end of the tram street behind e20's back and up the north-west road, where nobody looks.
 */
async function crossToNW(D, role, slot, { from = 'start' } = {}) {
  if (from === 'start') {
    await crawl(D, role, ...RUIN_WAIT, { box: 6, hold: 10, maxWait: 900 });
    // (in one go: the canal patrol p7 sees the whole street's west end, and the strip behind the sentry box is too
    // narrow for a man on his belly in the game's nav)
    await crawlLeg(D, role, [[22.8, 130.3], [25.6, 129.5], [25.4, 122.6], [4.5, 121.6], [0.6, 118], W1_CORNER]);
    await crawlLeg(D, role, [[10, 107.6], [13, 103], [13, 90], LAWN_WAIT]);
  }
  await crawlLeg(D, role, [FENCE_GAP, [3, 73], [1.5, 68], AVENUE_TOP]);
  await crawlLeg(D, role, [[4, 28], [5.5, 20], [7, 14], [9.5, 10], slot], { turns: ['e20'] });
}

/**
 * The Marine, under water at the foot of the west stairs (e6 watches those stairs every sweep now), swims back under
 * the basin to the east stairs, walks up out of their shallows onto the dry upper steps as nobody looks (the gear
 * off), and crawls back to the wrecks at the start.
 */
async function marineToStart(D) {
  const m = D.c('diver'), gear = (CONFIG.abilities?.dive ?? 1.5) + 0.3;
  await D.go('diver', ...S2_UNDER, { tol: 0.4, max: 120 });
  await waitFor(D, (why) => clearFor(D, [[m.x, m.z], S2_DRY], gear + 1.5, { mode: 'walk', why }) && clearFor(D, [S2_DRY], 12, { mode: 'crawl', why }), 900, 'the east stairs unwatched');
  D.ability('diver', 'dive');
  await D.until(() => !m.diving, 6, 'the Marine out of his gear');
  await D.go('diver', ...S2_DRY, { tol: 0.3 });
  await D.stance('diver', 'crawl');
  await crawl(D, 'diver', ...START_MARINE, { box: 5, hold: 10, maxWait: 900 });
}

// ---------------------------------------------------------------- the north side: the tram, the van, the tanker
/** the cemetery: in past the chapel to stand behind e24; his body behind the north row of tombs (no line of sight) */
const TO_CEMETERY = [[42.5, 26], [49.2, 23.3], [52, 19], [66, 9.5], [78.5, 12.5]];
const E24_BEHIND = [77.1, 16.7], E24_VIA = [[77, 9.5], [72, 6.8], [66, 6.6], [64.5, 3.5]], E24_BODY = [64, 0.6];
/** e20's west halt at the end of the tram street; behind it; his body deep in the north-west road (out of every band) */
const FROM_CEMETERY_W = [[66, 6.6], [52, 19], [49.2, 23.3], [30, 21], [17.5, 19.9]];
const E20_HALT = [14, 19], E20_BEHIND = [16.3, 19.55], E20_VIA = [[13.4, 13.5], [9.8, 9.2]], E20_BODY = [9, 4.5];
/** the Driver down the north-west road to the tram's west terminus (beside its stopping place) */
const TO_TERMINUS = [[9.5, 10], [7.5, 15], [6.6, 20.6]];
/** the cemetery patrol's south-east corner and the Spy's way there (from the north-west road) and from there to e19 */
const P22_CORNER = [78, 27.5];
const TO_P22_CORNER = [[12, 10], [16, 15.5], [30.5, 18.5], [44, 23.5], [49.2, 23.3], [56, 21.5], [72, 24], [79.4, 25.5]];
const TO_E19 = [[72, 24], [56, 21.5], [49.2, 23.3], [50, 27]];
/** from the tram's north side at S2 through the cemetery gate to the van */
const S2_TO_GATE = [[50.5, 25], [49.4, 22.6], [53, 19.5]];
/** the Spy out of the van's way, by e21's corner */
const SPY_WEST = [36, 19.5];
/** the van: out of the cemetery gate, west along the tram street, up the north-west road */
const VAN_GATE = [[50.5, 19.0], [49.0, 25.5]], VAN_TO_NW = [[44, 29.5], [36, 28.5], [30, 27], [15, 17], [12.9, 13.8], [12.6, 10.1]]; // (clear of the tram-stop and lamp posts: a blocked van stops dead)
/** where the Spy talks to e21 (east of him: he turns his back on the townhouse front) */
const E21_TALK = [36.4, 16.3];
/** the Driver on his belly along the townhouse front into the fuel lot */
const TO_LOT = [[16, 14.5], [31, 17.2], [33.8, 13], [36.5, 9]];
/** the tanker out of the lot (wide of e21) and east to the north pavement past S2, 4.85 m off the rails (the tram's
 * blocker box reaches 4.45 m): its waiting place */
const TANKER_OUT = [[40.3, 12.5], [39.6, 19.6], [40, 23], [45.5, 28.5], [51, 32.2], [56.5, 33.0], [60.5, 35.9]]; // (south of the S2 shelter's post)
/** beside the rear of the tram standing at the east end, south of the rails, 6 m from the corner of the HQ's service range
 * on the street (the demolition point; the house stands back behind it since 10-29) (it parks
 * at about (68.2, 44.9)); where the Driver steps out (north-east side, behind the tanker from the yard) */
const TANKER_PARK = [68.6, 45.4], DROP_EXIT = [70.3, 44.0];
/** from the tram's north side at the west terminus up the north-west road */
const TERMINUS_TO_NW = [[8.5, 15.5], [9.8, 11]];
/** the van on the tram street by the townhouse; the Sniper's spot a few metres east of it (a clear line to the
 * general's pause, 44 m) */
const VAN_TO_SHOT = [[14.5, 17], [19.5, 19.6]], SHOT_SPOT = [21.5, 17.6], SHOT_RAILS_X = 43;

const tramOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'tram');
const vanOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'van');
const tankerOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'opel_blitz_tanker');
/** the tram standing at its west terminus ('W'), at S2 west-bound ('S2W'), at its east end ('E') */
function tramAt(tram, where) {
  if (tram.speed !== 0) return false;
  if (where === 'W') return tram.x < 5.6;
  if (where === 'E') return tram.x > 75;
  return Math.abs(tram.x - 55) < 1 && tram.railDir < 0;
}
/** where a rider steps out of the tram (its right side: north when it runs west) */
const tramExit = (tram) => { const h = tram.heading + Math.PI / 2; return [tram.x + Math.cos(h) * 2.3, tram.z + Math.sin(h) * 2.3]; };
/** will the tram stay > r m from x for the next `secs` s (its wait, then on at 6 m/s; ends and stops ignored)? */
function tramClearOf(tram, x, secs, r = 7) {
  const v = 6, wait = tram.speed === 0 ? Math.max(0, tram.waitT || 0) : 0;
  for (let t = 0; t <= secs; t += 0.5) { const tx = tram.x + tram.railDir * v * Math.max(0, t - wait); if (Math.abs(Math.min(76, Math.max(5, tx)) - x) < r) return false; }
  return true;
}
/**
 * Would a walking man or a patrol (alarmed, he may look any way) be within `r` m of any of `pts` with a clear line to it
 * in the next `secs` s (± 1 s)? The tag (why[]), or false.
 */
function patrolNear(D, pts, r, secs, why = null) {
  const g = D.world.grid;
  for (const e of viewersOf(D.world)) {
    if (e.vehEye || !(walking(e) || e.squad)) continue;
    for (let t = 0; t <= secs + 1e-6; t += 0.5) {
      for (const o of [-1, 0, 1]) {
        const q = walking(e) ? predict(e, Math.max(0, t + o)) : e;
        for (const [x, z] of pts) {
          if (Math.hypot(q.x - x, q.z - z) < r && g.lineOfSight(q.x, q.z, x, z)) { why?.push(`${e.tag} near@(${x.toFixed(1)},${z.toFixed(1)})+${t.toFixed(1)}`); return true; }
        }
      }
    }
  }
  return false;
}
/** drive vehicle `v` (the Driver at the wheel) to (x, z) */
async function drive(D, v, x, z, { run = false, max = 60 } = {}) {
  const t0 = D.t;
  D.order('driver', { type: 'move', x, z, run });
  await D.until(() => Math.hypot(v.x - x, v.z - z) < 1.5 || (!v.goal && (v.speed || 0) < 0.05 && D.t > t0 + 0.5 && Math.hypot(v.x - x, v.z - z) < 4), max, `${v.vehicleType} to (${x},${z})`);
}
/**
 * Who would walk into a commando-driven vehicle's front sensor box (1.8–5.4 m ahead, ±1.35 m: he steps aside and knows
 * it for ours), driving along `pts` from `from` at `speed` m/s (wide margins)? The guard's tag, or null.
 */
function inFrontBox(D, pts, from, speed) {
  const way = timed(from, pts, speed, 1);
  for (let k = 1; k < way.length; k++) {
    const [x, z, , t] = way[k], [px, pz] = way[k - 1], h = Math.atan2(z - pz, x - px), c = Math.cos(h), s = Math.sin(h);
    for (const e of viewersOf(D.world)) {
      if (e.vehEye) continue;
      const q = walking(e) ? predict(e, t) : e, dx = q.x - x, dz = q.z - z, al = dx * c + dz * s, la = -dx * s + dz * c;
      if (al > 0 && al < 7 && Math.abs(la) < 3) return e.tag;
    }
  }
  return null;
}
/**
 * Who would be within `r` m of a vehicle driven along `pts` from `from` at `speed` m/s (± 2 s)? It swings wide on its
 * turns, off the straight legs inFrontBox tries: a man that near may yet step into its sensor box. The tag, or null.
 */
function nearWay(D, pts, from, speed, r = 6) {
  for (const [x, z, , t] of timed(from, pts, speed, 1)) {
    for (const e of viewersOf(D.world)) {
      if (e.vehEye) continue;
      for (const o of [-2, 0, 2]) { const q = walking(e) ? predict(e, Math.max(0, t + o)) : e; if (Math.hypot(q.x - x, q.z - z) < r) return e.tag; }
    }
  }
  return null;
}
/**
 * Nobody would see `role` standing for `dur` s where he climbs into `v`: where he lies, at its door, at the vehicle
 * itself (the game counts him standing at the moment he gets in, wherever that puts him: director _onBoard).
 */
function boardClear(D, role, v, dur, why) {
  const u = D.c(role), bp = boardPoint(v, u);
  return clearFor(D, [[u.x, u.z], [bp.x, bp.z], [v.x, v.z]], dur, { mode: 'walk', why });
}
/** `role` gets into vehicle `v` (by its door; tried again if his way there was blocked) */
async function board(D, role, v, { tries = 3, max = 40 } = {}) {
  const u = D.c(role);
  for (let k = 0; k < tries && u.vehicle !== v; k++) {
    const msgs = [], off = D.world.events.on('message', (m) => { if (m.unit === u) msgs.push(m.text); });
    try {
      D.ability(role, 'enterVehicle', v);
      await D.until(() => u.vehicle === v || (!u.currentAction && !u.pendingAbility && D.t > 0), max, `${role} into the ${v.vehicleType}`);
    } finally { off?.(); }
    if (u.vehicle !== v) { D.log(`WARN ${role} did not get in (${msgs.join(' / ') || '?'}): again`); await D.wait(1); }
  }
  if (u.vehicle !== v) throw new Error(`${role} could not get into the ${v.vehicleType}`);
}

/** the Spy (in uniform, beside him) injects `victim` and carries him to `body` along `via` */
async function inject(D, victim, body, via) {
  D.ability('spy', 'syringe', victim);
  await D.until(() => !victim.alive, 8, `${victim.tag} injected`);
  await D.idle('spy', 5);
  await carryTo(D, 'spy', victim, body, via);
}
/**
 * The Spy stops e19 at one end of his beat, standing beyond him (he turns to her, his back to the way from the stop
 * S2 to the cemetery gate): west of x 49 she stands west of him, east of x 61 east of him.
 */
async function holdE19(D) {
  const sp = D.c('spy'), e19 = D.get('e19');
  let side = 0;
  for (let k = 0; k < 600 && e19.brain?.state !== 'DISTRACTED'; k++) {
    if (!side) side = e19.x < 49 ? -1 : e19.x > 61 ? 1 : 0;
    if (!side) { await D.wait(0.25); continue; }
    const lead = Math.sign(Math.cos(e19.heading)) === side ? 2.2 : 1.6; // ahead of him if he walks her way, else just behind
    D.order('spy', { type: 'move', x: e19.x + side * lead, z: e19.z + side * 0.55 });
    await D.wait(0.25);
    if (Math.hypot(e19.x - sp.x, e19.z - sp.z) < 2.6 && (sp.x - e19.x) * side > 0.6) { D.ability('spy', 'distract', e19); await D.wait(0.5); }
    if ((side < 0 && e19.x > 51) || (side > 0 && e19.x < 59)) side = 0;
  }
  await D.until(() => e19.brain?.state === 'DISTRACTED', 10, 'e19 distracted');
  await D.wait(1.5);
}

export const STAGES = [
  ['A', 'The burned-out house', async (D) => {
    const w = D.world, sp = D.c('spy'), e1 = D.get('e1');
    // the Sniper, the Driver and the Marine crawl a few steps back among the wrecks, where they will wait
    for (const [role, [x, z]] of Object.entries(START_SPOTS)) D.order(role, { type: 'move', x, z, run: false });
    await D.until(() => Object.entries(START_SPOTS).every(([role, [x, z]]) => Math.hypot(D.c(role).x - x, D.c(role).z - z) < 0.5), 30, 'the three among the wrecks');
    // e1 walks out of the ruin and along its north wall to the west end of his beat: the Spy crawls in through the gap
    await D.until(() => e1.x < 22 && e1.z < 125, 120, 'e1 off along the north wall');
    await crawl(D, 'spy', 29.5, 133.5, { box: 5 });
    // (into the gap and up against the inside of the east wall, where e1 will walk past her on the other side of it)
    await waitForSliced(D, function* (why) {
      return (yield* routeClearGen(D, [RUIN_GAP, RUIN_IN, E1_AMBUSH], { mode: 'crawl', from: [sp.x, sp.z], speed: 0.75, slack: 1, pad: 1.5, why }))
        && (yield* clearForGen(D, [E1_AMBUSH], 25, { mode: 'crawl', why }));
    }, 120, 'into the ruin unseen');
    await D.path('spy', [RUIN_GAP, RUIN_IN, E1_AMBUSH]);
    D.checkpoint('A1 the Spy waits in the burned-out house');
    // e1 comes back in through the gap and walks on to his halt in the south-east corner, his back to her: she gets up
    // behind the wall, follows him and injects him before he turns round
    await D.until(() => e1.z > 132.2 && e1.x < 24 && walking(e1) && !e1.brain?.atWait, 200, 'e1 past the gap');
    // (nobody outside sees through the gap: the Spy getting up, the blow, the body)
    await waitFor(D, (why) => unwitnessed(D, e1, standing(sp), { ahead: 3, why }), 2, 'e1 unwatched');
    await D.stance('spy', 'stand');
    D.ability('spy', 'syringe', e1);
    await D.until(() => !e1.alive, 8, 'e1 injected');
    await D.idle('spy', 5);
    D.checkpoint('A2 the Spy injects e1');
    await waitForSliced(D, function* (why) {
      return (yield* clearForGen(D, [[sp.x, sp.z], [14, 131], RUIN_NW], 14, { mode: 'walk', why })) && (yield* clearForGen(D, [[sp.x, sp.z], [14, 131], RUIN_NW], 14, { mode: 'body', why }));
    }, 200, 'carry e1 unseen');
    await carryTo(D, 'spy', e1, RUIN_NW, [[14, 131]]);
    await D.stance('spy', 'crawl');
    D.checkpoint('A3 e1 hidden in the north-west corner');
    // e2 paces the canal walk north of the house and turns back at its west end, a step from the house's north-east
    // corner: she waits inside by its north wall, slips out through the gap behind his back, injects him as he sets
    // off east again and carries him back into the house
    const e2 = D.get('e2');
    await crawl(D, 'spy', ...RUIN_WAIT, { box: 4 });
    await ambush(D, e2, { ready: (e) => Math.hypot(e.x - E2_WEST[0], e.z - E2_WEST[1]) < 2.5 && (e.brain?.atWait || Math.cos(e.heading) > 0.8), carry: RUIN_BODY2, via: RUIN_OUT, maxSec: 1500 });
    D.checkpoint('A4 e2 hidden in the burned-out house');
  }],
  ['B', 'The sentry box', async (D) => {
    // e5 paces the street's west end and turns back at the sentry box, looking south at it. While he walks off north,
    // his back to the street, she runs out of the house, round its north-east corner and along its north wall (a
    // German walking out of the town would be heard 10 m away: nobody is that near), and lies down behind the box
    const e5 = D.get('e5');
    await dash(D, 'spy', wayThrough(D, 'spy', RUIN_TO_BOX, { stance: 'stand' }), { mode: 'run', turns: ['e5'], maxSec: 900, slack: 0.6, pad: 0.5, label: 'the Spy runs to the sentry box' });
    await D.stance('spy', 'crawl');
    D.checkpoint('B1 the Spy behind the sentry box');
    // as he walks off north again, she gets up behind the box, follows him and injects him, and carries him back
    // behind it, where nobody looks
    await ambush(D, e5, { ready: (e) => walking(e) && !e.brain?.atWait && Math.sin(e.heading) < -0.8 && e.z > E5_SOUTH[1] - 3, carry: BOX_BODY, maxSec: 600 });
    D.checkpoint('B2 e5 hidden behind the sentry box');
  }],
  ['C', 'Down the canal', async (D) => {
    // the Marine crawls from the wrecks to the east stairs, puts on his diving gear in the shallows and swims under
    // water to the foot of the west stairs, where e4 comes down to the water's edge
    const m = D.c('diver'), e4 = D.get('e4');
    await crawl(D, 'diver', ...S2_FOOT, { box: 5, maxWait: 600 });
    await D.go('diver', ...S2_IN, { tol: 0.4, max: 20 });
    D.ability('diver', 'dive');
    await D.until(() => m.diving, 5, 'the Marine under water');
    await D.idle('diver', 3);
    await D.go('diver', ...S1_WATER, { tol: 0.5, max: 60 });
    D.checkpoint('C1 the Marine under water below the west stairs');
    // e4 turns back up the stairs: the Marine comes up behind him and spears him; he falls on the lower steps, below
    // the street (the canal is sunken: nobody up there sees a body lying on them)
    await spear(D, e4, { ready: (e) => !e.brain?.atWait && walking(e) && onLowerStairs(e.x, e.z - 0.3), hidden: onLowerStairs, maxSec: 400 });
    D.checkpoint('C2 the Marine spears e4 on the stairs');
  }],
  ['D', 'The west lawn', async (D) => {
    // the Spy crawls from behind the sentry box over the west bridge to the lawn behind the broken fence; e12 paces
    // the square's west end and looks up the west avenue from his halt by the fence: when he sets off east again she
    // slips out through the fence's gap behind his back, injects him and carries him back onto the lawn, into its
    // north-west corner, where nobody can see a body
    await crawlLeg(D, 'spy', [[0.6, 121.5], [2.5, 120.3]], { label: 'the Spy out from behind the box' }); // (round the post west of the box: the way east of it is too narrow for a man in the game's own nav)
    await crawl(D, 'spy', 13.5, 112, { box: 6, hold: 6, maxWait: 900 });
    await crawl(D, 'spy', 13.5, 92, { box: 5, hold: 6, maxWait: 900 });
    await crawl(D, 'spy', ...LAWN_NEAR, { box: 5, hold: 10, maxWait: 900 });
    D.checkpoint('D1 the Spy on the lawn behind the broken fence');
    const e12 = D.get('e12');
    // (as he walks up to his halt his back is to the gap too, and she reaches him there as he stops)
    await ambush(D, e12, { ready: (e) => (Math.hypot(e.x - E12_HALT[0], e.z - E12_HALT[1]) < 1.5 && e.brain?.atWait) || (e.x < 12 && Math.cos(e.heading) > 0.8 && !e.brain?.atWait)
      || (e.x < 10 && Math.cos(e.heading) < -0.8 && !e.brain?.atWait),
      carry: LAWN_BODIES[0], via: [FENCE_GAP], maxSec: 2500, hidden: lawnCorner });
    D.checkpoint('D2 e12 hidden on the lawn');
  }],
  ['E', 'A uniform on the balcony', async (D) => {
    // e13 paces the pavement under the balcony, from the foot of ladder L1 to the west avenue's corner: as he walks
    // back east, his back to the avenue, the Spy comes out through the fence's gap behind him, injects him and carries
    // him onto the lawn beside e12
    const sp = D.c('spy'), e13 = D.get('e13');
    await crawl(D, 'spy', ...LAWN_NEAR, { box: 4, hold: 6, maxWait: 600 });
    await ambush(D, e13, { ready: (e) => !e.brain?.atWait && Math.cos(e.heading) > 0.8 && e.x < 13, carry: LAWN_BODIES[1], via: [[3.5, 72], FENCE_GAP],
      maxSec: 1400, maxT: 22, hidden: lawnCorner });
    D.checkpoint('E1 e13 hidden on the lawn');
    await D.go('spy', ...LAWN_NEAR, { tol: 0.4, max: 20 }); // (off the crate's corner, back where she lay: nobody sees the lawn's inside)
    // along the block's south face (nobody walks it now) to a step short of ladder L1; when e14 on the balcony walks
    // away west and nobody else looks at the ladder, she climbs it and takes the uniform off the line behind e15
    await crawlLeg(D, 'spy', [FENCE_GAP, FACADE_WAIT], { maxSec: 1500, label: 'the Spy to the balcony\'s foot' });
    D.checkpoint('E2 the Spy under the balcony');
    await waitForSliced(D, function* (why) { return !(yield* climbSeenGen(D, why)); }, 1500, 'the climb unwatched');
    await D.stance('spy', 'crawl');
    await D.go('spy', ...CLIMB_START, { tol: 0.4 });
    await D.stance('spy', 'stand');
    await D.go('spy', ...L1_TOP, { tol: 0.5, max: 30 });
    D.ability('spy', 'use', D.item('uniform_rack'));
    await D.until(() => sp.disguised && !sp.currentAction, 20, 'the Spy in uniform');
    D.checkpoint('E3 the Spy in German uniform');
  }],
  ['F', 'The team crosses the town', async (D) => {
    // the Spy, in uniform, climbs down and strolls round the block to the garden street; she stops the patrol p17 there
    // for a chat (the five men stand and face her) while the others cross the town by the west avenue
    const sp = D.c('spy'), p17 = D.get('p17');
    await D.go('spy', ...L1_DOWN, { tol: 0.6, max: 40 });
    await D.path('spy', TO_GARDEN_ST);
    // (she steps into their way as they come down the street, and speaks to the sergeant as he reaches her)
    await D.until(() => p17.z > 46 && p17.z < 52 && p17.x > 35, 300, 'p17 coming down the garden street');
    await D.go('spy', ...P17_STOP, { tol: 1.3 });
    await D.until(() => Math.hypot(p17.x - sp.x, p17.z - sp.z) < 3.2, 30, 'p17 at the Spy');
    D.ability('spy', 'distract', p17);
    await D.until(() => p17.brain?.state === 'DISTRACTED', 10, 'p17 distracted');
    D.checkpoint('F1 the Spy stops patrol p17 in the garden street');
    await crossToNW(D, 'driver', NW_SLOTS.driver, { from: 'start' });
    D.checkpoint('F2 the Driver on the north-west road');
    await crossToNW(D, 'sniper', NW_SLOTS.sniper, { from: 'start' });
    D.checkpoint('F3 the Sniper on the north-west road');
    await marineToStart(D);
    await crossToNW(D, 'diver', NW_SLOTS.diver, { from: 'start' });
    D.checkpoint('F4 the Marine on the north-west road');
  }],
  ['G', 'The north street', async (D) => {
    // the Spy, in uniform, lets p17 go and walks round to the cemetery; e24 watches it from beside the chapel: she steps
    // up behind him and injects him when nobody would see it, and carries him behind the north row of tombs
    const sp = D.c('spy'), e24 = D.get('e24'), e20 = D.get('e20'), tram = tramOf(D);
    await D.path('spy', [[36.5, 48], [37.5, 41]]);
    await D.until(() => tramClearOf(tram, 41, 12), 200, 'the tram clear of the crossing');
    await D.path('spy', TO_CEMETERY);
    await D.go('spy', ...E24_BEHIND, { tol: 0.4 });
    await waitForSliced(D, function* (why) {
      if (!unwitnessed(D, e24, sp, { ahead: 1.0, why })) return false;
      const way = timed([e24.x, e24.z], [...E24_VIA, E24_BODY], 1.5, 2.9); // (needle, fall, lift: off ~2.9 s on)
      return !(yield* standSeenGen(D, [[sp.x, sp.z, 0, 0], [sp.x, sp.z, 0, 1.5], ...way, [...E24_BODY, 0, way.at(-1)[3] + 1]], { slack: 0.8, why, except: [e24] }));
    }, 900, 'e24 unwatched');
    await inject(D, e24, E24_BODY, E24_VIA);
    D.checkpoint('G1 the Spy injects e24 by the chapel; his body behind the tombs');
    // e20 paces the townhouse front and looks up the street from his west halt by the north-west road: the Spy waits
    // a step behind that halt (in uniform nobody minds her), injects him there and carries him into the north-west road
    await D.path('spy', FROM_CEMETERY_W);
    await D.go('spy', ...E20_BEHIND, { tol: 0.4 });
    await waitForSliced(D, function* (why) {
      const b = e20.brain;
      if (!(b?.atWait && b.waitT > 2.2 && Math.hypot(e20.x - E20_HALT[0], e20.z - E20_HALT[1]) < 0.6)) { why.push('e20 not at his halt'); return false; }
      const way = timed([e20.x, e20.z], [...E20_VIA, E20_BODY], 1.5, 2.9);
      if (yield* standSeenGen(D, [...way, [...E20_BODY, 0, way.at(-1)[3] + 1]], { slack: 0.8, why, except: [e20] })) return false;
      if ((yield* bodySeenGen(D, e20.x, e20.z, 3.5, { except: [e20] })).length) { why.push('body seen'); return false; }
      return unwitnessed(D, e20, { x: e20.x + 1, z: e20.z + 0.25, y: 0, isVisibleToEnemies: true, alive: true, kind: 'commando' }, { ahead: 1.2, why, except: [e20] });
    }, 1500, 'e20 at his halt, unwatched');
    await inject(D, e20, E20_BODY, E20_VIA);
    D.checkpoint('G2 the Spy injects e20 at the end of the street; his body in the north-west road');
  }],
  ['H', 'The van', async (D) => {
    const sp = D.c('spy'), dr = D.c('driver'), p22 = D.get('p22'), e19 = D.get('e19'), tram = tramOf(D), van = vanOf(D);
    // the Spy goes back into the cemetery towards the patrol's far corner; the Driver crawls down the north-west road
    // to the tram's west terminus and climbs into the tram while it stands there (nobody sees into it)
    await crawlLeg(D, 'driver', TO_TERMINUS);
    await waitFor(D, (why) => (tramAt(tram, 'W') && tram.waitT > 1.5 ? boardClear(D, 'driver', tram, 1.6, why) : (why.push('tram'), false)), 600, 'boarding the tram unwatched');
    await D.stance('driver', 'stand');
    D.ability('driver', 'enterVehicle', tram);
    await D.until(() => dr.vehicle === tram, 10, 'the Driver in the tram');
    D.checkpoint('H1 the Driver rides the tram');
    // the cemetery patrol (3 men) takes as long over its round as the tram over its run: the Spy stops it at its
    // south-east corner and lets it go as the west-bound tram stops at S2; from then on it is at that far corner each
    // time the west-bound tram stops there
    await D.path('spy', TO_P22_CORNER);
    await D.until(() => Math.hypot(p22.x - P22_CORNER[0], p22.z - P22_CORNER[1]) < 0.8, 200, 'p22 at its corner');
    D.ability('spy', 'distract', p22);
    await D.until(() => p22.brain?.state === 'DISTRACTED', 10, 'p22 distracted');
    D.checkpoint('H2 the Spy stops the cemetery patrol at its far corner');
    await D.until(() => tramAt(tram, 'S2W') && tram.waitT > 11, 200, 'the tram at S2 west-bound');
    // she lets it go and stops e19, who paces the pavement in front of the cemetery gate, at one end of his beat,
    // looking away from it
    await D.path('spy', TO_E19);
    await holdE19(D);
    D.checkpoint('H3 the Spy stops e19 at the end of his beat');
    // the Driver gets off at S2 (the west-bound tram lets him out on the north side), crawls through the gate to the
    // van and climbs in when nobody would see him stand at its door
    const bp = boardPoint(van, dr), way = [...S2_TO_GATE, [bp.x, bp.z]];
    await waitForSliced(D, function* (why) {
      if (!(tramAt(tram, 'S2W') && tram.waitT > 2)) { why.push('tram not at S2 west-bound'); return false; }
      const ex = tramExit(tram);
      if (!(yield* clearForGen(D, [ex], 1.5, { mode: 'walk', why }))) return false;
      for (const speed of [0.7, 0.8, 0.9]) if (!(yield* routeClearGen(D, way, { mode: 'crawl', from: ex, speed, delay: 0.8, slack: 1, pad: 1, why }))) return false;
      return true;
    }, 1500, 'S2: the way to the van clear');
    D.order('driver', { type: 'exit' });
    await D.until(() => !dr.vehicle, 5, 'the Driver off the tram');
    await D.stance('driver', 'crawl');
    for (const p of way) await D.go('driver', ...p, { tol: 0.6, max: 60 });
    await waitFor(D, (why) => boardClear(D, 'driver', van, 2.6, why), 300, 'getting into the van unwatched');
    await D.stance('driver', 'stand');
    D.ability('driver', 'enterVehicle', van);
    await D.until(() => dr.vehicle === van, 15, 'the Driver in the van');
    D.checkpoint('H4 the Driver gets off the tram at S2 and into the van');
    // the Spy lets e19 go; the Driver drives the van (nobody saw him get in: it is just a van) out of the cemetery and
    // up the north-west road, where the Sniper and the Marine get in
    D.order('spy', { type: 'move', x: SPY_WEST[0], z: SPY_WEST[1] });
    await waitFor(D, (why) => {
      const t = inFrontBox(D, [...VAN_GATE, ...VAN_TO_NW], [van.x, van.z], 3) || nearWay(D, [...VAN_GATE, ...VAN_TO_NW], [van.x, van.z], 3);
      if (t) { why.push(`${t} ahead`); return false; }
      return tram.x < 14 || tram.x > 45;
    }, 300, 'the van\'s way clear');
    for (const p of VAN_GATE) await drive(D, van, ...p);
    for (const p of VAN_TO_NW) await drive(D, van, ...p);
    for (const role of ['diver', 'sniper']) {
      const u = D.c(role), b = boardPoint(van, u), L = Math.hypot(b.x - u.x, b.z - u.z) * 1.4 + 1;
      await waitFor(D, (why) => clearFor(D, [[u.x, u.z], [b.x, b.z]], L / 0.7 + 3, { mode: 'crawl', why })
        && !standSeen(D, [[b.x, b.z, 0, L / 0.9], [b.x, b.z, 0, L / 0.7 + 2]], { slack: 1.2, why }), 300, `${role} to the van unwatched`);
      await board(D, role, van);
    }
    D.checkpoint('H5 the van on the north-west road: the Marine and the Sniper get in');
  }],
  ['I', 'The fuel tanker', async (D) => {
    const sp = D.c('spy'), dr = D.c('driver'), e21 = D.get('e21'), tram = tramOf(D), van = vanOf(D), tk = tankerOf(D);
    // the Spy stops e21 at the fuel lot's corner from the east: he faces away from the townhouse front
    await D.go('spy', ...E21_TALK, { tol: 0.4 });
    D.ability('spy', 'distract', e21);
    await D.until(() => e21.brain?.state === 'DISTRACTED', 10, 'e21 distracted');
    await D.wait(1.5);
    D.checkpoint('I1 the Spy stops e21 at the fuel lot');
    // the Driver gets out of the van (nobody looks into the north-west road), crawls along the townhouse front behind
    // e21 into the lot and climbs into the tanker
    await waitFor(D, (why) => clearFor(D, [[van.x - 2, van.z]], 2, { mode: 'walk', why }), 300, 'out of the van unwatched');
    D.order('driver', { type: 'exit' });
    await D.until(() => !dr.vehicle, 5, 'the Driver out of the van');
    await D.stance('driver', 'crawl');
    // (in one go, on his belly, to the cab door — round the lorry's front: its west side is too narrow — and he lies
    // there unseen a while, until nobody would see him stand up and climb in)
    const tb = boardPoint(tk, dr);
    // (the cemetery patrol's men, stepping up beside their sergeant at his halt by the gate, look every way: none of
    // them within 17 m of him)
    await crawlLeg(D, 'driver', [...TO_LOT, [tb.x, tb.z]], { hold: 12, maxSec: 1500, keepWalker: 17 });
    await waitFor(D, (why) => boardClear(D, 'driver', tk, 2.6, why), 600, 'the tanker unwatched');
    await D.stance('driver', 'stand');
    await board(D, 'driver', tk);
    D.checkpoint('I2 the Driver crawls into the fuel lot and climbs into the tanker');
    // out of the lot and east along the tram street to the north pavement east of the tram stop S2, out of the
    // tram's way, once nobody will walk into the lorry's way (a man stepping aside knows it for ours)
    await waitFor(D, (why) => {
      for (const s of [2.2, 3.2]) { const t = inFrontBox(D, TANKER_OUT, [tk.x, tk.z], s); if (t) { why.push(`${t} ahead`); return false; } }
      // (it slows at every corner of the way: nobody within a few metres of it at a slower pace either)
      for (const s of [1.6, 2.4]) { const t = nearWay(D, TANKER_OUT, [tk.x, tk.z], s, 4.5); if (t) { why.push(`${t} near`); return false; } }
      return tram.x < 20 || (tram.x > 60 && tram.speed === 0);
    }, 900, 'the way out of the lot clear');
    for (const p of TANKER_OUT) await drive(D, tk, ...p);
    await D.until(() => (tk.speed || 0) < 0.05, 10, 'the tanker parked');
    D.checkpoint('I3 the tanker waits on the north pavement');
    // as the tram stands at the line's east end, a few metres from the corner of the HQ's service range: the tanker runs in beside
    // its rear on the rails' south side, the Driver jumps out and climbs into the tram (it hides him from the yard);
    // when it sets off west it smashes into the tanker: an "accident" that takes the HQ with it and raises no alarm
    await waitFor(D, (why) => {
      if (!(tramAt(tram, 'E') && tram.waitT > 8.8)) { why.push('tram not at the east end'); return false; }
      const t = inFrontBox(D, [TANKER_PARK], [tk.x, tk.z], 6); if (t) { why.push(`${t} ahead`); return false; }
      // (e19 walking east faces the spot: only when he walks west or is well away)
      const e19 = D.get('e19');
      for (let s = 0; s <= 8; s += 0.5) { const q = predict(e19, s); if (Math.hypot(q.x - DROP_EXIT[0], q.z - DROP_EXIT[1]) < 22 && Math.cos(q.heading) > -0.2) { why.push('e19 facing'); return false; } }
      return !standSeen(D, [[...DROP_EXIT, 0, 2.5], [...DROP_EXIT, 0, 3.5], [70.8, 44.3, 0, 4.5]], { slack: 2.0, why });
    }, 1500, 'the east end: the drop unwatched', 0.2, { keep: 7 }); // (the tram stands there 8.8 s more: it hides the drop)
    D.order('driver', { type: 'move', x: TANKER_PARK[0], z: TANKER_PARK[1], run: true });
    await D.until(() => Math.hypot(tk.x - TANKER_PARK[0], tk.z - TANKER_PARK[1]) < 1.3 || (!tk.goal && (tk.speed || 0) < 0.05), 8, 'the tanker at the rails');
    await D.until(() => (tk.speed || 0) < 0.05, 4, 'the tanker stopped');
    D.order('driver', { type: 'exit' });
    await D.until(() => !dr.vehicle, 3, 'the Driver out of the tanker');
    D.ability('driver', 'enterVehicle', tram);
    await D.until(() => dr.vehicle === tram, 6, 'the Driver in the tram');
    D.checkpoint('I4 the tanker on the rails behind the tram, the Driver in the tram');
    await D.until(() => tk.destroyed, 30, 'the tram hits the tanker');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 5, 'the HQ destroyed');
    D.checkpoint('I5 the tram hits the tanker: the HQ goes up, an accident');
  }],
  ['J', 'The end of the Butcher', async (D) => {
    const sp = D.c('spy'), dr = D.c('driver'), sn = D.c('sniper'), gen = D.get('schleper'), tram = tramOf(D), van = vanOf(D);
    // the Driver rides on to the west terminus, gets off on the north side and crawls back to the van
    await waitFor(D, (why) => {
      if (!(tramAt(tram, 'W') && tram.waitT > 2)) { why.push('tram not at the west end'); return false; }
      const ex = tramExit(tram);
      return clearFor(D, [ex], 1.5, { mode: 'walk', why }) && [0.7, 0.8, 0.9].every((speed) => routeClear(D, TERMINUS_TO_NW, { mode: 'crawl', from: ex, speed, delay: 0.8, slack: 1, pad: 1, why }));
    }, 900, 'the west end: off unwatched');
    D.order('driver', { type: 'exit' });
    await D.until(() => !dr.vehicle, 3, 'the Driver off the tram');
    await D.stance('driver', 'crawl');
    const vb = boardPoint(van, dr);
    await crawlLeg(D, 'driver', [TERMINUS_TO_NW[0], [vb.x, vb.z]], { hold: 8 });
    await waitFor(D, (why) => boardClear(D, 'driver', van, 2.6, why), 300, 'getting into the van unwatched');
    D.ability('driver', 'enterVehicle', van);
    await D.until(() => dr.vehicle === van, 20, 'the Driver in the van');
    D.checkpoint('J1 the Driver back in the van');
    // the van stops on the tram street by the townhouse; when the general walks out to the corner of his garden the
    // Sniper slips out, crawls a few metres to where he sees him, kneels and fires once (the rifle makes no sound)
    await waitFor(D, (why) => { const t = inFrontBox(D, VAN_TO_SHOT, [van.x, van.z], 3); if (t) { why.push(`${t} ahead`); return false; } return tram.x > 16; }, 300, 'the van\'s way clear');
    for (const p of VAN_TO_SHOT) await drive(D, van, ...p);
    await D.until(() => (van.speed || 0) < 0.05, 5, 'the van stopped');
    D.checkpoint('J2 the van stops on the tram street');
    const los = () => { const c = ghost(sn); c.x = SHOT_SPOT[0]; c.z = SHOT_SPOT[1]; c.y = 0; c.kneeling = true; return shotSight(D.world, c, gen, true); };
    const atPause = (left) => Math.hypot(gen.x - GENERAL_PAUSE.x, gen.z - GENERAL_PAUSE.z) < 0.8 && gen.brain?.atWait && gen.brain.waitT > left;
    await waitFor(D, (why) => (atPause(11) ? (los() ? clearFor(D, [[van.x, van.z], SHOT_SPOT], 10, { mode: 'crawl', why }) : (why.push('no line'), false)) : (why.push('the general not at his pause'), false)), 1500, 'the general at his pause');
    D.order('sniper', { type: 'exit' });
    await D.until(() => !sn.vehicle, 3, 'the Sniper out');
    await D.stance('sniper', 'crawl');
    await D.go('sniper', ...SHOT_SPOT, { tol: 0.4, max: 20 });
    // (the tram must not run across the line of fire meanwhile: it crosses the rails at x 43)
    // (and the way back is decided with the shot: nobody may see him kneel there, get up, walk to the van's door and
    // climb in — a man seen getting in marks the van for every gun in the street — and as the guards find the body
    // within seconds and heads turn, no one walking may be within 12 m of the van meanwhile, whichever way he looks)
    for (let k = 0; k < 4 && gen.alive; k++) {
      await waitFor(D, (why) => {
        if (!atPause(1.5)) { why.push('the general not at his pause'); return false; }
        if (!los() || !tramClearOf(tram, SHOT_RAILS_X, 3, 9)) { why.push('no line'); return false; }
        const vb = boardPoint(van, sn), L = Math.hypot(vb.x - sn.x, vb.z - sn.z), t1 = 2.1 + L / 1.0;
        const back = [[...SHOT_SPOT, 0, 0], [...SHOT_SPOT, 0, 0.7], [...SHOT_SPOT, 0, 1.4], [...SHOT_SPOT, 0, 2.1],
          ...timed(SHOT_SPOT, [[vb.x, vb.z]], 1.0, 2.1), [vb.x, vb.z, 0, t1 + 1.2], [vb.x, vb.z, 0, t1 + 2.5]];
        if (standSeen(D, back, { slack: 0.6, why })) return false;
        return !patrolNear(D, [SHOT_SPOT, [vb.x, vb.z]], 12, t1 + 3, why);
      }, 1500, 'the shot');
      D.ability('sniper', 'sniper', gen);
      try { await D.until(() => !gen.alive, 3, 'the general shot'); } catch (err) { D.log(`WARN the shot failed (${err.message}): again`); }
    }
    if (gen.alive) throw new Error('the general still alive');
    D.checkpoint('J3 the Sniper shoots the Butcher at the corner of his garden');
    D.ability('sniper', 'enterVehicle', van);
    await D.until(() => sn.vehicle === van, 10, 'the Sniper back in the van');
    // the Spy leaves e21 and climbs in (an officer getting into a van); with everyone aboard it drives off up the
    // north-west road
    D.ability('spy', 'enterVehicle', van);
    await D.until(() => sp.vehicle === van, 30, 'the Spy in the van');
    D.checkpoint('J4 everyone in the van');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o3')?.done, 120, 'out by the north-west road');
    D.checkpoint('J5 the van leaves Compiègne by the north-west road');
  }],
];

export async function solve(D, ctx = {}) {
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  // (the planners see the armoured car's commander, and a patrol's file men walking their leader's way round corners)
  D.world.sneakVehicleEyes = true; D.world.sneakTrail = true; D.world.sneakPaths = true; D.world.sneakSweepSteps = 6; D.world.sneakReturnOn = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    await ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
/** (development: the helpers, for probes) */
export const __dev = { TO_LOT, RUIN_WAIT, W1_CORNER, LAWN_WAIT, AVENUE_TOP, FENCE_GAP, P17_STOP, L1_DOWN, TO_GARDEN_ST, marineToStart, crawlLeg, wayThrough, crossToNW, NW_SLOTS, heardRunning, crawl, dash, ambush, moveBody, spear, standSeen, timed, carryTo, waitFor, climbSeen, inFrontBox, tramClearOf, board };
