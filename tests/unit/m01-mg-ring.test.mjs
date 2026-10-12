/**
 * M1 wrong-cone bug (verify m01, round 1): the MG gunner e13 stands inside his own sandbag ring `mg1` (B.LOW), which
 * lay in the first metre of every sight line he had. With no post owner, grid LOS for a low target (a seated raft
 * crew, a crawling man) was blocked at any range, while his cone (castRay, stops only at B.HIGH) was drawn over the
 * water, so the gunner covering "the southern approach across the fjord" never saw a raft inside his drawn cone
 * (user: "Even the raft boat in the light shaded field of view of a soldier makes the soldier see it").
 * Fix: e13 is posted in `mg1` (spawn `structure`), so his own ring never blinds him.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { canSee, postOwner } from '../../src/ai/perception.js';

const sim = () => makeSim(getMission('m01'), { brains: false });
const look = (g, x, z) => { g.heading = Math.atan2(z - g.z, x - g.x); g.sweepActive = false; };

test('m01 e13: his own sandbag ring mg1 is his post (it never blinds him)', () => {
  const s = sim(), w = s.world, e13 = s.get('e13');
  const ring = w.structures.get('mg1');
  assert.ok(ring?.owner, 'ring stamped in the grid');
  assert.equal(postOwner(e13, w), ring.owner);
});

test('m01 e13: sees the crewed raft on the fjord in his far band (seen at 25.9 m, was none)', () => {
  const s = sim(), w = s.world, e13 = s.get('e13'), d = s.cmd('diver'), raft = s.get('raft');
  d.setPosition(raft.x + 1.5, raft.z); s.step();
  assert.ok(raft.enter(d), 'Marine boards');
  // the spot of the verify run (t=865.1): the raft and its seated crew on the fjord, no step (no disembark)
  raft.x = d.x = 9; raft.z = d.z = 61.9;
  look(e13, raft.x, raft.z);
  assert.equal(d.state, 'inVehicle', 'still seated in the raft');
  const dist = Math.hypot(d.x - e13.x, d.z - e13.z);
  assert.ok(dist > 20 && dist < 30, `far band distance (${dist.toFixed(1)})`);
  assert.equal(canSee(e13, d, w), 'far', 'the seated crew is seen over the ring');
});

test('m01 e13: sees a crawling man in his near band past the ring (10 m, on the bank)', () => {
  const s = sim(), w = s.world, e13 = s.get('e13'), gb = s.cmd('greenberet');
  gb.setPosition(e13.x + 6, e13.z - 8); gb.setStance('crawl'); for (let i = 0; i < 90; i++) s.step();
  look(e13, gb.x, gb.z);
  assert.ok(gb.isLow, 'crawling');
  assert.equal(canSee(e13, gb, w), 'near');
});
