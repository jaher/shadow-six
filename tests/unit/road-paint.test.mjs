/**
 * Roads-and-tracks r1: the visual road model (world/roads.js terrainPainter / pretrampleRoads / expandFurniture) never
 * touches what the simulation reads — the normalized network (JSON) and its grid paint are byte-identical to master's for
 * every mission — and the splat painter keeps its promises: a bounded verge band, ragged tapered open ends, junction
 * fillets, max-not-sum overlaps, no change where a mission has no roads, pure world-space output, print visibility kept.
 */
import { test, assert } from './lib.mjs';
import { normalizeRoadNetwork, paintRoadGrid, RoadIndex, terrainPainter, roadLookPainter, overlayRoadLookG, roadLookKey, pretrampleRoads, expandFurniture, SURFACES, roadRutLanes, laneOffsetAt, roadEdgeLines, overlayApronLookG, sampleCenterline, roadObstacles, buildRoadModel } from '../../src/world/roads.js';
import { NavGrid, terrainCode } from '../../src/world/grid.js';
import { MISSIONS } from '../../src/missions/index.js';

const BASE = MISSIONS.filter((m) => /^m\d\d$/.test(m.id));
const LAYERS = {
  temperate: ['grass', 'grassdry', 'dirt', 'mud', 'gravel', 'road', 'leaves', 'wetsand'],
  desert: ['sand', 'sand2', 'gravel', 'dirt', 'rock', 'road', 'grassdry', 'mud'],
  snow: ['snow', 'snowold', 'snowpack', 'rock', 'ice', 'slush', 'grassdry', 'mud'],
};

// ---------------------------------------------------------------------------------------------- master's sim contract
// A frozen copy of master's (ef1b44e0c) normalizeRoadNetwork + paintRoadGrid: the road network and its grid paint are
// read by the simulation (grid codes, RoadIndex, rail clearance, alignment); this package may add nothing enumerable.
const M = (() => {
  const ROAD_DEFAULTS = { width: 6, spline: true, edge: 'ragged', wear: 0.5, patches: 0, cracks: null, weeds: 0.3, puddles: 0.3 };
  const KERB_DEFAULTS = { h: 0.14, w: 0.25, side: 'both', paint: null, gutter: true, drains: 24 };
  const SIDEWALK_DEFAULTS = { w: 2, surface: 'flags', side: 'both' };
  const RAIL_DEFAULTS = { gauge: 1.435, tracks: 1, spacing: 3.3, kind: 'tram', embedded: true, offset: 0 };
  const THEATER_ROAD = { snow: 'snow_packed', desert: 'sand_road', temperate: 'dirt', coast: 'dirt', night: 'dirt' };
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const pt = (p) => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.z]);
  const surf = (s, theater) => (SURFACES[s] ? s : THEATER_ROAD[theater] || 'dirt');
  const rectPolygon = (r) => [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]];
  function normRoad(r, i, theater, legacy = false) {
    const surface = surf(r.surface, theater), S = SURFACES[surface];
    const out = {
      ...ROAD_DEFAULTS, ...r, kind: 'road', id: r.id ?? `road${i}`, surface, legacy,
      points: r.points.map(pt), width: num(r.width, legacy ? 3 : ROAD_DEFAULTS.width),
      kerb: r.kerb ? { ...KERB_DEFAULTS, ...(r.kerb === true ? {} : r.kerb) } : null,
      sidewalk: r.sidewalk ? { ...SIDEWALK_DEFAULTS, ...(r.sidewalk === true ? {} : r.sidewalk) } : null,
      rails: r.rails ? { ...RAIL_DEFAULTS, ...(r.rails === true ? {} : r.rails) } : null,
      markings: r.markings ?? null, craters: Array.isArray(r.craters) ? r.craters.map((c) => [+c[0], +c[1], num(c[2], 2)]) : [],
      manholes: num(r.manholes, S.hard && r.kerb ? 38 : 0), lamps: r.lamps ?? null, seed: num(r.seed, 1 + i * 7919),
    };
    if (out.cracks == null) out.cracks = S.cracks ?? 0.2;
    if (out.sidewalk && !out.kerb) out.kerb = { ...KERB_DEFAULTS };
    if (out.kerb) out.edge = 'kerb';
    return out;
  }
  function normArea(a, i, theater) {
    const surface = surf(a.surface ?? 'flags', theater);
    const points = (Array.isArray(a.points) && a.points.length >= 3 ? a.points : rectPolygon(a)).map(pt);
    return {
      kind: 'area', edge: 'ragged', wear: 0.3, patches: 0, cracks: SURFACES[surface].cracks ?? 0.2, weeds: 0.35, puddles: 0.3,
      ...a, id: a.id ?? `pavement${i}`, surface, points, angle: num(a.angle, 0), raise: num(a.raise, 0),
      kerb: a.kerb ? { ...KERB_DEFAULTS, ...(a.kerb === true ? {} : a.kerb) } : null,
      quay: a.quay ? { edges: [0], bollards: 12, coping: true, rings: true, ...(a.quay === true ? {} : a.quay) } : null,
      craters: Array.isArray(a.craters) ? a.craters.map((c) => [+c[0], +c[1], num(c[2], 2)]) : [], seed: num(a.seed, 101 + i * 7919),
    };
  }
  function normalize(mission = {}) {
    const theater = mission.theater || 'temperate';
    const roads = [];
    (mission.terrain || []).forEach((t) => {
      if (t.type === 'path' && t.terrain === 'road' && Array.isArray(t.points) && t.points.length > 1) roads.push(normRoad({ ...t, spline: t.spline ?? false }, roads.length, theater, !t.surface));
    });
    (mission.roads || []).forEach((r) => { if (Array.isArray(r.points) && r.points.length > 1) roads.push(normRoad(r, roads.length, theater)); });
    const areas = (mission.pavements || []).map((a, i) => normArea(a, i, theater));
    const furniture = (mission.furniture || []).filter((f) => f && f.type).map((f, i) => ({ id: f.id ?? `furn${i}`, rot: 0, ...f }));
    return { theater, roads, areas, furniture };
  }
  return { normalize };
})();

test('road paint: the normalized network (JSON) and its grid paint are byte-identical to master for all 21 missions', () => {
  assert.equal(BASE.length, 21);
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m), ref = M.normalize(m);
    assert.equal(JSON.stringify(net), JSON.stringify(ref), `${m.id}: network JSON`);
    assert.equal(net.missionId, m.id, `${m.id}: missionId`);
    assert.ok(!Object.keys(net).includes('missionId'), `${m.id}: missionId must not be enumerable`);
    // the painters and the stamp jobs never write to the network
    const W = m.size[0], D = m.size[1];
    const L8 = LAYERS[m.theater === 'desert' || m.theater === 'snow' ? m.theater : 'temperate'];
    terrainPainter(new RoadIndex(net, W, D), m.theater || 'temperate', L8);
    roadLookPainter(new RoadIndex(net, W, D), m.theater || 'temperate', L8);
    pretrampleRoads(net); expandFurniture(net); roadLookKey(net);
    assert.equal(JSON.stringify(net), JSON.stringify(ref), `${m.id}: network written by a painter`);
    // the grid paint the sim reads: the same cells, the same codes
    const g1 = new NavGrid(W, D), g2 = new NavGrid(W, D);
    paintRoadGrid(g1, net, terrainCode);
    paintRoadGrid(g2, M.normalize(m), terrainCode);
    assert.ok(Buffer.from(g1.terrain.buffer).equals(Buffer.from(g2.terrain.buffer)), `${m.id}: paintRoadGrid output`);
  }
});

test('road paint: blocking furniture never moves; non-blocking poles move only where the line extras slide them', () => {
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m), out = expandFurniture(net);
    const plain = expandFurniture(Object.assign(M.normalize(m), {}));     // (no missionId: no line extras)
    assert.equal(out.items.length, plain.items.length, m.id);
    out.items.forEach((it, k) => {
      const p = plain.items[k];
      if (it.block !== false) assert.deepEqual([it.x, it.z, it.rot], [p.x, p.z, p.rot], `${m.id} item ${k} (${it.kind}) moved`);
    });
  }
});

// ---------------------------------------------------------------------------------------------- the painter
const T = LAYERS.temperate;
/** A painter over one synthetic mission; returns weights (normalised) at x, z from a grass-only base. */
function painterFor(mission) {
  const net = normalizeRoadNetwork(mission);
  const paint = roadLookPainter(new RoadIndex(net, mission.size[0], mission.size[1]), mission.theater || 'temperate', LAYERS[mission.theater === 'desert' || mission.theater === 'snow' ? mission.theater : 'temperate']);
  return (x, z, base = null) => {
    const w = new Float32Array(8);
    if (base) w.set(base); else w[0] = 1;
    paint?.(x, z, w);
    const s = w.reduce((a, b) => a + b, 0);
    return Array.from(w, (v) => v / s);
  };
}
const road = (pts, extra = {}) => ({ id: 'tst', theater: 'temperate', size: [120, 120], terrain: [{ type: 'path', terrain: 'road', points: pts, width: 4, ...extra }] });

test('road paint: the verge band is bounded (nothing beyond the road + verge + ragged edge, grass thinned inside it)', () => {
  const at = painterFor(road([[0, 60], [120, 60]]));
  const iR = T.indexOf('road');
  for (let x = 10; x < 110; x += 3.7) {
    assert.ok(at(x, 60)[iR] > 0.3, `carriageway at x ${x}`);
    for (const dz of [6.5, 8, 12]) for (const sgn of [-1, 1]) assert.deepEqual(at(x, 60 + sgn * dz), [1, 0, 0, 0, 0, 0, 0, 0], `untouched ${dz} m off the centre at x ${x}`);
  }
  // the verge: just outside the 2 m half-width the sward is thinned somewhere along the road (never a ruler line)
  let thinned = 0, n = 0;
  for (let x = 10; x < 110; x += 0.5) { n++; if (at(x, 60 + 2.6)[0] < 0.85) thinned++; }
  assert.ok(thinned > n * 0.25 && thinned < n, `verge thinned on ${thinned}/${n} samples`);
});

test('road paint: an open end tapers and frays over its last metres; a joined end does not', () => {
  const at = painterFor(road([[10, 60], [70, 60]]));
  const iR = T.indexOf('road');
  const mid = at(40, 60)[iR], near = at(69.4, 60)[iR], past = at(73, 60)[iR];
  assert.ok(mid > 0.3 && near < mid * 0.6 && past < 0.02, `taper ${mid} → ${near} → ${past}`);
  // a T: the stem's end on the through road keeps its full width up to the junction
  const tAt = painterFor({ id: 'tst', theater: 'temperate', size: [120, 120], terrain: [{ type: 'path', terrain: 'road', points: [[0, 60], [120, 60]], width: 4 }, { type: 'path', terrain: 'road', points: [[60, 100], [60, 60]], width: 4 }] });
  assert.ok(tAt(60, 63.5)[iR] > 0.3, 'joined end not tapered');
});

test('road paint: junction fillets round the inside corners; overlapping roads merge by max, not sum', () => {
  const tee = { id: 'tst', theater: 'temperate', size: [120, 120], terrain: [{ type: 'path', terrain: 'road', points: [[0, 60], [120, 60]], width: 4 }, { type: 'path', terrain: 'road', points: [[60, 100], [60, 60]], width: 4 }] };
  const both = painterFor(tee), a = painterFor(road([[0, 60], [120, 60]])), b = painterFor(road([[60, 100], [60, 60]]));
  const iR = T.indexOf('road'), corner = [62.9, 62.9];
  assert.ok(both(...corner)[iR] > Math.max(a(...corner)[iR], b(...corner)[iR]) + 0.02, `fillet ${both(...corner)[iR]} vs ${a(...corner)[iR]} / ${b(...corner)[iR]}`);
  // the same road painted twice (one paint over another: the same seed) reads exactly like one
  const one = painterFor(road([[0, 60], [120, 60]], { seed: 5 }));
  const twice = painterFor({ id: 'tst', theater: 'temperate', size: [120, 120], terrain: [{ type: 'path', terrain: 'road', points: [[0, 60], [120, 60]], width: 4, seed: 5 }, { type: 'path', terrain: 'road', points: [[0, 60], [120, 60]], width: 4, seed: 5 }] });
  for (const p of [[30, 60], [30, 62.2], [30, 63.5], [77, 58.4]]) {
    const w1 = one(...p), w2 = twice(...p);
    for (let k = 0; k < 8; k++) assert.ok(Math.abs(w1[k] - w2[k]) < 0.06, `doubled road at ${p}: layer ${T[k]} ${w1[k]} vs ${w2[k]}`);
  }
});

test('road paint: missions without roads or areas get no painter; the painter is a pure function of world x, z', () => {
  const none = { id: 'tst', theater: 'temperate', size: [60, 60], terrain: [{ type: 'rect', terrain: 'ground', x: 5, z: 5, w: 10, d: 10 }] };
  assert.equal(roadLookPainter(new RoadIndex(normalizeRoadNetwork(none), 60, 60), 'temperate', T), null);
  assert.equal(terrainPainter(new RoadIndex(normalizeRoadNetwork(none), 60, 60), 'temperate', T), null);
  const at = painterFor(road([[0, 60], [120, 61]]));
  const pts = [[13.3, 60.4], [80.1, 59], [50, 63.1], [-4, 60], [125, 61.2], [33.3, 58.8]];
  const first = pts.map((p) => at(...p)), again = [...pts].reverse().map((p) => at(...p)).reverse();
  assert.deepEqual(first, again);
  // past the map edge the road carries on (the apron's mirrored crossings read the same field)
  assert.ok(at(-3, 60)[T.indexOf('road')] > 0.3 && at(123, 61)[T.indexOf('road')] > 0.3);
});

// a frozen copy of master's (36af5aa33) gameplay splat painter: the splat's floats are what the game reads (the guards'
// print visibility, the desert scrub plan), so world/roads.js terrainPainter must paint them exactly as before
const MASTER_PAINTER = (() => {
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const h2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (index, theater, layers) => {
    const net = index.net;
    if (!net.roads.some((r) => !r.legacy) && !net.areas.length) return null;
    const th = theater === 'desert' || theater === 'snow' ? theater : 'temperate';
    const li = (n) => layers.indexOf(n);
    const verge = li(th === 'snow' ? 'snowpack' : 'gravel') >= 0 ? li(th === 'snow' ? 'snowpack' : 'gravel') : li('road');
    return (x, z, w) => {
      const h = index.at(x, z);
      if (!h) return;
      const ragged = (vn(x * 0.9, z * 0.9) - 0.5) * 0.8 + (vn(x * 3.1, z * 3.1) - 0.5) * 0.3;
      const road = h.zone === 'road' ? net.roads.find((r) => r.id === h.id) : null;
      if (road?.legacy) return;
      const S = SURFACES[h.surface];
      let k = 1;
      if (road) k = smooth(-0.2, 0.9, road.width / 2 - Math.abs(h.t) + ragged);
      const idx = S.hard ? verge : li(S.layer?.[th] ?? 'road');
      if (idx < 0 || k <= 0) return;
      for (let q = 0; q < w.length; q++) w[q] *= 1 - k;
      w[idx] += k;
      if (!S.hard && h.surface === 'sand_road') { const a = li('sand'); if (a >= 0) w[a] += 0.6 * smooth(0.45, 0.75, vn(x / 3, z / 9) + ragged * 0.3); }
    };
  };
})();

test('road paint: the gameplay floats keep master\'s paint (terrainPainter byte-identical on every mission)', () => {
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m), W = m.size[0], D = m.size[1], th = m.theater || 'temperate';
    const L8 = LAYERS[th === 'desert' || th === 'snow' ? th : 'temperate'];
    const a = terrainPainter(new RoadIndex(net, W, D), th, L8), b = MASTER_PAINTER(new RoadIndex(net, W, D), th, L8);
    assert.equal(!!a, !!b, `${m.id}: painter presence`);
    if (!a) continue;
    const wa = new Float32Array(8), wb = new Float32Array(8);
    for (let z = 0.125; z < D; z += 0.61) for (let x = 0.125; x < W; x += 0.73) {
      for (let k = 0; k < 8; k++) wa[k] = wb[k] = ((k * 7 + Math.floor(x * 3 + z)) % 5) / 4;
      a(x, z, wa); b(x, z, wb);
      for (let k = 0; k < 8; k++) if (wa[k] !== wb[k]) assert.fail(`${m.id} (${x.toFixed(2)}, ${z.toFixed(2)}) layer ${k}: ${wa[k]} vs ${wb[k]}`);
    }
  }
});

test('road paint: the look is laid over the splat bytes only — the floats are untouched, the bytes stay normalised', () => {
  const m = road([[0, 30], [60, 34]]), net = normalizeRoadNetwork(m), look = roadLookPainter(new RoadIndex(net, 60, 60), 'temperate', T);
  const res = 2, Wt = 120, Ht = 120, f32 = new Float32Array(Wt * Ht * 8), a = new Uint8Array(Wt * Ht * 4), b = new Uint8Array(Wt * Ht * 4);
  for (let p = 0; p < Wt * Ht; p++) { f32[p * 8] = 0.8; f32[p * 8 + 1] = 0.2; a[p * 4] = 204; a[p * 4 + 1] = 51; }
  const f0 = f32.slice(), a0 = a.slice();
  const it = overlayRoadLookG({ res, w: Wt, h: Ht, a, b, f32 }, look, {});
  let r; do { r = it.next(); } while (!r.done);
  assert.ok(r.value > 200, `texels written ${r.value}`);
  assert.ok(Buffer.from(f32.buffer).equals(Buffer.from(f0.buffer)), 'floats untouched');
  let changedFar = 0;
  for (let j = 0; j < Ht; j++) for (let i = 0; i < Wt; i++) {
    const p = j * Wt + i, z = (j + 0.5) / res, x = (i + 0.5) / res;
    let s = 0; for (let k = 0; k < 4; k++) s += a[p * 4 + k] + b[p * 4 + k];
    assert.ok(Math.abs(s - 255) <= 4, `bytes sum ${s}`);
    if (Math.abs(z - (30 + x / 15)) > 9 && (a[p * 4] !== a0[p * 4] || a[p * 4 + 1] !== a0[p * 4 + 1])) changedFar++;
  }
  assert.equal(changedFar, 0, 'nothing painted far from the road');
  // the look's key changes with the line extras (a cached splat painted by another look is laid again)
  assert.notEqual(roadLookKey(net, { lines: [] }), roadLookKey(net, null));
});

test('road paint: the apron\'s crossing lines are master\'s road lines (its floats and tufts keep the gameplay paint)', () => {
  // frozen copy of master's (36af5aa33) pretrampleRoads geometry: what art/terrain.js handed edgeCrossings
  const masterLines = (net) => {
    const out = [];
    net.roads.forEach((r) => {
      if (SURFACES[r.surface].hard) return;
      if (r.legacy) { out.push({ points: r.points.map((p) => [p[0], p[1]]), spread: Math.min(1.2, (r.width ?? 3) * 0.2), width: r.width ?? 3, near: (r.width ?? 3) / 2 + 2 }); return; }
      out.push({ points: sampleCenterline(r.points, 2, r.spline).map((p) => [p.x, p.z]), spread: Math.min(1.4, r.width * 0.2), width: r.width, near: r.type === 'path' ? r.width / 2 + 2 : 1.5 });
    });
    return out;
  };
  let n = 0;
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m), a = roadEdgeLines(net), b = masterLines(net);
    assert.equal(a.length, b.length, `${m.id}: lines`);
    a.forEach((l, i) => {
      assert.deepEqual([l.width, l.spread, l.near], [b[i].width, b[i].spread, b[i].near], `${m.id} line ${i}`);
      assert.deepEqual(l.points, b[i].points, `${m.id} line ${i} points`);
      n++;
    });
  }
  assert.ok(n > 30, `lines ${n}`);
});

test('road paint: the apron look goes on the apron\'s bytes past the edge, along the crossings only, normalised', () => {
  const m = road([[30, 30], [30, 60]]), net = normalizeRoadNetwork(m), look = roadLookPainter(new RoadIndex(net, 60, 60), 'temperate', T);
  // a 100 x 100 m apron splat at 1 texel / m, its origin 20 m before the map's corner; one crossing out of the S side
  const w = 100, h = 100, a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { a[p * 4] = 204; a[p * 4 + 1] = 51; }
  const tex = (d) => ({ image: { data: d, width: w, height: h }, needsUpdate: false });
  const apron = { crossings: [{ e: [30, 60], d: [0, 1], side: 2, cos: 1, hw: 5 }],
    uniforms: { tSplatA: { value: tex(a) }, tSplatB: { value: tex(b) }, uMap: { value: { x: 100, y: 100 } }, uOrigin: { value: { x: -20, y: -20 } } } };
  const a0 = a.slice(), it = overlayApronLookG(apron, look, { W: 60, D: 60, period: 14 });
  let r; do { r = it.next(); } while (!r.done);
  assert.ok(r.value > 20, `texels written ${r.value}`);
  assert.ok(apron.uniforms.tSplatA.value.needsUpdate && apron.uniforms.tSplatB.value.needsUpdate, 'textures flagged');
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = j * w + i, x = -20 + i + 0.5, z = -20 + j + 0.5;
    const changed = a[p * 4] !== a0[p * 4] || a[p * 4 + 1] !== a0[p * 4 + 1];
    let s = 0; for (let k = 0; k < 4; k++) s += a[p * 4 + k] + b[p * 4 + k];
    assert.ok(Math.abs(s - 255) <= 4, `bytes sum ${s}`);
    if (changed) assert.ok(z > 60 && Math.abs(x - 30) < 6, `painted only in the crossing band past the S edge (${x}, ${z})`);
  }
});

test('road paint: rut lanes are pairs that wander a little and stay on the carriageway; the stamps are deterministic', () => {
  const lanes = roadRutLanes({ width: 6, seed: 3 });
  assert.ok(lanes.length >= 2 && lanes.length <= 4);
  for (const ln of lanes) {
    assert.ok(ln.gauge > 1.3 && ln.gauge < 2.05 && ln.wear > 0.3 && ln.wear <= 1);
    for (let s = 0; s < 200; s += 3.1) assert.ok(Math.abs(laneOffsetAt(ln, s)) + ln.gauge / 2 < 3.2, 'wheel line on the road');
  }
  const m = road([[0, 60], [80, 60], [100, 80]]);
  const a = JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m))), b = JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m)));
  assert.equal(a, b);
  // an open end: the wheel lines stop 2-4 m short of it
  const job = pretrampleRoads(normalizeRoadNetwork(road([[10, 60], [70, 60]])))[0];
  for (const l of job.lines) { const e = l.pts[l.pts.length - 1]; assert.ok(e[0] < 68.2 && e[0] > 64, `rut end ${e[0]}`); }
});

// distance from (x, z) to an obstacle footprint of world/roads.js roadObstacles (0 inside)
const footDist = (o, x, z) => {
  if (o.r != null) return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
  const dx = x - o.x, dz = z - o.z, u = Math.abs(dx * o.c + dz * o.s) - o.hw, v = Math.abs(-dx * o.s + dz * o.c) - o.hd;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0);
};

test('road paint: a road\'s ruts swerve round what stands on the carriageway (eased, deterministic) or stop — never under it', () => {
  // a well 0.4 m off the crown of a 4 m track: the lanes ease aside, or where nothing fits their ruts stop
  const m = { ...road([[10, 60], [110, 60]]), structures: [{ id: 'well', type: 'well', x: 60, z: 60.4, r: 0.8, h: 1 }] };
  const net = normalizeRoadNetwork(m), json = JSON.stringify(net);
  const obstacles = roadObstacles(m, net);
  assert.equal(obstacles.length, 1);
  const jobs = pretrampleRoads(net, { obstacles });
  assert.equal(JSON.stringify(net), json, 'the network is not touched');
  assert.equal(JSON.stringify(pretrampleRoads(net, { obstacles })), JSON.stringify(jobs), 'deterministic');
  let lines = 0;
  for (const j of jobs) for (const l of j.lines) {
    lines++;
    l.pts.forEach((p, i) => {
      if ((l.loads ? l.loads[i] : 1) <= 0.02) return;
      assert.ok(footDist(obstacles[0], p[0], p[1]) > l.width / 2 + 0.05, `a wheel over the well at (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`);
    });
  }
  assert.ok(lines > 0, 'the track keeps its ruts');
  // without the well's footprint the same lanes run straight through it (the swerve is the only difference)
  const plain = pretrampleRoads(net);
  assert.ok(plain.some((j) => j.lines.some((l) => l.pts.some((p) => footDist(obstacles[0], p[0], p[1]) < l.width / 2))), 'control: master\'s lanes cross the well');
  // the swerve is eased: a lane's offset moves < 0.23 m per 0.5 m of road
  const lanes = buildRoadModel(net, 120, 120, null, obstacles).courses.find((c) => c.kind === 'road').lanes;
  assert.ok(lanes.some((ln) => ln.shift || ln.cut), 'the lanes react to the well');
  for (const ln of lanes) for (let s = 1; s < 99; s += 0.5) assert.ok(Math.abs(laneOffsetAt(ln, s + 0.5) - laneOffsetAt(ln, s)) < 0.25, `kink at s=${s}`);
  // a hut astride the whole track: the ruts stop at it and run on past it
  const m2 = { ...road([[10, 60], [110, 60]]), structures: [{ id: 'hut', type: 'hut', x: 60, z: 60, w: 6, d: 9, h: 3 }] };
  const n2 = normalizeRoadNetwork(m2), o2 = roadObstacles(m2, n2);
  for (const j of pretrampleRoads(n2, { obstacles: o2 })) for (const l of j.lines) l.pts.forEach((p, i) => {
    if ((l.loads ? l.loads[i] : 1) > 0.02) assert.ok(footDist(o2[0], p[0], p[1]) > l.width / 2, `a rut through the hut at x=${p[0].toFixed(1)}`);
  });
});

test('road paint: on every mission no rut — a road\'s lanes, the setts\' frozen films, a line extra\'s wheels — rolls over a standing thing', () => {
  // (what the lanes swerve round: world/roads.js roadObstacles — buildings, huts, tents, wells, crates, drums, rocks,
  //  trees, bollards, posts, the furniture's lamps and signs; a line extra may end at its own subject — the parked car,
  //  the beached boat, the pad it serves — within 2.5 m + that thing's reach)
  const bad = [];
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m), obs = roadObstacles(m, net);
    const jobs = pretrampleRoads(net, { missionId: m.id, W: m.size[0], D: m.size[1], obstacles: obs });
    for (const j of jobs) for (const l of j.lines) {
      const P = l.pts, S = [0];
      for (let k = 1; k < P.length; k++) S.push(S[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      const L = S[S.length - 1];
      for (const o of obs) {
        const ext = o.r ?? Math.hypot(o.hw, o.hd);
        for (let k = 0; k < P.length; k++) {
          if (S[k] < 2.5 + ext || L - S[k] < 2.5 + ext || (l.loads && l.loads[k] <= 0.02)) continue;
          if (footDist(o, P[k][0], P[k][1]) < l.width / 2 + 0.05) { bad.push(`${m.id} (${P[k][0].toFixed(1)}, ${P[k][1].toFixed(1)})`); break; }
        }
      }
    }
  }
  assert.equal(bad.length, 0, `ruts over standing things: ${bad.slice(0, 8).join(', ')}`);
});
