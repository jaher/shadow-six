// Bed capture + field solvers grafted from prototype W-B (own work, CC0 as part of this module):
//   captureHeights: top-down orthographic capture of the scene (clip plane at level+margin cuts bridge decks,
//   back faces seen through the clip = inside a closed solid = obstacle: piers, posts, rocks, hulls)
//   distanceField (chamfer), solveFlow (Jacobi pressure projection, solid walls), wakeFoam (advected streaks)
import * as THREE from 'three';

const CAP_VS = `#include <clipping_planes_pars_vertex>
varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`;
const CAP_FS = `#include <clipping_planes_pars_fragment>
varying float vY; void main(){
#include <clipping_planes_fragment>
// back face seen first = the ray is inside a closed solid at the clip height (capping trick) -> obstacle
gl_FragColor = vec4(gl_FrontFacing ? vY : 999.0, 0.0, 0.0, 1.0); }`;

export function captureHeights(renderer, scene, bounds, nx, nz, hide, clipY = Infinity) {
  const [minX, minZ, maxX, maxZ] = bounds;
  const rt = new THREE.WebGLRenderTarget(nx, nz, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cam = new THREE.OrthographicCamera(-(maxX - minX) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, -(maxZ - minZ) / 2, 0.1, 2000);
  cam.position.set((minX + maxX) / 2, 900, (minZ + maxZ) / 2);
  cam.up.set(0, 0, -1);
  cam.lookAt((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  cam.updateMatrixWorld();
  const mat = new THREE.ShaderMaterial({ vertexShader: CAP_VS, fragmentShader: CAP_FS, side: THREE.DoubleSide, clipping: true });
  const vis = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  const prevO = scene.overrideMaterial, prevBg = scene.background, prevFog = scene.fog, prevT = renderer.getRenderTarget();
  const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  scene.overrideMaterial = mat; scene.background = null; scene.fog = null;
  const prevClip = renderer.clippingPlanes;
  // only geometry below (level + margin) counts as bed/obstacle: bridge decks and piers' tops are cut away
  if (isFinite(clipY)) renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)];
  renderer.setRenderTarget(rt);
  renderer.setClearColor(new THREE.Color(-1000, 0, 0), 1);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Float32Array(nx * nz * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, nx, nz, px);
  renderer.clippingPlanes = prevClip;
  renderer.setRenderTarget(prevT); renderer.setClearColor(cc, ca);
  scene.overrideMaterial = prevO; scene.background = prevBg; scene.fog = prevFog;
  hide.forEach((o, i) => { o.visible = vis[i]; });
  rt.dispose(); mat.dispose();
  // readPixels row 0 = bottom of image = +Z edge (camera up is -Z). Re-order so row j <-> z ascending.
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const sr = (nz - 1 - j) * nx;
    for (let i = 0; i < nx; i++) h[j * nx + i] = px[(sr + i) * 4];
  }
  return h;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 2-pass chamfer (3-4) distance transform; seeds where `solid` is true. Returns metres. */
export function distanceField(solid, nx, nz, cell) {
  const INF = 1e9, d = new Float32Array(nx * nz);
  for (let k = 0; k < d.length; k++) d[k] = solid[k] ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) {
      v = Math.min(v, d[k - nx] + a);
      if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
      if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
    }
    d[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
    if (j < nz - 1) {
      v = Math.min(v, d[k + nx] + a);
      if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
      if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
    }
    d[k] = v;
  }
  for (let k = 0; k < d.length; k++) d[k] = Math.min(d[k] * cell, 200);
  return d;
}

/**
 * Divergence-free flow around obstacles on a coarse grid (Jacobi pressure projection, solid walls).
 * base: per-cell initial velocity (vx,vz) arrays; wet: Uint8 mask. Returns {vx, vz}.
 */
export function solveFlow(wet, bvx, bvz, nx, nz, iters = 160) {
  const N = nx * nz, vx = Float32Array.from(bvx), vz = Float32Array.from(bvz);
  const p = new Float32Array(N), p2 = new Float32Array(N), div = new Float32Array(N);
  const W = (i, j) => (i >= 0 && j >= 0 && i < nx && j < nz && wet[j * nx + i]) ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    // zero normal velocity into solids
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!wet[k]) { vx[k] = vz[k] = 0; continue; }
      if ((vx[k] > 0 && !W(i + 1, j)) || (vx[k] < 0 && !W(i - 1, j))) vx[k] = 0;
      if ((vz[k] > 0 && !W(i, j + 1)) || (vz[k] < 0 && !W(i, j - 1))) vz[k] = 0;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!wet[k]) continue;
      const xr = W(i + 1, j) ? vx[k + 1] : 0, xl = W(i - 1, j) ? vx[k - 1] : 0;
      const zu = W(i, j + 1) ? vz[k + nx] : 0, zd = W(i, j - 1) ? vz[k - nx] : 0;
      // open boundary at the grid edge (river enters/leaves the map): mirror own velocity
      div[k] = 0.5 * (((i === nx - 1) ? vx[k] : xr) - ((i === 0) ? vx[k] : xl) + ((j === nz - 1) ? vz[k] : zu) - ((j === 0) ? vz[k] : zd));
    }
    p.fill(0);
    let a = p, b = p2;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (!wet[k]) { b[k] = 0; continue; }
        let s = 0, n = 0;
        if (i === nx - 1) n++; else if (wet[k + 1]) { s += a[k + 1]; n++; }
        if (i === 0) n++; else if (wet[k - 1]) { s += a[k - 1]; n++; }
        if (j === nz - 1) n++; else if (wet[k + nx]) { s += a[k + nx]; n++; }
        if (j === 0) n++; else if (wet[k - nx]) { s += a[k - nx]; n++; }
        b[k] = n ? (s - div[k]) / n : 0;
      }
      const t = a; a = b; b = t;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!wet[k]) continue;
      const pc = a[k];
      const pr = i < nx - 1 ? (wet[k + 1] ? a[k + 1] : pc) : 0, pl = i > 0 ? (wet[k - 1] ? a[k - 1] : pc) : 0;
      const pu = j < nz - 1 ? (wet[k + nx] ? a[k + nx] : pc) : 0, pd = j > 0 ? (wet[k - nx] ? a[k - nx] : pc) : 0;
      vx[k] -= 0.5 * (pr - pl); vz[k] -= 0.5 * (pu - pd);
    }
  }
  return { vx, vz };
}

function bilin(f, nx, nz, x, z) {
  x = Math.max(0, Math.min(nx - 1.001, x)); z = Math.max(0, Math.min(nz - 1.001, z));
  const i = x | 0, j = z | 0, fx = x - i, fz = z - j, k = j * nx + i;
  return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fz) + (f[k + nx] * (1 - fx) + f[k + nx + 1] * fx) * fz;
}

/** Foam streaks: sources at obstacles facing the current, advected downstream with decay. */
export function wakeFoam(wet, vx, vz, nx, nz, cell, steps = 120, bvx = vx, bvz = vz) {
  const N = nx * nz, src = new Float32Array(N);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i; if (!wet[k]) continue;
    let s = 0;
    for (const [dx, dz] of dirs) {
      if (wet[k + Math.round(dz) * nx + Math.round(dx)]) continue;
      const d = bvx[k] * dx + bvz[k] * dz;          // base current running INTO the obstacle -> pile-up foam
      s = Math.max(s, d * 0.7, -d * 0.25);           // lee side: weaker turbulent wake
    }
    src[k] = Math.min(1, s);
  }
  let f = Float32Array.from(src), g = new Float32Array(N);
  const dt = cell * 0.9 / Math.max(0.05, maxSpeed(vx, vz));
  for (let s = 0; s < steps; s++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!wet[k]) { g[k] = 0; continue; }
      const up = bilin(f, nx, nz, i - vx[k] * dt / cell, j - vz[k] * dt / cell);
      // small lateral diffusion widens the streaks downstream
      const lat = 0.25 * ((f[k - 1] || 0) + (f[k + 1] || 0) + (f[k - nx] || 0) + (f[k + nx] || 0));
      g[k] = Math.max(src[k], (0.9 * up + 0.1 * lat) * 0.992);
    }
    const t = f; f = g; g = t;
  }
  return f;
}

function maxSpeed(vx, vz) { let m = 0; for (let k = 0; k < vx.length; k++) m = Math.max(m, Math.hypot(vx[k], vz[k])); return m; }

/** Resample a coarse grid to a finer one (bilinear). */
export function upsample(f, cx, cz, nx, nz) {
  const o = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
    o[j * nx + i] = bilin(f, cx, cz, (i + 0.5) * cx / nx - 0.5, (j + 0.5) * cz / nz - 0.5);
  return o;
}
