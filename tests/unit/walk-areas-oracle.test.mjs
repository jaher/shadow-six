/**
 * pathfinding's walk areas (areasFor: which cells a search can join at all) for a new grid version brought up to date
 * from the last labelling when the grid changed in known rows and columns only (relabelOpened: a structure's cells
 * cleared, a nav stamp lifted or laid — a blast's tick; opened cells join areas, shut ones split them or leave a pocket
 * of its own) hold exactly the areas of a flood of the whole grid: checked against an independent flood here (open
 * cells, the 8 neighbours, the elevation step and a stair run's sides either way, the links a role may take), over
 * random sequences of grid writes that open, close, re-step and re-link. A height or stair-run write is a plain bump
 * (no rows known): a flood of its own.
 *   node tests/unit/run.mjs walk-areas
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T, MAX_STEP } from '../../src/world/grid.js';
import { areaLabelsOf } from '../../src/world/pathfinding.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** A small map: water with a bridge, walls (owned, so a blast can clear them), a raised deck with a ladder, stamps. */
function world(seed) {
  const g = new NavGrid(40, 30), r = rng(seed);
  g.fillRect(10, 5, 6, 3, 'terrain', T.WATER);
  g.fillRect(12, 5, 1, 3, 'bridge', 1);
  g.fillRect(28, 18, 6, 6, 'elev', 2.5); // a deck: reached by its ladder only
  for (let n = 0; n < 16; n++) {
    const x = r() * 36, z = r() * 26, long = r() < 0.5; // walls long enough to split the map into rooms
    g.fillRect(x, z, long ? 8 + r() * 10 : 0.5, long ? 0.5 : 6 + r() * 8, 'block', B.HIGH, 100 + n);
  }
  g.addLink('ladder', { x: 27.25, z: 20.25 }, { x: 28.75, z: 20.25, y: 2.5 });
  g.addLink('climb', { x: 5.25, z: 5.25 }, { x: 5.25, z: 25.25 }, { roles: ['greenberet'] });
  g.navStamp('a', Array.from({ length: 40 }, () => (r() * g.size) | 0));
  return g;
}

/** The areas by an independent flood (the labelling's own rules, written again), canonical: each cell's area named by
 * its first cell. */
function oracle(g, role, swim = false) {
  const N = g.size, cols = g.cols, rows = g.rows, open = new Uint8Array(N), lab = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) open[k] = g.isWalkable(k % cols, (k / cols) | 0, { swim }) ? 1 : 0;
  const adj = new Map(), add = (a, b) => (adj.get(a) || adj.set(a, []).get(a)).push(b);
  for (const L of g.links) if (g.linkAllowed(L, role) && open[L.ka] && open[L.kb]) { add(L.ka, L.kb); add(L.kb, L.ka); }
  const step = (a, b) => Math.abs(g.elev[a] - g.elev[b]) <= MAX_STEP && (!g.runOf || g.runOf[a] === g.runOf[b] || g.canStep(a, b) || g.canStep(b, a));
  for (let s = 0; s < N; s++) {
    if (!open[s] || lab[s] >= 0) continue;
    const q = [s]; lab[s] = s;
    while (q.length) {
      const k = q.pop(), i = k % cols, j = (k / cols) | 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj, nk = nj * cols + ni;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || !open[nk] || lab[nk] >= 0 || !step(k, nk)) continue;
        lab[nk] = s; q.push(nk);
      }
      for (const nk of adj.get(k) || []) if (lab[nk] < 0) { lab[nk] = s; q.push(nk); }
    }
  }
  return lab;
}
/** A labelling in the oracle's canonical form (0 = shut → -1). */
function canon(lab) {
  const first = new Map(), out = new Int32Array(lab.length);
  for (let k = 0; k < lab.length; k++) {
    if (!lab[k]) { out[k] = -1; continue; }
    if (!first.has(lab[k])) first.set(lab[k], k);
    out[k] = first.get(lab[k]);
  }
  return out;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const ROLES = ['enemy', 'greenberet'];

test('walk areas: brought up to date over opening writes (clearOwner, a stamp lifted, a wall broken) = a whole flood', () => {
  let rowed = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = world(seed), r = rng(seed * 11);
    for (const role of ROLES) areaLabelsOf(g, { role });
    for (let n = 0; n < 16; n++) {
      const w = (r() * 3) | 0, v0 = g.version;
      if (w === 0) g.clearOwner(100 + ((r() * 16) | 0));
      else if (w === 1) g.navStamp('a', [...(g._navStamps.get('a') || [])].filter(() => r() < 0.6));
      else { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 3, z], [x + 3, z + 3], [x, z + 3]], 'block', B.NONE); }
      if (g.version > v0 && g.dirtyRowsSince(v0)) rowed++; // (known rows: the incremental labelling is asked)
      for (const role of ROLES) assert.ok(same(canon(areaLabelsOf(g, { role })), oracle(g, role)), `seed ${seed} step ${n} ${role}`);
    }
  }
  assert.ok(rowed >= 60, `${rowed} row-confined changes (the test exercises the incremental labelling)`);
});

test('walk areas: closing, re-stepping and re-linking writes mixed in: still a whole flood\'s areas', () => {
  for (const seed of [7, 8, 9, 10, 11, 12]) {
    const g = world(seed), r = rng(seed * 13);
    for (const role of ROLES) areaLabelsOf(g, { role });
    const writes = [
      () => g.clearOwner(100 + ((r() * 16) | 0)),
      () => g.navStamp('b' + ((r() * 3) | 0), Array.from({ length: 30 }, () => (r() * g.size) | 0)),
      () => g.navStamp('a', []),
      () => { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 6, z], [x + 6, z + 0.6], [x, z + 0.6]], 'block', B.HIGH, 300); },
      () => { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 3, z], [x + 3, z + 3], [x, z + 3]], 'block', B.NONE); },
      () => { const x = 26 + r() * 4, z = 16 + r() * 4; g.fillPoly([[x, z], [x + 2, z], [x + 2, z + 2], [x, z + 2]], 'elev', 2.5 * ((r() * 2) | 0)); },
      () => g.setLinkEnabled(g.links[0].id, r() < 0.5),
      () => { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 4, z], [x + 4, z + 2], [x, z + 2]], 'terrain', r() < 0.5 ? T.WATER : T.GROUND); },
    ];
    for (let n = 0; n < 24; n++) {
      const k = 1 + ((r() * 3) | 0);
      for (let q = 0; q < k; q++) writes[(r() * writes.length) | 0]();
      for (const role of ROLES) for (const swim of [false, true]) {
        assert.ok(same(canon(areaLabelsOf(g, { role, swim })), oracle(g, role, swim)), `seed ${seed} step ${n} ${role} swim ${swim}`);
      }
    }
  }
});

test('walk areas: a wall raised across the map splits the areas, cleared joins them again; a height write is a plain bump', () => {
  const g = world(3), west = 10 * g.cols + 10, east = 10 * g.cols + 60;
  // (the map whole across x = 20 first: a gap cut through every wall there)
  g.fillPoly([[19.5, 0], [21.1, 0], [21.1, 30], [19.5, 30]], 'block', B.NONE);
  let lab = areaLabelsOf(g, { role: 'enemy' });
  assert.ok(same(canon(lab), oracle(g, 'enemy')));
  assert.ok(lab[west] && lab[west] === lab[east], 'one area across x = 20 before the wall');
  // a wall across the whole map at x = 20 (owned: the blast below clears it again) — shut cells, known rows and columns
  let v = g.version;
  g.fillPoly([[20, 0], [20.6, 0], [20.6, 30], [20, 30]], 'block', B.HIGH, 400);
  assert.ok(g.dirtyRowsSince(v), 'the wall: a row-confined change');
  lab = areaLabelsOf(g, { role: 'enemy' });
  assert.ok(same(canon(lab), oracle(g, 'enemy')), "the wall up: a flood's areas");
  assert.notEqual(lab[west], lab[east], 'apart across the wall');
  v = g.version;
  g.clearOwner(400);
  assert.ok(g.dirtyRowsSince(v), 'the wall cleared: a row-confined change');
  lab = areaLabelsOf(g, { role: 'enemy' });
  assert.ok(same(canon(lab), oracle(g, 'enemy')), "the wall cleared: a flood's areas");
  assert.equal(lab[west], lab[east], 'joined again');
  v = g.version;
  g.fillPoly([[2, 2], [4, 2], [4, 4], [2, 4]], 'elev', 3);
  assert.equal(g.dirtyRowsSince(v), null, 'a height write: a plain bump, no rows known (heights are read as they were)');
  assert.ok(same(canon(areaLabelsOf(g, { role: 'enemy' })), oracle(g, 'enemy')), 'after the height write');
});

test('walk areas: an opened cell that joins two areas only by a diagonal step, or only by a link, is joined incrementally', () => {
  // a wall down the whole map at cell column 40 splits it in two (owner 600, kept)
  const wall = () => {
    const g = new NavGrid(40, 30), c = g.cell, cols = g.cols;
    for (let j = 0; j < g.rows; j++) { const k = j * cols + 40; g.block[k] = B.HIGH; g.owner[k] = 600; }
    g.version++;
    return { g, c, cols, west: 10 * cols + 5, east: 10 * cols + 70 };
  };
  { // (1) a gap in the wall at row 10 whose east side is blocked straight ahead: the way on is diagonal only
    const { g, cols, west, east } = wall();
    const gap = 10 * cols + 40, ahead = 10 * cols + 41;
    g.owner[gap] = 601; g.block[ahead] = B.HIGH; g.owner[ahead] = 602; g.version++;
    let lab = areaLabelsOf(g, { role: 'enemy' });
    assert.notEqual(lab[west], lab[east], 'apart behind the wall');
    const v = g.version;
    g.clearOwner(601);
    assert.ok(g.dirtyRowsSince(v), 'row-confined: the incremental labelling is asked');
    lab = areaLabelsOf(g, { role: 'enemy' });
    assert.equal(lab[west], lab[east], 'joined by the gap and a diagonal step');
    assert.ok(same(canon(lab), oracle(g, 'enemy')));
  }
  { // (2) a ladder over the wall whose west foot stands in a blocked cell: opened, the ladder joins the two sides
    const { g, c, cols, west, east } = wall();
    g.addLink('ladder', { x: 39.5 * c, z: 20.5 * c }, { x: 41.5 * c, z: 20.5 * c });
    const foot = 20 * cols + 39;
    g.block[foot] = B.HIGH; g.owner[foot] = 603; g.version++;
    let lab = areaLabelsOf(g, { role: 'enemy' });
    assert.notEqual(lab[west], lab[east], 'apart: the ladder\'s foot is shut');
    const v = g.version;
    g.clearOwner(603);
    assert.ok(g.dirtyRowsSince(v), 'row-confined: the incremental labelling is asked');
    lab = areaLabelsOf(g, { role: 'enemy' });
    assert.equal(lab[west], lab[east], 'joined by the ladder');
    assert.ok(same(canon(lab), oracle(g, 'enemy')));
  }
});
