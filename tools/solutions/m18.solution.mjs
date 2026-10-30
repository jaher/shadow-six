/**
 * M18 "The Force of Circumstance" (the Maas bridge again, December 1944), played only with player orders. Driver API:
 * tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real game:
 * node tools/solutions/run-browser.mjs m18 (also tests/m18-solution.test.mjs). Walkthrough: m18.walkthrough.mjs.
 *
 * The whole map is one siren zone and every explosion sounds it (alarm.js: a blast trips z_all's onHeard, wherever it
 * goes off), so the bridge can only come down with one alarm: the plan makes it the last thing that happens.
 *   A  the Marine and the Sapper crawl off the start, behind the field walls, to the SE corner of the map;
 *   B  while they wait there for their moment, the Green Beret and then the Driver follow them down to the corner; two
 *      by two W along the S edge (nobody's beat reaches the last metre of the fields but at moments, the armoured car's
 *      eye only as it turns at its SW stop: watched by its observed rounds) to the lorry by the S road, east of the
 *      railway: each pair edges W along the never-seen part of the corner first, then one straight crawl, the second
 *      once the first is well on its way;
 *   C  the Marine crosses the line, slips into the river at the SE corner of the beach and dives: under the bridge to
 *      the N island, where the boat lies at the sentry e20's feet; while he waits there for his moment, the Green Beret
 *      and the Driver climb into the lorry (inside it nobody sees them);
 *   D  in a quiet moment (every ~3.5 min: the island's men keep coming by the boat) the Marine surfaces E of e20
 *      (outside his sight), harpoons him, packs the boat and dives again (the island's cries reach nobody on the
 *      banks); back south;
 *   E  the island's MG gunner e54 and its walker e57 harpooned from the water (the MG covers every shore a boat could
 *      land on); the Sapper crawls to the beach corner as Patrol 46 turns north; the Marine climbs out, inflates the
 *      boat and rows him across the open water to the S shore of the bridge island, packs it and waits under water;
 *      the Sapper takes the three German charges from the case; the boat comes back for him (the Marine's launch stand
 *      checked), waits in open water out of every reach and dashes in to the corner as the patrol turns north again;
 *   F  the Sapper (by the cab's right door) and the Marine climb into the lorry, and the Driver takes it up the road,
 *      round over the grass and down to the end of the deck, nose S: to the Germans a lorry of their own (nobody minds
 *      it, so long as nobody on foot has to step out of its way: vehicle.js _stepAside); the Sapper slips out on the
 *      deck side, the hull between him and the bridgehead, crawls onto the deck (nobody below sees a man lying up
 *      there): a charge on C, B and A, and back into the lorry by the same door;
 *   G  the lorry back to its place by the S road; at its door, S of the hull where nobody looks, the Sapper sets off
 *      the three charges (the span falls, the siren sounds) and climbs in: everyone aboard, the lorry leaves.
 * Nobody ever sees a commando or the boat (exposure watch). Three kills, all on the islands (e20, e54, e57: their
 * bodies lie where the cries reach nobody); the only alarm is the bridge going up.
 */
import { clearFor, routeClear, routeClearGen, unwitnessed, predict, dummyAt, walkerSees, wheeling, walking, staticSees } from './sneak.mjs';
import { boardPoint } from '../../src/abilities/drive.js';
import { launchStand } from '../../src/abilities/marine.js';

const DBG = !!(globalThis.process?.env?.M18DBG || globalThis.__M18DBG || globalThis.__M3DBG);
if (globalThis.process?.env?.M18RAFTDBG) globalThis.__M3DBG = true; // (the driver's raft planner says why it waits)
let dbgN = 0;
/** (debug) why a wait goes on, now and then; always false */
function dbg(D, why, label) { if (DBG && dbgN++ % (globalThis.__M18DBGN || 100) === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.slice(0, 3).join(' ')}]`); return false; }

/** a check generator run straight through */
function runGen(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }
/**
 * Wait (up to maxSec) until `fn(why)` holds: a generator that yields between the pieces of a long look-ahead (a few
 * guards at a time). In the live replay the driver slices it across frames (D.runSliced), the game clock standing still
 * meanwhile, so no check holds a frame up; headless it runs straight through — the same answer, tick for tick. Looked
 * at every `every` ticks (the cones do not change faster than that).
 */
async function waitFor(D, fn, maxSec, label, every = 5) {
  const why = [];
  let k = 0;
  await D.untilAsync(async () => {
    if (k++ % every) return false;
    why.length = 0;
    const it = fn(why);
    return D.runSliced ? D.runSliced(it) : runGen(it);
  }, maxSec, label).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
}

// ---------------------------------------------------------------- places
/** the SE corner of the fields, where the four wait for the long crawl (behind the field walls, out of every beat) */
const STAGING = { diver: [184, 149.5], sapper: [185.5, 149.5], greenberet: [187, 149.3], driver: [188.5, 149.3] };
/** When (s into stage B) the Green Beret and the Driver follow the first pair down to the corner (each a minute or two
 *  of the first pair's wait for its moment: something to watch meanwhile) — at once if the first pair sets off before. */
const JOIN_GB = 80, JOIN_DRIVER = 240;
/** When (s into stage B) each pair edges W along the last metre of the fields to EDGE (+ its file offset): x 174–188 of
 *  it is in nobody's sight (coverage, page and headless), and the dash from there is 8 m shorter. */
const CREEP_AT = [160, 320], EDGE = 176;
/** the S edge W of the fields: the lorry's lee, 5 m+ E of the railway (x 82–88 of the last metre is in nobody's sight) */
const LEE = { diver: [83, 148.6], sapper: [84.5, 148.6], greenberet: [86, 148.6], driver: [87.5, 148.6] };
/** where the line crosses the S edge (the train runs NE → SW, every couple of minutes; it kills anyone on the rails) */
const RAIL_S = [74.5, 148.5];
/** the beach's SE corner by the S edge: the boat goes in here (Patrol 46 halts 8 m N of it, looking W, every ~67 s) */
const CORNER = { diver: [59.6, 148.7], sapper: [61.2, 148.8] };
/** where the Sapper lies for the launch: 18 m+ from Patrol 46's S end (62,140), so its about-turn there is no danger,
 *  and 5 m+ off the railway (the train's kill box reaches 3.4 m either side of the line) */
const CORNER_WAIT = [82, 148.8];
/** the shallows by the corner where the Marine goes into the river and dives */
const CORNER_WET = [57.4, 148.3];
/** e20's boat: the Marine waits under water E of the sentry, outside his sight, within harpoon range */
const E20_SHOT = [104, 32.2];
/** the island MG nest's blind side: the shallows NW of it, under the deck's S girder (the gun looks SE over the E channel) */
const MG_SHOT = [43.5, 84.5];
/** the water off the island's W shore, behind its walker e57 as he sets off E from the W end of his beat */
const E57_SHOT = [39, 94.5];
/** the S shore of the bridge island W of the dressing boat (nobody's sight), and the water off it */
const ISLE_LAND = [44, 102.8], ISLE_RAFT = [44, 105.5];
/** the boat's way from the corner: W off the beach, then N up the open water W of the sentry e43's reach, to a spot
 *  out of the island walker's sight (he looks S over the water from the E end of his beat), then in to the island */
const RAFT_OUT = [[40, 146], [36, 128]], RAFT_IN = [[42, 112], [44, 105.5]];
/** open water SW of the island out of every reach (the beach's S end 40 m+ off, the W armoured car's turn 60 m): where
 *  the boat waits on its way back */
const RAFT_OFF = [[32, 112], [22, 130]];
/** where the boat comes back in to the corner (the shallows by the S edge, the Sapper steps off onto the beach) */
const CORNER_LAND = [57.4, 147.6];
/** where the boat comes out from the corner (the launch puts it about there) */
const RAFT_LAUNCH = [58.3, 146.6];
/** the case of charges (the pickup lies just S of the case), and the Sapper's way to it from the island's S shore: E of
 *  the beached boat and N past the MG nest's sandbags */
const CASE = [50.6, 90.6], CASE_WAY = [[47.3, 102.3], [50.8, 94.8]];
/** the lorry's lee, where the Sapper lies before he climbs in (the last metre of the field, 5 m+ off the railway) */
const LEE_SAPPER = [86, 148.6];
/** the bridge's E end: the deck just in from the road (the Sapper crawls on from here along it) */
const DECK_IN = [88.5, 104.6];
/** on the deck W of its E end, where nobody below sees a man lying (he waits there for the way back) */
const DECK_WAIT = [80.5, 100.8];
/** where the Sapper lies to set each charge (it goes down 0.4 m in front of him, on the marked point: A, B, C) */
const PLANT = { C: [77.7, 99.6], B: [63.9, 88.8], A: [51.9, 78.8] };

// ---------------------------------------------------------------- the railway
/**
 * M16's railFree: will the train stay clear of the stretch of line round `at` for the next `sec` s (its 30 m hull and
 * kill box either side of its centre, as its timetable goes: it runs in at the NE end, stops 12 s at the station, runs
 * on SW)? Without a point: is it out of sight (gone) for at least `sec` more seconds?
 */
function railFree(D, sec, at = null) {
  const t = D.world.vehicles.find((v) => v.vehicleType === 'train' && !v.removed);
  if (!t) return true;
  if (!at) return !t.railRunning && (t.railT ?? 0) > sec;
  let s = 0, best = Infinity, sAt = 0;
  for (let k = 1; k < t.track.length; k++) {
    const a = t.track[k - 1], b = t.track[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    const u = Math.max(0, Math.min(1, ((at[0] - a.x) * (b.x - a.x) + (at[1] - a.z) * (b.z - a.z)) / (L * L)));
    const d = Math.hypot(a.x + (b.x - a.x) * u - at[0], a.z + (b.z - a.z) * u - at[1]);
    if (d < best) { best = d; sAt = s + u * L; }
    s += L;
  }
  const v = t.schedule?.speed || 9, reach = 22;
  const stopAt = t.trackStops?.[0];
  const eta = (from) => {
    if (from > sAt + reach) return Infinity;
    let d = Math.max(0, sAt - reach - from), tt = d / v;
    if (stopAt && from < stopAt.s && stopAt.s < sAt) tt += stopAt.wait;
    return tt;
  };
  if (!t.railRunning) return (t.railT ?? 0) + eta(0) > sec;
  const left = eta(t.railS ?? 0) - (t.waitT > 0 ? -t.waitT : 0);
  if (left === Infinity) return (t.railT ?? 0) >= 0 && (t.schedule?.period ?? 60) + eta(0) > sec;
  return left > sec;
}

/** How far ahead (s) the train's timetable is worked out. */
const TRAIN_AHEAD = 240;
/**
 * The train's place on its track (arc length, m; NaN while it is off the map) for every tick of the next TRAIN_AHEAD
 * s, as its timetable goes (vehicle.js _updateRail: hidden `period` s between runs, at `speed` along the track, the
 * station stop): worked out once per tick.
 */
function trainLine(D) {
  const w = D.world, t = w.vehicles.find((v) => v.vehicleType === 'train' && !v.removed);
  if (!t?.track || t.track.length < 2) return null;
  const memo = (w._m18TrainLine ||= { t: -1, s: null });
  if (memo.t === w.time) return memo;
  const S = t.schedule, dt = D.dt, n = Math.ceil(TRAIN_AHEAD / dt), out = memo.s?.length === n + 1 ? memo.s : new Float32Array(n + 1);
  let run = !!t.railRunning, s = t.railS ?? 0, wait = t.waitT ?? 0, rt = t.railT ?? 0;
  out[0] = run ? s : NaN;
  for (let k = 1; k <= n; k++) {
    if (!run) { rt -= dt; if (rt > 0) { out[k] = NaN; continue; } run = true; s = 0; }
    if (wait > 0) { wait -= dt; out[k] = s; continue; }
    const prev = s;
    s += S.speed * dt;
    for (const p of t.trackStops) if ((prev - p.s) * (s - p.s) < 0 || s === p.s) { s = p.s; wait = p.wait; break; }
    if (s >= t.trackLen) { run = false; rt = S.period; out[k] = NaN; continue; }
    out[k] = s;
  }
  memo.t = w.time; memo.s = out; memo.train = t;
  return memo;
}
/** Where (x, z) lies along the train's track: its arc length and its distance off the line. */
function railProj(t, x, z) {
  let s = 0, best = { s: 0, d: Infinity };
  for (let k = 1; k < t.track.length; k++) {
    const a = t.track[k - 1], b = t.track[k], L = t.segLen[k - 1];
    const u = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (L * L)));
    const d = Math.hypot(a.x + (b.x - a.x) * u - x, a.z + (b.z - a.z) * u - z);
    if (d < best.d) best = { s: s + u * L, d };
    s += L;
  }
  return best;
}
/**
 * Will the train's kill box miss a man going along `track` ([[x, z, t], …], t s from now)? Its box reaches 31.5 m behind
 * its centre and 16 m ahead, 3.4 m either side (CONFIG.vehicles.train.box) — and a crawler's legs: a sample within 5 m
 * of the line is clear only while the train's centre keeps 34 m behind it and 19 m ahead, ± 1.5 s.
 */
function trainMisses(D, track, { across = 5, grow = 0 } = {}) {
  const L = trainLine(D);
  if (!L) return true;
  const n = L.s.length - 1, dt = D.dt;
  for (const [x, z, t] of track) {
    const p = railProj(L.train, x, z);
    if (p.d > across) continue;
    const k0 = Math.max(0, Math.floor((t - 1.5) / dt)), k1 = Math.ceil((t + 1.5) / dt);
    if (k1 > n) return false; // (beyond the timetable worked out: no telling)
    // (`grow`: a hull's half length on top, the lorry's)
    for (let k = k0; k <= k1; k++) { const st = L.s[k]; if (st === st && p.s - st >= -34 - grow && p.s - st <= 19 + grow) return false; }
  }
  return true;
}
/** The samples (every `step` m) of a man going from `from` along `pts` at `v` m/s, setting off in `delay` s: [[x, z, t], …], then `hold` s at the end. */
function trackOf(from, pts, v, delay = 0, { step = 0.5, hold = 0 } = {}) {
  let [x, z] = from, t = delay;
  const out = [[x, z, t]];
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / v]);
    t += L / v; x = px; z = pz;
  }
  for (let h = 0.5; h <= hold + 1e-6; h += 0.5) out.push([x, z, t + h]);
  return out;
}

// ---------------------------------------------------------------- crawling
/** seconds to crawl from (x, z) along `pts` at `v` m/s (+ `t0`) */
function legTime(x, z, pts, v, t0 = 0) {
  let t = t0;
  for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / v; x = px; z = pz; }
  return t;
}

/**
 * Crawl (or walk) along `pts` (straight runs, one after the other) once nobody would see him anywhere on the way, as
 * the cones are predicted while he passes (routeClear, at a slow and a quick crawl), nor at its end for `hold` s (as a
 * standing man when `standAtEnd`: he gets up there next); `rail`: the way crosses the railway there (the train must be
 * well away until he is over); `ready`: a further condition of the moment.
 */
async function crawlHop(D, role, pts, { hold = 6, pad = 0.6, slack = 0.6, maxWait = 400, label = 'crawl', mode = 'crawl', ready = null, standAtEnd = false, endPts = null, rail = false, speeds: sp = null, onGo = null, car = false, carBand = SD_NEAR } = {}) {
  const u = D.c(role), end = pts[pts.length - 1];
  const walk = mode === 'walk', md = walk ? 'walk' : 'crawl', speeds = sp ?? (walk ? [2.25] : [0.75, 1.0]);
  await waitFor(D, function* (why) {
    if (ready) { const r = ready(why); if (!(r && typeof r.next === 'function' ? yield* r : r)) return dbg(D, ['not ready'], label); }
    const from = [u.x, u.z];
    const t = legTime(u.x, u.z, pts, Math.min(...speeds), 0.2), t1 = legTime(u.x, u.z, pts, Math.max(...speeds), 0.2);
    const tracks = speeds.map((v) => trackOf(from, pts, v, 0.2, { hold: hold + t - legTime(u.x, u.z, pts, v, 0.2) }));
    // (the train's kill box clear of him wherever his way runs by the line, as its timetable goes: `rail` names a
    // way that crosses it, but any way near it is looked at)
    if (!tracks.every((tr) => trainMisses(D, tr))) return dbg(D, ['the train'], label);
    // (the armoured car away from its SW stop while he is within its near band of it)
    if (car) {
      const nc = timesNear(u.x, u.z, pts, Math.max(...speeds), SD_TURN, carBand, 0.2), nc2 = timesNear(u.x, u.z, pts, Math.min(...speeds), SD_TURN, carBand, 0.2);
      if (nc && !carGone(D, nc[0], nc2[1] + (standAtEnd ? hold : 0))) return dbg(D, ['the armoured car'], label);
    }
    for (const v of speeds) if (!(yield* fileClearG(D, pts, { mode: md, from, speed: v, delay: 0.2, slack, why, pad }))) return dbg(D, why, label);
    // (lying there from the soonest he may arrive, and `hold` s after the latest — as a man on his feet then when he gets
    // up there next)
    for (const q of endPts ?? [end]) {
      if (!(yield* fileClearG(D, [q], { mode: md, from: q, delay: t1, hold: hold + t - t1, slack: 0.3, why, pad }))) return dbg(D, why, label);
      if (standAtEnd && !(yield* fileClearG(D, [q], { mode: 'walk', from: q, delay: t, hold, slack: 0.3, why, pad }))) return dbg(D, why, label);
    }
    return true;
  }, maxWait, `${label} clear`);
  await D.stance(role, walk ? 'stand' : 'crawl');
  if (onGo) { D.order(role, { type: 'move', x: pts[0][0], z: pts[0][1] }); onGo(); }
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.5, max: 200 });
}

/**
 * The men in `goal` ({role: [x, z]}) crawl there together, each straight from where he lies (and on along the
 * points of `via` first, the same for all), once nobody would see any of them on the way or at the end for `hold` s.
 */
async function crawlFile(D, goal, { via = [], hold = 6, pad = 0.6, slack = 0.6, slackRate = 0, speeds = [0.75, 1.0], maxWait = 600, label = 'the file', rail = null, ready = null } = {}) {
  const roles = Object.keys(goal), why = [];
  // (a role's goal may be a whole route of its own: [[x, z], …])
  const route = (r) => (Array.isArray(goal[r][0]) ? [...via, ...goal[r]] : [...via, goal[r]]);
  await waitFor(D, function* (w2) {
    why.length = 0;
    if (ready && !ready()) return dbg(D, ['not ready'], label);
    for (const r of roles) {
      const u = D.c(r), rt = route(r), q = rt[rt.length - 1];
      if (rail && !speeds.every((v) => trainMisses(D, trackOf([u.x, u.z], rt, v, 0.2, { hold: 6 })))) return dbg(D, ['the train'], label);
      for (const v of speeds) if (!(yield* fileClearG(D, rt, { mode: 'crawl', from: [u.x, u.z], speed: v, delay: 0.2, slack, slackRate, why, pad }))) return dbg(D, why, label);
      const t = legTime(u.x, u.z, rt, speeds[0], 0.2);
      if (!(yield* fileClearG(D, [q], { mode: 'crawl', from: q, delay: t, hold, slack: 0.3, why, pad }))) return dbg(D, why, label);
    }
    return true;
  }, maxWait, `${label} clear`);
  for (const r of roles) await D.stance(r, 'crawl');
  const legs = Object.fromEntries(roles.map((r) => [r, route(r)]));
  const n = Math.max(...roles.map((r) => legs[r].length));
  for (let i = 0; i < n; i++) {
    for (const r of roles) if (legs[r][i]) D.order(r, { type: 'move', x: legs[r][i][0], z: legs[r][i][1] });
    await D.until(() => roles.every((r) => { const u = D.c(r), p = legs[r][i]; return !p || Math.hypot(u.x - p[0], u.z - p[1]) < 0.6 || (!u.path && !u.isMoving); }), 240, label)
      .catch((e) => { throw new Error(`${e.message} (${roles.map((r) => `${r} ${D.c(r).x.toFixed(1)},${D.c(r).z.toFixed(1)}`).join('; ')})`); });
  }
}

// ---------------------------------------------------------------- the patrols' files
/** `fn()` with the vehicles' own eyes left out of the planners' look-ahead (the caller watches the cars by their rhythm) */
function eyesOff(D, fn) {
  const w = D.world, prev = w.sneakVehicleEyes;
  w.sneakVehicleEyes = false;
  try { return fn(); } finally { w.sneakVehicleEyes = prev; }
}

/**
 * routeClear, with the patrols' file men predicted on their leader's trail (sneak.mjs `sneakTrail`) and looking along
 * it ± `turn` rad — as a player watches a patrol round its corners — instead of 'any way at a corner' (sneak.mjs
 * wheeling): Patrols 40 and 41 turn a few metres off the S edge every minute, and the wheeling rule would keep a man
 * off a hundred metres of it for good.
 */
function fileClear(D, pts, o = {}) { return runGen(fileClearG(D, pts, o)); }

/** (the box of the route points an enemy walks, once per man) */
const routeBoxes = new WeakMap();
/** The box enemy `e` may be anywhere in as predict walks him (his route, his present path, where he stands; a file
 *  man's leader's too, a dog's handler's), widened by `m` m. */
function reachBox(e, m, depth = 0) {
  let rb = routeBoxes.get(e);
  if (rb === undefined) {
    rb = null;
    if (e.route?.length) { rb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of e.route) { rb[0] = Math.min(rb[0], p.x); rb[1] = Math.min(rb[1], p.z); rb[2] = Math.max(rb[2], p.x); rb[3] = Math.max(rb[3], p.z); } }
    routeBoxes.set(e, rb);
  }
  const b = [e.x, e.z, e.x, e.z];
  const add = (q) => { if (!q) return; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); };
  add(rb);
  if (e.path) for (const p of e.path) add([p.x, p.z, p.x, p.z]);
  const lead = depth < 2 && e.brain?._leader?.(), hd = depth < 2 && e.spawn?.handler != null ? e.world?.byId?.(e.spawn.handler) : null;
  if (lead && lead !== e && lead.alive) add(reachBox(lead, 0, depth + 1));
  if (hd?.alive) add(reachBox(hd, 0, depth + 1));
  return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}

/**
 * fileClear in pieces (a generator: it yields after every few guards, so the live replay can slice it across frames —
 * D.runSliced — with no tick in between; the answer is the one a single pass gives). A guard who cannot come within
 * sight of the way (reachBox) is left out before any prediction is made for him.
 */
function* fileClearG(D, pts, o = {}) {
  const w = D.world, turn = o.turn ?? 0.2;
  // (the armoured cars' eyes only so far ahead — their reversals at the ends of their road are no sure prediction
  // beyond — or not at all (`eyes: false`: the caller watches the car himself: carAway)
  const eyes = w.sneakVehicleEyes && !(o.eyes === false || (o.delay ?? 0) > (o.eyesFor ?? Infinity));
  const mode = o.mode || 'walk', sp = o.speed ?? (mode === 'crawl' ? 0.9 : 1.5), slack = o.slack ?? 0.5, step = o.step ?? 0.75;
  let [x, z] = o.from, t = o.delay ?? 0;
  const samples = [[x, z, t]];
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / sp]);
    t += L / sp; x = px; z = pz;
  }
  for (let h = 0.5; h <= (o.hold ?? 0) + 1e-6; h += 0.5) samples.push([x, z, t + h]);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [sx, sz] of samples) { box[0] = Math.min(box[0], sx); box[1] = Math.min(box[1], sz); box[2] = Math.max(box[2], sx); box[3] = Math.max(box[3], sz); }
  const meets = (e) => { const r = reachBox(e, (e.vision?.far ?? 36) + (o.pad ?? 0) + 14); return r[0] <= box[2] && r[2] >= box[0] && r[1] <= box[3] && r[3] >= box[1]; };
  const enemies = w.enemies.filter((e) => e.alive && !e.removed && e.vision && !e.incapacitated && e.brain?.arch?.reacts !== false);
  for (const e of enemies) walking(e); // (every guard's last-moved time kept, whoever is asked: sneak.mjs walking)
  const isMember = (e) => e.squad?.id != null && e.brain?._leader?.() && e.brain._leader() !== e;
  const members = enemies.filter(isMember);
  const ask = enemies.filter((e) => !isMember(e) && !o.except?.includes?.(e) && meets(e));
  // (routeClear for a few guards at a time: the others left out, and the cars' eyes too but in their own piece)
  const prev = w.sneakVehicleEyes;
  for (let i = 0; i < ask.length; i += 6) {
    const chunk = ask.slice(i, i + 6), except = enemies.filter((e) => !chunk.includes(e));
    w.sneakVehicleEyes = false;
    let ok;
    try { ok = routeClear(D, pts, { ...o, except }); } finally { w.sneakVehicleEyes = prev; }
    if (!ok) return false;
    yield;
  }
  if (eyes && !routeClear(D, pts, { ...o, except: enemies })) return false;
  for (const e of members) {
    if (o.except?.includes?.(e) || !meets(e)) continue;
    yield;
    const far = (e.vision.far ?? 36) + 2, lead = e.brain._leader(), lb = lead?.brain;
    // (a file man standing by his halted leader — or by one who has just set off — keeps his place there, beside him at a
    // turn-back halt (Patrol 45's by the bridgehead), until a while after the leader walks off: that place too, facing
    // as he does or as the leader does)
    const stayT = !e.isMoving && !e.path && lead && (lb?.atWait || Math.hypot(lead.x - e.x, lead.z - e.z) < 10) ? Math.max(0, lb?.atWait ? lb.waitT ?? 0 : 0) + 6 : -1;
    for (const [sx, sz, st] of samples) {
      for (let of = -slack; of <= slack + 1e-6; of += 0.5) {
        const tt = Math.max(0, st + of), qs = [predict(e, tt)];
        if (tt <= stayT) qs.push({ x: e.x, z: e.z, heading: e.heading, halt: true }, { x: e.x, z: e.z, heading: lead.heading, halt: true });
        for (const q of qs) {
          const dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far) continue;
          if (dd < (o.keepWalker ?? 4)) { o.why?.push(`${e.tag}~keep@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`); return false; }
          const pd = o.pad ?? 0, f = pd && dd > pd ? pd / dd : 0, d = dummyAt(w, mode, sx + (q.x - sx) * f, sz + (q.z - sz) * f);
          // (± `turn` round a corner of his round, where his heading is on the move; at an about-turn — a beat's end —
          // any way at all)
          let heads = [q.heading];
          if (wheeling(e, tt)) {
            const ha = predict(e, Math.max(0, tt - 3)).heading, hb = predict(e, tt + 3).heading;
            let dh = Math.abs(ha - hb) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
            heads = dh > 2 ? [0, 1, 2, 3, 4, 5, 6, 7].map((r) => (r * Math.PI) / 4) : [q.heading, q.heading - turn, q.heading + turn];
          }
          // (the file halted with its leader: each man may turn to where the leader looks there)
          if (q.halt) { const lq = predict(lead, tt); if (lq.halt && !heads.includes(lq.heading)) heads.push(lq.heading); }
          for (const hd of heads) {
            if (walkerSees(e, hd !== q.heading ? { ...q, heading: hd } : q, d, w, w.time + tt)) { o.why?.push(`${e.tag}~@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`); return false; }
          }
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------- the armoured car on the NE road
/** Its SW stop (it waits there, turns round and drives back NE), and how near it a crawler on the S edge is in its sight. */
const SD_TURN = [121, 128], SD_ZONE = 28;
/** A man lying down is seen by it only within its near band (24.75 m): within that of its stop (and 1.75 m for its pulling up there). */
const SD_NEAR = 26.5;
/** Its near band round wherever it is as it turns at its stop (it backs up to (112,122)): for a man by the bridgehead. */
const CAR_BAND = 37;
/** Its round (s), as assumed before it has been watched: away from its SW stop (beyond SD_ZONE), and there. */
const SD_AWAY = 54, SD_STAY = 25.5;
/** When, after it comes within SD_ZONE, its eye sweeps over the S edge (as it pulls up and as it turns round to go: watched, 5.3–17.3 s). */
const SD_SEES = [4.5, 18];
/** The S edge strip it sees then (x 114–134 of the last metre, watched; and a margin). */
const SD_STRIP = [111, 137];
/**
 * A player's watch on an armoured car: each time it comes within `r` m of the turn `c` of its round (a side task, every
 * tick), and how long it stays. Its reversals at the ends of its road (a three-point turn) make its route a poor guide
 * further ahead than a few seconds; its round's rhythm is a good one.
 */
function watchTurn(D, id, c, r, { startedIn = 0 } = {}) {
  const v = D.world.byId(id), st = { v, inside: null, entries: [], exits: [], stays: [], aways: [] };
  const near = () => !!v && !v.destroyed && !v.removed && Math.hypot(v.x - c[0], v.z - c[1]) < r;
  st.inside = near();
  if (st.inside) st.entries.push(D.t - startedIn); // (it starts the mission there, as if it had come `startedIn` s ago)
  D.meanwhile(() => {
    const n = near();
    if (n !== st.inside) {
      if (n) { if (st.exits.length) st.aways.push(D.t - st.exits.at(-1)); st.entries.push(D.t); }
      else { st.exits.push(D.t); if (st.entries.length) st.stays.push(D.t - st.entries.at(-1)); }
    }
    st.inside = n;
    return false;
  });
  return st;
}
/**
 * Does the watched car keep out of the windows [entry + lo, entry + hi] of its comings to the turn from `a` to `b` s
 * from now (± `m`)? This one if it is there (and while it stays on past its longest stay, till it leaves), and its next
 * ones: each away from the turn as short and as long as the last few times, and there as briefly and as long (its
 * rounds are not even: a three-point turn at each end, sometimes a man in its way). `hi` null: until it leaves.
 */
function turnClear(D, st, a, b, m, { lo = 0, hi = null, away = 54, stay = 25 } = {}) {
  if (!st || !st.v || st.v.destroyed || st.v.removed) return true;
  if (!st.entries.length) return false; // (its round not seen yet: no telling)
  // (the last few rounds; a single one far longer than the rest — the car held up once by a man in its way — set
  // aside: it would close every window for five rounds after)
  const recent = (L, dflt) => {
    if (!L.length) return [dflt];
    const r = L.slice(-6), m = [...r].sort((p, q) => p - q)[r.length >> 1], out = r.filter((x) => x > 1.2 * m);
    return out.length === 1 && r.length >= 4 ? r.filter((x) => x <= 1.2 * m) : r;
  };
  const aMin = Math.min(...recent(st.aways, away)) - 0.5, aMax = Math.max(...recent(st.aways, away)) + 0.5;
  const sMin = Math.min(...recent(st.stays, stay)) - 0.5, sMax = Math.max(...recent(st.stays, stay)) + 0.5;
  const A = D.t + a - m, B = D.t + b + m, e = st.entries.at(-1);
  // (this visit: from its entry; staying on past its longest stay, it is there until it leaves — a few seconds more)
  let x0, x1;
  if (st.inside) {
    const s1 = hi == null ? Math.max(e + sMax, D.t + 5) : e + hi + (D.t > e + sMax ? D.t - e - sMax + 5 : 0);
    if (s1 > A && e + lo < B) return false;
    x0 = Math.max(e + sMin, D.t); x1 = Math.max(e + sMax, D.t + 5); // (when it will leave)
  } else { x0 = x1 = st.exits.at(-1) ?? D.t; }
  for (let k = 0; k < 8; k++) {
    const e0 = x0 + aMin, e1 = x1 + aMax; // (its next coming: the earliest and the latest)
    const s0 = e0 + lo, s1 = e1 + (hi ?? sMax);
    if (s1 > A && s0 < B) return false;
    if (s0 > B) break;
    x0 = e0 + sMin; x1 = e1 + sMax;
  }
  return true;
}
function watchCar(D) { D.world._m18Car = watchTurn(D, 'sd_e', SD_TURN, SD_ZONE, { startedIn: 12.5 }); } // (it leaves its SW stop ~12 s in)
/** Will the car's eye keep off the S edge from `a` to `b` s from now (± `m` s), as its round goes? */
function carAway(D, a, b, m = 1) { return turnClear(D, D.world._m18Car, a, b, m, { lo: SD_SEES[0], hi: SD_SEES[1], away: SD_AWAY, stay: SD_STAY }); }
/**
 * Will the car keep away from its SW stop altogether from `a` to `b` s from now (± `m`)? Its eye sweeps everything
 * within 26 m or so of the stop while it pulls up, waits and turns round there (SD_STAY s each round).
 */
function carGone(D, a, b, m = 3) { return turnClear(D, D.world._m18Car, a, b, m, { away: SD_AWAY, stay: SD_STAY }); }
/**
 * The W armoured car (sd_w) on the W road: at the S end of its round, by the bridgehead, its eye reaches the bridge
 * island's S shore (~48 m). Watched like sd_e: when it comes within 15 m of that turn and when it leaves; its round's
 * period and its stay there as observed (the first ones assumed).
 */
const SDW_TURN = [20, 63], SDW_ZONE = 15;
function watchCarW(D) {
  const v = D.world.byId('sd_w'), st = { inside: null, entries: [], exit: null, stays: [] };
  const near = () => !!v && !v.destroyed && !v.removed && Math.hypot(v.x - SDW_TURN[0], v.z - SDW_TURN[1]) < SDW_ZONE;
  st.inside = near();
  D.meanwhile(() => {
    const n = near();
    if (n !== st.inside) { if (n) st.entries.push(D.t); else { st.exit = D.t; if (st.entries.length) st.stays.push(D.t - st.entries.at(-1)); } }
    st.inside = n;
    return false;
  });
  D.world._m18CarW = st;
}
/** Will sd_w keep away from the S end of its round from `a` to `b` s from now (± `m`)? */
function carWGone(D, a, b, m = 4) {
  const st = D.world._m18CarW, v = D.world.byId('sd_w');
  if (!st || !v || v.destroyed || v.removed) return true;
  const E = st.entries, P = E.length >= 2 ? E[E.length - 1] - E[E.length - 2] : 106, STAY = Math.max(30, ...st.stays) + 1;
  if (st.inside) { const e = E.at(-1) ?? D.t; if (e + STAY > D.t + a - m) return false; }
  if (!E.length) return false; // (its round not seen yet: no telling)
  let e0 = E.at(-1) + P;
  while (e0 + STAY < D.t) e0 += P;
  const A = D.t + a - m, B = D.t + b + m;
  for (let k = 0; k < 8; k++) { const s0 = e0 + k * P, s1 = s0 + STAY; if (s1 > A && s0 < B) return false; if (s0 > B) break; }
  return true;
}
/** When (s from setting off at `v`, after `t0`) a man going from (x, z) along `pts` is within `r` m of `c`: [first, last] or null. */
function timesNear(x, z, pts, v, c, r, t0 = 0) {
  let t = t0, lo = null, hi = null;
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) {
      const qx = x + ((px - x) * k) / n, qz = z + ((pz - z) * k) / n, tt = t + (L * k) / n / v;
      if (Math.hypot(qx - c[0], qz - c[1]) <= r) { if (lo == null) lo = tt; hi = tt; }
    }
    t += L / v; x = px; z = pz;
  }
  return lo == null ? null : [lo, hi];
}
/** Patrol 41 (the round by the lorry) keeps 12 m+ off its W halt (104,139) — where its file stands looking W over the
 *  lorry — for the next `sec` s (its leader on his round; the file's men face any way while they stand there). */
function p41Away(D, sec) {
  const e = D.get('p41');
  if (!e?.alive) return true;
  for (let t = 0; t <= sec; t += 0.5) { const q = predict(e, t); if (Math.hypot(q.x - 104, q.z - 139) < 12) return false; }
  return true;
}
/** The time (from setting off, at `v` m/s) a man crawling W along the S edge from x `xa` to `xb` spends in SD_STRIP. */
function inStrip(xa, xb, v = 0.9) {
  const lo = Math.max(Math.min(xa, xb), SD_STRIP[0]), hi = Math.min(Math.max(xa, xb), SD_STRIP[1]);
  if (lo > hi) return null;
  const t1 = Math.abs(xa - hi) / v, t2 = Math.abs(xa - lo) / v;
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

// ---------------------------------------------------------------- the S edge in pairs
/** The long dash along the S edge (W): from the SE corner past every beat of the fields to x 100 (W of the armoured car's
 *  sight at its SW stop: it reaches x 103 as it turns), then on to the lorry. */
const DASH = { from: 184, mid: 100, z: 149.5 };
/**
 * Each pair (`pairs`: [{roles: [lead, second], lee: [[x, z], [x, z]]}], E to W in the order they go) lies in the SE
 * corner, the second man 1.5 m E of his lead, until one straight crawl W to x 100 stays unseen all the way (every beat
 * of the fields and the armoured car's turn at the SW end of its road: fileClear, carAway) and they can lie there a
 * moment; there they go on to their places by the lorry as soon as that is clear. Both pairs are watched at once (a
 * player orders the second pair off while the first is still on its way). Checked every half second.
 */
async function crossPairs(D, pairs, { maxWait = 3000, v = 0.9 } = {}) {
  const t0 = D.t, st = pairs.map((p, k) => ({ ...p, offs: p.roles.map((_, i) => 3 * k + 1.5 * i), phase: p.join ? 'start' : 'wait', since: D.t, from: DASH.from,
    men: p.roles.map(() => ({ phase: p.join ? 'home' : 'there', since: D.t })) }));
  // (a pair still behind the start's walls: each man crawls down to his place in the corner `join[i]` s in, or at once
  // when the pair before it sets off — the SE fields are in nobody's sight)
  const corner = (r) => { const p = STAGING[r]; return [[p[0] + 7, p[1]], p]; };
  const arrived = (r, q, m) => { const u = D.c(r); return Math.hypot(u.x - q[0], u.z - q[1]) < 0.7 || (!u.path && !u.isMoving && D.t > m.since + 1); };
  function* joinClearG(r, why) {
    const u = D.c(r), way = corner(r);
    for (const sp of [0.75, 1.0]) if (!(yield* fileClearG(D, way, { mode: 'crawl', from: [u.x, u.z], speed: sp, delay: 0.2, slack: 0.6, pad: 0.6, why }))) return false;
    return yield* fileClearG(D, [way[1]], { mode: 'crawl', from: way[1], delay: legTime(u.x, u.z, way, 0.75, 0.2), hold: 8, slack: 0.3, pad: 0.6, why });
  }
  const at = (x, m) => [x + m, DASH.z], why = [];
  /** (a generator: the live replay slices it — every few guards — with no tick in between) */
  function* clearG(offs, from, to, hold, label) {
    why.length = 0;
    const dur = Math.abs(from - to) / v + 0.2;
    // (the armoured car's eye off the S edge while they are in its strip)
    const sx = inStrip(from + offs.at(-1), to, v);
    if (sx && !carAway(D, 0.2 + sx[0] - offs.at(-1) / v, 0.2 + sx[1])) return dbg(D, ['the armoured car'], label);
    for (const m of offs) if (!(yield* fileClearG(D, [at(to, m)], { mode: 'crawl', from: at(from, m), speed: v, delay: 0.2, slack: 0.6, pad: 0.6, eyes: false, why }))) return dbg(D, why, label);
    for (const m of offs) if (!(yield* fileClearG(D, [at(to, m)], { mode: 'crawl', from: at(to, m), delay: dur, hold, slack: 0.5, pad: 0.8, eyes: false, why }))) return dbg(D, why, label);
    return true;
  }
  /** (the short way on to the lorry's lee, every guard: sliced too) */
  function* leeClearG(s) {
    for (const [k, r] of s.roles.entries()) { const u = D.c(r); if (!(yield* routeClearGen(D, [s.lee[k]], { mode: 'crawl', from: [u.x, u.z], speed: 0.9, delay: 0.2, slack: 0.6, pad: 0.6, hold: 4 }))) return false; }
    return true;
  }
  const there = (s, pts) => s.roles.every((r, k) => { const u = D.c(r), q = pts[k]; return Math.hypot(u.x - q[0], u.z - q[1]) < 0.7 || (!u.path && !u.isMoving && D.t > s.since + 1); });
  const go = (s, pts, phase) => { D.waitNote(null); s.roles.forEach((r, k) => D.order(r, { type: 'move', x: pts[k][0], z: pts[k][1] })); s.phase = phase; s.since = D.t; if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s.roles.join('+')} → ${phase}`); };
  try {
    while (st.some((s) => s.phase !== 'done')) {
      if (D.t - t0 > maxWait) throw new Error(`the S edge: ${st.map((s) => `${s.roles.join('+')} ${s.phase}`).join(', ')} after ${maxWait} s`);
      for (const [k, s] of st.entries()) {
        if (s.phase === 'start') {
          for (const [i, r] of s.roles.entries()) {
            const m = s.men[i], way = corner(r);
            if (m.phase === 'home' && (D.t - t0 >= s.join[i] || (k > 0 && !['wait', 'creep'].includes(st[k - 1].phase)))) {
              const it = joinClearG(r, why);
              if (D.runSliced ? await D.runSliced(it) : runGen(it)) { D.waitNote(null); D.order(r, { type: 'move', x: way[0][0], z: way[0][1] }); m.phase = 'leg1'; m.since = D.t; }
            } else if (m.phase === 'leg1' && arrived(r, way[0], m)) { D.order(r, { type: 'move', x: way[1][0], z: way[1][1] }); m.phase = 'leg2'; m.since = D.t; }
            else if (m.phase === 'leg2' && arrived(r, way[1], m)) { m.phase = 'there'; s.onJoin?.(i); }
          }
          if (s.men.every((m) => m.phase === 'there')) { s.phase = 'wait'; s.since = D.t; }
          continue;
        }
        // (the second pair only once the first is well on its way: 30 m ahead, they never crawl through each other)
        const ahead = k === 0 || ['mid', 'lee', 'done'].includes(st[k - 1].phase) || (st[k - 1].phase === 'dash' && D.c(st[k - 1].roles[0]).x < st[k - 1].from - 30);
        // (lying in the corner a while: the pair edges W to EDGE, still in nobody's sight — a shorter dash after)
        if (s.phase === 'wait' && s.from > EDGE && D.t - t0 >= (s.creepAt ?? Infinity) && (k === 0 || st[k - 1].phase !== 'wait' || st[k - 1].from <= EDGE)) {
          const it = clearG(s.offs, s.from, EDGE, 6, `${s.roles.join('+')} along the corner`);
          if (D.runSliced ? await D.runSliced(it) : runGen(it)) { go(s, s.offs.map((m) => at(EDGE, m)), 'creep'); s.onCreep?.(); }
        } else if (s.phase === 'creep' && there(s, s.offs.map((m) => at(EDGE, m)))) { s.phase = 'wait'; s.from = EDGE; s.since = D.t; }
        else if (s.phase === 'wait' && ahead) {
          const it = clearG(s.offs, s.from, DASH.mid, 6, `${s.roles.join('+')} dash`);
          if (D.runSliced ? await D.runSliced(it) : runGen(it)) { go(s, s.offs.map((m) => at(DASH.mid, m)), 'dash'); s.onDash?.(); }
        } else if (s.phase === 'dash' && there(s, s.offs.map((m) => at(DASH.mid, m)))) { s.phase = 'mid'; s.since = D.t; }
        else if (s.phase === 'mid') { const it = leeClearG(s); if (D.runSliced ? await D.runSliced(it) : runGen(it)) go(s, s.lee, 'lee'); }
        else if (s.phase === 'lee' && there(s, s.lee)) { s.phase = 'done'; s.onLee?.(); }
      }
      // (nobody on the move: a true wait — video mode's time-lapse says what for)
      if (!st.some((s) => s.phase === 'dash' || s.phase === 'creep' || s.phase === 'lee' || s.men.some((m) => m.phase === 'leg1' || m.phase === 'leg2'))) D.waitNote('a moment the whole south edge is out of sight');
      await D.wait(0.5);
    }
  } finally { D.waitNote(null); }
}

// ---------------------------------------------------------------- the lorry
/**
 * `role` crawls to the lorry's door and climbs in (on his feet for a moment: nobody may see him then): from where he
 * lies (or from `wait`, a spot in the lorry's lee he crawls to first), along `via` to the door, in one go when the crawl
 * is clear and a man standing at the door would be unseen from his arrival until he is in; he climbs in at once.
 */
async function board(D, role, { wait = null, via = [], maxWait = 400, rail = null, seat = null, car = false, carBand = CAR_BAND } = {}) {
  const u = D.c(role), v = D.world.byId('truck');
  if (wait) await crawlHop(D, role, [wait], { hold: 8, label: `${role} by the lorry`, maxWait, rail });
  const door = boardPoint(v, u, seat ?? v.seatFor(u));
  // (he crawls up to the door and climbs in, 0.5 s: only the moment he gets in counts as a man on his feet — the
  // bunker's sweep over the lorry leaves a couple of seconds between passes)
  await crawlHop(D, role, [...via, [door.x, door.z]], { hold: 1.5, standAtEnd: true, label: `${role} to the lorry's door`, maxWait, rail, pad: 1, speeds: [0.85, 0.95], car, carBand });
  // (at the door, a last look: the moment he gets in he counts as a man on his feet)
  await D.until(() => clearFor(D, [[u.x, u.z]], 1.2, { mode: 'walk' }), 60, `${role} gets in unseen`);
  D.ability(role, 'enterVehicle', v);
  await D.until(() => u.vehicle === v, 30, `${role} aboard`);
  if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${role} in the lorry, seat ${v.seatOf(u)} (wanted ${seat ?? 'any'})`);
}

/** Where the lorry stands at the bridge's E end: on the road by the end of the deck, nose S (it comes round over the
 *  grass N of the road, between the field wall and Patrol 45's beat, and down to it): the Sapper's door (seat 1, the
 *  cab's right) opens W, the hull between him and the bridgehead road, Patrol 45 and the armoured car (carprobe2: at its
 *  stop and on its road it sees a man on his feet E of a lorry standing nose N there, ~3 % of the time). */
const PARK = [97, 111];
/** Its way up to the bridge: over the railway by the level crossing (the track's bed stops a lorry anywhere else), up
 *  the bridgehead road, round over the grass N of it and down to the end of the deck. */
const LORRY_UP = [[100.5, 129.5], [103.2, 121.6], [106, 108.5], [102.5, 103.5], PARK];
/** And back: the same way down, into the lee W of its old place (7 m+ off the railway's axis: a lorry within the
 *  train's box stops it for good), then a few metres E to stand nose to the ENE: the Sapper's door (seat 2, rear left)
 *  opens in the lee, W of the hull (a K-turn's end: the same pose in the page and headless). */
const LORRY_DOWN = [[97.5, 114], [103.2, 121.6], [100.5, 129.5], [90, 143.5], [96, 145]];
/**
 * The blast turns every head to the bridge and sends the patrols running to it: nobody within his far band (`r` m) may
 * have the lorry's door `at` (the Sapper on his feet there, then climbing in, ~1.5 s after the first charge) in a
 * clear line within `cone` rad of the bridge's charges as he looks round at them, from `a` s from now for `dur` s.
 * (The bunker's men turn only within their slit's arc — and the lorry's own hull may screen the door.)
 */
function blastClear(D, at, a, { dur = 3, r = 36, cone = (60 * Math.PI) / 180 } = {}) {
  const w = D.world, g = w.grid, C = PLANT.C;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || e.vehicle || e.incapacitated || !e.vision) continue;
    if (Math.hypot(e.x - at[0], e.z - at[1]) > r + 2 * (a + dur) + 4) continue;
    for (let t = a; t <= a + dur + 1e-6; t += 0.5) {
      const q = walking(e) ? predict(e, t) : e;
      if (Math.hypot(q.x - at[0], q.z - at[1]) > r) continue;
      let d = Math.abs(Math.atan2(at[1] - q.z, at[0] - q.x) - Math.atan2(C[1] - q.z, C[0] - q.x)) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (e.spawn?.structure ? !staticSees(e, dummyAt(w, 'walk', at[0], at[1]), w, t) : d > cone) continue;
      if (g.lineOfSight(q.x, q.z, at[0], at[1], { targetLow: false })) return dbg(D, [`${e.tag} looking at the bridge, the door in view`], 'the blast');
    }
  }
  return true;
}
/** The Sapper's seat in the lorry: the cab's right one (seat 1; seatSide: 0 the driver's, left, 2 and 3 the rear ones at
 *  the tail). At home its door opens S of the hull, where nobody looks (doorprobe, page: a standing man there waited
 *  ~0 s for a clear 3 s, the rear left door ~90 s: e58's sweep, Patrol 41); at the bridge it opens E of the hull, off
 *  Patrol 45's beat (the tail is on it: seen ~45 % of the time, the cab's right door ~30 %). */
const SAPPER_SEAT = 1;
/** From the cab's right door at the bridge (W of the hull) onto the deck. */
const TO_DECK = [[93, 109], [90.5, 107], DECK_IN];
/**
 * Will the lorry driven along `way` ([[x, z], …] from where it stands, `turn` s turning round at the start, then
 * `speed` m/s) pass nobody on foot? A man the hull or its front sensor box comes up against steps aside and knows it for
 * ours (vehicle.js _stepAside: it is tainted, fired at): every walker keeps `r` m off its way (± `slack` s), every man
 * at a post `rPost` m; the men in the bunkers and the armoured cars' crews do not leave them. And the train's kill box
 * misses its hull where it crosses the railway. A generator (a few men at a time).
 */
function* driveClearG(D, way, { speed = 2.6, turn = 0, corner = 2, r = 8, rPost = 4, slack = 3, why = null } = {}) {
  const w = D.world, samples = [];
  // (turning round where it stands for `turn` s, then leg after leg, `corner` s at each bend: it turns and sets off again)
  let t = 0;
  for (; t < turn; t += 0.5) samples.push([way[0][0], way[0][1], t]);
  for (let k = 1; k < way.length; k++) {
    const leg = trackOf(way[k - 1], [way[k]], speed, t, { step: 1 });
    for (const q of leg.slice(1)) samples.push(q);
    t = leg.at(-1)[2];
    if (k < way.length - 1) for (let h = 0.5; h <= corner + 1e-6; h += 0.5) samples.push([way[k][0], way[k][1], t + h]);
    if (k < way.length - 1) t += corner;
  }
  if (!trainMisses(D, samples, { across: 7, grow: 3.5 })) { why?.push('the train'); return false; }
  // (and the armoured car off its stop while the lorry passes the level crossing: it backs up there as it turns round)
  const nearCar = samples.filter(([sx, sz]) => Math.hypot(sx - SD_TURN[0], sz - SD_TURN[1]) < 24);
  if (nearCar.length && !carGone(D, nearCar[0][2], nearCar.at(-1)[2])) { why?.push('the armoured car'); return false; }
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [sx, sz] of samples) { box[0] = Math.min(box[0], sx); box[1] = Math.min(box[1], sz); box[2] = Math.max(box[2], sx); box[3] = Math.max(box[3], sz); }
  let n = 0;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || e.vehicle || e.spawn?.structure || e.incapacitated) continue;
    const moving = walking(e), R = moving ? r : rPost, rb = reachBox(e, R + 2);
    if (rb[0] > box[2] || rb[2] < box[0] || rb[1] > box[3] || rb[3] < box[1]) continue;
    for (const [sx, sz, st] of samples) {
      for (let o = -slack; o <= slack + 1e-6; o += 0.5) {
        const q = moving ? predict(e, Math.max(0, st + o)) : e;
        if (Math.hypot(q.x - sx, q.z - sz) < R) { why?.push(`${e.tag}~near(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
        if (!moving) break;
      }
    }
    if (++n % 4 === 0) yield;
  }
  return true;
}
/**
 * Drive the lorry (the Driver at the wheel) along `way` — one straight click per leg, as a player drives: it turns,
 * then runs straight — once nobody on foot is near its whole way; until it stops at the end.
 */
async function driveLorry(D, way, { label = 'the lorry', turn = 0, maxWait = 600 } = {}) {
  const v = D.world.byId('truck');
  // (a look every 20 ticks: the whole way against every walker's next minute is the costliest look-ahead of the
  // solution — checked every 5 ticks the live replay's clock all but stood still meanwhile)
  await waitFor(D, function* (why) {
    return (yield* driveClearG(D, [[v.x, v.z], ...way], { turn, why })) || dbg(D, why, label);
  }, maxWait, `${label}: nobody near its way`, 20);
  for (const [i, to] of way.entries()) {
    await D.drivePlan('driver', to[0], to[1]); // (the turn planned sliced: the order finds it made)
    const t0 = D.t;
    D.order('driver', { type: 'move', x: to[0], z: to[1] });
    let k = 0;
    await D.until(() => {
      if (DBG && k++ % 30 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: at (${v.x.toFixed(1)},${v.z.toFixed(1)}) h${(v.heading * 180 / Math.PI).toFixed(0)} v${(v.speed || 0).toFixed(2)} goal ${!!v.goal} blocked ${(v.blockedT || 0).toFixed(1)}`);
      return !v.goal && (v.speed || 0) < 0.05 && D.t > t0 + 0.3;
    }, 90, `${label} → (${to})`);
    if (Math.hypot(v.x - to[0], v.z - to[1]) > (i === way.length - 1 ? 2.5 : 3)) throw new Error(`${label} stopped at (${v.x.toFixed(1)},${v.z.toFixed(1)}), short of (${to})`);
  }
}
/**
 * `role` gets out of the lorry (at his seat's door: vehicle.js _exitPoint, on his belly as he got in) and crawls along
 * `pts`, once nobody would see him there as he gets out (a moment) nor on the way nor at its end for `hold` s.
 */
async function slipOut(D, role, pts, { label = `${role} out`, hold = 4, maxWait = 600, speeds = [0.85, 0.95], car = true } = {}) {
  const u = D.c(role), v = u.vehicle, seat = v.seatOf(u);
  const ex = v._exitPoint(undefined, undefined, false, u, seat);
  if (!ex) throw new Error(`${role}: no way out of the lorry`);
  const from = [ex.x, ex.z], end = pts.at(-1);
  await waitFor(D, function* (why) {
    // (the armoured car away from its SW stop while he is out within its reach of it, as it turns round there)
    if (car) {
      const nc = timesNear(...from, pts, Math.max(...speeds), SD_TURN, CAR_BAND, 0), nc2 = timesNear(...from, pts, Math.min(...speeds), SD_TURN, CAR_BAND, 1.5);
      if (nc && !carGone(D, nc[0], nc2[1] + hold)) return dbg(D, ['the armoured car'], label);
    }
    // (out: standing at the door for the moment he gets down, then on his belly)
    if (!(yield* fileClearG(D, [from], { mode: 'walk', from, delay: 0, hold: 1, slack: 0.3, why, pad: 1 }))) return dbg(D, why, label);
    if (!(yield* fileClearG(D, [from], { mode: 'crawl', from, delay: 0.5, hold: 2, slack: 0.3, why, pad: 1 }))) return dbg(D, why, label);
    const t = legTime(...from, pts, Math.min(...speeds), 1.5), t1 = legTime(...from, pts, Math.max(...speeds), 1.5);
    for (const sp of speeds) if (!(yield* fileClearG(D, pts, { mode: 'crawl', from, speed: sp, delay: 1.5, slack: 0.6, why, pad: 1 }))) return dbg(D, why, label);
    return (yield* fileClearG(D, [end], { mode: 'crawl', from: end, delay: t1, hold: hold + t - t1, slack: 0.3, why, pad: 1 })) || dbg(D, why, label);
  }, maxWait, `${label} clear`);
  D.ability(role, 'leaveVehicle');
  await D.until(() => !u.vehicle && !u.currentAction, 6, `${role} out of the lorry`);
  await D.stance(role, 'crawl');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.5, max: 120 });
  return seat;
}

// ---------------------------------------------------------------- the Marine's boat
/** e20's spot on the N island and the shallows by the boat where the Marine packs it (gear off, H, gear on). */
async function fetchBoat(D, { onShot = null, onPacked = null } = {}) {
  const w = D.world, ma = D.c('diver'), e20 = D.get('e20'), raft = D.raft();
  // the shallows beside the boat, 0.3 m of shallow water all round (M3 packRaft)
  const ok = (a, b) => { const g = w.groundAt(a, b); return g.shallow && !g.bridge; };
  let SH = null, bd = Infinity;
  for (let dx = -1.8; dx <= 1.8; dx += 0.1) for (let dz = -1.8; dz <= 1.8; dz += 0.1) {
    const d = Math.hypot(dx, dz), px = raft.x + dx, pz = raft.z + dz;
    if (d > 1.8 || d >= bd || !ok(px, pz) || ![[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([a, b]) => ok(px + a, pz + b))) continue;
    SH = [px, pz]; bd = d;
  }
  if (!SH) throw new Error('no shallows by the boat');
  const why = [];
  // a quiet moment: nobody but e20 will look at the boat, at e20 (his fall, his body) or at the shallows for the next
  // 14 s (the shot, the gear off, the boat packed, the gear on), nor sees the Marine surface for his shot (looked at
  // every 5 ticks, as every other wait: the look-ahead is what the live replay's time-lapse waits on)
  let k = 0;
  await D.until(() => {
    if (k++ % 5) return false;
    why.length = 0;
    if (!clearFor(D, [[raft.x, raft.z], [e20.x, e20.z], SH], 14, { mode: 'walk', except: [e20], why })) return dbg(D, why, 'the boat');
    if (!clearFor(D, [[ma.x, ma.z]], 2, { mode: 'crawl', except: [e20], why })) return dbg(D, why, 'the boat (shot)');
    return unwitnessed(D, e20, ma, { why }) || dbg(D, why, 'the boat (witness)');
  }, 600, 'a quiet moment on the S shore of the N island').catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.ability('diver', 'harpoon', e20);
  await D.until(() => !e20.alive, 5, 'e20 down');
  onShot?.();
  await D.go('diver', ...SH, { tol: 0.15, max: 20 });
  D.ability('diver', 'dive'); // (gear off in the shallows)
  await D.until(() => !ma.diving && !ma.currentAction, 6, 'gear off');
  D.ability('diver', 'hand', { x: ma.x, z: ma.z });
  await D.until(() => !D.raft(), 6, 'boat packed');
  await D.until(() => !ma.currentAction, 4, 'the pack on his back');
  D.ability('diver', 'dive');
  await D.until(() => ma.stance === 'dive' && !ma.currentAction, 8, 'marine under water again');
  onPacked?.();
}

// ---------------------------------------------------------------- the boat's crew (after M3)
/** wait (up to maxSec) until nobody will see a standing man at any of `pts` for the next `dur` s */
async function clearWindow(D, pts, dur = 4, maxSec = 150, label = 'clear window') {
  await D.until(() => pts.every((q) => clearFor(D, [q], dur, { mode: 'walk' })), maxSec, label);
}
/** the nearest point within `r` m of (x, z) standing well inside shallow water (0.3 m of shallows all round) */
function shallowNear(D, x, z, r = 1.8) {
  const ok = (a, b) => { const g = D.world.groundAt(a, b); return g.shallow && !g.bridge; };
  let best = null, bd = Infinity;
  for (let dx = -r; dx <= r; dx += 0.1) for (let dz = -r; dz <= r; dz += 0.1) {
    const d = Math.hypot(dx, dz), px = x + dx, pz = z + dz;
    if (d > r || d >= bd || !ok(px, pz) || ![[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([a, b]) => ok(px + a, pz + b))) continue;
    best = [px, pz]; bd = d;
  }
  return best;
}
/** step off the boat when no cone will cover the bank point, then down on his belly at once */
async function landProne(D, role, x, z) {
  const u = D.c(role), raft = D.raft();
  await clearWindow(D, [[x, z], [raft.x, raft.z]], 3, 150, `${role} lands`);
  if (DBG) D.log(`DBG ${role} lands: boat at (${raft.x.toFixed(2)},${raft.z.toFixed(2)}) near bank ${raft._nearShallowOrBank?.()} exit ${JSON.stringify(raft._exitPoint?.(undefined, undefined, false, u, raft.seatOf(u)))}`);
  D.ability(role, 'leaveVehicle');
  await D.until(() => !u.vehicle && !u.currentAction, 5, `${role} off the boat`);
  const g = D.world.groundAt(u.x, u.z);
  if (DBG) D.log(`DBG ${role} stepped off at (${u.x.toFixed(2)},${u.z.toFixed(2)}) ${u.stance} ${u.state} shallow ${g.shallow} water ${g.water}`);
  if (g.shallow || g.water || Math.hypot(u.x - x, u.z - z) > 0.6) await D.go(role, x, z, { tol: 0.4 });
  await D.stance(role, 'crawl');
}
/** board the boat from the bank when no cone will cover him getting up and climbing in */
async function boardRaft(D, role) {
  const u = D.c(role), raft = D.raft();
  let bp = boardPoint(raft, u);
  const d0 = Math.hypot(bp.x - u.x, bp.z - u.z);
  if (d0 > 0.8 && !D.world.groundAt(bp.x, bp.z).shallow) { // (creep up to the hull first, prone, unseen)
    await D.go(role, bp.x + ((u.x - bp.x) / d0) * 0.4, bp.z + ((u.z - bp.z) / d0) * 0.4, { tol: 0.3 });
    bp = boardPoint(raft, u);
  }
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(bp.x - u.x, bp.z - u.z) / 1.5 + 1.4;
  await clearWindow(D, [[u.x, u.z], [bp.x, bp.z]], dur, 150, `${role} boards`);
  D.ability(role, 'enterVehicle', raft);
  await D.until(() => u.vehicle === raft, 15, `${role} aboard`);
}
/** the Marine steps out into the shallows by the boat and packs it (2 s, then the fold): nothing left lying about */
async function packRaft(D) {
  const ma = D.c('diver'), raft = D.raft();
  D.ability('diver', 'leaveVehicle');
  await D.until(() => !ma.vehicle && !ma.currentAction, 3, 'Marine off the boat');
  const at = shallowNear(D, raft.x, raft.z);
  if (at) await D.go('diver', ...at, { tol: 0.12 });
  D.ability('diver', 'hand', { x: ma.x, z: ma.z });
  await D.until(() => !D.raft(), 6, 'boat packed');
  await D.until(() => !ma.currentAction, 4, 'the pack on his back');
}

// ---------------------------------------------------------------- the stages
export const STAGES = [
  ['A', 'Off the start', async (D) => {
    // the four lie prone behind the ruined field wall; the SE corner of the map behind them is in nobody's sight. The
    // Marine and the Sapper go first, one after the other: down to the S edge, then W along it
    for (const r of ['diver', 'sapper']) { const p = STAGING[r]; await crawlHop(D, r, [[p[0] + 7, p[1]], p], { label: `${r} to the SE corner`, hold: 8 }); }
    D.checkpoint('A1 the Marine and the Sapper in the SE corner');
  }],
  ['B', 'Along the south edge', async (D) => {
    // one long file W along the last metre of the fields: e32's, Patrol 40's and Patrol 41's beats come within a few
    // metres of it, the armoured car turns 21 m off it — all four go in the one window that keeps them all unseen
    // (the marks in the order they come: the second pair may set off before the first is by the lorry, or after)
    const say = {
      b0: () => D.checkpoint('B0 greenberet in the SE corner'),
      b0b: () => D.checkpoint('B0b driver in the SE corner'),
      b1: () => D.checkpoint('B1 diver and sapper along the S edge'),
      b2: () => D.checkpoint('B2 greenberet and driver along the S edge'),
      b3: () => D.checkpoint('B3 diver and sapper by the lorry'),
      b4: () => D.checkpoint('B4 greenberet and driver by the lorry'),
    };
    let lee1 = false, off2 = false;
    const both = () => { if (lee1 && off2) { lee1 = off2 = null; say.b3(); } };
    await crossPairs(D, [
      { roles: ['diver', 'sapper'], lee: [LEE.diver, LEE.sapper], creepAt: CREEP_AT[0], onDash: say.b1, onLee: () => { lee1 = true; both(); } },
      // (the Green Beret and the Driver follow down to the corner while the first pair waits there: JOIN_GB, JOIN_DRIVER)
      { roles: ['greenberet', 'driver'], lee: [LEE.greenberet, LEE.driver], join: [JOIN_GB, JOIN_DRIVER], creepAt: CREEP_AT[1], onJoin: (i) => (i ? say.b0b() : say.b0()),
        onDash: () => { say.b2(); off2 = true; both(); }, onLee: say.b4 },
    ]);
  }],
  ['C', 'The Marine away, the others into the lorry', async (D) => {
    const ma = D.c('diver');
    // the Marine first: over the railway (the train runs down it to the S edge) to the beach's SE corner while Patrol 46
    // is up the beach, into the shallows, and under water
    await crawlHop(D, 'diver', [CORNER.diver, CORNER_WET], { label: 'marine to the river', rail: RAIL_S, hold: 3 });
    D.ability('diver', 'dive');
    await D.until(() => ma.stance === 'dive' && !ma.currentAction, 8, 'marine dives');
    D.checkpoint('C0 marine dives at the beach corner');
    // up the river under the bridge to the water E of e20, outside his sight: his quiet moment comes every ~3.5 min
    // (the N island's men keep looking at the boat), and meanwhile the Driver and the Green Beret climb into the lorry
    // (inside it nobody sees them)
    await D.go('diver', ...E20_SHOT, { tol: 0.6, max: 300 });
    await board(D, 'greenberet'); // (the seat by the S door, from the lee straight across)
    D.checkpoint('C1 greenberet in the lorry');
    // (round the tail to the cab's N door, clear of the hull, between it and the railway — the train's kill box
    // reaches 3.4 m either side of the line: only while it is away)
    await board(D, 'driver', { via: [[86.8, 145.2], [87.0, 142.5], [88.8, 140.8]], rail: [82.5, 141] });
    D.checkpoint('C2 driver in the lorry');
  }],
  ['D', 'The boat on the N island', async (D) => {
    await fetchBoat(D, { onShot: () => D.checkpoint('D2 marine harpoons e20'), onPacked: () => D.checkpoint('D3 marine packs the boat') });
    // back down the river to the beach corner, under water
    await D.go('diver', 55.5, 146.5, { tol: 0.8, max: 300 });
    D.checkpoint('D4 marine back by the beach corner');
  }],
  ['E', 'The charges on the bridge island', async (D) => {
    const ma = D.c('diver'), sa = D.c('sapper'), e54 = D.get('e54');
    // the island's MG covers every shore a boat could land on: the Marine swims round to the shallows behind its gunner
    // (under the deck's girder), surfaces where nobody sees him and harpoons him. The gunner on the W bank sees the body
    // and cries out — but a body on the island is nothing to the banks (its cries reach no one): he and the W road's
    // patrol look about and go back to their posts; the Marine waits under water until they have.
    await D.go('diver', ...MG_SHOT, { tol: 0.6, max: 200 });
    const why = [];
    await D.until(() => { why.length = 0; return (clearFor(D, [[ma.x, ma.z]], 2, { mode: 'crawl', except: [e54], why }) && unwitnessed(D, e54, ma, { why })) || dbg(D, why, 'the MG gunner'); }, 300, 'the MG gunner, unwitnessed');
    D.ability('diver', 'harpoon', e54);
    await D.until(() => !e54.alive, 5, 'e54 down');
    D.checkpoint('E0 marine harpoons the island MG gunner');
    // and the island's walker, from the water off its W shore, as he walks off E from the end of his beat (his back to
    // the Marine), before he finds the gunner
    const e57 = D.get('e57');
    await D.go('diver', ...E57_SHOT, { tol: 0.6, max: 60 });
    await D.until(() => { why.length = 0; return (e57.alive && Math.cos(e57.heading) > 0.8 && Math.hypot(e57.x - ma.x, e57.z - ma.z) < 8.5
      && clearFor(D, [[ma.x, ma.z]], 2, { mode: 'crawl', except: [e57], why }) && unwitnessed(D, e57, ma, { why })) || dbg(D, why, 'the island walker'); }, 300, 'the island walker, unwitnessed');
    D.ability('diver', 'harpoon', e57);
    await D.until(() => !e57.alive, 5, 'e57 down');
    D.checkpoint('E0b marine harpoons the island walker');
    const calm = () => D.world.enemies.every((e) => !e.alive || ['IDLE', 'DEAD'].includes(e.brain?.state) || e.vehicle);
    await D.wait(3);
    await D.until(calm, 300, 'the banks calm again');
    await D.go('diver', 55.5, 146.5, { tol: 0.8, max: 200 });
    // Patrol 46 halts at the beach's S end, 8 m from the corner, then walks back up the beach for half a minute: the
    // corner is clear only then. The Sapper lies 18 m off it E of the line; the moment the patrol has turned N he
    // crawls over the line to the corner while the Marine climbs out there and inflates the boat; he gets in and they
    // row out N, out of the patrol's sight before it comes back down
    await crawlHop(D, 'sapper', [CORNER_WAIT], { label: 'sapper near the beach corner', hold: 8, maxWait: 300 });
    const p46 = D.get('p46');
    const headingN = () => p46?.alive && Math.sin(p46.heading) < -0.7 && Math.hypot(p46.x - 62, p46.z - 140) < 4 && p46.isMoving;
    // (the whole file turned N: the leader 5 m up the beach, his men behind him, all their backs to the water)
    const fileN = () => p46?.alive && Math.sin(p46.heading) < -0.7 && Math.hypot(p46.x - 62, p46.z - 140) > 5 && Math.hypot(p46.x - 62, p46.z - 140) < 9 && p46.isMoving
      && ['p46_a', 'p46_b'].every((t) => { const m = D.get(t); return !m?.alive || Math.sin(m.heading) < -0.5; });
    await crawlHop(D, 'sapper', [CORNER.sapper], { label: 'sapper to the beach corner', rail: RAIL_S, hold: 4, standAtEnd: true,
      endPts: [CORNER.sapper, CORNER.diver, CORNER_WET], speeds: [0.85, 0.95], maxWait: 600,
      // (and the boat's way out from the corner to the island clear from when they will be aboard, ~27 s from now)
      ready: function* (why) {
        if (!headingN()) return false;
        const a = clearFor(D, [CORNER.diver, CORNER_WET], 24, { mode: 'walk', why });
        // (the whole way to the island in one go: the boat must not lie about off the beach when the patrol comes back)
        // (and the boat at the island for the landing and the packing, ~14 s, before anyone looks that way)
        const b = a && (yield* fileClearG(D, [...RAFT_OUT, ...RAFT_IN], { mode: 'boat', from: RAFT_LAUNCH, speed: 2.2, delay: 27, slack: 1.5, pad: 0.5, hold: 14, why }));
        if (DBG) D.log(`DBG ${D.t.toFixed(1)} launch? corner ${a} boat ${b} [${why.join(' ')}]`);
        return b;
      },
      onGo: () => D.ability('diver', 'raft') });
    await D.until(() => D.raft() && ma.vehicle === D.raft() && !ma.currentAction, 30, 'boat inflated, Marine aboard');
    D.checkpoint('E1 marine inflates the boat at the corner');
    D.ability('sapper', 'enterVehicle', D.raft());
    await D.until(() => sa.vehicle === D.raft(), 15, 'sapper aboard');
    D.checkpoint('E2 sapper in the boat');
    for (const [x, z] of [...RAFT_OUT, ...RAFT_IN]) await D.row(x, z, 60);
    D.checkpoint('E3 the boat at the bridge island');
    // ashore W of the island's beached boat. A boat lying off the island would be seen from the beach's S end and by the
    // armoured car on the W road: the Marine packs it and waits under water by the shore
    await landProne(D, 'sapper', ...ISLE_LAND);
    await packRaft(D); // (at once: the way there was chosen with the landing and the packing clear)
    D.ability('diver', 'dive');
    await D.until(() => ma.stance === 'dive' && !ma.currentAction, 8, 'marine under water');
    await crawlHop(D, 'sapper', [...CASE_WAY, CASE], { label: 'sapper to the case', hold: 4, speeds: [0.85, 0.95], maxWait: 600 });
    const it = D.world.interactables.find((i) => i.spawn?.id === 'bombs_crate' || i.tag === 'bombs_crate');
    D.ability('sapper', 'hand', it);
    await D.until(() => (sa.inventory.get('remoteBomb') ?? 0) >= 3 && !sa.currentAction && !sa.pendingAbility, 30, 'charges taken');
    await D.stance('sapper', 'crawl');
    D.checkpoint('E4 sapper takes the three German charges');
    // (back to the shore E of the beached boat: in the real game its model leaves no room for a man lying W of its stern)
    await crawlHop(D, 'sapper', [...CASE_WAY].reverse(), { label: 'sapper back to the shore', hold: 4, speeds: [0.85, 0.95], maxWait: 600 });
    // the boat again (the Marine climbs out and inflates it, ~6 s; the Sapper gets in) and out to open water SW of the
    // island, beyond the reach of every post and of the beach's S end; then, the moment Patrol 46 has turned N at the end
    // of the beach, a dash to the corner, in at the corner, ashore, the boat packed (all before the patrol comes back)
    const GO = 9;
    // (where he will come out of the water and stand to inflate it: the bank the game picks, and the shallows by it
    // where his gear comes off)
    const st = launchStand(D.world, ma, true), gear = st && shallowNear(D, st.x, st.z, 3);
    const up = st ? [[st.launch.x, st.launch.z], [st.x, st.z], ...(gear ? [gear] : [])] : [];
    if (DBG) D.log(`DBG the Marine will launch from (${st?.x.toFixed(2)},${st?.z.toFixed(2)}), the boat at (${st?.launch.x.toFixed(2)},${st?.launch.z.toFixed(2)})`);
    await waitFor(D, function* (why) {
      // (the W armoured car by its round: its eye at the S end of the W road just reaches the island's S shore)
      if (!carWGone(D, 0, GO + 12)) return dbg(D, ['the W armoured car'], 'the boat off the island');
      // (the men on their feet as they inflate it and get in, the boat itself by its hull)
      // (the way out to open water for a departure on time and for one a couple of seconds late — the Sapper slower to
      // climb in — or a boat lying off the island a moment too long shows its hull to the beach's S end)
      if (!(eyesOff(D, () => clearFor(D, [[sa.x, sa.z], [ma.x, ma.z], ...up], GO, { mode: 'walk', why }) && clearFor(D, [ISLE_RAFT, ...up.slice(0, 1)], GO + 2.5, { mode: 'boat', why })))) return dbg(D, why, 'the boat off the island');
      for (const late of [0, 2.5]) if (!(yield* fileClearG(D, RAFT_OFF, { mode: 'boat', from: st ? [st.launch.x, st.launch.z] : ISLE_RAFT, speed: 2.2, delay: GO + late, slack: 1.5, pad: 0.5, hold: 20, eyes: false, why }))) return dbg(D, why, 'the boat off the island');
      return true;
    }, 600, 'the boat off the island');
    D.ability('diver', 'raft');
    await D.until(() => D.raft() && ma.vehicle === D.raft() && !ma.currentAction, 30, 'boat inflated again');
    await boardRaft(D, 'sapper');
    D.checkpoint('E5 the boat back for the Sapper');
    for (const [x, z] of RAFT_OFF) await D.row(x, z, 60);
    D.order('diver', { type: 'stop' }); // (oars shipped: the boat lies still out there, it is not under way)
    const BACK = [CORNER_LAND];
    await waitFor(D, function* (why) {
      const r = D.raft();
      if (!fileN()) return false;
      if (!(yield* fileClearG(D, BACK, { mode: 'boat', from: [r.x, r.z], speed: 2.2, delay: 0.3, slack: 1.5, pad: 0.5, why }))) return dbg(D, why, 'the boat back');
      const t = legTime(r.x, r.z, BACK, 2.2, 0.3);
      // (the train must not cut them off: it runs down the line across their way off the corner)
      if (!railFree(D, t + 40, RAIL_S)) return dbg(D, ['the train'], 'the boat back');
      // (the corner clear for the landing and the packing, ~9 s, and then the crawl away E over the line for both)
      for (const q of [CORNER_LAND, CORNER.sapper, CORNER.diver]) if (!(yield* fileClearG(D, [q], { mode: 'walk', from: q, delay: t, hold: 9, slack: 0.5, pad: 0.5, why }))) return dbg(D, why, 'the boat back (corner)');
      for (const [a, b] of [[CORNER.sapper, CORNER_WAIT], [CORNER.diver, [CORNER_WAIT[0] + 1.5, CORNER_WAIT[1]]]]) if (!(yield* fileClearG(D, [b], { mode: 'crawl', from: a, speed: 0.85, delay: t + 10, slack: 0.6, pad: 0.6, hold: 4, why }))) return dbg(D, why, 'the boat back (corner)');
      return true;
    }, 600, 'the boat back to the corner');
    const tDash = D.t;
    for (const [x, z] of BACK) await D.row(x, z, 60);
    if (DBG) D.log(`DBG the dash to the corner took ${(D.t - tDash).toFixed(1)} s (predicted ${legTime(...RAFT_OFF.at(-1), BACK, 2.2, 0.3).toFixed(1)})`);
    await landProne(D, 'sapper', ...CORNER.sapper);
    if (DBG) D.log(`DBG landed at +${(D.t - tDash).toFixed(1)} s`);
    await packRaft(D);
    if (DBG) D.log(`DBG packed at +${(D.t - tDash).toFixed(1)} s`);
    D.checkpoint('E6 back at the corner, the boat packed');
    await D.go('diver', ...CORNER.diver, { tol: 0.4, max: 10 }); // (out of the shallows onto the beach: nobody crawls in water)
    // both crawl off E at once, over the line, away from the patrol's end of the beach
    await crawlFile(D, { sapper: CORNER_WAIT, diver: [CORNER_WAIT[0] + 1.5, CORNER_WAIT[1]] }, { label: 'off the corner', rail: RAIL_S, hold: 6, speeds: [0.85, 0.95], maxWait: 60 });
  }],
  ['F', 'Three charges on the bridge', async (D) => {
    // the Sapper climbs into the lorry from its lee, by the cab's right door (S of the hull: his door at the bridge, on
    // the deck side, once the lorry stands nose S there), then the Marine by the tail
    await crawlHop(D, 'sapper', [LEE_SAPPER], { label: 'sapper to the lee', hold: 8, rail: [80, 145], speeds: [0.85, 0.95], maxWait: 300 });
    await board(D, 'sapper', { seat: SAPPER_SEAT });
    D.checkpoint('F1 sapper in the lorry');
    await board(D, 'diver', { via: [[83, 148.6]], rail: [80, 145] });
    D.checkpoint('F2 marine in the lorry');
    // up to the bridge's E end: a lorry of their own to the Germans (nobody minds it, so long as nobody has to step out
    // of its way); round over the grass N of the road and down to the end of the deck, nose S: its right side to the deck
    await driveLorry(D, LORRY_UP, { label: 'the lorry up to the bridge' });
    if (DBG) { const v = D.world.byId('truck'); D.log(`DBG ${D.t.toFixed(1)} the lorry at the bridge (${v.x.toFixed(2)},${v.z.toFixed(2)}) h${(v.heading * 180 / Math.PI).toFixed(0)}; the Sapper's door ${JSON.stringify(v._exitPoint(undefined, undefined, false, D.c('sapper'), v.seatOf(D.c('sapper'))))}`); }
    D.checkpoint('F3 the lorry at the bridge');
    // the Sapper slips out on the deck side and crawls onto the deck: nobody below sees a man lying up there
    const seat = await slipOut(D, 'sapper', TO_DECK, { label: 'sapper onto the deck', car: false });
    D.checkpoint('F4 sapper on the bridge');
    const plant = async (m) => {
      await crawlHop(D, 'sapper', [PLANT[m]], { label: `sapper to ${m}`, hold: 3, speeds: [0.85, 0.95], maxWait: 300 });
      D.ability('sapper', 'remoteBomb'); // (lying down: the charge goes on the deck in front of him)
      await D.idle('sapper', 5);
    };
    await plant('C');
    D.checkpoint('F5 sapper sets a charge on C');
    await plant('B');
    D.checkpoint('F6 sapper sets a charge on B');
    await plant('A');
    D.checkpoint('F7 sapper sets a charge on A');
    // back along the deck, to lie up short of its E end (Patrol 45's halt by the bridgehead looks into the end of it)
    await crawlHop(D, 'sapper', [DECK_WAIT], { label: 'sapper back along the deck', hold: 3, speeds: [0.85, 0.95], maxWait: 300 });
    // (then off it, down to the lorry's W side and in, by the same door)
    if (DBG) { const c = D.world._m18Car; D.log(`DBG ${D.t.toFixed(1)} car entries ${c.entries.map((x) => x.toFixed(0)).join(' ')} stays ${c.stays.map((x) => x.toFixed(1)).join(' ')} aways ${c.aways.map((x) => x.toFixed(1)).join(' ')}`); }
    // (the hull screens the way and the door from the bridgehead road, Patrol 45 and the armoured car)
    await board(D, 'sapper', { via: TO_DECK.slice(0, -1).reverse(), seat });
    D.checkpoint('F8 sapper back in the lorry');
  }],
  ['G', 'The bridge comes down', async (D) => {
    const sa = D.c('sapper'), v = D.world.byId('truck');
    // back down to the S road (nose S already: it turned round on arriving), to stand by the lee: the Sapper's door
    // opens S of the hull, where nobody looks
    await driveLorry(D, LORRY_DOWN, { label: 'the lorry back by the S road', turn: 2 });
    D.checkpoint('G1 the lorry back by the S road');
    // out at his door: three presses of the detonator, the oldest charge first — the span falls, the siren sounds — and
    // in again at once: nobody may see him on his feet there meanwhile, nor have him in view when the blast turns every
    // head to the bridge
    const ex = v._exitPoint(undefined, undefined, false, sa, v.seatOf(sa)), at = [ex.x, ex.z];
    if (DBG) D.log(`DBG the lorry home at (${v.x.toFixed(2)},${v.z.toFixed(2)}) h${(v.heading * 180 / Math.PI).toFixed(0)}; the Sapper gets out at (${at.map((q) => q.toFixed(2))})`);
    await waitFor(D, function* (why) {
      if (!blastClear(D, at, 0)) return false;
      return (yield* fileClearG(D, [at], { mode: 'walk', from: at, delay: 0, hold: 6, slack: 0.3, why, pad: 1 })) || dbg(D, why, 'the blast');
    }, 900, 'nobody looking at the lorry\'s door');
    D.ability('sapper', 'leaveVehicle');
    await D.until(() => !sa.vehicle && !sa.currentAction, 6, 'sapper out of the lorry');
    for (let i = 0; i < 3; i++) { D.ability('sapper', 'detonate'); await D.wait(0.25); }
    D.checkpoint('G2 sapper blows the three charges');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 10, 'the span down');
    D.ability('sapper', 'enterVehicle', v);
    await D.until(() => sa.vehicle === v, 10, 'sapper aboard');
    D.checkpoint('G3 everyone in the lorry');
    await D.until(() => D.world.objectives.every((o) => o.done || o.required === false), 30, 'away by the S road');
  }],
];

export async function solve(D, ctx = {}) {
  D.watchCrewedRafts(); // (the boat counts by its hull too, crewed or not)
  // (the planners' look-ahead: the armoured cars' own eyes, the patrols' file men on their leader's trail)
  D.world.sneakVehicleEyes = true;
  D.world.sneakTrail = true;
  D.world.sneakWalkAmp = 0.05; // (a man walking his beat looks straight ahead: the brain sweeps his head only at a halt)
  D.world.sneakHaltExact = 0.4; // (and there his head is where his sweep puts it, ± 0.4 s)
  D.world.sneakPaths = true; // (each leg along the way the game's nav makes him take: Patrol 46 bends along the beach)
  watchCar(D);
  watchCarW(D);
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}


/** (the planners' pieces, for probes of the windows they find: not part of the run) */
export const PROBE = { fileClear, carAway, carGone, watchCar, watchCarW, inStrip, railFree, DASH, STAGING, LEE, driveLorry, board, crawlHop, slipOut, LORRY_UP, LORRY_DOWN, PARK, LEE_SAPPER, SAPPER_SEAT, TO_DECK };
