/**
 * LIGHTS OUT e02 "Curfew": a full stealth solution, played only with player orders (docs/expansion/e02.md §11).
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run headless:
 *   node tools/solutions/run-headless.mjs e02            (--easy for the Easy data)
 * in the game: tests/e02-solution.test.mjs. Walkthrough: e02.walkthrough.mjs.
 *
 * Every knock-out is from behind, unwitnessed, and every man knocked out is cuffed where no comrade will see him lie
 * (a bound man seen is freed and both shout). Wins with every objective done, 0 detections and 0 exposures (the
 * driver's exposure watch).
 */
import { sneak, clearFor, unwitnessed, bodySeen, predict, walking, viewersOf } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { mirrorOf, ghostOn } from './ghost.mjs';
import { takeSpot } from '../../src/abilities/spy-actions.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const DBG = !!globalThis.process?.env?.E02DBG;

/** The man as the guards see him standing (a blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) <= r;

/** Does `e` (now and over the next `ahead` s, as predicted) have the man `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world, me = mirrorOf(e);
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = ghostOn(me); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
  }
  return false;
}

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 60 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

const KO_ID = { greenberet: 'knockoutFist', spy: 'knockoutChloroform', driver: 'knockoutClub' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him standing for `ahead` s, nobody else sees the blow (nor him walking in), and the man down will lie unseen for
 * `quiet` s (`later`: men who will be down by then). He then cuffs him at once (`cuff`).
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.4, ahead = 1.8, quiet = 30, later = [], maxSec = 240, cuff = true, lieDown = true, label = '' } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `ko ${victim.tag}`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > reach) return dbg(D, [`far ${Math.hypot(victim.x - u.x, victim.z - u.z).toFixed(1)}`], `ko ${victim.tag}`);
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why, except: later })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[u.x, u.z], [(u.x + victim.x) / 2, (u.z + victim.z) / 2], [victim.x, victim.z]], ahead + 0.6, { mode: 'walk', except: [victim, ...later], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  }, maxSec, `knock out ${victim.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
  if (cuff) await cuffMan(D, role, victim, { later });
  if (lieDown) await D.stance(role, 'crawl'); // (down beside him at once: a man standing over a body is seen far off)
}

/** `role` (GB or Spy) cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). */
async function cuffMan(D, role, victim, { maxSec = 25, later = [] } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > 2.2) { if (!u.path && !u.isMoving) D.order(role, { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, bare(u), { ahead: 2.2, strict: true, why, except: later })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  }, maxSec, `cuff ${victim.tag}`);
  D.ability(role, 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle(role, 5);
}

/** `role` shoulders bound `tag`, carries him along `pts` and puts him down at the last one, unseen. */
async function carryMan(D, role, tag, pts, { maxWait = 120, quiet = 300, later = [], label = '', hide = null } = {}) {
  const u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  // (`hide`: a spot nobody sees a man lying at — he crawls there and waits for the carry's window from it)
  if (hide) await crawlTo(D, role, hide[0], hide[1], { label: `${role} waits at (${hide})`, keepWalker: 3 });
  // (the pick-up, the walk at a carrier's pace, the put-down: the whole of it unseen, with a margin)
  let len = 0, px = u.x, pz = u.z;
  for (const [x, z] of pts) { len += Math.hypot(x - px, z - pz); px = x; pz = z; }
  const dur = 4.5 + (len + (hide ? 2 * Math.hypot(e.x - u.x, e.z - u.z) : 0)) / 0.8;
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[u.x, u.z], [e.x, e.z], ...pts], dur, { mode: 'walk', why, except: later })) return dbg(D, why, `carry ${e.tag}`);
    const f = bodySeen(D, end[0], end[1], quiet, { step: 1, except: later });
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  // (BCD §1.5: a man down who still has his cigarettes — the hand takes the pack first; then the man)
  for (let n = 0; n < 3 && u.carrying !== e; n++) {
    D.ability(role, 'hand', e);
    await D.until(() => u.carrying === e || (!u.currentAction && !u.pendingAbility && D.t > 0), 10, `${role} shoulders ${e.tag}`);
    await D.idle(role, 5);
  }
  if (u.carrying !== e) throw new Error(`${role} could not shoulder ${e.tag} (hand: ${ABILITIES.hand?.canUse?.(u, e, D.world)})`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${e.tag} put down`);
  await D.idle(role);
  await D.stance(role, 'crawl');
}

/** The spot `gap` m behind man `e` as he faces now (or as he will at a halt with `look` degrees). */
function behind(e, gap = 1.1, look = null) {
  const h = look != null ? (look * Math.PI) / 180 : e.heading;
  return [e.x - Math.cos(h) * gap, e.z - Math.sin(h) * gap];
}

/**
 * `role` walks up behind `victim` (from where he stands) once `ready()` holds and the way there stays unseen for the
 * walk (`except` men are not asked: the victim himself is, so he never looks round at him), then knocks him out and
 * cuffs him (knockOut).
 */
async function strike(D, role, victim, { ready = () => true, gap = 1.1, look = null, maxSec = 300, label = '', held = false, window = null, hold = 0, others = [], ko = {} } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `strike ${victim.tag}`);
    const [bx, bz] = behind(victim, gap, look), dur = Math.hypot(bx - u.x, bz - u.z) / 2.0 + 2.5;
    const pts = [[u.x, u.z], [(u.x + bx) / 2, (u.z + bz) / 2], [bx, bz]];
    // (`held`: the victim is talking to the Spy — DISTRACTED — and faces him, not his post: his own eyes are asked as
    // they look now, the planners' post cone would put them back on the alley)
    // (`others`: men held by the Spy's talk — they face him while it lasts: their eyes are asked as they look now)
    const exc = [...(held ? [victim] : []), ...others];
    if (!clearFor(D, pts, dur, { mode: 'walk', why, except: exc.length ? exc : null })) return dbg(D, why, `strike ${victim.tag}`);
    for (const o of others) {
      const all = [...pts, ...(window?.pts ?? [])];
      if (o.brain?.state !== 'DISTRACTED') return dbg(D, [`${o.tag} not held`], `strike ${victim.tag}`);
      if (all.some(([x, z]) => eyesOn(D, o, { x, z, y: D.world.grid.elevAt?.(x, z) ?? 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, 0.2))) return dbg(D, [`${o.tag} looks`], `strike ${victim.tag}`);
    }
    // (`hold`: he stays standing behind him that much longer — the blow, the cuffs — and the man down lies there as long)
    if (hold && !clearFor(D, [[bx, bz]], dur + hold, { mode: 'walk', why, except: [victim, ...others] })) return dbg(D, why, `strike ${victim.tag} (hold)`);
    if (hold) { const f = bodySeen(D, victim.x, victim.z, dur + hold, { except: [victim, ...others] }); if (f.length) return dbg(D, [`body seen by ${f.join(',')}`], `strike ${victim.tag} (hold)`); }
    // (`window` {pts, dur}: what comes right after the blow — the carry of the man down — must stay unseen too)
    if (window && !clearFor(D, window.pts, window.dur, { mode: 'walk', why, except: [victim, ...others] })) return dbg(D, why, `strike ${victim.tag} (after)`);
    if (held && pts.some(([x, z]) => eyesOn(D, victim, { x, z, y: D.world.grid.elevAt?.(x, z) ?? 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, 0.2))) return dbg(D, ['victim looks'], `strike ${victim.tag}`);
    return true;
  }, maxSec, `a moment to walk up behind ${victim.tag}${label ? ' ' + label : ''}`);
  const [bx, bz] = behind(victim, gap, look);
  await D.stance(role, 'stand');
  D.order(role, { type: 'move', x: bx, z: bz });
  // (or close behind him, shouldered off his exact spot by the victim's own body: within reach and behind his shoulders)
  const closeBehind = () => Math.hypot(u.x - victim.x, u.z - victim.z) < 1.6 && Math.cos(Math.atan2(u.z - victim.z, u.x - victim.x) - victim.heading) < 0.4;
  await D.until(() => Math.hypot(u.x - bx, u.z - bz) < 0.5 || (!u.path && !u.isMoving) || closeBehind(), 20, `${role} behind ${victim.tag}`);
  await knockOut(D, role, victim, { reach: 2.4, maxSec: 20, ...ko });
}

/** Points every `step` m along the polyline `pts` (a way to check whole, not by its corners). */
function along(pts, step = 1.5) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Seconds until the cross-alley's dog pair (l5 and his dog) is back within `r` m of x = `x` (its beat's crossing). */
function dogBackIn(D, x, r = 14, horizon = 120) {
  const l5 = D.get('l5');
  if (!l5?.alive || l5.ko) return Infinity;
  for (let t = 0; t <= horizon; t += 1) if (Math.abs(predict(l5, t).x - x) < r) return t;
  return Infinity;
}

const crawlTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'crawl', role, horizon: 60, ...o, label: o.label ?? `${role} → (${x},${z})` });
const walkTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'walk', role, horizon: 60, ...o, label: o.label ?? `${role} → (${x},${z})` });

/**
 * The low house's terrace (y 4.5, behind its parapet): nobody ever sees a man lying up there, and its outside stair
 * comes down to Via Marina by the court's gap. The washing hangs on its line at the terrace's east end.
 */
const TERRACE = { greenberet: [37.4, 111.4], tonino: [37.4, 113.6], sniper: [37.4, 115.8], spy: [39.6, 115.6] };
const STAIR_FOOT = [43.75, 118.3];
/** The south pavement under the port wall, out of a4's near band: the way east from the barricade. */
const LINE = [40.4, 111.6]; // the washing on the low house's terrace (a private's tunic)
/** The Spy's wait on the piazza behind the balustrade, over the steps' head: hidden from the cross-alley (its dog). */
const PIAZZA_WAIT = [44.2, 89.4];
/** The Scalinata's lowest steps, east of l2's corner: nobody ever sees a man lying there. */
const STEPS_LOW = [49.8, 91.4];
/** In front of the corner house's street door on Vico 2 (blk_c2:door). */
const DOOR_C2 = [51.1, 110.6];
/** The Spy's place to talk to l2 from the alley side: l2 turns east to him, his back to the steps' west corner. */
const SPY_TALK = [48.6, 92.1]; // (north-east of him: he turns his back on the alley and on the east recess)
/** The far side of the east recess at the steps' foot: nobody ever sees a man lying there. */
const EAST_RECESS = [53.6, 96.6];
/** The lowest steps of the Scalinata's west half, under the balustrade: a body left there is never seen. */
const STEPS_DUMP = [46.9, 92.1];
/** Where p5 is laid: along the balustrade east of his post, on the strip below the square's edge (out of every eye). */
const P5_DUMP = [59.0, 90.6];
/** Behind p5 on the balustrade (he looks north into the square): the Green Beret lies there for the blow. */
const P5_BEHIND = [55.2, 88.7];
/** The Spy's place north-east of p3's south-east corner: talking to him there turns p3's back on p5. */
const SPY_SE = [59.7, 85.6];
/** The Spy's place north-east of p1 at the gate; the Green Beret's wait under the palazzo's front south of the gate;
 *  p1's body along the palazzo's front north of the gate (out of sight of the courtyard). */
const SPY_GATE = [39.6, 56.2];
const SPY_WAIT_G = [41.6, 64.6];
const SPY_HIDE_G = [38.6, 63.4];
/** The Spy's place west of c2, at the cellar door: talking to him there turns c2's back on the yard. */
const SPY_C2 = [17.2, 61.3];
const SPY_YARD = [20.5, 63.8];
/** Salita W: its foot on the square (a crawler lines up 1.6 m out), a spot near its head inside its canyon. */
const SALITA_FOOT = [41.75, 55.6];
const SALITA_UP = [41.75, 26.0];
const GROUP_WAIT = [41.75, 30.0];
/** Behind u2 at the mouth of the cistern lane (he looks south over Via Alta); his body up the lane. */
const U2_BACK_APPROACH = [14.9, 15.4];
/** The Spy's place on the road south of u2: talking to him there turns u2's back on the lane. */
const SPY_U2 = [12.6, 16.8];
const U2_DUMP = [12.2, 10.0];
/** The cistern's arch (the exit zone, r 2.6). */
const EXIT_AT = [12.5, 6.8];
/** Tonino's way from the terrace: down its stair, up Vico 2 and the steps' middle, the square's west side, Salita W. */
const TONINO_WAY = [[43.75, 117.7], [50, 95.2], [50, 88.6], [42.4, 62], [41.75, 55.6], [41.75, 36.0]];
const SNIPER_CANYON = [41.75, 31.0];
const SPY_CANYON = [40.4, 44.0];
const GB_P2 = [37.3, 62.1];
const P1_DUMP = [37.1, 52.6];
const P2_DUMP = [37.0, 62.8];
/** The Sniper's way from the terrace to the bell tower's foot (crawling where the piazza's guards look). */
const SNIPER_WAY = [[43.75, 117.7], [50, 95.2], [50, 88.6], [72, 89.6], [82.6, 86], [82.6, 60], [69.2, 59.2]];
/** The belfry deck (y 16): 38 m from the roof searchlight. */
const SNIPER_PERCH = [66.2, 58.2];

/** One man from wherever he lies to the terrace: over the avenue to the stair's foot, up it and onto the terrace. */
async function toTerrace(D, r) {
  // (a4 turning at his west halt sweeps past the tram's end: his cones a little wider in this plan)
  await crawlTo(D, r, STAIR_FOOT[0], STAIR_FOOT[1], { label: `${r} over the avenue to the stair`, horizon: 90, coneMargin: [10, 1] });
  const [x, z] = TERRACE[r];
  await crawlTo(D, r, x, z, { label: `${r} up onto the terrace`, keepWalker: 2.5, crawlPad: 0 });
  D.log(`${r} on the terrace t=${D.t.toFixed(1)}`);
}

export const STAGES = [
  ['A', 'Over the avenue to the low house', async (D) => {
    // the team lies down behind the burning tram; a4 walks the pavement on the north side (at his west end he looks up
    // Vico 1), a DF van [H] cruises the avenue. They crawl over the avenue behind a4, under the house fronts to the low
    // house's outside stair and up onto its terrace, where nobody ever sees a man lying behind the parapet
    for (const r of ['greenberet', 'spy', 'sniper', 'tonino']) await D.stance(r, 'crawl');
    D.checkpoint('A0 the team lies down behind the barricade');
    await D.parallel(() => toTerrace(D, 'greenberet'), () => toTerrace(D, 'spy'));
    await toTerrace(D, 'tonino');
    await toTerrace(D, 'sniper');
    D.checkpoint('A1 the four crawl over the avenue and up onto the low house\'s terrace');
  }],
  ['B', 'The washing', async (D) => {
    // the Spy gets up at the line on the terrace, takes the private's tunic off it and puts it on: unseen, when a4 is
    // away down the avenue and the dog pair far along the cross-alley
    const spy = D.c('spy'), line = D.item('uniform_line');
    const at = takeSpot(D.world, spy, line) || { x: LINE[0] + 0.6, z: LINE[1] + 0.8 };
    await crawlTo(D, 'spy', at.x, at.z, { label: 'the Spy under the washing', keepWalker: 2.5, crawlPad: 0 });
    // (standing up there he shows over the parapet: l1 from Vico 2, the dog pair from the cross-alley)
    await D.until(() => clearFor(D, [[spy.x, spy.z], [at.x, at.z]], 11, { mode: 'walk' }), 300, 'nobody looking at the terrace');
    D.log(`B: the terrace unwatched at t=${D.t.toFixed(1)}`);
    await D.stance('spy', 'stand');
    D.order('spy', { type: 'ability', id: 'use', target: line });
    await D.until(() => spy.disguised, 15, 'the Spy in the tunic');
    await D.idle('spy', 6);
    await D.stance('spy', 'crawl'); // (down behind the parapet again: the dog sees through any tunic)
    D.checkpoint('B1 the Spy takes the private\'s tunic off the washing line and puts it on');
  }],
  ['C', 'The Spy at the Scalinata', async (D) => {
    // a private's tunic fools l1 and l2 (privates both); the dog does not care what he wears: he walks down the stair,
    // up Vico 2 behind l1 and on to the foot of the steps, past l2, and talks to him from the steps: l2 turns his back
    // on the alley
    const spy = D.c('spy'), l2 = D.get('l2');
    await crawlTo(D, 'spy', STAIR_FOOT[0], STAIR_FOOT[1] - 0.6, { label: 'the Spy down the stair', keepWalker: 2.5, crawlPad: 0, disguise: 'soldier' });
    await crawlTo(D, 'spy', STEPS_LOW[0], STEPS_LOW[1], { label: 'the Spy up Vico 2 to the steps', horizon: 90, disguise: 'soldier', keepWalker: 2 });
    await walkTo(D, 'spy', PIAZZA_WAIT[0], PIAZZA_WAIT[1], { label: 'the Spy up the steps', horizon: 60, disguise: 'soldier', keepWalker: 2 });
    D.checkpoint('C1 in the tunic the Spy walks up Vico 2 past l1 and l2 and up the steps to the piazza');
  }],
  ['D', 'l1 and l2', async (D) => {
    // l1 walks Vico 2 up and down; at its avenue end he stands 5 s looking out over Via Marina. The corner house on the
    // alley's east side is unlocked: the Green Beret slips in while l1 is up at the north end, and steps out behind him
    // as he walks back down; the Spy meanwhile talks to l2 from the steps (l2 turns his back on the alley)
    const l1 = D.get('l1'), l2 = D.get('l2'), gb = D.c('greenberet'), door = D.item('blk_c2:door');
    await crawlTo(D, 'greenberet', STAIR_FOOT[0], STAIR_FOOT[1] - 0.6, { label: 'the Green Beret down the stair', keepWalker: 2.5, crawlPad: 0 });
    await crawlTo(D, 'greenberet', DOOR_C2[0], DOOR_C2[1], { label: 'the Green Beret to the corner house door', horizon: 90, keepWalker: 3, crawlPad: 1.5 });
    D.order('greenberet', { type: 'ability', id: 'use', target: door });
    await D.until(() => gb.hideout === door, 10, 'the Green Beret inside the corner house');
    D.checkpoint('D1 the Green Beret crawls down the stair and into the unlocked corner house on Vico 2');
    // (the dog pair away along the cross-alley and not back at Vico 2 for 40 s: the knock-outs and the walk up the alley
    // take ~30 s, the Spy stands on the steps in view of the alley's crossing meanwhile)
    const dogAway = () => dogBackIn(D, 50) > 52;
    await D.until(() => !l1.brain?.atWait && Math.sin(l1.heading) > 0.5 && l1.z > 104 && l1.z < 108 && dogAway(), 600, 'l1 walking back south, the dog pair away');
    await D.go('spy', SPY_TALK[0], SPY_TALK[1], { tol: 0.4 });
    D.order('spy', { type: 'ability', id: 'distract', target: l2 });
    await D.until(() => l2.brain?.state === 'DISTRACTED', 15, 'l2 talking to the Spy');
    await D.until(() => l1.z > 111.5, 15, 'l1 past the door');
    D.order('greenberet', { type: 'exit' });
    await D.until(() => !gb.hideout, 5, 'the Green Beret out of the house');
    D.checkpoint('D2 as l1 walks back down to the avenue the Spy talks to l2 from the alley side; the Green Beret steps out behind l1');
    await strike(D, 'greenberet', l1, { ready: () => near(l1, 50.25, 116, 0.4) && l1.brain?.atWait, look: 90, maxSec: 30, label: 'at the south end of Vico 2', ko: { later: ['l2'] } });
    D.checkpoint('D3 he knocks l1 out from behind at the end of his beat and cuffs him');
    // (l2 faces the Spy, north-east, and stays so while the Spy talks. The Green Beret crawls up the alley — over the
    // cross-alley's mouth on his belly: l3 and [H] l4 see a man standing there — into the far side of the east recess;
    // when p3 has his back to the steps he gets up, walks round behind l2 and knocks him out, cuffs him and carries him
    // onto the lowest steps, where nobody ever looks)
    await crawlTo(D, 'greenberet', EAST_RECESS[0], EAST_RECESS[1], { label: 'the Green Beret up the alley to the east recess', horizon: 90, keepWalker: 3 });
    const back = () => behind(l2, 0.9);
    await D.until(() => {
      const why = [];
      const ok = l2.brain?.state === 'DISTRACTED' && clearFor(D, along([[gb.x, gb.z], [49.6, 95.6], back(), [l2.x, l2.z], STEPS_DUMP], 1.2), 16, { mode: 'walk', except: [l2], why });
      if (!ok) dbg(D, why, 'window for l2');
      return ok;
    }, 300, 'a moment to walk round behind l2');
    await strike(D, 'greenberet', l2, { ready: () => l2.brain?.state === 'DISTRACTED', held: true, gap: 0.9, maxSec: 20, label: 'talking to the Spy', ko: { lieDown: false } });
    await carryMan(D, 'greenberet', 'l2', [STEPS_DUMP], { label: 'onto the lowest steps', maxWait: 20 }); // (he lies down by him)
    D.checkpoint('D4 he crawls up into the east recess, walks round behind l2, who is talking to the Spy, knocks him out and carries him onto the lowest steps');
    await D.go('spy', PIAZZA_WAIT[0], PIAZZA_WAIT[1], { tol: 0.5 });
  }],
  ['E', 'The sergeant', async (D) => {
    // p5, the sergeant of the piazza, stands on the balustrade by the head of the steps looking up into the square;
    // p3 laps the square and stops 4 s at its south-east corner, beyond the searchlight's reach. The Spy — a private to
    // p3, not to the sergeant — walks along the square's south edge behind p5 to that corner and talks to p3 there (p3
    // turns his back on p5). The Green Beret crawls up the steps and in behind p5, knocks him out, carries him along the
    // balustrade and cuffs him; then knocks out p3, still talking, and cuffs him where he falls. The Spy takes p5's
    // tunic off him (hanger) and changes into it: a sergeant now
    const p5 = D.get('p5'), p3 = D.get('p3'), spy = D.c('spy');
    await walkTo(D, 'spy', SPY_SE[0], SPY_SE[1], { label: 'the Spy along the square\'s south edge behind p5', disguise: 'soldier', horizon: 90, keepWalker: 1.5, keep: 0.5 });
    await D.until(() => near(p3, 58, 86, 0.7) && p3.brain?.atWait, 300, 'p3 at the square\'s south-east corner');
    D.order('spy', { type: 'ability', id: 'distract', target: p3 });
    await D.until(() => p3.brain?.state === 'DISTRACTED', 15, 'p3 talking to the Spy');
    D.checkpoint('E1 at the square\'s south-east corner the Spy, a private to him, talks to p3: p3 turns his back on p5');
    await crawlTo(D, 'greenberet', P5_BEHIND[0], P5_BEHIND[1], { label: 'the Green Beret up the steps and in behind p5', keepWalker: 3, keep: 0.8, ignore: ['p3'] });
    await strike(D, 'greenberet', p5, { gap: 0.9, maxSec: 300, label: 'on the balustrade', hold: 3, others: [p3],
      window: { pts: along([[p5.x, p5.z + 1], P5_DUMP], 1.0), dur: 14 }, ko: { lieDown: false, quiet: 4, cuff: false } });
    await carryMan(D, 'greenberet', 'p5', [P5_DUMP], { label: 'along the balustrade', maxWait: 10, later: [p3] });
    await cuffMan(D, 'greenberet', p5, { later: [p3] });
    D.checkpoint('E2 the Green Beret crawls in behind p5, knocks him out, carries him along the balustrade and cuffs him');
    await strike(D, 'greenberet', p3, { held: true, gap: 0.9, maxSec: 120, label: 'talking to the Spy' });
    D.checkpoint('E3 then p3, still talking to the Spy: knocked out from behind and cuffed where he falls');
    const at = [p5.x, p5.z - 0.9];
    await D.until(() => clearFor(D, [[spy.x, spy.z], at], 9, { mode: 'walk' }), 120, 'nobody looking at the balustrade');
    await D.stance('spy', 'stand');
    await D.go('spy', at[0], at[1], { tol: 0.3 });
    D.ability('spy', 'hanger', p5);
    await D.until(() => p5.uniformTaken, 8, 'p5\'s tunic taken');
    await D.idle('spy', 4);
    D.ability('spy', 'uniform');
    await D.until(() => spy.uniformType === 'sergeant', 6, 'the Spy in the sergeant\'s tunic');
    await D.idle('spy', 4);
    // (a sergeant on the square now: he strolls over to its west side, off the strip under the balustrade)
    await walkTo(D, 'spy', SPY_WAIT_G[0], SPY_WAIT_G[1], { label: 'the Spy, a sergeant, across the square', disguise: 'sergeant', horizon: 120, keepWalker: 2, keep: 0.5 });
    D.checkpoint('E4 the Spy takes p5\'s tunic off him and changes into it: a sergeant now');
  }],
  ['F', 'The belfry', async (D) => {
    // the Sniper comes down from the terrace, up Vico 2 and the steps, along the piazza's south edge behind p5's empty
    // place, round the back of the church to the bell tower's rungs and up into the belfry, where he lies flat
    // (past p4 [H] at the church's corner close behind his back: he looks up the square)
    for (const [x, z] of SNIPER_WAY) await crawlTo(D, 'sniper', x, z, { horizon: 120, label: `the Sniper → (${x},${z})`, keepWalker: 3, keep: 1.5 });
    await D.go('sniper', SNIPER_PERCH[0], SNIPER_PERCH[1], { tol: 0.6, max: 60 });
    await D.stance('sniper', 'crawl');
    D.checkpoint('F1 the Sniper climbs the bell tower\'s rungs into the belfry and lies flat on its deck');
  }],
  ['G', 'The gate', async (D) => {
    // the Spy — a sergeant now — walks up the square to the palazzo gate: p1, a sergeant too, takes him for one of
    // theirs, and the Spy talks to him from the north-east (p1 turns his back on the gate's south jamb and the bell
    // tower). The Green Beret crawls along the square's south and west edges under the palazzo's front to the south
    // jamb, knocks p2 out from behind and cuffs him there; then p1, still talking: out, cuffed, and dragged a few steps
    // north along the palazzo's front, out of sight of the courtyard
    const p1 = D.get('p1'), p2 = D.get('p2'), c3 = D.get('c3');
    await crawlTo(D, 'greenberet', GB_P2[0], GB_P2[1], { label: 'the Green Beret under the palazzo\'s front to the gate', horizon: 120, keepWalker: 3, keep: 0.8 });
    await walkTo(D, 'spy', SPY_WAIT_G[0], SPY_WAIT_G[1], { label: 'the Spy, a sergeant, up the square', disguise: 'sergeant', horizon: 120, keepWalker: 2, keep: 0.5 });
    // (the lieutenant, c3, sees through a sergeant's tunic — from the van, where he stands reading the log, he looks out
    // through the gate: the Spy steps in front of it only as c3 walks back to the main door)
    await D.until(() => !c3.brain?.atWait && near(c3, 24, 64.4, 3) && !near(c3, 24, 64.4, 0.6) && Math.sin(c3.heading) < -0.5, 300, 'c3 setting off from the van back to the main door');
    await D.go('spy', SPY_GATE[0], SPY_GATE[1], { tol: 0.3 });
    D.order('spy', { type: 'ability', id: 'distract', target: p1 });
    await D.until(() => p1.brain?.state === 'DISTRACTED', 15, 'p1 talking to the Spy');
    D.checkpoint('G1 the Spy, a sergeant to the sergeant on the gate, talks to p1: p1 turns his back on the gate\'s south jamb');
    await strike(D, 'greenberet', p2, { gap: 0.9, maxSec: 120, label: 'at the gate\'s south jamb', others: [p1], hold: 3,
      window: { pts: [[p2.x, p2.z], P2_DUMP], dur: 16 }, ko: { quiet: 8, lieDown: false } });
    // (laid along the palazzo's front south of the gate: out of every sight line through it from the yard)
    await carryMan(D, 'greenberet', 'p2', [P2_DUMP], { label: 'along the palazzo\'s front', maxWait: 30, later: [p1] });
    await strike(D, 'greenberet', p1, { held: true, gap: 0.9, maxSec: 60, label: 'talking to the Spy', hold: 6,
      window: { pts: [[p1.x, p1.z], P1_DUMP], dur: 18 }, ko: { lieDown: false, quiet: 8 } });
    await carryMan(D, 'greenberet', 'p1', [P1_DUMP], { label: 'along the palazzo\'s front', maxWait: 30 });
    // (the Spy steps back out of the gate's sight line: from the van the lieutenant looks out through it)
    await D.go('spy', SPY_HIDE_G[0], SPY_HIDE_G[1], { tol: 0.4 });
    D.checkpoint('G2 the Green Beret knocks out p2 from behind and cuffs him, then p1, and lays p1 along the palazzo\'s front');
  }],
  ['H', 'The searchlight', async (D) => {
    // nobody at the gate now: the Sniper kneels up in the belfry, 38 m from the roof, and fires once
    const c4 = D.get('c4'), sn = D.c('sniper');
    await D.until(() => {
      if (ABILITIES.sniper.canUse(sn, c4, D.world) !== true) return dbg(D, ['no sights'], 'shot');
      const me = bare(sn), seen = viewersOf(D.world).filter((e) => eyesOn(D, e, me, 2.4)).map((e) => e.tag);
      return !seen.length || dbg(D, seen, 'shot');
    }, 300, 'the searchlight in the Sniper\'s sights, nobody looking at the belfry');
    D.ability('sniper', 'sniper', c4);
    await D.until(() => !c4.alive, 10, 'the searchlight crew down');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 5, 'o2');
    await D.idle('sniper', 4);
    await D.stance('sniper', 'crawl');
    D.checkpoint('H1 one shot from the belfry: the searchlight crew falls and the beam goes out (objective 2)');
  }],
  ['I', 'The courtyard', async (D) => {
    // the lieutenant c3 reads the log at the van's tail, then walks back to the main door and stands there, his back to
    // the yard; c1 by the van looks west, c2 at the cellar door looks east out through the gate. As c3 sets off for the
    // door the Spy walks in — a sergeant to c2 — and talks to c2 from the cellar door (c2 turns his back on the yard).
    // The Green Beret slips in through the gate behind c1 and knocks him out, then c3 at the door, then c2: cuffed, all
    const c1 = D.get('c1'), c2 = D.get('c2'), c3 = D.get('c3');
    await D.until(() => !c3.brain?.atWait && near(c3, 24, 64.4, 3) && !near(c3, 24, 64.4, 0.6) && Math.sin(c3.heading) < -0.5, 300, 'c3 setting off from the van to the main door');
    await D.go('spy', SPY_C2[0], SPY_C2[1], { tol: 0.3 });
    D.order('spy', { type: 'ability', id: 'distract', target: c2 });
    await D.until(() => c2.brain?.state === 'DISTRACTED', 15, 'c2 talking to the Spy');
    D.checkpoint('I1 as c3 walks back to the main door the Spy, a sergeant to the cellar guard, talks to c2 at the cellar door');
    await strike(D, 'greenberet', c1, { gap: 0.9, maxSec: 40, label: 'by the van', others: [c2], hold: 4, ko: { quiet: 8, later: [c3] } });
    await strike(D, 'greenberet', c3, { gap: 0.9, maxSec: 40, label: 'at the main door', others: [c2], hold: 4, ko: { quiet: 8 } });
    await strike(D, 'greenberet', c2, { held: true, gap: 0.9, maxSec: 40, label: 'talking to the Spy', hold: 3 });
    D.checkpoint('I2 the Green Beret slips in behind c1 and knocks him out, then c3 at the main door, then c2: all cuffed');
    // the bearings log off the van's tailboard (objective 1); the cellar door: Captain Hollis (objective 3)
    const log = D.item('df_log');
    await D.stance('greenberet', 'stand');
    D.order('greenberet', { type: 'ability', id: 'use', target: log });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 20, 'o1');
    D.checkpoint('I3 the bearings log off the van\'s tailboard (objective 1)');
    await D.go('spy', SPY_YARD[0], SPY_YARD[1], { tol: 0.5 }); // (out of the cellar door's way)
    const cellar = D.item('cellar'), gbU = D.c('greenberet');
    const okUse = D.order('greenberet', { type: 'ability', id: 'use', target: cellar });
    D.log(`I: cellar ${cellar ? `(${cellar.x},${cellar.z}) jailed ${cellar.jailed?.().map((u) => u.role || u.id).join(',')}` : 'missing'} order ${okUse} canUse ${cellar?.canUse?.(gbU)}`);
    try { await D.until(() => D.world.objectives.find((o) => o.id === 'o3')?.done, 20, 'o3'); } catch (err) {
      const h = D.world.commandos.find((c) => c.id === 'hollis' || c.guestId === 'hollis');
      throw new Error(`${err.message} (hollis ${h ? `${h.state} id ${h.id} tag ${h.tag} role ${h.role}` : 'missing'}; GB at (${gbU.x.toFixed(1)},${gbU.z.toFixed(1)}) action ${gbU.currentAction?.id ?? '-'})`);
    }
    D.checkpoint('I4 the cellar door: Captain Hollis is free and follows the team (objective 3)');
  }],
  ['J', 'Out over Via Alta', async (D) => {
    // the way out: up Salita W, a stair in a canyon between the upper blocks, to Via Alta; west along it to the lane of
    // the aqueduct cistern. u1 walks Via Alta from end to end; u2 stands at the mouth of the cistern lane, looking out
    // over the road. Everyone gathers in the canyon of the stair, where nobody on Via Alta sees but straight down from
    // its head; Hollis keeps at the heels of the nearest of the team
    const u1 = D.get('u1'), u2 = D.get('u2'), spy = D.c('spy'), hollis = D.world.commandos.find((c) => c.guestId === 'hollis');
    const nearestTo = (h) => D.world.commandos.filter((c) => c !== h && c.alive && !c.follow).sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z))[0];
    await D.go('spy', hollis.x + 0.6, hollis.z + 1.0, { tol: 0.4 });
    await D.go('greenberet', 22.5, 57.5, { tol: 0.6 });
    await D.until(() => nearestTo(hollis) === spy, 10, 'Hollis with the Spy');
    // (one after the other up the stair: a man lying on it keeps to its middle, and nobody passes him there)
    await crawlTo(D, 'greenberet', SALITA_FOOT[0], SALITA_FOOT[1], { label: 'the Green Beret out of the gate to the foot of Salita W', horizon: 90, keepWalker: 3 });
    await crawlTo(D, 'greenberet', SALITA_UP[0], SALITA_UP[1], { label: 'the Green Beret up Salita W', horizon: 90, keepWalker: 3 });
    await D.parallel(
      async () => {
        await D.go('sniper', 69.2, 59.2, { tol: 0.6, max: 60 });
        await crawlTo(D, 'sniper', SALITA_FOOT[0], SALITA_FOOT[1], { label: 'the Sniper along the square\'s north edge to Salita W', horizon: 120, keepWalker: 3 });
        await crawlTo(D, 'sniper', SNIPER_CANYON[0], SNIPER_CANYON[1], { label: 'the Sniper up into Salita W', horizon: 90, keepWalker: 3 });
      },
      async () => {
        for (const [x, z] of TONINO_WAY) await crawlTo(D, 'tonino', x, z, { horizon: 120, label: `Tonino → (${x},${z})`, keepWalker: 3 });
      },
    );
    await walkTo(D, 'spy', SALITA_FOOT[0], SALITA_FOOT[1], { label: 'the Spy, Hollis at his heels, out of the gate to Salita W', disguise: 'sergeant', horizon: 90, keepWalker: 2, keep: 1 });
    await D.go('spy', SPY_CANYON[0], SPY_CANYON[1], { tol: 0.5, max: 60 });
    D.checkpoint('J1 the Sniper down from the belfry, Tonino up from the lower town, the Spy and Hollis out of the palazzo, the Green Beret: all in the canyon of Salita W');
    // (the Spy — a sergeant on the road — walks out to u2 and talks to him from the road: u2 turns his back on the lane.
    // Tonino stands by Hollis, who stays with him)
    await D.stance('tonino', 'stand');
    await D.go('tonino', hollis.x + 0.5, hollis.z + 0.5, { tol: 0.4 });
    await D.go('spy', GROUP_WAIT[0], GROUP_WAIT[1] - 3, { tol: 0.5 });
    await D.until(() => nearestTo(hollis) !== spy, 10, 'Hollis with Tonino');
    await walkTo(D, 'spy', SPY_U2[0], SPY_U2[1], { label: 'the Spy, a sergeant, along Via Alta to u2', disguise: 'sergeant', horizon: 90, keepWalker: 2, keep: 1 });
    D.order('spy', { type: 'ability', id: 'distract', target: u2 });
    await D.until(() => u2.brain?.state === 'DISTRACTED', 15, 'u2 talking to the Spy');
    D.checkpoint('J2 the Spy, a sergeant on Via Alta, talks to u2 at the mouth of the cistern lane: u2 turns his back on the lane');
    // (the Green Beret: as u1 walks off east past the stair's head, along Via Alta's north side on his belly, round u2
    // into the lane, a blow from behind and u2 carried up the lane out of sight)
    await D.until(() => u1.x > 44 && u1.x < 50 && Math.cos(u1.heading) > 0.7 && !u1.brain?.atWait, 300, 'u1 walking off east past the head of Salita W');
    await crawlTo(D, 'greenberet', U2_BACK_APPROACH[0], U2_BACK_APPROACH[1], { label: 'the Green Beret along Via Alta round u2', horizon: 60, keepWalker: 3, keep: 0.8, ignore: ['u2'] });
    await strike(D, 'greenberet', u2, { held: true, gap: 0.9, maxSec: 30, label: 'talking to the Spy', hold: 3,
      window: { pts: [[u2.x, u2.z], U2_DUMP], dur: 14 }, ko: { lieDown: false, cuff: false, quiet: 4 } });
    await carryMan(D, 'greenberet', 'u2', [U2_DUMP], { label: 'up the lane', maxWait: 10 });
    await cuffMan(D, 'greenberet', u2);
    D.checkpoint('J3 the Green Beret crawls along Via Alta round u2 into the lane: knocked out from behind, carried up the lane, cuffed');
    // (u1 walking off east past the stair's head again, his back to it: everyone up and along Via Alta into the lane)
    await D.until(() => u1.x > 44 && u1.x < 52 && Math.cos(u1.heading) > 0.7 && !u1.brain?.atWait, 300, 'u1 walking off east past the head of Salita W');
    await D.stance('sniper', 'stand');
    await D.parallel(
      () => D.go('spy', EXIT_AT[0], EXIT_AT[1], { tol: 0.8, max: 60 }),
      () => D.go('sniper', EXIT_AT[0] - 1, EXIT_AT[1] + 0.6, { tol: 0.8, max: 60 }),
      () => D.go('tonino', EXIT_AT[0] + 1, EXIT_AT[1] + 0.6, { tol: 0.8, max: 60 }),
      () => D.go('greenberet', EXIT_AT[0], EXIT_AT[1] - 1.2, { tol: 0.8, max: 60 }),
    );
    await D.until(() => D.world.objectives.find((o) => o.id === 'o4')?.done || D.won?.(), 30, 'o4: everyone in the cistern');
    D.checkpoint('J4 as u1 walks off east: everyone up the stair and along Via Alta into the cistern lane (objective 4)');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  D.straightDashes = true;
  w.sneakTurns = true;
  w.sneakVehicleEyes = true; // ([H] the second DF van cruising Via Marina: its crew's eyes count in every plan)
  w.sneakHeel = true; // (the cross-alley's dog heels its handler l5: predicted 1.5 m behind him, not on a beat of its own)
  w.sneakHeld = true; // (a post the Spy talks to faces him till the Spy lets him go: sneak.mjs postHeadings)
  w.sneakRunAxis = true; // (a crawler on the Scalinata keeps to its middle: pathfinding alignRuns)
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null) || w.scriptFail || null;
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
