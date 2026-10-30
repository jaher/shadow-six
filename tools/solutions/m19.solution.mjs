/**
 * M19 "Frustrate Retaliation" (Oldenburg): a full stealth solution, played only with player orders (the driver,
 * tools/solutions/driver.mjs; the space-time sneak planner, tools/solutions/sneak.mjs).
 *
 * The rockets stand inside an opaque plank palisade that a rifle round (and any bullet at a barrel) goes through. The
 * plan: never cross the N bank's guard posts at all — the team crawls along the map's N edge to the river mouth (A, B),
 * the Marine swims under the current to the moored rowboat and ferries the others across in one turn of patrol pn4's
 * beat (C). From the base's N shore (nobody inside sees out) the Sniper drops the shore guard e51 and the Green Beret
 * leaves his decoy outside the fence's NE corner, in earshot of the post e33 only (D). From the gap behind the boiler
 * house (out of reach of the patrol across the river) the Sniper shoots the rocket walker e31 and the caged dog d3
 * through the planks (E). The Green Beret climbs in by the
 * conveyor switch on his feet, timed while the base lorry stands by the post e27 and between two swings of e28's head;
 * he knifes the sentry e24 from behind (no getting round the drum stack under his sweeping head) and carries him into
 * the gap behind the drums, then goes N along the W fence (F). With the decoy on (e33 turned round to it), the Sniper
 * drops e32 by the middle rocket and the Green Beret lays a barrel over the body (it hides him and serves that rocket),
 * carries one barrel beside the W rocket and one to the E rocket (G), and leaves the way he came (H). All four step
 * into the boat; the Sniper fires both barrels from his seat: the blasts take all three rockets and sound the siren (the
 * base hears explosions within 25 m: the one forced alarm), and the boat goes out downstream by the N edge (I).
 *
 * Kills (all silent, bodies never found): e51, e31, d3, e24 (knife, hidden), e32 (under a barrel). Sniper rounds: 6 of
 * 7. Items: decoy, rowboat, two barrels moved plus the pile.
 */
import { ABILITIES as ABIL } from '../../src/abilities/registry.js';
import { CONFIG } from '../../src/config.js';
import { CLIMB_TURN } from '../../src/entities/unit.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { sneak, clearFor, routeClear, unwitnessed, bodySeen, predict, teamBoat, viewersOf, walking, walkerSees, staticSees, dummyAt } from './sneak.mjs';
import { mirrorOf, ghostOn } from './ghost.mjs';

const DBG = !!(globalThis.process?.env?.M19DBG || globalThis.__M3DBG);
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };

/** crawl to (x, z) on a space-time plan (waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  await cautious(D, () => sneak(D, x, z, { mode: 'crawl', role, box: 8, label: `${role} → (${x},${z})`, ...o }));
}

/** run `fn` with the planners' cautious walker model (a walker turning onto a new leg sweeps his eyes across) */
async function cautious(D, fn) {
  const w = D.world, prev = [w.sneakTurns, w.sneakHeel, w.sneakTurnTie];
  w.sneakTurns = true; w.sneakHeel = true; // (and a dog at heel is predicted behind its handler)
  w.sneakTurnTie = 0.02; // (a body turns the short way round: both ways only for a dead-even about-turn — e25 turns
  // through the west at the N end of his beat, 2° short of an about-turn)
  try { return await fn(); } finally { [w.sneakTurns, w.sneakHeel, w.sneakTurnTie] = prev; }
}

/**
 * run `fn` with halted men's heads where their sweep puts them, ± `slack` s (sneak.mjs `sneakHaltExact`): a halted
 * walker's cone narrows in range as his head swings out, so the fixed ±25°/±50° heads miss a man at the very edge of
 * the swing (e32 at the N end of his beat saw the Green Beret 12 m off at 20° of swing)
 */
async function exact(D, fn, slack = 0.5) {
  const w = D.world, prev = w.sneakHaltExact;
  w.sneakHaltExact = slack;
  try { return await fn(); } finally { w.sneakHaltExact = prev; }
}

/** where the Marine rows to pick the others up (the current then sets the boat at the corner CORNER), and the mooring */
/** where the four lie at the bank's tip: the one corner nobody on the N bank ever sees a prone man in (pn4's halt at
 * (94,15.5) is 21 m off) */
const TIP = [['diver', 110.5, 1.5], ['greenberet', 109.5, 0.5], ['sniper', 108.5, 1.5], ['sapper', 107.5, 0.5]];
const CORNER = [114.8, 0.3]
/** once the Marine is off, the three lie as near the corner as they can: the field walker e39 is out of range there */
const TIP_E = [['greenberet', 111.6, 0.5], ['sapper', 110.5, 1.6], ['sniper', 109.5, 0.5]];
/** where the four step up onto the bank after leaving the moored boat (they get out into the shallows) */
const EXIT_LAND = [['diver', 127.6, 18.4], ['greenberet', 128.9, 17.9], ['sniper', 126.3, 19.3], ['sapper', 129.9, 17.2]];
/** where the four lie on the base's shore (nobody sees a prone man there); the Sniper's is unseen standing too */
/** the decoy's spot, outside the fence's NE corner (e33 hears it through the planks; nobody else is in earshot) */
const DECOY = [150.5, 29];
/** where barrel_4 goes: 4.5 m from the E rocket, on its own (barrel_1 by the W rocket chains with the pile by v2_m) */
const V2E_AT = [141, 42.5];
/** prone hiding spots inside the base, W and E of the barrel pile (nobody looks there once e31 is gone and e33 turned) */
const HIDE_W = [116.5, 38.5], HIDE_E = [139.5, 38.5];
/** where e32 halts at the N end of his beat (facing W) */
const E32_AT = [128.45, 41.3];
/** the switch climb's ends (climb_switch), the hollow outside it that the yard walker e20 never sees, the gap between
 * the palisade and the drum stack inside (nobody sees into it), and the Sniper's spot on the W strip for e24 */
const CLIMB_OUT = [97.5, 65.5], CLIMB_IN = [100.5, 65.5], HOLLOW = [97.4, 63.4], POCKET = [99.75, 61.3];
/** out of the gap round the stack's NE corner (hugging it: e24's sweep stops just short) and S along its E side, on to
 * a spot by the tall house nobody sees */
/** the narrow way between the boiler house and the palisade outside the base (the boiler house's walls in the game
 * stand out to x 101–103.5 north of z 50: the middle of the gap) */
const BOILER_GAP = [103, 50.5];
/** the Sniper's spot for e31 and the caged dog, at the gap's S end: beyond the reach of patrol pn4 across the river */
const SNIPE_W = [101.8, 55];
/** on S from there between the boiler house's SE corner and the palisade's bend: a passage under a metre wide in places
 * (too narrow for the planner's 1 m cells: crawled point to point) down to the hollow below the switch climb */
const CORRIDOR = [[101.5, 54], [100.75, 57.25], [100.25, 58.1], [99.4, 58.6], [98.2, 60.5]];
/** the foot of the drum stack's S end (nobody sees it) */
const BELOW_STACK = [102, 58.3];
/** out of the gap, round the drum stack's corner and N along its E side a metre off it — in short legs: the game's path
 * for one long leg swings out a metre further, into e28's near band at the far end of the base; past the stack's N
 * corner a lying man swings out round it anyway: timed on e28's sweep — and on N inside the W fence */
const POCKET_OUT = [[99.6, 64.6], [102.1, 65.4], [104.3, 65.3], [104.3, 64.5], [104.3, 63.5], [104.3, 62.5], [104.3, 61.5], [104.3, 60.5],
  [104.3, 59.9], [104.75, 59.2], [104.6, 58.4], [104.3, 57.5], [104.5, 56.5], [104.8, 55.3], [107.5, 50.5]];
/** past the drum stack's N corner a lying man is a few tenths of a metre inside e28's near band at the far end of the
 * base — and only while e28's head passes straight ahead (his elliptical cone reaches 18 m only there: a tenth of a second
 * twice per sweep). The way there is timed to those instants with a small pad (a wider one covers the whole corner for
 * longer than the gaps between them, and with the walker e25's window on top no start would ever do) */
const HOT_CORNER = { at: [104.7, 59], r: 1.2, pad: 0.2, slack: 0.15, wait: 1.6, guard: 'e28', label: 'the corner under e28' };
/** on up the inside of the W fence, out of the walker e25's near band wherever he is on his beat (he sees the foot of the
 * fence's straight stretch from the N end of it) */
const OUT_OF_E25 = [108.6, 47.3];
/** the four's spots at the water's edge by the moored boat, for the last boarding (nobody sees a prone man there) */
const WATERLINE = [['diver', 127, 19.3], ['greenberet', 125.5, 20.2], ['sniper', 128.5, 18.3], ['sapper', 130, 17.3]];
/** the men on the N bank in sight of the river mouth (patrol pn4 and its dog, the walker e39, patrol pn3) */
const ACROSS = ['e44', 'e45', 'e46', 'e47', 'd2', 'e39', 'e41', 'e42', 'e43'];
/** patrol pn4 and its dog: a crawler keeps out of their near band whichever way they face (sneak `keepFrom`) */
const PN4_KEEP = { e44: 21, e45: 21, e46: 21, e47: 21, d2: 21 };
/** along the map edge past the gap between the start mound and the rock N of the field, to beyond the rock */
const EDGE_GAP = [[47, 0.9], [50, 0.9], [56.5, 0.9], [59, 2.6]];
const SHORE = [['sniper', 126, 28], ['diver', 130.5, 20.5], ['sapper', 128, 21.5], ['greenberet', 121.5, 22.5]], BOAT_AT = [127.5, 17];

/**
 * The way a man ordered from `from` to each of `pts` in turn really goes: each leg on the path the game finds for it
 * (`noLinks`: carrying, no climbing), and on to the next point as soon as he is within `tol` of this one. (Measured on
 * crawls: within a few hundredths of a second of the real thing after the first leg, which starts up to 0.3 s late.)
 */
function wayOf(D, from, pts, { tol = 0.25, noLinks = false, role = 'greenberet' } = {}) {
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
 * The stretch of a crawl `way` (from `from` at `speed`, setting off in `delay` s) within `hot.r` of `hot.at`, checked again
 * with a pad of `hot.pad`: where a man lying swings out round a corner the game's path does not show, at the very edge
 * of somebody's near band (e28 past the drum stack's N corner: the band reaches out there only while his head passes
 * straight ahead, a tenth of a second at a time — a wider pad catches it).
 */
function hotClear(D, from, way, speed, delay, slack, hot, why = null) {
  let a = from, t = delay;
  for (const p of way) {
    const L = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (Math.hypot(p[0] - hot.at[0], p[1] - hot.at[1]) <= hot.r || Math.hypot(a[0] - hot.at[0], a[1] - hot.at[1]) <= hot.r) {
      if (!routeClear(D, [p], { mode: 'crawl', from: a, speed, delay: t, slack: hot.slack ?? slack, step: 0.25, pad: hot.pad, why })) return false;
    }
    t += L / speed; a = p;
  }
  return true;
}

/**
 * `role` crawls along `pts` from where he lies, in one go, once nobody will see him on the way nor lying at its end for
 * `hold` s. (`then`: the next leg, to be crawled after a wait of up to `thenWait` s at the end of this one, checked too with
 * every guard but `thenExcept`: he will time that leg on them himself)
 */
async function crawlRoute(D, role, pts, { hold = 4, maxSec = 400, label = 'crawl', pad = 0.4, slack = 1.2, step = 0.5, then = null, thenWait = 5, thenExcept = [], shift = null, hot = null, sync = null } = {}) {
  const u = D.c(role), why = [], TOL = 0.25, speed = CONFIG.units.crawl ?? 0.9;
  const end = pts[pts.length - 1];
  const model = (from, ps = pts) => wayOf(D, from, ps, { tol: TOL, role }); // (the way he really crawls)
  // (`sync` k: the `hot` stretch is timed afresh at pts[k], where he may lie up to `hot.wait` s for it — over a long crawl
  // the planned arrival drifts by more than the gaps in the hot guard's sweep; the rest of the way is checked for every
  // start in that wait — by all but the hot guard `hot.guard`, timed there and then)
  const k = sync ?? -1, hw = k >= 0 ? hot.wait ?? 1.6 : 0;
  let next = -1, nd = 0, len = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length && D.t > nd) { nd = D.t + 1; dbg(D, `${label}: ${why.slice(0, 2).join(' ')}`); }
    why.length = 0;
    const from = [u.x, u.z];
    const way = model(from, k >= 0 ? pts.slice(0, k + 1) : pts);
    len = wayLen(from, way);
    // (`shift` [dx, dz]: the way checked that far aside too — a man crawling past a corner swings out round it)
    const first = routeClear(D, way, { mode: 'crawl', from, speed, delay: 0.15, slack, step, pad, why })
      && (!shift || routeClear(D, way.map(([x, z]) => [x + shift[0], z + shift[1]]), { mode: 'crawl', from: [u.x + shift[0], u.z + shift[1]], speed, delay: 0.15, slack, step, pad, why }))
      && (k >= 0 || !hot || hotClear(D, from, way, speed, 0.15, slack, hot, why));
    if (!first) return false;
    if (k >= 0) {
      const at = pts[k], rest = model(at, pts.slice(k + 1)), t1 = len / speed + 0.15;
      if (!routeClear(D, [at], { mode: 'crawl', from: at, delay: t1 + hw / 2, slack: hw / 2 + slack, pad, why })
        || !routeClear(D, rest, { mode: 'crawl', from: at, speed, delay: t1 + hw / 2, slack: hw / 2 + slack, step, pad, why, except: [D.get(hot.guard)] })) return false;
      len += wayLen(at, rest);
    }
    return routeClear(D, [end], { mode: 'crawl', from: end, delay: len / speed + hw / 2 + hold / 2, slack: hold / 2 + hw / 2 + 1, pad, why })
      && (!then || routeClear(D, then, { mode: 'crawl', from: end, speed, delay: len / speed + hw / 2 + thenWait / 2, slack: thenWait / 2 + hw / 2 + 1, step, pad, why, except: thenExcept.map((t) => D.get(t)) }));
  };
  await cautious(D, () => D.until(ok, maxSec, `${label} clear`)).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  await D.stance(role, 'crawl');
  const t0 = D.t, arr = [], plan = [];
  if (globalThis.__M3DBG) { let a = [u.x, u.z], tt = 0.15; for (const p of pts) { const wy = model(a, [p]); tt += wayLen(a, wy) / speed; a = wy[wy.length - 1]; plan.push(tt.toFixed(1)); } dbg(D, `${label} plan +${plan.join(' +')}`); }
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    await D.go(role, x, z, { tol: TOL, max: 60 });
    arr.push((D.t - t0).toFixed(1));
    if (i === k) {
      const rest = pts.slice(k + 1), hwhy = [];
      await D.until(() => {
        const from = [u.x, u.z], way = model(from, rest);
        hwhy.length = 0;
        return hotClear(D, from, way, speed, 0.1, slack, hot, hwhy) && routeClear(D, way, { mode: 'crawl', from, speed, delay: 0.1, slack: 0.3, step, pad, why: hwhy });
      }, hw * 2 + 2, `${label}: ${hot.label ?? 'hot stretch'} clear`)
        .catch((e) => { throw new Error(`${e.message} [${hwhy.slice(0, 3).join(' ')}]`); });
      arr.push(`(${(D.t - t0).toFixed(1)})`);
    }
  }
  dbg(D, `${role} ${label} done (planned ${(len / speed).toFixed(1)} s + up to ${hw} s; at the points +${arr.join(' +')})`);
}

/**
 * Wait until all of `roles` can stand up from where they lie on the shore and step into the moored boat, and the boat
 * (the men seated in it) stay unseen through the two shots and the row out to the north edge.
 */
async function escapeWindow(D, roles, maxSec = 600) {
  const boat = teamBoat(D.world), why = [];
  let next = -1;
  const EXIT = D.world.mission?.extraction?.exit ?? { x: 124, z: 1 };
  // (the Marine steps in first, then the others; two shots; the boat rows itself out once the rockets are gone)
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25; why.length = 0;
    return roles.every((r) => { const u = D.c(r); return routeClear(D, [[boat.x, boat.z]], { mode: 'walk', from: [u.x, u.z], speed: 1.2, delay: r === 'diver' ? 1 : 4, slack: 3, pad: 1, why }); })
      && routeClear(D, [[boat.x, boat.z]], { mode: 'boat', from: [boat.x, boat.z], delay: 9, slack: 8, why })
      && routeClear(D, [[EXIT.x, EXIT.z]], { mode: 'boat', from: [boat.x, boat.z], speed: 2.5, delay: 15, slack: 4, why })
      // the first blast turns every man in earshot towards it, and from the N bank the base lies right behind the
      // boat: the men across the river must be beyond seeing range of the boat, whichever way they face
      && outOfRange(D, [[[boat.x, boat.z], [boat.x, boat.z], 0, 18], [[boat.x, boat.z], [EXIT.x, EXIT.z], 12, 26]], 3, why);
  };
  await cautious(D, () => D.until(ok, maxSec, 'escape window')).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
}

/**
 * None of the men across the river (ACROSS) comes within his far band + `margin` of the boat: `legs` are
 * [from, to, t0, t1] (the boat going from → to between t0 and t1 s from now; from = to: lying there), or [pts, t0, t1]
 * for fixed points. Whatever their heads do: a patrol file's men fall out of step at its turns and swing round to
 * close up (pn4's e45 faced the mooring that way), and a blast turns everyone towards it.
 */
function outOfRange(D, legs, margin, why = null) {
  return ACROSS.every((tag) => {
    const e = D.get(tag);
    if (!e?.alive) return true;
    const far = (e.vision?.far ?? 36) + margin;
    for (const [a, b, t0, t1] of legs) {
      for (let t = Math.max(0, t0); t <= t1 + 1e-6; t += 0.5) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
        const q = predict(e, t);
        if (Math.hypot(q.x - x, q.z - z) < far) { why?.push(`${tag} in range +${t.toFixed(1)}`); return false; }
      }
    }
    return true;
  });
}

/**
 * Wait for the ferry's window: nobody will see the boat from the moment the Marine boards at the mooring, on its way to
 * the corner, while the three step in (and see them stand up and walk to it), nor on its way back to the mooring.
 */
async function ferryWindow(D, maxSec = 600) {
  const boat = teamBoat(D.world), why = [], sp = 2.5;
  let next = -1, nd = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length && D.t > nd) { nd = D.t + 1; dbg(D, `ferry: ${why.slice(0, 2).join(' ')}`); }
    why.length = 0;
    const t1 = 3.5, t2 = t1 + Math.hypot(CORNER[0] - boat.x, CORNER[1] - boat.z) / sp + 1;
    if (!routeClear(D, [CORNER], { mode: 'boat', from: [boat.x, boat.z], speed: sp, delay: t1, slack: 1.5, pad: 0.5, why })) return false;
    // (at the corner the three step in when the walker e39 across the field looks the other way: up to 8 s of waiting)
    const w0 = boardDelay(D, t2, 8, why);
    if (w0 == null) return false;
    const t3 = w0 + 5.5;
    ferryWindow.board = D.t + w0;
    return routeClear(D, [CORNER], { mode: 'boat', from: CORNER, delay: (t2 + t3) / 2, slack: (t3 - t2) / 2 + 1, pad: 0.5, why })
      && routeClear(D, [BOAT_AT], { mode: 'boat', from: CORNER, speed: sp, delay: t3, slack: 2, pad: 0.5, why })
      && routeClear(D, [BOAT_AT], { mode: 'boat', from: BOAT_AT, delay: t3 + 11, slack: 3, pad: 0.5, why })
      && outOfRange(D, [[[boat.x, boat.z], [boat.x, boat.z], 0, t1 + 1.5], [[boat.x, boat.z], CORNER, t1, t2 + 1], [CORNER, CORNER, t2 - 1, t3 + 1],
        [CORNER, BOAT_AT, t3, t3 + 10], [BOAT_AT, BOAT_AT, t3 + 8, t3 + 15], ...EXIT_LAND.map(([, x, z]) => [[x, z], [x, z], t3 + 9, t3 + 15])], 1.5, why);
  };
  await cautious(D, () => D.until(ok, maxSec, 'ferry window')).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
}

/** the first delay (s from now, in [t, t + span]) at which the three at the tip can stand up and walk to the corner unseen */
function boardDelay(D, t, span, why = null) {
  for (let d = t; d <= t + span + 1e-6; d += 0.5) {
    const w = [];
    if (['greenberet', 'sniper', 'sapper'].every((r) => routeClear(D, [CORNER], { mode: 'walk', from: [D.c(r).x, D.c(r).z], speed: 1, delay: d, slack: 1.5, pad: 1, why: w }))) return d;
    if (d === t) why?.push(...w);
  }
  return null;
}

export const STAGES = [
  ['A', 'Along the north edge', async (D) => {
    // the two lying furthest E of the start mound are in sight of e1 when he comes back E along the field (the rock W
    // of the start hides the other two): first they crawl on past the rock N of the field, out of everyone's sight
    // (both at once, to the map edge a few metres E, where nobody ever looks: the walker e1 on the field would see them
    // where they lie within the minute)
    const STAGING = [['diver', 43.5, 0.5], ['sapper', 45.5, 0.5]];
    for (const [r, x, z] of STAGING) D.order(r, { type: 'move', x, z });
    await D.until(() => STAGING.every(([r]) => !D.c(r).path && !D.c(r).isMoving) && D.t > 1, 30, 'off the start');
    // past the gap between the start mound and the rock N of the field (e37 looks up it from the N end of his beat),
    // hugging the map edge, in one go while he walks the far half
    await crawlRoute(D, 'sapper', EDGE_GAP, { label: 'sapper past the gap', maxSec: 600 });
    D.checkpoint('A1 sapper past the rock on the field');
    await crawlRoute(D, 'diver', [[45.5, 0.9], ...EDGE_GAP.slice(0, -1), [EDGE_GAP.at(-1)[0] + 2, EDGE_GAP.at(-1)[1] + 1.2]], { label: 'diver past the gap', maxSec: 600 });
    D.checkpoint('A2 diver past the rock on the field');
    // then one at a time along the map's N edge east past the field's walkers
    for (const r of ['greenberet', 'sniper']) await crawl(D, r, r === 'greenberet' ? 45.5 : 43.8, 1.2, { box: 8 });
    await crawlRoute(D, 'greenberet', EDGE_GAP.slice(0, -1), { label: 'gb past the gap', maxSec: 600 });
    await crawl(D, 'greenberet', 70, 2, { box: 10 });
    D.checkpoint('A3 greenberet at x70');
    await crawlRoute(D, 'sniper', EDGE_GAP.slice(0, -1), { label: 'sniper past the gap', maxSec: 600 });
    await crawl(D, 'sniper', 70, 2, { box: 10 });
    D.checkpoint('A4 sniper at x70');
    await crawl(D, 'diver', 70, 2, { box: 10 });
    D.checkpoint('A5 diver at x70');
    await crawl(D, 'sapper', 70, 2, { box: 10 });
    D.checkpoint('A6 sapper at x70');
  }],
  ['B', 'To the river mouth', async (D) => {
    // on along the bank to its tip, across the river mouth from the base (the Marine first: he fetches the boat)
    const tip = async (role) => { const [, x, z] = TIP.find((r) => r[0] === role); await crawl(D, role, x, z, { box: 10, keepFrom: PN4_KEEP }); };
    await tip('diver');
    D.checkpoint('B1 diver at the tip');
    await tip('greenberet');
    D.checkpoint('B2 greenberet at the tip');
    await tip('sniper');
    D.checkpoint('B3 sniper at the tip');
    await tip('sapper');
    D.checkpoint('B4 sapper at the tip');
  }],
  ['C', 'The boat', async (D) => {
    const w = D.world, boat = teamBoat(w), ma = D.c('diver');
    // the Marine slips into the shallows, dives and swims under the current to the moored rowboat
    await D.go('diver', 111.6, 1.5, { tol: 0.4, max: 20 }); // (still prone: into the shallows)
    D.ability('diver', 'dive');
    await D.until(() => ma.stance === 'dive', 8, 'marine dives');
    D.order('diver', { type: 'move', x: boat.x - 1.5, z: boat.z - 1.5 });
    await D.until(() => !ma.path && !ma.isMoving, 90, 'marine swims to the boat');
    D.checkpoint('C1 marine under the boat');
    // the three edge on into the Marine's corner and the shallows by it, as near the boat's landing as they can lie
    for (const [r, x, z] of TIP_E) await crawl(D, r, x, z, { box: 4, keepFrom: PN4_KEEP, wade: true });
    // pn4's four men and their dog see the whole river mouth from their beat's NE end, once a minute: the ferry goes
    // in one go while they walk back SW (the Marine boards, rows to the corner, the three step in, back to the mooring)
    await ferryWindow(D);
    D.ability('diver', 'enterVehicle', boat);
    await D.until(() => ma.vehicle === boat, 10, 'marine aboard');
    D.ability('diver', 'dive'); // (the diving gear off, in the boat)
    await D.until(() => !ma.diving && !ma.currentAction, 5, 'gear off');
    D.checkpoint('C2 marine at the oars');
    D.order('diver', { type: 'move', x: CORNER[0], z: CORNER[1] });
    await D.until(() => !boat.goal && !boat.path && (boat.speed || 0) < 0.1, 30, 'boat at the corner');
    await D.wait(0.5);
    dbg(D, `boat at (${boat.x.toFixed(1)},${boat.z.toFixed(1)})`);
    D.checkpoint('C3 boat at the corner');
    await D.until(() => D.t >= ferryWindow.board, 15, 'the moment to board');
    for (const role of ['greenberet', 'sniper', 'sapper']) D.ability(role, 'enterVehicle', boat);
    await D.until(() => ['greenberet', 'sniper', 'sapper'].every((r) => D.c(r).vehicle === boat), 20, 'all aboard');
    D.checkpoint('C4 all aboard');
    D.order('diver', { type: 'move', x: BOAT_AT[0], z: BOAT_AT[1] });
    await D.until(() => !boat.goal && !boat.path && (boat.speed || 0) < 0.1, 30, 'boat at the mooring');
    dbg(D, `boat at (${boat.x.toFixed(1)},${boat.z.toFixed(1)})`);
    D.checkpoint('C5 boat at the mooring');
  }],
  ['D', 'Through the fence', async (D) => {
    // out on the shore at once and flat (pn4 sees the moored boat once a minute; nobody sees a prone man on this shore)
    for (const role of ['greenberet', 'sniper', 'sapper', 'diver']) if (D.c(role).vehicle) { D.ability(role, 'leaveVehicle'); await D.wait(0.3); }
    await D.until(() => D.world.commandos.every((u) => !u.vehicle), 10, 'all ashore');
    // (they step out into the shallows: up onto the bank first, a step or two, then down)
    for (const [role, x, z] of EXIT_LAND) { await D.go(role, x, z, { tol: 0.5, max: 15 }); await D.stance(role, 'crawl'); }
    for (const [role, x, z] of SHORE) await crawl(D, role, x, z, { box: 6 });
    D.checkpoint('D1 all ashore');
    // the shore guard e51 watches the NE shore: the Sniper drops him from the tower's foot (nobody sees that shore)
    await snipe(D, 'e51', { quiet: 240, label: 'the shore guard e51' });
    D.checkpoint('D2 sniper shoots the shore guard e51');
    // the fence post e33 watches the barrel pile all the time (his sweep crosses it every few seconds) and his body would
    // be found at once: he is turned away instead. The Green Beret leaves his decoy outside the fence's NE corner, 9 m
    // from e33 and out of every other man's earshot, switched off for now
    await crawl(D, 'greenberet', DECOY[0], DECOY[1], { box: 6 });
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => D.c('greenberet').decoy, 5, 'decoy down');
    D.checkpoint('D3 gb leaves the decoy by the NE corner');
  }],
  ['E', 'Round the palisade', async (D) => {
    // the Sniper crawls from the boat's shore along the outside of the west palisade to the gap behind the boiler house:
    // from there the patrol across the river (pn4 and its dog, who see the whole west shore of the base) is out of
    // reach of a man up on one knee, and his rounds go through the planks
    for (const [x, z] of [[112, 26], [105, 38], BOILER_GAP, SNIPE_W]) await crawl(D, 'sniper', x, z, { box: 10 });
    // the rocket walker e31 turns at the W end of his beat a step inside the fence: shot there through the planks, he
    // lies where nobody ever looks
    await snipe(D, 'e31', { quiet: 240, label: 'the rocket walker e31', when: () => Math.hypot(D.get('e31').x - 110.5, D.get('e31').z - 39) < 1.5 });
    D.checkpoint('E1 sniper shoots e31 at the west fence');
    // the caged dog sees every way round: it would bark at the climber (Prima: the Sniper shoots it first)
    await snipe(D, 'd3', { label: 'the caged dog' });
    D.checkpoint('E2 sniper shoots the caged dog d3');
    // back to the tower's foot: from there his rounds reach the rockets' walkers through the north fence
    for (const [x, z] of [BOILER_GAP, [105, 38], [112, 26], [126, 28]]) await crawl(D, 'sniper', x, z, { box: 10 });
    D.checkpoint('E3 sniper back on the north shore');
    for (const [x, z] of [[112, 26], [105, 38], BOILER_GAP]) await crawl(D, 'greenberet', x, z, { box: 10 });
    await crawlRoute(D, 'greenberet', [...CORRIDOR, HOLLOW], { label: 'gb down the boiler-house gap', maxSec: 600 });
    D.checkpoint('E4 gb below the switch climb');
  }],
  ['F', 'Over the palisade', async (D) => exact(D, async () => {
    // up and over when nobody will see him on either side for the whole climb; he lands behind the sentry e24's back
    // and crawls into the gap between the palisade and the drum stack (nobody ever looks into it)
    await climbOver(D, CLIMB_OUT, CLIMB_IN, { then: [POCKET], maxSec: 2000, home: HOLLOW });
    D.checkpoint('F1 gb over the palisade');
    // the sentry e24 by the switch faces east, his back to the gap, but his head swings north over the drum stack's
    // far side every five seconds: there is no getting round it under his eyes. The Green Beret walks out behind him,
    // knifes him and carries him into the gap, where nobody ever looks (the lorry parked by e27 hides it all from him,
    // the burnt-out half-track from e28, the walker e25 is down the far end of his beat)
    await knifeE24(D);
    D.checkpoint('F2 gb knifes e24 and hides him behind the drums');
    // out of the gap and round the stack, and on N along the inside of the W fence, all in one go while the walker e25
    // is down the S half of his beat
    await crawlRoute(D, 'greenberet', [...POCKET_OUT, OUT_OF_E25], { label: 'round the drum stack', maxSec: 2400, slack: 0.7, step: 0.25, pad: 0.1, hot: HOT_CORNER, sync: 7 });
    D.checkpoint('F3 gb round the drum stack');
    for (const [x, z] of [[109, 43]]) await crawl(D, 'greenberet', x, z, { box: 8, keep: 1.5, edgePad: 0.75 });
    D.checkpoint('F4 gb along the inside of the west fence');
  })],
  ['G', 'The barrels', async (D) => exact(D, async () => {
    // to a corner by the W fence that nobody looks at, then the decoy on by radio: e33 turns round to it, his back to
    // the barrel pile under the watchtower
    await crawl(D, 'greenberet', HIDE_W[0], HIDE_W[1], { box: 8 });
    D.checkpoint('G1 gb by the west fence');
    const e33 = D.get('e33'), e32 = D.get('e32');
    if (!D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
    await D.until(() => e33.brain?.noiseTurnT > 0 && Math.cos(e33.heading - Math.atan2(DECOY[1] - e33.z, DECOY[0] - e33.x)) > 0.95, 15, 'e33 turned to the decoy');
    D.checkpoint('G2 decoy on: e33 turns to it');
    // the rocket walker e32 halts at the N end of his beat, 4.6 m from the middle rocket: the Sniper drops him there
    // through the planks when the Green Beret can at once bring a barrel over and lay it on the body (it hides him, and
    // it is the barrel for that rocket), before the round e29 comes back up the barracks road
    const cover = barrelRun(D, 'barrel_2', [125.6, 31.6], [[E32_AT[0] - 0.8, E32_AT[1] - 0.6]], HIDE_W, { stage: HIDE_W, onBody: e32, via: [[122.3, 31.1]] });
    await snipe(D, 'e32', { quiet: 40, label: 'the rocket walker e32', when: () => {
      if (!e32.brain?.atWait || Math.hypot(e32.x - E32_AT[0], e32.z - E32_AT[1]) > 0.8) return false;
      const why = [], ok = cover.clear(1.5, why);
      if (!ok) dbg(D, `cover e32: ${why.slice(0, 3).join(' ')}`);
      return ok;
    } });
    D.checkpoint('G3 sniper shoots e32 at the middle rocket');
    await cover.run();
    D.checkpoint('G4 gb hides e32 under a barrel');
    // the pile's W barrel 3 m on, beside the W rocket (it stays within reach of the pile's last barrel: one chain)
    await barrelRun(D, 'barrel_1', [122.6, 31.9], [[121.5, 35.6]], HIDE_W, { stage: HIDE_W }).run();
    D.checkpoint('G5 gb sets barrel_1 by the W rocket');
    // the pile's E barrel all the way to the E rocket, alone (it goes off on its own shot), then back W
    await barrelRun(D, 'barrel_4', [125.6, 33.3], [[132.8, 33.6], [133.5, 35.8], [134, 37.6], [138.5, 37.9], V2E_AT], HIDE_E, { stage: HIDE_W, via: [[122.3, 31.1], [125, 31.5]] }).run();
    D.checkpoint('G6 gb sets barrel_4 by the E rocket');
    await crawl(D, 'greenberet', HIDE_W[0], HIDE_W[1], { box: 10 });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('G7 gb back west, decoy off');
  })],
  ['H', 'Back out', async (D) => exact(D, async () => {
    // the way he came: round the drum stack into the gap behind it, over the palisade by the switch when nobody on
    // either side will see him up on it, and round the outside of the fence to the shore by the boat
    await crawl(D, 'greenberet', 109.5, 43.5, { box: 8, keep: 1.5, edgePad: 0.75 });
    // (down the inside of the W fence to the foot of the drum stack's N face, where nobody looks, in one go; then
    // along its E side and into the gap behind it, in another, both while the walker e25 is down the S half of his beat)
    await crawlRoute(D, 'greenberet', [[107.5, 50.5], [104.8, 55.3], [103.5, 57.5], BELOW_STACK], { label: 'down the W fence', maxSec: 900, slack: 0.7, step: 0.25, pad: 0.4 });
    await crawlRoute(D, 'greenberet', [...POCKET_OUT.slice(1, 12).reverse(), POCKET_OUT[0], POCKET], { label: 'back round the drum stack', maxSec: 2400, slack: 0.7, step: 0.25, pad: 0.1, hold: 1, hot: HOT_CORNER });
    D.checkpoint('H1 gb back in the gap behind the drums');
    await climbOver(D, CLIMB_IN, CLIMB_OUT, { then: [HOLLOW], via: [[99.9, 66]], maxSec: 2000, home: POCKET }); // (out of the gap's mouth first: a man lying in it has no room to turn)
    D.checkpoint('H2 gb back over the palisade');
    await crawlRoute(D, 'greenberet', [...CORRIDOR.slice().reverse(), BOILER_GAP], { label: 'gb up the boiler-house gap', maxSec: 600 });
    for (const [x, z] of [[105, 38], [112, 26], [121.5, 22.5]]) await crawl(D, 'greenberet', x, z, { box: 10 });
    D.checkpoint('H3 gb back on the north shore');
  })],
  ['I', 'Fire and away', async (D) => {
    const w = D.world, boat = teamBoat(w), sn = D.c('sniper');
    const b4 = w.interactables.find((i) => (i.tag ?? i.spawn?.id) === 'barrel_4'), b1 = w.interactables.find((i) => (i.tag ?? i.spawn?.id) === 'barrel_1');
    // all four into the boat at once, when the patrol across the river (pn4) will not see it for the whole of the
    // boarding, both shots and the row out; the Sniper fires from his seat
    const ROLES = ['diver', 'greenberet', 'sniper', 'sapper'];
    // first all four flat at the water's edge beside the boat (nobody sees a man lying on this shore)
    for (const [r, x, z] of WATERLINE) await crawl(D, r, x, z, { box: 6 });
    D.checkpoint('I0 all four at the water by the boat');
    await escapeWindow(D, ROLES);
    // (the Marine at the oars first, the others the moment he is in)
    D.ability('diver', 'enterVehicle', boat);
    await D.until(() => D.c('diver').vehicle === boat, 15, 'marine aboard');
    for (const r of ROLES.slice(1)) D.ability(r, 'enterVehicle', boat);
    await D.until(() => ROLES.every((r) => D.c(r).vehicle === boat), 20, 'all aboard');
    D.checkpoint('I1 all aboard at the mooring');
    // through the planks: the lone barrel by the E rocket (and the N barracks beside it), then the chain by the other two
    const fire = async (b) => {
      await D.until(() => ABIL.sniper.canUse(sn, b, w) === true, 10, `shot at ${b.tag}`);
      D.ability('sniper', 'sniper', b);
      await D.until(() => b.exploded || b.destroyed || b.removed, 6, `${b.tag} goes up`);
    };
    await fire(b4);
    D.checkpoint('I2 sniper fires the barrel by the E rocket');
    await fire(b1);
    D.checkpoint('I3 sniper fires the barrel chain by the W and middle rockets');
    await D.until(() => w.objectives.find((o) => o.id === 'o1')?.done, 10, 'all three rockets destroyed');
    D.checkpoint('I4 all three rockets destroyed');
    await D.until(() => w.objectives.find((o) => o.id === 'o2')?.done || D.world.game?.state === 'won', 60, 'the boat out by the north edge').catch(() => {});
    D.checkpoint('I5 the boat rows out downstream');
  }],
];

/** [from, to, t0, t1] legs along `way` from `from` at `speed`, starting at `t0` (s from now). */
function wayLegs(from, way, speed, t0) {
  const out = [];
  let a = from, t = t0;
  for (const p of way) { const dt = Math.hypot(p[0] - a[0], p[1] - a[1]) / speed; out.push([a, p, t, t + dt]); a = p; t += dt; }
  return out;
}

/**
 * Would post `e` see a standing man on `legs` ([from, to, t0, t1]: going from → to between t0 and t1 s from now) with
 * his body kept turned as it stands now (a post held turned by a lure)? His head sweeps there (browser run: e33 under
 * the decoy swept ±60° round it and spotted a barrel carrier 90° off his body's heading): every head offset across the
 * sweep is tried.
 */
function asIsClear(D, e, legs, why = null) {
  if (!e?.alive) return true;
  const w = D.world, A = e.sweepActive ? (e.sweepAmp ?? e.vision?.sweep ?? 0) : 0;
  const heads = [], me = mirrorOf(e); // (his ghosts read him through a mirror: ghost.mjs)
  for (let o = -A; o <= A + 1e-6; o += 0.1) { const g = ghostOn(me); g.sweepActive = false; g.headOffset = o; g.headCarry = 0; heads.push([g, coneAt(g, w.time)]); }
  if (!heads.length) heads.push([e, coneAt(e, w.time)]);
  for (const [a, b] of legs) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let k = 0; k <= n; k++) {
      const f = k / n, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f, d = dummyAt(w, 'walk', x, z);
      for (const [g, cone] of heads) if (canSee(g, d, w, { cone }) !== 'none') { why?.push(`${e.tag}(turned)@(${x.toFixed(1)},${z.toFixed(1)})`); return false; }
    }
  }
  return true;
}

/**
 * A barrel run for the Green Beret: from where he lies (or from `stage`, a spot nobody sees, crawled to first) he crawls
 * up beside barrel `id` (`side`), stands up, shoulders it, carries it along `pts` and puts it down at the last point
 * (or on the body `onBody`: it hides him), lies flat there for `rest` s, then crawls on to `hide`. `clear(d)`: would all
 * of it, from the crawl to the barrel on, starting `d` s from now, go unseen? `run()` does it, in a window.
 */
function barrelRun(D, id, side, pts, hide, { rest = 3, maxWait = 400, stage = null, onBody = null, via = [] } = {}) {
  const gb = D.c('greenberet'), w = D.world;
  // (the fence post e33, turned to the decoy, stays turned while it beeps; the body under the barrel is no viewer)
  const ex = () => [...(gb.decoy?.on ? [D.get('e33')] : []), ...(onBody ? [onBody] : [])];
  const b = w.interactables.find((i) => (i.tag ?? i.spawn?.id) === id);
  const UP = CONFIG.units.stanceUp ?? 0.6, DOWN = CONFIG.units.stanceDown ?? 0.5, C = CONFIG.abilities.carry ?? { pick: 1, drop: 0.8 }, SP = CONFIG.units.carryBarrel ?? CONFIG.units.carry ?? 1.6; // (a drum in his arms)
  // (the way he really carries it: on the paths the game finds, round whatever the map puts there)
  const way = wayOf(D, side, pts, { tol: onBody ? 0.6 : 0.25, noLinks: true }), len = wayLen(side, way);
  const end = pts[pts.length - 1];
  const t1 = UP + C.pick + 0.6 + 0.6, t2 = t1 + len / SP + 0.6, t3 = t2 + C.drop + DOWN + 0.6; // (t1: + his turn round with it)
  const CR = 0.75;
  /** the standing part, starting `d` s from now, stays unseen */
  const win = (d, why = null, except = ex()) => routeClear(D, [side], { mode: 'walk', from: side, delay: d + t1 / 2, slack: t1 / 2 + 0.4, pad: 1, why, except })
    && routeClear(D, way, { mode: 'walk', from: side, speed: SP, delay: d + t1, slack: 1.2, pad: 1, why, except })
    && routeClear(D, [end], { mode: 'walk', from: end, delay: d + (t2 + t3) / 2, slack: (t3 - t2) / 2 + 0.6, pad: 1, why, except })
    && routeClear(D, [end], { mode: 'crawl', from: end, delay: d + t3 + rest / 2, slack: rest / 2 + 0.5, pad: 1, why, except })
    // (e33 turned to the decoy: his cone as it stands — his head need not have come round with his body)
    && (!gb.decoy?.on || asIsClear(D, D.get('e33'), [[side, side, d, d + t1], ...wayLegs(side, way, SP, d + t1), [end, end, d + t2, d + t3]], why));
  /** the crawl from (fx, fz) to the barrel, then the standing part */
  const clear = (d = 0, why = null, from = stage || [gb.x, gb.z]) => {
    const tc = [...via, side].reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, from])[0] / CR + 0.5;
    const except = ex();
    return routeClear(D, [...via, side], { mode: 'crawl', from, speed: CR, delay: d, slack: 1, pad: 1, why, except }) && win(d + tc, why, except);
  };
  const run = async () => {
    if (stage) {
      await crawl(D, 'greenberet', stage[0], stage[1], { box: 8 });
      const why = [];
      let next = -1;
      let nd = 0;
      await cautious(D, () => D.until(() => { if (D.t < next) return false; next = D.t + 0.25; if (why.length && D.t > nd) { nd = D.t + 3; dbg(D, `carry ${id}: ${why.slice(0, 2).join(' ')}`); } why.length = 0; return clear(0, why); }, maxWait, `window to carry ${id}`))
        .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
      for (const [x, z] of [...via, side]) await D.go('greenberet', x, z, { tol: 0.3, max: 30 });
    } else {
      // (the planner asks at every arrival time it tries: memoised per 0.2 s, per plan)
      let memo = new Map(), memoT = -1;
      const goalOk = (_x, _z, tAbs) => {
        if (memoT !== w.time) { memo = new Map(); memoT = w.time; }
        const k = Math.round(tAbs * 5);
        if (!memo.has(k)) memo.set(k, win(tAbs - w.time + 0.3));
        return memo.get(k);
      };
      await crawl(D, 'greenberet', side[0], side[1], { box: 8, hold: 0.6, maxWait, goalOk, label: `gb → ${id}` });
    }
    if (!win(0)) { // (a step late: lie still until the next window)
      const why = [];
      await cautious(D, () => D.until(() => { why.length = 0; return win(0, why); }, maxWait, `window to carry ${id}`)).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
    }
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', b);
    await D.until(() => gb.carrying === b, 10, `GB picks up ${id}`);
    for (const [x, z] of pts) await D.go('greenberet', x, z, { tol: onBody ? 0.6 : 0.25, max: 60 });
    if (onBody) {
      D.ability('greenberet', 'hand', onBody);
      await D.until(() => !gb.carrying && onBody.hiddenUnderBarrel, 5, `${id} put down on ${onBody.tag}`);
    } else {
      D.ability('greenberet', 'drop');
      await D.until(() => !gb.carrying, 5, `${id} put down`);
    }
    await D.idle('greenberet');
    await D.stance('greenberet', 'crawl');
    dbg(D, `${id} at (${b.x.toFixed(2)},${b.z.toFixed(2)})`);
    if (hide) await crawl(D, 'greenberet', hide[0], hide[1], { box: 8 });
    return b;
  };
  return { clear, run, barrel: b };
}

/**
 * None of the men across the river (ACROSS: patrol pn4 and its dog, e39, patrol pn3) sees the Sniper up on one knee at
 * `sn` within `dur` s, whichever way his head turns within 35° of where he is predicted to face (a file of men halting
 * or wheeling at the end of its beat falls out of step, and its heads sweep: pn4 halted on the far bank looks straight
 * at the W shore, and the model of its heads missed a man there by a few degrees).
 */
function acrossClear(D, sn, dur = 2, why = null) {
  const w = D.world, d = { x: sn.x, z: sn.z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
  for (const tag of ACROSS) {
    const e = D.get(tag);
    if (!e?.alive || !e.vision) continue;
    const far = (e.vision.far ?? 36) + 1, me = mirrorOf(e); // (his ghosts read him through a mirror: ghost.mjs)
    for (let t = 0; t <= dur + 1e-6; t += 0.25) {
      const q = predict(e, t);
      if (Math.hypot(q.x - sn.x, q.z - sn.z) > far) continue;
      for (let off = -35; off <= 35; off += 5) {
        const g = ghostOn(me);
        g.x = q.x; g.z = q.z; g.heading = q.heading + (off * Math.PI) / 180; g.sweepActive = false; g.headOffset = 0; g.headCarry = 0;
        if (canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none') { why?.push(`${tag} across +${t.toFixed(1)}`); return false; }
      }
    }
  }
  return true;
}

/**
 * The Sniper (kneeling: seen as a standing man from the aim to the shot) fires at `target` (a guard, or a barrel) from
 * where he lies, once nobody will see him up on one knee and nobody but `later` sees the man fall (or, `quiet`, would
 * find the body within that many s).
 */
async function snipe(D, target, { quiet = 0, later = [], maxSec = 300, label = '', when = null } = {}) {
  const sn = D.c('sniper'), why = [];
  if (typeof target === 'string') target = D.get(target) || D.world.interactables.find((i) => i.tag === target);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  const isMan = target.kind === 'enemy';
  let next = -1, nd = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.2;
    if (why.length && D.t > nd) { nd = D.t + 5; dbg(D, `snipe ${label}: ${why.slice(0, 3).join(' ')}`); }
    why.length = 0;
    if (when && !when()) { why.push('when'); return false; }
    if (ABIL.sniper.canUse(sn, target, D.world) !== true) { why.push(`no shot: ${ABIL.sniper.canUse(sn, target, D.world)}`); return false; }
    if (!clearFor(D, [[sn.x, sn.z]], 1.6, { mode: 'walk', why, except: [target] })) return false;
    // (nor the man himself, from the aim until the round lands: he is a live cone like any other)
    if (isMan && target.vision && !clearFor(D, [[sn.x, sn.z]], 1.1, { mode: 'walk', why })) return false;
    if (!acrossClear(D, sn, 2, why)) return false;
    if (isMan && !target.spawn?.quietBody) {
      if (!unwitnessed(D, target, sn, { ahead: 0.8, why, except: later, strict: true })) return false;
      if (quiet) { const f = bodySeen(D, target.x, target.z, quiet, { except: [target, ...later] }); if (f.length) { why.push(`body seen by ${f.join(',')}`); return false; } }
    }
    return true;
  };
  // (with halted men's heads where their sweep really puts them: patrol pn4 halted across the river looks straight at
  // the W shore, and a man up on one knee at the edge of a swing is in his far band)
  await exact(D, () => cautious(D, () => D.until(ok, maxSec, `snipe ${label || target.tag}`))).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  D.ability('sniper', 'sniper', target);
  await D.until(() => (isMan ? !target.alive : target.exploded) || !sn.currentAction, 3, `${label || target.tag} hit`);
  await D.until(() => !sn.currentAction && !sn.kneeling, 3, 'sniper down again');
}

/**
 * The upright climb over a palisade link a → b as the game moves a man (measured in the sim): he
 * stands up at a, turns on the spot to face the wall when he lies turned away from it more than CLIMB_TURN (`turn` s:
 * climbTurn), steps 0.5 m to the foot, goes up 3 m in 2 s, over the top at 1.5 m/s, down in 2 s, steps off at b and
 * stands there until he is down again. Samples [τ, x, z, y] from the moment he starts to stand up.
 */
function climbProfile(a, b, turn = 0) {
  const UP = CONFIG.units.stanceUp ?? 0.6, DOWN = (CONFIG.units.stanceDown ?? 0.5) + 0.3, H = 3.02, V = 1.5, WALK = 1.5;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const out = [], put = (t, s, y) => out.push([t, a[0] + ux * s, a[1] + uz * s, y]);
  const s1 = 0.5, s2 = L - 0.55, tIn = s1 / WALK, tUp = H / V, tTop = (s2 - s1) / V, tOut = (L - s2) / WALK;
  const legs = [[UP + turn, (f) => [0, 0]], [tIn, (f) => [s1 * f, 0]], [tUp, (f) => [s1, H * f]], [tTop, (f) => [s1 + (s2 - s1) * f, H]],
    [tUp, (f) => [s2, H * (1 - f)]], [tOut, (f) => [s2 + (L - s2) * f, 0]], [DOWN, (f) => [L, 0]]];
  let t = 0;
  for (const [dt, at] of legs) {
    const n = Math.max(1, Math.ceil(dt / 0.05));
    for (let k = 0; k <= n; k++) put(t + (dt * k) / n, ...at(k / n));
    t += dt;
  }
  return out;
}

/** The turn on the spot (s) before a climb a → b, lying at a facing `h` (the game turns him to within CLIMB_TURN). */
function climbTurn(h, a, b) {
  const d = Math.abs(Math.atan2(Math.sin(Math.atan2(b[1] - a[1], b[0] - a[0]) - h), Math.cos(Math.atan2(b[1] - a[1], b[0] - a[0]) - h)));
  return Math.max(0, d - CLIMB_TURN) / CONFIG.units.turnRate + (d > CLIMB_TURN ? 1 / 60 : 0);
}

/** Headings from `a` to `b` the short way round (the way an enemy's body turns), every 0.2 rad; both ways only for a
 * dead-even about-turn. */
function arcHeadings(a, b) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)), out = [];
  for (const sg of Math.abs(d) > Math.PI - 0.02 ? [1, -1] : [Math.sign(d) || 1]) {
    const full = Math.sign(d) === sg ? Math.abs(d) : 2 * Math.PI - Math.abs(d);
    for (let k = 0.2; k < full; k += 0.2) out.push(a + sg * k);
  }
  return out;
}

/**
 * Would the whole upright climb a → b (climbProfile), started `delay` s from now (± `slack`), go unseen — by every man
 * on either side of the palisade, the man up on top of it (3 m up) included?
 */
function climbClear(D, a, b, delay, { slack = 0.6, why = null, turn = 0 } = {}) {
  const w = D.world, prof = climbProfile(a, b, turn), m0 = w.sneakMargin;
  w.sneakMargin = 0.03; // (a walker's glances: a hair wider than the model's ±14°)
  try { return climbClear0(D, w, a, b, prof, delay, slack, why); } finally { w.sneakMargin = m0; }
}

function climbClear0(D, w, a, b, prof, delay, slack, why) {
  for (const e of viewersOf(w)) {
    const far = (e.vision.far ?? 36) + 1, moving = walking(e);
    if (Math.hypot(e.x - a[0], e.z - a[1]) > far + 30) continue;
    // (a post's head sweeps on the clock, and the climb starts on the planned tick: he is timed to a tenth of a second;
    // a walker's whereabouts are a prediction: `slack` either way)
    const sl = moving ? slack : Math.min(slack, 0.1), ostep = !moving && e.sweepActive ? 0.05 : 0.25;
    for (const [tau, x, z, y] of prof) {
      for (let o = -sl; o <= sl + 1e-6; o += ostep) {
        const tt = Math.max(0, delay + tau + o);
        const d = dummyAt(w, 'walk', x, z);
        d.y = (d.y || 0) + y;
        let seen;
        if (moving) {
          const q = predict(e, tt);
          if (Math.hypot(q.x - x, q.z - z) > far) continue;
          seen = Math.hypot(q.x - x, q.z - z) < 4 || walkerSees(e, q, d, w, w.time + tt)
            // (just halted: he turns from the way he walked to the way he looks, his eyes sweeping
            // everything between — e21 at the E end of his beat swings round through the north, over the climb)
            || (q.halt && q.alt != null && arcHeadings(q.alt, q.heading).some((hd) => walkerSees(e, { ...q, heading: hd, alt: undefined }, d, w, w.time + tt)))
            // (setting off on a leg: he turns to it the short way round, his eyes sweeping between)
            || (q.turnFrom != null && q.turnT < 1.6 && arcHeadings(q.turnFrom, q.heading).some((hd) => walkerSees(e, { ...q, heading: hd, turnFrom: undefined }, d, w, w.time + tt)));
        } else {
          if (Math.hypot(e.x - x, e.z - z) > far) continue;
          seen = staticSees(e, d, w, tt);
        }
        if (seen) { why?.push(`${e.tag}@(${x.toFixed(1)},${z.toFixed(1)},y${y.toFixed(1)})+${tt.toFixed(1)}`); return false; }
      }
    }
  }
  return true;
}

/** out of the gap behind the sentry e24 (he faces east), and back into it with his body */
const E24_IN = [[99.9, 64.7], [100.6, 66.2], [101.4, 67.5]], E24_CARRY = [[100.9, 66.2], [100.1, 64.9], [99.9, 62.5]], E24_BODY = [100, 60.3];

/**
 * The Green Beret, lying in the gap behind the drum stack, crawls up behind e24, knifes him and carries him into the
 * gap: when nobody will see him crawl there, stand up, the body fall, nor see him carry it (the base lorry counted only
 * while it will stand by e27 for all of it).
 */
async function knifeE24(D, maxSec = 1500) {
  const gb = D.c('greenberet'), e24 = D.get('e24'), why = [];
  const C = CONFIG.abilities.carry ?? { pick: 1, drop: 0.8 }, SP = CONFIG.units.carry ?? 1.6, WALK = CONFIG.units.walk ?? 2.25;
  const UP = CONFIG.units.stanceUp ?? 0.6, DOWN = CONFIG.units.stanceDown ?? 0.5;
  // (he gets up in the gap — the drums hide a standing man there — and walks out behind e24: quicker than a crawl, and
  // the whole of it must fit while the walker e25 is down the S half of his beat)
  const IN = wayOf(D, POCKET, E24_IN, { tol: 0.3 }), CARRY = wayOf(D, [e24.x, e24.z], [...E24_CARRY, E24_BODY], { tol: 0.4, noLinks: true });
  const Lin = wayLen(POCKET, IN), L = wayLen([e24.x, e24.z], CARRY);
  const tw = UP + 0.2, tk = tw + Lin / WALK + 0.3, t3 = tk + 0.9 + C.pick + 0.4, t4 = t3 + L / SP, t5 = t4 + C.drop + DOWN + 0.6;
  let next = -1, nd = 0;
  const check = (w) => {
    const after = [e24];
    return routeClear(D, [POCKET], { mode: 'walk', from: POCKET, delay: tw / 2, slack: tw / 2 + 0.4, why: w })
      && routeClear(D, IN, { mode: 'walk', from: POCKET, speed: WALK, delay: tw, slack: 0.6, pad: 0.4, why: w })
      && routeClear(D, [[e24.x, e24.z]], { mode: 'walk', from: [e24.x, e24.z], delay: (tk + t3) / 2, slack: (t3 - tk) / 2 + 0.6, why: w, except: after })
      && routeClear(D, [[e24.x, e24.z]], { mode: 'body', from: [e24.x, e24.z], delay: (tk + t3) / 2, slack: (t3 - tk) / 2 + 0.6, why: w, except: after })
      && routeClear(D, CARRY, { mode: 'walk', from: [e24.x, e24.z], speed: SP, delay: t3, slack: 0.8, pad: 0.4, why: w, except: after })
      && routeClear(D, [E24_BODY], { mode: 'walk', from: E24_BODY, delay: (t4 + t5) / 2, slack: (t5 - t4) / 2 + 0.6, why: w, except: after });
  };
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length && D.t > nd) { nd = D.t + 2; dbg(D, `e24 knife: ${why.slice(0, 2).join(' ')}`); }
    why.length = 0;
    return lorryParkedFor(D) >= t5 + 1 ? !!check(why) : !!withoutLorry(D, () => check(why));
  };
  // (a walker turning round sweeps his eyes across, the short way round as his body turns: e25 swings through the west
  // at the N end of his beat, through the east at the S end)
  await D.go('greenberet', POCKET[0], POCKET[1], { tol: 0.4, max: 20 });
  const tie0 = D.world.sneakTurnTie;
  D.world.sneakTurnTie = 0.02;
  try { await exact(D, () => cautious(D, () => D.until(ok, maxSec, 'e24 unwatched'))); } catch (e) { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); } finally { D.world.sneakTurnTie = tie0; }
  await D.stance('greenberet', 'stand');
  for (const [x, z] of E24_IN) await D.go('greenberet', x, z, { tol: 0.3, max: 20 });
  D.ability('greenberet', 'knife', e24);
  await D.until(() => !e24.alive, 10, 'e24 knifed');
  await D.idle('greenberet');
  D.ability('greenberet', 'hand', e24);
  await D.until(() => gb.carrying === e24 || e24.carriedBy === gb, 10, 'lift e24');
  for (const [x, z] of [...E24_CARRY, E24_BODY]) await D.go('greenberet', x, z, { tol: 0.4, max: 20 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, 'drop e24');
  await D.idle('greenberet');
  await D.stance('greenberet', 'crawl');
  await D.go('greenberet', POCKET[0], POCKET[1], { tol: 0.4, max: 20 });
}

/** The base lorry (it drives in through the S gate, stands 30 s by the post e27, and out again). */
const lorryOf = (D) => D.world.vehicles.find((v) => (v.tag ?? v.spawn?.id) === 'lt' && !v.removed);

/** How long (s) the base lorry will still stand where it is (0: on the move, or gone). */
function lorryParkedFor(D) {
  const lt = lorryOf(D);
  return lt && (lt.speed || 0) < 0.05 && lt.waitT > 0 ? lt.waitT : 0;
}

/** `fn()` with the base lorry's hull out of the sight lines (it will have driven off by then); restored after. */
function withoutLorry(D, fn) {
  const w = D.world, lt = lorryOf(D);
  if (!lt) return fn();
  w.grid.clearDynamic();
  for (const e of w.entities) if (!e.removed && e !== lt && e.stampOccluder) e.stampOccluder(w.grid);
  try { return fn(); } finally { w.refreshDynamicOccluders(); }
}

/**
 * The Green Beret over a climb link a → b from where he lies (crawling to a, flat, then up on his feet at its foot):
 * once nobody will see him crawl there and lie there, nor see him anywhere on the upright climb (on his feet at the foot,
 * on the wall, up on top of it, coming down and standing at b until he is down: climbClear — the game keeps a crawler
 * low on the wall, the solution does not lean on it), nor see him lie at b and crawl on. The posts e27 and e28 inside
 * sweep their heads across the wall top every 2.5 s: the climb fits between two sweeps only to a few tenths of a second,
 * so he lies at the foot and starts it on the planned tick (`wait`: how long he may lie there first).
 */
async function climbOver(D, a, b, { then = [], via = [], maxSec = 400, label = 'climb', wait = 10, home = null } = {}) {
  const gb = D.c('greenberet'), why = [];
  // (lying at the foot he faces the way he crawled there: turned well away from the wall he turns on the spot first)
  const approach = via.length ? via.at(-1) : [gb.x, gb.z], turn = climbTurn(Math.atan2(a[1] - approach[1], a[0] - approach[0]), a, b);
  const tc = climbProfile(a, b, turn).at(-1)[0];
  let next = -1, nd = 0, plan = null;
  const post = (d, w) => routeClear(D, [b], { mode: 'crawl', from: b, delay: d + tc + 1, slack: 1.5, why: w })
    && (!then.length || routeClear(D, then, { mode: 'crawl', from: b, speed: 0.75, delay: d + tc + 0.5, slack: 1, pad: 0.8, why: w }));
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 1; // (each look scans the next `wait` s of starts: once a second is plenty)
    if (why.length && D.t > nd) { nd = D.t + 1; dbg(D, `${label}: ${why.slice(0, 2).join(' ')}`); }
    why.length = 0;
    const CR = CONFIG.units.crawl ?? 0.9, way = wayOf(D, [gb.x, gb.z], [...via, a], { tol: 0.4 }), t1 = wayLen([gb.x, gb.z], way) / CR + 0.4;
    // (the crawl to the foot and the wait there on the ground, a few metres from the walkers' halts: a halted man is
    // taken to look anywhere across his sweep, not where the clock puts his head — a few ticks off is a sighting there)
    const W = D.world, ex0 = W.sneakHaltExact, tu0 = W.sneakTurns;
    W.sneakHaltExact = undefined;
    W.sneakTurns = true; W.sneakTurnTie = 0.02; // (a walker turning round sweeps his eyes across, the short way: e25 through the west at his N halt)
    const ds = [];
    try {
      if (!routeClear(D, way, { mode: 'crawl', from: [gb.x, gb.z], speed: CR, delay: 0.3, slack: 1, pad: 0.5, why })) return false;
      for (let d = t1 + 0.3; d <= t1 + 0.3 + wait + 1e-6; d += 0.1) {
        // (a man close by at the edge of his sweep is a few degrees off it: the spot is tried half a metre round too)
        if (![a, [a[0] + 0.5, a[1]], [a[0] - 0.5, a[1]], [a[0], a[1] + 0.5], [a[0], a[1] - 0.5]].every((p) => routeClear(D, [p], { mode: 'crawl', from: p, delay: (t1 + d) / 2, slack: (d - t1) / 2 + 1, pad: 0.6, why: ds.length ? null : why }))) break;
        ds.push(d);
      }
    } finally { W.sneakHaltExact = ex0; W.sneakTurns = tu0; W.sneakTurnTie = undefined; }
    // (the base lorry parked by e27 hides the climb from him: counted only while it will still stand there)
    const held = lorryParkedFor(D);
    const tryD = (d, w) => climbClear(D, a, b, d, { slack: 0.4, why: w, turn }) && post(d, w);
    for (const d of ds) if (d + tc + 0.5 <= held && tryD(d, d === ds[0] ? why : null)) { plan = D.t + d; return true; }
    const rest = ds.filter((d) => d + tc + 0.5 > held);
    const hit = rest.length ? withoutLorry(D, () => rest.find((d) => tryD(d, d === rest[0] ? why : null))) : undefined;
    if (hit != null) { plan = D.t + hit; return true; }
    return false;
  };
  // (a dog heeling its handler; walkers' turns the short way round, as their bodies turn: climbClear)
  const prevH = D.world.sneakHeel, t00 = D.t;
  D.world.sneakHeel = true;
  try {
    for (;;) {
      await D.until(ok, Math.max(1, maxSec - (D.t - t00)), `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
      for (const [x, z] of via) await D.go('greenberet', x, z, { tol: 0.5, max: 60 });
      // (to the link's foot flat — he can stall a step short round the drum stack's corner: on again from there —
      // then, on the planned tick, up on his feet and over, if it is still clear: else another window from there)
      for (let k = 0; ; k++) {
        try { await D.go('greenberet', a[0], a[1], { tol: 0.3, max: 30 }); break; } catch (e) {
          if (DBG) { const fp = D.world.findPath(gb.x, gb.z, a[0], a[1], { role: 'greenberet' }); dbg(D, `${label}: ${e.message} (refusal: ${gb.lastRefusal?.text ?? '-'}; stance ${gb.stance}; carrying ${gb.carrying?.tag ?? gb.carrying?.id ?? '-'}; action ${gb.currentAction?.id ?? '-'}; path ${fp ? fp.map((n) => `${n.x.toFixed(2)},${n.z.toFixed(2)}`).join(' ') : 'none'})`); }
          if (k >= 2) throw e;
          await D.wait(0.3);
        }
      }
      // (too late, or no longer clear on the tick: back to where he lay unseen, and another window from there)
      const back = async () => { next = -1; if (home) for (const [x, z] of [...via].reverse().concat([home])) await D.go('greenberet', x, z, { tol: 0.4, max: 30 }); };
      if (D.t > plan) { dbg(D, `${label}: at the foot ${(D.t - plan).toFixed(1)} s late: another window`); await back(); continue; }
      await D.until(() => D.t >= plan - 1e-6, 30, `${label} tick`);
      const fin = (w) => climbClear(D, a, b, 0, { slack: 0.1, why: w, turn });
      if (lorryParkedFor(D) >= tc + 0.5 ? fin(why) : withoutLorry(D, () => fin(why))) break;
      dbg(D, `${label}: no longer clear on the tick (${why.slice(-2).join(' ')}): another window`); await back();
    }
  } finally { D.world.sneakHeel = prevH; }
  const trace = [], prof = DBG ? climbProfile(a, b, turn) : null, t0 = D.t;
  const rec = () => { if (DBG) { const p = prof.find((q) => q[0] >= D.t - t0 - 1e-6) || prof.at(-1); trace.push(`${(D.t - t0).toFixed(2)}:${gb.x.toFixed(2)}/${(gb.y || 0).toFixed(2)}~${p[1].toFixed(2)}/${p[3].toFixed(2)}${gb.stance[0]}`); } return true; };
  await D.stance('greenberet', 'stand');
  rec();
  D.ability('greenberet', 'climb', { x: b[0], z: b[1] });
  await D.until(() => rec() && Math.hypot(gb.x - b[0], gb.z - b[1]) < 0.5 && !gb.path, 40, `${label} over`);
  await D.stance('greenberet', 'crawl');
  rec();
  if (DBG) dbg(D, `${label} trace ${trace.filter((_, i) => i % 10 === 0 || i === trace.length - 1).join(' ')}`);
  for (const [x, z] of then) await D.go('greenberet', x, z, { tol: 0.6, max: 60 });
}

export async function solve(D, ctx = {}) {
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  // (each leg proven unseen 1 m round him too: M19's file men and dogs are predicted less closely than the cells need)
  D.straightDashes = { pad: 1 };
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
