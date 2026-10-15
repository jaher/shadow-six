/**
 * Open chimney flues on screen (art/chimney-flues.js; user 2026-10-15: "Looking at mission 3 the chimneys are covered
 * by snow. They should have kind of a hole for smoke to flow out"). At the game camera, zoom 2 and 1, every chimney
 * stack / pot of the library buildings in M3 (snow), M7 (snow: kit houses, Nissen hut) and M15 (temperate, clay pots)
 * shows a dark opening: the pixels over the flue (at the rim's height) are dark, the coping round a stack's flue is
 * not (snow or stone); the smoke (ambient pool) and the falling snow are hidden while sampling. The kit houses' own
 * stacks (where drawn) and the FX placeholder stacks open the same way; every plume leaves a flue mouth.
 */
export const timeout = 600_000;

export default async function chimneyFlues(page, t) {
  for (const mission of ['m03', 'm07', 'm15']) {
    const r = await page.evaluate(async ({ mission }) => {
      const g = window.__game, G = g.game; await g.loadMission(mission); g.start(); await G.mapHandle?.ready;
      for (let i = 0; i < 16; i++) g.advance(0.25);
      const THREE = await import('three');
      const { flueMouths } = await import('/src/art/chimney-flues.js');
      const { assetExtents } = await import('/src/art/building-props.js');
      const W = G.world, fx = W.fx, out = { mission, flues: [], kit: [] };
      // every opened stack / pot of the placed library buildings (instanced repeats: their template's matrix rebuilt)
      for (const [id, s] of W.structures) {
        const obj = s.object3d; if (!obj || s.destroyed) continue;
        obj.updateMatrixWorld(true);
        const add = (name, M) => { for (const f of flueMouths(name) || []) if (f.kind !== 'pipe') out.flues.push({ id, name, kind: f.kind, M: M.toArray(), hole: f.hole, top: f.top }); };
        let lib = false;
        obj.traverse((o) => { const n = o.userData?.building; if (n && !/ruin|destroyed/.test(n)) { lib = true; add(n, o.matrixWorld); } });
        const asset = obj.userData?.libraryAsset, fit = obj.children.find((c) => c.name === 'fit'), turn = fit?.children[0], ext = asset && assetExtents(asset);
        if (!lib && asset && turn && ext && !/ruin|destroyed/.test(asset)) add(asset, new THREE.Matrix4().makeTranslation(-ext.cx, 0, -ext.cz).premultiply(turn.matrixWorld));
        const shown = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; }; // (M7's compounds hide theirs)
        obj.traverse((o) => { if (shown(o)) for (const p of o.userData?.flueMouths || []) out.kit.push({ id, p: new THREE.Vector3(...p).applyMatrix4(o.matrixWorld).toArray() }); });
      }
      out.fxChimneys = fx._chimneys.map((c) => ({ id: c.id, mouth: !!c.pos.mouth, proc: !!c.mesh, p: c.pos.toArray() }));
      // sampling: smoke, falling snow and the HUD's cursor out of the way; the frame read back right after it is drawn
      fx.vfx && (fx.vfx.amb.mesh.visible = false);
      const flakes = []; G.renderer.scene.traverse((o) => { if (o.name === 'snowfall' && o.visible) { flakes.push(o); o.visible = false; } });
      G.paused = true;
      const cam = G.renderer.camera, gl = G.renderer.renderer.getContext();
      const lum = (x, y, z) => {
        const q = new THREE.Vector3(x, y, z).project(cam), W2 = gl.drawingBufferWidth, H2 = gl.drawingBufferHeight;
        const px = Math.round((q.x * 0.5 + 0.5) * W2), py = Math.round((q.y * 0.5 + 0.5) * H2), buf = new Uint8Array(4 * 9);
        gl.readPixels(px - 1, py - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const L = []; for (let i = 0; i < 9; i++) L.push((0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]) / 255);
        return L.sort((a, b) => a - b)[4]; // median of 3 × 3
      };
      const frame = (x, y, z, zoom) => {
        g.setZoom(zoom);
        const d = cam.getWorldDirection(new THREE.Vector3()), k = (y - W.groundY(x, z)) / -d.y;
        g.centerOn(x + d.x * k, z + d.z * k);
        for (let i = 0; i < 2; i++) G.render(1 / 60, 1);
      };
      for (const f of out.flues) {
        const M = new THREE.Matrix4().fromArray(f.M), c = f.hole.reduce((a, p) => [a[0] + p[0] / f.hole.length, a[1] + p[1] / f.hole.length], [0, 0]);
        const C = new THREE.Vector3(c[0], f.top, c[1]).applyMatrix4(M);
        f.res = {};
        for (const zoom of [2, 1]) {
          frame(C.x, C.y, C.z, zoom);
          const hole = lum(C.x, C.y, C.z);
          // the coping: 6 cm out of the middle of every flue edge, at the rim (stacks: the cap's rim is 0.1–0.2 m wide)
          const rim = [];
          if (f.kind === 'stack') for (let i = 0; i < f.hole.length; i++) {
            const a = f.hole[i], b = f.hole[(i + 1) % f.hole.length], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dd = Math.hypot(mx - c[0], mz - c[1]);
            const P = new THREE.Vector3(mx + ((mx - c[0]) / dd) * 0.06, f.top, mz + ((mz - c[1]) / dd) * 0.06).applyMatrix4(M);
            rim.push(lum(P.x, P.y, P.z));
          }
          f.res[zoom] = { hole: +hole.toFixed(3), rim: rim.map((v) => +v.toFixed(3)) };
        }
        delete f.M;
      }
      for (const k of out.kit) { frame(...k.p, 2); k.hole = +lum(k.p[0], k.p[1] + 0.04, k.p[2]).toFixed(3); }
      // the FX placeholder stacks (procedural houses without a chimney of their own): open, the plume at their mouth
      for (const c of out.fxChimneys) if (c.proc) { frame(...c.p, 2); c.hole = +lum(c.p[0], c.p[1] + 0.04, c.p[2]).toFixed(3); }
      for (const o of flakes) o.visible = true;
      fx.vfx && (fx.vfx.amb.mesh.visible = true);
      G.paused = false;
      return out;
    }, { mission });
    t.log(JSON.stringify({ mission, n: r.flues.length, kit: r.kit, fx: r.fxChimneys, flues: r.flues.map((f) => `${f.id}/${f.kind}:${JSON.stringify(f.res)}`) }));
    t.ok(r.flues.length >= { m03: 6, m07: 7, m15: 20 }[mission], `${mission}: opened flues on screen (${r.flues.length})`);
    for (const f of r.flues) for (const zoom of [2, 1]) {
      const q = f.res[zoom];
      // zoom 1: a pot's 12 cm opening is ~5 px across → the 3 × 3 median still inside it
      t.ok(q.hole < 0.2, `${mission} ${f.id} ${f.name} ${f.kind} zoom ${zoom}: dark opening (luminance ${q.hole})`);
      if (f.kind === 'stack') {
        const lit = q.rim.filter((v) => v > Math.max(0.2, q.hole * 2.5)).length;
        t.ok(lit >= q.rim.length - 1, `${mission} ${f.id} ${f.name} zoom ${zoom}: the coping round it is lit (${q.rim} vs ${q.hole})`);
      }
    }
    for (const k of r.kit) t.ok(k.hole < 0.2, `${mission} kit stack ${k.id}: dark opening (${k.hole})`);
    for (const c of r.fxChimneys) if (c.proc) t.ok(c.hole < 0.2, `${mission} placeholder stack ${c.id}: dark opening (${c.hole})`);
    for (const c of r.fxChimneys) t.ok(c.mouth, `${mission} ${c.id}: smoke from a flue mouth`);
  }
}
