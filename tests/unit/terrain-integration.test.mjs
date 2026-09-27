/** Terrain & vegetation integration (docs/terrain-pipeline.md §4; design-spec §4.8 TRACKS): pure helpers. */
import { test, assert } from './lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { treePlacement, roadPolylines, vehicleTrailType, stampWorld, wireTrailRecords, canBuildRealTerrain, buildTerrain, TREE_TYPES } from '../../src/art/terrain.js';
import { SPECIES } from '../../src/art/terrain/treegen.js';
import { makeWorld, addCommando } from './ai-harness.mjs';
import { MISSIONS } from '../../src/missions/index.js';

const ROOT = new URL('../../', import.meta.url);

test('trees: every mission tree maps to a seeded, unique treegen placement (same def → same tree)', () => {
  for (const m of MISSIONS) {
    const theater = m.theater || 'temperate';
    const defs = (m.structures || []).filter((s) => TREE_TYPES.includes(s.type));
    const seen = new Set();
    defs.forEach((d, k) => {
      const p = treePlacement(d, theater, k);
      assert.ok(p && SPECIES[p.species], `${m.id}: ${d.type} → known species (${p?.species})`);
      assert.equal(p.x, d.x); assert.equal(p.z, d.z);
      assert.ok(p.scale >= 0.35 && p.scale <= 2.5, 'scale clamped');
      assert.deepEqual(treePlacement(d, theater, k), p, 'deterministic');
      seen.add(`${p.species}:${p.seed}`);
    });
    if (defs.length > 1) assert.ok(seen.size >= defs.length * 0.9, `${m.id}: trees unique (${seen.size}/${defs.length})`);
  }
  assert.equal(treePlacement({ type: 'barrel', x: 1, z: 1 }), null);
  assert.equal(treePlacement({ type: 'pine', x: 3, z: 4 }, 'snow').species.match(/spruce|fir/) != null, true);
  assert.equal(treePlacement({ type: 'palm', x: 3, z: 4 }, 'desert').species, 'date_palm');
  assert.equal(treePlacement({ type: 'tree', x: 3, z: 4, variant: 'dead' }).species, 'dead_tree');
});

test('roads: mission road paths become pre-trampled polylines', () => {
  const r = roadPolylines({ terrain: [{ type: 'path', terrain: 'road', width: 4, points: [[0, 0], { x: 10, z: 5 }] }, { type: 'rect', terrain: 'road' }] });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].points, [[0, 0], [10, 5]]);
  assert.ok(r[0].passes > 0 && r[0].spread > 0);
  assert.deepEqual(roadPolylines(null), []);
});

test('vehicles: land vehicles map to a wheel/track layout; boats and guns leave none', () => {
  assert.equal(vehicleTrailType({ def: { kind: 'land', model: 'tank' } }), 'tank');
  assert.equal(vehicleTrailType({ def: { kind: 'land', model: 'truck' } }), 'truck');
  assert.equal(vehicleTrailType({ def: { kind: 'land', model: 'motorcycle' } }), 'motorcycle');
  assert.equal(vehicleTrailType({ def: { kind: 'land', model: 'car' }, vehicleType: 'kubelwagen' }), 'jeep');
  assert.equal(vehicleTrailType({ def: { kind: 'water', model: 'boat' } }), null);
  assert.equal(vehicleTrailType({}), null);
});

function stubTerrain() {
  const calls = [];
  return { calls, stampTrail: (kind, x, z, heading, o) => calls.push({ kind, x, z, heading, ...o }), recordTrail: (...a) => calls.push({ rec: a }) };
}
const grid = { cell: 1, cols: 100, rows: 100, terrain: new Uint8Array(100 * 100) };

test('stampWorld: walkers, crawlers, dragged bodies and moving vehicles stamp visual trails', () => {
  const w = {
    commandos: [
      { id: 1, alive: true, path: [1], x: 10, z: 10, y: 0, heading: 0, stance: 'stand', moveMode: 'run' },
      { id: 2, alive: true, path: [1], x: 20, z: 10, y: 0, heading: 1, stance: 'crawl', carrying: { kind: 'enemy' } },
      { id: 3, alive: true, path: null, x: 30, z: 10, y: 0, heading: 0 }, // idle: nothing
      { id: 4, alive: true, path: [1], x: 40, z: 10, y: 3, heading: 0 }, // on a roof: nothing
    ],
    enemies: [{ id: 5, alive: true, path: [1], x: 50, z: 10, y: 0, heading: 0, stance: 'stand' }],
    vehicles: [{ id: 6, def: { kind: 'land', model: 'truck' }, x: 60, z: 60, heading: 0, speed: 4 }, { id: 7, def: { kind: 'land', model: 'truck' }, x: 70, z: 60, speed: 0 }],
  };
  const t = stubTerrain();
  stampWorld(t, w, grid);
  const kinds = t.calls.map((c) => `${c.kind}:${c.id}`);
  assert.deepEqual(kinds, ['walker:u1', 'crawl:u2', 'drag:u2d', 'walker:u5', 'vehicle:v6']);
  assert.ok(t.calls.every((c) => c.record === false), 'visual only');
  assert.equal(t.calls[0].run, true);
  assert.equal(t.calls[4].type, 'truck');
});

test('wireTrailRecords: gameplay footprint events become terrain trail records', () => {
  const w = makeWorld({});
  const t = stubTerrain();
  const off = wireTrailRecords(w.events, t);
  w.events.emit('footprint', { x: 5, z: 6, heading: 0.5, owner: { id: 9 }, t: 2, aiVisible: true });
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].rec.slice(0, 5), ['foot', 5, 6, 0.5, 9]);
  off();
  w.events.emit('footprint', { x: 5, z: 6, heading: 0.5 });
  assert.equal(t.calls.length, 1, 'unwired');
});

test('§4.8 tracksNear: print visibility from the ground material × age; faint prints are dropped', () => {
  const w = makeWorld({});
  const c = addCommando(w, 'greenberet', 70, 70);
  w.ai.footprints.add({ x: 30, z: 40, heading: 0, t: 0, owner: c, aiVisible: true });
  w.ai.footprints.add({ x: 31, z: 40, heading: 0, t: 0, owner: c, aiVisible: true });
  w.terrain = null;
  assert.equal(w.ai.footprints.tracksNear(30, 40, 3).length, 2, 'no terrain: plain query, visibility 1');
  w.terrain = { printVisibility: (x) => (x < 30.5 ? 1 : 0.02) }; // snow vs rock
  const near = w.ai.footprints.tracksNear(30, 40, 3);
  assert.equal(near.length, 1);
  assert.equal(near[0].visibility, 1);
});

test('placeholder terrain without a renderer keeps the handle shape (groundY 0, printVisibility 1)', () => {
  assert.equal(canBuildRealTerrain(null), false);
  const g = { cols: 4, rows: 4, cell: 1, width: 4, depth: 4, terrain: new Uint8Array(16), worldToCell: (x, z) => ({ i: Math.floor(x), j: Math.floor(z) }), idx: (i, j) => j * 4 + i };
  const h = buildTerrain(g, 'snow');
  assert.equal(h.groundY(1, 1), 0);
  assert.equal(h.printVisibility(1, 1, 10), 1);
  assert.ok(h.ready instanceof Promise);
  h.dispose();
});

test('terrain assets: 1K + 2K layer strips per theater, foliage atlas, bark and CC0 credits', () => {
  for (const th of ['temperate', 'desert', 'snow']) {
    for (const f of [`${th}_albedo.webp`, `${th}_normal.webp`, `${th}_data.webp`, `${th}_albedo_2k.webp`, `${th}_normal_2k.webp`, `${th}_albedo_512.webp`, `${th}_normal_512.webp`]) assert.ok(existsSync(new URL(`assets/terrain/${f}`, ROOT)), f);
  }
  for (const f of ['foliage.webp', 'foliage.json', 'bark_albedo.webp', 'bark_normal.webp', 'layers.json', 'CREDITS.md']) assert.ok(existsSync(new URL(`assets/terrain/${f}`, ROOT)), f);
  const credits = readFileSync(new URL('assets/terrain/CREDITS.md', ROOT), 'utf8');
  assert.ok(/CC0/.test(credits), 'CC0 licence noted');
});
