/** M16 art pass (the Maas bridge, Belgium): the Mosan add-on, each structure's own build fitted to its footprint, the
 *  doors where the game enters, the burnt car as a vehicle wreck, the ruined field walls, the paving and furniture. */
import { readFileSync, existsSync } from 'node:fs';
import { readGlb } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { validateRoads, normalizeRoadNetwork } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-maas';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm16'); try { return await fn(); } finally { await useManifest(null); } };
const m16 = MISSIONS.find((m) => m.id === 'm16');
const OWN = ['house_belgian_brick_a', 'house_belgian_brick_b', 'house_belgian_brick_c', 'house_belgian_brick_w', 'farmhouse_mosan_a',
  'farmhouse_mosan_b', 'townhouse_stucco_be_a', 'townhouse_stucco_be_b', 'station_halt_be', 'hut_brick_be', 'shed_tarred_be',
  'pillbox_round_be', 'tent_ridge_field', 'bulldozer_rusty'];

test('art m16: the Maas add-on ships every LOD, sidecar and texture, temperate, under its own types only', () => {
  assert.ok(EXTRA_MANIFESTS.includes(ADDON));
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  const alias = base().textures.aliases; // byte-identical maps the building library loads under another name
  const found = (u) => existsSync(u) || (alias[u.pathname.split('/').pop()] && existsSync(new URL(alias[u.pathname.split('/').pop()], u)));
  for (const n of OWN) {
    const a = add.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) {
      assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
      const glb = readGlb(P(`assets/models/${l.url}`)).toString('latin1');
      for (const [, u] of glb.matchAll(/"uri":"([^"]+)"/g)) assert.ok(found(new URL(u, P(`assets/models/${l.url}`))), `${l.url} → ${u}`);
    }
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('temperate'), n);
  }
  const b = base(), m = merged();
  for (const t of ['house', 'barracks', 'hut', 'bunker', 'tent', 'ruins']) assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m16: every building takes its own Mosan build, fitted to the gameplay footprint (≤ 12 % per axis)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m16.structures.filter((q) => q.asset)) {
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm16' });
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const n of OWN) assert.ok(seen.has(n), `${n} used`);
  // nothing in M16 is drawn with a building from another theatre (Norwegian log cabins, timber houses)
  for (const s of m16.structures) {
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm16' });
    if (pk) assert.doesNotMatch(pk.name, /log_cabin|house_timber|barracks_[abc]$|house_bombed/, s.id);
  }
}));

test('art m16: hideouts and garrisons draw their door where the game enters them (mid-wall, ≤ 0.3 m)', () => withLib(merged(), () => {
  const m = merged();
  for (const s of m16.structures.filter((q) => q.asset && (q.enterable || q.garrison))) {
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm16' });
    assert.equal(pk.turn, 0, s.id);
    const a = m.assets[pk.name], dr = a.doors.find((d) => d.node === 'door_front');
    assert.ok(dr, `${s.id} front door`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height);
    const lx = sx * (dr.pos[0] - pk.ext.cx), lz = sz * (dr.pos[2] - pk.ext.cz), c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = s.x + lx * c - lz * n, z = s.z + lx * n + lz * c;
    const dp = doorPoint(s), side = (s.rot ?? 0) + s.door, wx = dp.x - Math.cos(side), wz = dp.z - Math.sin(side);
    assert.ok(Math.hypot(x - wx, z - wz) < 0.3, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry ${wx.toFixed(2)},${wz.toFixed(2)}`);
  }
}));

test('art m16: the burnt car is a vehicle wreck (no building under it); the parked machines are library vehicles', () => withLib(merged(), () => {
  const car = m16.structures.find((s) => s.id === 'wreck_car');
  assert.equal(car.vehicleArt, 'citroen11');
  assert.equal(car.wreck, true);
  assert.equal(pickAsset(car.type, car, { theater: 'temperate', missionId: 'm16' }), null);
  for (const id of ['moto_station', 'kubel_town']) assert.ok(m16.structures.find((s) => s.id === id)?.vehicleArt, id);
}));

test('art m16: the ruined field walls have a ragged crest about the gameplay height and low fallen stones', () => {
  const w = m16.structures.find((s) => s.id === 'wall_f2');
  const g = buildWall(w.points, { variant: w.variant, mat: w.mat, h: w.h, width: w.width, id: w.id });
  assert.equal(g.name, 'dressing:wall:stone_ruin');
  let top = 0;
  g.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.max.y + o.position.y); } });
  assert.ok(top > w.h * 0.95 && top < w.h * 1.35, `crest ${top.toFixed(2)}`);
});

test('art m16: Belgian setts on the main roads and squares, visual-only paving and furniture', () => {
  assert.deepEqual(validateRoads(m16), []);
  const net = normalizeRoadNetwork(m16);
  assert.ok(net.roads.filter((r) => r.surface === 'belgian').length >= 3, 'cobbled main roads');
  assert.ok(net.areas.length >= 2 && net.areas.every((a) => a.grid === false && a.surface === 'belgian'));
  assert.ok(m16.furniture.length >= 10 && m16.furniture.every((f) => f.block === false), 'furniture never blocks the walk grid');
});

test('art m16: street furniture stands on the verge, ≥ 1 m clear of every road carriageway (vehicles drive the roads)', () => {
  const segD = ([px, pz], [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const roads = m16.terrain.filter((t) => t.type === 'path' && t.terrain === 'road');
  assert.ok(roads.length >= 4);
  for (const f of m16.furniture) {
    for (const r of roads) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const d = segD([f.x, f.z], r.points[i], r.points[i + 1]);
        assert.ok(d >= r.width / 2 + 1, `${f.type} ${f.variant ?? ''} at (${f.x.toFixed(1)}, ${f.z.toFixed(1)}) is ${d.toFixed(2)} m from a ${r.width} m road's centreline`);
      }
    }
  }
});

test('art m16: each round pillbox turns its embrasures onto its crew\'s watch, clear of the road it guards', () => {
  for (const id of ['pb_w', 'pb_e']) {
    const s = m16.structures.find((q) => q.id === id), crew = m16.enemies.find((e) => e.structure === id);
    const d = Math.atan2(Math.sin(s.rot + Math.PI / 2 - crew.heading), Math.cos(s.rot + Math.PI / 2 - crew.heading));
    assert.ok(Math.abs(d) < 0.05, `${id}: embrasures ${((s.rot + Math.PI / 2) * 180 / Math.PI).toFixed(0)}° vs crew ${(crew.heading * 180 / Math.PI).toFixed(0)}°`);
    assert.ok(Math.hypot(crew.x - s.x, crew.z - s.z) < 0.01, `${id} crew inside`);
  }
  const [a, b] = ['pb_w', 'pb_e'].map((id) => m16.structures.find((q) => q.id === id).rot);
  assert.ok(Math.abs(a - b) > 0.5, 'the two pillboxes face different ways');
  const w = m16.structures.find((q) => q.id === 'pb_w'), nw = m16.terrain.find((t) => t.type === 'path' && t.points[0][0] === 0 && t.points[0][1] === 25);
  const [[ax, az], [bx, bz]] = nw.points, t = ((w.x - ax) * (bx - ax) + (w.z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2);
  assert.ok(Math.hypot(w.x - ax - t * (bx - ax), w.z - az - t * (bz - az)) - nw.width / 2 > w.w / 2 + 0.5, 'pb_w clear of the NW road');
  // and clear of the W ramp's parapet end: the deck ends at the bridge's W end, its parapet 5.3 m off the axis (S side)
  const br = m16.structures.find((q) => q.id === 'bridge'), c = Math.cos(br.rot), n = Math.sin(br.rot);
  const ex = br.x - c * br.w / 2, ez = br.z - n * br.w / 2, corner = [ex - n * 5.3, ez + c * 5.3];
  assert.ok(Math.hypot(w.x - corner[0], w.z - corner[1]) > w.w / 2 + 1, `pb_w ${Math.hypot(w.x - corner[0], w.z - corner[1]).toFixed(2)} m from the parapet end`);
  const pw = m16.enemies.find((e) => e.id === 'e51').route.points;
  const seg = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz))); return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz); };
  assert.ok(Math.min(...pw.slice(1).map((b, i) => seg(w, pw[i], b))) > w.w / 2 + 1.5, 'the W-road patrol walks clear of pb_w');
});

test('art m16: the rusty bulldozer is a detailed build (shoe-by-shoe tracks, worn paint and rust maps), not a box stand-in', () => {
  const a = merged().assets.bulldozer_rusty;
  assert.ok(a.lods[0].tris > 9000, `LOD0 ${a.lods[0].tris} tris`);
  const glb = readGlb(P(`assets/models/${a.lods[0].url}`)).toString('latin1');
  for (const m of ['paint_rust_ochre_diff', 'paint_rust_ochre_nor', 'rust_heavy_diff', 'rust_heavy_nor']) {
    assert.ok(glb.includes(`/${m}.jpg`), m);
    assert.ok(existsSync(P(`assets/textures/lib/1k/${m}.jpg`)) && existsSync(P(`assets/textures/lib/512/${m}.jpg`)), `${m} 1k + 512`);
  }
});

test('art m16 (pass 2): set dressing spread in, ≥ 5 m off every guard post and beat and ≥ 8 m off the start; inside the map', async () => {
  const { M16_DRESSING, GARDEN_FENCE } = await import('../../src/art/m16-dressing.js');
  const segD = ([px, pz], [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const beats = [];
  for (const e of m16.enemies) {
    beats.push([[e.x, e.z], [e.x, e.z]]);
    const r = e.route?.points || [];
    for (let k = 0; k < r.length; k++) beats.push([[r[k].x, r[k].z], [r[(k + 1) % r.length].x, r[(k + 1) % r.length].z]]);
  }
  /** The piece's outline: a run's vertices, else its footprint's corners (and centre). */
  const outline = (s) => (s.points ? s.points : [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const lx = (u * (s.w ?? 1)) / 2, lz = (v * (s.d ?? 1)) / 2, c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0);
    return [s.x + lx * c - lz * n, s.z + lx * n + lz * c];
  }));
  assert.ok(M16_DRESSING.length >= 12);
  const [W, D] = m16.size;
  for (const s of M16_DRESSING) {
    assert.ok(m16.structures.find((q) => q.id === s.id), `${s.id} in the mission`);
    for (const p of outline(s)) {
      const d = Math.min(...beats.map(([a, b]) => segD(p, a, b)));
      assert.ok(d >= 5, `${s.id} (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) ${d.toFixed(1)} m from a guard's post / beat`);
      for (const c of m16.commandos) assert.ok(Math.hypot(p[0] - c.x, p[1] - c.z) > 8, `${s.id} off the start`);
      assert.ok(p[0] > 0.5 && p[0] < W - 0.5 && p[1] > 0.5 && p[1] < D - 0.5, `${s.id} inside the map`);
    }
    const truck = m16.vehicles.find((q) => q.id === 'truck');
    assert.ok(Math.min(...outline(s).map(([x, z]) => Math.hypot(x - truck.x, z - truck.z))) > 12, `${s.id} off the escape lorry's stand`);
  }
  // the garden is closed but for its gate (≥ 1 m between the gate posts), and its fence draws pickets, not post-and-rail
  assert.ok(Math.hypot(GARDEN_FENCE[0][0] - GARDEN_FENCE.at(-1)[0], GARDEN_FENCE[0][1] - GARDEN_FENCE.at(-1)[1]) >= 1.0, 'the garden gate opening');
  const { buildFenceKit } = await import('../../src/art/kit-props.js');
  assert.equal(buildFenceKit(GARDEN_FENCE, { variant: 'picket_garden', h: 1.05 }).name, 'kit:fence_picket');
  // the parked lorry and the beached boat are library vehicles
  const vm = JSON.parse(readFileSync(P('assets/models/vehicles/manifest.json')));
  for (const s of M16_DRESSING.filter((q) => q.vehicleArt)) assert.ok((vm.assets || vm)[s.vehicleArt], s.vehicleArt);
});

test('art m16 (pass 2): wheat stooks stand inside their footprints, each blocks where it is drawn, one row = two draws', async () => {
  const THREE = await import('three');
  const { buildStooks } = await import('../../src/art/wheat-stooks.js');
  const { STOOK, stookCount, stookX } = await import('../../src/art/stook-layout.js');
  const rows = m16.structures.filter((s) => s.variant === 'wheat_stooks');
  assert.ok(rows.length >= 3);
  for (const s of rows) {
    assert.equal(s.navParts.length, stookCount(s), s.id);
    for (const [k, np] of s.navParts.entries()) {
      assert.equal(np.block, 1, `${s.id} stook ${k} low cover`);
      assert.ok(Math.abs(np.x - stookX(k, s.navParts.length, s.w)) < 1e-9 && Math.abs(np.x) + np.w / 2 <= s.w / 2 + 1e-9, `${s.id} stook ${k} in the row`);
    }
    const g = buildStooks(s); g.updateMatrixWorld(true);
    let meshes = 0; g.traverse((o) => { if (o.isMesh) meshes++; });
    assert.equal(meshes, 2, `${s.id} merged per material`);
    // every drawn stook stays inside its own rect (no sheaf in the gaps the walk grid leaves open), no higher than h
    const pos = new THREE.Vector3();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        pos.fromBufferAttribute(a, i);
        const inside = s.navParts.some((np) => Math.abs(pos.x - np.x) <= np.w / 2 + 0.05 && Math.abs(pos.z - np.z) <= np.d / 2 + 0.05);
        assert.ok(inside, `${s.id}: vertex (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) outside every stook rect`);
        assert.ok(pos.y <= STOOK.h + 0.02, `${s.id}: crest ${pos.y.toFixed(2)}`);
      }
    });
  }
});
