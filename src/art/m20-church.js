/**
 * M20 "Operation Valhalla": the castle church (Burgkirche) — castle pass, user 2026-11-10: "If the castle can have a
 * church too". A late-Romanesque / early-Gothic church of the Breisgau on its own plot (the mission's CHURCH: the NE
 * terrace, its axis N-S on the narrow terrace, the liturgical W end — tower and portal — to the S): the W tower
 * (corner pilaster strips, round-arch friezes, paired round-arched belfry openings, a clock, an octagonal broach spire in
 * slate with its ball and cross), the W portal with its steps, the nave (buttresses, pointed lancets with leaded glass),
 * the lower choir and the semicircular apse under a half-cone. In February 1945 the garrison uses it: ammunition
 * crates stacked by the portal, a lookout post in the belfry (sandbags, the MG's barrel; its field-telephone line is the
 * occupation layer's, scripts/m20-art.js), the period flag hung from the tower (the flag system's banner).
 *
 * Frame: u along the axis from the tower's outer (W) face (u = 0) to the apse (liturgical E), w across. The
 * structure `church` (m20_operation_valhalla.js CHURCH) is the bounding box; this art is swapped into it and measured
 * (its walls, buttresses, steps are the nav). Geometry merged per material (castle-kit Geo), the leaded lights one mesh.
 * @module art/m20-church
 */
import * as THREE from 'three';
import { Geo, segBox, localFrame, archY } from './castle-kit.js';
import { fan, fP, fN, portal, saddle, beam } from './m20-castle.js';

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;

/** The church's plan in its own frame (metres): lengths along u, half-widths across, heights. */
export const CHURCH_PLAN = {
  tower: [0, 5.4], towerH: 2.7, nave: [5.4, 15.9], naveH: 3.6, choir: [15.9, 18.5], choirH: 2.8, apseR: 2.6,
  towerTop: 17.5, spireTop: 30.5, naveEave: 8.0, naveRidge: 13.2, choirEave: 7.0, choirRidge: 11.2, apseEave: 6.4,
  buttressU: [7.2, 9.9, 12.6, 15.3], buttressOut: 0.6, steps: 1.2,
};

/** The church's plan for a structure: the defaults with its own `church` overrides (m20_operation_valhalla.js CHURCH). */
export const planOf = (s) => ({ ...CHURCH_PLAN, ...(s?.church || s?.plan || {}) });

/** The church frame from its structure (bounding-box centre x, z; rot; w the length): origin at the tower's W face. */
export function churchFrame(s) {
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0), h = (s.w ?? 21.1) / 2;
  return localFrame(s.x - c * h, s.z - n * h, s.rot ?? 0);
}

/**
 * The church's ground footprint as world polygons (the layout audit's body): tower, nave with its buttresses, choir,
 * apse, the portal's steps. [{id, poly}]
 */
export function churchFootprint(s) {
  const F = churchFrame(s), P = planOf(s);
  const rect = (u0, u1, w0, w1) => [[u0, w0], [u1, w0], [u1, w1], [u0, w1]].map(([u, w]) => F.at(u, w));
  const apse = [];
  for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 12; apse.push(F.at(P.choir[1] + Math.cos(a) * P.apseR, Math.sin(a) * P.apseR)); }
  apse.push(F.at(P.choir[1], P.apseR));
  apse.unshift(F.at(P.choir[1], -P.apseR));
  return [
    { id: 'tower', poly: rect(P.tower[0], P.tower[1], -P.towerH, P.towerH) },
    { id: 'nave', poly: rect(P.nave[0], P.nave[1], -P.naveH, P.naveH) },
    { id: 'buttresses', poly: rect(P.buttressU[0] - 0.35, P.buttressU[P.buttressU.length - 1] + 0.35, -P.naveH - P.buttressOut, P.naveH + P.buttressOut) },
    { id: 'choir', poly: rect(P.choir[0], P.choir[1], -P.choirH, P.choirH) },
    { id: 'apse', poly: apse },
    { id: 'steps', poly: rect(-P.steps, 0, -1.6, 1.6) },
  ];
}

// ---------------------------------------------------------------- leaded glass
let LEAD_MAT = null;
/** Leaded lights: diamond quarries of greenish and amber crown glass in lead cames, a few coloured panes (canvas). */
function leadedMaterial() {
  if (LEAD_MAT) return LEAD_MAT;
  let map = null;
  if (HAS_DOM) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1d1c'; g.fillRect(0, 0, 64, 128);
    const cols = ['#3d5a52', '#45604f', '#5b6a4a', '#7a6a3a', '#3a4c5c', '#6a3a34', '#4a5a40'];
    let k = 0;
    for (let y = -16; y < 144; y += 16) for (let x = -8; x < 72; x += 16) {
      const ox = ((y / 16) & 1) ? 8 : 0;
      g.fillStyle = cols[(k++ * 5 + (y >> 4)) % cols.length];
      g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + 7, y + 8); g.lineTo(x + ox, y + 16); g.lineTo(x + ox - 7, y + 8); g.closePath(); g.fill();
    }
    g.strokeStyle = '#141414'; g.lineWidth = 1.6;
    for (let d = -128; d < 192; d += 16) { g.beginPath(); g.moveTo(d, 0); g.lineTo(d + 64, 128); g.stroke(); g.beginPath(); g.moveTo(d + 64, 0); g.lineTo(d, 128); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, 64, 40); // the sky in the upper lights
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  }
  LEAD_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.25, metalness: 0.1, emissive: 0x0d0f0e, envMapIntensity: 0.6 });
  LEAD_MAT.name = 'm20:leaded';
  return LEAD_MAT;
}

/** Lancet / round-headed lights as one mesh: [{Ff, u, y, w, h, head: 'pointed'|'round'}] (0.03 m proud of the reveal). */
function leadedLights(list) {
  const pos = [], uv = [], idx = [];
  for (const L of list) {
    const a = L.w / 2, spring = L.y + L.h, rise = L.head === 'round' ? a : a * 1.45, N = 8, base = pos.length / 3;
    // columns of the light: from the sill to the head's intrados
    for (let k = 0; k <= N; k++) {
      const u = -a + (2 * a * k) / N, top = L.head === 'round' ? spring + Math.sqrt(Math.max(0, a * a - u * u)) : archY(u, a, spring, rise);
      for (const y of [L.y, top]) {
        const p = fP(L.Ff, L.u + u, -0.06, y);
        pos.push(...p); uv.push((u + a) / 0.5, (y - L.y) / 0.5);
      }
    }
    for (let k = 0; k < N; k++) { const i = base + k * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
    // (wound so the light faces out of the wall: flip when the face frame is mirrored)
    if (L.Ff.t[0] * L.Ff.n[1] - L.Ff.t[1] * L.Ff.n[0] < 0) for (let q = idx.length - N * 6; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, leadedMaterial());
  m.name = 'm20:church:leaded';
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- pieces
/** Face frames of a rectangle u0..u1 × w0..w1 in F: S (+w), N (−w), E (+u), W (−u); `len` their u ranges. */
function faces(F, u0, u1, w0, w1) {
  return {
    S: { t: F.t, n: F.n, at: (u, w) => F.at(u, w1 + w), len: [u0, u1] },
    N: { t: [-F.t[0], -F.t[1]], n: [-F.n[0], -F.n[1]], at: (u, w) => F.at(-u, w0 - w), len: [-u1, -u0] },
    E: { t: F.n, n: F.t, at: (u, w) => F.at(u1 + w, u), len: [w0, w1] },
    W: { t: [-F.n[0], -F.n[1]], n: [-F.t[0], -F.t[1]], at: (u, w) => F.at(u0 - w, -u), len: [-w1, -w0] },
  };
}

/** A pointed (or round-headed) window reveal on face Ff: dark splay, dressed jambs and head, sill; the light listed. */
function lancet(G, Ff, u, y, w, h, lights, head = 'pointed') {
  const a = w / 2, spring = y + h, rise = head === 'round' ? a : a * 1.45, N = 8;
  // the reveal (dark), the dressed jambs and voussoirs round it
  for (let k = 0; k < N; k++) {
    const u0 = -a + (2 * a * k) / N, u1 = -a + (2 * a * (k + 1)) / N;
    const t0 = head === 'round' ? spring + Math.sqrt(Math.max(0, a * a - u0 * u0)) : archY(u0, a, spring, rise);
    const t1 = head === 'round' ? spring + Math.sqrt(Math.max(0, a * a - u1 * u1)) : archY(u1, a, spring, rise);
    fan(G, 'iron', [fP(Ff, u + u0, -0.08, y), fP(Ff, u + u1, -0.08, y), fP(Ff, u + u1, -0.08, t1), fP(Ff, u + u0, -0.08, t0)], fN(Ff), 0.1);
    const o0 = head === 'round' ? spring + Math.sqrt(Math.max(0, (a + 0.2) ** 2 - (u0 * (a + 0.2) / a) ** 2)) : archY(u0 * (a + 0.2) / a, a + 0.2, spring, rise + 0.2);
    const o1 = head === 'round' ? spring + Math.sqrt(Math.max(0, (a + 0.2) ** 2 - (u1 * (a + 0.2) / a) ** 2)) : archY(u1 * (a + 0.2) / a, a + 0.2, spring, rise + 0.2);
    fan(G, 'dressed', [fP(Ff, u + u0, 0.05, t0), fP(Ff, u + u1, 0.05, t1), fP(Ff, u + (u1 * (a + 0.2)) / a, 0.05, o1), fP(Ff, u + (u0 * (a + 0.2)) / a, 0.05, o0)], fN(Ff), k % 2 ? 1.06 : 0.97);
  }
  for (const s of [-1, 1]) segBox(G, 'dressed', Ff, u + s * a - (s > 0 ? 0 : 0.2), u + s * a + (s > 0 ? 0.2 : 0), -0.05, 0.05, y, spring, 1.03);
  segBox(G, 'dressed', Ff, u - a - 0.25, u + a + 0.25, -0.05, 0.14, y - 0.18, y, 1.0); // sloped sill
  lights.push({ Ff, u, y, w, h, head });
}

/** A buttress against face Ff at u: two stages with weathered (sloped) offsets, `out` deep, to height y1. */
function buttress(G, Ff, u, out, y1, wd = 0.7) {
  const y0 = -0.15, ym = y1 * 0.55;
  segBox(G, 'ashlar', Ff, u - wd / 2, u + wd / 2, -0.05, out, y0, ym, 0.97);
  fan(G, 'dressed', [fP(Ff, u - wd / 2, out, ym), fP(Ff, u + wd / 2, out, ym), fP(Ff, u + wd / 2, out * 0.6, ym + 0.35), fP(Ff, u - wd / 2, out * 0.6, ym + 0.35)], [Ff.n[0], 1, Ff.n[1]], 1.05);
  segBox(G, 'ashlar', Ff, u - wd / 2 + 0.04, u + wd / 2 - 0.04, -0.05, out * 0.6, ym, y1, 0.95);
  fan(G, 'dressed', [fP(Ff, u - wd / 2, out * 0.6, y1), fP(Ff, u + wd / 2, out * 0.6, y1), fP(Ff, u + wd / 2, -0.05, y1 + 0.55), fP(Ff, u - wd / 2, -0.05, y1 + 0.55)], [Ff.n[0], 1, Ff.n[1]], 1.05);
  for (const s of [-1, 1]) fan(G, 'ashlar', [fP(Ff, u + s * wd / 2, -0.05, y1), fP(Ff, u + s * wd / 2, out * 0.6, y1), fP(Ff, u + s * wd / 2, -0.05, y1 + 0.55)], [Ff.t[0] * s, 0, Ff.t[1] * s], 0.95);
}

/** A round-arch corbel frieze (Rundbogenfries) along face Ff from u0 to u1 at y (Romanesque). */
function archFrieze(G, Ff, u0, u1, y) {
  segBox(G, 'dressed', Ff, u0, u1, 0, 0.14, y + 0.42, y + 0.56, 1.04);
  const n = Math.max(2, Math.round((u1 - u0) / 0.55)), d = (u1 - u0) / n;
  for (let k = 0; k < n; k++) {
    const a = u0 + k * d, b = a + d;
    segBox(G, 'dressed', Ff, a, a + 0.08, 0, 0.12, y, y + 0.42, 1.0);
    for (let j = 0; j < 4; j++) {
      const t0 = (j / 4) * Math.PI, t1 = ((j + 1) / 4) * Math.PI, r = d / 2, cx = a + r;
      fan(G, 'dressed', [fP(Ff, cx - Math.cos(t0) * r, 0.1, y + 0.18 + Math.sin(t0) * 0.2), fP(Ff, cx - Math.cos(t1) * r, 0.1, y + 0.18 + Math.sin(t1) * 0.2), fP(Ff, cx - Math.cos(t1) * r, 0.1, y + 0.42), fP(Ff, cx - Math.cos(t0) * r, 0.1, y + 0.42)], fN(Ff), 1.02);
    }
    void b;
  }
}

/** A clock face on face Ff at (u, y): dial, chapter ring, two hands (a quarter to eleven). */
function clockFace(G, Ff, u, y, r = 0.85) {
  const seg = 24, P = (a, rr, w) => fP(Ff, u + Math.cos(a) * rr, w, y + Math.sin(a) * rr);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * TAU, a1 = ((k + 1) / seg) * TAU;
    fan(G, 'plaster', [fP(Ff, u, 0.08, y), P(a0, r, 0.08), P(a1, r, 0.08)], fN(Ff), 1.08);
    fan(G, 'dressed', [P(a0, r, 0.09), P(a0, r + 0.16, 0.09), P(a1, r + 0.16, 0.09), P(a1, r, 0.09)], fN(Ff), 0.95);
  }
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; segBox(G, 'iron', { t: Ff.t, n: Ff.n, at: (uu, ww) => Ff.at(uu, ww) }, u + Math.cos(a) * (r - 0.12) - 0.03, u + Math.cos(a) * (r - 0.12) + 0.03, 0.09, 0.1, y + Math.sin(a) * (r - 0.12) - 0.03, y + Math.sin(a) * (r - 0.12) + 0.03, 0.2); }
  beam(G, 'iron', fP(Ff, u, 0.11, y), fP(Ff, u + Math.cos(2.62) * r * 0.55, 0.11, y + Math.sin(2.62) * r * 0.55), 0.05, 0.08, 0.2);
  beam(G, 'iron', fP(Ff, u, 0.12, y), fP(Ff, u + Math.cos(-0.05) * r * 0.82, 0.12, y + Math.sin(-0.05) * r * 0.82), 0.04, 0.06, 0.2);
}

/**
 * The castle church. o: {x, z, rot, w (the structure: its bounding box), seed}. Returns a Group (one mesh per material
 * plus the leaded lights).
 */
export function buildChurch(o) {
  const G = new Geo(o.seed ?? 'church'), R = G.R, P = planOf(o), F = churchFrame(o), lights = [];
  // the tower's stages from its top down: the belfry, its string course, the friezes, the clock
  const bel = P.towerTop - 3.1, belS = P.towerTop - 3.9, clockY = P.towerTop - 5.9;
  const [t0, t1] = P.tower, [n0, n1] = P.nave, [c0, c1] = P.choir, TH = P.towerH, NH = P.naveH, CH = P.choirH;
  const up = (Ff) => [Ff.n[0], 1, Ff.n[1]];
  // ---- plinths (a chamfered rubble footing round everything)
  segBox(G, 'rubble', F, t0 - 0.12, t1, -TH - 0.12, TH + 0.12, -0.3, 0.7, 0.9);
  segBox(G, 'rubble', F, n0, n1, -NH - 0.1, NH + 0.1, -0.3, 0.6, 0.9);
  segBox(G, 'rubble', F, c0, c1, -CH - 0.1, CH + 0.1, -0.3, 0.6, 0.9);

  // ---- the nave: walls, buttresses, lancets, the saddle roof (slate) with its gables
  segBox(G, 'ashlar', F, n0, n1, -NH, NH, 0.5, P.naveEave, 1.0);
  const NF = faces(F, n0, n1, -NH, NH);
  for (const side of ['S', 'N']) {
    const Ff = NF[side];
    for (const bu of P.buttressU) buttress(G, Ff, side === 'S' ? bu : -bu, P.buttressOut, P.naveEave - 1.6);
    for (let k = 0; k + 1 < P.buttressU.length; k++) {
      const uc = (P.buttressU[k] + P.buttressU[k + 1]) / 2;
      lancet(G, Ff, side === 'S' ? uc : -uc, 3.0, 0.95, 3.2, lights);
    }
    // the eaves' corbel table
    for (let u = Ff.len[0] + 0.3; u < Ff.len[1] - 0.2; u += 0.75) segBox(G, 'dressed', Ff, u - 0.1, u + 0.1, 0, 0.22, P.naveEave - 0.35, P.naveEave - 0.05, 0.98);
  }
  // a small S door (the priest's door) between the first pair of buttresses
  segBox(G, 'planks', NF.S, P.buttressU[0] + 0.55, P.buttressU[0] + 1.45, -0.12, -0.06, 0.6, 2.6, 0.6);
  // (no W gable: the tower stands against it — only its shoulders either side show, below; the E gable over the choir)
  saddle(G, F, n0, n1, -NH, NH, P.naveEave, P.naveRidge, 'slate', { oh: 0.35, ohU0: 0.02, gableMat: 'ashlar', cap: 'lead', gables: false });
  fan(G, 'ashlar', [fP(NF.E, -NH, 0, P.naveEave), fP(NF.E, NH, 0, P.naveEave), fP(NF.E, 0, 0, P.naveRidge - 0.05)], fN(NF.E), 0.97);
  // the nave's E gable above the choir roof: a stone cross on its apex
  const [gx, gz] = F.at(n1 + 0.05, 0);
  G.box('dressed', gx, P.naveRidge + 0.55, gz, 0.22, 1.1, 0.22, F.rot, 1.05);
  G.box('dressed', gx, P.naveRidge + 0.75, gz, 0.22, 0.2, 0.7, F.rot, 1.05);

  // ---- the choir and the apse
  segBox(G, 'ashlar', F, c0, c1, -CH, CH, 0.5, P.choirEave, 0.98);
  const CF = faces(F, c0, c1, -CH, CH);
  for (const side of ['S', 'N']) {
    lancet(G, CF[side], side === 'S' ? (c0 + c1) / 2 : -(c0 + c1) / 2, 3.0, 0.8, 2.6, lights);
    buttress(G, CF[side], side === 'S' ? c0 + 0.45 : -(c0 + 0.45), 0.45, P.choirEave - 1.4, 0.6);
  }
  saddle(G, F, c0, c1, -CH, CH, P.choirEave, P.choirRidge, 'slate', { oh: 0.3, ohU0: 0, ohU1: 0, gableMat: 'ashlar', cap: 'lead', gables: false });
  // the choir's W gable sits under the nave roof; its E gable above the apse's half-cone
  {
    const Ff = CF.E, ye = P.choirEave, yr = P.choirRidge;
    fan(G, 'ashlar', [fP(Ff, -CH, 0, ye), fP(Ff, CH, 0, ye), fP(Ff, 0, 0, yr - 0.05)], fN(Ff), 0.97);
  }
  const seg = 20, [ax, az] = F.at(c1, 0), r = P.apseR;
  for (let k = 0; k < seg; k++) {
    const a0 = -Math.PI / 2 + (Math.PI * k) / seg, a1 = -Math.PI / 2 + (Math.PI * (k + 1)) / seg;
    const p = (a, rr, y) => { const [x, z] = F.at(c1 + Math.cos(a) * rr, Math.sin(a) * rr); return [x, y, z]; };
    const nOut = (a) => { const [x, z] = F.at(Math.cos(a), Math.sin(a)); return [x - F.at(0, 0)[0], 0, z - F.at(0, 0)[1]]; };
    const am = (a0 + a1) / 2;
    fan(G, 'ashlar', [p(a0, r, -0.2), p(a1, r, -0.2), p(a1, r, P.apseEave), p(a0, r, P.apseEave)], nOut(am), 0.97 + R() * 0.05);
    fan(G, 'rubble', [p(a0, r + 0.1, -0.3), p(a1, r + 0.1, -0.3), p(a1, r + 0.1, 0.6), p(a0, r + 0.1, 0.6)], nOut(am), 0.9);
    // the half-cone roof from the eave ring to the apex on the choir's E gable
    fan(G, 'slate', [p(a0, r + 0.3, P.apseEave - 0.2), p(a1, r + 0.3, P.apseEave - 0.2), [ax, P.choirRidge - 1.1, az]], [nOut(am)[0], 1.2, nOut(am)[2]], 0.95);
    // its corbel table
    if (k % 2 === 0) { const [bx, bz] = F.at(c1 + Math.cos(am) * (r + 0.1), Math.sin(am) * (r + 0.1)); G.box('dressed', bx, P.apseEave - 0.2, bz, 0.18, 0.28, 0.22, Math.atan2(nOut(am)[2], nOut(am)[0]), 0.98); }
  }
  // three round-headed apse windows (E, NE, SE)
  for (const a of [-0.75, 0, 0.75]) {
    const nx = Math.cos(a), nz = Math.sin(a), [cx, cz] = F.at(c1 + nx * (r + 0.01), nz * (r + 0.01));
    const [ox, oz] = F.at(0, 0), [ex, ez] = F.at(nx, nz), n = [ex - ox, ez - oz];
    const Ff = { t: [-n[1], n[0]], n, at: (u, w) => [cx + -n[1] * u + n[0] * w, cz + n[0] * u + n[1] * w] };
    lancet(G, Ff, 0, 2.4, 0.62, 2.0, lights, 'round');
  }

  // ---- the W tower
  segBox(G, 'ashlar', F, t0, t1, -TH, TH, 0.6, P.towerTop, 1.0);
  const TF = faces(F, t0, t1, -TH, TH);
  for (const side of ['W', 'S', 'N', 'E']) {
    const Ff = TF[side], [a, b] = Ff.len;
    // corner pilaster strips (Lisenen) and the round-arch friezes between the stages
    for (const uu of [a, b - 0.45]) segBox(G, 'ashlar', Ff, uu, uu + 0.45, 0, 0.12, 0.6, P.towerTop, 1.04);
    for (const y of [P.naveEave + 0.2, belS - 0.6]) archFrieze(G, Ff, a + 0.45, b - 0.45, y);
    segBox(G, 'dressed', Ff, a, b, 0, 0.18, belS, belS + 0.18, 1.05); // the belfry's string course
    // the belfry: paired round-arched openings with a middle column, dark louvres behind
    if (side !== 'E' || true) {
      const mid = (a + b) / 2;
      for (const s of [-1, 1]) {
        const uc = mid + s * 0.62;
        lancet(G, Ff, uc, bel, 0.78, 1.5, [], 'round');
        for (let yy = bel + 0.2; yy < bel + 1.5; yy += 0.28) segBox(G, 'timber', Ff, uc - 0.38, uc + 0.38, -0.2, -0.14, yy, yy + 0.08, 0.5);
      }
      G.cyl('dressed', ...(() => { const [x, z] = Ff.at(mid, 0.12); return [x, bel, z]; })(), 0.13, 0.13, 1.5, 8, 1.0);
    }
    // narrow loops lighting the stair in the lower stages
    if (side !== 'E' && side !== 'W') { for (const y of [4.0, 8.0]) segBox(G, 'iron', Ff, (a + b) / 2 - 0.08, (a + b) / 2 + 0.08, -0.02, 0.01, y, y + 1.0, 0.1); }
  }
  // the W portal with its steps, an oculus over it, the clock below the belfry (W and S)
  portal(G, TF.W, 0, 0.6, { w: 1.7, h: 3.3, steps: P.steps, rise: 0.45 });
  {
    const Ff = TF.W, seg2 = 16;
    for (let k = 0; k < seg2; k++) {
      const a0 = (k / seg2) * TAU, a1 = ((k + 1) / seg2) * TAU;
      fan(G, 'iron', [fP(Ff, 0, -0.04, 7.0), fP(Ff, Math.cos(a0) * 0.45, -0.04, 7.0 + Math.sin(a0) * 0.45), fP(Ff, Math.cos(a1) * 0.45, -0.04, 7.0 + Math.sin(a1) * 0.45)], fN(Ff), 0.12);
      fan(G, 'dressed', [fP(Ff, Math.cos(a0) * 0.45, 0.06, 7.0 + Math.sin(a0) * 0.45), fP(Ff, Math.cos(a0) * 0.68, 0.06, 7.0 + Math.sin(a0) * 0.68), fP(Ff, Math.cos(a1) * 0.68, 0.06, 7.0 + Math.sin(a1) * 0.68), fP(Ff, Math.cos(a1) * 0.45, 0.06, 7.0 + Math.sin(a1) * 0.45)], fN(Ff), 1.03);
    }
  }
  clockFace(G, TF.W, 0, clockY, 0.75);
  clockFace(G, TF.S, (TF.S.len[0] + TF.S.len[1]) / 2, clockY, 0.75);
  // the tower's top: a cornice, the octagonal broach spire in slate, its ball and cross
  segBox(G, 'dressed', F, t0 - 0.12, t1 + 0.12, -TH - 0.12, TH + 0.12, P.towerTop - 0.05, P.towerTop + 0.18, 1.05);
  {
    // a regular octagon inscribed in the tower's square (its vertices on the square's edges) rising to the apex; at each
    // corner a broach (two sloped triangles) from the square's corner up onto the spire's diagonal face
    const um = (t0 + t1) / 2, [cx, cz] = F.at(um, 0), y0 = P.towerTop + 0.18, y1 = P.spireTop, h = TH + 0.1, tq = Math.tan(Math.PI / 8);
    const L = (u, w, y) => { const [x, z] = F.at(um + u, w); return [x, y, z]; };
    const oct = [[h, -h * tq], [h, h * tq], [h * tq, h], [-h * tq, h], [-h, h * tq], [-h, -h * tq], [-h * tq, -h], [h * tq, -h]];
    const apex = [cx, y1, cz];
    for (let k = 0; k < 8; k++) {
      const a = oct[k], b = oct[(k + 1) % 8], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const [mx, mz] = F.at(um + m[0], m[1]);
      fan(G, 'slate', [L(a[0], a[1], y0), L(b[0], b[1], y0), apex], [mx - cx, 0.22, mz - cz], 0.95 + (k % 2) * 0.05);
    }
    const yb = y0 + 2.6, f = (yb - y0) / (y1 - y0);
    for (const [cu, cw, ka] of [[h, h, 1], [-h, h, 3], [-h, -h, 5], [h, -h, 7]]) {
      const A = oct[ka], B = oct[(ka + 1) % 8], M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const D = L(M[0] * (1 - f), M[1] * (1 - f), yb), C = L(cu, cw, y0);
      const [ox, oz] = F.at(um + cu, cw);
      fan(G, 'slate', [C, L(A[0], A[1], y0), D], [ox - cx, 0.9, oz - cz], 0.9);
      fan(G, 'slate', [C, D, L(B[0], B[1], y0)], [ox - cx, 0.9, oz - cz], 0.9);
      // the octagon's square-edge faces start at the edge: close the broach's sides down to the tower's top
    }
    const ro = h;
    // little lucarnes on the spire's cardinal faces, the ball and the cross
    for (let k = 0; k < 4; k++) {
      const a = F.rot + (k * TAU) / 4, rr = ro * 0.58, yy = y0 + 4.2, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      G.box('slate', x, yy + 0.35, z, 0.55, 0.7, 0.5, a + Math.PI / 2, 0.9);
      G.box('iron', x + Math.cos(a) * 0.26, yy + 0.3, z + Math.sin(a) * 0.26, 0.3, 0.42, 0.03, a + Math.PI / 2, 0.12);
    }
    G.cyl('iron', cx, y1 - 0.3, cz, 0.05, 0.05, 1.6, 6, 0.45);
    G.cyl('lead', cx, y1 + 0.35, cz, 0.24, 0.24, 0.42, 10, 1.1);
    G.box('iron', cx, y1 + 1.35, cz, 0.08, 1.3, 0.08, 0, 0.45);
    G.box('iron', cx, y1 + 1.55, cz, 0.08, 0.08, 0.75, F.rot, 0.45);
  }
  // the nave roof's W end meets the tower: a lead flashing; the nave's W gable shoulders either side of the tower
  for (const s of [-1, 1]) {
    const Ff = { t: [-F.n[0], -F.n[1]], n: [-F.t[0], -F.t[1]], at: (u, w) => F.at(n0 - w, -u) };
    const wA = s * TH, wB = s * NH, ya = P.naveEave + (P.naveRidge - P.naveEave) * (1 - TH / NH);
    fan(G, 'ashlar', [fP(Ff, -wA, 0, P.naveEave), fP(Ff, -wB, 0, P.naveEave), fP(Ff, -wA, 0, ya)], fN(Ff), 0.96);
    void wA;
  }

  // ---- 1945: the garrison's crates by the portal, the lookout's sandbags in the belfry's W and N openings, its MG
  const W = TF.W, Nf = TF.N;
  for (const [u, y, w2] of [[-1.9, 0.6, 0.5], [-1.9, 1.15, 0.45], [-2.3, 0.6, 0.45]]) {
    const [x, z] = W.at(u, w2);
    G.box('paint', x, y + 0.27, z, 0.9, 0.5, 0.55, Math.atan2(W.t[1], W.t[0]) + 0.05 * R(), 0.85);
    G.box('iron', x, y + 0.53, z, 0.92, 0.04, 0.57, Math.atan2(W.t[1], W.t[0]), 0.3);
  }
  for (const Ff of [W, Nf]) {
    const mid = (Ff.len[0] + Ff.len[1]) / 2;
    for (let k = 0; k < 5; k++) {
      const [x, z] = Ff.at(mid - 0.62 + (k % 3) * 0.22 - 0.2, 0.05);
      G.box('burlap', x, bel + 0.15 + Math.floor(k / 3) * 0.2, z, 0.5, 0.2, 0.32, Math.atan2(Ff.t[1], Ff.t[0]) + (R() - 0.5) * 0.3, 0.9);
    }
  }
  {
    const mid = (W.len[0] + W.len[1]) / 2, [x, z] = W.at(mid - 0.62, 0.35);
    G.box('iron', x, bel + 0.6, z, 0.9, 0.06, 0.06, Math.atan2(W.n[1], W.n[0]), 0.25); // the MG 34's barrel jacket over the sill
  }
  void up;
  const g = G.build(`m20:church`, { ground: 0 });
  g.add(leadedLights(lights));
  g.name = 'm20:church';
  // (on a terrace: the whole church stands on its level, `y0` m up — in world coordinates like the rest of the castle)
  if (o.y0) g.traverse((n) => { if (n.isMesh) { n.geometry.translate(0, o.y0, 0); n.geometry.computeBoundingSphere(); } });
  return g;
}
