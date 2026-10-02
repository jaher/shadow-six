/** Ground cover (docs/vegetation.md pass 1): seasons, grass archetypes, clumped placement, reeds / marram, desert scrub. */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { seasonOf, vegetationProfile, GRASS_TYPES, GT, pickWeighted } from '../../src/art/terrain/veg-profile.js';
import { ARCHETYPES, archetypeGeometry } from '../../src/art/terrain/grass-arch.js';
import { placeGround, clumpField, STRIDE } from '../../src/art/terrain/grass-place.js';
import { SCRUB, scrubArchetype } from '../../src/art/terrain/scrub-geo.js';
import { placeScrub, nebkhaField, SCRUB_KINDS } from '../../src/art/terrain/scrub.js';
import { MISSIONS } from '../../src/missions/index.js';

test('veg: season follows the mission date (M17–M20 winter/autumn, M14 spring, M16 late summer, M06 thaw)', () => {
  assert.equal(seasonOf('1944-05-25'), 'spring');
  assert.equal(seasonOf('1944-09-04'), 'late');
  assert.equal(seasonOf('1944-11-28'), 'autumn');
  assert.equal(seasonOf('1945-02-11'), 'winter');
  const by = Object.fromEntries(MISSIONS.map((m) => [m.id, vegetationProfile(m, m.theater || 'temperate')]));
  for (const id of ['m18', 'm19', 'm20']) assert.equal(by[id].season, 'winter', id);
  assert.equal(by.m17.season, 'autumn');
  assert.equal(by.m14.season, 'spring');
  assert.equal(by.m16.season, 'late');
  assert.equal(by.m06.season, 'thaw', 'Finnmark in May is just past the thaw');
  for (const id of ['m18', 'm19', 'm20', 'm06']) assert.equal(by[id].flowers, 0, `${id}: no summer wildflowers in winter`);
  for (const id of ['m08', 'm09', 'm10', 'm11']) assert.ok(by[id].scrub, `${id}: desert scrub`);
  assert.ok(by.m14.dunes && by.m13.dunes, 'coast missions grow marram');
  assert.ok(!by.m01.reeds, 'no reeds in the snow theatre');
  assert.ok(!by.m14.reeds && by.m16.reeds && by.m18.reeds, 'reeds on rivers (M16, M18 reed neck), not on the Channel beach');
  assert.ok(by.m20.dry > by.m16.dry && by.m16.dry > by.m14.dry, 'grass dries from May to Sep to Feb');
});

test('veg: ≥ 8 grass archetypes, all real 3D (height ≥ 0.25 × width except low forbs ≥ 0.15), deterministic', () => {
  assert.ok(GRASS_TYPES.length >= 8);
  for (const name of GRASS_TYPES) {
    assert.ok(ARCHETYPES[name], name);
    const g = archetypeGeometry(name, 9, 11);
    g.computeBoundingBox();
    const b = g.boundingBox, w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), h = b.max.y - b.min.y;
    assert.ok(h >= (name === 'forb' ? 0.15 : name === 'flopped' ? 0.2 : 0.25) * w, `${name}: h ${h.toFixed(2)} w ${w.toFixed(2)}`);
    for (const a of ['position', 'normal', 'aBlade', 'aPart']) assert.ok(g.attributes[a], `${name}.${a}`);
    const g2 = archetypeGeometry(name, 9, 11);
    assert.deepEqual(Array.from(g2.attributes.position.array), Array.from(g.attributes.position.array), `${name} deterministic`);
  }
  const reed = archetypeGeometry('reed', 9, 11); reed.computeBoundingBox();
  assert.ok(reed.boundingBox.max.y > 1.5, 'reeds are tall');
  assert.ok(Array.from(reed.attributes.aPart.array).some((v) => v === 1), 'reeds carry plumes');
});

test('veg: weighted pick and clump field', () => {
  assert.equal(pickWeighted({ a: 0, b: 1 }, 0.5), 'b');
  assert.equal(pickWeighted({ a: 0 }, 0.5), null);
  let lo = 0, hi = 0;
  for (let i = 0; i < 4000; i++) { const v = clumpField((i % 63) * 0.37, Math.floor(i / 63) * 0.37); if (v < 0.05) lo++; if (v > 0.5) hi++; }
  assert.ok(lo > 400 && hi > 400, `clumps with gaps (gaps ${lo}, cores ${hi})`);
});

/** A 64 × 48 m meadow with a river along z = 30..34 (water SD > 0 inside). */
function meadowEnv(extra = {}) {
  return {
    W: 64, D: 48, heightAt: () => 0,
    grassW: (x) => (x < 4 ? { g: 0, dry: 0, excluded: true } : { g: 1, dry: x > 50 ? 0.8 : 0 }),
    waterSD: (x, z) => 2 - Math.abs(z - 32), sandW: () => 0, ...extra,
  };
}

test('veg: placement mixes species in drifts, clumps (no grid), keeps off pavement, reeds hug the water', () => {
  const prof = vegetationProfile({ id: 'x', date: '1944-09-04' }, 'temperate');
  const chunks = placeGround(meadowEnv(), prof, { perM2: 9, chunk: 16, seed: 3 });
  const count = {}; let n = 0, offPave = true, reedFar = 0, reeds = 0;
  for (const c of chunks) for (const name in c.lists) {
    const a = c.lists[name], k = a.length / STRIDE;
    count[name] = (count[name] || 0) + k; n += k;
    for (let i = 0; i < k; i++) {
      if (a[i * STRIDE] < 4) offPave = false;
      assert.equal(a[i * STRIDE + 7], GT[name]);
      const rank = a[i * STRIDE + 8]; assert.ok(rank > 0 && rank < 1);
      if (name === 'reed') { reeds++; if (Math.abs(a[i * STRIDE + 2] - 32) > 2 + 2.4 + 0.01) reedFar++; }
    }
  }
  assert.ok(offPave, 'no tufts on excluded ground');
  assert.ok(Object.keys(count).length >= 5, `≥ 5 archetypes in a late-summer meadow (${Object.keys(count)})`);
  assert.ok(count.meadow < n * 0.75, 'meadow tufts are not the whole carpet');
  assert.ok(reeds > 50 && reedFar === 0, `reeds on the water band only (${reeds}, far ${reedFar})`);
  // clumping: coefficient of variation of tuft counts over 0.5 m cells well above Poisson (1/√mean; a jittered grid is lower)
  const cells = new Map();
  for (const c of chunks) for (const name in c.lists) if (name !== 'reed') {
    const a = c.lists[name];
    for (let i = 0; i < a.length; i += STRIDE) { const k = `${Math.floor(a[i] * 2)},${Math.floor(a[i + 2] * 2)}`; cells.set(k, (cells.get(k) || 0) + 1); }
  }
  const v = [];
  for (let j = 0; j < 48 * 2; j++) for (let i = 8; i < 64 * 2; i++) if (Math.abs(j / 2 - 32) > 6) v.push(cells.get(`${i},${j}`) || 0); // bare gaps count too
  const mu = v.reduce((s, x) => s + x, 0) / v.length;
  const cv = Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length) / mu;
  assert.ok(cv > 1.15 / Math.sqrt(mu), `clumped placement (cv ${cv.toFixed(2)}, Poisson ${(1 / Math.sqrt(mu)).toFixed(2)})`);
  // budget: about the old density (9/m² × grass weight) or less
  assert.ok(n - reeds < 64 * 48 * 9 * 0.9, `budget (${n - reeds})`);
  // deterministic
  const again = placeGround(meadowEnv(), prof, { perM2: 9, chunk: 16, seed: 3 });
  assert.deepEqual(again.map((c) => Object.keys(c.lists).map((k) => c.lists[k].length)), chunks.map((c) => Object.keys(c.lists).map((k) => c.lists[k].length)));
});

test('veg: coast sand grows marram clumps above the strand; desert sand grows sparse drinn', () => {
  const env = meadowEnv({ grassW: () => ({ g: 0, dry: 0 }), sandW: () => 1, waterSD: (x, z) => -z + 2 });
  const coast = placeGround(env, vegetationProfile({ id: 'm14', date: '1944-05-25' }, 'coast'), { perM2: 9, seed: 5 });
  let marram = 0, wet = 0;
  for (const c of coast) { const a = c.lists.marram || []; marram += a.length / STRIDE; for (let i = 0; i < a.length; i += STRIDE) if (a[i + 2] < 4.5) wet++; }
  assert.ok(marram > 100 && wet === 0, `marram on dry sand (${marram}, on strand ${wet})`);
  const desert = placeGround(env, vegetationProfile({ id: 'm09' }, 'desert'), { perM2: 9, seed: 5 });
  const drinn = desert.reduce((s, c) => s + (c.lists.drinn?.length || 0) / STRIDE, 0);
  assert.ok(drinn > 5 && drinn < 64 * 48 * 0.1, `sparse drinn (${drinn})`);
});

test('veg: desert scrub archetypes are 3D volumes, ≤ 2k tris, and none lies flat', () => {
  for (const kind of SCRUB_KINDS) for (const seed of [1, 2]) {
    const A = scrubArchetype(kind, seed, 1);
    const tris = A.idx.length / 3;
    assert.ok(tris > 150 && tris < 2000, `${kind}: ${tris} tris`);
    assert.ok(A.height >= 0.2 * 2 * A.radius, `${kind}: height ${A.height.toFixed(2)} ≥ 0.2 × width ${(2 * A.radius).toFixed(2)}`);
    assert.ok(A.sway.every((s) => s >= 0 && s <= 1));
    assert.ok(!A.pos.some(Number.isNaN));
  }
  assert.ok(scrubArchetype('saltbush', 1, 0.4).idx.length < scrubArchetype('saltbush', 1, 1).idx.length, 'low preset trims leaves');
  assert.ok(SCRUB.camelthorn && SCRUB.retama);
});

test('veg: scrub placement is sparse, clustered on run-off ground, off the paving; nebkha mound + downwind tail', () => {
  const env = { W: 120, D: 80, runoff: (x) => (x > 90 ? 1 : 0), open: (x, z) => !(z < 10) };
  const list = placeScrub(env, { seed: 9 });
  assert.ok(list.length > 20 && list.length < 120 * 80 * 0.1, `sparse (${list.length})`);
  assert.ok(list.every((p) => p.z >= 10), 'never on closed ground');
  const wadi = list.filter((p) => p.x > 90).length / 30, open = list.filter((p) => p.x <= 90).length / 90;
  assert.ok(wadi > open * 2, `denser on run-off (${wadi.toFixed(1)} vs ${open.toFixed(1)} per m of width)`);
  assert.deepEqual(placeScrub(env, { seed: 9 }), list, 'deterministic');
  const f = nebkhaField([{ x: 10, z: 10, s: 1, mound: 1 }], { x: 1, y: 0 });
  assert.ok(f(10, 10) > 0.15 && f(10, 10) < 0.4, `mound top ${f(10, 10)}`);
  assert.ok(f(12.2, 10) > 0.03, 'tail downwind');
  assert.equal(f(7.5, 10), 0, 'nothing upwind');
  assert.equal(f(30, 30), 0);
});

test('veg: no shrub at a guard post, a commando spawn or a patrol waypoint', async () => {
  const { spawnClearance } = await import('../../src/art/terrain/scrub.js');
  const ok = spawnClearance({ enemies: [{ x: 10, z: 10, route: { points: [[20, 20], { x: 30, z: 5 }] } }], commandos: [{ x: 50, z: 50 }] });
  assert.ok(!ok(10.5, 10) && !ok(20, 21) && !ok(30.8, 5.2) && !ok(50, 49));
  assert.ok(ok(14, 10) && ok(40, 40));
  assert.ok(spawnClearance(null)(1, 1));
});
