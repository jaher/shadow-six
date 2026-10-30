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
import { admitAtSpawn } from '../../src/entities/interactables.js';
import { Alarm } from '../../src/ai/alarm.js';
import { firstAidCarrier, FIRST_AID_DOSES, defaultInventory } from '../../src/items.js';
import { createObjectives, checkObjectives, updateExtractionVehicle, skipExtractionDrive } from '../../src/core/objectives.js';
import { CONFIG } from '../../src/config.js';
import '../../src/abilities/index.js';
import { readFileSync, existsSync } from 'node:fs';

/** A fingerprint of a grid's gameplay layers (block, nav stamps, terrain): what a nav cache was taken against. */
export function gridPrint(g) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  for (let k = 0; k < g.block.length; k++) { mix(g.block[k]); mix(g.navBlock[k] ? 1 : 0); mix(g.terrain[k]); }
  return h.toString(16);
}

/**
 * The browser's mesh-derived walking stamps (map-builder rule (e)) for mission `id`, if tools/solutions/navcache.mjs
 * cached them and they were taken against this very headless build: stamped on as one nav stamp ('navcache'), so the
 * headless men walk the game's ways. Returns whether it was applied.
 */
function applyNavCache(world, id) {
  const f = new URL(`./navcache/${id}.json`, import.meta.url);
  if (!existsSync(f)) return false;
  const c = JSON.parse(readFileSync(f, 'utf8')), g = world.grid;
  if (c.cols !== g.cols || c.rows !== g.rows || c.fingerprint !== gridPrint(g)) {
    console.warn(`headless ${id}: tools/solutions/navcache/${id}.json is stale (the map changed): re-run tools/solutions/navcache.mjs ${id}`);
    return false;
  }
  const cells = [];
  for (const [k0, n] of c.nav) for (let k = k0; k < k0 + n; k++) cells.push(k);
  g.navStamp('navcache', cells);
  for (const [k0, n] of c.clear || []) for (let k = k0; k < k0 + n; k++) g.navBlock[k] = 0;
  for (const [k, v] of c.block) g.block[k] = v;
  for (const [k, v] of c.owner || []) g.owner[k] = v;
  const typed = { crawlStep: Uint8Array, blockTop: Float32Array, flatExtra: Uint8Array };
  for (const [name, cells] of Object.entries(c.layers || {})) {
    if (!cells.length || !typed[name]) continue;
    const a = g[name] || (g[name] = new typed[name](g.cols * g.rows));
    for (const [k, v] of cells) a[k] = v;
  }
  if (c.solid?.length) {
    const S = g.cols * 2, q = [];
    for (const [k0, n] of c.solid) for (let k = k0; k < k0 + n; k++) q.push(`${k % S},${Math.floor(k / S)}`);
    g.solidStamp('navcache', q);
  }
  return true;
}

export function headlessMission(id, { patch = null, navCache = true } = {}) {
  Entity.nextId = 1;
  // (`patch`: def → def, a variant of the mission for a test — e.g. M3 with its old start wall back, tests/unit/prone-wall)
  const mission = normalizeMission(patch ? patch(getMission(id)) : getMission(id), { quiet: true });
  const world = new World({ size: mission.size, scene: new THREE.Scene(), mission, seed: mission.seed ?? CONFIG.sim.seed });
  world.alarm = new Alarm(world);
  buildMap(world, mission, { meshes: false });
  // (the game's drawn models close a few more cells to walking: the cached browser stamps, when there are some)
  world.navCached = !patch && navCache && applyNavCache(world, id);
  world.vehicleFactory = (s) => new Vehicle(s);
  const medic = firstAidCarrier(mission.commandos.map((c) => c.role));
  for (const c of mission.commandos) {
    const s = { ...c, campaign: mission.campaign, inventory: c.inventory ? { ...c.inventory } : undefined };
    if (c.role === medic && s.inventory?.firstAid === undefined && mission.firstAid !== false) s.inventory = { ...(s.inventory || defaultInventory(c.role)), firstAid: FIRST_AID_DOSES };
    const cmd = world.add(new Commando(s)) || world.commandos.at(-1);
    if (c.hideout) admitAtSpawn(world, cmd, c.hideout); // (as Game._spawnUnits: he starts inside his hideout)
    // §7.3 `stance: 'crawl'`: the mission starts him prone (as Game: already down, no stance-change lockout)
    if (c.stance === 'crawl') { cmd.setStance('crawl'); cmd._stanceT = 0; }
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
    /** §7.6 ESC while the loaded escape vehicle drives off (Game.skipExtraction): true when the drive was skipped */
    skipEscape: () => skipExtractionDrive(world, flags),
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
  const D = makeDriver(s.world, { step: s.step, dt: s.dt, skipEscape: s.skipEscape, ...o });
  D.sim = s;
  return D;
}
