/**
 * Regression tests for playtest replay findings, round 1 (m01–m03 scripted playthroughs).
 */
import { test, assert } from './lib.mjs';
import { makeWorld as mk, addCommando, run, DT } from './ai-harness.mjs';
import { Entity } from '../../src/entities/entity.js';
import { Trap, Decoy } from '../../src/abilities/charges.js';
import { restoreWorld } from '../../src/save.js';
import { T } from '../../src/world/grid.js';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';

const makeWorld = (m = {}) => { Entity.nextId = 1; return mk(m); };
const MISSION = { enemies: [{ id: 'g1', soldierType: 'soldier', x: 60, z: 60, heading: 0 }] };

/** Save like save.js snapshot() (world + id counter), then rebuild the mission and restore. */
function saveLoad(w, { withNextId = true } = {}) {
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), ...(withNextId ? { nextId: Entity.nextId } : {}) }));
  const w2 = makeWorld(MISSION);
  addCommando(w2, 'sapper', 10, 10);
  restoreWorld(w2, S);
  return w2;
}

for (const withNextId of [true, false]) {
  test(`m02 save/load: entities spawned during play keep unique ids after a load (${withNextId ? 'new' : 'old'} save)`, () => {
    const w = makeWorld(MISSION);
    addCommando(w, 'sapper', 10, 10);
    const t1 = w.add(new Trap({ x: 20, z: 20 })) || w.entities.at(-1);
    // spent entities (projectiles, blown charges …) leave gaps in the numbering, as in a real run
    for (let i = 0; i < 5; i++) { const tmp = new Trap({ x: 30, z: 30 }); w.add(tmp); w.remove(tmp); }
    const t2 = w.add(new Trap({ x: 22, z: 20 })) || w.entities.at(-1);
    assert.notEqual(t1.id, t2.id);
    const w2 = saveLoad(w, { withNextId });
    assert.equal(w2.byId(t1.id)?.interactKind, 'trap', 'first trap restored under its id');
    assert.equal(w2.byId(t2.id)?.interactKind, 'trap', 'second trap restored under its id');
    const t3 = new Trap({ x: 24, z: 20 });
    w2.add(t3);
    const ids = w2.entities.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids after load: ${ids}`);
    assert.ok(t3.id > t2.id, `new spawn id ${t3.id} must be past the restored ${t2.id}`);
  });
}

test('m02: enterVehicle from the wall walk (walk_sw) comes down plat_sw\'s stair and boards the truck', () => {
  const s = makeSim(getMission('m02'), { brains: false });
  const w = s.world, sn = s.cmd('sniper'), truck = s.get('truck');
  for (const e of [...w.enemies]) w.remove(e); // no interference
  w.flushRemovals();
  Object.assign(sn, { x: 26.3, z: 40.9, y: 2.2, path: null });
  sn.setStance('crawl');
  s.run(1);
  assert.ok(sn.y > 2, 'starts up on the walk');
  assert.ok(sn.useAbility('enterVehicle', truck), 'order accepted');
  // (≈26 s: a crawl to the truck's driver door; the stairs are crawled at the stair pace, world/stairs.js STAIR_PACE)
  const boarded = s.run(30, () => sn.state === 'inVehicle');
  assert.ok(boarded, `sniper never boarded (at ${sn.x.toFixed(1)},${sn.z.toFixed(1)} y${sn.y.toFixed(1)}, pending ${!!sn.pendingAbility})`);
});

/** World + commandos rebuilt identically (as loadMission), then the saved state restored (save.js restoreWorld). */
function reloadInto(w, build) {
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), nextId: Entity.nextId, ai: w.ai?.serialize?.() ?? null }));
  const w2 = build();
  restoreWorld(w2, S);
  return w2;
}

test('m03 save/load: the Green Beret still owns his planted decoy (toggle / pick up after a load)', () => {
  const def = { commandos: [{ role: 'greenberet', x: 10, z: 10 }] };
  const build = () => { Entity.nextId = 1; return makeSim(def).world; };
  Entity.nextId = 1;
  const s0 = makeSim(def);
  const gb = s0.cmd('greenberet');
  assert.ok(gb.useAbility('decoyDrop', null), 'plant');
  s0.run(1.5);
  const decoy = s0.world.interactables.find((d) => d.interactKind === 'decoy');
  assert.ok(decoy, 'decoy planted');
  const w2 = reloadInto(s0.world, build);
  const gb2 = w2.commandos.find((c) => c.role === 'greenberet');
  const d2 = w2.interactables.find((d) => d.interactKind === 'decoy');
  assert.ok(d2 && d2.planter === gb2, 'planter re-linked');
  const msgs = [];
  w2.events.on('message', (m) => msgs.push(m.text));
  assert.ok(gb2.useAbility('decoyToggle', null), `toggle refused: ${msgs.join(' | ')}`);
});

const SPY_MISSION = { enemies: [{ id: 'g', soldierType: 'sentry', x: 30, z: 40, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } }] };
function spyWorld() {
  const w = makeWorld(SPY_MISSION);
  const spy = addCommando(w, 'spy', 26, 40);
  spy.setDisguise ? spy.setDisguise(true) : (spy.disguised = true);
  return w;
}

test('m03 save/load: a distraction in progress survives a load and ends when the Spy walks away', () => {
  const w = spyWorld();
  const g = w.byId('g'), spy = w.commandos[0];
  run(w, 0.5);
  assert.ok(spy.useAbility('distract', g), 'distract ordered');
  run(w, 6, () => g.brainState === 'DISTRACTED' && spy.currentActionId === 'distract');
  assert.equal(g.brainState, 'DISTRACTED');
  const w2 = reloadInto(w, spyWorld);
  const g2 = w2.byId('g'), spy2 = w2.commandos[0];
  assert.equal(g2.brainState, 'DISTRACTED', 'still distracted after the load');
  assert.equal(spy2.currentActionId, 'distract', 'the Spy is still talking');
  assert.ok(g2._distractedBy === spy2, 'distraction link restored');
  run(w2, 2);
  assert.equal(g2.brainState, 'DISTRACTED', 'holds while the Spy stays');
  assert.ok(spy2.issue({ type: 'move', x: 12, z: 40 }), 'move order');
  run(w2, 6);
  assert.notEqual(g2.brainState, 'DISTRACTED', 'released once the Spy walked off');
});

const TRACK_MISSION = { enemies: [{ id: 't', soldierType: 'soldier', x: 30, z: 40, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } }] };
/** A 14 m trail walked west away from the guard (owner 999, newest print at the far end). */
function laidTrail(w) {
  const fp = w.ai.footprints;
  let t = w.time - 20;
  for (let x = 24; x >= 10; x -= 0.75) fp.add({ x, z: 40, heading: Math.PI, t: (t += 0.5), ownerId: 999, aiVisible: true });
}
const trackStarts = (w) => w.log.filter((l) => l.type === 'enemy:state' && l.p.to === 'TRACKS').length;

test('m03 TRACKS: a tracker returning along the trail he followed does not start following it again', () => {
  const w = makeWorld(TRACK_MISSION);
  run(w, 0.2);
  laidTrail(w);
  const g = w.byId('t');
  const started = run(w, 5, () => g.brainState === 'TRACKS');
  assert.equal(g.brainState, 'TRACKS', `never tracked (took ${started})`);
  run(w, 40, () => g.brainState === 'RETURN');
  assert.equal(g.brainState, 'RETURN', 'followed the trail, looked, returns');
  const n = trackStarts(w);
  run(w, 30);
  assert.equal(trackStarts(w), n, 'no re-follow of the same (older) prints while returning');
  // a fresher print of that owner (he walked again) does start a new TRACKS (old prints cleared: the §4.3
  // seen list is capped at 16 objects and the old trail would fill it)
  w.ai.footprints.deserialize([]);
  w.ai.footprints.add({ x: g.x + Math.cos(g.heading) * 4, z: g.z + Math.sin(g.heading) * 4, heading: 0, t: w.time, ownerId: 999, aiVisible: true });
  run(w, 2);
  assert.equal(trackStarts(w), n + 1, `a fresh print of the same man is followed (${g.brainState} ${g.x.toFixed(1)},${g.z.toFixed(1)} h${g.heading.toFixed(2)})`);
});

test('m03 save/load: a tracker mid-TRACKS keeps following the same trail after a load (prints saved with ids)', () => {
  const w = makeWorld(TRACK_MISSION);
  run(w, 0.2);
  laidTrail(w);
  const g = w.byId('t');
  run(w, 5, () => g.brainState === 'TRACKS');
  run(w, 2);
  assert.equal(g.brainState, 'TRACKS');
  const w2 = reloadInto(w, () => makeWorld(TRACK_MISSION));
  const g2 = w2.byId('t');
  assert.equal(w2.ai.footprints.list.length, w.ai.footprints.list.length, 'prints restored');
  assert.equal(g2.brain.goal?.print?.id, g.brain.goal.print.id, 'print re-linked');
  for (let i = 0; i < 16; i++) {
    run(w, 0.5); run(w2, 0.5);
    assert.equal(g2.brainState, g.brainState, `state diverged at +${(i + 1) * 0.5} s`);
    assert.ok(Math.hypot(g2.x - g.x, g2.z - g.z) < 1e-6, `position diverged at +${(i + 1) * 0.5} s`);
  }
});

test('m01 e13: an MG gunner turning to a noise stays inside his gun traverse (post.giro 180 around 90°)', () => {
  Entity.nextId = 1;
  const s = makeSim(getMission('m01'));
  const w = s.world, e = s.get('e13');
  s.run(0.5);
  const DEG = 180 / Math.PI;
  const within = () => {
    const d = ((e.heading * DEG - 90 + 540) % 360) - 180;
    return Math.abs(d) <= 90 + 1e-3;
  };
  w.emitNoise(40, 10, 60, 'explosion', null, 3); // north-east, behind the nest (≈ -59°)
  for (let i = 0; i < 20; i++) { s.run(0.25); assert.ok(within(), `heading ${(e.heading * DEG).toFixed(0)}° outside the traverse`); }
  assert.ok(Math.abs(e.heading) < 0.02, 'turned as far as the gun goes (0°)');
  s.run(10);
  w.emitNoise(10, 50, 60, 'explosion', null, 3); // south-west, inside the traverse
  for (let i = 0; i < 6; i++) { s.run(0.25); assert.ok(within(), `heading ${(e.heading * DEG).toFixed(0)}° outside the traverse`); } // (a smooth turn)
  const want = Math.atan2(50 - e.z, 10 - e.x);
  assert.ok(Math.abs(((e.heading - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.02, 'faces a noise inside the traverse');
});

test('m01: a guard killed by the barrel a pistol shot sets off never reacts to that shot (no same-tick spotted)', async () => {
  const { Barrel } = await import('../../src/entities/interactables.js');
  await import('../../src/abilities/index.js');
  // the guard faces the prone Driver 9.9 m off: beyond the calm near band, inside the alerted one (replay e11)
  const w = makeWorld({ enemies: [{ id: 'g', soldierType: 'soldier', x: 20, z: 20, heading: 0, post: { heading: 0, sweep: 0 } }] });
  const b = new Barrel({ x: 21, z: 20.5 });
  w.add(b);
  const dr = addCommando(w, 'driver', 29.9, 20, Math.PI);
  dr.setStance('crawl');
  run(w, 1);
  assert.equal(w.byId('g').brainState, 'IDLE', 'the Driver is unseen before the shot');
  const log = [];
  for (const t of ['enemy:spotted', 'ui:warning', 'unit:killed', 'explosion']) w.events.on(t, () => log.push(t));
  w.events.on('noise', (n) => log.push(`noise:${n.kind}`));
  assert.ok(dr.useAbility('pistol', b), 'shot ordered');
  // Game.step order, interactables included (commandos → enemies → BEL → vehicles → projectiles → interactables)
  for (let i = 0; i < 120 && w.byId('g')?.alive; i++) {
    w.rebuildSpatial(); w.refreshDynamicOccluders();
    for (const list of [w.commandos, w.enemies]) for (const e of [...list]) if (!e.removed) e.update(DT);
    w.runBelTicks(DT);
    for (const list of [w.vehicles, w.projectiles, w.interactables]) for (const e of [...list]) if (!e.removed) e.update(DT);
    w.alarm.update(DT); w.flushRemovals(); w.time += DT; w.tick++;
  }
  assert.ok(b.exploded, 'barrel went off');
  assert.equal(w.byId('g').alive, false, 'guard killed by the blast');
  assert.ok(!log.includes('enemy:spotted'), `no spotted event: ${log.join(',')}`);
  // the blast is resolved inside the shot, before the pistol's noise reaches anyone's ears
  assert.ok(log.indexOf('explosion') >= 0 && log.indexOf('explosion') < log.indexOf('noise:pistol'), `order: ${log.join(',')}`);
  assert.ok(log.indexOf('unit:killed') < log.indexOf('noise:pistol'), `guard dead before the shot is heard: ${log.join(',')}`);
});

test('m03 dam: once destroyed the crest (and the flooded toe ledge) no longer joins the banks — also after a load', () => {
  const build = () => { Entity.nextId = 1; return makeSim(getMission('m03'), { brains: false }); };
  const s = build(), w = s.world;
  const SW = [22, 41], NE = [60, 35]; // the feet of the W and E crest stairs
  assert.ok(w.findPath(...SW, ...NE, { role: 'greenberet' }), 'the crest is walkable before');
  const e = w.enemies.find((q) => q.alive);
  Object.assign(e, { x: 40.2, z: 22.2, y: 7 }); // a soldier standing on the (raised) crest
  w.byId('dam').destroy(null, 'bomb');
  assert.equal(w.grid.walkableAt(40, 22), false, 'crest cell');
  assert.equal(w.findPath(...SW, ...NE, { role: 'greenberet' }), null, 'no walking route between the banks');
  assert.equal(e.alive, false, 'a man on the crest goes down with it');
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), nextId: Entity.nextId }));
  const w2 = build().world;
  restoreWorld(w2, S);
  assert.equal(w2.byId('dam').destroyed, true);
  assert.equal(w2.findPath(...SW, ...NE, { role: 'greenberet' }), null, 'still split after a load');
});

test('m03 e34: the dam bunker crew sees out of his own bunker (LOS and drawn cone start at the slit)', async () => {
  const { canSee, coneAt } = await import('../../src/ai/perception.js');
  const { coneFan } = await import('../../src/render/vision-cone.js');
  Entity.nextId = 1;
  const s = makeSim(getMission('m03'), { brains: false });
  const w = s.world, e = s.get('e34');
  Object.assign(e, { headOffset: 0, sweepActive: false });
  const cone = coneAt(e, w.time);
  const tx = e.x + Math.cos(cone.heading) * 11, tz = e.z + Math.sin(cone.heading) * 11;
  const target = { x: tx, z: tz, y: 0, isLow: false, isVisibleToEnemies: true, kind: 'commando', alive: true };
  assert.notEqual(canSee(e, target, w), 'none', `standing man 11 m ahead of e34 at (${tx.toFixed(1)},${tz.toFixed(1)})`);
  const fan = coneFan(e, w.grid, { t: w.time });
  const mid = fan.dists[Math.floor(fan.dists.length / 2)];
  assert.ok(mid > 10, `drawn cone reaches out of the bunker (mid ray ${mid.toFixed(1)} m)`);
});

test('m03 raft: an unaligned raft turns round (160°) in well under 2 s and clears a 10 s fuse\'s 6.75 m blast', async () => {
  const { vehicleDef } = await import('../../src/entities/vehicle.js');
  const turn = vehicleDef('raft').turn * 180 / Math.PI;
  assert.ok(turn >= 90, `raft turn ${turn}°/s`);
  // the finding: heading -125° → +35° (160°) took 3.6 s at 45°/s
  const s = makeSim({ size: [60, 60], terrain: [{ type: 'rect', terrain: 'water', x: 10, z: 10, w: 40, d: 40 }], commandos: [{ role: 'diver', x: 30, z: 30 }] });
  const w = s.world, ma = s.cmd('diver');
  const raft = w.spawnVehicle('raft', { x: 30, z: 30, heading: -125 * Math.PI / 180 });
  assert.ok(raft.enter(ma), 'Marine aboard');
  const tx = 30 + Math.cos(35 * Math.PI / 180) * 20, tz = 30 + Math.sin(35 * Math.PI / 180) * 20;
  assert.ok(raft.driveTo(tx, tz, true), 'drive order');
  let t = 0;
  while (t < 10 && Math.hypot(raft.x - 30, raft.z - 30) < 6.75) { s.step(1 / 60); t += 1 / 60; }
  assert.ok(t < 4, `out of the lethal radius after ${t.toFixed(2)} s`);
});

test('§4.8 the disguised Spy leaves visual-only prints (no TRACKS); out of uniform they are AI-visible', () => {
  const w = makeWorld();
  w.grid.terrain.fill(T.SNOW);
  const spy = addCommando(w, 'spy', 20, 20);
  spy.setDisguise(true);
  spy.moveTo(30, 20);
  run(w, 4);
  const mine = () => w.ai.footprints.list.filter((p) => p.ownerId === spy.id);
  assert.ok(mine().length >= 3, `prints stamped (${mine().length})`);
  assert.ok(mine().every((p) => !p.aiVisible), 'uniformed prints are visual only');
  spy.setDisguise(false);
  const n = mine().length;
  spy.moveTo(20, 20);
  run(w, 4);
  assert.ok(mine().slice(n).length >= 3 && mine().slice(n).every((p) => p.aiVisible), 'plain clothes: AI-visible again');
});
