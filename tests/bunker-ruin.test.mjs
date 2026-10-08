/**
 * M3 review ("the bunker should be destroyed but not completely charred and black"): a blown-up bunker is a ruin —
 * the modelled ruin (bunker_destroyed for the snow bunker, its turf turned to snow) with a caved-in roof, broken
 * slabs, rebar and rubble (art/bunker-ruin.js) and soot only round the blast — never the old uniformly black model
 * squashed to a third of its height. Read on screen: the bunker's footprint keeps most of its brightness (the smoke
 * hidden for the measurement) and few of its pixels are near-black.
 */
export const timeout = 150_000;

export default async function bunkerRuin(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, g = G.game;
    await G.loadMission('m03');
    G.start();
    const THREE = await import('three');
    const w = g.world, it = w.interactables.find((i) => i.tag === 'dam_bunker');
    const cam = g.cameraController;
    cam.setZoom(1.6, true);
    cam.centerOn(it.x, it.z);
    const frames = (n) => { for (let i = 0; i < n; i++) { g.step(1 / 60); G.render(1 / 60, 1); } };
    frames(30);
    await new Promise((res) => setTimeout(res, 1500)); // library LODs
    frames(5);
    const S = w.structures.get('dam_bunker'), def = S.def;
    // the footprint's screen box (ground and roof corners), sampled right after a render
    const measure = () => {
      const R = g.renderer.renderer, gl = R.getContext(), camera = g.renderer.camera;
      const p = w.fx?.vfx?.pass;
      const hidden = p ? [p.smokeScene, p.hotScene, p.ambScene].filter(Boolean) : [];
      for (const sc of hidden) sc.visible = false;
      G.render(1 / 60, 1);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const c = Math.cos(def.rot), s = Math.sin(def.rot), pts = [];
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (const y of [0, 2.6]) {
        const x = def.x + (lx * def.w / 2) * c - (lz * def.d / 2) * s, z = def.z + (lx * def.w / 2) * s + (lz * def.d / 2) * c;
        const v = new THREE.Vector3(x, y, z).project(camera);
        pts.push([Math.round((v.x + 1) / 2 * W), Math.round((1 - v.y) / 2 * H)]);
      }
      const x0 = Math.max(0, Math.min(...pts.map((q) => q[0]))), x1 = Math.min(W - 1, Math.max(...pts.map((q) => q[0])));
      const y0 = Math.max(0, Math.min(...pts.map((q) => q[1]))), y1 = Math.min(H - 1, Math.max(...pts.map((q) => q[1])));
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, buf = new Uint8Array(bw * bh * 4);
      R.setRenderTarget(null);
      gl.readPixels(x0, H - 1 - y1, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (const sc of hidden) sc.visible = true;
      let sum = 0, dark = 0;
      const n = bw * bh;
      for (let i = 0; i < n; i++) {
        const l = (0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]) / 255;
        sum += l; if (l < 0.12) dark++;
      }
      return { mean: sum / n, dark: dark / n, box: [x0, y0, bw, bh] };
    };
    const intact = measure();
    const sap = w.commandos.find((c) => c.role === 'sapper');
    it.destroy(sap, 'bomb');
    frames(20);
    await new Promise((res) => setTimeout(res, 2000)); // the ruin's LODs load
    for (let i = 0; i < 60 * 40; i++) { g.step(1 / 60); if (i % 30 === 0) G.render(1 / 2, 1); }
    frames(5);
    const ruin = measure();
    const o = it.object3d;
    let burnt = 0, ruined = 0, dressing = null, turf = 0, flatTurf = 0;
    o.traverse((m) => {
      if (m.name === 'bunker_ruin') dressing = m.children.length;
      if (!m.isMesh) return;
      if (m.userData.ruined) ruined++;
      for (const mt of [].concat(m.material || [])) {
        if (mt?.color && mt.color.getHex() === 0x1d1a17) burnt++;
        if (/^kit:(sod|grass|turf).*#snow\b/.test(mt?.name || '')) { turf++; if (!mt.map) flatTurf++; }
      }
    });
    // the roof caved in: over the middle of the cave the model's surfaces (median height) lie well under the slab (2.78 m)
    const ys = [];
    const v = new THREE.Vector3();
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (!m.isMesh || !m.userData.ruined || !m.visible) return;
      const pa = m.geometry.attributes.position;
      for (let i = 0; i < pa.count; i += 3) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
        if (Math.hypot(v.x - (def.entry.charge[0] + def.x) / 2, v.z - (def.entry.charge[1] + def.z) / 2) < 0.6) ys.push(v.y);
      }
    });
    ys.sort((a, b) => a - b);
    const lowest = ys.length ? ys[ys.length >> 1] : NaN;
    return { intact, ruin, asset: o.userData.libraryAsset, scaleY: o.scale.y, burnt, ruined, dressing, lowest, turf, flatTurf };
  });
  t.log(`intact mean ${r.intact.mean.toFixed(3)} dark ${(r.intact.dark * 100).toFixed(1)}% | ruin mean ${r.ruin.mean.toFixed(3)} dark ${(r.ruin.dark * 100).toFixed(1)}% | ${r.asset}, ruined meshes ${r.ruined}, dressing ${r.dressing}, median height over the cave ${r.lowest.toFixed(2)} m`);
  await t.shot('bunker-ruin-m03');
  t.equal(r.asset, 'bunker_destroyed', 'the snow bunker becomes the modelled ruin (its base asset\'s)');
  t.equal(r.burnt, 0, 'no burnt-black material on it');
  t(r.turf > 0 && r.flatTurf === 0, `its turf is the intact model's textured snow, not a flat white sheet (${r.turf} turf, ${r.flatTurf} flat)`);
  t(r.scaleY > 0.9, `not squashed (scale.y ${r.scaleY})`);
  t(r.ruined > 0 && r.dressing >= 20, 'the ruin is wrecked: caved roof meshes and slabs / rebar / rubble');
  t(r.lowest < 2.0, `the roof caved in over the room (median height there ${r.lowest} m, the slab was at 2.78)`);
  t(r.ruin.mean > 0.7 * r.intact.mean, `the ruin keeps most of the bunker's brightness (${r.ruin.mean.toFixed(3)} vs ${r.intact.mean.toFixed(3)})`);
  t(r.ruin.dark < 0.12, `few near-black pixels: soot only round the blast (${(r.ruin.dark * 100).toFixed(1)}%)`);
}
