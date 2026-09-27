// review_enemies.js - enemy review renders (run with pipeline/tools/run_page.mjs ../enemies/web/review_enemies.js <prefix> W H)
// JOB_ARGS = {chars:[{url,name,weapon?,clip?}], views:[faces|lineup|game1x|game2x|squad|strip], clips:[...], frames:6, cols:6}
//  faces  : all heads in one grid (row pairs: front / side), orthographic 0.34 m per cell
//  lineup : full bodies, front-3/4 row + back row
//  game1x/game2x : game camera (orthographic, pitch 40 deg, 40 / 80 px per metre), each char playing its `clip`
//  strip  : per char per clip animation frames
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacter, loadAnimLibrary, createHumanoid } from '/chars/pipeline/web/charkit.js';
import { loadWeapons, equip } from '/chars/pipeline/web/weapons.js';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';

export default async function (canvas, W, H) {
  const A = window.__args;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-4, 8, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: A.groundColor ?? 0x6f6a55, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = await loadAnimLibrary('/chars/out/anims.glb');
  const ex = await loadAnimLibrary('/chars/enemies/out/enemy_anims.glb');
  for (const [k, c] of ex.clips) lib.clips.set(k, c); Object.assign(lib.meta, ex.meta);
  const weapons = await loadWeapons('/chars/out/weapons.glb');
  // enemy runtime (enemykit): lib meta fix, ground clamp, rifle holds, props, per-instance jitter - what the game shows
  const E = await loadEnemySet('/chars/enemies/out/');
  const all = Object.values(E.variantsByType).flat();
  const hs = [];
  for (const c of A.chars) hs.push(await spawnEnemy(E, 'review', { id: 'rv_' + c.name }, all.find(v => v.id === c.name)));
  const mk = (i, clip = 'idle', t = 0.5) => {
    const h = hs[i]; h.object.userData.__char = true; h.object.position.set(0, 0, 0); h.object.rotation.set(0, 0, 0); scene.add(h.object);
    const a = h.setAnim(clip, { fade: 0 }); if (a) { a.time = 0; } h.update(t);
    h.update(0); h.object.updateMatrixWorld(true);
    return h;
  };
  const clear = () => { for (const o of [...scene.children]) if (o.userData.__char) scene.remove(o); };
  const ortho = (w, h) => new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.05, 200);
  const jobs = []; const n = A.chars.length;
  for (const view of A.views) {
    if (view === 'faces') jobs.push(() => {
      // one scissored viewport per head: row pairs = front / side; only that character is in the scene
      clear(); const cols = A.cols || Math.min(n, 6); const rows = Math.ceil(n / cols);
      const cw = Math.floor(W / cols), ch = Math.floor(H / (rows * 2));
      const cam = ortho(0.30 * cw / ch, 0.30);
      r.setScissorTest(true); r.autoClear = false; r.setClearColor(0x8a8f94); r.clear(); ground.visible = false;
      A.chars.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        for (const [k, yaw] of [[0, 0], [1, Math.PI / 2]]) {
          clear(); const h = mk(i, 'idle', 0.0);
          const hp = h.bones.Head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.075, 0));
          const a = yaw; cam.position.set(hp.x + Math.sin(a) * 3, hp.y, hp.z + Math.cos(a) * 3); cam.lookAt(hp);
          const x = col * cw, y = H - (row * 2 + k + 1) * ch;
          r.setViewport(x, y, cw, ch); r.setScissor(x, y, cw, ch); r.clear(); r.render(scene, cam);
        }
      });
      r.setScissorTest(false); r.autoClear = true; r.setViewport(0, 0, W, H); ground.visible = true; return 'faces';
    });
    if (view === 'lineup' || view === 'lineup_back') jobs.push(() => {
      // rows of `cols` full bodies (row k lifted out of the ground plane, ground hidden); size the canvas as
      // W / H = (cols * gap + 0.2) / (rows * 2.25) for 1:1 metres
      clear(); const gap = A.gap || 0.95; const cols = A.cols || Math.min(n, 6); const rows = Math.ceil(n / cols);
      A.chars.forEach((c, i) => { const h = mk(i, c.clip || 'idle', 0.3); h.object.position.set(((i % cols) - (cols - 1) / 2) * gap, -Math.floor(i / cols) * 2.25, 0); h.object.rotation.y = view === 'lineup' ? 0.35 : Math.PI + 0.35; });
      const w = cols * gap + 0.2, hh = w * H / W; const cam = ortho(w, hh); const cy = 2.15 - hh / 2;
      cam.position.set(0, cy, 30); cam.lookAt(0, cy, 0);
      ground.visible = false; r.render(scene, cam); ground.visible = true; return view;
    });
    for (const [tag, ppm] of [['game1x', 40], ['game2x', 80]]) {
      if (view !== tag) continue;
      jobs.push(() => {
        clear(); const cols = A.gameCols || Math.ceil(Math.sqrt(n * 1.6));
        A.chars.forEach((c, i) => {
          const GC = A.gameClips || ['idle', 'walk', 'look_around', 'aim', 'run', 'idle', 'crouch_walk', 'walk'];
          const h = mk(i, c.clip || GC[i % GC.length], 0.37 + i * 0.13);
          h.object.position.set(((i % cols) - (cols - 1) / 2) * 1.5 + (i % 3) * 0.15, 0, Math.floor(i / cols) * 1.8 - 1);
          h.object.rotation.y = c.yaw ?? (0.4 + (i % 5) * 0.5);
        });
        const cam = ortho(W / ppm, H / ppm); const pitch = THREE.MathUtils.degToRad(40);
        cam.position.set(0, Math.sin(pitch) * 30, Math.cos(pitch) * 30); cam.lookAt(0, 0.5, 0.3);
        r.render(scene, cam); return tag;
      });
    }
    if (view === 'strip') {
      A.chars.forEach((c, i) => (A.clips || ['walk']).forEach(cl => jobs.push(() => {
        clear(); const F = A.frames || 6; const clip = lib.clips.get(cl); const dur = clip ? clip.duration : 1;
        for (let f = 0; f < F; f++) { const h = mk(i, cl, (f / F) * dur); h.object.position.set((f - (F - 1) / 2) * 1.25, 0, 0); h.object.rotation.y = 0.9; }
        const cam = ortho(F * 1.25, F * 1.25 * H / W); const pitch = THREE.MathUtils.degToRad(15);
        cam.position.set(0, 1 + Math.sin(pitch) * 20, Math.cos(pitch) * 20); cam.lookAt(0, 0.9, 0);
        r.render(scene, cam); return `${c.name}_strip_${cl}`;
      })));
    }
  }
  return { count: jobs.length, render: (i) => jobs[i]() };
}
