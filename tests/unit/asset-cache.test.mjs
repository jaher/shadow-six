import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { SessionCache, defaultBudget, sessionCache } from '../../src/engine/asset-cache.js';
import { planCells, planHull, overheadCells, visualSignature, geometryHash } from '../../src/world/placement-visual.js';

let clock = 0;
const mk = (o = {}) => new SessionCache({ budget: 1000, now: () => clock++, ...o });

test('memo computes once per key; memoAsync shares one load and does not cache failures', async () => {
  const c = mk();
  let n = 0;
  assert.equal(c.memo('a', () => ++n), 1);
  assert.equal(c.memo('a', () => ++n), 1);
  assert.equal(c.stats().hits, 1);
  let loads = 0;
  const f = () => new Promise((r) => setTimeout(() => r(++loads), 5));
  const [x, y] = await Promise.all([c.memoAsync('b', f), c.memoAsync('b', f)]);
  assert.equal(x, 1); assert.equal(y, 1); assert.equal(loads, 1);
  await assert.rejects(c.memoAsync('bad', () => Promise.reject(new Error('404'))));
  assert.equal(c.has('bad'), false);
  assert.equal(await c.memoAsync('bad', () => 'ok'), 'ok');
});

test('LRU eviction keeps the current and the last mission, disposes what it drops', () => {
  const c = mk({ budget: 300 });
  const gone = [];
  const o = (k) => ({ bytes: 100, dispose: () => gone.push(k) });
  c.beginMission('m01'); c.set('m01:a', 1, o('m01:a')); c.set('shared', 1, o('shared'));
  c.beginMission('m02'); c.set('m02:a', 1, o('m02:a')); c.get('shared');
  assert.deepEqual(gone, [], 'within budget');
  c.beginMission('m03'); c.set('m03:a', 1, o('m03:a'));
  // over budget (400 > 300): m01 is neither current (m03) nor last (m02) → its own entry goes; 'shared' was used by m02
  assert.deepEqual(gone, ['m01:a']);
  assert.ok(c.has('shared') && c.has('m02:a') && c.has('m03:a'));
  c.set('m03:b', 1, o('m03:b')); // 400 again, everything pinned: stays over budget rather than drop a live mission's data
  assert.equal(c.entries.size, 4);
  c.beginMission('m04'); c.set('m04:a', 1, o('m04:a'));
  assert.ok(!c.has('m02:a') && !c.has('shared'), 'm02 no longer kept');
  assert.ok(c.has('m03:a') && c.has('m04:a'));
  assert.ok(c.bytes <= 300);
});

test('restarting the same mission keeps everything; clear() disposes all', () => {
  const c = mk({ budget: 150 });
  let disposed = 0;
  c.beginMission('m01'); c.set('a', 1, { bytes: 100, dispose: () => disposed++ });
  c.beginMission('m01'); c.beginMission('m01');
  assert.deepEqual(c.missions, ['m01']);
  c.set('b', 2, { bytes: 100, dispose: () => disposed++ });
  assert.equal(disposed, 0, 'both pinned by m01 (over budget is allowed for the live mission)');
  c.clear();
  assert.equal(disposed, 2); assert.equal(c.bytes, 0); assert.equal(c.entries.size, 0);
});

test('keepOnly: the mission on screen stays warm, every other mission is dropped and forgotten', () => {
  const c = mk({ budget: 1e9 });
  const gone = [];
  const o = (k) => ({ bytes: 100, dispose: () => gone.push(k) });
  c.beginMission('m01'); c.set('m01:a', 1, o('m01:a')); c.set('shared', 1, o('shared'));
  c.beginMission('m02'); c.set('m02:a', 1, o('m02:a')); c.get('shared');
  assert.deepEqual(c.missions, ['m02', 'm01']);
  c.keepOnly('m02'); // Options → CLEAR CACHED GAME DATA during M2
  assert.deepEqual(gone, ['m01:a'], 'only what M2 does not use');
  assert.deepEqual(c.missions, ['m02'], 'M1 is cold now (no warm fast path for it)');
  assert.equal(c.has('shared'), true);
  assert.equal(c.bytes, 200);
});

test('retain marks GPU resources the mission unload must not dispose', () => {
  const c = mk(); const g = {};
  assert.equal(c.isRetained(g), false);
  c.retain(g);
  assert.equal(c.isRetained(g), true);
});

test('defaultBudget: phones keep less than desktops, bounded', () => {
  const phone = defaultBudget({ deviceMemory: 4, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
  const desk = defaultBudget({ deviceMemory: 8, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
  assert.ok(phone <= 512 * 1024 * 1024 && phone >= 256 * 1024 * 1024, `phone ${phone}`);
  assert.ok(desk > phone && desk <= 1536 * 1024 * 1024, `desk ${desk}`);
});

function hut(x = 10, z = 5, w = 4) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, 3), new THREE.MeshBasicMaterial());
  m.position.y = 1.25; m.name = 'walls';
  g.add(m); g.position.set(x, 0, z);
  return g;
}

test('placement-visual memo: same geometry + placement → cached copy; moved or edited → recomputed', () => {
  sessionCache.clear();
  const a = planCells(hut(), { maxY: 1.8, cell: 0.25 });
  const m0 = sessionCache.misses;
  const b = planCells(hut(), { maxY: 1.8, cell: 0.25 }); // a fresh object with identical content (a restart)
  assert.equal(sessionCache.misses, m0, 'hit');
  assert.deepEqual(b, a);
  b[0][0][0] = 999; // callers own their copy
  assert.deepEqual(planCells(hut(), { maxY: 1.8, cell: 0.25 }), a);
  const moved = planCells(hut(11), { maxY: 1.8, cell: 0.25 });
  assert.equal(sessionCache.misses, m0 + 1, 'moved: miss');
  assert.notDeepEqual(moved, a);
  const h = hut(); const pos = h.children[0].geometry.attributes.position;
  const s0 = visualSignature(h);
  pos.setX(0, pos.getX(0) + 3); pos.needsUpdate = true;
  assert.notEqual(visualSignature(h), s0, 'edited geometry changes the signature');
  assert.notEqual(geometryHash(new THREE.BoxGeometry(1, 1, 1)), geometryHash(new THREE.BoxGeometry(1, 2, 1)));
  assert.equal(geometryHash(new THREE.BoxGeometry(1, 1, 1)), geometryHash(new THREE.BoxGeometry(1, 1, 1)));
  const hull = planHull(hut()); assert.deepEqual(planHull(hut()), hull);
  const into = new Map([['0,0', [5, 5]]]);
  const raw = overheadCells(hut(), { minY: 0.5, maxY: 3, cell: 0.5 });
  const merged = overheadCells(hut(), { minY: 0.5, maxY: 3, cell: 0.5 }, into);
  assert.equal(merged.size, raw.size + 1, 'merged into the caller map');
  sessionCache.clear();
});
