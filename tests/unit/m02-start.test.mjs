/**
 * M2 start (§7.5, "behind the S palisade of the SW settlement"): the team starts hidden. Left standing where they
 * spawn, nobody is ever inside a live cone that sees him — any band — over several full patrol cycles. The old line
 * (x 8–20) put the Green Beret in the line of the settlement's south gap (x 6–10) from e2's beat: seen standing in
 * e2's far band from t=0, before a player could give an order (found by the M2 solution review, 2026-10-12).
 */
import { test, assert } from './lib.mjs';
import { headlessDriver } from '../../tools/solutions/headless.mjs';

test('m02 start: the team, standing idle at the start, is never seen (no exposure, no detection) for 300 s', async () => {
  const D = await headlessDriver('m02', { quiet: true });
  await D.wait(300);
  assert.equal(D.exposureReport().join('; '), '', 'nobody sees the team at the start');
  assert.equal(D.detections(), 0, 'no detections');
  for (const c of D.world.commandos) assert.ok(c.alive && c.stance === 'stand', `${c.role} still standing`);
});
