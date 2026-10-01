/**
 * BEL Mission 14 "D-Day Kick Off": mission-local helpers (docs/missions/m14.md §4, §5, §7, §10, §11). Owned by MISSIONS.
 *
 *  - Raised levels: the central rock ridge (y 4) is a `cliff` with `walkways` strips (the M5/M8/M11 method, E7);
 *    the casemate roofs come from `casemate_gun` + `roofWalk`; gun 2's rear sand drift is a stepped ramp (E5).
 *  - gunFrame(): local → world for a rotated gun block (roof posts, climb link, ramp all follow the gun's `rot`).
 *  - boardAll(): the whole team starts aboard the rowboat off the SW beach (no schema field for it): the Marine
 *    takes the oars, the others are seated directly (the shallow-water boarding rule does not apply at spawn).
 *  - Soft-lock (T4 [rec]): guns still standing > remote bombs held or planted + explosive barrels left.
 *  - Visuals (browser only): prisms for the ridge and the rock spits, the sand ramp; placeholder cliff boxes hidden.
 * @module missions/scripts/m14
 */

import * as THREE from 'three';
import { levelStrips, rampWalkways, rectPoly } from './m11.js';

export { levelStrips, rampWalkways, rectPoly };

export const RIDGE_Y = 4;
export const ROOF_Y = 3.5;
export const BAR_ROOF_Y = 6;
export const APRON_Y = 0.55; // roofY of g4 (its mesh is 0.65 m: props-extra raises roofs only for h > 0.6)
export const GUNS = ['g1', 'g2', 'g3', 'g4'];
export const BARRELS = ['brl_1', 'brl_2', 'brl_3'];

const rad = (d) => (d * Math.PI) / 180;

/** Local (lx along the gun's width, lz towards its front) → world [x, z]; `g` = {x, z, rot (deg)}. */
export function gunFrame(g) {
  const c = Math.cos(rad(g.rot)), s = Math.sin(rad(g.rot));
  return (lx, lz) => [+(g.x + lx * c - lz * s).toFixed(2), +(g.z + lx * s + lz * c).toFixed(2)];
}

const gone = (e) => !e || e.removed || e.destroyed || e.exploded || e.alive === false;
const targetOf = (w, id) => (w.interactables || []).find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));

/** Guns not yet destroyed. */
export function gunsStanding(world) {
  return GUNS.filter((id) => { const t = targetOf(world, id) || world.byId?.(id); return t && !t.destroyed; }).length;
}

/** Charges the team can still bring to bear: remote bombs held or planted (not yet fired) + intact barrels. */
export function meansLeft(world) {
  let n = 0;
  for (const c of world.commandos || []) if (c.alive !== false) n += c.inventory?.get?.('remoteBomb') ?? 0;
  for (const it of world.interactables || []) {
    if (it.removed) continue;
    if (it.interactKind === 'bomb' && it.bombKind === 'remote' && !it.exploded) n += 1;
    else if (it.interactKind === 'pickup' && it.itemId === 'remoteBomb') n += it.count ?? 1;
  }
  for (const id of BARRELS) if (!gone(world.byId?.(id))) n += 1;
  return n;
}

/** T4: the four guns can no longer all be destroyed. */
export function outOfCharges(world) {
  return meansLeft(world) < gunsStanding(world);
}

/** Seat the whole team in the rowboat (the Marine first, as its operator). */
export function boardAll(world, boatId = 'boat') {
  const v = world.byId?.(boatId);
  if (!v || v.destroyed) return;
  const team = [...(world.commandos || [])].filter((c) => c.alive !== false)
    .sort((a, b) => (a.role === 'diver' ? -1 : 0) - (b.role === 'diver' ? -1 : 0));
  for (const c of team) {
    if (v.occupants.includes(c)) continue;
    c.x = v.x; c.z = v.z;
    if (v.enter(c)) continue;
    if (v.occupants.length >= v.capacity) break;
    v.occupants.push(c); // spawn seating: bypasses the "boat in shallow water" rule
    c.stop?.();
    c.state = 'inVehicle';
    c.vehicle = v;
    if (c.object3d) c.object3d.visible = false;
    world.events?.emit?.('vehicle:enter', { vehicle: v, unit: c });
  }
}

// ------------------------------------------------------------------ visuals (browser only)

function prism(points, h, top, side, y0 = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, z) → world (x, ·, z); extrusion along −y
  g.translate(0, y0 + h, 0);
  const m = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: side, roughness: 1 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A sloped slab from a → b ([x, z, y]), `width` wide. */
function rampMesh(a, b, width, color) {
  const [ax, az, ay] = a, [bx, bz, by] = b;
  const len = Math.hypot(bx - ax, bz - az), nx = (-(bz - az) / len) * (width / 2), nz = ((bx - ax) / len) * (width / 2);
  const v = [ax + nx, ay + 0.05, az + nz, ax - nx, ay + 0.05, az - nz, bx - nx, by + 0.05, bz - nz, bx + nx, by + 0.05, bz + nz];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

/** Ridge + rock prisms, the sand ramp; the placeholder cliff boxes hidden. */
export function buildVisuals(world, spec) {
  if (!world.scene || world._m14Visuals) return;
  world._m14Visuals = true;
  const root = new THREE.Group();
  root.name = 'm14:terrain';
  for (const l of spec.levels || []) root.add(prism(l.poly, l.y - 0.02, 0x7d7262, 0x645a4c));
  for (const r of spec.rocks || []) root.add(prism(r.poly, r.h, 0x756a5b, 0x5d5347));
  for (const r of spec.ramps || []) root.add(rampMesh(r.a, r.b, r.width, 0xb3a07c));
  world.scene.add(root);
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
}

/** mission.script(world): visuals once (the team is seated by the `start` trigger). */
export function m14Script(spec) {
  return (world) => { buildVisuals(world, spec); };
}
