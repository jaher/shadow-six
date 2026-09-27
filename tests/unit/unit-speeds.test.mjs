/** §3.1 / §4.1 movement speeds are terrain-independent: the spec has no snow/sand/mud/shallow penalty. */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';

// snow base (M1–M5 theater) with sand, mud and shallow strips
const TERRAIN = {
  baseTerrain: 'snow',
  shoreShallowWidth: 0,
  terrain: [
    { type: 'path', terrain: 'sand', points: [[20, 0], [20, 60]], width: 4 },
    { type: 'path', terrain: 'mud', points: [[30, 0], [30, 60]], width: 4 },
    { type: 'path', terrain: 'shallow', points: [[40, 0], [40, 60]], width: 4 },
  ],
};
const SPOTS = [['snow', 10], ['sand', 20], ['mud', 30], ['shallow', 40]];

test('§3.1 [EXE] commando speeds are exact on snow, sand, mud and shallow water (no terrain multiplier)', () => {
  const s = makeSim({ ...TERRAIN, commandos: [
    { role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 10, z: 12 }, { role: 'driver', x: 10, z: 14 },
    { role: 'diver', x: 10, z: 16, inventory: { inflatableBoat: 1 } },
  ] });
  assert.equal(CONFIG.units.terrainSpeed, undefined, 'no foundation terrain speed table');
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper'), dr = s.cmd('driver'), ma = s.cmd('diver');
  for (const [name, x] of SPOTS) {
    for (const [u, z] of [[gb, 10], [sn, 12], [dr, 14], [ma, 16]]) u.setPosition(x, z);
    assert.equal(s.world.groundAt(x, 10).terrain, name, `test ground is ${name}`);
    for (const u of [gb, sn, dr, ma]) u.moveMode = 'walk';
    near(gb.speed, 2.25, 1e-9, `GB walk on ${name}`);
    near(sn.speed, 2.25, 1e-9, `Sniper walk on ${name}`);
    near(ma.speed, 1.35, 1e-9, `Marine walk with packed raft on ${name}`);
    for (const u of [gb, sn, dr, ma]) u.moveMode = 'run';
    near(gb.speed, 5.4, 1e-9, `GB run on ${name}`);
    near(dr.speed, 5.4, 1e-9, `Driver run on ${name}`);
    near(sn.speed, 4.5, 1e-9, `Sniper run on ${name}`);
    near(ma.speed, 3.6, 1e-9, `Marine run with packed raft on ${name}`);
    gb.moveMode = 'walk'; gb.stance = 'crawl';
    near(gb.speed, 0.9, 1e-9, `crawl on ${name}`);
    gb.stance = 'stand';
  }
});

test('§4.1 enemy walk (VEL × 0.9) and chase speeds ignore terrain', () => {
  const s = makeSim({ ...TERRAIN, enemies: [guard('e', 10, 10)] }, { brains: false });
  const e = s.get('e');
  e.moveMode = 'walk';
  const walk = [], run = [];
  for (const [, x] of SPOTS) {
    e.setPosition(x, 10);
    e.moveMode = 'walk'; walk.push(e.speed);
    e.moveMode = 'run'; run.push(e.speed);
  }
  for (const v of walk) near(v, walk[0], 1e-9, 'walk speed identical on every terrain');
  for (const v of run) near(v, CONFIG.ai.chaseSpeed, 1e-9, 'chase speed on every terrain');
});
