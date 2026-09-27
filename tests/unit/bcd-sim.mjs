/**
 * Headless BCD sim for the expansion unit tests (docs/bcd-plan.md §3 NOW): a BCD-ruled World (grid only, real
 * brains, Alarm + world.ai), commandos spawned with campaign 'BCD' (BCD kit merged), Game.step order.
 */
import * as THREE from 'three';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { Alarm } from '../../src/ai/alarm.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { CONFIG } from '../../src/config.js';

export const DT = CONFIG.sim.dt;

/** @param {object} def partial mission (campaign defaults to 'BCD') */
export function bcdSim(def = {}) {
  const mission = normalizeMission({ id: 'bcdtest', size: [80, 80], baseTerrain: 'grass', campaign: 'BCD', ...def }, { quiet: true });
  const world = new World({ size: mission.size, scene: new THREE.Scene(), mission, seed: 11 });
  buildMap(world, mission, { meshes: false });
  world.vehicleFactory = (s) => new Vehicle(s);
  world.alarm = new Alarm(world);
  const log = [];
  const origEmit = world.events.emit.bind(world.events);
  world.events.emit = (name, p) => { log.push({ name, p, t: world.time }); return origEmit(name, p); };
  for (const c of mission.commandos) world.add(new Commando({ ...c, campaign: mission.campaign, inventory: c.inventory ? { ...c.inventory } : undefined }));
  for (const e of mission.enemies) world.add(new Enemy(e));
  for (const v of mission.vehicles) world.spawnVehicle(v.vehicleType || 'truck', v);
  world.rebuildSpatial();
  const sim = {
    world, mission, log,
    get: (id) => world.byId(id) || world.enemies.find((e) => e.tag === id) || world.commandos.find((c) => c.tag === id),
    cmd: (role) => world.commandos.find((c) => c.role === role || c.tag === role),
    step(dt = DT) {
      const run = (list) => { for (const e of [...list]) if (!e.removed) e.update(dt); };
      world.rebuildSpatial();
      world.refreshDynamicOccluders();
      run(world.commandos);
      run(world.enemies);
      world.runBelTicks(dt);
      run(world.vehicles);
      run(world.projectiles);
      run(world.interactables);
      world.alarm.update(dt);
      world.flushRemovals();
      world.time += dt;
      world.tick++;
    },
    run(seconds, until = null) {
      const n = Math.round(seconds / DT);
      for (let k = 0; k < n; k++) { sim.step(); if (until && until()) return true; }
      return false;
    },
    count: (name, f = () => true) => log.filter((e) => e.name === name && f(e.p)).length,
    alarmed: () => log.some((e) => e.name === 'alarm:zone' || e.name === 'alarm:start'),
  };
  return sim;
}

/** A sentry spawn with no sweep facing `heading`. */
export function post(id, x, z, heading = 0, extra = {}) {
  return { id, soldierType: 'soldier', x, z, heading, post: { heading, sweep: 0, period: 5 }, ...extra };
}
