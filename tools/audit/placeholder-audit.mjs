#!/usr/bin/env node
/**
 * Placeholder-art audit (GPU headless, the browser test harness): for every mission, load it, wait for the building /
 * vehicle libraries to settle, then list every visible object still drawn with the catalogue PLACEHOLDER primitives
 * (plain boxes / cylinders / spheres in flat palette colours, art/materials.js), every vehicle without its library
 * model and every structure floating above the ground. Saves start-view stills at the default zoom and zoom 2 plus a
 * zoom-2 crop on each placeholder.
 *
 *   node tools/audit/placeholder-audit.mjs [--missions=m01,m05] [--out=dir] [--shots=0] [--tag=before] [--from=before-audit.json]
 * → <out>/<tag>-audit.json, <out>/<tag>-<mission>-start-z<zoom>.jpg, <out>/<tag>-<mission>-ph<n>-<id>.jpg
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ALL = ['m00', ...Array.from({ length: 20 }, (_, k) => `m${String(k + 1).padStart(2, '0')}`), 'b00'];
const missions = arg('missions', ALL.join(',')).split(',');
const out = resolve(arg('out', join(ROOT, 'tests/out/placeholder-audit')));
const tag = arg('tag', 'before');
const shots = arg('shots', '1') !== '0';
const maxCrops = Number(arg('crops', 16));
const FROM = arg('from', '') ? JSON.parse(readFileSync(resolve(arg('from', '')), 'utf8')) : null;
mkdirSync(out, { recursive: true });
const VIEW = { width: 1280, height: 720 };
const h = await startHarness({ viewport: VIEW });
const report = {};
try {
  for (const m of missions) {
    const page = await h.newPage(VIEW);
    await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
    const r = await page.evaluate(async ({ m, WAIT }) => {
      const g = window.__game, G = g.game;
      await g.loadMission(m);
      g.start();
      for (let i = 0; i < 10; i++) g.step();
      const w = G.world;
      // let async model loads settle (library buildings, vehicles, static vehicles)
      await Promise.all(w.entities.filter((e) => e.model?.ready).map((e) => Promise.resolve(e.model.ready).catch(() => null)));
      // …and every texture the scene's materials reference (library lib/1k sets, dressing sets) to finish decoding
      const pending = () => {
        let n = 0;
        G.renderer.scene.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'roughnessMap']) {
            const t = m?.[k]; if (!t || t.isRenderTargetTexture || t.isDataTexture || t.isCanvasTexture) continue;
            const im = t.image ?? t.source?.data;
            if (!im || (im.complete === false) || !(im.width > 0)) n++;
          }
        });
        return n;
      };
      const t0 = performance.now();
      while (performance.now() - t0 < WAIT && pending() > 0) { await new Promise((res) => setTimeout(res, 300)); for (let i = 0; i < 2; i++) g.step(); g.render(); }
      await new Promise((res) => setTimeout(res, 1500));
      for (let i = 0; i < 5; i++) g.step();
      const { PALETTE } = await import('/src/art/materials.js');
      const PRIM = /^(Box|Cylinder|Sphere|Cone|Dodecahedron|Circle|Plane)Geometry$/;
      const paletteMat = (mat) => !!mat && Object.prototype.hasOwnProperty.call(PALETTE, mat.name);
      const THREE = await import('three');
      const box = new THREE.Box3();
      const isVisible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
      const { grainTexture } = await import('/src/art/materials.js');
      const grain = grainTexture();
      // untextured = flat colour (no map, or the placeholder palette's grain noise), opaque, not a light / glass
      const plainMat = (mt) => !!mt && !mt.transparent && !(mt.emissiveIntensity > 0.2 && mt.emissive?.getHex?.()) && (!mt.map || mt.map === grain) && !/glass|glow|lamp|lens|water/i.test(mt.name || '');
      const mb = new THREE.Box3(), sz = new THREE.Vector3();
      const classify = (root) => {
        let lib = false, prim = 0, other = 0, vis = 0, plainA = 0, allA = 0, plainMax = 0;
        const mats = new Set();
        root.traverse((o) => {
          if (o.userData?.libraryAsset || o.userData?.vehicleAsset) lib = true;
          if (!o.isMesh || !isVisible(o)) return;
          vis++;
          const ms = [].concat(o.material || []);
          mb.setFromObject(o); mb.getSize(sz);
          const dims = [sz.x, sz.y, sz.z].sort((a, b) => a - b);
          if (dims[1] < 0.07) return; // wires, cords, ropes: thin lines, not surfaces
          const a = 2 * (sz.x * sz.y + sz.y * sz.z + sz.x * sz.z) * (o.isInstancedMesh ? 1 : 1);
          allA += a;
          const plain = ms.every(plainMat);
          if (plain) { plainA += a; plainMax = Math.max(plainMax, sz.x, sz.y, sz.z); for (const x of ms) mats.add(x.name || 'unnamed'); }
          if (PRIM.test(o.geometry?.type || '') && plain) prim++; else other++;
        });
        return { lib, prim, other, vis, mats: [...mats], plainFrac: allA ? plainA / allA : 0, plainMax };
      };
      const gy0 = (x, z) => (typeof w.groundY === 'function' ? w.groundY(x, z) : 0) + (w.grid.elevAt?.(x, z) || 0);
      // highest ground around / under a box (raised plateaus, cliffs, terraces carry their structures)
      const groundY = (b) => { let y = -Infinity; for (const fx of [-0.1, 0.25, 0.5, 0.75, 1.1]) for (const fz of [-0.1, 0.25, 0.5, 0.75, 1.1]) y = Math.max(y, gy0(b.min.x + (b.max.x - b.min.x) * fx, b.min.z + (b.max.z - b.min.z) * fz)); return y; };
      const list = [], floating = [], counts = { structures: 0, lib: 0, proc: 0, placeholder: 0, partial: 0 };
      for (const [key, s] of w.structures || []) {
        const o = s.object3d;
        if (!o || !isVisible(o) || !o.parent) continue;
        counts.structures++;
        const c = classify(o);
        if (!c.vis) continue;
        box.setFromObject(o);
        const size = box.getSize(new THREE.Vector3());
        const x = +(s.def.x ?? (box.min.x + box.max.x) / 2).toFixed(1), z = +(s.def.z ?? (box.min.z + box.max.z) / 2).toFixed(1);
        const rec = { id: String(key), type: s.type, variant: s.def.variant ?? null, x, z, size: [+size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1)], prim: c.prim, other: c.other, plain: +c.plainFrac.toFixed(2), mats: c.mats };
        if (c.lib && c.plainFrac < 0.5) counts.lib++;
        else if (c.plainFrac >= 0.6 && c.plainMax > 0.5) { counts.placeholder++; list.push({ kind: 'placeholder', ...rec }); }
        else if (c.plainFrac >= 0.3 && c.plainMax > 2) { counts.partial++; list.push({ kind: 'partial', ...rec }); }
        else counts.proc++;
        // floating: bottom well above the ground under its centre (bridges / decks / raised builds excluded)
        const gy = groundY(box);
        if (box.min.y - gy > 0.35 && !/bridge|pier|deck|cable|lamp|sign|flag|wire/.test(s.type) && !s.def.elev && !s.def.y) floating.push({ ...rec, gap: +(box.min.y - gy).toFixed(2) });
      }
      // vehicles / emplacements without their library model
      const veh = [];
      for (const e of w.entities) {
        if (!e.model || e.kind === 'commando' || e.kind === 'enemy' || e.isCharacter) continue;
        if (!(e.vehicleType || e.type) || !e.model.root) continue;
        if (e.model.library || e.model.isReal) continue;
        if (e.model.kit && classify(e.model.root).plainFrac < 0.05) continue; // textured kit model (art/kit-vehicles.js)
        const root = e.model.root;
        const c = classify(root);
        if (!c.vis || c.lib) continue;
        veh.push({ kind: 'vehicle', id: String(e.tag ?? e.id), type: e.vehicleType || e.type, x: +e.x.toFixed(1), z: +e.z.toFixed(1), prim: c.prim, other: c.other, mats: c.mats });
      }
      // stray primitive meshes outside the structures / entities (props root children etc.)
      const owned = new Set();
      for (const [, s] of w.structures || []) s.object3d?.traverse((o) => owned.add(o));
      for (const e of w.entities) e.model?.root?.traverse?.((o) => owned.add(o));
      const strays = new Map();
      G.renderer.scene.traverse((o) => {
        if (!o.isMesh || owned.has(o) || !isVisible(o) || o.isInstancedMesh) return;
        const ms = [].concat(o.material || []);
        if (!ms.every(plainMat)) return;
        box.setFromObject(o);
        const size = box.getSize(new THREE.Vector3());
        if (Math.max(size.x, size.y, size.z) < 0.6) return;
        let top = o; while (top.parent && top.parent !== G.renderer.scene && !owned.has(top.parent)) top = top.parent;
        const k = top.name || top.uuid;
        if (/^(terrain:ground|pavement|furniture|water|sky)/.test(k)) return;
        for (let p = o; p; p = p.parent) if (p.name === 'wire-layer') return; // barbed-wire strands: their own shader art (art/barbed-wire.js)
        const c = box.getCenter(new THREE.Vector3());
        if (!strays.has(k)) strays.set(k, { kind: 'stray', id: k, name: o.name, x: +c.x.toFixed(1), z: +c.z.toFixed(1), size: [+size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1)], mats: ms.map((x) => x.name), n: 0 });
        strays.get(k).n++;
      });
      const { vehicleArtContext } = await import('/src/art/vehicle-model.js');
      const c0 = w.commandos[0];
      return { counts, list, veh, strays: [...strays.values()], floating, vehLog: vehicleArtContext().log.filter((l) => /placeholder/.test(l)), start: c0 ? { x: c0.x, z: c0.z } : null, zoom: G.cameraController?.zoom ?? null, pendingTex: pending(), waitMs: Math.round(performance.now() - t0) };
    }, { m, WAIT: Number(arg('wait', 30000)) });
    report[m] = r;
    console.log(`${m}: structures ${r.counts.structures} lib ${r.counts.lib} proc ${r.counts.proc} PH ${r.counts.placeholder} partial ${r.counts.partial} veh ${r.veh.length} strays ${r.strays.length} floating ${r.floating.length}`);
    for (const p of [...r.list, ...r.veh, ...r.strays]) console.log(`   ${p.kind} ${p.type ?? ''} ${p.variant ?? ''} id=${p.id} @${p.x},${p.z} ${p.size ? p.size.join('x') : ''} [${(p.mats || []).join(',')}]`);
    for (const l of r.vehLog) console.log(`   vehlog ${l}`);
    for (const p of r.floating) console.log(`   floating ${p.type} id=${p.id} @${p.x},${p.z} gap ${p.gap}`);
    if (shots) {
      const snap = async (file) => { await page.evaluate(() => window.__game.render()); await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 80 }); };
      if (r.start) {
        await page.evaluate(({ x, z }) => { const g = window.__game; g.centerOn(x, z); g.render(); }, r.start);
        await snap(`${tag}-${m}-start-zdef.jpg`);
        await page.evaluate(({ x, z }) => { const g = window.__game; g.setZoom(2); g.centerOn(x, z); g.render(); }, r.start);
        await snap(`${tag}-${m}-start-z2.jpg`);
      }
      // --from=<before-audit.json>: crop the BEFORE run's spots (same names → before/after pairs)
      const src = FROM ? FROM[m] : r;
      const crops = src ? [...src.list, ...src.veh, ...src.strays].slice(0, maxCrops) : [];
      for (let k = 0; k < crops.length; k++) {
        const p = crops[k];
        await page.evaluate(({ x, z }) => { const g = window.__game; g.setZoom(2); g.centerOn(x, z); g.render(); }, p);
        await snap(`${tag}-${m}-ph${k}-${String(p.id).replace(/[^\w.-]+/g, '_').slice(0, 40)}.jpg`);
      }
    }
    await page.close();
  }
} finally {
  writeFileSync(join(out, `${tag}-audit.json`), JSON.stringify(report, null, 1));
  await h.close();
}
