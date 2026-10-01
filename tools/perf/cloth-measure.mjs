#!/usr/bin/env node
/**
 * Canvas-cover motion report (truck tarps / car tops): reads the GPU-displaced vertices of every canvas mesh of a
 * mission vehicle (tests/cloth-probe.mjs) over `--secs` at 60 fps of deterministic sim time and prints, per panel
 * (back / sides / top / front by rest normal), the dominant flutter frequency, spectral centroid, share of power
 * above 2 Hz, RMS and peak-to-peak displacement, plus the max gap between coincident seam vertices.
 *
 *   node tools/perf/cloth-measure.mjs [--mission=m02] [--tag=truck] [--secs=4] [--t0=5,600] [--drive=0,9] [--wind=fjord] [--flip=1]
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const h = await startHarness({});
const page = await h.newPage({ width: 640, height: 400 });
await page.goto(`${h.url}/index.html?test=1&preset=high`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const res = await page.evaluate(async (o) => {
  const g = window.__game, G = g.game, P = await import('/tests/cloth-probe.mjs');
  await g.loadMission(o.mission); g.start(); g.advance(0.5);
  if (o.wind) {
    const W = await import('/src/world/wind.js');
    G.world.wind = new W.WindField(W.resolveWind({ theater: G.missionDef.theater, weather: { wind: { preset: o.wind } } }), { W: G.world.width, D: G.world.depth });
  }
  const v = G.world.entities.find((e) => e.kind === 'vehicle' && (e.tag === o.tag || e.id === o.tag));
  await v.model.ready;
  const root = v.model.root, meshes = P.canvasMeshes(root), R = G.renderer.renderer, out = [];
  for (const T0 of o.t0) for (const spd of o.drive) {
    if (o.flip) { root.rotation.y += Math.PI; o.flip = 0; } // into the wind
    const pos0 = root.position.clone(), hd = root.rotation.y, F = Math.round(o.secs * 60);
    const fwd = { x: Math.sin(hd), z: Math.cos(hd) };
    for (const mesh of meshes) {
      const pr = P.makeProbe(R, mesh), n = pr.n, N = mesh.geometry.attributes.normal, Q = mesh.geometry.attributes.position;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox, L = bb.max.z - bb.min.z, cls = new Array(n);
      for (let i = 0; i < n; i++) { // end panels by position (rear = −Z), the rest by rest normal
        const x = N.getX(i), y = N.getY(i), z = N.getZ(i), a = [Math.abs(x), Math.abs(y), Math.abs(z)], m = Math.max(...a);
        const zr = (Q.getZ(i) - bb.min.z) / L;
        cls[i] = m === a[2] && zr < 0.06 ? 'back' : m === a[2] && zr > 0.94 ? 'front' : m === a[1] ? (y > 0 ? 'top' : 'under') : m === a[0] ? 'side' : 'other';
      }
      const ser = Array.from({ length: n }, () => new Float32Array(F));
      let groups = null, gap = 0;
      for (let k = -30; k < F; k++) { // 0.5 s warm-up (filters settle)
        const t = T0 + k / 60;
        root.position.set(pos0.x + fwd.x * spd * t, pos0.y, pos0.z + fwd.z * spd * t); root.updateMatrixWorld(true);
        G.world.wind.frame(t, { x: root.position.x, z: root.position.z });
        const p = pr.read(), r = pr.rest();
        if (!groups) groups = P.seamGroups(r);
        if (k < 0) continue;
        gap = Math.max(gap, P.maxGap(p, groups));
        for (let i = 0; i < n; i++) { // displacement along the rest normal (world)
          const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), e = mesh.matrixWorld.elements;
          const wx = e[0] * nx + e[4] * ny + e[8] * nz, wy = e[1] * nx + e[5] * ny + e[9] * nz, wz = e[2] * nx + e[6] * ny + e[10] * nz;
          const l = Math.hypot(wx, wy, wz) || 1;
          ser[i][k] = ((p[i * 3] - r[i * 3]) * wx + (p[i * 3 + 1] - r[i * 3 + 1]) * wy + (p[i * 3 + 2] - r[i * 3 + 2]) * wz) / l;
        }
      }
      const panels = {};
      for (const c of ['back', 'side', 'top', 'front']) {
        const idx = []; for (let i = 0; i < n; i += 1) if (cls[i] === c) idx.push(i);
        const moving = idx.filter((i) => { let a = 0; for (const x of ser[i]) a = Math.max(a, Math.abs(x)); return a > 2e-4; });
        const pick = moving.filter((_, j) => j % Math.max(1, Math.floor(moving.length / 60)) === 0);
        if (pick.length) panels[c] = { verts: idx.length, moving: moving.length, ...P.spectrum(pick.map((i) => ser[i])) };
      }
      const cs = (await import('/src/art/cloth-wind.js')).canvasStateOf(mesh);
      const air = cs ? { v: +Math.hypot(cs.vx, cs.vz).toFixed(2), S: +Math.hypot(cs.ax, cs.az).toFixed(2), gust: +cs.g.toFixed(2) } : null;
      out.push({ mesh: mesh.name || mesh.material.name, T0, speed: spd, air, seamGroups: groups.length, maxSeamGapMm: +(gap * 1000).toFixed(2), panels });
      pr.dispose();
    }
    root.position.copy(pos0); root.updateMatrixWorld(true);
  }
  return { preset: G.world.wind.preset, meanSpeed: G.world.wind.p.speed, model: root.userData.truck || root.userData.model, out };
}, { mission: arg('mission', 'm02'), tag: arg('tag', 'truck'), flip: !!arg('flip', ''), secs: Number(arg('secs', 4)), wind: arg('wind', ''),
  t0: arg('t0', '5,600').split(',').map(Number), drive: arg('drive', '0,9').split(',').map(Number) });
console.log(JSON.stringify(res, null, 1));
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
