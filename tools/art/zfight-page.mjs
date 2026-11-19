/**
 * Z-fighting detector, the in-game side (loaded into the test page by tools/art/zfight.mjs:
 * `const Z = await import('/tools/art/zfight-page.mjs')`). The pure rules live in zfight-core.mjs.
 *
 *   prepare(game)          hide the units and the transient layers (fx, particles, blood, birds), freeze nothing else
 *   calibrate(game)        measure this GPU's depth noise at the game camera: pairs of quads (different triangles) a
 *                          known distance apart, rendered under depth-only changes; the smallest gap that never flips
 *                          sets the model's safety scale. Also renders a decal flush on a slab with depthWrite:false +
 *                          renderOrder, and with polygonOffset, to show which treatment resolves it
 *   geometric(game, o)     kinds a–d on the built scene (zfight-core)
 *   flicker(game, o)       kind e: a grid of views over the whole map at each zoom; per view the frame is rendered with
 *                          depth-only changes (near, far, the camera slid along its axis: the image cannot move, only
 *                          depth ties re-roll), twice with a sub-pixel / sub-degree jitter (each again with a near
 *                          change), plus a control render; units, particles and fx are hidden, water is masked; the
 *                          pixels that change, minus the control's, minus thin lines, form clusters on static surfaces
 *   snap(game, f, o)       a crop of the game's own frame at a finding (left plain, right with the flicker heat)
 *   sheet(tiles, o)        the contact sheet (JPEG under a byte budget)
 *   characters(game, o)    guest / unit close-ups in a sandbox: posed standing and mid-clip, the same flicker test
 *                          on the character's meshes only, plus kinds a / b on its posed (CPU-skinned) triangles
 * @module tools/art/zfight-page
 */
import * as THREE from 'three';
import * as Z from './zfight-core.mjs';

const ST = (window.__zfight ||= {});
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ scene preparation

/** Top-level scene groups that move or are effects: hidden while scanning. */
const TRANSIENT = /^(fx|vfx|windParticles|snowfall|blood|blast-marks|ambientLife|flyovers|duckWakes|rain|noise-rings|selection|kit-batch)/i;

/** Hide units, effects and particles (they are not static geometry). @returns {{roots:Set, restore:()=>void}} */
export function prepare(game, o = {}) {
  const scene = game.renderer.scene, w = game.world, hidden = [];
  const hide = (obj) => { if (obj && obj.visible) { obj.visible = false; hidden.push(obj); } };
  const roots = new Set();
  for (const e of w?.entities || []) {
    if (!e.object3d) continue;
    let skinned = false;
    e.object3d.traverse((c) => { if (c.isSkinnedMesh) skinned = true; });
    if (e.kind === 'commando' || e.kind === 'enemy' || skinned) { if (!o.keep?.has(e)) { hide(e.object3d); roots.add(e.object3d); } }
  }
  scene.traverse((obj) => {
    if (obj.isPoints || obj.isSprite || obj.isLine) { hide(obj); return; }
    if (obj.parent === scene && TRANSIENT.test(obj.name || '')) hide(obj);
    if (/^snowfall$|^real:/.test(obj.name || '') && !o.keep?.has(obj)) hide(obj);
  });
  ST.hidden = hidden; ST.roots = roots;
  return { roots, restore: () => { for (const h of hidden) h.visible = true; } };
}

/** The game camera's depth setup: near/far, the composer's depth format. */
function cameraFacts(game) {
  const cc = game.cameraController, cam = cc.camera;
  const comp = game.renderer.composer, rt = comp?.renderTarget1 || comp?.readBuffer;
  const dtx = rt?.depthTexture;
  const depthFormat = dtx ? (dtx.type === THREE.FloatType ? 'd32f' : dtx.type === THREE.UnsignedShortType && dtx.format !== THREE.DepthStencilFormat ? 'd16' : 'd24') : 'd24';
  const vpW = cc.width || 1280, vpH = cc.height || 800;
  const L = cc.cfg.zoomLevels;
  return {
    near: cam.near, far: cam.far, distance: cc.distance, depthFormat, pitch: cc.cfg.pitchDeg ?? 40, yaw: cc.cfg.yawDeg ?? 15,
    ppm1: cc.cfg.pxPerMeterAt1x ?? 40, zooms: L, defaultZoom: cc.cfg.defaultZoom ?? 1, closest: L[L.length - 1], farthest: L[0], vpW, vpH,
    dpr: game.renderer.renderer.getPixelRatio?.() ?? 1,
  };
}

/** The depth model for this page's camera (see zfight-core depthModel). */
export function modelFor(game, o = {}) {
  const F = cameraFacts(game);
  const zooms = o.zooms || [F.defaultZoom, F.closest];
  const hh = F.vpH / 2 / (F.ppm1 * F.farthest); // half the view height (m) at the farthest zoom
  const zMax = F.distance + hh / Math.tan((F.pitch * Math.PI) / 180) + 40; // deepest drawn point: target ± the view's ground depth, + 40 m of height
  const yaws = o.yaws || [...new Set([F.yaw, 0, 45, 90, 135, 180, 225, 270, 315])];
  return { F, model: Z.depthModel({ near: F.near, far: F.far, depthFormat: F.depthFormat, zMax, pxPerMeterAt1x: F.ppm1, dpr: 1, zooms, yaws, pitchDeg: F.pitch, safety: o.safety ?? ST.safety ?? 1 }) };
}

// ------------------------------------------------------------------ geometric kinds a–d

/**
 * Kinds a–d on the current scene. @param {{zooms?, yaws?, minPx?, safety?, only?:string}} [o]
 * @returns {{findings, stats, model}}
 */
export function geometric(game, o = {}) {
  const t0 = performance.now();
  const scene = game.renderer.scene, cam = game.cameraController.camera;
  const { model } = modelFor(game, o);
  const recs = Z.collectSurfaces(scene, { camera: cam, skip: ST.roots });
  const surf = recs.filter((r) => r.cls === 'surface'), terr = recs.filter((r) => r.cls === 'terrain');
  const T = Z.gatherTriangles(surf);
  const t1 = performance.now();
  const B = Z.buildBVH(T);
  const TT = terr.length ? Z.gatherTriangles(terr) : null;
  const TB = TT && TT.n ? Z.buildBVH(TT) : null;
  const t2 = performance.now();
  const vis = Z.makeVisibility(B, T, TB, model);
  const H = TB ? Z.terrainHeight(TB) : null;
  const only = o.only ? new Set(o.only.split(',')) : null;
  const minPx = o.minPx ?? 6;
  let ab = [], c = [];
  let tests = 0;
  if (!only || only.has('a') || only.has('b') || only.has('d')) {
    const raw = Z.coplanarScan(T, B, model, { minPx: 0.05, pad: o.pad ?? 0.004 });
    tests = raw.tests;
    ab = Z.coplanarFindings(T, raw, model, vis);
    if (H) for (const f of ab) { if (f.kind !== 'a') continue; const h = H(f.point.x, f.point.z); if (h != null && Math.abs(f.point.y - h) < 0.12) f.kind = 'd'; }
  }
  const t3 = performance.now();
  let samples = 0;
  if (H && (!only || only.has('c'))) {
    const terrMat = TT.mats[0];
    const s = Z.terrainScan(T, H, terrMat, model, {});
    samples = s.length;
    c = Z.terrainFindings(T, s, model, vis);
  }
  const t4 = performance.now();
  let findings = [...ab, ...c].filter((f) => (!only || only.has(f.kind)));
  const dropped = { hidden: findings.filter((f) => !f.visible).length, small: findings.filter((f) => f.visible && f.px < minPx).length };
  findings = findings.filter((f) => f.visible && f.px >= minPx);
  for (const f of findings) f.severity = Z.severityOf(f);
  ST.geo = { recs, T, B, TT, TB, H, model };
  const cats = {};
  for (const r of recs) cats[r.cls] = (cats[r.cls] || 0) + 1;
  return {
    findings,
    model: model.describe(),
    stats: { surfaces: surf.length, records: recs.length, categories: cats, triangles: T.n, terrainTriangles: TT?.n ?? 0, pairTests: tests, terrainSamples: samples, dropped,
      ms: { collect: Math.round(t1 - t0), bvh: Math.round(t2 - t1), coplanar: Math.round(t3 - t2), terrain: Math.round(t4 - t3) } },
  };
}

// ------------------------------------------------------------------ rendering helpers

let RT = null;
/** Render targets matching the composer's depth (24-bit depth + stencil texture). */
function targets(w, h) {
  if (RT && RT.w === w && RT.h === h) return RT;
  if (RT) { RT.color.dispose(); RT.id.dispose(); }
  const mk = (type) => {
    const t = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: true, stencilBuffer: true, samples: 0, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    t.depthTexture = new THREE.DepthTexture(w, h);
    t.depthTexture.format = THREE.DepthStencilFormat;
    t.depthTexture.type = THREE.UnsignedIntType;
    return t;
  };
  RT = { w, h, color: mk(THREE.HalfFloatType), id: mk(THREE.UnsignedByteType), u16: new Uint16Array(w * h * 4), u8: new Uint8Array(w * h * 4) };
  return RT;
}

/** ID materials: one flat colour per drawn mesh (0 = masked: water, hidden), same depth state as its own material. */
function idSetup(scene, roots, opts = {}) {
  const meshes = [], info = [null];
  const keepOnly = opts.only || null; // character mode: only these meshes get an id
  const visit = (o, path) => {
    if (!o.visible || roots?.has(o)) return;
    const p = path ? `${path}/${o.name || '(-)'}` : o.name || '(-)';
    if ((o.isMesh || o.isSkinnedMesh) && !o.isPoints && !o.isLine && o.geometry?.attributes?.position) {
      const cls = Z.classifyMesh(o, p);
      const masked = cls === 'water' || cls === 'skip' || (cls === 'natural' && !opts.natural) || (keepOnly && !keepOnly.has(o));
      const id = masked ? 0 : info.length;
      if (!masked) { const nm = Z.namesOf(p); info.push({ path: p, name: o.name, item: nm.item, part: nm.part, cls, mats: (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name || m?.type) }); }
      meshes.push({ o, id, orig: o.material });
    }
    for (const c of o.children) visit(c, p);
  };
  for (const c of scene.children) visit(c, '');
  const cache = new Map();
  const idMat = (m, id) => {
    const k = `${id}|${m.uuid}`;
    let x = cache.get(k);
    if (!x) {
      x = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(((id >> 16) & 255) / 255, ((id >> 8) & 255) / 255, (id & 255) / 255, THREE.LinearSRGBColorSpace),
        side: m.side, transparent: m.transparent, depthWrite: m.depthWrite, depthTest: m.depthTest, depthFunc: m.depthFunc,
        polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits,
        blending: THREE.NoBlending, fog: false, toneMapped: false, colorWrite: m.colorWrite, visible: m.visible });
      if ((m.alphaTest ?? 0) > 0 && m.map) { x.map = m.map; x.alphaTest = m.alphaTest; x.color.setRGB(1, 1, 1); x.userData.idTex = true; }
      cache.set(k, x);
    }
    return x;
  };
  for (const e of meshes) {
    const arr = Array.isArray(e.orig) ? e.orig : [e.orig];
    const ids = arr.map((m) => (m ? idMat(m, e.id) : m));
    e.idm = Array.isArray(e.orig) ? ids : ids[0];
  }
  return {
    info, meshes,
    on() { for (const e of meshes) e.o.material = e.idm; },
    off() { for (const e of meshes) e.o.material = e.orig; },
    dispose() { for (const m of cache.values()) m.dispose(); },
  };
}

/** Render `scene` with `cam` into the colour target and read it as perceptual RGB bytes (top-down). */
function renderColor(R, scene, cam, out) {
  const r = R.renderer;
  r.setRenderTarget(R.T.color);
  r.setClearColor(0x000000, 1);
  r.clear(true, true, true);
  r.render(scene, cam);
  r.readRenderTargetPixels(R.T.color, 0, 0, R.T.w, R.T.h, R.T.u16);
  return Z.toPerceptual(R.T.u16, R.T.w, R.T.h, out);
}

/** Render the id pass: Uint32 id per pixel (top-down). */
function renderIds(R, scene, cam, ids, out) {
  const r = R.renderer;
  const bg = scene.background, env = scene.environment, fog = scene.fog;
  scene.background = null; scene.fog = null;
  ids.on();
  try {
    r.setRenderTarget(R.T.id);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, cam);
    r.readRenderTargetPixels(R.T.id, 0, 0, R.T.w, R.T.h, R.T.u8);
  } finally { ids.off(); scene.background = bg; scene.environment = env; scene.fog = fog; }
  const { w, h, u8 } = R.T;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w;
    for (let x = 0; x < w; x++) { const s = src + x * 4; out[dst + x] = (u8[s] << 16) | (u8[s + 1] << 8) | u8[s + 2]; }
  }
  return out;
}

/** A camera variant: depth-only (near / far / slide) and/or a jitter (sub-pixel shift, sub-degree yaw about the view centre). */
function variant(base, v, target) {
  const c = base.clone();
  if (v.yaw) {
    const p = c.position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (v.yaw * Math.PI) / 180);
    c.position.copy(target).add(p);
    c.lookAt(target);
  }
  if (v.dx || v.dy) {
    const mpp = (c.right - c.left) / c.zoom / v.w;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    c.position.addScaledVector(right, (v.dx || 0) * mpp).addScaledVector(up, (v.dy || 0) * mpp);
  }
  if (v.slide) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(c.quaternion);
    c.position.addScaledVector(back, v.slide);
    c.near += v.slide; c.far += v.slide;
  }
  if (v.near) c.near = v.near;
  if (v.far) c.far = v.far;
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  return c;
}

/** Save / restore the renderer state around our renders. */
function renderSession(game) {
  const r = game.renderer.renderer, scene = game.renderer.scene;
  const saved = { rt: r.getRenderTarget(), autoClear: r.autoClear, cc: r.getClearColor(new THREE.Color()), ca: r.getClearAlpha(), smAuto: r.shadowMap.autoUpdate, mwa: scene.matrixWorldAutoUpdate };
  return {
    renderer: r, scene,
    freeze() { scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false; r.autoClear = false; },
    shadowsOnce() { r.shadowMap.autoUpdate = false; },
    shadowsLive() { r.shadowMap.autoUpdate = true; r.shadowMap.needsUpdate = true; },
    restore() { r.setRenderTarget(saved.rt); r.autoClear = saved.autoClear; r.setClearColor(saved.cc, saved.ca); r.shadowMap.autoUpdate = saved.smAuto; scene.matrixWorldAutoUpdate = saved.mwa; },
  };
}

// ------------------------------------------------------------------ one view: the flicker test

const VARIANTS_DEPTH = [{ near: 1.29 }, { far: 741 }, { slide: 0.043 }];

/**
 * The flicker test at the camera `cam0` (a clone of the game camera at a view). Returns the hit mask (static pixels that
 * change under depth-only changes or unexplained by a sub-pixel jitter), the masks of what was excluded, the base image
 * and the two id frames. @param {{T:number, jitter?:boolean, ids:object}} o
 */
function flickerView(R, cam0, target, o) {
  const { w, h } = R.T, N = w * h;
  const scene = R.scene;
  const bufs = ST.bufs && ST.bufs.N === N ? ST.bufs : (ST.bufs = { N, base: new Uint8Array(N * 3), tmp: new Uint8Array(N * 3), jit: new Uint8Array(N * 3), id0: new Uint32Array(N), id1: new Uint32Array(N), hit: new Uint8Array(N), ctrl: new Uint8Array(N), src: new Uint8Array(N) });
  const { base, tmp, jit, id0, id1, hit, ctrl, src } = bufs;
  hit.fill(0); ctrl.fill(0); src.fill(0);
  const T = o.T ?? 9; // 0..255 perceptual: ~3.5 %
  const nearV = (c) => ({ near: c.near * 1.29 });
  R.shadowsLive();
  renderColor(R, scene, cam0, base);
  R.shadowsOnce();
  // control: the very same render again (anything that changes is not deterministic: masked)
  renderColor(R, scene, cam0, tmp);
  Z.diffInto(base, tmp, 2, ctrl);
  const stats = { ctrl: 0, depth: 0, jitter: 0, unexplained: 0 };
  for (let i = 0; i < N; i++) stats.ctrl += ctrl[i];
  // depth-only variants at the base pose
  for (const v of [{ near: cam0.near * 1.29 }, { far: cam0.far * 1.0587 }, { slide: 0.043 }]) {
    renderColor(R, scene, variant(cam0, { ...v, w }, target), tmp);
    const before = countSet(hit);
    Z.diffInto(base, tmp, T, hit);
    stats.depth += countSet(hit) - before;
  }
  for (let i = 0; i < N; i++) if (hit[i]) src[i] |= 1;
  // jitter poses: sub-pixel shift, sub-degree yaw; each with a near change too (depth ties re-sampled at other pixel
  // centres: bit 2), and the jittered frame against the base where no sub-pixel move explains the change (bit 4: only
  // a hint — alpha-tested foliage and wires change that way too; it counts as evidence with o.jitterEvidence)
  if (o.jitter !== false) {
    const un = new Uint8Array(N), jd = new Uint8Array(N);
    for (const j of [{ dx: 0.37, dy: 0.29 }, { yaw: 0.04 }]) {
      const cj = variant(cam0, { ...j, w }, target);
      renderColor(R, scene, cj, jit);
      stats.unexplained += Z.unexplainedInto(base, jit, w, h, T, un);
      renderColor(R, scene, variant(cj, { ...nearV(cj), w }, target), tmp);
      stats.jitter += Z.diffInto(jit, tmp, T, jd);
    }
    for (let i = 0; i < N; i++) {
      if (jd[i]) { hit[i] = 1; src[i] |= 2; }
      if (un[i]) { src[i] |= 4; if (o.jitterEvidence) hit[i] = 1; }
    }
  }
  // ids: base and near-changed (who wins where it flips)
  renderIds(R, scene, cam0, o.ids, id0);
  renderIds(R, scene, variant(cam0, { near: cam0.near * 1.29, w }, target), o.ids, id1);
  // exclusions: masked ids (water, hidden, background), the control's changes; dilated
  const ex = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (id0[i] === 0 || ctrl[i]) ex[i] = 1;
  const exD = Z.dilate(ex, w, h, o.maskGrow ?? 3);
  let kept = 0;
  for (let i = 0; i < N; i++) { if (exD[i]) hit[i] = 0; else kept += hit[i]; }
  stats.kept = kept;
  return { hit, base, id0, id1, src, stats, ex: exD };
}

function countSet(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }

/** Clusters of a view's hits → finding candidates with ids, world point (ray through the cluster centre), crops. */
function viewClusters(R, cam, fv, o) {
  const { w, h } = R.T;
  const cl = Z.flickerClusters(fv.hit, w, h, { r: o.densR ?? 3, min: o.densMin ?? 10, grow: 2, minN: o.minHits ?? 12 });
  const out = [];
  for (const c of cl.slice(0, o.maxPerView ?? 12)) {
    // ids: where the winner changed under the near change; else the ids under the hits
    const pairs = new Map(), under = new Map();
    let src = 0;
    for (const i of c.pixels) {
      if (!fv.hit[i]) continue;
      src |= fv.src[i];
      const a = fv.id0[i], b = fv.id1[i];
      under.set(a, (under.get(a) || 0) + 1);
      if (a !== b && a && b) { const k = a < b ? `${a}|${b}` : `${b}|${a}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
    }
    const top = [...pairs.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3);
    const unders = [...under.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3);
    const wp = worldAt(cam, (c.cx + 0.5) / w, (c.cy + 0.5) / h);
    let unexpl = 0;
    for (const i of c.pixels) if (fv.src[i] & 4) unexpl++;
    out.push({ hits: c.hits, n: c.n, box: [c.x0, c.y0, c.x1, c.y1], cx: c.cx, cy: c.cy, src, unexplained: unexpl, pairs: top, under: unders, point: wp });
  }
  return out;
}

/** World point under screen point (u, v in 0..1, v down) on the scanned geometry (surfaces + terrain BVHs). */
function worldAt(cam, u, v) {
  const g = ST.geo;
  const ndc = new THREE.Vector3(u * 2 - 1, 1 - v * 2, -1).unproject(cam);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const ray = new THREE.Ray(ndc, dir);
  let best = null;
  for (const B of [g?.B, g?.TB]) {
    if (!B) continue;
    const hit = B.bvh.raycastFirst(ray, THREE.DoubleSide, 0, cam.far);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) { const t = -ndc.y / dir.y; return t > 0 ? [r3(ndc.x + dir.x * t), 0, r3(ndc.z + dir.z * t)] : null; }
  return [r3(best.point.x), r3(best.point.y), r3(best.point.z)];
}

/** Put the game's view at (x, z), zoom, yaw and draw one real frame (LOD, shadow fit, terrain); returns a clone of its camera and target. */
function gameView(game, x, z, zoom, yaw) {
  const cc = game.cameraController, rig = game.cameraRig;
  if (yaw != null && Math.abs((cc.yawDeg ?? cc.cfg.yawDeg) - yaw) > 1e-6) { if (rig?.setYaw) rig.setYaw(yaw); else cc.setYaw(yaw); }
  cc.setZoom(zoom, true);
  cc.centerOn(x, z);
  game.render(0, 1);
  return { cam: cc.camera.clone(), target: cc.target.clone() };
}

/** View targets covering the map at a zoom and yaw (screen-aligned grid, 10 % overlap). */
export function viewGrid(game, zoom, yaw) {
  const F = cameraFacts(game);
  const [W, D] = game.missionDef?.size || [100, 100];
  const a = (yaw * Math.PI) / 180, pitch = (F.pitch * Math.PI) / 180;
  const ppm = F.ppm1 * zoom;
  const fw = F.vpW / ppm, fd = F.vpH / ppm / Math.sin(pitch);
  const r = [Math.cos(a), -Math.sin(a)], u = [-Math.sin(a), -Math.cos(a)];
  const corners = [[0, 0], [W, 0], [0, D], [W, D]];
  const pr = corners.map(([x, z]) => x * r[0] + z * r[1]), pu = corners.map(([x, z]) => x * u[0] + z * u[1]);
  const out = [];
  const sx = fw * 0.9, sz = fd * 0.9;
  for (let i = Math.min(...pr) + sx / 2; i < Math.max(...pr) + sx / 2; i += sx) {
    for (let j = Math.min(...pu) + sz / 2; j < Math.max(...pu) + sz / 2; j += sz) {
      const x = i * r[0] + j * u[0], z = i * r[1] + j * u[1];
      // keep views whose centre is within half a footprint of the map
      if (x < -fw / 2 || z < -fd / 2 || x > W + fw / 2 || z > D + fd / 2) continue;
      out.push([x, z]);
    }
  }
  return out;
}

/**
 * Kind e over the whole map. @param {{zooms?:number[], yaw?:number, maxViews?:number, T?:number, onView?:Function}} [o]
 * @returns {{clusters:object[], views:object[], stats}}
 */
export function flicker(game, o = {}) {
  const F = cameraFacts(game);
  const zooms = o.zooms || [F.defaultZoom, F.closest];
  const yaw = o.yaw ?? F.yaw;
  const R = renderSession(game);
  R.T = targets(F.vpW, F.vpH);
  const ids = idSetup(R.scene, ST.roots);
  const views = [], clusters = [];
  const t0 = performance.now();
  try {
    for (const zoom of zooms) {
      const seen = new Set();
      for (const [x, z] of viewGrid(game, zoom, yaw)) {
        if (o.maxViews && views.length >= o.maxViews) break;
        const { cam, target } = gameView(game, x, z, zoom, yaw);
        const key = `${zoom}|${target.x.toFixed(1)}|${target.z.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        R.freeze();
        let fv;
        try { fv = flickerView(R, cam, target, { ids, T: o.T, jitter: o.jitter, jitterEvidence: o.jitterEvidence }); } finally { R.restore(); }
        const cl = viewClusters(R, cam, fv, o);
        const vi = views.length;
        views.push({ zoom, yaw, target: [r3(target.x), r3(target.z)], stats: fv.stats, clusters: cl.length });
        for (const c of cl) {
          c.view = vi; c.zoom = zoom; c.yaw = yaw; c.target = [target.x, target.z];
          c.crop = cropImages(fv, c, R.T, o);
          clusters.push(c);
        }
      }
    }
  } finally { R.restore(); ids.dispose(); }
  // name the ids
  for (const c of clusters) {
    c.pairs = c.pairs.map(([k, n]) => ({ a: ids.info[+k.split('|')[0]], b: ids.info[+k.split('|')[1]], px: n }));
    c.under = c.under.map(([k, n]) => ({ m: ids.info[k] || null, px: n }));
  }
  return { clusters, views, stats: { views: views.length, ms: Math.round(performance.now() - t0) } };
}

/** Crop images of a cluster: base (perceptual) and heat, ×2, PNG data URLs side by side. */
function cropImages(fv, c, T, o = {}) {
  const { w, h } = T;
  const cw = o.cropW ?? 220, ch = o.cropH ?? 140;
  const x0 = Math.max(0, Math.min(w - cw, Math.round(c.cx - cw / 2))), y0 = Math.max(0, Math.min(h - ch, Math.round(c.cy - ch / 2)));
  const S = o.scale ?? 2;
  const cv = document.createElement('canvas');
  cv.width = cw * S * 2 + 4; cv.height = ch * S;
  const g = cv.getContext('2d');
  const img = g.createImageData(cw * S * 2 + 4, ch * S);
  const put = (X, Y, r, gg, b) => { const k = (Y * img.width + X) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255; };
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * w + x0 + x, p = i * 3;
      // the perceptual buffer is √(Reinhard): show it squared back towards display brightness
      const R0 = fv.base[p], G0 = fv.base[p + 1], B0 = fv.base[p + 2];
      const lum = (R0 + G0 + B0) / 3;
      const hot = fv.hit[i], exd = fv.ex[i];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        put(x * S + sx, y * S + sy, R0, G0, B0);
        const X = cw * S + 4 + x * S + sx, Y = y * S + sy;
        if (hot) put(X, Y, 255, 40, 20); else if (exd) put(X, Y, lum * 0.3, lum * 0.3, lum * 0.6 + 40); else put(X, Y, lum * 0.55, lum * 0.55, lum * 0.55);
      }
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#ffd400'; g.lineWidth = 1;
  g.strokeRect((c.box[0] - x0) * S - 2, (c.box[1] - y0) * S - 2, (c.box[2] - c.box[0] + 1) * S + 4, (c.box[3] - c.box[1] + 1) * S + 4);
  return cv.toDataURL('image/png');
}

// ------------------------------------------------------------------ confirmation + crops of the real frame at a finding

/** Zoom for a finding's close look: 4 for a spot under 3 m, 2 under 8 m, else 1. */
const zoomFor = (f) => {
  const size = f.box ? Math.max(f.box.max[0] - f.box.min[0], f.box.max[2] - f.box.min[2], 0.2) : 1;
  return size < 3 ? 4 : size < 8 ? 2 : 1;
};

/** Put the game view on a finding (aim at the ground point under it ALONG the view) and run the flicker test there. */
function lookAt(game, f, zoom, yaw, ids) {
  const F = cameraFacts(game);
  const a = (yaw * Math.PI) / 180, e = (F.pitch * Math.PI) / 180, d = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const k = f.point.y / d[1];
  const { cam, target } = gameView(game, f.point.x - d[0] * k, f.point.z - d[2] * k, zoom, yaw);
  const R = renderSession(game);
  R.T = targets(F.vpW, F.vpH);
  let fv;
  R.freeze();
  try { fv = flickerView(R, cam, target, { ids, T: 9 }); } finally { R.restore(); }
  return { cam, target, fv, R };
}

/** Screen points (px) of a finding's sample points in `cam` (null when off the view). */
function project(cam, pts, w, h) {
  return pts.map((p) => {
    const q = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
    const x = ((q.x + 1) / 2) * w, y = ((1 - q.y) / 2) * h;
    return x >= 0 && y >= 0 && x < w && y < h && q.z > -1 && q.z < 1 ? [x, y] : null;
  });
}

/** Flicker hits within r px of the projected points; ids flipping there. */
function nearHits(fv, sp, w, h, r = 8, own = null) {
  let n = 0, mine = 0;
  const seen = new Uint8Array(w * h), pairs = new Map();
  for (const p of sp) {
    if (!p) continue;
    for (let y = Math.max(0, Math.round(p[1] - r)); y <= Math.min(h - 1, Math.round(p[1] + r)); y++) {
      for (let x = Math.max(0, Math.round(p[0] - r)); x <= Math.min(w - 1, Math.round(p[0] + r)); x++) {
        const i = y * w + x;
        if (seen[i] || !fv.hit[i]) continue;
        seen[i] = 1; n++;
        const a = fv.id0[i], b = fv.id1[i];
        if (own && (own.has(a) || own.has(b))) mine++;
        if (a !== b && a && b) { const k = a < b ? `${a}|${b}` : `${b}|${a}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
      }
    }
  }
  return { n, mine, pairs };
}

/** The id-pass ids of a finding's two meshes (by scene path; an instance shares its mesh's id). */
function ownIds(ids, f) {
  const want = new Set([f.a?.id, f.b?.id].filter(Boolean).map((x) => String(x).replace(/#\d+$/, '')));
  const out = new Set();
  ids.info.forEach((m, i) => { if (m && (want.has(m.path) || (f.kind === 'c' && m.cls === 'terrain'))) out.add(i); });
  return out;
}

/**
 * Empirical confirmation of a geometric finding at its own spot: the flicker test at its best yaws (up to `maxYaws`, the
 * default camera yaw first) at a close zoom, counting the flicker hits within 8 px of its sample points. Also tells
 * whether the player can get it on screen at all (the camera clamp keeps the view within a few metres of the map).
 * @returns {{status:'confirmed'|'unseen'|'offscreen', near:number, yaw:number|null, zoom:number, tried:number[], pairs:object[]}}
 */
export function confirm(game, f, o = {}) {
  const F = cameraFacts(game);
  const zoom = o.zoom ?? zoomFor(f);
  const ys = (f.yaws?.length ? f.yaws : [F.yaw]).slice();
  ys.sort((p, q) => (p === F.yaw ? -1 : q === F.yaw ? 1 : 0));
  const pts = f.pts?.length ? f.pts : [[f.point.x, f.point.y, f.point.z]];
  const ids = o.ids || idSetup(game.renderer.scene, ST.roots);
  const tried = [];
  const own = ownIds(ids, f);
  let best = null, onScreen = false;
  try {
    for (const yaw of ys.slice(0, o.maxYaws ?? 3)) {
      const { cam, fv, R } = lookAt(game, f, zoom, yaw, ids);
      const sp = project(cam, pts, R.T.w, R.T.h);
      tried.push(yaw);
      if (!sp.some(Boolean)) continue;
      onScreen = true;
      // the hits must be the finding's own meshes changing (not a neighbour's seam inside the radius)
      const nh = nearHits(fv, sp, R.T.w, R.T.h, o.r ?? 8, own);
      if (!best || nh.mine > best.mine) best = { ...nh, yaw };
      if (nh.mine >= (o.min ?? 6)) break;
    }
  } finally { if (!o.ids) ids.dispose(); }
  const pairs = best ? [...best.pairs.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, n]) => ({ a: ids.info[+k.split('|')[0]]?.path, b: ids.info[+k.split('|')[1]]?.path, px: n })) : [];
  return { status: !onScreen ? 'offscreen' : best && best.mine >= (o.min ?? 6) ? 'confirmed' : 'unseen', near: best?.mine ?? 0, nearAll: best?.n ?? 0, yaw: best?.yaw ?? null, zoom, tried, pairs };
}

/** confirm() for many findings with one id setup. @returns {object[]} one result per finding (null past `cap`) */
export function confirmAll(game, fs, o = {}) {
  const ids = idSetup(game.renderer.scene, ST.roots);
  try { return fs.map((f, i) => (i < (o.cap ?? 400) ? confirm(game, f, { ...o, ids }) : null)); } finally { ids.dispose(); }
}

/**
 * A crop of the game's own frame at a finding: left the plain frame, right the same with the flicker hits in red and the
 * spot's sample points ringed. @returns {{url:string, hits:number, near:number, yaw:number, zoom:number}}
 */
export function snap(game, f, o = {}) {
  const F = cameraFacts(game);
  const cc = game.cameraController;
  const zoom = o.zoom ?? f.confirm?.zoom ?? zoomFor(f);
  const yaw = o.yaw ?? f.confirm?.yaw ?? (f.yaws?.length ? (f.yaws.includes(F.yaw) ? F.yaw : f.yaws[0]) : f.yaw ?? F.yaw);
  const ids = idSetup(game.renderer.scene, ST.roots);
  let fv, cam, R;
  try { ({ fv, cam, R } = lookAt(game, f, zoom, yaw, ids)); } finally { ids.dispose(); }
  // the game's own frame (lookAt drew it last: re-draw it, our renders used the canvas' GL state)
  game.render(0, 1);
  const src = game.renderer.renderer.domElement, kk = src.width / (src.clientWidth || src.width);
  const W = o.w ?? 420, H = o.h ?? 270;
  // centre on the sample point with the most flicker around it (a big finding's points can lie far apart), else the point
  const pts0 = f.pts?.length ? f.pts : [[f.point.x, f.point.y, f.point.z]];
  const sp0 = project(cam, pts0, R.T.w, R.T.h);
  let bestP = [f.point.x, f.point.y, f.point.z], bestN = -1;
  sp0.forEach((p, i) => { if (!p) return; const n = nearHits(fv, [p], R.T.w, R.T.h, 8).n; if (n > bestN) { bestN = n; bestP = pts0[i]; } });
  const q = new THREE.Vector3(bestP[0], bestP[1], bestP[2]).project(cc.camera);
  const sx = ((q.x + 1) / 2) * src.width, sy = ((1 - q.y) / 2) * src.height;
  const x0 = Math.max(0, Math.min(src.width - W * kk, sx - (W * kk) / 2)), y0 = Math.max(0, Math.min(src.height - H * kk, sy - (H * kk) / 2));
  const frame = document.createElement('canvas');
  frame.width = W; frame.height = H;
  frame.getContext('2d').drawImage(src, x0, y0, W * kk, H * kk, 0, 0, W, H);
  const vx0 = Math.round(x0 / kk), vy0 = Math.round(y0 / kk);
  let hits = 0;
  const out = document.createElement('canvas');
  out.width = W * 2 + 6; out.height = H + 22;
  const g = out.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(frame, 0, 0);
  g.drawImage(frame, W + 6, 0);
  const img = g.getImageData(W + 6, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = vx0 + x, Y = vy0 + y;
    if (X < 0 || Y < 0 || X >= R.T.w || Y >= R.T.h) continue;
    if (fv.hit[Y * R.T.w + X]) { hits++; const p = (y * W + x) * 4; img.data[p] = 255; img.data[p + 1] = 30; img.data[p + 2] = 20; }
  }
  g.putImageData(img, W + 6, 0);
  const sp = project(cam, f.pts?.length ? f.pts : [[f.point.x, f.point.y, f.point.z]], R.T.w, R.T.h);
  const near = nearHits(fv, sp, R.T.w, R.T.h, 8).n;
  g.strokeStyle = '#ffd400'; g.lineWidth = 1.5;
  for (const p of sp) if (p) { g.beginPath(); g.arc(W + 6 + p[0] - vx0, p[1] - vy0, 9, 0, Math.PI * 2); g.stroke(); }
  g.font = '12px sans-serif'; g.fillStyle = '#eee';
  g.fillText(`${o.label ?? ''} ${f.kind}: ${f.a?.item ?? '?'} ${f.a?.mat ?? ''} × ${f.b?.item ?? '?'} ${f.b?.mat ?? ''} (${f.point.x}, ${f.point.y}, ${f.point.z}) yaw ${yaw}° zoom ${zoom} — flicker ${near} px at the spot, ${hits} in view`.slice(0, 160), 6, H + 15);
  return { url: out.toDataURL('image/png'), hits, near, yaw, zoom };
}

/** The contact sheet: tiles (data URLs + captions) in a grid, JPEG under `maxBytes`. */
export async function sheet(tiles, o = {}) {
  const cols = o.cols ?? 3, tw = o.tileW ?? 560;
  const imgs = await Promise.all(tiles.map((t) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = t.url; })));
  // (tile height from the crops' own aspect: no dead space)
  const asp = imgs.filter(Boolean).map((im) => im.height / im.width);
  const th = Math.round(tw * (asp.length ? Math.max(...asp) : o.aspect ?? 0.6));
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const head = 34;
  const cv = document.createElement('canvas');
  cv.width = cols * tw; cv.height = head + rows * (th + 18);
  const g = cv.getContext('2d');
  g.fillStyle = '#161616'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif';
  g.fillText(o.title ?? 'z-fighting', 8, 22);
  tiles.forEach((t, i) => {
    const im = imgs[i];
    const x = (i % cols) * tw, y = head + Math.floor(i / cols) * (th + 18);
    if (im) { const s = Math.min(tw / im.width, th / im.height); g.drawImage(im, x, y, im.width * s, im.height * s); }
    g.fillStyle = t.color ?? '#ddd'; g.font = '11px sans-serif';
    g.fillText(String(t.caption ?? '').slice(0, 96), x + 4, y + th + 13);
  });
  let q = 0.85, url = cv.toDataURL('image/jpeg', q);
  while (url.length * 0.75 > (o.maxBytes ?? 1.9e6) && q > 0.3) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
  if (url.length * 0.75 > (o.maxBytes ?? 1.9e6)) { // still too big: halve the size
    const c2 = document.createElement('canvas'); c2.width = cv.width / 2; c2.height = cv.height / 2;
    c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height);
    url = c2.toDataURL('image/jpeg', 0.8);
  }
  return url;
}

// ------------------------------------------------------------------ calibration on this GPU

/**
 * Measure the depth noise of this GPU at the game camera: rows of quad pairs (3×3 and 4×4 grids, the second turned 7°:
 * no shared vertex) a known vertical gap apart, horizontal (the ground) and vertical (a wall facing the camera), placed
 * at the map's far corner (largest coordinates), rendered under the depth-only changes at each zoom. The largest gap
 * that still flips is the measured noise; safety = measured / model (≥ 1). Also renders a decal flush on a slab with
 * depthWrite:false + renderOrder 1 (no offset) and with polygonOffset −1/−2: the share of its pixels lost to the slab.
 */
export function calibrate(game, o = {}) {
  const F = cameraFacts(game);
  const { model } = modelFor(game, { safety: 1 });
  const [W, D] = game.missionDef?.size || [100, 100];
  const gaps = o.gaps || [0, 0.00002, 0.00005, 0.0001, 0.00015, 0.0002, 0.0003, 0.0005, 0.0008, 0.0012, 0.002, 0.003];
  const R = renderSession(game);
  R.T = targets(F.vpW, F.vpH);
  const out = { gaps, zooms: [] };
  const sc = new THREE.Scene();
  const mk = (seg, color, rot) => {
    const g = new THREE.PlaneGeometry(1, 1, seg, seg).rotateX(-Math.PI / 2).rotateY(rot);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false }));
  };
  const cx = W - 6, cz = D - 6, cy = 30;
  const rows = [];
  gaps.forEach((gp, i) => {
    const x = cx + (i - gaps.length / 2) * 1.1;
    const a = mk(3, 0xff0000, 0), b = mk(4, 0x00ff00, 0.122);
    a.position.set(x, cy, cz); b.position.set(x, cy + gp, cz);
    b.scale.setScalar(0.8);
    sc.add(a, b);
    rows.push({ gap: gp, x, y: cy, z: cz });
  });
  // decal tests: a slab with a draped decal (different triangles), dw:false + ro 1, and the same with polygonOffset
  const slab = (dx, mat) => {
    const s = mk(5, 0x0000ff, 0); s.position.set(cx + dx, cy, cz + 2.4); sc.add(s);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.4, 17).rotateX(-Math.PI / 2), mat); d.position.set(cx + dx, cy, cz + 2.4); d.renderOrder = 1; sc.add(d);
    return d;
  };
  slab(-1.5, new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, depthWrite: false, fog: false }));
  slab(0, new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, fog: false }));
  slab(1.5, new THREE.MeshBasicMaterial({ color: 0xffff00, fog: false }));
  sc.updateMatrixWorld(true);
  const r = R.renderer;
  try {
    for (const zoom of model.zooms.map((z) => z.zoom)) {
      const cam = game.cameraController.camera.clone();
      const target = new THREE.Vector3(cx, cy, cz + 1);
      const f = Z.cameraFrame(F.yaw, F.pitch);
      cam.position.set(target.x + f.c[0] * F.distance, target.y + f.c[1] * F.distance, target.z + f.c[2] * F.distance);
      cam.zoom = zoom; cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      const N = R.T.w * R.T.h;
      const base = new Uint8Array(N * 3), tmp = new Uint8Array(N * 3), flips = new Uint8Array(N);
      const draw = (c, buf) => { r.setRenderTarget(R.T.color); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.render(sc, c); r.readRenderTargetPixels(R.T.color, 0, 0, R.T.w, R.T.h, R.T.u16); Z.toPerceptual(R.T.u16, R.T.w, R.T.h, buf); };
      draw(cam, base);
      for (const v of [{ near: cam.near * 1.29 }, { far: cam.far * 1.0587 }, { slide: 0.043 }, { dx: 0.37, dy: 0.29 }, { yaw: 0.04 }]) {
        const cv = variant(cam, { ...v, w: R.T.w }, target);
        draw(cv, tmp);
        if (v.dx || v.yaw) {
          // jitter: compare the jittered frame with its own near change (re-sampled depth ties)
          const t2 = new Uint8Array(N * 3);
          draw(variant(cv, { near: cv.near * 1.29, w: R.T.w }, target), t2);
          Z.diffInto(tmp, t2, 9, flips);
        } else Z.diffInto(base, tmp, 9, flips);
      }
      // count flips inside each pair's inner square (the projected 0.6 m square around its centre)
      const sp = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(cam); return [Math.round(((p.x + 1) / 2) * R.T.w), Math.round(((1 - p.y) / 2) * R.T.h)]; };
      const row = rows.map((rw) => {
        const c0 = sp(rw.x - 0.3, rw.y, rw.z - 0.3), c1 = sp(rw.x + 0.3, rw.y, rw.z + 0.3);
        let n = 0, tot = 0, green = 0;
        for (let y = Math.min(c0[1], c1[1]); y <= Math.max(c0[1], c1[1]); y++) for (let x = Math.min(c0[0], c1[0]); x <= Math.max(c0[0], c1[0]); x++) {
          if (x < 0 || y < 0 || x >= R.T.w || y >= R.T.h) continue;
          tot++; n += flips[y * R.T.w + x]; if (base[(y * R.T.w + x) * 3 + 1] > 128) green++;
        }
        return { gapMm: rw.gap * 1000, flipPx: n, px: tot, greenShare: r3(green / Math.max(1, tot)) };
      });
      const decal = [-1.5, 0, 1.5].map((dx) => {
        const c0 = sp(cx + dx - 0.25, cy, cz + 2.4 - 0.25), c1 = sp(cx + dx + 0.25, cy, cz + 2.4 + 0.25);
        let yel = 0, tot = 0, n = 0;
        for (let y = Math.min(c0[1], c1[1]); y <= Math.max(c0[1], c1[1]); y++) for (let x = Math.min(c0[0], c1[0]); x <= Math.max(c0[0], c1[0]); x++) {
          if (x < 0 || y < 0 || x >= R.T.w || y >= R.T.h) continue;
          const p = (y * R.T.w + x) * 3; tot++; n += flips[y * R.T.w + x];
          if (base[p] > 128 && base[p + 1] > 128 && base[p + 2] < 100) yel++;
        }
        return { shown: r3(yel / Math.max(1, tot)), flipShare: r3(n / Math.max(1, tot)) };
      });
      // measured noise: the largest gap with flips (> 0.2 % of its pixels)
      let meas = 0;
      for (const rw of row) if (rw.flipPx > rw.px * 0.002) meas = Math.max(meas, rw.gapMm / 1000);
      const ze = model.zooms.find((z) => z.zoom === zoom);
      const fr = model.frames[0];
      const epsModelDepth = model.eps([0, 1, 0], fr, ze);
      const measDepth = meas / Math.abs(fr.c[1]); // vertical gap → along the view
      out.zooms.push({ zoom, rows: row, decal: { 'depthWrite:false+renderOrder': decal[0], 'polygonOffset-1/-2+depthWrite:false': decal[1], 'opaque flush': decal[2] },
        measuredMm: meas * 1000, measuredDepthMm: r3(measDepth * 1e6) / 1000, modelDepthMm: r3(epsModelDepth * 1e6) / 1000 });
    }
  } finally {
    R.restore();
    sc.traverse((x) => { if (x.isMesh) { x.geometry.dispose(); x.material.dispose(); } });
  }
  const ratios = out.zooms.map((z) => (z.measuredDepthMm > 0 ? z.measuredDepthMm / z.modelDepthMm : 0));
  out.safety = r3(Math.max(1, ...ratios));
  ST.safety = out.safety;
  return out;
}

// ------------------------------------------------------------------ characters (sandbox close-ups)

/**
 * Units close up in a sandbox: each type spawned on an open spot, posed standing and mid-clip, the flicker test on its
 * meshes only from 8 yaws at the closest player zoom and at an inspection zoom, and kinds a / b on its CPU-skinned
 * triangles. @param {{units:string[], clips?:string[], at?:[number, number], zooms?:number[]}} o
 */
export async function characters(game, o = {}) {
  const F = cameraFacts(game);
  const w = game.world;
  const { Commando } = await import('/src/entities/commando.js');
  const units = o.units || ['tonino', 'grethe'];
  const clips = o.clips || ['idle', 'walk', 'run', 'throw_stone', 'smalltalk'];
  const at = o.at || pickOpenSpot(game);
  const zooms = o.zooms || [F.closest, 8];
  const yaws = o.yaws || [0, 45, 90, 135, 180, 225, 270, 315];
  const results = [];
  const R = renderSession(game);
  R.T = targets(F.vpW, F.vpH);
  for (const type of units) {
    const role = type === 'grethe_aux' ? 'grethe' : type;
    // Grethe's signals-auxiliary uniform (grethe_aux) is her body from expansion mission e06 on (humanoid-real
    // wearsUniform): build her under an e06 character context, then put the sandbox's back
    const um = type === 'grethe_aux' ? await import('/src/art/unit-model.js') : null;
    if (um) await um.prepareCharacters({ ...game.missionDef, id: 'e06' });
    const u = new Commando({ role, x: at[0], z: at[1], heading: 0 });
    w.add(u);
    try { await u.model.ready; } finally { if (um) await um.prepareCharacters(game.missionDef); }
    const res = { type, character: u.model.characterId, poses: [] };
    // the other units / effects hidden; this unit kept
    for (const h of ST.hidden || []) h.visible = false;
    u.object3d.visible = true;
    // the game's own view on him at the closest player zoom: his LOD (LOD0 ≥ 60 px/m) and his culling follow it
    const cc = game.cameraController;
    cc.setZoom(F.closest, true);
    cc.centerOn(u.x, u.z);
    game.render(0, 1);
    for (const clip of clips) {
      const pose = await poseUnit(u, clip, game);
      if (!pose.ok) { res.poses.push({ clip, skipped: pose.why }); continue; }
      cc.centerOn(u.x, u.z);
      game.render(0, 1);
      u.object3d.updateMatrixWorld(true);
      // character meshes
      const meshes = new Set();
      u.object3d.traverse((m) => { if ((m.isMesh || m.isSkinnedMesh) && m.visible) meshes.add(m); });
      // geometric a / b on the posed triangles
      const { model } = modelFor(game, { zooms, yaws });
      const recs = Z.collectSurfaces(u.object3d, { skinned: true, classify: () => 'surface' });
      const T = Z.gatherTriangles(recs);
      const B = Z.buildBVH(T);
      const vis = Z.makeVisibility(B, T, null, model);
      const raw = Z.coplanarScan(T, B, model, { minPx: 0.05, pad: 0.002 });
      const geo = Z.coplanarFindings(T, raw, model, vis).filter((f) => f.visible && f.px >= (o.minPx ?? 4));
      // flicker from each yaw at each zoom
      const ids = idSetup(R.scene, null, { only: meshes });
      const flick = [], views = [], portraits = [];
      try {
        for (const zoom of zooms) for (const yaw of yaws) {
          const f = Z.cameraFrame(yaw, F.pitch);
          const cam = game.cameraController.camera.clone();
          const target = new THREE.Vector3(u.x, 0.95, u.z);
          cam.position.set(target.x + f.c[0] * F.distance, target.y + f.c[1] * F.distance, target.z + f.c[2] * F.distance);
          cam.zoom = zoom; cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
          R.freeze();
          let fv;
          try { fv = flickerView(R, cam, target, { ids, T: o.T, maskGrow: 1 }); } finally { R.restore(); }
          const cl = Z.flickerClusters(fv.hit, R.T.w, R.T.h, { r: 2, min: 6, grow: 1, minN: o.minHits ?? 8 });
          let onHim = 0, hitsAll = 0;
          for (let i = 0; i < fv.id0.length; i++) { if (fv.id0[i]) onHim++; hitsAll += fv.hit[i]; }
          views.push({ zoom, yaw, px: onHim, hits: hitsAll, clusters: cl.length });
          // a portrait of every pose at the inspection zoom, front and back three-quarter (what was tested, with its heat)
          if (zoom === zooms[zooms.length - 1] && (yaw === 0 || yaw === 135)) {
            const q = target.clone().project(cam), px = ((q.x + 1) / 2) * R.T.w, py = ((1 - q.y) / 2) * R.T.h;
            portraits.push({ yaw, zoom, url: cropImages(fv, { cx: px, cy: py, box: [px - 1, py - 1, px + 1, py + 1] }, R.T, { cropW: 260, cropH: 600, scale: 1 }) });
          }
          for (const c of cl.slice(0, 6)) {
            const pairs = new Map();
            for (const i of c.pixels) { if (!fv.hit[i]) continue; const a = fv.id0[i], b = fv.id1[i]; if (a !== b) { const k = a < b ? `${a}|${b}` : `${b}|${a}`; pairs.set(k, (pairs.get(k) || 0) + 1); } }
            const top = [...pairs.entries()].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([k, n]) => ({ a: ids.info[+k.split('|')[0]]?.path ?? 'background', b: ids.info[+k.split('|')[1]]?.path ?? 'background', px: n }));
            flick.push({ zoom, yaw, hits: c.hits, box: [c.x0, c.y0, c.x1, c.y1], pairs: top, crop: cropImages(fv, c, R.T, { cropW: 160, cropH: 160 }) });
          }
        }
      } finally { ids.dispose(); }
      res.poses.push({ clip: pose.clip, t: pose.t, meshes: [...meshes].map((m) => `${m.parent?.name || ''}/${m.name}`).slice(0, 40), geometric: geo, flicker: flick, views, portraits });
    }
    w.remove?.(u);
    u.object3d.removeFromParent?.();
    u.model.dispose?.();
    results.push(res);
  }
  R.restore();
  return { at, zooms, yaws, units: results };
}

/** An open spot of the sandbox (the camera start, else the map centre). */
function pickOpenSpot(game) {
  const d = game.missionDef || {};
  if (d.cameraStart) return [d.cameraStart.x ?? d.cameraStart[0], d.cameraStart.z ?? d.cameraStart[1]];
  const [W, D] = d.size || [100, 100];
  return [W / 2, D / 2];
}

/** Pose a unit in a clip at mid-clip (standing: idle at 0.5 s). Steps its model's mixer with dt only (the sim does not run). */
async function poseUnit(u, clip, game) {
  const m = u.model;
  game.cameraController.centerOn(u.x, u.z);
  game.render(0, 1);
  try {
    m.setAnim(clip, { restart: true, loop: true });
  } catch (e) { return { ok: false, why: String(e) }; }
  const inner = m.real?.inner;
  const dur = inner?.mixer?._actions?.find?.((a) => a.isRunning?.())?.getClip?.()?.duration ?? 1;
  const t = clip === 'idle' ? 0.5 : dur * 0.5;
  const steps = Math.max(1, Math.round(t / (1 / 30)));
  for (let i = 0; i < steps; i++) { m.update(1 / 30, u); if (i % 8 === 0) game.render(0, 1); }
  u.object3d.updateMatrixWorld(true);
  const playing = m.clip || m.anim;
  return { ok: true, clip: `${clip}${playing && playing !== clip ? ` (plays ${playing})` : ''}`, t: r3(t) };
}
