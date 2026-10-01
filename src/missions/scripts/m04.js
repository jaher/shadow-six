/**
 * BEL Mission 4 "Restore Pride": runtime glue (docs/missions/m04.md §6.1, §8.3, §12). Owned by MISSIONS.
 * Installed as `mission.script(world, director)`; everything runs on the 20 Hz BEL tick:
 *  - the level-crossing booms close while the train is within 40 m of the crossing and reopen 2 s after it has
 *    gone (the lorry waits at them; the retail CONTRBARRTREN controls);
 *  - the lorry driver's errands: at stops A / C (crossing shack) and B (villa) he gets out, walks to the door,
 *    stays 5 s, walks back and gets in; the lorry waits for him. Killed on foot, the lorry stops for good and the
 *    Driver can take it (Prima's line). The driver rides inside the cab otherwise (hidden, not a target);
 *  - the courier takes the motorcycle with him on his alarm run and leaves it by the jail hut (retail CONT:MOTO),
 *    then goes inside (joins the jail-hut garrison);
 *  - men on foot wait at the rails while the train comes (`railGuard`);
 *  - `world.driveRules`: land vehicles may not use the rail bridge (Kildread: the tank cannot be brought across).
 * @module missions/scripts/m04
 */

/** Truck stops where the driver runs an errand: the stop, his walk to the door, the walk back to the cab. */
export const TRUCK_STOPS = {
  A: { x: 174.5, z: 87.0, walk: [[171.4, 87.9], [170.4, 86.6], [171.0, 79.9]], back: [[170.2, 86.5], [172.1, 88.9]], stay: 5 },
  B: { x: 87.8, z: 31.3, walk: [[84.5, 34.2], [81.7, 36.0], [79.8, 34.2]], back: [[81.2, 35.3], [83.1, 36.4], [85.0, 34.9], [87.2, 34.0]], stay: 5 },
  C: { x: 173.9, z: 86.5, walk: [[175.8, 82.5], [173.6, 79.2]], back: [[175.8, 82.4], [175.8, 84.6]], stay: 5 },
};
/** Level crossing (road × main line) and its two booms. */
export const CROSSING = { x: 165, z: 77.5, booms: ['boom_x1', 'boom_x2'], closeR: 40, openR: 42, openDelay: 2, clearR: 8 };
/** Rail-bridge deck (x + z = 242.6) as a polygon, inflated 1 m: no land vehicle may be driven across it. */
export const BRIDGE_NO_DRIVE = [[96.1, 142.3], [119.6, 118.8], [124.9, 124.1], [101.4, 147.6]];
/** Courier route indices during which he rides the bike (from the bike to the dismount point). */
const RIDE_FROM = 1, RIDE_TO = 5;

const WALK = 1.8; // retail VELOCIDADTRAMO 2

function segHitsPoly(ax, az, bx, bz, poly) {
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
  for (let k = 0; k <= n; k++) if (inside(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return true;
  return false;
}

/** No land vehicle over the rail bridge (a player straight-line drive that would touch the deck is refused). */
export function bridgeRule(v, x, z) {
  if (!v || v.vehicleKind !== 'land') return true;
  return !segHitsPoly(v.x, v.z, x, z, BRIDGE_NO_DRIVE);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pt = ([x, z]) => ({ x, z, wait: 0, speed: WALK });

/**
 * @param {object} world
 * @param {object} dir set-piece director
 */
export function m04Script(world, dir) { // eslint-disable-line no-unused-vars
  world.driveRules ||= [];
  if (!world.driveRules.includes(bridgeRule)) world.driveRules.push(bridgeRule);
  const S = { boomsDown: false, clearT: 0, errand: null, lastStop: null, doneIdx: null, fresh: world.time < 0.5, parked: false };
  world.m04 = S; // test / debug handle
  // dossier §10: the team starts prone in the start grove (spawn `stance: 'crawl'`; the engine spawns everyone standing)
  if (S.fresh) {
    for (const c of world.commandos) {
      const sp = world.mission?.commandos?.find((m) => m.role === c.role);
      if (sp?.stance === 'crawl' && c.stance === 'stand') { c.stance = 'crawl'; world.events.emit('unit:stance', { unit: c, stance: 'crawl' }); }
    }
  }
  world.onBelTick((dt) => {
    booms(world, S, dt);
    truckDriver(world, S, dt);
    courierBike(world, S);
    courierIn(world, S);
    railGuard(world, S);
  });
}

/**
 * Men on foot wait at the rails while the train is coming (like the lorry at the booms): an enemy who would step
 * into the train's path — the kill band plus `RAIL_GUARD.pad`, from just behind the train to `RAIL_GUARD.ahead` m
 * in front of it — is held where he stood until it has passed. Without this the train ran over e36 on his
 * route after ~2 min and every body it left set off a chain of shouts and zone alarms in an idle game.
 */
export const RAIL_GUARD = { pad: 0.8, behind: 4, ahead: 45 };
function railGuard(world, S) {
  const train = world.byId('train');
  if (!train || train.hiddenRail || train.removed || !train._inBoxOf) { S.railPrev = null; return; }
  const [from, to, half] = train.killBox;
  const danger = (x, z) => train._inBoxOf(x, z, from - RAIL_GUARD.behind, to + RAIL_GUARD.ahead, half + RAIL_GUARD.pad);
  const prev = (S.railPrev ||= new Map());
  for (const e of world.enemies) {
    if (!e.alive || e.state === 'inVehicle' || e.vehicle) { prev.delete(e); continue; }
    const p = prev.get(e);
    if (p && danger(e.x, e.z) && !danger(p.x, p.z)) {
      e.setPosition?.(p.x, p.z, e.heading); // hold at the edge of the track
      continue;
    }
    prev.set(e, { x: e.x, z: e.z });
  }
}

function booms(world, S, dt) {
  const train = world.byId('train');
  if (!train) return;
  const on = !train.hiddenRail && !train.removed;
  const near = (r) => on && dist(train, CROSSING) < r + (train.def?.size?.[0] ?? 30) / 2;
  const setAll = (open) => CROSSING.booms.forEach((id) => world.byId(id)?.setOpen?.(open));
  // never lower the booms onto a vehicle standing on the crossing (it would be trapped between them, and the train
  // waits for it anyway): they come down once the crossing is clear
  const busy = () => world.vehicles.some((v) => v !== train && !v.def?.rail && !v.destroyed && !v.removed && dist(v, CROSSING) < CROSSING.clearR);
  if (!S.boomsDown && near(CROSSING.closeR) && !busy()) {
    S.boomsDown = true; S.clearT = 0; setAll(false);
  } else if (S.boomsDown) {
    S.clearT = near(CROSSING.openR) ? 0 : S.clearT + dt;
    if (S.clearT >= CROSSING.openDelay) { S.boomsDown = false; setAll(true); }
  } else if (!near(CROSSING.openR) && CROSSING.booms.some((id) => world.byId(id)?.open === false)) {
    // a quick load while the train passed restores the booms down but not this script's state: lift them, or
    // the lorry waits at the crossing for the rest of the game
    setAll(true);
  }
}

/** Put the driver in the cab and make him a passive rider (no route, no post to walk back to). */
function board(truck, e) {
  if (e.state !== 'inVehicle') truck.enter(e);
  e.stop?.();
  e.route = null;
  e.post = null;
  const b = e.brain;
  if (b) { b._routeType = 'STOPPED'; b._home = null; b.idleState = 'IDLE'; b._set?.('IDLE'); }
}

function truckDriver(world, S, dt) {
  const truck = world.byId('truck'), e = world.byId('e49');
  if (!truck || !e) return;
  if (S.fresh) { S.fresh = false; if (e.alive && !truck.destroyed) board(truck, e); }
  if (truck.destroyed) return;
  if (!e.alive) {
    // dead on foot: the lorry stays where it stopped (no ghost driver); the Driver may take it
    if (!S.parked) { S.parked = true; truck.waitT = 0; truck.stop?.(); if (truck.brain) truck.brain.state = 'parked'; }
    return;
  }
  if (truck.driver) return; // a commando took it (cannot happen while e49 lives, kept for safety)
  const inCab = e.state === 'inVehicle' && e.vehicle === truck;
  if (inCab && S.errand) S.errand = null; // an errand left over from before a quick load: he is back in the cab
  // in the cab he is a passive rider: a brain restored by a quick load wants to walk back to his spawn post and
  // flips RETURN ↔ IDLE every second — make him a rider again
  if (inCab && !S.errand && (e.post || e.route || e.brain?._home || (e.brain && e.brain.state !== 'IDLE'))) board(truck, e);
  // the stop is the route waypoint the lorry has just reached (A and C lie 0.8 m apart: never match by distance)
  const prev = truck.path?.[truck.pathIndex - 1];
  const key = prev && Object.keys(TRUCK_STOPS).find((k) => Math.abs(TRUCK_STOPS[k].x - prev.x) < 0.01 && Math.abs(TRUCK_STOPS[k].z - prev.z) < 0.01);
  if (S.doneIdx != null && truck.pathIndex !== S.doneIdx) S.doneIdx = null;
  if (inCab && !S.errand && key && S.doneIdx == null && truck.waitT > 0 && dist(truck, TRUCK_STOPS[key]) < 2.5) {
    const st = TRUCK_STOPS[key];
    S.doneIdx = truck.pathIndex;
    S.lastStop = key;
    S.errand = { key, phase: 'walk', t: 0 };
    // Vehicle.exit halts a driverless vehicle (clears its route): keep the lorry's place on its route
    const keep = { path: truck.path, pathIndex: truck.pathIndex, goal: truck.goal, waitT: truck.waitT };
    truck.exit(e, st.walk[0][0], st.walk[0][1], { force: true });
    Object.assign(truck, keep);
    e.brain?.reinforce?.(st.walk.map(pt), [pt(st.walk.at(-1))], { loopVel: WALK });
  }
  if (!inCab && !S.errand) { // after a quick load mid-errand: head back to the cab from wherever he is
    const near = key || Object.keys(TRUCK_STOPS).sort((a, b) => dist(truck, TRUCK_STOPS[a]) - dist(truck, TRUCK_STOPS[b]))[0];
    S.errand = { key: near, phase: 'back', t: 0 };
    S.lastStop = near;
    S.doneIdx = truck.pathIndex;
    const st = TRUCK_STOPS[near];
    e.brain?.reinforce?.(st.back.map(pt), [pt(st.back.at(-1))], { loopVel: WALK });
  }
  const R = S.errand;
  if (!R) return;
  truck.waitT = Math.max(truck.waitT, 0.25); // the lorry waits for its driver
  const st = TRUCK_STOPS[R.key];
  if (R.phase === 'walk') {
    if (dist(e, { x: st.walk.at(-1)[0], z: st.walk.at(-1)[1] }) > 0.9) return;
    R.t += dt;
    if (R.t < st.stay) return;
    R.phase = 'back';
    e.brain?.reinforce?.(st.back.map(pt), [pt(st.back.at(-1))], { loopVel: WALK });
  } else if (R.phase === 'back') {
    const end = { x: st.back.at(-1)[0], z: st.back.at(-1)[1] };
    if (dist(e, end) > 1.0 && dist(e, truck) > 3.2) return;
    board(truck, e);
    S.errand = null;
    truck.waitT = 0.5;
  }
}

/**
 * The courier, his REXT raised at the jail-hut door, goes inside and joins its garrison (pool +1): he no longer
 * stands frozen at the door in ALARM_RUN for the rest of the game. Not a kill: no body, no score.
 */
function courierIn(world, S) {
  if (S.courierIn) return;
  const e = world.byId('e26');
  if (!e || e.removed || !e.alive || e.brain?.state !== 'ALARM_RUN' || !e.brain.goal?.fired) return;
  S.courierIn = true;
  const b = world.alarm?.barracks?.[e.spawn?.jail ?? 'jail_hut'];
  if (b && !b.destroyed) b.pool += 1;
  e.stop?.();
  world.removeLater(e);
}

/** The courier rides the bike from the bridge head to the jail hut instead of leaving it for the player. */
function courierBike(world, S) {
  if (S.bikeDone) return;
  const e = world.byId('e26'), moto = world.byId(e?.spawn?.bike ?? 'moto');
  if (!e || !moto || moto.destroyed || moto.driver || moto.occupants?.length) return;
  const b = e.brain;
  if (!e.alive || b?.state !== 'ALARM_RUN' || !b.goal?.route) { if (!e.alive && S.bikeRiding) S.bikeDone = true; return; }
  const idx = b.goal.idx ?? 0;
  if (idx >= RIDE_FROM && idx <= RIDE_TO) {
    S.bikeRiding = true;
    moto.x = e.x; moto.z = e.z; moto.heading = e.heading;
    moto.snap?.();
  } else if (idx > RIDE_TO) S.bikeDone = true; // parked where he got off, by the jail hut
}
