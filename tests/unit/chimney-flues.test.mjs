/**
 * Open chimney flues (art/chimney-flues.js; user 2026-10-15: "Looking at mission 3 the chimneys are covered by snow.
 * They should have kind of a hole for smoke to flow out"). Every chimney / stovepipe top of the building library, as the
 * game loads it (GLB → art/building-fixups.js): a dark opening, no snow (nor cap, pot top, decal) over it, the rim /
 * coping round it kept, the smoke at its mouth; the procedural stacks (render/fx.js placeholder, art/kit-buildings.js)
 * open the same way.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeManifest, EXTRA_MANIFESTS, loadBuildingLibrary } from '../../src/art/building-library.js';
import { openChimneyFlues, isFlueAnchor, smokePoints, flueMouths, resetFlues, fluedStackGeometry, SOOT } from '../../src/art/chimney-flues.js';
import { FX } from '../../src/render/fx.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const M = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
for (const x of EXTRA_MANIFESTS) mergeManifest(M, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
const load = (name, lod) => new Promise((res, rej) => loader.parse(readGlbArrayBuffer(P(`assets/models/${M.assets[name].lods[lod].url}`)), '', (g) => res(g.scene), rej));
const NAMES = Object.keys(M.assets).filter((n) => (M.assets[n].anchors || []).some(isFlueAnchor));
/** Wrecks whose stack top / pipe went with the blast: no flue to open. */
const NO_TOP = new Set(['bunker_destroyed#0', 'townhouse_row_a_ruin#1', 'hq_log_flatroof_destroyed#0']);

const ray = new THREE.Raycaster();
/** First hit straight down from (x, y, z): its height, vertex colour, material. */
function down(root, x, y, z, far = 3) {
  ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0)); ray.far = far;
  const h = ray.intersectObject(root, true)[0];
  if (!h) return null;
  const C = h.object.geometry.attributes.color, f = h.face;
  return { y: h.point.y, col: C ? (C.getX(f.a) + C.getX(f.b) + C.getX(f.c)) / 3 : 1, mat: h.object.material.name, snow: /(^|:)snow/.test(h.object.material.name) };
}
const centre = (hole) => hole.reduce((a, p) => [a[0] + p[0] / hole.length, a[1] + p[1] / hole.length], [0, 0]);

/** The opening is clear and dark, and the rim round it is not. Returns failure strings. */
function checkFlue(root, name, lod, f) {
  const bad = [], [cx, cz] = centre(f.hole), tag = `${name} L${lod} ${f.kind}@${cx.toFixed(2)},${cz.toFixed(2)}`;
  // the opening, seen from above (a pipe: from under its rain hat): centre and towards every corner → the liner floor
  const y0 = f.kind === 'pipe' ? f.mouth[1] + 0.06 : f.top + 0.6;
  for (const k of [0, 0.6]) for (const p of k ? f.hole : [f.hole[0]]) {
    const x = cx + (p[0] - cx) * k, z = cz + (p[1] - cz) * k, h = down(root, x, y0, z);
    if (!h || h.col > 0.15) bad.push(`${tag}: opening at ${k} not dark (${JSON.stringify(h)})`); // (a liner may live in the snow mesh: dark)
    else if (h.y > f.top - 0.08) bad.push(`${tag}: opening shallow (${(f.top - h.y).toFixed(3)} m)`);
  }
  // the smoke's mouth: right over the opening, under the rim
  if (!(f.mouth[1] <= f.top && f.mouth[1] > f.floor + 0.05)) bad.push(`${tag}: mouth ${f.mouth[1].toFixed(3)} not in the opening (${f.floor.toFixed(3)}..${f.top.toFixed(3)})`);
  // the rim: just outside every edge (a pipe: its lip) → a lit surface at the mouth's height (3 rays an edge, 2 must hit:
  // a ray can slip through a seam of the quantised cut, 0.4 mm wide)
  for (let i = 0; i < f.hole.length; i++) {
    const a = f.hole[i], b = f.hole[(i + 1) % f.hole.length], hits = [];
    for (const t of [0.3, 0.5, 0.7]) {
      const mx = a[0] + (b[0] - a[0]) * t, mz = a[1] + (b[1] - a[1]) * t, d = Math.hypot(mx - cx, mz - cz) || 1, o = f.kind === 'stack' ? 0.03 : 0.011;
      const h = down(root, mx + ((mx - cx) / d) * o, (f.kind === 'pipe' ? f.mouth[1] + 0.06 : f.top + 0.6), mz + ((mz - cz) / d) * o);
      hits.push(!!h && h.col >= 0.15 && Math.abs(h.y - f.top) <= 0.25);
    }
    if (hits.filter(Boolean).length < 2) bad.push(`${tag}: rim at edge ${i} (${hits})`);
  }
  return bad;
}

/** No snow triangle lies over the opening (above its floor). */
function snowOver(root, f) {
  const hole = f.hole.map(([x, z]) => ({ x, z })), v = new THREE.Vector3(), n = [];
  const inside = (x, z) => hole.every((p, i) => { const q = hole[(i + 1) % hole.length]; return (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x) > 1e-3 * Math.hypot(q.x - p.x, q.z - p.z); });
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/(^|:)snow/.test(o.material.name)) return;
    const Pp = o.geometry.attributes.position, I = o.geometry.index, C = o.geometry.attributes.color;
    for (let t = 0; t < I.count; t += 3) {
      if (C && C.getX(I.getX(t)) + C.getX(I.getX(t + 1)) + C.getX(I.getX(t + 2)) < 0.45) continue; // a liner in the snow mesh
      let x = 0, y = 0, z = 0, lo = Infinity;
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(Pp, I.getX(t + k)).applyMatrix4(o.matrixWorld); x += v.x / 3; y += v.y / 3; z += v.z / 3; lo = Math.min(lo, v.y); }
      if (lo > f.floor && inside(x, z)) n.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]);
    }
  });
  return n;
}

test('flues: every chimney / stovepipe top of the library (LOD0) is open — dark opening, no snow over it, rim kept, smoke at its mouth', async () => {
  let flues = 0, anchors = 0, snowy = 0;
  const bad = [];
  for (const name of NAMES) {
    const a = M.assets[name], root = await load(name, 0);
    const out = openChimneyFlues(root, a.anchors);
    root.updateMatrixWorld(true);
    a.anchors.forEach((an, j) => {
      if (!isFlueAnchor(an)) return;
      anchors++;
      if (!out.some((f) => f.anchors.includes(j)) && !NO_TOP.has(`${name}#${j}`)) bad.push(`${name}: no flue at anchor ${j} (${an.kind})`);
    });
    for (const f of out) {
      flues++;
      if (!f.lined) bad.push(`${name}: ${f.kind} flue without its liner`);
      bad.push(...checkFlue(root, name, 0, f));
      const s = snowOver(root, f);
      if (/_snow$/.test(name)) snowy++;
      if (s.length) bad.push(`${name}: snow over the ${f.kind} opening at ${JSON.stringify(s.slice(0, 2))}`);
    }
  }
  assert.ok(flues >= 210 && anchors >= 165, `${flues} flues at ${anchors} anchors`);
  assert.ok(snowy >= 25, `snow variants checked (${snowy} flues)`);
  assert.deepEqual(bad, [], bad.slice(0, 30).join('\n'));
});

test('flues: the coarser LODs open the chimneys they still model (zoom 0.5 / preset low), never a half-open one', async () => {
  const bad = [];
  let n = 0;
  for (const name of NAMES) for (const lod of [1, 2]) {
    if (!M.assets[name].lods[lod]) continue;
    const root = await load(name, lod);
    for (const f of openChimneyFlues(root, M.assets[name].anchors)) { n++; bad.push(...checkFlue(root, name, lod, f)); if (snowOver(root, f).length) bad.push(`${name} L${lod}: snow over the opening`); }
  }
  assert.ok(n >= 200, `${n} flues on LOD1/2`);
  assert.deepEqual(bad, [], bad.slice(0, 30).join('\n'));
});

test('flues: M3\'s chimneys (log cabins a/b, the admin house) — a flue through the snow-capped cap, rim of snow kept round it', async () => {
  for (const name of ['log_cabin_b_snow', 'log_cabin_a_snow', 'house_timber_c_snow']) {
    const root = await load(name, 0), [f] = openChimneyFlues(root, M.assets[name].anchors);
    assert.equal(f.kind, 'stack', name);
    const xs = f.hole.map((p) => p[0]), zs = f.hole.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    assert.ok(w > 0.3 && d > 0.3 && w < 0.6 && d < 0.6, `${name}: flue ${w.toFixed(2)} × ${d.toFixed(2)} m`);
    assert.ok(f.top - f.floor > 0.3, `${name}: ${(f.top - f.floor).toFixed(2)} m deep`);
    // the snow on the cap stays on the coping: just outside the flue the top is snow
    const [cx, cz] = centre(f.hole), h = down(root, Math.max(...xs) + 0.05, f.top + 0.6, cz);
    assert.ok(h.snow && Math.abs(h.y - f.top) < 0.05, `${name}: snow on the coping (${JSON.stringify(h)})`);
    assert.ok(down(root, cx, f.top + 0.6, cz).col <= SOOT.top + 0.01, `${name}: sooty flue`);
  }
});

test('flues: opened once per template by the asset fixups; the smoke rises from the mouth (one per stack; a stack with pots from one pot)', async () => {
  try {
    await loadBuildingLibrary(null, { manifest: M });
    const name = 'log_cabin_b_snow', root = await load(name, 0);
    assert.equal(openChimneyFlues(root, M.assets[name].anchors, { name, lod: 0 }).length, 1);
    const [f] = flueMouths(name);
    assert.deepEqual(smokePoints(name, M.assets[name].anchors), [{ pos: f.mouth, mouth: true }]);
    // placed like art/building-props.js libraryVisual: the mouth moves with the instance, flagged (no seating ray)
    const outer = new THREE.Group(), fit = new THREE.Group(), turn = new THREE.Group(), model = new THREE.Group();
    outer.position.set(40, 0, 25); outer.rotation.y = -0.7; fit.scale.set(1.1, 1.05, 0.95); turn.rotation.y = -Math.PI / 2; model.userData.building = name;
    outer.add(fit); fit.add(turn); turn.add(model); outer.updateMatrixWorld(true);
    const [p] = FX.chimneyPoints(outer), want = new THREE.Vector3(...f.mouth).applyMatrix4(model.matrixWorld);
    assert.ok(p.mouth && p.distanceTo(want) < 1e-6, `${p.toArray()} vs ${want.toArray()}`);
    // the finest LOD's mouths are kept
    openChimneyFlues(await load(name, 1), M.assets[name].anchors, { name, lod: 1 });
    assert.equal(flueMouths(name)[0], f);
    // two anchors on one stack (mine_office_de: 'chimney' + 'smoke') smoke once; a 3-pot stack smokes from one pot
    const mo = await load('mine_office_de', 0), fm = openChimneyFlues(mo, M.assets.mine_office_de.anchors, { name: 'mine_office_de' });
    assert.equal(fm.length, 1); assert.deepEqual(fm[0].anchors, [0, 1]);
    assert.equal(smokePoints('mine_office_de', M.assets.mine_office_de.anchors).length, 1);
    const th = await load('townhouse_corner_w', 0), ft = openChimneyFlues(th, M.assets.townhouse_corner_w.anchors, { name: 'townhouse_corner_w' });
    const sp = smokePoints('townhouse_corner_w', M.assets.townhouse_corner_w.anchors);
    assert.equal(sp.length, 4, 'four stacks, four plumes');
    for (const q of sp) assert.ok(ft.some((x) => x.kind === 'pot' && x.mouth === q.pos), 'each from one of its pots');
  } finally { resetFlues(); }
});

test('flues: a rain hat sitting on its stovepipe is lifted clear of the open pipe and sooted; a raised one stays', async () => {
  const hut = await load('hut_timber_barrack_a', 0), [f] = openChimneyFlues(hut, M.assets.hut_timber_barrack_a.anchors);
  assert.equal(f.kind, 'pipe'); assert.ok(Math.abs(f.lift - 0.08) < 1e-6, `lift ${f.lift}`);
  const nor = await load('barracks_b_snow', 0), fl = openChimneyFlues(nor, M.assets.barracks_b_snow.anchors);
  assert.equal(fl.length, 2); for (const q of fl) assert.equal(q.lift, 0, 'the Norwegian hat stands 12 cm over its pipe already');
  // the hat shades the pipe from straight above, but just over the pipe's mouth the flue is dark
  nor.updateMatrixWorld(true);
  const [cx, cz] = centre(fl[0].hole);
  assert.ok(down(nor, cx, fl[0].top + 0.5, cz).col < 0.6, 'sooted hat');
  assert.ok(down(nor, cx, fl[0].mouth[1] + 0.06, cz).col < 0.15, 'open pipe');
});

test('flues: procedural stacks (placeholder / kit) — coping round a lined flue, nothing over it', () => {
  const { outer, liner, mouth } = fluedStackGeometry({ w: 0.6, d: 0.6, y0: 3, y1: 4.5, t: 0.13, depth: 0.45 });
  const o = new THREE.Mesh(outer, new THREE.MeshBasicMaterial()), l = new THREE.Mesh(liner, new THREE.MeshBasicMaterial());
  const g = new THREE.Group(); g.add(o, l); g.updateMatrixWorld(true);
  ray.set(new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, -1, 0)); ray.far = 10;
  const hit = ray.intersectObject(g, true)[0];
  assert.equal(hit.object, l, 'straight down the flue: the liner floor');
  assert.ok(Math.abs(hit.point.y - (4.5 - 0.45)) < 1e-6 && Math.abs(mouth.floor - 4.05) < 1e-9);
  ray.set(new THREE.Vector3(0.3, 6, 0.3), new THREE.Vector3(0, -1, 0));
  const rim = ray.intersectObject(g, true)[0];
  assert.ok(rim.object === o && Math.abs(rim.point.y - 4.5) < 1e-6, 'the coping');
  // every liner face faces into the flue (seen from its axis)
  const N = liner.attributes.normal, Pp = liner.attributes.position;
  for (let i = 0; i < N.count; i++) {
    if (Math.abs(N.getY(i)) < 0.5) assert.ok(N.getX(i) * -Pp.getX(i) + N.getZ(i) * -Pp.getZ(i) > 0, 'inward');
    else assert.equal(N.getY(i), -1, 'the floor shades as a pit (no top-facing prop snow)');
  }
});
