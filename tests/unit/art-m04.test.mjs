/** M4 art pass (Restore Pride, Stokkan): the granite inner arch (with its collapsed twin), Norwegian fieldstone ruins
 *  instead of brick bomb shells, a henhouse and a log guardhouse of their own (with ruins), the drowned Panzer II on
 *  pack ice, the rendered outer wall under its iron railing, the board inner fence, the steel lattice girders of the
 *  trestle on granite pier heads; set dressing clear of every route, post and start; furniture visual only. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildWall } from '../../src/art/dressing.js';
import { buildRailBridge } from '../../src/art/kit-terrain.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const withLib = async (m, fn) => { await useManifest(m, 'm04'); try { return await fn(); } finally { await useManifest(null); } };
const m04 = MISSIONS.find((m) => m.id === 'm04');
const S = (id) => m04.structures.find((s) => s.id === id);
const segD = (px, pz, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const meshes = (o) => { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); return n; };

test('art m04: the arch, the henhouse, the guardhouse and the ruins draw the Stokkan builds (snow, with their ruins)', () => withLib(merged(), () => {
  const man = JSON.parse(readFileSync(P('assets/models/buildings/manifest-stokkan.json')));
  assert.ok(EXTRA_MANIFESTS.includes('manifest-stokkan'));
  const want = { arch: 'arch_gate_granite_no', henhouse: 'henhouse_no', jail_hut: 'jail_guardhouse_no', ruin_w1: 'ruin_fieldstone_no_a',
    ruin_w3: 'ruin_fieldstone_no_a', ruin_se1: 'ruin_fieldstone_no_b', ruin_se4: 'ruin_fieldstone_no_c' };
  for (const [id, name] of Object.entries(want)) {
    const s = S(id);
    assert.equal(s.asset, name, id);
    assert.equal(s.nav, false, `${id}: visual only, the mission's nav stays`);
    const a = man.assets[name];
    assert.ok(a && a.snowVariant === `${name}_snow` && man.assets[`${name}_snow`]?.snow, `${name} has its snow build`);
    assert.ok(pickAsset(s.type, s, { theater: 'snow', missionId: 'm04' })?.name.startsWith(name), id);
  }
  for (const n of ['arch_gate_granite_no', 'henhouse_no', 'jail_guardhouse_no']) assert.equal(man.assets[n].destroyedVariant, `${n}_destroyed`, n);
  for (const s of m04.structures.filter((q) => q.type === 'ruins' && q.variant === 'wall_ruined_stone')) assert.match(s.asset ?? '', /^ruin_fieldstone_no_/, s.id);
}));

test('art m04: the sunken tank is a drowned Panzer II wreck on pack ice (the pier deck stays the walk)', () => {
  const t = S('wreck_tank');
  assert.equal(t.type, 'pier');
  assert.equal(t.vehicleArt, 'panzer2_f');
  assert.ok(t.wreck && t.sink > 0.5 && t.ice, 'wrecked, sunk, ice crust');
});

test('art m04: the outer wall is rendered masonry under an iron railing; the inner one a board fence (not plain slabs)', () => {
  const wo = S('wall_outer'), wi = S('wall_inner');
  const o = buildWall(wo.segments[0], { variant: wo.variant, mat: wo.mat, h: wo.h, width: wo.width, id: wo.id });
  const i = buildWall(wi.segments[0], { variant: wi.variant, mat: wi.mat, h: wi.h, width: wi.width, id: wi.id });
  assert.equal(o.name, 'dressing:wall:plaster_railing');
  assert.equal(i.name, 'dressing:wall:board_fence');
  assert.ok(meshes(o) >= 3 && meshes(i) === 3, `${meshes(o)} / ${meshes(i)} meshes`);
});

test('art m04: the trestle carries steel lattice girders and granite pier heads at the mission pillars', () => {
  const b = S('bridge_rail');
  const g = buildRailBridge({ ...b });
  const plain = buildRailBridge({ ...b, variant: 'timber', pillars: [] });
  assert.ok(meshes(g) > meshes(plain) + 60, `${meshes(g)} vs ${meshes(plain)}`);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  for (const [px, pz] of b.pillars) {
    const lx = (px - b.x) * c + (pz - b.z) * s;
    let hit = false;
    g.traverse((m) => { if (m.isMesh && Math.abs(m.position.x - lx) < 0.05 && m.position.y < 0) hit = true; });
    assert.ok(hit, `pier head under pillar (${px}, ${pz})`);
  }
});

test('art m04: the set dressing stays ≥ 1.5 m off every route and ≥ 3 m off every post and start; furniture never blocks', () => {
  const ids = ['kw_villa', 'moto_villa', 'logs_hb', 'logs_jail', 'sleepers_y', 'drums_corr', 'crates_stair', 'cart_x', 'handcar_y'];
  const segs = [];
  for (const e of m04.enemies) {
    const pts = [{ x: e.x, z: e.z }, ...(e.route?.points || [])].filter((p) => p.x != null);
    for (let i = 0; i + 1 < pts.length; i++) segs.push([[pts[i].x, pts[i].z], [pts[i + 1].x, pts[i + 1].z]]);
  }
  for (const b of Object.values(m04.barracks)) for (const sq of b.squads) for (const r of [sq.exitRoute || [], sq.loop || []]) for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]);
  for (const v of m04.vehicles) { const r = v.route?.points || []; for (let i = 0; i + 1 < r.length; i++) segs.push([[r[i].x, r[i].z], [r[i + 1].x, r[i + 1].z]]); }
  for (const id of ids) {
    const s = S(id), r = Math.hypot(s.w, s.d) / 2;
    assert.ok(s && s.block <= 1 && s.fixed, `${id} low cover, authored`);
    for (const [a, b] of segs) assert.ok(segD(s.x, s.z, a, b) - r >= 1.5, `${id} on a route`);
    for (const q of [...m04.enemies, ...m04.commandos, ...m04.interactables]) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) - r >= 3, `${id} vs ${q.id ?? q.role}`);
  }
  assert.ok(m04.furniture.length >= 9 && m04.furniture.every((f) => f.block === false));
});
