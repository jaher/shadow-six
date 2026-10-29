/** M6 art pass (Masi, Finnmark 1941): the Masi add-on (log manor ruins, round log / stone towers, the stone chapel, the
 *  log HQ barrack, the fortified HQ block, lean-to, burnt house, clock, Gatling, log pile, handcart), each fitted to its
 *  footprint, decks and roofs at the mission's walk heights, garrison doors where the game enters, the railing walls and
 *  the visual-only dressing. */
import { readFileSync, existsSync } from 'node:fs';
import { readGlb } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-masi';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm06'); try { return await fn(); } finally { await useManifest(null); } };
const m06 = MISSIONS.find((m) => m.id === 'm06');
const byId = (id) => m06.structures.find((s) => s.id === id);
const OWN = ['house_bombed_log_w', 'house_bombed_log_ne', 'tower_round_log', 'tower_round_stone', 'chapel_stone_no', 'hq_log_flatroof',
  'hq_fortified_block', 'lean_to_canopy', 'ruin_burned_timber', 'grandfather_clock', 'gatling_wheeled', 'log_pile_stack', 'handcart_wood'];
const RUINED = ['chapel_stone_no', 'hq_log_flatroof', 'hq_fortified_block'];

test('art m06: the Masi add-on ships every LOD, sidecar and texture (+ the garrisons\' ruins), temperate, under its own types', () => {
  assert.ok(EXTRA_MANIFESTS.includes(ADDON));
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  const alias = base().textures.aliases;
  const found = (u) => existsSync(u) || (alias[u.pathname.split('/').pop()] && existsSync(new URL(alias[u.pathname.split('/').pop()], u)));
  for (const n of [...OWN, ...RUINED.map((r) => `${r}_destroyed`)]) {
    const a = add.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) {
      assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
      const glb = readGlb(P(`assets/models/${l.url}`)).toString('latin1');
      for (const [, u] of glb.matchAll(/"uri":"([^"]+)"/g)) assert.ok(found(new URL(u, P(`assets/models/${l.url}`))), `${l.url} → ${u}`);
    }
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('temperate'), n);
  }
  for (const r of RUINED) assert.equal(add.assets[r].destroyedVariant, `${r}_destroyed`, r);
  const b = base(), m = merged();
  for (const t of ['house', 'barracks', 'hut', 'bunker', 'tent', 'ruins', 'minaret', 'crates']) assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m06: every placeholder takes its own Masi build, fitted to the gameplay footprint (≤ 12 % per axis)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m06.structures.filter((q) => q.asset)) {
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm06' });
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    const tol = /^(minaret|tent)$/.test(s.type) ? 0.25 : 0.12; // one tower build serves the 4–5 m towers; the M16 tent at 0.83 scale
    assert.ok(Math.abs(Math.log(w / ew)) < tol && Math.abs(Math.log(d / ed)) < tol, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  // (ruin_s is the bombed brick house again, scripts/bombed-ruin.js: the burnt timber build stays in the add-on, unused)
  for (const n of [...OWN.filter((q) => q !== 'ruin_burned_timber'), 'tent_ridge_field']) assert.ok(seen.has(n), `${n} used`);
  assert.equal(byId('ruin_s').asset, 'house_bombed_b');
  for (const id of ['ruin_w', 'ruin_ne', 'chapel', 'barr_c', 'hq', 'hq_leanto', 'ruin_s', 'turret_w', 'tower_nw', 'tower_s', 'chapel_tower', 'hq_tower'])
    assert.ok(byId(id).asset, `${id} has its own build`);
}));

test('art m06: the ruins\' decks and the HQ roof are drawn at the mission\'s walk heights; the clock stands on the deck', () => {
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  for (const n of ['house_bombed_log_w', 'house_bombed_log_ne']) assert.ok(add.assets[n].walkableRoofs.some((r) => Math.abs(r.elev - byId('ruin_w').roofY) < 0.02), n);
  assert.ok(add.assets.hq_fortified_block.walkableRoofs.some((r) => Math.abs(r.elev - byId('hq').roofY) < 0.02), 'HQ roof at 6.5');
  for (const s of [byId('ruin_w'), byId('ruin_ne'), byId('hq')]) {
    const a = add.assets[s.asset], e = a.bbox;
    assert.ok(Math.abs((e.max[0] - e.min[0]) - s.w) < 4.5 && Math.abs((e.max[2] - e.min[2]) - s.d) < 4.5, `${s.id} bbox`);
  }
  assert.ok(Math.abs(add.assets.grandfather_clock.bbox.min[1] - byId('ruin_w').roofY) < 0.02, 'clock foot on the deck');
  // the deck walls are drawn by the ruin's build (their nav strips stay the mission's)
  const deckWalls = m06.structures.filter((s) => /^rw_(p|n|w)/.test(s.id));
  assert.ok(deckWalls.length >= 10 && deckWalls.every((s) => s.visual === false && s.walkways?.length), 'deck walls visual-only');
});

test('art m06: garrisons draw their door where the game enters them (mid-wall, ≤ 0.3 m)', () => withLib(merged(), () => {
  const m = merged();
  for (const s of m06.structures.filter((q) => q.asset && q.garrison)) {
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm06' });
    assert.equal(pk.turn, 0, s.id);
    const a = m.assets[pk.name], dr = a.doors.find((d) => d.node === 'door_front');
    assert.ok(dr, `${s.id} front door`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height);
    const lx = sx * (dr.pos[0] - pk.ext.cx), lz = sz * (dr.pos[2] - pk.ext.cz), c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0);
    const x = s.x + lx * c - lz * n, z = s.z + lx * n + lz * c;
    const dp = doorPoint(s), side = (s.rot ?? 0) + (s.door ?? Math.PI / 2), wx = dp.x - Math.cos(side), wz = dp.z - Math.sin(side);
    assert.ok(Math.hypot(x - wx, z - wz) < 0.3, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry ${wx.toFixed(2)},${wz.toFixed(2)}`);
  }
}));

test('art m06: stone walls carry an iron railing on piers up to the gameplay height', () => {
  const w = byId('w_x1');
  const g = buildWall(w.points, { variant: w.variant, mat: w.mat, h: w.h, width: w.width, id: w.id });
  assert.equal(g.name, 'dressing:wall:stone_railing');
  let top = 0;
  g.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.max.y + o.position.y); } });
  assert.ok(top > w.h * 0.95 && top < w.h + 0.2, `top ${top.toFixed(2)}`);
});

test('art m06: dressing is visual only (furniture off the walk grid, drums undrawn in nav, parked library vehicles)', () => {
  assert.ok(m06.furniture.length >= 6 && m06.furniture.every((f) => f.block === false));
  assert.ok(m06.furniture.some((f) => f.variant === 'norway_wood'), 'Norwegian wooden lamp posts');
  for (const s of m06.structures.filter((q) => /^drums_/.test(q.id))) assert.equal(s.block, 0, s.id);
  for (const id of ['moto_hq', 'truck_ne']) assert.ok(byId(id)?.vehicleArt, id);
});

test('art m06: one chapel garrison flag, on the free-standing pole E of the door (user axis 79.0, 20.0), clear of the rails', () => {
  const ch = byId('chapel'), pole = byId('chapel_flag');
  assert.equal(ch.flag, false, 'no fallback corner pole on the library chapel');
  assert.ok(!ch.flagShift, 'the library chapel has no kit pole to shift');
  assert.ok(Math.hypot(pole.x - 79.0, pole.z - 20.0) < 0.01 && /flagpole/.test(pole.variant));
  assert.ok(pole.x > ch.x && pole.z > ch.z + ch.d / 2, 'E of the door, in front of the facade');
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
  const lineDist = (id, p) => { const pts = byId(id).points; let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i])); return d; };
  for (const p of [[pole.x, pole.z], ...m06.furniture.filter((f) => f.type === 'lamp').map((f) => [f.x, f.z])]) {
    assert.ok(lineDist('rail_main', p) >= 4.0, `${p} off the main line`);
    assert.ok(lineDist('rail_spur', p) >= 3.0, `${p} off the spur`);
  }
});

test('art m06: nobody walks through the W ruin\'s stone flights at ground level (noWalk), round them still open', async () => {
  const { loadGrid } = await import('./mission-check.mjs');
  const { findPath } = await import('../../src/world/pathfinding.js');
  const g = loadGrid(m06).grid;
  const blocked = (x, z) => { const c = g.worldToCell(x, z); return !!g.noWalk?.[g.idx(c.i, c.j)]; };
  // along each flight's centreline, from just past its foot to just short of the ruin wall
  for (const [x, z] of [[30, 48.7], [30, 47.5], [30, 46.3], [46.2, 44.3], [45, 43.3]]) assert.ok(blocked(x, z), `ground under the flight at ${x},${z}`);
  for (const [x, z] of [[30, 49.3], [47.3, 45.3]]) assert.ok(!blocked(x, z), `the foot of the flight at ${x},${z} stays open`);
  assert.ok(findPath(g, 27, 48, 33, 48, { maxNodes: 200000 }), 'a man walks round the S flight');
});

test('art m06 pass 2: purposeful dressing on rule-clean spots (off every beat, loop, post, the car\'s road and the solution\'s ways)', async () => {
  const { M06_ART2 } = await import('../../src/art/m06-dressing.js');
  const ids = new Set(M06_ART2.map((s) => s.id));
  for (const s of M06_ART2) assert.ok(byId(s.id) === s, `${s.id} spread into the mission`);
  for (const id of ['logs_barr', 'fuel_hq', 'crates_ck', 'fuel_ck', 'lorry_x', 'timber_x', 'shed_ch']) assert.ok(ids.has(id), id);
  const segD = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
  const lines = [], posts = [];
  const poly = (pts, closed) => { for (let i = 1; i < pts.length; i++) lines.push([pts[i - 1], pts[i]]); if (closed) lines.push([pts[pts.length - 1], pts[0]]); };
  const xz = (ps) => ps.map((p) => [p.x, p.z]);
  for (const e of m06.enemies) {
    if (e.route) poly(xz(e.route.points), e.route.type === 'LOOP'); else if (!e.vehicle) posts.push([e.x, e.z]);
    if (e.alarmRoute?.loop) poly(xz(e.alarmRoute.loop.points), true);
  }
  for (const b of Object.values(m06.barracks)) for (const q of b.squads) { poly(xz(q.exitRoute)); poly(xz(q.loop), true); }
  const road = []; for (const v of m06.vehicles) { const pts = xz(v.route.points); for (let i = 1; i < pts.length; i++) road.push([pts[i - 1], pts[i]]); }
  // the scripted solution's ways (sol/m06: W field, SW snow, S edge, SE walk, E edge, the gun corridor, the NE passage)
  const SOL = [[[9.5, 63.5], [2.5, 93.5], [30, 96], [48.5, 100.5], [52, 103], [75, 104], [88, 101], [92.3, 88.8], [115.3, 94.3], [120.1, 100.7], [130.5, 96],
    [130.5, 80], [128, 72], [124, 64], [118, 60], [108.5, 58.5], [100.5, 59.5]], [[100.5, 72.5], [98.5, 69.5], [99.5, 61.5]],
  [[100.5, 40.5], [104.3, 42.3], [107, 39], [108.4, 38.4], [108.3, 35.3], [109.3, 34.3], [117.5, 27.5], [120.5, 8.5]]];
  const lean = byId('hq_leanto'), inLean = (s) => Math.abs(s.x - lean.x) < lean.w / 2 && Math.abs(s.z - lean.z) < lean.d / 2;
  for (const s of M06_ART2) {
    assert.ok(s.fixed && (s.block ?? 1) >= 1 && (s.asset || s.vehicleArt || s.type === 'crates' || s.variant === 'fuel_drums'), `${s.id}: drawn library piece that blocks`);
    // the body's corners (half extents, rotated)
    const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0), pts = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => [s.x + (u * s.w / 2) * c - (v * s.d / 2) * n, s.z + (u * s.w / 2) * n + (v * s.d / 2) * c]);
    const dmin = (L) => Math.min(...pts.flatMap((p) => L.map(([a, b]) => segD(p, a, b))));
    // (the HQ lean-to's cordwood and drums stand inside its LOW footprint, which the alarm loop already walks round)
    if (!inLean(s)) assert.ok(dmin(lines) >= 1.3, `${s.id} ${dmin(lines).toFixed(2)} m off a beat / loop`);
    assert.ok(Math.min(...posts.map(([x, z]) => Math.hypot(x - s.x, z - s.z))) >= 3, `${s.id} off every post`);
    assert.ok(dmin(road) >= 5, `${s.id} off the armoured car's road`);
    assert.ok(Math.min(...SOL.map((pl) => dmin(pl.slice(1).map((p, i) => [pl[i], p])))) >= 8, `${s.id} off the solution's ways`);
  }
  // the X: w_x2 bends (collinear) where it crosses w_x1, so a pier stands on the crossing
  const x1 = byId('w_x1').points, x2 = byId('w_x2').points;
  assert.equal(x2.length, 3);
  assert.ok(segD(x2[1], x1[0], x1[1]) < 1e-6 && segD(x2[1], x2[0], x2[2]) < 1e-6, 'pier on the crossing, w_x2 still straight');
  // the R75 out from under pine (91,100)'s crown at the default camera
  assert.ok(byId('moto_hq').x <= 83.5);
});
