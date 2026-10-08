/**
 * M3 dam keyed into the valley (user request 2026-10-07, after the Mission 3 video: "enemies seem to walk in front of
 * the damn", "dam should be connected to the edges of the side mountains and there should be water behind the dam",
 * "bomb ahould be placed on top of the dam, nobody ahould be able to walk in front of it"):
 *  - both rock rims close on the dam's ends and run down the outer side of its crest stairs: no pocket of open ground
 *    between the crest, a stair and the rock (they showed the valley floor 7 m down), the abutting faces plumb on the
 *    outline (art/dressing buildCliff `abut`);
 *  - the reservoir's water runs under the dam's upstream face, its ends inside the rock, open (no shore ice) along
 *    the face;
 *  - nobody slips into the no-walk foot of the face, not even by a hair off the stair's landing (Unit._followPath),
 *    and no enemy goes there in a full-brain alarm;
 *  - the charge goes on the crest.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { pointInPolygon } from '../../src/core/math.js';
import { buildCliff } from '../../src/art/dressing.js';
import { waterBodyDescriptors, raisedWaterMasks } from '../../src/art/water.js';
import { waterBodiesFromGrid } from '../../src/art/water/grid.js';
import { Alarm } from '../../src/ai/alarm.js';

const def = getMission('m03');
const dam = def.structures.find((s) => s.id === 'dam');
const rim = (id) => def.structures.find((s) => s.id === id);
const C = Math.cos(dam.rot), S = Math.sin(dam.rot);
/** Dam-local polar point: radius r about the arch centre (20 m downstream of the crest's middle), angle a deg (+ = E). */
const polar = (r, a) => { const u = r * Math.sin((a * Math.PI) / 180), v = 20 - r * Math.cos((a * Math.PI) / 180); return [dam.x + u * C - v * S, dam.z + u * S + v * C]; };
const STAIRS = { W: { stair: dam.ramps.find((r) => r.id === 'stair_w'), rim: 'rim_s', sign: -1 }, E: { stair: dam.ramps.find((r) => r.id === 'stair_e'), rim: 'abut_e', sign: 1 } };
/** Rock (any of the reservoir's rims and the abutments) at (x, z). */
const ROCKS = ['rim_s', 'rim_e', 'abut_e'];
const isRock = (x, z) => ROCKS.some((id) => pointInPolygon(x, z, rim(id).points));
/** Point `f` of the way down a stair from its top, `off` m to its outer side (away from the plunge pool). */
const outer = (st, f, off) => {
  const [[bx, bz], [tx, tz]] = st.points, L = Math.hypot(bx - tx, bz - tz), ux = (bx - tx) / L, uz = (bz - tz) / L, [px, pz] = polar(0, 0);
  const toPool = ((px - tx) * -uz + (pz - tz) * ux) > 0 ? 1 : -1; // the normal (-uz, ux) points at the plunge pool (the arch centre)
  return [tx + ux * L * f + toPool * uz * off, tz + uz * L * f - toPool * ux * off];
};
const cellOf = (g, x, z) => g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));

test('m03 abutments: each rim closes on its end of the dam — no gap between the arch end, its stair and the rock', () => {
  for (const [side, { stair, rim: id, sign }] of Object.entries(STAIRS)) {
    // just past the arch's end (38°), from the crest's upstream edge to the upstream face: rock (or the stair's head)
    const [[bx, bz], [tx, tz]] = stair.points, onStair = (x, z) => {
      const dx = bx - tx, dz = bz - tz, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - tx) * dx + (z - tz) * dz) / L2));
      return Math.hypot(tx + dx * t - x, tz + dz * t - z) <= stair.width / 2;
    };
    // (the little corner between the stair's head, the rock and the crest's end lies under the dam's end block: its
    // ground is out of bounds, `noWalk` dam_end_*)
    const end = def.noWalk.find((n) => n.id === `dam_end_${side.toLowerCase()}`);
    assert.ok(end, `dam_end_${side.toLowerCase()} no-walk corner`);
    for (let r = 20.8; r <= 22.2; r += 0.2) {
      const [x, z] = polar(r, sign * 38.6);
      assert.ok(isRock(x, z) || onStair(x, z) || pointInPolygon(x, z, end.points), `${side}: (${x.toFixed(2)},${z.toFixed(2)}) r ${r.toFixed(1)} past the arch end is rock`);
    }
    // beside the stair's upper half (its outer side, 1–2 m off its axis): rock
    for (let f = 0; f <= 0.45; f += 0.05) for (const off of [1.0, 1.5, 2.0]) {
      const [x, z] = outer(stair, f, off);
      assert.ok(isRock(x, z), `${side}: ${off} m beside the stair at ${f.toFixed(2)} (${x.toFixed(2)},${z.toFixed(2)}) is rock`);
    }
    // …and never over the treads or the crest
    for (let f = 0; f <= 1; f += 0.05) for (const off of [0, 0.5, -0.5, 0.78, -0.78]) {
      const [x, z] = outer(stair, f, off);
      assert.ok(!isRock(x, z), `${side}: stair tread (${x.toFixed(2)},${z.toFixed(2)}) under rock`);
    }
    for (let a = -37.5; a <= 37.5; a += 0.5) for (const r of [19.05, 20, 20.9]) {
      const [x, z] = polar(r, a);
      assert.ok(!isRock(x, z), `${side}: crest (${x.toFixed(2)},${z.toFixed(2)}) under rock`);
    }
    assert.ok(rim(id).h >= dam.walkY, `${id} stands at least crest high (${rim(id).h})`);
    assert.ok(rim(id).abut?.length >= 2, `${id} declares its abutting faces`);
  }
});

test('m03 abutments: no open ground cell left between a crest end, its stair and the rock (they showed the valley floor 7 m down)', () => {
  const { grid: g } = loadGrid(def);
  for (const [side, { stair }] of Object.entries(STAIRS)) {
    for (let f = 0; f <= 0.45; f += 0.025) for (let off = 1.0; off <= 2.0; off += 0.25) {
      const [x, z] = outer(stair, f, off), k = cellOf(g, x, z);
      assert.ok(!(g.walkableAt(x, z) && g.elev[k] < 0.5), `${side}: open ground beside the stair at ${f.toFixed(3)} / ${off} m (${x.toFixed(2)},${z.toFixed(2)})`);
    }
    // the corner at the stair's head, past the crest's end: no ground anyone can stand on
    for (let r = 20.1; r <= 20.95; r += 0.05) for (let a = 38.05; a <= 40; a += 0.1) {
      const [x, z] = polar(r, (side === 'W' ? -1 : 1) * a), k = cellOf(g, x, z);
      assert.ok(!(g.walkableAt(x, z) && g.elev[k] < 0.5), `${side}: open ground at the stair's head (${x.toFixed(2)},${z.toFixed(2)})`);
    }
  }
  // the stairs and the crest stay walkable from foot to foot
  for (const { stair } of Object.values(STAIRS)) for (let f = 0.02; f < 1; f += 0.04) {
    const [x, z] = outer(stair, f, 0);
    assert.ok(g.walkableAt(x, z), `stair ${stair.id} at ${f.toFixed(2)} (${x.toFixed(2)},${z.toFixed(2)})`);
  }
});

test('m03 abutments: buildCliff `abut` faces stand plumb on the outline, never bulging past it (the plain faces do)', () => {
  const pts = [[0, 0], [12, 0], [12, 8], [0, 8]];
  const seg = [[12, 0], [12, 8]]; // the face at x 12 meets the concrete
  const maxX = (o) => { let m = -Infinity; o.traverse((q) => { if (!q.isMesh) return; const p = q.geometry.attributes.position; for (let i = 0; i < p.count; i++) m = Math.max(m, p.getX(i)); }); return m; };
  const plain = buildCliff({ id: 'rim_e', points: pts, h: 7.6, x: 6, z: 4 }), abut = buildCliff({ id: 'rim_e', points: pts, h: 7.6, x: 6, z: 4, abut: [seg] });
  assert.ok(maxX(plain) + 6 > 12.15, `the plain face bulges past the outline (${(maxX(plain) + 6).toFixed(2)})`);
  assert.ok(maxX(abut) + 6 <= 12.0 + 1e-6, `the abutting face stays on it (${(maxX(abut) + 6).toFixed(3)})`);
  // …and closes on it: its rim vertices along the face stand within 0.6 m of the outline at every height
  let near = 0, n = 0;
  abut.traverse((q) => { if (!q.isMesh) return; const p = q.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 6, z = p.getZ(i) + 4; if (x > 11 && z > 0.5 && z < 7.5 && p.getY(i) > 0 && p.getY(i) < 7) { n++; if (x > 11.4) near++; } } });
  assert.ok(n > 10 && near / n > 0.9, `abutting face vertices on the outline (${near}/${n})`);
});

test('m03 reservoir: its water runs right up under the dam\'s upstream face, its ends inside the rock', () => {
  const { grid: g } = loadGrid(def);
  const [mask] = raisedWaterMasks(g, def);
  assert.ok(mask?.level > 5 && mask.level < dam.walkY - 1, `reservoir level ${mask?.level} below the crest`);
  for (let a = -37; a <= 37; a += 1) {
    const [x, z] = polar(21.6, a), k = cellOf(g, x, z);
    assert.equal(mask.mask[k], 1, `water against the face at ${a}° (${x.toFixed(2)},${z.toFixed(2)})`);
  }
  // nothing between the face and the water: every cell centred from just past the crest lane's upstream edge (r 21)
  // outwards behind the dam is water or rock (the valley floor never shows through)
  const [cx, cz] = polar(0, 0), inv = (x, z) => { const dx = x - dam.x, dz = z - dam.z, u = dx * C + dz * S, v = -dx * S + dz * C; return [Math.hypot(u, v - 20), (Math.atan2(u, 20 - v) * 180) / Math.PI]; };
  let n = 0;
  for (let j = Math.floor((cz - 48) / g.cell); j < (cz + 48) / g.cell; j++) for (let i = Math.floor((cx - 48) / g.cell); i < (cx + 48) / g.cell; i++) {
    if (!g.inBounds(i, j)) continue;
    const x = (i + 0.5) * g.cell, z = (j + 0.5) * g.cell, [r, a] = inv(x, z);
    if (r < 21.0 || r > 26 || Math.abs(a) > 37.5) continue;
    n++;
    assert.ok(mask.mask[g.idx(i, j)] || isRock(x, z), `cell (${x},${z}) r ${r.toFixed(2)} ${a.toFixed(1)}° behind the dam is neither water nor rock`);
  }
  assert.ok(n > 500, `cells behind the dam checked (${n})`);
  // the reservoir polygon's ends against the dam lie inside the rims
  const P = def.terrain.find((t) => t.level > 0).points;
  const nearDam = P.filter(([x, z]) => { const dx = x - polar(0, 0)[0], dz = z - polar(0, 0)[1]; const r = Math.hypot(dx, dz); return r < 22; });
  const ends = [nearDam[0], nearDam[nearDam.length - 1]];
  assert.ok(isRock(...ends[0]) && isRock(...ends[1]), `ends ${JSON.stringify(ends)} inside the rims`);
});

test('m03 reservoir: open water along the dam face (iceFree spots), shore ice kept on the rock shores; the dam drains it', () => {
  const { grid: g } = loadGrid(def);
  const descs = waterBodyDescriptors(g, def, def.theater, waterBodiesFromGrid);
  const res = descs.find((d) => d.raised);
  assert.ok(res, 'reservoir body');
  assert.equal(res.raised.drainOn, 'dam', 'drains when the dam goes');
  assert.ok(res.ice > 0, 'shore ice on the rock shores');
  const F = res.iceFree || [];
  assert.ok(F.length >= 1 && F.length <= 4, `iceFree spots (${F.length}, shader holds 4)`);
  for (let a = -37.5; a <= 37.5; a += 0.5) {
    const [x, z] = polar(21.6, a);
    assert.ok(F.some((f) => Math.hypot(f.x - x, f.z - z) <= f.r * 0.55), `face at ${a}°: open water`);
  }
  // the tailwater keeps its own (the plunge pool), separate from the reservoir's
  assert.ok(descs.some((d) => !d.raised && d.iceFree?.length), 'the pool keeps its open water');
});

test('m03 dam front: a walker steered a hair past the E stair\'s landing never drops into the foot of the face', () => {
  const s = makeSim(def, { brains: false });
  const w = s.world, g = w.grid, e = w.enemies.find((q) => q.spawn?.id === 'e4' || q.tag === 'e4') || w.enemies[0];
  // the landing's last stair cell (crest high) beside the no-walk ground below the crest's E end
  let from = null, into = null;
  for (let x = 54; x > 50 && !into; x -= 0.01) {
    const z = 23.75, k = cellOf(g, x, z), k2 = cellOf(g, x - 0.01, z);
    if (g.elev[k] > 7 && !g.noWalk[k] && g.noWalk[k2]) { from = [x + 0.25, z]; into = [x - 0.04, z]; }
  }
  assert.ok(from && into, 'landing edge found');
  assert.ok(g.noWalk[cellOf(g, ...into)] && !g.noWalk[cellOf(g, ...from)], 'from the landing into the foot of the face');
  Object.assign(e, { x: from[0], z: from[1], y: g.elevAt(...from), path: null });
  e.steerTo(...into);
  for (let i = 0; i < 120; i++) {
    s.step(1 / 60);
    if (e.path?.[0]?.steer) { e.path[0].x = into[0]; e.path[0].z = into[1]; } else if (i < 60) e.steerTo(...into);
    assert.ok(!g.noWalk[cellOf(g, e.x, e.z)], `stepped into the foot of the face at (${e.x.toFixed(3)},${e.z.toFixed(3)}) y ${e.y.toFixed(2)}`);
    assert.ok(e.y > 6.5, `still on the landing (y ${e.y.toFixed(2)})`);
  }
});

test('m03 dam front: a full-brain alarm with noises in front of the dam sends nobody there (patrols, squads, investigators)', () => {
  const s = makeSim(def);
  const w = s.world, g = w.grid;
  w.alarm = new Alarm(w);
  const spots = [[40, 30.5], [44, 27], [31, 29], [52.6, 25.2], [36, 31]];
  const n0 = w.enemies.length;
  let k = 0;
  for (let t = 0; t < 60 * 45; t++) {
    if (t % 600 === 0) {
      const [x, z] = spots[k++ % spots.length];
      w.alarm.fireEvent('RINT', { x, z }); w.alarm.fireEvent('RCAMP', { x, z });
      w.emitNoise(x, z, 200, 'explosion', null, 3);
    }
    s.step();
    for (const e of w.enemies) {
      if (!e.alive || e.removed) continue;
      assert.ok(!g.noWalk[cellOf(g, e.x, e.z)], `${e.spawn?.id ?? e.id} in front of the dam at (${e.x.toFixed(2)},${e.z.toFixed(2)}) t ${(t / 60).toFixed(1)} s`);
    }
  }
  assert.ok(w.enemies.length > n0, `squads released (${n0} → ${w.enemies.length})`);
});

test('m03: the dam charge is planted on top of the dam (the crest deck), not at its foot', () => {
  const { grid: g } = loadGrid(def);
  const m = def.markers.find((q) => q.id === 'dam_charge');
  const k = cellOf(g, m.x, m.z);
  assert.ok(g.bridge[k] && g.elev[k] > 7 && g.walkableAt(m.x, m.z), `charge spot (${m.x},${m.z}) on the crest deck`);
  // the whole charge radius in front of the face is out of bounds: it can only be armed from the crest
  for (let a = 0; a < 360; a += 15) {
    const x = m.x + Math.cos((a * Math.PI) / 180) * m.r * 0.95, z = m.z + Math.sin((a * Math.PI) / 180) * m.r * 0.95, kk = cellOf(g, x, z);
    if (g.walkableAt(x, z)) assert.ok(g.elev[kk] > 7, `(${x.toFixed(2)},${z.toFixed(2)}) within the charge radius walkable at ground level`);
  }
});
