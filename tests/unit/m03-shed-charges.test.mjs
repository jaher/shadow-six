/**
 * M3 station shed (user 2026-10-08, watching the solution film: "The sappler goes under the bridge of the house, why?
 * Does it need to inside through the ramp?"). The shed is a Norwegian barn whose ramp (its bridge) climbs to the
 * threshing door; the two time bombs lay on the ground beside the ramp, and the Sapper crawled under the bridge for
 * them. Now:
 *  - the charges lie INSIDE the shed, on its loft behind the threshing door: no ground anywhere near them, and the hand
 *    on them sends the Sapper up the ramp and in through the door (the dam bunker's walk-in, abilities/bunker-entry.js);
 *  - the ramp is a walkable slope raised over its whole width right to the barn wall: no cell under it is ground, and
 *    no unit — walking or crawling, sent anywhere near it — is ever under it.
 */
import { test, assert } from './lib.mjs';
import { getMission } from '../../src/missions/index.js';
import { pointInPolygon } from '../../src/core/math.js';
import { findPath } from '../../src/world/pathfinding.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { loadGrid } from './mission-check.mjs';

const def = getMission('m03');
const SHED = def.structures.find((s) => s.id === 'st_shed');
const RAMP = SHED.ramps?.[0];
const ITEM = def.items.find((i) => i.id === 'bombs_shed');
/** The ramp's deck in plan (its band, full width) and its height along it at (x, z). */
const deck = () => {
  const [[bx, bz], [tx, tz]] = [RAMP.points[0], RAMP.points[RAMP.points.length - 1]], L = Math.hypot(tx - bx, tz - bz);
  const ux = (tx - bx) / L, uz = (tz - bz) / L, hw = RAMP.width / 2;
  const along = (x, z) => (x - bx) * ux + (z - bz) * uz, across = (x, z) => Math.abs(-(x - bx) * uz + (z - bz) * ux);
  return {
    under: (x, z, m = 0) => { const s = along(x, z); return s >= m && s <= L - m && across(x, z) <= hw - m; },
    y: (x, z) => RAMP.y0 + (RAMP.y1 - RAMP.y0) * Math.min(1, Math.max(0, along(x, z) / L)),
  };
};
const footprint = (s) => {
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0), hw = s.w / 2, hd = s.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [s.x + u * c - v * n, s.z + u * n + v * c]);
};

test('m03 shed: the charges lie inside the shed, on its loft — no ground within reach of them', () => {
  assert.ok(ITEM, 'bombs_shed');
  assert.equal(ITEM.inside, 'st_shed', 'the item is declared inside the shed');
  assert.ok(pointInPolygon(ITEM.x, ITEM.z, footprint(SHED)), `inside the shed's walls (${ITEM.x}, ${ITEM.z})`);
  assert.ok(ITEM.y > 2, `on the loft floor (y ${ITEM.y})`);
  const { grid } = loadGrid(def);
  for (let a = 0; a < 360; a += 15) for (const r of [0.4, 0.8, 1.2, 1.6]) {
    const x = ITEM.x + r * Math.cos((a * Math.PI) / 180), z = ITEM.z + r * Math.sin((a * Math.PI) / 180);
    for (const o of [undefined, { crawl: true }]) assert.equal(grid.walkableAt(x, z, o), false, `(${x.toFixed(2)},${z.toFixed(2)}) ${o ? 'crawl' : 'walk'} beside the charges`);
  }
  // its walk-in: from the ramp's top through the threshing door
  const e = SHED.entry;
  assert.ok(e && e.door === 'threshing' && Math.abs(e.y - RAMP.y1) < 1e-9, 'the shed walk-in goes through the threshing door at the loft floor');
  assert.ok(deck().under(...e.path[0]), 'its outer end is on the ramp');
});

test('m03 shed: the ramp is raised over its whole width right to the wall — nothing under it is ground', () => {
  assert.ok(RAMP?.smooth, 'the shed ramp is a smooth slope');
  const { grid } = loadGrid(def), D = deck();
  let n = 0;
  for (let x = 37; x <= 43; x += 0.25) for (let z = 83.5; z <= 93; z += 0.25) {
    if (!D.under(x, z, 0.3) || D.y(x, z) < 0.4) continue; // (its foot is at ground level: that is where one steps on)
    n++;
    assert.ok(grid.elevAt(x, z) >= D.y(x, z) - 0.35, `(${x},${z}): cell at ${grid.elevAt(x, z).toFixed(2)} m under a deck at ${D.y(x, z).toFixed(2)} m`);
  }
  assert.ok(n > 100, `cells checked (${n})`);
  // the old way to the charges, under the bridge by the byre door: no path ends there on the ground
  for (const [x, z] of [[39.2, 85.0], [40.0, 85.6], [40.8, 86.2]]) {
    const p = findPath(grid, 36.5, 86.5, x, z, { maxNodes: 200000, crawl: true });
    if (!p) continue;
    const last = p[p.length - 1];
    assert.ok(grid.elevAt(last.x, last.z) > 1.2 || Math.hypot(last.x - x, last.z - z) > 0.8, `a crawler sent to (${x},${z}) ends at (${last.x.toFixed(2)},${last.z.toFixed(2)}) on the ground`);
  }
});

test('m03 shed: the Sapper takes the charges by going up the ramp and in at the threshing door — never under the ramp', () => {
  const sim = headlessMission('m03'), w = sim.world, D = deck();
  for (const e of w.enemies) { e.alive = false; e.removed = true; } // (the route, not stealth)
  const sap = w.commandos.find((c) => c.role === 'sapper');
  const item = w.interactables.find((i) => i.tag === 'bombs_shed');
  assert.ok(item && item.params.inside === 'st_shed', 'the charges are an inside item');
  // from where the charges used to lie, beside the ramp's foot of the bridge (he once crawled under it from here)
  for (const stance of ['stand', 'crawl']) {
    const s2 = headlessMission('m03'), w2 = s2.world;
    for (const e of w2.enemies) { e.alive = false; e.removed = true; }
    const sp = w2.commandos.find((c) => c.role === 'sapper'), it = w2.interactables.find((i) => i.tag === 'bombs_shed');
    sp.setPosition(37.4, 86.6); sp.y = 0;
    if (stance === 'crawl') sp.setStance('crawl');
    for (let i = 0; i < 60; i++) s2.step();
    assert.ok(sp.issue({ type: 'ability', id: 'hand', target: it }), `${stance}: ${sp.lastRefusal?.text}`);
    let inside = false, maxY = 0, under = 0, took = -1;
    for (let i = 0; i < 60 * 60; i++) {
      s2.step();
      if (sp.insideStructure) inside = true;
      maxY = Math.max(maxY, sp.y || 0);
      if (D.under(sp.x, sp.z, 0.2) && (sp.y || 0) < D.y(sp.x, sp.z) - 0.35) under++;
      if (took < 0 && (sp.inventory.get('timeBomb') ?? 0) >= 2) { took = i; assert.ok(sp.insideStructure, `${stance}: he takes them inside`); }
      if (took >= 0 && !sp.currentAction && !sp.pendingAbility && !sp.scripted) break;
    }
    assert.equal(sp.inventory.get('timeBomb') ?? 0, 2, `${stance}: both charges taken`);
    assert.ok(inside, `${stance}: he went in`);
    assert.ok(maxY > 2.3, `${stance}: up the ramp to the loft floor (max y ${maxY.toFixed(2)})`);
    assert.equal(under, 0, `${stance}: never under the ramp`);
    assert.equal(sp.insideStructure ?? null, null, `${stance}: back out`);
    assert.ok(D.under(sp.x, sp.z) && Math.abs((sp.y || 0) - D.y(sp.x, sp.z)) < 0.4, `${stance}: out on the ramp's top (${sp.x.toFixed(2)},${sp.z.toFixed(2)} y ${(sp.y || 0).toFixed(2)})`);
    // and down again: off the ramp at its foot
    sp.issue({ type: 'move', x: 37.4, z: 94 });
    for (let i = 0; i < 60 * 20; i++) {
      s2.step();
      if (D.under(sp.x, sp.z, 0.2) && (sp.y || 0) < D.y(sp.x, sp.z) - 0.35) under++;
    }
    assert.equal(under, 0, `${stance}: down the ramp, never under it`);
    assert.ok(Math.hypot(sp.x - 37.4, sp.z - 94) < 0.8, `${stance}: down at the foot`);
  }
  assert.ok(sap && item);
});

test('m03 shed: a save made while the Sapper is inside the shed resumes the walk in, the take and the walk out', () => {
  const s = headlessMission('m03'), w = s.world;
  for (const e of w.enemies) { e.alive = false; e.removed = true; }
  const sp = w.commandos.find((c) => c.role === 'sapper'), it = w.interactables.find((i) => i.tag === 'bombs_shed');
  sp.setPosition(40, 85.0); sp.y = w.grid.surfaceY(40, 85.0);
  assert.ok(sp.issue({ type: 'ability', id: 'hand', target: it }), sp.lastRefusal?.text);
  for (let i = 0; i < 600 && !sp.insideStructure; i++) s.step();
  for (let i = 0; i < 20; i++) s.step(); // well inside, not taken yet
  assert.ok(sp.insideStructure && (sp.inventory.get('timeBomb') ?? 0) === 0, 'inside, before the take');
  const d = sp.serialize();
  assert.equal(d.action?.id, 'hand');
  sp.deserialize(d);
  assert.ok(sp.resumeSavedAction(), 'the walk-in resumes');
  for (let i = 0; i < 60 * 10 && (sp.currentAction || sp.scripted); i++) s.step();
  assert.equal(sp.inventory.get('timeBomb') ?? 0, 2, 'both taken after the load');
  assert.equal(sp.insideStructure ?? null, null, 'he came back out');
  assert.ok((sp.y || 0) > 2, `out on the ramp's top (y ${(sp.y || 0).toFixed(2)})`);
});
