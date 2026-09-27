// strip_page.js - browser side of strips.mjs: renders frame strips of a character clip (side / top / 3/4 views) with
// the real character library (humanoid-real: per-body prone fit, weapon grips) on a flat ground. CC0 project code.
import * as THREE from 'three';
import * as HR from '/src/art/humanoid-real.js';

let R = null;
function renderer(w, h) {
  if (!R) { R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; }
  R.setSize(w, h, false); R.setPixelRatio(1);
  return R;
}

/**
 * @param {{who:object, clip:string, n?:number, dur?:number|null, w?:number, h?:number, views?:string[], span?:number}} o
 * @returns {Promise<string[][]>} data URLs per view per frame
 */
export async function strips(o) {
  await HR.loadCharacterLibrary();
  const m = HR.createRealHumanoid(o.who);
  await m.ready;
  if (o.weapon !== undefined) m.setWeapon(o.weapon);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe3e6);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x8c8a74, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const grid = new THREE.GridHelper(12, 60, 0x6f6d5c, 0x7b7968); grid.position.y = 0.001; scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 6, 2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 }); scene.add(sun);
  scene.add(m.root);
  m.root.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.frustumCulled = false; } });
  m.setLOD(200);
  m.setAnim(o.clip, { fade: 0, loop: true });
  const inner = m.inner, act = inner._clipAct || [...(inner._acts || new Map()).keys()].pop() || null;
  const clip = inner.clip ? inner.clip(inner.animClip || inner._clipName || o.clip) : null;
  const dur = o.dur ?? (clip ? clip.duration : 1), n = o.n ?? 8, w = o.w ?? 320, h = o.h ?? 200, span = o.span ?? 2.3;
  const rr = renderer(w, h), out = {};
  for (let i = 0; i < 6; i++) inner.update(0.1);   // settle hold blends (commandos_a slides the gun between holds over 0.3 s)
  const cams = {
    side: () => { const c = new THREE.OrthographicCamera(-span / 2, span / 2, span * h / w / 2, -span * h / w / 2, 0.1, 20); c.position.set(4, 0.32, 0.12); c.lookAt(0, 0.32, 0.12); return c; },
    top: () => { const c = new THREE.OrthographicCamera(-span / 2, span / 2, span * h / w / 2, -span * h / w / 2, 0.1, 20); c.position.set(0, 5, 0.1); c.up.set(1, 0, 0); c.lookAt(0, 0, 0.1); return c; },
    front: () => { const c = new THREE.PerspectiveCamera(30, w / h, 0.1, 30); c.position.set(-1.6, 1.3, 2.6); c.lookAt(0, 0.2, 0.15); return c; },
  };
  for (const v of o.views || ['side']) {
    const cam = cams[v](); out[v] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * dur;
      inner.mixer.setTime(t);
      if (inner.update) inner.update(0);
      m.root.updateMatrixWorld(true);
      rr.render(scene, cam);
      out[v].push(rr.domElement.toDataURL('image/png'));
    }
  }
  const res = { views: out, weapon: m.weaponName(), clip: inner.animClip || inner._clipName };
  m.dispose();
  return res;
}

/**
 * In-game frames: a unit crawls in a real mission under the game camera (zoom 1 / 2); crops around it every
 * `every` s of game time. o: {mission, pick:{role}|{enemy:index}, zoom, n, every, crop:[w,h] css px, tool, dir:[dx,dz]}
 */
export async function gameStrip(o) {
  const g = window.__game, G = g.game;
  if (!G.world || G.missionDef?.id !== o.mission) { await g.loadMission(o.mission); g.start(); }
  const w = G.world, R = G.renderer;
  for (const e of w.enemies) if (e.brain) e.brain.frozen = true;
  const u = o.pick.role ? w.commandos.find((c) => c.role === o.pick.role) : w.enemies.filter((e) => e.soldierType !== 'dog')[o.pick.enemy || 0];
  if (o.at) u.setPosition(o.at[0], o.at[1], o.heading ?? u.heading);
  if (o.near) { const c = w.commandos.find((x) => x.role === o.near[0]); u.setPosition(c.x + o.near[1], c.z + o.near[2], 0); }
  if (o.clear) for (const c of w.commandos) if (c !== u && Math.hypot(c.x - u.x, c.z - u.z) < 8) c.setPosition(c.x - 12, c.z - 12);   // nobody in shot
  u.path = null; u.stop?.();
  u.readyTool = o.tool || null;
  const tick = (k) => { for (let i = 0; i < k; i++) { g.step(); G.render(1 / 60, 1); } };
  u.setStance('crawl'); tick(50);
  const d = o.dir || [1, 0];
  u.moveTo(u.x + d[0] * 20, u.z + d[1] * 20); tick(70);
  g.setZoom(o.zoom); 
  const gl = R.renderer.getContext(), el = R.domElement, rect = el.getBoundingClientRect(), k = gl.drawingBufferWidth / el.clientWidth;
  const [cw, ch] = (o.crop || [220, 130]).map((v) => Math.round(v * o.zoom * k));
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const ctx = cv.getContext('2d');
  const out = [];
  for (let i = 0; i < (o.n || 8); i++) {
    tick(i ? Math.round((o.every || 0.125) * 60 * (i + 1)) - Math.round((o.every || 0.125) * 60 * i) : 1);
    g.centerOn(u.x, u.z); G.render(0, 1);
    const s = G.cameraController.worldToScreen(u.object3d.position.x, u.object3d.position.y + 0.15, u.object3d.position.z);
    const x0 = Math.round((s.x - rect.left) * k - cw / 2), y0 = Math.round(gl.drawingBufferHeight - (s.y - rect.top) * k - ch / 2);
    const px = new Uint8Array(cw * ch * 4); R.renderer.setRenderTarget(null); gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const img = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) img.data.set(px.subarray((ch - 1 - y) * cw * 4, (ch - y) * cw * 4), y * cw * 4);
    ctx.putImageData(img, 0, 0); out.push(cv.toDataURL('image/png'));
  }
  const m = u.model;
  return { views: { game: out }, weapon: m.real?.weaponName?.() || null, clip: m.clip };
}
