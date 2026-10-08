/**
 * Wire cutters cut a man-sized HOLE through a fence (user, 2026-10-08: "The fence cut we should make the whole bigger do
 * a commando can walk through standing up. May the broken wire around the edges of the cuts more kind of chaotic"; it
 * replaces the crawl-only hole of the M3 video review): an opening ~1.0 × 1.95 m from the ground, the rest of the fence
 * standing; open ground (grid fenceHole) for anyone on foot, upright, crouched or crawling, enemies too; saved. The
 * wire layer opens the strands and the chain-link up to the top cut, pulls two crumpled flaps aside, and frays the cut
 * edges chaotically (stubs, kinks, curls, a few dangling ends, a jagged top cut) — nothing in a walking man's way.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { B } from '../../src/world/grid.js';
import { findPath } from '../../src/world/pathfinding.js';
import { Parts, buildWireRun, assembleRibbons, panelGeometry, holeFlapGeometry, holeFlapPoints, holeShadeGeometry, holeFray, holeShape, holeWalkway, flapFrame, inHole, HOLE, flapOpen } from '../../src/art/wire-obstacles.js';
import { wireRng } from '../../src/art/barbed-wire.js';
import { snipPoints, cutPose } from '../../src/art/wire-cut.js';
import { planHole } from '../../src/abilities/sapper.js';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { getMission } from '../../src/missions/index.js';
import { Commando } from '../../src/entities/commando.js';
import { CONFIG } from '../../src/config.js';

// a fence across the whole map (no way round) along x = 30
const fenceSim = (commandos, extra = {}) => makeSim({
  structures: [{ type: 'fence', id: 'f1', points: [[30, 0], [30, 60]] }, ...(extra.structures || [])],
  commandos, ...(extra.def || {}),
}, { brains: false });

const cutAt = (s, sp, x, z) => {
  assert.ok(sp.issue({ type: 'ability', id: 'cutters', target: { x, z } }), 'cutters order');
  s.run(15, () => !sp.currentAction && !sp.pendingAbility && s.world.grid.fenceHoleCount > 0);
  s.run(0.2);
};
const holeCells = (g) => { const out = []; for (let k = 0; k < g.size; k++) if (g.fenceHole[k]) out.push(k); return out; };

test('cutters: a walk-through hole in the fence cells, the rest of the fence stands; upright men (and enemies) go through', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
  const sp = s.cmd('sapper'), g = s.world.grid;
  assert.equal(findPath(g, 25, 10, 35, 10), null, 'no way through before the cut');
  cutAt(s, sp, 30, 10);
  const cells = holeCells(g);
  assert.ok(cells.length >= 1 && cells.length <= 3, `hole cells ${cells.length}`);
  for (const k of cells) assert.equal(g.block[k], B.NONE);
  const zs = cells.map((k) => g.cellCenter(k % g.cols, Math.floor(k / g.cols)).z);
  assert.ok(Math.max(...zs) - Math.min(...zs) <= 1.0 + 1e-9, `hole ≤ 1 m wide in cells ${Math.min(...zs)}..${Math.max(...zs)}`);
  assert.equal(g.blockAt(30, 11.5), B.FENCE, 'the fence stands 1.5 m on');
  assert.equal(g.blockAt(30, 8.5), B.FENCE);
  // upright: anyone on foot
  const p = findPath(g, 25, 10, 35, 10);
  assert.ok(p && p.length >= 2 && Math.abs(p[p.length - 1].x - 35) < 0.6, 'a man on his feet walks through');
  assert.ok(s.world.findPath(25, 10, 35, 10, { role: 'enemy' }), 'and an enemy');
  // the cut is snipped strand by strand (device sound events), silent otherwise (no collapse)
  assert.ok(s.count('device', (e) => e.sfx === 'cutters_snip') >= 4, 'several snips');
  const d = s.last('structure:destroyed');
  assert.ok(d && d.p.type === 'fence-gap' && d.p.hole === true, 'hole event');
  assert.equal(d.p.owner, undefined, 'no owner: the fence\'s own nav / body stamps stay (map-builder clears an owner\'s on destroy)');
  // the hole is centred on the cell it opened (so a man walking through stays inside the drawn opening)
  const c0 = g.cellCenter(cells[0] % g.cols, Math.floor(cells[0] / g.cols));
  assert.ok(Math.abs(d.p.z - c0.z) < 1e-6, `centred on its cell (${d.p.z} vs ${c0.z})`);
  // the visual state: done, square to the wire
  assert.equal(sp.cutWire?.phase, 'done');
  assert.ok(sp.x > 30 - 1.1 && sp.x < 30 - 0.4 && Math.abs(sp.z - d.p.z) < 0.1, `settled square to the hole ${sp.x.toFixed(2)},${sp.z.toFixed(2)}`);
  assert.ok(Math.cos(sp.heading) > 0.95, 'facing the wire');
});

test('hole: walked through upright at walking pace (and run); a crawler crawls through and stays down; a man with a body walks through', () => {
  for (const run of [false, true]) {
    const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
    const sp = s.cmd('sapper'), g = s.world.grid;
    cutAt(s, sp, 30, 10);
    assert.equal(sp.stance, 'stand');
    assert.ok(sp.issue({ type: 'move', x: 36, z: 10.5, run }), 'move order through the hole');
    let notUp = 0, inHoleT = 0, t0 = null, t1 = null;
    s.run(30, () => {
      if (sp.stance !== 'stand') notUp++;
      if (g.fenceHoleAt(sp.x, sp.z)) inHoleT++;
      if (t0 == null && sp.x > 29) t0 = s.world.time;
      if (t1 == null && sp.x > 31) t1 = s.world.time;
      return !sp.path && sp.x > 35;
    });
    assert.ok(inHoleT > 0, 'he went through the hole');
    assert.equal(notUp, 0, 'never off his feet');
    const v = 2 / (t1 - t0), want = run ? CONFIG.units.run.default : CONFIG.units.walk;
    assert.ok(v > want * 0.75, `through at ${run ? 'running' : 'walking'} pace: ${v.toFixed(2)} m/s (${want})`);
    assert.ok(sp.x > 35 && Math.abs(sp.z - 10.5) < 0.5, `arrived ${sp.x.toFixed(2)},${sp.z.toFixed(2)}`);
  }
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }, { role: 'greenberet', x: 25, z: 14 }]);
  const sp = s.cmd('sapper'), gb = s.cmd('greenberet'), g = s.world.grid;
  cutAt(s, sp, 30, 10);
  sp.setStance('crawl'); s.run(1);
  assert.ok(sp.issue({ type: 'move', x: 33, z: 10 }));
  s.run(30, () => !sp.path);
  assert.ok(sp.x > 32, 'crawled through');
  assert.equal(sp.stance, 'crawl', 'a crawler stays down');
  gb.carrying = { kind: 'body' };
  assert.ok(s.world.findPath(gb.x, gb.z, 34, 14, gb.pathQuery()), 'a man carrying a body walks through too');
  gb.carrying = null;
  void g;
});

test('hole in a diagonal fence (M3 station fence): open for a man on his feet, crossed through its cell', () => {
  const s = makeSim({ structures: [{ type: 'fence', id: 'd1', points: [[10, 0], [60, 50]] }], commandos: [{ role: 'sapper', x: 33, z: 18, inventory: { wireCutters: 1 } }] }, { brains: false });
  const sp = s.cmd('sapper'), g = s.world.grid;
  const side = (u) => (u.x - u.z - 10) / Math.SQRT2;   // signed distance from the wire (+: his side)
  assert.equal(findPath(g, 31, 18, 27, 24), null, 'no way through before');
  cutAt(s, sp, 30.4, 20.4);
  assert.ok(g.fenceHoleCount >= 1 && g.fenceHoleCount <= 3, `${g.fenceHoleCount} cells`);
  assert.ok(findPath(g, 31, 18, 27, 24), 'upright: through');
  assert.ok(sp.issue({ type: 'move', x: 27, z: 25 }), 'through the hole');
  let down = 0;
  s.run(40, () => { if (sp.stance !== 'stand') down++; return !sp.path && side(sp) < -1; });
  assert.equal(down, 0, 'on his feet all the way');
  assert.ok(side(sp) < -1, `through (${side(sp).toFixed(2)})`);
});

test('hole: saved and restored with the grid (side of the flaps too); a save from the crawl-hole days loads as a walk-through hole', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
  const sp = s.cmd('sapper'), g = s.world.grid;
  cutAt(s, sp, 30, 10);
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  assert.ok(snap.hole?.length >= 1 && !snap.crawl, 'saved as `hole`');
  const t = fenceSim([{ role: 'sapper', x: 25, z: 10 }]), g2 = t.world.grid;
  assert.equal(g2.fenceHoleCount, 0);
  g2.deserialize(snap);
  assert.equal(g2.fenceHoleCount, g.fenceHoleCount);
  for (let k = 0; k < g.size; k++) if (g.fenceHole[k] !== g2.fenceHole[k] || g.block[k] !== g2.block[k]) assert.fail(`cell ${k} differs`);
  assert.ok(t.world.findPath(25, 10, 35, 10), 'still open on foot');
  const legacy = { ...snap, crawl: snap.hole }; delete legacy.hole;
  const u = fenceSim([{ role: 'sapper', x: 25, z: 10 }]);
  u.world.grid.deserialize(legacy);
  assert.equal(u.world.grid.fenceHoleCount, g.fenceHoleCount, 'old `crawl` cells: a hole now');
  assert.ok(u.world.findPath(25, 10, 35, 10), 'walked through');
});

test('cutters keep the hole (and its folded-back flaps) clear of the fence posts; centred on a cell', () => {
  const s = fenceSim([{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }]);
  // posts every 3 m along the wire (as the wire layer reports them: map-builder world.fencePosts)
  s.world.fencePosts = Array.from({ length: 21 }, (_, i) => ({ x: 30, z: i * 3, r: 0.04, clear: 1.0 }));
  const sp = s.cmd('sapper'), g = s.world.grid;
  const cell = { ...g.cellCenter(...Object.values(g.worldToCell(30, 9.1))), k: g.idx(g.worldToCell(30, 9.1).i, g.worldToCell(30, 9.1).j) };
  const { site, cells } = planHole(s.world, cell, { x: 30, z: 9.1 }, sp);   // a click 0.1 m from the post at z = 9
  const gapToPost = Math.min(...s.world.fencePosts.map((p) => Math.abs(p.z - site.z)));
  assert.ok(gapToPost >= 1.0 + 0.04 - 1e-6, `the hole (and its flaps) moved off the post: ${gapToPost.toFixed(2)} m to the nearest`);
  assert.ok(Math.abs(site.z - cells[0].z) < 1e-6, 'centred on the nearest cell');
  void B;
});

test('wire layer: the walk-through opening — strands cut up to ~1.95 m, the chain-link open from the ground to a jagged top cut, two flaps pulled aside', () => {
  const P = new Parts();
  buildWireRun('chainlink', [[0, 0], [12, 0]], { id: 'c', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P, runKey: 'c#0' });
  const H = { d: 4.5, side: 1, n: [0, 1], seed: 3, born: -Infinity };
  const holes = new Map([['c#0', [H]]]);
  // hole size: ~1.0 × 1.95 m from the ground (CONFIG mirrors it)
  assert.ok(HOLE.w >= 0.9 && HOLE.w <= 1.0 && HOLE.h >= 1.9 && HOLE.h <= 2.0 && HOLE.y0 === 0, `HOLE ${JSON.stringify(HOLE)}`);
  const C = CONFIG.abilities.cutHole;
  assert.ok(C.w === HOLE.w && C.h === HOLE.h && C.y0 === HOLE.y0, 'CONFIG cutHole mirrors HOLE');
  assert.ok(inHole(H, 4.5, 0.05) && inHole(H, 4.5, 1.0) && inHole(H, 4.5, 1.84) && inHole(H, 4.5 + 0.45, 1.0) && inHole(H, 4.5 - 0.45, 1.0), 'open from the ground up past head height, ~1 m wide');
  assert.ok(!inHole(H, 4.5, 2.1) && !inHole(H, 4.5 + 0.55, 1.0) && !inHole(H, 4.5 - 0.55, 1.0), 'closed above the top cut and beside');
  // strands: the live strands at 0.55 / 1.05 / 1.55 m are cut (2 ends each), the 2.0 m one and the arms are not
  const a1 = assembleRibbons(P, new Map(), () => 0, { barbs: false, holes });
  assert.equal(a1.cuts, 6, `three strands cut through the hole (${a1.cuts})`);
  assert.ok(a1.fray > 60, `chaotic cut ends along the top cut and the flaps' edges (${a1.fray})`);
  // the mesh: open from the ground to the top cut, whole above it, beside it and along the rest of the fence
  const tri = (geo, x, y) => {   // is (x, y) in the plane z = 0 covered by a triangle (the panel's own layer)?
    const p = geo.attributes.position.array, ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const [A, Bv, Cc] = [ix[i], ix[i + 1], ix[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
      if (Math.abs(A[2]) > 1e-4 || Math.abs(Bv[2]) > 1e-4 || Math.abs(Cc[2]) > 1e-4) continue;   // (the rim band is out of plane)
      const d = (u, v, w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
      const q = [x, y], s1 = d(q, A, Bv), s2 = d(q, Bv, Cc), s3 = d(q, Cc, A);
      if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) return true;
    }
    return false;
  };
  const pg1 = panelGeometry(P.panels, new Map(), holes);
  for (const [u, y] of [[0, 0.1], [0, 1.0], [0, 1.8], [0.4, 1.0], [-0.4, 0.3]]) assert.ok(!tri(pg1, 4.5 + u, y), `open at (${u}, ${y})`);
  for (const [u, y] of [[0, 2.2], [0.6, 1.0], [-0.6, 1.0]]) assert.ok(tri(pg1, 4.5 + u, y), `mesh at (${u}, ${y})`);
  assert.ok(tri(pg1, 8, 1.0) && tri(pg1, 1, 1.0), 'the rest of the fence stands');
  // the top cut is jagged: its height wanders by centimetres from snip to snip
  const S = holeShape(H), tops = Array.from({ length: 21 }, (_, i) => S.top(-0.4 + i * 0.04));
  assert.ok(Math.max(...tops) - Math.min(...tops) > 0.04, `jagged top cut (${Math.min(...tops).toFixed(3)}..${Math.max(...tops).toFixed(3)})`);
  // two flaps: the cut-out piece when shut (in the plane, filling the opening); pulled aside towards him (z > 0 = H.n)
  // and folded back beside the opening when open, crumpled (uneven out of their plane)
  const bb = (g) => { g.computeBoundingBox(); return g.boundingBox; };
  const shut = bb(holeFlapGeometry(H, 0.03, 0)), open = bb(holeFlapGeometry(H, 0.03, 1));
  assert.ok(shut.max.x - shut.min.x > 0.95 && Math.abs(shut.max.z) < 1e-6 && shut.max.y > 1.85, `shut: the cut-out pieces ${JSON.stringify(shut)}`);
  assert.ok(open.min.x < -0.85 && open.max.x > 0.85 && open.max.z > 0.08 && open.max.z < 0.45, `open: folded back beside the opening ${JSON.stringify(open)}`);
  const F = holeFlapPoints(H, 0.03, 1), inside = [];
  for (let i = 0; i < F.pos.length; i += 3) if (Math.abs(F.pos[i]) < 0.45 && F.pos[i + 1] > 0.1 && F.pos[i + 1] < 1.8) inside.push(i / 3);
  assert.equal(inside.length, 0, 'nothing of the flaps left in the opening');
  const zs = [];
  for (let i = 0; i < F.pos.length; i += 3) if (Math.abs(F.pos[i]) > 0.7) zs.push(F.pos[i + 2]);
  const zm = zs.reduce((a, b) => a + b, 0) / zs.length, zsd = Math.sqrt(zs.reduce((a, b) => a + (b - zm) ** 2, 0) / zs.length);
  assert.ok(zsd > 0.015, `crumpled, not a flat sheet (σ ${zsd.toFixed(3)} m out of plane)`);
  assert.equal(flapOpen(0), 0); assert.equal(flapOpen(Infinity), 1); assert.equal(flapOpen(HOLE.flapOpen + 0.01), 1);
  // the hollow and the bits on the ground
  const Hp = { ...H, x: 4.5, z: 0, tx: 1, tz: 0, look: 'temperate' };
  const a2 = assembleRibbons(P, new Map(), () => 0, { barbs: false, holes: new Map([['c#0', [Hp]]]) });
  assert.ok(a2.bits >= 8, `snipped bits (${a2.bits})`);
  assert.equal(holeShadeGeometry(holes), null, 'no position: no hollow');
  assert.ok(holeShadeGeometry(new Map([['c#0', [Hp]]]))?.attributes.position.count >= 25, 'the hollow under the hole');
  // field fence: every strand up to ~1.95 m is cut (two ends each)
  const Fp = new Parts();
  buildWireRun('field_fence', [[0, 0], [12, 0]], { id: 'f', type: 'fence', h: 1.5 }, { parts: Fp, runKey: 'f#0' });
  const f1 = assembleRibbons(Fp, new Map(), () => 0, { barbs: false, holes: new Map([['f#0', [H]]]) });
  const nStrands = Fp.items.filter((it) => it.cuttable && !it.tie && it.sArr && it.path.some((q) => Math.abs(q[0] - 4.5) < 0.3)).length;
  assert.ok(f1.cuts === 2 * nStrands && nStrands >= 4, `field fence: all ${nStrands} strands cut (${f1.cuts} ends)`);
});

/**
 * Edge variety of a hole's cut ends (holeFray's wire ends, not the bright tips / folds): how many, their lengths' spread
 * (CV), how many are long (≥ 0.17 m: dangling), how many are kinked (a turn > 50° between two consecutive segments),
 * and how jagged the cut line is (RMS distance of each end's root from the midpoint of its neighbours along the cut).
 */
export function edgeVariety(holeFrayFn, p, H) {
  const ends = [];
  const rec = { strand(path, o = {}) { if ((o.kind ?? 0) === 0) ends.push(path.map((q) => [...q])); }, seg() {}, barbs() {}, snowBeads() {} };
  holeFrayFn(rec, p, H, () => 0, wireRng(0xe0e));
  const len = (path) => path.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - path[i][0], q[1] - path[i][1], q[2] - path[i][2]), 0);
  const L = ends.map(len), mean = L.reduce((a, b) => a + b, 0) / L.length, sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  const turn = (path) => {
    let mx = 0;
    for (let i = 2; i < path.length; i++) {
      const a = [0, 1, 2].map((j) => path[i - 1][j] - path[i - 2][j]), b = [0, 1, 2].map((j) => path[i][j] - path[i - 1][j]);
      const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
      mx = Math.max(mx, Math.acos(Math.max(-1, Math.min(1, c))));
    }
    return mx;
  };
  // the roots along the top of the cut (the fixed mesh in the fence plane: within 15 cm of the highest, over the
  // opening's middle 0.9 m), ordered along it
  const inPlane = [...new Map(ends.map((e) => [`${e[0][0].toFixed(4)},${e[0][1].toFixed(4)}`, e[0]])).values()].filter((q) => Math.abs(q[2]) < 1e-3);
  const ymax = Math.max(...inPlane.map((q) => q[1]));
  const roots = inPlane.filter((q) => q[1] > ymax - 0.15 && Math.abs(q[0] - H.d) < 0.45).sort((a, b) => a[0] - b[0]);
  let jag = 0;
  for (let i = 1; i < roots.length - 1; i++) jag += (roots[i][1] - (roots[i - 1][1] + roots[i + 1][1]) / 2) ** 2;
  jag = Math.sqrt(jag / Math.max(1, roots.length - 2));
  return { n: ends.length, roots: roots.length, lenCV: +(sd / mean).toFixed(3), long: L.filter((v) => v >= 0.17).length, kinked: +(ends.filter((e) => turn(e) > (50 * Math.PI) / 180).length / ends.length).toFixed(3), jag: +jag.toFixed(4) };
}

test('cut edges are chaotic (edge-variety metric; the crawl hole\'s neat fringe fails it): lengths, kinks, dangling ends, a jagged cut', () => {
  // (the crawl hole on master, 2026-10-08: n 105, lenCV 0.434, long 0, kinked 0, jag 0.004 m — whatever the hole's seed)
  const P = new Parts();
  buildWireRun('chainlink', [[0, 0], [12, 0]], { id: 'c', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P, runKey: 'c#0' });
  const p = P.panels.find((q) => q.da <= 4.5 && q.db >= 4.5);
  for (const seed of [0, 3, 5]) {
    const v = edgeVariety(holeFray, p, { d: 4.5, side: 1, n: [0, 1], seed, born: -Infinity });
    console.log('  edge variety', seed, JSON.stringify(v));
    assert.ok(v.n >= 80, `plenty of cut ends (${v.n})`);
    assert.ok(v.lenCV >= 0.6, `lengths vary (CV ${v.lenCV})`);
    assert.ok(v.long >= 3, `a few dangling longer ends (${v.long} ≥ 0.17 m)`);
    assert.ok(v.kinked >= 0.15, `kinked ends (${v.kinked})`);
    assert.ok(v.jag >= 0.006, `a jagged top cut (${v.jag} m)`);
  }
});

test('nothing of the cut reaches into the way of a man walking through upright (ends, tails of cut strands)', () => {
  const P = new Parts();
  buildWireRun('chainlink', [[0, 0], [12, 0]], { id: 'c', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P, runKey: 'c#0' });
  buildWireRun('field_fence', [[0, 5], [12, 5]], { id: 'f', type: 'fence', h: 1.5 }, { parts: P, runKey: 'f#1' });
  for (const seed of [0, 3, 5]) {
    const Hc = { d: 4.5, side: 1, n: [0, 1], seed, born: -Infinity, x: 4.5, z: 0, tx: 1, tz: 0 }, Hf = { ...Hc, x: 4.5, z: 5 };
    const pc = P.panels.find((q) => q.da <= 4.5 && q.db >= 4.5);
    const pts = [];
    const rec = { strand(path, o = {}) { if ((o.kind ?? 0) === 0 || o.r < 0.0032) pts.push(...path); }, seg() {}, barbs() {}, snowBeads() {} };
    holeFray(rec, pc, Hc, () => 0, wireRng(0xabc + seed));
    const a = assembleRibbons(P, new Map(), () => 0, { barbs: false, holes: new Map([['c#0', [Hc]], ['f#1', [Hf]]]) });
    for (const buf of a.buffers.values()) { const pp = buf.pos; for (let i = 0; i < pp.length; i += 6) pts.push([pp[i], pp[i + 1], pp[i + 2]]); }
    const wayC = holeWalkway({ o: [4.5, 0, 0], tx: 1, tz: 0, n: [0, 1] }), wayF = holeWalkway({ o: [4.5, 0, 5], tx: 1, tz: 0, n: [0, 1] });
    const hits = pts.filter((q) => (Math.abs(q[2]) < 1 && wayC(q)) || (Math.abs(q[2] - 5) < 1 && wayF(q)));
    assert.equal(hits.length, 0, `seed ${seed}: wire in the walkway ${JSON.stringify(hits.slice(0, 3))}`);
  }
  void flapFrame;
});

test('the cutting pose: kneeling for the lower snips, on his feet for the top cut, both hands pulling the flaps aside', () => {
  const H = CONFIG.abilities.cutHole, pts = snipPoints(H.snips.length, 1);
  assert.ok(pts[0].y < 0.6 && pts[pts.length - 1].y > 1.85, 'from low on the slit to the top cut');
  const at = (t) => cutPose('cut', t, CONFIG.abilities.cutters, 1);
  assert.equal(at(H.snips[0]).stand, 0, 'kneeling at the first snip');
  assert.equal(at(H.snips[H.snips.length - 1]).stand, 1, 'standing at the last');
  const pull = at(H.peel + 0.2);
  assert.ok(pull.L.u > 0.05 && pull.R.u < -0.05 && pull.L.out > 0.1 && pull.R.out > 0.1, `hands pull the two flaps apart, towards him ${JSON.stringify([pull.L, pull.R])}`);
});

test('wire layer (game path): the Sapper\'s hole is re-derived from the grid, the flaps open and settle (their cut ends then), a load restores it; a man walks through upright in M3', () => {
  const m3 = getMission('m03'), world = new World({ size: m3.size, scene: new THREE.Scene(), mission: m3 }), handle = buildMap(world, m3), W = handle.wire, g = world.grid;
  assert.ok(world.fencePosts?.length > 20, `the wire layer's posts for the cutters (${world.fencePosts?.length})`);
  // cut like the cutters do: the planned site's cells become fenceHole, then the event
  const cell0 = g.worldToCell(57.6, 79.0), from = { x: 59.3, z: 77.6 };
  let cell = null;
  for (let r = 0; r <= 2 && !cell; r++) for (let dj = -r; dj <= r && !cell; dj++) for (let di = -r; di <= r && !cell; di++) {
    const k = g.idx(cell0.i + di, cell0.j + dj);
    if (g.block[k] === B.FENCE) cell = { k, ...g.cellCenter(cell0.i + di, cell0.j + dj) };
  }
  assert.ok(cell, 'a fence cell at the M3 cut');
  const plan = planHole(world, cell, { x: 57.6, z: 79.0 }, from);
  const nearestPost = Math.min(...world.fencePosts.map((p) => Math.hypot(p.x - plan.site.x, p.z - plan.site.z)));
  assert.ok(nearestPost >= 0.75, `M3 hole clear of the posts (${nearestPost.toFixed(2)} m)`);
  world.time = 100;
  g.setFenceHole(plan.cells[0].k, 1);
  g.version++;
  world.events.emit('structure:destroyed', { type: 'fence-gap', id: 'st_fence', hole: true, x: plan.site.x, z: plan.site.z });
  assert.ok(W.holes.size === 1 && W.gaps.size === 0 && W.flaps.length === 1, 'a hole with its flaps, no gap');
  const [[, [H]]] = [...W.holes];
  assert.ok(Number.isFinite(H.x) && H.look && H.settled === false, `the hole knows where it is; flaps not settled ${JSON.stringify({ x: H.x, look: H.look, settled: H.settled })}`);
  assert.ok(W.group.getObjectByName('wire:holeShade'), 'the hollow under it');
  const fray0 = W.stats.cuts;
  W.update(0);
  world.time = 100 + HOLE.flapOpen + 0.1; W.update(0);
  const [[, [H2]]] = [...W.holes];
  assert.ok(H2.settled === true, 'flaps settled → layer rebuilt with their cut ends');
  void fray0;
  // the flaps: in the plane over the opening when shut, beside it (|u| > hw) and towards the flaps' side when open
  const fm = W.flaps[0], a = fm.geometry.attributes.position;
  let far = 0;
  for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)) > 0.6) far++;
  assert.ok(far > a.count * 0.3, `folded back beside the opening (${far}/${a.count} vertices beyond 0.6 m)`);
  // a save / load restores it
  const saved = g.serialize(), w2 = new World({ size: m3.size, scene: new THREE.Scene(), mission: m3 }), h2 = buildMap(w2, m3);
  w2.grid.deserialize(saved); h2.wire.update(0);
  assert.equal(h2.wire.holes.size, 1, 'restored');
  assert.equal(h2.wire.flaps.length, 1);
  assert.ok([...h2.wire.holes.values()][0][0].settled, 'a loaded hole: flaps open, ends drawn');
  h2.dispose();
  // a man walks through it upright (the real M3 nav: visual nav stamps, body solids round the wire)
  // (from off to one side to off to the other: his path has to find the hole, not run straight through its middle)
  const P0 = plan.site, sap = new Commando({ role: 'sapper', x: P0.x + P0.nx * 1.8 + P0.tx * 0.9, z: P0.z + P0.nz * 1.8 + P0.tz * 0.9, campaign: 'BEL' });
  world.add(sap); world.rebuildSpatial();
  const goal = { x: P0.x - P0.nx * 2.2 - P0.tx * 0.8, z: P0.z - P0.nz * 2.2 - P0.tz * 0.8 };
  assert.ok(sap.issue({ type: 'move', x: goal.x, z: goal.z }), 'move order through the hole');
  const side = () => (sap.x - plan.site.x) * plan.site.nx + (sap.z - plan.site.z) * plan.site.nz;
  let down = 0, offCentre = 0;
  for (let i = 0; i < 60 * 15 && (sap.path || Math.abs(side()) < 1.5 || side() > 0); i++) {
    world.rebuildSpatial(); sap.update(1 / 60); world.time += 1 / 60; world.tick++;
    if (sap.stance !== 'stand') down++;
    if (Math.abs(side()) < 0.15) offCentre = Math.max(offCentre, Math.abs((sap.x - plan.site.x) * plan.site.tx + (sap.z - plan.site.z) * plan.site.tz));
  }
  assert.ok(side() < -1.5, `through the M3 hole on his feet (${side().toFixed(2)} m past the wire)`);
  assert.equal(down, 0, 'upright all the way');
  console.log(`  M3 walk-through: crossed ${offCentre.toFixed(3)} m from the hole centre`);
  assert.ok(offCentre < HOLE.w / 2 - 0.25, `crossed the wire ${offCentre.toFixed(2)} m from the hole's centre (shoulders, 0.23 m, inside the 1 m opening)`);
  handle.dispose();
});
