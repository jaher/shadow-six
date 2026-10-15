/**
 * Big geometry built as sliced jobs (engine/slice.js): three's own constructions, replicated operation for operation so
 * the result is the same down to the bit, with pauses between rows. The map's terrain heightfield (641 k vertices on a
 * 200 m map) cost ~0.45 s for the PlaneGeometry constructor, 0.13 s for computeVertexNormals, in one task each.
 *
 *   const geo = yield* planeGeometryG(W, D, sx, sz);   // = new THREE.PlaneGeometry(W, D, sx, sz)
 *   yield* applyMatrixToPositionsG(geo, m);            // = the position part of geo.applyMatrix4(m)
 *   yield* computeVertexNormalsG(geo);                 // = geo.computeVertexNormals()
 * @module engine/geometry-jobs
 */
import * as THREE from 'three';
import { due } from './slice.js';

/**
 * new THREE.PlaneGeometry(width, height, widthSegments, heightSegments), built a row at a time: the same vertex,
 * normal, uv and index values in the same attribute types, created in the same order (a PlaneGeometry instance).
 * @returns {Generator<void, THREE.PlaneGeometry>}
 */
export function* planeGeometryG(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
  const geo = new THREE.BufferGeometry();
  Object.setPrototypeOf(geo, THREE.PlaneGeometry.prototype);
  geo.type = 'PlaneGeometry';
  geo.parameters = { width, height, widthSegments, heightSegments };
  const width_half = width / 2, height_half = height / 2;
  const gridX = Math.floor(widthSegments), gridY = Math.floor(heightSegments);
  const gridX1 = gridX + 1, gridY1 = gridY + 1;
  const segment_width = width / gridX, segment_height = height / gridY;
  const nv = gridX1 * gridY1;
  const vertices = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  let v = 0;
  for (let iy = 0; iy < gridY1; iy++) {
    const y = iy * segment_height - height_half;
    for (let ix = 0; ix < gridX1; ix++) {
      const x = ix * segment_width - width_half;
      vertices[v * 3] = x; vertices[v * 3 + 1] = -y; vertices[v * 3 + 2] = 0;
      normals[v * 3 + 2] = 1;
      uvs[v * 2] = ix / gridX; uvs[v * 2 + 1] = 1 - (iy / gridY);
      v++;
    }
    if (due()) yield;
  }
  // (three's setIndex(array): Uint32 when an index reaches 65535 — the last vertex is always used)
  const big = nv - 1 >= 65535, indices = new (big ? Uint32Array : Uint16Array)(gridX * gridY * 6);
  let k = 0;
  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const a = ix + gridX1 * iy, b = ix + gridX1 * (iy + 1), c = (ix + 1) + gridX1 * (iy + 1), d = (ix + 1) + gridX1 * iy;
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
    if (due()) yield;
  }
  geo.setIndex(new (big ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute)(indices, 1));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

const _v = new THREE.Vector3();
/**
 * The position part of geometry.applyMatrix4(m) (rotateX / translate …): every vertex through Vector3.applyMatrix4,
 * as BufferAttribute.applyMatrix4 does. Normals are left as they are — callers recompute them (computeVertexNormalsG
 * zeroes them first), and a fresh geometry has no bounding volumes to refresh.
 */
export function* applyMatrixToPositionsG(geo, m) {
  const p = geo.attributes.position;
  for (let i = 0, il = p.count; i < il; i++) {
    _v.fromBufferAttribute(p, i);
    _v.applyMatrix4(m);
    p.setXYZ(i, _v.x, _v.y, _v.z);
    if ((i & 16383) === 16383 && due()) yield;
  }
  p.needsUpdate = true;
}

/** geometry.computeVertexNormals() (three r186), pausing between blocks of faces. */
export function* computeVertexNormalsG(geo) {
  const index = geo.index, positionAttribute = geo.getAttribute('position');
  if (positionAttribute === undefined) return;
  let normalAttribute = geo.getAttribute('normal');
  if (normalAttribute === undefined || normalAttribute.count !== positionAttribute.count) {
    normalAttribute = new THREE.BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
    geo.setAttribute('normal', normalAttribute);
  } else {
    for (let i = 0, il = normalAttribute.count; i < il; i++) {
      normalAttribute.setXYZ(i, 0, 0, 0);
      if ((i & 65535) === 65535 && due()) yield;
    }
  }
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  if (index) {
    for (let i = 0, il = index.count; i < il; i += 3) {
      const vA = index.getX(i + 0), vB = index.getX(i + 1), vC = index.getX(i + 2);
      pA.fromBufferAttribute(positionAttribute, vA);
      pB.fromBufferAttribute(positionAttribute, vB);
      pC.fromBufferAttribute(positionAttribute, vC);
      cb.subVectors(pC, pB);
      ab.subVectors(pA, pB);
      cb.cross(ab);
      nA.fromBufferAttribute(normalAttribute, vA);
      nB.fromBufferAttribute(normalAttribute, vB);
      nC.fromBufferAttribute(normalAttribute, vC);
      nA.add(cb);
      nB.add(cb);
      nC.add(cb);
      normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
      normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
      normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
      if ((i % 49152) === 49149 && due()) yield;
    }
  } else {
    for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
      pA.fromBufferAttribute(positionAttribute, i + 0);
      pB.fromBufferAttribute(positionAttribute, i + 1);
      pC.fromBufferAttribute(positionAttribute, i + 2);
      cb.subVectors(pC, pB);
      ab.subVectors(pA, pB);
      cb.cross(ab);
      normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z);
      normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z);
      normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
      if ((i % 49152) === 49149 && due()) yield;
    }
  }
  // normalizeNormals()
  const normals = geo.attributes.normal;
  for (let i = 0, il = normals.count; i < il; i++) {
    _v.fromBufferAttribute(normals, i);
    _v.normalize();
    normals.setXYZ(i, _v.x, _v.y, _v.z);
    if ((i & 32767) === 32767 && due()) yield;
  }
  normalAttribute.needsUpdate = true;
}
