/**
 * M2 "A Quiet Blow-Up" (Stamsund): a full stealth solution, played only with player orders.
 *   A  the team skirts the settlement behind its south and east walls (ground no guard ever looks at);
 *   B  the Sniper, lying on the bank, shoots e4 at the east end of his beat across the river, where nobody sees him fall;
 *   C  the team crawls down to a launch on the bank south-east of the settlement (too far from its east gap for anyone
 *      inside to see a man there, or his tracks); behind the patrol boat's back (it looks the way it goes) the Marine
 *      rows the Green Beret and the Sniper across, packs the raft and swims back under water;
 *   D  in the boat's next gap he takes the Sapper and the Driver; the whole team lies outside the camp's SE wall;
 *   E  one by one they crawl round the lowered boom by the gate's footway into the truck (the Driver to his cab door,
 *      the others via the lee of the cab to the tailgate), each when nobody will see him on the way or climbing in;
 *   F  the Sapper slips out of the truck, walks into the gap between the two fuel tanks, sets a time bomb and walks
 *      back; with the bomb's last seconds ticking the Driver drives flat out through the boom and down the road out.
 * Two dead: e4 (the Sniper) and e7, the depot guard, caught in the blast; no commando ever seen. The blast raises the alarm (any explosion on the camp bank does: zone z_ne
 * onHeard RINT) under a second before the truck reaches the exit — the mission design forces it, and it is the only
 * alarm. Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the
 * real game: node tools/solutions/run-browser.mjs m02 (also tests/m02-solution.test.mjs). Walkthrough:
 * m02.walkthrough.mjs.
 */
import { clearFor, routeClear, sneak, unwitnessed, bodySeen } from './sneak.mjs';
import { ABILITIES } from '../../src/abilities/registry.js';
import { CONFIG } from '../../src/config.js';

const DBG = !!globalThis.process?.env?.M02DBG || !!globalThis.__M3DBG;

// places (m)
const BEHIND_WALL = [29.5, 116.5]; // past the settlement's south-east corner, outside its wall
const EAST_SIDE = [31, 108]; // up the settlement's east side
// where each man waits, east of the settlement (nobody looks there)
const WAIT = { greenberet: [29, 101], sniper: [29.5, 103], diver: [30.5, 105], sapper: [29, 107], driver: [30.5, 108.5] };
const SNIPER_SPOT = [31.5, 91]; // prone on the bank: e4's east halt is 34 m across the river, in sight
const E4_HALT = [40, 57.5]; // e4's east halt, outside the camp's south corner (nobody sees a body there)
const LAUNCH = [43.6, 97.6]; // the shallows below the bank south-east of the settlement: the raft goes in here
// where the passengers lie by the launch, waiting for their trip
const BANK = { diver: [42.6, 97.9], greenberet: [43.0, 99.2], sniper: [41.6, 99.0], sapper: [44.2, 98.6], driver: [42.2, 100.4] };
const LAND_UP = [45.6, 62.6]; // the snow just above the landing
const LANDING = [44.2, 64.4]; // the far shallows, south-east of the camp's south corner
// the crossing: down the channel west of islet 2, then across the boat lane to the landing
const CROSS = [[44.5, 90], [45.2, 80], [44.6, 70], LANDING];
const BACK = [[44.6, 70], [45.2, 80], [44.5, 90], LAUNCH];
// where each man lies outside the camp's south-east wall, waiting (nobody ever sees a man lying there)
const HIDE = { diver: [47.0, 58.9], greenberet: [48.3, 57.9], sniper: [49.6, 56.9], sapper: [48.9, 59.3], driver: [51.0, 55.9] };

/** (debug) log why a wait goes on, now and then; always false */
let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 60 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/** move several men at once (plain orders, ground nobody watches) and wait until all have stopped */
async function group(D, moves, label = 'group') {
  for (const [role, [x, z]] of Object.entries(moves)) D.order(role, { type: 'move', x, z });
  await D.until(() => Object.entries(moves).every(([role, [x, z]]) => { const u = D.c(role); return !u.path && !u.isMoving || Math.hypot(u.x - x, u.z - z) < 0.4; }), 120, label);
}

// the camp
const BOOM_ACT = 3.5; // s at the boom: up on his feet, raise it, down again
const BOOM_SPOT = [56.8, 50.6]; // prone in front of the lowered boom, outside: in reach of its pivot to raise it
const BOOM_IN = [[55.0, 48.0], [53.75, 45.5], [52.9, 43.4]]; // under the raised boom and up the truck's near side
const boomOf = (D) => D.item('gate_se');
const STAGE = [52.08, 43.45]; // prone in the lee of the truck's cab, on its depot side (the truck hides him from e6's beat)
const STAGE_REAR = [50.05, 41.24]; // on along the truck's depot side, to its tailgate
const GAP = [51.6, 33.3]; // at the gap between the two fuel tanks (as near as a man gets): a bomb here takes both
const EXIT = [78, 66]; // the road out (the mission's exit)
const CRAWL = 0.8; // m/s on his belly (0.9 on the straight)
const WALK = 2.25; // m/s walking (running feet are heard)
const DRIVE_T = 4.5; // s: the truck from its parking place to the road's end, flat out
const truckOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'truck');

const pathLen = (from, pts) => { let L = 0; for (let k = 0, [x, z] = from; k < pts.length; [x, z] = pts[k++]) L += Math.hypot(pts[k][0] - x, pts[k][1] - z); return L; };

/**
 * A man lying outside the wall crawls into the truck: in through the gate (the Driver, first, crawls up to the lowered
 * boom, gets up, raises it and gets down again; a man on his belly cannot squeeze round it by the footway), to his door — the
 * Driver straight to the cab, the others via the lee of the cab on its depot side, where only the depot guard e7 and
 * the patrol ever look, round to the tailgate — and there he gets up and climbs in. Each leg goes when nobody will see
 * him on it nor, at its end, lying there (or standing up, at the boom or to climb in). His way is the game's own path for him
 * (Unit._planPath: the line the move cursor shows); past the boom before it is up, the road's line.
 */
async function boardTruck(D, role, truck, { onBoom = null } = {}) {
  const u = D.c(role), boom = boomOf(D);
  const door = truck._exitPoint(undefined, undefined, false, u, role === 'driver' ? 0 : 2);
  // legs: [target, then (an action at the target: s it takes), the fixed line of the next leg when the game cannot path it yet]
  const legs = !boom.open ? [[BOOM_SPOT, BOOM_ACT, [...BOOM_IN, [door.x, door.z]]], [[door.x, door.z]]]
    : role === 'driver' ? [[[door.x, door.z]]] : [[STAGE, 0, [STAGE_REAR, [door.x, door.z]]], [[door.x, door.z]]];
  let goAt = null; // (the next leg's start, as planned with the previous one)
  for (const [k, [[tx, tz], act = 0, line = null]] of legs.entries()) {
    const last = k === legs.length - 1;
    const path = (u._planPath(tx, tz) || []).map((p) => [p.x, p.z]), T = pathLen([u.x, u.z], path) / CRAWL;
    const next = line, T2 = next ? pathLen([tx, tz], next) / CRAWL : 0;
    // (a leg that ends short of the door: the next leg's crawl from there must also be clear, after the action there
    // and a wait of at most 20 s that nobody sees either)
    let W = 0;
    const onward = (why) => {
      if (!next) return holdClear(D, tx, tz, Math.max(0, T - 3), 8, 'walk', why);
      // (an action there: he does it on his feet — up, the action, down again — and nobody may see him standing)
      if (act && !holdClear(D, tx, tz, Math.max(0, T - 2), act + 4, 'walk', why, 2)) return false;
      for (W = 0; W <= (act ? 0 : 20); W += 2) {
        if (!holdClear(D, tx, tz, Math.max(0, T - 2), act + W + 4, 'crawl', why, 2)) return false;
        const end = next[next.length - 1];
        if (routeClear(D, next, { mode: 'crawl', from: [tx, tz], speed: CRAWL, delay: T + act + W, slack: 2, pad: 2, why })
          && holdClear(D, ...end, T + act + W + T2 - 3, 8, 'walk', why)) return true;
      }
      return false;
    };
    const ready = (why) => routeClear(D, path, { mode: 'crawl', from: [u.x, u.z], speed: CRAWL, slack: 2.5, pad: 2, why }) && onward(why);
    if (goAt == null) await waitFor(D, ready, 900, `${role} to ${last ? 'the truck' : `(${tx},${tz})`}`);
    else await D.until(() => D.t >= goAt, 30, `${role} waits his moment`);
    const t0 = D.t;
    goAt = next ? t0 + T + act + W : null;
    D.order(role, { type: 'move', x: tx, z: tz });
    await D.until(() => !u.path && !u.isMoving, T + 20, `${role} crawls in`);
    if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${role} leg ${k + 1}: ${(D.t - t0).toFixed(1)} s (planned ${T.toFixed(1)}) at (${u.x.toFixed(2)},${u.z.toFixed(2)})${next ? `, on at +${(goAt - t0).toFixed(1)}` : ''}`);
    if (tx === BOOM_SPOT[0] && tz === BOOM_SPOT[1]) {
      await D.stance(role, 'stand'); // on his feet to work the boom (no man raises it lying down)
      D.ability(role, 'use', boom);
      await D.until(() => boom.open, 5, 'boom raised');
      onBoom?.();
      await D.idle(role);
      await D.stance(role, 'crawl'); // and down again for the crawl under it
    }
  }
  // at the door: up and in
  await waitFor(D, (why) => holdClear(D, u.x, u.z, 0, 3, 'walk', why), 10, `${role} gets in`);
  if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${role} at (${u.x.toFixed(2)},${u.z.toFixed(2)}) ${u.stance}, door (${door.x.toFixed(2)},${door.z.toFixed(2)}): gets in`);
  await D.stance(role, 'stand'); // up on his feet, he climbs in
  D.ability(role, 'enterVehicle', truck);
  await D.until(() => u.vehicle === truck, 20, `${role} in the truck`).catch((e) => { throw new Error(`${e.message} (at ${u.x.toFixed(2)},${u.z.toFixed(2)} ${u.stance} ${u.currentAction?.id ?? ''})`); });
}


const ROW_T = Math.hypot(CROSS[0][0] - LAUNCH[0], CROSS[0][1] - LAUNCH[1]) / 2.5 + CROSS.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - CROSS[k][0], p[1] - CROSS[k][1]) / 2.5, 0);
const UNDER_LAUNCH = LAUNCH; // the shallows just off the launch, where the Marine waits under water for trip 2

/** wait (up to maxSec) until `fn(why)` holds, logging now and then why not */
async function waitFor(D, fn, maxSec, label) {
  const why = [];
  let k = 0;
  await D.until(() => { if (k++ % 6) return false; why.length = 0; return fn(why) || dbg(D, why, label); }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
}

/** nobody sees a man (mode) or the raft at (x, z) from `from` s to `from + len` s from now */
function holdClear(D, x, z, from, len, mode, why, pad = 0) {
  for (let t = from; t <= from + len + 1e-6; t += 0.8) if (!routeClear(D, [[x, z]], { mode, from: [x, z], delay: t, slack: 0.5, pad, why })) return false;
  return true;
}

/**
 * One raft trip: the Marine (on the bank, or under water at the launch) puts the raft in, two men lying by the launch
 * get up and climb in, he rows down the channel west of islet 2 and across to the far shallows, and they get out —
 * all in one gap: the patrol boat on its way upstream, past the crossing (it looks ahead, the way it goes), and nobody
 * on the far bank looking at the landing.
 */
async function trip(D, boardPoint, who, { dry }) {
  const dv = D.c('diver');
  const prep = (dry ? 0.6 : 1.5 + 2.5) + CONFIG.abilities.raftDeploy; // (up on his feet) or (gear off, out of the shallows onto the bank), then the raft (4.0 s)
  const boardT = 3.5 * who.length; // each man up, a few steps and in (they go together, the second one waits his turn)
  const startT = prep + boardT + 0.5, landT = startT + ROW_T + 1.5;
  await waitFor(D, (why) => holdClear(D, ...LAUNCH, 0, prep, 'walk', why) // the Marine standing in the shallows
    && holdClear(D, ...LAUNCH, prep, boardT + 1, 'boat', why) // the raft lying there, men climbing in
    && who.every((r) => holdClear(D, D.c(r).x, D.c(r).z, prep, boardT, 'walk', why))
    && routeClear(D, CROSS, { mode: 'boat', from: LAUNCH, speed: 2.5, delay: startT, slack: 1.5, why }) // the crossing
    && holdClear(D, ...LANDING, landT, 8, 'boat', why) // they get out, the Marine packs the raft
    && (dry || holdClear(D, ...LAND_UP, landT + 6, 4, 'walk', why)) // (trip 2: the Marine walks up the bank)
    && holdClear(D, ...LAND_UP, landT + 1, 4, 'walk', why)
    && who.every((r) => routeClear(D, [HIDE[r]], { mode: 'crawl', from: LAND_UP, speed: 0.6, delay: landT + 4, slack: 1, why })),
  600, `trip ${who.join('+')}`);
  // he inflates it standing on the bank and puts it in the water beside him (from the water: gear off in the
  // shallows and a step up onto the bank first, the ability's own way)
  if (dry) await D.stance('diver', 'stand');
  D.ability('diver', 'raft');
  await D.until(() => dv.vehicle?.vehicleType === 'raft', 15, 'raft deployed');
  if (DBG) D.log(`DBG ${D.t.toFixed(1)} raft in at (${D.raft().x.toFixed(2)},${D.raft().z.toFixed(2)})`);
  const raft = D.raft();
  for (const r of who) { D.order(r, { type: 'ability', id: 'enterVehicle', target: raft }); }
  await D.until(() => who.every((r) => D.c(r).vehicle === raft), 20, `${who.join('+')} aboard`);
  for (const p of CROSS) await D.row(...p);
  for (const r of who) {
    D.ability(r, 'leaveVehicle');
    await D.until(() => !D.c(r).vehicle, 3, `${r} out`);
  }
  // (out in the shallows: up onto the snow, down on their bellies and on to the wall)
  for (const [k, r] of who.entries()) D.order(r, { type: 'move', x: LAND_UP[0] + k * 1.2, z: LAND_UP[1] - k * 0.6 });
  await D.until(() => who.every((r) => !D.c(r).path && !D.c(r).isMoving), 8, 'up the bank');
  for (const r of who) { await D.stance(r, 'crawl'); D.order(r, { type: 'move', x: HIDE[r][0], z: HIDE[r][1] }); }
}

/** the Marine gets out in the shallows, packs the raft and (dive) slips under water with it */
async function packAndDive(D, { dive = true } = {}) {
  const dv = D.c('diver'), raft = D.raft();
  D.ability('diver', 'leaveVehicle');
  await D.until(() => !dv.vehicle, 3, 'Marine out');
  // (a swimmer gets out on the water side: back to the hull in the shallows, where he can stand and pack it)
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

export const STAGES = [
  ['A', 'The team skirts the settlement to the river bank', async (D) => {
    D.world.sneakVehicleEyes = true; // the patrol boat's gunner sees too (sneak.mjs)
    const roles = Object.keys(WAIT);
    await group(D, Object.fromEntries(roles.map((r, k) => [r, [BEHIND_WALL[0] + (k % 2), BEHIND_WALL[1] + k * 0.4 - 0.8]])), 'round the south-east corner');
    await group(D, Object.fromEntries(roles.map((r, k) => [r, [EAST_SIDE[0] + (k % 3) - 1, EAST_SIDE[1] + Math.floor(k / 3)]])), 'up the east side');
    await group(D, WAIT, 'waiting spots');
    for (const r of roles) await D.stance(r, 'crawl');
    D.checkpoint('A1 team east of the settlement');
  }],
  ['B', 'Sniper: e4 at the far end of his beat', async (D) => {
    const sn = D.c('sniper'), e4 = D.get('e4');
    await sneak(D, ...SNIPER_SPOT, { mode: 'crawl', role: 'sniper', box: 8, label: 'Sniper to the bank' });
    D.checkpoint('B1 Sniper on the bank');
    const why = [];
    // (he kneels to aim and fire: from the aim to the shot a kneeling Sniper counts as standing — seen in the far band
    // too, and over low cover (spec §3.4) — so nobody may see him upright there meanwhile)
    const upright = () => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
    await D.until(() => {
      why.length = 0;
      if (!(e4.brain?.atWait && Math.hypot(e4.x - E4_HALT[0], e4.z - E4_HALT[1]) < 1)) return false;
      if (ABILITIES.sniper.canUse(sn, e4, D.world) !== true) { why.push('los'); return dbg(D, why, 'e4 shot'); }
      return unwitnessed(D, e4, upright(), { ahead: 1.2, strict: true, why }) && clearFor(D, [[sn.x, sn.z]], 1.5, { mode: 'crawl', why })
        && bodySeen(D, e4.x, e4.z, 150, { except: [e4] }).length === 0 || dbg(D, why, 'e4 shot');
    }, 400, 'e4 at his east halt, nobody looking').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('sniper', 'sniper', e4);
    await D.until(() => !e4.alive, 3, 'e4 shot');
    await D.idle('sniper');
    await D.stance('sniper', 'crawl');
    D.checkpoint('B2 e4 shot');
  }],
  ['C', 'Marine: the first trip across, the Green Beret and the Sniper', async (D, { boardPoint }) => {
    // the passengers of both trips lie down by the launch; the Marine (raft in his pack) beside it, at the water's edge
    // (on their bellies: nobody ever sees a man lying on this bank)
    // (one by one, on a planned crawl, down the bank south-east of the settlement: too far from its east gap for anyone
    // inside to make out a man lying there, or his tracks)
    for (const r of ['sapper', 'diver', 'greenberet', 'driver', 'sniper']) await sneak(D, ...BANK[r], { mode: 'crawl', role: r, box: 8, label: `${r} to the bank` });
    D.checkpoint('C1 team on the bank');
    await trip(D, boardPoint, ['greenberet', 'sniper'], { dry: true });
    D.checkpoint('C2 Green Beret and Sniper across');
    await packAndDive(D);
    D.checkpoint('C3 raft packed, Marine under water');
    // back under water to the shallows below the launch (nobody sees a diver)
    for (const p of [...BACK.slice(0, -1), UNDER_LAUNCH]) await D.go('diver', ...p, { tol: 0.6, max: 60 });
    D.checkpoint('C4 Marine back at the launch, under water');
  }],
  ['D', 'Marine: the second trip, the Sapper and the Driver', async (D, { boardPoint }) => {
    await trip(D, boardPoint, ['sapper', 'driver'], { dry: false });
    D.checkpoint('D1 Sapper and Driver across');
    await packAndDive(D, { dive: false });
    D.checkpoint('D2 raft packed');
    await D.go('diver', ...LAND_UP, { tol: 0.5 });
    await sneak(D, ...HIDE.diver, { mode: 'crawl', role: 'diver', box: 8, label: 'Marine to the wall' });
    D.checkpoint('D3 the whole team outside the camp wall');
  }],
  ['E', 'Under the boom and into the truck, one by one', async (D, { boardPoint }) => {
    const truck = truckOf(D);
    // each man crawls along the wall to the gate and in under the boom (raised by the Driver), to his door of the truck,
    // and climbs in when nobody looks that way: the truck's canvas hides whoever sits in it
    await boardTruck(D, 'driver', truck, { onBoom: () => D.checkpoint('E1 Driver raises the boom') });
    D.checkpoint('E2 Driver in the cab');
    await boardTruck(D, 'sniper', truck);
    D.checkpoint('E3 Sniper in the back');
    await boardTruck(D, 'greenberet', truck);
    D.checkpoint('E4 Green Beret in the back');
    await boardTruck(D, 'diver', truck);
    D.checkpoint('E5 Marine in the back');
  }],
  ['F', 'Sapper: a time bomb between the fuel tanks, and away', async (D, { boardPoint }) => {
    const truck = truckOf(D), sp = D.c('sapper');
    await boardTruck(D, 'sapper', truck);
    D.checkpoint('F1 Sapper in the truck');
    // he waits in the truck for a quiet moment, gets out at the tailgate, walks between the tanks, sets the bomb (10 s
    // fuse), walks back and climbs in; the Driver drives off at once, hard, snapping the boom: the blast is heard all
    // over the camp (the alarm), but by then the truck is on the road out
    const ex = truck._exitPoint(undefined, undefined, false, sp, truck.seats?.get(sp));
    const out = 0.8, toGap = Math.hypot(GAP[0] - ex.x, GAP[1] - ex.z) / WALK, plantT = 1.8;
    await waitFor(D, (why) => holdClear(D, ex.x, ex.z, 0, out + 0.5, 'walk', why, 1)
      && routeClear(D, [GAP], { mode: 'walk', from: [ex.x, ex.z], speed: WALK, delay: out, slack: 1, pad: 1, why })
      && holdClear(D, ...GAP, out + toGap, plantT + 0.5, 'walk', why, 1)
      && routeClear(D, [[ex.x, ex.z]], { mode: 'walk', from: GAP, speed: WALK, delay: out + toGap + plantT, slack: 1, pad: 1, why })
      && holdClear(D, ex.x, ex.z, out + 2 * toGap + plantT, 2.5, 'walk', why, 1), 900, 'the bomb run');
    D.ability('sapper', 'leaveVehicle');
    await D.until(() => !sp.vehicle, 3, 'Sapper out');
    await D.stance('sapper', 'stand');
    await D.go('sapper', ...GAP, { tol: 0.5 });
    D.ability('sapper', 'timeBomb');
    await D.until(() => !sp.currentAction && !sp.pendingAbility, 5, 'bomb set');
    D.checkpoint('F2 time bomb set between the tanks');
    await D.go('sapper', ex.x, ex.z, { tol: 0.4 });
    D.ability('sapper', 'enterVehicle', truck);
    await D.until(() => sp.vehicle === truck, 8, 'Sapper back in the truck');
    D.checkpoint('F3 Sapper back in the truck');
    // (the bomb's countdown on screen: the truck, flat out through the boom, takes some 4.5 s to the road's end; it
    // must not get there before the blast, or the team "escapes with the targets standing")
    const bomb = D.world.interactables.find((b) => b.interactKind === 'bomb' && b.bombKind === 'time' && !b.exploded);
    if (bomb) await D.until(() => bomb.exploded || bomb.fuse <= DRIVE_T - 1, 12, 'the bomb ticks down');
    D.order('driver', { type: 'move', x: EXIT[0], z: EXIT[1], run: true });
    await D.until(() => D.world.objectives.every((o) => o.done), 30, 'depot destroyed, truck out');
    D.checkpoint('F4 depot destroyed, truck out of the gate');
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
