/**
 * pathfinding's A* on foot or swimming runs in hotRun (its own function over the step masks, so the optimised loop is
 * not thrown away with the rest of searchPath: M14's barrel blast, M20's HQ blast — a 25 713-cell search 12.6 ms
 * unoptimised, ~4.5 optimised). It must be the very search searchPath's own loop is: the same path, the same cells
 * counted (searchStats: the investigation budget reads it), the same failures — with and without the step masks, over
 * walls, water and a bridge, raised decks, stair runs, ladders and climbs (links, role-gated), nav stamps, the
 * vehicles' layer (dynamic), body-clearance masks (avoid, over a ladder's end too: the retry with its ends open), fires,
 * a node cap, and searches long enough to pass the area and pocket checks. Twin worlds run the same searches in the
 * same order (searchTuning): hotRun, searchPath's own loop over the step masks, its cell-by-cell fast path without
 * them, and the grid's own tests without any static layer.
 *   node tests/unit/run.mjs search-hot
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { findPath, searchStats, searchTuning, AREAS_AT, POCKET_AT } from '../../src/world/pathfinding.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** A map big enough for long searches: rooms of walls, a river with a bridge, a deck up a ladder, a stair run. */
function world(seed) {
  const g = new NavGrid(110, 90), r = rng(seed);
  g.fillRect(0, 20, 55, 4, 'terrain', T.WATER); // a river across the west half, a bridge over it
  g.fillRect(20, 20, 2, 4, 'bridge', 1);
  g.fillRect(70, 60, 10, 8, 'elev', 2.5); // a raised deck: its ladder, or the stair run up its side
  g.addLink('ladder', { x: 69.25, z: 63.25 }, { x: 70.75, z: 63.25, y: 2.5 });
  g.fillRect(80, 62, 4, 2, 'elev', 1.2);
  g.addRun({ pts: [[84.5, 63], [79.5, 63]], w: 2, lane: 1.5 });
  g.addLink('climb', { x: 5.25, z: 5.25 }, { x: 5.25, z: 40.25 }, { roles: ['greenberet'] });
  g.addLink('ladder', { x: 30.25, z: 30.25 }, { x: 30.25, z: 33.25 }, { walk: 'stairs' });
  for (let n = 0; n < 40; n++) {
    const x = r() * 104, z = r() * 84, long = r() < 0.6;
    g.fillRect(x, z, long ? 10 + r() * 20 : 0.5, long ? 0.5 : 8 + r() * 14, 'block', B.HIGH, 100 + n);
  }
  g.navStamp('a', Array.from({ length: 120 }, () => (r() * g.size) | 0));
  return g;
}

/** The searches, the same list for every world: random ends and rules, some with a clearance mask or the vehicles. */
function searches(seed, g) {
  const r = rng(seed * 7 + 3), out = [], N = g.size;
  const masks = [null, new Uint8Array(N), new Uint8Array(N)];
  for (let k = 0; k < N; k++) { if (r() < 0.04) masks[1][k] = 1; if (r() < 0.12) masks[2][k] = 1; }
  // (a mask over a ladder's end: the search notes it, and findPath runs again with the ends open)
  for (const L of g.links) masks[2][L.ka] = 1;
  for (let n = 0; n < 70; n++) {
    out.push({
      a: [r() * 108 + 0.5, r() * 88 + 0.5], b: [r() * 108 + 0.5, r() * 88 + 0.5],
      opts: {
        swim: r() < 0.2, dynamic: r() < 0.3, role: [undefined, 'enemy', 'greenberet'][(r() * 3) | 0], noLinks: r() < 0.15,
        noWalkLinks: r() < 0.1, avoid: masks[(r() * 3) | 0] || undefined, maxNodes: r() < 0.1 ? 300 + ((r() * 3000) | 0) : undefined, memo: n >> 3,
      },
    });
  }
  return out;
}

/** Fires as world/fires.js keeps them in the grid: a count per cell (`fire`), `fireCells` burning, `fireVersion` bumped on
 * a change — a patch catching, now and then one on a ladder's end, now and then all out. */
function burn(g, fr) {
  const x = fr();
  if (x < 0.35) {
    const ci = (fr() * g.cols) | 0, cj = (fr() * g.rows) | 0, rad = 1 + ((fr() * 9) | 0);
    for (let j = cj - rad; j <= cj + rad; j++) for (let i = ci - rad; i <= ci + rad; i++) {
      if (i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.fire[j * g.cols + i]++ === 0) g.fireCells++;
    }
    g.fireVersion++;
  } else if (x < 0.42) {
    const L = g.links[(fr() * g.links.length) | 0], k = fr() < 0.5 ? L.ka : L.kb;
    if (g.fire[k]++ === 0) g.fireCells++;
    g.fireVersion++;
  } else if (x < 0.5 && g.fireCells) { g.fire.fill(0); g.fireCells = 0; g.fireVersion++; }
}

/** Run the searches on world `seed` under the tuning given: [path JSON, cells counted] per search. `writes`: the grid
 * changed between searches as a blast's tick changes it (a structure's cells cleared, nav stamps, an overhang lifted,
 * a raised floor) — the layers, step masks and walk areas carried from version to version. `fires`: fires catch and go
 * out between searches, and most searches keep out of them (the enemies' `fire` option). */
function run(seed, tuning, writes = false, fires = false) {
  const g = world(seed), list = searches(seed, g), out = [];
  const r = rng(seed + 99), w = rng(seed + 7), fr = rng(seed + 4242);
  Object.assign(searchTuning, tuning);
  try {
    for (const q of list) {
      // (the vehicles' layer: a hull stamped now and then, as Game.step restamps it)
      if (q.opts.dynamic) { g.clearDynamic(); g.stampDynamic(r() * 100 + 5, r() * 80 + 5, 6, 3, r() * 3); }
      if (writes) {
        const x = w() * 100, z = w() * 80, n = (w() * 5) | 0;
        if (n === 0) g.clearOwner(100 + ((w() * 40) | 0));
        else if (n === 1) g.navStamp('blast' + ((w() * 3) | 0), Array.from({ length: 30 }, () => (((z + w() * 6) / g.cell | 0) * g.cols + ((x + w() * 6) / g.cell | 0))));
        else if (n === 2) g.overStamp('o' + ((w() * 2) | 0), new Map([[((z / g.cell) | 0) * g.cols + ((x / g.cell) | 0), [1, 2]]]));
        else if (n === 3) g.fillPoly([[x, z], [x + 3, z], [x + 3, z + 2], [x, z + 2]], 'elev', w() < 0.5 ? 0.4 : 1.5);
        else g.fillPoly([[x, z], [x + 4, z], [x + 2, z + 3]], 'block', w() < 0.5 ? B.HIGH : B.NONE, 200 + ((w() * 4) | 0));
      }
      if (fires) burn(g, fr);
      const opts = fires && fr() < 0.7 ? { ...q.opts, fire: g.fire } : q.opts;
      const e0 = searchStats.expanded, p = findPath(g, q.a[0], q.a[1], q.b[0], q.b[1], opts);
      out.push([JSON.stringify(p), searchStats.expanded - e0]);
    }
  } finally { Object.assign(searchTuning, { hot: true, steps: true, layers: true }); }
  return out;
}

test('search hot loop: the same paths and counts as the general loop, with and without step masks', () => {
  let long = 0, found = 0, none = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const hot = run(seed, { hot: true, steps: true }), gen = run(seed, { hot: false, steps: true }), bare = run(seed, { hot: false, steps: false });
    for (let n = 0; n < hot.length; n++) {
      assert.equal(hot[n][0], gen[n][0], `seed ${seed} search ${n}: path (hot vs general loop)`);
      assert.equal(hot[n][1], gen[n][1], `seed ${seed} search ${n}: cells counted (hot vs general loop)`);
      assert.equal(hot[n][0], bare[n][0], `seed ${seed} search ${n}: path (hot vs no step masks)`);
      assert.equal(hot[n][1], bare[n][1], `seed ${seed} search ${n}: cells counted (hot vs no step masks)`);
      if (hot[n][1] > POCKET_AT) long++;
      if (hot[n][0] !== 'null') found++; else none++;
    }
  }
  // (the cases the loop hands back are met: searches past both milestones, found and failed ones)
  assert.ok(long >= 10, `long searches (past ${AREAS_AT} / ${POCKET_AT} cells): ${long}`);
  assert.ok(found >= 100 && none >= 10, `found ${found}, failed ${none}`);
});

test('search hot loop: with the grid written between searches, the same as reading the grid itself', () => {
  // (the static layers, step masks and walk areas carried over each version's changed cells — staticLayers' row path
  // over the dirty log's rectangle, relabelOpened, the cell chains carried — against searches that read the grid's own
  // layers cell by cell)
  let changed = 0;
  for (const seed of [11, 12, 13, 14]) {
    const hot = run(seed, { hot: true, steps: true, layers: true }, true), raw = run(seed, { hot: false, steps: false, layers: false }, true);
    for (let n = 0; n < hot.length; n++) {
      assert.equal(hot[n][0], raw[n][0], `seed ${seed} search ${n}: path (hot loop over carried layers vs the grid read cell by cell)`);
      assert.equal(hot[n][1], raw[n][1], `seed ${seed} search ${n}: cells counted`);
    }
    const still = run(seed, { hot: true, steps: true, layers: true }, false);
    for (let n = 0; n < hot.length; n++) if (still[n][0] !== hot[n][0]) changed++;
  }
  assert.ok(changed >= 20, `the writes change the searches' answers (${changed})`);
});

test('search hot loop: a goal in a pocket shut but for a corner the search may not cut gives up at POCKET_AT, as the general loop does', () => {
  // (rooms whose only way out is a diagonal step between two cells the search will not take: past a wall's corner, or
  // past two raised cells it cannot step onto — the walk areas, which know no corners, join them to the rest; the goal's
  // pocket — goalPocketExcludes / goalPocketExcludesOpen — does not, and the search stops at its count)
  for (const kind of ['wall', 'raised']) {
    const make = () => {
      const g = new NavGrid(60, 60), c = g.cell, i0 = 60, j0 = 60, n = 20; // the room: cells [i0, i0 + n) x [j0, j0 + n)
      const ring = [];
      for (let t = -1; t <= n; t++) ring.push([i0 + t, j0 - 1], [i0 + t, j0 + n], [i0 - 1, j0 + t], [i0 + n, j0 + t]);
      for (const [i, j] of ring) {
        if (i === i0 - 1 && j === j0 - 1) continue; // (the ring's corner open: the room's corner cell meets it diagonally only)
        if (kind === 'wall') g.fillRect(i * c, j * c, c, c, 'block', B.HIGH, 7); else g.fillRect(i * c, j * c, c, c, 'elev', 1.5);
      }
      return g;
    };
    const runOne = (tuning) => {
      const g = make();
      Object.assign(searchTuning, tuning);
      try {
        const e0 = searchStats.expanded, p = findPath(g, 2, 2, 35, 35, { role: 'enemy', memo: 1 });
        return [JSON.stringify(p), searchStats.expanded - e0];
      } finally { Object.assign(searchTuning, { hot: true, steps: true, layers: true }); }
    };
    const hot = runOne({ hot: true, steps: true, layers: true }), raw = runOne({ hot: false, steps: false, layers: false });
    assert.equal(hot[0], 'null', `${kind}: no way in`);
    assert.equal(hot[1], POCKET_AT, `${kind}: given up at POCKET_AT cells (${hot[1]})`);
    assert.deepEqual(hot, raw, `${kind}: the same as the general loop's own pocket`);
  }
});

test('search hot loop: with fires burning (the enemies keep out of them), the same as the general loop', () => {
  // (the grid's fire layer — world/fires.js — is no static layer: read cell by cell like the vehicles' layer and a
  // clearance mask, in the hot loop, its goal's pocket and its ladder-end note alike; a burning ladder end is no end)
  let changed = 0, fired = 0;
  for (const seed of [21, 22, 23, 24, 25]) {
    const hot = run(seed, { hot: true, steps: true, layers: true }, false, true), gen = run(seed, { hot: false, steps: true, layers: true }, false, true);
    const raw = run(seed, { hot: false, steps: false, layers: false }, false, true), still = run(seed, { hot: true, steps: true, layers: true });
    for (let n = 0; n < hot.length; n++) {
      assert.equal(hot[n][0], gen[n][0], `seed ${seed} search ${n}: path (hot vs general loop, fires)`);
      assert.equal(hot[n][1], gen[n][1], `seed ${seed} search ${n}: cells counted (hot vs general loop, fires)`);
      assert.equal(hot[n][0], raw[n][0], `seed ${seed} search ${n}: path (hot vs the grid read cell by cell, fires)`);
      assert.equal(hot[n][1], raw[n][1], `seed ${seed} search ${n}: cells counted (hot vs the grid read cell by cell, fires)`);
      if (still[n][0] !== hot[n][0]) changed++;
      if (hot[n][1] > POCKET_AT) fired++;
    }
  }
  assert.ok(changed >= 15, `the fires change the searches' answers (${changed})`);
  assert.ok(fired >= 5, `long searches among them (${fired})`);
});

test('search hot loop: a goal shut in by fire gives up at POCKET_AT, as the general loop does', () => {
  // (a room whose only door burns: the goal's pocket — goalPocketExcludesOpen — reads the fire layer as the search does; the walk
  // areas, which know no fire, join the room to the rest)
  const make = (burning) => {
    const g = new NavGrid(60, 60), c = g.cell, i0 = 60, j0 = 60, n = 20;
    for (let t = -1; t <= n; t++) {
      for (const [i, j] of [[i0 + t, j0 - 1], [i0 + t, j0 + n], [i0 - 1, j0 + t], [i0 + n, j0 + t]]) {
        if (i === i0 - 1 && (j === j0 + 5 || j === j0 + 6)) continue; // (the door: two cells of the west wall)
        g.fillRect(i * c, j * c, c, c, 'block', B.HIGH, 7);
      }
    }
    if (burning) { for (const j of [j0 + 5, j0 + 6]) if (g.fire[j * g.cols + i0 - 1]++ === 0) g.fireCells++; g.fireVersion++; }
    return g;
  };
  const runOne = (tuning, burning) => {
    const g = make(burning);
    Object.assign(searchTuning, tuning);
    try {
      const e0 = searchStats.expanded, p = findPath(g, 2, 2, 35, 35, { role: 'enemy', memo: 1, fire: g.fire });
      return [JSON.stringify(p), searchStats.expanded - e0];
    } finally { Object.assign(searchTuning, { hot: true, steps: true, layers: true }); }
  };
  const hot = runOne({ hot: true, steps: true, layers: true }, true), raw = runOne({ hot: false, steps: false, layers: false }, true);
  assert.equal(hot[0], 'null', 'no way in through the flames');
  assert.equal(hot[1], POCKET_AT, `given up at POCKET_AT cells (${hot[1]})`);
  assert.deepEqual(hot, raw, 'the same as the general loop');
  assert.notEqual(runOne({ hot: true, steps: true, layers: true }, false)[0], 'null', 'in through the door when it does not burn');
});

test('search hot loop: a ladder end on fire is no end to note (the retry with the ends open), as the general loop has it', () => {
  // (a walkway a step above the ground, a ladder's end at its foot under a clearance mask, met over the step the static
  // rules shut: the note — findPath then searches again with the ladders' ends open — only for an end a man can stand on)
  const runOne = (tuning, burning) => {
    const g = new NavGrid(40, 40);
    g.fillRect(5, 10, 30, 1, 'elev', 1.5); // (the walkway: rows j 20-21)
    g.addLink('ladder', { x: 20.25, z: 11.25 }, { x: 20.25, z: 20.25 }); // (its end ka at the walkway's foot, row 22)
    const ka = g.links[0].ka, avoid = new Uint8Array(g.size);
    avoid[ka] = 1;
    for (let j = 20; j <= 21; j++) avoid[j * g.cols + 50] = 1; // (the walkway shut to this search at x 25 m: no way on)
    if (burning) { g.fire[ka] = 1; g.fireCells = 1; g.fireVersion++; }
    Object.assign(searchTuning, tuning);
    try {
      const e0 = searchStats.expanded, p = findPath(g, 7.25, 10.25, 30.25, 10.25, { role: 'enemy', avoid, fire: g.fire });
      return [JSON.stringify(p), searchStats.expanded - e0];
    } finally { Object.assign(searchTuning, { hot: true, steps: true, layers: true }); }
  };
  const hot = runOne({ hot: true, steps: true, layers: true }, true), raw = runOne({ hot: false, steps: false, layers: false }, true);
  const hot0 = runOne({ hot: true, steps: true, layers: true }, false), raw0 = runOne({ hot: false, steps: false, layers: false }, false);
  assert.equal(hot[0], 'null');
  assert.deepEqual(hot, raw, 'burning end: the same as the general loop');
  assert.deepEqual(hot0, raw0, 'standing end: the same as the general loop');
  assert.ok(hot0[1] > hot[1], `the standing end is noted (a second search: ${hot0[1]} cells), the burning one not (${hot[1]})`);
});
