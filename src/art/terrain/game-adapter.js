/**
 * Game integration adapter (terrain final). Drop-in path for src/art/terrain.js + world/map-builder.js:
 *
 *   // art/terrain.js
 *   export function buildTerrain(grid, theater, ctx) { return createTerrainHandle(ctx.renderer, ctx.scene, grid, theater, ctx); }
 *   // map-builder.js keeps `terrain = buildTerrain(grid, theater, { renderer, scene, camera, mission })`; the handle
 *   // is returned synchronously (ground = placeholder Group, water: null) and fills in when `.ready` resolves.
 *   // world update:   terrain.update(dt, camera); stampUnits(terrain, world.units); stampVehicles(terrain, world.vehicles)
 *   // AI (TRACKS §4.8): tracksNear(terrain, x, z, r) → footprints/tyre tracks with visibility for guards to follow
 *
 * @module terrain-final/game-adapter
 */
import * as THREE from 'three';
import { createTerrain } from './terrain.js';

/** Engine vehicleType → trail layout (trails.js VEHICLE_TYPES). Boats/planes leave no ground trail. */
export const VEHICLE_TRAIL = {
  truck: 'truck', horch: 'car', van: 'truck', car: 'car', jeep: 'jeep', kubel: 'jeep',
  tank: 'tank', panzer2: 'tank', sdkfz: 'halftrack', halftrack: 'halftrack', motorcycle: 'motorcycle',
};

/**
 * Synchronous handle around the async createTerrain (T-A style `.ready`). Calls made before the terrain is ready
 * (stampTrail/recordTrail) are queued; queries return [] / flat ground until then.
 * @returns {{ground:THREE.Group, water:null, ready:Promise<object>, terrain:object|null, update:Function,
 *   stampTrail:Function, recordTrail:Function, queryTrails:Function, heightAt:Function, materialAt:Function, dispose:Function}}
 */
export function createTerrainHandle(renderer, scene, grid, theater, opts = {}) {
  const ground = new THREE.Group();
  ground.name = 'terrainFinal';
  const queue = [];
  const h = {
    ground, water: null, terrain: null,
    ready: null,
    update(dt, camera) { h.terrain?.update(dt, camera); },
    stampTrail(...a) { if (h.terrain) return h.terrain.stampTrail(...a); queue.push(['stampTrail', a]); return null; },
    recordTrail(...a) { if (h.terrain) return h.terrain.recordTrail(...a); queue.push(['recordTrail', a]); return null; },
    queryTrails(...a) { return h.terrain ? h.terrain.queryTrails(...a) : []; },
    heightAt(x, z) { return h.terrain ? h.terrain.heightAt(x, z) : 0; },
    materialAt(x, z) { return h.terrain ? h.terrain.materialAt(x, z) : null; },
    dispose() { h.terrain?.dispose(); scene.remove(ground); },
  };
  scene.add(ground);
  h.ready = createTerrain(renderer, ground, grid, theater, opts).then((t) => {
    h.terrain = t;
    t.mesh.userData.waterTerrain = true; // water final: bed capture reads the carved ground
    for (const [fn, a] of queue.splice(0)) t[fn](...a);
    if (opts.roads) for (const r of opts.roads) t.preTrample(r.points, r);
    return t;
  });
  return h;
}

/**
 * Wire the unit 'footprint' event (docs/ARCHITECTURE.md) to gameplay trail records. Visual prints are stamped per
 * frame by stampUnits (all soft ground, grass flattening), so this only records — no double prints.
 * @returns {() => void} unsubscribe
 */
export function wireFootprints(events, terrain) {
  const fn = (e) => terrain.recordTrail('foot', e.x, e.z, e.heading, e.owner?.id ?? e.owner, { aiVisible: e.aiVisible, t0: e.t });
  events.on('footprint', fn);
  return () => events.off?.('footprint', fn);
}

/** Per-frame visual stamping for moving units: boot prints (alternating), crawl furrows, body drags. */
export function stampUnits(terrain, units) {
  for (const u of units || []) {
    if (!u.alive || u.y > 0.3 || u.inVehicle || u.stance === 'swim' || u.stance === 'dive') continue;
    const id = 'u' + (u.id ?? u.name);
    if (u.stance === 'crawl' || u.stance === 'prone') terrain.stampTrail('crawl', u.x, u.z, u.heading, { id, record: false });
    else terrain.stampTrail('walker', u.x, u.z, u.heading, { id, run: u.moveMode === 'run', record: false });
    if (u.carrying) terrain.stampTrail('drag', u.x - Math.cos(u.heading) * 0.9, u.z - Math.sin(u.heading) * 0.9, u.heading, { id: id + 'd' });
  }
}

/** Per-frame vehicle stamping: every wheel/track, dual rear tyres, spray hook (terrain opts.onSpray). */
export function stampVehicles(terrain, vehicles) {
  for (const v of vehicles || []) {
    const type = VEHICLE_TRAIL[v.vehicleType];
    if (!type || v.alive === false) continue;
    const speed = Math.abs(v.speed ?? v.vel ?? 0);
    if (speed < 0.05) continue;
    terrain.stampTrail('vehicle', v.x, v.z, v.heading, { id: 'v' + (v.id ?? v.vehicleType), type, speed });
  }
}

/**
 * AI query (TRACKS §4.8): trails a guard at (x, z) can notice within r metres, newest first.
 * Returns records {x, z, heading, kind:'foot'|'vehicle'|'crawl'|'drag', id, age, visibility, material}.
 */
export function tracksNear(terrain, x, z, r = 3, o = {}) {
  return terrain.queryTrails(x, z, r, { minVisibility: o.minVisibility ?? 0.15, maxAge: o.maxAge, aiOnly: true, kinds: o.kinds });
}
