/**
 * LIGHTS OUT e05 "Cold Iron" (Hammerø fort): a full stealth solution, played only with player orders
 * (docs/expansion/e05.md §11, as built). Driver API: tools/solutions/driver.mjs; sneaking helpers:
 * tools/solutions/sneak.mjs. Headless:
 *   node tools/solutions/run-headless.mjs e05 [--easy] [--until X]
 * Reference run in the real game: tests/e05-solution.test.mjs. Walkthrough: e05.walkthrough.mjs.
 *
 * Every knock-out is from behind and unwitnessed, every man knocked out is cuffed (he would wake in 30 s, and a bound
 * man seen is freed and both shout), and no commando is ever inside a live cone (the driver's exposure watch). Wins
 * with every objective done, 0 detections and 0 exposures, on Hard and on Easy.
 *
 * Outline:
 *   A  the harbour: the Green Beret and the Spy along the shore under the glacis to the back of the harbour magazine;
 *      (Hard) the Spy chloroforms the north quay's walker hq3 at his west end; the GB knocks out the magazine's door
 *      sentry mq1; both cuffed and carried into the magazine; GB and Spy ride the ammunition hoist up
 *   B  the hoist house: (Hard) the door sentry cs1 from behind; the lane walker y2 at the SE corner, cuffed and worked
 *      on strings: he opens the radio casemate's iron door, which opens only to the garrison; the two operators at
 *      their receivers; the call-sign book (o3)
 *   C  the bridge keeper in his switch room (its door on the alley by the hoist house): cuffed, on strings, he works
 *      the switch and the drawbridge rises against the camp on the glacis (o4)
 *   D  along the south yard behind the gate's men to the Gestapo office: the two black coats at its door from their
 *      blind side, the Kriminalrat at his desk (the burn script loses its actor); Grethe joins (o2)
 *   E  the adjutant at the guardroom: knocked out from behind, the Spy takes his tunic with the hanger and puts it on
 *   F  the commandant's house: the Spy, an officer now, walks in; chloroform at the desk; the card index (o1)
 *   G  out: back along the south yard to the hoist house, down to the harbour, along the shore to the folboats (o5)
 */
import { sneak, routeClear, routeClearGen, clearFor, clearForGen, unwitnessed, bodySeen, bodySeenGen, predict, walking, viewersOf, walkerSees, staticSees, wheeling, dummyAt } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { mirrorOf, ghostOn, mirrorScope } from './ghost.mjs';
import { viewerRank } from '../../src/ai/bcd-ranks.js';
import { CONFIG } from '../../src/config.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const DBG = !!globalThis.process?.env?.E05DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.E05STOP;

const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const hard = (D) => !!D.get('cs1');

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 40 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

/** A predicate: `e` has stood halted within `r` m of (x, z) for at least `sec` s (he has turned to his halt's look). */
function haltedFor(D, e, x, z, sec, r = 0.7) {
  let since = null;
  return () => {
    if (!e?.alive || e.ko) return false;
    const at = Math.hypot(e.x - x, e.z - z) < r && e.brain?.atWait;
    if (!at) { since = null; return false; }
    if (since == null) since = D.t;
    return D.t - since >= sec;
  };
}

/** Does `e` (now and over the next `ahead` s, as predicted) have the man `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world, me = mirrorOf(e);
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = ghostOn(me); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, seeOpts(w, coneAt(g, w.time + t))) !== 'none') return true;
  }
  return false;
}

/**
 * A halted `victim` (his heading fixed, his head sweeping) will not see the man walking the windows `win` (strikeWindows:
 * each point with the earliest and the latest moment he may be there, ± `slack` s), in his exact cone at each moment (no
 * planner padding); and the halt lasts until he can have arrived and struck.
 */
function victimBlind(D, victim, win, slack = 0.4) {
  const w = D.world, me = mirrorOf(victim), g = ghostOn(me);
  g.x = victim.x; g.z = victim.z; g.heading = victim.heading;
  const test = (x, z, tt) => canSee(g, { x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, w, seeOpts(w, coneAt(g, w.time + tt))) === 'none';
  for (const [x, z, t0, t1] of win) for (let t = Math.max(0, t0 - slack); t <= t1 + slack + 1e-6; t += 0.2) if (!test(x, z, t)) return false;
  return (victim.brain?.waitT ?? 0) > win.arrive + 1.6;
}

/** A player's hesitation before a click (the --jitter probe: 0–0.6 s, evenly, before each D.go). */
const CLICK_LAG = 0.6;
/** How late `n` clicks may put him, all told: each hesitates up to CLICK_LAG, the sum within two standard deviations of
 * its mean (n × 0.3 ± 2 × 0.17 √n s), never more than every click at its longest. */
const lagOf = (n) => (n > 0 ? Math.min(CLICK_LAG * n, (CLICK_LAG / 2) * n + 2 * (CLICK_LAG / Math.sqrt(12)) * Math.sqrt(n)) : 0);
/** The slowest a man on his feet is reckoned to walk a planned way (2.25 m/s on the flat: the turns at bends). */
const WALK_SLOW = 2.05;
/** The way `u` will go from `from` through the clicks `pts` in `stance` (plannedWay, planned as he will be then). */
function wayAs(u, stance, from, pts) {
  const s = u.stance;
  u.stance = stance;
  try { return plannedWay(u, from, pts); } finally { u.stance = s; }
}
/**
 * The places and moments (s from now) of a walk of `u` from `from` through `clicks`, along the way each click really
 * plans in `stance`: after `up` s, at `speed` at the earliest; at `slow` and as late as the hesitations of the first
 * `lagged` clicks given so far put him at the latest (lagOf: a D.go hesitates before its order; a strike's last order
 * goes at once).
 * → [[x, z, t0, t1], …], points ≤ `step` m apart, the start (`up` and the first hesitation) and the end (`hold` s on
 * from the earliest arrival to the latest) included; `.arrive` is the latest arrival.
 */
function walkWindows(u, from, clicks, { stance = 'stand', speed = CONFIG.units.walk, slow = WALK_SLOW, up = 0, upLate = up, lagged = clicks.length, hold = 0, step = 0.4 } = {}) {
  const out = [];
  let [x, z] = from, s = 0;
  // (`upLate`: the latest he sets off — after a walk of its own, judged by its own windows)
  out.push([x, z, 0, upLate + lagOf(Math.min(1, lagged))]);
  clicks.forEach(([tx, tz], i) => {
    const lag = lagOf(Math.min(i + 1, lagged));
    let [px, pz] = [x, z];
    for (const [qx, qz] of wayAs(u, stance, [x, z], [[tx, tz]])) {
      const L = Math.hypot(qx - px, qz - pz), n = Math.max(1, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) out.push([px + ((qx - px) * k) / n, pz + ((qz - pz) * k) / n, up + (s + (L * k) / n) / speed, upLate + (s + (L * k) / n) / slow + lag]);
      s += L; px = qx; pz = qz;
    }
    [x, z] = [tx, tz];
  });
  const e = out[out.length - 1];
  out.arrive = e[3];
  out.arriveEarly = e[2];
  if (hold > 0) out.push([e[0], e[1], e[2], e[3] + hold]);
  return out;
}
/**
 * A strike's walk (strike): `role` gets up where he lies (`up` s), then walks his `via` clicks (each a D.go) and the
 * last one to `at` (an order at once), and stands at the end `hold` s more. `from` {from, upLate}: he sets off from
 * another spot instead — the one he works a door from (doorStep) — standing there from `up` (the earliest moment it has
 * turned) to `upLate` and his first click's hesitation.
 */
function strikeWindows(u, via, at, up, hold, { from = null, upLate = up } = {}) {
  const win = walkWindows(u, from ?? [u.x, u.z], [...via, at], { up, upLate, lagged: via.length, hold: Math.max(hold, 0.01) });
  // (`from`: a spot he walks to and stands at first — a door's (doorStep): there from `up` on, not from now)
  if (from) win[0][2] = up;
  return win;
}
/** Nobody but `except` sees a man (`mode`) at any point of the windows `win`, at any moment of its window ± `slack`.
 * (`keepWalker`: routeClear's keep-off round a walker, its default 4 m unless given) */
function windowsClear(D, win, o = {}) { return drain(windowsClearGen(D, win, o)); }
/** windowsClear as a generator (the same answer; it yields every few looks: a sliced look hands the frame back). */
function* windowsClearGen(D, win, { slack = 0.4, mode = 'walk', why = null, except = null, keepWalker = undefined } = {}) {
  for (const [x, z, t0, t1] of win) {
    if (!(yield* routeClearGen(D, [], { mode, from: [x, z], delay: (t0 + t1) / 2, slack: (t1 - t0) / 2 + slack, why, except, ...(keepWalker != null ? { keepWalker } : {}) }))) return false;
  }
  return true;
}
/** A generator's answer, run through at once. */
function drain(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }
/**
 * The bystanders of `bystanders` (tags or men) halted on their beats whose halt outlasts every window of `win` (the
 * walk, the blow, the cuffs, the `hold`) by `spare` s: none of them can turn round before the strike is over.
 */
function haltedThrough(D, bystanders, win, spare) {
  const end = win.reduce((m, p) => Math.max(m, p[3]), 0);
  return bystanders.map((b) => (typeof b === 'string' ? D.get(b) : b))
    .filter((b) => b?.alive && !b.ko && b.brain?.atWait && (b.brain.waitT ?? 0) > end + spare);
}

const KO_ID = { greenberet: 'knockoutFist', spy: 'knockoutChloroform' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him for `ahead` s, nobody else sees the blow, and the man down lies unseen for `quiet` s (`later`: men who will be
 * down by then). With `cuff`, `cuffer` (default: the striker) cuffs him at once.
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 20, later = [], maxSec = 300, cuff = true, cuffer = null, label = '', trustVictim = false } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  // (`trustVictim`: a halted victim is judged by his exact cone alone — eyesOn — not by the planner's padded glance)
  const walkEx = trustVictim ? [victim, ...later] : later;
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `ko ${victim.tag}`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > reach) return dbg(D, [`far ${Math.hypot(victim.x - u.x, victim.z - u.z).toFixed(1)} ${role}@${u.x.toFixed(1)},${u.z.toFixed(1)} ${victim.tag}@${victim.x.toFixed(1)},${victim.z.toFixed(1)}`], `ko ${victim.tag}`);
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why, except: later })) return dbg(D, why, `ko ${victim.tag}`);
    // (the walk in: nobody, the victim included, sees him on the way; at the victim's own spot only the others)
    if (!clearFor(D, [[u.x, u.z], [(u.x * 2 + victim.x) / 3, (u.z * 2 + victim.z) / 3]], ahead + 0.6, { mode: 'walk', why, except: walkEx })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[(u.x + victim.x * 2) / 3, (u.z + victim.z * 2) / 3], [victim.x, victim.z]], ahead + 0.6, { mode: 'walk', except: [victim, ...later], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  }, maxSec, `knock out ${victim.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
  if (cuff) await cuffMan(D, cuffer ?? role, victim, { later });
  return victim;
}

/** `role` cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). */
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

/**
 * `role` shoulders the bound man `tag`, carries him along `pts` and puts him down at the last one, unseen (`also`: a
 * further test of the moment, true when it may go — the dump out of a man's eyes who is away now). The way is looked at
 * as a whole for CARRY_LOOK s, or (`precise`) each point at the moments he will be there (carryWindows), the halted
 * walkers' heads the cautious way (strictly), as a strike's `carry` judged it before the blow.
 */
async function carryMan(D, role, tag, pts, { maxWait = 180, quiet = 600, label = '', later = [], also = null, precise = false, shut = null } = {}) {
  const u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  // (one look a tick, sliced in the live replay: untilLook)
  await untilLook(D, function* look(ls) {
    why.length = 0;
    const cw = precise || shut ? carryWindows(u, [u.x, u.z], pts) : null;
    let ok;
    if (precise) { ls.set({ strict: true }); ok = yield* windowsFineGen(D, cw, { except: later, why }); ls.set({ strict: false }); }
    else ok = yield* clearForGen(D, [[u.x, u.z], ...pts], CARRY_LOOK, { mode: 'walk', why, except: later });
    if (!ok) return dbg(D, why, `carry ${e.tag}`);
    // (`shut`: the door he carries him in at, shut at once behind them: the man laid at the end and the step up to it)
    if (shut) {
      ls.set({ strict: true });
      ok = yield* shutClearGen(D, u, shut, end, cw.arriveEarly + DROP, cw.arrive + DROP + DOOR_SETTLE, { except: [e, ...later], why });
      ls.set({ strict: false });
      if (!ok) return dbg(D, why, `carry ${e.tag} (the door)`);
    }
    const f = quiet > 0 ? yield* bodySeenGen(D, end[0], end[1], quiet, { step: 1, except: [e, ...later] }) : [];
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    if (also && !also()) return dbg(D, ['the dump would be seen'], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  for (let k = 0; k < 3 && u.carrying !== e; k++) {
    D.ability(role, 'hand', e);
    await D.until(() => u.carrying === e || (!u.currentAction && !u.pendingAbility && !u.path && !u.isMoving && !((e.cigs ?? 0) > 0)), 10, `${role} at ${e.tag}`);
    await D.idle(role, 5);
  }
  if (u.carrying !== e) throw new Error(`${role} could not shoulder ${e.tag}`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${e.tag} put down`);
  await D.idle(role);
  if (shut) await door(D, role, shut, false);
}

/**
 * From a hidden spot, `role` walks to `at` (behind `victim`) once `ready()` holds and nobody, the victim included,
 * will see him on the way and while he strikes, then knocks the victim out (and cuffs him: knockOut options). The walk
 * is judged on the way his clicks really plan, at every moment he may be at each point of it (strikeWindows: walking
 * pace at the earliest, a slower pace and a hesitation at each `via` click at the latest).
 */
async function strike(D, role, victim, at, { ready = () => true, via = [], hold = 3, slack = 0.4, maxSec = 300, label = '', opens = null, strict = false, bystanders = [], carry = null, ...ko } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  // (one look a tick at a world standing still, sliced in the live replay: untilLook)
  await untilLook(D, function* look(ls) {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `strike ${victim.tag}`);
    // (`opens`: a door he opens on his way out, from where he lies — doorStep: up, the step to the spot he works it
    // from, its working — judged with it shut; from the moment it turns, everything — that spot, his hesitation there
    // before his first click, the walk and the blow — judged with it open (open, the wall walk's SE corner looks
    // straight into the house). Lying or crouched without one, he gets up where he lies and steps off from there)
    const ds = opens ? doorStep(D, u, opens) : null;
    if (ds && !(yield* windowsClearGen(D, ds.shut, { slack, why }))) return dbg(D, why, `strike ${victim.tag} (to the door)`);
    if (opens) ls.set({ open: [opens] });
    const win = ds ? strikeWindows(u, via, at, ds.at[0], hold, { from: ds.spot, upLate: ds.at[1] })
      : strikeWindows(u, via, at, u.stance === 'stand' ? 0 : CONFIG.units.stanceUp, hold);
    if (ko.trustVictim && !victimBlind(D, victim, win, slack)) return dbg(D, ['victim would see the walk'], `strike ${victim.tag}`);
    // (`bystanders`: walkers by the way — the adjutant halted at the guardroom door, 3–4 m from the office's door
    // guards. One whose halt outlasts the whole strike by 2 s cannot turn round before it is over: he is judged by his
    // cone alone, every head his sweep can give him, not by the planner's keep-off round a walker, 4 m through walls and
    // behind his back. Walking, or with his halt running out, he keeps it)
    const bys = haltedThrough(D, bystanders, win, slack + 2);
    const ex = [...(ko.later ?? []), ...(ko.trustVictim ? [victim] : []), ...bys];
    // (`strict`: a man on his feet out in the yard, where a glimpse is an exposure — the halted walkers' heads anywhere
    // their sweep and their turn onto a halt's look can put them: strictly)
    if (strict) ls.set({ strict: true });
    let ok = yield* windowsClearGen(D, win, { slack, why, except: ex });
    for (const b of bys) if (ok) ok = yield* windowsClearGen(D, win, { slack, why, except: D.world.enemies.filter((e) => e !== b), keepWalker: 0 });
    if (strict) ls.set({ strict: false });
    if (!ok) return dbg(D, why, `strike ${victim.tag}`);
    const finders = yield* bodySeenGen(D, victim.x, victim.z, (ko.quiet ?? 20) + 6, { except: [victim, ...(ko.later ?? [])] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `strike ${victim.tag}`);
    // (`carry` {pts, ok}: the carry that follows the blow, judged before it, so that he is never left standing over a
    // man he cannot carry off: the spot behind the man from his earliest arrival there, and the walk with him on the
    // shoulder, at every moment it may come — the cuffs on and carryMan's look taken CUFFED_EARLY–CUFFED_LATE s after
    // his arrival — as carryMan's `precise` look will see them; the dump by `ok`. `carry.shut`: the door he carries him
    // in at, shut at once behind them — shutClear)
    if (carry) {
      const exc = [victim, ...(ko.later ?? [])];
      const cw = carryWindows(u, at, carry.pts, win.arriveEarly + CUFFED_EARLY, win.arrive + CUFFED_LATE);
      cw[0][2] = win.arriveEarly;
      ls.set({ strict: true });
      ok = yield* windowsFineGen(D, cw, { except: exc, why, slack });
      ls.set({ strict: false });
      if (!ok) return dbg(D, why, `strike ${victim.tag} (carry)`);
      if (carry.ok && !carry.ok()) return dbg(D, ['the dump would be seen'], `strike ${victim.tag} (carry)`);
      if (carry.shut) {
        ls.set({ strict: true });
        ok = yield* shutClearGen(D, u, carry.shut, carry.pts.at(-1), cw.arriveEarly + DROP, cw.arrive + DROP + DOOR_SETTLE, { except: exc, why, slack });
        ls.set({ strict: false });
        if (!ok) return dbg(D, why, `strike ${victim.tag} (the door shut behind)`);
      }
    }
    return true;
  }, maxSec, `the moment to strike ${victim.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  if (opens) await door(D, role, opens, true);
  for (const p of via) await D.go(role, p[0], p[1], { tol: 0.5, max: 15 });
  D.order(role, { type: 'move', x: at[0], z: at[1] });
  await D.until(() => Math.hypot(u.x - at[0], u.z - at[1]) < 0.45 || (!u.path && !u.isMoving), 15, `${role} behind ${victim.tag}`);
  return knockOut(D, role, victim, { reach: 2.0, ahead: 1.2, maxSec: 6, label, ...ko });
}

/**
 * The walkable spot in the box [x0, z0]–[x1, z1] (0.5 m grid) nearest `from` where a man down would lie unseen for
 * `quiet` s, or null.
 */
function findDump(D, [x0, z0, x1, z1], from, quiet = 600, except = []) {
  const g = D.world.grid, cells = [];
  for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) if (g.walkableAt(x, z)) cells.push([x, z, Math.hypot(x - from[0], z - from[1])]);
  cells.sort((a, b) => a[2] - b[2]);
  for (const [x, z] of cells) if (!bodySeen(D, x, z, quiet, { step: 1, except }).length) return [x, z];
  return null;
}

/** Ride the hoist from the stop the riders stand at; waits for the arrival. */
async function rideHoist(D, role) {
  const lift = D.item('hoist'), from = lift.at;
  D.ability(role, 'use', lift);
  await D.until(() => !!lift.ride, 6, 'the hoist moving');
  await D.until(() => lift.at !== from && !lift.ride, 30, 'the hoist arrived');
}


/** `fn()` with halted walkers judged the cautious way (their head anywhere in its sweep, also while they turn to a
 * halt's look): for a man on his feet in the open, where a glimpse is an exposure. */
function strictly(D, fn) {
  const w = D.world, prev = w.sneakHaltExact;
  w.sneakHaltExact = null;
  try { return fn(); } finally { w.sneakHaltExact = prev; }
}

/** How far ahead carryMan looks along its way before he shoulders the man (s), when it looks at all of it at once. */
const CARRY_LOOK = 6;
/** Picking a man up onto the shoulder and putting him down (abilities.carry: s). */
const PICK = CONFIG.abilities.carry?.pick ?? 1.0, DROP = CONFIG.abilities.carry?.drop ?? 0.8;
/** From his arrival behind a man struck to the carry's look, at the earliest and at the latest: the blow (~0.3–0.8 s),
 * the cuffs (1.5 s and a moment either side). */
const CUFFED_EARLY = 1.8, CUFFED_LATE = 3.5;
/**
 * The places and moments (s from now) of a carry (as walkWindows): he stands at `from` from `t0`, gets the man onto his
 * shoulder (PICK) once the carry's look is taken (`t0` at the earliest, `t1` at the latest), walks the clicks `pts` at
 * the carrying pace (units.carry; a little slower and a hesitation at each click at the latest) and puts him down at the
 * last (DROP).
 */
function carryWindows(u, from, pts, t0 = 0, t1 = 0) {
  const sp = CONFIG.units.carry;
  const win = walkWindows(u, from, pts, { up: t0 + PICK, upLate: t1 + PICK + 0.6, speed: sp, slow: sp * 0.9, hold: DROP });
  win[0][2] = t0;
  return win;
}
/**
 * Nobody but `except` sees a man (`mode`) at any point of the windows `win` ([x, z, t0, t1], s from now) at any moment
 * of its window ± `slack`, with clearFor's own looks every `step` s (a walker along his predicted beat with every glance
 * of his head, a squad man wheeling round at a corner at any heading, a post by his sweep) — not routeClear's half
 * second, which a walker's glance on the turn can fall between.
 */
function windowsFine(D, win, o = {}) { return drain(windowsFineGen(D, win, o)); }
/** windowsFine as a generator (the same answer; it yields every few looks: a sliced look hands the frame back). */
function* windowsFineGen(D, win, { mode = 'walk', except = [], why = null, slack = 0.4, step = 0.1 } = {}) {
  const w = D.world;
  let looks = 0;
  for (const e of viewersOf(w)) {
    if (except.includes(e)) continue;
    const far = (e.vision.far ?? 36) + 1, moving = walking(e);
    for (const [x, z, t0, t1] of win) {
      const a = Math.max(0, t0 - slack), b = t1 + slack;
      if (Math.hypot(e.x - x, e.z - z) > far + (moving ? (e.vehEye ? 3 : 1.2) * b + 2 : 0)) continue;
      const d = dummyAt(w, mode, x, z);
      for (let t = a; t <= b + 1e-6; t += step) {
        if ((++looks & 31) === 0) yield;
        let seen;
        if (moving) {
          const q = predict(e, t);
          seen = walkerSees(e, q, d, w, w.time + t)
            || (wheeling(e, t) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, d, w, w.time + t)));
        } else seen = staticSees(e, d, w, t);
        if (seen) { why?.push(`${e.tag}${moving ? '~' : ''}@+${t.toFixed(1)}(${x.toFixed(1)},${z.toFixed(1)})`); return false; }
      }
    }
  }
  return true;
}

/** The Kriminalrat at his desk (a predicted place: halted there). */
const atDeskQ = (q) => !!q.halt && Math.hypot(q.x - DESK[0], q.z - DESK[1]) < 0.8;
/** How long he sits at his desk each round (its point on his round: 40 s, Easy 100). */
const deskWait = (g3) => g3.route?.find((p) => Math.hypot(p.x - DESK[0], p.z - DESK[1]) < 0.5)?.wait ?? 40;
/**
 * The last moment (s from now) the Green Beret may still strike the Kriminalrat at his desk: 4 s before the end of the
 * halt he sits in now, or else of his next one (atDesk) — 0 when he is down. Until then a man down in the office must
 * lie where he will not see him, walking back in at its door or sitting at his desk facing Grethe.
 */
function g3Horizon(D) {
  const g3 = D.get('g3');
  if (!g3?.alive || g3.ko) return 0;
  const b = g3.brain, seatedNow = !!b?.atWait && Math.hypot(g3.x - DESK[0], g3.z - DESK[1]) < 0.8;
  if (seatedNow && (b.waitT ?? 0) > 4) return b.waitT - 4;
  // (out on his round, or about to get up: his next sitting, after the about-turn at his desk and the walk out)
  for (let t = seatedNow ? Math.max(0, b.waitT ?? 0) + 1 : 0; t <= 900; t += 0.25) if (atDeskQ(predict(g3, t))) return t + deskWait(g3) - 4;
  return 900;
}
/**
 * Will the Kriminalrat, from `from` s on until g3Horizon, see a man standing (`mode` 'walk') or a man down ('body') at
 * any of `spots`? His head judged the cautious way (strictly); false once he is down.
 */
function g3Sees(D, spots, { from = 0, mode = 'walk' } = {}) {
  const g3 = D.get('g3'), w = D.world;
  if (!g3?.alive || g3.ko) return false;
  const end = g3Horizon(D);
  return strictly(D, () => spots.some(([x, z]) => {
    const d = dummyAt(w, mode, x, z);
    for (let t = from; t <= end + 1e-6; t += 0.25) {
      const q = predict(g3, t);
      if (Math.hypot(q.x - x, q.z - z) <= 40 && walkerSees(g3, q, d, w, w.time + t)) return true;
    }
    return false;
  }));
}
/**
 * The way `u` will really go from `from` through the clicks `pts`: each leg as his own move order plans it in his stance
 * (Unit.planFrom: on his belly he keeps 2 m off crates and props, so a leg past them bows out), not the straight lines
 * between the clicks.
 */
function plannedWay(u, from, pts) {
  const out = [];
  let [x, z] = from;
  for (const [tx, tz] of pts) {
    const p = u.planFrom(x, z, tx, tz);
    if (p) for (const q of p.slice(1)) out.push([q.x, q.z]);
    if (!out.length || Math.hypot(out.at(-1)[0] - tx, out.at(-1)[1] - tz) > 0.3) out.push([tx, tz]);
    [x, z] = [tx, tz];
  }
  return out;
}
/** The length of the polyline `pts`. */
const pathLen = (pts) => pts.slice(1).reduce((L, p, k) => L + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0);

/** The live men who would see through a Spy in `uniform` (BCD ranks): the Gestapo and the dogs always, and anyone
 * of a higher rank than the uniform's. */
function recognizers(D, uniform) {
  if (uniform === 'civilian') return D.world.enemies.filter((e) => e.alive && !e.removed && !e.ko && e.soldierType === 'gestapo'); // (Grethe's cover)
  const ur = CONFIG.bcd.rankOfUniform[uniform] ?? 0;
  return D.world.enemies.filter((e) => e.alive && !e.removed && !e.ko
    && (e.soldierType === 'gestapo' || e.soldierType === 'dog' || viewerRank(e) > ur));
}
/** Everyone else: the men a Spy in `uniform` is just another of theirs to (the `except` list of his sight checks). */
function blindTo(D, uniform) { const r = new Set(recognizers(D, uniform)); return D.world.enemies.filter((e) => !r.has(e)); }

/** The Spy puts on `uniform` from his wardrobe (U cycles it: pressed until he wears that one). */
async function dress(D, uniform) {
  const spy = D.c('spy');
  for (let k = 0; k < 4 && !(spy.disguised && spy.uniformType === uniform); k++) {
    D.ability('spy', 'uniform');
    const was = `${spy.disguised}/${spy.uniformType}`;
    await D.until(() => `${spy.disguised}/${spy.uniformType}` !== was, 8, `the Spy changing (${uniform})`);
    await D.idle('spy', 4);
  }
  if (!(spy.disguised && spy.uniformType === uniform)) throw new Error(`the Spy could not put on the ${uniform}'s uniform`);
}
const obj = (D, id) => D.world.objectives.find((o) => o.id === id);
/** Neither Gestapo walker of the wall walk (g4, g5 Hard) will be near its SE corner within `sec` s (predicted). */
function cornerClear(D, sec, at = [79, 93], r = 10) {
  for (const id of ['g4', 'g5']) {
    const e = D.get(id);
    if (!e || !e.alive || e.ko) continue;
    for (let t = 0; t <= sec; t += 1) { const q = predict(e, t); if (Math.hypot(q.x - at[0], q.z - at[1]) < r) return false; }
  }
  return true;
}


/** Open / shut a door `id` by `role` (he walks to it and works it). */
async function door(D, role, id, open) {
  const d = D.item(id);
  if (!!d.open === open) return;
  if (D.c(role).stance === 'crawl') await D.stance(role, 'stand');
  D.ability(role, 'use', d);
  await D.until(() => !!d.open === open, 8, `${id} ${open ? 'open' : 'shut'}`);
  await D.idle(role, 4);
}

/**
 * `fn()` with the doors `ids` judged open (sneak.mjs `w.sneakOpen`: their cells do not block a sight line — the
 * look-ahead of a moment after he has opened them; the game's grid is not touched). A shut door hides the dark hoist
 * house; open, the black coats at the wall walk's SE corner look straight in (and one walking west along it, at the
 * edge of his cone).
 */
function withOpen(D, ids, fn) {
  if (!ids?.length) return fn();
  const w = D.world, prev = w.sneakOpen;
  w.sneakOpen = new Set([...(prev ?? []), ...ids.map((id) => D.item(id).owner)]);
  try { return fn(); } finally { w.sneakOpen = prev; }
}
/** (perception's options for the solution's own direct looks: the doors judged open, if any) */
const seeOpts = (w, cone) => (w.sneakOpen ? { cone, passOwners: w.sneakOpen } : { cone });
/** The 'use' ability's reach to `it` (abilities/shared.js: a BCD door leaf in a wall, 1.6 m). */
function useReach(D, u, it) {
  const r = ABILITIES.use?.range;
  return typeof r === 'function' ? r(u, it, D.world) : (r ?? 1.2);
}
/**
 * Where a 'use' order on door `id` stops `u` from `from`, on his feet: along the way his move order plans to the door
 * (as Commando._updatePending walks him), the first point within the ability's reach of it — he works it from there —
 * and the length of that walk. → {spot, len, it}
 */
function doorSpot(D, u, id, from = [u.x, u.z]) {
  const it = D.item(id), reach = useReach(D, u, it);
  let [x, z] = from, L = 0;
  if (Math.hypot(it.x - x, it.z - z) <= reach) return { spot: [x, z], len: 0, it };
  for (const [qx, qz] of wayAs(u, 'stand', from, [[it.x, it.z]])) {
    const seg = Math.hypot(qx - x, qz - z);
    if (seg > 1e-9) {
      // (this leg's first point within reach: |p + s·dir − door| = reach, the smaller root in [0, seg])
      const dx = (qx - x) / seg, dz = (qz - z) / seg, fx = x - it.x, fz = z - it.z;
      const b = fx * dx + fz * dz, disc = b * b - (fx * fx + fz * fz - reach * reach);
      const s = disc >= 0 ? -b - Math.sqrt(disc) : -1;
      if (s >= 0 && s <= seg) return { spot: [x + dx * s, z + dz * s], len: L + s, it };
    }
    L += seg; x = qx; z = qz;
  }
  return { spot: [x, z], len: L, it };
}
/** From the moment a door at hand has turned to the moment he moves on, at the latest, besides his click's hesitation:
 * door()'s wait for it and its idle, the ticks between his orders. */
const DOOR_SETTLE = 0.3;
/**
 * `u` works door `id` from where he is: he gets up (lying), steps to the spot he works it from (doorSpot) and works it
 * (its activation time). → {spot, shut: his windows ([x, z, t0, t1], s from now: walkWindows) up to the moment it
 * turns, judged with the door as it stands; at: [earliest, latest] moment it turns}
 */
function doorStep(D, u, id) {
  const { spot, len, it } = doorSpot(D, u, id);
  const up = u.stance === 'stand' ? 0 : CONFIG.units.stanceUp, act = it.activationTime ?? 0.5;
  // (no click hesitates: the stance and the use are orders given at once)
  const shut = walkWindows(u, [u.x, u.z], [spot], { stance: 'stand', up, lagged: 0 });
  const at = [up + len / CONFIG.units.walk + act, up + len / WALK_SLOW + act + DOOR_SETTLE];
  shut.push([spot[0], spot[1], shut.arriveEarly, at[1]]);
  return { spot, shut, at };
}
/**
 * `u` shuts door `id` behind him from `from`, on his feet, setting off between `t0` and `t1` s from now: his step up to
 * the spot he works it from (doorSpot) and its working. → {win: his windows ([x, z, t0, t1]: walkWindows), done: the
 * latest moment it has turned}
 */
function shutStep(D, u, id, from, t0, t1) {
  const { spot, len, it } = doorSpot(D, u, id, from);
  const win = walkWindows(u, from, [spot], { stance: 'stand', up: t0, upLate: t1, lagged: 0 });
  win[0][2] = t0;
  const done = t1 + len / WALK_SLOW + (it.activationTime ?? 0.5) + DOOR_SETTLE;
  win.push([spot[0], spot[1], win.arriveEarly, done]);
  return { win, done };
}
/**
 * A man carried in at door `id` and laid at `end` between `t0` and `t1` s from now, the door shut at once behind them
 * (carryMan / strike `shut`): from the moment he lies there until it has turned he is in its open sight lines (a bound
 * man seen is freed, and both shout), and the carrier steps up to it and works it — every moment of both unseen, with
 * every glance (windowsFine) of all but `except`.
 */
function* shutClearGen(D, u, id, end, t0, t1, { except = [], why = null, slack = 0.4 } = {}) {
  const st = shutStep(D, u, id, end, t0, t1);
  return (yield* windowsFineGen(D, [[end[0], end[1], t0, st.done]], { mode: 'body', except, why, slack }))
    && (yield* windowsFineGen(D, st.win, { except, why, slack }));
}

/** How long a look runs at once in the live replay before its rest is handed to the driver's runSliced (ms). */
const LOOK_MS = 4;
/**
 * A look's own state on the world (lookState(D).around: runLook puts it on for each of its slices and takes it off
 * between them): every man's mirror refreshed once a slice (ghost.mjs mirrorScope), the doors it judges open
 * (`set({open})`: sneak.mjs `w.sneakOpen`, as withOpen) and its strict heads (`set({strict})`: as strictly). The look
 * switches them with `set` as it goes; between slices the world is as the game has it.
 */
function lookState(D) {
  const w = D.world, ms = mirrorScope(), st = { open: null, strict: false };
  let saved = null;
  const apply = () => {
    if (!saved) return;
    w.sneakOpen = st.open?.length ? new Set([...(saved.open ?? []), ...st.open.map((id) => D.item(id).owner)]) : saved.open;
    w.sneakHaltExact = st.strict ? null : saved.halt;
  };
  return {
    set(o) { Object.assign(st, o); apply(); },
    around: {
      enter() { saved = { open: w.sneakOpen, halt: w.sneakHaltExact }; ms.enter(); apply(); },
      leave() { if (saved) { w.sneakOpen = saved.open; w.sneakHaltExact = saved.halt; saved = null; } ms.leave(); },
    },
  };
}
/**
 * The answer of the look `it` (a generator returning it), as one look at a world standing still: at once while it takes
 * under LOOK_MS, else the rest by the driver's runSliced (live replay: the frame handed back between slices, no tick
 * meanwhile — the same answer; headless: at once) — the answer or a promise of it, for D.untilAsync. `ls`: its state.
 */
function runLook(D, it, ls) {
  const t0 = performance.now();
  ls.around.enter();
  let r;
  try {
    do r = it.next(); while (!r.done && performance.now() - t0 < LOOK_MS);
  } catch (err) { ls.around.leave(); throw err; }
  ls.around.leave();
  return r.done ? r.value : D.runSliced(it, ls.around);
}
/** D.until for a look written as a generator (`look(ls)`, made afresh each tick): the same looks at the same ticks. */
function untilLook(D, look, maxSec, label) {
  const ls = lookState(D);
  return D.untilAsync(() => runLook(D, look(ls), ls), maxSec, label);
}

// ---------------------------------------------------------------- places (the def's layout)
const HOIST_BOTTOM = [84, 127.6], HOIST_TOP = [67, 88.2];
/** The hoist house's back corners (prone there, nobody sees in through its north door). */
// (the Spy's spot clear of the west door's posts: a prone man's body keeps off them, and the door is 1.8 m wide)
const HH_GB = [65.2, 86.3], HH_SPY = [65.9, 88.3];
/** Just inside the hoist house door, beside its jambs (prone: the GB's launch spots for a step out). */
const JAMB = [68.7, 86.5];
/** Lying in the courtyard behind the hoist house, by the casemate wall: in sight of the iron door through the gap past
 * the stores stack, out of the yard's far bands. */
const POCKET_LIE = [72.6, 82.8];
/** Lying in the passage right in front of the iron door: in sight of the door and of the corridor behind it. */
const DOOR_LIE = [69.4, 83.6];
/** In the alley between the switch room and the hoist house (out of the yard's sight, by the switch room's door). */
const ALLEY_IN = [63.25, 87.3];
/** Just inside the iron door, beside the doorway's axis (the puppet sits further in, along the corridor). */
const INSIDE_DOOR = [69.5, 79.5];
/** Behind the stores stack in the courtyard (out of the passage's sight): where the GB waits for the lane walker. */
const STACK_HIDE = [72.6, 85.0];
/** The Gestapo office: its door (east face, between g1 and g2) and the Kriminalrat's desk. */
const OFFICE_DOOR = [48.6, 79.1], DESK = [44.2, 79];
/** The north end of the alley between the switch room and the hoist house, lying down: out of everyone's near band
 * (the switch room's corner hides it from the office door, 17 m west). */
const ALLEY_MOUTH = [63.1, 86.6];
/** The crawl from the alley's mouth across the parade's south side to the office door (between its guards' cones). */
// (round the ammunition crates by the lane (61, 82.6), which a man on his belly keeps 2 m off: the check judges the way
// his orders really plan round them, plannedWay)
const CROSS = [[61.5, 85.1], [58.6, 84.7], [58.2, 83.4], [57.5, 82.85], [54.5, 81.4], [51.2, 80.2], [48.6, 79.1]];
/** On his feet: in at the office door and into its NE corner (out of the doorway's line and of the desk's eyes). */
const ENTER = [[46.6, 78.9], [46.6, 75.9]]; // (NE_CORNER)
/** In the office out of the doorway's lines: where the GB waits for the adjutant (by the NE corner), where the
 * adjutant is laid (by the SW corner), where the Spy waits (by the north wall). */
const GB_WAIT = [46.1, 76.5], ADJ_DUMP = [42.2, 81.9], SPY_OFFICE = [44.6, 76.2];
/** Just inside the commandant's house door (its south side), and behind the commandant at his desk (he faces the
 * west window). */
const HOUSE_IN = [47.0, 62.6], CMD_BEHIND = [44.7, 58.5];
/** The office's east corners, either side of its door and out of the doorway's line (and of the desk's eyes). */
const NE_CORNER = [46.6, 75.9], SE_CORNER = [46.6, 82.1];
/** Where the south guard is laid: by the north wall beside the north one (behind the Kriminalrat's back at his desk,
 * and out of the lines the doorway opens into the office from the parade). Like NE_CORNER, deep in the corner the
 * Kriminalrat does not see on his way back in at the door nor from his desk (its edge runs from (45.0, 75.5) to
 * (46.75, 77.5)): a man laid there while he is out lies unseen until he can be struck at his desk. A man down keeps
 * the living 0.9 m off (units.avoid.clear): the two lie 1.07 m apart, NE_CORNER free to stand on before the north one
 * is laid there. */
const G2_DUMP = [45.55, 75.7];
/** Where the Green Beret waits in the office while the Kriminalrat is out: in that corner, a metre from the two men
 * laid there. */
const GB_POCKET = [46.6, 76.95];
/** The Gestapo office's spots, for the unit tests (tests/unit/e05-cold-iron.test.mjs: the north-east corner). */
export const OFFICE = Object.freeze({ DESK, OFFICE_DOOR, NE_CORNER, G2_DUMP, GB_POCKET });
/** The door steps' look-ahead, for the unit tests (`D`: {world, item(id)} will do): where a 'use' stops him, its timing,
 * the doors judged open; and the hoist house's spots it is asked from. */
export const DOORS = Object.freeze({ doorSpot, doorStep, withOpen, JAMB });
/** Behind the harbour magazine (its north side, out of the quay's sight) and its north-east corner. */
const MAG_BACK = [85.6, 123.4], MAG_NE = [88.6, 124.0];
/** Inside the magazine: where the quay's men are laid. */
const MAG_IN = [[81.4, 125.8], [82.4, 125.8], [86.6, 125.8]];

/** Round the magazine's west side to the strip between its door and the door sentry (his back). */
const MAG_BACK_W = [81.0, 123.4], MAG_W = [79.3, 128.6], GB_IN = [83.2, 127.4], SPY_IN = [85.6, 126.6];
/** At the folboats in the cove (the exit zone, r 6 round (20, 148)). */
const COVE_GB = [21.6, 147.4], COVE_SPY = [20.4, 146.2], COVE_GR = [19.4, 147.8];
/** Round the hoist's top stop (67, 88.2), within its 1.5 m: the three riders of the way down. */
const RIDE_GB = [68.3, 88.0], RIDE_GR = [67.4, 89.2], RIDE_SPY = [66.3, 87.6];
/** Square through the hoist house's west doorway, on its centre line (its posts leave 1.2 m). */
const THROUGH_W = [[63.4, 88.0], [65.1, 88.0]];
/** hq3 is walking east along the quay, or halted at its east end (his back to the magazine). */
const hq3Away = (D) => { const e = D.get('hq3'); return !e || !e.alive || !!e.ko || (e.x > 90.5 && (Math.cos(e.heading) > 0.5 || e.brain?.atWait)); };

/**
 * The adjutant halts at the guardroom door looking south (half a minute): the GB, waiting in the office by its north
 * wall, out at the door behind him, the blow, the cuffs, carried in and laid by the office's south-west corner.
 */
async function adjutant(D) {
  const adj = D.get('adj'), inBy = [46.9, 79.0];
  const atF = haltedFor(D, adj, 49, 83.8, 1.5, 1.0);
  await strike(D, 'greenberet', adj, [49.0, 82.6], { ready: atF, via: [inBy, [48.2, 80.4]], hold: 9, slack: 1.2, quiet: 5, maxSec: 400, trustVictim: true, label: 'at the guardroom door' });
  await carryMan(D, 'greenberet', adj, [[48.2, 80.4], inBy, [44.5, 80.6], ADJ_DUMP], { maxWait: 15, quiet: 0, label: 'into the office' });
  await D.go('greenberet', ...GB_WAIT, { tol: 0.4 });
}

export const STAGES = [
  ['A', 'The harbour magazine: in by the ammunition hoist', async (D) => {
    // along the shore under the glacis on their bellies, up behind the magazine and round its west side (the quay's
    // men face the water), then in at its door while the quay's walker (Hard) has his back to it
    await D.parallel(
      () => sneak(D, ...MAG_BACK_W, { mode: 'crawl', role: 'greenberet', label: 'GB along the shore to the magazine', box: 14, horizon: 400 }),
      async () => { await D.wait(3); await sneak(D, 78.4, 122.4, { mode: 'crawl', role: 'spy', label: 'Spy along the shore to the magazine', box: 14, horizon: 400 }); },
    );
    // one at a time round the magazine's west side and in at its door
    await sneak(D, ...MAG_W, { mode: 'crawl', role: 'greenberet', label: 'GB round the magazine', box: 8 });
    await sneak(D, ...GB_IN, { mode: 'crawl', role: 'greenberet', label: 'GB into the magazine', box: 8, keepWalker: 2, keep: 1, maxWait: 200 });
    await sneak(D, ...MAG_W, { mode: 'crawl', role: 'spy', label: 'Spy round the magazine', box: 8 });
    await sneak(D, ...SPY_IN, { mode: 'crawl', role: 'spy', label: 'Spy into the magazine', box: 8, keepWalker: 2, keep: 1, maxWait: 200 });
    D.checkpoint('A1 GB and Spy inside the harbour magazine');
    const hq3 = D.get('hq3'), mq1 = D.get('mq1');
    // the door sentry looks south over the basin: the GB steps out behind him as the quay's walker (Hard) sets off east
    // from his west end (his back to the quay for ~20 s; the man is inside the magazine in ~8)
    const hq3East = () => !hq3 || (hq3.x < 93 && Math.cos(hq3.heading) > 0.5 && !hq3.brain?.atWait);
    await strike(D, 'greenberet', mq1, [85.6, 131.1], { ready: hq3East, via: [[84, 129.6]], quiet: 10, label: 'at the magazine door' });
    await carryMan(D, 'greenberet', mq1, [[84, 130.6], [84, 129.0], [82.0, 125.8]], { maxWait: 30, quiet: 600, label: 'into the magazine' });
    D.checkpoint('A2 mq1 knocked out, cuffed and inside the magazine');
    if (hq3) {
      // Hard: the quay's walker halts 10 s at his west end looking out over the basin: the Spy steps out of the door
      // and along the wall behind him
      const halted = haltedFor(D, hq3, 89.3, 131, 1.0);
      await D.go('spy', 84.2, 129.5, { tol: 0.3 }); // (just inside the door: the wall hides him from the quay)
      // (one order out of the door and along the magazine's south wall on the clear line 0.45 m off it — the way it plans
      // runs straight along the wall; the walk is judged on it from his earliest arrival behind the walker to his latest:
      // in three clicks, the hesitations at each let the head's sweep come round onto him at the corner)
      await strike(D, 'spy', hq3, [88.15, 130.9], { ready: halted, quiet: 12, hold: 2, trustVictim: true, label: 'at the quay\'s west end' });
      await carryMan(D, 'spy', hq3, [[86.4, 130.7], [84, 130.6], [84, 129.0], [86.6, 125.8]], { maxWait: 30, quiet: 600, label: 'into the magazine' });
      D.checkpoint('A3 hq3 chloroformed, cuffed and inside the magazine');
    }
    await D.parallel(
      () => D.go('greenberet', HOIST_BOTTOM[0] - 0.4, HOIST_BOTTOM[1], { tol: 0.35 }),
      () => D.go('spy', HOIST_BOTTOM[0] + 0.5, HOIST_BOTTOM[1] + 0.3, { tol: 0.35 }),
    );
    await rideHoist(D, 'greenberet');
    // up in the dark hoist house: down on their bellies in its back corners, out of the doorway's sight lines
    await D.parallel(
      async () => { await D.stance('greenberet', 'crawl'); await D.go('greenberet', ...HH_GB, { tol: 0.3 }); },
      async () => { await D.stance('spy', 'crawl'); await D.go('spy', ...HH_SPY, { tol: 0.3 }); },
    );
    D.checkpoint('A4 up the hoist into the hoist house');
  }],
  ['B', 'The radio casemate: a puppet for the iron door, the call-sign book', async (D) => {
    const gb = D.c('greenberet'), y2 = D.get('y2'), cs1 = D.get('cs1'), iron = D.item('iron_door');
    await D.go('greenberet', ...JAMB, { tol: 0.3 });
    if (cs1) {
      // Hard: the courtyard's sentry stands behind the hoist house watching the way in past the iron door, the house at
      // his back: the GB opens its door, steps out behind him, knocks him out, cuffs him and carries him inside
      // (all of it judged before he gets up, the door open from the moment it turns — open, the wall walk's SE corner
      // looks straight into the dark house: the step to the door and its opening, the walk out, the blow and the cuffs,
      // the carry in at once, the man laid in its back corner and the door shut behind them)
      const IN = [[70.6, 88.0], [68.0, 87.6], [65.4, 86.5]];
      await strike(D, 'greenberet', cs1, [73.2, 87.2], { via: [[70.6, 88.0]], quiet: 40, hold: CUFFED_LATE + PICK + 1.5, opens: 'hoist_door', carry: { pts: IN, shut: 'hoist_door' }, label: 'in the courtyard' });
      await carryMan(D, 'greenberet', cs1, IN, { maxWait: 15, quiet: 0, precise: true, shut: 'hoist_door', label: 'into the hoist house' });
      await D.stance('greenberet', 'crawl');
      await D.go('greenberet', ...JAMB, { tol: 0.3 });
      D.checkpoint('B1 cs1 out cold, cuffed and inside the hoist house');
    }
    // the lane walker comes down into the passage and halts 12 s (Easy 30) by the iron door looking west out along it:
    // as he comes down the lane the GB slips out of the hoist house (the door shut behind him) to the courtyard behind
    // the stores stack, out of the passage's sight
    await D.until(() => y2.alive && !y2.ko && y2.brain?.state === 'IDLE' && y2.z > 69 && y2.z < 78 && Math.sin(y2.heading) > 0.7, 400, 'y2 on his way down the lane');
    // (he lies by the stack until y2 halts at the iron door, ~25 s on Easy: in that time the wall walk's black coat must
    // not stop at the rampart's SE corner, which looks down on the courtyard from 10 m)
    const lieT = 8 + 18 / (D.world.mission.routeSpeedMul ?? 1);
    // (the way out judged with the door as it will be once it turns — open, the wall walk's SE corner looks straight in:
    // the spot he works it from, the doorway and the step outside where he shuts it behind him, ~5 s on his feet in all)
    const OUT = [doorSpot(D, gb, 'hoist_door').spot, [69.75, 87.9], [70.6, 88.0], [70.9, 88.0]];
    await untilLook(D, function* look(ls) {
      if (!(yield* clearForGen(D, [[gb.x, gb.z]], 6, { mode: 'walk' }))) return false;
      ls.set({ open: ['hoist_door'] });
      const out = yield* clearForGen(D, OUT, 6, { mode: 'walk' });
      ls.set({ open: null });
      return out && (yield* clearForGen(D, [[70.6, 88.0], [72.4, 86.9], STACK_HIDE], lieT, { mode: 'crawl' }));
    }, 160, 'the courtyard quiet for the way to the stack');
    await door(D, 'greenberet', 'hoist_door', true);
    await D.go('greenberet', 70.9, 88.0, { tol: 0.3 }); // (through the doorway on his feet: a man lying down does not fit a door)
    await door(D, 'greenberet', 'hoist_door', false);
    await D.stance('greenberet', 'crawl');
    for (const p of [[72.4, 86.9], STACK_HIDE]) await D.go('greenberet', p[0], p[1], { tol: 0.4 });
    // halted, his back to the courtyard: round the stack's end, along the casemate wall, behind him — one order (the
    // way plans round the stack's north end, 4.8 m), in the first second of his halt (Hard: 6 s, Easy 15)
    const halted = haltedFor(D, y2, 68.6, 83.4, 0.4);
    await strike(D, 'greenberet', y2, [69.6, 83.4], { ready: halted, quiet: 9, hold: 1.5, trustVictim: true, label: 'by the iron door' });
    const pup = y2;
    // down on his belly at once: the strings are worked lying in the passage in front of the iron door (a man standing
    // there is seen down the passage from the yard), in sight of the door and of the corridor behind it
    await D.stance('greenberet', 'crawl');
    D.checkpoint('B2 y2 out cold and cuffed by the iron door');
    // R on him: he stands and obeys (the controller's own moves go to him while he holds the strings); sent to the
    // iron door he opens it (it opens only to the garrison) and walks in; let go, he sits down inside, bound
    const take = async () => { D.ability('greenberet', 'puppet', pup); await D.until(() => pup.puppetOf === gb, 5, `${pup.tag} on the strings`); };
    const letGo = async () => { D.ability('greenberet', 'puppet', pup); await D.until(() => !pup.puppetOf, 5, `${pup.tag} let go`); };
    const work = async (open) => { D.ability('greenberet', 'puppet', iron); await D.until(() => !!iron.open === open, 25, `the iron door ${open ? 'open' : 'shut'}`); };
    const send = async (x, z) => { D.ability('greenberet', 'puppet', { x, z }); await D.until(() => Math.hypot(pup.x - x, pup.z - z) < 0.8, 15, `${pup.tag} to (${x},${z})`); };
    await D.go('greenberet', ...DOOR_LIE, { tol: 0.4 });
    await take();
    await work(true);
    D.checkpoint('B3 the puppet opens the iron door');
    await send(68.1, 77.0); // (straight in, along the corridor: in the GB's sight through the doorway)
    await letGo();
    // in at the door on his feet in a quiet moment, then the puppet (in sight inside) shuts it behind them
    await D.until(() => clearFor(D, [[gb.x, gb.z], INSIDE_DOOR], 5, { mode: 'walk' }), 200, 'the passage quiet to step in');
    await D.stance('greenberet', 'stand');
    await D.go('greenberet', ...INSIDE_DOOR, { tol: 0.4 });
    await take();
    await work(false);
    await letGo();
    D.checkpoint('B4 inside the radio casemate, the iron door shut behind them');
    // the two operators at their receivers, headphones on, backs to the hall
    for (const [tag, at] of [['rs2', [72.7, 77.2]], ['rs1', [72.7, 64.7]]]) {
      await strike(D, 'greenberet', tag, at, { quiet: 30, label: 'at his receiver' });
    }
    D.checkpoint('B5 both operators out cold and cuffed');
    D.ability('greenberet', 'hand', D.item('callbook'));
    await D.until(() => obj(D, 'o3')?.done, 20, 'the call-sign book taken');
    await D.idle('greenberet', 5);
    D.checkpoint('B6 the call-sign book is ours (o3)');
    // out: the puppet opens the door, the GB steps out in a quiet moment and lies down in front of it, the puppet (on
    // strings through the doorway) shuts it again and is let go inside
    await D.go('greenberet', ...INSIDE_DOOR, { tol: 0.4 });
    // (the door opens only while neither black coat on the wall walk is at the SE corner: from there the rampart
    // looks down through the open doorway along the corridor)
    await D.until(() => cornerClear(D, 30), 300, 'the SE corner of the wall walk empty');
    await take();
    await work(true);
    await send(68.1, 77.0); // (back along the corridor before he is let go: out of the doorway's sight)
    await letGo();
    await D.until(() => clearFor(D, [[gb.x, gb.z], DOOR_LIE], 6, { mode: 'walk' }), 200, 'the passage quiet to step out');
    await D.go('greenberet', ...DOOR_LIE, { tol: 0.4 });
    await D.stance('greenberet', 'crawl');
    await take();
    await work(false);
    await letGo();
    D.checkpoint('B7 out again, the casemate shut on its bound men');
  }],
  ['C', 'The bridge: the keeper on strings works his own switch', async (D) => {
    const gb = D.c('greenberet'), k1 = D.get('k1');
    // along the passage on his belly to the alley's mouth, then down the alley and in at the switch room's door: the
    // keeper stands at his panel looking south (at the bridge), the door at his back
    // (while the adjutant is up at the house end of his beat: at the guardroom door he turns back north by the east,
    // and for a moment looks straight along the passage)
    const adj = D.get('adj');
    await D.until(() => !adj || (adj.z < 74 && Math.sin(adj.heading) < -0.3) || adj.z < 66, 300, 'the adjutant up at the house end of his beat');
    await sneak(D, ...ALLEY_IN, { mode: 'crawl', role: 'greenberet', label: 'GB along the passage into the alley', box: 10, maxWait: 300 });
    // (slack 0.8: he stands up at the alley's mouth and may linger a moment before he steps off)
    await strike(D, 'greenberet', k1, [60.7, 87.9], { via: [[62.2, 88.0]], quiet: 30, slack: 0.8, label: 'at his switch' });
    D.checkpoint('C1 the keeper out cold and cuffed at his switch');
    D.ability('greenberet', 'puppet', k1);
    await D.until(() => k1.puppetOf === gb, 5, 'the keeper on the strings');
    const sw = D.item('bridge_switch'), br = D.item('drawbridge');
    D.ability('greenberet', 'puppet', sw);
    await D.until(() => br.raised || br.moving > 0, 30, 'the drawbridge rising');
    await D.until(() => br.raised && !(br.moving > 0), 15, 'the drawbridge up');
    D.ability('greenberet', 'puppet', k1);
    await D.until(() => !k1.puppetOf, 5, 'the keeper let go');
    await D.until(() => obj(D, 'o4')?.done, 10, 'the bridge up, its keeper bound');
    D.checkpoint('C2 the drawbridge up against the camp; its keeper bound (o4)');
    // he waits in the switch room with the bound keeper: its walls hide him, its door gives on the alley
    await D.go('greenberet', 61.4, 87.0, { tol: 0.4 });
  }],
  ['D', 'The Gestapo office: the Spy in the keeper\'s coat; in at the door behind its two guards\' backs; the Kriminalrat, Grethe, the adjutant and the guards', async (D) => {
    const gb = D.c('greenberet'), spy = D.c('spy'), g1 = D.get('g1'), g2 = D.get('g2'), g3 = D.get('g3'), adj = D.get('adj'), k1 = D.get('k1'), why = [];
    // (from here a halted walker's head is judged where his sweep puts it, ± 0.4 s: the yard's two walkers halt at the
    // house end looking north, and the planner's guess of a head swept south while they turn would shut every gap)
    D.world.sneakHaltExact = 0.4;
    // out of the switch room on his belly: on his feet in the alley he is in the quarters sentry's eye straight down
    // it (oq1, 26 m north), lying down he is beyond it. Shut, the hoist house's west door leaves no room by its leaf
    // for a man lying down to turn out of the switch room's door: the Spy opens it while he goes
    await D.stance('spy', 'stand');
    // (opened once nobody will see in at it: open, he stands at the spot he works it from in its sight lines across the
    // alley's foot until the Green Beret has crawled out under it to the alley's mouth; then the gap down the alley is
    // judged with him in it)
    const wd = doorStep(D, spy, 'hoist_door_w');
    await D.until(() => { why.length = 0; return withOpen(D, ['hoist_door_w'], () => clearFor(D, [wd.spot], wd.at[1] + 8, { mode: 'walk', why })) || dbg(D, why, 'west door'); },
      300, 'nobody to see in at the hoist house\'s west door');
    await door(D, 'spy', 'hoist_door_w', true);
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 62.75, 87.3, { tol: 0.5 });
    await D.go('greenberet', ...ALLEY_MOUTH, { tol: 0.3 });
    // while the Green Beret lies at the alley's mouth waiting for his gap, the Spy slips across the alley's foot into
    // the switch room on his feet (in the alley he is in the quarters sentry's eye straight down it: he goes while that
    // sentry's head is turned) and takes the bound keeper's coat: a private
    await D.until(() => clearFor(D, [[spy.x, spy.z], [64.6, 88.0], [63.4, 88.0], [62.4, 88.0]], 3.4, { mode: 'walk', why }), 300, 'a gap in the eyes down the alley');
    await D.go('spy', 61.4, 87.7, { tol: 0.4 });
    await D.go('spy', k1.x + 0.9, k1.z - 0.2, { tol: 0.5 });
    D.ability('spy', 'hanger', k1);
    await D.until(() => k1.uniformTaken, 10, 'the keeper\'s coat taken');
    await D.idle('spy', 4);
    await dress(D, 'soldier');
    D.checkpoint('D1 the Spy in the switch room in the bound keeper\'s coat: a private now');
    // across the parade's south side on his belly to the office door, inside the wedge between the cones of its two
    // guards (each looks along the office's face, one north, one south, his head swinging 40° either way: the door
    // between them and the parade east of it are behind both). The adjutant crosses this ground on his beat and the
    // Kriminalrat walks it on his round: the crawl starts when neither will see it; then up and in at the door
    // (the way he will crawl, as his clicks plan it from where he lies: past the crates it runs 0.4 m nearer the gate
    // sentry's sweep than the clicks' straight lines — at the edge of it; the moment is judged on that way, the timing
    // the less sure the farther along it: a hesitation at each of seven clicks adds up)
    const crossWay = plannedWay(gb, [gb.x, gb.z], CROSS);
    const crawlT = pathLen([[gb.x, gb.z], ...crossWay]) / CONFIG.units.crawl;
    // (the Kriminalrat seated at his desk for the whole crossing and the strike after it — the crawl, getting up, the
    // walk in, the step behind him, the blow, and the hesitations at the clicks: his head is judged where his sweep puts
    // it, not anywhere it could turn to as he gets up to leave, which he will not do before the blow)
    const SEATED_FOR = crawlT + 14;
    const seated = (sec) => g3.alive && !g3.ko && Math.hypot(g3.x - DESK[0], g3.z - DESK[1]) < 0.8 && !!g3.brain?.atWait && (g3.brain.waitT ?? 0) > sec;
    const allBut = (e) => D.world.enemies.filter((x) => x !== e);
    await D.until(() => {
      why.length = 0;
      if (!routeClear(D, crossWay, { mode: 'crawl', from: [gb.x, gb.z], hold: 1.5, slack: 1.2, slackRate: 0.08, why })) return dbg(D, why, 'cross to the office');
      const sits = seated(SEATED_FOR);
      if (!strictly(D, () => routeClear(D, ENTER, { mode: 'walk', from: OFFICE_DOOR, delay: crawlT + 1.2, hold: 2, slack: 0.8, why, except: sits ? [g3] : null }))) return dbg(D, why, 'in at the office door');
      // (seated, he is no walker to keep 4 m off: he does not turn round; 1.5 m)
      if (sits && !routeClear(D, ENTER, { mode: 'walk', from: OFFICE_DOOR, delay: crawlT + 1.2, hold: 2, slack: 0.8, why, except: allBut(g3), keepWalker: 1.5 })) return dbg(D, why, 'in at the office door (desk)');
      // (not seated for the whole of it — out on his round, or about to get up: from his arrival in the office's
      // north-east corner the Green Beret must stay out of his eyes until he can be struck at his desk: on his way out
      // past it, his about-turn at the desk included, and on his way back in)
      if (!sits && g3Sees(D, [NE_CORNER, GB_POCKET], { from: crawlT })) return dbg(D, ['g3 would see the corner'], 'cross to the office');
      return true;
    }, 900, 'a gap to cross the parade to the office door');
    for (const p of CROSS) await D.go('greenberet', ...p, { tol: 0.35 });
    await D.stance('greenberet', 'stand');
    for (const p of ENTER) await D.go('greenberet', ...p, { tol: 0.3 });
    D.checkpoint('D2 inside the Gestapo office, behind its guards\' backs, in its dark corner');
    // the Kriminalrat, whenever he sits at his desk with time left — as the Green Beret comes in, or back from his round
    // (the study, the signal station: three minutes and more) — first: the blow from behind, the cuffs (the burn script
    // loses its actor), Grethe (D3, D4 before the door guards; D7, D8 after one or both). Then the adjutant at his next
    // halt by the guardroom door (stage E)
    const atDesk = () => g3.alive && !g3.ko && Math.hypot(g3.x - DESK[0], g3.z - DESK[1]) < 0.8 && g3.brain?.atWait && (g3.brain.waitT ?? 0) > 4;
    const g3Down = () => !g3.alive || !!g3.ko;
    const inBy = [46.9, 79.0];
    // (the office's checkpoints, written here in the order the walkthrough tells them — the Kriminalrat and Grethe
    // first, then the guards; out on his round, D7 and D8 come after one guard or both)
    const cp = {
      D3: () => D.checkpoint('D3 the Kriminalrat out cold and cuffed at his desk: the burn script has no actor'),
      D4: () => D.checkpoint('D4 Grethe joins (o2)'),
      D5: () => D.checkpoint('D5 the south guard out cold, cuffed and inside'),
      D6: () => D.checkpoint('D6 the north guard too: the black coats laid inside the office'),
      D7: () => D.checkpoint('D7 back from his round, the Kriminalrat out cold and cuffed at his desk'),
      D8: () => D.checkpoint('D8 Grethe joins (o2)'),
    };
    // he sits at his desk facing Grethe (west), his back to the door: the GB steps up behind him; then to her chair
    // (`maxSec`: out on his round, the GB waits in the corner until he sits down again: up to a whole round, Easy's
    // longer)
    const kriminalrat = async () => {
      const first = !g1.ko && !g2.ko;
      await strike(D, 'greenberet', g3, [45.3, 79.1], { ready: atDesk, quiet: 30, maxSec: Math.max(400, g3Horizon(D) + 30), trustVictim: true, label: 'at his desk' });
      (first ? cp.D3 : cp.D7)();
      await D.go('greenberet', 42.8, 79.6, { tol: 0.5 });
      await D.until(() => obj(D, 'o2')?.done, 10, 'Grethe joins');
      (first ? cp.D4 : cp.D8)();
    };
    // the two guards, each from behind and from a corner of the office out of the doorway's line: out at the door,
    // the blow, the cuffs and back in with him on the shoulder in one go while nobody looks at the office's face
    // (`carry`: the strike waits until the carry after it will find its way clear too). Laid by the north wall, out of
    // the doorway's lines. With the Kriminalrat out on his round, the man is laid only where he will not see him, on
    // his way back in nor at his desk, until he can be struck there (g3Sees: the office's north-east corner), and the
    // GB waits for him in that corner; should he sit down at his desk before a guard is taken, he is taken first. The
    // adjutant's beat runs down the parade past the office's face to the guardroom door, 2.5 m south of the south
    // guard: while he walks it, nobody steps out of that door; halted there, looking south down the passage, his back
    // is to the office and he stays so till his halt is over (half a minute; Easy 75 s): the guards are taken then, or
    // while he is up at the house (`bystanders`)
    const SITS = Symbol('the Kriminalrat sits at his desk');
    const guard = async (victim, at, via, pts, label, { fromDown, fromUp = null, later = [] }) => {
      const dump = pts[pts.length - 1];
      const dumpOk = () => g3Down() || !g3Sees(D, [dump], { mode: 'body' });
      for (;;) {
        if (!g3Down() && atDesk()) await kriminalrat();
        const from = g3Down() ? fromDown : fromUp;
        if (from) await D.go('greenberet', ...from, { tol: 0.3 });
        // (`hold`: on his feet behind the man until he sets off with him at the latest — the blow, the cuffs, the pick-up;
        // the walk with him is the `carry`'s)
        try {
          await strike(D, 'greenberet', victim, at, { via, hold: CUFFED_LATE + PICK + 1.5, quiet: 5, maxSec: 400, later, strict: true, bystanders: [adj], label,
            ready: () => { if (!g3Down() && atDesk()) throw SITS; return true; }, carry: { pts, ok: dumpOk } });
          break;
        } catch (e) { if (e !== SITS) throw e; }
      }
      await carryMan(D, 'greenberet', victim, pts, { maxWait: 15, quiet: 0, also: dumpOk, later, precise: true, label: 'into the office' });
      // (by the north wall, out of the doorway's lines: the office's south half shows through the door from the parade;
      // with the Kriminalrat out, in the corner he will not see)
      await D.go('greenberet', ...(g3Down() ? GB_WAIT : GB_POCKET), { tol: g3Down() ? 0.3 : 0.2 });
    };
    await guard(g2, [g2.x - 0.05, g2.z - 1.15], [inBy, [48.1, 79.6]], [[48.0, 79.4], inBy, G2_DUMP], 'south of the door', { fromDown: SE_CORNER });
    cp.D5();
    await guard(g1, [g1.x - 0.05, g1.z + 1.15], [inBy, [48.1, 78.4]], [[48.0, 78.6], inBy, NE_CORNER], 'north of the door', { fromDown: NE_CORNER, fromUp: NE_CORNER, later: [g2] });
    cp.D6();
    if (!g3Down()) await kriminalrat();
  }],
  ['E', 'The adjutant\'s tunic: the adjutant out cold at the guardroom; the Spy, a private, to the office; the tunic', async (D) => {
    const spy = D.c('spy'), adj = D.get('adj'), why = [];
    const inBy = [46.9, 79.0];
    // a private walking the yard: only the adjutant (a lieutenant, on his feet) and the Gestapo on the wall walk see
    // through the keeper's coat
    const toOffice = [[62.3, 88.0], [63.0, 87.3], [63.1, 86.2], [61.8, 84.7], [58.0, 82.9], [54.5, 81.4], [51.2, 80.2], [48.6, 79.1], inBy, SPY_OFFICE];
    const toOfficeWin = walkWindows(spy, [spy.x, spy.z], toOffice, { hold: 2, step: 0.75 });
    let adjIn = !!adj.ko;
    // two men at once. The Green Beret waits in the office for the adjutant's halt at the guardroom door (his back to the
    // office: the door guards are taken in it, or while he is up at the house, so after them he is often still there).
    // The Spy crosses the yard to the office as soon as his way is clear of the adjutant and the wall walk: while the
    // adjutant is up at the house, or once he lies bound in the office (not while he is carried through its door)
    await D.parallel(
      async () => {
        if (!adj.ko) { await D.go('greenberet', ...GB_WAIT, { tol: 0.3 }); await adjutant(D); }
        adjIn = true;
        D.checkpoint('E1 the adjutant out cold at the guardroom door, cuffed and laid in the office');
      },
      async () => {
        await D.until(() => {
          why.length = 0;
          if (adj.ko && !adjIn) return dbg(D, ['the adjutant being carried in'], 'the Spy to the office');
          return windowsClear(D, toOfficeWin, { slack: 0.6, why, except: blindTo(D, 'soldier') }) || dbg(D, why, 'the Spy to the office');
        }, 900, 'the Spy\'s walk to the office clear of the adjutant and the wall walk');
        for (const p of toOffice) await D.go('spy', ...p, { tol: 0.45 });
      },
    );
    D.checkpoint('E2 the Spy, a private to the yard, in the Gestapo office');
    await D.go('spy', ADJ_DUMP[0] + 0.3, ADJ_DUMP[1] - 1.0, { tol: 0.4 });
    D.ability('spy', 'hanger', adj);
    await D.until(() => adj.uniformTaken, 10, 'the adjutant\'s tunic taken');
    await D.idle('spy', 4);
    await dress(D, 'officer');
    D.checkpoint('E3 the Spy in the adjutant\'s tunic: an officer now');
  }],
  ['F', 'The commandant\'s house: the Spy, an officer, walks in; chloroform at the desk; the card index (o1)', async (D) => {
    const spy = D.c('spy'), cmd = D.get('cmd'), why = [];
    // only the Gestapo see through an officer's tunic: the two black coats on the wall walk
    const toHouse = [[46.6, 78.9], [48.6, 78.9], [48.6, 70.0], [47.4, 65.6], [47.0, 64.0], HOUSE_IN];
    const toHouseWin = walkWindows(spy, [spy.x, spy.z], toHouse, { hold: 2, step: 0.75 });
    await D.until(() => { why.length = 0; return windowsClear(D, toHouseWin, { slack: 0.6, why, except: blindTo(D, 'officer') }) || dbg(D, why, 'the Spy to the house'); },
      600, 'the Spy\'s walk to the house clear of the wall walk');
    for (const p of toHouse) await D.go('spy', ...p, { tol: 0.45 });
    D.checkpoint('F1 the Spy, an officer, walks across the parade into the commandant\'s house');
    // the commandant at his desk faces the west window: from behind, chloroform; cuffs
    await strike(D, 'spy', cmd, CMD_BEHIND, { via: [[45.6, 61.0]], hold: 6, quiet: 30, maxSec: 200, label: 'at his desk' });
    D.checkpoint('F2 the commandant chloroformed and cuffed at his desk');
    D.ability('spy', 'hand', D.item('index'));
    await D.until(() => obj(D, 'o1')?.done, 20, 'the card index taken');
    await D.idle('spy', 5);
    D.checkpoint('F3 the card index is ours (o1)');
  }],
  ['G', 'Out: the three of them back to the hoist house, down to the harbour, along the shore to the folboats (o5)', async (D) => {
    const gb = D.c('greenberet'), spy = D.c('spy'), gr = D.c('grethe'), why = [];
    const inBy = [46.9, 79.0];
    // the GB first: on his feet out of the office door (a man lying down does not fit a doorway), down at once outside
    // it, and back on his belly across the parade's south side the way he came, between the door's two (empty) posts'
    // old cones, to the alley
    const OUT_OFFICE = [inBy, [48.6, 79.1]];
    const BACK = [[51.2, 80.2], [54.5, 81.4], [58.0, 82.9], [61.8, 84.7], ALLEY_MOUTH];
    await D.stance('greenberet', 'stand');
    await D.until(() => {
      why.length = 0;
      const walkT = pathLen([[gb.x, gb.z], ...OUT_OFFICE]) / CONFIG.units.walk;
      if (!strictly(D, () => routeClear(D, OUT_OFFICE, { mode: 'walk', from: [gb.x, gb.z], speed: CONFIG.units.walk, slack: 0.6, hold: 1.2, why }))) return dbg(D, why, 'GB out of the office');
      if (!routeClear(D, BACK, { mode: 'crawl', from: OUT_OFFICE[1], delay: walkT + 1.0, slack: 0.6, slackRate: 0.08, hold: 2, why })) return dbg(D, why, 'GB back across the parade');
      return true;
    }, 900, 'a gap to cross the parade back to the alley');
    for (const p of OUT_OFFICE) await D.go('greenberet', ...p, { tol: 0.35 });
    await D.stance('greenberet', 'crawl');
    for (const p of BACK) await D.go('greenberet', ...p, { tol: 0.35 });
    // up the alley on his belly and on his feet through the hoist house's open west door (in the alley he is in the
    // quarters sentry's eye straight down it: he goes while the sentry's head is turned)
    await D.go('greenberet', 62.9, 87.3, { tol: 0.45 });
    await D.until(() => clearFor(D, [[gb.x, gb.z], ...THROUGH_W], 3.0, { mode: 'walk', why }), 300, 'a gap in the eyes down the alley');
    await D.stance('greenberet', 'stand');
    for (const p of THROUGH_W) await D.go('greenberet', ...p, { tol: 0.3 });
    await D.go('greenberet', ...RIDE_GB, { tol: 0.35 }); // (deeper in: room for the other two by the door)
    D.checkpoint('G1 the GB back in the hoist house');
    // Grethe (a civilian to all but the Gestapo) and the Spy (an officer) walk back to it: only the black coats on the
    // wall walk would see through either
    const greWay = [inBy, [48.6, 79.1], [51.2, 80.2], [54.5, 81.4], [58.0, 82.9], [61.8, 84.7], [63.1, 86.4], [62.9, 87.4], ...THROUGH_W, RIDE_GR];
    const greWin = walkWindows(gr, [gr.x, gr.z], greWay, { hold: 2, step: 0.75 });
    await D.until(() => { why.length = 0; return windowsClear(D, greWin, { slack: 0.8, why, except: blindTo(D, 'civilian') }) || dbg(D, why, 'Grethe to the hoist house'); },
      600, 'Grethe\'s walk to the hoist house clear of the wall walk');
    for (const p of greWay) await D.go('grethe', ...p, { tol: 0.45 });
    const spyWay = [[47.0, 64.4], [48.8, 66.6], [50.6, 70.2], [56.4, 76.2], [61.8, 84.7], [63.1, 86.4], [62.9, 87.4], ...THROUGH_W, RIDE_SPY];
    const spyWin = walkWindows(spy, [spy.x, spy.z], spyWay, { hold: 2, step: 0.75 });
    await D.until(() => { why.length = 0; return windowsClear(D, spyWin, { slack: 0.8, why, except: blindTo(D, 'officer') }) || dbg(D, why, 'the Spy to the hoist house'); },
      600, 'the Spy\'s walk to the hoist house clear of the wall walk');
    for (const p of spyWay) await D.go('spy', ...p, { tol: 0.45 });
    D.checkpoint('G2 Grethe and the Spy walk back across the yard to the hoist house');
    // down the hoist, the three of them (the GB steps up to its gate to work it)
    await D.go('greenberet', 67.6, 87.7, { tol: 0.3 });
    await rideHoist(D, 'greenberet');
    D.checkpoint('G3 down the hoist into the harbour magazine');
    // (the Spy and Grethe stand aside, east in the magazine, out of the GB's way to its door — the GB first steps off
    // the cage towards the door, out of their ways east: standing in the Spy's he had to step aside for him, and his
    // step aside, taken while Grethe walked up, could land on her spot and stop her short)
    await D.go('greenberet', 85.0, 129.5, { tol: 0.4 });
    await D.parallel(() => D.go('spy', 86.6, 127.4, { tol: 0.4 }), () => D.go('grethe', 86.8, 128.6, { tol: 0.4 }));
    // out of the magazine's door on their bellies and round its west side, then along the shore under the glacis
    for (const role of ['greenberet', 'spy', 'grethe']) {
      await D.stance(role, 'crawl');
      await sneak(D, ...MAG_W, { mode: 'crawl', role, label: `${role} out of the magazine`, box: 8, keepWalker: 2, keep: 1, maxWait: 300 });
      await sneak(D, ...MAG_BACK_W, { mode: 'crawl', role, label: `${role} behind the magazine`, box: 8, maxWait: 300 });
    }
    D.checkpoint('G4 out of the magazine and round its back, under the glacis');
    await D.parallel(
      () => sneak(D, ...COVE_GB, { mode: 'crawl', role: 'greenberet', label: 'GB along the shore to the cove', box: 14, horizon: 400 }),
      async () => { await D.wait(4); await sneak(D, ...COVE_SPY, { mode: 'crawl', role: 'spy', label: 'Spy along the shore to the cove', box: 14, horizon: 400 }); },
      async () => { await D.wait(8); await sneak(D, ...COVE_GR, { mode: 'crawl', role: 'grethe', label: 'Grethe along the shore to the cove', box: 14, horizon: 400 }); },
    );
    await D.until(() => obj(D, 'o5')?.done, 30, 'all in the cove');
    D.checkpoint('G5 everyone at the folboats in the cove (o5)');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  if (STOP) { const cp = D.checkpoint; D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  D.straightDashes = true;
  w.sneakTurns = true;
  if (DBG) w.events.on('door', (p) => D.log(`DBG ${D.t.toFixed(1)} door ${p.id} ${p.open ? 'open' : 'shut'}`));
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
