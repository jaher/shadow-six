/** M7 art pass (Chase of the Wolves, Arendal): Norwegian timber barracks and village houses (no brick terrace), the
 *  ruins field's bombed brick houses with their drawn walls as the gameplay walls, a Quonset hangar, a naust; the
 *  library Type VIIC on both hulls with its tower over the gameplay tower block and the torpedo stack kept; fishing
 *  cutters and faerings instead of boxes; the slipway's timber gantry and the village compounds drawn by
 *  scripts/m07-art.js inside their footprints; set dressing clear of every route, post and start; furniture visual only. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale, assetExtents, artFillOf } from '../../src/art/building-props.js';
import { buildingMeta } from '../../src/art/building-library.js';
import { structureDoorPoint } from '../../src/entities/interactables.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildGantry } from '../../src/missions/scripts/m07-art.js';
import { UBOATS, hullPoint } from '../../src/missions/scripts/m07.js';
import { ART } from '../../src/missions/m07_chase_of_the_wolves.js';
import { rectPoly } from '../../src/world/placement-geom.js';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { fitOnFootprint } from '../../src/art/static-vehicles.js';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { B } from '../../src/world/grid.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm07'); try { return await fn(); } finally { await useManifest(null); } };
const m07 = MISSIONS.find((m) => m.id === 'm07');
const S = (id) => m07.structures.find((s) => s.id === id);
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const pick = (s) => pickAsset(s.type, s, { theater: 'snow', missionId: 'm07' })?.name ?? null;

test('art m07: Norwegian timber barracks, houses and naust, a Quonset hangar; no brick terrace or MG nest', () => withLib(merged(), () => {
  const want = { hangar_nw: 'nissen_hut', hut_gate: 'log_cabin_b_snow', barr_dock: 'barracks_c_snow', barr_mid: 'barracks_b_snow',
    house_mid: 'barracks_c_snow', boathouse: 'naust_a_snow', h_1: 'house_timber_b_snow', h_2: 'house_timber_a_snow', h_3: 'house_timber_b_snow',
    h_5: 'house_timber_c_snow', h_6: 'fishing_shed_a_snow', crates_1: 'dock_cargo_a' };
  for (const [id, name] of Object.entries(want)) assert.equal(pick(S(id)), name, id);
  // drawn by scripts/m07-art.js (no library pick at all: nothing loads for them)
  for (const id of ['h_big', 'h_4', 'racks_e', 'gantry_post_1', 'gantry_post_4']) assert.equal(pick(S(id)), null, id);
  for (const s of m07.structures.filter((q) => !q.points)) {
    const n = pick(s);
    if (n) assert.doesNotMatch(n, s.type === 'ruins' ? /^townhouse_|^mg_nest|^barn_|_de$/ : /^townhouse_|^house_bombed_|^mg_nest|^barn_|_de$/, s.id);
  }
}));

test('art m07: the U-boats are the library Type VIIC trimmed to the walk deck; each tower block sits on the model tower', () => {
  for (const id of ['uboat_1', 'uboat_2']) {
    const s = S(id), t = S(`${id}_tower`), b = UBOATS[id];
    assert.equal(s.vehicleArt, 'uboat_viic');
    assert.ok(s.vehicleArtY < -0.9 && s.vehicleArtY > -1.3, 'casing deck (1.4 m above the waterline) at the pier deck');
    assert.equal(t.visual, false, 'the tower is drawn by the model');
    const c = hullPoint(b, s.vehicleArtX - 0.5);
    assert.ok(Math.hypot(t.x - c.x, t.z - c.z) < 0.05 && t.w >= 9, `${id} tower over the model's fairing`);
    // the torpedo stack (6.2 m) stays on the model's after deck (casing to 29 m aft of the model's middle, then the taper)
    assert.ok(b.torpX - 3.1 - s.vehicleArtX >= -29 && b.torpX + 3.1 - s.vehicleArtX <= -8, `${id} stack on the after deck`);
  }
});

test('art m07: moored cutters and beached faerings (oars shipped, every third keel-up) in place of boxes', () => {
  const moored = m07.structures.filter((s) => /^boat_m/.test(s.id)), beached = m07.structures.filter((s) => /^boat_b/.test(s.id));
  assert.equal(moored.length, 15); assert.equal(beached.length, 14);
  for (const s of moored) { assert.equal(s.vehicleArt, 'fishing_boat'); assert.equal(s.vehicleArtFit, 1); }
  for (const s of beached) { assert.equal(s.vehicleArt, 'rowboat'); assert.deepEqual(s.vehicleArtHide, ['oar_l', 'oar_r']); }
  assert.equal(beached.filter((s) => /overturned/.test(s.variant)).length, 5);
  assert.ok(Math.abs(fitOnFootprint([12, 4], [9, 3], 1) - 0.75) < 1e-9, 'a 12 m cutter onto its 9 m footprint');
  assert.equal(fitOnFootprint([10, 3], [9, 3]), 1, 'the default fit still lets a model overhang 15 %');
});

test('art m07: the gantry stands on its four posts', () => {
  const G = ART.gantry, g = buildGantry(G), c = Math.cos(G.rot * Math.PI / 180), s = Math.sin(G.rot * Math.PI / 180);
  for (const id of G.posts) {
    const p = S(id), lx = (p.x - G.x) * c + (p.z - G.z) * s, lz = -(p.x - G.x) * s + (p.z - G.z) * c;
    assert.ok(Math.abs(Math.abs(lx) - G.span / 2) < 0.05 && Math.abs(Math.abs(lz) - G.gap / 2) < 0.05, `${id} at ${lx.toFixed(2)},${lz.toFixed(2)}`);
  }
  const gb = new THREE.Box3().setFromObject(g);
  assert.ok(gb.max.y > G.h && gb.max.y < G.h + 1.5 && gb.min.y > -0.1, `gantry ${gb.min.y.toFixed(2)}..${gb.max.y.toFixed(2)}`); // pads bedded 5 cm
});

const RUINS = ['ruin_1', 'ruin_2', 'ruin_3', 'ruin_4', 'ruin_5', 'ruin_6'];
test('art m07: the ruins are the bombed brick houses again, their gameplay walls the drawn walls (B.HIGH shell to the drawn top, breach and rubble B.LOW)', () => withLib(merged(), () => {
  for (const id of RUINS) assert.equal(pick(S(id)), 'house_bombed_b', id);
  const s = S('ruin_1'), pk = pickAsset('ruins', s, { theater: 'snow', missionId: 'm07' }), meta = buildingMeta(pk.name), ext = assetExtents(pk.name);
  const ew = pk.turn ? ext.d : ext.w, ed = pk.turn ? ext.w : ext.d;
  const hs = meta.doors.filter((d) => d.kind !== 'gate' && d.height < 3.2).map((d) => d.height);
  const f = fitScale(s.w / ew, s.d / ed, hs.length ? Math.max(...hs) : 0);
  // the sidecar's parts in the ruin's frame, placed the way libraryVisual places the model (centred on its body, turn, fit)
  const box = (pts) => {
    const q = pts.map(([px, pz]) => { let x = px - ext.cx, z = pz - ext.cz; if (pk.turn) [x, z] = [-z, x]; return [x * f.sx, z * f.sz]; });
    const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const shell = box(meta.footprints.filter((fp) => fp.kind === 'wall').flatMap((fp) => fp.points));
  const outside = meta.footprints.filter((fp) => fp.block && fp.kind !== 'stairs').map((fp) => ({ fp, b: box(fp.points) }))
    .filter(({ b }) => !(b.x0 >= shell.x0 + 0.3 && b.x1 <= shell.x1 - 0.3 && b.z0 >= shell.z0 + 0.3 && b.z1 <= shell.z1 - 0.3)); // inner walls: inside the closed shell
  const want = { HIGH: 2, LOW: 1 };
  for (const { fp, b } of outside) {
    const m = s.navParts.find((p) => Math.abs(p.x - (b.x0 + b.x1) / 2) < 0.02 && Math.abs(p.z - (b.z0 + b.z1) / 2) < 0.02
      && Math.abs(p.w - (b.x1 - b.x0)) < 0.02 && Math.abs(p.d - (b.z1 - b.z0)) < 0.02);
    assert.ok(m, `${fp.kind} ${JSON.stringify(b)} is a nav part`);
    assert.equal(m.block, want[fp.block] ?? fp.block, fp.kind);
  }
  // and the fallen storeys fill the shell's inside (between the walls' inner faces)
  const inner = { x0: Math.max(...outside.filter(({ fp, b }) => fp.kind === 'wall' && b.x1 < 0).map(({ b }) => b.x1)) };
  const fill = s.navParts.filter((p) => p.x === 0 && p.z === 0 && p.block === 1);
  assert.equal(fill.length, 1, 'one fill inside the shell');
  assert.ok(Math.abs(-fill[0].w / 2 - inner.x0) < 0.02, `fill ${fill[0].w} vs inner face ${inner.x0}`);
  assert.equal(s.navParts.indexOf(fill[0]), 0, 'stamped first (the walls over it)');
  assert.equal(s.navParts.length, outside.length + 1, 'every other nav part is a part of the model');
  assert.ok(s.navParts.findIndex((p) => p.block === 2) > s.navParts.findLastIndex((p) => p.block === 1), 'the low parts are stamped before the walls');
  assert.equal(s.nav, false, 'no sidecar floors, ladders or climbs: the same ruins in every build');
  assert.ok(s.h >= meta.bbox.max[1] * f.sy - 0.3, `walls ${s.h} m vs drawn ${(meta.bbox.max[1] * f.sy).toFixed(2)} m`);
  for (const id of RUINS) assert.deepEqual(S(id).navParts, s.navParts, id);
}));

test('art m07: in the grid each ruin is its drawn shell (walls B.HIGH, breach and rubble B.LOW, a closed inside)', () => {
  const { grid } = loadGrid(m07);
  for (const id of RUINS) {
    const r = S(id), c = Math.cos(r.rot), s = Math.sin(r.rot), at = (dx, dz) => grid.blockAt(r.x + dx * c - dz * s, r.z + dx * s + dz * c);
    assert.equal(at(-3.76, 0), B.HIGH, `${id} W wall`); assert.equal(at(0, -2.68), B.HIGH, `${id} N wall`);
    assert.equal(at(2.6, 2.68), B.LOW, `${id} breach`); assert.equal(at(2.2, 4), B.LOW, `${id} S rubble`);
    assert.ok(!grid.walkableAt(r.x - 1, r.z) && at(-1, 0) === B.LOW, `${id}: the inside is the fallen storeys`);
    assert.equal(at(3.85, 2.68), B.HIGH, `${id}: the stub E of the breach stays a wall`);
  }
});

test('art m07: compound parts lie inside their parent footprint', () => {
  for (const [id, parts] of Object.entries(ART.parts)) {
    const p = S(id), [x0, z0, x1, z1] = [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2];
    for (const q of parts) {
      for (const [x, z] of rectPoly(q.x, q.z, q.w, q.d, q.rot * Math.PI / 180)) {
        assert.ok(x >= x0 - 0.05 && x <= x1 + 0.05 && z >= z0 - 0.05 && z <= z1 + 0.05, `${id}/${q.asset} corner ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual([...new Set(Object.values(ART.parts).flat().map((q) => q.asset))].sort(), [...m07.artAssets].sort());
});

test('art m07: the set dressing stays ≥ 1.5 m off every route and ≥ 3 m off every post, start, item and vehicle; furniture never blocks', () => {
  const ids = ['kubel_hg', 'blitz_hg', 'drums_hg', 'cart_hg', 'logs_hut', 'logs_bd', 'moto_bm', 'drums_dk', 'cargo_cr', 'logs_h5', 'crates_bh'];
  const segs = [];
  for (const e of m07.enemies) { const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || [])]; for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]); }
  for (const b of Object.values(m07.barracks || {})) for (const sq of b.squads || []) for (const r of [sq.exitRoute, sq.loop]) if (r) for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]);
  for (const id of ids) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.ok(s.block <= 1 && s.fixed, `${id} low cover, authored`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route`);
    for (const q of [...m07.enemies, ...m07.commandos, ...(m07.interactables || []), ...(m07.vehicles || [])]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m07.furniture.length >= 8 && m07.furniture.every((f) => f.block === false));
});

/**
 * Model (x, z) → world (x, z), placed the way building-props libraryVisual places the asset: centred on its body,
 * `artTurn` / the aspect turn, fitScale (of the `artFill` share), `artMirror`, then rot + `artRot` (three.js
 * rotation.y = −angle) and `artOffset`.
 */
const modelPlacer = (name, q, turn) => {
  const meta = buildingMeta(name), ext = assetExtents(name);
  const ew = turn ? ext.d : ext.w, ed = turn ? ext.w : ext.d;
  const hs = meta.doors.filter((d) => d.kind !== 'gate' && d.height < 3.2).map((d) => d.height);
  const [fx, fz] = artFillOf(q);
  const { sx, sz } = fitScale(q.w * fx / ew, q.d * fz / ed, hs.length ? Math.max(...hs) : 0);
  const rotY = (x, z, t) => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
  return (px, pz) => {
    let [x, z] = rotY(px - ext.cx, pz - ext.cz, -turn * Math.PI / 2);
    x *= q.artMirror === 'x' ? -sx : sx; z *= q.artMirror === 'z' ? -sz : sz;
    [x, z] = rotY(x, z, -((q.rot ?? 0) + (q.artRot ?? 0)));
    return [q.x + (q.artOffset?.[0] ?? 0) + x, q.z + (q.artOffset?.[1] ?? 0) + z];
  };
};
/** The model's doors in world (x, z). */
const modelDoors = (name, q, turn) => {
  const at = modelPlacer(name, q, turn);
  return buildingMeta(name).doors.filter((d) => d.kind !== 'gate').map((d) => { const [x, z] = at(d.pos[0], d.pos[2]); return { id: d.id, x, z }; });
};
/** Which face of an axis-aligned w × d footprint a point is nearest (N/S/E/W). */
const faceOf = (s, x, z) => {
  const e = [['W', Math.abs(x - (s.x - s.w / 2))], ['E', Math.abs(x - (s.x + s.w / 2))], ['N', Math.abs(z - (s.z - s.d / 2))], ['S', Math.abs(z - (s.z + s.d / 2))]];
  return e.sort((a, b) => a[1] - b[1])[0][0];
};

test('art m07: every hideout and garrison door the game uses is a door of the model, on the same face (≤ 2.5 m)', () => withLib(merged(), () => {
  const checked = [], bad = [];
  for (const s of m07.structures.filter((q) => (q.enterable || q.garrison) && !q.points)) {
    assert.ok(!s.rot, `${s.id}: axis-aligned footprint`);
    const [gx, gz] = structureDoorPoint(s, 0.8), want = faceOf(s, gx, gz);
    let doors, pk = null;
    if (ART.parts[s.id]) {
      doors = ART.parts[s.id].flatMap((q) => modelDoors(q.asset, { ...q, rot: q.rot * Math.PI / 180, artMirror: q.mirror, artFill: q.fill }, pickAsset(q.type ?? 'house', q, { theater: 'snow', missionId: 'm07' }).turn));
    } else {
      pk = pickAsset(s.type, s, { theater: 'snow', missionId: 'm07' });
      if (!pk) continue;
      doors = modelDoors(pk.name, s, s.artTurn ?? pk.turn);
    }
    const near = doors.filter((d) => faceOf(s, d.x, d.z) === want).map((d) => ({ ...d, dist: Math.hypot(d.x - gx, d.z - gz) })).sort((a, b) => a.dist - b.dist)[0];
    if (!(near && near.dist <= 2.5)) bad.push(`${s.id} [${pk?.name ?? 'parts'}]: door ${gx.toFixed(1)},${gz.toFixed(1)} (${want} face) — model doors ${doors.map((d) => `${d.id}@${d.x.toFixed(1)},${d.z.toFixed(1)}/${faceOf(s, d.x, d.z)}`).join(' ')}`);
    checked.push(s.id);
  }
  assert.ok(!bad.length, bad.join(' || '));
  for (const id of ['barr_dock', 'barr_mid', 'hut_gate', 'house_mid', 'h_big', 'h_1', 'h_2', 'h_3', 'h_4', 'h_5', 'h_6']) assert.ok(checked.includes(id), `${id} checked`);
}));

test('art m07: the T pier head no longer lies over the U-boat sterns; its root is re-decked and both torpedo stacks lie off the pier', () => withLib(merged(), () => {
  const pier = S('pier'), pk = pickAsset('pier', pier, { theater: 'snow', missionId: 'm07' }), meta = buildingMeta(pk.name);
  const head = meta.footprints.filter((f) => f.kind === 'bridge_deck').map((f) => f.points).find((pts) => Math.max(...pts.map((q) => Math.abs(q[1]))) > 3);
  assert.ok(head, 'the library pier has a T head');
  const hx0 = Math.min(...head.map((q) => q[0])), hx1 = Math.max(...head.map((q) => q[0])), hz = Math.max(...head.map((q) => Math.abs(q[1])));
  const deckZ = Math.max(...meta.bridge.deck.map((q) => Math.abs(q[1])));
  // both wings cut (pad 0, every point of the head beyond the deck's width inside one box)
  for (const sgn of [1, -1]) {
    assert.ok(pier.hideParts.some(({ box: [x0, z0, x1, z1], pad }) => pad === 0 && x0 <= hx0 && x1 >= hx1 && Math.min(z0 * sgn, z1 * sgn) > deckZ
      && Math.min(z0 * sgn, z1 * sgn) < deckZ + 0.5 && Math.max(z0 * sgn, z1 * sgn) >= hz), `wing ${sgn}`);
  }
  // the visual spans the pier from the asset's −x end (fitted on its walk deck): the root deck covers the head's length
  const xs = meta.bridge.deck.map((q) => q[0]), dx0 = Math.min(...xs), dx1 = Math.max(...xs), sx = Math.min(1.8, pier.w / (dx1 - dx0));
  const at = (x) => (x - (dx0 + dx1) / 2) * sx;
  const R = ART.pierRoot;
  assert.equal(R.id, 'pier');
  assert.ok(Math.abs(R.from - at(hx0)) < 0.2 && R.to >= at(hx1) && R.to < at(hx1) + 1, `root deck ${R.from}..${R.to} vs head ${at(hx0).toFixed(2)}..${at(hx1).toFixed(2)}`);
  // the torpedo stacks (charge markers) lie off the pier visual (half its deck width + 1 m)
  const half = Math.min(1.8, pier.d / (2 * deckZ)) * deckZ;
  for (const id of ['uboat_1', 'uboat_2']) {
    const b = UBOATS[id], c = Math.cos(pier.rot), s = Math.sin(pier.rot);
    for (const lx of [b.torpX - 3.1, b.torpX, b.torpX + 3.1]) {
      const p = hullPoint(b, lx), across = Math.abs(-(p.x - pier.x) * s + (p.z - pier.z) * c);
      assert.ok(across > half + 1, `${id} stack at ${lx}: ${across.toFixed(2)} m off the pier axis`);
    }
  }
}));

/** Plan cells (0.25 m) of an asset's LOD0 geometry above `y` m (its roofs and upper storeys), model frame. */
const LOADER = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
LOADER.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
async function upperPoints(m, name, y) {
  const url = m.assets[name].lods[0].url;
  const gltf = await new Promise((res, rej) => LOADER.parse(readGlbArrayBuffer(P(`assets/models/${url}`)), '', res, rej));
  gltf.scene.updateMatrixWorld(true);
  const out = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      if (Math.max(a.y, b.y, c.y) < y) continue;
      const N = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), a.distanceTo(c)) / 0.25));
      for (let u = 0; u <= N; u++) for (let v = 0; u + v <= N; v++) {
        q.copy(a).multiplyScalar(1 - (u + v) / N).addScaledVector(b, u / N).addScaledVector(c, v / N);
        if (q.y >= y) out.push([q.x, q.z]);
      }
    }
  });
  return out;
}

test('art m07: the village breathes — no two houses\' roofs (their geometry above 2.6 m) within 1.2 m; the drawn houses keep to their footprints', () => withLib(merged(), async () => {
  const m = merged(), CELL = 0.25, houses = [];
  for (const s of m07.structures.filter((q) => /^(h_\d|h_big|barr_vil|boathouse)$/.test(q.id ?? ''))) {
    const parts = ART.parts[s.id]?.map((q) => ({ name: q.asset, q: { ...q, rot: q.rot * Math.PI / 180, artMirror: q.mirror, artFill: q.fill }, turn: pickAsset(q.type ?? 'house', q, { theater: 'snow', missionId: 'm07' }).turn }))
      ?? [(() => { const pk = pickAsset(s.type, s, { theater: 'snow', missionId: 'm07' }); return { name: pk.name, q: s, turn: s.artTurn ?? pk.turn }; })()];
    for (const [k, r] of parts.entries()) {
      const at = modelPlacer(r.name, r.q, r.turn), cells = new Set();
      for (const [x, z] of await upperPoints(m, r.name, 2.6)) { const [wx, wz] = at(x, z); cells.add(`${Math.floor(wx / CELL)},${Math.floor(wz / CELL)}`); }
      houses.push({ id: `${s.id}${parts.length > 1 ? '/' + k : ''}`, parent: s.id, cells, s });
    }
  }
  assert.ok(houses.length >= 12, `${houses.length} houses`);
  const R = Math.ceil(1.2 / CELL), near = [];
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) {
    const A = houses[i], Bh = houses[j];
    if (A.parent === Bh.parent) continue;
    let hit = false;
    for (const key of A.cells) {
      const [ci, cj] = key.split(',').map(Number);
      for (let di = -R; di <= R && !hit; di++) for (let dj = -R; dj <= R; dj++) if (di * di + dj * dj <= R * R && Bh.cells.has(`${ci + di},${cj + dj}`)) { hit = true; break; }
      if (hit) break;
    }
    if (hit) near.push(`${A.id} ↔ ${Bh.id}`);
  }
  assert.deepEqual(near, [], 'roofs within 1.2 m');
  // (the roofs stay over their own footprints: none reaches more than 2 m past it)
  for (const h of houses.filter((q) => !q.s.rot)) {
    const s = h.s, [x0, x1, z0, z1] = [s.x - s.w / 2 - 2, s.x + s.w / 2 + 2, s.z - s.d / 2 - 2, s.z + s.d / 2 + 2];
    const out = [...h.cells].map((k) => k.split(',').map((v) => (+v + 0.5) * CELL)).filter(([x, z]) => x < x0 || x > x1 || z < z0 || z > z1);
    assert.equal(out.length, 0, `${h.id}: roof ${out[0]} past its footprint + 2 m`);
  }
}));
