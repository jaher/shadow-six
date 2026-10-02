/**
 * Getting in, driving and leaving vehicles — owned by VEHICLES (design-spec §3.2 capacities / boarding,
 * §3.7 operators and straight-line driving, §5.2 mouse, §6.4 knapsack photos).
 *
 * - `enterVehicle` (targeting 'vehicle'): walk to the hull (boats: the nearest bank / shallow cell; the
 *   Marine may swim), then board after CONFIG.vehicles.boardTime (0.5 s; manned-gun posts 0.8 s). Anyone
 *   may ride as a passenger; the first commando whose role may operate the craft becomes the operator
 *   (land: Driver, water: Marine, plane: McRae, guns: Driver). Enemies who see the boarding taint it.
 * - Driving: while a commando sits inside, his `move` orders go to `routeVehicleOrder` (commando.issue
 *   hook): click = slow, double-click = fast, straight line only (vehicle.driveTo).
 * - `leaveVehicle` (targeting 'self'): the HUD calls it when the operator's photo in the knapsack is
 *   clicked (§3.7 "Exiting"); the unit steps out onto a walkable cell within 3 m.
 * @module abilities/drive
 */

import { registerAbility, ABILITIES } from './registry.js';
import { CONFIG } from '../config.js';
import { freeToAct } from './common.js';

/** Everyone can ride; McRae is the BEL guest pilot (§3.5). */
export const RIDER_ROLES = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'mcrae', 'pilot', 'guest'];

/** Point from which `unit` boards `vehicle` (a walkable cell by the hull; swimmers may use water). */
export function boardPoint(vehicle, unit) {
  if (!vehicle.world) return { x: vehicle.x, z: vehicle.z };
  const swim = !!unit.canSwim;
  const edge = vehicle.muzzleToward(unit.x, unit.z); // hull side facing the unit
  return vehicle._exitPoint(edge.x, edge.z, swim) || vehicle._exitPoint(edge.x, edge.z, false);
}

/**
 * What a click on `vehicle` would do for the selected men (cursor + tooltip, §5.3): `ok` when at least one of them may
 * get in, else the first refusal ("the Marine must board first", "full", …) so the player sees why not.
 * @param {object} vehicle @param {object[]} selection selected commandos @param {object} [world]
 * @returns {{ok: boolean, reason: string|null}|null} null when nobody selected could even try (none on foot)
 */
export function boardingHint(vehicle, selection, world = null) {
  if (!vehicle || vehicle.kind !== 'vehicle' || vehicle.destroyed) return null;
  const walkers = (selection || []).filter((c) => c?.alive !== false && !c.vehicle && c.abilities?.includes?.('enterVehicle'));
  if (!walkers.length) return null;
  // the cursor asks every frame: reuse the answer for the same men for 0.2 s (canUse may scan the bank cells)
  const key = walkers.map((c) => c.id).join(','), now = globalThis.performance?.now?.() ?? 0, memo = vehicle._boardHint;
  if (memo && memo.key === key && now - memo.at < 200 && memo.n === vehicle.occupants?.length) return memo.res;
  const def = ABILITIES.enterVehicle;
  let res = null;
  for (const c of walkers) {
    const ok = def.canUse(c, vehicle, world || vehicle.world);
    if (ok === true) { res = { ok: true, reason: null }; break; }
    res ??= { ok: false, reason: String(ok).replace(/^Can't get in: /, '').replace(/\.$/, '') };
  }
  vehicle._boardHint = { key, at: now, n: vehicle.occupants?.length, res };
  return res;
}

/** Close enough to the hull to climb in? */
function atHull(vehicle, unit) {
  return vehicle._inHull(unit.x, unit.z, CONFIG.vehicles.exitRadius * 0.5 + 0.3);
}

/**
 * Route an order from a commando sitting in a vehicle (commando.issue hook). Returns true when the
 * vehicle consumed the order (move → drive, stop → halt); false for orders the commando handles.
 */
export function routeVehicleOrder(unit, order) {
  const v = unit?.vehicle;
  if (!v || !order) return false;
  if (order.type === 'move' || order.type === 'stop') { v.handleOrder(unit, order); return true; }
  return false;
}

/** Leave the vehicle now (§3.7). @returns {boolean} */
export function leaveVehicle(unit, x, z) {
  const v = unit?.vehicle;
  if (!v) return false;
  const ok = v.exit(unit, x, z);
  if (!ok) unit.world?.events.emit('message', { text: `${unit.nickname || unit.role}: can't get out here.`, kind: 'warn', unit });
  return ok;
}

/** The live man `c` transports (a downed buddy or a guest who can't walk), else null (§C.8). */
function liveLoad(c) {
  const u = c.carrying;
  return u && u.kind === 'commando' && u.alive && (u.downed || u.cannotWalk) ? u : null;
}

/** §C.8: hand the load over to the vehicle (he becomes an occupant; the transporter stays outside). */
function loadIntoVehicle(c, load, vehicle, world) {
  if (c.carrying !== load || !load.alive) return false;
  const mode = c.carryMode;
  c.carrying = null; c.carryMode = null; c.carryTransition = null;
  load.carriedBy = null;
  load.state = 'active';
  if (vehicle.canEnter(load) !== true) { load.state = 'carried'; load.carriedBy = c; c.carrying = load; c.carryMode = mode; return false; }
  vehicle.enter(load);
  if (vehicle.driver === load && load.downed) vehicle.driver = null; // a downed man never operates it
  c.refreshAbilities?.();
  world.events.emit('load:dropped', { carrier: c, load, how: 'vehicle', mode });
  return true;
}

registerAbility({
  id: 'enterVehicle',
  label: 'Get in',
  icon: '🚚',
  hotkey: null,
  roles: RIDER_ROLES,
  targeting: 'vehicle',
  range: Infinity, // the task walks to the hull itself (boats are boarded from the bank)
  cursor: 'enter',
  order: 80,
  campaigns: null, noiseRadius: 0, visibleToEnemies: true, group: 'vehicle', // boarding seen → tainted (§4.3)

  canUse(commando, target, world) {
    if (!target || target.kind !== 'vehicle') return 'Select a vehicle.';
    if (commando.vehicle) return 'Already inside a vehicle.';
    const f = freeToAct(commando);
    if (f !== true) return f;
    const load = liveLoad(commando);
    if (commando.carrying && !load) return 'Drop it first.';
    if (target.destroyed) return 'Pick a vehicle.';
    if (load) { // bodies-design §C.8: load a downed buddy / a guest who can't walk (the transporter stays out)
      if (target.vehicleKind === 'emplacement') return 'Drop it first.';
      const ok = target.canEnter(load);
      return ok === true ? true : `Can't load him: ${ok}.`;
    }
    // §3.7 boats: only the Marine boards from the water; the others by the bank or in shallow water
    if (target.vehicleKind === 'boat' && !commando.canSwim && world?.groundAt) {
      const g = world.groundAt(target.x, target.z);
      if (g?.water && !g.shallow && !boardPoint(target, commando)) return 'Only in shallow water.';
    }
    const ok = target.canEnter(commando);
    return ok === true ? true : `Can't get in: ${ok}.`;
  },

  start(commando, vehicle, world) {
    const V = CONFIG.vehicles;
    const load = liveLoad(commando);
    const board = load ? CONFIG.bodies.vehicleLoad : vehicle.vehicleKind === 'emplacement' ? V.gunMountTime : V.boardTime;
    let t = 0, repath = 0, boarding = false, walked = 0, lastP = null;
    // BEL: a crawler told to board a boat gets up first — nobody crawls through the surf into a boat (M14 review:
    // the prone Driver stalled at the water's edge); land vehicles keep the crawl approach
    if (vehicle.vehicleKind === 'boat' && commando.stance === 'crawl') commando.setStance('stand');
    const cant = () => { world.events.emit('message', { text: `${commando.nickname || commando.role}: can't reach it.`, kind: 'warn', unit: commando }); return 'failed'; };
    return {
      interruptible: true,
      update(dt) {
        if (vehicle.destroyed || !commando.alive) return 'failed';
        if (!boarding) {
          // walking to the hull: the unit only follows paths while 'active' (the Commando set 'busy')
          if (commando.state === 'busy') commando.state = 'active';
          if (atHull(vehicle, commando)) {
            commando.stop();
            commando.state = 'busy';
            boarding = true;
            commando.playAction?.('use', board);
            return 'running';
          }
          walked += dt;
          if (walked > CONFIG.abilities.approachTimeout) return cant(); // never end silently
          repath -= dt;
          // re-path only when the boarding point moved, and never mid climb/ladder link (a fresh path from
          // the middle of the inner steps restarts the traversal: replay m02, stuck on walk_sw for 30 s)
          const onLink = !!commando.path?.[commando.pathIndex]?.link;
          if (!commando.path || (repath <= 0 && !onLink)) {
            repath = CONFIG.abilities.approachRepath;
            const p = boardPoint(vehicle, commando);
            if (p && commando.path && lastP && Math.hypot(p.x - lastP.x, p.z - lastP.z) <= CONFIG.abilities.approachRepathMove) return 'running';
            lastP = p ? { x: p.x, z: p.z } : null;
            if (!p || !commando.moveTo(p.x, p.z, {})) return cant();
          }
          return 'running';
        }
        t += dt;
        if (t < board) return 'running';
        if (load) return loadIntoVehicle(commando, load, vehicle, world) ? 'done' : 'failed';
        const ok = vehicle.canEnter(commando);
        if (ok !== true) {
          world.events.emit('message', { text: `${commando.nickname || commando.role}: ${ok}.`, kind: 'warn', unit: commando });
          return 'failed';
        }
        return vehicle.enter(commando) ? 'done' : 'failed';
      },
      cancel() { commando.stop(); },
    };
  },
});

registerAbility({
  id: 'leaveVehicle',
  label: 'Get out',
  icon: '⏏',
  hotkey: null,
  roles: RIDER_ROLES,
  targeting: 'self',
  range: Infinity,
  cursor: 'target',
  order: 81,
  campaigns: null, noiseRadius: 0, visibleToEnemies: false, group: 'vehicle',

  canUse(commando) {
    if (!commando.vehicle) return 'Not in a vehicle.';
    return true;
  },

  start(commando) {
    leaveVehicle(commando);
    return null;
  },
});
