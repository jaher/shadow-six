/**
 * Seeded procedural tree generator (own code; inspired by recursive-branch generators such as ez-tree, MIT).
 * Every call with a different seed yields a different tree: trunk gnarl, branch count/azimuth/length, crown
 * shape, leaf-card placement, lean and size all derive from the seed. Output is raw arrays that vegetation.js
 * merges into a few draw calls.
 * @module terrain-b/treegen
 */
// THREE is injected (useThree) so this module also runs in a module Worker, where import maps do not apply.
let THREE = null;
let UP = null;
/** Provide the three.js namespace (main thread: vegetation.js; worker: treegen.worker.js). */
export function useThree(T) { THREE = T; UP = new T.Vector3(0, 1, 0); }
import { rng } from './noise.js';

// Foliage card layers (assets/foliage.json: <name>_0, <name>_1 → layer 2*i + v) and bark layers (assets/bark.json)
export const LEAF_LAYERS = ['oak', 'beech', 'birch', 'poplar', 'plane', 'olive', 'hedge', 'scrub', 'spruce', 'fir', 'pine', 'palm', 'palmdry'];
export const BARK_LAYERS = ['oak', 'beech', 'birch', 'poplar', 'plane', 'olive', 'pine', 'spruce', 'palm', 'dead', 'burnt', 'generic'];

/**
 * Species parameter sets. levels[k]: seg (segments), radial (sides), children, start (first child t),
 * angle (deg from parent), lenRatio, radRatio, gnarl, tropism (+up / -down).
 */
export const SPECIES = {
  oak: { kind: 'broad', bark: 'oak', leaf: 'oak', H: [9, 14], r0: [0.28, 0.45], crown: 'dome', flare: 0.7,
    levels: [
      { seg: 10, radial: 10, children: 6, start: 0.32, angle: 52, lenRatio: 0.62, radRatio: 0.55, gnarl: 0.16, tropism: 0.04 },
      { seg: 7, radial: 7, children: 5, start: 0.2, angle: 48, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.28, tropism: 0.0 },
      { seg: 4, radial: 4, children: 4, start: 0.25, angle: 45, lenRatio: 0.5, radRatio: 0.55, gnarl: 0.3, tropism: 0.02 },
      { seg: 2, radial: 3, children: 0 }],
    leafLevel: 2, leaves: 6, leafSize: [1.1, 1.6], leafStart: 0.3 },
  beech: { kind: 'broad', bark: 'beech', leaf: 'beech', H: [11, 17], r0: [0.25, 0.38], crown: 'dome', flare: 0.5,
    levels: [
      { seg: 10, radial: 10, children: 6, start: 0.35, angle: 40, lenRatio: 0.6, radRatio: 0.55, gnarl: 0.08, tropism: 0.06 },
      { seg: 6, radial: 6, children: 5, start: 0.2, angle: 45, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.15, tropism: 0.0 },
      { seg: 4, radial: 4, children: 4, start: 0.25, angle: 50, lenRatio: 0.5, radRatio: 0.55, gnarl: 0.2, tropism: -0.03 },
      { seg: 2, radial: 3, children: 0 }],
    leafLevel: 2, leaves: 6, leafSize: [1.1, 1.5], leafStart: 0.25 },
  plane: { kind: 'broad', bark: 'plane', leaf: 'plane', H: [14, 20], r0: [0.3, 0.45], crown: 'dome', flare: 0.5,
    levels: [
      { seg: 10, radial: 10, children: 5, start: 0.4, angle: 38, lenRatio: 0.58, radRatio: 0.58, gnarl: 0.1, tropism: 0.05 },
      { seg: 6, radial: 6, children: 5, start: 0.2, angle: 42, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.16, tropism: 0.02 },
      { seg: 4, radial: 4, children: 4, start: 0.3, angle: 45, lenRatio: 0.5, radRatio: 0.55, gnarl: 0.2, tropism: 0.0 },
      { seg: 2, radial: 3, children: 0 }],
    leafLevel: 2, leaves: 6, leafSize: [1.3, 1.8], leafStart: 0.3 },
  poplar: { kind: 'broad', bark: 'poplar', leaf: 'poplar', H: [16, 24], r0: [0.22, 0.32], crown: 'column', flare: 0.35,
    levels: [
      { seg: 12, radial: 8, children: 14, start: 0.12, angle: 18, lenRatio: 0.3, radRatio: 0.4, gnarl: 0.05, tropism: 0.12 },
      { seg: 5, radial: 5, children: 5, start: 0.15, angle: 22, lenRatio: 0.5, radRatio: 0.5, gnarl: 0.12, tropism: 0.1 },
      { seg: 2, radial: 3, children: 0 }],
    leafLevel: 1, leaves: 9, leafSize: [0.9, 1.3], leafStart: 0.1 },
  birch: { kind: 'broad', bark: 'birch', leaf: 'birch', H: [9, 15], r0: [0.12, 0.2], crown: 'oval', flare: 0.25,
    levels: [
      { seg: 12, radial: 8, children: 9, start: 0.3, angle: 35, lenRatio: 0.45, radRatio: 0.45, gnarl: 0.07, tropism: 0.05 },
      { seg: 6, radial: 5, children: 5, start: 0.2, angle: 40, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.15, tropism: -0.1 },
      { seg: 3, radial: 3, children: 0 }],
    leafLevel: 1, leaves: 9, leafSize: [0.8, 1.2], leafStart: 0.2, droop: 0.5 },
  olive: { kind: 'broad', bark: 'olive', leaf: 'olive', H: [4, 6.5], r0: [0.2, 0.34], crown: 'dome', flare: 0.9, stems: [1, 3],
    levels: [
      { seg: 8, radial: 9, children: 5, start: 0.4, angle: 45, lenRatio: 0.7, radRatio: 0.6, gnarl: 0.35, tropism: 0.0 },
      { seg: 5, radial: 6, children: 5, start: 0.2, angle: 45, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.3, tropism: 0.02 },
      { seg: 3, radial: 3, children: 0 }],
    leafLevel: 1, leaves: 9, leafSize: [0.8, 1.1], leafStart: 0.2 },
  dead_tree: { kind: 'broad', bark: 'dead', leaf: null, H: [7, 12], r0: [0.2, 0.36], crown: 'dome', flare: 0.6,
    levels: [
      { seg: 9, radial: 9, children: 5, start: 0.35, angle: 45, lenRatio: 0.6, radRatio: 0.5, gnarl: 0.22, tropism: 0.03 },
      { seg: 5, radial: 5, children: 3, start: 0.3, angle: 45, lenRatio: 0.5, radRatio: 0.5, gnarl: 0.3, tropism: 0.0 },
      { seg: 3, radial: 3, children: 2, start: 0.4, angle: 45, lenRatio: 0.5, radRatio: 0.5, gnarl: 0.35, tropism: 0.0 },
      { seg: 2, radial: 3, children: 0 }],
    broken: 0.35 },
  spruce: { kind: 'conifer', bark: 'spruce', leaf: 'spruce', H: [10, 18], r0: [0.18, 0.3], crownBase: 0.08, width: 0.3, whorl: 5, droop: -0.18, flare: 0.3 },
  fir: { kind: 'conifer', bark: 'spruce', leaf: 'fir', H: [9, 15], r0: [0.16, 0.26], crownBase: 0.1, width: 0.28, whorl: 5, droop: -0.05, flare: 0.3 },
  pine: { kind: 'conifer', bark: 'pine', leaf: 'pine', H: [12, 19], r0: [0.2, 0.32], crownBase: 0.6, width: 0.27, whorl: 4, droop: 0.05, flare: 0.3, pine: true },
  date_palm: { kind: 'palm', bark: 'palm', leaf: 'palm', H: [7, 14], r0: [0.2, 0.26] },
  hedge: { kind: 'bush', bark: 'generic', leaf: 'hedge', H: [2.0, 3.2], R: [1.0, 1.5], cards: 90, leafSize: [0.9, 1.3] },
  shrub: { kind: 'bush', bark: 'generic', leaf: 'hedge', H: [1.0, 1.8], R: [0.7, 1.2], cards: 40, leafSize: [0.7, 1.0] },
  desert_shrub: { kind: 'bush', bark: 'dead', leaf: 'scrub', H: [0.5, 1.1], R: [0.5, 1.0], cards: 22, leafSize: [0.5, 0.8], sparse: 0.35 },
};
SPECIES.cypress = { ...SPECIES.poplar, leaf: 'fir', bark: 'pine', H: [8, 14], r0: [0.18, 0.26], leafSize: [0.8, 1.1] };
SPECIES.spruce_snow = SPECIES.spruce;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

/** Growable vertex buffer: position, normal, uv, aInfo (layer, sway, flex, phase), aTint (rgb). */
/** Wind response class per species kind (vegetation.js vegWind): stiffness, natural frequency, frond whip. */
export const WIND_KIND = { broad: 0, conifer: 1, palm: 2, bush: 3 };

export class GeoAcc {
  constructor() { this.p = []; this.n = []; this.uv = []; this.info = []; this.tint = []; this.root = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, u, v, info, tint) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.info.push(info[0], info[1], info[2], info[3]); this.tint.push(tint[0], tint[1], tint[2]);
    this.root.push(0, 0, 0, 1);
    return this.count - 1;
  }
  /** Tree root for hierarchical wind (step 4w): aRoot = (x, y, z, H + 100·kind) on vertices `from`..count. */
  setRoot(from, x, y, z, H, kind) {
    for (let i = from; i < this.count; i++) { const o = i * 4; this.root[o] = x; this.root[o + 1] = y; this.root[o + 2] = z; this.root[o + 3] = Math.min(H, 99) + 100 * kind; }
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** Apply a Matrix4 to positions and normals from vertex `from` on. */
  transform(m, from = 0) {
    const nm = new THREE.Matrix3().getNormalMatrix(m), t = V();
    for (let i = from; i < this.count; i++) {
      t.fromArray(this.p, i * 3).applyMatrix4(m).toArray(this.p, i * 3);
      t.fromArray(this.n, i * 3).applyMatrix3(nm).normalize().toArray(this.n, i * 3);
    }
  }
  /** Plain typed arrays (transferable from a worker). */
  toArrays() {
    return { p: new Float32Array(this.p), n: new Float32Array(this.n), uv: new Float32Array(this.uv), info: new Float32Array(this.info),
      tint: new Float32Array(this.tint), root: new Float32Array(this.root), idx: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx) };
  }
  static arraysToGeometry(a) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.n, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aInfo', new THREE.BufferAttribute(a.info, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(a.tint, 3));
    if (a.root) g.setAttribute('aRoot', new THREE.BufferAttribute(a.root, 4));
    g.setIndex(new THREE.BufferAttribute(a.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setAttribute('aRoot', new THREE.Float32BufferAttribute(this.root, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function perp(d) {
  const a = Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0);
  return V().crossVectors(d, a).normalize();
}

/** Tube along points with parallel-transport frames. */
function tube(acc, pts, rads, radial, barkLayer, windFn, tint, uRep) {
  let nrm = perp(V().subVectors(pts[1], pts[0]).normalize());
  let s = 0;
  const rows = [];
  for (let i = 0; i < pts.length; i++) {
    const d = V().subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    nrm.sub(d.clone().multiplyScalar(nrm.dot(d))).normalize();
    const bin = V().crossVectors(d, nrm);
    if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
    const row = [];
    const w = windFn(pts[i]);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const n = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      const p = pts[i].clone().addScaledVector(n, rads[i]);
      row.push(acc.vert(p, n, (k / radial) * uRep, s / 0.9, [barkLayer, w[0], w[1], w[2]], tint));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < radial; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
    acc.tri(a, b, c); acc.tri(b, d, c);
  }
}

/** A foliage card: base at p, growing along `up`, facing roughly `face`. Normal bent later toward crown shape. */
function card(acc, p, up, right, size, layer, w, tint, width = 1) {
  const r = right.clone().multiplyScalar(size * 0.5 * width);
  const u = up.clone().multiplyScalar(size);
  const n = V().crossVectors(right, up).normalize();
  const base = p.clone().addScaledVector(up, -size * 0.08);
  const a = acc.vert(base.clone().sub(r), n, 0, 0, [layer, w[0], w[1], w[2]], tint);
  const b = acc.vert(base.clone().add(r), n, 1, 0, [layer, w[0], w[1], w[2]], tint);
  const c = acc.vert(base.clone().add(r).add(u), n, 1, 1, [layer, w[0], w[1] + 0.5, w[2]], tint);
  const d = acc.vert(base.clone().sub(r).add(u), n, 0, 1, [layer, w[0], w[1] + 0.5, w[2]], tint);
  acc.tri(a, b, c); acc.tri(a, c, d);
}

/** Bend foliage normals from vertex `from` toward the outward crown direction (soft, volumetric shading). */
function bendNormals(acc, from, centre, radii, k = 0.75) {
  const t = V(), n = V();
  for (let i = from; i < acc.count; i++) {
    t.fromArray(acc.p, i * 3).sub(centre).divide(radii).normalize();
    n.fromArray(acc.n, i * 3);
    if (n.dot(t) < 0) n.negate();
    n.lerp(t, k).normalize().toArray(acc.n, i * 3);
  }
}

function rotateAbout(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }

/** Recursive broadleaf / dead tree. */
function genBroad(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
  const levels = sp.levels;
  const leafVar = (r() * 2) | 0;
  const leafLayer = sp.leaf ? LEAF_LAYERS.indexOf(sp.leaf) * 2 + leafVar : -1;
  const barkLayer = BARK_LAYERS.indexOf(sp.bark);
  const crownPts = [];
  const cardMul = q.cards;
  const trunkLen = H * (sp.crown === 'column' ? 0.95 : 0.78);
  const windFn = (lvl) => (p) => [Math.pow(Math.max(0, p.y) / H, 1.5), lvl / levels.length, phase + lvl * 0.7];
  const shape = (t) => (sp.crown === 'column' ? 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) : sp.crown === 'oval' ? 0.5 + 0.5 * Math.sin(Math.PI * t) : 0.45 + 0.75 * Math.sin(Math.PI * (0.25 + 0.7 * t)));

  function branch(p0, dir, len, r0, lvl, azi0) {
    const L = levels[lvl];
    const seg = Math.max(2, Math.round(L.seg * q.seg));
    const pts = [], rads = [], dirs = [];
    const p = p0.clone(), d = dir.clone();
    const broken = sp.broken && lvl > 0 && r() < sp.broken ? 0.4 + 0.4 * r() : 1;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      pts.push(p.clone()); dirs.push(d.clone());
      let rr = lerp(r0, r0 * (lvl === 0 ? 0.35 : 0.2), t);
      if (lvl === 0) rr *= 1 + (sp.flare || 0) * Math.pow(Math.max(0, 1 - t * 8), 3);
      rads.push(Math.max(0.006, rr));
      if (i < seg) {
        d.add(V(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).multiplyScalar(L.gnarl || 0));
        d.y += (L.tropism || 0) - (sp.droop || 0) * 0.08 * lvl;
        d.normalize();
        p.addScaledVector(d, (len * broken) / seg);
      }
    }
    const radial = Math.max(3, Math.round(L.radial * q.radial));
    tube(bark, pts, rads, radial, barkLayer, windFn(lvl), tint, Math.max(1, Math.round((2 * Math.PI * r0) / 0.5)));
    if (broken < 1) return;
    // children
    const nC = L.children ? Math.max(1, Math.round(L.children * (0.75 + 0.5 * r()) * (lvl >= 2 ? q.twigs : 1))) : 0;
    let azi = azi0 + r() * 6.28;
    for (let c = 0; c < nC; c++) {
      const t = lerp(L.start, 0.97, (c + 0.3 + 0.5 * r()) / nC);
      const fi = t * seg, i = Math.min(seg - 1, Math.floor(fi)), f = fi - i;
      const cp = pts[i].clone().lerp(pts[i + 1], f);
      const pd = dirs[i].clone().lerp(dirs[i + 1], f).normalize();
      azi += 2.4 + (r() - 0.5) * 0.6;
      const ax = rotateAbout(perp(pd), pd, azi);
      const ang = THREE.MathUtils.degToRad(L.angle * (0.75 + 0.5 * r()));
      const cd = rotateAbout(pd, ax, ang);
      const clen = len * L.lenRatio * (lvl === 0 ? shape(t) : 1 - 0.4 * t) * (0.8 + 0.4 * r());
      const cr = lerp(r0, r0 * 0.3, t) * L.radRatio;
      branch(cp, cd, clen, cr, lvl + 1, azi);
    }
    // leaf cards on the twigs
    if (leafLayer >= 0 && lvl >= sp.leafLevel) {
      const n = Math.max(1, Math.round(sp.leaves * cardMul * (0.7 + 0.6 * r())));
      for (let k = 0; k < n; k++) {
        const t = lerp(sp.leafStart, 1, r());
        const fi = t * seg, i = Math.min(seg - 1, Math.floor(fi));
        const cp = pts[i].clone().lerp(pts[i + 1], fi - i);
        const up = dirs[i].clone().add(V(r() - 0.5, r() - 0.5 + (sp.droop ? -sp.droop : 0.1), r() - 0.5).multiplyScalar(1.4)).normalize();
        const right = V().crossVectors(up, V(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
        const size = lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale * (0.8 + 0.25 * H / sp.H[1]);
        const w = [Math.pow(Math.max(0, cp.y) / H, 1.5), 1, phase + r() * 6.28];
        const s = 0.85 + 0.3 * r();
        card(leaves, cp, up, right, size, leafLayer, w, [leafTint[0] * s, leafTint[1] * s, leafTint[2] * s]);
        crownPts.push(cp);
      }
    }
  }
  const stems = sp.stems ? sp.stems[0] + ((r() * (sp.stems[1] - sp.stems[0] + 1)) | 0) : 1;
  const r0 = lerp(sp.r0[0], sp.r0[1], r()) * (H / sp.H[1]) ** 0.6 / Math.sqrt(stems);
  for (let s = 0; s < stems; s++) {
    const a = r() * 6.28, lean = stems > 1 ? 0.35 + 0.2 * r() : 0.04 * r();
    const dir = V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    branch(V(Math.cos(a) * 0.1 * (stems - 1), -0.15, Math.sin(a) * 0.1 * (stems - 1)), dir, trunkLen / (stems > 1 ? 1.15 : 1), r0, 0, r() * 6.28);
  }
  // T-A graft (must-fix 7): fill the crown shell with clumped cards so the canopy reads as a full, readable mass
  // from the high game camera; clumps are seeded around existing twig leaves (never floating in empty air)
  if (leafLayer >= 0 && crownPts.length > 8) {
    const bb = new THREE.Box3().setFromPoints(crownPts), c = V(), rad = V();
    bb.getCenter(c); bb.getSize(rad).multiplyScalar(0.5);
    const nFill = Math.round(crownPts.length * (sp.fill ?? 0.45) * cardMul);
    for (let k = 0; k < nFill; k++) {
      const anchor = crownPts[(r() * crownPts.length) | 0];
      const out = V().subVectors(anchor, c).divide(rad.clone().addScalar(0.01));
      if (out.length() < 0.55) continue;                     // shell only: interior stays shaded/open
      out.normalize();
      const p = anchor.clone().addScaledVector(out, 0.2 + 0.5 * r()).add(V(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).multiplyScalar(0.7));
      const up = out.clone().add(V(0, 0.6, 0)).add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9)).normalize();
      const right = V().crossVectors(up, V(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
      const size = lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale * 0.95;
      const sh = 0.8 + 0.35 * r();
      card(leaves, p, up, right, size, leafLayer + (r() < 0.5 ? 0 : (leafLayer % 2 ? -1 : 1)), [Math.pow(Math.max(0, p.y) / H, 1.5), 1, phase + r() * 6.28], [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh]);
      crownPts.push(p);
    }
  }
  return crownPts;
}

function genConifer(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
  const barkLayer = BARK_LAYERS.indexOf(sp.bark);
  const leafLayer = LEAF_LAYERS.indexOf(sp.leaf) * 2 + ((r() * 2) | 0);
  const r0 = lerp(sp.r0[0], sp.r0[1], r()) * (H / sp.H[1]) ** 0.7;
  const wind = (p, fl) => [Math.pow(Math.max(0, p.y) / H, 1.5), fl, phase];
  // trunk
  const pts = [], rads = [];
  const seg = Math.max(4, Math.round(12 * q.seg));
  let x = 0, z = 0;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(V(x, t * H - 0.15, z));
    rads.push(Math.max(0.02, r0 * (1 - t * 0.92) * (1 + (sp.flare || 0) * Math.pow(Math.max(0, 1 - t * 10), 3))));
    x += (r() - 0.5) * 0.08; z += (r() - 0.5) * 0.08;
  }
  tube(bark, pts, rads, Math.max(4, Math.round(8 * q.radial)), barkLayer, (p) => wind(p, 0), tint, 2);
  const crown = [];
  const nW = Math.round((H * (1 - sp.crownBase)) / (sp.pine ? 0.75 : 0.45));
  const width = sp.width * H * (0.85 + 0.3 * r());
  const cards = q.cards;
  for (let w = 0; w < nW; w++) {
    const t = sp.crownBase + (1 - sp.crownBase) * ((w + r() * 0.6) / nW);
    const y = t * H;
    const nb = Math.max(2, sp.whorl + ((r() * 3) | 0) - 1 + (sp.pine ? 1 : 0));
    const a0 = r() * 6.28;
    const cw = x * t, czz = z * t; // trunk wander offset approx
    for (let b = 0; b < nb; b++) {
      if (r() < 0.12) continue; // missing branch → irregular silhouette
      const a = sp.pine ? a0 + (w * nb + b) * 2.39996 + (r() - 0.5) * 0.9 : a0 + (b / nb) * 6.28 + (r() - 0.5) * 0.7; // pine: golden angle (no star)
      const tt = (t - sp.crownBase) / (1 - sp.crownBase);
      let len = width * Math.pow(1 - tt, sp.pine ? 0.5 : 0.95) * (0.75 + 0.5 * r()) + 0.25;
      if (sp.pine) len *= (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, tt * 1.1 + 0.1))) * (0.6 + 0.6 * r()); // rounded umbrella crown
      const elev = lerp(sp.droop, sp.pine ? 0.5 : 0.6, tt * tt) + (r() - 0.5) * 0.2;
      const dir = V(Math.cos(a), elev, Math.sin(a)).normalize();
      const p0 = V(cw, y, czz);
      const bp = [p0.clone()], br = [];
      const s3 = sp.pine ? 4 : 3;
      const d = dir.clone(), p = p0.clone();
      for (let i = 0; i < s3; i++) { d.y -= sp.pine ? -0.02 : 0.08 * (1 - tt); d.add(V(r() - 0.5, 0, r() - 0.5).multiplyScalar(sp.pine ? 0.25 : 0.08)).normalize(); p.addScaledVector(d, len / s3); bp.push(p.clone()); }
      for (let i = 0; i <= s3; i++) br.push(Math.max(0.012, rads[Math.min(seg, Math.round(t * seg))] * 0.45 * (1 - i / (s3 + 1))));
      tube(bark, bp, br, 3, barkLayer, (pp) => wind(pp, 0.5), tint, 1);
      // needle cards
      const n = Math.max(1, Math.round((sp.pine ? 2 + len * 2.2 : len / 0.3) * cards));
      for (let k = 0; k < n; k++) {
        const u = sp.pine ? 0.35 + 0.65 * ((k + r()) / n) : 0.12 + 0.88 * ((k + r()) / n);
        const fi = u * s3, i = Math.min(s3 - 1, Math.floor(fi));
        const cp = bp[i].clone().lerp(bp[i + 1], fi - i);
        const bd = V().subVectors(bp[i + 1], bp[i]).normalize();
        const up = bd.clone().add(V(r() - 0.5, sp.pine ? 0.5 : (r() - 0.6) * 0.5, r() - 0.5).multiplyScalar(0.6)).normalize();
        let right = V().crossVectors(up, UP).normalize();
        right = rotateAbout(right, up, (r() - 0.5) * (sp.pine ? 2.5 : 0.9));
        const size = (sp.pine ? 1.0 + 0.5 * r() : Math.min(1.3, 0.6 + len * 0.3)) * q.leafScale;
        const s = 0.85 + 0.3 * r();
        card(leaves, cp.clone().addScaledVector(up, -size * 0.25), up, right, size, leafLayer, [Math.pow(y / H, 1.5), 1, phase + r() * 6], [leafTint[0] * s, leafTint[1] * s, leafTint[2] * s], 1.1);
        crown.push(cp);
      }
    }
  }
  // pine (must-fix 6): clumped needle tufts over the crown shell so the umbrella crown reads as a mass, not a star
  if (sp.pine && crown.length > 6) {
    const bb = new THREE.Box3().setFromPoints(crown), c = V(), rad = V();
    bb.getCenter(c); bb.getSize(rad).multiplyScalar(0.5);
    const nFill = Math.round(crown.length * 0.9 * cards);
    for (let k = 0; k < nFill; k++) {
      const a = crown[(r() * crown.length) | 0], b = crown[(r() * crown.length) | 0];
      const p = a.clone().lerp(b, 0.25 + 0.3 * r());
      const out = V().subVectors(p, c).divide(rad.clone().addScalar(0.01));
      if (out.length() < 0.35) continue;
      const up = out.normalize().add(V(0, 0.9, 0)).add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.8)).normalize();
      const right = rotateAbout(V().crossVectors(up, UP).normalize(), up, r() * 6.28);
      const size = (0.9 + 0.5 * r()) * q.leafScale, sh = 0.85 + 0.3 * r();
      card(leaves, p, up, right, size, leafLayer, [Math.pow(p.y / H, 1.5), 1, phase + r() * 6], [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh], 1.1);
      crown.push(p);
    }
  }
  // leader
  const top = pts[pts.length - 1];
  for (let k = 0; k < 3; k++) card(leaves, top.clone().add(V(0, -0.9, 0)), V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize(), V(Math.cos(k), 0, Math.sin(k)), 1.1 * q.leafScale, leafLayer, [1, 1, phase], leafTint, 0.8);
  return crown;
}

function genPalm(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
  const barkLayer = BARK_LAYERS.indexOf('palm');
  const r0 = lerp(sp.r0[0], sp.r0[1], r());
  const seg = Math.max(6, Math.round(14 * q.seg));
  const a = r() * 6.28, lean = 0.05 + 0.3 * r() * r();
  const d = V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
  const p = V(0, -0.2, 0), pts = [], rads = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(p.clone());
    rads.push(r0 * (1 + 0.5 * Math.pow(Math.max(0, 1 - t * 6), 2)) * (1 + 0.1 * Math.sin(t * 40 * (0.8 + r() * 0.1))) * (1 - 0.15 * t));
    d.y += 0.03 * t; d.normalize();
    p.addScaledVector(d, H / seg);
  }
  tube(bark, pts, rads, Math.max(5, Math.round(9 * q.radial)), barkLayer, (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0, phase], tint, 2);
  const top = pts[pts.length - 1];
  const crown = [];
  const nF = Math.round((16 + r() * 10) * Math.min(1, q.cards + 0.3));
  let az = r() * 6.28;
  for (let f = 0; f < nF; f++) {
    az += 2.39996 + (r() - 0.5) * 0.3;
    const age = f / nF; // 0 young (upright) → 1 old (drooping)
    const dry = age > 0.82 && r() < 0.8;
    const elev = dry ? -1.2 - 0.3 * r() : lerp(1.15, -0.45, age) + (r() - 0.5) * 0.3;
    const len = (dry ? 2.2 : 2.8 + 1.6 * r()) * (0.75 + 0.25 * H / sp.H[1]);
    const layer = LEAF_LAYERS.indexOf(dry ? 'palmdry' : 'palm') * 2 + ((r() * 2) | 0);
    const out = V(Math.cos(az), 0, Math.sin(az));
    const side = V(-Math.sin(az), 0, Math.cos(az));
    const S = 7;
    let e = elev;
    const fp = top.clone().addScaledVector(out, 0.15);
    const fold = 0.45 + 0.2 * r();
    const rows = [];
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      const dir = out.clone().multiplyScalar(Math.cos(e)).add(V(0, Math.sin(e), 0));
      const wdt = len * 0.34 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t)), 0.6) * (dry ? 0.6 : 1);
      const lift = V(0, 1, 0).multiplyScalar(wdt * 0.5 * Math.sin(fold));
      const nrmUp = V().crossVectors(side, dir).normalize();
      if (nrmUp.y < 0) nrmUp.negate();
      const w = [Math.pow(Math.max(0, fp.y) / H, 2), 0.3 + 0.7 * t, phase + f * 0.37];
      const lt = dry ? [1, 1, 1] : [leafTint[0] * (0.9 + 0.2 * r()), leafTint[1], leafTint[2]];
      rows.push([
        leaves.vert(fp.clone().addScaledVector(side, -wdt * Math.cos(fold)).add(lift), nrmUp, 0, t, [layer, ...w], lt),
        leaves.vert(fp.clone(), nrmUp, 0.5, t, [layer, ...w], lt),
        leaves.vert(fp.clone().addScaledVector(side, wdt * Math.cos(fold)).add(lift), nrmUp, 1, t, [layer, ...w], lt),
      ]);
      crown.push(fp.clone());
      fp.addScaledVector(dir, len / S);
      e -= (dry ? 0.05 : 0.16 + 0.1 * r()) * (1 + Math.max(0, Math.cos(e)));
    }
    for (let i = 0; i < S; i++) for (let k = 0; k < 2; k++) {
      const a0 = rows[i][k], b0 = rows[i][k + 1], c0 = rows[i + 1][k], d0 = rows[i + 1][k + 1];
      leaves.tri(a0, b0, d0); leaves.tri(a0, d0, c0);
    }
  }
  return crown;
}

function genBush(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
  const R = lerp(sp.R[0], sp.R[1], r());
  const leafLayer = LEAF_LAYERS.indexOf(sp.leaf) * 2 + ((r() * 2) | 0);
  const barkLayer = BARK_LAYERS.indexOf(sp.bark);
  const stems = 3 + ((r() * 4) | 0);
  for (let s = 0; s < stems; s++) {
    const a = r() * 6.28, rr = R * (0.4 + 0.5 * r());
    const pts = [V(0, -0.05, 0), V(Math.cos(a) * rr * 0.4, H * 0.45, Math.sin(a) * rr * 0.4), V(Math.cos(a) * rr * 0.8, H * (0.75 + 0.2 * r()), Math.sin(a) * rr * 0.8)];
    tube(bark, pts, [0.05, 0.03, 0.01].map((x) => x * (H / 2 + 0.3)), 3, barkLayer, (p) => [p.y / H, 0.5, phase], tint, 1);
  }
  const n = Math.round(sp.cards * q.cards * (0.8 + 0.4 * r()) * (R / sp.R[1]));
  const crown = [];
  const off = V((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
  for (let k = 0; k < n; k++) {
    let v;
    do { v = V(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); } while (v.lengthSq() > 1);
    if (sp.sparse && r() < sp.sparse) continue;
    const p = V(v.x * R, (0.55 + 0.45 * v.y) * H * 0.85, v.z * R).add(off);
    const up = V(v.x, 0.8 + v.y * 0.4, v.z).add(V(r() - 0.5, 0, r() - 0.5)).normalize();
    const right = V().crossVectors(up, V(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
    const size = lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale;
    const s = 0.8 + 0.35 * r() * (0.6 + 0.4 * (p.y / H));
    card(leaves, p.clone().addScaledVector(up, -size * 0.45), up, right, size, leafLayer, [p.y / H * 0.5, 1, phase + r() * 6], [leafTint[0] * s, leafTint[1] * s, leafTint[2] * s]);
    crown.push(p);
  }
  return crown;
}

export const TREE_QUALITY = {
  low: { seg: 0.5, radial: 0.5, cards: 0.45, leafScale: 1.35, twigs: 0.5 },
  medium: { seg: 0.7, radial: 0.7, cards: 0.7, leafScale: 1.15, twigs: 0.75 },
  high: { seg: 1, radial: 1, cards: 1, leafScale: 1, twigs: 1 },
  ultra: { seg: 1.1, radial: 1.1, cards: 1.15, leafScale: 0.95, twigs: 1.1 },
};

/**
 * Generate one unique tree into shared accumulators.
 * @param {string} species key of SPECIES
 * @param {number} seed any integer; same seed → same tree
 * @param {object} q TREE_QUALITY entry
 * @param {GeoAcc} bark @param {GeoAcc} leaves
 * @param {{x:number,y:number,z:number, scale?:number, burnt?:boolean, hue?:number}} at placement
 * @returns {{height:number, crownRadius:number, trunkRadius:number}}
 */
export function generateTree(species, seed, q, bark, leaves, at) {
  const sp = SPECIES[species] || SPECIES.oak;
  const r = rng(seed * 7919 + 13);
  const H = lerp(sp.H[0], sp.H[1], r()) * (at.scale || 1);
  const b0 = bark.count, l0 = leaves.count;
  const phase = r() * 6.28;
  // per-instance colour variation (bark and foliage hue/brightness), autumn-ish outliers for broadleaves
  const tb = 0.85 + 0.3 * r();
  const tint = at.burnt ? [0.35, 0.33, 0.32] : [tb * (0.95 + 0.1 * r()), tb, tb * (0.95 + 0.1 * r())];
  const lb = 0.8 + 0.35 * r(), hue = (r() - 0.5) * 0.25 + (at.hue || 0);
  const leafTint = [lb * (1 + hue), lb * (1 + hue * 0.3), lb * (1 - hue * 0.6)];
  const gen = { broad: genBroad, conifer: genConifer, palm: genPalm, bush: genBush }[sp.kind];
  const sp2 = at.burnt ? { ...sp, bark: 'burnt', leaf: null } : at.leafless ? { ...sp, leaf: null } : sp;
  const crown = gen(sp2, r, H, q, bark, leaves, tint, leafTint, phase);
  // crown-shaped normals for foliage
  let cr = 1, cc = V(0, H * 0.6, 0), rad = V(1, 1, 1);
  if (crown.length) {
    const bb = new THREE.Box3().setFromPoints(crown);
    bb.getCenter(cc); bb.getSize(rad).multiplyScalar(0.5).addScalar(0.3);
    if (sp.kind === 'conifer') cc.y = bb.min.y + (bb.max.y - bb.min.y) * 0.35;
    if (sp.kind === 'palm') cc.y -= 0.6;
    cr = Math.max(rad.x, rad.z);
    bendNormals(leaves, l0, cc, rad, sp.kind === 'palm' ? 0.35 : 0.72);
  }
  // lean + random rotation + placement
  const m = new THREE.Matrix4().compose(V(at.x, at.y, at.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.06)), V(1, 1, 1));
  bark.transform(m, b0); leaves.transform(m, l0);
  const kind = WIND_KIND[sp.kind] ?? 0;
  bark.setRoot(b0, at.x || 0, at.y || 0, at.z || 0, H, kind); leaves.setRoot(l0, at.x || 0, at.y || 0, at.z || 0, H, kind);
  return { height: H, crownRadius: cr, trunkRadius: sp.r0 ? sp.r0[0] : 0.05 };
}
