/** M5 art pass (Blind Justice, Herdla): one-storey Norwegian log cabins in the village (no squeezed two-storey
 *  clapboard houses), tarred sheds, the open woodshed, field tents and a plank privy; the massif as a sloped granite
 *  face that never steps onto the field; the valley drop carved deep and wooded far below (visual only); set dressing
 *  clear of every route, post and start; furniture visual only. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { massifFace, faceProfile, resample, rimLip } from '../../src/missions/scripts/m05-art.js';
import { carveField, carvePainter } from '../../src/art/terrain/carve.js';
import { PALETTES } from '../../src/art/terrain/terrain-layers.js';
import { rectPoly, polyDist } from '../../src/world/placement-geom.js';
import { buildGenerator } from '../../src/art/dressing.js';
import { ART } from '../../src/missions/m05_blind_justice.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm05'); try { return await fn(); } finally { await useManifest(null); } };
const m05 = MISSIONS.find((m) => m.id === 'm05');
const S = (id) => m05.structures.find((s) => s.id === id);
const inPoly = (x, z, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};

test('art m05: the village draws Norwegian log cabins, tarred sheds, the open woodshed, ridge tents; the privy is its own', () => withLib(merged(), () => {
  const want = { h1: 'log_cabin_b', h3: 'log_cabin_b', h4: 'log_cabin_b', h5: 'log_cabin_b', h6: 'log_cabin_b', h5_wing: 'log_cabin_a',
    h1_annex: 'shed_tarred_be', radar_hut: 'shed_tarred_be', woodshed: 'lean_to_canopy', tent_1: 'tent_ridge_field', tent_6: 'tent_ridge_field',
    g1_hq: 'log_cabin_b', g3_barracks: 'barracks_b', lower_station: 'cable_station_lower', top_station: 'cable_station_upper', radar: 'radar_dish_a' };
  for (const [id, name] of Object.entries(want)) assert.equal(pickAsset(S(id).type, S(id), { theater: 'snow', missionId: 'm05' })?.name, name, id);
  assert.equal(pickAsset('hut', S('outhouse'), { theater: 'snow', missionId: 'm05' }), null, 'the privy is drawn by scripts/m05-art.js');
  for (const s of m05.structures.filter((q) => !q.points)) {
    const pk = pickAsset(s.type, s, { theater: 'snow', missionId: 'm05' });
    if (pk) assert.doesNotMatch(pk.name, /^house_timber_|guard_hut_|_de$|^house_half/, s.id);
  }
}));

test('art m05: the massif face stands on its foot line, tops out on the rim and never steps onto the field', () => {
  const g = massifFace(ART.rim, ART.foot, { h: 16, gully: ART.gully }).geometry, p = g.getAttribute('position');
  const massif = S('massif').points;
  let foot = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    assert.ok(y >= -0.01 && y <= 16.05, `y ${y.toFixed(2)}`);
    if (x > 106.9) continue; // the face carried on past the E map edge
    const dFoot = Math.min(...ART.foot.slice(1).map((b, k) => segD(x, z, ART.foot[k], b)));
    if (y < 0.01) { foot++; assert.ok(dFoot < 0.05, `foot vertex ${x.toFixed(2)},${z.toFixed(2)} off the foot line`); }
    else assert.ok(inPoly(x, z, massif) || dFoot < 0.05 || Math.min(...ART.rim.slice(1).map((b, k) => segD(x, z, ART.rim[k], b))) < 0.05, `vertex ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} outside the massif`);
  }
  assert.ok(foot > 100, 'foot row');
  // concave profile: under the straight foot → rim line, so the Green Beret's climb runs outside the rock
  for (let u = 0; u <= 1.0001; u += 0.02) assert.ok(faceProfile(u) <= u + 0.03, `profile ${u.toFixed(2)}`);
  assert.equal(resample([[0, 0], [10, 0]], 4).length, 5);
});

test('art m05: the valley drop is carved deep, its rim and the rim rock stay at the walk height; its wood is visual', () => {
  const f = carveField(m05.carves, { W: m05.size[0], D: m05.size[1] });
  assert.ok(f.at(47, 10) < -10, `floor ${f.at(47, 10).toFixed(2)}`);
  assert.equal(f.at(30, 30), 0, 'the village stays level');
  assert.ok(f.at(36, 16) > -0.6, 'the rim rock is spared');
  const valley = S('valley_rim').points;
  for (const c of m05.carves) for (const [x, z] of c.points) assert.ok(inPoly(x, z, valley) || valley.some(([a, b]) => Math.hypot(a - x, b - z) < 0.01) || z === 0 || x === 60, `carve vertex ${x},${z}`);
  for (const w of m05.vegetation.woods) for (const [x, z] of w.points) assert.ok(inPoly(x, z, valley), `wood vertex ${x},${z}`);
  // the plateau as drawn covers the gameplay plateau and reaches past the N and E edges
  const pl = S('summit').points;
  for (const [x, z] of pl) assert.ok(inPoly(x - 0.01 * Math.sign(x - 80), z + 0.01, ART.plateau) || ART.plateau.some(([a, b]) => a === x && b === z), `plateau ${x},${z}`);
  assert.ok(Math.min(...ART.plateau.map((q) => q[1])) < -20 && Math.max(...ART.plateau.map((q) => q[0])) > 125);
});

test('art m05: the set dressing stays ≥ 1.5 m off every route and ≥ 3 m off every post and start; furniture never blocks', () => {
  const ids = ['logs_h1', 'cart_h1', 'logs_h3', 'logs_h4b', 'logs_h5', 'cart_h6', 'logs_h8', 'moto_hq', 'gen_radar', 'crates_top', 'logs_barr'];
  const segs = [];
  for (const e of m05.enemies) { const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || [])]; for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]); }
  for (const b of Object.values(m05.barracks)) for (const sq of b.squads) for (const r of [sq.exitRoute, sq.loop]) for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]);
  for (const id of ids) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.ok(s.block <= 1, `${id} low cover at most`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route`);
    for (const q of [...m05.enemies, ...m05.commandos, ...m05.interactables]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m05.furniture.length >= 8 && m05.furniture.every((f) => f.block === false));
});

test('art m05: the privy stands clear of h3 (no join, ≥ 1 m past its eaves), square to the cabin', () => {
  const o = S('outhouse'), h = S('h3');
  assert.ok(!(o.clipAllow || []).includes('h3') && !(h.clipAllow || []).includes('outhouse'), 'no join');
  const A = rectPoly(o.x, o.z, o.w, o.d, o.rot), B = rectPoly(h.x, h.z, h.w, h.d, h.rot);
  const gap = Math.min(...A.map(([x, z]) => polyDist(x, z, B)), ...B.map(([x, z]) => polyDist(x, z, A)));
  assert.ok(gap >= 0.6 + 1.0, `privy ↔ h3 footprint gap ${gap.toFixed(2)} m (eaves 0.6 + 1 m)`);
  assert.ok(Math.abs(((o.rot - h.rot) % (Math.PI / 2))) < 1e-6, 'aligned');
  assert.equal(o.chimney, false, 'no fx brick stack on the plank privy');
});

test('art m05: the valley rim shows a rock lip and rock banks; every lip block lies inside the carve', () => {
  const v = m05.carves[0], f = carveField(m05.carves, { W: m05.size[0], D: m05.size[1] });
  const lip = rimLip(ART.valley.lip, v.points, f.at, { avoid: ART.valley.avoid });
  assert.ok(ART.valley.avoid.some(([x, z]) => Math.hypot(x - 48.7, z - 25.6) < 0.1), 'the rim grove pine on the rim (rim_grove_7) is avoided');
  assert.ok(lip.children.length > 60, `${lip.children.length} blocks`);
  for (const b of lip.children) {
    assert.ok(inPoly(b.position.x, b.position.z, S('valley_rim').points), `block ${b.position.x.toFixed(1)},${b.position.z.toFixed(1)}`);
    for (const [x, z] of ART.valley.avoid) assert.ok(Math.hypot(x - b.position.x, z - b.position.z) > 0.8, `block on the trunk at ${x},${z}`);
  }
  const layers = PALETTES.snow.layers, paint = carvePainter(f, layers);
  assert.ok(paint, 'the snow palette paints the carve');
  const w = layers.map((_, k) => (k ? 0 : 1)); paint(42, 19.5, w); // on the bank below the lip
  assert.ok(w[layers.indexOf('rock')] > 0.5, `rock on the bank ${w.map((q) => q.toFixed(2))}`);
});

test('art m05: the radar generator is a detailed field genset, not a plinth and a box', () => {
  assert.match(S('gen_radar').variant, /genset/);
  const g = buildGenerator(S('gen_radar')); let tris = 0;
  g.traverse((q) => { if (q.isMesh) tris += (q.geometry.index ? q.geometry.index.count : q.geometry.getAttribute('position').count) / 3; });
  assert.ok(tris > 400, `${tris} tris`);
});

test('art m05: the snow log cabins lose their grass tufts (no dark spikes through the roof snow), keep the turf slab', async () => {
  const { GLTFLoader } = await import('../../src/engine/glb-gzip.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const { readGlbArrayBuffer } = await import('../../tools/glb-io.mjs');
  const { dropTurfTufts } = await import('../../src/art/building-fixups.js');
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'notex', loadTexture: () => Promise.resolve(new THREE.Texture()) })); // geometry only
  const g = await new Promise((res, rej) => L.parse(readGlbArrayBuffer(P('assets/models/buildings/norway/log_cabin_b_snow.glb')), '', res, rej));
  g.scene.updateMatrixWorld(true);
  let turf = null;
  g.scene.traverse((o) => { if (o.isMesh && /turf_grass/.test(o.material.name)) turf = o; });
  assert.ok(turf, 'turf primitive');
  const before = turf.geometry.index.count, n = dropTurfTufts(turf.geometry, turf.matrixWorld.getMaxScaleOnAxis());
  assert.ok(n > 300, `${n} tufts dropped`);
  const after = turf.geometry.index.count / 3;
  assert.ok(after > 1500 && after < before / 3, `slab kept: ${after} of ${before / 3} tris`);
});
