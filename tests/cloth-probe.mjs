/**
 * Browser-side canvas-cloth probe (tests + tools). Reads back the GPU-displaced WORLD position of every vertex of a
 * canvas mesh by drawing the mesh's own (patched) material as 1-px points into a float target, one texel per vertex.
 * So the measurement runs the real vertex shader on the real geometry: seam gaps, flutter spectra and amplitudes.
 *
 *   const P = await import('/tests/cloth-probe.mjs');
 *   const pr = P.makeProbe(renderer, mesh); const pos = pr.read(); // Float32Array n·3 (world)
 */
import * as THREE from 'three';

/** Canvas meshes under `root` (wind-flap attribute present). */
export function canvasMeshes(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh && (o.geometry.attributes.aFlap || o.geometry.attributes.aCanvas)) out.push(o); });
  return out;
}

/** @param {THREE.WebGLRenderer} renderer @param {THREE.Mesh} mesh */
export function makeProbe(renderer, mesh) {
  const g = mesh.geometry, n = g.attributes.position.count, W = 256, H = Math.ceil(n / W);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const src = mesh.material, mat = src.clone();
  mat.onBeforeCompile = function (sh, r) {
    src.onBeforeCompile?.call(this, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vProbe;')
      .replace(/}\s*$/, `  vProbe = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float pid = float(gl_VertexID);
  gl_Position = vec4((mod(pid, ${W}.0) + 0.5) / ${W}.0 * 2.0 - 1.0, (floor(pid / ${W}.0) + 0.5) / ${H}.0 * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`);
    sh.fragmentShader = 'varying vec3 vProbe;\nvoid main() { gl_FragColor = vec4(vProbe, 1.0); }';
  };
  mat.customProgramCacheKey = () => 'clothprobe|' + (src.customProgramCacheKey?.call(src) || '');
  mat.blending = THREE.NoBlending; mat.transparent = false; mat.depthTest = false; mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  // non-indexed points: one draw per vertex id
  const pg = new THREE.BufferGeometry();
  for (const k in g.attributes) pg.setAttribute(k, g.attributes[k]);
  const pts = new THREE.Points(pg, mat);
  pts.frustumCulled = false; pts.matrixAutoUpdate = false;
  pts.onBeforeRender = (r, s, c, geo, m, grp) => { // drive the real per-object hooks (state + uniforms) for `mesh`
    mesh.onBeforeRender?.call(mesh, r, s, c, mesh.geometry, m, grp);
    if (src.onBeforeRender !== THREE.Material.prototype.onBeforeRender) src.onBeforeRender.call(m, r, s, c, mesh.geometry, mesh, grp);
  };
  const buf = new Float32Array(W * H * 4), out = new Float32Array(n * 3);
  const cam = new THREE.OrthographicCamera();
  return {
    n,
    read() {
      mesh.updateWorldMatrix(true, false);
      pts.matrix.copy(mesh.matrixWorld); pts.matrixWorld.copy(mesh.matrixWorld); pts.matrixWorldNeedsUpdate = true;
      const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
      renderer.setRenderTarget(rt); renderer.setClearColor(0, 0); renderer.clear();
      renderer.render(pts, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      renderer.setRenderTarget(prev); renderer.autoClear = ac;
      for (let i = 0; i < n; i++) { out[i * 3] = buf[i * 4]; out[i * 3 + 1] = buf[i * 4 + 1]; out[i * 3 + 2] = buf[i * 4 + 2]; }
      return out;
    },
    /** Undisplaced world positions (CPU). */
    rest() {
      mesh.updateWorldMatrix(true, false);
      const P = g.attributes.position, v = new THREE.Vector3(), o = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld); o[i * 3] = v.x; o[i * 3 + 1] = v.y; o[i * 3 + 2] = v.z; }
      return o;
    },
    dispose() { rt.dispose(); mat.dispose(); pg.dispose(); },
  };
}

/** Groups of coincident vertices (same rest position within `eps` m): seams / UV splits / panel joins. */
export function seamGroups(rest, eps = 5e-4) {
  const m = new Map(), n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(rest[i * 3] / eps)},${Math.round(rest[i * 3 + 1] / eps)},${Math.round(rest[i * 3 + 2] / eps)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return [...m.values()].filter((g) => g.length > 1);
}

/** Pairs of vertices `lo`..`hi` m apart at rest (spatial hash): flat [i, j, d0, …]. */
export function nearPairs(rest, lo, hi) {
  const n = rest.length / 3, cell = new Map(), c = (x) => Math.floor(x / hi), key = (a, b, d) => `${a},${b},${d}`, out = [];
  for (let i = 0; i < n; i++) { const k = key(c(rest[i * 3]), c(rest[i * 3 + 1]), c(rest[i * 3 + 2])); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); }
  for (let i = 0; i < n; i++) {
    const x = c(rest[i * 3]), y = c(rest[i * 3 + 1]), z = c(rest[i * 3 + 2]);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const j of cell.get(key(x + a, y + b, z + d)) || []) {
      if (j <= i) continue;
      const dd = Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]);
      if (dd > lo && dd < hi) out.push(i, j, dd);
    }
  }
  return out;
}
/** Largest growth of the distance of any near pair (m). */
export function maxGrowth(pos, near) {
  let w = 0;
  for (let q = 0; q < near.length; q += 3) { const i = near[q] * 3, j = near[q + 1] * 3; w = Math.max(w, Math.hypot(pos[i] - pos[j], pos[i + 1] - pos[j + 1], pos[i + 2] - pos[j + 2]) - near[q + 2]); }
  return w;
}
/** Triangle edges of a geometry: flat [a, b, …]. */
export function triEdges(geo) {
  const I = geo.index, n = I ? I.count : geo.attributes.position.count, out = [];
  for (let t = 0; t < n; t += 3) for (let e = 0; e < 3; e++) out.push(I ? I.getX(t + e) : t + e, I ? I.getX(t + (e + 1) % 3) : t + (e + 1) % 3);
  return out;
}
/** Largest relative length change of any triangle edge (≥ 1 mm at rest). */
export function maxStretch(pos, rest, edges) {
  let w = 0;
  for (let q = 0; q < edges.length; q += 2) {
    const a = edges[q] * 3, b = edges[q + 1] * 3, l0 = Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]);
    if (l0 >= 1e-3) w = Math.max(w, Math.abs(Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) / l0 - 1));
  }
  return w;
}

/** Max distance between members of any group (m). */
export function maxGap(pos, groups) {
  let worst = 0;
  for (const g of groups) for (let a = 1; a < g.length; a++) {
    const i = g[0] * 3, j = g[a] * 3;
    worst = Math.max(worst, Math.hypot(pos[i] - pos[j], pos[i + 1] - pos[j + 1], pos[i + 2] - pos[j + 2]));
  }
  return worst;
}

/**
 * Spectrum of a set of displacement series (each Float32Array over frames at `fps`): mean-removed DFT power summed
 * over series. → {dominant Hz, centroid Hz, hiFrac (power share above `hi` Hz), rms m, ptp m (max peak-to-peak)}.
 */
export function spectrum(series, fps = 60, hi = 2) {
  const F = series[0]?.length || 0, P = new Float64Array((F >> 1) + 1);
  let ss = 0, cnt = 0, ptp = 0;
  for (const s of series) {
    let mean = 0, mn = Infinity, mx = -Infinity;
    for (let k = 0; k < F; k++) { mean += s[k]; mn = Math.min(mn, s[k]); mx = Math.max(mx, s[k]); }
    mean /= F; ptp = Math.max(ptp, mx - mn);
    for (let k = 0; k < F; k++) { ss += (s[k] - mean) ** 2; cnt++; }
    for (let b = 1; b < P.length; b++) {
      let re = 0, im = 0;
      for (let k = 0; k < F; k++) { const a = (-2 * Math.PI * b * k) / F, v = s[k] - mean; re += v * Math.cos(a); im += v * Math.sin(a); }
      P[b] += re * re + im * im;
    }
  }
  let best = 1, tot = 0, hiP = 0, cen = 0;
  for (let b = 1; b < P.length; b++) {
    const f = (b * fps) / F; tot += P[b]; cen += P[b] * f; if (f > hi) hiP += P[b]; if (P[b] > P[best]) best = b;
  }
  return { dominant: +((best * fps) / F).toFixed(2), centroid: +(cen / (tot || 1)).toFixed(2), hiFrac: +(hiP / (tot || 1)).toFixed(3),
    rms: +Math.sqrt(ss / (cnt || 1)).toFixed(4), ptp: +ptp.toFixed(4) };
}
