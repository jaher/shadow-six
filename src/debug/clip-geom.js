/**
 * Clipping audit geometry: triangle-exact overlap measurement between two "items" (sets of mesh parts with world
 * matrices) using three-mesh-bvh (vendor/three-mesh-bvh, MIT). Game geometry is never modified: every BVH is built
 * over a Float32 copy of the positions (quantized / interleaved GLB attributes are decoded by getX/Y/Z).
 * Measurement of a pair: intersection segments (triangle/triangle) → contact length, centre and box; penetration
 * depth = deepest vertex of one item behind the nearest surface of the other (≤ maxDepth search); volume = Monte
 * Carlo estimate inside both. One-sided categories (THIN: cards, cloth, fences) are not used as "inside" references.
 * @module debug/clip-geom
 */
import * as THREE from 'three';
import { MeshBVH } from '../../vendor/three-mesh-bvh/index.module.js';

const CACHE = new WeakMap();

/** Float32 position/index copy of a geometry (no attributes shared with the game). */
function copyGeometry(geo, positionOf = null) {
  const src = geo.attributes.position;
  const n = src.count, pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (positionOf) positionOf(i, v); else v.fromBufferAttribute(src, i);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (geo.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(geo.index.array), 1));
  else if (n % 3) return null;
  g.computeBoundingBox();
  return g;
}

/** Cached BVH of a static geometry (null when it has no triangles). */
export function geometryBVH(geo) {
  if (CACHE.has(geo)) return CACHE.get(geo);
  let r = null;
  const tri = geo?.attributes?.position && (geo.index ? geo.index.count : geo.attributes.position.count) >= 3;
  if (tri) {
    const g = copyGeometry(geo);
    if (g) r = { geo: g, bvh: new MeshBVH(g, { maxLeafSize: 8 }) };
  }
  CACHE.set(geo, r);
  return r;
}

/** One-off BVH of a skinned / morphed mesh in its current pose (mesh-local space, bind matrix applied). */
export function posedBVH(mesh) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.position) return null;
  const g = copyGeometry(geo, (i, v) => mesh.getVertexPosition(i, v));
  return g ? { geo: g, bvh: new MeshBVH(g, { maxLeafSize: 8 }) } : null;
}

/** Build a part {bvh, geo, matrix, inv, box, flip} from a BVH record and a world matrix. */
export function makePart(rec, matrix, extra = {}) {
  const m = matrix.clone();
  const box = rec.geo.boundingBox.clone().applyMatrix4(m);
  return { ...rec, matrix: m, inv: m.clone().invert(), box, flip: m.determinant() < 0, ...extra };
}

/** Union box of an item's parts. */
export function itemBox(parts) {
  const b = new THREE.Box3();
  for (const p of parts) b.union(p.box);
  return b;
}

const _line = new THREE.Line3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * Intersection segments between two parts (world space). Stops after `cap` segments.
 * @returns {{n:number, length:number, cx:number, cy:number, cz:number, box:THREE.Box3}}
 */
export function partContacts(pa, pb, acc, cap = 1500) {
  _m.multiplyMatrices(pa.inv, pb.matrix); // B local → A local
  pa.bvh.bvhcast(pb.bvh, _m, {
    intersectsTriangles(t1, t2) {
      if (!t1.intersectsTriangle(t2, _line)) return false;
      _a.copy(_line.start).applyMatrix4(pa.matrix); _b.copy(_line.end).applyMatrix4(pa.matrix);
      const len = _a.distanceTo(_b), w = Math.max(len, 1e-4);
      acc.n++; acc.length += len; acc.w += w;
      acc.cx += (_a.x + _b.x) * 0.5 * w; acc.cy += (_a.y + _b.y) * 0.5 * w; acc.cz += (_a.z + _b.z) * 0.5 * w;
      acc.box.expandByPoint(_a); acc.box.expandByPoint(_b);
      return acc.n >= cap;
    },
  });
  return acc;
}

const _q = new THREE.Vector3(), _lp = new THREE.Vector3(), _n = new THREE.Vector3(), _tri = new THREE.Triangle();
const _hit = {}, _ray = new THREE.Ray(), _o = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3();
/** Vote directions (slightly skewed off the axes so rays do not graze edges / coplanar faces). */
const DIRS = [new THREE.Vector3(0.03, 1, 0.02), new THREE.Vector3(1, 0.12, 0.07), new THREE.Vector3(-0.08, 0.1, -1)].map((v) => v.normalize());

/** Does the first surface hit from `p` along world `dir` face away from the ray (i.e. `p` is behind it)? */
function backHit(p, dir, parts, far) {
  let best = Infinity, inside = false;
  for (const part of parts) {
    _o.copy(p).applyMatrix4(part.inv);
    _e.copy(p).addScaledVector(dir, 1).applyMatrix4(part.inv).sub(_o);
    const scale = _e.length();
    _ray.origin.copy(_o); _ray.direction.copy(_e).divideScalar(scale);
    const h = part.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far * scale);
    if (!h) continue;
    const dist = h.distance / scale;
    if (dist >= best) continue;
    best = dist;
    const s = h.face.normal.dot(_ray.direction);
    inside = part.flip ? s < 0 : s > 0;
  }
  return inside;
}

/**
 * Penetration of world point `p` into an item: distance to its nearest surface (≤ maxD) when `p` is inside — behind
 * that surface (outward = triangle winding) AND behind the first surface along ≥ 2 of 3 probe rays (open shells,
 * slabs without a bottom and single planes then do not swallow points that are merely below/behind them) — else 0.
 */
export function insideDepth(p, parts, maxD) {
  let nearest = Infinity, behind = false;
  for (const part of parts) {
    if (part.box.distanceToPoint(p) > maxD) continue;
    _lp.copy(p).applyMatrix4(part.inv);
    const sc = Math.cbrt(Math.abs(part.matrix.determinant())) || 1;
    const r = part.bvh.closestPointToPoint(_lp, _hit, 0, (maxD / sc) * 1.5);
    if (!r) continue;
    _q.copy(_hit.point).applyMatrix4(part.matrix);
    const d = _q.distanceTo(p);
    if (d >= nearest || d > maxD) continue;
    nearest = d;
    const g = part.geo, idx = g.index, pos = g.attributes.position, f = _hit.faceIndex * 3;
    const i0 = idx ? idx.getX(f) : f, i1 = idx ? idx.getX(f + 1) : f + 1, i2 = idx ? idx.getX(f + 2) : f + 2;
    _tri.a.fromBufferAttribute(pos, i0); _tri.b.fromBufferAttribute(pos, i1); _tri.c.fromBufferAttribute(pos, i2);
    _tri.getNormal(_n);
    let s = _n.dot(_w.copy(_lp).sub(_hit.point));
    if (part.flip) s = -s;
    behind = s < 0;
  }
  if (!behind) return 0;
  let votes = 0;
  for (const dir of DIRS) if (backHit(p, dir, parts, 60) && ++votes >= 2) return nearest;
  return 0;
}

/** Deepest vertex of `from` parts (inside `region`) behind the surface of `into` parts. */
function deepest(from, into, region, maxD, maxVerts) {
  let depth = 0, inside = 0;
  const p = new THREE.Vector3();
  for (const part of from) {
    if (!part.box.intersectsBox(region)) continue;
    const pos = part.geo.attributes.position, n = pos.count;
    const stride = Math.max(1, Math.floor(n / maxVerts));
    for (let i = 0; i < n; i += stride) {
      p.fromBufferAttribute(pos, i).applyMatrix4(part.matrix);
      if (!region.containsPoint(p)) continue;
      const d = insideDepth(p, into, maxD);
      if (d > 0) { inside++; if (d > depth) depth = d; }
    }
  }
  return { depth, inside };
}

/**
 * Measure the overlap of two items ({cat, parts}). Returns null when no surfaces intersect.
 * @param {{thinA?:boolean, thinB?:boolean, maxDepth?:number, maxVerts?:number, samples?:number}} [o]
 * @returns {{point:{x,y,z}, box:{min:number[],max:number[]}, contact:number, segments:number, depth:number,
 *   depthAinB:number, depthBinA:number, volume:number}|null}
 */
export function measurePair(A, B, o = {}) {
  const acc = { n: 0, length: 0, w: 0, cx: 0, cy: 0, cz: 0, box: new THREE.Box3() };
  for (const pa of A.parts) for (const pb of B.parts) {
    if (!pa.box.intersectsBox(pb.box)) continue;
    partContacts(pa, pb, acc);
    if (acc.n >= 1500) break;
  }
  if (!acc.n) return null;
  const maxD = o.maxDepth ?? 1.5;
  const region = acc.box.clone().expandByScalar(maxD);
  const ab = o.thinB ? { depth: 0, inside: 0 } : deepest(A.parts, B.parts, region, maxD, o.maxVerts ?? 4000);
  const ba = o.thinA ? { depth: 0, inside: 0 } : deepest(B.parts, A.parts, region, maxD, o.maxVerts ?? 4000);
  const depth = Math.max(ab.depth, ba.depth);
  let volume = 0;
  if (!o.thinA && !o.thinB && depth > 0.01) {
    const vb = acc.box.clone().expandByScalar(Math.min(depth, maxD));
    const size = vb.getSize(new THREE.Vector3()), N = o.samples ?? 192, p = new THREE.Vector3();
    let hit = 0, s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < N; k++) {
      p.set(vb.min.x + rnd() * size.x, vb.min.y + rnd() * size.y, vb.min.z + rnd() * size.z);
      if (insideDepth(p, A.parts, maxD) > 0 && insideDepth(p, B.parts, maxD) > 0) hit++;
    }
    volume = (hit / N) * size.x * size.y * size.z;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    point: { x: r3(acc.cx / acc.w), y: r3(acc.cy / acc.w), z: r3(acc.cz / acc.w) },
    box: { min: acc.box.min.toArray().map(r3), max: acc.box.max.toArray().map(r3) },
    contact: r3(acc.length), segments: acc.n, depth: r3(depth), depthAinB: r3(ab.depth), depthBinA: r3(ba.depth),
    insideA: ab.inside, insideB: ba.inside, volume: r3(volume),
  };
}
