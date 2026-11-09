/**
 * The Leopold blown up (M6: the Krupp K5 railway gun, user: "The Leopold train should look more realistic when burning.
 * It looks like a flat black rectangle"). Built from the intact gun's own model — every level of detail, its geometry
 * and silhouette kept: barrel, cradle, carriage, bogies, walkways and plating all still read — and drawn through the
 * charred materials of art/wreck-char.js (scorched paint, peeled bare metal with temper colours, rust, soot, ash),
 * hottest where the fire burns (the carriage's middle, the breech) and at the charge:
 *  - the charge (the M6 marker beside the carriage's rear end, SW side) tears the side plating in: a ragged gap blown
 *    in the skirt with its rim bent in, the walkway deck above it gone, the railing over it buckled and sagging;
 *  - what the gap lost lies on the ground beside the carriage: the torn plates, crumpled, thrown out round the crater;
 *  - the hoist on the rear deck knocked over and slewed round, the shells beside it blown off the deck;
 *  - the barrel off its elevation (destroyFx 'barrelDrop'): the trunnions gave, its muzzle dropped onto the front deck.
 * A vehicle-library wreck instance (art/vehicle-library.js `wreckBuilder`): built once at load (the vehicle warm-up
 * swaps every visual to its wreck and back), so the blast only toggles visibility. Deterministic: the jags and the
 * debris are seeded by the structure id. Visual only: the gameplay footprint is the structure's own.
 * @module art/railgun-wreck
 */

import * as THREE from 'three';
import { tessellate } from './bunker-ruin.js';
import { charMaterial } from './wreck-char.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1e6) / 1e6;
}
function rngOf(seed) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}
/** Position hash (5 mm grid): the two copies of a split hard-edge corner get the same jag, so no seam opens. */
function posHash(x, y, z) {
  let h = Math.imul(Math.round(x * 200) | 0, 73856093) ^ Math.imul(Math.round(y * 200) | 0, 19349663) ^ Math.imul(Math.round(z * 200) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Barrel off its elevation: muzzle-down pitch about the trunnions (deg), slewed and rolled a little, sagged (m). */
export const BARREL_DROP = Object.freeze({ pitchDeg: 5.2, yawDeg: 1.4, rollDeg: 2.5, sag: 0.12 });

/**
 * Build the wreck instance of a K5 from its intact library instance (vehicle-library buildInstance shape).
 * @param {object} inst intact instance {model, root, lods: Map<number, THREE.Object3D>, meta}
 * @param {{id?: string, charge?: {x: number, z: number}|null, groundY?: (x: number, z: number) => number,
 *   barrelDrop?: boolean}} [ctx] charge: world point of the demolition charge (default: beside the rear end, SW side);
 *   barrelDrop false: the barrel stays on its trunnions (the structure's destroyFx without 'barrelDrop')
 * @returns {object} a wreck instance: the intact's shape + `spots` (world hot spots for addCharSpots) + `dispose()`
 */
export function buildRailgunWreck(inst, ctx = {}) {
  const seed = hash01(String(ctx.id ?? 'leopold'));
  const rnd = rngOf(seed);
  inst.root.updateWorldMatrix(true, true);
  const MW = inst.root.matrixWorld.clone(), MI = MW.clone().invert();
  const toModel = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(MI);
  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(MW);
  // model space: +z = muzzle, +x = the gun's left (NE in M6), y up, the rail head (the ground) at 0
  const groundAt = (x, z) => {
    if (!ctx.groundY) return 0;
    const w = toWorld(x, 0, z);
    const y = ctx.groundY(w.x, w.z);
    return Number.isFinite(y) ? toModel(w.x, y, w.z).y : 0;
  };
  const C = ctx.charge ? toModel(ctx.charge.x, ctx.groundY?.(ctx.charge.x, ctx.charge.z) ?? MW.elements[13], ctx.charge.z) : new THREE.Vector3(-3.5, 0, -11);
  C.y = groundAt(C.x, C.z);
  const side = C.x < 0 ? -1 : 1; // the blast side of the carriage
  const halfW = 1.9;
  const R = 4.6, A = 0.7; // reach of the blast's bending (m) and its push at the plating nearest the charge (m)
  const G = new THREE.Vector3(side * 1.6, 1.75, C.z); // the gap's centre on the side plating
  // the hole blown up through the walkway deck over it (lit from above: the damage the game camera sees best)
  const DY = [2.38, 2.8], D = new THREE.Vector3(side * 1.25, 2.55, C.z + 0.3);
  const gapPhase = seed * Math.PI * 2;

  // ---------------------------------------------------------------- deformation (a function of the original corner)
  const disp = (p, out) => {
    out.set(0, 0, 0);
    const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
    const dist = Math.hypot(dx, dy, dz);
    const f = 1 - smooth(0.6, R, dist);
    const k = smooth(0.85, 1.5, p.y); // the running gear (wheels, axle boxes) stays put
    if (f > 0 && k > 0) {
      const j = posHash(p.x, p.y, p.z);
      const a = A * f * Math.sqrt(f) * k * (0.5 + j);
      const l = Math.hypot(dx, dz) || 1;
      // away from the charge, mostly across the carriage (the charge lay beside it), lifted a little
      out.set((dx / l) * a, a * (0.22 + 0.3 * j), (dz / l) * a * 0.45);
    }
    // the gap's rim: torn petals bent in, away from the blast
    const e = gapEll(p.x, p.y, p.z);
    if (e > 0 && e < 1.55 && side * p.x > halfW - 0.75) {
      const t = 1 - smooth(1.0, 1.55, e);
      out.x -= side * 0.42 * t * (0.6 + 0.8 * posHash(p.z, p.y, p.x));
      out.y += 0.08 * t;
    }
    // the deck round its hole: torn plates curled up and back from the blast under them
    if (p.y > DY[0] && p.y < DY[1]) {
      const e2 = deckEll(p.x, p.z);
      if (e2 < 1.7) {
        const t = 1 - smooth(1.0, 1.7, e2), jj = posHash(p.x * 1.3, p.y, p.z * 0.7);
        out.y += 0.55 * t * t * (0.4 + jj);
        out.x += (p.x - D.x) * 0.25 * t;
        out.z += (p.z - D.z) * 0.18 * t;
      }
    }
    // the walkway railing over the blast buckles: bowed in, sagging (its top rail most)
    if (p.y > 2.62 && side * p.x > halfW - 0.6) {
      const w = 1 - smooth(0.6, 3.8, Math.abs(p.z - C.z));
      out.x -= side * 0.34 * w * (0.7 + 0.3 * Math.sin(p.z * 2.3));
      out.y -= 0.55 * w * Math.min(1, (p.y - 2.62) / 1.1);
    }
    return out;
  };
  /** Ellipse measure of a point round the gap centre on the side skirt (< rim = inside the hole); 0 off that side. */
  function gapEll(x, y, z) {
    if (side * x < halfW - 0.7) return 0;
    const u = (z - G.z) / 1.6, v = (y - G.y) / 0.9;
    const r = Math.hypot(u, v), ang = Math.atan2(v, u);
    const rim = 1 + 0.26 * Math.sin(ang * 5 + gapPhase) + 0.14 * Math.sin(ang * 11 + gapPhase * 1.7);
    return r / rim;
  }
  /** Ellipse measure round the deck hole's centre (plan; < 1 = inside its ragged rim). */
  function deckEll(x, z) {
    const u = (z - D.z) / 2.0, v = (x - D.x) / 1.15;
    return Math.hypot(u, v) / (1 + 0.24 * Math.sin(Math.atan2(v, u) * 4 + gapPhase) + 0.12 * Math.sin(Math.atan2(v, u) * 9 + gapPhase * 2.3));
  }
  /** Is a triangle (original model-space centroid) blown out: the plating's gap, the deck over it? */
  const blown = (c) => {
    if (c.y > 0.95 && c.y < 2.45 && gapEll(c.x, c.y, c.z) > 0 && gapEll(c.x, c.y, c.z) < 1) return true;
    return c.y > DY[0] && c.y < DY[1] && deckEll(c.x, c.z) < 1;
  };
  /** Where the tear needs fine triangles (round the holes and the hardest bending). */
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const tearZone = (a, b, c2, e) => {
    if (Math.max(a.y, b.y, c2.y) < 1.05) return false;
    // (a sliver — a trim, a rail, a weld line — is cut into lengths, not shredded: 1 → 4 splits of a 10 m strip
    // made a thousand needles of it)
    const alt = ab.subVectors(b, a).cross(ac.subVectors(c2, a)).length() / e;
    if (alt < 0.1 && e < 1.6) return false;
    const m = Math.min(a.distanceTo(C), b.distanceTo(C), c2.distanceTo(C)) - e;
    if (m < 2.2) return true;
    const mg = Math.min(a.distanceTo(G), b.distanceTo(G), c2.distanceTo(G)) - e;
    if (mg < 2.0) return true;
    const md = Math.min(Math.hypot(a.x - D.x, a.z - D.z), Math.hypot(b.x - D.x, b.z - D.z), Math.hypot(c2.x - D.x, c2.z - D.z)) - e;
    return md < 2.5 && Math.max(a.y, b.y, c2.y) > DY[0] - 0.3;
  };

  const root = new THREE.Group();
  root.name = `${inst.model}_wreck`; // (warmVehicleArt shows a visual's instance roots by name: [a-z0-9_]+)
  root.userData.warmShow = true; // (drawn by the loading screen's warm-up frame too: game.js _warmFrame)
  const owned = []; // geometries this wreck made (disposed with it)
  let bodyMat = null, paint = null, bodyVol = 0; // the carriage's material and paint (vertex colour): the debris is cut from them
  const inGun = (o) => { for (let q = o; q; q = q.parent) if (q.name === 'gun') return true; return false; };
  const srcOf = new WeakMap(); // mesh → its library material (before the charred swap)
  const lods = new Map();
  const v = new THREE.Vector3(), d3 = new THREE.Vector3(), M = new THREE.Matrix4(), MInv = new THREE.Matrix4();

  for (const [i, lod] of inst.lods) {
    const c = lod.clone(true);
    c.visible = false;
    c.userData.warmShow = true;
    root.add(c);
    lods.set(i, c);
    poseParts(c);
    root.updateMatrixWorld(true);
    // (root sits at the model origin here: matrixWorld = model space)
    c.traverse((o) => {
      if (!o.isMesh) return;
      srcOf.set(o, o.material);
      o.material = Array.isArray(o.material) ? o.material.map(charMaterial) : charMaterial(o.material);
      if (!o.geometry?.attributes?.position || o.isInstancedMesh || o.isSkinnedMesh) return;
      M.copy(o.matrixWorld);
      // only what the blast reaches is cloned and torn (the rest keeps the library's shared geometry)
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(M);
      if (bb.distanceToPoint(C) > R + 0.8 && bb.distanceToPoint(G) > 2.2 && bb.distanceToPoint(D) > 3) return;
      // (the carriage body: the biggest painted mesh off the barrel — its material and paint make the debris)
      const vol = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
      if (i === 0 && vol > bodyVol && !Array.isArray(o.material) && o.geometry.attributes.color && !inGun(o)) {
        bodyVol = vol; bodyMat = srcMaterial(o); paint = meanColour(o.geometry.attributes.color);
      }
      // (the running gear's low meshes bend a little but need no fine triangles)
      o.geometry = tear(o.geometry, M, i === 0 && bb.max.y > 1.7, o);
      owned.push(o.geometry);
    });
  }
  const deb = bodyMat ? buildDebris() : null;
  if (deb) { root.add(deb); owned.push(deb.geometry); }

  // hot spots (world): the fire along the carriage's middle and at the breech (the cordite), and the charge
  const S = (x, z, o) => { const w = toWorld(x, groundAt(x, z), z); return { x: w.x, y: w.y, z: w.z, ...o }; };
  const spots = [
    S(0, -3.2, { r: 5.2, heat: 1, h: 2.6, up: 0.55, film: 0.7 }),
    S(0, 0.2, { r: 5.0, heat: 0.95, h: 2.8, up: 0.55, film: 0.7 }),
    S(0, 3.4, { r: 4.6, heat: 0.85, h: 2.6, up: 0.6, film: 0.6 }),
    S(0, -4.6, { r: 3.8, heat: 0.9, h: 3.3, up: 0.5, film: 0.5 }),
    S(C.x * 0.55, C.z, { r: 4.2, heat: 0.95, h: 2.0, up: 0.6, film: 0.6 }),
    S(C.x, C.z, { r: 3.4, heat: 0.6, h: 0.2, up: 0.8, film: 0.35 }), // the crater: the fragments round it scorched
  ];

  return {
    model: inst.model, root, lods, parts: new Map(), partList: [], wheels: [], tracks: [], texs: [],
    meta: inst.meta ? { ...inst.meta, parts: [], toggles: {}, muzzles: [], emitters: [], destroyed: true } : null,
    sockets: {}, muzzles: [], emitters: [], lights: [], contacts: [], odo: 0, lod: -1,
    spots, charge: C.clone(), debris: deb,
    dispose() { for (const g of owned) g.dispose(); owned.length = 0; },
  };

  /** The barrel off its trunnions, the hoist knocked over (in this level of detail's clone). */
  function poseParts(c) {
    const gun = ctx.barrelDrop === false ? null : c.getObjectByName('gun');
    if (gun) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(BARREL_DROP.pitchDeg),
        THREE.MathUtils.degToRad(BARREL_DROP.yawDeg * -side), THREE.MathUtils.degToRad(BARREL_DROP.rollDeg * side), 'YXZ'));
      gun.quaternion.multiply(q);
      gun.position.y -= BARREL_DROP.sag;
    }
    const hoist = c.getObjectByName('hoist');
    if (hoist) {
      // blown over away from the charge, slewed round
      hoist.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.9, side * 0.62, 'YXZ')));
      hoist.position.x -= side * 0.15;
    }
  }

  /**
   * Tear one mesh: fine triangles round the blast (LOD0), the corners bent by `disp`, the blown triangles cut out
   * (LOD0: kept for the debris), the bent faces' normals re-lit. @returns {THREE.BufferGeometry} a new geometry
   */
  function tear(src, Mm, fine, mesh) {
    const flat = floatCopy(src.index ? src.toNonIndexed() : src);
    let g = flat;
    if (fine) {
      g = tessellate(flat, Mm, tearZone, 0.4, 5, 45000);
      flat.dispose();
    }
    const names = Object.keys(g.attributes), pos = g.attributes.position, nrm = g.attributes.normal;
    MInv.copy(Mm).invert();
    const nm = new THREE.Matrix3().getNormalMatrix(Mm), nmi = new THREE.Matrix3().getNormalMatrix(MInv);
    const n = pos.count, P0 = new Float32Array(n * 3), moved = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(Mm);
      P0[k * 3] = v.x; P0[k * 3 + 1] = v.y; P0[k * 3 + 2] = v.z;
      disp(v, d3);
      if (d3.lengthSq() > 1e-6) { v.add(d3); moved[k] = 1; v.applyMatrix4(MInv); pos.setXYZ(k, v.x, v.y, v.z); }
    }
    // blown triangles out (per material group), the rest kept in order
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    const keep = new Uint8Array(n / 3);
    const cen = new THREE.Vector3();
    let kept = 0;
    for (const gr of groups) for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
      cen.set((P0[t * 9] + P0[t * 9 + 3] + P0[t * 9 + 6]) / 3, (P0[t * 9 + 1] + P0[t * 9 + 4] + P0[t * 9 + 7]) / 3, (P0[t * 9 + 2] + P0[t * 9 + 5] + P0[t * 9 + 8]) / 3);
      if (blown(cen)) {
        continue;
      }
      keep[t] = 1; kept++;
    }
    // bent faces: their own (flat) normal, the light catching each crumple
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let t = 0; t < n / 3; t++) {
      if (!keep[t] || !(moved[t * 3] || moved[t * 3 + 1] || moved[t * 3 + 2]) || !nrm) continue;
      a.fromBufferAttribute(pos, t * 3).applyMatrix4(Mm); b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(Mm); c3.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(Mm);
      fn.subVectors(c3, b).cross(a.sub(b));
      if (fn.lengthSq() < 1e-12) continue;
      fn.normalize();
      // (keep the original side: a face the bend turned over still faces out)
      v.fromBufferAttribute(nrm, t * 3).applyMatrix3(nm);
      if (v.dot(fn) < 0) fn.negate();
      const ln = fn.clone().applyMatrix3(nmi).normalize();
      for (let k = 0; k < 3; k++) nrm.setXYZ(t * 3 + k, ln.x, ln.y, ln.z);
    }
    // compact
    const out = new THREE.BufferGeometry();
    const newGroups = [];
    const arrays = names.map((nmn) => { const at = g.attributes[nmn]; return { nmn, at, dst: new Float32Array(kept * 3 * at.itemSize), w: 0 }; });
    let cursor = 0;
    for (const gr of groups) {
      const start = cursor;
      for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
        if (!keep[t]) continue;
        for (const A2 of arrays) for (let k = 0; k < 3; k++) for (let cc = 0; cc < A2.at.itemSize; cc++) A2.dst[A2.w++] = A2.at.getComponent(t * 3 + k, cc);
        cursor += 3;
      }
      newGroups.push({ start, count: cursor - start, materialIndex: gr.materialIndex ?? 0 });
    }
    for (const A2 of arrays) out.setAttribute(A2.nmn, new THREE.Float32BufferAttribute(A2.dst, A2.at.itemSize));
    if (g.groups.length) for (const gr of newGroups) out.addGroup(gr.start, gr.count, gr.materialIndex);
    out.computeBoundingBox(); out.computeBoundingSphere();
    out.userData.shared = false;
    return out;
  }

  /** A non-indexed copy with every attribute as plain floats (the library's are quantized: KHR_mesh_quantization). */
  function floatCopy(src) {
    const g = new THREE.BufferGeometry();
    for (const [nmn, at] of Object.entries(src.attributes)) {
      if (at.array instanceof Float32Array && !at.normalized && !at.isInterleavedBufferAttribute) { g.setAttribute(nmn, at.clone()); continue; }
      const dst = new Float32Array(at.count * at.itemSize);
      for (let k = 0; k < at.count; k++) for (let cc = 0; cc < at.itemSize; cc++) dst[k * at.itemSize + cc] = at.getComponent(k, cc);
      g.setAttribute(nmn, new THREE.Float32BufferAttribute(dst, at.itemSize));
    }
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    return g;
  }

  function srcMaterial(o) { return srcOf.get(o) || o.material; }
  function meanColour(col) {
    const c = new THREE.Color(0, 0, 0), n = Math.min(col.count, 4000), step = Math.max(1, Math.floor(col.count / n));
    let k = 0;
    for (let i = 0; i < col.count; i += step, k++) { c.r += col.getX(i); c.g += col.getY(i); c.b += col.getZ(i); }
    return k ? c.multiplyScalar(1 / k) : new THREE.Color(0.05, 0.05, 0.05);
  }

  /**
   * What the blast tore off, on the ground round the crater: irregular torn plates (2 cm thick, crumpled, lying near
   * flat or propped on the rails), two bent railing bars and a buckled skirt panel leaning on the carriage — cut from
   * the carriage's own steel (its material's textures, its paint colour; no baked AO: they were not there when it was
   * baked). One mesh, one draw. @returns {THREE.Mesh}
   */
  function buildDebris() {
    const P = [], N = [], UV = [];
    const tri = (a, b, c) => {
      const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      for (const q of [a, b, c]) { P.push(q.x, q.y, q.z); N.push(n.x, n.y, n.z); UV.push(q.x * 0.9 + q.y * 0.3, q.z * 0.9 - q.y * 0.3); }
    };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    /** A torn plate: an irregular outline (r m), 2 cm thick, folded along one line, placed by `place` (local → model). */
    const plate = (r, place, fold = 0.25) => {
      const n = 7 + Math.floor(rnd() * 4), top = [], bot = [];
      const fdir = rnd() * Math.PI, fk = (rnd() - 0.5) * fold;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, rr = r * (0.55 + rnd() * 0.6) * (k % 2 ? 1 : 0.8);
        const x = Math.cos(a) * rr * 1.3, z = Math.sin(a) * rr * 0.8;
        const y = Math.max(0, x * Math.cos(fdir) + z * Math.sin(fdir)) * fk + Math.abs(x * Math.sin(fdir) - z * Math.cos(fdir)) * fk * 0.35; // folded, curled
        top.push(place(new THREE.Vector3(x, y + 0.02, z))); bot.push(place(new THREE.Vector3(x, y, z)));
      }
      const ct = place(new THREE.Vector3(0, 0.02, 0)), cb = place(new THREE.Vector3(0, 0, 0));
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        tri(ct, top[k2], top[k]); tri(cb, bot[k], bot[k2]);
        quad(top[k], top[k2], bot[k2], bot[k]);
      }
    };
    /** A bar (railing) bent in a V: length L, angle `bend`, 4 cm square. */
    const bar = (L, bend, place) => {
      const w = 0.025, seg = (x0, x1, a0) => {
        const p = (x, y, z) => { const c = Math.cos(a0), s2 = Math.sin(a0); return place(new THREE.Vector3(x * c - y * s2, x * s2 + y * c + w, z)); };
        const c = [[-w, -w], [w, -w], [w, w], [-w, w]];
        for (let k = 0; k < 4; k++) { const [y0, z0] = c[k], [y1, z1] = c[(k + 1) % 4]; quad(p(x0, y0, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z0)); }
      };
      seg(-L / 2, 0, bend); seg(0, L / 2, -bend);
    };
    const placer = (x, z, yaw, tiltX, tiltZ, lift = 0) => {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
      const y = groundAt(x, z) + lift;
      return (v) => v.applyMatrix4(m).add(new THREE.Vector3(x, y, z));
    };
    /** Settle the piece built by `fn` (corners from P[start]): its lowest corner 2 cm into the ground under it. */
    const settle = (fn) => {
      const start = P.length;
      fn();
      let lo = Infinity, cx = 0, cz = 0, n = 0;
      for (let i = start; i < P.length; i += 3) { lo = Math.min(lo, P[i + 1]); cx += P[i]; cz += P[i + 2]; n++; }
      if (!n) return;
      const dy = groundAt(cx / n, cz / n) - 0.02 - lo;
      for (let i = start + 1; i < P.length; i += 3) P[i] += dy;
    };
    // torn plates: thrown out round the crater on the blast side, a few over the carriage
    for (let k = 0; k < 13; k++) {
      const far = k >= 11;
      const ang = (rnd() - 0.5) * 2.4, dist = 1.3 + rnd() * 3.6;
      const x = far ? -side * (halfW + 0.9 + rnd() * 2.2) : C.x + side * Math.cos(ang) * dist * 0.6 - side * 0.4;
      const z = C.z + (far ? (rnd() - 0.5) * 4 : Math.sin(ang) * dist);
      if (!far && side * x > -halfW + 0.3 && side * x < halfW + 0.3) continue; // (not under the carriage)
      const r0 = 0.22 + rnd() * 0.35, pl = placer(x, z, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, 0.01);
      settle(() => plate(r0, pl, 0.9));
    }
    // a skirt panel torn off, leaning against the carriage beside its gap
    settle(() => plate(0.55, placer(side * (halfW + 0.35), C.z + 1.6, Math.PI / 2, 0, side * 1.15, 0.45), 0.15));
    // the railing that went with the deck: bent bars on the ground
    const b1 = 0.8 + rnd(), b2 = -0.4 + rnd();
    settle(() => bar(1.7, 0.45, placer(C.x + side * 0.6, C.z - 1.4, b1, 0, 0, 0)));
    settle(() => bar(1.3, 0.8, placer(C.x - side * 0.8, C.z + 2.1, b2, 0, 0, 0)));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    geo.userData.shared = false;
    const mesh = new THREE.Mesh(geo, charMaterial(debrisMaterial(bodyMat, paint)));
    mesh.name = 'wreck_debris';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.warmShow = true;
    return mesh;
  }
}

const DEBRIS_MATS = new WeakMap();
/** The carriage's material for loose debris: its textures and paint colour, no vertex colours, no baked AO (cached). */
function debrisMaterial(src, paint) {
  let m = DEBRIS_MATS.get(src);
  if (m) return m;
  m = src.clone();
  m.name = `${src.name}~debris`;
  m.vertexColors = false; m.aoMap = null; m.lightMap = null;
  if (m.color && paint) m.color.copy(paint);
  m.userData = { shared: true };
  DEBRIS_MATS.set(src, m);
  return m;
}
