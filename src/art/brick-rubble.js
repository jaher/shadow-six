/**
 * M15 second art pass (Compiègne): a heap of bomb-broken brickwork — the fallen upper floors of a burned-out town
 * house swept into a mound: a low lime-mortar and brick-dust core, loose broken bricks over it, a few slabs of ceiling
 * plaster and a charred joist or two run out of it to the ground. One heap is a `ruins` structure with
 * `variant: 'brick_heap'` (art/props.js); its footprint (`w` × `d`, `h` the crest) is the mission's own gameplay
 * footprint, the drawn mound stays inside it and never rises above `h`.
 * Merged per material (art/dressing.js consolidate): 3–4 draws per heap.
 * @module art/brick-rubble
 */
import * as THREE from 'three';
import { dressingMaterial, boulderGeometry, consolidate, rng, seedOf, boxUV } from './dressing.js';

let MATS = null;
/** Brick, mortar-dust rubble, plaster and charred timber (shared by every heap; darkened by the fire). */
function heapMats() {
  if (MATS) return MATS;
  const dark = (m, c, n) => { const x = m.clone(); x.color = new THREE.Color(c); x.name = `brick-heap:${n}`; return x; };
  MATS = { brick: dark(dressingMaterial('brick'), 0xa77a68, 'brick'), dust: dark(dressingMaterial('rubble'), 0xc9bba8, 'dust'),
    plaster: dark(dressingMaterial('plaster'), 0xa59d90, 'plaster'), beam: dark(dressingMaterial('creosote'), 0x2a221c, 'beam') };
  return MATS;
}

const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };

/** Crest height of the mound (an ellipsoidal cap, half axes a × b, crest H) at local (x, z). */
const moundY = (x, z, a, b, H) => H * Math.sqrt(Math.max(0, 1 - (x / a) ** 2 - (z / b) ** 2));

/**
 * @param {{id?: string, w?: number, d?: number, h?: number, beams?: number}} p footprint w × d (m, local x / z), crest h
 * @returns {THREE.Group}
 */
export function buildBrickHeap(p) {
  const w = p.w ?? 3, d = p.d ?? 2, h = Math.min(p.h ?? 0.8, 1.2), R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const M = heapMats(), g = new THREE.Group(); g.name = 'dressing:brick-heap';
  const a = w / 2 * 0.86, b = d / 2 * 0.86, H = h * 0.8;
  // the core: two or three overlapping lobes of broken brick (the brick texture, small, tumbled) on a skirt of pale
  // mortar dust and plaster grit that runs out to the toe (boulderGeometry rises ≈ 1.7 × ry above the ground)
  const skirt = boulderGeometry(a * 1.02, H * 0.28 / 1.7, b * 1.02, Math.floor(R() * 1e9), 3);
  g.add(mesh(skirt, M.dust));
  for (let k = 0, m = 2 + (w * d > 6 ? 1 : 0); k < m; k++) {
    const sx = 0.55 + R() * 0.25, sz = 0.55 + R() * 0.25, ox = (R() - 0.5) * a * (1 - sx) * 1.6, oz = (R() - 0.5) * b * (1 - sz) * 1.6;
    const lobe = boulderGeometry(a * sx, H * (k === 0 ? 1 : 0.7 + R() * 0.2) / 1.7, b * sz, Math.floor(R() * 1e9), 3);
    lobe.translate(ox, 0, oz);
    boxUV(lobe, 0.9);
    g.add(mesh(lobe, M.brick));
  }
  // loose bricks over the mound (whole and halves, tumbled), thinning out to the toe
  const n = Math.round(w * d * 15);
  for (let k = 0; k < n; k++) {
    const t = Math.sqrt(R()), ang = R() * Math.PI * 2;
    const x = Math.cos(ang) * a * 1.08 * t, z = Math.sin(ang) * b * 1.08 * t;
    const half = R() < 0.4 ? 0.5 : 1;
    const br = mesh(boxUV(new THREE.BoxGeometry(0.24 * half, 0.075, 0.115).toNonIndexed(), 0.6), M.brick);
    br.position.set(x, Math.min(h - 0.04, moundY(x, z, a, b, H) * 0.92 + 0.03), z);
    br.rotation.set((R() - 0.5) * 0.9, R() * 6.3, (R() - 0.5) * 0.9);
    g.add(br);
  }
  // a few brick clumps still bonded (lumps of wall that fell whole)
  for (let k = 0, m = 2 + Math.floor(R() * 2); k < m; k++) {
    const x = (R() - 0.5) * a, z = (R() - 0.5) * b, lw = 0.45 + R() * 0.35;
    const cl = mesh(boxUV(new THREE.BoxGeometry(lw, 0.2, 0.24).toNonIndexed(), 0.9), M.brick);
    cl.position.set(x, Math.min(h - 0.12, moundY(x, z, a, b, H) * 0.85 + 0.05), z);
    cl.rotation.set((R() - 0.5) * 0.7, R() * 6.3, (R() - 0.5) * 0.7);
    g.add(cl);
  }
  // slabs of ceiling plaster (lath side down), tilted on the slope
  for (let k = 0, m = 2 + Math.floor(R() * 3); k < m; k++) {
    const x = (R() - 0.5) * a * 1.4, z = (R() - 0.5) * b * 1.4;
    const sl = mesh(boxUV(new THREE.BoxGeometry(0.35 + R() * 0.4, 0.025, 0.25 + R() * 0.3).toNonIndexed(), 1.2), M.plaster);
    sl.position.set(x, moundY(x, z, a, b, H) * 0.9 + 0.02, z);
    sl.rotation.set((R() - 0.5) * 0.6, R() * 6.3, (R() - 0.5) * 0.6);
    g.add(sl);
  }
  // charred joists run out of the heap to the ground (one end buried in the crest, the other on the floor)
  for (let k = 0, m = p.beams ?? 1 + Math.floor(R() * 2); k < m; k++) {
    const ang = R() * Math.PI * 2, L = Math.min(Math.hypot(a * Math.cos(ang), b * Math.sin(ang)) * 1.5, 1.4 + R() * 1.4);
    const ex = Math.cos(ang) * a * 0.95, ez = Math.sin(ang) * b * 0.95;   // the end on the floor, at the toe
    const top = Math.min(h - 0.1, H * 0.75), run = Math.sqrt(Math.max(0.01, L * L - top * top));
    const bm = mesh(boxUV(new THREE.BoxGeometry(0.13, 0.19, L).toNonIndexed(), 1.5), M.beam);
    bm.position.set(ex - Math.cos(ang) * run / 2, top / 2 + 0.06, ez - Math.sin(ang) * run / 2);
    bm.rotation.order = 'YXZ';
    bm.rotation.set(Math.atan2(top, run), Math.PI / 2 - ang, (R() - 0.5) * 0.3); // +z (outward end) down to the floor
    g.add(bm);
  }
  // never above the gameplay crest (a tumbled brick or a lobe's peak can poke over it): squash the heap down to h
  const top = new THREE.Box3().setFromObject(g).max.y, out = consolidate(g);
  if (top > h) out.traverse((o) => { if (o.isMesh) { o.geometry.scale(1, h / top, 1); o.position.y *= h / top; } });
  return out;
}

/**
 * M15 second art pass: the shattered garden wall stub in the S street (`wall` variant `ruin_wall_stub`, the corner
 * behind which the Spy hides e3's body): a Picardy brick garden wall in English bond under a stone coping, its pier
 * standing whole at the W end, the run broken off ragged towards the E (never lower than 0.8 × its gameplay height,
 * so the drawn wall still hides what the gameplay wall hides), fallen bricks at the broken end. No plaster, no soot:
 * an outdoor wall, not a burned room.
 * @param {number[][]} points the wall line @param {{h?: number, width?: number}} o @param {() => number} R seeded rng
 * @returns {THREE.Group}
 */
export function brokenGardenWall(points, o, h, width, R) {
  const brick = dressingMaterial('brick'), cope = dressingMaterial('sandstone');
  const root = new THREE.Group(); root.name = 'dressing:wall:garden-stub';
  const [ax, az] = points[0], [bx, bz] = points[points.length - 1], L = Math.hypot(bx - ax, bz - az);
  if (L < 1e-3) return root;
  const ux = (bx - ax) / L, uz = (bz - az) / L, rot = -Math.atan2(uz, ux), cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const at = (m, s, y, off = 0) => { m.position.set(cx + ux * s - uz * off, y, cz + uz * s + ux * off); m.rotation.y = rot; root.add(m); return m; };
  const segs = Math.max(6, Math.round(L / 0.3));
  // the top: level to ~45 % of the run, then broken down in steps and bites towards the E end
  const drop = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    drop.push(t < 0.45 ? 0 : Math.min(0.2, (t - 0.45) * 0.32 + (R() < 0.35 ? R() * 0.08 : 0)));
  }
  const geo = new THREE.BoxGeometry(L, h, width, segs, 1, 1), P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > 0) P.setY(i, h / 2 - h * drop[Math.round((P.getX(i) / L + 0.5) * segs)]);
  geo.computeVertexNormals();
  at(mesh(boxUV(geo.toNonIndexed(), 2.4), brick), 0, h / 2);
  // coping slabs on the standing length (a broken last slab askew on the wall head)
  const copeLen = L * 0.45;
  for (let s = 0; s + 0.6 <= copeLen; s += 0.62) at(mesh(boxUV(new THREE.BoxGeometry(0.6, 0.08, width + 0.08).toNonIndexed(), 1), cope), -L / 2 + s + 0.3, h + 0.04);
  const tilt = at(mesh(boxUV(new THREE.BoxGeometry(0.45, 0.08, width + 0.08).toNonIndexed(), 1), cope), -L / 2 + copeLen + 0.2, h - 0.02);
  tilt.rotation.z = -0.25;
  // the end pier with its cap at the W end
  at(mesh(boxUV(new THREE.BoxGeometry(0.6, h + 0.1, width + 0.12).toNonIndexed(), 2.4), brick), -L / 2 + 0.3, (h + 0.1) / 2);
  at(mesh(boxUV(new THREE.BoxGeometry(0.72, 0.1, width + 0.24).toNonIndexed(), 1), cope), -L / 2 + 0.3, h + 0.15);
  // fallen bricks at the broken end, tight along the foot (≤ 0.2 m off the faces: where nobody's body goes — the walls
  // keep walkers and crawlers further off) and a dropped coping slab leaning on the wall head's broken end
  for (let q = 0; q < 12; q++) {
    const s = L / 2 - R() * L * 0.4, off = (R() < 0.5 ? -1 : 1) * (width / 2 + 0.05 + R() * 0.12);
    const b = at(mesh(boxUV(new THREE.BoxGeometry(0.23, 0.07, 0.11).toNonIndexed(), 0.6), brick), s, 0.035, off);
    b.rotation.set((R() - 0.5) * 0.5, rot + (R() < 0.5 ? 0 : Math.PI / 2) + (R() - 0.5) * 0.5, (R() - 0.5) * 0.5);
  }
  const fall = at(mesh(boxUV(new THREE.BoxGeometry(0.6, 0.08, width + 0.08).toNonIndexed(), 1), cope), L / 2 - 0.35, h * 0.8 - 0.1);
  fall.rotation.z = 0.55;
  return consolidate(root);
}
