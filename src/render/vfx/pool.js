// GPU particle pool (from prototype C, hardened): particle state lives in a float DataTexture
// (7 texels / particle); motion is evaluated analytically in the vertex shader (drag, buoyancy,
// wind, curl noise). The CPU only allocates slots, recycles and (for the translucent pool)
// bucket-sorts live particles back-to-front in O(n).
// Budget rules: capacity per quality preset; when full, the OLDEST recyclable particle (smoke,
// sparks) is overwritten instead of silently dropping the new spawn.
import * as THREE from 'three';

/** Translucent pool modes (sorted, premultiplied, offscreen). */
export const MODE = { SMOKE: 0, FIRE: 1, FLAME: 2 };
/** Hot pool modes (additive, full resolution, unsorted). */
export const HOT = { SPARK: 0, FLASH: 1, MUZZLE: 2, TRACER: 3 };

const PER_ROW = 256, TEX_PER = 7, ROW_W = PER_ROW * TEX_PER + 1;
const NB = 1024; // sort buckets

export class ParticlePool {
  /**
   * @param {number} capacity
   * @param {THREE.ShaderMaterial} material  shares uData via uniforms.uData
   * @param {{sorted?:boolean, name?:string}} [o]
   */
  constructor(capacity, material, o = {}) {
    this.cap = Math.ceil(capacity / PER_ROW) * PER_ROW;
    this.rows = this.cap / PER_ROW;
    this.sorted = !!o.sorted;
    /** Unsorted pools that still need the live AABB (FxPass scissor rect): the ambient pool keeps a camera-independent
     *  draw order (spawn order) so pans never reshuffle overlapping wisps (no sorting flicker), but needs bounds. */
    this.bounds = !!o.bounds;
    this.data = new Float32Array(ROW_W * this.rows * 4);
    this.tex = new THREE.DataTexture(this.data, ROW_W, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.free = []; for (let i = this.cap - 1; i >= 0; i--) this.free.push(i);
    this.death = new Float32Array(this.cap);
    this.born = new Float32Array(this.cap);
    this.live = new Int32Array(this.cap); this.liveCount = 0;
    this.order = new Float32Array(this.cap);
    this.dirtyMin = new Int32Array(this.rows).fill(1e9); this.dirtyMax = new Int32Array(this.rows).fill(-1);
    this.recycled = 0; this.dropped = 0; this._ev = 0;
    this._keys = new Float32Array(this.cap); this._bk = new Int32Array(this.cap);
    this._cnt = new Int32Array(NB + 1);
    this.box = new THREE.Box3(); this.maxSize = 0;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.idxAttr = new THREE.InstancedBufferAttribute(this.order, 1);
    this.idxAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('pidx', this.idxAttr);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = material;
    material.uniforms.uData = { value: this.tex };
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = o.name || 'vfx-pool';
  }

  /** Emit one particle at sim time t. Returns slot or -1. */
  emit(t, p) {
    let i;
    if (this.free.length) { i = this.free.pop(); this.live[this.liveCount++] = i; }
    else {
      // recycle the oldest live particle (live[] is kept in spawn order by the stable compaction)
      if (this.liveCount === 0) { this.dropped++; return -1; }
      i = this.live[this._ev % this.liveCount]; this._ev++; this.recycled++;
    }
    const row = (i / PER_ROW) | 0, col = (i % PER_ROW) * TEX_PER;
    const o = (row * ROW_W + col) * 4, d = this.data;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = t;
    d[o + 4] = p.vx || 0; d[o + 5] = p.vy || 0; d[o + 6] = p.vz || 0; d[o + 7] = p.life;
    d[o + 8] = p.s0; d[o + 9] = p.s1 ?? p.s0; d[o + 10] = p.drag ?? 0.5; d[o + 11] = p.buoy ?? 0;
    d[o + 12] = p.r ?? 0.1; d[o + 13] = p.g ?? 0.1; d[o + 14] = p.b ?? 0.1; d[o + 15] = p.op ?? 1;
    d[o + 16] = p.temp ?? 0; d[o + 17] = p.cool ?? 1; d[o + 18] = p.noise ?? 0; d[o + 19] = p.rot ?? 0;
    d[o + 20] = p.mode ?? 0; d[o + 21] = p.seed ?? 0.5; d[o + 22] = p.stretch ?? 0; d[o + 23] = p.wind ?? 1;
    d[o + 24] = p.shape ?? 0; d[o + 25] = p.erode ?? 0; d[o + 26] = p.fin ?? 0.12; d[o + 27] = p.aux ?? 0;
    if (col < this.dirtyMin[row]) this.dirtyMin[row] = col;
    if (col + TEX_PER > this.dirtyMax[row]) this.dirtyMax[row] = col + TEX_PER;
    this.death[i] = t + p.life; this.born[i] = t;
    return i;
  }

  /** CPU mirror of the vertex-shader motion (no curl noise) for sorting. */
  _pos(i, t, wind, out) {
    const row = (i / PER_ROW) | 0, o = (row * ROW_W + (i % PER_ROW) * TEX_PER) * 4, d = this.data;
    const age = t - d[o + 3], k = Math.max(d[o + 10], 1e-3), e = Math.exp(-k * age);
    const f1 = (1 - e) / k, f2 = (age - f1) / k, wf = d[o + 23];
    out[0] = d[o] + d[o + 4] * f1 + k * wind.x * wf * f2;
    out[1] = d[o + 1] + d[o + 5] * f1 + d[o + 11] * f2;
    out[2] = d[o + 2] + d[o + 6] * f1 + k * wind.z * wf * f2;
  }

  update(t, camera, wind) {
    let n = 0;
    for (let j = 0; j < this.liveCount; j++) {
      const i = this.live[j];
      if (t >= this.death[i]) this.free.push(i); else this.live[n++] = i;
    }
    this.liveCount = n; this._ev = 0;
    for (let r = 0; r < this.rows; r++) {
      if (this.dirtyMax[r] < 0) continue;
      this.tex.addUpdateRange((r * ROW_W + this.dirtyMin[r]) * 4, (this.dirtyMax[r] - this.dirtyMin[r]) * 4);
      this.dirtyMin[r] = 1e9; this.dirtyMax[r] = -1; this.tex.needsUpdate = true;
    }
    this.box.makeEmpty(); this.maxSize = 0;
    if (this.sorted && n > 1) this._sort(t, camera, wind, n);
    else {
      for (let j = 0; j < n; j++) this.order[j] = this.live[j];
      if (this.bounds) for (let j = 0; j < n; j++) { const i = this.live[j]; this._pos(i, t, wind, _p); this.box.expandByPoint(_v.set(_p[0], _p[1], _p[2])); this._ms(i); }
    }
    if (this.sorted && n === 1) { this._pos(this.live[0], t, wind, _p); this.box.expandByPoint(_v.set(_p[0], _p[1], _p[2])); this._ms(this.live[0]); }
    this.idxAttr.clearUpdateRanges(); this.idxAttr.addUpdateRange(0, Math.max(n, 1)); this.idxAttr.needsUpdate = true;
    this.geometry.instanceCount = n;
  }

  /** O(n) back-to-front bucket sort along the camera forward axis (1024 buckets). */
  _sort(t, camera, wind, n) {
    const fwd = camera.getWorldDirection(_v), p = _p, keys = this._keys, bk = this._bk, cnt = this._cnt;
    let lo = 1e30, hi = -1e30;
    for (let j = 0; j < n; j++) {
      this._pos(this.live[j], t, wind, p);
      const dz = p[0] * fwd.x + p[1] * fwd.y + p[2] * fwd.z; keys[j] = dz;
      const bx = this.box; if (p[0] < bx.min.x) bx.min.x = p[0]; if (p[0] > bx.max.x) bx.max.x = p[0]; if (p[1] < bx.min.y) bx.min.y = p[1]; if (p[1] > bx.max.y) bx.max.y = p[1];
      if (p[2] < bx.min.z) bx.min.z = p[2]; if (p[2] > bx.max.z) bx.max.z = p[2]; this._ms(this.live[j]);
      if (dz < lo) lo = dz; if (dz > hi) hi = dz;
    }
    const sc = (NB - 1) / Math.max(hi - lo, 1e-3);
    cnt.fill(0);
    for (let j = 0; j < n; j++) { const b = NB - 1 - ((keys[j] - lo) * sc | 0); bk[j] = b; cnt[b + 1]++; } // far (large dz) first
    for (let b = 0; b < NB; b++) cnt[b + 1] += cnt[b];
    for (let j = 0; j < n; j++) this.order[cnt[bk[j]]++] = this.live[j];
  }

  _ms(i) { const o = (((i / PER_ROW) | 0) * ROW_W + (i % PER_ROW) * TEX_PER) * 4, d = this.data;
    const m = Math.max(d[o + 8], d[o + 9]) * (d[o + 20] > 1.5 ? Math.max(d[o + 27], 1) : 1) * (1 + d[o + 22] * 4); if (m > this.maxSize) this.maxSize = m; }
  clear() { this.liveCount = 0; this.free.length = 0; for (let i = this.cap - 1; i >= 0; i--) this.free.push(i); this.geometry.instanceCount = 0; }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.tex.dispose(); }
}
const _v = new THREE.Vector3(), _p = [0, 0, 0];
