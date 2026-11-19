/**
 * M20 layout: the E group (Sniper, Marine, Sapper, Driver: prone among the rocks NE of the castle) can crawl S out of
 * the NE fields. The E field between the E wall walk and the map edge is only ~16 m wide; e11, posted on the walk
 * looking E with a 90° sweep, saw a man lying anywhere across it at his z (near band 18 m: every lane within reach)
 * while he stood on the walk's middle. Posted on its inner half, he leaves a lane along the map edge (sol/m20).
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';

test('m20: a crawl lane along the E map edge stays beyond e11\'s near band', () => {
  const { world: w } = headlessMission('m20');
  const e11 = w.enemies.find((e) => e.tag === 'e11'), g = w.grid;
  let edge = 0;
  for (let x = 150; x < 157; x += 0.25) if (g.walkableAt(x, e11.z)) edge = x;
  const near = e11.vision.near ?? 18;
  assert.ok(Math.hypot(edge - e11.x, 0) > near + 1, `the E field's last walkable cell at his z (${edge}) is ${(edge - e11.x).toFixed(2)} m from him (near band ${near} m)`);
  assert.ok(g.elevAt(e11.x, e11.z) > 6.5, 'e11 still stands on the E wall walk');
});

test('m20: a stone flight is masonry down to the ground — no way on foot through its run, its foot and top open', () => {
  const { world: w } = headlessMission('m20');
  const g = w.grid, f = g.flights.flights.find((q) => q.solid && Math.hypot(q.ox - 62, q.oz - 67.41) < 0.6); // S_gw (user 2026-11-15: re-routed into the gatehouse forecourt pocket, climbing N to the T_wb edge at z=62; it stands freestanding in the pocket, not wedged)
  assert.ok(f, 'the W quarter stairs (S_gw) are a solid flight');
  // solid to the ground: no way on foot through its run (the cell on its centreline, mid-run)
  assert.ok(!g.walkableAt(62, 65.0), 'through its run: no way on foot');
  // the narrow gap between its E cheek and the gatehouse face is passable — a man squeezes beside it, not through it
  assert.ok(g.walkableAt(63.6, 65.0), 'beside the run, in the gap: a way on foot');
  assert.ok(g.walkableAt(62, 67.7), 'its foot is open');
  const top = { x: f.ox + f.ux * f.sTop, z: f.oz + f.uz * f.sTop };
  assert.ok(g.walkableAt(top.x + f.ux * 0.6, top.z + f.uz * 0.6), 'past its top is open');
  // a man from the yard W of it to the tunnel goes beside it or round its foot, never through the solid flight
  const p = w.findPath(59, 65, 72, 66, { role: 'greenberet' });
  assert.ok(p && p.every((q) => !(q.x > 60.8 && q.x < 63.2 && q.z > 62.1 && q.z < 67.4)), 'beside it or round its foot, never through it');
});

/**
 * The grid and the stair walk agree beside a stone flight's foot (sol/m20-v2, 2026-11-18): the stair walk shoves a man
 * standing beside a link flight back out from 0.1 m past its foot (stair-walk besideLinkFlight: its cheek walls), and
 * stampSolidFlights left the floor there open until the flight's line rose 0.5 m (~0.6–0.9 m in). The user's re-seated
 * S_ne1 (2026-11-15), its foot 0.7 m from the crates by the V2 trailers, left only that half-metre beside its first tread
 * as the way to the N court's north end: the pathfinder sent e53 along it and the stair walk held him there, walking
 * on the spot for the rest of the mission.
 */
test('m20: no floor cell beside a stone flight is open where the stair walk shoves a man back out (its end cells aside)', async () => {
  const { railShift } = await import('../../src/entities/stair-walk.js');
  const { flightLocal } = await import('../../src/world/stairs.js');
  const { world: w } = headlessMission('m20');
  const g = w.grid, c = g.cell, bad = [];
  for (const f of g.flights.flights) {
    if (!f.solid || !f.link) continue;
    const ends = new Set([f.link.ka, f.link.kb]), R = f.w / 2 + 2, b = f.box;
    for (let j = Math.floor((b[1] - R) / c); j <= Math.floor((b[3] + R) / c); j++) {
      for (let i = Math.floor((b[0] - R) / c); i <= Math.floor((b[2] + R) / c); i++) {
        if (!g.inBounds(i, j)) continue;
        const k = g.idx(i, j), x = (i + 0.5) * c, z = (j + 0.5) * c, y = g.elev[k];
        if (ends.has(k) || Math.abs(y - f.levels[0]) > 0.3 || !g.walkableAt(x, z)) continue;
        const q = flightLocal(f, x, z);
        if (q.s < 0 || q.s > f.sTop) continue;
        const man = { world: w, x, z, y, stance: 'stand', path: null, pathIndex: 0 };
        if (railShift(man)) bad.push(`${f.id} (${x},${z}) s ${q.s.toFixed(2)} v ${q.v.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `open floor cells the stair walk shoves a man out of: ${bad.join('; ')}`);
});

test('m20: e53 walks his beat round the V2 trailers and never walks on the spot', () => {
  // (on the game's own grid — tools/solutions/navcache: the crates' drawn reach narrows the way there to the half-metre
  // beside S_ne1's first tread; the mesh-less build leaves a wider one)
  const S = headlessMission('m20', { navCache: true });
  const w = S.world, e = w.enemies.find((q) => q.tag === 'e53');
  let still = 0, worst = 0, px = e.x, pz = e.z;
  for (let t = 0; t < 240; t += S.dt) {
    S.step();
    const v = Math.hypot(e.x - px, e.z - pz) / S.dt;
    px = e.x; pz = e.z;
    // (walking — a path and no halt — at under a tenth of his pace)
    still = e.path && !e.brain?.atWait && v < 0.09 ? still + S.dt : 0;
    worst = Math.max(worst, still);
  }
  assert.ok(worst < 3, `e53 walked on the spot for ${worst.toFixed(1)} s at (${e.x.toFixed(2)},${e.z.toFixed(2)})`);
});

/**
 * A squad following its leader up a stone flight goes up the stairs after him, in file at his pace (sol/m20-v2): its men
 * aimed at his trail on the treads, and the planner took the free cell nearest such a point instead — beside the flight,
 * behind its cheek wall, here in the court's NE corner that M20's re-seated S_n and S_ne1 and the crates wall in
 * (reachable only over the NE terrace): every follower flooded the map for it four times a second and stood still.
 * stairs.js solidEndFor: a point over a solid flight's treads is reached by its end on the leader's side, and a man on
 * its link walks on to its end (enemy-brain.js _follow). And on any flight a follower's pace was capped by his pace on
 * the treads (× 0.85) tick after tick: he climbed at a crawl, ~0.3 m/s, and the file strung out (_follow's v0).
 */
test('m20: a patrol whose leader climbs S_n follows him up it in file, no follower search flooding the map', async () => {
  const { Enemy } = await import('../../src/entities/enemy.js');
  const { searchStats } = await import('../../src/world/pathfinding.js');
  const S = headlessMission('m20', { navCache: true });
  const w = S.world, f = w.grid.flights.flights.find((q) => q.solid && Math.abs(q.ox - 90.5) < 0.3 && q.levels.at(-1) > 9);
  assert.ok(f, 'S_n is a solid flight');
  // (the stairs' run: its nearer end; off it, nothing)
  const mid = (s) => ({ x: f.ox + f.ux * s, z: f.oz + f.uz * s });
  const lo = w.grid.flights.solidEndFor(mid(1.5).x, mid(1.5).z), hi = w.grid.flights.solidEndFor(mid(f.sTop - 1.5).x, mid(f.sTop - 1.5).z);
  const L = f.link, foot = L.a.y <= L.b.y ? L.a : L.b, top = foot === L.a ? L.b : L.a;
  assert.ok(lo && hi && hi.link === L && lo.link === L && lo.x === foot.x && lo.z === foot.z && hi.x === top.x && hi.z === top.z, `the link's foot below the middle, its top above it (${lo?.x},${lo?.z} / ${hi?.x},${hi?.z})`);
  assert.equal(w.grid.flights.solidEndFor(85, 45), null, 'off the flight: none');
  // Patrol 57 sent up S_n: its leader's route from the court to the N range roof and back
  const lead = w.enemies.find((e) => e.tag === 'p57'), men = ['p57b', 'p57c'].map((t) => w.enemies.find((e) => e.tag === t));
  for (const e of [lead, ...men]) { e.x = 86.5 + (e === lead ? 0 : 0.6 * men.indexOf(e)); e.z = 47 + (e === lead ? 0 : 1.3 * (men.indexOf(e) + 1)); }
  lead.route = [{ x: 89, z: 45.5, wait: 0 }, { x: 90.5, z: 27, wait: 30, look: 270 }];
  lead.brain.routeIndex = 0; lead.brain.routeDir = 1; lead.brain.atWait = false;
  const mt = Enemy.prototype.moveTo;
  let worst = 0, atTop = null;
  Enemy.prototype.moveTo = function (x, z, ...a) { const e0 = searchStats.expanded, r = mt.call(this, x, z, ...a); if (men.includes(this)) worst = Math.max(worst, searchStats.expanded - e0); return r; };
  try {
    for (let t = 0; t < 60; t += S.dt) {
      S.step();
      // (the moment he steps off the top: where his men are on the flight)
      if (!atTop && (lead.y ?? 0) > 9.9) atTop = men.map((m) => ({ tag: m.tag, y: m.y ?? 0, d: Math.hypot(m.x - lead.x, m.z - lead.z) }));
    }
  } finally { Enemy.prototype.moveTo = mt; }
  assert.ok(atTop, 'the leader reached the top');
  atTop.forEach((m, i) => assert.ok(m.y > 7 - 1.5 * i && m.d < 3 + 1.5 * i, `as he steps off the top, ${m.tag} is up the flight close behind him (y ${m.y.toFixed(1)}, ${m.d.toFixed(1)} m)`));
  assert.ok((lead.y ?? 0) > 9, `the leader is up on the N range roof (y ${(lead.y ?? 0).toFixed(1)})`);
  for (const m of men) assert.ok((m.y ?? 0) > 9 && Math.hypot(m.x - lead.x, m.z - lead.z) < 6, `${m.tag} followed him up (y ${(m.y ?? 0).toFixed(1)}, ${Math.hypot(m.x - lead.x, m.z - lead.z).toFixed(1)} m from him)`);
  assert.ok(worst < 20000, `no follower search over 20 000 cells (worst ${worst})`);
});
