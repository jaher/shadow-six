/** M2 art pass (A Quiet Blow-Up, Stamsund): the camp's stores as the original's arched (Nissen) hut outside the NE
 *  wall, Lofoten stockfish racks and faerings on the SW shore, a tarred woodshed, firewood and a picket-fenced kitchen
 *  garden in the settlement, library crates instead of the plain boxes; every piece clear of the routes, posts, starts,
 *  the camp's yard and the solution's way, and none of them in e7's view of e5's post (§7.5). */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm02'); try { return await fn(); } finally { await useManifest(null); } };
const m02 = MISSIONS.find((m) => m.id === 'm02');
const S = (id) => m02.structures.find((s) => s.id === id);
const pick = (s) => pickAsset(s.type, s, { theater: 'snow', missionId: 'm02' })?.name ?? null;
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const ART = ['store_hut', 'drums_st', 'cart_st', 'rack_1', 'rack_2', 'boat_s1', 'boat_s2', 'boat_s3', 'shed_sw', 'logs_sw', 'logs_a', 'logs_b'];
const radius = (s) => Math.hypot(s.w, s.d) / 2;

test('art m02: the stores draw the library Nissen hut, the woodshed the open lean-to, the crates library cargo; the camp keeps its log builds', () => withLib(merged(), () => {
  const want = { store_hut: 'nissen_hut_b', shed_sw: 'lean_to_canopy', crates1: 'dock_cargo_a', rack_1: 'drying_rack_a_snow', rack_2: 'drying_rack_a_snow',
    logs_a: 'log_pile_stack', logs_b: 'log_pile_stack', cart_st: 'handcart_wood', barr_camp: 'barracks_c', cab1: 'log_cabin_a' };
  for (const [id, name] of Object.entries(want)) assert.equal(pick(S(id)), name, id);
  for (const id of ['boat_s1', 'boat_s2', 'boat_s3']) assert.equal(S(id).vehicleArt, 'rowboat', `${id}: a library faering`);
}));

test('art m02: the set dressing stays ≥ 1.5 m off every route and ≥ 3 m off every post, start and vehicle; furniture never blocks', () => {
  const segs = [];
  for (const e of m02.enemies) { const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || []), ...(e.alarmRoute?.loop?.points || [])]; for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]); }
  for (const b of Object.values(m02.barracks || {})) for (const sq of b.squads || []) for (const r of [sq.exitRoute, sq.loop]) if (r) for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]);
  for (const id of ART) {
    const s = S(id), r = radius(s);
    assert.ok(s.fixed, `${id} authored (fixed)`);
    if (id !== 'store_hut' && id !== 'shed_sw') assert.ok(s.block <= 1, `${id} low cover`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route ${a}→${b}`);
    for (const q of [...m02.enemies, ...m02.commandos, ...m02.vehicles]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m02.furniture.every((f) => f.block === false), 'furniture is visual only');
});

test('art m02: nothing new in the camp yard or on the solution\'s way; e7 still sees e5\'s post', () => {
  const camp = [[16, 33], [42, 10], [71, 35], [46, 58]];
  for (const id of ART) assert.ok(!inPoly(S(id).x, S(id).z, camp), `${id} outside the palisade`);
  // the reference solution (tools/solutions/m02.solution.mjs): round the settlement's east side, the bank launch, the
  // landing, the hide by the SE wall, the boom, the truck and the bomb run, the drive out
  const way = [[29.5, 116.5], [31, 108], [29, 101], [31.5, 91], [43.6, 97.6], [44.5, 90], [45.2, 80], [44.6, 70], [44.2, 64.4], [45.6, 62.6],
    [48.3, 57.9], [56.8, 50.6], [55, 48], [52.9, 43.4], [50.05, 41.24], [51.6, 33.3]];
  const drive = [[50, 44], [56, 48.8], [78, 66]];
  for (const id of ART) {
    const s = S(id), r = radius(s);
    for (const L of [way, drive]) for (let i = 0; i + 1 < L.length; i++) assert.ok(segD(s.x, s.z, L[i], L[i + 1]) - r >= 3, `${id} on the solution's way`);
  }
  for (const f of m02.furniture.filter((q) => q.x != null)) for (let i = 0; i + 1 < way.length; i++) assert.ok(segD(f.x, f.z, way[i], way[i + 1]) >= 2, `furniture at ${f.x},${f.z}`);
  const e5 = m02.enemies.find((e) => e.id === 'e5'), e7 = m02.enemies.find((e) => e.id === 'e7');
  for (const p of e7.route.points) for (const id of ART) assert.ok(segD(S(id).x, S(id).z, [p.x, p.z], [e5.x, e5.z]) - radius(S(id)) > 1, `${id} cuts e7's view of e5`);
});

test('art m02: the stores stand square to the NW wall, outside it; the racks and boats lie on the SW shore, outside the settlement', () => {
  const h = S('store_hut');
  assert.ok(Math.abs(h.rot - (138.5 * Math.PI) / 180) < 1e-6, 'parallel to the NW edge (−41.5°, door NE)');
  const nw = [(42 - 16) / Math.hypot(26, 23), (10 - 33) / Math.hypot(26, 23)];
  const out = (h.x - 16) * nw[1] - (h.z - 33) * nw[0]; // + = outside (NW of the edge)
  assert.ok(out - h.d / 2 >= 4, `≥ 4 m outside the NW wall (${out.toFixed(1)})`);
  // off both MG platforms' watch lines (heading ± half their sweep, out to 40 m)
  for (const e of m02.enemies.filter((q) => q.tower)) {
    const a = Math.atan2(h.z - e.z, h.x - e.x), off = Math.abs(Math.atan2(Math.sin(a - e.post.heading), Math.cos(a - e.post.heading)));
    const half = Math.atan2(Math.hypot(h.w, h.d) / 2, Math.hypot(h.x - e.x, h.z - e.z));
    assert.ok(off - half > (e.post.sweep / 2) * Math.PI / 180, `${e.id}: the hut in his watch (${(off * 180 / Math.PI).toFixed(0)}°)`);
  }
  for (const id of ['rack_1', 'rack_2', 'boat_s1', 'boat_s2', 'boat_s3']) {
    const s = S(id);
    assert.ok(s.z + s.d / 2 < 86 - 1 && s.x < 28, `${id} between the shore and the settlement's N wall`);
  }
  for (const t of m02.structures.filter((q) => q.type === 'pine')) for (const id of ART) {
    const s = S(id);
    assert.ok(Math.hypot(t.x - s.x, t.z - s.z) > Math.min(s.w, s.d) / 2 + 0.6, `${id} through the pine at ${t.x},${t.z}`);
  }
});
