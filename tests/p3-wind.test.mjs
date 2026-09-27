/**
 * Phase 3 step 4w — wind in the running game (GPU): one WindField per mission publishes its uniforms at SIM time
 * (frozen while paused), cloth flags move with it, trees/grass/water/characters/tarps compile with the wind chunk,
 * the wind FX director shakes snow off pines / raises dust devils, and audio gets gust + halyard events.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const W = await import('/src/world/wind.js');
    await g.loadMission('m02');
    g.start();
    const w = G.world;
    out.preset = w.wind.preset;
    // strong fjord gale so every consumer is exercised
    const ev = w.wind.events;
    w.wind = new W.WindField(W.resolveWind({ theater: 'snow', weather: { wind: { preset: 'fjord', speed: 14, gustiness: 1 } } }), { W: w.width, D: w.depth });
    w.wind.events = ev;
    const gusts = [], clanks = [];
    w.events.on('wind:gust', (e) => gusts.push(e));
    w.events.on('wind:flag', (e) => clanks.push(e));
    G.cameraController.centerOn(36, 26);
    const flag = [];
    G.renderer.scene.traverse((o) => { if (o.name === 'flag_cloth' && o.userData.cloth?.sim) flag.push(o); });
    out.flags = flag.length;
    const d2 = (o) => { const e = o.matrixWorld.elements; return (e[12] - 36) ** 2 + (e[14] - 30) ** 2; };
    flag.sort((p, q) => d2(p) - d2(q)); // the barracks flag in view (off-screen cloths are not simulated)
    const pos = () => Array.from(flag[0].geometry.attributes.position.array.slice(0, 450));
    for (let k = 0; k < 90; k++) { g.advance(1 / 3); g.render(); }
    const a = pos();
    out.uniformT = W.WIND_UNIFORMS.uWindA.value[3];
    // pause: rendering on does not move anything
    g.pause(true);
    for (let k = 0; k < 20; k++) g.render();
    out.frozen = JSON.stringify(pos()) === JSON.stringify(a) && W.WIND_UNIFORMS.uWindA.value[3] === out.uniformT;
    g.pause(false);
    g.advance(0.5); g.render();
    out.moved = JSON.stringify(pos()) !== JSON.stringify(a);
    out.gusts = gusts.length; out.clanks = clanks.length;
    out.fx = { ...G.mapHandle.windFx?.stats };
    out.particles = G.mapHandle.windFx?.particles?.blow ?? null;
    // clothing flutter on the real characters
    let flutter = 0, wrapped = 0;
    for (const u of [...w.commandos, ...w.enemies]) u.model?.root?.traverse?.((o) => { if (o.geometry?.attributes?.aFlutter) flutter++; if (o.material?.userData?.clothWind) wrapped++; });
    out.flutter = flutter; out.wrapped = wrapped;
    // desert sandbox: dust devils + truck canvas flap
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    await G.loadMission({ ...base, id: 'm00', theater: 'desert', enemies: [], vehicles: [{ id: 'tA', vehicleType: 'opel_blitz', x: 20, z: 20, heading: 0 }] });
    g.start();
    out.desert = G.world.wind.preset;
    let devilAt = 0; while (!G.world.wind.devil(devilAt) && devilAt < 60) devilAt += 1;
    g.advance(devilAt + 2 - G.world.time); G.render(1 / 60, 1);
    for (let k = 0; k < 30; k++) { g.advance(0.1); g.render(); }
    out.devils = G.mapHandle.windFx?.stats.devils ?? 0;
    const truck = G.world.entities.find((e) => e.kind === 'vehicle');
    let canvas = false; truck?.model?.root?.traverse((o) => { if (o.geometry?.attributes?.aFlap && o.material?.userData?.windFlap) canvas = true; });
    out.canvas = canvas;
    out.sand = G.mapHandle.windFx?.particles?.blow ?? null;
    return out;
  });
  t.ok(r.preset === 'snow', `M2 wind preset ${r.preset}`);
  t.ok(r.flags >= 1, `simulated flags ${r.flags}`);
  t.ok(r.frozen, 'paused → wind uniforms and cloth frozen');
  t.ok(r.moved, 'the flag moves again after unpausing');
  t.ok(r.gusts > 0, `gust events ${r.gusts}`);
  t.ok(r.fx.puffs > 0, `snow shaken off pines: ${r.fx.puffs}`);
  t.ok(r.flutter > 0 && r.wrapped > 0, `clothing flutter meshes ${r.flutter}`);
  t.ok(r.particles === 'snow' && r.sand === 'sand', `blown particles ${r.particles} / ${r.sand}`);
  t.ok(r.desert === 'desert' && r.devils > 0, `dust devil slices ${r.devils}`);
  t.ok(r.canvas, 'Opel Blitz canvas flaps');
}
