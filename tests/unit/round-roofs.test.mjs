/**
 * Round roofs (art/round-roofs.js; user 2026-11-09: "Do we need to average normals? Some round roofs look polygonal when
 * seen from above"). A cone / dome built from flat facets lights as 24 wedges and outlines as a 24-gon:
 *  - smoothLathe / creaseNormals (procedural builders): the normal is analytic round the circle (continuous across the
 *    seam, one per facet at an apex), hard corners (eaves, rims, caps, an octagon's edges) stay hard, big rings get more
 *    segments (ringSegments);
 *  - refineRoundRoofs / roundRoofs (the building library's GLBs: towers, domes, bunker and pillbox roofs): every sloped
 *    surface of revolution of 12+ segments is re-tessellated on the true circle with the analytic normal, in the file's own
 *    attribute layout; walls, caps, pitched roofs and 8-sided spires are not touched. The library-wide check at the end
 *    fails when an asset keeps a flat-shaded round roof (a new GLB with the old defect, or a detector regression).
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { applyAssetFixups } from '../../src/art/building-fixups.js';
import { ringSegments, smoothLathe, creaseNormals, refineRoundRoofs, roundRoofs, SAG_TOL } from '../../src/art/round-roofs.js';
import { Geo } from '../../src/art/castle-kit.js';
import { planHull, planCells, overheadCells, lowSurfaces, measureTop, visualSignature, finestMeshes } from '../../src/world/placement-visual.js';
import { gameplayGeometry, hasGameplayGeometry } from '../../src/engine/gameplay-geometry.js';
import { buildKitTower } from '../../src/art/kit-buildings.js';

const DEG = 180 / Math.PI;
const P = (f) => new URL(`../../${f}`, import.meta.url);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * DEG;
const nrm = (g, i) => [g.attributes.normal.getX(i), g.attributes.normal.getY(i), g.attributes.normal.getZ(i)];
const pos = (g, i) => [g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)];
const key = (p, q = 1e3) => p.map((v) => Math.round(v * q)).join(',');

// ------------------------------------------------------------------------------------------------ ringSegments

test('ringSegments: the chord sagitta stays under the tolerance, small rings stay small', () => {
  for (const R of [0.6, 1, 1.5, 2.5, 3.1, 4, 6]) for (const tol of SAG_TOL) {
    const n = ringSegments(R, tol, { max: 128 });
    assert.ok(R * (1 - Math.cos(Math.PI / n)) <= tol + 1e-9, `R ${R} tol ${tol}: ${n} segments`);
    assert.ok(n % 4 === 0 && n >= 8, `a multiple of 4: ${n}`);
  }
  assert.equal(ringSegments(0.2, 0.1), 8, 'min');
  assert.equal(ringSegments(40, SAG_TOL[0]), 64, 'max');
  assert.ok(ringSegments(3.1) >= 36, 'a 3 m roof needs 36+ at zoom 2 (the 24-gon is 26 mm off a circle)');
  assert.ok(ringSegments(3.1, SAG_TOL[1]) < ringSegments(3.1, SAG_TOL[0]), 'LOD 1 (zoom 0.5) needs fewer');
  assert.equal(ringSegments(0.5, 0.012, { min: 24 }), 24, 'min honoured');
});

// ------------------------------------------------------------------------------------------------ smoothLathe

/** Cone with a wall below, a chamfer (gentle corner), an eave corner (hard) and a flat cap at the apex. */
const PROFILE = [[3, 0], [3, 1], [2.8, 1.2], [0.05, 3.5], [0, 3.6]];

test('smoothLathe: unit normals in the meridian plane, continuous round the circle and across the seam', () => {
  const seg = 24, g = smoothLathe(PROFILE, seg, { tile: 2 });
  const Pp = g.attributes.position;
  for (let i = 0; i < Pp.count; i++) {
    const n = nrm(g, i), p = pos(g, i), r = Math.hypot(p[0], p[2]);
    near(Math.hypot(...n), 1, 1e-5, 'unit');
    if (r > 1e-6) near((-n[0] * p[2] + n[2] * p[0]) / r, 0, 1e-5, 'no tangential component: the normal lies in the meridian plane');
  }
  // every ring entry (a split corner has two per profile point): neighbouring columns differ by exactly the azimuth step
  const byKey = new Map();
  for (let i = 0; i < Pp.count; i++) {
    const p = pos(g, i), r = Math.hypot(p[0], p[2]), n = nrm(g, i);
    if (r < 1e-6) continue;
    const k = `${p[1].toFixed(3)}|${r.toFixed(3)}|${(Math.hypot(n[0], n[2])).toFixed(3)}|${n[1].toFixed(3)}`;
    (byKey.get(k) || byKey.set(k, []).get(k)).push(i);
  }
  assert.ok(byKey.size >= 5, 'a column per profile entry');
  for (const [k, list] of byKey) {
    assert.equal(list.length, seg + 1, `${k}: seg + 1 columns (seam included)`);
    const sorted = list.map((i) => ({ i, a: Math.atan2(pos(g, i)[0], pos(g, i)[2]) })).sort((x, y) => x.a - y.a);
    for (let j = 0; j + 1 < sorted.length; j++) {
      const n0 = nrm(g, sorted[j].i), d = ang(n0, nrm(g, sorted[j + 1].i));
      const step = (360 / seg) * Math.hypot(n0[0], n0[2]); // the normal turns with the azimuth, scaled by its horizontal part
      assert.ok(d <= step + 0.5, `ring ${k}: neighbours ${d.toFixed(2)}° apart (step ${step.toFixed(2)}°)`);
    }
  }
  // the seam: the first and the last column are the same points with the same normals
  for (const list of byKey.values()) {
    const az = list.map((i) => ({ i, a: Math.atan2(pos(g, i)[0], pos(g, i)[2]) })).sort((x, y) => x.a - y.a);
    const a = az[0].i, b = az[az.length - 1].i, c = az.filter((q) => Math.abs(q.a) < 1e-6 || Math.abs(Math.abs(q.a) - Math.PI) < 1e-6);
    void a; void b;
    for (const q of c.filter((x) => Math.abs(x.a) < 1e-6)) for (const w of c.filter((x) => Math.abs(x.a) < 1e-6)) { near(Math.hypot(...pos(g, q.i).map((v, k) => v - pos(g, w.i)[k])), 0, 1e-5, 'same point'); assert.ok(ang(nrm(g, q.i), nrm(g, w.i)) < 1e-3, 'same normal'); }
  }
});

test('smoothLathe: hard corners stay hard (eave, wall base), gentle ones average (chamfer, dome)', () => {
  const g = smoothLathe(PROFILE, 24, { tile: 2 }), Pp = g.attributes.position;
  const at = (y, r) => { const out = []; for (let i = 0; i < Pp.count; i++) { const p = pos(g, i); if (Math.abs(p[1] - y) < 1e-6 && Math.abs(Math.hypot(p[0], p[2]) - r) < 1e-6 && Math.abs(p[0]) < 1e-6 && p[2] > 0) out.push(nrm(g, i)); } return out; };
  const uniq = (list) => list.filter((n, i) => list.findIndex((m) => ang(n, m) < 0.01) === i);
  const wall = uniq(at(1, 3)); // wall → chamfer: 45°, over the 40° crease → two normals at that point
  assert.equal(wall.length, 2, 'the wall top is split in two');
  near(ang(wall[0], wall[1]), 45, 0.5, 'its two normals are the wall\'s and the chamfer\'s');
  const eave = uniq(at(1.2, 2.8)); // chamfer → cone: 5°, averaged
  assert.equal(eave.length, 1, 'one averaged normal');
  near(Math.hypot(eave[0][0], eave[0][2]), 0.675, 0.01, 'r 0.675 / up 0.738');
  // a hemispherical dome: every ring averaged, so the shading is continuous up the meridian
  const dome = Array.from({ length: 10 }, (_, k) => { const a = (k / 9) * Math.PI / 2; return [Math.cos(a) * 2, Math.sin(a) * 2]; });
  const d = smoothLathe(dome, 28), Dp = d.attributes.position;
  for (let i = 0; i < Dp.count; i++) { // the analytic sphere normal, to within the band slope of 5° steps
    const p = pos(d, i), l = Math.hypot(...p);
    if (l > 0.5 && p[1] > 0.1 && p[1] < 1.9) assert.ok(ang(nrm(d, i), p) < 3.3, `dome point ${p.map((v) => v.toFixed(2))}: normal ${ang(nrm(d, i), p).toFixed(1)}° off the sphere's`);
  }
});

test('smoothLathe: an apex gets one normal per facet at its mid azimuth (no lopsided wedge), faces wind outward', () => {
  const seg = 16, g = smoothLathe([[2, 0], [0, 3]], seg), Pp = g.attributes.position, I = g.index.array;
  const apex = [];
  for (let i = 0; i < Pp.count; i++) if (Math.hypot(Pp.getX(i), Pp.getZ(i)) < 1e-9) apex.push(i);
  assert.equal(apex.length, seg, 'one apex vertex per facet');
  const azs = apex.map((i) => Math.atan2(nrm(g, i)[0], nrm(g, i)[2]) * DEG).sort((a, b) => a - b);
  for (let k = 0; k < seg; k++) near(azs[k], -180 + 360 / seg / 2 + (k * 360) / seg, 0.01, 'mid azimuth of facet ' + k);
  const sum = apex.reduce((s, i) => [s[0] + nrm(g, i)[0], s[1] + nrm(g, i)[1], s[2] + nrm(g, i)[2]], [0, 0, 0]);
  near(sum[0], 0, 1e-6); near(sum[2], 0, 1e-6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  for (let t = 0; t < I.length; t += 3) { // geometric face normal agrees with the vertex normals (winding as LatheGeometry)
    a.fromBufferAttribute(Pp, I[t]); b.fromBufferAttribute(Pp, I[t + 1]); c.fromBufferAttribute(Pp, I[t + 2]);
    f.crossVectors(b.sub(a), c.sub(a));
    if (f.length() < 1e-9) continue;
    assert.ok(f.dot(new THREE.Vector3(...nrm(g, I[t]))) > 0, 'outward');
  }
});

test('smoothLathe: UVs as tlathe (u = arc m / tile, v = height / tile); 10 segments or fewer is a flat-faceted polygon', () => {
  const g = smoothLathe([[2, 0], [2, 1]], 12, { tile: 1.5 }), U = g.attributes.uv;
  for (let i = 0; i < U.count; i++) { const p = pos(g, i); near(U.getY(i), p[1] / 1.5, 1e-6); }
  const us = [...new Set(Array.from({ length: U.count }, (_, i) => +U.getX(i).toFixed(4)))].sort((a, b) => a - b);
  near(us[us.length - 1], (2 * Math.PI * 2) / 1.5, 1e-3, 'u spans the circumference in tiles');
  const oct = smoothLathe([[2, 0], [2, 1], [0, 1]], 8), Op = oct.attributes.position; // an octagonal drum with a flat top
  const wall = new Map();
  for (let i = 0; i < Op.count; i++) { const p = pos(oct, i); if (p[1] > 0.99 || p[1] < 0.01) { const n = nrm(oct, i); if (Math.abs(n[1]) < 0.1) { const k = key([Math.atan2(n[0], n[2])], 1e3); wall.set(k, (wall.get(k) || 0) + 1); } } }
  assert.equal(wall.size, 8, 'eight distinct wall normals: one per facet');
});

// ------------------------------------------------------------------------------------------------ creaseNormals

test('creaseNormals: 12+ sided cylinders round off, an octagon and a box stay hard, caps stay flat', () => {
  for (const [seg, round] of [[8, false], [10, false], [12, true], [24, true]]) {
    const g = creaseNormals(new THREE.CylinderGeometry(1, 1, 2, seg).toNonIndexed(), 32), Pp = g.attributes.position;
    let dev = 0, capsFlat = true;
    for (let i = 0; i < Pp.count; i++) {
      const p = pos(g, i), r = Math.hypot(p[0], p[2]), n = nrm(g, i);
      if (Math.abs(n[1]) > 0.5) { capsFlat = capsFlat && Math.abs(Math.abs(n[1]) - 1) < 1e-5; continue; }
      if (r > 0.5) dev = Math.max(dev, ang(n, [p[0], 0, p[2]]));
    }
    assert.ok(capsFlat, `${seg}: caps flat`);
    if (round) assert.ok(dev < 0.01, `${seg}-gon wall normals are radial (${dev.toFixed(2)}°)`); else assert.ok(dev > 10, `${seg}-gon keeps its facets (${dev.toFixed(2)}°)`);
  }
  const box = creaseNormals(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), n0 = new Set();
  for (let i = 0; i < box.attributes.normal.count; i++) n0.add(nrm(box, i).map((v) => v.toFixed(3)).join(','));
  assert.equal(n0.size, 6, 'a box keeps its six face normals');
});

test('castle-kit Geo: round towers and slate cones shade round (positions as authored), polygons and boxes stay hard', () => {
  const G = new Geo(1);
  G.cyl('slate', 0, 0, 0, 1.7, 0.02, 3.6, 14, 1);           // a bartizan cone (R 1.7)
  G.prism('ashlar', [[5, 0], [5.8, 0.6], [6.4, 1.6], [6.4, 2.6], [5.8, 3.6], [5, 4.2], [4.2, 3.6], [3.6, 2.6], [3.6, 1.6], [4.2, 0.6]].slice(0, 8), 0, 2, 1); // 8-gon prism
  G.box('ashlar', 10, 1, 0, 2, 2, 2, 0.4, 1);
  const grp = G.build('t', { ground: 0 }), slate = grp.children.find((m) => m.name === 't:slate'), ashlar = grp.children.find((m) => m.name === 't:ashlar');
  const sg = slate.geometry, Pp = sg.attributes.position;
  assert.equal(Pp.count / 3, 14 * 2 + 12, 'the cone is the 14 quads and the cap it was (gameplay measures these vertices: only the shading changed)');
  let dev = 0;
  for (let i = 0; i < Pp.count; i++) { const p = pos(sg, i), r = Math.hypot(p[0], p[2]); if (r > 0.5 && p[1] < 0.1) dev = Math.max(dev, ang(nrm(sg, i), [p[0] * 1.0, 1.7 / 3.6 * r, p[2] * 1.0])); }
  assert.ok(dev < 15, `cone normals follow the surface, not the facet (${dev.toFixed(1)}° off the analytic one at the eave)`);
  // adjacent facets share the same normal at their shared corners (continuous): same position → same normal (except the cap)
  const byPos = new Map();
  for (let i = 0; i < Pp.count; i++) { const k = key(pos(sg, i)), n = nrm(sg, i); if (n[1] < -0.5 || n[1] > 0.99) continue; (byPos.get(k) || byPos.set(k, []).get(k)).push(n); }
  for (const [k, ns] of byPos) for (const n of ns) assert.ok(ang(n, ns[0]) < 20, `corner ${k}: facets agree (${ang(n, ns[0]).toFixed(1)}°)`);
  const hard = new Set();
  for (let i = 0; i < ashlar.geometry.attributes.normal.count; i++) { const n = nrm(ashlar.geometry, i); if (Math.abs(n[1]) < 0.01) hard.add(n.map((v) => v.toFixed(2)).join(',')); }
  assert.ok(hard.size >= 8, `an octagonal prism and a box keep their facet normals (${hard.size} distinct side normals)`);
});

test('kit-buildings: a procedural tower\'s cone shades round (analytic normals, one apex normal a facet), positions as authored', () => {
  const tower = buildKitTower({ variant: 'tower_round_log', r: 2.25, h: 7, id: 't' }, 'temperate');
  let roof = null;
  tower.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); if (!roof || o.geometry.boundingBox.max.y > roof.geometry.boundingBox.max.y) roof = o; } }); // the highest mesh: the cone
  const g = roof.geometry, Pp = g.attributes.position;
  const eave = new Set();
  for (let i = 0; i < Pp.count; i++) { const p = pos(g, i); if (Math.abs(p[1] - 7) < 0.011 && Math.hypot(p[0], p[2]) > 2.6) eave.add(key(p)); }
  assert.equal(eave.size, 18, 'the eave ring keeps its 18 authored points');
  // smooth round the cone: neighbouring facets share a normal at their common point (no wedges), unit length
  const byPos = new Map();
  for (let i = 0; i < Pp.count; i++) { const p = pos(g, i); if (p[1] > 7.05 && p[1] < 7.2 && Math.hypot(p[0], p[2]) > 0.3) (byPos.get(key(p)) || byPos.set(key(p), []).get(key(p))).push(nrm(g, i)); }
  assert.ok(byPos.size >= 18, `the cone's lower ring: ${byPos.size} points`);
  for (const ns of byPos.values()) for (const n of ns) { near(Math.hypot(...n), 1, 1e-4); assert.ok(ang(n, ns[0]) < 1, 'one normal per cone point'); }
});

// ------------------------------------------------------------------------------------------------ refineRoundRoofs

/**
 * A meshopt-style GLB primitive: quantised uint16 positions (1 mm units) and int8 normals interleaved at stride 4, float uv
 * / uv1, int8 tangent, uint8 colour. A faceted cone (flat normals, one set of vertices per facet) on a flat-shaded wall,
 * a horizontal cap under its eave and a tiny top ring + cap, like tools/blender/norway/scripts/masi_tower.py's cone().
 */
function facetedCone({ N = 24, R = 3, y0 = 6, y1 = 9, rTop = 0.03, wall = true, caps = true, quant = true, smooth = false, bead = 0 } = {}) {
  const U = 1e-3, cx = 4000, cz = 4000, rows = [], index = [];
  const th = (k) => (k / N) * Math.PI * 2;
  const P3 = (r, y, k) => [cx + (r * Math.cos(th(k))) / U, y / U, cz + (r * Math.sin(th(k))) / U];
  const add = (p, n, uv, t) => { rows.push({ p, n, uv, t }); return rows.length - 1; };
  const face = (a, b, c, ua, ub, uc, tt) => { // a flat triangle: own vertices, face normal, any winding fixed to point to +radial/up
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
    const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize();
    const base = rows.length;
    for (const [p, uv] of [[a, ua], [b, ub], [c, uc]]) add(p, n.toArray(), uv, tt);
    index.push(base, base + 1, base + 2);
    return n;
  };
  // the smooth variant: every vertex carries the analytic normal (meridian slope turned to its azimuth), as a smooth-shaded export
  const slopeN = (() => { const dr = rTop - R, dy = y1 - y0, l = Math.hypot(dr, dy); return [dy / l, -dr / l]; })();
  const vnorm = (k) => [slopeN[0] * Math.cos(th(k)), slopeN[1], slopeN[0] * Math.sin(th(k))];
  const smoothFace = (a, b, c, ua, ub, uc, tt, ks) => { // one triangle with per-vertex analytic normals (vertex k of ks)
    const base = rows.length;
    for (const [p, uv, kk] of [[a, ua, ks[0]], [b, ub, ks[1]], [c, uc, ks[2]]]) add(p, vnorm(kk), uv, tt);
    index.push(base, base + 1, base + 2);
  };
  for (let k = 0; k < N; k++) { // the cone: quads (A0 A1 B1 B0) on the eave ring (r R, y0) and the top ring (r rTop, y1)
    const a0 = P3(R, y0, k), a1 = P3(R, y0, k + 1), b0 = P3(rTop, y1, k), b1 = P3(rTop, y1, k + 1), t = [1, 0, 0, 1];
    if (smooth) { smoothFace(a0, b0, a1, [k / N, 0], [k / N, 1], [(k + 1) / N, 0], t, [k, k, k + 1]); smoothFace(a1, b0, b1, [(k + 1) / N, 0], [k / N, 1], [(k + 1) / N, 1], t, [k + 1, k, k + 1]); }
    else { face(a0, b0, a1, [k / N, 0], [k / N, 1], [(k + 1) / N, 0], t); face(a1, b0, b1, [(k + 1) / N, 0], [k / N, 1], [(k + 1) / N, 1], t); }
  }
  const roofTris = index.length / 3;
  if (caps) {
    for (let k = 1; k + 1 < N; k++) face(P3(R, y0, 0), P3(R, y0, k + 1), P3(R, y0, k), [0, 0], [0, 1], [1, 0], [1, 0, 0, 1]); // underside fan, faces down
    for (let k = 1; k + 1 < N; k++) face(P3(rTop, y1, 0), P3(rTop, y1, k), P3(rTop, y1, k + 1), [0, 0], [0, 1], [1, 0], [1, 0, 0, 1]); // top cap, faces up
  }
  if (bead) for (let k = 0; k < N; k++) { // a rolled bead: a vertical band at the eave's radius under it, sharing the ring (a dome's base)
    const a0 = P3(R, y0 - bead, k), a1 = P3(R, y0 - bead, k + 1), b0 = P3(R, y0, k), b1 = P3(R, y0, k + 1);
    face(a0, a1, b0, [0, 0], [1, 0], [0, 1], [1, 0, 0, 1]); face(a1, b1, b0, [1, 0], [1, 1], [0, 1], [1, 0, 0, 1]);
  }
  if (wall) for (let k = 0; k < N; k++) { // a drum under the eave: vertical quads
    const a0 = P3(R * 0.9, y0 - 2, k), a1 = P3(R * 0.9, y0 - 2, k + 1), b0 = P3(R * 0.9, y0, k), b1 = P3(R * 0.9, y0, k + 1);
    face(a0, a1, b0, [0, 0], [1, 0], [0, 1], [1, 0, 0, 1]); face(a1, b1, b0, [1, 0], [1, 1], [0, 1], [1, 0, 0, 1]);
  }
  const g = new THREE.BufferGeometry(), n = rows.length;
  const f32 = (a) => new THREE.BufferAttribute(new Float32Array(a), a.length / n);
  if (quant) {
    const p4 = new Uint16Array(n * 4), n4 = new Int8Array(n * 4);
    rows.forEach((r, i) => { p4.set(r.p.map(Math.round), i * 4); n4.set(r.n.map((v) => Math.round(v * 127)), i * 4); });
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(p4, 4), 3, 0, false));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(n4, 4), 3, 0, true));
    g.setAttribute('tangent', new THREE.BufferAttribute(new Int8Array(rows.flatMap((r) => r.t.map((v) => Math.round(v * 127)))), 4, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 4).fill(255), 4, true));
  } else {
    g.setAttribute('position', f32(rows.flatMap((r) => r.p.map((v) => v * U))));
    g.setAttribute('normal', f32(rows.flatMap((r) => r.n)));
  }
  g.setAttribute('uv', f32(rows.flatMap((r) => r.uv)));
  g.setAttribute('uv1', f32(rows.flatMap((r) => r.uv)));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(index), 1));
  return { g, unit: quant ? U : 1, cx: cx * U, cz: cz * U, roofTris, N, R, y0, y1, rTop };
}

/**
 * Worst normal jump (degrees) between the vertices two triangles share by position, over the sloped (roof) triangles.
 * `apex`: the single point a decimated cone ends in has one normal a facet (at its mid azimuth) by design: skip it.
 */
function roofJump(g, unit = 1, { apex = false } = {}) {
  const I = g.index.array, by = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  let top = -Infinity;
  for (let t = 0; t < I.length; t += 3) {
    a.fromBufferAttribute(g.attributes.position, I[t]); b.fromBufferAttribute(g.attributes.position, I[t + 1]); c.fromBufferAttribute(g.attributes.position, I[t + 2]);
    f.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    if (!(f.y > 0.08 && f.y < 0.9995)) continue;
    for (let k = 0; k < 3; k++) { const i = I[t + k], kk = key(pos(g, i), 1 / (unit * 0.2)); top = Math.max(top, g.attributes.position.getY(i)); (by.get(kk) || by.set(kk, []).get(kk)).push([nrm(g, i), g.attributes.position.getY(i)]); }
  }
  let worst = 0;
  for (const list of by.values()) {
    if (apex && list.length > 4 && list[0][1] >= top - 1e-6) continue;
    for (const [n] of list) worst = Math.max(worst, ang(n, list[0][0]));
  }
  return worst;
}

test('refineRoundRoofs: a flat-shaded 24-facet cone becomes a round, smooth 48-segment one in the file\'s own layout', () => {
  const cone = facetedCone(), { g, unit } = cone;
  const before = roofJump(g, unit);
  assert.ok(before > 9, `the faceted cone jumps ${before.toFixed(1)}° between facets (24 flat wedges)`);
  const tris0 = g.index.count / 3, wallBefore = new Map();
  const I0 = Array.from(g.index.array), sloped = (gg, t) => { const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); a.fromBufferAttribute(gg.attributes.position, I0[t * 3]); b.fromBufferAttribute(gg.attributes.position, I0[t * 3 + 1]); c.fromBufferAttribute(gg.attributes.position, I0[t * 3 + 2]); const n = b.sub(a).cross(c.sub(a)).normalize(); return n.y > 0.08 && n.y < 0.9995; };
  for (let t = 0; t < tris0; t++) if (!sloped(g, t)) for (let k = 0; k < 3; k++) { const i = I0[t * 3 + k]; wallBefore.set(i, [...pos(g, i), ...nrm(g, i)]); }
  const attrsBefore = Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, `${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}/${a.itemSize}/${a.normalized}/${a.isInterleavedBufferAttribute ? a.data.stride : a.itemSize}`]));
  const info = refineRoundRoofs(g, { unit, tol: SAG_TOL[0] });
  assert.equal(info.surfaces.length, 1);
  const s = info.surfaces[0];
  assert.equal(s.N, 24); assert.equal(s.k, 2, '24 → 48 segments for a 3 m roof at zoom 2'); assert.ok(s.flat);
  // triangles: the 2N sloped ones become 2N k²; walls and caps are the same
  assert.equal(g.index.count / 3, tris0 - cone.roofTris + cone.roofTris * 4);
  // same layout (so depth-merge groups and shader programs do not change)
  for (const [k, a] of Object.entries(g.attributes)) assert.equal(`${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}/${a.itemSize}/${a.normalized}/${a.isInterleavedBufferAttribute ? a.data.stride : a.itemSize}`, attrsBefore[k], `${k} layout kept`);
  // smooth: no jump between the roof's triangles (8-bit normals are good to ~1°), analytic: on the cone's slope
  const after = roofJump(g, unit);
  assert.ok(after < 2.5, `roof normals jump ${after.toFixed(2)}° (was ${before.toFixed(1)}°)`);
  const slope = Math.atan2(cone.y1 - cone.y0, cone.R - cone.rTop); // the cone's meridian normal: 90° − slope from vertical
  const I = g.index.array;
  let radial = 0, worstN = 0, verts = new Set();
  for (let t = 0; t < I.length; t += 3) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    a.fromBufferAttribute(g.attributes.position, I[t]); b.fromBufferAttribute(g.attributes.position, I[t + 1]); c.fromBufferAttribute(g.attributes.position, I[t + 2]);
    const f = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (!(f.y > 0.08 && f.y < 0.9995)) continue;
    for (let k = 0; k < 3; k++) {
      const i = I[t + k], p = pos(g, i), r = Math.hypot(p[0] * unit - cone.cx, p[2] * unit - cone.cz), y = p[1] * unit;
      const want = cone.R + ((cone.rTop - cone.R) * (y - cone.y0)) / (cone.y1 - cone.y0);
      radial = Math.max(radial, Math.abs(r - want));
      const dx = (p[0] * unit - cone.cx) / (r || 1), dz = (p[2] * unit - cone.cz) / (r || 1);
      if (r > 0.1) worstN = Math.max(worstN, ang(nrm(g, i), [Math.sin(slope) * dx, Math.cos(slope), Math.sin(slope) * dz]));
      verts.add(i);
    }
  }
  assert.ok(radial < 0.003, `every roof vertex lies on the true cone (max ${radial * 1000 | 0} mm off, quantisation 1 mm)`);
  assert.ok(worstN < 2, `roof normals are the analytic cone normal (${worstN.toFixed(2)}° off, 8-bit)`);
  // the silhouette: the eave ring is a 48-gon on the circle: the sagitta is under the LOD-0 tolerance
  const eave = [...verts].filter((i) => Math.abs(pos(g, i)[1] * unit - cone.y0) < 1e-3);
  const keyed = new Set(eave.map((i) => key(pos(g, i), 1)));
  assert.ok(keyed.size >= 48, `eave ring has ${keyed.size} points`);
  // untouched: the wall and cap triangles keep their vertices and flat / vertical normals exactly
  for (const [i, row] of wallBefore) { const now = [...pos(g, i), ...nrm(g, i)]; for (let k = 0; k < 6; k++) near(now[k], row[k], 1e-6, `wall / cap vertex ${i} component ${k}`); }
  // no growth of the extent (the original ring vertices stay; the new points are on the same circle)
  g.computeBoundingBox();
  assert.ok((g.boundingBox.max.x - g.boundingBox.min.x) * unit <= 2 * cone.R + 0.004);
});

test('refineRoundRoofs: idempotent, float geometry works, un-indexed geometry works', () => {
  const a = facetedCone({ quant: false }), info = refineRoundRoofs(a.g, { unit: 1 });
  assert.equal(info.surfaces[0].k, 2);
  assert.equal(a.g.attributes.position.array.constructor, Float32Array);
  const n1 = a.g.index.count;
  const again = refineRoundRoofs(a.g, { unit: 1 });
  assert.ok(again.surfaces.every((x) => x.skip), 'nothing left to do: already smooth and fine (or no longer a plain lathe strip)');
  assert.equal(a.g.index.count, n1, 'a second run changes nothing');
  const b = facetedCone({ quant: false }), nonIdx = b.g.toNonIndexed();
  const i2 = refineRoundRoofs(nonIdx, { unit: 1 });
  assert.equal(i2.surfaces.length, 1);
  assert.ok(nonIdx.index, 'comes back indexed');
});

test('refineRoundRoofs: 8-sided spires, pitched roofs, small rings and finished cones are left alone', () => {
  const oct = facetedCone({ N: 8, R: 3 }), before = Array.from(oct.g.index.array);
  assert.equal(refineRoundRoofs(oct.g, { unit: oct.unit }).surfaces.length, 0, 'an octagonal spire is drawn that way');
  assert.deepEqual(Array.from(oct.g.index.array), before);
  const small = facetedCone({ N: 24, R: 0.6, y0: 1, y1: 1.5 });
  assert.equal(refineRoundRoofs(small.g, { unit: small.unit }).surfaces.length, 0, 'a finial / lid under 1 m radius');
  const fine = facetedCone({ N: 64, R: 3 });
  const f = refineRoundRoofs(fine.g, { unit: fine.unit, dry: true });
  assert.equal(f.surfaces[0].k, 1, '64 segments are already enough for 3 m');
  // a gable: two sloped planes, 12 triangles: not a surface of revolution
  const gable = new THREE.BufferGeometry(), pts = [], idx = [];
  const quad = (a, b, c, d) => { const s = pts.length / 3; pts.push(...a, ...b, ...c, ...d); idx.push(s, s + 1, s + 2, s, s + 2, s + 3); };
  for (let k = 0; k < 6; k++) { quad([k, 0, 0], [k + 1, 0, 0], [k + 1, 2, 2], [k, 2, 2]); quad([k, 2, 2], [k + 1, 2, 2], [k + 1, 0, 4], [k, 0, 4]); }
  gable.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  gable.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pts.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  gable.setIndex(idx);
  const gi = Array.from(gable.index.array);
  assert.equal(refineRoundRoofs(gable, { unit: 1 }).surfaces.length, 0);
  assert.deepEqual(Array.from(gable.index.array), gi);
});

test('refineRoundRoofs: a surface the artist shaded smooth keeps his normals (only the tessellation is finer)', () => {
  const cone = facetedCone({ smooth: true, wall: false, caps: false }), { g, unit } = cone;
  // the file's corner normals before: a few vertices to compare
  const before = new Map();
  for (let i = 0; i < g.attributes.position.count; i++) before.set(key(pos(g, i), 1), nrm(g, i));
  const info = refineRoundRoofs(g, { unit });
  assert.equal(info.surfaces.length, 1);
  assert.equal(info.surfaces[0].flat, false, 'smooth as exported');
  assert.equal(info.surfaces[0].k, 2, '24 → 48 segments');
  // every vertex that was already there keeps its normal; the new ones sit between their neighbours' (smooth)
  let kept = 0;
  for (let i = 0; i < g.attributes.position.count; i++) { const n0 = before.get(key(pos(g, i), 1)); if (n0) { assert.ok(ang(nrm(g, i), n0) < 1.5, 'an existing corner keeps its normal'); kept++; } }
  assert.ok(kept >= 24 * 2);
  assert.ok(roofJump(g, unit) < 2.5, `smooth across the new vertices (${roofJump(g, unit).toFixed(2)}°)`);
  const slope = Math.atan2(cone.y1 - cone.y0, cone.R - cone.rTop);
  for (let i = 0; i < g.attributes.position.count; i++) {
    const p = pos(g, i), r = Math.hypot(p[0] * unit - cone.cx, p[2] * unit - cone.cz), dx = (p[0] * unit - cone.cx) / (r || 1), dz = (p[2] * unit - cone.cz) / (r || 1);
    if (r > 0.2 && p[1] * unit > cone.y0 + 0.01 && p[1] * unit < cone.y1 - 0.01) assert.ok(ang(nrm(g, i), [Math.sin(slope) * dx, Math.cos(slope), Math.sin(slope) * dz]) < 2.5, 'a mid-height vertex is on the analytic cone normal');
  }
});

test('refineRoundRoofs: the rolled bead under a dome (a vertical band sharing its base ring) is rounded with it; a cap fan under it is not touched', () => {
  const cone = facetedCone({ bead: 0.4, wall: false }), { g, unit } = cone;
  const info = refineRoundRoofs(g, { unit });
  assert.equal(info.surfaces.length, 1);
  assert.equal(info.surfaces[0].bands, 2, 'the cone and the bead: two bands');
  // the bead's lower ring: 48 points on the circle, normals horizontal
  const low = new Set();
  for (let i = 0; i < g.attributes.position.count; i++) {
    const p = pos(g, i), y = p[1] * unit;
    if (Math.abs(y - (cone.y0 - 0.4)) < 1e-3) {
      const r = Math.hypot(p[0] * unit - cone.cx, p[2] * unit - cone.cz);
      if (Math.abs(r - cone.R) < 0.003) low.add(key(p, 1));
    }
  }
  assert.ok(low.size >= 48, `bead ring has ${low.size} points on the circle (was 24)`);
  let horiz = 0, bead = 0;
  for (let i = 0; i < g.attributes.position.count; i++) { const p = pos(g, i), y = p[1] * unit; if (y < cone.y0 - 0.01 && y > cone.y0 - 0.39 && Math.abs(Math.hypot(p[0] * unit - cone.cx, p[2] * unit - cone.cz) - cone.R) < 0.003) { bead++; if (Math.abs(nrm(g, i)[1]) < 0.05) horiz++; } }
  assert.ok(bead >= 48 && horiz === bead, 'the band is the vertical, round wall it was');
  // the underside fan (24 - 2 triangles) is still there, still flat, facing down
  const I = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let down = 0;
  for (let t = 0; t < I.length; t += 3) { a.fromBufferAttribute(g.attributes.position, I[t]); b.fromBufferAttribute(g.attributes.position, I[t + 1]); c.fromBufferAttribute(g.attributes.position, I[t + 2]); if (b.sub(a).cross(c.sub(a)).normalize().y < -0.999) down++; }
  assert.equal(down, 22, 'the cap fan under the eave (a 24-gon: 22 triangles)');
});

// ------------------------------------------------------------------------------------------------ the building library

const M = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
for (const x of EXTRA_MANIFESTS) mergeManifest(M, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
const load = (name, lod = 0) => new Promise((res, rej) => loader.parse(readGlbArrayBuffer(P(`assets/models/${M.assets[name].lods[lod].url}`)), '', (g) => res(g.scene), rej));

/** Run fn with a stub `document` (applyAssetFixups also loads the camo-net textures, which want an <img>), then put back what was there.
 *  A sibling test (hud-eye) restores `document` by assignment and so leaves an own `document: undefined` behind when it ran in the
 *  same process (CI shards): `'document' in globalThis` is then true, so ask for the method, not the key. */
function withDom(fn) {
  const g = globalThis, had = typeof g.document?.createElementNS === 'function', prev = Object.getOwnPropertyDescriptor(g, 'document');
  if (!had) g.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, set src(v) {} }) };
  try { return fn(); } finally { if (!had) { if (prev) Object.defineProperty(g, 'document', prev); else delete g.document; } }
}

/** The sloped revolution roof meshes of a scene, with their quantisation scale (m per unit). */
function roofs(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const unit = o.matrixWorld.getMaxScaleOnAxis(), r = refineRoundRoofs(o.geometry.clone(), { unit, tol: SAG_TOL[0], dry: true });
    for (const s of r?.surfaces || []) out.push({ o, unit, ...s });
  });
  return out;
}

test('library: the M6 log and stone towers\' cones (24 flat wedges, a 3 m eave 26 mm off round) come out round and smooth', async () => {
  for (const [name, mats] of [['tower_round_log', ['roof_shingle', 'snow']], ['tower_round_stone', ['roof_slate']]]) {
    const scene = await load(name);
    const found = roofs(scene);
    assert.equal(found.length, mats.length, `${name}: ${found.map((f) => f.o.material.name)}`);
    for (const f of found) { assert.equal(f.N, 24); assert.equal(f.k, 2); assert.ok(f.flat, 'flat-shaded as exported'); assert.ok(f.R > 1.5 && f.R < 3.2); }
    const jumpBefore = Math.max(...found.map((f) => roofJump(f.o.geometry, f.unit)));
    assert.ok(jumpBefore > 8, `${name}: ${jumpBefore.toFixed(1)}° between facets as exported`);
    const fixed = withDom(() => applyAssetFixups(scene, name, 0, 'assets/', M.assets[name])); // the way the game applies it
    assert.ok(fixed.includes('round-roofs'), `${name}: fixups ${fixed}`);
    for (const f of roofs(scene)) assert.ok(f.skip, `${name}: nothing left to fix (${JSON.stringify(f)})`);
    scene.traverse((o) => { if (o.isMesh && /roof|snow/.test(o.material.name)) assert.ok(roofJump(o.geometry, o.matrixWorld.getMaxScaleOnAxis()) < 2.5, `${name} ${o.material.name}: smooth`); });
  }
});

test('library: domes, bunker and pillbox roofs: more segments, same attribute layout; LOD 1 gets the same rule at its own tolerance', async () => {
  for (const name of ['house_domed_ms_a', 'hq_domed_terraced_bq', 'bunker_obs_de', 'pillbox_round_be', 'townhouse_corner_turret']) {
    const scene = await load(name);
    const layout = (root) => { const s = new Set(); root.traverse((o) => { if (o.isMesh) s.add(Object.keys(o.geometry.attributes).sort().join(',') + '|' + ['position', 'normal'].map((k) => { const a = o.geometry.attributes[k]; return `${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}/${a.normalized}/${a.isInterleavedBufferAttribute ? a.data.stride : a.itemSize}`; }).join(',')); }); return [...s].sort().join(';'); };
    const lay = layout(scene);
    let tris = 0; scene.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    const found = roofs(scene).filter((f) => !f.skip);
    assert.ok(found.length >= 1, `${name}: a round roof to fix`);
    assert.ok(found.every((f) => f.N >= 12 && f.R >= 1), `${name}`);
    roundRoofs(scene, 0);
    let tris2 = 0; scene.traverse((o) => { if (o.isMesh) tris2 += o.geometry.index.count / 3; });
    assert.ok(tris2 > tris, `${name}: ${tris} → ${tris2} triangles`);
    assert.ok(tris2 - tris < 4000, `${name}: the cost stays small (+${tris2 - tris})`);
    assert.equal(layout(scene), lay, `${name}: attribute layout unchanged`);
    assert.ok(roofs(scene).every((f) => f.skip), `${name}: done`);
  }
});

test('library: a decimated LOD 1 cone (an uneven strip, 10-14 of its 24 sides) shades round too', async () => {
  for (const [name, mats] of [['tower_round_log', /roof_shingle|snow/], ['tower_round_stone', /roof_slate/]]) {
    const scene = await load(name, 1);
    scene.updateMatrixWorld(true);
    let worstBefore = 0, worstAfter = 0, n = 0;
    scene.traverse((o) => { if (o.isMesh && mats.test(o.material.name)) worstBefore = Math.max(worstBefore, roofJump(o.geometry, o.matrixWorld.getMaxScaleOnAxis(), { apex: true })); });
    assert.ok(worstBefore > 8, `${name} LOD 1: flat wedges as exported (${worstBefore.toFixed(1)}°)`);
    roundRoofs(scene, 1);
    scene.traverse((o) => { if (o.isMesh && mats.test(o.material.name)) { n++; worstAfter = Math.max(worstAfter, roofJump(o.geometry, o.matrixWorld.getMaxScaleOnAxis(), { apex: true })); } });
    assert.ok(n >= 1 && worstAfter < 3, `${name} LOD 1: smooth (${worstAfter.toFixed(1)}°)`);
  }
  // an octagonal spire (castle towers) keeps its 8 facets at LOD 1 as it does at LOD 0
  const spire = await load('castle_tower', 1);
  let flatBefore = true;
  spire.updateMatrixWorld(true);
  const found = roofs(spire).filter((f) => !f.skip);
  assert.equal(found.length, 0, 'no 8-sided surface is rounded');
  void flatBefore;
});

test('gameplay measures the authored geometry: a refined roof moves no hull, raster cell, overhead cell, top or cache key', async () => {
  for (const name of ['tower_round_log', 'tower_round_stone', 'house_domed_ms_a', 'pillbox_round_be', 'bunker_obs_de', 'oil_tank_process_ms']) {
    const raw = await load(name), fine = await load(name);
    const n = roundRoofs(fine, 0);
    assert.ok(n >= 1, `${name}: refined`);
    // the drawn geometry is finer and registers the authored one
    let drawn = 0, registered = 0;
    fine.traverse((o) => { if (o.isMesh) { drawn += o.geometry.attributes.position.count; if (hasGameplayGeometry(o.geometry)) registered++; } });
    let rawVerts = 0; raw.traverse((o) => { if (o.isMesh) rawVerts += o.geometry.attributes.position.count; });
    assert.ok(registered >= 1 && drawn > rawVerts, `${name}: ${rawVerts} → ${drawn} vertices drawn, ${registered} meshes registered`);
    const same = (label, a, b) => assert.deepEqual(a, b, `${name}: ${label}`);
    same('visual signature (the key of every cached analysis)', visualSignature(fine), visualSignature(raw));
    same('convex hull', planHull(fine), planHull(raw));
    for (const o of [{ minY: 0.3, maxY: 1.8, cell: 0.25 }, { minY: 0.12, maxY: 0.3, cell: 0.25 }, { minY: 0.15, maxY: 1.2, cell: 0.25, fit: true }, { maxY: 0.6, cell: 0.25 }]) same(`cells ${JSON.stringify(o)}`, planCells(fine, o), planCells(raw, o));
    same('overhead cells', [...overheadCells(fine, { minY: 1.8, maxY: 30, cell: 1 })], [...overheadCells(raw, { minY: 1.8, maxY: 30, cell: 1 })]);
    same('low surfaces', [...lowSurfaces(fine, { maxY: 2.5, cell: 0.25 })], [...lowSurfaces(raw, { maxY: 2.5, cell: 0.25 })]);
    // raycast tops, over the whole footprint and up to the roof (a sample every 0.2 m; the refined bulge would move some)
    const mf = finestMeshes(fine), mr = finestMeshes(raw);
    let diff = 0, hits = 0;
    for (let x = -3.2; x <= 3.2; x += 0.2) for (let z = -3.2; z <= 3.2; z += 0.2) {
      const a = measureTop(fine, x, z, -1, 14, mf), b = measureTop(raw, x, z, -1, 14, mr);
      if (b != null) hits++;
      if (a !== b) diff++;
    }
    assert.ok(hits > 100, `${name}: ${hits} samples hit`);
    assert.equal(diff, 0, `${name}: ${diff} raycast tops differ`);
  }
  // the registry: untouched geometry measures as itself
  const g = new THREE.BufferGeometry();
  assert.equal(gameplayGeometry(g), g);
  assert.equal(hasGameplayGeometry(g), false);
});

test('library: no asset keeps a flat-shaded or coarse round roof (every LOD 0 as the game loads it)', async () => {
  let fixedAssets = 0, surfaces = 0, ms = 0;
  const left = [];
  for (const name of Object.keys(M.assets)) {
    const scene = await load(name, 0);
    const t0 = performance.now();
    const n = roundRoofs(scene, 0);
    ms += performance.now() - t0;
    if (n) { fixedAssets++; surfaces += n; }
    for (const f of roofs(scene)) if (!f.skip) left.push(`${name} ${f.o.material.name} N${f.N} R${f.R}`);
  }
  assert.deepEqual(left, [], 'nothing left to round');
  assert.ok(fixedAssets >= 20 && surfaces >= 25, `${fixedAssets} assets / ${surfaces} surfaces rounded`);
  assert.ok(ms / Object.keys(M.assets).length < 15, `detection + rebuild ${(ms / Object.keys(M.assets).length).toFixed(2)} ms per asset (load budget)`);
});
