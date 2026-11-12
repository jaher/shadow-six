/**
 * Instanced 3D forests (src/art/terrain/tree-lod.js; user 2026-11-10: "No trees are a single billboard. All trees are
 * detailed"): no billboard / impostor path is left; every species' reduced prototypes (treegen TREE_LOD: LOD1 the
 * trees in view, LOD2 the off-screen shadow casters) are whole 3D trees — a trunk (or stems), foliage sprays spread
 * round the crown at many heights and azimuths; the packed vertex data decodes back; the forest's cull draws LOD1 in
 * the view, LOD2 for the shadows that reach into it, nothing else, front to back; the unique trees' quality never
 * takes the reduced paths.
 */
import * as THREE from 'three';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { GeoAcc, generateTree, TREE_QUALITY, TREE_LOD, lodQuality, SPECIES, useThree, treeLook } from '../../src/art/terrain/treegen.js';
import { packLodBank, oct24, rgb24, LodForest, LOD_DEAD, LOD_TEX_W, LOD_SHADOW_BAND } from '../../src/art/terrain/tree-lod.js';

useThree(THREE);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

/** One prototype as vegetation.js grows it (neutral colour), with its look's quality. */
function proto(species, level, o = {}) {
  const sparse = !!(o.leafless || o.burnt || !SPECIES[species].leaf);
  const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
  const info = generateTree(species, 9173 + level, lodQuality(level, sparse), bark, leaf, { x: 0, y: 0, z: 0, tint0: true, ...o }, needle);
  return { H: info.height, kind: 0, bark: bark.count ? bark : null, leaf: leaf.count ? leaf : null, needle: needle.count ? needle : null };
}

/** Foliage cards of an accumulator: centroid of each quad-ish group of 2 triangles (cards are 2- or 4-triangle strips). */
function cards(a) {
  const out = [];
  for (let t = 0; t + 5 < a.idx.length; t += 6) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 6; k++) { const v = a.idx[t + k]; x += a.p[v * 3]; y += a.p[v * 3 + 1]; z += a.p[v * 3 + 2]; }
    out.push([x / 6, y / 6, z / 6]);
  }
  return out;
}

test('no billboard path is left: the impostor module and its bake are gone, nothing draws a camera-facing tree card', () => {
  assert.ok(!existsSync(join(SRC, 'art/terrain/impostors.js')), 'art/terrain/impostors.js removed');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p); } };
  walk(join(SRC, 'art'));
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/bakeImpostors|createImpostorMesh|impostorUniforms|uImpLift/.test(s), `${f}: no impostor code`);
  }
  const veg = readFileSync(join(SRC, 'art/terrain/vegetation.js'), 'utf8');
  assert.ok(/from '\.\/tree-lod\.js'/.test(veg) && /new LodForest\(/.test(veg), 'vegetation draws the trees past the unique budget as the 3D instanced forest');
});

test('the unique trees never take the reduced paths (TREE_QUALITY has none of the LOD knobs)', () => {
  for (const [name, q] of Object.entries(TREE_QUALITY)) {
    for (const k of ['barkLevels', 'roots', 'sprayLen', 'limbs', 'spruceLimbs', 'pineTwigs', 'tierGap']) assert.equal(q[k], undefined, `${name}.${k}`);
  }
  assert.equal(TREE_LOD.length, 2, 'two instanced levels: LOD1 (in view), LOD2 (shadows from off screen)');
});

test('every species, both levels, every look: a 3D tree — trunk / stems and a crown of sprays at many heights and azimuths', () => {
  const looks = [{}, { leafless: true, marc: 0.3 }, { burnt: true }];
  let checked = 0;
  for (const sp of Object.keys(SPECIES)) {
    const S = SPECIES[sp];
    if (S.fallen) continue; // a fallen bough: bark only, on the litter
    for (const look of looks) {
      if (look.leafless && !(S.kind === 'broad' || S.deciduous)) continue;
      if (look.burnt && S.kind === 'bush') continue;
      for (const level of [0, 1]) {
        const P = proto(sp, level, look);
        const tag = `${sp}${look.leafless ? ' bare' : look.burnt ? ' burnt' : ''} LOD${level + 1}`;
        assert.ok(P.bark && P.bark.idx.length / 3 >= 8, `${tag}: a trunk / stems (${P.bark?.idx.length / 3 || 0} bark tris)`);
        // the wood stands up: bark spans most of the plant's height
        let y0 = Infinity, y1 = -Infinity;
        for (let k = 1; k < P.bark.p.length; k += 3) { y0 = Math.min(y0, P.bark.p[k]); y1 = Math.max(y1, P.bark.p[k]); }
        assert.ok(y1 - y0 > P.H * 0.25, `${tag}: the wood rises (${(y1 - y0).toFixed(1)} of ${P.H.toFixed(1)} m)`);
        const fol = P.leaf || P.needle;
        // (no foliage: a burnt or dead crown, or a bare one with no twig sprays — birch: its fine twigs are tubes)
        if (!fol) { assert.ok(look.burnt || look.leafless || !S.leaf, `${tag}: foliage`); assert.ok(P.bark.idx.length / 3 >= (level ? 60 : 150), `${tag}: a branched crown of wood (${P.bark.idx.length / 3} tris)`); checked++; continue; }
        const c = cards(fol);
        const minCards = level === 0 ? (S.kind === 'bush' ? 8 : 12) : 5;
        assert.ok(c.length >= minCards, `${tag}: ${c.length} foliage cards (≥ ${minCards}) — not a single quad`);
        // spread in 3D: heights (thirds of the foliage's own range) and azimuth sectors round the trunk
        let f0 = Infinity, f1 = -Infinity;
        for (const p of c) { f0 = Math.min(f0, p[1]); f1 = Math.max(f1, p[1]); }
        const bands = new Set(c.map((p) => Math.min(2, Math.floor(((p[1] - f0) / Math.max(1e-3, f1 - f0)) * 3))));
        const sectors = new Set(c.filter((p) => Math.hypot(p[0], p[2]) > 0.2).map((p) => Math.floor(((Math.atan2(p[2], p[0]) + Math.PI) / (2 * Math.PI)) * 6) % 6));
        if (!(look.leafless && c.length < 12)) {
          assert.ok(bands.size >= (S.kind === 'palm' ? 2 : 3), `${tag}: foliage at ${bands.size} heights`);
          assert.ok(sectors.size >= 4, `${tag}: foliage in ${sectors.size}/6 azimuth sectors`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 60, `${checked} prototypes checked`);
});

test('LOD1 is a reduced tree, LOD2 less again, both far below the unique tree', () => {
  for (const sp of ['oak', 'beech', 'spruce', 'scots_pine', 'date_palm', 'hedge']) {
    const tris = (P) => ['bark', 'leaf', 'needle'].reduce((n, m) => n + (P[m] ? P[m].idx.length / 3 : 0), 0);
    const b = new GeoAcc(), l = new GeoAcc(), n = new GeoAcc();
    generateTree(sp, 9173, TREE_QUALITY.high, b, l, { x: 0, y: 0, z: 0 }, n);
    const full = (b.idx.length + l.idx.length + n.idx.length) / 3, l1 = tris(proto(sp, 0)), l2 = tris(proto(sp, 1));
    assert.ok(l1 < full * 0.75 && l2 < l1, `${sp}: unique ${full} > LOD1 ${l1} > LOD2 ${l2} triangles`);
  }
});

test('packing: vertices decode back (position, layer, octahedral normal, tint), corners padded to the size class', () => {
  const protos = [proto('oak', 0), proto('hedge', 0), proto('spruce', 0)];
  const bank = packLodBank(protos);
  // octahedral normals: within 0.2°
  const dec = (u) => {
    let x = (u % 4096) / 4095 * 2 - 1, y = Math.floor(u / 4096) / 4095 * 2 - 1;
    const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0);
    x += x >= 0 ? -t : t; y += y >= 0 ? -t : t;
    const L = Math.hypot(x, y, z); return [x / L, y / L, z / L];
  };
  for (const n of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0.6, -0.48, -0.64], [-0.36, 0.48, -0.8]]) {
    const d = dec(oct24(...n));
    assert.ok(d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > Math.cos(THREE.MathUtils.degToRad(0.2)), `normal ${n} → ${d.map((v) => v.toFixed(3))}`);
  }
  const rgb = rgb24(1.13, 0.5, 1.9);
  assert.ok(Math.abs((rgb & 255) / 127.5 - 1.13) < 0.005 && Math.abs(((rgb >> 8) & 255) / 127.5 - 0.5) < 0.005 && Math.abs((rgb >> 16) / 127.5 - 1.9) < 0.005, 'tint 24 bits');
  for (const m of ['bark', 'leaf', 'needle']) {
    const M = bank.mats[m];
    assert.ok(M, `${m} packed`);
    assert.equal(M.vData.length % (LOD_TEX_W * 4), 0, `${m}: whole texture rows`);
    for (const b of M.buckets) for (const i of b.protos) {
      const a = protos[i][m], base = M.base[i];
      assert.ok(a.idx.length <= b.corners, `${m}: a prototype fits its class`);
      // its corners point at its own vertices; the rest of the class's corners are padding
      for (let k = 0; k < a.idx.length; k += 37) {
        const v = M.cData[base + k], o = v * 12;
        assert.ok(v !== LOD_DEAD, 'a real corner');
        assert.ok(Math.abs(M.vData[o] - a.p[a.idx[k] * 3]) < 1e-5 && Math.abs(M.vData[o + 1] - a.p[a.idx[k] * 3 + 1]) < 1e-5, 'position');
        assert.equal(M.vData[o + 3], a.info[a.idx[k] * 4], 'atlas layer');
      }
      for (let k = a.idx.length; k < b.corners; k++) assert.equal(M.cData[base + k], LOD_DEAD, 'padding');
    }
  }
  assert.ok(bank.protos.every((P) => P.r > 1 && P.cy > 0.5), 'bounds round the crown');
});

test('the copies take the colour their seed would have grown as unique trees (treeLook = generateTree\'s own draws)', () => {
  for (const [sp, seed] of [['oak', 77], ['spruce', 9001], ['hedge', 5]]) {
    const L = treeLook(sp, seed), b = new GeoAcc(), l = new GeoAcc(), n = new GeoAcc();
    const info = generateTree(sp, seed, TREE_QUALITY.high, b, l, { x: 0, y: 0, z: 0 }, n);
    assert.ok(Math.abs(info.height - L.H) < 1e-9, `${sp}: same height`);
    // a neutral prototype × the look's tints = the unique tree's vertex tints (bark: the first vertex)
    const b0 = new GeoAcc(), l0 = new GeoAcc(), n0 = new GeoAcc();
    generateTree(sp, seed, TREE_QUALITY.high, b0, l0, { x: 0, y: 0, z: 0, tint0: true }, n0);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(b0.tint[c] * L.tint[c] - b.tint[c]) < 1e-6, `${sp}: bark tint channel ${c}`);
  }
});

test('the forest cull: LOD1 for the trees in view (and their shadows), LOD2 for the shadows reaching in, front to back', () => {
  const protos = [proto('oak', 0), proto('spruce', 0)], protos2 = [proto('oak', 1), proto('spruce', 1)];
  const banks = [packLodBank(protos), packLodBank(protos2)];
  const inst = [];
  // a row of trees along x at z = 0: x -100 … 100
  for (let k = 0; k <= 40; k++) inst.push({ x: -100 + k * 5, y: 0, z: 0, yaw: k, scale: 1, proto: k % 2, phase: k, bark: [1, 1, 1], leaf: [1, 1, 1] });
  const F = new LodForest(banks, inst);
  // an orthographic view of x -20…20 looking straight down; the sun low from +x (shadows fall toward −x)
  const cam = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 400);
  cam.position.set(0, 150, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(100, 30, 0); sun.target.position.set(0, 0, 0); sun.castShadow = true;
  scene.add(sun, sun.target);
  const mesh = new THREE.Mesh(); scene.add(mesh); scene.updateMatrixWorld(true);
  F.light = sun;
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  assert.ok(F.cull(fr, mesh), 'culled');
  assert.ok(!F.cull(fr, mesh), 'cached: the same view does nothing');
  const L1 = F.lists.filter((l) => l.level === 0), L2 = F.lists.filter((l) => l.level === 1);
  const nView = L1.filter((l) => l.mat === 'bark').reduce((s, l) => s + l.nView, 0);
  // in view: |x| ≤ 20 + the crown radius → x from about −30 to 30
  assert.ok(nView >= 9 && nView <= 15, `${nView} trees in view`);
  // shadows: every tree in view casts LOD1's; off screen within LOD_SHADOW_BAND m both levels cast, through
  // complementary dither shares (LOD1's share carried over the phase: phase + 8 · share), LOD2 alone past it
  const share = (l, s) => { const t = l.shadow + s; return Math.floor(F.cur.data[((t >> 9) * 1024 + (t & 511) * 2) * 4 + 6] / 8); };
  const sh1 = [], sh2 = [];
  for (const l of L1.filter((q) => q.mat === 'bark')) for (let k = 0; k < l.nShadow; k++) sh1.push(share(l, k));
  for (const l of L2.filter((q) => q.mat === 'bark')) for (let k = 0; k < l.nShadow; k++) sh2.push(share(l, k));
  assert.equal(sh1.filter((f) => f === 255).length, nView, 'a tree in view casts its whole LOD1 shadow');
  const band = sh1.filter((f) => f < 255);
  assert.ok(band.length > 0 && band.every((f) => f > 0), `trees just off screen cast part of LOD1's shadow (${band.join(', ')})`);
  assert.ok(sh2.every((f) => f < 255) && band.every((f) => sh2.includes(f)), 'and LOD2 casts the rest of theirs');
  const nS2 = sh2.length;
  assert.ok(sh2.filter((f) => f === 0).length > 0, `LOD2 alone: trees off screen on the sun side past the band cast into the view (${nS2})`);
  assert.equal(L2.reduce((s, l) => s + l.nView, 0), 0, 'LOD2 never draws in view');
  // the off-screen casters: the sun's side (+x: their shadows fall into the view) far out; on the other side only
  // crowns just past the edge (their spheres within the PCF filter's reach)
  const D = F.cur.data, xs = [];
  for (const l of L2.filter((q) => q.mat === 'bark')) for (let s = 0; s < l.nShadow; s++) { const t = l.shadow + s; xs.push(D[((t >> 9) * 1024 + (t & 511) * 2) * 4]); }
  assert.ok(Math.max(...xs) > 60 && Math.min(...xs) > -40, `shadow casters from the sun side (x ${Math.min(...xs).toFixed(0)}…${Math.max(...xs).toFixed(0)})`);
  // the texture rows are uploaded where written
  assert.ok(F.cur.texture.updateRanges.length > 0 && F.cur.texture.version > 0, 'instance rows queued for upload');
  // a second view, then the first again: its slot comes back without a cull
  const cull0 = F.stats.culls;
  // front to back: a view tilted along z sees the nearer trees first
  const cam2 = new THREE.OrthographicCamera(-120, 120, 20, -20, 1, 400);
  cam2.position.set(-150, 40, 0); cam2.lookAt(0, 0, 0); cam2.updateMatrixWorld();
  F.cull(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam2.projectionMatrix, cam2.matrixWorldInverse)), mesh);
  const l0 = L1.find((l) => l.mat === 'bark' && l.nView > 3), seen = [], D2 = F.cur.data;
  for (let s = 0; s < l0.nView; s++) { const t = l0.view + s; seen.push(D2[((t >> 9) * 1024 + (t & 511) * 2) * 4]); }
  assert.ok(!F.cull(fr, mesh) && F.stats.culls === cull0 + 1 && F.uLodI.value === F.cur.texture, 'the first view again: its kept instances, no new cull');
  assert.equal(L1.filter((l) => l.mat === 'bark').reduce((s, l) => s + l.nView, 0), nView, 'its counts back');
  assert.ok(seen.every((x, i) => i === 0 || x >= seen[i - 1]), `front to back (x ${seen.slice(0, 5).map((x) => x.toFixed(0))}…)`);
  F.dispose();
});
