// job_sheet2.js - r8 verification tiles: crawl / drag / crouch_fast with CONTACT TRAILS (root moved at game speed;
// a dot per frame where the effector is in its lowest 4 cm -> a planted hand/foot shows as one tight cluster, a
// skating one as a smear), stab lunge toe, prone deaths. Side views unless yaw given.
import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const T = (id, clip, o = {}) => ({ id, clip, ...o });
export const TILES = [
  T('sapper', 'crawl', { v: 0.9, trail: ['hand_l', 'hand_r'], yaw: 90 }), T('driver', 'crawl', { v: 0.9, trail: ['hand_l', 'hand_r'], yaw: 90 }),
  T('spy', 'crawl', { v: 0.9, trail: ['hand_l', 'hand_r'], yaw: 90 }), T('driver_burns', 'crawl', { v: 0.9, t: 0.6, yaw: 35 }),
  T('sapper', 'drag', { v: 1.6, trail: ['ball_l', 'ball_r'], yaw: 90 }), T('driver', 'drag', { v: 1.6, trail: ['ball_l', 'ball_r'], yaw: 90 }),
  T('spy', 'drag', { v: 1.6, trail: ['ball_l', 'ball_r'], yaw: 90 }), T('spy', 'drag', { v: 1.6, t: 0.5, yaw: 35 }),
  T('sapper', 'crouch_walk', { v: 2.25, trail: ['ball_l', 'ball_r'], yaw: 90 }), T('spy', 'crouch_walk', { v: 2.25, t: 0.3, yaw: 35 }),
  T('sapper', 'stab', { t: 0.45, yaw: 90 }), T('spy', 'stab', { t: 0.45, yaw: 35 }),
  T('sapper', 'die_prone', { t: 9, yaw: 35, from: 'crawl' }), T('driver', 'dead_prone', { t: 0.3, yaw: 90 }), T('spy', 'dead_prone', { t: 0.3, yaw: 35 }), T('spy', 'crawl_idle', { t: 0.5, yaw: 60 }),
];
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-3, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 }); sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = await loadLib({ fix: true });
  const get = (id) => ROSTER.find(x => x.id === id); let cur = []; const res = {};
  const cols = [0xff3030, 0x30a0ff];
  const render = async (i) => {
    for (const o of cur) scene.remove(o); cur = [];
    const S = TILES[i]; const h = await makeChar(get(S.id), lib, null); scene.add(h.object); cur.push(h.object);
    const yaw = THREE.MathUtils.degToRad(S.yaw ?? 35); h.object.rotation.y = yaw;
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const m = lib.meta[S.clip] || {}; const dir = m.moveDir || (m.reverse ? -1 : 1);
    if (S.from) { h.setAnim(S.from, { fade: 0 }); for (let k = 0; k < 20; k++) h.update(1 / 60); h.setAnim('die', { loop: false }); }
    else h.setAnim(S.clip, { fade: 0, loop: m.loop !== false, ...(S.v ? { speed: S.v } : {}) });
    const cn = h.animClip; const a = h.mixer.existingAction(h.clip(cn)); const ts = a ? a.getEffectiveTimeScale() : 1;
    const cyc = h.clip(cn).duration / ts; const dur = S.trail ? cyc * 2 : Math.min(S.t, h.clip(cn).duration / ts - 0.02);
    const pts = {}; (S.trail || []).forEach(n => pts[n] = []);
    const n = Math.max(1, Math.round(dur * 60)); const p0 = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      h.update(1 / 60); if (S.v) h.object.position.addScaledVector(fwd, S.v * dir / 60);
      h.object.updateMatrixWorld(true);
      for (const b of S.trail || []) pts[b].push(h.bones[b].getWorldPosition(new THREE.Vector3()));
    }
    const stats = {};
    for (const [bi, b] of (S.trail || []).entries()) {
      const P = pts[b]; const mn = Math.min(...P.map(p => p.y)); const g = new THREE.SphereGeometry(0.012, 6, 4); const mat = new THREE.MeshBasicMaterial({ color: cols[bi] });
      let sum = 0, c = 0;
      P.forEach((p, k) => { if (p.y > mn + 0.04) return; const s = new THREE.Mesh(g, mat); s.position.set(p.x, 0.005, p.z); scene.add(s); cur.push(s);
        if (k && P[k - 1].y <= mn + 0.04) { sum += Math.hypot(p.x - P[k - 1].x, p.z - P[k - 1].z) * 60; c++; } });
      stats[b] = +(sum / Math.max(1, c)).toFixed(3);
    }
    res[i] = { id: S.id, clip: cn, ts: +ts.toFixed(2), spm: Math.round(120 / cyc), slide: stats };
    scene.updateMatrixWorld(true);
    const c = h.bones.pelvis.getWorldPosition(new THREE.Vector3()); const prone = /crawl|prone/.test(cn); const fs = prone ? 1.9 : 2.3;
    const tgt = new THREE.Vector3(c.x, prone ? 0.35 : 0.95, c.z);
    const cam = new THREE.OrthographicCamera(-fs / 2 * W / H, fs / 2 * W / H, fs / 2, -fs / 2, 0.1, 50);
    const el = THREE.MathUtils.degToRad(prone ? 30 : 15); cam.position.set(tgt.x, tgt.y + 10 * Math.sin(el), tgt.z + 10 * Math.cos(el)); cam.lookAt(tgt);
    r.render(scene, cam);
    return `${String(i).padStart(2, '0')}_${S.id}_${cn}${S.v ? '@' + S.v : ''}${S.trail ? '_trail' : ''}`;
  };
  return { count: TILES.length, render, result: () => res };
}
