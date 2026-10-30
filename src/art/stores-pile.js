/**
 * A camp's stores stacked in the open (M17 second art pass: the dossier's "pile of boxes near the prison" and the
 * Kommandantur's stores on the N bank drew as two or three bare plank cubes): Wehrmacht-grey ammunition and stores
 * chests with fitted lids, batten ends, rope beckets and white stencilled bands, a couple of long rifle cases, one
 * stack lashed under a tarpaulin and a sack or two against it. A `crates` structure with `variant: 'stores_pile'`
 * (art/props.js); it fills the def's w × d × h (local +X along w, origin on the ground at the centre) and blocks as
 * the plain crates did (the def's w × d, B.LOW). Plain colours in node.
 * @module art/stores-pile
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, boxUV } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => String(s).split('').reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

function part(g, geo, mat, x, y, z, ry = 0, tile = 0.6) {
  const m = new THREE.Mesh(boxUV(geo.toNonIndexed(), tile), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m);
  return m;
}

/** One chest: body, a proud lid, batten ends, a stencil band and a rope becket at each end (local +X along `l`). */
function chest(g, M, l, wd, ht, x, y, z, ry, white) {
  const c = new THREE.Group(); c.position.set(x, y, z); c.rotation.y = ry; g.add(c);
  part(c, new THREE.BoxGeometry(l - 0.04, ht - 0.05, wd - 0.04), M.body, 0, (ht - 0.05) / 2, 0);
  part(c, new THREE.BoxGeometry(l, 0.05, wd), M.body, 0, ht - 0.025, 0);
  for (const s of [-1, 1]) {
    part(c, new THREE.BoxGeometry(0.05, ht - 0.07, wd - 0.01), M.batten, s * (l / 2 - 0.08), (ht - 0.05) / 2, 0);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 5, 10, Math.PI), M.rope);
    loop.rotation.set(Math.PI, Math.PI / 2, 0); loop.position.set(s * (l / 2 - 0.005), ht * 0.62, 0); loop.castShadow = true; c.add(loop);
  }
  if (white) part(c, new THREE.BoxGeometry(l * 0.34, 0.05, 0.006), M.stencil, 0, ht * 0.55, wd / 2 - 0.016);
}

/** @param {{w?: number, d?: number, h?: number, id?: string}} p */
export function buildStoresPile(p = {}) {
  const w = p.w ?? 3, d = p.d ?? 3, h = p.h ?? 1.5, R = rng(seedOf(p.id ?? 'stores')), g = new THREE.Group(); g.name = 'dressing:stores_pile';
  const body = paintedMaterial('planks', 0x9aa08a); // (one paint for chest and battens, one burlap for ropes and sacks: few draws)
  const M = { body, batten: body, rope: dressingMaterial('burlap'),
    stencil: paintedMaterial('canvas', 0xe8e4d6), wood: dressingMaterial('planks'), tarp: paintedMaterial('canvas', 0x8a8a6a), sack: dressingMaterial('burlap') };
  const big = Math.min(w, d) > 2.4;
  // the chests: a column of two on the left, one on top; on a big pile a fourth across the back right
  const L = Math.min(w * (big ? 0.55 : 0.5), 1.3), W = 0.62, H = Math.min(0.55, h * 0.4), cx = -w / 2 + L / 2 + 0.05, z0 = -d / 2 + W / 2 + 0.05;
  chest(g, M, L, W, H, cx, 0, z0, (R() - 0.5) * 0.06, true);
  chest(g, M, L, W, H, cx + (R() - 0.5) * 0.04, 0, z0 + W + 0.04, (R() - 0.5) * 0.06, R() < 0.6);
  chest(g, M, L * 0.9, W * 0.95, H, cx + (R() - 0.5) * 0.06, H, z0 + W * 0.5, (R() - 0.5) * 0.12, true); // one on top
  if (big) {
    chest(g, M, L, W, H, w / 2 - W / 2 - 0.1, 0, d / 2 - L / 2 - 0.1, Math.PI / 2 + (R() - 0.5) * 0.06, true);
    // two long rifle cases (natural wood) along the front left
    for (const k of [0, 1]) part(g, new THREE.BoxGeometry(1.2, 0.22, 0.38), M.wood, -w / 2 + 0.75, 0.11 + k * 0.22, d / 2 - 0.3, (R() - 0.5) * 0.06 + k * 0.05);
  }
  // the lashed stack: a box under a tarpaulin, its skirt splayed, a rope round it; sacks against its front
  const tw = big ? 1.05 : 0.8, th = Math.min(h, big ? 1.35 : 0.95), tx = w / 2 - tw / 2 - 0.08, tz = -d / 2 + tw * 0.45 + 0.08;
  part(g, new THREE.BoxGeometry(tw, th - 0.06, tw * 0.9), M.wood, tx, (th - 0.06) / 2, tz);
  const tarp = new THREE.BoxGeometry(tw + 0.1, th, tw * 0.9 + 0.1, 3, 3, 3), tp = tarp.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); if (y > th * 0.3) tp.setY(i, y + (R() - 0.5) * 0.05); if (y < 0) tp.setXYZ(i, tp.getX(i) * 1.05, y, tp.getZ(i) * 1.05); }
  tarp.computeVertexNormals();
  part(g, tarp, M.tarp, tx, th / 2 + 0.005, tz, 0.04, 1.2);
  part(g, new THREE.BoxGeometry(tw + 0.13, 0.03, 0.03), M.rope, tx, th * 0.62, tz + tw * 0.45 + 0.05, 0.04);
  for (let k = 0; k < (big ? 2 : 1); k++) {
    const s = new THREE.SphereGeometry(0.26, 8, 6).scale(1, 1.25, 0.8);
    const m = new THREE.Mesh(s, M.sack); m.position.set(tx - tw * 0.2 + k * 0.42, 0.28, tz + tw * 0.45 + 0.25); m.rotation.set((R() - 0.5) * 0.3, R() * 3, 0.15); m.castShadow = true; g.add(m);
  }
  return consolidate(g);
}
