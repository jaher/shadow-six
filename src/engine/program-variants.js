/**
 * One material per program variant for the shared "override" materials (sun shadow depth, GTAO normals).
 *
 * three.js keeps ONE compiled program per material at a time. A material drawn for static, instanced, skinned or
 * morphing objects in turn (three's own shadow depth material, the GTAO normal material) is re-derived at every switch
 * (`getProgram`: program parameters + cache key string, ~30 µs), dozens of times per frame. `variantKey(object)` names
 * the object features that select a different program; `VariantCache.get(base, key)` hands out one clone of `base` per
 * key, so each clone always sees the same kind of object and keeps its program. Same shaders, same output.
 *
 * `assignShadowVariants(scene)` gives every shadow-casting mesh whose materials take three's default depth material
 * (no alpha-tested map, displacement, clip-shadows or alpha-to-coverage, no custom depth material) a MeshDepthMaterial
 * per object kind and depth state (`depthState`: side, copied maps) as `customDepthMaterial` — three then applies the
 * same per-draw state (side, maps, visibility) to it as to its own default.
 * @module engine/program-variants
 */
import * as THREE from 'three';

/** Program-relevant object features ('' = a plain static mesh). Interned: the same string object per feature set (asked
 *  for every mesh of every override pass, every frame — a string built each time was a stream of garbage). */
const KEYS = new Map();
export function variantKey(o) {
  const ma = o.geometry?.morphAttributes;
  const mp = ma?.position?.length || 0, mn = ma?.normal ? 1 : 0, mc = ma?.color ? 1 : 0;
  let bits = 0;
  if (o.isInstancedMesh) bits |= 1 | (o.instanceColor ? 2 : 0) | (o.morphTexture ? 4 : 0);
  if (o.isSkinnedMesh) bits |= 8;
  if (o.isBatchedMesh) bits |= 16 | (o._colorsTexture ? 32 : 0);
  if (!bits && !mp && !mn && !mc) return '';
  const id = bits | (mn << 6) | (mc << 7) | (mp << 8);
  let k = KEYS.get(id);
  if (k === undefined) {
    k = '';
    if (bits & 1) k += 'i' + (bits & 2 ? 'c' : '') + (bits & 4 ? 'm' : '');
    if (bits & 8) k += 's';
    if (bits & 16) k += 'b' + (bits & 32 ? 'c' : '');
    if (mp || mn || mc) k += `m${mp}${mn ? 'n' : ''}${mc ? 'c' : ''}`;
    KEYS.set(id, k);
  }
  return k;
}

export class VariantCache {
  constructor() { this.map = new WeakMap(); }
  /** @param {THREE.Material} base @param {string} key @returns {THREE.Material} base itself for key '' */
  get(base, key) {
    if (!key) return base;
    let m = this.map.get(base);
    if (!m) this.map.set(base, (m = new Map()));
    let v = m.get(key);
    if (!v) {
      v = base.clone();
      // Material#copy leaves the shader hooks out: same shader source
      if (Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')) v.onBeforeCompile = base.onBeforeCompile;
      if (Object.prototype.hasOwnProperty.call(base, 'customProgramCacheKey')) v.customProgramCacheKey = base.customProgramCacheKey;
      v.name = (base.name || base.type) + ':' + key;
      m.set(key, v);
    }
    return v;
  }
}

/**
 * What else picks a depth program among casters of one kind: the side three gives the shadow and the maps it copies
 * onto the depth material before each draw (getDepthMaterial). A program is only re-derived when the side, instancing
 * or skinning change, so a depth material shared by casters with and without maps, or of different sides, links the
 * variant of whichever caster it re-derives on, under the lights of that moment: new programs mid-play whenever the
 * camera first brings an unusual caster into the shadow (M3: the telegraph wires, a sentry's rifle). One per state.
 */
function depthState(o) {
  let k = '';
  for (const m of [].concat(o.material)) if (m) k += `${m.shadowSide ?? 's' + m.side}${m.map ? 'm' : ''}${m.alphaMap ? 'a' : ''};`;
  return k;
}

/** Would three draw this material's shadow with its shared default depth material? */
function plainDepth(mat, renderer) {
  if (!mat) return true;
  if (renderer?.localClippingEnabled && mat.clipShadows === true && Array.isArray(mat.clippingPlanes) && mat.clippingPlanes.length) return false;
  if (mat.displacementMap && mat.displacementScale !== 0) return false;
  if ((mat.alphaMap || mat.map) && mat.alphaTest > 0) return false;
  if (mat.alphaToCoverage === true) return false;
  return true;
}

const depthBase = new THREE.MeshDepthMaterial();
depthBase.name = 'shadow-depth';
/** Is this one of the per-variant depth materials handed out below? (same output as three's default depth material) */
export const isShadowVariant = (m) => !!m && m.isMeshDepthMaterial === true && m.userData.shadowVariant === true;
depthBase.userData.shadowVariant = true; // (clones copy it)
const depthVariants = new VariantCache();
const assigned = new WeakMap(); // object → the variant we gave it
let assignedList = []; // the objects holding one (refreshed by every scan)

/**
 * Give shadow casters of a non-plain variant their own depth material (see module doc). Cheap enough to rerun every
 * few dozen frames (new characters, effects). @returns {number} objects assigned this call
 */
export function assignShadowVariants(scene, renderer = null) {
  let n = 0;
  const list = [];
  // visible subtrees only (hidden men's bones, unused LODs): a caster shown later is drawn with three's default until
  // the next scan — correct, only the old program churn for up to 30 frames
  scene.traverseVisible((o) => {
    // (merged depth meshes are meshes only inside depth passes: engine/depth-merge.js)
    if (!o.castShadow || !(o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isDepthProxy)) return;
    const mine = assigned.get(o);
    if (o.customDepthMaterial !== undefined && o.customDepthMaterial !== mine) return; // the owner's own
    const ok = [].concat(o.material).every((m) => plainDepth(m, renderer));
    if (!ok) {
      if (mine) { delete o.customDepthMaterial; assigned.delete(o); }
      return;
    }
    const v = depthVariants.get(depthBase, `${variantKey(o)}|${depthState(o)}`);
    if (mine !== v) { o.customDepthMaterial = v; assigned.set(o, v); n++; }
    list.push(o);
  });
  assignedList = list;
  return n;
}

/**
 * Every frame, before the shadow pass: an object whose material became alpha-tested / displaced since the last scan
 * gives its variant back at once (three's per-material depth clone takes over) — the cut-out never casts solid.
 */
export function checkShadowVariants(renderer = null) {
  for (let i = 0; i < assignedList.length; i++) {
    const o = assignedList[i], mine = assigned.get(o);
    if (!mine || o.customDepthMaterial !== mine) continue;
    const mat = o.material;
    let plain = true;
    if (Array.isArray(mat)) { for (let k = 0; k < mat.length && plain; k++) plain = plainDepth(mat[k], renderer); } else plain = plainDepth(mat, renderer);
    if (plain) continue; // (the object kind — instanced, skinned — never changes: no key rebuild per frame)
    delete o.customDepthMaterial;
    assigned.delete(o);
  }
}
