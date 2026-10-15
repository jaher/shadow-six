/**
 * Lying down and crawling next to a wall never puts the lying body into it (clipping seeds 7 / 11 on master after the
 * game-rules merge: M3's Diver and Green Beret, standing at their starts 0.95 m from `start_wall` and facing it, were
 * told to crawl; their bodies fell along their heading, head and hands 0.11 m into the ruin). Unit.setStance /
 * _lieDownPose: a man getting down lies as he faces when all of him fits (placement proneClear), else facing his path,
 * else at the nearest heading (or spot, ≤ 0.5 m) that fits — all of him, the crawl stroke's knees and toes too; lying, he turns only while all of him stays clear — the
 * other way round when that is clear, else not until his crawl takes him where it fits. GPU side (the meshes):
 * tests/prone-wall.test.mjs.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { bodyRectGap } from '../../src/world/body-clearance.js';
import { proneClear } from '../../src/world/placement.js';

const DEG = Math.PI / 180;

/** M3 with nobody but the four commandos, each as the mission starts him (standing at z 6.75, facing start_wall). */
function m03() {
  const sim = headlessMission('m03'), w = sim.world;
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

test('prone wall: getting down at the M3 starts facing start_wall, he lies along it, all of him clear', () => {
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

test('prone wall: lying along the wall, sent the other way, he never swings his head or feet into it', () => {
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

test('prone wall: proneClear — his whole crawling body: across start_wall never, along it with room for his knees', () => {
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
