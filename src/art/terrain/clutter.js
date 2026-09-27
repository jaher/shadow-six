/**
 * Ground clutter: pebbles/stones (per-layer density), wildflowers (Normandy poppies, daisies, buttercups, clover)
 * in noise-driven patches, broad-leaf weeds (dock/plantain rosettes). All instanced, seeded, per-instance colour.
 * @module terrain-b/clutter
 */
import * as THREE from 'three';
import { rng, fbm } from './noise.js';

function stoneGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const r = rng(seed), p = g.attributes.position, v = new THREE.Vector3();
  const sx = 0.7 + 0.6 * r(), sz = 0.7 + 0.6 * r(), sy = 0.35 + 0.3 * r();
  const bumps = [0, 1, 2].map(() => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1; for (const b of bumps) d -= Math.max(0, v.dot(b) - 0.55) * 0.9;
    v.multiplyScalar(d * (0.9 + 0.2 * r()));
    p.setXYZ(i, v.x * sx, Math.max(v.y * sy, -0.1), v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

function flowerGeo(petals, stemH, headR) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.004, 0.005, stemH, 3, 1, true); stem.translate(0, stemH / 2, 0);
  const head = new THREE.CircleGeometry(headR, petals * 2); head.rotateX(-Math.PI / 2 + 0.25); head.translate(0, stemH, 0);
  const pa = head.attributes.position;
  for (let i = 1; i < pa.count; i++) { // scalloped petal outline
    const x = pa.getX(i), z = pa.getZ(i) , a = Math.atan2(z, x);
    const k = 0.6 + 0.4 * Math.abs(Math.cos((a * petals) / 2));
    pa.setX(i, x * k); pa.setZ(i, z * k);
  }
  for (const g of [stem, head]) { g.deleteAttribute('uv'); parts.push(g); }
  // colour: stem green (0), head uses instance colour (1) → encode with a vertex attribute
  const cs = new Float32Array(stem.attributes.position.count).fill(0), ch = new Float32Array(head.attributes.position.count).fill(1);
  ch[0] = 0.5; // darker centre
  stem.setAttribute('aHead', new THREE.BufferAttribute(cs, 1)); head.setAttribute('aHead', new THREE.BufferAttribute(ch, 1));
  const m = mergeSimple(parts);
  return m;
}

function weedGeo(seed) {
  const r = rng(seed), pos = [], idx = [];
  const n = 5 + ((r() * 4) | 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.283 + r() * 0.5, L = 0.12 + 0.12 * r(), w = 0.035 + 0.02 * r(), up = 0.1 + 0.25 * r();
    const c = Math.cos(a), s = Math.sin(a), b = pos.length / 3;
    const pts = [[0, 0.01, 0], [L * 0.45, up * L * 0.6, w], [L, up * L, 0], [L * 0.45, up * L * 0.6, -w]];
    for (const [x, y, z] of pts) pos.push(c * x - s * z, y, s * x + c * z);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.4, Math.abs(nn.getY(i)) + 0.6, nn.getZ(i) * 0.4);
  return g;
}

function mergeSimple(geos) {
  const out = new THREE.BufferGeometry(), attrs = {};
  let off = 0; const idx = [];
  for (const g of geos) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (const i of gi) idx.push(i + off);
    for (const k of Object.keys(g.attributes)) (attrs[k] ||= []).push(...g.attributes[k].array);
    off += g.attributes.position.count;
  }
  for (const k of Object.keys(attrs)) out.setAttribute(k, new THREE.Float32BufferAttribute(attrs[k], geos[0].attributes[k].itemSize));
  out.setIndex(idx);
  return out;
}

const STONE_DENS = { gravel: 1.4, road: 0.8, rock: 1.6, sand: 0.12, sand2: 0.2, ice: 0, slush: 0.1, dirt: 0.3, mud: 0.08, grass: 0.03, grassdry: 0.08, snow: 0.015, snowold: 0.06, snowpack: 0.05, wetsand: 0.1, leaves: 0.1 };
const STONE_COL = { desert: [0xa8906c, 0x8c7458, 0xc0a888, 0x6e5e4c], temperate: [0x8a8680, 0x6e6a64, 0xa09a90, 0x5a5650], snow: [0x5c5e62, 0x707274, 0x4a4c50, 0x88898c] };

/**
 * @param {object} ctx terrain context @param {{clutter:number}} q quality @param {THREE.Group} group parent
 * @param {object} U grass uniforms (unused; kept for API symmetry)
 */
export function createClutter(ctx, q, group) {
  const { W, D, heightAt, materialAt, src } = ctx;
  const dens = q.clutter * (ctx.opts.clutter === false ? 0 : 1);
  const excl = ctx.opts.exclude || null; // step 3p: nothing on / through hard pavement
  const r = rng(4242);
  const meshes = [];
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const col = new THREE.Color();
  if (dens <= 0) return { update() {}, dispose() {} };

  // --- stones -----------------------------------------------------------------------------------------
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  if (src === 'snow' && ctx.addSnowCover) ctx.addSnowCover(stoneMat, { amount: 0.8 });
  const stones = [[], [], [], []];
  const tries = Math.round(W * D * 1.6 * dens);
  for (let i = 0; i < tries; i++) {
    const x = r() * W, z = r() * D;
    if (excl && excl(x, z)) continue;
    const m = materialAt(x, z);
    let d = 0; for (let k = 0; k < 8; k++) d += m.weights[k] * (STONE_DENS[ctx.P.layers[k]] ?? 0.05);
    if (r() * 1.6 > d) continue;
    const big = r() < 0.06 ? 3.5 : 1;
    const s = (0.025 + 0.07 * r() * r()) * big;
    stones[(r() * 4) | 0].push([x, heightAt(x, z) - s * 0.25, z, s, r()]);
  }
  const pal = STONE_COL[src] || STONE_COL.temperate;
  stones.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(stoneGeo(31 + v), stoneMat, list.length);
    list.forEach(([x, y, z, s, c], i) => {
      e.set((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4); qt.setFromEuler(e);
      im.setMatrixAt(i, m4.compose(ps.set(x, y, z), qt, sc.set(s, s, s)));
      im.setColorAt(i, col.set(pal[(c * pal.length) | 0]).multiplyScalar(0.8 + 0.4 * r()));
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'clutterStones';
    group.add(im); meshes.push(im);
  });

  // --- wildflowers (temperate) + weeds -------------------------------------------------------------------
  if (src === 'temperate') {
    const FL = [
      { name: 'poppy', col: [0xb81c10, 0xd02818], petals: 4, h: [0.28, 0.45], r: 0.03 },
      { name: 'daisy', col: [0xe8e4d8, 0xf0ece0], petals: 12, h: [0.08, 0.16], r: 0.014 },
      { name: 'buttercup', col: [0xd8b418, 0xe8c420], petals: 5, h: [0.18, 0.32], r: 0.012 },
      { name: 'clover', col: [0xa86890, 0xc088a8], petals: 8, h: [0.06, 0.12], r: 0.012 },
      { name: 'yarrow', col: [0xe0dcc8, 0xd8d0c0], petals: 16, h: [0.3, 0.5], r: 0.03 },
    ];
    const fMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    fMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aHead;\nvarying float vHead;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHead = aHead;');
      sh.fragmentShader = 'varying float vHead;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = vHead < 0.25 ? vec3(0.05, 0.09, 0.02) : vHead < 0.75 ? diffuseColor.rgb * 0.35 + vec3(0.12, 0.09, 0.0) : diffuseColor.rgb;`);
    };
    fMat.customProgramCacheKey = () => 'clutterFlower';
    const nF = Math.round(W * D * 2.2 * dens);
    FL.forEach((f, fi) => {
      const list = [];
      for (let i = 0; i < nF; i++) {
        const x = r() * W, z = r() * D;
        if (excl && excl(x, z)) continue;
        const patch = fbm(x / 7 + fi * 13.1, z / 7 - fi * 7.7, 3, 900 + fi);
        const m = materialAt(x, z);
        const g = m.weights[0] + m.weights[1] * 0.6;
        if (r() > g * Math.max(0, (patch - 0.55) * 4) * (fi === 0 ? 0.25 : 0.12)) continue;
        list.push([x, z]);
      }
      if (!list.length) return;
      const im = new THREE.InstancedMesh(flowerGeo(f.petals, 1, f.r / 0.6), fMat, list.length);
      list.forEach(([x, z], i) => {
        const h = f.h[0] + (f.h[1] - f.h[0]) * r();
        e.set((r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3); qt.setFromEuler(e);
        im.setMatrixAt(i, m4.compose(ps.set(x, heightAt(x, z) - 0.01, z), qt, sc.set(0.6, h, 0.6)));
        im.setColorAt(i, col.set(f.col[(r() * 2) | 0]).multiplyScalar(0.85 + 0.3 * r()));
      });
      im.name = 'clutterFlowers_' + f.name; im.receiveShadow = true;
      group.add(im); meshes.push(im);
    });
  }
  if (src === 'temperate' || src === 'desert') {
    const wMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
    const list = [];
    for (let i = 0; i < W * D * 0.5 * dens; i++) {
      const x = r() * W, z = r() * D, m = materialAt(x, z);
      if (excl && excl(x, z)) continue;
      const g = src === 'temperate' ? m.weights[0] * 0.5 + m.weights[2] * 0.6 + m.weights[1] * 0.4 : m.weights[6] * 0.6 + m.weights[3] * 0.08 + (m.weights[0] + m.weights[1]) * 0.035; // T-A desert shrubs on open sand
      if (r() < g) list.push([x, z]);
    }
    if (list.length) {
      const im = new THREE.InstancedMesh(weedGeo(7), wMat, list.length);
      list.forEach(([x, z], i) => {
        const s = (0.7 + 0.9 * r()) * (src === 'desert' && r() < 0.35 ? 2.2 : 1); // some low camel-thorn bushes
        e.set(0, r() * 6.28, 0); qt.setFromEuler(e);
        im.setMatrixAt(i, m4.compose(ps.set(x, heightAt(x, z), z), qt, sc.set(s, s, s)));
        im.setColorAt(i, src === 'desert' ? col.setRGB(0.2 + 0.08 * r(), 0.18 + 0.05 * r(), 0.08) : col.setRGB(0.05 + 0.04 * r(), 0.1 + 0.05 * r(), 0.025));
      });
      im.name = 'clutterWeeds'; im.receiveShadow = true; im.castShadow = true;
      group.add(im); meshes.push(im);
    }
  }
  return {
    meshes,
    get count() { return meshes.reduce((s, m) => s + m.count, 0); },
    update() {},
    dispose() { for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.dispose?.(); } },
  };
}
