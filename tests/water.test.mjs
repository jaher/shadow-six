/**
 * Water integration (docs/water-pipeline.md): the GPU water system builds from the nav-grid water cells of a
 * snow mission (M2 river: current, shore ice), hooks into the engine post chain through the official hooks
 * (DepthStash after the world, Water + late decals + late FX after AO, then the VFX pass), answers gameplay queries, reacts to
 * swimmers / grenades, keeps FX on the late layer, and renders at every preset without GL errors.
 */
export default async function water(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m02');
    g.start();
    const W = G.world, wt = W.water, gr = W.grid, gl = G.renderer.renderer.getContext();
    const out = { built: !!wt };
    if (!wt) return out;
    out.hookMode = wt.system.hookMode;
    out.bodies = wt.stats.bodies;
    out.passes = G.renderer.composer.passes.map((p) => p.constructor.name + (p.enabled ? '' : '-off'));
    out.lateLayer = W.fx?.lateLayer;
    out.texturesLoaded = !!wt.system.shared.foamTex.value?.image && !!wt.system.shared.detailTex.value?.image;
    // a deep river cell near the middle of the map
    let p = null, bd = 1e9;
    for (let j = 0; j < gr.rows; j += 2) for (let i = 0; i < gr.cols; i += 2) {
      if (gr.terrain[j * gr.cols + i] !== 5) continue;
      const x = (i + 0.5) * gr.cell, z = (j + 0.5) * gr.cell, d = Math.hypot(x - 40, z - 70);
      if (d < bd) { bd = d; p = [x, z]; }
    }
    const s = wt.sample(p[0], p[1]);
    out.sample = s && { depth: s.depth, flow: Math.hypot(s.flow[0], s.flow[1]), type: s.type };
    out.dry = wt.sample(2, 2);
    g.centerOn(p[0], p[1]);
    // a swimmer and a grenade in the water → ripples/foam + a splash on the late FX layer
    const c = W.commandos.find((k) => k.role === 'diver') || W.commandos[0];
    c.stance = 'swim';
    const e0 = wt.wakes.emitted;
    gl.getError();
    for (let i = 0; i < 30; i++) { c.setPosition(p[0] + i * 0.04, p[1]); c.snap?.(); G.render(1 / 30, 1); }
    out.wakes = wt.wakes.emitted - e0;
    const n0 = W.fx.count;
    W.events.emit('explosion', { x: p[0] + 2, z: p[1] + 1, radius: 3, kind: 'grenade' });
    out.splash = W.fx.items.slice(n0).some((it) => it.kind === 'water_splash');
    out.noBlast = !W.fx.items.slice(n0).some((it) => it.kind === 'grenade'); // water column only, no dirt fountain
    for (let i = 0; i < 6; i++) g.advance(1 / 60);
    G.render(1 / 30, 1);
    out.fxAfterWater = G.renderer.composer.passes.map((p) => p.constructor.name).indexOf('FxPass') > G.renderer.composer.passes.map((p) => p.constructor.name).indexOf('LateFxPass');
    out.fxDrawn = !!W.fx.vfx?.pass.drawn;
    for (let i = 0; i < 5; i++) G.render(1 / 30, 1);
    out.glError = gl.getError();
    out.presets = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      g.setPreset(q); G.render(1 / 30, 1); G.render(1 / 30, 1);
      out.presets[q] = { quality: wt.system.qualityName, calls: g.renderStats().calls, gl: gl.getError() };
    }
    g.setPreset('high'); G.render(1 / 30, 1);
    out.updateMs = wt.stats.updateMs;
    return out;
  });
  console.log('    [water]', JSON.stringify(r));
  t.ok(r.built, 'water system built for M2');
  if (!r.built) return;
  t.equal(r.hookMode, 'official', 'official engine post hooks');
  t.ok(r.bodies.some((b) => b.type === 'river' && b.ice > 0), 'M2: river body with shore ice (snow theatre)');
  const iw = r.passes.indexOf('WaterPass'), ia = r.passes.indexOf('AlphaAwareGTAOPass'), il = r.passes.indexOf('LateFxPass');
  t.ok(r.passes.includes('DepthStashPass') && iw > ia && il > iw, `water after AO, late FX after water (${r.passes.join(',')})`);
  t.ok(r.passes.includes('RenderPass-off'), 'ground decals moved after the water (world decal pass disabled)');
  t.equal(r.lateLayer, 11, 'FX spawn on the late FX layer');
  t.ok(r.texturesLoaded, 'water textures loaded before the mission starts');
  t.ok(r.sample && r.sample.depth > 0.3 && r.sample.type === 'river', `sample() depth ${r.sample?.depth}`);
  t.ok(r.sample.flow > 0.1, `river current ${r.sample?.flow} m/s`);
  t.equal(r.dry, null, 'dry land → null');
  t.ok(r.wakes > 10, `swimmer wake disturbances (${r.wakes})`);
  t.ok(r.splash && r.noBlast, 'grenade in the water: a water splash (no dirt fountain)');
  t.ok(r.fxAfterWater && r.fxDrawn, 'VFX pass after the water + late FX passes, and drawing the splash');
  t.equal(r.glError, 0, 'no GL error while rendering water');
  for (const [q, v] of Object.entries(r.presets)) t.ok(v.quality === q && v.calls > 0 && v.gl === 0, `${q}: water quality follows the preset`);
  await t.shot('water-m02');
}
