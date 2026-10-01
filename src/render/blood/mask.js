/**
 * World-space blood mask for the grass (bodies-design §B.3 "Grass"): R8 over the whole map at 8 texels per metre.
 * Pools, drops and smears are stamped on the CPU (max-accumulate); only the dirty rectangle is uploaded (texSubImage)
 * at most 4× per second. The grass shader darkens its blades red-brown where the mask is set, so blood that the
 * blades hide from the camera still reads.
 * @module render/blood/mask
 */
import * as THREE from 'three';

const PPM = 8;

export class BloodMask {
  constructor(sys) {
    this.sys = sys;
    const W = sys.world.width || sys.world.grid?.width || 128, D = sys.world.depth || sys.world.grid?.depth || 128;
    this.w = Math.min(2048, Math.ceil(W * PPM / 4) * 4); this.h = Math.min(2048, Math.ceil(D * PPM));
    this.sx = this.w / W; this.sz = this.h / D;
    this.data = new Uint8Array(this.w * this.h);
    this.cpu = new THREE.DataTexture(this.data, this.w, this.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.gpu = new THREE.DataTexture(new Uint8Array(this.w * this.h), this.w, this.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.cpu.unpackAlignment = this.gpu.unpackAlignment = 1;
    this.gpu.minFilter = this.gpu.magFilter = THREE.LinearFilter; this.gpu.generateMipmaps = false; this.gpu.needsUpdate = true;
    this.dirty = null; this.t = 0;
    this.grassU = null;
    this._attach();
  }

  /**
   * Hook the grass uniforms (the grass may be built after the blood layers: retried on every flush). Stamps are kept
   * on the CPU from the start, so blood spilt before the grass existed still stains it.
   */
  _attach() {
    if (this.grassU) return true;
    const U = this.sys.world.terrain?.terrain?.grass?.uniforms || this.sys.world.game?.mapHandle?.terrain?.grass?.uniforms || null;
    if (!U?.tBloodG) return false;
    this.grassU = U; U.tBloodG.value = this.gpu;
    this._mark(0, 0, this.w - 1, this.h - 1);
    return true;
  }

  get active() { return true; }

  _mark(i0, j0, i1, j1) {
    const d = this.dirty;
    if (!d) this.dirty = [i0, j0, i1, j1];
    else { d[0] = Math.min(d[0], i0); d[1] = Math.min(d[1], j0); d[2] = Math.max(d[2], i1); d[3] = Math.max(d[3], j1); }
  }

  /** Max-stamp a soft disc of radius r (m) and strength v (0..1). */
  disc(x, z, r, v = 1) {
    if (!this.active) return;
    const ci = x * this.sx, cj = z * this.sz, R = Math.max(0.7, r * this.sx);
    const i0 = Math.max(0, Math.floor(ci - R)), i1 = Math.min(this.w - 1, Math.ceil(ci + R));
    const j0 = Math.max(0, Math.floor(cj - R)), j1 = Math.min(this.h - 1, Math.ceil(cj + R));
    if (i1 < i0 || j1 < j0) return;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const q = Math.hypot(i + 0.5 - ci, j + 0.5 - cj) / R;
        if (q >= 1) continue;
        const k = j * this.w + i, val = Math.round(255 * v * Math.min(1, (1 - q) * 2));
        if (val > this.data[k]) this.data[k] = val;
      }
    }
    this._mark(i0, j0, i1, j1);
  }

  /** Stamp a pool's current coverage (liquid or soaked) from its flow sim. */
  pool(p) {
    const sim = p.sim;
    if (!this.active || !sim) return;
    const n = sim.n, L = n * sim.cell, c = Math.cos(p.rot), s = Math.sin(p.rot), cap = Math.max(0.5, sim.S.cap || 0.5);
    for (let j = 1; j < n - 1; j += 2) {
      for (let i = 1; i < n - 1; i += 2) {
        const k = j * n + i, v = Math.min(1, Math.max(sim.h[k] / 0.8, sim.s[k] / (cap * 0.4)));
        if (v < 0.15) continue;
        const lx = (i / n - 0.5) * L, ly = (j / n - 0.5) * L;
        this.disc(p.x + lx * c - ly * s, p.z + lx * s + ly * c, sim.cell * 1.6, v);
      }
    }
  }

  /** Stamp a smear segment. */
  line(x0, z0, x1, z1, w, v) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.06));
    for (let k = 0; k <= n; k++) this.disc(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, w * 0.5, v);
  }

  /** Upload the dirty rectangle (≤ 4 Hz). */
  flush(gl, dt = 0) {
    this.t -= dt;
    this._attach();
    if (!this.grassU || !this.dirty || !gl?.copyTextureToTexture || this.t > 0) return;
    this.t = 0.25;
    const [i0, j0, i1, j1] = this.dirty; this.dirty = null;
    gl.copyTextureToTexture(this.cpu, this.gpu, new THREE.Box2(new THREE.Vector2(i0, j0), new THREE.Vector2(i1 + 1, j1 + 1)), new THREE.Vector3(i0, j0, 0));
  }

  clear() { this.data.fill(0); this._mark(0, 0, this.w - 1, this.h - 1); }
  dispose() { if (this.grassU?.tBloodG?.value === this.gpu) this.grassU.tBloodG.value = null; this.gpu.dispose(); this.cpu.dispose(); }
}
