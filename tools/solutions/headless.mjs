/**
 * Headless mission sim for solution scripts (no renderer): World + map grid + units + Alarm + objectives + the
 * scripted extraction, stepped in the Game.step order (src/game.js step). Mirrors tests/unit/abilsim.mjs, but uses
 * the mission's own seed and runs the objective / extraction checks like the game does.
 */
import * as THREE from 'three';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { getMission } from '../../src/missions/index.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { Entity } from '../../src/entities/entity.js';
import { Alarm } from '../../src/ai/alarm.js';
import { firstAidCarrier, FIRST_AID_DOSES, defaultInventory } from '../../src/items.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { CONFIG } from '../../src/config.js';
import '../../src/abilities/index.js';

export function headlessMission(id) {
  Entity.nextId = 1;
  const mission = normalizeMission(getMission(id), { quiet: true });
  const world = new World({ size: mission.size, scene: new THREE.Scene(), mission, seed: mission.seed ?? CONFIG.sim.seed });
  world.alarm = new Alarm(world);
  buildMap(world, mission, { meshes: false });
  world.vehicleFactory = (s) => new Vehicle(s);
  const medic = firstAidCarrier(mission.commandos.map((c) => c.role));
  for (const c of mission.commandos) {
    const s = { ...c, campaign: mission.campaign, inventory: c.inventory ? { ...c.inventory } : undefined };
    if (c.role === medic && s.inventory?.firstAid === undefined && mission.firstAid !== false) s.inventory = { ...(s.inventory || defaultInventory(c.role)), firstAid: FIRST_AID_DOSES };
    world.add(new Commando(s));
  }
  for (const e of mission.enemies) world.add(new Enemy(e));
  for (const v of mission.vehicles) world.spawnVehicle(v.vehicleType || 'truck', v);
  world.objectives = createObjectives(mission.objectives || []);
  if (!world.extraction) world.extraction = mission.extraction || null;
  world.rebuildSpatial();
  const flags = {};
  const dt = CONFIG.sim.dt;
  return {
    world, mission, dt,
    step() {
      const w = world;
      w.rebuildSpatial();
      w.refreshDynamicOccluders();
      const run = (list) => { for (const e of [...list]) if (!e.removed) e.update(dt); };
      run(w.commandos); run(w.enemies); w.runBelTicks(dt); run(w.vehicles); run(w.projectiles); run(w.interactables);
      w.physics.step(dt);
      w.alarm.update(dt);
      checkObjectives(w);
      updateExtractionVehicle(w, flags);
      w.flushRemovals();
      w.time += dt; w.tick++;
    },
  };
}

/** Driver (tools/solutions/driver.mjs) over a headless copy of mission `id` (node only). */
export async function headlessDriver(id, o = {}) {
  const { makeDriver } = await import('./driver.mjs');
  const s = headlessMission(id);
  const D = makeDriver(s.world, { step: s.step, dt: s.dt, ...o });
  D.sim = s;
  return D;
}
