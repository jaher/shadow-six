#!/usr/bin/env node
/**
 * One map corner rendered with apron parts toggled (diagnosis aid for tools/audit/edge-sweep.mjs findings).
 *   node tools/audit/edge-probe.mjs <mission> <width>x<height> <yaw> <zoom> <sx>,<sy> <outDir>
 * Saves <outDir>/probe-<mission>-<variant>.jpg for: all, no apron trees, apron trees without shadows,
 * no apron ground, map edge outlined.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const [id = 'm04', size = '2560x1080', yaw = '45', zoom = '0.5', push = '1,-1', out = join(ROOT, 'tests/out/edge-probe')] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number), [sx, sy] = push.split(',').map(Number);
mkdirSync(out, { recursive: true });
const H = await startHarness();
try {
  const page = await H.newPage({ width: w, height: h });
  await H.openGame(page);
  await page.waitForTimeout(500);
  const shots = await page.evaluate(async ({ id, yaw, zoom, sx, sy }) => {
    const g = window.__game, G = g.game, cc = G.cameraController;
    await g.loadMission(id); g.start();
    await G.mapHandle?.terrain?.apronReady;
    G.cameraRig.setYaw(yaw); g.setZoom(zoom);
    cc.centerOn(G.world.width / 2, G.world.depth / 2);
    for (let i = 0; i < 400; i++) cc._panScreenMetres(sx * 2, sy * 2);
    const ap = G.mapHandle.terrain.apron, veg = ap.vegetation?.group;
    const cv = G.renderer.domElement, res = {};
    const snap = (k) => { g.render(); g.render(); res[k] = cv.toDataURL('image/jpeg', 0.8); };
    snap('all');
    const meshes = [];
    veg?.traverse((o) => { if (o.isMesh) meshes.push(o); });
    meshes.forEach((m) => { m.userData._cs = m.castShadow; m.castShadow = false; });
    snap('apron-trees-no-shadow');
    meshes.forEach((m) => { m.castShadow = m.userData._cs; });
    if (veg) veg.visible = false;
    snap('no-apron-trees');
    if (veg) veg.visible = true;
    ap.mesh.visible = false;
    snap('no-apron-ground');
    ap.mesh.visible = true;
    return { res, info: { target: [cc.target.x, cc.target.z], zoom: cc.zoom, vegMeshes: meshes.map((m) => m.name) } };
  }, { id, yaw: Number(yaw), zoom: Number(zoom), sx, sy });
  for (const [k, url] of Object.entries(shots.res)) writeFileSync(join(out, `probe-${id}-${k}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(JSON.stringify(shots.info));
} finally {
  await H.close();
}
