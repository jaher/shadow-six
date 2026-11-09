/**
 * M6: the Leopold blown up (user: "The Leopold train should look more realistic when burning. It looks like a flat black
 * rectangle"). Its destroyed state shows the K5's wreck (art/railgun-wreck.js) in place of the gun — the same size, no
 * slump — and links no shader program (built and drawn at load: the vehicle warm-up and the warm-up frame), and on
 * screen it is not a near-uniform dark slab: the luminance over the wreck's own pixels (a mask pass drawing only the gun)
 * varies — scorched paint, rust, soot, bare metal, torn edges catching the light — well above what the old flat black
 * squashed model gives the same pixels' worth of gun.
 */
export const timeout = 600_000;

export default async function leopoldWreck(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    g.setPreset('high');
    await g.loadMission('m06');
    g.start();
    if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
    const w = G.world, it = w.interactables.find((i) => i.tag === 'leopold');
    const VL = await import('/src/art/vehicle-library.js');
    const vis = VL.liveVehicleVisuals().find((x) => x.asset === 'railgun_k5');
    const cam = G.cameraController;
    cam.setYaw(15); cam.setZoom(1.5, true); cam.centerOn(106, 62.5);
    for (let i = 0; i < 6; i++) G.render(1 / 60, 1);
    const R = G.renderer.renderer, scene = G.renderer.scene, canvas = R.domElement;
    const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = () => { ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, c2.width, c2.height).data; };
    /** The frame as drawn, and a mask of `root`'s pixels (only it, unlit white, same camera), → luminance stats there. */
    const stats = (root) => {
      G.render(1 / 60, 1);
      const img = grab();
      const camera = G.cameraRig?.active?.camera || G.renderer.camera;
      const hidden = [], white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const keep = new Set(); for (let o = root; o; o = o.parent) keep.add(o);
      scene.traverse((o) => { if (o.visible && !keep.has(o) && !isIn(o, root)) { hidden.push(o); o.visible = false; } });
      const bg = scene.background, fog = scene.fog, ov = scene.overrideMaterial, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
      scene.background = null; scene.fog = null; scene.overrideMaterial = white; R.setClearColor(0x000000, 1);
      R.setRenderTarget(null); R.setViewport(0, 0, canvas.width / R.getPixelRatio(), canvas.height / R.getPixelRatio());
      R.render(scene, camera);
      const mask = grab();
      scene.background = bg; scene.fog = fog; scene.overrideMaterial = ov; R.setClearColor(cc, ca);
      for (const o of hidden) o.visible = true;
      // luminance mean / std over its pixels; fine detail: the mean luminance step to the next pixel right and down (both
      // its own); chroma: the mean spread of its channels (paint grey vs rust, scale, temper tints)
      const W = c2.width, lum = (k) => (0.2126 * img[k] + 0.7152 * img[k + 1] + 0.0722 * img[k + 2]) / 255;
      let n = 0, s = 0, s2 = 0, nd = 0, d = 0, ch = 0;
      for (let k = 0; k < mask.length; k += 4) {
        if (mask[k] < 200) continue;
        const L = lum(k);
        n++; s += L; s2 += L * L;
        ch += (Math.max(img[k], img[k + 1], img[k + 2]) - Math.min(img[k], img[k + 1], img[k + 2])) / 255;
        const kr = k + 4, kd = k + W * 4;
        if (kd < mask.length && mask[kr] >= 200 && mask[kd] >= 200) { nd++; d += Math.abs(lum(kr) - L) + Math.abs(lum(kd) - L); }
      }
      const mean = n ? s / n : 0, f = (v) => +v.toFixed(4);
      return { px: n, mean: f(mean), std: f(Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean))), detail: f(d / Math.max(1, nd)), chroma: f(ch / Math.max(1, n)) };
    };
    const isIn = (o, root) => { for (let q = o; q; q = q.parent) if (q === root) return true; return false; };
    const size = (o) => { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o, true); return b.getSize(new THREE.Vector3()); };
    const intact = stats(vis.object3d), intactSize = size(vis._inst().root);
    for (let i = 0; i < 3; i++) G.render(1 / 60, 1);
    const info = R.info, progs0 = info.programs.length; // (after the mask pass's own white program)
    // destroyed (its destroyed state only: no blast, no fire over it)
    const t0 = performance.now();
    it._applyDestroyedState();
    const swapMs = performance.now() - t0;
    for (let i = 0; i < 3; i++) G.render(1 / 60, 1);
    const progs1 = info.programs.length;
    const wi = vis.wreckInstance, wreckOnly = wi?.root;
    const wreck = stats(vis.object3d), wreckSize = wreckOnly ? size(wi.lods.get(0)) : null;
    let charred = 0, flat = 0;
    wreckOnly?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { if (/#char$/.test(m.name)) charred++; if (m.color?.getHex() === 0x1d1a17) flat++; } });
    // the old look on the same gun, for scale: one flat black material on every mesh, squashed to 0.35
    const saved = [];
    vis.object3d.traverse((o) => { if (o.isMesh) saved.push([o, o.material]); });
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 1 });
    for (const [o] of saved) o.material = burnt;
    it.object3d.scale.y = 0.35;
    const old = stats(vis.object3d);
    for (const [o, m] of saved) o.material = m;
    it.object3d.scale.y = 1;
    burnt.dispose();
    return {
      destroyed: it.destroyed, visDestroyed: vis.destroyed, scaleY: it.object3d.scale.y, showsWreck: vis._inst() === wi && !!wreckOnly?.visible,
      progs0, progs1, swapMs: +swapMs.toFixed(2), intact, wreck, old, charred, flat,
      intactSize: intactSize.toArray().map((v) => +v.toFixed(2)), wreckSize: wreckSize?.toArray().map((v) => +v.toFixed(2)),
    };
  });
  t.log(`leopold: intact ${JSON.stringify(r.intact)}, wreck ${JSON.stringify(r.wreck)}, old flat ${JSON.stringify(r.old)}; size ${r.intactSize} → ${r.wreckSize}; programs ${r.progs0} → ${r.progs1}; swap ${r.swapMs} ms; ${r.charred} charred materials`);
  t(r.destroyed && r.visDestroyed && r.showsWreck, 'destroyed: the gun shows its wreck');
  t(r.scaleY === 1, 'no slump');
  t(r.wreckSize && Math.abs(r.wreckSize[2] - r.intactSize[2]) < 0.1 * r.intactSize[2] && r.wreckSize[1] > 0.85 * r.intactSize[1], `its size kept (${r.intactSize} → ${r.wreckSize})`);
  t(r.charred > 0 && r.flat === 0, 'charred copies of its own materials, not the flat black one');
  t(r.progs1 === r.progs0, `no shader program linked by the swap (${r.progs0} → ${r.progs1})`);
  t(r.wreck.px > 5000, `the wreck is on screen (${r.wreck.px} px)`);
  t(r.wreck.std > 0.05, `not a near-uniform dark slab: luminance std ${r.wreck.std} over its pixels`);
  t(r.wreck.std > r.old.std, `more varied than the old flat black (${r.wreck.std} vs ${r.old.std})`);
  t(r.wreck.detail > 1.3 * r.old.detail, `its detail reads (pixel-to-pixel luminance ${r.wreck.detail} vs ${r.old.detail} flat)`);
  t(r.wreck.chroma > 1.12 * r.old.chroma, `burnt colours, not one black (chroma ${r.wreck.chroma} vs ${r.old.chroma})`);
  t(r.wreck.mean > 0.75 * r.intact.mean, `not darker than the gun was by much (${r.wreck.mean} vs ${r.intact.mean})`);

  // a structure with no modelled wreck (M14's concrete barracks): burnt and wrecked in place (art/wreck-char.js,
  // art/char-ruin.js) — its ruin built at load, so the blast links no program and only swaps it in
  const f = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m14');
    g.start();
    if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
    const it = G.world.interactables.find((i) => i.tag === 'bar_s');
    const cam = G.cameraController;
    cam.setYaw(15); cam.setZoom(1.8, true); cam.centerOn(it.x, it.z);
    for (let i = 0; i < 6; i++) G.render(1 / 60, 1);
    const info = G.renderer.renderer.info, p0 = info.programs.length;
    const look = it.wreckLook(), prepared = !!it._charRuin;
    const geos = []; it.object3d.traverse((o) => { if (o.isMesh) geos.push(o.geometry); });
    const t0 = performance.now();
    it._applyDestroyedState();
    const ms = performance.now() - t0;
    for (let i = 0; i < 4; i++) G.render(1 / 60, 1);
    let swapped = 0, charred = 0;
    it.object3d.traverse((o) => { if (o.isMesh && !geos.includes(o.geometry)) swapped++; if (o.isMesh && /#char$/.test([].concat(o.material)[0]?.name || '')) charred++; });
    return { look, prepared, ms: +ms.toFixed(2), p0, p1: info.programs.length, swapped, charred, scaleY: it.object3d.scale.y };
  });
  t.log(`m14 bar_s: ${f.look}, prepared at load ${f.prepared}, destroyed state ${f.ms} ms, ${f.swapped} wrecked meshes, ${f.charred} charred; programs ${f.p0} → ${f.p1}`);
  t(f.look === 'char' && f.prepared, 'its ruin prepared at load');
  t(f.swapped > 0 && f.charred > 0 && f.scaleY === 1, 'wrecked and charred in place, not squashed');
  t(f.p1 === f.p0, `no shader program linked by its blast (${f.p0} → ${f.p1})`);
}
