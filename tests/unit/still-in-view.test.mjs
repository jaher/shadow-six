/**
 * SHADOW SIX still rule (§4.5; user 2026-10-07: "also just make sure no commando goes inside the field of view of a
 * solider before being spotted. Even the raft boat in the light shaded field of view of a soldier makes the soldier
 * see it"). M14 solution finding (2026-10-11): BEL's nervousness only grew with displacement (N += floor(2·d²)), so a
 * commando lying still inside a guard's near (dark) band was never noticed — the planner could park a man there for
 * ever. Now whoever the band rule lets a guard see (a prone man in the near band, a standing man anywhere in the cone)
 * builds N at least as a crawler does (+2 a tick, net +1): a still man is challenged ~2.5 s after he comes into view.
 * The timing model is kept (walkers 0.25 s, crawlers 2.5 s, decay 1 a tick, T per spawn). Legitimately hidden men never
 * build N: buried, submerged, in a building or a closed vehicle, the disguised Spy, a prone man in the light far band.
 */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { canSee } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';

// the guard at (20, 30) on a post; he starts looking AWAY (west); turnOnto() swings his post round to the east, onto the
// man, with the brain's own smooth turn — the man never moves, so no displacement ever feeds N
const GX = 20, GZ = 30;
const turnOnto = (g) => { g.post.heading = 0; };

/** Sim with real brains; `cmd` the commando spawn; `extra` mission fields. */
function scene(cmd, extra = {}) {
  const s = makeSim({ size: [90, 60], ...extra, commandos: [cmd], enemies: [guard('g', GX, GZ, Math.PI)] });
  const g = s.get('g');
  g.sweepActive = false;
  const log = { challenge: null, seen: null };
  s.world.events.on('enemy:challenge', (p) => { if (log.challenge == null) log.challenge = { t: s.world.time, target: p.target }; });
  return { s, g, w: s.world, c: s.world.commandos[0], log };
}

/** Run up to `secs`, noting the first tick the guard sees `c`; stops at the first challenge. */
function watch(o, secs) {
  o.s.run(secs, () => {
    if (o.log.seen == null && canSee(o.g, o.c, o.w) !== 'none') o.log.seen = o.w.time;
    return o.log.challenge != null;
  });
}

test('still rule: a man lying still in a guard\'s near band is challenged like a crawler (~2.5 s after he comes into view)', () => {
  const o = scene({ role: 'greenberet', x: 30, z: 30 });
  o.c.setStance('crawl');
  o.s.run(1.5); // he lies down behind the guard's back
  assert.equal(o.c.stance, 'crawl');
  assert.equal(o.log.challenge, null);
  const at = { x: o.c.x, z: o.c.z };
  turnOnto(o.g);
  watch(o, 8);
  assert.ok(o.log.seen != null, 'the guard\'s cone came onto him (10 m: near band)');
  assert.ok(o.log.challenge, 'a man lying still in plain view is noticed');
  assert.equal(o.log.challenge.target, o.c);
  near(o.log.challenge.t - o.log.seen, 2.5, 0.25, 'still-man notice time (crawler pace)');
  assert.ok(Math.hypot(o.c.x - at.x, o.c.z - at.z) < 1e-9, 'he never moved');
});

test('still rule: a man standing still in the light far band (28 m) is challenged too; prone there he is not (band rule)', () => {
  const st = scene({ role: 'greenberet', x: GX + 28, z: GZ });
  st.s.run(0.5);
  turnOnto(st.g);
  watch(st, 8);
  assert.equal(canSee(st.g, st.c, st.w), 'far');
  assert.ok(st.log.challenge, 'standing still in the far band: challenged');
  near(st.log.challenge.t - st.log.seen, 2.5, 0.25);

  const pr = scene({ role: 'greenberet', x: GX + 28, z: GZ });
  pr.c.setStance('crawl');
  pr.s.run(1.5);
  turnOnto(pr.g);
  watch(pr, 10);
  assert.equal(pr.log.seen, null, 'prone in the far band: not seen');
  assert.equal(pr.log.challenge, null);
  assert.equal(pr.g.nervousness, 0);
});

test('still rule: the timing model stays — a still man glimpsed for 1 s is not challenged, and N decays once he is out of view', () => {
  const o = scene({ role: 'greenberet', x: 30, z: 30 });
  o.c.setStance('crawl');
  o.s.run(1.5);
  turnOnto(o.g);
  o.s.run(4, () => canSee(o.g, o.c, o.w) !== 'none');
  o.s.run(1);
  assert.ok(o.g.nervousness > 0 && o.g.nervousness < o.g.nervThreshold, `N built up but below T (${o.g.nervousness})`);
  o.g.post.heading = Math.PI; // he looks away again
  o.s.run(6);
  assert.equal(o.log.challenge, null, 'a 1 s glimpse is not enough');
  assert.equal(o.g.nervousness, 0, 'decayed');
  // a walker is still noticed at once (0.25 s): the displacement rule wins over the still floor
  const wk = scene({ role: 'greenberet', x: 30, z: 20 });
  wk.s.run(0.2);
  wk.g.post.heading = 0; wk.g.heading = 0; // facing east already
  wk.c.moveTo(30, 40);
  watch(wk, 3);
  assert.ok(wk.log.challenge && wk.log.challenge.t - wk.log.seen <= 0.4, `walker challenged ${(wk.log.challenge?.t - wk.log.seen).toFixed(2)} s after he is seen`);
});

test('still rule: a per-spawn threshold sets the pace as for a crawler (+2, net +1 a tick: T 20 in ~1 s, T 100 in ~5 s)', () => {
  for (const [T, want] of [[20, 1.0], [100, 5.0]]) {
    const s = makeSim({ size: [90, 60], commandos: [{ role: 'greenberet', x: 30, z: 30 }], enemies: [guard('g', GX, GZ, Math.PI, { nervousness: T })] });
    const o = { s, g: s.get('g'), w: s.world, c: s.world.commandos[0], log: { challenge: null, seen: null } };
    s.world.events.on('enemy:challenge', (p) => { if (o.log.challenge == null) o.log.challenge = { t: s.world.time, target: p.target }; });
    o.c.setStance('crawl'); s.run(1.5);
    assert.equal(o.g.nervThreshold, T);
    turnOnto(o.g);
    watch(o, 9);
    assert.ok(o.log.challenge, `T ${T}: challenged`);
    near(o.log.challenge.t - o.log.seen, want, 0.25, `T ${T}`);
  }
  assert.equal(CONFIG.ai.nervousness.stillAdd, 2);
});

// ---------------------------------------------------------------- legitimately hidden: never noticed, N stays 0

/** Guard turns onto the hidden man (10 m: near band) and stares 10 s: nobody is challenged, N never grows. */
function staysHidden(o, label) {
  turnOnto(o.g);
  o.s.run(1.5);
  const cone = (o.g.heading + 4 * Math.PI) % (2 * Math.PI);
  assert.ok(cone < 0.05 || cone > 2 * Math.PI - 0.05, `${label}: the guard faces him (heading ${cone.toFixed(3)})`);
  watch(o, 10);
  assert.equal(o.log.seen, null, `${label}: not seen`);
  assert.equal(o.log.challenge, null, `${label}: never challenged`);
  assert.equal(o.g.nervousness, 0, `${label}: N 0`);
}

test('still rule: a Green Beret buried in the snow inside the near band is never noticed (unless the guard watched him dig)', () => {
  const snow = { terrain: [{ type: 'rect', terrain: 'snow', x: 0, z: 0, w: 90, d: 60 }] };
  const o = scene({ role: 'greenberet', x: 30, z: 30, inventory: { shovel: 1 } }, snow);
  assert.ok(o.c.issue({ type: 'ability', id: 'shovel', target: o.c }));
  o.s.run(2.5);
  assert.ok(o.c.buried && !o.c.isVisibleToEnemies, 'buried behind the guard\'s back');
  staysHidden(o, 'buried');
  // the witness rule (§3.4): a guard who saw him go under keeps him as a near-band crawler — and now notices him
  const wt = scene({ role: 'greenberet', x: 30, z: 30, inventory: { shovel: 1 } }, snow);
  wt.g.post.heading = 0; wt.g.heading = 0;
  wt.s.run(0.2);
  assert.ok(wt.c.issue({ type: 'ability', id: 'shovel', target: wt.c }));
  watch(wt, 8);
  assert.ok(wt.c.buried || wt.log.challenge, 'he went under in view');
  assert.ok(wt.log.challenge, 'the witness notices him');
});

test('still rule: a Marine submerged in the near band is never noticed', () => {
  const river = {
    shoreShallowWidth: 0,
    terrain: [{ type: 'path', terrain: 'shallow', points: [[30, 0], [30, 60]], width: 7 }],
    structures: [{ type: 'river', points: [[30, 0], [30, 60]], width: 5 }],
  };
  const o = scene({ role: 'diver', x: 26.9, z: 30 }, river);
  assert.ok(o.c.issue({ type: 'ability', id: 'dive', target: o.c }));
  o.s.run(2);
  assert.ok(o.c.underwater && !o.c.isVisibleToEnemies, 'submerged');
  staysHidden(o, 'submerged');
});

test('still rule: a man in a building or in a closed vehicle (truck cab) inside the near band is never noticed', () => {
  const o = scene({ role: 'greenberet', x: 40, z: 22 }, { structures: [{ type: 'house', id: 'h1', x: 32, z: 30, rot: 0, enterable: true }] });
  const door = o.s.get('h1:door');
  assert.ok(o.c.issue({ type: 'ability', id: 'use', target: door }));
  o.s.run(12, () => o.c.hidden);
  assert.ok(o.c.hidden && o.c.state === 'hidden', 'inside the house');
  staysHidden(o, 'in a building');

  const v = scene({ role: 'driver', x: 30, z: 33 }, { vehicles: [{ id: 'truck', vehicleType: 'truck', x: 30, z: 30, heading: 0 }] });
  const truck = v.s.get('truck');
  assert.ok(truck.enter(v.c), 'he gets in behind the guard\'s back');
  v.s.run(0.5);
  assert.equal(v.c.state, 'inVehicle');
  assert.ok(!truck.isOpenBoat);
  staysHidden(v, 'in the truck cab');
});

test('still rule: the disguised Spy standing in the near band is ignored (BEL: no rank sees through it)', () => {
  const o = scene({ role: 'spy', x: 30, z: 30 }, { startDisguised: ['spy'] });
  o.s.run(0.5);
  assert.ok(o.c.disguised);
  staysHidden(o, 'disguised Spy');
});
