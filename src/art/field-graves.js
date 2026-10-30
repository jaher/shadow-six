/**
 * A field cemetery of the desert war (M10 art pass 2: the El Agheila camp's own dead, outside its SW corner): rows of
 * low mounds of dug earth, each with a plain timber cross at its head and the man's steel helmet hung on it, a taller
 * plain cross at the back of the plot, and a border of whitewashed stones round it. No insignia of any kind.
 * Local frame (crates convention): +X along the rows (w), the crosses at the back (−z), the plot's front at +d/2;
 * origin on the ground at the plot's centre. Plain colours in node.
 * @module art/field-graves
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, boxUV, rng } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

const GRAVE = { w: 0.8, len: 1.9, h: 0.26 };   // one mound
const PITCH = 1.25;                             // mound spacing along a row
const ROW = 2.45;                               // row spacing

function boxPart(w, h, d, mat, tile = 0.6) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Grave positions (local x, z of the mound centre) for `rows` rows of `cols[i]` graves, front row first. */
export function gravesLayout(p = {}) {
  const cols = p.cols ?? [3, 4], d = p.d ?? 5.6, out = [];
  cols.forEach((n, r) => {
    const z = d / 2 - 0.55 - GRAVE.len / 2 - r * ROW;
    for (let k = 0; k < n; k++) out.push([(k - (n - 1) / 2) * PITCH, z]);
  });
  return out;
}

/** @param {{w?: number, d?: number, cols?: number[], seed?: number}} p */
export function buildFieldGraves(p = {}) {
  const w = p.w ?? 6, d = p.d ?? 5.6, g = new THREE.Group(); g.name = 'kit:field_graves';
  const R = rng(p.seed ?? 1942);
  const earth = dressingMaterial('sand'), timber = paintedMaterial('beam', 0xc9b89a);   // the dug sand heaped back, sun-bleached deal
  const cairn = dressingMaterial('fieldstone'), STONE = new THREE.DodecahedronGeometry(0.13, 0);
  const stone = dressingMaterial('limewash'), helmet = paintedMaterial('steel', 0x9a8a62); // sand paint over field grey
  for (const [x, z] of gravesLayout({ ...p, d })) {
    // a low heaped mound of the dug sand: a lumpy half-ellipsoid, its foot sunk into the drift
    const geo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), P = geo.attributes.position;
    const ph = R() * 6.28, ph2 = R() * 6.28;   // (lumps as a function of position: the seam's twin vertices move alike)
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i), a = Math.atan2(P.getZ(i), P.getX(i)), k = 1 + 0.07 * Math.sin(3 * a + ph) * Math.sin(5 * y + ph2);
      P.setXYZ(i, P.getX(i) * k, Math.min(y, 0.9) * (0.95 + 0.1 * Math.sin(2 * a + ph2)) - 0.06, P.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(boxUV(geo.toNonIndexed(), 0.9), earth);
    m.scale.set(GRAVE.w / 2 + 0.05, GRAVE.h / 0.9, GRAVE.len / 2 + 0.05); m.position.set(x, 0, z); m.rotation.y = (R() - 0.5) * 0.05;
    m.receiveShadow = true; m.castShadow = true; g.add(m);
    // stones laid over the mound (against the wind and the jackals)
    for (let k = 0; k < 9; k++) {
      const a = R() * 6.2832, q = Math.sqrt(R()) * 0.85, u = Math.cos(a) * q, v = Math.sin(a) * q;
      const st = new THREE.Mesh(STONE, cairn);
      st.position.set(x + u * (GRAVE.w / 2), -0.04 + GRAVE.h * Math.sqrt(Math.max(0, 1 - q * q)), z + v * (GRAVE.len / 2));
      st.scale.set(0.5 + R() * 0.5, 0.35 + R() * 0.3, 0.5 + R() * 0.4); st.rotation.set(R() * 3, R() * 3, R() * 3);
      st.castShadow = true; st.receiveShadow = true; g.add(st);
    }
    // the cross at the head (−z end), a hair out of true
    const cz = z - GRAVE.len / 2 - 0.08, lean = (R() - 0.5) * 0.06, H = 0.95 + R() * 0.12;
    const post = boxPart(0.06, H + 0.25, 0.05, timber); post.position.set(x, (H + 0.25) / 2 - 0.25, cz); post.rotation.z = lean; g.add(post);
    const bar = boxPart(0.46, 0.06, 0.045, timber); bar.position.set(x - Math.sin(lean) * H * 0.72, H * 0.72, cz + 0.01); bar.rotation.z = lean; g.add(bar);
    // his helmet hung on the post top
    const hm = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    dome.scale.set(1, 0.8, 1.12);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.18, 0.07, 10, 1, true), helmet);
    skirt.position.y = -0.035; skirt.scale.set(1, 1, 1.12);
    for (const q of [dome, skirt]) { q.castShadow = true; q.receiveShadow = true; hm.add(q); }
    hm.position.set(x - Math.sin(lean) * H, H - 0.02, cz); hm.rotation.set((R() - 0.5) * 0.3, R() * 6.28, lean);
    g.add(hm);
  }
  // the plot's tall plain cross at the back centre
  const big = 2.1, bz = -d / 2 + 0.45;
  const bp = boxPart(0.12, big + 0.3, 0.1, timber); bp.position.set(0, (big + 0.3) / 2 - 0.3, bz); g.add(bp);
  const bb = boxPart(0.9, 0.11, 0.09, timber); bb.position.set(0, big * 0.74, bz); g.add(bb);
  // whitewashed stones round the plot (a stone every ~0.45 m)
  const stoneGeo = new THREE.DodecahedronGeometry(0.15, 0);
  const ring = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = ring[s], [bx, bz2] = ring[(s + 1) % 4], L = Math.hypot(bx - ax, bz2 - az), n = Math.round(L / 0.45);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, st = new THREE.Mesh(stoneGeo, stone);
      st.position.set(ax + (bx - ax) * t + (R() - 0.5) * 0.06, 0.03, az + (bz2 - az) * t + (R() - 0.5) * 0.06);
      st.scale.set(0.9 + R() * 0.5, 0.55 + R() * 0.25, 0.8 + R() * 0.4); st.rotation.set(R() * 3, R() * 3, R() * 3);
      st.castShadow = true; st.receiveShadow = true; g.add(st);
    }
  }
  return consolidate(g);
}
