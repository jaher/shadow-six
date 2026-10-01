/**
 * Barbed wire (docs/barbed-wire.md §9): the variant table, the strand generator (sag, barbs, coils on the ground),
 * the M2 coping crossing fix, placement (no wire in solids), cut gaps (pure + re-derived from the grid), LOD and the
 * per-mission budgets. Node only: geometry, no WebGL.
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { catenary, measuredSag, barbStations, concertinaPath, wireLod, barbVisFor, WireBuffer, arcLengths, INST_STRIDE } from '../../src/art/barbed-wire.js';
import { wireTypeOf, wireLookOf, WIRE_TYPES, buildWireRun, buildWireLayer, Parts, assembleRibbons, cutPath, curlTail, panelGeometry } from '../../src/art/wire-obstacles.js';
import { buildWall } from '../../src/art/dressing.js';
import { World } from '../../src/world/world.js';
import { B } from '../../src/world/grid.js';
import { buildMap } from '../../src/world/map-builder.js';
import { getMission } from '../../src/missions/index.js';
import gallery from '../../src/missions/dev/wire-gallery.js';
import { penWireRuns } from '../../src/art/wire-missions.js';

const loadMap = (def) => {
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def });
  const handle = buildMap(world, def);
  return { world, handle };
};
const hill = (x, z) => 0.25 * Math.sin(x * 0.7) + 0.2 * Math.cos(z * 0.9);

test('variants: every mission wire variant resolves to a wire type (master + feat/missions table)', () => {
  const want = {
    wire: 'field_fence', wire_on_stakes: 'double_apron', knife_rest_wood: 'knife_rest', concertina: 'concertina', wire_gun: 'concertina',
    concertina_hedgehog: 'triple_concertina', barbed_wire_hedgehog: 'hedgehog_belt', czech_hedgehog_wire: 'hedgehog_belt',
    electric: 'chainlink', square: 'chainlink', fence_chainlink: 'chainlink', mesh_iron: 'chainlink', prisoner_cage: 'cage', wire_cage: 'cage',
  };
  for (const [v, t] of Object.entries(want)) assert.equal(wireTypeOf({ type: 'fence', variant: v, h: 1.2 }), t, v);
  assert.equal(wireTypeOf({ type: 'fence', variant: 'barbed_wire', h: 1.2 }), 'double_apron');
  assert.equal(wireTypeOf({ type: 'fence', variant: 'barbed_wire', h: 2.0 }), 'field_fence');
  assert.equal(wireTypeOf({ type: 'fence' }, { missionId: 'm00' }), 'field_fence');
  assert.equal(wireTypeOf({ type: 'fence' }, { missionId: 'b00' }), null, 'BCD ostrich pen is a paddock rail, not wire');
  assert.equal(wireTypeOf({ type: 'wall', variant: 'palisade_wire' }), 'coping_bracket');
  assert.equal(wireTypeOf({ type: 'wall', variant: 'wall_stone_zigzag' }), 'coping_bracket');
  assert.equal(wireTypeOf({ type: 'wall', variant: 'mudbrick_wire' }), 'coping_concertina');
  assert.equal(wireTypeOf({ type: 'wall', variant: 'palisade' }), null);
  assert.equal(wireTypeOf({ type: 'prison_pen', variant: 'wire_cage' }), 'cage');
  assert.equal(wireTypeOf({ type: 'fence', variant: 'wire_on_stakes', wire: 'knife_rest' }), 'knife_rest', 'explicit hint wins');
  // M1-M3 + sandbox: every fence / wire wall is drawn by the wire layer
  for (const id of ['m00', 'm02', 'm03']) {
    const m = getMission(id);
    for (const s of m.structures.filter((q) => q.type === 'fence' || /wire/.test(String(q.variant)))) assert.ok(wireTypeOf(s, { missionId: id }), `${id} ${s.id ?? s.type}`);
  }
});

test('strand: catenary sag, barb spacing and orientation data', () => {
  const p = catenary([0, 1, 0], [3, 1, 0], 0.015);
  near(measuredSag(p), 0.015, 0.002, 'fence sag over 3 m');
  near(p[0][1], 1, 1e-9); near(p[p.length - 1][1], 1, 1e-9);
  const st = barbStations(30, 0.12, 0.015, Math.random);
  const gaps = st.slice(1).map((d, i) => d - st[i]);
  near(gaps.reduce((a, b) => a + b, 0) / gaps.length, 0.12, 0.005, 'mean barb spacing');
  assert.ok(Math.min(...gaps) >= 0.105 - 1e-9 && Math.max(...gaps) <= 0.135 + 1e-9, 'barb jitter ±1.5 cm');
  assert.ok(st[0] > 0.04 && st[st.length - 1] < 30 - 0.04, 'no barb on the fixings');
  const buf = new WireBuffer();
  buf.strand(p); const n = buf.barbs(p, { spacing: 0.12, points: 4 });
  assert.equal(buf.barbCount, n);
  for (let i = 0; i < buf.barb.length; i += INST_STRIDE) {
    const t = buf.barb.slice(i + 4, i + 7);
    near(Math.hypot(...t), 1, 1e-6, 'barb carries the unit strand tangent');
    assert.ok(buf.barb[i + 9] > 0.012 && buf.barb[i + 9] < 0.02, 'barb point 12–20 mm');
  }
});

test('field fence + double apron: sag in range, strands clear the ground, apron narrowed at solids', () => {
  const P = new Parts();
  buildWireRun('field_fence', [[0, 0], [12, 0], [12, 9]], { id: 'f', type: 'fence', h: 1.5 }, { parts: P, groundAt: hill, theater: 'temperate', runKey: 'f#0' });
  const spans = P.items.filter((i) => i.barbs && i.sArr);
  assert.ok(spans.length >= 5 * 7, `5 strands × spans (${spans.length})`);
  for (const it of spans) { const L = arcLengths(it.path).pop(); assert.ok(measuredSag(it.path) <= 0.03 * Math.max(1, (L / 3) ** 2) + 1e-6, 'taut fence'); }
  const asm = assembleRibbons(P, new Map(), hill);
  const buf = [...asm.buffers.values()][0];
  for (let k = 0; k < buf.pos.length; k += 3) if (buf.mat[k + 1] === 0) assert.ok(buf.pos[k + 1] >= hill(buf.pos[k], buf.pos[k + 2]) + 0.03 - 1e-6, 'strand ≥ 3 cm above ground');
  // apron anchors pull in where a solid sits beside the run
  const P2 = new Parts(), solid = (x, z) => z > 0.9;
  const C = buildWireRun('double_apron', [[0, 0], [9, 0]], { id: 'a', type: 'fence', h: 1.2, width: 1 }, { parts: P2, solidAt: solid, outside: 1, runKey: 'a#0' });
  assert.ok(C && P2.inst.get('screw').length >= 8, 'anchor pickets');
  for (const m of P2.inst.get('screw')) { const v = new THREE.Vector3().setFromMatrixPosition(m); assert.ok(!solid(v.x, v.z), `anchor out of the solid (${v.z.toFixed(2)})`); }
});

test('concertina: every loop rests on the ground; reinforced coils are tighter and denser', () => {
  const rnd = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const path = concertinaPath([0, 0], [6, 2], { diameter: 0.8, pitch: 0.28, segments: 14 }, rnd, hill);
  for (let i = 0; i + 14 <= path.length; i += 14) {
    const loop = path.slice(i, i + 14);
    const low = loop.reduce((a, p) => (p[1] - hill(p[0], p[2]) < a ? p[1] - hill(p[0], p[2]) : a), Infinity);
    assert.ok(Math.abs(low) < 0.01, `loop ${i / 14} touches the ground (${low.toFixed(3)})`);
  }
  const A = new Parts(), R = new Parts();
  buildWireRun('concertina', [[0, 0], [10, 0]], { id: 'c', type: 'fence' }, { parts: A });
  buildWireRun('concertina', [[0, 0], [10, 0]], { id: 'c', type: 'fence', reinforced: true }, { parts: R, look: 'reinforced' });
  assert.ok(R.counts.coilLoops > A.counts.coilLoops * 1.3, 'tighter coil');
  assert.ok(R.items.find((i) => i.coil).barbs.spacing < A.items.find((i) => i.coil).barbs.spacing, 'denser barbs');
  assert.equal(wireLookOf({ reinforced: true }, 'snow'), 'reinforced');
  assert.equal(R.items.find((i) => i.coil).cuttable, false, 'reinforced wire is not cut');
});

test('M2 coping: every strand clears the tallest stake of its spans by ≥ 4 cm (the crossing regression)', () => {
  const m = getMission('m02'), def = m.structures.find((s) => s.id === 'camp_wall');
  const pts = def.segments[0].map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  const root = buildWall(pts, { variant: def.variant, h: def.h, width: def.width, id: def.id, walkways: def.walkways });
  const tag = root.userData.wireRun;
  assert.ok(tag && tag.coping.stakes.length > 300, 'stakes recorded');
  const P = new Parts();
  const C = buildWireRun('coping_bracket', tag.points, tag.def, { parts: P, coping: tag.coping });
  const stakes = tag.coping.stakes;
  let n = 0;
  for (const it of P.items.filter((i) => i.minAbove != null)) {
    for (const p of it.path) {
      assert.ok(p[1] >= it.minAbove - 1e-6, `strand at ${p[1].toFixed(3)} below the span max + 4 cm (${it.minAbove.toFixed(3)})`);
      for (const s of stakes) if (Math.hypot(p[0] - s.x, p[2] - s.z) < s.r + 0.01) assert.ok(p[1] > s.top + 0.04, 'no strand inside a stake');
      n++;
    }
  }
  assert.ok(n > 1000 && C.brackets.length > 40, `samples ${n}, brackets ${C.brackets.length}`);
});

test('placement: M3 wire stays out of solids; budgets for M2 / M3 / gallery', () => {
  for (const def of [getMission('m02'), getMission('m03'), gallery]) {
    const { world, handle } = loadMap(def);
    const W = handle.wire, g = world.grid;
    assert.ok(W, `${def.id} wire layer`);
    // the wire's own structures (a palisade under its coping) are not "other" solids
    const owners = new Set(W.runs.map((r) => world.structures.get(r.def.id)?.owner).filter((o) => o != null));
    for (const it of W.parts.items) for (const p of it.path) {
      const c = g.worldToCell(p[0], p[2]);
      if (c.i < 0 || c.j < 0 || c.i >= g.cols || c.j >= g.rows) continue;
      const k = g.idx(c.i, c.j);
      // ground-level wire only: the 2-D grid has no heights (a coping strand at 3.2 m may pass over a 1.8 m rock)
      if (p[1] > 2.0) continue;
      assert.ok(owners.has(g.owner[k]) || g.block[k] !== B.HIGH, `${def.id}: wire in a solid at ${p.map((v) => v.toFixed(2))}`);
    }
    const s = W.stats;
    // §7 budgets for the campaign maps (the gallery packs every type into 64 × 56 m: logged only)
    if (def.id !== 'wiregal') assert.ok(s.ribbonTris < 200000 && s.drawCalls <= 40 && s.buildMs < 150, `${def.id} budget ${JSON.stringify(s)}`);
    console.log(`  wire ${def.id}: ${JSON.stringify(s)}`);
    handle.dispose();
  }
});

test('cut gaps: strands split, two curled tails per cut strand, panels opened, re-derived from the grid', () => {
  const path = catenary([0, 1, 0], [3, 1, 0], 0.02), sArr = path.map((_, i) => (3 * i) / (path.length - 1));
  const { pieces, cuts } = cutPath(path, sArr, [[1, 2]]);
  assert.equal(pieces.length, 2); assert.equal(cuts.length, 2);
  for (const pc of pieces) for (const s of pc.sArr) assert.ok(s <= 1 + 1e-9 || s >= 2 - 1e-9, 'nothing inside the gap');
  const tail = curlTail(cuts[0], 'hard', Math.random, () => 0);
  assert.ok(tail.length > 30 && tail.every((p) => p[1] >= 0.012 - 1e-9), 'tail curls and stays above ground');
  const P = new Parts();
  buildWireRun('field_fence', [[0, 0], [10, 0]], { id: 'f', type: 'fence', h: 1.2 }, { parts: P, runKey: 'f#0' });
  // cut ends: every gap edge strictly inside a cuttable span (a post at 5 m sits in the gap: both spans end there)
  const ends = P.items.filter((i) => i.cuttable && i.sArr).reduce((n, i) => {
    const a = Math.min(...i.sArr), b = Math.max(...i.sArr);
    return n + [4.25, 5.75].filter((e) => a < e && e < b).length;
  }, 0);
  const asm = assembleRibbons(P, new Map([['f#0', [[4.25, 5.75]]]]));
  assert.ok(ends >= 8 && asm.cuts === ends, `a curled tail at every cut end (${asm.cuts}/${ends})`);
  const pg0 = panelGeometry([{ a: [0, 0], b: [3, 0], ga: 0, gb: 0, bottom: 0, top: 2, runKey: 'k', da: 0, db: 3, cuttable: true }]);
  const pg1 = panelGeometry([{ a: [0, 0], b: [3, 0], ga: 0, gb: 0, bottom: 0, top: 2, runKey: 'k', da: 0, db: 3, cuttable: true }], new Map([['k', [[1, 2]]]]));
  assert.equal(pg0.index.count / 6, 1); assert.equal(pg1.index.count / 6, 2, 'mesh panel opened at the gap');
  // the game path: clear the FENCE cells like the Sapper (1.5 m), the layer re-derives the gap from the grid
  const def = getMission('m00'), { world, handle } = loadMap(def), W = handle.wire, g = world.grid;
  const before = W.stats.cuts;
  for (let dx = -0.75; dx <= 0.75; dx += 0.25) { const c = g.worldToCell(26 + dx, 40); if (g.block[g.idx(c.i, c.j)] === B.FENCE) g.block[g.idx(c.i, c.j)] = B.NONE; }
  g.version++;
  world.events.emit('structure:destroyed', { type: 'fence-gap', id: 'fence' });
  assert.ok(before === 0 && W.stats.cuts >= 8, `gap with curled tails (${W.stats.cuts})`);
  const gaps1 = JSON.stringify([...W.gaps]);
  assert.equal(W.scanGaps(), false, 'stable: no rebuild without a grid change');
  // a load: the mission is rebuilt fresh, then the saved grid is restored → the same gap, no new save fields
  const saved = g.serialize(), B2 = loadMap(def);
  B2.world.grid.deserialize(saved);
  B2.handle.wire.update(0);
  assert.equal(JSON.stringify([...B2.handle.wire.gaps]), gaps1);
  handle.dispose(); B2.handle.dispose();
});

test('electric / LOD: insulators, plates and spark points; barbs fade by pixel size; zoom steps', () => {
  const P = new Parts();
  buildWireRun('chainlink', [[0, 0], [40, 0]], { id: 'e', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P });
  assert.ok(P.inst.get('insulator').length > 40 && P.inst.get('plate').length >= 1 && P.sparks.length > 20 && P.panels.length >= 13);
  const Q = new Parts();
  buildWireRun('chainlink', [[0, 0], [40, 0]], { id: 'q', type: 'fence', variant: 'chainlink', h: 2.5 }, { parts: Q });
  assert.ok(!Q.inst.get('insulator') && !Q.sparks.length, 'plain chain-link: no insulators, no sparks');
  assert.equal(wireLod(0.5).barbGeo, 0); assert.equal(wireLod(2).barbGeo, 1); assert.equal(wireLod(1).level, 'mid');
  assert.equal(barbVisFor(0.05), 0); assert.equal(barbVisFor(0.0125), 1);
  assert.ok(barbVisFor(0.035) > 0 && barbVisFor(0.035) < 1, 'smooth fade');
  for (const t of WIRE_TYPES) {
    const R = new Parts();
    buildWireRun(t, [[0, 0], [12, 0]], { id: t, type: 'fence', h: 1.4, width: 1 }, { parts: R, coping: /coping/.test(t) ? { top: 2 } : null });
    assert.ok(R.items.length > 3, `${t} builds wire`);
  }
});

test('map edge: a chain-link leg with the map edge ≤ 5 m outside takes its outriggers inward (no strands in the edge treeline)', () => {
  const off = (x) => x < 0;   // the map starts at x = 0; the fence runs at x = 4, its inside to the east
  const run = (offMap) => { const P = new Parts(); buildWireRun('chainlink', [[4, 10], [4, 34]], { id: 'w', type: 'fence', variant: 'electric', h: 2.5 }, { parts: P, inside: [20, 22], offMap }); return P; };
  const top = (P) => P.items.filter((i) => !i.tie && i.path.some((p) => p[1] > 2.6)).flatMap((i) => i.path.map((p) => p[0]));
  const edge = top(run((x) => off(x))), open = top(run(() => false));
  assert.ok(edge.length > 20 && Math.min(...edge) >= 4 - 1e-6, `edge leg: outrigger strands inside the fence line (min x ${Math.min(...edge).toFixed(2)})`);
  assert.ok(Math.min(...open) < 3.7, 'open ground: outriggers lean outward as before');
});

test('M4–M20: every wire structure draws as its obstacle type (art/wire-missions.js); railings, plank palisades and bullet stops are not wire', () => {
  const want = {
    m04: { wire: 'knife_rest' }, m06: { wire_n: 'double_apron', wire_bar: 'knife_rest' }, m07: { w_salient: 'coping_bracket' },
    m08: { wire_n: 'double_apron', wire_gun: 'concertina' }, m09: { w_n: 'coping_concertina', f_fw: 'chainlink' },
    m10: { belt_w1: 'double_apron', belt_rim_w: 'double_apron', wall_s: 'coping_concertina', pen: 'cage', fence_sw: 'chainlink' },
    m11: { wire_sw: 'triple_concertina' }, m15: { knife_rests: 'knife_rest' }, m16: { belt_b: 'hedgehog_belt' }, m18: { belt_b: 'hedgehog_belt' },
    m14: { wr_sw1: 'concertina', wr_s2: 'knife_rest', wr_ne1: 'hedgehog_belt', wr_n1: 'double_apron', wr_n2: 'triple_concertina' },
  };
  for (const [id, ids] of Object.entries(want)) {
    const m = getMission(id);
    for (const [sid, t] of Object.entries(ids)) {
      const s = m.structures.find((q) => q.id === sid);
      assert.ok(s, `${id} ${sid} exists`);
      assert.equal(wireTypeOf(s, { missionId: id }), t, `${id} ${sid}`);
    }
  }
  // M14 uses the full Atlantic-Wall kit: concertina, knife rests, double aprons, triple concertina, hedgehog belts
  const m14 = new Set(getMission('m14').structures.map((s) => wireTypeOf(s, { missionId: 'm14' })).filter(Boolean));
  for (const t of ['concertina', 'knife_rest', 'double_apron', 'triple_concertina', 'hedgehog_belt']) assert.ok(m14.has(t), `m14 has ${t}`);
  for (const v of ['iron_railing', 'iron_railing_kerb', 'wall_brick_railing', 'palisade_plank', 'bullet_stop_timber_sandbag', 'rock_rim']) {
    assert.equal(wireTypeOf({ type: 'fence', variant: v, h: 2 }, { missionId: 'm15' }), null, v);
  }
  // pens: the M17 prisoners' cage, the M19 dog kennel as plain mesh, a non-wire pen untouched
  const pen = (p, mid) => penWireRuns(p, 50, 50, 0.3, { missionId: mid });
  const cage = pen({ id: 'pen', variant: 'wire_cage', w: 17, d: 17.2, h: 2.4, gateSide: 'S', open: 'N', mat: 'wire' }, 'm17');
  assert.equal(cage.length, 2, 'open N side + a gate gap on S → two runs');
  assert.ok(cage.every((o) => o.userData.wireRun.type === 'cage'));
  const len = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  near(cage.reduce((a, o) => a + len(o.userData.wireRun.points), 0), 17.2 * 2 + 17 - 2.4, 1e-6, 'pen wire length');
  assert.equal(pen({ id: 'pen', variant: 'dog_kennel', w: 9, d: 10, h: 2, gateSide: 'W', mat: 'wire' }, 'm19')[0].userData.wireRun.type, 'chainlink');
  assert.equal(pen({ id: 'x', w: 4, d: 4, mat: 'stone' }, 'm17'), null);
  // the M10 belts: a hedgehog tied into every bay of the double apron
  const P = new Parts();
  buildWireRun('double_apron', [[0, 0], [45, 0]], { id: 'belt_w1', type: 'fence', variant: 'wire_on_stakes', h: 1.2, hedgehogEvery: 4.5 }, { parts: P });
  assert.ok(P.counts.hedgehogs >= 9 && P.inst.get('ibeam').length === 3 * P.counts.hedgehogs, `hedgehogs in the belt (${P.counts.hedgehogs})`);
  const K = new Parts();
  buildWireRun('chainlink', [[0, 0], [9, 0]], { id: 'pen', type: 'prison_pen', h: 2, kennel: true }, { parts: K });
  assert.ok(!K.inst.get('angleThin') && !K.inst.get('plate'), 'kennel: no barbed outriggers, no warning plates');
});
