/**
 * Gameplay never depends on the graphics preset (user 2026-10-22: the M3 walkthrough at preset=low drifted off the logic
 * run and timed out in stage I). The end-to-end guard is the browser test tests/preset-determinism.test.mjs (every
 * mission loaded cold at 'low' and 'high', its gameplay world fingerprinted); these are the cheap node-side halves:
 *  - the library buildings' LOD0 (what the gameplay stamps measure) is preloaded for the placed models at every quality;
 *  - the physics tier never changes a gameplay cap (gate smash at every tier: tests/unit/gate-smash.test.mjs);
 *  - the trees gameplay measures are one fixed quality (art/terrain/vegetation.js GAMEPLAY_TREES).
 */
import { test, assert } from './lib.mjs';
import { loadBuildingLibrary, preloadJobs } from '../../src/art/building-library.js';
import { CONFIG } from '../../src/config.js';
import { GAMEPLAY_TREES, MAX_UNIQUE } from '../../src/art/terrain/vegetation.js';
import { TREE_QUALITY } from '../../src/art/terrain/treegen.js';

const lod = (n, i) => ({ url: `buildings/${n}_lod${i}.glb`, bytes: 1 });
const asset = (n, extra = {}) => ({ lods: [lod(n, 0), lod(n, 1), lod(n, 2)], theaters: ['temperate'], ...extra });
const MANIFEST = {
  assets: {
    cabin: asset('cabin', { snowVariant: 'cabin_snow', destroyedVariant: 'cabin_ruin' }),
    cabin_snow: asset('cabin_snow', { theaters: ['snow'], base: 'cabin' }),
    cabin_ruin: asset('cabin_ruin'),
    shed: asset('shed', { destroyedVariant: 'shed_ruin' }),
    shed_ruin: asset('shed_ruin'),
  },
  types: {},
};

test('preset: at "low" the placed library models still preload their LOD0 (the gameplay stamps measure it)', async () => {
  try {
    await loadBuildingLibrary(null, { manifest: MANIFEST, quality: 'low' });
    const jobs = preloadJobs(['cabin_snow', 'shed'], { theater: 'snow', placed: ['cabin_snow', 'shed_ruin'] }).map(([n, i]) => `${n}#${i}`);
    for (const k of ['cabin_snow#0', 'shed_ruin#0']) assert.ok(jobs.includes(k), `${k} (a placed model's LOD0) preloaded at 'low': ${jobs}`);
    assert.ok(!jobs.includes('shed#0') && !jobs.includes('cabin_ruin#0'), `'low' still skips the LOD0 of models it never draws: ${jobs}`);
    for (const k of ['cabin_snow#1', 'cabin_snow#2', 'shed#1', 'shed_ruin#2', 'cabin_ruin#1']) assert.ok(jobs.includes(k), `${k}`);
    assert.equal(new Set(jobs).size, jobs.length, 'no LOD loaded twice');
    await loadBuildingLibrary(null, { manifest: MANIFEST, quality: 'default' });
    const all = preloadJobs(['shed'], { placed: ['shed'] }).map(([n, i]) => `${n}#${i}`);
    assert.deepEqual(all.sort(), ['shed#0', 'shed#1', 'shed#2', 'shed_ruin#0', 'shed_ruin#1', 'shed_ruin#2']);
  } finally {
    await loadBuildingLibrary(null, { manifest: MANIFEST, quality: 'default' }); // (the next suites set their own manifest)
  }
});

test('preset: the physics tier never changes a gameplay cap (ragdolls, props, gate pieces)', () => {
  const P = CONFIG.physics;
  for (const k of ['ragdolls', 'props', 'gatePieces']) assert.ok(Number.isFinite(P.gameplayCaps[k]), `gameplayCaps.${k}`);
  for (const [tier, caps] of Object.entries(P.caps)) {
    const merged = { ...P.gameplayCaps, ...caps };
    for (const [k, v] of Object.entries(P.gameplayCaps)) assert.equal(merged[k], v, `tier '${tier}' keeps gameplayCaps.${k}`);
  }
});

test('preset: the trees gameplay measures are one fixed quality, whatever the preset draws', () => {
  assert.ok(TREE_QUALITY[GAMEPLAY_TREES] && MAX_UNIQUE[GAMEPLAY_TREES], `GAMEPLAY_TREES '${GAMEPLAY_TREES}' is a tree quality`);
  // ('high': the set every recorded run was made on — changing it moves the gun-arc branch cells of every mission)
  assert.equal(GAMEPLAY_TREES, 'high');
});
