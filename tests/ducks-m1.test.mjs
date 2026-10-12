/**
 * M1 ducks in the running game (GPU): the common eiders on the fjord (drakes and hens), the duck model with its
 * per-fragment plumage (drawn, no GL errors), the V wakes on the late FX layer behind paddling ducks, a gunshot
 * that makes the flock run off across the water and fly, the director cost, and a frame that is not black / NaN.
 * User request: "make the ducks more realistic (as seen in mission 1)".
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    await g.loadMission('m01');
    g.start();
    g.advance(0.5); G.render(1 / 60, 1);
    const L = G.mapHandle.life;
    if (!L) return out;
    const D = L.birds.birds.filter((b) => b.kind === 'duck');
    out.n = D.length; out.sp = [...new Set(D.map((b) => b.sp))]; out.hens = D.filter((b) => b.hen).length;
    const c = D.reduce((a, b) => [a[0] + b.x / D.length, a[1] + b.z / D.length], [0, 0]);
    G.cameraController.setZoom(2); G.cameraController.centerOn(c[0], c[1]);
    for (let k = 0; k < 600; k++) { g.advance(1 / 60); G.render(1 / 60, 1); } // 10 s of swimming, rendered every step
    const h = L.birdH.find((q) => q.duck);
    out.drawn = h?.mesh.count ?? 0;
    out.tris = h ? h.mesh.geometry.index.count / 3 : 0;
    out.wake = !!L.wakes && L.wakes.mesh.layers.mask === (1 << 11) && L.wakes.mesh.parent != null;
    let maxW = 0;
    for (let k = 0; k < 240; k++) { g.advance(1 / 60); G.render(1 / 60, 1); maxW = Math.max(maxW, L.stats.wakeTris || 0); }
    out.wakeTris = maxW;
    out.inWater = D.every((b) => b.hidden || G.world.water.sample(b.x, b.z));
    const fs = g.frameStats?.(); out.frame = fs ? { luma: fs.luma, lost: !!fs.contextLost } : null;
    // a rifle shot 25 m off: the flock runs off across the water, then flies
    G.world.events.emit('shot', { from: { x: c[0] + 20, z: c[1] + 15 }, to: { x: c[0] + 30, z: c[1] + 25 }, hit: false, weapon: 'rifle' });
    let ran = 0, flew = 0;
    for (let k = 0; k < 300; k++) {
      g.advance(1 / 60); G.render(1 / 60, 1);
      for (const b of D) { if (b.run && b.run.t > 0 && b.v > 3) b._ran = 1; if ((b.st === 'flee' || b.st === 'fly') && !b.run && b.y > 0.5) b._flew = 1; }
    }
    ran = D.filter((b) => b._ran).length; flew = D.filter((b) => b._flew).length;
    out.ran = ran; out.flew = flew; out.splashes = L.birds.stats.splashes;
    // director cost (sims, threats, culling, instance + wake upload) at a 60 Hz step
    let ms = 0;
    for (let k = 0; k < 120; k++) { g.advance(1 / 60); const t0 = performance.now(); L.frame(1 / 60, G.renderer.camera); ms += performance.now() - t0; }
    out.ms = ms / 120;
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.n >= 4 && r.sp?.join() === 'eider', `M1 eiders ${r.n} (${r.sp})`);
  t.ok(r.hens >= 1 && r.hens < r.n, `drakes and hens mixed (${r.hens} hens)`);
  t.ok(r.drawn >= 2 && r.tris > 250 && r.tris < 360, `ducks drawn ${r.drawn}, ${r.tris} triangles each`);
  t.ok(r.wake && r.wakeTris > 20, `V wakes on the late FX layer (${r.wakeTris} triangles)`);
  t.ok(r.inWater, 'ducks stay on the water');
  t.ok(!r.frame || (!r.frame.lost && r.frame.luma > 5), `frame ${JSON.stringify(r.frame)}`);
  t.ok(r.ran >= Math.min(4, r.n - 2), `the flock runs off across the water (${r.ran})`);
  t.ok(r.flew >= Math.min(4, r.n - 2), `… and flies (${r.flew})`);
  t.ok(r.ms < 1.0, `director ${r.ms?.toFixed(3)} ms`);
}
