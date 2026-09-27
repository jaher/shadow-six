/** Water integration (docs/water-pipeline.md §5, design-spec §2.4): pure helpers of src/art/water.js. */
import { test, assert } from './lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { waterBodyDescriptors, WakeTracker, iceShelfWidth, waterPreset, wetAt, WATER_LEVEL, FX_LAYER } from '../../src/art/water.js';
import { waterBodiesFromGrid, FX_LAYER as MOD_FX_LAYER } from '../../src/art/water/index.js';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { FX } from '../../src/render/fx.js';

const ROOT = new URL('../../', import.meta.url);
const T = { WATER: 5, SHALLOW: 6 };

function toyGrid(cols = 40, rows = 30, fill = (i, j) => 0) {
  const terrain = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) terrain[j * cols + i] = fill(i, j);
  return { cols, rows, cell: 0.5, terrain, width: cols * 0.5, depth: rows * 0.5 };
}

test('water: FX layer of the adapter matches the module (late FX pass draws layer 11)', () => {
  assert.equal(FX_LAYER, 11);
  assert.equal(MOD_FX_LAYER, FX_LAYER);
});

test('water: grid → bodies (river current from mission.water, ice shelf on snow, level, mask)', () => {
  // a river band across the map + a small pond
  const g = toyGrid(40, 30, (i, j) => (j >= 10 && j < 16 ? (j === 10 || j === 15 ? T.SHALLOW : T.WATER) : (i < 3 && j < 3 ? T.WATER : 0)));
  const m = { water: { velocity: 0.6, angleDeg: 40, turbulence: 0.4 }, shoreShallowWidth: 2 };
  const b = waterBodyDescriptors(g, m, 'snow', waterBodiesFromGrid);
  assert.equal(b.length, 2, 'river + pond (4-connected components, min 4 cells)');
  const river = b.filter((d) => d.type === 'river').sort((p, q) => q.polygon[2][0] - p.polygon[2][0])[0];
  assert.ok(river, 'flowing mission → river');
  assert.equal(river.level, WATER_LEVEL);
  assert.ok(Math.abs(river.flow.dir[0] - Math.cos(40 * Math.PI / 180)) < 1e-9 && river.flow.speed === 0.6);
  assert.ok(river.ice > 0.6 && river.ice < 2.6, `ice shelf narrower on a river (${river.ice})`);
  assert.equal(river.preset, 'clear');
  assert.ok(river.mask(5, 6) && !river.mask(5, 2), 'mask follows the water cells');
  const t = waterBodyDescriptors(g, m, 'temperate', waterBodiesFromGrid);
  assert.ok(t.every((d) => !d.ice), 'no ice outside the snow theatre');
  const f = waterBodyDescriptors(g, { water: { velocity: 0, frozen: true } }, 'snow', waterBodiesFromGrid);
  assert.ok(f.every((d) => d.frozen && d.type === 'lake'), 'frozen mission water → fully frozen still bodies');
  assert.equal(waterBodyDescriptors(toyGrid(), {}, 'snow', waterBodiesFromGrid).length, 0, 'dry map → no bodies');
});

test('water: ice shelf and presets per theatre (design-spec §2.4)', () => {
  assert.equal(iceShelfWidth('temperate', 0), 0);
  assert.ok(iceShelfWidth('snow', 0) > iceShelfWidth('snow', 1));
  assert.ok(iceShelfWidth('snow', 5) >= 0.6);
  assert.equal(waterPreset('snow', 'lake'), 'fjord');
  assert.equal(waterPreset('coast', 'sea'), 'sea');
  assert.equal(waterPreset('desert', 'river'), 'muddy');
});

test('water: M1–M3 (Norway, snow) build water bodies with ice edges from their grids', () => {
  for (const id of ['m01', 'm02', 'm03']) {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) continue;
    const { def: mission, grid } = loadGrid(def);
    const bodies = waterBodyDescriptors(grid, mission, mission.theater, waterBodiesFromGrid);
    assert.ok(bodies.length > 0, `${id}: has water`);
    assert.ok(bodies.every((d) => d.frozen || d.ice > 0), `${id}: snow map → shore ice`);
    if (mission.water?.velocity > 0) assert.ok(bodies.some((d) => d.type === 'river' && d.flow), `${id}: river current`);
    let wet = 0;
    for (let k = 0; k < 400; k++) { const x = (k * 7.3) % mission.size[0], z = (k * 13.1) % mission.size[1]; if (wetAt(grid, x, z)) wet++; }
    assert.ok(wet > 0, `${id}: wetAt finds water cells`);
  }
});

test('water: WakeTracker — swimmers ripple, boats make bow + stern + Kelvin arms, entering/dying splashes', () => {
  const calls = [], splashes = [];
  const sink = { disturb: (...a) => calls.push(a) };
  const wet = (x) => x >= 10;
  const w = new WakeTracker(sink, wet, (x, z, s) => splashes.push(s));
  const swimmer = { kind: 'commando', x: 12, z: 0, alive: true, stance: 'swim' };
  const walker = { kind: 'enemy', x: 5, z: 0, alive: true, stance: 'stand' };
  const boat = { kind: 'vehicle', def: { kind: 'boat', size: [8, 2.6] }, x: 20, z: 0, alive: true };
  const truck = { kind: 'vehicle', def: { kind: 'land' }, x: 15, z: 0, alive: true };
  const ents = [swimmer, walker, boat, truck];
  w.update(ents, 1 / 30); // first sight: state only
  assert.equal(calls.length, 0);
  for (let f = 0; f < 30; f++) { swimmer.x += 0.05; boat.x += 0.2; w.update(ents, 1 / 30); }
  assert.ok(calls.length > 10, `wakes emitted (${calls.length})`);
  assert.ok(calls.some((c) => c[0] > boat.x - 0.5 && c[2] < 0), 'bow wave pushes the surface down ahead of the boat');
  assert.ok(!calls.some((c) => Math.abs(c[0] - 15) < 0.01), 'land vehicles make no wake');
  const n0 = splashes.length;
  walker.x = 11; w.update(ents, 1 / 30);
  assert.equal(splashes.length, n0 + 1, 'walking into the water splashes');
  swimmer.alive = false; w.update(ents, 1 / 30);
  assert.equal(splashes.length, n0 + 2, 'dying in the water splashes');
  const n1 = calls.length;
  for (let f = 0; f < 10; f++) { swimmer.x += 0.05; w.update(ents, 1 / 30); }
  assert.ok(calls.every((c, k) => k < n1 || Math.abs(c[0] - swimmer.x) > 0.3), 'dead bodies make no swim wake');
  w.update([boat], 1 / 30);
  assert.equal(w.state.size, 1, 'entities that left the world are forgotten');
  w.update(ents, 0); // paused frame: nothing
});

test('water: the water adapter\'s legacy splash spawns map to the VFX water_splash (scaled by radius)', () => {
  const world = { listen() {} };
  const fx = new FX(world, null);
  fx.lateLayer = FX_LAYER; // the water adapter still sets it (harmless: VFX draw in their own pass after the water)
  const a = fx.spawn('splash', 1, 1, { radius: 0.45, water: true });
  const b = fx.spawn('splash', 1, 1, { radius: 4, water: true, big: true });
  assert.equal(a.kind, 'water_splash');
  assert.ok(a.opts.scale < 0.5 && b.opts.scale >= 1, `small swimmer splash, big grenade column (${a.opts.scale}, ${b.opts.scale})`);
  fx.dispose();
});

test('water: textures shipped in assets/water with licences credited', () => {
  for (const f of ['waternormals.jpg', 'foam2.png', 'LICENSE.md']) assert.ok(existsSync(new URL(`assets/water/${f}`, ROOT)), f);
  const credits = readFileSync(new URL('CREDITS.md', ROOT), 'utf8');
  assert.ok(credits.includes('assets/water/'), 'CREDITS.md lists the water textures');
});

test('water: smooth bank carve — land cells stay dry, wet cells below the surface, no staircase', async () => {
  const { cellSignedDistance, carveDepth, sampleCells } = await import('../../src/art/terrain/terrain.js');
  // diagonal river band (the staircase case)
  const g = toyGrid(40, 40, (i, j) => (Math.abs(i - j) <= 3 ? (Math.abs(i - j) <= 1 ? T.WATER : T.SHALLOW) : 0));
  const wet = sampleCells(cellSignedDistance(g, (t) => t === 5 || t === 6), g), deep = sampleCells(cellSignedDistance(g, (t) => t === 5), g);
  for (let j = 2; j < 38; j++) for (let i = 2; i < 38; i++) {
    const x = (i + 0.5) * 0.5, z = (j + 0.5) * 0.5, y = carveDepth(wet(x, z), deep(x, z));
    const code = g.terrain[j * 40 + i];
    if (code === 0) assert.ok(y > WATER_LEVEL, `land cell (${i},${j}) dry: ${y}`);
    else assert.ok(y < WATER_LEVEL, `wet cell (${i},${j}) under water: ${y}`);
    if (code === T.WATER && Math.abs(i - j) === 0) assert.ok(y < -0.9, `channel deep: ${y}`);
  }
  // the shoreline crossing along a line perpendicular to the band moves smoothly (no 0.5 m jumps across the diagonal)
  const cross = [];
  for (let k = 0; k < 12; k++) {
    const cx = 5 + k * 0.37, cz = cx; // centre of the band
    let s = 0; while (carveDepth(wet(cx + s, cz - s), deep(cx + s, cz - s)) < WATER_LEVEL && s < 5) s += 0.01;
    cross.push(s);
  }
  assert.ok(Math.max(...cross) - Math.min(...cross) < 0.2, `bank distance steady along a diagonal: ${cross.map((v) => v.toFixed(2))}`);
});
