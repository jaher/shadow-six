/**
 * Ground clutter: pebbles/stones (per-layer density), wildflowers (Normandy poppies, daisies, buttercups, clover)
 * in noise-driven patches by season, broad-leaf weeds (3D dock/plantain rosettes). All instanced, seeded, per-instance
 * colour. Desert plants live in scrub.js (3D archetypes), not here.
 * @module terrain-b/clutter
 */
import * as THREE from 'three';
import { WIND_GLSL } from '../../world/wind.js';
import { rng, fbm } from './noise.js';
import { makeBuf, leaf, blade, panicle } from './grass-arch.js';
import { onDryLand, GROUND_SHORE_MARGIN } from '../../world/veg-shore.js';

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

function flowerGeo(petals, stemH, headR, cup = 0.5) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.004, 0.005, stemH, 3, 1, true); stem.translate(0, stemH / 2, 0);
  const head = new THREE.CircleGeometry(headR, petals * 2); head.rotateX(-Math.PI / 2);
  const pa = head.attributes.position;
  for (let i = 1; i < pa.count; i++) { // scalloped petal outline, petals rising into a cup (3D head, not a disc)
    const x = pa.getX(i), z = pa.getZ(i), a = Math.atan2(z, x);
    const k = 0.6 + 0.4 * Math.abs(Math.cos((a * petals) / 2));
    pa.setX(i, x * k); pa.setZ(i, z * k); pa.setY(i, headR * k * cup);
  }
  head.rotateX(0.25); head.translate(0, stemH, 0); head.computeVertexNormals();
  // two stem leaves (lanceolate, rising) so a flower is a plant, not a lollipop
  const lv = [];
  for (const [y, a] of [[0.25, 0.4], [0.5, 3.6]]) {
    const c = Math.cos(a), sn = Math.sin(a), L = stemH * 0.32, w = headR * 0.35 + 0.004;
    lv.push([0, stemH * y, 0], [c * L * 0.5 - sn * w, stemH * (y + 0.08), sn * L * 0.5 + c * w], [c * L, stemH * (y + 0.2), sn * L], [c * L * 0.5 + sn * w, stemH * (y + 0.08), sn * L * 0.5 - c * w]);
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(lv.flat(), 3));
  leaves.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); leaves.computeVertexNormals();
  for (const g of [stem, head]) { g.deleteAttribute('uv'); parts.push(g); }
  parts.push(leaves);
  // colour: stem green (0), head uses instance colour (1) → encode with a vertex attribute
  const cs = new Float32Array(stem.attributes.position.count).fill(0), ch = new Float32Array(head.attributes.position.count).fill(1);
  ch[0] = 0.5; // darker centre
  stem.setAttribute('aHead', new THREE.BufferAttribute(cs, 1)); head.setAttribute('aHead', new THREE.BufferAttribute(ch, 1));
  leaves.setAttribute('aHead', new THREE.BufferAttribute(new Float32Array(8), 1));
  const m = mergeSimple(parts);
  return m;
}

/**
 * Dock / plantain rosette: cupped, ovate leaves on short petioles rising 30–60° and arching over (grass-arch leaf()),
 * optionally an upright seed spike. Real volume: height ≥ 0.25 × width (no flat star cut-out).
 */
function rosetteGeo(seed, spike) {
  const r = rng(seed), B = makeBuf();
  const n = 5 + ((r() * 3) | 0);
  for (let k = 0; k < n; k++) {
    leaf(B, { a: (k / n) * 6.283 + r() * 0.5, L: 0.11 + 0.08 * r(), W: 0.03 + 0.015 * r(), elev: 0.6 + 0.45 * r(), curl: 0.18 + 0.15 * r(), cup: 0.45 });
  }
  leaf(B, { a: r() * 6.283, L: 0.1, W: 0.022, elev: 1.25, curl: 0.12 });
  if (spike) { // seed spike: a stem with spikelets (dock / plantain)
    const tip = blade(B, { bx: 0, bz: 0, a: r() * 6.283, h: 0.32 + 0.12 * r(), w: 0.004, lean: 0.06, seg: 3, taper: 0.5 });
    panicle(B, tip, 0.4, 8, 0.02, r, 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
  g.setIndex(B.idx);
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) { const l = Math.hypot(nn.getX(i), nn.getY(i), nn.getZ(i)) || 1; nn.setXYZ(i, nn.getX(i) / l, nn.getY(i) / l, nn.getZ(i) / l); }
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
/**
 * Wind + brushing for the flowers and the dock / plantain rosettes (critic: frozen next to swaying grass): the shared
 * wind field bends each plant from its base (∝ height², stem stiffness uClAmp), gusts add lean, and the trail /
 * flatten RT (walkers brushing through) presses the stems over and splays them like the grass tufts.
 */
const CLUTTER_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = vec3(0.0);
#endif
{
  vec3 rel = mvPosition.xyz - ip;
  float hh = max(rel.y, 0.0), t = clamp(hh / uClH, 0.0, 1.2);
  vec2 uvT = ip.xz * uMapG.zw;
  float inMap = step(0.0, uvT.x) * step(uvT.x, 1.0) * step(0.0, uvT.y) * step(uvT.y, 1.0);
  float fl = clamp(texture(tFlatG, uvT).r + texture(tTrail, uvT).r * 0.8, 0.0, 1.0) * inMap;
  vec2 pd = normalize(vec2(sin(ip.x * 12.9 + ip.z * 4.1), cos(ip.x * 3.7 - ip.z * 9.3)) + 1e-3);
  mvPosition.xz += pd * hh * fl * 0.8;                        // brushed / trodden: pressed over, splayed
  mvPosition.y -= hh * fl * 0.72;
  vec4 wS = windSample(ip.xz);
  float ws = windStr(wS) * uWindStr;
  vec2 wd = length(wS.xy) > 1e-3 ? wS.xy / length(wS.xy) : uWindA.xy;
  float ph = uWindA.w * (2.0 + 0.6 * fract(ip.x * 3.17)) + dot(ip.xz, vec2(0.37, 0.21)) * 3.0;
  float lean = ws * ws * 0.9 + wS.z * uWindStr * 0.5;
  float osc = (sin(ph) * 0.6 + sin(ph * 2.7 + 1.1) * 0.25 + wS.w * 0.15) * (0.12 + 0.6 * ws) * uWindStr;
  vec2 off = (wd * (lean + osc * 0.5) + vec2(-wd.y, wd.x) * osc * 0.3) * t * t * uClAmp * (1.0 - fl);
  mvPosition.xz += off;
  mvPosition.y -= dot(off, off) * 0.5 / max(hh, 0.05);         // the stem keeps its length as it bends
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
const CLUTTER_PARS = 'uniform float uWindStr;\nuniform float uClAmp;\nuniform float uClH;\nuniform sampler2D tTrail;\nuniform sampler2D tFlatG;\nuniform vec4 uMapG;\n';
/** Patch a clutter material (or its depth material) with the wind bend. U: the grass uniforms (wind, trail RT). */
function windClutter(m, U, amp, h, key) {
  if (!U) return m;
  const own = { uClAmp: { value: amp }, uClH: { value: h } };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = WIND_GLSL + CLUTTER_PARS + sh.vertexShader.replace('#include <project_vertex>', CLUTTER_PROJECT);
  };
  m.customProgramCacheKey = () => key;
  m.userData.windAmp = own.uClAmp; // tests / tuning
  return m;
}

export function createClutter(ctx, q, group, U = null) {
  const { W, D, heightAt, materialAt, src } = ctx;
  const dens = q.clutter * (ctx.opts.clutter === false ? 0 : 1);
  const excl = ctx.opts.exclude || null; // step 3p: nothing on / through hard pavement
  // flowers and weed rosettes never stand in the water (world/veg-shore.js; the river / lake bed's mud and dry-grass
  // splat once planted them there): 1 / 0 so the counts add up
  const dry = (x, z) => (ctx.waterSD && !onDryLand(ctx.waterSD, x, z, GROUND_SHORE_MARGIN) ? 0 : 1);
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
  const prof = ctx.veg || { flowers: 1, season: 'summer' };
  if (src === 'temperate' && prof.flowers > 0) {
    const FL = [
      { name: 'poppy', col: [0xb81c10, 0xd02818], petals: 4, h: [0.28, 0.45], r: 0.03 },
      { name: 'daisy', col: [0xe8e4d8, 0xf0ece0], petals: 12, h: [0.08, 0.16], r: 0.014 },
      { name: 'buttercup', col: [0xd8b418, 0xe8c420], petals: 5, h: [0.18, 0.32], r: 0.012 },
      { name: 'clover', col: [0xa86890, 0xc088a8], petals: 8, h: [0.06, 0.12], r: 0.012 },
      { name: 'yarrow', col: [0xe0dcc8, 0xd8d0c0], petals: 16, h: [0.3, 0.5], r: 0.03 },
    ];
    // season mix (docs/vegetation.md §3.9): May buttercups / daisies / clover; late summer yarrow, fewer poppies
    const SEAS = { spring: [1, 1.2, 1.5, 1.1, 0.3], summer: [1, 1, 1, 1, 1], late: [0.4, 0.6, 0.5, 0.8, 1.6], autumn: [0.1, 0.5, 0.2, 0.4, 0.6] }[prof.season] || [1, 1, 1, 1, 1];
    const fMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    fMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aHead;\nvarying float vHead;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHead = aHead;');
      sh.fragmentShader = 'varying float vHead;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = vHead < 0.25 ? vec3(0.05, 0.09, 0.02) : vHead < 0.75 ? diffuseColor.rgb * 0.35 + vec3(0.12, 0.09, 0.0) : diffuseColor.rgb;`);
    };
    windClutter(fMat, U, 0.16, 0.4, 'clutterFlowerW'); // thin stems: a soft bend
    const nF = Math.round(W * D * 2.2 * dens);
    FL.forEach((f, fi) => {
      const list = [];
      for (let i = 0; i < nF; i++) {
        const x = r() * W, z = r() * D;
        if (excl && excl(x, z)) continue;
        const patch = fbm(x / 7 + fi * 13.1, z / 7 - fi * 7.7, 3, 900 + fi);
        const m = materialAt(x, z);
        const g = m.weights[0] + m.weights[1] * 0.6;
        if (r() > g * Math.max(0, (patch - 0.55) * 4) * (fi === 0 ? 0.25 : 0.12) * SEAS[fi] * prof.flowers) continue;
        list.push([x, z, dry(x, z)]);
      }
      const n = list.reduce((k, q) => k + q[2], 0);
      if (!n) return;
      const hm = (f.h[0] + f.h[1]) / 2;
      const im = new THREE.InstancedMesh(flowerGeo(f.petals, hm, f.r / 0.6, 0.9), fMat, n);
      let i = 0;
      list.forEach(([x, z, ok]) => {
        const h = f.h[0] + (f.h[1] - f.h[0]) * r();
        e.set((r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3); qt.setFromEuler(e);
        const c = col.set(f.col[(r() * 2) | 0]).multiplyScalar(0.85 + 0.3 * r());
        if (!ok) return; // in the water: drawn nowhere (its random draws are still taken, so the rest stay put)
        im.setMatrixAt(i, m4.compose(ps.set(x, heightAt(x, z) - 0.01, z), qt, sc.set(0.6, h / hm, 0.6)));
        im.setColorAt(i++, c);
      });
      im.name = 'clutterFlowers_' + f.name; im.receiveShadow = true;
      group.add(im); meshes.push(im);
    });
  }
  // broad-leaf weeds: 3D dock / plantain rosettes (cupped leaves rising 30–60°, a seed spike on some) along verges
  // and in the sward. The desert no longer gets weeds here: its plants are the 3D scrub archetypes (scrub.js).
  if (src === 'temperate') {
    const wMat = windClutter(new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), U, 0.05, 0.25, 'clutterWeedW'); // stiff rosette leaves
    const wDepth = windClutter(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), U, 0.05, 0.25, 'clutterWeedWd');
    const winter = prof.season === 'winter' || prof.season === 'thaw';
    const lists = [[], []];
    for (let i = 0; i < W * D * 0.5 * dens; i++) {
      const x = r() * W, z = r() * D, m = materialAt(x, z);
      if (excl && excl(x, z)) continue;
      const g = (m.weights[0] * 0.5 + m.weights[2] * 0.6 + m.weights[1] * 0.4) * (1 - m.weights[7]); // not on beach sand
      if (r() < g * (winter ? 0.5 : 1)) lists[r() < 0.5 ? 0 : 1].push([x, z, dry(x, z)]);
    }
    lists.forEach((list, v) => {
      const n = list.reduce((k, q) => k + q[2], 0);
      if (!n) return;
      const im = new THREE.InstancedMesh(rosetteGeo(7 + v, v === 1), wMat, n);
      let i = 0;
      list.forEach(([x, z, ok]) => {
        const s = 0.7 + 0.7 * r();
        e.set((r() - 0.5) * 0.15, r() * 6.28, (r() - 0.5) * 0.15); qt.setFromEuler(e);
        const sy = s * (0.8 + 0.4 * r());
        if (winter) col.setRGB(0.09 + 0.05 * r(), 0.075 + 0.03 * r(), 0.035); // frost-browned
        else col.setRGB(0.045 + 0.03 * r(), 0.085 + 0.045 * r(), 0.022 + 0.01 * r());
        if (!ok) return; // in the water (random draws still taken: the other rosettes stay put)
        im.setMatrixAt(i, m4.compose(ps.set(x, heightAt(x, z) - 0.005, z), qt, sc.set(s, sy, s)));
        im.setColorAt(i++, col);
      });
      im.name = 'clutterWeeds'; im.receiveShadow = true; im.castShadow = true; if (U) im.customDepthMaterial = wDepth;
      group.add(im); meshes.push(im);
    });
  }
  return {
    meshes,
    get count() { return meshes.reduce((s, m) => s + m.count, 0); },
    update() {},
    dispose() { for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.dispose?.(); } },
  };
}
