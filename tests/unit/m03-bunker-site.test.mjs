/**
 * M3 dam bunker site (user request 2026-10-08: "The bunker in mission 3 is too close to the stairs"). The bunker stood
 * at (19, 46) with its entrance trench's baffle wall 1 m and its wire 1.4 m from the W stair's rails, right at the
 * stair's foot. It now stands W of the stair on the open snow between the rock rim and p5's beat:
 *  - its whole works — walls, turf berm, wire, entrance trench — as the browser draws them (the library model fitted to
 *    the gameplay footprint, intact, snow and ruin variants) keep several metres of open ground from both crest
 *    stairs' treads and feet;
 *  - it stands on open snow, inside the map, clear of the rock, the water, the dam front and every other structure,
 *    and its gunner stands in z_south (RINT);
 *  - its gunner still guards the approach: his sweeping cone covers the W stair, its foot, the W shore where boats land
 *    and the river below the dam's W half, as it did from the old spot — and still not the station's N gate;
 *  - the entrance path moved with it (it ends at the model's doorway) and the Sapper reaches it from the W shore and
 *    from the stair's foot.
 */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { getMission } from '../../src/missions/index.js';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { buildingMeta } from '../../src/art/building-library.js';
import { pointInPolygon } from '../../src/core/math.js';
import { findPath } from '../../src/world/pathfinding.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { loadGrid } from './mission-check.mjs';
import { T, T_NAMES } from '../../src/world/grid.js';

const def = getMission('m03');
const BUNKER = def.structures.find((s) => s.id === 'dam_bunker');
const GUNNER = def.enemies.find((e) => e.id === 'e34');
const dam = def.structures.find((s) => s.id === 'dam');
const STAIRS = dam.ramps.map((r) => ({ id: r.id, foot: r.points[0], top: r.points[r.points.length - 1], hw: r.width / 2 }));
/** m of open ground the bunker's works keep from a stair's treads (its rails stand 8 cm inside their edge) / its foot. */
const MIN_RAIL = 5.5, MIN_FOOT = 6.5;

const segDist = ([x, z], [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
};
/** Points along a closed polygon's edges, every `step` m. */
const outline = (pts, step = 0.2) => pts.flatMap((a, i) => {
  const b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
});

/**
 * The bunker's drawn works in world coordinates: every sidecar footprint (walls, berm slope, wire, baffle and wing
 * walls, ruin rubble) of the picked library model and of its snow and ruined variants, fitted onto the gameplay
 * footprint the way art/building-props.js libraryVisual places it (centred on the main body, fitScale, rot).
 * @returns {Promise<{kind: string, asset: string, pts: number[][]}[]>}
 */
async function works() {
  await useManifest(JSON.parse(readFileSync(new URL('../../assets/models/buildings/manifest.json', import.meta.url))), 'm03');
  try {
    const pk = pickAsset('bunker', BUNKER, { theater: 'snow', missionId: 'm03' });
    assert.ok(pk, 'a library model for the bunker');
    const { sx, sz } = fitScale(BUNKER.w / pk.ext.w, BUNKER.d / pk.ext.d);
    const c = Math.cos(BUNKER.rot), s = Math.sin(BUNKER.rot);
    const W = ([px, pz]) => {
      const lx = (px - pk.ext.cx) * sx, lz = (pz - pk.ext.cz) * sz;
      return [BUNKER.x + lx * c - lz * s, BUNKER.z + lx * s + lz * c];
    };
    const base = buildingMeta(pk.name);
    const out = [];
    for (const name of [pk.name, base.snowVariant, base.destroyedVariant].filter(Boolean)) {
      for (const f of buildingMeta(name).footprints) out.push({ kind: f.kind, asset: name, pts: f.points.map(W) });
    }
    const door = base.doors.find((d) => d.id === 'main');
    return { out, door: door ? W([door.pos[0], door.pos[2]]) : null };
  } finally { await useManifest(null); }
}

test('m03 dam bunker: its walls, berm, wire and entrance trench keep several metres of open ground from both crest stairs', async () => {
  const { out } = await works();
  assert.ok(out.some((f) => f.kind === 'berm_slope') && out.some((f) => f.kind === 'wire') && out.some((f) => f.kind === 'baffle'), 'berm, wire and the trench\'s baffle wall measured');
  for (const st of STAIRS) {
    let rail = Infinity, foot = Infinity, at = null;
    for (const f of out) for (const q of outline(f.pts)) {
      const dr = segDist(q, st.foot, st.top) - st.hw, df = Math.hypot(q[0] - st.foot[0], q[1] - st.foot[1]);
      if (dr < rail) { rail = dr; at = `${f.asset}:${f.kind} (${q.map((v) => v.toFixed(1))})`; }
      foot = Math.min(foot, df);
    }
    assert.ok(rail >= MIN_RAIL, `${st.id}: ${rail.toFixed(2)} m from its treads to ${at} (want ≥ ${MIN_RAIL})`);
    assert.ok(foot >= MIN_FOOT, `${st.id}: ${foot.toFixed(2)} m from its foot (want ≥ ${MIN_FOOT})`);
  }
  // the gameplay footprint and the crew too, and the whole entry walk (outside the trench he walks in the open)
  for (const st of STAIRS) {
    for (const p of [[BUNKER.x, BUNKER.z], [GUNNER.x, GUNNER.z], ...BUNKER.entry.path, BUNKER.entry.charge]) {
      assert.ok(segDist(p, st.foot, st.top) - st.hw >= MIN_RAIL, `${st.id}: (${p}) ${(segDist(p, st.foot, st.top) - st.hw).toFixed(2)} m from the treads`);
    }
  }
});

test('m03 dam bunker: on open snow inside the map, clear of the rock, the water, the dam front and every other structure; its gunner in z_south', async () => {
  const { out } = await works();
  const { grid } = loadGrid(def);
  const front = def.noWalk.find((z) => z.id === 'dam_front').points;
  const rocks = def.structures.filter((s) => s.type === 'cliff').map((s) => s.points);
  const [W, H] = def.size;
  const pts = out.filter((f) => f.asset === 'bunker').flatMap((f) => [...outline(f.pts, 0.5)]);
  for (const [x, z] of pts) {
    assert.ok(x > 1 && z > 1 && x < W - 1 && z < H - 1, `(${x.toFixed(1)},${z.toFixed(1)}) inside the map`);
    assert.ok(!pointInPolygon(x, z, front), `(${x.toFixed(1)},${z.toFixed(1)}) in front of the dam`);
    for (const r of rocks) assert.ok(!pointInPolygon(x, z, r), `(${x.toFixed(1)},${z.toFixed(1)}) in the rock`);
    const t = grid.terrainAt(x, z), k = grid.idx(Math.floor(x / grid.cell), Math.floor(z / grid.cell));
    assert.ok(t === T.SNOW || t === T.GROUND, `(${x.toFixed(1)},${z.toFixed(1)}) on the snow (terrain ${T_NAMES[t]})`);
    assert.ok(!grid.noWalk?.[k] && grid.elevAt(x, z) < 0.3, `(${x.toFixed(1)},${z.toFixed(1)}) on the valley floor, not a no-walk or raised cell`);
  }
  // nothing else stands on its works: fences, pine crowns, buildings (their footprint radius) ≥ 1 m off
  for (const s of def.structures) {
    if (s.id === 'dam_bunker' || s.id === 'dam' || s.type === 'cliff') continue;
    const runs = s.segments ?? (s.points ? [s.points] : null);
    // (a pine's crown reaches 4.5 m out at the height of the bunker's camouflage net: the old pine at (6, 50) touched it)
    const r = runs ? 0 : s.type === 'pine' ? 4.5 : Math.max(s.w ?? 0, s.d ?? 0, (s.r ?? 0) * 2) / 2;
    const d = Math.min(...pts.map((q) => runs ? Math.min(...runs.flatMap((run) => run.slice(1).map((b, i) => segDist(q, run[i], b)))) : Math.hypot(q[0] - s.x, q[1] - s.z) - r));
    assert.ok(d >= 1, `${s.id ?? s.type} ${d.toFixed(2)} m from the bunker's works`);
  }
  const zs = def.zones.find((z) => z.id === 'z_south').poly;
  assert.ok(pointInPolygon(GUNNER.x, GUNNER.z, zs), 'the gunner stands in z_south (his alarm is RINT + siren)');
  assert.deepEqual([GUNNER.x, GUNNER.z], [BUNKER.x, BUNKER.z], 'the crew sits in the bunker');
  assert.ok(Math.abs(GUNNER.heading - (BUNKER.rot + Math.PI / 2)) < 1e-9, 'he looks out of its slit (front NE)');
});

test('m03 dam bunker: the gunner still guards the approach — the W stair, its foot, the W shore and the river below the dam; not the N gate', () => {
  const sim = headlessMission('m03'), w = sim.world;
  const e = w.enemies.find((q) => q.tag === 'e34' || q.spawn?.id === 'e34');
  const base = coneAt(e, 0), A = e.vision.sweep;
  /** Best band a standing man at (x, z) gets in the gunner's cone over his whole sweep (LOS included). */
  const band = (x, z) => {
    const t = { x, z, y: w.grid.elevAt(x, z), isLow: false, isVisibleToEnemies: true, alive: true };
    let best = 'none';
    for (let th = -A; th <= A + 1e-9; th += Math.PI / 90) {
      const r = canSee(e, t, w, { cone: { ...base, heading: e.heading + th } });
      if (r === 'near') return r;
      if (r === 'far') best = r;
    }
    return best;
  };
  const W = STAIRS.find((s) => s.id === 'stair_w');
  // (all covered from the old spot by the stair's foot too)
  const watched = {
    'W stair foot': [W.foot[0] + 0.5, W.foot[1] + 1.2], 'W stair, lower treads': [W.foot[0] + 1.5, W.foot[1] - 2.6],
    'snow S of the stair foot': [24, 44], 'W shore landing': [33, 42], 'W shore, S': [36, 46.5], 'W shore, N': [31, 37.5],
    'river below the dam\'s W half': [40, 40], 'river, mid': [44, 46], 'river, by the W shore': [41, 50],
  };
  for (const [what, [x, z]] of Object.entries(watched)) assert.notEqual(band(x, z), 'none', `${what} (${x}, ${z}) watched`);
  // the dark (near) band still reaches the stair's foot: a man crawling off the stair is seen there
  assert.equal(band(W.foot[0] + 0.5, W.foot[1] + 1.2), 'near', 'stair foot in the near band');
  // and he does not look into the station: the N gate and p5's halt by it stay out of his cone, as before
  for (const [what, [x, z]] of Object.entries({ 'N gate': [26, 57], 'p5 halt': [30, 54] })) assert.equal(band(x, z), 'none', `${what} (${x}, ${z}) not watched`);
});

test('m03 dam bunker: the entrance path moved with it — it ends at the model\'s doorway; the Sapper reaches it from the W shore and the stair', async () => {
  const { door } = await works();
  const path = BUNKER.entry.path, last = path[path.length - 1];
  assert.ok(door && Math.hypot(last[0] - door[0], last[1] - door[1]) < 0.3, `entry ends at the doorway (${last} vs ${door?.map((v) => v.toFixed(2))})`);
  const mk = def.markers.find((m) => m.id === 'bunker_charge');
  assert.deepEqual([mk.x, mk.z], BUNKER.entry.charge, 'the charge marker is the floor inside');
  assert.ok(Math.hypot(mk.x - BUNKER.x, mk.z - BUNKER.z) < 1.5, 'inside the bunker');
  const { grid } = loadGrid(def);
  const out = path[0];
  assert.ok(grid.walkableAt(out[0], out[1]), `the entrance's outer end (${out}) is open ground`);
  for (const from of [[33, 42], [STAIRS[0].foot[0] + 0.3, STAIRS[0].foot[1] + 1.0]]) {
    const p = findPath(grid, from[0], from[1], out[0], out[1], { maxNodes: 400000 });
    assert.ok(p && Math.hypot(p.at(-1).x - out[0], p.at(-1).z - out[1]) < 1, `path (${from}) → the entrance`);
  }
});
