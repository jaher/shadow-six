/**
 * Vegetation in the running game (GPU; docs/vegetation.md, critic round 2):
 *  - desert ground scatter and the mission's desert bushes are 3D scrub with volume (height / width), not flat stars
 *    or leafy card heaps;
 *  - autumn turns leaf by leaf (atlas leaf ids): on a screen-aligned spray card the turned / green boundaries do not
 *    follow a UV grid (the old 7 x 7 cells drew opaque tan squares);
 *  - the wind moves the desert shrubs, the date palms and the meadow flowers (two sim times, same view → pixels change).
 */
export const timeout = 240_000;

export default async function vegetation(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const THREE = await import('three');
    const W = await import('/src/world/wind.js');
    const gl = G.renderer.renderer;
    const scene = G.renderer.scene;
    const rt = new THREE.WebGLRenderTarget(256, 256);
    const px = new Uint8Array(256 * 256 * 4);
    const read = (sc, cam) => {
      const bg = sc.background, fog = sc.fog; sc.background = null; sc.fog = null; // only the objects on layer 7
      const cc = gl.getClearColor(new THREE.Color()), ca = gl.getClearAlpha();
      gl.setRenderTarget(rt); gl.setClearColor(0x0000ff, 1); gl.clear(); gl.render(sc, cam); gl.readRenderTargetPixels(rt, 0, 0, 256, 256, px);
      gl.setRenderTarget(null); gl.setClearColor(cc, ca); sc.background = bg; sc.fog = fog;
      return px.slice();
    };
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n / (a.length / 4); };
    const gale = () => {
      const w = G.world, ev = w.wind.events;
      w.wind = new W.WindField(W.resolveWind({ theater: 'desert', weather: { wind: { speed: 13, gustiness: 1 } } }), { W: w.width, D: w.depth });
      w.wind.events = ev;
    };
    // render only `objs` (layer 7) from a camera looking down at (x, y, z) from `dist` m at 50°
    const only = (objs, x, y, z, dist) => {
      const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
      cam.position.set(x, y + dist * 0.77, z + dist * 0.64); cam.lookAt(x, y, z); cam.layers.set(7);
      for (const o of objs) o.traverse((c) => c.layers.enable(7));
      return cam;
    };
    const windMoves = (objs, x, y, z, dist) => {
      const cam = only(objs, x, y, z, dist);
      g.render(); const a = read(scene, cam), a2 = read(scene, cam);
      g.advance(0.9); g.render(); const b = read(scene, cam);
      let cover = 0; for (let i = 0; i < a.length; i += 4) if (!(a[i] === 0 && a[i + 1] === 0 && a[i + 2] === 255)) cover++;
      for (const o of objs) o.traverse((c) => c.layers.disable(7));
      return { still: diff(a, a2), moved: diff(a, b), cover: cover / (a.length / 4) };
    };

    // ---- 1. desert: scrub archetypes with volume; mission bushes are hero scrub, not card heaps (M09) -----------
    await g.loadMission('m09'); g.start(); await G.world.terrain.ready;
    const scrub = []; scene.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith('scrub:')) scrub.push(o); });
    out.scrubKinds = scrub.map((m) => m.name);
    out.scrubVolume = scrub.map((m) => { m.geometry.computeBoundingBox(); const s = m.geometry.boundingBox.getSize(new THREE.Vector3()); return +(s.y / Math.max(s.x, s.z)).toFixed(2); });
    out.scrubCount = scrub.reduce((s, m) => s + m.count, 0);
    out.cardShrubs = (G.world.terrain.vegetation?.trees || []).filter((p) => p.species === 'desert_shrub').length;
    gale();
    const sm = scrub.find((m) => m.name === 'scrub:camelthorn') || scrub[0];
    const m4 = new THREE.Matrix4(), p0 = new THREE.Vector3();
    sm.getMatrixAt(0, m4); p0.setFromMatrixPosition(m4);
    out.shrubWind = windMoves([sm], p0.x, p0.y + 0.4, p0.z, 4);

    // ---- 2. date palms move in the wind (M08 oasis) ----------------------------------------------------------------
    await g.loadMission('m08'); g.start(); await G.world.terrain.ready;
    const palm = (G.world.terrain.vegetation?.trees || []).find((p) => p.species === 'date_palm');
    out.palm = !!palm;
    gale();
    const vg = G.world.terrain.vegetation?.group;
    if (palm && vg) out.palmWind = windMoves([vg], palm.x, (palm.y || 0) + 7, palm.z, 16);

    // ---- 3. autumn leaves: per-leaf turning, no UV grid; flowers sway (M16, September; leaf card render) -----------
    await g.loadMission('m16'); g.start(); await G.world.terrain.ready;
    const leafMesh = []; G.world.terrain.vegetation?.group.traverse((o) => { if (o.name === 'vegLeaves') leafMesh.push(o); });
    const flowers = []; scene.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith('clutterFlowers_')) flowers.push(o); });
    out.flowerKinds = flowers.length;
    gale();
    if (flowers.length) {
      const f = flowers.reduce((a, b) => (b.count > a.count ? b : a)); f.getMatrixAt(0, m4); p0.setFromMatrixPosition(m4);
      out.flowerWind = windMoves([f], p0.x, p0.y + 0.2, p0.z, 1.6);
    }
    if (leafMesh.length) {
      const { GeoAcc, LEAF_LAYERS } = await import('/src/art/terrain/treegen.js');
      const mat = leafMesh[0].material;
      const acc = new GeoAcc(), n = new THREE.Vector3(0, 1, 0), L = LEAF_LAYERS.indexOf('oak') * 2;
      const v = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]].map(([x, z, u, w]) => acc.vert(new THREE.Vector3(x, 0, -z), n, u, w, [L, 0, 0, 0.1], [1, 1, 1], [1, 1]));
      acc.tri(v[0], v[1], v[2]); acc.tri(v[0], v[2], v[3]);
      acc.setRoot(0, 0, 0, 0, 10, 0);
      const card = new THREE.Mesh(acc.toGeometry(), mat);
      const sc = new THREE.Scene(); sc.add(card, new THREE.AmbientLight(0xffffff, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(0.2, 1, 0.3); sc.add(sun);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.set(0, 5, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
      // the shared vegetation uniforms (makeMaterials keeps them on the material): half-way through the turn
      const S = mat.userData.U?.uSeason, was = S?.value.clone();
      if (S) S.value.set(0.75, 0, 0, 0);
      const img = read(sc, cam);
      if (S) S.value.copy(was);
      // classify: background blue, turned (red ≥ green, warm), green (green > red); transitions between leaf pixels
      const cls = (i) => { const r0 = img[i], g0 = img[i + 1], b0 = img[i + 2]; if (b0 > 200 && r0 < 40 && g0 < 40) return 0; return r0 >= g0 * 0.98 && r0 > b0 * 1.3 ? 2 : 1; };
      let turned = 0, green = 0, trans = 0, onGrid = 0;
      const grid = (k) => { const c = (k / 256) * 7; return Math.abs(c - Math.round(c)) * (256 / 7) <= 1.5 && Math.round(c) > 0 && Math.round(c) < 7; };
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4, c = cls(i);
        if (c === 2) turned++; else if (c === 1) green++;
        if (x < 255) { const d = cls(i + 4); if (c && d && c !== d) { trans++; if (grid(x + 0.5)) onGrid++; } }
        if (y < 255) { const d = cls(i + 1024); if (c && d && c !== d) { trans++; if (grid(y + 0.5)) onGrid++; } }
      }
      out.leaves = { turned: turned / 65536, green: green / 65536, trans, gridShare: trans ? onGrid / trans : 1, season: !!S };
      card.geometry.dispose(); rt.dispose();
    }
    return out;
  });
  console.log('    [vegetation]', JSON.stringify(r));
  t.ok(r.scrubKinds.length >= 3, `desert scrub archetypes rendered (${r.scrubKinds.join(', ')})`);
  t.ok(r.scrubVolume.every((k) => k >= 0.35), `desert scatter has volume: height / width ${r.scrubVolume.join(', ')} (flat stars ≈ 0.05)`);
  t.ok(r.cardShrubs === 0, `no mission desert bush is a leaf-card heap (${r.cardShrubs})`);
  t.ok(r.shrubWind.cover > 0.01 && r.shrubWind.cover < 0.9 && r.shrubWind.still < 0.001 && r.shrubWind.moved > 0.005, `the wind moves the desert shrubs ${JSON.stringify(r.shrubWind)}`);
  t.ok(r.palm && r.palmWind && r.palmWind.cover > 0.02 && r.palmWind.cover < 0.95 && r.palmWind.moved > 0.005, `the wind moves the date palms ${JSON.stringify(r.palmWind)}`);
  t.ok(r.flowerKinds > 0 && r.flowerWind && r.flowerWind.cover > 0.002 && r.flowerWind.cover < 0.9 && r.flowerWind.moved > 0.002, `the wind moves the meadow flowers ${JSON.stringify(r.flowerWind)}`);
  t.ok(r.leaves && r.leaves.season, 'leaf season uniform reachable');
  t.ok(r.leaves.turned > 0.04 && r.leaves.green > 0.04, `a part of the leaves turned (${(r.leaves.turned * 100).toFixed(1)} % turned, ${(r.leaves.green * 100).toFixed(1)} % green)`);
  t.ok(r.leaves.gridShare < 0.25, `turned leaves are leaves, not UV squares: ${(r.leaves.gridShare * 100).toFixed(1)} % of turn boundaries on a 7 x 7 grid (uniform ≈ 7 %)`);
}
