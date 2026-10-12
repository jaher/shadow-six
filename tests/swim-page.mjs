/**
 * Page-side helpers for the Marine's swim / dive tests (marine-swim; imported inside page.evaluate as
 * '/tests/swim-page.mjs'): where to put him in the water, how far his drawn body reaches above the surface, and how
 * well he reads under it on screen.
 *
 * Readability (user 2026-10-11 "he should be visible clearly when under water"): his silhouette as drawn this frame is
 * rendered on its own (a flat skinned material writing world height), the parts of it under the surface (and not at
 * its very edge) are compared with the water round him (a band 8-20 px out, past any rim) on the final frame read back
 * from the canvas: the CIE76 colour difference of the two per-channel medians (ΔE) and their lightness difference (ΔL*).
 */
import * as THREE from 'three';

const T_WATER = 5, T_SHALLOW = 6;
/** ΔE (CIE76) from the water round him at which a pixel of him stands out (~ a clearly visible difference). */
export const SEEN_DE = 8;

/**
 * The water cell nearest (x, z) of the wanted kind ('deep' | 'shallow') with water of any kind all round it within
 * `room` m (a 16-point ring) and no bridge. @returns {[number, number]|null}
 */
export function waterSpot(G, x, z, { kind = 'deep', room = 2.5, maxR = 80 } = {}) {
  const g = G.world.grid, want = kind === 'deep' ? T_WATER : T_SHALLOW;
  const at = (px, pz) => {
    const i = Math.floor(px / g.cell), j = Math.floor(pz / g.cell);
    if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return -1;
    const k = j * g.cols + i;
    return g.bridge?.[k] ? -1 : g.terrain[k];
  };
  let best = null, bd = Infinity;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const cx = (i + 0.5) * g.cell, cz = (j + 0.5) * g.cell, d = Math.hypot(cx - x, cz - z);
    if (d >= bd || d > maxR || at(cx, cz) !== want) continue;
    let ok = true;
    for (let a = 0; a < 16 && ok; a++) {
      const t = at(cx + Math.cos(a * Math.PI / 8) * room, cz + Math.sin(a * Math.PI / 8) * room);
      if (t !== T_WATER && t !== T_SHALLOW) ok = false;
    }
    if (ok) { best = [cx, cz]; bd = d; }
  }
  return best;
}

/** Water surface height at (x, z) (the body's own level: a raised reservoir's), else -0.1. */
export function levelAt(G, x, z) { return G.world.water?.sample?.(x, z)?.level ?? -0.1; }

/** Visible skinned meshes of a unit's drawn body (the LOD shown). */
function shownMeshes(u) {
  const out = [];
  u.model?.root?.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
}

/**
 * How far the drawn body reaches above the water surface `level` (m; negative = under): the highest bone (any bone of
 * the shown body) and the highest skinned vertex (every `stride`-th of the shown LOD), with their names; and the lowest
 * vertex (world height `low`, where: lowX / lowZ, its bone: lowName).
 */
export function bodyAbove(u, level, { stride = 2 } = {}) {
  const h = u.model?.real?.inner;
  if (!h) return null;
  u.model.root.updateMatrixWorld(true);
  const P = new THREE.Vector3();
  let bone = -Infinity, boneName = '';
  for (const [n, b] of Object.entries(h.bones || {})) { b.getWorldPosition(P); if (P.y > bone) { bone = P.y; boneName = n; } }
  let vert = -Infinity, bed = Infinity, vertName = '', lowI = -1, lowM = null, lowX = 0, lowZ = 0;
  for (const m of shownMeshes(u)) {
    const n = m.geometry.attributes.position.count, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    for (let i = 0; i < n; i += stride) {
      m.getVertexPosition(i, P).applyMatrix4(m.matrixWorld);
      if (P.y < bed) { bed = P.y; lowI = i; lowM = m; lowX = P.x; lowZ = P.z; }
      if (P.y <= vert) continue;
      vert = P.y;
      let bi = 0, bw = -1;
      for (let c = 0; c < 4; c++) { const wt = sw.getComponent(i, c); if (wt > bw) { bw = wt; bi = si.getComponent(i, c); } }
      vertName = m.skeleton.bones[bi]?.name || '';
    }
  }
  let lowName = '';
  if (lowM) {
    const si = lowM.geometry.attributes.skinIndex, sw = lowM.geometry.attributes.skinWeight;
    let bi = 0, bw = -1;
    for (let c = 0; c < 4; c++) { const wt = sw.getComponent(lowI, c); if (wt > bw) { bw = wt; bi = si.getComponent(lowI, c); } }
    lowName = lowM.skeleton.bones[bi]?.name || '';
  }
  return { bone: bone - level, boneName, vert: vert - level, vertName, low: bed, lowName, lowX, lowZ };
}

let _rt = null, _mat = null, _scene = null;
/** sRGB 8-bit → CIE Lab (D65). */
function lab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), Gc = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * Gc + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * Gc + 0.0722 * B, Z = (0.0193 * R + 0.1192 * Gc + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/**
 * Render one frame and measure how the unit's submerged body reads against the water round it (see module doc).
 * Call with the camera on him. @returns {{dE:number, dL:number, nIn:number, nOut:number, Lin:number[], Lout:number[]}}
 */
export function diverContrast(G, u, level, { dt = 1 / 60, erode: ER = 3 } = {}) {
  const R = G.renderer.renderer, cam = G.renderer.camera, gl = R.getContext();
  const W = R.domElement.width, H = R.domElement.height;
  // 1) his silhouette with the world height of each pixel (render before the frame: same pose, no state left behind)
  if (!_rt || _rt.width !== W || _rt.height !== H) {
    _rt?.dispose();
    _rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }
  if (!_mat) {
    _mat = new THREE.MeshBasicMaterial();
    _mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace(/}\s*$/, '  gl_FragColor = vec4(1.0, vWY, 0.0, 1.0);\n}');
    };
    _mat.customProgramCacheKey = () => 'swimTestSil';
    _scene = new THREE.Scene(); _scene.matrixWorldAutoUpdate = false; _scene.overrideMaterial = _mat;
  }
  G.render(dt, 1);   // the frame that poses him (matrices current)
  const prevT = R.getRenderTarget(), ac = R.autoClear, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
  R.setRenderTarget(_rt); R.setClearColor(0x000000, 0); R.clear(true, true, true);
  _scene.children.length = 0; _scene.children.push(u.model.root);
  R.render(_scene, cam);
  _scene.children.length = 0;
  const sil = new Float32Array(W * H * 4);
  R.readRenderTargetPixels(_rt, 0, 0, W, H, sil);
  R.setRenderTarget(prevT); R.autoClear = ac; R.setClearColor(cc, ca);
  // 2) the final frame
  G.render(0, 1);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // regions: inside = covered, under the surface, 2 px in from his edge; outside = 8..20 px from him
  const cover = new Uint8Array(W * H), under = new Uint8Array(W * H);
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let k = 0; k < W * H; k++) {
    if (sil[k * 4] < 0.5) continue;
    cover[k] = 1; if (sil[k * 4 + 1] < level - 0.03) under[k] = 1;
    const x = k % W, y = (k / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // square dilations of his silhouette (separable max filters over the box round him)
  const bx0 = Math.max(0, x0 - 21), bx1 = Math.min(W - 1, x1 + 21), by0 = Math.max(0, y0 - 21), by1 = Math.min(H - 1, y1 + 21);
  const dilate = (r) => {
    const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      let v = 0; for (let d = -r; d <= r && !v; d++) { const xx = x + d; if (xx >= 0 && xx < W && cover[y * W + xx]) v = 1; }
      t[y * W + x] = v;
    }
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      let v = 0; for (let d = -r; d <= r && !v; d++) { const yy = y + d; if (yy >= 0 && yy < H && t[yy * W + x]) v = 1; }
      o[y * W + x] = v;
    }
    return o;
  };
  const near = dilate(7), far = dilate(20);
  const A = [], B = [];
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const k = y * W + x;
    if (under[k]) {
      let edge = false;
      for (let dy = -ER; dy <= ER && !edge; dy++) for (let dx = -ER; dx <= ER; dx++) { const kk = (y + dy) * W + x + dx; if (!cover[kk]) { edge = true; break; } }
      if (!edge) A.push(lab(px[k * 4], px[k * 4 + 1], px[k * 4 + 2]));
    } else if (!near[k] && far[k]) B.push(lab(px[k * 4], px[k * 4 + 1], px[k * 4 + 2]));
  }
  // medians per channel: robust to the refraction shifting his image a few px off the silhouette, to snowflakes, glints
  const med = (L, c) => { const v = L.map((q) => q[c]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
  const nIn = A.length, nOut = B.length;
  const Lin = [0, 1, 2].map((c) => med(A, c)), Lout = [0, 1, 2].map((c) => med(B, c));
  const dE = Math.hypot(Lin[0] - Lout[0], Lin[1] - Lout[1], Lin[2] - Lout[2]);
  // how much of him stands out: interior pixels at least SEEN_DE from the water's median colour
  const seen = A.filter((q) => Math.hypot(q[0] - Lout[0], q[1] - Lout[1], q[2] - Lout[2]) >= SEEN_DE).length;
  return { dE: +dE.toFixed(2), dL: +(Lin[0] - Lout[0]).toFixed(2), nIn, nOut, seen, frac: +(seen / Math.max(1, nIn)).toFixed(3), Lin: Lin.map((v) => +v.toFixed(1)), Lout: Lout.map((v) => +v.toFixed(1)) };
}
