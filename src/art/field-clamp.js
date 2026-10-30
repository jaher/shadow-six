/**
 * The field W of the M17 camp at the end of November (second art pass): ploughed for the winter, its sugar beet lifted
 * and clamped at the headland by the S road — a long earth-covered mound over a straw lining, straw "chimneys" along
 * its crest to let it breathe, a few beets spilled at the end where the last cart was loaded.
 *  - buildBeetClamp(p): a `crates` structure with `variant: 'beet_clamp'` (art/props.js): local +X along its length
 *    `w`, base width `d`, crest `h`; origin on the ground at its centre. It blocks as drawn: its w × d is B.LOW (a man
 *    crawling behind it is hidden, a standing one is not).
 *  - buildFurrows(spec, groundAt): the ploughed ridges, visual only (no footprint, no block: the grid never sees
 *    them), draped on the drawn ground; one mesh, one material.
 * Plain colours in node.
 * @module art/field-clamp
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { antiTile } from './anti-tiling.js';

function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * The library's mud as worked soil: hex-tiled as the dressing set is, but `grime` (the walls' world-space weathering:
 * rain streaks and rising damp down steep faces, dust on flat tops) turned down — down the clamp's sides the streaks
 * read as board siding. A fresh material (the caller disposes it with its geometry). Plain colour in node.
 */
function soilMaterial(tint, name, grime = 0, extra = {}) {
  const base = dressingMaterial('mud'), m = THREE.MeshStandardMaterial.prototype.copy.call(new THREE.MeshStandardMaterial(), base);
  Object.assign(m, extra); m.color.set(tint); m.name = name;
  return base.map ? antiTile(m, { lib: 'mud', grime }) : m;
}
/** Clamp mound: a rounded ridge along x, its ends hipped round; lumpy soil. @param {{w:number,d:number,h:number}} p */
export function buildBeetClamp(p) {
  const w = p.w ?? 9, d = p.d ?? 2.4, h = p.h ?? 1.0, R = rng(1128), g = new THREE.Group(); g.name = 'dressing:beet_clamp';
  const NU = 48, NV = 16, pos = [], idx = [];
  const half = (u) => { const e = Math.abs(u) - (w / 2 - d / 2); return e <= 0 ? d / 2 : (d / 2) * Math.sqrt(Math.max(0, 1 - (e / (d / 2)) ** 2)); };
  for (let i = 0; i <= NU; i++) {
    const u = -w / 2 + (w * i) / NU, hw = Math.max(0.001, half(u));
    for (let j = 0; j <= NV; j++) {
      const s = -1 + (2 * j) / NV, lump = (vn(u * 1.4, s * 2.3, 1128) - 0.5) * 0.12 * (1 - s * s); // (smooth lumps: per-vertex noise read as boards)
      const top = h * Math.pow(Math.max(0, hw / (d / 2)), 0.6);   // the hipped ends come down to the ground
      pos.push(u, Math.max(0, top * Math.pow(1 - Math.abs(s) ** 1.3, 1.4) + lump) - 0.03, s * hw * (1 + Math.abs(lump))); // (a rounded ridge: ~40° flanks, a toe at the foot)
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  // uv: along it, and over it by the profile's own length (v = z + y stood still up its S flank: the texture ran down in streaks)
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i <= NU; i++) {
    let acc = 0;
    for (let j = 0; j <= NV; j++) {
      const k = i * (NV + 1) + j;
      if (j) acc += Math.hypot(pos[3 * k + 1] - pos[3 * k - 2], pos[3 * k + 2] - pos[3 * k - 1]);
      uv[2 * k] = pos[3 * k] / 2.4; uv[2 * k + 1] = acc / 2.4;
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // the field's own soil over it (the library's mud; the sand set's ripples ran down its sides like board siding)
  const sm0 = soilMaterial(0xffffff, 'beet_clamp:soil'); geo.addEventListener('dispose', () => sm0.dispose());
  const soil = new THREE.Mesh(geo, sm0); soil.name = 'beet_clamp:soil'; soil.castShadow = soil.receiveShadow = true; g.add(soil);
  // the straw lining showing along the crest: its breathing chimneys, loose wisps of thin stalks splayed from the soil
  const straw = [], beets = [];
  for (const x of [-w * 0.33, -w * 0.11, w * 0.11, w * 0.33]) {
    for (let k = 0; k < 11; k++) {
      const L = 0.22 + R() * 0.24, lean = 0.25 + R() * 0.75, yaw = R() * 6.28;
      straw.push(new THREE.CylinderGeometry(0.006, 0.012, L, 3, 1, true).translate(0, L / 2, 0).rotateZ(lean).rotateY(yaw)
        .translate(x + (R() - 0.5) * 0.16, h - 0.05, (R() - 0.5) * 0.12).toNonIndexed());
    }
  }
  const sm = new THREE.Mesh(mergeGeometries(straw, false), dressingMaterial('straw')); sm.name = 'beet_clamp:straw'; sm.castShadow = true; sm.receiveShadow = true; g.add(sm);
  // beets spilled at the loading end: tapered white roots, a little soil on them
  for (let k = 0; k < 7; k++) {
    const b = new THREE.SphereGeometry(0.075, 7, 5).scale(1, 1.6, 1).rotateZ(Math.PI / 2 + (R() - 0.5) * 0.8).rotateY(R() * 6.28);
    beets.push(b.translate(w / 2 + 0.05 + R() * 0.4, 0.06, (R() - 0.5) * d * 0.6).toNonIndexed());
  }
  const bm = new THREE.Mesh(mergeGeometries(beets, false), paintedMaterial('sand', 0xd8cdb4)); bm.name = 'beet_clamp:beets'; bm.castShadow = true; g.add(bm);
  for (const q of [...straw, ...beets]) q.dispose();
  return g;
}

// ---------------------------------------------------------------- the ploughed field
const hash2 = (i, j, s) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s + 1, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Smooth value noise in [0, 1). */
function vn(x, z, s = 0) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, s) => vn(x, z, s) * 0.6 + vn(x * 2.1, z * 2.1, s + 7) * 0.3 + vn(x * 4.3, z * 4.3, s + 13) * 0.1;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Smooth max of two inside-distances (a soft union of two shapes). */
const smax = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k)); return b + (a - b) * h + k * h * (1 - h); };
/** One ridge across its period: crest at t = 0 (rounded, the turned slice), the furrow at t = ½ (a sharper V). */
const ridge = (t) => Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * t), 0.65);

/**
 * The field's shape as distance fields. `poly`: a convex quad whose two sides run along the furrows (`dir`) and whose
 * two ends cross them (the headlands); `aprons`: capsules of trodden soil ({a, b, r}: round the clamp, where carts load).
 * Inside distances (m, > 0 inside): `quad` (corners rounded), `ends` (from the nearer headland edge, with that edge),
 * `soil` (the quad and the aprons, a soft union, its outline ragged by noise).
 */
export function fieldShape(spec) {
  const { poly, dir } = spec, seed = spec.seed ?? 1944, ux = Math.cos(dir), uz = Math.sin(dir);
  let A = 0; for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; A += x0 * z1 - x1 * z0; }
  const sg = Math.sign(A) || 1;
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    return { a, ex: ex / L, ez: ez / L, end: Math.abs((ex * ux + ez * uz) / L) < 0.7 };   // an end crosses the furrows
  });
  const K = 0.9;
  return {
    edges,
    /** @returns {{quad:number, ends:number, end:object|null, soil:number}} */
    at(x, z) {
      let m = Infinity, ends = Infinity, end = null; const d = [];
      for (const e of edges) {
        const v = sg * (e.ex * (z - e.a[1]) - e.ez * (x - e.a[0]));
        d.push(v); if (v < m) m = v; if (e.end && v < ends) { ends = v; end = e; }
      }
      let s = 0; for (const v of d) s += Math.exp(-(v - m) / K);
      const quad = m - K * Math.log(s);                                    // a soft min: the corners rounded
      let soil = quad;
      for (const p of spec.aprons || []) {
        const bx = p.b[0] - p.a[0], bz = p.b[1] - p.a[1], t = Math.max(0, Math.min(1, ((x - p.a[0]) * bx + (z - p.a[1]) * bz) / (bx * bx + bz * bz)));
        soil = smax(soil, p.r - Math.hypot(x - p.a[0] - t * bx, z - p.a[1] - t * bz), 1.2);
      }
      soil += (fbm(x / 3.2, z / 3.2, seed) - 0.5) * 1.2 + (vn(x * 1.1, z * 1.1, seed + 3) - 0.5) * 0.3; // a ragged, uneven margin
      return { quad, ends, end, soil };
    },
  };
}

const LIFT = 0.02;
/**
 * The ploughed field (art pass 2, fix round 1): ONE soft-edged soil mesh draped on the drawn ground — no strips, no
 * slabs. Its relief is the ridges themselves (`height`, a few cm: the vertices lifted along a ridge profile `spacing`
 * apart across `dir`), their ends tapering over a metre at the headlands (each ridge ending at its own place), where the
 * plough turned and the soil runs across the field; the ridges sink into the ground 1–2 m before the soil's ragged
 * outline, and the soil itself fades out there (vertex alpha) into the grass: no edge of it is a line or a step.
 * Visual only (no footprint, no block); one mesh, one material (the library's mud, its tone in the vertex colours).
 * @param {{poly:number[][], dir:number, spacing?:number, height?:number, head?:number, aprons?:object[], seed?:number}} spec
 * @param {((x:number, z:number) => number)|null} groundAt the drawn ground height
 * @returns {THREE.Mesh|null}
 */
export function buildPloughedField(spec, groundAt = null) {
  const { poly, dir } = spec, sp = spec.spacing ?? 0.7, H = spec.height ?? 0.075, head = spec.head ?? 2.6, seed = spec.seed ?? 1944;
  const G = groundAt || (() => 0), ux = Math.cos(dir), uz = Math.sin(dir), shape = fieldShape(spec);
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cz = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  const U = (x, z) => (x - cx) * ux + (z - cz) * uz, V = (x, z) => -(x - cx) * uz + (z - cz) * ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const grow = (x, z, r) => { const u = U(x, z), v = V(x, z); u0 = Math.min(u0, u - r); u1 = Math.max(u1, u + r); v0 = Math.min(v0, v - r); v1 = Math.max(v1, v + r); };
  for (const [x, z] of poly) grow(x, z, 1.6);
  for (const p of spec.aprons || []) { grow(p.a[0], p.a[1], p.r + 1.6); grow(p.b[0], p.b[1], p.r + 1.6); }
  const du = 0.15, dv = sp / 5, nu = Math.ceil((u1 - u0) / du) + 1, nv = Math.ceil((v1 - v0) / dv) + 1, N = nu * nv;
  const P3 = new Float32Array(N * 3), C4 = new Float32Array(N * 4);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = u0 + i * du, v = v0 + j * dv, x = cx + u * ux - v * uz, z = cz + u * uz + v * ux, k = j * nu + i;
    const f = shape.at(x, z);
    if (f.soil <= -0.7) { P3[3 * k] = x; P3[3 * k + 1] = G(x, z) + LIFT; P3[3 * k + 2] = z; C4.fill(0.95, 4 * k, 4 * k + 3); continue; } // (past the soil)
    const alpha = sstep(-0.7, 0.9, f.soil);
    // the ridges: along the field (their line wanders a little), each ending at its own place before the headland
    const tm = v / sp + 0.1 * (vn(u * 0.3, v * 0.6, seed + 21) - 0.5);
    const ej = (vn(tm, 0.5, seed + 31) - 0.5) * 0.9;
    const wMain = sstep(head - 0.35 + ej, head + 0.65 + ej, f.ends);
    const th = f.ends / sp + 0.14 * (vn(u * 0.5, v * 0.5, seed + 23) - 0.5);            // the headland: across the field
    const P = wMain * ridge(tm) + (1 - wMain) * ridge(th);
    const fEdge = sstep(0.5, 1.9, Math.min(f.soil, f.quad + 0.4));                        // sunk into the ground at the margin
    const relief = H * (0.75 + 0.5 * vn(u * 0.45, v * 1.3, seed + 5)) * fEdge * P + 0.012 * (vn(x * 4.5, z * 4.5, seed + 9) - 0.5) * Math.max(fEdge, 0.4 * alpha);
    P3[3 * k] = x; P3[3 * k + 1] = G(x, z) + LIFT + relief; P3[3 * k + 2] = z;
    // the tone: the crests drier and paler, the furrows' bottoms damp; broad damp patches; the margin trodden flat
    const c = (0.56 + 0.56 * (fEdge * P + (1 - fEdge) * 0.62)) * (0.9 + 0.2 * fbm(x / 7, z / 7, seed + 11));
    C4[4 * k] = c * 1.1; C4[4 * k + 1] = c * 1.04; C4[4 * k + 2] = c * 0.95; C4[4 * k + 3] = alpha;
  }
  // the cells that carry soil; their vertices compacted
  const remap = new Int32Array(N).fill(-1), idx = [], pos = [], col = [], uv = [];
  const vid = (k) => {
    if (remap[k] < 0) { remap[k] = pos.length / 3; pos.push(P3[3 * k], P3[3 * k + 1], P3[3 * k + 2]); col.push(C4[4 * k], C4[4 * k + 1], C4[4 * k + 2], C4[4 * k + 3]); uv.push(P3[3 * k] / 2.4, P3[3 * k + 2] / 2.4); }
    return remap[k];
  };
  for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
    if (Math.max(C4[4 * a + 3], C4[4 * b + 3], C4[4 * c + 3], C4[4 * d + 3]) < 0.004) continue;
    const A = vid(a), B = vid(b), Cc = vid(c), D = vid(d);
    idx.push(A, Cc, B, B, Cc, D);
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = soilMaterial(spec.tint ?? 0xffffff, 'm17:ploughed', 0.2, { vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  geo.addEventListener('dispose', () => mat.dispose());   // (the map's unload disposes geometries)
  const m = new THREE.Mesh(geo, mat);
  m.name = 'm17:ploughed'; m.receiveShadow = true; m.castShadow = false; m.renderOrder = -1;
  m.userData.aoExclude = true;                                // a draped decal: nothing for the AO prepass
  return m;
}
