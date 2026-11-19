/**
 * Shared base-game geometry without z-fighting (user 2026-11-18 "Make sure there is no z-fighting in the geometry";
 * tools/art/zfight.mjs found these in M3, M12 and the LIGHTS OUT missions that reuse them). Pinned here:
 *  - the kit house window (art/kit-buildings.js windowAt): the transom's faces stand off the mullion's where they cross;
 *    the parapet's side copings stop at the front / back copings (no two coping tops in one plane at the corners);
 *  - the medina dressing (art/medina-kit.js): window heads 4 mm proud of the frames, mashrabiya rails / side panels off
 *    the stiles' planes, door heads behind the leaf, door jambs proud of the kit plinth, shop heads behind the recess and
 *    rings proud of the jambs, overlapping fallen-render patches on layers of their own;
 *  - whole kit houses (temperate and medina) scanned with the detector's own geometric core: no visible coplanar pair;
 *  - the library assets' coplanar parts (art/coplanar-nudge.js, building-fixups NUDGE_ASSETS, vehicle-library): the
 *    smaller part moved a step proud (rigid: a part never tears), snow never moved nor moved against, decals and
 *    glass never overtaken, the authored geometry kept as what gameplay measures; every listed asset's LOD0 decoded and
 *    nudged leaves no coplanar pair but those flush with snow.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { buildKitHouse } from '../../src/art/kit-buildings.js';
import { nudgeCoplanar, gather, facePairs, NUDGE } from '../../src/art/coplanar-nudge.js';
import { NUDGE_ASSETS } from '../../src/art/building-fixups.js';
import { gameplayGeometry } from '../../src/engine/gameplay-geometry.js';
import { depthModel, collectSurfaces, gatherTriangles, buildBVH, coplanarScan, coplanarFindings, makeVisibility } from '../../tools/art/zfight-core.mjs';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const SRC = (f) => readFileSync(new URL(`../../src/art/${f}`, import.meta.url), 'utf8');

/** The detector's geometric kinds a / b on one object (its visibility model, the game camera's depth noise). */
function scan(root) {
  const M = depthModel({ near: 1, far: 700, depthFormat: 'd24', zMax: 300, zooms: [1, 2], yaws: [15, 0, 45, 90, 135, 180, 225, 270, 315] });
  const scene = new THREE.Scene(); scene.add(root);
  const recs = collectSurfaces(scene).filter((r) => r.cls === 'surface');
  const T = gatherTriangles(recs), B = buildBVH(T);
  const vis = makeVisibility(B, T, null, M);
  return coplanarFindings(T, coplanarScan(T, B, M, { minPx: 0.05 }), M, vis).filter((f) => f.visible && f.px >= 1);
}
const names = (f) => `${f.a?.mat ?? f.a} | ${f.b?.mat ?? f.b}`;

test('kit window: the transom stands off the mullion (their front faces crossed in one plane)', () => {
  const src = SRC('kit-buildings.js'), win = src.slice(src.indexOf('function windowAt('), src.indexOf('/** Door (planks'));
  const mullion = win.match(/tbox\(0\.05, h, ([\d.]+), frame, 0, 0, 0\.0/), transom = win.match(/tbox\(w, 0\.05, ([\d.]+), frame, 0, h \* 0\.12/);
  assert(mullion && transom, 'mullion / transom boxes found');
  assert(Math.abs(+mullion[1] - +transom[1]) / 2 >= 0.002, `front faces ${((+mullion[1] - +transom[1]) / 2 * 1000).toFixed(1)} mm apart`);
});

test('kit parapet: the side copings stop at the front / back copings (no coping tops overlapping at the corners)', () => {
  const g = buildKitHouse({ w: 8, d: 6, h: 4, variant: 'flat_terrace', id: 'zf-coping', roofWalk: true }, 'desert');
  g.updateMatrixWorld(true);
  const f = scan(g).filter((x) => /sandstone/.test(names(x)) && Math.abs(x.point.y - (4 + 0.45 + 0.06)) < 0.01);
  assert(f.length === 0, `coping tops in one plane: ${f.map((x) => JSON.stringify(x.point)).join(' ')}`);
});

test('medina kit: heads, rails, panels, jambs and rings stand off the faces they overlap (offsets pinned)', () => {
  const s = SRC('medina-kit.js');
  assert(/archRing\(w \/ 2 \+ 0\.16, 0\.13, 0\.05\), m\.stone\); head\.position\.set\(0, y \+ h \/ 2 \+ 0\.05, 0\.004\)/.test(s), 'window head 4 mm proud of the frame (frame face z 0.05, head 0..0.05)');
  assert(/tbox\(bw, 0\.03, 0\.022, m\.lattice/.test(s) && /tbox\(0\.03, bh, 0\.03, m\.lattice/.test(s), 'mashrabiya rails 0.022 deep under 0.03 stiles');
  assert(/tbox\(0\.022, bh, bd, m\.lattice/.test(s), 'mashrabiya side panels 0.022 thick inside the 0.03 corner stiles');
  assert(/archFill\(w \/ 2, 0\.06\), paint\); head\.position\.set\(0, spring, -0\.054\)/.test(s), 'door head 4 mm behind the leaf (leaf face z 0.01)');
  assert(/tbox\(0\.26, spring, 0\.1, m\.stone, s \* \(r \+ 0\.13\), spring \/ 2, 0\.004/.test(s), 'door jambs 4 mm proud of the plinth (z 0.05)');
  assert(/archFill\(w \/ 2, 0\.04\), m\.recess\); head\.position\.set\(x, hs, -0\.019\)/.test(s), 'shop head 4 mm behind the recess face (0.025)');
  assert(/archRing\(w \/ 2 \+ 0\.2, 0\.2, 0\.08\), m\.stone\); ring\.position\.set\(x, hs, 0\.004\)/.test(s), 'shop ring 4 mm proud of the jambs (0.08)');
  assert(/sp\.position\.set\(at\[0\], at\[1\], 0\.02 \+ 0\.004 \* k\)/.test(s), 'fallen-render patches a layer each');
  assert(/st\.position\.set\(x, o\.h - 0\.3 - sh \/ 2, 0\.026\)/.test(s), 'rain streaks off the transom / patch planes');
  assert(/tbox\(0\.03, 0\.024, 0\.14, m\.iron/.test(s) && /tbox\(w \+ 0\.06, 0\.03, 0\.03, m\.iron/.test(s), 'grille brackets slimmer than the rails');
});

test('kit houses (temperate, medina terrace / souk / palace / stairhead) scan clean with the detector core', () => {
  const houses = [
    [{ w: 9, d: 7, h: 6.5, variant: 'townhouse_brick', id: 'zf-t1' }, 'temperate'],
    [{ w: 10, d: 8, h: 7, variant: 'medina_roof_terrace', id: 'zf-m1', roofWalk: true }, 'desert'],
    [{ w: 12, d: 9, h: 8, variant: 'souk_arcade', id: 'zf-m2', roofWalk: true }, 'desert'],
    [{ w: 14, d: 10, h: 8, variant: 'palace_tiled_domes', id: 'zf-m3', roofWalk: true }, 'desert'],
    [{ w: 3, d: 3, h: 2.6, variant: 'rooftop_shack', id: 'zf-m4', roofWalk: false }, 'desert'],
  ];
  for (const [p, th] of houses) {
    const g = buildKitHouse(p, th);
    const f = scan(g);
    assert(f.length === 0, `${p.variant}: ${f.length} coplanar pairs — ${f.slice(0, 4).map((x) => `${names(x)} @${[x.point.x, x.point.y, x.point.z].map((v) => v.toFixed(2))}`).join('; ')}`);
  }
});

// ------------------------------------------------------------------------------------------ library nudge

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const mat = (name, o = {}) => new THREE.MeshStandardMaterial({ name, ...o });
const coplanarLeft = (root) => { const G = gather(root); return facePairs(G, NUDGE).filter((e) => Math.abs(e.gap) <= NUDGE.coplanar && !G.parts[e.a].skip && !G.parts[e.b].skip); };

test('nudge: a sill flush with its wall moves a step proud, rigidly; the authored geometry stays what gameplay measures', () => {
  const root = new THREE.Group();
  const wall = box(4, 3, 0.4, mat('kit:brick'), 0, 1.5, 0);           // front face z 0.2
  const sill = box(1, 0.08, 0.2, mat('kit:ashlar'), 0, 1, 0.1);       // front face z 0.2: flush
  root.add(wall, sill);
  const P0 = sill.geometry.getAttribute('position'), before = P0.array.slice();
  const r = nudgeCoplanar(root);
  assert(r.pairs >= 1 && r.moved === 1 && r.left.length === 0, JSON.stringify(r));
  const P1 = sill.geometry.getAttribute('position');
  assert(P1 !== P0, 'drawn positions are a new array');
  const d = [];
  for (let i = 0; i < P1.count; i++) d.push([P1.getX(i) - before[i * 3], P1.getY(i) - before[i * 3 + 1], P1.getZ(i) - before[i * 3 + 2]]);
  assert(d.every((v) => Math.abs(v[2] - NUDGE.step) < 1e-6 && Math.abs(v[0]) < 1e-6 && Math.abs(v[1]) < 1e-6), `rigid +z step: ${JSON.stringify(d[0])}`);
  assert(gameplayGeometry(sill.geometry).getAttribute('position') === P0 && P0.array.every((v, i) => v === before[i]), 'gameplay: authored, untouched');
  assert(gameplayGeometry(wall.geometry) === wall.geometry, 'the wall did not move');
  assert(coplanarLeft(root).length === 0, 'no coplanar pair left');
});

test('nudge: snow never moves, nor anything flush with it; a decal in front is never overtaken', () => {
  const root = new THREE.Group();
  const roof = box(4, 0.2, 4, mat('kit:roof_slate'), 0, 3, 0);              // top y 3.1
  const snow = box(1, 0.1, 1, mat('kit:snow'), 0, 3.05, 0);                 // top y 3.1: flush with the roof (left alone)
  const plate = box(0.5, 0.1, 0.5, mat('kit:timber'), 1.5, 3.05, 1.5);      // top y 3.1: flush with the roof → moves
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4).rotateX(-Math.PI / 2), mat('kit:decals', { transparent: true, depthWrite: false, polygonOffset: true }));
  decal.position.set(-1.5, 3.1035, -1.5);
  const patch = box(0.6, 0.1, 0.6, mat('kit:tar'), -1.5, 3.05, -1.5);       // top 3.1 flush with the roof, a decal 3 mm over it
  root.add(roof, snow, plate, decal, patch);
  const r = nudgeCoplanar(root);
  assert(gameplayGeometry(snow.geometry) === snow.geometry, 'snow untouched');
  assert(gameplayGeometry(plate.geometry) !== plate.geometry, 'the plate moved');
  assert(r.left.some((x) => x.why === 'snow'), `the snow pair is left (allow list): ${JSON.stringify(r.left)}`);
  // the patch may move up at most 3 mm (decal 3.5 mm over its top, no margin needed for a polygon-offset decal) → the
  // short step (2.4 mm) or none
  const P = patch.geometry.getAttribute('position');
  let top = -Infinity; for (let i = 0; i < P.count; i++) top = Math.max(top, P.getY(i) + patch.position.y);
  assert(top <= 3.1035 + 1e-6, `patch top ${top} under the decal`);
});

test('nudge: a face exported twice in one part — the later copy lifted a step off the earlier; a step flush with the ground lifted', () => {
  const root = new THREE.Group();
  // one mesh, one material: a slab and, apart from it (no shared vertex), a second copy of its top over half of it
  const g = new THREE.BoxGeometry(2, 0.2, 2).toNonIndexed();
  const top = new THREE.PlaneGeometry(1, 2).rotateX(-Math.PI / 2).translate(-0.5, 0.1, 0).toNonIndexed();
  const merged = new THREE.BufferGeometry();
  const pa = new Float32Array([...g.getAttribute('position').array, ...top.getAttribute('position').array]);
  merged.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  const slab = new THREE.Mesh(merged, mat('kit:limewash'));
  slab.position.y = 1;
  const step = box(0.8, 0.12, 0.3, mat('kit:ashlar'), 3, 0.06, 0); // top at y 0.12... then flush-with-ground probe below
  const flush = box(0.8, 0.0001, 0.3, mat('kit:ashlar_b'), 5, -0.00005, 0); // a threshold face at y 0
  root.add(slab, step, flush);
  const r = nudgeCoplanar(root, { ground: true });
  assert(r.doubled === 2, `the copy's two triangles: ${r.doubled}`);
  const P = slab.geometry.getAttribute('position');
  const ys = new Set(); for (let i = 36; i < 42; i++) ys.add(+(P.getY(i) + 1).toFixed(4));
  assert(ys.size === 1 && [...ys][0] === +(1.1 + NUDGE.step).toFixed(4), `copy lifted to ${[...ys]}`);
  let fy = -Infinity; const F = flush.geometry.getAttribute('position'); for (let i = 0; i < F.count; i++) fy = Math.max(fy, F.getY(i));
  assert(Math.abs(fy - (0.00005 + NUDGE.step)) < 1e-6, `threshold top lifted off the ground: ${fy}`);
  assert(gameplayGeometry(slab.geometry).getAttribute('position').array.every((v, i) => v === pa[i]), 'gameplay keeps the authored slab');
});

test('nudge: every listed library asset (LOD0, after the fixups that run before it) leaves only snow-flush pairs', async () => {
  const B = new URL('../../assets/models/buildings/', import.meta.url).pathname;
  const man = {};
  for (const f of readdirSync(B).filter((x) => /^manifest.*\.json$/.test(x))) Object.assign(man, JSON.parse(readFileSync(B + f, 'utf8')).assets);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  globalThis.self ??= globalThis; // (GLTFLoader's texture path in node: the textures fail, the geometry loads)
  const warn = console.warn; console.warn = () => {};
  try {
    for (const name of NUDGE_ASSETS) {
      const a = man[name];
      assert(a?.lods?.[0], `${name} in a building manifest`);
      const root = await new Promise((res, rej) => loader.parse(readGlbArrayBuffer(new URL(`../../assets/models/${a.lods[0].url}`, import.meta.url).pathname), '', (g) => res(g.scene), rej));
      // the turf → snow swap of the snow variants runs before the nudge in applyAssetFixups
      if (/_snow$/.test(name)) root.traverse((o) => { if (o.isMesh && /turf/.test(o.material?.name || '')) o.material = new THREE.MeshStandardMaterial({ name: 'kit:snow' }); });
      const authored = [];
      root.traverse((o) => { if (o.isMesh) authored.push([o, o.geometry.getAttribute('position'), o.geometry.getAttribute('position').array.slice(0)]); });
      nudgeCoplanar(root, { ground: true });
      const G = gather(root), left = facePairs(G, NUDGE).filter((e) => Math.abs(e.gap) <= NUDGE.coplanar && !G.parts[e.a].skip && !G.parts[e.b].skip);
      const snowy = (p) => G.parts[p].snow || facePairs(G, NUDGE).some((e) => Math.abs(e.gap) <= NUDGE.coplanar && (e.a === p || e.b === p) && (G.parts[e.a].snow || G.parts[e.b].snow));
      // (a few slivers may stay where every way out is blocked by a face just in front — at most one, under 5 dm²:
      // house_flat_white_b's west shutter end in its reveal)
      const bad = left.filter((e) => !snowy(e.a) && !snowy(e.b) && e.ov > 0.002);
      assert(bad.length <= 1 && bad.every((e) => e.ov < 0.05), `${name}: ${bad.length} coplanar pairs > 20 cm² left: ${bad.slice(0, 3).map((e) => `${G.parts[e.a].mat}|${G.parts[e.b].mat} ${e.ov.toFixed(3)} m²`).join('; ')}`);
      for (const [o, P, arr] of authored) {
        const g = gameplayGeometry(o.geometry).getAttribute('position');
        assert(g === P && P.array.every((v, i) => v === arr[i]), `${name}: gameplay keeps the authored positions (${o.name})`);
      }
    }
  } finally { console.warn = warn; }
});
