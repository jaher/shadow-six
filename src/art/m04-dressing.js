/**
 * M4 "Restore Pride" (Stokkan, March 1941) second art pass: the set pieces the mission's placeholders drew as plain
 * crate stacks and loose planks. Each builder works in the structure's local frame (props.js places the group at x, z,
 * rot) and keeps to the structure's footprint and height; what blocks stays the mission's footprint (crates `block`).
 *
 * - `raf_crates` (the air-drop, block 0): the supply crates where they came down at the edge of the NE woods, painted
 *   RAF green and stencilled, snow on their lids and drifted round them, the parachute's riser lying on the snow
 * - `parachute_spread` (sign, block 0): the canopy dragged out by the wind N of the container, lying flat on the snow
 *   (men walk over it): gores radiating from the vent, the folds bunched at the skirt, the rigging lines gathered to the
 *   container's riser; cream silk a shade warmer than the snow so it reads from the default camera
 * - `log_pile_long` (B.LOW): a Holzpolter of spruce logs by the dead siding in the yard waiting for a timber wagon
 *   (art/m20-dressing.js stack), its top and shoulders under snow
 * - `sleeper_stack` / `platelayer_stack` (B.LOW): creosoted sleepers stacked by the line; by the bridge the
 *   platelayers' store of spare rails on bearers beside them, snow on everything that faces up
 * @module art/m04-dressing
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, rng, seedOf, fbm, buildCrates } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { buildLogPile } from './m20-dressing.js';

/** The variants this module draws (props.js `crates` dispatch). */
export const M04_PIECE_RX = /^(raf_crates|log_pile_long|sleeper_stack|platelayer_stack)$/;

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box (world-scale UVs) centred at (x, y, z), turned `ry` about y. */
function box(w, h, d, mat, x, y, z, ry = 0, tile = 1.2) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}
/** Cylinder lying along local x (axis), radius r, length L, centred at (x, y, z); `open`: no caps. */
function hcyl(r, L, mat, x, y, z, { seg = 18, open = false, arc = Math.PI * 2, a0 = 0 } = {}) {
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, open, a0, arc);
  const uv = g.attributes.uv, k = (arc * r) / 1.2;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * (L / 1.2));
  g.rotateZ(Math.PI / 2);
  const m = mesh(g, mat); m.position.set(x, y, z);
  return m;
}
/** A soft snow mound (flattened noisy dome) rx × rz round (x, z), `h` high, its rim sunk a little into the ground. */
function snowMound(R, x, z, rx, rz, h, mat) {
  const g = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), P = g.attributes.position, s = R() * 100;
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i), py = P.getY(i), pz = P.getZ(i), a = Math.atan2(pz, px);
    const k = 1 + 0.16 * Math.sin(a * 3 + s) + 0.08 * Math.sin(a * 7 + s * 2);
    P.setXYZ(i, px * rx * k, py * h - 0.03, pz * rz * k);
  }
  g.computeVertexNormals();
  const m = mesh(g, mat, false); m.position.set(x, 0, z);
  return m;
}

let MATS = null;
function mats() {
  const snow = dressingMaterial('snow');
  if (MATS && MATS.snow === snow) return MATS;
  MATS = {
    snow,
    olive: paintedMaterial('steel', 0x3b4a2a, { roughness: 0.72 }),        // RAF dark green, weathered
    oliveDark: paintedMaterial('steel', 0x2a3320, { roughness: 0.8 }),
    cell: paintedMaterial('steel', 0x9c8b5c, { roughness: 0.8 }),          // the inner cells: khaki
    band: paintedMaterial('steel', 0xd2a72c, { roughness: 0.7 }),          // the reception party's colour band (contents)
    crate: paintedMaterial('planks', 0x6a7550),                              // the supply crates' boards, painted RAF green
    web: paintedMaterial('canvas', 0xb9ae8c),                               // webbing straps, the riser
    iron: dressingMaterial('castIron'),
    creosote: dressingMaterial('creosote'),
    rail: paintedMaterial('steel', 0x5b4434, { roughness: 0.85, metalness: 0.4 }), // rusted rail
    railHead: paintedMaterial('steel', 0x8d8a84, { roughness: 0.55, metalness: 0.7 }),
  };
  return MATS;
}

// ------------------------------------------------------------------------------------------ the air-drop container

const STENCIL = new Map();
/** White stencil lettering on a transparent ground (browser only; null in node). */
function stencilMaterial(text) {
  if (STENCIL.has(text)) return STENCIL.get(text);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(236,232,214,0.92)'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const [l1, l2] = String(text).split('\n');
  x.font = 'bold 54px sans-serif'; x.fillText(l1, 128, l2 ? 44 : 64);
  if (l2) { x.font = 'bold 34px sans-serif'; x.fillText(l2, 128, 98); }
  // stencil bridges: thin gaps through the letters
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000';
  for (let k = 0; k < 9; k++) x.fillRect(22 + k * 25, 0, 3, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, roughness: 0.8, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: `kit:stencil:${text.replace(/\W+/g, '_')}` });
  STENCIL.set(text, m);
  return m;
}

/**
 * The air-drop: the supply crates where they came down, painted RAF green, stencilled, snow on their lids and drifted
 * round them, the parachute's riser lying on the snow from them to the canopy. The crates are the placeholder's two
 * crates box for box (art/dressing.js buildCrates, the same seed): what a body keeps clear of round them, the walk to
 * the pickup N of them and the stores they hold are as before. The stencils lie on the faces, the snow on the lids
 * keeps inside them; the drift (snow under 0.6 m) is waded.
 */
export function buildRafCrates(p) {
  const M = mats(), g = new THREE.Group(); g.name = 'dressing:raf_crates';
  const stack = buildCrates({ ...p, variant: 'airdrop_crate' });
  stack.traverse((o) => { if (o.isMesh) o.material = M.crate; });
  g.add(stack);
  // (the crates as buildCrates laid them: two, side by side, each s × 0.8 s × s, turned a little)
  const R0 = rng(seedOf(p.id ?? `${p.x},${p.z}`)), cs = Math.min(p.w ?? 2, p.d ?? 2) * 0.55, R = rng(seedOf(`${p.id ?? 'raf'}:snow`));
  const crates = [0, 1].map((k) => { const sz = cs * (0.8 + R0() * 0.25); return { x: (k ? 1 : -1) * cs * 0.52, z: (R0() - 0.5) * 0.3, rot: (R0() - 0.5) * 0.35, s: sz }; });
  const labels = ['R.A.F.\nSTORES 41', 'R.A.F.\nNo. 7'];
  crates.forEach((c, k) => {
    const top = c.s * 0.8, frame = new THREE.Group(); frame.position.set(c.x, 0, c.z); frame.rotation.y = c.rot; g.add(frame);
    // snow on the lid (inside its edges)
    frame.add(snowCushion(c.s - 0.08, c.s - 0.08, 0.07, 0, top, 0, M.snow, R));
    const st = stencilMaterial(labels[k]);
    if (st) {
      const face = mesh(new THREE.PlaneGeometry(c.s * 0.8, c.s * 0.4), st, false);
      face.position.set(0, top * 0.5, c.s / 2); frame.add(face); // the face towards the camera (+z)
    }
  });
  // drift banked against the crates (low snow: waded, no body)
  g.add(snowMound(R, -0.3, 0.1, 0.95, 0.62, 0.22, M.snow));
  g.add(snowMound(R, 0.45, -0.05, 0.75, 0.55, 0.16, M.snow));
  // the riser: webbing from under the W crate out along the snow towards the canopy (N, −z)
  const riser = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.35, 0.05, -0.2), new THREE.Vector3(-0.42, 0.04, -0.62),
    new THREE.Vector3(-0.38, 0.03, -1.0), new THREE.Vector3(-0.5, 0.03, -1.4)]);
  g.add(mesh(new THREE.TubeGeometry(riser, 12, 0.022, 4, false), M.web, false));
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ the canopy

let SILK = null;
/** Cream silk (a shade warmer than the snow), vertex-shaded folds and gore seams; both faces drawn. */
function silkMaterial() {
  const base = dressingMaterial('canvas');
  if (SILK && SILK.userData.base === base.uuid) return SILK;
  SILK = base.clone(); SILK.userData.base = base.uuid; SILK.name = 'kit:silk_m04';
  // (no albedo map: the tent canvas's khaki greyed the silk; its weave stays in the normal map, faint)
  SILK.map = null; SILK.color.set(0xfbf3df); SILK.vertexColors = true; SILK.side = THREE.DoubleSide; SILK.roughness = 0.7;
  SILK.aoMapIntensity = 0.4; if (SILK.normalScale) SILK.normalScale.set(0.3, 0.3);
  // (fresh-fallen silk carries no snow: the theater's top-facing prop snow, art/terrain.js coverPropsWithSnow, leaves it)
  SILK.userData.snowCover = true;
  SILK.polygonOffset = true; SILK.polygonOffsetFactor = -1; SILK.polygonOffsetUnits = -1; // (lying a hand over the snow)
  return SILK;
}

/**
 * The crown heap: the placeholder's crumpled silk heap (art/kit-props.js parachute, the same seed: vertex for vertex), in
 * the canopy's silk with its gores and folds shaded.
 */
export function crownHeap(p) {
  const R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x);
    const fold = 1 + 0.18 * Math.sin(a * 7 + R() * 0.3) + 0.08 * (R() - 0.5);
    P.setXYZ(i, x * 1.4 * fold, y * 0.35 * (0.75 + 0.25 * Math.cos(a * 3)), z * 1.1 * fold);
  }
  geo.computeVertexNormals();
  const N = geo.attributes.normal, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const a = Math.atan2(P.getZ(i), P.getX(i)), f = ((a + Math.PI) / (Math.PI * 2)) * 12, gore = Math.floor(f) % 2 ? 0.87 : 1;
    const seam = Math.abs(f - Math.round(f)) < 0.08 ? 0.7 : 1, k = (0.76 + 0.24 * Math.max(0, N.getY(i))) * gore * seam;
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.98;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = mesh(geo, silkMaterial(), false); m.position.y = 0.02; m.castShadow = true;
  return m;
}

/**
 * The canopy dragged out by the wind (local frame: w along x, the vent at −x, the skirt at +x by the container; d
 * across): flat on the snow (≤ 0.08 m: block 0, men walk over it) but for the crown, where the air still trapped under
 * it heaps the silk up: the placeholder's silk heap, vertex for vertex (what a body keeps clear of there, as before).
 * The rigging lines run from the hem to the container's riser at `riser` (local [x, z]; default the +x end).
 */
export function buildParachuteSpread(p) {
  const R = rng(seedOf(p.id ?? 'canopy')), s = R() * 50, g = new THREE.Group(); g.name = 'dressing:parachute_spread';
  const W = p.w ?? 9, D = p.d ?? 5, x0 = -W / 2 + 0.2, x1 = W / 2 - 1.6, riser = p.riser ?? [W / 2 - 0.06, 0.04];
  const bl = p.billow ?? null; // (an extra dome; the crown heap is crownHeap below)
  const NU = 56, NV = 30, FOLDS = 4.5;
  const hw = (u) => (D / 2 - 0.15) * (0.28 + 0.72 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.55)) * (u > 0.82 ? 1 - (u - 0.82) * 2.4 : 1);
  const pos = [], col = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, x = x0 + (x1 - x0) * u, half = hw(u), bend = 0.22 * Math.sin(u * 2.6 + s);
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * 2 - 1, z = v * half + bend;
      const ph = FOLDS * v + 0.35 * Math.sin(u * 5 + s);                       // long folds converging on vent and skirt
      const ridge = Math.abs(Math.sin(Math.PI * ph));
      const edge = Math.min(1, (1 - Math.abs(v)) * 5) * Math.min(1, u * 14);  // the hem and the vent lie on the snow
      const lump = Math.max(0, fbm(x * 0.35, 0.5, z * 0.35, s | 0, 3) + 0.1) * 0.05 * Math.sin(Math.PI * u);
      const skirt = u > 0.78 ? ((u - 0.78) / 0.22) * 0.05 * Math.abs(Math.sin(v * 11 + s)) : 0;
      const q = bl ? ((x - bl.x) / bl.rx) ** 2 + ((z - bl.z) / bl.rz) ** 2 : 1, dome = q < 1 ? bl.h * Math.pow(1 - q, 0.6) : 0;
      const under = (x / 1.75) ** 2 + (z / 1.4) ** 2 < 1; // (under the crown heap: flat, the heap lies on it)
      // (the hem tucks into the snow: nothing of it floats over a dip in the ground)
      const flatY = under ? 0.02 : Math.min(0.08, -0.02 + 0.045 * Math.min(1, edge * 2) + edge * (0.035 * Math.pow(ridge, 1.4) + lump + skirt));
      const y = Math.max(flatY, dome + 0.035 * Math.pow(ridge, 1.4) * Math.min(1, dome * 6));
      pos.push(x, y, z); uv.push(x / 1.6, z / 1.6);
      // shading: fold valleys and the hem darker, the seams (fold crests) a thin darker line, the vent's rim
      const seam = Math.abs(ph - Math.round(ph)) < 0.06 ? 0.7 : 1, gore = (Math.floor(ph + 100) % 2) ? 0.87 : 1;
      const k = (0.8 + 0.2 * Math.pow(ridge, 0.7)) * seam * gore * (u < 0.035 ? 0.6 : 1) * (0.88 + 0.12 * edge);
      col.push(k, k, k * 0.98);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + NV + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const cloth = mesh(geo, silkMaterial(), false); cloth.name = 'dressing:parachute_spread';
  // the rigging lines: from the hem round the bunched skirt to the riser, lying in loose curves on the snow
  const cord = paintedMaterial('canvas', 0xcfc6ac), hwEnd = hw(0.96);
  for (let k = 0; k < 14; k++) {
    const v = (k / 13) * 2 - 1, ux = x1 - 0.25 - Math.abs(v) * 0.6, z = v * hwEnd * 1.15;
    const mid = new THREE.Vector3((ux + riser[0]) / 2 + (R() - 0.5) * 0.25, 0.03, (z + riser[1]) / 2 + (R() - 0.5) * 0.35);
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(ux, 0.06, z), mid, new THREE.Vector3(riser[0], 0.05, riser[1])]);
    g.add(mesh(new THREE.TubeGeometry(c, 10, 0.009, 3, false), cord, false));
  }
  // (the cloth and the crown keep their vertex colours: consolidate keeps position / normal / uv only)
  const out = consolidate(g); out.add(cloth, crownHeap(p));
  return out;
}

// ------------------------------------------------------------------------------------------ timber and permanent-way stores

/** A snow cushion lying along x over a strip `wd` wide, `L` long, its crown `t` thick at height y (rounded across). */
function snowCushion(L, wd, t, x, y, z, mat, R) {
  const g = new THREE.BoxGeometry(L, t, wd, Math.max(4, Math.round(L / 0.5)), 1, 6), P = g.attributes.position, sd = R() * 40;
  for (let i = 0; i < P.count; i++) {
    const px = P.getX(i), py = P.getY(i), pz = P.getZ(i), a = Math.abs(pz) / (wd / 2), e = Math.abs(px) / (L / 2);
    const crown = (1 - a * a) * (1 - Math.pow(e, 6)) * (0.85 + 0.3 * fbm(px * 0.8, 0.3, pz * 0.8, sd | 0, 2));
    P.setY(i, py > 0 ? -t / 2 + t * Math.max(0.15, crown) : -t / 2);
  }
  g.computeVertexNormals();
  const m = mesh(boxUV(g.toNonIndexed(), 1.5), mat, false); m.position.set(x, y + t / 2, z);
  return m;
}

/**
 * Holzpolter of spruce logs (art/m20-dressing.js) under snow on its top and shoulders, drawn half a metre inside the
 * footprint all round, on the loose boards and beams the placeholder drew (the same boards: what a body keeps clear of
 * round the pile, and so the walk round it, is as before).
 */
export function buildLongLogPile(p) {
  const M = mats(), R = rng(seedOf(p.id ?? 'logs')), w = (p.w ?? 7) - 1.0, d = (p.d ?? 3) - 0.9;
  const g = new THREE.Group(); g.name = 'dressing:log_pile_long';
  g.add(buildCrates({ ...p, variant: 'timber_debris' }));
  // (the stack's castle-kit meshes carry their per-log tones as vertex colours: added after consolidate)
  const stack = buildLogPile({ x: 0, z: 0, rot: 0, w, d, seed: seedOf(p.id ?? 'logs') % 997, name: 'log_pile_m04' });
  // (the stack's own measures: 5-4-3 logs of radius r_k on 0.16 m skids)
  const W2 = d / 2, r = (k) => ((W2 * 2 - 0.2) / 10) * (1 - k * 0.04), L = w - 0.3;
  const y1 = 0.16 + r(0) + r(1) * 1.62, y2 = y1 + r(2) * 1.62;
  g.add(snowCushion(L * 0.92, 6 * r(2) * 1.02, 0.14, (R() - 0.5) * 0.1, y2 + r(2) * 0.55, 0, M.snow, R));
  for (const sd of [-1, 1]) g.add(snowCushion(L * 0.86, r(1) * 1.3, 0.08, (R() - 0.5) * 0.2, y1 + r(1) * 0.6, sd * 3 * r(1) * 1.01, M.snow, R));
  const out = consolidate(g); out.add(stack);
  return out;
}

const SL = { len: 2.6, h: 0.16, w: 0.26 }; // a standard sleeper
/** A crib of sleepers along x on two cross bearers: `rows` per layer, `layers` high, centred at (x, z). */
function sleeperCrib(g, M, R, x, z, rows, layers, snow = true) {
  const span = rows * (SL.w + 0.02) - 0.02;
  for (const u of [-0.85, 0.85]) g.add(box(span + 0.1, SL.h, SL.w, M.creosote, x + u, SL.h / 2, z, Math.PI / 2 + (R() - 0.5) * 0.04));
  let y = SL.h;
  for (let l = 0; l < layers; l++) {
    for (let k = 0; k < rows; k++) {
      const zz = z - span / 2 + SL.w / 2 + k * (SL.w + 0.02) + (R() - 0.5) * 0.03;
      g.add(box(SL.len - (R() < 0.2 ? 0.2 : 0), SL.h, SL.w, M.creosote, x + (R() - 0.5) * 0.08, y + SL.h / 2, zz, (R() - 0.5) * 0.03));
    }
    y += SL.h;
  }
  if (snow) g.add(snowCushion(SL.len - 0.15, span - 0.05, 0.1, x, y, z, M.snow, R));
  return y;
}
/** Flat-bottom rail (foot 130 mm, head 66 mm, 145 mm high) `L` long along x, foot at y. */
function rail(M, L, x, y, z, ry = 0) {
  const s = new THREE.Shape();
  const P = [[-0.065, 0], [0.065, 0], [0.065, 0.012], [0.009, 0.026], [0.009, 0.1], [0.033, 0.112], [0.033, 0.145], [-0.033, 0.145], [-0.033, 0.112], [-0.009, 0.1], [-0.009, 0.026], [-0.065, 0.012]];
  s.moveTo(P[0][0], P[0][1]); for (const [a, b] of P.slice(1)) s.lineTo(a, b);
  const geo = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
  geo.translate(0, 0, -L / 2); geo.rotateY(Math.PI / 2);
  const m = mesh(boxUV(geo.index ? geo.toNonIndexed() : geo, 1.0), M.rail); m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

/** Sleepers stacked by the line (footprint w × d along x): as many crib rows as fit across, 4 layers. */
export function buildSleeperStack(p) {
  const M = mats(), R = rng(seedOf(p.id ?? 'sleepers')), d = p.d ?? 1.5, g = new THREE.Group(); g.name = 'dressing:sleeper_stack';
  sleeperCrib(g, M, R, 0, 0, Math.max(2, Math.floor((d - 0.08) / (SL.w + 0.02))), Math.max(2, Math.min(4, Math.round(((p.h ?? 1) - SL.h) / SL.h))));
  return consolidate(g);
}

/**
 * The platelayers' store by the bridge (w × d along x): a sleeper crib and spare rails on bearers, two spike kegs —
 * half a metre inside the footprint all round (a body's clearance round it stays inside the B.LOW footprint).
 */
export function buildPlatelayerStack(p) {
  const M = mats(), R = rng(seedOf(p.id ?? 'platelayer')), w = (p.w ?? 4) - 1.0, d = (p.d ?? 3) - 1.0, g = new THREE.Group(); g.name = 'dressing:platelayer_stack';
  sleeperCrib(g, M, R, -w / 2 + 1.3, -d / 2 + 0.52, 4, 3);
  // spare rails on three short bearers: three on the bearers, two more across them
  const zr = d / 2 - 0.42, Lr = Math.min(3.8, w - 0.1);
  for (const u of [-1, 0, 1]) g.add(box(0.95, 0.12, 0.2, M.creosote, u * (Lr / 2 - 0.25), 0.06, zr, Math.PI / 2));
  for (let k = 0; k < 3; k++) g.add(rail(M, Lr, (R() - 0.5) * 0.06, 0.12, zr - 0.3 + k * 0.3, (R() - 0.5) * 0.02));
  for (let k = 0; k < 2; k++) g.add(rail(M, Lr * 0.9, (R() - 0.5) * 0.1, 0.265, zr - 0.15 + k * 0.3, (R() - 0.5) * 0.03));
  // kegs of track spikes by the crib's end
  for (const [x, z] of [[w / 2 - 0.25, -d / 2 + 0.3], [w / 2 - 0.72, -d / 2 + 0.26]]) {
    const keg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.48, 12), M.creosote);
    keg.position.set(x, 0.24, z); keg.castShadow = keg.receiveShadow = true; g.add(keg);
    g.add(snowMound(R, x, z, 0.16, 0.16, 0.5, M.snow));
  }
  return consolidate(g);
}

/** variant → builder (props.js `crates`). */
export function buildM04Piece(p) {
  const v = String(p.variant ?? '');
  if (v === 'raf_crates') return buildRafCrates(p);
  if (v === 'log_pile_long') return buildLongLogPile(p);
  if (v === 'platelayer_stack') return buildPlatelayerStack(p);
  return buildSleeperStack(p);
}
