/**
 * LIGHTS OUT e03 art kit (src/art/e03-kit.js), the third verifier round's props:
 *  - the stable's water trough is an OPEN box of boards with its water showing 0.08-0.12 m below the rim — no lid, no
 *    board face over the water, the water's sheet facing up and no other face lying in its plane (z-fighting);
 *  - the hay cart's load is built up past its rack: it bulges out over the side ladders' top rail and over the end
 *    ladders, stays clear of the wheels and inside the cart's length, has broken (not straight) shoulders, and hanks
 *    hang out over the edge below the load's shoulder;
 *  - the puddles ride the drawn ground a real lift above its highest point under them (bumpy ground included), face up,
 *    and carry the ground decals' depth treatment; the ground cover (grass tufts, litter) is kept out of them and their
 *    rim of soaked mud by the mission's render-only `bareGround`;
 *  - the still water (the puddles, the trough) is drawn by its shader: the standard material's chunks it patches are all
 *    there (a three.js upgrade that renamed one would silently give back the flat grey of round 3), one program per kind,
 *    and the trough's sheet carries its board-edge ramp.
 * Everything is the same every load. Run with the unit suite: node tests/unit/run.mjs e03-kit
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { addSmallProp, buildPuddles, puddleOutlines, stillWaterMaterial, PUDDLE_RIM } from '../../src/art/e03-kit.js';
import { Geo, localFrame } from '../../src/art/castle-kit.js';
import { E03_DRESSING, E03_PUDDLES } from '../../src/art/e03-dressing.js';
import { MISSIONS } from '../../src/missions/index.js';

const rng = (seed) => { let x = seed >>> 0 || 1; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; };
const e03 = MISSIONS.find((m) => m.id === 'e03');
const structure = (id) => e03.structures.find((s) => s.id === id) || E03_DRESSING.find((s) => s.id === id);

/** Build one prop alone; its triangles per material in the prop's own frame: [[u, y, w] × 3] (u along, w across). */
function propTris(s) {
  const G = new Geo('test'), F = localFrame(s.x, s.z, s.rot ?? 0);
  assert.ok(addSmallProp(G, s, rng(7)), `${s.variant} is an e03 prop`);
  const toLocal = (x, y, z) => { const dx = x - s.x, dz = z - s.z; return [dx * F.t[0] + dz * F.t[1], y, dx * F.n[0] + dz * F.n[1]]; };
  const out = new Map();
  for (const [mat, A] of G.parts) {
    const T = [];
    for (let i = 0; i < A.pos.length; i += 9) T.push([0, 3, 6].map((o) => toLocal(A.pos[i + o], A.pos[i + o + 1], A.pos[i + o + 2])));
    out.set(mat, T);
  }
  return out;
}
const normalY = ([a, b, c]) => {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return n[1] / (Math.hypot(...n) || 1);
};
const area = ([a, b, c]) => {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
};

test('e03 trough: an open box of boards, its water 0.08-0.12 m under the rim, facing up, nothing lying over or in it', () => {
  const s = structure('trough_stable'), hu = s.w / 2, hw = s.d / 2, rim = s.h;
  const T = propTris(s), water = T.get('e03_water') || [];
  assert.ok(water.length >= 2, 'the trough holds water');
  const wy = water.flat().map((p) => p[1]);
  const yw = wy.reduce((a, b) => a + b, 0) / wy.length;
  assert.ok(Math.max(...wy) - Math.min(...wy) < 1e-6, 'a level sheet');
  assert.ok(rim - yw >= 0.08 && rim - yw <= 0.12, `water ${(rim - yw).toFixed(3)} m under the rim`);
  for (const t of water) assert.ok(normalY(t) > 0.999, 'the water faces up');
  const wArea = water.reduce((a, t) => a + area(t), 0);
  assert.ok(wArea > 0.7 * (s.w - 0.2) * (s.d - 0.25), `the water fills the trough (${wArea.toFixed(2)} m²)`);
  // open: no face of the boards (or anything else) above the water inside the walls' inner line, and none in its plane
  const inner = (p) => Math.abs(p[0]) < hu - 0.12 && Math.abs(p[2]) < hw - 0.16;
  for (const [mat, tris] of T) {
    if (mat === 'e03_water' || mat === 'e03_straw') continue;
    for (const t of tris) {
      const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
      if (inner(c)) assert.ok(c[1] < yw - 0.02, `${mat} face over the water at ${c.map((v) => v.toFixed(2))}`);
      if (Math.abs(normalY(t)) > 0.99 && t.every((p) => Math.abs(p[1] - yw) < 0.004)) assert.fail(`${mat} face in the water's plane`);
    }
  }
  // its boards stand to the rim all round (the long sides' and the ends' tops at the rim or above, ±3 cm)
  const tops = [...T.get('e03_board')].flat().filter((p) => p[1] > rim - 0.05).map((p) => p[1]);
  assert.ok(tops.length >= 8 && Math.min(...tops) >= rim - 0.035, 'the walls reach the rim');
  // the straw floating on it is lifted clear of the sheet (no blade within 1 cm of its plane, flat)
  for (const t of T.get('e03_straw') || []) if (Math.abs(normalY(t)) > 0.95) assert.ok(t.every((p) => Math.abs(p[1] - yw) > 0.01), 'floating straw clear of the water');
});

test('e03 hay cart: the load bulges out past the ladder rails and the end ladders, clear of the wheels, broken shoulders', () => {
  const s = structure('hay_cart'), hu = s.w / 2, hw = s.d / 2;
  const T = propTris(s), straw = (T.get('e03_straw') || []).flat();
  const ladW = (y) => hw - 0.14 + (y - 0.74) * 0.24, endU = (y) => hu - 0.4 + 0.12 * Math.min(1, Math.max(0, (y - 0.74) / 0.71));
  // over the top rail (y 1.6): the load's body (dozens of its surface points, not a stray stalk) out past the rail line
  // by 6 cm or more, all along both sides
  for (const sd of [-1, 1]) {
    const over = straw.filter((p) => p[1] > 1.68 && p[1] < 2.05 && p[2] * sd > ladW(1.6) + 0.06);
    assert.ok(over.length >= 40, `side ${sd}: the load overhangs the top rail (${over.length} points past it)`);
    const us = over.map((p) => p[0]);
    assert.ok(Math.min(...us) < -hu * 0.5 && Math.max(...us) > hu * 0.5, `side ${sd}: all along the cart`);
  }
  // over the end ladders (their top at y 1.45)
  for (const su of [-1, 1]) {
    const over = straw.filter((p) => p[1] > 1.55 && p[1] < 2.0 && p[0] * su > endU(1.45) + 0.06);
    assert.ok(over.length >= 20, `end ${su}: the load overhangs the end ladder (${over.length} points past it)`);
  }
  // clear of the wheels (radius 0.5 at u ±1, w ±(hw + 0.02)): no hay in a wheel's disc slab
  for (const p of straw) for (const wu of [-1, 1]) {
    const dr = Math.hypot(p[0] - wu, p[1] - 0.5);
    if (dr < 0.52 && p[1] > 0.1) assert.ok(Math.abs(p[2]) < hw - 0.03, `hay inside a wheel at ${p.map((v) => v.toFixed(2))}`);
  }
  // the load's body (its surface and its hanks: every face bigger than a stalk's blade) inside the cart's length and no
  // more than a hand past its width (men pass beside it); loose stalks a little further
  const body = (T.get('e03_straw') || []).filter((t) => area(t) > 0.003).flat().filter((p) => p[1] > 0.7);
  assert.ok(Math.max(...body.map((p) => Math.abs(p[0]))) <= hu + 0.15, 'inside the cart\'s length (a hank at most hanging over its ends)');
  assert.ok(Math.max(...body.map((p) => Math.abs(p[2]))) <= hw + 0.36, 'a hand past the cart\'s width at most');
  const load = straw.filter((p) => p[1] > 0.7);
  assert.ok(Math.max(...load.map((p) => Math.abs(p[2]))) <= hw + 0.5 && Math.max(...load.map((p) => Math.abs(p[0]))) <= hu + 0.3, 'loose stalks near the load');
  // broken shoulders: along the side at shoulder height the overhang varies by several centimetres (not one ruler line)
  const band = load.filter((p) => p[1] > 1.75 && p[1] < 1.95 && p[2] > 0 && Math.abs(p[0]) < hu - 0.6).map((p) => p[2]);
  assert.ok(band.length > 20 && Math.max(...band) - Math.min(...band) > 0.06, 'an uneven shoulder');
  // hanks hang out over the edge below the shoulder (straw outside the rail line and lower than 1.6 m)
  assert.ok(straw.some((p) => Math.abs(p[2]) > ladW(1.6) + 0.04 && p[1] < 1.6) || straw.some((p) => Math.abs(p[0]) > endU(1.45) + 0.05 && p[1] < 1.45), 'hanks hang over');
});

test('e03 props and puddles: the same every load', () => {
  for (const id of ['trough_stable', 'hay_cart']) {
    const a = propTris(structure(id)), b = propTris(structure(id));
    assert.equal(JSON.stringify([...a]), JSON.stringify([...b]), id);
  }
  const p1 = buildPuddles(E03_PUDDLES, () => 0), p2 = buildPuddles(E03_PUDDLES, () => 0);
  assert.deepEqual(Array.from(p1.geometry.attributes.position.array), Array.from(p2.geometry.attributes.position.array));
});

test('e03 puddles: a real lift over the highest ground under each vertex, facing up, the ground decals\' depth treatment', () => {
  const bump = (x, z) => 0.05 * Math.sin(x * 3.1) * Math.cos(z * 2.7) + 0.02 * Math.sin(x * 11 + z * 7);
  const lift = 0.06, m = buildPuddles(E03_PUDDLES, bump, { lift });
  const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, S = m.geometry.attributes.aSw;
  assert.ok(P.count > E03_PUDDLES.length * 50, 'every puddle drawn');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) hi = Math.max(hi, bump(x + dx, z + dz));
    assert.ok(y - hi >= lift - 0.012, `vertex ${i} only ${(y - hi).toFixed(3)} m over the ground`);
  }
  const ups = Array.from({ length: P.count }, (_, i) => N.getY(i));
  assert.ok(Math.min(...ups) > 0.9, 'facing up');
  // the shader's own coordinate: r 0 in the middle, 1 at the nominal outline, up to 2 at the rim band's outer ring
  assert.equal(S.itemSize, 3, 'aSw: (r, seed, 0)');
  const rs = Array.from({ length: S.count }, (_, i) => S.getX(i));
  assert.equal(Math.min(...rs), 0); assert.ok(Math.abs(Math.max(...rs) - 2) < 1e-6, 'the rim band out to r = 2');
  assert.ok(rs.filter((r) => r > 1).length >= rs.filter((r) => r > 0 && r <= 1).length / 3, 'a rim of soaked mud round every water');
  const mat = m.material;
  assert.ok(mat.transparent && mat.depthWrite === false && mat.polygonOffset && mat.polygonOffsetFactor < 0, 'decal depth treatment');
  assert.ok(m.renderOrder < 0 && m.userData.aoExclude, 'drawn before the other transparent things, out of the AO prepass');
  // every puddle stands on the open ground: none under a blocking prop or structure of the mission
  const boxes = [...e03.structures, ...E03_DRESSING].filter((s) => s.w && s.d && s.block);
  for (const [x, z, a, b] of E03_PUDDLES) for (const s of boxes) {
    const F = localFrame(s.x, s.z, s.rot ?? 0), dx = x - s.x, dz = z - s.z, u = dx * F.t[0] + dz * F.t[1], w = dx * F.n[0] + dz * F.n[1];
    assert.ok(Math.abs(u) > s.w / 2 + 0.1 || Math.abs(w) > s.d / 2 + 0.1, `puddle at ${x},${z} under ${s.id}`);
  }
});

test('e03 puddles: no grass tuft or litter stands up through the water — every puddle lies in the mission\'s bareGround', () => {
  const inside = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const P = buildPuddles(E03_PUDDLES, () => 0).geometry.attributes.position;
  const bare = e03.bareGround.map((b) => b.points || b);
  const covered = (polys) => { let n = 0; for (let i = 0; i < P.count; i++) if (polys.some((Q) => inside(P.getX(i), P.getZ(i), Q))) n++; return n; };
  assert.equal(covered(bare), P.count, 'every puddle vertex (the water and its rim) inside a bareGround polygon');
  // the outlines reach a little past the rim (no tuft at its very edge), and without them the puddles are not covered
  const outl = puddleOutlines(E03_PUDDLES);
  assert.ok(outl.length > E03_PUDDLES.length && outl.every((Q) => Q.length >= 12), 'an outline per puddle and satellite');
  assert.ok(covered(bare.filter((Q) => !outl.some((O) => O === Q || JSON.stringify(O) === JSON.stringify(Q)))) < P.count * 0.05, 'negative control: the other bare ground does not cover them');
});

test('e03 still water: the shader patches every chunk it needs, one program per kind; the trough sheet ramps from the boards', () => {
  for (const kind of ['puddle', 'trough']) {
    const m = stillWaterMaterial(kind);
    const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}, defines: {} };
    m.onBeforeCompile(sh);
    for (const needle of ['vSwW = (modelMatrix', 'vSwP =']) assert.ok(sh.vertexShader.includes(needle), `${kind}: vertex ${needle}`);
    for (const needle of ['float swRip(', 'diffuseColor.rgb = mix(swMud, swBody, swWater)', 'float roughnessFactor = mix(0.42, 0.9, swWater)',
      'outgoingLight = outgoingLight * (1.0 - swFr) + swSky * swFr']) assert.ok(sh.fragmentShader.includes(needle), `${kind}: fragment ${needle}`);
    // the sky goes in just before the output, after the lights (so the sun and its shadows reach the water's body)
    assert.ok(sh.fragmentShader.indexOf('swSky * swFr') < sh.fragmentShader.indexOf('#include <opaque_fragment>'));
    assert.ok(sh.fragmentShader.indexOf('swSky * swFr') > sh.fragmentShader.indexOf('#include <lights_fragment_end>'));
    assert.equal('SW_TROUGH' in sh.defines, kind === 'trough');
    assert.equal(m.transparent, kind === 'puddle');
  }
  assert.notEqual(stillWaterMaterial('puddle').customProgramCacheKey(), stillWaterMaterial('trough').customProgramCacheKey());
  // the trough's sheet: its uv.x 0 on the outer ring of vertices (along the boards), 1 inside it (Geo divides by 1.6)
  const G = new Geo('test'), s = structure('trough_stable');
  addSmallProp(G, s, rng(7));
  const A = G.parts.get('e03_water');
  const us = A.uv.filter(Boolean).map((u) => u[0] / 1.6);
  assert.ok(us.length === A.pos.length / 3, 'every water vertex carries its ramp');
  assert.ok(us.some((u) => u === 0) && us.some((u) => u === 1) && us.every((u) => u === 0 || u === 1), 'edge 0, inside 1');
  assert.ok(PUDDLE_RIM > 0.2 && PUDDLE_RIM < 0.5, 'the rim band a hand or two wide');
});
