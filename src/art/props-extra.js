/**
 * PLACEHOLDER builders for the design-spec §7.7 prop types needed by BEL missions 4-20 (villa, rail_bridge,
 * lock_gate, v2_rocket …). Same contract as art/props.js `buildProp(type, params, ctx)` →
 * {object3d, footprints, castsShadow, interactables}: correct footprints (blocks, water, bridge decks, walkable
 * roofs via `elev`), doors (`enterable` handled by the map builder) and demolition anchors. The ART integration
 * swaps the meshes for the building library; footprints and anchors stay.
 * Registered into the prop catalogue (PROP_TYPES / PROP_DEFAULTS) on import; world/map-builder.js dispatches
 * these types here (`isExtraProp`). Owned by MISSIONS until ART takes it over.
 *
 * Extra params: `targetAt: 'bow'|'stern'|'steps'|'front'|[lx, lz]` puts the explosiveTarget (params.destructible)
 * on that local anchor (U-boat stern charge point M7, battleship bow M13, villa steps M4); `roofWalk: false`
 * turns a walkable roof off; `open: 'N'|'S'|'E'|'W'` = the open side of pens/sheds (local −z = 'N' at rot 0).
 * @module art/props-extra
 */

import { buildWarship } from './warship.js';
import * as THREE from 'three';
import { getMaterial } from './materials.js';
import { B, T } from '../world/grid.js';
import { PROP_TYPES, PROP_DEFAULTS, LINEAR_PROPS } from './props.js';
import { buildAccessPlatform, accessPlatformFootprints } from './access-platform.js';
import { makeFlag } from './flags.js';
import { libraryVisual, libraryHinted } from './building-props.js';
import { buildKitHouse, buildKitTower, buildKitShed, buildLighthouseTower, buildV2Rocket, buildFiringTable, buildMineHeadframe, buildConveyor } from './kit-buildings.js';
import { dressingMaterial } from './dressing.js';
import { buildGorge, buildRailBridge } from './kit-terrain.js';
import { kitify } from './kit-materials.js';
import { buildDetonator, buildLeverBox, paintedMaterial } from './kit-props.js';

/**
 * Placeholder-art pass: textured kit models (art/kit-buildings.js, art/kit-props.js) instead of the primitive boxes,
 * on the same box / footprints (walkable roofs stay at `roofY ?? h`). null → the primitive placeholder.
 */
function kitExtraMesh(type, p, ctx) {
  if (ctx.library === false || ctx.dressing === false) return null;
  const th = ctx.theater || 'temperate';
  switch (type) {
    case 'flat_roof_house': return buildKitHouse(p, th);
    case 'villa': return buildKitHouse({ ...p, roofWalk: false }, th);
    case 'mosque': return buildKitHouse({ ...p, dome: true }, th);
    case 'mine_building': if (/adit|head/.test(String(p.variant || ''))) return buildMineHeadframe(p, th);
    // falls through
    case 'cable_car_station': case 'control_shack': case 'watermill':
      return buildKitHouse({ ...p, roofWalk: p.roofWalk ?? false }, th);
    case 'minaret': return buildKitTower(p, th);
    case 'lighthouse': return buildLighthouseTower(p);
    case 'v2_rocket': return /lying|meiller/.test(String(p.variant || '')) ? null : buildV2Rocket(p);
    case 'launch_pad': return /table|firing/.test(String(p.variant || '')) ? buildFiringTable(p) : null;
    case 'conveyor': return buildConveyor(p);
    case 'ravine': return buildGorge(p);
    case 'rail_bridge': return buildRailBridge(p);
    case 'garage': case 'tank_shed': return buildKitShed(p, th);
    case 'battleship': return p.variant === 'uboat_docked' ? null : buildWarship(p); // art/warship.js (detailed Bismarck class)
    case 'detonator': return buildDetonator(p);
    case 'lever': case 'fuel_valve': return buildLeverBox(p);
    default: return null;
  }
}

const H = B.HIGH, L = B.LOW;
/** type → defaults: w, d, h (m), r (round), block, mat, roof, kind ('box'|'round'|'linear'|'area'|custom). */
export const EXTRA_PROP_DEFAULTS = {
  villa: { w: 16, d: 12, h: 8, block: H, mat: 'plaster', roof: 'roofTile', roofWalk: false, steps: true },
  flat_roof_house: { w: 8, d: 8, h: 4, block: H, mat: 'plaster', roofWalk: true },
  mosque: { w: 14, d: 14, h: 7, block: H, mat: 'plaster', dome: true, roofWalk: true },
  minaret: { r: 1.6, h: 18, block: H, mat: 'plaster', kind: 'round' },
  lighthouse: { r: 2.5, h: 16, block: H, mat: 'plaster', kind: 'round' },
  cable_car_station: { w: 6, d: 5, h: 4, block: H, mat: 'concrete', roof: 'roofTin' },
  cable_pylon: { r: 0.6, h: 14, block: H, mat: 'metal', kind: 'round' },
  telephone: { w: 0.4, d: 0.3, h: 1.6, block: 0, mat: 'woodDark' },
  railway_gun: { w: 24, d: 4, h: 4.5, block: H, mat: 'olivePaint', bombOnly: true },
  uboat_pen: { w: 30, d: 22, h: 9, block: H, mat: 'concrete', kind: 'pen', open: 'S' },
  drilling_rig: { w: 6, d: 6, h: 18, block: H, mat: 'metalRust' },
  battleship: { w: 120, d: 18, h: 12, block: H, mat: 'greyPaint', targetAt: 'bow' },
  lock_gate: { w: 14, d: 1.4, h: 4, block: 0, mat: 'woodDark' }, // cells: set-piece lock_gate
  control_shack: { w: 3, d: 3, h: 2.6, block: H, mat: 'planks', roof: 'roofTar' },
  casemate_gun: { w: 10, d: 8, h: 3.5, block: H, mat: 'concrete', bunker: true, bombOnly: true },
  tram_track: { width: 2.2, h: 0, block: 0, kind: 'linear' },
  sea_wall: { width: 1.6, h: 3, block: H, mat: 'concrete', kind: 'linear' },
  castle_wall: { width: 3, h: 8, block: H, mat: 'stone', kind: 'linear' },
  cemetery: { w: 20, d: 16, h: 1.1, block: L, mat: 'stone', kind: 'pen', open: 'S' },
  truss_bridge: { w: 60, d: 8, h: 8, mat: 'metal', kind: 'deck' },
  rail_bridge: { w: 40, d: 4, h: 6, mat: 'woodDark', kind: 'deck', trestle: true },
  mobile_bridge: { w: 10, d: 4, h: 0.4, block: 0, mat: 'metal' }, // cells: set-piece mobile_bridge
  detonator: { w: 0.6, d: 0.4, h: 0.6, block: 0, mat: 'woodDark' },
  lever: { w: 0.3, d: 0.3, h: 1.3, block: 0, mat: 'metal' },
  fuel_valve: { w: 0.8, d: 0.5, h: 1.2, block: 0, mat: 'metalRust' },
  watermill: { w: 8, d: 8, h: 6, block: H, mat: 'stone', roof: 'roofTile', wheel: true },
  mill: { alias: 'watermill' },
  v2_rocket: { r: 1, h: 14, block: H, mat: 'greyPaint', kind: 'round' },
  launch_pad: { w: 8, d: 8, h: 0.4, block: 0, mat: 'concrete' },
  conveyor: { w: 20, d: 1.6, h: 1, block: 0, mat: 'metal' },
  mine_building: { w: 12, d: 10, h: 8, block: H, mat: 'brick', roof: 'roofTin' },
  castle_gate: { w: 8, d: 6, h: 9, block: H, mat: 'stone', gate: true },
  moat: { w: 20, d: 6, kind: 'water' },
  ravine: { w: 20, d: 6, kind: 'gap' },
  firing_range: { w: 20, d: 10, h: 1.2, block: L, mat: 'dirt', kind: 'range' },
  water_gate: { w: 4, d: 1, h: 3, block: 0, mat: 'metalRust' }, // cells: set-piece gate_control
  flak: { r: 2.2, h: 1, block: L, mat: 'sandbag', kind: 'round', gun: true },
  prison_pen: { w: 10, d: 8, h: 2.4, block: B.FENCE, mat: 'wire', kind: 'pen', open: null, gateSide: 'S' },
  tank_shed: { w: 18, d: 10, h: 5, block: H, mat: 'planks', kind: 'pen', open: 'S', roofed: true },
  garage: { w: 8, d: 7, h: 4, block: H, mat: 'brick', kind: 'pen', open: 'S', roofed: true },
  mine: { w: 0.5, d: 0.5, h: 0, block: 0, hidden: true }, // invisible mine marker (logic: set-piece minefield)
  // M7: the conning tower of a moored Type VII (B.HIGH; the hull itself is `battleship` variant `uboat_docked`)
  uboat_tower: { w: 5, d: 2.4, h: 4, block: H, mat: 'greyPaint', kind: 'uboatTower' },
  // M2: timber access platform + stair inside the river wall (art/access-platform.js): walkable deck, graded stair
  timber_platform: { w: 2.2, d: 1.4, h: 2.2, block: 0, mat: 'planks', kind: 'platform' },
};

export const EXTRA_PROP_TYPES = Object.keys(EXTRA_PROP_DEFAULTS);
const resolve = (t) => (EXTRA_PROP_DEFAULTS[t]?.alias ? EXTRA_PROP_DEFAULTS[t].alias : t);
export const isExtraProp = (t) => !!EXTRA_PROP_DEFAULTS[t];
/** A walkable platform (deck + stair men climb onto: `timber_platform`): never a body-clearance solid. */
export const isPlatformProp = (t) => EXTRA_PROP_DEFAULTS[t]?.kind === 'platform';

// catalogue registration (backwards compatible: props.js logic untouched)
for (const t of EXTRA_PROP_TYPES) {
  if (!PROP_TYPES.includes(t)) PROP_TYPES.push(t);
  // props.js's generic fallback (a box with a rect footprint) must work too: give it plain w/d/h/mat
  const D = EXTRA_PROP_DEFAULTS[resolve(t)];
  if (!PROP_DEFAULTS[t]) PROP_DEFAULTS[t] = { w: D.w ?? (D.r ? 2 * D.r : 2), d: D.d ?? (D.r ? 2 * D.r : 2), h: D.h || 1, width: D.width, block: D.block ?? 0, mat: D.mat || 'concrete' };
  if ((EXTRA_PROP_DEFAULTS[resolve(t)].kind === 'linear') && !LINEAR_PROPS.includes(t)) LINEAR_PROPS.push(t);
}

// ------------------------------------------------------------------ mesh helpers
function box(w, h, d, mat, y = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(h, 0.02), d), getMaterial(mat));
  m.position.y = y;
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(rT, rB, h, mat, y = h / 2, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg), getMaterial(mat));
  m.position.y = y;
  m.castShadow = m.receiveShadow = true;
  return m;
}
function placed(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = -rot;
  return g;
}
/** Local (lx, lz) → world, same convention as props.js (local +X = heading, local +Z = heading + 90°). */
export function localToWorld(x, z, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + lx * c - lz * s, z + lx * s + lz * c];
}
const rectFp = (x, z, w, d, rot, extra) => ({ shape: 'rect', x, z, w, d, rot, ...extra });
const SIDE = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Local anchor for `targetAt`. */
function anchor(p, name) {
  if (Array.isArray(name)) return name;
  switch (name) {
    case 'bow': return [p.w / 2 - Math.min(8, p.w * 0.1), 0];
    case 'stern': return [-p.w / 2 + Math.min(3, p.w * 0.1), 0];
    case 'steps': case 'front': return [0, (p.d ?? p.r * 2) / 2 + 1];
    default: return [0, 0];
  }
}

// ------------------------------------------------------------------ builders
/** Linear extras (tram_track, sea_wall, castle_wall): mesh per segment + a line footprint. */
function buildLinearExtra(type, p, ctx = {}) {
  const pts = (p.points || [[p.x ?? 0, p.z ?? 0], [(p.x ?? 0) + (p.w ?? 10), p.z ?? 0]]).map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  const width = p.width, root = new THREE.Group();
  // a hinted library wall section (e.g. sea_wall `at_wall_segment`, 8 m) is tiled along each run, front (+z) to the
  // run's right-hand side; the placeholder box stays where the library is off or the asset is missing
  const tile = ctx.library !== false && libraryHinted(type, p);
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const rot = Math.atan2(bz - az, bx - ax);
    if (tile && tileRun(root, type, p, ctx, ax, az, bx, bz, len, rot)) continue;
    const seg = placed((ax + bx) / 2, (az + bz) / 2, rot);
    if (type === 'tram_track') {
      for (const s of [-0.72, 0.72]) { const r = box(len, 0.05, 0.08, 'rail', 0.02); r.position.z = s; seg.add(r); }
    } else {
      seg.add(box(len + width, p.h, width, p.mat));
      if (type === 'castle_wall') for (let q = -len / 2 + 1; q < len / 2; q += 2) { const c = box(0.9, 0.8, width + 0.1, p.mat, p.h + 0.4); c.position.x = q; seg.add(c); }
    }
    root.add(seg);
  }
  const footprints = [];
  if (p.block) footprints.push({ shape: 'line', points: pts, width: Math.max(width, 0.5), block: p.block });
  if (type === 'tram_track') footprints.push({ shape: 'line', points: pts, width, terrain: T.ROAD });
  if (ctx.library !== false && ctx.dressing !== false) kitify(root); // placeholder-art pass: textured finishes
  return { object3d: root, footprints, castsShadow: type !== 'tram_track' };
}

/** Tile a run a→b with library sections of ~`tileLen` m (scaled to fit exactly); false → caller builds the box. */
function tileRun(root, type, p, ctx, ax, az, bx, bz, len, rot) {
  const L0 = p.tileLen ?? 8, n = Math.max(1, Math.round(len / L0)), l = len / n, parts = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const v = libraryVisual(type, { ...p, id: `${p.id ?? type}#${parts.length}`, x: ax + (bx - ax) * t, z: az + (bz - az) * t, rot, w: l, d: p.width, points: undefined }, ctx);
    if (!v) { for (const q of parts) q.dispose(); return false; }
    parts.push(v);
  }
  for (const v of parts) root.add(v.object3d);
  return true;
}

/** Plan outline of a Type VII hull (local +x = bow): pointed bow, rounded stern, saddle tanks amidships. */
function hullShape(L, B) {
  const s = new THREE.Shape();
  s.moveTo(L, 0);
  s.quadraticCurveTo(L - 6, B * 0.55, L - 16, B * 0.95);
  s.lineTo(-L + 18, B);
  s.quadraticCurveTo(-L + 4, B * 0.7, -L, B * 0.12);
  s.lineTo(-L, -B * 0.12);
  s.quadraticCurveTo(-L + 4, -B * 0.7, -L + 18, -B);
  s.lineTo(L - 16, -B * 0.95);
  s.quadraticCurveTo(L - 6, -B * 0.55, L, 0);
  return s;
}
/** Flat slab of `shape` (plan, local x/z) from y0 to y1. */
function slab(shape, y0, y1, mat) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(Math.PI / 2); // shape y → world z (extrusion runs down: top at y 0)
  const m = new THREE.Mesh(geo, getMaterial(mat));
  m.position.y = y1;
  m.castShadow = m.receiveShadow = true;
  return m;
}
/**
 * Battleship (M13 replica; placeholder-art pass: was a grey box with two blocks): a clipper-bowed hull with sheer,
 * a planked main deck, stepped superstructure and bridge tower, funnel, fore and main masts, and four twin turrets
 * (A/B forward, C/D aft) with their barrels; kitify() gives it painted steel / deck plank finishes. Bow at +X.
 */
function warshipMesh(p) {
  const g = new THREE.Group();
  const L = p.w / 2, B = p.d / 2, fb = Math.min(p.h ?? 12, 9) * 0.55; // freeboard above the waterline
  g.add(slab(hullShape(L, B), -1.5, fb, 'greyPaint'));
  g.add(slab(hullShape(L - 0.6, B - 0.5), fb, fb + 0.12, 'woodDark'));
  const sx = L / 60; // layout in Bismarck-like proportions (120 m reference), scaled to the footprint
  const blk = (w, h, d, x, y, mat = 'greyPaint') => { const b = box(w * sx, h, d, mat, y + h / 2); b.position.x = x * sx; g.add(b); return b; };
  blk(34, 3, B * 1.1, -2, fb);           // superstructure deck 1
  blk(24, 2.6, B * 0.85, 2, fb + 3);     // deck 2
  blk(8, 7, 4, 10, fb + 5.6);            // bridge tower
  blk(9, 1.2, 6, 10, fb + 12.6);         // fire-control top
  const fun = cyl(2.2, 2.6, 6.5, 'greyPaint', fb + 5.6 + 3.25, 16); fun.position.x = -6 * sx; fun.scale.z = 1.4; g.add(fun);
  const cap = cyl(2.3, 2.3, 0.5, 'black', fb + 12.3, 16); cap.position.x = -6 * sx; cap.scale.z = 1.4; g.add(cap);
  for (const [x, h] of [[16, 22], [-20, 16]]) { const m = cyl(0.25, 0.4, h, 'metal', fb + 3 + h / 2, 8); m.position.x = x * sx; g.add(m); }
  for (const [x, dir] of [[40, 1], [30, 1], [-32, -1], [-42, -1]]) {
    const tur = new THREE.Group(); tur.position.set(x * sx, fb + (Math.abs(x) < 35 ? 1.6 : 0.2), 0); tur.rotation.y = dir > 0 ? 0 : Math.PI;
    const base = cyl(3.4, 3.6, 1.0, 'greyPaint', 0.5, 20); tur.add(base);
    const house = box(7.5, 2.4, 6.5, 'greyPaint', 1.0 + 1.2); house.position.x = 0.3; tur.add(house);
    for (const zz of [-1.2, 1.2]) { const gun = cyl(0.28, 0.42, 14, 'metal', 0, 10); gun.rotation.z = -Math.PI / 2 + 0.03; gun.position.set(4 + 7, 2.2, zz); tur.add(gun); }
    g.add(tur);
  }
  for (const s2 of [-1, 1]) for (const x of [-12, -4, 4]) { // secondary turrets either beam
    const t = box(3.2, 1.6, 2.6, 'greyPaint', fb + 3 + 0.8); t.position.set(x * sx, t.position.y, s2 * B * 0.62); g.add(t);
  }
  return g;
}
/** A torpedo along local x (7 m, 53.3 cm), nose +x. */
function torpedo(x, y, z) {
  const g = new THREE.Group();
  const body = cyl(0.27, 0.27, 6.2, 'greyPaint', 0);
  body.rotation.z = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), getMaterial('metal'));
  nose.position.x = 3.1;
  const tail = cyl(0.27, 0.1, 0.8, 'metalRust', 0);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -3.5;
  g.add(body, nose, tail);
  g.position.set(x, y, z);
  return g;
}
/**
 * Moored Type VII U-boat (M7 `battleship` variant `uboat_docked`): the saddle-tank hull awash, the slatted
 * casing deck on top (the walkable deck of the flat map, top ≈ 0.45 m like the pier), the 88 mm deck gun
 * forward, and the spare-torpedo stack on the after deck at the demolition anchor (`targetAt`).
 */
function uboatMesh(p) {
  const g = new THREE.Group();
  const L = p.w / 2, B = p.d / 2;
  g.add(slab(hullShape(L, B), -0.9, 0.25, 'greyPaint'));
  const deck = hullShape(L - 1.5, B * 0.42);
  g.add(slab(deck, 0.25, 0.42, 'woodDark'));
  // bow net-cutter and the jumping wire's stanchion
  const cutter = box(2.2, 1.2, 0.12, 'metal', 0.9);
  cutter.position.x = L - 2;
  g.add(cutter);
  // 88 mm deck gun forward of the tower
  const ped = cyl(0.35, 0.45, 1.1, 'greyPaint', 0.95);
  ped.position.x = 10;
  const shield = box(1.4, 0.7, 1.2, 'greyPaint', 1.7);
  shield.position.x = 10;
  const barrel = cyl(0.09, 0.11, 4.2, 'metal', 1.8);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.x = 12.2;
  g.add(ped, shield, barrel);
  // the spare torpedoes, lashed on chocks on the after deck (where the charge must go)
  const [tx] = Array.isArray(p.targetAt) ? p.targetAt : [-L * 0.75];
  for (const [dz, y] of [[-0.3, 0.7], [0.3, 0.7], [0, 1.2]]) g.add(torpedo(tx, y, dz));
  for (const dx of [-2.2, 2.2]) { const chock = box(0.3, 0.3, 1.3, 'woodDark', 0.55); chock.position.x = tx + dx; g.add(chock); }
  // stern: rudder and hydroplane guards breaking the water
  const rudder = box(1.4, 1.0, 0.15, 'greyPaint', 0.2);
  rudder.position.x = -L + 0.4;
  g.add(rudder);
  return g;
}
/** Conning tower of a Type VII: rounded fairing, bridge rim, periscope standards, the aft flak platform. */
function uboatTowerMesh(p) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const a = p.w / 2, b = p.d / 2;
  s.moveTo(a, 0);
  s.quadraticCurveTo(a, b, a - 1.2, b);
  s.lineTo(-a, b * 0.8);
  s.lineTo(-a, -b * 0.8);
  s.lineTo(a - 1.2, -b);
  s.quadraticCurveTo(a, -b, a, 0);
  g.add(slab(s, 0.4, 3.4, 'greyPaint'));
  const rim = box(p.w * 0.85, 0.15, p.d * 1.02, 'metal', 3.45);
  rim.position.x = 0.2;
  g.add(rim);
  for (const [x, h] of [[0.6, 6.2], [-0.4, 5.4]]) { const per = cyl(0.12, 0.16, h - 3.4, 'metal', 3.4 + (h - 3.4) / 2); per.position.x = x; g.add(per); }
  const flak = box(1.8, 0.12, p.d * 0.9, 'metal', 2.6);
  flak.position.x = -a - 0.6;
  const gun = cyl(0.05, 0.05, 1.6, 'metal', 3.2);
  gun.rotation.z = Math.PI / 2.6;
  gun.position.x = -a - 0.4;
  g.add(flak, gun);
  return g;
}

/** Mesh for a non-linear extra (local frame, origin at the prop centre). */
function meshFor(type, p) {
  const g = new THREE.Group();
  if (type === 'battleship' && p.variant === 'uboat_docked') return uboatMesh(p);
  if (type === 'battleship') return warshipMesh(p);
  switch (p.kind) {
    case 'uboatTower':
      return uboatTowerMesh(p);
    case 'round':
      g.add(cyl(p.r * (type === 'v2_rocket' ? 0.8 : 0.85), p.r, p.h, p.mat));
      if (type === 'v2_rocket') g.add(cyl(0, p.r * 0.8, p.r * 2.5, p.mat, p.h + p.r * 1.25));
      if (type === 'lighthouse') g.add(cyl(p.r * 0.7, p.r * 0.7, 2, 'glass', p.h + 1));
      if (type === 'minaret') g.add(cyl(p.r * 1.3, p.r * 1.3, 0.4, p.mat, p.h * 0.8));
      if (p.gun) { const b = box(3.4, 0.2, 0.2, 'metal', 1.4); b.position.x = 1.2; g.add(b); }
      return g;
    case 'pen': {
      const t = type === 'prison_pen' || type === 'cemetery' ? 0.1 : 0.6;
      for (const [sx, sz] of Object.values(SIDE)) {
        const side = Object.keys(SIDE).find((k) => SIDE[k][0] === sx && SIDE[k][1] === sz);
        if (side === p.open) continue;
        const along = sx === 0 ? p.w : p.d;
        if (type === 'prison_pen' && p.mat === 'wire') { g.add(wireSide(p, sx, sz, along, side === p.gateSide)); continue; }
        const wall = box(sx === 0 ? along : t, p.h, sx === 0 ? t : along, p.mat);
        wall.position.set((sx * p.w) / 2, p.h / 2, (sz * p.d) / 2);
        g.add(wall);
      }
      if (p.roofed || type === 'uboat_pen') g.add(box(p.w, 0.6, p.d, p.mat, p.h));
      if (type === 'cemetery') for (let i = -p.w / 2 + 2; i < p.w / 2 - 1; i += 2.5) for (let j = -p.d / 2 + 2; j < p.d / 2 - 1; j += 3) { const s = box(0.5, 0.8, 0.15, 'stone', 0.4); s.position.set(i, 0.4, j); g.add(s); }
      if (type === 'uboat_pen') { const w = box(p.w - 2, 0.05, p.d - 2, 'glass', 0.02); g.add(w); }
      return g;
    }
    case 'deck': {
      g.add(box(p.w, 0.4, p.d, p.mat, 0.2));
      if (p.trestle) for (let x = -p.w / 2 + 3; x < p.w / 2; x += 6) { const leg = box(0.6, p.h, p.d * 0.9, 'woodDark', -p.h / 2); leg.position.x = x; g.add(leg); }
      else trussSides(g, p);
      if (p.trestle) for (const s of [-0.72, 0.72]) { const r = box(p.w, 0.12, 0.08, 'rail', 0.46); r.position.z = s; g.add(r); }
      return g;
    }
    case 'water': case 'gap':
      g.add(box(p.w, 0.05, p.d, p.kind === 'water' ? 'glass' : 'black', -0.3));
      return g;
    case 'range':
      { const berm = box(p.w, p.h, 1.2, 'dirt', p.h / 2); berm.position.z = -p.d / 2; g.add(berm); }
      for (let x = -p.w / 2 + 2; x < p.w / 2; x += 3) { const t = box(0.6, 1.4, 0.08, 'planks', 0.9); t.position.set(x, 0.9, -p.d / 2 + 1.5); g.add(t); }
      return g;
    default:
      if (p.hidden) return g;
      if (type === 'drilling_rig') { derrick(g, p); return g; }
      g.add(box(p.w, p.h, p.d, p.mat));
      if (p.roof) g.add(box(p.w + 0.4, 0.25, p.d + 0.5, p.roof, p.h + 0.12));
      if (p.dome) g.add(cyl(p.w * 0.25, p.w * 0.3, p.w * 0.25, 'plaster', p.h + p.w * 0.12));
      if (p.steps) { const st = box(4, 0.6, 1.6, 'stone', 0.3); st.position.z = p.d / 2 + 0.8; g.add(st); }
      if (p.wheel) { const wh = cyl(2.4, 2.4, 0.5, 'woodDark', 2.4, 16); wh.rotation.x = Math.PI / 2; wh.position.set(0, 2.4, p.d / 2 + 0.4); g.add(wh); }
      if (type === 'battleship') { g.add(box(p.w * 0.25, 6, p.d * 0.5, p.mat, p.h + 3)); const tur = box(8, 3, 6, p.mat, p.h + 1.5); tur.position.x = p.w * 0.3; g.add(tur); }
      if (type === 'railway_gun') { const b = cyl(0.5, 0.6, 20, 'olivePaint', p.h + 0.6); b.rotation.z = Math.PI / 2; b.position.x = 6; g.add(b); }
      return g;
  }
}

/** Struts (3D point pairs) of thickness t merged into one mesh (a lattice is ~100 bars: one draw call). */
function strutMesh(pairs, t, mat) {
  const pos = [], nrm = [], up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const [a, b] of pairs) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), L = d.length();
    const geo = new THREE.BoxGeometry(t, L, t).toNonIndexed();
    q.setFromUnitVectors(up, d.normalize());
    geo.applyMatrix4(m4.compose(A.add(Bv).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    pos.push(...geo.attributes.position.array); nrm.push(...geo.attributes.normal.array);
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, getMaterial(mat));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * §7.7 drilling_rig (M11 review: solid box pillars did not read as derricks): a drill-floor skid, a tapered
 * open lattice tower (four legs, girts, X-bracing on every face), the monkey board, the crown block with the
 * travelling block on its line, and the doghouse on the skid. Footprint unchanged (the skid's w × d block).
 */
function derrick(g, p) {
  const skidH = 1.2, top = p.h - 1.4, b = Math.min(p.w, p.d) / 2 - 0.7, t = Math.max(0.45, b * 0.2), n = Math.max(4, Math.round(top / 3.2));
  g.add(box(p.w, skidH, p.d, 'metalRust', skidH / 2));
  g.add(box(p.w * 0.8, 0.12, p.d * 0.8, 'metal', skidH + 0.06));
  const half = (y) => b + (t - b) * ((y - skidH) / (top - skidH));
  const corner = (y, sx, sz) => [sx * half(y), y, sz * half(y)];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const legs = [], brace = [];
  for (const [sx, sz] of C) legs.push([corner(skidH, sx, sz), corner(top, sx, sz)]);
  for (let k = 0; k <= n; k++) {
    const y0 = skidH + ((top - skidH) * k) / n, y1 = skidH + ((top - skidH) * (k + 1)) / n;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = C[c], [bx, bz] = C[(c + 1) % 4];
      if (k > 0) brace.push([corner(y0, ax, az), corner(y0, bx, bz)]); // girts
      if (k < n) { brace.push([corner(y0, ax, az), corner(y1, bx, bz)]); brace.push([corner(y0, bx, bz), corner(y1, ax, az)]); } // X
    }
  }
  g.add(strutMesh(legs, 0.32, 'metal'));
  g.add(strutMesh(brace, 0.12, 'metal'));
  const mb = skidH + (top - skidH) * 0.62, mw = half(mb) * 2 + 0.8;
  g.add(box(mw, 0.1, mw * 0.45, 'metal', mb)); // monkey board
  g.add(box(t * 2 + 0.8, 0.9, t * 2 + 0.8, 'metalRust', top + 0.45)); // crown block
  const sheave = cyl(0.45, 0.45, 0.3, 'metal', top + 1.05, 12); sheave.rotation.x = Math.PI / 2; g.add(sheave);
  g.add(cyl(0.03, 0.03, top - 7, 'black', (top + 7) / 2, 4)); // drill line
  g.add(box(0.7, 1.6, 0.7, 'metalRust', 6.2)); // travelling block + hook
  const dog = box(2.2, 2.2, 1.8, 'metalRust', skidH + 1.1); dog.position.set(p.w / 2 - 1.3, dog.position.y, p.d / 2 - 1.1); g.add(dog);
}

/** A bar from (x0, y0) to (x1, y1) in the truss plane at local z. */
function bar(g, x0, y0, x1, y1, z, t, mat) {
  const L = Math.hypot(x1 - x0, y1 - y0), m = box(t, L, t, mat, 0);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  m.rotation.z = -Math.atan2(x1 - x0, y1 - y0);
  g.add(m);
}

/**
 * Open through-truss sides for a `deck` bridge (M16 review: a solid 14 m slab hid the deck, the men on it and the
 * island). Pratt panels of height `trussH` (default min(h, 7)) on both sides, portal struts across the ends and,
 * with `arch: [x0, x1]` (local metres along the span), a bowstring arch rising to `h` with vertical hangers.
 */
function trussSides(g, p) {
  const H = p.trussH ?? Math.min(p.h, 7), y0 = 0.4, half = p.w / 2, n = Math.max(2, Math.round(p.w / H)), P = p.w / n;
  const arch = Array.isArray(p.arch) ? p.arch : null;
  const archY = (x) => { const u = (x - arch[0]) / (arch[1] - arch[0]); return y0 + H + (p.h - H) * 4 * u * (1 - u); };
  for (const s of [-1, 1]) {
    const z = (s * p.d) / 2;
    bar(g, -half, y0 + H, half, y0 + H, z, 0.35, p.mat); // top chord
    for (let k = 0; k <= n; k++) {
      const x = -half + k * P;
      bar(g, x, y0, x, y0 + H, z, 0.28, p.mat); // posts
      if (k < n) { const up = k < n / 2; bar(g, up ? x : x + P, y0, up ? x + P : x, y0 + H, z, 0.2, p.mat); } // Pratt diagonals
    }
    if (arch) {
      const m = 12, dx = (arch[1] - arch[0]) / m;
      for (let k = 0; k < m; k++) bar(g, arch[0] + k * dx, archY(arch[0] + k * dx), arch[0] + (k + 1) * dx, archY(arch[0] + (k + 1) * dx), z, 0.4, p.mat);
      for (let k = 1; k < m; k++) bar(g, arch[0] + k * dx, y0 + H, arch[0] + k * dx, archY(arch[0] + k * dx), z, 0.12, p.mat); // hangers
    }
  }
  for (const x of [-half + 0.2, half - 0.2]) { const strut = box(0.3, 0.3, p.d, p.mat, y0 + H); strut.position.x = x; g.add(strut); }
  for (let x = -half + P; x < half - 1; x += 2 * P) { const brace = box(0.18, 0.18, p.d, p.mat, y0 + H); brace.position.x = x; g.add(brace); }
}

/**
 * One see-through side of a wire pen (B.FENCE: guards see through it, so it must read as mesh, not a slab):
 * posts every ~2.5 m, a top and a bottom rail and strands of wire; the gate side keeps its 2.4 m gap.
 */
function wireSide(p, sx, sz, along, gate) {
  const side = new THREE.Group();
  side.position.set((sx * p.w) / 2, 0, (sz * p.d) / 2);
  side.rotation.y = sx === 0 ? 0 : Math.PI / 2;
  const runs = gate ? [[-along / 2, -1.2], [1.2, along / 2]] : [[-along / 2, along / 2]];
  for (const [a, b] of runs) {
    const len = b - a, mid = (a + b) / 2, posts = Math.max(1, Math.round(len / 2.5));
    // (placeholder-art pass: textured steel posts and rails; the mesh strands galvanised wire, dark with weather)
    const steel = dressingMaterial('steel'), galv = paintedMaterial('galv', 0x55585a);
    for (let q = 0; q <= posts; q++) { const post = box(0.1, p.h, 0.1, 'metal'); post.material = steel; post.position.x = a + (q * len) / posts; side.add(post); }
    for (const y of [0.08, p.h - 0.05]) { const r = box(len, 0.06, 0.06, 'metal', y); r.material = steel; r.position.x = mid; side.add(r); }
    for (let y = 0.35; y < p.h - 0.15; y += 0.3) { const w = box(len, 0.02, 0.02, 'wire', y); w.material = galv; w.position.x = mid; w.castShadow = false; side.add(w); }
    for (let x = a + 0.5; x < b - 0.2; x += 0.5) { const w = box(0.02, p.h - 0.1, 0.02, 'wire'); w.material = galv; w.position.x = x; w.castShadow = false; side.add(w); }
  }
  return side;
}

/** Footprints of a non-linear extra, in world coordinates. */
function footprintsFor(type, p, x, z, rot) {
  const fps = [];
  const at = (lx, lz) => localToWorld(x, z, rot, lx, lz);
  switch (p.kind) {
    case 'round':
      if (p.block) fps.push({ shape: 'circle', x, z, r: p.r, block: p.block });
      break;
    case 'pen': {
      const t = Math.max(0.6, type === 'prison_pen' ? 0.5 : 0.8);
      for (const [side, [sx, sz]] of Object.entries(SIDE)) {
        if (side === p.open) continue;
        const along = sx === 0 ? p.w : p.d;
        const [cx, cz] = at((sx * p.w) / 2, (sz * p.d) / 2);
        const w = sx === 0 ? along : t, d = sx === 0 ? t : along;
        if (side === p.gateSide) { // a 2.4 m gap in the middle: the mission puts a `gate` structure there
          const half = (along - 2.4) / 2, off = (along + 2.4) / 4;
          for (const s of [-1, 1]) {
            const [gx, gz] = at((sx * p.w) / 2 + (sx === 0 ? s * off : 0), (sz * p.d) / 2 + (sx === 0 ? 0 : s * off));
            fps.push(rectFp(gx, gz, sx === 0 ? half : t, sx === 0 ? t : half, rot, { block: p.block }));
          }
        } else fps.push(rectFp(cx, cz, w, d, rot, { block: p.block }));
      }
      if (type === 'uboat_pen') fps.push(rectFp(x, z, p.w - 2, p.d - 2, rot, { terrain: T.WATER }));
      break;
    }
    case 'deck':
      fps.push(rectFp(x, z, p.w, p.d, rot, { bridge: 1 }));
      for (const s of [-1, 1]) { const [cx, cz] = at(0, s * (p.d / 2 + 0.25)); fps.push(rectFp(cx, cz, p.w - 1, 0.5, rot, { block: L })); }
      break;
    case 'water':
      fps.push(p.points ? { shape: 'poly', points: p.points, terrain: T.WATER } : rectFp(x, z, p.w, p.d, rot, { terrain: T.WATER }));
      break;
    case 'gap':
      fps.push(p.points ? { shape: 'poly', points: p.points, block: H } : rectFp(x, z, p.w, p.d, rot, { block: H }));
      break;
    case 'range': {
      const [bx, bz] = at(0, -p.d / 2);
      fps.push(rectFp(bx, bz, p.w, 1.2, rot, { block: L }));
      break;
    }
    default:
      if (type === 'castle_gate') { // two towers, a passage of w/3 in the middle (the mission adds a `gate`)
        for (const s of [-1, 1]) { const [cx, cz] = at((s * p.w) / 3, 0); fps.push(rectFp(cx, cz, p.w / 3, p.d, rot, { block: H })); }
        break;
      }
      if (p.block) fps.push(rectFp(x, z, p.w, p.d, rot, { block: p.block }));
      if (p.roofWalk && p.h > 0.6) fps.push(rectFp(x, z, p.w, p.d, rot, { elev: p.roofY ?? p.h }));
  }
  return fps;
}

/**
 * Build one §7.7 extra prop. Same signature/result as props.js buildProp.
 * @param {string} type @param {object} params {x, z, rot, id?, destructible?, w?, d?, h?, r?, points?, width?, targetAt?, roofWalk?, open?}
 */
export function buildExtraProp(type, params = {}, ctx = {}) {
  const base = EXTRA_PROP_DEFAULTS[resolve(type)];
  if (!base) throw new Error(`[props-extra] unknown prop type "${type}"`);
  const p = { ...base, ...params };
  if (base.kind === 'linear') return buildLinearExtra(type, p, ctx);
  const x = params.x ?? 0, z = params.z ?? 0, rot = params.rot ?? 0;
  const group = placed(x, z, rot);
  group.name = `prop:${type}${params.id ? ':' + params.id : ''}`;
  const plat = base.kind === 'platform';
  const kit = plat ? null : kitExtraMesh(resolve(type), p, ctx);
  group.add(plat ? buildAccessPlatform(p) : kit || meshFor(resolve(type), p));
  // no dedicated kit model: the primitive placeholder keeps its shape with textured finishes (art/kit-materials.js)
  if (!kit && !plat && ctx.library !== false && ctx.dressing !== false) kitify(group);
  if (params.flag) { // garrison flag (design-spec §2.4 / §10.6) beside the placeholder, as props.js does
    const f = makeFlag({ pole: true, h: Math.max(5, (p.h ?? 3) + 2.5), theater: ctx.theater });
    f.position.set((p.w ?? 4) / 2 + 0.9, 0, (p.d ?? 4) / 2 - 0.2);
    group.add(f);
  }
  const footprints = plat ? accessPlatformFootprints(p, x, z, rot) : footprintsFor(resolve(type), p, x, z, rot);
  let interactables;
  if (params.destructible) {
    const [lx, lz] = anchor(p, p.targetAt);
    const [tx, tz] = localToWorld(x, z, rot, lx, lz);
    const full = Math.max(p.w ?? 0, p.d ?? 0, (p.r ?? 1) * 2) / 2;
    interactables = [{ interactKind: 'explosiveTarget', x: tx, z: tz, id: params.id, hp: params.hp ?? 100, radius: p.targetAt ? Math.min(full, Math.max(4, (p.d ?? 0) / 2 + 1)) : full, bombOnly: !!p.bombOnly, bunker: !!p.bunker }];
  }
  const castsShadow = !['moat', 'ravine', 'mine', 'tram_track'].includes(type);
  group.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow && castsShadow; });
  // realistic visual from the building library when the mission names one (`asset`, or a hinted `variant`);
  // the placeholder's footprints, walkable roofs and demolition anchors stay the gameplay ones
  const lib = ctx.library !== false && libraryHinted(type, params) ? libraryVisual(type, { ...params, w: p.w, d: p.d, r: p.r }, ctx) : null;
  if (lib) return { object3d: lib.object3d, footprints, castsShadow: true, interactables, library: lib };
  return { object3d: group, footprints, castsShadow, interactables };
}
