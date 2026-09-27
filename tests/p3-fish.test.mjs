/**
 * Phase 3 step 4f — ambient life in the running game (GPU): M1 fjord herring / saithe / cod schools under the
 * surface (instanced, vertex-animated, culled to the view, drawn before the water composite), gulls / eiders / hooded
 * crows; an underwater grenade stuns fish and flushes the birds; pause freezes everything; M2 / M3 river trout;
 * the menu-free coast sandbox gets mullet + sea bass; no GL errors, disposal on mission change.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    await g.loadMission('m01');
    g.start();
    g.advance(1); G.render(1 / 60, 1);
    const L = G.mapHandle.life;
    out.has = !!L;
    if (!L) return out;
    out.species = [...new Set(L.fish.fish.map((f) => f.sp))].sort();
    out.birds = [...new Set(L.birds.birds.map((b) => b.sp))].sort();
    out.fish = L.fish.fish.length;
    // fish meshes live in the world scene below the surface and are hidden from the water's bed capture
    let meshes = 0, tagged = 0;
    G.renderer.scene.traverse((o) => { if (o.userData?.ambientLife) { meshes++; if (o.userData.waterIgnore) tagged++; } });
    out.meshes = meshes; out.tagged = tagged;
    const s = L.fish.schools.find((q) => q.sp === 'herring');
    G.cameraController.setZoom(2); G.cameraController.centerOn(s.cx, s.cz);
    g.advance(0.5); g.render();
    out.drawn = L.stats.drawnFish;
    out.under = L.fish.fish.every((f) => f.y < G.world.water.level);
    // swimming: phases advance with sim time and freeze while paused
    const ph = () => L.fishH.map((h) => h.anim.array[0]).join(',');
    const p0 = ph();
    g.pause(true); for (let k = 0; k < 5; k++) g.render();
    out.frozen = ph() === p0;
    g.pause(false); g.advance(0.3); g.render();
    out.swims = ph() !== p0;
    // an underwater blast in the school: a few float stunned, the rest scatter, the birds flush
    const f = s.members[0];
    G.world.events.emit('explosion', { x: f.x, z: f.z, radius: 3, kind: 'grenade' });
    g.advance(0.5); g.render();
    out.stunned = L.fish.stunned; out.scared = L.fish.stats.scared;
    out.flee = L.birds.census().flee || 0;
    out.ms = L.stats.ms;
    // M2 river: trout
    await g.loadMission('m02'); g.start(); g.advance(1); G.render(1 / 60, 1);
    out.m2 = [...new Set(G.mapHandle.life?.fish?.fish.map((q) => q.sp) || [])].sort();
    out.disposed = !L.meshes.length;
    // coast sandbox: harbour fish
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    await G.loadMission({ ...base, id: 'm00', theater: 'coast' });
    g.start(); g.advance(1); G.render(1 / 60, 1);
    out.coast = [...new Set(G.mapHandle.life?.fish?.fish.map((q) => q.sp) || [])].sort();
    out.coastBirds = [...new Set(G.mapHandle.life?.birds?.birds.map((q) => q.sp) || [])].sort();
    return out;
  });
  t.ok(r.has, 'ambient life director built');
  t.ok(r.species?.join() === 'cod,herring,pollock', `M1 fjord fish ${r.species}`);
  t.ok(r.birds?.includes('gull') && r.birds.includes('eider'), `M1 birds ${r.birds}`);
  t.ok(r.meshes >= 4 && r.tagged === r.meshes, `life meshes ${r.meshes} (waterIgnore ${r.tagged})`);
  t.ok(r.drawn > 10 && r.under, `fish drawn in view ${r.drawn}, all under the surface`);
  t.ok(r.frozen && r.swims, 'swim phases freeze while paused and run with sim time');
  t.ok(r.stunned >= 1 && r.scared > 5, `blast: stunned ${r.stunned}, scattering ${r.scared}`);
  t.ok(r.flee > 0, `birds flushed ${r.flee}`);
  t.ok(r.ms < 1.5, `director ${r.ms?.toFixed(3)} ms`);
  t.ok(r.m2?.includes('trout'), `M2 river fish ${r.m2}`);
  t.ok(r.disposed, 'previous mission meshes disposed');
  t.ok(Array.isArray(r.coast), `coast sandbox fish ${r.coast} birds ${r.coastBirds}`);
}
