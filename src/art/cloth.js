/**
 * Small Verlet cloth (step 4w) for flags, banners and hanging laundry: a regular nx × ny particle grid in the mesh's
 * LOCAL frame (writes straight into a PlaneGeometry's position/normal attributes), structural + shear + bend
 * constraints, gravity and a per-triangle aerodynamic force from the relative wind:
 *   F = ½ ρ A [Cn (v_r·n̂)|v_r·n̂| n̂ + Ct v_r]   (normal pressure + skin friction)
 * so a flag hangs slack in calm air (wool bunting 0.15 kg/m² vs ≈1 N/m² at 1.3 m/s), streams out at ~6 m/s and
 * flutters/snaps as gusts and the travelling-wave instability excite it. Fixed 1/60 s substeps, advanced only by the
 * sim-time delta it is given (0 while paused) → deterministic. No three.js dependency.
 * @module art/cloth
 */

const RHO = 1.2;

/** Live cloth meshes (flags, laundry): {mesh, cloth, gust, clank}; ticked by art/flags.js tickFlags. */
export const CLOTHS = [];
/** Register a Verlet-cloth mesh with the shared wind tick. */
export function registerCloth(mesh, cloth) { CLOTHS.push({ mesh, cloth, gust: 0, clank: 0 }); return mesh; }

export class VerletCloth {
  /**
   * @param {{position:{array:Float32Array,count:number}, normal:{array:Float32Array}}} attrs geometry attributes
   *   (PlaneGeometry order: row-major from the TOP row, `nx` = widthSegments+1 columns)
   * @param {{nx:number, ny:number, pinned:(i:number,j:number)=>boolean, density?:number, damping?:number,
   *   iterations?:number, cn?:number, ct?:number, flutter?:number}} o
   */
  constructor(attrs, o) {
    this.pos = attrs.position; this.nor = attrs.normal;
    this.nx = o.nx; this.ny = o.ny;
    const n = this.nx * this.ny, P = this.pos.array;
    this.x = Float32Array.from(P.subarray(0, n * 3));
    this.px = Float32Array.from(this.x);
    this.rest = Float32Array.from(this.x);
    this.f = new Float32Array(n * 3);
    this.inv = new Float32Array(n);
    this.damping = o.damping ?? 0.012;
    this.iterations = o.iterations ?? 5;
    this.cn = o.cn ?? 1.1; this.ct = o.ct ?? 0.06;
    this.flutter = o.flutter ?? 1;
    // particle masses from the cell areas (density kg/m²)
    const dx = Math.abs(this.x[3] - this.x[0]) || 0.05, dy = Math.abs(this.x[this.nx * 3 + 1] - this.x[1]) || 0.05;
    const m = (o.density ?? 0.15) * dx * dy;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) this.inv[j * this.nx + i] = o.pinned(i, j) ? 0 : 1 / m;
    // constraints [a, b, rest, stiffness]
    const C = [];
    const add = (a, b, k) => {
      const ax = this.x[a * 3] - this.x[b * 3], ay = this.x[a * 3 + 1] - this.x[b * 3 + 1], az = this.x[a * 3 + 2] - this.x[b * 3 + 2];
      C.push(a, b, Math.hypot(ax, ay, az), k);
    };
    const id = (i, j) => j * this.nx + i;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      if (i + 1 < this.nx) add(id(i, j), id(i + 1, j), 1);
      if (j + 1 < this.ny) add(id(i, j), id(i, j + 1), 1);
      if (i + 1 < this.nx && j + 1 < this.ny) { add(id(i, j), id(i + 1, j + 1), 0.25); add(id(i + 1, j), id(i, j + 1), 0.25); }
      if (i + 2 < this.nx) add(id(i, j), id(i + 2, j), 0.08);
      if (j + 2 < this.ny) add(id(i, j), id(i, j + 2), 0.08);
    }
    this.c = Float32Array.from(C);
    // long-range attachments (tethers): no particle may drift farther from its nearest pinned particle than at rest
    // — stops the Gauss-Seidel chain from stretching under strong gusts without extra iterations
    const pins = [];
    for (let k = 0; k < n; k++) if (!this.inv[k]) pins.push(k);
    this.tether = new Int32Array(n).fill(-1); this.tetherL = new Float32Array(n);
    if (pins.length) for (let k = 0; k < n; k++) {
      if (!this.inv[k]) continue;
      let best = -1, bd = Infinity;
      for (const q of pins) { const d = Math.hypot(this.x[k * 3] - this.x[q * 3], this.x[k * 3 + 1] - this.x[q * 3 + 1], this.x[k * 3 + 2] - this.x[q * 3 + 2]); if (d < bd) { bd = d; best = q; } }
      this.tether[k] = best; this.tetherL[k] = bd * 1.02;
    }
    for (let k = 0; k < n; k++) if (this.inv[k]) this.px[k * 3 + 2] = this.x[k * 3 + 2] - 0.002 * Math.sin(k * 1.7);
    this.t = 0; this.acc = 0;
    this.h = 1 / 60;
  }

  /** Reset to the rest pose (after a teleport / big time jump). */
  reset() { this.x.set(this.rest); this.px.set(this.rest); }

  /**
   * Hold exactly the particles in `ks` (indices j * nx + i; every other one free) — a garment taken off its pegs, held
   * by a hand (art/spy-actions.js). Tethers are re-derived on the rest layout (nearest held particle). `mass`: per free
   * particle (kg; default the mean of the free ones before).
   */
  setPinned(ks) {
    const n = this.nx * this.ny, held = new Set(ks);
    let m = this._m;
    if (!m) { let s = 0, c = 0; for (let k = 0; k < n; k++) if (this.inv[k]) { s += 1 / this.inv[k]; c++; } m = this._m = c ? s / c : 0.01; }
    for (let k = 0; k < n; k++) this.inv[k] = held.has(k) ? 0 : 1 / m;
    const R = this.rest;
    for (let k = 0; k < n; k++) {
      this.tether[k] = -1;
      if (!this.inv[k] || !held.size) continue;
      let best = -1, bd = Infinity;
      for (const q of held) { const d = Math.hypot(R[k * 3] - R[q * 3], R[k * 3 + 1] - R[q * 3 + 1], R[k * 3 + 2] - R[q * 3 + 2]); if (d < bd) { bd = d; best = q; } }
      this.tether[k] = best; this.tetherL[k] = bd * 1.02;
    }
    this.pinned = [...held];
  }

  /** Move held particle `k` to the local point (x, y, z) (its previous position kept as the Verlet history). */
  movePin(k, x, y, z) {
    const o = k * 3;
    this.px[o] = this.x[o]; this.px[o + 1] = this.x[o + 1]; this.px[o + 2] = this.x[o + 2];
    this.x[o] = x; this.x[o + 1] = y; this.x[o + 2] = z;
  }

  /** Write the particles to the geometry now (after pins moved without a step). */
  write() { this._write(); }

  /**
   * Advance by `dt` seconds of sim time with a LOCAL-frame wind (m/s) and gravity (m/s²).
   * @param {number} dt @param {number[]} wind [x,y,z] @param {number[]} g [x,y,z] @param {number} [gust] 0..1
   */
  advance(dt, wind, g, gust = 0) {
    if (!(dt > 0)) return 0;
    // review P3: a hitch or a coarse tool step (≤ 3 s) keeps the cloth alive — simulate the last ≤ 0.5 s of it —
    // and a teleport / time skip / rewind restarts from rest PRE-WARMED by 1.5 s in the current wind (the old
    // dt > 0.5 reset showed a flat, rigid rectangle for a frame or more)
    const warm = dt > 3;
    if (warm) this.reset();
    this.acc = warm ? 1.5 : Math.min(this.acc + dt, 0.5);
    const cap = Math.ceil(this.acc / this.h) + 1;
    let n = 0;
    while (this.acc >= this.h && n < cap) { this.acc -= this.h; this._step(this.h, wind, g, gust); n++; }
    if (n) this._write();
    return n;
  }

  _step(h, W, G, gust) {
    const x = this.x, px = this.px, f = this.f, inv = this.inv, nx = this.nx, ny = this.ny;
    f.fill(0);
    this.t += h;
    // aerodynamic force per triangle (two per cell), velocity from the Verlet history
    const ws = Math.hypot(W[0], W[1], W[2]);
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      this._tri(a, c, b, W, ws, h, gust, i / (nx - 1));
      this._tri(b, c, d, W, ws, h, gust, (i + 0.5) / (nx - 1));
    }
    const damp = 1 - this.damping, h2 = h * h;
    for (let k = 0, n = nx * ny; k < n; k++) {
      if (!inv[k]) continue;
      const o = k * 3;
      for (let e = 0; e < 3; e++) {
        const cur = x[o + e], v = (cur - px[o + e]) * damp;
        px[o + e] = cur;
        x[o + e] = cur + v + (G[e] + f[o + e] * inv[k]) * h2;
      }
    }
    const C = this.c;
    for (let it = 0; it < this.iterations; it++) {
      for (let q = 0; q < C.length; q += 4) {
        const a = C[q] * 3, b = C[q + 1] * 3, wa = inv[C[q]], wb = inv[C[q + 1]], w = wa + wb;
        if (!w) continue;
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const s = ((L - C[q + 2]) / (L * w)) * C[q + 3];
        x[a] += dx * s * wa; x[a + 1] += dy * s * wa; x[a + 2] += dz * s * wa;
        x[b] -= dx * s * wb; x[b + 1] -= dy * s * wb; x[b + 2] -= dz * s * wb;
      }
    }
    const T = this.tether, TL = this.tetherL;
    for (let k = 0, n = nx * ny; k < n; k++) {
      const q = T[k];
      if (q < 0) continue;
      const o = k * 3, p = q * 3, dx = x[o] - x[p], dy = x[o + 1] - x[p + 1], dz = x[o + 2] - x[p + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L > TL[k]) { const s = TL[k] / L; x[o] = x[p] + dx * s; x[o + 1] = x[p + 1] + dy * s; x[o + 2] = x[p + 2] + dz * s; }
    }
  }

  _tri(a, b, c, W, ws, h, gust, u) {
    const x = this.x, px = this.px, f = this.f, A = a * 3, B = b * 3, Cc = c * 3;
    const e1x = x[B] - x[A], e1y = x[B + 1] - x[A + 1], e1z = x[B + 2] - x[A + 2];
    const e2x = x[Cc] - x[A], e2y = x[Cc + 1] - x[A + 1], e2z = x[Cc + 2] - x[A + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-9, area = l2 * 0.5;
    nx /= l2; ny /= l2; nz /= l2;
    // relative wind (triangle velocity from the Verlet history) + a travelling flutter wave along the fly
    const vx = (x[A] + x[B] + x[Cc] - px[A] - px[B] - px[Cc]) / (3 * h), vy = (x[A + 1] + x[B + 1] + x[Cc + 1] - px[A + 1] - px[B + 1] - px[Cc + 1]) / (3 * h);
    const vz = (x[A + 2] + x[B + 2] + x[Cc + 2] - px[A + 2] - px[B + 2] - px[Cc + 2]) / (3 * h);
    const wave = Math.sin(u * 9 - this.t * (4 + ws * 0.9)) * (0.25 * Math.min(ws, 1) + ws * (0.06 + 0.16 * gust)) * this.flutter * u;
    const rx = W[0] - vx, ry = W[1] - vy, rz = W[2] - vz + wave;
    const vn = rx * nx + ry * ny + rz * nz;
    const kN = 0.5 * RHO * area * this.cn * vn * Math.abs(vn), kT = 0.5 * RHO * area * this.ct * Math.hypot(rx, ry, rz);
    const fx = (kN * nx + kT * rx) / 3, fy = (kN * ny + kT * ry) / 3, fz = (kN * nz + kT * rz) / 3;
    f[A] += fx; f[A + 1] += fy; f[A + 2] += fz; f[B] += fx; f[B + 1] += fy; f[B + 2] += fz; f[Cc] += fx; f[Cc + 1] += fy; f[Cc + 2] += fz;
  }

  /** Copy positions to the geometry and rebuild grid normals (central differences). */
  _write() {
    const P = this.pos.array, N = this.nor.array, x = this.x, nx = this.nx, ny = this.ny;
    P.set(x.subarray(0, P.length));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const l = (j * nx + Math.max(i - 1, 0)) * 3, r = (j * nx + Math.min(i + 1, nx - 1)) * 3;
      const u = (Math.max(j - 1, 0) * nx + i) * 3, d = (Math.min(j + 1, ny - 1) * nx + i) * 3;
      const ax = x[r] - x[l], ay = x[r + 1] - x[l + 1], az = x[r + 2] - x[l + 2];
      const bx = x[u] - x[d], by = x[u + 1] - x[d + 1], bz = x[u + 2] - x[d + 2];
      let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const L = Math.hypot(cx, cy, cz) || 1; cx /= L; cy /= L; cz /= L;
      const o = (j * nx + i) * 3;
      N[o] = cx; N[o + 1] = cy; N[o + 2] = cz;
    }
    this.pos.needsUpdate = true; this.nor.needsUpdate = true;
  }
}
