/**
 * M2's camp ladder, left pulled up and lowered from the top of the wall by the Green Beret lying on the wall walk
 * (the M2 solution's way in, the original's):
 *  - pulled up, it is not drawn; the load's warm-up frame draws it all the same (art/ladder-frame.js `userData.warmShow`),
 *    so lowering it compiles no shader program (in the M2 walkthrough the first frame with it down — the river's mirror
 *    pass drawing it — took ~110 ms);
 *  - while he lowers it (the 'use' ability, 1 s) it swings down over the outside of the wall about its top: straight up
 *    at first, its foot coming down and out, at rest leaning on the wall when its link opens;
 *  - he lowers it lying flat, as the game has him (the deck-edge rule hides him from the camp below): his model stays in
 *    a prone clip (art/unit-anim-map.js), not the standing 'use' clip that drew him upright on the wall top.
 */
export const timeout = 600_000;

export default async function m02Ladder(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    await g.loadMission('m02');
    g.start();
    if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
    const dt = g.CONFIG.sim.dt, w = G.world, lad = w.interactables.find((i) => i.interactKind === 'ladder');
    const mesh = G.ladders?.group?.children.find((m) => m.userData.ladderLink === lad?.linkId);
    const cam = G.cameraController;
    cam.setZoom(1.1, true);
    cam.centerOn(27.2, 44);
    for (let i = 0; i < 6; i++) G.render(1 / 60, 1);
    const info = G.renderer.renderer.info;
    const before = info.programs.length, hiddenBefore = mesh ? !mesh.visible : null;
    // the drawn ladder's lowest and highest point (world y) and how far out from the wall its foot reaches
    const box = new THREE.Box3();
    const extent = () => { mesh.updateMatrixWorld(true); box.setFromObject(mesh); return { lo: box.min.y, hi: box.max.y }; };
    const rest = (() => { const q = mesh.quaternion.clone(), p = mesh.position.clone(); mesh.quaternion.identity(); mesh.position.set(0, 0, 0); const e = extent(); mesh.quaternion.copy(q); mesh.position.copy(p); mesh.updateMatrixWorld(true); return e; })();
    // the Green Beret on the wall walk by the ladder's head, lying flat, lowers it
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    gb.setPosition?.(26.5, 41.5); gb.x = 26.5; gb.z = 41.5; gb.y = 2.2; gb.path = null;
    gb.setStance('crawl'); gb._stanceT = 0;
    for (let i = 0; i < 30; i++) { G.step(dt); G.render(dt, 1); }
    const ok = gb.issue({ type: 'ability', id: 'use', target: lad });
    const samples = [], clips = new Set();
    for (let i = 0; i < 150 && !lad.lowered; i++) {
      G.step(dt); G.render(dt, 1);
      if (mesh.visible && lad.lowerStart != null) samples.push({ u: (w.time - lad.lowerStart) / lad.lowerDur, ...extent() });
      clips.add(gb.model?.clip ?? '');
    }
    for (let i = 0; i < 6; i++) { G.step(dt); G.render(dt, 1); }
    return {
      found: !!mesh, warmShow: !!mesh?.userData.warmShow, hiddenBefore, ok, lowered: !!lad.lowered, shown: !!mesh?.visible,
      atRest: mesh.position.lengthSq() < 1e-10 && Math.abs(mesh.quaternion.w) > 1 - 1e-9, rest, samples, clips: [...clips], stance: gb.stance,
      before, after: info.programs.length,
    };
  });
  const first = r.samples[0], mid = r.samples[Math.floor(r.samples.length / 2)];
  t.log(`m02 ladder: programs ${r.before} → ${r.after}; rest y ${r.rest.lo.toFixed(2)}–${r.rest.hi.toFixed(2)}; swing ${r.samples.length} frames, first lo ${first?.lo.toFixed(2)} hi ${first?.hi.toFixed(2)}, mid lo ${mid?.lo.toFixed(2)}; clips ${r.clips.join(',')}`);
  t(r.found, 'the camp ladder has a drawn mesh');
  t(r.hiddenBefore, 'pulled up: not drawn before it is lowered');
  t(r.warmShow, 'drawn in the load\'s warm-up frame all the same');
  t(r.ok, 'the Green Beret, lying on the wall walk, is given the order to lower it');
  t(r.lowered && r.shown && r.atRest, 'lowered: drawn, at rest against the wall');
  t(r.samples.length >= 30, `it swings down while he lowers it (${r.samples.length} frames)`);
  // (straight up at first: its lowest point is the wall top's, its top well above it; then its foot comes down)
  t(first && first.lo > r.rest.hi - 0.6 && first.hi > r.rest.hi + 1.5, 'at the start it stands up from the wall top');
  t(r.samples.every((s, i) => i === 0 || s.lo <= r.samples[i - 1].lo + 0.05), 'its foot only ever comes down');
  t(mid && mid.lo > r.rest.lo + 0.3, 'half-way it is still on its way down');
  t(r.stance === 'crawl' && r.clips.every((c) => /^(crawl|prone_)/.test(c)), `he stays lying flat while he lowers it (${r.clips.join(',')})`);
  t.equal(r.after, r.before, 'lowering it compiles no shader program');
}
