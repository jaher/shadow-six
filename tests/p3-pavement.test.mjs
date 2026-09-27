/**
 * Phase 3 step 3p — pavement, roads & street furniture in the running game (GPU): the dev gallery builds every hard
 * surface (setts + kerbs + sidewalks + tram rails, tar macadam with craters / manholes, Belgian blocks, fan pavé,
 * herringbone brick, concrete apron, granite quay with bollards), soft roads live in the terrain splat, grass and
 * clutter stay off the paving, sidewalks lift walkers, stone takes no prints; lamps / Morris column / signs /
 * crossing / telegraph wires; at night the glass glows, light pools + a fixed pool of real lights follow the view;
 * presets swap POM steps; M1-M3 carry their authored networks; everything is disposed on mission change.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const gallery = (await import('/src/missions/dev/pavement-gallery.js')).default;
    await G.loadMission(gallery);
    g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const H = G.mapHandle, W = G.world;
    out.pave = H.pavement?.stats; out.furn = H.furniture?.stats;
    out.surf = [W.roads.surfaceAt(20, 40), W.roads.surfaceAt(55, 5), W.roads.surfaceAt(35, 58), W.roads.surfaceAt(90, 15), W.roads.surfaceAt(30, 75), W.roads.surfaceAt(100, 61)];
    out.lift = +(W.groundY(20, 45.4) - W.terrain.heightAt(20, 45.4)).toFixed(3);
    out.printStone = W.terrain.printVisibility(20, 40, 0);
    out.printMud = W.terrain.printVisibility(95, 70, 0);
    // no grass tufts on hard paving: every grass instance sits off the pavement
    let tufts = 0, onPave = 0;
    W.terrain.terrain?.grass?.group.traverse((o) => {
      const a = o.geometry?.attributes?.iOff;
      if (a) for (let i = 0; i < a.count; i += 3) { tufts++; if (W.roads.covers(a.getX(i), a.getZ(i))) onPave++; }
    });
    out.tufts = tufts; out.onPave = onPave;
    // presets: POM steps follow
    const mat = H.pavement.materials[0];
    H.pavement.setQuality('low'); out.pomLow = mat.userData.pavement.uPvTex.value.z;
    H.pavement.setQuality('high'); out.pomHigh = mat.userData.pavement.uPvTex.value.z;
    out.day = { lights: H.streetLights?.stats.lights ?? -1, glass: H.furniture.group.children.find((o) => o.userData.lampGlass)?.material.emissiveIntensity };
    const oldGroup = H.pavement.group;
    // night: glowing glass, pools, pooled real lights following the view
    await G.loadMission({ ...gallery, lighting: { ...gallery.lighting, hdri: 'night', night: true } });
    g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    G.cameraController.setZoom(1); G.cameraController.centerOn(35, 58); g.advance(0.2); g.render(); g.render();
    const S = G.mapHandle.streetLights;
    out.night = { lit: S?.stats.lit, lights: S?.stats.lights, assigned: S?.stats.assigned, preset: G.renderer.presetName,
      glass: G.mapHandle.furniture.group.children.find((o) => o.userData.lampGlass)?.material.emissiveIntensity,
      near: S?.lights.filter((L) => L.intensity > 0).map((L) => Math.hypot(L.position.x - 35, L.position.z - 58)).sort((a, b) => a - b)[0] };
    out.oldGone = !oldGroup.parent;
    // BEL missions: authored networks
    for (const id of ['m01', 'm02', 'm03']) {
      await g.loadMission(id); g.start(); g.advance(0.3); G.render(1 / 60, 1);
      await G.mapHandle.ready;
      out[id] = { areas: G.mapHandle.pavement?.stats.areas ?? 0, lamps: G.mapHandle.furniture?.stats.lamps ?? 0, wires: G.mapHandle.furniture?.stats.wireSpans ?? 0,
        roads: G.world.roads.net.roads.length, ms: (G.mapHandle.pavement?.stats.ms ?? 0) };
    }
    return out;
  });
  t.ok(r.pave?.roads === 3 && r.pave.areas === 5 && r.pave.drains > 4 && r.pave.manholes > 2 && r.pave.bollards > 4 && r.pave.rails > 100, `gallery pavement ${JSON.stringify(r.pave)}`);
  t.ok(r.furn?.lamps >= 20 && r.furn.props >= 10 && r.furn.poles >= 3 && r.furn.wireSpans >= 12 && r.furn.fences === 3, `gallery furniture ${JSON.stringify(r.furn)}`);
  t.ok(r.surf.join() === 'setts,asphalt,pave_fan,concrete,quay,gravel', `surfaces ${r.surf}`);
  t.ok(Math.abs(r.lift - 0.14) < 0.02, `sidewalk lifts walkers ${r.lift}`);
  t.ok(r.printStone < 0.05 && r.printMud > 0.5, `prints: stone ${r.printStone}, mud ${r.printMud}`);
  t.ok(r.tufts > 1000 && r.onPave === 0, `grass off the paving (${r.onPave}/${r.tufts})`);
  t.ok(r.pomLow === 0 && r.pomHigh > 8, `POM steps low ${r.pomLow} high ${r.pomHigh}`);
  t.ok(r.day.lights === 0 && r.day.glass === 0, `daytime: lamps off ${JSON.stringify(r.day)}`);
  t.ok(r.night.lit > 15 && r.night.lights >= 3 && r.night.assigned === r.night.lights && r.night.glass > 2 && r.night.near < 12, `night ${JSON.stringify(r.night)}`);
  t.ok(r.oldGone, 'previous pavement disposed');
  t.ok(r.m01.areas === 1 && r.m01.lamps >= 5 && r.m01.wires === 16 && r.m01.roads === 2, `M1 ${JSON.stringify(r.m01)}`);
  t.ok(r.m02.lamps >= 4 && r.m02.roads === 4 && r.m02.wires > 0, `M2 ${JSON.stringify(r.m02)}`);
  t.ok(r.m03.areas === 2 && r.m03.lamps >= 6 && r.m03.roads === 4, `M3 ${JSON.stringify(r.m03)}`);
}
