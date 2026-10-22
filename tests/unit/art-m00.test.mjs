/** M0 sandbox art pass (occupied Flanders: a Wehrmacht fuel depot by a Flemish lift bridge): the library assets it
 * names, the depot's brick yard wall (art/depot-walls.js) on its gameplay line, the visual-only pavements and furniture,
 * and the set dressing kept off the patrols' beats and the extraction. */
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { brickDepotWall } from '../../src/art/depot-walls.js';
import { wireTypeOf } from '../../src/art/wire-obstacles.js';
import { getMission } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const m00 = getMission('m00');
const S = (id) => m00.structures.find((s) => s.id === id);
const DRESSING = ['logs_house', 'cart_house', 'well_yard', 'clothesline', 'lorry_paddock', 'flag_barracks', 'drums_depot'];

test('art m00: every named asset ships its LODs and sidecar and suits the temperate theater', () => {
  const m = merged();
  const named = m00.structures.filter((s) => s.asset).map((s) => s.asset);
  for (const n of ['farmhouse_mosan_b', 'hut_timber_barrack_a', 'shed_tarred_be', 'log_pile_stack', 'handcart_wood']) assert.ok(named.includes(n), n);
  for (const n of named) {
    const a = m.assets[n];
    assert.ok(a, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('temperate'), n);
  }
  // the gameplay footprints and ids the tests and the solution rely on are unchanged
  assert.deepEqual([S('house1').x, S('house1').z], [16, 14]);
  assert.deepEqual([S('barracks1').x, S('barracks1').z, S('barracks1').w, S('barracks1').d], [52.5, 11, 9.6, 6]);
  assert.deepEqual([S('hut1').x, S('hut1').z], [53, 50]);
  assert.ok(S('barracks1').reinforcementSpawn);
});

test('art m00: the brick depot wall stays on its line and stops short of the gate passage', () => {
  const run = [[45, 27], [45, 4], [58, 4]];
  const g = brickDepotWall(run, { h: 2.6, width: 0.5, gatePiers: [[45, 27], [45, 33]] }, () => 0.5);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(b.max.z <= 27 + 1e-6, `nothing reaches into the passage (max z ${b.max.z.toFixed(3)})`);
  assert.ok(b.min.x >= 45 - 0.25 - 0.2 && b.min.z >= 4 - 0.25 - 0.2, 'pilasters, coping and gate-pier slabs ≤ 0.2 m proud of the faces');
  assert.ok(b.max.y <= 2.6 + 0.4 + 0.25, 'gate pier caps only above the wall');
  let tris = 0;
  g.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  assert.ok(tris > 200 && tris < 20000, `detailed but cheap (${tris} tris)`);
  for (const w of m00.structures.filter((s) => s.type === 'wall' && /brick_depot/.test(s.variant ?? ''))) {
    assert.equal(wireTypeOf(w, { missionId: 'm00' }), 'coping_bracket');
    assert.deepEqual(w.gatePiers, [[45, 27], [45, 33]]);
  }
});

test('art m00: pavements and furniture are visual only; dressing keeps clear of beats, posts and the extraction', () => {
  for (const p of m00.pavements) assert.equal(p.grid, false, p.id);
  for (const f of m00.furniture) assert.equal(f.block, false, f.type);
  const pts = [];
  for (const e of m00.enemies) {
    pts.push([e.x, e.z]);
    const r = e.route || [];
    for (let k = 0; k < r.length; k++) {
      const a = r[k], c = r[(k + 1) % r.length];
      for (let t = 0; t <= 1; t += 0.05) pts.push([a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t]);
    }
  }
  for (const id of DRESSING) {
    const s = S(id);
    assert.ok(s, id);
    const [x, z] = s.points ? s.points[0] : [s.x, s.z];
    const d = Math.min(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    assert.ok(d > 3.5, `${id} ${d.toFixed(1)} m from the nearest guard / beat`);
    assert.ok(Math.hypot(x - m00.extraction.x, z - m00.extraction.z) > m00.extraction.r + 3, `${id} off the extraction`);
    for (const c of m00.commandos) assert.ok(Math.hypot(x - c.x, z - c.z) > 6, `${id} off the start`);
  }
});
