/**
 * Depth-pass merging (render efficiency). A library building is one glTF mesh per node with one primitive per
 * material, so three draws it as ~10–25 sibling meshes, and every one of them is drawn again by the two passes that only
 * need its shape: the sun shadow map (depth) and the GTAO normal/depth prepass (one stock MeshNormalMaterial for every
 * opaque mesh, engine/gtao-alpha.js). `addDepthMerge(root)` gives each such group of static siblings ONE extra mesh —
 * its primitives' positions and normals concatenated, raw (same quantised types), same local matrix — that draws in
 * those two passes instead of them. The colour pass is untouched.
 *
 * The pixels do not change: the depth pass writes the same triangles with the same matrices and depth material (the
 * stock one: only side / shadowSide, alphaTest, maps, displacement and clipping change it, and members must use the
 * plain case with the same shadow side), and the AO prepass draws them with the same stock normal material.
 *
 * Mechanism:
 *  - the proxy (`DepthProxyMesh`, or `DepthProxyInstancedMesh` for createBuildingBatch) is a mesh only while a depth
 *    pass renders: `isMesh` is false otherwise, so the colour pass, the water mirror, x-ray, raycasts and every scene
 *    walk (clip audit, nav, drape stripping, burnt-material swaps) never see it — as chunking's proxy;
 *  - `inDepthPass(kind, fn)` brackets those passes (the renderer's shadow map render, the GTAO prepass); inside one, a
 *    member mesh is culled while its group is valid and the proxy is drawn in its place, culled by its own bounds
 *    (they hold every member's: whenever a member would be drawn, the proxy is);
 *  - a group is valid in a pass while every member is still there and drawable as at merge time: visible, same
 *    geometry, matrix and layers, and for the shadow pass castShadow and a plain depth material of the same shadow side;
 *    for the AO prepass the stock normal material (GTAO marks its stock variants `userData.aoStock`). Anything else (an
 *    instance hides a part, swaps a geometry, gets a cut-out material) → that group falls back to its members in that
 *    pass, which is exactly the unmerged behaviour. Checked once per pass and group.
 * Built once per loaded template (art/building-library.js loadLod): clones share the proxy geometry.
 * @module engine/depth-merge
 */
import * as THREE from 'three';
import { isShadowVariant } from './program-variants.js';

let depth = 0;      // > 0 while a depth-only pass renders
let kind = '';      // 'shadow' | 'ao' (innermost)
let serial = 0;     // one per depth pass: validity cache key
let enabled = true; // off: every proxy skipped, every member drawn (the unmerged frame; A/B timing, debugging)
let kinds = { shadow: true, ao: true };
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

/** Run fn as a depth-only render: 'shadow' (sun shadow map) or 'ao' (GTAO normal/depth prepass). */
export function inDepthPass(k, fn) {
  const k0 = kind;
  depth++; serial++; kind = k;
  try { return fn(); } finally { depth--; serial++; kind = k0; }
}
const on = () => enabled && kinds[kind] !== false;

/** Turn the merged depth draws on / off at runtime (off = exactly the unmerged passes), optionally per pass kind. */
export function setDepthMerge(on, { shadow = true, ao = true } = {}) { enabled = !!on; kinds = { shadow, ao }; }

/** Side the shadow map draws a material with (WebGLShadowMap.getDepthMaterial, PCF). */
const shadowSideOf = (m) => (m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : SHADOW_SIDE[m.side]);

/** Does the shadow map draw this material with the plain shared depth material (only its side varies)? */
function plainDepth(o, m) {
  return !!m && !Array.isArray(m) && m.visible && !m.wireframe && !(m.alphaTest > 0) && m.alphaToCoverage !== true
    && !(m.displacementMap && m.displacementScale !== 0) && !(m.clippingPlanes && m.clippingPlanes.length)
    && (o.customDepthMaterial === undefined || isShadowVariant(o.customDepthMaterial)); // (program-variants: same output)
}

const PROTO_HOOKS = THREE.Object3D.prototype;
/** Can this mesh's depth passes be drawn by a merged proxy? (static, opaque, plain depth, stock AO) */
function mergeable(o) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || o.isDepthProxy) return false;
  if (!o.visible || !o.castShadow || o.frustumCulled === false || o.renderOrder !== 0) return false;
  const ud = o.userData;
  if (ud.aoExclude || ud.aoMaterial || ud.depthGroup !== undefined || ud.noDepthMerge) return false;
  if (o.onBeforeRender !== PROTO_HOOKS.onBeforeRender || o.onBeforeShadow !== PROTO_HOOKS.onBeforeShadow) return false;
  const m = o.material;
  if (!plainDepth(o, m) || m.transparent || m.userData?.aoMaterial) return false;
  const g = o.geometry, p = g?.attributes?.position, n = g?.attributes?.normal;
  if (!p || !n || g.isInstancedBufferGeometry || (g.morphAttributes && Object.keys(g.morphAttributes).length)) return false;
  const full = g.index ? g.index.count : p.count;
  if (g.drawRange.start !== 0 || (g.drawRange.count !== Infinity && g.drawRange.count < full)) return false;
  return true;
}

/** Elements per vertex in the merged buffer: the source's stride (meshopt pads 3 × int16 / int8 to 4) — the proxy
 *  fetches its vertices with the same layout as its members (no unaligned 6- or 3-byte strides). */
const strideOf = (a) => (a.isInterleavedBufferAttribute ? a.data.stride : a.itemSize);
const layout = (a) => `${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}/${a.itemSize}/${a.normalized}/${strideOf(a)}`;

/** Raw element copy of an attribute (interleaved or not) into `out` (stride `st`) at vertex `at`. */
function copyRaw(a, out, st, at) {
  const n = a.itemSize;
  const src = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  const sst = strideOf(a), off = a.isInterleavedBufferAttribute ? a.offset : 0;
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[(at + i) * st + k] = src[i * sst + off + k];
}

/** One merged position + normal geometry (raw attribute types and vertex strides kept) of `list`. */
function mergedGeometry(list) {
  let verts = 0, idx = 0;
  for (const o of list) { const g = o.geometry; verts += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a0 = list[0].geometry.attributes[name], Arr = (a0.isInterleavedBufferAttribute ? a0.data.array : a0.array).constructor;
    const st = strideOf(a0), out = new Arr(verts * st);
    let at = 0;
    for (const o of list) { const a = o.geometry.attributes[name]; copyRaw(a, out, st, at); at += a.count; }
    geo.setAttribute(name, st === a0.itemSize ? new THREE.BufferAttribute(out, a0.itemSize, a0.normalized)
      : new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(out, st), a0.itemSize, 0, a0.normalized));
  }
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(idx);
  let base = 0, at = 0;
  for (const o of list) {
    const g = o.geometry, n = g.attributes.position.count;
    if (g.index) { const s = g.index.array; for (let i = 0; i < g.index.count; i++) index[at + i] = s[i] + base; at += g.index.count; }
    else { for (let i = 0; i < n; i++) index[at + i] = i + base; at += n; }
    base += n;
  }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Proxy materials, one per drawn side (never drawn in colour; colorWrite / depthWrite off in case one ever is). */
const MATS = new Map();
function proxyMaterial(side, shadowSide) {
  const k = `${side}/${shadowSide}`;
  let m = MATS.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false });
    m.shadowSide = shadowSide;
    m.name = 'depth-merge';
    m.userData.depthMergeShared = true;
    MATS.set(k, m);
  }
  return m;
}

const isMeshInDepth = { get() { return depth > 0; }, set() {}, configurable: true };

/** Merged depth-pass stand-in for a group of sibling meshes (a mesh only during depth passes). */
export class DepthProxyMesh extends THREE.Mesh {
  get isDepthProxy() { return true; }
  raycast() {}
}
Object.defineProperty(DepthProxyMesh.prototype, 'isMesh', isMeshInDepth);

/** The same for an InstancedMesh batch (art/building-library.js createBuildingBatch). */
export class DepthProxyInstancedMesh extends THREE.InstancedMesh {
  get isDepthProxy() { return true; }
  raycast() {}
}
Object.defineProperty(DepthProxyInstancedMesh.prototype, 'isMesh', isMeshInDepth);

let groupSeq = 0;
/**
 * Add a depth proxy for every group of >= `min` mergeable sibling meshes under `root` (same parent, local matrix,
 * attribute layout and shadow side). Members are tagged (userData.depthGroup / depthGeo), the proxy appended after
 * them. Idempotent (tagged meshes are skipped). `exclude(mesh)`: meshes an instance will edit (own geometry, …) — they
 * would only make their group fall back. @returns {{groups: number, members: number}}
 */
export function addDepthMerge(root, { min = 2, exclude = null } = {}) {
  installDepthMerge();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.parent || !mergeable(o) || exclude?.(o)) return;
    const g = o.geometry, m = o.material;
    const key = `${o.parent.uuid}|${o.matrix.elements.join(',')}|${layout(g.attributes.position)}|${layout(g.attributes.normal)}|${shadowSideOf(m)}`;
    let e = groups.get(key);
    if (!e) groups.set(key, (e = { parent: o.parent, list: [], side: m.side, shadowSide: shadowSideOf(m) }));
    e.list.push(o);
  });
  let n = 0, members = 0;
  for (const { parent, list, side, shadowSide } of groups.values()) {
    if (list.length < min) continue;
    const id = `dm${++groupSeq}`;
    const proxy = new DepthProxyMesh(mergedGeometry(list), proxyMaterial(side, shadowSide));
    proxy.name = 'depth-merge';
    proxy.matrix.copy(list[0].matrix);
    proxy.matrix.decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.castShadow = true; proxy.receiveShadow = false;
    proxy.userData = { depthGroup: id, depthCount: list.length, depthSide: shadowSide, clip: false };
    for (const o of list) { o.userData.depthGroup = id; o.userData.depthGeo = o.geometry.uuid; }
    parent.add(proxy);
    n++; members += list.length;
  }
  return { groups: n, members };
}

/** Is a (member or proxy) material drawable by the merged proxy in the current pass? */
function memberOk(o, side) {
  if (kind === 'shadow') return o.castShadow && plainDepth(o, o.material) && shadowSideOf(o.material) === side;
  return o.material?.userData?.aoStock === true; // GTAO swapped it to a stock normal variant (not a cut-out / custom)
}

/** Can the proxy stand in for its group in this pass? (cached per pass) */
function groupOk(p) {
  if (p.__ds === serial) return p.__dok;
  p.__ds = serial;
  let ok = false;
  const par = p.parent, ud = p.userData;
  if (par && p.visible && memberOk(p, ud.depthSide)) {
    const g = ud.depthGroup, me = p.matrix.elements;
    let n = 0;
    ok = true;
    for (const c of par.children) {
      if (c === p || c.userData.depthGroup !== g) continue;
      n++;
      if (!c.isMesh || !c.visible || c.geometry?.uuid !== c.userData.depthGeo || !c.layers.test(p.layers) || !memberOk(c, ud.depthSide)) { ok = false; break; }
      const ce = c.matrix.elements;
      for (let i = 0; i < 16; i++) if (ce[i] !== me[i]) { ok = false; break; }
      if (!ok) break;
    }
    ok = ok && n === ud.depthCount;
  }
  p.__dok = ok;
  return ok;
}

/** The proxy of a member mesh (its sibling with the same group), cached. */
function proxyOf(o, g) {
  const par = o.parent;
  if (o.__dp && o.__dp.parent === par) return o.__dp;
  o.__dp = null;
  if (par) for (const c of par.children) if (c.isDepthProxy && c.userData.depthGroup === g) { o.__dp = c; break; }
  return o.__dp;
}

let installed = false;
/**
 * Patch Mesh.prototype.intersectsFrustum (idempotent): during a depth pass, a member of a valid group is culled and its
 * proxy drawn; outside depth passes nothing changes (one integer compare).
 */
export function installDepthMerge() {
  if (installed) return;
  installed = true;
  const orig = THREE.Mesh.prototype.intersectsFrustum;
  THREE.Mesh.prototype.intersectsFrustum = function intersectsFrustumDepthMerge(frustum) {
    if (depth > 0) {
      const g = this.userData.depthGroup;
      if (g !== undefined) {
        if (this.isDepthProxy) { if (!on() || !groupOk(this)) return false; } else if (on()) {
          const p = proxyOf(this, g);
          if (p && groupOk(p)) return false; // the proxy draws it
        }
      }
    }
    return orig.call(this, frustum);
  };
}

/** Bracket the renderer's shadow map renders as depth passes (once per renderer). */
export function installShadowDepthPass(renderer) {
  installDepthMerge();
  const sm = renderer.shadowMap;
  if (sm.__depthMerge) return;
  sm.__depthMerge = true;
  const render = sm.render;
  sm.render = function shadowRenderDepthMerge(...a) { return inDepthPass('shadow', () => render.apply(this, a)); };
}

/**
 * Instanced copy of a template proxy for createBuildingBatch: same geometry / material / group tags, drawn with its
 * first member's instance matrices (the same attribute); its bounds computed here, over every instance.
 */
export function instancedProxy(o, first) {
  const im = new DepthProxyInstancedMesh(o.geometry, o.material, first.count);
  im.name = o.name;
  im.castShadow = true; im.receiveShadow = false;
  im.userData = { ...o.userData };
  im.instanceMatrix = first.instanceMatrix;
  im.computeBoundingBox();
  im.computeBoundingSphere();
  return im;
}
