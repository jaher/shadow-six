/**
 * M7 "Chase of the Wolves" (Arendal harbour): a full stealth solution, played only with player orders (the driver,
 * tools/solutions/driver.mjs; the cone look-ahead of tools/solutions/sneak.mjs and gb-kit.mjs).
 *
 * Stage A: the two parties at once (D.parallel), as a player switches between them. West (the dock yard): the Spy
 * crawls into the walled corner by the inlet, takes the uniform off the line, injects gun 23's gunner and lays him below
 * the pit, holds patrol 14 while the Sapper crawls to the air-drop crate for the four charges, talks the yard's two
 * walkers (e15, e16: each sees the other's end of the yard) up one at a time, injects each from behind once let go and
 * hides them in the corner, and holds patrol 21 at the slipway while the Sapper and the Driver (through the gate the
 * moment the walkers are gone) crawl down the yard to the quay's edge below gun 23. East (the heights, the village wall, the beach): the Green Beret's decoy holds
 * the heights' sentries and patrol 3, a trail of prints takes e5 to it, the Green Beret knifes e4, e6 and (with the
 * Marine's harpoon) patrol 10, the Marine harpoons e11 from the water and takes the rowboat, and rows it round the
 * lighthouse to the pens' open water. B: the pick-up at gun 23, timed on patrol 12's turn at the lighthouse (the Spy
 * talks to e20 meanwhile). C: the Sapper sets both U-boats' charges from the rowboat. D: round the lighthouse to the red
 * buoy. Never seen; the blasts raise the one alarm (any explosion is heard by the village zone). Tuned in the real game
 * (tools/solutions/run-browser.mjs): the headless sim parts from it in the west yard (patrol 21's file, the pit's ring).
 */
import { CONFIG } from '../../src/config.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { DRESS } from '../../src/abilities/spy-actions.js';
import { sneak, routeClear, routeClearGen, teamBoat, wheeling } from './sneak.mjs';
import { stab, routeSafe, spotSafe, killSeen, predict as predictG, planned } from './gb-kit.mjs';

const DBG = !!(globalThis.process?.env?.M07DBG || globalThis.__M3DBG);
const dbg = (D, s) => { if (DBG || globalThis.__M3DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };
const CRAWL = CONFIG.units.crawl ?? 0.9, WALK = CONFIG.units.walk ?? 2.25;

/**
 * The way a man ordered from `from` to each of `pts` in turn really goes: each leg on the path the game finds for it,
 * and on to the next point as soon as he is within `tol` of this one.
 */
function wayOf(D, from, pts, { tol = 0.25, role = 'sapper', noLinks = false } = {}) {
  let at = from;
  const out = [];
  for (const [x, z] of pts) {
    const p = D.world.findPath(at[0], at[1], x, z, { role, noLinks }) || [{ x, z }];
    const last = p[p.length - 1], prev = p.length > 1 ? p[p.length - 2] : { x: at[0], z: at[1] };
    const dd = Math.hypot(last.x - prev.x, last.z - prev.z) || 1, f = Math.min(tol, dd) / dd;
    for (const n of p.slice(0, -1)) out.push([n.x, n.z]);
    at = [last.x - (last.x - prev.x) * f, last.z - (last.z - prev.z) * f];
    out.push(at);
  }
  return out;
}
const wayLen = (from, way) => way.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, from])[0];

/**
 * Wait (lying where he is) until the whole way along `pts` — the path the game will really take, at his pace — and
 * `hold` s lying at its end stay out of every cone (sneak.routeClear: posts by their sweep, walkers along their beats),
 * then go, leg by leg. mode 'crawl' (near bands only) or 'walk' (standing: both bands).
 */
async function timedRoute(D, role, pts, { mode = 'crawl', hold = 3, stand = 0, maxSec = 400, abort = null, label = `${role} route`, pad = 0.4, slack = 1.0, step = 0.5, keepWalker = 4, except = null, run = false } = {}) {
  const u = D.c(role), why = [], speed = mode === 'crawl' ? CRAWL : run ? (CONFIG.units.run?.[role] ?? CONFIG.units.run?.default ?? 4.5) : WALK;
  const end = pts[pts.length - 1];
  let next = -1, nd = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length && D.t > nd) { nd = D.t + 2; dbg(D, `${label}: ${why.slice(0, 3).join(' ')}`); }
    why.length = 0;
    const from = [u.x, u.z], way = wayOf(D, from, pts, { role });
    const len = wayLen(from, way), ex = except?.map((t) => D.get(t)).filter(Boolean);
    // (a man lying who sets off upright first gets up: stanceUp s, seen standing where he lies)
    const up = mode !== 'crawl' && u.stance !== 'stand' ? CONFIG.units.stanceUp : 0, d0 = 0.2 + up;
    return (!up || routeClear(D, [from], { mode, from, delay: 0.2 + up / 2, slack: up / 2 + slack, pad, why, keepWalker, except: ex }))
      && routeClear(D, way, { mode, from, speed, delay: d0, slack, step, pad, why, keepWalker, except: ex })
      && routeClear(D, [end], { mode, from: end, delay: d0 + len / speed + hold / 2, slack: hold / 2 + slack, pad, why, keepWalker, except: ex })
      // (`stand` s: then up on his feet there that long — both bands)
      && (!stand || routeClear(D, [end], { mode: 'walk', from: end, delay: d0 + len / speed + 0.6 + stand / 2, slack: stand / 2 + slack, pad, why, keepWalker, except: ex }));
  };
  // (`abort`: give up the wait — false — the moment it says so, e.g. where he lies is about to be looked at)
  let gaveUp = false;
  await D.until(() => (abort?.() ? (gaveUp = true) : ok()), maxSec, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  if (gaveUp) { dbg(D, `${label}: gave up`); return false; }
  await D.stance(role, mode === 'crawl' ? 'crawl' : 'stand');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.3, max: 90, run });
  return true;
}

/**
 * timedRoute for a whole errand: a list of segments, each {go: [[x, z]…], mode} (moved along on the game's path at the
 * pace of the mode: 'crawl', 'walk', 'run') or {stay: s, mode, act: async () => …} (an action there: he is seen in that
 * mode for `stay` s), checked in one go — the whole errand must stay out of every cone — then done segment by segment
 * (up to a segment marked `only: 'check'`: it and what follows are checked, the caller does them later).
 */
async function timedPlan(D, role, segs, { maxSec = 400, label = `${role} errand`, pad = 1.0, slack = [-0.6, 1.2], keepWalker = 4, except = [], hold = 2, abort = null, when = null, every = 0.25, lat = 0 } = {}) {
  const u = D.c(role), why = [];
  let next = -1, nd = 0;
  const speedOf = (m) => (m === 'crawl' ? CRAWL : m === 'run' ? (CONFIG.units.run?.[role] ?? CONFIG.units.run?.default ?? 4.5) : WALK);
  // (`segs` may be a list of alternative seg lists: the first one clear is taken)
  const alts = Array.isArray(segs[0]) ? segs : [segs], ways = new Map(); // (the paths, memoised while he lies still)
  let chosen = alts[0];
  // one check of every alternative, as a sliced job (the live replay hands the frame back between the cone tests:
  // driver runSliced); the alternatives share their first legs, each test is made once per check (`memo`)
  function* okGen() {
    if (why.length && D.t > nd) { nd = D.t + 2; dbg(D, `${label}: ${why.slice(0, 3).join(' ')}`); }
    why.length = 0;
    if (when && !when()) { why.push('when'); return false; }
    const memo = new Map();
    const safe = function* (key, pts, o) {
      if (memo.has(key)) return memo.get(key);
      const r = routeSafe(D, role, pts, o);
      memo.set(key, r);
      yield;
      return r;
    };
    for (const a of alts) if (yield* okSegs(a, safe)) { chosen = a; return true; }
    return false;
  }
  function* okSegs(segs, safe) {
    let at = [u.x, u.z], t = 0.2, low = u.stance === 'crawl';
    const o = { pad, why, slack, except, minDist: keepWalker, lat };
    const k = (tag) => `${tag}|${at[0].toFixed(2)},${at[1].toFixed(2)}|${t.toFixed(2)}|${low}`;
    for (const s of segs) {
      const m = s.mode ?? 'crawl', sl = m === 'crawl';
      // (a stance change on the spot: he is seen there as the higher of the two for that long)
      if (sl !== low) {
        const dt = sl ? CONFIG.units.stanceDown : CONFIG.units.stanceUp;
        if (!(yield* safe(k(`up${dt}`), [], { ...o, from: at, low: false, delay: t, hold: dt + 0.3 }))) return false;
        t += dt; low = sl;
      }
      if (s.go) {
        const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}>${s.go.join(';')}`;
        let way = ways.get(key);
        if (!way) ways.set(key, way = planned(D, role, s.go, at));
        const sp = s.speed ?? speedOf(m);
        if (!(yield* safe(k(`go${key}@${sp}`), way, { ...o, from: at, low, speed: sp, delay: t, expand: false }))) return false;
        t += wayLen(at, way) / sp; at = way[way.length - 1];
      } else if (s.stay || s.wait) {
        const d = s.stay || s.wait;
        if (!(yield* safe(k(`stay${d}`), [], { ...o, from: at, low, delay: t, hold: d }))) return false;
        t += d;
      }
    }
    return yield* safe(k(`hold${hold}`), [], { ...o, from: at, low, delay: t, hold });
  }
  const runJob = (g) => (D.runSliced ? D.runSliced(g) : Promise.resolve(runGen(g)));
  let gaveUp = false;
  await D.untilAsync(async () => {
    if (abort?.()) return (gaveUp = true);
    if (D.t < next) return false;
    next = D.t + every;
    return runJob(okGen());
  }, maxSec, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  if (gaveUp) { dbg(D, `${label}: gave up`); return false; }
  dbg(D, `${label}: go`);
  for (const s of chosen) {
    if (s.only === 'check') break; // (what follows is checked here, done by the caller later)
    const m = s.mode ?? 'crawl';
    await D.stance(role, m === 'crawl' ? 'crawl' : 'stand');
    if (s.go) for (const [x, z] of s.go) await goOn(D, role, x, z, { tol: 0.3, max: 90, run: m === 'run' });
    if (s.act) await s.act();
    if (s.wait) await D.wait(s.wait);
  }
  return true;
}

/** D.go, given again once or twice when the man stops short at once (a crawler's path round the gate's plinth is not
 * found on the very tick he lies down at the end of the last leg; a moment later it is) */
async function goOn(D, role, x, z, o) {
  for (let k = 0; ; k++) {
    try { return await D.go(role, x, z, o); } catch (e) {
      if (k >= 2 || !/stopped/.test(e.message)) throw e;
      await D.wait(0.5);
    }
  }
}

/** `fn` tried at most every `dt` s of game time (false in between): a player glances at the cones a few times a second */
function glance(D, fn, dt = 0.25) { let next = -1; return () => { if (D.t < next) return false; next = D.t + dt; return fn(); }; }

/** run a generator to its end (a sliced job, straight through) */
function runGen(g) { for (;;) { const r = g.next(); if (r.done) return r.value; } }

/** crawl to (x, z) on a space-time plan (sneak.mjs: he waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  await sneak(D, x, z, { mode: 'crawl', role, box: 6, crawlPad: 1, maxExpand: 60000, maxWait: 600, label: `${role} → (${x},${z})`, ...o });
}

// ------------------------------------------------------------------------------------------------- places
/** round the gate hut's E end to the foot of the wall beside the gate (only patrol 13 at its W stop looks there) */
const TO_GATE = [[27.5, 52.5], [30.4, 58], [29.8, 61.5]];
/** through gate_n (2 m) and W along the inside of the wall to the clothesline */
const GATE_IN = [[28.4, 66.2], [27, 67.6]];
const LINE_AT = [19.6, 66.8];
/** inside the gate along the wall into the walled corner by the inlet (the gap beside the gate hut), and out to the line */
const WEDGE_IN = [[22, 62], [20.3, 60.6], [17, 61.2]], WEDGE_OUT = [[20.3, 60.8], [20.2, 62.5], LINE_AT];
/** each one's first stop past the gate, crawling (the gateway itself is no place to stop: his body sticks there) */
const GATE_PAST = { spy: [26.5, 67.5], sapper: [29.6, 68.8], driver: [29.6, 68.8] };
/** patrol 14's E halt (it faces the cliff there) and where the Spy stands to chat its sergeant up: S of him, so he turns
 * S and his two men face him, their backs to the crate */
const P14_E = [36, 12], P14_TALK = [36.2, 13.6], P14_WAIT = [37, 22];
/** the Sapper's way to the air-drop crate (the game's path: W of the hangar, through the gap at its NW corner) and back */
const TO_CRATE = [[14.2, 5.6]];
/** e15's body: through the gap at the end of the lower wall into the walled corner by the inlet (mission navKeep), deep
 * in it; e15's N halt by the clothesline (he looks E there) and where the Spy waits for him, beside the gate */
const E15_CARRY = [[20.4, 62.5], [20.3, 60.6], [16.5, 61.4], [7, 63.5]], E15_N = [21, 69.5], E15_WAIT = [23.6, 68.6];
/** the Spy's walk down the yard to gun 23's pit (in uniform), and her way into it behind the gunner, and his body's place
 * in the pit's W side (out of everyone's sight under the sandbags) */
const SPY_TO_PIT = [[47.5, 131]], G23_BEHIND = [48.3, 136.2], G23_CARRY = [[48.4, 143.4]];
/** the Spy's walk to patrol 21's W halt (by the slipway), where she stands W of the sergeant */
const SPY_TO_P21 = [[12.5, 96.8], [11.6, 96.2]], P21_W = [14, 96];
/** the Sapper's and the Driver's crawl: in from the gate and down the yard's W side to the quay and gun 23 (the old marks) */
const YARD_IN = [[30, 77.5]], YARD_W = [[[26, 83], [20.5, 88], [18.2, 92.8], [18, 97.5]], [[16.5, 102], [15.5, 105.5], [17.5, 110.5], [18.6, 111.8]], [[21, 114.5], [22.6, 118.6], [23.2, 122.8]], [[30, 126.8], [36, 131], [41.5, 135]]];
/** out of gun 23's pit through the gap in its ring of sandbags and round its E side to the quay's edge (NE: the drawn
 * ring is closed elsewhere) — only if a man is still in the pit at the pick-up */
const PIT_OUT = [[47.8, 137.2], [48.3, 135.8], [50.8, 136.8], [51.2, 140.6], [49.6, 142.4]];
/** the yard's legs straight: to the foot of the crates, past the half-track to the quay, along it to gun 23 */
const YARD_S = [[19, 97.2], [18.6, 111.8], [23.2, 122.8], [41.5, 135]];
/** down the W side of gun 23's ring of sandbags to the quay's edge below the pit */
const PIT_THROUGH = [[43.2, 136.2], [42.8, 140.3], [43, 141.6]];
/** the first leg past the crates on their E side (e18's sweep reaches it), to their S foot behind patrol 21's backs */
const YARD_W1_E = [[26, 83], [21.8, 89], [21.4, 92.6], [20.9, 95.9], [19.0, 96.7]];
/** the Spy's walk from patrol 21's W stop down to stand W of e20's E stop (he faces her there, his back to the corner) */
const SPY_TO_E20 = [[28.4, 118.4]], BOAT_WAIT_S = [30, 178];
const BOAT_IN = [[48, 172], [54.5, 160], [50.5, 151], [43, 144.5]], BOAT_OUT = [[50.5, 151], [54.5, 160], [46, 168], [30, 178]];
const BOARD_AT = { sapper: [46.8, 144], driver: [45.6, 143.6], spy: [44.3, 142.8] };
/** the charges: U-boat 2's stern lies in the open water W of the pier (nobody sees the boat there, bar e20's glance
 * from his W halt); the boat lies off it, the Sapper steps onto its deck, crawls over the pier and gangway 1 onto U-boat
 * 1's after deck (the decks are out of every cone for a crawling man), plants, runs back over the gangway onto the
 * pier (a hull takes whoever is on it down with it), crawls back to U-boat 2's charge spot, plants and steps aboard */
const U1_AT = [10.4, 122.7], U2_AT = [2.6, 138.1], U2_LAND = [2.5, 141.5], BOAT_HIDE = [5.5, 152], BOAT_CLEAR = [9, 156];
/** home: back round the lighthouse mole's tip (S of patrol 12's beat) and E to the red buoy */
const ROW_HOME_WAIT = [[18, 178], [40, 188]], ROW_HOME = [[62, 191], [86, 191], [110, 185]], BUOY = [139, 180.5], BUOY_NEAR = [130.5, 181.6];
const GW1 = [[15, 136], [16.9, 132.6]], U1_WAIT = [14.4, 128.8], U1_CRAWL_OFF = [13.5, 127], U1_RUN_OFF = [[15, 136]];
/** the Spy's walk to e16's N halt and e16's body's way to the walled corner by the inlet */
const SPY_TO_E16 = [[26.8, 79.8]], E16_CARRY = [[21.5, 70.5], [20.4, 62.5], [20.3, 60.6], [16.5, 61.4], [10.5, 64.5]];
/** the heights: round the W end of the start rock to its S face, where the decoy goes (in earshot of e1, e2 and patrol
 * 3's E half: all three come and stare at it, their backs to the ridge) */
const ROCK_E = [[108.3, 27.4]], DECOY_AT = [108.6, 33.8], GB_BACK = [104.5, 24.8];
/** W along the foot of the N ridge and down its W end to the nook N of the wall's E stretch (nobody ever looks there) */
/** e4's post below the heights, the GB's way to it along the wall (behind him: he faces SSW down the gap) and where his
 * body goes: N up the side of the big house to the heights, where nobody looks now */
const E4_WAIT = [[84, 54], [94.5, 53.5]], E4_APPROACH = [[97.4, 61.2]], E4_CARRY = [[95, 61.5], [90, 61.5], [85, 61], [81.6, 60.1], [80.4, 59.7]];
/** through the gap round the end of the wall and SW down its E face to the ruins field */
const CORRIDOR = [[90.5, 67], [87.6, 72.4], [83, 77.2], [77.5, 83], [72, 88.5], [68.5, 93]];
/** e5's W halt in the gap's mouth (the corner run waits until he is not due there) */
const E5_HALT = [95, 71];
/** the lure: a walked trail from the gap's mouth up to the heights (prints), and the GB's crawl back to the nook */
const TRAIL_TO = [[81.8, 55], [88, 53.4]], TRAIL = [[91.5, 57], [93.5, 52], [97, 45.5], [99.4, 38.6]], TRAIL_BACK = [[93, 40], [86, 41], [80, 40.5]];
const CORRIDOR_RUN = [[86, 65.6], [89.5, 68.9], [87.8, 72.1], [83.5, 77]], CORRIDOR_END_MA = [79.4, 81.6], CORRIDOR_END_GB = [80.4, 79.9];
/** through the ruins field: the Marine to the W end of the beach, the GB behind the shed h_6 */
const RUINS_MA = [[76, 88], [86, 97], [95.4, 99.4]], RUINS_GB = [[92.5, 92], [93, 100], [96, 106]];
/** patrol 10's W halt on the beach and the GB's crawl from behind the shed to behind the trooper (a step E of the sergeant) */
const P10_W = [100.3, 117.9], P10_DIG_WAY = [[99, 112], [101.5, 117.5], [102.9, 120.3]], P10_HARPOON = [103, 110.9];
/** the Marine's crawl into the shallows W of the jetty, his shot at e11 from the water, the rowboat's side; the GB's
 * walk out along the jetty */
const MA_TO_SHALLOWS = [[105, 119], [107.8, 126.4]], E11_SHOT = [112.6, 126.3], BOAT_SIDE = [123.9, 130.6], BOAT_JETTY = [123.2, 126.4], GB_TO_JETTY = [[110, 121], [115.6, 121.6], [120.5, 125.5]];
/** the rowboat's way out of the marina, round the mole's tip (S of the lighthouse patrol's sight) to the pens' SW water */
const ROW_OUT = [[124.5, 150], [126, 170], [110, 185], [86, 191], [62, 191], [40, 188], [18, 178], [9, 166]];
/** e6's N halt (he looks N up the gap) and the GB's crawl to behind his left shoulder from the wall */
const E6_N = [91, 82], E6_APPROACH = [[86.5, 84.1], [89.9, 83]];
const RIDGE = [[98, 25.5], [83, 31.9], [76.5, 33.5], [72, 40], [82, 50.5]], NOOK_MA = [79.45, 60.6], NOOK_GB = [80.5, 59.3];

// ------------------------------------------------------------------------------------------------- checkpoints
/**
 * Every checkpoint, in play order (keyed by the errand that sets it). In stage A the two parties act at once, so their
 * checkpoints interleave: the walkthrough's steps follow this order, and tests/m07-solution.test.mjs checks that the
 * run keeps it.
 */
const CP = {
  C1: (D) => D.checkpoint('A1 GB leaves the decoy by the start rock'),
  C2: (D) => D.checkpoint('A2 decoy on: e1, e2 and patrol 3 stare at it'),
  A1: (D) => D.checkpoint('A3 Spy through the dockyard gate and into the walled corner by the inlet'),
  C3: (D) => D.checkpoint('A4 GB and Marine in the nook by the wall'),
  D1: (D) => D.checkpoint('A5 GB lays a trail of prints from the gap up to the decoy'),
  D2: (D) => D.checkpoint('A6 e5 follows the prints up to the decoy and stares at it'),
  E1: (D) => D.checkpoint('A7 GB knifes e4 and carries him into the nook'),
  F1: (D) => D.checkpoint('A8 Marine round the end of the wall'),
  F2: (D) => D.checkpoint('A9 GB round the end of the wall'),
  G1: (D) => D.checkpoint('A10 GB knifes e6 at the N end of his lane'),
  B1: (D) => D.checkpoint('A11 Spy at the clothesline'),
  B2: (D) => D.checkpoint('A12 Spy in uniform'),
  H1: (D) => D.checkpoint('A13 GB dug into the beach behind patrol 10\'s W halt'),
  H2: (D) => D.checkpoint('A14 GB knifes the rear man of patrol 10'),
  H3: (D) => D.checkpoint('A15 Marine harpoons the sergeant of patrol 10'),
  I1: (D) => D.checkpoint('A16 Marine harpoons e11 on the jetty from the water'),
  I2: (D) => D.checkpoint('A17 Marine takes the rowboat'),
  I3: (D) => D.checkpoint('A18 GB walks out along the jetty and steps into the rowboat'),
  J1: (D) => D.checkpoint('A19 the rowboat round the lighthouse'),
  J2: (D) => D.checkpoint('A20 the rowboat waits off the pens'),
  M1: (D) => D.checkpoint('A21 Spy injects the gunner of gun 23 and hides him below the pit'),
  B3: (D) => D.checkpoint('A22 Spy waits by patrol 14\'s east halt'),
  B4: (D) => D.checkpoint('A23 Spy talks to patrol 14'),
  B5: (D) => D.checkpoint('A24 Sapper takes the four charges'),
  B6: (D) => D.checkpoint('A25 Sapper back with the charges'),
  K1: (D) => D.checkpoint('A26 Spy talks e15 up, injects him and hides him in the walled corner'),
  L1: (D) => D.checkpoint('A27 Spy talks e16 up, injects him and hides him in the walled corner'),
  O1: (D) => D.checkpoint('A28 Sapper through the gate'),
  N1: (D) => D.checkpoint('A29 Spy talks to patrol 21 at its W end'),
  O3: (D) => D.checkpoint('A30 Driver through the gate'),
  O2: (D) => D.checkpoint('A31 Sapper down the yard to the quay\'s edge below the pit'),
  O4: (D) => D.checkpoint('A32 Driver down the yard to the quay\'s edge'),
  P1: (D) => D.checkpoint('B1 Spy leaves patrol 21 and waits by e20\'s E stop on the quay'),
  P2: (D) => D.checkpoint('B2 the rowboat picks the Sapper, the Driver and the Spy up at gun 23'),
  Q1: (D) => D.checkpoint('C1 Sapper on U-boat 1\'s after deck by the torpedoes'),
  Q2: (D) => D.checkpoint('C2 the charge on U-boat 1 set; the Sapper back on the pier'),
  Q3: (D) => D.checkpoint('C3 U-boat 1 goes down'),
  Q4: (D) => D.checkpoint('C4 the charge on U-boat 2 set'),
  Q5: (D) => D.checkpoint('C5 U-boat 2 goes down; the rowboat clear of the blast'),
  R1: (D) => D.checkpoint('D1 the rowboat round the lighthouse'),
  R2: (D) => D.checkpoint('D2 all five at the red buoy'),
};

// ------------------------------------------------------------------------------------------------- stages
/** squad men are kept this far off (their file wheels and shuffles at the halts more than predicted) */
function squadKeep(D, r = 18.5) { return Object.fromEntries(D.world.enemies.filter((e) => e.squad && e.alive).map((e) => [e.tag, r])); }

/** time (s from now) when patrol 10's sergeant will be `into` s into his W halt, or null within 70 s */
function p10HaltIn(D, into) {
  const e = D.get('p10a');
  for (let t = 0; t < 70; t += 0.1) { const q = predictG(e, t); if (q.wait && Math.hypot(q.x - P10_W[0], q.z - P10_W[1]) < 1.2 && q.into >= into) return t; }
  return null;
}

/** H: the GB (buried behind the W halt) and the Marine (behind the shed) take patrol 10 at its W halt */
async function patrol10(D, onKnifed = () => {}) {
  const gb = D.c('greenberet'), dv = D.c('diver'), a = D.get('p10a'), b = D.get('p10b');
  const R = CONFIG.abilities.rise, why = [];
  let nd = 0;
  await D.until(glance(D, () => {
    why.length = 0;
    const sRise = p10HaltIn(D, 1.0);
    if (sRise == null) return false;
    const way = planned(D, 'diver', [P10_HARPOON], [dv.x, dv.z]), tMa = wayLen([dv.x, dv.z], way) / CRAWL + 0.4;
    if (sRise < tMa + 0.5 || sRise > tMa + 2.5) return false; // (he sets off so as to lie there just before the GB rises)
    const victim = ['p10a', 'p10b'];
    const ok = routeSafe(D, 'diver', way, { from: [dv.x, dv.z], low: true, speed: CRAWL, delay: 0.3, hold: sRise - tMa + R + 2.2, expand: false, victim, why, pad: 1, minDist: 3, slack: [-0.6, 0.4] })
      // the GB rises (under the snow for `R` s) and stands there behind them
      && routeSafe(D, 'greenberet', [], { from: [gb.x, gb.z], low: false, delay: sRise + R, hold: 1.3, victim, why, pad: 0.6, minDist: 1, slack: [-0.2, 0.3] })
      // nobody sees either of them fall (the trooper ~2 s after the rise, the sergeant ~0.8 s later)
      && !killSeen(D, b, sRise + R + 1.1, { why, except: [], slack: [-0.3, 0.5] })
      && !killSeen(D, a, sRise + R + 1.6, { why, except: ['p10b'], slack: [-0.3, 0.5] });
    if (!ok && D.t > nd) { nd = D.t + 2; dbg(D, `patrol 10: ${why.slice(0, 3).join(' ')}`); }
    return ok;
  }), 600, 'patrol 10 at its W halt, the way clear').catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  await D.path('diver', [P10_HARPOON], { tol: 0.3, max: 30 });
  await D.until(() => { const q = predictG(a, 0); return q.wait && q.into >= 1.0; }, 15, 'the halt under way');
  D.ability('greenberet', 'shovel');
  await D.until(() => !gb.buried && !gb.currentAction, 4, 'GB out of the snow');
  D.ability('greenberet', 'knife', b);
  await D.until(() => !b.alive, 4, 'p10b knifed');
  onKnifed();
  D.ability('diver', 'harpoon', a);
  await D.until(() => !a.alive, 3, 'p10a harpooned');
  await D.idle('greenberet'); await D.idle('diver');
}

/** the nearest point within `r` m of (x, z) well inside shallow water (0.3 m of shallows all round) */
function shallowNear(D, x, z, r = 2) {
  const ok = (a, b) => { const g = D.world.groundAt(a, b); return g.shallow && !g.bridge; };
  let best = null, bd = Infinity;
  for (let dx = -r; dx <= r; dx += 0.1) for (let dz = -r; dz <= r; dz += 0.1) {
    const d = Math.hypot(dx, dz), px = x + dx, pz = z + dz;
    if (d > r || d >= bd || !ok(px, pz) || ![[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([a, b]) => ok(px + a, pz + b))) continue;
    best = [px, pz]; bd = d;
  }
  if (!best) throw new Error(`no shallows within ${r} m of (${x.toFixed(1)},${z.toFixed(1)})`);
  return best;
}

/**
 * The Spy (in uniform: nobody looks twice at her walking) walks along `approach`, gives `tag` the syringe and carries
 * him along `carry` — once the needle and the carry (suspicious acts: whoever sees them unmasks her) are out of every
 * cone, nobody sees him drop, and his body lies unseen at the end for `bodyFor` s. `at(T)`: where he will be (the
 * approach's end is worked out from it, `behind` m behind him) when she gets there in T s.
 */
async function spyKill(D, tag, { approach = [], behind = 0.9, carry = [], when = () => true, maxWait = 300, label = `Spy injects ${tag}`, pad = 1, bodyFor = 300, minDist = 2 } = {}) {
  const spy = D.c('spy'), e = D.get(tag), why = [];
  const INJ = (CONFIG.weapons?.syringe?.dur ?? 0.9) + 0.6, HIT = (CONFIG.weapons?.syringe?.hit ?? 0.5) + 0.3, PICK = (CONFIG.abilities?.carry?.pick ?? 1.0) + 0.3, DROP = (CONFIG.abilities?.carry?.drop ?? 0.8) + 0.3, CARRY_SPEED = 1.5;
  let plan = null, nd = 0, next = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25; // (a player glances at the cones a few times a second)
    why.length = 0;
    if (!when()) { why.push('when'); return false; }
    // where the victim will be when she reaches him (walking at her pace along the way to him)
    let T = 2, kill = null;
    for (let k = 0; k < 4; k++) {
      const q = predictG(e, T), h = q.hs[0] ?? e.heading;
      kill = [q.x - Math.cos(h) * behind, q.z - Math.sin(h) * behind];
      const way = planned(D, 'spy', [...approach, kill], [spy.x, spy.z]);
      T = wayLen([spy.x, spy.z], way) / WALK + 0.3;
    }
    const victim = predictG(e, T);
    // (everyone else for the whole act; the man himself only until the needle is in — he does not turn round dead)
    if (!routeSafe(D, 'spy', [], { from: kill, low: false, delay: T, hold: INJ, victim: tag, except: [tag], why, pad, minDist, slack: [-0.4, 0.6] })) return false;
    if (!routeSafe(D, 'spy', [], { from: kill, low: false, delay: T, hold: HIT, victim: tag, except: D.world.enemies.filter((o) => o !== e).map((o) => o.tag), why, pad: 0, minDist, slack: [-0.4, 0.3] })) return false;
    if (killSeen(D, e, T + 0.5, { why, slack: [-0.3, 0.6] })) return false;
    const body = [victim.x, victim.z];
    let tEnd = T + INJ, end = body;
    if (carry.length) {
      if (!routeSafe(D, 'spy', [], { from: body, low: false, delay: T + INJ, hold: PICK, except: [tag], why, pad, minDist })) return false;
      const way = planned(D, 'spy', carry, body);
      if (!routeSafe(D, 'spy', way, { from: body, low: false, speed: CARRY_SPEED, delay: T + INJ + PICK, hold: DROP, except: [tag], why, pad, minDist, expand: false })) return false;
      tEnd = T + INJ + PICK + wayLen(body, way) / CARRY_SPEED + DROP; end = carry[carry.length - 1];
    }
    if (!spotSafe(D, end[0], end[1], bodyFor, { except: [tag], delay: tEnd, why, body: true })) return false;
    plan = { kill, T };
    return true;
  };
  await D.until(() => { const r = ok(); if (!r && why.length && why[0] !== 'when' && D.t > nd) { nd = D.t + 3; dbg(D, `${label}: ${why.slice(0, 3).join(' ')}`); } return r; }, maxWait, label)
    .catch((err) => { throw new Error(`${err.message} [${why.slice(0, 3).join(' ')}]`); });
  await D.stance('spy', 'stand');
  for (const [x, z] of approach) await D.go('spy', x, z, { tol: 0.5, max: 60 });
  // (to the spot behind him first: the needle goes in from behind, out of his own cone too)
  try { await D.go('spy', plan.kill[0], plan.kill[1], { tol: 0.4, max: 20 }); } catch { /* close enough */ }
  D.ability('spy', 'syringe', e);
  await D.until(() => !e.alive, 15, `${tag} injected`);
  await D.idle('spy');
  if (carry.length) {
    D.ability('spy', 'hand', e);
    await D.until(() => spy.carrying === e, 8, `Spy shoulders ${tag}`);
    for (const [x, z] of carry) await D.go('spy', x, z, { tol: 0.5, max: 60 });
    D.ability('spy', 'drop');
    await D.until(() => !spy.carrying, 5, `${tag} put down`);
    await D.idle('spy');
  }
}

/**
 * The Spy (in uniform) walks up to `tag` and talks to him where he stands (`stand`: her spot beside him): he turns to her
 * and stays. The moment nobody else would see the needle, his fall, her carrying him along `carry` and his body there
 * for `bodyFor` s — taking him where he stands now, a metre either way — she lets him go, and as he turns back to his
 * beat she gives him the syringe from behind (a man who sees the needle coming unmasks her, even as he dies) and
 * carries him off. A player's way with two guards who watch each other: one held in talk, the needle when the other has
 * his back turned.
 */
async function talkKill(D, tag, { stand = null, carry = [], bodyFor = 300, maxWait = 300, when = () => true, label = `Spy talks ${tag} up and injects him`, pad = 1, minDist = 2, tries = 4 } = {}) {
  const spy = D.c('spy'), e = D.get(tag), why = [];
  const INJ = (CONFIG.weapons?.syringe?.dur ?? 0.9) + 0.6, PICK = (CONFIG.abilities?.carry?.pick ?? 1.0) + 0.3, DROP = (CONFIG.abilities?.carry?.drop ?? 0.8) + 0.3, CARRY_SPEED = 1.5;
  // (the needle within LET s of letting him go: he turns back to his beat and she steps behind him)
  const LET = 2;
  for (let k = 0; ; k++) {
    await D.stance('spy', 'stand');
    const at = stand ?? (() => { const d = Math.hypot(spy.x - e.x, spy.z - e.z) || 1; return [e.x + ((spy.x - e.x) / d) * 1.1, e.z + ((spy.z - e.z) / d) * 1.1]; })();
    try { await D.go('spy', at[0], at[1], { tol: 0.3, max: 20 }); } catch { /* close enough to talk */ }
    D.ability('spy', 'distract', e);
    await D.until(() => e.brain?.state === 'DISTRACTED', 10, `${tag} talked to`);
    let nd = 0, next = 0;
    // (where he stands, and a metre either way: he may turn back to his beat and take a step before the needle)
    const spots = () => [[e.x, e.z], [e.x + 0.6, e.z], [e.x - 0.6, e.z], [e.x, e.z + 0.6], [e.x, e.z - 0.6]];
    const ok = () => {
      if (D.t < next) return false;
      next = D.t + 0.25;
      why.length = 0;
      if (!when()) { why.push('when'); return false; }
      for (const p of spots()) {
        if (!routeSafe(D, 'spy', [], { from: p, low: false, delay: 0.3, hold: LET + INJ, except: [tag], why, pad, minDist, slack: [-0.3, 0.6] })) return false;
      }
      const body = [e.x, e.z];
      if (!routeSafe(D, 'spy', [], { from: body, low: false, delay: LET + INJ, hold: PICK + 0.6, except: [tag], why, pad, minDist })) return false;
      const way = planned(D, 'spy', carry, body);
      if (!routeSafe(D, 'spy', way, { from: body, low: false, speed: CARRY_SPEED, delay: LET + INJ + PICK, hold: DROP, except: [tag], why, pad, minDist, expand: false })) return false;
      const tEnd = LET + INJ + PICK + wayLen(body, way) / CARRY_SPEED + DROP, end = carry[carry.length - 1];
      return spotSafe(D, end[0], end[1], bodyFor, { except: [tag], delay: tEnd, why, body: true });
    };
    await D.until(() => { const r = ok(); if (!r && why.length && why[0] !== 'when' && D.t > nd) { nd = D.t + 3; dbg(D, `${label}: ${why.slice(0, 3).join(' ')}`); } return r; }, maxWait, label)
      .catch((err) => { throw new Error(`${err.message} [${why.slice(0, 3).join(' ')}]`); });
    // let him go: he turns back to his beat (back on it, his heading known again), and the needle goes in from behind
    D.order('spy', { type: 'stop' });
    await D.until(() => !e.alive || (e.brain?.state === 'IDLE' && !e.brain?.distractedBy), 4, `${tag} back on his beat`).catch(() => {});
    try {
      await spyKill(D, tag, { approach: [], carry, maxWait: 2.5, bodyFor, pad, minDist, label: `${label}: from behind` });
      return;
    } catch (err) {
      if (k + 1 >= tries || !e.alive) throw err;
      dbg(D, `${label}: no needle from behind (${err.message.slice(0, 80)}): talks to him again`);
    }
  }
}

/** the Marine rows the boat to (x, z) and it stops there */
async function rowTo(D, x, z, { max = 60, fast = false, through = 0, done = null } = {}) {
  const boat = teamBoat(D.world);
  D.order('diver', { type: 'move', x, z, run: fast });
  const t0 = D.t;
  // (`through` m: a mark on the way, passed without stopping — the next order is given that far from it; `done`: the
  // errand is over before he gets there — the game won as the boat comes within reach of the buoy)
  await D.until(() => done?.() || (through > 0 && Math.hypot(boat.x - x, boat.z - z) < through)
    || (Math.hypot(boat.x - x, boat.z - z) < 1.2 && (boat.speed || 0) < 0.15) || (D.t > t0 + 1 && !boat.goal && (boat.speed || 0) < 0.05), max, `boat → (${x},${z})`);
}

/**
 * Row along `pts` (through the marks, a stop at the last) once the whole way, at rowing pace, is out of every cone and
 * `keep` m clear of every patrol's file (it wheels and shuffles at its halts more than predicted): one look, then long
 * straight strokes — the planner's sneak clicked the boat on a few metres at a time.
 */
async function rowClear(D, pts, { label = 'row', maxSec = 600, speed = 3.0, keep = 30, except = [], when = () => true } = {}) {
  const boat = teamBoat(D.world), why = [];
  const files = () => D.world.enemies.filter((e) => e.squad && e.alive && !except.includes(e.tag));
  const clearOfFiles = () => {
    let [x, z] = [boat.x, boat.z], t = 0.5;
    for (const [px, pz] of pts) {
      const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 1; k <= n; k++) {
        const sx = x + ((px - x) * k) / n, sz = z + ((pz - z) * k) / n, st = t + (L * k) / n / speed;
        for (const e of files()) for (const dt of [-3, 0, 3, 6]) { const q = predictG(e, Math.max(0, st + dt)); if (Math.hypot(q.x - sx, q.z - sz) < keep) { why.push(`${e.tag} near (${sx.toFixed(0)},${sz.toFixed(0)})+${st.toFixed(0)}`); return false; } }
      }
      t += L / speed; x = px; z = pz;
    }
    return true;
  };
  function* ok() {
    why.length = 0;
    if (!when()) { why.push('when'); return false; }
    if (!clearOfFiles()) return false;
    yield;
    return yield* routeClearGen(D, pts, { mode: 'boat', from: [boat.x, boat.z], speed, delay: 0.5, slack: 1.5, slackRate: 0.06, pad: 0.5, keepWalker: 6, except: except.map((t) => D.get(t)).filter(Boolean), why });
  }
  const runJob = (g) => (D.runSliced ? D.runSliced(g) : Promise.resolve(runGen(g)));
  let next = -1, nd = 0;
  await D.untilAsync(async () => {
    if (D.t < next) return false;
    next = D.t + 0.5;
    const r = await runJob(ok());
    if (!r && why.length && why[0] !== 'when' && D.t > nd) { nd = D.t + 3; dbg(D, `${label}: ${why.slice(0, 3).join(' ')}`); }
    return r;
  }, maxSec, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  await rowPath(D, pts);
}

/** row along `pts`, through the marks without stopping, to a stop at the last one */
async function rowPath(D, pts, { fast = true, through = 2.5 } = {}) {
  const t0 = D.t;
  const boat = teamBoat(D.world);
  const can = (x, z) => !boat?.canDriveTo || boat.canDriveTo(x, z);
  for (const [i, [x, z]] of pts.entries()) {
    // (a stroke the boat cannot take in one — a boat moored in the way — is looked at first, as a player sees the
    // forbidden cursor, rather than ordered and refused: two strokes by a mark a few metres to one side, or else the
    // planner's cells)
    if (!can(x, z)) {
      const dx = x - boat.x, dz = z - boat.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      for (const [f, off] of [[0.5, 4], [0.5, -4], [0.4, 7], [0.4, -7], [0.6, 7], [0.6, -7], [0.5, 11], [0.5, -11]]) {
        const mx = boat.x + dx * f + nx * off, mz = boat.z + dz * f + nz * off;
        if (!can(mx, mz)) continue;
        dbg(D, `row: (${x},${z}) by a mark to one side (${mx.toFixed(1)},${mz.toFixed(1)})`);
        await rowTo(D, mx, mz, { fast, through });
        break;
      }
    }
    const straight = can(x, z);
    try {
      if (!straight) throw new Error('order refused (no straight stroke)');
      await rowTo(D, x, z, { fast, through: i < pts.length - 1 ? through : 0 });
    } catch (err) {
      if (!/order refused/.test(err.message)) throw err;
      dbg(D, `row: (${x},${z}) no straight stroke, on the planner's way`);
      await sneak(D, x, z, { mode: 'boat', box: 10, label: `boat → (${x},${z})`, maxWait: 600, keepFrom: squadKeep(D, 40) });
    }
    dbg(D, `row: (${x},${z}) +${(D.t - t0).toFixed(1)}`);
  }
}

/**
 * A pick-up: wait until the boat can row along `inWay` (from where it lies), lie at its end `hold` s while `men` (each
 * {role, at: [x, z]} — where he stands up beside the hull) get up and step in, and row out along `outWay`, all unseen;
 * then do it. The men's walks to the hull are short: each is checked standing at his spot for the whole hold.
 */
/**
 * The pick-up at gun 23's corner, timed on patrol 12. The moment its sergeant leaves the lighthouse stop to walk back N
 * (the cue), the channel mouth is behind the file: the boat sets off `after` s later, rows in past the bow of U-boat 1
 * and lies 3 m inside the quay's corner (the file sees that spot until 19.5 s); the men get up at `boardAt` s (the file
 * sees a man standing at the quay's edge until 21 s) and step in; the boat lies on there, out of every cone, until the
 * file has passed its N stop and walks S with its back to the channel mouth, and rows out at `outAt` s (out before
 * 42 s it would meet their eyes at the N stop, after 58 s the lighthouse stop's again). Measured on this map, rowing
 * through the marks: in 16.5 s, boarding 1.6 s, out 18.5 s. Everyone else (e20's glances over the quay, patrol 21 at
 * its E stop) is checked on the predictions for that schedule; a round that does not fit is let go.
 */
async function pickUp(D, inWay, outWay, men, { label = 'pick-up', after = 6.5, tIn = 16.5, boardAt = 24, outAt = 50, tOut = 18.5, maxSec = 900, trust = [], held = [], late = null } = {}) {
  const boat = teamBoat(D.world), why = [], p12a = D.get('p12a');
  const file = D.world.enemies.filter((e) => e.squad?.id === p12a.squad?.id);
  const atS = () => p12a.brain?.atWait && Math.hypot(p12a.x - 71, p12a.z - 165) < 1.5;
  const len = (from, pts) => pts.reduce((a, q) => [a[0] + Math.hypot(q[0] - a[1][0], q[1] - a[1][1]), q], [0, from])[0];
  const t0 = D.t, park = inWay[inWay.length - 1];
  let round = 0;
  for (;;) {
    if (D.t - t0 > maxSec) throw new Error(`${label}: no round of patrol 12 fits in ${maxSec} s [${why.slice(0, 3).join(' ')}]`);
    await D.until(atS, 120, `${label}: patrol 12 at the lighthouse`);
    await D.until(() => !atS(), 30, `${label}: patrol 12 turns back`);
    why.length = 0;
    // (e20 walks his beat 30 m off with the quay's corner and the channel mouth at the very edge of his cone, a degree
    // either way: the planner's half-metre slips on his pace have him see the boat on every round; in the game he does
    // not, on any of a dozen rounds probed — the boat is left out of his checks; the men getting up are not)
    const e20 = D.get('e20'), lone = e20 ? [e20] : [];
    const from = [boat.x, boat.z], o = { mode: 'boat', pad: 0.5, keepWalker: 6, why };
    // (here the planner's heads as the brain moves them: a man walking his beat looks straight ahead, ± 3°; a halted
    // man's where his sweep puts it, ± 0.4 s — e20 walks past the quay's corner well inside 30 m on every round)
    const w = D.world, keep = [w.sneakWalkAmp, w.sneakHaltExact];
    w.sneakWalkAmp = 0.05; w.sneakHaltExact = 0.4;
    const legs = [
      [inWay, { from, speed: len(from, inWay) / tIn, delay: after, slack: 1 }, file],
      [[park], { from: park, delay: (after + tIn + outAt) / 2, slack: (outAt - after - tIn) / 2 + 1 }, []],
      [outWay, { from: park, speed: len(park, outWay) / tOut, delay: outAt, slack: 1.5 }, []],
    ];
    // (`trust`: guards whose round the caller has set up to keep them off the corner on the first round — patrol 21,
    // let go a minute before: its file of five, two abreast, is modelled facing every way and would refuse it)
    const ex0 = [...(round++ === 0 ? trust : []), ...held];
    const ok = legs.every(([pts, x, ex]) => routeClear(D, pts, { ...o, ...x, except: [...ex, ...ex0] }))
      && men.every((m) => routeSafe(D, m.role, [], { from: m.at, low: false, delay: boardAt - 0.5, hold: 3, pad: 0.5, why, minDist: 3, except: [...file, ...held, ...ex0].map((e) => e.tag) }))
      && (!late || routeSafe(D, late.role, [], { from: late.at, low: false, delay: outAt - 5, hold: 5, pad: 0.5, why, minDist: 3, except: file.map((e) => e.tag) }));
    [w.sneakWalkAmp, w.sneakHaltExact] = keep;
    if (!ok) { dbg(D, `${label}: round let go: ${why.slice(0, 3).join(' ')}`); continue; }
    break;
  }
  const tc = D.t;
  await D.wait(Math.max(0, tc + after - D.t));
  await rowPath(D, inWay);
  dbg(D, `${label}: in at +${(D.t - tc).toFixed(1)} (planned ${(after + tIn).toFixed(1)})`);
  await D.wait(Math.max(0, tc + boardAt - D.t));
  for (const m of men) { D.ability(m.role, 'enterVehicle', boat); await D.wait(0.2); }
  await D.until(() => men.every((m) => D.c(m.role).vehicle === boat), 20, `${label}: all aboard`);
  dbg(D, `${label}: aboard at +${(D.t - tc).toFixed(1)} (planned ${(boardAt + 1.6).toFixed(1)})`);
  if (late) {
    // (the last man comes down from elsewhere and steps in just before the boat goes)
    await D.wait(Math.max(0, tc + late.goAt - D.t));
    late.go();
    const lu = D.c(late.role);
    await D.until(() => !lu.path && !lu.isMoving, 30, `${label}: ${late.role} at the corner`);
    D.ability(late.role, 'enterVehicle', boat);
    await D.until(() => lu.vehicle === boat, 15, `${label}: ${late.role} aboard`);
    dbg(D, `${label}: ${late.role} aboard at +${(D.t - tc).toFixed(1)} (out at ${outAt})`);
  }
  await D.wait(Math.max(0, tc + outAt - D.t));
  await rowPath(D, outWay);
  dbg(D, `${label}: out at +${(D.t - tc).toFixed(1)} (planned ${(outAt + tOut).toFixed(1)})`);
}

/** log the brain state of these guards (debug) */
function states(D, tags) { return tags.map((t) => { const e = D.get(t); return `${t}:${e?.brain?.state}${e?.brain?.phase ? '/' + e.brain.phase : ''}@${e?.x.toFixed(1)},${e?.z.toFixed(1)}h${Math.round(((e?.heading ?? 0) * 180 / Math.PI + 360) % 360)}`; }).join(' '); }

/** where the Sapper and the Driver lie just inside the gate, against the yard's NE wall, waiting for the way down the yard
 * (with the yard's two walkers gone nobody sees a man lying there: probed in the game over every guard's round) */
const YARD_WAIT = { sapper: [29.6, 73], driver: [31.6, 75.6] };

/** `r` crawls round the gate hut's annex, down its E side and through the gate, in one timed go (as the Spy did) — on
 * into the yard, or (`wait`) to his spot against the wall just inside, to wait there */
async function gateIn(D, r, { wait = false } = {}) {
  const u = D.c(r);
  await D.stance(r, 'crawl');
  const on = wait ? [GATE_PAST[r], YARD_WAIT[r]] : [GATE_PAST[r], ...YARD_IN];
  const alts = [0, 4, 8, 12, 16, 20, 24, 28].map((w) => [{ go: TO_GATE }, ...(w ? [{ wait: w }] : []), { go: on }]);
  // (patrol 13's file wheels every way at its W stop by the gate: it is kept 14 m off for the crawl round the hut)
  const p13 = D.get('p13a'), away = () => !p13?.alive || [0, 5, 10, 15, 20, 25, 30, 35].every((t) => { const q = predictG(p13, t); return Math.hypot(q.x - 34, q.z - 60) > 14; });
  await timedPlan(D, r, alts, { hold: 6, label: `${r} through the gate`, maxSec: 900, pad: 1.2, slack: [-0.8, 1.2], when: away });
}

/** `r` crawls down the yard's W side, past the half-track and along the quay, down the W side of gun 23's ring to his
 * spot at the quay's edge below it (the Sapper first, to the far one), leg by leg (nobody sees a man lying there) */
async function yardDown(D, r) {
  const [l1, l2, l3, l4] = YARD_W;
  // (to the foot of the crates, where nobody ever looks; then past e20's W halt and the half-track in one go between
  // two of his rounds, with a short wait in the half-track's shadow if that fits better; then along the quay)
  // (crates_1 stands 1.3 m nearer the slipway since the rails were cleared, and patrol 21's file stands round its W stop
  // as the drawn game puts it: past the crates on their W side or, when that is in sight, on their E side)
  // (each leg straight when that is clear — the game's own path, long and decisive — else round the crates and the
  // half-track by the old marks)
  await timedPlan(D, r, [[{ go: [YARD_S[0]] }], [{ go: l1 }], [{ go: YARD_W1_E }]], { hold: 20, label: `${r} down the yard 1`, maxSec: 600, keepWalker: 3 });
  // (straight on S is in e18's sweep: a bend W round its edge first, then straight past the half-track)
  const bend = [[16.5, 102], YARD_S[1]];
  const alts = [0, 2, 4, 6, 8, 10].flatMap((w) => { const W = w ? [{ wait: w }] : []; return [[{ go: [YARD_S[1]] }, ...W, { go: [YARD_S[2]] }], [{ go: bend }, ...W, { go: [YARD_S[2]] }], [{ go: bend }, ...W, { go: l3 }], [{ go: l2 }, ...W, { go: l3 }]]; });
  await timedPlan(D, r, alts, { hold: 10, label: `${r} down the yard 2`, maxSec: 600, keepWalker: 3 });
  await timedPlan(D, r, [[{ go: [YARD_S[3], ...PIT_THROUGH, BOARD_AT[r]] }], [{ go: [...l4, ...PIT_THROUGH, BOARD_AT[r]] }]], { hold: 10, label: `${r} down the yard 3`, maxSec: 600, keepWalker: 3 });
}

/** s from now until patrol 12's sergeant next leaves the lighthouse stop, at least `min` s away (null: not within 3 min) */
function nextLighthouseTurn(D, min = 0) {
  const e = D.get('p12a');
  if (!e?.alive) return null;
  let was = false;
  for (let t = 0; t < 180; t += 0.2) {
    const q = predictG(e, t), at = !!q.wait && Math.hypot(q.x - 71, q.z - 165) < 1.5;
    if (was && !at && t >= min) return t;
    was = at;
  }
  return null;
}


/** patrol 12's sergeant walks S along the mole (facing S) or stands at the lighthouse for the next `sec` s (+3 s for his file
 * trailing behind him) — or patrol 12 is no more */
function p12South(D, sec) {
  const e = D.get('p12a');
  if (!e?.alive) return true;
  for (let t = 0; t <= sec + 3; t += 0.5) {
    const q = predictG(e, t);
    const atS = !!q.wait && Math.hypot(q.x - 71, q.z - 165) < 3;
    if (!atS && !(q.hs.every((h) => Math.sin(h) > 0.3) && q.z > 141)) return false;
  }
  return true;
}

/** every man of `lead`'s file stays more than `r` m from (x, z) for the next `sec` s (or the file is no more) */
function fileAway(D, lead, x, z, r, sec) {
  const a = D.get(lead);
  if (!a?.alive || !a.squad) return true;
  const file = D.world.enemies.filter((e) => e.alive && e.squad?.id === a.squad.id);
  for (let t = 0; t <= sec; t += 1) for (const m of file) { const q = predictG(m, t); if (Math.hypot(q.x - x, q.z - z) <= r) return false; }
  return true;
}

/** until e20 walks off E from his W stop (from there he sees the water at U-boat 2's stern) */
async function e20Leaves(D) {
  const e = D.get('e20');
  if (!e?.alive) return;
  const atW = () => e.brain?.atWait && Math.hypot(e.x - 12, e.z - 110) < 1.5;
  await D.until(atW, 120, 'e20 at his W stop');
  await D.until(() => !atW(), 30, 'e20 walks off E');
}

/** The errands, each one party's (keyed by a letter of their own; stage A runs the west's and the east's side by side) */
export const ERRANDS = [
  ['A', 'Into the dock yard', async (D) => {
    // round the gate hut's annex and down its E side to the foot of the wall by the gate while patrol 13 is away E (from
    // its W stop it looks over the hut's E side and the gate), through the gate and along the inside of the wall into
    // the walled corner by the inlet (nobody's cone reaches in there), all crawling, in one timed go; she lies there
    // until the clothesline guards give her a moment (stage B)
    await D.stance('spy', 'crawl');
    // (through the gate in one leg to a spot past it: a crawler told to stop in the gateway itself, between its leaves
    // and piers, stops short and is stuck there)
    const alts = [0, 4, 8, 12, 16, 20].map((w) => [{ go: TO_GATE }, ...(w ? [{ wait: w }] : []), { go: [GATE_PAST.spy, ...WEDGE_IN] }]);
    await timedPlan(D, 'spy', alts, { hold: 2, label: 'spy into the walled corner', maxSec: 900 });
    CP.A1(D);
  }],
  ['C', 'The heights', async (D) => {
    const gb = D.c('greenberet');
    const L = ['e1', 'e2', 'p3a', 'p3b', 'e4'];
    // the GB walks round the E end of the start rock and leaves the decoy there, switched off, and crawls back (crawling
    // leaves no prints in the snow: his trail ends at the decoy, where whoever follows it will stand and stare anyway)
    await timedPlan(D, 'greenberet', [
      { go: [...ROCK_E, DECOY_AT], mode: 'walk' },
      { stay: CONFIG.abilities.decoyPlant + CONFIG.units.stanceUp + 0.3, mode: 'walk', act: async () => { D.ability('greenberet', 'decoyDrop'); await D.until(() => gb.decoy, 5, 'decoy down'); } },
      { go: [...ROCK_E, GB_BACK] },
    ], { hold: 2, label: 'gb leaves the decoy by the rock', maxSec: 400 });
    CP.C1(D);
    // decoy on: e1, e2 and patrol 3 come over and stare at it (by the rock's E end, their backs to the ridge)
    D.ability('greenberet', 'decoyToggle');
    let nl = 0;
    const lured = (t) => { const e = D.get(t); return !e.isMoving && !e.path && (e.brain.state === 'DECOY' || (e.brain.state === 'IDLE' && e.brain._leader?.()?.brain?.state === 'DECOY')); };
    await D.until(() => { if (D.t > nl) { nl = D.t + 10; dbg(D, states(D, L)); } return ['e1', 'e2', 'p3a', 'p3b'].every(lured); }, 200, 'e1, e2 and patrol 3 at the decoy');
    dbg(D, states(D, L));
    CP.C2(D);
    // (e10's E halt is just W of the nook's wall end: he is kept 11 m off)
    const keepFrom = { ...squadKeep(D), e10: 11 };
    for (const [x, z] of RIDGE) for (const r of ['diver', 'greenberet']) await crawl(D, r, x + (r === 'diver' ? 0 : 1.2), z + (r === 'diver' ? 0 : -0.4), { keepFrom, box: 8 });
    // the nook's N half shows through gate_ne to e10 on its E leg: from the ridge's foot the Marine crawls straight in
    // and tucks in deepest, the GB just N of him (both checked against e10's cone, e10 kept 11 m off the while)
    const e10 = D.get('e10');
    const e10Far = (x, z, sec) => () => { for (let t = 0; t <= sec; t += 1) { const q = predictG(e10, t); if (Math.hypot(q.x - x, q.z - z) < 11.5) return false; } return true; };
    await timedPlan(D, 'diver', [{ go: [NOOK_MA] }], { hold: 3, label: 'Marine into the nook', maxSec: 300, when: e10Far(...NOOK_MA, 16) });
    await timedPlan(D, 'greenberet', [{ go: [NOOK_GB] }], { hold: 3, label: 'GB into the nook', maxSec: 300, when: e10Far(...NOOK_GB, 16) });
    CP.C3(D);
    dbg(D, states(D, L));
  }],
  ['D', 'A trail for e5', async (D) => {
    // the walker e5 turns at the W end of his beat looking up the gap and the wall: the GB walks a trail of boot prints
    // from there up to the heights and on to the decoy (in the snow everybody follows prints), and crawls back to the
    // nook. e5 follows it at his next halt, hears the decoy and joins the men staring at it
    const gb = D.c('greenberet'), e5 = D.get('e5');
    // (when e5 has just left that halt: he finds the prints next time round, long after the GB has gone)
    const awayFor = (sec) => { for (let t = 0; t <= sec; t += 1) { const q = predictG(e5, t); if (q.wait && Math.hypot(q.x - E5_HALT[0], q.z - E5_HALT[1]) < 1.5) return false; } return true; };
    await timedPlan(D, 'greenberet', [{ go: [...TRAIL_TO, TRAIL[0]] }, { go: TRAIL.slice(1), mode: 'walk' }, { go: TRAIL_BACK }], { hold: 3, label: 'gb lays a trail for e5', maxSec: 600, pad: 1.5 });
    CP.D1(D);
    let nl = 0;
    await D.until(() => { if (D.t > nl) { nl = D.t + 3; dbg(D, states(D, ['e5', 'e6', 'e4'])); } return e5.brain.state === 'DECOY' && e5.brain.phase === 'stare'; }, 240, 'e5 follows the trail to the decoy');
    CP.D2(D);
  }],
  ['E', 'The gap below the heights', async (D) => {
    // the sentry e4 holds the gap between the wall and the big house: the GB crawls round behind him, knifes him and
    // carries him into the nook by the wall (only e5 ever looked there)
    for (const [x, z] of E4_WAIT) await crawl(D, 'greenberet', x, z, { box: 6, keepFrom: squadKeep(D) });
    await stab(D, 'e4', { approach: E4_APPROACH, carry: E4_CARRY, maxWait: 300 });
    CP.E1(D);
  }],
  ['F', 'Down the wall', async (D) => {
    // round the end of the wall and down its E face to the ruins field, each in one go while e6 looks away
    for (const r of ['diver', 'greenberet']) {
      const end = r === 'diver' ? CORRIDOR_END_MA : CORRIDOR_END_GB;
      await timedPlan(D, r, [{ go: [...CORRIDOR_RUN, end] }], { hold: 3, label: `${r} round the end of the wall`, maxSec: 400 });
      if (r === 'diver') CP.F1(D);
      else CP.F2(D);
    }
  }],
  ['G', 'The lane walker', async (D) => {
    // e6 walks the W side of the red house h_4 and halts at its N end looking up the gap: the GB crawls up behind him
    // from the wall and knifes him there (with e4 and e5 gone nobody looks at that lane)
    const e6 = D.get('e6');
    const halted = (t) => { const q = predictG(e6, t); return q.wait && Math.hypot(q.x - E6_N[0], q.z - E6_N[1]) < 1.2; };
    const gb = D.c('greenberet');
    const tIn = () => wayLen([gb.x, gb.z], planned(D, 'greenberet', E6_APPROACH)) / CRAWL + 0.4;
    await stab(D, 'e6', { approach: E6_APPROACH, maxWait: 300, bodyFor: 240, when: () => { const t = tIn(); return halted(t) && halted(t + 1.6); } });
    CP.G1(D);
  }],
  ['H', 'The beach patrol', async (D) => {
    // through the ruins (trodden ground: no prints) — the Marine to the W end of the beach, the GB on to the beach
    // behind patrol 10's W halt, where he digs himself into the snow while the patrol is down the far end
    const gb = D.c('greenberet');
    for (const [x, z] of RUINS_MA) await crawl(D, 'diver', x, z, { box: 6 });
    for (const [x, z] of RUINS_GB) await crawl(D, 'greenberet', x, z, { box: 6 });
    await timedPlan(D, 'greenberet', [
      { go: P10_DIG_WAY },
      { stay: CONFIG.abilities.dig + 0.6, mode: 'walk', act: async () => { D.ability('greenberet', 'shovel'); await D.until(() => gb.buried, 5, 'GB dug in'); } },
    ], { hold: 0, label: 'gb digs in behind the beach halt', maxSec: 400 });
    CP.H1(D);
    // patrol 10 halts at the W end of its beat looking W along the beach, the trooper a step behind the sergeant. The
    // Marine crawls round the shed to 8 m N of them (out of both their cones), the GB rises behind the trooper and
    // knifes him (he falls behind the sergeant's back), and the Marine's harpoon takes the sergeant a moment later
    await patrol10(D, () => CP.H2(D));
    CP.H3(D);
  }],
  ['I', 'The rowboat', async (D) => {
    // e11 watches the marina from the jetty with the rowboat at its tip. The Marine crawls down the beach into the
    // shallows, dives, and from the water W of the jetty (e11 looks out to sea) harpoons him
    const dv = D.c('diver'), gb = D.c('greenberet'), e11 = D.get('e11'), boat = teamBoat(D.world);
    // (down the beach into the shallows in one checked go, on the game's own path)
    await timedPlan(D, 'diver', [{ go: [MA_TO_SHALLOWS[MA_TO_SHALLOWS.length - 1]] }], { hold: 2, label: 'Marine into the shallows', maxSec: 300 });
    await D.go('diver', ...shallowNear(D, dv.x, dv.z, 3), { tol: 0.3, max: 10 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'Marine under water');
    D.order('diver', { type: 'move', x: E11_SHOT[0], z: E11_SHOT[1] });
    await D.until(() => !dv.path && !dv.isMoving, 60, 'Marine W of the jetty');
    const why = [];
    await D.until(glance(D, () => { why.length = 0; return !killSeen(D, e11, 0.4, { why }) && routeSafe(D, 'diver', [], { from: [dv.x, dv.z], low: false, delay: 0, hold: 0.8, victim: 'e11', why, pad: 0.5 }); }), 120, 'nobody looking at e11 or the water by him')
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('diver', 'harpoon', e11);
    await D.until(() => !e11.alive, 5, 'e11 harpooned');
    CP.I1(D);
    // under water to the rowboat, aboard, the diving gear off; the GB walks out along the jetty and steps in
    D.order('diver', { type: 'move', x: BOAT_SIDE[0], z: BOAT_SIDE[1] });
    await D.until(() => !dv.path && !dv.isMoving, 60, 'Marine by the rowboat');
    D.ability('diver', 'enterVehicle', boat);
    await D.until(() => dv.vehicle === boat, 10, 'Marine aboard');
    CP.I2(D);
    // (alongside the jetty's E face, where its deck is wide: the GB steps in from it)
    await rowTo(D, ...BOAT_JETTY);
    await D.stance('greenberet', 'stand');
    await D.path('greenberet', GB_TO_JETTY, { tol: 0.5 });
    D.ability('greenberet', 'enterVehicle', boat);
    await D.until(() => gb.vehicle === boat, 15, 'GB aboard');
    CP.I3(D);
  }],
  ['J', 'Round the lighthouse', async (D) => {
    // the Marine rows out of the marina and round the lighthouse mole's tip, timed on the patrol walking the mole, into
    // the open water SW of the pens, where nobody looks
    // (down the E side of the marina, clear of the boats moored off its mouth: a stroke the boat can take straight)
    await rowClear(D, ROW_OUT.slice(0, 4), { label: 'the rowboat out of the marina' });
    CP.J1(D);
    await rowClear(D, ROW_OUT.slice(4), { label: 'the rowboat to the pens\' open water' });
    CP.J2(D);
  }],
  ['B', 'The uniform and the charges', async (D) => {
    const spy = D.c('spy'), sap = D.c('sapper'), p14 = D.get('p14a');
    // from the corner out through the gap and up to the clothesline when e15 and e16 are both walking S, their backs to
    // it: she takes the uniform
    const TAKE = CONFIG.units.stanceUp + DRESS.take + DRESS.step[1] + 2.5;
    const take = async () => {
      CP.B1(D);
      D.ability('spy', 'use', D.item('uniform_line'));
      await D.until(() => spy.disguised && !spy.currentAction, 20, 'uniform on');
    };
    await timedPlan(D, 'spy', [{ go: WEDGE_OUT }, { stay: TAKE + 0.5, mode: 'walk', act: take }], { hold: 0, label: 'spy to the clothesline', maxSec: 900, pad: 0.3, slack: [-0.4, 0.8] });
    CP.B2(D);
  }],
  ['B2', 'The charges', async (D) => {
    const sap = D.c('sapper'), p14 = D.get('p14a');
    // in uniform nobody looks twice: back out through the gate and N past the hangar to patrol 14's E halt
    await D.stance('spy', 'stand');
    await D.path('spy', [[28.4, 66.2], P14_WAIT], { tol: 0.5 });
    CP.B3(D);
    // when the patrol halts at its E end (it looks at the cliff there), the Spy talks to its sergeant from the S: he
    // turns to the Spy and his two men turn to him — all three with their backs to the crate
    await D.until(() => p14.brain?.atWait && Math.hypot(p14.x - P14_E[0], p14.z - P14_E[1]) < 1, 200, 'patrol 14 at its E halt');
    D.ability('spy', 'distract', p14);
    await D.until(() => p14.brain.state === 'DISTRACTED', 10, 'p14 distracted');
    await D.wait(2); // (the file settles round him)
    CP.B4(D);
    // the Sapper walks round the W side of the hangar to the crate (the patrol looks at the Spy, its back to it), takes
    // the four charges and walks back — checked on the cones as they stand, before he sets off
    const takeCharges = async () => {
      D.ability('sapper', 'hand', D.item('drop'));
      await D.until(() => (sap.inventory?.get?.('timeBomb') ?? 0) >= 4, 15, 'charges taken');
      CP.B5(D);
    };
    // (crawling there and back: a man crawling leaves no prints in the snow for the patrol to follow when it walks on)
    await timedPlan(D, 'sapper', [{ go: TO_CRATE }, { stay: 2.5, mode: 'walk', act: takeCharges }, { go: [[15, 50]] }],
      { hold: 0, label: 'Sapper to the crate', maxSec: 120 });
    CP.B6(D);
  }],
  ['K', 'The clothesline guard', async (D) => {
    // e15 halts at the N end of his beat by the clothesline: the Spy (in uniform: nobody looks twice at her) waits by
    // the gate, walks up and talks to him there — he stands and looks at her — and when e16, who walks the yard beside
    // him and sees that corner whenever he faces N, has his back turned, she lets him go, gives him the syringe from
    // behind and carries him through the gap at the end of the lower wall deep into the walled corner by the inlet
    // (the two walk out of step: their beats line up for a needle there without the talk once in many minutes)
    await D.stance('spy', 'stand');
    const spy = D.c('spy');
    // (from patrol 14's halt back through the gate)
    await D.path('spy', spy.z < 62 ? [[28.6, 64.2], E15_WAIT] : [E15_WAIT], { tol: 0.5 });
    const e15 = D.get('e15'), e16 = D.get('e16');
    await D.until(() => { const q = predictG(e15, 0); return !!q.wait && Math.hypot(q.x - E15_N[0], q.z - E15_N[1]) < 1.2; }, 120, 'e15 at the N end of his beat');
    // (e16 on his beat: a man following prints in the snow is not where his beat would put him)
    // (she talks to him from the W: let go, he turns back E to finish his halt, his back to her)
    await talkKill(D, 'e15', { stand: [19.9, 69.4], carry: E15_CARRY, maxWait: 600, when: () => !e16?.alive || e16.brain?.state === 'IDLE' });
    CP.K1(D);
  }],
  ['L', 'The second walker', async (D) => {
    // e16 walks the yard from the gate hut's corner to the gantry: at the N end of his beat the Spy talks to him until
    // nobody looks that way, lets him go, gives him the syringe from behind and carries him to the walled corner by the
    // inlet, beside e15
    const e16 = D.get('e16');
    await D.path('spy', SPY_TO_E16, { tol: 0.6 });
    await D.until(() => { const q = predictG(e16, 0); return !!q.wait && Math.hypot(q.x - 25, q.z - 78) < 1.5; }, 120, 'e16 at the N end of his beat');
    // (bodyFor 30: the model gives patrol 21's troopers every heading at their W halt, and from there one would see the
    // corner 35 m off; in the game they face their sergeant, and nobody sees into the corner: probed over 600 s)
    // (from the S: let go, he turns back N to finish his halt, his back to her)
    await talkKill(D, 'e16', { stand: [25, 79.2], carry: E16_CARRY, maxWait: 600, bodyFor: 30 });
    CP.L1(D);
  }],
  ['M', 'Gun 23', async (D) => {
    // gun 23 at the quay's E corner covers the pens' channel: one shell would sink the rowboat. Straight after the
    // uniform the Spy walks down the yard to the gun pit, gives the gunner the syringe from behind and lays him at the
    // quay's edge below the pit (nobody sees there)
    await D.path('spy', SPY_TO_PIT, { tol: 0.6 });
    // (while patrol 12 walks S along the mole or stands at the lighthouse looking out to sea: walking N, and at its N stop
    // a few metres E of the pit, its file looks at the pit's W side and the quay below it; its troopers' turns at the
    // bend of its beat are not where the planner's look-ahead puts them)
    // (nor while patrol 21 comes to its E stop 11 m from the pit: its troopers wheel every way there)
    await spyKill(D, 'g23', { approach: [G23_BEHIND], behind: 0.9, carry: G23_CARRY, maxWait: 600, bodyFor: 600, when: () => p12South(D, 14) && fileAway(D, 'p21a', 47, 139, 17, 20) });
    CP.M1(D);
  }],
  ['N', 'Patrol 21', async (D) => {
    // the five-man patrol 21 sweeps the dock yard from the slipway to gun 23: the Spy waits at its W end and, when it
    // halts there, chats the sergeant up from the W — he looks W at her over the slipway, his four men look at him
    const spy = D.c('spy'), p21 = D.get('p21a');
    await D.path('spy', SPY_TO_P21, { tol: 0.6 });
    await D.until(() => p21.brain?.atWait && Math.hypot(p21.x - P21_W[0], p21.z - P21_W[1]) < 1.5, 300, 'patrol 21 at its W halt');
    D.ability('spy', 'distract', p21);
    await D.until(() => p21.brain.state === 'DISTRACTED', 10, 'p21 distracted');
    CP.N1(D);
  }],
  ['O1', 'Into the walled corner', async (D) => {
    // with the yard's two walkers gone, the Sapper and then the Driver crawl round the gate hut to the foot of the wall by
    // the gate (when patrol 13 has turned back E from its W halt), through the gate and along the inside of the wall into
    // the walled corner by the inlet, where they lie until the Spy holds patrol 21
    await gateIn(D, 'sapper', { wait: true });
    CP.O1(D);
    await gateIn(D, 'driver', { wait: true });
    CP.O3(D);
  }],
  ['O2', 'Across the dock yard', async (D) => {
    // out of the corner by the gap and down the yard's W side behind patrol 21's backs, past the half-track and the
    // crates on the quay to gun 23's pit, where the sandbags hide them
    await yardDown(D, 'sapper');
    CP.O2(D);
    await yardDown(D, 'driver');
    CP.O4(D);
  }],
  ['P', 'Pick-up at gun 23', async (D) => {
    // patrol 12 on the mole sees the pens' channel mouth for all but a short spell of its round: just after it turns back
    // N from the lighthouse, its back is to the channel for half a minute. While the Spy still holds patrol 21, the
    // Sapper and the Driver crawl out of the pit to the quay's edge (nobody sees a man lying there) and the Marine rows
    // round to the open water S of the pens. A minute before patrol 12's next turn she lets patrol 21 go (by the pick-up
    // it has been to its E stop and walks back W, its back to the corner) and walks down the quay to e20, who sees the
    // corner as he comes up to his E stop: she talks to him there, his back to it. On the cue the Marine rows in past
    // the dead gunner and lies in the corner; the Sapper and the Driver step in; she leaves e20 and steps in last, and
    // he rows out as patrol 12 walks S again, its back to the channel
    D.world.sneakFileHalt = true; // (patrol 12's file men look ahead as their sergeant does while they walk the mole)
    // (out through the ring's NE gap — patrol 21 looks in there from its E stop, but it is held at the far end)
    for (const r of ['driver', 'sapper']) {
      const u = D.c(r);
      if (Math.hypot(u.x - BOARD_AT[r][0], u.z - BOARD_AT[r][1]) > 1.5) await timedPlan(D, r, [{ go: [...PIT_OUT, BOARD_AT[r]] }], { hold: 10, label: `${r} to the quay's edge`, maxSec: 300 });
    }
    await rowClear(D, [BOAT_WAIT_S], { label: 'boat to the pens\' S water' });
    const file21 = D.world.enemies.filter((e) => e.squad?.id === D.get('p21a')?.squad?.id), e20 = D.get('e20');
    const cue = nextLighthouseTurn(D, 66);
    if (cue == null) throw new Error('patrol 12 not seen turning at the lighthouse');
    await D.wait(cue - 66);
    await D.path('spy', SPY_TO_E20, { tol: 0.4 });
    CP.P1(D);
    if (e20?.alive) {
      await D.until(() => e20.brain?.atWait && Math.hypot(e20.x - 30, e20.z - 118) < 1.5, 60, 'e20 at his E stop');
      D.ability('spy', 'distract', e20);
      await D.until(() => e20.brain.state === 'DISTRACTED', 10, 'e20 distracted');
    }
    // (she leaves him 33 s after the cue: he takes up his stop looking E again and walks back W, long after the boat)
    await pickUp(D, BOAT_IN, BOAT_OUT, [{ role: 'sapper', at: BOARD_AT.sapper }, { role: 'driver', at: BOARD_AT.driver }], {
      label: 'pick-up at gun 23', trust: file21, held: e20 ? [e20] : [],
      late: { role: 'spy', at: BOARD_AT.spy, goAt: 33, go: () => { D.order('spy', { type: 'move', x: BOARD_AT.spy[0], z: BOARD_AT.spy[1] }); } },
    });
    CP.P2(D);
  }],
  ['Q', 'The U-boats', async (D) => {
    const sap = D.c('sapper'), boat = teamBoat(D.world);
    const left = () => sap.inventory?.get?.('timeBomb') ?? 0;
    const plant = async () => {
      const n = left();
      D.ability('sapper', 'timeBomb');
      await D.until(() => left() === n - 1 && !sap.currentAction, 6, 'charge planted');
    };
    const rowed = !!sap.vehicle;
    if (rowed) {
      // round to the open water W of the pier; e20 sees U-boat 2's stern from his W stop, 33 m off, so the boat runs in
      // alongside as he walks off E from it, puts the Sapper on the deck and backs off out of the blasts' reach
      await rowClear(D, [BOAT_HIDE], { label: 'boat W of the pier' });
      await e20Leaves(D);
      await rowTo(D, ...U2_LAND, { fast: true });
      D.ability('sapper', 'leaveVehicle');
      await D.until(() => !sap.vehicle && !sap.currentAction, 10, 'Sapper on U-boat 2');
      await rowTo(D, ...BOAT_HIDE, { fast: true });
    }
    await D.stance('sapper', 'crawl');
    // (patrol 21's troopers wheel every way at its W stop by the slipway, 31 m from U-boat 1's after deck: not then)
    // (every man of the file, not only its sergeant: walking off E the troopers trail behind him, nearer the stop)
    const p21a = D.get('p21a'), file21 = D.world.enemies.filter((e) => e.alive && p21a?.squad && e.squad?.id === p21a.squad.id);
    // over the pier and gangway 1 onto U-boat 1's after deck, where he lies at its near end: nobody ever sees a man lying
    // there (probed in the game over every guard's round); further aft e20, halted at his W stop, sweeps the deck by the
    // torpedoes (13-17 m: his near band), and no one else sees a man lying anywhere on it
    // (over the pier and the metre-wide gangway on the game's own path, checked as one go)
    await timedPlan(D, 'sapper', [{ go: [GW1[0], U1_WAIT] }], { hold: 4, label: 'Sapper over gangway 1', maxSec: 300, pad: 0.8 });
    // (on the deck a crawler makes 0.65 m/s, and the run off with the getting up 3 m/s: measured)
    const errand = [{ stay: 1.2, act: plant }, { go: [U1_CRAWL_OFF], speed: 0.65 }, { go: U1_RUN_OFF, mode: 'run', speed: 3 }];
    // (never while e20 stands at his W stop with the Sapper aft of the deck's near end, nor in the 1.5 s either side)
    const e20 = D.get('e20');
    const e20Off = (a, b) => !e20?.alive || e20.brain?.state === 'DISTRACTED' || (() => { for (let t = Math.max(0, a - 1.5); t <= b + 1.5; t += 0.25) { const q = predictG(e20, t); if (q.wait && Math.hypot(q.x - 12, q.z - 110) < 2.5) return false; } return true; })();
    // (gun 22's gunner and e18 sweep the deck where he gets up on a fixed beat: their cones are known to the tick, so
    // the moment is taken on them exactly — the plant, the crawl off (5.5 s on the deck) and the first 2 s of the run
    // clear of both — and on the planner for everyone else)
    const sweeps = ['g22', 'e18'].map((t) => D.get(t)).filter((e) => e?.alive);
    const upAt = 6.7, upSpots = [U1_CRAWL_OFF, [U1_CRAWL_OFF[0] - 0.3, U1_CRAWL_OFF[1] - 0.3], [U1_CRAWL_OFF[0] + 0.6, U1_CRAWL_OFF[1] + 0.8], [14.8, 128.8]];
    const sweepsClear = (t0 = 0) => {
      // (up — 0.7 s — and 2 m on along the run, at 3 m/s: 1.4 s in sight of the deck aft of the conning tower)
      for (let t = t0 + upAt - 0.3; t <= t0 + upAt + 1.8; t += 0.1) {
        for (const e of sweeps) {
          const cone = coneAt(e, D.world.time + t);
          for (const [x, z] of upSpots) if (canSee(e, { x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, D.world, { cone }) !== 'none') return false;
        }
      }
      return true;
    };
    // (and no man of patrol 21 halted at either end of its beat while he is up and running: its troopers wheel every way
    // there, and from either stop a standing man on U-boat 1's after deck is just in their far sight)
    // (walking a leg of its beat the file never faces the deck; halted, turning at a stop or wheeling round the corner of
    // its beat it may: none of that from 3 s before he gets up to 6 s after)
    const p21Quiet = (t0 = 0, m0 = 3, m1 = 6) => file21.every((m) => { for (let t = t0 + upAt - m0; t <= t0 + upAt + m1; t += 0.5) { const q = predictG(m, t); if (q.wait || wheeling(m, t)) return false; } return true; });
    // the crawl aft to the torpedoes sets off when the moment he will be lying there (from `tDeck` s on) has a clear
    // stand-up within 8 s — e20 away from his W stop until he is off the deck — so the charge and the run off below find it
    // (aft along the deck he crawls at his usual pace: 7.8 s from the near end, measured)
    const tDeck = wayLen(U1_WAIT, planned(D, 'sapper', [U1_AT], U1_WAIT)) / CRAWL + 0.3;
    // (e20 kept off his W stop long enough for the worst case too: 14 s lying by the torpedoes, and the crawl back)
    const upSoon = () => {
      if (!e20Off(0, tDeck + 14 + tDeck + 1)) return false;
      // (the file's turn at its stop is a second or two off the prediction this far ahead: a wider margin here)
      for (let w = 0; w <= 8; w += 0.25) if (sweepsClear(tDeck + w) && p21Quiet(tDeck + w, 5, 8)) { dbg(D, `U-boat 1: up at +${(tDeck + w + upAt).toFixed(1)} (tDeck ${tDeck.toFixed(1)}, w ${w})`); return true; }
      return false;
    };
    let nw = 0;
    const plantWhen = () => { const a = sweepsClear(), b = p21Quiet(), c = e20Off(0, upAt + 4); if (!(a && b && c) && D.t > nw) { nw = D.t + 1; dbg(D, `U-boat 1 plant: sweeps ${a} p21 ${b} e20 ${c}`); } return a && b && c; };
    // (aft to the torpedoes when the moment to get up is near; there, the charge and the run off on the cones as they
    // turn; no such moment within 14 s after all — the predictions a little off — and he crawls back to the near end in
    // good time, before e20 is due at his W stop, and tries again)
    for (let k = 0; ; k++) {
      await timedPlan(D, 'sapper', [{ go: [U1_AT] }, { wait: 6, only: 'check' }, ...errand],
        { hold: 1, label: 'Sapper to U-boat 1\'s torpedoes', maxSec: 900, pad: 0.8, slack: [-0.7, 1.6], when: upSoon, lat: 0.5 });
      if (k === 0) CP.Q1(D);
      dbg(D, `U-boat 1 deck: ${states(D, ['p21a', 'p21b', 'p21c', 'p21d', 'p21e', 'e20', 'g22', 'e18'])}`);
      // (the moment itself on the three things that see that part of the deck — gun 22's sweep, patrol 21's stops, e20's
      // W stop — each known to the tick or nearly: probed in the game, nobody else sees a man there, lying or standing)
      const planted = await D.until(glance(D, plantWhen, 0.1), 14, 'Sapper plants on U-boat 1').then(() => true, (err) => { if (k >= 4 || !/timeout/.test(err.message)) throw err; return false; });
      if (planted) {
        dbg(D, 'U-boat 1: the charge');
        await plant();
        await D.stance('sapper', 'crawl');
        await goOn(D, 'sapper', ...U1_CRAWL_OFF, { tol: 0.3, max: 20 });
        await D.stance('sapper', 'stand');
        for (const [x, z] of U1_RUN_OFF) await goOn(D, 'sapper', x, z, { tol: 0.4, max: 20, run: true });
        break;
      }
      dbg(D, 'U-boat 1: no moment to get up, back to the near end');
      await D.go('sapper', ...U1_WAIT, { tol: 0.3, max: 30 });
    }
    await D.stance('sapper', 'crawl');
    CP.Q2(D);
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 15, 'U-boat 1 sinks');
    CP.Q3(D);
    await crawl(D, 'sapper', ...U2_AT, { box: 6 });
    if (rowed) {
      // the boat comes back alongside (e20 not glancing this way for the next 15 s), the Sapper plants, steps in, and the
      // Marine rows hard out of the blast
      const why = [];
      await D.until(glance(D, () => { why.length = 0; return routeClear(D, [U2_LAND], { mode: 'boat', from: U2_LAND, delay: 7, slack: 8, pad: 1, why }); }), 300, 'U-boat 2\'s stern unwatched')
        .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
      await rowTo(D, ...U2_LAND, { fast: true });
    }
    await plant();
    CP.Q4(D);
    if (!rowed) return;
    D.ability('sapper', 'enterVehicle', boat);
    await D.until(() => sap.vehicle === boat, 6, 'Sapper aboard');
    await rowTo(D, ...BOAT_HIDE, { fast: true });
    await rowTo(D, ...BOAT_CLEAR, { fast: true });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 15, 'U-boat 2 sinks');
    CP.Q5(D);
  }],
  ['R', 'The red buoy', async (D) => {
    // the Marine rows everyone back to the open water SW of the mole's tip; patrol 12, still on its round after the
    // blasts (its pace and turns a little off), sees the water S of the lighthouse while it walks S and stands there:
    // the moment it walks back N with its back to the sea, he rows hard round the tip and E to the red buoy
    await rowClear(D, ROW_HOME_WAIT, { label: 'back to the pens\' open water' });
    const p12a = D.get('p12a'), file = D.world.enemies.filter((e) => e.squad?.id === p12a?.squad?.id), why = [];
    // (all three turned N and a few metres up the mole: some 25 s of walking N before the file turns at its N stop)
    const north = () => !p12a?.alive || (p12a.brain?.state === 'IDLE' && p12a.z < 162 && p12a.z > 150
      && file.every((e) => !e.alive || (!e.brain?.atWait && Math.sin(e.heading) < -0.7)));
    await D.until(glance(D, () => { why.length = 0; return north() && routeClear(D, ROW_HOME, { mode: 'boat', from: [teamBoat(D.world).x, teamBoat(D.world).z], speed: 2.9, delay: 0.5, slack: 1.5, pad: 0.5, keepWalker: 6, except: file, why }); }), 600, 'patrol 12 walking N, its back to the sea')
      .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
    await rowPath(D, ROW_HOME.slice(0, 2));
    CP.R1(D);
    await rowPath(D, ROW_HOME.slice(2, 3));
    // (the last stretch round the moored boats off the marina's mouth: the planner's way, to a little short of the
    // pick-up's reach; then straight on until the boat is within it — the mission is won there, the solution ends there)
    const o3 = () => !!D.world.objectives.find((o) => o.id === 'o3')?.done;
    await sneak(D, ...BUOY_NEAR, { mode: 'boat', box: 10, label: 'to the red buoy', maxWait: 300, keepFrom: squadKeep(D, 40) });
    if (!o3()) await rowTo(D, ...BUOY, { fast: true, done: o3 });
    await D.until(o3, 30, 'everyone out at the buoy');
    CP.R2(D);
  }],
];

/** Stage A's two parties: the west one (the Spy, the Sapper, the Driver: the dock yard) and the east one (the Green Beret
 * and the Marine: the heights, the village wall, the beach and the rowboat), each doing its errands in this order */
const WEST = ['A', 'B', 'M', 'B2', 'K', 'L', 'N'], EAST = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const errand = (id) => ERRANDS.find((e) => e[0] === id)[2];

export const STAGES = [
  ['A', 'Two parties at once', async (D) => {
    // the west party slips into the dock yard: the Spy takes the uniform, silences gun 23, holds patrol 14 while the
    // Sapper takes the charges, clears the yard's two walkers and holds patrol 21 while the Sapper and the Driver (just
    // inside the gate by then) crawl down to the quay's edge below gun 23. The east party crosses the heights, the village wall and the
    // beach, takes the rowboat and rows round the lighthouse to the pens' open water. All at once, as a player switches
    // between them: one man's waits are another's time to act (D.parallel — the world steps once every flow has given
    // its orders for the tick)
    const done = new Set();
    const run = (ids) => async () => { for (const id of ids) { await errand(id)(D); done.add(id); } };
    const crawlers = async () => {
      // (once the yard's two walkers are gone: their crawl round the gate hut fills the Spy's wait for patrol 21)
      await D.until(() => done.has('L'), 3000, 'the yard\'s two walkers gone');
      await errand('O1')(D);
      await D.until(() => done.has('N'), 3000, 'patrol 21 held');
      await errand('O2')(D);
    };
    await D.parallel(run(WEST), crawlers, run(EAST));
  }],
  ['B', 'Pick-up at gun 23', (D) => errand('P')(D)],
  ['C', 'The U-boats', (D) => errand('Q')(D)],
  ['D', 'The red buoy', (D) => errand('R')(D)],
];

export async function solve(D, ctx = {}) {
  // (sneak legs in long straight dashes, each re-checked unseen — user 2026-10-22 "more straight and decisive" — with
  // half a metre more round every point of a leg than the plan's own cells: no lying man grazes the edge of a near band)
  D.straightDashes = { pad: 0.5 };
  const at = (id) => STAGES.findIndex((s) => s[0] === id);
  for (const [k, [id, title, fn]] of STAGES.entries()) {
    if (ctx.from && k < at(ctx.from)) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && k >= at(ctx.until)) break;
  }
  return D.checkpoints;
}
