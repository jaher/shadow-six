/** VEHICLES: registry, operators/capacity, straight-line driving, run-over, damage classes, taint, guns, torpedo, trains. */
import { test, assert, near } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { World } from '../../src/world/world.js';
import { B, T } from '../../src/world/grid.js';
import { Vehicle, VEHICLE_TYPES, vehicleDef, canonicalType, createVehicle, registerVehicleType } from '../../src/entities/vehicle.js';
import { Projectile, explode } from '../../src/entities/projectile.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { fireFromVehicle } from '../../src/abilities/operate.js';
import { leaveVehicle, routeVehicleOrder } from '../../src/abilities/drive.js';
import { ABILITIES } from '../../src/abilities/index.js';
import { canSee } from '../../src/ai/perception.js';

const DT = 1 / 60;

/** A flat 80×60 world; `river` adds deep water z∈[30,44] with shallow banks. */
function mkWorld({ river = false } = {}) {
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  if (river) {
    w.grid.fillRect(0, 29, 80, 1, 'terrain', T.SHALLOW);
    w.grid.fillRect(0, 30, 80, 14, 'terrain', T.WATER);
    w.grid.fillRect(0, 44, 80, 1, 'terrain', T.SHALLOW);
  }
  return w;
}

/** Game.step order (vehicles after enemies and the 20 Hz BEL tick). */
function step(w, n = 1) {
  for (let k = 0; k < n; k++) {
    w.rebuildSpatial();
    w.refreshDynamicOccluders();
    for (const c of [...w.commandos]) if (!c.removed) c.update(DT);
    for (const e of [...w.enemies]) if (!e.removed) e.update(DT);
    w.runBelTicks(DT);
    for (const v of [...w.vehicles]) if (!v.removed) v.update(DT);
    for (const p of [...w.projectiles]) if (!p.removed) p.update(DT);
    w.flushRemovals();
    w.time += DT;
  }
}
const secs = (s) => Math.round(s / DT);
const commando = (w, role, x, z, heading = 0) => w.add(new Commando({ role, x, z, heading }));
const enemy = (w, x, z, heading = 0, extra = {}) => w.add(new Enemy({ soldierType: 'soldier', x, z, heading, ...extra }));
const events = (w, name) => { const log = []; w.events.on(name, (p) => log.push(p)); return log; };

test('registry: every §7.7 type resolves; aliases; spec speeds, turn rates and seats', () => {
  for (const t of ['raft', 'truck', 'patrolboat', 'kubelwagen', 'motorcycle', 'panzer2', 'panzer3', 'panzer4', 'sdkfz', 'opel_blitz_tanker',
    'citroen15', 'horch', 'willys', 'autogyro', 'ju52', 'ju87', 'minisub', 'rowboat', 'train', 'tram', 'mgNest', 'cannon']) {
    assert.ok(VEHICLE_TYPES[t], t);
    const d = vehicleDef(t);
    assert.equal(d.type, t);
    assert.ok(['land', 'boat', 'plane', 'emplacement', 'rail'].includes(d.kind), t);
    const v = new Vehicle({ vehicleType: t, x: 5, z: 5 });
    assert.ok(v.object3d, `${t} has a placeholder model`);
  }
  assert.equal(canonicalType('tank'), 'panzer2');
  assert.equal(canonicalType('fuel_truck'), 'opel_blitz_tanker');
  assert.equal(canonicalType('armoredcar'), 'sdkfz');
  const tr = vehicleDef('truck'), tk = vehicleDef('panzer4'), bt = vehicleDef('patrolboat'), mc = vehicleDef('motorcycle');
  assert.equal(tr.slow, 3); assert.equal(tr.fast, 9); near(tr.turn, 60 * Math.PI / 180, 1e-9);
  assert.equal(tk.slow, 2); assert.equal(tk.fast, 5); near(tk.turn, 45 * Math.PI / 180, 1e-9);
  assert.equal(bt.slow, 2.5); assert.equal(bt.fast, 4);
  assert.equal(mc.slow, 10, 'motorcycle: fast only');
  assert.equal(vehicleDef('raft').seats, 3);
  assert.equal(vehicleDef('kubelwagen').seats, 4);
  assert.equal(vehicleDef('truck').seats, 6);
  assert.equal(vehicleDef('sdkfz').seats, 5);
  assert.equal(vehicleDef('mgNest').seats, 1);
  registerVehicleType('testcart', { kind: 'land', model: 'car', speed: 'car', hits: 5, size: [2, 1], occludes: false });
  assert.equal(vehicleDef('testcart').hits, 5);
  delete VEHICLE_TYPES.testcart;
});

test('operators and capacity (§3.7, §3.2): Driver drives land, Marine boats first, emplacements Driver only', () => {
  const w = mkWorld({ river: true });
  const dr = commando(w, 'driver', 10, 10), gb = commando(w, 'greenberet', 11, 10), sn = commando(w, 'sniper', 12, 10);
  const sa = commando(w, 'sapper', 13, 10), sp = commando(w, 'spy', 14, 10), ma = commando(w, 'diver', 15, 10);
  const kub = w.spawnVehicle('kubelwagen', { x: 20, z: 12 });
  assert.equal(kub.canOperate(gb), false);
  assert.equal(kub.canOperate(dr), true);
  assert.ok(kub.enter(gb), 'anyone rides as passenger');
  assert.equal(kub.operator, null, 'a passenger does not drive');
  assert.equal(routeVehicleOrder(gb, { type: 'move', x: 30, z: 12 }), true);
  assert.equal(kub.goal, null, 'passenger orders are refused');
  assert.ok(kub.enter(dr));
  assert.equal(kub.operator, dr, 'the Driver takes the wheel');
  assert.ok(kub.enter(sn)); assert.ok(kub.enter(sa));
  assert.equal(kub.canEnter(sp), 'full', 'Kübelwagen seats 4');
  assert.equal(gb.state, 'inVehicle'); assert.equal(gb.isVisibleToEnemies, false);
  // boats: the Marine boards first; others only in shallow water / by the bank
  const raft = w.spawnVehicle('raft', { x: 40, z: 31 });
  assert.equal(raft.canEnter(sp), 'the Marine must board first');
  assert.ok(raft.enter(ma));
  assert.equal(raft.operator, ma);
  assert.equal(raft.canEnter(sp), true);
  const deep = w.spawnVehicle('raft', { x: 60, z: 37 });
  deep.enter(commando(w, 'diver', 60, 37));
  assert.equal(deep.canEnter(sp), 'the boat must be in shallow water');
  // emplacements: one operator, the Driver (§3.4)
  const nest = w.spawnVehicle('mgNest', { x: 20, z: 20 });
  assert.equal(nest.vehicleKind, 'emplacement');
  assert.equal(nest.canEnter(sp), 'only the Driver can man this gun');
  // a truck with an enemy crew can't be boarded
  const t = w.spawnVehicle('truck', { x: 60, z: 10, crew: ['truckDriver'] });
  assert.equal(t.canEnter(sp), 'enemy crew aboard');
});

test('driving (§3.7 + 2026-10-07 car steering): no pivot on the spot — it turns on its turning circle, then a straight line, slow/fast, stops at the first blocking cell; forbidden target', () => {
  const w = mkWorld();
  w.grid.fillRect(50, 0, 2, 60, 'block', B.HIGH); // a wall across the map at x 50..52
  const dr = commando(w, 'driver', 10, 30);
  const tr = w.spawnVehicle('truck', { x: 20, z: 30, heading: Math.PI / 2 }); // facing +z
  assert.ok(tr.enter(dr));
  const moves = events(w, 'vehicle:move'), stops = events(w, 'vehicle:stop');
  assert.ok(dr.issue({ type: 'move', x: 40, z: 30 }), 'click = drive');
  assert.equal(tr.fast, false); assert.equal(tr.maxSpeed, 3);
  // every tick: the heading turns only as far as the distance rolled allows (radius ≥ turnRadius) — never on the spot
  const R = tr.def.turnRadius;
  let px = tr.x, pz = tr.z, ph = tr.heading, turned = 0, line = null, off = 0, run = 0;
  for (let k = 0; k < secs(14); k++) {
    step(w);
    const ds = Math.hypot(tr.x - px, tr.z - pz), dh = Math.abs(Math.atan2(Math.sin(tr.heading - ph), Math.cos(tr.heading - ph)));
    assert.ok(dh <= ds / R + 1e-6, `pivot: turned ${(dh * 180 / Math.PI).toFixed(2)}° rolling ${ds.toFixed(3)} m (R ${R})`);
    turned += dh;
    // the turn done (its plan run out), the rest is the straight line to the point
    if (!line && tr.goal && !tr.goal.man) line = { x: tr.x, z: tr.z, h: Math.atan2(30 - tr.z, 40 - tr.x) };
    if (line && tr.goal) {
      off = Math.max(off, Math.abs(-(tr.x - line.x) * Math.sin(line.h) + (tr.z - line.z) * Math.cos(line.h)));
      if (k % 30 === 0 && Math.abs(Math.atan2(Math.sin(tr.heading - line.h), Math.cos(tr.heading - line.h))) < 0.06) run = Math.max(run, tr.speed);
    }
    px = tr.x; pz = tr.z; ph = tr.heading;
  }
  assert.ok(turned > 1.2, `it turned toward the point on the move (${turned.toFixed(2)} rad)`);
  assert.ok(line && Math.hypot(line.x - 20, line.z - 30) > 2, `the turn carried it along its arc (${line && line.x.toFixed(2)},${line && line.z.toFixed(2)})`);
  assert.ok(off < 0.1, `straight line after the turn (off by ${off.toFixed(3)} m)`);
  near(run, 3, 0.05, 'slow = 3 m/s on the line');
  assert.ok(moves.length >= 1);
  near(tr.x, 40, 0.35, 'arrived');
  near(tr.z, 30, 0.35, 'arrived');
  assert.ok(stops.length >= 1);
  // double-click = fast; the wall stops it at the first blocking cell (nose at the wall)
  assert.ok(dr.issue({ type: 'move', x: 49.9, z: 30, run: true }));
  assert.equal(tr.maxSpeed, 9);
  step(w, secs(3));
  assert.ok(tr.x + 3 <= 50.01 && tr.x > 45, `stopped in front of the wall (${tr.x.toFixed(2)})`);
  // straight-line reachability (forbidden cursor)
  assert.equal(tr.canDriveTo(70, 30), false, 'nose against the wall: forbidden cursor');
  assert.equal(tr.canDriveTo(20, 30), true, 'back the way it came');
  const blocked = w.spawnVehicle('kubelwagen', { x: 48.05, z: 10, heading: 0 });
  assert.equal(blocked.canDriveTo(60, 10), false, 'nose already at the wall: forbidden');
  assert.equal(blocked.driveTo(60, 10), false);
  // leaving: onto a walkable cell within 3 m of the hull
  assert.ok(leaveVehicle(dr));
  assert.equal(dr.state, 'active'); assert.equal(dr.vehicle, null);
  assert.ok(Math.hypot(dr.x - tr.x, dr.z - tr.z) <= CONFIG.vehicles.exitRadius + 3.5);
  assert.ok(w.grid.walkableAt(dr.x, dr.z));
});

test('boats: water only; the raft cannot drive onto land; non-divers cannot get out mid-river', () => {
  const w = mkWorld({ river: true });
  const ma = commando(w, 'diver', 40, 28), gb = commando(w, 'greenberet', 41, 28);
  const raft = w.spawnVehicle('raft', { x: 40, z: 31, heading: Math.PI / 2 });
  assert.ok(raft.enter(ma)); assert.ok(raft.enter(gb));
  assert.equal(raft.canDriveTo(40, 55), true);
  assert.ok(raft.driveTo(40, 55));
  step(w, secs(8));
  assert.ok(raft.z < 44.5 && raft.z > 41, `stops at the far shallows (${raft.z.toFixed(2)})`);
  raft.driveTo(40, 37); step(w, secs(7)); // 180° at 45°/s = 4 s, then ~6 m at 2.5 m/s
  assert.ok(raft.z > 36 && raft.z < 38.5, `back in deep water ${raft.z}`);
  assert.equal(leaveVehicle(gb), false, 'mid-river: no');
  assert.equal(gb.vehicle, raft);
});

// Regression (gp fix "unit separation"): three commandos leaving the raft all landed on one point
// (t21: gr/sn/di at 35.3,55.8). Each exit takes its own spot, at the same clicked point too.
test('exit: several units leaving one hull never stack on the same point (per-seat exit offsets)', () => {
  for (const pref of [null, { x: 40, z: 46 }]) {
    const w = mkWorld({ river: true });
    const us = [commando(w, 'diver', 39, 45.5), commando(w, 'greenberet', 40, 45.5), commando(w, 'sniper', 41, 45.5)]; // the Marine boards first
    const raft = w.spawnVehicle('raft', { x: 40, z: 44.2, heading: Math.PI / 2 });
    for (const u of us) assert.ok(raft.enter(u));
    for (const u of us) assert.ok(pref ? leaveVehicle(u, pref.x, pref.z) : leaveVehicle(u), `${u.role} got out`);
    for (let a = 0; a < us.length; a++) {
      assert.ok(w.grid.walkableAt(us[a].x, us[a].z), `${us[a].role} on a walkable cell`);
      for (let b = a + 1; b < us.length; b++) {
        const d = Math.hypot(us[a].x - us[b].x, us[a].z - us[b].z);
        assert.ok(d >= 0.85, `${us[a].role}/${us[b].role} ${d.toFixed(2)} m apart (pref ${!!pref})`);
      }
    }
  }
  // a bystander already standing on the exit spot is not stepped onto either
  const w = mkWorld();
  const dr = commando(w, 'driver', 5, 5);
  const kub = w.spawnVehicle('kubelwagen', { x: 20, z: 20, heading: 0 });
  assert.ok(kub.enter(dr));
  const p0 = kub._exitPoint(undefined, undefined, false, dr, 0);
  const by = commando(w, 'sapper', p0.x, p0.z);
  assert.ok(leaveVehicle(dr));
  assert.ok(Math.hypot(dr.x - by.x, dr.z - by.z) >= 0.85, 'stepped out beside the bystander');
});

test('run-over (§3.7 ATROPELLO): fast kills silently in the front box (friends too); slow: enemies step aside', () => {
  const w = mkWorld();
  const dr = commando(w, 'driver', 5, 5);
  const tr = w.spawnVehicle('truck', { x: 10, z: 30, heading: 0 });
  tr.enter(dr);
  const victim = enemy(w, 20, 30, Math.PI / 2); // looking away (+z)
  const pal = commando(w, 'sniper', 30, 30.8);
  const noises = events(w, 'noise'), runs = events(w, 'vehicle:runover');
  assert.ok(tr.driveTo(40, 30, true));
  step(w, secs(4));
  assert.equal(victim.alive, false, 'enemy run over');
  assert.equal(pal.alive, false, 'friendly fire: the sniper too');
  assert.equal(runs.length, 2);
  assert.equal(noises.filter((n) => n.source === tr || n.source === dr).length, 0, 'silent kill');
  // slow: the enemy steps aside and the (commando-driven) vehicle is marked
  const e2 = enemy(w, 55, 30, Math.PI / 2);
  assert.ok(tr.driveTo(70, 30, false));
  let off = 0;
  for (let k = 0; k < secs(8); k++) { step(w); off = Math.max(off, Math.abs(e2.z - 30)); }
  assert.equal(e2.alive, true, 'slow speed: no kill');
  assert.ok(off >= 1.9, `stepped aside (${off.toFixed(2)})`);
  assert.ok(tr.x > 60, 'the truck drove past');
  assert.equal(tr.tainted, true, 'he saw the commando-driven truck');
});

test('run-over (§3.7): a fast order alone does not kill; a truck just pulling away applies the slow rule', () => {
  const w = mkWorld();
  const dr = commando(w, 'driver', 5, 5);
  const tr = w.spawnVehicle('truck', { x: 10, z: 30, heading: 0 });
  tr.enter(dr);
  const e1 = enemy(w, 14.7, 30, Math.PI / 2); // 4.7 m ahead of a parked truck: inside the box from the start
  const runs = events(w, 'vehicle:runover');
  assert.ok(tr.driveTo(40, 30, true));
  let killedAt = null, off = 0;
  for (let k = 0; k < secs(2) && e1.alive; k++) { step(w); off = Math.max(off, Math.abs(e1.z - 30)); if (!e1.alive) killedAt = { x: tr.x, v: tr.speed }; }
  assert.equal(e1.alive, true, `not killed by a truck just starting (${killedAt ? `at x=${killedAt.x.toFixed(2)} v=${killedAt.v.toFixed(2)}` : ''})`);
  assert.equal(runs.length, 0);
  assert.ok(off >= 1.9, `he stepped aside (${off.toFixed(2)})`);
  // once at full fast speed the box kills
  const e2 = enemy(w, tr.x + 12, 30, Math.PI / 2);
  step(w, secs(3));
  assert.equal(e2.alive, false, 'at fast speed: run over');
  assert.equal(runs.length, 1);
  assert.ok(CONFIG.vehicles.runoverSpeedFrac > 0.5 && CONFIG.vehicles.runoverSpeedFrac <= 1);
});

test('tainted (§3.7/§4.3): an enemy who sees the boarding marks it; infantry shoots it until destroyed, even empty', () => {
  const w = mkWorld();
  const watcher = enemy(w, 10, 30, 0); // looking +x at the car 12 m away
  const dr = commando(w, 'driver', 21, 31.5);
  const kub = w.spawnVehicle('kubelwagen', { x: 22, z: 30, heading: 0 });
  const taints = events(w, 'vehicle:tainted'), destroyed = events(w, 'vehicle:destroyed');
  assert.ok(kub.enter(dr));
  assert.equal(kub.tainted, true);
  assert.equal(taints[0].by, watcher);
  leaveVehicle(dr, 22, 34);
  dr.setPosition(70, 5); // walk away: the car is empty now
  step(w, secs(25)); // rifle: 1 shot/s, Kübelwagen takes 20 hits
  assert.equal(kub.destroyed, true, `destroyed after ${kub.hits} hits`);
  assert.equal(destroyed.length, 1);
  assert.ok(kub.hits >= 20);
  // an untainted empty truck in view is left alone
  const w2 = mkWorld();
  enemy(w2, 10, 30, 0);
  const tr = w2.spawnVehicle('truck', { x: 22, z: 30 });
  step(w2, secs(5));
  assert.equal(tr.hits, 0);
});

test('tainted (§3.7/§4.1): an enemy who saw the boarding fires at the rifle cadence (1 shot/s), not twice', () => {
  const w = mkWorld();
  const watcher = enemy(w, 10, 30, 0);
  const dr = commando(w, 'driver', 21, 31.5);
  const tr = w.spawnVehicle('truck', { x: 22, z: 30, heading: 0 });
  const shots = []; w.events.on('shot', (p) => shots.push({ ...p, t: w.time }));
  assert.ok(tr.enter(dr));
  assert.equal(tr.tainted, true);
  assert.equal(watcher.brain.state, 'COMBAT', 'the watcher fights the boarded truck');
  step(w, secs(12));
  const mine = shots.filter((s) => s.shooter === watcher && s.target === tr);
  assert.ok(mine.length >= 2, `${mine.length} shots`);
  const span = mine.at(-1).t - mine[0].t;
  const cad = CONFIG.weapons.rifle.cadence;
  for (let i = 1; i < mine.length; i++) {
    assert.ok(mine[i].t - mine[i - 1].t >= cad - 1e-6, `shot gap ${(mine[i].t - mine[i - 1].t).toFixed(3)} s < cadence ${cad}`);
  }
  near(mine.length - 1, span / cad, 1, 'shots per second = 1/cadence');
  assert.equal(tr.destroyed, false);
  // a tainted empty truck handed to the 20 Hz rule (no brain COMBAT): still one shot per cadence
  const w2 = mkWorld();
  const e2 = enemy(w2, 10, 30, 0);
  const tr2 = w2.spawnVehicle('truck', { x: 22, z: 30, heading: 0 });
  tr2.tainted = true;
  const shots2 = []; w2.events.on('shot', (p) => shots2.push({ ...p, t: w2.time }));
  step(w2, secs(10));
  const m2 = shots2.filter((s) => s.shooter === e2 && s.target === tr2);
  assert.ok(m2.length >= 2, `${m2.length} shots`);
  for (let i = 1; i < m2.length; i++) assert.ok(m2[i].t - m2[i - 1].t >= cad - 1e-6, `gap ${(m2[i].t - m2[i - 1].t).toFixed(3)}`);
});

test('vehicle HP classes (§3.7/§3.6): bullets vs hits budget, tanks immune, grenades vs light, bombs vs heavy', () => {
  const w = mkWorld();
  const tr = w.spawnVehicle('truck', { x: 10, z: 10 });
  for (let k = 0; k < 29; k++) tr.takeDamage(80, null, 'rifle');
  assert.equal(tr.destroyed, false);
  tr.takeDamage(80, null, 'rifle');
  assert.equal(tr.destroyed, true, 'truck: 30 bullets');
  const p3 = w.spawnVehicle('panzer3', { x: 40, z: 10 });
  for (let k = 0; k < 2000; k++) p3.takeDamage(110, null, 'mg');
  assert.equal(p3.destroyed, false, 'Panzer III immune to small arms');
  explode(w, 41, 10, 'grenade');
  assert.equal(p3.destroyed, false, 'Panzer III immune to grenades');
  explode(w, 43, 10, 'bomb');
  assert.equal(p3.destroyed, true, 'bombs destroy heavy armour');
  const p2 = w.spawnVehicle('panzer2', { x: 60, z: 40, crew: ['crew'] });
  for (let k = 0; k < 999; k++) p2.takeDamage(80, null, 'rifle');
  assert.equal(p2.destroyed, false);
  p2.takeDamage(80, null, 'rifle');
  assert.equal(p2.destroyed, true, 'enemy Panzer II: 1000 hits');
  const mine = w.spawnVehicle('panzer2', { x: 20, z: 50 });
  for (let k = 0; k < 1200; k++) mine.takeDamage(80, null, 'rifle');
  assert.equal(mine.destroyed, false, 'drivable Panzer II: bullet-immune');
  w.add(new Projectile('grenade', { from: { x: 14, z: 50 }, to: { x: 20, z: 51 } }));
  step(w, secs(1.5));
  assert.equal(mine.destroyed, true, 'grenades destroy the Panzer II');
  // wreck: burns 20 s then stays as a static B.HIGH obstacle
  const { i, j } = w.grid.worldToCell(20, 50);
  assert.equal(w.grid.block[w.grid.idx(i, j)], B.NONE);
  step(w, secs(20.5));
  assert.equal(w.grid.block[w.grid.idx(i, j)], B.HIGH, 'wreck baked into the grid');
});

test('fuel tanker (§3.6): one bullet explodes it as vehicle + barrel; the blast kills within 5 m', () => {
  const w = mkWorld();
  const tk = w.spawnVehicle('opel_blitz_tanker', { x: 30, z: 30 });
  const close = enemy(w, 34, 31), far = enemy(w, 37.5, 30), safe = enemy(w, 50, 30);
  const booms = events(w, 'explosion'), noise = events(w, 'noise');
  tk.takeDamage(80, null, 'rifle');
  assert.equal(tk.destroyed, true);
  assert.deepEqual(booms.map((b) => b.kind).sort(), ['barrel', 'vehicle']);
  assert.equal(close.alive, false, 'inside the barrel lethal radius');
  assert.equal(far.alive, true, '180 damage does not kill a 200 HP soldier');
  assert.ok(far.hp < 50, `took vehicle + barrel damage (${far.hp})`);
  assert.equal(safe.hp, safe.maxHp);
  assert.ok(noise.some((n) => n.kind === 'explosion'), 'map-wide explosion noise');
});

test('emplacement manning (§3.4/§3.7): gunner dead → the Driver walks in (0.8 s), Ctrl+click fires MG bursts; giro limit', () => {
  const w = mkWorld();
  const gunner = enemy(w, 30, 30, Math.PI, { soldierType: 'mg', id: 'g1' });
  const nest = w.spawnVehicle('mgNest', { x: 30, z: 30, heading: 0, gunner: 'g1', giro: 180 });
  const dr = commando(w, 'driver', 20, 20);
  assert.equal(nest.canEnter(dr), 'enemy crew aboard');
  gunner.die('knife', null);
  assert.equal(nest.canEnter(dr), true);
  assert.ok(ABILITIES.enterVehicle.roles.includes('driver'));
  assert.ok(dr.issue({ type: 'ability', id: 'enterVehicle', target: nest }));
  step(w, secs(12));
  assert.equal(dr.vehicle, nest, 'manned');
  assert.equal(nest.operator, dr);
  const target = enemy(w, 50, 30, Math.PI / 2);
  const shots = events(w, 'shot');
  assert.equal(fireFromVehicle(dr, target), true);
  step(w, secs(0.5));
  assert.equal(shots.filter((s) => s.weapon === 'mg').length, CONFIG.weapons.mg.rounds, 'one burst');
  assert.equal(target.alive, false, `MG rounds kill (hp ${target.hp})`);
  const behind = enemy(w, 10, 30);
  assert.equal(fireFromVehicle(dr, behind), 'the gun cannot turn that far', 'giro 180° around the post heading');
  // Ctrl+click goes through the vehicleFire ability as well
  const t2 = enemy(w, 45, 38);
  assert.ok(dr.issue({ type: 'ability', id: 'vehicleFire', target: t2 }));
  step(w, secs(0.6));
  assert.equal(t2.alive, false);
  // leave via the knapsack photo (leaveVehicle ability)
  assert.ok(dr.issue({ type: 'ability', id: 'leaveVehicle', target: dr }));
  assert.equal(dr.vehicle, null);
});

test('tank weapons (§3.7): cannon shell ≥13.5 m (2.25 m lethal), MG inside the minimum; reload 1.5 s', () => {
  const w = mkWorld();
  const dr = commando(w, 'driver', 5, 5);
  const tank = w.spawnVehicle('panzer4', { x: 10, z: 30 });
  assert.ok(tank.enter(dr));
  const far = enemy(w, 35, 30, Math.PI / 2), far2 = enemy(w, 36.5, 30.5, Math.PI / 2);
  const booms = events(w, 'explosion'), fires = events(w, 'vehicle:fire');
  assert.equal(fireFromVehicle(dr, far), true);
  assert.equal(fires[0].weapon, 'cannon');
  assert.equal(fireFromVehicle(dr, far), 'reloading');
  step(w, secs(1));
  assert.ok(booms.some((b) => b.kind === 'shell'));
  assert.equal(far.alive, false); assert.equal(far2.alive, false, 'within 2.25 m: instant death');
  const near1 = enemy(w, 18, 30, Math.PI / 2);
  step(w, secs(1));
  assert.equal(fireFromVehicle(dr, near1), true);
  assert.equal(fires[fires.length - 1].weapon, 'tankMg', 'closer than 13.5 m → MG');
  step(w, secs(1.2));
  assert.equal(near1.alive, false);
});

test('mini-sub torpedoes (§7.1 M13): 2 torpedoes run straight along the heading and blow up the first hull', () => {
  const w = mkWorld({ river: true });
  const ma = commando(w, 'diver', 5, 28);
  const sub = w.spawnVehicle('minisub', { x: 10, z: 37, heading: 0 });
  assert.ok(sub.enter(ma));
  const boat = w.spawnVehicle('patrolboat', { x: 50, z: 37, heading: Math.PI / 2 });
  const hits = events(w, 'hit');
  assert.equal(sub.torpedoes, 2);
  assert.equal(fireFromVehicle(ma, { x: 10, z: 60 }), true, 'aim point ignored: straight ahead');
  assert.equal(sub.torpedoes, 1);
  const torp = w.projectiles.find((p) => p.projKind === 'torpedo');
  assert.ok(torp);
  step(w, secs(6));
  assert.equal(boat.destroyed, true, 'hit the boat 40 m ahead');
  assert.ok(hits.some((h) => h.weapon === 'torpedo' && h.target === boat));
  step(w, secs(1.2));
  assert.equal(fireFromVehicle(ma, { x: 70, z: 37 }), true);
  step(w, secs(1.2));
  assert.equal(sub.torpedoes, 0);
  assert.equal(fireFromVehicle(ma, { x: 70, z: 37 }), 'no torpedoes left');
  // the second one runs out of water at the map edge / shore and explodes there
  step(w, secs(10));
  assert.equal(w.projectiles.filter((p) => p.projKind === 'torpedo').length, 0);
});

test('trains (§3.7): periodic schedule, kill box on the rails, stop for a vehicle on the track', () => {
  const w = mkWorld();
  const track = [{ x: -40, z: 20 }, { x: 120, z: 20 }];
  const train = w.spawnVehicle('train', { track, schedule: { delay: 1, speed: 12, period: 30 } });
  assert.equal(train.canEnter(commando(w, 'spy', 1, 1)), 'cannot board a train');
  const walker = enemy(w, 30, 20.5, Math.PI / 2);
  const passes = events(w, 'train:pass');
  assert.equal(train.hiddenRail, true);
  step(w, secs(1.2));
  assert.equal(passes.length, 1);
  step(w, secs(8));
  assert.equal(walker.alive, false, 'run down on the rails');
  step(w, secs(10));
  assert.equal(train.hiddenRail, true, 'gone off-map after the run');
  // next pass: a motorcycle parked on the track stops it
  const moto = w.spawnVehicle('motorcycle', { x: 40, z: 20 });
  step(w, secs(34)); // next departure 30 s after the first run ended (t ≈ 44 s)
  assert.equal(passes.length, 2);
  assert.equal(train.speed, 0, 'stopped for the motorcycle');
  assert.ok(train.x < 40 && train.x > 10, `halted before it (${train.x.toFixed(1)})`);
  assert.equal(moto.destroyed, false);
});

test('enemy vehicle AI: PINGPONG patrol boat route with waits; it spots a commando, stops and fires (PARAYDISPARA)', () => {
  const w = mkWorld({ river: true });
  const route = { type: 'PINGPONG', speed: 2.5, points: [{ x: 10, z: 37, wait: 2 }, { x: 40, z: 37 }, { x: 70, z: 37, wait: 2 }] };
  const boat = w.spawnVehicle('patrolboat', { x: 10, z: 37, heading: 0, crew: ['mg'], route });
  assert.equal(boat.brain.behavior, 'route');
  assert.ok(boat.vision, 'crewed patrol boat looks with the mg profile');
  step(w, secs(10));
  assert.ok(boat.x > 25 && boat.x < 40, `patrolling at 2.5 m/s after the 2 s wait (${boat.x.toFixed(1)})`);
  step(w, secs(18));
  assert.ok(boat.x > 55, `reached the far end (${boat.x.toFixed(1)})`);
  step(w, secs(16));
  assert.ok(boat.x < 50, `ping-pong: coming back (${boat.x.toFixed(1)})`);
  // a commando on the bank in front of the boat
  const gb = commando(w, 'greenberet', boat.x - 12, 28);
  const fires = events(w, 'vehicle:fire');
  let stopped = false;
  for (let k = 0; k < secs(3); k++) { step(w); if (boat.brain.state === 'attack' && boat.speed === 0) stopped = true; }
  assert.ok(stopped, 'stops to fire');
  assert.ok(fires.length > 0 && fires[0].weapon === 'mg');
  assert.ok(gb.hp < gb.maxHp, 'the gunner hits');
});

test('standby tanks (§7.1 M9): hold until a commando is seen, then shell him; ignore empty ground', () => {
  const w = mkWorld();
  const tank = w.spawnVehicle('panzer4', { x: 10, z: 30, heading: 0, crew: ['crew', 'crew'] });
  assert.equal(tank.brain.behavior, 'standby');
  step(w, secs(3));
  assert.equal(tank.x, 10, 'parked');
  const sn = commando(w, 'sniper', 35, 30);
  const fires = events(w, 'vehicle:fire');
  step(w, secs(2));
  assert.ok(fires.some((f) => f.weapon === 'cannon' && f.target === sn), 'fires the cannon at ≥ 13.5 m');
  assert.equal(sn.alive, false);
  // a commando inside a vehicle is not visible; the SdKfz patrol attacks tainted vehicles it sees
  const w2 = mkWorld();
  const sd = w2.spawnVehicle('sdkfz', { x: 10, z: 30, heading: 0, crew: ['crew'], route: { type: 'LOOP', points: [{ x: 10, z: 30 }, { x: 12, z: 30 }] } });
  const car = w2.spawnVehicle('kubelwagen', { x: 30, z: 30 });
  car.taint();
  step(w2, secs(4));
  assert.ok(car.hits > 0 || car.destroyed, 'the SdKfz MG shoots the tainted car');
  assert.ok(sd.brain.state === 'attack' || car.destroyed);
});

test('raft unattended (§4.3): a used raft seen with no commando within 3 m is shot until it deflates (3 hits)', () => {
  const w = mkWorld({ river: true });
  const raft = w.spawnVehicle('raft', { x: 30, z: 31, heading: 0, used: true });
  enemy(w, 20, 24, 0.6);
  const d = events(w, 'vehicle:destroyed');
  step(w, secs(5));
  assert.equal(raft.destroyed, true, `deflated after ${raft.raftHits} hits`);
  assert.equal(d[0].cause, 'deflated');
  const booms = events(w, 'explosion');
  assert.equal(booms.length, 0, 'deflating is not an explosion');
});

test('raft unattended (§4.3): a man the guard cannot see (under water beside it, crawling in the light band) attends nothing', () => {
  // user, M3 2026-10-08: "Even the raft boat in the light shaded field of view of a soldier makes the soldier see it"
  // — the empty raft lay in e17's cone with the Marine submerged beside it, and nobody shot it
  const w = mkWorld({ river: true });
  const raft = w.spawnVehicle('raft', { x: 30, z: 31, heading: 0, used: true });
  const ma = commando(w, 'diver', 31.5, 32);
  ma.diving = true; ma.stance = 'dive';
  enemy(w, 20, 24, 0.6);
  step(w, secs(5));
  assert.equal(raft.destroyed, true, `a submerged Marine 1.8 m off does not attend it (hits ${raft.raftHits})`);
  // the far band: a man crawling there is unseen, so the raft (seen in any band) lies there alone to the guard
  const w2 = mkWorld({ river: true });
  const e2 = enemy(w2, 4, 30, 0);
  const far = e2.vision.near + 3; // 3 m into the light band
  const r2 = w2.spawnVehicle('raft', { x: 4 + far + 0.5, z: 30.8, heading: 0, used: true });
  const cr = commando(w2, 'greenberet', 4 + far, 28.5);
  cr.setStance('crawl');
  step(w2, secs(1));
  assert.equal(canSee(e2, cr, w2), 'none', 'the crawler in the light band is unseen');
  step(w2, secs(5));
  assert.equal(r2.destroyed, true, 'a raft attended only by an unseen crawler is shot');
});

test('raft attended (§4.3): a man the guard sees beside it keeps it from being shot as abandoned', () => {
  const w = mkWorld({ river: true });
  const raft = w.spawnVehicle('raft', { x: 30, z: 31, heading: 0, used: true });
  const sp = commando(w, 'spy', 30.5, 29.2);
  sp.disguised = true; // (in uniform: seen and not suspicious — he attends the raft in the guard's eyes)
  const e = enemy(w, 20, 24, 0.6);
  assert.ok(canSee(e, sp, w, { ignoreDisguise: true }) !== 'none', 'the guard has the Spy in sight');
  step(w, secs(5));
  assert.equal(raft.destroyed, false, `not shot (hits ${raft.raftHits})`);
});

test('save/load round-trip keeps hits, taint, torpedoes, rail state', () => {
  const w = mkWorld({ river: true });
  const t = w.spawnVehicle('truck', { x: 10, z: 10 });
  t.takeDamage(1, null, 'rifle'); t.takeDamage(1, null, 'rifle'); t.taint();
  const s = t.serialize();
  const t2 = createVehicle({ vehicleType: 'truck', x: 0, z: 0 });
  t2.deserialize(s);
  assert.equal(t2.hits, 2); assert.equal(t2.tainted, true);
  const sub = w.spawnVehicle('minisub', { x: 10, z: 37 });
  sub.torpedoes = 1;
  const s2 = createVehicle({ vehicleType: 'minisub', x: 0, z: 0 });
  s2.deserialize(sub.serialize());
  assert.equal(s2.torpedoes, 1);
});

// ---- §10 "a quickload replays identically": vehicle routes keep their exact leg / waypoint / wait

const PB_ROUTE = { type: 'PINGPONG', speed: 2.5, points: [{ x: 10, z: 37, wait: 15 }, { x: 40, z: 37 }, { x: 70, z: 37, wait: 15 }] };
const boatWorld = () => { const w = mkWorld({ river: true }); return { w, boat: w.spawnVehicle('patrolboat', { x: 10, z: 37, heading: 0, crew: ['mg'], route: PB_ROUTE }) }; };
/** Load `snap` into a freshly built world at the same clock (what save.restore does). */
function reload(snap, time) {
  const { w, boat } = boatWorld();
  w.time = time;
  boat.deserialize(JSON.parse(JSON.stringify(snap)));
  return { w, boat };
}

test('save/load (§10): a patrol boat saved just after leaving its end point does not go back and re-wait', () => {
  const A = boatWorld();
  step(A.w, secs(17)); // 15 s wait at (10,37), then ~2 s out on the leg to (40,37)
  assert.ok(A.boat.x > 11 && A.boat.x < 17, `left the end point (${A.boat.x.toFixed(1)})`);
  const B = reload(A.boat.serialize(), A.w.time);
  assert.equal(B.boat.pathIndex, A.boat.pathIndex);
  assert.equal(B.boat.vision.phase, A.boat.vision.phase, 'sweep phase kept (not re-rolled from the RNG)');
  for (let k = 0; k < secs(40); k++) {
    step(A.w); step(B.w);
    if (k % 60 === 0) assert.ok(Math.abs(A.boat.x - B.boat.x) < 1e-6 && Math.abs(A.boat.z - B.boat.z) < 1e-6,
      `replays identically at +${(k * DT).toFixed(1)} s: ${A.boat.x.toFixed(2)} vs ${B.boat.x.toFixed(2)}`);
  }
  assert.ok(B.boat.x > 60, `kept its timetable (${B.boat.x.toFixed(1)})`);
});

test('save/load (§10): the remaining wait at a route point is restored, not restarted', () => {
  const A = boatWorld();
  step(A.w, secs(10)); // 5 s left of the first 15 s wait
  assert.ok(A.boat.waitT > 4 && A.boat.waitT < 6, `waiting (${A.boat.waitT.toFixed(1)})`);
  const B = reload(A.boat.serialize(), A.w.time);
  near(B.boat.waitT, A.boat.waitT, 1e-9);
  step(A.w, secs(8)); step(B.w, secs(8));
  assert.ok(B.boat.x > 12, `moving after the remaining 5 s (${B.boat.x.toFixed(1)})`);
  near(B.boat.x, A.boat.x, 1e-6);
});

test('route resume after an attack: heads on toward the next point of the current leg, no re-wait', () => {
  const { w, boat } = boatWorld();
  step(w, secs(18)); // just left (10,37) heading +x; the nearest route point is still (10,37)
  const x0 = boat.x;
  assert.ok(x0 > 12 && x0 < 20, `on the leg (${x0.toFixed(1)})`);
  const gb = commando(w, 'greenberet', x0 + 12, 28);
  for (let k = 0; k < secs(2) && boat.brain.state !== 'attack'; k++) step(w);
  assert.equal(boat.brain.state, 'attack');
  gb.alive = false; // target lost (dead) → resume at once
  step(w, 2);
  assert.equal(boat.brain.state, 'route');
  assert.equal(boat.goal?.x, 40, 'resumes toward (40,37), not back to (10,37)');
  step(w, secs(4));
  assert.equal(boat.waitT <= 0, true, 'no second wait at the point it had just left');
  assert.ok(boat.x > x0 + 3, `kept going +x (${x0.toFixed(1)} → ${boat.x.toFixed(1)})`);
});

test('plane operator (§3.5/§3.7): a role:guest McRae (guestId/tag) flies the Ju 52; nobody else does', () => {
  const w = mkWorld();
  const mc = w.add(new Commando({ role: 'guest', guestId: 'mcrae', x: 10, z: 10 }));
  const mcById = w.add(new Commando({ role: 'guest', id: 'mcrae2', x: 11, z: 10 }));
  const dr = commando(w, 'driver', 12, 10), gb = commando(w, 'greenberet', 13, 10);
  const other = w.add(new Commando({ role: 'guest', guestId: 'gilbert', x: 14, z: 10 }));
  assert.equal(mc.role, 'guest'); assert.equal(mc.guestId, 'mcrae');
  const ju = w.spawnVehicle('ju52', { x: 20, z: 12 });
  assert.equal(ju.vehicleKind, 'plane');
  assert.equal(ju.canOperate(mc), true, 'McRae (guest) is the Ju 52 pilot');
  assert.equal(ju.canOperate(dr), false, 'the Driver cannot fly');
  assert.equal(ju.canOperate(gb), false);
  assert.equal(ju.canOperate(other), false, 'other guests cannot fly');
  assert.equal(ju.canOperate(mcById), false);
  // guestId falls back to the spawn id / tag
  const byTag = w.add(new Commando({ role: 'guest', id: 'mcrae', x: 15, z: 10 }));
  assert.equal(byTag.guestId, 'mcrae'); assert.equal(ju.canOperate(byTag), true);
  // a non-guest whose tag happens to be 'mcrae' is not a pilot
  const fake = w.add(new Commando({ role: 'driver', id: 'mcrae', x: 16, z: 10 }));
  assert.equal(ju.canOperate(fake), false);
  // boarding: McRae takes the controls; a passenger boarding first does not
  assert.ok(ju.enter(gb));
  assert.equal(ju.operator, null);
  assert.ok(ju.enter(mc));
  assert.equal(ju.operator, mc, 'McRae takes the controls');
  // guests do not drive land vehicles
  const kub = w.spawnVehicle('kubelwagen', { x: 30, z: 12 });
  assert.equal(kub.canOperate(mc), false);
});

test('unmannable guns (§3.4): the 210 mm mortar and the M20 anti-tank gun — and any spawn flagged unmannable — are never manned', () => {
  const w = mkWorld();
  const dr = commando(w, 'driver', 20, 20);
  for (const t of ['mortar210', 'atgunM20', 'mortar', 'atgun']) {
    const d = vehicleDef(t);
    assert.equal(d.kind, 'emplacement', t);
    assert.equal(d.unmannable, true, t);
  }
  const gunner = enemy(w, 30, 30, Math.PI, { id: 'art1' });
  const mortar = w.spawnVehicle('mortar210', { x: 30, z: 30, gunner: 'art1' });
  gunner.die('knife', null);
  assert.equal(mortar.crewed, false, 'gunner dead');
  assert.equal(mortar.canOperate(dr), false, 'the Driver cannot operate the mortar');
  assert.equal(mortar.canEnter(dr), 'this gun can never be manned');
  assert.equal(ABILITIES.enterVehicle.canUse(dr, mortar, w), "Can't get in: this gun can never be manned.");
  assert.equal(mortar.enter(dr), false);
  const at = w.spawnVehicle('atgunM20', { x: 40, z: 30 });
  assert.equal(at.canOperate(dr), false);
  assert.equal(at.canEnter(dr), 'this gun can never be manned');
  // a mission can flag any emplacement, and an ordinary cannon stays mannable by the Driver
  const flagged = w.spawnVehicle('cannon', { x: 50, z: 30, unmannable: true });
  assert.equal(flagged.canOperate(dr), false);
  assert.equal(flagged.canEnter(dr), 'this gun can never be manned');
  const cannon = w.spawnVehicle('cannon', { x: 60, z: 30 });
  assert.equal(cannon.canOperate(dr), true);
  assert.equal(cannon.canEnter(dr), true);
  assert.equal(vehicleDef('cannon').unmannable, undefined, 'the spawn flag does not leak into the registry');
});

test('placement rules (d/e): the drive probe sees a lone post anywhere across the nose and refuses eaves lower than the hull', () => {
  const w = mkWorld();
  const tk = w.spawnVehicle('panzer2', { x: 20, z: 30, heading: 0 });
  // a 0.5 m post 0.75 m off the centre line: between the old three nose samples (centre, ±1.45 m)
  w.grid.block[w.grid.idx(60, 61)] = B.HIGH; w.grid.version++; // cell x 30–30.5, z 30.5–31
  assert.ok(tk.straightReach(40, 30) < 8.5, `stops before the post (${tk.straightReach(40, 30).toFixed(2)} m)`);
  const w2 = mkWorld(), tk2 = w2.spawnVehicle('panzer2', { x: 20, z: 30, heading: 0 });
  const eaves = new Map(); for (const k of w2.grid.rectCells(30, 30, 1, 6)) eaves.set(k, [2.0, 3.5]);
  w2.grid.overStamp('cab', eaves);
  assert.ok(tk2.hullHeight() > 2.0, 'hull + turret taller than those eaves');
  assert.ok(!tk2.passableAt(30, 30) && tk2.passableAt(27, 30), 'cannot drive under eaves lower than itself');
  const high = new Map(); for (const k of w2.grid.rectCells(30, 30, 1, 6)) high.set(k, [4.5, 6]);
  w2.grid.overStamp('cab', high);
  assert.ok(tk2.passableAt(30, 30), 'a high gallery lets it through');
});
