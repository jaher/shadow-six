// review.js - review renderer. JOB_ARGS = {chars:[{url,name,weapon?}], views:[...], clips:[...], frames:6}
// views: heads (front+side close-ups), turn (8-view turnaround), game1x / game2x (orthographic game camera,
// pitch 40 deg, 40 / 80 CSS px per metre), strip (animation frame strips per clip), gear (weapons on a table)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacter, loadAnimLibrary, createHumanoid } from '../charkit.js';
import { loadWeapons, equip } from '../weapons.js';

export default async function (canvas, W, H) {
  const A = window.__args;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-4, 8, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = await loadAnimLibrary(A.anims || '/chars/out/anims.glb');
  const weapons = A.weapons ? await loadWeapons(A.weapons) : null;
  const tpls = await Promise.all(A.chars.map(c => loadCharacter(c.url)));
  const mk = (i, clip = 'idle', t = 0.5) => {
    const h = createHumanoid(tpls[i], lib); scene.add(h.object);
    h.setAnim(clip, { fade: 0 }); h.update(t);
    if (weapons && A.chars[i].weapon) equip(h, weapons, A.chars[i].weapon, { clip });
    h.update(0);
    return h;
  };
  const jobs = [];
  const ortho = (w, h) => new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.05, 100);
  const clear = () => { for (const o of [...scene.children]) if (o.userData.__char) scene.remove(o); };
  const add = (h) => { h.object.userData.__char = true; return h; };
  for (const view of A.views) {
    if (view === 'heads') {
      A.chars.forEach((c, i) => {
        for (const [tag, yaw] of [['front', 0], ['side', 90], ['q34', 35]]) jobs.push(() => {
          clear(); const h = add(mk(i, 'idle', 0.0));
          const hb = h.bones.Head; h.object.updateMatrixWorld(true);
          const p = hb.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.07, 0));
          const cam = ortho(0.4 * W / H, 0.4); const a = THREE.MathUtils.degToRad(yaw);
          cam.position.set(p.x + Math.sin(a) * 3, p.y, p.z + Math.cos(a) * 3); cam.lookAt(p);
          ground.visible = false; r.render(scene, cam); ground.visible = true;
          return `${c.name}_head_${tag}`;
        });
      });
    }
    if (view === 'turn') {
      jobs.push(() => {
        clear();
        const n = 8; const hs = [];
        A.chars.forEach((c, i) => { for (let k = 0; k < n; k++) { const h = add(mk(i, A.turnClip || 'idle', 0.3)); h.object.position.set((k - (n - 1) / 2) * 1.0, 0, (i - (A.chars.length - 1) / 2) * -2.6); h.object.rotation.y = -k * Math.PI * 2 / n; hs.push(h); } });
        const cam = ortho(9, 9 * H / W); cam.position.set(0, 1.1, 20); cam.lookAt(0, 1.0 + (A.chars.length - 1) * 0.0, 0);
        if (A.chars.length > 1) { cam.position.set(0, 9, 18); cam.lookAt(0, 0.9, -1.3); cam.top = 9 * H / W / 2 + 0.3; cam.bottom = -cam.top + 0.6; cam.updateProjectionMatrix(); }
        r.render(scene, cam); return 'turnaround';
      });
    }
    for (const [tag, ppm] of [['game1x', 40], ['game2x', 80]]) {
      if (view !== tag) continue;
      jobs.push(() => {
        clear();
        const clips = A.lineClips || ['idle', 'walk', 'run', 'crouch_walk', 'crawl', 'aim', 'die', 'dead'];
        A.chars.forEach((c, i) => clips.forEach((cl, k) => {
          const h = add(mk(i, cl, 0.37)); h.object.position.set((k - (clips.length - 1) / 2) * 1.6, 0, i * -2.2 + 1);
          h.object.rotation.y = cl === 'crawl' || cl === 'crawl_idle' ? -0.6 : 0.4;
        }));
        const cam = ortho(W / ppm, H / ppm);
        const pitch = THREE.MathUtils.degToRad(40);
        cam.position.set(0, Math.sin(pitch) * 30, Math.cos(pitch) * 30); cam.lookAt(0, 0.5, -0.8);
        r.render(scene, cam); return tag;
      });
    }
    if (view === 'strip') {
      A.chars.forEach((c, i) => (A.clips || ['walk']).forEach(cl => jobs.push(() => {
        clear();
        const F = A.frames || 6; const clip = lib.clips.get(cl); const dur = clip ? clip.duration : 1;
        for (let f = 0; f < F; f++) { const h = add(mk(i, cl, (f / F) * dur)); h.object.position.set((f - (F - 1) / 2) * 1.25, 0, 0); h.object.rotation.y = 0.9; }
        const cam = ortho(F * 1.25, F * 1.25 * H / W); const pitch = THREE.MathUtils.degToRad(15);
        cam.position.set(0, 1 + Math.sin(pitch) * 20, Math.cos(pitch) * 20); cam.lookAt(0, 0.9, 0);
        r.render(scene, cam); return `${c.name}_strip_${cl}`;
      })));
    }
  }
  return { count: jobs.length, render: (i) => jobs[i]() };
}
