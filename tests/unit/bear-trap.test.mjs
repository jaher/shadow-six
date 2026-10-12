/**
 * The Sapper's bear trap model (user 2026-10-07 "the trap needs to look more realistic, now it looks like a circle"):
 * a jaw trap — two serrated steel jaws on a hinge bar with the pan, a leaf spring each side, a chain to a stake —
 * half sunk in the theater's ground while set (jaw rims and teeth show through the cover, springs and bar under it),
 * jaws shut upright and the cover kicked off once sprung. The old one was a 0.5 m dark disc.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { makeBearTrap, BEAR_TRAP } from '../../src/art/bear-trap.js';
import { Trap } from '../../src/abilities/charges.js';
import { makeWorld, addEnemy, addCommando, step } from './ai-harness.mjs';

const box = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
const byName = (root, n) => { let r = null; root.traverse((o) => { if (!r && o.name === n) r = o; }); return r; };

test('bear trap: jaws, teeth, springs, pan, chain and stake — not a disc', () => {
  const g = makeBearTrap({ theater: 'snow' });
  const [ja, jb] = g.userData.jaws;
  assert.ok(ja && jb, 'two jaws');
  for (const j of [ja, jb]) assert.equal(j.children.filter((c) => c.geometry?.type === 'ConeGeometry').length, BEAR_TRAP.TEETH, 'serrated');
  assert.equal(g.userData.springs.length, 2, 'two leaf springs');
  assert.ok(byName(g, 'trap_pan'), 'pan');
  const chain = byName(g, 'trap_chain');
  assert.ok(chain && chain.children.filter((c) => c.geometry?.type === 'TorusGeometry').length >= 6, 'chain links + stake ring');
  assert.ok(chain.children.some((c) => c.geometry?.type === 'CylinderGeometry'), 'stake');
  g.userData.cover.visible = false;
  const b = box(g.getObjectByName('trap_body'));
  const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
  assert.ok(sx > 0.85 && sx < 1.3, `long-spring trap ≈ 1 m long (${sx.toFixed(2)})`);
  assert.ok(sz > 0.34 && sx / sz > 1.5, `elongated, not round (${sx.toFixed(2)} × ${sz.toFixed(2)})`);
});

test('bear trap: set = jaws open flat and half sunk in the ground (teeth and pan show, springs covered)', () => {
  const g = makeBearTrap({ theater: 'snow' });
  const jaws = box(g.userData.jaws[0]).union(box(g.userData.jaws[1]));
  assert.ok(jaws.max.y < 0.08, `jaws lie flat (top ${jaws.max.y.toFixed(3)} m)`);
  assert.ok(jaws.max.z - jaws.min.z > 0.33, 'open: the two jaws spread ±R');
  const mound = byName(g, 'trap_mound');
  const top = box(mound).max.y;
  assert.ok(g.userData.cover.visible, 'cover on while set');
  assert.ok(jaws.max.y > top + 0.015, `the teeth show through the cover (${jaws.max.y.toFixed(3)} > ${top.toFixed(3)})`);
  const lower = g.userData.springs[0].children[0];
  assert.ok(box(lower).max.y < top, 'springs under the cover');
  assert.ok(box(byName(g, 'trap_pan')).max.y > top, 'the pan shows in the middle of the open jaws');
});

test('bear trap: sprung = jaws shut upright, springs open, cover kicked off; ground tint per theater', () => {
  const g = makeBearTrap({ theater: 'desert' });
  const cov = g.userData.cover.userData.mat.color.getHex();
  g.userData.setGround('snow');
  assert.notEqual(g.userData.cover.userData.mat.color.getHex(), cov, 'snow ≠ sand cover');
  g.userData.setSprung(1);
  const ja = box(g.userData.jaws[0]), jb = box(g.userData.jaws[1]);
  assert.ok(ja.max.y > 0.17 && jb.max.y > 0.17, `jaws stand up (${ja.max.y.toFixed(3)}, ${jb.max.y.toFixed(3)})`);
  assert.ok(ja.max.z - ja.min.z < 0.08, 'shut: each jaw in the vertical plane');
  assert.equal(g.userData.cover.visible, false, 'cover kicked off');
  assert.ok(g.userData.springs[0].userData.upper.rotation.z !== 0, 'spring leaf open');
});

test('bear trap: the Trap entity carries the model, snaps shut on its victim, keeps its heading in saves', () => {
  const w = makeWorld({ theater: 'snow' });
  const t = new Trap({ x: 20, z: 20, heading: 1.2 });
  w.add(t);
  assert.equal(t.object3d.name, 'bear_trap');
  assert.equal(t.object3d.userData.theater, 'snow', 'snow cover in a snow mission');
  assert.equal(t.object3d.userData.sprung, 0);
  const e = addEnemy(w, { id: 'v', soldierType: 'trooper', x: 20.2, z: 20 });
  for (let i = 0; i < 12; i++) { step(w); t.update(1 / 60); } // (the AI harness steps units only)
  assert.ok(t.sprung && !e.alive, 'sprung on the enemy');
  assert.equal(t.object3d.userData.sprung, 1, 'jaws shut within 0.2 s');
  assert.equal(t.serialize().trapHeading, 1.2);
});

// M3 film review: the trap that took p1's sergeant put his two troopers into combat. Not a rule bug: the trap kills in
// silence (no noise: nobody hears it) but not unseen (research.md: "silent, not invisible: a kill inside someone's
// cone is still seen") — the troopers walk 1.2 m behind their sergeant, looking at him. The solution now traps the
// sergeant alone, his men harpooned first behind his back (tools/solutions/m03.solution.mjs stage A).
test('bear trap: the kill makes no noise and nobody with his back to it notices; mates walking behind the victim see him fall', () => {
  const route = { type: 'PINGPONG', vel: 1.0, points: [{ x: 20, z: 20 }, { x: 60, z: 20 }] };
  const w = makeWorld({ enemies: [
    ...['s', 'a', 'b'].map((id, k) => ({ id, soldierType: k ? 'trooper' : 'sergeant', x: 20 - 1.5 * k, z: 20, heading: 0, squad: { id: 'p1', leader: 's', columns: 1 }, route })),
    // a sentry 4 m off the trap, his back to it
    { id: 'g', soldierType: 'sentry', x: 30, z: 24, heading: Math.PI / 2, post: { heading: Math.PI / 2, sweep: 0 } },
  ] });
  const sapper = addCommando(w, 'sapper', 5, 70);
  const noises = [];
  w.events.on('noise', (n) => noises.push({ t: w.time, kind: n.kind, src: n.source?.faction }));
  const trap = new Trap({ x: 30, z: 20, owner: sapper });
  w.add(trap);
  const [s, a, b, g] = ['s', 'a', 'b', 'g'].map((id) => w.enemies.find((e) => e.tag === id || e.id === id || e.spawn?.id === id));
  let tk = null;
  w.events.on('trap:sprung', () => { tk = w.time; });
  for (let i = 0; i < 60 * 20 && tk == null; i++) { step(w); trap.update(1 / 60); }
  assert.ok(tk != null && !s.alive, 'the sergeant, in front, steps in it');
  for (let i = 0; i < 30; i++) { step(w); trap.update(1 / 60); }
  assert.deepEqual(noises.filter((n) => n.t >= tk - 1e-6), [], 'no noise from the kill');
  assert.equal(g.brain.state, 'IDLE', 'the sentry with his back to it never knew');
  assert.ok(a.sawKill && b.sawKill, 'the troopers behind him saw him fall');
  assert.ok(['COMBAT', 'SEARCH'].includes(a.brain.state) && ['COMBAT', 'SEARCH'].includes(b.brain.state), `…and fight (${a.brain.state}, ${b.brain.state})`);
});
