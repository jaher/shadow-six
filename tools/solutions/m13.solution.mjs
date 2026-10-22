/**
 * M13 "David and Goliath" (Le Havre): a full stealth solution, played only with player orders.
 *   A  the Marine packs the raft before e4 can see it, slips through the south lock behind the supply boat and spears
 *      its keeper e5 (the gate stays shut, nobody sees him lie); the Green Beret climbs onto the jetty and knifes e2
 *      while the Marine spears e4 at the same moment (each would see the other fall), then knifes e3 and e1 and carries
 *      them back to the middle of the jetty, out of the dock's sight;
 *   B  the Marine latches the south gate open with the lever in e5's shack;
 *   C  from the water and from inside the brick garage (beside the blind tank) the Marine knifes e6 and spears e7 on
 *      the dock's south edge and drags both into the garage, out of Patrol 11's sight;
 *   D  the Marine puts the raft back in the water at the ledge and brings the Sniper, the Sapper and the Driver in to
 *      the jetty while e8 looks away;
 *   E  the Marine spears e9 on the mid-west mole;
 *   F  the raft takes the Green Beret, the Driver and the Sapper across to the garage; the Green Beret lies in the
 *      alley behind it;
 *   G  the Marine spears e10 and the Sniper drops e8 while Patrol 11 walks north; on its last walk south, behind its
 *      back, the Marine spears the sub guards e18 and e19 and the Green Beret knifes e12, and at the south end of its
 *      beat the Sniper drops all three;
 *   H  the Driver parks the truck across the garage door (the tank can never come out);
 *   I  the Marine spears e14 and the north lock's keeper e13 from the north quay's slipway;
 *   J  the Sapper's bear trap takes e16 on his way back to the depot's crates, and the Sapper sets the remote charge
 *      under the fuel tanks; the Green Beret knifes e17 and e15;
 *   K  the Marine latches the north gate open and spears e20 by the mini-sub;
 *   L  the raft takes everyone to the south-west mole, the Driver mans the pier gun; the raft waits out at sea while
 *      the Marine takes the mini-sub south of the open north gate and torpedoes the battleship's bow; the Sapper fires
 *      the fuel charge; the Driver sinks the patrol boat; the Marine swims back, the Driver is picked up and everyone
 *      rows out to the red buoy.
 * The only alarm is the one the mission forces: the ship going down (and the fuel blast) wakes the whole port
 * (triggers T2/T2b); by then nobody is left where anyone could see them, and the tank is shut in.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m13 (also tests/m13-solution.test.mjs).
 * Walkthrough (debug video mode): m13.walkthrough.mjs.
 */
import { sneak, clearFor, routeClear, unwitnessed, bodySeen as bodySeen0, predict, viewersOf, walking } from './sneak.mjs';

/**
 * Guards who would see a body left at (x, z) within `dur` s (sneak.mjs bodySeen), a walker turning at the end of a leg
 * swinging his eyes across everything in between (`sneakTurns`): a body stays where it lies, so the look-ahead is the
 * cautious one.
 */
function bodySeen(D, x, z, dur, o = {}) {
  const w = D.world, prev = w.sneakTurns;
  w.sneakTurns = true;
  try { return bodySeen0(D, x, z, dur, o); } finally { w.sneakTurns = prev; }
}

const DBG = !!(globalThis.process?.env?.M13DBG || globalThis.__M3DBG);
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };

/** wait until nobody will see a man (mode) at any of `pts` for the next `dur` s */
async function window(D, pts, dur, { mode = 'walk', maxSec = 300, label = 'window', except = null, turns = false } = {}) {
  const why = [], w = D.world;
  // (`turns`: a walker turning at the end of a leg swings his eyes across everything in between, as for bodySeen)
  const clear = () => { const prev = w.sneakTurns; if (turns) w.sneakTurns = true; try { return clearFor(D, pts, dur, { mode, why, except }); } finally { w.sneakTurns = prev; } };
  await D.until(() => { why.length = 0; return clear(); }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
}

/**
 * Crawl along `pts` (a player's clicks) once nobody will see him anywhere on the way (routeClear at crawling pace, the
 * cones predicted as he passes, with a margin at the edge of each band).
 */
async function crawlOpen(D, role, pts, { maxWait = 300, label = 'crawl', turns = false } = {}) {
  const u = D.c(role), why = [], w = D.world;
  await D.stance(role, 'crawl');
  // (`turns`: a walker turning at the end of a leg swings his eyes across everything in between)
  const clear = () => { const prev = w.sneakTurns; if (turns) w.sneakTurns = true; try { return routeClear(D, pts, { mode: 'crawl', from: [u.x, u.z], speed: 0.75, slack: 1, pad: 1.5, why }); } finally { w.sneakTurns = prev; } };
  await D.until(() => { why.length = 0; return clear(); }, maxWait, `${label} clear`)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.6, max: 120 });
}

/** crawl to (x, z) on a space-time plan (waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  await sneak(D, x, z, { mode: 'crawl', role, box: 8, label: `${role} → (${x},${z})`, ...o });
}

/**
 * Walk up behind a man (clicking after him as he walks, as a player does: a knife order is dropped once its target is
 * 3 m from where it was clicked) and knife him once within a couple of steps.
 */
async function knifeFrom(D, role, e, { within = 2.2, maxSec = 30, run = false } = {}) {
  const u = D.c(role), t0 = D.t;
  while (e.alive && Math.hypot(e.x - u.x, e.z - u.z) > within) {
    if (D.t - t0 > maxSec) throw new Error(`${role} never caught up with ${e.tag}`);
    D.order(role, { type: 'move', x: e.x - Math.cos(e.heading) * 0.8, z: e.z - Math.sin(e.heading) * 0.8, run });
    await D.wait(0.25);
  }
  if (e.alive) D.ability(role, 'knife', e);
  await D.until(() => !e.alive, 10, `${e.tag} knifed`);
}

/** the team's raft (the Marine at the oars) */
const raftOf = (D) => D.raft();

/** row the raft to (x, z) on a space-time plan (it lies still only where nobody looks) */
async function row(D, x, z, o = {}) {
  await sneak(D, x, z, { mode: 'boat', boat: raftOf(D), label: o.label || `row (${x},${z})`, box: 14, ...o });
}

/**
 * Row straight along `pts` (a player's clicks) once nobody will see the raft anywhere on the way (routeClear, the
 * cones predicted as it passes); `run` = paddle hard (4 m/s). Waits up to `maxWait` s for the stretch to be clear.
 */
async function rowOpen(D, pts0, { run = false, maxWait = 300, label = 'row', slack = 0.5, now = false } = {}) {
  const b = raftOf(D), sp = run ? 3.9 : 2.4, why = [];
  const pts = pts0.filter(([x, z], k) => k > 0 || Math.hypot(x - b.x, z - b.z) > 1.5);
  if (!pts.length) return;
  const turn = () => { const h = Math.atan2(pts[0][1] - b.z, pts[0][0] - b.x); let d = Math.abs(h - b.heading) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d / (Math.PI * 2 / 3); };
  if (!now) await D.until(() => { why.length = 0; return routeClear(D, pts, { mode: 'boat', from: [b.x, b.z], speed: sp, delay: 0.15 + turn(), slack, why }); }, maxWait, `${label} clear`)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 4).join(' ')}]`); });
  for (const [x, z] of pts) {
    D.order('diver', { type: 'move', x, z, run });
    const t0 = D.t;
    await D.until(() => (Math.hypot(b.x - x, b.z - z) < 1.5) || (D.t > t0 + 1 && !b.goal && (b.speed || 0) < 0.05), 200, `${label} → (${x},${z})`);
    if (Math.hypot(b.x - x, b.z - z) > 2) throw new Error(`${label}: the raft stopped at (${b.x.toFixed(1)},${b.z.toFixed(1)}), short of (${x},${z})`);
  }
  await D.until(() => (b.speed || 0) < 0.1 || !b.goal, 10, `${label} stops`);
}

/**
 * Will a raft trip go unseen: rowed along `pts` (from where it lies), lying `hold` s at the last point (men climbing
 * in or out), then rowed back along `back`?
 */
function tripClear(D, pts, hold, back, why = null) {
  return legsClear(D, [{ pts, hold }, ...(back ? [{ pts: back, hold: 0 }] : [])], why);
}

/**
 * Will a raft trip in legs go unseen: each leg rowed along `pts`, then the raft lying `hold` s at its last point (men
 * climbing in or out stand on the bank meanwhile: `bank` points, default the leg's end)?
 */
function legsClear(D, legs, why = null, fast = false, except = null, start = null) {
  const b = raftOf(D), sp = fast ? 3.8 : 2.4;
  let t = 0.6, [x, z] = start ?? [b.x, b.z];
  for (const { pts, hold = 0, bank = null } of legs) {
    if (!routeClear(D, pts, { mode: 'boat', from: [x, z], speed: sp, delay: t, slack: 0.8, why, except })) return false;
    for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / sp + 0.4; x = px; z = pz; }
    for (let h = 0; h <= hold; h += 0.5) if (!routeClear(D, [[x, z]], { mode: 'boat', from: [x, z], delay: t + h, slack: 0.3, why, except })) return false;
    if (hold) for (const p of bank ?? [[x, z]]) if (!routeClear(D, [p], { mode: 'walk', from: p, delay: t + hold / 2, slack: hold / 2 + 0.3, why, except })) return false;
    t += hold + 0.6;
  }
  return true;
}

/**
 * Guards off their beat (running to the alarm, searching, at a body, on their way back...): their eyes and their way
 * go anywhere. (The hut's squads on their reinforcement rounds keep to the dock's east and north quays.)
 */
const ROAMING = new Set(['ALARM_RUN', 'SEARCH', 'INVESTIGATE', 'BODY', 'COMBAT', 'HOLD', 'RETURN', 'TRACKS', 'CHALLENGE']);
function roamers(D, who = []) {
  for (const e of viewersOf(D.world)) if (ROAMING.has(e.brain?.state)) who.push(`${e.tag}:${e.brain.state}@(${e.x.toFixed(0)},${e.z.toFixed(0)})`);
  return who.length > 0;
}

/** the supply boat lies at her berth on one side of the south lock for at least `sec` s more */
function lockFree(D, sec) {
  const lock = D.world.setpieces.get('lock_s'), boat = D.world.byId('supply');
  if (!boat || boat.destroyed || boat.removed) return true;   // (nothing crosses any more)
  return lock.phase === 'idle' && lock.t > sec && !boat.goal && !boat.path && (boat.speed || 0) < 0.05;
}

/** climb into the raft when nobody will see him get up, walk to the hull and climb in */
async function boardRaft(D, role, boardPoint, { margin = 0.8, now = false } = {}) {
  const u = D.c(role), raft = raftOf(D);
  const bp = boardPoint(raft, u);
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(bp.x - u.x, bp.z - u.z) / 1.5 + 0.6 + margin;
  if (!now) await D.until(() => clearFor(D, [[u.x, u.z], [bp.x, bp.z]], dur, { mode: 'walk' }), 300, `${role} boards unseen`);
  D.ability(role, 'enterVehicle', raft);
  await D.until(() => u.vehicle === raft, 20, `${role} aboard`);
}

/**
 * Would a knife strike from where `u` hides go unseen from start to finish: up (0.6 s), out through `door` to where `e`
 * will be, the stab, the body dragged back through `door` to `to` (0.8 m/s)? Every stretch is tried at the moment it
 * happens, for the man (standing) and for the body.
 */
function strikeClear(D, u, e, door, to, why = null) {
  const sp = 2.0, rise = u.stance === 'crawl' ? 0.7 : 0;
  // where he catches him: walking up behind a man who walks on
  let t = rise + (Math.hypot(door[0] - u.x, door[1] - u.z) + Math.hypot(e.x - door[0], e.z - door[1])) / sp, q = predict(e, t);
  for (let k = 0; k < 3; k++) { t = rise + (Math.hypot(door[0] - u.x, door[1] - u.z) + Math.hypot(q.x - door[0], q.z - door[1])) / sp; q = predict(e, t); }
  const kill = [q.x, q.z], tk = t + 0.6;
  if (!routeClear(D, [door, kill], { mode: 'walk', from: [u.x, u.z], speed: sp, delay: rise, slack: 0.6, except: [e], why })) return false;
  for (const mode of ['walk', 'body']) if (!routeClear(D, [kill], { mode, from: kill, delay: tk, slack: 1.5, except: [e], why })) return false;
  const drag = [door, to];
  for (const mode of ['walk', 'body']) if (!routeClear(D, drag, { mode, from: kill, speed: 0.7, delay: tk + 1.3, slack: 1.5, except: [e], why })) return false;
  return true;
}

/** run `fn` with halted men's heads where their sweep puts them (sneak.mjs walkerSees: `sneakHaltExact`, ± `slack` s) */
function exactHalt(D, fn, slack = 0.25) {
  const w = D.world, prev = w.sneakHaltExact;
  w.sneakHaltExact = slack;
  try { return fn(); } finally { w.sneakHaltExact = prev; }
}

/** nobody sees a man (mode) at any of `pts` from `t0` to `t1` s from now (exact sweeps of halted walkers) */
function clearBetween(D, pts, t0, t1, mode = 'walk', why = null) {
  return exactHalt(D, () => pts.every((p) => routeClear(D, [p], { mode, from: p, delay: (t0 + t1) / 2, slack: (t1 - t0) / 2, why, step: 0.75 })));
}

/** everyone in `roles` down on the belly at once (each order retried while he still climbs out or gets up) */
async function downAll(D, roles) {
  await D.until(() => {
    let all = true;
    for (const r of roles) {
      const u = D.c(r);
      if (u.stance === 'crawl' && !(u._stanceT > 0)) continue;
      all = false;
      if (u.stance !== 'crawl' && !u.vehicle) { try { D.order(r, { type: 'stance', stance: 'crawl' }); } catch { /* still climbing out */ } }
    }
    return all;
  }, 10, 'everyone down');
}

/** drag (or shoulder) body `e` to (x, z) and let go */
async function dragTo(D, role, e, [x, z], via = []) {
  const u = D.c(role);
  await D.idle(role);
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 20, `grab ${e.tag}`);
  for (const [px, pz] of via) { try { await D.go(role, px, pz, { tol: 0.7, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - px, u.z - pz) > 2.5) throw err; } }
  // (in the game a corner's clearance may stop him a step short: the body goes down there, still inside)
  try { await D.go(role, x, z, { tol: 0.5, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `let go of ${e.tag}`);
  await D.idle(role);
}

// ---------------------------------------------------------------- places (m)
/** the start ledge's south rim, below the sight of the jetty guards (a man lying here is out of every near band) */
const LEDGE_HIDE = { greenberet: [79, 157.6], sniper: [77, 157.6], sapper: [80.5, 157.8], driver: [82, 157.6] };
const DIVE_AT = [76.5, 159.4];
/** the foot and the top of the Green Beret's climb onto the jetty (climbLinks cl_jetty) */
const CLIMB_FOOT = [79, 152.2];
const JETTY_TOP = [79, 148.4];
/** behind crate_s1 at the jetty's east end: nobody sees a man lying here */
const GB_WAIT = [78.3, 146];
/** the south lock: under water off its outer side, and inside it, 7 m from e5's post */
const GATE_OUT = [30.5, 156];
const GATE_IN = [28.2, 144.4];
/** under water inside the lock, by the jetty's west face: 7 m from the west end of e4's beat */
const MARINE_E4 = [34, 144];
/** where e3's and e1's bodies go: the jetty's middle, beyond the sight of the dock across the basin */
/** the south-west mole's ramp (R4): the shallows, its top; where he stands at the south lock's lever */
const R4_WATER = [17.5, 131.5];
const R4_TOP = [19.5, 136.6];
const LEVER_S_STAND = [24.5, 145];
/** the jetty's slipway (R5) on its north face: the raft in its shallows, the top */
const R5_RAFT = [48.6, 134.9];
const R5_TOP = [48.5, 139.8];
const R5_GB = [47, 140.5];
/** the raft in the shallows of the slipway by the garage (R2) */
const R2_RAFT = [70, 119];
/** on the jetty, behind the slipway's top: where the team lies while the Sniper works */
const R5_UP = [48.5, 140.8];
const JETTY_SPOTS = { sniper: [50.5, 140.4], sapper: [45, 140.4], driver: [49, 141.2], diver: [52.5, 140.4] };
/** in the open south lock's gateway, west of the supply boat's track: out of every cone, hull and all (a metre or two
 * further north the raft's near tube is in e8's light band, 37 m off) */
const WAIT_IN = [28.2, 145];
/** the jetty's slipway, where the Marine goes back into the water; under water by the mid-west mole's ramp (e9) and
 * off its north face (e10, 8 m) */
const R5_DIVE = [52.5, 137.6];
const R5_SHALLOW = [52.5, 136.6];
/** at the east end of the jetty's slipway: where the raft goes back in the water, and where its crew waits */
const F_RAFT = [57, 136.4];
/** the north quay's slipway (R1): under water in it; its shallows; where he lies at the north lock's lever */
const R1_W = [38.6, 53];
/** behind the huts' east end, where the Green Beret waits for e16; under the fuel tanks' cradle (the charge) */
const GB_E16 = [84.5, 56.5];
/** where e16 halts at the west end of his beat, by the depot's crates (the bear trap); where the Sapper sets it from */
const E16_HALT = [64, 34];
/** the bear trap: on e16's way west, a step short of his halt (he is caught before he turns round there) */
const TRAP_AT = [65, 34.45];
const TRAP_STAND = [64.3, 35.1];
/** in the crates' shadow at the west end of e16's beat: nobody sees a man lying there, but e16 as he turns at his halt */
const CRATES_POCKET = [62.6, 36.6];
/** up the east quay, past the sub pontoon (its guards are dead), to the north quay */
const GB_UP_QUAY = [[68.5, 84], [66.5, 76], [64.5, 62], [62.5, 53]];
/** out of the garage door and round the sandbags, to the east quay */
const SAPPER_OUT = [[77.5, 101.5], [73.5, 103.5], [69, 100]];
/** the raft at the south-west mole's ramp (R4); the sub's way to its firing spot south of the north gate; the buoy */
const R4_RAFT = [18, 131];
/** off the jetty's south face, outside the open south gate, by the rocks: beyond the sight of the dock, 32 m from where
 * the patrol boat comes in (its machine-gunner sees 28.8 m) and well clear of the pier gun's line of fire */
const RAFT_OUT = [71, 156];
const SUB_ROUTE = [[44, 72], [30, 72.5], [22.5, 72.5], [22.5, 61.5]];
const BUOY = [3, 178];
const FUEL_AT = [76, 43.6];
/** south of the crates along the north quay, behind them from e15, beside and behind e17 */
const GB_E17 = [57, 47.2];
const R1_SHALLOW = [38.6, 51];
const R1_EDGE = [38.6, 50.2];
const R1_LAND = [38.6, 48.9];
const R1_DEEP = [38.6, 59];
const LEVER_N_AT = [31.6, 45.8];
/** under water by the east quay's face: below e18, below the south end of e19's steps; south of the pontoon (e20) */
const E18_W = [59.2, 58.5];
const E19_W = [59.2, 64.5];
/** in the water by the pontoon's north side, behind e20 (he looks out south-west) */
const E20_W = [53.8, 63.6];
// (clear of the bank the Marine climbs out on to launch the raft, (56.75, 140.25))
const F_BOARD = { greenberet: [58.4, 140.3], driver: [55.5, 140.6], sapper: [54.4, 141.4] };
/** the basin's east corner by the rocks: beyond e8's sight */
const F_HOLD = [77, 130];
/** just above the slipway by the garage, where the men lie down as they step out */
const R2_PRONE = [71, 111];
/** the Green Beret's way to e12: east of the garage, along its back wall, to behind e12's post */
const GB_E12_WAIT = [73.5, 108.5];
// (the alley is half a metre wide in the game, between the garage's back wall and the rocks: x 86–86.5)
const GB_E12_ROUTE = [[80, 101.5], [84, 103.5], [86.25, 100], [86.25, 93]];
/** behind e12, along the garage's north side */
const E12_BACK = [[83, 89.6], [77, 89.6], [74.2, 90.4]];
/** the garage door's west side; where the truck is parked (across the door); the ground it sweeps getting there */
const TRUCK_DOOR = [75.6, 101.6];
/** e12's body carried into the garage: round the sandbags, in at the door */
const E12_CARRY = [[69, 93.5], [69, 101.5], [73.5, 103.5], [77.5, 101.5], [75.8, 93.8]];
const TRUCK_PARK = [80, 106];
const TRUCK_SWEEP = [[66, 106], [68, 102], [72, 106.5], [76, 107], [80, 106]];
const E9_W = [8, 77.4];
const E10_W = [22.5, 79.7];
/** the shallows on the start ledge's rim */
const LEDGE_RIM = [76.5, 158.6];
/** the ledge's west rim, clear of the men lying on its south rim: where the Marine puts the raft back in the water
 * (it lies just south of here, out of every cone once the jetty is clear), and the water by it he comes back to */
const RIM_W = [73.2, 153.5];
const RIM_W_IN = [73.4, 152.2];
/** where each man waits inside the garage (out of every cone now e6 is gone) */
const GARAGE_SPOTS = { greenberet: [76.2, 95.5], sniper: [77.2, 97.5], driver: [82.5, 96], sapper: [82.5, 98.5], diver: [77.2, 99.5] };
/** off the south lock's outer side (the open sea: nobody looks there) */
const GATE_OUT_RAFT = [37.5, 159];
/** the slipway by the garage (R2): its shallows; where e7's and e6's bodies go (the garage doorway, behind its corner) */
const R2_WATER = [70, 116];
const R2_TOP = [70.5, 112.5];
/** from the slipway's top past the crates into the garage's doorway, and the hiding place inside, by the tank */
const TO_GARAGE = [[73, 107], [77.5, 101.5], [82.5, 99.5], [82.5, 93.2]];
const G_HIDE = [82.5, 93.2];
/** the garage's doorway */
const DOOR = [77.5, 101.5];
/** prone in the doorway's west side: 8 m from the east end of e7's beat */
const H7 = [75.5, 103.2];
/** in the slipway's shallows, 6 m south of the east end of e7's beat */
const R2_E7 = [72.2, 114];
/** where e6's and e7's bodies are left inside the garage */
const G_BODY6 = [75.6, 93.4];
const G_BODY7 = [76.8, 92.7];
/** under water off e8's beat: by the dock's west face, by its south face */
const E8_W1 = [29, 106];
const E8_W2 = [36, 113.9];
const E7_HIDE = [76, 99.5];
/** where e7 may fall on his way east: nobody else (e12 behind the sandbags, e10 across the water) sees the body there */
const E7_SAFE = (x) => (x >= 60 && x <= 62.4) || (x >= 65.5 && x <= 68.4);
const E6_HIDE = [82.5, 103.5];
const E3_DROP = [58.5, 148.5];
const E1_DROP = [70.5, 148.5];

export const STAGES = [
  ['A', 'The south jetty', async (D) => {
    // the team starts lying on the ledge's south rim, below the sight of the jetty guards. The inflatable beside them
    // is not: in a few seconds e4, walking east along the jetty, would see its tubes, and e2 after him. The Marine
    // packs it at once, crawling, and keeps it on him until the team needs it; the others shuffle to their spots
    D.watchIdleRafts?.();
    D.watchCrewedRafts?.();
    const dv = D.c('diver'), raft0 = D.raft();
    D.ability('diver', 'hand', raft0);
    for (const [r, [x, z]] of Object.entries(LEDGE_HIDE)) D.order(r, { type: 'move', x, z });
    await D.until(() => dv.has('inflatableBoat') && !dv.currentAction, 12, 'the raft packed');
    D.order('diver', { type: 'move', x: DIVE_AT[0], z: DIVE_AT[1] });
    await D.until(() => Object.entries(LEDGE_HIDE).every(([r, [x, z]]) => Math.hypot(D.c(r).x - x, D.c(r).z - z) < 0.6), 30, 'team on the rim');
    D.checkpoint('A0 the Marine packs the raft; the team lies low on the ledge');
    await D.until(() => !dv.path, 20, 'Marine at the water');
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 10, 'Marine under water');
    D.checkpoint('A1 the Marine dives');
    // e5 works the south lock for the supply boat and, while the gate stands open, looks through it along the jetty:
    // he goes first. The Marine swims to the gate under water and slips in behind the boat when it opens
    const lock = D.world.setpieces.get('lock_s');
    await D.go('diver', ...GATE_OUT, { tol: 1, max: 120 });
    D.checkpoint('A2 the Marine waits under water at the south lock');
    await D.until(() => lock.open && D.get('supply').z < 150, 200, 'the supply boat through the open gate');
    await D.go('diver', ...GATE_IN, { tol: 0.8, max: 60 });
    D.checkpoint('A3 behind the supply boat through the open gate');
    // the gate shuts behind them; then, when e5's sweep is away from him, he spears him from the water
    const e5 = D.get('e5');
    await D.until(() => !lock.open, 60, 'the gate shut');
    await D.until(() => unwitnessed(D, e5, dv, { ahead: 0.6, strict: true }) && clearFor(D, [[dv.x, dv.z]], 0.8, { mode: 'crawl', except: [e5] }), 120, 'e5 looking away');
    D.ability('diver', 'harpoon', e5);
    await D.until(() => !e5.alive, 3, 'e5 speared');
    D.checkpoint('A4 the Marine spears the lock keeper e5 (the gate stays shut: nobody sees him lying there)');
    await D.go('diver', ...MARINE_E4, { tol: 0.8, max: 60 });
    // the Green Beret climbs onto the jetty while e2 and e4 both walk west
    // (5 m on the belly to the foot, up the rock face, a step onto the quay: ~13 s in all)
    await window(D, [[79, 155], CLIMB_FOOT, [79, 150.5], JETTY_TOP], 15, { label: 'climb unseen' });
    const gb = D.c('greenberet');
    const t0 = D.t;
    await D.go('greenberet', ...CLIMB_FOOT, { tol: 0.4 });
    await D.stance('greenberet', 'stand');
    D.order('greenberet', { type: 'move', x: JETTY_TOP[0], z: JETTY_TOP[1] });
    await D.until(() => gb.z < 149 && !gb.path, 20, 'GB on the jetty');
    dbg(D, `climb took ${(D.t - t0).toFixed(1)} s`);
    await crawl(D, 'greenberet', ...GB_WAIT);
    D.checkpoint('A5 the Green Beret climbs onto the jetty');

    // e2 and e4 walk the jetty's middle and each would see the other's body. The Green Beret, behind crate_s1, goes
    // after e2 when he turns back west from the east end of his beat, and knifes him from behind; the Marine, under
    // water off the jetty's south bulge, spears e4 at the same moment, at the west end of his
    const e2 = D.get('e2'), e4 = D.get('e4');
    const CATCH = 9.5; // s from e2 turning west to the knife
    const e4Ready = (t) => { const q = predict(e4, t); return Math.cos(q.heading) < -0.5 && Math.hypot(q.x - dv.x, q.z - dv.z) < 8.4; };
    await D.until(() => {
      if (!(e2.x > 66.5 && Math.cos(e2.heading) < -0.7 && e2.isMoving)) return false; // e2 just set off west
      for (let t = CATCH - 2; t <= CATCH + 3; t += 0.5) if (!e4Ready(t)) return false;
      return unwitnessed(D, e2, gb, { ahead: 2, strict: true });
    }, 900, 'e2 setting off west, e4 at his west end when the knife lands');
    const tk = D.t;
    await D.stance('greenberet', 'stand');
    await knifeFrom(D, 'greenberet', e2);
    await D.until(() => !e2.alive, 20, 'e2 knifed');
    dbg(D, `knife landed ${(D.t - tk).toFixed(1)} s after e2 set off`);
    D.checkpoint('A6 the Green Beret knifes e2 from behind');
    await D.until(() => Math.hypot(e4.x - dv.x, e4.z - dv.z) < 8.6 && unwitnessed(D, e4, dv, { ahead: 0.6, strict: true }), 10, 'e4 in reach');
    D.ability('diver', 'harpoon', e4);
    await D.until(() => !e4.alive, 3, 'e4 speared');
    D.checkpoint('A7 the Marine spears e4');

    // e3 and e1 stand at the jetty's north edge looking out over the basin, where Patrol 11 (at the south end of its
    // beat) and e7 would see them lying: each is knifed from behind and carried back to the jetty's middle
    for (const [tag, drop] of [['e3', E3_DROP], ['e1', E1_DROP]]) {
      const e = D.get(tag);
      const behind = [e.x + 0.4, e.z + 2.2];
      await D.idle('greenberet');
      await D.go('greenberet', ...behind, { tol: 0.5 });
      await D.until(() => unwitnessed(D, e, gb, { ahead: 2.5, strict: true }) && clearFor(D, [[e.x, e.z], behind, drop], 8, { except: [e] }) && clearFor(D, [[e.x, e.z - 1.2], [e.x, e.z]], 8, { mode: 'body', except: [e] }), 300, `${tag} unwatched`);
      D.ability('greenberet', 'knife', e);
      await D.until(() => !e.alive, 10, `${tag} knifed`);
      await D.idle('greenberet');
      D.ability('greenberet', 'hand', e);
      await D.until(() => gb.carrying === e || e.carriedBy === gb, 10, `lift ${tag}`);
      await D.go('greenberet', ...drop, { tol: 0.5 });
      D.ability('greenberet', 'drop');
      await D.until(() => !gb.carrying, 5, 'drop');
      await D.wait(0.5);
      if (tag === 'e3') D.checkpoint('A8 e3 knifed and carried back to the middle of the jetty');
      else D.checkpoint('A9 e1 knifed and carried back to the middle of the jetty');
    }
  }],
  ['B', 'The south lock latched open', async (D) => {
    const dv = D.c('diver');
    // the Marine climbs out on the south-west mole's ramp, takes his gear off and pulls the lever in e5's shack: the
    // gate swings open and stays open (e8, across the water on the dock, is the only one who could see the ramp)
    await D.go('diver', ...R4_WATER, { tol: 0.8, max: 90 });
    await window(D, [R4_WATER, R4_TOP, LEVER_S_STAND], 14, { label: 'R4 and the lever unwatched', mode: 'walk' });
    D.ability('diver', 'dive'); // gear off (in the shallows)
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    await D.go('diver', ...R4_TOP, { tol: 0.6 });
    await D.go('diver', ...LEVER_S_STAND, { tol: 0.5 });
    D.ability('diver', 'use', D.item('lever_s'));
    const lock = D.world.setpieces.get('lock_s');
    await D.until(() => lock.latched && lock.open, 10, 'south gate latched open');
    D.checkpoint('B1 the Marine pulls the lever: the south gate is latched open');
    // (a metre round the spot where he puts the gear on: he stops within reach of it, standing, for the 1.5 s it takes)
    const r4pad = [[-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8]].map(([a, b]) => [R4_WATER[0] + a, R4_WATER[1] + b]);
    await window(D, [LEVER_S_STAND, R4_TOP, R4_WATER, ...r4pad], 11, { label: 'back to the water', mode: 'walk', turns: true });
    // (at a run: nobody is near enough to hear him)
    await D.go('diver', ...R4_TOP, { tol: 0.6, run: true });
    await D.go('diver', ...R4_WATER, { tol: 0.6, run: true });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
    D.checkpoint('B2 back under water');
    // the packed raft slows him on land: out through the open gate to the ledge (nobody left to see it since the
    // jetty is clear), up on the rock, the raft back in the water off its west side, and under water again
    await D.go('diver', ...RIM_W, { tol: 0.8, max: 150 });
    D.ability('diver', 'raft');
    await D.until(() => dv.vehicle && dv.vehicle.def?.raft, 30, 'raft deployed');
    D.ability('diver', 'leaveVehicle');
    await D.until(() => !dv.vehicle && !dv.currentAction, 5, 'out of the raft');
    await D.go('diver', ...DIVE_AT, { tol: 0.6 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
    D.checkpoint('B3 the raft left at the ledge');
  }],
  ['C', 'The dock\'s south edge', async (D) => {
    const dv = D.c('diver'), e6 = D.get('e6'), e7 = D.get('e7'), e8 = D.get('e8');
    const p11 = ['p11a', 'p11b', 'p11c'].map((t) => D.get(t));
    // e6, e7 and e8 walk the dock's south edge, each in sight of the next one's beat, and Patrol 11 turns round among
    // them every two and a half minutes. The Marine lands on the slipway by the garage and hides inside it, by the
    // blind tank: from there he knifes e6 and e7 in turn and drags each inside, out of everyone's sight. e8, whose
    // body only e7 could see, is speared from the water last.
    // (s until the patrol, back from its north end, comes within sight of the south end again)
    const blindLeft = () => { for (let t = 0; t <= 140; t += 1) { const q = predict(p11[0], t); if ((Math.sin(q.heading) > 0.5 && q.z > 70) || q.z > 104) return t; } return 140; };
    await D.go('diver', ...R2_WATER, { tol: 0.8, max: 150 });
    D.checkpoint('C1 the Marine under water at the slipway by the garage');
    // gear off in the shallows, up the slipway and into the garage
    const IN = [R2_TOP, ...TO_GARAGE];
    await D.until(() => blindLeft() > 40 && clearFor(D, [R2_WATER], 2.5, { mode: 'walk' }) && routeClear(D, IN, { mode: 'walk', from: R2_WATER, speed: 1.9, delay: 1.8, slack: 0.6, pad: 1 })
      && clearFor(D, [G_HIDE], 12, { mode: 'walk' }), 600, 'the way into the garage unwatched');
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    await D.path('diver', IN, { tol: 0.5 });
    await D.stance('diver', 'crawl');
    D.checkpoint('C2 the Marine slips into the garage, beside the blind tank');
    // e6: when he walks east, his back to the garage door, and e7 has just set off west along the quay
    let lastDbg = 0;
    const outAndBack = (e, to) => { // he walks out to e, stabs him, drags him back to `to`: nobody sees any of it
      const why = [];
      const ok = strikeClear(D, dv, e, DOOR, to, why);
      if (DBG && D.t - lastDbg > 3) { lastDbg = D.t; dbg(D, `outAndBack ${e.tag}: ${ok} [${why.slice(0, 3).join(' ')}]`); }
      return ok;
    };
    await D.until(() => blindLeft() > 45 && e7.isMoving && Math.cos(e7.heading) < -0.8 && e7.x > 58
      && Math.cos(e6.heading) > 0.8 && e6.isMoving && e6.x < 78 && outAndBack(e6, G_BODY6), 900, 'e6 walking east, e7 off west');
    await D.stance('diver', 'stand');
    await knifeFrom(D, 'diver', e6);
    await dragTo(D, 'diver', e6, G_BODY6, [DOOR]);
    await D.go('diver', ...G_HIDE, { tol: 0.5 });
    await D.stance('diver', 'crawl');
    D.checkpoint('C3 e6 knifed and dragged into the garage');
    // e7: at the east end of his beat he halts, looking out over the slipway, his head sweeping. The Marine goes back
    // into the water and, when e7's head is turned aside, spears him from the slipway's shallows; then he drags him
    // inside too (only e8, now and then as he walks east, could see him lie there)
    const OUT = [...TO_GARAGE].reverse().slice(1).concat([R2_TOP, R2_WATER]);
    await D.until(() => blindLeft() > 30 && routeClear(D, OUT, { mode: 'walk', from: [dv.x, dv.z], speed: 1.9, delay: 0.8, slack: 0.6, pad: 1 })
      && clearFor(D, [R2_WATER], 4, { mode: 'walk' }), 400, 'the way out unwatched');
    await D.stance('diver', 'stand');
    await D.path('diver', OUT, { tol: 0.5 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
    await D.go('diver', ...R2_E7, { tol: 0.4 });
    D.checkpoint('C4 the Marine back under water in the slipway');
    let lastD7 = 0;
    await D.until(() => {
      // (halted at the east end of his beat, or setting off west from it, his back to the slipway)
      if (!(e7.x > 66.5 && (e7.brain.atWait ? e7.x > 69 : e7.isMoving && Math.cos(e7.heading) < -0.8))) return false;
      const why = [];
      const c = [blindLeft() > 25, Math.hypot(e7.x - dv.x, e7.z - dv.z) < 8.6, unwitnessed(D, e7, dv, { ahead: 0.6, strict: true, why }),
        exactHalt(D, () => clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl', why })), // (e7 himself too: he must not see the Marine come up)
        clearFor(D, [[e7.x, e7.z], [e7.x + 1, e7.z], [72.5, 106]], 12, { mode: 'body', except: [e7], why }),
        clearFor(D, [R2_E7, [71.5, 111], [e7.x, e7.z], [74.6, 105.6], DOOR], 12, { mode: 'walk', except: [e7], why })];
      if (DBG && D.t - lastD7 > 1) { lastD7 = D.t; dbg(D, `e7 halt: ${c.map((v) => (v ? 1 : 0)).join('')} e7(${e7.x.toFixed(2)},${e7.z.toFixed(2)},${(e7.heading * 57.3).toFixed(0)}) dv(${dv.x.toFixed(2)},${dv.z.toFixed(2)}) [${why.slice(0, 3).join(' ')}]`); }
      return c.every(Boolean);
    }, 600, 'e7 halted at his east end, his head turned aside');
    D.ability('diver', 'harpoon', e7);
    await D.until(() => !e7.alive, 3, 'e7 speared');
    D.checkpoint('C5 the Marine spears e7 from the water');
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    await dragTo(D, 'diver', e7, G_BODY7, [[74.6, 105.6], DOOR]);
    D.checkpoint('C6 e7 dragged into the garage');
    // back down the slipway and into the water
    await D.until(() => routeClear(D, [DOOR, [73, 107], R2_TOP, R2_WATER], { mode: 'walk', from: [dv.x, dv.z], speed: 1.9, slack: 0.6, pad: 1 }), 300, 'the way out unwatched');
    await D.path('diver', [DOOR, [73, 107], R2_TOP, R2_WATER], { tol: 0.5 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
  }],
  ['D', 'The team on the jetty', async (D, ctx) => {
    const dv = D.c('diver'), e8 = D.get('e8');
    const p11 = ['p11a', 'p11b', 'p11c'].map((t) => D.get(t));
    // out through the open gate and back to the ledge, under water; gear off in the rim's shallows, into the raft
    const raft = D.raft();
    await D.go('diver', ...RIM_W_IN, { tol: 0.4, max: 150 });
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    D.ability('diver', 'enterVehicle', raft);
    await D.until(() => dv.vehicle === raft, 15, 'Marine in the raft');
    D.checkpoint('D1 the Marine back at the raft');
    for (const r of ['sniper', 'sapper', 'driver']) await boardRaft(D, r, ctx.boardPoint);
    D.checkpoint('D2 Sniper, Sapper and Driver aboard');
    // along the jetty's south face (nobody left there) and into the gateway, where no cone reaches the hull;
    // then, when e8 has just turned away west and the patrol is off north, hard across to the jetty's slipway (R5):
    // everyone out, the Marine packs the raft. The Green Beret waits for them at the top of the slipway
    await crawl(D, 'greenberet', ...R5_GB, { box: 6 });
    await rowOpen(D, [[60, 160], [40, 159], GATE_OUT_RAFT], { label: 'along the jetty' });
    await D.until(() => lockFree(D, 20), 120, 'the supply boat at her berth');
    // (it may lie there a while: the spot must stay out of sight, by the hull's nearest edge, for the next 30 s at least)
    await D.until(() => clearFor(D, [WAIT_IN], 30, { mode: 'boat', step: 0.25 }), 300, 'the gateway unwatched');
    await rowOpen(D, [[29.5, 152], WAIT_IN], { label: 'into the gateway' });
    const IN = [[33, 135.5], R5_RAFT];
    let lastDbg = 0;
    await D.until(() => {
      const why = [];
      // (e8 has just left the east end of his beat, walking back west: he will not look this way for 15 s)
      const e8Away = !e8.brain.atWait && e8.isMoving && Math.cos(e8.heading) < -0.5 && e8.x > 36.8;
      const ok = e8Away && legsClear(D, [{ pts: IN, hold: 5, bank: [R5_TOP, R5_UP] }], why, true, [e8]);
      if (DBG && D.t - lastDbg > 5) { lastDbg = D.t; dbg(D, `trip: e8away ${e8Away} why ${why.slice(0, 3).join(' ')}`); }
      return ok;
    }, 900, 'the trip in to the jetty slipway unwatched');
    const t0 = D.t;
    await rowOpen(D, IN, { now: true, run: true, label: 'in to the jetty slipway' });
    for (const r of ['sniper', 'driver', 'sapper', 'diver']) { D.ability(r, 'leaveVehicle'); await D.wait(0.15); }
    for (const [r, spot] of Object.entries(JETTY_SPOTS)) if (r !== 'diver') D.order(r, { type: 'move', x: spot[0], z: spot[1] });
    await D.until(() => !dv.vehicle, 5, 'Marine out');
    D.ability('diver', 'hand', raft);
    await D.until(() => !D.world.vehicles.includes(raft) || raft.removed, 10, 'raft packed');
    await D.until(() => !dv.currentAction, 3, 'the pack on his back'); // (folded and shouldered: abilities/raft-actions.js)
    D.order('diver', { type: 'move', x: JETTY_SPOTS.diver[0], z: JETTY_SPOTS.diver[1] });
    await D.until(() => Object.entries(JETTY_SPOTS).every(([r, [x, z]]) => Math.hypot(D.c(r).x - x, D.c(r).z - z) < 0.8 && !D.c(r).path), 40, 'everyone on the jetty');
    for (const r of Object.keys(JETTY_SPOTS)) D.order(r, { type: 'stance', stance: 'crawl' });
    dbg(D, `trip to the jetty took ${(D.t - t0).toFixed(1)} s`);
    D.checkpoint('D3 the team lands on the jetty; the Marine packs the raft');
  }],
  ['E', 'The mid-west mole', async (D) => {
    const dv = D.c('diver'), e8 = D.get('e8'), e9 = D.get('e9'), e10 = D.get('e10');
    const p11 = ['p11a', 'p11b', 'p11c'].map((t) => D.get(t));
    // e9 walks a few steps by the mid-west mole's ramp, where nobody else could see him lie: the Marine swims round
    // and spears him
    // (e8, at the east end of his beat, sees the jetty's edge 36 m off: the Marine gets up when he has turned away)
    await D.until(() => !e8.brain.atWait && e8.isMoving && Math.cos(e8.heading) < -0.5 && e8.x > 36.8
      && routeClear(D, [R5_DIVE], { mode: 'walk', from: [dv.x, dv.z], speed: 1.5, slack: 1, pad: 2 })
      && routeClear(D, [R5_DIVE], { mode: 'walk', from: R5_DIVE, delay: 3, slack: 1.5, pad: 2 }), 300, 'the slipway unwatched');
    await D.stance('diver', 'stand');
    await D.go('diver', ...R5_DIVE, { tol: 0.5 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
    await D.go('diver', ...E9_W, { tol: 0.6, max: 150 });
    D.checkpoint('E1 the Marine swims round to the mid-west mole');
    // e9: on his short beat by the ramp, walking away from it; nobody but e8 (from the west end of his beat) could
    // see him fall there
    await D.until(() => e9.z < 83.8 && e9.z > 79.6 && Math.hypot(e9.x - dv.x, e9.z - dv.z) < 8.4 && unwitnessed(D, e9, dv, { ahead: 0.6, strict: true })
      && clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' }) && !bodySeen(D, e9.x, e9.z, 60, { except: [e9, e10, e8] }).length, 400, 'e9 in reach, unwatched');
    D.ability('diver', 'harpoon', e9);
    await D.until(() => !e9.alive, 3, 'e9 speared');
    D.checkpoint('E2 the Marine spears e9 on the mole');
    // back to the jetty's slipway under water, for the raft
    await D.go('diver', ...R5_SHALLOW, { tol: 0.5, max: 150 });
  }],
  ['F', 'Three men to the garage', async (D, ctx) => {
    const dv = D.c('diver'), gb = D.c('greenberet'), e12 = D.get('e12');
    // the Green Beret, the Driver and the Sapper crawl to the east end of the jetty's slipway. When e8 (who watches
    // the basin from the east end of his beat) has turned away west and the patrol is away north, the Marine comes up
    // there, puts the raft back in the water, they climb in and he paddles them hard across to the slipway by the garage
    const e8 = D.get('e8'), crew = ['greenberet', 'driver', 'sapper'];
    for (const r of crew) await crawl(D, r, ...F_BOARD[r], { box: 5 });
    await D.go('diver', ...F_RAFT, { tol: 0.5, max: 150 });
    D.checkpoint('F1 the crew waits at the jetty slipway, the Marine under water below them');
    // e8 watches the basin from the east end of his beat: the raft moves when he has turned away west. First leg: up,
    // the raft, the crew aboard and hard to the basin's east corner by the rocks, beyond e8's sight, where it waits
    // while the patrol is away; second leg: in to the slipway by the garage, everyone out and down on the belly
    const bank = [F_RAFT, ...crew.map((r) => F_BOARD[r])];
    const e8Away = () => !e8.brain.atWait && e8.isMoving && Math.cos(e8.heading) < -0.5 && e8.x > 36.8;
    await D.until(() => e8Away() && legsClear(D, [{ pts: [], hold: 7, bank }, { pts: [F_HOLD], hold: 55 }], null, true, [e8], F_RAFT), 900, 'the slipway unwatched');
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    D.ability('diver', 'raft');
    await D.until(() => dv.vehicle && dv.vehicle.def?.raft, 30, 'raft deployed');
    const raft0 = dv.vehicle;
    for (const r of crew) { await D.stance(r, 'stand'); D.ability(r, 'enterVehicle', raft0); }
    await D.until(() => crew.every((r) => D.c(r).vehicle === raft0), 15, 'the crew aboard');
    await rowOpen(D, [F_HOLD], { now: true, run: true, label: 'to the basin\'s east corner' });
    D.checkpoint('F2 the crew in the raft, across to the basin\'s east corner by the rocks');
    await D.until(() => e8Away() && legsClear(D, [{ pts: [R2_RAFT], hold: 8, bank: [R2_TOP, R2_PRONE] }], null, true, [e8]), 600, 'the slipway by the garage unwatched');
    await rowOpen(D, [R2_RAFT], { now: true, run: true, label: 'in to the garage slipway' });
    for (const r of crew) { D.ability(r, 'leaveVehicle'); await D.wait(0.2); }
    // (up out of the shallows first: nobody lies down in the water)
    crew.forEach((r, k) => D.order(r, { type: 'move', x: R2_PRONE[0] + (k - 1) * 1.2, z: R2_PRONE[1] }));
    await D.until(() => crew.every((r) => !D.c(r).path), 15, 'up the slipway');
    await downAll(D, crew);
    // the Marine packs the raft in the slipway's shallows and goes under water
    const raft = raftOf(D);
    D.ability('diver', 'leaveVehicle');
    await D.until(() => !dv.vehicle, 5, 'Marine out');
    D.ability('diver', 'hand', raft);
    await D.until(() => !D.world.vehicles.includes(raft) || raft.removed, 10, 'raft packed');
    await D.until(() => !dv.currentAction, 3, 'the pack on his back'); // (folded and shouldered: abilities/raft-actions.js)
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'gear on');
    for (const r of crew) await crawl(D, r, ...GARAGE_SPOTS[r], { box: 8 });
    D.checkpoint('F3 in at the slipway by the garage: the three crawl inside');
    // e12 stands behind the sandbags north of the garage, looking west over the quay. The Green Beret crawls round the
    // back of the garage and lies in the alley behind it, out of everyone's sight
    // (while Patrol 11 walks away north: from its beat a man lying at the garage's back corner is just in reach)
    const p11 = ['p11a', 'p11b', 'p11c'].map((t) => D.get(t));
    await D.until(() => p11.every((e) => e.z < 82) && Math.sin(p11[0].heading) < -0.7 && p11[0].isMoving, 400, 'Patrol 11 walking away north');
    // (the alley itself is too narrow for the planner's metre lattice: crawled straight through on the game's own path)
    for (const [x, z] of GB_E12_ROUTE.slice(0, 2)) await crawl(D, 'greenberet', x, z, { box: 6, tol: 0.6 });
    await crawlOpen(D, 'greenberet', GB_E12_ROUTE.slice(2), { label: 'the alley behind the garage' });
    D.checkpoint('F4 the Green Beret lies in the alley behind the garage');
    await D.go('diver', ...E10_W, { tol: 0.5, max: 200 });
  }],
  ['G', 'Patrol 11\'s last round', async (D) => {
    const sn = D.c('sniper'), dv = D.c('diver'), gb = D.c('greenberet');
    const [e8, e10, e12, e18, e19] = ['e8', 'e10', 'e12', 'e18', 'e19'].map((t) => D.get(t));
    const p11 = ['p11a', 'p11b', 'p11c'].map((t) => D.get(t));
    // Patrol 11 sees every body along its beat, and turning back north at the south end of it, the whole dock's south
    // edge and the mid-west mole. It is on its last round: everyone it would see dies before it gets back there, and
    // at the south end of its beat the Sniper drops all three before they turn
    const p11North = () => p11.every((e) => Math.sin(e.heading) < -0.7) || (p11[0].brain.atWait && p11[0].z < 52);
    // e10: only e8 (and the patrol, turning) can see the post; he is speared while e8 walks east, and the Sniper takes
    // e8 before he turns back. e8 lies where only the patrol, turning, would see him
    const e8East = () => !e8.brain.atWait && e8.isMoving && Math.cos(e8.heading) > 0.5 && e8.x < 35.5;
    await D.until(() => p11North() && p11[0].z < 95 && e8East() && D.t >= (dv._harpoonT ?? 0) && Math.hypot(e10.x - dv.x, e10.z - dv.z) < 8.85
      && unwitnessed(D, e10, dv, { ahead: 0.6, strict: true }) && clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' })
      && unwitnessed(D, e8, sn, { ahead: 2.5, strict: true, except: [e10] }), 600, 'the patrol walking north, e8 walking east, e10 in reach');
    D.ability('diver', 'harpoon', e10);
    await D.until(() => !e10.alive, 3, 'e10 speared');
    D.checkpoint('G1 the Marine spears e10 on the mid-west mole');
    D.ability('sniper', 'sniper', e8);
    await D.until(() => !e8.alive, 3, 'e8 shot');
    D.checkpoint('G2 the Sniper drops e8 from the jetty');
    // the Marine swims up the basin to the sub guards; the patrol turns at the north end of its beat and walks south
    await D.go('diver', ...E18_W, { tol: 0.5, max: 200 });
    const p11South = (z) => p11.every((e) => e.z > z) && (Math.sin(p11[0].heading) > 0.7 || p11[0].brain.atWait);
    await D.until(() => p11[0].brain.atWait && p11[0].z < 52, 400, 'Patrol 11 at the north end of its beat');
    // e18 and e19 each would see the other lie: e18 first, when e19 has turned his back on him; then e19, before he
    // turns back. The patrol is walking away south by then
    await D.until(() => p11South(72) && !e19.brain.atWait && Math.sin(e19.heading) > 0.7 && e19.z < 64 && Math.hypot(e18.x - dv.x, e18.z - dv.z) < 8.8
      && unwitnessed(D, e18, dv, { ahead: 0.6, strict: true }) && exactHalt(D, () => clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl', except: [e18] })), 120, 'the patrol gone south, e19 walking away from e18');
    D.ability('diver', 'harpoon', e18);
    await D.until(() => !e18.alive, 3, 'e18 speared');
    D.checkpoint('G3 behind the patrol, the Marine spears e18 by the sub pontoon');
    await D.go('diver', ...E19_W, { tol: 0.5 });
    await D.until(() => {
      if (Math.sin(e19.heading) < -0.3 && !e19.brain.atWait) throw new Error('e19 turned back north alive');
      return D.t >= (dv._harpoonT ?? 0) && Math.hypot(e19.x - dv.x, e19.z - dv.z) < 8.8 && unwitnessed(D, e19, dv, { ahead: 0.6, strict: true })
        && exactHalt(D, () => clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' }));
    }, 20, 'e19 in reach');
    D.ability('diver', 'harpoon', e19);
    await D.until(() => !e19.alive, 3, 'e19 speared');
    D.checkpoint('G4 and e19, at the south end of his steps');
    // e12: the Green Beret crawls along the garage's north side to just behind him (the patrol, walking away south,
    // cannot see it), and knifes him once the patrol has walked past his post (on its way back north it would see him)
    // (out of the alley's mouth on the game's own path, as he came in; then the planner's way along the wall)
    await crawlOpen(D, 'greenberet', [[86.25, 91.25], E12_BACK[0]], { label: 'out of the alley' });
    for (const [x, z] of E12_BACK.slice(1)) await crawl(D, 'greenberet', x, z, { box: 5, tol: 0.5 });
    await D.until(() => p11South(93.5) && unwitnessed(D, e12, gb, { ahead: 2.5, strict: true })
      && clearFor(D, [[gb.x, gb.z], [e12.x + 0.6, e12.z + 0.3]], 2.6, { mode: 'walk', except: [e12] }), 40, 'the patrol past e12');
    D.ability('greenberet', 'knife', e12); // (he crawls up behind him and gets up only at arm's length)
    await D.until(() => !e12.alive, 10, 'e12 knifed');
    await D.idle('greenberet');
    await D.stance('greenberet', 'crawl');
    D.checkpoint('G5 the Green Beret knifes e12 behind the patrol\'s back');
    const halted = () => p11.every((e) => !e.alive || (Math.hypot(e.x - 66, e.z - 108.5) < 4 && Math.sin(e.heading) > 0.5)) && p11[0].brain.atWait;
    await D.until(() => halted() && (p11[0].brain.waitT ?? 0) > 3.2, 40, 'Patrol 11 halted at the south end');
    for (let k = 0; k < 3; k++) {
      const live = p11.filter((e) => e.alive).sort((a, b) => a.z - b.z); // (facing south: the northernmost man is the rear one)
      const v = live[0];
      await D.until(() => D.t >= (sn._boltT ?? 0) && unwitnessed(D, v, sn, { ahead: 0.8, strict: true }), 4, `${v.tag} unwatched`);
      D.ability('sniper', 'sniper', v);
      await D.until(() => !v.alive, 3, `${v.tag} shot`);
    }
    D.checkpoint('G6 the Sniper drops Patrol 11 at the south end of its beat, from the jetty');
  }],
  ['H', 'The truck across the garage door', async (D) => {
    // the Driver backs the truck out and parks it across the garage door: the tank inside can never come out
    const tr = D.world.byId('truck'), drv = D.c('driver');
    await D.until(() => !drv.path, 20, 'Driver in the garage');
    await D.until(() => routeClear(D, [TRUCK_DOOR, [70, 104.8]], { mode: 'walk', from: [drv.x, drv.z], speed: 2 }) && clearFor(D, TRUCK_SWEEP, 20, { mode: 'walk' }), 300, 'the truck unwatched');
    await D.stance('driver', 'stand');
    D.ability('driver', 'enterVehicle', tr);
    await D.until(() => drv.vehicle === tr, 40, 'Driver in the truck');
    D.order('driver', { type: 'move', x: TRUCK_PARK[0], z: TRUCK_PARK[1] });
    await D.until(() => !tr.goal && (tr.speed || 0) < 0.05 && D.t > 0, 40, 'truck parked');
    D.checkpoint('H1 the Driver parks the truck across the garage door');
  }],
  ['I', 'The north lock\'s guards', async (D) => {
    const dv = D.c('diver'), [e13, e14] = ['e13', 'e14'].map((t) => D.get(t));
    // the Marine swims up the basin to the north quay's slipway (R1), under the lock keeper's shack
    await D.go('diver', ...R1_W, { tol: 0.5, max: 200 });
    D.checkpoint('I1 the Marine under water at the north quay slipway');
    // e14 walks the quay from the crane to the slipway's head and back: speared as he turns away from it, where
    // nobody else could see him lie (low behind the barrels)
    await D.until(() => !e14.brain.atWait && Math.sin(e14.heading) < -0.7 && e14.z > 43 && e14.z < 45.6 && Math.hypot(e14.x - dv.x, e14.z - dv.z) < 8.8
      && unwitnessed(D, e14, dv, { ahead: 0.6, strict: true }) && clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' })
      && !bodySeen(D, e14.x, e14.z - 0.8, 120, { except: [e14, e13] }).length, 600, 'e14 walking away from the slipway');
    D.ability('diver', 'harpoon', e14);
    await D.until(() => !e14.alive, 3, 'e14 speared');
    D.checkpoint('I2 the Marine spears e14 from the slipway');
    // e13, the north lock's keeper, looks out over the basin; only e14 could have seen him lie by his shack
    await D.until(() => D.t >= (dv._harpoonT ?? 0) && Math.hypot(e13.x - dv.x, e13.z - dv.z) < 8.8 && unwitnessed(D, e13, dv, { ahead: 0.6, strict: true })
      && clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' }), 120, 'e13 looking aside');
    D.ability('diver', 'harpoon', e13);
    await D.until(() => !e13.alive, 3, 'e13 speared');
    D.checkpoint('I3 and e13, the lock keeper');
  }],
  ['J', 'The fuel depot', async (D) => {
    const gb = D.c('greenberet'), sp = D.c('sapper'), e16 = D.get('e16');
    // e16 walks from the fuel tanks to the depot's crates and back, past the spot where the charge must go, halting at
    // each end. The Sapper crawls out of the garage, up the east quay and into the crates' shadow by the west end of
    // e16's beat; when e16 walks away east he crawls out and sets his bear trap on e16's way back, a step short of the
    // halt, and lies back in the shadow: e16 walks into it before he turns round there (the moment he would see the
    // shadow's edge).
    await crawlOpen(D, 'sapper', [...SAPPER_OUT, ...GB_UP_QUAY], { label: 'Sapper up the east quay' });
    await crawlOpen(D, 'sapper', [[62.5, 45]], { label: 'Sapper to the north quay', turns: true });
    await crawl(D, 'sapper', ...CRATES_POCKET, { box: 5, horizon: 200, tol: 0.4 });
    await D.go('sapper', ...CRATES_POCKET, { tol: 0.15 });
    // (while e16 walks away east, his back to the crates; the trap goes down on his way back, a step short of his halt)
    await D.until(() => !e16.brain.atWait && Math.cos(e16.heading) > 0.5 && Math.hypot(e16.x - TRAP_AT[0], e16.z - TRAP_AT[1]) > 9
      && clearFor(D, [CRATES_POCKET, TRAP_STAND], 9, { mode: 'crawl' }), 300, 'e16 walking away east');
    await D.go('sapper', ...TRAP_STAND, { tol: 0.3 });
    D.ability('sapper', 'trap', { x: TRAP_AT[0], z: TRAP_AT[1] });
    await D.until(() => (sp.inventory.get('bearTrap') ?? 0) === 0, 10, 'trap set');
    D.checkpoint('J1 the Sapper sets his bear trap on e16\'s way back to the crates');
    await D.go('sapper', ...CRATES_POCKET, { tol: 0.15 });
    await D.until(() => !e16.alive, 300, 'e16 walks into the trap');
    D.checkpoint('J2 e16 walks back west into the bear trap');
    // the Sapper crawls along the north quay's edge to the tanks' cradle and sets the remote charge there
    await crawl(D, 'sapper', ...FUEL_AT, { box: 6, horizon: 240 });
    await D.until(() => clearFor(D, [[sp.x, sp.z]], 2, { mode: 'crawl' }), 120, 'the cradle unwatched');
    D.ability('sapper', 'remoteBomb');
    await D.until(() => (sp.inventory.get('remoteBomb') ?? 0) === 0, 10, 'charge set');
    D.checkpoint('J3 the Sapper sets the remote charge under the fuel tanks');
    await crawl(D, 'sapper', 62.5, 53, { box: 6, horizon: 240 });
    await crawlOpen(D, 'sapper', [...[...GB_UP_QUAY].reverse(), ...[...SAPPER_OUT].reverse(), GARAGE_SPOTS.sapper], { label: 'Sapper back to the garage' });
    D.checkpoint('J4 the Sapper crawls back to the garage');
    // e17 stands among the depot's crates looking west along the north quay, over the north lock's slipway; e15 paces
    // a few steps in front of him and sees round him only as he walks back east. The Green Beret lies south of the crates
    // and, when e15 halts at the east end of his steps looking north, crawls in behind e17 and knifes him, then walks
    // after e15 and knifes him too, before he turns back east and sees e17 lie
    const e15 = D.get('e15'), e17 = D.get('e17');
    await crawlOpen(D, 'greenberet', GB_UP_QUAY, { label: 'Green Beret up the east quay' });
    await crawl(D, 'greenberet', ...GB_E17, { box: 8, horizon: 300 });
    D.checkpoint('J5 the Green Beret crawls up behind e17');
    // (east of the crates' corner: in the game their footprint reaches x 58.5)
    const IN17 = [[59, 45.8], [58.9, 42.2]];
    let lastJ = 0;
    await D.until(() => {
      // (e15 sees round e17 only while he walks east: from his halt at the east end, looking north, there are 16 s)
      if (!(e15.brain.atWait && e15.x > 50 && (e15.brain.waitT ?? 0) > 6.5)) return false;
      const why = [];
      const a = routeClear(D, IN17, { mode: 'crawl', from: [gb.x, gb.z], speed: 0.8, slack: 0.8, pad: 1, why });
      const b = exactHalt(D, () => clearBetween(D, [[e17.x + 0.8, e17.z]], 6, 9.5, 'walk', why));
      if (DBG && D.t - lastJ > 2) { lastJ = D.t; dbg(D, `e17 approach: ${a} ${b} [${why.slice(0, 3).join(' ')}]`); }
      return a && b;
    }, 600, 'e15 walking away west');
    await D.path('greenberet', IN17, { tol: 0.4 });
    await D.until(() => unwitnessed(D, e17, gb, { ahead: 2.5, strict: true, except: [e15] }), 10, 'e17 unwatched');
    D.ability('greenberet', 'knife', e17); // (he crawls in and gets up at arm's length)
    await D.until(() => !e17.alive, 10, 'e17 knifed');
    await D.idle('greenberet');
    D.checkpoint('J6 the Green Beret knifes e17');
    await D.stance('greenberet', 'stand');
    await knifeFrom(D, 'greenberet', e15);
    await D.idle('greenberet');
    await D.stance('greenberet', 'crawl');
    D.checkpoint('J7 and e15, at the west end of his steps');
    // back down the east quay to the slipway by the garage
    await crawlOpen(D, 'greenberet', [[60, 46.5], [62.5, 53], ...[...GB_UP_QUAY].reverse(), [69, 100], [71.5, 108]], { label: 'Green Beret back down the quay' });
  }],
  ['K', 'The north gate and the sub', async (D) => {
    const dv = D.c('diver'), e20 = D.get('e20');
    // nobody is left on the north quay: the Marine climbs out at its slipway and opens the north gate
    const lever = D.item('lever_n'), lock = D.world.setpieces.get('lock_n');
    await D.go('diver', ...R1_EDGE, { tol: 0.4 });
    let lastW = 0;
    await D.until(() => {
      const why = [];
      const ok = clearBetween(D, [R1_EDGE, R1_LAND], 1.3, 2.6, 'walk', why);
      if (DBG && D.t - lastW > 3) { lastW = D.t; dbg(D, `R1 up: ${ok} [${why.slice(0, 3).join(' ')}]`); }
      return ok;
    }, 600, 'the slipway\'s head unwatched');
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off');
    await D.go('diver', ...R1_LAND, { tol: 0.4 });
    await downAll(D, ['diver']);
    await crawl(D, 'diver', ...LEVER_N_AT, { box: 6 });
    await D.until(() => clearFor(D, [[dv.x, dv.z]], 3, { mode: 'crawl' }), 300, 'the lever unwatched');
    D.ability('diver', 'use', lever);
    await D.until(() => lock.latched && lock.open, 10, 'north gate latched open');
    D.checkpoint('K1 the Marine works the lever: the north gate opens and stays open');
    // back the same way into the water; he swims on without his gear, low in the water
    await crawl(D, 'diver', ...R1_LAND, { box: 6 });
    await D.until(() => clearBetween(D, [R1_LAND, R1_EDGE, [38.6, 54], R1_DEEP], 0, 6, 'walk'), 600, 'the slipway\'s head unwatched');
    await D.stance('diver', 'stand');
    await D.go('diver', ...R1_DEEP, { tol: 0.6 });
    // e20, the last of the sub's guards, on the pontoon by the sub: only e14 could have seen him lie there
    await D.until(() => routeClear(D, [[45, 61.5], E20_W], { mode: 'crawl', from: [dv.x, dv.z], speed: 1.2, slack: 1, pad: 1.5 }), 300, 'the swim to the pontoon unwatched');
    await D.path('diver', [[45, 61.5], E20_W], { tol: 0.6 });
    await D.until(() => D.t >= (dv._harpoonT ?? 0) && Math.hypot(e20.x - dv.x, e20.z - dv.z) < 8.8 && unwitnessed(D, e20, dv, { ahead: 0.6, strict: true })
      && exactHalt(D, () => clearFor(D, [[dv.x, dv.z]], 0.7, { mode: 'crawl' })), 120, 'e20 looking aside');
    D.ability('diver', 'harpoon', e20);
    await D.until(() => !e20.alive, 3, 'e20 speared');
    D.checkpoint('K2 the Marine spears e20 on the pontoon');
  }],
  ['L', 'Torpedo, fuel, and out to the buoy', async (D, ctx) => {
    const dv = D.c('diver'), sub = D.world.byId('sub'), gun = D.world.byId('pier_gun');
    const crew = ['greenberet', 'driver', 'sapper'];
    // the Marine fetches the raft: up at the slipway by the garage, the three crawl out and climb in
    await D.go('diver', ...R2_WATER, { tol: 0.6, max: 200 });
    if (dv.diving) { D.ability('diver', 'dive'); await D.until(() => !dv.diving && !dv.currentAction, 5, 'gear off'); }
    await D.until(() => clearFor(D, [R2_WATER], 4, { mode: 'walk' }), 300, 'the slipway unwatched');
    D.ability('diver', 'raft');
    await D.until(() => dv.vehicle && dv.vehicle.def?.raft, 30, 'raft deployed');
    const drv = D.c('driver');
    if (drv.vehicle) { D.ability('driver', 'leaveVehicle'); await D.until(() => !drv.vehicle, 5, 'Driver out of the truck'); await downAll(D, ['driver']); }
    for (const [k, r] of crew.entries()) await crawl(D, r, R2_PRONE[0] + (k - 1) * 1.4, R2_PRONE[1], { box: 8 });
    for (const r of crew) await boardRaft(D, r, ctx.boardPoint);
    D.checkpoint('L1 the Green Beret, the Driver and the Sapper back in the raft');
    // across the basin (nobody left to see it) to the jetty's slipway for the Sniper, then to the south-west mole
    await rowOpen(D, [[60, 128], R5_RAFT], { label: 'to the jetty slipway' });
    await boardRaft(D, 'sniper', ctx.boardPoint);
    await rowOpen(D, [[33, 135], R4_RAFT], { label: 'to the south-west mole' });
    D.checkpoint('L2 the Sniper picked up; the raft at the south-west mole');
    // the Driver mans the pier gun on the mole's head: a patrol boat will come when the alarm goes up
    D.ability('driver', 'leaveVehicle');
    await D.until(() => !D.c('driver').vehicle, 5, 'Driver out');
    D.ability('driver', 'enterVehicle', gun);
    await D.until(() => D.c('driver').vehicle === gun, 40, 'Driver on the pier gun');
    D.checkpoint('L3 the Driver mans the pier gun');
    // the raft goes out through the south gate to the open sea off the jetty, far beyond anyone's sight once the port
    // wakes up; there the Marine goes over the side and swims, under water, back in and up the basin to the mini-sub
    await D.until(() => lockFree(D, 20), 120, 'the supply boat at her berth');
    await rowOpen(D, [[28.4, 140], [28.4, 152], [40, 159], RAFT_OUT], { label: 'out through the south gate' });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater && !dv.vehicle, 10, 'Marine under water');
    const raft = raftOf(D);
    D.checkpoint('L4 the raft waits off the jetty; the Marine swims in to the mini-sub');
    await D.go('diver', sub.x - 1.5, sub.z + 1.5, { tol: 1.2, max: 300 });
    D.ability('diver', 'enterVehicle', sub);
    await D.until(() => dv.vehicle === sub, 15, 'Marine in the sub');
    D.checkpoint('L5 the Marine takes the mini-sub');
    // west along the basin, then into position south of the open north gate, bow due north at the battleship's bow
    for (const [x, z] of SUB_ROUTE) {
      D.order('diver', { type: 'move', x, z });
      await D.until(() => Math.hypot(sub.x - x, sub.z - z) < 1.2 || (!sub.goal && (sub.speed || 0) < 0.05 && D.t > 0), 120, `sub → (${x},${z})`);
    }
    await D.until(() => !sub.goal && (sub.speed || 0) < 0.05, 20, 'sub stopped');
    dbg(D, `sub at (${sub.x.toFixed(1)},${sub.z.toFixed(1)}) heading ${(sub.heading * 180 / Math.PI).toFixed(0)}`);
    D.checkpoint('L6 the sub lies south of the north gate, bow on the battleship');
    D.ability('diver', 'vehicleFire', { x: sub.x + Math.cos(sub.heading) * 30, z: sub.z + Math.sin(sub.heading) * 30 });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o_ship').done, 20, 'the battleship hit');
    D.checkpoint('L7 the torpedo runs through the gate and strikes the bow: objective 1');
    D.ability('sapper', 'detonate');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o_fuel').done, 10, 'fuel tanks gone');
    D.checkpoint('L8 the Sapper fires the charge by radio: the fuel tanks go up, objective 2');
    // the Marine leaves the sub under water and swims back out to the raft. Meanwhile the patrol boat comes in from the
    // open sea (20 s after the alarm), making for the buoy: the Driver opens fire with the pier gun as soon as it shows,
    // long before its machine-gunner is near enough to see him or the raft
    D.ability('diver', 'leaveVehicle');
    await D.until(() => !dv.vehicle, 5, 'Marine out of the sub');
    if (!dv.diving) { D.ability('diver', 'dive'); await D.until(() => dv.underwater, 5, 'under water'); }
    // (down the basin and out through the south gate, a few clicks on the way, then a click on the water beside the
    // raft: the first spot the game takes)
    // (a click the game refuses is clicked again a second later)
    const legs = [[28.4, 110], [28.4, 140], [28.4, 152], [40, 159]];
    let nextTry = 0;
    // (the gun fires only when its line to the patrol boat keeps clear of the supply boat and the raft — a shell falls
    // short or long now and then — and the patrol boat is well away from them: she goes up with a blast)
    const lineFree = (a, b, others) => others.every((o) => {
      if (!o || o.destroyed || o.removed) return true;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1.25, ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2));
      return Math.hypot(a.x + dx * u - o.x, a.z + dz * u - o.z) > 6 && Math.hypot(b.x - o.x, b.z - o.z) > 16;
    });
    const toRaft = () => {
      if (D.t < nextTry) return;
      nextTry = D.t + 1;
      while (legs.length && Math.hypot(dv.x - legs[0][0], dv.z - legs[0][1]) < 1.5) legs.shift();
      if (legs.length) { try { D.order('diver', { type: 'move', x: legs[0][0], z: legs[0][1] }); } catch (e) { dbg(D, `swim leg refused: ${e.message}`); } return; }
      for (const [a, b] of [[-1.5, 0.5], [-2, 0], [-1.5, -1], [0, -2], [-2.5, 1.5], [0, 2]]) {
        try { D.order('diver', { type: 'move', x: raft.x + a, z: raft.z + b }); return; } catch { /* next spot */ }
      }
    };
    toRaft();
    let sunk = false;
    await D.until(() => {
      const pb = D.world.byId('pboat');
      if (pb && !(pb.destroyed || pb.removed) && lineFree(gun, pb, [D.world.byId('supply'), raft])) { try { D.ability('driver', 'vehicleFire', pb); } catch { /* reloading */ } }
      if (pb && (pb.destroyed || pb.removed) && !sunk) { sunk = true; dbg(D, `patrol boat sunk at (${pb.x.toFixed(1)},${pb.z.toFixed(1)})`); D.checkpoint('L9 the Driver sinks the patrol boat with the pier gun'); }
      if (!dv.path && !dv.currentAction && dv.vehicle !== raft) {
        if (Math.hypot(dv.x - raft.x, dv.z - raft.z) < 3) { try { D.ability('diver', 'enterVehicle', raft); } catch { /* still swimming in */ } }
        else toRaft();
      }
      return sunk && dv.vehicle === raft;
    }, 300, 'patrol boat sunk, Marine back in the raft');
    D.checkpoint('L10 the Marine swims back out to the raft');
    // the Driver: the raft slips in to the south-west mole's ramp for him when nobody on the dock looks that way. The
    // dock is awake now, its men running all over the quays: nobody who is not at his post may be within sight of the
    // way in, whichever way he looks
    const drv2 = D.c('driver');
    D.ability('driver', 'leaveVehicle');
    await D.until(() => !drv2.vehicle, 5, 'Driver off the gun');
    await downAll(D, ['driver']);
    await crawl(D, 'driver', ...R4_TOP, { box: 6 });
    // (west of the supply boat's track through the lock, and while she lies at her berth)
    const IN = [[40, 159], [28.4, 152], [28.4, 140], [33, 135], R4_RAFT], OUT = [[33, 135], [28.4, 140], [28.4, 152], [24, 166], BUOY];
    // (the supply boat at her berth long enough for the raft to come in, take him aboard and get out past the gate)
    let lastR = 0;
    await D.until(() => {
      // (the siren quiet and every man back on his beat or post: one running about can turn up anywhere in the time)
      const a = lockFree(D, 34), rr = [], b = !D.world.alarm?.active && !roamers(D, rr), c = a && b && legsClear(D, [{ pts: IN, hold: 8, bank: [R4_TOP] }, { pts: OUT.slice(0, 3) }], null, true);
      if (DBG && (D.t - lastR > 5 || (a && b && c))) { lastR = D.t; dbg(D, `ramp: lock ${a} roamers ${rr.join(' ')} legs ${c} | ${viewersOf(D.world).filter((e) => Math.hypot(e.x - 28, e.z - 137) < 50).map((e) => `${e.tag}:${e.brain?.state}/${e.brain?.phase ?? ''}@(${e.x.toFixed(0)},${e.z.toFixed(0)},${(e.heading * 57.3).toFixed(0)})${walking(e) ? 'w' : ''}`).join(' ')}`); }
      return a && b && c;
    }, 1800, 'the mole\'s ramp unwatched');
    await rowOpen(D, IN, { now: true, run: true, label: 'in to the mole\'s ramp' });
    await boardRaft(D, 'driver', ctx.boardPoint, { now: true });
    D.checkpoint('L11 the Driver climbs in at the south-west mole');
    // (round the patrol boat's wreck, wherever she went down: a click on open water beside it, then the buoy)
    const wreck = D.world.byId('pboat'), segGap = (a, b, o) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], u = Math.max(0, Math.min(1, ((o.x - a[0]) * dx + (o.z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(a[0] + dx * u - o.x, a[1] + dz * u - o.z);
    };
    const via = [[], [[8, 165]], [[22, 182]], [[10, 162], [0, 170]]].find((v) => {
      const p = [OUT[OUT.length - 2], ...v, BUOY];
      return !wreck || wreck.removed || p.slice(1).every((q, k) => segGap(p[k], q, wreck) > 4.5);
    }) ?? [];
    await rowOpen(D, [...OUT.slice(0, -1), ...via, BUOY], { now: true, run: true, label: 'out to the buoy' });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o_buoy').done, 30, 'out at the buoy');
    D.checkpoint('L12 everyone in the raft at the red buoy: mission complete');
  }],
];

/**
 * Play the whole mission. `ctx.until`: stop after that stage (debugging).
 */
export async function solve(D, ctx = {}) {
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
