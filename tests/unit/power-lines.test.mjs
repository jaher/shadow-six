/**
 * Power lines / telegraph wires / cable-car ropes meet their towers (user report, M3: "The power lines dont line up
 * exactly with the power towers"). Every conductor is drawn between the fixing nodes (`cable:<k>`) the models carry at
 * their insulators (art/cable-attach.js), so: the nodes sit where the models' insulators / clamps / shoes are
 * (measured on the geometry), each tower carries as many conductors as it has insulators, the pairing never crosses
 * wires, and on every mission's lines (Node build of its poles + furniture) each drawn end lies ≤ 2 cm from its node.
 * Browser side (the real game, every mission): tests/power-lines.test.mjs.
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { cableNodes, cablePoints, pairConductors, conductorSpans, measureCableEnds } from '../../src/art/cable-attach.js';
import { buildLattice, buildPole, PYLON_STRING, POLE_INSULATORS } from '../../src/art/dressing.js';
import { buildProp } from '../../src/art/props.js';
import { buildFurniture } from '../../src/art/furniture/index.js';
import { expandFurniture, normalizeRoadNetwork } from '../../src/world/roads.js';
import { buildCableLine, CABLE_CAR_ROPES } from '../../src/art/kit-vehicles.js';
import { MISSIONS } from '../../src/missions/index.js';

const GAP = 0.02;
const meshes = (o) => { const out = []; o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };
const worldVerts = (m) => { m.updateWorldMatrix(true, false); const P = m.geometry.attributes.position, out = []; for (let i = 0; i < P.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld)); return out; };
const hill = (x, z) => 1.5 + 0.8 * Math.sin(x * 0.11) + 0.6 * Math.cos(z * 0.07);

test('pylon: one fixing node in the clamp at the foot of each suspension string, under its tip tie', () => {
  const g = buildLattice({ h: 18 });
  const N = cableNodes(g);
  assert.equal(N.length, 4, 'two arm levels × two strings');
  const [steel, glass] = meshes(g);
  assert.ok(steel && glass && glass.material.name === 'dressing:insulator' && !glass.castShadow);
  const S = worldVerts(steel), D = worldVerts(glass);
  for (const n of N) {
    const p = n.getWorldPosition(new THREE.Vector3());
    // the clamp box (0.08 × 0.1 × 0.32) is centred on the node: the steel vertices within its half extents
    const box = new THREE.Box3();
    for (const v of S) if (Math.abs(v.x - p.x) <= 0.0401 && Math.abs(v.y - p.y) <= 0.0501 && Math.abs(v.z - p.z) <= 0.1601) box.expandByPoint(v);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    assert.ok(c.distanceTo(p) < 1e-3, `clamp centred on ${n.name}: ${c.toArray()} vs ${p.toArray()}`);
    near(sz.z, 0.32, 1e-3, `${n.name} clamp along the line`);
    // the string: glass discs straight above the clamp, up to the arm
    const discs = D.filter((v) => Math.hypot(v.x - p.x, v.z - p.z) <= PYLON_STRING.discR + 1e-3 && v.y > p.y);
    assert.ok(discs.length >= PYLON_STRING.discs * 8, `${n.name}: insulator discs above it (${discs.length})`);
    const top = Math.max(...discs.map((v) => v.y));
    assert.ok(top - p.y > 0.8 && top - p.y < PYLON_STRING.len, `${n.name}: string length ${top - p.y}`);
    // the tie the string hangs from: steel across both chords right above the string
    assert.ok(S.some((v) => Math.abs(v.x - p.x) < 0.04 && v.y > p.y + PYLON_STRING.len - 0.01 && v.y < p.y + PYLON_STRING.len + 0.06), `${n.name}: hook tie`);
    assert.equal(n.userData.cableR, PYLON_STRING.conductorR);
  }
  // radio masts / crane towers have no arms: no conductors
  assert.equal(cableNodes(buildLattice({ h: 20 }, { arms: false })).length, 0);
});

test('telegraph pole: n pin insulators for n wires, each wire in the groove under its crown', () => {
  for (const n of [1, 2, 3, 4]) {
    const g = buildPole({ h: 6.5, wires: n });
    const N = cableNodes(g), glass = meshes(g).find((m) => m.material.name === 'dressing:insulator');
    assert.equal(N.length, n);
    const V = worldVerts(glass);
    assert.equal(V.length, n * new THREE.CylinderGeometry(0.035, 0.05, 0.12, 6).attributes.position.count, `${n} insulators drawn`);
    for (const node of N) {
      const p = node.getWorldPosition(new THREE.Vector3());
      const mine = V.filter((v) => Math.hypot(v.x - p.x, v.z - p.z) < 0.06);
      const crown = Math.max(...mine.map((v) => v.y));
      assert.ok(mine.length > 0 && crown - p.y > 0 && crown - p.y <= 0.03, `${node.name}: ${crown - p.y} below the crown`);
    }
  }
  assert.equal(cableNodes(buildPole({ h: 7 })).length, POLE_INSULATORS.length);
  // the low-detail placeholder pole (no dressing) still has its fixings on the bar ends
  assert.equal(cableNodes(buildProp('telegraph_pole', { x: 0, z: 0, h: 7 }, { library: false }).object3d).length, 2);
});

test('pairing: same side and level on both towers, whatever their yaw; uneven counts pair the nearest', () => {
  const tower = (x, z, yaw, pts) => pts.map(([lx, y]) => [x + lx * Math.cos(yaw), y, z + lx * Math.sin(yaw)]);
  const L = [[-3.25, 11.8], [3.25, 11.8], [-2.45, 13.6], [2.45, 13.6]];
  const A = tower(0, 0, Math.PI / 2, L);           // line along +x, arms along z
  for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI / 2 + 0.3]) {
    const B = tower(40, 0, yaw, L), P = pairConductors(A, B);
    assert.equal(P.length, 4);
    for (const [i, j] of P) {
      assert.ok(Math.abs(A[i][1] - B[j][1]) < 1e-9, 'same level');
      assert.ok(Math.sign(A[i][2]) === Math.sign(B[j][2]), `same side (yaw ${yaw})`);
    }
  }
  // 2 wires to a 4-insulator tower: the two nearest across the span (outer pair at ±0.65, not the inner ±0.49)
  const P = pairConductors(tower(0, 0, Math.PI / 2, [[-0.62, 6], [0.62, 6]]), tower(30, 0, Math.PI / 2, L.map(([x]) => [x * 0.2, 6])));
  assert.deepEqual(P, [[0, 0], [1, 1]]);
  assert.deepEqual(pairConductors([], A), []);
});

test('M3 pylons: four conductors a span, each end in its clamp, on seated, turned, lifted towers; a real sag', () => {
  const m03 = MISSIONS.find((m) => m.id === 'm03');
  const parent = new THREE.Group(); parent.position.set(0, 0.35, 0);   // a lifted props root
  const poles = m03.structures.filter((s) => s.type === 'telegraph_pole').map((def) => {
    const object3d = buildProp('telegraph_pole', def, { theater: 'snow' }).object3d;
    object3d.position.y = hill(def.x, def.z);
    parent.add(object3d);
    return { def, object3d };
  });
  assert.equal(poles.length, 3);
  const F = buildFurniture({ items: [], lines: [] }, { groundAt: hill, poles });
  assert.equal(F.stats.wireSpans, 8, 'two spans × four conductors');
  const ends = measureCableEnds(F.group);
  assert.equal(ends.length, 16);
  for (const e of ends) assert.ok(e.gap <= GAP, `${e.node} ${e.end}: gap ${e.gap.toFixed(4)} m`);
  // every insulator of every tower carries a conductor
  const used = new Set(ends.map((e) => e.at.map((v) => v.toFixed(3)).join()));
  for (const p of poles) for (const q of cablePoints(p.object3d)) assert.ok(used.has(q.p.map((v) => v.toFixed(3)).join()), `${p.def.id} ${q.node.name} wired`);
  // the conductors sag between the clamps: mid-span ≥ 0.5 m under the chord (30–40 m spans)
  const wires = F.group.getObjectByName('furniture:wires'), P = wires.geometry.attributes.position, G = wires.geometry.userData.spans;
  for (const [a, b] of G.ends) {
    let low = Infinity;
    for (let i = a; i < b; i++) low = Math.min(low, P.getY(i));
    assert.ok(low < (P.getY(a) + P.getY(b)) / 2 - 0.5, `sag ${(P.getY(a) + P.getY(b)) / 2 - low}`);
  }
  F.dispose();
});

test('every mission: each telegraph / power line conductor ends ≤ 2 cm from its insulator (Node build of the lines)', () => {
  const report = [];
  for (const def of MISSIONS) {
    const theater = def.theater || 'temperate';
    const poles = (def.structures || []).filter((s) => s.type === 'telegraph_pole' && s.wireTo !== undefined).map((d) => {
      const object3d = buildProp('telegraph_pole', d, { theater }).object3d;
      object3d.position.y = hill(d.x, d.z);
      return { def: d, object3d };
    });
    const F = expandFurniture(normalizeRoadNetwork(def));
    if (!poles.length && !F.lines.length) continue;
    const B = buildFurniture(F, { groundAt: hill, poles });
    const ends = measureCableEnds(B.group), worst = Math.max(0, ...ends.map((e) => e.gap));
    report.push(`${def.id}: ${ends.length / 2} spans, worst ${(worst * 100).toFixed(2)} cm`);
    for (const e of ends) assert.ok(e.gap <= GAP, `${def.id} ${e.mesh} span ${e.span} ${e.end}: ${e.gap.toFixed(4)} m`);
    // conductors = insulators: a road line's poles carry exactly its wires, a wired structure pair as many as its towers
    for (const line of F.lines) assert.ok(line.poles.every((p) => p.fix.length === line.wires), `${def.id}: ${line.wires} insulators a pole`);
    const byId = new Map(poles.map((p) => [p.def.id, p]));
    const expect = F.lines.reduce((s, l) => s + (l.poles.length - 1) * l.wires, 0) + poles.reduce((s, p) => {
      const to = byId.get(p.def.wireTo);
      return s + (to ? Math.min(cableNodes(p.object3d).length, cableNodes(to.object3d).length) : 0);
    }, 0);
    assert.equal(B.stats.wireSpans || 0, expect, `${def.id}: one conductor per insulator pair`);
    B.dispose();
  }
  assert.ok(report.length >= 9, report.join('\n'));
  assert.ok(report.some((r) => r.startsWith('m03:')));
});

test('cable car: the ropes lie in the portal shoes (portal across the line)', () => {
  const R = CABLE_CAR_ROPES, track = [{ x: 41, z: 91, y: 0.5 }, { x: 62.5, z: 49, y: 16.5 }];
  const line = buildCableLine(track, () => 0.2);
  const ends = measureCableEnds(line);
  assert.equal(ends.length, 6, 'two track ropes + the haul rope');
  for (const e of ends) assert.ok(e.gap <= GAP, `${e.node} ${e.end}: ${e.gap}`);
  const ux = 21.5, uz = -42, L = Math.hypot(ux, uz);
  const portals = [];
  line.traverse((o) => { if (cableNodes(o).length === 3 && o !== line && o.children.length) portals.push(o); });
  assert.equal(portals.length, 2);
  for (const p of portals) {
    const [a, b, haul] = cablePoints(p).map((q) => new THREE.Vector3(...q.p));
    const across = b.clone().sub(a);
    near(Math.abs(across.x * ux + across.z * uz) / L, 0, 1e-6, 'track ropes side by side across the line');
    near(across.length(), 2 * R.gauge, 1e-6);
    near(a.y - haul.y, R.track - R.haul, 1e-6, 'haul rope under the track ropes');
    // a shoe (0.16 across × 0.7 along) right under each track rope, its top 1 cm above the rope's underside
    const steel = [];
    for (const m of meshes(line)) if (m.name !== 'kit:cable_ropes') steel.push(...worldVerts(m));
    for (const r of [a, b]) {
      const top = steel.filter((v) => Math.abs(v.y - (r.y - R.trackR + 0.01)) < 1e-3 && Math.abs(((v.x - r.x) * -uz + (v.z - r.z) * ux) / L) <= 0.0801
        && Math.abs(((v.x - r.x) * ux + (v.z - r.z) * uz) / L) <= 0.3501);
      const corners = new Set(top.map((v) => `${v.x.toFixed(3)},${v.z.toFixed(3)}`));
      assert.equal(corners.size, 4, 'the shoe\'s top face right under the rope');
    }
  }
});
