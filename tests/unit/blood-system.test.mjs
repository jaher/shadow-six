/**
 * bodies-design §B headless integration (world.blood = BloodSystem without a scene): events → wounds/pools/stains,
 * the syringe and censored mode spawn nothing, shoulder carry drips, drag smears, bloody feet on footfalls, and the
 * §B.7 save → load round trip (plus an old save without blood). Blood never touches gameplay state.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { BloodSystem, DK } from '../../src/render/blood/index.js';
import { fireBullet } from '../../src/abilities/weapons.js';

function sim(options = { blood: true, censored: false }) {
  Entity.nextId = 1;
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 4, z: 30 }, { role: 'spy', x: 12, z: 12 }],
    enemies: [guard('a', 20, 30, 0), guard('b', 30, 30, 0), guard('c', 40, 30, 0)] }, { brains: false });
  s.world.game = { options };
  s.world.blood = new BloodSystem(s.world, null);
  s.tick = (sec) => { for (let k = 0; k < Math.round(sec * 60); k++) { s.step(); s.world.blood.update(1 / 60); } };
  return s;
}
const gameplay = (w) => JSON.stringify(w.entities.filter((e) => e.kind === 'enemy' || e.kind === 'commando').map((e) => [e.id, e.x, e.z, e.hp, e.alive, e.state]));

test('blood-system: a rifle kill → exit spatter downrange, stains, a pool after the delay; gameplay untouched', () => {
  const s = sim(), W = s.world, B = W.blood, a = s.get(W.enemies[0].id), sn = s.cmd('sniper');
  fireBullet(W, sn, a, 999, 'sniper', 'sniperRifle');
  assert.equal(a.alive, false);
  const spat = B.decals.filter((d) => d.k <= DK.streak2);
  assert.ok(spat.length >= 3 && spat.length <= 8, `3–8 droplets (${spat.length})`);
  const dir = [a.x - sn.x, a.z - sn.z], L = Math.hypot(...dir);
  assert.ok(spat.every((d) => ((d.x - a.x) * dir[0] + (d.z - a.z) * dir[1]) / L > 0.2), 'the cone points away from the shooter');
  assert.ok(B.stains.get(a.id).some((st) => st.kind === 'entry') && B.stains.get(a.id).some((st) => st.kind === 'exit'), 'entry + exit wound slots');
  assert.equal(B.pools.length, 0, 'no pool yet (0.5–1.5 s delay)');
  s.tick(8);
  assert.equal(B.pools.length, 1);
  assert.equal(B.pools[0].volume, 0.8);
  // the same run without any blood system: identical gameplay state (presentation only)
  const t = sim(); t.world.blood.dispose(); t.world.blood = null;
  fireBullet(t.world, t.cmd('sniper'), t.world.enemies[0], 999, 'sniper', 'sniperRifle');
  for (let k = 0; k < 480; k++) t.step();
  assert.equal(gameplay(t.world), gameplay(W), 'gameplay identical with and without blood');
});

test('blood-system: the syringe, BLOOD off and CENSORED spawn nothing', () => {
  const s = sim(), W = s.world;
  W.enemies[0].die('injection', s.cmd('spy'));
  s.tick(5);
  assert.equal(W.blood.decals.length + W.blood.pools.length + W.blood.stains.size, 0, 'syringe: bloodless');
  for (const o of [{ blood: false }, { blood: true, censored: true }]) {
    const t = sim(o);
    fireBullet(t.world, t.cmd('sniper'), t.world.enemies[0], 999, 'sniper', 'sniperRifle');
    t.world.enemies[1].die('knife', t.cmd('greenberet'));
    t.tick(5);
    const b = t.world.blood;
    assert.equal(b.decals.length + b.pools.length + b.stains.size + b.bleeders.size, 0, JSON.stringify(o));
  }
});

test('blood-system: knife → spurt pulses over 1 s + attacker hand stain; carried on a shoulder → drips; dragged → smear', () => {
  const s = sim(), W = s.world, B = W.blood, gb = s.cmd('greenberet'), spy = s.cmd('spy');
  const b = W.enemies[1];
  b.die('knife', gb);
  s.tick(1.2);
  assert.ok(B.decals.filter((d) => d.k === DK.spurt).length === 3, 'three arterial pulses');
  assert.ok(B.stains.get(gb.id)?.some((st) => st.kind === 'spray'), 'the attacker gets a sleeve / hand spray');
  s.tick(4);
  const p = B.pools[0];
  assert.ok(p && !p.stopped, 'a pool under the knife victim');
  // shoulder carry: the pool stops, the body drips on the way
  b.state = 'carried'; b.carriedBy = spy; spy.carrying = b; spy.carryMode = 'shoulder';
  spy.setPosition(b.x, b.z); spy.moveTo(b.x + 8, b.z);
  const d0 = B.decals.length;
  s.tick(5);
  assert.ok(p.stopped, 'moving the body stops its pool');
  const drips = B.decals.slice(d0).filter((d) => d.k <= DK.drop4 || d.k === DK.crown || d.k === DK.soak);
  assert.ok(drips.length >= 3, `drips while carried (${drips.length})`);
  assert.equal(B.smears.length, 0, 'no smear on a shoulder');
  // drag: a smear ribbon behind
  spy.carryMode = 'drag'; spy.moveTo(spy.x, spy.z + 6);
  s.tick(5);
  assert.ok(B.smears.length > 20, `smear segments ${B.smears.length}`);
  // laid down: bleeds again where he lies
  spy.carrying = null; b.carriedBy = null; b.state = 'dead';
  s.tick(3);
  assert.equal(B.pools.filter((q) => !q.stopped).length, 1, 'a new pool where the body was put down');
});

test('blood-system: stepping in a fresh pool gives bloody boot prints on the next footfalls', () => {
  const s = sim(), W = s.world, B = W.blood, gb = s.cmd('greenberet'), e = W.enemies[0];
  fireBullet(W, s.cmd('sniper'), e, 999, 'sniper', 'sniperRifle');
  s.tick(20);
  const p = B.pools[0];
  gb.setPosition(p.x - 3, p.z); gb.moveTo(p.x + 6, p.z);
  s.tick(3);
  assert.ok(gb.bloodyFeet > 0, 'boots got bloody');
  const n0 = B.decals.length;
  for (let k = 0; k < 8; k++) B.onStep({ id: 'u' + gb.id, x: gb.x + k * 0.7, z: gb.z, yaw: 0, side: k % 2 ? 1 : -1, length: 0.34 });
  const prints = B.decals.slice(n0);
  assert.equal(prints.length, 6, 'six prints, then clean');
  assert.ok(prints[0].op > prints[5].op, 'fading');
});

test('blood-system: save → load keeps pools (seeds), decals, smears, stains, bleeders and bloody feet; old saves load clean', () => {
  const s = sim(), W = s.world, B = W.blood;
  fireBullet(W, s.cmd('sniper'), W.enemies[0], 999, 'sniper', 'sniperRifle');
  W.enemies[1].die('knife', s.cmd('greenberet'));
  s.tick(12);
  s.cmd('greenberet').bloodyFeet = 4;
  const snap = JSON.parse(JSON.stringify(B.serialize()));
  const B2 = new BloodSystem(W, null);
  B2.restore(snap);
  const back = JSON.parse(JSON.stringify(B2.serialize()));
  for (const k of Object.keys(snap)) assert.deepEqual(back[k], snap[k], `round trip: ${k}`);
  assert.equal(B2.bleeders.size, B.bleeders.size);
  B2.restore(null);
  assert.equal(B2.pools.length + B2.decals.length, 0, 'an old save without blood loads clean');
  B2.dispose();
});
