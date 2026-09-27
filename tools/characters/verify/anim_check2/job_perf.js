// perf r2: 30 squad soldiers (squadkit.spawnSquadMember over enemykit) + 6 commandos (CA/CB runtimes), 1920x1080,
// ortho game camera, each runtime's own auto LOD; GPU via EXT_disjoint_timer_query_webgl2
import { THREE, ROSTER, group, makeChar, spawnSquadMember, assignSquadVariants } from './common.js';
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(1); r.setSize(W, H, false); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping;
  const gl = r.getContext(); const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5040, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun); scene.add(sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x77705c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const E = (await group('enemy')).E;
  const types = ['rifleman', 'rifleman', 'rifleman', 'trooper', 'sentry', 'sergeant', 'mg', 'engineer', 'rifleman', 'officer'];
  const spawns = []; for (let i = 0; i < 30; i++) spawns.push({ id: 's' + String(i).padStart(2, '0'), type: types[i % 10], squad: 'A', x: ((i % 9) - 4) * 4.6, z: (Math.floor(i / 9) - 2) * 4.8 });
  const picks = assignSquadVariants('perf', spawns, E.variantsByType);
  const units = []; const anims = ['walk', 'idle', 'look_around', 'walk', 'run', 'idle', 'aim', 'walk'];
  for (let i = 0; i < 36; i++) {
    let h, a;
    if (i < 30) { h = await spawnSquadMember(E, 'perf', spawns[i], picks.get(spawns[i].id)); a = anims[i % anims.length]; h.enemy = true; }
    else { const R = ROSTER.find(x => x.id === ['greenberet', 'sniper', 'marine', 'sapper', 'driver', 'spy'][i - 30]); h = await makeChar(R); a = ['walk', 'crawl', 'idle', 'walk', 'run', 'crawl'][i - 30]; }
    const x = ((i % 9) - 4) * 4.6, z = (Math.floor(i / 9) - 2) * 4.8;
    h.object.position.set(x, 0, z); h.object.rotation.y = i * 1.3;
    const sp = a === 'walk' ? (i < 30 ? 0.9 : 2.25) : a === 'run' ? (i < 30 ? 3.8 : 4.5) : a === 'crawl' ? 0.9 : null;
    h.setAnim(a, { speed: sp, fade: 0 }); h.update(Math.random() * 2);
    scene.add(h.object); units.push({ h, a, sp, dir: new THREE.Vector3(Math.sin(i * 1.3), 0, Math.cos(i * 1.3)), home: h.object.position.clone() });
  }
  const res = { ext: !!ext, tris: {}, configs: {}, lods: {} };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'); res.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const setCam = (ppm) => { const hw = W / 2 / ppm, hh = H / 2 / ppm; Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh });
    const p = THREE.MathUtils.degToRad(40); cam.position.set(0, 100 * Math.sin(p), 100 * Math.cos(p)); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
    const e2 = Math.min(40, Math.max(hw, hh / Math.sin(p)) + 2); sun.position.set(-20, 40, 25); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -e2, right: e2, top: e2, bottom: -e2, near: 1, far: 150 }); sun.shadow.camera.updateProjectionMatrix(); };
  const sleep = () => new Promise(res => setTimeout(res, 0));
  const lodName = (h) => { for (const [n, m] of Object.entries(h.parts)) if (/^LOD\d/.test(n) && m.visible) return n.slice(0, 4); return '?'; };
  async function measure(name, { ppm, lod = null, shadows = true, chars = true, frames = 150, cullCommandos = false }) {
    setCam(ppm); r.shadowMap.enabled = shadows; sun.castShadow = shadows; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    for (const u of units) { u.h.object.visible = chars; if (lod) u.h.setLOD(lod); else u.h.autoLOD(ppm);
      if (!u.h.enemy) u.h.object.traverse(o => { if (o.isMesh) { o.frustumCulled = cullCommandos; if (cullCommandos) o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.9); } }); }
    res.lods[name] = { enemy: lodName(units[0].h), commando: lodName(units[30].h), commandoB: lodName(units[33].h) };
    const cpuA = [], cpuR = [], gpu = [], pend = []; const dt = 1 / 60;
    for (let f = 0; f < frames + 20; f++) {
      const t0 = performance.now();
      if (chars) for (const u of units) { if (u.sp) { u.h.object.position.addScaledVector(u.dir, u.sp * dt); if (u.h.object.position.distanceTo(u.home) > 4) u.h.object.position.copy(u.home); } u.h.update(dt); }
      const t1 = performance.now(); let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      r.render(scene, cam);
      if (ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push({ q, f }); }
      const t2 = performance.now();
      if (f >= 20) { cpuA.push(t1 - t0); cpuR.push(t2 - t1); }
      if (f === 20) res.tris[name] = { tris: r.info.render.triangles, calls: r.info.render.calls, programs: r.info.programs.length, textures: r.info.memory.textures, geoms: r.info.memory.geometries };
      await sleep();
      for (let k = pend.length - 1; k >= 0; k--) { const p = pend[k];
        if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && p.f >= 20) gpu.push(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(p.q); pend.splice(k, 1); } }
    }
    const q = (a, t) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length * t)] * 1000) / 1000 : null; };
    res.configs[name] = { ppm, shadows, chars, cullCommandos, cpuAnimMed: q(cpuA, 0.5), cpuAnimP90: q(cpuA, 0.9), cpuRenderMed: q(cpuR, 0.5), cpuRenderP90: q(cpuR, 0.9), gpuMed: q(gpu, 0.5), gpuP90: q(gpu, 0.9), gpuN: gpu.length };
    console.log(name, JSON.stringify(res.configs[name]), JSON.stringify(res.tris[name]), JSON.stringify(res.lods[name]));
  }
  if (args.profile) { const acc = {}; setCam(40); for (const u of units) u.h.autoLOD(40);
    for (let f = 0; f < 240; f++) for (const [i, u] of units.entries()) { const t = performance.now(); u.h.update(1 / 60); const k = (i < 30 ? 'enemy_' : 'com_' + (i < 33 ? 'CA_' : 'CB_')) + u.a; acc[k] = (acc[k] || 0) + performance.now() - t; }
    // mixer-only share
    const mx = {}; for (let f = 0; f < 240; f++) for (const [i, u] of units.entries()) { const t = performance.now(); u.h.mixer.update(1 / 60); const k = i < 30 ? 'enemy' : 'com'; mx[k] = (mx[k] || 0) + performance.now() - t; }
    res.profile = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v / 240 * 1000) / 1000])); res.mixerOnly = Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, Math.round(v / 240 * 1000) / 1000]));
    res.counts = {}; units.forEach((u, i) => { const k = (i < 30 ? 'enemy_' : 'com_' + (i < 33 ? 'CA_' : 'CB_')) + u.a; res.counts[k] = (res.counts[k] || 0) + 1; });
    return { count: 0, result: () => res }; }
  const C = args.configs || [
    ['empty_1x', { ppm: 40, chars: false }], ['zoom0.5_auto', { ppm: 20 }], ['zoom1_auto', { ppm: 40 }], ['zoom2_auto', { ppm: 80 }], ['close_auto', { ppm: 160 }],
    ['zoom1_cullCom', { ppm: 40, cullCommandos: true }], ['zoom2_cullCom', { ppm: 80, cullCommandos: true }], ['close_cullCom', { ppm: 160, cullCommandos: true }],
    ['zoom1_LOD0', { ppm: 40, lod: 'LOD0' }], ['zoom1_LOD2', { ppm: 40, lod: 'LOD2' }], ['zoom1_noshadow', { ppm: 40, shadows: false }]];
  for (let rep = 0; rep < (args.reps || 2); rep++) for (const [n, o] of C) await measure(n + (rep ? '_r' + rep : ''), o);
  return { count: 0, result: () => res };
}
