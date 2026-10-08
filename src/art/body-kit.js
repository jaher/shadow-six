/**
 * Belt kit of a character's body mesh: which of its vertices are the man and which the kit he carries.
 *
 * The character pipeline merges the kit a man carries on his belt and his Y-straps — bread bag, canteen, gas-mask can,
 * mess tin, ammo pouches, bayonet, entrenching tool, holster, buckles — into the skinned body mesh (one primitive, one
 * atlas). Each piece is its own connected component, weighted to the pelvis / spine / a thigh, and it stands out of the
 * body: lying on his back a German rifleman's bread bag and canteen hang 15–20 cm below his back. A corpse grounded on
 * its lowest vertex rested on them, his whole body held up in the air (the user, 2026-10-08: "bodies of dead soldiers
 * are still floating on the ground"). The kit is soft (canvas, felt) or pushed aside under a body: what rests on the
 * ground is the man — his back, seat, heels, the back of his head — and the kit goes under him.
 *
 * Kit = a connected component (vertices welded by position) that is small (its bind-pose box under KIT_SIZE m across)
 * and hangs off the trunk (its dominant bone the pelvis, a spine bone, a clavicle or a thigh). Garments (tunic,
 * trousers, greatcoat: ≥ 0.55 m), boots and puttees (foot / calf bones), hands and the head are body.
 * Cached per geometry (shared by every instance of a template).
 * @module art/body-kit
 */

/** Bones a belt / strap item hangs from. */
const KIT_BONES = /^(pelvis|spine_0\d|clavicle_|thigh_)/i;
/** m: largest bind-pose box diagonal of a kit item (garments are ≥ 0.55 m). */
export const KIT_SIZE = 0.5;

const CACHE = new WeakMap();

function dominant(SI, SW, i) {
  let bi = 0, bw = -1;
  for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; bi = SI.getComponent(i, k); } }
  return bi;
}

/**
 * Kit mask of a skinned mesh (cached on its geometry).
 * @param {import('three').SkinnedMesh} mesh
 * @returns {{kit: Uint8Array, dom: Int32Array, body: Uint32Array, kitCount: number}}
 *   kit[i] = 1 for a kit vertex; dom[i] = its dominant bone (skeleton index); body = every other vertex
 */
export function bodyKit(mesh) {
  const g = mesh.geometry, names = mesh.skeleton?.bones?.map((b) => b?.name || '') || [];
  const hit = CACHE.get(g);
  if (hit && hit.key === names.join()) return hit;
  const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = P.count;
  // connected components over the triangles, vertices welded by position (UV / normal seams split them)
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  // (sorted by quantised position: equal neighbours are the same point)
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n), ord = new Uint32Array(n);
  for (let i = 0; i < n; i++) { qx[i] = Math.round(P.getX(i) * 1e4); qy[i] = Math.round(P.getY(i) * 1e4); qz[i] = Math.round(P.getZ(i) * 1e4); ord[i] = i; }
  ord.sort((a, b) => qx[a] - qx[b] || qy[a] - qy[b] || qz[a] - qz[b]);
  for (let k = 1; k < n; k++) { const a = ord[k - 1], b = ord[k]; if (qx[a] === qx[b] && qy[a] === qy[b] && qz[a] === qz[b]) join(a, b); }
  const idx = g.index;
  const tri = idx ? idx.count : n;
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    join(a, b); join(a, c);
  }
  const comp = new Map();
  const dom = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = comp.get(r);
    if (!c) comp.set(r, (c = { box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], bones: new Map() }));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (x < c.box[0]) c.box[0] = x; if (y < c.box[1]) c.box[1] = y; if (z < c.box[2]) c.box[2] = z;
    if (x > c.box[3]) c.box[3] = x; if (y > c.box[4]) c.box[4] = y; if (z > c.box[5]) c.box[5] = z;
    const bi = SI && SW ? dominant(SI, SW, i) : 0;
    dom[i] = bi;
    c.bones.set(bi, (c.bones.get(bi) || 0) + 1);
  }
  for (const c of comp.values()) {
    let best = -1, bn = 0;
    for (const [b, k] of c.bones) if (k > bn) { bn = k; best = b; }
    const size = Math.hypot(c.box[3] - c.box[0], c.box[4] - c.box[1], c.box[5] - c.box[2]);
    c.kit = size < KIT_SIZE && KIT_BONES.test(names[best] || '');
  }
  const kit = new Uint8Array(n), body = [];
  let kitCount = 0;
  for (let i = 0; i < n; i++) {
    if (comp.get(find(i)).kit) { kit[i] = 1; kitCount++; } else body.push(i);
  }
  const out = { key: names.join(), kit, dom, body: Uint32Array.from(body), kitCount };
  CACHE.set(g, out);
  return out;
}

/** Body (non-kit) vertex indices of a skinned mesh, every `stride`-th. */
export function bodyVertexList(mesh, stride = 1) {
  const b = bodyKit(mesh).body;
  if (stride <= 1) return b;
  const out = new Uint32Array(Math.ceil(b.length / stride));
  for (let i = 0, j = 0; i < b.length; i += stride) out[j++] = b[i];
  return out;
}
