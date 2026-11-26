/**
 * LIGHTS OUT e06's line extras (world/line-extras-expansion.js): the fishermen's trodden way and a sledge's runners out
 * over the basin ice to their holes, coal grit under the yard's bunker. Keyed by a registered expansion mission and
 * served by lineExtrasFor (the base table keeps the 21 base missions); every line lies on the map with a kind the
 * painter knows; the road look paints them (the ice by the holes takes a trodden track, the open basin does not), the
 * same every time; the network and pre-trample jobs the simulation could read are not touched by them.
 */
import { test, assert } from './lib.mjs';
import { EXPANSION_LINE_EXTRAS } from '../../src/world/line-extras-expansion.js';
import { LINE_EXTRAS, lineExtrasFor } from '../../src/world/line-extras.js';
import { normalizeRoadNetwork, RoadIndex, roadLookPainter } from '../../src/world/roads.js';
import { getMission } from '../../src/missions/index.js';
import { normalizeMission } from '../../src/missions/schema.js';

const KINDS = new Set(['foot', 'boot', 'drag', 'cart', 'vehicle', 'tracked', 'sled']);
const SNOW = ['snow', 'snowold', 'snowpack', 'rock', 'ice', 'slush', 'grassdry', 'mud'];

test('expansion line extras (e06): keyed by a LIGHTS OUT mission, served by lineExtrasFor, not in the base table', () => {
  for (const id of Object.keys(EXPANSION_LINE_EXTRAS)) {
    assert.ok(/^e\d\d$/.test(id) && getMission(id), `unknown expansion mission ${id}`);
    assert.ok(!Object.prototype.hasOwnProperty.call(LINE_EXTRAS, id), `${id} in both tables`);
    assert.equal(lineExtrasFor(id), EXPANSION_LINE_EXTRAS[id]);
  }
  assert.equal(lineExtrasFor('e99'), null);
});

test('expansion line extras (e06): lines and fans on the map, kinds and values in range', () => {
  const m = getMission('e06'), [W, D] = m.size, ex = EXPANSION_LINE_EXTRAS.e06;
  for (const [k, l] of ex.lines.entries()) {
    assert.ok(KINDS.has(l.kind), `line ${k}: kind ${l.kind}`);
    assert.ok(l.pts.length >= 2 && l.pts.every(([x, z]) => x >= 0 && z >= 0 && x <= W && z <= D), `line ${k}: on the map`);
    if (l.w != null) assert.ok(l.w >= 0.3 && l.w <= 4, `line ${k}: width`);
    if (l.gauge != null) assert.ok(l.gauge >= 0.8 && l.gauge <= 2.6, `line ${k}: gauge`);
    if (l.strength != null) assert.ok(l.strength > 0 && l.strength <= 1, `line ${k}: strength`);
  }
  for (const f of ex.fans) assert.ok(f.x >= 0 && f.z >= 0 && f.x <= W && f.z <= D && f.r > 0 && f.r < 6, 'fan on the map');
});

test('expansion line extras (e06): the road look paints the fishermen\'s way (and nothing out on the open basin), deterministically', () => {
  const m = normalizeMission(getMission('e06'), { quiet: true }), [W, D] = m.size;
  const paint = () => roadLookPainter(new RoadIndex(normalizeRoadNetwork(m), W, D), m.theater, SNOW);
  const p1 = paint(), p2 = paint();
  assert.ok(p1, 'a look painter for e06');
  const at = (p, x, z) => { const w = new Float32Array(8); w[0] = 1; const hit = p(x, z, w); return { hit, w: Array.from(w) }; };
  const onPath = at(p1, 48.6, 61.3), open = at(p1, 60, 40);
  assert.ok(onPath.hit && onPath.w[0] < 0.99, `the way to the holes is trodden (${onPath.w.map((v) => v.toFixed(2))})`);
  assert.ok(!open.hit, 'the open basin ice is left as it is');
  for (let k = 0; k < 300; k++) {
    const x = 30 + ((k * 7.13) % 100), z = 50 + ((k * 3.71) % 70);
    assert.deepEqual(at(p1, x, z), at(p2, x, z), `paint at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
});
