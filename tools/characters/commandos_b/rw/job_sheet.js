// job_sheet.js - review tiles of the reworked commandos_b clips (props, seat, carry, deaths), one tile per render.
import { THREE, ROSTER, loadLib, makeChar, loadWeapons, equip } from './common.js';
import { equipProp } from '/chars/commandos_b/pipeline/web/weapons.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const T = (id, clip, t, o = {}) => ({ id, clip, t, ...o });
export const TILES = [
  T('sapper', 'walk_fast', 0.1, { w: 'walther_p38' }), T('sapper', 'run', 0.2, { w: 'walther_p38' }), T('sapper', 'crawl', 0.5), T('sapper', 'plant', 1.2, { p: 'time_bomb' }), T('sapper', 'set_trap', 1.5, { p: 'time_bomb' }), T('sapper', 'cut_wire', 1.0, { p: 'wire_cutters' }), T('sapper', 'throw', 0.35, { p: 'mills_bomb' }), T('sapper', 'dead', 0.5),
  T('driver', 'walk_fast', 0.3, { w: 'thompson' }), T('driver', 'run_fast', 0.15, { w: 'thompson' }), T('driver', 'aim', 0.5, { w: 'thompson' }), T('driver', 'kneel_shoot', 0.5, { w: 'thompson' }), T('driver', 'drive', 0.5, { seat: [0.62, 0.3] }), T('driver', 'sit', 0.5, { seat: [0.46, 0] }), T('driver', 'die_prone', 9), T('driver', 'dead', 0.5),
  T('spy', 'walk_fast', 0.2), T('spy', 'carry_walk', 0.2, { carry: 1 }), T('spy', 'carry_walk', 0.6, { carry: 1, yaw: 90 }), T('spy', 'syringe', 1.0, { p: 'syringe' }), T('spy', 'change_clothes', 1.5), T('spy', 'walk', 0.3, { dis: 1 }), T('spy', 'talk', 1.0, { dis: 1 }), T('spy', 'dead', 0.5),
  T('officer_v00', 'walk', 0.3), T('officer_v00', 'walk_fast', 0.3), T('officer_v00', 'run_slow', 0.2), T('officer_v00', 'smoke', 1.5, { p: 'cigarette' }), T('officer_v00', 'smoke', 3.0, { p: 'cigarette', close: 1 }), T('officer_v00', 'aim', 0.5, { w: 'walther_p38' }), T('officer_v00', 'die', 9), T('officer_v00', 'dead', 0.5),
];
export default async function (canvas, W, H, args) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(-3, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 30 }); sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6f6a55, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = await loadLib({ fix: true }); const Wp = await loadWeapons('/chars/commandos_b/out/weapons/weapons.glb');
  const get = (id) => ROSTER.find(x => x.id === id); let cur = [];
  const tiles = args.only ? TILES.filter((_, i) => args.only.includes(i)) : TILES;
  const render = async (i) => {
    for (const o of cur) scene.remove(o); cur = [];
    const S = tiles[i]; const h = await makeChar(get(S.id), lib, null); scene.add(h.object); cur.push(h.object);
    if (S.dis) h.setDisguise(true);
    h.object.rotation.y = THREE.MathUtils.degToRad(S.yaw ?? 35);
    let v = null; if (S.carry) { v = await makeChar(get('rifleman_v00'), lib, null); scene.add(v.object); cur.push(v.object); }
    h.setAnim(S.clip, { fade: 0 });
    if (S.p) equipProp(h, Wp, S.p, [S.clip]);
    if (v) h.carryBody(v);
    const dur = h.clip(S.clip).duration; const t = Math.min(S.t, dur - 0.02);
    for (let k = 0; k < 10; k++) h.update(t / 10);
    if (S.w) { equip(h, Wp, S.w, { clip: S.clip }); h.update(0); }
    if (S.seat) {   // seat block + floor plate (vehicle-like): cushion at seat[0], floor at seat[1]
      const [sy, fy] = S.seat; const m = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.8 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, sy, 0.5), m); box.position.set(0, sy / 2, -0.05); box.castShadow = box.receiveShadow = true;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.max(fy, 0.01), 1.4), new THREE.MeshStandardMaterial({ color: 0x5b5e4c, roughness: 0.9 })); fl.position.set(0, Math.max(fy, 0.01) / 2, 0.3); fl.receiveShadow = true;
      const g = new THREE.Group(); g.add(box, fl); g.rotation.y = h.object.rotation.y; scene.add(g); cur.push(g);
      h.sitOn(new THREE.Vector3(0, sy, 0).add(new THREE.Vector3(0, 0, -0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y)), { floorY: fy }); h.update(0.001);
    }
    scene.updateMatrixWorld(true);
    const c = h.bones.pelvis.getWorldPosition(new THREE.Vector3()); const fs = S.close ? 0.7 : 2.3;
    const tgt = S.close ? h.bones.Head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, 0)) : new THREE.Vector3(c.x, 0.95, c.z);
    const cam = new THREE.OrthographicCamera(-fs / 2 * W / H, fs / 2 * W / H, fs / 2, -fs / 2, 0.1, 50);
    const el = THREE.MathUtils.degToRad(18); cam.position.set(tgt.x, tgt.y + 10 * Math.sin(el), tgt.z + 10 * Math.cos(el)); cam.lookAt(tgt);
    r.render(scene, cam);
    return `${String(i).padStart(2, '0')}_${S.id.replace('_v00', '')}_${S.clip}${S.p ? '+' + S.p : ''}${S.w ? '+' + S.w : ''}${S.dis ? '+disguise' : ''}${S.carry ? '+body' : ''}`;
  };
  return { count: tiles.length, render };
}
