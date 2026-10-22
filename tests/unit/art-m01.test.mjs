/** M1 art pass (Baptism of Fire, Sola): the relay station is a signals hut of its own (board-and-batten, dipole aerial
 *  on ridge poles, lead-in post towards the mast, generator lean-to) with a blown twin; the south bank's wall is a
 *  dry-stone wall under a plank lean-to roof (not a brick box); the debris a snowed-over plank stack; the farm gains a
 *  stabbur; the road rubble is a tumbled fieldstone byre corner no higher than its 1 m low cover; set dressing stays clear of every route, post, start and of the scripted solution's legs. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm01'); try { return await fn(); } finally { await useManifest(null); } };
const m01 = MISSIONS.find((m) => m.id === 'm01');
const S = (id) => m01.structures.find((s) => s.id === id);
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};

test('art m01: the relay hut, the stabbur, the plank stack and the road rubble draw the Sola builds (snow twins; the relay blows into its ruin)', () => withLib(merged(), () => {
  const man = JSON.parse(readFileSync(P('assets/models/buildings/manifest-sola.json')));
  assert.ok(EXTRA_MANIFESTS.includes('manifest-sola'));
  for (const [id, name] of Object.entries({ relay_hut: 'relay_station_no', stabbur: 'stabbur_no', debris: 'timber_stack_no', rubble: 'rubble_fieldstone_low_no' })) {
    const s = S(id);
    assert.equal(s.asset, name, id);
    const a = man.assets[name];
    assert.ok(a && a.snowVariant === `${name}_snow` && man.assets[`${name}_snow`]?.snow, `${name} has its snow build`);
    assert.ok(pickAsset(s.type, s, { theater: 'snow', missionId: 'm01' })?.name.startsWith(name), id);
  }
  assert.equal(man.assets.relay_station_no.destroyedVariant, 'relay_station_no_destroyed');
  const rb = man.assets.rubble_fieldstone_low_no;
  assert.ok(rb.footprints.every((f) => f.block === 'LOW') && rb.height <= 1.3, 'the rubble is low cover as drawn');
  const r = S('relay_hut');
  assert.ok(r.nav === false && r.destructible && r.w === 6 && r.d === 5, 'the objective keeps its gameplay box and nav');
  // the hut stays inside its 6 x 5 footprint (the GB walks its N side to the mast and the W end to the shot)
  for (const n of ['relay_station_no', 'relay_station_no_destroyed']) {
    const fp = man.assets[n].footprints[0].points;
    for (const [x, z] of fp) assert.ok(Math.abs(x) <= 3.01 && Math.abs(z) <= 2.51, `${n} footprint (${x}, ${z})`);
  }
}));

test('art m01: the south bank wall is dry stone under a plank lean-to roof, inside its gameplay line', () => {
  const w = S('wall_s');
  const g = buildWall(w.points, { variant: w.variant, mat: w.mat, h: w.h, width: w.width, id: w.id });
  assert.equal(g.name, 'dressing:wall:drystone_leanto');
  g.updateMatrixWorld(true);
  let maxOff = 0, top = 0, n = 0;
  const v = { x: 0, y: 0, z: 0 };
  g.traverse((m) => {
    if (!m.isMesh) return;
    n++;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
      const e = m.matrixWorld.elements, x = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12], y = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13], z = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
      top = Math.max(top, y);
      let d = Infinity;
      for (let k = 0; k + 1 < w.points.length; k++) d = Math.min(d, segD(x, z, w.points[k], w.points[k + 1]));
      if (y < 1.55) maxOff = Math.max(maxOff, d);
    }
  });
  assert.ok(n >= 3, `${n} meshes`);
  assert.ok(maxOff <= w.width / 2 + 0.02, `below the eaves everything is inside the 0.6 m line (${maxOff.toFixed(3)} m)`);
  assert.ok(top <= w.h + 0.1 && top >= w.h - 0.1, `the roof makes up the gameplay height (${top.toFixed(2)} m)`);
});

test('art m01: the set dressing stays ≥ 1.5 m off every route and solution leg and ≥ 3 m off every post and start', () => {
  const ids = ['stabbur', 'logs_house', 'cart_farm', 'logs_camp', 'moto_camp', 'crates_camp', 'rack_pen'];
  const segs = [];
  for (const e of m01.enemies) {
    const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || [])].filter((p) => p.x != null);
    for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]);
  }
  // the scripted solution's walking / crawling legs (tools/solutions/m01.solution.mjs)
  const SOL = [[[16, 158], [11, 153], [6.4, 150.8], [6.1, 147.6], [13, 138], [16, 127], [19, 116], [19.5, 104]],
    [[61, 96], [61, 98.2]], [[34.6, 78.3], [50.5, 77.3], [36.05, 60.55]],
    [[9.75, 42.75], [17.5, 38], [19.8, 36.3], [23, 35], [22.8, 30], [21.8, 26.5], [22.2, 31.9]],
    [[21.3, 27], [19.5, 18], [17.4, 10.6], [16.4, 8.4], [13.4, 8.2]], [[19.3, 17.5], [17.4, 10.6], [16.6, 8.6], [3, 9.2]]];
  for (const l of SOL) for (let i = 0; i + 1 < l.length; i++) segs.push([l[i], l[i + 1]]);
  for (const id of ids) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.ok(s && s.fixed && (s.block <= 1 || s.nav === false), `${id} authored`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route (${a} → ${b})`);
    for (const q of [...m01.enemies, ...m01.commandos, ...m01.vehicles]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m01.furniture.every((f) => f.block === false));
});
