/**
 * The work a structure's fall does in its blast's tick (M18's bridge: the one own-tick over 16 ms of its walkthrough):
 *  - NavGrid.clearOwner scans with TypedArray indexOf: the same cells cleared, the same rows bumped, as a cell loop;
 *  - navStamp / hullStamp mark dirty only the rows whose counts change (a re-stamp over the whole map that changes a
 *    few cells by the bridge left every row to redo): the patched static layers still equal a whole rebuild;
 *  - `silentDestroy` (structure def): no noise of its own (its charges were heard map-wide that tick);
 *  - `blastR` (structure def): the shock wave's radius in its 'explosion' event, which the physics queue takes as the
 *    blast's radius (its event radius — the visuals', the alarm's — unchanged).
 *   node tests/unit/run.mjs collapse-tick
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { staticLayersOf } from '../../src/world/pathfinding.js';
import { makeWorld } from './ai-harness.mjs';
import { Interactable } from '../../src/entities/interactables.js';
import { PhysicsWorld } from '../../src/physics/world-physics.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

test('clearOwner (indexOf scan) clears exactly the cell loop\'s cells and bumps the same rows', () => {
  for (const seed of [1, 2, 3]) {
    const r = rng(seed), a = new NavGrid(60, 40), b = new NavGrid(60, 40);
    for (const g of [a, b]) { const q = rng(seed); for (let n = 0; n < 20; n++) g.fillRect(q() * 56, q() * 36, 0.5 + q() * 4, 0.5 + q() * 4, 'block', B.HIGH, 100 + (n % 5)); g.fillRect(10, 10, 8, 2, 'bridge', 1, 101); }
    const owner = 100 + ((r() * 5) | 0);
    // the reference: the cell loop clearOwner ran before
    let n = 0, k0 = -1, k1 = -1;
    for (let k = 0; k < b.size; k++) if (b.owner[k] === owner) { b.block[k] = B.NONE; b.bridge[k] = 0; b.owner[k] = 0; if (k0 < 0) k0 = k; k1 = k; n++; }
    if (n) b._bumpRows((k0 / b.cols) | 0, (k1 / b.cols) | 0);
    const v = a.version, got = a.clearOwner(owner);
    assert.equal(got, n, 'cells cleared');
    for (const L of ['block', 'bridge', 'owner']) assert.ok(a[L].every((x, k) => x === b[L][k]), `${L} layer`);
    assert.deepEqual(a.dirtyRowsSince(v), n ? b.dirtyRowsSince(v) : a.dirtyRowsSince(v), 'dirty rows');
    assert.equal(a.clearOwner(owner), 0, 'nothing left to clear');
  }
});

test('navStamp / hullStamp: dirty rows are the rows of the cells that change; patched layers equal a rebuild', () => {
  const g = new NavGrid(40, 30), cols = g.cols;
  g.fillRect(10, 5, 6, 3, 'terrain', T.WATER);
  const row = (j, i0, i1) => Array.from({ length: i1 - i0 }, (_, i) => j * cols + i0 + i);
  const big = [...row(2, 0, 40), ...row(30, 0, 40), ...row(55, 0, 40)];
  g.navStamp('head', big);
  staticLayersOf(g, false); staticLayersOf(g, true);
  let v = g.version;
  g.navStamp('head', big); // the same set again: nothing changes
  const d0 = g.dirtyRowsSince(v);
  assert.ok(d0 && !(d0.j1 >= d0.j0), `an unchanged re-stamp dirties no row (${JSON.stringify(d0)})`);
  v = g.version;
  g.navStamp('head', [...big.filter((k) => k !== 30 * cols + 5), 31 * cols + 7]); // one cell off row 30, one onto row 31
  assert.deepEqual(g.dirtyRowsSince(v), { j0: 30, j1: 31 }, 'only the rows that changed');
  v = g.version;
  g.hullStamp('hull', row(10, 3, 9)); g.hullStamp('hull', row(10, 3, 9));
  assert.deepEqual(g.dirtyRowsSince(v), { j0: 10, j1: 10 }, 'hull: the first stamp\'s row only');
  // the patched layers (staticLayers redoes the dirty rows) equal a whole rebuild
  const p0 = staticLayersOf(g, false).open[0].slice(), p1 = staticLayersOf(g, true).open[1].slice(), pm = staticLayersOf(g, false).mul.slice();
  g._dirtyLog = null; g.version++;
  assert.ok(staticLayersOf(g, false).open[0].every((x, k) => x === p0[k]), 'open (walk)');
  assert.ok(staticLayersOf(g, true).open[1].every((x, k) => x === p1[k]), 'open (swim)');
  assert.ok(staticLayersOf(g, false).mul.every((x, k) => x === pm[k]), 'step costs');
});

function structureWorld(params) {
  const w = makeWorld({ size: [80, 80] });
  const it = new Interactable({ interactKind: 'explosiveTarget', tag: 's1', x: 40, z: 40, radius: 20, destructible: true, ...params });
  w.add(it);
  w.rebuildSpatial();
  const noises = [], blasts = [];
  const emitNoise = w.emitNoise?.bind(w);
  w.emitNoise = (...a) => { noises.push(a); return emitNoise?.(...a); };
  w.events.on('explosion', (e) => blasts.push(e));
  return { w, it, noises, blasts };
}

test('silentDestroy: the structure\'s fall makes no noise of its own; blastR rides its explosion event', () => {
  const plain = structureWorld({});
  plain.it.destroy(null, 'explosion');
  assert.equal(plain.noises.length, 1, 'a plain structure\'s fall is heard (40 m)');
  assert.equal(plain.blasts.at(-1)?.radius, 40, 'event radius: twice its radius');
  assert.equal(plain.blasts.at(-1)?.blastR, undefined, 'no blastR');
  const quiet = structureWorld({ structure: { silentDestroy: true, blastR: 12 } });
  quiet.it.destroy(null, 'explosion');
  assert.equal(quiet.noises.length, 0, 'silentDestroy: no noise');
  assert.equal(quiet.blasts.at(-1)?.radius, 40, 'the event radius stays (visuals, alarm)');
  assert.equal(quiet.blasts.at(-1)?.blastR, 12, 'blastR in the event');
});

test('blastR: the physics queue takes it as the blast\'s radius', () => {
  const pw = Object.create(PhysicsWorld.prototype);
  pw.world = { tick: 7 };
  pw.blasts = [];
  pw.queueBlast({ x: 1, z: 2, radius: 40, kind: 'structure' });
  pw.queueBlast({ x: 1, z: 2, radius: 40, kind: 'structure', blastR: 12 });
  assert.equal(pw.blasts[0].radius, 40, 'no blastR: the event radius');
  assert.equal(pw.blasts[1].radius, 12, 'blastR');
  assert.equal(pw.blasts[1].tick, 7);
});
