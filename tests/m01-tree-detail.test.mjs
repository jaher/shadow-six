/**
 * Mission 1 conifers keep their full needle detail (GPU). User report, 2026-10-02: "Something happen3d to the trees in
 * mission 1, they are not rendering the same way they used to with all detail" — the clip-2 walk-under clearance
 * (src/art/terrain/conifers.js) dropped the outer, snow-carrying spray of every spruce limb (and every needle of the
 * low tiers), leaving skeletal, snowless crowns. Checks:
 *  - look: M1's own conifers (the live placements, clearance hints included) rendered tree by tree in a
 *    lit scene from the game's 40° view cover as much of their frame and carry as much snow as at the pine-needle
 *    look-dev (3f9c1519; calibrated against 7a0994bb = full detail and 01240fd4 = the broken build);
 *  - the walk-under clearance (clip-2 rule e) binds the WOOD only: the live M1 vegetation holds exactly the needle
 *    triangles its trees have without clearance, and no limb wood under head height beyond a trunk's footprint;
 *  - a mission restart (session cache, instant restart) brings back the same full-detail trees;
 *  - the in-game frame at the M1 stand (zoom 1 and 2) is saved for review (tests/out/m01-trees-z*.png).
 */
export const timeout = 240_000;

export default async function m01TreeDetail(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const THREE = await import('three');
    const VG = await import('/src/art/terrain/vegetation.js');
    const TG = await import('/src/art/terrain/treegen.js');
    TG.useThree?.(THREE);
    const gl = G.renderer.renderer;
    await g.loadMission('m01'); g.start();
    g.setPreset('high');
    await G.world.terrain.ready;
    const v = G.world.terrain.vegetation;
    await v.setQuality('high');
    const conifer = (s) => TG.SPECIES[s]?.kind === 'conifer';
    const unique = v.trees.filter((p) => !p.impostor && conifer(p.species));
    out.conifers = unique.length;
    out.withClear = unique.filter((p) => p.clear).length;

    // ---- needles: the live meshes = the trees with their clearance = the trees without it ------------------------
    const q = TG.TREE_QUALITY.high;
    const needleTris = (list, strip) => list.reduce((s, p) => {
      const b = new TG.GeoAcc(), l = new TG.GeoAcc(), n = new TG.GeoAcc();
      TG.generateTree(p.species, p.seed, q, b, l, strip ? { ...p, clear: undefined } : p, n);
      return s + n.idx.length / 3;
    }, 0);
    let live = 0; v.group.traverse((o) => { if (o.isMesh && o.name === 'vegNeedles') live += o.geometry.index.count / 3; });
    out.needles = { live, clear: needleTris(unique, false), noClear: needleTris(unique, true) };

    // ---- wood: no conifer limb under head height beyond its trunk's footprint (clip-2 rule e) ---------------------
    const roots = new Set(unique.filter((p) => p.clear).map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    let low = 0, bark = 0;
    v.group.traverse((o) => {
      if (!o.isMesh || o.name !== 'vegBark') return;
      const P = o.geometry.attributes.position, R = o.geometry.attributes.aRoot;
      for (let i = 0; i < P.count; i++) {
        const w = R.getW(i);
        if (w < 100 || w >= 200 || !roots.has(`${R.getX(i).toFixed(2)},${R.getZ(i).toFixed(2)}`)) continue; // conifer heroes
        bark++;
        const y = P.getY(i) - R.getY(i), rho = Math.hypot(P.getX(i) - R.getX(i), P.getZ(i) - R.getZ(i));
        if (y > 0.25 && y < 1.6 && rho > 0.7) low++;
      }
    });
    out.wood = { bark, low };

    // ---- restart (instant restart: the session cache returns the generated chunks): the same full-detail trees -----
    await g.loadMission('m01'); g.start(); await G.world.terrain.ready;
    const v2 = G.world.terrain.vegetation;
    await v2.setQuality('high');
    let live2 = 0; v2.group.traverse((o) => { if (o.isMesh && o.name === 'vegNeedles') live2 += o.geometry.index.count / 3; });
    out.restart = { cached: !!v2.stats.cached, live: live2 };

    // ---- look: each M1 conifer alone in a lit scene, game pitch, magenta clear ----------------------------------
    const W = 256, Hh = 256, rt = new THREE.WebGLRenderTarget(W, Hh), px = new Uint8Array(W * Hh * 4);
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    scene.add(sun, sun.target, new THREE.HemisphereLight(0xc8d8ff, 0x505050, 1.2));
    const placements = unique.map((p) => ({ species: p.species, seed: p.seed, x: p.x, y: 0, z: p.z, scale: p.scale, clear: p.clear, crownBase: p.crownBase, crownR: p.crownR, hero: true }));
    const veg = await VG.createVegetation(scene, placements, 'snow', { renderer: gl, maxUnique: 1000, workers: 0, pitchDeg: 40, quality: 'high', snow: 1 });
    const pitch = THREE.MathUtils.degToRad(40), cam = new THREE.OrthographicCamera(-7, 7, 7, -7, 1, 400);
    const per = [];
    const prev = gl.getRenderTarget(), cc = gl.getClearColor(new THREE.Color()), ca = gl.getClearAlpha();
    for (const p of veg.trees) {
      const H = p.height ?? 12, cy = H * 0.45;
      sun.position.set(p.x + 60, 60, p.z + 40); sun.target.position.set(p.x, 0, p.z); sun.target.updateMatrixWorld();
      const s = H * 0.55; cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.updateProjectionMatrix();
      cam.position.set(p.x, cy + Math.sin(pitch) * 150, p.z + Math.cos(pitch) * 150); cam.lookAt(p.x, cy, p.z); cam.updateMatrixWorld();
      veg.update(0, cam);
      gl.setRenderTarget(rt); gl.setClearColor(0xff00ff, 1); gl.clear(); gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, W, Hh, px);
      let n = 0, lum = 0; const hist = [0, 0, 0, 0, 0];
      for (let i = 0; i < px.length; i += 4) {
        const R = px[i], Gc = px[i + 1], B = px[i + 2];
        if (R > 250 && Gc < 5 && B > 250) continue;
        n++;
        const L = 0.3 * R + 0.59 * Gc + 0.11 * B; lum += L;
        const m = Math.min(R, Gc, B);
        hist[m > 160 ? 4 : m > 130 ? 3 : m > 100 ? 2 : m > 70 ? 1 : 0]++;
      }
      per.push({ sp: p.species, H: +H.toFixed(1), cover: n / (W * Hh), snow: (hist[3] + hist[4]) / Math.max(1, n), lum: lum / Math.max(1, n), hist: hist.map((x) => +(x / Math.max(1, n)).toFixed(3)) });
    }
    gl.setRenderTarget(prev); gl.setClearColor(cc, ca);
    veg.dispose(); rt.dispose();
    const mean = (k, f = () => true) => { const a = per.filter(f); return a.reduce((s, x) => s + x[k], 0) / Math.max(1, a.length); };
    out.look = { trees: per.length, cover: mean('cover'), snow: mean('snow'), spruceCover: mean('cover', (x) => x.sp === 'spruce'), spruceSnow: mean('snow', (x) => x.sp === 'spruce') };
    out.look.lum = mean('lum');
    out.per = per.map((x) => [x.sp, x.H, +x.cover.toFixed(3), +x.lum.toFixed(1), x.hist]);
    return out;
  });
  console.log('    [m01-trees]', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v)));

  // in-game frames at the conifer stand (review only)
  for (const zoom of [1, 2]) {
    await page.evaluate((z) => { const g = window.__game, G = g.game; G.cameraController.setZoom(z); G.cameraController.centerOn(58, 30); g.advance(0.05); g.render(); g.render(); }, zoom);
    await t.shot(`m01-trees-z${zoom}`);
  }

  t.ok(r.conifers >= 8, `M1 has its unique conifers (${r.conifers})`);
  t.ok(r.withClear === r.conifers, `every M1 conifer carries the walk-under clearance hint (${r.withClear} / ${r.conifers})`);
  t.ok(r.needles.live === r.needles.clear, `the live M1 needle meshes are the generated trees (${r.needles.live} / ${r.needles.clear} tris)`);
  t.ok(r.needles.clear === r.needles.noClear, `the walk-under clearance keeps every needle (${r.needles.clear} vs ${r.needles.noClear} tris without it)`);
  t.ok(r.restart.cached && r.restart.live === r.needles.live, `after a restart (session cache ${r.restart.cached ? 'hit' : 'miss'}) the same needles (${r.restart.live} tris)`);
  t.ok(r.wood.bark > 1000 && r.wood.low === 0, `no limb wood under head height beyond a trunk (${r.wood.low} of ${r.wood.bark} bark vertices)`);
  // look, per tree on the 40° view (full detail 7a0994bb / broken 01240fd4): cover 0.383 / 0.123, snow share
  // 0.131 / 0.024, mean luminance 42 / 13; needle tris per tree 1863 / 518
  const L = r.look, minCover = Math.min(...r.per.map((x) => x[2]));
  t.ok(r.needles.live / r.conifers > 1500, `full needle sprays per M1 conifer (${(r.needles.live / r.conifers).toFixed(0)} tris; 1863 at the look-dev, 518 broken)`);
  t.ok(L.trees === r.conifers && L.cover > 0.3 && minCover > 0.18, `crowns fill their frame (mean ${L.cover.toFixed(3)}, min ${minCover.toFixed(3)}; 0.383 at the look-dev, 0.123 broken)`);
  t.ok(L.snow > 0.09, `the snow load sits on the crowns (${(L.snow * 100).toFixed(1)} % snow pixels; 13.1 % at the look-dev, 2.4 % broken)`);
  t.ok(L.lum > 32, `crowns lit and snowy, not bare dark twigs (mean luminance ${L.lum.toFixed(1)}; 42 at the look-dev, 13 broken)`);
}
