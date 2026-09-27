/**
 * M2 feasibility (§7.5 intended solution steps 2 and 4): e5's body on the wall walk `walk_sw` and the GB on
 * the walkway. The deck-edge rule (§4.7, perception.canSee) hides a body / prone man lying on a raised
 * surface above a viewer's eye, so the camp interior (e7's west leg, p3) no longer finds e5 on `walk_sw`.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { canSee } from '../../src/ai/perception.js';
import { Alarm } from '../../src/ai/alarm.js';

/** Full-brain M2 sim with step 1 done (e1–e3 gone) and every alarm:zone event recorded. */
function m02Sim() {
  const s = makeSim(getMission('m02'));
  const w = s.world;
  w.alarm = new Alarm(w); // Game.loadMission installs it; step it after the entities like Game.step
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  for (const id of ['e1', 'e2', 'e3']) w.remove(s.get(id));
  w.flushRemovals();
  assert.ok(w.alarm && w.alarm.zones.some((z) => z.id === 'z_ne'), 'alarm zones live');
  s.alarms = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ t: w.time, ...p }));
  return s;
}

const place = (u, x, z, y = 0) => { u.x = x; u.z = z; u.y = y; u.path = null; };
// inside the camp past the SW edge W(16,33)–S(46,58): signed distance along the inward normal
const inCamp = (u) => (u.y || 0) < 0.1 && ((u.x - 16) * 25 - (u.z - 33) * 30) / Math.hypot(30, 25) > 1.5;

test('deck-edge rule (§4.7): a body / prone man on walk_sw is hidden from the camp below; a standing man is not', () => {
  const s = makeSim(getMission('m02'), { brains: false });
  const w = s.world, e5 = s.get('e5'), e7 = s.get('e7'), e6 = s.get('e6'), gb = s.cmd('greenberet');
  // e7 on his west leg, looking straight at the walkway (the finding's 98.8 s pose)
  Object.assign(e7, { x: 58.5, z: 40.4, heading: Math.PI, headOffset: 0, sweepActive: false });
  // e5 alive on the walk sees a man lying on the same walk (same surface: no deck edge between them)
  place(gb, 25.5, 40.9, 2.2);
  gb.setStance('crawl');
  assert.ok(gb.isLow);
  assert.equal(canSee(e7, gb, w), 'none', 'prone GB on the walk: hidden from e7');
  gb.setStance('stand');
  assert.notEqual(canSee(e7, gb, w), 'none', 'standing GB on the walk: e7 sees him (time it)');
  e5.die('shot', null);
  assert.ok(Math.abs(e5.y - 2.2) < 0.05, 'the body stays on the walk (y 2.2)');
  assert.equal(canSee(e7, e5, w), 'none', 'e5\'s body: hidden by the walk edge');
  assert.notEqual(canSee(e7, { x: e5.x, z: e5.z, y: e5.y, kind: 'body', falling: true }, w), 'none',
    'but e7 would see him fall (notifyKill: the victim is still upright)');
  // a viewer up on the same walk (eye above the deck) still finds the body
  Object.assign(e6, { x: 23.4, z: 38.8, y: 2.2, heading: Math.atan2(43.2 - 38.8, 28.5 - 23.4), headOffset: 0, sweepActive: false });
  assert.notEqual(canSee(e6, e5, w), 'none', 'viewer on the walk sees the body');
  // ground bodies are unaffected
  const e4 = s.get('e4');
  Object.assign(e4, { x: 50, z: 40 }); e4.die('shot', null);
  assert.notEqual(canSee(e7, e4, w), 'none', 'a body on the ground in e7\'s cone is still found');
});

test('m02 §7.5 step 2: snipe e4 then e5 from the SW bank; e5\'s body on walk_sw is never found (2 e7 loops)', () => {
  const s = m02Sim(), w = s.world;
  const sn = s.cmd('sniper'), e4 = s.get('e4'), e5 = s.get('e5'), e7 = s.get('e7');
  s.run(94);
  place(sn, 40, 81);
  s.run(1.1);
  assert.equal(s.alarms.length, 0, 'quiet before the shots');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: e4 }), 'shoot e4');
  s.run(3, () => !e4.alive);
  assert.equal(e4.alive, false, 'e4 down');
  s.run(1);
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: e5 }), 'shoot e5');
  s.run(3, () => !e5.alive);
  assert.equal(e5.alive, false, 'e5 down');
  assert.ok(Math.abs(e5.y - 2.2) < 0.05, 'body stays on the walkway');
  place(sn, 14, 88); // back behind the settlement palisade before the boat comes by (§7.5 step 3)
  let bodyState = null;
  s.run(140, () => { if (e7.brain?.state === 'BODY') bodyState = w.time; return false; });
  assert.equal(bodyState, null, 'e7 never enters BODY');
  assert.equal(s.alarms.length, 0, 'no alarm');
});

test('m02 §7.5 steps 2+4: after the snipes the GB climbs walk_sw, lowers the ladder and drops into the camp unseen', () => {
  const s = m02Sim(), w = s.world;
  const sn = s.cmd('sniper'), gb = s.cmd('greenberet'), e4 = s.get('e4'), e5 = s.get('e5'), e7 = s.get('e7');
  s.run(94);
  place(sn, 40, 81);
  s.run(1.1);
  sn.issue({ type: 'ability', id: 'sniper', target: e4 }); s.run(3, () => !e4.alive); s.run(1);
  sn.issue({ type: 'ability', id: 'sniper', target: e5 }); s.run(3, () => !e5.alive);
  assert.ok(!e4.alive && !e5.alive, 'both sentries down');
  place(sn, 14, 88);
  // window: the boat has passed downstream (step 3) and e7 turns onto his north (east-bound) leg, away
  // from the walkway; then the ferried GB (step 3 result) lands below the climbable edge
  const boat = s.get('pboat');
  let bx = boat.x;
  const window = () => { const east = boat.x > bx; bx = boat.x; return east && boat.x > 36 && boat.x < 50 && Math.hypot(e7.x - 46, e7.z - 29) < 0.6; };
  assert.ok(s.run(400, window), 'a step-4 window comes up');
  const t0 = w.time;
  place(gb, 24.6, 42.6);
  const lad = w.interactables.find((i) => i.interactKind === 'ladder');
  const link = () => w.grid.links.find((l) => l.id === lad.linkId);
  assert.ok(gb.issue({ type: 'ability', id: 'climb', target: { x: 24.3, z: 39.8 } }), 'GB: climb the SW edge');
  s.run(20, () => gb.y > 2.1 && !gb.path);
  assert.ok(gb.y > 2.1, `GB on the wall walk (y ${gb.y})`);
  assert.ok(gb.issue({ type: 'stance', stance: 'crawl' }), 'GB: down flat on the wall walk');
  assert.ok(gb.issue({ type: 'ability', id: 'use', target: lad }), 'GB: lower the ladder');
  s.run(30, () => link().enabled);
  assert.equal(link().enabled, true, 'ladder lowered from the wall walk');
  const tUp = w.time;
  s.run(0.5);
  assert.ok(gb.issue({ type: 'move', x: 32, z: 40 }), 'GB: down into the camp');
  s.run(25, () => inCamp(gb) && !gb.path);
  assert.ok(inCamp(gb), `GB inside the camp (${gb.x.toFixed(1)}, ${gb.z.toFixed(1)}, y ${gb.y})`);
  assert.equal(s.alarms.length, 0, 'no alarm');
});

