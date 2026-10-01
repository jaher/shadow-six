/**
 * BEL Mission 9 "A Courtesy Call": runtime glue (docs/missions/m09.md §8.6, §9, §10, §13 D1/D1b). Owned by MISSIONS.
 * Installed as `mission.script(world, director)`; runs on the 20 Hz BEL tick:
 *  - DORMANT TANKS (D1 fallback): the three Panzer IVs sit crewed in the shed with NO vision cone and no fire
 *    until the camp's alarm has fired once (`world.alarm.zonesFired` — saved with the game, so a quick load
 *    puts them back to sleep or keeps them awake). Their profile cone is stashed and restored on waking.
 *  - DRIVE-OUT (D1b fallback): on waking each tank gets a one-way `STOPPED` route out of its bay as its
 *    brain route (state 'route'). The brain still stops to fire at any commando it sees and resumes the
 *    leg afterwards (vehicle-ai resumeLeg); at the last point it stands and keeps its live cone ('standby'-like).
 *  - BLOCKED BAY: a tank still at its bay (within 4 m) with the fuel tanker within 10 m of that bay (in practice:
 *    the tanker parked across the shed front) fires at it; one round explodes a tanker (§3.6). The mission trigger T2 then
 *    wrecks every Panzer within 9 m of the fireball.
 * @module missions/scripts/m09
 */

import { normalizeVehicleRoute } from '../../ai/vehicle-ai.js';

/** Tank ids and their drive-out routes (dossier §8.6), m. */
export const TANK_ROUTES = {
  pz1: [[24, 35], [42, 50], [42, 64], [40, 75], [31, 84], [22, 92]], // → the pick-up point [DE]
  pz2: [[30, 30], [52, 62]],
  pz3: [[34, 24], [60, 40], [70, 40]], // covers the E gate
};
/** Tank drive speed after the alarm (m/s; between the tank's slow 2 and fast 5). */
export const TANK_SPEED = 3;
/** A tank this close to its bay still counts as "in the shed" for the blocked-bay rule. */
export const BAY_R = 4;
/**
 * Blocked-bay rule range, measured from the BAY (not the moving tank): a tanker within this of the bay of a tank
 * still in it gets shot (§10 T1). The shed-front spot is 8.4–8.7 m from the outer bays; the tanker's own parking
 * place by the bunker is 12.7 m from pz1's bay, so a tank rolling out past it leaves it alone.
 */
export const TANKER_R = 10;

/** Has the camp's alarm gone off (any zone, any cause)? */
export const alarmRaised = (world) => !!world.alarm?.zonesFired?.length;

/** Put a tank to sleep: no cone, no sweep (the brain's `armed` test needs a vision profile). */
export function sleepTank(v) {
  if (v.vision) { v._m09Vision = v.vision; v.vision = null; }
  v.sweepActive = false;
}

/** Wake a tank: restore its cone and send it out of its bay along its route (from the nearest point on). */
export function wakeTank(v, pts = TANK_ROUTES[v.tag]) {
  if (v._m09Awake || v.destroyed) return;
  v._m09Awake = true;
  if (!v.vision && v._m09Vision) v.vision = v._m09Vision;
  v.sweepActive = !!v.vision;
  const b = v.brain;
  if (!b || !pts) return;
  b.route = normalizeVehicleRoute({ type: 'STOPPED', speed: TANK_SPEED, points: pts.map(([x, z]) => ({ x, z })) }, v);
  b.dir = 1;
  if (b.state === 'attack') { b.resume = 'route'; return; }
  b.state = 'route';
  b.startLeg(true);
}

/**
 * @param {{tanks?: string[], tanker?: string}} [spec]
 * @returns {(world: object, dir: object) => void} mission.script
 */
export function m09Script(spec = {}) {
  const tanks = spec.tanks || Object.keys(TANK_ROUTES);
  const tankerId = spec.tanker || 'tanker';
  return function m09(world) {
    const S = { bays: {}, awake: false };
    world.m09 = S; // test / debug handle
    const tick = () => {
      const up = alarmRaised(world);
      S.awake = up;
      const tanker = world.byId(tankerId);
      for (const id of tanks) {
        const v = world.byId(id);
        if (!v || v.destroyed) continue;
        S.bays[id] ||= { x: v.spawn?.x ?? v.x, z: v.spawn?.z ?? v.z };
        if (!up) { sleepTank(v); continue; }
        wakeTank(v);
        const bay = S.bays[id];
        if (tanker && !tanker.destroyed && Math.hypot(v.x - bay.x, v.z - bay.z) <= BAY_R
          && Math.hypot(tanker.x - bay.x, tanker.z - bay.z) <= TANKER_R) v.fireAt(tanker);
      }
    };
    tick();
    world.onBelTick(tick);
  };
}

/** T2: the tanker's fireball wrecks every Panzer IV within `r` m (heavy armour ignores barrel/vehicle blasts, §3.7). */
export function wreckArmourNear(world, at, source = null, r = 9) {
  const hit = [];
  for (const v of world.vehicles || []) {
    if (v.destroyed || v.def?.type !== 'panzer4') continue;
    if (Math.hypot(v.x - at.x, v.z - at.z) <= r) { v.destroy(source, 'bomb'); hit.push(v); }
  }
  return hit;
}
