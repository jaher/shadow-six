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
import { makeBroadleaves } from './broadleaf.js';
import { makeShrubs } from './shrubs.js';
import { makePalms } from './palms.js';
import { makeConifers, NEEDLE_LAYERS, clearBranch } from './conifers.js';
export { clearBranch };
export { NEEDLE_LAYERS };

// Foliage card layers (assets/foliage.json: <name>_0, <name>_1 → layer 2*i + v) and bark layers (assets/bark.json)
export const LEAF_LAYERS = ['oak', 'beech', 'birch', 'poplar', 'plane', 'olive', 'hedge', 'scrub', 'spruce', 'fir', 'pine', 'palm', 'palmdry',
  'willow', 'ash', 'apple', 'hazel', 'acacia', 'brown', 'twig', 'ivy', 'gorse', 'palmleaf'];
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
  // conifers (conifers.js): needle = needles.json layer family; tier = whorl spacing (m)
  spruce: { kind: 'conifer', form: 'spruce', bark: 'spruce', leaf: 'spruce', needle: 'spruce', H: [10, 18], r0: [0.18, 0.3], crownBase: 0.06, tier: 0.47, width: 0.3, whorl: 5, droop: -0.2, sag: 0.16, upturn: 0.5, curtain: 0.9, flare: 0.3 },
  fir: { kind: 'conifer', form: 'spruce', bark: 'spruce', leaf: 'fir', needle: 'spruce', H: [9, 15], r0: [0.16, 0.26], crownBase: 0.1, width: 0.27, whorl: 5, droop: -0.04, sag: 0.08, upturn: 0.15, curtain: 0.2, flare: 0.3, sprayW: 1.1 },
  pine: { kind: 'conifer', form: 'pine', bark: 'pine', leaf: 'pine', needle: 'stone', H: [10, 17], r0: [0.2, 0.32], crownBase: 0.5, width: 0.3, limbs: 4, umbrella: 0.5, pad: 0.85, tier: 0.65, lean: 0.08, flare: 0.3 },
  scots_pine: { kind: 'conifer', form: 'pine', bark: 'pine', leaf: 'pine', needle: 'scots', H: [13, 21], r0: [0.2, 0.32], crownBase: 0.5, width: 0.27, limbs: 5, umbrella: 0.1, pad: 0.85, tier: 0.56, lean: 0.04, flare: 0.25 },
  stone_pine: { kind: 'conifer', form: 'pine', bark: 'pine', leaf: 'pine', needle: 'stone', H: [10, 16], r0: [0.26, 0.38], crownBase: 0.66, width: 0.4, limbs: 4, umbrella: 1, pad: 0.95, tier: 0.5, fork: [2, 4], lean: 0.06, flare: 0.4 },
  date_palm: { kind: 'palm', bark: 'palm', leaf: 'palm', H: [7, 14], r0: [0.2, 0.26] },
  hedge: { kind: 'bush', bark: 'generic', leaf: 'hedge', H: [2.0, 3.2], R: [1.0, 1.5], cards: 90, leafSize: [0.9, 1.3] },
  shrub: { kind: 'bush', bark: 'generic', leaf: 'hedge', H: [1.0, 1.8], R: [0.7, 1.2], cards: 40, leafSize: [0.7, 1.0] },
  desert_shrub: { kind: 'bush', bark: 'dead', leaf: 'scrub', H: [0.5, 1.1], R: [0.5, 1.0], cards: 22, leafSize: [0.5, 0.8], sparse: 0.35 },
};
// pass 2 (broadleaf.js): crown envelope (crown profile, crownBase/wr ranges as fractions of H), weeping, shade gaps,
// winter twig spray (0 purple-brown birch-like, 1 grey), marcescent leaf variant (brown_0 oak, brown_1 beech), tints
Object.assign(SPECIES.oak, { crownBase: [0.28, 0.4], wr: [0.42, 0.56], trunk: 0.62, twig: 1, marcV: 0, gap: 0.12, lean: 0.08, roots: true });
Object.assign(SPECIES.beech, { crown: 'ovoid', crownBase: [0.2, 0.32], wr: [0.32, 0.42], trunk: 0.8, twig: 1, marcV: 1, sprayW: 1.15, roots: true });
Object.assign(SPECIES.plane, { crownBase: [0.32, 0.45], wr: [0.38, 0.5], twig: 1, roots: true });
Object.assign(SPECIES.poplar, { crownBase: [0.05, 0.12], wr: [0.1, 0.14], twig: 0 });
Object.assign(SPECIES.birch, { crownBase: [0.3, 0.45], wr: [0.2, 0.28], weep: 0.35, twig: 0, twigSpray: 0, sprayW: 0.85 });
Object.assign(SPECIES.olive, { crown: 'round', crownBase: [0.35, 0.5], wr: [0.45, 0.6], twig: 1 });
Object.assign(SPECIES.dead_tree, { crownBase: [0.35, 0.5], wr: [0.3, 0.42] });
const BROAD_LEVELS = (a1, t1, g1, n2 = 5, n3 = 4) => [
  { seg: 10, radial: 10, children: 6, start: 0.3, angle: a1, lenRatio: 0.62, radRatio: 0.55, gnarl: 0.1, tropism: 0.04 },
  { seg: 7, radial: 7, children: n2, start: 0.2, angle: 45, lenRatio: 0.55, radRatio: 0.5, gnarl: g1, tropism: t1 },
  { seg: 4, radial: 4, children: n3, start: 0.25, angle: 45, lenRatio: 0.5, radRatio: 0.55, gnarl: 0.25, tropism: 0.02 },
  { seg: 2, radial: 3, children: 0 }];
Object.assign(SPECIES, {
  willow: { kind: 'broad', bark: 'oak', leaf: 'willow', H: [8, 14], r0: [0.3, 0.45], crown: 'round', crownBase: [0.2, 0.3], wr: [0.45, 0.58], flare: 0.6,
    weep: 0.6, pollard: 0.5, twig: 0, levels: BROAD_LEVELS(45, 0.02, 0.2, 6, 5), leafLevel: 2, leaves: 5, leafSize: [1.2, 1.7], leafStart: 0.2, sprayW: 0.8, lt: [1.02, 1, 0.96] },
  ash: { kind: 'broad', bark: 'beech', leaf: 'ash', H: [12, 20], r0: [0.24, 0.36], crown: 'oval', crownBase: [0.3, 0.42], wr: [0.27, 0.36], flare: 0.4,
    gap: 0.22, twig: 1, levels: BROAD_LEVELS(35, 0.06, 0.12, 5, 3), leafLevel: 2, leaves: 3, leafSize: [1.3, 1.8], leafStart: 0.4 },
  alder: { kind: 'broad', bark: 'oak', leaf: 'hazel', H: [10, 16], r0: [0.18, 0.28], crown: 'oval', crownBase: [0.15, 0.25], wr: [0.24, 0.32], flare: 0.3,
    twig: 0, levels: BROAD_LEVELS(60, 0.0, 0.12, 4, 3), leafLevel: 2, leaves: 5, leafSize: [0.9, 1.3], leafStart: 0.3, lt: [0.8, 0.86, 0.82], bt: [0.75, 0.75, 0.78] },
  apple: { kind: 'broad', bark: 'olive', leaf: 'apple', H: [4, 6.5], r0: [0.14, 0.22], crown: 'round', crownBase: [0.28, 0.38], wr: [0.5, 0.66], trunk: 0.45, flare: 0.4,
    twig: 1, levels: BROAD_LEVELS(55, 0.04, 0.3, 4, 4), leafLevel: 2, leaves: 6, leafSize: [0.8, 1.1], leafStart: 0.25 },
  hawthorn: { kind: 'broad', bark: 'generic', leaf: 'hedge', H: [4, 7], r0: [0.1, 0.16], stems: [1, 3], crown: 'round', crownBase: [0.15, 0.3], wr: [0.38, 0.5], trunk: 0.5,
    flare: 0.3, twig: 1, levels: BROAD_LEVELS(50, 0.02, 0.35, 5, 4), leafLevel: 2, leaves: 6, leafSize: [0.8, 1.1], leafStart: 0.2 },
  horse_chestnut: { kind: 'broad', bark: 'oak', leaf: 'plane', H: [14, 20], r0: [0.3, 0.45], crown: 'ovoid', crownBase: [0.2, 0.3], wr: [0.38, 0.46], flare: 0.5,
    gap: 0.04, fill: 0.5, twig: 1, roots: true, levels: BROAD_LEVELS(45, 0.04, 0.12, 5, 4), leafLevel: 2, leaves: 6, leafSize: [1.2, 1.7], leafStart: 0.3, lt: [0.86, 0.92, 0.86] },
  acacia: { kind: 'broad', bark: 'olive', leaf: 'acacia', H: [4.5, 7.5], r0: [0.14, 0.24], stems: [1, 2], crown: 'umbrella', crownBase: [0.42, 0.55], wr: [0.5, 0.65],
    trunk: 0.5, flare: 0.3, gap: 0.2, fill: 0.2, twig: 1, levels: BROAD_LEVELS(42, 0.0, 0.3, 5, 4), leafLevel: 2, leaves: 3, leafSize: [1.0, 1.4], leafStart: 0.4, lean: 0.25, lt: [1.1, 1.08, 0.98] },
});
// shrubs.js: envelope shape (dome | hedge | box | wedge), stems, side shoots per stem, shell sprays (cards)
Object.assign(SPECIES.hedge, { shape: 'hedge', stems: [6, 10], shoots: 5, cards: 110, leafSize: [0.8, 1.15], twig: 1, deciduous: true });
Object.assign(SPECIES.shrub, { shape: 'dome', stems: [4, 7], shoots: 4, cards: 55, leafSize: [0.7, 1.0], twig: 1, deciduous: true });
Object.assign(SPECIES.desert_shrub, { shape: 'dome', stems: [5, 9], shoots: 3, cards: 34, leafSize: [0.5, 0.8], R: [0.6, 1.1], H: [0.6, 1.3], evergreen: true });
Object.assign(SPECIES, {
  hazel: { kind: 'bush', shape: 'vase', bark: 'generic', leaf: 'hazel', H: [2.2, 3.8], R: [1.2, 1.8], stems: [6, 12], shoots: 3, cards: 60, leafSize: [0.9, 1.3], stemR: 0.03, arch: 1, twig: 0, deciduous: true },
  box: { kind: 'bush', shape: 'box', bark: 'generic', leaf: 'hedge', leafV: 1, H: [0.5, 0.8], R: [0.6, 0.9], stems: [3, 4], shoots: 2, cards: 90, leafSize: [0.3, 0.42], lt: [0.72, 0.82, 0.72], evergreen: true },
  gorse: { kind: 'bush', shape: 'dome', bark: 'generic', leaf: 'gorse', H: [1.0, 1.8], R: [0.8, 1.3], stems: [6, 10], shoots: 4, cards: 70, leafSize: [0.7, 1.0], evergreen: true },
  sea_buckthorn: { kind: 'bush', shape: 'wedge', bark: 'generic', leaf: 'olive', H: [1.2, 2.2], R: [1.0, 1.6], stems: [5, 9], shoots: 4, cards: 70, leafSize: [0.7, 1.0], lt: [1.05, 1.06, 1.12], sculpt: true, evergreen: true },
});
// palms.js: dates (orange bunches, Aug–Dec), suckers (share with offshoots), pruned (town: no skirt, no suckers)
Object.assign(SPECIES.date_palm, { dates: true, suckers: 0.6, r0: [0.24, 0.31] });
SPECIES.date_palm_town = { ...SPECIES.date_palm, dates: false, pruned: true, H: [6, 11] };
SPECIES.canary_palm = { kind: 'palm', form: 'canary', bark: 'palm', leaf: 'palm', H: [7, 12], r0: [0.34, 0.44], pruned: true, lt: [0.95, 1.08, 0.9] };
SPECIES.acacia_shrub = { ...SPECIES.acacia, H: [1.8, 2.6], stems: [2, 3], crownBase: [0.2, 0.32], wr: [0.42, 0.52], trunk: 0.35, levels: [
    { seg: 6, radial: 6, children: 5, start: 0.3, angle: 45, lenRatio: 0.7, radRatio: 0.55, gnarl: 0.2, tropism: 0.02 },
    { seg: 4, radial: 4, children: 4, start: 0.25, angle: 50, lenRatio: 0.55, radRatio: 0.5, gnarl: 0.3, tropism: 0.0 },
    { seg: 2, radial: 3, children: 0 }], leafLevel: 1, leaves: 2, leafSize: [0.6, 0.9], gap: 0.3, fill: 0.05, lean: 0.1, lt: [1.15, 1.1, 0.95] };
SPECIES.cypress = { ...SPECIES.poplar, leaf: 'fir', bark: 'pine', H: [8, 14], r0: [0.18, 0.26], leafSize: [0.8, 1.1], evergreen: true };
SPECIES.olive.evergreen = true;
// forest floor (forest-fill.js understorey): brambles (semi-evergreen, dark in winter), fallen boughs
SPECIES.bramble = { kind: 'bush', shape: 'dome', bark: 'generic', leaf: 'hedge', leafV: 0, H: [0.55, 1.0], R: [0.9, 1.6], stems: [5, 9], shoots: 3, cards: 38, leafSize: [0.5, 0.75], arch: 1, lt: [0.66, 0.7, 0.62], evergreen: true };
SPECIES.fallen = { kind: 'broad', bark: 'dead', leaf: null, H: [2.5, 6], r0: [0.06, 0.14], fallen: true, levels: [{ seg: 2, radial: 3, children: 0 }] };
SPECIES.spruce_snow = SPECIES.spruce;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

/** Growable vertex buffer: position, normal, uv, aInfo (layer, sway, flex, phase), aTint (rgb). */
/** Wind response class per species kind (vegetation.js vegWind): stiffness, natural frequency, frond whip. */
export const WIND_KIND = { broad: 0, conifer: 1, palm: 2, bush: 3 };

export class GeoAcc {
  constructor() { this.p = []; this.n = []; this.uv = []; this.info = []; this.tint = []; this.root = []; this.ext = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  /** ext = [crown AO 0..1, signed snow catch -1..1 (sky exposure × geometric normal y)]; needle cards only. */
  vert(p, n, u, v, info, tint, ext) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.info.push(info[0], info[1], info[2], info[3]); this.tint.push(tint[0], tint[1], tint[2]);
    this.root.push(0, 0, 0, 1);
    this.ext.push(ext ? ext[0] : 1, ext ? ext[1] : 0);
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
      tint: new Float32Array(this.tint), root: new Float32Array(this.root), ext: new Float32Array(this.ext), idx: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx) };
  }
  static arraysToGeometry(a) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.n, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aInfo', new THREE.BufferAttribute(a.info, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(a.tint, 3));
    if (a.root) g.setAttribute('aRoot', new THREE.BufferAttribute(a.root, 4));
    if (a.ext) g.setAttribute('aExt', new THREE.BufferAttribute(a.ext, 2));
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
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(this.ext, 2));
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

let _bl = null, _sh = null, _pm = null;
/** Palm generator (palms.js). */
const pm = () => (_pm ??= makePalms({ THREE, V, tube, LEAF_LAYERS, BARK_LAYERS }));
/** Shrub / hedge generator (shrubs.js) sharing the broadleaf spray, frame and crown AO helpers. */
const sh = () => (_sh ??= makeShrubs({ THREE, V, UP, tube, LEAF_LAYERS, BARK_LAYERS, ...bl() }));
/** Broadleaf generator (broadleaf.js), built once THREE is injected. */
const bl = () => (_bl ??= makeBroadleaves({ THREE, V, UP, tube, LEAF_LAYERS, BARK_LAYERS }));
/** Broadleaf / bare / dead tree (broadleaf.js: species crown envelope, twig-tip sprays, crown AO). */
function genBroad(...a) { return bl().genBroadleaf(...a); }

let _cf = null;
/** Conifer generators (conifers.js), built once THREE is injected. */
const cf = () => (_cf ??= makeConifers({ THREE, V, UP, tube, BARK_LAYERS }));
function genConifer(sp, ...a) { return sp.form === 'pine' ? cf().genPine(sp, ...a) : cf().genSpruce(sp, ...a); }

/** Date / Canary palm (palms.js: ringed trunk with boots, pinnate fronds of separate leaflets, skirt, suckers, dates). */
function genPalm(...a) { return pm().genPalm(...a); }

/** Shrub / hedge / box (shrubs.js: multi-stem frame in a seeded envelope, species sprays, crown AO). */
function genBush(...a) { return sh().genShrub(...a); }

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
 * @param {GeoAcc} [needles] conifer needle sprays (needles.webp atlas, own material); defaults to `leaves`
 * @param {{x:number,y:number,z:number, scale?:number, burnt?:boolean, hue?:number}} at placement
 * @returns {{height:number, crownRadius:number, trunkRadius:number}}
 */
export function generateTree(species, seed, q, bark, leaves, at, needles = leaves) {
  const sp = SPECIES[species] || SPECIES.oak;
  const r = rng(seed * 7919 + 13);
  const H = lerp(sp.H[0], sp.H[1], r()) * (at.scale || 1);
  const b0 = bark.count, l0 = leaves.count, n0 = needles.count;
  const phase = r() * 6.28;
  // per-instance colour variation (bark and foliage hue/brightness), autumn-ish outliers for broadleaves
  const tb = 0.85 + 0.3 * r();
  const tint = at.burnt ? [0.35, 0.33, 0.32] : [tb * (0.95 + 0.1 * r()), tb, tb * (0.95 + 0.1 * r())];
  const lb = 0.8 + 0.35 * r(), hue = (r() - 0.5) * 0.25 + (at.hue || 0);
  const leafTint = [lb * (1 + hue), lb * (1 + hue * 0.3), lb * (1 - hue * 0.6)];
  if (sp.lt) for (let k = 0; k < 3; k++) leafTint[k] *= sp.lt[k];
  if (sp.bt && !at.burnt) for (let k = 0; k < 3; k++) tint[k] *= sp.bt[k];
  const gen = { broad: genBroad, conifer: genConifer, palm: genPalm, bush: genBush }[sp.kind];
  // leafless (winter): twig sprays + marcescent leaves (at.marc share); ivy on the trunk (at.ivy)
  let sp2 = at.burnt ? { ...sp, bark: 'burnt', leaf: null } : at.leafless ? { ...sp, leaf: null, marc: at.marc || 0, marcTrees: at.marcTrees ?? 0.3 } : sp;
  if (at.ivy && !at.burnt) sp2 = { ...sp2, ivy: true };
  if (sp2.dates && !at.dates) sp2 = { ...sp2, dates: false }; // date bunches only when ripe (veg-profile treeSeason)
  if (at.fruit) sp2 = { ...sp2, fruit: true };                  // apples from late summer
  // placement pruning hints (world/placement.js pruneTree): lowest branches lifted / crown narrowed near obstacles
  if (at.crownBase != null && sp2.crownBase != null) sp2 = { ...sp2, crownBase: Math.min(0.8, Math.max(sp2.crownBase, at.crownBase / H)) };
  if (at.crownR != null && sp2.width != null) sp2 = { ...sp2, maxWidth: at.crownR };
  if (at.clear) sp2 = { ...sp2, clear: at.clear };                // walk-under clearance (conifers.js clearBranch)
  const conifer = sp.kind === 'conifer';
  const fol = conifer ? needles : leaves, f0 = conifer ? n0 : l0;
  const crown = gen(sp2, r, H, q, bark, fol, tint, leafTint, phase);
  // crown-shaped normals for foliage
  let cr = 1, cc = V(0, H * 0.6, 0), rad = V(1, 1, 1);
  if (crown.length) {
    const bb = new THREE.Box3().setFromPoints(crown);
    bb.getCenter(cc); bb.getSize(rad).multiplyScalar(0.5).addScalar(0.3);
    if (sp.kind === 'conifer') cc.y = bb.min.y + (bb.max.y - bb.min.y) * 0.35;
    if (sp.kind === 'palm') cc.y -= 0.6;
    cr = Math.max(rad.x, rad.z);
    // palms: leaflet normals face the sky (palms.js); conifers: card + map normals keep the tiers
    bendNormals(fol, f0, cc, rad, sp.kind === 'palm' ? 0.12 : conifer ? 0.5 : 0.72);
  }
  // lean + random rotation + placement
  const ex = (r() - 0.5) * 0.06, yaw = r() * 6.28, ez = (r() - 0.5) * 0.06;
  const m = new THREE.Matrix4().compose(V(at.x, at.y, at.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, sp.sculpt ? Math.atan2(-(at.windZ ?? 0.25), at.windX ?? 1) : yaw, ez)), V(1, 1, 1));
  bark.transform(m, b0); leaves.transform(m, l0);
  if (needles !== leaves) needles.transform(m, n0);
  const kind = WIND_KIND[sp.kind] ?? 0;
  bark.setRoot(b0, at.x || 0, at.y || 0, at.z || 0, H, kind); leaves.setRoot(l0, at.x || 0, at.y || 0, at.z || 0, H, kind);
  if (needles !== leaves) needles.setRoot(n0, at.x || 0, at.y || 0, at.z || 0, H, kind);
  return { height: H, crownRadius: cr, trunkRadius: sp.r0 ? sp.r0[0] : 0.05 };
}
