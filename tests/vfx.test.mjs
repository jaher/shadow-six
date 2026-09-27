/**
 * VFX integration (docs/vfx-pipeline.md §6): the final library replaces the FX stub. One persistent FxPass in the
 * engine 'fx' post-hook slot (after water/late FX, before bloom/output) on every preset; game events drive the
 * effects (drum chain via the gameplay ignite, vehicle wreck, grenade, shots); chimneys and explosive drums are
 * registered from the map; camera shake respects reduced motion; no GL errors; reloading leaks no pass.
 */
export default async function vfx(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01');
    g.start();
    await G.mapHandle?.ready;
    const W = G.world, fx = W.fx, gl = G.renderer.renderer.getContext();
    const out = { lib: !!fx?.vfx, hookMode: fx?.vfx?.hookMode };
    if (!fx?.vfx) return out;
    g.advance(0.1);
    out.chimneys = fx._chimneys.length;
    out.explosives = fx._explosives.size;
    const names = () => G.renderer.composer.passes.map((p) => p.constructor.name);
    gl.getError();
    // explosive drum: gameplay ignite → barrel_explosion, prop hidden
    const drum = W.interactables.find((b) => b.interactKind === 'barrel' && !b.exploded);
    const n0 = fx.items.length;
    if (drum) { g.centerOn(drum.x, drum.z); drum.ignite(0); }
    for (let i = 0; i < 20; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
    out.drum = fx.items.slice(n0).map((i) => i.kind);
    // a grenade and a destroyed truck next to the view centre
    const cc = G.cameraController.target;
    W.events.emit('explosion', { x: cc.x + 6, z: cc.z + 3, radius: 6.75, kind: 'grenade' });
    const truck = W.vehicles.find((v) => v.def?.kind === 'land' && !v.destroyed);
    if (truck) truck.destroy(null, 'test');
    for (let i = 0; i < 40; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
    out.kinds = [...new Set(fx.items.slice(n0).map((i) => i.kind))];
    out.stats = fx.stats();
    out.drawn = fx.vfx.pass.drawn;
    out.shake = !!fx.shakeOffset();
    G.options.reducedMotion = true;
    out.shakeReduced = fx.shakeOffset();
    G.options.reducedMotion = false;
    // shots: rifle from a commando at an enemy
    const c = W.commandos[0], e = W.enemies[0];
    const n1 = fx.items.length;
    W.events.emit('shot', { from: { x: c.x, z: c.z }, to: { x: e.x, z: e.z }, shooter: c, target: e, hit: false, weapon: 'rifle' });
    out.shot = fx.items.slice(n1).map((i) => i.kind);
    G.render(1 / 60, 1);
    out.glError = gl.getError();
    out.frame = g.frameStats();
    out.presets = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      g.setPreset(q); g.advance(1 / 60); G.render(1 / 60, 1); G.render(1 / 60, 1);
      const p = names();
      out.presets[q] = { order: p.join(','), fx: p.filter((n) => n === 'FxPass').length, quality: fx.vfx.quality.name, gl: gl.getError(),
        before: p.indexOf('FxPass') < p.indexOf(p.includes('UnrealBloomPass') ? 'UnrealBloomPass' : 'OutputPass'),
        afterAO: !p.includes('AlphaAwareGTAOPass') || p.indexOf('FxPass') > p.indexOf('AlphaAwareGTAOPass'), depth: !!G.renderer.fxDepth };
    }
    g.setPreset('high'); G.render(1 / 60, 1);
    // reload: the old FX is disposed, exactly one FxPass remains
    await g.loadMission('m01');
    out.afterReload = names().filter((n) => n === 'FxPass').length;
    out.newFx = G.world.fx !== fx && !!G.world.fx?.vfx;
    return out;
  });
  console.log('    [vfx]', JSON.stringify(r));
  t.ok(r.lib, 'VFX library active on the GPU harness');
  if (!r.lib) return;
  t.equal(r.hookMode, 'official', "engine 'fx' post-hook slot");
  t.ok(r.chimneys > 0, `chimney smoke on houses (${r.chimneys})`);
  t.ok(r.explosives > 0, `explosive drums registered (${r.explosives})`);
  t.ok(r.drum.includes('barrel_explosion'), `drum → barrel_explosion (${r.drum})`);
  for (const k of ['grenade', 'explosion_small', 'burning_wreck']) t.ok(r.kinds.includes(k), `${k} spawned (${r.kinds})`);
  t.ok(r.stats.particles > 100 && r.drawn, `particles live and drawn (${r.stats.particles})`);
  t.ok(r.stats.emitters > 0, 'persistent emitters (wreck, chimneys)');
  t.ok(r.shake && r.shakeReduced === null, 'camera shake, off with reduced motion');
  t.ok(r.shot[0] === 'muzzle_flash', `shot → muzzle flash (${r.shot})`);
  t.equal(r.glError, 0, 'no GL error with live effects');
  t.ok(r.frame && Number.isFinite(r.frame.mean?.[0] ?? r.frame.mean ?? 0) && !r.frame.contextLost, 'frame finite, context alive');
  for (const [q, v] of Object.entries(r.presets)) {
    t.ok(v.fx === 1 && v.before && v.afterAO && v.depth, `${q}: one FxPass after AO/water, before bloom/output, shared depth (${v.order})`);
    t.ok(v.quality === q && v.gl === 0, `${q}: VFX quality follows the preset, no GL error`);
  }
  t.equal(r.afterReload, 1, 'reload leaves exactly one FxPass');
  t.ok(r.newFx, 'new mission, new FX instance');
  await t.shot('vfx-m01');
}
