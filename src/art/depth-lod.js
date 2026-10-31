/**
 * Depth LOD for the characters (art/humanoid-real.js): the depth passes (the sun shadow map and the GTAO normal/depth
 * prepass, engine/depth-merge.js inDepthPass) draw a man one LOD coarser than his colour pass. These helpers hold the
 * part bookkeeping, runtime-agnostic: a body runtime `h` with `object` (its meshes, LOD bodies named LOD0 / LOD1 / LOD2,
 * optionally `disguise:`-prefixed) and `setLOD(name)` that shows the parts of one LOD.
 * @module art/depth-lod
 */

/** A LOD body part's name: `LOD<k>`, or `disguise:LOD<k>` (the Spy / Driver outfits). */
export const D_LOD = /^(disguise:)?LOD(\d)$/;

/**
 * The parts the depth passes hide and show for a body runtime: his colour LOD k is the lowest LOD of his visible body
 * parts; his runtime is asked to show LOD k+1, then LOD k again, and the visibility diff is the answer (so its own
 * rules — headgear merged into the coarser bodies, outfits, alpha cards — hold). Nothing to swap at LOD2, without a
 * coarser body, or when setLOD does not restore what it changed (the parts are then put back as they were).
 * @param {{object: import('three').Object3D, setLOD?: (name: string) => void}} h
 * @param {import('three').Mesh[]} hide filled: visible now, hidden at the next LOD
 * @param {import('three').Mesh[]} show filled: hidden now, shown at the next LOD
 * @param {(m: import('three').Mesh) => void} [onShow] called for each part in `show`
 * @returns {boolean} there is something to swap
 */
export function depthLodParts(h, hide, show, onShow = null) {
  hide.length = 0; show.length = 0;
  if (!h || typeof h.setLOD !== 'function' || !h.object) return false;
  const ms = [];
  h.object.traverse((o) => { if (o.isMesh) ms.push(o); });
  let k = 9, next = false;
  for (const o of ms) { const m = D_LOD.exec(o.name); if (m && o.visible && +m[2] < k) k = +m[2]; }
  for (const o of ms) { const m = D_LOD.exec(o.name); if (m && +m[2] === k + 1) next = true; }
  if (k > 1 || !next) return false;
  const before = ms.map((o) => o.visible);
  h.setLOD(`LOD${k + 1}`);
  const after = ms.map((o) => o.visible);
  h.setLOD(`LOD${k}`);
  if (ms.some((o, i) => o.visible !== before[i])) { ms.forEach((o, i) => { o.visible = before[i]; }); return false; }
  ms.forEach((o, i) => {
    if (before[i] && !after[i]) hide.push(o);
    else if (!before[i] && after[i]) { show.push(o); onShow?.(o); }
  });
  return hide.length > 0;
}

/**
 * Flip to the depth parts if they are still as found (every `hide` part visible, every `show` part hidden).
 * @returns {boolean} flipped (false: something changed them since — find them again)
 */
export function depthSwapOn(hide, show) {
  if (!hide.length) return false;
  for (let i = 0; i < hide.length; i++) if (!hide[i].visible) return false;
  for (let i = 0; i < show.length; i++) if (show[i].visible) return false;
  for (let i = 0; i < hide.length; i++) hide[i].visible = false;
  for (let i = 0; i < show.length; i++) show[i].visible = true;
  return true;
}

/** Undo depthSwapOn. */
export function depthSwapOff(hide, show) {
  for (let i = 0; i < hide.length; i++) hide[i].visible = true;
  for (let i = 0; i < show.length; i++) show[i].visible = false;
}
