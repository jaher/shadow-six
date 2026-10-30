/**
 * Kit instancing (perf/characters-detail): the small rigid meshes a German carries — his squad kit extras (mess tin,
 * Zeltbahn roll, entrenching tool, gas-cape pouch: characters/commandos_b/squad_extras.js) and his gun — drawn as ONE
 * InstancedMesh per (geometry, material) for every man on the map, instead of one draw call per mesh per pass.
 *
 * At the default zoom the owner keeps every soldier on full detail (HALF_RATE_PX 40, commit 583a851bb): ~5 kit extras
 * and a gun per enemy, each drawn in the main pass and again in the GTAO normal prepass (the gun in the shadow map
 * too) — 6-7 of the ~10 draw calls each man cost a frame. Batched, the whole platoon's kit is ~10 draws a pass.
 *
 * The meshes stay where they are (parented to bones / the unit root): every pose, hand-over, drop and hide keeps
 * working on them. Only their draw moves, and only inside a drawn frame (Game.render's draw block, where every world
 * matrix and visibility of the frame is final): kitBegin() copies the world matrix of each mesh whose chain is visible
 * into its batch and takes the mesh off every camera's layers; kitEnd() puts the layers back and hides the batches.
 * Any render outside that block (load-time warm-ups that do not ask for the batches, tools) draws the meshes as before.
 * Inside it, the scope lens' valid target is drawn by his own meshes for the rest of the frame (kitSolo: its highlight
 * draws him again over himself, depth-equal, which the instanced transform would miss by float rounding), and the
 * batches' root is flagged userData.lensKeep: its instances move without it, so the lens must not cull it whole by
 * bounds cached in its own frame.
 * @module art/kit-batch
 */
import * as THREE from 'three';

const groups = new Map();           // `${geometry.uuid}|${material.uuid}` -> group
const member = new Map();           // mesh -> group
const hidden = [];                  // [mesh, mask, …] taken off the layers by kitBegin
const outs = [];                    // [group, batch, …] holding kitSolo's man this frame
const OBR = THREE.Object3D.prototype.onBeforeRender;
const root = new THREE.Group();
root.name = 'kit-batch';
root.matrixAutoUpdate = false; root.matrixWorldAutoUpdate = false;
root.visible = false;
// its instances are the men's, in world space: the root never moves while they do, so bounds cached in its own frame go
// stale (the scope lens culls whole top-level subtrees that way: render/scope-magnifier.js) — never culled whole
root.userData.lensKeep = true;
/** Frames a registered mesh may stay off the scene before it is forgotten (then it draws on its own again). */
const STALE = 600;

/** Can this mesh be drawn as an instance? (one opaque material on layer 0 only, no per-object draw hooks) */
function batchable(m) {
  const mat = m.material;
  return m.isMesh && !m.isSkinnedMesh && !m.isInstancedMesh && !m.isBatchedMesh && mat && !Array.isArray(mat)
    && !mat.transparent && m.layers.mask === 1 && !m.morphTargetInfluences && m.onBeforeRender === OBR
    && !m.customDepthMaterial && !m.customDistanceMaterial && !m.userData.aoMaterial && m.renderOrder === 0 && m.geometry?.isBufferGeometry;
}

/**
 * Draw these meshes batched from now on (the rest of `meshes` is left alone). @param {Iterable<THREE.Mesh>} meshes
 * @returns {number} meshes registered
 */
export function registerKit(meshes) {
  let n = 0;
  for (const m of meshes) {
    if (member.has(m) || !batchable(m)) continue;
    const key = `${m.geometry.uuid}|${m.material.uuid}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, geometry: m.geometry, material: m.material, members: new Set(), proxies: new Map(), solo: new Map() }));
    g.members.add(m); member.set(m, g); m.userData.kitBatched = true; m._kitOff = 0; m._kitMask = 0; m._kitI = 0; m._kitK = 0;
    n++;
  }
  return n;
}

/** Stop batching these meshes (a disposed man). @param {Iterable<THREE.Mesh>} meshes */
export function unregisterKit(meshes) {
  for (const m of meshes) {
    const g = member.get(m); if (!g) continue;
    g.members.delete(m); member.delete(m); delete m.userData.kitBatched;
    if (!g.members.size) dropGroup(g);
  }
}

function dropGroup(g) {
  for (const p of [...g.proxies.values(), ...g.solo.values()]) { p.removeFromParent(); p.dispose(); }
  g.proxies.clear(); g.solo.clear();
  groups.delete(g.key);
}

/** Forget every batch (mission unload). */
export function disposeKit() {
  kitEnd();
  for (const g of [...groups.values()]) { for (const m of g.members) { member.delete(m); delete m.userData.kitBatched; } dropGroup(g); }
}

function proxy(g, cast, recv, noAo, need) {
  const k = (cast ? 1 : 0) | (recv ? 2 : 0) | (noAo ? 4 : 0);
  let p = g.proxies.get(k);
  if (p && p.instanceMatrix.count >= need) return p;
  const cap = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(need, (p?.instanceMatrix.count || 0) * 2))));
  if (p) { p.removeFromParent(); p.dispose(); }
  p = batchMesh(g, k, cap, 'kit-batch:');
  g.proxies.set(k, p);
  return p;
}

function batchMesh(g, k, cap, name) {
  const p = new THREE.InstancedMesh(g.geometry, g.material, cap);
  p.name = name + (g.material.name || g.geometry.type);
  p.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  p.frustumCulled = false;                       // the men are culled by their own visibility (see kitBegin)
  p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false;
  p.castShadow = !!(k & 1); p.receiveShadow = !!(k & 2);
  p.userData.aoExclude = !!(k & 4); p.userData.noXray = true;
  p.count = 0; p._n = 0; p._k = k; p._out = [];
  root.add(p);
  return p;
}

/** Is `m` drawn in `scene` this frame (it and every ancestor visible, the chain reaching the scene)? */
function drawnIn(m, scene) {
  for (let o = m; o; o = o.parent) {
    if (!o.visible) return 0;
    if (o === scene) return 1;
  }
  return -1;   // off the scene
}

let open = false;
/**
 * Draw the batches in the passes that follow (Game.render, after the frame's scene.updateMatrixWorld()): fill them
 * from the registered meshes visible in `scene`, take those meshes off the layers. `keep`: the load's warm-up frame
 * draws the meshes too — their own programs exist for any draw outside a frame (an end card, a tool).
 * @param {THREE.Scene} scene @param {boolean} [keep]
 */
export function kitBegin(scene, keep = false) {
  if (open) kitEnd();
  if (!groups.size || !scene) return;
  open = true;
  if (root.parent !== scene) scene.add(root);
  root.visible = true;
  let rekey = null;
  for (const g of groups.values()) {
    for (const p of g.proxies.values()) { p._n = 0; p._out.length = 0; }
    for (const c of g.solo.values()) c.visible = false;
    let stale = null;
    for (const m of g.members) {
      // a mesh given another material / geometry (a stained variant…) moves to its batch; one on other layers draws itself
      // (a per-draw hook — blood/stains.js feeds each man's stains in onBeforeRender — needs the mesh's own draw)
      if (m.material !== g.material || m.geometry !== g.geometry || m.onBeforeRender !== OBR) { (rekey ||= []).push(m); continue; }
      const d = drawnIn(m, scene);
      if (d !== 1 || m.layers.mask !== 1) {
        if (d < 0 && ++m._kitOff > STALE) (stale ||= []).push(m);
        continue;
      }
      m._kitOff = 0;
      const p0 = g.proxies.get((m.castShadow ? 1 : 0) | (m.receiveShadow ? 2 : 0) | (m.userData.aoExclude ? 4 : 0));
      const p = p0 && p0._n < p0.instanceMatrix.count ? p0 : grow(g, m, p0);
      p.instanceMatrix.array.set(m.matrixWorld.elements, p._n * 16);
      m._kitI = p._n; m._kitK = p._k;   // its slot (kitSolo)
      p._n++;
      if (keep) continue;
      hidden.push(m, m.layers.mask);
      m._kitMask = m.layers.mask;
      m.layers.mask = 0;
    }
    for (const p of g.proxies.values()) {
      p.count = p._n;
      p.visible = p._n > 0;
      // the men move: bounds a pass computed over last frame's instances (a reach / mirror cull asks for them lazily)
      // would miss this frame's — unset, they are computed again over these instances when asked
      p.boundingBox = null; p.boundingSphere = null;
      if (p._n) { p.instanceMatrix.clearUpdateRanges(); p.instanceMatrix.addUpdateRange(0, p._n * 16); p.instanceMatrix.needsUpdate = true; }
    }
    if (stale) unregisterKit(stale);
  }
  if (rekey) { unregisterKit(rekey); registerKit(rekey); }   // (batched from the next frame)
}

/** A batch with room for one more instance (its filled part carried over). */
function grow(g, m, p0) {
  const n = p0 ? p0._n : 0, old = p0 ? p0.instanceMatrix.array.slice(0, n * 16) : null;
  const p = proxy(g, m.castShadow, m.receiveShadow, !!m.userData.aoExclude, n + 1);
  if (old) p.instanceMatrix.array.set(old, 0);
  p._n = n;
  return p;
}

/** The frame's passes are done: the meshes back on their layers, the batches hidden. */
export function kitEnd() {
  if (!open) return;
  open = false;
  for (let i = 0; i < hidden.length; i += 2) { hidden[i].layers.mask = hidden[i + 1]; hidden[i]._kitMask = 0; }
  hidden.length = 0;
  root.visible = false;
}

/**
 * One man drawn by his own meshes for the rest of a drawn frame — the scope lens' valid target: its highlight draws him
 * again over himself with a depth-equal test, which his batched kit (instance × world in the shader) would fail here
 * and there by float rounding, and his own subtree pass would miss it. His kit goes back on the layers; each batch
 * holding some of it is swapped, for the passes still to come, for a copy without his instances (three uploads an
 * instanced mesh's matrices once per frame number — the lens draws at the main frame's — so the batch itself cannot be
 * changed now). @param {THREE.Object3D} obj @returns {number} meshes
 */
export function kitSolo(obj) {
  if (!open || !obj) return 0;
  let n = 0;
  obj.traverse((m) => {
    if (!m._kitMask) return;
    m.layers.mask = m._kitMask; m._kitMask = 0;   // (kitEnd puts back the same mask)
    n++;
    const g = member.get(m), p = g?.proxies.get(m._kitK);
    if (!p || m._kitI >= p.count) return;
    if (!outs.includes(p)) outs.push(g, p);
    p._out.push(m._kitI);   // (kept for the frame: a second man soloed later leaves the first out too)
  });
  for (let i = 0; i < outs.length; i += 2) {
    const g = outs[i], p = outs[i + 1], skip = p._out.sort((a, b) => a - b);
    let c = g.solo.get(p._k);
    if (!c || c.instanceMatrix.count < p.instanceMatrix.count) {
      if (c) { c.removeFromParent(); c.dispose(); }
      g.solo.set(p._k, (c = batchMesh(g, p._k, p.instanceMatrix.count, 'kit-batch-solo:')));
    }
    const src = p.instanceMatrix.array, dst = c.instanceMatrix.array;
    let from = 0, at = 0;
    for (let s = 0; s <= skip.length; s++) {
      const to = s < skip.length ? skip[s] : p.count;
      if (to > from) { dst.set(src.subarray(from * 16, to * 16), at * 16); at += to - from; }
      from = to + 1;
    }
    c.count = at; c.visible = at > 0; p.visible = false;
    c.boundingBox = null; c.boundingSphere = null;
    c.instanceMatrix.clearUpdateRanges();
    if (at) { c.instanceMatrix.addUpdateRange(0, at * 16); c.instanceMatrix.needsUpdate = true; }
  }
  outs.length = 0;
  return n;
}

/** Debug / tests: batches, instances drawn, registered meshes. */
export function kitStats() {
  let batches = 0, drawn = 0;
  for (const g of groups.values()) for (const p of g.proxies.values()) if (p.count) { batches++; drawn += p.count; }
  return { groups: groups.size, batches, drawn, registered: member.size };
}
