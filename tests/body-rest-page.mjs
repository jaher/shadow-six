/**
 * Page-side helpers for the body-at-rest browser tests (body-rest, body-ground; imported inside page.evaluate as
 * '/tests/body-rest-page.mjs'): how a corpse's drawn body lies on the ground, and how much it moves per frame.
 */

const REGIONS = { head: /^(head|neck)/i, hips: /^(pelvis|spine_01|thigh)/i, feet: /^(calf|foot|ball)/i };
const BONES = ['pelvis', 'spine_03', 'head', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'lowerarm_l', 'lowerarm_r'];

import { bodyKit } from '/src/art/body-kit.js';

/**
 * Lowest skinned vertex of the drawn body over the ground under it, overall and per region (head / hips / feet: the
 * dominant bone of the vertex), m. A man lying on his back touches the ground with each (back of the head, seat,
 * heels): a region well above it floats, one below it sinks. His belt kit (bread bag, canteen, pouches: art/body-kit.js)
 * is not him: it lies under him, in the ground.
 */
export function contact(w, u, stride = 2) {
  const m = u.model, root = m.root, V = root.position.clone();
  let mesh = null;
  m.real.inner.object.traverse((o) => { if (o.isSkinnedMesh && /^LOD\d+$/.test(o.name) && (!mesh || o.geometry.attributes.position.count < mesh.geometry.attributes.position.count)) mesh = o; });
  root.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name), kit = bodyKit(mesh).kit;
  const out = { all: Infinity, head: Infinity, hips: Infinity, feet: Infinity };
  for (let k = 0; k < pos.count; k += stride) {
    if (kit[k]) continue;
    mesh.getVertexPosition(k, V).applyMatrix4(mesh.matrixWorld);
    const d = V.y - (w.lyingY || w.groundY).call(w, V.x, V.z) - (u.y || 0); // (lyingY: no walkers' feet ring)
    if (d < out.all) out.all = d;
    let bi = 0, bw = -1;
    for (let c = 0; c < 4; c++) { const wt = sw.getComponent(k, c); if (wt > bw) { bw = wt; bi = si.getComponent(k, c); } }
    const n = names[bi] || '';
    for (const r in REGIONS) if (REGIONS[r].test(n) && d < out[r]) out[r] = d;
  }
  for (const r in out) out[r] = +out[r].toFixed(3);
  return out;
}

/** World positions of the drawn body's main bones. */
export function bones(u) {
  const V = u.model.root.position.clone();
  return BONES.map((n) => { const b = u.model.real.getSocket(n); if (!b) return null; b.getWorldPosition(V); return [V.x, V.y, V.z]; });
}

/** Largest move (m) of any main bone between two bones() snapshots. */
export function step(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
  return m;
}
