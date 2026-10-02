/**
 * Map / apron seam metric (pure; shared by tests/unit/apron-seam.test.mjs and the GPU tests/shores.test.mjs): where a
 * shore crosses a map edge, contours of the drawn ground down the bank slope traced 5 m either side of the seam, with
 * their largest turn between 0.5 m chords (a smooth bank: small; a jog, notch or corner at the seam: 35-90 deg).
 */

/** Piecewise-linear height of a triangle mesh (xz buckets of 1 m) for the triangles within `keep` of the map edges. */
export function meshSurface(p, ix, keep) {
  const B = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const x0 = Math.min(p[a], p[b], p[c]), x1 = Math.max(p[a], p[b], p[c]), z0 = Math.min(p[a + 2], p[b + 2], p[c + 2]), z1 = Math.max(p[a + 2], p[b + 2], p[c + 2]);
    if (!keep((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    for (let j = Math.floor(z0); j <= Math.floor(z1); j++) for (let i = Math.floor(x0); i <= Math.floor(x1); i++) {
      const k = `${i},${j}`;
      if (!B.has(k)) B.set(k, []);
      B.get(k).push(t);
    }
  }
  return (x, z) => {
    for (const t of B.get(`${Math.floor(x)},${Math.floor(z)}`) || []) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
      const u = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d;
      const v = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1];
    }
    return NaN;
  };
}

/** Largest turn (deg) between consecutive 0.5 m chords of a polyline. */
export function maxTurn(Q) {
  let m = 0;
  for (let k = 1; k + 1 < Q.length; k++) {
    const a = Math.atan2(Q[k][1] - Q[k - 1][1], Q[k][0] - Q[k - 1][0]), b = Math.atan2(Q[k + 1][1] - Q[k][1], Q[k + 1][0] - Q[k][0]);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, d);
  }
  return m * 180 / Math.PI;
}

/**
 * @param {number} W map width (m)  @param {number} D map depth (m)
 * @param {(x:number,z:number)=>number} G drawn ground height (map mesh inside, apron mesh outside)
 * @param {(x:number,z:number)=>number} wetAt the shore field (> 0 in water)
 * @param {number} shallow the shallow-water carve depth (< 0)
 * @returns {{at:[number,number], turn:number, ref:number, n:number}[]} one entry per bank crossing a map edge; `ref`:
 *   the same trace on the shore field's own line (the designed shape: an authored corner a few metres from the edge,
 *   e.g. a quay rectangle, turns there by design; a seam jog is a turn the drawn ground adds over it)
 */
export function seamTurns(W, D, G, wetAt, shallow, minPoints = 24) {
  const out = [];
  const levels = [shallow * 0.55, shallow * 0.85]; // contours down the bank slope, under the water line
  const edges = [[(s) => [0, s], D], [(s) => [W, s], D], [(s) => [s, 0], W], [(s) => [s, D], W]];
  for (const [at, L] of edges) {
    let prev = null;
    for (let s = 0; s <= L; s += 0.1) {
      const [x, z] = at(s), v = wetAt(x, z);
      if (prev !== null && (prev > 0) !== (v > 0)) {
        // the bank's direction from the shore field; each contour traced every 0.5 m along it, 5 m either side
        const e = 0.05, gx = wetAt(x + e, z) - wetAt(x - e, z), gz = wetAt(x, z + e) - wetAt(x, z - e);
        const g = Math.hypot(gx, gz) || 1, nx = gx / g, nz = gz / g, tx = -nz, tz = nx;
        let turn = 0, n = 0, ref = 0;
        for (const lv of [...levels, null]) {
          const P = [];
          for (let u = -5; u <= 5 + 1e-9; u += 0.5) {
            const ox = x + tx * u, oz = z + tz * u, f = lv === null ? (r) => -wetAt(ox + nx * r, oz + nz * r) : (r) => G(ox + nx * r, oz + nz * r) - lv;
            // first crossing from the water side within the bank (2 .. -1.5 m of the field's line; low ground
            // further inland is not the bank)
            let lo = 2, flo = f(lo), hi = null;
            for (let r = lo - 0.1; r >= -1.5 - 1e-9; r -= 0.1) { const fr = f(r); if (Number.isFinite(flo) && Number.isFinite(fr) && (flo > 0) !== (fr > 0)) { hi = r; break; } lo = r; flo = fr; }
            if (hi === null) { if (P.length) P.push(null); continue; }
            for (let q = 0; q < 30; q++) { const m = (lo + hi) / 2; if ((f(m) > 0) === (flo > 0)) lo = m; else hi = m; }
            P.push([ox + nx * lo, oz + nz * lo]);
          }
          // largest turn over each unbroken run of the contour
          let run = [];
          for (const q of [...P, null]) {
            if (q) run.push(q);
            else { if (run.length >= 3) { if (lv === null) ref = Math.max(ref, maxTurn(run)); else { turn = Math.max(turn, maxTurn(run)); n += run.length; } } run = []; }
          }
        }
        if (n >= minPoints) out.push({ at: [+x.toFixed(2), +z.toFixed(2)], turn, ref, n });
      }
      prev = v;
    }
  }
  return out;
}
