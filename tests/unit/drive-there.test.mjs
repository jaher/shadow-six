/**
 * "CAN'T GET THERE IN A STRAIGHT LINE" flashed once during the M3 film's raft crossing (m3fix_video.notes.md): the
 * solution driver clicked the end of a raft leg the raft had just reached (0.31 m away, behind its stern: it had
 * glided past), and Vehicle.canDriveTo refused every click closer than its 0.5 m minimum reach. A drive order to
 * where the hull already is is done — it stops there — and the message is only for an order the hull truly cannot
 * carry out (its straight reach toward the click, after the turn, is under that minimum).
 */
import { test, assert, near } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { T } from '../../src/world/grid.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';

const DT = 1 / 60;

/** A flat 80×60 world with deep water z∈[30,44] between shallow banks (tests/unit/vehicles.test.mjs). */
function riverWorld() {
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  w.grid.fillRect(0, 29, 80, 1, 'terrain', T.SHALLOW);
  w.grid.fillRect(0, 30, 80, 14, 'terrain', T.WATER);
  w.grid.fillRect(0, 44, 80, 1, 'terrain', T.SHALLOW);
  return w;
}

function step(w, n = 1) {
  for (let k = 0; k < n; k++) {
    w.rebuildSpatial();
    w.refreshDynamicOccluders();
    for (const c of [...w.commandos]) if (!c.removed) c.update(DT);
    for (const e of [...w.enemies]) if (!e.removed) e.update(DT);
    w.runBelTicks(DT);
    for (const v of [...w.vehicles]) if (!v.removed) v.update(DT);
    w.flushRemovals();
    w.time += DT;
  }
}

/** The Marine at the oars of a raft at (x, z) heading h; `msgs` collects the game's messages (the HUD's line). */
function crewedRaft(x = 20, z = 37, h = 0) {
  const w = riverWorld();
  const ma = w.add(new Commando({ role: 'diver', x: x, z: 28.5, heading: 0 }));
  const raft = w.spawnVehicle('raft', { x, z, heading: h });
  assert.ok(raft.enter(ma), 'the Marine takes the oars');
  const msgs = [];
  w.events.on('message', (m) => msgs.push(m.text));
  return { w, ma, raft, msgs };
}

test('raft: a click on the spot it has just reached (0.31 m behind its stern, gliding past) is done — it stops, no message', () => {
  const { w, ma, raft, msgs } = crewedRaft(20, 37, 0);
  assert.ok(ma.issue({ type: 'move', x: 40, z: 37 }), 'rowing east');
  step(w, 120);
  assert.ok(raft.speed > 2 && raft.goal, `under way (${raft.speed.toFixed(2)} m/s)`);
  // the film's case: raft (65.56, 67.19) heading −95°, click (65.5, 67.5) — the point it has just passed, 0.31 m astern
  const bx = raft.x - Math.cos(raft.heading) * 0.31, bz = raft.z - Math.sin(raft.heading) * 0.31;
  assert.ok(raft.canDriveTo(bx, bz), 'no forbidden cursor on the spot it is on');
  assert.ok(ma.issue({ type: 'move', x: bx, z: bz }), 'the order is taken');
  assert.deepEqual(msgs, [], 'no "can\'t get there in a straight line"');
  assert.equal(raft.goal, null, 'it stops there');
  assert.equal(raft.speed, 0);
  const x0 = raft.x, h0 = raft.heading;
  step(w, 60);
  near(raft.x, x0, 1e-9, 'and stays (no spin round for a hand\'s breadth)');
  near(raft.heading, h0, 1e-9);
  // its own centre, at rest: also done
  assert.ok(ma.issue({ type: 'move', x: raft.x, z: raft.z }));
  assert.deepEqual(msgs, []);
});

test('raft: a click ahead within reach rows there; one it truly cannot reach (the bank under its bow) is refused with the message', () => {
  const { w, ma, raft, msgs } = crewedRaft(20, 37, 0);
  assert.ok(ma.issue({ type: 'move', x: 30, z: 37 }));
  step(w, 60 * 8);
  near(raft.x, 30, 0.35, 'arrived'); assert.equal(raft.goal, null);
  assert.deepEqual(msgs, []);
  // onto the land past the north bank, the bow already in the shallows: it cannot move that way at all
  assert.ok(ma.issue({ type: 'move', x: 30, z: 55 }));
  step(w, 60 * 10);
  assert.ok(raft.z < 44.5, `stopped at the bank (${raft.z.toFixed(2)})`);
  assert.deepEqual(msgs, []);
  const before = msgs.length;
  assert.equal(ma.issue({ type: 'move', x: raft.x, z: 58 }), false, 'nose at the bank: refused');
  assert.equal(msgs.length, before + 1);
  assert.match(msgs.at(-1), /can't get there in a straight line/);
});

test('raft soak: every click either brings the raft there (or to its first blocking cell) with no message, or is refused because it truly cannot move that way', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const { w, ma, raft, msgs } = crewedRaft(40, 37, 0);
  let taken = 0, refused = 0, near0 = 0;
  for (let k = 0; k < 120; k++) {
    // short clicks around the hull (a leg end it has just reached, glided past or not) mixed with long ones
    const short = k % 2 === 0, a = rnd() * Math.PI * 2, r = short ? rnd() * 0.7 : 1 + rnd() * 12;
    const x = raft.x + Math.cos(a) * r, z = raft.z + Math.sin(a) * r;
    if (k % 3 === 0 && raft.goal) step(w, 1 + Math.floor(rnd() * 20)); // sometimes mid-glide
    const n0 = msgs.length, reach = raft.straightReach(x, z), d = Math.hypot(x - raft.x, z - raft.z);
    const ok = ma.issue({ type: 'move', x, z });
    if (!ok) {
      refused++;
      assert.equal(msgs.length, n0 + 1, 'a refused click says so');
      assert.ok(d >= 0.5 && reach < 0.5, `refused only when it cannot move that way (d ${d.toFixed(2)}, reach ${reach.toFixed(2)})`);
      continue;
    }
    taken++;
    if (d < 0.5) near0++;
    assert.equal(msgs.length, n0, `taken without a message (d ${d.toFixed(2)})`);
    for (let i = 0; i < 60 * 12 && (raft.goal || raft.speed > 0); i++) step(w);
    assert.equal(raft.goal, null, 'the order ends');
    const left = Math.hypot(x - raft.x, z - raft.z);
    assert.ok(left < 0.5 || raft.straightReach(x, z) < 0.5, `there (${left.toFixed(2)} m off) or at its first blocking cell`);
  }
  assert.ok(taken > 60 && near0 > 20, `${taken} taken (${near0} on the spot), ${refused} refused`);
});
