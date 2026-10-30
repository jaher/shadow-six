/**
 * M20 "Operation Valhalla" (Gundelfingen castle): a full stealth solution up to the one forced alarm, played only with
 * player orders (the driver, tools/solutions/driver.mjs; the space-time sneak planner, tools/solutions/sneak.mjs).
 * Reference run, in the real game: node tools/solutions/run-browser.mjs m20 (also tests/m20-solution.test.mjs).
 * Walkthrough: m20.walkthrough.mjs.
 *
 * Outline (the W pair start behind a rock under the W wall, the other four among rocks in the NE fields):
 *   A  the Green Beret climbs the W wall (the castle's one climb) behind e1 and knifes him at the strip's W end
 *   B  along the HQ terrace's S strip behind the forecourt screen: e2 by the searchlight, e38 behind the second screen
 *   C  e37 at his halt beside the turret, his body into the turret's blind corner (e3 on the turret sweeps 240°)
 *   D  down to the NW terrace: e33, e34 (they look S over the W quarter; bodies on a terrace are out of sight below)
 *   E  the decoy on the gatehouse roof lures e29 (only he can hear it) up the stairs to the knife; e32 at their foot
 *   F  round the barracks into the hut's lee in the S court: e65, e27, e24 and e22 by way of the barracks' S face (out of
 *      e22's sight), each body back into the lee or into the pocket by the gatehouse
 *   G  the Sniper crawls round the castle outside (e11 now leaves a lane down the narrow E field) and shoots e7 on the
 *      SW wall from the meadow; the Green Beret knifes the gate's rear pair in its arch
 *   H  the Sapper and the Driver come round the same way; the Marine and the Spy settle in the meadow's SW corner
 *   I  Sapper, Driver and Sniper over the bridge behind the front pair's backs and in through the arch
 *   J  the Sniper onto the W bastion terrace; the Green Beret knifes e67 on the N range roof, the Sniper shoots e66
 *   K  the Sapper's remote charge in the turret's blind corner, against the headquarters
 *   L  everyone into the yard under the W bastion; Patrol 57 parked staring at the decoy in the flak court
 *   M  the Sniper shoots the AT gunner e55; four men into the Panzer III by their hatches, unseen; the charge (the one
 *      alarm: no charge goes off unheard), the tank's gun on both V2s and on the gate's front pair, out by the SW gate,
 *      the Spy and the Marine picked up in the meadow, off the map.
 * Orders only (move / crawl / stance / ability: knife, decoy, carry, rifle, charge, detonator, enter / drive / fire);
 * every wait reads what a player sees: the cones, the beats, the bodies' sight lines.
 */
import { canSee, coneAt, pointInCone } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { contactPlan, CONTACT } from '../../src/abilities/knife-contact.js';
import { dropSpot } from '../../src/abilities/common.js';
import { settleBody, fallHeading, settleSolid, settleHands } from '../../src/world/placement.js';
import { BODY, bodyGap, clearPose, hasObstacles, deadStance, STOP_MARGIN } from '../../src/world/body-clearance.js';
import { ABILITIES } from '../../src/abilities/registry.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { arcStep } from '../../src/entities/vehicle-maneuver.js';
import { sneak, planSneak, clearFor, routeClear, routeClearGen, unwitnessed, bodySeen, predict, walking, viewersOf, walkerViews, walkerSees, seesAny, inflateCone, dummyAt, glanceCone } from './sneak.mjs';
import { mirrorOf, ghostOn, ghost } from './ghost.mjs';

const DBG = !!(globalThis.process?.env?.M20DBG || globalThis.__M3DBG);
let dbgN = 0;
/** (debug) log why a wait goes on, now and then; always false */
function dbg(D, why, label) { if (DBG && dbgN++ % (+(globalThis.process?.env?.M20DBGN) || 120) === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/** A man as the guards would see him standing (a suspicious act is judged that way, §3.4). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const tagOf = (e) => (typeof e === 'string' ? e : e.tag);

/** run `fn` with the planners' cautious walker model (a walker turning onto a new leg sweeps his eyes across) */
async function cautious(D, fn) {
  const w = D.world, prev = [w.sneakTurns, w.sneakHeel, w.sneakTurnTie];
  w.sneakTurns = true; w.sneakHeel = true; w.sneakTurnTie = 0.02;
  try { return await fn(); } finally { [w.sneakTurns, w.sneakHeel, w.sneakTurnTie] = prev; }
}

/** run `fn` with halted walkers' heads where their sweep puts them (± `slack` s), not the whole sweep at once */
async function haltExact(D, slack, fn) {
  const w = D.world, prev = w.sneakHaltExact;
  w.sneakHaltExact = slack;
  try { return await fn(); } finally { w.sneakHaltExact = prev; }
}
/** haltExact for a timing check (sync) */
function exactly(D, slack, fn) {
  const w = D.world, prev = w.sneakHaltExact;
  w.sneakHaltExact = slack;
  try { return fn(); } finally { w.sneakHaltExact = prev; }
}

/**
 * `role` crawls the way round the castle's S side (S_FIELD). Down the narrow E field the wall's men are near-band-wide:
 * planned with tight pads and halted heads where their sweep puts them; out in the S field with wide pads round Patrol
 * 26 (a file of four: its troopers keep only roughly to their leader's prediction).
 */
async function fieldCrawl(D, role, way = S_FIELD) {
  for (const [x, z] of way) {
    if (x > 150) await haltExact(D, 0.3, () => crawl(D, role, x, z, { box: 6, hold: 3, edgePad: 0.3, crawlPad: 0.4, margin: [1, 2], label: `${role} → (${x},${z})` }));
    // (and never within 19 m of Patrol 26's men — their near band and a step: the file keeps only roughly to its
    // leader's step, and three of them grazed a crawler at 17 m)
    else await crawl(D, role, x, z, { box: 6, hold: 3, crawlPad: 5, keepFrom: { p26: 19, p26b: 19, p26c: 19, p26d: 19 }, label: `${role} → (${x},${z})` });
  }
}

/** crawl to (x, z) on a space-time plan (waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  return await cautious(D, () => sneak(D, x, z, { mode: 'crawl', role, box: 8, speed: 0.86, run: 2, dt: 0.1, margin: [3, 4], label: `${role} → (${x},${z})`, ...o }));
}

/**
 * Crawl `role` to (x, z) arriving at a moment `okAt(d)` allows (d: s from now, tried every half second, the cheap tests
 * first in okAt): he lies where he is — somewhere nobody looks — until such a moment is far enough off for the crawl
 * (`lead` s) and near enough to plan for (`H` s), then crawls so as to get there then. (The planner's goal test is the
 * moments found, not okAt itself: those are costly, and it asks them of every arrival it weighs.)
 */
async function crawlForMoment(D, role, x, z, okAt, { lead = 12, H = 70, maxWait = 900, label = '', exact = null, ...o } = {}) {
  const t0 = D.t, u = D.c(role), home = [u.x, u.z]; // (where he lies now, where nobody looks: he waits there)
  for (;;) {
    const g = [];
    for (let d = lead; d <= H + 1e-9; d += 0.5) if (okAt(d)) g.push(d);
    if (g.length) {
      const set = new Set(g.map((d) => Math.round((D.t + d) * 2)));
      // (clicked as planned, not as straight dashes: the moment is the plan's own arrival — a dash that comes sooner and
      // waits, or ends a stride off the plan's cell, misses a window of a second or two)
      const po = { ...o, goalOk: (gx, gz, t) => set.has(Math.round(t * 2)), horizon: H + 15, dt: 0.2, noWait: true, label, straight: false };
      // (`exact` s: the crawl's plan takes halted walkers' heads where their sweep puts them, ± that — haltExact)
      const ok = exact != null ? await haltExact(D, exact, () => crawl(D, role, x, z, po)) : await crawl(D, role, x, z, po);
      if (DBG && ok === false) { const why = [], pl = () => cautious(D, async () => planSneak(D, x, z, { mode: 'crawl', role, box: 8, speed: 0.86, run: 2, margin: [3, 4], ...po, why })); await (exact != null ? haltExact(D, exact, pl) : pl()); D.log(`DBG ${D.t.toFixed(1)} ${label}: no crawl to ${g.length} moments [${why.join(' ')}]`); }
      if (ok !== false && Math.hypot(u.x - x, u.z - z) < 0.8) return;
      // (the crawl fell behind its moment on the way: back to where he lay, not lying on in the open)
      if (Math.hypot(u.x - home[0], u.z - home[1]) > 1) await crawl(D, role, ...home, { box: 5, hold: 3, crawlPad: 5, label: `${label} (back)` });
    }
    if (D.t - t0 > maxWait) throw new Error(`${label}: no moment within ${maxWait} s`);
    if (DBG) { const n = new Map(); for (let d = lead; d <= H; d += 0.5) { const why = []; if (!okAt(d, why)) { const k = (why[0] || '?').replace(/\+.*/, ''); n.set(k, (n.get(k) || 0) + 1); } } dbg(D, [...n].map(([k, v]) => `${k}×${v}`), `${label}: no moment`); }
    await D.wait(2);
  }
}

/**
 * crawlForMoment, then the moment itself: `okAt(0)` must hold within `grace` s of his arrival, or he crawls back to
 * `back` (where nobody looks) and tries again — the game's walkers keep to their forecast only roughly.
 */
async function atMoment(D, role, at, okAt, back, { tries = 6, grace = 4, label = '', ...o } = {}) {
  // (he lies at `at` up to `grace` s for the moment: the crawl's `hold` keeps him unseen there that long)
  for (let k = 0; ; k++) {
    await crawlForMoment(D, role, ...at, (d, why) => okAt(d + 0.5, why), { ...o, label });
    try { await untilA(D, async () => { const why = []; return okAt(0, why) || dbg(D, why, `${label}: the moment`); }, grace, `${label}: the moment`); return; } catch (err) { if (!/timeout/.test(err.message) || k + 1 >= tries) throw err; }
    D.log(`  ${label}: the moment passed at t=${D.t.toFixed(1)}; back to (${back[0]},${back[1]})`);
    await crawl(D, role, ...back, { box: 5, hold: 3, crawlPad: 5, label: `${label} (back)` });
  }
}

/**
 * The turret guard's head swings 240° every 11 s and his elliptical bands shrink as it swings out: the edge of his cone
 * crosses a spot in a tick or two. Timing checks try every cone widened by this ([deg, m]).
 */
const CONE_MARGIN = [4, 0.4];

/**
 * routeClear with widened cones (CONE_MARGIN): would a man ('crawl' / 'walk'; 'body' for a body lying there) going
 * along `pts` from `from` at `speed`, setting off in `delay` s and holding `hold` s at the end, stay unseen? Samples
 * every `step` s, each tried `slack` s early and late. `except`: guards left out.
 */
function* quietRouteG(D, pts, { mode = 'walk', from, speed = 1.0, delay = 0, hold = 0, step = 0.25, slack = 0.3, except = [], why = null, margin = CONE_MARGIN } = {}) {
  const w = D.world;
  let [x, z] = from, t = delay;
  const samples = [[x, z, t]];
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / (speed * step)));
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / speed]);
    t += L / speed; x = px; z = pz;
  }
  for (let h = step; h <= hold + 1e-6; h += step) samples.push([x, z, t + h]);
  for (const e of viewersOf(w)) {
    if (except.includes(e)) continue;
    // (`margin` may be per guard: [deg, m] for each, as a slow sweep's turning point needs less than a fast one)
    const mg = typeof margin === 'function' ? margin(e) : margin;
    const moving = walking(e), reach = (e.vision?.far ?? 36) + 2 + (moving ? 1.2 * (t + hold + slack) : 0);
    let n = 0;
    for (const [sx, sz, st] of samples) {
      if (Math.hypot(e.x - sx, e.z - sz) > reach) continue;
      const d = dummyAt(w, mode, sx, sz);
      for (let o = -slack; o <= slack + 1e-6; o += 0.1) {
        if (++n % (moving ? 6 : 24) === 0) yield; // (a few looks at a time — a walker's are many heads: the live replay hands the frame back between them)
        const tt = Math.max(0, st + o);
        let seen;
        if (moving) seen = seesAny(walkerViews(e, predict(e, tt), w, w.time + tt), d, w, mg);
        else {
          const cone = inflateCone(coneAt(e, w.time + tt), mg); seen = pointInCone(cone, d.x, d.z) && canSee(e, d, w, { cone }) !== 'none';
          if (!seen) { const gc = inflateCone(glanceCone(e, tt), mg); seen = !!gc && pointInCone(gc, d.x, d.z) && canSee(e, d, w, { cone: gc }) !== 'none'; }
        }
        if (seen) { if (why) why.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`); return false; }
      }
    }
  }
  return true;
}

/** quietRouteG run straight through (the same answer) */
function quietRoute(D, pts, o) { return runGen(quietRouteG(D, pts, o)); }
/** quietRouteG run sliced (driver runSliced: in the live replay the frame is handed back every few ms) */
function qrA(D, pts, o) { return D.runSliced(quietRouteG(D, pts, o)); }
/** run a generator straight through */
function runGen(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }

/**
 * The way the game will take `role` on his feet from `a` to `b` — his own move order's plan (Unit.planFrom: round what the
 * game draws, which headless it does not) — as [[x, z], …] after `a`; the straight line when there is none. What a
 * route check walks, so that it is the route he walks (in the game the S court's huts are drawn wider than headless).
 */
function wayOf(D, role, a, b) {
  const u = D.c(role), st = u.stance;
  u.stance = 'stand';
  let p;
  try { p = u.planFrom(a[0], a[1], b[0], b[1]); } finally { u.stance = st; }
  return p && p.length ? p.slice(1).map((q) => [q.x, q.z]) : [b];
}

/** wayOf for each leg of a clicked polyline from `a` (one click a point, as D.path clicks them): the way walked. */
function waysOf(D, role, a, pts) {
  const out = [];
  let p = a;
  for (const q of pts) { out.push(...wayOf(D, role, p, q)); p = q; }
  return out;
}

/** Length of the way [[x, z], …] from `from` (m). */
function pathLen(from, way) {
  let L = 0, [x, z] = from;
  for (const [px, pz] of way) { L += Math.hypot(px - x, pz - z); x = px; z = pz; }
  return L;
}

/**
 * A way [[x, z], …] from `from` towards `v` cut where it first comes within `r1` m of v (as the crow flies: where a
 * crawler stands up for the knife) and again within `r2` m (the knife's own step): [the way to the first cut, the way
 * from there to the second, the first part's length]. With r1 = Infinity the first part is empty.
 */
function splitWay(from, way, v, r1, r2) {
  const pts = [from, ...way], first = [], second = [];
  let L = 0, phase = Math.hypot(v.x - from[0], v.z - from[1]) <= r1 ? 1 : 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], seg = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(seg / 0.1));
    for (let k = 1; k <= n; k++) {
      const qx = ax + ((bx - ax) * k) / n, qz = az + ((bz - az) * k) / n, d = Math.hypot(v.x - qx, v.z - qz);
      if (phase === 0) {
        L += seg / n;
        if (d <= r1) { first.push([qx, qz]); phase = 1; } else if (k === n) first.push([bx, bz]);
      } else {
        if (d <= r2) { second.push([qx, qz]); return [first, second, L]; }
        if (k === n) second.push([bx, bz]);
      }
    }
  }
  return [first, second.length ? second : [[v.x, v.z]], L];
}

/**
 * sneak.bodySeen as a generator (the same answer: who would find a body at (x, z) within `dur` s — partner glances
 * too), handing back control between the guards and every few dozen samples.
 */
function* bodySeenG(D, x, z, dur = 120, { step = 0.5, except = [] } = {}) {
  const w = D.world, out = new Set(), d = dummyAt(w, 'body', x, z);
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + 1;
    // (a post's sweep crosses a spot at the edge of his band in a tenth of a second — e3's over the strip's E end: 0.12 s
    // a sweep — so a post is tried every 0.04 s, his cone's geometry first: canSee only inside it)
    const st = moving ? step : Math.min(step, 0.04);
    let n = 0, nextGlance = 0;
    for (let t = 0; t <= dur; t += st) {
      if (++n % (moving ? 40 : 600) === 0) yield;
      if (moving) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) > far) continue; if (walkerSees(e, q, d, w, w.time + t)) { out.add(e.tag); break; } }
      else {
        if (Math.hypot(e.x - x, e.z - z) > far) break;
        const cone = coneAt(e, w.time + t);
        if (pointInCone(cone, x, z) && canSee(e, d, w, { cone }) !== 'none') { out.add(e.tag); break; }
        if (t + 1e-9 < nextGlance) continue;
        nextGlance = t + step;
        const gc = glanceCone(e, t);
        if (gc && pointInCone(gc, x, z) && canSee(e, d, w, { cone: gc }) !== 'none') { out.add(e.tag); break; }
      }
    }
    yield;
  }
  return [...out];
}
/** bodySeenG run sliced */
function bsA(D, x, z, dur, o) { return D.runSliced(bodySeenG(D, x, z, dur, o)); }

/**
 * D.until for a condition that runs sliced checks (an async function awaiting qrA / bsA): tried ten times a second,
 * like every wait (solve), and while it runs no tick waits long behind it in the live replay.
 */
function untilA(D, pred, maxSec, label) {
  let next = -Infinity;
  return D.untilAsync(async () => { if (D.t + 1e-9 < next) return false; next = D.t + 0.1; return pred(); }, maxSec, label);
}

/** Does `e` (now, and over the next `ahead` s as predicted) have `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world, me = mirrorOf(e); // (his ghosts read him through a mirror: ghost.mjs)
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = ghostOn(me); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
  }
  return false;
}

/**
 * A margin on top of unwitnessed: would anyone (but `skip`) see the standing man at `man` over the next `ahead` s if a
 * walker's head were turned up to `turn` rad either way from where it is predicted to look?
 */
function glanced(D, man, skip = [], ahead = 1.5, turn = 0.7) {
  const w = D.world;
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || skip.includes(e) || e.incapacitated) continue;
    if (Math.hypot(e.x - man.x, e.z - man.z) < (e.vision.far ?? 36) + 3 && canSee(e, man, w) !== 'none') return e.tag;
    if (!(e.route?.length > 1) || !walking(e)) continue;
    if (Math.hypot(e.x - man.x, e.z - man.z) > (e.vision.far ?? 36) + 3) continue;
    const me = mirrorOf(e); // (his ghosts read him through a mirror: ghost.mjs)
    for (let t = 0; t <= ahead + 1e-6; t += 0.5) {
      const q = predict(e, t);
      for (const dd of [0, 0.5, -0.5]) for (let o = -turn; o <= turn + 1e-6; o += turn / 4) {
        const g = ghostOn(me); g.x = q.x + Math.cos(q.heading) * dd; g.z = q.z + Math.sin(q.heading) * dd; g.heading = q.heading + o; g.sweepActive = false; g.headOffset = 0;
        if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return e.tag;
      }
    }
  }
  return null;
}

/**
 * Where the game lays `victim` if `killer` knifed him now: the contact kill (abilities/knife-contact) pitches him forward
 * onto his face (from behind) or he staggers back (from the front), then Unit.die's placement rule (e) turns and slides
 * the corpse clear of walls, standing visuals and solids — in the game the library's solids too, none headless.
 */
export function corpseSpot(w, killer, victim, trace = null) {
  const k = ghost(killer); k.stance = 'stand'; // (he strikes on his feet)
  const plan = contactPlan(w, k, victim), g = w.grid;
  let x = victim.x, z = victim.z, h = victim.heading || 0, fall = -1, st = victim.stance || 'stand';
  if (plan) {
    h = plan.vh;
    if (plan.side === 'behind') { x += Math.cos(plan.fall) * CONTACT.fall; z += Math.sin(plan.fall) * CONTACT.fall; h = plan.fall; fall = 1; st = 'crawl'; }
    else if (plan.back) { x -= Math.cos(plan.vh) * plan.back; z -= Math.sin(plan.vh) * plan.back; }
  }
  if (!g) return [x, z];
  trace?.push(`plan ${plan ? plan.side + ' fall ' + plan.fall + ' back ' + plan.back : 'none'} at (${x.toFixed(2)},${z.toFixed(2)}) h ${(h * 57.3).toFixed(0)}`);
  h = fallHeading(g, x, z, h, 1.6, fall);
  trace?.push(`fallHeading ${(h * 57.3).toFixed(0)}`);
  const to = settleBody(g, x, z); if (to) { x = to.x; z = to.z; }
  const off = settleSolid(g, x, z, h, { likely: fall }); if (off) { x = off.x; z = off.z; }
  const ds = deadStance(st);
  trace?.push(`settled (${x.toFixed(2)},${z.toFixed(2)}) ${ds} gap ${hasObstacles(w) ? bodyGap(w, x, z, h, ds, victim).toFixed(2) : '-'}`);
  if (fall < 0 && ds === 'dead') { const A = BODY.dead.arms, hd = settleHands(g, x, z, h, { at: A.at, half: A.half, r: A.r }); if (hd) { x = hd.x; z = hd.z; } }
  if (hasObstacles(w) && bodyGap(w, x, z, h, ds, victim) < STOP_MARGIN) { const cp = clearPose(w, x, z, h, ds, { sweep: false, maxDist: 1.5, ignore: victim }); if (cp) { x = cp.x; z = cp.z; } }
  return [x, z];
}

/**
 * The Green Beret knifes `victim` from a crawl (he crawls in, stands up only within a metre of reach and strikes:
 * knife.js autoStand), once `ready()` holds, the victim does not see him coming, nobody else would see him standing
 * there or the body falling, and nobody but `later` (men who die next) finds the body for `quiet` s.
 */
async function knife(D, victim, { ready = () => true, later = [], quiet = 90, maxSec = 300, reach = 3.2, ahead = 2.2, label = '', after = 'crawl', walkUp = true, margin = CONE_MARGIN } = {}) {
  const gb = D.c('greenberet'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await untilA(D, async () => {
    why.length = 0;
    if (!victim.alive) throw new Error(`knife ${victim.tag}: already dead`);
    if (!(await ready())) return dbg(D, ['not ready'], `knife ${victim.tag}`);
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > reach) return dbg(D, ['far'], `knife ${victim.tag}`);
    const me = bare(gb), mid = { ...me, x: (gb.x + victim.x) / 2, z: (gb.z + victim.z) / 2 };
    if (eyesOn(D, victim, me, ahead) || eyesOn(D, victim, mid, ahead)) return dbg(D, ['victim looks'], `knife ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why }) || !unwitnessed(D, victim, mid, { ahead, strict: true, why })) return dbg(D, why, `knife ${victim.tag}`);
    const g = glanced(D, me, [victim], ahead) || glanced(D, mid, [victim], ahead);
    if (g) return dbg(D, [`${g} could glance`], `knife ${victim.tag}`);
    // (from further off he goes up to him as he is — on his feet, or crawling until he stands a metre off: the whole way
    // unseen, not just its two ends; in the game e19, 36 m off across the S court, caught the first steps of the walk
    // up to e65 at the very edge of his band)
    // (crawling, he stands up — 0.6 s — when he is the knife's reach and CONFIG.abilities.crawlStandLead off, ~2.2 m, and
    // walks the rest)
    const dv = Math.hypot(victim.x - gb.x, victim.z - gb.z), A = CONFIG.abilities, standAt = A.knife.reach + A.crawlStandLead + 0.3;
    if (dv > 1.6) {
      // (along the way the game walks him up — round what it draws: wayOf — the crawl to where he stands up, then the walk)
      const low = gb.stance !== 'stand';
      const [crawlWay, walkWay, crawlL] = splitWay([gb.x, gb.z], wayOf(D, 'greenberet', [gb.x, gb.z], [victim.x, victim.z]), victim, low ? standAt : Infinity, 1.0);
      const up = crawlWay.length ? crawlWay[crawlWay.length - 1] : [gb.x, gb.z], crawlT = low ? crawlL / 0.8 : 0;
      if (walkUp && low && crawlWay.length && !(await qrA(D, crawlWay, { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 0.6, except: [victim, ...later], why, margin }))) return dbg(D, why, `knife ${victim.tag} (the crawl up to him)`);
      if (walkUp && !(await qrA(D, walkWay, { mode: 'walk', from: up, delay: crawlT, speed: 1.2, hold: 1.2 + (low ? 0.6 : 0), except: [victim, ...later], why, margin }))) return dbg(D, why, `knife ${victim.tag} (the walk up to him)`);
    }
    // (the body lies up to a metre off where he stood, away from the blow: those spots too; fine steps — the turret
    // guard's head sweeps past a spot in a tenth of a second)
    const hx = gb.x - victim.x, hz = gb.z - victim.z, hl = Math.hypot(hx, hz) || 1;
    // (and where the game will lay him: the contact kill pitches him forward, or he staggers back, by what the ground
    // round him allows — the library's solids in the game, none headless — abilities/knife-contact)
    const lie = corpseSpot(D.world, gb, victim);
    for (const [bx, bz] of [[victim.x, victim.z], [victim.x - (hx / hl) * 0.9, victim.z - (hz / hl) * 0.9], lie]) {
      const finders = await bsA(D, bx, bz, quiet, { except: [victim, ...later], step: quiet <= 10 ? 0.05 : 0.25 });
      if (finders.length) return dbg(D, [`body at (${bx.toFixed(1)},${bz.toFixed(1)}) seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    }
    return true;
  }, maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  D.order('greenberet', { type: 'ability', id: 'knife', target: victim, run: false });
  await D.until(() => !victim.alive, 8, `${victim.tag} knifed`);
  await D.idle('greenberet', 5);
  if (after) await D.stance('greenberet', after);
}

/** The Green Beret (on his feet) walks up behind `victim` until he is within `reach` m (a walker: he keeps behind him). */
async function stalk(D, victim, { behind = 1.5, reach = 2.4, maxSec = 30, role = 'greenberet' } = {}) {
  const u = D.c(role);
  if (typeof victim === 'string') victim = D.get(victim);
  let last = -1;
  await D.until(() => {
    const d = Math.hypot(u.x - victim.x, u.z - victim.z);
    if (d < reach) { if (u.path) D.order(role, { type: 'stop' }); return true; }
    if (D.t - last > 0.4) {
      last = D.t;
      const h = victim.heading, tx = victim.x - Math.cos(h) * behind, tz = victim.z - Math.sin(h) * behind;
      D.order(role, { type: 'move', x: tx, z: tz });
    }
    return false;
  }, maxSec, `${role} stalks ${victim.tag}`);
}

/** `role` picks up body `e` (hand), carries it along `via` to (x, z) and lets go. */
async function carryTo(D, role, e, [x, z], via = [], { tol = 0.5, viaTol = 0.7 } = {}) {
  const u = D.c(role);
  await D.idle(role);
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 20, `grab ${e.tag}`);
  for (const [px, pz] of via) { try { await D.go(role, px, pz, { tol: viaTol, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - px, u.z - pz) > 2.5) throw err; } }
  try { await D.go(role, x, z, { tol, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  const ds = dropSpot(u, 'gentle', e, u.carryMode);
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `let go of ${e.tag}`);
  await D.idle(role);
  D.log(`  ${e.tag} laid at (${e.x.toFixed(2)},${e.z.toFixed(2)}) (put down from (${u.x.toFixed(2)},${u.z.toFixed(2)}) h${(u.heading * 57.3).toFixed(0)}, foreseen (${ds?.x?.toFixed(2)},${ds?.z?.toFixed(2)}))`);
}

/**
 * `role`, at the head of the W quarter's stairs (on the gatehouse roof): down them once nobody looks, past the
 * gatehouse's foot, through its tunnel and out into the N court along the W bastion terrace's foot (x ≈ 71.6).
 */
async function downAndThrough(D, role, spot = YARD_WAIT[0]) {
  const u = D.c(role);
  await untilA(D, async () => { const why = []; return await qrA(D, [S_GW_UP[1], S_GW_FOOT], { mode: 'crawl', from: [u.x, u.z], speed: 0.8, hold: 2, why, margin: [3, 0.2] }) || dbg(D, why, `${role} down the stairs`); }, 300, 'the stairs unwatched');
  D.order(role, { type: 'move', x: S_GW_FOOT[0], z: S_GW_FOOT[1] });
  await D.until(() => !u.path && !u.isMoving && (u.y || 0) < 0.5, 40, `${role} down the stairs`);
  await D.path(role, [spot], { tol: 0.5, max: 30 });
}

/** the way from the yard past the gatehouse's foot and through its tunnel into the N court's W strip (Patrol 57 walks it) */
const TUNNEL = [[60.4, 77.6], [66, 76], [72.6, 72.8], [72.4, 66], [71.8, 58]];

/**
 * `role`, in the N court's W strip below the W bastion terrace: N along the terrace's foot and round its corner — e55's
 * sweep reaches that corner for a moment every five seconds: it is crossed between two of them — then W along the
 * terrace's N foot (e55's sweep stops short of it) and N into the court's NW corner under the N range.
 */
async function toNWCorner(D, role, spot) {
  const u = D.c(role), P57 = ['p57', 'p57b', 'p57c'];
  const strip = [[69.3, 50], [69.3, 48]], corner = [[68.6, 43.2], [67.4, 41.8]], foot = [[62, 40.6], spot];
  // (all the way once Patrol 57 is well off round the court: it walks this strip; e55's sweep is timed at the corner)
  await untilA(D, async () => { const why = []; return await qrA(D, strip, { mode: 'crawl', from: [u.x, u.z], speed: 0.86, hold: 3, why, margin: [3, 0.3] }) || dbg(D, why, `${role} up the strip`); }, 60, 'the strip unwatched');
  await D.path(role, strip, { tol: 0.4, max: 40 });
  await untilA(D, async () => { const why = []; return await qrA(D, corner, { mode: 'crawl', from: [u.x, u.z], speed: 0.86, hold: 2, slack: 0.2, why, margin: [2, 0.2] }) || dbg(D, why, `${role} round the corner`); }, 30, 'e55\'s sweep off the corner');
  await D.path(role, corner, { tol: 0.4, max: 20 });
  await D.path(role, foot, { tol: 0.4, max: 40 });
}

/** the Panzer III */
const tankOf = (D) => D.world.vehicles.find((v) => v.spawn?.id === 'pz3' || v.tag === 'pz3');
const V2_IDS = ['v2a', 'v2b'];
/** the Driver drives `tank` along `pts` (a player's clicks), each a few metres short or stuck for 3 s: the next */
/**
 * The tank's gun (its machine gun close in) on every live guard within `r` m of it, nearest first, each until he falls
 * or for a few seconds (out of its line of fire: the next).
 */
async function clearAround(D, tank, r = 14) {
  const tried = new Set();
  for (;;) {
    const e = D.world.enemies.filter((q) => q.alive && !q.removed && !tried.has(q) && Math.hypot(q.x - tank.x, q.z - tank.z) < r)
      .sort((a, b) => Math.hypot(a.x - tank.x, a.z - tank.z) - Math.hypot(b.x - tank.x, b.z - tank.z))[0];
    if (!e) return;
    tried.add(e);
    try { await D.until(() => { if (!e.alive) return true; try { D.ability('driver', 'vehicleFire', e); } catch { /* reloading */ } return false; }, 6, `${e.tag} shot from the tank`); } catch (err) { if (!/timeout/i.test(err.message)) throw err; }
  }
}

/** seconds between the men of a file (pathFile): a crawler's 2–3 m */
const FILE_GAP = 3.5;
/**
 * Several men along their ways at once, each `gap` s after the one before (a file): each man's next point clicked as he
 * reaches the one before (D.go's rule: within `tol`, or stopped — and then no more than `tol` + 0.5 short), in one wait.
 */
async function pathFile(D, file, { gap = FILE_GAP, tol = 0.45, max = 120 } = {}) {
  const t0 = D.t, st = file.map(([role, way]) => ({ role, way, u: D.c(role), i: -1, tGo: 0 }));
  const click = (m) => { const [x, z] = m.way[m.i]; D.order(m.role, { type: 'move', x, z }); m.tGo = D.t; };
  await D.until(() => {
    let done = true;
    for (const [n, m] of st.entries()) {
      if (m.i >= m.way.length) continue;
      done = false;
      if (m.i < 0) { if (D.t + 1e-9 >= t0 + n * gap) { m.i = 0; click(m); } continue; }
      const [x, z] = m.way[m.i], d = Math.hypot(m.u.x - x, m.u.z - z);
      if (d >= tol && (m.u.path || m.u.isMoving || D.t <= m.tGo + 0.5)) continue;
      if (d > tol + 0.5) throw new Error(`${m.role} stopped at (${m.u.x.toFixed(2)},${m.u.z.toFixed(2)}), ${d.toFixed(2)} m short of (${x},${z})`);
      if (++m.i < m.way.length) click(m);
    }
    return done;
  }, max, `${file.map(([r]) => r).join(', ')} in file`);
}

/** The Driver's clicks, one after the other: each the moment the tank is within 2.2 m — or, `stop`, once it stands. */
async function drive(D, tank, pts, { stop = false } = {}) {
  for (const [x, z] of pts) {
    try { D.order('driver', { type: 'move', x, z }); } catch (err) { throw new Error(`${err.message} (the tank at (${tank.x.toFixed(2)},${tank.z.toFixed(2)}) h${Math.round((tank.heading * 180) / Math.PI)})`); }
    let still = 0;
    await D.until(() => { if ((tank.speed || 0) < 0.05 && !tank.goal) still += 0.1; else still = 0; return stop ? still > 0.5 : Math.hypot(tank.x - x, tank.z - z) < 2.2 || still > 3; }, 60, `tank to (${x},${z})`);
    if (DBG) D.log(`DBG tank for (${x},${z}) at (${tank.x.toFixed(2)},${tank.z.toFixed(2)}) h${Math.round((tank.heading * 180) / Math.PI)} t=${D.t.toFixed(1)}`);
  }
}

/**
 * `role` from the yard through the gatehouse's tunnel, up the N court's W strip and across to the tank, and in. The
 * hatches alternate, S side then N side, by seat: on his belly round the tank's W end to beside his own; a man climbing
 * in is seen as if on his feet at that moment, under two seconds after the order: in once nobody will look there then
 * (on the N side the hull hides him from the whole court).
 */
async function boardTank(D, role, name) {
  const tank = tankOf(D), u = D.c(role);
  const door = boardPoint(tank, u), north = door.z < tank.z;
  // (beside the hull's W end, clear of it lying down: the last metre or two to the hatch is the boarding's own)
  const near = [Math.min(door.x - 1.4, 81.3), door.z + (north ? -0.15 : 0.5)];
  for (const [x, z] of [...TUNNEL, ...TO_TANK, ...(north ? [[78.5, 37], near] : [near])]) await crawl(D, role, x, z, { box: 4, hold: 3, crawlPad: 3, dt: 0.2, margin: [2, 2], horizon: 90, label: `${role} → (${x},${z})` });
  // (he climbs in a moment after the order — the crawl to the hull, the climb's half second — counted as on his feet
  // as he does, AT THE HATCH: e43's sweep on the NE terrace takes in the hull's S side for a fifth of a second at a time,
  // and a spot a stride short of it, more in the hull's lee from up there, once let a boarding through)
  const lag = 0.4 + 0.95 * Math.hypot(door.x - u.x, door.z - u.z);
  const boardOk = async (why) => { for (const p of [[door.x, door.z], [(u.x + 2 * door.x) / 3, (u.z + 2 * door.z) / 3]]) if (!await qrA(D, [], { mode: 'walk', from: p, delay: Math.max(0, lag - 0.8), hold: 2.0, slack: 0.4, why, margin: [4, 0.4] })) return false; return true; };
  await untilA(D, async () => { const why = []; return await boardOk(why) || dbg(D, why, `${role} boards`); }, 200, `nobody to see ${name} climb into the tank`);
  D.ability(role, 'enterVehicle', tank);
  await D.until(() => u.vehicle === tank, 40, `${role} in the tank`);
}

/** Patrol 26's four (they walk a long loop through both gates and the S meadow, in file) */
const P26 = ['p26', 'p26b', 'p26c', 'p26d'];
/**
 * Is walker `tag` (dead, or) from t0 to t1 s from now either beyond x `xFar`, walking E, or halted facing E and not
 * about to turn — his back to the castle's S court (a walker looks straight ahead as he walks; halted, his sweep never
 * comes round that far)? e19 across the court sees the hut's NE corner only at the very edge of his far band; his halts
 * end a moment off the forecast, so the cones' margins are not trusted with him. (A halt's first seconds he still
 * faces the way he came, `alt`; its last two he may be turning to a leg W.)
 * (The forecasts here are the planner's — sneak.mjs predict: each leg the way the game's nav takes it, round the
 * buildings — not D.predict's straight legs: Patrol 26's leg round the barracks' N side came out 7 m off.)
 */
function backTurned(D, tag, t0, t1, xFar) {
  const e = D.get(tag);
  if (!e?.alive) return true;
  for (let t = t0; t <= t1; t += 0.5) {
    const q = predict(e, t);
    if (q.x > xFar) continue;
    if (Math.cos(q.heading) > 0.3 && (q.alt == null || Math.cos(q.alt) > 0.3)) {
      if (!q.halt) continue;
      const n = predict(e, t + 2);
      if (Math.cos(n.heading) > 0.3) continue;
    }
    return false;
  }
  return true;
}

/**
 * Patrol 26 away from the barracks' S face as he gets there (s from now): its round comes out of the SW gate's N mouth
 * facing the gap by e65's post (the deed itself is checked against its forecast like everyone's)
 */
const p26Far = (D, d0, d1) => farFrom(D, P26, [[75.5, 102.6], [77.5, 102.3], [74, 103.6], [70.5, 103]], d1, 20, Math.max(0, d0));
/** Will walker `tag` (dead, or) stay `r` m or more from (x, z) from d0 to d1 s from now (as predicted)? */
function awayFrom(D, tag, [x, z], r, d0, d1) {
  const e = D.get(tag);
  if (!e?.alive) return true;
  for (let t = d0; t <= d1; t += 0.5) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) < r) return false; }
  return true;
}

/** Will every man of `tags` stay at least `dist` m from all of `pts` from `from` to `horizon` s from now (as predicted)? */
function farFrom(D, tags, pts, horizon, dist, from = 0) {
  for (const tag of tags) {
    const e = D.get(tag);
    if (!e?.alive) continue;
    for (let t = from; t <= horizon; t += 1) { const q = predict(e, t); for (const [x, z] of pts) if (Math.hypot(q.x - x, q.z - z) < dist) return false; }
  }
  return true;
}

/**
 * carryTo, once nobody will see the Green Beret (on his feet) walk to the body, lift it and carry it along `via` to
 * `spot` (lying low meanwhile, `maxWait` s at most).
 */
async function carryWhenClear(D, e, spot, via = [], { maxWait = 120, label = '', far = null, gate = null, except = [] } = {}) {
  const gb = D.c('greenberet');
  if (typeof e === 'string') e = D.get(e);
  // (the walk to him at his pace, the lift — a second — and the carry at its own, CONFIG.units.carry; each moment
  // tried a second either way)
  const carryV = CONFIG.units.carry, walkV = CONFIG.units.walk;
  await untilA(D, async () => {
    const why = [], toBody = Math.hypot(e.x - gb.x, e.z - gb.z) / walkV;
    // (`far` [tags, m]: those men kept that far from the whole way meanwhile — a walker at the edge of his far band,
    // whose halts end a moment off the forecast, is not left to the cones' margins)
    if (far && !farFrom(D, far[0], [[e.x, e.z], ...via, spot], 25, far[1])) return dbg(D, [`${far[0].join(',')} near`], `carry ${e.tag}`);
    // (`gate`: the solution's own condition on the moment, as for the S court's carries e19's back)
    if (gate && !gate()) return dbg(D, ['gate'], `carry ${e.tag}`);
    // (a band's edge widened by most of a metre: the south court's carries pass at the very edge of e19's far band)
    // (along the ways the game will walk him: wayOf, unless the carry's own `via` is given)
    return (await qrA(D, wayOf(D, 'greenberet', [gb.x, gb.z], [e.x, e.z]), { mode: 'walk', from: [gb.x, gb.z], speed: walkV, delay: 0.6, hold: 1.2, slack: 1, why, margin: [3, 0.8], except: [e, ...except] })
      && await qrA(D, via.length ? [...via, spot] : wayOf(D, 'greenberet', [e.x, e.z], spot), { mode: 'walk', from: [e.x, e.z], speed: carryV, delay: 0.6 + toBody + 1.0, hold: 2, slack: 2, why, margin: [3, 0.8], except: [e, ...except] })) || dbg(D, why, `carry ${e.tag}`);
  }, maxWait, `nobody to see ${e.tag} carried${label ? ' ' + label : ''}`);
  await carryTo(D, 'greenberet', e, spot, via);
}

// ---------------------------------------------------------------- places
/** the castle's one climb (cl_w): its foot on the grass N of the W rock, its top on the HQ terrace's S strip */
const CLIMB_FOOT = [6.5, 84.6], CLIMB_TOP = [15, 76.5];
/** e1's x (walking W) when the Green Beret tops out from his hang (TOP_DT s after he lets go) */
const PASS_X = [16.5, 18.5], TOP_DT = 9, TOP_X = 18, HANG_Y = 5.5;
/** the decoy, against the forecourt screen; where the GB waits for e1 to take the bait; behind e1 at the decoy */
const DECOY_AT = [15, 69.7], LURK_W = [10, 77.5], E1_BEHIND = [19.5, 71.3];
/** behind e40 (he looks W over the forecourt); his body under the château's SE eaves; L_hq1's foot; the roof ledge */
const E40_BACK = [30.6, 63.6], E40_BODY = [26.5, 62.1], L_HQ1_FOOT = [24.5, 63.4], LEDGE = [22.5, 60.2];
/** behind e37's N halt (the turret's E face); his body in the turret's blind corner by the wing */
const E37_BACK = [31.9, 60], E37_BODY = [34, 53.3];
/** behind e2 (NW of him: he looks SSE) and behind e38 (W of him: he looks E), at the strip's E end */
const E2_BACK = [34, 73.5], E38_BACK = [35.4, 71], E2_PUT = [[36.7, 75.0], [36.7, 75.7]];
/** the E end of the forecourt screen, on the strip side */
const SCREEN_E = [19, 70.2], SCREEN_W2 = [20.5, 70];
/** the decoy in the turret's blind corner (W part); a spot nobody sees by e37's S halt; the second screen's pocket */
const DECOY_AT3 = [31.2, 53.3], E37_SIDE = [33.5, 65], B2_W = [34.4, 69.7], B2_WEND = [33.3, 68.6];
/** behind e37 at his N halt (out of the turret guard's sight); his body round the turret in its blind corner */
/** the stairs by the flak (S_nw2): its head on T_hq, its foot on T_nw */
const S_NW2_TOP = [36.8, 62.8], S_NW2_FOOT = [41.6, 66.2];
/** the HQ charge: in the turret's blind corner against the château (within the charge's reach of it, out of every eye) */
const HQ_BOMB = [28.6, 53];
/** the AT-gun charge (6 m W of the gunner e55, within the charge's reach of him); the N court's NW corner, under the N range */
/** from the W strip across to the tank's W end, by its hatch on the S side */
const TO_TANK = [[71.6, 50], [72.4, 44.5], [76.6, 38.6], [79.6, 39.8]];
/**
 * The tank's way out (straight legs, as the Driver steers it): through the inner gate's tunnel on its axis and out of
 * its S mouth before it turns (the game's tunnel is 4 m between its walls, the hull 3 m across); between the hut h_w3
 * and the barracks, S clear of the barracks' eaves before it turns W, and into the SW gate's mouth on its axis
 * (GATE_MOUTHS: from there the gun reaches the front pair beyond the bridge, over 13.5 m); then one straight run along
 * the axis through the arch and over the bridge (bridgeClick: in the game the passage between the open leaves and the
 * deck between the rails are 3.4 and 4.2 m wide, the hull 3.0 m), the road to the meadow's SW corner.
 */
const TANK_OUT = [[78, 39.5], [74, 39.5], [71.6, 42], [71.6, 50], [71.8, 58], [72, 74.5], [74, 82], [73.5, 89], [68.5, 93]];
/** (each to a stop: the hull lines up on the gate's axis from where it stands, not from where it rolled on to) */
const TANK_GATE = [[67.2, 99.5], [67.2, 103], [62.5, 104.8]], GATE_MOUTHS = [[59.1, 107.3], [59.3, 107.0], [58.9, 107.6], [59.5, 106.7]];
/** the clicks into the gate's mouth mouthClick tries, nearest the axis first (heading 105 through (57, 114); t −6.5 … −7.5) */
const GATE_MOUTH_TRY = [[59.1, 107.3], [58.9, 107.6], [59.3, 107.0], [59.0, 107.0], [59.2, 107.6], [58.8, 107.3], [59.4, 107.3], [59.5, 106.7], [58.7, 107.9], [59.6, 107.0]];
const TANK_ROAD = [[52.6, 130.4], [50, 136], [42, 138], [30, 143], [16, 147.5]], EXIT_AT = [4, 154];
/** the SW gate's axis (heading 105, through its centre (57, 114)) and across it (E) */
const GATE_AX = [Math.cos((105 * Math.PI) / 180), Math.sin((105 * Math.PI) / 180)], GATE_AC = [-GATE_AX[1], GATE_AX[0]];
/**
 * The click that takes the tank from the gate's mouth through the arch and over the bridge in one straight run, found as
 * a player finds it with the drive cursor: points about the bridge's far end on the axis, each tried with the game's own
 * drive plan from where the tank stands (Vehicle._planDrive: the turn, then the straight line) and the straight line from
 * where that turn leaves it (Vehicle.straightReach) — the first that runs all the way. The arch leaves the hull ±0.2 m of
 * the axis: where the turn leaves it depends on how it came into the mouth. null: none.
 */
export function bridgeClick(tank) {
  for (const t of [14, 13, 15]) for (const off of [0, 0.1, -0.1, 0.2, -0.2]) {
    const x = +(57 + GATE_AX[0] * t + GATE_AC[0] * off).toFixed(2), z = +(114 + GATE_AX[1] * t + GATE_AC[1] * off).toFixed(2);
    if (driveEnd(tank, x, z)) return [x, z];
  }
  return null;
}

/**
 * Where the Driver's click at (x, z) leaves the tank, as the game drives it: its drive plan from where it stands
 * (Vehicle._planDrive), the turn's legs (vehicle-maneuver arcStep), then the straight run (straightRun). null: refused,
 * or the run stops on the way.
 */
function driveEnd(tank, x, z) {
  const plan = tank._planDrive(x, z);
  if (!plan) return null;
  let p = { x: tank.x, z: tank.z, h: tank.heading };
  for (const l of plan.legs) p = arcStep(p.x, p.z, p.h, l.dir * l.len, l.k);
  return straightRun(tank, p, x, z, plan.legs.length ? 0.3 : tank.speed || 0);
}

/**
 * The click into the gate's mouth from which bridgeClick finds the run through the arch — tried from where each click
 * would leave the tank (driveEnd), a player's look ahead along the drive cursor. [mouth, run] or null.
 */
export function mouthClick(tank) {
  const at = { x: tank.x, z: tank.z, h: tank.heading, v: tank.speed };
  try {
    for (const [mx, mz] of GATE_MOUTH_TRY) {
      const e = driveEnd(tank, mx, mz);
      if (!e) continue;
      tank.x = e.x; tank.z = e.z; tank.heading = e.h; tank.speed = 0;
      const run = bridgeClick(tank);
      tank.x = at.x; tank.z = at.z; tank.heading = at.h; tank.speed = at.v;
      if (run) return [[mx, mz], run];
    }
    return null;
  } finally { tank.x = at.x; tank.z = at.z; tank.heading = at.h; tank.speed = at.v; }
}

/**
 * Where the straight run from pose p (speed v0) to (x, z) stops (null: short of it). The drive's own steps, tick by tick
 * (Vehicle._arcStraight: the speed rising to the order's, the heading easing onto the line to the point no faster than
 * the turning circle, the nose tried a probe step ahead of where each tick leaves it, arrived within 0.3 m) —
 * Vehicle.straightReach's 25 cm steps along the line can pass a cell the nose's corner only clips, where the drive stops.
 */
function straightRun(tank, p, x, z, v0 = 0) {
  const dt = CONFIG.sim.dt, R = tank.def.turnRadius, vmax = tank.def.slow, ahead = CONFIG.vehicles.probeStep;
  let px = p.x, pz = p.z, h = p.h, v = v0;
  for (let n = 0; n < 4000; n++) {
    const d = Math.hypot(x - px, z - pz);
    if (d < 0.3) return { x: px, z: pz, h };
    const want = Math.atan2(z - pz, x - px);
    v = Math.min(vmax, v + vmax * 2 * dt);
    const step = Math.min(d, v * dt), dh = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    h += Math.sign(dh) * Math.min(Math.abs(dh), step / R);
    const nx = px + Math.cos(h) * step, nz = pz + Math.sin(h) * step;
    if (!tank._nosePoints(nx + Math.cos(h) * ahead, nz + Math.sin(h) * ahead, h).every(([qx, qz]) => tank.passableAt(qx, qz))) return null;
    px = nx; pz = nz;
  }
  return null;
}
const YARD_WAIT = [[58.6, 69.2], [58.2, 66.8], [60.2, 65.6], [59.5, 63.6]], DECOY_FC = [86, 79], AT_BOMB = [71.2, 50.8], NWC = [[59.5, 35.2], [58.2, 36.8], [60.8, 37.6], [57.6, 34.6]];
/** behind e33 and e34 on T_nw's S edge (they face S) */
const E33_BACK = [45.6, 68.9], E34_BACK = [51.6, 68.9];
/** S_nw1 (T_nw <-> T_wb) and S_gw (T_wb <-> the W quarter) */
const S_NW1_TOP = [54, 50], S_NW1_FOOT = [59.2, 50], S_GW_TOP = [66.2, 67.6];
/** S_n3 (T_nw <-> T_n, the N range roof): its foot on T_nw, its head on T_n */
const S_N3_FOOT = [47.5, 35.2], S_N3_TOP = [47.5, 29.8], NW_WAIT = [42, 42];
/** where the GB lies on the N range roof for e67; behind e67's W halt (he looks S); the Sniper's spot for e66 on T_wb */
const LURK67 = [66, 14.8], E67_BACK = [59.8, 23.4], SNIPE66 = [57.5, 44];
/**
 * the way round the castle's S side, far out in the fields (from the E group's rocks to the SW; E of what the game
 * draws at (11-18, 137-144) in the meadow's SW corner: the headless grid has none of the library meshes)
 */
const S_FIELD = [[156.6, 45], [156.6, 80], [156, 115], [156, 150], [130, 158], [95, 158], [60, 158], [32, 156], [20.5, 138.5], [16, 131]];
/** the Sniper's firing point for e7 (W of the gate's front pair, beyond the bastion's eyes) */
const SNIPE7 = [21, 127];
/** where the Sapper and the Driver lie on the moat's W bank by the gate's bridge; where the outside three wait for the tank */
/** over the bridge and through the gate's arch (along its axis); the pocket behind the gatehouse's E tower */
const INTO = [[40, 120.5], [47, 123.6], [52.6, 126.1], [54.4, 123.7], [55.7, 118.8], [56.6, 116], [57.3, 113.2], [58, 110.4], [62.6, 110.7], [64.5, 112], [65.6, 115.6], [72, 115.6]], POCKET = [[75.6, 115.4], [77.6, 116.2], [79.6, 116.6]];
const BANK_W = [[32, 116], [30.4, 114.6], [28.8, 113.2]], PICKUP = [[11, 146], [9, 144.5]];
/**
 * The S court's cones widened for timing checks: e22's slow sweep (10.5 s) puts the edge of his cone on the hut's N corner
 * and the gap N of it only at its far-left turning point, where his head stands still — a sliver; the rest as usual
 */
const S_MARGIN = (e) => (e.tag === 'e22' ? [0.5, 0.1] : [2, 0.2]);
/**
 * from the hut's lee N up it and W along the barracks' S face to the gap by e65's post (e22's sweep takes in the hut's N
 * corner and the gap's S half at its far left; this way, kept N of that, it never sees)
 */
const N_WAY = [[79.6, 107.8], [80.2, 106.6], [80.5, 105.2], [80, 103.8], [79, 102.6], [77.5, 102.3], [75.5, 102.6], [74, 103.6]], N_WAY_REV = N_WAY.slice().reverse();
/**
 * Where he lies by the barracks' S corner for the moment (on N_WAY): in the game the corner's footprint takes the
 * cell under N_WAY's own point there, and a crawl to it ends a stride E — so the crawl's goal is that cell itself.
 */
const AT_S = [76.5, 102.5];
/**
 * e65's body: SE of his post in the lee of the hut (h_s2), out of everyone's sight (in the game the hut is drawn wider than
 * its footprint: the lee is the strip between it and the building to the E, x 77.5-81.5; the bodies go S along it)
 */
const E65_BODY = [79.6, 109.5], LEE = [78, 107.9];
/** behind e22 (NE of him: he looks SE down the road); his body in the pocket E of the gatehouse's tower (by the rear pair's) */
const E22_BACK = [61.2, 105], E22_BODY = [65, 112.4];
/** behind the gate's rear pair (N of them in the arch: they look S down the bridge); their bodies in the pocket E of its tower */
const SB_BACK = [57.7, 113.5], SA_BACK = [55.9, 113.3], GATE_BODY = [[64.4, 113.4], [65.3, 114.4]];
/**
 * where the GB stands behind e27 (S of him, W of the barracks' SW face: he looks NW); his body by e65's in the hut's lee
 * (not at its E side: in the game e24, walking E along his beat, sees x 81 of the lee for a moment through the gap
 * between the barracks and the hut)
 */
const E27_BACK = [68.9, 100.2], E27_BODY = [79.4, 112.6];
/** where the GB waits for e24 (the hut h_w3's E corner); e24's body in the lee */
const LURK24 = [65.2, 100.8], E24_BODY = [79.4, 111];
/** the way W from the gap by e65's post along the barracks' S face to its SW face's foot (N of e22's sweep's reach) */
const S_FACE_W = [[72.8, 103.65], [70.5, 103]];
/** the GB's crawl from the yard round the barracks' E end into the hut's lee (he lies on a whole metre of it: the planner's squares) */
/** Patrol 57's file keeps only roughly to its leader's step: crawlers along its round keep 9 m from each man */
const P57_KEEP = { p57: 9, p57b: 9, p57c: 9 };
const S1 = [79.5, 108.5], F_WAY = [[59.6, 78.8], [66, 76], [73, 73.5], [81, 77.5], [85, 87], [83, 99], S1];
/** F_WAY back N from the S court, without its stop at (81, 77.5) on Patrol 57's round: the planner's own way past it */
const F_BACK = [[83, 99], [85, 87], [73, 73.5], [66, 76], [59.6, 78.8]];

/**
 * Crawl `role` along `way` (ending F_BACK) from where he lies hidden in the S court round the barracks to the yard,
 * kept from Patrol 57's file — setting off only once neither patrol will come within 20 m of his way while he is on
 * the part of it by its round: Patrol 26 of the S court part and the barracks' E end (its halt there looks over the
 * way N) until he is past it, Patrol 57 of the crossing below the inner gate's S mouth (coming down through the gate
 * its file looks S over the way) from half way there until he is in the yard. On the way no shelter is left when a
 * patrol comes: in the game Patrol 26 came on the Driver lying by the E end for a gap in the cones (a browser run),
 * and Patrol 57 on the Sniper at (85, 87).
 */
const P57 = ['p57', 'p57b', 'p57c'];
async function roundBarracks(D, role, way, label) {
  const u = D.c(role), k = way.findIndex(([x, z]) => x === 85 && z === 87), v = 0.86;
  const by26 = [...way.slice(0, k + 1).filter(([, z]) => z > 80), [84, 93]], by57 = [[85, 87], [79, 80], [73, 73.5], [66, 76]];
  const t85 = 6 + pathLen([u.x, u.z], way.slice(0, k + 1)) / v, tYard = t85 + 14 + pathLen(way[k], way.slice(k + 1)) / v;
  await untilA(D, async () => (farFrom(D, P26, by26, t85 + 15, 20) || dbg(D, ['Patrol 26 near'], `${label} round the barracks`))
    && (farFrom(D, P57, by57, tYard, 20, t85 / 2) || dbg(D, ['Patrol 57 near'], `${label} round the barracks`)), 900, `${label}: both patrols off the way round the barracks`);
  for (const [x, z] of way) await crawl(D, role, x, z, { box: 6, hold: 4, crawlPad: 5, keepFrom: P57_KEEP, label: `${label} → (${x},${z})` });
}

/** the far E corridor of the W quarter (x 72-74: only p57 passes) */
const E_CORR_N = [72.5, 80.5];
/** behind e32 (on the stairs' lowest steps; he looks W); the stairs up to the gatehouse roof; the bodies up there */
const S_GW_UP = [[61, 77], [66, 68.5]], S_GW_FOOT = [61, 77];
/**
 * the decoy at the gatehouse roof's W corner (only e29 at his E halt hears it); where the GB waits; e32's body, in the
 * yard's N end under the bastion's face (Patrol 26, coming round the barracks' N side, sees the rest of the yard)
 */
const DECOY_R = [64.06, 65.06], ROOF_LURK = [68.6, 46.5], E32_BODY = [61.4, 63.8];
const E37_BEHIND = [34.9, 62.1], E37_CARRY = [[34.8, 57.5], [34.4, 55.4], [34.1, 53.6]];
/** the climb's foot and the corner of the W rock on the way there */
const FOOT = [14.6, 83.05], FOOT_TURN = [7.4, 83.5];
/** e1's x (walking E to his E halt) at which the Green Beret sets off up the wall (old) */
const CLIMB_GO = [+(globalThis.process?.env?.M20GO0 ?? 13), +(globalThis.process?.env?.M20GO1 ?? 14.6)];
/** just behind (E of) e1's W halt, where he halts looking W */
const E1_HALT_BACK = [9.4, 74.6];
/** e1's body: on the strip's N edge, under the forecourt screen (out of the turret's sight) */
const E1_BODY = [7, 70.2];
/** the drainpipe (cl_in): the strip's S edge -> the SW bastion */
const CLIN_TOP = [30, 76.6], CLIN_FOOT = [30, 80.6];
/** where he gets down again on the strip (the forecourt screen ends at x 23) */
const STRIP_W = [21, 77.2];

/**
 * A stage as a list of steps, each ending at its checkpoint: [cp id, fn]. `ctx.after` (dev: resuming from a saved
 * world) skips the steps up to and including that checkpoint.
 */
/**
 * Where a guard lured by decoy `dc` will stand to stare at it, and which way he will face: from (fx, fz) he walks the
 * way his own move order plans (Unit.planFrom: the stairs, round what the game draws) and stops at the decoy's
 * stand-off, turning to face it (enemy-brain DECOY). null without a way.
 */
function stareFrom(e, dc, fx, fz) {
  const p = e.planFrom(fx, fz, dc.x, dc.z);
  if (!p) return null;
  const R = CONFIG.ai.decoy.standOff;
  let x = fx, z = fz;
  for (const q of p) {
    const dx = q.x - x, dz = q.z - z, L2 = dx * dx + dz * dz;
    if (L2 > 1e-9) {
      // (the first point of this leg within R of the decoy: |(x, z) + t (dx, dz) - dc| = R, the smaller t in [0, 1])
      const ox = x - dc.x, oz = z - dc.z, b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R, disc = b * b - L2 * c;
      if (c <= 0) return { x, z, h: Math.atan2(dc.z - z, dc.x - x) };
      if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / L2; if (t >= 0 && t <= 1) { const sx = x + t * dx, sz = z + t * dz; return { x: sx, z: sz, h: Math.atan2(dc.z - sz, dc.x - sx) }; } }
    }
    x = q.x; z = q.z;
  }
  return { x, z, h: Math.atan2(dc.z - z, dc.x - x) };
}

/**
 * Would a man crawling along `way` stay out of the near band of guard `e` standing still at `pose` (stareFrom), his
 * cone widened by `m` ([deg, m])? (a lying man is seen only in the near band)
 */
function outOfNearBand(e, pose, way, m = [0.7, 0.1], step = 0.25) {
  // (his cone as coneAt draws it with his head straight ahead — a man staring at a lure does not sweep)
  const v = e.vision, far = v.far ?? v.range, near = v.elliptical ? far / 2 : Math.min(v.near ?? v.nearRange, far);
  const cone = { x: pose.x, z: pose.z, heading: pose.h, halfFov: v.fov / 2 + (m[0] * Math.PI) / 180, near: near + m[1], far: far + m[1] };
  for (let i = 1; i < way.length; i++) {
    const [ax, az] = way[i - 1], [bx, bz] = way[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k <= n; k++) if (pointInCone(cone, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n) === 'near') return false;
  }
  return true;
}

const stage = (list) => async (D, ctx = {}) => {
  let skip = !!ctx.after && list.some(([id]) => id === ctx.after);
  for (const [id, fn] of list) {
    if (skip) { if (id === ctx.after) { skip = false; ctx.after = null; } continue; }
    await fn(D, ctx);
  }
};

export const STAGES = [
  ['A', 'Over the west wall', stage([
    ['A0', async (D) => { D.checkpoint('A0 the Green Beret and the Spy lie behind the west rock; the others in the east field'); }],
    ['A1', async (D) => {
      await crawl(D, 'greenberet', ...CLIMB_FOOT, { box: 6 });
      D.checkpoint('A1 the Green Beret crawls to the foot of the west wall');
    }],
    ['A2', async (D) => {
      const e1 = D.get('e1'), gb = D.c('greenberet');
      // on his feet to the foot while e4 on the bastion looks E (he would see a man standing anywhere W of him), down
      // at the foot, and up the wall on his belly (on his feet the forecourt would see him on the wall top): timed so
      // that he tops out as e1 walks W past the climb, away from him (their beats are locked 2:1: once per e1 beat)
      const T_FOOT = 0.6 + (Math.hypot(FOOT_TURN[0] - gb.x, FOOT_TURN[1] - gb.z) + Math.hypot(FOOT[0] - FOOT_TURN[0], FOOT[1] - FOOT_TURN[1])) / 2.1;
      const T_TOP = T_FOOT + 0.6 + 14;
      await untilA(D, async () => {
        const q = D.predict(e1, T_TOP);
        if (!(Math.cos(q.heading) < -0.9 && q.x > CLIMB_GO[0] && q.x < CLIMB_GO[1])) return false;
        return await D.runSliced(routeClearGen(D, [FOOT_TURN, FOOT], { mode: 'walk', from: [gb.x, gb.z], speed: 2.0, slack: 1, pad: 0.6, hold: 1 }))
          && await D.runSliced(routeClearGen(D, [[15, 82.6]], { mode: 'crawl', from: [15, 82.6], delay: T_FOOT, hold: 4, slack: 1 }));
      }, 600, 'e1 walks W past the climb as he tops out, e4 looking E');
      D.log(`  climb at t=${D.t.toFixed(1)} e1 x=${e1.x.toFixed(1)}`);
      await D.stance('greenberet', 'stand');
      await D.path('greenberet', [FOOT_TURN, FOOT], { tol: 0.4 });
      await D.stance('greenberet', 'crawl');
      D.order('greenberet', { type: 'move', x: CLIMB_TOP[0], z: CLIMB_TOP[1] - 0.6 });
      await D.until(() => (gb.y || 0) > 12.9 && !gb.path, 40, 'GB at the top');
      D.log(`  top at t=${D.t.toFixed(1)} e1 (${e1.x.toFixed(1)},${e1.z.toFixed(1)}) h=${(e1.heading * 180 / Math.PI).toFixed(0)}`);
      D.checkpoint('A2 the Green Beret climbs the west wall behind e1');
    }],
    ['A3', async (D) => {
      const e1 = D.get('e1'), gbA = D.c('greenberet');
      // on his feet after e1 (his back to him; the forecourt screen and the château hide the strip's W half from
      // everyone else) to just behind his W halt, and the knife as he halts
      await D.stance('greenberet', 'stand');
      // (a couple of strides behind him all the way: he walks no faster than a man after him)
      await D.until(() => { if (Math.hypot(gbA.x - e1.x, gbA.z - e1.z) > 2.6 && !gbA.path) { const h = e1.heading; D.order('greenberet', { type: 'move', x: e1.x - Math.cos(h) * 2.2, z: e1.z - Math.sin(h) * 2.2 }); } return e1.brain?.atWait && Math.hypot(gbA.x - e1.x, gbA.z - e1.z) < 3.2; }, 20, 'GB behind e1 at his W halt');
      await knife(D, e1, { ready: () => e1.brain?.atWait, maxSec: 3.5, label: 'at his W halt' });
      D.checkpoint('A3 the Green Beret walks after e1 and knifes him at the west end of the strip');
    }],
  ])],
  ['B', 'The east end of the terrace', stage([
    ['B1', async (D) => {
      // along the strip (its W half out of everyone's sight now), past the forecourt's opening between two sweeps of the
      // turret, to the strip's E end behind the second screen: only e2 and e38 see in there
      // (hugging the forecourt screen: e40 sees the strip's middle through the opening at the end of his sweep)
      // (his cone's edge, swinging back, crosses the strip's W end in 0.05 s, between two of the planner's samples: his
      // cone tried every 0.025 s, and a little wider: he passes between two cell centres)
      await D.path('greenberet', [[11.5, 70.3], SCREEN_E], { tol: 0.4, max: 30 });
      await crawl(D, 'greenberet', ...E2_BACK, { box: 5, horizon: 200, keep: 1, hold: 2, keepWalker: 3, maxExpand: 900000, maxWait: 600, margin: [5, 6], edgePad: 3, subSteps: 4, postMargin: [4, 0.5], label: 'GB behind e2' });
      D.checkpoint('B1 the Green Beret crawls along the strip to its east end, behind the searchlight guard');
    }],
    ['B2', async (D) => {
      // (where he falls the turret guard glimpses the strip's end at the edge of his far band: the body a step S, out
      // of it, at once)
      // (carried S along the E parapet and put down ahead of him, lying N–S beside it: in the game the body is laid clear
      // of the parapets' masonry, which a body lying across the corner would touch — it was shoved out into e3's sight;
      // the knife when nobody will see the carry)
      const e2 = D.get('e2'), gb = D.c('greenberet');
      await knife(D, e2, { maxSec: 240, quiet: 4, after: null, label: 'by the searchlight',
        ready: async () => { const why = []; return await qrA(D, E2_PUT, { mode: 'walk', from: corpseSpot(D.world, gb, e2), speed: 1.0, delay: 1.6, hold: 1.4, step: 0.1, slack: 0.3, except: [e2], why, margin: [3, 0.25] }) || dbg(D, why, 'carry e2'); } });
      await carryTo(D, 'greenberet', e2, E2_PUT[1], [E2_PUT[0]], { tol: 0.15, viaTol: 0.25 });
      await D.stance('greenberet', 'crawl');
      D.checkpoint('B2 the Green Beret knifes e2 by the searchlight');
    }],
    ['B3', async (D) => {
      // e38 at the second screen's E end looks E: the knife from the screen's lee behind him; he falls in the lee, out of
      // the turret guard's sweep (the knife waits while where he will lie is seen)
      await crawl(D, 'greenberet', ...E38_BACK, { box: 3, keep: 1, hold: 1, keepWalker: 2, label: 'GB behind e38' });
      await knife(D, 'e38', { maxSec: 120, label: 'at the E end of the screen' });
      D.checkpoint('B3 the Green Beret knifes e38 behind the second screen');
    }],
  ])],
  ['C', 'The turret guard\'s corner', stage([
    ['C1', async (D) => {
      // e37 halts 20 s at the N end of his beat looking E: round the second screen's W end (out of the turret guard's
      // sweep) and up behind him, 2.5 m off — a spot nobody sees — set off as he arrives so that the turret guard's
      // sweep leaves them alone for the crawl and, after it, for the knife and the carry
      const e37 = D.get('e37'), gb = D.c('greenberet');
      const way = [B2_W, B2_WEND, E37_SIDE, [34.3, 63.5], E37_BEHIND];
      let len = 0, p0 = [gb.x, gb.z];
      for (const q of way) { len += Math.hypot(q[0] - p0[0], q[1] - p0[1]); p0 = q; }
      const tArr = len / 0.85;
      await untilA(D, async () => { const why = []; return (e37.brain?.atWait && e37.z < 60.5 && (e37.brain.waitT ?? 0) > tArr + 3
        && await qrA(D, way, { mode: 'crawl', from: [gb.x, gb.z], speed: 0.85, hold: 2, why, margin: [1.5, 0.05] })
        && await qrA(D, [[e37.x, e37.z], ...E37_CARRY], { mode: 'walk', from: E37_BEHIND, speed: 1.2, delay: tArr + 1.5, hold: 1, except: [e37], why, margin: [2, 0.3] })) || dbg(D, why, 'behind e37'); }, 600, 'e37 arrives at his N halt, the turret\'s sweep elsewhere');
      await D.path('greenberet', way, { tol: 0.35, max: 20 });
      D.checkpoint('C1 the Green Beret crawls round the second screen up behind e37 at his north halt');
    }],
    ['C3', async (D) => {
      // the knife as the turret guard's sweep leaves this corner, and the body N round the turret into its blind corner
      // by the wing before it comes back (7 s)
      const e37 = D.get('e37'), gb = D.c('greenberet');
      await knife(D, e37, { maxSec: 6, quiet: 4, after: null, ahead: 1.2, label: 'at his N halt',
        ready: async () => e37.brain?.atWait && await qrA(D, [corpseSpot(D.world, gb, e37), ...E37_CARRY], { mode: 'walk', from: [gb.x, gb.z], speed: 1.25, delay: 1.6, hold: 0.8, except: [e37], margin: [2, 0.3] }) });
      await carryTo(D, 'greenberet', e37, E37_CARRY.at(-1), E37_CARRY.slice(0, -1));
      await D.stance('greenberet', 'crawl');
      D.checkpoint('C3 the Green Beret knifes e37 and hides him behind the turret');
    }],
  ])],
  ['D', 'Down to the north-west terrace', stage([
    ['D1', async (D) => {
      // along the terrace's E edge (out of the turret guard's and everyone's sight) to the head of the stairs by the flak,
      // and down them to the NW terrace behind its two sentries (they watch the W quarter, S)
      const gb = D.c('greenberet');
      await D.path('greenberet', [[36.8, 54.5], [37, 58], S_NW2_TOP], { tol: 0.35, max: 30 });
      D.order('greenberet', { type: 'move', x: S_NW2_FOOT[0], z: S_NW2_FOOT[1] });
      await D.until(() => !gb.path && !gb.isMoving && Math.abs((gb.y || 0) - 7) < 0.3, 30, 'GB down the stairs on the NW terrace');
      D.checkpoint('D1 the Green Beret crawls down the stairs to the north-west terrace');
    }],
    ['D2', async (D) => {
      // e33 then e34, from behind (they face S over the W quarter); the knife when nobody below looks up (bodies lying
      // on the terrace are out of sight from below)
      await crawl(D, 'greenberet', ...E33_BACK, { box: 4, keep: 1, hold: 1, keepWalker: 2, horizon: 120, label: 'GB behind e33' });
      await knife(D, 'e33', { maxSec: 120, label: 'on the NW terrace' });
      D.checkpoint('D2 the Green Beret knifes e33 on the north-west terrace');
    }],
    ['D3', async (D) => {
      await crawl(D, 'greenberet', ...E34_BACK, { box: 4, keep: 1, hold: 1, keepWalker: 2, horizon: 120, label: 'GB behind e34' });
      await knife(D, 'e34', { maxSec: 120, label: 'on the NW terrace' });
      D.checkpoint('D3 the Green Beret knifes e34 on the north-west terrace');
    }],
  ])],
  ['E', 'The west quarter\'s stairs; the south-west wall', stage([
    ['E1', async (D) => {
      // across the NW terrace (nobody watches its middle now), down the stairs to the W bastion's terrace and along it to
      // the head of the W quarter's stairs, by the inner gatehouse
      const gb = D.c('greenberet');
      await D.path('greenberet', [[50, 60], S_NW1_TOP], { tol: 0.4, max: 40 });
      D.order('greenberet', { type: 'move', x: S_NW1_FOOT[0], z: S_NW1_FOOT[1] });
      await D.until(() => !gb.path && !gb.isMoving && Math.abs((gb.y || 0) - 4) < 0.3, 30, 'GB down on the W bastion terrace');
      await D.path('greenberet', [[61, 56], [64, 63], S_GW_TOP], { tol: 0.4, max: 40 });
      D.checkpoint('E1 the Green Beret crosses to the head of the west quarter\'s stairs');
    }],
    ['E2', async (D) => {
      // the decoy on the gatehouse roof's W corner: of all the quarter only e29, at the E end of his beat, is near
      // enough to hear it (e32 at the stairs' foot is a stride beyond its reach); the Green Beret lies on the W
      // bastion terrace NE of it, too far off the way e29 will come up the stairs for him to make out a man lying down
      // (a stride either way and e32 hears it too, or e29 does not; and where e29 halts to stare at it, two metres short
      // on his way from the stairs, is a matter of a hand's breadth: dropped in the roof's very corner, against the
      // parapet, he stops on the roof's E side facing NW, his back to the way along the bastion's E edge; a hand's
      // breadth E or N of it he stops by the stairs facing N, and that way runs at the edge of his sight. So the drop
      // is checked, and taken up and set again)
      const gb = D.c('greenberet'), e29 = D.get('e29'), E_HALT = [57.7, 76.5], E32_AT = [61, 78.5];
      // (he sets it down on his feet, a pace E of the spot, having stepped up to it facing W: lying beside the parapet a
      // man lies along it, and the decoy would go down a pace N of him)
      const stand = [DECOY_R[0] + 0.4, DECOY_R[1]], pre = () => [stand[0] + 0.9, stand[1]];
      // (his way from the bastion terrace's NE corner along its E edge, onto the roof and up behind e29)
      const approach = (q) => [ROOF_LURK, [68.75, ROOF_LURK[1] + 1], [68.75, 62], [68.6, 66.5], [q.x - Math.cos(q.h) * 1.8, q.z - Math.sin(q.h) * 1.8]];
      for (let k = 0; ; k++) {
        await D.go('greenberet', ...pre(), { tol: 0.2, max: 20 });
        // (e29's head swings across the corner as he turns away from either end of his beat: turns foreseen; and Patrol 26,
        // whose round comes through the SW gate and up the W quarter — a file of four, each a step off its leader's pace
        // — out of its far band's reach altogether)
        await cautious(D, () => untilA(D, async () => { const why = []; return (farFrom(D, P26, [stand], 10, 40) && await qrA(D, [stand], { mode: 'walk', from: pre(), speed: 1.0, delay: 0.3, hold: 3, why, margin: [4, 0.4] })) || dbg(D, why.length ? why : ['Patrol 26 near'], 'the decoy drop'); }, 300, 'nobody to see him on his feet in the roof\'s corner'));
        await D.stance('greenberet', 'stand');
        await D.go('greenberet', ...stand, { tol: 0.06, max: 10 });
        D.ability('greenberet', 'decoyDrop');
        await D.idle('greenberet', 3);
        await D.stance('greenberet', 'crawl');
        const dc = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
        const a = Math.hypot(dc.x - E_HALT[0], dc.z - E_HALT[1]), b = Math.hypot(dc.x - E32_AT[0], dc.z - E32_AT[1]);
        const q = stareFrom(e29, dc, ...E_HALT), ok = a < 13.4 && b > 13.6 && !!q && outOfNearBand(e29, q, approach(q));
        D.log(`  decoy at (${dc.x.toFixed(2)},${dc.z.toFixed(2)}): ${a.toFixed(2)} m from e29's E halt, ${b.toFixed(2)} m from e32; e29 would stare from ${q ? `(${q.x.toFixed(2)},${q.z.toFixed(2)}) h${(q.h * 180 / Math.PI).toFixed(0)}` : 'nowhere'}${ok ? '' : ' — again'} (dropped from (${gb.x.toFixed(2)},${gb.z.toFixed(2)}) h${(gb.heading * 180 / Math.PI).toFixed(0)})`);
        if (ok) break;
        if (k >= 5) throw new Error('decoy: no good drop');
        // (where it fell short of the spot, that much the other way; on the spot itself, a hand's breadth further in)
        const off = Math.hypot(DECOY_R[0] - dc.x, DECOY_R[1] - dc.z) < 0.04 ? [-0.05, 0.03] : [DECOY_R[0] - dc.x, DECOY_R[1] - dc.z];
        stand[0] = Math.min(64.9, Math.max(64.3, stand[0] + off[0])); stand[1] = Math.min(65.25, Math.max(64.9, stand[1] + off[1]));
        D.ability('greenberet', 'hand', dc);
        await D.until(() => gb.has?.('decoy'), 20, 'decoy taken up');
        await D.idle('greenberet', 3);
      }
      await D.path('greenberet', [[68.5, 62], ROOF_LURK], { tol: 0.4, max: 30 });
      D.checkpoint('E2 the Green Beret leaves his decoy on the gatehouse roof and lies in wait on the W bastion terrace');
    }],
    ['E3', async (D) => {
      // the decoy beeps as e29 halts at the E end of his beat (Patrol 57 well away from the tunnel under the roof): he
      // comes up the stairs to it and stares; the knife from behind
      const e29 = D.get('e29'), gb = D.c('greenberet');
      const p57 = ['p57', 'p57b', 'p57c'].map((t) => D.get(t));
      const dc = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
      await D.until(() => e29.brain?.atWait && Math.hypot(e29.x - dc.x, e29.z - dc.z) < 13.4
        && p57.every((e) => { for (let t = 0; t <= 90; t += 1) { const q = D.predict(e, t); if (Math.hypot(q.x - DECOY_R[0], q.z - DECOY_R[1]) < 15) return false; } return true; }), 300, 'e29 at his E halt, Patrol 57 far from the roof');
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => e29.brain?.state === 'DECOY' && e29.brain.phase === 'stare', 60, 'e29 stares at the decoy');
      D.log(`  e29 stares from (${e29.x.toFixed(1)},${e29.z.toFixed(1)}) y${(e29.y || 0).toFixed(1)} h=${(e29.heading * 180 / Math.PI).toFixed(0)}`);
      const back = [e29.x - Math.cos(e29.heading) * 1.8, e29.z - Math.sin(e29.heading) * 1.8];
      const way = [[68.75, ROOF_LURK[1] + 1], [68.75, 62], [68.6, 66.5], back];
      await untilA(D, async () => { const why = []; return await qrA(D, way, { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 1, why, margin: [0.7, 0.1] }) || dbg(D, why, 'behind e29'); }, 20, 'the way behind e29 unwatched');
      await D.path('greenberet', way, { tol: 0.4, max: 30 });
      await knife(D, e29, { maxSec: 30, quiet: 60, label: 'staring at the decoy' });
      D.ability('greenberet', 'decoyToggle');
      D.ability('greenberet', 'hand', D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed));
      await D.until(() => gb.has?.('decoy'), 20, 'decoy picked up');
      await D.stance('greenberet', 'crawl');
      D.checkpoint('E3 the decoy beeps: e29 comes up the stairs to it and the Green Beret knifes him on the roof');
    }],
    ['E4', async (D) => {
      // down the stairs behind e32 (he looks W over the quarter from their foot, his head swinging round to the stairs at
      // the end of each sweep), the knife, and the body into the yard N of the beat (only e29 ever looked in there)
      const gb = D.c('greenberet');
      await D.path('greenberet', [S_GW_TOP], { tol: 0.4, max: 20 });
      await untilA(D, async () => { const why = []; return await qrA(D, [S_GW_UP[1], S_GW_FOOT], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 4.5, slack: 0.8, why, margin: [3, 0.2] })
        && await qrA(D, [], { mode: 'body', from: [61, 78.8], delay: 14, hold: 8, why, except: [D.get('e32')] }) || dbg(D, why, 'down the stairs'); }, 200, 'the stairs unwatched');
      D.order('greenberet', { type: 'move', x: S_GW_FOOT[0], z: S_GW_FOOT[1] });
      await D.until(() => !gb.path && !gb.isMoving, 30, 'GB at the foot of the stairs');
      await knife(D, 'e32', { maxSec: 2.5, quiet: 8, after: null, label: 'at the foot of the stairs', reach: 3.4, ahead: 1.3 });
      await carryTo(D, 'greenberet', D.get('e32'), E32_BODY);
      await D.stance('greenberet', 'crawl');
      D.checkpoint('E4 the Green Beret knifes e32 at the foot of the west quarter\'s stairs and hides him in the yard under the W bastion');
    }],
    ['E5', async (D) => {
      // (the Green Beret lies on in the yard under the W bastion: e7 on the SW wall sees the whole hut's lee where the
      // south court's bodies go, so he goes first)
      // the Sniper crawls from the E fields round the castle's S side, far out in the meadow, to the moat's W bank
      // (the E wall's walkers halt looking E over the narrow field and sweep: planned with their heads where the sweep
      // puts them, not all of it at once — the field is only a near band wide)
      await fieldCrawl(D, 'sniper');
      D.checkpoint('E5 the Sniper crawls round the south field to the moat\'s west bank');
    }],
    ['E6', async (D) => {
      // from the meadow W of the gate's front pair (out of their sweep and beyond the bastion's eyes) the Sniper takes
      // e7 on the SW wall as he walks its middle stretch: there his body lies out of sight of the bastion and the S wall
      const e7 = D.get('e7'), sn = D.c('sniper');
      // (he waits out by the SW corner, beyond Patrol 26's eyes, and crawls up to the firing point as e7 nears it)
      const inWin = (q) => q.x > 60.6 && q.x < 63.6;
      const tWin = () => { for (let t = 0; t < 130; t += 0.5) if (inWin(D.predict(e7, t))) return t; return Infinity; };
      const crawlT = Math.hypot(SNIPE7[0] - sn.x, SNIPE7[1] - sn.z) / 0.8 + 2;
      await untilA(D, async () => { const why = []; const tw = tWin(); return (tw > crawlT && tw < crawlT + 4
        && await qrA(D, [SNIPE7], { mode: 'crawl', from: [sn.x, sn.z], speed: 0.8, hold: tw - crawlT + 8, why, margin: [6, 0.5] })) || dbg(D, why, 'to the firing point'); }, 600, 'e7 nearing the middle of the wall, the way to the firing point unwatched');
      await D.path('sniper', [SNIPE7], { tol: 0.4, max: 40 });
      await untilA(D, async () => {
        const why = [];
        if (!inWin(e7)) return dbg(D, [`e7 at x ${e7.x.toFixed(1)}`], 'e7');
        const cu = ABILITIES.sniper.canUse(sn, e7, D.world);
        if (cu !== true) return dbg(D, [`rifle: ${cu}`], 'e7');
        if (!await qrA(D, [], { mode: 'walk', from: [sn.x, sn.z], delay: 0, hold: 2.2, why, margin: [6, 0.5], except: [e7] })) return dbg(D, why, 'e7');
        const f = await bsA(D, e7.x + Math.cos(e7.heading) * 1.2, e7.z + Math.sin(e7.heading) * 1.2, 300, { except: [e7] });
        return !f.length || dbg(D, [`body seen by ${f.join(',')}`], 'e7');
      }, 30, 'e7 on the middle of the SW wall, nobody to see the shot');
      D.ability('sniper', 'sniper', e7);
      await D.until(() => !e7.alive, 6, 'e7 shot');
      await D.idle('sniper', 5);
      await D.stance('sniper', 'crawl');
      D.checkpoint('E6 the Sniper shoots e7 on the SW wall');
    }],
  ])],
  ['F', 'The south court', stage([
    ['F1', async (D) => {
      // out of the yard and E across the foot of the gatehouse, round the barracks' E end and S to behind e65 (he looks
      // NW up the road from beside it): on his belly all the way, between the sweeps
      // (Patrol 57 walks its round past the gatehouse's foot: its file keeps only roughly to its leader's step — in the
      // game they came on a man lying at the tunnel's E mouth — so never within 9 m of any of the three)
      const P57 = { p57: 9, p57b: 9, p57c: 9 };
      // (at the tunnel's E mouth only behind the patrol, once it has come down past the mouth and turned E along the
      // court — coming down from the N it looks into the tunnel: the plan's arrival there is held until then, the wait
      // wherever nobody sees him)
      const p57 = ['p57', 'p57b', 'p57c'].map((t) => D.get(t));
      const passed = () => { for (let t = 0; t <= 240; t += 0.5) { if (p57.every((e) => { if (!e.alive) return true; const q = D.predict(e, t); return q.x > 80.5 && q.z > 74 && Math.cos(q.heading) > 0.5; })) return D.t + t; } return D.t + 240; };
      for (const [n, [x, z]] of F_WAY.entries()) {
        const T = n === 1 ? passed() : null;
        await crawl(D, 'greenberet', x, z, { box: 6, hold: 4, crawlPad: 5, ...(n <= 2 ? { keepFrom: P57 } : null), ...(T != null ? { goalOk: (gx, gz, t) => t >= T } : null), label: `GB → (${x},${z})` });
      }
      D.checkpoint('F1 the Green Beret crawls round the barracks to behind e65');
    }],
    ['F2', async (D) => {
      // e65 looks NW up the road from beside the barracks' S corner. The way to him from the hut's lee the game leaves is
      // round the hut's N corner, which e22 by the gate takes in at the far left of his sweep: instead N up the lee and W
      // along the barracks' S face (N_WAY, out of e22's sight altogether), on his belly to behind e65; the knife, and the
      // body back the same way into the lee, where nobody's eyes reach. He lies in the lee until he can go through with
      // it at once — on the way nowhere is out of everyone's sight for long
      const gb = D.c('greenberet'), e65 = D.get('e65'), AT = AT_S;
      const me = { x: AT[0], z: AT[1], heading: Math.atan2(e65.z - AT[1], e65.x - AT[0]), stance: 'crawl' };
      const cs = corpseSpot(D.world, me, e65), up = wayOf(D, 'greenberet', AT, cs), tUp = 0.6 + pathLen(AT, up) / CONFIG.units.walk;
      // (the walk up at his pace, the blow and the lift, then the carry at its own — CONFIG.units.carry — each moment
      // tried a second either way; e19 across the court sees the barracks' S face only at the very edge of his far band as
      // he walks W: his back to it the whole time rather than the cones' margins)
      // (a second or two either way: in the game the walkers keep to their forecast only roughly)
      // (e24 on his beat is in the checks, his head at his halts where its sweep puts it: walking E from his W halt he
      // looks through the gap by the hut's N corner into the lee's N end — in a run he saw a man carrying a body there,
      // 22 m off; e19 has his own rule)
      const blind = [e65, D.get('e19')];
      const okAt = (d, why = null) => (backTurned(D, 'e19', Math.max(0, d - 1), d + 15, 112) || (why?.push('e19 walks W'), false))
        && exactly(D, 1.5, () => quietRoute(D, up, { mode: 'walk', from: AT, speed: CONFIG.units.walk, delay: d + 0.6, hold: 1.5, slack: 0.6, margin: S_MARGIN, except: blind, why })
        && quietRoute(D, [...N_WAY_REV, E65_BODY], { mode: 'walk', from: cs, speed: CONFIG.units.carry, delay: d + tUp + 1.6, hold: 1.5, slack: 1.0, margin: S_MARGIN, except: blind, why }));
      // (a moment that slips before the knife — e22's glance off the forecast — he crawls back to the lee and waits for
      // the next: he has not moved from where he lay)
      for (let k = 0; ; k++) {
        await atMoment(D, 'greenberet', AT, okAt, S1, { box: 5, hold: 14, grace: 12, crawlPad: 5, exact: 1.5, label: 'GB → behind e65' });
        try {
          await knife(D, e65, { maxSec: 6, quiet: 5, after: null, label: 'by the road', reach: 4, margin: S_MARGIN,
            ready: async () => { const why = []; return okAt(0, why) || dbg(D, why, 'e65 carry'); } });
          break;
        } catch (err) { if (!/timeout/.test(err.message) || k >= 3 || !e65.alive) throw err; }
        D.log(`  GB → behind e65: the knife's moment slipped at t=${D.t.toFixed(1)}; back to (${S1[0]},${S1[1]})`);
        await crawl(D, 'greenberet', ...S1, { box: 5, hold: 3, crawlPad: 5, label: 'GB → behind e65 (back)' });
      }
      await carryTo(D, 'greenberet', e65, E65_BODY, N_WAY_REV);
      await D.stance('greenberet', 'crawl');
      D.checkpoint('F2 the Green Beret knifes e65 and hides him behind the hut');
    }],
    ['F3', async (D) => {
      // e27 watches the W quarter's lanes and e24's beat from the barracks' W corner (NW). From the hut's lee on his belly
      // the way he took for e65, to the barracks' S corner; then, as e24 turns away W from the E end of his beat (from
      // his halt and his walk E he sees e27's post), on his feet along the barracks' S face and up behind e27, the knife,
      // and the body back the same way into the lee
      const e24 = D.get('e24'), e27 = D.get('e27'), gb = D.c('greenberet'), AT = AT_S;
      const way = [N_WAY[N_WAY.length - 1], ...S_FACE_W, E27_BACK], walked = waysOf(D, 'greenberet', AT, way), tWalk = 0.8 + pathLen(AT, walked) / CONFIG.units.walk;
      const me = { x: E27_BACK[0], z: E27_BACK[1], heading: Math.atan2(e27.z - E27_BACK[1], e27.x - E27_BACK[0]), stance: 'stand' };
      const cs = corpseSpot(D.world, me, e27), back = [...S_FACE_W.slice().reverse(), ...N_WAY_REV];
      const okAt = (d, why = null) => {
        // (a second or two either way: in the game the walkers keep to their forecast only roughly)
        if (e24.alive) for (let t = Math.max(0, d - 1.5); t <= d + tWalk + 3; t += 0.5) if (Math.cos(D.predict(e24, t).heading) > -0.6) { why?.push('e24 not walking W'); return false; }
        // (e24 walking W has his back to the walk; the carry back is checked against him like everyone, his head at his
        // halts where its sweep puts it: walking E from his W halt he looks into the lee's N end through the gap by the
        // hut's N corner)
        return (backTurned(D, 'e19', Math.max(0, d - 1), d + tWalk + 16, 112) || (why?.push('e19 walks W'), false))
          // (along the way the game walks him — round the barracks' S corner as it draws it: walked, wayOf leg by leg —
          // not the clicked polyline: in the game the first strides ran 0.3 m S of it, into the far left of e22's sweep)
          && exactly(D, 1.5, () => quietRoute(D, walked, { mode: 'walk', from: AT, speed: CONFIG.units.walk, delay: d + 0.8, slack: 0.6, hold: 1.5, margin: S_MARGIN, except: [e27, D.get('e19')], why })
          && quietRoute(D, [...back, E27_BODY], { mode: 'walk', from: cs, speed: CONFIG.units.carry, delay: d + tWalk + 2.6, hold: 1.5, slack: 1.0, margin: S_MARGIN, except: [e27, D.get('e19')], why }));
      };
      await atMoment(D, 'greenberet', AT, okAt, S1, { box: 5, hold: 14, grace: 12, crawlPad: 5, exact: 1.5, label: 'GB → the barracks\' S corner (e27)' });
      await D.stance('greenberet', 'stand');
      await D.path('greenberet', way, { tol: 0.4, max: 20 });
      await knife(D, e27, { maxSec: 3, quiet: 5, after: null, label: 'by the barracks', reach: 4.2, ahead: 1.2, margin: S_MARGIN });
      await carryTo(D, 'greenberet', e27, E27_BODY, back);
      await D.stance('greenberet', 'crawl');
      D.checkpoint('F3 the Green Beret knifes e27 by the barracks and hides him in the hut\'s lee');
    }],
    ['F5', async (D) => {
      // e22 by the gate looks SE over the road and into the gate's inner mouth; the way to his back is N up the lee, W
      // along the barracks' S face and on W hard by it (a stride further S and e22's sweep takes the way in at its far
      // left; e23 by the W wall is hidden by a hut): on his belly to the barracks' S corner, then on his feet — the knife,
      // and the body into the pocket E of the gatehouse's tower
      const e22 = D.get('e22'), e24 = D.get('e24'), gb = D.c('greenberet'), AT = AT_S;
      const way = [[74, 103.6], [72.8, 103.65], [68, 103.6], [64.5, 103.6], E22_BACK], walkT = 0.8 + pathLen(AT, way) / CONFIG.units.walk;
      // (the moment: e24 away from the E end of his beat for the whole walk — halted there, his head sweeps along the
      // barracks' S face; otherwise he is checked like everyone, his halted head where its sweep puts it; e19 across the
      // court with his back to it: the way runs along the very edge of his far band, and his halts end a moment off the
      // forecast)
      const okAt = (d, why = null) => {
        // (a few seconds either way: in the game the walkers keep to their forecast only roughly)
        if (e24.alive) for (let t = Math.max(0, d - 3); t <= d + walkT + 3; t += 0.5) { const q = D.predict(e24, t); if (Math.hypot(q.x - 66, q.z - 96) < 3) { why?.push('e24 at his E halt'); return false; } }
        return (backTurned(D, 'e19', Math.max(0, d - 1), d + walkT + 3, 112) || (why?.push('e19 walks W'), false))
          && exactly(D, 1.5, () => quietRoute(D, way, { mode: 'walk', from: AT, speed: CONFIG.units.walk, delay: d + 0.8, slack: 0.6, hold: 1, margin: S_MARGIN, why })
          && quietRoute(D, [], { mode: 'walk', from: [e22.x, e22.z], delay: d + walkT, hold: 4, margin: S_MARGIN, except: [e22], why })
          && quietRoute(D, wayOf(D, 'greenberet', [e22.x, e22.z], E22_BODY), { mode: 'walk', from: [e22.x, e22.z], speed: CONFIG.units.carry, delay: d + walkT + 2.5, hold: 2, slack: 1.0, margin: S_MARGIN, except: [e22], why }));
      };
      await atMoment(D, 'greenberet', AT, okAt, S1, { box: 5, hold: 14, grace: 12, crawlPad: 5, exact: 1.5, label: 'GB → the barracks\' S corner (e22)' });
      await D.stance('greenberet', 'stand');
      await D.path('greenberet', way, { tol: 0.4, max: 30 });
      await knife(D, e22, { maxSec: 4, quiet: 6, after: 'crawl', label: 'by the gate', reach: 4, ahead: 1.2, margin: S_MARGIN });
      await carryWhenClear(D, e22, E22_BODY, [], { maxWait: 200 });
      await D.stance('greenberet', 'crawl');
      D.checkpoint('F5 the Green Beret knifes e22 by the gate and hides him in the pocket by the gatehouse');
    }],
    ['F4', async (D) => {
      // e24 walks his beat round the hut h_w3 and halts at its E end looking E. From the lee on his belly to the barracks'
      // S corner; as e24 stands at the W end of his beat looking N, on his feet along the barracks' S face to the hut's E
      // corner, and down there (e24 never looks back at it); the knife as e24 halts, from his right side, and the body
      // into the lee round the hut's N corner (with e22 gone, the short way)
      const e24 = D.get('e24'), gb = D.c('greenberet'), AT = AT_S;
      const toLurk = [N_WAY[N_WAY.length - 1], ...S_FACE_W, [67, 102.2], LURK24], tWalk = 0.8 + pathLen(AT, toLurk) / CONFIG.units.walk;
      const okAt = (d, why = null) => {
        // (e24 halted at the W end of his beat, looking N, as he sets off: from (55, 101) the way lies off his right shoulder)
        if (e24.alive) { const q = D.predict(e24, d); if (Math.hypot(q.x - 55, q.z - 101) > 1.5) { why?.push('e24 not at his W halt'); return false; } }
        // (and far from the hut's corner and e24's halt until the knife: its round passes them on the way from the gate)
        return (p26Far(D, d - 3, d + 4) && farFrom(D, P26, [LURK24, [66, 96]], d + tWalk + 32, 24, Math.max(0, d)) || (why?.push('Patrol 26 near'), false)) && (backTurned(D, 'e19', d, d + tWalk, 112) || (why?.push('e19 walks W'), false))
          && quietRoute(D, toLurk, { mode: 'walk', from: AT, speed: CONFIG.units.walk, delay: d + 0.8, slack: 0.6, hold: 1, margin: S_MARGIN, except: [D.get('e19')], why })
          // (lying at the hut's corner: e24 walking E along his beat passes it on his right, never looking round at it)
          && quietRoute(D, [], { mode: 'crawl', from: LURK24, delay: d + tWalk + 0.5, hold: 18, margin: S_MARGIN, except: [e24], why });
      };
      await atMoment(D, 'greenberet', AT, okAt, S1, { box: 5, hold: 14, grace: 12, crawlPad: 5, exact: 1.5, label: 'GB → the barracks\' S corner (e24)' });
      await D.stance('greenberet', 'stand');
      await D.path('greenberet', toLurk, { tol: 0.4, max: 30 });
      await D.stance('greenberet', 'crawl');
      // (a halt the knife cannot take — a glance off the forecast — he lies on for the next: at the hut's corner nobody
      // looks, e24 walking his beat passes it on his right)
      for (let k = 0; ; k++) {
        await D.until(() => e24.brain?.atWait && e24.x > 64, 45, 'e24 halts at the E end of his beat');
        try { await knife(D, e24, { maxSec: 3, quiet: 6, after: 'crawl', label: 'at his E halt', reach: 6.2, ahead: 1.6, margin: S_MARGIN }); break; } catch (err) { if (!/timeout/.test(err.message) || k >= 1) throw err; }
        D.log(`  e24: not this halt (t=${D.t.toFixed(1)}); the next`);
        await D.until(() => !e24.brain?.atWait, 10, 'e24 walks on');
      }
      // (e22 is gone: the body round the hut's N corner the game's own way, the short one)
      await carryWhenClear(D, e24, E24_BODY, [], { maxWait: 200, gate: () => backTurned(D, 'e19', 0, 14, 112), except: [D.get('e19')] });
      await D.stance('greenberet', 'crawl');
      D.checkpoint('F4 the Green Beret knifes e24 at the E end of his beat and hides him in the hut\'s lee');
    }],
  ])],
  ['G', 'The gate', stage([
    ['G3', async (D) => {
      // the gate's rear pair stand in the arch looking S down the bridge: from the pocket E of the gatehouse's tower round
      // into the arch's N mouth, the knife for s25b from behind, then s25a (neither looks at the other), and both bodies
      // into the pocket (with e7 gone from the wall above nobody looks in there)
      // (e24, left to his beat, looks into the arch and the pocket only as he turns away W from the E end of his beat —
      // the planner's halted heads are wider than that: he is kept from that end for as long as the bodies lie there)
      const sa = D.get('s25a'), sb = D.get('s25b'), gb = D.c('greenberet'), e24 = D.get('e24');
      const way = wayOf(D, 'greenberet', [gb.x, gb.z], SB_BACK), tWay = 1.0 + pathLen([gb.x, gb.z], way) / CONFIG.units.walk;
      await untilA(D, async () => { const why = []; return (awayFrom(D, 'e24', [66, 96], 1.2, 0, tWay + 20) || dbg(D, ['e24 at his E halt'], 'to the gate pair'))
        && ((await qrA(D, way, { mode: 'walk', from: [gb.x, gb.z], speed: CONFIG.units.walk, delay: 1.0, slack: 0.8, hold: 2, why, margin: S_MARGIN, except: [e24] })
        && await qrA(D, [SA_BACK], { mode: 'walk', from: [sb.x, sb.z], speed: CONFIG.units.walk, delay: tWay + 2, hold: 4, slack: 0.8, why, margin: S_MARGIN, except: [sb, e24] })
        // (s25b lies in the arch through s25a's knife and carry and his own pick-up — some 40 s in the game; Patrol 26's
        // round comes through the arch: in a run it came on him lying there while the carries waited on it)
        && await qrA(D, [], { mode: 'body', from: [sb.x, sb.z], delay: tWay + 1.5, hold: 55, why, margin: S_MARGIN, except: [sb, sa, e24] })) || dbg(D, why, 'to the gate pair')); }, 900, 'the way to the gate pair unwatched');
      await D.stance('greenberet', 'stand');
      await D.path('greenberet', way, { tol: 0.4, max: 30 });
      await knife(D, sb, { maxSec: 4, quiet: 6, after: null, label: 'in the arch', reach: 3.4, ahead: 1.2, later: [sa] });
      await D.go('greenberet', ...SA_BACK, { tol: 0.4, max: 8 });
      await knife(D, sa, { maxSec: 6, quiet: 6, after: 'crawl', label: 'in the arch', reach: 3.4, ahead: 1.2 });
      for (const [e, spot] of [[sa, GATE_BODY[0]], [sb, GATE_BODY[1]]]) {
        await carryWhenClear(D, e, spot, [[58, 110.4], [62.6, 110.7]], { maxWait: 200, label: 'from the arch', except: [e24], gate: () => awayFrom(D, 'e24', [66, 96], 1.2, 0, 12) });
        await D.stance('greenberet', 'crawl');
      }
      D.checkpoint('G3 the Green Beret knifes the gate\'s rear pair in the arch and hides them behind the gatehouse tower');
    }],
  ])],
  ['H', 'Round the castle', stage([
    ['H1', async (D) => {
      // the Sapper and the Driver the same way round the S field, to the moat's W bank by the gate's bridge (the front
      // pair beyond the bridge look out over the meadow, S: the bank behind their shoulders is out of their sight)
      for (const role of ['sapper', 'driver']) {
        await fieldCrawl(D, role, [...S_FIELD.slice(0, -2), [20, 140], [24, 126], role === 'sapper' ? BANK_W[0] : BANK_W[1]]);
        D.log(`  ${role} at the W bank t=${D.t.toFixed(1)}`);
      }
      D.checkpoint('H1 the Sapper and the Driver crawl round the south field to the moat\'s west bank by the gate');
    }],
    ['H2', async (D) => {
      // the Marine round to the SW corner of the meadow and the Spy S from his rock to it: there they wait for the tank;
      // the Sniper to the moat's bank with the Sapper and the Driver (he goes in with them)
      await fieldCrawl(D, 'diver', [...S_FIELD.slice(0, -2), PICKUP[0]]);
      await crawl(D, 'spy', ...PICKUP[1], { box: 8, hold: 3, crawlPad: 5, label: 'Spy to the SW corner' });
      await crawl(D, 'sniper', ...BANK_W[2], { box: 8, hold: 3, crawlPad: 5, label: 'Sniper to the moat\'s W bank' });
      D.checkpoint('H2 the Marine and the Spy lie low in the SW corner of the meadow; the Sniper joins the others on the moat\'s bank');
    }],
  ])],
  ['I', 'Through the gate', stage([
    ['I1', async (D) => {
      // the Sapper, the Driver and the Sniper in file along the moat's bank, over the bridge behind the front pair's
      // backs and through the arch (the rear pair lie behind the tower), past the Green Beret's pocket and along the wall
      // behind the hut — the three together, a few seconds apart, once the whole file's way is unwatched for as long
      // as it takes them (Patrol 26 well away): the first goes furthest along the wall
      const file = [['sapper', POCKET[2]], ['driver', POCKET[1]], ['sniper', POCKET[0]]].map(([role, spot]) => [role, [...INTO, spot]]);
      await untilA(D, async () => {
        const why = [];
        if (!farFrom(D, P26, INTO.slice(0, 6), 75 + FILE_GAP * 2, 26)) return dbg(D, ['Patrol 26 near'], 'the file in');
        for (const [n, [role, way]] of file.entries()) {
          const u = D.c(role);
          if (!await qrA(D, way, { mode: 'crawl', from: [u.x, u.z], speed: 0.8, delay: n * FILE_GAP, hold: 6, why, margin: [6, 0.5] })) return dbg(D, why, `the file in (${role})`);
        }
        return true;
      }, 900, 'the way in unwatched for the file (Patrol 26 well away)');
      await pathFile(D, file, { gap: FILE_GAP, tol: 0.45, max: 120 });
      D.log(`  the file in t=${D.t.toFixed(1)}`);
      D.checkpoint('I1 the Sapper, the Driver and the Sniper cross the bridge and slip through the gate into the court');
    }],
  ])],
  ['J', 'The north range roof', stage([
    ['J1', async (D) => {
      // the Green Beret back the way he came — round the barracks, past the gatehouse's foot, up the quarter's stairs, over
      // the W bastion terrace and up to the NW terrace — to the foot of the stairs up to the N range roof
      const gb = D.c('greenberet');
      // (with the Sniper and the Sapper, who go up from the yard later, in one file: the Sniper first from the pocket,
      // the Sapper behind him, the Green Beret from the gate's pocket last at the barracks' E end)
      await roundBarracks(D, 'greenberet', [[62.6, 110.7], [66, 104.9], [73, 103.7], ...F_BACK], 'GB');
      await untilA(D, async () => { const why = []; return await qrA(D, [S_GW_FOOT, S_GW_UP[1]], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 2, why, margin: [3, 0.2] }) || dbg(D, why, 'up the stairs'); }, 300, 'the stairs unwatched');
      D.order('greenberet', { type: 'move', x: S_GW_TOP[0], z: S_GW_TOP[1] });
      await D.until(() => !gb.path && !gb.isMoving && (gb.y || 0) > 3.5, 40, 'GB up the stairs');
      await D.path('greenberet', [[64, 60], [61, 52], S_NW1_FOOT], { tol: 0.4, max: 40 });
      D.order('greenberet', { type: 'move', x: S_NW1_TOP[0] - 1, z: S_NW1_TOP[1] });
      await D.until(() => !gb.path && !gb.isMoving && Math.abs((gb.y || 0) - 7) < 0.3, 40, 'GB up on the NW terrace');
      await crawl(D, 'greenberet', ...NW_WAIT, { box: 6, hold: 4, label: 'GB to the NW terrace\'s W side' });
      D.checkpoint('J1 the Green Beret goes back up to the NW terrace');
    }],
    ['J2', async (D) => {
      // the Sniper the Green Beret's way round the barracks and up the quarter's stairs, onto the W bastion terrace: from
      // there (4 m up, lying down nobody below sees him, too far for the N court's men to make him out kneeling) he
      // covers the N range roof
      const sn = D.c('sniper');
      await roundBarracks(D, 'sniper', [[74, 115.6], [77.5, 113.5], LEE, ...F_BACK], 'Sniper');
      await untilA(D, async () => { const why = []; return await qrA(D, [S_GW_FOOT, S_GW_UP[1]], { mode: 'crawl', from: [sn.x, sn.z], speed: 0.8, hold: 2, why, margin: [3, 0.2] }) || dbg(D, why, 'Sniper up the stairs'); }, 300, 'the stairs unwatched');
      D.order('sniper', { type: 'move', x: S_GW_TOP[0], z: S_GW_TOP[1] });
      await D.until(() => !sn.path && !sn.isMoving && (sn.y || 0) > 3.5, 40, 'Sniper up the stairs');
      await D.path('sniper', [[64, 60], [61, 52], SNIPE66], { tol: 0.4, max: 40 });
      D.checkpoint('J2 the Sniper crawls round and up onto the W bastion terrace');
    }],
    ['J3', async (D) => {
      // e67 walks the N range roof and halts at each end looking S over the N court; e66 at the N Flak looks S, his head
      // swinging W along the roof at the end of its sweep; the AT gunner e55 down in the court looks N at the roof's W
      // half now and then. Up the stairs as e67 heads off E, and along the roof's N edge, flat, behind him (beyond his
      // glances and everyone else's eyes); as e67 comes back to his W halt, up behind him on his belly (from the court
      // below nobody sees a man lying on the roof) and the knife; at once the Sniper's shot
      // for e66 (both bodies lie on the roof, out of sight from below)
      const e67 = D.get('e67'), e66 = D.get('e66'), gb = D.c('greenberet'), sn = D.c('sniper');
      await untilA(D, async () => { const why = []; return (!e67.brain?.atWait && Math.cos(e67.heading) > 0.8 && e67.x > 64 && e67.x < 72
        && await qrA(D, [S_N3_FOOT, S_N3_TOP, [52, 15], LURK67], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 4, why, margin: [3, 0.3] })) || dbg(D, why, 'up to the roof'); }, 600, 'e67 walks away E');
      D.order('greenberet', { type: 'move', x: S_N3_FOOT[0], z: S_N3_FOOT[1] });
      await D.until(() => !gb.path && !gb.isMoving, 30, 'GB at the foot of the stairs');
      D.order('greenberet', { type: 'move', x: S_N3_TOP[0], z: S_N3_TOP[1] });
      await D.until(() => !gb.path && !gb.isMoving && Math.abs((gb.y || 0) - 10) < 0.3, 30, 'GB on the N range roof');
      await D.path('greenberet', [[52, 15], LURK67], { tol: 0.4, max: 40 });
      // (when e67 is two strides from his W halt: the walk up behind him, the knife, his body and the Sniper's kneel all
      // out of everyone's sight — e55's head and e66's swing — for as long as they take)
      await untilA(D, async () => { const why = []; return (!e67.brain?.atWait && Math.cos(e67.heading) < -0.8 && e67.x < 70 && e67.x > 68.5
        && ABILITIES.sniper.canUse(sn, e66, D.world) === true
        && await qrA(D, [E67_BACK], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 6, why, margin: [6, 0.5], except: [e67] })
        && await qrA(D, [], { mode: 'body', from: [60, 26.3], delay: 12, hold: 8, why, margin: [5, 0.4], except: [e67] })) || dbg(D, why, 'behind e67'); }, 600, 'e67 heads back to his W halt, nobody to see');
      D.order('greenberet', { type: 'move', x: E67_BACK[0], z: E67_BACK[1] });
      await D.until(() => e67.brain?.atWait && e67.x < 61, 20, 'e67 at his W halt');
      await D.until(() => !gb.path && !gb.isMoving, 15, 'GB behind e67');
      await knife(D, e67, { maxSec: 5, quiet: 6, after: 'crawl', label: 'at the W end of the roof', reach: 3.4, ahead: 2.4, later: [e66], walkUp: false }); // (his way up behind e67 checked above, held 6 s)
      // (e66 never makes out e67's body that far along the roof; the shot once nobody sees the Sniper kneel, nor e66
      // drop — e44 on the NE wall sees as far as the Flak only while his sweep is near its middle)
      await untilA(D, async () => { const why = []; return (await qrA(D, [], { mode: 'walk', from: [sn.x, sn.z], delay: 0, hold: 2.4, why, margin: [5, 0.4], except: [e66] })
        && await qrA(D, [], { mode: 'walk', from: [e66.x, e66.z], delay: 0.4, hold: 1.8, why, margin: [5, 0.4], except: [e66] })) || dbg(D, why, 'the shot'); }, 90, 'nobody to see the Sniper kneel or e66 fall');
      D.ability('sniper', 'sniper', e66);
      await D.until(() => !e66.alive, 6, 'e66 shot');
      await D.idle('sniper', 5);
      await D.stance('sniper', 'crawl');
      D.checkpoint('J3 the Green Beret knifes e67 at the W end of the N range roof and the Sniper shoots e66 at the N Flak');
    }],
  ])],
  ['K', 'The charge', stage([
    ['K1', async (D) => {
      // the Sapper the same way round and up onto the W bastion terrace
      const sa = D.c('sapper');
      await roundBarracks(D, 'sapper', [[74, 115.6], [77.5, 113.5], LEE, ...F_BACK], 'Sapper');
      await untilA(D, async () => { const why = []; return await qrA(D, [S_GW_FOOT, S_GW_UP[1]], { mode: 'crawl', from: [sa.x, sa.z], speed: 0.8, hold: 2, why, margin: [3, 0.2] }) || dbg(D, why, 'Sapper up the stairs'); }, 300, 'the stairs unwatched');
      D.order('sapper', { type: 'move', x: S_GW_TOP[0], z: S_GW_TOP[1] });
      await D.until(() => !sa.path && !sa.isMoving && (sa.y || 0) > 3.5, 40, 'Sapper up the stairs');
      await D.path('sapper', [[64, 60], [61, 52], S_NW1_FOOT], { tol: 0.4, max: 40 });
      D.checkpoint('K1 the Sapper crawls round and up onto the W bastion terrace');
    }],
    ['K2', async (D) => {
      // up to the NW terrace and the HQ terrace by the stairs at the Flak, along its E edge (out of the turret guard's
      // sight) into the turret's blind corner against the château: the remote charge there, and back down
      const sa = D.c('sapper');
      D.order('sapper', { type: 'move', x: S_NW1_TOP[0] - 1, z: S_NW1_TOP[1] });
      await D.until(() => !sa.path && !sa.isMoving && Math.abs((sa.y || 0) - 7) < 0.3, 40, 'Sapper on the NW terrace');
      await D.path('sapper', [[50, 60], [44, 66.5], S_NW2_FOOT], { tol: 0.4, max: 60 });
      await untilA(D, async () => { const why = []; return await qrA(D, [S_NW2_TOP, [37, 58], [36.8, 54.5], HQ_BOMB], { mode: 'crawl', from: [sa.x, sa.z], speed: 0.8, hold: 4, why, margin: [4, 0.4] }) || dbg(D, why, 'Sapper to the HQ'); }, 300, 'the way to the turret\'s blind corner unwatched');
      D.order('sapper', { type: 'move', x: S_NW2_TOP[0], z: S_NW2_TOP[1] });
      await D.until(() => !sa.path && !sa.isMoving && Math.abs((sa.y || 0) - 13) < 0.3, 40, 'Sapper on the HQ terrace');
      await D.path('sapper', [[37, 58], [36.8, 54.5], HQ_BOMB], { tol: 0.35, max: 40 });
      await untilA(D, async () => { const why = []; return await qrA(D, [], { mode: 'walk', from: [sa.x, sa.z], delay: 0, hold: 2.5, why, margin: [4, 0.4] }) || dbg(D, why, 'the charge'); }, 120, 'nobody to see the charge set');
      D.ability('sapper', 'remoteBomb');
      await D.until(() => D.world.interactables.some((i) => i.interactKind === 'bomb' && i.placed && i.planter === sa), 6, 'charge set');
      await D.idle('sapper', 4);
      await D.stance('sapper', 'crawl');
      await D.path('sapper', [[36.8, 54.5], [37, 58], S_NW2_TOP], { tol: 0.4, max: 40 });
      D.order('sapper', { type: 'move', x: S_NW2_FOOT[0], z: S_NW2_FOOT[1] });
      await D.until(() => !sa.path && !sa.isMoving && Math.abs((sa.y || 0) - 7) < 0.3, 40, 'Sapper back on the NW terrace');
      D.checkpoint('K2 the Sapper sets his remote charge in the turret\'s blind corner against the headquarters');
    }],
  ])],
  ['L', 'Patrol 57', stage([
    ['L1', async (D) => {
      // the Green Beret back down from the N range roof, over the W bastion terrace and down the quarter's stairs into
      // the yard; the Sapper follows from the NW terrace
      const gb = D.c('greenberet'), sa = D.c('sapper');
      await untilA(D, async () => { const why = []; return await qrA(D, [S_N3_TOP, S_N3_FOOT], { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, hold: 3, why, margin: [3, 0.3] }) || dbg(D, why, 'GB down from the roof'); }, 300, 'the N range stairs unwatched');
      await D.path('greenberet', [[52, 16], [47.5, 18], S_N3_TOP], { tol: 0.4, max: 60 });
      D.order('greenberet', { type: 'move', x: S_N3_FOOT[0], z: S_N3_FOOT[1] });
      await D.until(() => !gb.path && !gb.isMoving && Math.abs((gb.y || 0) - 7) < 0.3, 30, 'GB on the NW terrace');
      for (const role of ['greenberet', 'sapper']) {
        const u = D.c(role);
        await D.path(role, [[50, 46], S_NW1_TOP], { tol: 0.4, max: 60 });
        D.order(role, { type: 'move', x: S_NW1_FOOT[0], z: S_NW1_FOOT[1] });
        await D.until(() => !u.path && !u.isMoving && Math.abs((u.y || 0) - 4) < 0.3, 40, `${role} on the W bastion terrace`);
        await D.path(role, [[61, 52], [64, 60], S_GW_TOP], { tol: 0.4, max: 40 });
        await downAndThrough(D, role, YARD_WAIT[role === 'greenberet' ? 0 : 1]);
      }
      D.checkpoint('L1 the Green Beret and the Sapper come back down into the yard under the W bastion');
    }],
    ['L2', async (D) => {
      // the Driver from the pocket by the S wall the Green Beret's way round the barracks to the yard
      await roundBarracks(D, 'driver', [[74, 115.6], [77.5, 113.5], LEE, ...F_BACK], 'Driver');
      await D.path('driver', [YARD_WAIT[2]], { tol: 0.5, max: 30 });
      D.checkpoint('L2 the Driver crawls round to the yard');
    }],
    ['L3', async (D) => {
      // Patrol 57 walks the N court's W strip, through the gatehouse's tunnel and along the flak court: it would find
      // the AT gunner's body. The Green Beret takes his decoy to the flak court, a few steps off the patrol's way, and back
      const gb = D.c('greenberet');
      // (he sets it down lying flat, as he crawled there — the plant never lifts him off his belly — and he gets there
      // only when he can lie there long enough to set it and crawl off: e53's beat comes down the court's E side round
      // the trailers, and from his S halt his sweep takes in the spot. In the game he once lay there waiting, and e53
      // walked down onto him)
      const memo = new Map();
      let memoT = -1;
      const dropOk = (gx, gz, t) => {
        if (memoT !== D.t) { memo.clear(); memoT = D.t; } // (a plan's answers, as the walkers stand now)
        const k = Math.round((t - D.t) * 10);
        if (!memo.has(k)) memo.set(k, quietRoute(D, [], { mode: 'crawl', from: DECOY_FC, delay: k / 10, hold: 12, margin: [4, 0.4] }));
        return memo.get(k);
      };
      // (Patrol 26's file walks round the barracks' N side looking up the flak court as his way crosses it: in the game
      // its last man made him out at the very edge of his near band — the planner forecasts a file man by his leader's
      // step, off it round a corner: his plans keep 22 m off each of the four, there and back)
      const K26 = { p26: 22, p26b: 22, p26c: 22, p26d: 22 };
      for (const [x, z] of [[59.6, 78.8], [66, 76], [73, 73.5], [80, 78.5]]) await crawl(D, 'greenberet', x, z, { box: 5, hold: 4, crawlPad: 5, keepFrom: K26, label: `GB → (${x},${z})` });
      await crawl(D, 'greenberet', ...DECOY_FC, { box: 5, hold: 4, crawlPad: 5, goalOk: dropOk, keepFrom: K26, label: 'GB → the decoy\'s spot' });
      await untilA(D, async () => { const why = []; return await qrA(D, [], { mode: 'crawl', from: [gb.x, gb.z], delay: 0, hold: 2.2, why, margin: [4, 0.4] }) || dbg(D, why, 'the decoy'); }, 10, 'nobody to see the decoy set down');
      D.ability('greenberet', 'decoyDrop');
      await D.idle('greenberet', 3);
      await D.stance('greenberet', 'crawl');
      for (const [x, z] of [[80, 78.5], [73, 73.5], [66, 76], [59.6, 78.8], YARD_WAIT[0]]) await crawl(D, 'greenberet', x, z, { box: 5, hold: 4, crawlPad: 5, keepFrom: K26, label: `GB → (${x},${z})` });
      D.checkpoint('L3 the Green Beret leaves his decoy in the flak court, off Patrol 57\'s way, and crawls back to the yard');
    }],
    ['L4', async (D) => {
      // the decoy beeps as the patrol walks by: the three go over and stare at it, their backs to the gatehouse
      const p57 = D.get('p57');
      const dc = D.world.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
      await D.until(() => !p57.brain?.atWait && Math.hypot(p57.x - dc.x, p57.z - dc.z) < 12 && p57.x > 77, 300, 'Patrol 57 in earshot of the decoy');
      D.ability('greenberet', 'decoyToggle');
      // (the sergeant stares at it; his two men halt in file behind him, looking the same way)
      await D.until(() => p57.brain?.state === 'DECOY' && p57.brain.phase === 'stare' && ['p57b', 'p57c'].every((t) => { const e = D.get(t); return !e.path && !e.isMoving; }), 60, 'Patrol 57 stares at the decoy');
      D.checkpoint('L4 the decoy beeps: Patrol 57 walks over to it and stares');
    }],
  ])],
  ['M', 'The tank', stage([
    ['M1', async (D) => {
      // the AT gunner e55 watches the tank from his gun: from the W bastion terrace the Sniper takes him, when nobody
      // sees him kneel nor e55 drop (the gun's sandbags hide the body from all but the patrol, which stares at the decoy)
      const e55 = D.get('e55'), sn = D.c('sniper');
      await untilA(D, async () => {
        const why = [];
        if (ABILITIES.sniper.canUse(sn, e55, D.world) !== true) return dbg(D, ['rifle'], 'e55');
        if (!await qrA(D, [], { mode: 'walk', from: [sn.x, sn.z], delay: 0, hold: 2.4, why, margin: [5, 0.4], except: [e55] })) return dbg(D, why, 'e55');
        if (!await qrA(D, [], { mode: 'walk', from: [e55.x, e55.z], delay: 0.4, hold: 1.8, why, margin: [5, 0.4], except: [e55] })) return dbg(D, why, 'e55 falls');
        const f = await bsA(D, e55.x, e55.z, 240, { except: [e55] });
        return !f.length || dbg(D, [`body seen by ${f.join(',')}`], 'e55');
      }, 300, 'nobody to see the AT gunner shot');
      D.ability('sniper', 'sniper', e55);
      await D.until(() => !e55.alive, 6, 'e55 shot');
      await D.idle('sniper', 5);
      await D.stance('sniper', 'crawl');
      D.checkpoint('M1 the Sniper shoots the AT gunner e55 from the W bastion terrace');
    }],
    ['M2', async (D) => {
      // the Sniper down to the yard by the roof and the stairs
      await D.path('sniper', [[61, 52], [64, 60], S_GW_TOP], { tol: 0.4, max: 40 });
      await downAndThrough(D, 'sniper', YARD_WAIT[3]);
      D.checkpoint('M2 the Sniper comes down to the yard');
    }],
    ['M3', async (D) => { await boardTank(D, 'driver', 'the Driver'); D.checkpoint('M3 the Driver crawls through the gatehouse\'s tunnel to the tank and climbs in unseen'); }],
    ['M4', async (D) => { await boardTank(D, 'sapper', 'the Sapper'); D.checkpoint('M4 the Sapper crawls the same way and climbs in by the N hatch'); }],
    ['M5', async (D) => { await boardTank(D, 'greenberet', 'the Green Beret'); D.checkpoint('M5 the Green Beret climbs in by the S hatch'); }],
    ['M6', async (D) => { await boardTank(D, 'sniper', 'the Sniper'); D.checkpoint('M6 the Sniper climbs in last, by the N hatch'); }],
    ['M7', async (D) => {
      // the Sapper fires his charge from inside: the headquarters goes up and the whole castle wakes (the one alarm —
      // no charge goes off unheard); the tank's gun takes the two rockets on their trailers
      const tank = tankOf(D), hq = D.world.byId('hq');
      D.ability('sapper', 'detonate');
      await D.until(() => hq.destroyed, 10, 'the headquarters destroyed');
      D.checkpoint('M7 the Sapper fires his charge: the headquarters goes up');
    }],
    ['M8', async (D) => {
      for (const id of V2_IDS) {
        const v = D.world.byId(id);
        await D.until(() => { if (v.destroyed) return true; try { D.ability('driver', 'vehicleFire', v); } catch { /* reloading */ } return false; }, 40, `${id} shelled`);
      }
      D.checkpoint('M8 the tank\'s gun destroys both V2 rockets');
    }],
    ['M9', async (D) => {
      // out through the tunnel, across the S courts and into the SW gate's mouth; the gun clears the front pair's man in
      // its way off the bridge's far end; through the arch and over the bridge, down the road to the meadow's SW corner where
      // the Spy and the Marine wait; they climb in; off the map
      const tank = tankOf(D);
      await drive(D, tank, TANK_OUT);
      // (the castle is up: men come at the tank. One in the way of its slow turns would have to step aside, and would know
      // it for the enemy's: from here its gun takes every man near it before each move)
      for (const pt of TANK_GATE) { await clearAround(D, tank); await drive(D, tank, [pt], { stop: true }); }
      // into the mouth, then through the arch and over the bridge in one straight run — the click a player finds with
      // the drive cursor (bridgeClick); none from where it stands (the turn it would take there leaves it off the axis):
      // back out and into the mouth again at the next spot
      let run = null;
      for (const m0 of GATE_MOUTHS) {
        await clearAround(D, tank);
        // (the mouth click whose stop leaves a straight run through the arch: mouthClick looks ahead; none, the next spot)
        const m = mouthClick(tank)?.[0] ?? m0;
        await drive(D, tank, [m], { stop: true });
        if ((run = bridgeClick(tank))) break;
        D.log(`  the tank at the mouth (${tank.x.toFixed(2)},${tank.z.toFixed(2)}) h${Math.round((tank.heading * 180) / Math.PI)}: no straight run through the arch; out and in again`);
        await drive(D, tank, [TANK_GATE[TANK_GATE.length - 1]], { stop: true });
      }
      if (!run) throw new Error('the tank finds no straight run through the SW gate');
      // (from the mouth the gun clears the bridge's far end: s25c of the front pair stands where the tank must pass, and a
      // man stepping out of its way would know it for the enemy's; s25d, E of its way, is out of the arch's line of fire)
      const s25c = D.get('s25c');
      await D.until(() => { if (!s25c.alive) return true; try { D.ability('driver', 'vehicleFire', s25c); } catch { /* reloading */ } return false; }, 30, 's25c shot from the tank');
      await clearAround(D, tank);
      await drive(D, tank, [run], { stop: true });
      await drive(D, tank, TANK_ROAD);
      for (const role of ['spy', 'diver']) {
        D.ability(role, 'enterVehicle', tank);
        await D.until(() => D.c(role).vehicle === tank, 25, `${role} in the tank`);
      }
      // (off the map: the run ends the tick the game reports the win — a live walkthrough stops there; the objectives'
      // wait is tried every tick, not ten times a second)
      D.order('driver', { type: 'move', x: EXIT_AT[0], z: EXIT_AT[1] });
      await D.untilAsync(async () => D.world.objectives.every((o) => o.done), 90, 'mission complete');
      D.checkpoint('M9 all six in the tank: out through the south-west gate and away');
    }],
  ])],
];

export async function solve(D, ctx = {}) {
  // (every wait's condition is tried ten times a second, not every tick: the sight checks behind most of them are
  // costly, and a tenth of a second is well inside their margins — a player's reaction is slower)
  if (!D._m20Throttle) {
    D._m20Throttle = true;
    const until0 = D.until.bind(D);
    D.until = (pred, maxSec, label) => {
      let next = -Infinity;
      return until0(() => { if (D.t + 1e-9 < next) return false; next = D.t + 0.1; return pred(); }, maxSec, label);
    };
  }
  // (a sneak's plan walked as the fewest straight legs at the man's own pace, halting only where he must wait for a gap
  // in the cones — dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  // (walkers are predicted along the pathfinder's way round the huts, not straight between their route points)
  D.world.sneakPaths = true;
  // (…and along the way their own move orders plan, round the clearance of what the game draws: a wagon, a gun)
  D.world.sneakOwnPaths = true;
  // (a wait in a crawl is looked at again every second, the walkers as they walk now)
  D.world.sneakRecheck = 1;
  // (and with no shelter near, one farther off rather than lying on in a patrol's way)
  D.world.sneakFlee = true;
  // (the S corner's pair turn to each other every 25 s: their glances count when bodies and men are checked)
  D.world.sneakGlances = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
