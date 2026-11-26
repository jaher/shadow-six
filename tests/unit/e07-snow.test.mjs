/**
 * LIGHTS OUT e07 "White Out": the snow on the ridge face (src/art/e07-kit.js faceSnowG) and the ground material it is
 * drawn with (src/art/e07-snow.js). The face's snow is the map's ground snow laid over its own surface coordinates, so
 * its texture stands on a pillow's front and a fan's steep face; the ledge pillows are broken runs, not tubes, modelled
 * by their own light (a top in the sky, a lip and an underside in shade, each pillow a tone of its own); the foot is never
 * a clean straight crease (plaster on the rock's toe, pillows, fans with aprons, the drift's toe in lobes), and nothing of
 * it but a low spill a few centimetres thick crosses the walkable edge (x 104.6: the team crawls along it); the sluffs'
 * debris is rounded (snowballs and lumpy clods, no brick edges); the soft normals are creaseNormals' own, sliced.
 * Run with the unit suite: node tests/unit/run.mjs e07-snow
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { Geo } from '../../src/art/castle-kit.js';
import { creaseNormals } from '../../src/art/round-roofs.js';
import { faceSnow, footSurfaceAt } from '../../src/art/e07-kit.js';
import { unfoldShader, UNFOLD_ANCHORS } from '../../src/art/e07-snow.js';
import { E07_RIDGE, softNormalsG } from '../../src/art/e07-dressing.js';
import { runSync } from '../../src/engine/slice.js';
import { VERT_PARS, VERT_MAIN, VERT_WORLD, COMMON, FRAG_MAIN } from '../../src/art/terrain/terrain-glsl.js';

/** The ground shader as terrainMaterial builds it (the anchors this variant rewrites stand in master's own strings). */
const groundShader = () => ({
  vertexShader: `${VERT_PARS}void main() {\n#include <begin_vertex>\n${VERT_MAIN}\n#include <worldpos_vertex>\n${VERT_WORLD}}`,
  fragmentShader: `${COMMON}void main() {\n${FRAG_MAIN}}`,
});

const WALK = 104.6, APRON_MAX = 0.03 + 0.035; // (faceSnowG: apronT + 3.5 cm)
let built = null;
/** The two halves of the face's snow, built once (the dressing's own options; the ground level), and the foot's rows. */
function snow() {
  if (built) return built;
  const { footX, rimX, snow: o } = E07_RIDGE, out = { footOut: {} };
  for (const part of ['ledges', 'foot']) {
    const G = new Geo(part);
    faceSnow(G, footX, rimX, { ...o, part, ground: () => 0, ...(part === 'foot' ? { footOut: out.footOut } : {}) });
    out[part] = G;
  }
  return (built = out);
}
/** Each triangle of a finish: its face normal and its corners' light terms ([ao, shade, wrap] × 3). */
function tris(G, mat) {
  const A = G.parts.get(mat), P = A.pos, E = A.e, out = [];
  for (let t = 0; t < P.length / 9; t++) {
    const u = [P[t * 9 + 3] - P[t * 9], P[t * 9 + 4] - P[t * 9 + 1], P[t * 9 + 5] - P[t * 9 + 2]];
    const v = [P[t * 9 + 6] - P[t * 9], P[t * 9 + 7] - P[t * 9 + 1], P[t * 9 + 8] - P[t * 9 + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
    out.push({ n: n.map((q) => q / l), e: E ? E.slice(t * 9, t * 9 + 9) : null, uv: A.uv[t * 3], z: P[t * 9 + 2] });
  }
  return out;
}
/** [x, y, z] of every vertex of a finish's triangles, with its surface coordinates [U, V]. */
function verts(G, mat) {
  const A = G.parts.get(mat), out = [];
  for (let i = 0; i < A.pos.length / 3; i++) out.push({ x: A.pos[i * 3], y: A.pos[i * 3 + 1], z: A.pos[i * 3 + 2], uv: A.uv[i] });
  return out;
}

test('e07 snow: the ground shader is read on the surface coordinates, the splat and the prints where the point stands', () => {
  const sh = unfoldShader(groundShader(), 3);
  const f = sh.fragmentShader;
  assert.ok(sh.vertexShader.includes('vUnf = uv * 3.000000;'), 'the vertex shader passes the uv on (× its tile)');
  assert.equal((f.match(/vWPos\.xz/g) || []).length, 1, 'one world x/z read is left');
  assert.ok(f.includes(UNFOLD_ANCHORS.tuv), 'and it is the splat / trail lookup');
  assert.ok(f.includes('vec2 p = vec2(vUnf.x, -vUnf.y);'), 'the layers are read on the unfolded coordinates');
  assert.ok(f.includes('dFdx(vWPos)') && !f.includes('normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);\nvec3 Bg = cross(Ng, Tg);'), 'the tangent frame follows them');
  assert.ok(f.includes('uniform float uE07Wrap;') && f.includes('sS = uE07Wrap'), 'steep snow wraps its light (per material)');
  assert.ok(f.includes('albT *= 1.0 + uE07Wrap'), 'and has its grain');
  // (negative control: master's shader without an anchor is refused, not silently drawn the old way)
  const broken = groundShader();
  broken.fragmentShader = broken.fragmentShader.replace(UNFOLD_ANCHORS.p, 'vec2 p = vWPos.xz;');
  assert.throws(() => unfoldShader(broken, 3), /anchor/);
});

test('e07 snow: the same snow every load, finite, every triangle on its own surface coordinates', () => {
  const a = snow(), { footX, rimX, snow: o } = E07_RIDGE;
  const G = new Geo('again');
  faceSnow(G, footX, rimX, { ...o, part: 'foot', ground: () => 0 });
  const p0 = a.foot.parts.get('e07Snow').pos, p1 = G.parts.get('e07Snow').pos;
  assert.equal(p0.length, p1.length);
  for (let i = 0; i < p0.length; i += 97) assert.equal(p0[i], p1[i]);
  for (const part of ['ledges', 'foot']) for (const [mat, A] of a[part].parts) {
    assert.ok(A.pos.length > 0, `${part} ${mat}: drawn`);
    assert.ok(A.pos.every(Number.isFinite), `${part} ${mat}: finite`);
    assert.ok(A.uv.every((uv) => uv && Number.isFinite(uv[0]) && Number.isFinite(uv[1])), `${part} ${mat}: every vertex has its surface coordinates`);
  }
});

test('e07 snow: across the walkable edge only the low spill (fans\' aprons, the drift\'s own), a few centimetres up; the clods stay behind it', () => {
  const { foot } = snow();
  let apron = 0;
  for (const v of verts(foot, 'e07Snow')) {
    if (v.x >= WALK) continue;
    assert.ok(v.y <= APRON_MAX + 1e-6, `snow ${v.y.toFixed(3)} m up at x ${v.x.toFixed(2)}, z ${v.z.toFixed(2)} over the walkable snow`);
    if (v.y > 0.005) apron++;
  }
  assert.ok(apron > 100, 'the fans and the banked drift spill out over it');
  for (const v of verts(foot, 'e07SnowChunk')) assert.ok(v.x >= WALK, `a chunk at x ${v.x.toFixed(3)}, z ${v.z.toFixed(2)}`);
});

test('e07 snow: the foot is never a clean crease — the snow\'s top at the rock changes by 8 cm or more in every 4 m', () => {
  const top = new Map();
  for (const v of verts(snow().foot, 'e07Snow')) {
    if (v.z < 0 || v.z > 200) continue;
    const k = Math.round(v.z * 4);
    top.set(k, Math.max(top.get(k) ?? 0, v.y));
  }
  for (let k = 0; k + 16 <= 800; k += 2) {
    let lo = Infinity, hi = -Infinity;
    for (let j = k; j <= k + 16; j++) { const h = top.get(j) ?? 0; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    assert.ok(hi - lo >= 0.08, `z ${k / 4}-${k / 4 + 4}: the snow line holds within ${(hi - lo).toFixed(3)} m`);
  }
});

test('e07 snow: the ledge pillows are runs of 0.45-3.3 m with the rock showing between them', () => {
  const byLedge = new Map();
  for (const v of verts(snow().ledges, 'e07Snow')) {
    const k = Math.floor((v.uv[0] - 1000) / 37.3 + 1e-6);
    if (!byLedge.has(k)) byLedge.set(k, new Set());
    byLedge.get(k).add(Math.round(v.z * 1000));
  }
  let runs = 0, broken = 0;
  for (const zs of byLedge.values()) {
    const z = [...zs].sort((a, b) => a - b).map((q) => q / 1000);
    let start = z[0], n = 1;
    for (let i = 1; i <= z.length; i++) {
      if (i === z.length || z[i] - z[i - 1] > 0.18) {
        const len = z[i - 1] - start;
        assert.ok(len <= 3.31, `a run of ${len.toFixed(2)} m`);
        if (i < z.length) { n++; start = z[i]; }
      }
    }
    runs += n; if (n > 1) broken++;
  }
  assert.ok(byLedge.size >= 40, `${byLedge.size} ledges`);
  assert.ok(runs >= 2 * byLedge.size && broken >= 0.8 * byLedge.size, `${runs} runs on ${byLedge.size} ledges, ${broken} broken`);
});

test('e07 snow: a big fan\'s top is a ragged shoulder, not a lone apex', () => {
  const top = new Map();
  for (const v of verts(snow().foot, 'e07Snow')) { const k = Math.round(v.z * 4); top.set(k, Math.max(top.get(k) ?? 0, v.y)); }
  let big = 0;
  for (const [gz] of E07_RIDGE.face.gullies) {
    const ks = [];
    for (let k = Math.round((gz - 4) * 4); k <= Math.round((gz + 4) * 4); k++) ks.push([k / 4, top.get(k) ?? 0]);
    const mx = Math.max(...ks.map((q) => q[1]));
    if (mx < 1) continue;
    big++;
    const at = ks.find((q) => q[1] === mx)[0], near = ks.filter((q) => Math.abs(q[0] - at) <= 1.5);
    const frac = near.filter((q) => q[1] >= 0.75 * mx).length / near.length;
    assert.ok(frac >= 0.4, `the fan at z ${gz}: its top (${mx.toFixed(2)} m at z ${at}) stands alone (${(frac * 100).toFixed(0)} % of ±1.5 m within a quarter of it)`);
  }
  assert.ok(big >= 5, `${big} big fans`);
});

test('e07 snow: a big fan\'s toe is broken by its debris — no metre of it bare along the middle of the fan', () => {
  // (the rock's foot row holds the fan's toe to the walkable edge, so it cannot wander: its coarsest debris lies along it)
  const { foot } = snow(), { footX, face } = E07_RIDGE, top = new Map(), near = new Set();
  for (const v of verts(foot, 'e07Snow')) {
    if (v.uv[0] >= 200) continue; // (the drift's and the fans' rows only: the plaster's coordinates start at 300)
    const k = Math.round(v.z * 4);
    top.set(k, Math.max(top.get(k) ?? 0, v.y));
  }
  for (const v of verts(foot, 'e07SnowChunk')) if (v.x - Math.max(104.66, footX(v.z) - 0.08) < 0.5) near.add(Math.round(v.z * 4));
  let big = 0;
  for (const [gz, gw] of face.gullies) {
    const k0 = Math.round((gz - gw / 2) * 4), k1 = Math.round((gz + gw / 2) * 4);
    let mx = 0, run = 0, bare = 0;
    for (let k = k0; k <= k1; k++) { mx = Math.max(mx, top.get(k) ?? 0); run = near.has(k) ? 0 : run + 1; bare = Math.max(bare, run); }
    if (mx < 0.75) continue;
    big++;
    assert.ok(bare / 4 <= 1, `the fan at z ${gz} (${mx.toFixed(2)} m): ${(bare / 4).toFixed(2)} m of its toe without debris`);
  }
  assert.ok(big >= 5, `${big} big fans`);
});

test('e07 snow: the drift\'s toe is no ruled line — in every 2 m of the foot it strays 2.5 cm or more from a straight one', () => {
  // (the toe is the crease the eye follows along the foot: in lobes 0.8-1.3 m apart over a finer wander, eased off the
  // walkable edge and off the rock — row index 6 is the toe, after the spill's six stations)
  const { rows, z0, dz } = snow().footOut, { footX } = E07_RIDGE;
  let worst = Infinity, at = 0;
  for (let i = 0; i + 8 < rows.length; i++) {
    const zs = [], xs = [];
    for (let j = i; j <= i + 8; j++) { zs.push(z0 + j * dz); xs.push(rows[j][6][0]); }
    if (zs[0] < 0 || zs[8] > 200) continue;
    const mz = zs.reduce((a, b) => a + b) / 9, mx = xs.reduce((a, b) => a + b) / 9;
    let sxy = 0, sxx = 0;
    for (let k = 0; k < 9; k++) { sxy += (zs[k] - mz) * (xs[k] - mx); sxx += (zs[k] - mz) ** 2; }
    const b = sxy / sxx;
    let dev = 0;
    for (let k = 0; k < 9; k++) dev = Math.max(dev, Math.abs(xs[k] - (mx + b * (zs[k] - mz))));
    if (dev < worst) { worst = dev; at = zs[0]; }
  }
  assert.ok(worst >= 0.025, `z ${at}-${at + 2}: the toe holds within ${(worst * 100).toFixed(1)} cm of a line`);
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i][6][0], z = z0 + i * dz;
    assert.ok(x >= 104.66 && x <= footX(z) - 0.02, `the toe at z ${z.toFixed(2)}: x ${x.toFixed(3)} (walkable edge 104.6, rock ${footX(z).toFixed(3)})`);
  }
});

test('e07 snow: the foot as built is what footSurfaceAt reads back (the scoop draped on it)', () => {
  const F = snow().footOut, at = footSurfaceAt(F);
  let n = 0;
  for (let i = 40; i < F.rows.length - 40; i += 37) {
    const z = F.z0 + i * F.dz;
    for (const j of [2, 4, 7, 9]) {
      const [x, y] = F.rows[i][j];
      if (!(F.rows[i][j + 1][0] > x)) continue;
      assert.ok(Math.abs(at(x, z) - y) < 1e-6, `z ${z.toFixed(2)} x ${x.toFixed(3)}: ${at(x, z)} vs ${y}`);
      n++;
    }
  }
  assert.ok(n > 40, `${n} points`);
  assert.equal(at(103.0, 50), -Infinity, 'nothing past the spill\'s toe');
});

test('e07 snow: the sluffs\' debris is rounded — snowballs and lumpy clods, no brick edges', () => {
  const C = tris(snow().foot, 'e07SnowChunk'), P = snow().foot.parts.get('e07SnowChunk').pos;
  const key = (i) => `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`;
  const edges = new Map();
  for (let t = 0; t < C.length; t++) {
    const k = [key(t * 3), key(t * 3 + 1), key(t * 3 + 2)];
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) { const e = [k[p], k[q]].sort().join('|'); (edges.get(e) ?? edges.set(e, []).get(e)).push(t); }
  }
  const ang = [];
  for (const ts of edges.values()) {
    if (ts.length !== 2) continue;
    const [a, b] = ts.map((t) => C[t].n), d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    ang.push((Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI);
  }
  ang.sort((a, b) => a - b);
  const sharp = ang.filter((a) => a > 60).length / ang.length;
  assert.ok(C.length > 3000 && ang.length > 3000, `${C.length} clod triangles`);
  // (a box has two thirds of its shared edges at 90°; a lumpy ball turns a few tens of degrees from face to face)
  assert.ok(ang[ang.length >> 1] < 30, `median turn between neighbouring faces ${ang[ang.length >> 1].toFixed(1)}°`);
  assert.ok(sharp < 0.1, `${(sharp * 100).toFixed(1)} % of the clods' edges turn more than 60°`);
});

test('e07 snow: a ledge pillow is modelled by its own light — a top in the sky, its lip and underside in shade, a tone of its own', () => {
  const T = tris(snow().ledges, 'e07Snow'), top = [], under = [], tone = new Map();
  for (const t of T) {
    assert.ok(t.e && t.e.every(Number.isFinite), 'every corner has its light terms');
    const ao = (t.e[0] + t.e[3] + t.e[6]) / 3;
    if (t.n[1] > 0.7) top.push(ao); else if (t.n[1] < -0.5) under.push(ao);
    // (a run's tone: its corners' shade term less the station's own — pillows are told apart by their surface coordinate)
    const run = `${Math.floor((t.uv[0] - 1000) / 37.3 + 1e-6)}:${Math.round(t.z)}`;
    if (!tone.has(run)) tone.set(run, []);
    tone.get(run).push(t.e[1]);
  }
  const mean = (q) => q.reduce((a, b) => a + b, 0) / q.length;
  assert.ok(top.length > 1000 && under.length > 1000, `${top.length} top and ${under.length} underside triangles`);
  assert.ok(mean(top) >= 0.9, `the tops keep the sky: ao ${mean(top).toFixed(2)}`);
  assert.ok(mean(under) <= 0.55, `the undersides are in shade: ao ${mean(under).toFixed(2)}`);
  const means = [...tone.values()].filter((q) => q.length > 20).map(mean), m = mean(means);
  const sd = Math.sqrt(mean(means.map((v) => (v - m) ** 2)));
  assert.ok(means.length > 100 && sd >= 0.02, `${means.length} pillow spans, their tones spread ${sd.toFixed(3)}`);
});

test('e07 snow: softNormalsG gives creaseNormals\' very normals (sliced, hashed), bit for bit', () => {
  const P = snow().foot.parts.get('e07Snow').pos, n = Math.min(P.length, 9 * 20000);
  const pos = new Float32Array(P.slice(0, n));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const ref = creaseNormals(geo, 80).getAttribute('normal').array, got = runSync(softNormalsG(pos, 80));
  assert.equal(got.length, ref.length);
  let diff = 0;
  for (let i = 0; i < ref.length; i++) if (got[i] !== ref[i]) diff++;
  assert.equal(diff, 0, `${diff} of ${ref.length} normal components differ`);
});
