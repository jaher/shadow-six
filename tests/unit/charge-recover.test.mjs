/**
 * SHADOW SIX house rule `recoverCharges` (user request: "there should be a way for sapper to collect back the explosives
 * if not placed in the right place"): the Sapper takes a placed time / remote bomb back into his knapsack — H on it, or
 * a click / tap on it with him selected (abilities/sapper.js takeCharge). A ticking clock stops at the grab; only the
 * Sapper handles explosives; nothing to take mid-plant or once it has gone off; demolition objectives and the
 * missions' charge counters stay right; save / load keeps it all; CLASSIC 1998 keeps the original rule (it stays put).
 */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { ABILITIES, abilitiesForRole } from '../../src/abilities/index.js';
import { resolveHouseRules, forcedRuleLines } from '../../src/core/house-rules.js';
import { Entity } from '../../src/entities/entity.js';
import { restoreWorld } from '../../src/save.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { chargesLeft } from '../../src/missions/scripts/m07.js';
import { meansLeft } from '../../src/missions/scripts/m14.js';
import { HOUSE_KEYS, OPTION_ROWS, OPTION_HELP } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS } from '../../src/ui/ui-config.js';

const TK = CONFIG.abilities.chargeTake;
const SAP = (inv) => ({ role: 'sapper', x: 10, z: 10, heading: 0, inventory: inv });
const bombs = (s) => s.world.interactables.filter((b) => b.interactKind === 'bomb' && !b.removed);
const msgs = (s) => { const out = []; s.world.events.on('message', (m) => out.push(m.text)); return out; };
const on = (s, name) => { const out = []; s.world.events.on(name, (p) => out.push({ p, t: s.world.time })); return out; };

/** Plant one charge at his feet (B, 1.0 s) and walk him `away` m east. @returns {object} the bomb */
function plant(s, sp, id = 'timeBomb', away = 3) {
  assert.ok(sp.issue({ type: 'ability', id, target: sp }), sp.lastRefusal?.text);
  s.run(1.05);
  const b = bombs(s).at(-1);
  assert.ok(b, 'a charge was set');
  if (away) { sp.issue({ type: 'move', x: sp.x + away, z: sp.z }); s.run(away / CONFIG.units.walk + 0.6); }
  return b;
}

test('recoverCharges: a SHADOW SIX house rule (on), off in CLASSIC 1998; the Sapper alone gets takeCharge, never in the pinned BEL list', () => {
  assert.equal(CONFIG.houseRules.presets.shadowSix.recoverCharges, true);
  assert.equal(CONFIG.houseRules.presets.classic1998.recoverCharges, false);
  assert.equal(resolveHouseRules({ preset: 'classic1998' }).recoverCharges, false);
  assert.ok(HOUSE_KEYS.includes('recoverCharges') && OPTION_ROWS.some((r) => r[0] === 'recoverCharges') && /1998/.test(OPTION_HELP.recoverCharges));
  assert.equal(OPTION_DEFAULTS.recoverCharges, true);
  assert.deepEqual(forcedRuleLines({ houseRules: { recoverCharges: false } }), ['A charge once set stays where it is.']);
  assert.ok(!Object.keys(ABILITIES).includes('takeCharge'), 'not enumerable (bel-lock)');
  const six = resolveHouseRules({ preset: 'shadowSix' }), classic = resolveHouseRules({ preset: 'classic1998' });
  assert.ok(abilitiesForRole('sapper', 'BEL', six).includes('takeCharge'));
  assert.ok(!abilitiesForRole('sapper', 'BEL', classic).includes('takeCharge'));
  for (const r of ['greenberet', 'sniper', 'diver', 'driver', 'spy']) assert.ok(!abilitiesForRole(r, 'BEL', six).includes('takeCharge'), r);
  assert.equal(ABILITIES.takeCharge.visibleToEnemies, true, 'as visible as setting one');
});

test('time bomb taken back: the clock stops at the grab (0.5 s of 1.0 s), back in the knapsack, it never goes off', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 2 })] }, { brains: false });
  const sp = s.cmd('sapper'), text = msgs(s), dis = on(s, 'bomb:disarmed');
  const b = plant(s, sp);
  assert.equal(sp.inventory.get('timeBomb'), 1);
  const fuseAtOrder = b.fuse;
  assert.ok(fuseAtOrder < 10 && fuseAtOrder > 5, `ticking (${fuseAtOrder.toFixed(2)} s left)`);
  assert.ok(sp.issue({ type: 'ability', id: 'takeCharge', target: b }), sp.lastRefusal?.text);
  // walks back to it, kneels within reach
  let started = null;
  for (let i = 0; i < 60 * 5 && !dis.length; i++) { s.step(); if (started == null && sp.currentActionId === 'takeCharge') started = s.world.time; }
  assert.ok(started != null, 'the take started');
  assert.equal(dis.length, 1, 'bomb:disarmed');
  near(dis[0].t - started, TK.grab, 1 / 60 + 1e-6, 'the grab');
  assert.ok(Math.hypot(sp.x - b.x, sp.z - b.z) <= TK.reach + 0.05, 'next to it');
  assert.equal(dis[0].p.kind, 'time');
  assert.ok(dis[0].p.fuse > 0 && dis[0].p.fuse < fuseAtOrder, 'the time that was left');
  assert.equal(sp.inventory.get('timeBomb'), 2, 'back in the knapsack');
  assert.ok(sp.abilities.includes('timeBomb'));
  s.step();
  assert.equal(bombs(s).length, 0, 'gone from the ground');
  assert.equal(sp.currentActionId, 'takeCharge', 'still getting up');
  s.run(TK.dur);
  assert.equal(sp.currentAction, null, 'done');
  assert.ok(text.some((t) => /time bomb back in the knapsack — the clock is stopped/.test(t)), text.join(' | '));
  s.run(12);
  assert.equal(s.count('bomb:exploded'), 0, 'disarmed: never goes off');
  assert.equal(s.count('explosion'), 0);
});

test('a charge taken back is set again (B) where it should be: it goes off 10 s after the new release', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  const b = plant(s, sp, 'timeBomb', 2);
  assert.ok(!sp.has('timeBomb'), 'none left');
  sp.issue({ type: 'ability', id: 'takeCharge', target: b });
  s.run(4, () => sp.has('timeBomb') && !sp.currentAction);
  assert.ok(sp.has('timeBomb'));
  sp.setPosition(30, 30);
  const t0 = s.world.time;
  assert.ok(sp.issue({ type: 'ability', id: 'timeBomb', target: sp }));
  s.run(1.05);
  const b2 = bombs(s)[0];
  assert.ok(b2 && b2 !== b && Math.hypot(b2.x - 30, b2.z - 30) < 0.6, 'the new spot');
  sp.issue({ type: 'move', x: 50, z: 50, run: true });
  s.run(12, () => s.count('bomb:exploded') > 0);
  const ex = s.last('bomb:exploded');
  near(ex.p.x, b2.x, 1e-6); near(ex.t - (t0 + CONFIG.weapons.timeBomb.plant), CONFIG.weapons.timeBomb.fuse, 2 / 60, 'fuse');
});

test('remote charge taken back: the detonator skips it (next oldest goes), the item returns, the detonator stays', () => {
  const s = makeSim({ commandos: [SAP({ remoteBomb: 2 })] }, { brains: false });
  const sp = s.cmd('sapper');
  const b1 = plant(s, sp, 'remoteBomb', 2);
  const b2 = plant(s, sp, 'remoteBomb', 2);
  assert.ok(!sp.has('remoteBomb') && sp.has('detonator'));
  assert.ok(sp.issue({ type: 'ability', id: 'takeCharge', target: b1 }));
  s.run(6, () => sp.has('remoteBomb') && !sp.currentAction);
  assert.equal(sp.inventory.get('remoteBomb'), 1);
  assert.ok(sp.has('detonator'));
  assert.ok(b1.taken && !b1.placed);
  sp.setPosition(40, 40);
  assert.ok(sp.issue({ type: 'ability', id: 'detonate', target: sp }));
  s.run(0.3);
  assert.equal(s.count('bomb:exploded'), 1);
  near(s.last('bomb:exploded').p.x, b2.x, 1e-6, 'the other one went');
  s.run(0.1);
  assert.equal(sp.issue({ type: 'ability', id: 'detonate', target: sp }), false, 'none left planted');
  assert.equal(sp.lastRefusal.text, 'No bombs planted.');
});

test('a remote charge already fired (0.2 s radio delay) cannot be taken; one that has gone off is nothing to collect', () => {
  const s = makeSim({ commandos: [SAP({ remoteBomb: 1 }), { role: 'greenberet', x: 40, z: 40 }] }, { brains: false });
  const sp = s.cmd('sapper');
  const b = plant(s, sp, 'remoteBomb', 0);
  sp.issue({ type: 'ability', id: 'detonate', target: sp });
  assert.equal(sp.issue({ type: 'ability', id: 'takeCharge', target: b }), false);
  assert.equal(sp.lastRefusal.text, "Too late — it's going off!");
  s.run(0.3);
  assert.ok(b.exploded);
  assert.equal(sp.alive, false, '(he stood on it)');
  const gb = s.cmd('greenberet');
  assert.equal(ABILITIES.takeCharge.canUse(sp, b, s.world), 'Dead.');
  assert.equal(b.canUse(gb), 'Nothing there.', 'exploded: nothing to collect');
});

test('a time bomb that goes off while he walks to it: the order ends, nothing is collected', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper'), text = msgs(s);
  const b = plant(s, sp, 'timeBomb', 0);
  sp.setPosition(sp.x + 24, sp.z); // far off: 24 m at walking pace is more than the fuse left
  b.fuse = 1.0;
  assert.ok(sp.issue({ type: 'ability', id: 'takeCharge', target: b }));
  s.run(3);
  assert.ok(b.exploded && sp.alive);
  assert.ok(!sp.has('timeBomb'), 'not collected');
  assert.equal(sp.currentAction, null);
  assert.equal(sp.pendingAbility, null, 'the walk-up was dropped');
  assert.ok(text.some((t) => /Nothing there/.test(t)), text.join(' | '));
});

test('an interrupted take (before the grab) leaves it ticking where it was', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  const b = plant(s, sp, 'timeBomb', 1.5);
  sp.issue({ type: 'ability', id: 'takeCharge', target: b });
  s.run(3, () => sp.currentActionId === 'takeCharge');
  s.run(0.3); // kneeling, not yet at the grab
  const fuse = b.fuse;
  assert.ok(sp.issue({ type: 'move', x: 30, z: 10, run: true }), 'a new order cancels it');
  s.run(0.5);
  assert.ok(b.placed && !b.taken, 'still on the ground');
  assert.ok(b.fuse < fuse - 0.4, 'still ticking');
  assert.ok(!sp.has('timeBomb'));
  s.run(10);
  assert.ok(b.exploded);
});

test('mid-plant there is nothing to take; the charge can be taken once it is set', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  assert.ok(sp.issue({ type: 'ability', id: 'timeBomb', target: sp }));
  s.run(0.5);
  assert.equal(bombs(s).length, 0, 'the charge is still in his hands');
  assert.equal(sp.issue({ type: 'ability', id: 'hand', target: { x: sp.x + 0.4, z: sp.z } }), false, 'H finds nothing');
  assert.equal(sp.lastRefusal.text, 'Nothing to pick up.');
  s.run(0.55);
  const b = bombs(s)[0];
  assert.ok(b?.placed);
  assert.equal(b.canUse(sp), true, 'set: now it can be taken');
});

test('only the Sapper handles explosives: the Green Beret\'s hand is refused; H on a charge is the Sapper\'s takeCharge', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 }), { role: 'greenberet', x: 14, z: 12 }] }, { brains: false });
  const sp = s.cmd('sapper'), gb = s.cmd('greenberet');
  const b = plant(s, sp, 'timeBomb', 4);
  assert.ok(!gb.abilities.includes('takeCharge'));
  assert.equal(gb.issue({ type: 'ability', id: 'hand', target: b }), false);
  assert.equal(gb.lastRefusal.text, 'Only the Sapper can handle explosives.');
  assert.equal(gb.issue({ type: 'ability', id: 'takeCharge', target: b }), false, 'not his action');
  // H on the clicked point next to it (the hand cursor): forwarded to takeCharge with the charge as its target
  assert.ok(sp.issue({ type: 'ability', id: 'hand', target: { x: b.x + 0.3, z: b.z + 0.2 } }), sp.lastRefusal?.text);
  assert.equal(sp.pendingAbility?.def.id, 'takeCharge');
  assert.equal(sp.pendingAbility?.target, b);
  s.run(4, () => sp.has('timeBomb') && !sp.currentAction);
  assert.ok(sp.has('timeBomb') && !b.placed);
});

test('CLASSIC 1998 (recoverCharges off): a charge once set stays put — H says "Leave it."', () => {
  const s = makeSim({ houseRules: { recoverCharges: false }, commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  assert.equal(s.world.house.recoverCharges, false);
  assert.ok(!sp.abilities.includes('takeCharge'));
  const b = plant(s, sp, 'timeBomb', 2);
  assert.equal(sp.issue({ type: 'ability', id: 'hand', target: b }), false);
  assert.equal(sp.lastRefusal.text, 'Leave it.');
  assert.equal(sp.issue({ type: 'ability', id: 'takeCharge', target: b }), false);
  s.run(10);
  assert.ok(b.exploded);
});

test('the bear trap (the Sapper\'s other placed device) is still picked up by H, not routed to takeCharge', () => {
  const s = makeSim({ commandos: [SAP({ bearTrap: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  assert.ok(sp.issue({ type: 'ability', id: 'trap', target: { x: 11, z: 10 } }));
  s.run(1.1);
  const trap = s.world.interactables.find((i) => i.interactKind === 'trap');
  assert.ok(trap && !sp.has('bearTrap'));
  assert.ok(sp.issue({ type: 'ability', id: 'hand', target: trap }));
  assert.equal(sp.pendingAbility?.def.id ?? sp.currentActionId, 'hand');
  s.run(1.5);
  assert.ok(sp.has('bearTrap') && trap.removed);
});

test('no knapsack limit: a charge taken back always fits (the count just goes up), even with the same kind on him', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 4, grenade: 4 })] }, { brains: false });
  const sp = s.cmd('sapper');
  const b = plant(s, sp, 'timeBomb', 2);
  assert.equal(sp.inventory.get('timeBomb'), 3);
  sp.issue({ type: 'ability', id: 'takeCharge', target: b });
  s.run(4, () => !sp.currentAction && sp.inventory.get('timeBomb') === 4);
  assert.equal(sp.inventory.get('timeBomb'), 4);
  assert.equal(sp.inventory.get('grenade'), 4);
});

test('he must have his hands free, be on foot and on its level; he walks round to it and kneels beside it', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })] }, { brains: false });
  const sp = s.cmd('sapper');
  const b = plant(s, sp, 'timeBomb', 6);
  sp.carrying = { kind: 'interactable', interactKind: 'barrel' };
  assert.equal(ABILITIES.takeCharge.canUse(sp, b, s.world), 'Drop it first.');
  sp.carrying = null;
  b.y = 3; sp.setPosition(b.x + 0.5, b.z); sp.y = 0;
  assert.equal(ABILITIES.takeCharge.canUse(sp, b, s.world), "Can't reach it from here.");
  b.y = 0; sp.setPosition(b.x + 6, b.z + 3);
  assert.ok(sp.issue({ type: 'ability', id: 'takeCharge', target: b }));
  s.run(5, () => sp.currentActionId === 'takeCharge');
  s.run(0.35);
  const d = Math.hypot(sp.x - b.x, sp.z - b.z);
  assert.ok(Math.abs(d - 0.45) < 0.08, `kneeling 0.45 m from it (${d.toFixed(2)})`);
  const face = Math.atan2(b.z - sp.z, b.x - sp.x);
  assert.ok(Math.abs(Math.atan2(Math.sin(sp.heading - face), Math.cos(sp.heading - face))) < 0.05, 'facing it');
});

test('a held Sapper (§4.5) taking a charge back is attacking: the guard holding him opens fire', () => {
  const s = makeSim({ commandos: [SAP({ timeBomb: 1 })], enemies: [guard('e', 20, 10, Math.PI)] });
  const sp = s.cmd('sapper'), e = s.get('e');
  const b = plant(s, sp, 'timeBomb', 0);
  let attacked = 0;
  e.brain.onTargetAttacked = () => { attacked++; };
  e.target = sp; sp.held = true;
  s.world.events.emit('ability:start', { unit: sp, id: 'takeCharge', target: b });
  assert.equal(attacked, 1);
});

test('save / load: a placed charge, a take before the grab and a charge already taken all come back right', () => {
  const def = { commandos: [SAP({ timeBomb: 2 })] };
  const id0 = Entity.nextId;
  const a = makeSim(def, { brains: false });
  const sp = a.cmd('sapper');
  const b = plant(a, sp, 'timeBomb', 2);
  // 1) the placed charge survives a load, ticking, still his to take
  let snap = JSON.parse(JSON.stringify({ ...a.world.serialize(), nextId: Entity.nextId }));
  Entity.nextId = id0;
  const s = makeSim(def, { brains: false });
  restoreWorld(s.world, snap);
  const sp2 = s.cmd('sapper'), b2 = bombs(s)[0];
  assert.ok(b2 && b2.planter === sp2, 'restored with its planter');
  near(b2.fuse, b.fuse, 1e-9, 'fuse');
  assert.equal(b2.canUse(sp2), true);
  // 2) save in the middle of the take, before the grab: the load resumes the take and the grab happens
  sp2.issue({ type: 'ability', id: 'takeCharge', target: b2 });
  s.run(4, () => sp2.currentActionId === 'takeCharge');
  s.run(0.2);
  assert.ok(b2.placed);
  snap = JSON.parse(JSON.stringify({ ...s.world.serialize(), nextId: Entity.nextId }));
  assert.equal(snap.entities.find((d) => d.id === sp2.id).action?.id, 'takeCharge');
  Entity.nextId = id0;
  const s3 = makeSim(def, { brains: false });
  restoreWorld(s3.world, snap);
  const sp3 = s3.cmd('sapper'), b3 = bombs(s3)[0];
  assert.equal(sp3.currentActionId, 'takeCharge', 'resumed');
  s3.run(0.4);
  assert.ok(!b3.placed && sp3.inventory.get('timeBomb') === 2, 'taken after the load');
  // 3) saved after the take: the charge is gone, the item is in the knapsack, and it can be set again
  s3.run(1);
  snap = JSON.parse(JSON.stringify({ ...s3.world.serialize(), nextId: Entity.nextId }));
  Entity.nextId = id0;
  const s4 = makeSim(def, { brains: false });
  restoreWorld(s4.world, snap);
  const sp4 = s4.cmd('sapper');
  assert.equal(bombs(s4).length, 0);
  assert.equal(sp4.inventory.get('timeBomb'), 2);
  assert.ok(sp4.abilities.includes('takeCharge'));
  assert.ok(sp4.issue({ type: 'ability', id: 'timeBomb', target: sp4 }));
  s4.run(1.05);
  assert.equal(bombs(s4).length, 1, 'set again after the load');
  s4.run(11);
  assert.equal(s4.count('bomb:exploded'), 1);
});

test('mission charge counters (M7 chargesLeft, M14 meansLeft) never drop while a charge is taken back', () => {
  for (const [m, count, item] of [['m07', chargesLeft, 'timeBomb'], ['m14', meansLeft, 'remoteBomb']]) {
    const sim = headlessMission(m);
    const w = sim.world, sap = w.commandos.find((c) => c.role === 'sapper');
    for (const e of w.enemies) { e.alive = false; e.removed = true; }
    for (let i = 0; i < 30; i++) sim.step(); // (M14: the start script seats the team in the rowboat)
    if (sap.vehicle) { sap.vehicle.exit(sap, undefined, undefined, { force: true }); sap.setPosition(40, 157); }
    sap.gainItem(item, 1);
    const n0 = count(w);
    assert.ok(sap.issue({ type: 'ability', id: item, target: sap }), `${m}: ${sap.lastRefusal?.text}`);
    let min = Infinity;
    for (let i = 0; i < 70; i++) { sim.step(); min = Math.min(min, count(w)); }
    const b = w.interactables.find((q) => q.interactKind === 'bomb' && q.placed);
    assert.ok(b, `${m}: set`);
    assert.ok(sap.issue({ type: 'ability', id: 'takeCharge', target: b }), `${m}: ${sap.lastRefusal?.text}`);
    for (let i = 0; i < 120; i++) { sim.step(); min = Math.min(min, count(w)); }
    assert.ok(b.taken, `${m}: taken`);
    assert.equal(min, n0, `${m}: the count never dropped`);
    assert.equal(count(w), n0);
  }
});

// ---------------------------------------------------------------- M3: the two objective charges

function m03() {
  const sim = headlessMission('m03');
  const w = sim.world, sap = w.commandos.find((c) => c.role === 'sapper');
  for (const e of w.enemies) { e.alive = false; e.removed = true; }
  sap.gainItem('timeBomb', 2);
  return { sim, w, sap, obj: (id) => w.objectives.find((o) => o.id === id) };
}

test('m03 o2: a charge off the dam\'s mark says so at once; taken back and set on the mark, the dam falls (o2 done)', () => {
  const { sim, w, sap, obj } = m03();
  const dam = w.interactables.find((i) => (i.tag ?? i.id) === 'dam');
  const mk = w.markers.get('dam_charge');
  const text = msgs({ world: w });
  // on the crest, 6 m along from the spillway gates: off the mark
  const crest = w.grid.elevAt(mk.x, mk.z);
  let spot = null;
  for (const dx of [6, -6, 5, -5, 7, -7]) for (const dz of [0, 0.5, -0.5, 1, -1]) {
    if (spot) break;
    const x = mk.x + dx, z = mk.z + dz;
    if (w.grid.walkableAt(x, z) && Math.abs(w.grid.elevAt(x, z) - crest) < 0.3 && Math.hypot(x - mk.x, z - mk.z) > mk.r + 1) spot = { x, z };
  }
  assert.ok(spot, 'a crest spot off the mark');
  sap.setPosition(spot.x, spot.z); sap.y = w.groundAt?.(spot.x, spot.z)?.y ?? sap.y;
  sim.step();
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }), sap.lastRefusal?.text);
  for (let i = 0; i < 70; i++) sim.step();
  const b = w.interactables.find((q) => q.interactKind === 'bomb' && q.placed);
  assert.ok(b, 'set on the crest');
  assert.ok(text.some((t) => /off the mark — that charge won't bring it down\. Take it back \(H\)/.test(t)), text.join(' | '));
  assert.equal(obj('o2').done, false);
  assert.ok(sap.issue({ type: 'ability', id: 'takeCharge', target: b }), sap.lastRefusal?.text);
  for (let i = 0; i < 60 * 3 && !b.taken; i++) sim.step();
  assert.ok(b.taken, 'taken back on the crest');
  for (let i = 0; i < 60; i++) sim.step();
  assert.equal(sap.inventory.get('timeBomb'), 2);
  assert.equal(dam.destroyed, false);
  assert.equal(obj('o2').done, false, 'o2 still to do');
  // on the mark this time
  sap.issue({ type: 'move', x: mk.x, z: mk.z });
  for (let i = 0; i < 60 * 8 && (sap.path || Math.hypot(sap.x - mk.x, sap.z - mk.z) > 1); i++) sim.step();
  assert.ok(Math.hypot(sap.x - mk.x, sap.z - mk.z) < mk.r - 0.5, 'at the spillway gates');
  const n = text.length;
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  for (let i = 0; i < 70; i++) sim.step();
  assert.ok(!text.slice(n).some((t) => /off the mark/.test(t)), 'on the mark: no hint');
  sap.setPosition(60, 30); sap.y = 0; // (out of the blast)
  for (let i = 0; i < 60 * 11 && !dam.destroyed; i++) sim.step();
  assert.ok(dam.destroyed, 'the dam went');
  for (let i = 0; i < 3; i++) sim.step();
  assert.equal(obj('o2').done, true, 'o2 done');
});

test('m03 o1: the charge set inside the bunker is taken back by going in again; the bunker stands until it is set again', () => {
  const { sim, w, sap, obj } = m03();
  const it = w.interactables.find((i) => (i.tag ?? i.id) === 'dam_bunker'), entry = it.params.structure.entry;
  sap.setPosition(entry.path[0][0] + 0.3, entry.path[0][1] + 0.2); sap.y = 0;
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  let b = null;
  for (let i = 0; i < 60 * 12 && (sap.currentAction || !b); i++) { sim.step(); b ||= w.interactables.find((q) => q.interactKind === 'bomb' && q.placed); }
  assert.ok(b && b.insideOf === (it.tag ?? it.id), 'set inside the bunker');
  assert.equal(sap.currentAction, null, 'out again');
  // mid-plant (he is still inside, walking out) the order was not possible; now it is: he goes in again for it
  assert.ok(sap.issue({ type: 'ability', id: 'takeCharge', target: b }), sap.lastRefusal?.text);
  let inside = false, save = null;
  for (let i = 0; i < 60 * 10 && !b.taken; i++) {
    sim.step();
    if (sap.insideStructure) inside = true;
    if (sap.insideStructure && !save && sap.currentActionId === 'takeCharge') save = sap.serialize();
  }
  assert.ok(inside, 'he went in for it');
  assert.ok(b.taken, 'taken before it went off');
  assert.equal(sap.inventory.get('timeBomb'), 2);
  for (let i = 0; i < 60 * 6 && sap.currentAction; i++) sim.step();
  assert.equal(sap.currentAction, null);
  assert.equal(sap.insideStructure ?? null, null, 'he came back out');
  assert.equal(sap.scripted ?? null, null);
  for (let i = 0; i < 60 * 11; i++) sim.step();
  assert.equal(it.destroyed, false, 'no charge, no blast');
  assert.equal(obj('o1').done, false, 'o1 still to do');
  // the save made while he was inside going for it carries the walk (resumed below on a fresh run)
  assert.equal(save?.action?.id, 'takeCharge');
  assert.ok(save.action.data?.bunker != null && save.action.data?.charge != null);
  // set again: the bunker goes up
  sap.setPosition(entry.path[0][0] + 0.3, entry.path[0][1] + 0.2); sap.y = 0;
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  for (let i = 0; i < 60 * 30 && !it.destroyed; i++) {
    sim.step();
    if (!sap.currentAction && !sap.pendingAbility && w.interactables.some((q) => q.interactKind === 'bomb' && q.placed)) sap.setPosition(30, 36);
  }
  assert.ok(it.destroyed, 'the bunker went up');
  sim.step();
  assert.equal(obj('o1').done, true);
});

test('m03 o1: a save made while he is inside the bunker going for the charge resumes the walk in, the take and the walk out', () => {
  const { sim, w, sap } = m03();
  const it = w.interactables.find((i) => (i.tag ?? i.id) === 'dam_bunker'), entry = it.params.structure.entry;
  sap.setPosition(entry.path[0][0] + 0.3, entry.path[0][1] + 0.2); sap.y = 0;
  sap.issue({ type: 'ability', id: 'timeBomb', target: sap });
  let b = null;
  for (let i = 0; i < 60 * 12 && (sap.currentAction || !b); i++) { sim.step(); b ||= w.interactables.find((q) => q.interactKind === 'bomb' && q.placed); }
  sap.issue({ type: 'ability', id: 'takeCharge', target: b });
  for (let i = 0; i < 600 && !sap.insideStructure; i++) sim.step();
  assert.ok(sap.insideStructure && b.placed, 'inside, not taken yet');
  const d = sap.serialize();
  sap.deserialize(d);
  assert.ok(sap.resumeSavedAction(), 'the take resumes');
  for (let i = 0; i < 60 * 8 && sap.currentAction; i++) sim.step();
  assert.ok(b.taken, 'taken after the load');
  assert.equal(sap.currentAction, null);
  assert.equal(sap.insideStructure ?? null, null, 'and out');
  assert.ok(sap.alive && !it.destroyed);
});
