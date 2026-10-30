/**
 * M10 "Operation Icarus" (El Agheila): a full stealth solution on foot, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m10 (also tests/m10-solution.test.mjs). Walkthrough: m10.walkthrough.mjs.
 *
 * Outline (dossier docs/missions/m10.md §11, the "verified foot route" without the stolen tank: boarding pz4 sounds
 * the camp siren by trigger T1, so the tank is left in its shed):
 *   A  the ruins: the Green Beret knifes the ruins' guards one by one from behind, then Patrol 4 man by man
 *   B  down the west edge: the team to the compound's north-west corner
 *   C  the west gate: e5 knifed south of the arch; the Green Beret climbs the west wall behind the crates
 *   D  the compound: e6, e7, e8 knifed and carried out through the west arch; McRae freed (objective 1)
 *   E  the bomb store: the Sapper's time bomb at the store door; everyone out of the compound before it goes up (o2)
 *   F  the wire field: the team crawls up between the belts; the Green Beret knifes both MG gunners at the ramp foot
 *   G  the dugout: the store blast woke the airfield (every explosion trips its zone: forced by the design), its three
 *      squads patrol the shelf; from below the cliff, where nobody up there can see a man (the roof rule), the Sapper
 *      grenades them as they pass the ramp head
 *   H  the Junkers: everyone up the ramp and aboard; McRae flies them out (objective 4)
 * Orders only (move / crawl / stance / ability); timing reads what a player sees: the cones.
 */
import { clearFor, routeClear, unwitnessed, bodySeen, predict, walking, sneak as sneak0 } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { shotClear } from '../../src/abilities/weapons.js';

const DBG = !!globalThis.process?.env?.M10DBG || !!globalThis.__M3DBG;

/** sneak.mjs sneak with this mission's margins: posts' cones a little wider and longer than drawn, sampled between
 *  steps (the game's own paths run a fraction of a metre off the planner's cells, and the game's step may lag the
 *  headless harness's by a tick) */
const SAFE = {};
const sneak = (D, x, z, o = {}) => sneak0(D, x, z, { ...SAFE, ...o });

/** The man as the guards see him standing (a knife blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/** Would the Sniper, risen to his knee where he lies, have a line of fire to `t` (the rifle's own test)? */
function fireLine(D, sn, t) {
  const k = sn.kneeling;
  sn.kneeling = true;
  try { return shotClear(D.world, sn, t, true); } finally { sn.kneeling = k; }
}

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

/** A wait's test, tried every `sec` s of game time (false in between): the look-ahead behind it is heavy, and the
 *  game's own frames run it live in video mode (no tick's work over budget; the same answer at most 0.1 s late). */
function poll(D, f, sec = 0.1) {
  let next = -Infinity;
  return () => { if (D.t < next - 1e-9) return false; next = D.t + sec; return f(); };
}

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % (+globalThis.process?.env?.M10DBGN || 120) === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/**
 * The Green Beret knifes `victim` once `ready()` holds, he is within `reach`, the victim does not see him coming and
 * nobody else sees the blow or the body (for `quiet` s, `later` = men who die before then). `follow` m: he keeps that
 * far behind a walking victim meanwhile.
 */
async function knife(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 3.5, run = false, follow = 0, crawl = false, label = '' } = {}) {
  const gb = D.c('greenberet'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  let last = -1;
  await D.until(poll(D, () => {
    why.length = 0;
    if (follow && D.t - last > 0.25) {
      const bx = victim.x - Math.cos(victim.heading) * follow, bz = victim.z - Math.sin(victim.heading) * follow;
      if (Math.hypot(gb.x - bx, gb.z - bz) > 0.5) { D.order('greenberet', { type: 'move', x: bx, z: bz }); last = D.t; }
    }
    if (!ready()) return dbg(D, ['not ready'], `knife ${victim.tag}`);
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > reach) return dbg(D, [`far gb@${gb.x.toFixed(1)},${gb.z.toFixed(1)} ${victim.tag}@${victim.x.toFixed(1)},${victim.z.toFixed(1)}`], `knife ${victim.tag}`);
    const me = bare(gb);
    if (eyesOn(D, victim, me, 1.6)) return dbg(D, ['victim looks'], `knife ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead: 1.6, strict: true, why })) return dbg(D, why, `knife ${victim.tag}`);
    // (and where the body ends up: struck from behind a man pitches forward onto his face, a metre on)
    const fall = Object.create(victim); fall.x = victim.x + Math.cos(victim.heading) * 1.0; fall.z = victim.z + Math.sin(victim.heading) * 1.0;
    if (!unwitnessed(D, fall, me, { ahead: 1.6, strict: true, why, except: [victim] })) return dbg(D, why, `knife ${victim.tag}: the fall`);
    // (where he stands up to strike: at the victim's side towards him, about a metre off)
    const L = Math.hypot(gb.x - victim.x, gb.z - victim.z) || 1, sx = victim.x + ((gb.x - victim.x) / L) * 1.0, sz = victim.z + ((gb.z - victim.z) / L) * 1.0;
    if (!clearFor(D, [[gb.x, gb.z], [(gb.x + victim.x) / 2, (gb.z + victim.z) / 2], [sx, sz]], crawl ? 3 : 2, { mode: 'walk', except: [victim], why })) return dbg(D, why, `knife ${victim.tag}`);
    const finders = [...bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] }), ...bodySeen(D, fall.x, fall.z, quiet, { except: [victim, ...later] })];
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    return true;
  }), maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  // (`crawl`: he crawls in and stands up only at arm's length — the knife's autoStand; no boot prints in the sand)
  if (!crawl && gb.stance !== 'stand') await D.stance('greenberet', 'stand');
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run });
  await D.until(() => !victim.alive, 10, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
}

/** A walkable spot `d` m behind standing guard `e` (the nearest one to the straight-back point). */
function behindOf(D, e, d) {
  const g = D.world.grid;
  for (let r = 0; r <= 1.5; r += 0.25) for (let a = 0; a < 8; a++) {
    const x = e.x - Math.cos(e.heading) * d + r * Math.cos((a * Math.PI) / 4), z = e.z - Math.sin(e.heading) * d + r * Math.sin((a * Math.PI) / 4);
    if (g.walkableAt(x, z)) return [+x.toFixed(2), +z.toFixed(2)];
  }
  return [e.x - Math.cos(e.heading) * d, e.z - Math.sin(e.heading) * d];
}

/** The Green Beret walks up behind walker `victim` and keeps `gap` m behind him (his back to him). */
async function stalk(D, victim, { gap = 2.0, maxSec = 30, run = false } = {}) {
  const gb = D.c('greenberet');
  if (typeof victim === 'string') victim = D.get(victim);
  let last = -1;
  await D.until(poll(D, () => {
    const bx = victim.x - Math.cos(victim.heading) * gap, bz = victim.z - Math.sin(victim.heading) * gap;
    if (Math.hypot(gb.x - bx, gb.z - bz) < 0.8) return true;
    if (D.t - last > 0.25) { D.order('greenberet', { type: 'move', x: bx, z: bz, run }); last = D.t; }
    return false;
  }), maxSec, `the Green Beret behind ${victim.tag}`);
}

/** A man walks along `pts` while the solution goes on (a side task: each point ordered when he reaches the last). */
function walkAlong(D, role, pts, { tol = 0.7, then = null } = {}) {
  let k = -1;
  const u = D.c(role);
  D.meanwhile(() => {
    const p = pts[k];
    if (k < 0 || Math.hypot(u.x - p[0], u.z - p[1]) < tol || (!u.path && !u.isMoving && !u.currentAction)) {
      if (k >= pts.length - 1) { then?.(); return true; }
      k++;
      try { D.order(role, { type: 'move', x: pts[k][0], z: pts[k][1] }); } catch { k--; }
    }
    return false;
  });
}

/** Several men walk their own ways at once ({role: [[x, z], …]}); resolves when all are there. */
async function teamPath(D, ways, { tol = 0.7, max = 120 } = {}) {
  const at = Object.fromEntries(Object.keys(ways).map((r) => [r, 0]));
  const go = (r) => { const p = ways[r][at[r]]; D.order(r, { type: 'move', x: p[0], z: p[1] }); };
  for (const r of Object.keys(ways)) go(r);
  await D.until(poll(D, () => {
    let done = true;
    for (const r of Object.keys(ways)) {
      const u = D.c(r), p = ways[r][at[r]];
      if (Math.hypot(u.x - p[0], u.z - p[1]) < tol || (!u.path && !u.isMoving && Math.hypot(u.x - p[0], u.z - p[1]) < 2.5)) {
        if (at[r] < ways[r].length - 1) { at[r]++; go(r); done = false; }
      } else done = false;
    }
    return done;
  }), max, 'the team on its way');
}

/**
 * A patrol walking in file, knifed man by man from its tail: each time the rearmost living man (the furthest behind the
 * leader along his heading), from behind, when the others in front do not see him fall.
 */
async function knifeFile(D, men, { maxSec = 20 } = {}) {
  const t0 = D.t;
  for (;;) {
    const alive = men.filter((e) => e.alive);
    if (!alive.length) return;
    const lead = alive.find((e) => e === men[0]) ?? alive[0], h = lead.heading;
    const behind = (e) => -((e.x - lead.x) * Math.cos(h) + (e.z - lead.z) * Math.sin(h));
    const last = alive.reduce((a, b) => (behind(b) > behind(a) ? b : a));
    const rest = alive.filter((e) => e !== last);
    await knife(D, last, { reach: 2.6, maxSec: Math.max(2, maxSec - (D.t - t0)), follow: 1.6, quiet: 30, later: rest, run: false });
  }
}

/**
 * The Green Beret shoulders the body of `tag` (he stands by it), carries it along `pts` and puts it down at the last
 * one: once nobody will see him on the way (pick-up, walk at carrying pace, drop), nor the body where it ends up.
 */
async function carryBody(D, tag, pts, { maxWait = 120, pad = 1.0, slack = 0.6, quiet = 240, label = '' } = {}) {
  const gb = D.c('greenberet'), e = D.get(tag), why = [];
  const end = pts[pts.length - 1];
  // (he waits for his moment lying down beside the body, not standing over it)
  if (gb.stance !== 'crawl') await D.stance('greenberet', 'crawl');
  await D.until(poll(D, () => {
    why.length = 0;
    if (!routeClear(D, [[gb.x, gb.z]], { mode: 'walk', from: [gb.x, gb.z], hold: 1.5, slack, why, pad })) return dbg(D, why, `carry ${tag}: pick-up`);
    for (const v of [1.3, 1.6]) if (!routeClear(D, pts, { mode: 'walk', from: [gb.x, gb.z], speed: v, delay: 1.3, hold: 1.2, slack, why, pad })) return dbg(D, why, `carry ${tag}`);
    const f = bodySeen(D, end[0], end[1], quiet, { step: 1 });
    if (f.length) return dbg(D, [`body at the end seen by ${f.join(',')}`], `carry ${tag}`);
    return true;
  }), maxWait, `window to carry ${tag}${label ? ' ' + label : ''}`).catch((err) => { throw new Error(`${err.message} [${why.slice(0, 3).join(' ')}]`); });
  await D.stance('greenberet', 'stand');
  // (from further off he walks over to it first)
  if (Math.hypot(gb.x - e.x, gb.z - e.z) > 1.6) await D.go('greenberet', e.x, e.z, { tol: 1.2, max: 40 });
  D.ability('greenberet', 'hand', e);
  await D.until(() => gb.carrying === e, 10, `GB shoulders ${tag}`);
  for (const p of pts) await D.go('greenberet', p[0], p[1], { tol: 0.4 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, `${tag} put down`);
  await D.idle('greenberet');
}

// ------------------------------------------------------------------ places (metres; +x east, +z south)
/** The strip under the escarpment north of the ruins, where the Green Beret waits for e2 (behind his beat's west end). */
const E2_WAIT = [18.5, 58.5];
/** His walk after e2, along the foot of the escarpment (the ruins' sand keeps boot prints: none where e3 could see them). */
const E2_CLIFF = [[20.5, 55.5], [27, 53], [35.5, 53]];
/** e3's decoy north of rw4 (in his earshot at his north halt, out of e1's and e4's), and the Green Beret's place west
 *  of the wall meanwhile (e3 walks round its east end to the decoy and stares at it, his back to him). */
const DECOY_E3 = [46.2, 72], E3_LURK = [36.5, 61.5], E3_BEHIND = [41.6, 72.4];
/** Round the east end of rw4 to its north side: e4, on his way round rw5, never sees e3's body there. */
const E3_HIDE = [[46.5, 69], [44.5, 64.5], [41, 62.5]];
/** The decoy north of rw5's end (in e4's earshot, out of e1's), and the Green Beret's place beyond the wall meanwhile. */
const DECOY_E4 = [36.5, 80], E4_LURK = [41.8, 90.2];
/** East of rw6, beside the south end of Patrol 4's beat (the wall stands between him and the file). */
const P4_LURK = [19.5, 91.5];
/** Behind e1 (he looks west-south-west, at the start wall). */
const E1_BEHIND = [26.5, 71.5];
/** Behind rw2, half-way along its east face: none of Patrol 4's places sees a body there (the wall stands between). */
const E1_HIDE = [24.6, 61.8];
/** The Green Beret's walk from e1 to the compound's north-west corner (down the west edge). */
const GB_EDGE = [[14, 80], [6, 100], [5, 130]];
/** The team's walk down the west edge, and where each lies down (e5 never sees that far up the edge). */
const HOLD_WAY = [[5, 100], [5, 118]];
const HOLD = { sniper: [6, 123], sapper: [4.5, 121.5], driver: [7.5, 124.5] };
/** Where the Green Beret lies waiting for e5: in the lee of the compound's north-west corner (never in e5's sight). */
const E5_LURK = [12.5, 149.8], CORNER_NW = [9.6, 151.6];
/** Where e5's body goes: round the corner, behind the north wall (out of sight of the arch and its approaches). */
const E5_HIDE = [16, 147.6];
/** The decoy outside the wall at e7's corner (in his earshot only, out of e6's): in the lee of the wall's southern
 *  stretch, ground the arch's gap never shows to anyone inside (not a man, a body or a boot print there), and the
 *  Green Beret's crawl to it down the outside of the west wall, past the arch. */
const DECOY_OUT = [25, 190], DECOY_OUT_WAY = [CORNER_NW, [15.2, 168], [16.8, 177.8], [25, 190]];
/** Where the Green Beret lies meanwhile: west of the decoy, beyond the fan of ground the arch's gap shows. */
const E7_LURK = [2.5, 190.5];
/** The decoy outside the wall north of the arch, in the lee of the wall's northern stretch (the gap shows e8 the ground
 *  south-west of it only): in e6's earshot from the middle of his beat, nobody else's; and where the Green Beret waits
 *  meanwhile, south of the gap by the wall (out of sight of the arch from inside and out, and behind e6 on his way). */
const DECOY_N = [16, 170], E6_LURK = [22, 181];
/** Out through the west arch to the foot of the wall south of it, where no one inside can see a body. */
const ARCH_OUT = [[23.2, 174.5], [19.2, 176.4], [17.2, 181.5]];
/** The west arch's inner mouth. */
const ARCH_IN = [22.8, 174.8];
/** Outside the bomb store's door. */
const STORE_DOOR = [42.2, 179.8];
/** The decoy in the west of the compound (in earshot of e8's west halt only), and where the Green Beret lies meanwhile
 *  (by the west wall, north of it: out of e8's way to it and out of his sight once he stares at it). */
const DECOY_W = [31.5, 170.5], GB_LURK_W = [20.5, 156.5];
/** Behind e9 (west of him, by the cage), and the lee of the wrecked lorry (e7 never sees a body there). */
const E9_BEHIND = [36.2, 158.2], E9_HIDE = [38, 161.3];

/** The Sapper's and the Driver's walks down the outside of the west wall (to the arch / the north-west corner). */
const SA_WAY = [[6, 140], [9.5, 153.5], [12.5, 163.5], [13.5, 171.5]];
const DR_WAY = [[6, 140], [10, 149]];
/** Where the team gathers, outside the compound's north-west corner (nobody sees it; the wall hides it from the gate). */
const TEAM_NW = { greenberet: [14.5, 148.6], guest: [12.8, 149.6], sapper: [16.5, 147.6], sniper: [11, 147.5], driver: [10, 149] };
/** Round the north wall and past the south end of the west wire belt, wide of the gate (e10 sees out through it). */
const FIELD_IN = [[22, 140], [28.5, 134.5], [33, 129.5]];
/** Up the field between the west belts (W1 / W2): nobody ever sees a crawling man in it. */
const FIELD_UP = [[38.5, 122], [44.6, 112], [49, 102], [50.5, 88]];
/** Where each lies at the field's north end, south of g1's nest (behind him). */
const FIELD_END = { greenberet: [54, 73], guest: [53, 79], sapper: [55.5, 74.5], driver: [55, 80.5], sniper: [51.5, 80.5] };
/** The Sniper's place for g2 and g1 (across the road from g2, out of his reach). */
const SN_G2 = [50.5, 72];
/** Where the others gather west of the ramp's foot (beyond g3's sight on the road below). */
const RAMP_FOOT = { greenberet: [64.5, 60.5], guest: [63.5, 62], sniper: [65.5, 59], driver: [64, 57.5] };
/** The Sapper's walk beside the ramp to the foot of the escarpment by the ramp head (west of the ramp: east of it the
 *  strip between the ramp and the wire belt is closed by the rocks at its foot). */
const SA_RAMP_WAY = [[57, 60], [63.5, 57.5], [66.5, 53]];

export const STAGES = [
  ['A', 'The ruins', async (D) => {
    const gb = D.c('greenberet'), why = [];
    D.straightDashes = { pad: 0.4 };
    // e2 walks the north of the ruins, from rw2 east to the wire. The Green Beret crawls along the foot of the
    // escarpment to behind his west halt; when e2 sets off east, he gets up, follows and knifes him from behind
    await sneak(D, E2_WAIT[0], E2_WAIT[1], { mode: 'crawl', role: 'greenberet', label: 'GB under the escarpment' });
    // (the Driver lies a little further north in the lee of rw1: from his start slot Patrol 4 can glimpse him as it
    // turns round at the north end of its beat)
    D.order('driver', { type: 'move', x: 11.3, z: 57.8 });
    D.checkpoint('A1 the Green Beret crawls along the foot of the escarpment behind e2\'s beat');
    const e2 = D.get('e2');
    // (along the foot of the escarpment, not across the ruins: e3 would see his boot prints in the sand and follow them;
    // he cuts down behind e2 only where rw4 hides the place from e3)
    await D.until(poll(D, () => {
      why.length = 0;
      if (e2.brain.atWait || Math.cos(e2.heading) < 0.9 || e2.x < 30.2 || e2.x > 31.5) return false;
      return routeClear(D, E2_CLIFF, { mode: 'walk', from: [gb.x, gb.z], speed: 2.1, delay: 0.7, hold: 1, slack: 1.0, pad: 0.4, why, except: [e2] })
        && routeClear(D, [[39, 58], [41, 60.5], [44, 61.5]], { mode: 'walk', from: E2_CLIFF.at(-1), speed: 1.5, delay: 9.5, hold: 2, slack: 1.5, pad: 0.4, why, except: [e2] }) || dbg(D, why, 'after e2');
    }), 400, 'e2 sets off east, nobody else looking');
    await D.stance('greenberet', 'stand');
    await D.path('greenberet', E2_CLIFF, { tol: 0.8 });
    await stalk(D, e2, { gap: 2.0, maxSec: 20 });
    await knife(D, e2, { reach: 3.0, maxSec: 15, follow: 2.0, quiet: 60 });
    D.checkpoint('A2 the Green Beret follows e2 east and knifes him from behind');
    // e3 walks between rw4 and rw3, out of everyone else's sight, but there is no getting behind him there before he
    // reaches e4's ground. The Green Beret lays his decoy by the wire east of e3's north halt (only e3 comes to it: g1,
    // in the MG nest beyond the wire, hears it too but only turns his head) and lies down north of rw4; switched on, it
    // draws e3 east to stare at it, his back to the ruins
    const e3 = D.get('e3');
    await D.stance('greenberet', 'crawl');
    await sneak(D, DECOY_E3[0], DECOY_E3[1], { mode: 'crawl', role: 'greenberet', label: 'GB to the decoy spot', box: 6, coneMargin: [8, 1] });
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('A3 the Green Beret lays his decoy by the wire east of rw4, where only e3 will come to it');
    await sneak(D, E3_LURK[0], E3_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB north of rw4', box: 8 });
    await D.until(() => e3.brain.atWait && Math.hypot(e3.x - DECOY_E3[0], e3.z - DECOY_E3[1]) < 13.2, 120, 'e3 at the north end of his beat');
    D.ability('greenberet', 'decoyToggle');
    const staring3 = () => e3.brain.state === 'DECOY' && !e3.isMoving && !e3.path && Math.hypot(e3.x - DECOY_E3[0], e3.z - DECOY_E3[1]) < 3.2;
    await D.until(staring3, 40, 'e3 at the decoy');
    await sneak(D, E3_BEHIND[0], E3_BEHIND[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e3', box: 8 });
    await knife(D, e3, { reach: 5, maxSec: 60, quiet: 60, crawl: true, ready: staring3 });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('A4 the decoy beeps: e3 walks over to it, and the Green Beret crawls round the wall and knifes him');
    const dec3 = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', dec3);
    await D.until(() => gb.has('decoy'), 15, 'the decoy picked up');
    // (e4 would see the body on his way round rw5 to the next decoy: it goes round the end of rw4, behind the wall)
    await carryBody(D, 'e3', E3_HIDE, { maxWait: 60 });
    // e4 watches the west of the ruins from beside rw5, and the wall leaves no way up behind him. The Green Beret lays
    // his decoy north of the wall's end (in e4's earshot only) and lies down on the wall's far side; switched on, it
    // draws e4 round the wall's end to stare at it, his back to the Green Beret
    const e4 = D.get('e4');
    await D.stance('greenberet', 'crawl');
    await sneak(D, DECOY_E4[0], DECOY_E4[1], { mode: 'crawl', role: 'greenberet', label: 'GB to the decoy spot', box: 6 });
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('A5 the Green Beret lays his decoy again, north of rw5, in e4\'s earshot only');
    await sneak(D, E4_LURK[0], E4_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB beyond rw5', box: 6 });
    D.ability('greenberet', 'decoyToggle');
    const staring4 = () => e4.brain.state === 'DECOY' && !e4.isMoving && !e4.path && Math.hypot(e4.x - DECOY_E4[0], e4.z - DECOY_E4[1]) < 3.2;
    await D.until(staring4, 40, 'e4 at the decoy');
    const b4 = behindOf(D, e4, 3.0);
    await sneak(D, b4[0], b4[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e4', box: 8, keep: 2.5 });
    await knife(D, e4, { reach: 4, maxSec: 60, quiet: 30, crawl: true, ready: staring4 });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('A6 e4 walks round rw5 to it, and the Green Beret, from beyond the wall, knifes him from behind');
    const dec4 = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', dec4);
    await D.until(() => gb.has('decoy'), 15, 'the decoy picked up');
    // e1 looks west, at the start wall, and from his post he sees the south of Patrol 4's beat: he goes before the
    // patrol. The Green Beret crawls round and comes at him from the east; the body goes behind rw2, where the patrol
    // never sees it
    const e1 = D.get('e1');
    await D.stance('greenberet', 'crawl');
    await sneak(D, E1_BEHIND[0], E1_BEHIND[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e1' });
    // (as the patrol walks off south from the north end of its beat: its back is to his post for the half minute it takes
    // to knife him and carry him off)
    const p4a = D.get('p4a');
    await knife(D, e1, { reach: 4.0, maxSec: 200, quiet: 22, crawl: true, ready: () => !p4a.brain.atWait && Math.sin(p4a.heading) > 0.8 && p4a.z > 77 && p4a.z < 83 });
    D.checkpoint('A7 the Green Beret crawls up behind e1 and knifes him');
    await carryBody(D, 'e1', [E1_HIDE], { maxWait: 90 });
    D.checkpoint('A8 and carries him behind rw2, out of the patrol\'s sight');
    // Patrol 4 walks the west edge, three men in file. The Green Beret crawls across to the lee of rw6, beside the
    // south end of its beat; when it turns back north he walks out after it and knifes the file from the back
    await D.stance('greenberet', 'crawl');
    await sneak(D, P4_LURK[0], P4_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB to rw6' });
    D.checkpoint('A9 the Green Beret crawls across the ruins to the lee of rw6, by the south end of Patrol 4\'s beat');
    const p4 = ['p4a', 'p4b', 'p4c'].map((t) => D.get(t));
    await D.until(poll(D, () => {
      why.length = 0;
      const a = p4[0];
      if (a.brain.atWait || a.z > 96.5 || a.z < 94 || Math.sin(a.heading) > -0.8) return false;
      return routeClear(D, [[18.6, 96.3], [a.x + 2, a.z + 4]], { mode: 'walk', from: [gb.x, gb.z], speed: 2.0, delay: 0.7, hold: 1.5, slack: 1.0, pad: 0.4, why, except: p4 }) || dbg(D, why, 'after Patrol 4');
    }), 300, 'Patrol 4 turns back north, nobody else looking');
    await D.stance('greenberet', 'stand');
    await knifeFile(D, p4, { maxSec: 14 });
    D.checkpoint('A10 the Green Beret knifes Patrol 4 man by man from the back of the file: the ruins are clear');
  }],
  ['B', 'Down the west edge', async (D) => {
    // nobody is left in the ruins: the team gets up and walks south down the west edge together, the Green Beret
    // ahead to the corner of the compound; they lie down short of e5's sight (he walks outside the west wall)
    for (const r of ['sniper', 'sapper', 'driver']) await D.stance(r, 'stand');
    await D.stance('greenberet', 'stand');
    // (each lies down where he stops; the Green Beret does not wait for them: he crawls on to the corner at once)
    const ways = { sniper: [[6.5, 72], ...HOLD_WAY, HOLD.sniper], sapper: [[5.5, 70], ...HOLD_WAY, HOLD.sapper], driver: [[7.5, 74], ...HOLD_WAY, HOLD.driver] };
    let down = 0;
    for (const [r, way] of Object.entries(ways)) {
      walkAlong(D, r, way, { then: () => {
        try { D.order(r, { type: 'stance', stance: 'crawl' }); } catch { /* busy */ }
        if (++down === 3) D.checkpoint('B1 the team walks down the west edge past the dead patrol and lies down north of the compound');
      } });
    }
    await D.path('greenberet', GB_EDGE, { tol: 0.7 });
    await D.stance('greenberet', 'crawl');
    await sneak(D, E5_LURK[0], E5_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB to the corner' });
    await D.until(() => down === 3 && ['sniper', 'sapper', 'driver'].every((r) => D.c(r).stance === 'crawl'), 60, 'the team down north of the compound');
    D.checkpoint('B2 the Green Beret crawls on to the compound\'s north-west corner');
  }],
  ['C', 'The west gate', async (D) => {
    const gb = D.c('greenberet'), e5 = D.get('e5'), why = [];
    // e5 walks outside the west wall, past the arch. When he sets off south from his north halt the Green Beret gets
    // up and follows him; he knifes him short of the arch (inside, the wall hides the body)
    await D.until(poll(D, () => {
      why.length = 0;
      if (e5.brain.atWait || Math.sin(e5.heading) < 0.8 || e5.z > 163) return false;
      // (round the corner of the walls first: the way to him starts west of it)
      return routeClear(D, [CORNER_NW, [e5.x - 1, e5.z - 2], [e5.x + 3, e5.z + 6]], { mode: 'walk', from: [gb.x, gb.z], speed: 2.0, delay: 0.7, hold: 2, slack: 1.5, pad: 0.4, why, except: [e5] }) || dbg(D, why, 'after e5');
    }), 300, 'e5 sets off south, nobody else looking');
    await D.stance('greenberet', 'stand');
    await D.go('greenberet', CORNER_NW[0], CORNER_NW[1], { tol: 0.8 });
    await stalk(D, e5, { gap: 2.0, maxSec: 20 });
    await knife(D, e5, { reach: 3.0, maxSec: 15, follow: 2.0, quiet: 120 });
    D.checkpoint('C1 the Green Beret follows e5 along the outside of the west wall and knifes him from behind');
    // (e7 will come out through the arch: the body goes round the corner, behind the north wall)
    await carryBody(D, 'e5', [CORNER_NW, E5_HIDE], { maxWait: 60 });
    D.checkpoint('C2 and carries him round the corner, behind the north wall');
  }],
  ['D', 'The compound', async (D) => {
    const gb = D.c('greenberet'), why = [];
    // e7 walks the south-west corner, within earshot of the ground outside the wall there: the decoy, laid out in the
    // lee of the wall's southern stretch, draws him out through the arch to stare at it, his back to the arch. The
    // arch's gap never shows that ground to anyone inside (a man, a body or a boot print), and e6 at his halt by the
    // arch is just out of the decoy's earshot
    const e6 = D.get('e6'), e7 = D.get('e7');
    // (past the arch crawling, when nobody inside looks out through its gap; no boot prints in the sand by it)
    const pastArch = async (way, label) => {
      await D.stance('greenberet', 'crawl');
      const [tx, tz] = way[way.length - 1];
      await sneak(D, tx, tz, { mode: 'crawl', role: 'greenberet', label: `GB ${label}`, box: 6 });
    };
    await pastArch(DECOY_OUT_WAY, 'to the decoy spot');
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('D1 the Green Beret slips past the arch and lays his decoy outside the wall, south of it');
    // on he crawls off west and lies down well out of the way of anyone coming out to it
    await sneak(D, E7_LURK[0], E7_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB west of the decoy', box: 6 });
    // the decoy on as e7 nears the south-west end of his beat: only he hears it, and walks out to it
    const staringAt = (e, at) => () => e.brain.state === 'DECOY' && !e.isMoving && !e.path && Math.hypot(e.x - at[0], e.z - at[1]) < 3.5;
    const staring7 = staringAt(e7, DECOY_OUT);
    await D.until(() => Math.hypot(e7.x - 32, e7.z - 192) < 6 && Math.hypot(e7.x - DECOY_OUT[0], e7.z - DECOY_OUT[1]) < 13, 300, 'e7 near the south-west end of his beat');
    D.ability('greenberet', 'decoyToggle');
    await D.until(staring7, 60, 'e7 out at the decoy');
    D.checkpoint('D2 the decoy beeps: e7 walks out through the arch to it and stares at it');
    // the Green Beret crawls up behind him (no prints) and knifes him; he falls by the decoy, where nobody will see him
    const b7 = behindOf(D, e7, 2.8);
    await D.stance('greenberet', 'crawl');
    await sneak(D, b7[0], b7[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e7', box: 8, keep: 2.2 });
    await knife(D, e7, { reach: 4.5, maxSec: 40, quiet: 120, crawl: true, ready: staring7 });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('D3 the Green Beret crawls up behind him and knifes him');
    const decO = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', decO);
    await D.until(() => gb.has('decoy'), 15, 'the decoy picked up');
    // e6 walks the inside of the west wall: the decoy, laid outside north of the arch, draws him out through it to
    // stare at it, his back to the arch, while the Green Beret waits south of the gap; he falls where only the wall sees
    await pastArch([DECOY_N], 'to the decoy spot north of the arch');
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('D4 the Green Beret crawls back past the arch and lays his decoy north of it, in earshot of e6 only');
    await sneak(D, E6_LURK[0], E6_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB south of the arch', box: 6 });
    const staring6 = staringAt(e6, DECOY_N);
    await D.until(() => Math.hypot(e6.x - DECOY_N[0], e6.z - DECOY_N[1]) < 13, 120, 'e6 in earshot');
    D.ability('greenberet', 'decoyToggle');
    await D.until(staring6, 60, 'e6 out at the decoy');
    D.checkpoint('D5 the decoy beeps: e6 walks out through the arch to it and stares at it');
    const b6 = behindOf(D, e6, 2.8);
    await D.stance('greenberet', 'crawl');
    await sneak(D, b6[0], b6[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e6', box: 8, keep: 2.2 });
    await knife(D, e6, { reach: 4.5, maxSec: 40, quiet: 120, crawl: true, ready: staring6 });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('D6 the Green Beret crawls up behind him and knifes him');
    const decN = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', decN);
    await D.until(() => gb.has('decoy'), 15, 'the decoy picked up');
    // e8 north of the store and e9 at the cage are left; e9 watches e8's whole beat, and the apron men see it through
    // the fence. The Green Beret crawls in, lays his decoy in the west of the compound (in earshot of e8's west halt
    // only) and lies down by the west wall, north of it
    const e8 = D.get('e8'), e9 = D.get('e9');
    await D.stance('greenberet', 'crawl');
    await sneak(D, DECOY_W[0], DECOY_W[1], { mode: 'crawl', role: 'greenberet', label: 'GB to the decoy spot' });
    D.ability('greenberet', 'decoyDrop');
    await D.idle('greenberet', 5);
    D.checkpoint('D7 the Green Beret crawls in and lays his decoy in the west of the compound');
    await sneak(D, GB_LURK_W[0], GB_LURK_W[1], { mode: 'crawl', role: 'greenberet', label: 'GB by the west wall' });
    // when e8 halts at the west end of his beat, the decoy beeps: he walks over and stares at it (it holds him there,
    // facing west, for as long as it beeps: from now on he sees nothing but the west wall)
    await D.until(() => e8.brain.atWait && Math.hypot(e8.x - DECOY_W[0], e8.z - DECOY_W[1]) < 13.3, 120, 'e8 at the west end of his beat');
    D.ability('greenberet', 'decoyToggle');
    const staring = () => e8.brain.state === 'DECOY' && !e8.isMoving && !e8.path && Math.hypot(e8.x - DECOY_W[0], e8.z - DECOY_W[1]) < 3;
    await D.until(staring, 30, 'e8 at the decoy');
    D.checkpoint('D8 the decoy beeps: e8 walks over and stares at it');
    // e9 at the cage looks east: the Green Beret crawls round the cage behind him and knifes him, and lays him north of
    // the wrecked lorry (e8, staring west, sees neither)
    await sneak(D, E9_BEHIND[0], E9_BEHIND[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e9', box: 8 });
    // (as e15, who sees the cage from the apron at the west end of his beat, walks off east: e9 is carried off long
    // before he is back)
    const e15 = D.get('e15'), e15off = () => !e15?.alive || (!e15.brain.atWait && Math.cos(e15.heading) > 0.5 && e15.x < 78.5);
    await knife(D, e9, { reach: 4.0, maxSec: 120, quiet: 20, crawl: true, ready: () => staring() && e15off() });
    D.checkpoint('D9 the Green Beret crawls round the cage and knifes e9 from behind');
    await carryBody(D, 'e9', [E9_HIDE], { maxWait: 60 });
    // then e8, still staring at the decoy, from behind
    const b8 = behindOf(D, e8, 3.0);
    await D.stance('greenberet', 'crawl');
    await sneak(D, b8[0], b8[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e8', box: 8, keep: 2.5 });
    await knife(D, e8, { reach: 4, maxSec: 60, quiet: 30, crawl: true, ready: staring });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('D10 and e8, still staring at the decoy');
    // nobody is left who looks at the west of the compound: both bodies out through the arch, the decoy picked up
    await carryBody(D, 'e8', [[29, 172], ...ARCH_OUT], { maxWait: 60 });
    await carryBody(D, 'e9', [[31, 165], [27, 169.5], ...ARCH_OUT], { maxWait: 60 });
    D.checkpoint('D11 the Green Beret carries both out through the arch');
    await D.stance('greenberet', 'stand');
    const dec = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
    if (dec) {
      await D.go('greenberet', dec.x + 0.6, dec.z, { tol: 0.8 });
      D.ability('greenberet', 'hand', dec);
      await D.until(() => gb.has('decoy'), 10, 'the decoy picked up');
    }
  }],
  ['E', 'McRae and the bomb store', async (D) => {
    const gb = D.c('greenberet'), mc = D.c('guest'), sa = D.c('sapper'), why = [];
    // the Sapper and the Driver come down the outside of the west wall meanwhile
    for (const r of ['sapper', 'driver']) await D.stance(r, 'stand');
    walkAlong(D, 'sapper', SA_WAY);
    walkAlong(D, 'driver', DR_WAY, { then: () => { try { D.order('driver', { type: 'stance', stance: 'crawl' }); } catch { /* busy */ } } });
    // nobody left in the compound looks at the cage door (e10 by the north gate faces the tent yard)
    await D.stance('greenberet', 'stand');
    await D.path('greenberet', [ARCH_IN, [27.5, 166], [31.5, 160.5]], { tol: 0.6 });
    D.ability('greenberet', 'use', D.item('pen_door'));
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1').done, 20, 'McRae free');
    await D.idle('greenberet', 5);
    D.checkpoint('E1 the Green Beret opens the cage: McRae is free (objective 1)');
    // out through the arch together, McRae ahead
    await teamPath(D, { guest: [[31.5, 160.5], [27, 167], ARCH_IN, [19.5, 175.8], [16, 168], TEAM_NW.guest], greenberet: [[29, 165], ARCH_IN, [19.8, 176.6], [16.5, 168.5], TEAM_NW.greenberet] });
    D.checkpoint('E2 McRae walks out through the arch and up the outside of the wall with the Green Beret');
    // the Sapper in through the arch to the store door: the time bomb (10 s), and out again the way he came
    // (he waits out of the way of McRae and the Green Beret coming out, west of the arch)
    await D.until(() => Math.hypot(sa.x - SA_WAY.at(-1)[0], sa.z - SA_WAY.at(-1)[1]) < 3 && !sa.path && !sa.isMoving, 120, 'the Sapper by the arch');
    await D.path('sapper', [ARCH_IN, [33, 177], STORE_DOOR], { tol: 0.5 });
    D.ability('sapper', 'timeBomb');
    await D.idle('sapper', 5);
    D.checkpoint('E3 the Sapper sets his time bomb at the bomb store\'s door');
    // (the blast is the checkpoint, ten seconds on, while he walks away: a side task marks it the tick it happens)
    const o2 = D.world.objectives.find((o) => o.id === 'o2');
    let blastCp = null;
    D.meanwhile(() => !!o2.done && !!(blastCp = D.checkpoint('E4 the bomb store goes up (objective 2)')));
    await D.path('sapper', [[33, 177], ARCH_IN, [19.8, 176.6], [16.5, 168.5], TEAM_NW.sapper], { tol: 0.6 });
    await D.until(() => !!blastCp, 20, 'the store goes up');
  }],
  ['F', 'The wire field', async (D) => {
    const gb = D.c('greenberet'), sn = D.c('sniper'), why = [];
    // the blast brought the camp to the store's door: everyone crawls off round the north wall, past the end of the
    // west wire belt (wide of the gate, where e10 looks out) and up the field between the belts (no crawling man is
    // ever seen in there: the MG nests on the road look the other way, the field's sand keeps no print of a crawl)
    for (const r of ['greenberet', 'guest', 'sapper', 'driver', 'sniper']) await D.stance(r, 'crawl');
    const into = (k, end) => [...FIELD_IN, [FIELD_UP[0][0] - k * 0.8, FIELD_UP[0][1] + k * 1.6], ...FIELD_UP.slice(1, -1), end];
    // (in file, the leader first and a few seconds apart: crawling men side by side get in each other's way)
    const file = [['greenberet', into(0, FIELD_END.greenberet)], ['sapper', into(2, FIELD_END.sapper)], ['guest', into(1, FIELD_END.guest)],
      ['driver', into(3, FIELD_END.driver)], ['sniper', [[8, 132], ...into(4, FIELD_END.sniper)]]];
    for (const [k, [r, way]] of file.entries()) {
      if (k) await D.wait(4);
      walkAlong(D, r, way);
    }
    await D.until(() => Object.entries(FIELD_END).every(([r, p]) => Math.hypot(D.c(r).x - p[0], D.c(r).z - p[1]) < 2.5 && !D.c(r).path && !D.c(r).isMoving), 300, 'the team up the wire field');
    D.checkpoint('F1 the team crawls round the north wall and up the field between the wire belts');
    // the two MG nests at the ramp's foot cover each other: g1 on the field's north end looks east over the road, g2
    // across the road looks west at the ramp. The Sniper, beyond g2's reach and behind g1's back, shoots g2 while g1's
    // head is turned south, then g1 before he can look round at him (the rifle is silent)
    const g1 = D.get('g1'), g2 = D.get('g2');
    await sneak(D, SN_G2[0], SN_G2[1], { mode: 'crawl', role: 'sniper', label: 'Sniper to the field\'s north end', box: 6 });
    await D.until(poll(D, () => {
      why.length = 0;
      if (!fireLine(D, sn, g2) || !fireLine(D, sn, g1)) return dbg(D, ['no line'], 'g2 g1');
      const me = bare(sn);
      if (eyesOn(D, g2, me, 1.2) || !unwitnessed(D, g2, me, { ahead: 1.4, strict: true, why })) return dbg(D, why, 'g2');
      if (eyesOn(D, g1, me, 3.0) || !unwitnessed(D, g1, me, { at: 1.0, ahead: 1.6, strict: true, why, except: [g2] })) return dbg(D, why, 'g1');
      const f = bodySeen(D, g2.x, g2.z, 2.6, { except: [g2] });
      return !f.length || dbg(D, [`body seen by ${f.join(',')}`], 'g2');
    }), 120, 'g1 looking south, nobody to see either fall');
    D.ability('sniper', 'sniper', g2);
    await D.until(() => !g2.alive, 3, 'g2 shot');
    await D.until(() => !sn.currentAction && D.t >= (sn._boltT ?? -1), 3, 'the Sniper reloads');
    D.ability('sniper', 'sniper', g1);
    await D.until(() => !g1.alive, 3, 'g1 shot');
    await D.idle('sniper', 3);
    D.checkpoint('F2 the Sniper shoots the MG gunner g2 across the road, then g1 on the field\'s north end');
  }],
  ['G', 'The dugout', async (D) => {
    const sa = D.c('sapper');
    // the store's blast woke the airfield: the dugout's three squads came out and patrol the shelf, crowding the ramp
    // head. Nobody up there can see down the escarpment (nor anyone below up onto it): the Sapper walks up beside the
    // ramp to the ground under the ramp head, out of their sight, and lobs his grenades up into them as they bunch
    await D.stance('sapper', 'stand');
    await D.path('sapper', SA_RAMP_WAY, { tol: 0.6 });
    D.checkpoint('G1 the Sapper walks up beside the ramp to the foot of the escarpment under the ramp head');
    const squads = () => D.world.enemies.filter((e) => e.alive && /^dugout#/.test(e.tag));
    const MIN = 7.5, MAX = 13.0, R = 3.8;
    for (let k = 0; squads().length && sa.has('grenade'); k++) {
      let best = null;
      await D.until(poll(D, () => {
        const men = squads();
        if (!men.length) return true;
        best = null;
        for (const p of men) {
          for (const [ox, oz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
            const x = p.x + ox, z = p.z + oz, d = Math.hypot(x - sa.x, z - sa.z);
            if (d < MIN || d > MAX || z > 48.2) continue;
            const n = men.filter((e) => Math.hypot(e.x - x, e.z - z) < R && Math.hypot(predict(e, 1.0).x - x, predict(e, 1.0).z - z) < R).length;
            if (!best || n > best.n) best = { x, z, n };
          }
        }
        const want = Math.min(men.length, k === 0 ? 6 : 2);
        return !!best && best.n >= want;
      }), 300, `the dugout men bunched in reach (${squads().length} left)`);
      if (!squads().length) break;
      D.ability('sapper', 'grenade', { x: best.x, z: best.z });
      await D.idle('sapper', 5);
      await D.wait(1.5);
      if (k === 0) D.checkpoint('G2 the Sapper lobs a grenade into the men bunched at the ramp head');
      D.log(`  (grenade ${k + 1}: ${best.n} of them in its reach, ${squads().length} left)`);
    }
    if (squads().length) throw new Error(`${squads().length} dugout men left and no grenade`);
    // (two grenades have always been enough; a third, should anyone still stand, is thrown under this one checkpoint,
    // which every run reaches: the walkthrough's caption goes straight on to the Junkers)
    D.checkpoint('G3 a second one into those who run to the blast: the dugout is cleared');
  }],
  ['H', 'The Junkers', async (D) => {
    const ju = D.world.byId('ju52'), mc = D.c('guest');
    // nobody is left on the airfield. The men at the field's north end crawl round the end of the belt to the foot of
    // the ramp first (g3, the MG further down the road, would see a man stand up in the field), then everyone walks up
    // the ramp to the Junkers, the passengers first, McRae last
    // (in file, a few seconds apart: crawling men side by side get in each other's way)
    for (const r of ['greenberet', 'sniper', 'guest', 'driver']) {
      walkAlong(D, r, [[58.2, 60.8], [62.4, 58.4], RAMP_FOOT[r]]);
      await D.wait(4);
    }
    await D.until(() => Object.entries(RAMP_FOOT).every(([r, p]) => Math.hypot(D.c(r).x - p[0], D.c(r).z - p[1]) < 2.5 && !D.c(r).path && !D.c(r).isMoving), 120, 'the team at the foot of the ramp');
    for (const r of ['greenberet', 'sniper', 'sapper', 'driver', 'guest']) await D.stance(r, 'stand');
    const board = (r) => D.ability(r, 'enterVehicle', ju);
    for (const r of ['sapper', 'greenberet', 'sniper', 'driver']) board(r);
    await D.until(() => ['sapper', 'greenberet', 'sniper', 'driver'].every((r) => D.c(r).vehicle === ju), 120, 'the team aboard the Junkers');
    D.checkpoint('H1 the team walks up the ramp and climbs into the Junkers');
    board('guest');
    await D.until(() => mc.vehicle === ju, 90, 'McRae aboard');
    D.checkpoint('H2 McRae climbs in last and takes the controls');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o4').done, 120, 'the Junkers takes off');
    D.checkpoint('H3 the Junkers taxis down the runway and takes off: mission complete');
  }],
];

export async function solve(D, ctx = {}) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
