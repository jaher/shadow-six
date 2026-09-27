// job_game.js - guests in the game camera (ortho, pitch 40, yaw 0): Gilbert + 4 in single file (follow_walk, 1.0 m
// spacing), McRae crawling, the Informer dead after die_run, two prisoners sitting in the raft. args.px = CSS px per metre.
import { THREE, ROSTER, loadLib, makeChar, orthoCam } from './common.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7d7a66);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.4;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.7); sun.position.set(-6, 12, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 60 }); sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.55));
  const gm = new THREE.MeshStandardMaterial({ color: 0x6d6a52, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), gm); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8, 30), new THREE.MeshStandardMaterial({ color: 0x3d4a48, roughness: 0.25, metalness: 0.1 })); water.rotation.x = -Math.PI / 2; water.position.set(7.2, 0.01, 0); scene.add(water);
  const lib = await loadLib(); const R = (id) => ROSTER.find(x => x.id === id);
  const put = async (id, x, z, yaw, fn) => { const h = await makeChar(R(id), lib, null); h.autoLOD(args.px || 80); h.object.position.set(x, 0, z); h.object.rotation.y = THREE.MathUtils.degToRad(yaw); scene.add(h.object); await fn(h); return h; };
  const step = (h, t) => { const n = Math.max(1, Math.round(t * 60)); for (let i = 0; i < n; i++) h.update(t / n); };
  // single file: leader Gilbert walking north-east, the four at 1.0 m behind each other (phase offsets)
  const line = ['gilbert', 'prisoner_farmhand', 'prisoner_worker', 'prisoner_oldman', 'prisoner_clerk'];
  const dir = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(145)), 0, Math.cos(THREE.MathUtils.degToRad(145)));
  for (let i = 0; i < line.length; i++) {
    const p = new THREE.Vector3(-1.2, 0, 0.6).addScaledVector(dir, -i * 1.0);
    await put(line[i], p.x, p.z, 145, async (h) => { h.setFollowing(i > 0); h.setAnim(i ? 'walk' : 'walk', { fade: 0, speed: 2.25 }); step(h, 0.23 * i + 0.1); });
  }
  await put('mcrae', -4.2, -1.2, 70, async (h) => { h.setAnim('crawl', { fade: 0, speed: 0.9 }); step(h, 0.35); });
  await put('informer', 1.2, -2.6, 200, async (h) => { h.setAnim('run', { fade: 0, speed: 4.5 }); step(h, 0.3); h.setAnim('die'); step(h, 1.3); h.setAnim('dead'); step(h, 0.2); });
  // raft on the water's edge, two sitting in it
  const raft = new THREE.Group(); const rm = new THREE.MeshStandardMaterial({ color: 0x34352e, roughness: 0.7 });
  for (const z of [-0.95, 0.95]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 3.2, 20), rm); t.rotation.z = Math.PI / 2; t.position.set(0, 0.19, z); t.castShadow = true; raft.add(t); }
  for (const x of [-1.6, 1.6]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 1.9, 20), rm); t.rotation.x = Math.PI / 2; t.position.set(x, 0.19, 0); t.castShadow = true; raft.add(t); }
  const fl = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 1.9), rm); fl.position.y = 0.03; fl.receiveShadow = true; raft.add(fl);
  raft.position.set(4.6, 0.02, 0.6); scene.add(raft);
  await put('prisoner_worker', 4.0, 0.9, 90, async (h) => { h.setAnim('boat_sit', { fade: 0 }); step(h, 0.4); });
  await put('prisoner_clerk', 5.1, 0.25, 90, async (h) => { h.setAnim('boat_sit', { fade: 0 }); step(h, 1.0); });
  const px = args.px || 80; const cam = orthoCam(W, H, px, new THREE.Vector3(args.cx ?? 0.4, 0.5, args.cz ?? -0.4));
  scene.traverse(o => { if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false; });
  return { count: 1, render: async () => { r.render(scene, cam); return 'game_' + px; } };
}
