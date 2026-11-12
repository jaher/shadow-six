/**
 * M20 castle pass (user 2026-11-10: "M20 should look like a large castle, moat should circle all around castle. No
 * buildings intersecting in strange ways, shooting range with soldiers actively shooting inside the castle"):
 *  - no two solid structures overlap unless the mission declares the join (joinStructures → clipAllow): walls bonding
 *    into gatehouses, terraces against what they retain, props standing on their level, the bailey's compounds;
 *  - the moat is a closed ring of deep water round the castle (only the gates' bridges, the outer ward's footbridge and
 *    the climb's crag cross it) and the outer ward keeps the W pair's start, the climb and the footbridge;
 *  - the firing line: riflemen at practice on clear lanes to their targets, the NCO behind them, the range rule live
 *    only while they practise;
 *  - the castle art's scenery (art/m20-castle.js) stands off the mission's posts, beats, spawns and links.
 * Run with the unit suite: node tests/unit/run.mjs m20-castle
 */
import { test, assert } from './lib.mjs';
import { getMission } from '../../src/missions/index.js';
import { MOAT_RING, BR_W, RANGE_LANES, RANGE_NCO } from '../../src/missions/m20_operation_valhalla.js';
import { towerPlan, BAILEY_PLAN } from '../../src/art/m20-castle.js';
import { rangeTick, atPractice, RANGE_POSE } from '../../src/missions/scripts/m20-range.js';
import { rangeAtPractice } from '../../src/missions/setpieces-hazards.js';

const m20 = getMission('m20');
const S = (id) => m20.structures.find((s) => s.id === id);

// ---------------------------------------------------------------- footprints
const rect = (x, z, w, d, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
};
const circle = (x, z, r, n = 16) => Array.from({ length: n }, (_, k) => [x + r * Math.cos((k / n) * 2 * Math.PI), z + r * Math.sin((k / n) * 2 * Math.PI)]);
/** The solid footprint polygons of a structure def (rects, discs, wall runs as one rect per segment, level polygons). */
function footprints(s) {
  if (s.points && s.points.length >= 2) {
    if (s.type === 'cliff') return [s.points];
    const w = s.width ?? 1, out = [];
    for (let k = 0; k + 1 < s.points.length; k++) {
      const [ax, az] = s.points[k], [bx, bz] = s.points[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L > 1e-6) out.push(rect((ax + bx) / 2, (az + bz) / 2, L, w, Math.atan2(bz - az, bx - ax)));
    }
    return out;
  }
  if (s.x == null) return [];
  if (s.w != null && s.d != null) return [rect(s.x, s.z, s.w, s.d, s.rot ?? 0)];
  if (s.r != null) return [circle(s.x, s.z, s.r)];
  return [];
}
const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const bbox = (polys) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of polys) for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
};
/** Overlap area (m², sampled at 10 cm) of two footprint sets. */
function overlapArea(A, B) {
  const a = bbox(A), b = bbox(B), x0 = Math.max(a[0], b[0]), z0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), z1 = Math.min(a[3], b[3]);
  if (x0 >= x1 || z0 >= z1) return 0;
  let n = 0;
  const st = 0.1;
  for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) {
    if (A.some((p) => inPoly(x, z, p)) && B.some((p) => inPoly(x, z, p))) n++;
  }
  return n * st * st;
}
/** Not solids: the forest, single trees, flat ground, bridges' decks over the water (their abutments are joined). */
const SKIP_TYPE = new Set(['pine', 'tree', 'bush', 'terrain', 'road', 'decal']);
const solid = (s) => !SKIP_TYPE.has(s.type) && s.clip !== false && footprints(s).length > 0;
const joined = (a, b) => (a.clipAllow || []).includes(b.id) || (b.clipAllow || []).includes(a.id)
  || (a.clipAllow || []).includes(b.type) || (b.clipAllow || []).includes(a.type);
/**
 * Pairs that share ground by construction, not by a clash: a prop lifted onto a level (`baseY`) over the level and the
 * building under it (one stands on the other: different heights), and a terrace's parapet strips (its own edge masonry).
 */
const stacked = (a, b) => (a.baseY ?? 0) !== (b.baseY ?? 0)
  || (a.type === 'cliff' && b.type === 'cliff' && (/^t_par_/.test(a.id) || /^t_par_/.test(b.id)));

test('m20 castle: no two solid structures overlap unless the mission declares the join', () => {
  const list = m20.structures.filter(solid), fps = new Map(list.map((s) => [s, footprints(s)])), bad = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (joined(a, b) || stacked(a, b)) continue;
    const A = fps.get(a), B = fps.get(b), ba = bbox(A), bb = bbox(B);
    if (ba[0] >= bb[2] || bb[0] >= ba[2] || ba[1] >= bb[3] || bb[1] >= ba[3]) continue;
    const area = overlapArea(A, B);
    if (area > 0.04) bad.push(`${a.id} × ${b.id}: ${area.toFixed(2)} m²`);
  }
  assert.deepEqual(bad, [], `undeclared overlaps:\n${bad.join('\n')}`);
});

test('m20 castle: every declared join is a real contact (no stale allow-list entries)', () => {
  const stale = [];
  for (const a of m20.structures) for (const id of a.clipAllow || []) {
    const b = S(id);
    if (!b || !solid(a) || !solid(b)) continue;
    const A = footprints(a), B = footprints(b), ba = bbox(A), bb = bbox(B);
    // (a contact: the footprints' bounds within 2 m — a lean-to against a gatehouse, gun pits by the turret and the
    // wing whose eaves would cross (the schema's eaves rule asks for the join), the stair tower against the N range)
    const touch = !(ba[0] - 2 >= bb[2] || bb[0] - 2 >= ba[2] || ba[1] - 2 >= bb[3] || bb[1] - 2 >= ba[3]);
    if (!touch) stale.push(`${a.id} → ${id}`);
  }
  assert.deepEqual(stale, [], `joins between structures that are nowhere near each other:\n${stale.join('\n')}`);
});

// ---------------------------------------------------------------- the moat ring
const water = m20.terrain.filter((t) => t.terrain === 'water');
const band = (pts, w) => pts.slice(0, -1).map((p, k) => { const q = pts[k + 1]; return rect((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.hypot(q[0] - p[0], q[1] - p[1]), w, Math.atan2(q[1] - p[1], q[0] - p[0])); });
const wet = (x, z) => water.some((t) => (t.type === 'poly' && inPoly(x, z, t.points)) || (t.type === 'path' && band(t.points, t.width).some((p) => inPoly(x, z, p)))
  || (t.type === 'rect' && x >= t.x && x <= t.x + t.w && z >= t.z && z <= t.z + t.d) || (t.type === 'circle' && Math.hypot(x - t.x, z - t.z) <= t.r));

test('m20 castle: the moat circles the castle — every way out from its middle crosses water or a bridge', () => {
  // rays from the castle's middle in 72 directions: each meets deep water before the map edge, unless it leaves by
  // a gate's bridge (the castle stands in its ring of water)
  const bridges = m20.structures.filter((s) => s.type === 'bridge').map((s) => rect(s.x, s.z, s.w + 1, s.d + 0.5, s.rot ?? 0));
  const misses = [];
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * 2 * Math.PI, dx = Math.cos(a), dz = Math.sin(a);
    let hit = false, bridged = false;
    for (let r = 2; r < 140 && !hit; r += 0.25) {
      const x = 80 + dx * r, z = 72 + dz * r;
      if (x < 0.3 || z < 0.3 || x > m20.size[0] - 0.3 || z > m20.size[1] - 0.3) break;
      if (bridges.some((p) => inPoly(x, z, p))) bridged = true;
      if (wet(x, z)) hit = true;
    }
    if (!hit && !bridged) misses.push(Math.round((a * 180) / Math.PI));
  }
  assert.deepEqual(misses, [], `directions (°) with no water between the castle and the map edge: ${misses.join(', ')}`);
  assert.equal(MOAT_RING.length, 5, 'NE, N, NW, W and the outer ward\'s S leg');
});

test('m20 castle: the outer ward keeps the W pair dry, the climb\'s foot reachable, the footbridge over its S leg', () => {
  for (const c of m20.commandos.filter((q) => q.x < 30)) assert.ok(!wet(c.x, c.z), `${c.role} starts dry (${c.x}, ${c.z})`);
  const cl = m20.climbLinks.find((l) => l.id === 'cl_w');
  assert.ok(!wet(cl.b[0], cl.b[1]), 'the climb\'s foot is dry');
  // a dry way from the W pair to the climb's foot along the crag (the solution's way: the strip under the wall)
  for (let x = 4.6; x <= 15; x += 0.5) assert.ok(!wet(x, 83), `dry under the crag at x ${x}`);
  // the footbridge spans the ward's S leg; S of it the meadow is dry
  assert.ok(wet(BR_W.x, BR_W.z), 'water under the footbridge');
  assert.ok(!wet(BR_W.x, BR_W.z + BR_W.w / 2 + 0.6) && !wet(BR_W.x, BR_W.z - BR_W.w / 2 - 0.6), 'dry at both ends');
  assert.ok(S('br_w') && S('br_w').type === 'bridge', 'the footbridge is a walkable bridge');
  // the E group's start and the E field lane stay dry; the Panzer III's way out (the SW bridge) is unchanged
  for (const c of m20.commandos.filter((q) => q.x > 140)) assert.ok(!wet(c.x, c.z), `${c.role} starts dry`);
  for (let z = 40; z <= 150; z += 2) assert.ok(!wet(156.6, z), `the E field lane dry at z ${z}`);
});

// ---------------------------------------------------------------- the firing line
test('m20 castle: the firing line — three riflemen (lying, kneeling, standing) and their NCO, on clear lanes', () => {
  const men = m20.enemies.filter((e) => e.range);
  assert.equal(men.filter((e) => !e.range.nco).length, 3);
  assert.deepEqual(men.filter((e) => !e.range.nco).map((e) => e.range.pose).sort(), ['kneel', 'prone', 'stand']);
  assert.equal(men.filter((e) => e.range.nco).length, 1);
  const rangePoly = m20.setpieces.find((s) => s.type === 'firing_range').area.poly;
  for (const l of RANGE_LANES) {
    assert.ok(inPoly(l.at[0], l.at[1], rangePoly) && inPoly(l.target[0], l.target[1], rangePoly), `${l.id}: on the range`);
    // nobody's post or beat within 1.4 m of his lane
    const [ax, az] = l.at, [bx, bz] = l.target, L = Math.hypot(bx - ax, bz - az);
    const segD = (x, z) => { const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L))); return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)); };
    for (const e of m20.enemies) {
      if (e.id === l.id) continue;
      const pts = [[e.x, e.z], ...(e.route?.points || []).map((p) => [p.x, p.z])];
      for (const [x, z] of pts) assert.ok(segD(x, z) > 1.4, `${e.id} at (${x}, ${z}) stands in ${l.id}'s lane`);
    }
    const tgt = m20.structures.find((s) => /target/.test(s.variant || '') && Math.hypot(s.x - bx, s.z - bz) < 0.5);
    assert.ok(tgt, `${l.id}: a target at the lane's end`);
  }
  for (const p of RANGE_NCO) assert.ok(inPoly(p.x, p.z, rangePoly), 'the NCO paces on the range');
  assert.deepEqual(Object.keys(RANGE_POSE).sort(), ['kneel', 'prone', 'stand']);
});

/** A stub world for the range script: enemies with spawns, brains and the actions it calls. */
function rangeWorld() {
  const shots = [], acts = [];
  const enemies = m20.enemies.filter((e) => e.range).map((sp) => ({
    tag: sp.id, spawn: sp, x: sp.x, z: sp.z, alive: true, stance: 'stand', idleAnim: undefined, weapon: 'rifle',
    post: { x: sp.x, z: sp.z }, brain: { state: 'IDLE' },
    setStance(s) { this.stance = s; }, playAction(n, d) { acts.push([sp.id, n, d]); },
  }));
  const w = { time: 0, enemies, alarm: { active: false }, events: { emit: (n, p) => { if (n === 'shot') shots.push(p); } } };
  return { w, shots, acts };
}

test('m20 castle: the riflemen fire aimed rounds at their targets while calm, reload, and stop when alarmed', () => {
  const { w, shots, acts } = rangeWorld();
  for (let k = 0; k < 20 * 60; k++) { w.time = k / 20; rangeTick(w); }
  const by = (id) => shots.filter((s) => s.shooter.tag === id).length;
  for (const l of RANGE_LANES) assert.ok(by(l.id) >= 8 && by(l.id) <= 20, `${l.id}: ${by(l.id)} rounds a minute`);
  for (const s of shots) {
    const l = RANGE_LANES.find((q) => q.id === s.shooter.tag);
    const ang = (dx, dz) => Math.atan2(dz, dx);
    assert.ok(Math.abs(ang(s.to.x - l.at[0], s.to.z - l.at[1]) - ang(l.target[0] - l.at[0], l.target[1] - l.at[1])) < 1e-6, 'down his lane');
    assert.equal(s.practice, true);
  }
  assert.ok(acts.some(([, n]) => n === RANGE_POSE.stand.reload), 'a fresh clip now and then');
  assert.equal(w.enemies.find((e) => e.spawn.range.pose === 'prone').stance, 'crawl', 'the prone man lies at his lane');
  assert.equal(w.enemies.find((e) => e.spawn.range.nco).idleAnim, 'idle_hands_back', 'the NCO at ease behind them');
  assert.equal(rangeAtPractice(w), true, 'the range is at practice: a pistol shot passes for one more round');
  // the siren: they stop, the prone one gets up, the range rule no longer covers a shot
  w.alarm.active = true;
  const n0 = shots.length;
  for (let k = 0; k < 200; k++) { w.time += 0.05; rangeTick(w); }
  assert.equal(shots.length, n0, 'no practice under the siren');
  assert.equal(w.enemies.find((e) => e.spawn.range.pose === 'prone').stance, 'stand');
  assert.equal(rangeAtPractice(w), false);
  w.alarm.active = false;
  for (const e of w.enemies) e.brain.state = 'COMBAT';
  assert.equal(atPractice(w.enemies[0], w), false, 'fighting: no practice');
  assert.equal(rangeAtPractice(w), false);
});

test('m20 castle: the range is deterministic (the same rounds at the same moments on a second run)', () => {
  const a = rangeWorld(), b = rangeWorld();
  for (let k = 0; k < 20 * 30; k++) { a.w.time = b.w.time = k / 20; rangeTick(a.w); rangeTick(b.w); }
  assert.deepEqual(a.shots.map((s) => [s.shooter.tag, s.to.x, s.to.z]), b.shots.map((s) => [s.shooter.tag, s.to.x, s.to.z]));
});

// ---------------------------------------------------------------- the scenery stays off the mission's ways
test('m20 castle: the flanking towers stand outside the curtain\'s walk and off every post, beat, spawn and link', () => {
  const pts = [];
  for (const e of m20.enemies) { pts.push([e.x, e.z, e.id]); for (const p of e.route?.points || []) pts.push([p.x, p.z, `${e.id} route`]); }
  for (const c of m20.commandos) pts.push([c.x, c.z, c.role]);
  for (const l of m20.ladders) pts.push([l.x, l.z, l.id], [l.top[0], l.top[1], l.id]);
  for (const c of m20.climbLinks) pts.push([c.a[0], c.a[1], c.id], [c.b[0], c.b[1], c.id]);
  for (const t of towerPlan(m20)) {
    const [x, z] = t.kind === 'round' ? [t.x, t.z] : t.F.at(t.u, 2.5);
    for (const [px, pz, id] of pts) assert.ok(Math.hypot(px - x, pz - z) > t.r - 0.2 || id === 'cl_w', `${id} (${px}, ${pz}) inside a tower at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    if (t.kind === 'd') {
      // the D tower's body lies outward of the parapet line: the walk's centre ± 2 m stays open
      for (let u = t.u - t.r; u <= t.u + t.r; u += 0.5) {
        const [wx, wz] = t.F.at(u, 0);
        assert.ok(Math.hypot(wx - x, wz - z) > 1.9, 'walk clear');
      }
    }
  }
  // the bailey's buildings: one per library hut / house, on its structure
  for (const id of Object.keys(BAILEY_PLAN)) assert.ok(S(id), `${id} is in the mission`);
});

// ---------------------------------------------------------------- the castle art (node: plain colours, no textures)
import { buildMoatWorks, buildTowers, gateCrown, drawbridge, buildKeep, buildKeepRuin, buildBailey, buildRingTarget, rampartParapet } from '../../src/art/m20-castle.js';
import { Geo } from '../../src/art/castle-kit.js';

/** Triangles of every mesh in `g` whose material name matches `re`: [[a, b, c], …] (world coordinates). */
function tris(g, re = /./) {
  const out = [];
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || !re.test(o.material?.name || '')) return;
    const p = o.geometry.attributes.position, idx = o.geometry.index;
    const v = (i) => [p.getX(i), p.getY(i), p.getZ(i)];
    const n = idx ? idx.count : p.count;
    for (let k = 0; k + 2 < n; k += 3) { const [i, j, l] = idx ? [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)] : [k, k + 1, k + 2]; out.push([v(i), v(j), v(l)]); }
  });
  return out;
}
const normalY = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
  return n[1] / l;
};

test('m20 castle art: the scenery builds (moat works, towers, gate crowns, drawbridge, parapets, bailey) with every roof facing up', () => {
  const G = new Geo('test');
  buildTowers(m20, G);
  for (const id of ['gh_sw', 'gh_se']) { const s = S(id); gateCrown(G, { x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, walkY: 7 }); }
  const br = S('br_sw');
  drawbridge(G, { x: br.x, z: br.z, rot: br.rot, w: br.w, d: br.d, walkY: 7, leaf: 4 });
  rampartParapet(G, [[38.25, 32], [91.6, 32]], 10, { inside: [70, 20] });
  buildBailey(m20, G);
  const g = G.build('t'), all = tris(g), roofs = tris(g, /slate|tiles|shingle/);
  assert.ok(all.length > 15000, `${all.length} triangles`);
  assert.ok(all.every((t) => t.every((p) => p.every(Number.isFinite))), 'finite');
  const down = roofs.filter((t) => normalY(t) < -0.05);
  assert.ok(down.length <= roofs.length * 0.02, `${down.length} of ${roofs.length} roof triangles face down`); // (eave skirts' undersides only)
  const w = buildMoatWorks(m20);
  assert.ok(tris(w).length > 2000, 'counterscarp and scarps');
});

test('m20 castle art: the counterscarp stops at the bridges (no coping on a deck)', () => {
  const coping = tris(buildMoatWorks(m20), /dressed/).flat();
  for (const b of m20.structures.filter((s) => s.type === 'bridge')) {
    const c = Math.cos(b.rot ?? 0), n = Math.sin(b.rot ?? 0);
    const on = coping.filter(([x, y, z]) => { const dx = x - b.x, dz = z - b.z; return y > -0.3 && Math.abs(dx * c + dz * n) < b.w / 2 && Math.abs(-dx * n + dz * c) < b.d / 2 - 0.1; });
    assert.equal(on.length, 0, `${b.id}: ${on.length} coping vertices on its deck`);
  }
});

test('m20 castle art: the keep stands on the château\'s footprint — nothing proud of it at body height where bodies lie', () => {
  const s = S('hq'), o = { x0: s.x - s.w / 2, x1: s.x + s.w / 2, z0: s.z - s.d / 2, z1: s.z + s.d / 2, y0: s.baseY };
  const keep = tris(buildKeep(o)), ruin = tris(buildKeepRuin(o));
  assert.ok(keep.length > 5000 && ruin.length > 1000);
  // the body band over the terrace (0.3-1.8 m): within the footprint, its SW tower and the porch flight
  const out = keep.flat().filter(([x, y, z]) => y > o.y0 + 0.3 && y < o.y0 + 1.8 && !(x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05))
    .filter(([x, , z]) => Math.hypot(x - 5.9, z - 59.6) > 2.95) // the round SW tower (the sidecar's tower footprint)
    .filter(([x, , z]) => !(x > 10.1 && x < 13.9 && z < o.z1 + 0.7)) // the porch flight (the sidecar's stair footprint)
    .filter(([x]) => x > o.x0 - 0.05); // (W of the W face: the plinth and the garderobe over the moat, where no one stands)
  assert.equal(out.length, 0, `${out.length} vertices proud of the N, E or S faces at body height, e.g. ${JSON.stringify(out[0])}`);
  // e40's body under the SE corner (26.5, 62.1) and the turret's blind corner (the charge, 28.6 53) stay clear
  for (const [px, pz] of [[26.6, 62.15], [28.6, 53.0]]) {
    const near = keep.flat().filter(([x, y, z]) => y > o.y0 + 0.3 && y < o.y0 + 1.8 && Math.abs(x - px) < 0.12 && Math.abs(z - pz) < 0.12);
    assert.equal(near.length, 0, `nothing drawn at (${px}, ${pz})`);
  }
  // the roof ledge's walk (y 20, x 19.5-26, z 58.5-61.5) is open: no wall or merlon of the keep stands on it
  const onLedge = keep.flat().filter(([x, y, z]) => y > 20.2 && y < 21.8 && x > 19.8 && x < 25.8 && z > 58.8 && z < 61.4);
  assert.equal(onLedge.length, 0, 'the roof ledge walk is clear');
});

test('m20 castle art: a ring target faces the firing line', () => {
  const g = buildRingTarget({ x: 117, z: 77.6, face: Math.PI / 2 });
  const card = g.getObjectByName('m20:ringTarget:card');
  assert.ok(card);
  const t = tris(card)[0];
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  const nz = u[0] * v[1] - u[1] * v[0];
  assert.ok(nz > 0, 'its card faces S, the riflemen');
});

// ---------------------------------------------------------------- the layout (user 2026-11-10: "Make sure all buildings
// are well located inside the castle and dont intersect paths")
import { auditLayout, LAYOUT_JOINS } from './m20-layout-audit.mjs';
import { churchFootprint, buildChurch } from '../../src/art/m20-church.js';
import { occupationFootprints, buildOccupation, buildSentryBox } from '../../src/art/m20-occupation.js';
import * as castleArt from '../../src/art/m20-castle.js';
import { periodFlags } from '../../src/missions/scripts/m20-art.js';
import { makeFlag, makeBanner, bannerMaterial } from '../../src/art/flags.js';

const LAYOUT_ART = { BAILEY_PLAN, churchFootprint, occupationFootprints };

test('m20 layout: every building and large prop inside its ward, off the walls, off each other, off every path, doors on a lane', () => {
  const r = auditLayout(m20, LAYOUT_ART);
  // the castle's buildings and props are all in the audit (the bailey, the chapel, the church, the guardhouse, the
  // sentry boxes, the vehicle park, the V2 trailers, the guns, the range, the occupation layer's ground props)
  const ids = new Set(r.items.map((i) => i.id));
  for (const id of [...Object.keys(BAILEY_PLAN), 'church', 'gbox_sw', 'gbox_se', 'gbox_in', 'vp_truck', 'vp_staff', 'vp_kubel', 'vp_moto', 'v2a', 'v2b', 'flak_court', 'range', 'kr_se1', 'dump_vp']) {
    assert.ok(ids.has(id), `${id} is audited`);
  }
  const kinds = new Set(r.paths.map((p) => p.kind));
  for (const k of ['road', 'link', 'gate', 'tank', 'route']) assert.ok(kinds.has(k), `the ${k} paths are audited`);
  const bad = r.items.filter((i) => i.issues.length).map((i) => `${i.id}: ${i.issues.map((q) => `${q.check} ${q.detail}`).join('; ')}`);
  assert.deepEqual(bad, [], `layout violations:\n${bad.join('\n')}`);
});

test('m20 layout: each allow-listed join is a real contact, with its reason', () => {
  const r = auditLayout(m20, LAYOUT_ART, { joins: [] });
  for (const [a, b, why] of LAYOUT_JOINS) {
    assert.ok(typeof why === 'string' && why.length > 20, `${a} × ${b} has a reason`);
    const it = r.items.find((i) => i.id === a);
    assert.ok(it, `${a} is audited`);
    assert.ok(it.issues.some((q) => q.other === b), `${a} × ${b} is a real contact (else the entry is stale)`);
  }
});

test('m20 layout: the bailey\'s roads run between the buildings (no building on a road, the SW lane along the tank\'s way)', () => {
  const roads = m20.terrain.filter((t) => t.type === 'path' && t.terrain === 'road');
  assert.ok(roads.length >= 6, 'the approach roads, the SW lane, the inner road, the SE street, the range road');
  const lane = roads.find((t) => t.points[0][0] === 58 && t.points[0][1] === 110);
  assert.ok(lane && lane.width <= 3.4, 'the SW gate\'s lane is a lane');
  for (const id of Object.keys(BAILEY_PLAN)) {
    const s = S(id), p = BAILEY_PLAN[id], c = Math.cos(s.rot), n = Math.sin(s.rot);
    for (const t of roads) for (let k = 0; k + 1 < t.points.length; k++) {
      const [a, b] = [t.points[k], t.points[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d <= L; d += 0.25) {
        const x = a[0] + ((b[0] - a[0]) * d) / L, z = a[1] + ((b[1] - a[1]) * d) / L, dx = x - s.x, dz = z - s.z;
        const u = dx * c + dz * n, w = -dx * n + dz * c;
        assert.ok(!(u > p.u0 && u < Math.max(p.u1, p.annex ?? -Infinity) && w > p.w0 && w < p.w1), `${id} stands on a road at (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
  }
});

// ---------------------------------------------------------------- the church and the occupation layer
test('m20 church: a tower with its spire, the nave, the choir and the apse on its own plot (the NE terrace), off the range', () => {
  const s = S('church');
  assert.ok(s, 'the church is a structure (its art is measured: scripts/m20-art.js swapVisual)');
  const y0 = s.baseY ?? 0, g = buildChurch({ ...s, y0, seed: 'church' }), all = tris(g);
  assert.ok(all.length > 3000 && all.every((t) => t.every((p) => p.every(Number.isFinite))), `${all.length} finite triangles`);
  const top = Math.max(...all.flat().map((p) => p[1]));
  assert.ok(top > 28, `the spire reads as a landmark (${top.toFixed(1)} m)`);
  // on the NE terrace: none of it S of the range's targets' berm or within the range's ground (the camera looks N:
  // nothing tall may stand between it and the firing line — user: "shooting range with soldiers actively shooting")
  const range = S('range');
  assert.ok(all.flat().every(([, , z]) => z < range.z - range.d / 2 - 10), 'the church stands well N of the range');
  assert.ok(Math.abs(Math.min(...all.flat().map((p) => p[1])) - y0) < 0.6, `standing on its terrace (y ${y0})`);
  const roofs = tris(g, /slate/), down = roofs.filter((t) => normalY(t) < -0.05);
  assert.ok(down.length <= roofs.length * 0.03, `${down.length} of ${roofs.length} slate triangles face down`);
  assert.ok(g.getObjectByName('m20:church:leaded'), 'leaded lights');
  // the art stays on the structure's footprint at body height (it is the nav)
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  const out = all.flat().filter(([x, y, z]) => { const dx = x - s.x, dz = z - s.z; return y > y0 + 0.3 && y < y0 + 1.8 && (Math.abs(dx * c + dz * n) > s.w / 2 + 1.3 || Math.abs(-dx * n + dz * c) > s.d / 2 + 0.05); });
  assert.equal(out.length, 0, `${out.length} vertices off the church's footprint at body height`);
  const fp = churchFootprint(s);
  assert.deepEqual(fp.map((f) => f.id), ['tower', 'nave', 'buttresses', 'choir', 'apse', 'steps']);
});

test('m20 occupation: the wartime layer builds (MG nests, wire, nets, dumps, mast, phone lines) and no medieval banner is left', () => {
  const g = buildOccupation(m20), all = tris(g);
  assert.ok(all.length > 3000, `${all.length} triangles`);
  for (const name of ['m20art:camonets', 'm20art:wires']) assert.ok(g.getObjectByName(name), name);
  const box = buildSentryBox({ x: 0, z: 0, rot: 0 });
  assert.ok(box.getObjectByName('m20:sentrybox:paint'), 'the sentry box\'s chevrons');
  // no heraldry: the castle module has no banner builder any more, nothing in the art carries a banner material
  assert.equal(castleArt.buildBanners, undefined, 'no medieval banners');
  for (const o of [g, box, buildChurch({ ...S('church'), y0: S('church').baseY, seed: 'c' })]) o.traverse((n) => { if (n.isMesh) assert.ok(!/banner|baden|heraldic/i.test(n.material?.name || '') && !/banner/i.test(n.name), `${n.name}`); });
});

test('m20 flags: the period flags fly where an occupied HQ has them, all from the flag system (they follow INSIGNIA)', () => {
  const f = periodFlags(m20);
  const near = (x, z, r) => f.some((q) => Math.hypot(q.x - x, q.z - z) < r);
  const hq = S('hq'), gs = S('gh_sw'), ge = S('gh_se'), gi = S('gh_in'), ch = S('church');
  assert.ok(near(hq.x, hq.z, 16), 'on the keep');
  assert.ok(f.filter((q) => q.kind === 'banner' && Math.abs(q.z - (hq.z + hq.d / 2)) < 0.2).length >= 2, 'either side of the HQ\'s entrance');
  for (const g of [gs, ge, gi]) assert.ok(near(g.x, g.z, 7), `over ${g.id}`);
  assert.ok(near(84.46, 96.7, 0.5), 'the guardhouse keeps its (barracks) flag');
  assert.ok(near(117, 55, 5), 'over the vehicle park');
  assert.ok(near(ch.x, ch.z, 12), 'on the church tower');
  // every flag and banner is the flag system's own cloth: its materials are repainted by Options → INSIGNIA
  const flag = makeFlag({ pole: true, poleH: 6 }), banner = makeBanner({ w: 1.2, h: 3 });
  assert.equal(flag.getObjectByName('flag_cloth').material.name, 'flag_cloth');
  assert.equal(banner.getObjectByName('flag_banner').material, bannerMaterial(undefined));
  assert.equal(bannerMaterial(undefined).userData.flagKind, 'banner');
});
