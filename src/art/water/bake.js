/**
 * Per-body CPU bake → RGBA half-float DataTexture over the body's bounding box (world XZ):
 *   R,G  flow velocity (m/s, world X/Z)   — rivers: centreline/constant flow, bank drag, potential flow
 *                                           around circular obstacles (piers, rocks), zero inside them
 *   B    foam/turbulence 0..1               — streaks traced upstream to obstacles, bank turbulence
 *   A    water depth in metres (>0 inside, <0 outside the polygon/mask) — from opts.bed(x,z) when given,
 *        else a bank-distance heuristic (depth * smoothstep over opts.bankWidth)
 */
import * as THREE from 'three';
import { solveFlow, wakeFoam, upsample, distanceField } from './fields.js';

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return [Math.hypot(ex, ez), t, dx, dz];
}

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * @param {object} b body options (type, polygon [[x,z]...], depth, flow, obstacles, bed, bankWidth, level)
 * @param {number} res texture resolution (long side)
 */
/** Bake grid of a body: padded polygon bounds and texel counts (cell centres at min + (i+0.5)*cell). */
export function bodyGrid(b, res = 256) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of b.polygon) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  const pad = 2; minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const w = maxX - minX, h = maxZ - minZ;
  const rx = w >= h ? res : Math.max(16, Math.round(res * w / h)), rz = h >= w ? res : Math.max(16, Math.round(res * h / w));
  return { minX, minZ, maxX, maxZ, w, h, rx, rz };
}

/**
 * @param {object} b body options; @param {number} res
 * @param {{hgt:Float32Array, solid:Uint8Array}|null} cap optional top-down bed capture on the bodyGrid (W-B graft):
 *   bed heights where no bed(x,z) function is given, solids (piers, rocks, hulls crossing the surface) become dry
 *   cells → shore distance, ripple walls, flow projection and wake streaks all see them.
 */
export function bakeBody(b, res = 256, cap = null) {
  const poly = b.polygon;
  const { minX, minZ, w, h, rx, rz } = bodyGrid(b, res);
  const data = new Float32Array(rx * rz * 4);
  const vel = new Float32Array(rx * rz * 2);
  const depthMax = b.depth ?? 2;
  const bank = b.bankWidth ?? Math.min(6, depthMax * 3);
  const obst = b.obstacles || [];
  const flow = b.flow || null;
  const speed = flow ? (flow.speed ?? 1) : 0;
  const cl = flow && flow.centerline;
  const fdir = flow && flow.dir ? new THREE.Vector2(flow.dir[0], flow.dir[1]).normalize() : new THREE.Vector2(1, 0);
  const n = poly.length;
  // mask(x,z) bodies (grid water cells): signed bank distance from a chamfer distance transform on the bake grid
  let maskSD = null;
  if (b.mask) {
    const N = rx * rz, ins = new Uint8Array(N), out = new Uint8Array(N), cell = 0.5 * (w / rx + h / rz);
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
      ins[k] = b.mask(minX + (i + 0.5) / rx * w, minZ + (j + 0.5) / rz * h) ? 1 : 0; out[k] = 1 - ins[k]; }
    const dIn = distanceField(out, rx, rz, cell), dOut = distanceField(ins, rx, rz, cell);
    maskSD = new Float32Array(N); for (let k = 0; k < N; k++) maskSD[k] = ins[k] ? dIn[k] - 0.5 * cell : -(dOut[k] - 0.5 * cell);
    // the continuous shore field (world/shore-field.js) replaces the texel-mask staircase near this body's banks
    if (b.sdf) for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
      if (Math.abs(maskSD[k]) < 1.5) maskSD[k] = b.sdf(minX + (i + 0.5) / rx * w, minZ + (j + 0.5) / rz * h); }
  }
  const sample = (x, z) => {
    if (maskSD) { const i = Math.min(rx - 1, Math.max(0, Math.floor((x - minX) / w * rx))), j = Math.min(rz - 1, Math.max(0, Math.floor((z - minZ) / h * rz))); return maskSD[j * rx + i]; }
    let dEdge = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) dEdge = Math.min(dEdge, segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1])[0]);
    const ins = inside(poly, x, z);
    return ins ? dEdge : -dEdge;
  };
  for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) {
    const x = minX + (i + 0.5) / rx * w, z = minZ + (j + 0.5) / rz * h;
    const sd = sample(x, z);
    let depth;
    const idx0 = j * rx + i;
    if (b.bed) depth = (b.level ?? 0) - b.bed(x, z);
    else if (cap && cap.hgt[idx0] > -900) depth = (b.level ?? 0) - cap.hgt[idx0];
    else depth = sd > 0 ? depthMax * Math.sqrt(Math.min(1, sd / bank)) : sd * 0.5;
    if (sd < 0 && (b.bed || cap)) depth = Math.min(depth, sd * 0.5);
    if (cap && cap.solid[idx0]) depth = Math.min(depth, -0.25);
    let vx = 0, vz = 0;
    if (speed > 0 && sd > 0) {
      let dx = fdir.x, dz = fdir.y;
      if (cl) { // tangent of nearest centreline segment
        let best = Infinity;
        for (let k = 1; k < cl.length; k++) {
          const [d, , sx, sz] = segDist(x, z, cl[k - 1][0], cl[k - 1][1], cl[k][0], cl[k][1]);
          if (d < best) { best = d; const l = Math.hypot(sx, sz) || 1; dx = sx / l; dz = sz / l; }
        }
      }
      const drag = Math.pow(Math.min(1, sd / bank), 0.4);
      let ux = dx * speed * drag, uz = dz * speed * drag;
      // potential flow around each circular obstacle (superposed doublets)
      for (const o of obst) {
        const px = x - o.x, pz = z - o.z, r2 = px * px + pz * pz, R2 = o.r * o.r;
        if (r2 < R2) { ux = 0; uz = 0; break; }
        const U = Math.hypot(ux, uz) || 1e-6, ex = ux / U, ez = uz / U;
        const a = px * ex + pz * ez, c = -px * ez + pz * ex; // along / across flow
        const k = R2 / (r2 * r2);
        const va = U * (1 - k * (a * a - c * c)), vc = U * (-k * 2 * a * c);
        ux = va * ex - vc * ez; uz = va * ez + vc * ex;
      }
      vx = ux; vz = uz;
    }
    const idx = (j * rx + i);
    vel[idx * 2] = vx; vel[idx * 2 + 1] = vz;
    data[idx * 4] = vx; data[idx * 4 + 1] = vz; data[idx * 4 + 3] = depth;
    // bank turbulence in fast rivers
    data[idx * 4 + 2] = speed > 0.3 && sd > 0 ? 0.25 * Math.max(0, 1 - sd / 1.2) * Math.min(1, speed / 1.5) : 0;
  }
  // captured obstacles in a river: divergence-free projection of the current around them + advected wake streaks
  if (speed > 0 && cap && cap.solid.some((v) => v)) {
    const cf = Math.max(1, Math.ceil(Math.max(rx, rz) / 128)), cx = Math.ceil(rx / cf), cz = Math.ceil(rz / cf);
    const wet = new Uint8Array(cx * cz), bvx = new Float32Array(cx * cz), bvz = new Float32Array(cx * cz);
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      const k = Math.min(rz - 1, j * cf + (cf >> 1)) * rx + Math.min(rx - 1, i * cf + (cf >> 1)), q = j * cx + i;
      if (data[k * 4 + 3] > 0.02) { wet[q] = 1; bvx[q] = vel[k * 2]; bvz[q] = vel[k * 2 + 1]; }
    }
    const { vx, vz } = solveFlow(wet, bvx, bvz, cx, cz, 120);
    const wf = wakeFoam(wet, vx, vz, cx, cz, (w / rx) * cf, 110, bvx, bvz);
    const ux = upsample(vx, cx, cz, rx, rz), uz = upsample(vz, cx, cz, rx, rz), uf = upsample(wf, cx, cz, rx, rz);
    for (let k = 0; k < rx * rz; k++) {
      if (data[k * 4 + 3] <= 0) { vel[k * 2] = vel[k * 2 + 1] = data[k * 4] = data[k * 4 + 1] = 0; continue; }
      vel[k * 2] = data[k * 4] = ux[k]; vel[k * 2 + 1] = data[k * 4 + 1] = uz[k];
      data[k * 4 + 2] = Math.min(1, data[k * 4 + 2] + uf[k] * 0.8);
    }
  }
  // foam streaks: trace upstream (backwards along velocity), foam if the path passed an obstacle
  if (speed > 0 && obst.length) {
    const cell = w / rx, stepLen = Math.max(cell, 0.25), trail = b.foamTrail ?? 14 * Math.min(2, speed);
    const velAt = (x, z) => {
      const i = Math.min(rx - 1, Math.max(0, Math.floor((x - minX) / w * rx))), j = Math.min(rz - 1, Math.max(0, Math.floor((z - minZ) / h * rz)));
      return [vel[(j * rx + i) * 2], vel[(j * rx + i) * 2 + 1]];
    };
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) {
      const idx = j * rx + i;
      if (data[idx * 4 + 3] <= 0) continue;
      let x = minX + (i + 0.5) / rx * w, z = minZ + (j + 0.5) / rz * h, s = 0, f = 0;
      // stagnation/bow foam right at the obstacle rim
      for (const o of obst) { const d = Math.hypot(x - o.x, z - o.z) - o.r; if (d < 0.6) f = Math.max(f, 0.9 * (1 - Math.max(0, d) / 0.6)); }
      while (s < trail && f < 1) {
        const [vx, vz] = velAt(x, z); const v = Math.hypot(vx, vz);
        if (v < 0.02) break;
        x -= vx / v * stepLen; z -= vz / v * stepLen; s += stepLen;
        for (const o of obst) {
          const d = Math.hypot(x - o.x, z - o.z) - o.r;
          if (d < 0.35 * o.r + 0.25) f = Math.max(f, Math.exp(-s / (trail * 0.45)) * (1 - Math.max(0, d) / (0.35 * o.r + 0.25)));
        }
      }
      data[idx * 4 + 2] = Math.min(1, data[idx * 4 + 2] + f);
    }
  }
  // chamfer distance transform (metres) from the dry region (depth <= 0) → shore distance, used for ice
  const cx = w / rx, cz = h / rz, cd = Math.hypot(cx, cz), INF = 1e9;
  const dist = new Float32Array(rx * rz);
  for (let k = 0; k < rx * rz; k++) dist[k] = data[k * 4 + 3] <= 0 ? 0 : INF;
  const relax = (k, k2, c) => { if (dist[k2] + c < dist[k]) dist[k] = dist[k2] + c; };
  for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
    if (i > 0) relax(k, k - 1, cx); if (j > 0) relax(k, k - rx, cz);
    if (i > 0 && j > 0) relax(k, k - rx - 1, cd); if (i < rx - 1 && j > 0) relax(k, k - rx + 1, cd); }
  for (let j = rz - 1; j >= 0; j--) for (let i = rx - 1; i >= 0; i--) { const k = j * rx + i;
    if (i < rx - 1) relax(k, k + 1, cx); if (j < rz - 1) relax(k, k + rx, cz);
    if (i < rx - 1 && j < rz - 1) relax(k, k + rx + 1, cd); if (i > 0 && j < rz - 1) relax(k, k + rx - 1, cd); }
  // two [1 2 1]² passes: the chamfer field of a texel mask has 1-texel stairs along diagonal banks (ice edges)
  const tmp = new Float32Array(rx * rz);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
      tmp[k] = dist[k] <= 0 ? 0 : (2 * dist[k] + dist[k - (i > 0)] + dist[k + (i < rx - 1)]) / 4; }
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
      dist[k] = tmp[k] <= 0 ? 0 : (2 * tmp[k] + tmp[k - (j > 0) * rx] + tmp[k + (j < rz - 1) * rx]) / 4; }
  }
  // continuous shore field: the bank distance is the field itself (smooth ice rims and contact foam at any bake
  // resolution); the chamfer only keeps the dry spots inside the water (captured rocks, piers, hulls) and far water
  if (b.sdf) {
    const inner = new Float32Array(rx * rz), sd = new Float32Array(rx * rz), far = b.sdfFar ?? 5;
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i;
      sd[k] = b.sdf(minX + (i + 0.5) / rx * w, minZ + (j + 0.5) / rz * h);
      inner[k] = data[k * 4 + 3] <= 0 && sd[k] > 0.5 ? 0 : INF; }
    for (let j = 0; j < rz; j++) for (let i = 0; i < rx; i++) { const k = j * rx + i; if (!inner[k]) continue;
      const rl = (q, c) => { if (inner[q] + c < inner[k]) inner[k] = inner[q] + c; };
      if (i > 0) rl(k - 1, cx); if (j > 0) rl(k - rx, cz); if (i > 0 && j > 0) rl(k - rx - 1, cd); if (i < rx - 1 && j > 0) rl(k - rx + 1, cd); }
    for (let j = rz - 1; j >= 0; j--) for (let i = rx - 1; i >= 0; i--) { const k = j * rx + i; if (!inner[k]) continue;
      const rl = (q, c) => { if (inner[q] + c < inner[k]) inner[k] = inner[q] + c; };
      if (i < rx - 1) rl(k + 1, cx); if (j < rz - 1) rl(k + rx, cz); if (i < rx - 1 && j < rz - 1) rl(k + rx + 1, cd); if (i > 0 && j < rz - 1) rl(k + rx - 1, cd); }
    for (let k = 0; k < rx * rz; k++) dist[k] = Math.min(sd[k] >= far ? dist[k] : Math.max(0, sd[k]), inner[k]);
  }
  const half2 = new Uint16Array(rx * rz * 4);
  for (let k = 0; k < rx * rz; k++) half2[k * 4] = THREE.DataUtils.toHalfFloat(Math.min(dist[k], 60000));
  const tex2 = new THREE.DataTexture(half2, rx, rz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex2.minFilter = tex2.magFilter = THREE.LinearFilter; tex2.needsUpdate = true;
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, rx, rz, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { texture: tex, texture2: tex2, shoreDist: dist, bounds: new THREE.Vector4(minX, minZ, w, h), data, rx, rz };
}
