/**
 * Conifer needle sprays on the GPU (src/art/terrain/conifers.js, vegetation.js makeNeedleMaterials):
 *  - a spruce / Scots pine stand rendered as unique meshes and as impostors baked from the new trees matches in
 *    coverage, brightness and hue (no popping when forests swap to impostors),
 *  - needles get their own draw call per chunk (no more than one extra per chunk), with the alpha-aware GTAO
 *    material and an alpha-tested shadow depth material,
 *  - the snow load whitens the crowns and the wind moves the needles.
 */
export default async function pines(page, t) {
  const r = await page.evaluate(async () => {
    const THREE = await import('three');
    const VG = await import('/src/art/terrain/vegetation.js');
    const gl = window.__game.game.renderer.renderer;
    const pl = [];
    for (let i = 0; i < 64; i++) {
      const a = (i * 2.399) % 6.283, d = 4 + (i % 8) * 3.3;
      pl.push({ species: i % 3 ? 'spruce' : 'scots_pine', x: 30 + Math.cos(a) * d, y: 0, z: 30 + Math.sin(a) * d, seed: 5000 + i * 7919 });
    }
    const W = 480, Hh = 360, rt = new THREE.WebGLRenderTarget(W, Hh);
    const px = new Uint8Array(W * Hh * 4);
    const cam = new THREE.OrthographicCamera(-34, 34, 25.5, -25.5, 1, 400);
    const pitch = THREE.MathUtils.degToRad(40);
    cam.position.set(30, 8 + Math.sin(pitch) * 150, 30 + Math.cos(pitch) * 150); cam.lookAt(30, 8, 30); cam.updateMatrixWorld();
    function stats() {
      gl.readRenderTargetPixels(rt, 0, 0, W, Hh, px);
      let n = 0, R = 0, G = 0, B = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250) continue; // magenta clear
        n++; R += px[i]; G += px[i + 1]; B += px[i + 2];
      }
      return { cover: n / (W * Hh), r: R / Math.max(1, n), g: G / Math.max(1, n), b: B / Math.max(1, n), lum: (0.3 * R + 0.59 * G + 0.11 * B) / Math.max(1, n) };
    }
    async function build(maxUnique, snow) {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 3);
      sun.position.set(60, 60, 40); sun.target.position.set(30, 0, 30);
      scene.add(sun, sun.target, new THREE.HemisphereLight(0xc8d8ff, 0x505050, 1.2));
      const veg = await VG.createVegetation(scene, pl, 'snow', { renderer: gl, maxUnique, workers: 0, pitchDeg: 40, quality: 'high', snow });
      veg.update(0, cam);
      return { scene, veg };
    }
    function draw(s) {
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(rt); gl.setClearColor(0xff00ff, 1); gl.clear(); gl.render(s.scene, cam); gl.setRenderTarget(prev);
      return stats();
    }
    const out = {};
    const M = await build(1000, 1);
    out.mesh = draw(M);
    const needles = M.veg.group.children.filter((m) => m.name === 'vegNeedles');
    out.needleMeshes = needles.length;
    out.chunkMeshes = M.veg.group.children.length;
    out.chunks = new Set(pl.map((p) => Math.floor(p.x / 20) + ',' + Math.floor(p.z / 20))).size;
    out.needleAo = needles.every((m) => m.userData.aoExclude && !m.userData.aoMaterial && m.customDepthMaterial);
    out.tris = M.veg.stats.tris;
    // wind: same frame time t vs t + 0.7 s must differ (needle flutter / branch sway)
    const { WIND_UNIFORMS: WU } = await import('/src/world/wind.js');
    const wa = WU.uWindA.value, t0 = wa[3];
    M.veg.setWind(1);
    wa[3] = t0 + 0.7; const w1 = draw(M); wa[3] = t0 + 1.4; const w2 = draw(M); wa[3] = t0;
    out.windDelta = Math.abs(w1.lum - w2.lum) + Math.abs(w1.cover - w2.cover);
    M.veg.setSnow(0); out.noSnow = draw(M); M.veg.setSnow(1);
    M.veg.dispose();
    const I = await build(0, 1);
    out.imp = draw(I);
    out.impostors = I.veg.stats.impostors;
    I.veg.dispose();
    rt.dispose();
    return out;
  });
  console.log('    [pines]', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  t.ok(r.needleMeshes > 0 && r.needleMeshes <= r.chunks, `needle meshes: one per chunk at most (${r.needleMeshes} / ${r.chunks} chunks)`);
  t.ok(r.chunkMeshes <= r.chunks * 2, `conifer chunks keep 2 draw calls (bark + needles): ${r.chunkMeshes} meshes for ${r.chunks} chunks`);
  t.ok(r.needleAo, 'needle meshes skip the GTAO prepass (crown AO baked per vertex) and carry a shadow depth material');
  t.ok(r.impostors === 64, 'maxUnique 0 → every tree an impostor');
  t.ok(r.mesh.cover > 0.12, `stand covers the frame (${r.mesh.cover.toFixed(3)})`);
  const cov = r.imp.cover / r.mesh.cover, lum = r.imp.lum / r.mesh.lum;
  t.ok(cov > 0.75 && cov < 1.33, `impostor coverage matches the meshes (×${cov.toFixed(2)})`);
  t.ok(lum > 0.8 && lum < 1.25, `impostor brightness matches the meshes (×${lum.toFixed(2)})`);
  const hue = (s) => s.g / Math.max(1, s.r);
  t.ok(Math.abs(hue(r.imp) - hue(r.mesh)) < 0.15, `impostor hue matches (g/r ${hue(r.imp).toFixed(2)} vs ${hue(r.mesh).toFixed(2)})`);
  t.ok(r.mesh.lum > r.noSnow.lum * 1.05, `snow load whitens the crowns (${r.noSnow.lum.toFixed(1)} → ${r.mesh.lum.toFixed(1)})`);
  t.ok(r.windDelta > 0.01, `wind moves the needles (Δ ${r.windDelta.toFixed(3)})`);
}
