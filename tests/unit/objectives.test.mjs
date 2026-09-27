import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { createObjectives, checkObjectives, revealObjective, extractionStatus, skipExtractionDrive, updateExtractionVehicle } from '../../src/core/objectives.js';

let nid = 1000;
const mk = (w, kind, x, z, extra = {}) => w.add({ id: nid++, kind, x, z, alive: true, ...extra });

function setup(defs, mission = {}) {
  const w = new World({ size: [60, 60], mission });
  w.objectives = createObjectives(defs);
  const events = [];
  w.listen('objective:update', (p) => events.push(p.objective.id));
  return { w, events };
}

test('destroy + kill objectives complete when targets are gone', () => {
  const { w, events } = setup([
    { id: 'o1', type: 'destroy', targets: ['tank'] },
    { id: 'o2', type: 'kill', targets: ['general'] },
  ]);
  const tank = mk(w, 'vehicle', 10, 10, { tag: 'tank', hp: 100 });
  const gen = mk(w, 'enemy', 20, 20, { tag: 'general' });
  let r = checkObjectives(w);
  assert.equal(r.won, false);
  tank.destroyed = true;
  gen.alive = false;
  r = checkObjectives(w);
  assert.equal(r.won, true);
  assert.deepEqual(events.sort(), ['o1', 'o2']);
  assert.equal(checkObjectives(w).changed.length, 0, 'no repeat events');
});

test('escape waits for other required objectives, then needs every living commando in zone', () => {
  const { w } = setup([
    { id: 'esc', type: 'escape' },
    { id: 'k', type: 'kill', targets: ['g'] },
  ], { extraction: { x: 50, z: 50, r: 4 } });
  const a = mk(w, 'commando', 50, 50, { role: 'greenberet' });
  const b = mk(w, 'commando', 10, 10, { role: 'sapper' });
  const g = mk(w, 'enemy', 5, 5, { tag: 'g' });
  assert.equal(checkObjectives(w).won, false);
  g.alive = false;
  let r = checkObjectives(w);
  assert.equal(w.objectives[0].done, false, 'sapper not at extraction');
  b.x = 51; b.z = 49;
  r = checkObjectives(w);
  assert.equal(r.won, true);
  assert.ok(a);
});

test('rescue fails if the prisoner dies; reach completes for any commando', () => {
  const { w } = setup([
    { id: 'r', type: 'rescue', targets: ['p'], zone: { x: 5, z: 5, r: 3 } },
    { id: 'reach', type: 'reach', zone: { x: 30, z: 30, r: 2 }, required: false },
  ]);
  const p = mk(w, 'enemy', 40, 40, { tag: 'p' });
  mk(w, 'commando', 30.5, 30, { role: 'spy' });
  let r = checkObjectives(w);
  assert.equal(w.objectives[1].done, true);
  p.alive = false;
  r = checkObjectives(w);
  assert.equal(r.lost, true);
  assert.equal(w.objectives[0].failed, true);
});

test('steal completes when a commando drives the target; survive by time; reveal', () => {
  const { w } = setup([
    { id: 's', type: 'steal', targets: ['truck'] },
    { id: 'sv', type: 'survive', duration: 60, hidden: true },
  ]);
  const c = mk(w, 'commando', 1, 1, { role: 'driver' });
  const truck = mk(w, 'vehicle', 2, 2, { tag: 'truck' });
  checkObjectives(w);
  assert.equal(w.objectives[0].done, false);
  truck.driver = c;
  w.time = 61;
  assert.equal(checkObjectives(w).won, true);
  assert.equal(revealObjective(w, 'sv').hidden, false);
});

// §8.1 / §7.5 M2: vehicle extraction counts only once the truck passes `exit` (or drives off the map)
function truckSetup() {
  const { w } = setup([
    { id: 'o1', type: 'destroy', targets: ['depot'] },
    { id: 'o2', type: 'escape' },
  ], { extraction: { vehicleId: 'truck', exit: { x: 55, z: 50, r: 3 } } });
  const truck = mk(w, 'vehicle', 20, 20, { tag: 'truck', occupants: [] });
  const depot = mk(w, 'prop', 30, 30, { tag: 'depot' });
  const men = [mk(w, 'commando', 20, 20, { role: 'greenberet' }), mk(w, 'commando', 20, 20, { role: 'sapper' })];
  for (const c of men) { c.vehicle = truck; c.state = 'inVehicle'; truck.occupants.push(c); }
  return { w, truck, depot, men };
}

test('vehicle extraction: everyone aboard a parked truck is neither escaped nor a win', () => {
  const { w, depot } = truckSetup();
  let s = extractionStatus(w);
  assert.equal(s.escaped, 0, 'aboard a parked truck is not escaped');
  assert.equal(s.allEscaped, false, 'no escaped-early dialog while parked');
  depot.destroyed = true;
  const r = checkObjectives(w);
  assert.equal(r.won, false, 'no win with the truck still inside the camp');
  assert.equal(w.objectives[1].done, false);
});

test('vehicle extraction: win once the loaded truck passes the exit, latched after it rolls on', () => {
  const { w, truck, depot } = truckSetup();
  truck.x = 54; truck.z = 51; // inside exit r=3, bomb still ticking
  let s = extractionStatus(w);
  assert.equal(s.allEscaped, true, 'escaped-early state once the truck is at the exit');
  assert.equal(s.othersDone, false);
  assert.equal(checkObjectives(w).won, false, 'o1 still pending');
  truck.x = 58.5; truck.z = 54; // Continue: drove on past the exit
  depot.destroyed = true;
  assert.equal(checkObjectives(w).won, true, 'win after the truck passed the exit');
});

test('vehicle extraction: an empty truck on the exit does not extract; driving off the map edge does', () => {
  const { w, truck, men } = truckSetup();
  for (const c of men) { c.vehicle = null; c.state = 'idle'; }
  truck.occupants.length = 0;
  truck.x = 55; truck.z = 50;
  assert.equal(extractionStatus(w).escaped, 0, 'nobody aboard');
  truck.x = 30; truck.z = 30;
  assert.equal(truck.passedExit, undefined, 'no latch without men aboard');
  for (const c of men) { c.vehicle = truck; c.state = 'inVehicle'; truck.occupants.push(c); }
  assert.equal(extractionStatus(w).escaped, 0, 'loaded but parked');
  truck.x = 30; truck.z = -2; // off the map (size 60x60)
  assert.equal(extractionStatus(w).allEscaped, true, 'drove off the edge');
});

test('§7.6 scripted escape vehicle: spawns once when spawnWhen is done, arrives, leaves when all aboard', () => {
  const mission = { extraction: {
    vehicleId: 'evac_truck', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o1', 'o2'],
    spawnAt: { x: 30, z: -6, heading: Math.PI / 2 }, arrive: { x: 30, z: 12, speed: 6 }, exit: { x: 30, z: 0, r: 3 },
  } };
  const { w } = setup([
    { id: 'o1', type: 'destroy', targets: ['a'] }, { id: 'o2', type: 'destroy', targets: ['b'] },
    { id: 'o3', type: 'escape', vehicleId: 'evac_truck' },
  ], mission);
  const spawns = [];
  w.vehicleFactory = (s) => {
    spawns.push(s);
    return { id: nid++, kind: 'vehicle', tag: s.id, x: s.x, z: s.z, occupants: [], goal: null, path: null,
      followPath(pts, o) { this.route = pts; this.speed = o.speed; this.goal = pts[0]; this.path = pts; return true; } };
  };
  const men = [mk(w, 'commando', 5, 5), mk(w, 'commando', 6, 5)];
  const flags = {};
  w.objectives[0].done = true;
  assert.equal(updateExtractionVehicle(w, flags), null, 'o1 alone: nothing');
  w.objectives[1].done = true;
  const v = updateExtractionVehicle(w, flags);
  assert.ok(v && w.byId('evac_truck') === v, 'spawned with the extraction id');
  assert.deepEqual([spawns[0].vehicleType, spawns[0].x, spawns[0].z, spawns[0].seats, spawns[0].friendly], ['truck', 30, -6, 6, true]);
  assert.deepEqual(v.route, [{ x: 30, z: 12 }]);
  assert.equal(v.speed, 6);
  assert.equal(v.offMapOK, true, 'may drive in from beyond the map edge');
  assert.equal(flags.evacSpawned, true);
  // arrival → wait; not everyone aboard → stays
  v.goal = null; v.path = null; v.x = 30; v.z = 12;
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'wait');
  men[0].vehicle = v; v.occupants.push(men[0]);
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'wait', 'one man still on foot');
  men[1].vehicle = v; v.occupants.push(men[1]);
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'leave');
  assert.deepEqual(v.route, [{ x: 30, z: 0 }, { x: 30, z: -12 }], 'through the exit, then off north');
  // latched: a destroyed + removed truck never respawns
  w.remove?.(v); v.removed = true;
  w._byId?.delete?.(v.id);
  updateExtractionVehicle(w, flags);
  assert.equal(spawns.length, 1, 'no second spawn');
});

test('§7.6 scripted escape vehicle: no-op for zone extraction and for a vehicle placed by the mission', () => {
  const { w } = setup([{ id: 'o1', type: 'escape' }], { extraction: { x: 5, z: 5, r: 3 } });
  assert.equal(updateExtractionVehicle(w, {}), null);
  const m2 = setup([{ id: 'o1', type: 'escape' }], { extraction: { vehicleId: 'truck', exit: { x: 1, z: 1, r: 3 }, spawnWhen: [] } });
  m2.w.vehicleFactory = () => { throw new Error('must not spawn'); };
  assert.equal(updateExtractionVehicle(m2.w, {}), null);
});

function evacSetup() {
  const mission = { extraction: {
    vehicleId: 'evac_truck', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o1', 'o2'],
    spawnAt: { x: 30, z: -6, heading: Math.PI / 2 }, arrive: { x: 30, z: 12, speed: 6 }, exit: { x: 30, z: 0, r: 3 },
  } };
  const { w } = setup([
    { id: 'o1', type: 'destroy', targets: ['a'] }, { id: 'o2', type: 'destroy', targets: ['b'] },
    { id: 'o3', type: 'escape', vehicleId: 'evac_truck' },
  ], mission);
  w.vehicleFactory = () => { throw new Error('must not spawn a second truck'); };
  // a truck already on the map (spawned by hand / placed), parked at the arrive point
  const v = mk(w, 'vehicle', 30, 12, { tag: 'evac_truck' }); // tagged before add: World indexes tags on add
  v.occupants = []; v.goal = null; v.path = null;
  v.followPath = function (pts, o) { this.route = pts; this.speed = o.speed; this.goal = pts[0]; this.path = pts; return true; };
  const men = [mk(w, 'commando', 5, 5), mk(w, 'commando', 6, 5)];
  const board = () => { for (const c of men) { c.vehicle = v; c.state = 'inVehicle'; v.occupants.push(c); } };
  return { w, v, men, board };
}

test('§7.6 regression: a hand-spawned escape truck is adopted, waits, and drives off north — boarding alone never wins', () => {
  const { w, v, board } = evacSetup();
  const flags = {};
  w.objectives[0].done = true; w.objectives[1].done = true;
  assert.equal(updateExtractionVehicle(w, flags), v);
  assert.equal(flags.evacSpawned, true, 'adopted');
  assert.equal(flags.evacPhase, 'wait');
  board();
  assert.equal(checkObjectives(w).won, false, 'the last man boarding does not win by itself');
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'leave', 'all aboard → drives off');
  assert.deepEqual(v.route, [{ x: 30, z: 0 }, { x: 30, z: -12 }], 'through the exit, then off north');
  assert.equal(checkObjectives(w).won, false, 'still parked at the arrive point');
  v.x = 30; v.z = 1; // reached the exit (r 3)
  assert.equal(checkObjectives(w).won, true, 'o3 done once the truck reaches the exit');
});

test('§7.6 regression: an adopted truck does not leave before spawnWhen is done', () => {
  const { w, v, board } = evacSetup();
  const flags = {};
  updateExtractionVehicle(w, flags);
  board();
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'wait', 'o1/o2 open: keep waiting');
  w.objectives[0].done = true; w.objectives[1].done = true;
  updateExtractionVehicle(w, flags);
  assert.equal(flags.evacPhase, 'leave');
});

test('§7.6 ESC skips the drive-off: escape completes immediately; no-op outside the leave phase', () => {
  const { w, v, board } = evacSetup();
  const flags = {};
  w.objectives[0].done = true; w.objectives[1].done = true;
  updateExtractionVehicle(w, flags);
  assert.equal(skipExtractionDrive(w, flags), false, 'waiting: ESC is not a skip');
  board();
  updateExtractionVehicle(w, flags);
  assert.equal(checkObjectives(w).won, false);
  assert.equal(skipExtractionDrive(w, flags), true);
  assert.equal(checkObjectives(w).won, true, 'skipped → escaped');
  assert.equal(skipExtractionDrive(w, flags), false, 'only once');
});
