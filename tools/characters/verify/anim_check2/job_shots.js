// renders single shots: args.shots = [{id, clip, t, pre, yaw, pitch, ppm, resolve, shipped, label, disguise, cy}]
import { THREE, ROSTER, makeChar } from './common.js';
import { start, run } from './metrics.js';
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H, false); r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa0a6);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5040, 1.2));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.6); sun.position.set(-4, 9, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); scene.add(sun);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#7d7462'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#5e5747'; g.lineWidth = 3; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 20); tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const shots = args.shots || []; let cur = null;
  return {
    count: shots.length,
    async render(i) {
      const S = shots[i]; const R = ROSTER.find(x => x.id === S.id);
      if (cur) scene.remove(cur.object);
      const h = await makeChar(R, S.weapon !== false); cur = h; scene.add(h.object);
      if (S.disguise) h.setDisguise(true);
      if (S.lod) h.setLOD(S.lod);
      h.object.rotation.y = THREE.MathUtils.degToRad(S.yaw || 0);
      start(h, S.pre || 'idle'); run(h, 0.5);
      h.setAnim(S.clip, { loop: S.loop !== false, speed: S.speed });
      run(h, S.t ?? 0.6, 0);
      const ppm = S.ppm || 200, pitch = THREE.MathUtils.degToRad(S.pitch ?? 40);
      const tgt = new THREE.Vector3(0, S.cy ?? 0.9, 0); const hw = W / 2 / ppm, hh = H / 2 / ppm;
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 200);
      cam.position.set(0, tgt.y + 50 * Math.sin(pitch), 50 * Math.cos(pitch)); cam.lookAt(tgt); cam.updateProjectionMatrix();
      r.render(scene, cam);
      return S.label || (i + '');
    },
  };
}
