/**
 * M00 "Sandbox" (training ground): a full solution played only with player orders — the fuel depot blown and all
 * three commandos at the extraction point, nobody ever spotted. Driver API: tools/solutions/driver.mjs; regression
 * test tests/m00-solution.test.mjs; reference run in the real game: node tools/solutions/run-browser.mjs m00.
 *
 * The map: a river with one bridge; the enemy compound east of it has a single way in (the gap in its west wall at the
 * bridge's east end), watched by the bridge sentry S, who sweeps the whole bridge every 2 s (no gap long enough to
 * cross, even crawling). Inside: the officer O (by the barracks, facing the depot), the patrol P (round the depot) and
 * the depot guard G (facing the west wall). On the west bank the road patrol W walks the road up to the bridge.
 *
 * Outline (each specialist does his own job; every kill is unseen and no living man ever sees a body — the test
 * asserts no guard ever sets eyes on one):
 *   A  the Sniper crawls to the river bank south of the bridge, 42 m from the officer (out of S's near band, prone in
 *      his far band: unseen; and so far back that neither O nor P can see him when he kneels to fire — a kneeling Sniper
 *      counts as standing, spec §3.4). Through the wall gap he shoots O just as P, at the north end of his beat, turns
 *      and walks south into the line of fire with his back to O, then P a second later (the bolt), before P could ever
 *      turn round and see O's body. He then crawls 9 m up the bank to a spot that sees S
 *   B  the Sapper sets his bear trap on W's beat at the west end of the road while W walks away east
 *   C  the Sniper shoots S as W turns back west (W's back to the bridge) at a moment when neither S nor G looks his way
 *      (he kneels to fire); W walks on west into the trap
 *   D  the Green Beret crosses the bridge, crawls round the sandbags and knifes G from behind
 *   E  the Sapper sets a time bomb against the depot and runs; all three make for the extraction point in the
 *      north-west. The depot is a bomb-only target and a blast is heard map-wide, but with every guard down nobody is
 *      left to raise the alarm: the run ends with no alarm at all
 * Every shot waits for its 0.6 s aim to be unseen by every living man, the target included (kneelHidden).
 * Kills: O, P, S (rifle, 3 of 5 rounds), W (bear trap), G (knife). Items: rifle ×3, bear trap, one time bomb.
 */
import { canSee, coneAt } from '../../src/ai/perception.js';
import { shotClear } from '../../src/abilities/weapons.js';
import { predictEnemy } from './driver.mjs';

const alive = (D) => D.world.enemies.filter((e) => e.alive && !e.removed && e.vision);
const walking = (e) => !!(e.isMoving || e.path || (e.route && e.route.length > 1 && !e.brain?.distractedBy));

/** Will enemy `e` see `dummy` `t` s from now? Static men: their cone at that time; walkers: predicted on their beat. */
function seesAt(D, e, dummy, t) {
  const w = D.world;
  if (!walking(e)) return canSee(e, dummy, w, { cone: coneAt(e, w.time + t) }) !== 'none';
  const q = predictEnemy(e, t), amp = e.vision?.sweep ?? 0;
  // the headings he may face then: the predicted one, the way he came in at a halt (q.alt), and — the prediction turns
  // him at once where the man turns at 180°/s — every heading on the arc from where he faced a second earlier, on both
  // arcs for an about-turn (either way round: a patrol leaving the end of his beat sweeps his cone across everything
  // beside him)
  const hs = [q.heading];
  if (q.alt != null) hs.push(q.alt);
  const h0 = t >= 1 ? predictEnemy(e, t - 1).heading : e.heading; // (now: the way he faces, mid-turn too)
  if (t < 0.05) hs.push(e.heading);
  const d = Math.atan2(Math.sin(q.heading - h0), Math.cos(q.heading - h0));
  if (Math.abs(d) > 0.15) for (let k = 1; k < 12; k++) {
    hs.push(h0 + (d * k) / 12);
    if (Math.abs(d) > 2.9) hs.push(h0 + ((d - Math.sign(d) * 2 * Math.PI) * k) / 12);
  }
  for (const h of hs) {
    for (const off of amp ? [0, amp / 2, -amp / 2, amp, -amp] : [0]) { // a walker's head turns: try the whole sweep
      const g = Object.create(e);
      g.x = q.x; g.z = q.z; g.heading = h; g.sweepActive = false; g.headOffset = off;
      if (canSee(g, dummy, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
    }
  }
  return false;
}
const upright = (u) => ({ x: u.x, z: u.z, y: 0, isLow: false, isVisibleToEnemies: true });
const body = (x, z) => ({ x, z, y: 0, kind: 'enemy', alive: false, hp: 0, state: 'dead', isVisibleToEnemies: false });

/** Nobody but `victim` (and `except`) will see him standing for the next `dur` s: a kill nobody witnesses. */
function unwitnessed(D, victim, dur = 1.5, except = []) {
  for (const e of alive(D)) {
    if (e === victim || except.includes(e)) continue;
    for (let t = 0; t <= dur + 1e-6; t += 0.1) if (seesAt(D, e, upright(victim), t)) return false;
  }
  return true;
}
/** Nobody (but `except`) will see the Sniper from `a` to `b` s from now as if he stood where he lies: he kneels to aim,
 * and a kneeling Sniper counts as standing — seen in the far band too (spec §3.4) — so every shot needs this for its
 * 0.6 s aim (the target included: a man who sees him kneel spots him before the round lands). */
function kneelHidden(D, a = 0, b = 0.8, except = []) {
  const sn = upright(D.c('sniper'));
  for (const e of alive(D)) {
    if (except.includes(e)) continue;
    for (let t = a; t <= b + 1e-6; t += 0.1) if (seesAt(D, e, sn, t)) return false;
  }
  return true;
}
/** kneelHidden, polled every tick, true only once it has held for `n` ticks running (a margin of a few ticks: the
 * tests time the aim from the kill back, a tick or two either side). Evaluate it first in a condition. */
function kneelSteady(D, n = 3) {
  let run = 0;
  return () => (run = kneelHidden(D) ? run + 1 : 0) >= n;
}
/** Nobody (but `except`) will see a body at (x, z) for the next `dur` s. */
function bodyHidden(D, x, z, dur, except = []) {
  for (const e of alive(D)) {
    if (except.includes(e)) continue;
    for (let t = 0; t <= dur + 1e-6; t += 0.25) if (seesAt(D, e, body(x, z), t)) return false;
  }
  return true;
}
/** The Sniper has `e` in his sights now and (predicted) `lead` s from now: the round leaves after the 0.6 s aim. */
function inSights(D, e, lead = 0.8) {
  const sn = D.c('sniper'), w = D.world, R = 44;
  if (Math.hypot(e.x - sn.x, e.z - sn.z) > R || !shotClear(w, sn, e, true)) return false;
  if (!walking(e)) return true;
  const q = predictEnemy(e, lead), g = Object.create(e);
  g.x = q.x; g.z = q.z;
  return Math.hypot(g.x - sn.x, g.z - sn.z) <= R && shotClear(w, sn, g, true);
}
/** Where the Sniper (lying where he is) could drop walker `e` within `horizon` s: the first predicted moment `t` at which
 * `e` is in his sights (now and through the aim) and nobody else will see him fall nor where he falls, plus the end
 * `t1` of that stretch in the sights; null when there is none. `except`: men who will be dead by then; `from`: the
 * earliest the Sniper can fire again (aim and bolt). */
function shotWindow(D, e, horizon = 30, except = [], from = 0) {
  const sn = D.c('sniper'), w = D.world, R = 44;
  const at = (t) => { const q = predictEnemy(e, t), g = Object.create(e); g.x = q.x; g.z = q.z; return g; };
  const clear = (t) => { const g = at(t); return Math.hypot(g.x - sn.x, g.z - sn.z) <= R && shotClear(w, sn, g, true); };
  let t0 = null;
  for (let t = from; t <= horizon; t += 0.25) {
    if (!clear(t) || !clear(t + 0.8)) { if (t0 != null) return { t: t0, t1: t }; continue; }
    if (t0 != null) continue;
    if (!kneelHidden(D, t, t + 0.8, except)) continue; // (nobody, the target included, sees him kneel to aim)
    const g = at(t + 0.8), others = alive(D).filter((o) => o !== e && !except.includes(o));
    const seen = others.some((o) => { for (let u = 0; u <= 1.5; u += 0.25) if (seesAt(D, o, upright(g), t + u)) return true; return false; })
      || others.some((o) => { for (let u = 0; u <= 10; u += 0.5) if (seesAt(D, o, body(g.x, g.z), t + u)) return true; return false; });
    if (!seen) t0 = t;
  }
  return t0 == null ? null : { t: t0, t1: horizon };
}
async function snipe(D, e, label) {
  const sn = D.c('sniper'), n0 = sn.inventory.get('sniperRifle');
  D.ability('sniper', 'sniper', e);
  await D.until(() => !e.alive, 4, `${label} shot`)
    .catch(() => { throw new Error(`${label}: the shot did not go off (rounds ${n0} -> ${sn.inventory.get('sniperRifle')})`); });
}

/** Crawl along `pts`, each leg only when nobody will see it (waiting where he lies — every waypoint is a safe spot). */
async function sneak(D, role, pts, { maxWait = 300, when = null, speed = 0.9, pause = 0 } = {}) {
  for (const [x, z] of pts) {
    const why = [];
    await D.until(() => { why.length = 0; return (!when || when()) && D.routeClear(role, [[x, z, pause]], { speed, delay: 0.3, minDist: 4, why }); }, maxWait, `${role}: clear leg to (${x},${z})`)
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    await D.go(role, x, z, { tol: 0.4 });
  }
}

// Where things are (m00_sandbox.js; keep in step with the map)
// river bank S of the bridge, 42 m off O (the rifle reaches 45): through the wall gap onto O and P's walk past it, and
// beyond both men's far bands when he kneels to fire (from (35, 48), the old spot, P saw him kneel)
const SPOT_O = [30.8, 54.8];
const SPOT_S = [33, 46]; // 9 m up the bank: onto the bridge sentry (21 m off: his far band, so the man lying here is unseen)
const HIDE_W = [4.5, 38.5]; // out of W's sight on every step of his beat
const NOOK = [6, 25.5]; // NW of the roadside bush: W never looks here either
const STAB_FROM = [49.2, 38.8]; // at G's back (48.5, 38), between him and the depot: 1 m off, inside knife reach
const TRAP_FROM = [14.5, 28.1], TRAP_Z = 27; // by the road, a step east of W's west-end halt (14.3, 27)

/** The look-ahead helpers (tests and debugging). */
export const helpers = { seesAt, unwitnessed, kneelHidden, bodyHidden, inSights, shotWindow };

export const STAGES = [
  ['A', 'Sniper: the officer and the compound patrol', async (D) => {
    const O = D.get('officer'), P = D.get('patrol_east');
    // all three down on their bellies at once: W's far band reaches the start (a man lying there is unseen)
    for (const r of ['sniper', 'greenberet', 'sapper']) await D.stance(r, 'crawl');
    await D.path('sniper', [[20, 54], SPOT_O], { tol: 0.4 });
    D.checkpoint('A1 Sniper on the bank');
    // O falls only at the start of P's walk south (x 49, just off his halt at z 20, his back to the barracks) into the
    // line of fire through the gap: P will be in the sights, with nobody else to see him fall, before he could ever
    // turn and see O's body — and O's body stays out of every living man's sight (P's too) until P's chance has passed.
    // (P sees the officer's spot whenever he walks north, on either long side of his beat: shot at any other moment,
    // O's body would draw P to it, then the alarm.)
    // Both aims (on O, then on P) must go unseen by every living man: kneeling, the Sniper counts as standing (§3.4).
    let win = null;
    const kneelO = kneelSteady(D);
    await D.until(() => {
      const k = kneelO();
      // (P already walking south — turned from the halt at the north end of his walk, where he faces the barracks)
      if (!(P.alive && P.isMoving && Math.sin(P.heading) > 0.9 && P.z < 30 && inSights(D, O) && unwitnessed(D, O) && k)) return false;
      win = shotWindow(D, P, 25, [O], 1.5); // (O dead by then; 1.5 s: the aim on O, the bolt, the aim on P)
      return !!win && bodyHidden(D, O.x, O.z, win.t1 + 3, [O]);
    }, 300, 'the officer alone in the sights, P about to walk past the gap');
    await snipe(D, O, 'officer');
    D.checkpoint('A2 officer down');
    // P past the gap: O is gone, S looks west, G at the wall, and P has not seen O's body (he walks away from it)
    const kneelP = kneelSteady(D);
    await D.until(() => {
      const k = kneelP();
      if (P.sawBody || P.brain?.state !== 'IDLE') throw new Error(`patrol_east left his beat (${P.brain?.state}${P.sawBody ? ', saw a body' : ''})`);
      return D.t >= (D.c('sniper')._boltT ?? -1) && inSights(D, P) && k && unwitnessed(D, P) && bodyHidden(D, P.x, P.z, 10, [P]); // (bolt worked)
    }, win.t1 + 1, 'P in the gap'); // (inside the stretch O's body was checked hidden for)
    await snipe(D, P, 'patrol');
    D.checkpoint('A3 compound patrol down');
    // on to the spot for the bridge sentry now, before the trap goes down: he must be ready there when the road patrol
    // next turns back west (S dies on that walk, before W reaches the trap)
    await D.go('sniper', ...SPOT_S, { tol: 0.4 });
  }],
  ['B', 'Sapper: a bear trap on the road patrol\'s beat', async (D) => {
    const W = D.get('patrol_west'), sap = D.c('sapper');
    await D.stance('sapper', 'crawl');
    await D.path('sapper', [[8, 46], HIDE_W], { tol: 0.5 });
    await sneak(D, 'sapper', [[5, 31], NOOK]);
    D.checkpoint('B1 Sapper in the nook by the bush');
    // out to the road while W walks away east, the trap down, back before he turns
    const out = [[...TRAP_FROM, 1.5], NOOK];
    await D.until(() => Math.cos(W.heading) > 0.5 && W.x > 17.5 && W.x < 24 && D.routeClear('sapper', out, { delay: 0.3, minDist: 4 }), 300, 'W walks away east');
    await D.go('sapper', ...TRAP_FROM, { tol: 0.3 });
    // on W's line (z 27), within the 1.5 m reach, a little east of where he lies (W comes back that way)
    D.ability('sapper', 'trap', { x: sap.x + 0.8, z: TRAP_Z });
    await D.until(() => !sap.has('bearTrap'), 5, 'trap set');
    await D.idle('sapper');
    await D.go('sapper', ...NOOK, { tol: 0.4 });
    D.checkpoint('B2 trap set on the road');
  }],
  ['C', 'Sniper: the bridge sentry; the road patrol walks into the trap', async (D) => {
    const S = D.get('sentry_bridge'), W = D.get('patrol_west');
    // W has turned back west (his back to the bridge: he never sees S fall nor his body) and G's head is turned away
    const kneelS = kneelSteady(D);
    await D.until(() => {
      const k = kneelS();
      if (!W.alive) throw new Error('the road patrol reached the trap with the bridge sentry still alive');
      return Math.cos(W.heading) < -0.5 && W.x > 19 && inSights(D, S, 0) && k && unwitnessed(D, S, 1.5) && bodyHidden(D, S.x, S.z, 12, [S, W]);
    }, 300, 'S alone, W walking west');
    await snipe(D, S, 'bridge sentry');
    D.checkpoint('C1 bridge sentry down');
    await D.until(() => !W.alive, 60, 'W in the trap');
    D.checkpoint('C2 road patrol trapped');
  }],
  ['D', 'Green Beret: over the bridge, the depot guard from behind', async (D) => {
    const G = D.get('guard_fuel');
    await D.stance('greenberet', 'crawl');
    await D.path('greenberet', [[20, 46], [33.5, 36], [34.5, 30]], { tol: 0.5 });
    // through the gap and round the far (east) side of the depot, out of G's sight behind it, to his south: the
    // sandbags joined to the wall shut the pocket he stands in to the north
    await sneak(D, 'greenberet', [[44.8, 29.8], [46.8, 30.2], [52, 32.5], [56, 34.8], [56, 41.2], [51.5, 41.6], [49.3, 40.6]]);
    // G's head sweeps ±50° round west: everything east of him (x > 48.5) stays out of his cone all the time. The
    // Green Beret crawls up into the strip between G and the depot, within knife reach at G's back, so that he
    // stands up and stabs there (nowhere on the open south side, which the south end of the sweep reaches).
    await sneak(D, 'greenberet', [STAB_FROM]);
    await D.until(() => D.clearAhead(D.c('greenberet').x, D.c('greenberet').z, 2, false), 30, 'G looking away');
    D.ability('greenberet', 'knife', G);
    await D.until(() => !G.alive, 15, 'G knifed');
    D.checkpoint('D1 depot guard knifed');
  }],
  ['E', 'Sapper: the depot goes up; everyone to the extraction point', async (D) => {
    const sap = D.c('sapper');
    for (const r of ['sapper', 'sniper', 'greenberet']) await D.stance(r, 'stand');
    D.order('sniper', { type: 'move', x: 6.5, z: 6.5 });
    D.order('greenberet', { type: 'move', x: 5.5, z: 8 });
    await D.go('sapper', 52, 35.0, { tol: 0.3 });
    await D.face('sapper', 52, 38);
    D.ability('sapper', 'timeBomb');
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) === 1, 5, 'bomb set');
    D.checkpoint('E1 time bomb at the depot');
    await D.idle('sapper');
    D.order('sapper', { type: 'move', x: 7, z: 7.5, run: true });
    await D.until(() => D.world.objectives.find((o) => o.id === 'destroy_fuel').done, 20, 'depot destroyed');
    D.checkpoint('E2 depot destroyed');
    await D.until(() => D.world.objectives.every((o) => o.done), 120, 'everyone at the extraction point');
    D.checkpoint('E3 extracted: mission complete');
  }],
];

/** Play the whole mission (ctx.from / ctx.until: a slice of the stages, for debugging). */
export async function solve(D, ctx = {}) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
