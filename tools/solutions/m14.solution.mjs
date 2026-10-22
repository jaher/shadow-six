/**
 * M14 "D-Day Kick Off" (La Rivière, Normandy): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m14 (also tests/m14-solution.test.mjs).
 *
 * Outline (the team starts in the rowboat off the SW beach; the sea is the highway, the Marine rows):
 *   A  out along the south edge, beyond every beach guard's sight, to the south beach
 *   B  gun 1 …
 * Orders only (move / crawl / stance / ability / leave & board the boat); timing reads what a player sees: the cones.
 */
import { sneak, clearFor, routeClear, alarmEta, alarmEtaInfo, teamBoat, predict, unwitnessed, viewersOf, walking, walkerSees, wheeling, staticSees } from './sneak.mjs';
import { T } from '../../src/world/grid.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const objective = (D, id) => D.world.objectives.find((q) => q.id === id).done;
const boatOf = (D) => D.world.byId?.('boat') || teamBoat(D.world);
const aboard = (D, r) => D.c(r).vehicle === boatOf(D);

/** Row the boat (the Marine at the oars) to (x, z), timing each stretch between the sweeps. */
async function row(D, x, z, o = {}) {
  await sneak(D, x, z, { mode: 'boat', boat: boatOf(D), label: o.label || `row (${x},${z})`, ...o });
}

/**
 * Row straight along `pts` (a player's clicks) once nobody will see the boat on the way; `run` = pull hard (4 m/s).
 * Waits up to `maxWait` s for the stretch to be clear, then goes leg by leg.
 */
async function rowOpen(D, pts0, { run = false, maxWait = 120, label = 'row', slack = 0.5, now = false } = {}) {
  const b = boatOf(D), sp = run ? 3.9 : 2.3, why = [];
  // (a click within arm's length of where the boat lies: nothing to row)
  const pts = pts0.filter(([x, z], k) => k > 0 || Math.hypot(x - b.x, z - b.z) > 1.5);
  if (!pts.length) return;
  // (the boat first turns on the spot at 45°/s to the first leg's heading)
  const turn = () => { const h = Math.atan2(pts[0][1] - b.z, pts[0][0] - b.x); let d = Math.abs(h - b.heading) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d / (Math.PI / 4); };
  // (`now`: checked beforehand — waiting out in the open would only make it worse)
  if (!now) await D.until(() => { why.length = 0; return routeClear(D, pts, { mode: 'boat', from: [b.x, b.z], speed: sp, delay: 0.15 + turn(), slack, why }); }, maxWait, `${label} clear`)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  for (const [x, z] of pts) {
    D.order('diver', { type: 'move', x, z, run });
    const t0 = D.t;
    await D.until(() => (Math.hypot(b.x - x, b.z - z) < 1.5) || (D.t > t0 + 1 && !b.goal && (b.speed || 0) < 0.05), 200, `${label} → (${x},${z})`);
  }
  await D.until(() => (b.speed || 0) < 0.1 || !b.goal, 10, `${label} stops`);
}

/**
 * Crawl (or walk) along `pts` in one go, once nobody will see him anywhere on the way (routeClear: the cones predicted
 * as he passes, `pad` m of margin at the edge of a band) nor at its end for `hold` s (where he may lie a while). The
 * lists given are runs from one safe spot (no cone reaches it) to the next: he never waits half-way.
 */
async function moveOpen(D, role, pts, { mode = 'crawl', maxWait = 240, label = 'move', hold = 4, pad = 1.2, fast = null, also = null, slow = null, slack = 0.5 } = {}) {
  const u = D.c(role);
  // a man lying down who is to walk stands up only when the walk is clear (getting up: ~0.6 s, seen where he lies)
  const rise = mode !== 'crawl' && u.stance === 'crawl' ? 0.7 : 0;
  if (mode === 'crawl') await D.stance(role, 'crawl');
  const sp = slow ?? (mode === 'crawl' ? 0.8 : 2.0);
  if (mode !== 'crawl' && !fast) fast = 2.3; // (a walker: 2.25 m/s)
  const why = [];
  let lastDbg = D.t;
  await D.until(() => {
    if (D.t - lastDbg > 30) { lastDbg = D.t; D.log?.(`DBG ${label}: waiting [${why.slice(0, 4).join(' ')}]`); }
    why.length = 0;
    if (also && !also()) { why.push('not quiet'); return false; }
    if (rise && !routeClear(D, [[u.x, u.z]], { mode, from: [u.x, u.z], delay: rise / 2, slack: rise / 2 + 0.2, why, pad })) return false;
    if (!routeClear(D, pts, { mode, from: [u.x, u.z], speed: sp, delay: 0.2 + rise, slack, why, pad })) return false;
    // (`fast`: his true pace may be quicker on a long run: the route tried at that pace too)
    if (fast && !routeClear(D, pts, { mode, from: [u.x, u.z], speed: fast, delay: 0.2 + rise, slack, why, pad })) return false;
    let t = 0.2 + rise, [x, z] = [u.x, u.z];
    for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / sp; x = px; z = pz; }
    const end = pts[pts.length - 1];
    for (let h = 0; h <= hold; h += 0.5) if (!routeClear(D, [end], { mode, from: end, delay: t + h, slack: 0, why, pad })) return false;
    return true;
  }, maxWait, `${label} → (${pts[pts.length - 1]}) clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  if (mode !== 'crawl') await D.stance(role, 'stand');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.4, max: 120 });
}


/** Every one of `tags` dead or on his beat (IDLE). */
const onBeatTags = (D, tags) => tags.every((t) => { const e = D.get(t); return !e?.alive || e.brain?.state === 'IDLE'; });

/**
 * e38 at the decoy, Patrol 43 walking its beat (not drawn to the decoy): a moment's switch-off releases the patrol
 * when it stands at the decoy, the decoy on again once the patrol has walked off west (and e38 back to it).
 */
async function patrolAway(D) {
  const gb = D.c('greenberet'), e38 = D.get('e38'), p43 = ['p43a', 'p43b', 'p43c'].map((t) => D.get(t));
  const staring = (e) => e.brain?.state === 'DECOY' && e.brain.phase === 'stare';
  if (p43.some((e) => e.alive && (e.brain?.state === 'DECOY' || Math.hypot(e.x - 63.4, e.z - 39.1) < 14))) {
    if (gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
    await D.until(() => onBeatTags(D, ['p43a', 'p43b', 'p43c']) && p43.every((e) => !e.alive || (e.x < 48 && Math.cos(e.heading) < 0)), 400, 'patrol 43 back on its beat, walking west');
  }
  if (!gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
  await D.until(() => !e38.alive || staring(e38), 300, 'e38 at the decoy');
}

/**
 * The north side quiet after the alarm: no new cry for 45 s, and every guard within 70 m of the north beach on his
 * beat, at his post, on his squad's round or staring at a lure (nobody running, searching or kneeling by a body).
 */
function quietNorth(D, ne = false) {
  const w = D.world, fired = w.alarm?.zonesFired || [];
  if (fired.length && w.time - fired[fired.length - 1].t < 45) return false;
  const calm = ['IDLE', 'REINFORCE', 'DECOY', 'RETURN'];
  return w.enemies.every((e) => !e.alive || e.removed || calm.includes(e.brain?.state)
    || (Math.hypot(e.x - 55, e.z - 40) > 70 && (!ne || Math.hypot(e.x - 100, e.z - 30) > 45)));
}

/** The Marine slips over the side under water (diving gear on: first time from the boat, then he keeps it on). */
async function overSide(D) {
  const dv = D.c('diver');
  if (dv.diving) D.ability('diver', 'leaveVehicle'); else D.ability('diver', 'dive');
  await D.until(() => dv.underwater && !dv.vehicle, 10, 'Marine under water');
}

/** The Marine swims back to the boat and climbs in. */
async function marineAboard(D) {
  const dv = D.c('diver'), b = boatOf(D);
  await D.go('diver', b.x + 2, b.z, { tol: 1.5, max: 150 });
  D.ability('diver', 'enterVehicle', b);
  await D.until(() => aboard(D, 'diver'), 15, 'Marine aboard');
}

/** Climb back into the boat from the bank when nobody will see him get up and in. */
async function boardBoat(D, role, { margin = 0.8, pad = 0 } = {}) {
  const u = D.c(role), b = boatOf(D);
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(b.x - u.x, b.z - u.z) / 1.5 + 0.6 + margin;
  await D.until(() => clearFor(D, [[u.x, u.z], [b.x, b.z]], dur, { mode: 'walk' })
    && (!pad || [[u.x, u.z], [b.x, b.z]].every((p) => routeClear(D, [p], { mode: 'walk', from: p, delay: dur / 2, slack: dur / 2, pad }))), 300, `${role} boards`);
  D.ability(role, 'enterVehicle', b);
  await D.until(() => u.vehicle === b, 15, `${role} aboard`);
}

/**
 * Step off the boat when nobody will see the bank, wade to the first dry cell (`land`, no prints in the shallows) and
 * get down on the belly.
 */
async function landProne(D, role, { hold = 3, land = null, extra = null } = {}) {
  const u = D.c(role), b = boatOf(D);
  const pts = [[b.x, b.z], ...(land ? [land] : [])];
  await D.until(() => (!extra || extra()) && clearFor(D, pts, hold, { mode: 'walk' }), 300, `${role} lands`);
  D.ability(role, 'leaveVehicle');
  await D.wait(0.05);
  const g = D.world.grid;
  const wet = () => { const t = g.terrainAt(u.x, u.z); return t === T.WATER || t === T.SHALLOW; };
  if (wet()) {
    const [lx, lz] = land || dryNear(D, u.x, u.z);
    // (a mate already lying there may leave him a step short: any dry cell close by will do)
    await D.go(role, lx, lz, { tol: 0.3 }).catch((e) => { if (wet() || Math.hypot(u.x - lx, u.z - lz) > 2) throw e; });
  }
  await D.stance(role, 'crawl');
  return u;
}

/** The nearest dry walkable cell to (x, z). */
function dryNear(D, x, z) {
  const g = D.world.grid;
  let best = null, bd = Infinity;
  for (let dz = -6; dz <= 6; dz += 0.5) for (let dx = -6; dx <= 6; dx += 0.5) {
    const px = x + dx, pz = z + dz, t = g.terrainAt(px, pz);
    if (t === T.WATER || t === T.SHALLOW || !g.walkableAt(px, pz)) continue;
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}

export const STAGES = [
  ['A', 'Out along the south edge to the south beach', async (D) => {
    await D.until(() => aboard(D, 'diver'), 5, 'the team seated');
    D.checkpoint('A0 the team in the rowboat off the south-west beach');
    // well out to sea, beyond every beach guard's cone (36 m), then up to a holding point off the south beach
    await rowOpen(D, [[30, 205.5], [68, 199]], { run: true, label: 'south edge' });
    D.checkpoint('A1 off the south beach, out of sight');
  }],
  ['B', 'Gun 1: the Marine works the south waterline', async (D) => {
    const dv = D.c('diver'), b = boatOf(D);
    // 1) the boat lies well out (nobody's cone reaches it); the Marine slips over the side and swims in under water
    await rowOpen(D, [[...BOAT_S]], { label: 'off the south beach' });
    await overSide(D);
    D.checkpoint('B1 the Marine goes over the side');
    await D.go('diver', ...WATERLINE_S, { tol: 0.6, max: 90 });
    D.checkpoint('B2 the Marine waits under water at the south waterline');
    // 2) Patrol 12 halts at the east end of its beat, by the water, all three looking out east: the Marine spears the
    // rear man, the Sniper (kneeling in the boat, 40 m out) drops the other two — nobody up the beach looking down
    const p12 = ['p12c', 'p12b', 'p12a'].map((t) => D.get(t));
    const strip = [[76.5, 148], [78, 148], [80, 148]];
    await D.until(() => p12[2].brain.atWait && p12[2].x > 79 && p12.every((e) => !e.isMoving && Math.cos(e.heading) > 0.7)
      && (p12[2].brain.waitT ?? 0) > 2.5
      && Math.hypot(p12[0].x - dv.x, p12[0].z - dv.z) < 8.5
      && clearFor(D, strip, 3, { mode: 'body', except: p12 }) && p12.every((e, k) => unwitnessed(D, e, dv, { except: p12.slice(0, k), ahead: 0.4 + 1.2 * k })),
    600, 'patrol 12 halted at the waterline, nobody looking');
    D.ability('diver', 'harpoon', p12[0]);
    await snipe(D, p12[1], { maxSec: 4 });
    await snipe(D, p12[2], { maxSec: 4 });
    await D.until(() => p12.every((e) => !e.alive), 4, 'patrol 12 down');
    D.checkpoint('B3 Patrol 12 dropped at the waterline: harpoon and rifle');
    // 3) the bodies by the water bring e14 and e13 down to it, one by one: each is speared on the way, before he can
    // kneel and cry out
    await baitKills(D, ['e14', 'e13'], { maxSec: 240 });
    D.checkpoint('B4 e14 and e13 speared by the bodies');
    // 4) back to the boat under water; the Sapper is rowed in to the west end of the beach
    await marineAboard(D);
    D.checkpoint('B5 the Marine back in the boat');
    // (the men who came down to look at the bodies back on their beats first)
    await calm(D, [70, 140], 40, 400);
    await rowOpen(D, [[...LANDING_G1]], { label: 'gun 1 landing', maxWait: 400 });
    await landProne(D, 'sapper', { land: LANDING_G1_SHORE });
    D.checkpoint('B6 the Sapper ashore below gun 1');
    await sneak(D, ...PLANT_G1, { mode: 'crawl', role: 'sapper', box: 6, label: 'Sapper to gun 1' });
    await D.face('sapper', ...G1_FRONT);
    D.ability('sapper', 'remoteBomb');
    await D.until(() => (D.c('sapper').inventory.get('remoteBomb') ?? 0) === 2, 10, 'charge one set');
    D.checkpoint('B7 charge one at the embrasure of gun 1');
    await sneak(D, ...LANDING_G1_SHORE, { mode: 'crawl', role: 'sapper', box: 6, label: 'Sapper back to the boat' });
    await boardBoat(D, 'sapper');
    D.checkpoint('B8 the Sapper back aboard');
  }],
  ['C', 'Gun 2: the east beach', async (D) => {
    const dv = D.c('diver'), b = boatOf(D);
    const e27 = D.get('e27'), e28 = D.get('e28');
    // 1) round the south spit, well out; the Marine goes over the side and swims up the east beach under water
    await rowOpen(D, [[66, 177], [100, 175], [...BOAT_SE]], { label: 'round the south spit' });
    await overSide(D);
    D.checkpoint('C1 off the south spit, the Marine over the side');
    await D.go('diver', ...WATERLINE_E, { tol: 0.6, max: 120 });
    D.checkpoint('C2 the Marine at the east waterline');
    // 2) e27 halts at the north end of his beat looking up the beach: speared from the water
    await D.until(() => e27.brain.atWait && Math.hypot(e27.x - 104, e27.z - 100) < 1.5 && Math.hypot(e27.x - dv.x, e27.z - dv.z) < 8.6
      && (e27.brain.waitT ?? 0) > 1 && unwitnessed(D, e27, dv), 300, 'e27 at the north end of his beat, nobody looking');
    D.ability('diver', 'harpoon', e27);
    await D.until(() => !e27.alive, 3, 'e27 harpooned');
    D.checkpoint('C3 e27 speared at the north end of the east beach');
    // 3) only e23, at the end of his beat west of gun 2, can see that spot: he comes down to the body and is speared too
    await baitKills(D, ['e23'], { maxSec: 240 });
    D.checkpoint('C4 e23 speared by the body');
    // 4) back aboard; the boat lands the Green Beret and the Sapper on the empty north part of the beach. The Green
    // Beret crawls up behind e28 (the post below gun 2's embrasure faces out to sea) and knifes him
    await marineAboard(D);
    // (round e28's sight: out to the east edge and in from the north-east, where his sweep never reaches)
    await rowOpen(D, [[...SNIPE_E], [131, 125], [131, 101]], { label: 'off the east beach' });
    await rowOpen(D, [[122, 95.5], [...LANDING_G2]], { label: 'gun 2 landing', maxWait: 400 });
    await landProne(D, 'greenberet', { land: LANDING_G2_SHORE });
    await landProne(D, 'sapper', { land: [LANDING_G2_SHORE[0] + 0.6, LANDING_G2_SHORE[1] + 1.2] });
    D.checkpoint('C5 the Green Beret and the Sapper ashore on the east beach');
    await moveOpen(D, 'greenberet', [[100, 100], [...BEHIND_E28]], { label: 'GB behind e28' });
    await knife(D, e28);
    D.checkpoint('C6 the Green Beret knifes e28 from behind');
    // 5) the Sapper crawls to gun 2's embrasure: charge two
    await moveOpen(D, 'sapper', [[100, 101], [...PLANT_G2]], { label: 'Sapper to gun 2' });
    await D.face('sapper', ...G2_FRONT);
    D.ability('sapper', 'remoteBomb');
    await D.until(() => (D.c('sapper').inventory.get('remoteBomb') ?? 0) === 1, 10, 'charge two set');
    D.checkpoint('C7 charge two at the embrasure of gun 2');
    await D.stance('greenberet', 'crawl');
    await moveOpen(D, 'greenberet', [[100, 100], [...LANDING_G2_SHORE]], { label: 'GB back to the boat' });
    await moveOpen(D, 'sapper', [[100, 101], [LANDING_G2_SHORE[0] + 0.6, LANDING_G2_SHORE[1] + 1.2]], { label: 'Sapper back to the boat' });
    await boardBoat(D, 'greenberet');
    await boardBoat(D, 'sapper');
    D.checkpoint('C8 both back aboard');
  }],
  ['D', 'Gun 3: the north-east beach and the turret', async (D) => {
    const dv = D.c('diver'), b = boatOf(D);
    // 1) e34, the post on the north-east beach, faces out to sea: his cone covers the whole stretch the boat must cross.
    // The boat lies behind the east spit (its rock hides it from the beach); the Marine swims round under water and
    // spears e34 from the shallows while e35's head is turned away
    await rowOpen(D, [[125, 97], [...BOAT_SPIT]], { label: 'behind the east spit' });
    await overSide(D);
    D.checkpoint('D1 behind the east spit, the Marine over the side');
    await D.go('diver', ...WATERLINE_E34, { tol: 0.6, max: 150 });
    const e34 = D.get('e34');
    // (and as everyone stands now: e31, at the east end of his beat, turns round slowly — still facing e34 as he sets off)
    await D.until(() => Math.hypot(e34.x - dv.x, e34.z - dv.z) < 8.6 && unwitnessed(D, e34, dv, { ahead: 0.6 }) && unwitnessedNow(D, e34, dv), 300, 'e34 unwatched');
    D.ability('diver', 'harpoon', e34);
    await D.until(() => !e34.alive, 3, 'e34 harpooned');
    D.checkpoint('D2 e34 speared from the shallows');
    // 2) the body by the water draws the men who see it: speared as they come, if nobody watches; whoever finds it
    // cries out, but out on the beach, outside the fortified line: the guards come, look, search and go back
    await baitKills(D, [], { maxSec: 120, quiet: 25 });
    await calm(D, [107, 62], 45, 240);
    D.checkpoint('D3 the beach calm again');
    // 3) under water to the north end of the beach: Patrol 37 walks up to it and is speared one by one, the rear man
    // first, each behind the backs of the others
    await D.go('diver', ...WATERLINE_NE, { tol: 0.6, max: 150 });
    await killFile(D, ['p37c', 'p37b', 'p37a'], { end: [92, 22], startAt: 6, maxSec: 400 });
    D.checkpoint('D4 Patrol 37 speared at the north end of the beach');
    // 4) e36, walking his beat inside the wire, sees them and comes down to look: speared too
    await baitKills(D, ['e36'], { maxSec: 300 });
    D.checkpoint('D5 e36 speared by the bodies');
    // 5) back aboard; up the east edge of the sea, out of e35's reach, to the north part of the beach
    await marineAboard(D);
    await rowOpen(D, [[131.5, 93], [133, 70], [133, 44], [124, 32]], { label: 'east edge', maxWait: 240 });
    D.checkpoint('D6 the boat up the east edge');
    // 5) the Sniper, kneeling in the boat 35 m out, takes the walker on the turret block's roof
    await rowOpen(D, [[...SNIPE_NE]], { label: 'sniper spot off the north-east beach' });
    const r = D.get('e_g3r');
    await snipe(D, r, { maxSec: 120 });
    await D.until(() => !r.alive, 3, 'e_g3r down');
    D.checkpoint('D7 the Sniper drops the guard on the turret roof');
    // 6) the Sapper ashore at the quiet north end of the beach; he crawls to the gap in the wire and lies there, out of
    // every cone, until the turret's ladder is clear (e38, below it, will be dealt with from the north side)
    await rowOpen(D, [[...LANDING_G3]], { label: 'gun 3 landing' });
    await landProne(D, 'sapper', { land: LANDING_G3_SHORE });
    D.checkpoint('D8 the Sapper ashore on the north-east beach');
    await moveOpen(D, 'sapper', [[103, 38], [...WIRE_GAP_NE], [...G3_HOLD]], { label: 'Sapper to the gap in the wire' });
    D.checkpoint('D9 the Sapper waits by the gap in the wire');
  }],
  ['E', 'The north beach: a decoy for e38', async (D) => {
    const gb = D.c('greenberet');
    // 1) round the north-south ridge's tip, under its rock; out from behind it just long enough for the Sniper to drop
    // the machine-gunner mg5g, who watches the north beach (his head turned west), then back under the rock
    await rowOpen(D, [[110, 4], [...BOAT_HIDE_N]], { label: 'north of the ridge' });
    const mg5 = D.get('mg5g');
    // (e38, halted at the west end of his beat on the rise, sweeps his eyes over the nest: every glance of his is tried
    // until the shot. Out in the open mg5g has the boat in sight within seconds: the shot as soon as it bears, before his sweep comes
    // round to it; nobody else may see the boat until it is back under the rock, turned on the spot and rowed back: ~9 s)
    const sn = D.c('sniper'), arr = 0.3 + Math.hypot(SNIPE_MG5[0] - boatOf(D).x, SNIPE_MG5[1] - boatOf(D).z) / 2.3;
    await waitUnseen(D, (D, why) => {
      const from = [boatOf(D).x, boatOf(D).z];
      if (!routeClear(D, [[...SNIPE_MG5]], { mode: 'boat', from, speed: 2.3, delay: 0.3, slack: 0.4, why })) return 'out';
      if (!routeClear(D, [[...SNIPE_MG5]], { mode: 'boat', from: SNIPE_MG5, delay: arr + 0.7, slack: 0.7, why })) return 'shot';
      if (!routeClear(D, [[...SNIPE_MG5]], { mode: 'boat', from: SNIPE_MG5, delay: arr + 5, slack: 5, except: [mg5], why })) return 'back';
      if (!unwitnessed(D, mg5, sn, { ahead: 3, why }) || !unwitnessed(D, mg5, sn, { ahead: arr + 1.5, strict: true, why })) return 'witness';
      // (and Patrol 43 finds him first, out on the beach: a post inside the line — e45 on the apron — seeing the body
      // first would cry out there and turn the barracks out)
      if (bodyAlarm(D, ...MG5_BODY, arr + 60)) return 'found';
      return '';
    }, 900, 'mg5g looking west, nobody watching him');
    D.log?.(`DBG mg5g window at t=${D.t.toFixed(2)}`);
    await rowOpen(D, [[...SNIPE_MG5]], { label: 'out from under the ridge', now: true });
    D.log?.(`DBG at the mg5g spot t=${D.t.toFixed(2)}`);
    await snipe(D, mg5, { maxSec: 8 });
    await D.until(() => !mg5.alive, 3, 'mg5g down');
    await rowOpen(D, [[...BOAT_HIDE_N]], { label: 'back under the ridge', now: true });
    D.checkpoint('E1 the Sniper drops the machine-gunner on the north beach');
    // (Patrol 43 will find him at the east end of its beat and cry out — out on the beach nobody answers: let them
    // look, search and walk on first)
    await D.until(() => mg5.bodyNoticed, 400, 'mg5g found');
    await D.wait(5);
    await calm(D, [60, 35], 45, 300);
    // 2) the Green Beret and the Sniper ashore on the north beach while Patrol 43 walks away west; along the shore to
    // a concrete block: lying behind it, nobody on the beach above can see them
    const p43 = ['p43a', 'p43b', 'p43c'].map((t) => D.get(t));
    const p43West = () => p43.every((e) => !e.alive || (e.x < 42 && Math.cos(e.heading) < 0));
    await D.until(p43West, 400, 'patrol 43 walking away west');
    await rowOpen(D, [[69, 1.6], [...LANDING_N]], { label: 'north beach landing', maxWait: 120 });
    await landProne(D, 'greenberet', { land: LANDING_N_SHORE });
    await landProne(D, 'sniper', { land: [LANDING_N_SHORE[0] + 1.6, LANDING_N_SHORE[1] + 0.3] });
    await rowOpen(D, [[69, 1.6], [...BOAT_HIDE_N]], { label: 'boat back under the ridge' });
    await moveOpen(D, 'greenberet', [[...GB_HOLD]], { label: 'GB behind the block', maxWait: 300, fast: 0.95 });
    await moveOpen(D, 'sniper', [[...SN_HOLD]], { label: 'Sniper behind the block', maxWait: 300, fast: 0.95 });
    D.checkpoint('E2 the Green Beret and the Sniper ashore on the north beach');
    // 3) while Patrol 43 is away west the Green Beret crawls along the foot of the ridge to the rise where e38 walks and
    // plants his decoy there, switched off, 13 m from the west end of e38's beat; back behind the block
    await decoyRun(D);
    D.checkpoint('E3 the Green Beret plants his decoy below e38\'s rise, switched off');
    // 4) the decoy on by radio. e38 walks over to it and stands staring at it, out to sea: his back to the turret
    // block's ladder and the barrels. Patrol 43, coming back east, is drawn to it too and never reaches the east end of
    // its beat (turning round there they look into the passage between the gun-4 shed and the lorry)
    D.ability('greenberet', 'decoyToggle');
    const e38 = D.get('e38');
    const staring = (e) => e.brain?.state === 'DECOY' && e.brain.phase === 'stare';
    await D.until(() => staring(e38), 200, 'e38 staring at the decoy');
    D.checkpoint('E4 the decoy on: e38 stands staring at it, his back to the turret and the barrels');
    // 5) the Sapper, in the gap in the wire since D9, round the end of the wire and along the turret block's north face
    // to its north-west corner; he lies there, round from the ladder (from his post e46 has the ladder in sight: it waits)
    await ladderApproach(D, 'sapper');
    D.checkpoint('E5 the Sapper lies at the corner of the turret block, round from its ladder');
    // 6) a step short of the ladder, if nobody will come near enough to see him lying there a while (then the climb is
    // short), and up it now, while all is calm, between two sweeps of e46's eyes (from his post by gun 4 he sees its
    // foot only when he looks straight ahead, once every 5 s), charge three by the turret; or, if no such moment comes,
    // later, right after the strike on the barrel posts
    if (clearFor(D, [...G3_WEST], 90, { mode: 'crawl', step: 0.5 })) {
      await moveOpen(D, 'sapper', [...G3_WEST], { label: 'sapper down the turret\'s west wall', maxWait: 300, hold: 6, fast: 1.1 });
    }
    if (await chargeThree(D, { maxSec: 240 }).then(() => true, (e) => { D.log?.(`DBG early climb put off: ${e.message.slice(0, 160)}`); return false; })) {
      D.checkpoint('E6 between two sweeps of e46\'s eyes, the Sapper climbs the ladder and sets charge three by the turret');
    }
  }],
  ['F', 'Gun 4: the strike, the alarm, the barrel', async (D) => {
    const brl = D.world.byId('brl_1');
    // (after the alarm men walk about more than on their beats: every walker's glance tried 10° wider)
    D.world.sneakMargin = 0.18;
    // (and a man walking back to his beat from the bodies walks on along it once there)
    D.world.sneakReturnOn = true;
    const p43 = ['p43a', 'p43b', 'p43c'].map((t) => D.get(t));
    const staringF = (e) => e.brain?.state === 'DECOY' && e.brain.phase === 'stare';
    // (gathered at the decoy and still: the file's last man may stand 4 m off and a little more, as it came in)
    const allLured = () => staringF(D.get('e38')) && p43.every((e) => !e.alive || (Math.hypot(e.x - 63.4, e.z - 39.1) < 4.5 && !e.isMoving && !e.path));
    // 1) the strike. Gun 4's fuel barrels are watched by three posts: e_flag and e46 a few metres off, e44 across the
    // yard; no barrel can leave the stack while they stand. The Sapper has no charge left for gun 4: a barrel must go
    // to its pit, so these three must die, and their bodies cannot be hidden: e41 and e45, posted farther off, look
    // where e44 and e46 stand every few seconds. The one alarm of the mission will sound here. With e38 and Patrol 43
    // staring at the decoy, the Sniper crawls along the shore to the far west end of the beach, where from 35 m he has
    // e46 (past the shed) and e44 (across the yard) in his sights, and drops them back to back
    await D.until(allLured, 900, 'e38 and Patrol 43 at the decoy');
    for (let tries = 0; ; tries++) {
      if (tries > 20) throw new Error('strike: no chance');
      await moveOpen(D, 'sniper', SHORE_WEST, { label: 'Sniper along the shore to the west end of the beach', maxWait: 900, hold: 4, fast: 0.95 });
      // (and only when the Sapper's climb, right after the second shot, will be unseen too: the cry goes up within seconds)
      const victims = [D.get('e46'), D.get('e44')];
      const climbAfter = () => {
        if (charged(D)) return true;
        const why = [], part = climbSeen(D, why, 2.1, victims, victims);
        if (part) { const k = `late:${part}:${(why[0] || '').split(/[@+]/)[0]}`; D.pairDiag = D.pairDiag || {}; D.pairDiag[k] = (D.pairDiag[k] || 0) + 1; }
        return !part;
      };
      if (await sniperPair(D, ['e46', 'e44'], { maxSec: 120, extra: allLured, late: climbAfter, soft: true })) break;
    }
    D.checkpoint('F1 from the west end of the beach the Sniper drops e46 and e44, two of the posts by the fuel barrels');
    // at once, with e46 gone and before the north barracks are out, the Sapper up the ladder (on the roof nobody below
    // sees him) and charge three by the turret
    if (!charged(D)) await chargeThree(D, { bodies: [D.get('e46'), D.get('e44')] });
    // (the decoy off: back from the bodies, e38 goes back to his beat instead of staring out at the beach)
    if (D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
    // 2) the alarm: within seconds the bodies are seen and the cry goes up; the guards round gun 4 run to them, look and
    // search; both barracks turn out and their squads take up their rounds. The two lie behind the block, 40 m away
    await D.until(() => !!D.world.alarm?.zonesFired?.length, 120, 'the alarm');
    D.checkpoint('F2 the alarm: the bodies are found; both barracks turn out; charge three is on the turret');
    // the Sniper at once back along the shore behind the block, while the guards run to the bodies (Patrol 43, back on its
    // beat later, will walk past where he lay)
    await moveOpen(D, 'sniper', [...SHORE_WEST.slice(0, -1).reverse(), [...SN_HOLD]], { label: 'Sniper back along the shore', maxWait: 900, fast: 0.95, pad: 1.5 });
    // 3) once the yard is quiet the Sniper drops the third post, e_flag, from a step out of the block's shadow (the
    // rifle reaches him past the lorry)
    const ef = D.get('e_flag');
    for (let tries = 0; ef.alive; tries++) {
      if (tries > 30) throw new Error('e_flag: no chance');
      await D.until(() => quietNorth(D), 1200, 'the yard quiet again');
      await moveOpen(D, 'sniper', [[...SN_EF]], { label: 'Sniper out of the block\'s shadow', maxWait: 600, hold: 2.5, fast: 0.95 });
      await snipe(D, ef, { maxSec: 10, strict: true }).catch((e) => D.log?.(`DBG e_flag try ${tries}: ${e.message}`));
      await moveOpen(D, 'sniper', [[...SN_HOLD]], { label: 'Sniper back behind the block', maxWait: 300, hold: 1, fast: 0.95 });
    }
    D.checkpoint('F3 from the shore the Sniper drops e_flag, the third post by the barrels');
    // his body is found in turn (one more cry); the two lie still until the yard is quiet again
    const tF3 = D.t;
    await D.until(() => ef.bodyNoticed || D.t - tF3 > 120, 200, 'e_flag found');
    await D.until(() => quietNorth(D), 1200, 'the yard quiet again');
    D.checkpoint('F4 the yard quiet again');
    // (the Sapper stays on the turret's roof: the north squad walks its round below it now)
    // 4) e38 at the decoy, Patrol 43 away west: the Green Beret out from behind the block, up the beach and into the
    // passage between the shed and the lorry, to its blind spot
    for (let tries = 0; ; tries++) {
      if (tries > 12) throw new Error('crossing: no chance in 12 rounds of Patrol 43');
      await patrolAway(D);
      const ok = await moveOpen(D, 'greenberet', [...UP_BEACH, [55.6, 47], [55.6, 49], [...H_A]], { label: 'GB into the passage', maxWait: 90, fast: 0.95, pad: 1.6, also: () => quietNorth(D) }).then(() => true, () => false);
      if (ok) break;
    }
    // out to the stack for a barrel, back up the passage and round the shed's north side: the barrel stood 10 m from
    // gun 4; back into the passage
    await barrelRun(D, brl);
    D.checkpoint('F5 the Green Beret carries a fuel barrel from the stack round the shed: it stands 10 m from gun 4');
    for (let tries = 0; ; tries++) {
      if (tries > 12) throw new Error('back: no chance in 12 rounds of Patrol 43');
      await patrolAway(D);
      const ok = await moveOpen(D, 'greenberet', [[55.6, 49], [55.6, 47], ...[...UP_BEACH].reverse(), [...GB_HOLD]], { label: 'GB back behind the block', maxWait: 90, fast: 0.95, pad: 1.6 }).then(() => true, () => false);
      if (ok) break;
    }
    // 5) the Sapper off the roof: the decoy on again by radio (e38 stares at it, his back to the turret), then down the
    // ladder to the block's corner and along its north face into the gap in the wire, each once nobody would see it
    // (the north barracks' squad walks its round past the ladder now, and e39 looks down at it from his beat: if they
    // keep it in sight too long, he stays up there, or lies at the corner, until gun 4 goes up and draws them all away)
    if (!D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
    await D.until(() => staringF(D.get('e38')), 400, 'e38 at the decoy');
    const down = await ladderDown(D, 'sapper', { maxSec: 240 }).then(() => true, (e) => { D.log?.(`DBG descent put off: ${e.message.slice(0, 200)}`); return false; });
    if (down) D.checkpoint('F6 the Sapper down the ladder and back in the gap in the wire');
    // 6) the decoy off: e38 and Patrol 43 back to their beats; both down to the shore and aboard while Patrol 43 walks
    // away west
    if (D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
    await D.until(() => onBeatTags(D, ['e38', 'p43a', 'p43b', 'p43c']), 120, 'the lured men back on their beats');
    await D.until(() => p43.every((e) => !e.alive || (e.x < 45 && Math.cos(e.heading) < 0)), 400, 'patrol 43 walking away west');
    await rowOpen(D, [[69, 1.6], [...LANDING_W]], { label: 'pick-up on the north beach', maxWait: 600 });
    await moveOpen(D, 'sniper', [[...LANDING_W_SHORE]], { label: 'Sniper to the shore', maxWait: 300, fast: 0.95 });
    await boardBoat(D, 'sniper', { pad: 1.2 });
    await moveOpen(D, 'greenberet', [[LANDING_W_SHORE[0] - 1.2, LANDING_W_SHORE[1]]], { label: 'GB to the shore', maxWait: 300, fast: 0.95 });
    await boardBoat(D, 'greenberet', { pad: 1.2 });
    D.checkpoint('F7 the Green Beret and the Sniper back aboard');
  }],
  ['G', 'The guns go up; out to the red buoy', async (D) => {
    const brl = D.world.byId('brl_1');
    // the boat lies under the ridge's rock until the north side is quiet again
    await rowOpen(D, [[69, 1.6], [...BOAT_HIDE_N]], { label: 'under the ridge', maxWait: 400 });
    await D.until(() => quietNorth(D, true), 1200, 'the north side quiet');
    // 1) out from under the rock, 43 m off the barrel (farther than any eye at the gun pit reaches): the Sniper fires
    // into it, gun 4 goes up, and the boat slips straight back under the rock
    await rowOpen(D, [[...SNIPE_BARREL]], { label: 'out from under the ridge', maxWait: 900 });
    await snipe(D, brl, { maxSec: 60, barrel: true });
    await D.until(() => objectiveGun(D, 'g4'), 6, 'gun 4 destroyed');
    D.checkpoint('G1 the Sniper fires into the barrel: gun 4 destroyed');
    await rowOpen(D, [[...BOAT_HIDE_N]], { run: true, label: 'back under the ridge', maxWait: 60 });
    // 2) the blast draws the guards round gun 4 to it, the north squad and e39 too: if the Sapper is still up on the
    // turret, he comes down now, the decoy on again by radio (e38, back from the blast, stares at it)
    const sap = D.c('sapper');
    if (Math.hypot(sap.x - G3_HOLD[0], sap.z - G3_HOLD[1]) > 1.5) {
      // (a man of the barracks squads lured to the decoy as well may stand staring with the ladder in sight: then the
      // decoy goes off until the lured men are back on their rounds, and on again)
      const lured = () => D.world.enemies.filter((e) => e.alive && e.tag !== 'e38' && e.brain?.state === 'DECOY');
      for (let tries = 0; ; tries++) {
        if (tries > 8) throw new Error('G2: the ladder never unwatched');
        if (!D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
        const down = await ladderDown(D, 'sapper', { maxSec: tries < 8 ? 240 : 1500 }).then(() => true, (e) => { D.log?.(`DBG G2 descent put off: ${e.message.slice(0, 160)}`); return false; });
        if (down) break;
        if (!lured().length) continue;
        if (D.c('greenberet').decoy?.on) D.ability('greenberet', 'decoyToggle');
        await D.until(() => !lured().length, 300, 'the lured barracks men back on their rounds');
      }
      D.checkpoint('G2 in the commotion the Sapper comes down the ladder and back into the gap in the wire');
    }
    // 3) out of the gap in the wire to the north-east beach, and the boat round the ridge for him
    await moveOpen(D, 'sapper', [[...WIRE_GAP_NE], [103, 38], [...LANDING_G3_SHORE]], { label: 'Sapper back to the shore', maxWait: 900, fast: 0.95 });
    await rowOpen(D, [[110, 4], [124, 32], [...LANDING_G3]], { label: 'round the ridge for the Sapper', maxWait: 900 });
    await boardBoat(D, 'sapper');
    D.checkpoint('G3 the Sapper back aboard');
    // 4) down the east edge, well clear of the beaches; out at sea the Sapper fires the three charges by radio
    await rowOpen(D, [[133, 35], [133, 70], [132, 90]], { run: true, label: 'down the east edge', maxWait: 900 });
    await rowOpen(D, [[133, 140], [126, 180]], { run: true, label: 'down the east edge', maxWait: 300 });
    for (const g of ['g1', 'g2', 'g3']) {
      D.ability('sapper', 'detonate');
      await D.until(() => objectiveGun(D, g), 5, `${g} destroyed`);
      await D.wait(1.5);
    }
    D.checkpoint('G4 the Sapper fires the three charges: guns 1, 2 and 3 destroyed');
    await D.until(() => objective(D, 'o1'), 5, 'o1');
    await rowOpen(D, [[...BUOY]], { run: true, label: 'to the red buoy', maxWait: 120 });
    await D.until(() => objective(D, 'o2'), 30, 'o2');
    D.checkpoint('G5 everyone in the boat at the red buoy: mission complete');
  }],
];

/**
 * The ladder on gun 3's west wall, timed like a player: from the gap in the wire (G3_HOLD) along the turret block's
 * north face and down its west side to the ladder's foot, crawling, then up the rungs, in one go once nobody on the
 * ground will see any of it (above head height nobody below sees him: §4.2 roof rule). Down again the same way.
 */
/** `fn` evaluated at most every `dt` s of game time (a costly check polled by D.until); false in between */
function throttle(D, dt, fn) {
  let next = -Infinity;
  return () => { if (D.world.time < next) return false; next = D.world.time + dt; return fn(); };
}

/** the man on the ladder's lowest rungs, below head height (x, z, height): the ladder leans from (84.2, 60) to (85.8, 60, 3.5) */
const RUNGS = [[84.3, 60, 0], [84.6, 60, 0.7], [84.9, 60, 1.4], [85.2, 60, 2.1], [85.45, 60, 2.45]];
/** Will nobody see a man on the lowest rungs between t0 and t1 s from now (a band-edge margin of `pad` m)? */
/**
 * `t0`/`t1`: the window for every rung, or `win(h)` → [t0, t1], the window when he is at height h (a man climbing
 * passes each rung in turn: timed, a guard glancing at the foot while he is at the top does not count).
 */
function rungsClear(D, t0, t1, why = null, pad = 0.6, except = []) {
  const w = D.world;
  // (a man walking his beat looks ahead: no extra glance margin for the rungs, 20 m and more from any beat)
  // (a man at a halt sweeps his head to a clock: where it points then, give or take 0.2 s)
  const m0 = w.sneakMargin, a0 = w.sneakWalkAmp, h0 = w.sneakHaltExact;
  w.sneakMargin = 0; w.sneakWalkAmp = 0; w.sneakHaltExact = 0.2;
  try { return rungsClear0(D, t0, t1, why, pad, except); } finally { w.sneakMargin = m0; w.sneakWalkAmp = a0; w.sneakHaltExact = h0; }
}
function rungsClear0(D, t0, t1, why, pad, except) {
  const w = D.world;
  const win = typeof t0 === 'function' ? t0 : () => [t0, t1];
  const T0 = Math.min(...RUNGS.map(([, , y]) => win(y)[0])), T1 = Math.max(...RUNGS.map(([, , y]) => win(y)[1]));
  for (const e of viewersOf(w)) {
    if (except.includes(e)) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + pad + 1;
    if (Math.hypot(e.x - 85, e.z - 60) > far + (moving ? 1.2 * T1 + 2 : 0)) continue;
    for (let t = Math.max(0, T0); t <= T1 + 1e-6; t += 0.1) {
      const q = moving ? predict(e, t) : e;
      for (const [x, z, y] of RUNGS) {
        const [a, b] = win(y);
        if (t < a - 1e-6 || t > b + 1e-6) continue;
        const d = Math.hypot(q.x - x, q.z - z) || 1, k = Math.max(0, Math.min(pad, d - 0.5)) / d;
        for (const [px, pz] of [[x, z], [x + (q.x - x) * k, z + (q.z - z) * k]]) {
          const dummy = { x: px, z: pz, y, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
          // (a squad's man wheeling where its file turns may face any way, as in routeClear)
          const seen = moving ? walkerSees(e, q, dummy, w, w.time + t) || (wheeling(e, t) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, dummy, w, w.time + t)))
            : staticSees(e, dummy, w, t);
          if (seen) { why?.push(`${e.tag}:${e.brain?.state}@(${e.x.toFixed(1)},${e.z.toFixed(1)})rungs+${t.toFixed(1)}`); return false; }
        }
      }
    }
  }
  return true;
}

/** the turret block's north-west corner, at its foot: a man lying there is out of every cone (with e38 at the decoy) */
const G3_CORNER = [83.5, 55.5];
const G3_WEST = [[83.3, 57.5], [83.3, 59.2]];
/** what is left of the crawl down the west wall from (x, z): nothing once he lies a step short of the ladder */
const westRest = ([x, z]) => (Math.hypot(x - G3_WEST[1][0], z - G3_WEST[1][1]) < 0.8 ? [] : G3_WEST);
/** from the gap in the wire round the east end of the wire in front of the block, then west along its north face: a
 * strip too narrow for a man on his belly to turn in, walked */
const G3_WIRE_END = [96.3, 51.8];
const G3_WIRE_TURN = [[97.3, 52.8], [97.3, 53.3], [96.8, 54.3], [95.8, 54.3], [95.3, 53.8]];
const G3_NORTH_FACE = [[91, 53.8], [86, 53.8], [84.6, 54.3]];
/** going west, he walks the strip only to 4 m short of its end (farther, e46 by gun 4 has it in sight) and crawls the
 * rest: a prone body passes there going west (not going east) */
const G3_FACE_WALK = [[91, 53.8], [87.5, 53.8]];
const G3_FACE_CRAWL = [[83.3, 54.8]];
/** From the gap in the wire round the end of the wire, along the turret block's north face and down its west wall to
 * just below the ladder's foot (with e38 at the decoy nobody looks there). */
/** (with the walkers' turns as they set off: w.sneakTurns) */
async function ladderApproach(D, role) {
  const w = D.world, t0 = w.sneakTurns;
  w.sneakTurns = true;
  try { return await ladderApproach0(D, role); } finally { w.sneakTurns = t0; }
}
/**
 * Does a man's prone body pass everywhere? Without physics (the headless harness) nothing holds a body lying down; in
 * the game the turn round the end of the wire and the strip going east are too tight for one (world-physics lyingFits).
 * Where it passes he crawls: walking, he leaves prints in the sand that a guard may follow (§4.8).
 */
const proneAnywhere = (D) => !D.world.physics || !!D.world.physics.isNull;
const retreatCrawl = () => [...[...G3_NORTH_FACE].reverse(), ...[...G3_WIRE_TURN].reverse(), G3_WIRE_END, G3_HOLD];

async function ladderApproach0(D, role) {
  await moveOpen(D, role, [[...G3_WIRE_END]], { label: `${role} to the end of the wire`, maxWait: 600, hold: 3, fast: 0.95 });
  if (proneAnywhere(D)) {
    await moveOpen(D, role, [...G3_WIRE_TURN, ...G3_FACE_WALK, ...G3_FACE_CRAWL, [...G3_CORNER]], { label: `${role} round the end of the wire and along the turret's north face`, maxWait: 900, hold: 4, fast: 1.1 });
    return;
  }
  await moveOpen(D, role, [...G3_WIRE_TURN, ...G3_FACE_WALK], { mode: 'walk', label: `${role} round the end of the wire and along the turret's north face`, maxWait: 900, hold: 0.8, pad: 0, slow: 2.1, fast: 2.3, slack: 0.3 });
  await moveOpen(D, role, [...G3_FACE_CRAWL, [...G3_CORNER]], { label: `${role} to the turret's corner`, maxWait: 120, hold: 4, fast: 0.95 });
}

/**
 * Would anyone see the Sapper's climb, starting `after` s from now (`except`: men who will be dead by then): from the
 * block's corner on his belly down the west wall to a step short of the ladder (a man crawling there cannot reach the
 * foot itself), up, a step to it and up the rungs, ~4.5 s on his feet. Returns the first part seen ('' = none).
 */
function climbSeen(D, why, after = 0, except = [], bodies = []) {
  const w = D.world, t0 = w.sneakTurns, c0 = w.sneakCries;
  w.sneakTurns = true; // (walkers' turns as they set off: see ladderApproach)
  // (`bodies` lie unfound: the cry over each goes up when its finder kneels by it, and turns every head in earshot)
  // (the finder cries out where he kneels; the alarm call goes out from the body itself: heard from both)
  w.sneakCries = bodies.flatMap((b) => {
    const a = alarmEtaInfo(D, b.x, b.z, 30, { except: [...except, ...bodies.filter((v) => v.alive !== false)] }), t = w.time + Math.max(0, a.t - 1.6);
    return [{ t, x: a.x, z: a.z, r: 37 }, { t, x: b.x, z: b.z, r: 37 }];
  });
  try { return climbSeen0(D, why, after, except); } finally { w.sneakTurns = t0; w.sneakCries = c0; }
}
function climbSeen0(D, why, after, except) {
  const u = D.c('sapper'), from = [u.x, u.z], low = G3_WEST[G3_WEST.length - 1], rest = westRest(from);
  const L = pathLen(from, rest), slow = after + (L ? 0.2 + L / 0.8 : 0), fast = after + (L ? 0.2 + L / 1.1 : 0);
  if (L) for (const c of [0.8, 1.1]) if (!routeClear(D, rest, { mode: 'crawl', from, speed: c, delay: after + 0.2, pad: 1.2, why, except })) return 'crawl';
  if (!routeClear(D, [low], { mode: 'walk', from: low, delay: (slow + fast) / 2 + 0.6, slack: (slow - fast) / 2 + 0.9, pad: 0.3, why, except })) return 'stand';
  // (measured: at the foot ~1.2 s after getting up, above head height ~4.6 s: ~0.74 m/s up the rungs; ±0.8 s)
  const up = (h) => [fast + 1.2 + h / 0.74 - 0.8, slow + 1.2 + h / 0.74 + 0.8];
  return rungsClear(D, up, null, why, 0.3, except) ? '' : 'rungs';
}

/** Up the ladder from just below its foot: the last metre and up the rungs in one go: standing at the foot and on the
 * lowest rungs until above head height (stance 0.6 s, 2.5 m of rungs at 0.8 m/s). */
/** (with the walkers' turns as they set off: w.sneakTurns) */
async function ladderUp(D, role, roofPt, o = {}) {
  const w = D.world, t0 = w.sneakTurns;
  w.sneakTurns = true;
  try { return await ladderUp0(D, role, roofPt, o); } finally { w.sneakTurns = t0; }
}
async function ladderUp0(D, role, roofPt, { maxSec = 900, bodies = [] } = {}) {
  const u = D.c(role), why = [], low = G3_WEST[G3_WEST.length - 1];
  const stats = {};
  let lastDbg = D.t;
  await D.until(throttle(D, 0.1, () => {
    if (why.length) { const k = why[0].split('@')[0]; stats[k] = (stats[k] || 0) + 1; }
    if (D.t - lastDbg > 60) { lastDbg = D.t; D.log?.(`DBG ladder: waiting ${JSON.stringify(stats)}`); }
    why.length = 0;
    return !climbSeen(D, why, 0, [], bodies.filter((b) => !b.bodyNoticed));
  }), maxSec, `${role}: the ladder unwatched`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log?.(`DBG ladder up at t=${D.t.toFixed(1)}`);
  for (const q of westRest([u.x, u.z])) await D.go(role, ...q, { tol: 0.4, max: 30 });
  const tUp = D.t;
  await D.stance(role, 'stand');
  await D.go(role, ...LADDER_FOOT, { tol: 0.35, max: 30 });
  const tFoot = D.t;
  D.order(role, { type: 'move', x: roofPt[0], z: roofPt[1] });
  await D.until(() => (u.y || 0) >= 2.5, 20, `${role} up the ladder`);
  D.log?.(`DBG ladder: at the foot +${(tFoot - tUp).toFixed(1)} s, above head height +${(D.t - tUp).toFixed(1)} s`);
  await D.go(role, ...roofPt, { tol: 0.4, max: 30 });
}

const pathLen = (from, pts) => { let L = 0, p = from; for (const q of pts) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return L; };
/**
 * The Sapper's way down, in two goes. First: will nobody see him, starting now from the top of the ladder: down below
 * head height after ~1.25 s, at the foot after ~4.4 s and down on his belly right there (~5.2 s), crawling
 * north along the west wall to the block's north-west corner, and lying there a while (out of every cone)? Returns the
 * first part that would be seen ('' = none).
 */
function descentSeen(D, why) {
  const crawl1 = [G3_WEST[0], G3_CORNER];
  // (measured: below head height ~1.6 s after setting off from the top, at the foot ~3.6 s, down on his belly ~4.2 s)
  if (!rungsClear(D, (h) => (h > 0 ? [1.6 + (2.45 - h) / 1.2 - 0.8, 1.6 + (2.45 - h) / 1.2 + 0.8] : [2.8, 5.0]), null, why, 0.3)) return 'rungs';
  for (const c1 of [0.8, 1.05]) if (!routeClear(D, crawl1, { mode: 'crawl', from: LADDER_FOOT, speed: c1, delay: 5.4, pad: 1.2, why })) return 'crawl';
  const tCorner = 5.4 + pathLen(LADDER_FOOT, crawl1) / 0.8;
  if (!routeClear(D, [G3_CORNER], { mode: 'crawl', from: G3_CORNER, delay: tCorner, slack: 6, pad: 1.2, why })) return 'corner';
  return '';
}
/** Then, from the corner: up, along the north face and round the end of the wire, walking; on his belly into the gap. */
function retreatSeen(D, why) {
  if (proneAnywhere(D)) { // (all the way on his belly)
    for (const c of [0.8, 1.1]) if (!routeClear(D, retreatCrawl(), { mode: 'crawl', from: G3_CORNER, speed: c, delay: 0.2, pad: 1.2, why })) return 'crawl';
    const t = 0.2 + pathLen(G3_CORNER, retreatCrawl()) / 0.8;
    return routeClear(D, [G3_HOLD], { mode: 'crawl', from: G3_HOLD, delay: t + 1.5, slack: 1.5, pad: 1.2, why }) ? '' : 'hold';
  }
  const walkPts = [...[...G3_NORTH_FACE].reverse(), ...[...G3_WIRE_TURN].reverse(), G3_WIRE_END];
  const lenWalk = pathLen(G3_CORNER, walkPts), lenCrawl2 = pathLen(G3_WIRE_END, [G3_HOLD]);
  if (!routeClear(D, [G3_CORNER], { mode: 'walk', from: G3_CORNER, delay: 0.35, slack: 0.6, pad: 0.3, why })) return 'rise';
  for (const [w1, c2] of [[2.1, 0.8], [2.3, 0.95]]) {
    const tWire = 0.7 + lenWalk / w1;
    if (!routeClear(D, walkPts, { mode: 'walk', from: G3_CORNER, speed: w1, delay: 0.7, slack: 0.3, why })) return 'walk';
    if (!routeClear(D, [G3_HOLD], { mode: 'crawl', from: G3_WIRE_END, speed: c2, delay: tWire + 0.5, pad: 1.2, why })) return 'crawl';
    if (!routeClear(D, [G3_HOLD], { mode: 'crawl', from: G3_HOLD, delay: tWire + 0.5 + lenCrawl2 / c2 + 1.5, slack: 1.5, pad: 1.2, why })) return 'hold';
  }
  return '';
}

/**
 * Is everyone within 45 m of the turret block where his beat or his round puts him (on it, at a lure, or a post)? Men
 * still looking, searching or walking back after a cry or a blast go where no plan can follow them.
 */
function settledNear(D, why = null) {
  for (const e of D.world.enemies) {
    if (!e.alive || e.removed || Math.hypot(e.x - 88, e.z - 57) > 45) continue;
    if (!['IDLE', 'REINFORCE', 'DECOY'].includes(e.brain?.state)) { why?.push(`${e.tag}:${e.brain?.state}`); return false; }
  }
  return true;
}

/** D.until on a costly check (every 0.1 s), logging what holds it up once a minute */
async function waitUnseen(D, check, maxSec, label) {
  const why = [], stats = {};
  let lastDbg = D.t;
  await D.until(throttle(D, 0.1, () => {
    if (D.t - lastDbg > 60) { lastDbg = D.t; D.log?.(`DBG ${label}: waiting ${JSON.stringify(stats)}`); }
    why.length = 0;
    const part = check(D, why);
    if (part) { const k = `${part}:${why[0]?.split('@')[0]}`; stats[k] = (stats[k] || 0) + 1; }
    return !part;
  }), maxSec, label).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log?.(`DBG ${label} at t=${D.t.toFixed(1)}`);
}

/** (with the walkers' turns as they set off: w.sneakTurns) */
async function ladderDown(D, role, o = {}) {
  const w = D.world, t0 = w.sneakTurns;
  w.sneakTurns = true;
  try { return await ladderDown0(D, role, o); } finally { w.sneakTurns = t0; }
}
async function ladderDown0(D, role, { maxSec = 1500 } = {}) {
  const u = D.c(role);
  // (where he got to, if he had to wait before: on the roof, at the corner, in the gap)
  if ((u.y || 0) > 2) {
    // first to the ladder's top, still on the roof (nobody below sees him there)
    await D.go(role, ...LADDER_TOP, { tol: 0.35, max: 20 });
    await waitUnseen(D, (D, why) => (settledNear(D, why) ? descentSeen(D, why) : 'unsettled'), maxSec, `${role}: down the ladder to the turret's corner unwatched`);
    const t0 = D.t;
    D.order(role, { type: 'move', x: LADDER_FOOT[0], z: LADDER_FOOT[1] });
    await D.until(() => (u.y || 0) < 2.5, 20, `${role} down the ladder`);
    const tLow = D.t;
    await D.go(role, ...LADDER_FOOT, { tol: 0.35, max: 30 });
    await D.stance(role, 'crawl');
    D.log?.(`DBG ladder: below head height +${(tLow - t0).toFixed(1)} s, at the foot and down +${(D.t - t0).toFixed(1)} s`);
    for (const q of [G3_WEST[0], G3_CORNER]) await D.go(role, ...q, { tol: 0.4, max: 40 });
  }
  if (Math.hypot(u.x - G3_HOLD[0], u.z - G3_HOLD[1]) < 1.5) return;
  await waitUnseen(D, (D, why) => (settledNear(D, why) ? retreatSeen(D, why) : 'unsettled'), maxSec, `${role}: along the turret's north face unwatched`);
  if (proneAnywhere(D)) { for (const q of retreatCrawl()) await D.go(role, ...q, { tol: 0.4, max: 60 }); return; }
  await D.stance(role, 'stand');
  for (const q of [...[...G3_NORTH_FACE].reverse(), ...[...G3_WIRE_TURN].reverse(), G3_WIRE_END]) await D.go(role, ...q, { tol: 0.4, max: 40 });
  await D.stance(role, 'crawl');
  await D.go(role, ...G3_HOLD, { tol: 0.4, max: 40 });
}

/** Charge three is set (the Sapper has none left). */
const charged = (D) => (D.c('sapper').inventory.get('remoteBomb') ?? 0) === 0;
/** The Sapper up the ladder and charge three by the turret. */
async function chargeThree(D, { maxSec = 60, bodies = [] } = {}) {
  const sap = D.c('sapper');
  await ladderUp(D, 'sapper', PLANT_G3, { maxSec, bodies });
  await D.face('sapper', PLANT_G3[0] + 2, PLANT_G3[1]);
  D.ability('sapper', 'remoteBomb');
  await D.until(() => (sap.inventory.get('remoteBomb') ?? 0) === 0, 10, 'charge three set');
}

/** The Green Beret knifes `victim` from where he lies, once nobody would see the blow (he rises for it). */
async function knife(D, victim, { maxSec = 240, role = 'greenberet' } = {}) {
  const gb = D.c(role), why = [];
  const up = () => ({ x: gb.x, z: gb.z, y: gb.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  await D.until(() => { why.length = 0; return unwitnessed(D, victim, up(), { ahead: 1.5, why }) && clearFor(D, [[gb.x, gb.z], [(gb.x + victim.x) / 2, (gb.z + victim.z) / 2]], 2.5, { mode: 'walk', why }); }, maxSec, `knife ${victim.tag}`)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.ability(role, 'knife', victim);
  await D.until(() => !victim.alive, 8, `${victim.tag} knifed`);
  await D.idle(role, 5);
  await D.stance(role, 'crawl');
}

/** A gun's demolition target is destroyed. */
const objectiveGun = (D, id) => !!D.world.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id))?.destroyed;

/**
 * The Sniper shoots `victim` (from the boat or on foot) as soon as the rifle bears and nobody would see him fall —
 * nor see the Sniper himself, kneeling to aim (on foot: tried as a standing man). `barrel`: the target is a barrel.
 */
async function snipe(D, victim, { maxSec = 30, barrel = false, quietFor = 0, strict = false } = {}) {
  const sn = D.c('sniper');
  const why = [];
  const kneeling = () => (sn.vehicle ? sn : { x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  const gone = () => (barrel ? victim.exploded || victim.removed : !victim.alive);
  await D.until(() => {
    if (gone()) return true;
    why.length = 0;
    if (D.world.time < (sn._boltT ?? -1) || sn.currentAction || sn.pendingAbility) return false;
    if (Math.hypot(victim.x - sn.x, victim.z - sn.z) > 44.5) { why.push('range'); return false; }
    if (barrel) return sn.vehicle ? clearFor(D, [[sn.x, sn.z]], 1.5, { mode: 'boat', why }) : clearFor(D, [[sn.x, sn.z]], 1.5, { mode: 'walk', why });
    return unwitnessed(D, victim, kneeling(), { ahead: strict ? 1.2 : 0.7, why, strict }) && (sn.vehicle || clearFor(D, [[sn.x, sn.z]], 1.2, { mode: 'walk', why }))
      && (!quietFor || alarmEta(D, victim.x, victim.z, quietFor + 1, { except: [victim] }) >= quietFor || (why.push('found'), false));
  }, maxSec, `snipe ${victim.tag ?? victim.id}`).catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
  if (gone()) return;
  D.ability('sniper', 'sniper', victim);
  if (strict && !barrel && !sn.vehicle) {
    // while he aims (0.6 s) a cry somewhere may swing a head round: still unwitnessed to the shot, or he lowers the rifle
    // (on foot: in the boat he would only sit there in the open)
    const t0 = D.t;
    while (!gone() && D.t - t0 < 0.62) {
      await D.wait(D.dt);
      if (gone()) break;
      if (!unwitnessed(D, victim, kneeling(), { at: 0, ahead: Math.max(0.2, 0.75 - (D.t - t0)), strict: true })) {
        D.order('sniper', { type: 'stop' });
        throw new Error(`snipe ${victim.tag}: aim broken off (a head turned)`);
      }
    }
  }
  await D.until(() => gone() || !sn.currentAction, 3, `${victim.tag ?? 'barrel'} shot`);
  if (!sn.vehicle) await D.stance('sniper', 'crawl');
}

/**
 * The Sniper, lying where he is, drops `tags` back to back (a shot every ~1.2 s) when, kneeling, nobody would see him
 * for the whole salvo and none of the men would be seen to fall.
 */
async function sniperPair(D, tags, { maxSec = 300, extra = null, late = null, soft = false } = {}) {
  const sn = D.c('sniper'), all = tags.map((t) => D.get(t)), t0 = D.t;
  const kneel = () => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
  const AIM = 0.75, GAP = 1.2;
  const diag = D.pairDiag = D.pairDiag || {};
  const no = (k) => { diag[k] = (diag[k] || 0) + 1; return null; };
  const plan = () => {
    const left = all.filter((e) => e.alive);
    if (extra && !extra()) return no('extra');
    if (left.some((e) => ABILITIES.sniper.canUse(sn, e, D.world) !== true)) return no('los');
    const tEnd = AIM + GAP * (left.length - 1);
    const why = [];
    if (!routeClear(D, [[sn.x, sn.z]], { mode: 'walk', from: [sn.x, sn.z], delay: tEnd / 2 + 0.2, slack: tEnd / 2 + 0.5, why })) return no(`kneel:${why[0]?.split('@')[0]}`);
    for (const order of perms(left)) {
      why.length = 0;
      if (order.every((e, k) => unwitnessed(D, e, kneel(), { at: Math.max(0, AIM + GAP * k - 0.6), ahead: 1.2, except: order.slice(0, k), strict: true, why }))) return !late || late() ? order : no('late');
      no(`unw:${order[0].tag}:${why[0]?.split('+')[0]}`);
    }
    return null;
  };
  while (all.some((e) => e.alive)) {
    if (D.t - t0 > maxSec) {
      D.log?.(`DBG pair diag ${JSON.stringify(diag)}`);
      if (soft && all.every((e) => e.alive)) return false;
      throw new Error(`pair: ${all.filter((e) => e.alive).map((e) => e.tag)} still standing`);
    }
    const ready = D.world.time >= (sn._boltT ?? -1) && !sn.currentAction && !sn.pendingAbility;
    const order = ready ? plan() : null;
    if (!order) { await D.wait(0.1); continue; }
    D.log?.(`DBG pair: ${order.map((e) => e.tag)} at t=${D.t.toFixed(1)}`);
    for (const e of order) {
      if (!e.alive) continue;
      await D.until(() => D.world.time >= (sn._boltT ?? -1) && !sn.currentAction && !sn.pendingAbility, 3, 'bolt');
      D.ability('sniper', 'sniper', e);
      await D.until(() => !e.alive, 3, `${e.tag} shot`);
    }
  }
  await D.stance('sniper', 'crawl');
  return true;
}


/**
 * The Green Beret from behind the block to the decoy spot, the decoy planted (switched off), and back, in one go once
 * nobody will see any of it.
 */
async function decoyRun(D, { maxSec = 900 } = {}) {
  const gb = D.c('greenberet'), why = [];
  const p43 = ['p43a', 'p43b', 'p43c'].map((t) => D.get(t));
  await D.until(throttle(D, 0.2, () => {
    why.length = 0;
    // Patrol 43 walking away west, a minute and more from the east end of its beat
    if (!p43.every((e) => !e.alive || (e.x < 40 && Math.cos(e.heading) < 0))) { why.push('p43'); return false; }
    let L = 0, p = [gb.x, gb.z]; for (const q of TO_DECOY) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
    const tA = 0.2 + L / 0.8, tF = 0.2 + L / 0.95;
    return [0.8, 0.95].every((sp) => routeClear(D, TO_DECOY, { mode: 'crawl', from: [gb.x, gb.z], speed: sp, delay: 0.2, pad: 1.5, why }))
      && routeClear(D, [DECOY_STAND], { mode: 'crawl', from: DECOY_STAND, delay: (tF + tA) / 2 + 1, slack: (tA - tF) / 2 + 3, pad: 1.5, why })
      && [0.8, 0.95].every((sp) => routeClear(D, [...TO_DECOY.slice(0, -1).reverse(), GB_HOLD], { mode: 'crawl', from: DECOY_STAND, speed: sp, delay: (sp === 0.8 ? tA : tF) + 2, pad: 1.5, why }));
  }), maxSec, 'the decoy run unwatched').catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log?.(`DBG decoy run at t=${D.t.toFixed(1)}`);
  await D.stance('greenberet', 'crawl');
  for (const q of TO_DECOY) await D.go('greenberet', ...q, { tol: 0.35, max: 60 });
  await D.face('greenberet', DECOY_STAND[0], DECOY_STAND[1] + 3);
  D.ability('greenberet', 'decoyDrop');
  await D.until(() => !!gb.decoy, 5, 'decoy planted');
  for (const q of [...TO_DECOY.slice(0, -1).reverse(), GB_HOLD]) await D.go('greenberet', ...q, { tol: 0.35, max: 60 });
}

/**
 * The Green Beret, waiting in the passage's north end (GB_WAIT), fetches `brl` from the stack and stands it at
 * BARREL_DROP, in one go once nobody will see the walk there, the lift, the carry back up the passage and round the
 * shed, and the set-down.
 */
const BRL_TO = [[55.5, 50.6], [55.6, 51.6]];
/** back up the passage with the barrel, to its north end; then out round the shed to the drop spot */
const BRL_UP = [[55.5, 50.6], [55.7, 47.6]];
const BRL_OUT = [[55.9, 45.6], [54.2, 45.2], [52.6, 45]];
/** and crawling back into the passage, to its blind spot */
const BRL_HOME = [[55.9, 45.6], [55.6, 47], [55.6, 49], [55.75, 50]]; // (to H_A)
/** Will nobody see the Green Beret fetch the barrel (starting in `delay` s): out of the passage to the stack, the
 * lift, back up the passage to its north end, and a few s standing there with it? */
function barrelClear(D, brl, delay = 0, why = null) {
  const gb = D.c('greenberet');
  const lenTo = Math.hypot(BRL_TO[0][0] - gb.x, BRL_TO[0][1] - gb.z) + Math.hypot(BRL_TO[1][0] - BRL_TO[0][0], BRL_TO[1][1] - BRL_TO[0][1]);
  const tPick = delay + 0.7 + lenTo / 2.1;
  const lenUp = Math.hypot(BRL_UP[0][0] - BRL_TO[1][0], BRL_UP[0][1] - BRL_TO[1][1]) + Math.hypot(BRL_UP[1][0] - BRL_UP[0][0], BRL_UP[1][1] - BRL_UP[0][1]);
  const tUp = tPick + 1.2 + lenUp / 1.5;
  return [2.1, 2.3].every((sp) => routeClear(D, BRL_TO, { mode: 'walk', from: [gb.x, gb.z], speed: sp, delay: delay + 0.7, pad: 1.2, why }))
    && routeClear(D, [BRL_TO[1]], { mode: 'walk', from: BRL_TO[1], delay: tPick + 0.6, slack: 1, pad: 1.2, why })
    && [1.5, 1.7].every((sp) => routeClear(D, BRL_UP, { mode: 'walk', from: BRL_TO[1], speed: sp, delay: tPick + 1.2, pad: 1.2, why }))
    && routeClear(D, [BRL_UP[1]], { mode: 'walk', from: BRL_UP[1], delay: tUp + 2, slack: 2.5, pad: 1.2, why });
}

/** Will nobody see him carry it out round the shed, set it down and crawl back into the passage (starting now)? */
function dropClear(D, why = null, after = 0) {
  let L = 0, p = BRL_UP[1]; for (const q of BRL_OUT) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
  const tDrop = after + 0.2 + L / 1.5;
  return [1.5, 1.7].every((sp) => routeClear(D, BRL_OUT, { mode: 'walk', from: BRL_UP[1], speed: sp, delay: after + 0.2, pad: 1.2, why }))
    && routeClear(D, [BRL_OUT[2]], { mode: 'walk', from: BRL_OUT[2], delay: tDrop + 0.8, slack: 1, pad: 1.2, why })
    && [0.8, 0.95].every((sp) => routeClear(D, BRL_HOME, { mode: 'crawl', from: BRL_OUT[2], speed: sp, delay: tDrop + 2.2, pad: 1.2, why }))
    && routeClear(D, [H_A], { mode: 'crawl', from: H_A, delay: tDrop + 2.2 + 14, slack: 3, why });
}

/**
 * The Green Beret, waiting in the passage's north end (GB_WAIT), fetches `brl` from the stack back up the passage
 * (barrelClear); then, when nobody will see it, carries it out round the shed's north side and stands it at
 * BARREL_DROP, and crawls back into the passage.
 */
async function barrelRun(D, brl, { maxSec = 600 } = {}) {
  const gb = D.c('greenberet'), why = [];
  // (fetch and drop in one go: standing in the passage with the barrel, waiting, he would be in sight sooner or later)
  const tUp = () => { const a = Math.hypot(BRL_TO[0][0] - gb.x, BRL_TO[0][1] - gb.z) + Math.hypot(BRL_TO[1][0] - BRL_TO[0][0], BRL_TO[1][1] - BRL_TO[0][1]);
    const b = Math.hypot(BRL_UP[0][0] - BRL_TO[1][0], BRL_UP[0][1] - BRL_TO[1][1]) + Math.hypot(BRL_UP[1][0] - BRL_UP[0][0], BRL_UP[1][1] - BRL_UP[0][1]);
    return 0.7 + a / 2.1 + 1.2 + b / 1.5; };
  await D.until(throttle(D, 0.2, () => { why.length = 0; return barrelClear(D, brl, 0, why) && dropClear(D, why, tUp()) && dropClear(D, why, tUp() + 1.5); }), maxSec, 'the barrel fetch unwatched')
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log?.(`DBG barrel fetch at t=${D.t.toFixed(1)}`);
  await D.stance('greenberet', 'stand');
  await D.go('greenberet', ...BRL_TO[0], { tol: 0.4 });
  D.ability('greenberet', 'hand', brl);
  await D.until(() => gb.carrying === brl, 10, 'barrel picked up');
  for (const p of BRL_UP) await D.go('greenberet', ...p, { tol: 0.35 });
  await D.until(() => { why.length = 0; return dropClear(D, why); }, 20, 'the barrel drop unwatched')
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log?.(`DBG barrel drop at t=${D.t.toFixed(1)}`);
  for (const p of BRL_OUT) await D.go('greenberet', ...p, { tol: 0.35 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, 'barrel down');
  await D.stance('greenberet', 'crawl');
  for (const p of BRL_HOME) await D.go('greenberet', ...p, { tol: 0.35 });
}


/**
 * A file of men walking to the halt `end`: speared from the water one by one, the rear man first, while those ahead
 * walk on with their backs to him (each kill unseen by the others still standing). Starts when the leader is
 * `startAt` m from the halt.
 */
async function killFile(D, tags, { end, startAt = 6, maxSec = 300 } = {}) {
  const dv = D.c('diver'), all = tags.map((t) => D.get(t));
  // rear man first: the file's order is read off the ground (who is furthest from the halt), not assumed
  const order = () => all.filter((e) => e.alive).sort((a, b) => Math.hypot(b.x - end[0], b.z - end[1]) - Math.hypot(a.x - end[0], a.z - end[1]));
  const why = [];
  await D.until(() => {
    why.length = 0;
    const men = order(), lead = men[men.length - 1];
    const d = Math.hypot(lead.x - end[0], lead.z - end[1]);
    if (!(d < startAt && d > startAt - 2.5 && lead.isMoving && men.every((e) => e.brain?.state === 'IDLE'))) return false;
    return men.every((e) => Math.hypot(e.x - dv.x, e.z - dv.z) < 8.6) && men.every((e, k) => unwitnessed(D, e, dv, { except: men.slice(0, k), ahead: 0.4 + 3 * k, why }));
  }, maxSec, `file ${tags.join(',')} near ${end}`).catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
  const men = order();
  for (let k = 0; k < men.length; k++) {
    const e = men[k];
    await D.until(() => D.world.time >= (dv._harpoonT ?? -1) && Math.hypot(e.x - dv.x, e.z - dv.z) < 8.8
      && ABILITIES.harpoon.canUse(dv, e, D.world) === true && unwitnessed(D, e, dv, { except: men.slice(0, k) }), 6, `harpoon ${e.tag} in the file`);
    D.ability('diver', 'harpoon', e);
    await D.until(() => !e.alive, 3, `${e.tag} harpooned`);
  }
}

/** Harpoon `victim` from the water as soon as he is in reach (9 m) and nobody would see him fall. */
async function harpoon(D, victim, { maxSec = 60, give = null, hide = 0 } = {}) {
  const dv = D.c('diver');
  const why = [];
  let gaveUp = false;
  await D.until(() => {
    if (!victim.alive) return true;
    if (give?.()) { gaveUp = true; return true; }
    why.length = 0;
    const d = Math.hypot(victim.x - dv.x, victim.z - dv.z);
    if (d > 8.6) return false;
    if (D.world.time < (dv._harpoonT ?? -1)) return false;
    // (the line of fire: from the water his harpoon clears low cover no better than the guard's eyes would see him)
    if (ABILITIES.harpoon.canUse(dv, victim, D.world) !== true) { why.push('no line of fire'); return false; }
    if (!unwitnessed(D, victim, dv, { why, ahead: 0.6, strict: true })) return false;
    if (!unwitnessedNow(D, victim, dv)) { why.push('seen now'); return false; }
    // (`hide` s: where he falls nobody else — but the men already walking to a body, speared in turn — finds him
    // sooner from inside the fortified line: a post up the beach seeing the body cries out there and the barracks
    // turn out; a man finding him out on the beach only calls the others down to look)
    if (hide) {
      const comers = D.world.enemies.filter((e) => e.alive && e.brain?.state === 'BODY');
      const by = bodyAlarm(D, victim.x, victim.z, hide, [victim, ...comers]);
      if (by) { why.push(`body found by ${by}`); return false; }
    }
    return true;
  }, maxSec, `harpoon ${victim.tag}`).catch((e) => { throw new Error(`${e.message} [${why.join(' ')}] d=${Math.hypot(victim.x - dv.x, victim.z - dv.z).toFixed(1)}`); });
  if (!victim.alive) return;
  if (gaveUp) throw new Error(`${victim.tag} got away`);
  D.ability('diver', 'harpoon', victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} harpooned`);
}

/**
 * The bodies left by the water draw the men who see them: each is speared as he walks down to them (the Marine keeps
 * level with him under water), before he kneels and cries out.
 */
async function baitKills(D, tags, { maxSec = 240, quiet = 0 } = {}) {
  const dv = D.c('diver'), left = new Set(tags.map((t) => D.get(t)));
  const t0 = D.t;
  let lastComer = D.t;
  for (;;) {
    const waiting = [...left].some((e) => e.alive);
    if (!waiting && (!quiet || D.t - lastComer > quiet)) return;
    if (D.t - t0 > maxSec) {
      if (waiting) throw new Error(`bait: ${[...left].filter((e) => e.alive).map((e) => e.tag)} never came`);
      return;
    }
    // (on his way, or already kneeling by it — a man next to the body is there at once — until he cries out)
    const comer = [...D.world.enemies].find((e) => e.alive && e.brain?.state === 'BODY' && (e.brain.phase === 'go' || e.brain.phase === 'kneel') && !e.flags?.holdsPost);
    if (!comer) { await D.wait(0.1); continue; }
    lastComer = D.t;
    if (!left.has(comer)) D.log(`DBG bait: ${comer.tag} comes to a body`);
    left.add(comer);
    // meet him at the water's edge nearest his body
    const g = comer.brain.goal;
    const meet = waterNear(D, g?.x ?? comer.x, g?.z ?? comer.z);
    if (meet && Math.hypot(dv.x - meet[0], dv.z - meet[1]) > 1.5) D.order('diver', { type: 'move', x: meet[0], z: meet[1] });
    const must = tags.includes(comer.tag);
    // (taken on his way down or kneeling by the body, before he cries out: where his own body will lie unseen)
    try { await harpoon(D, comer, { maxSec: 40, hide: 30, give: must ? null : () => comer.brain?.state !== 'BODY' || (comer.brain.phase !== 'go' && comer.brain.phase !== 'kneel') }); }
    catch (e) { if (must) throw e; D.log(`DBG bait: ${comer.tag} not taken (${e.message})`); left.delete(comer); }
  }
}

/**
 * Who would find a body left at (x, z) within `horizon` s and cry out from inside an alarm zone (the first finder: a
 * post kneels where he stands, anyone else at the body), or null: nobody, or the first finds it out on the beach.
 */
function bodyAlarm(D, x, z, horizon, except = []) {
  // (the first man to see a body claims it — the others leave it to him: who sees it first, not who could cry first;
  // every 0.1 s: a post's sweep may hold a body at the cone's far edge for a moment only — e45 and mg5g, 0.15 s)
  // (worked out at most every 0.5 s for the same spot: the answer moves with the sweeps, not tick by tick)
  const key = `${x},${z},${horizon},${except.map((e) => e.tag).join()}`, c = bodyAlarm.memo;
  if (c && c.key === key && D.t - c.t < 0.5) return c.tag;
  const w = D.world, d = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, kind: 'body' };
  let best = { t: Infinity, tag: null, at: null };
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + 1, post = e.flags?.holdsPost || !e.flags?.investigates;
    for (let t = 0; t <= Math.min(horizon, best.t); t += 0.1) {
      let seen = false;
      if (moving) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) <= far) seen = walkerSees(e, q, d, w, w.time + t); }
      else { if (Math.hypot(e.x - x, e.z - z) > far) break; seen = canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none'; }
      if (seen) { if (t < best.t) best = { t, tag: e.tag, at: post ? [e.x, e.z] : [x, z] }; break; }
    }
  }
  const tag = best.at && w.alarm?.zoneAt?.(...best.at) ? best.tag : null;
  bodyAlarm.memo = { key, t: D.t, tag };
  return tag;
}

/**
 * Nobody, standing and facing as he does now (his head's sweep followed), sees the victim fall or the killer within
 * `ahead` s: what unwitnessed's walk prediction misses — a walker leaving a halt turns round over a second or more,
 * still facing the way he looked.
 */
function unwitnessedNow(D, victim, killer, ahead = 0.6) {
  const w = D.world, body = { x: victim.x, z: victim.z, y: victim.y || 0, kind: 'body', falling: true };
  for (const e of viewersOf(w)) {
    if (e === victim || e.vehEye) continue;
    for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
      const cone = coneAt(e, w.time + t);
      if (canSee(e, body, w, { cone }) !== 'none' || canSee(e, killer, w, { cone, ignoreDisguise: true }) !== 'none') return false;
    }
  }
  return true;
}

/** Wait until every guard within `r` m of `at` is back on his beat (IDLE) or posted again. */
async function calm(D, at, r, maxSec) {
  const busy = () => D.world.enemies.filter((e) => e.alive && !e.removed && e.brain && e.brain.state !== 'IDLE'
    && Math.hypot(e.x - at[0], e.z - at[1]) < r);
  await D.until(() => !busy().length, maxSec, `calm round (${at})`).catch((e) => { throw new Error(`${e.message} [${busy().map((q) => `${q.tag}:${q.brain.state}`).join(' ')}]`); });
}

/** The nearest water cell (shallow or deep) to (x, z) the Marine can lie in, within 10 m. */
function waterNear(D, x, z) {
  const g = D.world.grid;
  let best = null, bd = Infinity;
  for (let dz = -10; dz <= 10; dz += 0.5) for (let dx = -10; dx <= 10; dx += 0.5) {
    const px = x + dx, pz = z + dz, t = g.terrainAt(px, pz);
    if (t !== T.WATER && t !== T.SHALLOW) continue;
    if (!g.walkableAt(px, pz, { swim: true })) continue;
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}

// ---------------------------------------------------------------- places
/** where the boat lies off the south beach (no cone reaches it) */
const BOAT_S = [95, 189.5];
/** the Marine under water at the south waterline, by Patrol 12's east leg */
const WATERLINE_S = [79.5, 152.3];
/** gun 1: the boat off the west end of the south beach; the Sapper's plant spot below the embrasure (target (57.9, 129.4)) */
const LANDING_G1 = [61, 160];
const LANDING_G1_SHORE = [61, 156.5];
const PLANT_G1 = [58.7, 130.7];
const G1_FRONT = [57.6, 129.2];
/** gun 2: the boat south of the south spit; the Marine's spot at the east waterline (e27's north halt is (104, 100)) */
const BOAT_SE = [105, 163];
const WATERLINE_E = [109, 100.5];
/** a waiting spot off the east beach, out of every cone */
const SNIPE_E = [120, 140];
/** the boat off the north part of the east beach; the Sapper's plant spot below gun 2's embrasure (target (92.75, 104.3)) */
const LANDING_G2 = [113, 96.5];
const LANDING_G2_SHORE = [109, 96];
const PLANT_G2 = [94.5, 103.2];
/** behind e28's back (he faces out to sea, 60°), 3.5 m off */
const BEHIND_E28 = [94.6, 104.4];
const G2_FRONT = [92.6, 103.6];
const WATERLINE_NE = [97, 18.5];
/** the Sniper's spot off the north-east beach: 35-40 m from the turret roof, beyond e34's and e35's sight */
const SNIPE_NE = [115, 30];
/** behind the east spit (its rock hides the boat from the north-east beach); the Marine's spot by e34's post (109, 70.5) */
const BOAT_SPIT = [128, 100];
const WATERLINE_E34 = [113.5, 70.5];
/** gun 3: the boat off the north part of the north-east beach; the gap in the wire; the turret block's north face; the
 * ladder on its west wall (foot (84.2, 60), top (85.8, 60) at 3.5 m); the plant spot within 3 m of the turret (90.5, 60) */
const LANDING_G3 = [115, 30];
const LANDING_G3_SHORE = [110, 30];
const WIRE_GAP_NE = [96.3, 46.3];
/** where the Sapper lies waiting, inside the gap in the wire (no cone reaches it) */
const G3_HOLD = [93, 49.5];
/** where he stands to climb, and a point on the lowest rungs (below head height for a man on the ground) */
const LADDER_FOOT = [84.3, 60.0];
/** on the roof, by the ladder's top (85.8, 60) */
const LADDER_TOP = [86.3, 60.0];
const PLANT_G3 = [88.3, 60.4];
/** gun 4: under the north-south ridge's tip (its rock hides the boat from the north beach); the Sniper's spot for mg5g
 * (26 m); the landing on the north beach */
const BOAT_HIDE_N = [76, 1.6];
/** Where mg5g's body comes to rest, shot in his nest: pushed out of the sandbags, 1.8 m south (in sight of the apron). */
const MG5_BODY = [60.25, 27.75];
const SNIPE_MG5 = [71, 2];
const LANDING_N = [57, 13.5];
const LANDING_N_SHORE = [57, 17.2];
/** the pick-up a little farther west, beyond the reach of e38's eyes from his beat */
const LANDING_W = [52, 14];
const LANDING_W_SHORE = [52, 17.3];
/** where the Green Beret plants the decoy (facing south: it lands 0.4 m south of him), at the north foot of the rise
 * e38 walks under the ridge's rock: 13 m from the west end of his beat, 7 m from the east end of Patrol 43's (both are
 * drawn to it), 18 m from e_flag (out of its reach) */
const DECOY_STAND = [63.4, 38.7];
/** on the shore behind a concrete block: the block hides a man lying there from the whole beach above */
const GB_HOLD = [55.3, 19.5];
const SN_HOLD = [56, 18.4];
/** a step east of it, out of the block's shadow: e_flag in the rifle's line past the lorry (37 m) */
const SN_EF = [56.8, 19.6];
/** from the shore up the beach to the passage's north mouth, west of where the lured men stare (clear of the lorry's
 * front corner: a man lying along the passage keeps his knees 0.2 m off it) */
const UP_BEACH = [[54, 19.8], [52, 19.6], [48, 22.5], [48, 30], [52, 37], [56.3, 42], [55.9, 45.3]];
/** the Green Beret's way from behind the block to the decoy spot: along the shore past the tank obstacles and the machine-gun nest, then along the foot of the ridge */
const TO_DECOY = [[57, 20], [62.6, 20.6], [62.6, 27], [63.6, 33], DECOY_STAND];
/** the passage between the gun-4 shed and the parked lorry (x 55-56.8): its north end, where the Green Beret waits for
 * the strike (only Patrol 43 at the east end of its beat could see it); its one blind spot (by the lorry, 1.5 m from
 * the south mouth: nobody sees a man lying there — as close to the lorry's flank as a man lying along the passage keeps
 * his knees off it); the Sniper's firing spot in its south mouth (in sight of e_flag, e46 and e44) */
const GB_WAIT = [55.75, 47.4];
const H_A = [55.75, 50];
/** the far west end of the beach: e46 (past the shed) and e44 in the rifle's line (25 and 37 m) */
const SN_WEST = [28, 32];
/** along the shore from behind the block to it, round the east end of the wire on the beach */
const SHORE_WEST = [[54, 18.6], [48, 19.4], [38, 20.5], [38.5, 26.5], [33, 29], SN_WEST];
/** where the barrel goes down (10.9 m from the gun pit's centre (42, 48), within a barrel blast's 11.25 m) */
const BARREL_DROP = [52.6, 45];
/** the boat off the ridge's tip for the Sniper's shot into the barrel (43 m: beyond the sight of anyone at the pit) */
const SNIPE_BARREL = [64, 4];
/** the red buoy: the way out (o2) */
const BUOY = [122, 191];

/**
 * Play the whole mission. `ctx.boardPoint` = src/abilities/drive.js boardPoint (passed in so the module loads both in
 * node and in the page). `ctx.from` / `ctx.until`: run a slice of the stages (debugging).
 */
/** (debugging probes) */

export async function solve(D, ctx = {}) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
