/** M9 art pass (Bab el Qattara, "A Courtesy Call"): the Bab el Qattara add-on, each structure's own build fitted to its
 *  footprint, the doors where the game enters, the octagon's mud-brick wall, the set dressing clear of the routes. */
import { readFileSync, existsSync } from 'node:fs';
import { readGlb, glbJson } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';
import * as THREE from 'three';
import { fixPalmFrond } from '../../src/art/building-fixups.js';
import { M09_DRESSING, M09_RUTS } from '../../src/art/m09-dressing.js';
import { buildCampRuts, drapedGeometry, coverCells } from '../../src/art/camp-ruts.js';
import { sampleTrack } from '../../src/art/airstrip.js';
import { LIFT } from '../../src/art/pavement/road-mesh.js';
import { TANK_ROUTES } from '../../src/missions/scripts/m09.js';
import { PT_NW_RUN, PT_SE_RUN, L_YARD, TANKER_SPOT } from '../../src/missions/m09_a_courtesy_call.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-bab-el-qattara';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm09'); try { return await fn(); } finally { await useManifest(null); } };
const m09 = MISSIONS.find((m) => m.id === 'm09');
const OWN = ['tank_shed_open_bq', 'house_stone_bq_a', 'house_stone_bq_b', 'house_stone_store_bq', 'house_flat_white_bq', 'command_post_white_bq', 'hq_domed_terraced_bq',
  'comms_hut_antenna_bq', 'sandbag_bunker_thatch_bq', 'gantry_hoist_bq', 'drum_dump_yellow_bq', 'ammo_boxes_bq_a', 'ammo_boxes_bq_b',
  'lean_to_mud_bq']; // (art pass 2: the NE house's lean-to)
const pick = (s) => pickAsset(s.type, s, { theater: 'desert', missionId: 'm09' });

test('art m09: the Bab el Qattara add-on ships every LOD, sidecar and texture, desert, under its own types only', () => {
  assert.ok(EXTRA_MANIFESTS.includes(ADDON));
  const add = JSON.parse(readFileSync(P(`assets/models/buildings/${ADDON}.json`)));
  const alias = base().textures.aliases;
  const found = (u) => existsSync(u) || (alias[u.pathname.split('/').pop()] && existsSync(new URL(alias[u.pathname.split('/').pop()], u)));
  for (const n of OWN) {
    const a = add.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) {
      assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
      const glb = readGlb(P(`assets/models/${l.url}`)).toString('latin1');
      for (const [, u] of glb.matchAll(/"uri":"([^"]+)"/g)) assert.ok(found(new URL(u, P(`assets/models/${l.url}`))), `${l.url} → ${u}`);
    }
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('desert'), n);
  }
  const b = base(), m = merged();
  for (const t of ['house', 'barracks', 'hut', 'bunker', 'tank_shed', 'crates', 'barrels', 'flat_roof_house', 'ruins'])
    assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m09: every asset-picked structure takes its own build, fitted to the gameplay footprint (≤ 12 % per axis)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m09.structures.filter((q) => q.asset)) {
    const pk = pick(s);
    assert.ok(pk && pk.name === s.asset, `${s.id} → ${pk?.name}`);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(2)}×${ed.toFixed(2)} on ${w}×${d}`);
    if (s.type !== 'crates' && s.type !== 'barrels') assert.equal(s.nav, false, `${s.id}: gameplay nav, not the build's`);
  }
  for (const n of OWN) assert.ok(seen.has(n), `${n} used`);
  for (const s of m09.structures) {
    const pk = pick(s);
    if (pk) assert.doesNotMatch(pk.name, /log_cabin|house_timber|norway|_snow$|brick_be|mosan/, s.id);
  }
}));

test('art m09: the hideouts and targets draw their door where the game enters them (mid-wall, ≤ 0.35 m)', () => withLib(merged(), () => {
  const m = merged(), doors = m09.structures.filter((q) => q.asset && q.door != null && (q.enterable || q.garrison));
  assert.ok(doors.length >= 6, `${doors.length} doors checked`);
  for (const s of m09.structures.filter((q) => q.asset && q.door != null && (q.enterable || q.garrison))) {
    const pk = pick(s);
    assert.equal(pk.turn, 0, s.id);
    const a = m.assets[pk.name], dr = a.doors.find((d) => d.node === 'door_main');
    assert.ok(dr, `${s.id} main door`);
    const { sx, sz } = fitScale(s.w / pk.ext.w, s.d / pk.ext.d, dr.height);
    const lx = sx * (dr.pos[0] - pk.ext.cx), lz = sz * (dr.pos[2] - pk.ext.cz), c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = s.x + lx * c - lz * n, z = s.z + lx * n + lz * c;
    const dp = doorPoint(s);
    // the game's entry point lies 1 m out from the wall on the door's side: the drawn door sits on that wall, opposite it
    const [ex, ez] = Array.isArray(s.door) ? s.door : [dp.x, dp.z];
    const toWall = Math.min(Math.abs(Math.abs(x - s.x) - s.w / 2), Math.abs(Math.abs(z - s.z) - s.d / 2));
    assert.ok(toWall < 0.35, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} not on a wall`);
    const along = Math.abs(Math.abs(x - s.x) - s.w / 2) < 0.35 ? Math.abs(z - ez) : Math.abs(x - ex);
    assert.ok(along < 0.6, `${s.id}: drawn door ${x.toFixed(2)},${z.toFixed(2)} vs entry ${ex},${ez}`);
  }
}));

test('art m09: the octagon is drawn as the camp mud-brick wall, the broken stub as a ruin; crest at the gameplay height', () => {
  for (const s of m09.structures.filter((q) => q.type === 'wall' && /^mudbrick_(wire|broken)$/.test(q.variant))) {
    const g = buildWall(s.points, { ...s });
    assert.ok(g, s.id);
    let top = -Infinity;
    g.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); o.updateWorldMatrix(true, false); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); top = Math.max(top, b.max.y); } });
    if (s.variant === 'mudbrick_wire') assert.ok(Math.abs(top - s.h) < 0.12, `${s.id}: crest ${top.toFixed(2)} vs ${s.h}`);
    else assert.ok(top <= s.h + 0.4, `${s.id}: ruin top ${top.toFixed(2)}`); // a palm joist may stick up out of the broken crest
  }
});

test('art m09: the palm-frond shade cards are alpha-tested cut-outs, not opaque squares (house_flat_white_bq, house_stone_bq_b)', () => {
  const glbMats = (f) => glbJson(P(f)).materials;
  for (const n of ['house_flat_white_bq', 'house_stone_bq_b']) assert.ok(glbMats(`assets/models/buildings/desert/${n}.glb`).some((m) => /kit:palm_frond/.test(m.name)), n);
  const frond = new THREE.MeshStandardMaterial({ name: 'kit:palm_frond_dz', map: new THREE.Texture() });
  const wall = new THREE.MeshStandardMaterial({ name: 'kit:whitewash', map: new THREE.Texture() });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), frond), new THREE.Mesh(new THREE.BufferGeometry(), [wall, frond]));
  assert.equal(fixPalmFrond(root), 1); // shared material counted once
  assert.ok(/fixPalmFrond\(root\)/.test(readFileSync(P('src/art/building-fixups.js'), 'utf8').split('export function applyAssetFixups')[1]), 'wired into applyAssetFixups');
  assert.ok(frond.alphaTest >= 0.3 && frond.alphaTest <= 0.7, String(frond.alphaTest));
  assert.equal(frond.side, THREE.DoubleSide);
  assert.equal(frond.transparent, false);
  assert.equal(wall.alphaTest, 0);
});

// ---------------------------------------------------------------- art pass 2
const S9 = (id) => m09.structures.find((q) => q.id === id);
const segD = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const cross = (a, b, c, d) => { // proper intersection of segments ab and cd
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

test('art m09 pass 2: the new pieces stand clear of every route, post, alarm run, tank drive, the tanker\'s and the Spy\'s ways and our lorry\'s road', () => {
  const ids = ['wreck_pz3', 'flak_pit', 'flak_se', 'flak_ammo'];
  assert.deepEqual(M09_DRESSING.map((q) => q.id).sort(), [...ids].sort());
  const segs = [], xy = (p) => (Array.isArray(p) ? p : [p.x, p.z]);
  const add = (pts, loop) => { for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); if (loop) segs.push([pts.at(-1), pts[0]]); };
  for (const e of m09.enemies) if (e.route?.points) add(e.route.points.map(xy), e.route.type === 'LOOP');
  add(L_YARD.map(xy), true); add(PT_NW_RUN); add(PT_SE_RUN);
  for (const [id, pts] of Object.entries(TANK_ROUTES)) { const v = m09.vehicles.find((q) => q.id === id); add([[v.x, v.z], ...pts]); }
  for (const g of Object.values(m09.barracks)) for (const q of g.squads) add(q.exitRoute.map(xy));
  const tk = m09.vehicles.find((q) => q.id === 'tanker'), ex = m09.extraction;
  add([[tk.x, tk.z], [TANKER_SPOT.x, TANKER_SPOT.z]]);
  add([[ex.spawnAt.x, ex.spawnAt.z], [ex.arrive.x, ex.arrive.z]]); add([[ex.arrive.x, ex.arrive.z], [ex.leave.x, ex.leave.z]]);
  // the dossier's walks (§11): the Spy and the Driver in by the NE road to the E gate; the S group in through gate_s
  add([[58.5, 2.5], [70, 6], [80, 12], [77, 24], [75.2, 30.8]]); add([[51, 105.8], [54.25, 98.25]]);
  const spots = [...m09.enemies, ...m09.vehicles, ...m09.commandos, ...m09.markers];
  for (const id of ids) {
    const s = S9(id), r = s.ring ? s.ring.r + 0.5 : Math.hypot(s.w, s.d) / 2, p = [s.x, s.z];
    assert.ok(s.x - r >= 0 && s.x + r <= m09.size[0] && s.z - r >= 0 && s.z + r <= m09.size[1], `${id} on the map`);
    const dr = Math.min(...segs.map(([a, b]) => segD(p, a, b))) - r;
    assert.ok(dr >= 6, `${id}: ${dr.toFixed(2)} m from a route`);
    for (const u of spots) assert.ok(Math.hypot(u.x - s.x, u.z - s.z) - r >= 6, `${id} by ${u.id ?? u.role}`);
    for (const b of m09.structures.filter((q) => q.type === 'bush')) assert.ok(Math.hypot(b.x - s.x, b.z - s.z) - r - b.r >= 0.8, `${id} on ${b.id}`);
  }
  // the write-off: the library Panzer III, burnt, solid by its drawn hull; no building under it
  const wr = S9('wreck_pz3');
  assert.ok(wr.vehicleArt === 'panzer3_j' && wr.wreck === true && wr.block === 2 && wr.fixed);
  assert.equal(pickAsset(wr.type, wr, { theater: 'desert', missionId: 'm09' }), null, 'no building under it');
  // the Flak stands inside its pit (platform clear of the bags), the pit short of the minefield wire, the ammunition at its mouth
  const pit = S9('flak_pit'), gun = S9('flak_se'), am = S9('flak_ammo'), wire = m09.structures.find((q) => q.id === 'wx_mines');
  assert.ok(gun.vehicleArt === 'flak88' && gun.x === pit.x && gun.z === pit.z && Math.hypot(gun.w, gun.d) / 2 <= pit.ring.r - 0.8, 'the gun in the pit');
  assert.ok(pit.z + pit.ring.r + 1 <= wire.points[0][1], 'pit short of the wire');
  const mouth = pit.rot + Math.PI, toAm = Math.atan2(am.z - pit.z, am.x - pit.x), dA = Math.abs(Math.atan2(Math.sin(toAm - mouth), Math.cos(toAm - mouth)));
  const dAm = Math.hypot(am.x - pit.x, am.z - pit.z);
  assert.ok(dA < 0.35 && dAm >= pit.ring.r + 1.2 && dAm <= pit.ring.r + 3, `ammo at the mouth (${dA.toFixed(2)} rad, ${dAm.toFixed(2)} m)`);
});

test('art m09 pass 2: the camp\'s worn ground is one decal on the map over the paving; no rut runs through a wall or a fence', () => {
  const A = M09_RUTS, m = buildCampRuts(A);
  assert.equal(m.name, 'kit:camp-ruts');
  assert.ok(!m.castShadow && m.receiveShadow && m.material.depthWrite === false && m.material.transparent, 'a decal, no shadow, no depth');
  assert.ok(A.y > LIFT && A.y < 0.1, `over the paving (${A.y})`);
  const { x0, x1, z0, z1 } = A.area;
  assert.ok(x0 >= 0 && z0 >= 0 && x1 <= m09.size[0] && z1 <= m09.size[1], 'inside the map');
  const pts = [...A.lanes, ...A.tracks].flatMap((t) => t.pts).concat(A.stains.map(([x, z]) => [x, z]));
  for (const p of pts) assert.ok(p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1, `mark ${p} outside the decal`);
  // walls and fences: every lane and track (its drawn curve) crosses them only through the gates and gaps
  const runs = m09.structures.filter((q) => (q.type === 'wall' || q.type === 'fence') && q.points).flatMap((q) => q.points.slice(1).map((b, i) => [q.points[i], b, q.id]));
  for (const t of [...A.lanes, ...A.tracks]) {
    const c = sampleTrack(t.pts, 0.5).map((p) => [p.x, p.z]);
    for (let i = 0; i + 1 < c.length; i++) for (const [a, b, id] of runs) assert.ok(!cross(c[i], c[i + 1], a, b), `${t.kind ?? 'lane'} ${t.pts[0]} crosses ${id}`);
  }
  assert.equal(typeof m09.script.visuals, 'function', 'built by the mission script\'s visuals');
});

test('art m09 pass 2: the draped decal covers every mark and rides the drawn ground (each vertex over the highest sand round it)', () => {
  // the covered cells hold every lane, rut and stain (worked out from the spec: the canvas is never read back)
  const cov = coverCells(M09_RUTS, 1), { x0, z0 } = M09_RUTS.area, at = (x, z) => cov.cell[Math.floor(z - z0) * cov.nx + Math.floor(x - x0)];
  for (const t of [...M09_RUTS.lanes, ...M09_RUTS.tracks]) for (const p of sampleTrack(t.pts, 0.5)) {
    const h = (t.gauge ?? 0) / 2 + (t.w ?? 0.4) / 2;
    for (const o of [-h, 0, h]) { const x = p.x - p.tz * o, z = p.z + p.tx * o; if (x > x0 && z > z0 && x < M09_RUTS.area.x1 && z < M09_RUTS.area.z1) assert.ok(at(x, z), `mark at ${x.toFixed(1)},${z.toFixed(1)} uncovered`); }
  }
  for (const [x, z] of M09_RUTS.stains) assert.ok(at(x, z), `stain ${x},${z}`);
  const share = cov.cell.reduce((n, c) => n + c, 0) / cov.cell.length;
  assert.ok(share < 0.4, `decal mesh over ${(100 * share).toFixed(0)} % of its area only`);
  // draped: a 3 × 3 block of covered cells over a mound, every vertex 7 cm over the highest ground within half a cell
  const cell = new Uint8Array(16); for (const k of [5, 6, 7, 9, 10, 11, 13, 14, 15]) cell[k] = 1;
  const bump = (x, z) => 0.4 * Math.exp(-((x - 2.2) ** 2 + (z - 2.1) ** 2) / 0.6);
  const g = drapedGeometry({ x0: 0, x1: 4, z0: 0, z1: 4 }, bump, { cell, nx: 4, nz: 4, step: 1 }, 0.07), P = g.attributes.position;
  assert.equal(g.index.count / 6, 9);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i);
    for (const [dx, dz] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) assert.ok(P.getY(i) >= bump(x + dx, z + dz) + 0.07 - 1e-6, `vertex ${x},${z}`);
  }
});

test('art m09 pass 2: the yellow drums are yellow (a saturated drum paint, not the pale tan of pass 1)', () => {
  const mats = glbJson(P('assets/models/buildings/desert/drum_dump_yellow_bq.glb')).materials.filter((q) => /^kit:paint_metal/.test(q.name));
  assert.ok(mats.length >= 3, `${mats.length} drum paints`);
  for (const q of mats) {
    const [r, g, b] = q.pbrMetallicRoughness.baseColorFactor;
    assert.ok(r > 0.65 && g / r > 0.5 && g / r < 0.75 && b / r < 0.05, `${q.name}: ${[r, g, b].map((v) => v.toFixed(3))}`); // (linear: a yellow, neither tan nor orange)
  }
});

test('art m09 pass 2: the NE house\'s annex is its own lean-to (roof falling away from the house), not the kit box', () => withLib(merged(), () => {
  const s = S9('house_ne_annex'), pk = pick(s), k = JSON.parse(readFileSync(P(`assets/models/${merged().assets[pk.name].sidecar}`)));
  assert.equal(pk.name, 'lean_to_mud_bq');
  assert.equal(s.nav, false);
  assert.ok(Math.abs(k.height - s.h) < 0.35, `height ${k.height} vs ${s.h}`);
  const ne = S9('house_ne');
  assert.ok(Math.abs(s.x - s.w / 2 - (ne.x + ne.w / 2)) < 0.3, 'against the house\'s E wall');
}));
