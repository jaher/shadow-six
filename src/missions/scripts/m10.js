/**
 * BEL Mission 10 "Operation Icarus": mission-local helpers (docs/missions/m10.md §4, §6, §10, §13). Owned by MISSIONS.
 *
 *  - The airfield shelf (y 5) is raised with `walkways` strips (map-builder has no area elev; M5/M8 method) and the
 *    road climbs it on a stepped ramp. Land vehicles never enter a raised cell (vehicle.passableAt), so every tank
 *    stops at the ramp foot: that is our "chevaux-de-frise" stop (§13 delta 5).
 *  - m10Tick(world): per-tick glue (idempotent, so it survives a quick load):
 *      · the four crewed Panzer IVs die to grenades / barrel and vehicle blasts in this mission (delta 1);
 *      · on standby (no camp alarm yet) they watch only out of their shed mouths (STANDBY_EYES);
 *      · the Ju 52 is indestructible and may taxi on the shelf; it and the Stukas stand at y 5 (deltas 2, 3);
 *      · the alarm drives of pz21 / pz24 resume after a fight (the trigger `drive` does not);
 *      · the Ju 52 climbs as it leaves (delta 4, visual only).
 *  - setVehicleRoute(): swaps a crewed vehicle's brain onto a LOOP route (pz22's alarm patrol, delta 12).
 *  - buildShelfVisuals(): the shelf prism and the ramp slab (browser only).
 * @module missions/scripts/m10
 */

import * as THREE from 'three';
import { terrainPrism, terrainRamp } from '../../art/kit-terrain.js';
import { plateauWalkways } from './m05.js';
import { normalizeVehicleRoute } from '../../ai/vehicle-ai.js';

export { segmentHoles, rampWalkways } from './m08.js';

export const SHELF_Y = 5;
/** The four crewed Panzer IVs (grenade-killable here); the player's vacant `pz4` keeps its heavy armour. */
export const ENEMY_TANKS = ['pz21', 'pz22', 'pz23', 'pz24'];

/** The shelf as walkway strips at SHELF_Y minus the holes (structures standing on it keep their block). */
export function shelfStrips(poly, holes) {
  return plateauWalkways(poly, holes, SHELF_Y);
}

/** Swap a crewed vehicle's brain onto `route` ({type, speed?, points:[{x,z,wait}]}). */
export function setVehicleRoute(world, id, route) {
  const v = world.byId?.(id);
  if (!v || v.destroyed || !v.brain) return false;
  const b = v.brain;
  b.route = normalizeVehicleRoute(route, v);
  b.behavior = 'route';
  b.state = 'route';
  b.started = false;
  b.dir = 1;
  return true;
}

function patchTank(v) {
  if (v._m10Light) return;
  v._m10Light = true;
  const orig = v.explosionHit.bind(v);
  v.explosionHit = (cls, source) => {
    if (v.destroyed) return false;
    if (cls === 'grenade' || cls === 'barrel' || cls === 'vehicle') { v.destroy(source, cls); return true; }
    return orig(cls, source);
  };
}

function patchJu52(v, world) {
  if (v._m10Plane) return;
  v._m10Plane = true;
  v.bulletImmune = true;
  v.explosionHit = () => false; // systems.md: "explosives do not destroy it"
  v.destroy = () => {};
  // not steerable by the player (dossier §10.2): it only leaves by the extraction take-off
  v.handleOrder = (unit, order) => {
    if (order?.type === 'move') world.events?.emit('message', { text: 'McRae: "We go when everyone is aboard, not before."', kind: 'info', unit });
    return true;
  };
  // taxis on the raised shelf (land rule: no raised cells) and off the W edge
  v.passableAt = (x, z) => {
    const g = world.grid, { i, j } = g.worldToCell(x, z);
    return g.inBounds(i, j) ? true : !!v.offMapOK;
  };
}

/** Resume a scripted drive (pz24) that a fight interrupted. `pts` = [{x,z}...]. */
function resumeDrive(v, pts) {
  const last = pts[pts.length - 1];
  if (v.destroyed || v.goal || v.path || v.driver || v.brain?.state === 'attack') return;
  if (Math.hypot(v.x - last.x, v.z - last.z) < 3) return;
  let k = 0, bd = Infinity;
  pts.forEach((p, n) => { const d = Math.hypot(p.x - v.x, p.z - v.z); if (d < bd) { bd = d; k = n; } });
  v.followPath(pts.slice(Math.min(k + 1, pts.length - 1)));
}

/**
 * Standby eyes: until the camp alarm each crewed tank stares out of its shed mouth with a fixed 50° cone (a
 * buttoned-up crew on watch), so the dossier's prone crawl to the vacant tank exists; the camp alarm (RINT) gives
 * them the full 'tank' profile (70° cone, turret sweep) back. Recomputed every tick, so it survives a quick load.
 */
export const STANDBY_EYES = { fov: 50, sweep: 0 };
function tankEyes(v, alarmed) {
  const vis = v.vision;
  if (!vis || v.destroyed) return;
  if (!v._m10Eyes) v._m10Eyes = { fov: vis.fovDeg, sweep: vis.sweepDeg };
  const want = alarmed ? v._m10Eyes : STANDBY_EYES;
  if (vis.fovDeg !== want.fov) { vis.fovDeg = want.fov; vis.fov = (want.fov * Math.PI) / 180; }
  if (vis.sweepDeg !== want.sweep) { vis.sweepDeg = want.sweep; vis.sweep = (want.sweep * Math.PI) / 180; }
}

/** Per-tick glue (installed as a `tick` trigger with once:false). */
export function m10Tick(world) {
  const alarmed = !!world.alarm?.zonesFired?.some((f) => f.event === 'RINT');
  for (const id of ENEMY_TANKS) { const v = world.byId?.(id); if (v) { patchTank(v); tankEyes(v, alarmed); } }
  const ju = world.byId?.('ju52');
  if (ju) patchJu52(ju, world);
  for (const id of ['stuka_a', 'stuka_b']) { const v = world.byId?.(id); if (v && !v.destroyed) v.y = SHELF_Y; }
  if (ju) {
    const aboard = (world.commandos || []).filter((c) => c.alive !== false && c.vehicle === ju).length;
    // take-off: climbs over the last 40 m of the runway once it rolls with everyone aboard
    ju.y = aboard && ju.speed > 0 && ju.x < 50 ? SHELF_Y + Math.min(25, (50 - ju.x) * 0.6) : Math.max(SHELF_Y, ju.y || 0);
  }
  for (const [id, route] of Object.entries(world._m10?.drives || {})) { const v = world.byId?.(id); if (v) resumeDrive(v, route); }
}

/** Start a scripted alarm drive (pz21 onto the apron, pz24 to the airfield road) that m10Tick resumes after a fight. */
export function startDrive(world, id, pts) {
  world._m10 = world._m10 || {};
  const route = pts.map(([x, z]) => ({ x, z }));
  world._m10.drives = { ...(world._m10.drives || {}), [id]: route };
  const v = world.byId?.(id);
  if (!v || v.destroyed || v.driver) return;
  if (v.brain) v.brain.state = 'done';
  v.followPath(route);
}

// ------------------------------------------------------------------ visuals (browser only)

/** Old flat colours of the prisms → [top, side] texture sets (art/dressing.js). */
const PRISM_SETS = { 0x9f8866: ['sand', 'sandstone'], default: ['sand', 'sandstone'] };

function prism(points, h, top, side) {
  // placeholder-art pass: textured escarpment (art/kit-terrain.js), same shape and height as the walk surface
  const T = PRISM_SETS[top] || PRISM_SETS.default;
  return terrainPrism(points, h, { top: T[0], side: T[1] });
}

function rampMesh(a, b, width, color) {
  return terrainRamp(a, b, width, { top: 'gravel', side: 'sandstone' }); // placeholder-art pass (art/kit-terrain.js)
}

/** Shelf prism + ramp; shelf props lifted to SHELF_Y; the placeholder cliff mesh hidden. */
export function buildShelfVisuals(world, spec) {
  if (!world.scene || world._m10Visuals) return;
  world._m10Visuals = true;
  const root = new THREE.Group();
  root.name = 'm10:terrain';
  root.add(prism(spec.shelf, SHELF_Y - 0.02, 0x9f8866, 0x8a7458));
  root.add(rampMesh(spec.ramp.a, spec.ramp.b, spec.ramp.width, 0x8f7a5a));
  world.scene.add(root);
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const id of spec.lift || []) {
    const o = world.structures?.get(id)?.object3d;
    if (o && !o.userData.m10Lifted) { o.userData.m10Lifted = true; o.position.y += SHELF_Y; }
  }
}

/** mission.script: visuals, shelf drums at y 5, first patch pass. */
export function m10Script(spec) {
  return (world) => {
    buildShelfVisuals(world, spec);
    for (const id of spec.lift || []) {
      const e = world.structures?.get(id)?.entity;
      if (e && !e.carriedBy && !(e.y > 0)) e.y = SHELF_Y;
    }
    m10Tick(world);
  };
}
