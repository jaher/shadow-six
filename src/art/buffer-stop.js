/**
 * A standard-gauge rail-built buffer stop (Schienenprellbock) at the dead end of a siding (M18 second art pass: the stub
 * siding N of the station): the running rails bent up into a raking post over each rail with a back strut down to the
 * ballast, a timber buffer beam across the track at buffer height (1.06 m) with a buffer block over each rail, and the
 * Sh 2 stop board (a red square in a white rim) on a short post at the beam's centre.
 * Local frame (crates convention): +X along the track, the beam's face towards the rolling stock at +w/2, the struts
 * leaning back to −w/2; across the track ±d/2; origin on the ground at the prop centre. Plain colours in node.
 * @module art/buffer-stop
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, boxUV } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

const HALF_GAUGE = 0.7175; // rail centres (1.435 m gauge)
const BUFFER_Y = 1.06;     // buffer centre height over the rail heads (UIC / DR)

function part(geo, mat, tile = 0.8) {
  const m = new THREE.Mesh(boxUV(geo.toNonIndexed(), tile), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** A square-section member from a to b ([x, y, z], same z), `t` thick. */
function member(mat, a, b, t) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const m = part(new THREE.BoxGeometry(L, t, t), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]);
  m.rotation.z = Math.atan2(dy, dx);
  return m;
}

/** @param {{w?: number, d?: number}} p footprint: w along the track (struts to beam face), d across it */
export function buildBufferStop(p = {}) {
  const w = p.w ?? 1.3, d = p.d ?? 2.4, g = new THREE.Group(); g.name = 'kit:buffer_stop';
  const steel = dressingMaterial('castIron'), timber = dressingMaterial('creosote'); // (tarred like the sleepers)
  const red = paintedMaterial('planks', 0x8e1f16), white = paintedMaterial('planks', 0xd9d5c9);
  const face = w / 2, beamT = 0.3, bx = face - beamT / 2, y = BUFFER_Y + 0.16; // (rail heads at 0.16 m: kit-terrain)
  for (const s of [-1, 1]) {
    const z = s * HALF_GAUGE;
    // the raking post: up from the rail's end at the back of the stop to the beam's back face
    g.add(member(steel, [-w / 2 + 0.35, 0.14, z], [bx - beamT / 2 + 0.02, y + 0.12, z], 0.12));
    // the back strut: from the post's head down to the ballast behind the stop
    g.add(member(steel, [bx - beamT / 2 - 0.05, y - 0.05, z], [-w / 2 + 0.06, 0.06, z], 0.11));
    // a buffer block over the rail, proud of the beam
    const blk = part(new THREE.BoxGeometry(0.1, 0.34, 0.4), timber); blk.position.set(face - 0.05, y, z); g.add(blk);
  }
  // the buffer beam across the track (plain timber, its ends cut square)
  const beam = part(new THREE.BoxGeometry(beamT - 0.1, 0.32, Math.min(d, 2.4) - 0.1), timber);
  beam.position.set(bx - 0.05, y, 0); g.add(beam);
  // Sh 2: a short post on the beam, the board facing the track
  const post = part(new THREE.BoxGeometry(0.07, 0.62, 0.07), steel); post.position.set(bx - 0.05, y + 0.16 + 0.31, 0); g.add(post);
  const plate = part(new THREE.BoxGeometry(0.03, 0.48, 0.48), steel); plate.position.set(bx - 0.0, y + 0.16 + 0.5, 0); g.add(plate); // its back
  const rim = part(new THREE.BoxGeometry(0.01, 0.46, 0.46), white); rim.position.set(bx + 0.02, y + 0.16 + 0.5, 0); g.add(rim);
  const board = part(new THREE.BoxGeometry(0.008, 0.36, 0.36), red); board.position.set(bx + 0.029, y + 0.16 + 0.5, 0); g.add(board);
  return consolidate(g);
}
