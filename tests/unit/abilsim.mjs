/**
 * Headless simulation helper for the ABILITIES unit tests: builds a World from a small mission def (grid only,
 * no meshes), spawns commandos/enemies/vehicles like Game._spawnUnits and steps entities in Game.step order.
 * Enemy brains can be replaced by an inert stub ({brains:false}) so ability rules are tested in isolation.
 */
import * as THREE from 'three';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { firstAidCarrier, FIRST_AID_DOSES, defaultInventory } from '../../src/items.js';

/** Inert brain: records distraction calls, never reacts. */
export function stubBrain(enemy) {
  return {
    enemy, state: 'IDLE', distracted: null, heard: [],
    update() {}, attach() {}, hear(n) { this.heard.push(n); }, onDeath() { this.state = 'DEAD'; },
    distractBy(spy) { this.distracted = spy; this.state = 'DISTRACTED'; return true; },
    releaseDistraction() { this.distracted = null; this.state = 'IDLE'; },
    isAware() { return false; }, notifyKill() {}, onBodyFound() {}, serialize() { return null; }, deserialize() {},
  };
}

/**
 * @param {object} def partial mission def (size defaults to 60×60 grass)
 * @param {{brains?: boolean}} [opts]
 */
export function makeSim(def = {}, opts = {}) {
  const mission = normalizeMission({ id: 'abil', size: [60, 60], baseTerrain: 'grass', campaign: 'BEL', ...def }, { quiet: true });
  const world = new World({ size: mission.size, scene: new THREE.Scene(), mission, seed: 7 });
  buildMap(world, mission, { meshes: false });
  world.vehicleFactory = (s) => new Vehicle(s);
  const medic = firstAidCarrier(mission.commandos.map((c) => c.role));
  const events = [];
  const on = (name) => world.events.on(name, (p) => events.push({ name, p, t: world.time }));
  for (const n of ['noise', 'explosion', 'shot', 'bomb:armed', 'bomb:exploded', 'bomb:detonate', 'trap:sprung', 'unit:killed',
    'enemy:unmasked-spy', 'unit:climb', 'ability:start', 'ability:end', 'device', 'door', 'unit:freed', 'structure:destroyed', 'unit:water']) on(n);
  for (const c of mission.commandos) {
    const s = { ...c, campaign: 'BEL', inventory: c.inventory ? { ...c.inventory } : undefined };
    if (c.role === medic && s.inventory?.firstAid === undefined && mission.firstAid !== false) s.inventory = { ...(s.inventory || defaultInventory(c.role)), firstAid: FIRST_AID_DOSES };
    world.add(new Commando(s));
  }
  for (const e of mission.enemies) {
    const en = new Enemy(e);
    if (opts.brains === false) en.brain = stubBrain(en);
    world.add(en);
  }
  for (const v of mission.vehicles) world.spawnVehicle(v.vehicleType || 'truck', v);
  world.rebuildSpatial();

  const sim = {
    world, mission, events,
    get: (id) => world.byId(id),
    cmd: (role) => world.commandos.find((c) => c.role === role || c.tag === role),
    step(dt = 1 / 60) {
      const run = (list) => { for (const e of [...list]) if (!e.removed) e.update(dt); };
      world.rebuildSpatial();
      world.refreshDynamicOccluders();
      run(world.commandos);
      run(world.enemies);
      world.runBelTicks(dt);
      run(world.vehicles);
      run(world.projectiles);
      run(world.interactables);
      world.flushRemovals();
      world.time += dt;
      world.tick++;
    },
    run(seconds, until = null) {
      const n = Math.round(seconds * 60);
      for (let k = 0; k < n; k++) { sim.step(); if (until && until()) return true; }
      return false;
    },
    count: (name, filter = () => true) => events.filter((e) => e.name === name && filter(e.p)).length,
    last: (name) => [...events].reverse().find((e) => e.name === name) || null,
    clear: () => { events.length = 0; },
  };
  return sim;
}

/** An enemy spawn facing `heading` (radians) with no sweep. */
export function guard(id, x, z, heading = 0, extra = {}) {
  return { id, soldierType: 'soldier', x, z, heading, post: { heading, sweep: 0, period: 5 }, ...extra };
}
