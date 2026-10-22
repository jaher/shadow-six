/**
 * Lying down and crawling next to a wall never puts the lying body into it (clipping seeds 7 / 11 on master after the
 * game-rules merge: M3's Diver and Green Beret, standing at their starts 0.95 m from `start_wall` and facing it, were
 * told to crawl; their bodies fell along their heading, head and hands 0.11 m into the ruin). Unit.setStance /
 * _lieDownPose: a man getting down lies as he faces when all of him fits (placement proneClear), else facing his path,
 * else at the nearest heading (or spot, ≤ 0.5 m) that fits — all of him, the crawl stroke's knees and toes too; lying, he turns only while all of him stays clear — the
 * other way round when that is clear, else not until his crawl takes him where it fits. GPU side (the meshes):
 * tests/prone-wall.test.mjs.
 * M3's start cover is a ruined watchtower, a broken dry-stone wall and boulders since 2026-10-21 (start_tower,
 * start_wall, start_rocks: art/ruin-tower.js, art/boulder-row.js): the straight-wall cases run on M3 with the old 16 m
 * ruin put back in their place (`withOldWall`, the regression as it was found), and the same getting-down cases at the
 * new wall, measured against the drawn masonry and rock.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { bodyRectGap, bodyCapsule, LIMBS } from '../../src/world/body-clearance.js';
import { boulderBandHull } from '../../src/art/boulder-row.js';
import { proneClear } from '../../src/world/placement.js';

const DEG = Math.PI / 180;

/** The 1.6 m dry-stone ruin the M3 team started behind until 2026-10-17 (its N face at z 7.25, 0.5 m off the starts). */
const OLD_WALL = { id: 'start_wall', type: 'ruins', variant: 'wall_ruin', x: 108, z: 8, rot: 0, w: 16, d: 1.5, h: 1.6, block: 2 };
/** M3 with its old start wall back in place of the ruin (a synthetic straight wall at the starts). */
const withOldWall = (def) => ({ ...def, structures: def.structures.filter((s) => s.id !== 'start_tower' && s.id !== 'start_rocks').map((s) => (s.id === 'start_wall' ? OLD_WALL : s)) });

/** M3 with nobody but the four commandos, each as the mission starts him (standing at z 6.75, facing the wall). */
function m03(patch = withOldWall) {
  const sim = headlessMission('m03', { patch }), w = sim.world;
  for (const e of w.enemies) { e.alive = false; e.removed = true; }
  const wall = w.mission.structures.find((s) => s.id === 'start_wall');
  const starts = new Map(w.commandos.map((c) => [c, { x: c.x, z: c.z }]));
  return { sim, w, wall, starts };
}

/**
 * How deep (m) his crawling body — the prone capsule and the crawl stroke's limbs (world/body-clearance.js bodyRectGap,
 * as the hulls are kept off him) — reaches into `wall`'s footprint rect, 0 when clear.
 */
function intoWall(u, wall) {
  const R = { x: wall.x, z: wall.z, h: wall.rot ?? 0, hl: wall.w / 2, hw: wall.d / 2 };
  return Math.max(0, -bodyRectGap(u.x, u.z, u.heading, 'crawl', R));
}

/** Stand `u` at his start facing the wall (90°), the others well away. */
function stage(S, u, stance = 'stand') {
  for (const c of S.w.commandos) if (c !== u) c.setPosition(60, 40);
  const p = S.starts.get(u);
  u.stop(); u.setPosition(p.x, p.z); u.stance = stance; u._stanceT = 0; u._lieDown = null;
  u.heading = u.prevHeading = 90 * DEG;
  for (let i = 0; i < 2; i++) S.sim.step();
}

test('prone wall: getting down at the M3 starts facing a straight wall (the old start_wall), he lies along it, all of him clear', () => {
  const S = m03(), bad = [];
  for (const u of S.w.commandos) {
    for (const [from, order] of [['stand', null], ['stand', [-4, -0.6]], ['stand', [4, -0.6]], ['crouch', null], ['crouch', [-4, -0.6]]]) {
      stage(S, u, from);
      assert.ok(intoWall({ ...u, heading: 90 * DEG }, S.wall) > 0.05, `${u.role}: facing the wall lying would put him into it (the case)`);
      u.setStance('crawl');
      if (order) assert.ok(u.issue({ type: 'move', x: u.x + order[0], z: u.z + order[1] }), `${u.role}: ${order} order taken`);
      let worst = 0;
      for (let i = 0; i < 90; i++) { S.sim.step(); if (!(u._stanceT > 0)) worst = Math.max(worst, intoWall(u, S.wall)); }
      if (worst > 0.02) bad.push(`${u.role} from ${from}${order ? ` → ${order}` : ''}: ${worst.toFixed(3)} m (at ${u.x.toFixed(2)},${u.z.toFixed(2)} ${Math.round(u.heading / DEG)}°)`);
      assert.equal(u.stance, 'crawl');
    }
  }
  assert.equal(bad.length, 0, `lying body into start_wall: ${bad.join(' | ')}`);
});

test('prone wall: lying along the (old start) wall, sent the other way, he never swings his head or feet into it', () => {
  const S = m03(), u = S.w.commandos.find((c) => c.role === 'diver');
  stage(S, u);
  u.setStance('crawl');
  for (let i = 0; i < 40; i++) S.sim.step();
  assert.ok(Math.abs(Math.cos(u.heading)) > 0.95, `down along the wall (${Math.round(u.heading / DEG)}°)`);
  // the other way along the wall: a turn round on the spot would sweep his head or feet through it
  const back = Math.cos(u.heading) > 0 ? -5 : 5;
  assert.ok(u.issue({ type: 'move', x: u.x + back, z: u.z }), 'order back along the wall');
  let worst = 0, n = 0;
  for (let i = 0; i < 60 * 8 && u.path; i++) { S.sim.step(); worst = Math.max(worst, intoWall(u, S.wall)); n++; }
  assert.ok(worst <= 0.02, `his lying body stays out of start_wall (${worst.toFixed(3)} m)`);
  assert.ok(!u.path && Math.abs(u.x - (S.starts.get(u).x + back)) < 0.8, `and he gets there (${u.x.toFixed(2)}, ${u.z.toFixed(2)} after ${n} ticks)`);
});

test('prone wall: proneClear — his whole crawling body: across the (old start) wall never, along it with room for his knees', () => {
  const S = m03(), g = S.w.grid;
  // at the Diver's start (0.95 m off the ruin, its cells from 0.25 m): no heading — across it his head, hands or feet,
  // along it the crawl stroke's knee (0.67 m to his side) would be in it
  for (const a of [0, 180, 90, -90, 45, 135]) assert.ok(!proneClear(g, 105.5, 6.75, a * DEG), `not at the start, ${a}°`);
  // half a metre further off: along it, not across it
  assert.ok(proneClear(g, 105.5, 6.25, 0) && proneClear(g, 105.5, 6.25, 180 * DEG), 'along start_wall 0.5 m further off');
  for (const a of [90, -90]) assert.ok(!proneClear(g, 105.5, 6.25, a * DEG), `not across it there (${a}°)`);
  assert.ok(proneClear(g, 60, 40, 37 * DEG), 'open ground: any heading');
  // M2's wall walk walk_sw (y 2.2, 1.4 m wide, along 40°): across it his head or feet would hang off it
  const g2 = headlessMission('m02').world.grid;
  for (const a of [130, -50]) assert.ok(!proneClear(g2, 26.22, 41.08, a * DEG), `not across walk_sw (${a}°)`);
});

// ---------------------------------------------------------------- the ruin M3 starts behind now

/**
 * The drawn solids where a lying body is (5–50 cm over the ground), world, convex each: every boulder's outline
 * (art/boulder-row.js), the wall with its footing course, the tower's battered foot (art/ruin-tower.js).
 */
function rockOutlines(w) {
  const S = (id) => w.mission.structures.find((s) => s.id === id), r = S('start_rocks'), wl = S('start_wall'), t = S('start_tower');
  const c = Math.cos(r.rot ?? 0), sn = Math.sin(r.rot ?? 0);
  const out = r.boulders.map((b) => boulderBandHull(b, 0.05, 0.5).map(([u, v]) => [r.x + u * c - v * sn, r.z + u * sn + v * c]));
  const hw = wl.w / 2 + 0.05, hd = (wl.t ?? 0.75) / 2 + 0.06; // (the masonry and its footing course)
  out.push([[wl.x - hw, wl.z - hd], [wl.x + hw, wl.z - hd], [wl.x + hw, wl.z + hd], [wl.x - hw, wl.z + hd]]);
  out.push(Array.from({ length: 32 }, (_, k) => [t.x + Math.cos((k / 32) * 2 * Math.PI) * (t.r + 0.22), t.z + Math.sin((k / 32) * 2 * Math.PI) * (t.r + 0.22)]));
  return out;
}
/** Signed distance (m) from (x, z) to a convex polygon: < 0 inside. */
function polySD(x, z, P) {
  let d = Infinity, inside = true;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
    if (ex * (z - az) - ez * (x - ax) < 0) inside = false; // (counter-clockwise hull: every edge has him on its left)
  }
  return inside ? -d : d;
}
/**
 * How deep (m) his crawling body — the prone capsule (sampled every 2 cm) and the crawl stroke's limb discs
 * (world/body-clearance.js) — reaches into the drawn rock, 0 when clear.
 */
function intoRocks(u, polys) {
  const C = bodyCapsule(u.x, u.z, u.heading, 'crawl'), c = Math.cos(u.heading), s = Math.sin(u.heading), pts = [];
  const L = Math.hypot(C.bx - C.ax, C.bz - C.az), n = Math.ceil(L / 0.02);
  for (let k = 0; k <= n; k++) pts.push([C.ax + ((C.bx - C.ax) * k) / n, C.az + ((C.bz - C.az) * k) / n, C.r]);
  for (const [a, l, r] of LIMBS) pts.push([u.x + c * a - s * l, u.z + s * a + c * l, r]);
  let depth = 0;
  for (const [x, z, r] of pts) for (const P of polys) depth = Math.max(depth, r - polySD(x, z, P));
  return depth;
}

test('prone ruin: getting down at the M3 starts facing the ruined wall, he lies clear of the masonry and the rock, all of him', () => {
  const S = m03(null), g = S.w.grid, polys = rockOutlines(S.w), bad = [];
  // (the orders run along the wall, not into the tower's talus at its E end: the Spy, by it, is sent no further)
  const t = S.w.mission.structures.find((q) => q.id === 'start_tower'), xMax = t.x - t.r - 0.62 - 0.5;
  for (const u of S.w.commandos) {
    for (const [from, order] of [['stand', null], ['stand', [-4, -0.6]], ['stand', [4, -0.6]], ['crouch', null], ['crouch', [-4, -0.6]]]) {
      stage(S, u, from);
      assert.ok(intoRocks({ ...u, heading: 90 * DEG }, polys) > 0.05 && !proneClear(g, u.x, u.z, 90 * DEG), `${u.role}: facing the wall lying would put him into it (the case)`);
      u.setStance('crawl');
      if (order) assert.ok(u.issue({ type: 'move', x: Math.min(u.x + order[0], xMax), z: u.z + order[1] }), `${u.role}: ${order} order taken`);
      let worst = 0;
      for (let i = 0; i < 90; i++) { S.sim.step(); if (!(u._stanceT > 0)) worst = Math.max(worst, intoRocks(u, polys)); }
      if (worst > 0.05) bad.push(`${u.role} from ${from}${order ? ` → ${order}` : ''}: ${worst.toFixed(3)} m (at ${u.x.toFixed(2)},${u.z.toFixed(2)} ${Math.round(u.heading / DEG)}°)`);
      assert.equal(u.stance, 'crawl');
    }
  }
  assert.equal(bad.length, 0, `lying body into the start ruin (the clipping test's 5 cm bar): ${bad.join(' | ')}`);
});

test('prone ruin: lying along the wall, sent back the other way, he crawls there clear of it', () => {
  const S = m03(null), polys = rockOutlines(S.w), u = S.w.commandos.find((c) => c.role === 'sapper');
  assert.ok(S.w.mission.structures.some((s) => s.id === 'start_tower'), 'M3 starts behind its ruined tower and wall');
  stage(S, u);
  u.setStance('crawl');
  for (let i = 0; i < 40; i++) S.sim.step();
  assert.ok(Math.abs(Math.cos(u.heading)) > 0.9, `down along the wall (${Math.round(u.heading / DEG)}°)`);
  const back = Math.cos(u.heading) > 0 ? -3 : 3, x0 = u.x; // (3 m: east of him the tower's foot is 4 m off)
  assert.ok(u.issue({ type: 'move', x: u.x + back, z: u.z - 0.3 }), 'order back along the wall');
  let worst = 0, n = 0;
  let wAt = '';
  for (let i = 0; i < 60 * 8 && u.path; i++) { S.sim.step(); const d = intoRocks(u, polys); if (d > worst) { worst = d; wAt = `(${u.x.toFixed(2)},${u.z.toFixed(2)} ${Math.round(u.heading / DEG)}° x0 ${x0.toFixed(2)} back ${back})`; } n++; }
  assert.ok(worst <= 0.05, `his lying body stays out of the wall (${worst.toFixed(3)} m at ${wAt})`);
  assert.ok(!u.path && Math.abs(u.x - (x0 + back)) < 0.8, `and he gets there (${u.x.toFixed(2)}, ${u.z.toFixed(2)} after ${n} ticks)`);
});

