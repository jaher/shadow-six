/**
 * The gameplay world never depends on how or when the art loads (user 2026-10-22: a walkthrough opened from a cold link
 * must play the tested run, checkpoint for checkpoint — "a live run that diverges from the tested run can end
 * differently"). On a 4 Mbit/s link M2's library buildings came in past the load's 25 s race: the map was stamped on
 * buildings still loading and the run drifted (D1 at 293.17 s instead of 293.37). The browser guard is
 * tests/debug-walkthrough-cold.test.mjs; here, the pure parts:
 *  - engine/gameplay-inputs.js: a gameplay input is awaited however long it takes (logged while it is slow), never raced;
 *  - the library preload's gameplay part is exactly the placed models' LOD0 (what the map's stamps measure);
 *  - the gameplay water level (world.waterLevelAt, the Marine's low-deck test) comes from the grid, not from the drawn
 *    water (built at no fixed time, and its M3 reservoir drained per displayed frame — never in a logic-only run): the
 *    same level as the drawn water's levelAt at every cell of every mission with water, the drawdown in game time.
 */
import { test, assert, near } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { awaitGameplayInput } from '../../src/engine/gameplay-inputs.js';
import { loadBuildingLibrary, preloadJobs } from '../../src/art/building-library.js';
import { gameplayWaterLevel, drainedLevel, waterBodyDescriptors, WATER_LEVEL, RESERVOIR_DRAWDOWN, DRAIN_S } from '../../src/art/water.js';
import { waterBodiesFromGrid } from '../../src/art/water/grid.js';
import { WaterSystem } from '../../src/art/water/index.js';
import { MISSIONS, getMission } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('gameplay inputs: awaited however long they take, a slow one logged while it is pending', async () => {
  const warn = console.warn, seen = [];
  console.warn = (m) => seen.push(String(m));
  try {
    const v = await awaitGameplayInput(new Promise((ok) => setTimeout(() => ok(42), 60)), 'the test input', { everyMs: 15 });
    assert.equal(v, 42);
    assert.ok(seen.length >= 2 && seen.every((m) => /still waiting for the test input/.test(m)), `logged while pending (${seen.length})`);
    const n = seen.length;
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(seen.length, n, 'no log once it is in');
    assert.equal(await awaitGameplayInput(7, 'a plain value'), 7);
  } finally { console.warn = warn; }
});

test('gameplay inputs: the load never races what the gameplay world measures against a clock', () => {
  const game = src('src/game.js'), props = src('src/art/building-props.js');
  assert.match(game, /awaitGameplayInput\(gp, /, 'Game.loadMission awaits the map\'s gameplay stamps unbounded');
  assert.doesNotMatch(game, /Promise\.race\(\[gp,/, 'never gp raced');
  assert.match(game, /awaitGameplayInput\(Promise\.allSettled\(dressed\.map/, 'the static vehicles\' models unbounded');
  assert.match(props, /await awaitGameplayInput\(preloadBuildings\(\[\], \{ theater, placed: \[\.\.\.placed\], lods: \[\] \}\)/, 'the placed LOD0 before the map build');
  const mb = src('src/world/map-builder.js');
  assert.match(mb, /gameplayReady: Promise\.all\(\[branchesStamped\.catch\(\(\) => null\), \.\.\.lateGameplay\]\)/, 'gameplayReady covers the late stamps');
  assert.match(mb, /lateGameplay\.push\(after\(libReady\)/, 'the late library re-stamp is a gameplay step before play');
  assert.doesNotMatch(mb, /setTimeout\(cal, 1000\)/, 'no deck calibration retried by a free timer during play');
});

test('gameplay inputs: the library preload\'s gameplay part is the placed models\' LOD0, nothing else', async () => {
  const manifest = JSON.parse(src('assets/models/buildings/manifest.json'));
  await loadBuildingLibrary(null, { manifest });
  const names = Object.keys(manifest.assets).filter((n) => manifest.assets[n].lods?.length >= 2).slice(0, 4);
  const jobs = preloadJobs([], { placed: names, lods: [] }).map(([n, i]) => `${n}#${i}`);
  assert.deepEqual(jobs, names.map((n) => `${n}#0`));
});

test('gameplay water level: the drawn water\'s levelAt at every cell of every mission with water, from the grid alone', () => {
  let missions = 0, raised = 0;
  for (const m of MISSIONS) {
    const { def, world, grid } = loadGrid(getMission(m.id));
    if (!grid.terrain.some((t) => t === 5 || t === 6)) continue;
    missions++;
    assert.equal(typeof world.waterLevelAt, 'function', `${m.id}: the map build sets world.waterLevelAt`);
    // the drawn water's own query over bodies made from the same descriptors (WaterSystem.levelAt reads body.o.mask, body.level)
    const descs = waterBodyDescriptors(grid, def, def.theater || 'temperate', waterBodiesFromGrid);
    const drawn = { bodies: descs.map((d) => ({ o: d, level: d.level })), sample: () => null };
    if (descs.some((d) => d.raised)) raised++;
    let bad = 0, first = null;
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
      const x = (i + 0.5) * grid.cell, z = (j + 0.5) * grid.cell;
      const a = world.waterLevelAt(x, z), b = WaterSystem.prototype.levelAt.call(drawn, x, z);
      if (a !== b) { bad++; first ??= `(${x},${z}) ${a} vs ${b}`; }
    }
    assert.equal(bad, 0, `${m.id}: ${bad} cells differ, e.g. ${first}`);
  }
  assert.ok(missions >= 8 && raised >= 1, `missions with water ${missions}, with raised water ${raised}`);
});

test('gameplay water level: M3\'s reservoir draws down in game time once its dam is gone (no frame needed)', () => {
  const { def, world, grid } = loadGrid(getMission('m03'));
  const descs = waterBodyDescriptors(grid, def, def.theater, waterBodiesFromGrid);
  const res = descs.find((d) => d.raised?.drainOn);
  assert.ok(res, 'M3 has a reservoir drained by its dam');
  // a cell of it
  let p = null;
  for (let j = 0; j < grid.rows && !p; j++) for (let i = 0; i < grid.cols && !p; i++) { const x = (i + 0.5) * grid.cell, z = (j + 0.5) * grid.cell; if (res.mask(x, z)) p = [x, z]; }
  const L = res.level, to = Math.max(WATER_LEVEL, L - RESERVOIR_DRAWDOWN);
  world.time = 100;
  near(world.waterLevelAt(...p), L, 1e-12, 'held up by the dam');
  world.events.emit('structure:destroyed', { id: res.raised.drainOn });
  near(world.waterLevelAt(...p), L, 1e-12, 'the breach: still full');
  for (const s of [5, 13.3, 20, 39.9]) {
    world.time = 100 + s;
    near(world.waterLevelAt(...p), drainedLevel(L, to, s / DRAIN_S), 1e-12, `${s} s after`);
  }
  world.time = 100 + DRAIN_S + 30;
  near(world.waterLevelAt(...p), to, 1e-12, 'drawn down and holding');
  assert.ok(drainedLevel(L, to, 0.25) - to < (L - to) * 0.5, 'fast at first');
  // another world loaded with the dam already down: drawn down at once
  const w2 = loadGrid(getMission('m03')).world;
  const dam = { destroyed: true };
  w2.byId = (id) => (id === res.raised.drainOn ? dam : null);
  near(w2.waterLevelAt(...p), to, 1e-12, 'loaded with the dam down');
});
