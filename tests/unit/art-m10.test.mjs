/** M10 art pass (El Agheila, "Operation Icarus"): the El Agheila add-on, each structure's own build fitted to its
 *  footprint, the gameplay walls of the sheds and blast walls kept (drawn by art twins), the mud-brick compound walls,
 *  the cage door's mesh leaf, and the set dressing clear of the routes, the tank drives and the Ju 52's take-off. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { glbJson } from '../../tools/glb-io.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';
import { PZ24_ROUTE, PZ22_LOOP } from '../../src/missions/m10_operation_icarus.js';

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
