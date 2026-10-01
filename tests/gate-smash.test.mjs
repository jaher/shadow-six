/**
 * Gate smash (design-spec §3.7 ramming addendum), browser: M2's escape truck rams gate_se at escape speed → the
 * pre-fractured gate breaks into Rapier pieces that fly, settle within ~4 s and freeze into wreckage with no piece
 * inside another, the ground or a wall; the truck keeps going and the mission completes. A slow push stops at the
 * gate and the gate holds. Screens: docs/screenshots/gate-smash-strip.jpg (8 frames, default camera) and
 * gate-smash-close.jpg (zoom 2 aftermath).
 */
import { saveJpeg } from './bodies-physics.test.mjs';
import { obbOverlap } from '../src/physics/debris.js';

/** Page side: stage M2 (depot down, every commando in the truck, guards out of the way) and ram the gate. */
async function ramScene(page, { slow = false, strip = false, close = false, exit = false } = {}) {
  return page.evaluate(async ({ slow, strip, close, exit }) => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    await g.loadMission('m02'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = { phys: !W.physics.isNull };
    const gate = W.interactables.find((i) => i.tag === 'gate_se'), truck = W.vehicles.find((v) => v.tag === 'truck');
    H.clearArea(W, gate.x, gate.z, 30);
    for (const e of W.enemies) H.freeze(e);
    // staging: no reinforcements (the crash is heard in the RINT zone; squads would come for the parked truck)
    if (!exit && W.alarm) W.alarm.fireEvent = () => {};
    // the escape run blows the depot first (o1); the others leave it (its alarm would send squads at the parked truck)
    if (exit) for (const id of ['depot_a', 'depot_b']) W.interactables.find((i) => i.tag === id)?.takeDamage(1e6, null, 'explosion');
    // its alarm squads are frozen like the garrison (this checks the smash and the drive out, not a firefight: whether
    // ~30 rounds land on the truck before it leaves the map is a coin toss of squad timing and the hull's length)
    const still = () => { if (exit) for (const e of W.enemies) if (!e.brain?.frozen) H.freeze(e); };
    const driver = W.commandos.find((c) => c.role === 'driver');
    for (const c of [driver, ...W.commandos.filter((q) => q !== driver)]) { c.setPosition(truck.x - 2.5, truck.z + 2.5); truck.enter(c); }
    out.aboard = truck.occupants.length; out.crew = W.commandos.filter((c) => c.alive).length;
    const ev = [];
    for (const n of ['gate:smash', 'gate:settled', 'gate:hold', 'gate:thud', 'mission:won', 'mission:lost', 'mission:refused'])
      G.events.on(n, (e) => ev.push({ n, t: W.time, outcome: e?.outcome ?? null }));
    g.centerOn(gate.x + 2, gate.z + 2.5);
    if (close) g.setZoom(2);
    H.run(g, G, 90, 2, still);
    for (const e of W.enemies) e.coneVisible = false;
    const S = strip ? new H.Strip(G, { cols: 4, rows: 2, cropW: 960, cropH: 600, tileW: 480, tileH: 300 }) : null;
    S?.grab('before');
    out.order = truck.handleOrder(driver, slow ? { type: 'move', x: 62, z: 55, run: false } : exit ? { type: 'move', x: 78, z: 66, run: true } : { type: 'move', x: 67.4, z: 57.6, run: true }); // past the debris field (straight line start → gate → exit)
    let smashAt = null;
    const marks = [[0, 'contact'], [0.1, 'burst'], [0.3, 'pieces in flight'], [0.6, 'in flight'], [1.4, 'landing'], [4.2, 'settled'], [7, 'aftermath']];
    const maxSpeed = [], ms = [];
    H.run(g, G, 60 * (exit ? 14 : 8), 1, () => {
      still();
      if (smashAt == null && gate.destroyed) smashAt = W.time;
      if (smashAt != null && W.time - smashAt < 5) ms.push(+W.physics._ms.toFixed(3)); // physics cost per tick from the smash on
      if (smashAt != null && marks.length && W.time - smashAt >= marks[0][0] - 1e-6) S?.grab(marks.shift()[1]);
      const pg = W.physics.gates?.byKey('gate_se');
      if (pg?.active) maxSpeed.push(Math.max(0, ...pg.bodies.filter((b) => !b.fixed).map((b) => { const v = b.body.linvel(); return Math.hypot(v.x, v.y, v.z); })));
    });
    out.truck = { x: truck.x, z: truck.z, past: (truck.x - gate.x) * Math.cos(truck.heading) + (truck.z - gate.z) * Math.sin(truck.heading) };
    const pg = W.physics.gates?.byKey('gate_se');
    out.smash = gate.smash ?? null;
    out.ev = ev.filter((e) => e.n !== 'gate:thud').map((e) => [e.n, +(e.t - (smashAt ?? 0)).toFixed(2), e.outcome]);
    out.thuds = ev.filter((e) => e.n === 'gate:thud').length;
    out.destroyed = gate.destroyed; out.state = G.state;
    out.bodies = pg ? pg.bodies.length : 0; out.hinges = pg?.hinges ?? []; out.frozen = pg ? pg.bodies.every((b) => b.fixed) : null;
    out.peakSpeed = maxSpeed.length ? Math.max(...maxSpeed) : 0;
    const D = await import('/src/physics/debris.js');
    const gy = (x, z) => (typeof W.groundY === 'function' ? W.groundY(x, z) : 0);
    out.boxes = pg ? D.pieceBoxes(pg).map((b) => ({ id: b.id, body: pg.bodies.indexOf(b.body), c: b.c, ax: b.ax, h: b.h, ground: gy(b.c.x, b.c.z),
      cell: W.grid.block[W.grid.idx(Math.floor(b.c.x / W.grid.cell), Math.floor(b.c.z / W.grid.cell))] })) : [];
    // the STATIC colliders (walls, fences, buildings: NavGrid cell boxes) near the gate, as boxes
    const ST = await import('/src/physics/statics.js'), X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
    out.statics = [];
    W.physics.rw?.forEachCollider?.((col) => {
      if (col.collisionGroups() !== ST.GROUPS.STATIC || col.shapeType() !== W.physics.R.ShapeType.Cuboid) return;
      const c = col.translation(), he = col.halfExtents();
      if (Math.abs(c.x - gate.x) > 12 + he.x || Math.abs(c.z - gate.z) > 12 + he.z) return;
      out.statics.push({ c: { x: c.x, y: c.y, z: c.z }, h: [he.x, he.y, he.z], ax: [X, Y, Z] });
    });
    out.gateBlocked = [...W.grid.owner].filter((o, k) => o === gate.owner && W.grid.block[k]).length;
    out.physMs = W.physics.stats?.().peak ?? 0;
    out.warm = [W.physics.gates?.warmPasses ?? 0, Math.round(W.physics.gates?.warmMs ?? 0)];
    out.ms = ms;
    // the truck's hull (above its ground clearance) at the end: no piece may be inside it
    const [tl, tw] = truck.def?.size || [4, 2], th = truck.heading || 0, tg = gy(truck.x, truck.z);
    out.hull = { c: { x: truck.x, y: tg + (D.HULL_CLEARANCE + 2.7) / 2, z: truck.z }, h: [tl / 2, (2.7 - D.HULL_CLEARANCE) / 2, tw / 2],
      ax: [{ x: Math.cos(th), y: 0, z: Math.sin(th) }, { x: 0, y: 1, z: 0 }, { x: -Math.sin(th), y: 0, z: Math.cos(th) }] };
    if (S) out.jpeg = S.jpeg(0.86);
    out.won = ev.some((e) => e.n === 'mission:won');
    if (close) { g.centerOn(gate.x + 3, gate.z + 3.5); G.render(0, 1); out.close = G.renderer.renderer.domElement.toDataURL('image/jpeg', 0.88); }
    return out;
  }, { slow, strip, close, exit });
}

export default async function gateSmash(page, t) {
  const r = await ramScene(page, { strip: true });
  t.log('fast ram', JSON.stringify({ ...r, jpeg: undefined, boxes: r.boxes.length }));
  if (r.jpeg) saveJpeg('gate-smash-strip.jpg', r.jpeg);
  t.ok(r.phys, 'Rapier physics on');
  t.equal(r.aboard, r.crew, 'everyone aboard the truck');
  t.ok(r.order, 'fast order through the closed gate accepted');
  t.ok(r.destroyed && r.smash && r.smash.outcome === 'shatter', `escape speed shatters the gate (${r.smash?.outcome}, J ${r.smash?.J})`);
  t.ok(r.bodies >= 12, `the gate broke into pieces (${r.bodies} bodies)`);
  t.ok(r.peakSpeed > 4, `pieces fly (peak ${r.peakSpeed.toFixed(1)} m/s)`);
  const settled = r.ev.find((e) => e[0] === 'gate:settled');
  t.ok(settled && settled[1] <= 4.5, `pieces settle within ~4 s (${settled?.[1]} s)`);
  t.ok(r.frozen, 'every piece frozen into static wreckage');
  t.ok(r.thuds > 0, `landing thuds (${r.thuds})`);
  t.equal(r.gateBlocked, 0, 'the gap is passable (gate cells clear)');
  t.ok(r.truck.past > 3, `the truck drove on through the gap (${r.truck.past.toFixed(1)} m past)`);
  // the real escape: one double-click from the start drives through the gate and out along the T4 road
  const x = await ramScene(page, { exit: true });
  t.log('escape', JSON.stringify({ ev: x.ev, state: x.state, smash: x.smash?.outcome }));
  t.ok(x.destroyed && x.won, `the truck smashes through and the mission completes (${x.state})`);
  // no debris interpenetration after settle: pieces vs pieces, the ground, walls
  let worst = 0;
  for (let i = 0; i < r.boxes.length; i++) for (let j = i + 1; j < r.boxes.length; j++) {
    if (r.boxes[i].body !== r.boxes[j].body) worst = Math.max(worst, obbOverlap(r.boxes[i], r.boxes[j]));
  }
  t.ok(worst < 0.05, `no piece inside another (max overlap ${(worst * 100).toFixed(1)} cm)`);
  // lowest corner of each piece box vs the ground under its centre (a box resting on the ground: ≈ 0)
  const low = r.boxes.map((b) => b.c.y - b.h.reduce((s, h, i) => s + h * Math.abs(b.ax[i].y), 0) - b.ground).reduce((a, b) => Math.min(a, b), 9);
  t.ok(low > -0.03, `no piece sunk into the ground (lowest corner ${(low * 100).toFixed(1)} cm)`);
  const inTruck = r.boxes.reduce((m, b) => Math.max(m, obbOverlap(b, r.hull)), 0);
  t.ok(inTruck < 0.03, `no piece inside the truck (max overlap ${(inTruck * 100).toFixed(1)} cm)`);
  // walls exactly: no piece inside a STATIC collider (wall / fence / building cell box) by more than 3 cm
  let wallDepth = [0, ''];
  for (const b of r.boxes) for (const st of r.statics) { const o = obbOverlap(b, st); if (o > wallDepth[0]) wallDepth = [o, b.id]; }
  t.ok(r.statics.length > 0 && wallDepth[0] < 0.03, `no piece inside a wall collider (${r.statics.length} near the gate; max ${(wallDepth[0] * 100).toFixed(1)} cm ${wallDepth[1]})`);
  t.log('wreckage', JSON.stringify({ bodies: r.bodies, hinges: r.hinges, wallCm: +(wallDepth[0] * 100).toFixed(1), truckCm: +(inTruck * 100).toFixed(1), lowCm: +(low * 100).toFixed(1), worstCm: +(worst * 100).toFixed(1) }));
  const inWall = r.boxes.filter((b) => b.cell === 2 || b.cell === 3);
  t.ok(!inWall.length, `no piece centre inside a wall / fence cell (${inWall.map((b) => `${b.id}@${b.c.x.toFixed(2)},${b.c.y.toFixed(2)},${b.c.z.toFixed(2)}`).join(' ')})`);

  const c = await ramScene(page, { close: true });
  if (c.close) saveJpeg('gate-smash-close.jpg', c.close);
  t.ok(c.destroyed, 'close-up run broke the gate too');
  // break physics budget (< 2 ms a tick): the two identical rams give the same physics, so the per-tick minimum of the
  // two drops one-off stalls of a shared machine (preemption, GC) but keeps any real cost
  const n = Math.min(r.ms.length, c.ms.length), best = Array.from({ length: n }, (_, i) => Math.min(r.ms[i], c.ms[i]));
  const peak = Math.max(...best), at = best.indexOf(peak), p95 = [...best].sort((a, b) => a - b)[Math.floor(n * 0.95)];
  t.log('physics ms/tick', JSON.stringify({ peak, at, p95, rawPeaks: [Math.max(...r.ms), Math.max(...c.ms)], rawAt: [r.ms.indexOf(Math.max(...r.ms)), c.ms.indexOf(Math.max(...c.ms))], warm: [r.warm, c.warm] }));
  t.ok(n > 60 && peak < 2, `break physics under 2 ms a tick (peak ${peak.toFixed(2)} ms at tick ${at}, p95 ${p95?.toFixed(2)})`);
  // the page's FIRST smash (cold JIT; the load-time warm-up absorbs Chrome's deopt of Rapier's step): the break tick
  // and the first steps of the pieces stay in budget too
  const first = Math.max(...r.ms.slice(0, 3));
  t.ok(first < 2, `first smash in a fresh page: break + first steps ${r.ms.slice(0, 3).join(' / ')} ms (< 2)`);

  const s = await ramScene(page, { slow: true });
  t.log('slow push', JSON.stringify({ ...s, jpeg: undefined, boxes: s.boxes.length }));
  t.ok(!s.destroyed, 'a slow truck does not break the gate');
  t.ok(s.truck.past < 0, `the slow truck stops before the gate (${s.truck.past.toFixed(2)} m)`);
  t.ok(s.gateBlocked > 0, 'the gate still blocks');
  t.ok(s.ev.some((e) => e[0] === 'gate:hold'), 'the gate bows and holds (gate:hold)');
}
