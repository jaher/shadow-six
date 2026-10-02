/**
 * Placeholder-art pass, vehicles the realistic vehicle library has no model for (the audit
 * tools/audit/placeholder-audit.mjs listed them as plain boxes; user: "extremely realistic and faithful"):
 *   - `cable_car` (M5): a 1930s aerial-tramway cabin — red painted steel panels with a cream belt line and eave,
 *     glazed all round between slim posts, sliding door, rubbing strip, roof with snow in winter, the stirrup
 *     hanger up to the wheeled carriage that runs on two track ropes, the haul rope clamped to it. The ropes are
 *     drawn from station to station (static, in the cabin's parent) and end on a steel saddle portal behind each
 *     berth, guyed to a ground anchor. The carriage pitches with the ropes; the cabin hangs level and swings a
 *     little when it starts and stops.
 *   - `atgunM20` / `atgun` (M20): a 7.5 cm PaK 40 style anti-tank gun — spaced, angled double shield, long barrel
 *     with its double-baffle muzzle brake, recoil cylinders, split trails with spades, steel disc wheels on
 *     rubber tyres, field-grey paint. Its own sandbag walls are mission structures (no pit ring here).
 * Same model contract as entities/vehicle.js placeholders (root, turret, dims, gun, update, setTurretHeading,
 * setGunLift, setDestroyed, dispose); `kit: true` marks them. Plain colours in node (unit tests).
 * @module art/kit-vehicles
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { windowGlass } from './kit-buildings.js';

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box with world-scale UVs centred at (x, y, z). */
function tbox(w, h, d, mat, x = 0, y = 0, z = 0, tile = 1) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}
/** Cylinder along `axis` ('x' | 'y' | 'z') centred at (x, y, z), world-scale UVs. */
function tcyl(r0, r1, len, mat, x, y, z, axis = 'y', seg = 14, tile = 1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  const uv = g.attributes.uv, k = (2 * Math.PI * Math.max(r0, r1)) / tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * (len / tile));
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  const m = mesh(g, mat); m.position.set(x, y, z);
  return m;
}
/** Strut (box section `t`) from a to b. */
function strut(a, b, t, mat, t2 = t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mesh(boxUV(new THREE.BoxGeometry(t, L, t2).toNonIndexed(), 0.8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
/** Rope (thin round cable) from a to b. */
function rope(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mesh(new THREE.CylinderGeometry(r, r, L, 6, 1, true), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
/** Rounded-rectangle plan (x across, y = −z along) for extruded cabin bands. */
function roundRect(w, l, r) {
  const s = new THREE.Shape(), a = w / 2, b = l / 2;
  s.moveTo(-a + r, -b); s.lineTo(a - r, -b); s.quadraticCurveTo(a, -b, a, -b + r);
  s.lineTo(a, b - r); s.quadraticCurveTo(a, b, a - r, b); s.lineTo(-a + r, b);
  s.quadraticCurveTo(-a, b, -a, b - r); s.lineTo(-a, -b + r); s.quadraticCurveTo(-a, -b, -a + r, -b);
  return s;
}
/** Horizontal band of the rounded plan from y0 to y1 (world-scale tri-planar UVs). */
function band(w, l, r, y0, y1, mat, tile = 1) {
  const g = new THREE.ExtrudeGeometry(roundRect(w, l, r), { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); // shape plane → xz, extrusion up
  const geo = boxUV(g.index ? g.toNonIndexed() : g, tile);
  const m = mesh(geo, mat); m.position.y = y0;
  return m;
}

// ------------------------------------------------------------------------------------------ cable car

const CABIN = { w: 2.05, l: 2.9, r: 0.28, floor: 0.16, belt: 1.0, sill: 1.08, head: 1.95, eave: 2.2, roof: 2.34 };
/** Rope heights above the cabin floor: the track ropes under the carriage wheels, the haul rope below them. */
export const CABLE_CAR_ROPES = { track: 3.96, haul: 3.72, gauge: 0.32, portal: 2.4 };

function cabinMaterials(theater) {
  return {
    red: paintedMaterial('steel', 0x8a2a20), cream: paintedMaterial('steel', 0xd6cbb0), dark: paintedMaterial('steel', 0x2c2e2c),
    roof: dressingMaterial('galv'), iron: dressingMaterial('castIron'), glass: windowGlass(), rubber: paintedMaterial('steel', 0x1b1b1a),
    snow: theater === 'snow' ? dressingMaterial('snow') : null,
  };
}

/** The hanging cabin (floor at y 0, length along local z). @returns {THREE.Group} */
export function buildCableCabin(theater = 'temperate') {
  const M = cabinMaterials(theater), C = CABIN, g = new THREE.Group(); g.name = 'kit:cable_cabin';
  // steel underframe: two longitudinal channels and cross members, then the panelled body
  for (const sx of [-0.7, 0.7]) g.add(tbox(0.12, 0.14, C.l - 0.3, M.dark, sx, 0.07, 0));
  for (const z of [-1.1, 0, 1.1]) g.add(tbox(C.w - 0.4, 0.1, 0.1, M.dark, 0, 0.09, z));
  g.add(band(C.w, C.l, C.r, C.floor - 0.02, C.belt, M.red, 1.2));
  g.add(band(C.w + 0.03, C.l + 0.03, C.r + 0.015, C.belt, C.sill, M.cream, 1.2));            // belt line
  g.add(band(C.w + 0.05, C.l + 0.05, C.r + 0.02, 0.48, 0.55, M.dark, 1.2));                   // rubbing strip
  g.add(band(C.w - 0.08, C.l - 0.08, C.r - 0.04, C.sill, C.head, M.glass, 1));                 // glazing (inset)
  g.add(band(C.w, C.l, C.r, C.head, C.eave, M.cream, 1.2));                                    // eave band
  g.add(band(C.w + 0.08, C.l + 0.08, C.r + 0.04, C.eave, C.eave + 0.05, M.red, 1.2));          // drip rail
  const roof = new THREE.ExtrudeGeometry(roundRect(C.w + 0.02, C.l + 0.02, C.r), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 4 });
  roof.rotateX(-Math.PI / 2);
  const rm = mesh(boxUV(roof.index ? roof.toNonIndexed() : roof, 1.2), M.roof); rm.position.y = C.eave + 0.08; g.add(rm);
  if (M.snow) { const s = band(C.w - 0.3, C.l - 0.35, C.r * 0.6, C.roof - 0.02, C.roof + 0.07, M.snow, 1); g.add(s); }
  // window posts and mullions (red), panel seams on the lower body, corner posts
  const posts = [];
  const sideZ = (C.l / 2 - C.r) * 0.98, endX = (C.w / 2 - C.r) * 0.98;
  for (const z of [-sideZ, -sideZ / 3, sideZ / 3, sideZ]) for (const sx of [-1, 1]) posts.push([sx * (C.w / 2 - 0.01), z, 'x']);
  for (const x of [-endX, 0, endX]) for (const sz of [-1, 1]) posts.push([x, sz * (C.l / 2 - 0.01), 'z']);
  for (const [x, z, n] of posts) g.add(tbox(n === 'x' ? 0.07 : 0.08, C.head - C.sill, n === 'x' ? 0.08 : 0.07, M.red, x, (C.sill + C.head) / 2, z));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = Math.atan2(sz, sx), cx = sx * (C.w / 2 - C.r) + Math.cos(a) * C.r * 0.97, cz = sz * (C.l / 2 - C.r) + Math.sin(a) * C.r * 0.97;
    g.add(tbox(0.1, C.head - C.sill, 0.1, M.red, cx, (C.sill + C.head) / 2, cz));
  }
  for (const z of [-sideZ / 1.5, 0, sideZ / 1.5]) for (const sx of [-1, 1]) g.add(tbox(0.012, C.belt - 0.3, 0.025, M.dark, sx * (C.w / 2 + 0.003), (C.belt + 0.3) / 2 + 0.05, z));
  // sliding door on the +x side: frame strips, handle, the door track along the eave
  for (const z of [-0.45, 0.45]) g.add(tbox(0.03, C.head - 0.2, 0.05, M.dark, C.w / 2 + 0.01, (C.head + 0.2) / 2, z));
  g.add(tbox(0.03, 0.04, 0.95, M.dark, C.w / 2 + 0.01, 0.22, 0));
  g.add(tbox(0.05, 0.05, 1.9, M.iron, C.w / 2 + 0.03, C.head + 0.04, -0.45));
  g.add(tbox(0.05, 0.22, 0.04, M.iron, C.w / 2 + 0.05, 1.15, 0.38));
  // headlamp / signal lamp on both ends and a small grab rail
  for (const sz of [-1, 1]) {
    g.add(tcyl(0.07, 0.07, 0.08, M.dark, 0, C.eave - 0.12, sz * (C.l / 2 + 0.04), 'z', 10));
    g.add(tbox(0.6, 0.03, 0.03, M.iron, 0, C.belt - 0.15, sz * (C.l / 2 + 0.05)));
  }
  // roof: the hanger's transverse saddle beams
  for (const z of [-0.55, 0.55]) g.add(tbox(C.w - 0.25, 0.12, 0.14, M.dark, 0, C.roof + 0.03, z));
  return consolidate(g);
}

/** Stirrup hanger from the roof saddle to the pivot (y), and the carriage on its own group (pivot at origin). */
function buildHanger(M) {
  const C = CABIN, g = new THREE.Group(), y0 = C.roof + 0.08, py = 3.3;
  for (const z of [-0.55, 0.55]) for (const sx of [-1, 1]) g.add(strut([sx * 0.55, y0, z], [sx * 0.08, py, 0], 0.07, M.dark, 0.05));
  g.add(tbox(0.25, 0.25, 0.25, M.dark, 0, py, 0));
  g.add(tcyl(0.08, 0.08, 0.36, M.iron, 0, py, 0, 'x', 10));                                   // pivot pin
  return consolidate(g);
}
function buildCarriage(M) {
  const R = CABLE_CAR_ROPES, g = new THREE.Group(), pv = 3.3, wr = 0.16, wy = R.track + wr - pv;
  g.add(strut([0, 0, 0], [0, wy - 0.1, 0], 0.12, M.dark, 0.18));                               // drop arm
  g.add(tbox(0.9, 0.14, 2.5, M.dark, 0, wy - 0.12, 0));                                        // balance beam
  for (const sx of [-1, 1]) {
    g.add(tbox(0.05, 0.24, 2.1, M.dark, sx * (R.gauge + 0.1), wy, 0));                          // side plates
    for (const z of [-0.85, -0.35, 0.35, 0.85]) g.add(tcyl(wr, wr, 0.07, M.iron, sx * R.gauge, wy, z, 'x', 14));
  }
  g.add(tbox(0.2, 0.2, 0.36, M.iron, 0, R.haul - pv, 1.05));                                   // haul-rope clamps
  g.add(tbox(0.2, 0.2, 0.36, M.iron, 0, R.haul - pv, -1.05));
  for (const z of [-1.05, 1.05]) g.add(strut([0, R.haul - pv, z], [0, wy - 0.12, z * 0.8], 0.06, M.dark));
  return consolidate(g);
}

/** Rope saddle portal: two steel posts from the ground to the ropes, cross head with the rope shoes and the haul sheave. */
function buildPortal(M, top, ground) {
  const R = CABLE_CAR_ROPES, g = new THREE.Group(), h = top - ground;
  for (const sx of [-1, 1]) {
    g.add(strut([sx * 1.3, ground, 0], [sx * 0.9, top + 0.15, 0], 0.18, M.dark, 0.14));
    g.add(strut([sx * 1.3, ground, 0], [sx * 0.95, ground + h * 0.6, 0.0], 0.06, M.dark));
    g.add(tbox(0.5, 0.25, 0.5, dressingMaterial('concrete'), sx * 1.3, ground + 0.1, 0));       // footing
    for (let y = ground + 0.9; y < top - 0.4; y += 1.1) g.add(strut([-1.25, y, 0], [1.25, y + 0.9, 0], 0.05, M.dark));
  }
  g.add(tbox(2.3, 0.22, 0.32, M.dark, 0, top + 0.12, 0));                                      // cross head
  for (const sx of [-1, 1]) g.add(tbox(0.16, 0.12, 0.7, M.iron, sx * R.gauge, top + 0.28, 0)); // rope shoes
  g.add(tcyl(0.32, 0.32, 0.08, M.iron, 0, top - 0.02, 0, 'x', 16));                            // haul sheave
  return g;
}

/**
 * The static rope span + portals for a cable-car vehicle (world coordinates).
 * @param {{x:number,z:number,y:number}[]} track the vehicle's two track points (cabin floor heights)
 * @param {(x:number, z:number) => number} ground ground height
 */
export function buildCableLine(track, ground, theater = 'temperate') {
  const M = cabinMaterials(theater), R = CABLE_CAR_ROPES, g = new THREE.Group(); g.name = 'kit:cable_line';
  const [a, b] = [track[0], track[track.length - 1]];
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, px = -uz, pz = ux;
  const slope = ((b.y ?? 0) - (a.y ?? 0)) / L, E = R.portal;
  const at = (s, h) => [a.x + ux * s, (a.y ?? 0) + slope * s + h, a.z + uz * s]; // rope point s m along the line, h above the floor line
  const ends = [-E, L + E];
  for (const sx of [-1, 1]) {
    const A = at(ends[0], R.track), B = at(ends[1], R.track);
    g.add(rope([A[0] + px * sx * R.gauge, A[1], A[2] + pz * sx * R.gauge], [B[0] + px * sx * R.gauge, B[1], B[2] + pz * sx * R.gauge], 0.028, M.iron));
  }
  g.add(rope(at(ends[0], R.haul), at(ends[1], R.haul), 0.02, M.iron));
  for (const [k, s] of ends.entries()) {
    const [x, y, z] = at(s, R.track), gy = ground(x, z);
    const p = buildPortal(M, y - 0.08, Math.min(gy, y - 1));
    p.position.set(x, 0, z); p.rotation.y = Math.atan2(ux, uz) + Math.PI / 2; // local x across the line
    g.add(p);
    // guy stays down to a ground anchor behind the portal
    const out = k === 0 ? -1 : 1, ax = x + ux * out * 3.2, az = z + uz * out * 3.2, ag = ground(ax, az);
    for (const sx of [-1, 1]) g.add(rope([x + px * sx * R.gauge, y, z + pz * sx * R.gauge], [ax + px * sx * 0.5, ag + 0.3, az + pz * sx * 0.5], 0.022, M.iron));
    const blk = tbox(1.6, 0.6, 0.8, dressingMaterial('concrete'), ax, ag + 0.2, az, 1); blk.rotation.y = Math.atan2(ux, uz) + Math.PI / 2;
    g.add(blk);
  }
  return consolidate(g);
}

/** Entity model for a `cable_car` rail vehicle. */
export function createCableCarModel(type = 'cable_car', def = {}, spawn = {}, theater = 'temperate') {
  const M = cabinMaterials(theater);
  const root = new THREE.Group(); root.name = `vehicle:${type}`;
  const swing = new THREE.Group(); swing.position.y = 3.3; root.add(swing); // pendulum about the hanger pivot
  const hang = new THREE.Group(); hang.position.y = -3.3; swing.add(hang);
  hang.add(buildCableCabin(theater), buildHanger(M));
  const carriage = buildCarriage(M); carriage.position.y = 3.3; root.add(carriage);
  const track = spawn.track || [];
  let line = null, th = 0, om = 0, lastV = 0, destroyed = false;
  root.traverse((o) => { if (o.isMesh) o.userData.mat0 = o.material; });
  return {
    root, turret: null, gun: null, kit: true,
    dims: { w: CABIN.w, l: CABIN.l, h: CABIN.roof },
    update(dt, v) {
      if (!line && track.length >= 2 && root.parent) {
        const w = v?.world, gy = (x, z) => (w?.groundY ? w.groundY(x, z) : 0) + (w?.grid?.elevAt?.(x, z) || 0);
        line = buildCableLine(track, gy, theater);
        root.parent.add(line);
      }
      if (!v || !(dt > 0)) return;
      // carriage pitch along the ropes (the cabin's +z faces uphill or down depending on the trip)
      const a = track[0], b = track[track.length - 1];
      if (a && b && a.y != null && b.y != null) {
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, s = Math.atan((b.y - a.y) / L);
        const up = Math.cos(v.heading) * (b.x - a.x) + Math.sin(v.heading) * (b.z - a.z) >= 0;
        carriage.rotation.x = up ? -s : s;
      }
      // pendulum: the cabin swings back when it pulls away and forward when it stops
      const sp = Math.abs(v.speed ?? 0), acc = (sp - lastV) / dt; lastV = sp;
      om += (-9.81 / 3.0 * Math.sin(th) - 0.9 * om - acc / 3.0) * dt;
      th = Math.max(-0.25, Math.min(0.25, th + om * dt));
      swing.rotation.x = destroyed ? 0 : -th;
    },
    setTurretHeading() {}, setGunLift() {},
    setDestroyed(on) { destroyed = !!on; root.traverse((o) => { if (o.isMesh) o.material = on ? M.dark : o.userData.mat0; }); },
    dispose() {
      root.traverse((o) => o.geometry?.dispose?.());
      if (line) { line.removeFromParent(); line.traverse((o) => o.geometry?.dispose?.()); line = null; }
    },
  };
}

// ------------------------------------------------------------------------------------------ anti-tank gun

/** 7.5 cm PaK 40 style gun; turret = traversing upper carriage, cradle = elevating mass (barrel along +z). */
export function createAtGunModel(type = 'atgunM20', def = {}) {
  const paint = paintedMaterial('steel', 0x5b5f55), dark = paintedMaterial('steel', 0x2e302d), iron = dressingMaterial('castIron');
  const tyre = paintedMaterial('steel', 0x1c1c1b), spade = paintedMaterial('steel', 0x4a4d45);
  const [l, w] = def.size || [3, 2];
  const root = new THREE.Group(); root.name = `vehicle:${type}`;
  // lower carriage: axle, wheels, split trails with spades (fixed to the ground)
  const lower = new THREE.Group();
  lower.add(tbox(1.5, 0.14, 0.18, paint, 0, 0.42, 0.05));
  for (const sx of [-1, 1]) {
    lower.add(tcyl(0.4, 0.4, 0.17, tyre, sx * 0.86, 0.4, 0.05, 'x', 18));                        // rubber tyre
    lower.add(tcyl(0.31, 0.31, 0.19, paint, sx * 0.86, 0.4, 0.05, 'x', 16));                      // disc wheel
    lower.add(tcyl(0.09, 0.09, 0.22, dark, sx * 0.86, 0.4, 0.05, 'x', 10));                       // hub
    const tr = strut([sx * 0.3, 0.45, -0.1], [sx * 1.15, 0.12, -2.4], 0.14, paint, 0.2); lower.add(tr);
    lower.add(tbox(0.42, 0.34, 0.06, spade, sx * 1.17, 0.1, -2.45));                               // spade
    lower.add(tbox(0.05, 0.05, 0.5, iron, sx * 1.12, 0.3, -2.15));                                 // handspike stowage
  }
  root.add(consolidate(lower));
  const turret = new THREE.Group(); turret.position.y = 0.55; root.add(turret);
  const upper = new THREE.Group();
  upper.add(tbox(0.7, 0.24, 1.0, paint, 0, 0.1, 0.05));                                          // upper carriage
  upper.add(tbox(0.12, 0.42, 0.5, paint, -0.3, 0.42, 0.05)); upper.add(tbox(0.12, 0.42, 0.5, paint, 0.3, 0.42, 0.05)); // trunnion brackets
  // spaced double shield, angled back, with the sight window notch and the lower apron
  for (const [dz, dy] of [[0.42, 0], [0.5, 0.04]]) {
    for (const sx of [-1, 1]) {
      const p = tbox(0.95, 0.95, 0.025, dz > 0.45 ? paint : dark, sx * 0.53, 0.75 + dy, dz, 0.8);
      p.rotation.set(-0.32, sx * -0.22, 0); upper.add(p);
    }
  }
  upper.add(tbox(2.0, 0.3, 0.025, paint, 0, 0.08, 0.6, 0.8));                                    // apron
  upper.add(tbox(0.12, 0.08, 0.3, iron, -0.42, 0.92, 0.0));                                       // sight
  upper.add(tbox(0.18, 0.4, 0.18, dark, 0.48, 0.28, -0.2));                                       // elevating handwheel box
  upper.add(tcyl(0.12, 0.12, 0.03, iron, 0.6, 0.4, -0.2, 'x', 12));
  turret.add(consolidate(upper));
  const cradle = new THREE.Group(); cradle.position.y = 0.55; turret.add(cradle);
  const gun = new THREE.Group();
  gun.add(tbox(0.3, 0.26, 1.4, paint, 0, 0, 0.05));                                              // cradle / breech ring
  gun.add(tbox(0.36, 0.34, 0.42, dark, 0, 0, -0.75));                                             // breech block
  gun.add(tcyl(0.07, 0.07, 1.6, paint, 0, 0.19, 0.3, 'z', 10));                                   // recoil cylinders
  gun.add(tcyl(0.06, 0.06, 1.3, paint, 0, -0.17, 0.2, 'z', 10));
  gun.add(tcyl(0.06, 0.085, 3.2, paint, 0, 0, 2.3, 'z', 14));                                     // barrel
  gun.add(tcyl(0.11, 0.11, 0.38, dark, 0, 0, 4.0, 'z', 14));                                      // muzzle brake body
  for (const z of [3.88, 4.12]) gun.add(tbox(0.3, 0.2, 0.05, dark, 0, 0, z));                     // baffles
  cradle.add(consolidate(gun));
  const mats = [paint, dark, iron, tyre, spade];
  root.traverse((o) => { if (o.isMesh) o.userData.mat0 = o.material; });
  return {
    root, turret, kit: true, dims: { w, l, h: 1.6 },
    gun: { len: 4.0, h: 1.1 },
    update() {},
    setTurretHeading(r) { turret.rotation.y = -r; },
    setGunLift(a) { cradle.rotation.x = -0.03 - (Number.isFinite(a) ? a : 0); },
    setDestroyed(on) { root.traverse((o) => { if (o.isMesh) o.material = on ? dark : o.userData.mat0; }); if (on) cradle.rotation.x = 0.14; },
    dispose() { root.traverse((o) => o.geometry?.dispose?.()); void mats; },
  };
}

/** Registry type → kit model factory (types the vehicle library has no model for). */
export const KIT_VEHICLES = Object.freeze({
  cable_car: createCableCarModel,
  atgunM20: createAtGunModel,
  atgun: createAtGunModel,
});

/** Kit model for a vehicle type, or null. */
export function createKitVehicleModel(type, def = {}, spawn = {}, theater = 'temperate') {
  const f = KIT_VEHICLES[type] || KIT_VEHICLES[def.type];
  return f ? f(type, def, spawn, theater) : null;
}
