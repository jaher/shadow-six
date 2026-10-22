/** M3 Reverse Engineering art pass (Sysendam, Eidfjord): the library assets it names (the camp's ridge tents, the
 * S-bank farm's stabbur and its snow twin, log piles, a handcart), the roundpole skigard (art/skigard.js) on its line,
 * the gameplay footprints kept, and the set dressing (art/m03-dressing.js) kept off the guards' posts and beats and
 * the team's start. */
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildSkigard } from '../../src/art/skigard.js';
import { wireTypeOf } from '../../src/art/wire-obstacles.js';
import { M03_DRESSING } from '../../src/art/m03-dressing.js';
import { getMission } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const m03 = getMission('m03');
const S = (id) => m03.structures.find((s) => s.id === id);

test('art m03: every named asset ships its LODs and sidecar; the stabbur has its snow twin', () => {
  const m = merged();
  const named = [...new Set(m03.structures.filter((s) => s.asset).map((s) => s.asset))];
  for (const n of ['tent_ridge_field', 'stabbur_no', 'log_pile_stack', 'handcart_wood', 'house_timber_b', 'log_cabin_a']) assert.ok(named.includes(n), n);
  for (const n of [...named, 'stabbur_no_snow']) {
    const a = m.assets[n];
    assert.ok(a, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
  }
  assert.equal(m.assets.stabbur_no.snowVariant, 'stabbur_no_snow');
  assert.ok(m.assets.stabbur_no_snow.theaters.includes('snow'));
  // the snow twin carries no ground drifts round its posts (they read as flat boxy slabs on the terrain): its plan stays
  // the storehouse's own (≈ 4 × 4 m with the eaves), not the 6.4 × 5.9 m of the drift skirts
  const bb = m.assets.stabbur_no_snow.bbox, side = (k) => bb.max[k] - bb.min[k];
  assert.ok(side(0) < 4.6 && side(2) < 4.6, `stabbur_no_snow plan ${side(0).toFixed(2)} × ${side(2).toFixed(2)} m`);
  // a gzip-wrapped GLB starts with the gzip magic (tools/perf/glb_gzip.mjs)
  for (const l of [...m.assets.stabbur_no.lods, ...m.assets.stabbur_no_snow.lods]) {
    const b = readFileSync(P(`assets/models/${l.url}`));
    assert.ok(b[0] === 0x1f && b[1] === 0x8b, `${l.url} gzip-wrapped`);
  }
});

test('art m03: the camp tents keep their gameplay footprints (the garrison tent spawns its pool)', () => {
  assert.deepEqual(['x', 'z', 'w', 'd'].map((k) => S('camp_tent')[k]), [132, 43, 4, 4]);
  assert.deepEqual(['x', 'z', 'w', 'd'].map((k) => S('tent2')[k]), [141, 42, 4, 4]);
  assert.ok(S('camp_tent').garrison && S('camp_tent').flag);
  assert.equal(S('camp_tent').asset, 'tent_ridge_field');
});

test('art m03: the skigard stays on its line, see-through height, cheap, and is no wire', () => {
  const sk = S('skigard');
  assert.equal(sk.type, 'fence');
  assert.equal(wireTypeOf(sk, { missionId: 'm03' }), null);
  const run = [[0, 0], [12, 0], [12, 8]];
  const g = buildSkigard(run, { h: 1.25, id: 't' });
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(b.min.z >= -0.3 && b.max.x <= 12.3 && b.min.x >= -0.3 && b.max.z <= 8.3, `within 0.3 m of the line (${b.min.x.toFixed(2)},${b.min.z.toFixed(2)})-(${b.max.x.toFixed(2)},${b.max.z.toFixed(2)})`);
  assert.ok(b.max.y <= 1.25 + 0.4 && b.max.y >= 1.2, `pole tops at ~1.25 m (${b.max.y.toFixed(2)})`);
  let tris = 0, meshes = 0;
  g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  assert.ok(meshes <= 3, `merged per material (${meshes} meshes)`);
  assert.ok(tris > 300 && tris < 20000, `detailed but cheap (${tris} tris)`);
});

test('art m03: dressing keeps clear of the guards, their beats and the team start', () => {
  const pts = [];
  for (const e of m03.enemies) {
    pts.push([e.x, e.z]);
    const r = Array.isArray(e.route) ? e.route : [];
    for (let k = 0; k < r.length; k++) {
      const a = r[k], c = r[(k + 1) % r.length];
      for (let t = 0; t <= 1; t += 0.05) pts.push([a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t]);
    }
  }
  const ids = M03_DRESSING.map((s) => s.id);
  assert.ok(ids.length >= 15);
  for (const id of ids) {
    const s = S(id);
    assert.ok(s, id);
    const at = s.points ?? [[s.x, s.z]];
    const half = s.points ? 0 : Math.hypot(s.w ?? 2 * (s.r ?? 0.5), s.d ?? 2 * (s.r ?? 0.5)) / 2;
    for (const [x, z] of at) {
      const d = Math.min(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z))) - half;
      assert.ok(d > 1.5, `${id} ${d.toFixed(1)} m from the nearest guard / beat`);
      for (const c of m03.commandos) assert.ok(Math.hypot(x - c.x, z - c.z) > 12, `${id} off the start`);
    }
  }
});
