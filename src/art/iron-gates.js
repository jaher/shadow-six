/**
 * M17 art pass: the prison camp's gate leaves (Before Dawn, dossier §5.2), drawn procedurally between the brick piers
 * the wall runs end on (art/dressing.js brick_railing): the wrought-iron double back gate (`iron`: flat-bar frame,
 * round bars with spear points, a riveted kick plate, a lock box at the meeting stiles) and the cage's mesh door
 * (`jail_door_mesh`: angle-iron frame, diagonal brace, welded square mesh, hasp and padlock). Local frame as
 * props.js ITEM.gate: the leaves span local X (width p.w), thin in Z, standing on y 0. Visual only; the gate's
 * footprint, lock and open state stay the interactable's (a shut gate shows its leaves, an open one hides them).
 * @module art/iron-gates
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial } from './dressing.js';

/** Variants this module draws. */
export const IRON_GATE_VARIANTS = new Set(['iron', 'jail_door_mesh']);

const bx = (w, h, d, x, y, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
const rod = (r, h, x, y, z = 0, seg = 5) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z).toNonIndexed();
const spear = (x, y, z = 0) => new THREE.ConeGeometry(0.022, 0.09, 4).translate(x, y, z).toNonIndexed();

function meshOf(geos, mat, name) {
  const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false), mat);
  for (const g of geos) g.dispose();
  m.name = name; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** One wrought-iron leaf from x0 to x1 (hinge at x0), height h. */
function ironLeaf(G, x0, x1, h) {
  const w = x1 - x0, cx = (x0 + x1) / 2, s = Math.sign(w) || 1, aw = Math.abs(w);
  G.push(bx(aw, 0.06, 0.05, cx, 0.12), bx(aw, 0.06, 0.05, cx, h * 0.48), bx(aw, 0.06, 0.05, cx, h - 0.22)); // rails
  G.push(bx(0.07, h - 0.08, 0.06, x0 + s * 0.035, (h - 0.08) / 2 + 0.04), bx(0.06, h - 0.12, 0.05, x1 - s * 0.03, (h - 0.12) / 2 + 0.06)); // stiles
  G.push(bx(aw - 0.1, 0.42, 0.012, cx, 0.36));                                         // kick plate
  for (let u = 0.14; u < aw - 0.08; u += 0.12) {                                      // bars + spear points
    const x = x0 + s * u;
    G.push(rod(0.011, h - 0.14, x, (h - 0.14) / 2 + 0.06), spear(x, h - 0.03));
  }
  const d = Math.hypot(aw - 0.12, h * 0.48 - 0.24), a = Math.atan2(h * 0.48 - 0.24, aw - 0.12) * s; // brace in the lower panel
  G.push(new THREE.BoxGeometry(d, 0.045, 0.03).rotateZ(a).translate(cx, (0.12 + h * 0.48) / 2, -0.02).toNonIndexed());
  for (const y of [0.3, h - 0.4]) G.push(rod(0.03, 0.14, x0, y, 0, 8));                 // hinge knuckles
}

/** The double iron gate (back gate). */
function ironGate(p) {
  // the leaves fill the opening between the brick piers the wall runs end on (dressing.js: flush with the run ends)
  const w = p.w ?? 3, h = p.h ?? 2.6, G = [], dark = [], e = w / 2 - (p.pierInset ?? 0.06);
  ironLeaf(G, -e, -0.01, h);
  ironLeaf(G, e, 0.01, h);
  dark.push(bx(0.16, 0.22, 0.09, -0.09, h * 0.5), bx(0.05, 0.05, 0.12, 0.04, h * 0.5)); // lock box + bolt keep
  dark.push(rod(0.012, 0.5, -0.12, 0.25, 0.05), bx(0.04, 0.06, 0.06, -0.12, 0.02, 0.05)); // drop bolt into the ground
  const g = new THREE.Group(); g.name = 'gate:iron';
  g.add(meshOf(G, dressingMaterial('castIron'), 'gate:iron:leaves'), meshOf(dark, dressingMaterial('steel'), 'gate:iron:lock'));
  return g;
}

/** The single mesh door of the wire cage. */
function meshDoor(p) {
  const w = p.w ?? 2.4, h = p.h ?? 2.4, G = [], wire = [];
  // (inside the cage's gate posts, 0.14 m clear each side; the stiles stand on the ground)
  const x0 = -w / 2 + 0.14, x1 = w / 2 - 0.14, top = h - 0.06;
  G.push(bx(x1 - x0, 0.05, 0.05, 0, top), bx(x1 - x0, 0.05, 0.05, 0, 0.1), bx(x1 - x0, 0.04, 0.04, 0, h * 0.5)); // frame rails
  G.push(bx(0.05, top + 0.02, 0.05, x0, (top + 0.02) / 2), bx(0.05, top + 0.02, 0.05, x1, (top + 0.02) / 2));     // stiles
  const d = Math.hypot(x1 - x0, h * 0.5 - 0.1), a = Math.atan2(h * 0.5 - 0.1, x1 - x0);
  G.push(new THREE.BoxGeometry(d, 0.035, 0.03).rotateZ(a).translate(0, (0.1 + h * 0.5) / 2, -0.02).toNonIndexed()); // brace
  for (const y of [0.35, top - 0.35]) G.push(rod(0.028, 0.16, x0 - 0.05, y, 0, 8)); // hinges
  G.push(bx(0.09, 0.14, 0.05, x1 - 0.12, h * 0.5 + 0.12, 0.05), rod(0.03, 0.06, x1 - 0.12, h * 0.5 - 0.02, 0.07, 8)); // hasp + padlock
  for (let x = x0 + 0.1; x < x1 - 0.02; x += 0.1) wire.push(bx(0.006, top - 0.12, 0.006, x, top / 2 + 0.05, 0.01));
  for (let y = 0.2; y < top - 0.04; y += 0.1) wire.push(bx(x1 - x0 - 0.04, 0.006, 0.006, 0, y, 0.01));
  const g = new THREE.Group(); g.name = 'gate:mesh';
  g.add(meshOf(G, dressingMaterial('castIron'), 'gate:mesh:frame'));
  const wm = meshOf(wire, dressingMaterial('castIron'), 'gate:mesh:wire'); wm.castShadow = false;
  g.add(wm);
  return g;
}

/** Procedural leaves for an iron / mesh gate variant (null for other variants). */
export function buildIronGate(p = {}) {
  if (p.variant === 'iron') return ironGate(p);
  if (p.variant === 'jail_door_mesh') return meshDoor(p);
  return null;
}
