/** M9 art pass (Bab el Qattara, "A Courtesy Call"): the Bab el Qattara add-on, each structure's own build fitted to its
 *  footprint, the doors where the game enters, the octagon's mud-brick wall, the set dressing clear of the routes. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { doorPoint } from '../../src/world/map-builder.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';
import * as THREE from 'three';
import { fixPalmFrond } from '../../src/art/building-fixups.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const ADDON = 'manifest-bab-el-qattara';
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm09'); try { return await fn(); } finally { await useManifest(null); } };
const m09 = MISSIONS.find((m) => m.id === 'm09');
const OWN = ['tank_shed_open_bq', 'house_stone_bq_a', 'house_stone_bq_b', 'house_stone_store_bq', 'house_flat_white_bq', 'command_post_white_bq', 'hq_domed_terraced_bq',
  'comms_hut_antenna_bq', 'sandbag_bunker_thatch_bq', 'gantry_hoist_bq', 'drum_dump_yellow_bq', 'ammo_boxes_bq_a', 'ammo_boxes_bq_b'];
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
      const glb = readFileSync(P(`assets/models/${l.url}`)).toString('latin1');
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
  const glbMats = (f) => { const b = readFileSync(P(f)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()).materials; };
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
