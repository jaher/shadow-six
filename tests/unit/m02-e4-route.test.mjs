/**
 * M2 e4 (§7.5: the far-bank sentry the Sniper takes first): both halts of his beat stand clear of the rocks beside
 * them. The old west halt (20, 42.5) lay 0.5 m from rocks_n1's footprint, inside a soldier's body clearance with the
 * game's mesh hulls: he could never reach it, so he never halted there and jittered on the spot for good (found by the
 * M2 solution run in the browser, 2026-10-12). Its replacement keeps ≥ 0.6 m from every rock box (the east halt, reached fine, is 0.69 m from rocks_n3).
 */
import { test, assert } from './lib.mjs';
import { getMission } from '../../src/missions/index.js';

/** distance from (x, z) to an axis-aligned w × d box centred on (cx, cz) (rot 0) */
const boxDist = (x, z, cx, cz, w, d) => Math.hypot(Math.max(0, Math.abs(x - cx) - w / 2), Math.max(0, Math.abs(z - cz) - d / 2));

test('m02 e4: his halts keep clear of the rocks, so he can reach and hold them', () => {
  const m = getMission('m02');
  const e4 = m.enemies.find((e) => e.id === 'e4');
  const rocks = m.structures.filter((s) => s.type === 'rocks' && s.w && s.d && !s.rot);
  assert.ok(rocks.some((r) => r.id === 'rocks_n1'), 'rocks_n1 present');
  for (const p of e4.route.points) {
    for (const r of rocks) {
      const d = boxDist(p.x, p.z, r.x, r.z, r.w, r.d);
      assert.ok(d >= 0.6, `e4 halt (${p.x}, ${p.z}) is ${d.toFixed(2)} m from ${r.id}`);
    }
  }
  assert.equal(`${e4.x},${e4.z}`, `${e4.route.points[0].x},${e4.route.points[0].z}`, 'he starts at his west halt');
});
