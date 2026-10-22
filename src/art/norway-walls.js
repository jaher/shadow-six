/**
 * M1 art pass (Sola): the south bank's dry-stone wall under its plank lean-to roof (`stone_plank_roof`, design-spec
 * §7.4 `wall_s`; building-inventory `wall_drystone_leanto`). The generic wall kit drew it as a brick-textured box with
 * a flat board on top. Now: a battered dry-stone wall of grey fieldstone (no mortar, through-stones proud of both faces,
 * a ragged course line), a low pent roof of tarred boards laid over the crest on a ridge plank, its eaves a hand past
 * either face, a snow crust on the boards, and drift snow banked against the foot.
 * Everything stands inside the gameplay line (`width` wide, ends flush) up to the gameplay height; only the eaves
 * reach 0.18 m past the faces, above 1.6 m. World-frame meshes.
 * @module art/norway-walls
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, boulderGeometry } from './dressing.js';

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

let M = null;
function mats() {
  if (M) return M;
  const tint = (name, c) => { const x = dressingMaterial(name).clone(); x.color = new THREE.Color(c); x.name = `${x.name}:m01`; return x; };
  // the core is the dark packing between the stones; the faces are the stones themselves (three greys, lichen-grey to wet)
  M = { core: tint('rubble', 0x726e67), stone: tint('fieldstone', 0xd2cdc4), mid: tint('fieldstone', 0xaba69d), dark: tint('fieldstone', 0x86817a),
    board: tint('logsTarred', 0x9a8a78), ridge: dressingMaterial('creosote'), snow: dressingMaterial('snow') };
  return M;
}

/**
 * @param {number[][]} points polyline [[x, z], …]
 * @param {{h:number, width:number}} o
 * @param {() => number} R seeded random
 */
export function drystonePlankWall(points, o, R) {
  const { h, width } = o, X = mats(), root = new THREE.Group(); root.name = 'dressing:wall:drystone_leanto';
  const hw = h - 0.16;                      // the stone crest; the roof makes up the gameplay height
  const OH = 0.04, rise = 0.12;   // eaves a hand past the stone face only: a man standing at the wall clears them (clipping, dynamic)
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const rot = -Math.atan2(bz - az, bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const first = k === 0, last = k + 2 === points.length;
    const Lw = L + (first ? 0 : width / 2) + (last ? 0 : width / 2);
    const shift = ((last ? 0 : width / 2) - (first ? 0 : width / 2)) / 2;   // free ends flush (rule a), inner corners overlap
    const tx = Math.cos(-rot), tz = Math.sin(-rot), nx = -tz, nz = tx;
    const at = (u, v, y, m) => { m.position.set(cx + tx * (u + shift) + nx * v, y, cz + tz * (u + shift) + nz * v); m.rotation.y = rot; return m; };
    // battered core: 0.86 of the width at the foot, 0.68 at the crest, bulging, a wavering crest line
    const segs = Math.max(6, Math.round(Lw / 0.3)), geo = new THREE.BoxGeometry(Lw, hw, width * 0.86, segs, 4, 1), P = geo.attributes.position;
    const wob = Array.from({ length: segs + 1 }, () => (R() - 0.5) * 0.06);
    for (let i = 0; i < P.count; i++) {
      const t = (P.getY(i) + hw / 2) / hw, j = Math.round((P.getX(i) / Lw + 0.5) * segs);
      P.setZ(i, P.getZ(i) * (1 - 0.21 * t) * (0.97 + R() * 0.06));
      if (t > 0.999) P.setY(i, hw / 2 + wob[j]);
    }
    geo.computeVertexNormals();
    root.add(at(0, 0, hw / 2, mesh(boxUV(geo.toNonIndexed(), 1.1), X.core)));
    // proud stones on both faces: courses of flattish field stones (through-stones every metre or so), never past the line
    for (const sd of [-1, 1]) {
      for (let y = 0.1; y < hw - 0.1; y += 0.2 + R() * 0.05) {
        const t = y / hw, face = (width * 0.86 / 2) * (1 - 0.21 * t);
        for (let u = -Lw / 2 + 0.24 + R() * 0.1; u < Lw / 2 - 0.24; u += 0.27 + R() * 0.12) {
          if (R() < 0.1) continue;
          const s = 0.12 + R() * 0.07, v = face - 0.05, rz = (width / 2 - v - 0.008) * 0.9, q = R();
          const g = boulderGeometry(s * (1.1 + R() * 0.5), s * (0.5 + R() * 0.3), rz, Math.floor(R() * 1e9), 0);
          root.add(at(u, sd * v, y + (R() - 0.5) * 0.04, mesh(g, q < 0.45 ? X.stone : q < 0.8 ? X.mid : X.dark)));
        }
      }
    }
    // pent roof: ridge plank on the crest, tarred boards down to the eaves (each board its own length and tilt)
    const yr = hw + rise + 0.05;
    root.add(at(0, 0, yr - 0.02, mesh(boxUV(new THREE.BoxGeometry(Lw + 0.1, 0.06, 0.14), 1.4), X.ridge)));
    const half = width / 2 + OH, slope = Math.atan2(rise, half);
    for (const sd of [-1, 1]) {
      for (let u = -Lw / 2 - 0.04; u < Lw / 2 + 0.04; ) {
        const bw = 0.16 + R() * 0.07, len = half + 0.02 + R() * 0.03;
        const g = new THREE.BoxGeometry(bw - 0.012, 0.035, len);
        const b = at(u + bw / 2, sd * (len / 2), yr - rise / 2 - 0.02 + (R() - 0.5) * 0.008, mesh(boxUV(g, 1.2), X.board));
        b.rotation.set(0, rot, 0); b.rotateX(sd * slope); root.add(b);
        u += bw;
      }
      // snow crust on the slope, stopping short of the eave so the board ends read
      const sg = new THREE.BoxGeometry(Lw - 0.1, 0.05, half - 0.1, Math.max(2, Math.round(Lw / 0.5)), 1, 1), SP = sg.attributes.position;
      for (let i = 0; i < SP.count; i++) if (SP.getY(i) > 0) SP.setY(i, SP.getY(i) + (R() - 0.3) * 0.03);
      sg.computeVertexNormals();
      const sn = at(0, sd * ((half - 0.1) / 2), yr - rise / 2 + 0.02, mesh(sg, X.snow));
      sn.rotation.set(0, rot, 0); sn.rotateX(sd * slope); root.add(sn);
    }
    // drift snow banked against the foot of both faces
    for (const sd of [-1, 1]) {
      const dg = new THREE.CylinderGeometry(0.11, 0.11, Lw - 0.2, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 1.2, 1);
      root.add(at(0, sd * (width / 2 - 0.12), 0, mesh(dg, X.snow)));
    }
  }
  return consolidate(root);
}
