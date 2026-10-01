/**
 * Enemy flags (GPU): the default INSIGNIA is the historical German national flag 1935–45 — red field, white disc 3/4 of
 * the height with its centre 1/20 of the length toward the hoist, black swastika at the disc centre, 3:5 cloth — and
 * Options → INSIGNIA → NEUTRAL repaints the same live flags as the field-grey Balkenkreuz banner (and back).
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const T = await import('/src/art/flag-textures.js');
    await g.loadMission('m02');
    g.start();
    const cloths = [];
    G.renderer.scene.traverse((o) => { if (o.name === 'flag_cloth' && o.isMesh) cloths.push(o); });
    out.count = cloths.length;
    const mats = () => [...new Set(cloths.map((c) => c.material))];
    out.mapsHist = mats().map((m) => m.map?.name);
    const c0 = cloths[0], p = c0.geometry.parameters;
    out.aspect = p.height / p.width;
    // sample the canvas the GPU texture comes from
    const img = c0.material.map.image, W = img.width, H = img.height;
    const px = (u, v) => Array.from(img.getContext('2d').getImageData(Math.round(u * W), Math.round(v * H), 1, 1).data);
    const cu = T.DISC.u, R = T.DISC.rv * H;
    out.field = px(0.2, 0.12);
    out.centre = px(cu, 0.5);
    out.discTop = px(cu, 0.5 - (0.92 * R) / H);
    out.hoistSideIn = px(cu - (R - 8) / W, 0.5); // disc edge toward the hoist: still white
    out.flySideOut = px(cu + (R + 8) / W, 0.5); // just past the disc on the fly side: red
    out.discOffsetPx = (0.5 - cu) * W; // = W/20
    G.cameraController.centerOn(c0.matrixWorld.elements[12], c0.matrixWorld.elements[14]);
    for (let k = 0; k < 20; k++) { g.advance(1 / 10); g.render(); }
    G.hud.setOption('insignia', 'neutral', { quiet: true });
    out.mapsNeutral = mats().map((m) => m.map?.name);
    out.neutralField = Array.from(c0.material.map.image.getContext('2d').getImageData(Math.round(0.2 * W), Math.round(0.12 * H), 1, 1).data);
    out.saved = JSON.parse(localStorage.getItem('shadowsix.options.v1') || '{}').insignia ?? null;
    g.render();
    G.hud.setOption('insignia', 'historical', { quiet: true });
    out.mapsBack = mats().map((m) => m.map?.name);
    g.render();
    return out;
  });
  const red = (c) => c[0] > 130 && c[0] > c[1] * 2.2 && c[0] > c[2] * 2.2;
  const white = (c) => c[0] > 190 && c[1] > 185 && c[2] > 170;
  const black = (c) => c[0] < 60 && c[1] < 60 && c[2] < 60;
  t.ok(r.count >= 1, `M2 has enemy flags (${r.count})`);
  t.ok(r.mapsHist.length && r.mapsHist.every((n) => /^flag_historical:/.test(n)), `historical by default: ${r.mapsHist}`);
  t.ok(Math.abs(r.aspect - 0.6) < 0.08, `3:5 cloth (${r.aspect.toFixed(3)})`);
  t.ok(red(r.field), `red field ${r.field}`);
  t.ok(black(r.centre), `black swastika at the disc centre ${r.centre}`);
  t.ok(white(r.discTop) && white(r.hoistSideIn), `white disc ${r.discTop} ${r.hoistSideIn}`);
  t.ok(red(r.flySideOut), `disc ends before the fly side ${r.flySideOut}`);
  t.ok(Math.abs(r.discOffsetPx - 32) < 1, `disc centre 1/20 of the length toward the hoist (${r.discOffsetPx}px of 640)`);
  t.ok(r.mapsNeutral.every((n) => /^flag_neutral:/.test(n)), `NEUTRAL repaints live flags: ${r.mapsNeutral}`);
  t.ok(!red(r.neutralField) && Math.abs(r.neutralField[0] - r.neutralField[1]) < 30, `field grey ${r.neutralField}`);
  t.ok(r.saved === 'neutral', `saved setting ${r.saved}`);
  t.ok(r.mapsBack.every((n) => /^flag_historical:/.test(n)), 'back to HISTORICAL');
  await t.shot('flags-insignia');
}
