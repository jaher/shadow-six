/**
 * M2 "A Quiet Blow-Up" (Stamsund): a full stealth solution, played only with player orders, the original's way (Prima,
 * docs/research-raw/missions.md §M2): in over the camp's river wall by its pulled-up ladder, seven guards dead before
 * the depot blows, none of them found, no commando ever seen.
 *   A  the Sapper sets his bear trap behind the settlement's east palisade and walks a trail of footprints out of its
 *      east gap over it; e1 sees the first prints through the gap from his halt and follows them into the trap;
 *   B  the Green Beret carries e1 round the corner out of sight; the Sapper sets the trap again where it was and walks a
 *      new trail past the gap's mouth; e3, walking north inside, follows it into the trap;
 *   C  the Marine crawls in behind e2's back along the palisade and spears him (the speargun: silent, 9 m);
 *   D  the Sniper, on the riverbank under the settlement's north wall (out of e5's sight), shoots e4 in front of the big
 *      rocks while e5 looks away, then e5 on the wall walk by the ladder (the walk's edge hides his body from the camp);
 *   E  behind the patrol boat's back the Marine rows the Green Beret across; he climbs the wall face, crawls along the
 *      wall walk and lowers the camp's ladder; two more trips bring the others, each man straight up the ladder (the
 *      strip under the wall is in the boat gunner's sight) to lie flat on the walk;
 *   G  the Green Beret goes down the platform's stair into the camp and hides in the truck by the gate;
 *   H  e6 halts at the gate looking out: out at the tailgate behind him, the knife, and a fuel drum stood over him;
 *   I  e7 walks up the depot track past the truck: the knife from behind, and the other drum over him;
 *   J  only the patrol of three walks the camp: the team comes down the stair one by one into the truck;
 *   K  the Green Beret raises the boom barrier;
 *   L  the Sapper walks to the gap between the two fuel tanks, sets a time bomb, walks back and climbs in; on the bomb's
 *      last seconds the Driver drives flat out through the gate: the blast (the alarm the design forces) comes as the
 *      truck is already on the road out.
 * The original's second charge at the E corner (it razes the barracks outside) does not fit: both charges are 10 s
 * time bombs 16 m apart, so the first blast's alarm would catch the Sapper in the open on his way to the second.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real game:
 * node tools/solutions/run-browser.mjs m02 (also tests/m02-solution.test.mjs). Walkthrough: m02.walkthrough.mjs.
 */
import { routeClear, sneak, unwitnessed, bodySeen, predict } from './sneak.mjs';
import { ABILITIES } from '../../src/abilities/registry.js';
import { CONFIG } from '../../src/config.js';

const DBG = !!globalThis.process?.env?.M02DBG || !!globalThis.__M3DBG;

/** (debug) log why a wait goes on, now and then; always false */
let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 60 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/** a check generator run straight through */
function runGen(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }

/**
 * Wait (up to maxSec) until `fn(why)` holds, logging now and then why not. `fn` returns a boolean, or a generator that
 * yields between the parts of a long look-ahead: in the live replay the driver slices it across frames (D.runSliced,
 * PLAN_SLICE_MS), the game clock standing still meanwhile, so no check ever holds a frame up; straight through else.
 */
const PERF = !!globalThis.process?.env?.M02PERF;
async function waitFor(D, fn, maxSec, label) {
  const why = [];
  let k = 0, n = 0, sum = 0, max = 0, piece = 0;
  await D.untilAsync(async () => {
    if (k++ % 6) return false;
    why.length = 0;
    const t0 = PERF ? performance.now() : 0;
    let r = fn(why);
    if (r && typeof r.next === 'function') {
      if (PERF) { // (the longest piece between two yields: what one frame of the live replay pays at most)
        const it = r;
        for (;;) { const s0 = performance.now(), x = it.next(), d = performance.now() - s0; if (d > piece) piece = d; if (x.done) { r = x.value; break; } }
      } else r = D.runSliced ? await D.runSliced(r) : runGen(r);
    } else if (PERF) { const d = performance.now() - t0; if (d > piece) piece = d; }
    if (PERF) { const d = performance.now() - t0; n++; sum += d; if (d > max) max = d; }
    return r || dbg(D, why, label);
  }, maxSec, label).catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
  if (PERF) D.log(`PERF ${label}: ${n} checks, mean ${(sum / Math.max(1, n)).toFixed(2)} ms, max ${max.toFixed(1)} ms, longest piece ${piece.toFixed(1)} ms`);
}

/** nobody sees a man (mode) at (x, z) from `from` s to `from + len` s from now (a generator: it yields every sample) */
function* holdClearG(D, x, z, from, len, mode, why, pad = 0, keepWalker = 4, except = null) {
  for (let t = from; t <= from + len + 1e-6; t += 0.8) {
    if (!routeClear(D, [[x, z]], { mode, from: [x, z], delay: t, slack: 0.5, pad, keepWalker, except, why })) return false;
    yield;
  }
  return true;
}
const holdClear = (...a) => runGen(holdClearG(...a));

/**
 * routeClear in pieces (a generator: it yields after every `chunk` m of the way): the same samples at the same moments
 * as one call over the whole way, its `hold` at the end.
 */
function* routeClearG(D, pts, o, chunk = 3) {
  const sp = o.speed ?? (o.mode === 'boat' ? 2.5 : o.mode === 'crawl' ? 0.9 : 1.5);
  let [x, z] = o.from, t = o.delay ?? 0;
  const rest = [];
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / chunk));
    for (let k = 1; k <= n; k++) rest.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n]);
    x = px; z = pz;
  }
  [x, z] = o.from;
  for (let k = 0; k < rest.length; k++) {
    const last = k === rest.length - 1;
    if (!routeClear(D, [rest[k]], { ...o, from: [x, z], delay: t, hold: last ? o.hold ?? 0 : 0 })) return false;
    t += Math.hypot(rest[k][0] - x, rest[k][1] - z) / sp;
    [x, z] = rest[k];
    yield;
  }
  return true;
}

const pathLen = (from, pts) => { let L = 0; for (let k = 0, [x, z] = from; k < pts.length; [x, z] = pts[k++]) L += Math.hypot(pts[k][0] - x, pts[k][1] - z); return L; };
const WALK = 2.25; // m/s walking (running feet are heard)
const CRAWL = 0.8;

// ---------------------------------------------------------------- the settlement
const BEHIND_WALL = [29.5, 116.5]; // past the settlement's south-east corner, outside its wall
// where the Sapper lies behind the settlement's east palisade, near its south-east corner (nobody looks there)
const SAP_WAIT = [31.0, 108.6];
// the Sapper hides round the corner, south of the palisade (out of sight of the trail and of anyone who follows it)
const SAP_HIDE = [27.0, 115.2];
// trap 1, for e1: footprints out of the east gap and south along the palisade (e1, at the gap's corner, sees their
// first steps through the gap; the rest lie in the palisade's shadow from inside: so does the trap, and his body)
const T1 = [30.25, 101.4];
const TRAIL1 = [[29.7, 96.9], T1, [30.4, 105.2]];
// trap 2 (the same trap, re-armed where it was), for e3: footprints out of the gap and along the palisade (e3, walking
// north inside, sees their first steps through the gap; the trap and his body lie in the palisade's shadow)
const TRAIL2 = [[29.3, 89.8], [29.4, 92.6], [29.4, 94.6], [29.7, 96.9], T1, [30.4, 105.2]];
const BODY1_SPOT = [25.6, 115.9]; // behind the south palisade, by the start: nobody inside nor across the river sees it
const SPEAR_LURK = [29.8, 97.6]; // outside the gap, south of it (e2 never sees out there)
const SPEAR_SPOT = [26.4, 101.2]; // inside the east palisade, behind e2 when he halts at the east end of his beat
const SOUTH_GAP_OUT = [8.2, 115.4], SOUTH_GAP_IN = [8.2, 110.8], EAST_GAP_IN = [25.6, 94.2];
const SNIPE = [24.0, 84.6]; // under the settlement's north wall: 42 m from e5 (out of his sight), 42.5 m from e4's west halt
const E4_WEST = [19.75, 42.75]; // the west end of e4's beat, in front of the big rocks
// the crossing: from the north shore of the settlement's bank to the strip under the camp's river wall, east of islet 1
const SHORE = { diver: [27.6, 83.3], greenberet: [26.2, 84.0], sniper: [24.6, 84.6], sapper: [28.6, 84.6], driver: [23.0, 84.9] };
const LAUNCH = [30.6, 79.6]; // the shallows below the settlement's north-east corner
const EDGE = [29.6, 80.6]; // the water's edge there (the raft is launched from dry ground)
const LANDING = [24.7, 49.4]; // the far shallows, below the climbable stretch of wall
const LAND_UP = [24.9, 45.9]; // the snow just above the landing
const CROSS = [[28.6, 70], [26.0, 58], LANDING];
const BACK = [[26.0, 58], [28.6, 70], LAUNCH];
// the wall: the Green Beret's climb, the camp's ladder, and where each man lies on the wall walk (§4.7: unseen from below)
const CLIMB_FOOT = [24.25, 40.75], CLIMB_TOP = [23.72, 39.3];
const CLIMB_T = 6.7; // s: the Green Beret up the wall face (5.1 s at the climb pace: placement.climbEffort)
const LADDER_FOOT = [27.4, 43.0], LADDER_TOP = [27.0, 42.2];
const BY_LADDER = [26.5, 41.5]; // on the walk beside the head of the ladder
const LANDING_TOP = [27.9, 40.9]; // the platform's landing, at the head of its stair
const wallAt = (s) => [+(22.72 + 0.7646 * s).toFixed(2), +(38.13 + 0.6445 * s).toFixed(2)]; // s m along the walk's centre line
const WALK_SPOT = { sniper: wallAt(1.4), driver: wallAt(2.6), diver: wallAt(3.8), sapper: wallAt(8.6) };
// the camp: e6's halt at the gate (he looks out along the road for 5 s) and where the Green Beret comes up behind him
const E6_GATE = [50.8, 49.3], E6G_BEHIND = [49.8, 48.4];
const E6_DROP = [49.6, 38.0]; // beside the fuel drum by the depot track (bar4) where e6 is laid, the drum over him
const BOOM_IN = [54.3, 47.0]; // inside the gate, by the boom's pivot post
const TANK_GAP = [51.6, 33.3]; // at the gap between the two fuel tanks (as near as a man gets): a bomb here takes both
const EXIT = [78, 66]; // the road out (the mission's exit)
const DRIVE_T = 4.5; // s: the truck from its parking place to the road's end, flat out
const E7_LEG = Math.atan2(27.17 - 41.57, 42.31 - 59.01); // e7's heading up the depot track (his round's south-west side)
const PACK_T = 4.5; // s: the Marine out in the shallows, the raft packed (and he dives)
const ROW_T = pathLen(LAUNCH, CROSS) / 2.5;
const trapOf = (D) => D.world.interactables.find((i) => i.interactKind === 'trap' && !i.removed);

/** crawl along `pts` once nobody will see him anywhere on the way */
async function crawlOpen(D, role, pts, label) {
  const u = D.c(role);
  await D.stance(role, 'crawl');
  await waitFor(D, (why) => routeClear(D, pts, { mode: 'crawl', from: [u.x, u.z], speed: CRAWL * 0.9, delay: 0.3, slack: 1, pad: 1, hold: 2, why }), 600, label);
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.6 });
}

/** a man walks a line on his feet (leaving footprints in the snow) when nobody will see him on it, then lies down */
async function walkLine(D, role, pts, label, { hold = 1.5 } = {}) {
  const u = D.c(role);
  await waitFor(D, (why) => routeClear(D, pts, { mode: 'walk', from: [u.x, u.z], speed: WALK, delay: 0.8, slack: 1, pad: 1, hold, why }), 600, label);
  await D.stance(role, 'stand');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.35 });
  await D.stance(role, 'crawl');
}

/**
 * From `lurk` (crawling), when nobody will see him crawl to `spot` and lie there until `victim` walks within reach,
 * the man crawls there and kills him with `ability` (a ranged one: the harpoon, from where he lies) when nobody sees it.
 */
async function ambush(D, role, lurk, spot, victim, { ability = 'harpoon', range = 8.4, label = role } = {}) {
  const u = D.c(role);
  await sneak(D, ...lurk, { mode: 'crawl', role, box: 8, label: `${label} lurks` });
  let T = 0;
  await waitFor(D, (why) => {
    T = pathLen([u.x, u.z], [spot]) / CRAWL + 0.6;
    if (!routeClear(D, [spot], { mode: 'crawl', from: [u.x, u.z], speed: CRAWL, slack: 1, pad: 1, why })) return false;
    for (let tk = T; tk <= T + 15; tk += 0.5) {
      const q = predict(victim, tk);
      if (Math.hypot(q.x - spot[0], q.z - spot[1]) > range - 0.4) continue;
      return holdClear(D, ...spot, T - 0.5, tk - T + 2, 'crawl', why, 1);
    }
    why.push(`${victim.tag} not in reach`);
    return false;
  }, 600, `${label}: the moment to go in`);
  D.order(role, { type: 'move', x: spot[0], z: spot[1] });
  await D.until(() => !u.path && !u.isMoving, T + 10, `${label} in position`);
  const why = [];
  await D.until(() => {
    why.length = 0;
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > range) return false;
    if (ABILITIES[ability].canUse(u, victim, D.world) !== true) { why.push('canUse'); return dbg(D, why, `${victim.tag} shot`); }
    return unwitnessed(D, victim, u, { ahead: 0.6, strict: true, why }) || dbg(D, why, `${victim.tag} shot`);
  }, 30, `${victim.tag} in reach, his back turned`).catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
  D.ability(role, ability, victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} hit`);
  await D.idle(role);
}

/**
 * One raft trip: the Marine (on the bank, or under water at the launch) puts the raft in, two men lying by the launch
 * get up and climb in, he rows across to the far shallows and they get out and crawl to the foot of the wall — all in
 * one gap of the patrol boat (its gunner sees the raft and the men in it anywhere in his cone).
 */
async function trip(D, who, { dry, ascent, last = false }) {
  const dv = D.c('diver');
  const edgeT = dry ? Math.hypot(dv.x - EDGE[0], dv.z - EDGE[1]) / 1.3 + 0.6 : 0; // (up, and to the water's edge with the raft in his pack)
  const prep = edgeT + (dry ? 0.6 : 1.5 + 2.5) + CONFIG.abilities.raftDeploy; // (up on his feet) or (gear off, out of the shallows), then the raft
  const boardT = 3.5 * who.length; // each man up, a few steps and in
  const startT = prep + boardT + 0.5, landT = startT + ROW_T + 1.5;
  // the trip's conditions, all of which must hold: the one that failed last is asked first next time (the patrol boat
  // rules out the crossing most of the time, the landing or the climb the rest — each a whole look-ahead of every
  // guard), and within the crossing its last blocker first (routeClear `hint`): the same answer, a fraction of the work
  const crossHint = {};
  const conds = [
    (why) => routeClearG(D, CROSS, { mode: 'boat', from: LAUNCH, speed: 2.5, delay: startT, slack: 1.5, why, hint: crossHint }),
    ...(dry ? [function* (why) { return routeClear(D, [EDGE], { mode: 'walk', from: [dv.x, dv.z], speed: 1.3, delay: 0.6, slack: 1, why }); }] : []),
    (why) => holdClearG(D, ...LAUNCH, edgeT, prep - edgeT, 'walk', why),
    (why) => holdClearG(D, ...LAUNCH, prep, boardT + 1, 'boat', why),
    ...who.map((r) => (why) => holdClearG(D, D.c(r).x, D.c(r).z, prep, boardT, 'walk', why)),
    (why) => holdClearG(D, ...LANDING, landT, PACK_T, 'boat', why),
    (why) => holdClearG(D, ...LANDING, landT + 1, PACK_T, 'walk', why),
    // (and from the landing straight up the wall, every man of them, before the boat comes back: nowhere on the strip
    // under the wall is out of its gunner's sight)
    ...ascent.map((a) => function* (why) { return (yield* outingClearG(D, a.role, LANDING, a.steps, why, { delay: landT + PACK_T })) !== false; }),
  ];
  let failed = 0;
  await waitFor(D, function* (why) {
    if (!(yield* conds[failed](why))) return false;
    for (let k = 0; k < conds.length; k++) if (k !== failed && !(yield* conds[k](why))) { failed = k; return false; }
    return true;
  }, 900, `the patrol boat's back turned, the camp looking away (raft: ${who.join(', ')})`);
  if (dry) { await D.stance('diver', 'stand'); await D.go('diver', ...EDGE, { tol: 0.4 }); }
  D.ability('diver', 'raft');
  await D.until(() => dv.vehicle?.vehicleType === 'raft', 15, 'raft deployed');
  const raft = D.raft();
  for (const r of who) D.order(r, { type: 'ability', id: 'enterVehicle', target: raft });
  await D.until(() => who.every((r) => D.c(r).vehicle === raft), 20, `${who.join('+')} aboard`);
  // (launched off the bank bow first, it cannot turn where it lies: a few strokes straight out, then the crossing)
  if (!raft.canDriveTo(...CROSS[0])) await D.row(raft.x + Math.cos(raft.heading) * 2.5, raft.z + Math.sin(raft.heading) * 2.5);
  for (const p of CROSS) await D.row(...p);
  for (const r of who) {
    D.ability(r, 'leaveVehicle');
    await D.until(() => !D.c(r).vehicle, 3, `${r} out`);
  }
  // the Marine packs the raft at once (and, to fetch the next two, slips under water with it)
  await packAndDive(D, { dive: !last });
}

/**
 * Up the camp's (lowered) ladder one after the other from where they are, each on his belly along the wall walk to his
 * spot (`spots`) as soon as he is up — the next one sets off for the ladder then.
 */
async function upLadder(D, roles, spots) {
  for (const role of roles) {
    const t0 = D.t;
    await D.stance(role, 'stand');
    await D.go(role, ...LADDER_FOOT, { tol: 0.5 });
    await D.go(role, ...LADDER_TOP, { tol: 0.4 });
    await D.stance(role, 'crawl');
    D.order(role, { type: 'move', x: spots[role][0], z: spots[role][1] });
    if (DBG) D.log(`DBG ${role} up the ladder in ${(D.t - t0).toFixed(1)} s`);
  }
  await D.until(() => roles.every((r) => { const u = D.c(r); return !u.path && !u.isMoving; }), 30, 'along the wall walk');
}

/** the plan of a man up the ladder from the landing: after `delay` s, to its foot, up, and along the walk to his spot */
const UP_EACH = 4.8; // s: a man from the landing to the head of the ladder (the next one sets off then)
const ladderUp = (role, k, extra = 0) => [{ hold: 1.5 + k * UP_EACH + extra }, { to: LADDER_FOOT }, { at: LADDER_TOP, hold: 3.2 },
  { to: WALK_SPOT[role], mode: 'crawl', speed: 0.5 }];

/** the Marine gets out in the shallows, packs the raft and (dive) slips under water with it */
async function packAndDive(D, { dive = true } = {}) {
  const dv = D.c('diver'), raft = D.raft();
  D.ability('diver', 'leaveVehicle');
  await D.until(() => !dv.vehicle, 3, 'Marine out');
  if (!D.world.groundAt(dv.x, dv.z).shallow || Math.hypot(dv.x - raft.x, dv.z - raft.z) > 1.1) {
    const L = Math.hypot(LAND_UP[0] - raft.x, LAND_UP[1] - raft.z), f = 0.95 / L;
    D.order('diver', { type: 'move', x: raft.x + (LAND_UP[0] - raft.x) * f, z: raft.z + (LAND_UP[1] - raft.z) * f });
    await D.until(() => !dv.path && !dv.isMoving, 6, 'Marine to the hull, in the shallows');
  }
  D.ability('diver', 'hand', raft);
  await D.until(() => dv.has('inflatableBoat') && !dv.currentAction, 8, 'raft packed');
  if (dive) {
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater && !dv.currentAction, 5, 'Marine under water');
  }
}

const truckOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'truck');
/** where `role` climbs into the truck's back (or the cab, seat 0) and gets out again */
const doorOf = (D, role, truck, seat = 2) => truck._exitPoint(undefined, undefined, false, D.c(role), seat);

/**
 * A man on the platform (or anywhere) gets up, walks the game's own way to the truck's door and climbs in, when nobody
 * will see him on the way nor at the door.
 */
async function getIn(D, role, truck, label, { seat = 2, crawl = false } = {}) {
  const u = D.c(role), door = doorOf(D, role, truck, seat);
  const speed = crawl ? CRAWL : WALK, up = crawl ? 0.2 : (u.stance === 'stand' ? 0.2 : 1.2);
  let path = null;
  // (his way to the door, planned once: he lies still until he goes)
  path = (u._planPath(door.x, door.z) || []).map((p) => [p.x, p.z]);
  await waitFor(D, function* (why) {
    if (!path.length) { why.push('no path'); return false; }
    const T = pathLen([u.x, u.z], path) / speed + up;
    if (!crawl && !(yield* holdClearG(D, u.x, u.z, 0, up, 'walk', why))) return false;
    if (!(yield* routeClearG(D, path, { mode: crawl ? 'crawl' : 'walk', from: [u.x, u.z], speed, delay: up, slack: 1, pad: 1, why }))) return false;
    return yield* holdClearG(D, door.x, door.z, T - 0.5, 3.5, 'walk', why, 1);
  }, 900, label);
  if (!crawl) await D.stance(role, 'stand');
  D.order(role, { type: 'move', x: door.x, z: door.z });
  await D.until(() => !u.path && !u.isMoving, 60, `${role} at the door`);
  await D.stance(role, 'stand');
  D.ability(role, 'enterVehicle', truck);
  await D.until(() => u.vehicle === truck, 10, `${role} in the truck`);
}

/**
 * Will an outing go unseen: `steps` from (x, z), now + `delay` — {to: [x, z], speed, mode} walked (the game's own
 * path for `role` from there), or {hold: s, mode} spent where he is (getting in or out, a pick-up, a stab)? Returns the
 * outing's total time, or false.
 */
function* outingClearG(D, role, [x, z], steps, why, { delay = 0, keepWalker = 4, except = null } = {}) {
  const u = D.c(role);
  let t = delay, px = x, pz = z;
  for (const st of steps) {
    if (st.hold != null) {
      // (`at`: where he is meanwhile, if not where the last step left him — a man on a wall face, seen as at its top)
      const [hx, hz] = st.at ?? [px, pz];
      if (!(yield* holdClearG(D, hx, hz, t, st.hold, st.mode || 'walk', why, 1, st.keepWalker ?? keepWalker, except))) return false;
      t += st.hold;
      if (st.at) [px, pz] = st.at;
      continue;
    }
    const path = (u.planFrom(px, pz, st.to[0], st.to[1]) || [{ x: st.to[0], z: st.to[1] }]).map((p) => [p.x, p.z]);
    yield;
    if (!(yield* routeClearG(D, path, { mode: st.mode || 'walk', from: [px, pz], speed: st.speed ?? WALK, delay: t, slack: 1, pad: 1, keepWalker: st.keepWalker ?? keepWalker, except, why }))) return false;
    t += pathLen([px, pz], path) / (st.speed ?? WALK);
    [px, pz] = path[path.length - 1];
  }
  return t;
}

export const STAGES = [
  ['A', 'The settlement: a trap for e1', async (D) => {
    D.world.sneakVehicleEyes = true; // the patrol boat's gunner sees too (sneak.mjs)
    const sp = D.c('sapper'), e1 = D.get('e1');
    await D.go('sapper', ...BEHIND_WALL, { tol: 0.5 });
    await D.go('sapper', ...SAP_WAIT, { tol: 0.5 });
    await D.stance('sapper', 'crawl');
    D.checkpoint('A1 Sapper behind the settlement');
    // the trap, lying down beside the palisade
    await sneak(D, T1[0] + 0.3, T1[1] + 1.1, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper to the trap spot' });
    D.ability('sapper', 'trap', { x: T1[0], z: T1[1] });
    await D.until(() => !sp.has('bearTrap'), 5, 'trap set');
    await D.idle('sapper');
    D.checkpoint('A2 trap set');
    // round to the gap's mouth on his belly, then the trail on his feet: out of the gap, over the trap, on along the wall
    await sneak(D, TRAIL1[0][0] + 0.4, TRAIL1[0][1] + 0.6, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper to the gap' });
    await walkLine(D, 'sapper', TRAIL1, 'e1 to look away from the gap');
    D.checkpoint('A3 footprints laid');
    await sneak(D, ...SAP_HIDE, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper back round the corner' });
    await D.until(() => !e1.alive || e1.brain?.state === 'TRACKS', 300, 'e1 to see the footprints');
    D.log(`e1 TRACKS at ${D.t.toFixed(1)} (${e1.x.toFixed(1)},${e1.z.toFixed(1)})`);
    await D.until(() => !e1.alive, 120, 'e1 following the footprints');
    D.checkpoint('A4 e1 in the trap');
  }],
  ['B', 'The settlement: the trap again, for e3', async (D) => {
    const sp = D.c('sapper'), gb = D.c('greenberet'), e1 = D.get('e1'), e3 = D.get('e3');
    // the Green Beret takes e1's body round the corner, out of the way of the next trail (whoever follows it would
    // see him lying there), and lays it behind the settlement's south palisade
    await D.go('greenberet', ...BEHIND_WALL, { tol: 0.5 });
    await D.go('greenberet', T1[0] + 0.4, T1[1] + 1.6, { tol: 0.6 });
    D.ability('greenberet', 'hand', e1);
    await D.until(() => gb.carrying === e1 || e1.carriedBy === gb, 30, 'lift e1');
    D.checkpoint('B1 Green Beret lifts e1');
    await D.go('greenberet', ...BEHIND_WALL, { tol: 0.5 });
    await D.go('greenberet', ...BODY1_SPOT, { tol: 0.5 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, 'drop e1');
    await D.idle('greenberet');
    D.checkpoint('B2 e1 laid behind the south palisade');
    // the Sapper takes the trap up and sets it again where it was, then a trail for e3: out of the gap (e3 sees its
    // first steps through it, walking north) and along the palisade over the trap
    await sneak(D, T1[0] + 0.3, T1[1] + 1.1, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper to the trap' });
    D.ability('sapper', 'hand', trapOf(D));
    await D.until(() => sp.has('bearTrap'), 8, 'trap taken up');
    await D.idle('sapper');
    D.ability('sapper', 'trap', { x: T1[0], z: T1[1] });
    await D.until(() => !sp.has('bearTrap'), 5, 'trap set again');
    await D.idle('sapper');
    D.checkpoint('B3 trap set again');
    await sneak(D, TRAIL2[0][0] + 0.5, TRAIL2[0][1] + 0.7, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper to the gap' });
    await walkLine(D, 'sapper', TRAIL2, 'e2 and e3 to look away from the gap');
    D.checkpoint('B4 footprints laid');
    await sneak(D, ...SAP_HIDE, { mode: 'crawl', role: 'sapper', box: 8, label: 'Sapper back round the corner' });
    await D.until(() => !e3.alive || e3.brain?.state === 'TRACKS', 300, 'e3 to see the footprints');
    D.log(`e3 TRACKS at ${D.t.toFixed(1)} (${e3.x.toFixed(1)},${e3.z.toFixed(1)})`);
    await D.until(() => !e3.alive, 120, 'e3 following the footprints');
    D.checkpoint('B5 e3 in the trap');
  }],
  ['C', 'The settlement: the Marine\'s speargun for e2', async (D) => {
    const e2 = D.get('e2');
    // round the south-east corner and up behind the palisade to the gap (e2 never sees out of it but in a band to the
    // east), then in when e2 has walked past, on his belly along the inside of the palisade behind his back
    await D.go('diver', ...BEHIND_WALL, { tol: 0.5 });
    await D.stance('diver', 'crawl');
    await ambush(D, 'diver', SPEAR_LURK, SPEAR_SPOT, e2, { label: 'Marine' });
    D.checkpoint('C1 e2 speared');
  }],
  ['D', 'Sniper: e4 in front of the rocks, then e5 on the wall', async (D) => {
    const sn = D.c('sniper'), e4 = D.get('e4'), e5 = D.get('e5');
    // through the empty settlement (in at the south gap, out at the east one) and round to the riverbank under its north
    // wall: e5 on the wall is out of a rifle's sight from there (over 36 m), e4 only sees it from the east end of his beat
    await D.go('sniper', ...SOUTH_GAP_OUT, { tol: 0.5 });
    await D.go('sniper', ...SOUTH_GAP_IN, { tol: 0.5 });
    await D.go('sniper', ...EAST_GAP_IN, { tol: 0.5 });
    await D.stance('sniper', 'crawl');
    await sneak(D, ...SNIPE, { mode: 'crawl', role: 'sniper', box: 10, label: 'Sniper to the riverbank' });
    D.checkpoint('D1 Sniper on the riverbank');
    // e4 at the west end of his beat, in front of the big rocks; e5 looking away from him (or he would see him fall,
    // or his body), and nobody in the camp looking at the wall walk when e5 falls a second and a half later
    const why = [];
    const upright = () => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
    await D.until(() => {
      why.length = 0;
      if (!(Math.hypot(e4.x - E4_WEST[0], e4.z - E4_WEST[1]) < 1.2 && (e4.brain?.atWait || !e4.isMoving))) return false;
      if (ABILITIES.sniper.canUse(sn, e4, D.world) !== true || ABILITIES.sniper.canUse(sn, e5, D.world) !== true) { why.push('los'); return dbg(D, why, 'e4+e5 shots'); }
      if (!unwitnessed(D, e4, upright(), { ahead: 1.0, strict: true, why })) return dbg(D, why, 'e4 shot');
      const sees = bodySeen(D, e4.x, e4.z, 3.0, { step: 0.2, except: [e4] });
      if (sees.length) { why.push(`e4 body: ${sees.join(',')}`); return dbg(D, why, 'e4 body'); }
      return unwitnessed(D, e5, upright(), { at: 1.0, ahead: 1.4, strict: true, except: [e4], why }) || dbg(D, why, 'e5 shot');
    }, 600, 'e4 at the rocks, e5 looking away').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('sniper', 'sniper', e4);
    await D.until(() => !e4.alive, 3, 'e4 shot');
    D.checkpoint('D2 e4 shot in front of the rocks');
    await D.until(() => ABILITIES.sniper.canUse(sn, e5, D.world) === true, 3, 'the bolt worked');
    D.ability('sniper', 'sniper', e5);
    await D.until(() => !e5.alive, 3, 'e5 shot');
    await D.idle('sniper');
    await D.stance('sniper', 'crawl');
    D.checkpoint('D3 e5 shot on the wall');
  }],
  ['E', 'Marine: across the river to the foot of the camp wall, two at a time', async (D) => {
    // the rest of the team round the settlement's east side to the north shore, all four at once, each on his own way
    // (the game's path from where he is): on their feet while the patrol boat's gunner looks elsewhere (from the boat
    // lane he sees a man standing on either bank), then down on their bellies there
    const four = ['diver', 'greenberet', 'sapper', 'driver'];
    for (const r of four) await D.stance(r, 'stand');
    const ways = {};
    await waitFor(D, function* (why) {
      for (const r of four) {
        const u = D.c(r);
        ways[r] ??= (u._planPath(...SHORE[r]) || []).map((q) => [q.x, q.z]);
        // (the farther along, the less sure the moment: slackRate)
        if (!(yield* routeClearG(D, ways[r], { mode: 'walk', from: [u.x, u.z], speed: WALK, delay: 0.3, slack: 1, slackRate: 0.05, pad: 1, hold: 4, why }))) return false;
      }
      return true;
    }, 600, 'the patrol boat away downstream');
    for (const r of four) D.order(r, { type: 'move', x: SHORE[r][0], z: SHORE[r][1] });
    // (each man down on his belly the moment he gets there)
    await D.until(() => four.every((r) => {
      const u = D.c(r);
      if (u.path || u.isMoving) return false;
      if (u.stance !== 'crawl' && u.issue({ type: 'stance', stance: 'crawl' })) return false;
      return u.stance === 'crawl' && !((u._stanceT ?? 0) > 0);
    }), 90, 'the team to the north shore');
    await crawlOpen(D, 'sniper', [SHORE.sniper], 'Sniper to the launch');
    D.checkpoint('E1 team on the north shore');
    // trip 1: the Green Beret alone. Landed, he goes straight up the wall face, crawls along the wall walk to the head
    // of the camp's ladder and lowers it, all before the patrol boat comes back (nowhere on the strip under the wall is
    // out of its gunner's sight) and with nobody in the camp looking at the wall walk while he stands on it (lying flat
    // on it, the walk's edge hides him from everyone below: §4.7)
    const lad = D.item('ladder_sw'), gb = D.c('greenberet');
    // (on the wall face his head is over the palisade for most of the climb: counted as standing at its top)
    const gbUp = [{ hold: 1.5 }, { to: CLIMB_FOOT }, { at: CLIMB_TOP, hold: CLIMB_T + 1.2 }, { to: BY_LADDER, mode: 'crawl', speed: CRAWL }, { hold: 1.8, mode: 'crawl' }];
    await trip(D, ['greenberet'], { dry: true, ascent: [{ role: 'greenberet', steps: gbUp }] });
    D.checkpoint('E2 Green Beret across');
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'climb', { x: CLIMB_TOP[0], z: CLIMB_TOP[1] });
    await D.until(() => (gb.y || 0) > 2.1 && !gb.path && !gb.isMoving, 20, 'Green Beret on the wall walk');
    await D.stance('greenberet', 'crawl');
    D.checkpoint('E3 Green Beret over the wall');
    await D.go('greenberet', ...BY_LADDER, { tol: 0.5 });
    D.ability('greenberet', 'use', lad);
    await D.until(() => lad.lowered, 10, 'ladder lowered');
    await D.idle('greenberet');
    D.checkpoint('E4 the camp ladder lowered');
    D.order('greenberet', { type: 'move', x: LANDING_TOP[0], z: LANDING_TOP[1] });
    for (const p of [...BACK.slice(0, -1), LAUNCH]) await D.go('diver', ...p, { tol: 0.6, max: 60 });
    // trips 2 and 3: the Sniper and the Sapper, then the Driver (and the Marine after him), each man straight up the
    // ladder from the landing
    await trip(D, ['sniper', 'sapper'], { dry: false, ascent: [{ role: 'sniper', steps: ladderUp('sniper', 0) }, { role: 'sapper', steps: ladderUp('sapper', 1) }] });
    D.checkpoint('E5 Sniper and Sapper across');
    await upLadder(D, ['sniper', 'sapper'], WALK_SPOT);
    for (const p of [...BACK.slice(0, -1), LAUNCH]) await D.go('diver', ...p, { tol: 0.6, max: 60 });
    await trip(D, ['driver'], { dry: false, last: true, ascent: [{ role: 'driver', steps: ladderUp('driver', 0) }, { role: 'diver', steps: ladderUp('diver', 1) }] });
    D.checkpoint('E6 Driver across');
    await upLadder(D, ['driver', 'diver'], WALK_SPOT);
    D.checkpoint('E7 the team on the wall walk');
  }],
  ['G', 'Green Beret: down into the camp and into the truck', async (D) => {
    const gb = D.c('greenberet'), truck = truckOf(D);
    // from the platform down its stair and across the yard to the truck's tailgate, on his feet, and in (the canvas
    // hides whoever sits in the back) — when nobody will see him on the way nor climbing in
    await getIn(D, 'greenberet', truck, 'Green Beret into the truck');
    D.checkpoint('G1 Green Beret in the truck');
  }],
  ['H', 'Green Beret: e6 at the gate, under a fuel drum', async (D) => {
    const gb = D.c('greenberet'), truck = truckOf(D), e6 = D.get('e6'), drum = D.item('bar4');
    // e6 walks his beat to the gate and halts there five seconds, looking out along the road. The Green Beret slips
    // out at the tailgate behind his back, knifes him, carries him on his shoulder to the two fuel drums by the depot
    // track and stands one over him — when nobody else (the patrol, e7 on his round of the depot) will see any of it
    const door = doorOf(D, 'greenberet', truck);
    let T = 0;
    const goT = 0.6 + pathLen([door.x, door.z], (gb.planFrom(door.x, door.z, ...E6G_BEHIND) || []).map((p) => [p.x, p.z])) / WALK;
    await waitFor(D, function* (why) {
      const atHalt = (t) => { const q = predict(e6, t); return !!q.halt && Math.hypot(q.x - E6_GATE[0], q.z - E6_GATE[1]) < 1; };
      if (!(atHalt(goT - 0.8) && atHalt(goT + 2.2))) { why.push('e6 not at the gate then'); return false; }
      const go = yield* outingClearG(D, 'greenberet', [door.x, door.z], [{ hold: 0.6 }, { to: E6G_BEHIND, keepWalker: 1.2 }], why, { keepWalker: 1.2 });
      if (go === false) return false;
      const back = yield* outingClearG(D, 'greenberet', E6_GATE, [{ hold: 1.2 }, { to: E6_DROP, speed: 1.5 }, { hold: 3 },
        { to: [door.x, door.z] }, { hold: 1.5 }], why, { delay: go + 1.2, except: [e6] });
      if (back === false) return false;
      const seers = bodySeen(D, ...E6_GATE, go + 4, { step: 0.25, except: [e6] });
      if (seers.length) { why.push(`body: ${seers.join(',')}`); return false; }
      T = go;
      return true;
    }, 1200, 'e6 to halt at the gate, nobody else looking');
    D.ability('greenberet', 'leaveVehicle');
    await D.until(() => !gb.vehicle, 3, 'Green Beret out');
    D.order('greenberet', { type: 'move', x: E6G_BEHIND[0], z: E6G_BEHIND[1] });
    await D.until(() => !gb.path && !gb.isMoving, T + 4, 'behind e6');
    D.ability('greenberet', 'knife', e6);
    await D.until(() => !e6.alive, 6, 'e6 knifed');
    await D.idle('greenberet');
    D.checkpoint('H1 e6 knifed at the gate');
    D.ability('greenberet', 'hand', e6);
    await D.until(() => gb.carrying === e6, 10, 'e6 on his shoulder');
    await D.go('greenberet', ...E6_DROP, { tol: 0.4 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, 'e6 down by the drums');
    await D.idle('greenberet');
    D.ability('greenberet', 'hand', drum);
    await D.until(() => gb.carrying === drum, 10, 'drum lifted');
    D.ability('greenberet', 'hand', e6);
    await D.until(() => e6.hiddenBody, 10, 'drum over e6');
    await D.idle('greenberet');
    D.checkpoint('H2 e6 hidden under a fuel drum');
    D.order('greenberet', { type: 'move', x: door.x, z: door.z });
    await D.until(() => !gb.path && !gb.isMoving, 20, 'back at the tailgate');
    D.ability('greenberet', 'enterVehicle', truck);
    await D.until(() => gb.vehicle === truck, 10, 'Green Beret back in the truck');
  }],
  ['I', 'Green Beret: e7 on his round of the depot, under the other drum', async (D) => {
    const gb = D.c('greenberet'), truck = truckOf(D), e7 = D.get('e7'), drum = D.item('bar3');
    // in the truck he waits for e7 to come round the depot and walk off up the track past it; then out at the
    // tailgate behind e7's back, the knife, and the other fuel drum stood over him
    const door = doorOf(D, 'greenberet', truck);
    let meet = null;
    await waitFor(D, function* (why) {
      meet = null;
      for (let tm = 2.5; tm <= 9; tm += 0.5) {
        const q = predict(e7, tm), h = q.heading;
        if (q.halt || Math.cos(h - E7_LEG) < 0.95) continue; // (on his way up the track, north-west)
        const behind = [q.x - Math.cos(h) * 2.2, q.z - Math.sin(h) * 2.2];
        if (Math.hypot(behind[0] - drum.x, behind[1] - drum.z) > 4.5) continue;
        const L = pathLen([door.x, door.z], (gb.planFrom(door.x, door.z, ...behind) || []).map((p) => [p.x, p.z]));
        yield;
        if (Math.abs(0.6 + L / WALK - tm) > 0.6) continue;
        meet = { tm, behind, at: [q.x, q.z] };
        break;
      }
      if (!meet) { why.push('e7 not coming by'); return false; }
      const go = yield* outingClearG(D, 'greenberet', [door.x, door.z], [{ hold: 0.6 }, { to: meet.behind, keepWalker: 0.9 }], why, { keepWalker: 0.9 });
      if (go === false) return false;
      const back = yield* outingClearG(D, 'greenberet', meet.at, [{ to: [drum.x, drum.z] }, { hold: 1.5 }, { to: meet.at, speed: 1.5 }, { hold: 1.5 },
        { to: [door.x, door.z] }, { hold: 1.5 }], why, { delay: go + 1.2, except: [e7] });
      if (back === false) return false;
      const seers = bodySeen(D, ...meet.at, back + 1, { step: 0.25, except: [e7] });
      yield;
      if (seers.length) { why.push(`body: ${seers.join(',')}`); return false; }
      return unwitnessed(D, e7, { x: meet.behind[0], z: meet.behind[1], y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' }, { at: go, ahead: 1.0, why });
    }, 1200, 'e7 to come up the depot track past the truck');
    D.ability('greenberet', 'leaveVehicle');
    await D.until(() => !gb.vehicle, 3, 'Green Beret out');
    D.ability('greenberet', 'knife', e7);
    await D.until(() => !e7.alive, meet.tm + 6, 'e7 knifed');
    await D.idle('greenberet');
    D.checkpoint('I1 e7 knifed by the depot');
    D.ability('greenberet', 'hand', drum);
    await D.until(() => gb.carrying === drum, 15, 'drum shouldered');
    D.ability('greenberet', 'hand', e7);
    await D.until(() => e7.hiddenBody, 15, 'drum over e7');
    await D.idle('greenberet');
    D.checkpoint('I2 e7 hidden under a fuel drum');
    D.order('greenberet', { type: 'move', x: door.x, z: door.z });
    await D.until(() => !gb.path && !gb.isMoving, 20, 'back at the tailgate');
    D.ability('greenberet', 'enterVehicle', truck);
    await D.until(() => gb.vehicle === truck, 10, 'Green Beret back in the truck');
  }],
  ['J', 'The team down the stair and into the truck', async (D) => {
    const truck = truckOf(D);
    // only the patrol walks the camp now: one by one, each man gets up on the platform, walks down its stair and across
    // to the truck and climbs in when the patrol is away — the Driver into the cab, the others into the back
    await getIn(D, 'driver', truck, 'Driver to the cab', { seat: 0 });
    D.checkpoint('J1 Driver in the cab');
    await getIn(D, 'sniper', truck, 'Sniper into the truck');
    D.checkpoint('J2 Sniper in the truck');
    await getIn(D, 'diver', truck, 'Marine into the truck');
    D.checkpoint('J3 Marine in the truck');
  }],
  ['K', 'Green Beret: the gate up', async (D) => {
    const gb = D.c('greenberet'), truck = truckOf(D), boom = D.item('gate_se');
    const door = doorOf(D, 'greenberet', truck);
    await waitFor(D, function* (why) { return (yield* outingClearG(D, 'greenberet', [door.x, door.z], [{ hold: 0.6 }, { to: BOOM_IN }, { hold: 3 }, { to: [door.x, door.z] }, { hold: 1.5 }], why)) !== false; }, 600, 'the patrol away from the gate');
    D.ability('greenberet', 'leaveVehicle');
    await D.until(() => !gb.vehicle, 3, 'Green Beret out');
    await D.go('greenberet', ...BOOM_IN, { tol: 0.4 });
    D.ability('greenberet', 'use', boom);
    await D.until(() => boom.open, 8, 'boom up');
    await D.idle('greenberet');
    D.checkpoint('K1 the gate raised');
    D.order('greenberet', { type: 'move', x: door.x, z: door.z });
    await D.until(() => !gb.path && !gb.isMoving, 20, 'back at the tailgate');
    D.ability('greenberet', 'enterVehicle', truck);
    await D.until(() => gb.vehicle === truck, 10, 'Green Beret back in the truck');
  }],
  ['L', 'Sapper: a time bomb between the fuel tanks, and away', async (D) => {
    const sp = D.c('sapper'), truck = truckOf(D);
    const door = doorOf(D, 'sapper', truck);
    const plantT = 1.8;
    // from the wall walk down the stair, across to the gap between the two tanks, the bomb (10 s), back to the truck
    await waitFor(D, function* (why) { return (yield* outingClearG(D, 'sapper', [sp.x, sp.z], [{ hold: 1.2 }, { to: TANK_GAP }, { hold: plantT + 0.5 }, { to: [door.x, door.z] }, { hold: 1.5 }], why)) !== false; }, 600, 'the patrol away from the depot');
    await D.stance('sapper', 'stand');
    await D.go('sapper', ...TANK_GAP, { tol: 0.5 });
    D.ability('sapper', 'timeBomb');
    await D.until(() => !sp.currentAction && !sp.pendingAbility, 5, 'bomb set');
    D.checkpoint('L1 time bomb set between the tanks');
    await D.go('sapper', door.x, door.z, { tol: 0.4 });
    D.ability('sapper', 'enterVehicle', truck);
    await D.until(() => sp.vehicle === truck, 8, 'Sapper in the truck');
    D.checkpoint('L2 Sapper in the truck');
    // (the truck, flat out through the raised gate, takes some 4.5 s to the road's end: it leaves with the bomb's
    // last seconds ticking, so the depot goes up behind it before it is out)
    const bomb = D.world.interactables.find((b) => b.interactKind === 'bomb' && b.bombKind === 'time' && !b.exploded);
    if (bomb) await D.until(() => bomb.exploded || bomb.fuse <= DRIVE_T - 1, 12, 'the bomb ticks down');
    D.order('driver', { type: 'move', x: EXIT[0], z: EXIT[1], run: true });
    await D.until(() => D.world.objectives.every((o) => o.done), 30, 'depot destroyed, truck out');
    D.checkpoint('L3 depot destroyed, truck out of the gate');
  }],
];

export async function solve(D, ctx = {}) {
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  // the guards as they really walk: a guard about-turning at the end of his beat sweeps his eyes across; a walker
  // follows the pathfinder's way round what stands on his beat (the patrol round the MG platform by the west corner),
  // the file men his breadcrumbs
  D.world.sneakTurns = true;
  D.world.sneakPaths = true;
  D.world.sneakTrail = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
