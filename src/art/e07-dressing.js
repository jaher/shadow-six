/**
 * LIGHTS OUT mission 7 "White Out": the mission's own art (docs/expansion/e07.md §13). Visual only — nothing here
 * touches the nav grid (the gameplay footprints are the def's structures, most of them `nav: false` and hidden here):
 *   - the ridge: a 30 m granite face with its scree, the snow plateau carried on past the map's east edge, the ridge
 *     station / OP / flak lifted onto it;
 *   - the rock spur over the tunnel bore and the bore's two concrete portals;
 *   - the avalanche gallery (concrete roof on pillars, buttressed uphill wall) under its snow bank and loaded cornice;
 *     the slide's debris, built hidden at load (warm-up frame) and shown when the cornice comes down;
 *   - the Hotel Hochjoch (a three-storey alpine gasthof: rubble plinth, rendered ground floor with quoins, dark log
 *     upper floors, two carved balconies, a wide-eaved shingle roof under snow, green shutters) and its sun terrace
 *     (Vering's desk, the radio table, deck chairs);
 *   - the goods cable car's ropes, the press under its awning on the middle lorry's tailboard and the plate case, the
 *     split supply container with its tangled parachute, the fuel bowser on the pushable, the knapsacks, the wayside
 *     shrine on the summit, the ski rack, the frozen tarn, snow poles along the pass road, the burning bowser wreck.
 * Built once per load by the mission script's `visuals` (missions/scripts/e07.js e07Script).
 * @module art/e07-dressing
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, CASTLE_SETS, localFrame, segBox, castleMaterial } from './castle-kit.js';
import { dressingMaterial, boulderGeometry, buildCliff, fbm, seedOf } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { terrainPrism } from './kit-terrain.js';
import { snowBlanket, snowMound, ridgeRoll, tyrolFarmhouse, onionChapel, stadel, ridgeFaceGeometryG, faceSnowG, footSurfaceAt, rimCornice, plateauSnowGeometryG, plateauSnowField, plateauSnowSurface, footDrift, quadN, triN } from './e07-kit.js';
import { addSnowCover } from './terrain/snowfx.js';
import { terrainMaterial } from './terrain/terrain.js';
import { unfoldedGroundMaterial } from './e07-snow.js';
import { chunkMesh, meshTriangles } from '../engine/chunking.js';
import { buildFlakTowed } from './field-guns.js';
import { creaseNormals } from './round-roofs.js';
import { separateCoplanar } from './coplanar-split.js';
import { due, runSync, runSliced } from '../engine/slice.js';
import { createVehicleVisual } from './vehicle-library.js';
import { vehicleArtReady, addVehicleReleaser, markShared } from './vehicle-model.js';
import { fitOnFootprint } from './static-vehicles.js';
import { propSnowAmount } from './terrain.js';
import {
  RIDGE_Y, HOTEL, TERRACE, TUNNEL, GALLERY, CORNICE_BANK, SLIDE, CAR_BEND, PLATE_CASE,
} from '../missions/scripts/e07.js';

const HAS_DOM = typeof document !== 'undefined';
const deg = (d) => (d * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (v) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };

// the e07 finishes, as castle-kit material keys (vertex-toned, box-projected: one merged mesh per finish)
Object.assign(CASTLE_SETS, {
  e07Render: ['plaster_rough', 0xf1e6cf, 0xe8dcc6, 2.2, 0.7], // the gasthof's cream render
  e07Logs: ['log_hewn', 0x7a5236, 0x4a2e1a, 1.6, 1.1], // dark weathered larch logs
  e07Trim: ['timber_beam', 0x6c4a30, 0x3e2818, 1.4, 1.0], // balcony boards, rails, brackets
  e07Shingle: ['roof_shingle', 0x8a7a68, 0x4a4038, 2.4, 1.0],
  e07Shutter: ['weatherboard_paint', 0x4f8a5c, 0x2f5a3a, 1.2, 0.8], // green shutters
  e07Frame: ['plaster_white', 0xf4f1ea, 0xe4e0d6, 1.0, 0.5],
  e07Glass: ['glass_dirty', 0x5a6670, 0x22292e, 1.0, 0.4],
  e07Snow: ['snow_soft', 0xffffff, 0xf2f5fa, 3.0, 0.4],
  // angular chunks of snow (the fans' debris, the clumps at the face's foot): the same snow, never smoothed into beads
  e07SnowChunk: ['snow_soft', 0xffffff, 0xf2f5fa, 3.0, 0.4],
  e07Concrete: ['concrete_board', 0xc4c2bb, 0x9a9a94, 2.4, 1.0],
  e07Granite: ['rock_cliff', 0xa7a8ab, 0x4a4d52, 3.0, 1.3],
  e07Dunkelgelb: ['paint_metal', 0xd8bd84, 0xb89a5a, 1.4, 0.7], // wash-worn dunkelgelb
  e07Olive: ['paint_metal', 0x8e9a70, 0x4c5638, 1.4, 0.7],
  e07Canvas: ['tent_canvas', 0xbdb79a, 0x77745d, 3.0, 0.8],
  e07ChuteOD: ['tent_canvas', 0x7d7a52, 0x56553a, 2.0, 0.6], // the supply chute's olive-drab gores
  e07ChuteKh: ['tent_canvas', 0xb4a77a, 0x857959, 2.0, 0.6], // and its khaki ones (an Allied container canopy)
  e07Tarp: ['tent_canvas', 0xa3a592, 0x676b5c, 7.0, 0.9], // a grey-olive lorry tarpaulin
  e07Door: ['door_planks', 0x8a5a36, 0x4a2c1a, 1.1, 1.0], // the gasthof's front door: dark-stained larch planks
  // the OP's Flakvierling in its winter distemper over the field grey, matte: the kit's 'paint' / 'iron' are castle-kit
  // metals (metalness 0.6) that, with no sky to mirror on the ridge, drew the whole gun black
  e07FlakPaint: ['paint_metal', 0xcfd1c8, 0xa9aca2, 1.4, 0.7],
  e07FlakIron: ['cast_iron', 0xb4b6b0, 0x5e5f5b, 1.0, 0.6],
});

// ---------------------------------------------------------------- the ridge (y 30)
/** The plateau carried past the east and the north / south edges; its west edge is the face's rim. */
const RIM = [[107.2, -40], [107.4, 4], [106.8, 22], [107.3, 40], [106.9, 58], [107.4, 76], [106.8, 94], [107.2, 112], [106.9, 130], [107.4, 148], [106.8, 166], [107.2, 184], [107, 240]];

let FACE_MAT = null;
/** The ridge face's granite: M5's face maps, a paler tint (it stands in shade all morning), snow on its ledges. */
function ridgeFaceMaterial() {
  const src = dressingMaterial('graniteFace');
  if (FACE_MAT?.userData.src === src.uuid) return FACE_MAT; // (re-made when the face's maps are re-made: a new mission scope)
  const m = new THREE.MeshStandardMaterial({ color: 0xf0f0f2, map: src.map ?? null, normalMap: src.normalMap ?? null, roughnessMap: src.roughnessMap ?? null,
    roughness: 1, metalness: 0, ...(src.normalScale ? { normalScale: src.normalScale.clone() } : {}) });
  m.name = 'e07:ridge_face';
  addSnowCover(m, { uniforms: { uSnowAmt: propSnowAmount(), uSnowBias: { value: -0.2 } } });
  m.userData.snowCover = true;
  m.userData.src = src.uuid;
  FACE_MAT = m;
  return m;
}

/** The rim's x at z (the RIM polyline). */
function rimX(z) {
  for (let k = 1; k < RIM.length; k++) {
    const [x0, z0] = RIM[k - 1], [x1, z1] = RIM[k];
    if (z <= z1) return lerp(x0, x1, Math.min(1, Math.max(0, (z - z0) / (z1 - z0 || 1))));
  }
  return RIM[RIM.length - 1][0];
}
/**
 * The face's foot at z: on the walkable snow's edge (x 104.6) or set back into the blocked band, never west of it — the
 * long bays, and everywhere besides a wander of up to 23 cm in and out at 1.2-2.4 m: the granite's toe stands out in
 * small buttresses and falls back in alcoves (never a ruled line along the plumb stretches; never clipped flat either —
 * a clipped noise leaves straight runs; the face's columns, 0.93 m apart, draw it).
 */
const FOOT_S = seedOf('e07:foot') & 0xffff;
const fFoot = (v) => Math.min(1, Math.max(0, 0.5 + 0.62 * v));
const footX = (z) => 104.75 + 1.7 * Math.max(0, 0.5 + 0.62 * fbm(z * 0.06, 0.3, 2.2, FOOT_S, 3) - 0.45)
  + 0.16 * fFoot(fbm(z * 0.42, 1.7, 0.4, FOOT_S + 3, 2)) + 0.07 * fFoot(fbm(z * 0.83, 2.9, 1.3, FOOT_S + 5, 1));
/** Couloirs cut into the face: [z, half-width, depth]; one where the ropes run up (z ≈ 104–116). */
const GULLIES = [[8, 3.5, 2.8], [31, 2.6, 2.2], [52, 4.5, 3.1], [77, 3.2, 2.5], [96, 2.4, 1.9], [111, 3.6, 2.6], [131, 5, 3.4], [151, 3, 2.6], [171, 4, 3.0], [189, 2.8, 2.2]];
/** The face as drawn (ridgeFaceGeometry's options) and its snow's (faceSnowG's: the ledges, the ropes' couloir kept bare). */
const FACE = { z0: -40, z1: 240, h: RIDGE_Y, n: 300, rows: 48, seed: 'e07:ridge', gullies: GULLIES };
const FACE_SNOW = { ...FACE, ledges: 70, skip: [[103, 118]], plaster: [-6, 206] };
/** Where the face's snow is cut into its north and south meshes (z). */
const SNOW_SPLIT = 100;
/** The ridge's lines and the face's options, for tests and tools (tests/unit/e07-snow.test.mjs). */
export const E07_RIDGE = { footX: (z) => footX(z), rimX: (z) => rimX(z), face: FACE, snow: FACE_SNOW };

/**
 * Scree at the face's foot: loose blocks in clusters under the couloirs and a sprinkling between, all inside the blocked
 * band. (The couloirs' fans are snow: the face's foot drift, e07-kit faceSnow, in the ground's own snow — no pale
 * faceted talus cones standing up the cuts.)
 */
function buildScree(root) {
  // loose blocks: clusters under the couloirs and a sprinkling between, half sunk in the snow
  const g = new THREE.Group(); g.name = 'e07:scree_blocks';
  let k = 0;
  const block = (x, z, r, tone) => {
    const b = new THREE.Mesh(boulderGeometry(r, r * (0.55 + 0.25 * ((k * 7) % 3) / 2), r * (0.8 + 0.3 * ((k * 5) % 4) / 3), 7100 + k, 2), dressingMaterial(tone));
    b.position.set(x, r * 0.25, z); b.rotation.set(0.2 * Math.sin(k), k * 2.1, 0.15 * Math.cos(k * 1.7)); b.castShadow = true; b.receiveShadow = true;
    g.add(b); k++;
  };
  let s = seedOf('e07:blocks') >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [gz, gw] of GULLIES) for (let i = 0, n = 2 + Math.floor(rnd() * 3); i < n; i++) {
    const z = gz + (rnd() - 0.5) * gw * 1.6, r = 0.3 + rnd() * 0.55, fx = footX(z);
    block(Math.max(104.75 + r * 0.7, fx + 0.2 + rnd() * 0.9), z, r, rnd() < 0.5 ? 'rockDark' : 'rock');
  }
  for (let z = 6; z < 196; z += 6 + rnd() * 9) {
    if (rnd() < 0.35) continue;
    const r = 0.22 + rnd() * 0.4;
    block(Math.max(104.75 + r * 0.7, footX(z) + rnd() * 0.8), z, r, rnd() < 0.6 ? 'rock' : 'rockDark');
  }
  root.add(g);
  // and small angular stones fallen at the rock's toe every 1.5-5 m, in ones and twos, half sunk (one mesh a tone: the
  // lot is two draws)
  const small = { rock: [], rockDark: [] };
  let qs = seedOf('e07:scree_small') >>> 0;
  const rs = () => ((qs = (qs * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let z = -4 + rs() * 3; z < 204; z += 1.5 + 3.5 * rs()) {
    for (let m = 0, n = 1 + Math.floor(rs() * 2.5); m < n; m++) {
      const zz = z + (rs() - 0.5) * 1.4, r = 0.08 + 0.26 * rs() ** 1.6;
      const geo = boulderGeometry(r, r * (0.45 + 0.3 * rs()), r * (0.7 + 0.5 * rs()), 7600 + small.rock.length + 7 * small.rockDark.length, 1);
      geo.rotateY(rs() * Math.PI * 2);
      geo.translate(Math.max(104.66 + r * 1.15, footX(zz) + (rs() - 0.3) * 0.25), r * 0.05, zz);
      small[rs() < 0.55 ? 'rockDark' : 'rock'].push(geo);
    }
  }
  for (const [tone, list] of Object.entries(small)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), dressingMaterial(tone));
    for (const l of list) l.dispose();
    m.name = `e07:scree_small:${tone}`; m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }
}

/**
 * The wind's scoop along the face's foot: the snow in front of the rock a shade darker and bluer (the eddy's trough in
 * the wall's shade), a band 0.35-2 m out from the rock whose outer edge wanders in lobes and bays, whose depth of tone
 * changes along the face from a trace to a quarter and is mottled at 0.3-1 m, deepest some way out rather than against
 * the drift's toe (nil there) — a tint multiplied onto the snow under it (render-only: the walkable snow keeps its
 * heights, its paint and its prints). Draped 1.5 cm over the drawn ground `T` or, where the foot's own snow lies over
 * it (`foot`: footSurfaceAt — the drift's spill, a fan's apron), over that: its tint runs out over the spill and across
 * its toe; with master's ground-decal treatment (polygon offset, no depth write, drawn after the ground).
 */
function buildFootScoop(root, T, foot = null) {
  const S = seedOf('e07:scoop') & 0xffff, pos = [], col = [], idx = [], N = 9;
  let rows = 0;
  for (let z = -6; z <= 206 + 1e-6; z += 0.35) {
    // (its reach in lobes and bays at 0.5-3 m; its depth of tone patchy along the face, from a trace to a quarter)
    const xIn = footX(z) + 0.1;
    const W = Math.max(0.35, 0.35 + 1.3 * f01p(fbm(z * 0.28, 1.3, 0.4, S, 3)) + 0.35 * fbm(z * 0.9, 2.1, 1.7, S + 3, 2) + 0.15 * fbm(z * 2.3, 0.7, 2.9, S + 9, 1));
    const dark = 0.04 + 0.2 * f01p(fbm(z * 0.3, 3.7, 0.2, S + 5, 3)) ** 1.4, pk = 0.3 + 0.35 * f01p(fbm(z * 0.6, 1.9, 3.1, S + 11, 1));
    for (let k = 0; k < N; k++) {
      // (the trough's tone nil at the drift's toe and deepest 0.3-0.65 m out — a dark edge against the toe would only
      // rule its line harder — fading over the band's outer half; mottled at 0.3-1 m)
      const f = k / (N - 1), e = (W + 0.1) * f ** 1.15, x = xIn - e, y = Math.max(T.surfaceAt(x, z) || 0, foot ? foot(x, z) : -Infinity) + 0.015;
      const prof = smooth01((e - 0.16) / pk) * (1 - smooth01((e - (W + 0.1) * 0.55) / ((W + 0.1) * 0.45)));
      const d = dark * prof * (0.6 + 0.4 * f01p(fbm(x * 2.2, 0.6, z * 1.1, S + 7, 2)));
      pos.push(x, y, z); col.push(1 - 0.9 * d, 1 - 0.68 * d, 1 - 0.32 * d);
    }
    // (wound to face up: x falls across a row, z rises from row to row)
    if (rows) { const a = (rows - 1) * N, b = rows * N; for (let k = 0; k + 1 < N; k++) idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k); }
    rows++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  mat.name = 'e07:foot_scoop';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'e07:foot_scoop'; m.castShadow = false; m.receiveShadow = false; m.renderOrder = -1;
  m.userData.aoExclude = true; // (a tint on the ground: nothing for the AO prepass)
  root.add(m);
}

/** Granite knobs breaking the plateau's snow (off the lip, the station and the OP), and the crags beyond the map. */
function buildPlateau(root) {
  const g = new THREE.Group(); g.name = 'e07:plateau_rocks';
  const knobs = [[114.5, 12, 1.8], [117.6, 22, 1.2], [116.2, 58, 2.2], [118.4, 71, 1.4], [113.8, 84, 1.6], [117.0, 122, 2.0], [113.6, 138, 1.3], [118.2, 151, 2.4],
    [115.0, 168, 1.5], [117.8, 186, 1.9], [124, 30, 3.4], [128, 64, 4.2], [126, 104, 3.6], [131, 128, 5.0], [125, 160, 3.2], [133, 190, 4.6], [137, 8, 5.4]];
  knobs.forEach(([x, z, r], k) => {
    const b = new THREE.Mesh(boulderGeometry(r, r * 0.55, r * 0.9, 7400 + k, 3), dressingMaterial(k % 3 ? 'rockDark' : 'rock'));
    b.position.set(x, RIDGE_Y - r * 0.18, z); b.rotation.y = k * 1.3; b.castShadow = true; b.receiveShadow = true;
    g.add(b);
  });
  root.add(g);
  // two summits east of the ridge: granite pyramids, snow on the gentler planes (the face material's snow cover)
  const peaks = [[158, 52, 26, 46], [170, 150, 30, 58], [146, 104, 18, 30]];
  peaks.forEach(([px, pz, r, h], k) => {
    const geo = new THREE.ConeGeometry(r, h, 18, 10, true), P = geo.attributes.position, s = seedOf(`e07:peak${k}`) & 0xffff;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), t = (y + h / 2) / h;
      const a = Math.atan2(z, x), ridge = Math.abs(Math.sin(a * 2 + k)) ** 3 * 0.35, n = 0.5 + 0.62 * fbm(x * 0.08, y * 0.06, z * 0.08, s, 4);
      const rr = 1 - ridge * 0.6 + (n - 0.5) * 0.7, top = Math.max(0, t - 0.82) * 2;
      P.setXYZ(i, x * rr * (1 - top * 0.5), y + (n - 0.5) * h * 0.08, z * rr * (1 - top * 0.5));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, ridgeFaceMaterial());
    m.position.set(px, RIDGE_Y + h / 2 - 1.5, pz); m.rotation.y = k * 0.9; m.castShadow = true; m.receiveShadow = true; m.name = `e07:peak${k}`;
    root.add(m);
  });
}

/**
 * The head frame at the rim that carries the ropes over the lip: a mast on the plateau and a truss jib cantilevered
 * west over the edge, the rope saddle at its tip (the cabin's hanger passes through the saddle's middle gap, the cabin
 * itself below the jib); a back stay to an anchor block. Everything stands on the plateau, east of the rim.
 */
function buildHeadFrame(root) {
  const G = new Geo('e07:headframe');
  const b = CAR_BEND, ry = b.y + 3.96, lat = [Math.cos(deg(32)), Math.sin(deg(32))]; // (across the ropes at the bend)
  const strut = (a, c, r = 0.08, mat = 'iron', tone = 0.8) => {
    const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(...d), u = d.map((v) => v / L);
    const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const p = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]], pl = Math.hypot(...p);
    const e1 = p.map((v) => v / pl), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const ring = (o) => [0, 1, 2, 3, 4, 5].map((i) => { const t = (i / 6) * Math.PI * 2; return [0, 1, 2].map((q) => o[q] + (e1[q] * Math.cos(t) + e2[q] * Math.sin(t)) * r); });
    const A = ring(a), C = ring(c), mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6, q = [0, 1, 2].map((k) => (A[i][k] + C[j][k]) / 2 - mid[k]); quadN(G, mat, A[i], A[j], C[j], C[i], q, tone); }
  };
  const mx = 110.6, top = ry + 0.9;
  // the mast: an A-frame across z, on concrete footings
  for (const s of [-1.3, 1.3]) {
    strut([mx, RIDGE_Y, b.z + s], [mx, top, b.z + s * 0.25], 0.11);
    segBox(G, 'e07Concrete', localFrame(mx, b.z + s, 0), -0.45, 0.45, -0.45, 0.45, RIDGE_Y - 0.3, RIDGE_Y + 0.3, 0.9);
  }
  strut([mx, RIDGE_Y + 2.2, b.z - 1.0], [mx, RIDGE_Y + 2.2, b.z + 1.0], 0.06);
  // the jib: two truss planes (z ± 0.3), chords from the mast to the tip, verticals and diagonals
  const x0 = 106.0, x1 = mx, yb0 = ry - 0.42, yb1 = ry - 1.2, yt = ry + 0.45;
  for (const s of [-0.3, 0.3]) {
    strut([x1, yt + 0.25, b.z + s], [x0, yt, b.z + s], 0.07);
    strut([x1, yb1, b.z + s], [x0, yb0, b.z + s], 0.08);
    for (let k = 0; k <= 6; k++) {
      const x = lerp(x0 + 0.1, x1, k / 6), yb = lerp(yb0, yb1, (x - x0) / (x1 - x0)), ytt = lerp(yt, yt + 0.25, (x - x0) / (x1 - x0));
      strut([x, yb, b.z + s], [x, ytt, b.z + s], 0.045);
      if (k < 6) { const xn = lerp(x0 + 0.1, x1, (k + 1) / 6); strut([x, ytt, b.z + s], [xn, lerp(yb0, yb1, (xn - x0) / (x1 - x0)), b.z + s], 0.04); }
    }
  }
  for (let k = 1; k <= 6; k++) { const x = lerp(x0 + 0.1, x1, k / 6); strut([x, yt + 0.25 * (k / 6), b.z - 0.3], [x, yt + 0.25 * (k / 6), b.z + 0.3], 0.035); }
  // the back stay to its anchor block, the mast's foot ties
  const anc = [114.4, RIDGE_Y + 0.35, b.z];
  strut([mx, top, b.z], anc, 0.05);
  segBox(G, 'e07Concrete', localFrame(anc[0], anc[2], 0), -0.8, 0.8, -0.9, 0.9, RIDGE_Y - 0.3, RIDGE_Y + 0.5, 0.88);
  // the saddle at the tip: a cross head in two halves (the hanger's gap between), the rope shoes, the haul roller
  const at = (u, y) => [b.x + lat[0] * u, y, b.z + lat[1] * u];
  for (const s of [-1, 1]) {
    strut(at(s * 0.2, ry - 0.36), at(s * 1.1, ry - 0.36), 0.1, 'iron', 0.75);
    const F = localFrame(...[b.x + lat[0] * s * 0.32, b.z + lat[1] * s * 0.32], Math.atan2(lat[1], lat[0]) + Math.PI / 2);
    segBox(G, 'iron', F, -0.35, 0.35, -0.08, 0.08, ry - 0.26, ry - 0.03, 0.65);
    strut(at(s * 1.1, ry - 0.36), [x0 + 0.15, yb0 + 0.1, b.z + s * 0.3], 0.06); // the cross head tied back to the jib's tip
  }
  root.add(G.build('e07:headframe', { ground: RIDGE_Y, damp: 0, streaks: 0, moss: 0 }));
}

function* buildRidgeG(root, world) {
  const plateau = [...RIM.map(([x, z]) => [x + 0.25, z]), [180, 240], [180, -40]]; // (its edge behind the face's lip)
  const top = terrainPrism(plateau, RIDGE_Y - 0.02, { top: 'snow', side: 'rock', tile: 4 });
  top.name = 'e07:ridge_top';
  root.add(top);
  // its snow: wind pillows, sastrugi and lumps over the prism's flat top (a few cm above the walking height)
  const clear = [[115.5, 43, 3.6], [113.5, 35.5, 3.2], [117.6, 37.2, 1.4], [117.4, 33, 1.4], [112, 100, 5.5], [CAR_BEND.x + 5, CAR_BEND.z, 3.5]];
  // (the OP dugout's earth-and-snow cover is this surface's own bank against its west, south and east walls: the
  // asset's straight-edged berm slabs are taken off it, trimOpBerm)
  const PF = plateauSnowField(rimX, { y: RIDGE_Y, z0: -40, z1: 240, seed: 'e07:plateau', clear, berms: [OP_BERM], fine: [28, 58] });
  if (due()) yield;
  const ps = new THREE.Mesh(yield* plateauSnowGeometryG(rimX, PF), dressingMaterial('snow'));
  ps.name = 'e07:plateau_snow'; ps.receiveShadow = true;
  root.add(ps);
  if (due()) yield;
  const face = new THREE.Mesh(yield* ridgeFaceGeometryG(footX, rimX, FACE), ridgeFaceMaterial());
  face.name = 'e07:ridge_face'; face.castShadow = true; face.receiveShadow = true;
  root.add(face);
  if (due()) yield;
  // snow on the face's ledges and drifted up its foot (none on the ledges of the ropes' couloir), on the face's own
  // triangles, in the ground's snow over the snow's own surface coordinates (GROUND_SNOW_UNFOLD) with soft normals: the
  // ledges and the foot each a north and a south mesh (cut at SNOW_SPLIT), each mesh built, smoothed and cut into spans
  // in a slice of its own; the foot once the drawn ground is up (its fans' aprons lie on it: a slow machine past the
  // load's terrain wait builds it when it is)
  const FSO = FACE_SNOW, FS = new Geo('e07:face_snow'), FS2 = new Geo('e07:face_snow_s'), shade = [];
  yield* faceSnowG(FS, footX, rimX, { ...FSO, part: 'ledges', G2: FS2, split: SNOW_SPLIT, shade });
  yield* addFaceSnow(root, FS, 'e07:face_snow');
  yield* addFaceSnow(root, FS2, 'e07:face_snow_s');
  buildLedgeShade(root, shade);
  if (due()) yield;
  const T = world?.terrain?.terrain;
  if (T?.surfaceAt) yield* buildFaceFootG(root, T, FSO);
  else {
    // (a slow machine past the load's terrain wait: the foot is built when the drawn ground is up, sliced like the rest
    // of the art — a long task after play has started would stall the game — and dressed in the ground's snow itself:
    // groundMaterialOnRidge has run by then)
    world?.terrain?.ready?.then?.(() => {
      const t = world.terrain?.terrain;
      if (t?.surfaceAt) runSliced(buildFaceFootG(root, t, FSO)).then(() => groundMaterialOnRidge(world, root), (e) => console.warn('[e07] face foot', e));
    }, () => {});
  }
  // the wind cornice along the lip; none where the ropes come over it, a few breaks where the granite rim shows
  const C = new Geo('e07:rim_cornice');
  rimCornice(C, rimX, { z0: -38, z1: 238, y: RIDGE_Y, seed: 'e07:rimc', gaps: [[13, 17], [44, 46.5], [70, 73], [103, 117], [139, 142], [178, 182]], ground: plateauSnowSurface(PF) });
  if (due()) yield;
  const rimC = C.build('e07:rim_cornice', { ground: RIDGE_Y, damp: 0, streaks: 0, moss: 0 });
  if (due()) yield;
  // (soft lumps, and the plateau's own ground snow on it: GROUND_SNOW)
  root.add(softSnow(rimC));
  if (due()) yield;
  buildScree(root);
  buildPlateau(root);
  buildHeadFrame(root);
  buildFlak(root);
}

/**
 * A face-snow mesh built and added (snowMeshesG: soft normals, the surface coordinates, the kit's light terms), then — a
 * mesh along the whole face, which every pass would draw whole wherever the view is — cut into culled spans of 48 m
 * along the face, as the engine's chunking cuts the map's big meshes (engine/chunking.js; the art is built after that
 * pass), a span at a time.
 */
function* addFaceSnow(root, G, name) {
  const g = yield* snowMeshesG(G, name);
  root.add(g);
  g.updateMatrixWorld(true);
  for (const m of [...g.children]) if (m.isMesh && meshTriangles(m) > 6000) { chunkMesh(m, { cell: 24, cellZ: 48 }); if (due()) yield; }
}

/** Corners in a slice of softNormalsG before it looks at the clock (a few ms of work at most). */
const NORMALS_STEP = 3000;
/**
 * Soft normals for a triangle soup, as art/round-roofs.js creaseNormals makes them — each corner the angle-weighted mean
 * of the face normals at its position (to 0.1 mm) within `crease`°, in the same order with the same float32 steps, so
 * the very same normals — but sliced (it pauses every few thousand corners when a slice's time is up) and grouping the
 * corners on a hash of their three quantized coordinates instead of a string a corner (the strings were most of its
 * cost: 35-38 % of the face foot's build, a task over 50 ms on a cold load).
 * @param {Float32Array} P positions, three a corner, three corners a face @param {number} crease degrees
 * @returns {Float32Array} the normals, three a corner
 */
export function* softNormalsG(P, crease = 80) {
  const n = (P.length / 3) | 0, F = (n / 3) | 0, q = 1e4;
  const fn = new Float32Array(F * 3), ang = new Float32Array(F * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  const v = [a, b, c];
  for (let f = 0; f < F; f++) {
    a.fromArray(P, f * 9); b.fromArray(P, f * 9 + 3); c.fromArray(P, f * 9 + 6);
    nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const l = nn.length();
    if (l > 1e-12) { nn.divideScalar(l); fn[f * 3] = nn.x; fn[f * 3 + 1] = nn.y; fn[f * 3 + 2] = nn.z; }
    for (let k = 0; k < 3; k++) {
      const p = v[k], u = v[(k + 1) % 3], w = v[(k + 2) % 3];
      e1.subVectors(u, p).normalize(); e2.subVectors(w, p).normalize();
      ang[f * 3 + k] = l > 1e-12 ? Math.acos(Math.min(1, Math.max(-1, e1.dot(e2)))) : 0;
    }
    if (f % NORMALS_STEP === NORMALS_STEP - 1 && due()) yield;
  }
  // (the corners grouped by position: an open-addressed table of the quantized coordinates; group ids in corner order)
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), gx = new Int32Array(n), gy = new Int32Array(n), gz = new Int32Array(n), gid = new Int32Array(n);
  let G = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(P[i * 3] * q), y = Math.round(P[i * 3 + 1] * q), z = Math.round(P[i * 3 + 2] * q);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const g = table[h];
      if (g < 0) { table[h] = G; gx[G] = x; gy[G] = y; gz[G] = z; gid[i] = G++; break; }
      if (gx[g] === x && gy[g] === y && gz[g] === z) { gid[i] = g; break; }
      h = (h + 1) & (size - 1);
    }
    if (i % NORMALS_STEP === NORMALS_STEP - 1 && due()) yield;
  }
  // (each group's corners in ascending order: creaseNormals' insertion order)
  const start = new Int32Array(G + 1), member = new Int32Array(n);
  for (let i = 0; i < n; i++) start[gid[i] + 1]++;
  for (let g = 0; g < G; g++) start[g + 1] += start[g];
  const fill = start.slice(0, G);
  for (let i = 0; i < n; i++) member[fill[gid[i]]++] = i;
  const out = new Float32Array(n * 3), cosC = Math.cos((crease * Math.PI) / 180);
  let done = 0;
  for (let g = 0; g < G; g++) {
    const s0 = start[g], s1 = start[g + 1];
    for (let m = s0; m < s1; m++) {
      const i = member[m], fi = (i / 3) | 0;
      let x = 0, y = 0, z = 0;
      for (let k = s0; k < s1; k++) {
        const j = member[k], fj = (j / 3) | 0;
        if (fn[fi * 3] * fn[fj * 3] + fn[fi * 3 + 1] * fn[fj * 3 + 1] + fn[fi * 3 + 2] * fn[fj * 3 + 2] < cosC) continue;
        const w = ang[j];
        x += fn[fj * 3] * w; y += fn[fj * 3 + 1] * w; z += fn[fj * 3 + 2] * w;
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
    done += s1 - s0;
    if (done >= NORMALS_STEP) { done = 0; if (due()) yield; }
  }
  return out;
}

/**
 * The face's snow Geo made into meshes, one a finish (`${name}:${finish}`, as castle-kit's Geo.build names them), sliced:
 * its corners' explicit surface coordinates (metres / the finish's tile: e07-snow's unfolding reads them back × the
 * tile), the kit's light terms as the `aE07` attribute (triU), soft normals (softNormalsG: 80°, the snow and the clods
 * alike — a clod is a lumpy ball, no hard edge on it). The dressing's snow stands in until the ground's material takes
 * over (groundMaterialOnRidge); no vertex colours (the ground's material reads none).
 */
function* snowMeshesG(G, name) {
  const g = new THREE.Group(); g.name = name;
  for (const [mat, A] of G.parts) {
    const n = A.pos.length / 3;
    if (!n) continue;
    const pos = new Float32Array(A.pos), tile = (CASTLE_SETS[mat] || CASTLE_SETS.e07Snow)[3];
    const uv = new Float32Array(n * 2), e = new Float32Array(n * 3), E = A.e?.length === n * 3 ? A.e : null;
    if (!E) console.warn(`[e07] ${name}:${mat}: no light terms for its corners; drawn plain`);
    for (let i = 0; i < n; i++) {
      const t = A.uv[i];
      uv[i * 2] = (t ? t[0] : pos[i * 3]) / tile; uv[i * 2 + 1] = (t ? t[1] : pos[i * 3 + 2]) / tile;
      if (E) { e[i * 3] = E[i * 3]; e[i * 3 + 1] = E[i * 3 + 1]; e[i * 3 + 2] = E[i * 3 + 2]; } else { e[i * 3] = 1; e[i * 3 + 2] = 1; }
    }
    if (due()) yield;
    const nrm = yield* softNormalsG(pos, 80);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aE07', new THREE.BufferAttribute(e, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, dressingMaterial('snow'));
    m.name = `${name}:${mat}`; m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    if (due()) yield;
  }
  return g;
}

/**
 * The rock's shade under the ledge pillows: each pillow takes the sky from the rock below its underside, so a strip of
 * the face from just above where the underside meets the rock down 0.16-0.3 m is a shade darker — deepest at the top,
 * under the deeper lips and the drips, gone at the pillow's caps (faceSnowG's `shade`: its points on the face's drawn
 * triangles, 2 cm out from the rock). A tint multiplied onto the rock, drawn after it with master's decal treatment
 * (polygon offset, no depth write) — render-only, out of the AO prepass and the shadows.
 */
function buildLedgeShade(root, runs) {
  const pos = [], col = [], idx = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    // (every other station: a strip changes slowly along a pillow)
    const st = run.filter((_, i) => i % 2 === 0 || i === run.length - 1), base = pos.length / 3;
    for (const [p0, p1, p2, k] of st) {
      for (const [p, f] of [[p0, 0.42], [p1, 0.17], [p2, 0]]) {
        const d = Math.min(0.5, k * f);
        pos.push(...p); col.push(1 - 0.8 * d, 1 - 0.72 * d, 1 - 0.55 * d);
      }
    }
    for (let i = 0; i + 1 < st.length; i++) for (let r = 0; r < 2; r++) {
      const a = base + i * 3 + r, b = base + (i + 1) * 3 + r;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (!idx.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  mat.name = 'e07:ledge_shade';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'e07:ledge_shade'; m.castShadow = false; m.receiveShadow = false; m.renderOrder = -1;
  m.userData.aoExclude = true; // (a tint on the rock: nothing for the AO prepass)
  root.add(m);
  m.updateMatrixWorld(true);
  if (meshTriangles(m) > 1500) chunkMesh(m, { cell: 24, cellZ: 48 });
}

/** The face's foot: the drift, its spill, the fans and their aprons (on the drawn ground `T`), the plaster on the toe,
 *  the clods; the wind scoop's tint over the ground and the spill. */
function* buildFaceFootG(root, T, FSO) {
  const FF = new Geo('e07:face_foot'), FF2 = new Geo('e07:face_foot_s'), footOut = {};
  // (no apron where the tarn's own snow lies: its shore drift runs up towards the foot between z 132 and 148)
  const apronOK = (x, z) => smooth01((Math.hypot(x - TARN_C[0], z - TARN_C[1]) - 9) / 1.2);
  yield* faceSnowG(FF, footX, rimX, { ...FSO, part: 'foot', ground: (x, z) => T.surfaceAt(x, z) || 0, apronOK, G2: FF2, split: SNOW_SPLIT, footOut });
  yield* addFaceSnow(root, FF, 'e07:face_foot');
  yield* addFaceSnow(root, FF2, 'e07:face_foot_s');
  buildFootScoop(root, T, footOut.rows ? footSurfaceAt(footOut) : null);
  if (due()) yield;
}

/** The OP dugout's concrete box (bunker_snow at 115.5, 43, turned 180°; its entrance trench on the north face). */
const OP_BERM = { x0: 112.1, x1: 118.9, z0: 40.0, z1: 45.7, h: 1.85, L: 2.6, open: 'n' };

/**
 * The OP dugout's own berm off: the asset's earth mound (kit:mud) and the snow slabs laid over it — straight-edged,
 * flat-faceted aprons on the ridge's sculpted snow — go; the plateau's snow banks up against the box instead (OP_BERM).
 * The roof's snow, the trench walls' caps and the net stay as shipped. The geometry is cloned before it is cut (the
 * library's mesh is shared with every other mission's bunker_snow).
 */
function trimOpBerm(world) {
  const o = world.structures?.get('op_dugout')?.object3d;
  if (!o) return 0;
  o.updateMatrixWorld(true);
  const B = OP_BERM, v = new THREE.Vector3();
  let cut = 0;
  o.traverse((m) => {
    if (!m.isMesh) return;
    const name = (Array.isArray(m.material) ? m.material : [m.material]).map((q) => q?.name || '').join('|');
    if (/^kit:mud/.test(name)) { m.visible = false; return; }
    if (!/^kit:snow/.test(name) || m.userData.e07Trimmed) return;
    const g = m.geometry.clone(), P = g.attributes.position, I = g.index, keep = [];
    const n = I ? I.count : P.count, at = (k) => (I ? I.getX(k) : k);
    for (let k = 0; k < n; k += 3) {
      let cx = 0, cz = 0, ymax = -Infinity;
      for (let j = 0; j < 3; j++) { v.fromBufferAttribute(P, at(k + j)).applyMatrix4(m.matrixWorld); cx += v.x / 3; cz += v.z / 3; ymax = Math.max(ymax, v.y); }
      const outside = cx < B.x0 - 0.05 || cx > B.x1 + 0.05 || cz > B.z1 + 0.05;
      const trench = cz < B.z0 + 0.1 && cx > 112.9 && cx < 116.0;
      if (outside && !trench && ymax < RIDGE_Y + 2.35) { cut++; continue; }
      keep.push(at(k), at(k + 1), at(k + 2));
    }
    g.setIndex(keep); g.clearGroups(); g.computeBoundingBox(); g.computeBoundingSphere();
    m.geometry = g; m.userData.e07Trimmed = true;
  });
  return cut;
}

/**
 * Three shared snow models fixed on e07's own instances, not in the library: art/building-fixups.js keys its fixes by
 * asset, and M4's henhouse and M5's two cable-car stations draw the same models (they stay as they are there).
 * tools/art/zfight.mjs --mission e07 and the round-7 art review:
 *  - the henhouse (henhouse_no_snow): its snow twin shipped flat rectangles of snow round the base and over the low deck
 *    (kit:snow wholly under 0.62 m: straight-edged slabs on the lumpy ground snow, in the plane of the deck's planks) →
 *    they go; the verge lip of its roof snow doubles itself in one plane (two copies of the same faces fighting) → the
 *    snow's own coplanar faces are set apart (art/coplanar-split.js: the smaller copy 6 mm proud);
 *  - all three: the snow caps, slide streaks and rime lie in the planes of the roofs, boards and trims → the snow draws
 *    a depth step nearer where they tie (its own polygonOffset material, as the library's ZFIGHT_NEAR parts).
 * Per instance and LOD: the snow meshes take their own geometry and material copies (the library's templates stay as
 * shipped, M4 and M5 draw them unchanged); a LOD that attaches late (loaded on demand) gets the same.
 */
const E07_SNOW_FIX = {
  henhouse_no_snow: { skirts: 0.62, split: true },
  cable_station_upper_snow: {}, cable_station_lower_snow: {},
};
const isSnowMat = (m) => /^kit:snow/.test(m?.name || '');
const allSnow = (o) => (Array.isArray(o.material) ? o.material : [o.material]).every(isSnowMat);

function fixSnowLod(lod, fix) {
  if (!lod || lod.userData.e07SnowFix) return 0;
  lod.userData.e07SnowFix = true;
  lod.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert();
  const rel = (o) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
  const snow = [], v = new THREE.Vector3();
  let base = Infinity;
  lod.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (allSnow(o)) { snow.push(o); return; }
    if ((Array.isArray(o.material) ? o.material : [o.material]).some(isSnowMat)) return;
    const P = o.geometry.attributes.position, M = rel(o);
    for (let i = 0; i < P.count; i++) base = Math.min(base, v.fromBufferAttribute(P, i).applyMatrix4(M).y);
  });
  let dropped = 0;
  if (fix.skirts != null || fix.split) for (const o of snow) o.geometry = o.geometry.clone(); // (own copies)
  if (fix.skirts != null && Number.isFinite(base)) {
    for (const o of snow) {
      const g = o.geometry, P = g.attributes.position, I = g.index, M = rel(o);
      if (!I) continue;
      const low = (k) => v.fromBufferAttribute(P, I.getX(k)).applyMatrix4(M).y < base + fix.skirts;
      const keep = [];
      for (let k = 0; k + 2 < I.count; k += 3) {
        if (low(k) && low(k + 1) && low(k + 2)) { dropped++; continue; }
        keep.push(I.getX(k), I.getX(k + 1), I.getX(k + 2));
      }
      if (keep.length !== I.count) { g.setIndex(keep); g.clearGroups(); g.computeBoundingBox(); g.computeBoundingSphere(); }
    }
  }
  if (fix.split && snow.length) {
    // the snow on its own (stand-ins sharing its geometry, at its place in the LOD): only snow-on-snow pairs part here
    const tmp = new THREE.Group();
    for (const o of snow) {
      const s = new THREE.Mesh(o.geometry, o.material);
      s.matrixAutoUpdate = false; s.matrix.copy(rel(o));
      tmp.add(s);
    }
    separateCoplanar(tmp, { crossings: false });
    for (const o of snow) { o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere(); }
  }
  const near = new Map();
  for (const o of snow) {
    const swap = (m) => {
      if (!near.has(m)) { const c = m.clone(); c.polygonOffset = true; c.polygonOffsetFactor = -1; c.polygonOffsetUnits = -2; near.set(m, c); }
      return near.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  }
  return dropped;
}

function fixSnowInstances(world) {
  for (const s of world.structures?.values?.() || []) {
    s.object3d?.traverse((b) => {
      const fix = E07_SNOW_FIX[b.userData?.building];
      if (!fix || b.userData.e07SnowHook) return;
      b.userData.e07SnowHook = true;
      for (const lod of [...b.children]) if (/^lod\d$/.test(lod.name)) fixSnowLod(lod, fix);
      const prev = b.userData.onLodAttached;
      b.userData.onLodAttached = (i, o) => { prev?.(i, o); fixSnowLod(o, fix); };
    });
  }
}

/**
 * The OP's 2 cm Flakvierling on the plateau, the kit model (art/field-guns.js, as M20's emplaced guns) on the def's
 * footprint: barrels on the north road and the valley it climbs out of (north by west), the outriggers turned off the
 * crew's boots (fk1 south-west of the mount, fk2 east of it), the ready-use boxes behind.
 */
function buildFlak(root) {
  const g = buildFlakTowed({ x: 113.5, z: 35.5, rot: deg(240), aim: 0, y0: RIDGE_Y, seed: 'e07:op_flak' });
  g.name = 'e07:op_flak';
  // (the same kit gun, re-dressed: whitewashed field grey and dark gunmetal as matte e07 finishes — not M20's sets)
  g.traverse((m) => {
    if (!m.isMesh) return;
    const k = m.name.slice(m.name.lastIndexOf(':') + 1);
    if (k === 'paint') m.material = castleMaterial('e07FlakPaint');
    else if (k === 'iron') m.material = castleMaterial('e07FlakIron');
  });
  root.add(g);
}

// ---------------------------------------------------------------- the spur's rock over the tunnel, and its portals
/** castle-kit Geo with a tone per corner (the kit's own takes one per triangle): weathering painted across a face. */
class GeoV extends Geo {
  /** A triangle with its own tone at each corner, wound to face along `n`. */
  triV(mat, a, b, c, ta, tb, tc, n) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] < 0) { [b, c] = [c, b]; [tb, tc] = [tc, tb]; }
    const A = this._arr(mat);
    A.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    A.tone.push(ta, tb, tc);
    A.uv.push(null, null, null);
  }
}

/**
 * The portals' section (m, in the portal's frame: u along it, w out of the face, y up): the opening's half-width (a
 * hand inside the bore's walls, so the abutments' bore sides stand clear of the rock), springing, rise, the coping line,
 * the slab's depth; how far the abutments run back into the spur (whose faces behind them stand plumb: the def's
 * `abut`) and down under the snowfield; the pour's lift height.
 */
const PORTAL = { half: 2.55, spring: 3.0, rise: 1.4, top: 6.6, d: 0.9, end: 4.8, back: 1.0, foot: -0.3, lift: 1.32 };
const portalArch = (u) => PORTAL.spring + PORTAL.rise * Math.sqrt(Math.max(0, 1 - (u / PORTAL.half) ** 2));
/** The portal's columns (u): 0.2 m, breaking exactly at the springings. */
const PORTAL_U = (() => {
  const { half, end } = PORTAL, span = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / n);
  return [...span(-end, -half, 12), ...span(-half, half, 26), ...span(half, end, 12), end];
})();

/** A convex polygon ([u, y] points) clipped to f(p) >= 0 for a linear f (one Sutherland–Hodgman plane). */
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/**
 * The portal's face, weathered — not one flat 10 × 6.6 m slab: a grid of horizontal courses over the abutments and the
 * spandrel, cut along the arch, each corner toned and set back by what the winters did to it: the pour's lifts a shade
 * apart, rain streaks hanging from the coping's drip and wet stripes under its icicles, lime run-off, soot rolled up
 * over the crown by the convoys' exhausts, slush splash and damp up the foot (worst by the road), and frost spalls —
 * the skin gone a few centimetres deep, the aggregate darker — at the foot and along the arrises. The face's edges
 * stay true (the end faces, the soffit and the coping meet it vertex for vertex).
 */
function portalFace(G, F, faceSign, S, drips) {
  const { half, spring, top, d, end, foot, lift } = PORTAL, wf = faceSign * d, nF = [0, 0, faceSign];
  const nz = (a, b, k, o = 2) => fbm(a, b, 0.31 * k + 0.17, S + k, o);
  // the courses: 0.2 m, with the lift joints, the springing and the coping line among them
  const ys = [];
  for (let y = foot; y < top - 1e-6; y += 0.2) ys.push(y);
  for (let k = 1; k * lift < top - 0.05; k++) ys.push(k * lift);
  ys.push(spring, top);
  ys.sort((a, b) => a - b);
  const Y = ys.filter((y, i) => i === 0 || y - ys[i - 1] > 0.04);
  // distance (m) to the face's nearest edge: its ends, the coping, the opening
  const edge = (u, y) => {
    const au = Math.abs(u), open = au < half ? y - portalArch(u) : y < spring ? au - half : Math.hypot(au - half, y - spring);
    return Math.min(end - au, top - y, open);
  };
  const spall = (u, y) => {
    const n = nz(u * 1.05, y * 1.05, 11, 3) + 0.35 * nz(u * 3.1, y * 3.1, 12, 2), e = edge(u, y);
    const near = Math.max(smooth01(1 - (y - foot) / 1.5), smooth01(1 - e / 0.7)); // frost: at the foot and the arrises
    return smooth01((n - (0.52 - 0.2 * near)) / 0.07) * smooth01(e / 0.12);
  };
  const tone = (u, y, band) => {
    let t = 0.88 + 0.18 * f01p(nz(band * 1.9 + faceSign, 0.4, 3, 1)); // the lift's pour, a shade apart
    // rain streaks from the coping's drip: narrow, uneven, longest where the coping leaks
    const drip = Math.max(0, nz(u * 3.2, 0.2, 5) * 1.5 - 0.15), reach = 2.5 + 3.5 * f01p(nz(u * 0.8, 1.1, 6, 1));
    t *= 1 - 0.55 * Math.min(1, drip) * smooth01((y - (top - reach)) / reach);
    // damp patches where the coping leaks: broad and blotchy under it, worst at its ends
    const blot = smooth01((nz(u * 0.55, y * 0.45, 13) + 0.25 * smooth01((Math.abs(u) - 2.6) / 2) - 0.1) / 0.3);
    t *= 1 - 0.3 * blot * smooth01((y - (top - 3.2)) / 2.4);
    // meltwater under the icicles: a dark wet stripe down to the ground (or the arch)
    for (const uc of drips) t *= 1 - 0.45 * Math.exp(-(((u - uc) / 0.2) ** 2)) * smooth01((y - foot) / 2) * (0.7 + 0.3 * f01p(nz(u * 3, y * 0.5, 7, 1)));
    t *= 1 + 0.12 * Math.min(1, Math.max(0, nz(u * 3.3, y * 0.12, 8) - 0.35) * 2.5); // lime run-off, pale
    // soot over the crown
    const ua = Math.min(half, Math.abs(u)), dy = y - portalArch(ua);
    if (dy > -0.05) t *= 1 - 0.75 * Math.exp(-Math.max(0, dy) / 1.3) * smooth01(1 - Math.abs(u) / (half + 0.9)) * (0.7 + 0.3 * f01p(nz(u * 1.7, y * 0.7, 9, 1)));
    // splash and damp up the foot, worst by the road
    const road = smooth01(1 - Math.abs(Math.abs(u) - half) / 1.6);
    t *= 1 - (0.3 + 0.2 * road) * smooth01(1 - (y - foot) / (1.3 + 0.6 * f01p(nz(u * 0.7, 2.2, 10, 1))));
    return t * (1 - 0.35 * spall(u, y)); // the spalls' aggregate
  };
  const P = (u, y) => { const [x, z] = F.at(u, wf - faceSign * 0.035 * spall(u, y)); return [x, y, z]; };
  for (let i = 0; i + 1 < PORTAL_U.length; i++) {
    const u0 = PORTAL_U[i], u1 = PORTAL_U[i + 1], open = u0 > -half - 1e-6 && u1 < half + 1e-6;
    const a0 = open ? portalArch(u0) : -1e9, a1 = open ? portalArch(u1) : -1e9;
    for (let j = 0; j + 1 < Y.length; j++) {
      const y0 = Y[j], y1 = Y[j + 1];
      if (open && y1 <= Math.min(a0, a1) + 1e-6) continue; // (wholly in the opening)
      let poly = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
      if (open && y0 < Math.max(a0, a1)) poly = clipPoly(poly, (p) => p[1] - (a0 + ((a1 - a0) * (p[0] - u0)) / (u1 - u0)));
      if (poly.length < 3) continue;
      const band = Math.floor((y0 + y1) / 2 / lift), V = poly.map(([u, y]) => [P(u, y), tone(u, y, band)]);
      for (let k = 1; k + 1 < V.length; k++) G.triV('e07Concrete', V[0][0], V[k][0], V[k + 1][0], V[0][1], V[k][1], V[k + 1][1], nF);
    }
  }
}

function portal(G, x, z, faceSign) {
  // a concrete portal across the bore (rot 0: along x), the opening 5.1 m wide, a segmental arch 4.4 m to the crown,
  // its face weathered (portalFace); a true curved soffit, an overhanging coping under lumpy snow, icicles in clusters.
  // The abutments run a metre back into the spur and down under the snowfield: no slot at their foot or behind them.
  const { half, spring, top, d, end, back, foot } = PORTAL;
  const F = localFrame(x, z, 0), wf = faceSign * d, wb = 0, wr = -faceSign * back;
  const P = (u, w, y) => { const [px, pz] = F.at(u, w); return [px, y, pz]; };
  const S = seedOf(`e07:portal${faceSign}`) & 0xffff, icicles = [[-3.3, 3], [0.9, 2], [3.9, 4]];
  portalFace(G, F, faceSign, S, icicles.map(([u]) => u));
  for (const s of [-1, 1]) {
    // each abutment's end into the spur, and its side to the bore up to the springing
    quadN(G, 'e07Concrete', P(s * end, wr, foot), P(s * end, wf, foot), P(s * end, wf, top), P(s * end, wr, top), [s, 0, 0], 0.9);
    quadN(G, 'e07Concrete', P(s * half, wr, foot), P(s * half, wf, foot), P(s * half, wf, spring), P(s * half, wr, spring), [-s, 0, 0], 0.86);
  }
  // the soffit (the face's columns, vertex for vertex) and the spandrel's back to the bore
  for (let i = 0; i + 1 < PORTAL_U.length; i++) {
    const u0 = PORTAL_U[i], u1 = PORTAL_U[i + 1];
    if (u0 < -half - 1e-6 || u1 > half + 1e-6) continue;
    const y0 = portalArch(u0), y1 = portalArch(u1), um = (u0 + u1) / 2, ns = [-um, spring - portalArch(um), 0], l = Math.hypot(ns[0], ns[1]) || 1;
    quadN(G, 'e07Concrete', P(u0, wf, y0), P(u1, wf, y1), P(u1, wb, y1), P(u0, wb, y0), [ns[0] / l, ns[1] / l, 0], 0.7);
    quadN(G, 'e07Concrete', P(u0, wb, y0), P(u1, wb, y1), P(u1, wb, top), P(u0, wb, top), [0, 0, -faceSign], 0.86);
  }
  // the coping, a hand proud of both faces, and its snow
  const c0 = Math.min(wf, wb) - 0.12, c1 = Math.max(wf, wb) + 0.12;
  segBox(G, 'e07Concrete', F, -end - 0.15, end + 0.15, c0, c1, top, top + 0.32, 1.06);
  snowMound(G, F, -end - 0.15, end + 0.15, c0, c1, top + 0.32, { th: 0.24, seed: `e07:coping${faceSign}`, nu: 18, nv: 3, over: 0.06 });
  // the date stone, set into the face and standing a few centimetres proud of it
  const ds = [wf - faceSign * 0.4, wf + faceSign * 0.06].sort((a, b) => a - b);
  segBox(G, 'e07Granite', F, -0.6, 0.6, ds[0], ds[1], top - 1.1, top - 0.45, 0.9);
  // icicles off the coping's front lip: three clusters, uneven lengths
  for (const [uc, m] of icicles) for (let k = 0; k < m; k++) {
    const u = uc + (k - m / 2) * 0.16 + 0.05 * Math.sin(k * 2.3 + faceSign), L = 0.12 + 0.5 * f01p(fbm(u * 3.1, k, faceSign, S + 7, 1)) ** 1.4;
    const [px, pz] = F.at(u, faceSign > 0 ? c1 - 0.05 : c0 + 0.05);
    G.cyl('e07Icicle', px, top - L, pz, 0.004, 0.024, L, 5, 1.0, { caps: false });
  }
}
const f01p = (v) => Math.min(1, Math.max(0, 0.5 + 0.62 * v));

/**
 * The south portal's foot (the one the camera sees): the snow banked against the abutments, wrapped round their ends
 * into the spur's foot and on along it — drawn in the map's own ground snow (groundMaterialOnRidge), so it rises out
 * of the snowfield with no seam — with rock fallen from the face and spalled concrete in it, so the spur's foot no
 * longer meets the snowfield along a ruled line.
 */
function portalFoot(root) {
  const { half, end, d } = PORTAL, cx = (TUNNEL.x0 + TUNNEL.x1) / 2, zf = TUNNEL.z1 - 0.1 + d, zr = TUNNEL.z1 + 0.05;
  const xw = cx - end, xe = cx + end;
  const G = new Geo('e07:portal_drift');
  // (both run west: the drift on their south side)
  footDrift(G, [[cx - half - 0.1, zf], [xw + 0.3, zf], [xw - 0.1, zf - 0.38], [xw - 0.5, zr], [xw - 2.4, zr], [44.4, zr]], { h: 0.62, reach: 1.45, seed: 'e07:foot_w' });
  footDrift(G, [[69.0, zr], [xe + 2.4, zr], [xe + 0.5, zr], [xe + 0.1, zf - 0.38], [xe - 0.3, zf], [cx + half + 0.1, zf]], { h: 0.5, reach: 1.25, seed: 'e07:foot_e' });
  root.add(softSnow(G.build('e07:portal_drift', { ground: 0, damp: 0, streaks: 0, moss: 0 })));
  // rock fallen from the face, half in the drift (master's boulders, the spur's own rock)
  const rocks = [[xw - 0.15, zr + 0.3, 0.42], [xw - 0.95, zr + 0.2, 0.3], [51.3, zr + 0.32, 0.5], [49.7, zr + 0.18, 0.34], [48.1, zr + 0.3, 0.55],
    [46.4, zr + 0.22, 0.32], [45.1, zr + 0.36, 0.46], [xe + 0.2, zr + 0.28, 0.4], [xe + 1.2, zr + 0.2, 0.3], [65.4, zr + 0.34, 0.5], [67.3, zr + 0.22, 0.36]];
  rocks.forEach(([bx, bz, r], k) => {
    const b = new THREE.Mesh(boulderGeometry(r, r * 0.62, r * 0.9, 9300 + k, 2), dressingMaterial(k % 3 ? 'rockDark' : 'rock'));
    b.position.set(bx, 0.08 + r * 0.12, bz); b.rotation.y = k * 2.1; b.castShadow = true; b.receiveShadow = true;
    b.name = 'e07:portal_rock';
    root.add(b);
  });
  // spalled concrete off the face, by the abutments' feet (off the road)
  const C = new Geo('e07:portal_spall');
  for (const [px, pz, sx, sy, sz, rot] of [[xw + 1.1, zf + 0.42, 0.28, 0.16, 0.22, 0.4], [xw + 0.5, zf + 0.62, 0.2, 0.12, 0.17, 1.2], [cx - half - 0.6, zf + 0.3, 0.24, 0.14, 0.2, 2.1],
    [cx + half + 0.7, zf + 0.36, 0.26, 0.15, 0.2, 0.9], [xe - 0.6, zf + 0.55, 0.18, 0.11, 0.15, 2.6]]) {
    C.box('e07Concrete', px, 0.02, pz, sx, sy, sz, rot, 0.86);
  }
  root.add(C.build('e07:portal_spall', { ground: 0, damp: 0, streaks: 0, moss: 0 }));
}

function buildTunnel(root) {
  const G = new GeoV('e07:tunnel');
  // the rock over the bore: master's massif rock (the spur's own, art/dressing.js buildCliff) from the bore's crown to
  // the spur's broken, snowy top, run into the spur either side; plumb behind each portal (its `abut` faces are only
  // ever recessed), so the concrete fronts stand clear of it — one spur, never a flat white slab over the road
  const zA = TUNNEL.z0 + 0.15, zB = TUNNEL.z1 - 0.15, xA = TUNNEL.x0 - 2.4, xB = TUNNEL.x1 + 2.4;
  const pts = [[xA, zA], [xB, zA], [xB, zB], [xA, zB]];
  const roof = buildCliff({ id: 'e07:bore_rock', points: pts, h: 8.7, x: 0, z: 0, rot: 0, abut: [[pts[0], pts[1]], [pts[2], pts[3]]] });
  roof.position.y = 5.45;
  roof.name = 'e07:tunnel_rock';
  root.add(roof);
  // the bore's dark lining under the rock (seen through the portals)
  const lining = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL.x1 - TUNNEL.x0 + 0.6, 0.2, TUNNEL.z1 - TUNNEL.z0 - 1.4), paintedMaterial('concrete', 0x2a2a28));
  lining.position.set((TUNNEL.x0 + TUNNEL.x1) / 2, 5.5, (TUNNEL.z0 + TUNNEL.z1) / 2);
  root.add(lining);
  portal(G, (TUNNEL.x0 + TUNNEL.x1) / 2, TUNNEL.z0 + 0.1, -1);
  portal(G, (TUNNEL.x0 + TUNNEL.x1) / 2, TUNNEL.z1 - 0.1, 1);
  root.add(G.build('e07:portals', { ground: 0 }));
  portalFoot(root);
}

// ---------------------------------------------------------------- the avalanche gallery, its bank and the cornice
const GAL_TOP = 4.6;
/** The bank's cross-section (x, y) — from the gallery's wall top up to the crest and down to the slope (east). */
const BANK = [[61.0, GAL_TOP + 1.2], [61.9, 5.9], [63.2, 6.4], [64.4, 6.6], [65.6, 6.0], [66.8, 4.4], [68.0, 2.4], [69.4, 0.9], [70.8, 0.15], [71.6, 0]];
const LIP = [[64.4, 6.6], [63.2, 7.25], [61.9, 7.2], [60.8, 6.7], [60.1, 6.05], [60.9, 5.95], [62.3, 6.35], [63.6, 6.45]];

/**
 * A snow body lofted along z from a cross-section (x, y): the profile subdivided `sub` times so the surface carries
 * lumps at three scales (never flat facets: one smooth tone field over it, no per-triangle shading), the ends tapered;
 * `curl` (x → 0…1) marks the overhanging part of a cornice, which reaches out west in uneven lobes along the crest
 * (`lobes` m) and sags where it reaches furthest. `foot` {from, reach, tail}: the profile's low end feathered out past
 * its last point (`tail` [[x, y], …], below the ground) and wandering east and west along z by up to `reach` m from
 * `from` on, so the bank meets the ground in lobes and bays, not along a line. `sink` (m): instead of closing its ends,
 * each column of the profile runs out at its own place within `sink` m of the ends and dives into the ground there
 * (a ragged end, no flat fan).
 */
function loft(G, mat, profile, z0, z1, { steps = 26, seed = 'loft', amp = 0.25, taper = 3, close = false, sub = 3, lobes = 0, curl = null, flip = false, foot = null, sink = 0 } = {}) {
  const s = seedOf(seed) & 0xffff, rows = [], prof = [], P = foot?.tail ? [...profile, ...foot.tail] : profile;
  for (let k = 0; k + 1 < P.length; k++) for (let t = 0; t < sub; t++) {
    const f = t / sub;
    prof.push([lerp(P[k][0], P[k + 1][0], f), lerp(P[k][1], P[k + 1][1], f), k + f]);
  }
  prof.push([...P[P.length - 1], P.length - 1]);
  for (let i = 0; i <= steps; i++) {
    const z = lerp(z0, z1, i / steps);
    const lobe = lobes * Math.max(-0.4, fbm(z * 0.32, 0.4, 0.2, s + 21, 2) * 1.4 + 0.45 * Math.sin(z * 1.7 + 2.5 * fbm(z * 0.2, 1.3, 0.6, s + 23, 1)));
    // (the foot's wander along z: bays and lobes at two scales)
    const wander = foot ? foot.reach * (0.3 + 0.7 * fbm(z * 0.15, 2.9, 0.4, s + 51, 2) + 0.3 * Math.sin(z * 0.47 + 1.1 + fbm(z * 0.3, 0.2, 1.4, s + 53, 1))) : 0;
    rows.push(prof.map(([x, y, kk]) => {
      let e;
      if (sink) {
        const ze0 = z0 + sink * (0.5 + 0.5 * fbm(kk * 0.83, 1.3, 0.2, s + 41, 1)), ze1 = z1 - sink * (0.5 + 0.5 * fbm(kk * 0.83, 3.7, 0.2, s + 43, 1));
        e = Math.min(z - ze0, ze1 - z) / taper;
      } else e = Math.min(1, Math.min(z - z0, z1 - z) / taper);
      const ec = Math.min(1, Math.max(0, e));
      const n = fbm(x * 0.3, z * 0.22, kk * 0.7, s, 3) * amp + fbm(x * 1.15, z * 0.95, kk * 1.3, s + 5, 2) * amp * 0.38
        + fbm(x * 2.9, z * 2.5, kk, s + 7, 1) * amp * 0.13;
      const c = curl ? curl(x) : 0, reach = c * lobe * ec;
      const fx = foot && x > foot.from ? wander * Math.min(1, (x - foot.from) / 0.8) : 0;
      if (sink || foot) {
        const sm = ec * ec * (3 - 2 * ec), below = e < 0 ? 0.3 + 1.2 * -e : 0;
        return [x + n * 0.6 - reach + fx, y * (sink ? sm : 0.25 + 0.75 * ec) + n * ec - Math.max(0, reach) * 0.3 - below, z];
      }
      return [x + n * 0.6 - reach, Math.max(0, y * (0.25 + 0.75 * ec) + n * ec - Math.max(0, reach) * 0.3), z];
    }));
  }
  // one smooth tone field (no checker of per-triangle tones: the facets read as facets)
  const tone = (a, b, c) => 0.965 + 0.035 * fbm((a[0] + b[0] + c[0]) * 0.11, 0.5, (a[2] + b[2] + c[2]) * 0.11, s + 61, 2);
  for (let i = 0; i < steps; i++) {
    const A = rows[i], B = rows[i + 1];
    // (profile west → east, rows south: this winding faces the sheet up / outward; the diagonal alternates)
    // (`flip`: a profile running east → west — the cornice lip's — is wound the other way round, so its top faces up)
    const T = flip ? (a, b, c) => G.tri(mat, a, c, b, tone(a, b, c)) : (a, b, c) => G.tri(mat, a, b, c, tone(a, b, c));
    for (let k = 0; k + 1 < A.length; k++) {
      if ((i + k) % 2) { T(A[k], B[k], B[k + 1]); T(A[k], B[k + 1], A[k + 1]); }
      else { T(A[k], B[k], A[k + 1]); T(B[k], B[k + 1], A[k + 1]); }
    }
  }
  if (close && !sink) {
    const A = rows[0], B = rows[steps], T = flip ? (a, b, c) => G.tri(mat, a, c, b, 0.95) : (a, b, c) => G.tri(mat, a, b, c, 0.95);
    for (let k = 1; k + 1 < A.length; k++) { T(A[0], A[k], A[k + 1]); T(B[0], B[k + 1], B[k]); }
  }
}

/** Snow bodies shade as soft lumps, not as cut facets: their normals smoothed across folds up to 80° (the kit's 32°
 *  crease is for masonry corners) — the dressing's snow, the roofs' and the wall-foot drifts' (e07Snow, e07RoofSnow,
 *  e07Drift). Returns the group. */
function softSnow(g) {
  g.traverse((m) => { if (m.isMesh && /e07((Roof)?Snow|Drift)$/.test(m.name)) creaseNormals(m.geometry, 80); });
  return g;
}

function* buildGalleryG(root, world) {
  const G = new Geo('e07:gallery'), { x0, x1, z0, z1 } = GALLERY;
  // the uphill wall with its buttresses, the roof slab, its fascia beam, the pillars of the open (valley) side
  const Fw = localFrame(x1 - 0.3, z0, Math.PI / 2); // along +z
  segBox(G, 'e07Concrete', Fw, -0.4, z1 - z0 + 0.4, -0.35, 0.35, 0, GAL_TOP, 1);
  for (let z = z0 + 1.5; z < z1; z += 4.2) {
    const F = localFrame(x1 + 0.35, z, 0);
    segBox(G, 'e07Concrete', F, 0, 0.9, -0.3, 0.3, 0, 1.6, 0.94);
  }
  const Fr = localFrame(x0 - 0.5, z0 - 0.5, 0);
  segBox(G, 'e07Concrete', Fr, 0, x1 - x0 + 0.9, 0, z1 - z0 + 1, GAL_TOP, GAL_TOP + 0.55, 1.04);
  segBox(G, 'e07Concrete', Fr, -0.12, 0.45, 0, z1 - z0 + 1, GAL_TOP - 0.55, GAL_TOP, 0.92); // fascia beam on the open side
  for (let z = z0 + 0.4; z <= z1 - 0.3; z += 3.7) {
    const F = localFrame(x0 + 0.05, z, 0);
    segBox(G, 'e07Concrete', F, -0.25, 0.25, -0.25, 0.25, 0, GAL_TOP - 0.5, 0.98);
    segBox(G, 'e07Concrete', F, -0.38, 0.38, -0.38, 0.38, 0, 0.35, 0.9); // plinth
  }
  // the portal headwalls over both mouths (the roof's ends stand up as a parapet with a coping)
  for (const [z, s] of [[z1 + 0.5, 1], [z0 - 0.5, -1]]) {
    const Fh = localFrame((x0 + x1) / 2, z, 0), hw = (x1 - x0) / 2 + 0.55;
    segBox(G, 'e07Concrete', Fh, -hw, hw, s > 0 ? -0.35 : 0, s > 0 ? 0 : 0.35, GAL_TOP - 0.55, GAL_TOP + 1.25, 0.95);
    segBox(G, 'e07Concrete', Fh, -hw - 0.08, hw + 0.08, s > 0 ? -0.43 : -0.08, s > 0 ? 0.08 : 0.43, GAL_TOP + 1.25, GAL_TOP + 1.42, 1.04);
    snowMound(G, Fh, -hw - 0.08, hw + 0.08, s > 0 ? -0.43 : -0.08, s > 0 ? 0.08 : 0.43, GAL_TOP + 1.42, { th: 0.22, seed: `e07:headwall${s}`, nu: 12, nv: 2, over: 0.05 });
  }
  // snow on the roof: a thick, lumpy blanket rolled over the open edge, icicles from its lip
  snowBlanket(G, [x0 - 0.47, GAL_TOP + 0.57, z1 + 0.15], [x0 - 0.47, GAL_TOP + 0.57, z0 - 0.15], [x1 + 0.38, GAL_TOP + 0.57, z0 - 0.15], [x1 + 0.38, GAL_TOP + 0.57, z1 + 0.15],
    { seed: 'e07:roofsnow', th: 0.5, lip: 0.32, droop: 0.5, verge: 0.2, icicles: 34 });
  // (its roof snow shades as soft lumps, as the bank's: the 32° crease left each lump a set of hard facets)
  const gal = G.build('e07:gallery', { ground: 0, damp: 0.5, moss: 0 });
  softSnow(gal);
  root.add(gal);
  if (due()) yield;
  // the bank and the loaded cornice on its crest (shown until the slide)
  const C = new Geo('e07:cornice');
  // (its foot feathered out under the ground snow and wandering in bays and lobes; its ends running out raggedly into
  // the ground — the charge's spot on the foot, CORNICE_AT, keeps its height: the wander starts east of it)
  loft(C, 'e07Snow', BANK, CORNICE_BANK[0][1] - 2.5, CORNICE_BANK[2][1] + 2.5, { steps: 76, seed: 'e07:bank', amp: 0.7, taper: 4.5, sub: 3, sink: 2.4,
    foot: { from: 71.2, reach: 1.5, tail: [[72.5, -0.16], [73.6, -0.5]] } });
  const bank = C.build('e07:bank', { ground: 0, damp: 0, streaks: 0, moss: 0 });
  softSnow(bank);
  root.add(bank);
  // the bank's drawn surface under (x, z) — its ends and foot run out raggedly, so what stands on it (the rakes, the
  // rocks) is set on the surface itself, not on the cross-section
  bank.updateMatrixWorld(true);
  const bankSnow = bank.children.filter((m) => m.isMesh), rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const bankY = (x, z) => { rc.set(from.set(x, 30, z), down); const hit = rc.intersectObjects(bankSnow, false)[0]; return hit ? hit.point.y : 0; };
  const L = new Geo('e07:lip');
  loft(L, 'e07Snow', LIP, CORNICE_BANK[0][1] + 1, CORNICE_BANK[2][1] - 1, { steps: 52, seed: 'e07:lip', amp: 0.4, taper: 3, close: true, sub: 3, lobes: 0.55, curl: (x) => Math.min(1, Math.max(0, (62.4 - x) / 1.8)), flip: true });
  // icicles under the lip's curl, over the gallery roof
  for (let z = CORNICE_BANK[0][1] + 1.6; z < CORNICE_BANK[2][1] - 1.4; z += 0.55) {
    const len = 0.25 + 0.6 * Math.abs(Math.sin(z * 2.71)), x = 60.35 + 0.25 * Math.sin(z * 1.3);
    if (Math.sin(z * 5.3) > 0.35) continue; // (in clusters, not a comb)
    L.cyl('e07Icicle', x, 5.95 - len, z, 0.006, 0.05, len, 5, 1.0, { caps: false });
  }
  if (due()) yield;
  const lip = L.build('e07:cornice_lip', { ground: 0, damp: 0, streaks: 0, moss: 0 });
  softSnow(lip);
  root.add(lip);
  // rock breaking through the bank's face over the gallery wall and along its crest
  for (let k = 0; k < 13; k++) {
    const z = CORNICE_BANK[0][1] + 1.4 + k * 2.0 + (k % 3) * 0.7, x = k % 3 === 2 ? 64.6 + (k % 2) * 0.9 : 62.0 + (k % 2) * 0.5;
    const r = 0.55 + ((k * 7) % 5) * 0.22;
    const yb = bankY(x, z);
    if (yb < 1.2) continue; // (where the bank runs out, no rock breaks through it)
    const b = new THREE.Mesh(boulderGeometry(r, r * 0.6, r * 0.9, 9100 + k, 2), dressingMaterial(k % 2 ? 'rockDark' : 'rock'));
    b.position.set(x, yb - r * 0.25, z); b.rotation.y = k * 1.7; b.castShadow = true; b.receiveShadow = true;
    bank.add(b);
  }
  if (due()) yield;
  // timber snow rakes on the bank's slope, in staggered rows (they go with the cornice when it comes down)
  {
    const R = new Geo('e07:rakes'), surf = (x) => { for (let k = 1; k < BANK.length; k++) if (x <= BANK[k][0]) return lerp(BANK[k - 1][1], BANK[k][1], (x - BANK[k - 1][0]) / (BANK[k][0] - BANK[k - 1][0])); return 0; };
    let q = seedOf('e07:rakes') >>> 0;
    const rnd = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
    const za = CORNICE_BANK[0][1] + 1.8, zb = CORNICE_BANK[2][1] - 1.8;
    for (const [x, off] of [[65.6, 0], [67.4, 1.4], [69.0, 0.5]]) {
      for (let z = za + off; z < zb - 2.4; z += 3.2 + rnd() * 1.4) {
        if (rnd() < 0.18) continue; // a gap where one has gone
        const w = 2.2 + rnd() * 0.6, lean = 0.35, tilt = (rnd() - 0.5) * 0.12;
        // (set on the drawn surface: the lower of its two posts' ground, so neither stands in the air)
        const y0 = Math.min(bankY(x, z - w / 2), bankY(x, z + w / 2)) - 0.3;
        if (y0 < surf(x) * 0.55) continue; // (none out where the bank runs down into the ground)
        for (const dz of [-w / 2, w / 2]) {
          const F = localFrame(x, z + dz, 0);
          segBox(R, 'e07Trim', F, -0.07, 0.07, -0.07, 0.07, y0, y0 + 1.6 + tilt * dz, 0.82);
          // the raking strut leaning downhill (east) to a foot in the snow
          const a = [x, y0 + 1.5, z + dz], b = [x + 1.1, bankY(x + 1.1, z + dz) - 0.2, z + dz];
          quadN(R, 'e07Trim', [a[0] - 0.05, a[1], a[2] - 0.05], [b[0] - 0.05, b[1], b[2] - 0.05], [b[0] + 0.05, b[1], b[2] + 0.05], [a[0] + 0.05, a[1], a[2] + 0.05], [0, 1, 0], 0.78);
          quadN(R, 'e07Trim', [a[0] - 0.05, a[1], a[2] + 0.05], [b[0] - 0.05, b[1], b[2] + 0.05], [b[0] + 0.05, b[1], b[2] - 0.05], [a[0] + 0.05, a[1], a[2] - 0.05], [0, 1, 0], 0.74);
        }
        const F = localFrame(x - lean * 0.2, z, Math.PI / 2);
        for (let k = 0; k < 5; k++) { // the slats across, a hand's width apart, leaning back into the slope
          const y = y0 + 0.45 + k * 0.26, xs = -lean * (k / 5);
          segBox(R, 'e07Trim', localFrame(x + xs, z, Math.PI / 2), -w / 2 - 0.1, w / 2 + 0.1, -0.03, 0.03, y, y + 0.14, 0.84 + 0.06 * (k % 2));
        }
        void F;
        // snow lodged on top of the slats
        snowMound(R, localFrame(x - lean, z, Math.PI / 2), -w / 2 - 0.05, w / 2 + 0.05, -0.06, 0.08, y0 + 1.6, { th: 0.1, seed: `e07:rake${x}:${z.toFixed(1)}`, nu: 6, nv: 1, over: 0.02 });
      }
    }
    bank.add(R.build('e07:rakes', { ground: 0, damp: 0, streaks: 0.1, moss: 0 }));
  }
  if (due()) yield;
  // the slide's debris (hidden until it comes down; drawn by the load's warm-up frame)
  const D = new Geo('e07:debris');
  const [sx0, sz0] = SLIDE[0], [sx1, sz1] = SLIDE[2], nx = 44, nz = 62, s = seedOf('e07:debris') & 0xffff;
  const H = (x, z) => {
    const u = (x - sx0) / (sx1 - sx0), v = (z - sz0) / (sz1 - sz0), edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 6);
    // (avalanche debris: heaped, then broken into clods and blocks — lumps at three scales, never a smooth hill)
    let y = (1.6 + 4.2 * u) * edge + (fbm(x * 0.25, 0, z * 0.25, s, 4) * 1.1 + fbm(x * 1.2, 0.5, z * 1.2, s + 3, 2) * 0.38 + fbm(x * 3.1, 0.9, z * 3.1, s + 5, 1) * 0.12) * edge;
    if (x > GALLERY.x0 - 0.8 && x < GALLERY.x1 + 0.6 && z > GALLERY.z0 - 0.6 && z < GALLERY.z1 + 0.6) y = Math.max(y, GAL_TOP + 1.2 + 0.8 * u);
    return Math.max(0.05, y);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const xa = lerp(sx0, sx1, i / nx), xb = lerp(sx0, sx1, (i + 1) / nx), za = lerp(sz0, sz1, j / nz), zb = lerp(sz0, sz1, (j + 1) / nz);
    // (one slow tone field, no checker of quads a shade apart)
    D.quad('e07Snow', [xa, H(xa, za), za], [xa, H(xa, zb), zb], [xb, H(xb, zb), zb], [xb, H(xb, za), za], 0.97 + 0.03 * f01p(fbm(xa * 0.15, 1.7, za * 0.15, s + 9, 2)));
  }
  const debris = softSnow(D.build('e07:debris', { ground: 0, damp: 0, streaks: 0, moss: 0 }));
  // tumbled blocks of the cornice in it
  for (let k = 0; k < 40; k++) {
    const x = lerp(sx0 + 2, sx1 - 2, ((k * 37) % 100) / 100), z = lerp(sz0 + 2, sz1 - 2, ((k * 61) % 100) / 100), r = 0.35 + ((k * 7) % 9) * 0.13;
    const b = new THREE.Mesh(boulderGeometry(r, r * (0.55 + 0.1 * (k % 3)), r * 1.1, 9000 + k, 1), dressingMaterial('snow'));
    b.position.set(x, H(x, z) - 0.2, z); b.rotation.y = k; b.castShadow = true;
    debris.add(b);
  }
  debris.visible = false;
  debris.userData.warmShow = true;
  root.add(debris);
  // the slide: the cornice and the bank slump down onto the gallery while the debris heaps up over it (4.5 s of sim
  // time, drawn as the frames come; snow dust thrown up along it) — the gameplay change is instant (scripts/e07.js)
  const SLIDE_T = 4.5;
  let slide = null;
  const ease = (f) => f * f * (3 - 2 * f);
  const pose = (f) => {
    const e = ease(Math.min(1, Math.max(0, f)));
    bank.position.set(-3.2 * e, -4.6 * e, 0); lip.position.set(-4.6 * e, -6.2 * e, 0);
    bank.visible = lip.visible = f < 1;
    debris.scale.set(1, 0.08 + 0.92 * e, 1);
  };
  const anim = debris.children.find((c) => c.isMesh);
  if (anim) anim.onBeforeRender = () => {
    if (!slide) return;
    const f = ((world.time ?? 0) - slide.t0) / SLIDE_T;
    for (const d of slide.dust) if (!d.done && f >= d.at) { d.done = true; world.fx?.spawn?.('dust', d.x, d.z, { scale: 2.6, surface: 'snow' }); }
    pose(f);
    if (f >= 1) slide = null;
  };
  const show = (instant = false) => {
    if (debris.visible) return;
    debris.visible = true; delete debris.userData.warmShow;
    if (instant) { pose(1); return; }
    const dust = [];
    for (let k = 0; k < 12; k++) dust.push({ at: (k % 4) * 0.18, x: lerp(GALLERY.x0 - 2, CORNICE_BANK[1][0] + 2, ((k * 37) % 11) / 10), z: lerp(SLIDE[0][1] + 3, SLIDE[2][1] - 3, ((k * 53) % 13) / 12) });
    slide = { t0: world.time ?? 0, dust };
    pose(0);
  };
  world.listen('e07:pass-closed', (p) => { if (p.how === 'cornice') show(); });
  if (world.setpieces?.get?.('e07')?.closed === 'cornice') show(true);
  world._e07Slide = { show };
}

// ---------------------------------------------------------------- the Hotel Hochjoch
function window2(G, F, u, y0, h, w, depth, face, shutters = true) {
  // a deep window: frame, dark glass, cross bar; green shutters folded back
  const wo = face * 0.02, wi = -face * depth;
  segBox(G, 'e07Glass', F, u - w / 2, u + w / 2, Math.min(wo, wi), Math.max(wo, wi), y0, y0 + h, 0.9);
  const fr = 0.08;
  for (const [a, b, c, d, k] of [[u - w / 2 - fr, u - w / 2, y0 - fr, y0 + h + fr, 1], [u + w / 2, u + w / 2 + fr, y0 - fr, y0 + h + fr, 1], [u - w / 2, u + w / 2, y0 - fr, y0, 1], [u - w / 2, u + w / 2, y0 + h, y0 + h + fr, 1], [u - 0.03, u + 0.03, y0, y0 + h, 0.7], [u - w / 2, u + w / 2, y0 + h * 0.62 - 0.03, y0 + h * 0.62 + 0.03, 0.85]]) {
    // (a centimetre proud of the wall; the mullion and the transom at their own depths: never one plane)
    segBox(G, 'e07Frame', F, a, b, face > 0 ? 0.01 : -0.07 * k, face > 0 ? 0.07 * k : -0.01, c, d, 1);
  }
  if (shutters) for (const s of [-1, 1]) {
    const a = u + s * (w / 2 + fr), b = a + s * (w / 2 + 0.05);
    segBox(G, 'e07Shutter', F, Math.min(a, b), Math.max(a, b), face > 0 ? 0.02 : -0.08, face > 0 ? 0.08 : -0.02, y0 - 0.02, y0 + h + 0.02, 0.95 + 0.05 * s);
  }
}

function balcony(G, F, u0, u1, y, depth, face) {
  const w0 = face > 0 ? 0 : -depth, w1 = face > 0 ? depth : 0, out = face > 0 ? depth : -depth;
  segBox(G, 'e07Trim', F, u0, u1, w0, w1, y - 0.12, y, 1);
  for (let u = u0 + 0.6; u < u1; u += 2.4) { // brackets
    segBox(G, 'e07Trim', F, u - 0.07, u + 0.07, face > 0 ? 0 : -depth * 0.9, face > 0 ? depth * 0.9 : 0, y - 0.55, y - 0.12, 0.85);
  }
  const rail = (a, b) => segBox(G, 'e07Trim', F, u0, u1, out - face * 0.06 + Math.min(0, face * 0.06), out + Math.max(0, face * 0.06) - (face > 0 ? 0.06 : 0), a, b, 0.92);
  rail(y + 0.9, y + 1.0);
  rail(y + 0.05, y + 0.14);
  for (let u = u0 + 0.1; u < u1 - 0.05; u += 0.19) { // cut boards (the alpine balcony)
    const k = Math.round((u - u0) / 0.19) % 2;
    segBox(G, 'e07Trim', F, u - 0.06, u + 0.06, out - (face > 0 ? 0.04 : -0.0) - (face > 0 ? 0 : 0.04), out + (face > 0 ? 0 : 0.04) - (face > 0 ? 0.0 : 0), y + 0.14, y + 0.9, 0.86 + k * 0.08);
  }
  for (const u of [u0, u1]) segBox(G, 'e07Trim', F, u - 0.06, u + 0.06, w0, w1, y, y + 1.0, 0.9);
}

function nameBoard(text, w, h) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round((1024 * h) / w);
  const x = c.getContext('2d');
  x.fillStyle = '#e9dcbc'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#4a2e1a'; x.lineWidth = 10; x.strokeRect(8, 8, c.width - 16, c.height - 16);
  x.fillStyle = '#5a2418'; x.font = `bold ${Math.round(c.height * 0.56)}px Georgia, serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, c.height * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
  m.name = 'e07:hotel_name';
  return m;
}

function* buildHotelG(root) {
  const G = new Geo('e07:hotel'), { x: cx, z: cz, w: W, d: D } = HOTEL, hx = W / 2, hz = D / 2;
  const PL = 0.7, GF = 3.6, BAND = 3.85, UP = 9.7, RIDGE = 13.2, EAVE_Z = 1.4, EAVE_X = 1.0;
  const F = localFrame(cx, cz, 0); // u = x, w = z (south +)
  segBox(G, 'rubble', F, -hx - 0.15, hx + 0.15, -hz - 0.15, hz + 0.15, 0, PL, 0.9); // plinth
  segBox(G, 'e07Render', F, -hx, hx, -hz, hz, PL, GF, 1); // the rendered ground floor
  for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { // quoins
    for (let k = 0, y = PL; y < GF - 0.2; k++, y += 0.42) {
      const l = k % 2 ? 0.55 : 0.85;
      segBox(G, 'dressed', F, su > 0 ? hx - l : -hx - 0.04, su > 0 ? hx + 0.04 : -hx + l, sw > 0 ? hz - 0.3 : -hz - 0.04, sw > 0 ? hz + 0.04 : -hz + 0.3, y, y + 0.38, 0.95);
      segBox(G, 'dressed', F, su > 0 ? hx - 0.3 : -hx - 0.04, su > 0 ? hx + 0.04 : -hx + 0.3, sw > 0 ? hz - l : -hz - 0.04, sw > 0 ? hz + 0.04 : -hz + l, y, y + 0.38, 0.95);
    }
  }
  segBox(G, 'e07Trim', F, -hx - 0.12, hx + 0.12, -hz - 0.12, hz + 0.12, GF, BAND, 0.9); // the sill beam
  segBox(G, 'e07Logs', F, -hx - 0.05, hx + 0.05, -hz - 0.05, hz + 0.05, BAND, UP, 1); // log upper floors
  // log corner crossings (the notched ends that stick out)
  for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let y = BAND + 0.1; y < UP - 0.1; y += 0.36) {
      segBox(G, 'e07Logs', F, su > 0 ? hx : -hx - 0.35, su > 0 ? hx + 0.35 : -hx, sw > 0 ? hz - 0.16 : -hz - 0.04, sw > 0 ? hz + 0.04 : -hz + 0.16, y, y + 0.17, 0.85);
      segBox(G, 'e07Logs', F, su > 0 ? hx - 0.16 : -hx - 0.04, su > 0 ? hx + 0.04 : -hx + 0.16, sw > 0 ? hz : -hz - 0.35, sw > 0 ? hz + 0.35 : -hz, y + 0.18, y + 0.35, 0.82);
    }
  }
  // the roof: two shingle planes under snow, gables in logs, the eaves' rafter ends
  const yE = UP, xa = -hx - EAVE_X, xb = hx + EAVE_X, zS = hz + EAVE_Z, zN = -hz - EAVE_Z;
  const P = (u, y, w) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  for (const side of [1, -1]) {
    const ze = side > 0 ? zS : zN;
    G.quad('e07Shingle', P(xa, yE, ze), P(xb, yE, ze), P(xb, RIDGE, 0), P(xa, RIDGE, 0), 1);
    G.quad('e07Shingle', P(xb, yE - 0.18, ze), P(xa, yE - 0.18, ze), P(xa, RIDGE - 0.18, 0), P(xb, RIDGE - 0.18, 0), 0.6);
    if (side < 0) { G.quad('e07Shingle', P(xa, yE, ze), P(xa, RIDGE, 0), P(xb, RIDGE, 0), P(xb, yE, ze), 1); }
    // snow on the plane: the lumpy blanket, thicker on the north (lee) side, rolled over the eave with its icicles
    // (the south plane faces the March sun: more of it melted bare, its eave shed in stretches)
    snowBlanket(G, P(xa, yE, ze), P(xb, yE, ze), P(xb, RIDGE, 0), P(xa, RIDGE, 0), { seed: `e07:hotel${side}`, th: side > 0 ? 0.32 : 0.44, lip: 0.24, droop: 0.36, verge: 0.2, bare: side > 0 ? 1.0 : 0.65, slides: side > 0 ? 1.3 : 0.8 });
    for (let u = xa + 0.4; u < xb; u += 1.1) segBox(G, 'e07Trim', F, u - 0.08, u + 0.08, side > 0 ? hz : ze, side > 0 ? ze : -hz, yE - 0.32, yE - 0.12, 0.8); // rafter ends
  }
  ridgeRoll(G, P(xa + 0.25, RIDGE + 0.05, 0), P(xb - 0.25, RIDGE + 0.05, 0), { r: 0.36, seed: 'e07:hotel_ridge' });
  for (const su of [-1, 1]) { // the gables
    const u = su * (hx + 0.05);
    G.tri('e07Logs', P(u, UP, su > 0 ? -hz : hz), P(u, UP, su > 0 ? hz : -hz), P(u, RIDGE - 0.1, 0), 1);
    G.quad('e07Trim', P(su * (hx + EAVE_X), yE - 0.02, zS), P(su * (hx + EAVE_X), RIDGE + 0.02, 0), P(su * (hx + EAVE_X + 0.04), RIDGE + 0.02, 0), P(su * (hx + EAVE_X + 0.04), yE - 0.02, zS), 0.8);
  }
  // chimneys
  for (const u of [-5.2, 5.6]) {
    segBox(G, 'rubble', F, u - 0.45, u + 0.45, -2.6, -1.7, 9.5, 14.4, 0.85);
    segBox(G, 'e07Concrete', F, u - 0.55, u + 0.55, -2.7, -1.6, 14.4, 14.55, 0.9);
    snowMound(G, F, u - 0.55, u + 0.55, -2.7, -1.6, 14.55, { th: 0.2, seed: `e07:hotel_chim${u}` });
  }
  // windows: south and north fronts, the gables
  const SOUTH = 1, NORTH = -1;
  const Fs = localFrame(cx, cz + hz + 0.05, 0), Fn = localFrame(cx, cz - hz - 0.05, 0);
  for (const u of [-9, -6.2, -3.2, 3.2, 6.2, 9]) window2(G, Fs, u, 1.5, 1.35, 1.0, 0.25, SOUTH);
  for (const u of [-9, -6, -3, 0, 3, 6, 9]) { window2(G, Fs, u, 4.55, 1.35, 1.0, 0.25, SOUTH); window2(G, Fs, u, 7.45, 1.3, 1.0, 0.25, SOUTH); }
  for (const u of [-8, -4, 4, 8]) { window2(G, Fn, u, 1.5, 1.2, 0.9, 0.25, NORTH); window2(G, Fn, u, 4.6, 1.3, 0.95, 0.25, NORTH); window2(G, Fn, u, 7.45, 1.3, 0.95, 0.25, NORTH); }
  for (const su of [-1, 1]) {
    const Fg = localFrame(cx + su * (hx + 0.05), cz, su > 0 ? -Math.PI / 2 : Math.PI / 2); // (+w out of the gable)
    for (const u of [-2.6, 2.6]) { window2(G, Fg, u, 1.5, 1.3, 0.95, 0.25, 1); window2(G, Fg, u, 4.6, 1.3, 0.95, 0.25, 1); window2(G, Fg, u, 7.4, 1.25, 0.95, 0.25, 1); }
    window2(G, Fg, 0, 10.3, 0.9, 0.7, 0.2, 1, false);
  }
  // the two carved balconies on the south front, and one on the east gable over the terrace
  balcony(G, Fs, -10.2, 10.2, 4.0, 1.25, SOUTH);
  balcony(G, Fs, -10.2, 10.2, 6.9, 1.15, SOUTH);
  balcony(G, localFrame(cx + hx + 0.05, cz, -Math.PI / 2), -3.6, 3.6, 6.9, 1.1, 1);
  // the front door under the first-floor balcony: a dark plank leaf in a dressed-stone frame — two jambs and a
  // lintel standing 16 cm proud of the render, the leaf 6 cm proud (10 cm back in its frame), its iron strap
  // hinges and ring handle; the stone steps up to its sill
  const Fd = localFrame(cx, cz + hz, 0);
  segBox(G, 'e07Door', Fd, -0.74, 0.74, 0.004, 0.06, 0.7, 2.74, 1);
  for (const y of [1.05, 2.3]) segBox(G, 'iron', Fd, -0.7, -0.1, 0.06, 0.075, y, y + 0.07, 0.6); // strap hinges
  segBox(G, 'iron', Fd, 0.42, 0.5, 0.06, 0.09, 1.55, 1.63, 0.55); // the ring handle's boss
  segBox(G, 'dressed', Fd, -0.98, -0.74, 0, 0.16, 0.7, 2.74, 0.95);
  segBox(G, 'dressed', Fd, 0.74, 0.98, 0, 0.16, 0.7, 2.74, 0.97);
  segBox(G, 'dressed', Fd, -1.06, 1.06, 0, 0.19, 2.74, 3.02, 1.0); // the lintel
  for (let k = 0; k < 2; k++) segBox(G, 'dressed', Fd, -1.2 + k * 0.1, 1.2 - k * 0.1, 0.0, 0.9 - k * 0.4, 0, 0.33 + k * 0.34, 0.9); // (the top step 3 cm under the plinth's top)
  // (built in slices of its own: the shell's triangles, then its build, then its snow's soft normals)
  if (due()) yield;
  const hotel = G.build('e07:hotel', { ground: 0, damp: 0.9, streaks: 0.12, moss: 0.05 });
  if (due()) yield;
  root.add(softSnow(hotel));
  // the name board under the south eaves
  const nb = nameBoard('HOTEL HOCHJOCH', 7.2, 0.8);
  if (nb) { nb.position.set(cx, 9.1, cz + hz + 0.08); root.add(nb); }
}

// ---------------------------------------------------------------- the sun terrace
function buildTerrace(root) {
  const G = new Geo('e07:terrace'), { x, z, w, d } = TERRACE, F = localFrame(x, z, 0), hw = w / 2, hd = d / 2;
  segBox(G, 'rubble', F, -hw - 0.05, hw + 0.05, -hd - 0.05, hd + 0.05, -0.15, 0.02, 0.85);
  for (let u = -hw; u < hw - 0.05; u += 0.22) segBox(G, 'planks', F, u + 0.01, u + 0.21, -hd, hd, 0.02, 0.055, 0.9 + ((u * 13) % 1) * 0.12);
  const post = (px, pz) => { const Fp = localFrame(px, pz, 0); segBox(G, 'e07Trim', Fp, -0.07, 0.07, -0.07, 0.07, 0.05, 1.05, 0.9); };
  const rail = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), Fr = localFrame(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
    segBox(G, 'e07Trim', Fr, 0, L, -0.05, 0.05, 0.92, 1.02, 0.92);
    segBox(G, 'e07Trim', Fr, 0, L, -0.04, 0.04, 0.12, 0.2, 0.9);
    for (let u = 0.15; u < L - 0.05; u += 0.2) segBox(G, 'e07Trim', Fr, u - 0.055, u + 0.055, -0.025, 0.025, 0.2, 0.92, 0.84 + ((u * 7) % 1) * 0.1);
    for (let u = 0; u <= L + 0.01; u += L / Math.ceil(L / 1.4)) post(...Fr.at(u, 0));
  };
  // (the def's rails: open on the yard at the south end, and the side steps down to the station lane at z 119–122.6)
  rail([75.2, 115.2], [80.8, 115.2]); rail([80.8, 115.2], [80.8, 119.0]); rail([80.8, 122.6], [80.8, 124.8]); rail([80.8, 124.8], [79.2, 124.8]);
  // Vering's desk (papers, a map case, a lamp) and his chair; the radio table with its set and whip aerial
  const table = (tx, tz, tw, td, th, rot = 0) => {
    const Ft = localFrame(tx, tz, rot);
    segBox(G, 'e07Trim', Ft, -tw / 2, tw / 2, -td / 2, td / 2, th - 0.05, th, 1);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) segBox(G, 'e07Trim', Ft, a * (tw / 2 - 0.08) - 0.03, a * (tw / 2 - 0.08) + 0.03, b * (td / 2 - 0.08) - 0.03, b * (td / 2 - 0.08) + 0.03, 0.05, th - 0.05, 0.85);
  };
  table(79.9, 119.8, 0.8, 1.6, 0.78);
  segBox(G, 'e07Frame', localFrame(79.85, 119.6, 0.2), -0.18, 0.18, -0.24, 0.24, 0.78, 0.8, 1.05);
  segBox(G, 'e07Frame', localFrame(79.95, 120.25, -0.3), -0.15, 0.15, -0.2, 0.2, 0.78, 0.795, 0.98);
  segBox(G, 'e07Olive', localFrame(79.75, 120.5, 0), -0.12, 0.12, -0.18, 0.18, 0.78, 0.92, 0.9);
  const chair = (cx, cz, rot) => {
    const Fc = localFrame(cx, cz, rot);
    segBox(G, 'e07Trim', Fc, -0.22, 0.22, -0.22, 0.22, 0.42, 0.47, 0.95);
    segBox(G, 'e07Trim', Fc, -0.24, -0.19, -0.22, 0.22, 0.47, 0.95, 0.9);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) segBox(G, 'e07Trim', Fc, a * 0.18 - 0.025, a * 0.18 + 0.025, b * 0.18 - 0.025, b * 0.18 + 0.025, 0.05, 0.42, 0.85);
  };
  chair(78.05, 119.8, 0);
  table(77.2, 115.8, 1.4, 0.6, 0.85);
  segBox(G, 'e07Olive', localFrame(77.0, 115.75, 0), -0.25, 0.25, -0.17, 0.17, 0.85, 1.17, 0.85);
  segBox(G, 'e07Olive', localFrame(77.55, 115.75, 0), -0.17, 0.17, -0.15, 0.15, 0.85, 1.07, 0.8);
  segBox(G, 'iron', localFrame(77.42, 115.62, 0), -0.01, 0.01, -0.01, 0.01, 1.17, 3.6, 0.6);
  chair(77.2, 116.6, -Math.PI / 2);
  // two deck chairs facing the sun, a furled parasol
  for (const [lx, lz] of [[76.4, 123.6], [77.6, 123.9]]) {
    const Fl = localFrame(lx, lz, deg(-70));
    segBox(G, 'e07Canvas', Fl, -0.55, 0.45, -0.26, 0.26, 0.25, 0.3, 0.95);
    segBox(G, 'e07Trim', Fl, -0.6, -0.5, -0.28, 0.28, 0.05, 0.85, 0.9);
    segBox(G, 'e07Trim', Fl, 0.4, 0.5, -0.28, 0.28, 0.05, 0.27, 0.9);
  }
  G.cyl('e07Trim', 80.2, 0.05, 123.6, 0.03, 0.03, 2.52, 6, 0.9);
  G.cyl('e07Canvas', 80.2, 1.2, 123.6, 0.05, 0.22, 1.25, 8, 1.0);
  root.add(softSnow(G.build('e07:terrace', { ground: 0, damp: 0.2, moss: 0 })));
}

// ---------------------------------------------------------------- the press on the tailboard, the plate case
function buildPress(root) {
  const G = new Geo('e07:press');
  // the awning: a tarpaulin lashed to the lorry's tail bows, sagging over two poles, guyed to pegs in the snow
  const tail = 69.3, poleX = 73.6, za = 151.4, zb = 156.8, nu = 7, nv = 5, sgS = seedOf('e07:tarp') & 0xffff;
  for (const pz of [151.6, 156.6]) G.cyl('e07Trim', poleX, 0, pz, 0.05, 0.045, 2.38, 6, 0.9);
  const tarp = (i, j) => {
    const u = i / nu, v = j / nv, x = lerp(tail, poleX + 0.25, u), z = lerp(za, zb, v);
    const sag = Math.sin(Math.PI * u) * 0.22 + Math.sin(Math.PI * v) * 0.16 * u, wr = fbm(x * 1.3, 0, z * 1.3, sgS, 2) * 0.08;
    return [x, lerp(2.92, 2.38, u) - sag + wr, z];
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    quadN(G, 'e07Tarp', tarp(i, j), tarp(i + 1, j), tarp(i + 1, j + 1), tarp(i, j + 1), [0, 1, 0], 0.96 + 0.06 * ((i + j) % 2));
    const d = (q) => [q[0], q[1] - 0.02, q[2]];
    quadN(G, 'e07Tarp', d(tarp(i, j)), d(tarp(i + 1, j)), d(tarp(i + 1, j + 1)), d(tarp(i, j + 1)), [0, -1, 0], 0.62);
  }
  for (const v of [0, 1]) for (let i = 0; i < nu; i++) { // the tarp's hem hanging down at its open ends
    const a = tarp(i, v * nv), b = tarp(i + 1, v * nv), dz = v ? 0.01 : -0.01;
    quadN(G, 'e07Tarp', a, b, [b[0], b[1] - 0.28, b[2] + dz], [a[0], a[1] - 0.28, a[2] + dz], [0, 0, v ? 1 : -1], 0.85);
  }
  const lineMat = 'e07Frame';
  for (const pz of [151.6, 156.6]) { // guy lines from the pole tops to pegs
    const peg = [poleX + 1.6, 0.05, pz + (pz < 154 ? -1.0 : 1.0)];
    const top = [poleX, 2.36, pz], dx = peg[0] - top[0], dy = peg[1] - top[1], dz = peg[2] - top[2];
    for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6; G.quad(lineMat, [top[0] + dx * t0, top[1] + dy * t0, top[2] + dz * t0], [top[0] + dx * t1, top[1] + dy * t1, top[2] + dz * t1], [top[0] + dx * t1, top[1] + dy * t1 + 0.012, top[2] + dz * t1], [top[0] + dx * t0, top[1] + dy * t0 + 0.012, top[2] + dz * t0], 0.9); }
    G.cyl('e07Trim', peg[0], -0.05, peg[2], 0.025, 0.02, 0.3, 5, 0.8);
  }
  // the press's petrol generator on its skids by the lorry's tail, its exhaust and cable
  const Fg = localFrame(73.2, 158.4, deg(8));
  segBox(G, 'e07Trim', Fg, -0.55, 0.55, -0.3, 0.3, 0, 0.1, 0.8);
  segBox(G, 'e07Olive', Fg, -0.45, 0.25, -0.24, 0.24, 0.1, 0.62, 0.9);
  G.cyl('e07Olive', ...[Fg.at(0.38, 0)[0]], 0.32, Fg.at(0.38, 0)[1], 0.17, 0.17, 0.26, 10, 0.85);
  G.cyl('iron', Fg.at(-0.3, 0.12)[0], 0.62, Fg.at(-0.3, 0.12)[1], 0.03, 0.03, 0.5, 6, 0.4);
  // the press: a timber base, the cast-iron frame and platen, the inking drum, half under a tarpaulin
  const Fp = localFrame(71.0, 154, 0);
  segBox(G, 'e07Trim', Fp, -0.7, 0.7, -0.9, 0.9, 0, 0.55, 0.9);
  segBox(G, 'iron', Fp, -0.55, 0.55, -0.7, 0.7, 0.55, 0.85, 0.75);
  for (const s of [-1, 1]) segBox(G, 'iron', Fp, -0.45, 0.45, s * 0.62 - 0.07, s * 0.62 + 0.07, 0.85, 1.45, 0.7);
  segBox(G, 'iron', Fp, -0.45, 0.45, -0.62, 0.62, 1.38, 1.5, 0.72);
  G.cyl('iron', 71.0 - 0.3, 1.05, 154, 0.16, 0.16, 0.1, 10, 0.6);
  segBox(G, 'e07Canvas', Fp, -0.75, 0.2, -0.95, 0.95, 1.5, 1.56, 0.85);
  segBox(G, 'e07Canvas', Fp, -0.78, -0.72, -0.95, 0.95, 0.4, 1.56, 0.8);
  // the plate case on its trestle (the hand device): a type case with its lid up
  const [px, pz] = PLATE_CASE, Fc = localFrame(px, pz, 0);
  for (const s of [-1, 1]) { segBox(G, 'e07Trim', Fc, s * 0.42 - 0.04, s * 0.42 + 0.04, -0.3, 0.3, 0, 0.8, 0.85); }
  segBox(G, 'e07Trim', Fc, -0.55, 0.55, -0.32, 0.32, 0.8, 0.86, 0.95);
  segBox(G, 'e07Olive', Fc, -0.4, 0.4, -0.25, 0.25, 0.86, 1.06, 0.9);
  segBox(G, 'e07Olive', Fc, -0.4, 0.4, -0.27, -0.23, 1.06, 1.46, 0.85);
  const press = softSnow(G.build('e07:press', { ground: 0, damp: 0.2, moss: 0 }));
  root.add(press);
  // the plates themselves (bright metal), hidden once they are taken
  const plates = new THREE.Group();
  plates.name = 'e07:plates';
  const pm = paintedMaterial('steel', 0xb9bcc0, { metalness: 0.8, roughness: 0.35 });
  for (let k = 0; k < 5; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.015, 0.2), pm);
    p.position.set(px - 0.3 + k * 0.15, 1.075, pz);
    plates.add(p);
  }
  root.add(plates);
  return plates;
}

// ---------------------------------------------------------------- the container and its parachute
function buildContainer(root, world = null) {
  const G = new Geo('e07:container'), cx = 94.5, cz = 75.6, rot = deg(25), F = localFrame(cx, cz, rot);
  // (the drawn snow under the canopy: the drifts west of the canister stand up to 0.2 m over the flattened patch it
  // lies on — the canopy follows them, or most of it would be buried under the ground's surface)
  const hAt = world?.terrain?.heightAt, gY = (x, z) => { const v = hAt ? hAt.call(world.terrain, x, z) : 0; return Number.isFinite(v) ? v : 0; };
  // a split supply canister: two half-shells lying open, the padded cells, the end caps
  for (const s of [-1, 1]) {
    const Fs = localFrame(...F.at(0, s * 0.42), rot);
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI, a1 = ((k + 1) / 8) * Math.PI, r = 0.24;
      const y0 = Math.sin(a0) * r, y1 = Math.sin(a1) * r, w0 = Math.cos(a0) * r * s, w1 = Math.cos(a1) * r * s;
      const P = (u, w, y) => { const [x, z] = Fs.at(u, w); return [x, 0.02 + r - y, z]; };
      G.quad('e07Olive', P(-0.85, w0, y0), P(0.85, w0, y0), P(0.85, w1, y1), P(-0.85, w1, y1), 0.95 - 0.04 * (k % 2));
    }
    for (let u = -0.65; u <= 0.66; u += 0.43) segBox(G, 'e07Canvas', Fs, u - 0.2, u + 0.2, -0.17, 0.17, 0.04, 0.2, 0.9);
  }
  segBox(G, 'iron', F, 0.85, 0.98, -0.25, 0.25, 0.02, 0.47, 0.7);
  segBox(G, 'iron', F, -0.98, -0.85, -0.25, 0.25, 0.02, 0.47, 0.7);
  // the canopy where the night's wind dragged it: collapsed downwind of the canister in a long bundle — the skirt
  // gathered towards the lines, the crown spread out at the far end in loose lobes — each gore puffed up between its
  // seams (ridges along the drag, valleys at the seams), air still trapped under the crown, the outline ragged; the
  // gores in alternate olive drab and khaki (an Allied supply chute); the storm's snow lodged in the valleys and
  // drifted over its windward edge
  const s = seedOf('e07:chute') & 0xffff, gores = 12, nu = 24, nw = gores * 2;
  const ring = F.at(-0.95, 0), aim = [90.3 - ring[0], 78.2 - ring[1]], al = Math.hypot(aim[0], aim[1]);
  const du = [aim[0] / al, aim[1] / al], dw = [-du[1], du[0]], uH = 1.35, uLen = 4.9;
  const pts = [];
  // (the gores laid side by side unevenly: some bunched, some spread — their widths vary)
  const gw = [];
  for (let g = 0; g < gores; g++) gw.push(0.7 + 0.6 * f01p(fbm(g * 0.71, 3.3, 0.6, s + 15, 1)));
  const gsum = gw.reduce((a, b) => a + b, 0), cum = [0];
  for (let g = 0; g < gores; g++) { const c0 = cum[2 * g]; cum.push(c0 + gw[g] / 2, c0 + gw[g]); }
  for (let j = 0; j <= nw; j++) {
    const wn = (cum[j] / gsum) * 2 - 1, col = [];
    // (the crown's edge: a wandering line with two or three loose lobes — mid-frequency at most, so the fabric stays
    // one sheet)
    const uEnd = uH + uLen * (1 - 0.22 * wn * wn) + 0.45 * fbm(wn * 0.9, 0.4, 1.7, s + 1, 2) + 0.38 * fbm(wn * 3.1, 1.9, 0.7, s + 21, 2);
    for (let i = 0; i <= nu; i++) {
      const t = i / nu, u = lerp(uH, uEnd, t);
      const half = (0.5 + 1.2 * smooth01(t * 1.35)) * (1 + 0.2 * fbm(t * 3.1, 2.2, 0.3, s + 3, 2));
      const shift = 0.55 * Math.sin(t * 2.1 + 0.7) * t + 0.12 * fbm(t * 5.0, 0.9, 1.1, s + 5, 1);
      const wander = 0.22 * fbm(u * 0.8, wn * 1.7, 0.5, s + 17, 2) * (0.3 + t); // (the gores twist and bunch)
      // (the side edges ruffled and folded, each its own way)
      const ruffle = 0.18 * wn * wn * wn * fbm(t * 8.5, wn * 1.3, 0.2, s + 23, 2) * smooth01(t / 0.2);
      const w = wn * half + shift + wander + ruffle, x = ring[0] + du[0] * u + dw[0] * w, z = ring[1] + du[1] * u + dw[1] * w;
      const phase = ((j / nw) * gores) % 1, puff = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      const edge = smooth01((1 - Math.abs(wn)) / 0.22) * smooth01(t / 0.12) * smooth01((1 - t) / 0.06 + 0.25);
      const air = 0.38 * Math.max(0, fbm(x * 0.7, 0.2, z * 0.7, s + 7, 2) + 0.15) * smooth01((t - 0.35) / 0.45);
      const crease = 0.05 * fbm(x * 2.4, 1.3, z * 2.4, s + 9, 2);
      const lift = 0.035 + Math.max(0, (puff * (0.09 + 0.16 * t) + air + crease) * edge);
      col.push([x, gY(x, z) + lift, z, puff, wn, t, lift]);
    }
    pts.push(col);
  }
  for (let j = 0; j < nw; j++) for (let i = 0; i < nu; i++) {
    const a = pts[j][i], b = pts[j + 1][i], c = pts[j + 1][i + 1], d = pts[j][i + 1], t = (a[5] + c[5]) / 2;
    // (olive drab cotton, each gore its own shade of sun-faded; two gores of a khaki repair panel)
    const g = Math.floor(j / 2), m = g === 4 || g === 9 ? 'e07ChuteKh' : 'e07ChuteOD';
    const tone = (0.9 + 0.1 * Math.min(1, (a[6] + c[6]) * 2.2) - 0.04 * (1 - t)) * (0.93 + 0.07 * f01p(fbm(g * 1.37, 0.2, 2.1, s + 19, 1)));
    G.quad(m, [a[0], a[1], a[2]], [b[0], b[1], b[2]], [c[0], c[1], c[2]], [d[0], d[1], d[2]], tone);
    // (the underside, a shade darker: the sheet is seen from below where its edge lifts)
    G.quad(m, [a[0], a[1] - 0.012, a[2]], [d[0], d[1] - 0.012, d[2]], [c[0], c[1] - 0.012, c[2]], [b[0], b[1] - 0.012, b[2]], 0.55);
  }
  // the storm's snow drifted over the windward edge: a tongue lying on the cloth, its inner edge wandering along the
  // canopy (continuous, not stepped at the gores), thickest where it buries the hem into the ground snow, a few
  // centimetres proud of the cloth at its thin edge (never in its plane)
  const at = (wn, i) => { // the canopy surface at (wn, row i): between the two columns around wn
    let j = 0;
    while (j < nw - 1 && pts[j + 1][i][4] < wn) j++;
    const p = pts[j][i], q = pts[j + 1][i], f = Math.min(1, Math.max(0, (wn - p[4]) / ((q[4] - p[4]) || 1)));
    return [lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f)];
  };
  const K = 7, drift = [];
  for (let i = 0; i <= nu; i++) {
    const t = i / nu, wnB = -0.62 + 0.2 * fbm(t * 4.3, 1.7, 0.9, s + 13, 2) + 0.12 * fbm(t * 11.0, 3.1, 0.2, s + 27, 1) - 0.25 * (1 - smooth01(t / 0.35));
    const row = [], ends = 0.15 + 0.85 * smooth01(Math.min(t, 1 - t) / 0.14); // (thinning out at both ends of the tongue)
    for (let k = 0; k <= K; k++) {
      const f = k / K, wn = lerp(-1.08, wnB, f), p = at(Math.max(-1, wn), i);
      // (past the hem it runs out over the ground; over the cloth it thins towards its edge, lumpy)
      const out = Math.max(0, -1 - wn) * 3.2, dx = -dw[0] * out, dz = -dw[1] * out;
      const h = 0.016 + 0.17 * ends * Math.pow(1 - f, 1.4) * (0.75 + 0.5 * f01p(fbm(p[0] * 2.1, 0.7, p[2] * 2.1, s + 29, 2)));
      row.push([p[0] + dx, (out > 0 ? gY(p[0] + dx, p[2] + dz) + 0.02 : p[1]) + h * (out > 0 ? 0.5 : 1), p[2] + dz]);
    }
    // (beyond the hem it runs on out over the ground snow and dies into it, its toe dug in: no edge standing up)
    const o = row[0], oy = o[1] - gY(o[0], o[2]);
    for (const [ex, ey] of [[0.45, 0.25], [0.95, -1]]) {
      const qx = o[0] - dw[0] * ex, qz = o[2] - dw[1] * ex;
      row.unshift([qx, gY(qx, qz) + (ey < 0 ? -0.06 : 0.02 + oy * ey), qz]);
    }
    drift.push(row);
  }
  for (let i = 0; i < nu; i++) for (let k = 0; k < K + 2; k++) {
    const a = drift[i][k], b = drift[i][k + 1], c = drift[i + 1][k + 1], d = drift[i + 1][k];
    G.quad('e07Snow', a, b, c, d, 1.0);
  }
  const cont = G.build('e07:container', { ground: 0, damp: 0, moss: 0 });
  softSnow(cont);
  root.add(cont);
  // the shroud lines: gathered from every other gore's hem, slack, to the canister's harness ring (one mesh: the
  // segments are merged, not a draw call each)
  const q = F.at(-0.95, 0), ringV = new THREE.Vector3(q[0], 0.32, q[1]), cords = [], Y = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j <= gores; j++) {
    const p = pts[Math.min(nw, j * 2)][0], a = new THREE.Vector3(p[0], p[1] + 0.02, p[2]), ring = ringV;
    const mid = a.clone().lerp(ring, 0.5); mid.y = Math.max(0.06, (a.y + ring.y) / 2 - 0.12 - 0.05 * (j % 3));
    for (const [u, v] of [[a, mid], [mid, ring]]) {
      const g = new THREE.CylinderGeometry(0.007, 0.007, u.distanceTo(v), 3, 1);
      const rot = new THREE.Quaternion().setFromUnitVectors(Y, v.clone().sub(u).normalize());
      cords.push(g.applyMatrix4(new THREE.Matrix4().compose(u.clone().lerp(v, 0.5), rot, new THREE.Vector3(1, 1, 1))));
    }
  }
  const lines = new THREE.Mesh(mergeGeometries(cords, false), paintedMaterial('canvas', 0xd9d4c0));
  lines.name = 'e07:chute_lines';
  root.add(lines);
}

// ---------------------------------------------------------------- small pieces: shrine, ski rack, tarn, poles, aerial
function buildSmall(root) {
  const G = new Geo('e07:small');
  // the wayside shrine on the summit (a carved crucifix under a little shingled roof, a fieldstone base)
  const Fx = localFrame(47.6, 101.2, deg(10));
  segBox(G, 'rubble', Fx, -0.35, 0.35, -0.3, 0.3, 0, 0.6, 0.85);
  segBox(G, 'e07Trim', Fx, -0.07, 0.07, -0.06, 0.06, 0.6, 3.3, 0.9);
  segBox(G, 'e07Trim', Fx, -0.65, 0.65, -0.06, 0.06, 2.4, 2.53, 0.9);
  segBox(G, 'e07Frame', Fx, -0.1, 0.1, 0.06, 0.12, 1.55, 2.35, 0.92);
  segBox(G, 'e07Frame', Fx, -0.55, 0.55, 0.06, 0.11, 2.36, 2.46, 0.92);
  const P = (u, y, w) => { const [x, z] = Fx.at(u, w); return [x, y, z]; };
  for (const sw of [-1, 1]) G.quad('e07Shingle', P(-0.85, 3.05, sw * 0.5), P(0.85, 3.05, sw * 0.5), P(0.85, 3.45, 0), P(-0.85, 3.45, 0), 0.95);
  for (const sw of [-1, 1]) G.quad('e07RoofSnow', P(-0.82, 3.12, sw * 0.42), P(0.82, 3.12, sw * 0.42), P(0.82, 3.52, 0), P(-0.82, 3.52, 0), 1.03);
  // the ski rack by the hotel's east corner: two trestles, a rail, skis and sticks leaning
  const Fs = localFrame(75.8, 127.4, 0);
  for (const s of [-1, 1]) { segBox(G, 'e07Trim', Fs, s * 1.1 - 0.05, s * 1.1 + 0.05, -0.3, 0.3, 0, 1.25, 0.9); }
  segBox(G, 'e07Trim', Fs, -1.2, 1.2, -0.05, 0.05, 1.2, 1.3, 0.92);
  for (let k = 0; k < 7; k++) {
    const u = -0.95 + k * 0.3, Fk = localFrame(...Fs.at(u, 0.25), 0);
    const a = [Fk.at(0, 0.22)[0], 0.02, Fk.at(0, 0.22)[1]], b = [Fk.at(0, -0.02)[0], 1.9, Fk.at(0, -0.02)[1]];
    G.quad(k % 2 ? 'e07Trim' : 'e07Shutter', [a[0] - 0.04, a[1], a[2]], [a[0] + 0.04, a[1], a[2]], [b[0] + 0.04, b[1], b[2]], [b[0] - 0.04, b[1], b[2]], 0.9);
  }
  // snow poles along the pass road (red-white marker poles every ~12 m on its east verge)
  const road = [[60, 196], [60.5, 150], [57, 138], [52.5, 126], [52, 112], [56, 101], [61.4, 94], [61.6, 58], [62.2, 50], [62.2, 18], [61.6, 4]];
  for (let k = 0; k + 1 < road.length; k++) {
    const [a, b] = [road[k], road[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < L; t += 12) {
      const x = a[0] + ((b[0] - a[0]) * t) / L + 1.4, z = a[1] + ((b[1] - a[1]) * t) / L;
      if (z > 21 && z < 49) continue; // (in the gallery)
      if (z > 62 && z < 92) continue; // (in the tunnel)
      for (let y = 0; y < 2.0; y += 0.4) G.cyl(Math.round(y / 0.4) % 2 ? 'e07Frame' : 'signal', x, y, z, 0.035, 0.035, 0.4, 6, 1);
    }
  }
  // the DF lorry's loop aerial (over the north lorry)
  G.cyl('iron', 67.4, 2.9, 146, 0.04, 0.04, 1.4, 6, 0.7);
  G.ring('iron', 67.4, 4.3, 146, 0.42, 0.5, 0.05, 16, 0.75);
  root.add(softSnow(G.build('e07:small', { ground: 0, damp: 0.3, moss: 0 })));
}

// ---------------------------------------------------------------- the frozen tarn
const TARN_S = seedOf('e07:tarn') & 0xffff;
/** The tarn's middle (its gameplay ground is the def's 5 m bare-ice circle there). */
const TARN_C = [98, 140];
/** The tarn's shore radius at angle a around TARN_C: a ragged, never round outline. */
const tarnR = (a) => 4.75 + 0.6 * fbm(Math.cos(a) * 1.3, 0.2, Math.sin(a) * 1.3, TARN_S, 3) + 0.24 * fbm(Math.cos(a) * 3.2, 0.6, Math.sin(a) * 3.2, TARN_S + 2, 2);
/** The wind over the tarn blows towards the south-east (+x, +z): the drift piles on that shore, streams off the other. */
const TARN_WIND = [0.62, 0.78];
/** The ice's lift over the drawn ground under it (m): a real offset (the ground's own relief rises 3-4 cm over the old
 *  flat sheet's level in places, and walkers' berms a few more), the sheet draped on the ground, never sunk in it. */
const ICE_LIFT = 0.03;

/**
 * The shore at angle a, from a table (720 steps round the tarn, interpolated): R the shore radius; `tongue` how far the
 * shore drift runs out onto the ice (m; negative where the wind has scoured the ice bare past the shore line); `iceOut`
 * how far the ice reaches past the shore under the drift (0.4 m past where the drift starts, never under 0.35 m);
 * W the drift's reach beyond the shore and H its height — both in lobes at two scales (a few metres and about one), cut
 * back hard where scoured, W never short of covering the ice's edge, H highest on the lee (south-east) shore.
 */
function tarnShore() {
  const N = 720, S = TARN_S, t = new Float64Array((N + 1) * 5);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const cut = smooth01((fbm(ca * 1.9, 7.7, sa * 1.9, S + 23, 2) - 0.3) / 0.16);
    const lee = Math.max(0, Math.cos(a - 0.9));
    const tongue = 0.12 + 0.5 * f01p(fbm(ca * 2.4, 1.9, sa * 2.4, S + 41, 2)) + 0.4 * fbm(ca * 5.5, 4.4, sa * 5.5, S + 43, 2)
      + 0.55 * lee * f01p(fbm(ca * 3.8, 0.7, sa * 3.8, S + 45, 1)) - 0.9 * cut;
    const iceOut = Math.max(0.35, 0.4 - tongue);
    const W = Math.max((iceOut + 0.3) / 0.85,
      (1.1 + 0.9 * f01p(fbm(ca * 1.7, 5.1, sa * 1.7, S + 19, 2))) * (0.6 + 0.6 * f01p(fbm(ca * 6.5, 2.6, sa * 6.5, S + 47, 2))) * (1 - 0.7 * cut));
    const H = (0.12 + 0.34 * f01p(fbm(ca * 2.1, 3.3, sa * 2.1, S + 17, 2))) * (0.7 + 0.45 * lee) * (1 - 0.85 * cut) * (0.8 + 0.4 * f01p(fbm(ca * 5, 1.7, sa * 5, S + 49, 1)));
    t.set([tarnR(a), tongue, iceOut, W, H], i * 5);
  }
  const out = { R: 0, tongue: 0, iceOut: 0, W: 0, H: 0 };
  return (a) => {
    let u = a / (Math.PI * 2); u -= Math.floor(u);
    const f = u * N, i = Math.min(N - 1, Math.floor(f)), k = f - i, p = i * 5, q = p + 5;
    out.R = lerp(t[p], t[q], k); out.tongue = lerp(t[p + 1], t[q + 1], k); out.iceOut = lerp(t[p + 2], t[q + 2], k);
    out.W = lerp(t[p + 3], t[q + 3], k); out.H = lerp(t[p + 4], t[q + 4], k);
    return out;
  };
}

/**
 * The frozen tarn: a sheet of ice draped on the drawn ground (ICE_LIFT over it, a hair of polygon offset as well),
 * wind-polished black in streaks with frosted grey between and dusted pale where blown snow lies near; and one sheet of
 * the map's ground snow over it all (GROUND_SNOW, soft normals), cut out where the ice is bare. That snow is one
 * coverage field (m, + under snow): the shore drift, which runs out onto the ice in tongues and lobes at two scales and is
 * scoured back to bare ice past the shore in a few bays, and the patches blown out on the open ice, stretched along the
 * wind with ragged, streaky edges and flecks. Every edge on the ice feathers out: the snow comes down to 1.6 cm under
 * the ice's face — a 3.6 cm rise over its first 5 cm (no lip and no ledge, never lying flat on the ice: the edge is a
 * steep, stable crossing), then thickens over 0.35-0.5 m to its lumpy depth — 4-9 cm on the open ice, the berm's height
 * on the shore. The berm's outer toe runs out in the same lobes, cut back where scoured, and dives under the snowfield's
 * own snow. Stones lie in the drift. Sliced (a grid of ~6500 points of the field; the ice ~3500).
 * @param {THREE.Group} root @param {object} world
 */
export function* buildTarnG(root, world) {
  const T = world?.terrain?.terrain;
  if (!T?.surfaceAt) {
    // (the drawn ground is not up yet — a slow machine past the load's terrain wait: built when it is)
    world?.terrain?.ready?.then?.(() => runSync(buildTarnG(root, world)), () => {});
    return;
  }
  const [cx, cz] = TARN_C, S = TARN_S, shore = tarnShore(), surf = (x, z) => T.surfaceAt(x, z) || 0;
  // ---- the coverage field and the snow's depth on a grid (0.2 m) over the tarn and its shore
  const h = 0.2, half = 8.2, n = Math.round((2 * half) / h), n1 = n + 1, x0 = cx - half, z0 = cz - half;
  const D = new Float32Array(n1 * n1), Dn = new Float32Array(n1 * n1), Tk = new Float32Array(n1 * n1), Gd = new Float32Array(n1 * n1), B = new Float32Array(n1 * n1);
  const Ds = new Float32Array(n1 * n1), Sv = new Float32Array(n1 * n1);
  const [w0, w1] = TARN_WIND;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * n1 + i, x = x0 + i * h, z = z0 + j * h, dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz), sh = shore(Math.atan2(dz, dx));
      const s = r - sh.R, ds = s + sh.tongue;
      let dp = -9;
      if (s < -0.2) {
        // the blown patches: long along the wind, ragged and streaky across it, fading out short of the shore drift
        const u = x * w0 + z * w1, v = -x * w1 + z * w0;
        const pf = fbm(u * 0.3, 2.7, v * 0.75, S + 11, 3) + 0.45 * fbm(x * 1.2, 0.3, z * 1.2, S + 13, 2) + 0.24 * fbm(u * 0.9, 1.1, v * 2.2, S + 15, 2) - 0.1;
        dp = Math.min(pf * 1.6, (-s - 0.2) * 2.5);
      }
      D[k] = Math.max(ds, dp); Ds[k] = ds - dp; Sv[k] = s;
      Gd[k] = surf(x, z);
    }
    if (due()) yield;
  }
  // the drawn ground under the sheets, kept high: the highest of its 3 × 3 neighbourhood (±0.2 m), so no triangle of
  // the terrain between two of the ice's points stands up through it
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    let m = -Infinity;
    for (let b = Math.max(0, j - 1); b <= Math.min(n, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(n, i + 1); a++) m = Math.max(m, Gd[b * n1 + a]);
    B[j * n1 + i] = m;
  }
  if (due()) yield;
  // the field over its own gradient (≈ metres from its edge, whatever its slope), and the snow's depth over the ice
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * n1 + i, x = x0 + i * h, z = z0 + j * h;
      const gx = (D[j * n1 + Math.min(n, i + 1)] - D[j * n1 + Math.max(0, i - 1)]) / (h * (Math.min(n, i + 1) - Math.max(0, i - 1)));
      const gz = (D[Math.min(n, j + 1) * n1 + i] - D[Math.max(0, j - 1) * n1 + i]) / (h * (Math.min(n, j + 1) - Math.max(0, j - 1)));
      const dn = D[k] / Math.max(0.35, Math.hypot(gx, gz));
      Dn[k] = dn;
      const dx = x - cx, dz = z - cz, sh = shore(Math.atan2(dz, dx)), s = Sv[k];
      const lumpL = fbm(x * 0.9, 4.2, z * 0.9, S + 61, 2), lumpS = fbm(x * 2.3, 1.6, z * 2.3, S + 63, 1);
      // the shore drift's depth across its section (thin out on the ice, the berm's crest a third of the way out)
      const q = s / sh.W, thin = 0.04 + 0.04 * f01p(lumpL);
      const As = thin + Math.max(0, sh.H - thin) * smooth01((q + 0.15) / 0.45) * (1 - smooth01((q - 0.35) / 0.65));
      const Ap = 0.035 + 0.055 * f01p(lumpL); // (a blown patch)
      const A0 = lerp(Ap, As, smooth01(Ds[k] / 0.4 + 0.5));
      const A = A0 + (0.035 * lumpL + 0.016 * lumpS) * Math.min(1, A0 / 0.12);
      const F = 0.35 + 0.15 * f01p(fbm(x * 0.7, 5.5, z * 0.7, S + 67, 1));
      const toe = -0.12 * smooth01((s - 0.85 * sh.W) / (0.3 * sh.W + 0.15));
      const e = Math.max(0, dn);
      Tk[k] = -0.016 + 0.036 * smooth01(e / 0.05) + (A - 0.02) * (1 - (1 - Math.min(1, e / F)) ** 2) + toe;
    }
    if (due()) yield;
  }
  // ---- the snow: the grid's triangles, cut along the field's edge (the cut points 1.6 cm under the ice), the ones
  // wholly under the snowfield past the toe left out
  const G = new Geo('e07:tarn_snow');
  const P = (k) => [x0 + (k % n1) * h, B[k] + ICE_LIFT + Tk[k], z0 + Math.floor(k / n1) * h];
  const tri = (ka, kb, kc) => {
    if (Tk[ka] < -0.075 && Tk[kb] < -0.075 && Tk[kc] < -0.075) return;
    const q = [ka, kb, kc], poly = [];
    for (let m = 0; m < 3; m++) {
      const a = q[m], b = q[(m + 1) % 3], da = Dn[a], db = Dn[b];
      if (da > 0) poly.push(P(a));
      if ((da > 0) !== (db > 0)) {
        const t = da / (da - db), pa = P(a), pb = P(b);
        poly.push([lerp(pa[0], pb[0], t), lerp(B[a], B[b], t) + ICE_LIFT - 0.016, lerp(pa[2], pb[2], t)]);
      }
    }
    for (let m = 1; m + 1 < poly.length; m++) triN(G, 'e07Snow', poly[0], poly[m], poly[m + 1], [0, 1, 0], 1);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n1 + i;
      // (the diagonals alternate: no grain)
      if ((i + j) % 2) { tri(k, k + 1, k + n1 + 1); tri(k, k + n1 + 1, k + n1); } else { tri(k, k + 1, k + n1); tri(k + 1, k + n1 + 1, k + n1); }
    }
    if (due()) yield;
  }
  root.add(softSnow(G.build('e07:tarn_snow', { ground: 0, damp: 0, streaks: 0, moss: 0 })));
  if (due()) yield;
  // ---- the ice: rings out to 0.35-1.25 m past the shore (always under the drift), draped on the ground
  const grid = (arr, x, z) => {
    const fi = Math.min(n - 1e-6, Math.max(0, (x - x0) / h)), fj = Math.min(n - 1e-6, Math.max(0, (z - z0) / h));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * n1 + i;
    return lerp(lerp(arr[k], arr[k + 1], u), lerp(arr[k + n1], arr[k + n1 + 1], u), v);
  };
  const NS = 160, NR = 24, pos = [], col = [], idx = [];
  const dark = new THREE.Color(0x4f6577), light = new THREE.Color(0xb6c6d2), frost = new THREE.Color(0xd3dde4), c = new THREE.Color();
  const vtx = (x, z) => {
    const k = f01p(fbm(x * 0.32, 0.4, z * 0.32, S + 5, 3)), st = f01p(fbm((x * 0.8 + z * 0.35) * 0.9, 1.1, (z * 0.8 - x * 0.35) * 0.22, S + 7, 2));
    c.copy(dark).lerp(light, Math.min(1, 0.25 + 0.6 * k + 0.14 * (st > 0.58 ? 0 : 1)));
    // dusted pale where blown snow lies near (streaked along the wind, gone within half a metre of the snow's edge)
    const u = x * w0 + z * w1, v = -x * w1 + z * w0;
    const dust = smooth01(1 + grid(Dn, x, z) / 0.45) * (0.55 + 0.45 * f01p(fbm(u * 0.45, 3.9, v * 2.4, S + 9, 2)));
    c.lerp(frost, 0.78 * dust);
    pos.push(x, grid(B, x, z) + ICE_LIFT, z); col.push(c.r, c.g, c.b);
  };
  vtx(cx, cz);
  for (let i = 1; i <= NR; i++) for (let j = 0; j < NS; j++) {
    const a = (j / NS) * Math.PI * 2, sh = shore(a), r = (sh.R + sh.iceOut) * (i / NR);
    vtx(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  for (let j = 0; j < NS; j++) idx.push(0, 1 + ((j + 1) % NS), 1 + j);
  for (let i = 1; i < NR; i++) for (let j = 0; j < NS; j++) {
    const a = 1 + (i - 1) * NS + j, b = 1 + (i - 1) * NS + ((j + 1) % NS), c2 = a + NS, d = b + NS;
    idx.push(a, b, d, a, d, c2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // (its normals face up whatever the winding: the rings run anticlockwise seen from above)
  if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
  const ice = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  ice.receiveShadow = true; ice.name = 'e07:tarn';
  root.add(ice);
  // ---- stones lying in the drift on the shore, sunk a third into it
  const st = new THREE.Group(); st.name = 'e07:tarn_stones';
  [[0.4, 0.42], [1.1, 0.3], [2.6, 0.55], [2.75, 0.28], [4.1, 0.36], [5.3, 0.48], [5.45, 0.22]].forEach(([a, r], k) => {
    const d = tarnR(a) + 0.5 + 0.4 * (k % 2), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const b = new THREE.Mesh(boulderGeometry(r, r * 0.6, r * 0.85, 7600 + k, 2), dressingMaterial(k % 3 ? 'rockDark' : 'rock'));
    b.position.set(x, grid(B, x, z) + ICE_LIFT + Math.max(0, grid(Tk, x, z)) * 0.6 + r * 0.05, z); b.rotation.y = k * 1.9; b.castShadow = true; b.receiveShadow = true;
    st.add(b);
  });
  root.add(st);
}

// ---------------------------------------------------------------- the hamlet: Ötztal farmhouses, the chapel, the barn
/** The hamlet's buildings drawn over the def's footprints (their gameplay boxes, doors and roofs stay the def's). */
const HAMLET = [
  ['farm1', 'farm'], ['farm2', 'farm'], ['farm3', 'farm'], ['farm4', 'farm'], ['chapel', 'chapel'], ['barn', 'barn'],
];
function* buildHamletG(root, world) {
  for (const [id, kind] of HAMLET) {
    if (due()) yield;
    const st = world.structures?.get(id), sp = st?.def ?? (world.mission?.structures || []).find((q) => q.id === id);
    if (!sp) continue;
    const G = new Geo(`e07:${id}`), p = { x: sp.x, z: sp.z, w: sp.w, d: sp.d, rot: sp.rot ?? 0, seed: `e07:${id}` };
    if (kind === 'farm') tyrolFarmhouse(G, p);
    else if (kind === 'chapel') onionChapel(G, p);
    else stadel(G, p);
    root.add(softSnow(G.build(`e07:${id}`, { ground: 0, damp: 0.7, streaks: 0.14, moss: 0.04 })));
  }
  // the dog's kennel by farm2: a plank box on a sill, a pitched shingle roof under snow, straw at the door, the chain
  const k = (world.mission?.structures || []).find((q) => q.id === 'kennel') ?? world.structures?.get('kennel')?.def;
  if (k) {
    const G = new Geo('e07:kennel'), F = localFrame(k.x, k.z, k.rot ?? 0), hw = k.w / 2 - 0.05, hd = k.d / 2 - 0.05, P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
    segBox(G, 'e07Trim', F, -hw, hw, -hd, hd, 0, 0.1, 0.8);
    segBox(G, 'e07Boards', F, -hw, hw, -hd, hd, 0.1, 0.75, 0.9);
    triN(G, 'e07Boards', P(-hw, -hd, 0.75), P(hw, -hd, 0.75), P(0, -hd, 1.05), [-F.n[0], 0, -F.n[1]], 0.88);
    triN(G, 'e07Boards', P(-hw, hd, 0.75), P(hw, hd, 0.75), P(0, hd, 1.05), [F.n[0], 0, F.n[1]], 0.88);
    for (const s of [-1, 1]) {
      const e0 = P(s * (hw + 0.12), -hd - 0.1, 0.7), e1 = P(s * (hw + 0.12), hd + 0.1, 0.7), r1 = P(0, hd + 0.1, 1.08), r0 = P(0, -hd - 0.1, 1.08);
      quadN(G, 'e07Shingle', e0, e1, r1, r0, [F.t[0] * s, 1, F.t[1] * s], 0.9);
      snowBlanket(G, e0, e1, r1, r0, { seed: `e07:kennel${s}`, th: 0.12, lip: 0.06, droop: 0.08, verge: 0.06, icicles: 1 });
    }
    segBox(G, 'e07Glass', localFrame(...F.at(0, hd), k.rot ?? 0), -0.22, 0.22, -0.02, 0.012, 0.12, 0.55, 0.2); // the dark doorway
    segBox(G, 'bark', localFrame(...F.at(0, hd + 0.3), k.rot ?? 0), -0.35, 0.35, -0.25, 0.25, 0.0, 0.06, 1.1); // trodden straw
    root.add(softSnow(G.build('e07:kennel', { ground: 0, damp: 0.4, moss: 0 })));
  }
}

// ---------------------------------------------------------------- the bowser on the pushable, the knapsacks
function bowserMesh() {
  const G = new Geo('e07:bowser');
  // local frame: u along the heading (length 4), w across (width 2); the tank on a two-axle trailer, drawbar ahead
  const F = localFrame(0, 0, 0);
  segBox(G, 'e07Dunkelgelb', F, -1.8, 1.7, -0.75, 0.75, 0.55, 0.7, 0.85); // chassis
  const r = 0.68, y0 = 1.38;
  for (let k = 0; k < 14; k++) {
    const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2;
    G.quad('e07Dunkelgelb', [-1.7, y0 + Math.sin(a0) * r, Math.cos(a0) * r], [-1.7, y0 + Math.sin(a1) * r, Math.cos(a1) * r], [1.55, y0 + Math.sin(a1) * r, Math.cos(a1) * r], [1.55, y0 + Math.sin(a0) * r, Math.cos(a0) * r], 0.92 + 0.06 * Math.sin(a0));
    G.tri('e07Dunkelgelb', [-1.7, y0, 0], [-1.7, y0 + Math.sin(a1) * r, Math.cos(a1) * r], [-1.7, y0 + Math.sin(a0) * r, Math.cos(a0) * r], 0.82);
    G.tri('e07Dunkelgelb', [1.55, y0, 0], [1.55, y0 + Math.sin(a0) * r, Math.cos(a0) * r], [1.55, y0 + Math.sin(a1) * r, Math.cos(a1) * r], 0.82);
  }
  for (const u of [-1.2, 1.0]) for (const w of [-0.82, 0.82]) { // wheels
    const s = Math.sign(w);
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2, rr = 0.42;
      G.quad('rubber', [u + Math.cos(a0) * rr, 0.42 + Math.sin(a0) * rr, w + s * 0.12], [u + Math.cos(a1) * rr, 0.42 + Math.sin(a1) * rr, w + s * 0.12], [u + Math.cos(a1) * rr, 0.42 + Math.sin(a1) * rr, w - s * 0.1], [u + Math.cos(a0) * rr, 0.42 + Math.sin(a0) * rr, w - s * 0.1], 0.8);
      G.tri('rubber', [u, 0.42, w + s * 0.12], [u + Math.cos(a1) * rr, 0.42 + Math.sin(a1) * rr, w + s * 0.12], [u + Math.cos(a0) * rr, 0.42 + Math.sin(a0) * rr, w + s * 0.12], 0.6);
    }
  }
  segBox(G, 'e07Dunkelgelb', F, 1.7, 2.0, -0.08, 0.08, 0.5, 0.62, 0.8); // drawbar
  segBox(G, 'iron', F, -0.25, 0.25, -0.25, 0.25, y0 + r - 0.05, y0 + r + 0.15, 0.7); // filler dome
  segBox(G, 'iron', F, -1.98, -1.73, -0.3, 0.3, 0.75, 1.25, 0.7); // hose reel box (3 cm off the tank's end)
  segBox(G, 'e07Frame', F, -0.9, 0.9, 0.69, 0.71, 1.25, 1.55, 1.1); // stencil band
  const g = softSnow(G.build('e07:bowser', { ground: 0, damp: 0.4, moss: 0 }));
  g.rotation.y = -Math.PI / 2; // (u along the entity's heading, as the placeholder's inner box)
  return g;
}

/**
 * The convoy's fuel bowser on the pushable: the library's two-axle bowser (fuel_bowser, the theatre's winter paint;
 * preloaded through the def's vehicleArtExtra), fitted onto the pushable's 4 × 2 m footprint as the static vehicles are
 * (art/static-vehicles.js fitOnFootprint on its dims; the drawbar reaches past it). The pushable's frame has its heading
 * along +z, as the library's models face; the tank is centred on the box (the model's bbox runs 18 cm long at the
 * front). `destroyed`: its burnt variant (the wreck). The kit primitives (bowserMesh) stand in without the library.
 */
const BOWSER_DIMS = [5.8, 2.0];
function bowserModel(size = [4, 2], destroyed = false) {
  if (!vehicleArtReady()) return null;
  let vis = null;
  try { vis = createVehicleVisual('fuel_bowser', { theater: 'snow', seed: 41, destroyed }); } catch { vis = null; }
  if (!vis) return null;
  addVehicleReleaser(() => vis.dispose());
  const holder = new THREE.Group();
  holder.name = destroyed ? 'e07:bowser_wreck' : 'e07:bowser';
  const k = fitOnFootprint(BOWSER_DIMS, size, 1.1);
  holder.scale.setScalar(k);
  holder.position.z = -0.18 * k;
  holder.add(vis.object3d);
  vis.ready.then(() => markShared(vis.object3d)).catch(() => {});
  return holder;
}

function rucksack(color) {
  const g = new THREE.Group();
  const m = paintedMaterial('canvas', color), strap = paintedMaterial('canvas', 0x3b3a2a);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.34), m); body.position.y = 0.18; g.add(body);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.28), m); flap.position.set(0, 0.38, 0.02); g.add(flap);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.1), m); p.position.set(s * 0.33, 0.14, 0); g.add(p); }
  for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.37, 0.36), strap); st.position.set(s * 0.13, 0.19, 0); g.add(st); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function dressInteractables(world) {
  for (const it of world.interactables || []) {
    const o = it.object3d, inner = o?.userData?.inner;
    if (!o || !inner) continue;
    if (it.tag === 'bowser') { inner.visible = false; o.add(bowserModel(it.size) || bowserMesh()); }
    else if (it.interactKind === 'knapsack') {
      inner.visible = false;
      const r = rucksack(it.ownerRole === 'sapper' ? 0x5a6340 : 0x6a6a48);
      r.rotation.y = it.ownerRole === 'sapper' ? 0.5 : -0.9;
      o.add(r);
    }
  }
}

// ---------------------------------------------------------------- the burning bowser wreck in the bore
/**
 * The bowser burnt out in the bore (o3 the loud way): the library's burnt fuel_bowser (its modelled wreck, preloaded and
 * drawn by the load's warm-up frame) where the bowser stood and as it was turned; the flames are the blast's own
 * residual fire (world/fires.js). Only in the bore, whose cells the script blocks (_stampWreck): blown anywhere else the
 * bowser goes up and leaves nothing a man could walk through. Without the library: the kit's charred hulk.
 */
function buildWreck(root, world) {
  const size = world.interactables?.find?.((it) => it.tag === 'bowser')?.size || [4, 2];
  let g = bowserModel(size, true);
  if (!g) {
    const G = new Geo('e07:wreck');
    const F = localFrame(0, 0, 0);
    segBox(G, 'iron', F, -1.8, 1.7, -0.8, 0.8, 0.2, 0.55, 0.45);
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2, r = 0.62 + 0.08 * Math.sin(k * 2.3);
      G.quad('iron', [-1.5, 1.0 + Math.sin(a0) * r, Math.cos(a0) * r], [-1.5, 1.0 + Math.sin(a1) * r, Math.cos(a1) * r], [1.3, 0.9 + Math.sin(a1) * r * 0.8, Math.cos(a1) * r], [1.3, 0.9 + Math.sin(a0) * r * 0.8, Math.cos(a0) * r], 0.35 + 0.15 * (k % 2));
    }
    const hulk = softSnow(G.build('e07:wreck', { ground: 0, damp: 0, moss: 0 }));
    hulk.rotation.y = -Math.PI / 2;
    g = new THREE.Group();
    g.add(hulk);
  }
  const w = new THREE.Group();
  w.name = 'e07:wreck';
  w.add(g);
  w.visible = false;
  w.userData.warmShow = true;
  root.add(w);
  const show = (at) => {
    const o = world.byId?.('bowser')?.object3d;
    w.position.set(at?.x ?? 58, o?.position.y ?? 0, at?.z ?? 77);
    w.rotation.y = o ? o.rotation.y : 0;
    w.visible = true; delete w.userData.warmShow;
  };
  world.listen('e07:pass-closed', (p) => { if (p.how === 'bowser') show(world.setpieces?.get?.('e07')?.wreckAt); });
  const sp = world.setpieces?.get?.('e07');
  if (sp?.closed === 'bowser') show(sp.wreckAt);
}

/**
 * Snow bodies drawn in the map's ground snow: the plateau, the gallery's bank and the cornice's lip (one snow with the
 * snowfield they rise out of, not plaster-smooth white), the plateau's wind cornice along the rim, the snow on the
 * face's ledges and drifted up its foot, the drift banked at the south portal's foot, the snow blown onto the tarn and
 * drifted round its shore, the tongue over the parachute's windward edge — and every building's wall-foot drift (the
 * kit's `e07Drift` finish, by name below).
 */
const GROUND_SNOW = ['e07:plateau_snow', 'e07:bank:e07Snow', 'e07:cornice_lip:e07Snow', 'e07:rim_cornice:e07Snow',
  'e07:portal_drift:e07Snow', 'e07:tarn_snow:e07Snow', 'e07:container:e07Snow'];
/**
 * Ground snow that stands up off the ground — the face's ledge pillows, the drift and the sluff fans at its foot with
 * their aprons, the snow plastered on the rock's toe, the chunks — drawn with the ground's material over the snow's own
 * surface coordinates (e07-snow: the kit lays them; equal to world x/z where it lies flat, so it meets the snowfield
 * with no seam), so its texture stands on a pillow's front and a fan's steep face instead of smearing down them.
 */
const GROUND_SNOW_UNFOLD = ['e07:face_snow:e07Snow', 'e07:face_snow_s:e07Snow', 'e07:face_foot:e07Snow', 'e07:face_foot_s:e07Snow',
  'e07:face_foot:e07SnowChunk', 'e07:face_foot_s:e07SnowChunk'];
/** Ground snow that overhangs ground with another paint (the lip over the gallery's road): its splat and trail lookups
 *  are read 4 m east, on the bank's crest it is blown from. (The rim cornice reads its own place, as the plateau's snow
 *  it rises out of does: read 4 m east its back met that snow with another tone and texture, a seam; the paint under
 *  its overhang, a metre clear of the walkable foot, is the same snow.) */
const GROUND_SNOW_EAST = ['e07:cornice_lip:e07Snow'];
/**
 * The ground material builds its tangent frame on world x (art/terrain/terrain-glsl.js: x less the normal's own x part):
 * a normal of exactly ±x — a sheer face looking due east or west, as a drift pressed upright against the ridge's foot —
 * leaves it nothing and draws black. Those few normals are tipped 0.12 up (always up: two neighbours tipped opposite
 * ways would pass through the same nothing between them).
 */
function groundSafeNormals(geo) {
  const N = geo?.attributes?.normal;
  if (!N || geo.userData?.groundSafe) return;
  for (let i = 0; i < N.count; i++) {
    const x = N.getX(i), y = N.getY(i), z = N.getZ(i);
    if (y * y + z * z < 0.0144) { const l = Math.hypot(x, 0.12, z); N.setXYZ(i, x / l, 0.12 / l, z / l); }
  }
  N.needsUpdate = true;
  geo.userData.groundSafe = true;
}

/**
 * Those bodies drawn with the map's own ground material (art/terrain/terrain.js terrainMaterial: master's snow —
 * sastrugi, cavities, glints, the trails and prints the walkers leave), not a tiled dressing snow: no seam in look
 * between the snowfield and the ridge top, the bank or the drifts, the same snow everywhere. The material is the
 * terrain mesh's (one program, warmed with it); it is position-driven (its splat, noise and trails by world x/z, the
 * shading by each mesh's own normals), so their world-space meshes take it as they are. Before the terrain is up (or
 * without it: tests) the dressing snow stays.
 */
/** The unfolded ground materials (e07-snow) of the terrain whose uniforms they share: the snow's, the chunks'. */
const UNFOLDED = { U: null, snow: null, chunk: null };
function groundMaterialOnRidge(world, root) {
  const apply = () => {
    const m = world.terrain?.terrain?.mesh?.material;
    if (!m || Array.isArray(m)) return false;
    for (const name of GROUND_SNOW) { const o = root.getObjectByName(name); if (o) { o.material = m; groundSafeNormals(o.geometry); } }
    const U0 = world.terrain?.terrain?.uniforms;
    if (U0) {
      if (UNFOLDED.U !== U0) Object.assign(UNFOLDED, { U: U0, snow: unfoldedGroundMaterial(U0, CASTLE_SETS.e07Snow[3]), chunk: unfoldedGroundMaterial(U0, CASTLE_SETS.e07Snow[3], 0.4) });
      // (only on a mesh that carries the kit's light terms: the variant reads them — snowMeshesG lays them on all of these)
      for (const name of GROUND_SNOW_UNFOLD) {
        const o = root.getObjectByName(name);
        if (o?.geometry?.attributes?.aE07) o.material = name.endsWith('Chunk') ? UNFOLDED.chunk : UNFOLDED.snow;
        else if (o) o.material = m;
      }
    }
    root.traverse((o) => { if (o.isMesh && o.name.endsWith(':e07Drift')) { o.material = m; groundSafeNormals(o.geometry); } });
    // (the cornice's lip hangs out over the gallery's roof and the road's verge below it: its splat and trail lookups
    // are read 4 m east, on the bank's own crest — the same program, only its origin uniform moved, so no road slush or
    // ruts show up on it; the relief noise stays world-anchored)
    const U = world.terrain?.terrain?.uniforms;
    if (U?.uOrigin?.value?.isVector2) {
      const east = terrainMaterial({ ...U, uOrigin: { value: U.uOrigin.value.clone().add(new THREE.Vector2(-4, 0)) } });
      for (const name of GROUND_SNOW_EAST) { const o = root.getObjectByName(name); if (o) o.material = east; }
    }
    const top = root.getObjectByName('e07:ridge_top');
    if (top && Array.isArray(top.material)) top.material = [m, top.material[1]];
    return true;
  };
  if (!apply()) world.terrain?.ready?.then?.(() => apply(), () => {});
}

// ---------------------------------------------------------------- build
/** Ridge props lifted onto the plateau (their structure meshes stand at y 0 in the def). */
const LIFT = ['ridge_station', 'op_dugout', 'op_light', 'op_ammo'];
/** Placeholders this art replaces (their nav stays the def's). */
const HIDE = ['ridge_face', 'ridge_top', 'cornice_bank', 'gallery_wall', 'hotel', 'terrace', 'terrace_rail', 'terrace_rail_s', 'vering_desk', 'radio_table', 'container', 'press', 'cross', 'ski_rack', 'op_flak',
  'farm1', 'farm2', 'farm3', 'farm4', 'chapel', 'barn', 'kennel'];

/**
 * The e07 art as a sliced job (engine/slice.js): the same pieces in the same order as a straight build, pausing between
 * them (and inside the ridge, the gallery and the hamlet) whenever a slice's budget is used, so the loading screen
 * keeps drawing (`script.visuals` runs it with runSliced; buildE07Art runs it straight through). Idempotent per world;
 * browser only: nothing without a scene / meshes.
 */
export function* buildE07ArtG(world) {
  if (!world?.scene || world._spMeshes === false || world._e07Art) return;
  world._e07Art = true;
  const root = new THREE.Group();
  root.name = 'e07:art';
  yield* buildRidgeG(root, world);
  if (due()) yield;
  buildTunnel(root);
  if (due()) yield;
  yield* buildGalleryG(root, world);
  if (due()) yield;
  yield* buildHotelG(root);
  if (due()) yield;
  buildTerrace(root);
  if (due()) yield;
  const plates = buildPress(root);
  if (due()) yield;
  buildContainer(root, world);
  if (due()) yield;
  buildSmall(root);
  if (due()) yield;
  yield* buildTarnG(root, world);
  if (due()) yield;
  yield* buildHamletG(root, world);
  if (due()) yield;
  buildWreck(root, world);
  if (due()) yield;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
  world.scene.add(root);
  for (const id of HIDE) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const id of LIFT) {
    const o = world.structures?.get(id)?.object3d;
    if (o && !o.userData.e07Lifted) {
      o.userData.e07Lifted = true; o.position.y += RIDGE_Y;
    }
  }
  dressInteractables(world);
  trimOpBerm(world);
  fixSnowInstances(world);
  groundMaterialOnRidge(world, root);
  // the plates go with whoever takes them (the `evidence` set-piece 'plates': missions/setpieces-bcd.js)
  const hidePlates = () => { plates.visible = false; };
  world.listen('bcd:evidence', (p) => { if (p?.id === 'plates' && (p.taken || p.burned)) hidePlates(); });
  if (world.setpieces?.get?.('plates')?.taken) hidePlates();
}

/** Build the e07 art into world.scene at once (idempotent; browser only: nothing without a scene / meshes). */
export function buildE07Art(world) {
  return runSync(buildE07ArtG(world));
}
