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
import { buildM17Art, MB, resurfaceApproaches } from '../../src/missions/scripts/m17-art.js';
import { buildVineyard, vineRowZ, VINE } from '../../src/art/vineyard.js';
import { buildBeetClamp, buildPloughedField, fieldShape } from '../../src/art/field-clamp.js';
import { buildStoresPile } from '../../src/art/stores-pile.js';
import { M17_FIELD, FIELD_W } from '../../src/art/m17-dressing.js';
import { carveField } from '../../src/art/terrain/carve.js';
import { validateRoads, normalizeRoadNetwork } from '../../src/world/roads.js';
import { MISSIONS, getMission } from '../../src/missions/index.js';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { B } from '../../src/world/grid.js';

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

// ---------------------------------------------------------------- art pass 2
const segD2 = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz); };
/** Distance from (x, z) to a structure's w × d rect in the world: 0 inside it. */
const rectDist = (s, x, z) => {
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0), dx = x - s.x, dz = z - s.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c + dz * n) - s.w / 2), Math.max(0, Math.abs(-dx * n + dz * c) - s.d / 2));
};
/** Distance from segment ab to the rect: 0 where it crosses it (sampled every 0.1 m). */
const segRectDist = (s, a, b) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1)); let m = Infinity;
  for (let i = 0; i <= n; i++) m = Math.min(m, rectDist(s, a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n));
  return m;
};
/** Spots the M17 solution work leans on (sol/m17's stashes, holds and lures on the N bank and by the camp). */
const SOL_SPOTS = [[64.5, 20.5], [52, 33], [55, 31], [35, 36.6], [38, 35], [9.5, 15.5], [62.5, 62.2], [54, 63], [85, 100.5], [72.5, 161], [60.5, 123.3]];

test('art m17 pass 2: the vineyard and the beet clamp stand ≥ 6 m off every beat, post and squad run, the start, and every solution spot lies outside them, ≥ 2.5 m clear', () => {
  const runs = [...m17.enemies.map((e) => ({ id: e.id, pts: [{ x: e.x, z: e.z }, ...(e.route?.points || [])] }))];
  for (const [b, def] of Object.entries(m17.barracks)) for (const sq of def.squads) runs.push({ id: b, pts: [...sq.exitRoute, ...sq.loop] });
  for (const id of ['vineyard_n', 'clamp_s']) {
    const s = S(id);
    assert.equal(s.fixed, true, id);
    for (const r of runs) {
      const pts = r.pts.map((q) => (Array.isArray(q) ? { x: q[0], z: q[1] } : q));
      for (let i = 0; i < pts.length; i++) {
        const d = segRectDist(s, pts[i], pts[Math.min(pts.length - 1, i + 1)]);
        assert.ok(d >= 6, `${id} vs ${r.id}: ${d.toFixed(2)} m`);
      }
    }
    for (const c of m17.commandos) assert.ok(rectDist(s, c.x, c.z) >= 8, `${id} vs ${c.id ?? c.role}`);
    // (a point inside the footprint is 0 m from it: the rim alone let the e22 lure spots (52, 33) and (55, 31) sit in the rows)
    for (const [x, z] of SOL_SPOTS) {
      const d = rectDist(s, x, z);
      assert.ok(d >= 2.5, `${id}: the solution's spot (${x}, ${z}) ${d === 0 ? 'lies inside it' : `is only ${d.toFixed(2)} m off it`}`);
    }
  }
  assert.equal(rectDist(S('vineyard_n'), 63, 32), 0, 'rectDist is 0 inside');
});

test('art m17 pass 2: on the built walk grid the solution spots by the vineyard and the clamp stand on open ground (no block, no navBlock within 1 m)', () => {
  const def = normalizeMission(getMission('m17'), { quiet: true });
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def, seed: def.seed ?? 7 });
  buildMap(world, def, { meshes: false });
  const g = world.grid, near = SOL_SPOTS.filter(([x, z]) => ['vineyard_n', 'clamp_s'].some((id) => rectDist(S(id), x, z) < 12));
  assert.ok(near.length >= 3, 'the e22 lure, its aside and the Patrol 26 hold by the vineyard');
  for (const [x, z] of near) {
    const i0 = Math.floor(x / g.cell), j0 = Math.floor(z / g.cell), r = Math.ceil(1 / g.cell);
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      const k = g.idx(i, j);
      assert.ok(g.block[k] === B.NONE && !g.navBlock[k], `(${x}, ${z}): cell (${i}, ${j}) block ${g.block[k]} navBlock ${g.navBlock[k]}`);
    }
  }
  // the rows do stop feet where they stand
  const v = S('vineyard_n'), k = g.idx(Math.floor(v.x / g.cell), Math.floor((v.z + v.navParts[0].z) / g.cell));
  assert.ok(g.block[k] === B.FENCE || g.navBlock[k], 'a vine row blocks');
});

test('art m17 pass 2: the vineyard is drawn as trellis rows and each row stops feet (B.FENCE) where it is drawn', () => {
  const s = S('vineyard_n');
  assert.equal(s.navParts.length, s.rows);
  assert.ok(s.navParts.every((q, k) => q.block === 3 && Math.abs(q.z - vineRowZ(k, s.rows)) < 1e-9 && q.w === s.w), 'one fence part per row');
  const g = buildVineyard(s), b = new THREE.Box3().setFromObject(g);
  assert.ok(b.max.x - b.min.x <= s.w + 2.6 && b.max.z - b.min.z <= s.d, 'within its block (anchor pegs 1 m past the end posts)');
  assert.ok(b.max.y >= VINE.h && b.max.y < VINE.h + 0.5, `trellis height ${b.max.y.toFixed(2)}`);
  const stakes = g.getObjectByName('vineyard:stakes'), pos = stakes.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) assert.ok(s.navParts.some((q) => Math.abs(pos.getZ(i) - q.z) < 0.25), 'every stake on a row');
  // the field's rail fence stays 2 m N of the first row; the rows clear tree_5 by ≥ 2 m
  assert.ok(s.z - s.d / 2 >= 27.4, 'off the field fence');
  const t = S('tree_5');
  assert.ok(Math.hypot(Math.max(0, Math.abs(t.x - s.x) - s.w / 2), Math.max(0, Math.abs(t.z - s.z) - s.d / 2)) >= 2, 'clear of tree_5');
});

test('art m17 pass 2: the beet clamp fills its low footprint, earthed over with the field\'s soil', () => {
  const s = S('clamp_s'), g = buildBeetClamp(s), b = new THREE.Box3().setFromObject(g);
  assert.equal(s.block, 1);
  assert.ok(b.max.y <= s.h + 0.6 && b.max.y >= s.h, `crest ${b.max.y.toFixed(2)} (straw wisps above)`);
  assert.ok(b.max.z - b.min.z <= s.d + 0.1 && b.max.x - b.min.x <= s.w + 0.6, 'within its footprint (a few beets at the loading end)');
  const soil = g.getObjectByName('beet_clamp:soil');
  assert.ok(soil.material.name === 'beet_clamp:soil' && !/sand/.test(soil.material.name), 'the mud set, not the rippled sand');
  // uv v runs over the mound by its profile's length (z + y stood still up the S flank: the texture streaked down it)
  const uv = soil.geometry.attributes.uv, pos = soil.geometry.attributes.position, NV = 16, mid = 24 * (NV + 1);
  for (let j = 1; j <= NV; j++) {
    const k = mid + j, dl = Math.hypot(pos.getY(k) - pos.getY(k - 1), pos.getZ(k) - pos.getZ(k - 1));
    assert.ok(Math.abs((uv.getY(k) - uv.getY(k - 1)) * 2.4 - dl) < 1e-4, 'arc-length v');
  }
});

test('art m17 pass 2: the ploughed field is one soft-edged soil mesh on the drawn ground: low ridges along the field, no stepped edge', () => {
  const ground = (x, z) => 0.15 * Math.sin(x * 0.3) + 0.1 * Math.cos(z * 0.2);
  const m = buildPloughedField(M17_FIELD, ground), geo = m.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const sh = fieldShape(M17_FIELD), H = M17_FIELD.height;
  assert.equal(col.itemSize, 4, 'vertex alpha');
  assert.ok(m.material.transparent && !m.material.depthWrite && m.material.vertexColors && m.material.polygonOffset, 'a blended decal');
  assert.ok(pos.count > 5000 && geo.index.count / 3 < 40000, `${geo.index.count / 3} triangles`);
  // its two sides run along the furrows: the ridges never end on them (no staircase); its two ends cross them
  const ends = sh.edges.filter((e) => e.end), sides = sh.edges.filter((e) => !e.end);
  assert.equal(ends.length, 2); assert.equal(sides.length, 2);
  for (const e of sides) assert.ok(Math.abs(e.ex * Math.sin(M17_FIELD.dir) - e.ez * Math.cos(M17_FIELD.dir)) < Math.sin((0.5 * Math.PI) / 180), 'a side along the furrows');
  let ridged = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), lift = pos.getY(i) - ground(x, z), a = col.getW(i);
    assert.ok(lift >= 0.005 && lift <= 0.02 + H * 1.25 + 0.01, `(${x.toFixed(1)}, ${z.toFixed(1)}) ${lift.toFixed(3)} m over the ground`);
    if (a < 0.5) assert.ok(lift < 0.02 + 0.25 * H, `(${x.toFixed(1)}, ${z.toFixed(1)}): a ridge where the soil fades (alpha ${a.toFixed(2)})`);
    if (lift > 0.02 + 0.6 * H) ridged++;
    if (a > 0.01) assert.ok(sh.at(x, z).soil > -0.7, 'soil only inside its outline');
  }
  assert.ok(ridged > 1500, `ridge crests ${ridged}`);
  // the soil fades out over ≥ 0.4 m everywhere: no edge of it is a line
  const idx = geo.index.array;
  for (let t = 0; t < idx.length; t += 3) for (const [p, q] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
    assert.ok(Math.abs(col.getW(p) - col.getW(q)) < 0.35, 'a soft margin');
  }
  // tree_12 stands in the grass at its W side, pole_3 off its SW corner: no soil ridge at either
  for (const id of ['tree_12', 'pole_3']) { const q = S(id), f = sh.at(q.x, q.z); assert.ok(f.quad < 0 && Math.min(f.soil, f.quad + 0.4) < 0.5, `${id} outside the ploughing`); }
  // the field's bare earth under it (no grass through the soil) is its own quad
  assert.deepEqual(m17.terrain.filter((q) => q.terrain === 'ground' && q.points === FIELD_W).length, 1);
});

test('art m17 pass 2: the stores and the firewood keep the footprints the plank cubes had; the stores are drawn as stores', () => {
  const want = { crates_u: [3, 3, 1.5], crates_w: [4, 2, 1.2], crates_n1: [2, 2, 1.1], crates_n2: [2, 2, 1.1] };
  for (const [id, [w, d, h]] of Object.entries(want)) { const s = S(id); assert.deepEqual([s.w, s.d, s.h, s.block], [w, d, h, 1], id); }
  assert.equal(S('crates_w').asset, 'log_pile_stack');
  for (const id of ['crates_u', 'crates_n1', 'crates_n2']) {
    const s = S(id), g = buildStoresPile(s), b = new THREE.Box3().setFromObject(g);
    assert.equal(s.variant, 'stores_pile', id);
    assert.ok(b.max.x - b.min.x <= s.w + 0.05 && b.max.z - b.min.z <= s.d + 0.05 && b.max.y <= s.h + 0.05, `${id} within its w × d × h`);
    assert.ok(b.max.y >= s.h * 0.6, `${id} stacked`);
  }
});

test('art m17 pass 2: the Kommandantur setts lie at its front door, off the tree; the S fence clears the telegraph poles', () => {
  const pave = m17.pavements.find((q) => q.id === 'pave_hq').points;
  const inside = (x, z) => { let c = false; for (let i = 0, j = pave.length - 1; i < pave.length; j = i++) { const [xi, zi] = pave[i], [xj, zj] = pave[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  assert.ok(inside(27.7, 44.7), 'the front door (27.14, 44.14) opens onto the setts');
  assert.ok(inside(31.4, 44.1), 'the HQ spur ends on them');
  const t = S('tree_6'); assert.ok(!inside(t.x, t.z), 'not under tree_6');
  const poles = m17.structures.filter((q) => q.type === 'telegraph_pole');
  for (const f of m17.furniture.filter((q) => q.type === 'fence')) for (let i = 0; i + 1 < f.points.length; i++) {
    const a = { x: f.points[i][0], z: f.points[i][1] }, b = { x: f.points[i + 1][0], z: f.points[i + 1][1] };
    // ≥ 2 m: from the game camera a 1.2 m rail shows ~1.4 m N of where it stands, so nearer it still crosses a pole's foot
    for (const p of poles) assert.ok(segD2(p, a, b) >= (Math.abs(a.z - b.z) < 1 && Math.abs(p.z - a.z) < 3 ? 2 : 0.5), `fence through ${p.id}`);
  }
});

test('art m17 pass 2: the road bridge approach ramps get their own world-mapped copy and the beaten-earth finish', () => {
  const geo = new THREE.BoxGeometry(4, 0.5, 4), mat = new THREE.MeshStandardMaterial(); mat.name = 'kit:gravel';
  const ramp = new THREE.Mesh(geo, mat), deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 4), new THREE.MeshStandardMaterial({ name: 'kit:timber_grey' }));
  const root = new THREE.Group(); root.add(ramp, deck); ramp.position.set(30, 0, 80);
  const w = { structures: new Map([['bridge_road', { object3d: root }]]) };
  assert.equal(resurfaceApproaches(w, 'bridge_road'), 1);
  assert.equal(ramp.material.name, 'm17:bridge_approach');
  assert.notEqual(ramp.geometry, geo, 'the shared library geometry is left alone');
  assert.equal(deck.material.name, 'kit:timber_grey');
  const uv = ramp.geometry.attributes.uv;
  assert.ok(Math.abs(uv.getX(0) * 2.2 - (30 + geo.attributes.position.getX(0))) < 1e-4, 'u = world x / 2.2 m');
  assert.equal(resurfaceApproaches(w, 'bridge_road'), 0, 'idempotent');
});
