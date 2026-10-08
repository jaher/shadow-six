#!/usr/bin/env node
/**
 * Texel density of every image texture the missions draw: for each texture file, the texels per metre of its most
 * stretched surfaces (per triangle: the smaller singular value of the world → UV Jacobian × the image size, so a
 * stretched UV counts by its blurriest axis), as area-weighted percentiles over every mesh that uses it.
 *
 * The game camera is orthographic with a fixed scale (40 CSS px/m × zoom ≤ 2 × the preset's pixel-ratio cap), so a
 * texture whose density stays above the screen's px/m everywhere never has its top mip level sampled: a smaller
 * file draws the same picture. tools/perf/texture-tiers.mjs turns this table into per-preset tiers.
 *
 *   node tools/perf/texel-density.mjs [--missions=m01,m02|all] [--preset=high] [--out=assets/textures/lib/density.json]
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', '<projects>/commandos-shots/memory/texel-density.json');
const h = await startHarness({});
let ids = arg('missions', 'all');
const merged = existsSync(OUT) && process.argv.includes('--merge') ? JSON.parse(readFileSync(OUT, 'utf8')).textures : {};
if (ids === 'all') {
  const p = await h.newPage();
  await h.openGame(p);
  ids = (await p.evaluate(async () => (await import('/src/missions/index.js')).MISSIONS.map((m) => m.id))).join(',');
  await p.close();
}
for (const id of ids.split(',')) {
  const page = await h.newPage({ width: 1280, height: 720 });
  try {
    await page.addInitScript({ path: join(ROOT, 'tools/perf/mem-probe.js') });
    await h.openGame(page, `?test=1&preset=${arg('preset', 'high')}`);
    await page.evaluate(async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      window.__memProbe.hookThree(THREE, { GLTFLoader });
    });
    const r = await page.evaluate(async (mid) => {
      await window.__game.loadMission(mid);
      const P = window.__memProbe;
      const G = window.__game.game, scene = G.renderer.scene;
      const THREE = await import('three');
      const out = {}; // key → {samples: [[density, area]], w, h, users:Set}
      const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), m4 = new THREE.Matrix4(), im = new THREE.Matrix4();
      const keyOf = (t) => {
        const img = t.image;
        let u = P.tags.get(img) || img?.currentSrc || img?.src || '';
        if (!u || /^blob:|^data:/.test(u)) u = (P.tags.get(t) || '?') + '#' + (t.name || '');
        return String(u).replace(/^https?:\/\/[^/]+\//, '');
      };
      const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap'];
      // GLB of each mesh: walk up to a named library root (userData set by the loaders), else the mesh name
      const glbOf = (o) => { for (let p = o; p; p = p.parent) { const u = p.userData?.url || p.userData?.glb || p.userData?.asset; if (u) return String(u); } return null; };
      scene.updateMatrixWorld(true);
      // LOD1 / LOD2 are only drawn zoomed out (≤ 0.8×: half the screen density or less): the close view decides
      const farLod = (o) => { for (let p = o; p; p = p.parent) if (/(^|_)lod[12]$/i.test(p.name || '')) return true; return false; };
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position || !o.geometry.attributes.uv || farLod(o)) return;
        const mats = [].concat(o.material);
        const g = o.geometry, pos = g.attributes.position, uvA = g.attributes.uv, idx = g.index;
        const triCount = idx ? idx.count / 3 : pos.count / 3;
        const step = Math.max(1, Math.floor(triCount / 4000)); // sample big meshes
        const inst = o.isInstancedMesh && o.count > 0;
        if (inst) { o.getMatrixAt(0, im); m4.multiplyMatrices(o.matrixWorld, im); } else m4.copy(o.matrixWorld);
        for (const mat of mats) {
          for (const k of MAPS) {
            const t = mat?.[k];
            if (!t?.isTexture || !t.image || t.isDataArrayTexture || t.isRenderTargetTexture) continue;
            const W = t.image.width || t.image.naturalWidth, H = t.image.height || t.image.naturalHeight;
            if (!W || !H) continue;
            t.updateMatrix?.();
            const rx = Math.hypot(t.matrix.elements[0], t.matrix.elements[1]), ry = Math.hypot(t.matrix.elements[3], t.matrix.elements[4]);
            const key = keyOf(t);
            const e = (out[key] ||= { samples: [], w: W, h: H, users: new Set(), maps: new Set() });
            e.users.add(glbOf(o) || o.name || o.parent?.name || '?'); e.maps.add(k);
            const grp = g.groups?.length && mats.length > 1 ? g.groups.filter((gg) => gg.materialIndex === mats.indexOf(mat)) : [{ start: 0, count: idx ? idx.count : pos.count }];
            for (const gg of grp) {
              for (let tri = gg.start / 3; tri < (gg.start + gg.count) / 3; tri += step) {
                const i0 = idx ? idx.getX(tri * 3) : tri * 3, i1 = idx ? idx.getX(tri * 3 + 1) : tri * 3 + 1, i2 = idx ? idx.getX(tri * 3 + 2) : tri * 3 + 2;
                pa.fromBufferAttribute(pos, i0).applyMatrix4(m4); pb.fromBufferAttribute(pos, i1).applyMatrix4(m4); pc.fromBufferAttribute(pos, i2).applyMatrix4(m4);
                // triangle frame: e1 along ab, e2 perpendicular in-plane
                const abx = pb.x - pa.x, aby = pb.y - pa.y, abz = pb.z - pa.z, acx = pc.x - pa.x, acy = pc.y - pa.y, acz = pc.z - pa.z;
                const lab = Math.hypot(abx, aby, abz);
                const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
                const area2 = Math.hypot(cx, cy, cz);
                if (lab < 1e-5 || area2 < 1e-8) continue;
                const x1 = lab, x2 = (abx * acx + aby * acy + abz * acz) / lab, y2 = area2 / lab; // c in the frame (x2, y2); b = (x1, 0)
                const u0 = uvA.getX(i0) * rx * W, v0 = uvA.getY(i0) * ry * H;
                const du1 = uvA.getX(i1) * rx * W - u0, dv1 = uvA.getY(i1) * ry * H - v0, du2 = uvA.getX(i2) * rx * W - u0, dv2 = uvA.getY(i2) * ry * H - v0;
                // Jacobian J (texels per metre): [du/dx du/dy; dv/dx dv/dy]
                const a = du1 / x1, c = dv1 / x1, b = (du2 - a * x2) / y2, d = (dv2 - c * x2) / y2;
                // singular values of [[a,b],[c,d]]
                const s1 = a * a + b * b + c * c + d * d, det = Math.abs(a * d - b * c);
                const disc = Math.sqrt(Math.max(0, s1 * s1 / 4 - det * det));
                const smin = Math.sqrt(Math.max(0, s1 / 2 - disc));
                e.samples.push([smin, area2 / 2 * step]);
              }
            }
          }
        }
      });
      const res = {};
      for (const [k, e] of Object.entries(out)) {
        const s = e.samples.filter((x) => Number.isFinite(x[0])).sort((p, q) => p[0] - q[0]);
        const A = s.reduce((acc, x) => acc + x[1], 0);
        const pct = (q) => { let acc = 0; for (const [d, w] of s) { acc += w; if (acc >= q * A) return +d.toFixed(1); } return s.length ? +s[s.length - 1][0].toFixed(1) : null; };
        res[k] = { w: e.w, h: e.h, area: +A.toFixed(1), p0: s.length ? +s[0][0].toFixed(1) : null, p1: pct(0.01), p2: pct(0.02), p5: pct(0.05), p50: pct(0.5), users: [...e.users].slice(0, 6), maps: [...e.maps] };
      }
      return res;
    }, id);
    let n = 0;
    for (const [k, v] of Object.entries(r)) {
      n++;
      const m = merged[k];
      if (!m) { merged[k] = { ...v, missions: [id] }; continue; }
      // min over missions (the strictest use), keep the largest area's median
      for (const q of ['p0', 'p1', 'p2', 'p5']) m[q] = Math.min(m[q] ?? Infinity, v[q] ?? Infinity);
      if (v.area > m.area) { m.p50 = v.p50; m.area = v.area; }
      m.users = [...new Set([...m.users, ...v.users])].slice(0, 8);
      m.maps = [...new Set([...m.maps, ...v.maps])];
      if (!m.missions.includes(id)) m.missions.push(id);
    }
    console.log(`${id}: ${n} textures`);
  } catch (e) {
    console.log(`${id}: FAILED ${e.message}`);
  } finally {
    await page.close();
  }
}
writeFileSync(OUT, JSON.stringify({ about: 'texels per metre (smaller singular value of world → texel Jacobian) per texture file at its loaded size: p0/p1/p2/p5 = area-weighted percentiles (low = most stretched), p50 median', textures: merged }, null, 1));
await h.close();
const rows = Object.entries(merged).sort((a, b) => (a[1].p2 ?? 0) - (b[1].p2 ?? 0));
console.log(`${rows.length} textures → ${OUT}`);
for (const [k, v] of rows.slice(0, 30)) console.log(`${String(v.p2).padStart(8)} ${String(v.p5).padStart(8)} ${String(v.p50).padStart(8)}  ${v.w}x${v.h}  ${k.slice(0, 90)}  ${v.users.slice(0, 3).join(',').slice(0, 80)}`);
