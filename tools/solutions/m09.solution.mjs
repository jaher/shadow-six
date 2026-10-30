/**
 * M09 "A Courtesy Call" (Bab el Qattara): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m09 (also tests/m09-solution.test.mjs). Walkthrough: m09.walkthrough.mjs.
 *
 * Outline (dossier docs/missions/m09.md §11, Prima's two phases, with every patrol dealt with before the bangs): all
 * eighteen men on foot die unseen before the first blast, so the one alarm the mission forces wakes nobody but the
 * three Panzers, and they die in their bays (18 killed: 7 by the Green Beret, 5 by the Sniper's 5 rounds, 6 by the Spy;
 * no body is ever found):
 *   A  Patrol SE: as it walks off N up the E side, the Green Beret knifes it man by man from the back of the file
 *   B  the forecourt: the Sniper, outside its S fence, drops e2 at the S end of his beat and e1 at his post; the Green
 *      Beret climbs the broken stub, lays both behind the yellow drums, knifes e3 at the W opening and hides him
 *   C  Patrol NW: the Green Beret lies on the W strip below its S halt and knifes the file from its tail as it walks N
 *   D  the north yard: the Spy, in uniform, walks in at the E gate and injects e9, e4, e8 and e5 one by one, each the
 *      moment nobody left can see it, carrying every body behind house_n1 or the bunker
 *   E  the courtyard patrol: the Spy talks to its sergeant at the W end of its beat, all three facing him, and the
 *      Sniper shoots them through the inner gap from the forecourt's W corner, each falling out of the others' sight
 *   F  the E gate: the Spy injects e7 on his beat and e6 at his post and carries both out behind the NE wall
 *   G  the Sapper plants a remote bomb at the barracks door and one between the radio hut and the dish; the Driver
 *      parks the fuel tanker across the Panzers' bays; the Green Beret takes a drum from the pile to the bunker door
 *   H  the barracks bomb first (the garrison is razed by the blast that raises the alarm), then the other: the woken
 *      Panzers shoot the tanker blocking their bays and its fireball wrecks them; the Green Beret's pistol fires the
 *      bunker's drum and the pile (weapons store, command post); everyone boards our lorry
 * The only alarm is the one the first blast sounds, forced by the design: the whole map is one zone that hears every
 * explosion (alarm.js: any explosion raises every onHeard zone), and only a bomb's or a drum's blast brings the five
 * targets down. Wins with every objective done, 0 detections and 0 exposures, headless and in the browser.
 * Orders only (move / crawl / stance / ability / drive); timing reads what a player sees: the cones.
 */
import { clearFor, routeClear, unwitnessed, bodySeen as bodySeen0, predict, walking, sneak } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { shotClear } from '../../src/abilities/weapons.js';
import { TANKER_SPOT } from '../../src/missions/m09_a_courtesy_call.js';

const ENV = globalThis.process?.env ?? {};
const DBG = !!ENV.M09DBG || !!globalThis.__M3DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = ENV.M09STOP;

/**
 * Guards who would see a body left at (x, z) within `dur` s (sneak.mjs bodySeen), a walker turning at the end of a leg
 * swinging his eyes across everything in between (`sneakTurns`, M13): e5 turning back at the E end of his beat sweeps
 * the whole S of the yard.
 */
function bodySeen(D, x, z, dur, o = {}) {
  const w = D.world, prev = [w.sneakTurns, w.sneakTurnTie];
  // (a body turns the short way round, as the brain does: both ways only for a true about-turn — e5's 177° turn at the
  // E end of his beat goes by the S, never across the N yard)
  w.sneakTurns = true; w.sneakTurnTie = 0.02;
  try { return bodySeen0(D, x, z, dur, o); } finally { [w.sneakTurns, w.sneakTurnTie] = prev; }
}

/** The man as the guards see him standing (a knife blow, a stand-up; the Spy as he would look without the uniform). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/** A wait's test, tried every `sec` s of game time (false in between): the look-ahead behind it is heavy. */
function poll(D, f, sec = 0.1) {
  let next = -Infinity;
  return () => { if (D.t < next - 1e-9) return false; next = D.t + sec; return f(); };
}

let dbgN = 0, dbgT = -1;
function dbg(D, why, label) {
  // (every 60th refusal; one that is not a mere 'not ready' at most every half second)
  if (DBG && (dbgN++ % (+ENV.M09DBGN || 60) === 0 || (why[0] !== 'not ready' && D.t - dbgT >= 0.5))) { dbgT = D.t; D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); }
  return false;
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

/**
 * A margin on top of unwitnessed: would anyone (but `skip`) see the bare man at `man` over the next `ahead` s if a
 * walker's head were turned up to `turn` rad either way from where it is predicted to look (M12)?
 */
function glanced(D, man, skip = [], ahead = 1.5, turn = 0.7) {
  const w = D.world;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || skip.includes(e) || e.incapacitated) continue;
    if (Math.hypot(e.x - man.x, e.z - man.z) < (e.vision.far ?? 36) + 3 && canSee(e, man, w) !== 'none') return e.tag;
    if (!(e.route?.length > 1) || !walking(e)) continue;
    if (Math.hypot(e.x - man.x, e.z - man.z) > (e.vision.far ?? 36) + 3) continue;
    for (let t = 0; t <= ahead + 1e-6; t += 0.5) {
      const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
      for (const dd of [0, 0.5, -0.5]) for (let o = -turn; o <= turn + 1e-6; o += turn / 4) {
        const g = Object.create(e); g.x = q.x + Math.cos(q.heading) * dd; g.z = q.z + Math.sin(q.heading) * dd; g.heading = q.heading + o; g.sweepActive = false; g.headOffset = 0;
        if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return e.tag;
      }
    }
  }
  return null;
}

/**
 * Could a man of a patrol squad see any of `pts` within the next `dur` s, whichever way he turns his head? At a halt
 * the men of a file stand facing every way (the courtyard patrol's rear man looks N over the yard at its W halt), so a
 * deed anywhere in plain sight of the squad's beat is put off until the squad is out of reach. Returns his tag or null.
 * (`low`: the points are a body or a crawler on the ground, else a man standing.)
 */
function wheelSees(D, pts, dur = 2, { low = true, except = [] } = {}) {
  const w = D.world;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || !e.squad || except.includes(e)) continue;
    const far = (e.vision.far ?? 36) + 1;
    for (let t = 0; t <= dur + 1e-6; t += 0.5) {
      const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z };
      for (const [x, z] of pts) {
        if (Math.hypot(x - q.x, z - q.z) > far) continue;
        const g = Object.create(e); g.x = q.x; g.z = q.z; g.heading = Math.atan2(z - q.z, x - q.x); g.sweepActive = false; g.headOffset = 0;
        const tgt = low ? { x, z, y: 0, kind: 'body', alive: false, hp: 0 } : { x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
        if (canSee(g, tgt, w) !== 'none') return e.tag;
      }
    }
  }
  return null;
}

/**
 * The Green Beret knifes `victim` once `ready()` holds, he is within `reach`, the victim does not see him coming and
 * nobody else sees the blow or the body (for `quiet` s, `later` = men who die before then). `follow` m: he keeps that
 * far behind a walking victim meanwhile (M10).
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
    const L = Math.hypot(gb.x - victim.x, gb.z - victim.z) || 1, sx = victim.x + ((gb.x - victim.x) / L) * 1.0, sz = victim.z + ((gb.z - victim.z) / L) * 1.0;
    if (!clearFor(D, [[gb.x, gb.z], [(gb.x + victim.x) / 2, (gb.z + victim.z) / 2], [sx, sz]], crawl ? 3 : 2, { mode: 'walk', except: [victim], why })) return dbg(D, why, `knife ${victim.tag}`);
    const finders = [...bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] }), ...bodySeen(D, fall.x, fall.z, quiet, { except: [victim, ...later] })];
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    const wh = wheelSees(D, [[gb.x, gb.z], [victim.x, victim.z]], 3, { low: false, except: [victim, ...later] });
    if (wh) return dbg(D, [`${wh} could turn`], `knife ${victim.tag}`);
    return true;
  }), maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  // (`crawl`: he crawls in and stands up only at arm's length — the knife's autoStand; no boot prints in the sand)
  if (!crawl && gb.stance !== 'stand') await D.stance('greenberet', 'stand');
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run });
  await D.until(() => !victim.alive, 10, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
}

/**
 * A patrol walking in file, knifed man by man from its tail (M10): each time the rearmost living man, from behind,
 * when the others in front do not see him fall.
 */
async function knifeFile(D, men, { maxSec = 20, quiet = 30 } = {}) {
  const t0 = D.t;
  for (;;) {
    const alive = men.filter((e) => e.alive);
    if (!alive.length) return;
    const lead = alive.find((e) => e === men[0]) ?? alive[0], h = lead.heading;
    const behind = (e) => -((e.x - lead.x) * Math.cos(h) + (e.z - lead.z) * Math.sin(h));
    const last = alive.reduce((a, b) => (behind(b) > behind(a) ? b : a));
    const rest = alive.filter((e) => e !== last);
    await knife(D, last, { reach: 2.6, maxSec: Math.max(2, maxSec - (D.t - t0)), follow: 1.6, quiet, later: rest, run: false });
  }
}

/**
 * The Spy injects `victim` once `ready()` holds: he is within `reach`, the victim cannot see the needle coming (his
 * cone off the Spy as he would look without the uniform), nobody else sees him fall or sees the Spy at it, and nobody
 * but `later` (men who die next) would find the body for `quiet` s (M12).
 */
async function inject(D, victim, { stage = null, ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 2.2, idle = true, follow = 0, carryTo = null, label = '' } = {}) {
  const sp = D.c('spy'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  if (stage) await D.go('spy', stage[0], stage[1], { tol: 0.35, max: 120 });
  let last = -1;
  await D.until(poll(D, () => {
    why.length = 0;
    // (`follow` m: he keeps that far behind a walking victim meanwhile, at his heels)
    if (follow && D.t - last > 0.25) {
      const bx = victim.x - Math.cos(victim.heading) * follow, bz = victim.z - Math.sin(victim.heading) * follow;
      if (Math.hypot(sp.x - bx, sp.z - bz) > 0.4) { D.order('spy', { type: 'move', x: bx, z: bz }); last = D.t; }
    }
    if (!ready()) return dbg(D, ['not ready'], `inject ${victim.tag}`);
    if (Math.hypot(victim.x - sp.x, victim.z - sp.z) > reach) return dbg(D, ['far'], `inject ${victim.tag}`);
    const me = bare(sp);
    if (eyesOn(D, victim, me, 1.4)) return dbg(D, ['victim looks'], `inject ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead: 1.4, strict: true, why })) return dbg(D, why, `inject ${victim.tag}`);
    const g = glanced(D, me, [victim]);
    if (g) return dbg(D, [`${g} could glance`], `inject ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `inject ${victim.tag}`);
    const wh = wheelSees(D, [[sp.x, sp.z], [victim.x, victim.z]], 3, { low: false, except: [victim, ...later] });
    if (wh) return dbg(D, [`${wh} could turn`], `inject ${victim.tag}`);
    // (`carryTo`: he shoulders the body at once and carries it along these points: that too must go unseen — the
    // needle and the lowering, the lift, the walk at carrying pace — and the body must lie unseen where it ends up)
    if (carryTo && !carryClear(D, victim, carryTo, why)) return dbg(D, why, `inject ${victim.tag}: the carry`);
    return true;
  }), maxSec, `inject ${victim.tag}${label ? ' ' + label : ''}`);
  // (an order while he still lowers the last man waits until that may be cut short)
  await D.until(() => !sp.currentAction || sp.currentAction.interruptible !== false, 3, 'the Spy free');
  D.ability('spy', 'syringe', victim);
  await D.until(() => !victim.alive, 6, `${victim.tag} injected`);
  await D.until(() => !sp.currentAction || sp.currentAction.interruptible, 3, 'the Spy lets go');
  if (idle || carryTo) await D.idle('spy', 5);
  if (carryTo) await shoulder(D, 'spy', victim, carryTo);
}

/** Carrying a body from where `victim` lies along `pts` (the Spy or the Green Beret, picking him up in a moment): unseen? */
function carryClear(D, victim, pts, why = []) {
  const SP = CONFIG.units.carry ?? 1.6, PICK = CONFIG.abilities.carry?.pick ?? 1.0, T0 = 2.4 + PICK;
  const at = [victim.x, victim.z], end = pts[pts.length - 1];
  if (!routeClear(D, [at], { mode: 'walk', from: at, delay: 0, hold: T0, slack: 0.5, why, except: [victim], pad: 0.5 })) return false;
  for (const v of [SP * 0.8, SP]) if (!routeClear(D, pts, { mode: 'walk', from: at, speed: v, delay: T0, hold: 1.5, slack: 0.8, why, except: [victim], keepWalker: 2, pad: 0.5 })) return false;
  let L = 0, [px, pz] = at;
  for (const [x, z] of pts) { L += Math.hypot(x - px, z - pz); px = x; pz = z; }
  const wh = wheelSees(D, [at, ...pts], T0 + L / (SP * 0.8) + 2, { low: false, except: [victim] });
  if (wh) { why.push(`${wh} could turn`); return false; }
  const f = bodySeen(D, end[0], end[1], 900, { step: 1, except: [victim] });
  if (f.length) { why.push(`stash seen by ${f.join(',')}`); return false; }
  return true;
}

/** `role` shoulders the body of `victim` (beside him) and carries it along `pts`; puts it down at the last one. */
async function shoulder(D, role, victim, pts) {
  const u = D.c(role);
  if (u.stance !== 'stand') await D.stance(role, 'stand');
  if (Math.hypot(u.x - victim.x, u.z - victim.z) > 1.6) await D.go(role, victim.x, victim.z, { tol: 1.2, max: 20 });
  D.ability(role, 'hand', victim);
  await D.until(() => u.carrying === victim, 10, `${role} shoulders ${victim.tag}`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5, max: 60 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${victim.tag} put down`);
  await D.idle(role);
}

/** The Spy walks up behind `victim` as he walks his beat and injects him once `ready()` and the inject checks pass. */
async function tailInject(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 120, carryTo = null, label = '' } = {}) {
  const sp = D.c('spy');
  if (typeof victim === 'string') victim = D.get(victim);
  let lastOrder = -1;
  await D.until(() => {
    const d = Math.hypot(victim.x - sp.x, victim.z - sp.z);
    if (d > 1.7 && D.t - lastOrder > 0.3) {
      const bx = victim.x - Math.cos(victim.heading) * 1.3, bz = victim.z - Math.sin(victim.heading) * 1.3;
      D.order('spy', { type: 'move', x: bx, z: bz });
      lastOrder = D.t;
    }
    return d <= 1.9 && ready();
  }, maxSec, `the Spy behind ${victim.tag}`);
  await inject(D, victim, { ready, later, quiet, maxSec, follow: 1.2, carryTo, label });
}

/** Would the Sniper, risen to his knee where he lies, have a line of fire to `t` (the rifle's own test)? (M10) */
function fireLine(D, sn, t) {
  const k = sn.kneeling;
  sn.kneeling = true;
  try { return shotClear(D.world, sn, t, true); } finally { sn.kneeling = k; }
}

/**
 * A walkable spot within `box` m of `near` from which the Sniper, kneeling, has a line of fire to every one of `targets`
 * (each within `range`): the nearest to `near`, or null.
 */
function sniperSpot(D, targets, near, { box = 4, range = 40 } = {}) {
  const sn = D.c('sniper'), g = D.world.grid;
  let best = null, bd = Infinity;
  for (let dx = -box; dx <= box; dx += 0.5) for (let dz = -box; dz <= box; dz += 0.5) {
    const x = near[0] + dx, z = near[1] + dz, d = Math.hypot(dx, dz);
    if (d >= bd || !g.walkableAt(x, z)) continue;
    const me = Object.create(sn, { x: { value: x }, z: { value: z }, kneeling: { value: true } });
    if (targets.every((t) => Math.hypot(t.x - x, t.z - z) <= range && shotClear(D.world, me, t, true))) { best = [x, z]; bd = d; }
  }
  return best;
}

/** The Sniper as the guards see him while he aims (he kneels: tried as a man standing). */
const kneeling = (sn) => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/**
 * The Sniper shoots `victim` from where he lies, once `ready()` holds, nobody would see the victim fall or the Sniper
 * kneeling to aim, and nobody but `later` would find the body for `quiet` s (M12).
 */
async function snipe(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, range = 44, label = '' } = {}) {
  const sn = D.c('sniper'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(poll(D, () => {
    why.length = 0;
    if (D.world.time < (sn._boltT ?? -1) || sn.currentAction || sn.pendingAbility) return false;
    if (!ready()) return dbg(D, ['not ready'], `snipe ${victim.tag}`);
    if (Math.hypot(victim.x - sn.x, victim.z - sn.z) > range) return dbg(D, ['range'], `snipe ${victim.tag}`);
    if (!fireLine(D, sn, victim)) return dbg(D, ['no line of fire'], `snipe ${victim.tag}`);
    if (!unwitnessed(D, victim, kneeling(sn), { ahead: 1.2, strict: true, why })) return dbg(D, why, `snipe ${victim.tag}`);
    if (!clearFor(D, [[sn.x, sn.z]], 1.2, { mode: 'walk', why, except: [victim] })) return dbg(D, why, `snipe ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `snipe ${victim.tag}`);
    const wh = wheelSees(D, [[sn.x, sn.z], [victim.x, victim.z]], 2, { low: false, except: [victim, ...later] });
    if (wh) return dbg(D, [`${wh} could turn`], `snipe ${victim.tag}`);
    return true;
  }, 0.05), maxSec, `snipe ${victim.tag}${label ? ' ' + label : ''}`);
  D.ability('sniper', 'sniper', victim);
  await D.until(() => !victim.alive || (!sn.currentAction && !sn.pendingAbility), 3, `${victim.tag} shot`);
  if (victim.alive) throw new Error(`snipe ${victim.tag}: missed`);
}

/**
 * `role` (Green Beret or Spy: the two who shoulder a man) picks up the body of `tag` (he stands by it), carries it
 * along `pts` and puts it down at the last one: once nobody will see him on the way (pick-up, walk at carrying pace,
 * drop), nor the body where it ends up for `quiet` s (M10 carryBody).
 */
async function carry(D, role, tag, pts, { maxWait = 120, pad = 0.8, slack = 0.6, quiet = 240, label = '', walkUp = false } = {}) {
  const u = D.c(role), e = D.get(tag), why = [];
  const end = pts[pts.length - 1];
  // (`walkUp`: he first goes over to the body on a sneak plan and lies down beside it)
  if (walkUp && Math.hypot(u.x - e.x, u.z - e.z) > 1.4) {
    await sneak(D, e.x + 0.8, e.z + 0.3, { mode: 'walk', role, label: `${role} to ${tag}'s body`, maxWait, hold: 3 });
    await D.stance(role, 'crawl');
  }
  await D.until(poll(D, () => {
    why.length = 0;
    if (!routeClear(D, [[u.x, u.z]], { mode: 'walk', from: [u.x, u.z], hold: 1.5, slack, why, pad })) return dbg(D, why, `carry ${tag}: pick-up`);
    for (const v of [1.3, 1.6]) if (!routeClear(D, pts, { mode: 'walk', from: [u.x, u.z], speed: v, delay: 1.3, hold: 1.2, slack, why, pad })) return dbg(D, why, `carry ${tag}`);
    const f = bodySeen(D, end[0], end[1], quiet, { step: 1 });
    if (f.length) return dbg(D, [`body at the end seen by ${f.join(',')}`], `carry ${tag}`);
    let L = 0, [px, pz] = [u.x, u.z];
    for (const [x, z] of pts) { L += Math.hypot(x - px, z - pz); px = x; pz = z; }
    const wh = wheelSees(D, [[u.x, u.z], ...pts], L / 1.3 + 4, { low: false });
    if (wh) return dbg(D, [`${wh} could turn`], `carry ${tag}`);
    return true;
  }), maxWait, `window to carry ${tag}${label ? ' ' + label : ''}`).catch((err) => { throw new Error(`${err.message} [${why.slice(0, 3).join(' ')}]`); });
  if (u.stance !== 'stand') await D.stance(role, 'stand');
  if (Math.hypot(u.x - e.x, u.z - e.z) > 1.6) await D.go(role, e.x, e.z, { tol: 1.2, max: 40 });
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 10, `${role} shoulders ${tag}`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5, max: 60 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${tag} put down`);
  await D.idle(role);
}

/**
 * A side task (D.meanwhile): the Spy walks to `spot` and, the moment the patrol of `tag` (its sergeant) halts at `end`
 * of its beat, talks to him: the whole file stands facing him. `then()` runs at that moment (M05).
 */
function talkTo(D, tag, spot, end, then) {
  const spy = D.c('spy'), e = D.get(tag);
  let talking = false, sent = D.t;
  D.order('spy', { type: 'move', x: spot[0], z: spot[1] });
  D.meanwhile(() => {
    if (talking) return true;
    const there = Math.hypot(spy.x - spot[0], spy.z - spot[1]) < 1.2;
    if (!there && !spy.path && !spy.isMoving && D.t > sent + 1) { D.order('spy', { type: 'move', x: spot[0], z: spot[1] }); sent = D.t; }
    if (there && e.brain?.atWait && Math.hypot(e.x - end[0], e.z - end[1]) < 1) {
      D.ability('spy', 'distract', e); talking = true;
      then?.();
    }
    return talking;
  });
  return { held: () => talking && e.brain?.state === 'DISTRACTED' };
}


// ---------------------------------------------------------------- places (metres; +x east, +z south)
/** Outside the SE wall, at the corner of Patrol SE's beat: the Green Beret's way after the file. */
const SE_CORNER = [83.5, 86.5];
/** The Sniper's place S of the forecourt fence: e2's S halt, e1's post and e3's in his sights, the drums out of the way. */
const SN_FORE = [45, 112];
/** The Green Beret's way back from the E side round the S corner to the start (where e2, pacing the forecourt behind its
 *  mesh fence, never sees a man standing). */
const GB_BACK = [[98, 66], [83, 85], [74, 101], [58, 110]];
/** Behind e3, in the forecourt's W opening (he looks W along the road just outside it), and where his body goes:
 *  S of the road, out of the courtyard patrol's sight through the inner gap. */
const E3_BEHIND = [25.6, 87.4], E3_STASH = [18, 106.5];
/** The far end of climb_s (the broken stub), and behind the yellow drum stack (B.LOW: it hides a body from the gap). */
const CLIMB_IN = [46.9, 100.9], DRUMS_STASH = [39.5, 103.6], DRUMS_STASH2 = [42, 103.4];
/** On the W strip outside the camp, S of Patrol NW's beat: prone here he is beyond the near band of its S halt. */
const NW_LURK = [2.8, 72];
/** Behind e9 (he looks SSW over the shed front), behind the W halt of e8's beat (he looks SW there) and behind e4
 *  (he looks ESE over the yard from the bunker's NW corner). */
const E9_STAGE = [34.45, 15.8], E8_STAGE = [35.1, 26.9], E4_STAGE = [11.7, 44.1];
/** Where the Spy stands to talk to the courtyard patrol's sergeant at the W end of its beat (N of him, his two file men
 *  standing to his E: all three turn their backs on the gap), and the Sniper's place in the forecourt's W corner (the
 *  three in his sights through the gap). */
const YARD_TALK = [43.3, 69.6], SN_YARD = [23.5, 83];
/** The Sniper's way there from the forecourt's S fence (S of the collapsed sandbags, in at the W opening). */
const SN_WAY = [[38, 111.5], [29.5, 108.5], [25.6, 89.5], SN_YARD];
/** W of house_n1 against the N wall (the house hides a body from the yard), and W of the bunker (its bulk hides one). */
const N1_STASH = [44, 8], N1_STASH2 = [42.8, 8.4], BUNKER_STASH = [12, 53], BUNKER_STASH2 = [13.2, 55];
/** Inside the E gate, W of e7's beat (where the Spy waits for him to pass going S), and behind e6's post (he looks
 *  NNE up the road). */
const E7_STAGE = [72.8, 37.5], E6_STAGE = [75.6, 37.2];
/** Outside the NE wall, W of the road: the wall hides both bodies from the yard (and e8's look through the gate). */
const GATE_OUT = [75.3, 30.4], E7_STASH = [71.5, 23], E6_STASH = [70, 20.5];
/** The Sapper's two charges: at the barracks' S door (the first to go: the garrison is razed by the blast that raises
 *  the alarm, so it sends nobody out), and between the radio hut and the dish (one bomb takes both). */
const BOMB_BARR = [86.5, 62.2], BOMB_COMMS = [75, 75];
/** Where the Driver sends the tanker: along the bay fronts, a little past TANKER_SPOT (the mission's marker). */
const TANKER_DRIVE = [26.4, 25.4];
/** The drum the Green Beret carries from the pile to the bunker's N door (2 m off its sandbags), and where he waits for
 *  the bangs (in the forecourt, beyond the Panzers' reach when the alarm wakes them). */
const DRUM_BUNKER = [19, 44.8], GB_FIRE_WAIT = [38, 92];
/** Where the Green Beret goes back to from the W strip once the courtyard patrol is gone: the forecourt's W opening. */
const GB_BACK_W = [25.5, 87];
/** Where he fires the two drums from after the bangs: 8–13 m off each (the pistol's reach, outside the blast). */
const FIRE_BUNKER = [29.5, 46], FIRE_PILE = [46.5, 57];
/** Where the team waits for our lorry, beside the W road W of the forecourt (it parks at (16,95), heading E). */
const PICKUP = { sniper: [19, 99], sapper: [21, 100.5], driver: [17, 101], spy: [23, 99.5], greenberet: [20, 102] };

export const STAGES = [
  ['A', 'The patrol outside the south-east wall', async (D) => {
    // Patrol SE (pt_se) walks off NE along the outside of the SE wall from its halt beside the start; when it comes back
    // round (some 150 s on) it would see the south group where it stands. e2, pacing the forecourt behind its mesh
    // fence, looks S over the start while he walks S. So the Green Beret goes after the file the moment e2 turns back
    // N at the S end of his beat, walks round the S corner of the wall behind the patrol's back and knifes it man by
    // man from the back of the file on its way N up the E side
    const e2 = D.get('e2'), pt = ['pt_sea', 'pt_seb', 'pt_sec'].map((t) => D.get(t));
    await D.until(() => e2.z > 90 && Math.sin(e2.heading) < -0.5 && !e2.brain?.atWait, 120, 'e2 turns back N at the S end of his beat');
    await sneak(D, SE_CORNER[0], SE_CORNER[1], { mode: 'walk', role: 'greenberet', label: 'GB round the S corner after Patrol SE', maxWait: 120 });
    D.checkpoint('A1 greenberet walks round the S corner of the wall after Patrol SE');
    await knifeFile(D, pt, { maxSec: 60, quiet: 60 });
    D.checkpoint('A2 greenberet knifes Patrol SE man by man from the back of the file');
  }],
  ['B', 'The forecourt', async (D) => {
    // the Green Beret walks back round the S corner to the start, outside the forecourt's fences
    for (const [x, z] of GB_BACK) await sneak(D, x, z, { mode: 'walk', role: 'greenberet', label: `GB back to (${x},${z})`, maxWait: 120 });
    D.checkpoint('B1 greenberet walks back round the S corner of the wall');
    // the Sniper crawls W along the forecourt's S fence to SN_FORE: e2's S halt, e1's post and e3's in his sights
    await sneak(D, SN_FORE[0], SN_FORE[1], { mode: 'crawl', role: 'sniper', label: 'Sniper to the forecourt fence', maxWait: 120 });
    D.checkpoint('B2 sniper crawls along the forecourt fence');
    // e2 halts at the S end of his beat looking WSW, away from the fence: the Sniper drops him there; then e1, who looks
    // W from his post with his back to the fence (e2's body lies in his sight)
    const e2 = D.get('e2'), e1 = D.get('e1'), e3 = D.get('e3');
    await snipe(D, e2, { ready: () => e2.brain?.atWait && Math.hypot(e2.x - 34, e2.z - 94) < 1, later: [e1], quiet: 60, label: 'at the S end of his beat' });
    D.checkpoint('B3 sniper shoots e2 at the S end of his beat');
    await snipe(D, e1, { quiet: 240, maxSec: 20 });
    D.checkpoint('B4 sniper shoots e1 at his post');
    // the courtyard patrol looks into the forecourt through the inner gap from the W end of its beat: the Green Beret
    // climbs the broken wall stub, and lays both bodies behind the yellow drum stack, out of its sight
    const gb = D.c('greenberet');
    D.ability('greenberet', 'climb', { x: CLIMB_IN[0], z: CLIMB_IN[1] });
    await D.until(() => Math.hypot(gb.x - CLIMB_IN[0], gb.z - CLIMB_IN[1]) < 0.6 && !gb.path && !gb.isMoving, 90, 'the Green Beret over the stub');
    D.checkpoint('B5 greenberet climbs the broken wall stub into the forecourt');
    await carry(D, 'greenberet', 'e2', [DRUMS_STASH], { quiet: 900, maxWait: 200, walkUp: true });
    await carry(D, 'greenberet', 'e1', [[45, 96], DRUMS_STASH2], { quiet: 900, maxWait: 200, walkUp: true });
    D.checkpoint('B6 greenberet lays e2 and e1 behind the yellow drums');
    // e3 looks W along the road just outside the forecourt's W opening: the Green Beret crosses the forecourt, crawls up
    // behind him in the opening and knifes him, then carries him well S of the road, out of the courtyard patrol's sight
    // through the inner gap
    await sneak(D, E3_BEHIND[0] + 1.5, E3_BEHIND[1] - 3, { mode: 'walk', role: 'greenberet', label: 'GB across the forecourt', maxWait: 200, hold: 3 });
    await sneak(D, E3_BEHIND[0], E3_BEHIND[1], { mode: 'crawl', role: 'greenberet', label: 'GB behind e3', maxWait: 200 });
    await knife(D, e3, { quiet: 30, maxSec: 200, crawl: true, reach: 4.2 });
    D.checkpoint('B7 greenberet knifes e3 on the road');
    await carry(D, 'greenberet', 'e3', [E3_STASH], { quiet: 900 });
    D.checkpoint('B8 greenberet carries e3 S of the road: the forecourt is clear');
  }],
  ['C', 'The patrol outside the west wall', async (D) => {
    // Patrol NW (pt_nw) walks the strip between the W wall and the map's edge, N to the NW corner and back; at its S
    // halt it looks S down the strip. The Green Beret walks W along the road and up the strip, lies down beyond the near
    // band of that halt, and when the file turns back N he gets up and goes after it: man by man from its tail, on the
    // straight N leg, where the wall hides everything from the camp
    const gb = D.c('greenberet'), pt = ['pt_nwa', 'pt_nwb', 'pt_nwc'].map((t) => D.get(t)), a = pt[0];
    await sneak(D, 4, 90, { mode: 'walk', role: 'greenberet', label: 'GB W along the road', maxWait: 200 });
    await sneak(D, NW_LURK[0], NW_LURK[1], { mode: 'crawl', role: 'greenberet', label: 'GB up the W strip', maxWait: 300 });
    D.checkpoint('C1 greenberet crawls up the W strip below Patrol NW\'s beat');
    const why = [];
    await D.until(poll(D, () => {
      why.length = 0;
      if (!pt.every((e) => !e.brain?.atWait && Math.sin(e.heading) < -0.95 && e.z < 47.5 && e.z > 36)) return false;
      return clearFor(D, [[gb.x, gb.z], [gb.x, gb.z - 3]], 3, { mode: 'walk', why }) || dbg(D, why, 'GB up behind Patrol NW');
    }), 300, 'Patrol NW turns back N at the S end of its beat');
    await D.stance('greenberet', 'stand');
    await knifeFile(D, pt, { maxSec: 60, quiet: 60 });
    D.checkpoint('C2 greenberet knifes Patrol NW man by man from the back of the file');
  }],
  ['D', 'The north yard and the bunker', async (D) => {
    // the Spy, in his German uniform, walks E outside the NE wall, in at the E gate past e6 and e7 (nobody minds an
    // officer) and W along the N wall to the Panzers' shed, behind e9: the still guard who watches the shed front
    const e9 = D.get('e9'), e8 = D.get('e8'), e5 = D.get('e5'), e4 = D.get('e4');
    await D.go('spy', 70, 14, { max: 120 });
    await D.go('spy', 75.5, 27, { max: 60 });
    await D.go('spy', 46, 9, { max: 120 });
    await D.go('spy', E9_STAGE[0], E9_STAGE[1], { max: 60, tol: 0.35 });
    D.checkpoint('D1 spy walks in at the E gate and along the N wall to the Panzers\' shed');
    // e9 first: from his post he sees e4's, e5's and e8's places; the Spy lays him W of house_n1, against the N wall,
    // where no beat or post in the yard ever looks (the house stands between)
    await inject(D, e9, { quiet: 12, carryTo: [N1_STASH], label: 'by the shed' });
    D.checkpoint('D2 spy injects e9 and lays him behind house_n1');
    // e4 watches the yard from the bunker's NW corner, e5 paces between the bunker and the gantry, e8 halts at the W
    // end of his beat looking SW over both: each sees the others' places. While e5 walks off NE and e8 is away E, the
    // Spy injects e4 from behind and lays him behind the bunker
    await D.go('spy', E4_STAGE[0], E4_STAGE[1], { max: 60, tol: 0.35 });
    await inject(D, e4, { quiet: 12, carryTo: [BUNKER_STASH], label: 'by the bunker' });
    D.checkpoint('D3 spy injects e4 and lays him behind the bunker');
    // e8 halts at the W end of his beat looking SW over the bunker: from behind, and behind house_n1 with him too
    await D.go('spy', E8_STAGE[0], E8_STAGE[1], { max: 60, tol: 0.35 });
    await inject(D, e8, { ready: () => e8.brain?.atWait && Math.hypot(e8.x - 34, e8.z - 28) < 1, quiet: 14, carryTo: [N1_STASH2], label: 'at the W end of his beat' });
    D.checkpoint('D4 spy injects e8 at the W end of his beat and lays him behind house_n1');
    // e5, the last man in the north yard, paces between the bunker and the gantry: the Spy falls in at his heels and,
    // as soon as the courtyard patrol is away E, injects him on the bunker's side of his beat; behind the bunker with him
    await tailInject(D, e5, { ready: () => e5.x < 33, quiet: 16, maxSec: 240, carryTo: [BUNKER_STASH2], label: 'on his beat' });
    D.checkpoint('D5 spy follows e5 down his beat, injects him and lays him behind the bunker: the north yard is clear');
  }],
  ['E', 'The courtyard patrol', async (D) => {
    // the courtyard patrol (pt_yard) walks the S of the yard; at the W end of its beat it halts by the inner gap and its
    // three men look about the yard and into the forecourt. The Spy, in his German uniform, walks across the yard from
    // the bunker to that halt; when the patrol halts there he talks to its sergeant from the N: all three stand
    // facing him, their backs to the gap. The Sniper, in the forecourt's W corner, has the three in his sights through the
    // gap: shot from behind, each man falls back towards him, out of the others' sight
    const pt = ['pt_yarda', 'pt_yardb', 'pt_yardc'].map((t) => D.get(t));
    const talk = talkTo(D, 'pt_yarda', YARD_TALK, [43, 71]);
    // (round the collapsed sandbags S of the forecourt's fence, in at its W opening and N along the inside of its W fence)
    for (const [x, z] of SN_WAY) await sneak(D, x, z, { mode: 'crawl', role: 'sniper', label: 'Sniper to the forecourt\'s W corner', maxWait: 300 });
    D.checkpoint('E1 sniper crawls round to the forecourt\'s W corner, the inner gap in his sights');
    await D.until(talk.held, 400, 'the courtyard patrol at the W end of its beat');
    D.checkpoint('E2 spy talks to the courtyard patrol\'s sergeant at the W end of its beat');
    // (where they stand varies a little with the file's halt: he crawls a step or two to where all three are in his
    // sights through the gap)
    await D.wait(1.5);
    const spot = sniperSpot(D, pt, SN_YARD, { box: 4 });
    if (!spot) throw new Error(`no spot with a line of fire to the courtyard patrol: ${pt.map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)}`).join(' ')}`);
    if (Math.hypot(spot[0] - D.c('sniper').x, spot[1] - D.c('sniper').z) > 0.3) await sneak(D, spot[0], spot[1], { mode: 'crawl', role: 'sniper', label: 'Sniper a step aside', maxWait: 30, tol: 0.25 });
    for (let k = 0; k < 3; k++) {
      const alive = pt.filter((e) => e.alive);
      // (the one furthest from the gap first)
      const next = alive.reduce((a, b) => (Math.hypot(b.x - 40, b.z - 74) > Math.hypot(a.x - 40, a.z - 74) ? b : a));
      await snipe(D, next, { maxSec: 30, quiet: 900, later: alive.filter((e) => e !== next) });
    }
    D.checkpoint('E3 sniper shoots the courtyard patrol man by man while it listens to the Spy');
  }],
  ['F', 'The east gate', async (D) => {
    // the last two men on foot hold the E gate: e6 on his post looking up the road, e7 pacing between the gate and the
    // barracks. The Spy, in his German uniform, walks back across the yard and waits inside the gate, W of e7's beat
    const e6 = D.get('e6'), e7 = D.get('e7');
    // (the courtyard patrol gone, nobody looks out through the inner gap any more: the Green Beret walks back down the W
    // strip, round to the forecourt's W opening)
    D.order('greenberet', { type: 'move', x: GB_BACK_W[0], z: GB_BACK_W[1] });
    await D.go('spy', E7_STAGE[0], E7_STAGE[1], { max: 120, tol: 0.4 });
    D.checkpoint('F1 spy walks back to the E gate');
    // e7 walks S down his beat to the barracks' corner; the Spy follows him and injects him from behind (e6 at his post
    // looks the other way, up the road)
    await D.until(() => !e7.brain?.atWait && e7.z > 36 && e7.z < 40 && Math.sin(e7.heading) > 0.9, 200, 'e7 walks S past the Spy');
    await tailInject(D, e7, { later: [e6], quiet: 45, maxSec: 40, label: 'on his way S' });
    D.checkpoint('F2 spy follows e7 S and injects him');
    await D.go('spy', E6_STAGE[0], E6_STAGE[1], { max: 20, tol: 0.4 });
    await inject(D, e6, { quiet: 35, maxSec: 30 });
    D.checkpoint('F3 spy injects e6 at his post');
    // both bodies out through the gate, behind the NE wall, before e8 on his beat or the courtyard patrol looks this way
    await carry(D, 'spy', 'e7', [GATE_OUT, E7_STASH], { quiet: 900, maxWait: 30 });
    await carry(D, 'spy', 'e6', [GATE_OUT, E6_STASH], { quiet: 900, maxWait: 30 });
    D.checkpoint('F4 spy carries both bodies out through the gate behind the NE wall');
  }],
  ['G', 'The charges and the tanker', async (D) => {
    // nobody is left on foot: the team sets the fireworks. The Sapper opens the S gate and plants a remote bomb at the
    // barracks' door; the Driver walks to the fuel tanker by the bunker; the Sniper and the Spy go to the pick-up point
    const w = D.world, sap = D.c('sapper'), drv = D.c('driver'), gb = D.c('greenberet'), tanker = w.byId('tanker'), gate = D.item('gate_s');
    const bombs = () => sap.inventory.get('remoteBomb') ?? 0;
    const cab = [tanker.x + 2.4, tanker.z + 1.5];
    D.order('sniper', { type: 'move', x: PICKUP.sniper[0], z: PICKUP.sniper[1] });
    D.order('spy', { type: 'move', x: PICKUP.spy[0], z: PICKUP.spy[1] });
    D.order('driver', { type: 'move', x: cab[0], z: cab[1], run: true });
    await D.go('sapper', 54.3, 100.8, { run: true, max: 60 });
    D.ability('sapper', 'use', gate);
    await D.until(() => gate.open && !sap.currentAction, 10, 'the S gate open');
    await D.go('sapper', BOMB_BARR[0], BOMB_BARR[1], { run: true, tol: 0.4, max: 90 });
    D.ability('sapper', 'remoteBomb');
    await D.until(() => bombs() === 1 && !sap.currentAction, 10, 'the first bomb set');
    D.checkpoint('G1 sapper opens the S gate and plants a remote bomb at the barracks door');
    // the Driver takes the tanker round and parks it across the bay fronts of the Panzers' shed (the tanks are still
    // asleep: no crew watches before the alarm); meanwhile the Sapper walks on to the radio hut and the Green Beret to
    // the drums between the two centre houses
    D.order('sapper', { type: 'move', x: BOMB_COMMS[0], z: BOMB_COMMS[1], run: true });
    const drum = D.item('brl3');
    D.order('greenberet', { type: 'move', x: drum.x - 0.9, z: drum.z + 0.9, run: true });
    await D.until(() => Math.hypot(drv.x - cab[0], drv.z - cab[1]) < 1.2 || (!drv.path && !drv.isMoving), 90, 'the Driver at the tanker');
    D.ability('driver', 'enterVehicle', tanker);
    await D.until(() => drv.vehicle === tanker, 20, 'the Driver in the tanker');
    // (ordered a little past the spot along the bay fronts: a lorry stops short of where it is sent; parked there it is
    // within 10 m of every bay, so each tank still in it fires at it, and its fireball reaches all three)
    D.order('driver', { type: 'move', x: TANKER_DRIVE[0], z: TANKER_DRIVE[1] });
    const tanks = ['pz1', 'pz2', 'pz3'].map((t) => w.byId(t));
    await D.until(() => (tanker.speed || 0) < 0.05 && !tanker.goal && D.t > 1, 60, 'the tanker at the shed front');
    const far = tanks.map((v) => Math.hypot(v.x - tanker.x, v.z - tanker.z));
    if (far.some((d) => d > 10.5)) throw new Error(`the tanker parked at (${tanker.x.toFixed(2)},${tanker.z.toFixed(2)}): ${far.map((d) => d.toFixed(1)).join(' / ')} m from the Panzers`);
    D.ability('driver', 'leaveVehicle');
    await D.until(() => !drv.vehicle && !drv.currentAction, 10, 'the Driver out');
    D.order('driver', { type: 'move', x: PICKUP.driver[0], z: PICKUP.driver[1], run: true });
    D.checkpoint('G2 driver parks the fuel tanker across the bays of the Panzers\' shed');
    await D.until(() => Math.hypot(sap.x - BOMB_COMMS[0], sap.z - BOMB_COMMS[1]) < 0.5 || (!sap.path && !sap.isMoving), 90, 'the Sapper at the radio hut');
    D.ability('sapper', 'remoteBomb');
    await D.until(() => bombs() === 0 && !sap.currentAction, 10, 'the second bomb set');
    D.order('sapper', { type: 'move', x: PICKUP.sapper[0], z: PICKUP.sapper[1], run: true });
    D.checkpoint('G3 sapper plants the second bomb between the radio hut and the dish');
    // the Green Beret shoulders a drum from the pile and sets it down at the bunker's door
    await D.until(() => Math.hypot(gb.x - (drum.x - 0.9), gb.z - (drum.z + 0.9)) < 0.8 || (!gb.path && !gb.isMoving), 90, 'the Green Beret at the drums');
    D.ability('greenberet', 'hand', drum);
    await D.until(() => gb.carrying === drum, 10, 'drum shouldered');
    await D.go('greenberet', DRUM_BUNKER[0], DRUM_BUNKER[1], { tol: 0.4, max: 90 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying && !gb.currentAction, 10, 'drum down');
    D.checkpoint('G4 greenberet carries a fuel drum from the pile to the bunker door');
    await D.go('greenberet', GB_FIRE_WAIT[0], GB_FIRE_WAIT[1], { run: true, max: 90 });
    for (const r of ['sapper', 'driver', 'sniper', 'spy']) { const u = D.c(r); await D.until(() => Math.hypot(u.x - PICKUP[r][0], u.z - PICKUP[r][1]) < 1.2 || (!u.path && !u.isMoving), 120, `${r} at the pick-up point`); }
  }],
  ['H', 'Fireworks and our lorry', async (D) => {
    // everyone is in the SW, beyond the Panzers' reach. The Sapper fires the barracks bomb, then the other: the garrison
    // goes up with its barracks before a man is out (the blast raises the alarm: every explosion is heard across the
    // camp), and the radio hut and the dish go with the second
    const w = D.world, sap = D.c('sapper'), gb = D.c('greenberet');
    const done = (id) => !!w.objectives.find((o) => o.id === id)?.done;
    const tanks = ['pz1', 'pz2', 'pz3'].map((t) => w.byId(t));
    for (const c of w.commandos) for (const v of tanks) if (Math.hypot(c.x - v.x, c.z - v.z) < 47) throw new Error(`${c.role} within the Panzers' reach at the bangs`);
    D.ability('sapper', 'detonate');
    await D.until(() => w.byId('barr')?.destroyed || w.interactables.find((i) => (i.tag ?? i.id) === 'barr')?.destroyed, 5, 'the barracks razed');
    await D.wait(0.6);
    D.ability('sapper', 'detonate');
    await D.until(() => done('o1') && done('o2'), 5, 'the radio hut and the dish destroyed');
    D.checkpoint('H1 sapper fires both bombs: the barracks, the radio hut and the dish go up; the alarm sounds');
    // the alarm wakes the Panzers: the tanker across their bays is the first thing each sees, they fire, and its
    // fireball wrecks all three
    await D.until(() => tanks.every((v) => v.destroyed), 10, 'the Panzers wrecked');
    D.checkpoint('H2 the Panzers wake, fire at the tanker blocking their bays and its fireball wrecks all three');
    // the Green Beret walks up and fires his pistol at the drum by the bunker, then at the pile between the centre houses
    const bd = D.item('brl3'), pile = D.item('brl1');
    await D.go('greenberet', FIRE_BUNKER[0], FIRE_BUNKER[1], { run: true, tol: 0.5, max: 60 });
    D.ability('greenberet', 'pistol', bd);
    await D.until(() => done('o5'), 6, 'the bunker destroyed');
    D.checkpoint('H3 greenberet shoots the drum by the bunker: the bunker goes up');
    await D.idle('greenberet', 5);
    if (gb.armed) D.order('greenberet', { type: 'cancel' }); // (the pistol back in its holster: he walks on)
    await D.go('greenberet', FIRE_PILE[0], FIRE_PILE[1], { run: true, tol: 0.5, max: 60 });
    D.ability('greenberet', 'pistol', pile);
    await D.until(() => done('o3') && done('o4'), 6, 'the weapons store and the command post destroyed');
    D.checkpoint('H4 greenberet shoots the drum pile: the weapons store and the command post go up');
    // all five targets down: our lorry comes in along the W road 15 s later; the Green Beret runs back to the others
    await D.idle('greenberet', 5);
    if (gb.armed) D.order('greenberet', { type: 'cancel' });
    D.order('greenberet', { type: 'move', x: PICKUP.greenberet[0], z: PICKUP.greenberet[1], run: true });
    let evac = null;
    await D.until(() => !!(evac = w.byId('evac')) && Math.hypot(evac.x - 16, evac.z - 95) < 1.5 && (evac.speed || 0) < 0.2, 60, 'our lorry at the pick-up point');
    D.checkpoint('H5 our lorry pulls up on the W road');
    for (const r of ['sniper', 'sapper', 'driver', 'spy', 'greenberet']) D.ability(r, 'enterVehicle', evac);
    await D.until(() => w.objectives.every((o) => o.done || o.required === false), 60, 'everyone aboard');
    D.checkpoint('H6 everyone climbs aboard: mission accomplished');
  }],
];

export async function solve(D, ctx = {}) {
  if (STOP) { const cp = D.checkpoint.bind(D); D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.until && id > ctx.until) break;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
  }
  return D.checkpoints;
}
