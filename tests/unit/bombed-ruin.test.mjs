/** scripts/bombed-ruin.js: every mission's bombed brick ruin (M4 SE farm ruins, M6 ruin_s, M7 ruins field) has the
 *  drawn model's own walls, breach and rubble as its gameplay parts at the fit it is drawn at, its walls as tall as the
 *  drawn top, and its parts in the grid where the model stands. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale, assetExtents } from '../../src/art/building-props.js';
import { buildingMeta, mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { MISSIONS } from '../../src/missions/index.js';
import { bombedRuinNav, BOMBED_RUIN_NAV } from '../../src/missions/scripts/bombed-ruin.js';
import { loadGrid } from './mission-check.mjs';
import { B } from '../../src/world/grid.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const merged = () => {
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return m;
};
const ruins = () => MISSIONS.flatMap((mis) => (mis.structures || []).filter((s) => s.variant === 'bombed_brick').map((s) => ({ mis, s })));

test('bombed ruins: M4, M6 and M7 draw house_bombed_b; the parts are the sidecar\'s at the drawn fit, the walls as tall as its top', async () => {
  const m = merged(), found = new Set();
  for (const { mis, s } of ruins()) {
    found.add(mis.id);
    await useManifest(m, mis.id);
    try {
      const pk = pickAsset(s.type, s, { theater: mis.theater, missionId: mis.id });
      assert.equal(pk?.name, 'house_bombed_b', `${mis.id} ${s.id}`);
      const meta = buildingMeta(pk.name), ext = assetExtents(pk.name), ew = pk.turn ? ext.d : ext.w, ed = pk.turn ? ext.w : ext.d;
      const hs = meta.doors.filter((d) => d.kind !== 'gate' && d.height < 3.2).map((d) => d.height);
      const f = fitScale(s.w / ew, s.d / ed, hs.length ? Math.max(...hs) : 0);
      assert.deepEqual(s.navParts, bombedRuinNav(f.sx, f.sz), `${mis.id} ${s.id}: parts at fit ${f.sx.toFixed(3)} × ${f.sz.toFixed(3)}`);
      assert.ok(s.h >= m.assets[pk.name].bbox.max[1] * f.sy - 0.3 && s.nav === false && s.block === 0, `${mis.id} ${s.id}: h ${s.h}`);
      // every sidecar wall, breach and rubble part outside the shell is a part (the shell's inner walls and stairs aside)
      const box = (pts) => { const q = pts.map(([px, pz]) => { let x = px - ext.cx, z = pz - ext.cz; if (pk.turn) [x, z] = [-z, x]; return [x * f.sx, z * f.sz]; }); const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; };
      const shell = box(meta.footprints.filter((fp) => fp.kind === 'wall').flatMap((fp) => fp.points));
      const outer = meta.footprints.filter((fp) => fp.block && fp.kind !== 'stairs').map((fp) => box(fp.points))
        .filter((b) => !(b.x0 >= shell.x0 + 0.3 && b.x1 <= shell.x1 - 0.3 && b.z0 >= shell.z0 + 0.3 && b.z1 <= shell.z1 - 0.3));
      for (const b of outer) assert.ok(s.navParts.some((p) => Math.abs(p.x - (b.x0 + b.x1) / 2) < 0.03 && Math.abs(p.z - (b.z0 + b.z1) / 2) < 0.03 && Math.abs(p.w - (b.x1 - b.x0)) < 0.03 && Math.abs(p.d - (b.z1 - b.z0)) < 0.03), `${mis.id} ${s.id}: part ${JSON.stringify(b)}`);
      assert.equal(s.navParts.length, outer.length + 1, `${mis.id} ${s.id}: the sidecar's parts and the fill inside`);
    } finally { await useManifest(null); }
  }
  assert.deepEqual([...found].sort(), ['m04', 'm06', 'm07']);
  assert.equal(bombedRuinNav(), BOMBED_RUIN_NAV);
});

test('bombed ruins: in each grid the shell walls are B.HIGH, the breach, the rubble and the inside B.LOW', () => {
  const byMission = new Map();
  for (const { mis, s } of ruins()) { if (!byMission.has(mis)) byMission.set(mis, []); byMission.get(mis).push(s); }
  for (const [mis, list] of byMission) {
    const { grid } = loadGrid(mis);
    for (const r of list) {
      const c = Math.cos(r.rot || 0), sn = Math.sin(r.rot || 0), at = (dx, dz) => grid.blockAt(r.x + dx * c - dz * sn, r.z + dx * sn + dz * c);
      const P2 = (i) => r.navParts[i];
      const W = r.navParts.filter((p) => p.block === 2), Lw = r.navParts.filter((p) => p.block === 1);
      for (const p of W) assert.equal(at(p.x, p.z), B.HIGH, `${mis.id} ${r.id} wall at ${p.x},${p.z}`);
      for (const p of Lw.slice(1)) assert.equal(at(p.x, p.z), B.LOW, `${mis.id} ${r.id} low part at ${p.x},${p.z}`);
      assert.equal(at(P2(0).x - 1, P2(0).z), B.LOW, `${mis.id} ${r.id}: the inside`);
    }
  }
});
