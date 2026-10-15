/** M17 art pass (Before Dawn, Riveauvillé): the camp's brick-and-railing walls and iron gates, each building's own
 *  Alsatian / German build, the winch lorry as a vehicle, the carved gorge and its rolling bridge driven by the
 *  set-piece, the tower crane, the set dressing clear of every route, the paving and furniture visual only. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { buildIronGate } from '../../src/art/iron-gates.js';
import { buildTowerCrane } from '../../src/art/tower-crane.js';
import { buildM17Art, MB } from '../../src/missions/scripts/m17-art.js';
import { carveField } from '../../src/art/terrain/carve.js';
import { validateRoads, normalizeRoadNetwork } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm17'); try { return await fn(); } finally { await useManifest(null); } };
const m17 = MISSIONS.find((m) => m.id === 'm17');
const S = (id) => m17.structures.find((s) => s.id === id);
const DRESSING = ['car_hq', 'moto_hq', 'kubel_gate', 'drums_crane', 'logs_crane', 'cart_yard'];

test('art m17: the camp walls are low brick with an iron railing (never the log palisade the "stockade" name drew)', () => {
  const walls = m17.structures.filter((s) => s.type === 'wall' && /brick_railing/.test(s.variant));
  assert.ok(walls.length >= 6, 'camp walls');
  for (const w of walls) {
    const runs = w.segments || [w.points];
    const g = buildWall(runs[0], { variant: w.variant, mat: w.mat, h: w.h, width: w.width, id: w.id });
    assert.equal(g.name, 'dressing:wall:brick_railing', w.id);
  }
});

test('art m17: the back gate and the cage door are iron leaves, not a castle gatehouse fitted onto them', () => withLib(merged(), () => {
  for (const id of ['gate_back', 'pen_gate']) {
    const s = S(id);
    assert.equal(pickAsset(s.type, s, { theater: 'temperate', missionId: 'm17' }), null, id);
    const g = buildIronGate(s);
    assert.ok(g, id);
    const b = new THREE.Box3().setFromObject(g);
    assert.ok(b.max.x - b.min.x <= s.w + 0.1 && b.max.y <= (s.h ?? 2.6) + 0.1 && b.max.z - b.min.z < 0.4, `${id} leaves within the opening`);
  }
}));

test('art m17: every building takes a theater-correct library build (Alsatian half-timber, German plank huts)', () => withLib(merged(), () => {
  const want = { house_w: 'house_halftimber_b', hq_n: 'house_halftimber_d', hut_flag: 'hut_timber_barrack_c', hut_ne: 'hut_timber_barrack_b',
    hut_e: 'hut_timber_barrack_a', hut_s: 'hut_timber_barrack_b', barracks_se: 'house_halftimber_c', shed_w: 'shed_tarred_be', shed_ne: 'shed_tarred_be',
    pillbox: 'pillbox_round_be' };
  for (const [id, name] of Object.entries(want)) assert.equal(pickAsset(S(id).type, S(id), { theater: 'temperate', missionId: 'm17' })?.name, name, id);
  // nothing in M17 is drawn with a Norwegian log build, a bombed house or castle masonry
  for (const s of m17.structures.filter((q) => !q.points && !q.segments)) { // (wall / fence runs draw their own kit)
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm17' });
    if (pk) assert.doesNotMatch(pk.name, /log_cabin|house_timber_|barracks_[abc]$|house_bombed|castle_|mg_nest|bridge_lift/, s.id);
  }
  // the winch lorry carrying the bridge lever is the library Opel Blitz (it was a bombed brick house with roofs)
  assert.equal(S('truck_winch').vehicleArt, 'opel_blitz_cargo');
  assert.equal(pickAsset('ruins', S('truck_winch'), { theater: 'temperate', missionId: 'm17' }), null);
}));

test('art m17: the gorge is carved under the ravine cells, its boulder-rim kit retired; a stream and rocks dress it', () => {
  const g = S('gorge');
  assert.equal(g.carved, true);
  assert.equal(m17.carves.length, 1);
  assert.deepEqual(m17.carves[0].points, g.points);
  const f = carveField(m17.carves, { W: m17.size[0], D: m17.size[1] });
  assert.ok(f.at(15, 135) < -3.5, `bed ${f.at(15, 135).toFixed(2)} m`);
  assert.equal(f.at(15, 120), 0, 'the N bank stays at the walk height');
  assert.equal(f.at(18, 150), 0, 'the S bank stays at the walk height');
});

/** A minimal world: the deck and gorge structures as groups, the set-piece's state, a BEL tick list. */
function fakeWorld() {
  const structures = new Map([['mbridge_deck', { object3d: new THREE.Group() }], ['gorge', { object3d: new THREE.Group() }]]);
  structures.get('mbridge_deck').object3d.add(new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 5)));
  const sp = { extended: false, moving: 0, target: false, spec: { moveTime: 3 } }, ticks = [];
  return { structures, sp, ticks, setpieces: { get: (id) => (id === 'mbridge' ? sp : null) }, onBelTick: (fn) => ticks.push(fn) };
}

test('art m17: the rolling bridge replaces the placeholder slab; its span rides out over the gorge with the lever and back', () => {
  const w = fakeWorld(), deck = S('mbridge_deck');
  assert.ok(buildM17Art(w, deck, { carves: m17.carves, size: m17.size, poly: S('gorge').points }));
  const o = w.structures.get('mbridge_deck').object3d, span = o.getObjectByName('m17:mbridge:span');
  assert.ok(span && o.children.filter((c) => c.visible).every((c) => c.name === 'm17:mbridge'), 'only the rolling bridge shows');
  assert.equal(span.position.x, -MB.travel, 'retracted at the start (the set-piece starts retracted)');
  w.sp.moving = 1.5; w.sp.target = true; w.ticks.forEach((t) => t(0.05));
  assert.ok(span.position.x > -MB.travel && span.position.x < 0, 'half way out while it moves');
  w.sp.moving = 0; w.sp.extended = true; w.ticks.forEach((t) => t(0.05));
  assert.equal(span.position.x, 0);
  assert.equal(span.position.y, 0, 'down on the S landing');
  // the span spans the gorge once out: its S end beyond the S lip, its N end on the outrigger
  assert.ok(MB.sEnd > MB.sLip + 2 && MB.sEnd - MB.span < MB.tip, 'span laps both supports');
  // rocks on the bed, clear of the GB's climb at x 2.5 and of the bridge corridor
  const rocks = w.structures.get('gorge').object3d.getObjectByName('m17:gorge_rocks');
  assert.ok(rocks && rocks.children.length >= 1);
});

test('art m17: the tower crane has its jib, counter-jib and cab on a lattice mast of the gameplay height', () => {
  const c = buildTowerCrane(S('crane'));
  const b = new THREE.Box3().setFromObject(c);
  assert.ok(b.max.y > 13 && b.max.y < 17, `top ${b.max.y.toFixed(1)}`);
  assert.ok(b.max.x > 10 && b.min.x < -3, 'jib along +x, counter-jib behind');
});

test('art m17: the set dressing stays ≥ 3 m off every route, post, device and start; low cover only', () => {
  const segD = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz); };
  for (const id of DRESSING) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.equal(s.block, 1, `${id} low cover`);
    for (const e of m17.enemies) {
      assert.ok(Math.hypot(e.x - s.x, e.z - s.z) - r >= 3, `${id} vs ${e.id}`);
      const pts = e.route?.points || [];
      for (let i = 0; i + 1 < pts.length; i++) assert.ok(segD(s, pts[i], pts[i + 1]) - r >= 1.5, `${id} vs ${e.id}'s route`);
    }
    for (const it of [...m17.interactables, ...m17.commandos]) assert.ok(Math.hypot(it.x - s.x, it.z - s.z) - r >= 3, `${id} vs ${it.id ?? it.role}`);
    for (const sp of m17.setpieces) for (const q of [sp.lever?.at, sp.control?.at, sp.valve?.at].filter(Boolean)) assert.ok(Math.hypot(q[0] - s.x, q[1] - s.z) - r >= 3, `${id} vs ${sp.id}`);
  }
});

test('art m17: worn setts and furniture are visual only; signs and stones stand ≥ 1 m off the carriageways', () => {
  assert.deepEqual(validateRoads(m17), []);
  const net = normalizeRoadNetwork(m17);
  assert.ok(net.areas.length >= 2 && net.areas.every((a) => a.grid === false && a.surface === 'setts'));
  assert.ok(m17.furniture.length >= 7 && m17.furniture.every((f) => f.block === false), 'furniture never blocks the walk grid');
  const segD = ([px, pz], [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const roads = m17.terrain.filter((t) => t.type === 'path' && t.terrain === 'road')
    .map((r) => ({ ...r, points: r.points.map((q) => (Array.isArray(q) ? q : [q.x, q.z])) }));
  for (const f of m17.furniture) {
    const pts = f.points || [[f.x, f.z]];
    for (const p of pts) for (const r of roads) for (let i = 0; i + 1 < r.points.length; i++) {
      const d = segD(p, r.points[i], r.points[i + 1]);
      assert.ok(d >= r.width / 2 + 1, `${f.type} ${f.variant ?? ''} at (${p[0]}, ${p[1]}) is ${d.toFixed(2)} m from a road centreline`);
    }
  }
});
