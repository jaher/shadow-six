// review_ca.js - commandos_a review sheets through the GAME FLOW (ca_runtime: loadCALib + createCommando + equipCA;
// idle 0.6 s -> setAnim(clip) -> update), so the per-frame shoulder rig, prone deaths and ground fixes are what is shown.
// views: game2x (pitch 40, 80 px/m), game1x, aim (close-ups of aim/kneel_shoot, 2 camera angles), strip (per char, rows of clips)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacter } from '/chars/pipeline/web/charkit.js';
import { loadWeapons } from '/chars/pipeline/web/weapons.js';
import { loadCALib, createCommando, equipCA } from '../ca_runtime.js';

export default async function (canvas, W, H, A) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.setScissorTest(true);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-4, 8, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const grid = new THREE.GridHelper(240, 240, 0x55503f, 0x5f5a48); grid.position.y = 0.002; scene.add(grid);
  const lib = await loadCALib(); const Wp = await loadWeapons('/chars/out/weapons.glb');
  const tpls = await Promise.all(A.chars.map(c => loadCharacter(c.url)));
  const live = [];
  const clear = () => { for (const h of live) scene.remove(h.object); live.length = 0; };
  // game flow: equip, idle 0.6 s, (crawl 0.5 s for prone deaths), then the clip for t seconds
  const mk = (i, clip, t = 0.45) => {
    const h = createCommando(tpls[i], lib); scene.add(h.object); live.push(h);
    if (A.chars[i].weapon) equipCA(h, Wp, A.chars[i].weapon);
    let cl = clip, pre = 'idle';
    if (clip === 'die_prone') { cl = 'die'; pre = 'crawl'; } if (clip === 'dead_prone') { cl = 'dead'; pre = 'crawl'; }
    h.setAnim(pre, { fade: 0 }); for (let k = 0; k < 36; k++) h.update(1 / 60);
    const m = lib.meta[cl] || {}; h.setAnim(cl, { loop: m.loop !== false && cl !== 'die', fade: 0 });
    const n = Math.max(1, Math.round(t * 60)); for (let k = 0; k < n; k++) h.update(1 / 60);
    return h;
  };
  const ortho = (w, hh) => new THREE.OrthographicCamera(-w / 2, w / 2, hh / 2, -hh / 2, 0.05, 200);
  const tile = (x, y, w, hh, cam) => { r.setViewport(x, H - y - hh, w, hh); r.setScissor(x, H - y - hh, w, hh); r.render(scene, cam); };
  const jobs = [];
  for (const view of A.views) {
    for (const [tag, ppm] of [['game1x', 40], ['game2x', 80]]) if (view === tag) jobs.push(() => {
      clear(); const clips = A.lineClips;
      A.chars.forEach((c, i) => clips.forEach((cl, k) => {
        const h = mk(i, cl, cl === 'die_prone' || cl === 'die' ? 3 : 0.45 + k * 0.07);
        h.object.position.set((k - (clips.length - 1) / 2) * 1.75, 0, i * -2.6 + 1.2); h.object.rotation.y = /crawl|prone/.test(cl) ? -0.6 : 0.5;
      }));
      const cam = ortho(W / ppm, H / ppm), p = THREE.MathUtils.degToRad(40);
      cam.position.set(0, Math.sin(p) * 40, Math.cos(p) * 40 - 0.2); cam.lookAt(0, 0.5, -0.2); tile(0, 0, W, H, cam); return tag;
    });
    if (view === 'aim') jobs.push(() => {
      clear(); const set = []; A.chars.forEach((c, i) => ['aim', 'kneel_shoot'].forEach(cl => set.push([i, cl])));
      const tw = W / set.length, th = H / 2;
      set.forEach(([i, cl], k) => { const h = mk(i, cl, 0.8); h.object.position.set(k * 6, 0, 0); h.object.rotation.y = 0; });
      set.forEach(([i, cl], k) => {
        const h = live[k]; live.forEach(o => o.object.visible = o === h); h.object.updateMatrixWorld(true); const c = h.bones.spine_03.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0.25));
        for (const [row, yaw, el] of [[0, 90, 5], [1, -35, 12]]) {
          const cam = ortho(1.25 * tw / th, 1.25), a = THREE.MathUtils.degToRad(yaw), e = THREE.MathUtils.degToRad(el);
          cam.position.set(c.x + Math.sin(a) * Math.cos(e) * 4, c.y + Math.sin(e) * 4, c.z + Math.cos(a) * Math.cos(e) * 4); cam.lookAt(c);
          tile(Math.round(k * tw), row * th, Math.round(tw) - 2, th - 2, cam);
        }
      });
      return 'aim';
    });
    if (view === 'strip') A.chars.forEach((c, i) => jobs.push(() => {
      clear(); const clips = A.clips, F = A.frames || 6, rh = H / clips.length, SP = A.spacing || 1.2;
      clips.forEach((cl, row) => {
        const name = cl === 'die_prone' ? 'die_prone' : cl; const clip = lib.clips.get(name) || lib.clips.get(cl); const dur = clip ? clip.duration : 1;
        for (let f = 0; f < F; f++) {
          const t = cl === 'die_prone' ? 0.02 + f / (F - 1) * dur : (f / F) * dur + 0.02;
          const h = mk(i, cl, t); h.object.position.set((f - (F - 1) / 2) * SP, /swim|dive/.test(cl) ? 0.5 : 0, row * -8); h.object.rotation.y = /crawl|prone/.test(cl) ? 0.35 : 0.9;
        }
        const cy = /crawl|prone/.test(cl) ? 0.35 : /swim|dive/.test(cl) ? 0.6 : 0.95;
        const cam = ortho(F * SP, F * SP * rh / W), p = THREE.MathUtils.degToRad(15);
        cam.position.set(0, cy + Math.sin(p) * 20, row * -8 + Math.cos(p) * 20); cam.lookAt(0, cy, row * -8);
        tile(0, Math.round(row * rh), W, Math.round(rh) - 2, cam);
      });
      return `${c.name}_strips`;
    }));
  }
  // trans: per char, rows of frames through TRANSITIONS in game order (setAnim(from, snap) 0.6 s, then setAnim(to) re-issued
  // every frame + update): aim in/out blend, go_prone / get_up, crouch_walk at 2.25 m/s, swim at 1.8 m/s
  const TR = [
    { l: 'idle>aim', f: 'idle', to: 'aim', ts: [0, 0.05, 0.1, 0.15, 0.2, 0.4], sp: 2.3 },
    { l: 'aim>idle', f: 'aim', to: 'idle', ts: [0, 0.05, 0.1, 0.15, 0.2, 0.4], sp: 2.3 },
    { l: 'idle>crawl_idle', f: 'idle', to: 'crawl_idle', ts: [0, 0.25, 0.45, 0.65, 0.85, 1.05, 1.25, 1.45, 1.8], sp: 1.9, ry: 1.25 },
    { l: 'crawl_idle>idle', f: 'crawl_idle', to: 'idle', ts: [0, 0.25, 0.45, 0.65, 0.85, 1.05, 1.25, 1.45, 1.8], sp: 1.9, ry: 1.25 },
    { l: 'crouch_walk 2.25', f: 'crouch_walk', to: 'crouch_walk', ts: [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.54], sp: 2.0, speed: 2.25 },
    { l: 'swim 1.8', f: 'swim', to: 'swim', ts: [0, 0.16, 0.32, 0.48, 0.64, 0.8, 0.96], sp: 2.0, speed: 1.8, y: 0.55, ry: 1.25 } ];
  const mkT = (i, R, t) => {
    const h = createCommando(tpls[i], lib); scene.add(h.object); live.push(h);
    if (A.chars[i].weapon) equipCA(h, Wp, A.chars[i].weapon);
    const o = R.speed ? { speed: R.speed } : {};
    h.setAnim(R.f, { fade: 0, ...o }); for (let k = 0; k < 36; k++) h.update(1 / 60);
    const n = Math.round(t * 60); for (let k = 0; k < n; k++) { h.setAnim(R.to, { loop: true, ...o }); h.update(1 / 60); }
    return h;
  };
  for (const view of A.views) if (view === 'trans') A.chars.forEach((c, i) => jobs.push(() => {
    clear(); const rh = H / TR.length;
    TR.forEach((R, row) => {
      const F = R.ts.length;
      R.ts.forEach((t, f) => { const h = mkT(i, R, t); h.object.position.set((f - (F - 1) / 2) * R.sp, R.y || 0, row * -10); h.object.rotation.y = R.ry ?? 0.9; });
      const wv = F * R.sp, cam = ortho(wv, wv * rh / W), p = THREE.MathUtils.degToRad(15);
      const cy = R.ry ? 0.55 : 0.92; cam.position.set(0, cy + Math.sin(p) * 20, row * -10 + Math.cos(p) * 20); cam.lookAt(0, cy, row * -10);
      tile(0, Math.round(row * rh), W, Math.round(rh) - 2, cam);
    });
    return `${c.name}_trans`;
  }));
  return { count: jobs.length, render: (i) => jobs[i]() };
}
