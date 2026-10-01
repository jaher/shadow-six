/**
 * Deterministic blood-pool flow (docs/bodies-design.md §B.2): a 64 × 64 grid of 2.5 cm cells (1.6 m square, rotated
 * so +y runs downhill) holding bed height, standing liquid, soaked liquid and — on snow — a wide, faint halo channel.
 * Units: millimetres of liquid per cell (1 L = 1 / cell² cell-mm). Every step is pure Float32 math in a fixed order
 * seeded by the unit id, so a save re-simulates the same mask from (seed, age) alone (§B.7).
 *  - flow: flux-limited "virtual pipe" exchange of head (bed + liquid) between 4-neighbours; a dry neighbour pins the
 *    front until the head exceeds a noise-modulated film tension → lobed, natural edges; slope → a downhill tongue;
 *    micro-height (joints, planks, gravel, snow grain) biases the flow;
 *  - absorption: liquid → soaked at the surface's rate up to its capacity (§B.3);
 *  - capillary spread of the soaked liquid (anisotropic along the snow grain), and on snow a leak into the halo
 *    channel that diffuses 3× wider at low density.
 * @module render/blood/pool-sim
 */
import { CONFIG } from '../../config.js';
import { rng32, surfaceSpec } from './model.js';

const h2 = (x, y, s) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Value noise in [0, 1] at (x, y) (world metres × frequency), seed s. */
export function vnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Surface micro-height (mm) at world (x, z): joints and planks sink, gravel stones stand up, snow is grainy. */
export function microHeight(kind, x, z, seed = 0) {
  switch (kind) {
    case 'grain': return 0.7 * vnoise(x * 28, z * 28, 11) + 0.35 * vnoise(x * 70, z * 70, 12);
    case 'rock': return 1.1 * vnoise(x * 8, z * 8, 71) + 0.5 * vnoise(x * 26, z * 26, 72) + 0.2 * vnoise(x * 70, z * 70, 73);
    case 'soil': return 0.6 * vnoise(x * 14, z * 14, 21) + 0.3 * vnoise(x * 45, z * 45, 22);
    case 'gravel': { const n = vnoise(x * 34, z * 34, 31); return 2.6 * n * n + 0.4 * vnoise(x * 90, z * 90, 32); }
    case 'joints': { // cobbles / flagstones: 0.3 m stones, 1.5 cm mortar joints 2.5 mm deep (offset every other row)
      const row = Math.floor(z / 0.3), jx = ((x + (row & 1) * 0.15) % 0.3 + 0.3) % 0.3, jz = ((z % 0.3) + 0.3) % 0.3;
      const d = Math.min(jx, 0.3 - jx, jz, 0.3 - jz);
      return (d < 0.0075 ? -2.5 : d < 0.012 ? -1.0 : 0) + 0.35 * vnoise(x * 40, z * 40, 41);
    }
    case 'planks': { const p = ((x % 0.15) + 0.15) % 0.15; return (Math.min(p, 0.15 - p) < 0.004 ? -2.0 : 0) + 0.25 * vnoise(x * 3, z * 60, 51); }
    default: return 0.12 * vnoise(x * 30, z * 30, 61 + seed % 7);
  }
}

export class PoolSim {
  /**
   * @param {{seed:number, surface:string, volume:number, grow:number, slope?:number, x?:number, z?:number,
   *   rot?:number, src?:[number, number], pulses?:number}} o volume in litres; slope m/m along +y (downhill);
   *   (x, z, rot) = world centre + rotation of the tile (micro-height is world-aligned); src = source cell
   */
  constructor(o) {
    const P = CONFIG.blood.pool;
    this.n = P.n; this.cell = P.cell * Math.max(1, Math.sqrt((o.volume || 0) / 1.0)); // big bleeds: coarser cells
    this.dt = 1 / P.hz; this.sub = P.sub;
    this.seed = o.seed >>> 0; this.surface = o.surface || 'soil'; this.S = surfaceSpec(this.surface);
    this.volume = o.volume; this.grow = Math.max(1, o.grow);
    this.pulses = o.pulses || 0;
    this.left = o.volume / (this.cell * this.cell); // cell-mm still to bleed (1 L = 1e-3 m³ = 1 mm over 1 m²)
    this.total = this.left;
    this.age = 0; this.steps = 0; this.stopped = false; this.frozen = false;
    const n = this.n, N = n * n;
    this.bed = new Float32Array(N); this.h = new Float32Array(N); this.s = new Float32Array(N); this.g = new Float32Array(N);
    this.tau = new Float32Array(N); this.touched = new Uint8Array(N);
    this.wx = new Float32Array(N); this.wy = new Float32Array(N); // capillary weights (snow grain: anisotropic)
    this._d = new Float32Array(N); this._f = new Float32Array(N * 8);
    const r = rng32(this.seed);
    // mm per cell along +y: the flow sees at most a 1 % grade (a 1.6 m tile cannot hold a real run-off on a steep
    // slope; steeper ground still gives the tongue, and the tile is rotated downhill)
    const slope = Math.min(0.01, Math.max(0, o.slope || 0) * 0.25) * this.cell * 1000;
    const c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0), wx = o.x || 0, wz = o.z || 0;
    const film = CONFIG.blood.pool.film * (this.S.tension || 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = (i - n / 2 + 0.5) * this.cell, ly = (j - n / 2 + 0.5) * this.cell;
        const x = wx + lx * c - ly * sn, z = wz + lx * sn + ly * c;
        const k = j * n + i;
        this.bed[k] = microHeight(this.S.micro, x, z, this.seed) - slope * j;
        // edge tension: the film a front must exceed to wet a dry neighbour (lobes from 2 octaves of noise)
        // capillary permeability: patchy at 1–8 cm scales (fingered, ragged soak fronts) × a grain direction on snow
        const t = this.surface === 'snow' ? vnoise(i * 0.09, j * 0.09, (this.seed >> 5) & 511) : 0.5;
        const pn = vnoise(i * 0.33, j * 0.33, (this.seed >> 3) & 1023) * 0.65 + vnoise(i * 0.9, j * 0.9, (this.seed >> 7) & 1023) * 0.35;
        const perm = this.surface === 'snow' ? 0.06 + 3.2 * pn * pn * pn : 0.15 + 1.6 * pn * pn;
        this.wx[k] = (0.35 + 1.3 * t) * perm; this.wy[k] = (1.65 - 1.3 * t) * perm;
        this.tau[k] = film * (0.55 + 0.75 * vnoise(i * 0.09, j * 0.09, this.seed & 1023) + 0.2 * vnoise(i * 0.21, j * 0.21, (this.seed >> 10) & 1023));
      }
    }
    // source: up-slope of the centre when the ground tilts (room for the tongue), plus a small seeded offset
    const up = Math.min(0.3, (o.slope || 0) * 4) * n;
    this.src = o.src ? [...o.src] : [Math.round(n / 2 + (r() - 0.5) * 4), Math.round(n / 2 - up + (r() - 0.5) * 4)];
    this.src[0] = Math.max(3, Math.min(n - 4, this.src[0])); this.src[1] = Math.max(3, Math.min(n - 4, this.src[1]));
    this.wander = [r() * 6.283, r() * 6.283];
    this.box = [this.src[0] - 2, this.src[1] - 2, this.src[0] + 2, this.src[1] + 2];
    this.lbox = [...this.box]; // standing liquid only (the flow's working set; soak / halo can be much wider)
    const settle = this.surface === 'snow' ? 25 : CONFIG.blood.pool.settleAfter;
    this.freezeAt = this.grow + settle;
  }

  /** Liquid (cell-mm) in the grid: standing + soaked + halo (conserved by flow and soak; = bled volume). */
  mass() { let m = 0; for (let k = 0; k < this.h.length; k++) m += this.h[k] + this.s[k] + this.g[k]; return m; }

  /** Stop bleeding here (the body was moved): the remaining volume goes with the body. Returns litres left. */
  stop() { this.stopped = true; const l = this.left * this.cell * this.cell; this.left = 0; return l; }

  /** Bleed rate now (cell-mm per s): arterial pulses early for spurting wounds, then a decaying ooze. */
  _rate() {
    const t = this.age, base = (this.total / this.grow) * (1.6 / (1 - Math.exp(-1.6))) * Math.exp(-1.6 * t / this.grow);
    if (!this.pulses || t > this.grow * 0.35) return base;
    return base * (0.55 + 0.9 * Math.max(0, Math.sin(t * 7.5)));
  }

  /** Advance one fixed step (1 / hz s). */
  step() {
    if (this.frozen) return false;
    const dt = this.dt, n = this.n;
    this.age += dt; this.steps++;
    if (!this.stopped && this.left > 0) {
      const q = this.age >= this.grow ? this.left : Math.min(this.left, this._rate() * dt);
      this.left -= q;
      // the source wanders a few cells (body settling, several wounds) → no perfect circle
      const si = this.src[0] + Math.round(Math.sin(this.age * 0.9 + this.wander[0]) * 1.4);
      const sj = this.src[1] + Math.round(Math.sin(this.age * 0.7 + this.wander[1]) * 1.4);
      const W = [0.2, 0.12, 0.12, 0.12, 0.12, 0.08, 0.08, 0.08, 0.08], O = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (let m = 0; m < 9; m++) this.h[(sj + O[m][1]) * n + si + O[m][0]] += q * W[m];
      this._grow(si - 2, sj - 2, si + 2, sj + 2);
      this._grow(si - 2, sj - 2, si + 2, sj + 2, this.lbox);
    }
    if (this._wet !== false || (!this.stopped && this.left > 0) || this.steps < 3) for (let k = 0; k < this.sub; k++) this._flow(); // nothing standing: no flow
    this._soak(dt);
    if (this.S.spread > 0) this._spread();
    if (this.age >= this.freezeAt && (this.stopped || this.left <= 0)) this.frozen = true;
    return true;
  }

  _grow(a, b, c, d, B = this.box) {
    const n = this.n;
    B[0] = Math.max(1, Math.min(B[0], a)); B[1] = Math.max(1, Math.min(B[1], b));
    B[2] = Math.min(n - 2, Math.max(B[2], c)); B[3] = Math.min(n - 2, Math.max(B[3], d));
  }

  /** One flux-limited exchange pass over the active box (4-neighbour pipes; dry neighbours pin the front). */
  _flow() {
    const n = this.n, h = this.h, bed = this.bed, tau = this.tau, f = this._f, d = this._d, B = this.lbox;
    const x0 = B[0], y0 = B[1], x1 = B[2], y1 = B[3];
    // 8 neighbours with isotropic weights (axis 2/3, diagonal 1/6 of the exchange): no diamond-shaped pools
    const NB = [1, -1, n, -n, n + 1, n - 1, -n + 1, -n - 1], DI = [1, -1, 0, 0, 1, -1, 1, -1], DJ = [0, 0, 1, -1, 1, 1, -1, -1];
    const WF = [0.16, 0.16, 0.16, 0.16, 0.04, 0.04, 0.04, 0.04];
    let gx0 = n, gy0 = n, gx1 = 0, gy1 = 0, wet = false;
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * n + i, hk = h[k], o = k * 8;
        d[k] = 0;
        if (hk <= 1e-4) { for (let m = 0; m < 8; m++) f[o + m] = 0; continue; }
        const H = bed[k] + hk;
        let sum = 0;
        for (let m = 0; m < 8; m++) {
          const ii = i + DI[m], jj = j + DJ[m];
          if (ii < 1 || jj < 1 || ii > n - 2 || jj > n - 2) { f[o + m] = 0; continue; } // wall ring
          const q = k + NB[m];
          let dh = H - bed[q] - h[q];
          if (h[q] <= 0.08) dh -= tau[q];          // surface tension at the wet front (a bare film is still "dry")
          const fl = dh > 0 ? dh * WF[m] : 0;
          f[o + m] = fl; sum += fl;
        }
        if (sum > hk) { const sc = hk / sum; for (let m = 0; m < 8; m++) f[o + m] *= sc; }
      }
    }
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * n + i, o = k * 8;
        for (let m = 0; m < 8; m++) {
          const fl = f[o + m];
          if (fl <= 0) continue;
          d[k] -= fl; d[k + NB[m]] += fl;
        }
      }
    }
    // apply (the box grows by one ring each pass: the border ring of the grid is a wall, never written)
    const ax0 = Math.max(1, x0 - 1), ay0 = Math.max(1, y0 - 1), ax1 = Math.min(n - 2, x1 + 1), ay1 = Math.min(n - 2, y1 + 1);
    for (let j = ay0; j <= ay1; j++) {
      for (let i = ax0; i <= ax1; i++) {
        const k = j * n + i;
        if (i < x0 || i > x1 || j < y0 || j > y1) { if (d[k] === 0) continue; }
        const v = h[k] + d[k];
        h[k] = v > 0 ? v : 0;
        d[k] = 0;
        if (h[k] > 1e-4) { wet = true; this.touched[k] = 1; if (i < gx0) gx0 = i; if (i > gx1) gx1 = i; if (j < gy0) gy0 = j; if (j > gy1) gy1 = j; }
      }
    }
    if (gx1 >= gx0) {
      this._grow(gx0 - 1, gy0 - 1, gx1 + 1, gy1 + 1);
      const L = this.lbox; L[0] = Math.max(1, gx0 - 1); L[1] = Math.max(1, gy0 - 1); L[2] = Math.min(n - 2, gx1 + 1); L[3] = Math.min(n - 2, gy1 + 1);
    }
    this._wet = wet;
  }

  /** Liquid → soaked (surface absorption up to capacity); on snow the soaked core leaks into the halo channel. */
  _soak(dt) {
    const S = this.S, n = this.n, h = this.h, s = this.s, g = this.g, B = this.box;
    if (!(S.absorb > 0) || !(S.cap > 0)) return;
    const a = 1 - Math.exp(-S.absorb * dt), leak = S.halo ? 0.003 * dt : 0;
    for (let j = B[1]; j <= B[3]; j++) {
      for (let i = B[0]; i <= B[2]; i++) {
        const k = j * n + i;
        if (h[k] > 0) {
          const room = S.cap - s[k];
          if (room > 0) { const t = Math.min(h[k] * a, room); h[k] -= t; s[k] += t; }
        }
        if (leak && s[k] > 0.2) { const t = s[k] * leak; s[k] -= t; g[k] += t; }
      }
    }
  }

  /**
   * Capillary spread of the soaked liquid (explicit diffusion, conservative). Snow: anisotropic along a grain field
   * and a second, 3× wider diffusion of the halo channel.
   */
  _spread() {
    const S = this.S, n = this.n, B = this.box, snow = this.surface === 'snow';
    // porous-medium spread: the flux scales with the local saturation (a / ref), so a soak front stays compact and
    // stops once the liquid is spread thin — the halo channel has a lower ref, so it runs ~3× wider at low density
    const diffuse = (a, D, ref) => {
      const d = this._d, inv = 0.5 / ref, key = 'w' + D;
      let W = this._wc?.[key];
      if (!W) {                                                       // per-cell pair weights, once per coefficient
        const N = n * n, ex = new Float32Array(N), ey = new Float32Array(N), ed = new Float32Array(N);
        for (let k = 0; k < N; k++) { ex[k] = Math.min(0.24, D * this.wx[k]) * 0.667; ey[k] = Math.min(0.24, D * this.wy[k]) * 0.667; ed[k] = (ex[k] + ey[k]) * 0.125; }
        W = (this._wc ||= {})[key] = { ex, ey, ed };
      }
      const EX = W.ex, EY = W.ey, ED = W.ed;
      for (let j = Math.max(1, B[1] - 1); j <= Math.min(n - 2, B[3]); j++) {
        for (let i = Math.max(1, B[0] - 1); i <= Math.min(n - 2, B[2]); i++) {
          const k = j * n + i, ak = a[k];
          // 9-point isotropic stencil: axis pairs 2/3, diagonal pairs 1/6 (no square / diamond soak fronts)
          const b1 = a[k + 1], bn = a[k + n];
          if (ak + b1 + bn + a[k + n + 1] <= 0) continue;               // dry neighbourhood: nothing to exchange
          if (i + 1 <= n - 2) { const b = b1; const m = Math.min(1, (ak + b) * inv); if (m > 0.02) { const fx = (b - ak) * EX[k] * m; d[k] += fx; d[k + 1] -= fx; } }
          if (j + 1 <= n - 2) { const b = bn; const m = Math.min(1, (ak + b) * inv); if (m > 0.02) { const fy = (b - ak) * EY[k] * m; d[k] += fy; d[k + n] -= fy; } }
          if (i + 1 <= n - 2 && j + 1 <= n - 2) {
            const e = ED[k];
            const b = a[k + n + 1]; let m = Math.min(1, (ak + b) * inv); if (m > 0.02) { const fd = (b - ak) * e * m; d[k] += fd; d[k + n + 1] -= fd; }
            const c = a[k + 1], c2 = a[k + n]; m = Math.min(1, (c + c2) * inv); if (m > 0.02) { const fd = (c2 - c) * e * m; d[k + 1] += fd; d[k + n] -= fd; }
          }
        }
      }
      const x0 = Math.max(1, B[0] - 1), y0 = Math.max(1, B[1] - 1), x1 = Math.min(n - 2, B[2] + 1), y1 = Math.min(n - 2, B[3] + 1);
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const k = j * n + i; const v = a[k] + d[k]; a[k] = v > 0 ? v : 0; d[k] = 0;
          if (v > 1e-4) { if (i < gb[0]) gb[0] = i; if (i > gb[2]) gb[2] = i; if (j < gb[1]) gb[1] = j; if (j > gb[3]) gb[3] = j; }
        }
      }
    };
    const gb = [n, n, 0, 0];
    diffuse(this.s, S.spread * (snow ? 1 : 0.6), (S.cap || 1) * 0.6);
    if (S.halo) for (let k = 0; k < 2; k++) diffuse(this.g, Math.min(0.24, S.spread * S.halo * 0.8), 0.04);
    // soaked / halo liquid reached new cells: widen the box to them (+1 ring)
    if (gb[2] >= gb[0]) this._grow(gb[0] - 1, gb[1] - 1, gb[2] + 1, gb[3] + 1);
  }

  /** Simulate to `age` s (fixed steps; capped at maxSteps per call). Returns true when caught up. */
  advanceTo(age, maxSteps = 1e9) {
    const target = Math.round(Math.min(age, CONFIG.blood.pool.maxAge) / this.dt);
    let k = 0;
    while (this.steps < target && !this.frozen && k < maxSteps) { this.step(); k++; }
    if (this.frozen && this.steps < target) { this.age = target * this.dt; this.steps = target; }
    return this.steps >= target || this.frozen;
  }

  /**
   * Write the masks into an RGBA8 tile (n × n × 4): R liquid (0..4 mm), G soaked (0..cap), B halo, A ever wet.
   * @param {Uint8Array} out
   * @param {number} [stride] row stride in pixels (atlas width) and offset (pixel index of the tile origin)
   */
  writeTile(out, stride = this.n, offset = 0) {
    const n = this.n, cap = Math.max(0.5, this.S.cap || 0.5);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i, o = (offset + j * stride + i) * 4;
        out[o] = Math.min(255, Math.round(this.h[k] * 63.75));
        out[o + 1] = Math.min(255, Math.round((this.s[k] / cap) * 255));
        out[o + 2] = Math.min(255, Math.round(this.g[k] * 500));
        out[o + 3] = this.touched[k] || this.s[k] > 0.05 || this.g[k] > 0.02 ? 255 : 0;
      }
    }
    return out;
  }

  /** Coverage radius estimate (m) around the tile centre: for footprints / grass masks. */
  extent() {
    const B = this.box; return Math.max(B[2] - B[0], B[3] - B[1]) * this.cell * 0.5;
  }

  /** Is cell-space point (u, v in 0..1) wet with liquid or soaked? (bloody-feet test) */
  wetAt(u, v) {
    const n = this.n, i = Math.floor(u * n), j = Math.floor(v * n);
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return false;
    const k = j * n + i; return this.h[k] > 0.3 || this.s[k] > 0.5;
  }
}
