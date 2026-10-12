/**
 * Per-render extra culling for three.js (render efficiency). three culls an object against the camera frustum only
 * (`object.intersectsFrustum(frustum)`); some renders know more about what can show: the water mirror only needs what
 * can reflect onto visible water. `withExtraCull(pred, fn)` runs `fn` (one or more renderer.render calls) with
 * `pred(object) → boolean` ANDed into that test for meshes, lines, points and sprites (installed once on their
 * prototypes; with no predicate active the cost is one null check). Objects drawn with frustumCulled = false are never
 * tested, as in three.
 *
 * `WorldBoxes` caches world-space boxes of static objects against their world matrix (shared by the cull tests).
 * @module engine/cull-hooks
 */
import * as THREE from 'three';

let active = null;

/** The predicate of the render in progress (null outside withExtraCull). */
export const extraCull = (o) => active === null || active(o);

/** Run fn with an extra cull predicate (nested calls AND together). */
export function withExtraCull(pred, fn) {
  installCullHooks();
  const prev = active;
  active = prev ? (o) => prev(o) && pred(o) : pred;
  try { return fn(); } finally { active = prev; }
}

let installed = false;
/** Patch Mesh / Line / Points / Sprite intersectsFrustum (idempotent). */
export function installCullHooks() {
  if (installed) return;
  installed = true;
  for (const C of [THREE.Mesh, THREE.Line, THREE.Points, THREE.Sprite]) {
    const orig = C.prototype.intersectsFrustum;
    C.prototype.intersectsFrustum = function intersectsFrustumExtra(frustum) {
      return orig.call(this, frustum) && (active === null || active(this));
    };
  }
}

/** World boxes of objects, cached while their world matrix and source bounds are unchanged. */
export class WorldBoxes {
  constructor() { this.cache = new WeakMap(); }

  /** World box of a mesh-like object, or null for posed / screen-facing ones (skinned, sprites). */
  get(o) {
    let src = null, ver = 0;
    if (o.isInstancedMesh || o.isBatchedMesh) {
      if (o.boundingBox === null) o.computeBoundingBox();
      src = o.boundingBox;
      ver = o.isInstancedMesh ? o.instanceMatrix.version : 0;
    } else if (o.isSkinnedMesh || o.isSprite || !o.geometry) {
      return null;
    } else {
      const g = o.geometry;
      if (g.boundingBox === null) g.computeBoundingBox();
      src = g.boundingBox;
    }
    if (!src) return null;
    const e = o.matrixWorld.elements;
    let c = this.cache.get(o);
    if (c && c.src === src && c.ver === ver && c.a === src.min.x && c.b === src.max.y && c.d === src.max.z) {
      let same = true;
      for (let i = 0; i < 16; i++) if (c.e[i] !== e[i]) { same = false; break; }
      if (same) return c.box;
    }
    if (!c) this.cache.set(o, (c = { e: new Float64Array(16), box: new THREE.Box3() }));
    c.src = src; c.ver = ver; c.a = src.min.x; c.b = src.max.y; c.d = src.max.z;
    for (let i = 0; i < 16; i++) c.e[i] = e[i];
    c.box.copy(src).applyMatrix4(o.matrixWorld);
    return c.box;
  }

  /** World box, falling back to the bounding sphere's box (skinned, sprites). `out` is used for the fallback. */
  getOrSphere(o, out) {
    const b = this.get(o);
    if (b) return b;
    const s = o.boundingSphere !== undefined ? (o.boundingSphere === null && o.computeBoundingSphere?.(), o.boundingSphere)
      : (o.geometry?.boundingSphere === null && o.geometry.computeBoundingSphere(), o.geometry?.boundingSphere);
    if (!s) return null;
    _sph.copy(s).applyMatrix4(o.matrixWorld);
    return out.set(_v1.copy(_sph.center).subScalar(_sph.radius), _v2.copy(_sph.center).addScalar(_sph.radius));
  }
}
const _sph = new THREE.Sphere(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
