/**
 * Canvas covers on the vehicle-LIBRARY path (feat/vehicle-integration swaps these models in): the quantized Opel Blitz
 * cargo GLB and the Kübelwagen with its top up go through the shared `applyCanvasCover` (as vehicle-model.js will),
 * parked and driving in M2's wind. Read back from the GPU: seams welded (< 1 mm), nearby unwelded parts move together,
 * slow motion, taut car top barely moves.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, P = await import('/tests/cloth-probe.mjs'), C = await import('/src/art/cloth-wind.js');
    const L = await import('/src/art/vehicle-library.js');
    await g.loadMission('m02'); g.start(); g.advance(0.2);
    await L.loadVehicleLibrary(null, { base: 'assets/' });
    const out = [];
    for (const [asset, o] of [['opel_blitz_cargo', { rear: -1 }], ['kubelwagen', { rear: -1, taut: 0.35 }]]) {
      const vis = L.createVehicleVisual(asset, { theater: 'snow', asset, paint: asset === 'kubelwagen' ? 'grey_top' : 'grey' });
      await vis.ready;
      const root = vis.object3d; root.position.set(30, 0, 60); G.renderer.scene.add(root); root.updateMatrixWorld(true);
      const covers = [];
      root.traverse((m) => {
        if (!m.isMesh || !/canvas/i.test(m.material?.name || '')) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox, e = m.matrixWorld.elements, s = Math.hypot(e[0], e[1], e[2]);
        if ((b.max.y - b.min.y) * s < 0.3 || (b.max.z - b.min.z) * s < 1) return; // seat cushions / straps stay put
        C.applyCanvasCover(m, o); covers.push(m);
      });
      const res = { asset: vis.model || asset, covers: covers.length, runs: [] };
      for (const mesh of covers.slice(0, 1)) for (const speed of [0, 9]) {
        const pr = P.makeProbe(G.renderer.renderer, mesh), F = 120, ser = [], pick = [], A = mesh.geometry.attributes;
        let groups = null, gap = 0, near = null, grow = 0, stretch = 0;
        const edges = P.triEdges(mesh.geometry);
        for (let k = -60; k < F; k++) {
          const tt = 600 + k / 60, sx = speed * (k + 60) / 60;
          root.position.set(30 + sx, 0, 60); root.updateMatrixWorld(true);
          G.world.wind.frame(tt, { x: root.position.x, z: 60 });
          const p = pr.read(), rest = pr.rest();
          if (!groups) { groups = P.seamGroups(rest); near = P.nearPairs(rest, 2e-3, 0.04); for (let i = 0; i < pr.n; i += 5) if (A.aFlap.getX(i) > 0.3) { pick.push(i); ser.push(new Float32Array(F)); } }
          if (k < 0) continue;
          gap = Math.max(gap, P.maxGap(p, groups)); grow = Math.max(grow, P.maxGrowth(p, near)); stretch = Math.max(stretch, P.maxStretch(p, rest, edges));
          pick.forEach((i, j) => { ser[j][k] = Math.hypot(p[i * 3] - rest[i * 3], p[i * 3 + 1] - rest[i * 3 + 1], p[i * 3 + 2] - rest[i * 3 + 2]); });
        }
        res.runs.push({ speed, verts: pr.n, groups: groups.length, moving: pick.length, gapMm: +(gap * 1000).toFixed(3), nearPairs: near.length / 3, growMm: +(grow * 1000).toFixed(2), stretchPct: +(stretch * 100).toFixed(1), ...(pick.length ? P.spectrum(ser, 60, 2) : {}) });
        pr.dispose();
      }
      root.removeFromParent();
      out.push(res);
    }
    return out;
  });
  t.log(JSON.stringify(r));
  const [blitz, kubel] = r;
  t.ok(blitz.covers >= 1, `library Opel Blitz: canvas cover found (${blitz.covers})`);
  t.ok(kubel.covers >= 1, `library Kübelwagen (top up): canvas top found (${kubel.covers})`);
  for (const v of r) for (const k of v.runs) {
    const tag = `${v.asset} ${k.speed} m/s`;
    t.ok(k.gapMm < 1, `${tag}: seams welded (max gap ${k.gapMm} mm over ${k.groups} seam groups)`);
    t.ok(k.growMm < 12, `${tag}: nearby unwelded vertices (inner / outer skin, panel edges) move together (${k.nearPairs} pairs, ≤ ${k.growMm} mm)`);
    t.ok(k.stretchPct < 30, `${tag}: edge stretch ${k.stretchPct} %`);
    if (k.moving) t.ok(k.centroid < 1.6 && k.hiFrac < 0.1, `${tag}: slow (centroid ${k.centroid} Hz, ${(k.hiFrac * 100).toFixed(1)} % > 2 Hz)`);
  }
  const bp = Math.max(...blitz.runs.map((k) => k.ptp || 0)), kp = Math.max(...kubel.runs.map((k) => k.ptp || 0));
  t.ok(bp > 0.005 && bp < 0.3, `Blitz cover billows (${bp} m)`);
  t.ok(kp < 0.04 && kp < bp, `taut car top barely ripples (${kp} m < ${bp} m)`);
}
