/**
 * The destroyed shape of a structure with no modelled wreck (orchestrator review of the charred fallback: "a destroyed
 * target must read as destroyed at a glance from the default camera"). Its own model, burnt (art/wreck-char.js), and:
 *  - a building: its roof sags towards a seat of the fire and is holed through in ragged gaps, charred rafters across
 *    them (bent bars on a flat roof), the walls' tops pulled in; its materials drawn from both sides, so the gaps show a
 *    burnt-out inside, not the world through the far wall;
 *  - a mast, tower, gantry or column (much taller than it is wide): buckled part-way up and bent over, its top section
 *    snapped off and lying beside its foot, its wires down;
 *  - a soot skirt on the ground round its foot (and over the floor inside).
 * Built at load OFF the scene (`prepareCharRuin`: deformed geometry copies, the extras in a detached group) — nothing
 * that measures the structure (nav stamps, body solids) meets it — and drawn by the loading screen's warm-up frame; the
 * blast only swaps geometry pointers and adds the group (`apply`). Visual only; deterministic (seeded by the id).
 * @module art/char-ruin
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
function posHash(x, y, z) {
  let h = Math.imul(Math.round(x * 200) | 0, 73856093) ^ Math.imul(Math.round(y * 200) | 0, 19349663) ^ Math.imul(Math.round(z * 200) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

let SH = null;
/** Shared: the rafter timber, the bar steel, the soot skirt (one texture), never disposed with a wreck. */
function shared() {
  if (SH) return SH;
  const N = 128, data = new Uint8Array(N * N * 4), r = rngOf(0.613);
  const noise = Array.from({ length: 64 }, () => r());
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // a rounded-rectangle falloff in uv: dark over the middle (the footprint and its walls' foot), out to clean ground
    const u = Math.abs(i / (N - 1) - 0.5) * 2, v = Math.abs(j / (N - 1) - 0.5) * 2;
    const e = Math.max(0, Math.hypot(Math.max(0, u - 0.55), Math.max(0, v - 0.55)) / 0.45);
    const a = Math.atan2(v - 0.5, u - 0.5), jag = noise[Math.floor(((a + Math.PI) / (Math.PI * 2)) * 63)] * 0.35;
    const k = 1 - smooth(0.35, 1.0, e + jag * 0.6);
    const g = Math.round(255 * (1 - 0.72 * k * (0.85 + 0.15 * noise[(i * 7 + j * 13) & 63])));
    const q = (j * N + i) * 4;
    data[q] = g; data[q + 1] = Math.round(g * 0.97); data[q + 2] = Math.round(g * 0.94); data[q + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  SH = {
    // multiply-blended like the vehicles' scorch (art/vehicle-model.js) and the VFX ground decals: darkens the ground
    skirt: new THREE.MeshBasicMaterial({ name: 'wreck:soot skirt', map: tex, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rafter: new THREE.MeshStandardMaterial({ name: 'wreck:rafter timber', color: 0x5a4634, roughness: 0.9 }),
    bar: new THREE.MeshStandardMaterial({ name: 'wreck:bar steel', color: 0x5d4636, roughness: 0.8, metalness: 0.3 }),
    plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  for (const v of Object.values(SH)) if (v?.userData) v.userData.shared = true;
  return SH;
}

/** A plain float, non-indexed copy of a geometry (the library's attributes are quantized). */
function floatCopy(src0) {
  const src = src0.index ? src0.toNonIndexed() : src0;
  const g = new THREE.BufferGeometry();
  for (const [n, at] of Object.entries(src.attributes)) {
    let dst;
    if (!at.isInterleavedBufferAttribute && !at.normalized && at.array.length === at.count * at.itemSize) dst = Float32Array.from(at.array);
    else {
      dst = new Float32Array(at.count * at.itemSize);
      for (let k = 0; k < at.count; k++) for (let c = 0; c < at.itemSize; c++) dst[k * at.itemSize + c] = at.getComponent(k, c);
    }
    g.setAttribute(n, new THREE.Float32BufferAttribute(dst, at.itemSize));
  }
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  if (src !== src0) src.dispose();
  return g;
}

/**
 * Prepare the destroyed shape of `root` (in the scene, matrices current). @returns {{apply: () => void, warm: () =>
 * THREE.Object3D[], dispose: () => void, kind: string, H: number}|null} null: nothing to do (a vehicle's model, no mesh)
 * @param {THREE.Object3D} root the structure's visual
 * @param {{id?: string, x: number, z: number, w: number, d: number, rot?: number, gy: number, type?: string}} o footprint
 *   (world centre, size along its local x / z, rotation as the mission's) and the ground height there
 */
export function prepareCharRuin(root, o) {
  if (!root) return null;
  let vehicle = false;
  root.traverse((n) => { if (/^static-vehicle:/.test(n.name)) vehicle = true; });
  if (vehicle) return null; // (a boat or wagon: its library model chars; a mission settles it its own way)
  root.updateWorldMatrix(true, true);
  const meshes = [];
  const box = new THREE.Box3(), mb = new THREE.Box3();
  root.traverse((n) => {
    if (!n.isMesh || n.isSkinnedMesh || !n.geometry?.attributes?.position) return;
    meshes.push(n);
    let vis = true; for (let q = n; q && q !== root.parent; q = q.parent) if (!q.visible) { vis = false; break; }
    if (vis && !n.isInstancedMesh) { if (!n.geometry.boundingBox) n.geometry.computeBoundingBox(); box.union(mb.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld)); }
  });
  if (!meshes.length || box.isEmpty()) return null;
  const rnd = rngOf(hash01(String(o.id ?? `${o.x},${o.z}`)));
  const gy = o.gy, H = Math.max(1, box.max.y - gy), w = Math.max(1, o.w), d = Math.max(1, o.d), rot = o.rot ?? 0;
  const cx = o.x, cz = o.z, ca = Math.cos(rot), sa = Math.sin(rot);
  const loc = (x, z) => { const dx = x - cx, dz = z - cz; return [dx * ca + dz * sa, -dx * sa + dz * ca]; };
  const wor = (lx, lz) => [cx + lx * ca - lz * sa, cz + lx * sa + lz * ca];
  const tall = H > 2.2 * Math.max(w, d) && H > 4;
  const kind = tall ? 'mast' : 'building';
  const extras = new THREE.Group(); extras.name = 'char-ruin';
  const S = shared();
  const owned = [];
  const swaps = []; // [mesh, new geometry]
  const beams = { P: [], N: [], UV: [] };
  const beam = (a, b, wd, ht) => addBeam(beams, a, b, wd, ht);
  const v = new THREE.Vector3(), q = new THREE.Vector3(), inv = new THREE.Matrix4();

  // ------------------------------------------------------------------ the deformation (world space, original corner)
  let deform, removed, zoneOf, tearZone = null;
  if (!tall) {
    // the roof sags towards a seat of the fire and is holed through; the walls' tops lean in
    const su = (rnd() - 0.5) * 0.5, sv = (rnd() - 0.5) * 0.5, phase = rnd() * Math.PI * 2;
    // the roof as drawn (its upward faces: a dome, a chimney or a tower top does not make the roof that high)
    const roof = roofInfo();
    const yr0 = gy + 0.75 * (roof.lo - gy), sag = Math.min(1.6, Math.max(0.35, 0.22 * (roof.hi - gy)));
    const holes = [{ u: su, v: sv, ru: 0.44, rv: 0.4 }];
    if (Math.max(w, d) > 9) holes.push({ u: -su * 0.6 + (su > 0 ? -0.45 : 0.45), v: -sv * 0.5, ru: 0.26, rv: 0.3 });
    const holeE = (u, vv, hl) => { const a = (u - hl.u) / hl.ru, b = (vv - hl.v) / hl.rv; const ang = Math.atan2(b, a); return Math.hypot(a, b) / (1 + 0.22 * Math.sin(ang * 5 + phase) + 0.12 * Math.sin(ang * 11 + phase * 1.9)); };
    const nuv = (x, z) => { const [lx, lz] = loc(x, z); return [lx / (w / 2), lz / (d / 2)]; };
    deform = (p, out) => {
      out.copy(p);
      if (p.y <= yr0) return out;
      const [u, vv] = nuv(p.x, p.z), rr = Math.hypot(u - su, vv - sv);
      const f = 1 - smooth(0, 1.3, rr), t = smooth(yr0, Math.max(roof.hi, yr0 + 0.5), p.y), j = posHash(p.x, p.y, p.z);
      out.y -= sag * f * t * (0.75 + 0.5 * j);
      // a gap's rim: torn edges dropping into it
      for (const hl of holes) { const e = holeE(u, vv, hl); if (e < 1.5) out.y -= 0.35 * (1 - smooth(1, 1.5, e)) * t * (0.5 + j); }
      const pull = 0.05 * H * t * f;
      const dx = cx - p.x, dz = cz - p.z, dl = Math.hypot(dx, dz) || 1;
      out.x += (dx / dl) * Math.min(pull, dl * 0.08); out.z += (dz / dl) * Math.min(pull, dl * 0.08);
      return out;
    };
    // a triangle blown out: in the roof zone, facing up (a roof, not a wall), inside a gap
    removed = (c, n) => c.y > roof.lo - 0.35 && n.y > 0.2 && holes.some((hl) => { const [u, vv] = nuv(c.x, c.z); return holeE(u, vv, hl) < 1; });
    zoneOf = (bb) => bb.max.y > yr0;
    tearZone = (a, b, c2, e) => {
      if (Math.max(a.y, b.y, c2.y) < yr0) return false;
      const ab = q.subVectors(b, a), alt = v.subVectors(c2, a).cross(ab).length() / e;
      if (alt < 0.12 && e < 2.5) return false;
      // (only over a gap: its corners' plan box overlapping the gap's, grown by its rim — a big roof triangle may hold a
      // whole gap between its corners)
      const uv = [a, b, c2].map((p) => nuv(p.x, p.z));
      const u0 = Math.min(uv[0][0], uv[1][0], uv[2][0]), u1 = Math.max(uv[0][0], uv[1][0], uv[2][0]);
      const v0 = Math.min(uv[0][1], uv[1][1], uv[2][1]), v1 = Math.max(uv[0][1], uv[1][1], uv[2][1]);
      return holes.some((hl) => u1 > hl.u - hl.ru * 1.5 && u0 < hl.u + hl.ru * 1.5 && v1 > hl.v - hl.rv * 1.5 && v0 < hl.v + hl.rv * 1.5);
    };
    // rafters across the gaps (bent bars on a flat roof), at the sagged roof's height
    const flat = roof.flat;
    for (const hl of holes) {
      const along = w >= d ? 'z' : 'x'; // (across the ridge: the ridge runs along the long side)
      const span = along === 'z' ? hl.rv * d : hl.ru * w, run = along === 'z' ? hl.ru * w : hl.rv * d;
      const n = Math.max(2, Math.floor(run / (flat ? 0.45 : 0.6)));
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.25) continue; // (burnt through)
        const s = (k / (n - 1) - 0.5) * run * 0.9;
        const lu = along === 'z' ? hl.u * (w / 2) + s : hl.u * (w / 2), lv = along === 'z' ? hl.v * (d / 2) : hl.v * (d / 2) + s;
        const half = span * (0.55 + 0.1 * rnd());
        const pts = [-1, 0, 1].map((t) => {
          const ll = along === 'z' ? [lu, lv + t * half] : [lu + t * half, lv];
          const [x, z] = wor(ll[0], ll[1]);
          const vv = along === 'z' ? ll[1] / (d / 2) : ll[0] / (w / 2);
          const yRoof = flat ? roof.mid - 0.08 : roof.lo + (roof.hi - roof.lo) * (1 - Math.min(1, Math.abs(vv))) - 0.1;
          return deform(new THREE.Vector3(x, yRoof - 0.12, z), new THREE.Vector3());
        });
        if (rnd() < 0.35) pts[2].y -= 0.6 + rnd() * 0.6; // (one end burnt off its plate, hanging)
        beam(pts[0], pts[1], flat ? 0.05 : 0.11, flat ? 0.05 : 0.16);
        beam(pts[1], pts[2], flat ? 0.05 : 0.11, flat ? 0.05 : 0.16);
      }
    }
    if (beams.P.length) { const bm = beamMesh(beams, charMaterial(flat ? S.bar : S.rafter), 'char-ruin:rafters'); extras.add(bm); owned.push(bm.geometry); }
  } else {
    // buckled part-way up and bent over; the top snapped off, lying beside the foot
    const phi = rnd() * Math.PI * 2, dir = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
    const axis = new THREE.Vector3(-dir.z, 0, dir.x); // (a fall towards `dir`)
    const yb = gy + H * (0.4 + 0.15 * rnd()), th = 0.5 + 0.35 * rnd(), ys = gy + H * 0.8;
    const pivot = new THREE.Vector3(cx, yb, cz), qb = new THREE.Quaternion();
    // the snapped top: turned to lie on its side, moved down beside the foot
    const qs = new THREE.Quaternion().setFromAxisAngle(axis, 1.45 + 0.2 * rnd());
    const top = new THREE.Vector3(cx, ys, cz), drop = new THREE.Vector3().copy(dir).multiplyScalar(0.35 * H + 0.6).add(new THREE.Vector3(0, -(ys - gy) + 0.25, 0));
    deform = (p, out) => {
      if (p.y > ys) return out.copy(p).sub(top).applyQuaternion(qs).add(top).add(drop);
      out.copy(p);
      const t = smooth(yb, yb + 0.12 * H, p.y);
      if (t <= 0) return out;
      qb.setFromAxisAngle(axis, th * t);
      return out.sub(pivot).applyQuaternion(qb).add(pivot);
    };
    removed = (c) => Math.abs(c.y - ys) < Math.max(0.15, 0.025 * H); // (the break: a clean snap)
    zoneOf = (bb) => bb.max.y > yb;
  }

  // ------------------------------------------------------------------ the geometry copies
  for (const m of meshes) {
    if (m.isInstancedMesh) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (!zoneOf(mb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld))) continue;
    const Mw = m.matrixWorld;
    let g = floatCopy(m.geometry);
    if (tearZone) { const t = tessellate(g, Mw, tearZone, 0.7, 5, 30000); g.dispose(); g = t; }
    inv.copy(Mw).invert();
    const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
    const P0 = new Float32Array(n * 3), moved = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(Mw);
      P0[k * 3] = v.x; P0[k * 3 + 1] = v.y; P0[k * 3 + 2] = v.z;
      deform(v, q);
      if (q.distanceToSquared(v) > 1e-8) { moved[k] = 1; q.applyMatrix4(inv); pos.setXYZ(k, q.x, q.y, q.z); }
    }
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    const keep = new Uint8Array(n / 3), c = new THREE.Vector3(), fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(Mw), nmi = new THREE.Matrix3().getNormalMatrix(inv);
    let kept = 0;
    for (let t = 0; t < n / 3; t++) {
      c.set((P0[t * 9] + P0[t * 9 + 3] + P0[t * 9 + 6]) / 3, (P0[t * 9 + 1] + P0[t * 9 + 4] + P0[t * 9 + 7]) / 3, (P0[t * 9 + 2] + P0[t * 9 + 5] + P0[t * 9 + 8]) / 3);
      e1.set(P0[t * 9 + 3] - P0[t * 9], P0[t * 9 + 4] - P0[t * 9 + 1], P0[t * 9 + 5] - P0[t * 9 + 2]);
      e2.set(P0[t * 9 + 6] - P0[t * 9], P0[t * 9 + 7] - P0[t * 9 + 1], P0[t * 9 + 8] - P0[t * 9 + 2]);
      fn.crossVectors(e1, e2).normalize();
      if (nrm) { const nn = v.fromBufferAttribute(nrm, t * 3).applyMatrix3(nm); if (nn.dot(fn) < 0) fn.negate(); }
      if (removed(c, fn)) continue;
      keep[t] = 1; kept++;
      // a bent face lit as it now lies (its own flat normal)
      if (nrm && (moved[t * 3] | moved[t * 3 + 1] | moved[t * 3 + 2])) {
        const a = v.fromBufferAttribute(pos, t * 3).applyMatrix4(Mw).clone(), b = q.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(Mw).clone(), cc = e1.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(Mw);
        const nf = e2.subVectors(cc, b).cross(a.sub(b));
        if (nf.lengthSq() > 1e-12) {
          nf.normalize();
          const n0 = v.fromBufferAttribute(nrm, t * 3).applyMatrix3(nm);
          if (n0.dot(nf) < 0) nf.negate();
          nf.applyMatrix3(nmi).normalize();
          for (let k = 0; k < 3; k++) nrm.setXYZ(t * 3 + k, nf.x, nf.y, nf.z);
        }
      }
    }
    // (plain float arrays here — floatCopy / tessellate: a triangle's corners are one run of each array)
    const out = new THREE.BufferGeometry(), arrays = Object.entries(g.attributes).map(([nmn, at]) => ({ nmn, at, src: at.array, z: at.itemSize, dst: new Float32Array(kept * 3 * at.itemSize), w: 0 }));
    let cur = 0;
    for (const gr of groups) {
      const start = cur;
      for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) {
        if (!keep[t]) continue;
        for (const A of arrays) { const n3 = 3 * A.z; A.dst.set(A.src.subarray(t * n3, t * n3 + n3), A.w); A.w += n3; }
        cur += 3;
      }
      if (g.groups.length) out.addGroup(start, cur - start, gr.materialIndex ?? 0);
    }
    for (const A of arrays) out.setAttribute(A.nmn, new THREE.Float32BufferAttribute(A.dst, A.at.itemSize));
    g.dispose();
    out.computeBoundingBox(); out.computeBoundingSphere();
    out.userData.shared = false;
    owned.push(out);
    swaps.push([m, out]);
  }

  // ------------------------------------------------------------------ the soot skirt round its foot (and over the floor)
  {
    const sk = new THREE.Mesh(S.plane, S.skirt);
    sk.name = 'char-ruin:skirt';
    const m = tall ? 3.5 : 2.6;
    sk.scale.set(w + 2 * m, 1, d + 2 * m);
    sk.position.set(cx, gy + 0.05, cz); sk.rotation.y = -rot;
    sk.renderOrder = 2; sk.castShadow = sk.receiveShadow = false;
    sk.userData.noChar = true; // (a multiply decal: never charred)
    extras.add(sk);
  }
  const wires = [];
  root.traverse((n) => { if ((n.isLine || n.isLineSegments) && n.visible) wires.push(n); });

  let applied = false;
  const double = !tall && swaps.length > 0; // (holed: its inside shows — every face drawn from both sides)
  return {
    kind, H, double,
    /** The destroyed shape in place (the blast): geometry swapped, rafters and skirt added, wires down. */
    apply() {
      if (applied) return; applied = true;
      root.updateWorldMatrix(true, false);
      extras.matrixAutoUpdate = false;
      extras.matrix.copy(root.matrixWorld).invert();
      root.add(extras);
      extras.updateMatrixWorld(true);
      for (const [m, g] of swaps) m.geometry = g;
      for (const l of wires) l.visible = false;
    },
    /** Copies for the warm-up frame (world placed: the swapped meshes in their charred materials, the extras). */
    warm() {
      const g = new THREE.Group(); g.name = 'char-ruin-warm';
      for (const [m, geo] of swaps) {
        const mat = [].concat(m.material).map((mm) => charMaterial(mm, { double }));
        const c = new THREE.Mesh(geo, Array.isArray(m.material) ? mat : mat[0]);
        m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
        c.frustumCulled = false; g.add(c);
      }
      const e = extras.clone(true);
      e.traverse((n) => { n.frustumCulled = false; });
      g.add(e);
      return [g];
    },
    dispose() { for (const geo of owned) geo.dispose(); owned.length = 0; extras.removeFromParent(); },
  };

  /**
   * The roof as drawn: the heights of the structure's upward faces in its upper part, area-weighted — `lo` / `hi` its
   * eaves and ridge (10th / 90th percentiles), `mid` the median, `flat` most of it level.
   */
  function roofInfo() {
    const hs = [];
    let lev = 0, all = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (const m of meshes) {
      if (m.isInstancedMesh) continue;
      const p = m.geometry.attributes.position, idx = m.geometry.index, cnt = idx ? idx.count : p.count;
      const step = 3 * Math.max(1, Math.floor(cnt / 3 / 6000));
      for (let t = 0; t + 2 < cnt; t += step) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(p, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, i1).applyMatrix4(m.matrixWorld); c2.fromBufferAttribute(p, i2).applyMatrix4(m.matrixWorld);
        const cy = (a.y + b.y + c2.y) / 3;
        if (cy < gy + 0.35 * H) continue;
        n.subVectors(c2, b).cross(q.subVectors(a, b));
        const ar = n.length(); if (ar < 1e-9) continue;
        if (Math.abs(n.y) / ar < 0.3) continue;
        hs.push([cy, ar]); all += ar; if (Math.abs(n.y) / ar > 0.97) lev += ar;
      }
    }
    if (!hs.length) return { lo: gy + 0.7 * H, hi: gy + H, mid: gy + 0.85 * H, flat: false };
    hs.sort((x, y) => x[0] - y[0]);
    const pct = (f) => { let acc = 0; for (const [y, ar] of hs) { acc += ar; if (acc >= f * all) return y; } return hs[hs.length - 1][0]; };
    return { lo: pct(0.1), hi: Math.max(pct(0.9), pct(0.1) + 0.2), mid: pct(0.5), flat: lev / all > 0.6 };
  }
}

/** Append a beam (a box from `a` to `b`, `wd` wide, `ht` deep) to the buffer `B` {P, N, UV}. */
function addBeam(B, a, b, wd, ht) {
  const dirv = new THREE.Vector3().subVectors(b, a), L = dirv.length();
  if (L < 0.05) return;
  dirv.normalize();
  const side = new THREE.Vector3(-dirv.z, 0, dirv.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize().multiplyScalar(wd / 2);
  const up = new THREE.Vector3().crossVectors(side, dirv).normalize().multiplyScalar(ht / 2);
  const cen = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const c = (p, s2, u) => new THREE.Vector3().copy(p).addScaledVector(side, s2).addScaledVector(up, u);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [s0, u0] = corners[k], [s1, u1] = corners[(k + 1) % 4];
    const q0 = c(a, s0, u0), q1 = c(a, s1, u1), q2 = c(b, s1, u1), q3 = c(b, s0, u0);
    const n = new THREE.Vector3().subVectors(q2, q1).cross(new THREE.Vector3().subVectors(q0, q1)).normalize();
    const flip = n.dot(new THREE.Vector3().addVectors(q0, q2).multiplyScalar(0.5).sub(cen)) < 0;
    if (flip) n.negate();
    const tri = (x, y, z) => { for (const p of (flip ? [x, z, y] : [x, y, z])) { B.P.push(p.x, p.y, p.z); B.N.push(n.x, n.y, n.z); B.UV.push(p.x * 0.7 + p.z * 0.3, p.y * 0.7); } };
    tri(q0, q1, q2); tri(q0, q2, q3);
  }
}
/** The beams' mesh (world coordinates: the extras group carries the inverse of the structure's matrix). */
function beamMesh(B, mat, name) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.UV, 2));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.shared = false;
  const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = true; m.receiveShadow = true;
  return m;
}
