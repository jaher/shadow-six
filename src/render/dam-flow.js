/**
 * Flow-field bake for the water below the dam (render/dam-water-pool.js). Pure JS (no THREE): a small 2D
 * "stable fluids" solver on a staggered (MAC) grid in the dam's own frame (u along the crest, v downstream, metres),
 * run at load time until it settles. Inputs are the pool/river geometry (`isWater`), the plunge line(s) where the
 * spillway water comes up (`sources`: a mass source = the upwelling boil, plus a downstream push = the jet's momentum)
 * and the open downstream edge (`isOut`). Banks drag the water (slow edges, fast core), the boil spreads both ways
 * (the roller runs back to the face) and the jet separates past the pool's corners, leaving eddies there. The final
 * field is exactly mass-conserving (div = sources) on the grid. Then two scalars are advected through it to a steady
 * state: `foam` (long-lived surface foam, carried and thinned downstream, collecting in eddies) and `aer`
 * (short-lived aeration: the white boil and the jump just past it).
 * @module render/dam-flow
 */

/**
 * @param {object} o
 * @param {(u:number, v:number)=>boolean} o.isWater  water at a point (dam frame)
 * @param {(u:number, v:number)=>boolean} [o.isOut]   open outflow cells (free pressure) — default: water on the domain edge with v > mid
 * @param {number} o.u0 @param {number} o.v0 @param {number} o.nu @param {number} o.nv @param {number} o.h  grid
 * @param {{u:number, v:number, ru:number, rv:number, q:number, push?:number, foam?:number, aer?:number}[]} o.sources
 * @param {number} [o.steps=180] @param {number} [o.speed=1.4] target core speed downstream (m/s; the field is scaled)
 * @param {number} [o.foamLife=22] @param {number} [o.aerLife=2.2] seconds
 */
export function bakeDamFlow(o) {
  const G = setup(o);
  simulate(G);
  return finish(G);
}

function setup(o) {
  const { u0, v0, nu, nv, h } = o, N = nu * nv, steps = o.steps ?? 180;
  const id = (i, j) => j * nu + i, cu = (i) => u0 + (i + 0.5) * h, cv = (j) => v0 + (j + 0.5) * h;
  const mask = new Uint8Array(N), out = new Uint8Array(N);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) mask[id(i, j)] = o.isWater(cu(i), cv(j)) ? 1 : 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = id(i, j);
    if (!mask[k]) continue;
    const edge = i === 0 || j === 0 || i === nu - 1 || j === nv - 1;
    out[k] = o.isOut ? (o.isOut(cu(i), cv(j)) ? 1 : 0) : edge && j > nv / 2 ? 1 : 0;
  }
  const fluid = (i, j) => i >= 0 && j >= 0 && i < nu && j < nv && mask[id(i, j)] === 1;
  // distance to the bank (cells, 2-pass chamfer) → bank drag
  const dist = new Float32Array(N).fill(1e6);
  for (let k = 0; k < N; k++) if (!mask[k]) dist[k] = 0;
  const chamfer = (i, j, di, dj, c) => { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nu || b >= nv) return; const k = id(i, j), q = id(a, b); if (dist[q] + c < dist[k]) dist[k] = dist[q] + c; };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { chamfer(i, j, -1, 0, 1); chamfer(i, j, 0, -1, 1); chamfer(i, j, -1, -1, 1.414); chamfer(i, j, 1, -1, 1.414); }
  for (let j = nv - 1; j >= 0; j--) for (let i = nu - 1; i >= 0; i--) { chamfer(i, j, 1, 0, 1); chamfer(i, j, 0, 1, 1); chamfer(i, j, 1, 1, 1.414); chamfer(i, j, -1, 1, 1.414); }
  // sources: per-cell divergence S (1/s), push (m/s²), foam and aeration emission
  const S = new Float32Array(N), push = new Float32Array(N), fSrc = new Float32Array(N), aSrc = new Float32Array(N);
  for (const s of o.sources) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = id(i, j);
    if (!mask[k]) continue;
    const du = (cu(i) - s.u) / s.ru, dv = (cv(j) - s.v) / s.rv, w = Math.exp(-(du * du + dv * dv));
    if (w < 0.02) continue;
    S[k] += s.q * w; push[k] += (s.push ?? 0) * w; fSrc[k] += (s.foam ?? 1) * w; aSrc[k] += (s.aer ?? 1) * w;
  }
  // staggered velocity: U at (i, j+½) for i ∈ [0, nu], V at (i+½, j) for j ∈ [0, nv]
  const U = new Float32Array((nu + 1) * nv), V = new Float32Array(nu * (nv + 1)), U2 = new Float32Array(U.length), V2 = new Float32Array(V.length);
  const ui = (i, j) => j * (nu + 1) + i, vi = (i, j) => j * nu + i;
  const oU = new Uint8Array(U.length), oV = new Uint8Array(V.length);
  for (let j = 0; j < nv; j++) for (let i = 0; i <= nu; i++) oU[ui(i, j)] = fluid(i - 1, j) && fluid(i, j) ? 1 : 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) oV[vi(i, j)] = fluid(i, j - 1) && fluid(i, j) ? 1 : 0;
  const bil = (A, W, Hh, x, y) => {
    x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(Hh - 1.001, y));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * W + i;
    return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + W] * (1 - fx) + A[k + W + 1] * fx) * fy;
  };
  // velocity (m/s) at a point given in cell units (cell (i, j) spans [i, i+1) × [j, j+1))
  const velAt = (x, y, out2) => { out2[0] = bil(U, nu + 1, nv, x, y - 0.5); out2[1] = bil(V, nu, nv + 1, x - 0.5, y); return out2; };
  const P = new Float32Array(N);
  const project = (iters, omega = 1.85) => {
    for (let it = 0; it < iters; it++) for (let pass = 0; pass < 2; pass++) for (let j = 0; j < nv; j++) for (let i = (j + pass) & 1; i < nu; i += 2) {
      const k = id(i, j);
      if (!mask[k] || out[k]) continue;
      let sum = 0, n = 0;
      if (oU[ui(i, j)]) { sum += P[k - 1]; n++; } if (oU[ui(i + 1, j)]) { sum += P[k + 1]; n++; }
      if (oV[vi(i, j)]) { sum += P[k - nu]; n++; } if (oV[vi(i, j + 1)]) { sum += P[k + nu]; n++; }
      if (!n) continue;
      P[k] += omega * ((sum - h * h * resid[k]) / n - P[k]);
    }
  };
  const resid = new Float32Array(N); // div(u*) − S, fixed during a projection
  const fullProject = (iters) => {
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const k = id(i, j); resid[k] = mask[k] ? (U[ui(i + 1, j)] - U[ui(i, j)] + V[vi(i, j + 1)] - V[vi(i, j)]) / h - S[k] : 0; }
    project(iters);
    for (let j = 0; j < nv; j++) for (let i = 1; i < nu; i++) { const f = ui(i, j); if (oU[f]) U[f] -= (P[id(i, j)] - P[id(i - 1, j)]) / h; else U[f] = 0; }
    for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) { const f = vi(i, j); if (oV[f]) V[f] -= (P[id(i, j)] - P[id(i, j - 1)]) / h; else V[f] = 0; }
    for (let j = 0; j < nv; j++) { U[ui(0, j)] = 0; U[ui(nu, j)] = 0; }
    for (let i = 0; i < nu; i++) { V[vi(i, 0)] = 0; V[vi(i, nv)] = 0; }
  };
  return { o, u0, v0, nu, nv, h, N, id, cu, cv, mask, out, dist, S, push, fSrc, aSrc, U, V, U2, V2, ui, vi, oU, oV, bil, velAt, fullProject, steps, P };
}

/** Run the solver until the flow settles (semi-Lagrangian advection, push, bank drag, SOR pressure projection). */
function simulate(G) {
  const { nu, nv, h, U, V, U2, V2, ui, vi, oU, oV, bil, velAt, push, dist, id, steps } = G, dt = 0.25, t2 = [0, 0];
  const kb = G.o.bankDrag ?? 0.45, rb = 1.6 / h, k0 = 0.01, nuVisc = G.o.viscosity ?? 0.35;
  const dragC = (k) => 1 / (1 + dt * (k0 + kb * Math.exp(-dist[k] / rb)));
  for (let s = 0; s < steps; s++) {
    for (let j = 0; j < nv; j++) for (let i = 1; i < nu; i++) {
      const f = ui(i, j);
      if (!oU[f]) { U2[f] = 0; continue; }
      velAt(i, j + 0.5, t2);
      U2[f] = bil(U, nu + 1, nv, i - (t2[0] * dt) / h, j + 0.5 - (t2[1] * dt) / h - 0.5) * 0.5 * (dragC(id(i - 1, j)) + dragC(id(i, j)));
    }
    for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) {
      const f = vi(i, j);
      if (!oV[f]) { V2[f] = 0; continue; }
      velAt(i + 0.5, j, t2);
      const a = id(i, j - 1), b = id(i, j);
      V2[f] = bil(V, nu, nv + 1, i + 0.5 - (t2[0] * dt) / h - 0.5, j - (t2[1] * dt) / h) * 0.5 * (dragC(a) + dragC(b)) + 0.5 * (push[a] + push[b]) * dt;
    }
    // horizontal eddy viscosity: the jet drags its neighbours along, the closed side pools answer with eddies
    const a = nuVisc * dt / (h * h);
    for (let j = 1; j < nv - 1; j++) for (let i = 1; i < nu; i++) { const f = ui(i, j); if (oU[f]) U[f] = U2[f] + a * ((oU[f - 1] ? U2[f - 1] : 0) + (oU[f + 1] ? U2[f + 1] : 0) + (oU[f - nu - 1] ? U2[f - nu - 1] : 0) + (oU[f + nu + 1] ? U2[f + nu + 1] : 0) - 4 * U2[f]); else U[f] = 0; }
    for (let j = 1; j < nv; j++) for (let i = 1; i < nu - 1; i++) { const f = vi(i, j); if (oV[f]) V[f] = V2[f] + a * ((oV[f - 1] ? V2[f - 1] : 0) + (oV[f + 1] ? V2[f + 1] : 0) + (oV[f - nu] ? V2[f - nu] : 0) + (oV[f + nu] ? V2[f + nu] : 0) - 4 * V2[f]); else V[f] = 0; }
    G.fullProject(14);
  }
  G.fullProject(600);
}

/** Collocate, scale to the target speed, advect foam + aeration to steady state; returns the baked field. */
function finish(G) {
  const { o, nu, nv, h, N, id, mask, U, V, ui, vi, bil, velAt, fSrc, aSrc } = G;
  const vel = new Float32Array(N * 2);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = id(i, j);
    if (!mask[k]) continue;
    vel[k * 2] = 0.5 * (U[ui(i, j)] + U[ui(i + 1, j)]); vel[k * 2 + 1] = 0.5 * (V[vi(i, j)] + V[vi(i, j + 1)]);
  }
  const sp = [];
  for (let k = 0; k < N; k++) if (mask[k]) sp.push(Math.hypot(vel[k * 2], vel[k * 2 + 1]));
  sp.sort((a, b) => a - b);
  const p90 = sp[Math.floor(sp.length * 0.9)] || 1, scale = (o.speed ?? 1.4) / p90;
  for (let k = 0; k < vel.length; k++) vel[k] *= scale;
  for (let k = 0; k < U.length; k++) U[k] *= scale;
  for (let k = 0; k < V.length; k++) V[k] *= scale;
  const t2 = [0, 0];
  const advect = (src, life) => {
    let f = new Float32Array(N), g = new Float32Array(N);
    const dtf = Math.min(0.5, life / 6), decay = Math.exp(-dtf / life), n = Math.min(400, Math.ceil((4 * life) / dtf));
    for (let s = 0; s < n; s++) {
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const k = id(i, j);
        if (!mask[k]) { g[k] = 0; continue; }
        velAt(i + 0.5, j + 0.5, t2);
        g[k] = bil(f, nu, nv, i - (t2[0] * dtf) / h, j - (t2[1] * dtf) / h) * decay + src[k] * dtf;
      }
      [f, g] = [g, f];
    }
    let mx = 0;
    for (let k = 0; k < N; k++) if (src[k] > 0.3 && f[k] > mx) mx = f[k];
    for (let k = 0; k < N; k++) f[k] = Math.min(1, f[k] / (mx || 1));
    return f;
  };
  const foam = advect(fSrc, o.foamLife ?? 22), aer = advect(aSrc, o.aerLife ?? 2.2);
  const at = (A, u, v, c = 1) => bil(A, nu, nv, (u - o.u0) / h - 0.5, (v - o.v0) / h - 0.5) * c;
  return {
    u0: o.u0, v0: o.v0, nu, nv, h, vel, foam, aer, mask, scale,
    /** {vu, vv, foam, aer} at a dam-frame point (bilinear). */
    sample(u, v) {
      const x = (u - o.u0) / h, y = (v - o.v0) / h;
      velAt(x, y, t2);
      return { vu: t2[0], vv: t2[1], foam: at(foam, u, v), aer: at(aer, u, v) };
    },
    /** Discrete divergence of the staggered field in cell (i, j) (1/s) and the imposed source there. */
    div(i, j) { return { div: (U[ui(i + 1, j)] - U[ui(i, j)] + V[vi(i, j + 1)] - V[vi(i, j)]) / h, src: G.S[id(i, j)] * scale, water: !!mask[id(i, j)], out: !!G.out[id(i, j)] }; },
  };
}
