/**
 * Step 3p pavement: road network normalization (schema fields + legacy terrain roads), spline sampling, the spatial
 * index (surface / zone / raise queries), grid painting, the terrain painter, and the pavement mesh builder.
 */
import { test, assert } from './lib.mjs';
import { normalizeRoadNetwork, sampleCenterline, RoadIndex, SURFACES, THEATER_ROAD, paintRoadGrid, pretrampleRoads, terrainPainter, validateRoads } from '../../src/world/roads.js';
import { buildPavement } from '../../src/art/pavement/index.js';
import { NavGrid, T, terrainCode } from '../../src/world/grid.js';
import { normalizeMission } from '../../src/missions/schema.js';

const street = { surface: 'setts', points: [[0, 20], [30, 20], [40, 30]], width: 7, sidewalk: true, kerb: { paint: 'blackout' }, rails: { tracks: 2 }, markings: 'dashed', craters: [[15, 20, 2]] };
const MISSION = { id: 't3p', theater: 'temperate', size: [80, 60],
  terrain: [{ type: 'path', terrain: 'road', points: [[0, 5], [60, 5]], width: 4 }],
  roads: [street, { surface: 'mud', points: [[0, 50], [70, 50]], width: 3 }],
  pavements: [{ surface: 'quay', x: 50, z: 10, w: 20, d: 10, raise: 0.4, quay: { edges: [0] } }, { surface: 'concrete', x: 0, z: 30, w: 20, d: 12 }],
  furniture: [{ type: 'lamp', variant: 'paris_single', x: 10, z: 25 }] };

test('3p network: legacy road + roads + pavements + furniture normalize', () => {
  const net = normalizeRoadNetwork(MISSION);
  assert.equal(net.roads.length, 3);
  assert.equal(net.roads[0].legacy, true);
  assert.equal(net.roads[0].surface, THEATER_ROAD.temperate);
  assert.equal(net.roads[1].kerb.h, 0.14);
  assert.equal(net.roads[1].sidewalk.surface, 'flags');
  assert.equal(net.roads[1].rails.gauge, 1.435);
  assert.equal(net.areas[0].quay.bollards, 12);
  assert.equal(net.furniture[0].id, 'furn0');
  assert.equal(normalizeRoadNetwork({ theater: 'snow', terrain: MISSION.terrain }).roads[0].surface, 'snow_packed');
  assert.ok(validateRoads({ roads: [{ surface: 'marble', points: [[0, 0]] }] }).length === 2);
  const n = normalizeMission(MISSION);
  assert.equal(n.roads.length, 2); assert.equal(n.pavements.length, 2); assert.equal(n.furniture.length, 1);
  assert.deepEqual(normalizeMission({ id: 'x', size: [10, 10] }).roads, []);
});

test('3p spline: centripetal Catmull-Rom passes through the control points with unit tangents', () => {
  const s = sampleCenterline([[0, 0], [10, 0], [20, 10]], 0.5);
  assert.deepEqual([s[0].x, s[0].z], [0, 0]);
  assert.ok(s.some((p) => Math.hypot(p.x - 10, p.z) < 1e-6));
  const e = s[s.length - 1];
  assert.ok(Math.abs(e.x - 20) < 1e-9 && Math.abs(e.z - 10) < 1e-9);
  for (const p of s) assert.ok(Math.abs(Math.hypot(p.tx, p.tz) - 1) < 1e-6);
  for (let k = 1; k < s.length; k++) assert.ok(s[k].s > s[k - 1].s && s[k].s - s[k - 1].s < 0.6);
});

test('3p index: carriageway / kerb / sidewalk / area zones and raise', () => {
  const I = new RoadIndex(normalizeRoadNetwork(MISSION), 80, 60);
  const p = sampleCenterline(street.points, 0.5).find((q) => q.s >= 10), off = (t) => [p.x - p.tz * t, p.z + p.tx * t];
  const c = I.at(...off(0.2));
  assert.equal(c.zone, 'road'); assert.equal(c.surface, 'setts'); assert.equal(c.raise, 0);
  assert.ok(Math.abs(c.t - 0.2) < 0.05 && Math.abs(c.s - p.s) < 0.2, JSON.stringify(c));
  const k = I.at(...off(-3.62));
  assert.ok(k && k.zone === 'kerb' && k.raise === 0.14, JSON.stringify(k));
  assert.equal(I.at(...off(4.8))?.zone, 'sidewalk');
  assert.equal(I.at(...off(6.5)), null);
  assert.equal(I.at(55, 15).surface, 'quay'); assert.equal(I.raiseAt(55, 15), 0.4);
  assert.equal(I.at(30, 5).surface, 'dirt');
  assert.equal(I.at(70, 40), null);
  assert.equal(I.trailInfo(10, 20.2).hard, true);
  assert.ok(I.trailInfo(10, 20.2).visible < 0.05 && I.trailInfo(30, 50).visible > 0.8);
});

test('3p grid + terrain: roads paint the nav grid, soft roads pre-trample, painter re-weights the splat', () => {
  const grid = new NavGrid(80, 60);
  const net = normalizeRoadNetwork(MISSION);
  paintRoadGrid(grid, net, terrainCode);
  assert.equal(grid.terrainAt?.(10, 20) ?? grid.terrain[grid.index?.(10, 20) ?? (Math.floor(20 / grid.cell) * grid.cols + Math.floor(10 / grid.cell))], T.ROAD);
  assert.equal(grid.terrain[Math.floor(50 / grid.cell) * grid.cols + Math.floor(30 / grid.cell)], T.MUD);
  const tr = pretrampleRoads(net);
  assert.equal(tr.length, 2); // legacy dirt + mud (setts is hard)
  assert.equal(tr[0].passes, 7);
  const paint = terrainPainter(new RoadIndex(net, 80, 60), 'temperate', ['grass', 'grassdry', 'dirt', 'mud', 'gravel', 'road', 'leaves', 'wetsand']);
  const w = new Float32Array(8); w[0] = 1;
  paint(30, 50, w);
  assert.ok(w[3] > 0.9 && w[0] < 0.1, `mud road weights ${[...w]}`);
});

test('3p mesh builder: ribbons, kerbs, sidewalks, rails, quay, details (node, flat materials)', () => {
  const p = buildPavement(normalizeRoadNetwork(MISSION), { heightAt: (x) => Math.sin(x * 0.1) * 0.2, theater: 'temperate' });
  const s = p.stats;
  assert.equal(s.roads, 1); assert.equal(s.areas, 2);
  assert.ok(s.meshes >= 10 && s.tris > 1000 && s.tris < 200000, JSON.stringify(s));
  assert.ok(s.kerbM > 60 && s.drains >= 2 && s.bollards >= 1 && s.rails > 150, JSON.stringify(s));
  let attrs = 0;
  p.group.traverse((o) => { if (o.isMesh && o.geometry.attributes.aPave) { attrs++; assert.ok(o.geometry.attributes.aPvDir && o.geometry.attributes.aPvMisc); } });
  assert.ok(attrs >= 3);
  p.dispose();
  assert.ok(Object.keys(SURFACES).length >= 15);
});

// ------------------------------------------------------------------------------------------ street furniture
import { expandFurniture, FURNITURE_BLOCK } from '../../src/world/roads.js';
import { lampParts, LAMP_VARIANTS, LAMP_LIGHT } from '../../src/art/furniture/lamps.js';
import { buildFurniture } from '../../src/art/furniture/index.js';
import { wireGeometry, fenceParts, propParts } from '../../src/art/furniture/street-props.js';
import { createStreetLights, LIGHTS_PER_PRESET } from '../../src/render/street-lights.js';
import gallery from '../../src/missions/dev/pavement-gallery.js';
import m01 from '../../src/missions/m01_baptism_of_fire.js';
import m02 from '../../src/missions/m02_a_quiet_blow_up.js';
import m03 from '../../src/missions/m03_reverse_engineering.js';

test('3p furniture: expansion — lamps along roads face the carriageway, telegraph lines, fences', () => {
  const net = normalizeRoadNetwork({ roads: [{ surface: 'setts', points: [[0, 0], [40, 0]], width: 8, kerb: true, lamps: { spacing: 10, side: 'both' } }],
    furniture: [{ type: 'telegraph', points: [[0, 20], [90, 20]], spacing: 30 }, { type: 'fence', points: [[0, 30], [10, 30]] }, { type: 'floodlight', x: 5, z: 5 }] });
  const F = expandFurniture(net);
  const lamps = F.items.filter((i) => i.kind === 'lamp');
  assert.equal(lamps.length, 9);   // 4 × 2 sides + the floodlight
  for (const l of lamps.filter((q) => q.variant === 'paris_single')) {
    const az = Math.sin(l.rot);    // z of local +X (the arm) in world xz; the road centre line is z = 0
    assert.ok(az * (0 - l.z) > 0.99 * Math.abs(l.z) / Math.abs(l.z), `arm towards the road ${l.z} ${l.rot}`);
    assert.ok(Math.abs(Math.abs(l.z) - (4 + 0.25 + 0.45)) < 1e-6);
  }
  assert.equal(F.lines.length, 1); assert.equal(F.lines[0].poles.length, 4);
  assert.ok(F.items.some((i) => i.kind === 'fence' && i.points.length === 2));
  assert.equal(F.items.find((i) => i.variant === 'floodlight').kind, 'lamp');
  assert.ok(FURNITURE_BLOCK.lamp > 0 && FURNITURE_BLOCK.bench === 0);
});

test('3p furniture: every lamp variant builds with a light point and a sane polycount', () => {
  for (const v of LAMP_VARIANTS) {
    const { parts, light } = lampParts(v, { hooded: true });
    let tris = 0;
    for (const list of Object.values(parts)) for (const g of list) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    assert.ok(tris > 40 && tris < 4000, `${v} tris ${tris}`);
    assert.ok(light.y > 2 && light.y < 8, `${v} light y ${light.y}`);
    assert.ok(parts.glass.length > 0 && LAMP_LIGHT[v], v);
  }
  assert.ok(LAMP_VARIANTS.length >= 9);
  for (const t of ['bench', 'morris_column', 'crossing', 'bollard', 'milestone']) assert.ok(Object.values(propParts(t)).some((l) => l.length), t);
  for (const v of ['picket', 'railing', 'rail', 'wire']) assert.ok(Object.values(fenceParts([[0, 0], [5, 0]], v)).some((l) => l.length), v);
});

test('3p furniture: sagging wires carry a sway weight that is 0 at the fixings and peaks mid-span', () => {
  const g = wireGeometry([{ a: [0, 6, 0], b: [30, 6, 0] }], { seg: 10 });
  const P = g.attributes.position, S = g.attributes.aSway;
  let minY = 9;
  for (let i = 0; i < P.count; i++) minY = Math.min(minY, P.getY(i));
  assert.ok(minY < 5.9 && minY > 4.5, `sag ${6 - minY}`);
  assert.ok(S.getX(0) < 1e-6 && Math.max(...S.array) > 0.9);
});

test('3p furniture: builder instancing, emitters, BEL telegraph wires, street lights day / night (node)', () => {
  const F = expandFurniture(normalizeRoadNetwork(gallery));
  const B = buildFurniture(F, { groundAt: () => 0 });
  assert.ok(B.stats.lamps >= 20 && B.stats.instanced > 20 && B.stats.poles >= 3 && B.stats.wireSpans >= 12, JSON.stringify(B.stats));
  assert.ok(B.emitters.length >= B.stats.lamps && B.emitters.every((e) => e.y > 2));
  assert.ok(B.emitters.some((e) => e.hooded && e.intensity < 3) && B.emitters.some((e) => !e.lit));
  const day = createStreetLights(null, B.emitters, { night: false, preset: 'high' });
  assert.equal(day.stats.lights, 0); assert.equal(day.stats.lit, 0);
  const night = createStreetLights(null, B.emitters, { night: true, preset: 'high' });
  assert.equal(night.lights.length, LIGHTS_PER_PRESET.high);
  const cam = { position: { x: 35, y: 30, z: 80, clone() { return this; } }, getWorldDirection: (v) => v.set(0, -0.7, -0.7).normalize() };
  night.frame(0.1, cam);
  assert.equal(night.stats.assigned, LIGHTS_PER_PRESET.high);
  night.dispose(); B.dispose();
  // M1 relay-road telegraph poles (wireTo) get wires and are turned across their line
  const poles = m01.structures.filter((s) => s.type === 'telegraph_pole').map((def) => ({ def, object3d: { rotation: { y: 0 }, position: { y: 0 } } }));
  const M = buildFurniture(expandFurniture(normalizeRoadNetwork(m01)), { poles });
  assert.equal(M.stats.wireSpans, 16);
  assert.ok(poles.every((p) => p.object3d.rotation.y !== 0));
});

test('3p BEL networks: M1-M3 author roads / pavements / furniture without touching gameplay blocking', () => {
  for (const m of [m01, m02, m03]) {
    const net = normalizeRoadNetwork(m), F = expandFurniture(net);
    assert.ok(net.roads.length >= 2 && F.items.length >= 5, m.id);
    assert.ok(F.items.every((i) => i.block === false), `${m.id}: furniture is visual only`);
    assert.ok(net.roads.every((r) => !r.legacy), `${m.id}: every road has a surface`);
  }
  assert.equal(normalizeRoadNetwork(m03).areas.length, 2);
});
