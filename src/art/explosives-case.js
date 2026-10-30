/**
 * The green case of German demolition charges on the M18 bridge island (dossier §5.1 `crate_bombs`, "an olive-green
 * box"; the walkthroughs' "explosives in the green case"): an olive-painted plank chest with a fitted lid, two batten
 * bands, steel corner irons and hasps, a rope becket at each end and a paper label on the front (M18 second art pass;
 * it drew as two bare plank crates). The Sapper's charges are the pickup lying in it (its small crate stays inside the
 * chest). Fills the def's w × d × h, local +X along w, +Z the front; origin on the ground. Plain colours in node.
 * @module art/explosives-case
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, boxUV } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

function part(geo, mat, x, y, z, tile = 0.6) {
  const m = new THREE.Mesh(boxUV(geo.toNonIndexed(), tile), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** @param {{w?: number, d?: number, h?: number}} p */
export function buildExplosivesCase(p = {}) {
  const w = p.w ?? 1, d = p.d ?? 0.6, h = p.h ?? 0.5, g = new THREE.Group(); g.name = 'kit:explosives_case';
  const olive = paintedMaterial('planks', 0x8f9d5c), band = paintedMaterial('planks', 0x6c7743); // (the plank set is dark: a lighter tint reads olive)
  const iron = dressingMaterial('castIron'), rope = dressingMaterial('burlap'), paper = paintedMaterial('canvas', 0xd2c9a6);
  const lidT = 0.07, bh = h - lidT;
  g.add(part(new THREE.BoxGeometry(w - 0.05, bh, d - 0.05), olive, 0, bh / 2, 0));             // the chest
  g.add(part(new THREE.BoxGeometry(w, lidT, d), olive, 0, h - lidT / 2, 0));                   // its lid, proud all round
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.07, bh - 0.02, d - 0.02), band, s * (w / 2 - 0.17), bh / 2, 0)); // batten band
    // the rope becket on the end: a half loop hanging from two eyes
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 12, Math.PI), rope);
    loop.rotation.set(Math.PI, Math.PI / 2, 0); loop.position.set(s * (w / 2 - 0.012), bh * 0.72, 0); loop.castShadow = true; g.add(loop);
    for (const t of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.02, 0.035, 0.035), iron, s * (w / 2 - 0.02), bh * 0.72, t * 0.075));
    for (const t of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.035, bh - 0.04, 0.035), iron, s * (w / 2 - 0.03), bh / 2, t * (d / 2 - 0.03))); // corner irons
    g.add(part(new THREE.BoxGeometry(0.06, 0.11, 0.02), iron, s * 0.24, h - 0.09, d / 2 - 0.015));            // hasp, chest to lid
  }
  g.add(part(new THREE.BoxGeometry(0.2, 0.12, 0.006), paper, 0, bh * 0.5, d / 2 - 0.022));           // the label
  return consolidate(g);
}
