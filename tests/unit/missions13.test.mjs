/** MISSIONS13: BEL M1–M3 data (design-spec §7.4–§7.6), schema-driven map-builder (§7.3) and test #14 (§10.5). */
import { test, assert } from './lib.mjs';
import { checkMission, loadGrid, applyIntendedAbilities } from './mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { applyShoreShallows, ringPoints, snapToSurface } from '../../src/world/map-builder.js';
import { NavGrid, T, B } from '../../src/world/grid.js';
import { findPath } from '../../src/world/pathfinding.js';
import { spawnInventory, belLoadout, firstAidCarrier, FIRST_AID_DOSES } from '../../src/items.js';
import { createVehicle, vehicleDef } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';

const at = (g, x, z) => g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));

test('campaign BEL lists m01–m03 in order after the sandbox', () => {
  assert.deepEqual(MISSIONS.slice(0, 4).map((m) => m.id), ['m00', 'm01', 'm02', 'm03']);
  assert.deepEqual(CAMPAIGNS.BEL.slice(0, 3).map((m) => m.id), ['m01', 'm02', 'm03']);
  for (const id of ['m01', 'm02', 'm03']) assert.equal(getMission(id).campaign, 'BEL');
});

for (const id of ['m01', 'm02', 'm03']) {
  test(`${id}: validates with no errors or warnings`, () => {
    const v = validateMission(getMission(id));
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
  });
  test(`${id}: §10.5 #14 — loads; starts reach every objective/extraction; no start in a cone; routes walkable`, () => {
    assert.deepEqual(checkMission(getMission(id)), []);
  });
}

test('#14 checker catches a commando placed inside a cone and a blocked route', () => {
  const def = getMission('m01');
  const bad = { ...def, commandos: [...def.commandos, { role: 'sniper', x: 8.5, z: 138, heading: 0 }] }; // ~8 m in front of e6
  assert.ok(checkMission(bad).some((p) => p.includes("inside e6's cone")));
  const bad2 = { ...def, enemies: [...def.enemies, { id: 'eX', soldierType: 'soldier', x: 5, z: 150, route: { type: 'PINGPONG', points: [{ x: 5, z: 150 }, { x: 30.5, z: 113 }] } }] };
  assert.ok(checkMission(bad2).some((p) => p.includes('eX')));
});

// §3.8 / §3.4 regression: M1/M2 Driver shipped `smg: 100` (bursts) = 500 rounds; the knapsack must show 20.
test('BEL missions: every commando spawns with its §3.8 BEL_LOADOUTS kit (SMG in bursts: 100 rounds = 20)', () => {
  CAMPAIGNS.BEL.forEach((m, i) => {
    const n = i + 1;
    const L = belLoadout(n);
    assert.ok(L, `M${n} has a BEL loadout`);
    assert.deepEqual(m.commandos.map((c) => c.role), L.team, `M${n} team`);
    // same first-aid rule as game._spawnUnits: one 6-dose kit on Driver → Spy → Sniper
    const medic = firstAidCarrier(m.commandos.map((c) => c.role));
    assert.equal(medic, L.medic, `M${n} medic`);
    for (const c of m.commandos) {
      const mine = { ...(c.inventory || {}) };
      if (c.role === medic && mine.firstAid === undefined) mine.firstAid = FIRST_AID_DOSES;
      const want = { ...L.inventories[c.role] };
      if (c.role === L.medic) want.firstAid = FIRST_AID_DOSES;
      const sort = (o) => Object.fromEntries(Object.entries(o).sort());
      assert.deepEqual(sort(spawnInventory(c.role, mine)), sort(spawnInventory(c.role, want)), `M${n} ${c.role} inventory`);
    }
    const driver = m.commandos.find((c) => c.role === 'driver');
    if (driver) assert.equal(spawnInventory('driver', driver.inventory).smg, L.inventories.driver.smg, `M${n} driver SMG bursts`);
  });
});

test('m01 header, roster and loadouts (§7.4, §3.8)', () => {
  const m = getMission('m01');
  assert.deepEqual(m.size, [65, 171]);
  assert.equal(m.par.time, 155);
  assert.equal(m.extraction, null);
  assert.equal(m.enemies.length, 13);
  assert.deepEqual(m.commandos.map((c) => c.role), ['greenberet', 'diver', 'driver']);
  assert.deepEqual(spawnInventory('diver', m.commandos[1].inventory), { knife: 1, harpoon: 1, pistol: 1, divingGear: 1 }, 'raft is on site, not packed');
  assert.equal(spawnInventory('driver', m.commandos[2].inventory).smg, 20, '§3.4: 100 rounds = 20 bursts');
  assert.ok(m.objectives[0].endsMission);
  assert.deepEqual(m.zones, []);
});

test('m01 grid: fjord isolates the peninsula; shallow rim; GB climb over wall_s', () => {
  const { grid, world } = loadGrid(getMission('m01'));
  assert.equal(grid.terrain[at(grid, 20, 70)], T.WATER);
  assert.equal(grid.terrain[at(grid, 37.2, 60.5)], T.SHALLOW, 'raft lies in the shallow rim');
  assert.equal(findPath(grid, 61, 96, 32, 101, { role: 'diver' }), null, 'peninsula only reachable across water');
  assert.ok(findPath(grid, 61, 96, 32, 101, { role: 'diver', swim: true }));
  assert.equal(grid.links.filter((l) => l.kind === 'climb').length, 2);
  assert.ok(grid.links.every((l) => l.roles.includes('greenberet') && l.roles.length === 1));
  assert.equal(grid.block[at(grid, 22, 39.5)], B.NONE, 'MG gunner stands inside the sandbag ring');
  assert.equal(world.barracks.size, 0);
});

test('m01 raft sits at the documented (37.2, 60.5) in shallow water; the old spec x 37.5 is shore snow (Appendix A)', () => {
  const def = getMission('m01');
  const raft = def.vehicles.find((v) => v.id === 'raft');
  assert.deepEqual([raft.x, raft.z], [37.2, 60.5], 'matches the §7.4 vehicle table');
  const { grid } = loadGrid(def);
  assert.equal(grid.terrain[at(grid, raft.x, raft.z)], T.SHALLOW, 'raft is in shallow water');
  assert.notEqual(grid.terrain[at(grid, 37.5, 60.5)], T.SHALLOW, 'x 37.5 is land: the reason for the Appendix A deviation');
});

test('m01 §7.4 step 2: GB carrying e7 from its post walks (no climb link) to the hiding spot N of the house', () => {
  const { world } = loadGrid(getMission('m01'));
  for (const [x, z] of [[23, 107], [30, 106]]) {
    const free = world.findPath(25.8, 121.3, x, z, { role: 'greenberet' });
    assert.ok(free && free.some((p) => p.link), `(${x},${z}) shortest route climbs when unloaded`);
    const carried = world.findPath(25.8, 121.3, x, z, { role: 'greenberet', noLinks: true });
    assert.ok(carried, `(${x},${z}) reachable on foot while carrying`);
    assert.ok(!carried.some((p) => p.link), 'no climb/ladder link in the carrying route');
  }
});

test('m02: sealed camp — gate and raised ladder; wall walk; zones → alarm; garrisons', () => {
  const ctx = loadGrid(getMission('m02'));
  const { grid, world } = ctx;
  assert.ok(Math.abs(grid.elev[at(grid, 28.5, 43.2)] - 2.2) < 1e-6, 'e5 stands on walk_sw at y 2.2');
  assert.ok(grid.elev[at(grid, 30, 20.6)] > 5, 't1 deck raised');
  const ladder = world.ladders.find((l) => l.id === 'ladder_sw');
  assert.ok(ladder && ladder.raised && !grid.links.find((l) => l.id === ladder.linkId).enabled);
  assert.equal(findPath(grid, 23, 45, 40, 30, { role: 'sniper' }), null, 'no way in while the gate is shut and the ladder up');
  assert.ok(findPath(grid, 23, 45, 40, 30, { role: 'greenberet' }), 'GB climbs the SW wall');
  applyIntendedAbilities(ctx);
  assert.ok(findPath(grid, 23, 45, 40, 30, { role: 'sniper' }), 'lowered ladder / raised barrier');
  assert.deepEqual(world.zones.map((z) => z.id), ['z_ne']);
  assert.deepEqual([...world.barracks.keys()], ['barr_camp', 'barr_out']);
  assert.equal(world.barracks.get('barr_camp').pool, 10);
  assert.deepEqual(world.jails.map((j) => j.id), ['barr_camp']);
  assert.deepEqual(getMission('m02').extraction.exit, { x: 78, z: 66, r: 4 });
});

test('m02 escape (§7.5 solution 6): one double-click drives the truck from its spot / the gate out to the exit', () => {
  const def = getMission('m02');
  const ex = def.extraction.exit;
  const [W, D] = def.size;
  // the exit circle lies inside the map with room for the truck's nose before the E edge
  const [len] = vehicleDef('truck').size;
  assert.ok(ex.x + len / 2 + 0.5 <= W && ex.z + len / 2 <= D && ex.r >= 3, 'exit inside the drivable area');
  // the sentry box stands beside T4, clear of the truck line truck-start → exit
  const sb = def.structures.find((s) => s.id === 'sbox_se');
  const tk = def.vehicles.find((v) => v.id === 'truck');
  const dx = ex.x - tk.x, dz = ex.z - tk.z, L = Math.hypot(dx, dz);
  const off = Math.abs((sb.x - tk.x) * dz - (sb.z - tk.z) * dx) / L;
  assert.ok(off > vehicleDef('truck').size[1] / 2 + Math.hypot(sb.w, sb.d) / 2 + 0.5, `sentry box off the escape line (${off.toFixed(2)} m)`);
  for (const [sx, sz] of [[tk.x, tk.z], [56, 48.8], [57.3, 49.6], [56.8, 50], [57.1, 50.2]]) {
    const ctx = loadGrid(def);
    applyIntendedAbilities(ctx); // barrier raised
    const w = ctx.world;
    w.vehicleFactory = createVehicle;
    const tr = w.spawnVehicle('truck', { x: sx, z: sz, heading: tk.heading });
    const dr = w.add(new Commando({ role: 'driver', x: sx - 3, z: sz }));
    tr.enter(dr);
    assert.ok(tr.handleOrder(dr, { type: 'move', x: ex.x, z: ex.z, run: true }), `order accepted from (${sx},${sz})`);
    for (let k = 0; k < 60 * 30 && tr.goal; k++) tr.update(1 / 60);
    const d = Math.hypot(tr.x - ex.x, tr.z - ex.z);
    assert.ok(d < ex.r, `from (${sx},${sz}) the truck reaches the exit: stopped at (${tr.x.toFixed(1)},${tr.z.toFixed(1)}), ${d.toFixed(2)} m from its centre`);
  }
});

test('m03: dam crest deck, open W gate, fence switch, items, evac truck, zones', () => {
  const { grid, world, handle, def } = loadGrid(getMission('m03'));
  assert.equal(grid.bridge[at(grid, 35, 31)], 1, 'crest is walkable');
  assert.equal(grid.block[at(grid, 4, 92)], B.NONE, 'gate_w starts open');
  assert.equal(grid.block[at(grid, 4, 70)], B.FENCE, 'station fence');
  const sw = handle.interactables.find((i) => i.tag === 'fence_switch');
  assert.ok(sw && sw.interactKind === 'switch' && sw.on);
  const bombs = handle.interactables.find((i) => i.interactKind === 'pickup' && i.itemId === 'timeBomb');
  assert.equal(bombs.count, 2);
  // §3.4/§7.6 the uniform is a clothesline device (use, 1.5 s, dressed at once), not a Hand pickup
  assert.ok(!handle.interactables.some((i) => i.interactKind === 'pickup' && i.itemId === 'uniform'), 'no uniform pickup');
  const line = handle.interactables.find((i) => i.interactKind === 'clothesline');
  assert.ok(line && line.tag === 'uniform_line' && line.count === 1, 'clothesline at the east camp');
  assert.deepEqual([line.x, line.z], [114, 82.5]);
  assert.ok(world.markers.get('dam_charge'));
  assert.deepEqual(def.extraction.spawnWhen, ['o1', 'o2']);
  assert.deepEqual(world.zones.map((z) => [z.id, z.onSeen]), [['z_camp', 'RCAMP'], ['z_south', 'RINT']]);
  assert.equal(world.barracks.size, 4);
  assert.deepEqual(def.startDisguised, []);
  assert.equal(spawnInventory('sapper', def.commandos[2].inventory).timeBomb, undefined, 'bombs are on site');
  assert.equal(def.enemies.length, 34);
});

test('map-builder: shore rim, MG ring, surface snap', () => {
  const g = new NavGrid(10, 10);
  g.fillRect(0, 0, 10, 10, 'terrain', T.WATER);
  g.fillRect(0, 0, 3, 10, 'terrain', T.GROUND);
  applyShoreShallows(g, 1.0);
  assert.equal(g.terrain[at(g, 3.25, 5)], T.SHALLOW);
  assert.equal(g.terrain[at(g, 3.75, 5)], T.SHALLOW);
  assert.equal(g.terrain[at(g, 4.75, 5)], T.WATER);
  const ring = ringPoints(5, 5, 2, 0);
  assert.ok(ring.every(([x, z]) => Math.abs(Math.hypot(x - 5, z - 5) - 2) < 1e-9));
  assert.ok(!ring.some(([x]) => x < 5 - 1.9), 'opening behind the gunner (rot 0 → open to the west)');
  const g2 = new NavGrid(10, 10);
  g2.fillRect(6, 0, 1, 10, 'block', B.HIGH);
  const p = snapToSurface(g2, 6.4, 5, 0);
  assert.ok(p && g2.walkableAt(p.x, p.z) && Math.abs(p.x - 6.4) <= 1);
  g2.fillRect(0, 0, 3, 10, 'elev', 2.2);
  const top = snapToSurface(g2, 3.3, 5, 2.2);
  assert.ok(top && top.x < 3, 'snaps onto the raised surface at its height');
});

test('m01: explicit zones: [] → no map-wide alarm fallback (§7.4 "the entire map is safe"); sandbox keeps it', () => {
  const m1 = normalizeMission(getMission('m01'), { quiet: true });
  assert.deepEqual(m1.zones, []);
  assert.equal(m1.noZonesFallback, false);
  assert.equal(normalizeMission(getMission('m00'), { quiet: true }).noZonesFallback, true);
});

test('§4.1 route waypoint `look` is authored in DEGREES (not radians) on every mission', () => {
  for (const id of ['m00', 'm01', 'm02', 'm03']) {
    const m = normalizeMission(getMission(id));
    let n = 0;
    for (const e of m.enemies) for (const p of e.route?.points ?? []) {
      if (p.look == null) continue;
      n++;
      assert.ok(p.look >= -360 && p.look <= 360, `${id} ${e.id}: look ${p.look} outside [-360, 360]`);
      assert.ok(Number.isInteger(p.look), `${id} ${e.id}: look ${p.look} looks radian-sized (non-integer degrees)`);
    }
    if (id !== 'm00') assert.ok(n > 0, `${id} has route looks to check`);
  }
  const e1 = normalizeMission(getMission('m03')).enemies.find((e) => e.id === 'e1');
  assert.ok(e1.route.points.some((p) => p.x === 62 && p.z === 13 && p.look === 180), 'm03 e1 waits at (62,13) looking W (180°)');
});
