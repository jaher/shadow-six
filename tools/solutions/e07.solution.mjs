/**
 * LIGHTS OUT e07 "White Out" (Hochjoch pass): a full stealth solution, played only with player orders
 * (docs/expansion/e07.md §11, as built). Driver API: tools/solutions/driver.mjs; sneaking helpers:
 * tools/solutions/sneak.mjs. Headless:
 *   node tools/solutions/run-headless.mjs e07 [--easy] [--until X]
 * Reference run in the real game: tests/e07-solution.test.mjs. Walkthrough: e07.walkthrough.mjs.
 *
 * Every shot is unwitnessed (the Sniper kneels where nobody looks, the target included, and nobody living will see the
 * body), every knock-out is from behind and unwitnessed, every man knocked out is cuffed where no comrade will see him
 * lie, every crossing of open snow is made crawling or crouched (no prints for the ski patrol), and no commando is
 * ever inside a live cone (the driver's exposure watch). Wins with every objective done, 0 detections and 0 exposures,
 * on Hard and on Easy.
 */
import { sneak, clearFor, unwitnessed, bodySeen, bodySeenGen, predict, walking, planSneak, planSneakAsync, routeClearGen } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { shotClear } from '../../src/abilities/weapons.js';
import { plantedRemotes } from '../../src/abilities/sapper.js';
import { dynamicObstacles } from '../../src/world/body-clearance.js';
import { CONFIG } from '../../src/config.js';
import { SLIDE } from '../../src/missions/scripts/e07.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { mirrorOf, ghostOn } from './ghost.mjs';

const DBG = !!globalThis.process?.env?.E07DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.E07STOP;
/** (dev) skip the stages before this one (a later stage tried on its own; never set for the reference runs) */
const FROM = globalThis.process?.env?.E07FROM;

export const ROLES = ['greenberet', 'driver', 'sapper', 'spy', 'sniper'];
const alive = (D) => D.world.enemies.filter((e) => e.alive && !e.removed && e.vision && !e.ko);
/** The man as the guards see him standing (a blow, a stand-up, the Sniper kneeling to aim: §3.4). */
export const upright = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const body = (x, z, y = 0) => ({ x, z, y, kind: 'enemy', alive: false, hp: 0, state: 'dead', isVisibleToEnemies: false });

let dbgN = 0;
export function dbg(D, why, label) { if (DBG && dbgN++ % 120 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

/** Will enemy `e` see `dummy` `t` s from now? Static men: their cone then; walkers: on their beat, every heading of a turn. */
export function seesAt(D, e, dummy, t) {
  const w = D.world;
  if (!walking(e)) return canSee(e, dummy, w, { cone: coneAt(e, w.time + t) }) !== 'none';
  const q = predict(e, t), amp = e.vision?.sweep ?? 0;
  const hs = [q.heading];
  if (q.alt != null) hs.push(q.alt);
  const h0 = t >= 1 ? predict(e, t - 1).heading : e.heading;
  if (t < 0.05) hs.push(e.heading);
  const d = Math.atan2(Math.sin(q.heading - h0), Math.cos(q.heading - h0));
  if (Math.abs(d) > 0.15) for (let k = 1; k < 12; k++) {
    hs.push(h0 + (d * k) / 12);
    if (Math.abs(d) > 2.9) hs.push(h0 + ((d - Math.sign(d) * 2 * Math.PI) * k) / 12);
  }
  const me = mirrorOf(e);
  // (the head's watch sweep tried every 7° or so of its arc, not only at its middle, halves and ends: the band is an
  // ellipse, longest straight ahead, so a head a few degrees off the middle reaches a man 30 m out whom neither the
  // middle — just outside the aperture — nor the half — its far edge drawn in to 23 m — reaches: h3 turning at the
  // yard's east end saw the Sniper kneel at the tarn, Hard started 16200 ticks late, round 8)
  const n = amp ? Math.max(2, Math.ceil(amp / 0.125)) : 0, offs = [0];
  for (let k = 1; k <= n; k++) offs.push((amp * k) / n, (-amp * k) / n);
  for (const h of hs) {
    for (const off of offs) {
      const g = ghostOn(me);
      g.x = q.x; g.z = q.z; g.heading = h; g.sweepActive = false; g.headOffset = off;
      if (canSee(g, dummy, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
    }
  }
  return false;
}

/** How long the Sniper is up on one knee for a shot (s): the turn, the aim, the shot and the bolt. */
const KNEEL = 2.2;

/** Nobody (but `except`) will see the Sniper kneel where he lies from `a` to `b` s from now (the target included). */
function kneelHidden(D, a = 0, b = 0.8, except = []) {
  const sn = upright(D.c('sniper')), w = D.world;
  for (const e of alive(D)) {
    if (except.includes(e)) continue;
    for (let t = a; t <= b + 1e-6; t += 0.1) {
      if (seesAt(D, e, sn, t)) return false;
      // (a posted man's cone a few degrees either way and a little longer: the head's sweep is not timed to the tick)
      if (!walking(e) && Math.hypot(e.x - sn.x, e.z - sn.z) <= (e.vision?.far ?? 36) + 2) {
        for (const dh of [-0.08, 0.08]) {
          const c = coneAt(e, w.time + t);
          c.heading += dh; c.far *= 1.04;
          if (canSee(e, sn, w, { cone: c }) !== 'none') return false;
        }
      }
    }
  }
  return true;
}

/**
 * The first moment within `horizon` s at which the Sniper (lying where he is) has `e` in his sights through the aim,
 * kneels unseen, and nobody else will see the man fall nor his body for `quiet` s (`except`: men who will be dead by
 * then). null when there is none.
 */
export function shotWindow(D, e, { horizon = 40, except = [], from = 0, quiet = 60, R = 44.5 } = {}) {
  const sn = D.c('sniper'), w = D.world;
  const me = mirrorOf(e), at = (t) => { const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z }; const g = ghostOn(me); g.x = q.x; g.z = q.z; g.y = e.y || 0; return g; };
  const clear = (t) => { const g = at(t); return Math.hypot(g.x - sn.x, g.z - sn.z, (g.y || 0) - (sn.y || 0)) <= R && shotClear(w, sn, g, true); };
  // (from the order he turns to the target, aims and fires, then works the bolt kneeling: about two seconds up)
  for (let t = from; t <= horizon; t += 0.25) {
    if (!clear(t) || !clear(t + 1.6)) continue;
    if (!kneelHidden(D, t - 0.2, t + KNEEL + 0.4, except)) continue;
    const g = at(t + 1.2), others = alive(D).filter((o) => o !== e && !except.includes(o));
    const seen = others.some((o) => { for (let u = 0; u <= 2.4; u += 0.25) if (seesAt(D, o, upright(g), t + u)) return true; return false; })
      || others.some((o) => { for (let u = 0; u <= quiet; u += 1) if (seesAt(D, o, body(g.x, g.z, g.y), t + u)) return true; return false; });
    if (!seen) return t;
  }
  return null;
}

/** The Sniper drops `e` at the first unwitnessed moment (waiting where he lies until there is one). */
export async function snipe(D, tag, { maxSec = 300, ...o } = {}) {
  const e = D.get(tag), sn = D.c('sniper');
  await D.until(() => !e.alive || (D.world.time >= (sn._boltT ?? -1) && shotWindow(D, e, { ...o, horizon: 0.3 }) === 0), maxSec, `${tag}: an unwitnessed shot`);
  if (!e.alive) return;
  const n0 = sn.inventory.get('sniperRifle');
  D.ability('sniper', 'sniper', e);
  await D.until(() => !e.alive, 4, `${tag} shot`)
    .catch(() => { throw new Error(`${tag}: the shot did not go off (rounds ${n0} -> ${sn.inventory.get('sniperRifle')})`); });
  await D.idle('sniper', 4);
}

const KO_ID = { greenberet: 'knockoutFist', driver: 'knockoutClub', spy: 'knockoutChloroform' };

/** Does `e` (now and over the next `ahead` s, as predicted) have `man` in his cone? */
export function eyesOn(D, e, man, ahead = 1.2) {
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) if (seesAt(D, e, man, t)) return true;
  return false;
}

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him for `ahead` s, nobody else sees the blow, and the man down lies unseen for `quiet` s (`later`: men who will be
 * down by then). With `cuff`, `cuffer` cuffs him at once. A `ready.sliced` (takeClear) is awaited: a sliced look.
 */
export async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 20, later = [], maxSec = 300, cuff = true, cuffer = role === 'driver' ? 'greenberet' : role, label = '' } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  const check = (r) => {
    why.length = 0;
    if (!r) return dbg(D, ['not ready'], `ko ${victim.tag}`);
    const d = Math.hypot(victim.x - u.x, victim.z - u.z);
    if (d > reach) return dbg(D, [`far ${d.toFixed(1)}`], `ko ${victim.tag}`);
    const me = upright(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[u.x, u.z], [(u.x * 2 + victim.x) / 3, (u.z * 2 + victim.z) / 3]], ahead + 0.6, { mode: 'walk', why })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[(u.x + victim.x * 2) / 3, (u.z + victim.z * 2) / 3], [victim.x, victim.z]], ahead + 0.6, { mode: 'walk', except: [victim], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  };
  const what = `knock out ${victim.tag}${label ? ' ' + label : ''}`;
  if (ready.sliced) await D.untilAsync(async () => check(await ready()), maxSec, what);
  else await D.until(() => check(ready()), maxSec, what);
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
  if (cuff) await cuffMan(D, cuffer, victim);
}

/** A look-ahead generator run to its end (a logic run), or sliced (the live replay hands the frame back between slices). */
const settle = (D, it) => (D.runSliced ? D.runSliced(it) : Promise.resolve(drain(it)));
function drain(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }

/** A carrier's pace for the look-ahead (CONFIG.units.carry 1.6 m/s, a little under: the turns, the start). */
const CARRY_V = 1.45;
/** How much nearer each watcher the carry's way is tried as well (m): the walk may stray a little off the straight
 * line between its points (the spot he gets up on is where he lies: tried as it is). */
const CARRY_PAD = 0.25;

/**
 * Will a carry go unseen? `role`, beside bound `victim` (lying or on his feet), gets up, shoulders him — a man who still
 * has his packet of cigarettes on him gives that up to the first hand (BCD §1.5): two hands —, walks him on his feet
 * along `pts` at a carrier's pace and, at the last point, works the door or the tailboard and lies down again (`hold`
 * s). The spot he gets up on through the pick-up, then every point of the way at the moment he passes it, with a slack
 * that grows the further ahead it looks (routeClear: posts by their sweep, walkers along their beat).
 * `plan` (takeClear: the carry of a man about to be taken, judged before the blow): the very look carryWindow will make
 * `plan.t0` s from now, `role` then on his feet at `plan.from` beside the man lying at `plan.at`, the man's packet of
 * cigarettes gone to the cuffer with the cuffs (BCD §1.2). `ticks` (routeClearGen): the moments tried are the world's
 * own ticks, so that look, made earlier and with the wider slack, tries every moment the carry's own look will.
 */
function* carryClearGen(D, role, victim, pts, { hold = 2.5, why = null, plan = null, ticks = false, except = [] } = {}) {
  const u = D.c(role), A = CONFIG.abilities.carry;
  const t0 = plan?.t0 ?? 0, from = plan?.from ?? [u.x, u.z], at = plan?.at ?? [victim.x, victim.z];
  const up = plan ? true : u.stance === 'stand', cigs = plan ? 0 : (victim.cigs ?? 0);
  const delay = (up ? 0 : CONFIG.units.stanceUp) + (cigs > 0 ? 2 : 1) * A.pick + 0.3;
  const ex = [victim, ...except];
  const here = yield* sweepFine(D.world, routeClearGen(D, [], { mode: 'walk', from, delay: t0, hold: delay + 0.5, slack: 0.5, except: ex, why, ticks }));
  if (!here) return false;
  return yield* sweepFine(D.world, routeClearGen(D, [at, ...pts], { mode: 'walk', from, speed: CARRY_V, delay: t0 + delay, hold, slack: 0.8, slackRate: 0.06, pad: CARRY_PAD, except: ex, why, ticks }));
}
/** The pick-up of a man just cuffed, by a man on his feet (carryClearGen's delay: one hand, his pack went with the cuffs). */
const PICK_CUFFED = () => CONFIG.abilities.carry.pick + 0.3;

/**
 * A look-ahead with a halted walker's head tried every 50°/8 of his watch sweep (`w.sneakSweepSteps`), not only at its
 * middle, halves and ends: an elliptical band is longest straight ahead, so a man standing between two tried heads — a
 * few degrees off the middle, 30 m out — may be in the band while neither tried cone reaches him (cv1 at the lorry
 * line's north end and a man at the station's door on Easy). Set only while the look-ahead runs; the world is left as
 * it was between slices.
 */
function* sweepFine(w, gen, n = 8) {
  const s0 = w.sneakSweepSteps;
  w.sneakSweepSteps = n;
  try {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
      w.sneakSweepSteps = s0;
      yield;
      w.sneakSweepSteps = n;
    }
  } finally { w.sneakSweepSteps = s0; }
}

/**
 * Wait for an unseen carry (carryClearGen): at once when the way is clear now, else flat on his belly beside the man
 * (a man standing over a body is a man to be looked at) until it is — looked at every quarter second, sliced in a live
 * replay. `extra()`: a further condition on the moment (where the man is put down must stay unseen…). `ticks`: a carry
 * a take planned (takeClear) is looked at on the world's ticks, as the take looked at it.
 */
async function carryWindow(D, role, victim, pts, { hold = 2.5, maxSec = 180, label = '', extra = null, ticks = false } = {}) {
  const why = [];
  const ok = async () => {
    why.length = 0;
    if (!(await settle(D, carryClearGen(D, role, victim, pts, { hold, why, ticks })))) return dbg(D, why, label);
    return !extra || extra(why) || dbg(D, why, label);
  };
  if (await ok()) return;
  await D.stance(role, 'crawl'); // (down beside the man while the carry waits for its window)
  let next = -1;
  await D.untilAsync(async () => {
    if (D.t < next - 1e-9) return false;
    next = D.t + 0.25;
    return ok();
  }, maxSec, label);
}

/**
 * A knock-out's `ready` for a man who is carried away at once: will the whole take go unseen — `role` up on his feet
 * where he stands through the blow, the cuffs (and whatever else comes first: `lead` s in all), then the carry of the man
 * along `pts` (carryClearGen's way: his spot, then every point as he passes it) and the load or the drop at its end
 * (`hold` s)? Looked at every half second (held). A man knocked out on a window for the blow alone lay waiting for his
 * carry and was found: hm1 freed the bound Feldwebel at the tailboard (Easy started 12400 ticks late, round 8).
 * The window found is for a carry that starts `lead` s on, from where `role` will stand when the cuffs are on (a
 * step short of the man, on his side: CUFF_STAND), along the very way carryWindow looks at then — the carry is held to
 * that moment (carryAsPlanned), not started the moment the cuffs are on. The chloroform and the cuffs on the Feldwebel
 * took 3.7 s, not the 6 planned, and the carry looked at again then, 2 s early — and planned from where the Spy had
 * stood before the blow, its first leg a walk up to the man — found h1's sweep on its way at the tailboard: the
 * Feldwebel lay bound for his carry until hm1 found him (Easy under jitter seeds 5 and 6; with the carry held but still
 * planned from the look's spot, Easy started 3600-7333 ticks late). `take.at`: when that window was found.
 * The carry is judged by carryClearGen itself — the very look carryWindow makes at the carry's moment (`lead` s on
 * less the pick-up: carryAsPlanned), from the cuffing spot, the man where he lies — on the world's ticks (`ticks`):
 * made earlier, with the wider slack, it tries every moment the carry's own look will, so the window it finds is the
 * carry's. Its own steps from each window's start had stepped over h1's far band, which crossed the Feldwebel's way to
 * the tailboard for a few ticks of each half sweep: the take went ahead, the carry's look caught the tip, and the
 * Feldwebel lay bound until hm1 freed him (Easy under jitter seeds 17, 52 and 89, round 9).
 */
function takeClear(D, role, victim, pts, { lead = 6, hold = 3, except = [] } = {}) {
  const u = D.c(role), v = typeof victim === 'string' ? D.get(victim) : victim, w = D.world;
  const also = except.map((t) => (typeof t === 'string' ? D.get(t) : t)), ex = [v, ...also];
  const t0 = lead - PICK_CUFFED();
  function* look() {
    const dx = u.x - v.x, dz = u.z - v.z, d = Math.hypot(dx, dz), k = d > CUFF_STAND ? CUFF_STAND / d : 1;
    const stand = [v.x + dx * k, v.z + dz * k];
    return (yield* sweepFine(w, routeClearGen(D, [], { mode: 'walk', from: [u.x, u.z], hold: lead + 0.5, slack: 0.5, except: ex })))
      && (yield* sweepFine(w, routeClearGen(D, [], { mode: 'walk', from: stand, delay: Math.max(0, lead - 2.5), hold: 3, slack: 0.5, except: ex })))
      && (yield* carryClearGen(D, role, v, pts, { hold, plan: { t0, from: stand, at: [v.x, v.z] }, ticks: true, except: also }));
  }
  // (looked at every half second, its answer held in between; sliced in a live replay — the world stands still while it
  // hands the frame back: settle — the look on every tick of the carry's window is a few milliseconds' work)
  let at = null, next = -1, last = false;
  const take = async () => {
    if (D.t < next) return last;
    next = D.t + 0.5; at = D.t;
    return (last = await settle(D, look()));
  };
  take.lead = lead;
  take.sliced = true;
  Object.defineProperty(take, 'at', { get: () => at });
  return take;
}
/** Where a man who has chloroformed and cuffed another stands: this far from him, on the side he came from (m). */
const CUFF_STAND = 1.2;

/**
 * Hold a taken man's carry to the moment its window was found for (`take`, takeClear: `lead` s after the look that
 * found it): `role` stands on where he cuffed him — the look had him there that long — and the carry starts as planned
 * (his pick-up first). A take that ran long is carried at once (carryWindow looks again).
 */
async function carryAsPlanned(D, role, victim, take) {
  const u = D.c(role), e = typeof victim === 'string' ? D.get(victim) : victim, A = CONFIG.abilities.carry;
  if (take?.at == null) return;
  // (on his feet after the cuffs, the pack in his pocket: PICK_CUFFED, the moment takeClear judged the carry at)
  const pick = (u.stance === 'stand' ? 0 : CONFIG.units.stanceUp) + ((e.cigs ?? 0) > 0 ? 2 : 1) * A.pick + 0.3;
  const go = take.at + take.lead - pick;
  if (D.t < go - 1e-9) await D.until(() => D.t >= go - 1e-9, take.lead + 1, `${role} holds for ${e.tag}'s carry window`);
}

/** `role` shoulders the man (BCD §1.5: the first hand on a man who still has his pack takes the pack, the next one him). */
async function shoulder(D, role, e) {
  const u = D.c(role);
  await D.stance(role, 'stand');
  for (let k = 0; k < 3 && u.carrying !== e; k++) {
    D.ability(role, 'hand', e);
    await D.until(() => u.carrying === e || (!u.currentAction && !u.pendingAbility && !u.path && !u.isMoving && !((e.cigs ?? 0) > 0)), 10, `${role} at ${e.tag}`);
    await D.idle(role, 5);
  }
  if (u.carrying !== e) throw new Error(`${role} could not shoulder ${e.tag}`);
}

/**
 * `role` (Green Beret or Spy) cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). When the moment is not
 * there at once he lies down beside the man to wait for it (the cuffs get him up again: autoStand).
 */
export async function cuffMan(D, role, victim, { maxSec = 25 } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  const ready = () => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > 3.5) { if (!u.path && !u.isMoving) D.order(role, { type: 'move', x: victim.x, z: victim.z }); return false; }
    // (lying, he is on his feet again before the cuffs go on: that much longer upright)
    if (!unwitnessed(D, victim, upright(u), { ahead: u.stance === 'crawl' ? 2.2 + CONFIG.units.stanceUp : 2.2, strict: true, why })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  };
  if (!ready() && Math.hypot(victim.x - u.x, victim.z - u.z) <= 3.5) await D.stance(role, 'crawl');
  await D.until(ready, maxSec, `cuff ${victim.tag}`);
  D.ability(role, 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle(role, 5);
}

/** `role` shoulders bound / dead `tag`, carries him along `pts` and puts him down at the last one, unseen. */
export async function carryMan(D, role, tag, pts, { maxWait = 180, quiet = 600, label = '', drop = true } = {}) {
  const u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag;
  const end = pts[pts.length - 1];
  // (where he is put down stays unseen for `quiet` s)
  const extra = drop && quiet > 0 ? (why) => { const f = bodySeen(D, end[0], end[1], quiet, { step: 1, except: [e] }); if (f.length) why.push(`at the end seen by ${f.join(',')}`); return !f.length; } : null;
  await carryWindow(D, role, e, pts, { hold: drop ? CONFIG.abilities.carry.drop + 1.2 : 1.5, maxSec: maxWait, label: `window to carry ${e.tag}${label ? ' ' + label : ''}`, extra });
  await shoulder(D, role, e);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5 });
  if (!drop) return;
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${e.tag} put down`);
  await D.idle(role);
}

/**
 * The walkable spot in the box [x0, z0]–[x1, z1] (1 m grid) nearest `from` where a man down would lie unseen for `quiet`
 * s (bodySeen: any viewer's full cone, both bands), or null.
 */
export async function findDump(D, [x0, z0, x1, z1], from, quiet = 300, except = []) {
  const g = D.world.grid, cells = [];
  for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) if (g.walkableAt(x, z)) cells.push([x, z, Math.hypot(x - from[0], z - from[1])]);
  cells.sort((a, b) => a[2] - b[2]);
  // (sliced in the live replay — a run of long looks in one task was a hitch —, straight through in a logic-only run)
  const seen = (x, z) => (D.runSliced ? D.runSliced(bodySeenGen(D, x, z, quiet, { step: 1, except })) : Promise.resolve(bodySeen(D, x, z, quiet, { step: 1, except })));
  for (const [x, z] of cells) if (!(await seen(x, z)).length) return [x, z];
  return null;
}

/**
 * `role` shoulders bound `victim` and puts him inside the enterable building `door` ('<structure>:door'), unseen: the
 * whole carry (carryWindow) to `at`, where he stands to work the door (the use ability's 1.2 m in front of it).
 */
export async function stowMan(D, role, victim, door, { maxWait = 120, label = '', at } = {}) {
  const u = D.c(role), e = typeof victim === 'string' ? D.get(victim) : victim;
  const d = D.world.interactables.find((i) => i.tag === door || i.id === door);
  if (!d) throw new Error(`no door ${door}`);
  await carryWindow(D, role, e, [at ?? [d.x, d.z]], { hold: d.activationTime + 2, maxSec: maxWait, label: `window to carry ${e.tag} into ${door}${label ? ' ' + label : ''}` });
  await shoulder(D, role, e);
  D.order(role, { type: 'ability', id: 'use', target: d });
  await D.until(() => e.hidden, 20, `${e.tag} put inside ${door}`);
  await D.idle(role);
  await D.stance(role, 'crawl'); // (down at once: a man standing at a door is a man to be looked at)
}

/** Flat on the snow along an unseen plan (he lies down first: a plan for a crawler is no use to a standing man). */
/**
 * A timed strike: `role` waits at `hold` until the strike spot `at` will stay unseen through the crawl in and
 * `strikeSec` s more (and a plan there exists), crawls in and knocks `victim` out (knockOut's rules); if no clean moment comes within `strikeSec` s he
 * crawls back to `hold` and tries again (up to `tries` times).
 */
export async function strike(D, role, victim, { hold, at, strikeSec = 12, tries = 8, keepFrom = undefined, label = '', ahead = 5, ...ko } = {}) {
  const v = typeof victim === 'string' ? D.get(victim) : victim;
  for (let k = 0; ; k++) {
    await crawlTo(D, role, ...hold, { horizon: 160, keepFrom, label: `${role} to his hold (${v.tag})` });
    // (the spot must stay quiet from now through the crawl in and the whole of the strike's wait)
    await crawlTo(D, role, ...at, { horizon: 160, keepFrom, hold: strikeSec + 3, label: `${role} in on ${v.tag}` });
    try {
      await knockOut(D, role, v, { maxSec: strikeSec, label, ahead, ...ko }); // (ahead: the crawl in, the stand-up and the blow)
      return;
    } catch (e) {
      if (k + 1 >= tries || !/timeout/.test(e.message)) throw e;
      dbg(D, [`retry ${k + 1}: ${e.message.slice(0, 60)}`], `strike ${v.tag}`);
    }
  }
}

/** `fn` worked out at most once per `sec` s of game time, its last answer given in between (a look-ahead in a
 * condition asked every tick). */
export function held(D, sec, fn) {
  let next = -1, last = false;
  return () => { if (D.t >= next) { next = D.t + sec; last = fn(); } return last; };
}

/** `fn` checked at most once per `every` s of game time (a costly plan in a wait condition), false between checks. */
export function every(D, sec, fn) {
  let next = -1;
  return () => { if (D.t < next) return false; next = D.t + sec; return fn(); };
}

/**
 * Home in short legs: straight for `goal` when a plan there exists, else to the first of `holds` (in order of
 * preference, nearer the goal first) that is reachable now and nearer the goal than he is; there, try again.
 */
export async function legsTo(D, role, goal, holds, { keepFrom, label = '', maxSec = 500 } = {}) {
  const u = D.c(role), dist = (p) => Math.hypot(p[0] - goal[0], p[1] - goal[1]), t0 = D.t;
  while (D.t - t0 < maxSec) {
    // (sliced plans: the live replay hands the frame back between slices — a run of plans in one task was a hitch)
    if (await planSneakAsync(D, ...goal, { mode: 'crawl', role, horizon: 120, keepFrom })) return crawlTo(D, role, ...goal, { horizon: 120, keepFrom, label });
    const here = dist([u.x, u.z]);
    let next = null;
    for (const h of holds.filter((q) => dist(q) < here - 3)) if (await planSneakAsync(D, ...h, { mode: 'crawl', role, horizon: 60, keepFrom, hold: 20 })) { next = h; break; }
    if (next) await crawlTo(D, role, ...next, { horizon: 60, keepFrom, hold: 20, label: `${label} (leg)` });
    else await D.wait(2);
  }
  throw new Error(`${role}: no way home to (${goal}) in ${maxSec} s`);
}

export async function crawlTo(D, role, x, z, o = {}) {
  if (D.c(role).stance !== 'crawl') await D.stance(role, 'crawl');
  const stop = unstickWatch(D, role);
  try { return await sneak(D, x, z, { mode: 'crawl', role, horizon: 120, ...o, label: o.label ?? `${role} → (${x},${z})` }); } finally { stop(); }
}

/**
 * A crawl's watchdog (a side task, every tick): a leg that left him a few centimetres inside a metre cell whose middle
 * is rock — a straight leg round a corner, the station's corner by the terrace steps — leaves the planner no way out of
 * that cell (it walks from cell middles): once he has lain still there a second, a short crawl to the nearest open
 * cell's middle; the plan is made again from there. Nothing is ordered while he lies in an open cell.
 */
function unstickWatch(D, role) {
  const u = D.c(role), g = D.world.grid, opt = { crawl: true };
  let still = 0, done = false;
  D.meanwhile(() => {
    if (done) return true;
    if (u.path || u.isMoving || u.currentAction || u.pendingAbility || u.stance !== 'crawl') { still = 0; return false; }
    if ((still += D.dt) < 1) return false;
    still = 0;
    const cx = Math.floor(u.x) + 0.5, cz = Math.floor(u.z) + 0.5;
    if (g.walkableAt(cx, cz, opt)) return false;
    let best = null, bd = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = cx + di, z = cz + dj, d = Math.hypot(x - u.x, z - u.z);
      if ((di || dj) && d < bd && g.walkableAt(x, z, opt)) { bd = d; best = [x, z]; }
    }
    if (best) { try { D.order(role, { type: 'move', x: best[0], z: best[1] }); } catch { /* refused: tried again in a second */ } }
    return false;
  });
  return () => { done = true; };
}

/**
 * Crouched (walk speed, upright, no prints) along an unseen plan when there is one within `horizon` s, else flat on the
 * snow (crawl): the quick way where nobody can look, the low way where somebody might.
 */
export async function moveTo(D, role, x, z, o = {}) {
  const walkPlan = planSneak(D, x, z, { mode: 'walk', role, horizon: o.horizon ?? 120, keepFrom: o.keepFrom });
  if (walkPlan) {
    await D.stance(role, 'crouch');
    await sneak(D, x, z, { mode: 'walk', role, horizon: 120, ...o, label: o.label ?? `${role} → (${x},${z})` });
    if (o.lie !== false) await D.stance(role, 'crawl'); // (down again where he waits)
    return;
  }
  await D.stance(role, 'crawl');
  return crawlTo(D, role, x, z, { horizon: 220, ...o });
}

/** The first of `cands` the man can crawl to unseen within `horizon` s (planSneak), with its plan's arrival time. */
export async function reachableNest(D, role, cands, horizon = 150, o = {}) {
  for (const c of cands) {
    const p = await planSneakAsync(D, c[0], c[1], { mode: 'crawl', role, horizon, ...o });
    if (p) return { at: c, eta: p[p.length - 1][2] };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ the stages

/** The Sniper's nests: the tarn's rocks for rs1; the cliff's foot behind the dock for op2; under the OP for op3 (Hard). */
const NEST_R = [[102, 131], [102, 132], [101, 132], [103, 130], [101, 130], [102, 130]];
const NEST_A = [[101, 120], [100, 119], [101, 116], [102, 117], [100, 123], [101, 124]];
const NEST_B = [[100, 78], [101, 74], [100, 76], [99, 77], [98, 78], [101, 70], [104, 76]];
/** Holds under the ridge path (the Driver's, the Sapper's) and the Sapper's spots at the cornice. */
const HOLD_D = [101, 96], HOLD_S = [102, 100];
const CORNICE_SPOT = [71.4, 36.0], CORNICE_BACK = [102, 100];
/** The snow north of the gallery, beyond the ski patrol's reach and the OP's range: a place to wait it out. */
const CORNICE_REFUGE = [[72, 12], [68, 10], [78, 10]];
/** Holds on the way home from the refuge, along the snowfield's east side (nearest home first). */
const CORNICE_LEGS = [[102, 92], [103, 84], [103, 74], [103, 62], [104, 50], [102, 36], [100, 24], [92, 14], [84, 10]];
/** Behind the dock sentry (he faces the yard's east end): where the Green Beret comes up along the cable's foot. */
const GB_DOCK = [98.9, 129.6];
/** East of the cabin standing at the dock (the way past it is between its side and the cliff). */
const DOCK_E = [99.2, 128.6];
/** The Spy's place by the cable's foot, out of the Green Beret's way. */
const SPY_DOCK = [100.4, 131.2];
/** The press lorry: behind the Feldwebel (he faces the snowfield's foot) and behind the mechanic (he faces the press). */
const SPY_PF1 = [72.6, 163.6];
/** The Spy's fallback on the way there: the yard's end north of the lorry line, far out of the Feldwebel's eyes. */
const SPY_HOLD = [71.5, 147.5];
/** Where a man stands to put a captive in the press lorry's back (its tailboard), and to work the station's engine-room
 * door (the use ability's 1.2 m in front of the door, on the yard side). */
const TAILBOARD = [70.95, 160.9], STATION_DOOR = [86.45, 129.9];
/**
 * The Feldwebel's way to the lorry: north round the strip of snow between the lorry's tail and the far edge of h1's
 * reach (x 72.2-74.2, z 159-161.6: the hotel door's sentry sees an upright man there for a few ticks of each half
 * sweep, every 2.5 s, past the lorry's corner), then down into the lorry's shadow at its tail. Straight from his post to
 * the tailboard the carry crossed that strip: no slack window round its point ever missed a crossing.
 */
const PF1_WAY = [72.0, 162.3];
/** Where `role`, coming from `from`, stands to load a captive into `lorry` (the hull side facing him: abilities/drive). */
function loadSpot(D, lorry, from) {
  const p = boardPoint(D.world.byId(lorry), { x: from[0], z: from[1], canSwim: false }, null, true);
  return [p.x, p.z];
}
/** Vering: the Spy at the terrace's side steps, the Green Beret in the lane by them; the cabin's berth beside it. */
const SPY_STEPS = [81.6, 121.2], GB_LANE = [84.4, 118.6], BERTH = [96.4, 123.8];
/** The Major on the Green Beret's shoulder: out by the side steps, along the station lane to the berth. */
const VERING_WAY = [[86.4, 120.4], BERTH];
/** Where each man waits behind the dock for the cornice and the cabin. */
const DOCK_WAIT = { sniper: [100.6, 124.2], driver: [101.6, 126.6], sapper: [100.0, 129.4], spy: [98.8, 122.2], greenberet: [98.2, 124.6] }; // (south-west of the Feldwebel, behind him)
/** Behind the operator at the station's controls (he faces the station's wall). */
const GB_CTRL = [96.2, 121.4];
/** Keep a crawling man this far from the hotel's terrace and the yard's men (their beats turn without warning). */
const AWAY = { adj: 14, vering: 10, rad: 10, cv2: 10, h3: 10, cs1: 8 };
/**
 * The Spy on his feet in a private's tunic, where the men who see through it (the Feldwebel, the officers) might look:
 * their cones a few degrees wider and a metre and a half longer while he plans, and tried twice a step (a sweeping
 * head's elliptical band edge crosses a spot between two samples: a plan that grazed the Feldwebel's far band by a tick
 * failed the moment his start slipped).
 */
const SEEN_THROUGH = { postMargin: [6, 1.5], subSteps: 2 };
/** And from the ski patrol, whose file swings round at its corners. */
const SKI_AWAY = { sk1: 20, sk2: 20, sk3: 20 };
/**
 * The Spy on his feet in the tunic among the convoy's privates: they take him for one of theirs (BCD ranks), so a
 * walking private is kept only out of arm's reach (3.5 m, not the planner's 7 m for a man they would shoot at): the two
 * convoy men pacing the lorries' road side closed the only way round the cabs for minutes at a time at some starts
 * (round 8: Hard started 6000-15600 ticks late). The ski patrol's sergeant would know him: kept 20 m off.
 */
const IN_TUNIC = { ...SEEN_THROUGH, keepWalker: 3.5, keepFrom: SKI_AWAY };

/**
 * The parked hulls (the lorries, the bowser, the cabin at its dock: body-clearance's dynamic obstacles) as the
 * planner's `forbid` polygons, each widened by `pad` (a standing man's clearance, 0.4 m, and half a plan cell). The
 * planner walks the grid, where a parked hull is not stamped: its plan cut the press lorry's tail corner, a way the game
 * does not walk, and the Spy stood at that corner replanning the same way for minutes (round 8).
 */
function hullForbid(D, pad = 0.9) {
  return dynamicObstacles(D.world).filter((R) => R.hl != null).map((R) => {
    const c = Math.cos(R.h), s = Math.sin(R.h), a = R.hl + pad, b = R.hw + pad;
    return [[a, b], [-a, b], [-a, -b], [a, -b]].map(([u, v]) => [R.x + u * c - v * s, R.z + u * s + v * c]);
  });
}

/**
 * The team lands in the drop-zone rocks' west pocket (round 8: out of every cone at the start, and out from under the
 * ridge on the screen); while the Sniper works the ridge the Green Beret, the Sapper and the Driver crawl round to the
 * rocks' east side, where each one's way out over the snowfield starts (the Spy waits where he landed, by his) — the
 * pocket's other way out, west past the boulder, lies in h3's beat, and from its far corner the planner's look-ahead
 * ran out before it found the gap east. Flat, not walking: a man upright at the edge of h3's far band was seen for a
 * tick (Hard started 14 000 ticks late); there they crouch again, where they waited before round 8.
 */
const OUT_OF_POCKET = [['greenberet', 98.2, 159.4, 'the Green Beret'], ['sapper', 102.8, 158.4, 'the Sapper'], ['driver', 100.8, 155.2, 'the Driver']];
async function outOfThePocket(D) {
  await D.parallel(...OUT_OF_POCKET.map(([role, x, z, who], k) => async () => {
    if (k) await D.wait(2.5 * k);
    await crawlTo(D, role, x, z, { horizon: 60, label: `${who} round to the rocks' east side` });
    await D.stance(role, 'crouch');
  }));
}

async function stageA(D) {
  // the team waits crouched in the drop-zone rocks (out of every cone); the Sniper goes first, flat on the snow
  for (const r of ROLES) await D.stance(r, r === 'sniper' ? 'crawl' : 'crouch');
  D.checkpoint('A0 the team waits in the drop-zone rocks');
  await D.parallel(() => outOfThePocket(D), () => sniperRidge(D));
}

async function sniperRidge(D) {
  // the station's sentry on the ridge dock watches the cable, the dock and the cliff's foot behind it: the Sniper's
  // first round, from the tarn's rocks (nobody below looks there; the station hides the body from the ridge path)
  const nestR = await reachableNest(D, 'sniper', NEST_R, 120);
  if (!nestR) throw new Error('no nest for the Sniper at the tarn');
  await crawlTo(D, 'sniper', ...nestR.at, { horizon: 120, label: 'the Sniper to the tarn rocks' });
  D.checkpoint('A1 the Sniper crawls round the tarn to its rocks');
  await snipe(D, 'rs1', { maxSec: 300 });
  D.checkpoint('A2 the Sniper drops rs1 on the ridge dock');
  // with him gone nobody below watches the cliff's foot behind the dock: up it to a nest under the ridge path
  const nestA = await reachableNest(D, 'sniper', NEST_A, 150, { keepFrom: SKI_AWAY });
  if (!nestA) throw new Error('no nest for the Sniper under the ridge path');
  await crawlTo(D, 'sniper', ...nestA.at, { horizon: 150, keepFrom: SKI_AWAY, label: 'the Sniper up the cliff foot' });
  D.checkpoint('A3 the Sniper crawls up the cliff foot behind the dock');
  // op2 walks the ridge path on the lip: he drops walking north, his back to the Sniper, where nobody looks along it
  await snipe(D, 'op2', { maxSec: 300 });
  D.checkpoint('A4 the Sniper drops op2 on the ridge path');
  // (Hard) the OP's spotter is left alone: his glasses are on the upper snowfield with the lookout's, where a man lying
  // more than 18 m off is below their notice, and a body at the OP's feet would be found when the cornice comes down
}

/**
 * Nobody the slide would kill (scripts/e07.js closePass: in its rect, outside the gallery) but the gallery's north
 * sentry, nor anybody the charge itself would kill (its lethal ring, 6.75 m, reaches past the slide's east edge onto the
 * ski patrol's way down from the north: two skiers killed by the blast were heard by the OP's spotter, the summit's
 * alarm came up and the flak shot the cabin down — Hard started 6000 ticks late, round 8), now and for the next 2 s — a
 * walker given a metre and a half for the prediction's error, the ring a metre more.
 */
function slideClear(D) {
  const [x0, z0] = SLIDE[0], [x1, z1] = SLIDE[2];
  const bomb = plantedRemotes(D.world, D.c('sapper'))[0], ring = (CONFIG.weapons.remoteBomb.radius ?? 6.75) + 1;
  return () => !D.world.enemies.some((e) => {
    if (!e.alive || e.removed || (e.y || 0) > 2 || e.tag === 'g1' || e.tag === 'g2') return false;
    const mv = walking(e), m = mv ? 1.5 : 0;
    for (let t = 0; t <= 2; t += 0.5) {
      const q = mv ? predict(e, t) : e;
      if (q.x > x0 - m && q.x < x1 + m && q.z > z0 - m && q.z < z1 + m) return true;
      if (bomb && Math.hypot(q.x - bomb.x, q.z - bomb.z) < ring + m) return true;
    }
    return false;
  });
}

/**
 * Has checkpoint `id` (its first word) been reached — on an earlier tick than this one? Stage B's threads hand over by
 * checkpoint (the Spy's tunic waits for B5, the press for B6…), and a thread waiting for one sees it on the tick after
 * the one it was reached on, whichever of them goes first between two ticks. Seen at once, the hand-over depended on
 * that order, and the logic run and the live walkthrough do not resume their threads in the same order after a nested
 * D.parallel starts mid-round (packsUp, inside stage B's): the cold link at 4× put the Spy's tunic on a tick later than
 * the tested run (round 8). (`t` is the checkpoint's time to 0.01 s: half a tick tells the two ticks apart.)
 */
const reached = (D, id) => D.checkpoints.some((c) => c.name.split(' ')[0] === id && c.t < D.t - D.dt / 2);

// stage B's three threads (the Green Beret's station and press, the Spy's tunic, the Sapper's and the Driver's packs
// and the cornice), their pieces in the order their checkpoints come on Hard
async function stationDock(D) {
  // the dock sentry watches the lane up from the lorries and the yard's east end; nobody looks the way he turns his
  // back, along the cable to the cliff: the Green Beret comes from there, fists him, cuffs him and lays him under the cliff
  await D.stance('greenberet', 'crawl');
  await crawlTo(D, 'greenberet', ...GB_DOCK, { horizon: 220, keepFrom: AWAY, label: 'the Green Beret round the tarn to the cable\'s foot' });
  D.checkpoint('B1 the Green Beret crawls round the tarn to the cable\'s foot');
  await knockOut(D, 'greenberet', 'cs2', { reach: 4.5, quiet: 30, later: ['cs1'], label: 'at the dock' });
  await stowMan(D, 'greenberet', 'cs2', 'lower_station:door', { label: '(the station\'s engine room)', at: STATION_DOOR });
  D.checkpoint('B2 the Green Beret takes the dock sentry from behind and puts him in the station\'s engine room');
}

// the Spy (stage B's third flow): to the cable's foot behind the Green Beret, then into a private's tunic
async function yardDock(D) {
  await D.until(() => reached(D, 'B1'), 600, 'the Green Beret at the dock');
  await crawlTo(D, 'spy', ...SPY_DOCK, { horizon: 220, keepFrom: { adj: 14, h3: 12, cv3: 12, pf1: 16 }, label: 'the Spy round the tarn to the cable\'s foot' });
  D.checkpoint('B3 the Spy crawls round the tarn to the cable\'s foot');
}

async function packsUp(D) {
  // the Sapper and the Driver out of the rocks and up the cliff's foot behind the dock (nobody below watches it now),
  // crouched where no eye reaches (a crouching man leaves no prints in the snow), flat where one might
  await D.parallel(...[['driver', HOLD_D], ['sapper', HOLD_S]].map(([role, hold], k) => async () => {
    if (k) await D.wait(4);
    await crawlTo(D, role, ...DOCK_E, { horizon: 220, keepFrom: AWAY, label: `${role} round the tarn to the dock` });
    await crawlTo(D, role, ...hold, { horizon: 220, keepFrom: SKI_AWAY, label: `${role} up the cliff foot` });
  }));
  D.checkpoint('B4 the Sapper and the Driver crawl up the cliff foot behind the dock');
}

async function stationCtrl(D) {
  // the operator at the controls has his back to the dock
  await crawlTo(D, 'greenberet', ...DOCK_E, { horizon: 120, keepFrom: { adj: 14, vering: 10, rad: 10 }, label: 'the Green Beret round the cabin' });
  await crawlTo(D, 'greenberet', ...GB_CTRL, { horizon: 120, keepFrom: { adj: 14, vering: 10, rad: 10 }, label: 'the Green Beret behind the operator' });
  await D.until(() => reached(D, 'B3'), 400, 'the Spy by the cable\'s foot');
  await knockOut(D, 'greenberet', 'cs1', { reach: 4.5, quiet: 60, label: 'at the controls' }); // (the station hides him from the yard)
  await D.stance('greenberet', 'crawl');
  // the Spy takes the operator's tunic (a mountain private's) before he goes inside
  const cs1 = D.get('cs1');
  await crawlTo(D, 'spy', cs1.x + 1.4, cs1.z - 0.8, { horizon: 60, keepFrom: { adj: 14 }, label: 'the Spy to the operator' });
  D.ability('spy', 'hanger', cs1);
  await D.until(() => cs1.uniformTaken, 12, 'the Spy takes his tunic');
  await D.idle('spy', 5);
  await crawlTo(D, 'spy', ...SPY_DOCK, { horizon: 60, label: 'the Spy back by the cable\'s foot' });
  // (behind the cabin's dock, where the station itself hides him from the yard and the terrace)
  const dump = await findDump(D, [98, 120, 102, 126], [99.6, 124.4], 900, [cs1]);
  if (!dump) throw new Error('no place to lay the operator');
  await carryMan(D, 'greenberet', 'cs1', [dump], { quiet: 900, label: 'behind the dock' });
  await D.stance('greenberet', 'crawl');
  D.checkpoint('B5 the operator at the controls is knocked out; the Spy takes his tunic; he lies behind the dock');
  // (out of the lane's sight: round the cabin to the cable's foot, where he waits)
  await crawlTo(D, 'greenberet', ...DOCK_E, { horizon: 120, keepFrom: { adj: 14, vering: 10, rad: 10 }, label: 'the Green Beret back round the cabin' });
}

async function yardTunic(D) {
  await D.until(() => reached(D, 'B5'), 600, 'the operator\'s tunic taken');
  // dressed where nobody looks: a mountain private now (the privates take him for one of theirs)
  await D.until(() => D.canUse?.('spy', 'uniform') ?? true, 120, 'nobody looking at the Spy');
  D.ability('spy', 'uniform');
  await D.until(() => D.c('spy').disguised, 10, 'the Spy in uniform');
  await D.stance('spy', 'crawl');
  D.checkpoint('B6 the Spy puts on the operator\'s tunic');
}

async function packsTake(D) {
  // the container lies where the ski patrol turns: each man crawls in when the file has gone on, takes his own pack
  // (H: the owner's kit back) and crawls back to his hold
  for (const [role, tag, obj, hold] of [['sapper', 'knap_sap', 'o1', HOLD_S], ['driver', 'knap_drv', 'o1b', HOLD_D]]) {
    const pack = D.world.interactables.find((i) => (i.tag ?? i.id) === tag);
    await D.stance(role, 'crawl');
    await crawlTo(D, role, pack.x, pack.z - 1.2, { horizon: 200, keepFrom: SKI_AWAY, hold: 14, label: `${role} to the container` });
    D.ability(role, 'use', pack);
    await D.until(() => D.world.objectives.find((o) => o.id === obj)?.done, 15, `${role} takes his pack`);
    await D.idle(role, 4);
    await crawlTo(D, role, ...hold, { horizon: 160, keepFrom: SKI_AWAY, label: `${role} back to his hold` });
  }
  D.checkpoint('B7 the Sapper and the Driver take their packs from the container');
}

// the press lorry (the Green Beret and the Spy, after the station): the Feldwebel, the mechanic, the plates
/**
 * `role` shoulders cuffed `victim` and puts him in the back of `lorry` (BCD captive cargo), unseen: the whole carry
 * (carryWindow) by way of `via` to `at`, where he stands at the hull to load him. `ticks`: a carry a take planned
 * (takeClear) is looked at as the take looked at it.
 */
export async function loadCaptive(D, role, victim, lorry, { maxWait = 180, label = '', at, via = [], ticks = false } = {}) {
  const u = D.c(role), e = typeof victim === 'string' ? D.get(victim) : victim, v = D.world.byId(lorry);
  await carryWindow(D, role, e, [...via, at ?? [v.x, v.z]], { hold: 3, maxSec: maxWait, ticks, label: `window to put ${e.tag} in ${lorry}${label ? ' ' + label : ''}` });
  await shoulder(D, role, e);
  for (const p of via) await D.go(role, p[0], p[1], { tol: 0.5 });
  D.ability(role, 'enterVehicle', v);
  await D.until(() => e.vehicle === v, 30, `${e.tag} in ${lorry}`);
  await D.idle(role);
  await D.stance(role, 'crawl');
}

async function press(D) {
  // the Spy in a private's tunic: the privates take him for one of theirs (and his prints for a German's); the
  // Feldwebel and the officers would know him, so he walks where they do not look, up the lorries' tails behind the
  // Feldwebel, who faces the snowfield's foot
  const dis = D.c('spy').uniformType || 'soldier';
  const forbid = hullForbid(D);
  const walkSpy = async (x, z, label, o = {}) => { await D.stance('spy', 'stand'); await sneak(D, x, z, { mode: 'walk', role: 'spy', horizon: 120, disguise: dis, label, forbid, ...IN_TUNIC, ...o }); };
  // (round the lorries' cabs on the road side and in between the press lorry and the stores lorry: past their tails
  // the press, the mechanic and the Feldwebel himself close the way; when no way opens for a long while — the road
  // side's two men both near the cabs — back to the yard's end behind the lorry line, out of the Feldwebel's eyes, and
  // again from there)
  for (let k = 0; ; k++) {
    try { await walkSpy(...SPY_PF1, 'the Spy, in uniform, round the lorries\' cabs', { maxWait: 150 }); break; } catch (e) {
      if (k >= 3 || !/no way after/.test(e.message)) throw e;
      dbg(D, [`retry ${k + 1}`], 'the Spy to the Feldwebel');
      await walkSpy(...SPY_HOLD, 'the Spy back to the yard\'s end');
    }
  }
  // (only when the carry to the tailboard that follows the cuffs will go unseen too: a man left lying for his carry is
  // found — and freed — by the next man past. His way: north round h1's strip, PF1_WAY, then down to the lorry's tail)
  const pf1Load = loadSpot(D, 'lorry_press', PF1_WAY);
  const takePf1 = takeClear(D, 'spy', 'pf1', [PF1_WAY, pf1Load], { lead: 6, hold: 3.5 });
  await knockOut(D, 'spy', 'pf1', { reach: 3.5, ahead: 3, quiet: 20, later: ['pr1'], maxSec: 300, label: 'at the press lorry\'s tail',
    ready: takePf1 });
  await carryAsPlanned(D, 'spy', 'pf1', takePf1);
  await loadCaptive(D, 'spy', 'pf1', 'lorry_press', { via: [PF1_WAY], at: pf1Load, ticks: true, label: '(the Feldwebel)' });
  D.checkpoint('B8 the Spy, in uniform, goes round the lorries\' cabs to the Feldwebel\'s back, chloroforms him, cuffs him and puts him in the back of his lorry');
  // the mechanic oils the press with his back to the snowfield
  // (from the lorry's tail, where he put the Feldwebel in: the mechanic's back is to him)
  await D.stance('spy', 'stand');
  // (the cuffs and the plates come before his carry to the tailboard: the whole take unseen, as the Feldwebel's)
  const takePr1 = takeClear(D, 'spy', 'pr1', [TAILBOARD], { lead: 7.5, hold: 3.5 });
  await knockOut(D, 'spy', 'pr1', { reach: 3.5, ahead: 3, quiet: 25, maxSec: 300, label: 'at the press',
    ready: takePr1 });
  D.checkpoint('B9 the mechanic at the press: chloroform, cuffs');
  const plates = D.world.interactables.find((i) => (i.tag ?? i.id) === 'plates_case');
  D.ability('spy', 'use', plates);
  await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 20, 'the plates taken');
  D.checkpoint('B10 the Spy takes the type plates: the hammer has nothing left to smash');
  // the mechanic into the back with his Feldwebel, out of every eye
  await carryAsPlanned(D, 'spy', 'pr1', takePr1);
  await loadCaptive(D, 'spy', 'pr1', 'lorry_press', { at: TAILBOARD, ticks: true, label: '(the mechanic)' });
  D.checkpoint('B11 the mechanic goes in the back of the lorry too');
}

async function cornice(D) {
  // the Sapper on up the snowfield, flat, to the slope above the gallery (behind the ski patrol's file): a remote
  // charge at the cornice's foot, then back down to his hold under the ridge path
  const SKI14 = { sk1: 18.5, sk2: 18.5, sk3: 18.5 }; // (their near band is 18 m)
  await D.stance('sapper', 'crawl');
  // (hold: the cornice's foot stays quiet after he gets there, through the charge and his start back)
  await crawlTo(D, 'sapper', ...CORNICE_SPOT, { horizon: 160, keepFrom: SKI14, hold: 22, label: 'the Sapper up the slope to the cornice' });
  D.ability('sapper', 'remoteBomb');
  await D.idle('sapper', 8);
  D.checkpoint('B12 the Sapper sets a remote charge at the cornice\'s foot');
  // back down the snowfield when the ski patrol is out of the way; if it is coming round, first up to the snow north
  // of the gallery, out of its reach, and down when it has gone by
  let back = null;
  for (const h of [CORNICE_BACK, ...CORNICE_REFUGE]) {
    if (await planSneakAsync(D, ...h, { mode: 'crawl', role: 'sapper', horizon: h === CORNICE_BACK ? 160 : 40, keepFrom: SKI14 })) { back = h; break; }
  }
  if (!back) throw new Error('no way off the cornice');
  await crawlTo(D, 'sapper', ...back, { horizon: 160, keepFrom: SKI14, label: 'the Sapper off the cornice' });
  if (back !== CORNICE_BACK) await legsTo(D, 'sapper', CORNICE_BACK, CORNICE_LEGS, { keepFrom: SKI14, label: 'the Sapper back down the snowfield' });
  D.checkpoint('B13 the Sapper crawls back down the snowfield');
}

export const STAGES = [
  ['A', 'The ridge', stageA],
  ['B', 'Station, packs, plates and cornice', async (D) => {
    // the Sapper and the Driver up the cliff's foot to the container, the Sapper on to the cornice; meanwhile the Green
    // Beret takes the lower station from the cable's side
    await D.parallel(
      async () => { await D.until(() => reached(D, 'B1'), 400, 'the Green Beret at the dock'); await packsUp(D); await packsTake(D); await cornice(D); },
      async () => { await stationDock(D); await stationCtrl(D); await D.until(() => reached(D, 'B6'), 120, 'the Spy in uniform'); await press(D); },
      async () => { await yardDock(D); await yardTunic(D); },
    );
  }],
  ['C', 'Major Vering', async (D) => {
    // the Major and his adjutant face the gable's French windows, their backs to the terrace's side steps on the
    // station lane: the Spy, in uniform, comes up the lane behind them; the Green Beret crawls round the station to him
    const dis = D.c('spy').uniformType || 'soldier';
    await D.parallel(
      async () => { await D.stance('spy', 'stand'); await sneak(D, ...SPY_STEPS, { mode: 'walk', role: 'spy', horizon: 160, disguise: dis, label: 'the Spy up the station lane', forbid: hullForbid(D), ...IN_TUNIC }); },
      () => crawlTo(D, 'greenberet', ...GB_LANE, { horizon: 160, keepFrom: { adj: 10, vering: 8, rad: 10 }, label: 'the Green Beret round the station to the lane' }),
    );
    D.checkpoint('C1 the Spy, in uniform, walks up the station lane; the Green Beret crawls round the station');
    // (the Major lying at his desk is in sight of the yard and the lorry line within the minute: he is taken only when
    // the carry that follows — the Green Beret over to him, the Major on his shoulder out by the side steps and along
    // the lane to the berth, a dozen seconds on, both men down by then — will itself go unseen)
    const ver = D.get('vering'), adj = D.get('adj');
    const carryAhead = held(D, 0.5, () => drain(sweepFine(D.world, routeClearGen(D, [[ver.x, ver.z], ...VERING_WAY], {
      mode: 'walk', from: D.c('greenberet') && [D.c('greenberet').x, D.c('greenberet').z], speed: CARRY_V, delay: 12, hold: 2,
      slack: 1.0, slackRate: 0.06, pad: CARRY_PAD, except: [ver, adj] }))));
    await knockOut(D, 'spy', 'vering', { reach: 3.5, ahead: 3, quiet: 25, later: ['adj'], maxSec: 240, label: 'at his desk', ready: carryAhead });
    D.checkpoint('C2 the Spy chloroforms Major Vering at his desk and cuffs him');
    await knockOut(D, 'spy', 'adj', { reach: 3.5, ahead: 3, quiet: 25, maxSec: 240, label: 'at the Major\'s elbow' });
    D.checkpoint('C3 the adjutant: chloroform, cuffs');
    // the adjutant stays where he fell behind the desk (no eye reaches that corner of the boards); the Major goes to
    // the cabin's berth
    await carryMan(D, 'greenberet', 'vering', VERING_WAY, { quiet: 0, label: 'to the cable car' });
    await D.until(() => D.get('vering').vehicle, 10, 'Major Vering aboard the cabin');
    await D.stance('greenberet', 'crawl');
    D.checkpoint('C4 the Green Beret carries the Major to the cable car; the adjutant lies behind the desk');
  }],
  ['D', 'Up to the ridge', async (D) => {
    // everyone to the cable's foot behind the dock
    await D.parallel(...['sniper', 'driver', 'sapper', 'spy', 'greenberet'].map((r, k) => async () => {
      await D.wait(k * 2);
      await crawlTo(D, r, ...DOCK_WAIT[r], { horizon: 200, keepFrom: SKI_AWAY, label: `${r} to the dock` });
    }));
    D.checkpoint('D1 the team gathers behind the cable car\'s dock');
    // the Sapper fires the cornice: the mountain comes down on the gallery and the north road (o3) — when nobody but the
    // gallery's own two men is under it (the ski patrol's file crosses the slide's corner: men dying in it are heard on
    // the ridge, and with the summit's alarm up the flak shoots the cabin down)
    await D.until(slideClear(D), 300, 'the snow under the cornice clear');
    D.ability('sapper', 'detonate');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o3')?.done, 15, 'the cornice down');
    D.checkpoint('D2 the Sapper fires the charge: the cornice buries the gallery and the north road');
    // everyone aboard: the cabin leaves for the ridge station
    const car = D.world.byId('cablecar');
    for (const r of ['greenberet', 'spy', 'sapper', 'driver', 'sniper']) {
      await D.stance(r, 'stand');
      D.ability(r, 'enterVehicle', car);
      await D.until(() => D.c(r).vehicle === car, 30, `${r} aboard the cabin`);
    }
    D.checkpoint('D3 everyone aboard: the cabin climbs to the ridge station');
    await D.until(() => D.world.missionOver || D.world.objectives.every((o) => !o.required || o.done), 120, 'the cabin at the ridge station');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  if (STOP) { const cp = D.checkpoint; D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  D.straightDashes = true;
  w.sneakTurns = true;
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null) || (w.scriptFail ? `mission failed: ${w.scriptFail}` : null);
  const from = ctx.from ?? FROM;
  for (const [id, title, fn] of STAGES) {
    if (from && id < from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
