/**
 * M20 "Operation Valhalla": the wartime occupation layer — castle pass, user 2026-11-10: "Just make sure th3 castle is
 * a medieval castle in the nazi era". The medieval castle is a German HQ in February 1945: sandbagged MG positions on
 * the walls, knife-rests and concertina wire at the gates, painted sentry boxes (black-white-red chevrons), a
 * searchlight on the SE gate's tower, field-telephone lines strung between the keep, the gates, the guardhouse and the
 * church tower's lookout, the radio mast with its antenna array on the keep's donjon, camouflage nets over the V2
 * trailers and the vehicle park, fuel drums, jerrycans and ammunition boxes, stencilled signs (mission furniture). No
 * insignia here: the period flags are the flag system's (art/flags.js, scripts/m20-art.js), the vehicles the library's.
 *
 * Everything here is scenery (added to the scene, never measured): it stands where nobody walks — on the walls' unwalked
 * stretches, against walls and retaining walls, over the trailers, above head height — clear of every road, lane, stair,
 * gate passage, route and the tank's way (tests/unit/m20-castle.test.mjs layout test, OCCUPATION_PROPS). The sentry
 * boxes and the parked vehicles are structures (measured; scripts/m20-art.js swaps their art in).
 * Geometry merged per material (castle-kit Geo), the wires one coverage-widened ribbon mesh (art/barbed-wire.js).
 * @module art/m20-occupation
 */
import * as THREE from 'three';
import { Geo, segBox, localFrame, CASTLE_SETS } from './castle-kit.js';
import { WireBuffer, catenary, concertinaPath, wireMaterial, wireMesh, wireRng } from './barbed-wire.js';

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;
const deg = (d) => (d * Math.PI) / 180;

// 1945 paints: dark yellow (RAL 7028, the 1943 base), field grey; the black of the sentry boxes' chevrons
Object.assign(CASTLE_SETS, {
  dunkelgelb: ['steel_painted', 0xb8a06a, 0x8f7a4c, 1.5, 0.7],
  feldgrau: ['steel_painted', 0x7a7f70, 0x585c50, 1.5, 0.7],
  tarblack: ['bitumen_felt', 0x3a3a38, 0x232322, 2.0, 0.6],
});

// ---------------------------------------------------------------- placements (world metres)
/** Sandbagged MG positions on the walls' unwalked stretches (wall walk y 7): x, z, facing (outward heading). */
export const MG_NESTS = [
  // (their rings stop at the parapet's inner face: the MG laid over it)
  { id: 'mg_cws', x: 90.66, z: 125.92, y: 7, face: deg(105.6) },  // the S curtain between e7's turn and the S corner pair
  { id: 'mg_cwe1', x: 130.66, z: 103.11, y: 7, face: deg(55.3) }, // the SE curtain, between e9 and e10
];
/** Knife-rests (Spanische Reiter) pulled aside off the gate roads, and concertina along the counterscarp. */
export const KNIFE_RESTS = [
  { id: 'kr_se1', x: 128.6, z: 120.9, rot: deg(45), len: 3.0 },
  { id: 'kr_se2', x: 131.0, z: 123.3, rot: deg(45), len: 3.0 },
  { id: 'kr_sw1', x: 62.8, z: 127.4, rot: deg(16), len: 3.0 },
];
export const CONCERTINA = [
  { id: 'cw_se_e', points: [[127.2, 118.6], [131.6, 114.2]] },
  { id: 'cw_se_w', points: [[120.6, 124.6], [116.6, 124.0]] },
  { id: 'cw_sw_e', points: [[60.4, 124.5], [64.6, 125.7]] },
];
/** The fuel and ammunition dumps against walls: drums, jerrycans, ammunition boxes. */
export const DUMPS = [
  { id: 'dump_vp', kind: 'drums', x: 105.4, z: 52.0, rot: 0, n: 6 },
  { id: 'cans_nc', kind: 'jerrycans', x: 77.0, z: 33.1, rot: 0, n: 8 },  // by the N range's S face (off its plinth), by the tank
  { id: 'ammo_nc', kind: 'ammo', x: 80.6, z: 33.2, rot: 0, n: 6 },
];
/** Camouflage nets: over the V2 trailers (draped on the rockets' rear) and the vehicle park (poles at its S edge). */
export const NETS = [
  { id: 'net_v2a', on: 'v2a', u0: -6.5, u1: 2.5, half: 2.1, y: 3.2 },
  { id: 'net_v2b', on: 'v2b', u0: -6.5, u1: 2.5, half: 2.1, y: 3.2 },
  // (over the parked vehicles' fronts from the terrace wall's top to poles in the gaps between them: their rears show)
  { id: 'net_vpw', rect: [104.3, 51.2, 111.5, 55.2], yWall: 4.0, yPole: 2.7, poles: [104.3, 106.6, 108.9, 111.5] },
  { id: 'net_vpe', rect: [114.85, 51.2, 120.25, 55.4], yWall: 4.0, yPole: 3.6, poles: [114.85, 117.8, 120.25] },
];
/** The keep's radio mast on the donjon's parapet walk (NE corner) and the donjon's flagpole on its pyramid's apex. */
export const KEEP_MAST = { x: 18.6, z: 38.9, y: 33.0, h: 10.5 };
export const KEEP_FLAG = { x: 12.0, z: 45.5, y: 43.3, h: 5.5 };
/** The SE gatehouse's searchlight (its E tower top) facing out over the moat. */
export const GATE_LIGHT = { x: 119.6, z: 110.4, y: 7.0, rot: deg(-15) };
/**
 * Field-telephone lines (one or two cables each), anchor to anchor [x, y, z]: the guardhouse's E gable, the inner gate,
 * the SE gatehouse, the church tower's lookout, the SW gatehouse, the keep (over a pole on the NW terrace).
 */
export const PHONE = {
  guard: [81.2, 5.6, 94.0], inner: [77.4, 7.4, 70.1], gse: [115.4, 8.6, 108.9], church: [110.9, 14.6, 48.75],
  gsw: [61.9, 8.6, 111.2], keep: [26.6, 19.8, 56.8], nwPole: [52.6, 14.6, 64.8], vp: [111.6, 4.6, 51.1],
};
// (the church tower's lookout on the NE terrace takes its line down to the vehicle park's, on to the inner gate)
export const PHONE_LINES = [['guard', 'inner'], ['guard', 'gse'], ['vp', 'church'], ['guard', 'gsw'], ['inner', 'nwPole'], ['nwPole', 'keep'], ['inner', 'vp']];

/**
 * Footprints of the occupation layer's ground props for the layout audit: [{id, kind, poly}] (world metres). Wall-top
 * and roof props (MG nests, the mast, the searchlight) stand on masonry nobody walks: they are not ground props.
 */
export function occupationFootprints(m) {
  const out = [];
  const rect = (x, z, w, d, rot = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]); };
  for (const k of KNIFE_RESTS) out.push({ id: k.id, kind: 'knife_rest', poly: rect(k.x, k.z, k.len, 1.3, k.rot) });
  for (const c of CONCERTINA) {
    const [a, b] = c.points, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push({ id: c.id, kind: 'concertina', poly: rect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L, 0.9, Math.atan2(b[1] - a[1], b[0] - a[0])) });
  }
  for (const d of DUMPS) out.push({ id: d.id, kind: d.kind, poly: rect(d.x, d.z, dumpSize(d)[0], dumpSize(d)[1], d.rot) });
  for (const n of NETS.filter((q) => q.rect)) for (const [k, [px, pz]] of netPoles(n).entries()) out.push({ id: `${n.id}_pole${k}`, kind: 'net_pole', poly: rect(px, pz, 0.3, 0.3) });
  void m;
  return out;
}
const dumpSize = (d) => (d.kind === 'drums' ? [Math.ceil(d.n / 2) * 0.66, 1.3] : d.kind === 'jerrycans' ? [Math.ceil(d.n / 2) * 0.36, 0.7] : [Math.ceil(d.n / 3) * 0.75, 0.9]);
/** The vehicle park net's poles along its S edge (the N edge hangs from the terrace wall's top). */
function netPoles(n) {
  const [x0, , x1, z1] = n.rect;
  if (n.poles) return n.poles.map((x) => [x, z1]);
  const out = [], k1 = Math.max(1, Math.round((x1 - x0) / 3.6));
  for (let k = 0; k <= k1; k++) out.push([x0 + ((x1 - x0) * k) / k1, z1]);
  return out;
}

// ---------------------------------------------------------------- materials
let STRIPE_MAT = null, NET_MAT = null;
/** The sentry box's paint: black, white and red chevrons (the Reich's colours on guard boxes), weathered (canvas). */
function stripeMaterial() {
  if (STRIPE_MAT) return STRIPE_MAT;
  let map = null;
  if (HAS_DOM) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const cols = ['#1c1c1a', '#e8e4d8', '#b3221b', '#e8e4d8'];
    for (let k = -8; k < 16; k++) { g.fillStyle = cols[((k % 4) + 4) % 4]; g.beginPath(); g.moveTo(k * 16, 0); g.lineTo(k * 16 + 16, 0); g.lineTo(k * 16 + 16 + 128, 128); g.lineTo(k * 16 + 128, 128); g.closePath(); g.fill(); }
    const img = g.getImageData(0, 0, 128, 128), p = img.data;
    for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - 0.5) * 22 + (((i / 4) % 128) % 7 === 0 ? -10 : 0); p[i] += n; p[i + 1] += n; p[i + 2] += n; }
    g.putImageData(img, 0, 0);
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  }
  STRIPE_MAT = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x8a3a30, map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  STRIPE_MAT.name = 'm20:sentrybox';
  return STRIPE_MAT;
}
/** Camouflage net: a knotted mesh garnished with strips of field-grey, olive and brown hessian (alpha-tested canvas). */
function netMaterial() {
  if (NET_MAT) return NET_MAT;
  let map = null;
  if (HAS_DOM) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(52,50,40,0.95)'; g.lineWidth = 1.6;
    for (let k = -256; k < 512; k += 20) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 256, 256); g.stroke(); g.beginPath(); g.moveTo(k + 256, 0); g.lineTo(k, 256); g.stroke(); }
    const R = wireRng(1945), cols = ['#5d5f45', '#6b5a3c', '#4a5038', '#7a7552', '#585a4a', '#3f4231'];
    for (let i = 0; i < 230; i++) {
      g.save(); g.translate(R() * 256, R() * 256); g.rotate(R() * TAU);
      g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(-9 - R() * 8, -3, 18 + R() * 16, 5 + R() * 4); g.restore();
    }
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  }
  NET_MAT = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x5d5f45, map, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35, transparent: false });
  NET_MAT.name = 'm20:camonet';
  return NET_MAT;
}

// ---------------------------------------------------------------- pieces
/** An MG 34 on its bipod (or tripod) at (x, y, z) facing `face`: receiver, barrel jacket, butt, drum magazine. */
function mg34(G, x, y, z, face, tripod = false) {
  const F = localFrame(x, z, face);
  segBox(G, 'iron', F, -0.55, 0.2, -0.05, 0.05, y + 0.05, y + 0.17, 0.25);              // receiver and butt
  segBox(G, 'iron', F, 0.2, 0.95, -0.03, 0.03, y + 0.08, y + 0.14, 0.2);                 // barrel jacket
  segBox(G, 'iron', F, -0.1, 0.05, 0.05, 0.16, y - 0.02, y + 0.12, 0.3);                 // drum magazine
  for (const s of [-1, 1]) { const [a, b] = F.at(0.75, s * 0.18); G.box('iron', a, y - (tripod ? 0.25 : 0.1), b, 0.03, tripod ? 0.5 : 0.25, 0.03, face, 0.25); }
}
/** A sandbag ring (U open behind) with the MG on its parapet, facing `face`, its floor at y. */
function mgNest(G, n) {
  const F = localFrame(n.x, n.z, n.face), R = G.R;
  for (let ring = 0; ring < 3; ring++) {
    for (let k = -4; k <= 4; k++) {
      const a = (k / 4) * deg(100), rr = 1.05, [x, z] = F.at(Math.cos(a) * rr, Math.sin(a) * rr);
      G.box('burlap', x, n.y + 0.13 + ring * 0.24, z, 0.55, 0.24, 0.34, n.face + a + Math.PI / 2 + (R() - 0.5) * 0.2, 0.85 + R() * 0.12);
    }
  }
  const [mx, mz] = F.at(0.8, 0);
  mg34(G, mx, n.y + 0.78, mz, n.face);
  // two ammunition boxes behind the gun
  for (const s of [-1, 1]) { const [x, z] = F.at(-0.2, s * 0.6); G.box('feldgrau', x, n.y + 0.13, z, 0.36, 0.26, 0.22, n.face, 0.8); }
}
/** A knife-rest (Spanischer Reiter): two timber X-frames joined by a long rail, barbed wire wound on (wires). */
function knifeRest(G, W, k) {
  const F = localFrame(k.x, k.z, k.rot), L = k.len, h = 1.15, e = 0.62;
  for (const u of [-L / 2 + 0.15, L / 2 - 0.15]) for (const s of [-1, 1]) {
    const [ax, az] = F.at(u, -s * e), [bx, bz] = F.at(u, s * e);
    const A = [ax, 0.02, az], B = [bx, h, bz];
    timber(G, A, B, 0.09);
  }
  const [r0x, r0z] = F.at(-L / 2, 0), [r1x, r1z] = F.at(L / 2, 0);
  timber(G, [r0x, h * 0.5, r0z], [r1x, h * 0.5, r1z], 0.1);
  // the wire: strands from frame to frame along the X arms and a loose spiral round it
  const R = wireRng(k.id.length * 7 + 3);
  for (const s of [-1, 1]) for (const t of [0.25, 0.55, 0.85]) {
    const [p0x, p0z] = F.at(-L / 2 + 0.15, s * e * (1 - t) * 0.9), [p1x, p1z] = F.at(L / 2 - 0.15, s * e * (1 - t) * 0.9);
    const path = catenary([p0x, h * t, p0z], [p1x, h * t, p1z], 0.04 + R() * 0.03, 0.2);
    W.strand(path, { r: 0.0022, rust: 0.4 }); W.barbs(path, { rust: 0.5 });
  }
}
/** A straight timber from A to B (a square section box along the segment). */
function timber(G, A, B, t = 0.1) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d);
  const yaw = Math.atan2(d[2], d[0]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  const c = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const ax = [cp * cyw, sp, cp * syw], side = [-syw, 0, cyw], up = [ax[1] * side[2] - ax[2] * side[1], ax[2] * side[0] - ax[0] * side[2], ax[0] * side[1] - ax[1] * side[0]];
  const P = (a, s2, u) => [c[0] + ax[0] * a + side[0] * s2 + up[0] * u, c[1] + ax[1] * a + side[1] * s2 + up[1] * u, c[2] + ax[2] * a + side[2] * s2 + up[2] * u];
  const h = t / 2, l = L / 2;
  const r0 = [P(-l, -h, -h), P(-l, h, -h), P(-l, h, h), P(-l, -h, h)], r1 = [P(l, -h, -h), P(l, h, -h), P(l, h, h), P(l, -h, h)];
  const q = (a, b, cc, dd) => { G.tri('timber', a, b, cc, 0.7); G.tri('timber', a, cc, dd, 0.7); };
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q(r0[i], r1[i], r1[j], r0[j]); q(r0[j], r1[j], r1[i], r0[i]); }
}
/** Fuel drums (200 l, dark yellow and field grey) standing in two rows; one lying on its side. */
function drums(G, d) {
  const F = localFrame(d.x, d.z, d.rot), n = d.n, R = G.R;
  for (let k = 0; k < n; k++) {
    const u = -((Math.ceil(n / 2) - 1) * 0.66) / 2 + Math.floor(k / 2) * 0.66, w = (k % 2 ? 0.33 : -0.33);
    const [x, z] = F.at(u, w), mat = k % 3 === 2 ? 'feldgrau' : 'dunkelgelb';
    G.cyl(mat, x, 0, z, 0.29, 0.29, 0.88, 14, 0.8 + R() * 0.15);
    for (const y of [0.29, 0.59]) G.cyl(mat, x, y - 0.02, z, 0.305, 0.305, 0.04, 14, 0.7, { caps: false });
    G.cyl('iron', x + 0.12, 0.88, z + 0.05, 0.05, 0.05, 0.03, 8, 0.4);
  }
}
/** Jerrycans (Wehrmachtskanister) in a stack against the wall: field grey, the pressed X, the triple handle. */
function jerrycans(G, d) {
  const F = localFrame(d.x, d.z, d.rot), n = d.n;
  for (let k = 0; k < n; k++) {
    const u = -((Math.ceil(n / 2) - 1) * 0.36) / 2 + Math.floor(k / 2) * 0.36, row = k % 2;
    const [x, z] = F.at(u, -0.12 + row * 0.0), y = row * 0.47;
    G.box(k % 4 === 3 ? 'dunkelgelb' : 'feldgrau', x, y + 0.235, z, 0.165, 0.47, 0.345, d.rot + Math.PI / 2, 0.8);
    G.box('iron', x, y + 0.5, z, 0.09, 0.04, 0.16, d.rot + Math.PI / 2, 0.5);
    for (const s of [-1, 1]) G.box('feldgrau', x + Math.cos(d.rot) * 0.0, y + 0.235, z, 0.17, 0.05, 0.38, d.rot + Math.PI / 2 + s * 0.94, 0.95);
  }
}
/** Ammunition boxes (wooden, stencilled rope handles) stacked three high. */
function ammoBoxes(G, d) {
  const F = localFrame(d.x, d.z, d.rot), n = d.n, R = G.R;
  for (let k = 0; k < n; k++) {
    const u = -((Math.ceil(n / 3) - 1) * 0.75) / 2 + Math.floor(k / 3) * 0.75, layer = k % 3;
    const [x, z] = F.at(u + (R() - 0.5) * 0.05, 0);
    G.box(layer === 2 ? 'feldgrau' : 'planks', x, 0.15 + layer * 0.3, z, 0.7, 0.28, 0.42, d.rot + (R() - 0.5) * 0.06, 0.75 + R() * 0.15);
    G.box('iron', x, 0.29 + layer * 0.3, z, 0.72, 0.02, 0.06, d.rot, 0.4);
  }
}
/** A camouflage net (one merged mesh) over a sagging grid: rows of points (y per point), quads between them. */
function netGrid(pos, uv, idx, rows) {
  const base = pos.length / 3, nr = rows.length, nc = rows[0].length;
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) { const p = rows[j][i]; pos.push(p[0], p[1], p[2]); uv.push(p[3], p[4]); }
  for (let j = 0; j + 1 < nr; j++) for (let i = 0; i + 1 < nc; i++) { const a = base + j * nc + i, b = a + nc; idx.push(a, b, a + 1, a + 1, b, b + 1); }
}

/** The keep's radio mast: a tubular steel mast in three sections, a star of dipoles and a cross-arm at its head, guys. */
function radioMast(G, W, o) {
  const { x, z, y, h } = o;
  G.cyl('paint', x, y, z, 0.11, 0.08, h * 0.5, 10, 0.75);
  G.cyl('paint', x, y + h * 0.5, z, 0.08, 0.06, h * 0.35, 10, 0.75);
  G.cyl('paint', x, y + h * 0.85, z, 0.05, 0.03, h * 0.15, 8, 0.75);
  G.box('paint', x, y + 0.25, z, 0.6, 0.5, 0.6, 0, 0.6); // the base plate and its ballast
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU, L = 1.4;
    G.box('iron', x + Math.cos(a) * L / 2, y + h - 0.3, z + Math.sin(a) * L / 2, L, 0.03, 0.03, a, 0.35);
  }
  G.box('iron', x, y + h * 0.8, z, 2.6, 0.05, 0.05, deg(30), 0.35);
  for (const s of [-1, 1]) { const [ex, ez] = [x + Math.cos(deg(30)) * 1.3 * s, z + Math.sin(deg(30)) * 1.3 * s]; G.box('iron', ex, y + h * 0.8 - 0.5, ez, 0.03, 1.0, 0.03, 0, 0.35); }
  // the guys: three at two levels down to the parapet
  for (let k = 0; k < 3; k++) for (const f of [0.55, 0.9]) {
    const a = deg(-30) + (k / 3) * TAU, r = 3.4;
    W.strand(catenary([x, y + h * f, z], [x + Math.cos(a) * r, y + 0.9, z + Math.sin(a) * r], 0.05, 0.3), { r: 0.004, rust: 0.2 });
  }
  // the feeder down the mast and over the parapet to the hall's roof
  W.strand(catenary([x + 0.1, y + h - 0.4, z], [x + 0.6, y + 0.4, z + 1.2], 0.2, 0.3), { r: 0.006, rust: 0 });
}

/**
 * The occupation layer's scenery. o: {ground(x, z) → y, structure(id) → mission structure}. Returns a Group: the Geo
 * meshes (one per material), the camouflage nets (one mesh), the wires (one ribbon mesh and its barbs).
 */
export function buildOccupation(m, o = {}) {
  const G = new Geo('m20:occupation'), W = new WireBuffer(o.ground || (() => 0));
  const S = (id) => (m.structures || []).find((s) => s.id === id);
  for (const n of MG_NESTS) mgNest(G, n);
  // the bailey's MG position: an MG 34 on its bipod on the sandbag wall by the gate warden's lodge, laid on the SE gate
  const sb = S('sandbag_se');
  if (sb) mg34(G, sb.x, (sb.h ?? 1) + 0.1, sb.z, Math.atan2(114 - sb.z, 116 - sb.x));
  for (const k of KNIFE_RESTS) knifeRest(G, W, k);
  const R = wireRng(20);
  for (const c of CONCERTINA) {
    const path = concertinaPath(c.points[0], c.points[1], { diameter: 0.8, pitch: 0.3, segments: 14 }, R, o.ground || (() => 0));
    W.strand(path, { r: 0.0022, rust: 0.45 }); W.barbs(path, { rust: 0.5 });
    // its pickets
    for (const t of [0, 0.5, 1]) { const [a, b] = c.points; G.box('iron', a[0] + (b[0] - a[0]) * t, 0.5, a[1] + (b[1] - a[1]) * t, 0.04, 1.0, 0.04, 0, 0.35); }
  }
  for (const d of DUMPS) (d.kind === 'drums' ? drums : d.kind === 'jerrycans' ? jerrycans : ammoBoxes)(G, d);
  radioMast(G, W, KEEP_MAST);
  // the searchlight on the SE gatehouse's E tower
  {
    const { x, z, y, rot } = GATE_LIGHT, F = localFrame(x, z, rot);
    G.cyl('paint', x, y, z, 0.42, 0.32, 0.2, 12, 0.75);
    G.cyl('paint', x, y + 0.2, z, 0.12, 0.12, 0.65, 8, 0.8);
    for (const s of [-1, 1]) segBox(G, 'paint', F, -0.08, 0.08, s * 0.42 - 0.04, s * 0.42 + 0.04, y + 0.8, y + 1.35, 0.8);
    const [cx, cz] = F.at(0, 0);
    G.cyl('paint', cx, y + 0.95, cz, 0.38, 0.38, 0.6, 14, 0.85);
    G.cyl('dressed', cx + F.t[0] * 0.02, y + 1.0, cz + F.t[1] * 0.02, 0.33, 0.33, 0.5, 14, 1.6);
  }
  // field-telephone lines: two sagging cables per run, on insulator brackets at each anchor
  for (const [a, b] of PHONE_LINES) {
    const A = PHONE[a], B = PHONE[b], L = Math.hypot(B[0] - A[0], B[2] - A[2]);
    for (const off of [-0.12, 0.12]) {
      const dx = (B[0] - A[0]) / L, dz = (B[2] - A[2]) / L, nx = -dz * off, nz = dx * off;
      W.strand(catenary([A[0] + nx, A[1], A[2] + nz], [B[0] + nx, B[1], B[2] + nz], Math.min(1.4, 0.02 * L + 0.2), 0.4), { r: 0.0035, rust: 0, sway: 0.25 });
    }
  }
  for (const [k, p] of Object.entries(PHONE)) {
    if (k === 'nwPole') { G.cyl('timber', p[0], p[1] - 7.6, p[2], 0.12, 0.1, 7.9, 8, 0.7); G.box('timber', p[0], p[1] + 0.1, p[2], 0.08, 0.08, 0.7, 0, 0.7); }
    for (const off of [-0.12, 0.12]) G.cyl('dressed', p[0], p[1] - 0.14, p[2] + off, 0.04, 0.03, 0.14, 6, 1.3); // porcelain insulators
  }
  // camouflage nets: over the rear of each V2 (draped on the rocket, its edges down the trailer's sides) and the park
  const pos = [], uv = [], idx = [];
  for (const n of NETS) {
    if (n.on) {
      const s = S(n.on); if (!s) continue;
      const F = localFrame(s.x, s.z, s.rot ?? 0), rows = [], nu = 12, nw = 8;
      for (let j = 0; j <= nw; j++) {
        const row = [], w = -n.half + (2 * n.half * j) / nw, aw = Math.abs(w) / n.half;
        for (let i = 0; i <= nu; i++) {
          const u = n.u0 + ((n.u1 - n.u0) * i) / nu, [x, z] = F.at(u, w);
          const y = n.y - Math.max(0, aw - 0.25) * 2.0 - Math.sin((i / nu) * Math.PI * 3 + j) * 0.05;
          row.push([x, Math.max(0.15, y), z, u / 3, w / 3]);
        }
        rows.push(row);
      }
      netGrid(pos, uv, idx, rows);
    } else {
      const [x0, z0, x1, z1] = n.rect, rows = [], nu = 16, nv = 8;
      for (const [px, pz] of netPoles(n)) { G.cyl('timber', px, 0, pz, 0.07, 0.06, n.yPole + 0.1, 6, 0.7); }
      for (let j = 0; j <= nv; j++) {
        const row = [], v = j / nv, z = z0 + (z1 - z0) * v;
        for (let i = 0; i <= nu; i++) {
          const t = i / nu, x = x0 + (x1 - x0) * t, sag = Math.abs(Math.sin(t * Math.PI * 3)) * 0.35 * Math.min(1, v * 2);
          row.push([x, n.yWall + (n.yPole - n.yWall) * v - sag, z, x / 3, z / 3]);
        }
        rows.push(row);
      }
      netGrid(pos, uv, idx, rows);
    }
  }
  const out = G.build('m20art:occupation', { ground: 0 });
  out.name = 'm20art:occupation';
  if (idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const net = new THREE.Mesh(geo, netMaterial()); net.name = 'm20art:camonets'; net.castShadow = true; net.receiveShadow = true;
    out.add(net);
  }
  if (W.vertexCount) {
    out.add(wireMesh(W.geometry(), wireMaterial('temperate'), 'm20art:wires'));
    for (const ig of W.instGeometries(false)) out.add(wireMesh(ig, wireMaterial('temperate', { inst: true }), 'm20art:barbs'));
  }
  return out;
}

/**
 * A painted sentry box (Schilderhaus): plank walls in black-white-red chevrons, an open front facing −u... +w, a
 * pyramid roof in tar felt, a step. o: {x, z, rot (its front faces rot + 90°), seed}. Swapped into its structure
 * (measured): 1.2 × 1.2 m, 2.6 m tall.
 */
export function buildSentryBox(o) {
  const G = new Geo(o.seed ?? 'sentrybox'), F = localFrame(o.x, o.z, o.rot ?? 0);
  const a = 0.6, h = 2.25;
  // three walls (back −w, sides ±u), the front (+w) open
  segBox(G, 'planks', F, -a, a, -a, -a + 0.06, 0.12, h, 0.8);
  for (const s of [-1, 1]) segBox(G, 'planks', F, s > 0 ? a - 0.06 : -a, s > 0 ? a : -a + 0.06, -a, a, 0.12, h, 0.8);
  segBox(G, 'planks', F, -a - 0.05, a + 0.05, -a - 0.05, a + 0.05, 0, 0.12, 0.7);                // the floor step
  for (const [u0, u1] of [[-a, -a + 0.18], [a - 0.18, a]]) segBox(G, 'planks', F, u0, u1, a - 0.06, a, 0.12, h, 0.8); // front posts
  // the pyramid roof
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const r = a + 0.18, top = P(0, 0, h + 0.55), c = [P(-r, -r, h), P(r, -r, h), P(r, r, h), P(-r, r, h)];
  for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; G.tri('tarblack', p, top, q, 0.85); G.tri('tarblack', q, top, p, 0.85); }
  const g = G.build('m20:sentrybox', { ground: 0 });
  // the painted chevrons: thin panels on the three walls' outer faces
  const pos = [], uv = [], idx = [];
  const panel = (A, B, C, D) => { const b = pos.length / 3; for (const [p, t] of [[A, [0, 0]], [B, [1, 0]], [C, [1, 1.9]], [D, [0, 1.9]]]) { pos.push(...p); uv.push(...t); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  const e = 0.012;
  panel(P(a, -a - e, 0.15), P(-a, -a - e, 0.15), P(-a, -a - e, h - 0.05), P(a, -a - e, h - 0.05));
  panel(P(a + e, a, 0.15), P(a + e, -a, 0.15), P(a + e, -a, h - 0.05), P(a + e, a, h - 0.05));
  panel(P(-a - e, -a, 0.15), P(-a - e, a, 0.15), P(-a - e, a, h - 0.05), P(-a - e, -a, h - 0.05));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const paint = new THREE.Mesh(geo, stripeMaterial()); paint.name = 'm20:sentrybox:paint'; paint.castShadow = true;
  g.add(paint);
  g.name = 'm20:sentrybox';
  return g;
}
