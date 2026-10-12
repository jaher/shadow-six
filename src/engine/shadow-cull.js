/**
 * Sun shadow caster culling by shadow reach. three.js draws into the shadow map every caster inside the shadow camera's
 * box, which is fitted to the view's ground footprint plus room for 16 m tall casters on the sun side, so grass chunks,
 * props and roofs whose shadows land off screen are drawn too. A caster matters only if its shadow can fall on
 * something the frame shows: here each caster's world box is swept along the sun direction down to `groundMin` and
 * tested against the frustum of every receiving view (the game camera, the water mirror cameras), widened by `pad`
 * metres (PCF filter radius, normal bias, texel snapping). Casters that fail are skipped; nothing visible changes.
 *
 * Mechanism: the sun shadow's own Frustum instance (`shadow.getFrustum()`, the one WebGLShadowMap culls with) gets
 * instance overrides of intersectsObject / intersectsBox / intersectsSprite that AND the stock test with the reach
 * test while `enabled`. World boxes of static casters are cached against their world matrix.
 * @module engine/shadow-cull
 */
import * as THREE from 'three';

const _sbox = new THREE.Box3();
const _swept = new THREE.Box3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _sph = new THREE.Sphere();
const _m = new THREE.Matrix4();

export class ShadowReachCull {
  /** @param {THREE.DirectionalLight} light */
  constructor(light) {
    this.light = light;
    this.enabled = false;
    /** Unit vector from the ground towards the sun. */
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.groundMin = -3;
    this.pad = 1.5;
    this.views = []; // THREE.Frustum[]
    this._pool = [];
    this._cache = new WeakMap(); // object → {src, e: Float64Array(16), ver, box}
    this.stats = { tested: 0, culled: 0 };
    const f = light.shadow.getFrustum();
    const obj = f.intersectsObject.bind(f), box = f.intersectsBox.bind(f), sprite = f.intersectsSprite.bind(f);
    f.intersectsObject = (o) => obj(o) && (!this.enabled || this._reachObject(o));
    f.intersectsBox = (b) => box(b) && (!this.enabled || this._reachBox(b));
    f.intersectsSprite = (s) => sprite(s) && (!this.enabled || this._reachObject(s));
    this.frustum = f;
  }

  /**
   * Receiving views for the next shadow render (their world matrices must be current).
   * @param {(THREE.Camera|{camera: THREE.Camera, pad?: number})[]} cameras (null / [] disables the culling)
   * @param {THREE.Vector3} sunDir unit, ground → sun
   */
  setViews(cameras, sunDir) {
    const cams = cameras || [];
    this.enabled = cams.length > 0 && sunDir.y > 0.05;
    if (!this.enabled) return;
    this.sunDir.copy(sunDir);
    while (this._pool.length < cams.length) this._pool.push(new THREE.Frustum());
    this.views.length = 0;
    for (let i = 0; i < cams.length; i++) {
      if (!cams[i]) continue;
      const c = cams[i].camera || cams[i], pad = cams[i].pad ?? this.pad, f = this._pool[i];
      if (!c.projectionMatrix) { this.enabled = false; return; }
      _m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      f.setFromProjectionMatrix(_m, c.coordinateSystem, c.reversedDepth);
      for (const p of f.planes) p.constant += pad;
      this.views.push(f);
    }
  }

  /** World box of a caster (cached for static ones). */
  _worldBox(o) {
    let src = null, ver = 0;
    if (o.isInstancedMesh || o.isBatchedMesh) {
      if (o.boundingBox === null) o.computeBoundingBox();
      src = o.boundingBox;
      ver = o.isInstancedMesh ? o.instanceMatrix.version : 0;
    } else if (o.isSkinnedMesh || o.isSprite || !o.geometry) {
      return null; // posed / screen-facing: the sphere three uses
    } else {
      const g = o.geometry;
      if (g.boundingBox === null) g.computeBoundingBox();
      src = g.boundingBox;
    }
    const e = o.matrixWorld.elements;
    let c = this._cache.get(o);
    if (c && c.src === src && c.ver === ver && c.min0 === src.min.x && c.max1 === src.max.y) {
      let same = true;
      for (let i = 0; i < 16; i++) if (c.e[i] !== e[i]) { same = false; break; }
      if (same) return c.box;
    }
    if (!c) this._cache.set(o, (c = { e: new Float64Array(16), box: new THREE.Box3() }));
    c.src = src; c.ver = ver; c.min0 = src.min.x; c.max1 = src.max.y;
    for (let i = 0; i < 16; i++) c.e[i] = e[i];
    c.box.copy(src).applyMatrix4(o.matrixWorld);
    return c.box;
  }

  _reachObject(o) {
    let b = this._worldBox(o);
    if (!b) {
      const s = o.boundingSphere !== undefined ? (o.boundingSphere === null && o.computeBoundingSphere?.(), o.boundingSphere) : (o.geometry?.boundingSphere === null && o.geometry.computeBoundingSphere(), o.geometry?.boundingSphere);
      if (!s) return true;
      _sph.copy(s).applyMatrix4(o.matrixWorld);
      b = _sbox.set(_v1.copy(_sph.center).subScalar(_sph.radius), _v2.copy(_sph.center).addScalar(_sph.radius));
    }
    return this._reachBox(b);
  }

  /** Can a shadow cast by anything inside world box `b` land in a receiving view? */
  _reachBox(b) {
    this.stats.tested++;
    if (b.isEmpty()) return true;
    const L = this.sunDir, t = Math.max(0, (b.max.y - this.groundMin) / L.y);
    _swept.copy(b);
    _swept.expandByPoint(_v1.set(b.min.x - L.x * t, Math.min(b.min.y, this.groundMin), b.min.z - L.z * t));
    _swept.expandByPoint(_v1.set(b.max.x - L.x * t, this.groundMin, b.max.z - L.z * t));
    for (const f of this.views) if (f.intersectsBox(_swept)) return true;
    this.stats.culled++;
    return false;
  }
}
