/**
 * Z-fighting detector, the pure core (node + browser) of tools/art/zfight.mjs. User: "Make sure there is no z-fighting
 * in the geometry".
 *
 * Two surfaces z-fight where the depth buffer cannot tell which one is in front: their depths at a pixel differ by less
 * than the depth noise, so the winner changes with tiny camera changes (speckles, stripes, a crawling seam). The game
 * camera is a fixed-pitch ORTHOGRAPHIC camera (engine/camera.js: pitch 40°, near 1, far = 2 × distance + 400 = 700 m,
 * zoom = 40 px/m × zoom level), so the depth is linear in the view distance and its precision is the same everywhere:
 * depthModel() derives the noise from the real near/far, the depth format, the float32 vertex transform and the
 * rasterizer's sub-pixel snapping times the surface's depth slope at the default and the closest zoom (the empirical
 * calibration in zfight-page.mjs scales it to what this GPU really does).
 *
 *   a  coplanar / near-coplanar same-facing faces of two different meshes or items overlapping (a crossing at a small
 *      angle fights in a band along the crossing line: the band's area is measured, not just "parallel and close");
 *   b  the same inside one mesh / merged geometry: doubled faces, a slab whose top sits flush on another box's top;
 *   c  a flat mesh lying on the terrain (decal, disc, threshing floor, piazza, puddle, paving, road / track ribbon,
 *      patch, shadow plane) within the depth noise of the RENDERED terrain surface, sampled densely under each face
 *      (the terrain is not flat and its triangles are not the decal's), after the material's own depth treatment;
 *   d  two ground layers (decals, paving, roads) overlapping coplanar with each other;
 *   e  (zfight-page.mjs) the flicker seen in real renders under depth-only and sub-pixel camera changes.
 *
 * A depth treatment counts only when it resolves the pair at every checked view: polygonOffset pulls a surface
 * factor × (its depth slope per pixel) + units × (one depth step) towards the camera (pull()); a surface drawn first
 * without writing depth (depthWrite:false, earlier renderOrder or the opaque list) never fights what is drawn over it
 * (canFight()); a real lift is just geometry. depthWrite:false + a later renderOrder does NOT resolve a decal flush on
 * the terrain: the decal is still depth-TESTED against the terrain's depth (LEQUAL), so about half its pixels lose
 * (measured on this GPU: tests/unit/zfight.test.mjs, docs in zfight.mjs).
 * @module tools/art/zfight-core
 */
import * as THREE from 'three';
import { MeshBVH } from '../../vendor/three-mesh-bvh/index.module.js';

export const KINDS = {
  a: 'coplanar faces of two meshes', b: 'coplanar faces inside one mesh', c: 'flat mesh flush on the terrain',
  d: 'coplanar ground layers', e: 'flicker in renders',
};

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r3 = (v) => Math.round(v * 1000) / 1000;
/** float32 spacing at |x| */
export const ulp32 = (x) => 2 ** (Math.floor(Math.log2(Math.max(Math.abs(x), 1e-30))) - 23);

// ------------------------------------------------------------------ camera + depth model

/**
 * The game camera's frame at a yaw (deg) and pitch (deg below horizontal): c = unit vector from the target towards the
 * camera (camera.js viewOffset), x / y = the camera's screen right / up (three's lookAt with up = +Y).
 */
export function cameraFrame(yawDeg, pitchDeg = 40) {
  const a = yawDeg * D2R, e = pitchDeg * D2R, ce = Math.cos(e);
  const c = [Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce];
  const lx = Math.hypot(c[2], c[0]);
  const x = [c[2] / lx, 0, -c[0] / lx];
  const y = cross(c, x);
  return { yaw: yawDeg, pitch: pitchDeg, c, x, y };
}

/**
 * Depth precision of the game camera. All lengths in metres along the view (orthographic: depth = distance along it).
 * @param {{near?:number, far?:number, depthFormat?:'d16'|'d24'|'d32f', zMax?:number, subpixelBits?:number,
 *   pxPerMeterAt1x?:number, dpr?:number, zooms?:number[], yaws?:number[], visYaws?:number[], pitchDeg?:number,
 *   safety?:number}} [o] zooms: the zoom levels to judge at (default [1, 2]: the default and the closest player
 *   zoom); yaws: the views a finding must fight in (default [15]: the default camera angle, plus the Options angles 0
 *   and 45 and the free rotation when visYaws says so); zMax: the largest view distance of anything drawn (float32
 *   vertex rounding); safety: measured scale (calibration), 1 = the model alone
 */
export function depthModel(o = {}) {
  const near = o.near ?? 1, far = o.far ?? 700, range = far - near;
  const depthFormat = o.depthFormat ?? 'd24';
  const bits = depthFormat === 'd16' ? 16 : 24; // d32f: 23+1 mantissa bits near the far end of [0, 1] → 2^-24 too
  const qDepth = range * 2 ** -bits; // one depth-buffer step (m): linear depth, the same everywhere
  const rUnit = range * 2 ** -24 * (bits === 16 ? 256 : 1); // polygonOffset "units": r = one step of the format (m)
  const zMax = o.zMax ?? far;
  const qVert = ulp32(zMax); // float32 rounding of the view-space depth of a vertex (m)
  const subpx = 2 ** -(o.subpixelBits ?? 8); // rasterizer sub-pixel snapping (px)
  const ppm1 = o.pxPerMeterAt1x ?? 40, dpr = o.dpr ?? 1;
  const zooms = (o.zooms ?? [1, 2]).map((z) => ({ zoom: z, ppm: ppm1 * z * dpr, mpp: 1 / (ppm1 * z * dpr) }));
  const pitch = o.pitchDeg ?? 40;
  const frames = (o.yaws ?? [15]).map((y) => cameraFrame(y, pitch));
  const cfgs = [];
  for (let fi = 0; fi < frames.length; fi++) for (let zi = 0; zi < zooms.length; zi++) cfgs.push({ k: cfgs.length, f: frames[fi], z: zooms[zi], fi, zi });
  const m = {
    near, far, range, depthFormat, bits, qDepth, rUnit, zMax, qVert, subpx, zooms, frames, cfgs, pitch,
    safety: o.safety ?? 1,
    /** depth slope (m of depth per screen pixel) of a plane with world normal n in camera frame f at zoom z */
    slope(n, f, z) {
      const nz = Math.abs(dot(n, f.c));
      if (nz < 1e-6) return Infinity;
      return (z.mpp * Math.max(Math.abs(dot(n, f.x)), Math.abs(dot(n, f.y)))) / nz;
    },
    /** depth noise (m): two surfaces closer than this along the view fight. Quantization + float32 depth of each
     *  vertex (×2 surfaces) + sub-pixel snapping × slope, times the measured safety. */
    eps(n, f, z) {
      return m.safety * (qDepth + 2 * qVert + m.slope(n, f, z) * subpx * 2);
    },
    /** how far (m of depth) polygonOffset pulls a surface of material state `ms` with depth slope `s` towards the camera */
    pull(ms, s) {
      if (!ms || !ms.po) return 0;
      const v = -(ms.po[0] * (Number.isFinite(s) ? s : 0) + ms.po[1] * rUnit);
      return Number.isFinite(v) ? v : 0;
    },
    describe() {
      const g = [0, 1, 0];
      return {
        near, far, depthFormat, qDepthMm: r3(qDepth * 1e3 * 1000) / 1000, rUnitMm: r3(rUnit * 1e3 * 1000) / 1000, zMax: r3(zMax), qVertMm: r3(qVert * 1e6) / 1000,
        subpixelPx: subpx, safety: r3(m.safety), pitch,
        zooms: zooms.map((z) => ({ zoom: z.zoom, pxPerM: z.ppm,
          groundEpsMm: frames.map((f) => ({ yaw: f.yaw, eps: r3(m.eps(g, f, z) * 1e3 * 1000) / 1000, slopeMm: r3(m.slope(g, f, z) * 1e3) })) })),
      };
    },
  };
  return m;
}

// ------------------------------------------------------------------ material state + draw order

/**
 * What the depth test sees of a material on an object: {side 0 front / 1 back / 2 double, po [factor, units] | null,
 * dw depthWrite, dt depthTest, tr drawn in the transparent list, ro renderOrder, cw colorWrite, cut alpha-tested,
 * opaque (occludes), name}.
 */
export function materialState(mat, obj = null) {
  if (!mat) return null;
  const tr = !!(mat.transparent || (mat.transmission ?? 0) > 0);
  return {
    name: mat.name || mat.type || '?',
    side: mat.side === THREE.DoubleSide ? 2 : mat.side === THREE.BackSide ? 1 : 0,
    po: mat.polygonOffset ? [mat.polygonOffsetFactor || 0, mat.polygonOffsetUnits || 0] : null,
    dw: mat.depthWrite !== false,
    dt: mat.depthTest !== false,
    tr,
    ro: obj?.renderOrder ?? 0,
    cw: mat.colorWrite !== false,
    cut: (mat.alphaTest ?? 0) > 0,
    visible: mat.visible !== false,
    opaque: !tr && !((mat.alphaTest ?? 0) > 0) && mat.visible !== false && mat.colorWrite !== false,
  };
}

/** Who draws first: -1 A, 1 B, 0 either (same list and renderOrder: three's per-frame depth sort decides). */
export function drawOrder(A, B) {
  if (A.tr !== B.tr) return A.tr ? 1 : -1; // opaque list before the transparent list
  if (A.ro !== B.ro) return A.ro < B.ro ? -1 : 1;
  return 0;
}

/**
 * Can two coincident surfaces speckle? The one drawn second is depth-tested against the depth buffer; only if the one
 * drawn first WROTE depth there can it lose pixels to it. A surface that skips the depth test never loses. Order unknown:
 * either can be second.
 */
export function canFight(A, B) {
  if (!A || !B || !A.visible || !B.visible) return false;
  if (!A.dt || !B.dt) return false;
  if (!A.cw && !B.cw) return false;
  const o = drawOrder(A, B);
  if (o < 0) return A.dw && B.dt;
  if (o > 0) return B.dw && A.dt;
  return A.dw || B.dw;
}

/** Text for a material's depth treatment (for the report). */
export function treatmentText(ms) {
  if (!ms) return '?';
  const p = [];
  p.push(ms.po ? `polygonOffset ${ms.po[0]}/${ms.po[1]}` : 'no polygonOffset');
  if (!ms.dw) p.push('depthWrite:false');
  if (!ms.dt) p.push('depthTest:false');
  if (ms.ro) p.push(`renderOrder ${ms.ro}`);
  if (ms.tr) p.push('transparent');
  if (ms.side === 2) p.push('DoubleSide');
  return p.join(', ');
}

// ------------------------------------------------------------------ 2D clipping with a linear attribute

/** Clip a polygon [[x, y, h], …] by the line a·(x, y) + b·h ≤ c (keep side), interpolating h. */
function clipLin(poly, ax, ay, bh, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const sp = c - (ax * p[0] + ay * p[1] + bh * p[2]), sq = c - (ax * q[0] + ay * q[1] + bh * q[2]);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out;
}

function polyArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}

function polyCentroid(poly) {
  let cx = 0, cy = 0, ch = 0, w = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; ch += (p[2] + q[2]) * c; w += c;
  }
  if (Math.abs(w) < 1e-18) { const k = poly.length; return poly.reduce((s, p) => [s[0] + p[0] / k, s[1] + p[1] / k, s[2] + p[2] / k], [0, 0, 0]); }
  return [cx / (3 * w), cy / (3 * w), ch / (3 * w)];
}

/** Is face side `side` (0 front 1 back 2 double) of a face whose normal·towardsCamera is `cos` rasterized? */
const shows = (side, cos) => (side === 2 ? Math.abs(cos) > 0.02 : side === 0 ? cos > 0.02 : cos < -0.02);

/**
 * The z-fighting band of two near-parallel triangles: where they overlap (t2 projected onto t1's plane) AND their
 * depths along the view differ by less than the noise after each material's polygonOffset. Per camera config of the
 * model (yaw × zoom) the band is the overlap clipped by |Δ(p)| < ε, Δ = h(p)/|n·c| + pull2 − pull1 (h: t2's height
 * over t1's plane, linear over the overlap). Returns the best config's band, or null.
 * @param {ArrayLike<number>} t1 9 numbers @param {ArrayLike<number>} t2 9 numbers @param {number[]} n1 t1's unit normal
 * @param {object} M1 materialState of t1 @param {object} M2 of t2 @param {ReturnType<typeof depthModel>} model
 * @param {{opp?:boolean, cfgMask?:number}} [o] opp: t2 faces the other way (one of them double-sided)
 * @returns {null|{area:number, px:number, cfg:number, mask:number, pxs:number[], point:number[], hMin:number, hMax:number, overlap:number}}
 */
export function pairBand(t1, t2, n1, M1, M2, model, o = {}) {
  const ox = t1[0], oy = t1[1], oz = t1[2];
  let ux = t1[3] - ox, uy = t1[4] - oy, uz = t1[5] - oz;
  const ul = Math.hypot(ux, uy, uz);
  if (!(ul > 1e-9)) return null;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = n1[1] * uz - n1[2] * uy, vy = n1[2] * ux - n1[0] * uz, vz = n1[0] * uy - n1[1] * ux;
  const P = (x, y, z) => { const dx = x - ox, dy = y - oy, dz = z - oz; return [dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz, dx * n1[0] + dy * n1[1] + dz * n1[2]]; };
  const A = [P(t1[0], t1[1], t1[2]), P(t1[3], t1[4], t1[5]), P(t1[6], t1[7], t1[8])];
  let poly = [P(t2[0], t2[1], t2[2]), P(t2[3], t2[4], t2[5]), P(t2[6], t2[7], t2[8])];
  const hMin0 = Math.min(poly[0][2], poly[1][2], poly[2][2]), hMax0 = Math.max(poly[0][2], poly[1][2], poly[2][2]);
  // clip t2 by t1's three edges (inside = left of each edge for a counter-clockwise t1)
  const ccw = polyArea(A) > 0 ? 1 : -1;
  for (let i = 0; i < 3 && poly.length >= 3; i++) {
    const a = A[i], b = A[(i + 1) % 3];
    // inside: cross(b - a, p - a) * ccw >= 0  ⇔  -(ccw)(by-ay) x + (ccw)(bx-ax) y <= (ccw)((bx-ax) ay - (by-ay) ax)
    const ex = b[0] - a[0], ey = b[1] - a[1];
    poly = clipLin(poly, ccw * ey, -ccw * ex, 0, ccw * (ey * a[0] - ex * a[1]));
  }
  if (poly.length < 3) return null;
  const overlap = Math.abs(polyArea(poly));
  if (!(overlap > 1e-9)) return null;
  let best = null;
  let mask = 0;
  const pxs = new Array(model.cfgs.length).fill(0);
  for (const cf of model.cfgs) {
    if (o.cfgMask != null && !(o.cfgMask & (1 << cf.k))) continue;
    const cos1 = dot(n1, cf.f.c), cos2 = o.opp ? -cos1 : cos1;
    if (!shows(M1.side, cos1) || !shows(M2.side, cos2)) continue;
    const ac = Math.abs(cos1), s = cos1 >= 0 ? 1 : -1;
    const sl = model.slope(n1, cf.f, cf.z), eps = model.eps(n1, cf.f, cf.z);
    const dp = model.pull(M2, sl) - model.pull(M1, sl);
    // band: -eps < s·h/ac + dp < eps  ⇔  s·h < (eps - dp)·ac  and  -s·h < (eps + dp)·ac
    let band = clipLin(poly, 0, 0, s, (eps - dp) * ac);
    if (band.length >= 3) band = clipLin(band, 0, 0, -s, (eps + dp) * ac);
    if (band.length < 3) continue;
    const area = Math.abs(polyArea(band));
    if (!(area > 1e-10)) continue;
    const px = area * ac * cf.z.ppm * cf.z.ppm;
    pxs[cf.k] = px;
    mask |= 1 << cf.k;
    if (!best || px > best.px) best = { area, px, cfg: cf.k, band };
  }
  if (!best) return null;
  const c = polyCentroid(best.band);
  const point = [ox + c[0] * ux + c[1] * vx, oy + c[0] * uy + c[1] * vy, oz + c[0] * uz + c[1] * vz]; // (on t1's plane)
  return { area: best.area, px: best.px, cfg: best.cfg, mask, pxs, point, hMin: hMin0, hMax: hMax0, overlap };
}

// ------------------------------------------------------------------ scene → surfaces → triangles

/** Default classification of a drawable mesh for the map scan: 'terrain' | 'water' | 'natural' | 'skip' | 'surface'. */
export function classifyMesh(o, path) {
  const ud = o.userData || {};
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const mn = mats.map((m) => m?.name || '').join(' ');
  if (/^terrainB(:chunk)?$|^terrain:apron(:chunk)?$|^terrain:apronSkirt$/.test(o.name) || ud.terrainSurface) return 'terrain';
  if (/(^|\/)(fx|vfx[^/]*|windParticles|snowfall|blood[^/]*|blast-marks|ambientLife|flyovers|kit-batch|selection|vision-cone|noise-rings|sky[^/]*|duckWakes|rain)(\/|$)/i.test(path)) return 'skip';
  if (/water|wave|foam|spray|mist|splash|ripple|wake|caustic|ice_column|wet_streak|breach|surf\b|shore_?fade/i.test(`${path} ${mn}`) && !/waterTerrain/.test(path)) return 'water';
  if (/(^|\/)(grassB|vegetation[^/]*|scrub[^/]*|clutter[^/]*)(\/|$)|^(grass:|veg[A-Z]|vegLod|clutterStones|scrub)/.test(`${path}|${o.name}`) || /^(grass|veg)/.test(o.name)) return 'natural';
  return 'surface';
}

/** Draw ranges of a mesh: [{start, count, mi}] in index units (or vertices when non-indexed). Chunk rows (engine/chunking.js) cut their own range per camera: the whole row is taken. */
export function drawRanges(o) {
  const g = o.geometry, idx = g.index, total = idx ? idx.count : g.attributes.position.count;
  if (o.__row) {
    const row = o.__row, start = row.local ? 0 : row.start, count = row.count;
    const mi = g.groups.length ? g.groups[0].materialIndex : 0;
    return [{ start, count, mi }];
  }
  const dr = g.drawRange, ds = dr.start || 0, de = Math.min(total, ds + (Number.isFinite(dr.count) && dr.count != null ? dr.count : total));
  if (!g.groups.length || !Array.isArray(o.material)) return [{ start: ds, count: Math.max(0, de - ds), mi: 0 }];
  const out = [];
  for (const gr of g.groups) {
    const s = Math.max(ds, gr.start), e = Math.min(de, gr.start + gr.count);
    if (e > s) out.push({ start: s, count: e - s, mi: gr.materialIndex ?? 0 });
  }
  return out;
}

/** Does a material's vertex shader move its vertices (onBeforeCompile writing `transformed`)? Then CPU positions are approximate. */
export function displacedMaterial(m) {
  const f = m?.onBeforeCompile;
  if (typeof f !== 'function') return false;
  const s = String(f);
  return /transformed\s*(\+|-|\*)?=|transformed\.[xyz]+\s*(\+|-|\*)?=|vec3 transformed =/.test(s) || /VERT_MAIN|vegWind|grassPos|cvOffset|flagWave|bannerSway/.test(s);
}

const PATH_SKIP = /^(\(-\)|Group|Object3D|Mesh|fit|lod\d|decals(_lod\d)?|mesh_\d+(_\d+)?|row|:chunk)$/;

/**
 * Every drawable mesh under `root` (effectively visible, on the camera's layers) as surface records: one per mesh, one
 * per instance of an InstancedMesh. @param {THREE.Object3D} root
 * @param {{camera?:THREE.Camera, classify?:(o:THREE.Object3D, path:string)=>string, skip?:Set<THREE.Object3D>,
 *   skinned?:boolean, only?:(rec:object)=>boolean}} [o] skip: subtrees never collected (units); skinned: include
 *   skinned meshes (posed on the CPU)
 */
export function collectSurfaces(root, o = {}) {
  const classify = o.classify || classifyMesh;
  const out = [];
  root.updateMatrixWorld(true);
  const visit = (node, path, item) => {
    if (!node.visible || o.skip?.has(node)) return;
    const nm = node.name || '';
    const p = path ? `${path}/${nm || '(-)'}` : nm || '(-)';
    const it = nm && !PATH_SKIP.test(nm) && !/^mesh_\d/.test(nm) ? nm : item;
    const drawable = (node.isMesh || node.isSkinnedMesh) && !node.isLine && !node.isPoints && node.geometry?.attributes?.position;
    if (drawable && !(o.camera && !node.layers.test(o.camera.layers)) && !(node.isSkinnedMesh && !o.skinned)) {
      const cls = classify(node, p);
      if (cls !== 'skip') {
        const mats = (Array.isArray(node.material) ? node.material : [node.material]).map((m) => materialState(m, node));
        const ranges = drawRanges(node).filter((r) => r.count >= 3 && mats[r.mi]?.visible !== false);
        if (ranges.length) {
          const base = { object: node, geometry: node.geometry, ranges, mats, cls, path: p, item: it || p.split('/')[0], name: nm || '(mesh)',
            displaced: (Array.isArray(node.material) ? node.material : [node.material]).some(displacedMaterial), skinned: !!node.isSkinnedMesh };
          if (node.isInstancedMesh) {
            const im = new THREE.Matrix4();
            for (let k = 0; k < node.count; k++) {
              node.getMatrixAt(k, im);
              out.push({ ...base, instance: k, matrix: new THREE.Matrix4().multiplyMatrices(node.matrixWorld, im) });
            }
          } else out.push({ ...base, instance: -1, matrix: node.matrixWorld.clone() });
        }
      }
    }
    for (const c of node.children) visit(c, p, it);
  };
  if (root.isScene) for (const c of root.children) visit(c, '', null);
  else visit(root, '', null);
  for (let i = 0; i < out.length; i++) out[i].id = i;
  return o.only ? out.filter(o.only) : out;
}

/** Display name of a surface record: item, mesh, instance, material. */
export function surfaceName(r, mi = 0) {
  return `${r.path}${r.instance >= 0 ? `#${r.instance}` : ''}${r.mats[mi]?.name ? ` [${r.mats[mi].name}]` : ''}`;
}

/**
 * World-space triangles of a list of surface records: {n, pos Float32Array(9n), nrm Float32Array(3n), area, owner
 * (record index), mat (index into mats), mats (material states), recs}. Degenerate triangles are dropped. Skinned
 * records are posed on the CPU (SkinnedMesh.getVertexPosition).
 */
export function gatherTriangles(recs, o = {}) {
  let total = 0;
  for (const r of recs) for (const g of r.ranges) total += Math.floor(g.count / 3);
  const pos = new Float32Array(total * 9), nrm = new Float32Array(total * 3), area = new Float32Array(total);
  const owner = new Int32Array(total), mat = new Int32Array(total), local = new Int32Array(total);
  const mats = [], matKey = new Map();
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let n = 0;
  for (let ri = 0; ri < recs.length; ri++) {
    const r = recs[ri], g = r.geometry, P = g.attributes.position, I = g.index;
    const flip = r.matrix.determinant() < 0;
    const read = r.skinned ? (i, out) => r.object.getVertexPosition(i, out) : (i, out) => out.fromBufferAttribute(P, i);
    for (const rg of r.ranges) {
      const ms = r.mats[rg.mi];
      const key = ms; let mIdx = matKey.get(key);
      if (mIdx === undefined) { mIdx = mats.length; mats.push(ms); matKey.set(key, mIdx); }
      const end = rg.start + Math.floor(rg.count / 3) * 3;
      for (let k = rg.start; k < end; k += 3) {
        const i0 = I ? I.getX(k) : k, i1 = I ? I.getX(k + 1) : k + 1, i2 = I ? I.getX(k + 2) : k + 2;
        read(i0, a).applyMatrix4(r.matrix);
        read(flip ? i2 : i1, b).applyMatrix4(r.matrix);
        read(flip ? i1 : i2, c).applyMatrix4(r.matrix);
        v.subVectors(b, a).cross(c.clone().sub(a));
        const l = v.length();
        if (!(l > 1e-10) || !Number.isFinite(l)) continue;
        const o9 = n * 9;
        pos[o9] = a.x; pos[o9 + 1] = a.y; pos[o9 + 2] = a.z; pos[o9 + 3] = b.x; pos[o9 + 4] = b.y; pos[o9 + 5] = b.z; pos[o9 + 6] = c.x; pos[o9 + 7] = c.y; pos[o9 + 8] = c.z;
        nrm[n * 3] = v.x / l; nrm[n * 3 + 1] = v.y / l; nrm[n * 3 + 2] = v.z / l;
        area[n] = l / 2; owner[n] = ri; mat[n] = mIdx; local[n] = (k - rg.start) / 3;
        n++;
      }
    }
  }
  return { n, pos: pos.subarray(0, n * 9), nrm: nrm.subarray(0, n * 3), area: area.subarray(0, n), owner: owner.subarray(0, n), mat: mat.subarray(0, n), local: local.subarray(0, n), mats, recs };
}

/** A MeshBVH over a triangle set; `map[t]` = the set's triangle of BVH triangle t (the BVH reorders its index). */
export function buildBVH(T) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(T.pos, 3));
  const bvh = new MeshBVH(geo);
  const idx = geo.index.array, map = new Int32Array(T.n);
  for (let t = 0; t < T.n; t++) map[t] = (idx[3 * t] / 3) | 0;
  return { bvh, map, geo };
}

// ------------------------------------------------------------------ kinds a / b / d: coplanar faces

/**
 * Coplanar / near-coplanar same-facing overlapping faces among the triangles of T (a: two owners, b: one owner).
 * Returns raw contributions {ta, tb, oa, ob, area, px, pxs, mask, point}. Pairs farther apart than `pad` (m) are not
 * examined (only a polygonOffset could bring them into the noise band).
 * @param {object} T gatherTriangles result @param {{bvh, map}} B buildBVH(T) @param {object} model depthModel
 * @param {{pad?:number, cosPar?:number, minPx?:number, cap?:number, ownerFilter?:(oa:number, ob:number)=>boolean}} [o]
 */
export function coplanarScan(T, B, model, o = {}) {
  const pad = o.pad ?? 0.004, cosPar = o.cosPar ?? Math.cos(4 * D2R), minPx = o.minPx ?? 0.05;
  const { pos, nrm } = T;
  const out = [];
  const qb = new THREE.Box3();
  const fightCache = new Map();
  const fight = (ma, mb) => { const k = ma * 65536 + mb; let v = fightCache.get(k); if (v === undefined) { v = canFight(T.mats[ma], T.mats[mb]); fightCache.set(k, v); } return v; };
  let cur = -1, curO = -1, tests = 0;
  const t1 = new Float64Array(9), t2 = new Float64Array(9);
  const n1 = [0, 0, 0];
  const cb = {
    intersectsBounds: (box) => box.intersectsBox(qb),
    intersectsTriangle: (tri, t) => {
      if (t <= cur) return false;
      const ob = B.map[t], oa = curO;
      tests++;
      const c = nrm[oa * 3] * nrm[ob * 3] + nrm[oa * 3 + 1] * nrm[ob * 3 + 1] + nrm[oa * 3 + 2] * nrm[ob * 3 + 2];
      let opp = false;
      if (c < cosPar) {
        if (c > -cosPar) return false;
        if (T.mats[T.mat[oa]].side !== 2 && T.mats[T.mat[ob]].side !== 2) return false;
        opp = true;
      }
      if (!fight(T.mat[oa], T.mat[ob])) return false;
      if (o.ownerFilter && !o.ownerFilter(T.owner[oa], T.owner[ob])) return false;
      // quick plane test: t2's vertices all on one side of t1's plane, farther than pad
      const nx = nrm[oa * 3], ny = nrm[oa * 3 + 1], nz = nrm[oa * 3 + 2];
      const d0 = nx * pos[oa * 9] + ny * pos[oa * 9 + 1] + nz * pos[oa * 9 + 2];
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 3; k++) {
        const h = nx * pos[ob * 9 + 3 * k] + ny * pos[ob * 9 + 3 * k + 1] + nz * pos[ob * 9 + 3 * k + 2] - d0;
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (lo > pad || hi < -pad) return false;
      for (let k = 0; k < 9; k++) { t1[k] = pos[oa * 9 + k]; t2[k] = pos[ob * 9 + k]; }
      n1[0] = nx; n1[1] = ny; n1[2] = nz;
      const r = pairBand(t1, t2, n1, T.mats[T.mat[oa]], T.mats[T.mat[ob]], model, { opp });
      if (r && r.px >= minPx) out.push({ ta: oa, tb: ob, oa: T.owner[oa], ob: T.owner[ob], area: r.area, px: r.px, pxs: r.pxs, mask: r.mask, point: r.point, overlap: r.overlap, hMin: r.hMin, hMax: r.hMax });
      return false;
    },
  };
  for (let t = 0; t < T.n; t++) {
    const oa = B.map[t];
    const p = oa * 9;
    qb.min.set(Math.min(pos[p], pos[p + 3], pos[p + 6]) - pad, Math.min(pos[p + 1], pos[p + 4], pos[p + 7]) - pad, Math.min(pos[p + 2], pos[p + 5], pos[p + 8]) - pad);
    qb.max.set(Math.max(pos[p], pos[p + 3], pos[p + 6]) + pad, Math.max(pos[p + 1], pos[p + 4], pos[p + 7]) + pad, Math.max(pos[p + 2], pos[p + 5], pos[p + 8]) + pad);
    cur = t; curO = oa;
    B.bvh.shapecast(cb);
    if (o.cap && out.length > o.cap) break;
  }
  out.tests = tests;
  return out;
}

/**
 * Exact duplicates: does triangle tb repeat ta's three vertices (any rotation, same winding)? Then both rasterize to
 * bit-identical depths and the later one wins every pixel (LEQUAL): no flicker today, still a doubled face.
 */
export function exactDuplicate(T, ta, tb) {
  const p = T.pos;
  for (let r = 0; r < 3; r++) {
    let same = true;
    for (let k = 0; k < 3 && same; k++) for (let c = 0; c < 3 && same; c++) if (p[ta * 9 + k * 3 + c] !== p[tb * 9 + ((k + r) % 3) * 3 + c]) same = false;
    if (same) return true;
  }
  return false;
}

// ------------------------------------------------------------------ kind c: flush on the terrain

/**
 * Height of the rendered terrain at (x, z) (null off it): a vertical ray against the terrain BVH, from above.
 * Cached at 1 mm. @param {{bvh}} TB buildBVH of the terrain triangles
 */
export function terrainHeight(TB, top = 2000) {
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const cache = new Map();
  const f = (x, z) => {
    const k = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
    let v = cache.get(k);
    if (v !== undefined) return v;
    ray.origin.set(x, top, z);
    const h = TB.bvh.raycastFirst(ray, THREE.DoubleSide, 0, top * 2);
    v = h ? h.point.y : null;
    if (cache.size > 4e6) cache.clear();
    cache.set(k, v);
    return v;
  };
  f.cache = cache;
  return f;
}

/**
 * Faces lying on the terrain within its depth noise after their material's depth treatment (kind c). Upward faces (or
 * double-sided flat ones) whose vertices come within `band` m of the terrain are sampled on a grid of ≤ `spacing` m
 * (the terrain is piecewise linear on its own grid: flush at the vertices is not flush between them). Per sample and
 * camera config: Δ = (vertical gap × |n_y|)/|n·c| + pull(face) − pull(terrain); |Δ| < ε fights, Δ < −ε is buried.
 * @returns {object[]} samples {t (triangle), o (owner), p [x,y,z], a (m²), g (gap m), fight (cfg mask), pxs, buried,
 *   need: depth deficit (m) at the default config}
 */
export function terrainScan(T, heightAt, terrMat, model, o = {}) {
  const band = o.band ?? 0.15, spacing = o.spacing ?? 0.2, maxSamples = o.maxSamples ?? 600;
  const out = [];
  const { pos, nrm } = T;
  const cfgs = model.cfgs;
  for (let t = 0; t < T.n; t++) {
    const rec = T.recs[T.owner[t]];
    if (rec.cls !== 'surface') continue;
    const M = T.mats[T.mat[t]];
    let n = [nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]];
    if (n[1] < 0.25) { if (M.side === 2 && n[1] < -0.25) n = [-n[0], -n[1], -n[2]]; else continue; }
    if (!canFight(M, terrMat) && !canFight(terrMat, M)) continue;
    const p = t * 9;
    const vy = [pos[p + 1], pos[p + 4], pos[p + 7]];
    const H = [heightAt(pos[p], pos[p + 2]), heightAt(pos[p + 3], pos[p + 5]), heightAt(pos[p + 6], pos[p + 8])];
    const cx = (pos[p] + pos[p + 3] + pos[p + 6]) / 3, cy = (vy[0] + vy[1] + vy[2]) / 3, cz = (pos[p + 2] + pos[p + 5] + pos[p + 8]) / 3;
    const Hc = heightAt(cx, cz);
    const gaps = [];
    for (let k = 0; k < 3; k++) if (H[k] != null) gaps.push(vy[k] - H[k]);
    if (Hc != null) gaps.push(cy - Hc);
    if (!gaps.length) continue;
    const gMin = Math.min(...gaps), gMax = Math.max(...gaps);
    if (gMin > band || gMax < -band - (o.maxPull ?? 0.2)) continue;
    // sample sub-triangle centroids of a k × k barycentric subdivision
    const e = Math.max(Math.hypot(pos[p + 3] - pos[p], pos[p + 5] - pos[p + 2]), Math.hypot(pos[p + 6] - pos[p + 3], pos[p + 8] - pos[p + 5]), Math.hypot(pos[p] - pos[p + 6], pos[p + 2] - pos[p + 8]));
    let k = Math.max(1, Math.ceil(e / spacing));
    while (k * k > maxSamples && k > 1) k--;
    const aS = T.area[t] / (k * k);
    const slopes = cfgs.map((cf) => model.slope(n, cf.f, cf.z));
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k - i; j++) {
        for (let up = 0; up < 2; up++) {
          if (up && i + j >= k - 1) continue;
          // sub-triangle centroid in barycentric coordinates
          const bu = up ? (i + 2 / 3) / k : (i + 1 / 3) / k, bv = up ? (j + 2 / 3) / k : (j + 1 / 3) / k, bw = 1 - bu - bv;
          const x = pos[p] * bw + pos[p + 3] * bu + pos[p + 6] * bv, y = pos[p + 1] * bw + pos[p + 4] * bu + pos[p + 7] * bv, z = pos[p + 2] * bw + pos[p + 5] * bu + pos[p + 8] * bv;
          const h = heightAt(x, z);
          if (h == null) continue;
          const g = y - h;
          let fightMask = 0, buried = 0, need = 0;
          const pxs = new Array(cfgs.length).fill(0);
          for (const cf of cfgs) {
            const cos = dot(n, cf.f.c);
            if (!shows(M.side, cos)) continue;
            const ac = Math.abs(cos);
            const sl = slopes[cf.k], eps = model.eps(n, cf.f, cf.z);
            const Dl = (g * Math.abs(n[1])) / ac + model.pull(M, sl) - model.pull(terrMat, sl);
            if (Math.abs(Dl) < eps) { fightMask |= 1 << cf.k; pxs[cf.k] = aS * ac * cf.z.ppm * cf.z.ppm; }
            else if (Dl <= -eps) buried |= 1 << cf.k;
            if (cf.k === 0) need = Math.max(0, eps - Dl);
          }
          if (fightMask || (buried && g > -band)) out.push({ t, o: T.owner[t], p: [x, y, z], a: aS, g, fight: fightMask, pxs, buried, need, ny: n[1] });
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ visibility

/**
 * Occlusion test from the game camera: bit k of the result = point p is seen in camera config k (frames of the model:
 * nothing opaque between it and the camera; the point's own coplanar partner is skipped by starting 1 cm out).
 * @param {{bvh, map}} B surfaces BVH @param {object} T its triangles @param {{bvh}|null} TB terrain BVH
 */
export function makeVisibility(B, T, TB, model, o = {}) {
  const ray = new THREE.Ray(), far = o.far ?? 600, start = o.start ?? 0.01;
  const frames = model.frames;
  const seen = (p, f) => {
    ray.origin.set(p[0] + f.c[0] * start, p[1] + f.c[1] * start, p[2] + f.c[2] * start);
    ray.direction.set(f.c[0], f.c[1], f.c[2]);
    if (TB && TB.bvh.raycastFirst(ray, THREE.DoubleSide, 0, far)) return false;
    if (B) {
      const hits = B.bvh.raycast(ray, THREE.DoubleSide, 0, far);
      for (const h of hits) { const tt = B.map[h.faceIndex]; const ms = T.mats[T.mat[tt]]; if (ms.opaque && T.recs[T.owner[tt]].cls !== 'water') return false; }
    }
    return true;
  };
  /** @returns {number} mask over model.frames */
  return (p, frameMask = (1 << frames.length) - 1) => {
    let m = 0;
    for (let i = 0; i < frames.length; i++) if (frameMask & (1 << i) && seen(p, frames[i])) m |= 1 << i;
    return m;
  };
}

/** Camera-config mask → frame mask (yaws). */
export function frameMaskOf(model, cfgMask) {
  let m = 0;
  for (const cf of model.cfgs) if (cfgMask & (1 << cf.k)) m |= 1 << cf.fi;
  return m;
}

// ------------------------------------------------------------------ clustering into findings

/** Single-linkage clusters of items with .point within r (m), via a grid. @returns {object[][]} */
export function clusterPoints(items, r = 2) {
  const cell = r, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  items.forEach((it, i) => { const k = key(it.point[0], it.point[1], it.point[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const lab = new Int32Array(items.length).fill(-1), out = [];
  for (let i = 0; i < items.length; i++) {
    if (lab[i] >= 0) continue;
    const grp = [i]; lab[i] = out.length;
    for (let g = 0; g < grp.length; g++) {
      const p = items[grp[g]].point, cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
          if (lab[j] >= 0) continue;
          const q = items[j].point;
          if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= r) { lab[j] = out.length; grp.push(j); }
        }
      }
    }
    out.push(grp.map((k) => items[k]));
  }
  return out;
}

/**
 * Coplanar contributions → spots per owner pair (kind a / b, d when both lie on the terrain), with visibility, the
 * exact-duplicate test and the summed screen area at the best camera config.
 */
export function coplanarFindings(T, contribs, model, vis, o = {}) {
  const byPair = new Map();
  for (const c of contribs) {
    const k = c.oa < c.ob ? `${c.oa}|${c.ob}` : `${c.ob}|${c.oa}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(c);
  }
  const findings = [];
  for (const list of byPair.values()) {
    for (const grp of linkContribs(T, list, o.clusterR ?? 2)) {
      const pxs = new Array(model.cfgs.length).fill(0);
      let area = 0, mask = 0;
      for (const c of grp) { for (let k = 0; k < pxs.length; k++) pxs[k] += c.pxs[k]; area += c.area; mask |= c.mask; }
      // visibility: the biggest contributions, up to 8
      const sample = [...grp].sort((p, q) => q.px - p.px).slice(0, 8);
      let visFrames = 0, visN = 0;
      for (const c of sample) { const m = vis ? vis(c.point, frameMaskOf(model, c.mask)) : frameMaskOf(model, c.mask); if (m) { visN++; visFrames |= m; } }
      const visShare = sample.length ? visN / sample.length : 0;
      const visPxs = pxs.map((v, k) => (visFrames & (1 << model.cfgs[k].fi) ? v * visShare : 0));
      const best = visPxs.reduce((bi, v, k) => (v > visPxs[bi] ? k : bi), 0);
      const c0 = grp[0];
      const exact = grp.every((c) => exactDuplicate(T, c.ta, c.tb));
      const pt = sample.length ? sample[0].point : c0.point;
      const ra = T.recs[c0.oa], rb = T.recs[c0.ob];
      findings.push({
        kind: c0.oa === c0.ob ? 'b' : 'a', exact,
        a: brief(ra, T.mats[T.mat[c0.ta]]), b: brief(rb, T.mats[T.mat[c0.tb]]),
        point: { x: r3(pt[0]), y: r3(pt[1]), z: r3(pt[2]) },
        area: r3(area), tris: grp.length, px: Math.round(visPxs[best] * 10) / 10, pxAll: Math.round(Math.max(...pxs) * 10) / 10,
        cfg: cfgName(model, best), visible: visN > 0, visShare: r3(visShare), yaws: model.frames.filter((f, i) => visFrames & (1 << i)).map((f) => f.yaw),
        h: [r3(Math.min(...grp.map((c) => c.hMin)) * 1000) / 1000, r3(Math.max(...grp.map((c) => c.hMax)) * 1000) / 1000],
        box: boxOf(grp.map((c) => c.point)), pts: sample.map((c) => c.point.map(r3)),
        treatment: [treatmentText(T.mats[T.mat[c0.ta]]), treatmentText(T.mats[T.mat[c0.tb]])],
      });
    }
  }
  return findings;
}

/** Contributions of one owner pair → spots: linked when they share a triangle (one band running across the triangles of
 *  both faces) or lie within r (m). */
function linkContribs(T, list, r) {
  const par = list.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  // (a band runs on across neighbouring triangles: contributions whose faces share a vertex are one spot)
  const byVert = new Map(), q = 1e4;
  list.forEach((c, i) => {
    for (const [role, t] of [['a', c.ta], ['b', c.tb]]) {
      for (let k = 0; k < 3; k++) {
        const key = `${role}${Math.round(T.pos[t * 9 + 3 * k] * q)},${Math.round(T.pos[t * 9 + 3 * k + 1] * q)},${Math.round(T.pos[t * 9 + 3 * k + 2] * q)}`;
        const j = byVert.get(key);
        if (j === undefined) byVert.set(key, i); else unite(i, j);
      }
    }
  });
  for (const grp of clusterPoints(list.map((c, i) => ({ point: c.point, i })), r)) for (const g of grp) unite(grp[0].i, g.i);
  const out = new Map();
  list.forEach((c, i) => { const k = find(i); if (!out.has(k)) out.set(k, []); out.get(k).push(c); });
  return [...out.values()];
}

/** Terrain-contact samples → spots per owner (kind c). */
export function terrainFindings(T, samples, model, vis, o = {}) {
  const byOwner = new Map();
  for (const s of samples) { if (!byOwner.has(s.o)) byOwner.set(s.o, []); byOwner.get(s.o).push({ ...s, point: s.p }); }
  const findings = [];
  for (const list of byOwner.values()) {
    for (const grp of clusterPoints(list, o.clusterR ?? 3)) {
      const fighting = grp.filter((s) => s.fight);
      if (!fighting.length) continue;
      const pxs = new Array(model.cfgs.length).fill(0);
      let area = 0;
      for (const s of fighting) { area += s.a; for (let k = 0; k < pxs.length; k++) pxs[k] += s.pxs[k]; }
      const sample = pick(fighting, 8);
      let visFrames = 0, visN = 0;
      for (const s of sample) { const m = vis ? vis(s.p, frameMaskOf(model, s.fight)) : frameMaskOf(model, s.fight); if (m) { visN++; visFrames |= m; } }
      const visShare = sample.length ? visN / sample.length : 0;
      const visPxs = pxs.map((v, k) => (visFrames & (1 << model.cfgs[k].fi) ? v * visShare : 0));
      const best = visPxs.reduce((bi, v, k) => (v > visPxs[bi] ? k : bi), 0);
      const rec = T.recs[grp[0].o], M = T.mats[T.mat[grp[0].t]];
      const gs = grp.map((s) => s.g);
      const pt = sample[0].p;
      // what would resolve it: a lift (m, vertical) or a slope-scaled polygonOffset factor, at every config
      let liftNeed = 0, factorNeed = 0;
      for (const s of grp) {
        for (const cf of model.cfgs) {
          const n = [0, 1, 0], cos = dot(n, cf.f.c), ac = Math.abs(cos), sl = model.slope(n, cf.f, cf.z), eps = model.eps(n, cf.f, cf.z);
          const geo = (s.g * Math.abs(s.ny)) / ac; // depth gap without any offset
          liftNeed = Math.max(liftNeed, ((2 * eps - geo) * ac) / Math.max(0.2, Math.abs(s.ny)));
          if (sl > 0 && Number.isFinite(sl)) factorNeed = Math.max(factorNeed, (2 * eps - geo - 4 * model.rUnit) / sl); // (with units -4)
        }
      }
      findings.push({
        kind: 'c', a: brief(rec, M), b: { id: 'terrain', item: 'terrain', mesh: 'terrainB', mat: 'terrain' },
        point: { x: r3(pt[0]), y: r3(pt[1]), z: r3(pt[2]) },
        area: r3(area), samples: grp.length, fightSamples: fighting.length, buriedSamples: grp.filter((s) => s.buried && !s.fight).length,
        gapMm: [r3(Math.min(...gs) * 1000), r3(Math.max(...gs) * 1000)],
        px: Math.round(visPxs[best] * 10) / 10, pxAll: Math.round(Math.max(...pxs) * 10) / 10, cfg: cfgName(model, best),
        visible: visN > 0, visShare: r3(visShare), yaws: model.frames.filter((f, i) => visFrames & (1 << i)).map((f) => f.yaw),
        box: boxOf(grp.map((s) => s.p)), pts: sample.map((s) => s.p.map(r3)),
        treatment: [treatmentText(M), 'terrain'],
        fix: { liftMm: Math.ceil(liftNeed * 1e4) / 10, polygonOffsetFactor: -Math.max(1, Math.ceil(factorNeed * 10) / 10) },
      });
    }
  }
  return findings;
}

function pick(list, n) {
  if (list.length <= n) return list;
  const out = [], step = list.length / n;
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

function boxOf(pts) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  return { min: mn.map(r3), max: mx.map(r3) };
}

function cfgName(model, k) {
  const cf = model.cfgs[k];
  return cf ? `yaw ${cf.f.yaw}° zoom ${cf.z.zoom}` : '?';
}

/** Containers whose children are the items (props/prop:house:x → prop:house:x). */
const CONTAINER = /^(props|furniture|pavement|street-lights|terrain:ground|dressing|structures|buildings|scenery|links|script|visuals|m\d\dart|e\d\dart)$/i;
const GENERIC = /^(\(-\)|Group|Object3D|Mesh|fit|lod\d|main|row|mesh_\d+(_\d+)?|.*:chunk|.*:row)$/;

/** Item (the placed thing), part (its named sub-object) and mesh names of a surface record's scene path. */
export function namesOf(path) {
  const seg = path.split('/');
  let i = 0;
  while (i < seg.length - 1 && (CONTAINER.test(seg[i]) || GENERIC.test(seg[i]))) i++;
  const item = seg[i] || path;
  const rest = seg.slice(i + 1).filter((x) => !GENERIC.test(x) && x !== item);
  return { item, part: rest.length ? rest[rest.length - 1] : '', mesh: seg[seg.length - 1] };
}

function brief(rec, ms) {
  const n = namesOf(rec.path);
  return { id: `${rec.path}${rec.instance >= 0 ? '#' + rec.instance : ''}`, item: n.item + (rec.instance >= 0 ? `#${rec.instance}` : ''), part: n.part, mesh: n.mesh, mat: ms?.name ?? '?', instance: rec.instance, displaced: !!rec.displaced };
}

// ------------------------------------------------------------------ allow-list

const glob = (pat, s) => {
  if (pat == null) return true;
  const p = String(pat);
  if (!p.includes('*')) return p === String(s);
  const re = new RegExp('^' + p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(String(s));
};
const names = (it) => [it?.id, it?.item, it?.part, it?.mesh, it?.mat].filter((v) => v != null && v !== '').map(String);
const matchItem = (pat, it) => pat == null || names(it).some((n) => glob(pat, n));

/**
 * The allow-list entry covering a finding (null = none). Entry {mission?, a, b?, kind?, near?: [x, z], r?, reason}
 * (the format of tools/art/intersection-allow.*.json): a / b match either side by id, item, mesh or material name with
 * `*` wildcards; near + r (m, default 3) limit it to one spot. Entries without a reason never match.
 */
export function matchAllow(entries, mission, f) {
  for (const e of entries || []) {
    if (!e || !e.reason) continue;
    if (e.mission && e.mission !== '*' && !glob(e.mission, mission)) continue;
    if (e.kind && e.kind !== f.kind) continue;
    const fwd = matchItem(e.a, f.a) && matchItem(e.b, f.b), rev = matchItem(e.a, f.b) && matchItem(e.b, f.a);
    if (!fwd && !rev) continue;
    if (e.near && Math.hypot(e.near[0] - f.point.x, e.near[1] - f.point.z) > (e.r ?? 3)) continue;
    return e;
  }
  return null;
}

// ------------------------------------------------------------------ image analysis (kind e)

/** Half-float (uint16 bits) → perceptual 0..255 (Reinhard x/(1+x), then √ for a gamma-like scale). 65536-entry LUT. */
let HALF_LUT = null;
export function halfLUT() {
  if (HALF_LUT) return HALF_LUT;
  HALF_LUT = new Uint8Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    let v = e === 0 ? (f / 1024) * 2 ** -14 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15);
    v *= s;
    if (!(v > 0)) v = 0;
    if (!Number.isFinite(v)) v = 65504;
    HALF_LUT[h] = Math.round(Math.sqrt(v / (1 + v)) * 255);
  }
  return HALF_LUT;
}

/** RGBA half-float pixels (Uint16Array) → RGB perceptual bytes (Uint8Array 3/px), flipped to top-down rows. */
export function toPerceptual(u16, w, h, out = new Uint8Array(w * h * 3)) {
  const L = halfLUT();
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 3;
    for (let x = 0; x < w; x++) { const s = src + x * 4, d = dst + x * 3; out[d] = L[u16[s]]; out[d + 1] = L[u16[s + 1]]; out[d + 2] = L[u16[s + 2]]; }
  }
  return out;
}

/** OR into `mask` (Uint8Array w·h) the pixels where max-channel |a − b| > T (0..255). @returns {number} count set now */
export function diffInto(a, b, T, mask) {
  let n = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
    const d = Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2]));
    if (d > T && !mask[i]) { mask[i] = 1; n++; }
  }
  return n;
}

/**
 * OR into `mask` the pixels a sub-pixel move cannot explain: |jit − base| > (max − min of base's 3×3 neighbourhood) + T
 * per channel. A move of less than a pixel resamples the image between neighbouring values; a surface winning where the
 * other one won before can jump outside that range (a flat area's colour flipping to another surface's).
 */
export function unexplainedInto(base, jit, w, h, T, mask) {
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = base[((y + dy) * w + x + dx) * 3 + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const v = jit[i * 3 + c];
        if (v > hi + T || v < lo - T) { mask[i] = 1; n++; break; }
      }
    }
  }
  return n;
}

/** Binary dilation by a (2r+1)² square. */
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w + r; x++) {
      if (x < w && mask[y * w + x]) run = 2 * r + 1;
      const xo = x - r;
      if (run > 0) { if (xo >= 0 && xo < w) tmp[y * w + xo] = 1; run--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h + r; y++) {
      if (y < h && tmp[y * w + x]) run = 2 * r + 1;
      const yo = y - r;
      if (run > 0) { if (yo >= 0 && yo < h) out[yo * w + x] = 1; run--; }
    }
  }
  return out;
}

/** Keep the pixels of `mask` whose (2r+1)² window holds at least `min` set pixels (thin intersection lines go, speckle areas stay). */
export function densityFilter(mask, w, h, r, min) {
  const W = w + 1, S = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += mask[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row; } }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      if (s >= min) out[y * w + x] = 1;
    }
  }
  return out;
}

/** 8-connected components of a mask: [{n, x0, y0, x1, y1, cx, cy, pixels: Int32Array}] (largest first). */
export function components(mask, w, h, minN = 1) {
  const lab = new Int32Array(mask.length).fill(-1), out = [], stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const px = [];
    lab[i] = out.length; stack.push(i);
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j / w) | 0;
      px.push(j); sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (mask[k] && lab[k] < 0) { lab[k] = lab[i]; stack.push(k); }
      }
    }
    if (px.length >= minN) out.push({ n: px.length, x0, y0, x1, y1, cx: sx / px.length, cy: sy / px.length, pixels: Int32Array.from(px) });
  }
  return out.sort((p, q) => q.n - p.n);
}

/**
 * Flicker clusters of a hit mask: the density filter drops thin lines (a crossing's one-pixel seam), a dilation joins
 * the speckles of one area, components ≥ minN pixels. Each cluster's `hits` counts the hit pixels inside it.
 */
export function flickerClusters(mask, w, h, o = {}) {
  const keep = densityFilter(mask, w, h, o.r ?? 3, o.min ?? 8);
  const grown = dilate(keep, w, h, o.grow ?? 2);
  const cl = components(grown, w, h, 1);
  const out = [];
  for (const c of cl) {
    let hits = 0;
    for (const i of c.pixels) hits += mask[i];
    if (hits >= (o.minN ?? 8)) { c.hits = hits; out.push(c); }
  }
  return out.sort((p, q) => q.hits - p.hits);
}

/** Severity of a finding: high = a flicker seen in renders or a big fighting area (≥ 400 px² at the best config), medium ≥ 25 px², else low. */
export function severityOf(f) {
  if (f.kind === 'e' || (f.flicker?.px ?? 0) >= 20) return 'high';
  if (f.exact) return 'low';
  return f.px >= 400 ? 'high' : f.px >= 25 ? 'medium' : 'low';
}
