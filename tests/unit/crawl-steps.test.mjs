/**
 * Crawlers go round steps (map-builder stampCrawlSteps → grid.crawlStep, body-clearance avoidMask `prone`): the side
 * of a step, a porch or a plinth standing ≥ CRAWL_STEP over open ground is a solid to a crawler's path (his body
 * follows the ground's slope, not a stair: lying across the side of house_s's door steps he clipped them, M1 seed 11
 * of the clipping audit once the drifts beside them were walked over). A berm crawled up, a snow drift, a deck and
 * the ground the visual nav stamps already close are no crawl steps; a destroyed structure's steps go with it.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { NavGrid } from '../../src/world/grid.js';
import { stampCrawlSteps, CRAWL_STEP } from '../../src/world/map-builder.js';
import { avoidMask } from '../../src/world/body-clearance.js';
import { makeSim } from './abilsim.mjs';

/** A structure record (map-builder `built` entry) holding one mesh (upward-facing top + sides). */
function rec(owner, mesh, def = { type: 'house', x: 0, z: 0 }) {
  const g = new THREE.Group(); g.add(mesh); g.updateMatrixWorld(true);
  return { owner, type: def.type, def, object3d: g };
}
const box = (x, z, w, h, d, mat = 'kit:deck_planks') => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, Math.ceil(w / 0.2), 1, Math.ceil(d / 0.2)), new THREE.MeshBasicMaterial({ name: mat }));
  m.position.set(x, h / 2, z); return m;
};
/** An earth mound `h` high sloping down to the ground `r` m out all round (a berm). */
function mound(x, z, r, h, mat = 'kit:granite') {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 24, 6, true), new THREE.MeshBasicMaterial({ name: mat }));
  m.position.set(x, h / 2, z); return m;
}
function world(built) {
  const grid = new NavGrid(30, 30), handlers = [];
  const w = { grid, events: { on: (n, f) => { handlers.push([n, f]); return () => {}; }, emit: (n, e) => { for (const [m, f] of handlers) if (m === n) f(e); } } };
  return { w, r: stampCrawlSteps(w, built, () => 0) };
}
const at = (grid, x, z) => !!grid.crawlStep?.[grid.idx(Math.floor(x / grid.cell), Math.floor(z / grid.cell))];

test('crawl steps: the sides of a 0.5 m step block a crawler, not a walker; its top stays a surface to stand on', () => {
  assert.ok(CRAWL_STEP > 0.2 && CRAWL_STEP < 0.4);
  const { w, r } = world([rec(1, box(10, 10, 2, 0.5, 1.5))]);
  assert.ok(r.cells > 0, `step sides stamped (${r.cells})`);
  assert.ok(at(w.grid, 9.1, 10) || at(w.grid, 10.9, 10), 'a cell at its side is a crawl step');
  assert.ok(!at(w.grid, 5, 5) && !at(w.grid, 15, 15), 'open ground is not');
  const prone = avoidMask(w, 0.45, null, true), feet = avoidMask(w, 0.45, null, false);
  const k = w.grid.idx(Math.floor(8.5 / w.grid.cell), Math.floor(10 / w.grid.cell));
  assert.ok(prone && prone[k], 'a crawler keeps his body off the step (0.5 m beside it)');
  assert.ok(!feet || !feet[k], 'a man on his feet does not (he steps up onto it)');
});

test('crawl steps: a berm, a low kerb, a snow drift and nav-closed ground are no crawl steps; destroyed, the steps go', () => {
  const berm = world([rec(1, mound(10, 10, 2, 0.6))]);
  assert.equal(berm.r.cells, 0, 'a berm rising 0.6 m over 2 m is crawled up');
  const kerb = world([rec(1, box(10, 10, 2, 0.2, 1))]);
  assert.equal(kerb.r.cells, 0, 'a 0.2 m kerb is crawled over');
  const drift = world([rec(1, box(10, 10, 2, 0.5, 1.5, 'kit:snow'))]);
  assert.equal(drift.r.cells, 0, 'a 0.5 m drift is waded through (SNOW_WADE)');
  // the same step, its ground already closed by the visual nav stamps (a plinth along a wall): nothing more
  const built = [rec(1, box(10, 10, 2, 0.5, 1.5))];
  const grid = new NavGrid(30, 30);
  grid.navBlock.fill(1);
  const w2 = { grid, events: null };
  assert.equal(stampCrawlSteps(w2, built, () => 0).cells, 0, 'inside the visual stamps: no crawl step');
  // destroyed
  const s = world([rec(7, box(10, 10, 2, 0.5, 1.5)), rec(8, box(20, 20, 2, 0.5, 1.5))]);
  const before = s.w.grid.crawlStep;
  s.w.events.emit('structure:destroyed', { owner: 7 });
  assert.ok(s.w.grid.crawlStep && s.w.grid.crawlStep !== before, 'a fresh array (the cached masks rebuild)');
  assert.ok(!at(s.w.grid, 9.1, 10) && !at(s.w.grid, 10.9, 10) && (at(s.w.grid, 19.1, 20) || at(s.w.grid, 20.9, 20)), 'the destroyed one\'s steps are gone, the other\'s stay');
});

test('crawl steps: a crawler\'s path goes round them; a man lying down on a path across them is re-pathed', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 30, heading: 0 }] }, { brains: false });
  const w = s.world, g = w.grid, u = s.cmd('greenberet');
  // a step's side 4 m long across the way, at x 20 (z 28 … 32)
  g.crawlStep = new Uint8Array(g.cols * g.rows);
  for (let z = 28.25; z <= 32; z += 0.5) g.crawlStep[g.idx(Math.floor(20 / g.cell), Math.floor(z / g.cell))] = 1;
  // (does the path pass over the step's side: within 0.3 m of x 20 between z 28 and 32?)
  const crosses = (P) => P.some((p, k) => {
    if (!k) return false;
    const a = P[k - 1], n = Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / 0.1);
    for (let q = 0; q <= n; q++) { const x = a.x + ((p.x - a.x) * q) / n, z = a.z + ((p.z - a.z) * q) / n; if (Math.abs(x - 20) < 0.3 && z > 28 && z < 32) return true; }
    return false;
  });
  assert.ok(u.moveTo(30, 30), 'walks');
  assert.ok(crosses(u.path), 'a man on his feet walks straight over the step');
  u.setStance('crawl');
  assert.ok(u.path && !crosses(u.path), `lying down, he is re-pathed round its side (${u.path.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ')})`);
  assert.ok(Math.hypot(u.moveTarget.x - 30, u.moveTarget.z - 30) < 0.8, 'to the same goal');
  u.stop?.(); u.setStance('stand'); u.setStance('crawl');
  assert.ok(u.moveTo(30, 30) && !crosses(u.path), 'a crawler ordered across it goes round');
});
