/** M11 art pass (Maradah, "In the Soup"): the Maradah add-on, each structure's own build fitted to its footprint, the
 *  doors where the game enters, the rigs' / garrisons' ruins, the portals in front of the rock, the set dressing clear of
 *  the routes and without gameplay blocks. */
import { readFileSync, existsSync } from 'node:fs';
import { readGlb, glbJson, isGlb } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-maradah';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm11'); try { return await fn(); } finally { await useManifest(null); } };
const m11 = MISSIONS.find((m) => m.id === 'm11');
const OWN = ['water_tower_legs_ms', 'windpump_ms', 'bunker_sandbag_timber_ms', 'hq_domed_ms', 'house_domed_ms_e', 'house_domed_ms_a', 'barracks_domed_ms',
  'tunnel_portal_ms', 'shed_lean_to_ms', 'dugout_sandbag_ms', 'tower_stub_ms', 'drilling_rig_ms', 'oil_tank_process_ms',
  'crate_stack_ms_a', 'crate_stack_ms_b', 'crate_stack_ms_c', 'crate_stack_ms_d', 'crate_stack_ms_e', 'drum_stack_ms'];
const RUINS = ['bunker_sandbag_timber_ms', 'hq_domed_ms', 'barracks_domed_ms', 'drilling_rig_ms'];
const pick = (s) => pickAsset(s.type, s, { theater: 'desert', missionId: 'm11' });
const byId = (id) => m11.structures.find((s) => s.id === id);

test('art m11: the Maradah add-on ships every LOD, sidecar and texture (and the targets\' ruins), desert, under its own types only', () => {
  assert.ok(EXTRA_MANIFESTS.includes(ADDON));
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  const alias = base().textures.aliases;
  const found = (u) => existsSync(u) || (alias[u.pathname.split('/').pop()] && existsSync(new URL(alias[u.pathname.split('/').pop()], u)));
  let uris = 0;
  for (const n of [...OWN, ...RUINS.map((r) => `${r}_destroyed`)]) {
    const a = add.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) {
      const f = P(`assets/models/${l.url}`);
      assert.ok(existsSync(f), l.url);
      const glb = readGlb(f); // the plain GLB, inflated when wrapped
      assert.ok(isGlb(glb), `${l.url} is a GLB`);
      assert.ok(glb.length < 1024 * 1024, `${l.url} under 1 MB`);
      const j = glbJson(glb);
      const ext = [...(j.images || []), ...(j.buffers || [])].map((x) => x.uri).filter((u) => u && !u.startsWith('data:'));
      assert.ok(ext.length > 0, `${l.url} maps the shared library textures`);
      for (const u of ext) { uris++; assert.ok(found(new URL(u, f)), `${l.url} → ${u}`); }
    }
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('desert'), n);
  }
  assert.ok(uris >= 69, `${uris} external texture references checked`);
  const b = base(), m = merged();
  for (const t of ['house', 'barracks', 'hut', 'bunker', 'crates', 'barrels', 'flat_roof_house', 'ruins', 'fueltank', 'drilling_rig'])
    assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m11: every asset-picked structure takes its own build, fitted to the gameplay footprint (≤ 12 % per axis), nav its own', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m11.structures.filter((q) => q.asset)) {
    const pk = pick(s);
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(2)}×${ed.toFixed(2)} on ${w}×${d}`);
    assert.equal(s.nav, false, `${s.id}: gameplay nav, not the build's`);
  }
  for (const n of OWN.filter((x) => x !== 'oil_tank_process_ms' || m11.structures.some((s) => s.asset === x))) assert.ok(seen.has(n), `${n} used`);
  // the four rigs, the three garrisons and the yard tanks are the library's now (no procedural derrick / white box)
  for (const id of ['rig_w', 'rig_e', 'rig_nw', 'rig_ne', 'bunker_c', 'hq_n', 'barracks_sw', 'tank_w1', 'tank_w2', 'tank_w3', 'windpump', 'water_tower'])
    assert.ok(byId(id)?.asset, `${id} has its build`);
}));

test('art m11: the houses and garrisons draw their door where the game enters them (on the wall, ≤ 0.6 m along it)', () => withLib(merged(), () => {
  const m = merged();
  const doors = m11.structures.filter((q) => q.asset && q.door != null && (q.enterable || q.garrison));
  assert.ok(doors.length >= 6, `${doors.length} doors checked`);
  for (const s of doors) {
    const pk = pick(s);
    assert.equal(pk.turn, 0, s.id);
    const a = m.assets[pk.name], dr = a.doors.find((q) => q.node === 'door_main') ?? a.doors[0];
    assert.ok(dr, `${s.id} has a drawn door`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height ?? 2);
    const lx = sx * (dr.pos[0] - pk.ext.cx), lz = sz * (dr.pos[2] - pk.ext.cz), c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = s.x + lx * c - lz * n, z = s.z + lx * n + lz * c;
    const dp = doorPoint(s);
    const [ex, ez] = Array.isArray(s.door) ? s.door : [dp.x, dp.z];
    const ux = (x - s.x) * c + (z - s.z) * n, uz = -(x - s.x) * n + (z - s.z) * c;      // in the building's frame
    const toWall = Math.min(Math.abs(Math.abs(ux) - s.w / 2), Math.abs(Math.abs(uz) - s.d / 2));
    assert.ok(toWall < 0.45, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} not on a wall (${toWall.toFixed(2)})`);
    assert.ok(Math.hypot(x - ex, z - ez) < 1.9, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry ${ex},${ez}`);
  }
}));

test('art m11: the bunker\'s deck is the walkable roof (3.5 m), the tunnel portals stand proud of the rock, the quarry tanks dress from the library', () => {
  const m = merged(), bunker = m.assets.bunker_sandbag_timber_ms;
  assert.ok(bunker.roofs.some((r) => r.walkable && Math.abs(r.elev - byId('bunker_c').roofY) < 0.05), 'bunker roof at roofY');
  for (const id of ['tunnel_s', 'tunnel_n']) {
    const s = byId(id);
    assert.equal(s.asset, 'tunnel_portal_ms');
    assert.equal(s.block, 0, `${id} draws only`);
    assert.ok(m11.script, 'the script keeps the procedural arch as the fallback');
  }
  const src = readFileSync(P('src/missions/scripts/m11.js'), 'utf8');
  assert.match(src, /libraryVisual\('fueltank', \{ id, asset: 'oil_tank_process_ms'/);
  assert.match(src, /getObjectByName\?\.\('fit'\)/);
});

test('art m11: set dressing is visual only and clear of every route; decor vehicles >= 7 m from patrols', () => {
  for (const f of m11.furniture) assert.equal(f.block, false, `${f.type} ${f.text ?? ''} blocks nothing`);
  for (const p of m11.pavements) assert.equal(p.grid, false, `${p.id} paints only`);
  const segs = [];
  for (const e of m11.enemies) {
    const pts = (e.route?.points || []).map((q) => [q.x, q.z]);
    if (!pts.length) pts.push([e.x, e.z]);
    for (let i = 0; i < pts.length; i++) segs.push([pts[i], pts[Math.min(i + 1, pts.length - 1)]]);
  }
  const dseg = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
  for (const id of ['kw_e', 'bowser_y']) {
    const s = byId(id);
    assert.ok(s && s.vehicleArt && s.block === 0, id);
    const d = Math.min(...segs.map(([a, b]) => dseg([s.x, s.z], a, b)));
    assert.ok(d >= 7, `${id}: ${d.toFixed(1)} m from a patrol`);
  }
  assert.equal(byId('wreck_r').vehicleArt, 'opel_blitz_cargo');
  assert.equal(byId('wreck_r').wreck, true);
});
