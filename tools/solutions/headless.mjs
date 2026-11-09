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
import { createPhysics } from '../../src/physics/world-physics.js';
import { gunzipSync } from 'node:zlib';
import { importGrid, groundFn, visibilityTerrain } from './grid-snap.mjs';
import { applyExtras, applyVehicleDims, ownStructures } from './world-snap.mjs';

/** A fingerprint of a grid's gameplay layers (block, nav stamps, terrain): what a nav cache was taken against. */
export function gridPrint(g) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  for (let k = 0; k < g.block.length; k++) { mix(g.block[k]); mix(g.navBlock[k] ? 1 : 0); mix(g.terrain[k]); }
  return h.toString(16);
}

/**
 * The game's mesh-measured world for mission `id`, if tools/solutions/navcache.mjs cached it against this very headless
 * build: the whole grid, the ground relief and print visibility, the body solids / doors / vehicle dims / spawn spots
 * (grid-snap.mjs, world-snap.mjs), so the headless men path, see, fall and are seen as in the game. Returns whether it
 * was applied. (Only the cached missions: M3, M4, M7, M13, M17, M19; the rest run on the plain build as before.)
 */
function applyNavCache(world, id) {
  const f = new URL(`./navcache/${id}.json`, import.meta.url);
  if (!existsSync(f)) return false;
  const c = JSON.parse(readFileSync(f, 'utf8')), g = world.grid;
  if (c.cols !== g.cols || c.rows !== g.rows || c.fingerprint !== gridPrint(g)) {
    console.warn(`headless ${id}: tools/solutions/navcache/${id}.json is stale (the map changed): re-run tools/solutions/navcache.mjs ${id}`);
    return false;
  }
  importGrid(g, c.grid, gunzipSync);
  world.cachedSpawns = c.spawns || null;
  world.cachedExtras = c.extras || null;
  if (c.ground) world.terrain = visibilityTerrain(c.ground, gunzipSync); // (the guards follow prints by the ground's material: ai/footprints.js)
  if (c.ground) for (const fn of ['groundY', 'lyingY']) { const f = groundFn(c.ground, fn, gunzipSync, g); if (f) world[fn] = f; }
  return true;
}

/**
 * Where the game stood a unit at load (Game._spawnUnits `placed`: the placement rules over the drawn map, tower decks
 * on the measured surface): the cached spawn point (x, z, y) of unit `i` of kind `kind`, laid over its authored spawn.
 */
function atCachedSpawn(world, kind, i, spawn) {
  const p = world.cachedSpawns?.[kind]?.[i];
  return p ? { ...spawn, x: p[0], z: p[1], y: p[2] } : spawn;
}

/**
 * @param {{patch?: (def) => def, navCache?: boolean}} [o] navCache: lay the game's cached mesh-measured world over the build
 *   (tools/solutions/navcache.mjs; headlessDriver does, for the solutions). Off by default: the unit tests of the plain build
 *   (M3, M13…) were written against it.
 */
export function headlessMission(id, { patch = null, navCache = false } = {}) {
  Entity.nextId = 1;
  // (`patch`: def → def, a variant of the mission for a test — e.g. M3 with its old start wall back, tests/unit/prone-wall)
  const mission = ownStructures(normalizeMission(patch ? patch(getMission(id)) : getMission(id), { quiet: true }));
  const world = new World({ size: mission.size, scene: new THREE.Scene(), mission, seed: mission.seed ?? CONFIG.sim.seed });
  world.alarm = new Alarm(world);
  buildMap(world, mission, { meshes: false });
  // (the game's drawn models close a few more cells to walking: the cached browser stamps, when there are some)
  world.navCached = !patch && navCache && applyNavCache(world, id);
  if (world.cachedExtras) applyExtras(world, world.cachedExtras); // (after the map, before the units: the units' own spawn spots are cached)
  world.vehicleFactory = (s) => new Vehicle(s);
  const medic = firstAidCarrier(mission.commandos.map((c) => c.role));
  for (const [i, c] of mission.commandos.entries()) {
    const s = { ...c, campaign: mission.campaign, inventory: c.inventory ? { ...c.inventory } : undefined };
    if (c.role === medic && s.inventory?.firstAid === undefined && mission.firstAid !== false) s.inventory = { ...(s.inventory || defaultInventory(c.role)), firstAid: FIRST_AID_DOSES };
    const cmd = world.add(new Commando(atCachedSpawn(world, 'commandos', i, s))) || world.commandos.at(-1);
    if (c.hideout) admitAtSpawn(world, cmd, c.hideout); // (as Game._spawnUnits: he starts inside his hideout)
    // §7.3 `stance: 'crawl'`: the mission starts him prone (as Game: already down, no stance-change lockout)
    if (c.stance === 'crawl') { cmd.setStance('crawl'); cmd._stanceT = 0; }
  }
  for (const [i, e] of mission.enemies.entries()) world.add(new Enemy(atCachedSpawn(world, 'enemies', i, e)));
  for (const v of mission.vehicles) world.spawnVehicle(v.vehicleType || 'truck', v);
  applyVehicleDims(world, world.cachedExtras);
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

/**
 * The game's blast / ragdoll physics (Game.loadMission: createPhysics over the finished map, tier from the house rules)
 * on a headless mission: without it the corpses never settle where the game's do, and a man carrying one walks on a
 * different line (the null object is the fallback: gameplay then runs by the rule it can honour, physicsGameplay off).
 */
export async function headlessPhysics(s) {
  const w = s.world;
  // (only over the game's own ground: Rapier on the mesh-less build's flat 0 settles bodies differently from the game and from
  // the null object the other missions' solutions were tuned on; a cached mission (navcache) has the game's ground and doors)
  if (!w.navCached) return null;
  w.physics = (await createPhysics(w, { tier: w.house?.physicsTier })) || w.physics;
  if (w.physics.isNull) w.house.physicsGameplay = false;
  for (const c of w.commandos) c.refreshAbilities?.();
  return w.physics;
}

/** Driver (tools/solutions/driver.mjs) over a headless copy of mission `id` (node only). */
export async function headlessDriver(id, o = {}) {
  const { makeDriver } = await import('./driver.mjs');
  const s = headlessMission(id, { navCache: o.navCache ?? true });
  await headlessPhysics(s); // (as Game.loadMission: Rapier over the finished map — corpses, props and gates settle as in the game)
  const D = makeDriver(s.world, { step: s.step, dt: s.dt, skipEscape: s.skipEscape, ...o });
  D.sim = s;
  return D;
}
