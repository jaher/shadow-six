/**
 * Roads-and-tracks r1: the per-mission line extras (world/line-extras.js) — every trodden line, rut, stamp and fan lies on
 * its map (or deliberately runs off an edge), every reference names something that exists (a road, a pavement, a
 * non-blocking telegraph line, the camp-ruts decal), the values stay in their ranges, and everything built from them is
 * deterministic. Visual data only: the simulation never reads this module (tests/unit/road-paint.test.mjs holds the
 * network / grid byte-identity).
 */
import { test, assert } from './lib.mjs';
import { LINE_EXTRAS, lineExtrasFor } from '../../src/world/line-extras.js';
import { normalizeRoadNetwork, RoadIndex, roadLookPainter, pretrampleRoads, expandFurniture, roadMatches, SURFACES } from '../../src/world/roads.js';
import { campRutsExtras, scuffPatches } from '../../src/art/camp-ruts.js';
import { M09_RUTS } from '../../src/art/m09-dressing.js';
import { M10_AIRSTRIP } from '../../src/art/m10-dressing.js';
import { stonePlacements, thresholds } from '../../src/art/airstrip.js';
import { MISSIONS } from '../../src/missions/index.js';

const BASE = MISSIONS.filter((m) => /^m\d\d$/.test(m.id));
const byId = new Map(BASE.map((m) => [m.id, m]));
const KINDS = new Set(['foot', 'boot', 'drag', 'cart', 'vehicle', 'tracked', 'sled']);
const LAYERS = {
  temperate: ['grass', 'grassdry', 'dirt', 'mud', 'gravel', 'road', 'leaves', 'wetsand'],
  desert: ['sand', 'sand2', 'gravel', 'dirt', 'rock', 'road', 'grassdry', 'mud'],
  snow: ['snow', 'snowold', 'snowpack', 'rock', 'ice', 'slush', 'grassdry', 'mud'],
};
const fam = (th) => (th === 'desert' || th === 'snow' ? th : 'temperate');
const inside = (p, W, D, m = 0) => p[0] >= -m && p[1] >= -m && p[0] <= W + m && p[1] <= D + m;

/** A polyline is on its map, or leaves it on purpose: only an end point may lie off the map, its segment crossing the edge. */
function onMap(pts, W, D) {
  for (let k = 0; k < pts.length; k++) {
    if (inside(pts[k], W, D, 0.01)) continue;
    const end = k === 0 || k === pts.length - 1, nb = pts[k === 0 ? 1 : k - 1];
    if (!end || !inside(nb, W, D, 0.01)) return `point ${pts[k]} off the map`;
  }
  return null;
}

test('line extras: keyed by the 21 base missions only; lookups of unknown ids are null', () => {
  for (const id of Object.keys(LINE_EXTRAS)) assert.ok(byId.has(id), `unknown mission ${id}`);
  assert.equal(lineExtrasFor('zz99'), null);
  assert.equal(lineExtrasFor(null), null);
  assert.equal(lineExtrasFor('m13'), null, 'M13 has none');
});

test('line extras: every line, stamp and fan lies on its map (or runs off an edge on purpose); kinds and values in range', () => {
  for (const [id, ex] of Object.entries(LINE_EXTRAS)) {
    const m = byId.get(id), [W, D] = m.size;
    for (const [k, l] of (ex.lines || []).entries()) {
      const tag = `${id} line ${k} (${l.kind})`;
      assert.ok(KINDS.has(l.kind), `${tag}: kind`);
      assert.ok(Array.isArray(l.pts) && l.pts.length >= 2, `${tag}: points`);
      const off = onMap(l.pts, W, D);
      assert.ok(!off, `${tag}: ${off}`);
      if (l.w != null) assert.ok(l.w >= 0.3 && l.w <= 4, `${tag}: width ${l.w}`);
      if (l.strength != null) assert.ok(l.strength > 0 && l.strength <= 1, `${tag}: strength ${l.strength}`);
      if (l.gauge != null) assert.ok(l.gauge >= 0.8 && l.gauge <= 2.6, `${tag}: gauge ${l.gauge}`);
      if (l.passes != null) assert.ok(Number.isInteger(l.passes) && l.passes >= 1 && l.passes <= 60, `${tag}: passes ${l.passes}`);
    }
    for (const [k, st] of (ex.stamps || []).entries()) {
      assert.ok(['track', 'tire', 'drag'].includes(st.kind), `${id} stamp ${k}: kind`);
      for (const p of st.pts) assert.ok(inside(p, W, D), `${id} stamp ${k}: ${p} off the map`);
    }
    for (const [k, f] of (ex.fans || []).entries()) {
      assert.ok(inside([f.x, f.z], W, D) && f.r > 0 && f.r <= 6, `${id} fan ${k}`);
      assert.ok(['fan', 'grit', 'gravel'].includes(f.recipe), `${id} fan ${k}: recipe ${f.recipe}`);
    }
    for (const p of ex.toRoad?.from || []) assert.ok(inside(p, W, D), `${id} toRoad ${p}`);
  }
});

test('line extras: road references match a road of the mission (M20: no-op if the castle lane re-laid it), areas name pavements', () => {
  for (const [id, ex] of Object.entries(LINE_EXTRAS)) {
    const m = byId.get(id), net = normalizeRoadNetwork(m);
    for (const [k, r] of (ex.roads || []).entries()) {
      const hits = net.roads.filter((road) => roadMatches(r.match, road));
      if (id === 'm20' && !hits.length) continue; // (matched by geometry: a road the castle lane re-laid elsewhere is a no-op)
      assert.ok(hits.length >= 1, `${id} road option ${k} (near ${r.match?.near}) matches no road`);
      assert.ok(hits.length <= 3, `${id} road option ${k} (near ${r.match?.near}) matches ${hits.length} roads (ambiguous)`);
    }
    for (const aid of Object.keys(ex.areas || {})) assert.ok(net.areas.some((a) => a.id === aid), `${id}: no pavement ${aid}`);
  }
});

test('line extras: non-blocking poles only; slides keep every pole on its line and move it clear of the parked vehicles (M12)', () => {
  for (const [id, ex] of Object.entries(LINE_EXTRAS)) {
    if (!ex.poles) continue;
    const m = byId.get(id), lines = (m.furniture || []).filter((f) => f.type === 'telegraph' && Array.isArray(f.points) && f.points.length > 1);
    for (const p of ex.poles) assert.ok(lines[p.line] && lines[p.line].block === false, `${id}: telegraph line ${p.line} must be block:false`);
  }
  const m12 = byId.get('m12'), out = expandFurniture(normalizeRoadNetwork(m12));
  const veh = ['truck_q', 'car_q'].map((v) => m12.structures.find((s) => s.id === v));
  for (const pole of out.items.filter((i) => i.kind === 'telegraph')) {
    for (const v of veh) {
      const inX = Math.abs(pole.x - v.x) <= v.w / 2 + 0.4, inZ = Math.abs(pole.z - v.z) <= v.d / 2 + 0.4;
      assert.ok(!(inX && inZ), `pole at ${pole.x.toFixed(1)},${pole.z.toFixed(1)} inside ${v.id}`);
    }
  }
});

test('line extras: the camp-ruts options find M9\'s decal (by its seed); scuff patches stay on the hardpan, off the roads', () => {
  const ex = campRutsExtras(M09_RUTS);
  assert.ok(ex && ex === LINE_EXTRAS.m09.campRuts, 'M9 decal matched');
  assert.equal(campRutsExtras({ seed: 1 }), null);
  const P = scuffPatches(M09_RUTS);
  assert.ok(P.length >= 20, `${P.length} scuff patches`);
  assert.equal(JSON.stringify(P), JSON.stringify(scuffPatches(M09_RUTS)), 'deterministic');
  const net = normalizeRoadNetwork(byId.get('m09')), idx = new RoadIndex(net, 103, 122);
  for (const p of P) assert.ok(idx.at(p.x, p.z)?.zone !== 'road', `scuff ${p.x.toFixed(1)},${p.z.toFixed(1)} on a road`);
});

test('line extras: the landing ground\'s stones and threshold ruts lie on the strip\'s ends / edges, deterministic', () => {
  const S = stonePlacements(M10_AIRSTRIP), T = thresholds(M10_AIRSTRIP), A = M10_AIRSTRIP;
  assert.ok(S.length >= 40 && S.length <= 90, `${S.length} stones`);
  for (const s of S) {
    assert.ok(Math.min(Math.abs(s.z - A.strip.z0), Math.abs(s.z - A.strip.z1)) < 0.3, `stone off the strip edge at z ${s.z}`);
    assert.ok(s.r > 0.1 && s.r < 0.25 && s.h > 0.05 && s.h < 0.3, 'stone size');
  }
  assert.equal(T.length, 2);
  for (const set of T) for (const t of set) for (const p of t.pts) assert.ok(p[0] >= A.area.x0 - 1e-6 && p[0] <= A.area.x1 + 1e-6 && p[1] >= A.area.z0 && p[1] <= A.area.z1, `threshold rut ${p}`);
  assert.equal(JSON.stringify([stonePlacements(A), thresholds(A)]), JSON.stringify([S, T]));
});

test('line extras: everything built from them is deterministic (pre-trample jobs, painted weights) for every mission', () => {
  for (const m of BASE) {
    const a = JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m))), b = JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m)));
    assert.equal(a, b, `${m.id}: pre-trample jobs`);
    const L = LAYERS[fam(m.theater)], [W, D] = m.size;
    const p1 = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, L), p2 = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, L);
    if (!p1) continue;
    for (let k = 0; k < 400; k++) {
      const x = ((k * 37.13) % (W + 8)) - 4, z = ((k * 53.71) % (D + 8)) - 4;
      const w1 = new Float32Array(8), w2 = new Float32Array(8); w1[0] = w2[0] = 1;
      p1(x, z, w1); p2(x, z, w2);
      assert.deepEqual(Array.from(w1), Array.from(w2), `${m.id} paint at ${x.toFixed(1)},${z.toFixed(1)}`);
    }
  }
});

test('line extras: every desire line / rut job carries its centre line and stamps only finite points; loads in range', () => {
  for (const m of BASE) {
    for (const job of pretrampleRoads(normalizeRoadNetwork(m))) {
      for (const l of job.lines || []) {
        assert.ok(l.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), `${m.id}: finite rut points`);
        assert.ok(l.load > 0 && l.load < 2.5 && (l.berm ?? 1) >= 0 && (l.berm ?? 1) <= 1, `${m.id}: rut load ${l.load} berm ${l.berm}`);
      }
      for (const wk of job.walkers || []) {
        assert.ok(wk.pts.length >= 2, `${m.id}: walker`);
        if (wk.stride != null) assert.ok(wk.stride > 0.5 && wk.stride < 0.9 && wk.phase >= 0 && wk.phase < 1, `${m.id}: walker stride / phase`);
      }
    }
  }
});

test('line extras: wheel ruts (roads and vehicle / cart / tank lines alike) become a short fading film on hard ground', () => {
  // the pavement shader turns any trail into a full film: a line stamped across a slab would print as dark ruled stripes
  let checked = 0;
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m);
    if (!net.roads.some((r) => SURFACES[r.surface]?.hard) && !net.areas.some((a) => SURFACES[a.surface]?.hard)) continue;
    const [W, D] = m.size || [m.width, m.height];
    const idx = new RoadIndex(net, W, D);
    for (const job of pretrampleRoads(net)) {
      for (const l of job.lines || []) {
        if (!l.loads) continue; // static stamps, hard ribbons' own films
        l.pts.forEach((p, i) => {
          if (!idx.covers(p[0], p[1])) return;
          checked++;
          assert.ok(l.loads[i] <= 0.45 + 1e-9, `${m.id}: a rut at ${p} on hard ground with load ×${l.loads[i].toFixed(2)}`);
        });
      }
    }
  }
  assert.ok(checked > 50, `rut points on hard ground checked: ${checked}`);
});

test('line extras: surfaces referenced by the painter exist; theatre recipes resolve for every mission', () => {
  for (const m of BASE) {
    const net = normalizeRoadNetwork(m);
    for (const r of net.roads) assert.ok(SURFACES[r.surface], `${m.id}: surface ${r.surface}`);
  }
});

test('line extras: no trodden line or vehicle track runs through a building, hut or tent (a door stub may touch the wall)', () => {
  // walkable or flat structures (piers, decks, bridges, launch pads, ranges) and small props (crates, barrels, rocks,
  // generators) are not buildings; the footprint is the structure's oriented w x d rectangle (world/placement-geom.js)
  const skip = /^(crates|road|pave|pier|bridge|truss_bridge|launch_pad|firing_range|rocks|barrels|generator)/;
  for (const m of BASE) {
    const lines = LINE_EXTRAS[m.id]?.lines || [];
    const S = (m.structures || []).filter((b) => b.x != null && b.w && b.d && !skip.test(b.type || ''));
    const within = (x, z, b) => {
      const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * c + dz * s) < b.w / 2 - 0.4 && Math.abs(-dx * s + dz * c) < b.d / 2 - 0.4;
    };
    lines.forEach((l, li) => {
      const hits = new Map();
      for (let k = 0; k + 1 < l.pts.length; k++) {
        const [ax, az] = l.pts[k], [bx, bz] = l.pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t <= L; t += 0.5) {
          const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
          for (const b of S) if (within(x, z, b)) hits.set(b.id, (hits.get(b.id) || 0) + 1);
        }
      }
      for (const [id, n] of hits) assert.ok(n <= 2, `${m.id} line ${li} (${l.kind}) runs ${n * 0.5} m through ${id}`);
    });
    // the desire lines generated from doors to the nearest road (`toRoad`) as well
    if (LINE_EXTRAS[m.id]?.toRoad) {
      const look = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), m.size[0], m.size[1]), m.theater || 'temperate', LAYERS[fam(m.theater)]);
      for (const c of look.model.courses.filter((q) => String(q.id).startsWith('toRoad'))) {
        const hits = new Map();
        for (const p of c.pts) for (const b of S) if (within(p.x, p.z, b)) hits.set(b.id, (hits.get(b.id) || 0) + 1);
        for (const [id, n] of hits) assert.ok(n <= 3, `${m.id} ${c.id} runs ${n * 0.5} m through ${id}`);
      }
    }
  }
});

// Where the game's placement rules put the point props near a line (world.placement.structures, read in the browser on
// master 36af5aa33): in the game they are moved by their drawn shapes, off the water and out of the houses (a node
// build only checks them: "data shapes; not moved"), so a line keeps clear of both spots — M7's quay bollards stand
// 3.5 m in off the water, M5's crates 1.8 m off cabin h5.
const IN_GAME_MOVES = {
  m05: [['drums_h2a', 28.13, 48.41], ['drums_h3', 19.9, 51.87], ['crates_h5', 22.36, 67.83], ['crates_ls', 27.93, 78.87]],
  m06: [['drums_2', 85.11, 69.98]],
  m07: [['quay_bollard_1', 4.27, 99.45], ['quay_bollard_4', 17.63, 111.71], ['quay_bollard_5', 21.83, 115.56], ['quay_bollard_7', 30.6, 123.34], ['quay_bollard_8', 35.41, 127.77], ['quay_bollard_9', 39.78, 131.56], ['quay_bollard_10', 44.08, 135.48], ['barrier_ne', 78.47, 59.13]],
  m08: [['palm_3', 38.66, 59.3]],
  m11: [['brl_q3', 95.74, 41.63], ['bush_s1', 47.27, 122.92], ['crates_c1', 46.66, 134.59], ['bush_sw4', 39.81, 127.45]],
  m14: [['rk_g3a', 71.44, 60.91]],
  m15: [['cypress_1', 44.55, 5.06]],
  m19: [['v2_w_gantry', 123.86, 38.99]],
  m20: [['pole_4', 138.43, 132.07]],
};
test('line extras: a wheel line keeps its whole width off everything standing; a trodden line its trodden core; neither crosses a fence or wall but at a gate', () => {
  // what stands: the mission's structures with a footprint (oriented w × d, or r; a bare point is a 0.25 m post; tree
  // trunks ≤ 0.4 m) and the road furniture (lamps, signs, poles); not what is walked / driven on or cut into the ground.
  // A vehicle / cart / tank / sled line clears them by half its width (gauge + tyres) wherever it is not ending at its
  // own subject (the parked car, the beached boat, the pad: its last / first 2.5 m + that thing's reach); a foot / boot /
  // drag line keeps its trodden core (w/2 − 0.35 m) off the props and its centre 0.25 m off a building's wall.
  const FLAT = /^(road|pave|pier|bridge|truss_bridge|rail_bridge|mobile_bridge|launch_pad|firing_range|timber_platform|crater|dam|river|ravine|rail_track|tram_track|cliff|trench|sea_wall|battleship|uboat_tower|lock_gate|water_gate|gate|castle_gate)/;
  const BARRIER = /^(fence|wall|castle_wall|hedge)/;
  const BLD = /^(house|hut|barracks|flat_roof_house|ruins|bunker|tent|villa|hangar|garage|mosque|watermill|mine_building|tank_shed|prison_pen|control_shack|cable_car_station|casemate_gun|lighthouse|watchtower)/;
  const WHEEL = new Set(['cart', 'vehicle', 'tracked', 'sled']);
  const dist = (o, x, z) => {
    if (o.r != null) return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
    const c = Math.cos(o.rot), s = Math.sin(o.rot), dx = x - o.x, dz = z - o.z;
    const u = Math.abs(dx * c + dz * s) - o.w / 2, v = Math.abs(-dx * s + dz * c) - o.d / 2;
    return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0);
  };
  const cross = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]], den = r[0] * q[1] - r[1] * q[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null; };
  const bad = [];
  for (const m of BASE) {
    const lines = LINE_EXTRAS[m.id]?.lines || [];
    if (!lines.length) continue;
    const obs = [], bars = [], gates = [];
    for (const st of m.structures || []) {
      const t = st.type || '';
      if (/gate/.test(t) && st.x != null) gates.push({ x: st.x, z: st.z, w: st.w ?? 2.5 });
      if (Array.isArray(st.points) && BARRIER.test(t)) { bars.push({ id: st.id, pts: st.points }); continue; }
      if (st.x == null || FLAT.test(t)) continue;
      const tree = /^(pine|palm|tree)/.test(t);
      const at = [[st.x, st.z, '']];
      const mv = (IN_GAME_MOVES[m.id] || []).find(([id]) => id === st.id);
      if (mv) at.push([mv[1], mv[2], ' (in game)']);
      for (const [x, z, tag] of at) {
        if (st.w && st.d) obs.push({ id: st.id + tag, t, x, z, w: st.w, d: st.d, rot: st.rot || 0, h: st.h ?? 2, ext: Math.hypot(st.w, st.d) / 2 });
        else { const r = tree ? Math.min(st.r ?? 0.3, 0.4) : st.r ?? 0.25; obs.push({ id: st.id + tag, t, x, z, r, h: st.h ?? (tree ? 5 : 1), ext: r }); }
      }
    }
    for (const f of expandFurniture(normalizeRoadNetwork(m)).items) {
      if (f.kind === 'fence' && f.points) bars.push({ id: f.id || 'fence', pts: f.points.map((q) => (Array.isArray(q) ? q : [q.x, q.z])) });
      else if (f.x != null) obs.push({ id: f.id || f.kind, t: 'furn:' + f.kind, x: f.x, z: f.z, r: 0.22, h: 2, ext: 0.22 });
    }
    lines.forEach((l, li) => {
      const wheel = WHEEL.has(l.kind);
      const half = wheel ? ((l.gauge ?? (l.kind === 'tracked' ? 1.75 : l.kind === 'cart' ? 1.35 : l.kind === 'sled' ? 0.9 : 1.72)) + (l.kind === 'tracked' ? 0.5 : 0.3)) / 2 + 0.1 : Math.max(0.15, (l.w ?? 1.2) / 2 - 0.35);
      const P = [];
      let acc = 0;
      for (let k = 0; k + 1 < l.pts.length; k++) {
        const [ax, az] = l.pts[k], [bx, bz] = l.pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L; t += 0.25) P.push([ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L, acc + t]);
        acc += L;
      }
      P.push([...l.pts[l.pts.length - 1], acc]);
      for (const o of obs) {
        if (wheel && o.h < 0.3) continue;
        const need = wheel ? half : BLD.test(o.t) ? 0.25 : half;
        for (const [x, z, sAt] of P) {
          if (sAt < 2.5 + o.ext || acc - sAt < 2.5 + o.ext) continue;
          if (dist(o, x, z) < need) { bad.push(`${m.id} line ${li} (${l.kind}) over ${o.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`); break; }
        }
      }
      for (const b of bars) for (let j = 0; j + 1 < b.pts.length; j++) for (let k = 0; k + 1 < l.pts.length; k++) {
        const q = cross(l.pts[k], l.pts[k + 1], b.pts[j], b.pts[j + 1]);
        if (!q) continue;
        const g = gates.find((gt) => Math.hypot(gt.x - q[0], gt.z - q[1]) < gt.w / 2 + 0.8);
        if (!g || (wheel && g.w < 2 * half + 0.2)) bad.push(`${m.id} line ${li} (${l.kind}) crosses ${b.id} at (${q[0].toFixed(1)}, ${q[1].toFixed(1)})`);
      }
    });
  }
  for (const [mid, list] of Object.entries(IN_GAME_MOVES)) for (const [id] of list) assert.ok((byId.get(mid)?.structures || []).some((st) => st.id === id), `${mid}: no structure ${id}`);
  assert.equal(bad.length, 0, bad.slice(0, 10).join('\n'));
});
