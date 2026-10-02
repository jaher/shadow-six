/**
 * Prop catalogue — owned by ART (see docs/ARCHITECTURE.md). Every catalogue type has a placeholder builder
 * (boxes/cylinders) with the correct grid footprints; once the building library is loaded (art/building-props.js,
 * browser only) the visual of every type it covers is the realistic GLB fitted onto the SAME footprints (gameplay
 * stays authoritative). Unknown types never throw: library types get their sidecar footprints, anything else a
 * generic placeholder box (missions 4-20 / props-extra.js may add types before their art exists).
 *
 * Footprint format (consumed by world/map-builder.js), all in world metres:
 *   {shape:'rect',   x, z, w, d, rot}      oriented rect centred at (x,z); w along heading `rot`
 *   {shape:'circle', x, z, r}
 *   {shape:'poly',   points:[[x,z],...]}
 *   {shape:'line',   points:[[x,z],...], width}
 * plus what to write: `block` (B.* code), `terrain` (T.* code), `bridge` (1). Terrain footprints are
 * applied before block/bridge footprints of all structures.
 * @module art/props
 */

import * as THREE from 'three';
import { getMaterial } from './materials.js';
import { B, T, CELL } from '../world/grid.js';
import { libraryVisual, libTypeOf } from './building-props.js';
import { makeFlag } from './flags.js';
import { wireTypeOf } from './wire-obstacles.js';
import { buildBreakableGate } from './breakable-gates.js';
import { buildMgPlatform } from './mg-platform.js';
import { isBreakableGate } from '../world/breakables.js';
import { buildRocks, buildCliff, buildWall, buildTent, buildRuins, buildSandbags, buildCrates, buildGenerator, buildLattice, buildPole } from './dressing.js';

/** Prop catalogue (missions may only use these). */
export const PROP_TYPES = ['barracks', 'house', 'hut', 'bunker', 'watchtower', 'wall', 'fence', 'gate', 'sandbags',
  'crates', 'barrels', 'fueltank', 'tent', 'tree', 'palm', 'pine', 'bush', 'rocks', 'cliff', 'bridge', 'road',
  'river', 'lake', 'sea', 'pier', 'radio_mast', 'generator', 'aa_gun', 'searchlight', 'lamp_post',
  'telegraph_pole', 'sign', 'rail_track', 'train_car', 'ruins', 'hangar', 'plane', 'uboat', 'dam', 'crater',
  'trench', 'well'];

/** Linear props: built from `points` + `width`. */
export const LINEAR_PROPS = ['wall', 'fence', 'road', 'river', 'rail_track', 'trench'];

/** Default size [w, d, h] and block class for rectangular/circular props. */
export const PROP_DEFAULTS = {
  barracks: { w: 12, d: 6, h: 3.4, block: B.HIGH, mat: 'planks', roof: 'roofTin' },
  house: { w: 8, d: 7, h: 5, block: B.HIGH, mat: 'plaster', roof: 'roofTile' },
  hut: { w: 4, d: 4, h: 2.6, block: B.HIGH, mat: 'wood', roof: 'roofTar' },
  bunker: { w: 5, d: 5, h: 2, block: B.HIGH, mat: 'concrete' },
  hangar: { w: 20, d: 16, h: 8, block: B.HIGH, mat: 'greyPaint', roof: 'roofTin' },
  ruins: { w: 8, d: 8, h: 2.2, block: B.HIGH, mat: 'stone' },
  dam: { w: 30, d: 6, h: 6, block: B.HIGH, mat: 'concrete' },
  train_car: { w: 10, d: 2.8, h: 3.2, block: B.HIGH, mat: 'woodDark', roof: 'roofTin' },
  tent: { w: 4, d: 3, h: 2.2, block: B.HIGH, mat: 'canvas' },
  cliff: { w: 10, d: 4, h: 6, block: B.HIGH, mat: 'rock' },
  sandbags: { w: 3, d: 0.8, h: 1, block: B.LOW, mat: 'sandbag' },
  crates: { w: 2, d: 2, h: 1.1, block: B.LOW, mat: 'planks' },
  generator: { w: 2, d: 1.4, h: 1.2, block: B.LOW, mat: 'olivePaint' },
  aa_gun: { w: 3, d: 3, h: 1.1, block: B.LOW, mat: 'greyPaint' },
  pier: { w: 4, d: 12, h: 0.4, block: B.NONE, mat: 'planks' },
  bridge: { w: 12, d: 4, h: 0.5, block: B.NONE, mat: 'planks' },
  gate: { w: 4, d: 0.3, h: 2.2, block: B.FENCE, mat: 'wire' },
  plane: { w: 12, d: 14, h: 3, block: B.LOW, mat: 'greyPaint' },
  uboat: { w: 40, d: 5, h: 4, block: B.HIGH, mat: 'greyPaint' },
  sea: { w: 40, d: 20, block: B.NONE },
  lake: { w: 12, d: 10, block: B.NONE },
  crater: { r: 1.8, block: B.NONE },
  fueltank: { r: 2, h: 4, block: B.HIGH, mat: 'fuelRed' },
  barrels: { r: 0.7, h: 1, block: B.LOW, mat: 'metalRust' },
  well: { r: 0.9, h: 0.9, block: B.LOW, mat: 'stone' },
  watchtower: { w: 3, d: 3, h: 6, block: B.HIGH, mat: 'wood' },
  tree: { r: 0.5, h: 7, crown: 2.4, block: B.HIGH },
  pine: { r: 0.45, h: 9, crown: 2, block: B.HIGH },
  palm: { r: 0.35, h: 8, crown: 2.5, block: B.HIGH },
  bush: { r: 1, h: 1.2, block: B.LOW },
  rocks: { r: 1.5, h: 1.8, block: B.HIGH, mat: 'rock' },
  radio_mast: { r: 0.5, h: 14, block: B.HIGH, mat: 'metal' },
  searchlight: { r: 0.6, h: 1.6, block: B.LOW, mat: 'greyPaint' },
  lamp_post: { r: 0.15, h: 4, block: B.HIGH, mat: 'metal' },
  telegraph_pole: { r: 0.15, h: 7, block: B.HIGH, mat: 'woodDark' },
  sign: { r: 0.15, h: 2, block: B.NONE, mat: 'wood' },
  wall: { width: 0.5, h: 2.6, block: B.HIGH, mat: 'brick' },
  fence: { width: 0.3, h: 2.2, block: B.FENCE, mat: 'wire' },
  road: { width: 4, terrain: T.ROAD },
  river: { width: 6, terrain: T.WATER },
  rail_track: { width: 2.4, block: B.NONE, mat: 'rail' },
  trench: { width: 1.6, terrain: T.MUD, block: B.NONE, mat: 'dirt' },
};

// ------------------------------------------------------------------ mesh helpers

function box(w, h, d, mat, y = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), getMaterial(mat));
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop, rBot, h, mat, y = h / 2, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), getMaterial(mat));
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function flat(w, d, mat, y = 0.02) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), getMaterial(mat));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/** Group placed at (x, z) rotated to heading `rot` (local +X = heading direction, local Z = across). */
function placed(x, z, rot) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = -rot; // local +X maps to (cos rot, sin rot) in (x, z)
  return g;
}

const pts2 = (points) => points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));

/** Build a linear prop mesh: one stretched box (or flat strip) per segment + joints. */
function buildLinear(type, p, def, ctx = {}) {
  const points = pts2(p.points || [[p.x ?? 0, p.z ?? 0], [(p.x ?? 0) + (p.w ?? 4), p.z ?? 0]]);
  const width = p.width ?? def.width;
  const h = p.h ?? def.h ?? 0;
  const dressed = type === 'wall' && dressingOn(ctx);
  const root = dressed ? buildWall(points, { variant: p.variant, mat: p.mat || def.mat, h, width, id: p.id, walkways: p.walkways }) : new THREE.Group();
  // barbed wire (art/wire-obstacles.js): the map's wire layer draws this run; the footprints below are unchanged
  const wire = (type === 'fence' || type === 'wall') && dressingOn(ctx) ? wireTypeOf({ ...p, type, h }, ctx) : null;
  if (wire && !root.userData.wireRun) root.userData.wireRun = { type: wire, def: { ...p, type, h, width }, points, coping: type === 'wall' ? { top: h } : null };
  for (let k = 0; !dressed && !(wire && type === 'fence') && k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const seg = placed((ax + bx) / 2, (az + bz) / 2, Math.atan2(bz - az, bx - ax));
    if (type === 'wall') seg.add(box(len + width, h, width, p.mat || def.mat));
    else if (type === 'fence') {
      const posts = Math.max(1, Math.round(len / 2.5));
      for (let q = 0; q <= posts; q++) {
        const post = box(0.1, h, 0.1, 'woodDark');
        post.position.x = -len / 2 + (q * len) / posts;
        seg.add(post);
      }
      for (const y of [0.5, 1.2, 1.9]) {
        const wire = box(len, 0.03, 0.03, 'wire', y);
        wire.castShadow = false;
        seg.add(wire);
      }
    } else if (type === 'road') seg.add(flat(len + width * 0.5, width, 'dirt', 0.015));
    else if (type === 'river') seg.add(flat(len + width, width, 'mud', -0.3));
    else if (type === 'rail_track') {
      seg.add(flat(len, width, 'sleeper', 0.03));
      for (const s of [-0.72, 0.72]) {
        const rail = box(len, 0.12, 0.08, 'rail', 0.1);
        rail.position.z = s;
        seg.add(rail);
      }
    } else if (type === 'trench') seg.add(flat(len + width * 0.5, width, 'mud', 0.02));
    root.add(seg);
  }
  const fp = { shape: 'line', points, width };
  const footprints = [];
  if (def.terrain != null) footprints.push({ ...fp, terrain: p.terrain ?? def.terrain });
  // thin props (fences) still need ≥ 1 cell of blocking, whatever their alignment to the grid
  if (def.block) footprints.push({ ...fp, width: Math.max(width, CELL), block: def.block });
  return { object3d: root, footprints, castsShadow: type === 'wall' || type === 'fence' };
}

/** Rectangular footprint helper. */
const rectFp = (x, z, w, d, rot, extra) => ({ shape: 'rect', x, z, w, d, rot, ...extra });

/** Mesh builders for non-linear props: (params with resolved w,d,h,r) → Object3D (local, at origin). */
/** Procedural realistic dressing (art/dressing.js) instead of the placeholder primitives; off with the library. */
const dressingOn = (ctx) => !!ctx && ctx.library !== false && ctx.dressing !== false;

const BUILDERS = {
  cliff: (p, def, ctx) => (dressingOn(ctx) ? buildCliff(p) : box(p.w, p.h ?? 1, p.d, def.mat || 'rock')),
  ruins: (p, def, ctx) => (dressingOn(ctx) ? buildRuins(p) : box(p.w, p.h ?? 1, p.d, def.mat || 'stone')),
  sandbags: (p, def, ctx) => (dressingOn(ctx) ? buildSandbags(p) : box(p.w, p.h ?? 1, p.d, def.mat)),
  crates: (p, def, ctx) => (dressingOn(ctx) ? buildCrates(p) : box(p.w, p.h ?? 1, p.d, def.mat)),
  generator: (p, def, ctx) => (dressingOn(ctx) ? buildGenerator(p) : box(p.w, p.h ?? 1, p.d, def.mat)),
  barracks: (p, def) => {
    const g = new THREE.Group();
    g.add(box(p.w, p.h, p.d, p.mat || def.mat));
    const roof = box(p.w + 0.4, 0.25, p.d + 0.6, def.roof, p.h + 0.12);
    g.add(roof);
    const door = box(1.2, 2.1, 0.08, 'woodDark', 1.05);
    door.position.z = p.d / 2 + 0.04;
    g.add(door);
    return g;
  },
  bunker: (p, def) => {
    const g = new THREE.Group();
    g.add(box(p.w, p.h, p.d, def.mat));
    const slit = box(p.w * 0.6, 0.2, 0.1, 'black', p.h * 0.7);
    slit.position.z = p.d / 2 + 0.02;
    g.add(slit);
    return g;
  },
  watchtower: (p, def, ctx) => {
    // the open timber MG stand (M2 towers after the original): sandbagged deck, MG 34 on its tripod, ladder
    if (p.variant === 'mg_platform' && dressingOn(ctx)) return buildMgPlatform(p);
    const g = new THREE.Group();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = box(0.2, p.h, 0.2, def.mat);
      leg.position.set(sx * (p.w / 2 - 0.2), p.h / 2, sz * (p.d / 2 - 0.2));
      g.add(leg);
    }
    g.add(box(p.w, 0.2, p.d, 'planks', p.h));
    g.add(box(p.w, 1, p.d, 'planks', p.h + 0.6));
    g.add(box(p.w + 0.4, 0.15, p.d + 0.4, 'roofTar', p.h + 2.3));
    return g;
  },
  gate: (p, def) => {
    // rammable gates: the pre-fractured model the gate smash breaks apart (art/breakable-gates.js, §3.7 addendum)
    const bg = isBreakableGate({ ...p, type: 'gate' }) ? buildBreakableGate(p) : null;
    if (bg) return bg;
    const g = new THREE.Group();
    const leaf = box(p.w, p.h, 0.08, def.mat);
    leaf.material = getMaterial('woodDark');
    g.add(leaf);
    for (const s of [-1, 1]) {
      const post = box(0.3, p.h + 0.4, 0.3, 'concrete');
      post.position.x = s * (p.w / 2 + 0.15);
      g.add(post);
    }
    return g;
  },
  tent: (p, def, ctx) => {
    if (dressingOn(ctx)) return buildTent(p);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, p.d / 2 * 1.15, p.w, 3, 1), getMaterial(def.mat));
    m.rotation.z = Math.PI / 2; // prism lying along +X
    m.position.y = p.h * 0.45;
    m.scale.set(1, 1, p.h / (p.d / 2));
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  plane: (p, def) => {
    const g = new THREE.Group();
    g.add(box(p.d, 1.6, 1.6, def.mat, 1.4)); // fuselage along +X
    const wing = box(2.2, 0.2, p.w, def.mat, 1.6);
    g.add(wing);
    const tail = box(1, 1.6, 0.2, def.mat, 2.4);
    tail.position.x = -p.d / 2 + 0.5;
    g.add(tail);
    return g;
  },
  uboat: (p, def) => {
    const g = new THREE.Group();
    const hull = cyl(p.d / 2, p.d / 2, p.w, def.mat, 0.4, 16);
    hull.rotation.z = Math.PI / 2;
    g.add(hull);
    g.add(box(4, 2.5, 2, def.mat, 2.6));
    return g;
  },
};

/** Round props (circle footprint). */
const ROUND = {
  fueltank: (p, def) => {
    // procedural fallback of the fuel-tank family (docs/fuel-tanks.md; the library GLBs replace it in the browser)
    const g = new THREE.Group();
    const vertical = p.variant === 'oil_tanks_vertical' || p.variant === 'fuel_tank_elevated' || (p.w == null && p.d == null);
    if (!vertical && (p.variant === 'horizontal_cradle' || p.variant === 'fuel_tank_horizontal' || (p.w && p.d))) {
      // horizontal tank along +X: shell + dished heads (~D/4 deep), two saddles at 0.2 L, crown catwalk + rail,
      // vent, manhole and an end stand with its ladder (stand on the +X end)
      const w = p.w ?? 9, d = p.d ?? 3.4, h = p.h ?? 3.5;
      const R = Math.min(d * 0.34, (h - 0.75) / 2), hd = R * 0.36, cy = 0.45 + R;
      const Lc = Math.max(1, Math.min(w * 0.8, w - 2.0) - 2 * hd), cx = -(w - (Lc + 2 * hd)) / 2 + 0.45;
      const mat = p.mat && p.mat !== 'fuelRed' ? p.mat : 'tankCream';
      const shell = cyl(R, R, Lc, mat, 0, 24);
      shell.rotation.z = Math.PI / 2; shell.position.set(cx, cy, 0);
      g.add(shell);
      for (const sgn of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), getMaterial(mat));
        cap.scale.y = hd / R; cap.rotation.z = -sgn * Math.PI / 2; cap.position.set(cx + sgn * Lc / 2, cy, 0);
        cap.castShadow = cap.receiveShadow = true;
        g.add(cap);
        const sad = box(0.5, cy - R * 0.6, R * 1.6, 'woodDark', (cy - R * 0.6) / 2);
        sad.position.x = cx + sgn * Lc * 0.3;
        g.add(sad);
      }
      const walk = box(Lc * 0.75, 0.06, 0.55, 'planks', cy + R + 0.1); walk.position.set(cx + Lc * 0.12, walk.position.y, R * 0.35); g.add(walk);
      const rail = box(Lc * 0.75, 0.05, 0.05, 'metal', cy + R + 0.7); rail.position.set(cx + Lc * 0.12, rail.position.y, R * 0.35 + 0.27); g.add(rail);
      const vent = cyl(0.06, 0.06, 0.6, 'metal', cy + R + 0.3, 6); vent.position.x = cx - Lc * 0.4; g.add(vent);
      const man = cyl(0.32, 0.32, 0.22, 'metal', cy + R + 0.05, 12); man.position.set(cx + Lc * 0.15, man.position.y, -R * 0.3); g.add(man);
      const sx = cx + Lc / 2 + hd + 0.6;
      if (sx + 0.5 <= w / 2 + 0.05) {
        const stand = box(1.0, 0.08, 1.1, 'planks', cy + R + 0.08); stand.position.x = sx; g.add(stand);
        for (const [ox, oz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
          const post = box(0.12, cy + R + 0.04, 0.12, 'woodDark'); post.position.set(sx + ox, post.position.y, oz); g.add(post);
        }
      }
      return g;
    }
    // vertical: plinth + riveted shell + roof (squat or column), or the raised twin tanks on a deck
    const r = p.r ?? 2, h = p.h ?? 4;
    if (p.variant === 'fuel_tank_elevated') {
      const w = p.w ?? 5, d = p.d ?? 3, deck = Math.min(2.6, h * 0.45);
      const dk = box(w, 0.1, d, 'metal', deck - 0.05); g.add(dk);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = box(0.18, deck - 0.1, 0.18, 'metal'); leg.position.set(ox * (w / 2 - 0.15), leg.position.y, oz * (d / 2 - 0.15)); g.add(leg); }
      for (const sx of [-1, 1]) {
        const t = cyl(d * 0.32, d * 0.32, h * 0.4, 'greyPaint', deck + h * 0.2, 16); t.position.x = sx * w * 0.23; g.add(t);
        const rf = cyl(0.15, d * 0.33, 0.35, 'metalRust', deck + h * 0.4 + 0.17, 16); rf.position.x = sx * w * 0.23; g.add(rf);
      }
      return g;
    }
    g.add(cyl(r, r, 0.3, 'concrete', 0.15, 20));
    const sh = Math.max(1.5, h - 0.3 - r * 0.45);
    g.add(cyl(r * 0.86, r * 0.86, sh, p.variant === 'oil_tanks_vertical' ? 'tankCream' : 'greyPaint', 0.3 + sh / 2, 20));
    g.add(cyl(0.12, r * 0.88, r * 0.4, 'metalRust', 0.3 + sh + r * 0.2, 20));
    return g;
  },
  barrels: (p, def) => {
    const g = new THREE.Group();
    const offs = [[-0.3, -0.2], [0.3, -0.2], [0, 0.32]];
    for (const [ox, oz] of offs) {
      const b = cyl(0.3, 0.3, 0.9, def.mat, 0.45);
      b.position.x = ox; b.position.z = oz;
      g.add(b);
    }
    return g;
  },
  well: (p, def) => { const g = new THREE.Group(); g.add(cyl(p.r, p.r, p.h, def.mat)); return g; },
  tree: (p) => {
    const g = new THREE.Group();
    g.add(cyl(p.r * 0.6, p.r, p.h * 0.55, 'bark'));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(p.crown ?? 2.4, 12, 9), getMaterial('foliage'));
    crown.position.y = p.h * 0.7;
    crown.castShadow = true;
    g.add(crown);
    return g;
  },
  pine: (p) => {
    const g = new THREE.Group();
    g.add(cyl(p.r * 0.5, p.r, p.h * 0.35, 'bark'));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(p.crown ?? 2, p.h * 0.75, 10), getMaterial('pineNeedles'));
    cone.position.y = p.h * 0.6;
    cone.castShadow = true;
    g.add(cone);
    return g;
  },
  palm: (p) => {
    const g = new THREE.Group();
    g.add(cyl(p.r * 0.7, p.r, p.h, 'bark'));
    for (let k = 0; k < 6; k++) {
      const leaf = box(p.crown ?? 2.5, 0.05, 0.5, 'palmLeaf', p.h);
      leaf.rotation.y = (k / 6) * Math.PI * 2;
      leaf.rotation.z = -0.3;
      leaf.geometry.translate((p.crown ?? 2.5) / 2, 0, 0);
      g.add(leaf);
    }
    return g;
  },
  bush: (p) => {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(p.r, 10, 7), getMaterial('foliageDark'));
    s.scale.y = p.h / (p.r * 2) * 1.4;
    s.position.y = p.h * 0.45;
    s.castShadow = true;
    g.add(s);
    return g;
  },
  rocks: (p, def, ctx) => {
    if (dressingOn(ctx)) return buildRocks(p);
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(p.r, 0), getMaterial(def.mat));
    s.scale.y = p.h / (p.r * 2);
    s.position.y = p.h * 0.4;
    s.castShadow = true;
    g.add(s);
    return g;
  },
  radio_mast: (p, def, ctx) => {
    if (dressingOn(ctx)) return buildLattice(p, { base: Math.min(1.4, (p.r ?? 0.6) * 2), top: 0.25, arms: false });
    const g = new THREE.Group(); g.add(cyl(0.08, p.r, p.h, def.mat, p.h / 2, 4)); return g;
  },
  searchlight: (p, def) => {
    const g = new THREE.Group();
    g.add(cyl(0.3, 0.4, 0.8, def.mat));
    const lamp = cyl(0.35, 0.35, 0.5, def.mat, 1.2);
    lamp.rotation.x = Math.PI / 2;
    g.add(lamp);
    return g;
  },
  lamp_post: (p, def) => {
    const g = new THREE.Group();
    g.add(cyl(0.06, 0.08, p.h, def.mat));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), getMaterial('lampGlow'));
    bulb.position.y = p.h;
    g.add(bulb);
    return g;
  },
  telegraph_pole: (p, def, ctx) => {
    if (dressingOn(ctx)) return /pylon|lattice/.test(String(p.variant ?? '')) ? buildLattice(p) : buildPole(p);
    const g = new THREE.Group();
    g.add(cyl(0.1, 0.12, p.h, def.mat));
    g.add(box(1.4, 0.1, 0.1, def.mat, p.h - 0.5));
    return g;
  },
  sign: (p, def, ctx) => {
    if (p.variant === 'flag_pole') return makeFlag({ pole: true, h: p.h ?? 7, theater: ctx?.theater }); // a free-standing enemy flagpole
    // flagpoles (garrison markers, e.g. M14 `flagpole_german`): the animated cloth flag of art/flags.js (browser)
    if (/flagpole/.test(String(p.variant ?? '')) && dressingOn(ctx) && typeof document !== 'undefined') return makeFlag({ pole: true, poleH: p.h ?? 6, theater: ctx?.theater });
    const g = new THREE.Group();
    g.add(cyl(0.05, 0.05, p.h, def.mat));
    g.add(box(1, 0.5, 0.05, 'planks', p.h - 0.25));
    return g;
  },
  crater: (p) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 20), getMaterial('crater'));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    g.add(m);
    return g;
  },
};

/**
 * Build one catalogue prop.
 * @param {string} type catalogue type
 * @param {object} params {x, z, rot, id?, destructible?, w?, d?, h?, r?, variant?, points?, width?}
 * @param {object} [ctx] {theater, grid, world}
 * @returns {{object3d: THREE.Object3D, footprints: object[], castsShadow: boolean, interactables?: object[]}}
 */
export function buildProp(type, params = {}, ctx = {}) {
  const def = PROP_DEFAULTS[type];
  if (!def) return buildUnknownProp(type, params, ctx);
  if (LINEAR_PROPS.includes(type)) return buildLinear(type, params, def, ctx);
  const res = buildPlaceholderProp(type, params, ctx, def);
  // realistic visual from the building library, fitted onto the placeholder's (gameplay) footprint
  const p = { ...def, ...params };
  const lib = ctx.library === false ? null : libraryVisual(type, { ...params, w: p.w, d: p.d, r: p.r }, ctx);
  if (lib) { res.object3d = lib.object3d; res.library = lib; res.castsShadow = true; }
  return res;
}

const warned = new Set();

/**
 * A type outside the catalogue: the library's own asset (sidecar footprints) when it models the type,
 * else a generic placeholder box (w × d × h, default 4 × 4 × 3, blocking HIGH). Never throws.
 */
export function buildUnknownProp(type, params = {}, ctx = {}) {
  const x = params.x ?? 0, z = params.z ?? 0, rot = params.rot ?? 0;
  if (ctx.library !== false && libTypeOf(type)) {
    const lib = libraryVisual(type, params, ctx);
    if (lib) {
      const interactables = params.destructible
        ? [{ interactKind: 'explosiveTarget', x, z, id: params.id, hp: params.hp ?? 100, radius: Math.max(params.w ?? 4, params.d ?? 4) / 2 }] : undefined;
      return { object3d: lib.object3d, footprints: lib.footprints, castsShadow: true, interactables, library: lib };
    }
  }
  if (!warned.has(type)) { warned.add(type); console.warn(`[props] unknown prop type "${type}": placeholder box`); }
  const w = params.w ?? (params.r != null ? params.r * 2 : 4), d = params.d ?? (params.r != null ? params.r * 2 : 4), h = params.h ?? 3;
  const group = placed(x, z, rot);
  group.name = `prop:${type}${params.id ? ':' + params.id : ''}`;
  group.add(box(w, h, d, params.mat || 'concrete'));
  const block = params.block ?? B.HIGH;
  const footprints = block ? [rectFp(x, z, w, d, rot, { block })] : [];
  const interactables = params.destructible
    ? [{ interactKind: 'explosiveTarget', x, z, id: params.id, hp: params.hp ?? 100, radius: Math.max(w, d) / 2 }] : undefined;
  return { object3d: group, footprints, castsShadow: true, interactables };
}

/** Placeholder mesh + gameplay footprints/interactables for a (non-linear) catalogue type. */
function buildPlaceholderProp(type, params, ctx, def) {
  const x = params.x ?? 0, z = params.z ?? 0, rot = params.rot ?? 0;
  const p = { ...def, ...params };
  const group = placed(x, z, rot);
  group.name = `prop:${type}${params.id ? ':' + params.id : ''}`;
  const footprints = [];
  let interactables;
  if (ROUND[type]) {
    group.add(ROUND[type](p, def, ctx));
    if (p.block) footprints.push({ shape: 'circle', x, z, r: p.r, block: p.block });
    if (type === 'crater') footprints.push({ shape: 'circle', x, z, r: p.r * 0.8, terrain: T.MUD });
  } else if (type === 'sea' || type === 'lake') {
    const water = p.points ? { shape: 'poly', points: pts2(p.points) } : rectFp(x, z, p.w, p.d, rot);
    footprints.push({ ...water, terrain: T.WATER });
  } else if (type === 'bridge' || type === 'pier') {
    const deck = box(p.w, 0.3, p.d, def.mat, p.h);
    group.add(deck);
    for (const s of [-1, 1]) {
      const rail = box(p.w, 0.8, 0.08, 'woodDark', p.h + 0.5);
      rail.position.z = s * (p.d / 2 - 0.05);
      if (type === 'bridge') group.add(rail);
    }
    footprints.push(rectFp(x, z, p.w, p.d, rot, { bridge: 1 }));
    if (type === 'bridge') for (const s of [-1, 1]) { // side rails block movement off the deck
      const ox = -Math.sin(rot) * s * (p.d / 2 + 0.25), oz = Math.cos(rot) * s * (p.d / 2 + 0.25);
      footprints.push(rectFp(x + ox, z + oz, p.w - 1, 0.5, rot, { block: B.LOW }));
    }
  } else {
    const build = BUILDERS[type] || BUILDERS[{ house: 'barracks', hut: 'barracks', hangar: 'barracks', train_car: 'barracks' }[type]];
    if (build) group.add(build(p, def, ctx));
    else group.add(box(p.w, p.h ?? 1, p.d, p.mat || def.mat || 'concrete')); // a spec's `mat` wins, as for barracks/walls
    if (p.block) footprints.push(rectFp(x, z, p.w, p.d, rot, { block: p.block }));
    if (type === 'watchtower') {
      interactables = [{ interactKind: 'climbable', x: x + Math.cos(rot + Math.PI / 2) * (p.d / 2 + 0.6), z: z + Math.sin(rot + Math.PI / 2) * (p.d / 2 + 0.6), elevation: p.h, top: { x, z } }];
    }
    if (type === 'gate') interactables = [{ interactKind: 'door', x, z, w: p.w, rot, locked: !!p.locked }];
  }
  if (params.destructible) {
    interactables = interactables || [];
    interactables.push({ interactKind: 'explosiveTarget', x, z, id: params.id, hp: params.hp ?? 100, radius: Math.max(p.w ?? 0, p.d ?? 0, (p.r ?? 1) * 2) / 2 });
  }
  const castsShadow = type !== 'crater' && type !== 'sea' && type !== 'lake';
  group.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow && castsShadow; });
  if (params.flag) { // garrison flag (design-spec §2.4 / §10.6) beside the placeholder
    const f = makeFlag({ pole: true, h: Math.max(5, (p.h ?? 3) + 2.5), theater: ctx.theater });
    f.position.set((p.w ?? 4) / 2 + 0.9, 0, (p.d ?? 4) / 2 - 0.2);
    group.add(f);
  }
  return { object3d: group, footprints, castsShadow, interactables };
}

export default buildProp;
