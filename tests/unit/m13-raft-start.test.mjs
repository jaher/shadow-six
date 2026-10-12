/**
 * M13 start: the team's inflatable waits on the ledge's wet rim, beside the men lying there. A raft lying in any band of
 * a live cone with a clear line to its hull is seen (user, M3: "Even the raft boat in the light shaded field of view of
 * a soldier makes the soldier see it"). The old spawn (74.5,157.5) lay in e4's light band from t=0, before a player
 * could pack it, and in e2's near band from t=24 (found by the M13 solution review, 2026-10-12). From the new spawn at
 * the rim's south-east end nobody sees it for the first 11 s, time for the Marine (beside it) to pack it.
 */
import { test, assert } from './lib.mjs';
import { headlessDriver } from '../../tools/solutions/headless.mjs';

test('m13 start: the raft at its spawn is out of every cone at first, and the Marine packs it unseen', async () => {
  const D = await headlessDriver('m13', { quiet: true });
  D.watchIdleRafts();
  const raft = D.raft(), dv = D.c('diver');
  assert.ok(raft && !raft.used, 'the inflatable lies at its spawn, unused');
  // the Marine, 3.5 m off, crawls to it at once and packs it (2 s)
  D.ability('diver', 'hand', raft);
  await D.until(() => dv.has('inflatableBoat') && !dv.currentAction, 8, 'the raft packed');
  assert.ok(raft.removed || !D.world.vehicles.includes(raft), 'the raft is packed');
  await D.wait(10);
  assert.equal(D.exposureReport().join('; '), '', 'nobody saw the raft, the Marine or the team');
  assert.equal(D.detections(), 0, 'no detections');
});
