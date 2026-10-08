/**
 * Page-side helpers for the bodies-on-the-ground browser test (body-float; imported inside page.evaluate as
 * '/tests/body-float-page.mjs'): where the drawn body of a dead man lies relative to the ground as it is RENDERED.
 *
 * The rendered ground is read back from the GPU: the terrain mesh (with its own material, so the trail / blood-melt /
 * crater displacement of its vertex shader is in) and the walkable decks are drawn from straight above into a depth
 * target over the body; each skinned vertex of the body is compared with the height there. Off the terrain (a deck, a
 * pavement, a step) the world's walking surface (world.groundY) counts when it is higher.
 */
import * as THREE from 'three';
import { bodyKit } from '/src/art/body-kit.js';

/** Body parts by the dominant bone of a vertex. */
export const PARTS = {
  head: /^(head|neck)/i,
  chest: /^(spine_0[23]|clavicle)/i,
  hips: /^(pelvis|spine_01|thigh)/i,
  hands: /^(hand|lowerarm|index|middle|ring|pinky|thumb)/i,
  feet: /^(calf|foot|ball)/i,
};
/** The belt kit (bread bag, canteen, pouches: art/body-kit.js) is not the man: it may lie under him, in the ground. */

const DEPTH_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH_FS = 'uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).r, 0.0, 0.0, 1.0); }';
let _rt = null, _rtOut = null, _quad = null;

/** The meshes drawn as the ground: the terrain (its own material) + library decks (bridges) under the area. */
export function groundMeshes(G) {
  const out = [];
  const tm = G.mapHandle?.terrain?.terrain?.mesh || G.world?.terrain?.terrain?.mesh;
  if (tm) out.push(tm);
  return out;
}

/**
 * Height of the rendered ground over a square (cx ± half, cz ± half), res × res samples, from a GPU depth read-back.
 * @returns {{at:(x:number,z:number)=>number, half:number, res:number}}
 */
export function renderedGround(G, cx, cz, half = 2.5, res = 256) {
  const R = G.renderer.renderer, meshes = groundMeshes(G);
  const TOP = 300, NEAR = 1, FAR = 600;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, NEAR, FAR);
  cam.position.set(cx, TOP, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(true);
  if (!_rt || _rt.width !== res) {
    _rt?.dispose(); _rtOut?.dispose();
    _rt = new THREE.WebGLRenderTarget(res, res, { depthTexture: new THREE.DepthTexture(res, res, THREE.FloatType), depthBuffer: true });
    _rt.depthTexture.format = THREE.DepthFormat;
    _rtOut = new THREE.WebGLRenderTarget(res, res, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  }
  if (!_quad) {
    _quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null } }, vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, depthTest: false, depthWrite: false }));
    _quad.frustumCulled = false;
  }
  const prevRT = R.getRenderTarget(), prevAuto = R.autoClear, prevCol = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
  const saved = meshes.map((m) => [m, m.visible, m.frustumCulled]);
  try {
    R.autoClear = false; R.setClearColor(0x000000, 0);
    R.setRenderTarget(_rt); R.clear(true, true, true);
    // each ground mesh drawn on its own (in place in the scene graph: its parent's world matrix applies)
    for (const m of meshes) { m.visible = true; m.frustumCulled = false; R.render(m, cam); }
    _quad.material.uniforms.tDepth.value = _rt.depthTexture;
    R.setRenderTarget(_rtOut); R.clear(true, true, true); R.render(_quad, cam);
    const px = new Float32Array(res * res * 4);
    R.readRenderTargetPixels(_rtOut, 0, 0, res, res, px);
    const h = new Float32Array(res * res);
    for (let k = 0; k < res * res; k++) { const d = px[k * 4]; h[k] = d >= 0.999999 ? -Infinity : TOP - (NEAR + d * (FAR - NEAR)); }
    const at = (x, z) => {
      const i = Math.floor(((x - (cx - half)) / (2 * half)) * res), j = Math.floor((((cz + half) - z) / (2 * half)) * res);
      if (i < 0 || j < 0 || i >= res || j >= res) return NaN;
      return h[j * res + i];
    };
    return { at, half, res };
  } finally {
    for (const [m, v, fc] of saved) { m.visible = v; m.frustumCulled = fc; }
    R.setRenderTarget(prevRT); R.autoClear = prevAuto; R.setClearColor(prevCol, prevA);
  }
}

/** Lightest whole-body skinned LOD mesh of a real character. */
function bodyMesh(u) {
  let mesh = null;
  u.model?.real?.inner?.object?.traverse((o) => { if (o.isSkinnedMesh && /^LOD\d+$/.test(o.name) && (!mesh || o.geometry.attributes.position.count < mesh.geometry.attributes.position.count)) mesh = o; });
  return mesh;
}

/**
 * Gap (m) between each part of the drawn body and the ground under it: the lowest skinned vertex of the part over
 * the rendered ground (`gpu`) and over the world's surface (`cpu`, the grid's raised level + world.lyingY), and the
 * ground as drawn (`gap`: the terrain, or the walking surface where it stands over the terrain — a deck, a step, a
 * snow skirt), and the whole body (`all`); the belt kit left out.
 */
export function bodyGaps(G, u, { stride = 1, ground = null } = {}) {
  const w = G.world, mesh = bodyMesh(u);
  if (!mesh) return null;
  u.model.root.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name), kit = bodyKit(mesh).kit;
  const V = new THREE.Vector3(), verts = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < pos.count; k += stride) {
    if (kit[k]) continue;
    mesh.getVertexPosition(k, V).applyMatrix4(mesh.matrixWorld);
    let bi = 0, bw = -1;
    for (let c = 0; c < 4; c++) { const wt = sw.getComponent(k, c); if (wt > bw) { bw = wt; bi = si.getComponent(k, c); } }
    verts.push([V.x, V.y, V.z, names[bi] || '']);
    x0 = Math.min(x0, V.x); x1 = Math.max(x1, V.x); z0 = Math.min(z0, V.z); z1 = Math.max(z1, V.z);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, half = Math.max(x1 - x0, z1 - z0) / 2 + 0.3;
  const rg = ground || renderedGround(G, cx, cz, half, 256);
  const ey = u.y || 0;
  // the drawn surface right under a point (world.lyingY: no walkers' feet ring reaching up onto a kerb or a crate)
  const surf = (x, z) => (w.lyingY ? w.lyingY(x, z) : w.groundY ? w.groundY(x, z) : 0);
  const out = {};
  for (const k of ['all', ...Object.keys(PARTS)]) out[k] = { gap: Infinity, gpu: Infinity, cpu: Infinity };
  for (const [x, y, z, n] of verts) {
    const g = rg.at(x, z), c = (w.grid?.elevAt ? w.grid.elevAt(x, z) || 0 : ey) + surf(x, z);
    // the rendered ground: the terrain as drawn, or a deck / step / snow skirt standing over it (walking surface higher)
    const gpu = Number.isFinite(g) ? y - g : Infinity, cpu = y - c, gap = !Number.isFinite(g) || c - g > 0.03 ? cpu : gpu;
    const put = (o) => { if (gap < o.gap) o.gap = gap; if (gpu < o.gpu) o.gpu = gpu; if (cpu < o.cpu) o.cpu = cpu; };
    put(out.all);
    for (const p in PARTS) if (PARTS[p].test(n)) put(out[p]);
  }
  for (const k in out) for (const f in out[k]) out[k][f] = Number.isFinite(out[k][f]) ? +out[k][f].toFixed(3) : null;
  return out;
}

/** World positions of a few main bones and their height over the rendered / walking ground. */
export function boneGaps(G, u, ground = null) {
  const w = G.world, V = new THREE.Vector3(), out = {};
  const bones = ['pelvis', 'spine_03', 'head', 'hand_l', 'hand_r', 'foot_l', 'foot_r'];
  u.model.root.updateMatrixWorld(true);
  const rg = ground || renderedGround(G, u.x, u.z, 2.2, 256);
  for (const n of bones) {
    const b = u.model.real.getSocket(n);
    if (!b) continue;
    b.getWorldPosition(V);
    const g = rg.at(V.x, V.z);
    out[n] = { y: +V.y.toFixed(3), gpu: Number.isFinite(g) ? +(V.y - g).toFixed(3) : null, cpu: +(V.y - (w.lyingY ? w.lyingY(V.x, V.z) : w.groundY ? w.groundY(V.x, V.z) : 0) - (u.y || 0)).toFixed(3) };
  }
  return out;
}
