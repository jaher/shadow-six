/**
 * No tree is a single billboard (user 2026-11-10: "No trees are a single billboard. All trees are detailed"). The
 * forest missions' edges at the widest zoom — M20's winter wood and hedges past the south edge, M16's summer apron
 * forest, M1's spruces — in the real game: the whole scene graph holds no impostor mesh or material, and every mesh of
 * the vegetation is either a unique tree chunk or an instanced 3D forest draw (tree-lod.js) whose every copy is a
 * whole tree's worth of triangles, never a 2-triangle card; the instanced copies are drawn in this view and cast their
 * own 3D shadows; the frame has no instanced draw of ≤ 2 triangles a copy anywhere under the vegetation.
 */
export const timeout = 600_000;

const VIEWS = [['m20', 141, 162], ['m16', 201, 150], ['m01', 65, 171]];

export default async function trees3d(page, t) {
  for (const [id, x, z] of VIEWS) {
    const r = await page.evaluate(async ({ id, x, z }) => {
      const g = window.__game, G = g.game;
      G.stop();
      g.setPreset('high');
      await g.loadMission(id);
      G.stop();
      g.start();
      const T = G.world.terrain;
      await T.ready; await T.apronReady;
      const C = G.cameraController;
      C.setZoom(0.5);
      C.centerOn(x, z);
      for (let i = 0; i < 10; i++) g.advance(1 / 30);
      for (let i = 0; i < 4; i++) G.render(1 / 60, 1);
      const out = { zoom: +C.zoom.toFixed(2), impostors: [], quads: [], meshes: { unique: 0, lod: 0 }, minLodTris: Infinity, drawn: 0, shadow: 0 };
      const inVeg = (o) => { for (let p = o.parent; p; p = p.parent) if (/^vegetation/.test(p.name)) return true; return false; };
      G.renderer.scene.traverse((o) => {
        if (!o.isMesh && !o.isSprite && !o.isPoints) return;
        const mats = [].concat(o.material || []).concat(o.customDepthMaterial || []);
        if (/impostor/i.test(o.name || '') || mats.some((m) => /impostor/i.test(m.customProgramCacheKey?.() || '') || /impostor/i.test(m.name || ''))) out.impostors.push(o.name);
        if (!inVeg(o)) return;
        if (o.isSprite || o.isPoints) { out.quads.push(`${o.name}: sprite`); return; }
        const geo = o.geometry, tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        const instanced = o.isInstancedMesh || geo.isInstancedBufferGeometry;
        if (instanced && tris <= 2) out.quads.push(`${o.name}: ${tris} tris a copy`);
        if (o.userData.treeLod) { out.meshes.lod++; out.minLodTris = Math.min(out.minLodTris, tris); }
        else if (/^veg(Bark|Leaves|Needles)$/.test(o.name)) out.meshes.unique++;
        else out.quads.push(`${o.name}: not a tree draw`);
      });
      for (const v of [T.vegetation, T.apron?.vegetation]) {
        if (!v?.lod) continue;
        out.drawn += v.lod.stats.visible;
        out.shadow += v.lod.lists.reduce((s, l) => s + l.nShadow, 0);
      }
      out.lod = (T.vegetation?.stats.lod || 0) + (T.apron?.vegetation?.stats.lod || 0);
      C.setZoom(1);
      return out;
    }, { id, x, z });
    t.log(`${id} at (${x}, ${z}) zoom ${r.zoom}: ${r.lod} instanced trees, ${r.drawn} in view, ${r.shadow} shadow copies; meshes ${JSON.stringify(r.meshes)}, fewest tris a copy ${r.minLodTris}`);
    await t.shot(`trees-3d-${id}`);
    t.ok(!r.impostors.length, `${id}: no impostor mesh or material (${r.impostors.join(', ')})`);
    t.ok(!r.quads.length, `${id}: no billboard / card draw under the vegetation (${r.quads.slice(0, 5).join('; ')})`);
    t.ok(r.lod > 0 && r.meshes.lod > 0, `${id}: the trees past the unique budget are the instanced 3D forest (${r.lod})`);
    t.ok(r.minLodTris >= 16, `${id}: every instanced copy is a 3D plant (≥ 16 triangles a copy; fewest ${r.minLodTris})`);
    t.ok(r.drawn > 0 && r.shadow > 0, `${id}: instanced trees drawn in this view (${r.drawn}) with their 3D shadows (${r.shadow})`);
  }
}
