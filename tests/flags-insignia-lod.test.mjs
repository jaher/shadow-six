/**
 * Flags zoomed out (user 2026-10-07 "flags when you zoom out you can see a static black flag"): the barracks kits carry
 * their own baked flag at every LOD (`flag.001` at LOD0, `flag_lod1` / `flag_lod2` coarser). Only the LOD0 one was
 * stripped, so at 0.5× (LOD1) a static, dark kit flag hung behind the waving one. At every building LOD no baked flag
 * is drawn, the spec cloth is still there with its flag texture, and it keeps waving at 0.5×.
 */
export default async function flagsLod(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const BL = await import('/src/art/building-library.js');
    await g.loadMission('m03');
    g.start();
    const out = {};
    const KIT_FLAG = /^flag(\.?\d+|_lod\d+)?$/; // the kits' own flag nodes at LOD0/1/2 (test-side, not the game's regex)
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const scan = () => {
      const baked = [], cloths = [];
      G.renderer.scene.traverse((o) => {
        if (!o.isMesh) return;
        let bld = null, flagAnc = null;
        for (let p = o, k = 0; p; p = p.parent, k++) {
          if (k <= 3 && KIT_FLAG.test(p.name) && !flagAnc) flagAnc = p.name;
          if (/^building:/.test(p.name)) { bld = p.name; break; }
        }
        if (!bld) return;
        if (flagAnc && shown(o)) baked.push(`${bld}/${flagAnc}`);
        if (o.name === 'flag_cloth' && shown(o)) cloths.push(o);
      });
      return { baked, cloths };
    };
    for (const [label, zoom, bz] of [['z1', 1, null], ['z0.5', 0.5, null], ['lod2', 0.5, 0.3]]) {
      g.setZoom(zoom);
      g.centerOn(16, 82);
      for (let i = 0; i < 20; i++) { g.step(); G.render(1 / 60, 1); }
      if (bz != null) BL.setBuildingZoom(bz); // the coarsest LOD ('low' quality draws it at 0.5×)
      G.render(1 / 60, 1);
      const s = scan();
      const lods = [];
      G.renderer.scene.traverse((o) => { if (o.name === 'building:barracks_b_snow:st_barr1') lods.push(o.children.filter((c) => /^lod\d$/.test(c.name) && c.visible).map((c) => c.name).join()); });
      out[label] = { baked: s.baked, cloths: s.cloths.length, maps: [...new Set(s.cloths.map((c) => c.material.map?.name))], lod: lods.join() };
      if (label === 'z0.5') {
        // still waving zoomed out: the cloth vertices move between frames
        const c = s.cloths.find((q) => Math.hypot(q.matrixWorld.elements[12] - 16, q.matrixWorld.elements[14] - 82) < 12) || s.cloths[0];
        const a0 = Array.from(c.geometry.attributes.position.array);
        for (let i = 0; i < 30; i++) { g.step(); G.render(1 / 60, 1); }
        const a1 = c.geometry.attributes.position.array;
        let d = 0; for (let i = 0; i < a1.length; i++) d = Math.max(d, Math.abs(a1[i] - a0[i]));
        out.waveZoomOut = d;
      }
    }
    BL.setBuildingZoom(G.cameraController?.camera?.zoom ?? 1);
    return out;
  });
  t.log(JSON.stringify(r));
  for (const k of ['z1', 'z0.5', 'lod2']) {
    t.equal(r[k].baked.length, 0, `${k}: no baked kit flag drawn (${r[k].baked.join(', ')}) [LOD ${r[k].lod}]`);
    t(r[k].cloths >= 2, `${k}: the spec cloths are drawn (${r[k].cloths})`);
    t(r[k].maps.every((m) => /^flag_/.test(m || '')), `${k}: with their flag texture (${r[k].maps})`);
  }
  t.equal(r['z0.5'].lod, 'lod1', 'zoomed out the barracks shows LOD1');
  t.equal(r.lod2.lod, 'lod2', 'forced coarsest LOD');
  t(r.waveZoomOut > 0.01, `the cloth keeps waving zoomed out (max vertex move ${r.waveZoomOut?.toFixed(3)} m)`);
}
