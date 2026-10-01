/**
 * Pre-fractured gate models (design-spec §3.7 ramming addendum). Built from the SAME layout the physics uses
 * (world/breakables.js gateLayout): one mesh per piece, centred on the piece's collider box, so a piece's physics pose
 * is its mesh's world transform. Intact, the seams interlock (both sides of a fracture share one jagged profile) and
 * read as whole planks / rails / poles; broken, the jagged splintered ends show.
 *   - plank: vertical boards (boards_weathered), tarred rails + Z-brace, iron hinge straps and pintles, log posts
 *   - boom:  red/white striped pole, pivot post with counterweight, fork rest post
 *   - wire:  steel tube frame, wire mesh panel, steel posts
 * Snow on top faces comes from the scene's prop snow cover (the pieces use shared prop materials).
 * `root.userData.gate` = {layout, pieces: Map(id → mesh), leaves: [Group], setOpen(open, instant), tick(dt), nudge(a)}.
 * @module art/breakable-gates
 */

import * as THREE from 'three';
import { dressingMaterial } from './dressing.js';
import { layoutOf } from '../world/breakables.js';

let IRON = null, STRIPES = null, MESH_MAT = null;
function ironMat() {
  IRON ||= Object.assign(new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.55, metalness: 0.65 }), { name: 'gate:iron' });
  return IRON;
}
function stripeMat() {
  if (!STRIPES) {
    // 1 × 2 texel red / white band texture; the pole UVs run 1 repeat per metre along the pole (0.5 m bands)
    const t = new THREE.DataTexture(new Uint8Array([158, 22, 16, 255, 222, 216, 204, 255]), 1, 2, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    STRIPES = Object.assign(new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.05 }), { name: 'gate:stripes' });
  }
  return STRIPES;
}
function wireMeshMat() {
  if (!MESH_MAT) {
    MESH_MAT = new THREE.MeshStandardMaterial({ color: 0x6d7070, roughness: 0.5, metalness: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    MESH_MAT.name = 'gate:mesh';
  }
  return MESH_MAT;
}

const DERIVED = new Map();
/** A cached variant of a shared dressing material (per base material: the dressing cache is per preset tier). */
function derived(base, key, make) {
  const k = `${base.uuid}|${key}`;
  if (!DERIVED.has(k)) { const m = base.clone(); m.userData = { shared: true }; make(m); m.name = `gate:${key}`; DERIVED.set(k, m); }
  return DERIVED.get(k);
}
/** Gate boards: the weathered board texture in a darker, tarred-brown tone (the debris keeps the same material). */
export const gateWoodMat = () => derived(dressingMaterial('planks'), 'boards', (m) => m.color.setHex(0x8e7860));
/** Fresh pale wood of a torn board / rail end. */
export const freshWoodMat = () => derived(dressingMaterial('planks'), 'fresh', (m) => { m.color.setHex(0xe0b070); if (m.normalScale) m.normalScale.set(0.6, 0.6); });
/** The torn zone of a broken board: splintered, half fresh wood (the board's slot 2 once it broke at that seam). */
export const tornWoodMat = () => derived(dressingMaterial('planks'), 'torn', (m) => { m.color.setHex(0xc89a62); if (m.normalScale) m.normalScale.set(1.6, 1.6); });

function mk(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/**
 * A board (half extents hx, hy, hz) whose bottom / top ends follow jagged splinter profiles (u across the width,
 * dy along the length), extruded through its thickness. Centred on the box centre; grain runs along y.
 * Material groups: 0 = weathered board; 1 = torn end faces (pale fresh wood, hidden inside the interlocking fracture
 * while the gate is whole); 2 = the torn zone's faces next to a seam (weathered while whole, fresh-looking once the
 * board broke there: gate-smash-visuals swaps that slot's material).
 */
export function splinteredBoard(hx, hy, hz, seamBot = null, seamTop = null) {
  const edge = (seam, y) => (seam ? seam.map(([u, dy]) => [-hx + u * 2 * hx, y + dy]) : [[-hx, y], [hx, y]]);
  const band = (seam) => (seam ? Math.max(...seam.map((q) => Math.abs(q[1]))) + 0.035 : 0);
  const yb = -hy + band(seamBot), yt = hy - band(seamTop);
  const parts = []; // [outline points (ccw), group of the caps, group of the sides]
  parts.push([[[-hx, yb], [hx, yb], [hx, yt], [-hx, yt]], 0, 0]);
  if (seamBot) parts.push([[...edge(seamBot, -hy), [hx, yb], [-hx, yb]], 2, 1]);
  if (seamTop) parts.push([[[-hx, yt], [hx, yt], ...edge(seamTop, hy).reverse()], 2, 1]);
  const pos = [], uvs = [], tris = [[], [], []];
  for (const [pts, gc, gs] of parts) {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
    sh.closePath();
    const e = new THREE.ExtrudeGeometry(sh, { depth: 2 * hz, bevelEnabled: false, steps: 1 });
    const P = e.attributes.position, U = e.attributes.uv, sideStart = e.groups.find((q) => q.materialIndex === 1)?.start ?? P.count;
    for (let t = 0; t < P.count / 3; t++) {
      const k = t * 3 < sideStart ? gc : gs;
      tris[k].push(pos.length / 9);
      for (let v = t * 3; v < t * 3 + 3; v++) { pos.push(P.getX(v), P.getY(v), P.getZ(v) - hz); uvs.push(U.getX(v) * 0.9, U.getY(v) * 0.9); }
    }
    e.dispose();
  }
  // reorder triangles by group (0, 1, 2)
  const g = new THREE.BufferGeometry(), order = [...tris[0], ...tris[1], ...tris[2]];
  const P = new Float32Array(order.length * 9), UV = new Float32Array(order.length * 6);
  order.forEach((t, i) => { P.set(pos.slice(t * 9, t * 9 + 9), i * 9); UV.set(uvs.slice(t * 6, t * 6 + 6), i * 6); });
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  let o = 0;
  tris.forEach((list, k) => { g.addGroup(o * 3, list.length * 3, k); o += list.length; });
  g.computeVertexNormals();
  return g;
}

/** A loose splinter: a thin, tapering sliver of wood (long axis y), pointed and ragged at both ends. */
function sliver(hx, hy, hz) {
  const s = new THREE.Shape();
  s.moveTo(-hx * 0.35, -hy); s.lineTo(hx * 0.6, -hy * 0.55); s.lineTo(hx, hy * 0.2); s.lineTo(hx * 0.15, hy);
  s.lineTo(-hx * 0.4, hy * 0.62); s.lineTo(-hx, -hy * 0.1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2 * hz, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -hz);
  g.computeVertexNormals();
  return g;
}

/** A rail (half extents; long axis x) with a jagged end at +x (atMax) or −x. */
function splinteredRail(hx, hy, hz, seam, atMax) {
  const g = splinteredBoard(hy, hx, hz, atMax ? null : seam, atMax ? seam : null);
  g.rotateZ(-Math.PI / 2); // board y (length) → rail x
  return g;
}

/** Pole segment along x (radius r, half length hx) with jagged ends; optional red/white stripes (0.5 m) from x0. */
function poleSegment(hx, r, seamMin, seamMax, stripe = null) {
  const g = new THREE.CylinderGeometry(r, r, 2 * hx, 12, 1, false);
  g.rotateZ(-Math.PI / 2); // axis y → x
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const a = (Math.atan2(p.getZ(i), p.getY(i)) + Math.PI) / (2 * Math.PI);
    const onRim = Math.hypot(p.getY(i), p.getZ(i)) > r * 0.5;
    const prof = (seam) => seam[Math.min(seam.length - 1, Math.round(a * (seam.length - 1)))][1];
    if (x > hx - 1e-4 && seamMax && onRim) x += prof(seamMax);
    if (x < -hx + 1e-4 && seamMin && onRim) x += prof(seamMin);
    p.setX(i, x);
    if (stripe) uv.setXY(i, a, (stripe.cx + x - stripe.x0) / 1.0);
  }
  g.computeVertexNormals();
  return g;
}

let WIRE_TEX = null;
/** Diamond wire-mesh alpha texture (16 px, 2 wires per repeat). */
function wireTex() {
  if (WIRE_TEX) return WIRE_TEX;
  const n = 16, d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const on = Math.abs(((i + j) % n) - 0) < 1.2 || Math.abs(((i - j + n) % n) - 0) < 1.2;
    d.set(on ? [150, 154, 150, 255] : [0, 0, 0, 0], (j * n + i) * 4);
  }
  WIRE_TEX = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  WIRE_TEX.wrapS = WIRE_TEX.wrapT = THREE.RepeatWrapping;
  WIRE_TEX.magFilter = THREE.LinearFilter;
  WIRE_TEX.needsUpdate = true;
  return WIRE_TEX;
}

/** Mesh for one layout piece, centred on its collider box (rotation rz about z included). */
function pieceMesh(p, L, kind) {
  const [hx, hy, hz] = p.h;
  let m;
  if (p.kind === 'plank') m = mk(splinteredBoard(hx, hy, hz, p.seamBot, p.seamTop), [gateWoodMat(), freshWoodMat(), gateWoodMat()]);
  else if (p.kind === 'rail') m = mk(splinteredRail(hx, hy, hz, p.seamX, p.seamAtMax), [dressingMaterial('logsTarred'), freshWoodMat(), dressingMaterial('logsTarred')]);
  else if (p.kind === 'brace') m = mk(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz), dressingMaterial('logsTarred'));
  else if (p.kind === 'pole') m = mk(poleSegment(hx, hy, p.seamMin, p.seamMax, { cx: p.c[0], x0: p.x0 }), stripeMat());
  else if (p.kind === 'weight' && p.round) m = mk(poleSegment(hx, hy, null, null), ironMat());
  else if (p.kind === 'weight') m = mk(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz), dressingMaterial('concrete'));
  else if (p.kind === 'frame') m = mk(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz), dressingMaterial('galv'));
  else if (p.kind === 'mesh') {
    const mat = wireMeshMat();
    if (!mat.map) { mat.map = wireTex(); mat.alphaTest = 0.4; mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; mat.needsUpdate = true; }
    const g = new THREE.PlaneGeometry(2 * hx, 2 * hy);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hx * 2 / 0.12, uv.getY(i) * hy * 2 / 0.12);
    m = mk(g, mat, false);
  } else if (p.kind === 'post') {
    if (kind === 'plank') m = mk(new THREE.CylinderGeometry(hx * 0.92, hx, 2 * hy, 9), dressingMaterial('logs'));
    else if (kind === 'wire') m = mk(new THREE.CylinderGeometry(hx, hx, 2 * hy, 10), dressingMaterial('galv'));
    else m = mk(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz), dressingMaterial('creosote'));
  } else if (p.kind === 'splinter') m = mk(sliver(hx, hy, hz), freshWoodMat(), false);
  else m = mk(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz), dressingMaterial('planks'));
  m.name = `gate-piece:${p.id}`;
  m.position.set(p.c[0], p.c[1], p.c[2]);
  m.rotation.z = p.rz || 0;
  m.userData.piece = p.id;
  if (p.kind === 'splinter') m.userData.splinter = true;
  // iron hinge strap on the hinge half of each rail, over the boards, with a pintle eye at the hinge end
  if (p.strap) {
    const zOff = L.plankFace - p.c[2] + 0.005, dir = Math.sign(p.c[0] - p.strap.from) || 1;
    const st = mk(new THREE.BoxGeometry(p.strap.len, 0.055, 0.01), ironMat());
    st.position.set(p.strap.from + dir * p.strap.len / 2 - p.c[0], 0, zOff);
    const eye = mk(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8), ironMat());
    eye.position.set(p.strap.from - p.c[0], 0, zOff - 0.03);
    for (const k of [0.3, 0.6, 0.9]) { // bolt heads
      const b = mk(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 6), ironMat(), false);
      b.rotation.x = Math.PI / 2; b.position.set(st.position.x + dir * (k - 0.5) * p.strap.len * 0.9, 0, zOff + 0.008);
      m.add(b);
    }
    m.add(st, eye);
  }
  return m;
}

/**
 * Build the breakable gate model for a structure def, in the gate's local frame (props.js `placed` group).
 * @param {object} def mission structure def
 * @returns {THREE.Group|null}
 */
export function buildBreakableGate(def) {
  const layout = layoutOf(def);
  if (!layout) return null;
  const root = new THREE.Group();
  root.name = `gate-model:${layout.kind}`;
  const pieces = new Map(), leaves = [];
  const plankFace = Math.max(...layout.pieces.filter((p) => p.kind === 'plank').map((p) => p.c[2] + p.h[2]), 0);
  for (let L = 0; L < layout.leaves; L++) {
    const hinge = layout.hinges.find((hh) => hh.leaf === L);
    const g = new THREE.Group();
    g.name = `gate-leaf:${L}`;
    const piv = layout.pivot || [hinge?.at[0] ?? 0, 0, hinge?.at[2] ?? 0];
    g.position.set(piv[0], layout.pivot ? piv[1] : 0, piv[2]);
    g.userData.pivot = piv;
    g.userData.side = hinge && !layout.pivot ? Math.sign(hinge.at[0]) || -1 : -1;
    leaves.push(g); root.add(g);
  }
  for (const p of layout.pieces) {
    const m = pieceMesh(p, { plankFace }, layout.kind);
    if (p.leaf >= 0) {
      const g = leaves[p.leaf];
      m.position.x -= g.position.x; m.position.y -= g.position.y; m.position.z -= g.position.z;
      g.add(m);
    } else root.add(m);
    pieces.set(p.id, m);
  }
  // loose splinters: only shown once a board breaks at their seam (gate-smash-visuals)
  for (const p of layout.splinters || []) {
    const m = pieceMesh(p, { plankFace }, layout.kind);
    m.visible = false;
    root.add(m);
    pieces.set(p.id, m);
  }
  // pintles stay on the posts when a leaf tears off
  for (const hh of layout.hinges) {
    if (layout.kind === 'boom') continue;
    const pin = mk(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), ironMat());
    pin.position.set(hh.at[0] + Math.sign(hh.at[0]) * 0.05, hh.at[1], hh.at[2]);
    const bracket = mk(new THREE.BoxGeometry(0.12, 0.03, 0.05), ironMat());
    bracket.position.set(hh.at[0] + Math.sign(hh.at[0]) * 0.1, hh.at[1] - 0.06, hh.at[2]);
    root.add(pin, bracket);
  }
  const state = { angle: 0, target: 0, nudge: 0, nudgeV: 0, nudgeSign: 1 };
  const apply = () => {
    for (const g of leaves) {
      if (g.userData.detached) continue;
      if (layout.kind === 'boom') g.rotation.z = state.angle * 1.45;
      else g.rotation.y = -g.userData.side * state.angle * 1.75 + g.userData.side * state.nudgeSign * state.nudge;
    }
  };
  root.userData.gate = {
    layout, pieces, leaves, state,
    /** Swing the leaves open (boom: raise the pole). instant: jump (load, map build). */
    setOpen(open, instant = false) { state.target = open ? 1 : 0; if (instant) { state.angle = state.target; apply(); } },
    /** A slow push (hold): the leaves bow in the push direction (sign = travel across the gate) and spring back. */
    nudge(amount, sign = 1) { state.nudgeV += amount; state.nudgeSign = sign >= 0 ? 1 : -1; },
    /** Per-frame animation (open swing ~1.2 s, damped nudge spring). @returns {boolean} still animating */
    tick(dt) {
      const d = state.target - state.angle;
      state.angle += Math.sign(d) * Math.min(Math.abs(d), dt / 1.2);
      state.nudgeV += (-60 * state.nudge - 6 * state.nudgeV) * dt;
      state.nudge += state.nudgeV * dt;
      apply();
      return Math.abs(d) > 1e-4 || Math.abs(state.nudge) + Math.abs(state.nudgeV) > 1e-4;
    },
  };
  return root;
}
