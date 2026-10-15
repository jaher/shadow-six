/** M7 art pass (Chase of the Wolves, Arendal): Norwegian timber barracks and village houses (no brick terrace or brick
 *  ruin), a Quonset hangar, a naust; the library Type VIIC on both hulls with its tower over the gameplay tower block and
 *  the torpedo stack kept; fishing cutters and faerings instead of boxes; the slipway's timber gantry, burnt frames and
 *  the village compounds drawn by scripts/m07-art.js inside their footprints; set dressing clear of every route, post
 *  and start; furniture visual only. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale, assetExtents } from '../../src/art/building-props.js';
import { buildingMeta } from '../../src/art/building-library.js';
import { structureDoorPoint } from '../../src/entities/interactables.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildGantry, burntRuin } from '../../src/missions/scripts/m07-art.js';
import { UBOATS, hullPoint } from '../../src/missions/scripts/m07.js';
import { ART } from '../../src/missions/m07_chase_of_the_wolves.js';
import { rectPoly } from '../../src/world/placement-geom.js';
import { fitOnFootprint } from '../../src/art/static-vehicles.js';
import { MISSIONS } from '../../src/missions/index.js';

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

test('art m07: Norwegian timber barracks, houses and naust, a Quonset hangar; no brick terrace, brick ruin or MG nest', () => withLib(merged(), () => {
  const want = { hangar_nw: 'nissen_hut', hut_gate: 'log_cabin_b_snow', barr_dock: 'barracks_c_snow', barr_mid: 'barracks_b_snow',
    house_mid: 'barracks_c_snow', boathouse: 'naust_a_snow', h_1: 'house_timber_b_snow', h_2: 'house_timber_a_snow', h_3: 'house_timber_b_snow',
    h_5: 'house_timber_c_snow', h_6: 'fishing_shed_a_snow', crates_1: 'dock_cargo_a' };
  for (const [id, name] of Object.entries(want)) assert.equal(pick(S(id)), name, id);
  // drawn by scripts/m07-art.js (no library pick at all: nothing loads for them)
  for (const id of ['h_big', 'h_4', 'racks_e', 'ruin_1', 'ruin_6', 'gantry_post_1', 'gantry_post_4']) assert.equal(pick(S(id)), null, id);
  for (const s of m07.structures.filter((q) => !q.points)) {
    const n = pick(s);
    if (n) assert.doesNotMatch(n, /^townhouse_|^house_bombed_|^mg_nest|^barn_|_de$/, s.id);
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

test('art m07: the gantry stands on its four posts; burnt frames stay inside their ruin footprints', () => {
  const G = ART.gantry, g = buildGantry(G), c = Math.cos(G.rot * Math.PI / 180), s = Math.sin(G.rot * Math.PI / 180);
  for (const id of G.posts) {
    const p = S(id), lx = (p.x - G.x) * c + (p.z - G.z) * s, lz = -(p.x - G.x) * s + (p.z - G.z) * c;
    assert.ok(Math.abs(Math.abs(lx) - G.span / 2) < 0.05 && Math.abs(Math.abs(lz) - G.gap / 2) < 0.05, `${id} at ${lx.toFixed(2)},${lz.toFixed(2)}`);
  }
  const gb = new THREE.Box3().setFromObject(g);
  assert.ok(gb.max.y > G.h && gb.max.y < G.h + 1.5 && gb.min.y > -0.1, `gantry ${gb.min.y.toFixed(2)}..${gb.max.y.toFixed(2)}`); // pads bedded 5 cm
  for (const id of ART.ruins) {
    const d = S(id), b = new THREE.Box3().setFromObject(burntRuin(d));
    assert.ok(b.min.x >= -d.w / 2 - 0.3 && b.max.x <= d.w / 2 + 0.3 && b.min.z >= -d.d / 2 - 0.3 && b.max.z <= d.d / 2 + 0.3, `${id} plan ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}`);
    assert.ok(b.max.y <= d.h + 1.6 && b.min.y > -0.3, `${id} height ${b.max.y.toFixed(2)}`);
    assert.equal(d.block, 1, 'see-through low cover');
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
  const ids = ['kubel_hg', 'blitz_hg', 'drums_hg', 'cart_hg', 'logs_hut', 'logs_bd', 'moto_bm', 'drums_dk', 'cargo_cr', 'logs_h2', 'logs_h3', 'logs_h5', 'cart_h1', 'crates_bh'];
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
 * The model's doors in world (x, z), placed the way building-props libraryVisual places the asset: centred on its body,
 * `artTurn` / the aspect turn, fitScale, `artMirror`, then rot + `artRot` (three.js rotation.y = −angle).
 */
const modelDoors = (name, q, turn) => {
  const meta = buildingMeta(name), ext = assetExtents(name);
  const ew = turn ? ext.d : ext.w, ed = turn ? ext.w : ext.d;
  const hs = meta.doors.filter((d) => d.kind !== 'gate' && d.height < 3.2).map((d) => d.height);
  const { sx, sz } = fitScale(q.w / ew, q.d / ed, hs.length ? Math.max(...hs) : 0);
  const rotY = (x, z, t) => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
  return meta.doors.filter((d) => d.kind !== 'gate').map((d) => {
    let [x, z] = rotY(d.pos[0] - ext.cx, d.pos[2] - ext.cz, -turn * Math.PI / 2);
    x *= q.artMirror === 'x' ? -sx : sx; z *= q.artMirror === 'z' ? -sz : sz;
    [x, z] = rotY(x, z, -((q.rot ?? 0) + (q.artRot ?? 0)));
    return { id: d.id, x: q.x + x, z: q.z + z };
  });
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
      doors = ART.parts[s.id].flatMap((q) => modelDoors(q.asset, { ...q, rot: q.rot * Math.PI / 180, artMirror: q.mirror }, pickAsset(q.type ?? 'house', q, { theater: 'snow', missionId: 'm07' }).turn));
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
