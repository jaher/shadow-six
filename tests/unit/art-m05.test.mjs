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
    g1_hq: 'log_cabin_a', g3_barracks: 'barracks_b', logs_h4: 'log_pile_stack', stabbur: 'stabbur_no', lower_station: 'cable_station_lower', top_station: 'cable_station_upper', radar: 'radar_dish_a' };
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

// ---------------------------------------------------------------- art pass 2 (art/m05-dressing.js)
const P2_GROUND = ['stabbur', 'well_v'];
const P2_SUMMIT = ['windsock_top', 'rock_top_1', 'rock_top_2', 'rock_top_3'];
/** Distance from a point to a structure's rotated w × d footprint, or its round one (`r`) (0 inside). */
const rectD = (s, px, pz) => {
  if (s.w == null) return Math.max(0, Math.hypot(px - s.x, pz - s.z) - s.r);
  const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0), dx = px - s.x, dz = pz - s.z;
  const u = dx * c + dz * n, v = -dx * n + dz * c;
  return Math.hypot(Math.max(0, Math.abs(u) - s.w / 2), Math.max(0, Math.abs(v) - s.d / 2));
};
/** A footprint's outline: its rect, or a 16-gon round a round one. */
const outline = (s) => (s.w != null ? rectPoly(s.x, s.z, s.w, s.d, s.rot || 0)
  : Array.from({ length: 16 }, (_, k) => [s.x + s.r * Math.cos((k / 16) * 2 * Math.PI), s.z + s.r * Math.sin((k / 16) * 2 * Math.PI)]));
/** Every beat, the barracks squads' exit routes and loops and the patrols' alarm loops, as point lists (an alarm's run to
 *  its loop starts wherever the man is on his beat: no fixed line). */
const routeLines = () => {
  const out = [];
  for (const e of m05.enemies) {
    out.push([{ x: e.x, z: e.z }, ...(e.route?.points || [])]);
    if (e.alarmRoute) out.push([...e.alarmRoute.loop.points, e.alarmRoute.loop.points[0]]);
  }
  for (const b of Object.values(m05.barracks)) for (const sq of b.squads) out.push(sq.exitRoute, [...sq.loop, sq.loop[0]]);
  return out;
};
const lineD = (s, pts) => {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.2));
    for (let k = 0; k <= n; k++) d = Math.min(d, rectD(s, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n));
  }
  return d;
};

test('art m05 pass 2: the stabbur, the village well, the windsock and the summit outcrops stand ≥ 3 m off every beat, alarm route, post and start, clear of trees and buildings', () => {
  const lines = routeLines(), pts = [...m05.enemies, ...m05.commandos, ...m05.interactables];
  const trees = m05.structures.filter((q) => q.type === 'pine');
  for (const id of [...P2_GROUND, ...P2_SUMMIT]) {
    const s = S(id);
    assert.ok(s && s.fixed, `${id} placed (fixed: authored on a rule-clean spot)`);
    for (const l of lines) assert.ok(lineD(s, l) >= 3, `${id} ${lineD(s, l).toFixed(2)} m off a route`);
    for (const q of pts) assert.ok(rectD(s, q.x, q.z) >= 3, `${id} vs ${q.id ?? q.role}`);
    for (const t of trees) assert.ok(rectD(s, t.x, t.z) >= 1.5, `${id} vs ${t.id}`);
    for (const o of m05.structures) {
      if (o === s || o.type === 'pine' || o.type === 'cliff' || o.w == null || o.d == null) continue;
      const A = outline(s), B = rectPoly(o.x, o.z, o.w, o.d, o.rot || 0);
      const gap = Math.min(...A.map(([x, z]) => polyDist(x, z, B)), ...B.map(([x, z]) => polyDist(x, z, A)));
      assert.ok(gap >= 1, `${id} ↔ ${o.id} ${gap.toFixed(2)} m`);
    }
  }
  assert.equal(S('stabbur').asset, 'stabbur_no');
  assert.equal(S('well_v').type, 'well');
  assert.equal(S('well_v').block, 1, 'the well ring is low cover, as drawn');
  assert.equal(S('windsock_top').vehicleArt, 'windsock');
});

test('art m05 pass 2: the summit pieces stand on the plateau and are cut out of its walkways (nobody walks through them); the ground pieces off the drop and the massif', () => {
  const summit = S('summit'), strips = summit.walkways;
  const covered = (x, z) => strips.some((w) => Math.abs(w.points[0][1] - z) <= w.width / 2 && x >= w.points[0][0] && x <= w.points[1][0]);
  for (const id of P2_SUMMIT) {
    const s = S(id);
    assert.ok(inPoly(s.x, s.z, summit.points), `${id} on the plateau`);
    // every 0.5 m grid cell whose centre lies inside the footprint keeps the plateau's block (no strip raises it)
    const r = Math.hypot(s.w, s.d) / 2;
    let cells = 0;
    for (let cz = Math.floor((s.z - r) / 0.5) * 0.5 + 0.25; cz <= s.z + r; cz += 0.5) {
      for (let cx = Math.floor((s.x - r) / 0.5) * 0.5 + 0.25; cx <= s.x + r; cx += 0.5) {
        if (rectD(s, cx, cz) > 0) continue;
        cells++;
        assert.ok(!covered(cx, cz), `${id}: walkway over cell (${cx}, ${cz})`);
      }
    }
    assert.ok(cells >= 1, `${id} covers ${cells} cells`);
  }
  for (const id of P2_GROUND) for (const poly of ['summit', 'massif', 'valley_rim']) assert.ok(!inPoly(S(id).x, S(id).z, S(poly).points), `${id} in ${poly}`);
});

test('art m05 pass 2: the SE bunker stands bare: its snow twin\'s net on poles hidden (hideMats) with the snow lying on it, the roof\'s own snow kept', async () => {
  const { GLTFLoader } = await import('../../src/engine/glb-gzip.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const { readGlbArrayBuffer } = await import('../../tools/glb-io.mjs');
  const { hideAssetMats } = await import('../../src/art/building-props.js');
  const rx = new RegExp(S('g2_bunker').hideMats);
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'notex', loadTexture: () => Promise.resolve(new THREE.Texture()) })); // geometry only
  const g = await new Promise((res, rej) => L.parse(readGlbArrayBuffer(P('assets/models/buildings/military/bunker_snow.glb')), '', res, rej));
  const root = new THREE.Group(); g.scene.name = 'lod0'; root.add(g.scene); root.updateMatrixWorld(true);
  // snow triangles (sidecar frame) on the roof's W half (no net over it) and over the net's span, higher than the roof slab
  const count = () => {
    const v = new THREE.Vector3(), c = new THREE.Vector3(), n = { roofW: 0, onNet: 0, netMeshes: 0 };
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const name = [].concat(o.material)[0].name;
      if (rx.test(name)) n.netMeshes++;
      if (!/^kit:snow/.test(name)) return;
      const p = o.geometry.attributes.position, idx = o.geometry.index, m = idx ? idx.count : p.count;
      for (let t = 0; t < m; t += 3) {
        c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(p, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld));
        c.multiplyScalar(1 / 3);
        if (c.x > -4.5 && c.x < -0.5 && c.z > -3.3 && c.z < 3.9 && c.y > 2.7 && c.y < 3.3) n.roofW++;
        if (c.x > 0.6 && c.x < 5.8 && c.z > -4.8 && c.z < 2.5 && c.y > 3.3) n.onNet++;
      }
    });
    return n;
  };
  const before = count();
  assert.ok(before.netMeshes >= 5 && before.onNet > 500, `the twin draws its net (${before.netMeshes} meshes, ${before.onNet} snow tris on it)`);
  assert.ok(hideAssetMats(root, rx) >= 5);
  const after = count();
  assert.equal(after.netMeshes, 0, 'net and poles hidden');
  assert.equal(after.onNet, 0, 'no snow left hanging where the net was');
  assert.equal(after.roofW, before.roofW, 'the roof keeps its snow');
});

/** The bunker_snow GLB's LOD0 (geometry only: no textures, the materials keep their names and their AO map slot). */
const loadBunkerSnow = async () => {
  const { GLTFLoader } = await import('../../src/engine/glb-gzip.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const { readGlbArrayBuffer } = await import('../../tools/glb-io.mjs');
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'notex', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const g = await new Promise((res, rej) => L.parse(readGlbArrayBuffer(P('assets/models/buildings/military/bunker_snow.glb')), '', res, rej));
  const root = new THREE.Group(); g.scene.name = 'lod0'; root.add(g.scene); root.updateMatrixWorld(true);
  return root;
};

test('art m05 pass 2b: the SE bunker\'s east side reads as part of the snowy bunker: the berm keeps its own snow where the net\'s goes, the AO baked with the net is switched off (M5 only)', async () => {
  const { hideAssetMats, dropAssetAo } = await import('../../src/art/building-props.js');
  const g2 = S('g2_bunker');
  assert.match(g2.keepSnowOn, /mud/, 'the berm keeps its snow');
  assert.match(g2.dropAo, /snow/); assert.match(g2.dropAo, /mud/); assert.match(g2.dropAo, /slab/);
  assert.doesNotMatch(g2.dropAo, /formwork/, 'the walls keep their baked AO (their darkness is the model\'s own)');
  // M5 only: no other structure of any mission takes the options (M3's dam bunker keeps its net and its baked AO) —
  // but M20's château, whose porch steps' baked AO drew black, drops the AO of its dressed-stone trim (art2/m20)
  for (const m of MISSIONS) for (const s of m.structures || []) {
    if (m.id === 'm05' && s.id === 'g2_bunker') continue;
    const ownAo = m.id === 'm20' && s.id === 'hq' && s.dropAo === 'kit:limestone_smooth';
    // (and M4's floating landing stage leaves the jetty model's granite shore abutment off: art2/m04)
    const ownHide = m.id === 'm04' && s.id === 'pier_float' && s.hideMats === 'fieldstone_grey|granite';
    assert.ok((s.hideMats === undefined || ownHide) && s.keepSnowOn === undefined && (s.dropAo === undefined || ownAo), `${m.id}/${s.id} takes the net / AO options`);
  }
  const rx = new RegExp(g2.hideMats), keepOn = new RegExp(g2.keepSnowOn);
  // snow triangles (sidecar frame, centroids) lying on the berm's earth: within 0.25 m over the earth under them; hanging on the net's old skirt: over 0.45 m
  const rays = (root) => {
    const mud = [], v = new THREE.Vector3();
    root.traverse((o) => { if (!o.isMesh || !/^kit:mud/.test([].concat(o.material)[0].name)) return;
      const p = o.geometry.attributes.position, idx = o.geometry.index;
      for (let t = 0; t + 2 < (idx ? idx.count : p.count); t += 3) mud.push([0, 1, 2].map((k) => v.fromBufferAttribute(p, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld).clone()));
    });
    const top = (x, z) => {
      let best = null;
      for (const [a, b, c] of mud) {
        const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d, l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * a.y + l2 * b.y + l3 * c.y;
        if (best === null || y > best) best = y;
      }
      return best;
    };
    const n = { lying: 0, hanging: 0, onNet: 0 }, c = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || !/^kit:snow/.test([].concat(o.material)[0].name)) return;
      const p = o.geometry.attributes.position, idx = o.geometry.index;
      for (let t = 0; t + 2 < (idx ? idx.count : p.count); t += 3) {
        c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(p, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld));
        c.multiplyScalar(1 / 3);
        if (c.x > 0.6 && c.x < 5.8 && c.z > -4.8 && c.z < 2.5 && c.y > 3.3) n.onNet++;
        if (!(c.x > 5.0 && c.x < 6.8 && c.z > -5.4 && c.z < 2.4)) continue; // the east berm under the net's skirt (past the roof slab's own snow edge, x 4.8)
        const h = top(c.x, c.z);
        if (h === null) continue;
        if (c.y - h < 0.25) n.lying++; else if (c.y - h > 0.45) n.hanging++;
      }
    });
    return n;
  };
  const strip = await loadBunkerSnow(); hideAssetMats(strip, rx); const without = rays(strip);
  const keep = await loadBunkerSnow(); hideAssetMats(keep, rx, keepOn); const withKeep = rays(keep);
  assert.ok(withKeep.lying >= without.lying + 60, `the berm's own snow comes back (${without.lying} → ${withKeep.lying} triangles lying on the earth)`);
  assert.equal(withKeep.hanging, 0, 'none of the net\'s snow hangs over the berm');
  assert.equal(withKeep.onNet, 0, 'no snow left hanging where the net was');
  // the spared snow is drawn by a twin mesh that is no nav / clipping geometry: what the nav analyses and the clip audit
  // measure (every mesh not marked userData.clip = false) is exactly what the plain strip leaves
  const measured = (root) => {
    const sig = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      for (let q = o; q; q = q.parent) if (q.userData?.clip === false) return;
      sig.push(`${[].concat(o.material)[0].name}:${(o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count)}`);
    });
    return sig.sort().join(' ');
  };
  assert.equal(measured(keep), measured(strip), 'the nav / clip-audit view of the bunker is the same with the berm snow spared');
  let twins = 0; keep.traverse((o) => { if (o.isMesh && o.userData.clip === false && /^kit:snow/.test([].concat(o.material)[0].name)) { twins++; assert.ok(o.userData.drapeStripped, 'a second pass (a late LOD attach) leaves the twin alone'); } });
  assert.equal(twins, 1, 'one twin for the snow mesh');
  hideAssetMats(keep, rx, keepOn); assert.equal(rays(keep).lying, withKeep.lying, 'a second pass changes nothing');
  // the options never reach the library's shared materials: the building's own copies lose the AO map, the others keep it
  const lib = await loadBunkerSnow();
  const shared = new Map(); lib.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) shared.set(m, m.aoMapIntensity); });
  const rd = new RegExp(g2.dropAo);
  assert.ok(dropAssetAo(lib, rd) >= 3, 'snow, earth and roof slab meshes switched');
  for (const [m, was] of shared) assert.equal(m.aoMapIntensity, was, `${m.name}: the shared material is left alone`);
  lib.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m.aoMap) continue;
      if (rd.test(m.name)) { assert.equal(m.aoMapIntensity, 0, `${m.name} AO off`); assert.ok(!shared.has(m), `${m.name} is the building's own copy`); }
      else assert.equal(m.aoMapIntensity, 1, `${m.name} keeps its baked AO`);
    }
  });
  assert.equal(dropAssetAo(lib, rd), 0, 'idempotent (every LOD attach runs it again)');
});

test('art m05 pass 2b: dropAssetAo copies a material once per building, keeps its textures and its shader hooks (anti-tiling), leaves the original', async () => {
  const { dropAssetAo } = await import('../../src/art/building-props.js');
  const ao = new THREE.Texture(), map = new THREE.Texture();
  const snow = new THREE.MeshStandardMaterial({ name: 'kit:snow', map, aoMap: ao });
  snow.onBeforeCompile = () => {}; snow.customProgramCacheKey = () => 'at:iso';
  const wall = new THREE.MeshStandardMaterial({ name: 'kit:concrete_formwork~e5e5e0', map, aoMap: ao });
  const bare = new THREE.MeshStandardMaterial({ name: 'kit:snow_bare' }); // (no AO map: nothing to switch)
  const geo = new THREE.BufferGeometry();
  const root = new THREE.Group();
  const a = new THREE.Mesh(geo, snow), b = new THREE.Mesh(geo, [wall, snow]), c = new THREE.Mesh(geo, wall), d = new THREE.Mesh(geo, bare);
  root.add(a, b, c, d);
  assert.equal(dropAssetAo(root, /^kit:snow/), 2, 'the two meshes drawn in the snow');
  const copy = a.material;
  assert.notEqual(copy, snow, 'a copy, not the library material');
  assert.equal(copy.aoMapIntensity, 0);
  assert.equal(copy.aoMap, ao, 'the AO texture stays on the copy (the same program: no new shader)');
  assert.equal(copy.map, map, 'textures shared');
  assert.equal(copy.name, 'kit:snow');
  assert.equal(copy.onBeforeCompile, snow.onBeforeCompile, 'anti-tiling\'s shader patch kept');
  assert.equal(copy.customProgramCacheKey(), 'at:iso', 'and its program key');
  assert.equal(b.material[1], copy, 'one copy per source material');
  assert.equal(b.material[0], wall, 'a multi-material mesh keeps the others');
  assert.equal(c.material, wall); assert.equal(d.material, bare);
  assert.equal(snow.aoMapIntensity, 1, 'the library material is untouched');
  assert.equal(dropAssetAo(root, /^kit:snow/), 0, 'run twice: nothing left to switch');
});
