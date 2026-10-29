/**
 * No footprints on a climb (§4.8 footprints, §3.2 climbing): a man on a climb link or a ladder has his hands and boots
 * on the rock face or the rungs, so he prints nothing in the snow below him. M5: the Green Beret's climb up the east
 * face (climb_e) left a line of ground prints up the cliff, at its foot through the whole climb and then on along the
 * massif's top at ground height. Patrol 19 read them from the south field and followed them (TRACKS) a minute and a
 * half later (found by the M5 solution, 2026-10-29). He still leaves prints on the ground before the climb and on the
 * plateau after it, as before.
 */
import { test, assert } from './lib.mjs';
import { headlessDriver } from '../../tools/solutions/headless.mjs';

test('m05 climb_e: no footprints while the Green Beret climbs the east face, prints on the ground before and on top after', async () => {
  const D = await headlessDriver('m05', { quiet: true, watch: false });
  const w = D.world, gb = D.c('greenberet');
  for (const e of [...w.enemies]) w.remove(e); // (the climb alone: nobody to see him or react)
  w.flushRemovals();
  gb.x = 96.8; gb.z = 88.6; gb.path = null;
  const prints = [];
  w.events.on('footprint', (p) => { if (p.owner === gb) prints.push({ x: p.x, z: p.z, y: gb.y || 0, climbing: !!(gb._climb || gb._ladder), t: w.time, ai: p.aiVisible }); });
  await D.go('greenberet', 99.3, 89.8, { tol: 0.3, max: 20 }); // on the snow at the cliff's foot
  const before = prints.length;
  assert.ok(before >= 2, `prints on the ground on the way to the climb (${before})`);
  D.ability('greenberet', 'climb', { x: 101, z: 69.5 });
  await D.until(() => !!gb._climb, 10, 'the climb under way');
  const t0 = w.time;
  await D.until(() => Math.hypot(gb.x - 101, gb.z - 69.5) < 0.8 && !gb._climb && !gb.path, 120, 'on the plateau');
  assert.ok(w.time - t0 > 10, `a long climb (${(w.time - t0).toFixed(1)} s)`);
  assert.equal(gb.y, 16, 'up on the plateau (y 16)');
  const during = prints.filter((p) => p.t >= t0);
  assert.equal(during.length, 0, `no print during the climb (${during.map((p) => `(${p.x.toFixed(1)},${p.z.toFixed(1)}) y${p.y.toFixed(1)}`).join(' ')})`);
  assert.equal(w.ai.footprints.query(100.5, 80, 11).filter((f) => f.owner === gb && f.z < 88 && f.z > 71).length, 0, 'none up the cliff for the AI');
  await D.go('greenberet', 97.5, 64, { tol: 0.5, max: 30 }); // a few steps on the plateau
  const after = prints.filter((p) => p.t >= t0);
  assert.ok(after.length >= 3 && after.every((p) => p.ai && p.y === 16), `prints again on the plateau (${after.length})`);
});
