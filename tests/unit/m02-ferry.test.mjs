/**
 * M2 wide river, fairness of the crossing (§7.5 step 3 "After the boat passes, the Marine ferries the team (two
 * per trip) and packs the raft"; hint "Hide when the patrol boat passes"). The river is ~24 m wide now (was 12),
 * so each raft leg takes ~10 s instead of ~5: the whole team still crosses between two boat passes, waiting
 * prone on the SW shore (out of the boat's 14.4 m near band) and hiding prone in the NE-bank rock pockets.
 * Headless: full brains + Alarm, step 1–2 kills (e1–e5) done by removal, like the scripted replay.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { Alarm } from '../../src/ai/alarm.js';

const place = (u, x, z) => { Object.assign(u, { x, z, y: 0, path: null }); };

test('m02 wide river: the Marine ferries all four across (two per trip) between boat passes, unseen, and packs the raft', () => {
  const s = makeSim(getMission('m02'));
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) w.remove(s.get(id));
  w.flushRemovals();
  const alarms = []; w.events.on('alarm:zone', (p) => alarms.push({ t: w.time, ...p }));
  const boat = s.get('pboat');
  let attacked = null;
  w.events.on('shot', (p) => { if (p.shooter === boat || p.shooter?.vehicle === boat) attacked = attacked ?? w.time; });
  const watch = () => { if (boat.brain?.state === 'attack') attacked = attacked ?? w.time; return false; };
  const [gb, sn, ma, sa, dr] = ['greenberet', 'sniper', 'diver', 'sapper', 'driver'].map((r) => s.cmd(r));
  // the team waits prone on the SW shore below the settlement (the start → shore walk is covered in m02-river)
  const shore = { [gb.id]: [18.2, 74.6], [sn.id]: [20.2, 75.0], [sa.id]: [17.0, 75.2], [dr.id]: [21.4, 75.6] };
  for (const u of [gb, sn, sa, dr]) { place(u, ...shore[u.id]); u.issue({ type: 'stance', stance: 'crawl' }); }
  place(ma, 19.2, 74.8); ma.issue({ type: 'stance', stance: 'crawl' });
  // window: the boat has just gone by downstream
  let bx = boat.x;
  assert.ok(s.run(400, () => { watch(); const east = boat.x > bx; bx = boat.x; return east && boat.x > 32; }), 'boat passes downstream');
  const t0 = w.time;
  const rowTo = (x, z, max = 25) => {
    assert.ok(ma.issue({ type: 'move', x, z }), `Marine: row to (${x},${z})`);
    s.run(max, () => watch() || Math.hypot(raft.x - x, raft.z - z) < 2.5);
    assert.ok(Math.hypot(raft.x - x, raft.z - z) < 2.5, `raft at (${raft.x.toFixed(1)},${raft.z.toFixed(1)}) by ${(w.time - t0).toFixed(1)} s`);
  };
  const board = (...us) => {
    for (const u of us) assert.ok(u.issue({ type: 'ability', id: 'enterVehicle', target: raft }), `${u.role}: board`);
    s.run(12, () => watch() || us.every((u) => u.vehicle === raft));
    for (const u of us) assert.equal(u.vehicle, raft, `${u.role} aboard`);
  };
  const land = (...us) => { for (const u of us) assert.ok(u.issue({ type: 'ability', id: 'leaveVehicle', target: u }), `${u.role}: land`); s.run(3, () => watch() || us.every((u) => !u.vehicle && !u.path && !u.task)); };
  /** get down first (the stance change takes a moment), then crawl to the pocket */
  const hide = (...spots) => {
    // out of the shallows first (no crawling in water), onto the dry bank below rocks_n2
    spots.forEach(([u], k) => assert.ok(u.issue({ type: 'move', x: 28.4 + k * 0.9, z: 48.6 + k * 0.6 }), `${u.role}: up the bank`));
    s.run(5, () => watch() || spots.every(([u]) => !u.path));
    for (const [u] of spots) assert.ok(u.issue({ type: 'stance', stance: 'crawl' }), `${u.role}: down (${u.x.toFixed(1)},${u.z.toFixed(1)})`);
    s.run(1, watch);
    for (const [u, x, z] of spots) assert.ok(u.issue({ type: 'move', x, z }) && u.stance === 'crawl', `${u.role}: crawl to (${x},${z}) (${u.stance})`);
  };

  ma.issue({ type: 'stance', stance: 'stand' });
  assert.ok(ma.issue({ type: 'move', x: 19.5, z: 73.2 }), 'Marine: into the shallows');
  s.run(4, () => watch() || !ma.path);
  assert.ok(ma.issue({ type: 'ability', id: 'raft', target: ma }), `Marine: deploy the raft (${ma.lastRefusal?.text || ''} ${ma.stance} ${ma.x.toFixed(1)},${ma.z.toFixed(1)})`);
  s.run(2.2, watch);
  const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
  assert.ok(raft && raft.operator === ma, 'raft deployed, Marine aboard');
  // trip 1: GB + Sniper
  for (const u of [gb, sn]) u.issue({ type: 'stance', stance: 'stand' });
  board(gb, sn);
  rowTo(27.9, 49.6);
  land(gb, sn);
  hide([gb, 24, 41], [sn, 21, 38]);
  const t1 = w.time - t0;
  // back for Sapper + Driver
  rowTo(19.5, 72.6);
  for (const u of [sa, dr]) u.issue({ type: 'stance', stance: 'stand' });
  board(sa, dr);
  rowTo(27.9, 49.6);
  land(sa, dr, ma);
  hide([sa, 34, 48.5], [dr, 42.5, 55.5]);
  const t2 = w.time - t0;
  assert.ok(ma.issue({ type: 'move', x: 27.2, z: 50.3 }));
  s.run(4, () => watch() || !ma.path);
  assert.ok(ma.issue({ type: 'ability', id: 'hand', target: raft }), 'Marine: pack the raft');
  s.run(3, () => watch() || raft.removed);
  assert.ok(raft.removed && ma.has('inflatableBoat'), 'raft packed');
  hide([ma, 33.5, 49]);
  // a whole boat cycle with everybody prone in the pockets
  s.run(110, watch);
  for (const u of [gb, sn, ma, sa, dr]) assert.ok(u.alive, `${u.role} alive`);
  assert.equal(attacked, null, `the boat never engaged (trip 1 landed ${t1.toFixed(1)} s, trip 2 ${t2.toFixed(1)} s after it passed)`);
  assert.equal(alarms.length, 0, `no alarm ${JSON.stringify(alarms[0] || {})}`);
  for (const [u, x, z] of [[gb, 24, 41], [sn, 21, 38], [sa, 34, 48.5], [dr, 42.5, 55.5], [ma, 33.5, 49]]) {
    assert.ok(Math.hypot(u.x - x, u.z - z) < 1 && u.stance === 'crawl', `${u.role} hidden prone at (${x},${z}): (${u.x.toFixed(1)},${u.z.toFixed(1)}) ${u.stance}`);
  }
});
