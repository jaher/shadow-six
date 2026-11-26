/**
 * sneak.mjs ViewTable (planSneakGen's walker heads as numbers in a pooled buffer, instead of the walkerViews lists of
 * ghosts and cones a plan used to keep until it ended): every answer is the one `seesAny` gives on the list itself —
 * one guard at one eye (seesAnyHeads), head by head with the cones widened by a margin, the pad probes — for the e06
 * garrison's walkers at many steps and headings, crawling, walking and on a boat; the viewers it makes again carry
 * exactly the own fields walkerViews gave them (what the table relies on). And the scratch pool (state-heap
 * takeScratch / giveScratch) hands back views of exactly the length asked, filled as asked, a buffer reused.
 * Run with the unit suite: node tests/unit/run.mjs sneak-view-table
 */
import { test, assert } from './lib.mjs';
import { ViewTable, walkerViews, seesAny, viewersOf, walking, predict, dummyAt } from '../../tools/solutions/sneak.mjs';
import { mirrorOf } from '../../tools/solutions/ghost.mjs';
import { takeScratch, giveScratch } from '../../tools/solutions/state-heap.mjs';
import { headlessDriver } from '../../tools/solutions/headless.mjs';
import '../../src/abilities/index.js';

/** A small deterministic generator (the same points every run). */
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test('ViewTable: the same answers as seesAny on the walkerViews lists (e06 walkers, steps, headings, margins, modes)', async () => {
  const D = await headlessDriver('e06', { quiet: true, difficulty: 'hard' }), w = D.world;
  await D.wait(1); // (a second of play: patrols under way)
  const walkers = viewersOf(w).filter(walking);
  assert.ok(walkers.length >= 4, `walkers in e06 (${walkers.length})`);
  const VT = new ViewTable(), R = rng(7), now = w.time;
  let asked = 0, seen = 0, lists = 0;
  for (const e of walkers) {
    const m = mirrorOf(e);
    for (let k = 0; k <= 600; k += 37) {
      const q0 = predict(e, k * 0.2);
      for (const r of [-1, 0, 3, 6]) {
        const q = r < 0 ? q0 : { ...q0, heading: (r * Math.PI) / 4 };
        const L = walkerViews(e, q, w, now + k * 0.2, m);
        // (the viewers' own fields: what ViewTable.viewer makes again)
        for (let i = 0; i < L.length; i += 2) {
          const keys = Object.keys(L[i]).sort().join(',');
          assert.ok(keys === 'heading,x,z' || keys === 'headCarry,headOffset,heading,sweepActive,x,z', `walkerViews viewer fields: ${keys}`);
          if (L[i].sweepActive !== undefined && Object.prototype.hasOwnProperty.call(L[i], 'sweepActive')) assert.ok(L[i].sweepActive === false && L[i].headCarry === 0);
        }
        const off = VT.add(L);
        lists++;
        for (let n = 0; n < 24; n++) {
          // (points around him: inside his reach mostly, some beyond; every mode the planner asks with)
          const a = R() * Math.PI * 2, rr = R() * 40, x = q.x + Math.cos(a) * rr, z = q.z + Math.sin(a) * rr;
          for (const mode of ['crawl', 'walk', 'boat']) {
            const d = dummyAt(w, mode, x, z);
            for (const cm of [null, [6, 1.5]]) {
              const want = seesAny(L, d, w, cm), got = VT.sees(m, off, d, w, cm);
              assert.equal(got, want, `${e.tag} k ${k} r ${r} ${mode} cm ${cm} at (${x.toFixed(2)}, ${z.toFixed(2)})`);
              asked++; if (want) seen++;
            }
          }
        }
      }
    }
  }
  VT.release();
  assert.ok(seen > 50 && seen < asked - 50, `both answers asked (${seen} seen of ${asked}, ${lists} lists)`);
});

test('ViewTable: a table grown past its first buffer keeps every list (offsets stay valid)', async () => {
  const D = await headlessDriver('e06', { quiet: true, difficulty: 'hard' }), w = D.world;
  const e = viewersOf(w).filter(walking)[0], m = mirrorOf(e), VT = new ViewTable(), offs = [];
  for (let k = 0; k < 2000; k++) offs.push([k, VT.add(walkerViews(e, predict(e, k * 0.2), w, w.time + k * 0.2, m))]);
  assert.ok(VT.f.length > 1 << 15, 'grown');
  const R = rng(3);
  for (const [k, off] of offs.filter((_, i) => i % 97 === 0)) {
    const q = predict(e, k * 0.2), L = walkerViews(e, q, w, w.time + k * 0.2, m);
    for (let n = 0; n < 30; n++) {
      const d = dummyAt(w, 'walk', q.x + (R() - 0.5) * 50, q.z + (R() - 0.5) * 50);
      assert.equal(VT.sees(m, off, d, w, null), seesAny(L, d, w, null), `k ${k}`);
    }
  }
  VT.release();
});

test('scratch pool: views of exactly the length asked, filled as asked; a buffer given back is reused', () => {
  const a = takeScratch(Uint8Array, 1000);
  assert.equal(a.length, 1000);
  assert.ok(a.every((v) => v === 0));
  a.fill(7);
  giveScratch(a);
  const b = takeScratch(Uint8Array, 900);
  assert.equal(b.buffer, a.buffer, 'the buffer is reused');
  assert.equal(b.length, 900);
  assert.ok(b.every((v) => v === 0), 'cleared over the length asked');
  const c = takeScratch(Float64Array, 100, NaN);
  assert.ok(c.every((v) => Number.isNaN(v)), 'filled with NaN');
  giveScratch(b); giveScratch(c); giveScratch(c); // (given twice: kept once)
  const d1 = takeScratch(Float64Array, 100, null), d2 = takeScratch(Float64Array, 100, null);
  assert.notEqual(d1.buffer, d2.buffer, 'two views taken at once never share a buffer');
  giveScratch(d1); giveScratch(d2);
});
