/** M4 art pass (Restore Pride, Stokkan): the granite inner arch (with its collapsed twin), Norwegian fieldstone wall
 *  fragments by the start, the SE farm ruins bombed brick houses whose gameplay is the drawn shell, a henhouse and a log guardhouse of their own (with ruins), the drowned Panzer II on
 *  pack ice, the rendered outer wall under its iron railing, the board inner fence, the steel lattice girders of the
 *  trestle on granite pier heads; set dressing clear of every route, post and start; furniture visual only. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { buildRailBridge } from '../../src/art/kit-terrain.js';
import { MISSIONS } from '../../src/missions/index.js';
import { BOMBED_RUIN_NAV } from '../../src/missions/scripts/bombed-ruin.js';
import { loadGrid } from './mission-check.mjs';
import { B } from '../../src/world/grid.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm04'); try { return await fn(); } finally { await useManifest(null); } };
const m04 = MISSIONS.find((m) => m.id === 'm04');
const S = (id) => m04.structures.find((s) => s.id === id);
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const meshes = (o) => { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); return n; };

test('art m04: the arch, the henhouse, the guardhouse and the ruins draw the Stokkan builds (snow, with their ruins)', () => withLib(merged(), () => {
  const man = JSON.parse(readFileSync(P('assets/models/buildings/manifest-stokkan.json')));
  assert.ok(EXTRA_MANIFESTS.includes('manifest-stokkan'));
  const want = { arch: 'arch_gate_granite_no', henhouse: 'henhouse_no', jail_hut: 'jail_guardhouse_no', ruin_w1: 'ruin_fieldstone_no_a',
    ruin_w3: 'ruin_fieldstone_no_a' };
  for (const [id, name] of Object.entries(want)) {
    const s = S(id);
    assert.equal(s.asset, name, id);
    assert.equal(s.nav, false, `${id}: visual only, the mission's nav stays`);
    const a = man.assets[name];
    assert.ok(a && a.snowVariant === `${name}_snow` && man.assets[`${name}_snow`]?.snow, `${name} has its snow build`);
    assert.ok(pickAsset(s.type, s, { theater: 'snow', missionId: 'm04' })?.name.startsWith(name), id);
  }
  for (const n of ['arch_gate_granite_no', 'henhouse_no', 'jail_guardhouse_no']) assert.equal(man.assets[n].destroyedVariant, `${n}_destroyed`, n);
  for (const s of m04.structures.filter((q) => q.type === 'ruins' && q.variant === 'wall_ruined_stone')) assert.match(s.asset ?? '', /^ruin_fieldstone_no_/, s.id);
}));

const SE = ['ruin_se1', 'ruin_se2', 'ruin_se3', 'ruin_se4', 'ruin_se5'];
test('art m04: the SE farm ruins are bombed brick houses again, their gameplay the drawn shell, clear of every walk and post', () => withLib(merged(), () => {
  // the shell (7.9 × 5.8 m) and its two rubble spills, in the ruin's frame (scripts/bombed-ruin.js)
  const RECTS = [[-3.96, 3.96, -2.88, 2.88], [0.965, 3.499, 2.693, 5.227], [-0.547, 1.411, -4.723, -2.765]];
  const dist = (r, x, z) => {
    const c = Math.cos(r.rot), s = Math.sin(r.rot), u = (x - r.x) * c + (z - r.z) * s, v = -(x - r.x) * s + (z - r.z) * c;
    return Math.min(...RECTS.map(([x0, x1, z0, z1]) => Math.hypot(Math.max(x0 - u, 0, u - x1), Math.max(z0 - v, 0, v - z1))));
  };
  for (const id of SE) {
    const r = S(id);
    assert.equal(pickAsset(r.type, r, { theater: 'snow', missionId: 'm04' })?.name, 'house_bombed_b', id);
    assert.ok(r.navParts === BOMBED_RUIN_NAV && r.nav === false && r.h === 7 && r.block === 0, `${id}: the shared bombed-ruin nav`);
    for (const e of m04.enemies.filter((q) => !q.vehicle)) {
      assert.ok(dist(r, e.x, e.z) >= 2, `${id}: ${e.id}'s post / start ${dist(r, e.x, e.z).toFixed(2)} m`);
      if (!e.route) continue;
      const P = [{ x: e.x, z: e.z }, ...e.route.points, ...(e.route.type === 'LOOP' ? [e.route.points[0]] : [])];
      for (let i = 0; i + 1 < P.length; i++) for (let t = 0; t <= 1; t += 0.05) {
        const d = dist(r, P[i].x + (P[i + 1].x - P[i].x) * t, P[i].z + (P[i + 1].z - P[i].z) * t);
        assert.ok(d >= 1.5, `${id}: ${e.id}'s walk ${d.toFixed(2)} m off the shell`);
      }
    }
  }
}));

test('art m04: in the grid each SE ruin is its drawn shell (walls B.HIGH, breach and rubble B.LOW, a closed inside)', () => {
  const { grid } = loadGrid(m04);
  for (const id of SE) {
    const r = S(id), c = Math.cos(r.rot), s = Math.sin(r.rot), at = (dx, dz) => grid.blockAt(r.x + dx * c - dz * s, r.z + dx * s + dz * c);
    assert.equal(at(-3.76, 0), B.HIGH, `${id} wall`); assert.equal(at(0, -2.68), B.HIGH, `${id} wall`);
    assert.equal(at(2.6, 2.68), B.LOW, `${id} breach`); assert.equal(at(2.2, 4), B.LOW, `${id} rubble`);
    assert.equal(at(-1, 0), B.LOW, `${id}: the inside is the fallen storeys`);
  }
});

test('art m04: the sunken tank is a drowned Panzer II wreck on pack ice (the pier deck stays the walk)', () => {
  const t = S('wreck_tank');
  assert.equal(t.type, 'pier');
  assert.equal(t.vehicleArt, 'panzer2_f');
  assert.ok(t.wreck && t.sink > 0.5 && t.ice, 'wrecked, sunk, ice crust');
});

test('art m04: the outer wall is rendered masonry under an iron railing; the inner one a board fence (not plain slabs)', () => {
  const wo = S('wall_outer'), wi = S('wall_inner');
  const o = buildWall(wo.segments[0], { variant: wo.variant, mat: wo.mat, h: wo.h, width: wo.width, id: wo.id });
  const i = buildWall(wi.segments[0], { variant: wi.variant, mat: wi.mat, h: wi.h, width: wi.width, id: wi.id });
  assert.equal(o.name, 'dressing:wall:plaster_railing');
  assert.equal(i.name, 'dressing:wall:board_fence');
  assert.ok(meshes(o) >= 3 && meshes(i) === 3, `${meshes(o)} / ${meshes(i)} meshes`);
});

test('art m04: the trestle carries steel lattice girders and granite pier heads at the mission pillars', () => {
  const b = S('bridge_rail');
  const g = buildRailBridge({ ...b });
  const plain = buildRailBridge({ ...b, variant: 'timber', pillars: [] });
  assert.ok(meshes(g) > meshes(plain) + 60, `${meshes(g)} vs ${meshes(plain)}`);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  for (const [px, pz] of b.pillars) {
    const lx = (px - b.x) * c + (pz - b.z) * s;
    let hit = false;
    g.traverse((m) => { if (m.isMesh && Math.abs(m.position.x - lx) < 0.05 && m.position.y < 0) hit = true; });
    assert.ok(hit, `pier head under pillar (${px}, ${pz})`);
  }
});

test('art m04: the set dressing stays ≥ 1.5 m off every route and ≥ 3 m off every post and start; furniture never blocks', () => {
  const ids = ['kw_villa', 'moto_villa', 'logs_hb', 'logs_jail', 'sleepers_y', 'drums_corr', 'crates_stair', 'cart_x', 'handcar_y'];
  const segs = [];
  for (const e of m04.enemies) {
    const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || [])].filter((p) => p.x != null);
    for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]);
  }
  for (const b of Object.values(m04.barracks)) for (const sq of b.squads) for (const r of [sq.exitRoute || [], sq.loop || []]) for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]);
  for (const v of m04.vehicles) { const r = v.route?.points || []; for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]); }
  for (const id of ids) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.ok(s && s.block <= 1 && s.fixed, `${id} low cover, authored`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route`);
    for (const q of [...m04.enemies, ...m04.commandos, ...m04.interactables]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m04.furniture.length >= 9 && m04.furniture.every((f) => f.block === false));
});

// ---------------------------------------------------------------- art pass 2 (art/m04-dressing.js, buildCliff taper)
// What is drawn feeds the walk grid (map-builder vis / body-solid stamps), and the M4 solution's escape plans on it: the
// pass 2 pieces keep the placeholder's standing geometry where a body or a hull met it (tests below), so the walk stays.
import { buildCliff, buildCrates } from '../../src/art/dressing.js';
import { buildRafCrates, buildParachuteSpread, buildLongLogPile, buildSleeperStack, buildPlatelayerStack, crownHeap } from '../../src/art/m04-dressing.js';
import { buildSignVariant } from '../../src/art/kit-props.js';
import * as THREE from 'three';
import { CONFIG } from '../../src/config.js';

const posOf = (g, rx = null) => { const out = []; g.updateMatrixWorld(true); g.traverse((o) => { if (!o.isMesh || (rx && !rx.test(o.material?.name || ''))) return; const gg = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry).clone().applyMatrix4(o.matrixWorld); out.push(...gg.attributes.position.array); }); return out; };
const boxOf = (g) => new THREE.Box3().setFromObject(g);

test('art2 m04: the air-drop is the placeholder\'s two crates box for box (re-skinned), the pickup and the crates pinned', () => {
  const c = S('crate_drop'), it = m04.interactables.find((i) => i.id === 'drop');
  assert.equal(c.variant, 'raf_crates'); assert.ok(c.block === 0 && c.fixed, 'block 0, fixed');
  assert.ok(it.fixed && it.x === 180.511 && it.z === 32.548, 'the pickup where the placement put it on master');
  const mine = posOf(buildRafCrates(c), /planks/), old = posOf(buildCrates({ ...c, variant: 'airdrop_crate' }));
  assert.equal(mine.length, old.length, 'the same crates');
  assert.ok(mine.every((v, k) => Math.abs(v - old[k]) < 1e-6), 'vertex for vertex');
});

test('art2 m04: the canopy lies flat (≤ 0.085 m) but for its crown, the placeholder\'s silk heap vertex for vertex', () => {
  const p = S('canopy');
  assert.equal(p.variant, 'parachute_spread'); assert.ok(p.block === 0 && p.fixed);
  const heap = crownHeap(p); const H = posOf(heap);
  const oldHeap = posOf(buildSignVariant({ ...p, variant: 'parachute_canopy' }), /silk$/);
  assert.equal(H.length, oldHeap.length, 'the same heap');
  assert.ok(H.every((v, k) => Math.abs(v - oldHeap[k]) < 1e-6), 'vertex for vertex');
  const g = buildParachuteSpread(p); let hi = 0;
  g.traverse((o) => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); if ((x / 1.8) ** 2 + (z / 1.45) ** 2 > 1) hi = Math.max(hi, P.getY(i)); } });
  assert.ok(hi <= 0.085, `cloth outside the crown ${hi.toFixed(3)} m`);
});

test('art2 m04: the stair-gap tongues are drawn low at the gap; below 2.2 m the rock is the untapered one vertex for vertex', () => {
  for (const [id, at] of [['cliff_hq', [47.6, 55.6]], ['cliff_ne_w', [45.4, 62.4]]]) {
    const s = S(id);
    assert.ok(s.taper?.length && !s.abut, `${id}: tapered, its outline's faces as they were`);
    const a = buildCliff({ ...s, taper: undefined }).children[0].geometry.attributes.position.array;
    const b = buildCliff(s).children[0].geometry.attributes.position.array;
    assert.equal(a.length, b.length, id);
    let near = 0;
    for (let k = 0; k < a.length; k += 3) {
      assert.equal(a[k], b[k], `${id} x`); assert.equal(a[k + 2], b[k + 2], `${id} z`);
      if (a[k + 1] <= 2.2) assert.equal(a[k + 1], b[k + 1], `${id}: below the floor`); else assert.ok(b[k + 1] <= a[k + 1] + 1e-9, `${id}: only ever lower`);
      if (Math.hypot(b[k] - at[0], b[k + 2] - at[1]) < 1.5) near = Math.max(near, b[k + 1]);
    }
    assert.ok(near > 0 && near < 3.6, `${id}: ${near.toFixed(2)} m tall at the gap (a 7–8 m blade before)`);
  }
});

test('art2 m04: no up-facing cap triangle of the tapered tongues has a vertex normal pointing down (drawn black)', () => {
  // built as the map builder builds them: the mesh at the outline's vertex average, the outline carried on past the
  // map edge (art/props.js cliffEdge); the tongue tips' caps fold (their inset rings cross), so their normals pointed down
  const edge = { W: m04.size[0], D: m04.size[1], out: CONFIG.apron.width + 12 };
  for (const id of ['cliff_hq', 'cliff_ne_w']) {
    const s = S(id), n = s.points.length;
    const x = s.points.reduce((a, q) => a + q[0], 0) / n, z = s.points.reduce((a, q) => a + q[1], 0) / n;
    const m = buildCliff({ ...s, x, z, edge }).children[0], g = m.geometry, P = g.attributes.position, N = g.attributes.normal;
    const I = g.index.array, cap = m.userData.capStart;
    let up = 0;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, q] = [I[t], I[t + 1], I[t + 2]];
      if (a < cap) continue;
      const fy = (P.getZ(b) - P.getZ(a)) * (P.getX(q) - P.getX(a)) - (P.getX(b) - P.getX(a)) * (P.getZ(q) - P.getZ(a));
      if (!(fy > 0)) continue;
      up++;
      for (const v of [a, b, q]) {
        assert.ok(N.getY(v) >= 0, `${id}: cap triangle ${t / 3} faces up, its vertex ${v} normal points down (${N.getY(v).toFixed(2)}) at (${(P.getX(v) + x).toFixed(1)}, ${P.getY(v).toFixed(1)}, ${(P.getZ(v) + z).toFixed(1)})`);
      }
    }
    assert.ok(up > 500, `${id}: ${up} up-facing cap triangles checked`);
  }
});

test('art2 m04: the log pile lies on the placeholder\'s planks; the sleeper and rail stacks stay inside their footprints', () => {
  const d = S('debris_logs');
  assert.equal(d.variant, 'log_pile_long');
  const mine = posOf(buildLongLogPile(d), /^dressing:planks$/), old = posOf(buildCrates({ ...d, variant: 'timber_debris' }));
  assert.ok(mine.length === old.length && mine.every((v, k) => Math.abs(v - old[k]) < 1e-6), 'the same planks');
  const pile = boxOf(buildLongLogPile({ ...d, id: 'x' }));
  assert.ok(pile.max.y < 1.7 && pile.max.y > 0.9, `pile ${pile.max.y.toFixed(2)} m`);
  for (const [id, fn] of [['sleepers_y', buildSleeperStack], ['debris_cart', buildPlatelayerStack]]) {
    const s = S(id), b = boxOf(fn(s));
    assert.ok(b.min.x >= -s.w / 2 - 0.05 && b.max.x <= s.w / 2 + 0.05 && b.min.z >= -s.d / 2 - 0.05 && b.max.z <= s.d / 2 + 0.05, `${id} inside its ${s.w} × ${s.d} footprint`);
    assert.equal(s.block, 1, `${id}: low cover as before`);
  }
});

test('art2 m04: the four static overlaps of master are dealt with in the data (draw, not footprint)', () => withLib(merged(), () => {
  // house_b: a timber hut that fits its footprint (the log cabin, squeezed to 72 %, still ran 1.7 m into house_a's wall)
  const hb = S('house_b');
  assert.equal(hb.asset, 'relay_station_no_snow');
  assert.ok(hb.x === 90 && hb.z === 24.5 && hb.w === 4.5 && hb.d === 5 && hb.enterable, 'house_b: the same footprint, enterable');
  assert.equal(pickAsset(hb.type, hb, { theater: 'snow', missionId: 'm04' })?.name, 'relay_station_no_snow');
  assert.deepEqual(S('garr2').clipAllow, ['garr1'], 'the dossier\'s one long block: the two halves\' eaves meet');
  assert.ok(S('garr2').x === 92.8 && S('garr2').z === 2.6 && !S('garr2').artFill, 'garr2 as drawn on master');
  assert.match(S('pier_float').hideMats, /fieldstone_grey/, 'no shore abutment out on the floating stage');
  assert.deepEqual(S('stair_pier1').clipAllow, ['cliff_hq'], 'the stair head let into the rock tongue');
  const pin = m04.structures.find((s) => s.type === 'pine' && s.fixed);
  assert.ok(pin && pin.x === 64.784 && pin.z === 23.444, 'the first HQ pine pinned where the placement put it on master');
}));

test('art2 m04: a repeat drawn by its own copy (the landing stage) stays out of the water\'s bed capture like its batch', async () => {
  // master drew the four jetties instanced, and the water's bed capture leaves instanced meshes out: the stage, now its
  // own copy (no shore abutment), must not gain a foam ring the other three jetties do not have
  const { batchLibraryRepeats, INSTANCE_MIN } = await import('../../src/world/map-builder.js');
  assert.equal(INSTANCE_MIN, 3);
  const lib = (asset, def = {}) => ({ type: 'pier', def, library: { asset, matrix: new THREE.Matrix4(), object3d: new THREE.Group(), dispose() {} } });
  const jetty = [lib('jt'), lib('jt'), lib('jt'), lib('jt', { hideMats: S('pier_float').hideMats })];
  const few = [lib('few'), lib('few', { dropAo: 'x' }), lib('few', { hideParts: ['y'] })];
  const two = [lib('two'), lib('two', { keepSnowOn: 'z' })];
  const log = [], warn = console.warn; console.warn = () => {};
  try { await Promise.all(batchLibraryRepeats([...jetty, ...few, ...two], new THREE.Group(), log)); } finally { console.warn = warn; }
  assert.deepEqual(jetty.map((b) => !!b.batched), [true, true, true, false], 'the three plain jetties instanced, the stage its own copy');
  assert.deepEqual(jetty.map((b) => !!b.library.object3d.userData.waterIgnore), [false, false, false, true], 'the stage out of the bed capture');
  assert.ok(few.every((b) => !b.batched && b.library.object3d.userData.waterIgnore), 'too few left to batch: all out, as the batch was');
  assert.ok(two.every((b) => !b.batched && !b.library.object3d.userData.waterIgnore), 'never a batch: in the capture as before');
});
