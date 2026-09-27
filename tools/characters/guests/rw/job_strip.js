// job_strip.js - review strips of the guest rework clips: one tile per render (row r, frame f), side view, with
// stand-in vehicle blocks (raft tubes, truck bed + step, Kubelwagen side/floor/seat). Composed by sheet.py.
import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export const ROWS = [
  { id: 'mcrae', clip: 'go_prone', then: 'crawl', view: 'side', cz: 0.2 },
  { id: 'mcrae', clip: 'get_up', from: 'crawl_idle', view: 'side', cz: 0.2 },
  { id: 'informer', clip: 'die_run', from: 'run', view: 'side', cz: 0.8 },
  { id: 'gilbert', clip: 'board_boat', view: 'side', cz: 0.6, prop: 'raft', extra: 1 },
  { id: 'prisoner_farmhand', clip: 'board_truck', view: 'side', cz: 0.6, prop: 'truck', extra: 1 },
  { id: 'civ_tram_driver', clip: 'board_car', view: 'side3', cz: 0.4, prop: 'car', extra: 1 },
  { id: 'prisoner_oldman', clip: 'tied_walk', speed: 2.25, view: 'side', cz: 0 },
  { id: 'prisoner_clerk', clip: 'follow_walk', speed: 2.25, view: 'side', cz: 0 },
  { id: 'mcrae', clip: 'crawl', speed: 0.9, view: 'side', cz: 0.1 },
];
const NF = 7;
function props(kind) {
  const g = new THREE.Group(); const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const box = (w, h, d, x, y, z, c) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c)); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); };
  if (kind === 'raft') {
    for (const z of [0.475, 1.95]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 2.4, 20), m(0x3b3a33)); t.rotation.z = Math.PI / 2; t.position.set(0, 0.19, z); t.castShadow = t.receiveShadow = true; g.add(t); }
    box(2.4, 0.05, 1.3, 0, 0.025, 1.2, 0x44443c);
  }
  if (kind === 'truck') { box(2.2, 1.05, 2.6, 0, 0.525, 0.5 + 1.3, 0x4d5040); box(1.6, 0.06, 0.2, 0, 0.52, 0.3, 0x2e2e2a); }
  if (kind === 'car') { box(2.6, 0.45, 0.08, 0.3, 0.225, 0.36, 0x6b6450); box(2.6, 0.2, 1.1, 0.3, 0.1, 0.95, 0x55503f); box(0.5, 0.12, 0.5, 0.06, 0.49, 0.62, 0x3e3a2e); box(0.08, 0.5, 0.5, -0.2, 0.8, 0.62, 0x3e3a2e); }
  return g;
}
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(4, 8, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 30 }); sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = await loadLib(); const cache = {};
  const rows = args.rows ? ROWS.filter((_, i) => args.rows.includes(i)) : ROWS;
  let cur = [];
  const render = async (k) => {
    const ri = Math.floor(k / NF), f = k % NF, S = rows[ri];
    for (const o of cur) scene.remove(o); cur = [];
    const R = ROSTER.find(x => x.id === S.id); const h = await makeChar(R, lib, null); scene.add(h.object); cur.push(h.object);
    if (S.prop) { const p = props(S.prop); scene.add(p); cur.push(p); }
    const dur = h.clip(S.clip).duration; const loco = !!S.speed;
    let span = dur + (S.extra ? 0.6 : 0);
    if (loco) { const a = h.setAnim(S.clip, { fade: 0, speed: S.speed }); span = h.clip(h.animClip).duration / a.getEffectiveTimeScale(); }
    if (S.from) { h.setAnim(S.from, { fade: 0 }); h.update(0.3); }
    h.setAnim(S.clip, loco ? { fade: 0, speed: S.speed } : { fade: S.from ? 0.15 : 0, loop: false });
    const t = (f / (NF - 1)) * span * (loco ? (NF - 1) / NF : 1); const n = Math.max(1, Math.ceil(t / (1 / 60)));
    for (let i = 0; i < n; i++) h.update(t / n);
    scene.updateMatrixWorld(true);
    const fs = 2.5, cz = S.cz; const tgt = new THREE.Vector3(0, 1.05, cz);
    const cam = new THREE.OrthographicCamera(-fs / 2 * W / H, fs / 2 * W / H, fs / 2, -fs / 2, 0.1, 50);
    const dir = S.view === 'side3' ? new THREE.Vector3(1, 0.25, 0.9).normalize() : new THREE.Vector3(1, 0.18, 0.12).normalize();
    cam.position.copy(tgt).addScaledVector(dir, 10); cam.lookAt(tgt);
    r.render(scene, cam);
    return `r${ri}_f${f}`;
  };
  return { count: rows.length * NF, render };
}
