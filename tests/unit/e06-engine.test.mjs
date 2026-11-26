/**
 * The generic pieces LIGHTS OUT e06 added (docs/expansion/e06.md, As built):
 *  - BCD: a man out cold, cuffed or on strings hears no noise and trips no zone's onHeard sensor (ai/director.js);
 *  - a terrain feature's `patches`: its palette layer laid in irregular, wind-streaked patches (art/terrain.js);
 *  - the castle kit's Geo build `weather` option: further material keys weathered like stone (art/castle-kit.js).
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';
import { featurePainter } from '../../src/art/terrain.js';
import { Geo } from '../../src/art/castle-kit.js';

test('BCD: a cuffed man hears nothing and trips no onHeard zone; a free comrade in the same zone does', () => {
  const s = bcdSim({ size: [120, 80], commandos: [{ role: 'greenberet', x: 5, z: 5 }],
    enemies: [post('a', 20, 40, 0), post('b', 100, 40, 180)],
    zones: [{ id: 'quay', poly: [[0, 20], [120, 20], [120, 60], [0, 60]], onHeard: 'RQ' }] });
  s.run(0.2);
  const a = s.get('a'), w = s.world;
  knockOut(a, s.cmd('greenberet'), w); cuff(a, s.cmd('greenberet'), w);
  assert.equal(a.ko, 'bound');
  // a level-2 splash 4 m from the cuffed man, far out of the free one's earshot
  w.emitNoise(22, 43, 12, 'splash', null, 2);
  s.run(0.5);
  assert.equal(s.count('alarm:zone'), 0, 'the cuffed man raised nothing');
  // the same splash by the free man: he hears it, the zone's sensor fires
  w.emitNoise(98, 43, 12, 'splash', null, 2);
  s.run(0.5);
  assert.equal(s.count('alarm:zone'), 1, 'the free man\'s zone heard it');
});

test('terrain feature `patches`: the layer in irregular patches inside the feature (about the cover asked), none outside; deterministic', () => {
  const layers = ['snow', 'snowold', 'snowpack', 'rock', 'ice', 'slush', 'grassdry', 'mud'], k = layers.indexOf('ice');
  const poly = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const mission = (cover) => ({ terrain: [{ type: 'poly', terrain: 'ground', points: poly, paint: 'ice', keep: 0.4, patches: { cover, scale: 10, stretch: 3, angle: 28, seed: 61 } }] });
  const share = (p) => {
    let on = 0, n = 0;
    for (let x = 5; x < 195; x += 1.7) for (let z = 5; z < 195; z += 1.7) {
      const w = new Float32Array(8); w[0] = 1; p(x, z, w); n++; if (w[k] > 0.5) on++;
    }
    return on / n;
  };
  const p35 = featurePainter(mission(0.35), layers), p60 = featurePainter(mission(0.6), layers);
  const s35 = share(p35), s60 = share(p60);
  assert.ok(s35 > 0.2 && s35 < 0.5, `cover 0.35 → ${s35.toFixed(2)}`);
  assert.ok(s60 > s35 + 0.12, `more cover asked, more ice (${s60.toFixed(2)} vs ${s35.toFixed(2)})`);
  assert.ok(s35 < 0.95, 'patches, not the whole feature');
  const w1 = new Float32Array(8), w2 = new Float32Array(8);
  w1[0] = w2[0] = 1; p35(57.3, 81.9, w1); featurePainter(mission(0.35), layers)(57.3, 81.9, w2);
  assert.deepEqual([...w1], [...w2], 'deterministic');
  const out = new Float32Array(8); out[0] = 1; p35(260, 260, out);
  assert.equal(out[k], 0, 'nothing outside the feature');
  // (without `patches` the layer covers the feature)
  const full = featurePainter({ terrain: [{ type: 'poly', terrain: 'ground', points: poly, paint: 'ice' }] }, layers);
  assert.ok(share(full) > 0.98, 'a plain `paint` feature covers it all');
});

test('castle-kit Geo.build `weather`: a matched material key gets the stone weathering (a darker damp band at its foot)', () => {
  const tone = (weather) => {
    const G = new Geo('t');
    G.box('e6_brick', 0, 2, 0, 4, 4, 0.4, 0, 1);
    const m = G.build('t', { ground: 0, damp: 1.1, streaks: 0, moss: 0, weather }).children[0];
    const P = m.geometry.attributes.position, C = m.geometry.attributes.color;
    let lo = 0, nl = 0, hi = 0, nh = 0;
    for (let i = 0; i < P.count; i++) {
      if (Math.abs(m.geometry.attributes.normal.getY(i)) > 0.5) continue;
      if (P.getY(i) < 0.01) { lo += C.getX(i); nl++; } else if (P.getY(i) > 3.99) { hi += C.getX(i); nh++; }
    }
    return { lo: lo / nl, hi: hi / nh };
  };
  const plain = tone(null), wet = tone(/^e6_brick/);
  assert.ok(Math.abs(plain.lo - plain.hi) < 0.25, `unweathered: foot ${plain.lo.toFixed(2)} ≈ top ${plain.hi.toFixed(2)}`);
  assert.ok(wet.lo < wet.hi * 0.85, `weathered: the foot darker (${wet.lo.toFixed(2)} vs ${wet.hi.toFixed(2)})`);
});
