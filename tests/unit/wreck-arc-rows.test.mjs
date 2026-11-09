/**
 * A destroyed fuel structure's wreck stamp (Interactable._stampWreck) lowers the same cells as a test of every cell of the
 * map did, and logs their rows with its version bump (NavGrid._bumpRows): pathfinding's static layers patched over those
 * rows equal a whole rebuild. A gun's traverse arc (Vehicle.gunArc) is kept across a grid change whose dirty rows — or
 * columns — miss its reach (a blast elsewhere: M8's depot vs the guns by the bridge, M14's barrel in the guns' rows 40 m
 * off) and is the arc turretArc works out afresh, every
 * time; a change inside its reach, a plain version bump or a new ground under it recomputes it.
 *   node tests/unit/run.mjs wreck-arc-rows
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { staticLayersOf } from '../../src/world/pathfinding.js';
import { Interactable } from '../../src/entities/interactables.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { turretArc } from '../../src/world/placement.js';
import { fuelWreckNav } from '../../src/art/fuel-tanks.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i] || (Number.isNaN(v) && Number.isNaN(b[i])));

/** A 30 x 24 m grid with blocks of several owners, water, a bridge, nav stamps; owner 77 = the fuel structure. */
function grid(seed) {
  const g = new NavGrid(30, 24), r = rng(seed);
  g.fillRect(4, 3, 5, 3, 'terrain', T.WATER);
  g.fillRect(5, 3, 1, 3, 'bridge', 1);
  for (let n = 0; n < 10; n++) g.fillRect(r() * 26, r() * 20, 0.5 + r() * 3, 0.5 + r() * 3, 'block', 1 + ((r() * 3) | 0), 100 + n);
  g.fillRect(14 + r() * 4, 10 + r() * 4, 3 + r() * 3, 2 + r() * 3, 'block', B.HIGH + ((r() * 2) | 0), 77);
  g.navStamp('n', [3 * g.cols + 9, 7 * g.cols + 30]);
  return g;
}
const tank = (h) => new Interactable({ interactKind: 'explosiveTarget', x: 16, z: 12, owner: 77, destructible: true, structure: { type: 'fueltank', x: 16, z: 12, r: 3, h } });

test('wreck stamp: the same cells lowered as the whole-map test, one version, its rows logged', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const h of [2, 6]) {
    const g = grid(seed), ref = grid(seed), it = tank(h), nav = fuelWreckNav(it.params.structure);
    assert(nav && !nav.deck, 'a fuel structure without a deck');
    // the reference: every cell of the map tested (the stamp as it was)
    const cls = B[nav.block] ?? B.HIGH;
    for (let k = 0; k < ref.size; k++) if (ref.owner[k] === 77 && ref.block[k] > cls) ref.block[k] = cls;
    staticLayersOf(g, false); staticLayersOf(g, true);
    const v0 = g.version, before = g.block.slice();
    it._stampWreck(g, nav);
    assert(same(g.block, ref.block), `seed ${seed} h ${h}: the cells lowered differ`);
    assert(g.version === v0 + 1, 'one version bump');
    const d = g.dirtyRowsSince(v0);
    assert(d, 'the rows are known (a logged bump)');
    for (let k = 0; k < g.size; k++) if (g.block[k] !== before[k]) { const j = (k / g.cols) | 0; assert(j >= d.j0 && j <= d.j1, `row ${j} of a lowered cell is in the log`); }
    // the static layers patched over the logged rows equal a whole rebuild
    const p0 = staticLayersOf(g, false).open[0].slice(), p1 = staticLayersOf(g, true).open[1].slice(), pm = staticLayersOf(g, false).mul.slice();
    g._dirtyLog = null; g.version++;
    assert(same(p0, staticLayersOf(g, false).open[0]) && same(p1, staticLayersOf(g, true).open[1]) && same(pm, staticLayersOf(g, false).mul), 'patched layers = rebuilt');
  }
});

/** gunArc's own state on a stand-in hull (the method as the Vehicle runs it). */
function gun(g, x, z, groundY = () => 0) {
  const world = { grid: g, structures: new Map(), groundY };
  return { world, model: { gun: { len: 2.4, h: 1.1, back: 0.6, hl: 0.8, hw: 0.6, top: 1.6 } }, destroyed: false, x, z, y: 0,
    _groundAt: Vehicle.prototype._groundAt, gunArc: Vehicle.prototype.gunArc, _arcKey: undefined, _arc: undefined, _arcVer: -1, _arcY0: undefined, _arcJ0: 0, _arcJ1: -1, _arcI0: 0, _arcI1: -1 };
}
const freshArc = (v) => { const g = v.model.gun; return turretArc(v.world.grid, v.x, v.z, { len: g.len, h: g.h, back: g.back, housing: { hl: g.hl, hw: g.hw, top: g.top }, heightOf: () => null, y0: Math.max(v.y || 0, v._groundAt(v.x, v.z)) }); };

test('gun arc: kept across changes whose rows miss its reach, always the arc worked out afresh', () => {
  let kept = 0, redone = 0;
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const g = grid(seed), r = rng(seed * 3), v = gun(g, 6 + r() * 18, 4 + r() * 16);
    for (let n = 0; n < 40; n++) {
      const a0 = v.gunArc();
      assert(same(a0, freshArc(v)), `seed ${seed} step ${n}: the arc in hand = a fresh one`);
      const x = r() * 28, z = r() * 22, pick = r();
      if (pick < 0.3) g.navStamp('s' + (n % 3), [((z / g.cell) | 0) * g.cols + ((x / g.cell) | 0)]);
      else if (pick < 0.5) g.fillPoly([[x, z], [x + 1.5, z], [x + 1.5, z + 1.5], [x, z + 1.5]], 'block', B.HIGH, 200 + n);
      else if (pick < 0.65) g.clearOwner(100 + ((r() * 10) | 0));
      else if (pick < 0.8) g.overStamp('o' + (n % 2), new Map([[((z / g.cell) | 0) * g.cols + ((x / g.cell) | 0), [0.8, 1.4]]]));
      else if (pick < 0.9) g.fillRect(x, z, 1, 1, 'block', B.LOW, 300 + n); // a plain version++: recomputed
      else tank(6)._stampWreck(g, fuelWreckNav(tank(6).params.structure));
      const a1 = v.gunArc();
      if (a1 === a0) kept++; else redone++;
      assert(same(a1, freshArc(v)), `seed ${seed} step ${n}: after a change the arc = a fresh one`);
    }
  }
  assert(kept > 20 && redone > 20, `both paths taken (kept ${kept}, redone ${redone})`);
});

test('gun arc: a write inside its reach, a moved hull or a new ground under it are never kept (negative control)', () => {
  const g = new NavGrid(30, 24), v = gun(g, 15, 12);
  const a0 = v.gunArc();
  // a block 1.5 m off the pivot, inside the barrel's reach: a logged write in its rows -> recomputed, and different
  g.fillPoly([[16.2, 11.8], [16.8, 11.8], [16.8, 12.4], [16.2, 12.4]], 'block', B.HIGH, 400);
  const a1 = v.gunArc();
  assert(a1 !== a0 && !same(a1, a0), 'a wall by the gun closes angles');
  assert(same(a1, freshArc(v)), 'and the arc is the fresh one');
  // far rows only: kept
  g.navStamp('far', [1 * g.cols + 2]);
  assert(v.gunArc() === a1, 'a stamp 10 m away keeps it');
  // its own rows but 12 m off to the side (the log's columns): kept too, and still the fresh arc
  const row = ((12 / g.cell) | 0) * g.cols;
  g.navStamp('side', [row + ((27 / g.cell) | 0)]);
  assert(v.gunArc() === a1 && same(a1, freshArc(v)), 'a stamp in its rows beyond its reach keeps it');
  // the same rows, inside its reach: recomputed
  g.navStamp('side', [row + ((16.4 / g.cell) | 0)]);
  const a2 = v.gunArc();
  assert(a2 !== a1 && same(a2, freshArc(v)), 'a stamp in its rows within its reach recomputes it');
  g.navStamp('side', []); v.gunArc();
  // the ground under the pivot rises: recomputed though no row changed
  let gy = 0; v.world.groundY = () => gy;
  v.gunArc(); gy = 0.7; g.navStamp('far', []);
  assert(same(v.gunArc(), freshArc(v)) && v._arcY0 === 0.7, 'a new ground under the pivot recomputes it');
  // the hull moves: recomputed
  v.x += 1; g.navStamp('far', [1 * g.cols + 3]);
  assert(same(v.gunArc(), freshArc(v)), 'a moved hull recomputes it');
});
