// review_dog.js - dog review renders. JOB_ARGS = {dogs:[url...], views:['close','game1x','game2x','strip'], clips:[...], human:url?}
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadDog, createDog } from '../dogkit.js';
import { loadCharacter, loadAnimLibrary, createHumanoid } from '../charkit.js';

export default async function (canvas, W, H) {
  const A = window.__args;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-4, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const tpls = await Promise.all(A.dogs.map(u => loadDog(u)));
  let human = null;
  if (A.human) { const lib = await loadAnimLibrary('/chars/out/anims.glb'); const t = await loadCharacter(A.human); human = () => createHumanoid(t, lib); }
  const ortho = (w, h) => new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.05, 100);
  const clear = () => { for (const o of [...scene.children]) if (o.userData.__c) scene.remove(o); };
  const mk = (i, clip, t, ppm = 200) => { const d = createDog(tpls[i]); d.object.userData.__c = true; scene.add(d.object); d.setAnim(clip, { fade: 0 }); d.update(t); d.autoLOD(ppm); return d; };
  const jobs = [];
  for (const view of A.views) {
    if (view === 'close') A.dogs.forEach((u, i) => jobs.push(() => {
      clear(); const yaws = [90, 0, 35, 150];
      yaws.forEach((y, k) => { const d = mk(i, 'idle', 0.4); d.object.position.set((k - 1.5) * 1.3, 0, 0); d.object.rotation.y = THREE.MathUtils.degToRad(y); });
      const cam = ortho(5.4, 5.4 * H / W); cam.position.set(0, 0.5, 20); cam.lookAt(0, 0.45, 0); r.render(scene, cam); return `dog${i}_close`;
    }));
    for (const [tag, ppm] of [['game1x', 40], ['game2x', 80]]) {
      if (view !== tag) continue;
      jobs.push(() => {
        clear(); const clips = A.lineClips || ['idle', 'walk', 'run', 'sniff', 'bark', 'attack', 'die', 'dead'];
        A.dogs.forEach((u, i) => clips.forEach((cl, k) => { const d = mk(i, cl, 0.37, ppm); d.object.position.set((k - (clips.length - 1) / 2) * 1.3, 0, i * -1.6 + 0.6); d.object.rotation.y = 0.6; }));
        if (human) { const h = human(); h.object.userData.__c = true; scene.add(h.object); h.setAnim('idle', { fade: 0 }); h.update(0.3); h.autoLOD && h.autoLOD(ppm); h.object.position.set(-(clips.length / 2 + 0.6) * 1.3, 0, 0.6); }
        const cam = ortho(W / ppm, H / ppm); const p = THREE.MathUtils.degToRad(40);
        cam.position.set(0, Math.sin(p) * 30, Math.cos(p) * 30); cam.lookAt(0, 0.3, -0.3); r.render(scene, cam); return tag;
      });
    }
    if (view === 'strip') (A.clips || ['walk']).forEach(cl => jobs.push(() => {
      clear(); const F = A.frames || 6; const clip = tpls[0].clips.get(cl); const dur = clip ? clip.duration : 1;
      for (let f = 0; f < F; f++) { const d = mk(0, cl, (f / F) * dur); d.object.position.set((f - (F - 1) / 2) * 1.15, 0, 0); d.object.rotation.y = Math.PI / 2; }
      const cam = ortho(F * 1.15, F * 1.15 * H / W); const p = THREE.MathUtils.degToRad(12);
      cam.position.set(0, 0.45 + Math.sin(p) * 20, Math.cos(p) * 20); cam.lookAt(0, 0.45, 0); r.render(scene, cam); return `strip_${cl}`;
    }));
  }
  return { count: jobs.length, render: (i) => jobs[i]() };
}
