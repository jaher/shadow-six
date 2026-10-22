/**
 * M12 "Up on the Roof" (Tunis): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m12 (also tests/m12-solution.test.mjs). Walkthrough: m12.walkthrough.mjs.
 *
 * Outline (dossier docs/missions/m12.md §11, the "clockwise" route over the roofs; 24 killed: 11 by the Spy, 8 by
 * the Green Beret, 5 by the Sniper (5 of his 7 rounds); no alarm anywhere, nobody ever inside a live cone, the
 * driver's exposure watch):
 *   A  the ledge: the Spy, in uniform, climbs onto the jail ledge. e2 on the tile roof (east halt, nobody else sees
 *      that spot); while e5 walks off west, the three ledge sentries e15, e14, e16 from behind; then e5, followed
 *      along the balcony and injected before he looks at the ledge
 *   B  the courtyard: the Spy talks to the courtyard patrol's sergeant at its east halt (all three turn their backs
 *      on the courtyard); the Green Beret slips out of his hideout, knifes e1 and the patrol from behind
 *   C  the jailbreak: the Green Beret opens the cell (objective 1); he and the Informer wait at the foot of L2
 *   D  the northern roofs: the Spy injects e6 (palace raised roof), e7 (palace roof), e13 (outside the Sniper's
 *      shack); the Sniper slips out to the terrace's south wall; the Spy injects e18 and e19 back to back on house_e2,
 *      then holds e17 facing south; the Sniper's volley: e11, e10, e12, e9, e17
 *   E  over the roofs: the Green Beret and the Informer climb L2 unwatched; all three crawl over the souk and house_e2
 *      and over plank P2 onto the mosque pavilion's roof (nobody sees it)
 *   F  the mosque platform (the harbour HQ's side: one alert fails the mission): the Spy injects e24 below the
 *      pavilion's ladder, holds e32 facing south; the Green Beret knifes e27, then e32
 *   G  the south rim: the Spy holds e31 facing south; the Green Beret knifes e30, then e31
 *   H  the getaway: the Spy holds e26 (who looks through the gap at the east walk's south end); the team gathers on
 *      the east walk; one by one, when the quay patrol has turned back west, each walks down the SE stairs and along
 *      the quay into the car; the Spy last. The car drives off east (objective 2).
 * Orders only (move / crawl / stance / ability / enter the car); timing reads what a player sees: the cones.
 */
import { clearFor, routeClear, unwitnessed, bodySeen, predict, walking } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';

const DBG = !!globalThis.process?.env?.M12DBG || !!globalThis.__M3DBG;

/** The Spy as the guards would see him without the uniform (a suspicious act is judged that way, §3.4). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/** Does `e` (now, and over the next `ahead` s as predicted) have the bare man at (x, z, y) in his cone? */
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
 * A margin on top of unwitnessed: would anyone (but `skip`) see the bare man at `man` over the next `ahead` s if
 * a walker's head were turned up to `turn` rad either way from where it is predicted to look (a glance at a halt,
 * a sweep the prediction does not model)? A suspicious act is only ever made where nobody could glance at it.
 */
function glanced(D, man, skip = [], ahead = 1.5, turn = 0.7) {
  const w = D.world;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || skip.includes(e) || e.incapacitated) continue;
    // (anyone who sees him right now, as he stands and looks: the prediction may put a man half a metre off)
    if (Math.hypot(e.x - man.x, e.z - man.z) < (e.vision.far ?? 36) + 3 && canSee(e, man, w) !== 'none') return e.tag;
    if (!(e.route?.length > 1) || !walking(e)) continue; // (a post's sweep is modelled: coneAt)
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

/** (debug) log why a wait goes on, now and then; always false */
let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 120 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/**
 * The Spy injects `victim`: from `stage` (a spot behind where the victim will stand), once `ready()` holds, the victim
 * cannot see the needle coming (his cone off the Spy as he would look without the uniform), nobody else sees him fall
 * or sees the Spy at it, and nobody but `later` (men who die next) would find the body for `quiet` s.
 */
async function inject(D, victim, { stage = null, ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 2.2, idle = true, label = '' } = {}) {
  const sp = D.c('spy'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  if (stage) await D.go('spy', stage[0], stage[1], { tol: 0.35, max: 120 });
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `inject ${victim.tag}`);
    if (Math.hypot(victim.x - sp.x, victim.z - sp.z) > reach) return dbg(D, ['far'], `inject ${victim.tag}`);
    const me = bare(sp);
    if (eyesOn(D, victim, me, 1.4)) return dbg(D, ['victim looks'], `inject ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead: 1.4, strict: true, why })) return dbg(D, why, `inject ${victim.tag}`);
    const g = glanced(D, me, [victim]);
    if (g) return dbg(D, [`${g} could glance`], `inject ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `inject ${victim.tag}`);
    return true;
  }, maxSec, `inject ${victim.tag}${label ? ' ' + label : ''}`);
  if (DBG) {
    const me = bare(sp), w = D.world;
    D.log(`DBG inject ${victim.tag} now: ${w.enemies.filter((e) => e.alive && e.vision && Math.hypot(e.x - sp.x, e.z - sp.z) < 40).map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)} ho${Math.round(((e.headOffset || 0) * 180) / Math.PI)} sw${e.sweepActive ? 1 : 0} ${e.brain?.state}${e.brain?.atWait ? ' wait' + (e.brain.waitT ?? 0).toFixed(1) : ''} sees=${canSee(e, me, w)} walking=${walking(e)}`).join(' | ')}`);
  }
  // (an order while he still lowers the last man waits until that may be cut short)
  await D.until(() => !sp.currentAction || sp.currentAction.interruptible !== false, 3, 'the Spy free');
  D.ability('spy', 'syringe', victim);
  await D.until(() => !victim.alive, 6, `${victim.tag} injected`);
  // (the kill done, he may cut the lowering short: the next order does)
  await D.until(() => !sp.currentAction || sp.currentAction.interruptible, 3, 'the Spy lets go');
  if (idle) await D.idle('spy', 5);
}


/**
 * The Green Beret knifes `victim` (walking up to him from where he stands), once `ready()` holds, the victim does not
 * see him coming and nobody else sees the blow or the body falling; `later` / `quiet` as for inject.
 */
async function knife(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 3.5, label = '' } = {}) {
  const gb = D.c('greenberet'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `knife ${victim.tag}`);
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > reach) return dbg(D, ['far'], `knife ${victim.tag}`);
    const me = bare(gb);
    if (eyesOn(D, victim, me, 1.6)) return dbg(D, ['victim looks'], `knife ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead: 1.6, strict: true, why })) return dbg(D, why, `knife ${victim.tag}`);
    if (!clearFor(D, [[gb.x, gb.z], [(gb.x + victim.x) / 2, (gb.z + victim.z) / 2]], 2, { mode: 'walk', except: [victim], why })) return dbg(D, why, `knife ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    return true;
  }, maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  if (gb.stance !== 'stand') await D.stance('greenberet', 'stand'); // (on his feet, he walks up and strikes at once)
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run: false });
  await D.until(() => !victim.alive, 10, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
}


/** The Sniper as the guards see him while he aims (he kneels: tried as a man standing). */
const kneeling = (sn) => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

/**
 * The Sniper shoots `victim` from where he lies, once `ready()` holds, nobody would see the victim fall or the Sniper
 * kneeling to aim, and nobody but `later` would find the body for `quiet` s.
 */
async function snipe(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, label = '' } = {}) {
  const sn = D.c('sniper'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    if (D.world.time < (sn._boltT ?? -1) || sn.currentAction || sn.pendingAbility) return false;
    if (!ready()) return dbg(D, ['not ready'], `snipe ${victim.tag}`);
    if (Math.hypot(victim.x - sn.x, victim.z - sn.z) > 44) return dbg(D, ['range'], `snipe ${victim.tag}`);
    if (!unwitnessed(D, victim, kneeling(sn), { ahead: 1.2, strict: true, why, except: later.filter((e) => e.brain?.state === 'DISTRACTED') })) return dbg(D, why, `snipe ${victim.tag}`);
    if (!clearFor(D, [[sn.x, sn.z]], 1.2, { mode: 'walk', why, except: [victim] })) return dbg(D, why, `snipe ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `snipe ${victim.tag}`);
    return true;
  }, maxSec, `snipe ${victim.tag}${label ? ' ' + label : ''}`);
  D.ability('sniper', 'sniper', victim);
  await D.until(() => !victim.alive || (!sn.currentAction && !sn.pendingAbility), 3, `${victim.tag} shot`);
  if (victim.alive) throw new Error(`snipe ${victim.tag}: missed`);
}


/** Crawl along `pts` (plain orders, ground nobody watches), each point in turn. */
async function crawlPath(D, role, pts) {
  await D.stance(role, 'crawl');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.6, max: 180 });
}


/**
 * Walk (or crawl) along `pts` in one go, once nobody will see him anywhere on the way (routeClear: the cones predicted
 * as he passes) nor at its end for `hold` s (m14.solution moveOpen).
 */
async function moveOpen(D, role, pts, { mode = 'walk', maxWait = 300, label = 'move', hold = 3, pad = 1.2, slack = 0.5, except = null } = {}) {
  const u = D.c(role);
  const rise = mode !== 'crawl' && u.stance === 'crawl' ? 0.7 : 0;
  const sp = mode === 'crawl' ? 0.8 : 2.0, fast = mode === 'crawl' ? 1.0 : 2.3;
  const why = [];
  // (the checks all pass or the way is not clear: the one that failed last time is asked first, each asking the guard
  // who saw last time first — routeClear `hint`; the same answer, tick for tick, as toCar's)
  const hints = [], hintOf = (i) => (hints[i] ||= { e: null });
  let lastFail = -1;
  await D.until(() => {
    why.length = 0;
    const checks = [];
    if (rise) checks.push((h) => routeClear(D, [[u.x, u.z]], { mode, from: [u.x, u.z], delay: rise / 2, slack: rise / 2 + 0.2, why, pad, except, hint: h }));
    for (const v of [sp, fast]) checks.push((h) => routeClear(D, pts, { mode, from: [u.x, u.z], speed: v, delay: 0.2 + rise, slack, why, pad, except, hint: h }));
    let t = 0.2 + rise, [x, z] = [u.x, u.z];
    for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / sp; x = px; z = pz; }
    const end = pts[pts.length - 1];
    for (let hh = 0; hh <= hold; hh += 0.5) checks.push((h) => routeClear(D, [end], { mode, from: end, delay: t + hh, slack: 0, why, pad, except, hint: h }));
    if (lastFail >= 0 && lastFail < checks.length && !checks[lastFail](hintOf(lastFail))) return dbg(D, why, label);
    for (let i = 0; i < checks.length; i++) if (i !== lastFail && !checks[i](hintOf(i))) { lastFail = i; return dbg(D, why, label); }
    return true;
  }, maxWait, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  await D.stance(role, mode === 'crawl' ? 'crawl' : 'stand');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.5, max: 120 });
}


/** Walk through `pts`; a man who stops short (a guard walking the same narrow strip in his way) waits and goes on. */
async function walk(D, role, pts, { tol = 0.6 } = {}) {
  for (const [x, z] of pts) {
    for (let k = 0; ; k++) {
      try { await D.go(role, x, z, { tol, max: 120 }); break; } catch (e) {
        if (k >= 8 || !/stopped at/.test(e.message)) throw e;
        await D.wait(1.5);
      }
    }
  }
}


/**
 * The Spy walks up behind `victim` as he walks his beat and injects him once `ready()` holds and the inject checks
 * pass (inject: he does not see the Spy, nobody sees him fall, nobody finds the body for `quiet` s).
 */
async function tailInject(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 120, label = '' } = {}) {
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
  await inject(D, victim, { ready, later, quiet, maxSec: 6, label });
}

// ---------------------------------------------------------------- places
const L4_FOOT = [30.5, 39.6], L4_TOP = [29.8, 36.8]; // courtyard ↔ jail ledge
const PT_STAGE = [44.9, 40.4]; // just east of the courtyard patrol's east halt
const L2_FOOT = [45.0, 30.0], L2_TOP = [47.6, 27.9]; // courtyard ↔ souk roof ("the ladder by 13")
const E6_STAGE = [40.1, 22.3]; // on the raised roof, behind e6's west halt (he looks west)
const E7_STAGE = [36.7, 16.7]; // behind e7's east halt (he looks east)
const SN_SPOT = [58.5, 18.4]; // prone on the terrace, by its south wall: the souk in view
const DUO = [73.2, 61.4]; // behind e18's post (he looks west) and behind e19's east halt (he looks east)
const PAV_WAIT = { greenberet: [47.2, 70.6], guest: [48.4, 69.2], sniper: [45.7, 70.4] }; // on the pavilion roof
const L5_TOP = [46.2, 73.0], L5_FOOT = [45.6, 76.2]; // pavilion roof ↔ mosque platform
const E24_STAGE = [48.0, 75.0]; // behind e24's west halt (he looks west)
const GB_C1 = [50.0, 79.4]; // prone at the east end of the pavilion court's wall
const E32_HOLD = [53.5, 87.5]; // south of e32's east halt
const E31_HOLD = [42.6, 101.8]; // south of e31's west halt
const GB_E30 = [47.2, 95.6]; // prone behind e30's post
const EAST_WALK = [[48, 78.6], [51.5, 80.5]]; // from the foot of the pavilion ladder round the court wall
/** Where each man waits at the south end of the east walk (on the platform: out of sight of the quay below). */
const E26_HOLD = [36.6, 86.6]; // west of e26's post in the hall court
const PLAT_WAIT = { greenberet: [53.6, 82.8], guest: [52.4, 81.6], sniper: [54.1, 84.4], spy: [52.2, 83.8] };
const L2_WAIT = { greenberet: [43.6, 31.6], guest: [42.6, 33.0] }; // at the foot of L2 (nobody sees the courtyard now)

export const STAGES = [
  ['A', 'The ledge over the jail', async (D) => {
    D.checkpoint('A0 the Spy in uniform in the courtyard; the Green Beret and the Sniper hidden');
    // up the ladder east of the jail door onto the ledge (in uniform: nobody minds a German soldier)
    await D.go('spy', ...L4_FOOT, { tol: 0.5 });
    await D.go('spy', ...L4_TOP, { tol: 0.5 });
    D.checkpoint('A1 the Spy climbs onto the jail ledge');
    // e2 on the tile roof: at the east end of his beat he looks south over the courtyard; the Spy stands behind him
    await D.path('spy', [[21, 36.6], [20.6, 38.4], [15, 40.2], [9.6, 41.9]]);
    await inject(D, 'e2', { ready: () => { const e = D.get('e2'); return e.brain?.atWait && Math.hypot(e.x - 9, e.z - 43.5) < 0.5; }, later: ['e5'], label: 'at the east end of his beat' });
    D.checkpoint('A2 the Spy injects e2 on the tile roof');
    // the three ledge sentries all face the courtyard, and e16 over the jail door glances along the balcony where e5
    // walks; e5 sees the ledge when he walks back east. So: while e5 walks off west, the Spy injects the three
    // sentries from behind, the far one first; then he follows e5 back along the balcony and injects him from behind
    // before he can look at the ledge
    const e5 = D.get('e5');
    await D.path('spy', [[15, 40.2], [20.6, 38.4], [21, 36.6]]);
    await D.go('spy', 22, 29.4, { tol: 0.35 });
    const e5West = () => Math.cos(e5.heading) < -0.7 && e5.x > 18.5 && !e5.brain?.atWait;
    await inject(D, 'e15', { ready: e5West, later: ['e14', 'e16'], quiet: 18, maxSec: 600, label: 'while e5 walks off west' });
    D.checkpoint('A3 the Spy injects e15 from behind');
    await inject(D, 'e14', { stage: [27.6, 29.6], later: ['e16'], quiet: 16 });
    D.checkpoint('A4 the Spy injects e14 at the foot of the ladder');
    await inject(D, 'e16', { stage: [26, 35.2], quiet: 14 });
    D.checkpoint('A5 the Spy injects e16 over the jail door');
    await walk(D, 'spy', [[21, 37], [20.6, 38.4], [18.5, 39.6]]);
    await tailInject(D, e5, { ready: () => Math.cos(e5.heading) > 0.5 && e5.x > 13.5 && e5.x < 17.5, maxSec: 60, label: 'walking back east' });
    D.checkpoint('A6 the Spy follows e5 along the balcony and injects him: the ledge is clear');
  }],
  ['B', 'The courtyard', async (D) => {
    const pt = ['e36', 'e37', 'e38'].map((t) => D.get(t)), [e36] = pt, e1 = D.get('e1'), sp = D.c('spy');
    // down the ladder and over to the east end of the courtyard patrol's round, where it halts looking east
    await D.go('spy', ...L4_TOP, { tol: 0.5 });
    await D.go('spy', ...L4_FOOT, { tol: 0.5 });
    await D.go('spy', ...PT_STAGE, { tol: 0.4 });
    D.checkpoint('B1 the Spy waits where the courtyard patrol halts');
    // the patrol halts facing east: the Spy chats up the sergeant from that side, so all three keep their backs to the
    // west of the courtyard (the troopers face their sergeant)
    await D.until(() => e36.brain?.atWait && Math.hypot(e36.x - 43, e36.z - 40.5) < 0.8, 300, 'the patrol at its east halt');
    D.ability('spy', 'distract', e36);
    await D.until(() => pt.every((e) => e.brain?.state === 'DISTRACTED'), 5, 'the patrol listens to the Spy');
    await D.wait(1.5);
    D.checkpoint('B2 the Spy holds the courtyard patrol, its back to the west');
    if (DBG) D.log(`DBG patrol ${pt.map((e) => `${e.tag}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)}`).join(' ')} spy@${sp.x.toFixed(1)},${sp.z.toFixed(1)}`);
    // e1 walks west past the Green Beret's door: he slips out behind him and knifes him at the end of his beat
    await D.until(() => e1.x < 15.6 && Math.cos(e1.heading) < -0.7 && !eyesOn(D, e1, { x: 16.5, z: 44.2, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, 1.5), 300, 'e1 past the door going west');
    D.order('greenberet', { type: 'exit' });
    await knife(D, e1, { later: pt, reach: 6, label: 'at the west end of his beat' });
    D.checkpoint('B3 the Green Beret slips out and knifes e1');
    // then the patrol, from behind, the rear man first
    const file = [...pt].sort((a, b) => Math.hypot(b.x - e36.x, b.z - e36.z) - Math.hypot(a.x - e36.x, a.z - e36.z));
    const knifeFrom = async (v) => {
      const back = [v.x - Math.cos(v.heading) * 1.4, v.z - Math.sin(v.heading) * 1.4];
      await D.go('greenberet', ...back, { tol: 0.5 });
      await knife(D, v, { later: pt.filter((e) => e.alive && e !== v) });
    };
    await knifeFrom(file[0]);
    D.checkpoint('B4 the Green Beret knifes the patrol\'s rear man from behind');
    await knifeFrom(file[1]);
    D.checkpoint('B5 the Green Beret knifes the next man from behind');
    await knifeFrom(file[2]);
    D.checkpoint('B6 the Green Beret knifes the sergeant, still listening to the Spy');
  }],
  ['C', 'The jailbreak', async (D) => {
    // nobody is left who can see the courtyard: the Green Beret opens the cell (objective 1)
    const door = D.item('jail_door');
    D.ability('greenberet', 'use', door);
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1').done, 30, 'the Informer free');
    await D.idle('greenberet', 5);
    D.checkpoint('C1 the Green Beret opens the cell: the Informer is free');
    // both wait at the foot of the ladder by the palace while the Spy clears the roofs
    D.order('guest', { type: 'move', x: L2_WAIT.guest[0], z: L2_WAIT.guest[1] });
    await D.go('greenberet', ...L2_WAIT.greenberet, { tol: 0.5 });
    await D.go('guest', ...L2_WAIT.guest, { tol: 0.6 });
    D.checkpoint('C2 the Green Beret and the Informer wait at the foot of the ladder');
  }],
  ['D', 'The northern roofs', async (D) => {
    // the Spy goes up the ladder by the palace onto the souk roof
    await D.go('spy', ...L2_FOOT, { tol: 0.5 });
    await D.go('spy', ...L2_TOP, { tol: 0.5 });
    D.checkpoint('D1 the Spy climbs onto the souk roof');
    // the palace's raised roof overlooks the terrace and the souk: e6 walks it. When he halts at its west end, looking
    // west, and the posts on the souk look elsewhere, the Spy injects him from behind (nobody sees a body up there)
    const e6 = D.get('e6');
    await D.until(() => Math.hypot(e6.x - 41.2, e6.z - 20.6) < 1.5, 120, 'e6 at the east end of his beat');
    await walk(D, 'spy', [E6_STAGE]);
    await inject(D, e6, { ready: () => e6.brain?.atWait && Math.hypot(e6.x - 38.6, e6.z - 22.1) < 0.6, maxSec: 400, label: 'at the west end of the raised roof' });
    D.checkpoint('D2 the Spy injects e6 on the palace\'s raised roof');
    // e7 at the east end of his beat on the palace roof looks east: the Spy waits west of it
    const e7 = D.get('e7');
    await walk(D, 'spy', [E7_STAGE]);
    await inject(D, e7, { ready: () => e7.brain?.atWait && Math.hypot(e7.x - 38, e7.z - 16.5) < 0.6, maxSec: 400, label: 'at the east end of his beat' });
    D.checkpoint('D3 the Spy injects e7 on the palace roof');
    // e13 outside the Sniper's shack looks west: injected from behind; nobody left on the palace sees him fall
    await walk(D, 'spy', [[52.7, 19.6]]);
    await inject(D, 'e13', { maxSec: 400 });
    D.checkpoint('D4 the Spy injects e13 outside the Sniper\'s shack');
    // the Sniper slips out of his shack when nobody on the palace roofs looks that way, and crawls to the terrace edge
    const sn = D.c('sniper');
    await D.until(() => clearFor(D, [[50.2, 15.5], [49.7, 15.5], [50.7, 16]], 2.5, { mode: 'walk' }), 120, 'the shack door unwatched');
    D.order('sniper', { type: 'exit' });
    await D.stance('sniper', 'crawl');
    // (round the shack and along the terrace's south wall: past the walkway's gap when nobody on the souk looks in)
    await crawlPath(D, 'sniper', [[49.8, 17.8], [51.2, 18.6]]);
    await moveOpen(D, 'sniper', [[55.3, 18.7], SN_SPOT], { mode: 'crawl', hold: 6, label: 'the Sniper past the walkway' });
    D.checkpoint('D5 the Sniper crawls out of his shack to the edge of the terrace');
    // on house_e2: e18 on his post looks west; e19 walks a beat behind him and halts at its east end looking east.
    // The Spy waits between the two, behind both: while e19 stands there (and e17, who walks between house_e2 and the
    // souk, is walking north, his back to them) he injects e18 and at once e19 — neither sees the other fall
    const e17 = D.get('e17'), e18 = D.get('e18'), e19 = D.get('e19');
    await walk(D, 'spy', [[54, 24], [56.5, 38], [58.6, 46.5], [59.6, 56], [66, 58.5], DUO]);
    const e19Halt = (left) => e19.brain?.atWait && Math.hypot(e19.x - 74, e19.z - 63.5) < 0.6 && (e19.brain.waitT ?? 0) > left;
    await inject(D, e18, { ready: () => e19Halt(2.3) && Math.sin(e17.heading) < -0.7 && e17.z > 59, later: [e19], quiet: 40, maxSec: 600, idle: false, label: 'while e19 looks east' });
    D.checkpoint('D6 the Spy injects e18');
    await inject(D, e19, { ready: () => e19Halt(0), quiet: 20, maxSec: 3, reach: 4, label: 'at the east end of his beat' });
    D.checkpoint('D7 the Spy injects e19 at once');
    // e17 sees all the others: the Spy goes after him and talks to him from the south, so he turns round to the Spy —
    // his back to the souk, the two bodies on house_e2 behind the kiosk, off to his left
    await walk(D, 'spy', [[66, 58.5], [59, 58.2]]);
    D.ability('spy', 'distract', e17);
    await D.until(() => e17.brain?.state === 'DISTRACTED', 20, 'e17 listens to the Spy');
    await D.wait(1.5);
    if (DBG) D.log(`DBG e17@${e17.x.toFixed(1)},${e17.z.toFixed(1)} h${Math.round(((e17.heading * 180) / Math.PI + 360) % 360)} spy@${D.c('spy').x.toFixed(1)},${D.c('spy').z.toFixed(1)}`);
    D.checkpoint('D8 the Spy holds e17, his back to the souk');
    // the Sniper's volley: e11 on the east house, e10 on his beat, e12 by the ladder, e9 at the souk's south end,
    // then e17 — each where nobody left sees him fall
    await snipe(D, 'e11', { later: ['e10', 'e12', 'e9'] });
    D.checkpoint('D9 the Sniper shoots e11 on the east house');
    await snipe(D, 'e10', { later: ['e12', 'e9'] });
    D.checkpoint('D10 the Sniper shoots e10');
    await snipe(D, 'e12', { later: ['e9'] });
    D.checkpoint('D11 the Sniper shoots e12');
    await snipe(D, 'e9');
    D.checkpoint('D12 the Sniper shoots e9');
    await snipe(D, 'e17');
    D.checkpoint('D13 the Sniper shoots e17, still listening to the Spy: the north roofs are clear');
  }],
  ['E', 'Over the roofs to the mosque', async (D) => {
    // nobody is left on the souk or house_e2; the palace roof sees a man standing on the souk's west end: each climbs
    // the ladder when nobody there looks, then crawls on (nobody left sees a man lying on these roofs). One after the
    // other, a few metres apart: over the souk and house_e2 by the kiosk's west side, over plank P2 onto the roof of
    // the mosque's north pavilion
    const climb = async (role) => {
      await D.until(() => clearFor(D, [L2_TOP, [46.2, 28.2], [47, 27.5]], 6, { mode: 'walk' }), 300, `${role}: the head of the ladder unwatched`);
      await D.go(role, ...L2_FOOT, { tol: 0.5 });
      await D.go(role, ...L2_TOP, { tol: 0.5 });
    };
    const ahead = (role, d) => () => { const u = D.c(role); return Math.hypot(u.x - L2_TOP[0], u.z - L2_TOP[1]) > d; };
    // (one order each to the pavilion roof: the way the game plans it, over the souk and house_e2 by the kiosk's west
    // side and over the plank; all of it out of every cone now. A single loop drives the three, as a player clicks:
    // the driver's ticks are not to be shared between concurrent waits — the live replay grants them one at a time)
    const go = (role) => D.order(role, { type: 'move', x: PAV_WAIT[role][0], z: PAV_WAIT[role][1] });
    const there = (role) => Math.hypot(D.c(role).x - PAV_WAIT[role][0], D.c(role).z - PAV_WAIT[role][1]) < 0.9;
    let nudge = 0;
    const keepGoing = (roles) => { // (a man who stopped short — a mate in the way — is sent on again)
      if (D.t < nudge) return;
      for (const r of roles) { const u = D.c(r); if (!there(r) && !u.path && !u.isMoving && !u.currentAction && (u._stanceT ?? 0) <= 0) { go(r); nudge = D.t + 1; } }
    };
    await climb('greenberet');
    await D.stance('greenberet', 'crawl');
    go('greenberet');
    await D.until(ahead('greenberet', 6), 60, 'the Green Beret on his way');
    D.checkpoint('E1 the Green Beret climbs onto the souk roof and crawls east');
    await climb('guest');
    await D.stance('guest', 'crawl');
    go('guest');
    await D.until(() => { keepGoing(['greenberet']); return ahead('guest', 6)(); }, 60, 'the Informer on his way');
    D.checkpoint('E2 the Informer follows him');
    await D.until(() => { keepGoing(['greenberet', 'guest']); return ahead('guest', 14)(); }, 120, 'the Informer well ahead');
    go('sniper');
    await D.until(() => { keepGoing(['greenberet', 'guest', 'sniper']); return ['greenberet', 'guest', 'sniper'].every(there); }, 400, 'all three on the pavilion roof');
    D.checkpoint('E3 the Green Beret, the Informer and the Sniper crawl over the plank onto the pavilion roof');
  }],
  ['F', 'The mosque platform', async (D) => {
    // the Spy follows over the plank and down the pavilion's ladder onto the mosque platform (the harbour HQ's side:
    // from here on not a sound, nobody may see anything)
    await walk(D, 'spy', [[59.6, 59], [59.2, 61], [58.3, 62.9], [57.2, 63.9], [54, 66.5], [51, 68.5], [49.6, 70.4], L5_TOP]);
    await D.go('spy', ...L5_FOOT, { tol: 0.5 });
    D.checkpoint('F1 the Spy climbs down onto the mosque platform');
    // e24 walks the pavilion court: at its west end, by the ladder, he looks west; the Spy waits behind him
    await inject(D, 'e24', { stage: E24_STAGE, ready: () => { const e = D.get('e24'); return e.brain?.atWait && Math.hypot(e.x - 47, e.z - 76) < 0.6; }, label: 'at the west end of his beat' });
    D.checkpoint('F2 the Spy injects e24 below the ladder');
    // e27 and e32 turn about side by side at the east walk's north end, each in sight of the other's body: the Green
    // Beret comes down the ladder and crawls along the pavilion court's wall to its east end
    await D.go('greenberet', ...L5_TOP, { tol: 0.5 });
    await D.go('greenberet', ...L5_FOOT, { tol: 0.5 });
    await moveOpen(D, 'greenberet', [[48, 78.6], GB_C1], { mode: 'crawl', hold: 6, label: 'greenberet along the court wall' });
    D.checkpoint('F3 the Green Beret climbs down and crawls to the end of the court wall');
    // the Spy stands south of e32's east halt: when e32 stops there he talks to him, so he keeps looking south
    const e32 = D.get('e32'), e27 = D.get('e27');
    await walk(D, 'spy', [[51.6, 80.2], [54.2, 83.4]]);
    await D.until(() => Math.cos(e32.heading) < -0.3 && e32.x < 52.5, 120, 'e32 walking off west');
    await walk(D, 'spy', [[54.3, 86.6], E32_HOLD], { tol: 0.4 });
    await D.until(() => e32.brain?.atWait && Math.hypot(e32.x - 53.5, e32.z - 86) < 0.6 && (e32.brain.waitT ?? 0) > 1, 300, 'e32 at his east halt');
    D.ability('spy', 'distract', e32);
    await D.until(() => e32.brain?.state === 'DISTRACTED', 5, 'e32 listens to the Spy');
    D.checkpoint('F4 the Spy holds e32, looking south');
    // e27 halts beside him looking east: the Green Beret gets up behind him and knifes him, then e32
    await knife(D, e27, { ready: () => e27.brain?.atWait && Math.hypot(e27.x - 52, e27.z - 86) < 0.6, reach: 7, later: [e32], label: 'at the east end of his beat' });
    D.checkpoint('F5 the Green Beret knifes e27 from behind');
    await knife(D, e32, { reach: 4 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('F6 the Green Beret knifes e32, still listening to the Spy');
  }],
  ['G', 'The south rim', async (D) => {
    // e30 watches the quay from the platform's south rim, e31 walks beside him: the Spy talks to e31 at the west end
    // of his beat from the south, so he keeps looking south while the Green Beret deals with e30
    const e30 = D.get('e30'), e31 = D.get('e31');
    await D.path('spy', [[51.2, 90.5], [50.6, 93.4], [48.4, 95.4], [45, 99.6], E31_HOLD]);
    await D.until(() => e31.brain?.atWait && Math.hypot(e31.x - 42.6, e31.z - 100.4) < 0.6 && (e31.brain.waitT ?? 0) > 0.8, 300, 'e31 at his west halt');
    D.ability('spy', 'distract', e31);
    await D.until(() => e31.brain?.state === 'DISTRACTED', 5, 'e31 listens to the Spy');
    D.checkpoint('G1 the Spy holds e31 on the south rim');
    // the Green Beret crawls round the end of the rim's wall to e30's back and knifes him, then e31
    await crawlPath(D, 'greenberet', [[52.4, 88.4]]);
    await moveOpen(D, 'greenberet', [[51.2, 90.4], [50.6, 93.2], [48.8, 94.8], GB_E30], { mode: 'crawl', hold: 6, label: 'greenberet round the rim wall' });
    await knife(D, e30, { later: [e31] });
    D.checkpoint('G2 the Green Beret knifes e30 from behind');
    await knife(D, e31, { reach: 6 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('G3 the Green Beret knifes e31, still listening to the Spy');
  }],
  ['H', 'Down to the quay and away', async (D, { boardPoint }) => {
    // e26 in the hall court looks east through the gap at the south end of the east walk: the Spy goes round by the
    // rim's door and talks to him from the west, so he looks the other way for as long as the team needs
    const e26 = D.get('e26');
    await walk(D, 'spy', [[41.2, 98.8], [40.2, 95], E26_HOLD]);
    D.ability('spy', 'distract', e26);
    await D.until(() => e26.brain?.state === 'DISTRACTED', 10, 'e26 listens to the Spy');
    D.checkpoint('H1 the Spy holds e26 in the hall court, looking west');
    // nobody else can see the platform's east side: everyone gathers at the south end of the east walk, above the
    // stairs down to the alley (the quay below cannot see onto the platform)
    const held = () => (e26.brain?.state === 'DISTRACTED' ? [e26] : []); // (he faces the Spy, west, while the Spy stays by him)
    await moveOpen(D, 'greenberet', [[48, 95.6], [50.6, 93.4], PLAT_WAIT.greenberet], { label: 'greenberet up the east walk', except: held() });
    for (const role of ['sniper', 'guest']) {
      await D.go(role, ...L5_TOP, { tol: 0.5 });
      await D.go(role, ...L5_FOOT, { tol: 0.5 });
      await moveOpen(D, role, [...EAST_WALK, PLAT_WAIT[role]], { label: `${role} down the east walk`, except: held() });
    }
    D.checkpoint('H2 the Green Beret, the Sniper and the Informer gather at the south end of the east walk');
    // the car waits on the quay, the patrol's east halt just short of it: one by one, each walks down the stairs and
    // along the quay to the car and gets in when nobody will see him on the way or climbing in (the patrol walking off
    // west); the Spy, in uniform, last. Once all four are in, it drives off east
    const car = D.world.byId('kubel');
    const toCar = async (role, { onlyBoard = false } = {}) => {
      const u = D.c(role), why = [];
      // (his way to the car is the same search tick after tick while he and the car stand still: kept while its inputs —
      // the two ends and the nav grid's version — are the same; findPath is a pure function of them)
      let wayKey = null, way = null;
      // (the wait re-asks the same checks every tick and the way is clear only when all of them pass: the one that
      // failed last time is asked first, and each asks the guard who saw him last time first — routeClear `hint`; the
      // same answer, tick for tick, without a full pass over every guard while one of them still sees the way)
      const hints = [], hintOf = (i) => (hints[i] ||= { e: null });
      let lastFail = -1;
      await D.until(() => {
        why.length = 0;
        const bp = boardPoint(car, u);
        const key = `${u.x},${u.z},${bp.x},${bp.z},${D.world.grid.version}`;
        if (key !== wayKey) { wayKey = key; way = D.world.findPath(u.x, u.z, bp.x, bp.z); }
        const path = way;
        if (!path) return dbg(D, ['no path'], `${role} to the car`);
        const pts = path.slice(1).map((q) => [q.x, q.z]);
        let L = 0, p0 = [u.x, u.z];
        for (const q of pts) { L += Math.hypot(q[0] - p0[0], q[1] - p0[1]); p0 = q; }
        const checks = [];
        // (his own line may run half a metre off the planned one, round a corner or a mate: tried shifted as well)
        // (the Spy in uniform may walk where he likes: only his climbing in is judged)
        // (the order itself is the suspicious act for the Spy: nobody may see him where he gives it)
        if (onlyBoard) checks.push([`${role} sets off`, (h) => routeClear(D, [[u.x, u.z]], { mode: 'walk', from: [u.x, u.z], delay: 0, slack: 1.2, why, pad: 1.2, hint: h })]);
        if (!onlyBoard) for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
          for (const v of [1.7, 2.3]) checks.push([`${role} to the car`, (h) => routeClear(D, pts.map(([x, z], k) => (k === pts.length - 1 ? [x, z] : [x + ox, z + oz])), { mode: 'walk', from: [u.x, u.z], speed: v, delay: 0.7, slack: 1.0, why, pad: 1.2, except: held(), hint: h })]);
        }
        checks.push([`${role} at the car`, (h) => routeClear(D, [[bp.x, bp.z]], { mode: 'walk', from: [bp.x, bp.z], delay: 0.7 + L / 2.3, slack: L / 1.7 - L / 2.3 + 3, why, pad: 1.2, except: held(), hint: h })]);
        if (lastFail >= 0 && lastFail < checks.length && !checks[lastFail][1](hintOf(lastFail))) return dbg(D, why, checks[lastFail][0]);
        for (let i = 0; i < checks.length; i++) if (i !== lastFail && !checks[i][1](hintOf(i))) { lastFail = i; return dbg(D, why, checks[i][0]); }
        return true;
      }, 600, `${role}: the way to the car unwatched`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
      await D.stance(role, 'stand');
      D.ability(role, 'enterVehicle', car);
      await D.until(() => u.vehicle === car, 40, `${role} aboard`);
    };
    await toCar('guest');
    D.checkpoint('H3 the Informer walks down to the car and gets in');
    await toCar('sniper');
    D.checkpoint('H4 the Sniper walks down to the car and gets in');
    await toCar('greenberet');
    D.checkpoint('H5 the Green Beret walks down to the car and gets in');
    await walk(D, 'spy', [[40.2, 95], [41.2, 98.8], [48.4, 95.4], [50.6, 93.4], [51.5, 95], [54.6, 99.2]]);
    await toCar('spy', { onlyBoard: true });
    D.checkpoint('H6 the Spy, in uniform, gets in last');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2').done, 60, 'the car drives off');
    D.checkpoint('H7 the car drives off east with everyone: mission complete');
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
