/**
 * Tree impostors (must-fix 11): forests beyond the unique-tree budget are drawn as camera-facing billboards baked
 * from real generated prototypes (K per species) at the game camera's pitch, from `views` azimuths.
 * Two atlases: albedo+alpha (sRGB) and view-space normals, so impostors are LIT at runtime by the same sun,
 * hemisphere and IBL as the 3D trees (no baked lighting), and cast alpha-tested shadows.
 * One draw call per forest (+1 shadow). Each instance keeps its own rotation (view pick), scale and tint.
 * @module terrain-final/impostors
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS } from '../../world/wind.js';

const _v = new THREE.Vector3();

/**
 * @param {THREE.WebGLRenderer} gl
 * @param {{key:string, bark:THREE.BufferGeometry|null, leaf:THREE.BufferGeometry|null}[]} protos tree-local geometry (root at origin)
 * @param {{barkMat:THREE.Material, leafMat:THREE.Material, leafNormalMat:THREE.Material, U:object}} mats vegetation materials
 * @param {{views?:number, tile?:number, pitch?:number}} [o] pitch = camera elevation (rad)
 */
export function bakeImpostors(gl, protos, mats, o = {}) {
  const views = o.views ?? 8, tile = o.tile ?? 256, pitch = o.pitch ?? THREE.MathUtils.degToRad(40);
  const n = protos.length * views, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const mk = (srgb) => {
    const rt = new THREE.WebGLRenderTarget(cols * tile, rows * tile, { depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return rt;
  };
  const rtA = mk(true), rtN = mk(false);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const bark = new THREE.Mesh(undefined, mats.barkMat), leaf = new THREE.Mesh(undefined, mats.leafMat);
  scene.add(bark, leaf);
  const nBark = new THREE.MeshNormalMaterial();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const meta = [];
  const prev = { rt: gl.getRenderTarget(), auto: gl.autoClear, cc: gl.getClearColor(new THREE.Color()), ca: gl.getClearAlpha(), sc: gl.getScissorTest() };
  const wind = mats.U.uWindStr.value, bake = mats.U.uBake;
  mats.U.uWindStr.value = 0;
  gl.autoClear = false;
  gl.setClearColor(0x000000, 0);
  for (const r of [rtA, rtN]) { gl.setRenderTarget(r); gl.clear(); }
  protos.forEach((P, i) => {
    // framing: max projected extent over all views, root at (0.5, v0) of the tile
    let hx = 0.5, ylo = 0, yhi = 1;
    for (let v = 0; v < views; v++) {
      const az = (v / views) * Math.PI * 2;
      const R = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const Uv = new THREE.Vector3(-Math.sin(az) * Math.sin(pitch), Math.cos(pitch), -Math.cos(az) * Math.sin(pitch));
      for (const g of [P.bark, P.leaf]) {
        if (!g) continue;
        const a = g.attributes.position.array;
        for (let k = 0; k < a.length; k += 9) { // every 3rd vertex is plenty for bounds
          _v.fromArray(a, k);
          hx = Math.max(hx, Math.abs(_v.dot(R))); const y = _v.dot(Uv); ylo = Math.min(ylo, y); yhi = Math.max(yhi, y);
        }
      }
    }
    const S = Math.max(2 * hx, yhi - ylo) * 1.04, v0 = (-ylo + (S - (yhi - ylo)) / 2) / S;
    meta.push({ key: P.key, S, v0 });
    bark.geometry = P.bark || new THREE.BufferGeometry(); bark.visible = !!P.bark;
    leaf.geometry = P.leaf || new THREE.BufferGeometry(); leaf.visible = !!P.leaf;
    for (let v = 0; v < views; v++) {
      const t = i * views + v, tx = (t % cols) * tile, ty = Math.floor(t / cols) * tile;
      const az = (v / views) * Math.PI * 2;
      cam.position.set(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), Math.cos(az) * Math.cos(pitch)).multiplyScalar(150);
      cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
      cam.left = -S / 2; cam.right = S / 2; cam.bottom = -v0 * S; cam.top = (1 - v0) * S;
      cam.updateProjectionMatrix();
      for (const [rt, pass] of [[rtA, 0], [rtN, 1]]) {
        gl.setRenderTarget(rt);
        rt.viewport.set(tx, ty, tile, tile); rt.scissor.set(tx, ty, tile, tile); rt.scissorTest = true;
        gl.setRenderTarget(rt);
        bark.material = pass ? nBark : mats.barkMat;
        leaf.material = pass ? mats.leafNormalMat : mats.leafMat;
        bake.value = pass ? 0 : 1;
        gl.render(scene, cam);
      }
    }
  });
  for (const r of [rtA, rtN]) { r.viewport.set(0, 0, r.width, r.height); r.scissor.set(0, 0, r.width, r.height); r.scissorTest = false; }
  bake.value = 0;
  mats.U.uWindStr.value = wind;
  gl.setRenderTarget(prev.rt); gl.autoClear = prev.auto; gl.setClearColor(prev.cc, prev.ca); gl.setScissorTest(prev.sc);
  nBark.dispose();
  return { albedo: rtA, normal: rtN, cols, rows, tile, views, meta, bytes: rtA.width * rtA.height * 16 }; // 2× RGBA8 + 2× depth24s8
}

const IMP_PARS = WIND_GLSL + /* glsl */ `
attribute vec4 iPos;   // x, y, z, rotation (rad)
attribute vec4 iDat;   // proto index, scale, brightness, unused
uniform sampler2D tImpA;
uniform vec4 uAtlas;   // cols, rows, views, 1/views
uniform vec2 uProto[64]; // S (m), v0
varying vec2 vAtlasUv;
varying float vBright;
`;
const IMP_VERT = /* glsl */ `
vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 camB = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
int pi = int(iDat.x + 0.5);
float S = uProto[pi].x * iDat.y, v0 = uProto[pi].y;
float az = atan(camB.x, camB.z) - iPos.w;
float vi = mod(floor(az * uAtlas.z / 6.2831853 + 0.5), uAtlas.z);
float t = float(pi) * uAtlas.z + vi;
vec2 cell = vec2(mod(t, uAtlas.x), floor(t / uAtlas.x));
vAtlasUv = (cell + uv) / uAtlas.xy;
vBright = iDat.z;
vec3 transformed = iPos.xyz + camR * ((uv.x - 0.5) * S) + camU * ((uv.y - v0) * S);
// step 4w: distant trees keep bending with the same wind as the unique ones (trunk lean + natural-frequency sway)
vec4 iw = windSample(iPos.xz);
float iws = windStr(iw), ihh = max(uv.y - v0, 0.0) * S / max(S * (1.0 - v0), 0.5);
vec2 iwd = length(iw.xy) > 1e-3 ? normalize(iw.xy) : uWindA.xy;
float if0 = clamp(3.5 / max(S * (1.0 - v0), 1.0), 0.18, 1.3);
float ilean = iws * iws * 0.1 + iw.z * 0.04 * (0.3 + iws) + sin(6.2831 * if0 * uWindA.w + iPos.w * 3.0 + iPos.x * 0.37) * (0.01 + 0.045 * iws + 0.05 * iw.z);
transformed.xz += iwd * ilean * S * (1.0 - v0) * ihh * ihh;
`;

/**
 * Instanced impostor forest.
 * @param {ReturnType<typeof bakeImpostors>} bank
 * @param {{x:number,y:number,z:number,rot:number,proto:number,scale:number,bright:number}[]} inst
 */
export function createImpostorMesh(bank, inst) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const P = new Float32Array(inst.length * 4), D = new Float32Array(inst.length * 4);
  const box = new THREE.Box3();
  inst.forEach((t, i) => {
    P.set([t.x, t.y, t.z, t.rot], i * 4); D.set([t.proto, t.scale, t.bright, 0], i * 4);
    box.expandByPoint(_v.set(t.x, t.y, t.z));
  });
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(P, 4));
  g.setAttribute('iDat', new THREE.InstancedBufferAttribute(D, 4));
  g.instanceCount = inst.length;
  box.expandByScalar(Math.max(...bank.meta.map((m) => m.S)));
  g.boundingBox = box; g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const U = {
    ...WIND_UNIFORMS,
    tImpA: { value: bank.albedo.texture }, tImpN: { value: bank.normal.texture },
    uAtlas: { value: new THREE.Vector4(bank.cols, bank.rows, bank.views, 1 / bank.views) },
    uProto: { value: Array.from({ length: 64 }, (_, i) => new THREE.Vector2(bank.meta[i]?.S ?? 1, bank.meta[i]?.v0 ?? 0)) },
  };
  const vert = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = IMP_PARS + sh.vertexShader.replace('#include <begin_vertex>', IMP_VERT);
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    vert(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);');
    sh.fragmentShader = 'uniform sampler2D tImpA;\nuniform sampler2D tImpN;\nvarying vec2 vAtlasUv;\nvarying float vBright;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', 'vec4 impA = texture2D(tImpA, vAtlasUv); if (impA.a < 0.5) discard; diffuseColor.rgb = impA.rgb * vBright;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(texture2D(tImpN, vAtlasUv).xyz * 2.0 - 1.0);');
  };
  mat.customProgramCacheKey = () => 'impostor';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    vert(sh);
    sh.fragmentShader = 'uniform sampler2D tImpA;\nvarying vec2 vAtlasUv;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (texture2D(tImpA, vAtlasUv).a < 0.5) discard;');
  };
  depth.customProgramCacheKey = () => 'impostor-depth';
  const mesh = new THREE.Mesh(g, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.aoExclude = true;
  mesh.name = 'vegImpostors';
  return mesh;
}
