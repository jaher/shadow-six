/**
 * 3D instanced grass tufts (density from the splat 'grass' weights), wind, trampling from the trail RT,
 * shadows (custom depth material), zoom-aware blade widening + density LOD, frustum-culled 16 m chunks.
 * Also spawns ground clutter (clutter.js).
 *
 * Merged draws (render efficiency): where the tufts are sparse a 16 m chunk holds a handful of tufts, and every chunk ×
 * archetype was its own draw in every pass (M3's winter straw: 113 draws of ~8 tufts, ~70 a frame in the main pass and
 * as many in the shadow map). Chunks of one archetype are merged over a quadtree of the chunk grid: a node is ONE mesh
 * while its tufts cost at most MERGE_VERTS vertex invocations (a chunk alone always is, so dense swards keep their 16 m
 * chunks and their culling). The pixels do not change: a merged mesh holds its chunks' tufts ordered by their in-chunk
 * LOD position i/n (ties: chunk, then i) and draws the prefix with i/n < f, f the largest of its chunks' density
 * fractions, so it draws every tuft any chunk drew; a tuft only it draws has rank (i + 0.5)/n > its own chunk's f, which
 * the shader's LOD fade scales to zero (degenerate triangles, no fragments). PERF.grassMerge off (engine/perf-flags.js)
 * draws the per-chunk meshes again (rebuilt from the merged ones, the same arrays and bounds), for same-page A/B.
 * @module terrain-b/grass
 */
import * as THREE from 'three';
import { WIND_UNIFORMS } from '../../world/wind.js';
import { GRASS_PARS, GRASS_NORMAL, GRASS_BEGIN, GRASS_BEGIN_DEPTH, GRASS_COLOR } from './grass-glsl.js';
import { rng, fbm } from './noise.js';
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
import { splatAt } from './terrain-layers.js';
import { createClutterG } from './clutter.js';
import { due, runSync } from '../../engine/slice.js';
import { createScrub } from './scrub.js';
import { archetypeGeometry } from './grass-arch.js';
import { placeGroundG, STRIDE } from './grass-place.js';
import { GRASS_TYPES, GT, vegetationProfile, pickWeighted } from './veg-profile.js';
import { PERF } from '../../engine/perf-flags.js';

/**
 * Per-archetype colours (linear, pre-light) for the season: lush root/tip, dry root/tip, seed head / plume, and the
 * wind bend amplitude (m at the tip; stiffness class, docs/vegetation.md §3.0). Index = GT[name].
 */
const LUSH = {
  meadow: [[0.04, 0.062, 0.02], [0.19, 0.215, 0.07]], straw: [[0.075, 0.06, 0.03], [0.19, 0.15, 0.075]],
  forb: [[0.035, 0.068, 0.022], [0.1, 0.16, 0.045]], snowpoke: [[0.1, 0.085, 0.05], [0.22, 0.18, 0.1]],
  seedhead: [[0.045, 0.064, 0.022], [0.2, 0.21, 0.08]], tussock: [[0.04, 0.058, 0.024], [0.16, 0.18, 0.065]],
  flopped: [[0.07, 0.055, 0.03], [0.16, 0.12, 0.065]], marram: [[0.06, 0.075, 0.06], [0.2, 0.25, 0.21]], // glaucous blue-green (dry: straw)
  reed: [[0.05, 0.075, 0.028], [0.17, 0.2, 0.07]], drinn: [[0.11, 0.1, 0.06], [0.27, 0.22, 0.13]],
  wheat: [[0.06, 0.08, 0.025], [0.3, 0.24, 0.09]], stubble: [[0.12, 0.1, 0.05], [0.3, 0.25, 0.13]],
};
const DRY = { root: [0.075, 0.06, 0.03], tip: [0.2, 0.155, 0.075] };
const HEAD = { seedhead: [0.14, 0.105, 0.06], reed: [0.105, 0.078, 0.068], marram: [0.26, 0.23, 0.15], drinn: [0.42, 0.38, 0.3], wheat: [0.42, 0.32, 0.12] };
const AMP = { meadow: 0.28, straw: 0.28, forb: 0.05, snowpoke: 0.1, seedhead: 0.38, tussock: 0.24, flopped: 0.14, marram: 0.42, reed: 0.75, drinn: 0.3, wheat: 0.3, stubble: 0.02 };

/** Fill the colour / amplitude uniform arrays for a vegetation profile. */
export function grassPalette(prof) {
  const v = (a) => new THREE.Vector3(...a);
  const out = { uGRoot: [], uGTip: [], uDRoot: [], uDTip: [], uGHead: [], uGAmp: [] };
  for (const name of GRASS_TYPES) {
    const [r, t] = LUSH[name];
    const dryK = name === 'forb' ? 0.55 : 1;
    // winter / thaw straw is paler buff than late-summer hay (bleached by frost and rain)
    const dTip = prof.dry > 0.75 ? [0.26, 0.21, 0.12] : DRY.tip;
    const dR = r.map((c, i) => c + (DRY.root[i] - c) * dryK), dT = t.map((c, i) => c + (dTip[i] - c) * dryK);
    // winter reeds: buff stems, grey plumes (docs §3.7)
    const head = name === 'reed' && prof.dry > 0.6 ? [0.3, 0.28, 0.25] : name === 'seedhead' && prof.season === 'spring' ? [0.12, 0.11, 0.07] : (HEAD[name] || t);
    out.uGRoot.push(v(r)); out.uGTip.push(v(t)); out.uDRoot.push(v(dR)); out.uDTip.push(v(dT)); out.uGHead.push(v(head));
    out.uGAmp.push(AMP[name]);
  }
  return out;
}

export function grassMaterials(U) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = GRASS_PARS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
      .replace('#include <begin_vertex>', GRASS_BEGIN);
    sh.fragmentShader = 'varying vec3 vGCol;\nvarying float vGT;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', GRASS_COLOR)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // cheap translucency: light through thin blades from behind
        float tl = max(dot(normalize(uSunV), -normalize(vViewPosition)), 0.0);
        // blades are waxy but thin: a weak sheen tinted by the blade colour, not a white specular glint
        vec3 tint = 0.45 + 0.55 * vGCol / max(max(vGCol.r, vGCol.g), 1e-3);
        reflectedLight.directSpecular *= 0.3 * tint; reflectedLight.indirectSpecular *= 0.5 * tint;
        reflectedLight.directDiffuse += vGCol * vec3(1.0, 1.1, 0.6) * uSunI * 0.05 * vGT * (0.3 + 0.7 * tl);`);
    sh.fragmentShader = 'uniform vec3 uSunV;\nuniform float uSunI;\n' + sh.fragmentShader;
  };
  mat.customProgramCacheKey = () => 'grassB';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = GRASS_PARS + sh.vertexShader.replace('#include <begin_vertex>', GRASS_BEGIN_DEPTH);
  };
  depth.customProgramCacheKey = () => 'grassBdepth';
  return { mat, depth };
}

const CHUNK = 16; // 16 m chunks × archetypes present (≈ the old 8 m × 2 draw count); LOD fades per instance
/** Vertex invocations (tufts × tuft indices) a merged draw may cost: bounds what it shades off-screen. */
const MERGE_VERTS = 65536;

/**
 * The merged draws of one archetype (and apron flag): a quadtree over the chunk grid; a node becomes one draw when its
 * tufts cost at most MERGE_VERTS vertices or it is a single chunk. Returns lists of chunk records.
 */
function mergeGroups(recs, idxCount) {
  const out = [];
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const r of recs) {
    r.ci = Math.floor(r.cx / CHUNK); r.cj = Math.floor(r.cz / CHUNK);
    i0 = Math.min(i0, r.ci); j0 = Math.min(j0, r.cj); i1 = Math.max(i1, r.ci); j1 = Math.max(j1, r.cj);
  }
  let size = 1;
  while (size < Math.max(i1 - i0 + 1, j1 - j0 + 1)) size *= 2;
  const node = (list, x0, z0, s) => {
    let load = 0;
    for (const r of list) load += r.n;
    if (s === 1 || list.length === 1 || load * idxCount <= MERGE_VERTS) { out.push(list); return; }
    const h = s / 2, q = [[], [], [], []];
    for (const r of list) q[(r.ci >= x0 + h ? 1 : 0) + (r.cj >= z0 + h ? 2 : 0)].push(r);
    for (let k = 0; k < 4; k++) if (q[k].length) node(q[k], x0 + (k & 1) * h, z0 + (k >> 1) * h, h);
  };
  if (recs.length) node(recs, i0, j0, size);
  return out;
}

/** Number of sorted keys below v. */
function below(keys, v) {
  let lo = 0, hi = keys.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
const BLANK_MASK = (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })();

/**
 * @param {object} ctx terrain context (grid, splat, P palette, heightAt, trails, windDir, tNoise, W, D, opts)
 * @param {object} Q quality preset (grassDensity, grassBlades, clutter, shadowsGrass)
 */
export function createGrass(ctx, Q) { return runSync(createGrassG(ctx, Q)); }

/** createGrass() as a sliced job (engine/slice.js): the same tufts, chunk by chunk. */
export function* createGrassG(ctx, Q) {
  const { scene, splat, P, heightAt, trails, W, D } = ctx;
  const group = new THREE.Group();
  group.name = 'grassB';
  scene.add(group);
  const U = {
    ...WIND_UNIFORMS, // step 4w shared wind (world/wind.js); uWind/uWindStr kept: legacy dir + a 0..1 multiplier
    uTime: { value: 0 }, uWind: { value: ctx.windDir.clone() }, uWindStr: { value: ctx.opts.windStrength ?? 1 },
    tTrail: { value: trails.texture }, tFlatG: { value: trails.flatTexture }, tNoiseG: { value: ctx.tNoise },
    uMapG: { value: new THREE.Vector4(W, D, 1 / W, 1 / D) }, uMinW: { value: 0.02 }, uLodW: { value: 1 },
    uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 },
    tBloodG: { value: BLANK_MASK }, // set by render/blood (grass blades soaked red-brown where blood lies)
    uLodV: { value: new THREE.Vector4(W / 2, D / 2, 1e4, 1) }, uFrost: { value: 0 },
  };
  // docs/vegetation.md §3.0: season / mix from the mission date and place (veg-profile.js)
  const prof = ctx.veg || vegetationProfile(ctx.opts.mission || null, ctx.theater, ctx.src);
  ctx.veg = prof;
  const pal = grassPalette(prof);
  for (const k in pal) U[k] = { value: pal[k] };
  U.uFrost.value = prof.frost;
  const { mat, depth } = grassMaterials(U);
  let geos = [], meshes = [], clutter = null, scrub = null;
  let merged = true, chunkMeshes = null; // PERF.grassMerge off: the per-chunk meshes drawn instead (A/B)
  const w8 = new Float32Array(8);
  const excl = ctx.opts.exclude || null; // step 3p: no tufts through hard pavement
  /** Apron grass (addApron): {splat, ox, oz, heightAt, band} — tufts continue past the map edge and thin out. */
  let apron = null;
  const grassW = (x, z) => {
    if (excl && excl(x, z)) return { g: 0, dry: 0, snowPoke: 0, excluded: true };
    if (apron && (x < 0 || z < 0 || x > W || z > D)) splatAt(apron.splat, x - apron.ox, z - apron.oz, w8);
    else splatAt(splat, x, z, w8);
    let g = 0, dry = 0, snowPoke = 0;
    for (let k = 0; k < 8; k++) {
      g += w8[k] * P.grass[k];
      const n = P.layers[k];
      if (n === 'grassdry') dry += w8[k];
      if (n === 'snowold') snowPoke += w8[k];
    }
    return { g, dry: dry / Math.max(1e-3, g), snowPoke };
  };

  // environment for the pure placement (grass-place.js): water band, coast / desert sand, tall-plant clearance
  const sandIdx = ['sand', 'sand2', 'wetsand'].map((n) => P.layers.indexOf(n)).filter((i) => i >= 0);
  const grid = ctx.grid;
  const tallOK = grid ? (x, z) => { // reeds / marram / drinn never grow through decks, walls, structures
    const i0 = Math.floor(x / grid.cell), j0 = Math.floor(z / grid.cell);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
      const k = j * grid.cols + i;
      if (grid.block[k] || grid.bridge[k] || grid.owner[k] || grid.elev[k] > 0 || grid.underpass?.[k]) return false;
    }
    return true;
  } : undefined;
  const env = {
    W, D, heightAt, grassW, tallOK, waterSD: ctx.waterSD, deepSD: ctx.deepSD, fields: ctx.opts.fields, // bocage.js crop fields
    sandW: (x, z) => { if (excl && excl(x, z)) return 0; splatAt(splat, x, z, w8); let s = 0; for (const i of sandIdx) s += w8[i]; return s; },
  };

  /** Drop the chunks of the map (`apronOnly` false) or only the apron ring's. */
  function clear(apronOnly) {
    useMerged(true);
    for (const m of chunkMeshes || []) if (m.userData.split) m.geometry.dispose();
    chunkMeshes = null;
    const keep = [];
    for (const m of meshes) {
      if (apronOnly && !m.userData.apron) { keep.push(m); continue; }
      group.remove(m); m.geometry.dispose();
    }
    meshes = keep; geos = keep.map((m) => m.geometry);
  }

  /** The apron ring (addApron): whole chunks past each map edge out to the grass band, tufts thinning out. */
  function apronChunks() {
    if (!apron) return [];
    const B = Math.ceil(apron.band * 1.3 / CHUNK) * CHUNK, o = [];
    const segs = (L) => {
      const s = [];
      for (let v = -B; v < 0; v += CHUNK) s.push([v, v + CHUNK, false]);
      for (let v = 0; v < L; v += CHUNK) s.push([v, Math.min(L, v + CHUNK), true]);
      for (let v = L; v < L + B; v += CHUNK) s.push([v, v + CHUNK, false]);
      return s;
    };
    for (const [cz, z1, zin] of segs(D)) for (const [cx, x1, xin] of segs(W)) if (!(xin && zin)) o.push([cx, cz, x1, z1]);
    return o;
  }
  const apronKeep = (px, pz) => {
    const qx = Math.min(W, Math.max(0, px)), qz = Math.min(D, Math.max(0, pz)), d = Math.hypot(px - qx, pz - qz);
    if (d <= 0 || d > apron.band * 1.3) return 0;
    return 1 - smoothstep(apron.band * 0.3, apron.band, d + (fbm(px / 9, pz / 9, 3, 77) - 0.5) * apron.band * 0.6);
  };

  /** A grass mesh as the chunks always were: tufts, bounds, LOD bookkeeping, materials and shadow flags. */
  function grassMesh(g, name, n, c, apronFlag, box, cast) {
    g.instanceCount = n;
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, mat);
    m.name = 'grass:' + name;
    m.userData.n = n; m.userData.c = c; m.userData.archetype = name; m.userData.apron = apronFlag;
    m.customDepthMaterial = depth;
    m.castShadow = cast;
    m.userData.aoExclude = true; // grass self-occlusion is in the blade colour; keeps it out of the GTAO prepass
    m.receiveShadow = true;
    return m;
  }
  const setInst = (g, a, b, e) => {
    g.setAttribute('iOff', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('iScl', new THREE.InstancedBufferAttribute(b, 4));
    g.setAttribute('iExt', new THREE.InstancedBufferAttribute(e, 2));
  };
  /**
   * One mesh for a list of chunk records of one archetype: a single chunk as before; several → their tufts ordered by
   * the in-chunk LOD position i/n (ties: chunk order, then i), `keys` (sorted i/n) and `from` (chunk of each tuft) kept
   * for the per-frame prefix and the per-chunk split (PERF.grassMerge off).
   */
  function mergedMesh(pg, list, q) {
    const r0 = list[0], cast = !!q.shadowsGrass || r0.name === 'reed';
    if (list.length === 1) {
      const g = pg.clone();
      setInst(g, r0.a, r0.b, r0.e);
      return grassMesh(g, r0.name, r0.n, [r0.cx + CHUNK / 2, r0.cz + CHUNK / 2], r0.apron, r0.box, cast);
    }
    let N = 0;
    for (const r of list) N += r.n;
    const K = new Float64Array(N), M = new Uint16Array(N), I = new Uint32Array(N), order = new Uint32Array(N);
    let j = 0;
    for (let k = 0; k < list.length; k++) for (let i = 0; i < list[k].n; i++, j++) { K[j] = i / list[k].n; M[j] = k; I[j] = i; order[j] = j; }
    order.sort((x, y) => K[x] - K[y] || x - y); // (fill order is chunk-major, then i)
    const a = new Float32Array(N * 4), b = new Float32Array(N * 4), e = new Float32Array(N * 2);
    const keys = new Float64Array(N), from = new Uint16Array(N);
    for (let s = 0; s < N; s++) {
      const o = order[s], r = list[M[o]], i = I[o];
      for (let c = 0; c < 4; c++) { a[s * 4 + c] = r.a[i * 4 + c]; b[s * 4 + c] = r.b[i * 4 + c]; }
      e[s * 2] = r.e[i * 2]; e[s * 2 + 1] = r.e[i * 2 + 1];
      keys[s] = K[o]; from[s] = M[o];
    }
    const g = pg.clone();
    setInst(g, a, b, e);
    const box = r0.box.clone();
    for (const r of list) box.union(r.box);
    const m = grassMesh(g, r0.name, N, [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2], r0.apron, box, cast);
    m.userData.members = list.map((r) => ({ x: r.cx + CHUNK / 2, z: r.cz + CHUNK / 2, cx: r.cx, cz: r.cz, n: r.n, box: r.box }));
    m.userData.keys = keys; m.userData.from = from;
    return m;
  }
  /** The per-chunk meshes of a merged one (PERF.grassMerge off): each chunk's tufts in their own order, its bounds. */
  function splitMesh(m) {
    const u = m.userData;
    if (!u.members) return [m];
    const A = m.geometry.attributes, out = [];
    for (let k = 0; k < u.members.length; k++) {
      const mb = u.members[k], n = mb.n;
      const a = new Float32Array(n * 4), b = new Float32Array(n * 4), e = new Float32Array(n * 2);
      let i = 0;
      for (let s = 0; s < u.from.length; s++) {
        if (u.from[s] !== k) continue;
        for (let c = 0; c < 4; c++) { a[i * 4 + c] = A.iOff.array[s * 4 + c]; b[i * 4 + c] = A.iScl.array[s * 4 + c]; }
        e[i * 2] = A.iExt.array[s * 2]; e[i * 2 + 1] = A.iExt.array[s * 2 + 1];
        i++;
      }
      const g = new THREE.InstancedBufferGeometry(); // (own copies of the tuft shape: disposing one frees only its buffers)
      g.setIndex(m.geometry.index.clone());
      for (const nm of ['position', 'normal', 'aBlade', 'aPart']) g.setAttribute(nm, m.geometry.attributes[nm].clone());
      setInst(g, a, b, e);
      const c = grassMesh(g, u.archetype, n, [mb.x, mb.z], u.apron, mb.box.clone(), m.castShadow);
      c.userData.split = true;
      out.push(c);
    }
    return out;
  }
  /** Draw the merged meshes (on) or the per-chunk ones (off; built on first use and kept until the next build). */
  function useMerged(on) {
    if (on === merged) return;
    if (!on && !chunkMeshes) chunkMeshes = meshes.flatMap(splitMesh);
    for (const m of on ? chunkMeshes : meshes) group.remove(m);
    for (const m of on ? meshes : chunkMeshes) group.add(m);
    merged = on;
  }

  function build(q, apronOnly = false) { return runSync(buildG(q, apronOnly)); }
  function* buildG(q, apronOnly = false) {
    clear(apronOnly);
    const protos = {};
    const proto = (name) => (protos[name] ||= archetypeGeometry(name, q.grassBlades, 11));
    const perM2 = 9 * q.grassDensity * (ctx.opts.grassDensity ?? 1);
    const po = { perM2, chunk: CHUNK, seed: 1234, reedDensity: q.grassDensity, wind: { x: ctx.windDir.x, z: ctx.windDir.y } };
    const chunks = q.grassDensity > 0 && !apronOnly ? yield* placeGroundG(env, prof, po) : [];
    // apron (own stream, so the map's tufts are the same with or without it): the same sward, thinning past the edge
    const aEnv = apron && q.grassDensity > 0 ? { ...env, fields: null, heightAt: apron.heightAt, tallOK: () => false,
      grassW: (x, z) => { const k = apronKeep(x, z); if (k <= 0.02) return { g: 0, dry: 0, excluded: true }; const g = grassW(x, z); return { ...g, g: g.g * k }; } } : null;
    for (const c of aEnv ? yield* placeGroundG(aEnv, prof, { ...po, seed: 4321, macro: false, chunks: apronChunks() }) : []) chunks.push({ ...c, apron: true });
    // one record per chunk × archetype (the tufts in their LOD order), then merged per archetype (mergeGroups)
    const sets = new Map();
    for (const { cx, cz, lists, apron: out } of chunks) for (const name in lists) {
      if (due()) yield;
      const arr = lists[name], n = arr.length / STRIDE;
      const a = new Float32Array(n * 4), b = new Float32Array(n * 4), e = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 4; c++) { a[i * 4 + c] = arr[i * STRIDE + c]; b[i * 4 + c] = arr[i * STRIDE + 4 + c]; }
        e[i * 2] = arr[i * STRIDE + 8]; e[i * 2 + 1] = arr[i * STRIDE + 9];
      }
      const top = name === 'reed' ? 3.4 : name === 'marram' || name === 'drinn' ? 1.6 : 1.2;
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { const y = a[i * 4 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const box = new THREE.Box3(new THREE.Vector3(cx - 1, y0 - 0.5, cz - 1), new THREE.Vector3(cx + CHUNK + 1, y1 + top, cz + CHUNK + 1));
      if (out) { box.min.y -= 1.5; box.max.y += 1.5; } // apron relief: a margin for its height field
      const key = name + (out ? '|apron' : '');
      if (!sets.has(key)) sets.set(key, []);
      sets.get(key).push({ name, cx, cz, apron: !!out, n, a, b, e, box });
    }
    for (const recs of sets.values()) {
      const name = recs[0].name, ix = proto(name).index, idxCount = ix ? ix.count : proto(name).attributes.position.count;
      for (const list of mergeGroups(recs, idxCount)) {
        if (due()) yield;
        const m = mergedMesh(proto(name), list, q);
        group.add(m); geos.push(m.geometry); meshes.push(m);
      }
    }
    Object.values(protos).forEach((g) => g.dispose());
    if (apronOnly) return;
    clutter?.dispose(); scrub?.dispose();
    clutter = yield* createClutterG(ctx, q, group, U);
    scrub = prof.scrub || ctx.scrubPlan?.length ? createScrub(ctx, q, group, U) : null;
  }
  let curQ = Q;
  yield* buildG(Q);
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  return {
    group, uniforms: U,
    get instanceCount() { return (merged ? meshes : chunkMeshes).reduce((s, m) => s + m.geometry.instanceCount, 0); },
    /** Grass draws (meshes) per pass at most: merged, or per chunk with PERF.grassMerge off. */
    get drawCount() { return (merged ? meshes : chunkMeshes).length; },
    get totalInstances() { return meshes.reduce((s, m) => s + m.userData.n, 0); },
    update(dt, camera, time) {
      U.uTime.value = time;
      U.tTrail.value = trails.texture;
      if (camera) {
        // world metres per pixel → minimum blade width (≈1.1 px)
        const h = (camera.top - camera.bottom) / camera.zoom;
        const px = h / (ctx.gl.domElement.height || 1080);
        U.uMinW.value = px * 1.1;
        // must-fix 9: zoom + distance density LOD (coverage kept by widening blades), ultra capped in TERRAIN_QUALITY
        const pxPerM = 1 / px, frac = Math.min(1, Math.max(0.4, pxPerM / 55));
        U.uLodW.value = 1 / Math.sqrt(frac);
        const halfW = (camera.right - camera.left) / camera.zoom / 2;
        _t.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const k = _t.y < -1e-3 ? -camera.position.y / _t.y : 0; // view centre on the ground plane
        const vcx = camera.position.x + _t.x * k, vcz = camera.position.z + _t.z * k;
        U.uLodV.value.set(vcx, vcz, Math.max(halfW, 1), frac);
        if ((PERF.grassMerge !== false) !== merged) useMerged(PERF.grassMerge !== false);
        let tris = 0;
        for (const m of merged ? meshes : chunkMeshes) {
          const u = m.userData;
          if (u.members) {
            // merged: the largest of its chunks' fractions; the prefix of tufts with in-chunk position i/n below it
            let near = false;
            for (const mb of u.members) {
              const dx = Math.max(0, Math.abs(mb.x - vcx) - CHUNK / 2), dz = Math.max(0, Math.abs(mb.z - vcz) - CHUNK / 2);
              if (!(Math.hypot(dx, dz) / Math.max(halfW, 1) > 0.92)) { near = true; break; }
            }
            // (i < ceil(n f) ⟺ i/n < f; the margin only ever adds a tuft the fade hides)
            m.geometry.instanceCount = Math.max(1, below(u.keys, frac * (near ? 1 : 0.7) + 1e-9));
          } else {
            // nearest point of the chunk to the view centre: the shader fades by each instance's own distance
            const dx = Math.max(0, Math.abs(u.c[0] - vcx) - CHUNK / 2), dz = Math.max(0, Math.abs(u.c[1] - vcz) - CHUNK / 2);
            const f = frac * (Math.hypot(dx, dz) / Math.max(halfW, 1) > 0.92 ? 0.7 : 1);
            m.geometry.instanceCount = Math.max(1, Math.min(u.n, Math.ceil(u.n * f)));
          }
          tris += m.geometry.instanceCount;
        }
        this.drawnInstances = tris;
        const sun = (ctx._sun ||= ctx.sun || ctx.scene.getObjectByProperty('isDirectionalLight', true));
        if (sun) {
          _v.copy(sun.position).sub(sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
          U.uSunV.value.copy(_v); U.uSunI.value = sun.intensity;
        }
      }
      clutter?.update?.(dt, time); scrub?.update?.(dt, time);
    },
    setQuality(q) { if (q !== curQ) { curQ = q; build(q); } },
    /**
     * Continue the tufts past the map edges over the scenery apron (art/apron.js), thinning out over `band` m:
     * @param {{splat:object, ox:number, oz:number, heightAt:(x:number,z:number)=>number, band:number}} a the apron's
     *   splat (grid origin ox/oz, world m) and height field; null removes them.
     */
    setApron(a) { apron = a && a.band > 0 ? a : null; build(curQ, true); },
    /** setApron() as a sliced job (engine/slice.js). */
    *setApronG(a) { apron = a && a.band > 0 ? a : null; yield* buildG(curQ, true); },
    /** Instances in the apron chunks (stats / tests). */
    get apronInstances() { return meshes.reduce((s, m) => s + (m.userData.apron ? m.userData.n : 0), 0); },
    dispose() {
      apron = null; clear(false);
      clutter?.dispose(); scrub?.dispose(); clutter = scrub = null;
      scene.remove(group); mat.dispose(); depth.dispose();
    },
    get profile() { return prof; },
    get scrub() { return scrub; },
  };
}
