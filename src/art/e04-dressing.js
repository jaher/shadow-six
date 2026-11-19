/**
 * LIGHTS OUT mission 4 "Black Rain" (docs/expansion/e04.md §13): the colliery's art. Puits Sainte-Barbe, Lorraine,
 * August 1944, summer rain: wet cinders, black shale, rust and brick.
 *
 *  - E04_DRESSING: set dressing as mission structures (library assets and kit types: coal heaps, cable drums, rail
 *    buffers, the rusty bulldozer, tubs, drum stacks), every blocking piece ≥ 1 m off the beats, posts and the push rail;
 *  - E04_TREES: 3D trees (birch, poplar, alder, hedge) on the verge, the west road and the lagoon bank;
 *  - E04_FURNITURE: pit-head lamps, enamel boards and the level crossing's St Andrew's cross;
 *  - buildE04Art(world, o): the mission's own scenery, drawn once as the load ends (script.visuals), visual only:
 *      the spoil heap (a shale cone cut flat on top, rain gullies, ochre burnt-shale streaks, the switchback path, the
 *      incline's bed), the steel lattice headframe with its sheaves and ropes, the screens and washery (corrugated iron,
 *      monitor roof, the tipping tower, gantries, the conveyor gallery to the headframe), the DF hut with its turning
 *      loop aerial, the incline (rails, head frame, rope, the winch under its lean-to), loop aerials on the DF lorries,
 *      puddles on the cinders. The default meshes of the structures it redraws are hidden; their footprints stay.
 * @module art/e04-dressing
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const deg = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- dressing structures (gameplay-safe placements)
const prop = (id, variant, asset, x, z, rot, w, d, h, extra = {}) => ({ id, type: 'crates', variant, asset, x, z, rot: deg(rot), w, d, h, block: 1, visual: variant === 'vehicle_parked', fixed: true, ...extra });
export const E04_DRESSING = [
  // coal and slack heaps in the yard (low cover: crouch behind them)
  prop('coal_w', 'slag_heap', null, 44, 37, 0, 5.6, 5.6, 1.8, { type: 'rocks', label: 'Coal heap' }),
  prop('coal_e', 'slag_heap', null, 108.5, 31.5, 30, 5.6, 5.6, 1.8, { type: 'rocks', label: 'Coal heap' }),
  // rail buffers at the siding ends and the tramway end
  prop('buf_n_w', 'buffer_stop', null, 11.1, 18, 0, 1.4, 0.9, 1.4), prop('buf_s_w', 'buffer_stop', null, 17.1, 22.5, 0, 1.4, 0.9, 1.4),
  prop('buf_n_e', 'buffer_stop', null, 152.9, 18, 180, 1.4, 0.9, 1.4), prop('buf_s_e', 'buffer_stop', null, 56.9, 22.5, 180, 1.4, 0.9, 1.4),
  prop('buf_tram', 'buffer_stop', null, 178.6, 68, 180, 1.4, 0.9, 1.4),
  // cable drums and the rusty bulldozer by the heap's west foot, a drum stack behind the baths
  prop('drums_cable', 'cable_reels', null, 128.5, 31, 90, 4.4, 2.6, 1.5),
  prop('dozer', 'vehicle_parked', 'bulldozer_rusty', 162.6, 22.6, 70, 4.3, 2.7, 2.3, { label: 'Bulldozer' }),
  prop('drums_baths', 'oil_drums', null, 131.6, 58, 0, 2.4, 2.4, 1.3, { label: 'Oil drums' }),
  // tubs (mine carts) left by the smithy and on the verge of the screens' west yard
  { id: 'tub_1', type: 'train_car', variant: 'mine_cart', label: 'Tub', x: 95.5, z: 82.6, rot: deg(20), w: 1.8, d: 1.1, h: 1.2, block: 1, fixed: true },
  { id: 'tub_2', type: 'train_car', variant: 'mine_tipper', label: 'Tub', x: 84.4, z: 84.6, rot: deg(-15), w: 2.2, d: 1.3, h: 1.4, block: 1, fixed: true },
  { id: 'tub_3', type: 'train_car', variant: 'mine_cart', label: 'Tub', x: 47.5, z: 31.2, rot: deg(5), w: 1.8, d: 1.1, h: 1.2, block: 1, fixed: true },
];

// ---------------------------------------------------------------- trees and hedges (3D, never billboards)
const tree = (id, species, x, z, h, seed) => ({ id, type: 'tree', species, x, z, r: 0.45, h, seed, fixed: true });
const bush = (id, species, x, z, seed) => ({ id, type: 'bush', species, x, z, r: 1, h: 1.3, seed, fixed: true });
export const E04_TREES = [
  // the hedge the team starts behind, and a few trees on the north verge
  ...[2, 5, 8, 11, 14, 17, 20, 23].map((x, k) => bush(`hedge_${k + 1}`, 'hedge', x, 7.4 + (k % 2) * 0.3, 7100 + k)),
  tree('verge_1', 'poplar', 27, 3, 17, 7201), tree('verge_2', 'poplar', 33, 2.6, 18, 7202), tree('verge_3', 'birch', 58, 4, 11, 7203),
  tree('verge_4', 'birch', 63, 2.2, 12, 7204), tree('verge_5', 'alder', 96, 3.4, 10, 7205), tree('verge_6', 'poplar', 128, 2.8, 17, 7206),
  tree('verge_7', 'birch', 151, 4.2, 11, 7207), tree('verge_8', 'alder', 176, 3, 10, 7208), tree('verge_9', 'birch', 193, 5, 12, 7209),
  // poplars along the west road, scrub by the weighbridge
  tree('road_1', 'poplar', 6, 46, 18, 7301), tree('road_2', 'poplar', 13, 46, 17, 7302), tree('road_3', 'poplar', 6, 54.5, 18, 7303),
  bush('scrub_w1', 'shrub', 4, 64, 7311), bush('scrub_w2', 'hawthorn', 9, 70, 7312),
  // the lagoon bank: birch and willow on the slurry's edge
  tree('bank_1', 'willow', 22, 93.5, 9, 7401), tree('bank_2', 'birch', 31, 94.4, 10, 7402), tree('bank_3', 'alder', 170, 94.6, 9, 7403),
  tree('bank_4', 'birch', 183, 92.8, 11, 7404), bush('bank_s1', 'shrub', 190, 91, 7411), bush('bank_s2', 'shrub', 160, 94.5, 7412),
];

// ---------------------------------------------------------------- street furniture (visual: never touches the walk grid)
export const E04_FURNITURE = [
  { type: 'lamp', variant: 'platform', x: 102.6, z: 45, rot: 0, block: false },
  { type: 'lamp', variant: 'platform', x: 131, z: 45.4, rot: 0, block: false },
  { type: 'lamp', variant: 'platform', x: 164.5, z: 63.2, rot: 0, block: false },
  { type: 'lamp', variant: 'platform', x: 58.6, z: 63.6, rot: 0, block: false },
  { type: 'lamp', variant: 'wall_bracket', x: 149.7, z: 43.6, rot: deg(90), block: false },
  { type: 'sign', variant: 'andreaskreuz', x: 37, z: 9.0, rot: deg(-90), block: false },
  { type: 'sign', variant: 'andreaskreuz', x: 43.4, z: 15.4, rot: deg(90), block: false },
  { type: 'sign', variant: 'wehrmacht', x: 30.4, z: 47.6, rot: deg(-90), text: 'PUITS STE-BARBE\nZUTRITT VERBOTEN', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 159, z: 45.6, rot: deg(-90), text: 'SPERRGEBIET\nNACHRICHTEN', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 168.6, z: 64.6, rot: deg(180), text: 'SEILBAHN\nLEBENSGEFAHR', block: false },
];

// ---------------------------------------------------------------- procedural art helpers
const M = {};
function mats() {
  if (M.ready) return M;
  M.steelBlack = paintedMaterial('steel', 0x2b2d2f);
  M.steelRust = paintedMaterial('steel', 0x5b4434);
  M.iron = dressingMaterial('castIron');
  M.corr = dressingMaterial('corrRust');
  M.corrG = dressingMaterial('corrGalv');
  M.brick = dressingMaterial('brick');
  M.brickDark = dressingMaterial('brickDark');
  M.planks = dressingMaterial('planks');
  M.board = paintedMaterial('weatherboard', 0x5d5446);
  M.tar = dressingMaterial('tarPaper');
  M.glass = dressingMaterial('glassDirty');
  M.concrete = dressingMaterial('concrete');
  M.beam = dressingMaterial('beam');
  M.rope = paintedMaterial('steel', 0x1e1d1c);
  M.white = paintedMaterial('canvas', 0xd9d4c6);
  M.ballast = dressingMaterial('ballast');
  M.creosote = dressingMaterial('creosote');
  M.ready = true;
  return M;
}
function bx(g, w, h, d, mat, x, y, z, ry = 0, tile = 2) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
function cyl(g, r, h, mat, x, y, z, rx = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** A square member of side `t` from a to b ([x, y, z]). */
function strut(g, a, b, t, mat) {
  _a.set(...a); _b.set(...b);
  const L = _a.distanceTo(_b);
  if (L < 1e-3) return null;
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(t, L, t).toNonIndexed(), 1), mat);
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
/** A wire / rope from a to b, sagging `sag` m at mid-span. */
function rope(g, a, b, r, mat, sag = 0, seg = 10) {
  let prev = a;
  for (let k = 1; k <= seg; k++) {
    const t = k / seg, s = 4 * t * (1 - t) * sag;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - s, a[2] + (b[2] - a[2]) * t];
    const m = strut(g, prev, p, r * 2, mat);
    if (m) m.castShadow = false;
    prev = p;
  }
}
/** A spoked wheel (sheave) of radius r in the plane facing ±x (axle along x). */
function sheave(g, x, y, z, r, mat) {
  const w = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.06, 6, 28), mat);
  rim.rotation.y = Math.PI / 2; rim.castShadow = true; w.add(rim);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, s = strut(w, [0, 0, 0], [0, Math.sin(a) * r, Math.cos(a) * r], r * 0.07, mat);
    if (s) s.castShadow = true;
  }
  cyl(w, r * 0.16, r * 0.3, mat, 0, 0, 0, 0, Math.PI / 2);
  w.position.set(x, y, z);
  g.add(w);
  return w;
}

// ---------------------------------------------------------------- the spoil heap (a heightfield)
function distToPoly(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx2, bz] = poly[(i + 1) % poly.length], dx = bx2 - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Azimuths (radians, round the heap's centre) of its main rain gullies. */
const GULLIES = [-2.95, -2.6, -2.1, -1.75, -1.3, -0.75, -0.42, 0.06, 0.32, 0.78, 1.12, 1.6, 2.02, 2.4, 2.72];
const hash = (x, z) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The heap's smooth profile (no gullies, no bench): for shading the gullies. */
function heapBase(x, z, o) {
  if (inPoly(x, z, o.top)) return o.topY;
  return o.topY * Math.pow(Math.max(0, 1 - distToPoly(x, z, o.top) / 9.6), 1.12);
}
/**
 * A material sampling its colour map by world position on three planes (tri-planar): no stretch on a steep flank.
 * Its normal / AO / roughness maps are not used (set them null).
 */
export function triplanar(mat, scale) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTri = { value: scale };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;\nuniform float uTri;')
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        'vec3 triW = pow(abs(vTriN), vec3(4.0)); triW /= (triW.x + triW.y + triW.z);',
        'vec4 triC = texture2D(map, vTriP.zy * uTri) * triW.x + texture2D(map, vTriP.xz * uTri) * triW.y + texture2D(map, vTriP.xy * uTri) * triW.z;',
        'diffuseColor *= triC;',
        '#endif'].join('\n'));
  };
  mat.customProgramCacheKey = () => `e04-triplanar-${scale}`;
  return mat;
}
/**
 * The heap's surface height at (x, z): flat at `topY` on the top, a shale slope (≈ 55°, a concave toe) down to the
 * yard, rain gullies cut into the flanks; the switchback path, its landing and the incline's bed follow their own
 * lines (the walk heights the grid carries). Below the yard (−0.3) where there is no heap.
 */
export function heapHeight(x, z, o) {
  const Y = o.topY, R = 9.6;
  // the walk lines: the path's two legs, the landing, the pocket, the incline bed
  const A = o.pathA, B = o.pathB;
  const leg = (L, w) => {
    const [ax, az, ay] = L.a, [bx2, bz, by] = L.b, dx = bx2 - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    const t = ((x - ax) * dx + (z - az) * dz) / len2, off = Math.abs((x - ax) * dz - (z - az) * dx) / Math.sqrt(len2);
    // (+1e-6: a grid column exactly on a leg's edge — path A's west side, x 190.0 — must not fall outside it by rounding,
    // or the pocket cutting's ceiling cuts a slot 3–7 m deep between the top and the path's upper end)
    return t >= -0.02 && t <= 1.02 && off <= w + 1e-6 ? ay + (by - ay) * Math.max(0, Math.min(1, t)) : null;
  };
  const la = leg(A, A.width / 2), lb = leg(B, B.width / 2);
  if (la != null) return la - 0.02;
  if (lb != null) return lb - 0.02;
  if (inPoly(x, z, o.landing)) return o.landingY - 0.02;
  if (inPocket(x, z, o)) {
    // a grassy hollow at the heap's foot, its floor easing up into the banks, open to the woods beyond the east edge
    const e = Math.min(x - 194.5, z - 42, 50.5 - z);
    return -0.2 + 0.35 * Math.pow(Math.max(0, 1 - e / 1.6), 2) + (vnoise(x * 0.7, z * 0.7) - 0.5) * 0.08;
  }
  if (inPoly(x, z, o.top)) return Y - 0.02;
  const d = distToPoly(x, z, o.top), ang0 = Math.atan2(z - o.cz, x - o.cx);
  // a ragged toe (never out past the gameplay footprint: R only shrinks) and a lumpy, slumped profile
  const Rr = R * (0.9 + 0.1 * vnoise(ang0 * 3.1 + 7, 1.3));
  let h = Y * Math.pow(Math.max(0, 1 - d / Rr), 1.12 + 0.25 * vnoise(ang0 * 2.3, 4.4));
  // the heap runs on to the east map edge north and south of the pocket
  if (x > 190.5) {
    // the heap's east foot runs on to the map edge north and south of the pocket: a slope easing down towards the
    // edge and into the pocket's hollow (no flat-topped slab, no sheer pit walls)
    const dp = Math.hypot(Math.max(194.5 - x, 0), Math.max(42 - z, 0, z - 50.5)), k = Math.min(1, dp / 3.4), ramp = k * k * (3 - 2 * k);
    const fadeNS = Math.max(0, 1 - Math.max(0, z - 58) / 6) * Math.max(0, 1 - Math.max(0, 17 - z) / 2);
    const xr = Math.min(1, (x - 190.5) / 4), rise = xr * xr * (3 - 2 * xr);
    const he = (5.2 - 0.32 * Math.max(0, x - 194) + (vnoise(x * 0.45, z * 0.45) - 0.5) * 1.1) * ramp * fadeNS * rise;
    h = Math.max(h, he);
  }
  // a tipping bench round the heap half way up (the old tip line), broad rain gullies, lumps of spoil
  if (d > 0 && h > 0.3) {
    const hb = 9.5, bw = 1.6;
    if (Math.abs(h - hb) < bw * 1.6) h = hb + (h - hb) * Math.min(1, Math.pow(Math.abs(h - hb) / (bw * 1.6), 1.6));
    const ang = Math.atan2(z - o.cz, x - o.cx), band = Math.sin(Math.PI * Math.min(1, d / R));
    GULLIES.forEach((a0, gi) => {
      // each gully its own width and depth, wandering a little as it runs down
      let da = ang - a0 - 0.08 * (vnoise(d * 0.35, gi * 1.7) - 0.5); da -= Math.PI * 2 * Math.round(da / (Math.PI * 2));
      const wk = 0.55 + 0.7 * rnd(gi * 3.7), across = Math.abs(da) * (6 + d), half = (0.5 + d * 0.2) * wk;
      if (across < half * 1.8) h -= band * (0.7 + 0.9 * rnd(gi * 1.3) + 0.4 * vnoise(d * 0.5, a0 * 3)) * Math.pow(Math.max(0, 1 - across / (half * 1.8)), 1.7);
    });
    // fine rain rills running straight down the flank, and slumped lumps of spoil
    const rill = Math.pow(Math.abs(Math.sin(ang * 46 + 3 * vnoise(d * 0.4, ang * 9))), 8);
    h -= rill * band * 0.32;
    h += (vnoise(x * 0.28, z * 0.28) - 0.5) * 1.1 * band + (vnoise(x * 0.9, z * 0.9) - 0.5) * 0.45 * band + (vnoise(x * 2.3, z * 2.3) - 0.5) * 0.16;
  }
  // the walk lines are cut into the heap or built out from it: a cutting rising above them, an embankment falling away
  // below, both at about the spoil's angle of repose (ragged), never a sheer wall or a causeway in the air
  h = walkClamp(x, z, h, o);
  // the incline's straight bed from its foot to its top stop (a cutting above, an embankment at the toe)
  const I = o.incline, ix = I.a[0];
  if (Math.abs(x - ix) < 2.8 && z <= I.a[1] + 0.6 && z >= I.b[1] - 0.6) {
    const yLine = Math.max(0, Math.min(Y, I.a[2] + (I.b[2] - I.a[2]) * ((I.a[1] - z) / (I.a[1] - I.b[1]))));
    if (Math.abs(x - ix) <= 1.5) h = yLine - 0.15;
  }
  // the paths' outer edges and the landing's lip: never above the walk line next to them by more than a kerb
  return h < 0.05 ? -0.3 : h;
}

/**
 * The worked faces of the heap: where the walk lines force a near-vertical step (under the switchback's upper leg and its
 * north end, round the rim of the top where the paths cut in) the heightfield's step is faced with bedded tip layers —
 * black shale, burnt red, pink and ochre beds, each its own recess, harder beds standing out as ledges, vertical joints —
 * leaning out from the upper edge to a foot buried in the scree below (so the bare step never shows).
 */
function buildFaces(o, mat, lips = []) {
  const A = o.pathA, xe = A.a[0] + A.width / 2, xw = A.a[0] - A.width / 2;
  // (the top's rim gets a face only where a path cuts in deep; the switchback's own edges wherever they step)
  const segs = o.top.map((p, i) => [p, o.top[(i + 1) % o.top.length], 5]);
  segs.push([[xe, A.b[1]], [xe, A.a[1]], 1.0], [[xw, A.a[1]], [xe, A.a[1]], 1.0]);
  const parts = [];
  segs.forEach(([a, b, minDrop], si) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    // outward = the lower side
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let nx = -uz, nz = ux;
    if (heapHeight(mx + nx * 0.8, mz + nz * 0.8, o) > heapHeight(mx - nx * 0.8, mz - nz * 0.8, o)) { nx = -nx; nz = -nz; }
    const NT = Math.max(2, Math.ceil(len / 0.25)), cols = [];
    let drop = 0;
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * len, x = a[0] + ux * t, z = a[1] + uz * t;
      const hi = heapHeight(x - nx * 0.1, z - nz * 0.1, o);
      const lo = Math.min(heapHeight(x + nx * 0.6, z + nz * 0.6, o), heapHeight(x + nx * 0.8, z + nz * 0.8, o), heapHeight(x + nx * 1.0, z + nz * 1.0, o));
      cols.push({ x, z, hi, lo });
      if (hi - lo > minDrop) drop = Math.max(drop, hi - lo);
    }
    if (!drop) return;
    // (the foot follows the scree smoothly, not the heightfield's 0.5 m steps; a face fades out at its ends, shrinking
    // up into the crest as an outcrop, never a panel standing on its own)
    const lo0 = cols.map((c) => c.lo), w0 = cols.map((c) => Math.max(0, Math.min(1, (c.hi - c.lo - minDrop * 0.55) / (minDrop * 0.45))));
    cols.forEach((c, i) => {
      let sum = 0, ws = 0, n = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(cols.length - 1, i + 3); j++) { sum += lo0[j]; ws += w0[j]; n++; }
      c.lo = Math.min(lo0[i], sum / n); c.w = Math.min(w0[i], ws / n); c.face = c.w > 0.02;
    });
    cols.forEach((c, i) => { if (c.face && c.w > 0.6) lips.push({ x: c.x, z: c.z, hi: c.hi, lo: c.lo, nx, nz, along: (i / NT) * len + si * 31, si }); });
    const NR = Math.min(64, Math.max(3, Math.ceil(drop / 0.3))), pos = [], col = [], idx = [], seed = si * 17.3;
    cols.forEach(({ x, z, hi, lo, face, w }, i) => {
      const along = (i / NT) * len + si * 31;
      for (let r = 0; r <= NR; r++) {
        if (!face) { pos.push(x, hi - 0.05, z); col.push(0.1, 0.1, 0.1); continue; }
        const f = r / NR, lipUp = r === 0 && si >= o.top.length ? 0.16 * w * Math.max(0, vnoise(along * 0.9 + 5, si) * 1.6 - 0.6) : 0;
        const y = hi + lipUp + (lo - 1.0 - hi) * f * w, dt = hi - y;
        // tip beds of uneven thickness that dip and pinch out along the face (a warped bed coordinate)
        const bc = y / 0.7 + 1.1 * vnoise(y * 0.31 + si, 1.7) + 0.7 * vnoise(along * 0.07, y * 0.15 + si), L = Math.floor(bc), fr = bc - L;
        const joint = Math.pow(Math.abs(Math.sin(along * (0.9 + 0.5 * rnd(L + seed)) + 2.6 * vnoise(along * 0.17, L * 0.7))), 10);
        const rec = 0.04 + 0.5 * rnd(L * 7.3 + seed) + (fr < 0.16 ? 0.22 : 0) - 0.26 * joint
          + 0.22 * (vnoise(along * 0.8, y * 0.7) - 0.5) + 0.08 * (vnoise(along * 3.3, y * 3.1) - 0.5);
        const out = (0.04 + 0.84 * f + Math.max(0, rec) * Math.min(1, Math.max(0, dt) / 0.6)) * w - lipUp * 0.8;
        pos.push(x + nx * out, y, z + nz * out);
        // the bed's colour: black and dark grey shale mostly, a few dull burnt beds (brick red, pinkish grey, rare ochre)
        const pick = rnd(L * 3.1 + seed), n2 = 0.8 + 0.4 * vnoise(along * 0.6 + 7, y * 1.1);
        const c = pick < 0.5 ? [0.07, 0.068, 0.066] : pick < 0.72 ? [0.12, 0.116, 0.11] : pick < 0.88 ? [0.2, 0.12, 0.095] : pick < 0.96 ? [0.26, 0.2, 0.18] : [0.24, 0.19, 0.12];
        const sh = n2 * (joint > 0.3 ? 0.6 : 1) * (fr < 0.16 ? 1.15 : 1) * (0.85 + 0.15 * Math.min(1, dt / 2));
        col.push(c[0] * sh, c[1] * sh, c[2] * sh);
      }
    });
    // (winding: the face is seen from the outward side)
    const flip = (-uz * nx + ux * nz) < 0;
    for (let i = 0; i < NT; i++) for (let r = 0; r < NR; r++) {
      const v = i * (NR + 1) + r, w = v + NR + 1;
      if (flip) idx.push(v, w, v + 1, w, w + 1, v + 1); else idx.push(v, v + 1, w, w, v + 1, w + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
  mesh.name = 'e04:heap-faces'; mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Distance from (x, z) to a path leg's strip and the leg's walk height at the nearest point. */
function legNear(x, z, L) {
  const [ax, az, ay] = L.a, [bx2, bz, by] = L.b, dx = bx2 - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const t = ((x - ax) * dx + (z - az) * dz) / (len * len), tc = Math.max(0, Math.min(1, t));
  const off = Math.abs((x - ax) * dz - (z - az) * dx) / len, over = Math.max(0, -t, t - 1) * len;
  return { d: Math.hypot(Math.max(0, off - L.width / 2), over), y: ay + (by - ay) * tc };
}
/** The exit pocket, open eastward past the map edge into the woods (the heap mesh runs on to x 206). */
const inPocket = (x, z, o) => x >= o.pocket[0][0] && z >= o.pocket[0][1] && z <= o.pocket[2][1];
function walkClamp(x, z, h, o) {
  // (the slope steepens away from the line: a cutting / embankment is local, the heap beyond keeps its own shape)
  const k = 0.75 + 0.4 * vnoise(x * 0.55 + 11, z * 0.55), q = 0.32, lip = 0.12 + 0.18 * vnoise(x * 1.7, z * 1.7 + 5);
  const P = o.pocket, dPocket = Math.hypot(Math.max(P[0][0] - x, 0), Math.max(P[0][1] - z, 0, z - P[2][1]));
  const I = o.incline, bed = { a: I.a, b: I.b, width: 3 };
  const lines = [{ d: dPocket, y: -0.2, bank: false }, legNear(x, z, o.pathA), legNear(x, z, o.pathB), legNear(x, z, bed),
    { d: inPoly(x, z, o.landing) ? 0 : distToPoly(x, z, o.landing), y: o.landingY }];
  // where a lower line's cutting and a higher line's embankment cannot both fit (the switchback's legs lie 2.6 m apart
  // with up to 17 m between them) the cutting wins: the step stands under the higher line's edge, where buildFaces
  // draws it as a worked face
  let ceil = Infinity, floor = -Infinity;
  for (const { d, y, bank = true } of lines) {
    if (d > 12) continue;
    const grow = k * d + q * d * d;
    ceil = Math.min(ceil, y + lip + grow);
    if (bank) floor = Math.max(floor, y - 0.06 - grow * 1.05);
  }
  return Math.min(Math.max(h, floor), ceil);
}

function buildHeap(world, o) {
  const m = mats(), x0 = 158, x1 = 206, z0 = 12, z1 = 66, step = 0.5;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const cx = o.cx, cz = o.cz;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i, h = heapHeight(x, z, o);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 3; uv[k * 2 + 1] = (z + h * 0.6) / 3;
    // shale: near-black, darker and wetter in the gullies, lighter on the trodden top and the bench, ochre burnt-shale
    // streaks near the toe, a little grass greening the old toe
    const n = vnoise(x * 0.35, z * 0.35), streak = Math.pow(vnoise(Math.atan2(z - cz, x - cx) * 5, 1.7), 5);
    const base = heapBase(x, z, o), dip = Math.max(0, base - h);
    let r = 0.13 + 0.05 * n, gC = 0.125 + 0.045 * n, b = 0.13 + 0.04 * n;
    const top = h > o.topY - 0.1;
    if (top) { r += 0.07; gC += 0.065; b += 0.055; }
    // the switchback and its landing: trodden ash tracks, browner and lighter, with darker wheel / boot ruts
    const onWalk = legNear(x, z, o.pathA).d === 0 || legNear(x, z, o.pathB).d === 0 || inPoly(x, z, o.landing);
    if (onWalk && !top) {
      const t = 0.6 + 0.4 * vnoise(x * 1.3, z * 1.3); r = 0.2 * t + 0.03; gC = 0.17 * t + 0.025; b = 0.14 * t + 0.02;
      // the trodden band frays out along the switchback's worked edge (spill and crumbs darken its last ¾ m in ragged
      // bites): the lip is no ruled line
      const PA = o.pathA, eA = Math.min(PA.a[0] + PA.width / 2 - x, PA.a[1] - z);
      if (legNear(x, z, PA).d === 0 && eA < 0.75) {
        const bite = Math.min(1, Math.max(0, vnoise(z * 0.85 + 2.3, x * 0.9 + 7.7) * 1.7 - 0.5) * (1.15 - eA / 0.75));
        r += (0.1 - r) * bite; gC += (0.095 - gC) * bite; b += (0.09 - b) * bite;
      }
    }
    if (!top) { const k2 = Math.min(1, dip / 1.2); r -= 0.06 * k2; gC -= 0.06 * k2; b -= 0.05 * k2; }
    if (!top && Math.abs(h - 9.5) < 0.6) { r += 0.05; gC += 0.045; b += 0.04; }
    if (!top && h < 7 && h > 0) { const t = streak * (1 - h / 7); r += 0.24 * t; gC += 0.12 * t; b += 0.02 * t; }
    if (h > 0 && h < 1.2) { const t = (1 - h / 1.2) * vnoise(x * 0.6, z * 0.6); gC += 0.06 * t; r += 0.01 * t; }
    // burnt shale (the heap smouldered once): rusty pink-ochre patches on the lower and middle flanks
    if (!top && h > 0.5 && h < 13) { const t = Math.max(0, vnoise(x * 0.16 + 3, z * 0.16) - 0.55) * 2.6; r += 0.2 * t; gC += 0.075 * t; b += 0.03 * t; }
    // pale grey dry patches on the old tip faces, and fine dark wet rills
    if (!top && h > 1) { const t = Math.max(0, vnoise(x * 0.45, z * 0.45 + 9) - 0.68) * 2.2; r += 0.08 * t; gC += 0.08 * t; b += 0.08 * t; }
    col[k * 3] = r; col[k * 3 + 1] = gC; col[k * 3 + 2] = b;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b2 = a + 1, c = a + nx, d = c + 1;
    // skip quads wholly under the yard (no heap there)
    if (pos[a * 3 + 1] < 0 && pos[b2 * 3 + 1] < 0 && pos[c * 3 + 1] < 0 && pos[d * 3 + 1] < 0) continue;
    idx.push(a, c, b2, b2, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = m.ballast.clone();
  mat.vertexColors = true;
  mat.color = new THREE.Color(0xffffff);
  mat.normalMap = null; mat.aoMap = null; mat.roughnessMap = null; mat.metalnessMap = null;
  mat.roughness = 0.78; mat.metalness = 0;
  mat.name = 'e04:shale';
  triplanar(mat, 1 / 2.2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'e04:heap';
  mesh.receiveShadow = true; mesh.castShadow = true;
  // loose shale: angular slabs and fragments, each its own shape, size and tone (mostly near-black, some burnt red,
  // some weathered grey), sunk into the surface; thickest at the toe and down the gullies, sparse on the open flank,
  // none on the top, the walk lines or the incline's bed
  const ico = new THREE.IcosahedronGeometry(1, 0), ip = ico.attributes.position, frags = [];
  /** One fragment: a jittered icosahedron `sc` across, `flat` its height ratio, sunk a third into the surface at y. */
  const lump = (k, x, z, hh, sc, flat, dark = false) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(ip.count * 3), col = new Float32Array(ip.count * 3);
    const sx = sc * (1 + 0.7 * rnd(k * 1.9)), sy = sc * (flat + 0.3 * rnd(k * 2.3)), sz = sc * (0.8 + 0.5 * rnd(k * 2.9));
    const ry = rnd(k * 6.1) * Math.PI * 2, tilt = (rnd(k * 8.3) - 0.5) * 0.7, cy = Math.cos(ry), sy2 = Math.sin(ry);
    // (the lip's lumps are the face's own shale: near-black and dark grey, now and then a burnt bed's red)
    const tone = rnd(k * 9.1), base = dark ? (tone < 0.12 ? [0.085, 0.047, 0.034] : tone < 0.45 ? [0.05, 0.048, 0.046] : [0.032, 0.031, 0.03])
      : tone < 0.14 ? [0.3, 0.16, 0.11] : tone < 0.24 ? [0.2, 0.2, 0.19] : [0.085, 0.082, 0.08];
    for (let v = 0; v < ip.count; v++) {
      // (jitter keyed on the original corner: the faces meeting there move together, no cracks)
      const ox = ip.getX(v), oy = ip.getY(v), oz = ip.getZ(v), f = 0.7 + 0.6 * rnd(k * 13 + Math.round(ox * 7) * 3 + Math.round(oy * 7) * 5 + Math.round(oz * 7) * 11);
      let px = ox * f * sx, py = oy * f * sy, pz = oz * f * sz;
      const ty = py * Math.cos(tilt) - px * Math.sin(tilt); px = px * Math.cos(tilt) + py * Math.sin(tilt); py = ty;
      pos[v * 3] = x + px * cy - pz * sy2; pos[v * 3 + 1] = hh - sy * 0.35 + py; pos[v * 3 + 2] = z + px * sy2 + pz * cy;
      const sh = 0.85 + 0.3 * rnd(k * 17 + v); col[v * 3] = base[0] * sh; col[v * 3 + 1] = base[1] * sh; col[v * 3 + 2] = base[2] * sh;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  const lips = [], faces = buildFaces(o, mat, lips);
  const lineD = (x, z) => Math.min(legNear(x, z, o.pathA).d, legNear(x, z, o.pathB).d, inPoly(x, z, o.landing) ? 0 : distToPoly(x, z, o.landing));
  for (let k = 0; k < 6000 && frags.length < 760; k++) {
    const x = x0 + 2 + rnd(k * 1.31) * (x1 - x0 - 4), z = z0 + 1 + rnd(k * 2.77 + 5) * (z1 - z0 - 2), hh = heapHeight(x, z, o);
    if (hh <= 0.02 || hh > o.topY - 0.5 || Math.abs(x - o.incline.a[0]) < 2.2 || lineD(x, z) < 0.6 || inPoly(x, z, o.pocket)) continue;
    const dip = Math.max(0, heapBase(x, z, o) - hh), want = hh < 2.5 ? 0.85 : dip > 0.6 ? 0.6 : 0.16;
    if (rnd(k * 7.7 + 1) > want) continue;
    const big = hh < 2.2 && rnd(k * 3.3) < 0.12, sc = big ? 0.32 + 0.3 * rnd(k * 5.1) : 0.06 + 0.2 * Math.pow(rnd(k * 4.1), 2.2);
    frags.push(lump(k, x, z, hh, sc, 0.3));
  }
  // the worked faces' lips: lumps broken off the cut edge, in clusters with gaps between, sitting on the lip or hanging
  // over it, and a few fallen to the face's foot (they break the ruled line a cut path leaves along its face)
  lips.forEach((L, i) => {
    const k = 20011 + i * 1.37, cl = vnoise(L.along * 0.42 + 3.1, L.si * 1.7);
    // (clear of the walkers: the step from the switchback's top onto the top, the skip's landing by the incline)
    if ((L.si === o.top.length + 1 && L.x < 191.2) || Math.abs(L.x - o.incline.a[0]) < 2.5) return;
    if (rnd(k * 1.3) > 0.1 + 0.6 * cl * cl) return;
    const off = -0.18 + 0.3 * rnd(k * 2.1), sc = 0.08 + 0.16 * Math.pow(rnd(k * 3.7), 1.4) * (0.4 + cl);
    frags.push(lump(k, L.x + L.nx * off, L.z + L.nz * off, L.hi + 0.03, sc, 0.5, true));
    if (L.hi - L.lo > 3 && rnd(k * 5.3) < 0.16) {
      const d = 0.9 + 1.3 * rnd(k * 6.1), fx = L.x + L.nx * d, fz = L.z + L.nz * d;
      frags.push(lump(k + 0.5, fx, fz, heapHeight(fx, fz, o), 0.16 + 0.22 * rnd(k * 7.9), 0.45, true));
    }
  });
  const fragMat = m.shaleFrag ??= new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0, name: 'e04:shale-frag' });
  const fm = new THREE.Mesh(mergeGeometries(frags, false), fragMat);
  fm.name = 'e04:heap-shale'; fm.castShadow = true; fm.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh, fm, faces);
  return g;
}


// ---------------------------------------------------------------- the headframe (steel lattice, sheaves, deck y 14)
function buildHeadframe(o) {
  const m = mats(), g = new THREE.Group();
  g.name = 'e04:headframe';
  const [cx, cz] = [o.x, o.z], Hd = 23.5, deckY = o.deckY;
  const leg = (sx, sz) => [cx + sx * 3.1, 0, cz + sz * 3.1];
  const head = (sx, sz) => [cx + sx * 1.15, Hd, cz + sz * 1.5];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(g, leg(sx, sz), head(sx, sz), 0.36, m.steelBlack);
  // lattice bracing on each face, every ~2.8 m
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let y = 0; y < Hd - 1; y += 2.8) {
    const t0 = y / Hd, t1 = Math.min(1, (y + 2.8) / Hd);
    for (const [s1, s2] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      const a0 = lerp(leg(...s1), head(...s1), t0), b0 = lerp(leg(...s2), head(...s2), t0);
      const a1 = lerp(leg(...s1), head(...s1), t1), b1 = lerp(leg(...s2), head(...s2), t1);
      strut(g, a0, b1, 0.12, m.steelBlack); strut(g, b0, a1, 0.12, m.steelBlack);
      strut(g, a0, b0, 0.16, m.steelBlack);
    }
  }
  // the sentry's deck at y 14 (steel plate, railings) and the sheave platform at the head
  const dw = 2 * (3.1 - (3.1 - 1.15) * (deckY / Hd)) + 1.2, dd = 2 * (3.1 - (3.1 - 1.5) * (deckY / Hd)) + 1.2;
  bx(g, dw, 0.16, dd, m.steelRust, cx, deckY - 0.08, cz);
  for (const s of [-1, 1]) {
    strut(g, [cx - dw / 2, deckY + 1.05, cz + s * dd / 2], [cx + dw / 2, deckY + 1.05, cz + s * dd / 2], 0.06, m.steelBlack);
    strut(g, [cx + s * dw / 2, deckY + 1.05, cz - dd / 2], [cx + s * dw / 2, deckY + 1.05, cz + dd / 2], 0.06, m.steelBlack);
    for (const t of [-0.5, 0, 0.5]) strut(g, [cx + t * dw, deckY, cz + s * dd / 2], [cx + t * dw, deckY + 1.05, cz + s * dd / 2], 0.05, m.steelBlack);
  }
  bx(g, 3.4, 0.2, 4.2, m.steelRust, cx, Hd + 0.1, cz);
  for (const s of [-1, 1]) sheave(g, cx, Hd + 2.1, cz + s * 0.95, 2.0, m.steelBlack);
  for (const s of [-1, 1]) strut(g, [cx - 1.4, Hd + 0.2, cz + s * 0.95], [cx + 1.4, Hd + 0.2, cz + s * 0.95], 0.25, m.steelBlack);
  // back-stays down to the engine-house side (west), the winding ropes to its upper wall
  for (const s of [-1, 1]) strut(g, [cx - 1.15, Hd - 1, cz + s * 1.4], [o.backX, 0, cz + s * 2.6], 0.3, m.steelBlack);
  for (const s of [-1, 1]) rope(g, [cx - 1.2, Hd + 2.1 + 1.95, cz + s * 0.95], [o.drumX, o.drumY, o.drumZ + s * 0.6], 0.03, m.rope, 0.6);
  // the shaft collar: a brick kerb round the mouth with the cage gate on its south side
  bx(g, 5.2, 0.7, 5.2, m.brickDark, cx, 0.35, cz);
  bx(g, 3.6, 0.72, 3.6, m.iron, cx, 0.36, cz);
  bx(g, 2.2, 2.0, 0.08, m.steelBlack, cx, 1.0, cz + 2.65);
  // a ladder up the north-east leg to the deck
  for (let y = 0.4; y < deckY; y += 0.35) strut(g, [cx + 3.2, y, cz - 3.6], [cx + 3.7, y, cz - 3.6], 0.04, m.steelBlack);
  for (const dx of [3.2, 3.7]) strut(g, [cx + dx, 0, cz - 3.6], [cx + dx, deckY + 1, cz - 3.6], 0.06, m.steelBlack);
  return consolidate(g);
}

// ---------------------------------------------------------------- the screens and washery
function buildScreens(o) {
  const m = mats(), g = new THREE.Group();
  g.name = 'e04:screens';
  const { x: cx, z: cz, w, d } = o, H = 10.5, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  // the long shed: corrugated iron on a steel frame (rusty sheets, a few galvanised replacements)
  bx(g, w - 12, H, d, m.corr, cx - 6, H / 2, cz, 0, 2.5);
  for (let x = x0 + 1; x < x1 - 12; x += 4) { bx(g, 0.3, H + 0.1, d + 0.12, m.steelBlack, x, H / 2, cz); }
  bx(g, 6, 3.4, 0.06, m.corrG, x0 + 14, H - 2.4, z1 + 0.04);
  bx(g, 5, 4.2, 0.06, m.corrG, x0 + 21, 3.5, z0 - 0.04);
  // the gabled roof with a glazed monitor along the ridge
  const roofW = w - 12, half = d / 2 + 0.5, pitch = deg(18), slope = half / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const r = bx(g, roofW + 0.6, 0.12, slope, m.corr, cx - 6, H + Math.tan(pitch) * half / 2, cz + s * half / 2, 0, 2.5);
    r.rotation.x = s * pitch;
  }
  const ridgeY = H + Math.tan(pitch) * half;
  bx(g, roofW - 4, 1.4, 3.2, m.corr, cx - 6, ridgeY + 0.4, cz);
  for (const s of [-1, 1]) bx(g, roofW - 4.2, 0.9, 0.05, m.glass, cx - 6, ridgeY + 0.45, cz + s * 1.62);
  bx(g, roofW - 3.6, 0.12, 3.8, m.corr, cx - 6, ridgeY + 1.15, cz);
  // long strip windows (dirty glass) under the eaves
  // (1 cm behind the frame columns' faces: the glass's outer face was flush with them, z-fighting — zfight.mjs)
  for (const s of [-1, 1]) bx(g, roofW - 6, 1.1, 0.06, m.glass, cx - 6, H - 1.4, cz + s * (d / 2 + 0.02));
  // the tipping tower at the east end (taller, brick base, hipped iron roof)
  const tx = x1 - 6, TH = 15.5;
  bx(g, 12, 4, d, m.brickDark, tx, 2, cz, 0, 2);
  bx(g, 12, TH - 4, d, m.corr, tx, 4 + (TH - 4) / 2, cz, 0, 2.5);
  const hip = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(6, d / 2) * 1.02, 3.4, 4, 1), m.corr);
  hip.position.set(tx, TH + 1.7, cz); hip.rotation.y = Math.PI / 4; hip.scale.set(1, 1, d / 12); hip.castShadow = true;
  g.add(hip);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) bx(g, 1.6, 1.3, 0.06, m.glass, tx - 3.5 + k * 3.5, TH - 3, cz + s * (d / 2 + 0.03));
  // big sliding doors: west, south, east
  bx(g, 0.08, 5.2, 5.5, m.planks, x0 - 0.04, 2.6, cz);
  bx(g, 5.5, 5.2, 0.08, m.planks, cx, 2.6, z1 + 0.04);
  bx(g, 0.08, 4.2, 4.4, m.planks, x1 + 0.04, 2.1, cz + 1.5);
  // the gantries at y 8 (grating, brackets, railings) and the east ladder
  for (const [gz, gx0, gx1, s] of [[o.gantryN, o.gN0, o.gN1, -1], [o.gantryS, o.gS0, o.gS1, 1]]) {
    const outZ = gz + s * 0.35;
    bx(g, gx1 - gx0, 0.08, 1.2, m.steelRust, (gx0 + gx1) / 2, 7.96, outZ + s * 0.25);
    strut(g, [gx0, 9.05, outZ + s * 0.85], [gx1, 9.05, outZ + s * 0.85], 0.05, m.steelBlack);
    for (let x = gx0; x <= gx1 + 1e-6; x += 2) {
      strut(g, [x, 8, outZ + s * 0.85], [x, 9.05, outZ + s * 0.85], 0.05, m.steelBlack);
      strut(g, [x, 8, outZ + s * 0.85], [x, 6.6, gz - s * 0.2], 0.08, m.steelBlack);
    }
  }
  // the conveyor gallery from the headframe to the tipping tower (corrugated box on a steel trestle)
  const ga = [o.galleryFrom[0], o.galleryFrom[1], o.galleryFrom[2]], gb = [x1 + 0.2, 12.4, cz - 1.5];
  const gl = new THREE.Group(), L = Math.hypot(gb[0] - ga[0], gb[1] - ga[1], gb[2] - ga[2]);
  bx(gl, L, 2.3, 2.2, m.corr, 0, 0, 0, 0, 2.5);
  bx(gl, L + 0.2, 0.1, 2.5, m.corr, 0, 1.2, 0, 0, 2.5);
  for (const s of [-1, 1]) bx(gl, L - 1, 0.5, 0.05, m.glass, 0, 0.5, s * 1.12);
  gl.position.set((ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2, (ga[2] + gb[2]) / 2);
  gl.rotation.order = 'YZX';
  gl.rotation.y = -Math.atan2(gb[2] - ga[2], gb[0] - ga[0]);
  gl.rotation.z = Math.atan2(gb[1] - ga[1], Math.hypot(gb[0] - ga[0], gb[2] - ga[2]));
  g.add(gl);
  const mid = [(ga[0] + gb[0]) / 2, 0, (ga[2] + gb[2]) / 2];
  for (const s of [-1, 1]) strut(g, [mid[0] - 0.9 * s, 0, mid[2] + 1.2], [mid[0], (ga[1] + gb[1]) / 2 - 1.1, mid[2]], 0.22, m.steelBlack);
  for (const s of [-1, 1]) strut(g, [mid[0] - 0.9 * s, 0, mid[2] - 1.2], [mid[0], (ga[1] + gb[1]) / 2 - 1.1, mid[2]], 0.22, m.steelBlack);
  return consolidate(g);
}

// ---------------------------------------------------------------- the DF hut and its loop aerial
function buildDfHut(world, o) {
  const m = mats(), g = new THREE.Group(), y = o.y;
  g.name = 'e04:dfhut';
  const { x, z, w, d, h } = o;
  bx(g, w, h, d, m.board, x, y + h / 2, z, 0, 1.5);
  // (the posts stop 3 cm under the wall top: their tops were flush with it, z-fighting along the eaves — zfight.mjs)
  for (let k = -2; k <= 2; k++) bx(g, 0.1, h - 0.03, 0.12, m.beam, x + k * (w / 4.4), y + (h - 0.03) / 2, z + d / 2 + 0.02);
  const roof = bx(g, w + 0.6, 0.14, d + 0.7, m.tar, x, y + h + 0.25, z);
  roof.rotation.x = deg(-6);
  bx(g, 0.95, 2.0, 0.06, m.planks, x, y + 1.0, z + d / 2 + 0.04); // door (south)
  for (const s of [-1, 1]) bx(g, 0.9, 0.7, 0.05, m.glass, x + s * 1.5, y + 1.7, z + d / 2 + 0.04);
  bx(g, 0.05, 0.7, 0.9, m.glass, x - w / 2 - 0.03, y + 1.7, z);
  cyl(g, 0.09, 1.4, m.iron, x - 1.5, y + h + 0.8, z - 0.6); // stove pipe
  // the loop aerial: a mast through the roof, a bearing ring, the loop (turns, render-time only)
  cyl(g, 0.07, 2.4, m.steelBlack, x + 0.6, y + h + 1.3, z);
  cyl(g, 0.32, 0.12, m.steelBlack, x + 0.6, y + h + 2.5, z);
  const loop = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 8, 32), m.white);
  ring.position.y = 1.15; ring.castShadow = true;
  loop.add(ring);
  strut(loop, [0, 0, 0], [0, 0.1, 0], 0.08, m.steelBlack);
  loop.position.set(x + 0.6, y + h + 2.55, z);
  g.add(loop);
  loop.onBeforeRender = () => { loop.rotation.y = (world.time || 0) * 0.35; };
  ring.onBeforeRender = loop.onBeforeRender;
  // the generator and the field cable, a whip aerial guyed to the ground, sandbags along the west side
  bx(g, 1.4, 0.9, 0.8, paintedMaterial('steel', 0x4d5038), x - w / 2 - 1.3, y + 0.45, z + 1.2);
  rope(g, [x - w / 2 - 0.6, y + 0.6, z + 1.2], [x - w / 2, y + 1.2, z + 0.8], 0.02, m.rope, 0.15, 4);
  cyl(g, 0.03, 7, m.steelBlack, x + w / 2 + 0.8, y + 3.5, z - 1.4);
  for (const [dx, dz] of [[2.2, 0], [-1.2, 1.8], [-1.2, -1.8]]) rope(g, [x + w / 2 + 0.8, y + 6.6, z - 1.4], [x + w / 2 + 0.8 + dx, y, z - 1.4 + dz], 0.012, m.rope, 0.05, 3);
  const st = consolidate(g);
  st.add(loop); // (the turning loop stays its own mesh)
  return st;
}

// ---------------------------------------------------------------- the incline: bed, rails, head frame, rope, the winch
function buildIncline(o) {
  const m = mats(), g = new THREE.Group();
  g.name = 'e04:incline';
  const [ax, az, ay] = o.a, [bx2, bz, by] = o.b, L = Math.hypot(bx2 - ax, bz - az, by - ay);
  const at = (t, off = 0) => [ax + off, ay + (by - ay) * t, az + (bz - az) * t];
  for (let t = 0; t <= 1.0001; t += 0.6 / L) { // sleepers
    const p = at(t);
    const s = bx(g, 2.3, 0.12, 0.22, m.creosote, p[0], p[1] - 0.06, p[2]);
    s.rotation.x = Math.atan2(by - ay, az - bz) * 0; // (flat sleepers on the stepped bed read best from above)
  }
  for (const off of [-0.7, 0.7]) strut(g, at(0, off).map((v, i) => (i === 1 ? v + 0.05 : v)), at(1, off).map((v, i) => (i === 1 ? v + 0.05 : v)), 0.1, m.iron);
  // the head frame at the top stop: an A-frame with the return sheave, the rope down to the winch drum
  const top = [bx2, by, bz - 1.3];
  for (const s of [-1, 1]) strut(g, [top[0] + s * 1.3, by, top[2] + 0.6], [top[0], by + 3.1, top[2]], 0.18, m.beam);
  strut(g, [top[0], by, top[2] - 1.2], [top[0], by + 3.1, top[2]], 0.16, m.beam);
  sheave(g, top[0], by + 3.0, top[2], 0.7, m.steelBlack);
  rope(g, [top[0], by + 2.6, top[2] + 0.3], [o.winch[0] + 0.4, 1.2, o.winch[1] - 0.2], 0.025, m.rope, 0.4, 14);
  // the winch under its lean-to on the winding house's east side
  const [wx, wz] = o.winch;
  cyl(g, 0.48, 1.3, m.iron, wx, 0.85, wz, 0, Math.PI / 2, 16);
  for (const s of [-1, 1]) bx(g, 0.12, 1.1, 1.0, m.steelBlack, wx + s * 0.75, 0.55, wz);
  strut(g, [wx + 0.8, 0.4, wz + 0.4], [wx + 1.1, 1.6, wz + 0.6], 0.06, m.steelRust); // brake lever
  const hx = o.house.x + 3.3; // the house's east wall
  for (const [px, pz] of [[hx + 2.4, wz - 1.6], [hx + 2.4, wz + 1.6]]) strut(g, [px, 0, pz], [px, 2.5, pz], 0.14, m.beam);
  const lean = bx(g, 2.9, 0.1, 3.8, m.corr, hx + 1.35, 2.85, wz);
  lean.rotation.z = deg(12);
  return consolidate(g);
}

/** Loop aerials on the two DF lorries' bodies. */
function dressLorries(world, ids) {
  const m = mats();
  for (const id of ids) {
    const v = world.byId?.(id) || world.vehicles?.find((q) => q.id === id || q.tag === id);
    const o = v?.object3d;
    if (!o || o.userData.e04Loop) continue;
    o.userData.e04Loop = true;
    const g = new THREE.Group();
    cyl(g, 0.04, 0.9, m.steelBlack, 0, 0.45, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.035, 6, 20), m.white);
    ring.position.y = 1.2; ring.castShadow = true;
    g.add(ring);
    g.position.set(0, 3.05, -1.2); // on the cargo box roof, towards its tail
    o.add(g);
  }
}

/** Distance from (x, z) to the polyline `pts`. */
function distToLine(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx2, bz] = pts[i], dx = bx2 - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
/**
 * The pit yard's wet cinders: a dark bed of ash and coal dust over the yard's ground (visual only, the grid's ground
 * stays `ground`), soft-edged on the verge, the slurry and the roads, blacker round the screens and the sidings.
 * No z-fighting with the track beds (zfight.mjs kind d: the bed 3.5 cm over the ground crossed the 3 cm ballast and its
 * shoulders at a few degrees, a flickering band along the sidings and the tramway): the bed is not drawn over a
 * track's ballast (a fragment test against the tracks' ballast footprint, `tracks`: the mission's rail_track
 * polylines), and its quads wholly under a ballast bed are not built.
 */
function buildYardBed(world, o) {
  const m = mats(), step = 1, x0 = 0, x1 = 193, z0 = 14.6, z1 = 88;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 4), uv = new Float32Array(nx * nz * 2);
  const ground = world.terrain?.surfaceAt ? (x, z) => world.terrain.surfaceAt(x, z) : () => 0;
  const sat = (v) => Math.max(0, Math.min(1, v));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i, n = vnoise(x * 0.21, z * 0.21), n2 = vnoise(x * 0.9 + 7, z * 0.9);
    pos[k * 3] = x; pos[k * 3 + 1] = (ground(x, z) || 0) + 0.035; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 2.2; uv[k * 2 + 1] = z / 2.2;
    // soft edges: the fence line, the slurry (z ≈ 71 between x 40 and 176, z ≈ 88 west of it), the roads, the map edge
    const south = x >= 40 && x <= 176 ? 70.8 + (n - 0.5) * 2.4 : 87.6 + (n - 0.5) * 1.6;
    let a = sat((z - 15.0) / 1.2) * sat((south - z) / 1.6) * sat((x1 - 0.5 - x) / 1.5);
    a *= sat((distToLine(x, z, o.roads[0]) - 2.0) / 1.6) * sat((distToLine(x, z, o.roads[1]) - 1.4) / 1.4);
    a *= 0.82 + 0.18 * n2;
    // coal dust round the screens and along the sidings, oily black near the lorries, lighter ash elsewhere
    const coal = Math.max(sat(1 - Math.max(0, Math.abs(z - 35) - 8) / 6) * sat(1 - Math.max(0, Math.abs(x - 78) - 24) / 8), sat(1 - Math.abs(z - 20.2) / 4.5) * 0.7);
    const v = 0.3 + 0.12 * n - 0.13 * coal - 0.07 * n2;
    col[k * 4] = v * 1.02; col[k * 4 + 1] = v * 0.99; col[k * 4 + 2] = v * 0.97; col[k * 4 + 3] = a;
  }
  const tracks = (o.tracks || []).filter((t) => t?.length >= 2);
  const underBallast = (k) => tracks.some((t) => distToLine(pos[k * 3], pos[k * 3 + 2], t) < BALLAST_HALF);
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b2 = a + 1, c = a + nx, d = c + 1;
    if (col[a * 4 + 3] + col[b2 * 4 + 3] + col[c * 4 + 3] + col[d * 4 + 3] < 0.02) continue;
    if (underBallast(a) && underBallast(b2) && underBallast(c) && underBallast(d)) continue;
    idx.push(a, c, b2, b2, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = m.ballast.clone();
  mat.vertexColors = true; mat.transparent = true; mat.depthWrite = false;
  mat.color = new THREE.Color(0xffffff);
  mat.aoMap = null; mat.metalnessMap = null; mat.metalness = 0; mat.roughness = 0.72;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
  mat.name = 'e04:cinders';
  if (tracks.length) clearTrackBeds(mat, tracks);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'e04:cinders'; mesh.receiveShadow = true; mesh.renderOrder = -1;
  return mesh;
}

/** Half-width of a track's ballast bed at its toe (art/kit-terrain.js buildRailTrack: bw / 2 = 1.5 m), + 5 cm. */
const BALLAST_HALF = 1.55;
/**
 * The cinders' fragments over a track's ballast are discarded (its segments, each run on 0.4 m past its ends as the
 * track ribbon's joint extension). Chained onto the material's own onBeforeCompile (anti-tiling).
 */
function clearTrackBeds(mat, tracks) {
  const segs = [];
  for (const t of tracks) for (let i = 1; i < t.length; i++) {
    const [ax, az] = t[i - 1], [bx, bz] = t[i], L = Math.hypot(bx - ax, bz - az) || 1, ex = (bx - ax) / L * 0.4, ez = (bz - az) / L * 0.4;
    segs.push(new THREE.Vector4(ax - (i === 1 ? ex : 0), az - (i === 1 ? ez : 0), bx + (i === t.length - 1 ? ex : 0), bz + (i === t.length - 1 ? ez : 0)));
  }
  const n = segs.length, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    sh.uniforms.uCinTrk = { value: segs };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCinXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCinXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCinXZ;\nuniform vec4 uCinTrk[${n}];`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  for (int i = 0; i < ${n}; i++) {
    vec2 a = uCinTrk[i].xy, ab = uCinTrk[i].zw - a;
    float t = clamp(dot(vCinXZ - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    if (length(vCinXZ - a - ab * t) < ${BALLAST_HALF.toFixed(2)}) discard;
  }`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|cinTrk${n}`;
}

/** The water tower's tank weathered to painted steel (the library model ships whitewashed for the desert). */
function weatherWaterTower(world) {
  const o = world.structures?.get?.('water_tower')?.object3d;
  if (!o || o.userData.e04Tint) return !!o?.userData.e04Tint;
  let n = 0;
  o.traverse((q) => {
    if (!q.isMesh || !q.material || q.userData.e04Tint) return;
    const list = Array.isArray(q.material) ? q.material : [q.material];
    const out = list.map((mt) => {
      if (!mt.color) return mt;
      const c = mt.color, lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
      if (lum < 0.55) return mt;
      const k = mt.clone(); k.color = new THREE.Color(0x6c6a62); n++;
      return k;
    });
    q.material = Array.isArray(q.material) ? out : out[0];
    q.userData.e04Tint = true;
  });
  if (n) o.userData.e04Tint = true;
  return n > 0;
}

/** Deterministic 0…1 from a seed. */
const rnd = (seed) => { const h = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return h - Math.floor(h); };
/**
 * Wet cinders: rain puddles in the ruts and hollows — each its own ragged outline (no two alike, no clean ovals),
 * merged into one dark, glossy mesh lying on the ground.
 */
function buildPuddles(points) {
  const parts = [];
  points.forEach(([x, z, a, b, rot], k) => {
    const n = 22, sh = new THREE.Shape();
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      // a lobed, ragged rim: two low harmonics and a little per-vertex jitter
      const r = 1 + 0.22 * Math.sin(2 * t + rnd(k * 7.1) * 6) + 0.14 * Math.sin(3 * t + rnd(k * 3.3) * 6) + 0.1 * (rnd(k * 31 + i) - 0.5);
      const px = Math.cos(t) * a * r, pz = Math.sin(t) * b * r * (0.85 + 0.3 * rnd(k + i * 0.37));
      if (i === 0) sh.moveTo(px, pz); else sh.lineTo(px, pz);
    }
    const g = new THREE.ShapeGeometry(sh, 2);
    g.rotateX(-Math.PI / 2); g.rotateY(-(rot || 0)); g.translate(x, 0.045, z);
    parts.push(g);
    // a satellite or two: the water runs on along the rut
    for (let q = 0; q < 2; q++) {
      if (rnd(k * 5 + q) < 0.45) continue;
      const g2 = g.clone(), sc = 0.28 + 0.25 * rnd(k * 9 + q);
      g2.translate(-x, 0, -z); g2.scale(sc, 1, sc);
      const ang = (rot || 0) + (q ? Math.PI : 0) + (rnd(k + q) - 0.5);
      g2.translate(x + Math.cos(ang) * a * (1.25 + 0.4 * rnd(q + k)), 0.002, z + Math.sin(ang) * a * (1.25 + 0.4 * rnd(q + k)));
      parts.push(g2);
    }
  });
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.name = 'e04:puddle';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'e04:puddles';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The yard's colliery props (their structures are gameplay only, `visual: false`): pit-prop stacks (round props laid in
 * crossed tiers), slag heaps (lumpy, near-black), buffer stops (timber beams on rail posts), cable reels on their rims,
 * oil-drum clusters (some down, rust and black paint). Merged per material.
 */
function buildYardProps(world) {
  const m = mats(), by = new Map(), add = (mat, g) => { if (!by.has(mat)) by.set(mat, []); by.get(mat).push(g.toNonIndexed()); };
  const place = (g, x, y, z, ry = 0, rx = 0, rz = 0) => { g.rotateX(rx); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, z); return g; };
  const wood = m.propWood ??= paintedMaterial('weatherboard', 0x7a6248), woodDark = m.woodDark ??= paintedMaterial('weatherboard', 0x4a3a2c);
  const drumBlack = m.drumBlack ??= paintedMaterial('steel', 0x22231f), drumRust = m.drumRust ??= paintedMaterial('steel', 0x6a3f24);
  const slag = m.slag ??= (() => { const mm = m.ballast.clone(); mm.vertexColors = true; mm.color = new THREE.Color(0xffffff); mm.normalMap = null; mm.roughness = 0.85; mm.name = 'e04:slag'; triplanar(mm, 1 / 1.6); return mm; })();
  for (const st of world.structures?.values?.() ?? []) {
    const d = st.def ?? st.spawn ?? st, v = String(d.variant ?? ''), x = d.x, z = d.z, rot = d.rot ?? 0, seed = (x * 13.7 + z * 7.3) | 0;
    if (x == null || z == null) continue;
    const c = Math.cos(rot), sn = Math.sin(rot), at = (u, w) => [x + u * c - w * sn, z + u * sn + w * c];
    if (v === 'timber_stack') {
      // round pit props in tiers, each tier crossing the one below, ends ragged; every stack its own height (some
      // drawn down to a few tiers), the top tier part taken, a few props dropped askew beside it
      const L = d.w ?? 4.2, W = d.d ?? 1.8, H = (d.h ?? 2.4) * (0.4 + 0.6 * rnd(seed * 1.7)), r = 0.11, jr = (rnd(seed * 2.3) - 0.5) * 0.22;
      const c2 = Math.cos(rot + jr), s2 = Math.sin(rot + jr), at2 = (u, w) => [x + u * c2 - w * s2, z + u * s2 + w * c2];
      const tiers = Math.max(2, Math.floor((H - r) / (2 * r * 0.92)));
      for (let tier = 0, y = r; tier < tiers; tier++, y += 2 * r * 0.92) {
        const along = tier % 3 !== 2, n = along ? Math.floor(W / (2 * r)) - (tier % 2) : Math.floor(L / (2 * r * 1.2));
        for (let k = 0; k < n; k++) {
          if (tier === tiers - 1 && rnd(seed + k * 3.1) < 0.45) continue;
          const off = (k - (n - 1) / 2) * 2 * r * (along ? 1.02 : 1.2), len = (along ? L : W) * (0.9 + 0.12 * rnd(seed + tier * 31 + k));
          const [px, pz] = along ? at2((rnd(seed + k + tier) - 0.5) * 0.3, off) : at2(off, 0);
          add(rnd(seed * 3 + k + tier * 7) < 0.25 ? woodDark : wood, place(new THREE.CylinderGeometry(r * (0.85 + 0.3 * rnd(k + tier)), r, len, 7), px, y, pz, -(rot + jr) + (along ? 0 : Math.PI / 2), 0, Math.PI / 2));
        }
      }
      for (let k = 0; k < 4; k++) {
        if (rnd(seed * 5 + k) < 0.4) continue;
        const [px, pz] = at2((rnd(seed + k * 7) - 0.5) * L * 1.1, (k % 2 ? 1 : -1) * (W / 2 + 0.35 + 0.5 * rnd(k + seed)));
        add(wood, place(new THREE.CylinderGeometry(r, r * 0.9, L * (0.5 + 0.4 * rnd(k * 3 + seed)), 7), px, r, pz, -(rot + jr) + (rnd(seed + k) - 0.5) * 1.4, 0, Math.PI / 2));
      }
    } else if (v === 'slag_heap') {
      // a lumpy, near-black coal and slag heap: a displaced dome, wet streaks, a few loose lumps
      const R = (d.w ?? 5.6) / 2, H = d.h ?? 1.8, g = new THREE.IcosahedronGeometry(1, 3).toNonIndexed(), p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        let vx = p.getX(i), vy = Math.max(0, p.getY(i)), vz = p.getZ(i);
        const n = vnoise(vx * 2.3 + seed, vz * 2.3) * 0.5 + vnoise(vx * 5.1, vz * 5.1 + seed) * 0.25;
        vx *= R * (0.85 + 0.3 * n); vz *= R * (0.85 + 0.3 * n); vy = vy * H * (0.75 + 0.5 * n);
        p.setXYZ(i, vx, vy, vz);
        const k2 = 0.09 + 0.06 * n; col[i * 3] = k2; col[i * 3 + 1] = k2 * 0.98; col[i * 3 + 2] = k2 * 0.95;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      add(slag, place(g, x, -0.05, z, -rot));
      for (let k = 0; k < 7; k++) { const a = rnd(seed + k) * Math.PI * 2, rr = R * (0.9 + 0.5 * rnd(k * 3 + seed)), lump = new THREE.DodecahedronGeometry(0.18 + 0.2 * rnd(k + seed * 2), 0).toNonIndexed();
        const cc = new Float32Array(lump.attributes.position.count * 3).fill(0.11); lump.setAttribute('color', new THREE.BufferAttribute(cc, 3)); add(slag, place(lump, x + Math.cos(a) * rr, 0.1, z + Math.sin(a) * rr, a)); }
    } else if (v === 'buffer_stop') {
      // a timber buffer beam on two rail posts, braced back to the sleepers, the beam's face scarred
      for (const w of [-0.55, 0.55]) { const [px, pz] = at(0, w); add(m.iron, place(new THREE.BoxGeometry(0.16, 1.05, 0.16), px, 0.52, pz, -rot)); const [bx2, bz] = at(0.75, w); add(m.iron, place(new THREE.BoxGeometry(1.1, 0.1, 0.1), (px + bx2) / 2, 0.45, (pz + bz) / 2, -rot, 0, -0.62)); }
      const [qx, qz] = at(-0.1, 0); add(woodDark, place(new THREE.BoxGeometry(0.28, 0.34, 1.75), qx, 0.92, qz, -rot));
      for (const w of [-0.5, 0.5]) { const [bx2, bz] = at(-0.32, w); add(m.iron, place(new THREE.CylinderGeometry(0.12, 0.14, 0.24, 10), bx2, 0.92, bz, -rot, 0, Math.PI / 2)); }
    } else if (v === 'cable_reels') {
      // wooden cable reels: two on their rims side by side (axles across the row), one laid flat, rope wound on the drums
      for (let k = 0; k < 3; k++) {
        const R = 0.62 + 0.1 * rnd(seed + k * 2), flat = k === 2;
        const [px, pz] = at(flat ? 1.25 : (k - 0.5) * 1.6 - 0.6, (rnd(seed + k) - 0.5) * 0.5);
        const ry = -rot + Math.PI / 2 + (rnd(k + seed) - 0.5) * 0.35;
        if (flat) {
          for (const e of [0.035, 0.81]) add(wood, place(new THREE.CylinderGeometry(R, R, 0.07, 16), px, e, pz));
          add(m.rope, place(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.74, 14), px, 0.42, pz));
        } else {
          for (const e of [-0.42, 0.42]) add(wood, place(new THREE.CylinderGeometry(R, R, 0.07, 16), 0, 0, 0, 0, 0, Math.PI / 2).translate(e, 0, 0).rotateY(ry).translate(px, R, pz));
          add(m.rope, place(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.78, 14), 0, 0, 0, 0, 0, Math.PI / 2).rotateY(ry).translate(px, R, pz));
        }
      }
    } else if (v === 'oil_drums') {
      // a cluster of drums, black and rusted, two lying on their sides
      for (let k = 0; k < 8; k++) {
        const down = k >= 6, [px, pz] = at(((k % 3) - 1) * 0.66 + (down ? 0.3 : 0), (Math.floor(k / 3) - 1) * 0.66 + (rnd(seed + k) - 0.5) * 0.1);
        add(rnd(seed + k * 5) < 0.4 ? drumRust : drumBlack, place(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12), px, down ? 0.29 : 0.44, pz + (down ? 0.9 : 0), -rot + rnd(k) * 3, 0, down ? Math.PI / 2 : 0));
      }
    }
  }
  const g = new THREE.Group();
  g.name = 'e04:yard-props';
  for (const [mat, list] of by) { const mesh = new THREE.Mesh(mergeGeometries(list, false), mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); }
  return g;
}
const PUDDLES = [[46, 52, 2.2, 1.1, 0.3], [62, 61, 1.6, 0.9, -0.2], [79, 47.5, 2.6, 1.0, 0.1], [96, 60, 1.4, 0.8, 0.5], [104, 70.5, 2.4, 1.2, 0],
  [118, 66.2, 1.8, 0.7, 0.05], [133, 63.4, 2.0, 0.9, -0.1], [151, 61.6, 1.7, 1.1, 0.4], [160, 70.4, 2.8, 1.3, 0.2], [128, 47.6, 1.4, 0.8, 0],
  [86, 75, 2.3, 1.4, 0.7], [70, 88, 3.0, 1.5, -0.3], [118, 86, 2.6, 1.2, 0.2], [146, 82, 3.2, 1.4, -0.5], [24, 50.6, 1.6, 0.8, 0], [56, 22, 1.2, 0.5, 0]];

/**
 * The mission's own scenery (script.visuals): built once as the load ends (idempotent; no sim state).
 * @param {object} world
 * @param {object} o geometry from the mission def (top, topY, rings, pocket, pathA, pathB, landing, incline, …)
 */
export function buildE04Art(world, o) {
  if (!world?.scene || world._e04Art) return;
  world._e04Art = true;
  const root = new THREE.Group();
  root.name = 'e04:art';
  const hide = (id) => { const s = world.structures?.get?.(id); if (s?.object3d) s.object3d.visible = false; };
  for (const id of ['heap_r0', 'heap_r1', 'heap_r2', 'heap_en', 'heap_es', 'heap_top', 'heap_pocket', 'heap_path_a', 'heap_landing', 'heap_path_b', 'screens', 'headframe', 'df_hut']) hide(id);
  const cx = o.top.reduce((s, p) => s + p[0], 0) / o.top.length, cz = o.top.reduce((s, p) => s + p[1], 0) / o.top.length;
  root.add(buildHeap(world, { ...o, cx, cz, landingY: o.landingY ?? 9 }));
  root.add(buildHeadframe({ x: o.shaftFrame[0], z: o.shaftFrame[1], deckY: 14, backX: 115.6, drumX: 112.6, drumY: 7.2, drumZ: o.shaftFrame[1] + 2 }));
  root.add(buildScreens({ x: 78, z: 35, w: 44, d: 14, gantryN: 28.35, gN0: 70.4, gN1: 99.6, gantryS: 41.65, gS0: 70.4, gS1: 92.6,
    galleryFrom: [o.shaftFrame[0] - 2.4, 15.5, o.shaftFrame[1] - 1.5] }));
  root.add(buildDfHut(world, { ...o.dfHut, y: o.topY }));
  root.add(buildIncline({ a: o.incline.a, b: o.incline.b, winch: o.winch, house: o.house }));
  root.add(buildPuddles(PUDDLES));
  root.add(buildYardProps(world));
  root.add(buildYardBed(world, { roads: o.roads, tracks: o.tracks || [o.tramway].filter(Boolean) }));
  world.scene.add(root);
  dressLorries(world, ['lorry_a', 'lorry_b']);
  if (!weatherWaterTower(world)) { let t = 0; world.onBelTick?.(() => { if (++t % 20 === 0 && t < 2000) weatherWaterTower(world); }); }
}
