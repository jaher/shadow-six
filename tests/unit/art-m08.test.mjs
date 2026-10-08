/** M8 art pass (Tell el Eisa): add-on manifests, hinted variants and fits, the carved wadi, the set dressing. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, libraryHinted, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { carveField, missionCarves, carvePainter } from '../../src/art/terrain/carve.js';
import { normalizeRoadNetwork } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDONS = ['manifest-tell-el-eisa', 'manifest-tell-el-eisa-bridge'];
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm08'); try { return await fn(); } finally { await useManifest(null); } };
const m08 = MISSIONS.find((m) => m.id === 'm08');
const HOUSES = ['n1', 'n2', 'n3', 'w1', 'w2'].map((b) => `house_adobe_redtile_${b}`);
const OWN = [...HOUSES, 'water_reservoir_round', 'supply_dump_desert_a', 'supply_dump_desert_b', 'bridge_timber_trestle'];

test('art m08: the Tell el Eisa add-ons ship every LOD and sidecar (the reservoir with its ruin), own types only', () => {
  for (const x of ADDONS) assert.ok(EXTRA_MANIFESTS.includes(x), x);
  const assets = Object.assign({}, ...ADDONS.map((x) => JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))).assets));
  for (const n of [...OWN, 'water_reservoir_round_destroyed']) {
    const a = assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('desert'), n);
  }
  assert.equal(assets.water_reservoir_round.destroyedVariant, 'water_reservoir_round_destroyed');
  const b = base(), m = merged();
  for (const t of ['house', 'fueltank', 'bridge', 'crates', 'well']) assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m08: the houses, reservoir, bridge and dumps take their own builds and fit their footprints (≤ 12 %)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m08.structures) {
    if (!libraryHinted(s.type, s) || s.points) continue;
    const pk = pickAsset(s.type, s, { theater: 'desert', missionId: 'm08' });
    if (!pk || !OWN.includes(pk.name)) continue;
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const n of OWN) assert.ok(seen.has(n), `${n} used`);
  // each hideout its own build, its plank door on the mission's door side (n* = N, w* = W)
  const hs = m08.structures.filter((q) => q.variant === 'house_adobe_redtile');
  assert.equal(new Set(hs.map((q) => q.asset)).size, hs.length, 'five different builds');
  for (const s of hs) {
    const side = Math.cos(s.door) < -0.5 ? 'w' : 'n';
    assert.match(s.asset, new RegExp(`^house_adobe_redtile_${side}\\d$`), s.id);
  }
}));

test('art m08: each hideout draws its plank door where the game enters it (mid-wall, ≤ 0.3 m), clear of the neighbours', () => withLib(merged(), () => {
  const m = merged(), hs = m08.structures.filter((q) => q.variant === 'house_adobe_redtile');
  for (const s of hs) {
    const pk = pickAsset(s.type, s, { theater: 'desert', missionId: 'm08' });
    assert.equal(pk.name, s.asset, s.id);
    assert.equal(pk.turn, 0, s.id);
    const a = m.assets[pk.name], dr = a.doors.find((d) => d.node === 'door_main');
    assert.ok(dr, `${s.id} door node`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height);
    const x = s.x + sx * (dr.pos[0] - pk.ext.cx), z = s.z + sz * (dr.pos[2] - pk.ext.cz);
    const dp = doorPoint(s), wx = dp.x - Math.cos(s.door), wz = dp.z - Math.sin(s.door); // doorPoint stands 1 m out
    assert.ok(Math.hypot(x - wx, z - wz) < 0.3, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry wall point ${wx.toFixed(2)},${wz.toFixed(2)}`);
    for (const o of hs) if (o !== s) {
      const inside = Math.abs(x - o.x) < o.w / 2 + 0.3 && Math.abs(z - o.z) < o.d / 2 + 0.3;
      assert.ok(!inside, `${s.id}'s door against ${o.id}`);
      assert.ok(!(Math.abs(dp.x - o.x) < o.w / 2 + 0.3 && Math.abs(dp.z - o.z) < o.d / 2 + 0.3), `${s.id}'s entry point by ${o.id}`);
    }
  }
}));

test('art m08: the wadi carve is one outline inside the ravine / bridge cells, open at the map edges, painted rock and gravel', () => {
  const f = missionCarves(m08);
  assert.ok(f, 'carves');
  assert.ok(f.at(87.5, 15) < -2.3, 'N gully bed');
  assert.ok(f.at(87.5, 33) < -2.3, 'under the bridge');
  assert.ok(f.at(65, 100) < -2.3, 'SE arm (mid-bed)');
  assert.ok(f.at(87.5, -6) < -2.3 && f.at(62, 110) < -1.5, 'runs on past the N and S edges');
  for (const [x, z] of [[70, 33], [98.5, 31], [60, 60], [66, 42.5], [30, 50]]) assert.equal(f.at(x, z), 0, `flat at ${x},${z}`);
  // the rim stays within 0.1 m for 0.05 m inside the outline (+ inset)
  const g = carveField([{ points: [[0, 0], [10, 0], [10, 10], [0, 10]], depth: 2, inset: 0.5 }]);
  assert.ok(g.at(5, 0.54) > -0.1 && g.at(5, 0.3) === 0 && g.at(5, 5) < -1.8);
  // on the M08 grid no walkable non-deck cell sinks: every terrain-mesh vertex (0.25 m lattice) on a walkable cell
  // stays within 0.1 m (world.groundY reads the carved mesh, sight treats the cell as flat ground)
  const grid = loadGrid(m08).grid, bad = [];
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    const cx = (i + 0.5) * grid.cell, cz = (j + 0.5) * grid.cell;
    if (!grid.isWalkable(i, j) || grid.bridge[grid.idx(i, j)] || grid.elevAt(cx, cz) > 0) continue;
    let m = 0;
    for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) m = Math.min(m, f.at(i * grid.cell + a * 0.25, j * grid.cell + b * 0.25));
    if (m < -0.1) bad.push(`${cx},${cz}:${m.toFixed(2)}`);
  }
  assert.deepEqual(bad, [], 'walkable cells sunk by the carve');
  const layers = ['sand', 'sand2', 'gravel', 'dirt', 'rock', 'road', 'grassdry', 'mud'];
  const paint = carvePainter(f, layers), w = [1, 0, 0, 0, 0, 0, 0, 0];
  paint(87.5, 15, w);
  assert.ok(w[0] < 0.05 && w[2] > 0.3, 'gravel bed');
});

test('art m08: dressing is clear of routes and posts; pads are visual only; furniture never blocks', () => {
  const net = normalizeRoadNetwork(m08);
  for (const a of net.areas) assert.equal(a.grid, false, a.id);
  for (const f of m08.furniture) assert.equal(f.block, false, f.type);
  const pts = [];
  for (const e of m08.enemies) { pts.push([e.x, e.z]); for (const p of e.route?.points || []) pts.push([p.x, p.z]); }
  const segs = m08.enemies.flatMap((e) => { const r = e.route?.points || []; return r.slice(1).map((p, i) => [r[i], p]); });
  const dseg = ([x, z], [a, b]) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
  for (const s of m08.structures.filter((q) => /^(dump_|tanker_|well_)/.test(q.id))) {
    const r = Math.hypot(s.w ?? 2 * s.r, s.d ?? 2 * s.r) / 2;
    for (const sg of segs) assert.ok(dseg([s.x, s.z], sg) > r + 1.5, `${s.id} clear of a route`);
    for (const p of pts) assert.ok(Math.hypot(p[0] - s.x, p[1] - s.z) > r + 1.5, `${s.id} clear of a post`);
  }
});
