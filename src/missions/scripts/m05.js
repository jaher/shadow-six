/**
 * BEL Mission 5 "Blind Justice": mission-local helpers (docs/missions/m05.md §4, §6.2, §9, §11, §14). Owned by MISSIONS.
 *
 *  - plateauWalkways(): the 16 m summit plateau as `walkways` strips (map-builder has no area `elev` yet). One
 *    0.5 m strip per grid row, clipped to the plateau polygon, with the footprints of the summit buildings, trees
 *    and poles cut out, so those cells keep their block (a raised cell loses its block in applyElevation).
 *  - m05Script(world, director): runtime glue, installed as `mission.script`:
 *      · the cable car moves ON DEMAND (it waits at the station it last reached; boarding starts the trip);
 *      · a second use of the calling phone hangs up (the other phone stops ringing);
 *      · the autogyro takes off (scripted climb out N) once o1 is done and every living commando is aboard;
 *      · visuals: the plateau/massif are extruded prisms, the valley a dark canopy, summit props lifted to y 16.
 *  - spawnSurvivor(): the one officer who gets out of the razed summit barracks (trigger action `run`).
 * @module missions/scripts/m05
 */

import * as THREE from 'three';
import { terrainPrism, terrainBed } from '../../art/kit-terrain.js';
import { Enemy } from '../../entities/enemy.js';

export const SUMMIT_Y = 16;
const CELL = 0.5;
const deg = (d) => (d * Math.PI) / 180;

/** Corners of an oriented w × d rectangle (rot in radians; local +X → (cos rot, sin rot)). */
export function rectPoly(x, z, w, d, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * c - b * s, z + a * s + b * c]);
}

/** Sorted x-intervals where the horizontal line z crosses the inside of `poly` (even-odd rule). */
export function polyRow(poly, z) {
  const xs = [];
  for (let k = 0; k < poly.length; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length];
    if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Subtract interval list `cut` from `keep` (both [[a,b]...]). */
function subtract(keep, cut) {
  let cur = keep;
  for (const [c0, c1] of cut) {
    const next = [];
    for (const [a, b] of cur) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    cur = next;
  }
  return cur;
}

/**
 * Walkway strips raising `poly` to height y, minus `holes` ({poly} or {x, z, r}). One strip per 0.5 m grid row;
 * a cell is raised when its centre lies inside the plateau and outside every hole (a 0.3 m margin keeps the
 * blocked rim of each building intact).
 * @returns {{points:number[][], width:number, y:number}[]}
 */
export function plateauWalkways(poly, holes, y = SUMMIT_Y) {
  const out = [];
  let maxZ = 0;
  for (const p of poly) maxZ = Math.max(maxZ, p[1]);
  for (let zc = CELL / 2; zc < maxZ; zc += CELL) {
    const cut = [];
    for (const h of holes) {
      if (h.poly) for (const [a, b] of polyRow(h.poly, zc)) cut.push([a - 0.3, b + 0.3]);
      else if (Math.abs(zc - h.z) < h.r + 0.3) { const hw = Math.sqrt(Math.max(0, (h.r + 0.3) ** 2 - (zc - h.z) ** 2)); cut.push([h.x - hw, h.x + hw]); }
    }
    for (const [a, b] of subtract(polyRow(poly, zc), cut)) {
      // raise only whole cells whose centre is inside [a, b]
      const x0 = Math.ceil(a / CELL - 0.5) * CELL + CELL / 2, x1 = Math.floor(b / CELL - 0.5) * CELL + CELL / 2;
      if (x1 < x0) continue;
      out.push({ points: [[x0 - 0.2, zc], [x1 + 0.2, zc]], width: CELL * 0.9, y });
    }
  }
  return out;
}

/** Hole shapes for a list of summit structure defs (rect/round footprints, rot in radians). */
export function holesOf(structs) {
  return structs.map((s) => (s.w != null && s.d != null ? { poly: rectPoly(s.x, s.z, s.w, s.d, s.rot ?? 0) } : { x: s.x, z: s.z, r: s.r ?? 0.5 }));
}

// ------------------------------------------------------------------ runtime

/** Trigger action: the officer who gets out of the razed summit barracks ([DE], [egg], [Kild]; dossier §9). */
export function spawnSurvivor(world, spec = {}) {
  if (world.byId?.('g3_officer')) return null;
  const e = new Enemy({
    id: 'g3_officer', soldierType: 'sergeant', x: spec.x ?? 96.5, z: spec.z ?? 47.5, y: SUMMIT_Y, heading: deg(180),
    flags: { investigates: true, followsTracks: true },
  });
  world.add(e);
  e.y = SUMMIT_Y;
  const blast = spec.investigate || [95.5, 50];
  e.brain?.reinforce?.([{ x: blast[0] - 3, z: blast[1] - 4 }], (spec.loop || []).map((p) => ({ x: p[0] ?? p.x, z: p[1] ?? p.z })));
  world.events.emit('message', { text: 'Someone made it out of the barracks!', kind: 'warn' });
  return e;
}

const isPlayer = (u) => u && (u.faction === 'player' || u.kind === 'commando');

/**
 * §6.2 on-demand cable car: one cabin, parked at whichever station it last reached (schedule delay/endWait are
 * "forever"); a commando who boarded a docked cabin starts the trip after `departIn` s (with the set-piece
 * `line` in keepAboard mode, riders who just arrived stay parked until someone boards or they get out). Stateless per tick, so it
 * also holds after a quick load (Vehicle.load does not restore waitT).
 */
export function tickCableCar(v, departIn = 2, line = null) {
  if (!v || v.destroyed || !v.track || v.track.length < 2) return;
  // keepAboard line: only a man who boarded here sends it off (riders who just arrived stay parked, §12 5A)
  const aboard = line?.freshAboard ? line.freshAboard() : v.occupants.some(isPlayer);
  if (!v.railRunning) {
    if (aboard && v.railT > departIn + 1) v.railT = departIn;
    else if (!aboard && v.railT < 1e8) v.railT = 1e9;
    return;
  }
  const docked = v.railS <= 1e-6 || v.railS >= v.trackLen - 1e-6;
  if (!docked) return;
  if (aboard) { if (!(v.waitT <= departIn + 1)) v.waitT = departIn; } else v.waitT = 1e9;
}

/** §6.2 hang-up: using the phone that is ringing the other one (or the ringing one) again stops the ringing. */
export function installPhoneHangUp(dir) {
  const ph = dir.get('phones');
  if (!ph || ph._m05HangUp) return;
  ph._m05HangUp = true;
  const ring = ph.ring.bind(ph);
  ph.ring = (id) => {
    if (ph.ringing[id] > 0) { ph.ringing[id] = 1e-4; ph.pulse[id] = 1e9; ph.say?.('You hang up.'); return; }
    ring(id);
  };
}

/**
 * §10 escape: the autogyro cannot "drive" on a raised plateau (vehicle.passableAt refuses elev > 0.3), so once
 * o1 is done and every living commando sits in it, it climbs out northwards off the map edge; `drivenOff` then
 * completes the escape objective (core/objectives vehicleLeft).
 */
export function tickAutogyro(world, v, dt) {
  if (!v || v.destroyed || v.drivenOff) return;
  const o1 = (world.objectives || []).find((o) => o.id === 'o1');
  const men = world.commandos.filter((c) => c.alive !== false && !c.removed);
  const go = v._m05Takeoff || (o1?.done && men.length && men.every((c) => c.vehicle === v && c.state === 'inVehicle'));
  if (!go) { v.y = SUMMIT_Y; return; }
  if (!v._m05Takeoff) { v._m05Takeoff = 0; world.events.emit('message', { text: 'The autogyro lifts off.', kind: 'info' }); }
  v._m05Takeoff += dt;
  v.path = null; v.goal = null;
  const sp = Math.min(14, 2 + v._m05Takeoff * 3);
  v.heading = -Math.PI / 2; // north
  v.z -= sp * dt;
  v.speed = sp;
  v.y = SUMMIT_Y + Math.min(30, v._m05Takeoff * 2.5);
  if (v.z < -6) { v.drivenOff = true; v.speed = 0; }
}

/** Mesh helpers (browser only). */
function prism(points, h, top, side) {
  // placeholder-art pass: textured summit (art/kit-terrain.js): snow-covered top on the plateau, rock elsewhere
  return terrainPrism(points, h, { top: top === 0xdfdfde ? 'snow' : 'rockDark', side: 'rock', tile: 4 });
}

/**
 * Placeholder Würzburg dish (until ART's radar_station / wurzburg_dish model lands, building-inventory M5): the
 * generic radio_mast reads as a steel pyramid at this size, so its meshes are hidden and a dish on a pedestal
 * with its operator cabin is hung under the same object (the destroyed look still burns and squashes it).
 */
export function wurzburgDish(o) {
  if (!o || o.userData.m05Dish) return;
  let lib = false;
  o.traverse((n) => { if (n.userData?.libraryAsset) lib = true; });
  if (lib) return; // the building library's Würzburg dish (art/building-props.js PLACEHOLDER_HINTS)
  o.userData.m05Dish = true;
  for (const c of o.children) c.visible = false;
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d625c, roughness: 0.6, metalness: 0.5 });
  const dishM = new THREE.MeshStandardMaterial({ color: 0x8a8f88, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.name = 'm05:wurzburg';
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 16), steel, 0, 0.2, 0); // turntable
  add(new THREE.CylinderGeometry(0.35, 0.45, 3.2, 10), steel, 0, 2, 0); // pedestal
  add(new THREE.BoxGeometry(1.6, 1.4, 1.2), steel, -0.9, 1.1, 0.9); // operator cabin
  const head = new THREE.Group();
  head.position.set(0, 3.8, 0);
  head.rotation.z = Math.PI / 5; // dish tilted up toward the sea
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 8, 0, Math.PI * 2, 0, 0.62), dishM); // shallow paraboloid-ish cap
  bowl.rotation.z = Math.PI / 2; // opens along +x
  bowl.position.x = 1.9;
  bowl.castShadow = true;
  head.add(bowl);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), steel);
  feed.rotation.z = Math.PI / 2; feed.position.x = 0.9;
  head.add(feed);
  g.add(head);
  o.add(g);
}

/** Lift the summit's props onto the plateau and add the plateau / massif / valley meshes. */
export function buildSummitVisuals(world, spec) {
  if (!world.scene || !world._spMeshes || world._m05Visuals) return;
  world._m05Visuals = true;
  const root = new THREE.Group();
  root.name = 'm05:summit';
  root.add(prism(spec.plateau, SUMMIT_Y - 0.02, 0xdfdfde, 0x6a655a));
  root.add(prism(spec.massif, SUMMIT_Y - 0.4, 0x7a7466, 0x5a564c));
  root.add(terrainBed(spec.valley, 0.04, 'rockDark')); // the deep valley floor: dark scree (was a flat colour)
  world.scene.add(root);
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const id of spec.lift || []) {
    const s = world.structures?.get(id);
    const o = s?.object3d;
    if (s?.entity) s.entity.y = SUMMIT_Y;
    if (o && !o.userData.m05Lifted) { o.userData.m05Lifted = true; o.position.y += SUMMIT_Y; }
  }
  wurzburgDish(world.structures?.get('radar')?.object3d);
}

/** mission.script(world, director): installed once after the lazy set-piece init. */
export function m05Script(spec) {
  return (world, dir) => {
    installPhoneHangUp(dir);
    buildSummitVisuals(world, spec);
    const cab = world.byId('cablecar'), gyro = world.byId('autogyro'), line = dir.get('cablecar_line');
    if (gyro) gyro.y = SUMMIT_Y;
    world.onBelTick((dt) => {
      tickCableCar(cab, 2, line);
      tickAutogyro(world, gyro, dt);
    });
  };
}
