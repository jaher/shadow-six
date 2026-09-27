/** Mission schema normalizer (design-spec §7.3, src/missions/schema.js). */
import { test, assert } from './lib.mjs';
import { normalizeMission, validateMission, isNormalized, defaultFlags } from '../../src/missions/schema.js';
import { addMissionLinks } from '../../src/world/map-builder.js';
import { NavGrid } from '../../src/world/grid.js';
import m00 from '../../src/missions/m00_sandbox.js';

const tiny = (extra = {}) => ({ id: 'mt', size: [40, 30], commandos: [{ role: 'greenberet', x: 2, z: 2 }], ...extra });

test('every §7.3 field gets a default', () => {
  const n = normalizeMission(tiny(), { quiet: true });
  assert.equal(n.campaign, 'BEL');
  assert.equal(n.coneColors, 'green');
  assert.equal(n.lighting, null);
  assert.equal(n.water, null);
  assert.equal(n.shoreShallowWidth, 2.0);
  for (const k of ['zones', 'jails', 'climbLinks', 'ladders', 'triplines', 'startDisguised', 'enemies', 'vehicles', 'items', 'objectives', 'terrain', 'structures']) {
    assert.ok(Array.isArray(n[k]), k);
  }
  assert.deepEqual(n.barracks, {});
  assert.equal(n.alarmFail, null);
  assert.equal(n.extraction, null);
  assert.deepEqual(n.par, { time: 600 });
  assert.equal(normalizeMission(tiny({ theater: 'desert' }), { quiet: true }).coneColors, 'desert');
});

test('legacy forms are converted; normalizing is idempotent and non-mutating', () => {
  const def = tiny({
    enemies: [
      { soldierType: 'sentry', x: 10, z: 10, heading: 1, post: { scan: [1, 2], period: 4 } },
      { soldierType: 'soldier', x: 12, z: 10, route: [{ x: 12, z: 10, wait: 2 }, { x: 20, z: 10 }], routeMode: 'loop' },
    ],
    extraction: { x: 5, z: 5, r: 3.5 },
    par: { time: 300, kills: 4 },
  });
  const copy = JSON.stringify(def);
  const n = normalizeMission(def, { quiet: true });
  assert.equal(JSON.stringify(def), copy, 'input untouched');
  assert.ok(isNormalized(n));
  assert.equal(normalizeMission(n), n, 'idempotent');
  const [s, p] = n.enemies;
  assert.equal(s.id, 'enemy0');
  assert.deepEqual(s.post, { heading: 1, sweep: null, period: 4, scan: [1, 2] });
  assert.equal(s.route, null);
  assert.equal(s.flags.holdsPost, true);
  assert.equal(s.nervousness, 50);
  assert.equal(p.route.type, 'LOOP');
  assert.equal(p.route.vel, 1);
  assert.equal(p.route.points.length, 2);
  assert.equal(p.route.points[1].wait, 0);
  assert.equal(p.post, null);
  assert.equal(p.flags.investigates, true);
  assert.equal(p.flags.followsTracks, true);
  assert.deepEqual(n.extraction.zone, { r: 3.5, x: 5, z: 5 });
  assert.equal(n.extraction.r, 3.5);
  assert.deepEqual(n.par, { time: 300 });
});

test('§7.3 object forms pass through with defaults filled', () => {
  const n = normalizeMission(tiny({
    enemies: [{ id: 'e1', soldierType: 'trooper', x: 5, z: 5, squad: { id: 'sq', leader: 'e0' }, route: { type: 'PINGPONG', vel: 2, points: [{ x: 5, z: 5 }] }, flags: { raisesAlarmOnSight: true } }],
    zones: [{ id: 'z1', poly: [[0, 0], [10, 0], [10, 10]], onSeen: 'RINT' }],
    barracks: { b1: { squads: [{ size: 3 }] } },
    climbLinks: [{ a: [1, 1], b: [2, 1, 3] }],
    ladders: [{ x: 4, z: 4, top: [5, 4, 3], raised: true }],
    extraction: { vehicleId: 'truck1', exit: { x: 1, z: 1, r: 2 } },
  }), { quiet: true });
  const e = n.enemies[0];
  assert.deepEqual(e.squad, { columns: 1, id: 'sq', leader: 'e0' });
  assert.equal(e.route.vel, 2);
  assert.equal(e.flags.raisesAlarmOnSight, true);
  assert.equal(n.zones[0].onHeard, null);
  assert.deepEqual(n.barracks.b1, { pool: 5, squads: [{ event: 'RINT', size: 3, exitRoute: [], loop: [] }] });
  assert.deepEqual(n.climbLinks[0].a, [1, 1, 0]);
  assert.deepEqual(n.climbLinks[0].roles, ['greenberet']);
  assert.equal(n.ladders[0].raised, true);
  assert.deepEqual(n.extraction.spawnWhen, []);
  const g = new NavGrid(40, 30);
  assert.equal(addMissionLinks(g, n), 2);
  assert.equal(g.links[0].kind, 'climb');
  assert.equal(g.links[1].enabled, false, 'raised ladder starts disabled');
});

test('validation catches broken data', () => {
  const bad = (extra) => validateMission(tiny(extra)).errors;
  assert.ok(validateMission({ size: [10, 10] }).errors.some((e) => e.includes('id')));
  assert.ok(validateMission({ id: 'x', size: [0, 10] }).errors.some((e) => e.includes('size')));
  assert.ok(bad({ campaign: 'C2' }).length);
  assert.ok(bad({ zones: [{ id: 'z', poly: [[0, 0], [1, 1]] }] }).length, 'degenerate zone');
  assert.ok(bad({ enemies: [{ id: 'a', x: 1, z: 1 }, { id: 'a', x: 2, z: 2 }] }).some((e) => e.includes('duplicate')));
  assert.ok(bad({ enemies: [{ x: 1, z: 1, route: { type: 'CIRCLE', points: [] } }] }).length);
  assert.ok(bad({ enemies: [{ x: 100, z: 1 }] }).length, 'outside the map');
  assert.ok(bad({ commandos: [{ role: 'medic', x: 1, z: 1 }] }).length);
  assert.ok(bad({ extraction: { foo: 1 } }).length);
  assert.throws(() => normalizeMission(tiny({ zones: [{ id: 'z', poly: [] }] })), /invalid mission/);
  assert.deepEqual(validateMission(m00).errors, []);
});

test('m00 normalizes cleanly and flag defaults follow §4.1', () => {
  const n = normalizeMission(m00, { quiet: true });
  assert.equal(n.campaign, 'BEL');
  assert.equal(n.enemies.length, m00.enemies.length);
  assert.equal(defaultFlags('mg', false).firesOnSight, true);
  assert.equal(defaultFlags('officer', false).ignoresBodies, true);
  assert.equal(defaultFlags('soldier', true).followsTracks, true);
});
