/**
 * M6 "Menace of the Leopold" (Masi): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m06 (also tests/m06-solution.test.mjs). Walkthrough: m06.walkthrough.mjs.
 *
 * Wins with every objective done, 0 detections and 0 exposures (driver's exposure watch), headless and in the browser;
 * the only alarm is the mission's own one after the Leopold blows (the blast kills e21 by the gun).
 */
import { clearFor, routeClear, unwitnessed, bodySeen, predict, walking, sneak, staticSees, dummyAt } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { boardPoint } from '../../src/abilities/drive.js';

const DBG = !!globalThis.process?.env?.M06DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.M06STOP;

/** The Green Beret's walk after e1 along his beat (and back with the body behind the start rocks). */
const E1_STALK = [[10, 16], [16, 20.5], [22, 21.5], [27.5, 21], [20, 18.5], [12, 15.5]];

/** The barricade: the gap a headless grid leaves between the yard's corner and the wire (the game's nav closes it), the
 *  Green Beret's and the Sniper's spots north of it, the way round the wire's east end to e11, and on into the yard. */
const YARD_GAP = [[[8.5, 39.3], [12.2, 39.3], [12.2, 41.8], [8.5, 41.8]]];
const BAR_GB = [14.5, 41.5], BAR_SN = [13.5, 38.5];
const BAR_WAY = [[14.8, 42.8], [18.3, 46.3], [17.8, 47.8], [13.2, 48.1]], YARD = [[9.3, 48.8], [6.3, 45.8], [5, 44]], YARD_LEE = [7.9, 41.9];

/** Snow drifts near e12's beat (he follows tracks): the crawls round the south-west field keep off them. */
const SNOW_SW = [[[0, 90], [28, 88], [30, 105], [0, 105]]];
/** ... and, once down the west edge, off the strip the armoured car sees from its west turn-round. */
/** The field's west edge itself: hugged (e12 walks to 14 m off it). */
const WEST_EDGE = [...SNOW_SW, [[13.5, 49], [30, 49], [30, 62], [13.5, 62]], [[8.5, 39.3], [12.2, 39.3], [12.2, 41.8], [8.5, 41.8]]];
/** The hollow south of the log pile on the field's west edge: neither e12 nor the car ever sees a man lying there. */
const LOGS = [9.5, 63.5];
/** The snow drift in the south-west corner (below e12's eyes). */
const SNOW_CORNER = [2.5, 93.5];
/** The strip the car sees from its turn-round, either side of the log pile: never a place to wait. */
const CAR_STRIP_E = [[[11.5, 56], [22, 56], [22, 68.5], [11.5, 68.5]], [[0, 56], [8.2, 56], [8.2, 65.2], [0, 65.2]]];
/** Behind the burned-out brick ruin: a man can stand up there unseen (the car never looks either). */
const BRICK = [48.5, 100.5];

/** The man as the guards see him standing (a knife blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/** Does `e` (now, and over the next `ahead` s as predicted) have the man `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world;
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = Object.create(e); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
  }
  return false;
}

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % (+globalThis.process?.env?.M06DBGN || 120) === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/**
 * The Green Beret knifes `victim` once `ready()` holds, he is within `reach`, the victim does not see him coming and
 * nobody else sees the blow or the body (for `quiet` s, `later` = men who die before then).
 */
async function knife(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 3.5, run = false, follow = 0, label = '' } = {}) {
  const gb = D.c('greenberet'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  let last = -1;
  await D.until(() => {
    why.length = 0;
    // (`follow` m: he keeps that far behind a walking victim meanwhile)
    if (follow && D.t - last > 0.25) {
      const bx = victim.x - Math.cos(victim.heading) * follow, bz = victim.z - Math.sin(victim.heading) * follow;
      if (Math.hypot(gb.x - bx, gb.z - bz) > 0.5) { D.order('greenberet', { type: 'move', x: bx, z: bz }); last = D.t; }
    }
    if (!ready()) return dbg(D, ['not ready'], `knife ${victim.tag}`);
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > reach) return dbg(D, [`far gb@${gb.x.toFixed(1)},${gb.z.toFixed(1)} ${victim.tag}@${victim.x.toFixed(1)},${victim.z.toFixed(1)} path=${!!gb.path} st=${victim.brain?.state} h=${Math.round(victim.heading * 57.3)} goal=${JSON.stringify(victim.brain?.goal ? { x: victim.brain.goal.x, z: victim.brain.goal.z, k: victim.brain.goal.kind } : null)}`], `knife ${victim.tag}`);
    const me = bare(gb);
    if (eyesOn(D, victim, me, 1.6)) return dbg(D, ['victim looks'], `knife ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead: 1.6, strict: true, why })) return dbg(D, why, `knife ${victim.tag}`);
    if (!clearFor(D, [[gb.x, gb.z], [(gb.x + victim.x) / 2, (gb.z + victim.z) / 2]], 2, { mode: 'walk', except: [victim], why })) return dbg(D, why, `knife ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    return true;
  }, maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run });
  await D.until(() => !victim.alive, 10, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
}

/** The Green Beret runs up behind walker `victim` and keeps `gap` m behind him (his back to him). */
async function stalk(D, victim, { gap = 2.0, maxSec = 30, run = false } = {}) {
  const gb = D.c('greenberet');
  if (typeof victim === 'string') victim = D.get(victim);
  let last = -1;
  await D.until(() => {
    const bx = victim.x - Math.cos(victim.heading) * gap, bz = victim.z - Math.sin(victim.heading) * gap;
    if (Math.hypot(gb.x - bx, gb.z - bz) < 0.8) return true;
    if (D.t - last > 0.25) { D.order('greenberet', { type: 'move', x: bx, z: bz, run }); last = D.t; }
    return false;
  }, maxSec, `the Green Beret behind ${victim.tag}`);
}

/**
 * The Green Beret shoulders the body of `tag` (he stands by it), carries it along `pts` and puts it down at the last
 * one: once nobody will see him on the way (pick-up, walk at carrying pace, drop), nor the body where it ends up.
 */
async function carryBody(D, tag, pts, { maxWait = 120, pad = 1.0, slack = 0.6, label = '' } = {}) {
  const gb = D.c('greenberet'), e = D.get(tag), why = [];
  const end = pts[pts.length - 1];
  await D.until(() => {
    why.length = 0;
    if (!routeClear(D, [[gb.x, gb.z]], { mode: 'walk', from: [gb.x, gb.z], hold: 1.5, slack, why, pad })) return dbg(D, why, `carry ${tag}: pick-up`);
    for (const v of [1.3, 1.6]) if (!routeClear(D, pts, { mode: 'walk', from: [gb.x, gb.z], speed: v, delay: 1.3, hold: 1.2, slack, why, pad })) return dbg(D, why, `carry ${tag}`);
    const f = bodySeen(D, end[0], end[1], 240, { step: 1 });
    if (f.length) return dbg(D, [`body at the end seen by ${f.join(',')}`], `carry ${tag}`);
    return true;
  }, maxWait, `window to carry ${tag}${label ? ' ' + label : ''}`).catch((err) => { throw new Error(`${err.message} [${why.slice(0, 3).join(' ')}]`); });
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', e);
  await D.until(() => gb.carrying === e, 10, `GB shoulders ${tag}`);
  for (const p of pts) await D.go('greenberet', p[0], p[1], { tol: 0.4 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, `${tag} put down`);
  await D.idle('greenberet');
}

/** The armoured car (its turret sweeps 155°; at its west turn-round it looks up the field's west edge). */
const car = (D) => D.world.vehicles.find((v) => v.vision && !v.destroyed);
/** It has just left the west turn-round, driving east: the west edge is out of its sight for the next ~50 s. */
const carGoneEast = (D) => { const v = car(D); return !v || (v.x > 26 && v.x < 40 && Math.cos(v.heading) > 0.3); };
/** It will stay out of sight of the west field for the next `sec` s (driving east, or far enough east coming back). */
const carAway = (D, sec) => { const v = car(D); return !v || (v.x > 26 && Math.cos(v.heading) > 0.3) || (v.x - 35) / 3 > sec; };

/** One man from the walled yard down the field's west edge, while the armoured car is away east. */
async function crossWestEdge(D, role) {
  // (round the yard's corner and down the edge in one go while the armoured car is away east: its turn-round, a
  // three-point turn that sometimes swings out west, looks into the yard and up the edge)
  await D.until(() => carGoneEast(D), 200, 'the armoured car drives off east');
  await sneak(D, LOGS[0], LOGS[1], { mode: 'crawl', role, label: `${role} down the west edge`, forbid: WEST_EDGE, horizon: 60 });
  // then on down the edge to the snow drift in the south-west corner, timed between e12's looks (the planner waits only
  // where he will not look), the car away east while he crosses the strip it sees from its turn-round, and off that
  // strip's eastern part (the hollow is the place to wait). On the snow, below e12's eyes, nobody sees a man lying (nor
  // his tracks: they show only in the near band)
  for (let k = 0; ; k++) {
    await D.until(() => { const v = car(D); return !v || (Math.cos(v.heading) > 0.3 && v.x > 40 && v.x < 60); }, 300, 'the armoured car well away east');
    // (the car driving its road is predicted well: its cone counts in this plan, shelters included)
    D.world.sneakVehicleEyes = true;
    let ok;
    try { ok = await sneak(D, SNOW_CORNER[0], SNOW_CORNER[1], { mode: 'crawl', role, label: `${role} to the snow`, forbid: CAR_STRIP_E, horizon: 100, noWait: true, walkerPad: 1.5 }); }
    finally { D.world.sneakVehicleEyes = false; }
    if (ok) break;
    // (cut short: back into the hollow to wait)
    await sneak(D, LOGS[0], LOGS[1], { mode: 'crawl', role, label: `${role} back to the hollow`, box: 10 });
    if (k > 8) throw new Error(`${role}: no way down to the snow`);
    await D.wait(3);
  }
  await sneak(D, 30.5, 97.5, { mode: 'crawl', role, label: `${role} along the snow` });
}

/** The south edge, from behind the brick ruin to the east side of the map (nobody but the car ever looks at it). */
const SOUTH_RUN = [[52, 103], [75, 104], [88, 101]];
/** The rocks in the south-east corner close the edge: round the west end of the wire belt south of the headquarters
 *  and along its north side to the east edge (at a run: the car will be back at its east turn-round soon). */
const SE_WALK = [[92.3, 88.8], [91.9, 88.4], [92.3, 87.3], [115.3, 94.3], [116.5, 95.7], [120.1, 100.7]];
/** Up the east edge to the railway gun's south-east end (no guard overlooks it). */
const EAST_EDGE = [[123.5, 99.5], [130.5, 96], [130.5, 80], [128, 72], [124, 64], [118, 60]];
/** The decoy north of the flatcar (in earshot of e27's east end, of e30's beat and of e32 on the north-east ruin's deck,
 *  who only turns his head), and where the Green Beret waits meanwhile. */
const DECOY_AT = [100.5, 40.5], DECOY_NEAR = [101.5, 46.5], GB_GUN = [108.5, 58.5];
/** The Sapper's charge spot (within 3 m of the foot of the gun's ladder, in the corridor behind e21). */
const CHARGE_AT = [99.5, 61.5];
/**
 * The gap between the headquarters' north-east corner and the end of the wall from it: a man lying down does not fit
 * through (the game's own paths for a crawler go round), so he stands up south of it (nobody sees a man there),
 * runs through while e19's sweep is turned away, and lies down again north of it.
 */
const GAP_S = [100.5, 72.5], GAP_N = [98.5, 69.5];
/** Where the Sniper and the Sapper lie by the gun's east side (nobody sees a man lying there). */
const SN_WAIT = [112.5, 57.5], SA_WAIT = [110.5, 56.5];
/** The north-east corner: where the team waits for the truck (no guard ever sees a man lying there; off its way in;
 * the Green Beret's a step further from the field than the others). */
const NE_CORNER = [120.5, 8.5], SN_CORNER = [123.5, 10.5], SA_CORNER = [121.5, 12.5];
/** Where each man lies in the corridor's north end before he crawls on past the men at the decoy. */
const STAGING = [106.5, 48.5];
/**
 * e30 takes the stand east of the decoy when he hears its first beep from the east part of his beat: bearing from the
 * decoy over -82° (-85° is where the guards' second stand round a lure, 50° off his own line, comes within 1.2 m of
 * e27's: ai/enemy-brain.js _decoySlot); from the west end of his beat (out of earshot there by a hair) he would take
 * the one north-west of it, from where he looks down the corridor.
 */
const E30_EAST = -82 * Math.PI / 180;
/**
 * The crawl from the corridor past the men at the decoy (behind their backs), west of the ruin's tower, up to the
 * ruin's corner and along its north wall 1.7 m off it (a man lying down keeps that far off a wall, round its corner too).
 */
const TO_MOUTH = [[104.9, 48.3], [104.2, 46.6], [103.8, 44.9], [104.3, 42.3], [107, 39], [108.4, 38.4]];
const PASSAGE = [[108.3, 35.3], [109.3, 34.3], [112, 34.3], [114.5, 34.3], [116.5, 34.3], [117.5, 27.5]];
/**
 * The corner of e29's loop round the pine where he turns back towards its south end: he looks along the ruin's north
 * wall on the leg before it, and halts at the south end 7 s after it, his head swinging across the wall's west end.
 * The man at the ruin's corner sets off along the wall as e29 comes up to it.
 */
const E29_TURN = [104, 20];

/**
 * One man along the south edge: while the armoured car stands at its west turn-round, more than 50 m off (its far
 * band reaches a standing man that far), he runs from the brick ruin to the lee of the rocks in the south-east corner
 * (nobody near enough to hear him), then walks up the east edge, which the car never sees.
 */
async function runSouthEdge(D, role, { east = true } = {}) {
  const u = D.c(role), why = [];
  await D.until(() => {
    why.length = 0;
    const v = car(D);
    if (v && !(v.x < 26 && v.z < 60)) return false; // (at its west turn-round or swinging round it)
    let L = 0, p0 = [u.x, u.z]; for (const q of SOUTH_RUN) { L += Math.hypot(q[0] - p0[0], q[1] - p0[1]); p0 = q; }
    return (routeClear(D, SOUTH_RUN, { mode: 'walk', from: [u.x, u.z], speed: 4.0, delay: 1.0, hold: 1, slack: 1.5, why })
      && routeClear(D, SE_WALK, { mode: 'walk', from: SOUTH_RUN.at(-1), speed: 4.0, delay: 1.0 + L / 4.0, hold: 1, slack: 2.0, why })) || dbg(D, why, `${role} along the south edge`);
  }, 400, `${role}: the car at its west turn-round, the south edge unwatched`);
  await D.stance(role, 'stand');
  await D.path(role, SOUTH_RUN, { run: true });
  await D.path(role, SE_WALK, { run: true });
  if (east) await D.path(role, EAST_EDGE);
  else await D.stance(role, 'crawl');
}

export const STAGES = [
  ['A', 'The start corner', async (D) => {
    const e1 = D.get('e1'), gb = D.c('greenberet');
    // the Sniper and the Sapper lie down behind the rocks (the armoured car's turn-round looks up the corner from 40 m)
    // (the Sniper first steps a pace north-west, off the rocks' foot, where he stands at the start)
    await D.go('sniper', 2.5, 11.5, { tol: 0.5, max: 10 });
    await D.stance('sniper', 'crawl');
    await D.stance('sapper', 'crawl');
    D.checkpoint('A0 the team behind the rocks in the north-west corner');
    // e1 walks his beat south of the rocks: when he sets off east from his west halt, the Green Beret runs out after him
    // (only when nobody else — e36 on the north edge above all — will see him walk after e1 and back with the body)
    const why = [];
    await D.until(() => {
      why.length = 0;
      if (e1.brain.atWait || Math.cos(e1.heading) < 0.9 || e1.x < 13.5 || e1.x > 16) return false;
      // (he walks out at 2.2 m/s, then keeps 2 m behind e1 at 1 m/s: both paces tried)
      return [1.2, 2.2].every((v) => routeClear(D, E1_STALK, { mode: 'walk', from: [gb.x, gb.z], speed: v, delay: 0.5, hold: 2, slack: 1.5, pad: 0.4, why, except: [e1] })) || dbg(D, why, 'after e1');
    }, 900, 'e1 sets off east, nobody else looking');
    await stalk(D, e1, { gap: 2.0, maxSec: 30 });
    await knife(D, e1, { reach: 3.0, maxSec: 20, follow: 2.0, quiet: 10 });
    D.checkpoint('A1 the Green Beret runs after e1 and knifes him from behind');
    // no guard sees the ground behind the start rocks (the armoured car's turn-round does, but a vehicle's crew notices
    // only men, never bodies): the body goes there, while e36 walks off east along the north edge
    await carryBody(D, 'e1', [[12, 15.5]], { maxWait: 30 });
    D.checkpoint('A2 the Green Beret carries the body behind the start rocks');
  }],
  ['B', 'The barricade guard', async (D) => {
    // the Green Beret and the Sniper south along the ruin's west side (nobody overlooks it) to the walled yard's north
    // wall: the yard's corner and the barricade's wire meet, so the way round is the gap east of the wire, in e11's face
    await sneak(D, 6.5, 38.5, { mode: 'crawl', role: 'greenberet', label: 'GB to the barricade', forbid: YARD_GAP });
    D.checkpoint('B1 the Green Beret crawls down the ruin\'s west side to the walled yard\'s north wall');
    await sneak(D, 6.5, 36.5, { mode: 'crawl', role: 'sniper', label: 'Sniper to the barricade', forbid: YARD_GAP });
    // both crawl up to the barricade's wire as the armoured car drives off east (its turn-round looks up here). e11
    // faces down the road. As e9, below the ruin, walks off east (he looks this way only from the west end of his beat),
    // the Sniper shoots e11 over the wire; the Green Beret walks round the wire's end and carries the body into the
    // walled yard. No such moment before the car comes back: both crawl back behind the yard's wall and try again
    const e9 = D.get('e9'), e11 = D.get('e11'), gb = D.c('greenberet'), sn = D.c('sniper'), why = [];
    for (let k = 0; ; k++) {
      if (k > 6) throw new Error('no moment to shoot e11');
      await D.until(() => carGoneEast(D), 300, 'the armoured car drives off east');
      await D.go('greenberet', BAR_GB[0], BAR_GB[1], { tol: 0.6, max: 40 });
      await D.go('sniper', BAR_SN[0], BAR_SN[1], { tol: 0.6, max: 30 });
      if (!k) D.checkpoint('B2 the Sniper follows; both crawl up to the barricade as the armoured car drives off');
      const kneel = { x: sn.x, z: sn.z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
      let go = false;
      await D.until(() => {
        why.length = 0;
        if (!carAway(D, 16)) return true; // (time to crawl back before the car can look up here)
        if (e9.brain.atWait || Math.cos(e9.heading) < 0.8 || e9.x > 28.5) return false;
        go = (unwitnessed(D, e11, kneel, { ahead: 1.2, strict: true, why })
          && routeClear(D, [[sn.x, sn.z]], { mode: 'walk', from: [sn.x, sn.z], hold: 1.5, slack: 0.5, why, except: [e11] })
          && routeClear(D, BAR_WAY, { mode: 'walk', from: [gb.x, gb.z], speed: 2.0, delay: 1.5, hold: 1.5, slack: 1.0, why, except: [e11] })
          && routeClear(D, YARD, { mode: 'walk', from: BAR_WAY.at(-1), speed: 1.4, delay: 9, hold: 1, slack: 1.5, why, except: [e11] })) || dbg(D, why, 'e11');
        return go;
      }, 120, 'e9 walks off east, nobody to see e11 fall');
      if (go) break;
      await D.go('sniper', 6.5, 36.5, { tol: 0.6, max: 30 });
      await D.go('greenberet', 6.5, 38.5, { tol: 0.6, max: 30 });
    }
    D.ability('sniper', 'sniper', e11);
    await D.until(() => !e11.alive, 4, 'e11 shot');
    D.checkpoint('B3 the Sniper shoots e11 at the barricade while e9 walks off east');
    // (the Sniper crawls back behind the yard's wall meanwhile, before the car comes back)
    D.order('sniper', { type: 'move', x: 6.5, z: 36.5 });
    await D.stance('greenberet', 'stand');
    await D.path('greenberet', BAR_WAY, { tol: 0.6 });
    await carryBody(D, 'e11', YARD, { maxWait: 6 });
    // (down at once, in the lee of the yard's east wall: the car's turn-round, swinging out west, sees the rest of it)
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', YARD_LEE[0], YARD_LEE[1], { tol: 0.2, max: 15 });
    D.checkpoint('B4 the Green Beret walks round the wire and carries the body into the walled yard');
  }],
  ['C', 'The south-west field', async (D) => {
    // out of the yard's open south side, down the west edge of the practice field (outside the base's zone), timed
    // between e12's looks west and the armoured car's turn-round; off the snow, where e12 would see tracks
    await crossWestEdge(D, 'greenberet');
    D.checkpoint('C1 the Green Beret crawls down the field\'s west edge to a hollow by a log pile, then on to the snow behind e12\'s back');
    // then east along the snow and behind the burned-out brick house, where nobody ever looks
    await sneak(D, BRICK[0], BRICK[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind the brick ruin' });
    D.checkpoint('C2 the Green Beret crawls east along the snow to the burned-out brick house');
  }],
  ['D', 'The south and east edges', async (D) => {
    await runSouthEdge(D, 'greenberet');
    D.checkpoint('D1 the Green Beret runs along the south edge while the armoured car is at its far turn-round, and walks up the east edge');
    await sneak(D, 110.5, 56.5, { mode: 'crawl', role: 'greenberet', label: 'GB to the gun' });
    D.checkpoint('D2 the Green Beret crawls in behind the railway gun');
  }],
  ['E', 'e27 and the decoy', async (D) => {
    const gb = D.c('greenberet'), e27 = D.get('e27'), w = D.world, why = [];
    // the decoy goes down at the corridor's north end, in earshot of e27's east end, of e30's beat and of e32 on the
    // north-east ruin's deck (he only turns his head: up there he never sees the ground); e29 on his loop, e21 at the gun
    // and the other posts are all just out of its reach. The Green Beret lies off by the gun's north-west end
    await sneak(D, DECOY_NEAR[0], DECOY_NEAR[1], { mode: 'crawl', role: 'greenberet', label: 'GB towards the decoy spot' });
    // (there and back in one go, crawling, when nobody will look at the spot while he lays it)
    await D.until(() => {
      why.length = 0;
      return routeClear(D, [[...DECOY_AT, 2.0], DECOY_NEAR], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.75, delay: 0.3, hold: 2, slack: 1.0, why, pad: 0.5 }) || dbg(D, why, 'decoy spot');
    }, 300, 'the decoy spot unwatched');
    await D.go('greenberet', ...DECOY_AT, { tol: 0.4 });
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('E1 the Green Beret lays his decoy at the corridor\'s north end, switched off');
    await D.go('greenberet', ...DECOY_NEAR, { tol: 0.5 });
    await sneak(D, GB_GUN[0], GB_GUN[1], { mode: 'crawl', role: 'greenberet', label: 'GB back to the gun' });
    D.checkpoint('E2 the Green Beret crawls back to the gun\'s north-west end');
  }],
  ['F', 'The Sniper follows', async (D) => {
    await journey.yard(D, 'sniper');
    D.checkpoint('F1 the Sniper slips round the end of the barricade\'s wire into the walled yard');
    await journey.field(D, 'sniper');
    D.checkpoint('F2 the Sniper crawls down the field\'s west edge and along the snow to the brick ruin');
    await journey.edges(D, 'sniper');
    D.checkpoint('F3 the Sniper runs along the south edge, walks up the east edge and lies down by the gun');
  }],
  ['G', 'The Sapper follows and sets the charge', async (D) => {
    await journey.yard(D, 'sapper');
    D.checkpoint('G1 the Sapper crawls down the ruin\'s west side and slips round the wire into the walled yard');
    await journey.field(D, 'sapper');
    D.checkpoint('G2 the Sapper crawls down the field\'s west edge and along the snow to the brick ruin');
    // (the foot of the gun's ladder is in the dead-end corridor between the gun and the wall from the headquarters:
    // its north-west mouth is where e21 stands, so the Sapper comes in from the south, by the gap between the
    // headquarters' corner and the wall's end)
    await runSouthEdge(D, 'sapper', { east: false });
    // (the armoured car's road runs past the south compound: its cone counts in this plan)
    D.world.sneakVehicleEyes = true;
    try { await sneak(D, GAP_S[0], GAP_S[1], { mode: 'crawl', role: 'sapper', label: 'Sapper behind the headquarters' }); }
    finally { D.world.sneakVehicleEyes = false; }
    D.checkpoint('G3 the Sapper runs along the south edge and crawls up behind the headquarters');
    await gapDash(D, 'sapper', GAP_S, GAP_N);
    await sneak(D, CHARGE_AT[0], CHARGE_AT[1], { mode: 'crawl', role: 'sapper', label: 'Sapper to the charge', box: 10 });
    D.ability('sapper', 'remoteBomb');
    await D.idle('sapper', 5);
    D.checkpoint('G4 the Sapper slips through the gap behind the headquarters and sets the remote charge at the foot of the gun\'s ladder');
    await sneak(D, GAP_N[0], GAP_N[1], { mode: 'crawl', role: 'sapper', label: 'Sapper back to the gap', box: 10 });
    await gapDash(D, 'sapper', GAP_N, GAP_S);
    await sneak(D, SA_WAIT[0], SA_WAIT[1], { mode: 'crawl', role: 'sapper', label: 'Sapper round the gun' });
    D.checkpoint('G5 back through the gap, round the gun\'s far end and down by the others');
  }],
  ['H', 'The decoy and the escape', async (D, ctx) => {
    const e27 = D.get('e27'), e30 = D.get('e30'), sn = D.c('sniper'), w = D.world;
    // the decoy on with e27 at the east end of his beat and e30 on the east part of his: both hear its first beep, e27
    // walks straight at it and e30 takes the stand east of it, and they stare at it from there, their backs to the way
    // north past the ruin (the field's other guards are out of its earshot; e32 on the ruin's deck only turns his head
    // to it). Should either still look at that way (e30 coming from the west end of his beat stands north-west of it),
    // off again, they walk back, and on again later
    const staring = (e) => e.brain.state === 'DECOY' && !e.isMoving && !e.path && Math.hypot(e.x - DECOY_AT[0], e.z - DECOY_AT[1]) < 3.5;
    const facing = (e) => { const a = Math.atan2(DECOY_AT[1] - e.z, DECOY_AT[0] - e.x) - e.heading; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.1; };
    const e30East = () => Math.hypot(e30.x - DECOY_AT[0], e30.z - DECOY_AT[1]) < 13.2 && Math.atan2(e30.z - DECOY_AT[1], e30.x - DECOY_AT[0]) > E30_EAST;
    const watched = () => [e27, e30].some((e) => [STAGING, ...TO_MOUTH].some(([x, z]) => staticSees(e, dummyAt(w, 'crawl', x, z), w, 0)));
    for (let k = 0; ; k++) {
      if (k > 4) throw new Error('e27 and e30 never stare at the decoy with their backs to the way north');
      await D.until(() => [e27, e30].every((e) => e.brain.state === 'IDLE') && e27.brain.atWait && e27.x > 100 && e30East(), 300, 'e27 at his east halt, e30 on the east part of his beat');
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => staring(e27) && staring(e30) && facing(e27) && facing(e30), 40, 'e27 and e30 stare at the decoy');
      if (!watched()) break;
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => [e27, e30].every((e) => e.brain.state !== 'DECOY'), 30, 'e27 and e30 give the decoy up');
    }
    D.checkpoint('H1 the Green Beret switches the decoy on: e27 and e30 walk over and stare at it');
    // one by one, crawling, up the corridor behind their backs and along the ruin's north wall into the north-east
    // corner, timed between e29's looks down the corridor from his loop
    await toCorner(D, 'sniper', SN_CORNER);
    D.checkpoint('H2 the Sniper crawls behind their backs, past the ruin, into the north-east corner');
    await toCorner(D, 'sapper', SA_CORNER);
    D.checkpoint('H3 the Sapper follows him into the corner');
    await toCorner(D, 'greenberet', NE_CORNER);
    D.checkpoint('H4 the Green Beret comes last, the decoy still holding e27 and e30');
    // the charge: the base wakes (the forced alarm: the blast brings everyone out) and the truck comes in from the east,
    // fired while the camp patrol p3 is at the far west end of its beat (woken there, it runs off south-west, nowhere
    // near the truck's stop; from its east end it comes this way), with e29 facing away from the corner (woken, his
    // eyes reach 22 m and more), and in a gap of e28's sweep (the Sniper rises to his knee to aim, which a man lying
    // there does not get away with, and e28 by the chapel wall, who overlooks the corner and the truck's stop, glances
    // at it every 2.7 s)
    const p3 = ['e23', 'e24', 'e25'].map((t) => D.get(t)), e34 = D.get('e34'), e28 = D.get('e28'), e29 = D.get('e29'), why = [];
    const kneel = () => dummyAt(D.world, 'walk', sn.x, sn.z);
    const clearOf = (e, T) => { const d = kneel(); for (let t = 0; t <= T; t += 0.05) if (staticSees(e, d, D.world, t)) return false; return true; };
    await D.until(() => {
      why.length = 0;
      if (!p3.every((e) => !e.alive || e.x < 60)) return false;
      if (e29.brain.routeIndex === 0) return false; // (on his way up to the loop's north end, or there: facing the corner)
      if (!clearOf(e28, 2.1)) return dbg(D, ['e28 glance'], 'the blast');
      return routeClear(D, [[sn.x, sn.z]], { mode: 'walk', from: [sn.x, sn.z], hold: 3.0, slack: 0.5, except: [e34, e28], why }) || dbg(D, why, 'the blast');
    }, 300, 'the camp patrol at its west end, e29 facing away, nobody looking at the Sniper');
    D.ability('sapper', 'detonate');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1').done, 5, 'the Leopold goes up');
    D.checkpoint('H5 the Sapper fires the charge: the Leopold is destroyed');
    // the Gatling gunner first (woken, he swings round at once), then e28 before his next glance
    await D.until(() => !sn.currentAction && !sn.pendingAbility, 5, 'the Sniper ready');
    D.ability('sniper', 'sniper', e34);
    await D.until(() => !e34.alive, 5, 'e34 shot');
    D.checkpoint('H6 the Sniper shoots the Gatling gunner e34 before he can turn his gun on the truck');
    await D.until(() => !sn.currentAction && !sn.pendingAbility && D.world.time >= (sn._boltT ?? -1), 5, 'the Sniper ready');
    D.ability('sniper', 'sniper', e28);
    await D.until(() => !e28.alive, 5, 'e28 shot');
    D.checkpoint('H7 the Sniper shoots e28 by the chapel wall, the last man who overlooks the corner and the truck\'s stop');
    const truck = () => D.world.byId('evac_truck');
    await D.until(() => { const v = truck(); return v && (v.speed || 0) < 0.1 && Math.hypot(v.x - 112, v.z - 6) < 2; }, 40, 'the truck stops');
    // all three at once (the base is up and its men are on their way), when nobody will see them walk to the door
    await toTruck(D, ['greenberet', 'sapper', 'sniper'], truck(), ctx);
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2').done, 40, 'everyone aboard');
    D.checkpoint('H8 the truck stops by the Gatling: all three climb aboard and it drives off');
  }],
];

/** The men walk to the truck's door together and climb in, once nobody will see any of them on the way or at it. */
async function toTruck(D, roles, v, ctx) {
  const why = [];
  await D.until(() => {
    why.length = 0;
    return roles.every((role) => {
      const u = D.c(role), bp = (ctx.boardPoint ?? boardPoint)(v, u), L = Math.hypot(bp.x - u.x, bp.z - u.z);
      return routeClear(D, [[bp.x, bp.z]], { mode: 'walk', from: [u.x, u.z], speed: 1.8, delay: 0.8, hold: 1.5 + L / 2.25, slack: 1.0, why });
    }) || dbg(D, why, 'to the truck');
  }, 60, 'the way to the truck unwatched');
  for (const role of roles) { await D.stance(role, 'stand'); D.ability(role, 'enterVehicle', v); }
  await D.until(() => roles.every((r) => D.c(r).vehicle === v), 30, 'all aboard');
}

/**
 * One man from the gun's east side to the north-east corner: up the corridor, past the men at the decoy and along the
 * ruin's north wall, timed on e29's loop round the pine.
 */
async function toCorner(D, role, spot) {
  await sneak(D, STAGING[0], STAGING[1], { mode: 'crawl', role, label: `${role} up the corridor`, box: 8, hold: 0.5 });
  // past the men at the decoy to the ruin's corner as e29 leaves the south end of his loop round the pine (he looks
  // down the corridor only from there), then round the corner and along the ruin's north wall as he stops looking
  // along it, past the wall's west end before he halts at the south end again and his head swings across it (his loop
  // is a fixed beat: these are fixed moments of it, ~2 s clear either side)
  const e29 = D.get('e29'), u = D.c(role), why = [], S_END = [101, 26];
  const dS = () => Math.hypot(e29.x - S_END[0], e29.z - S_END[1]);
  await D.until(() => {
    why.length = 0;
    if (e29.brain.atWait || e29.brain.routeIndex !== 3 || dS() < 0.5 || dS() > 1.8) return false;
    // (and the wall then clear of the others too, else he waits here, out of sight, for e29's next round; e31 walks
    // the ruin's deck just inside the wall, 4 m off but up behind it: keepWalker 2, not the planner's 4 m)
    return (routeClear(D, TO_MOUTH, { mode: 'crawl', from: [u.x, u.z], speed: 0.85, delay: 0.3, slack: 1.0, hold: 3, why })
      && routeClear(D, PASSAGE, { mode: 'crawl', from: TO_MOUTH.at(-1), speed: 0.85, delay: 21.5, slack: 1.5, except: [e29], keepWalker: 2, why })) || dbg(D, why, `${role} to the mouth`);
  }, 300, `${role}: e29 off from his loop's south end`);
  await D.path(role, TO_MOUTH, { tol: 0.6 });
  await D.until(() => {
    why.length = 0;
    if (e29.brain.atWait || e29.brain.routeIndex !== 1 || Math.hypot(e29.x - E29_TURN[0], e29.z - E29_TURN[1]) > 0.7) return false;
    return routeClear(D, PASSAGE, { mode: 'crawl', from: [u.x, u.z], speed: 0.85, delay: 0.3, slack: 1.0, except: [e29], keepWalker: 2, why }) || dbg(D, why, `${role} along the ruin`);
  }, 60, `${role}: e29 about to turn back towards his loop's south end`);
  // (one order round the corner to the wall's far side, the way the game paths a man lying down: no halts on it)
  D.order(role, { type: 'move', x: PASSAGE[2][0], z: PASSAGE[2][1] });
  await D.until(() => Math.hypot(u.x - PASSAGE[2][0], u.z - PASSAGE[2][1]) < 0.6 || (!u.path && !u.isMoving), 20, `${role} round the ruin's corner`);
  await D.path(role, PASSAGE.slice(3), { tol: 0.6 });
  // (the Green Beret, a step off the truck's way in, does the last metre from the west: he lies along it, not across.
  // A man lying down is 2.4 m long, and his head or feet in its lane stop the truck short of its stop, out of reach
  // of the door: browser run, the Green Beret at 279°, the truck blocked at x 124 until the woken base came up)
  if (role === 'greenberet') {
    await sneak(D, spot[0] - 1, spot[1], { mode: 'crawl', role, label: `${role} to the corner`, box: 12 });
    await D.go(role, spot[0], spot[1], { tol: 0.2, max: 10 });
  } else await sneak(D, spot[0], spot[1], { mode: 'crawl', role, label: `${role} to the corner`, box: 12 });
}

/**
 * Through the gap upright at a run, from `from` to `to` (5 m): he stands up, runs and lies down again inside one turn
 * of e19's sweep away from it (his head swings off the gap for under 2 s at a time; nobody else sees it).
 */
async function gapDash(D, role, from, to) {
  const u = D.c(role), why = [];
  await D.go(role, from[0], from[1], { tol: 0.2, max: 20 });
  await D.until(() => {
    why.length = 0;
    return (routeClear(D, [from], { mode: 'walk', from, hold: 0.5, slack: 0.3, why }) // (standing up)
      && routeClear(D, [to], { mode: 'walk', from, speed: 4.0, delay: 0.65, hold: 0.6, slack: 0.3, why })) || dbg(D, why, `${role} through the gap`);
  }, 120, `${role}: e19 looking away from the gap`);
  await D.stance(role, 'stand');
  // (one click, at once: a run of 4 s that nothing may delay)
  D.order(role, { type: 'move', x: to[0], z: to[1], run: true });
  await D.until(() => Math.hypot(u.x - to[0], u.z - to[1]) < 0.3 || (!u.path && !u.isMoving), 10, `${role} through the gap`);
  await D.stance(role, 'crawl');
}

/**
 * One man (the Sniper, the Sapper) from the start corner along the Green Beret's way, each leg timed the same way:
 * down the ruin's west side, round the walled yard, down the field's west edge (the car away east), behind the
 * brick ruin, along the south edge (the car away west), up the east edge to the gun.
 */
const journey = {
  /** down the ruin's west side to the walled yard */
  async yard(D, role) {
    await sneak(D, 6.5, 38.5, { mode: 'crawl', role, label: `${role} to the yard`, forbid: YARD_GAP });
    // round the end of the barricade's wire into the walled yard on foot, as e9 walks off east and the car is away
    const e9 = D.get('e9'), u = D.c(role), why = [], way = [BAR_GB, ...BAR_WAY.slice(1), ...YARD];
    await D.until(() => {
      why.length = 0;
      if (e9.brain.atWait || Math.cos(e9.heading) < 0.8 || e9.x > 28.5 || !carAway(D, 25)) return false;
      return routeClear(D, way, { mode: 'walk', from: [u.x, u.z], speed: 1.9, delay: 1.0, hold: 1, slack: 1.0, why }) || dbg(D, why, `${role} round the wire`);
    }, 600, `${role}: e9 off east, the car away`);
    await D.stance(role, 'stand');
    await D.path(role, way, { tol: 0.6 });
    await D.stance(role, 'crawl');
    await D.go(role, YARD_LEE[0], YARD_LEE[1], { tol: 0.2, max: 15 });
  },
  /** round the yard's corner, down the field's west edge and along the snow to the brick ruin */
  async field(D, role) {
    await crossWestEdge(D, role);
    await sneak(D, BRICK[0], BRICK[1], { mode: 'crawl', role, label: `${role} behind the brick ruin` });
  },
  /** along the south edge, up the east edge, and down by the gun */
  async edges(D, role) {
    await runSouthEdge(D, role);
    const spot = role === 'sniper' ? SN_WAIT : SA_WAIT;
    await sneak(D, spot[0], spot[1], { mode: 'crawl', role, label: `${role} to the gun` });
  },
};

export async function solve(D, ctx = {}) {
  const w = D.world;
  if (STOP) { const cp = D.checkpoint; D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  w.sneakTurns = true;
  // (the armoured car's cone is timed by its phase — away east / away west — not predicted: its turn-round manoeuvre
  // runs off its route; the south-edge check reads it as it drives the road: runSouthEdge)
  w.sneakVehicleEyes = false;
  // a man down (wounded, bleeding) is a failed run too
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null);
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
