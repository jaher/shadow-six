/**
 * The LIGHTS OUT missions' line extras (world/line-extras-expansion.js): keyed by expansion missions only and served by
 * lineExtrasFor (the base table, world/line-extras.js, keeps the 21 base missions); every fan and trodden line lies on
 * its map with a recipe / kind the painters know and values in range; what the road look paints from them is
 * deterministic. e03's pens: the fills and fans paint the paddock's, the kennel yard's and the hens' run's look (spring
 * mud from rail to rail — none of the base ground's dry cracked clay left showing inside the rails — with drier trodden
 * ground drifting through the paddock and the kennel yard in broad patches, the mud spilling past the paddock's rails in
 * tongues, a strip of grass along them) while the ground the game reads stays the mission's `ground` rects, and the
 * gameplay splat painter (terrainPainter) and the nav grid's codes never read them.
 */
import { test, assert } from './lib.mjs';
import { EXPANSION_LINE_EXTRAS } from '../../src/world/line-extras-expansion.js';
import { LINE_EXTRAS, lineExtrasFor } from '../../src/world/line-extras.js';
import { lookRecipeNames, normalizeRoadNetwork, RoadIndex, roadLookPainter, terrainPainter, pretrampleRoads } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';

const byId = new Map(MISSIONS.map((m) => [m.id, m]));
const KINDS = new Set(['foot', 'boot', 'drag', 'cart', 'vehicle', 'tracked', 'sled']);
const LAYERS = ['grass', 'grassdry', 'dirt', 'mud', 'gravel', 'road', 'leaves', 'wetsand'];   // the temperate palette's
const inside = (p, W, D) => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= D;

test('expansion line extras: keyed by LIGHTS OUT missions only, served by lineExtrasFor; the base table keeps its own', () => {
  for (const id of Object.keys(EXPANSION_LINE_EXTRAS)) {
    assert.ok(/^e\d\d$/.test(id) && byId.has(id), `unknown expansion mission ${id}`);
    assert.ok(!Object.prototype.hasOwnProperty.call(LINE_EXTRAS, id), `${id} in both tables`);
    assert.equal(lineExtrasFor(id), EXPANSION_LINE_EXTRAS[id]);
  }
  for (const id of Object.keys(LINE_EXTRAS)) assert.ok(/^m\d\d$/.test(id), `${id} in the base table`);
  assert.equal(lineExtrasFor('e99'), null);
});

test('expansion line extras: every fill, fan and line lies on its map, recipes and kinds the painters know, values in range', () => {
  for (const [id, ex] of Object.entries(EXPANSION_LINE_EXTRAS)) {
    const m = byId.get(id), [W, D] = m.size, recipes = new Set(lookRecipeNames(m.theater));
    for (const [k, f] of (ex.fills || []).entries()) {
      assert.ok(Array.isArray(f.poly) && f.poly.length >= 3 && f.poly.every((p) => inside(p, W, D)), `${id} fill ${k}: a polygon on the map`);
      let a2 = 0;
      for (let i = 0; i < f.poly.length; i++) { const p = f.poly[i], q = f.poly[(i + 1) % f.poly.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
      assert.ok(Math.abs(a2) / 2 >= 1, `${id} fill ${k}: an area`);
      assert.ok(recipes.has(f.recipe) && (f.recipe2 == null || recipes.has(f.recipe2)), `${id} fill ${k}: recipes ${f.recipe} / ${f.recipe2}`);
      if (f.edge != null) assert.ok(f.edge > 0 && f.edge <= 3, `${id} fill ${k}: edge ${f.edge}`);
      if (f.scale != null) assert.ok(f.scale >= 0.5 && f.scale <= 40, `${id} fill ${k}: scale ${f.scale}`);
      if (f.scale2 != null) assert.ok(f.scale2 >= 0.3 && f.scale2 <= 40, `${id} fill ${k}: scale2 ${f.scale2}`);
      if (f.amp2 != null) assert.ok(f.amp2 >= 0 && f.amp2 <= 1, `${id} fill ${k}: amp2 ${f.amp2}`);
      if (f.lobes != null) assert.ok(f.lobes >= 0 && f.lobes <= 4, `${id} fill ${k}: lobes ${f.lobes}`);
      if (f.cut != null) assert.ok(Array.isArray(f.cut) && f.cut[0] >= 0 && f.cut[0] < f.cut[1] && f.cut[1] <= 1, `${id} fill ${k}: cut ${f.cut}`);
      if (f.strength != null) assert.ok(f.strength > 0 && f.strength <= 1, `${id} fill ${k}: strength ${f.strength}`);
    }
    for (const [k, f] of (ex.fans || []).entries()) {
      assert.ok(inside([f.x, f.z], W, D) && f.r > 0 && f.r <= 6, `${id} fan ${k} at ${f.x},${f.z} r ${f.r}`);
      assert.ok(recipes.has(f.recipe), `${id} fan ${k}: recipe ${f.recipe}`);
      assert.ok(Array.isArray(f.dir) && Math.hypot(f.dir[0], f.dir[1]) > 0.5, `${id} fan ${k}: dir`);
    }
    for (const [k, l] of (ex.lines || []).entries()) {
      assert.ok(KINDS.has(l.kind) && l.pts.length >= 2 && l.pts.every((p) => inside(p, W, D)), `${id} line ${k}`);
      if (l.w != null) assert.ok(l.w >= 0.3 && l.w <= 4, `${id} line ${k}: width ${l.w}`);
      if (l.strength != null) assert.ok(l.strength > 0 && l.strength <= 1, `${id} line ${k}: strength`);
      if (l.passes != null) assert.ok(Number.isInteger(l.passes) && l.passes >= 1 && l.passes <= 60, `${id} line ${k}: passes`);
    }
  }
});

test('e03 pens: the look paints mud inside the paddock and grass along its rails; the gameplay splat is not touched', () => {
  const m = byId.get('e03'), [W, D] = m.size;
  const look = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS);
  const game = terrainPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS);
  assert.ok(look && game, 'e03 has roads: both painters exist');
  const MUD = LAYERS.indexOf('mud'), GRASS = LAYERS.indexOf('grass');
  // a texel of the paddock's 'ground' (the base splat's mix there: mostly dirt)
  const at = (painter, x, z) => { const w = new Float32Array(8); w[2] = 0.7; w[1] = 0.2; w[0] = 0.1; if (painter) painter(x, z, w); return w; };
  let mud = 0, n = 0;
  for (let x = 9; x <= 27; x += 1.5) for (let z = 15; z <= 33; z += 1.5) { const w = at(look, x, z); n++; if (w[MUD] > 0.25) mud++; }
  assert.ok(mud / n > 0.6, `the paddock's look is trodden mud (${mud}/${n} texels)`);
  let grass = 0, g = 0;
  for (let x = 7; x <= 29; x += 0.5) { const w = at(look, x, 35.6); g++; if (w[GRASS] > 0.3) grass++; }   // along the S rails
  assert.ok(grass / g > 0.25 && grass / g < 0.95, `a broken strip of grass along the rails (${grass}/${g})`);
  // (negative control: outside the pens the look leaves the ground alone; the gameplay painter paints none of the pens)
  const far = at(look, 70, 20); assert.deepEqual(Array.from(far), Array.from(at(null, 70, 20)), 'no paint away from roads and pens');
  for (const [x, z] of [[18, 24], [49, 5], [51, 31], [35.6, 28.6]]) assert.deepEqual(Array.from(at(game, x, z)), Array.from(at(null, x, z)), `gameplay splat at ${x},${z}`);
});

test('e03 pens: no dry cracked clay inside the rails — the fills lay them wholly to trodden ground (without them it shows)', () => {
  // the shader draws a texel's three heaviest layers: the base ground's 'dirt' (the cracked clay) must not be among them
  // with any weight anywhere from rail to rail; the same pens painted by the fans alone (the round-2 look) show it. Every
  // texel is trodden ground — wet mud, or the drier trodden earth drifting through it — but for the grass along the rails
  const m = byId.get('e03'), [W, D] = m.size, DIRT = LAYERS.indexOf('dirt'), MUD = LAYERS.indexOf('mud');
  const ROAD = LAYERS.indexOf('road'), DRY = LAYERS.indexOf('grassdry'), GRASS = LAYERS.indexOf('grass'), LEAVES = LAYERS.indexOf('leaves');
  const painter = (extras) => roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS, extras ? { extras } : {});
  const look = painter(null), fansOnly = painter({ ...EXPANSION_LINE_EXTRAS.e03, fills: [] });
  const at = (p, x, z) => { const w = new Float32Array(8); w[2] = 0.7; w[1] = 0.2; w[0] = 0.1; p(x, z, w); const S = w.reduce((a, b) => a + b, 0); return Array.from(w, (v) => v / S); };
  for (const [name, x0, z0, x1, z1] of [['paddock', 6, 12, 30, 36], ['kennel yard', 44, 1.5, 54, 9.5], ['hens\' run', 48.6, 25.4, 54, 37.4]]) {
    let n = 0, worst = 0, mud = 0, trodden = 0, clay = 0;
    for (let x = x0 + 0.05; x <= x1 - 0.05; x += 0.25) for (let z = z0 + 0.05; z <= z1 - 0.05; z += 0.25) {
      const w = at(look, x, z); n++;
      worst = Math.max(worst, w[DIRT]); if (w[MUD] > 0.25) mud++;
      if (w[MUD] + w[ROAD] + w[DRY] + w[LEAVES] > 0.6 || w[GRASS] > 0.3) trodden++;   // (wet, dry or between)
      if (at(fansOnly, x, z)[DIRT] >= 0.06) clay++;
    }
    assert.ok(worst < 0.06, `${name}: the clay's share at most ${worst.toFixed(3)} anywhere inside the rails`);
    assert.ok(mud / n > 0.55, `${name}: wet mud over most of it (${(100 * mud / n).toFixed(0)}%)`);
    assert.ok(trodden === n, `${name}: mud, drier trodden earth or the grass strip everywhere (${n - trodden} texels neither)`);
    assert.ok(clay / n > 0.5, `negative control: painted by the fans alone the ${name} shows clay (${clay}/${n})`);
  }
});

/** The e03 pens as round 3 laid them (the verifier's 'even brown carpet' with a ruler-straight edge at the rails): the
 *  paddock's fill grown 0.65 m, the round-3 drier mixes and no lobes — the negative control of the two tests below. */
function round3Pens() {
  const E = EXPANSION_LINE_EXTRAS.e03, bare = (f) => ({ poly: f.poly, recipe: f.recipe, scale: f.scale, edge: f.edge, seed: f.seed });
  return { ...E, fills: [{ ...bare(E.fills[0]), poly: [[5.35, 11.35], [30.65, 11.35], [30.65, 36.65], [5.35, 36.65]], recipe2: 'edge', scale: 5 },
    { ...bare(E.fills[1]), recipe2: 'shoulder' }, { ...bare(E.fills[2]), recipe2: E.fills[2].recipe2 }] };
}

test('e03 paddock and kennel yard: drier trodden ground drifts through the wet mud in broad patches (round 3: it barely showed)', () => {
  // 'trodden' (the pale packed layers, mud only in its low spots) where the round-3 'edge' / 'shoulder' mixes kept so
  // much mud that the terrain shader's height blend showed mud clods over the whole pen
  const m = byId.get('e03'), [W, D] = m.size, MUD = LAYERS.indexOf('mud'), ROAD = LAYERS.indexOf('road'), DRY = LAYERS.indexOf('grassdry');
  const painter = (extras) => roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS, extras ? { extras } : {});
  const look = painter(null), old = painter(round3Pens());
  const at = (p, x, z) => { const w = new Float32Array(8); w[2] = 0.7; w[1] = 0.2; w[0] = 0.1; p(x, z, w); const S = w.reduce((a, b) => a + b, 0); return Array.from(w, (v) => v / S); };
  const dryShare = (p, x0, z0, x1, z1) => {
    let n = 0, dry = 0;
    for (let x = x0 + 0.05; x <= x1 - 0.05; x += 0.25) for (let z = z0 + 0.05; z <= z1 - 0.05; z += 0.25) { const w = at(p, x, z); n++; if (w[ROAD] + w[DRY] > 0.5 && w[MUD] < 0.25) dry++; }
    return dry / n;
  };
  for (const [name, x0, z0, x1, z1] of [['paddock', 6, 12, 30, 36], ['kennel yard', 44, 1.5, 54, 9.5]]) {
    const s = dryShare(look, x0, z0, x1, z1), s3 = dryShare(old, x0, z0, x1, z1);
    assert.ok(s > 0.2 && s < 0.45, `${name}: drier trodden ground over ${(100 * s).toFixed(0)}% of it (a drift, not a carpet nor a dry pen)`);
    assert.ok(s3 < 0.05, `negative control: the round-3 look leaves ${(100 * s3).toFixed(1)}% of the ${name} drier`);
  }
  // broad patches, not speckle: the dry texels of the paddock come in runs along a row
  let runs = 0, dry = 0;
  for (let z = 14.05; z < 34; z += 2) {
    let prev = false;
    for (let x = 8.05; x < 28; x += 0.25) { const w = at(look, x, z), d = w[ROAD] + w[DRY] > 0.5 && w[MUD] < 0.25; if (d) dry++; if (d && !prev) runs++; prev = d; }
  }
  assert.ok(dry / runs > 8, `the paddock's drier patches run ${(dry / runs * 0.25).toFixed(1)} m on average along a row (broad patches)`);
});

test('e03 paddock: the mud spills past the rails in tongues — never a band at a constant offset (round 3: a ruler-straight edge)', () => {
  // along the N, S and W rails (the E rail has the poached gateway), how far out past the rail the mud reaches
  const m = byId.get('e03'), [W, D] = m.size, MUD = LAYERS.indexOf('mud');
  const painter = (extras) => roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS, extras ? { extras } : {});
  const reach = (p) => {
    const at = (x, z) => { const w = new Float32Array(8); w[0] = 0.6; w[1] = 0.4; p(x, z, w); const S = w.reduce((a, b) => a + b, 0); return w[MUD] / S; };   // the meadow outside
    const out = {};
    for (const [side, [ax, az, bx, bz, ox, oz]] of Object.entries({ N: [6, 12, 30, 12, 0, -1], S: [6, 36, 30, 36, 0, 1], W: [6, 12, 6, 36, -1, 0] })) {
      const L = Math.hypot(bx - ax, bz - az), r = [];
      for (let t = 1; t < L - 1; t += 0.25) {
        const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
        let d = 0;
        for (let q = 0; q <= 4; q += 0.05) if (at(x + ox * q, z + oz * q) > 0.25) d = q;
        r.push(d);
      }
      r.sort((a, b) => a - b);
      out[side] = { p90: r[Math.floor(r.length * 0.9)], far: r.filter((v) => v >= 1).length / r.length };
    }
    return out;
  };
  const now = reach(painter(null)), old = reach(painter(round3Pens()));
  for (const side of ['N', 'S', 'W']) {
    const { p90, far } = now[side];
    assert.ok(p90 >= 1.2, `${side} rail: tongues of mud reach ${p90.toFixed(2)} m past it`);
    assert.ok(far > 0.1 && far < 0.9, `${side} rail: the mud reaches a metre past it along ${(100 * far).toFixed(0)}% of the rail (tongues, not a wider band)`);
    assert.ok(old[side].p90 < 1 && old[side].far === 0, `negative control: round 3's edge stays within ${old[side].p90.toFixed(2)} m of the ${side} rail`);
  }
});

test('expansion line extras: what the look and the pre-trampled lines build from them is deterministic', () => {
  for (const id of Object.keys(EXPANSION_LINE_EXTRAS)) {
    const m = byId.get(id), [W, D] = m.size;
    assert.equal(JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m))), JSON.stringify(pretrampleRoads(normalizeRoadNetwork(m))), `${id}: pre-trample jobs`);
    const p1 = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS), p2 = roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, LAYERS);
    for (let k = 0; k < 400; k++) {
      const x = (k * 37.13) % W, z = (k * 53.71) % D, w1 = new Float32Array(8), w2 = new Float32Array(8); w1[0] = w2[0] = 1;
      p1(x, z, w1); p2(x, z, w2);
      assert.deepEqual(Array.from(w1), Array.from(w2), `${id} paint at ${x.toFixed(1)},${z.toFixed(1)}`);
    }
  }
});
