/** M18 art pass (the Maas bridge again, December 1944): the M16 Mosan builds on the shared layout (the red house in red
 *  brick with green joinery, dossier §4.3), doors where the game enters, the burnt car as a vehicle wreck, Belgian setts,
 *  and the set dressing kept off every road, route, post and spawn. */
import { readFileSync, existsSync } from 'node:fs';
import { readGlb } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { validateRoads, normalizeRoadNetwork } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm18'); try { return await fn(); } finally { await useManifest(null); } };
const m18 = MISSIONS.find((m) => m.id === 'm18');
const S = (id) => m18.structures.find((s) => s.id === id);
const ctx = { theater: 'temperate', missionId: 'm18' };
const segD = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};

test('art m18: every building takes its Mosan build, fitted to the gameplay footprint (≤ 12 % per axis), none from another theatre', () => withLib(merged(), () => {
  const want = { pb_w: 'pillbox_round_be', pb_e: 'pillbox_round_be', isl_hut: 'shed_tarred_be', station: 'station_halt_be', house_road: 'farmhouse_mosan_a',
    blk_n: 'house_belgian_brick_a', blk_w: 'house_belgian_brick_b', blk_e: 'house_belgian_brick_w', town_grey: 'townhouse_stucco_be_a', hut_fields: 'hut_brick_be',
    bulldozer: 'bulldozer_rusty_red', nw_h1: 'house_belgian_brick_b', nw_h2: 'house_belgian_brick_c', red_house: 'house_belgian_brick_a', nw_h3: 'farmhouse_mosan_b',
    tent_0: 'tent_ridge_field' };
  for (const [id, name] of Object.entries(want)) assert.equal(S(id).asset, name, id);
  for (const s of m18.structures.filter((q) => q.asset)) {
    const pk = pickAsset(s.type, s, ctx);
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    if (s.type === 'crates') continue; // dressing props keep their own size
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const s of m18.structures) {
    const pk = pickAsset(s.type, s, ctx);
    if (pk) assert.doesNotMatch(pk.name, /log_cabin|house_timber|house_halftimber|barracks_[abc]$|house_bombed|shop_front|mg_nest/, s.id);
  }
}));

test('art m18: hideouts and garrisons draw their door where the game enters them (mid-wall, ≤ 0.3 m)', () => withLib(merged(), () => {
  const m = merged();
  const doors = m18.structures.filter((q) => q.asset && (q.enterable || q.garrison));
  assert.ok(doors.length >= 6, doors.map((s) => s.id).join());
  for (const s of doors) {
    const pk = pickAsset(s.type, s, ctx);
    assert.equal(pk.turn, 0, s.id);
    const dr = m.assets[pk.name].doors.find((d) => d.node === 'door_front');
    assert.ok(dr, `${s.id} front door`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height);
    const lx = sx * (dr.pos[0] - pk.ext.cx), lz = sz * (dr.pos[2] - pk.ext.cz), c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = s.x + lx * c - lz * n, z = s.z + lx * n + lz * c;
    const dp = doorPoint(s), side = (s.rot ?? 0) + s.door, wx = dp.x - Math.cos(side), wz = dp.z - Math.sin(side);
    assert.ok(Math.hypot(x - wx, z - wz) < 0.3, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry ${wx.toFixed(2)},${wz.toFixed(2)}`);
  }
}));

test('art m18: the burnt car is a vehicle wreck on the bank (no building under it); parked machines are library vehicles', () => withLib(merged(), () => {
  const car = S('wreck_car');
  assert.equal(car.vehicleArt, 'citroen11');
  assert.equal(car.wreck, true);
  assert.equal(pickAsset(car.type, car, ctx), null);
  for (const id of ['moto_station', 'kubel_camp', 'truck_camp']) assert.ok(S(id)?.vehicleArt, id);
}));

test('art m18: each round pillbox turns its embrasures onto its crew\'s watch', () => {
  for (const id of ['pb_w', 'pb_e']) {
    const s = S(id), crew = m18.enemies.find((e) => e.structure === id);
    const d = Math.atan2(Math.sin(s.rot + Math.PI / 2 - crew.heading), Math.cos(s.rot + Math.PI / 2 - crew.heading));
    assert.ok(Math.abs(d) < 0.05, `${id}: embrasures vs crew ${(crew.heading * 180 / Math.PI).toFixed(0)}°`);
  }
});

test('art m18: Belgian setts on the main roads and squares; paving and furniture never touch the walk grid', () => {
  assert.deepEqual(validateRoads(m18), []);
  const net = normalizeRoadNetwork(m18);
  assert.ok(net.roads.filter((r) => r.surface === 'belgian').length >= 3, 'cobbled main roads');
  assert.ok(net.areas.length >= 2 && net.areas.every((a) => a.grid === false && a.surface === 'belgian'));
  assert.ok(m18.furniture.length >= 10 && m18.furniture.every((f) => f.block === false));
});

test('art m18: street furniture stands ≥ 1 m clear of every carriageway and ≥ 3.5 m off the rail axis', () => {
  const roads = m18.terrain.filter((t) => t.type === 'path' && t.terrain === 'road');
  const rail = m18.setpieces.find((s) => s.type === 'rail_line').track.map(([x, z]) => ({ x, z }));
  for (const f of m18.furniture) {
    for (const r of roads) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const d = segD(f, { x: r.points[i][0], z: r.points[i][1] }, { x: r.points[i + 1][0], z: r.points[i + 1][1] });
        assert.ok(d >= r.width / 2 + 1, `${f.type} ${f.variant ?? ''} (${f.x.toFixed(1)}, ${f.z.toFixed(1)}) ${d.toFixed(2)} m from a road centreline`);
      }
    }
    if (f.variant === 'platform') continue; // the platform lamps stand on the platform edge, as built
    const dr = Math.min(...rail.slice(1).map((b, i) => segD(f, rail[i], b)));
    assert.ok(dr >= 3.5, `${f.type} ${f.variant ?? ''} (${f.x.toFixed(1)}, ${f.z.toFixed(1)}) ${dr.toFixed(2)} m off the rails`);
  }
});

test('art m18: the set dressing keeps clear of every route, post, spawn and vehicle path (≥ 1 m from its edge)', () => {
  const dress = m18.structures.filter((s) => ['moto_station', 'kubel_camp', 'truck_camp', 'drums_camp', 'ammo_camp', 'crates_camp', 'logs_farm', 'logs_town', 'cart_village'].includes(s.id));
  assert.equal(dress.length, 9);
  const segs = [];
  const add = (pts, loop) => { for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); if (loop) segs.push([pts[pts.length - 1], pts[0]]); };
  for (const e of m18.enemies) if (e.route?.points) add(e.route.points, e.route.type === 'LOOP');
  for (const v of m18.vehicles) if (v.route?.points) add(v.route.points, v.route.type === 'LOOP');
  for (const b of Object.values(m18.barracks)) for (const sq of b.squads) { add(sq.exitRoute); add(sq.loop); }
  const spots = [...m18.enemies, ...m18.vehicles, ...m18.commandos];
  for (const s of dress) {
    const r = Math.hypot(s.w, s.d) / 2;
    const dr = Math.min(...segs.map(([a, b]) => segD(s, a, b)));
    assert.ok(dr - r >= 1, `${s.id}: ${(dr - r).toFixed(2)} m from a route`);
    for (const u of spots) assert.ok(Math.hypot(u.x - s.x, u.z - s.z) - r >= 1.5, `${s.id} on ${u.id ?? u.role}`);
  }
});

test('art m18: the SE-fields wreck is the red crawler (dossier §5.2 "red tractor"): its own build in paint_rust_red, 1k + 512 maps', () => {
  const a = merged().assets.bulldozer_rusty_red;
  assert.ok(a && a.lods.length === 3 && a.lods[0].tris > 9000, 'three LODs, detailed LOD0');
  const glb = readGlb(P(`assets/models/${a.lods[0].url}`)).toString('latin1');
  for (const m of ['paint_rust_red_diff', 'paint_rust_red_nor', 'rust_heavy_diff']) {
    assert.ok(glb.includes(`/${m}.jpg`), m);
    assert.ok(existsSync(P(`assets/textures/lib/1k/${m}.jpg`)) && existsSync(P(`assets/textures/lib/512/${m}.jpg`)), `${m} 1k + 512`);
  }
  assert.doesNotMatch(glb, /paint_rust_ochre/);
  assert.ok(JSON.parse(readFileSync(P('assets/textures/lib/materials.json'))).materials.paint_rust_red, 'registered material');
});
