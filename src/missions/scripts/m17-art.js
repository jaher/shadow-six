/**
 * M17 art pass (Before Dawn): the sliding bridge over the gorge (dossier §5.4 `mobile_bridge`, "red-painted plank
 * deck on rollers"), drawn in place of the mobile_bridge placeholder slab and driven by the set-piece's state.
 * A rolling (telescoping) bridge: a fixed outrigger on fish-belly girders runs out from the N lip; the red plank
 * span rides on its rollers. Retracted (the set-piece's start state) the span sits back on the outrigger and the
 * gorge's S half is open; the lever slides it out onto the S landing sill over `moveTime` seconds. Visual only:
 * the deck cells, the fall and the crush stay the set-piece's (missions/setpieces-structures.js MobileBridge).
 * @module missions/scripts/m17-art
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial, boulderGeometry } from '../../art/dressing.js';
import { carveField } from '../../art/terrain/carve.js';

/** Along-axis layout (local x, m; 0 = the structure centre, +x towards the S lip). */
export const MB = { nEnd: -10.25, sEnd: 10.25, nLip: -9.15, sLip: 7.55, tip: -0.4, span: 11.4, travel: 9.6, half: 2.5 };

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const red = dressingMaterial('planks').clone(); red.color = new THREE.Color(0xb0483a); red.name = 'm17:deck_red';
  const steel = dressingMaterial('steel').clone(); steel.color = new THREE.Color(0x6a5a50); steel.name = 'm17:girder';
  MATS = { red, steel, iron: dressingMaterial('castIron'), sill: dressingMaterial('concrete'), planks: dressingMaterial('planks') };
  return MATS;
}

const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
const C = (r, len, x, y, z) => new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2).translate(x, y, z).toNonIndexed();

function merged(geos, mat, name) {
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
  for (const g of geos) g.dispose();
  m.name = name; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Plank deck between x0 and x1 at top height y (boards across the span, 3 cm gaps) + kerb timbers. */
function deck(G, x0, x1, y, half) {
  for (let x = x0 + 0.13; x < x1 - 0.1; x += 0.29) G.push(B(0.26, 0.07, half * 2 - 0.1, x, y - 0.035, 0));
  for (const s of [-1, 1]) G.push(B(x1 - x0, 0.14, 0.16, (x0 + x1) / 2, y + 0.05, s * (half - 0.08)));
}

/** Railing along both sides between x0 and x1 (steel posts every ~1.5 m, top + knee rails). */
function railing(G, x0, x1, y, half) {
  const n = Math.max(2, Math.round((x1 - x0) / 1.5));
  for (const s of [-1, 1]) {
    for (let k = 0; k <= n; k++) G.push(B(0.05, 1.0, 0.05, x0 + ((x1 - x0) * k) / n, y + 0.5, s * (half - 0.05)));
    for (const ry of [0.5, 0.98]) G.push(B(x1 - x0, 0.04, 0.04, (x0 + x1) / 2, y + ry, s * (half - 0.05)));
  }
}

/** Build the bridge group (local frame: +x along the axis, N end at MB.nEnd). @returns {{root, span}} */
export function buildSlidingBridge() {
  const M = mats(), root = new THREE.Group(); root.name = 'm17:mbridge';
  const h = MB.half;
  // concrete sills: the N abutment and the S landing, with steel bearing plates
  const sill = [B(MB.nLip - MB.nEnd + 1.2, 0.9, h * 2 + 0.6, (MB.nEnd + MB.nLip) / 2 + 0.3, -0.55, 0), B(MB.sEnd - MB.sLip + 0.6, 0.9, h * 2 + 0.6, (MB.sLip + MB.sEnd) / 2 - 0.3, -0.67, 0)];
  root.add(merged(sill, M.sill, 'm17:mbridge:sills'));
  // fixed outrigger: fish-belly girders (deep at the lip, shallow at the tip), cross-girders, knee struts, planks
  const fx0 = MB.nEnd + 0.3, fx1 = MB.tip, Gs = [], Gp = [];
  for (const s of [-1, 1]) {
    for (let x = fx0; x < fx1 - 0.01; x += 0.5) {
      const t = (x - MB.nLip) / (fx1 - MB.nLip), depth = x < MB.nLip ? 0.5 : 0.95 - 0.55 * Math.max(0, t);
      Gs.push(B(0.52, depth, 0.14, x + 0.25, -0.14 - depth / 2, s * (h - 0.6)));
    }
    Gs.push(B(fx1 - fx0, 0.08, 0.3, (fx0 + fx1) / 2, -0.14, s * (h - 0.6)));                      // top flange
    const L = 3.4, a = Math.atan2(1.9, 2.6);                                                       // knee strut to the gorge wall
    Gs.push(new THREE.BoxGeometry(L, 0.16, 0.16).rotateZ(a).translate(MB.nLip + 1.2, -1.45, s * (h - 0.6)).toNonIndexed());
  }
  for (let x = fx0 + 0.6; x < fx1; x += 2.2) Gs.push(B(0.14, 0.3, h * 2 - 1.0, x, -0.3, 0));         // cross-girders
  for (const s of [-1, 1]) for (const x of [MB.nLip + 0.2, fx1 - 0.3]) Gs.push(C(0.13, 0.28, x, -0.02, s * (h - 0.6))); // rollers the span rides on
  deck(Gp, fx0, fx1, -0.06, h - 0.25);
  root.add(merged(Gs, M.steel, 'm17:mbridge:outrigger'), merged(Gp, M.planks, 'm17:mbridge:outrigger_deck'));
  // the sliding span (red planks on two girders, rollers under its N end, a hinged steel lip at its S end)
  const span = new THREE.Group(); span.name = 'm17:mbridge:span';
  const sx0 = MB.sEnd - MB.span, sx1 = MB.sEnd, Ss = [], Sp = [], Si = [];
  for (const s of [-1, 1]) {
    Ss.push(B(sx1 - sx0, 0.34, 0.14, (sx0 + sx1) / 2, -0.05, s * (h - 0.35)), B(sx1 - sx0, 0.05, 0.3, (sx0 + sx1) / 2, 0.11, s * (h - 0.35)));
    for (const x of [sx0 + 0.4, sx0 + 1.2]) Si.push(C(0.15, 0.24, x, -0.17, s * (h - 0.35)));
  }
  for (let x = sx0 + 0.5; x < sx1; x += 1.8) Ss.push(B(0.12, 0.22, h * 2 - 0.8, x, -0.02, 0));
  deck(Sp, sx0, sx1, 0.2, h);
  railing(Si, sx0 + 0.3, sx1 - 0.6, 0.2, h);
  Si.push(B(0.7, 0.03, h * 2 - 0.4, sx1 + 0.1, 0.17, 0));                                           // landing lip plate
  for (const s of [-1, 1]) Si.push(B(0.5, 0.25, 0.1, sx0 + 0.15, 0.32, s * (h - 0.4)));              // cable lugs
  span.add(merged(Ss, M.steel, 'm17:mbridge:span_girders'), merged(Sp, M.red, 'm17:mbridge:span_deck'), merged(Si, M.iron, 'm17:mbridge:span_iron'));
  root.add(span);
  return { root, span };
}

/**
 * Swap the mobile-bridge placeholder for the sliding bridge and keep the span where the set-piece says it is.
 * @param {object} w world (structures Map, setpieces director, onBelTick)
 * @param {{id?: string, setpiece?: string, x: number, z: number, rot: number}} s the deck structure def
 */
export function buildM17Art(w, s, gorge = null) {
  const o = w?.structures?.get?.(s.id ?? 'mbridge_deck')?.object3d;
  if (!o || o.userData.m17Art) return false;
  o.userData.m17Art = true;
  const { root, span } = buildSlidingBridge();
  const hide = () => { for (const c of o.children) if (c !== root) c.visible = false; };
  hide();
  o.visible = true;
  o.updateMatrixWorld(true);
  const place = new THREE.Group();
  place.position.set(s.x, 0, s.z); place.rotation.y = -s.rot; place.updateMatrix();
  root.applyMatrix4(place.matrix.clone().premultiply(o.matrixWorld.clone().invert()));
  o.add(root);
  notchGorge(w, s); // (a no-op on the carved gorge: its kit is empty)
  if (gorge) dressGorge(w, s, gorge);
  let at = null;
  const sync = () => {
    const sp = w.setpieces?.get?.(s.setpiece ?? 'mbridge');
    if (!sp) return;
    const T = sp.spec?.moveTime ?? 3, out = (e) => (e ? 0 : -MB.travel);
    let x = out(sp.extended);
    if (sp.moving > 0) { const k = 1 - sp.moving / T, e = k * k * (3 - 2 * k); x = out(sp.extended) + (out(sp.target) - out(sp.extended)) * e; }
    if (x !== at) { at = x; span.position.x = x; span.position.y = Math.max(0, Math.min(1, -x / 0.6)) * 0.18; } // (rides up onto the outrigger as it rolls back)
    hide(); // (a library placeholder may arrive late)
  };
  sync();
  w.onBelTick?.(sync);
  return true;
}

/**
 * The gorge kit (art/kit-terrain.js buildGorge) suggests its depth with a boulder rim up to ~1.1 m above the ground:
 * where the bridge crosses, the rim is cut down to the ground so the sills and the span lie on it, not under it.
 */
function notchGorge(w, s, gorgeId = 'gorge') {
  const g = w.structures?.get?.(gorgeId)?.object3d;
  if (!g) return 0;
  g.updateMatrixWorld(true);
  const c = Math.cos(s.rot), sn = Math.sin(s.rot), v = new THREE.Vector3();
  let n = 0;
  g.traverse((m) => {
    const pos = m.isMesh && m.geometry?.attributes?.position;
    if (!pos) return;
    const inv = m.matrixWorld.clone().invert();
    let hit = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const dx = v.x - s.x, dz = v.z - s.z, lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
      if (Math.abs(lx) > MB.sEnd + 0.8 || Math.abs(lz) > MB.half + 0.6 || v.y <= 0.02) continue;
      v.y = 0.02; v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); hit = true; n++;
    }
    if (hit) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox(); }
  });
  return n;
}

/** Deterministic [0, 1) generator. */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * The carved gorge's rocks and stream (dossier §4.2: "rocky gorge with a stream"): boulders and fallen slabs on the
 * banks and the bed, sitting on the carve's surface, clear of the bridge corridor; a shallow stream down the bed.
 * @param {{carves: object[], size: number[], poly: number[][], stream?: number[][]}} gorge
 */
function dressGorge(w, s, gorge) {
  const field = carveField(gorge.carves, { W: gorge.size[0], D: gorge.size[1] });
  const root = w.structures?.get?.(s.gorgeId ?? 'gorge')?.object3d;
  if (!field || !root) return 0;
  const R = rng(1717), c = Math.cos(s.rot), sn = Math.sin(s.rot), poly = gorge.poly;
  const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const geo = [[], []];
  let n = 0;
  for (let k = 0; k < 900 && n < 70; k++) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    if (!inPoly(x, z, poly) || x > 29 || x < 5.5) continue;           // (the E end runs under the camp wall; the GB climbs at x 2.5)
    const dx = x - s.x, dz = z - s.z, lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    if (Math.abs(lx) < MB.sEnd + 1.5 && Math.abs(lz) < MB.half + 1.2) continue; // the bridge corridor
    const y = field.at(x, z);
    if (y > -0.4) continue;                                            // only on the cut, never on the lip
    const r = 0.3 + R() * (y < -3.5 ? 0.9 : 0.55);
    const g = boulderGeometry(r, r * (0.55 + R() * 0.45), r * (0.7 + R() * 0.4), Math.floor(R() * 1e9), 2);
    g.rotateY(R() * 6.28).translate(x, y + r * 0.25, z);
    geo[R() < 0.55 ? 0 : 1].push(g.index ? g.toNonIndexed() : g);
    n++;
  }
  const grp = new THREE.Group(); grp.name = 'm17:gorge_rocks';
  ['rock', 'rockDark'].forEach((m, i) => { if (geo[i].length) grp.add(merged(geo[i], dressingMaterial(m), `m17:gorge_rocks:${m}`)); });
  if (gorge.stream?.length > 1) { // a shallow stream on the bed: a ribbon a few cm over the carve, dark and glossy
    const pts = [], idx = [];
    const S = gorge.stream, half = 0.7;
    for (let i = 0; i < S.length; i++) {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
      for (const sd of [-1, 1]) { const x = S[i][0] - (tz / L) * half * sd, z = S[i][1] + (tx / L) * half * sd; pts.push(x, field.at(x, z) + 0.05, z); }
      if (i) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); sg.setIndex(idx); sg.computeVertexNormals();
    const water = new THREE.MeshStandardMaterial({ color: 0x1d4a4c, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide }); water.name = 'm17:stream';
    const m = new THREE.Mesh(sg, water); m.name = 'm17:gorge_stream'; m.receiveShadow = true; grp.add(m);
  }
  root.updateMatrixWorld(true);
  grp.applyMatrix4(root.matrixWorld.clone().invert());
  root.add(grp);
  return n;
}
