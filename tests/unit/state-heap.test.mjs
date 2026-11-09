/**
 * The sneak planners' typed search structures (tools/solutions/state-heap.mjs) answer exactly as the JS structures they
 * replaced: StateHeap pops in the same order as the [f, c, k] array heap (ties included), StateSet as the Map (reached
 * from) + Set (expanded, in insertion order) — reused from the pools plan after plan, across its growth. And ghosts
 * (tools/solutions/ghost.mjs) read a live unit's fields without making him a prototype.
 */
import { test, assert } from './lib.mjs';
import { takeHeap, giveHeap, takeSet, giveSet } from '../../tools/solutions/state-heap.mjs';
import { mirrorOf, ghostOn, ghost, protoOf } from '../../tools/solutions/ghost.mjs';
import { doubleFields, anyFields } from '../../src/core/shapes.js';

const rng = (seed) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

test('StateHeap: the array heap\'s pop order, ties included, reused from the pool', () => {
  const rnd = rng(7);
  for (let round = 0; round < 6; round++) {
    const h = takeHeap(), A = [];
    const push = (f, c, k) => {
      A.push([f, c, k]); let i = A.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (A[p][0] <= A[i][0]) break; [A[p], A[i]] = [A[i], A[p]]; i = p; }
    };
    const pop = () => {
      const top = A[0], last = A.pop();
      if (A.length) { A[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < A.length && A[l][0] < A[m][0]) m = l; if (r < A.length && A[r][0] < A[m][0]) m = r; if (m === i) break; [A[m], A[i]] = [A[i], A[m]]; i = m; } }
      return top;
    };
    for (let i = 0; i < 20000; i++) {
      if (rnd() < 0.6 || !A.length) { const f = Math.floor(rnd() * 40) + (rnd() < 0.3 ? 0.5 : 0), c = Math.floor(rnd() * 1e5), k = Math.floor(rnd() * 900); push(f, c, k); h.push(f, c, k); }
      else { const t = pop(); h.pop(); assert.equal(h.topC, t[1]); assert.equal(h.topK, t[2]); }
    }
    assert.equal(h.length, A.length);
    giveHeap(h);
  }
});

test('StateSet: the Map + Set it replaces (has / get / set, expanded and their order), across growth and reuse', () => {
  const rnd = rng(11);
  for (let round = 0; round < 8; round++) {
    const s = takeSet(), M = new Map(), D = new Set(), span = Math.floor(rnd() * 3e7) + 50;
    for (let i = 0; i < 40000; i++) {
      const k = Math.floor(rnd() * span), op = rnd();
      if (op < 0.5) { if (!M.has(k)) { M.set(k, (i % 9) - 1); s.set(k, (i % 9) - 1); } }
      else if (op < 0.7) { if (M.has(k) && !D.has(k)) { D.add(k); s.markDone(k); } }
      else if (op < 0.85) { assert.equal(s.has(k), M.has(k)); assert.equal(s.get(k), M.get(k)); }
      else assert.equal(s.isDone(k), D.has(k));
    }
    assert.deepEqual([...s.doneKeys()], [...D]);
    assert.equal(s.size, M.size);
    for (const [k, v] of M) assert.equal(s.get(k), v);
    giveSet(s);
  }
});

test('ghosts: his fields read through a mirror (refreshed at each ghost), never through him; records found as before', () => {
  class Man { constructor(id) { this.id = id; this.world = null; this.x = 1; this.z = 2; this.heading = 0; this.vision = { far: 30 }; } get far2() { return this.vision.far * 2; } }
  const world = { byId: (id) => (id === 7 ? him : null) };
  const him = new Man(7); him.world = world;
  const g = ghost(him);
  g.x = 5; g.heading = 1;
  assert.equal(g.x, 5); assert.equal(g.z, 2); assert.equal(g.far2, 60); assert.equal(him.x, 1);
  assert.ok(g instanceof Man);
  assert.ok(Object.getPrototypeOf(g) !== him, 'never Object.create(him)');
  assert.equal(protoOf(g), him, 'a read falls through to him, as through Object.create(him)');
  him.z = 9;
  assert.equal(ghost(him).z, 9, 'a new ghost reads him as he is now');
  const m = mirrorOf(him), a = ghostOn(m), b = ghostOn(m);
  a.heading = 2; b.heading = 3;
  assert.equal(a.heading, 2); assert.equal(b.heading, 3); assert.equal(a.z, 9);
  // anything but a live entity of its world is its own mirror (a plain viewer, a ghost)
  const plain = { x: 0, vision: null };
  assert.equal(mirrorOf(plain), plain);
  assert.equal(mirrorOf(g), g);
});

test('doubleFields: the same values, read the same', () => {
  const o = {};
  doubleFields(o, 0, 'a', 'b'); doubleFields(o, 1, 'c'); doubleFields(o, -3, 'd');
  assert.deepEqual(o, { a: 0, b: 0, c: 1, d: -3 });
  assert.ok(Object.is(o.a, 0), 'plus zero, not minus');
  assert.deepEqual(Object.keys(o), ['a', 'b', 'c', 'd']);
});

test('anyFields: the same values, read the same, in the same order (only V8 tracks them as fields that change)', () => {
  const o = { a: 1 };
  anyFields(o, undefined, 'b', 'c'); anyFields(o, null, 'd'); anyFields(o, 0, 'e'); anyFields(o, 'x', 'a');
  assert.deepEqual(Object.keys(o), ['a', 'b', 'c', 'd', 'e'], 'new keys appended in order, an existing one kept in place');
  assert.equal(o.a, 'x'); assert.equal(o.b, undefined); assert.equal(o.c, undefined); assert.equal(o.d, null); assert.ok(Object.is(o.e, 0));
  assert.equal(JSON.stringify(o), '{"a":"x","d":null,"e":0}');
});

test('mirrorOf: a new mirror holds its unit\'s own fields as they are (the fields made changeable keep their values)', () => {
  class U { constructor(id) { this.id = id; this.world = null; this.x = 1.5; this.flag = undefined; this.n = 3; this.o = { k: 1 }; } }
  const w = { byId: (id) => units.find((u) => u.id === id) };
  const units = [new U(1), new U(2)]; for (const u of units) u.world = w;
  const m = mirrorOf(units[0]);
  assert.deepEqual(Object.keys(m), Object.keys(units[0]));
  for (const k of Object.keys(units[0])) assert.ok(Object.is(m[k], units[0][k]), k);
  units[0].flag = { hit: true }; units[0].n = 4;
  const m2 = mirrorOf(units[0]);
  assert.equal(m2, m, 'the same mirror'); assert.equal(m.flag, units[0].flag); assert.equal(m.n, 4);
});
