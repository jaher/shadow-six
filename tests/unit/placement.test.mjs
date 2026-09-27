/**
 * Placement rules against object interpenetration (src/world/placement.js, placement-geom.js; user report
 * "be careful with objects crossing other objects, e.g. turrets crossing a fence"): one test per rule.
 */
import { test, assert } from './lib.mjs';
import { clipPolyline, rectPoly, polyDist, inflatePoly, polysOverlap } from '../../src/world/placement-geom.js';
import {
  resolvePlacement, chainRuns, structureRecords, placeSpawn, footprintConflicts, pruneTree, obstacle, settleBody,
  turretArc, clampTraverse, liftAt, relocate, conflicts, RULES, settleSolid, fallHeading,
} from '../../src/world/placement.js';
import { NavGrid, B } from '../../src/world/grid.js';
import { hugsObstacle, findPath } from '../../src/world/pathfinding.js';
import { buildStructure, walkwayStrips } from '../../src/world/map-builder.js';
import { walkShiftAt, WALK_SHIFT } from '../../src/art/dressing.js';
import { validateMission } from '../../src/missions/schema.js';

const hut = (id, x, z, w = 6, d = 4, rot = 0) => ({ id, type: 'hut', x, z, w, d, rot, h: 3 });
const minDistToRect = (run, r) => Math.min(...run.map(([x, z]) => polyDist(x, z, r)));

test('placement (a): a fence run crossing a building is cut visually at its walls; nav keeps the authored line', () => {
  const fence = { id: 'f', type: 'fence', points: [[0, 10], [30, 10]], h: 2 };
  const res = resolvePlacement([hut('h', 15, 10), fence]);
  const f = res.structures[1];
  assert.equal(f.visualRuns.length, 2, 'two pieces, one each side of the hut');
  const r = rectPoly(15, 10, 6, 4);
  for (const run of f.visualRuns) assert.ok(minDistToRect(run, r) >= RULES.linearGap - 1e-6, 'the cut ends stop short of the wall');
  assert.deepEqual(f.points, fence.points, 'authored points untouched');
  // nav: the footprint is the full authored line (no gap opens under the cut)
  const built = buildStructure(f, { grid: new NavGrid(40, 20), library: false });
  assert.deepEqual(built.footprints.find((fp) => fp.block).points, fence.points);
  assert.ok(res.log.some((l) => /run f: 1 → 2 visual run\(s\) \(cut .* at h\)/.test(l)));
});

test('placement (a): runs of one kind sharing an end are chained; a lower-ranked run is cut where it crosses a wall', () => {
  const w1 = { id: 'w1', type: 'wall', points: [[0, 0], [10, 0]], width: 0.5, h: 2 };
  const w2 = { id: 'w2', type: 'wall', points: [[10, 10], [10, 0]], width: 0.5, h: 2 };
  const items = chainRuns(structureRecords([w1, w2]).filter((r) => r.linear));
  assert.equal(items.length, 1, 'one chained run');
  assert.deepEqual(items[0].run, [[0, 0], [10, 0], [10, 10]]);
  const res = resolvePlacement([w1, w2, { id: 'f', type: 'fence', points: [[5, -5], [5, 5]] }]);
  assert.equal(res.structures[1].visualRuns.length, 0, 'w2 is drawn by w1\'s chained run');
  assert.equal(res.structures[2].visualRuns.length, 2, 'the fence stops at both faces of the wall');
});

test('placement (a): a watchtower astride a palisade moves to the inner side, legs against it; its gunner follows', () => {
  const loop = { id: 'pal', type: 'wall', width: 0.5, h: 3, points: [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]] };
  const tower = { id: 't', type: 'watchtower', x: 15, z: 0, w: 3, d: 3, rot: 0, h: 5.5, deckY: 5.5 };
  const res = resolvePlacement([loop, tower]);
  const t = res.structures[1], mv = res.moves.get('t');
  assert.ok(mv && mv.dz > 0 && Math.abs(mv.dx) < 1e-6, 'moved inwards (towards the loop centre)');
  const legs = rectPoly(t.x, t.z, 3 + 1.6, 3 + 1.6); // data shape: deck + splayed legs
  assert.ok(Math.min(...legs.map(([, z]) => z)) >= 0.25 + RULES.towerGap - 1e-3, 'legs clear of the palisade face');
  assert.equal(res.structures[0].visualRuns, undefined, 'the palisade stays whole (the tower stands against it)');
  const gunner = placeSpawn({ id: 'e8', x: 15, z: 0, y: 5.5, elevated: true, tower: 't' }, res);
  assert.deepEqual([gunner.x, gunner.z], [t.x, t.z], 'the posted MG gunner moves with his tower');
  const gap = resolvePlacement([loop, { ...tower, onLine: 'gap' }]);
  assert.equal(gap.moves.size, 0, 'onLine:"gap" keeps the tower');
  assert.ok(gap.structures[0].visualRuns.length >= 2, '…and cuts the palisade around it');
});

test('placement (b): point props leave solids (deterministic ring search); scenery without a spot is dropped', () => {
  const drum = { id: 'd1', type: 'barrels', x: 12.5, z: 10, r: 0.3 };
  const a = resolvePlacement([hut('h', 10, 10), drum], { points: true });
  const b = resolvePlacement([hut('h', 10, 10), drum], { points: true });
  const d = a.structures[1];
  assert.ok(polyDist(d.x, d.z, rectPoly(10, 10, 6, 4)) >= 0.3 + 0.1 - 0.02, 'drum clear of the hut wall');
  assert.deepEqual([d.x, d.z], [b.structures[1].x, b.structures[1].z], 'seeded: same result every build');
  assert.ok(Math.hypot(d.x - 12.5, d.z - 10) < 1.5, 'moved to the nearest free spot');
  // no free spot: a pine boxed in by buildings is dropped (scenery), a named gameplay prop is kept + warned
  const box = [hut('a', 10, 5, 20, 8), hut('b', 10, 15, 20, 8), hut('c', 3, 10, 6, 2), hut('e', 17, 10, 6, 2)];
  const c = resolvePlacement([...box, { type: 'pine', x: 10, z: 10, r: 0.5, h: 9 }, { id: 'crate', type: 'crates', x: 10, z: 10.8, w: 1, d: 1 }], { points: true });
  assert.ok(c.structures[4].placementDropped && c.dropped.length === 1, 'boxed-in pine dropped');
  assert.ok(!c.structures[5].placementDropped && c.moves.has('crate'), 'named prop kept (moved into the gap)');
  const cr = c.structures[5];
  assert.ok(cr.z + 0.5 <= 11 - 0.1 + 0.02 && cr.z - 0.5 >= 9 + 0.1 - 0.02, `crate clear of both huts (z ${cr.z})`);
  // without visual shapes (grid-only builds) points are only checked, never moved
  const n = resolvePlacement([hut('h', 10, 10), drum]);
  assert.equal(n.structures[1].x, 12.5);
  assert.ok(n.log.some((l) => /^check prop d1/.test(l)));
});

test('placement (b): trees keep off roads and boat lanes; crowns are pruned over nearby walls / narrowed at buildings', () => {
  const res = resolvePlacement([{ type: 'pine', x: 10, z: 10.5, r: 0.4, h: 10 }], {
    points: true, terrain: [{ type: 'path', terrain: 'road', points: [[0, 10], [20, 10]], width: 4 }],
  });
  const p = res.structures[0];
  assert.ok(Math.abs(p.z - 10) >= 2 + 0.4 + 0.6 - 0.03, `trunk off the road (z ${p.z})`);
  const wall = obstacle('w', 'wall', [rectPoly(10, 12, 10, 0.5)], { h: 2.2 });
  const hint = pruneTree({ x: 10, z: 10, h: 10 }, [wall]);
  assert.ok(hint.crownBase >= 2.2 + 0.4, 'lowest branches lifted above the wall');
  const house = obstacle('b', 'building', [rectPoly(10, 13.5, 8, 4)], { h: 8 });
  assert.ok(pruneTree({ x: 10, z: 10, h: 10 }, [house]).crownR <= 1.5 + 1e-6, 'crown narrowed at a tall building');
  const boat = resolvePlacement([{ type: 'pine', x: 10, z: 11, r: 0.4, h: 10 }], { points: true, vehicles: [{ id: 'b', vehicleType: 'patrolboat', route: { points: [{ x: 0, z: 10 }, { x: 20, z: 10 }] } }] });
  assert.ok(Math.abs(boat.structures[0].z - 10) >= 1.8 + 0.4 + 0.5 - 0.03, 'trunk clear of the patrol boat lane');
});

test('placement (b): gate-like interactables cut fences and line up with them; mechanisms never move', () => {
  const fence = { type: 'fence', points: [[40, 45], [50, 45], [50, 55], [40, 55]] };
  const res = resolvePlacement([fence], { interactables: [{ kind: 'penGate', id: 'g', x: 50, z: 50 }, { kind: 'pushable', id: 'w', x: 50.2, z: 50, rail: [[40, 50], [60, 50]] }] });
  assert.ok(Math.abs(res.interactables[0].rot - Math.PI / 2) < 1e-3, 'pen gate leaf along the fence');
  assert.ok(res.structures[0].visualRuns.length === 2, 'the fence opens where the gate stands');
  assert.equal(res.interactables[1].x, 50.2, 'rail wagon untouched');
});

test('placement (c): overlapping or crowded building footprints are flagged by the schema', () => {
  assert.deepEqual(footprintConflicts([hut('a', 10, 10), hut('b', 14, 10)]).map((c) => c.kind), ['overlap']);
  assert.deepEqual(footprintConflicts([hut('a', 10, 10), hut('b', 16.5, 10)]).map((c) => [c.kind, c.gap]), [['tight', 0.5]]);
  assert.deepEqual(footprintConflicts([hut('a', 10, 10), hut('b', 17.5, 10)]), [], '1.5 m apart: eaves clear');
  assert.deepEqual(footprintConflicts([hut('a', 10, 10), { ...hut('b', 14, 10), clipAllow: ['a'] }]), [], 'explicit join');
  const v = validateMission({ id: 'x', size: [40, 40], structures: [hut('a', 10, 10), hut('b', 14, 10)] });
  assert.ok(v.warnings.some((w) => /a and b overlap/.test(w)));
});

test('placement (d): a gun beside a wall closes that arc, lifts its barrel over a low fence and snaps to open arcs', () => {
  const g = new NavGrid(20, 20);
  g.fillOrientedRect(10, 8.2, 8, 1, 0, 'block', B.HIGH, 0); // wall 1.3 m north of the gun (z 7.7..8.7)
  g.fillOrientedRect(11.6, 10, 0.5, 4, 0, 'block', B.FENCE, 0); // fence 1.6 m east
  const arc = turretArc(g, 10, 10, { len: 2.4, h: 1.0, heightOf: (k) => (g.block[k] === B.FENCE ? 1.2 : 2.5) });
  const deg = (a) => (a * Math.PI) / 180;
  assert.equal(liftAt(arc, deg(270)), Infinity, 'north: closed (the wall)');
  assert.ok(liftAt(arc, 0) > 0 && liftAt(arc, 0) < deg(25), 'east: barrel lifted over the fence');
  assert.equal(liftAt(arc, deg(90)), 0, 'south: open ground');
  const h = clampTraverse(arc, deg(270));
  assert.ok(liftAt(arc, h) !== Infinity && Math.abs(h - deg(270)) < deg(90), 'snaps to the nearest open angle');
});

test('placement (d): eaves over open ground close the gun arc (barrel + turret housing); overhead stamps combine and clear', () => {
  const g = new NavGrid(20, 20);
  // a cabin's eaves (2.1–3.4 m) over the open cells 1.5–2.5 m north of the gun; tree boughs (soft) east
  const eaves = new Map(), bough = new Map();
  for (const k of g.rectCells(10, 7.9, 6, 1)) eaves.set(k, [2.1, 3.4]);
  for (const k of g.rectCells(12, 10, 1, 1)) bough.set(k, [1.9, 3]);
  g.overStamp('cab', eaves); g.overStamp('trees', bough, true);
  assert.equal(g.navBlock[g.rectCells(10, 7.9, 1, 1)[0]], 0, 'walkers still pass under the eaves');
  const deg = (a) => (a * Math.PI) / 180;
  const arc = turretArc(g, 10, 10, { len: 3.3, h: 2.0 });
  assert.equal(liftAt(arc, deg(270)), Infinity, 'north: the barrel would pass through the eaves');
  assert.equal(liftAt(arc, 0), Infinity, 'east: through the low bough');
  assert.equal(liftAt(arc, deg(90)), 0, 'south: open');
  assert.equal(liftAt(turretArc(g, 10, 10, { len: 3.3, h: 1.0 }), deg(270)), 0, 'a low gun passes under the eaves');
  // the housing: parked right under the eaves every angle is closed (the turret stays put)
  const under = turretArc(g, 10, 8.4, { len: 3.3, h: 2.0, housing: { hl: 0.9, hw: 0.9, top: 2.4 } });
  assert.ok([...under].every((v) => v === Infinity), 'housing under the eaves: no angle is open');
  g.overStamp('cab', new Map());
  assert.equal(g.overLo[[...eaves.keys()][0]], Infinity, 'cleared with the structure');
  assert.equal(liftAt(turretArc(g, 10, 10, { len: 3.3, h: 2.0 }), deg(270)), 0, 'north open again');
});

test('placement (e): nav-only blocks, wall-hugging cost, bodies slid off walls, pushables approached at their edge', () => {
  const g = new NavGrid(20, 20);
  g.fillOrientedRect(10, 5, 20, 1, 0, 'block', B.HIGH, 0); // wall along z = 5
  g.navStamp('k', g.rectCells(10, 12, 2, 2));
  assert.ok(!g.walkableAt(10, 12), 'nav block: not walkable');
  assert.equal(g.lineOfSight(10, 9, 10, 15), true, '…but it never blocks sight');
  g.navStamp('k', []);
  assert.ok(g.walkableAt(10, 12), 'cleared');
  assert.ok(hugsObstacle(g, 20, 11) && !hugsObstacle(g, 20, 14), 'cells touching the wall hug it');
  const p = findPath(g, 2, 6.2, 18, 6.2, { smooth: false });
  assert.ok(p.slice(1, -1).every((q) => q.z > 6), 'the walk keeps off the wall row when there is room');
  const body = settleBody(g, 10, 5.9);
  assert.ok(body && body.z - 5.5 >= 0.5, `body slid off the wall (${body?.z})`);
  assert.equal(settleBody(g, 10, 12), null, 'a body in the open stays put');
});

test('placement (e): wall walks — the palisade steps off the walk, the deck stops at its rails', () => {
  const s = { type: 'wall', points: [[0, 0], [10, 0]], width: 0.5, h: 3, walkways: [{ points: [[0, 0.35], [10, 0.35]], width: 1.4, y: 2.2 }] };
  assert.ok(Math.abs(walkShiftAt(5, 0, 0, 1, s.walkways) + WALK_SHIFT) < 1e-9, 'stakes step away from the walk side');
  assert.equal(walkShiftAt(15, 0, 0, 1, s.walkways), 0, 'beyond the walk: on the line');
  const [strip] = walkwayStrips(s);
  const inner = 0.35 + strip.off - strip.width / 2; // deck edge nearest the wall, from the wall line
  assert.ok(inner >= 0.25 - WALK_SHIFT + 0.03 && strip.width > 0.8, `deck starts at the palisade rails (${inner.toFixed(2)} m)`);
  assert.ok(!polysOverlap(inflatePoly(rectPoly(5, 0, 10, 0.5), 0), rectPoly(5, 0.35 + strip.off, 10, strip.width)) || inner > 0, 'deck clear');
});

test('placement: relocation obeys clearances by category (drum vs building 0.1 m, drums may stack)', () => {
  const recs = [obstacle('h', 'building', [rectPoly(10, 10, 6, 4)]), obstacle('d0', 'prop', [rectPoly(13.4, 10, 0.6, 0.6)])];
  const pt = { id: 'd1', x: 13.2, z: 10, cat: 'prop', polys: [rectPoly(13.2, 10, 0.6, 0.6)] };
  assert.equal(conflicts(pt.polys, 'prop', recs).map((o) => o.id).join(), 'h', 'overlapping drums are a stack, the building is not');
  const to = relocate(pt, recs);
  assert.ok(to && !conflicts([rectPoly(to.x, to.z, 0.6, 0.6)], 'prop', recs, null, true).length, 'new spot clear of both');
});

test('placement (e): a body drops along a free line — turned away from a wall in front of (or behind) it', async () => {
  const { fallHeading } = await import('../../src/world/placement.js');
  const g = new NavGrid(20, 20);
  g.fillOrientedRect(10, 11.5, 20, 1, 0, 'block', B.HIGH, 0); // wall 1 m south of the unit (z 11..12)
  const h = fallHeading(g, 10, 10.2, Math.PI / 2); // facing the wall
  assert.ok(Math.abs(Math.sin(h)) < 1e-9, 'falls along the wall, not into it');
  assert.equal(fallHeading(g, 10, 5, Math.PI / 2), Math.PI / 2, 'in the open: unchanged');
  // a 1.5 m wall walk (deck at 2.2 m, ending 1 m past the sentry) with the palisade right beside it: no line is fully free; the body lies
  // along the deck (it may hang over the inner edge, never across the stakes)
  const w = new NavGrid(20, 20);
  for (let j = 0; j < w.rows; j++) for (let i = 0; i < w.cols; i++) { const p = w.cellCenter(i, j); if (p.z >= 9 && p.z < 10.5 && p.x < 11) w.elev[w.idx(i, j)] = 2.2; }
  w.fillOrientedRect(10, 10.75, 20, 0.5, 0, 'block', B.HIGH, 0); // palisade z 10.5..11
  const hw = fallHeading(w, 10, 10.2, Math.PI / 2); // a sentry facing the palisade
  assert.ok(Math.abs(Math.sin(hw)) < 0.25, `falls along the walk (heading ${hw.toFixed(2)})`);
});

test('placement (e): a body falls the likely way and shifts off standing visuals the nav grid does not see', () => {
  const g = new NavGrid(20, 20);
  // a stake row 0.35 m north of the sentry (z 10.3–10.5), known only to the quarter-cell standing layer
  const stakes = [];
  for (let i = 0; i < 80; i++) stakes.push(`${i},41`);
  g.solidStamp('palisade', stakes);
  assert.ok(g.solidAt(10, 10.4) && !g.solidAt(10, 10), 'quarter-cell resolution');
  assert.equal(g.isWalkable(20, 20), true, 'walking is unaffected');
  const off = settleSolid(g, 10, 10.05, 0, { likely: -1 });
  assert.ok(off && off.left === 0 && off.z < 10.05 && off.moved <= 0.6, `slides away from the stakes (${JSON.stringify(off)})`);
  assert.equal(settleSolid(g, 10, 8, 0, { likely: -1 }), null, 'clear already: stays');
  // a deck edge 1 m to +x in a 1.5 m corridor, the sentry facing it: the standing death clip falls backward, so the
  // sentry turns to face the edge (its body then lies toward -x, on the deck; only its feet point at the drop)
  const d = new NavGrid(20, 20);
  for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) if (d.cellCenter(i, j).x > 11) d.elev[d.idx(i, j)] = 1;
  for (let i = 0; i < d.cols; i++) for (const z of [9.25, 10.75]) d.block[d.idx(i, Math.floor(z / d.cell))] = B.HIGH; // a 1.5 m corridor
  const hb = fallHeading(d, 10, 10, Math.PI, 1.6, -1);
  assert.ok(Math.cos(hb) > 0.9, `backward fall: turned to face +x (${hb.toFixed(2)})`);
  const hf = fallHeading(d, 10, 10, 0, 1.6, 1);
  assert.ok(Math.cos(hf) < -0.9, `forward (running) fall: turned to face -x (${hf.toFixed(2)})`);
});

test('placement (e): visual occupancy fills hollow interiors; measured decks report their railings', async () => {
  const THREE = await import('three');
  const { planCells, deckField } = await import('../../src/world/placement-visual.js');
  const mat = new THREE.MeshBasicMaterial();
  const room = new THREE.Group(); // a floorless 4 × 4 hut: four 0.2 m walls, 1 m doorway on the south side
  for (const [x, z, w, d] of [[0, -2, 4, 0.2], [-2, 0, 0.2, 4], [2, 0, 0.2, 4], [-1.25, 2, 1.5, 0.2], [1.25, 2, 1.5, 0.2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), mat); m.position.set(x + 10, 1.25, z + 10); room.add(m);
  }
  const rects = planCells(room, { maxY: 1.8, cell: 0.25 });
  const inside = (px, pz) => rects.some((r) => px >= r[0][0] && px <= r[2][0] && pz >= r[0][1] && pz <= r[2][1]);
  assert.ok(inside(10, 10), 'the hollow interior counts as occupied (a drum is never placed inside a hut)');
  assert.ok(!inside(10, 13), 'outside stays free');
  const bridge = new THREE.Group(); // 10 m deck at y 0.3 with 1 m railings along both edges
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 3), mat); deck.position.set(10, 0.25, 10); bridge.add(deck);
  for (const z of [8.6, 11.4]) { const r = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 0.2), mat); r.position.set(10, 0.8, z); bridge.add(r); }
  const f = deckField(bridge, [[5, 8.5], [15, 8.5], [15, 11.5], [5, 11.5]], 0, 3);
  assert.ok(Math.abs(f.heightAt(10, 10) - 0.3) < 1e-3, 'walking level = the deck top');
  assert.ok(f.parapet(10, 11.4) && !f.parapet(10, 10), 'the railing is not walkable deck');
});

test('placement (b): the terrain levels the ground under a prop base (grid.flatExtra → buildFlatMask)', async () => {
  const { buildFlatMask } = await import('../../src/art/terrain/terrain-layers.js');
  const g = new NavGrid(20, 20);
  const k = g.idx(20, 20);
  assert.ok(buildFlatMask(g)[k] < 0.01, 'open ground keeps its undulation');
  g.flatExtra = new Uint8Array(g.cols * g.rows); g.flatExtra[k] = 1;
  assert.equal(buildFlatMask(g)[k], 1, 'under a well / crate / lift base: fully level');
});
