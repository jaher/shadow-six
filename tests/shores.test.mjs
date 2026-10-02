/**
 * Smooth shorelines (world/shore-field.js; user request 2026-09-30 "make the edges of the shore more smooth and less
 * polygonal"), on the real GPU build:
 *  - every map carves its banks from the continuous shore field (map + apron), built in bounded time;
 *  - pixel edge smoothness: the M2 islets' drawn shoreline (terrain under / over the water level, rendered as a
 *    black / white mask at the closest zoom) traced along 720 rays has no facets (max turn between 0.5 m chords) and
 *    is round, not the old octagon;
 *  - nav vs visual agreement: every nav cell more than 0.5 m from the drawn shore is water exactly where the ground
 *    is carved under the water surface — swimming / wading / walking rules see what is drawn — and the water system
 *    (its bake of the carved terrain) answers sample() with water there.
 */
const WATER_LEVEL = -0.1;

async function edgeMetric(page, id, centres) {
  return page.evaluate(async ({ id, centres, WL }) => {
    const THREE = await import('three');
    const g = window.__game, G = g.game, R = G.renderer, gl = R.renderer, cam = R.camera;
    const ter = G.mapHandle.terrain, mesh = ter.terrain.mesh;
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying float vY; void main() { gl_FragColor = vec4(vec3(vY < ${WL.toFixed(3)} ? 0.0 : 1.0), 1.0); }`,
    });
    const m = new THREE.Mesh(mesh.geometry, mat);
    m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld); m.matrixWorld.copy(mesh.matrixWorld);
    const sc = new THREE.Scene(); sc.add(m); sc.background = new THREE.Color(1, 0, 0);
    const out = [];
    G.cameraRig.setYaw(15); g.setZoom(2);
    for (const [cx, cz] of centres) {
      G.cameraController.centerOn(cx, cz);
      g.render();
      const cv = gl.domElement, w = cv.width, h = cv.height;
      gl.setRenderTarget(null); gl.render(sc, cam);
      const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(cv, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const land = (x, y) => { const k = (Math.round(y) * w + Math.round(x)) * 4; return px[k] > 128 && px[k + 1] > 128; };
      const v = new THREE.Vector3(cx, 0, cz).project(cam), sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
      const ppm = h / ((cam.top - cam.bottom) / cam.zoom); // screen px per world m (vertical extent)
      const P = [];
      for (let a = 0; a < 720; a++) {
        const dx = Math.cos(a * Math.PI / 360), dy = Math.sin(a * Math.PI / 360);
        let t = 0;
        while (t < 8 * ppm && land(sx + dx * t, sy + dy * t)) t += 0.25;
        P.push([sx + dx * t, sy + dy * t]);
      }
      // resample the closed curve every 0.5 m (in px) and take the largest turn between consecutive chords
      const Q = [P[0]], s = 0.5 * ppm, C = [...P, P[0]];
      let acc = 0;
      for (let k = 1; k < C.length; k++) {
        let [ax, ay] = C[k - 1]; const [bx, by] = C[k];
        let L = Math.hypot(bx - ax, by - ay);
        while (acc + L >= s) { const q = (s - acc) / L; ax += (bx - ax) * q; ay += (by - ay) * q; Q.push([ax, ay]); L = Math.hypot(bx - ax, by - ay); acc = 0; }
        acc += L;
      }
      let turn = 0;
      for (let k = 1; k + 1 < Q.length; k++) {
        const a1 = Math.atan2(Q[k][1] - Q[k - 1][1], Q[k][0] - Q[k - 1][0]), a2 = Math.atan2(Q[k + 1][1] - Q[k][1], Q[k + 1][0] - Q[k][0]);
        let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
        turn = Math.max(turn, d * 180 / Math.PI);
      }
      const r = P.map(([x, y]) => Math.hypot((x - sx) / ppm, (y - sy) / ppm));
      out.push({ turn, rMin: Math.min(...r), rMax: Math.max(...r), ppm, chords: Q.length });
    }
    mat.dispose();
    G.cameraRig.setYaw(15); g.setZoom(1);
    return out;
  }, { id, centres, WL: WATER_LEVEL });
}

export default async function shores(page, t) {
  for (const id of ['m02', 'm01', 'm03']) {
    const r = await page.evaluate(async (id) => {
      const g = window.__game, G = g.game;
      await g.loadMission(id); g.start();
      await G.mapHandle?.ready;
      const ter = G.mapHandle?.terrain;
      await ter?.apronReady;
      const sh = ter?.shore, wt = G.world.water, gr = G.world.grid;
      if (!sh || !wt) return { built: false, sh: !!sh, wt: !!wt };
      let n = 0, bad = 0;
      const ex = [];
      for (let j = 0; j < gr.rows; j++) for (let i = 0; i < gr.cols; i++) {
        const x = (i + 0.5) * gr.cell, z = (j + 0.5) * gr.cell, sd = sh.wetAt(x, z);
        if (Math.abs(sd) < 0.5 || Math.abs(sd) > 3.5) continue; // the shore band, 0.5-3.5 m either side of the drawn line
        let built = false; // piers, jetties, bridge piers: the water's bed capture treats their decks / posts as dry
        for (let dj = -3; dj <= 3 && !built; dj++) for (let di = -3; di <= 3; di++) {
          const q = (j + dj) * gr.cols + i + di;
          if (q >= 0 && q < gr.terrain.length && (gr.bridge?.[q] || gr.block[q] || gr.elev?.[q] || gr.owner?.[q])) { built = true; break; }
        }
        if (built) continue;
        // drawn water = ground carved under the water surface inside the water mesh's mask (texels > 0.35 m past the
        // shore field are cut; structures standing in the water, e.g. the M3 dam, are drawn over it and do not count)
        const c = gr.terrain[j * gr.cols + i], nav = c === 5 || c === 6, h = ter.heightAt(x, z), vis = h < -0.1 && sd > -0.35;
        n++;
        if (nav !== vis) { bad++; if (ex.length < 5) ex.push([x, z, +sd.toFixed(2), +h.toFixed(2)]); }
      }
      // raised bodies (`level` above the sea surface: the M3 reservoir behind its dam) are their own water system
      // body, which sample() leaves out on master as well; the check covers the bodies at WATER_LEVEL
      const raised = (G.missionDef?.terrain || []).filter((f) => f.type === 'poly' && f.level > -0.1 && f.points);
      const inPoly = (P, x, z) => { let c = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > z) !== (P[b][1] > z) && x < P[b][0] + (z - P[b][1]) / (P[a][1] - P[b][1]) * (P[a][0] - P[b][0])) c = !c; return c; };
      let wsBad = 0;
      for (let j = 0; j < gr.rows; j += 2) for (let i = 0; i < gr.cols; i += 2) {
        const x = (i + 0.5) * gr.cell, z = (j + 0.5) * gr.cell, sd = sh.wetAt(x, z), q = j * gr.cols + i;
        if (sd < 1 || sd > 3.5 || gr.owner?.[q] || raised.some((f) => inPoly(f.points, x, z))) continue;
        const s = wt.sample(x, z);
        if (!s || !(s.depth > 0)) wsBad++;
      }
      // the carve follows the field: water side under the surface, land side above the shore bed
      let carve = 0;
      for (let k = 0; k < 4000; k++) {
        const x = (k * 7.31) % gr.width, z = (k * 3.77) % gr.depth, sd = sh.wetAt(x, z);
        if (sd > 0.6 && sd < 3 && ter.heightAt(x, z) > -0.1) carve++;
      }
      return { built: true, n, bad, ex, carve, wsBad, ms: sh.ms, foreign: sh.foreignCells, res: sh.res };
    }, id);
    t(r.built, `${id}: terrain carved from the shore field, water built (${JSON.stringify(r)})`);
    if (!r.built) continue;
    t.log(`${id}: shore field ${r.ms} ms at ${r.res} m, ${r.foreign} cells on the cell fallback; ${r.n} shore-band nav cells checked`);
    t(r.ms < 2500, `${id}: shore field built in ${r.ms} ms`);
    t(r.n > 200, `${id}: ${r.n} nav cells in the shore band`);
    t(r.bad === 0, `${id}: nav water/land = drawn water/land in the shore band (${r.bad} off: ${JSON.stringify(r.ex)})`);
    t(r.wsBad < r.n * 0.01, `${id}: water.sample() finds water 1-3.5 m inside the drawn shore (${r.wsBad} misses, structures in the water excepted)`);
    t(r.carve === 0, `${id}: water side of the drawn shore is carved under the surface (${r.carve} samples above it)`);
    if (id === 'm02') {
      const m = await edgeMetric(page, id, [[16.9, 63.7], [40.6, 83.0]]);
      for (const [k, e] of m.entries()) {
        t.log(`m02 islet ${k + 1}: ${e.ppm.toFixed(1)} px/m, radius ${e.rMin.toFixed(2)}–${e.rMax.toFixed(2)} m (screen), max turn ${e.turn.toFixed(1)} deg / 0.5 m`);
        t(e.turn < 30, `m02 islet ${k + 1}: drawn shoreline has no facets (max turn ${e.turn.toFixed(1)} deg per 0.5 m; the cell-carved octagon had ≥ 45)`);
        t(e.rMin > 1.5 && e.rMax < 6, `m02 islet ${k + 1}: shoreline found around it`);
      }
    }
  }
}
