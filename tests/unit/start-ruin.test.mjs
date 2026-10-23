/**
 * M3's start cover (user 2026-10-21: "replace the low wall at the beginning with a tower on the right side in ruins with
 * a small wall with boulders (similar to the original game but with the tower on the right side). Make it in a way
 * commandos dont have to rush to crawl to not be seen. That structure should hide them"): a ruined watchtower at the
 * E end (start_tower, art/ruin-tower.js), a broken dry-stone wall W from it (start_wall) and snow-capped boulders
 * along its foot (start_rocks, art/boulder-row.js):
 *  - what you see is what blocks: every part's footprint is its drawn masonry / rock (the plan B.LOW, what stands
 *    eye-high B.HIGH), in the grid-only build as in the browser;
 *  - tall enough: from anywhere on p1's path a standing man behind it is hidden by the height sight rule (§4.2), and
 *    its eye-high masonry and rock leave no gap a sight line slips through;
 *  - an idle team at the starts is seen by nobody for 130 s, and the strip along the wall stays unseen for a standing
 *    man through a whole round of p1's beat (they move along it on their feet);
 *  - the solution's stage A is as it was: the Marine's harpoon line from the wall's W end to p1's troopers at the
 *    decoy is open.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { boulderRowNavParts, boulderTopAt, boulderBandHull, buildBoulderRow, SIGHT_Y, BODY_BAND } from '../../src/art/boulder-row.js';
import { towerNavParts, wallNavParts, towerSectors, wallColumns, towerHeight, wallHeight, buildRuinTower, buildRuinWall, towerDoorSpan } from '../../src/art/ruin-tower.js';
import { canSee } from '../../src/ai/perception.js';
import { ownerHeight } from '../../src/world/placement.js';
import { shotSight } from '../../src/abilities/common.js';
import { pointInPolygon } from '../../src/core/math.js';
import { CONFIG } from '../../src/config.js';
import { B } from '../../src/world/grid.js';
import M3 from '../../src/missions/m03_reverse_engineering.js';

const S_ = (id) => M3.structures.find((s) => s.id === id);
const TOWER = S_('start_tower'), WALL = S_('start_wall'), ROCKS = S_('start_rocks');
/** A def's own frame → world. */
const toWorld = (d) => ([u, v]) => [d.x + u * Math.cos(d.rot ?? 0) - v * Math.sin(d.rot ?? 0), d.z + u * Math.sin(d.rot ?? 0) + v * Math.cos(d.rot ?? 0)];
/** Distance (m) from (x, z) to a polygon's edges. */
const edgeDist = (x, z, P) => Math.min(...P.map(([ax, az], i) => {
  const [bx, bz] = P[(i + 1) % P.length], ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}));
const inside = (x, z, polys, tol = 1e-3) => polys.some((P) => pointInPolygon(x, z, P) || edgeDist(x, z, P) < tol);

let SIM = null;
/** M3, grid only (the build the solutions' headless runs and these checks share). */
const m03 = () => (SIM ||= headlessMission('m03'));

test('start ruin: M3 starts behind a ruined tower on the right, a broken wall and boulders; the old 1.6 m stub gone', () => {
  assert.ok(TOWER && WALL && ROCKS, 'start_tower, start_wall, start_rocks');
  assert.equal(WALL.variant, 'wall_dry_ruin', 'start_wall is the new dry-stone wall, not the 1.6 m wall_ruin stub');
  assert.ok(TOWER.x > WALL.x + WALL.w / 2 - 0.5 && TOWER.x > Math.max(...M3.commandos.map((c) => c.x)), 'the tower at the E end (the right, from the default camera), past the team');
  assert.ok(Math.abs(WALL.x - WALL.w / 2 - 100) < 0.05, 'the wall ends W where the old one did (x 100)');
  // (each part's sight height: its lowest eye-high head, rounded down to the cm)
  assert.ok(TOWER.h <= towerHeight(TOWER) && towerHeight(TOWER) - TOWER.h < 0.01 && TOWER.h > 2.2, `the tower's sight height is its lowest head (${towerHeight(TOWER).toFixed(3)})`);
  assert.ok(WALL.h <= wallHeight(WALL) && wallHeight(WALL) - WALL.h < 0.01 && WALL.h > SIGHT_Y, `the wall's sight height is its lowest eye-high head (${wallHeight(WALL).toFixed(3)})`);
  const big = ROCKS.boulders.filter((b) => b[4] > SIGHT_Y);
  assert.ok(big.length >= 3 && Math.min(...big.map((b) => b[4])) >= 1.85, 'the boulders that cover the wall\'s notches stand 1.85 m+');
});

test('start ruin: what you see is what blocks — the masonry and the rock are their footprints', () => {
  // tower and wall: the drawn masonry (node build) at body height lies inside their B.LOW plans; their B.HIGH parts are
  // exactly the sectors / columns whose heads stand eye-high
  for (const [d, parts, build] of [[TOWER, towerNavParts(TOWER), buildRuinTower], [WALL, wallNavParts(WALL), buildRuinWall]]) {
    const low = parts.filter((p) => p.block === B.LOW).map((p) => p.points), g = build(d);
    let n = 0, out = 0;
    g.traverse((m) => {
      if (!m.isMesh || !/ruinStone/.test(m.name)) return;
      const P = m.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const y = P.getY(i);
        if (y < BODY_BAND[0] || y > BODY_BAND[1]) continue;
        n++;
        if (!inside(P.getX(i), P.getZ(i), low, 0.02)) out++;
      }
    });
    assert.ok(n > 100 && out === 0, `${d.id}: ${out} of ${n} drawn masonry vertices at body height outside its plan`);
  }
  const tHigh = towerNavParts(TOWER).filter((p) => p.block === B.HIGH).length;
  // a sector stands eye-high where both its heads are -- but the doorway pierces its span: the solid ranges
  // either side of the opening are what carry B.HIGH (the lintel stands over eye height, so the opening itself
  // never blocks; a lintel at or under eye height would leave the sector whole and fail this count)
  const doorSpan = towerDoorSpan(TOWER), solidRanges = (a0, a1) => {
    if (!doorSpan || doorSpan.lintel <= SIGHT_Y || a1 <= doorSpan.a0 || a0 >= doorSpan.a1) return 1;
    return (a0 < doorSpan.a0 ? 1 : 0) + (a1 > doorSpan.a1 ? 1 : 0);
  };
  const tTall = towerSectors(TOWER).filter((q) => q[2] > SIGHT_Y).reduce((n, q) => n + solidRanges(q[0], q[1]), 0);
  assert.equal(tHigh, tTall, 'a tower sector is eye-high where both its heads are');
  for (const [u0, u1, h] of wallColumns(WALL)) {
    const mid = [WALL.x - WALL.w / 2 + (u0 + u1) / 2, WALL.z], high = wallNavParts(WALL).filter((p) => p.block === B.HIGH).map((p) => p.points.map(toWorld(WALL)));
    assert.equal(inside(mid[0], mid[1], high, 0), h > SIGHT_Y, `wall column at u ${u0.toFixed(2)} (head ${h.toFixed(2)}): eye-high ⇔ B.HIGH`);
  }
  // boulders: the drawn rock at body height inside their outlines; where the footprint says eye-high rock, it is
  const bl = boulderRowNavParts(ROCKS), bLow = bl.filter((p) => p.block === B.LOW).map((p) => p.points), bHigh = bl.filter((p) => p.block === B.HIGH);
  const gr = buildBoulderRow({ ...ROCKS, stones: [] }).children.find((m) => m.name === 'boulder_row:granite'), P = gr.geometry.attributes.position;
  let n = 0, out = 0;
  for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < BODY_BAND[0] || y > BODY_BAND[1]) continue; n++; if (!inside(P.getX(i), P.getZ(i), bLow)) out++; }
  assert.ok(n > 500 && out === 0, `${out} of ${n} drawn rock vertices at body height outside the boulders' outlines`);
  const tall = ROCKS.boulders.filter((q) => q[4] > SIGHT_Y);
  let m = 0, lowS = 0;
  for (const [k, p] of bHigh.entries()) {
    const xs = p.points.map((q) => q[0]), zs = p.points.map((q) => q[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
      if (!pointInPolygon(x, z, p.points) || edgeDist(x, z, p.points) < 0.03) continue;
      m++;
      if (!((boulderTopAt(tall[k], x, z) ?? 0) >= SIGHT_Y - 0.02)) lowS++;
    }
  }
  assert.ok(m > 200 && lowS / m < 0.02, `the boulders' eye-height sections stand eye-high (${lowS} of ${m} samples lower)`);
  // the grid holds them: every blocked cell of these owners has its centre on that kind of masonry / rock (the wall's
  // plan out to a man's reach off its faces: WALL_REACH)
  const w = m03().world, g = w.grid;
  for (const [d, parts] of [[TOWER, towerNavParts(TOWER)], [WALL, wallNavParts(WALL)], [ROCKS, bl]]) {
    const owner = w.structures.get(d.id).owner, lw = parts.filter((p) => p.block === B.LOW).map((p) => p.points.map(toWorld(d))), hg = parts.filter((p) => p.block === B.HIGH).map((p) => p.points.map(toWorld(d)));
    let cells = 0, wrong = 0;
    for (let k = 0; k < g.size; k++) {
      if (g.owner[k] !== owner || !g.block[k]) continue;
      cells++;
      const x = (k % g.cols + 0.5) * g.cell, z = (Math.floor(k / g.cols) + 0.5) * g.cell;
      if (!inside(x, z, g.block[k] === B.HIGH ? hg : lw, 0)) wrong++;
    }
    assert.ok(cells > 20 && wrong === 0, `${d.id}: ${wrong} of ${cells} cells blocked off its drawn shape`);
  }
});

test('start ruin: its eye-high masonry and rock are one barrier from the wall\'s W end to the tower (no gap a sight line slips through)', () => {
  const g = m03().world.grid, i0 = Math.floor(100.5 / g.cell), i1 = Math.floor((TOWER.x + 1) / g.cell), jN = Math.floor(5.25 / g.cell), jS = Math.floor(11.25 / g.cell);
  const seen = new Set(), q = [];
  for (let i = i0; i <= i1; i++) { const k = g.idx(i, jN); if (g.block[k] !== B.HIGH) { seen.add(k); q.push([i, jN]); } }
  let leak = null;
  while (q.length && !leak) {
    const [i, j] = q.pop();
    if (j >= jS) { leak = [i, j]; break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj, k = g.idx(ii, jj);
      if (ii < i0 || ii > i1 || jj < jN || seen.has(k) || g.block[k] === B.HIGH) continue;
      seen.add(k); q.push([ii, jj]);
    }
  }
  assert.equal(leak, null, `a way through the eye-high masonry and rock at ${leak && leak.map((v) => (v + 0.5) * g.cell)}`);
});

test('start ruin: from anywhere on p1\'s path a standing man behind it is hidden (§4.2 height sight)', () => {
  const w = m03().world, g = w.grid, heightOf = ownerHeight(w), S = CONFIG.stealth, bad = [];
  let lines = 0;
  for (let gx = 62; gx <= 146; gx += 1) {
    for (let tx = 101.5; tx <= 112.5; tx += 0.5) for (const tz of [6.25, 6.75]) {
      // (the lines that cross the wall's line between its W end and the tower: the rest pass round them)
      const t = (WALL.z - 13) / (tz - 13), cx = gx + (tx - gx) * t;
      if (cx < 100.6 || cx > TOWER.x + TOWER.r) continue;
      lines++;
      const seen = g.sightLine(gx, 13, tx, tz, { eyeY: S.eyeHeight, targetY: S.sight.stand, targetLow: false, viewerY: 0, targetBaseY: 0, lowCover: 'block', heightOf, dynamic: false });
      if (seen) bad.push(`(${gx},13)→(${tx},${tz})`);
    }
  }
  assert.ok(lines > 1500, `${lines} sight lines`);
  assert.equal(bad.length, 0, `seen over or through the ruin: ${bad.slice(0, 8).join(' ')}`);
});

test('start ruin: the idle team at its starts is seen by nobody for 130 s; the strip along the wall stays unseen standing', () => {
  const sim = headlessMission('m03'), w = sim.world, seen = [], strip = new Map();
  const dummy = (x, z) => ({ x, z, y: 0, isLow: false, isVisibleToEnemies: true, kind: 'commando', alive: true });
  const pts = [];
  for (let x = 102; x <= 112.5; x += 0.5) pts.push(dummy(x, 6.25), dummy(x, 6.75));
  // (a whole round of p1's beat — 84 m each way and its halts: ~190 s — for the strip)
  const n = Math.round(200 / sim.dt);
  for (let k = 0; k < n; k++) {
    sim.step();
    if (k % 6) continue;
    for (const e of w.enemies) {
      if (!e.alive || !e.vision) continue;
      if (w.time <= 130) for (const c of w.commandos) if (canSee(e, c, w) !== 'none') seen.push(`${e.tag}>${c.role}@${w.time.toFixed(1)}`);
      if (Math.hypot(e.x - 108, e.z - 8) < 40) for (const p of pts) if (canSee(e, p, w) !== 'none') strip.set(`${p.x},${p.z}`, `${e.tag}@${w.time.toFixed(1)}`);
      e.nervousness = 0;
    }
  }
  assert.equal(seen.length, 0, `seen at the start: ${seen.slice(0, 6).join(' ')}`);
  assert.ok(w.commandos.every((c) => c.stance === 'stand' && Math.abs(c.z - 6.75) < 0.01), 'standing at their starts');
  assert.equal(strip.size, 0, `seen standing on the strip x 102–112.5: ${[...strip].slice(0, 6).map(([k, v]) => `(${k}) ${v}`).join(' ')}`);
});

test('start ruin: stage A as it was — the Marine\'s harpoon line from the wall\'s W end to p1\'s troopers at the decoy is open', () => {
  const w = m03().world;
  // (the Marine lies at the W end (99.3, 6.4); the sergeant stares at the decoy from ~(97.9, 15.1), his two troopers
  // stopped behind him, E of him, ~1.2 m apart: as the solution's run finds them)
  const me = { x: 99.3, z: 6.4, y: 0, stance: 'crawl' };
  for (const [x, z] of [[99.2, 14.8], [100.4, 14.6], [100.9, 14.8], [99.8, 15.0]]) {
    const t = { x, z, y: 0, kind: 'enemy', isLow: false };
    assert.ok(Math.hypot(x - me.x, z - me.z) <= CONFIG.weapons.harpoon.range, 'within the harpoon\'s reach');
    assert.ok(shotSight(w, me, t), `line of fire from (99.3, 6.4) to (${x}, ${z})`);
  }
});
