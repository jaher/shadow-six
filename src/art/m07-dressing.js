/**
 * M7 "Chase of the Wolves" (Arendal harbour, 7 February 1942) second art pass: the pieces the first pass left as
 * placeholders, and the set dressing of the open ground nobody crosses (the pocket's stores dump, the bombed lorry in
 * the ruins field, the fishermen's gear on the lighthouse mole: missions/m07 `M07_DRESSING`).
 *
 * - `parachute_tree` (sign, block 0; dossier §5.4 "the tree where the parachute hangs"): the drop's canopy caught in the
 *   crown of the pine by the crate, thrown over its top and draped down the side the wind carried it, its hem hanging
 *   free under the last branches it rests on, the rigging lines running down to the container's riser, and the rest of
 *   the silk spilled down the trunk into the heap at its foot — the first pass's draped heap vertex for vertex (what a
 *   body keeps clear of there, as before). The canopy is above a walker's head (the hem from 3.4 m up); the lines' last
 *   metre comes down steeply onto the container inside its own clearance.
 * - `fish_gear` (crates, B.LOW): a fisherman's gear on the mole: tarred fish boxes stacked two high, slatted creels
 *   (lobster pots) and a coil of rope, inside the def's w × d.
 * Local frames as props.js (origin on the ground at the structure's x, z; +X along w at `rot`).
 * @module art/m07-dressing
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, rng, seedOf, fbm, boxUV } from './dressing.js';
import { paintedMaterial, buildSignVariant } from './kit-props.js';
import { silkMaterial } from './m04-dressing.js';

/** The `crates` variants this module draws (props.js dispatch). */
export const M07_PIECE_RX = /^(fish_gear)$/;

const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };

/**
 * The canopy in the pine (local frame of the sign). `p.tree` [x, z, h] (world: the trunk and the tree's height),
 * `p.riser` [x, z, y] (world: where the lines meet on the container), `p.crown` the crown's radius at its base (m),
 * `p.crownBase` its height (m). The sheet hangs on the riser's side of the crown (the wind's).
 * @param {object} p sign params (x, z, id, tree, riser, crown?, crownBase?)
 */
export function buildParachuteTree(p) {
  const g = new THREE.Group(); g.name = 'dressing:parachute_tree';
  const heap = buildSignVariant({ ...p, variant: 'parachute_draped' }); // (its own seed: the id, as the first pass drew it)
  const R = rng(seedOf(p.id ?? 'chute')), s = R() * 40;
  const [tx, tz, th] = p.tree ?? [p.x ?? 0, p.z ?? 0, 10], X0 = p.x ?? 0, Z0 = p.z ?? 0;
  const ax = tx - X0, az = tz - Z0;                                       // the trunk, local
  const [rx, rz, ry] = p.riser ?? [tx + 3, tz - 2.5, 1];
  const lx = rx - X0, lz = rz - Z0;
  // (on the side towards the heap at the sign's origin: the south-east one, the camera's — the crown's top stands too far
  // up the screen for the north edge's view to take in; the sheet rests on the branches from TOP down to SUP)
  const phi = Math.atan2(-az, -ax);
  const cb = p.crownBase ?? 0.25 * th, R0 = p.crown ?? 0.3 * th;
  const cone = (y) => Math.max(0.15, R0 * Math.min(1, (th - y) / (th - cb)));
  const NU = 26, NV = 30, TOP = 0.72 * th, SUP = 0.5 * th, HEM = 0.36 * th;
  const pos = [], col = [], uv = [], idx = [], hem = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, y0 = TOP + (HEM - TOP) * u;
    const span = (0.45 + 0.7 * Math.min(1, u * 1.6)) * (1 - 0.12 * Math.sin(u * 5 + s));    // half-width (rad) round the crown
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * 2 - 1, th2 = phi + v * span + 0.12 * Math.sin(u * 4 + v * 2 + s);
      const gore = Math.sin((v * 7 + 0.4 * Math.sin(u * 6 + s)) * Math.PI);               // the gores' folds
      const yS = Math.max(y0, SUP);                                                        // last support on the crown
      const sag = 0.18 * Math.max(0, Math.sin(u * Math.PI * 3.2 + v)) * (y0 > SUP ? 1 : 0); // between the branch tiers
      let r = (u < 0.03 ? 0.6 : cone(yS) + 0.32) + 0.1 * Math.abs(gore) + 0.08 * fbm(u * 3, v * 3, s, 7, 2);
      let y = y0 - sag;
      if (y0 < SUP) {                                                                      // hanging free: straight down,
        const k = (SUP - y0) / (SUP - HEM);                                                 // the skirt gathered in a little
        r = r * (1 - 0.18 * k) + 0.25 * Math.abs(gore) * k;
        y = y0 - 0.25 * Math.abs(v) * k;                                                    // (the corners hang lower)
      }
      const x = ax + Math.cos(th2) * r, z = az + Math.sin(th2) * r;
      pos.push(x, y, z); uv.push(v * 2, u * 3);
      const shade = (0.78 + 0.22 * (0.5 + 0.5 * gore)) * (Math.abs(gore) > 0.96 ? 0.82 : 1) * (y0 < SUP ? 0.9 : 1);
      col.push(shade, shade, shade * 0.98);
      if (i === NU && j % 3 === 0) hem.push(new THREE.Vector3(x, y, z));
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + NV + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const silk = mesh(geo, silkMaterial(), true); silk.name = 'chute:silk';
  // the rigging lines: from the hem, gathered, down to the riser on the container (the last metre steep, onto its lid)
  const cord = paintedMaterial('canvas', 0xcfc6ac), web = paintedMaterial('canvas', 0xb9ae8c);
  const riser = new THREE.Vector3(lx, ry + 0.02, lz), hc = hem.reduce((a, h) => a.add(h), new THREE.Vector3()).multiplyScalar(1 / hem.length);
  // where the lines gather on the riser: just over the crates (above a walker's body band, 1.8 m), a hand towards the canopy
  const hd = new THREE.Vector3(hc.x - riser.x, 0, hc.z - riser.z).normalize();
  const top = riser.clone().addScaledVector(hd, 0.3); top.y = riser.y + 0.9;
  for (const h of hem) {
    const mid = h.clone().lerp(top, 0.55); mid.y -= 0.12 + R() * 0.12;
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([h, mid, top]), 10, 0.012, 3, false), cord, false));
  }
  g.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(riser, top), 2, 0.028, 5, false), web, false));
  // the spill: a twisted band of silk from the hem on the heap's side down the trunk into the heap (the heap's crown at
  // the sign's origin, ~1.1 m high); it meets the ground only inside the heap
  const ha = phi, a0 = phi, rH = cone(HEM + 1.2) + 0.3;                    // (the canopy's middle, over the heap)
  const SP = [], SC = [], SI = [], NS = 14;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, top3 = [ax + Math.cos(a0) * rH, HEM + 0.1, az + Math.sin(a0) * rH], bot = [ax * 0.25, 1.05, az * 0.25];
    const cx = top3[0] + (bot[0] - top3[0]) * t, cz = top3[2] + (bot[2] - top3[2]) * t, cy = top3[1] + (bot[1] - top3[1]) * t - 0.35 * Math.sin(Math.PI * t);
    const wdt = 0.55 + 0.35 * t, tw = 0.6 * t + 0.25 * Math.sin(t * 5 + s), nx = -Math.sin(ha + tw), nz = Math.cos(ha + tw);
    for (const e of [-1, 1]) { SP.push(cx + nx * wdt * e, cy + 0.05 * e * Math.sin(t * 9), cz + nz * wdt * e); const k = 0.82 + 0.12 * e * Math.sin(t * 7 + s); SC.push(k, k, k * 0.98); }
    if (i < NS) { const a = i * 2; SI.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(SP, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(SC, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(SP.map((v, i) => (i % 3 === 1 ? 0 : v * 0.5)).filter((_, i) => i % 3 !== 1), 2));
  sg.setIndex(SI); sg.computeVertexNormals();
  const spill = mesh(sg, silkMaterial(), true); spill.name = 'chute:spill';
  // (the canopy, its lines, riser and spill are cloth and cord: no body-height obstacle beyond the heap and the crates
  // they hang over — kept out of the walk-grid measures (userData.clip = false), so the walk round the drop is as before)
  const out = consolidate(g);
  for (const m of [...out.children, silk, spill]) m.userData.clip = false;
  out.add(silk, spill, heap);
  return out;
}

/**
 * A fisherman's gear on the mole (crates variant `fish_gear`, local w × d): tarred fish boxes stacked two high along
 * +X, a row of slatted creels (lobster pots: a plank base, three bent hoops, laths and a net end) beside them, and a
 * coil of rope on the boxes. Everything inside w × d and under the def's h.
 */
export function buildFishGear(p) {
  const w = p.w ?? 3, d = p.d ?? 1.6, h = p.h ?? 0.9, R = rng(seedOf(p.id ?? 'fish_gear'));
  const g = new THREE.Group(); g.name = 'dressing:fish_gear';
  const tar = paintedMaterial('planks', 0x4a3d30), lath = paintedMaterial('planks', 0x8a7458), net = paintedMaterial('canvas', 0x6f6a58);
  const rope = paintedMaterial('canvas', 0xa8956c);
  // fish boxes: 0.8 × 0.5 × 0.3, two rows on the -z half, the top layer a little askew
  const bw = 0.8, bd = 0.5, bh = 0.3, nx = Math.max(1, Math.floor((w * 0.55) / bw));
  for (let k = 0; k < nx; k++) for (let layer = 0; layer < (h > 0.7 ? 2 : 1); layer++) {
    if (layer && R() < 0.3) continue;
    const box = new THREE.Group(); box.position.set(-w / 2 + bw / 2 + 0.05 + k * (bw + 0.04) + (layer ? (R() - 0.5) * 0.08 : 0), layer * bh, -d / 2 + bd / 2 + 0.05);
    box.rotation.y = layer ? (R() - 0.5) * 0.12 : 0;
    for (const [sx, sz, lx, lz] of [[0, -1, bw, 0.03], [0, 1, bw, 0.03], [-1, 0, 0.03, bd], [1, 0, 0.03, bd]]) {
      const s = mesh(boxUV(new THREE.BoxGeometry(lx, bh * 0.92, lz), 0.6), tar);
      s.position.set(sx * (bw / 2 - 0.015), bh * 0.46, sz * (bd / 2 - 0.015)); box.add(s);
    }
    const floor = mesh(boxUV(new THREE.BoxGeometry(bw - 0.04, 0.03, bd - 0.04), 0.6), tar); floor.position.y = 0.03; box.add(floor);
    g.add(box);
  }
  // creels on the +z half: plank base, three hoops, laths along the top, a net over one end
  const cl = 0.75, cw = 0.48, n2 = Math.max(1, Math.floor((w * 0.9) / (cl + 0.12)));
  for (let k = 0; k < n2; k++) {
    const c = new THREE.Group(); c.position.set(-w / 2 + cl / 2 + 0.06 + k * (cl + 0.12), 0, d / 2 - cw / 2 - 0.06); c.rotation.y = (R() - 0.5) * 0.2;
    c.add(mesh(boxUV(new THREE.BoxGeometry(cl, 0.04, cw), 0.6), lath));
    for (const x of [-cl / 2 + 0.05, 0, cl / 2 - 0.05]) {
      const hoop = mesh(new THREE.TorusGeometry(cw / 2 - 0.02, 0.015, 4, 10, Math.PI), lath);
      hoop.position.set(x, 0.04, 0); hoop.rotation.y = Math.PI / 2; c.add(hoop);
    }
    for (let a = 0.35; a < Math.PI; a += 0.55) {
      const l = mesh(boxUV(new THREE.BoxGeometry(cl, 0.02, 0.03), 0.6), lath);
      l.position.set(0, 0.04 + Math.sin(a) * (cw / 2 - 0.02), Math.cos(a) * (cw / 2 - 0.02)); c.add(l);
    }
    const end = mesh(new THREE.CircleGeometry(cw / 2 - 0.03, 10, 0, Math.PI), net, false);
    end.position.set(cl / 2 - 0.05, 0.04, 0); end.rotation.y = Math.PI / 2; c.add(end);
    g.add(c);
  }
  // a coil of rope on the boxes
  const coil = mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 14), rope);
  coil.rotation.x = Math.PI / 2; coil.position.set(-w / 2 + bw / 2 + 0.05, (h > 0.7 ? 2 : 1) * bh + 0.05, -d / 2 + bd / 2 + 0.05); g.add(coil);
  return consolidate(g);
}

/** A `crates` piece of this module by variant. */
export function buildM07Piece(p) {
  return buildFishGear(p);
}
