/**
 * §3.3 / §3.6 every weapon sets off an explosive barrel (or a fuel tanker) only inside ITS OWN range (M14 solution
 * finding, 2026-10-11: the harpoon reached barrels at the sniper rifle's 45 m — its barrel check used W.sniper.range
 * and the sniper's bolt clock). The table: pistol 13.5 m, SMG 18 m, sniper 45 m, harpoon 9 m, Lee-Enfield 27 m (BCD),
 * grenade 13.5 m throw + 4.5 m chain. In range (with LOS) the order is accepted and the barrel goes up; beyond it the
 * order is refused ('Out of range.', the forbidden cursor) and nothing explodes. An 'enemy'-targeting weapon that
 * takes barrels / tankers also lets the cursor pick them (def.hitsBarrels / hitsTankers), so a player can give every
 * order a scripted solution gives.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { bcdSim } from './bcd-sim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { CONFIG } from '../../src/config.js';
import { createVehicle } from '../../src/entities/vehicle.js';

const W = CONFIG.weapons;
const X0 = 5, Z = 20;

/** One shooter at (X0, Z) and one barrel `d` m east of him on open grass. */
function barrelAt(role, d, o = {}) {
  const def = { size: [80, 40], commandos: [{ role, x: X0, z: Z, heading: 0, ...(o.inventory ? { inventory: o.inventory } : {}) }], interactables: [{ kind: 'barrel', id: 'b', x: X0 + d, z: Z }] };
  const s = o.bcd ? bcdSim(def) : makeSim(def, { brains: false });
  return { s, c: s.cmd(role), b: s.world.byId('b') || s.world.interactables.find((i) => i.interactKind === 'barrel') };
}

// [role, ability, range, target(b) → the order's target, sim options]
const GUNS = [
  ['greenberet', 'pistol', W.pistol.range, (b) => b, {}],
  ['driver', 'smg', W.smg.range, (b) => ({ x: b.x, z: b.z }), { inventory: { smg: 5 } }],
  ['sniper', 'sniper', W.sniper.range, (b) => b, { inventory: { sniperRifle: 3 } }],
  ['diver', 'harpoon', W.harpoon.range, (b) => b, {}],
  ['driver', 'rifle', W.leeEnfield.range, (b) => b, { bcd: true }],
];

for (const [role, id, range, tgt, o] of GUNS) {
  test(`explosive reach: ${id} sets off a barrel at ${(range - 0.5).toFixed(1)} m (its ${range} m range)`, () => {
    const { s, c, b } = barrelAt(role, range - 0.5, o);
    assert.ok(b && !b.exploded, 'barrel placed');
    assert.equal(ABILITIES[id].canUse(c, tgt(b), s.world), true, `${id} canUse in range`);
    assert.equal(c.issue({ type: 'ability', id, target: tgt(b) }), true, `${id} order accepted`);
    s.run(2, () => b.exploded);
    assert.equal(b.exploded, true, `${id}: the barrel went up`);
    assert.ok(Math.abs(c.x - X0) < 1e-6, 'fired from where he stands');
  });

  test(`explosive reach: ${id} refuses a barrel beyond its ${range} m (at ${(range + 1).toFixed(1)} m and at 44 m)`, () => {
    for (const d of [range + 1, 44].filter((v) => v > range)) {
      const { s, c, b } = barrelAt(role, d, o);
      assert.equal(ABILITIES[id].canUse(c, tgt(b), s.world), 'Out of range.', `${id} at ${d} m`);
      assert.equal(c.issue({ type: 'ability', id, target: tgt(b) }), false, `${id} order refused at ${d} m`);
      s.run(2);
      assert.equal(b.exploded, false, `${id}: no blast at ${d} m`);
      assert.ok(Math.abs(c.x - X0) < 1e-6, 'never walks into range');
    }
  });
}

test('explosive reach: the harpoon at a barrel reloads on its own 3 s clock (not the rifle bolt)', () => {
  const { s, c, b } = barrelAt('diver', 6);
  c._harpoonT = s.world.time + W.harpoon.reload; // a harpoon just fired at a man
  assert.equal(ABILITIES.harpoon.canUse(c, b, s.world), 'Reloading.');
  c._harpoonT = -1;
  c._boltT = s.world.time + 10; // a bolt clock (sniper) never gates the harpoon
  assert.equal(ABILITIES.harpoon.canUse(c, b, s.world), true);
});

test('explosive reach: a barrel that ends up beyond the harpoon\'s 9 m when it fires is not hit', () => {
  const { s, c, b } = barrelAt('diver', 8);
  assert.equal(c.issue({ type: 'ability', id: 'harpoon', target: b }), true);
  b.x = X0 + 20; // (moved off before the bolt flies: the shot is checked again at the trigger)
  s.run(1.5);
  assert.equal(b.exploded, false);
});

test('explosive reach: a fuel tanker — harpoon 9 m, sniper 45 m, pistol 13.5 m (from the hull centre)', () => {
  for (const [role, id, range, o] of [['diver', 'harpoon', W.harpoon.range, {}], ['sniper', 'sniper', W.sniper.range, { sniperRifle: 3 }], ['greenberet', 'pistol', W.pistol.range, {}]]) {
    for (const [d, ok] of [[range - 0.5, true], [range + 1.5, false]]) {
      const s = makeSim({ size: [90, 40], commandos: [{ role, x: X0, z: Z, heading: 0, inventory: Object.keys(o).length ? o : undefined }] }, { brains: false });
      s.world.vehicleFactory = createVehicle;
      const tk = s.world.add(createVehicle({ vehicleType: 'opel_blitz_tanker', x: X0 + d, z: Z, heading: Math.PI / 2 }));
      s.world.rebuildSpatial(); s.world.refreshDynamicOccluders();
      const r = ABILITIES[id].canUse(s.cmd(role), tk, s.world);
      assert.equal(r === true, ok, `${id} tanker at ${d} m: ${r}`);
    }
  }
});

test('explosive reach: a grenade thrown 13 m sets off a barrel 4 m from where it lands (chain 4.5 m), not one 5.5 m off', () => {
  for (const [off, want] of [[4, true], [5.5, false]]) {
    const { s, c, b } = barrelAt('sapper', 13 + off, { inventory: { grenade: 1 } });
    assert.equal(ABILITIES.grenade.canUse(c, { x: X0 + 13, z: Z }, s.world), true);
    assert.equal(ABILITIES.grenade.canUse(c, { x: X0 + 15, z: Z }, s.world), 'Out of range.', 'throw 13.5 m');
    assert.equal(c.issue({ type: 'ability', id: 'grenade', target: { x: X0 + 13, z: Z } }), true);
    s.run(4);
    assert.equal(b.exploded, want, `barrel ${off} m from the landing point`);
  }
});

test('explosive reach: an enemy-targeting weapon that takes barrels / tankers lets the cursor pick them', () => {
  for (const id of ['sniper', 'harpoon', 'rifle']) {
    assert.equal(ABILITIES[id].hitsBarrels, true, `${id}.hitsBarrels`);
    assert.equal(ABILITIES[id].hitsTankers, true, `${id}.hitsTankers`);
  }
});
