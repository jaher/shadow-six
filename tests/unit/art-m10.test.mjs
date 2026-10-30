/** M10 art pass (El Agheila, "Operation Icarus"): the El Agheila add-on, each structure's own build fitted to its
 *  footprint, the gameplay walls of the sheds and blast walls kept (drawn by art twins), the mud-brick compound walls,
 *  the cage door's mesh leaf, and the set dressing clear of the routes, the tank drives and the Ju 52's take-off.
 *  Pass 2 (art/m10-dressing.js): the rim wire drawn on the shelf, the dugout's earth inside its sandbag rim, the landing
 *  ground on the shelf top, the burnt-out armoured car, the dump and the graves. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { glbJson } from '../../tools/glb-io.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';
import { PZ24_ROUTE, PZ22_LOOP } from '../../src/missions/m10_operation_icarus.js';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { buildWireLayer } from '../../src/art/wire-obstacles.js';
import { buildAirstrip } from '../../src/art/airstrip.js';
import { buildProp } from '../../src/art/props.js';
import { M10_AIRSTRIP, M10_DRESSING } from '../../src/art/m10-dressing.js';
import { SHELF_Y } from '../../src/missions/scripts/m10.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-el-agheila';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm10'); try { return await fn(); } finally { await useManifest(null); } };
const m10 = MISSIONS.find((m) => m.id === 'm10');
const S = (id) => m10.structures.find((s) => s.id === id);
const OWN = ['tank_shed_ic_a', 'tank_shed_ic_b', 'tank_shed_ic_c', 'tank_shed_ic_d', 'store_domed_ic', 'barracks_corr_ic', 'windpump_ic', 'revetment_ic',
  'sentry_hut_ic', 'arch_gate_mud_ic', 'arch_mud_ic', 'dugout_log_ic', 'aircraft_wreck_ic', 'tent_pyramid_ic'];
const pick = (s) => pickAsset(s.type, s, { theater: 'desert', missionId: 'm10' });

test('art m10: the El Agheila add-on ships every LOD, sidecar and texture, desert, under its own types only', () => {
  assert.ok(EXTRA_MANIFESTS.includes(ADDON));
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  const alias = base().textures.aliases;
  const found = (u) => existsSync(u) || (alias[u.pathname.split('/').pop()] && existsSync(new URL(alias[u.pathname.split('/').pop()], u)));
  for (const n of [...OWN, 'store_domed_ic_destroyed']) {
    const a = add.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) {
      assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
      const j = glbJson(P(`assets/models/${l.url}`)); // gzip-wrapped on disk: read the JSON chunk through glb-io
      const uris = [...(j.images || []), ...(j.buffers || [])].map((x) => x.uri).filter((u) => u && !/^data:/.test(u));
      for (const u of uris) assert.ok(found(new URL(u, P(`assets/models/${l.url}`))), `${l.url} → ${u}`);
    }
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('desert'), n);
  }
  const b = base(), m = merged();
  for (const t of ['house', 'barracks', 'hut', 'bunker', 'tank_shed', 'crates', 'barrels', 'gate', 'ruins', 'radio_mast'])
    assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m10: every asset-picked structure takes its own build, fitted to the gameplay footprint (≤ 12 % per axis)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m10.structures.filter((q) => q.asset)) {
    const pk = pick(s);
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(2)}×${ed.toFixed(2)} on ${w}×${d}`);
    assert.equal(s.nav, false, `${s.id}: gameplay nav, not the build's`);
  }
  for (const n of OWN) assert.ok(seen.has(n), `${n} used`);
  for (const s of m10.structures) {
    const pk = pick(s);
    if (pk) assert.doesNotMatch(pk.name, /log_cabin|house_timber|norway|_snow$|brick_be|mosan|wall_octagon_gate/, s.id);
  }
  assert.equal(pick(S('pen_gate')), null, 'the cage door is the mesh leaf, not a library gatehouse');
}));

test('art m10: sheds and blast walls keep their gameplay walls (drawn by art twins with no block); the gate keeps its passage', () => {
  for (const id of ['shed_1', 'shed_2', 'shed_3', 'shed_4', 'shed_5', 'wall_a', 'wall_b']) {
    const s = S(id);
    assert.equal(s.type, 'wall', id);
    assert.equal(s.visual, false, id);
    const twins = m10.structures.filter((q) => q.clipAllow?.includes(id) && q.asset);
    assert.ok(twins.length >= 1, `${id} art twin`);
    for (const t of twins) assert.ok(t.block === 0 && t.nav === false, t.id);
  }
  // the panels cover each blast-wall run end to end
  for (const id of ['wall_a', 'wall_b']) for (const [[ax, az], [bx, bz]] of S(id).segments) {
    const L = Math.hypot(bx - ax, bz - az);
    const on = m10.structures.filter((q) => q.asset === 'revetment_ic' && q.clipAllow[0] === id && Math.abs((q.z - az) * (bx - ax) - (q.x - ax) * (bz - az)) / L < 0.05);
    assert.ok(Math.abs(on.reduce((a, q) => a + q.w, 0) - L) < 0.05, `${id} run ${L.toFixed(1)} m covered`);
  }
  // each shed's art faces its open side: front (local +z) heading = the open side's outward heading
  for (const [id, open] of [['shed_1', 'S'], ['shed_2', 'W'], ['shed_3', 'E'], ['shed_4', 'E'], ['shed_5', 'W']]) {
    const t = S(`${id}_art`), h = { N: 333 - 90, E: 333, S: 333 + 90, W: 333 + 180 }[open];
    const d = ((t.rot * 180) / Math.PI + 90 - h) % 360;
    assert.ok(Math.abs(d) < 1e-6 || Math.abs(Math.abs(d) - 360) < 1e-6, `${id} faces ${open}`);
  }
  const g = S('gate_n');
  assert.ok(g.open && g.visual === false && g.w === 4.9);
  assert.equal(S('pen_gate').gateModel, true);
});

test('art m10: the compound walls are the camp mud-brick wall (not red brick), crest at the gameplay height, buttresses inside', () => {
  for (const id of ['wall_n', 'wall_w', 'wall_s']) {
    const s = S(id);
    assert.deepEqual(s.inside, [40, 165], id);
    for (const pts of s.segments || [s.points]) {
      const g = buildWall(pts, { ...s });
      assert.equal(g.name, 'dressing:wall:mudbrick_camp', id);
      let top = -Infinity;
      g.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); o.updateWorldMatrix(true, false); top = Math.max(top, o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).max.y); } });
      assert.ok(Math.abs(top - s.h) < 0.12, `${id}: crest ${top.toFixed(2)}`);
    }
  }
});

test('art m10: the set dressing never touches the walk grid and keeps clear of the drives, the routes and the Ju 52', () => {
  for (const f of m10.furniture) assert.equal(f.block, false);
  for (const p of m10.pavements) assert.equal(p.grid, false);
  const dress = m10.structures.filter((s) => s.vehicleArt);
  assert.ok(dress.length >= 6, `${dress.length} parked`);
  // routes: every enemy walk / squad loop / tank drive point list, sampled
  const lines = [];
  for (const e of m10.enemies) if (e.route?.points) lines.push(e.route.points.map((p) => [p.x, p.z]));
  lines.push(PZ24_ROUTE, PZ22_LOOP.map((p) => [p.x, p.z]));
  for (const g of Object.values(m10.barracks)) for (const q of g.squads) lines.push([...q.exitRoute, ...q.loop].map((p) => [p.x, p.z]));
  const dist = (pts, x, z) => Math.min(...pts.slice(0, -1).map(([ax, az], k) => {
    const [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  }), Infinity);
  for (const s of [...dress, ...m10.furniture]) {
    const r = Math.max(s.w ?? 0.6, s.d ?? 0.6) / 2;
    for (const L of lines) if (L.length > 1) assert.ok(dist(L, s.x, s.z) > r + 1.2, `${s.id ?? s.type} @${s.x},${s.z} on a route`);
  }
  // shelf dressing is lifted with the airfield and stays out of the Junkers' wing sweep (x < 101, z 5–35)
  for (const s of dress.filter((q) => q.z < 51)) {
    assert.ok(m10.structures.some((q) => q.id === s.id), s.id);
    assert.ok(!(s.x < 101 && s.z > 4 && s.z < 36), `${s.id} under the Ju 52's wings`);
  }
});

// ------------------------------------------------------------------------------------------ second art pass (art/m10-dressing.js)
const segD = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const inPoly = ([x, z], P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const polyD = (p, P) => Math.min(...P.map((a, i) => segD(p, a, P[(i + 1) % P.length])));

test('art m10 pass 2: the rim wire is drawn on the shelf top (baseY), where its B.FENCE blocks — not inside the shelf prism', () => {
  for (const id of ['belt_rim_w', 'belt_rim_e']) assert.equal(S(id).baseY, SHELF_Y, id);
  const root = new THREE.Group();
  for (const id of ['belt_rim_w', 'belt_rim_e', 'belt_w1']) {
    const s = S(id), o = new THREE.Group();
    o.userData.wireRun = { type: 'double_apron', def: { ...s, type: 'fence', h: s.h ?? 1.2, width: 0.3 }, points: s.points };
    root.add(o);
  }
  const L = buildWireLayer(root, { groundAt: () => 0, theater: 'desert', missionId: 'm10', deferBarbs: false, deferStrands: false });
  const ys = (id) => L.parts.items.filter((it) => String(it.runKey).startsWith(`${id}#`)).flatMap((it) => it.path.map((p) => p[1]));
  for (const id of ['belt_rim_w', 'belt_rim_e']) {
    const y = ys(id);
    assert.ok(y.length > 50 && Math.min(...y) >= SHELF_Y, `${id}: ${y.length} wire points, lowest y ${Math.min(...y).toFixed(2)}`);
  }
  assert.ok(Math.max(...ys('belt_w1')) < 2.5, 'a ground belt stays on the ground');
});

test('art m10 pass 2: the dugout\'s earth roof lies inside its walls (it overhung them as a sheet at eave height)', async () => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  const url = merged().assets.dugout_log_ic.lods[0].url;
  const scene = await new Promise((res, rej) => loader.parse(readGlbArrayBuffer(P(`assets/models/${url}`)), '', (g) => res(g.scene), rej));
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let n = 0, out = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !/kit:sand/.test(o.material.name)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y < 1.2) continue; // (the banked drifts at the wall feet are ≤ 0.6 m)
      n++;
      if (Math.abs(v.x) > 7.05 || Math.abs(v.z) > 3.05) out++;
    }
  });
  assert.ok(n > 100 && out === 0, `${n} roof-earth vertices over 1.2 m, ${out} outside the 14 × 6 m walls`);
  // the squads' ways out (garrison doors at z 34.5): an entrance drawn at each, nothing standing proud of the S face
  // there (the old sandbag cheeks stood 1.5 m out, off the footprint, where the squads walk out)
  const dug = S('dugout'), doors = m10.barracks.dugout.squads.map((q) => q.door[0] - dug.x);
  assert.deepEqual(doors, [-5, 0, 5]);
  const ext = await withLib(merged(), () => pickAsset(dug.type, dug, { theater: 'desert', missionId: 'm10' }).ext);
  const face = ext.cz + ext.d / 2 - 0.3; // the S wall face in the model's frame (the footprint carries a 0.3 m margin)
  let proud = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y > 0.1 && v.z > face + 0.45 && doors.some((d) => Math.abs(v.x - ext.cx - d) < 1.2)) proud++;
    }
  });
  assert.equal(proud, 0, `${proud} vertices proud of the S face at the squads' doors`);
});

test('art m10 pass 2: the landing ground lies flat on the shelf top inside the rim, the strip clear of the dugout', () => {
  const A = M10_AIRSTRIP, shelf = S('shelf').points, m = buildAirstrip(A);
  assert.equal(m.name, 'kit:airstrip');
  assert.ok(Math.abs(m.position.y - SHELF_Y) < 0.02 && !m.castShadow, 'at the walk height, no shadow');
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox;
  assert.ok(bb.max.y - bb.min.y < 1e-6, 'flat');
  const { x0, x1, z0, z1 } = A.area;
  // the decal never hangs over the cliff or the ramp head: its whole extent inside the shelf (≥ 0.4 m off its edge)
  for (const c of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) assert.ok(inPoly(c, shelf) || polyD(c, shelf) < 1e-6, `corner ${c}`);
  for (const t of A.tracks) for (const p of t.pts) {
    assert.ok(p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1, `track point ${p} outside the decal`);
    assert.ok(inPoly(p, shelf) && polyD(p, shelf) >= 0.4 || p[0] <= x0 + 1e-6 || p[0] >= x1 - 1e-6, `track point ${p} off the shelf top`); // (or run off the map's W / E edge)
  }
  // the rolled strip stops ≥ 1 m short of the dugout's N wall
  const dug = S('dugout');
  assert.ok(A.strip.z1 <= dug.z - dug.d / 2 - 1, `strip edge ${A.strip.z1} vs dugout N wall ${dug.z - dug.d / 2}`);
  // the Junkers' take-off track runs from its stand to the W edge, past its exit point
  const ju = m10.vehicles.find((q) => q.id === 'ju52'), run = A.tracks[0].pts;
  assert.ok(segD([ju.x, ju.z], run[0], run[1]) < 1 && run.at(-1)[0] <= x0 + 1e-6, 'take-off run');
  assert.ok(Math.min(...run.slice(1).map((b, i) => segD([m10.extraction.exit.x, m10.extraction.exit.z], run[i], b))) < m10.extraction.exit.r, 'through the exit');
  // the landing T lies on the shelf, by the windsock, clear of the strip
  const T = A.landingT;
  assert.ok(T.z + T.span / 2 <= A.strip.z0 + 1 && inPoly([T.x - T.w, T.z - T.span / 2], shelf) && inPoly([T.x + T.len, T.z + T.span / 2], shelf));
});

test('art m10 pass 2: the new pieces stand clear of every route, post, spawn, the solution walks and the Junkers\' sweep', () => {
  const ids = ['wreck_sdkfz', 'crater_e', 'dump_stores_e', 'dump_drums_e', 'dump_crates_e', 'graves_sw'];
  assert.deepEqual(M10_DRESSING.map((q) => q.id).sort(), [...ids].sort());
  const segs = [], xy = (p) => (Array.isArray(p) ? p : [p.x, p.z]);
  const add = (pts, loop) => { for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); if (loop) segs.push([pts.at(-1), pts[0]]); };
  for (const e of m10.enemies) if (e.route?.points) add(e.route.points.map(xy), e.route.type === 'LOOP');
  add(PZ24_ROUTE); add(PZ22_LOOP.map(xy), true);
  for (const g of Object.values(m10.barracks)) for (const q of g.squads) { add(q.exitRoute.map(xy)); add(q.loop.map(xy), true); }
  // the dossier's solution walks (§11): the W map-edge run to the compound's NW corner, the Sniper outside the S wall
  const walks = [[[4, 100], [4, 150], [8, 150]], [[19, 178], [22.5, 183], [31.5, 198.5], [62, 185], [78, 201]]];
  const spots = [...m10.enemies, ...m10.vehicles, ...m10.commandos, { id: 'decoy', x: 33, z: 198 }];
  for (const id of ids) {
    const s = S(id), r = s.r != null ? 1.5 * s.r : Math.hypot(s.w, s.d) / 2, p = [s.x, s.z];
    assert.ok(s.x - r >= 0 && s.x + r <= m10.size[0] && s.z - r >= 0 && s.z + r <= m10.size[1], `${id} on the map`);
    const dr = Math.min(...segs.map(([a, b]) => segD(p, a, b))) - r;
    assert.ok(dr >= 6, `${id}: ${dr.toFixed(2)} m from a route`);
    for (const u of spots) assert.ok(Math.hypot(u.x - s.x, u.z - s.z) - r >= 6, `${id} by ${u.id ?? u.role}`);
    for (const w of walks) assert.ok(Math.min(...w.slice(1).map((b, i) => segD(p, w[i], b))) - r >= 8, `${id} on a solution walk`);
    assert.ok(!(s.x < 101 && s.z > 4 && s.z < 36), `${id} under the Ju 52's wings`);
  }
  // the burnt-out armoured car is the library eight-wheeler, burnt; its crater's rim (1.5 r) clear of the hull
  const car = S('wreck_sdkfz'), cr = S('crater_e');
  assert.ok(car.vehicleArt === 'sdkfz231_8rad' && car.wreck === true && car.block === 2);
  assert.equal(pickAsset(car.type, car, { theater: 'desert', missionId: 'm10' }), null, 'no building under it');
  assert.ok(Math.hypot(cr.x - car.x, cr.z - car.z) - 1.5 * cr.r - car.w / 2 >= 0.2, 'crater clear of the hull');
  // the dump stands 6–8 m outside the apron's E fence (out of the sheds' blast, off the fence's line)
  const fe = S('fence_ap_e').points;
  for (const id of ['dump_stores_e', 'dump_drums_e', 'dump_crates_e']) {
    const s = S(id), d = segD([s.x, s.z], fe[0], fe[1]), side = (fe[1][0] - fe[0][0]) * (s.z - fe[0][1]) - (fe[1][1] - fe[0][1]) * (s.x - fe[0][0]);
    assert.ok(d >= 6 && d <= 8 && side < 0, `${id}: ${d.toFixed(2)} m off the fence, outside`);
  }
  // the graves: their own kit build (crosses, helmets, the stone border), a B.LOW plot
  const g = S('graves_sw'), names = [];
  buildProp('crates', g, { theater: 'desert' }).object3d.traverse((q) => names.push(q.name));
  assert.match(names.join(' '), /kit:field_graves/);
  assert.doesNotMatch(names.join(' '), /dressing:crates/);
  assert.equal(g.block, 1);
});
