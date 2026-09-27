/** Stage-0 cross-team interfaces: CONFIG mapping, events, time base, perception, alarm, flow, abilities. */
import { test, assert, near } from './lib.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, KILL, MAP_WIDE, visionProfileFor, velToSpeed } from '../../src/config.js';
import { EVENT_NAMES } from '../../src/core/events.js';
import { AUDIO_EVENT_NAMES } from '../../src/audio/sfx-events.js';
import { World } from '../../src/world/world.js';
import { coneAt, pointInCone, canSee, ellipseFar, sweepOffset, probe } from '../../src/ai/perception.js';
import { makeVision } from '../../src/entities/enemy.js';
import { UNIT_STATES } from '../../src/entities/unit.js';
import { Alarm } from '../../src/ai/alarm.js';
import { timeStars, damageStars, merit, rankName, damageLoss } from '../../src/core/flow.js';
import { registerAbility, groupIntersection, ABILITIES } from '../../src/abilities/index.js';
import { BRAIN_STATES } from '../../src/ai/enemy-brain.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DEG = Math.PI / 180;

test('CONFIG implements the design-spec §10.3 mapping', () => {
  for (const g of ['sim', 'camera', 'units', 'stealth', 'ai', 'alarm', 'weapons', 'abilities', 'vehicles', 'rulesets']) assert.ok(CONFIG[g], g);
  const S = CONFIG.sim;
  assert.equal(S.belTick, 0.05); assert.equal(S.belUnit, 0.045); assert.equal(S.belTickHz, 20);
  assert.deepEqual(CONFIG.camera.zoomLevels, [0.5, 1, 2]);
  assert.equal(CONFIG.units.walk, 2.25); assert.equal(CONFIG.units.run.greenberet, 5.4); assert.equal(CONFIG.units.hp.spy, 160);
  assert.deepEqual(CONFIG.stealth.vision.soldier, { fov: 70, near: 18, far: 36, sweep: 50, period: 5.0, elliptical: true });
  assert.equal(CONFIG.stealth.vision.tank.sweep, 155);
  assert.equal(CONFIG.stealth.noise.pistol.radius, 18); assert.equal(CONFIG.stealth.noise.explosion.radius, MAP_WIDE);
  assert.deepEqual(CONFIG.ai.nervousness, { T: 50, decayPerTick: 1, closeRange: 2.25, heldValue: 1000, bodyBonusDiv: 25, dispMul: 2 });
  assert.equal(CONFIG.alarm.sirenDur, 25); near(CONFIG.alarm.sirenGain / CONFIG.alarm.sirenFadePerSec, 25, 1e-9);
  assert.equal(CONFIG.weapons.pistol.dmg, 80); assert.equal(CONFIG.weapons.pistol.damage, 80, 'legacy alias');
  assert.equal(CONFIG.weapons.sniperRifle, CONFIG.weapons.sniper); assert.equal(CONFIG.weapons.sniper.dmg, KILL);
  assert.equal(CONFIG.weapons.explosions.bomb.lethal, 6.75); assert.equal(CONFIG.weapons.explosions.vehicle.dmg, 180);
  assert.equal(CONFIG.abilities.firstAid.heal, 34); assert.equal(CONFIG.abilities.timeBomb.fuse, 10);
  assert.deepEqual(CONFIG.vehicles.runoverBox, [1.8, 5.4, 1.35]); assert.equal(CONFIG.vehicles.hits.panzer2, 1000);
  for (const [k, v] of Object.entries(CONFIG.rulesets.BEL)) if (typeof v === 'boolean') assert.equal(v, false, `BEL ${k}`);
  assert.equal(Math.ceil(CONFIG.ai.enemyHP / CONFIG.weapons.pistol.dmg), 3, 'three pistol hits (§10.5 #10)');
  near(velToSpeed(3), 2.7, 1e-9);
  assert.equal(visionProfileFor('truckDriver'), null);
  assert.equal(visionProfileFor('crew'), CONFIG.stealth.vision.tank);
});

/** All string literals passed to emit('…') under src/. */
function emittedNames() {
  const out = new Set();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/\bemit\(\s*'([a-z0-9:-]+)'/g)) out.add(m[1]);
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

test('every emitted event is canonical; audio only listens to canonical events', () => {
  const known = new Set(EVENT_NAMES);
  for (const n of emittedNames()) assert.ok(known.has(n), `event "${n}" missing from EVENT_NAMES / ARCHITECTURE table`);
  for (const n of AUDIO_EVENT_NAMES) assert.ok(known.has(n), `audio event "${n}" not canonical`);
  const doc = readFileSync(join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
  for (const n of EVENT_NAMES) assert.ok(doc.includes('`' + n + '`'), `ARCHITECTURE.md documents \`${n}\``);
});

test('world.onBelTick runs every 3rd step with dt20 = 0.05 and unsubscribes', () => {
  const w = new World({ size: [10, 10] });
  const seen = [];
  const off = w.onBelTick((dt20, n) => seen.push([dt20, n]));
  for (let i = 0; i < 60; i++) w.runBelTicks(CONFIG.sim.dt);
  assert.equal(seen.length, 20);
  near(seen[0][0], 0.05, 1e-12);
  assert.deepEqual(seen.map((s) => s[1]).slice(0, 3), [1, 2, 3]);
  const at = []; w.onBelTick(() => at.push(1));
  w.runBelTicks(CONFIG.sim.dt); w.runBelTicks(CONFIG.sim.dt);
  assert.equal(at.length, 0, 'fires on the 3rd step');
  w.runBelTicks(CONFIG.sim.dt);
  assert.equal(at.length, 1);
  off();
  for (let i = 0; i < 3; i++) w.runBelTicks(CONFIG.sim.dt);
  assert.equal(seen.length, 21, 'unsubscribed (20 + the one tick above)');
});

test('Unit states and brain states follow the spec enums', () => {
  for (const s of ['held', 'captured', 'jailed', 'stunned', 'bound', 'active', 'dead']) assert.ok(UNIT_STATES.includes(s), s);
  for (const s of ['IDLE', 'CHALLENGE', 'HOLD', 'ARREST', 'COMBAT', 'DISTRACTED', 'REINFORCE', 'DEAD']) assert.ok(BRAIN_STATES.includes(s), s);
});

test('makeVision: spec profile → runtime radians, overrides, no-cone types', () => {
  const v = makeVision('sentry', {});
  near(v.fov, 70 * DEG); assert.equal(v.fovDeg, 70);
  assert.equal(v.near, 18); assert.equal(v.far, 36); assert.equal(v.range, 36); assert.equal(v.nearRange, 18);
  near(v.sweep, 50 * DEG); assert.equal(v.period, 5); assert.equal(v.elliptical, true); assert.equal(v.eyeHeight, 1.65);
  const m = makeVision('mg', { post: { sweep: 35, period: 4 }, elevated: true });
  assert.equal(m.far, 28.8); near(m.sweep, 35 * DEG); assert.equal(m.period, 4); assert.equal(m.elevated, true); assert.equal(m.elliptical, false);
  assert.equal(makeVision('truckDriver', {}), null);
});

test('perception: cone geometry (ellipse, sweep) is shared by detection', () => {
  near(ellipseFar(36, 0), 36, 1e-9);
  near(ellipseFar(36, 50 * DEG) / 36, 0.42, 0.01, '42% at ±50°');
  const e = { x: 10, z: 10, heading: 0, vision: makeVision('soldier', {}), world: { time: 0 } };
  let c = coneAt(e, 0);
  assert.equal(c.theta, 0); assert.equal(c.far, 36); assert.equal(c.near, 18);
  assert.equal(pointInCone(c, 20, 10), 'near'); assert.equal(pointInCone(c, 40, 10), 'far');
  assert.equal(pointInCone(c, 10, 30), null, 'outside the aperture');
  e.sweepActive = true; e.vision.period = 4; e.vision.phase = 0;
  near(sweepOffset(e, 1), 50 * DEG, 1e-9);
  c = coneAt(e, 1);
  near(c.heading, 50 * DEG, 1e-9); assert.ok(c.far < 16, 'shrunk at full sweep');
  assert.equal(pointInCone(c, 40, 10), null);
});

test('perception.canSee: band rule, disguise, roof rule, occluders', () => {
  const w = new World({ size: [60, 30] });
  const viewer = { x: 5, z: 15, heading: 0, vision: makeVision('soldier', {}) };
  const unit = (x, extra = {}) => ({ x, z: 15, isLow: false, isVisibleToEnemies: true, ...extra });
  assert.equal(canSee(viewer, unit(15), w), 'near');
  assert.equal(canSee(viewer, unit(30), w), 'far');
  assert.equal(canSee(viewer, unit(30, { isLow: true }), w), 'none', 'crawler invisible in the far band');
  assert.equal(canSee(viewer, unit(15, { isLow: true }), w), 'near');
  assert.equal(canSee(viewer, { x: 30, z: 15, kind: 'body' }, w), 'far', 'bodies: full cone');
  assert.equal(canSee(viewer, { x: 30, z: 15, kind: 'footprint' }, w), 'none', 'footprints: near only');
  assert.equal(canSee(viewer, unit(15, { disguised: true }), w), 'none');
  assert.equal(canSee(viewer, unit(15, { disguised: true }), w, { ignoreDisguise: true }), 'near');
  assert.equal(canSee(viewer, unit(15, { isVisibleToEnemies: false }), w), 'none', 'buried/underwater/hidden');
  assert.equal(canSee(viewer, unit(15, { y: 4 }), w), 'none', 'roof rule');
  w.grid.stampDynamic(10, 15, 2, 3, 0);
  assert.equal(canSee(viewer, unit(15), w), 'none', 'vehicle occludes');
  w.grid.clearDynamic();
  w.enemies.push({ ...viewer, alive: true, id: 7 });
  assert.equal(probe(w, 20, 15)?.id, 7);
  assert.equal(probe(w, 5, 29), null);
});

test('alarm: zone sensors, RINT siren fade, zonesFired, legacy raise()', () => {
  const w = new World({ size: [50, 50], mission: { zones: [{ id: 'camp', poly: [[0, 0], [20, 0], [20, 20], [0, 20]], onSeen: 'RINT', onHeard: 'REXT' }] } });
  const ev = [];
  for (const t of ['alarm:zone', 'alarm:start', 'alarm:end']) w.listen(t, (p) => ev.push([t, p.event ?? null]));
  const a = new Alarm(w);
  assert.equal(a.zoneAt(5, 5).id, 'camp'); assert.equal(a.zoneAt(30, 30), null);
  assert.equal(a.raise('camp', 'heard', 5, 5), 'REXT');
  assert.equal(a.active, false, 'REXT is silent');
  assert.equal(a.raise('camp', 'seen', 5, 5), 'RINT');
  assert.equal(a.active, true); near(a.siren.gain, 0.75);
  for (let i = 0; i < 60 * 10; i++) a.update(1 / 60);
  near(a.siren.gain, 0.45, 1e-6);
  for (let i = 0; i < 60 * 16; i++) a.update(1 / 60);
  assert.equal(a.active, false);
  assert.deepEqual(a.zonesFired.map((f) => f.event), ['REXT', 'RINT']);
  assert.equal(w.stats.alarms, 1);
  a.raise(1, 2, 'body');
  assert.equal(a.zonesFired.at(-1).event, 'RINT', 'legacy (x, z, cause) → global');
  assert.deepEqual(ev.map((e) => e[0]), ['alarm:zone', 'alarm:zone', 'alarm:start', 'alarm:end', 'alarm:zone', 'alarm:start']);
  const s = a.serialize(); const b = new Alarm(w); b.deserialize(s);
  assert.equal(b.active, true); assert.equal(b.zonesFired.length, 3);
});

test('flow scoring (§8.2)', () => {
  assert.equal(timeStars(100, 100), 3); assert.equal(timeStars(150, 100), 2); assert.equal(timeStars(250, 100), 1); assert.equal(timeStars(251, 100), 0);
  assert.equal(damageStars(0.1), 3); assert.equal(damageStars(0.3), 2); assert.equal(damageStars(0.6), 1); assert.equal(damageStars(0.61), 0);
  assert.equal(merit(3, 3), 3); assert.equal(merit(3, 2), 2); assert.equal(merit(1, 0), 0);
  assert.equal(rankName(0), 'Lance-Corporal'); assert.equal(rankName(30), 'Captain'); assert.equal(rankName(99), 'Field-Marshal');
  near(damageLoss([{ role: 'sniper', hp: 50, maxHp: 100 }, { role: 'guest', hp: 0, maxHp: 100 }]), 0.5);
});

test('abilities: def defaults + group intersection', () => {
  const k = ABILITIES.knife;
  assert.equal(k.campaigns, null); assert.equal(k.noiseRadius, 0); assert.equal(k.visibleToEnemies, true); assert.equal(k.group, 'melee');
  registerAbility({ id: '__t_syringe', group: 'melee' });
  registerAbility({ id: '__t_bomb' });
  assert.deepEqual(groupIntersection([['knife', '__t_bomb'], ['__t_syringe']]), ['knife']);
  assert.deepEqual(groupIntersection([['knife', '__t_bomb'], ['__t_bomb', 'knife']]), ['knife', '__t_bomb']);
  delete ABILITIES.__t_syringe; delete ABILITIES.__t_bomb;
});
