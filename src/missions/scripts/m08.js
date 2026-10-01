/**
 * BEL Mission 8 "Pyrotechnics": mission-local helpers (docs/missions/m08.md §4, §6, §10, §13). Owned by MISSIONS.
 *
 *  - The 4 m plateau is raised with `walkways` strips, one per grid row (map-builder has no area `elev`, D1).
 *    The row sweep is shared with M5 (scripts/m05.js plateauWalkways); here the holes are the ruined walls,
 *    the gun-pit parapet and the rim wire, given as thin rectangles so those cells keep their block.
 *  - rampWalkways(): a sloped road as a chain of short strips stepping ≤ 0.4 m (the grid's MAX_STEP is 0.6 m, D2).
 *  - m08Script(spec): runtime glue installed as `mission.script`:
 *      · the team starts prone (crawl stance) in the start yard;
 *      · plateau props, drums and vehicles are lifted to y 4; the plateau and the ramps get a mesh, the dry
 *        wadis a sunken bed (the placeholder cliff meshes are hidden).
 * @module missions/scripts/m08
 */

import * as THREE from 'three';
import { rectPoly, plateauWalkways } from './m05.js';

export const PLATEAU_Y = 4;
export const TANK_DECK_Y = 4.5;
export const ROOF_Y = 4.5;

/** Thin rectangles (as {poly}) covering every segment of a polyline wall of `width` m (+0.2 m margin). */
export function segmentHoles(points, width = 0.8) {
  const out = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    out.push({ poly: rectPoly((ax + bx) / 2, (az + bz) / 2, len + width + 0.4, width + 0.4, Math.atan2(bz - az, bx - ax)) });
  }
  return out;
}

/** The plateau as walkway strips at PLATEAU_Y minus the holes. */
export function plateauStrips(poly, holes) {
  return plateauWalkways(poly, holes, PLATEAU_Y);
}

/**
 * A ramp from `a` [x, z, y] to `b` [x, z, y] as `steps` straight strips of `width` m, each at the mean height of
 * its stretch (Δy per step = |ya − yb| / steps, keep it ≤ 0.45 m). Strips overlap 0.3 m so no cell is skipped.
 * @returns {{points:number[][], width:number, y:number}[]}
 */
export function rampWalkways(a, b, width, steps) {
  const [ax, az, ay] = a, [bx, bz, by] = b;
  const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
  const out = [];
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps, t1 = (k + 1) / steps;
    const s0 = Math.max(0, t0 * len - 0.15), s1 = Math.min(len, t1 * len + 0.15);
    const y = +(ay + (by - ay) * ((k + 0.5) / steps)).toFixed(3);
    out.push({ points: [[+(ax + ux * s0).toFixed(2), +(az + uz * s0).toFixed(2)], [+(ax + ux * s1).toFixed(2), +(az + uz * s1).toFixed(2)]], width, y });
  }
  return out;
}

// ------------------------------------------------------------------ visuals (browser only)

function prism(points, h, top, side) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, z) → world (x, ·, z); extrusion along −y
  g.translate(0, h, 0);
  const m = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: side, roughness: 1 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A sloped road slab from a → b (x, z, y), `width` wide. */
function rampMesh(a, b, width, color) {
  const [ax, az, ay] = a, [bx, bz, by] = b;
  const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len * (width / 2), nz = (bx - ax) / len * (width / 2);
  const v = [ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx - nx, by, bz - nz, bx + nx, by, bz + nz];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

/** Plateau prism, ramps and wadi beds; plateau props lifted to PLATEAU_Y; placeholder cliff meshes hidden. */
export function buildPlateauVisuals(world, spec) {
  if (!world.scene || world._m08Visuals) return;
  world._m08Visuals = true;
  const root = new THREE.Group();
  root.name = 'm08:terrain';
  root.add(prism(spec.plateau, PLATEAU_Y - 0.02, 0x7d6a4c, 0x5e4e38));
  for (const r of spec.ramps || []) root.add(rampMesh(r.a, r.b, r.width, 0x74644a));
  for (const poly of spec.wadis || []) {
    const bed = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)))),
      new THREE.MeshStandardMaterial({ color: 0x4f4030, roughness: 1 }));
    bed.rotation.x = Math.PI / 2; bed.position.y = 0.03;
    root.add(bed);
  }
  world.scene.add(root);
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const id of spec.lift || []) {
    const o = world.structures?.get(id)?.object3d;
    if (o && !o.userData.m08Lifted) { o.userData.m08Lifted = true; o.position.y += PLATEAU_Y; }
  }
}

/** Logical heights: plateau drums and the vehicles parked on the plateau stand at PLATEAU_Y. */
export function liftEntities(world, spec) {
  for (const id of spec.lift || []) {
    const e = world.structures?.get(id)?.entity;
    if (e && !e.carriedBy && !e.exploded && !(e.y > 0)) e.y = PLATEAU_Y;
  }
  for (const id of spec.liftVehicles || []) { const v = world.byId?.(id); if (v && !v.destroyed) v.y = PLATEAU_Y; }
}

/** mission.script(world, director): installed once after the lazy set-piece init. */
export function m08Script(spec) {
  return (world) => {
    buildPlateauVisuals(world, spec);
    liftEntities(world, spec);
    // §7 both men start prone in the start yard (only on a fresh start, not after a quick load)
    if ((world.time ?? 0) < 0.5) {
      for (const c of world.commandos || []) {
        const y = world.grid?.elevAt?.(c.x, c.z) ?? 0;
        if (y > 0 && !(c.y > 0)) c.y = y; // spawned on the plateau: stand on it, not inside it
        if (c.stance !== 'stand') continue;
        if (typeof c.setStance === 'function') c.setStance('crawl'); else c.stance = 'crawl';
      }
    }
  };
}
