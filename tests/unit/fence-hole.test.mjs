/**
 * Wire cutters cut a HOLE, not a gap (user, M3 video review: "the fence we should open a round hole not make the fence
 * disappear … you should crawl to go through the fence"): a round hole low in the wire, the rest of the fence standing;
 * the hole is a crawl-only passage (grid crawlway): enemies, vehicles and loaded men go round, a standing commando goes
 * down on his belly at it, crawls through and gets up on the far side. The wire layer opens the hole in the strands and
 * the chain-link mesh, frays the cut ends and peels a flap back; it survives a save.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { B } from '../../src/world/grid.js';
import { findPath } from '../../src/world/pathfinding.js';
import { Parts, buildWireRun, assembleRibbons, panelGeometry, holeFlapGeometry, inHole, HOLE, flapOpen, buildWireLayer } from '../../src/art/wire-obstacles.js';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { getMission } from '../../src/missions/index.js';

// a fence across the whole map (no way round) along x = 30
const fenceSim = (commandos, extra = {}) => makeSim({
  structures: [{ type: 'fence', id: 'f1', points: [[30, 0], [30, 60]] }, ...(extra.structures || [])],
  commandos,
}, { brains: false });

const cutAt = (s, sp, x, z) => {
  assert.ok(sp.issue({ type: 'ability', id: 'cutters', target: { x, z } }), 'cutters order');
  s.run(15, () => !sp.currentAction && !sp.pendingAbility && s.world.grid.crawlwayCount > 0);
  s.run(0.2);
};

test('cutters: a crawl-only hole ≤ 1.2 m wide in the fence cells, the rest of the fence stands; nobody upright gets through', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
  const sp = s.cmd('sapper'), g = s.world.grid;
  cutAt(s, sp, 30, 10);
  assert.ok(g.crawlwayCount > 0, 'hole cells');
  const holeCells = [];
  for (let k = 0; k < g.size; k++) if (g.crawlway[k]) holeCells.push(k);
  const zs = holeCells.map((k) => g.cellCenter(k % g.cols, Math.floor(k / g.cols)).z);
  assert.ok(Math.max(...zs) - Math.min(...zs) <= 1.0 + 1e-9, `hole span ${Math.min(...zs)}..${Math.max(...zs)} (cell centres)`);
  for (const k of holeCells) assert.equal(g.block[k], B.NONE);
  assert.equal(g.blockAt(30, 11.5), B.FENCE, 'the fence stands 1.5 m on');
  assert.equal(g.blockAt(30, 8.5), B.FENCE);
  // upright (enemies, vehicles, a man with a body on his back): no way through
  assert.equal(findPath(g, 25, 10, 35, 10), null, 'no path for a man on his feet');
  assert.equal(s.world.findPath(25, 10, 35, 10, { swim: true, role: 'enemy' }), null, 'enemy query');
  const p = s.world.findPath(25, 10, 35, 10, { crawl: true });
  assert.ok(p && p.length >= 2, 'a crawler gets through');
  assert.ok(Math.abs(p[p.length - 1].x - 35) < 0.6, 'to the far side');
  // the cut is snipped strand by strand (device sound events), silent otherwise (no collapse)
  assert.ok(s.count('device', (e) => e.sfx === 'cutters_snip') >= 4, 'several snips');
  const d = s.last('structure:destroyed');
  assert.ok(d && d.p.type === 'fence-gap' && d.p.hole === true, 'hole event');
  // the visual state: kneeling at the wire, facing it, done
  assert.equal(sp.cutWire?.phase, 'done');
  assert.ok(sp.x > 30 - 1.1 && sp.x < 30 - 0.4 && Math.abs(sp.z - 10) < 0.1, `settled square to the hole ${sp.x.toFixed(2)},${sp.z.toFixed(2)}`);
  assert.ok(Math.cos(sp.heading) > 0.95, 'facing the wire');
});

test('hole: a standing commando ordered through goes prone at it, crawls through, gets up (and runs on if he ran)', () => {
  for (const run of [false, true]) {
    const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
    const sp = s.cmd('sapper'), g = s.world.grid;
    cutAt(s, sp, 30, 10);
    assert.equal(sp.stance, 'stand');
    assert.ok(sp.issue({ type: 'move', x: 36, z: 10.5, run }), 'move order through the hole');
    const seen = new Set();
    let standingInHole = 0, ranAfter = false, lay = false;
    s.run(40, () => {
      if (g.crawlwayAt(sp.x, sp.z) && sp.stance !== 'crawl') standingInHole++;
      if (g.crawlwayAt(sp.x, sp.z)) lay = true;
      seen.add(sp.stance);
      if (sp.x > 31.5 && sp.isRunning) ranAfter = true;
      return !sp.path && sp.x > 35 && sp.stance === 'stand' && sp._stanceT <= 0;
    });
    assert.ok(lay, 'he went through the hole');
    assert.equal(standingInHole, 0, 'never upright in the hole');
    assert.ok(seen.has('crawl'), 'crawled');
    assert.ok(sp.x > 35 && Math.abs(sp.z - 10.5) < 0.5, `arrived ${sp.x.toFixed(2)},${sp.z.toFixed(2)}`);
    assert.equal(sp.stance, 'stand', 'up again on the far side');
    if (run) assert.ok(ranAfter, 'runs on after the hole');
  }
});

test('hole in a diagonal fence (M3 station fence): crossed at its cells\' corner, he stays down until his feet are through', () => {
  // the fence at 45° (x − z = 10): its cells touch only at the corners, the hole is crossed diagonally
  const s = makeSim({ structures: [{ type: 'fence', id: 'd1', points: [[10, 0], [60, 50]] }], commandos: [{ role: 'sapper', x: 33, z: 18, inventory: { wireCutters: 1 } }] }, { brains: false });
  const sp = s.cmd('sapper'), g = s.world.grid;
  const side = (u) => (u.x - u.z - 10) / Math.SQRT2;   // signed distance from the wire (+: his side)
  assert.ok(side(sp) > 0);
  cutAt(s, sp, 30.4, 20.4);
  assert.ok(g.crawlwayCount > 0 && g.crawlwayCount <= 6, `${g.crawlwayCount} cells`);
  assert.equal(findPath(g, 31, 18, 27, 24), null, 'upright: no way through');
  assert.ok(sp.issue({ type: 'move', x: 27, z: 25 }), 'through the hole');
  let upTooSoon = 0, lay = false;
  s.run(40, () => {
    const d = side(sp);
    if (sp.stance === 'crawl' && Math.abs(d) < 0.3) lay = true;
    if (sp.stance === 'stand' && d < 0.3 && d > -0.85) upTooSoon++;
    return !sp.path && sp.stance === 'stand' && sp._stanceT <= 0 && side(sp) < -1;
  });
  assert.ok(lay, 'crawled over the line');
  assert.equal(upTooSoon, 0, 'not up while his legs are still in the wire');
  assert.ok(side(sp) < -1 && sp.stance === 'stand', `through and up (${side(sp).toFixed(2)} ${sp.stance})`);
});

test('hole: a crawling commando stays down; no standing up inside; a man carrying a load goes round (there is no round)', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }, { role: 'greenberet', x: 25, z: 14 }]);
  const sp = s.cmd('sapper'), gb = s.cmd('greenberet'), g = s.world.grid;
  cutAt(s, sp, 30, 10);
  sp.setStance('crawl'); s.run(1);
  assert.ok(sp.issue({ type: 'move', x: 33, z: 10 }));
  s.run(30, () => !sp.path);
  assert.ok(sp.x > 32, 'through');
  assert.equal(sp.stance, 'crawl', 'he crawled on his own: stays down');
  // in the hole: "stand" is refused until he is through
  gb.issue({ type: 'move', x: 30, z: 10 });
  s.run(30, () => !gb.path);
  assert.ok(g.crawlwayAt(gb.x, gb.z) || gb._bodyInCrawlway(), `GB lies in the hole (${gb.x.toFixed(2)},${gb.z.toFixed(2)} ${gb.stance})`);
  gb.setStance('stand');
  assert.equal(gb.stance, 'crawl', 'no standing up in the hole');
  // carrying: no crawl — the path query leaves the hole out
  gb.carrying = { kind: 'body' };
  assert.equal(gb.pathQuery().crawl, false);
  gb.carrying = null;
  assert.equal(gb.pathQuery().crawl, true);
});

test('hole: saved and restored with the grid (side of the peeled flap too)', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
  const sp = s.cmd('sapper'), g = s.world.grid;
  cutAt(s, sp, 30, 10);
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  const t = fenceSim([{ role: 'sapper', x: 25, z: 10 }]), g2 = t.world.grid;
  assert.equal(g2.crawlwayCount, 0);
  g2.deserialize(snap);
  assert.equal(g2.crawlwayCount, g.crawlwayCount);
  for (let k = 0; k < g.size; k++) if (g.crawlway[k] !== g2.crawlway[k] || g.block[k] !== g2.block[k]) assert.fail(`cell ${k} differs`);
  assert.ok(t.world.findPath(25, 10, 35, 10, { crawl: true }) && !t.world.findPath(25, 10, 35, 10), 'still crawl only');
});

test('wire layer: the hole opens the strands and the chain-link mesh only round the hole; fray, flap', () => {
  const P = new Parts();
  buildWireRun('chainlink', [[0, 0], [12, 0]], { id: 'c', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P, runKey: 'c#0' });
  const H = { d: 4.5, side: 1, n: [0, 1], seed: 3, born: -Infinity };
  const holes = new Map([['c#0', [H]]]);
  // strands: the low live strand (0.55 m) is cut, the high ones (1.05 m +, the arms, the tension wire) are not
  const a0 = assembleRibbons(P, new Map(), () => 0, { barbs: false }), a1 = assembleRibbons(P, new Map(), () => 0, { barbs: false, holes });
  assert.equal(a0.cuts, 0);
  assert.equal(a1.cuts, 2, `one strand through the hole cut twice (${a1.cuts})`);
  assert.ok(a1.fray > 40, `frayed weave round the hole (${a1.fray})`);
  // the mesh: the hole's middle is open, above it the mesh is whole, and the panels are all still there
  const tri = (geo, x, y) => {   // is (x, y) in the plane z = 0 covered by a triangle?
    const p = geo.attributes.position.array, ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const [A, Bv, C] = [ix[i], ix[i + 1], ix[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1]]);
      const d = (u, v, w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
      const q = [x, y], s1 = d(q, A, Bv), s2 = d(q, Bv, C), s3 = d(q, C, A);
      if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) return true;
    }
    return false;
  };
  const pg0 = panelGeometry(P.panels), pg1 = panelGeometry(P.panels, new Map(), holes);
  const yc = HOLE.y0 + HOLE.h / 2;
  assert.ok(tri(pg0, 4.5, yc), 'intact mesh covers the spot');
  assert.ok(!tri(pg1, 4.5, yc), 'hole: open in the middle');
  assert.ok(!tri(pg1, 4.5 + 0.3, yc), 'open 0.3 m to the side');
  assert.ok(!tri(pg1, 4.5, HOLE.y0 + 0.05), 'open near the bottom');
  assert.ok(tri(pg1, 4.5, 1.4), 'mesh whole above the hole');
  assert.ok(tri(pg1, 4.5 + 0.6, yc), 'mesh whole beside the hole');
  assert.ok(tri(pg1, 8, yc) && tri(pg1, 1, yc), 'the rest of the fence stands');
  // the old gap would have taken the panel's full height away: the hole never does
  assert.ok(tri(pg1, 4.5, 2.2), 'full height kept');
  // ellipse ~0.86 × 0.78 m
  assert.ok(inHole(H, 4.5 + 0.38, yc) && !inHole(H, 4.5 + 0.5, yc) && inHole(H, 4.5, yc + 0.34) && !inHole(H, 4.5, yc + 0.46));
  const flap = holeFlapGeometry(H);
  flap.computeBoundingBox();
  assert.ok(flap.boundingBox.max.y <= 1e-6 && flap.boundingBox.min.y < -0.5 && flap.boundingBox.max.x - flap.boundingBox.min.x > 0.7, 'flap hangs below its hinge');
  assert.equal(flapOpen(0), 0); assert.equal(flapOpen(Infinity), 1); assert.equal(flapOpen(HOLE.flapOpen + 0.01), 1);
  // field fence: the low strands are cut, the top strand is not
  const F = new Parts();
  buildWireRun('field_fence', [[0, 0], [12, 0]], { id: 'f', type: 'fence', h: 1.2 }, { parts: F, runKey: 'f#0' });
  const f1 = assembleRibbons(F, new Map(), () => 0, { barbs: false, holes: new Map([['f#0', [H]]]) });
  assert.ok(f1.cuts >= 4 && f1.cuts <= 8, `field fence: the strands at 0.15 / 0.48 / 0.82 m cut (${f1.cuts})`);
});

test('wire layer (game path): the Sapper\'s hole is re-derived from the grid, flaps peel open, a load restores it', () => {
  const def = getMission('m00');
  const load = () => { const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def }); return { world, handle: buildMap(world, def) }; };
  const { world, handle } = load(), W = handle.wire, g = world.grid;
  // cut like the cutters do (abilities/sapper.js cutHoleCells): the fence cells round (26, 40) become crawlway
  let n = 0;
  for (let dx = -0.5; dx <= 0.5; dx += 0.25) { const c = g.worldToCell(26 + dx, 40), k = g.idx(c.i, c.j); if (g.block[k] === B.FENCE) { g.setCrawlway(k, 1); n++; } }
  g.version++;
  world.time = 10;
  world.events.emit('structure:destroyed', { type: 'fence-gap', id: 'fence', hole: true, x: 26, z: 40 });
  assert.ok(n > 0 && W.holes.size === 1 && W.gaps.size === 0, `a hole, no gap (${n} cells, ${JSON.stringify([...W.holes])})`);
  const [[key, [H]]] = [...W.holes];
  assert.ok(W.stats.cuts >= 4, `strands cut round the hole (${W.stats.cuts})`);
  assert.equal(W.scanGaps(), false, 'stable');
  // M0's sandbox fence is a field fence (no mesh, no flap); M3's station fence has one
  void key; void H;
  const saved = g.serialize(), B2 = load();
  B2.world.grid.deserialize(saved);
  B2.handle.wire.update(0);
  assert.equal(JSON.stringify([...B2.handle.wire.holes].map(([k, v]) => [k, v.map((q) => q.side)])), JSON.stringify([...W.holes].map(([k, v]) => [k, v.map((q) => q.side)])));
  handle.dispose(); B2.handle.dispose();
  // a chain-link fence gets the flap: peeled back over flapOpen s from the cut
  const m3 = getMission('m03'), w3 = new World({ size: m3.size, scene: new THREE.Scene(), mission: m3 }), h3 = buildMap(w3, m3), W3 = h3.wire, g3 = w3.grid;
  for (let dz = -0.5; dz <= 0.5; dz += 0.25) for (let dx = -0.5; dx <= 0.5; dx += 0.25) { const c = g3.worldToCell(57.6 + dx, 79 + dz), k = g3.idx(c.i, c.j); if (g3.block[k] === B.FENCE && Math.hypot(dx, dz) < 0.55) g3.setCrawlway(k, 1); }
  g3.version++;
  w3.time = 100;
  w3.events.emit('structure:destroyed', { type: 'fence-gap', id: 'st_fence', hole: true, x: 57.6, z: 79 });
  assert.equal(W3.flaps.length, 1, 'one flap');
  const fm = W3.flaps[0], e0 = new THREE.Vector3().setFromMatrixPosition(fm.matrix);
  W3.update(0);
  const lowPt = () => new THREE.Vector3(0, -0.5, 0).applyMatrix4(fm.matrix);
  const shut = lowPt();
  w3.time = 100 + HOLE.flapOpen + 0.1; W3.update(0);
  const open = lowPt();
  assert.ok(open.y > shut.y + 0.5, `flap peeled up (${shut.y.toFixed(2)} → ${open.y.toFixed(2)})`);
  assert.ok(Math.hypot(open.x - e0.x, open.z - e0.z) > 0.3, 'and out');
  h3.dispose();
});
