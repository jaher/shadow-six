// shots2.js - world-frame close-ups through the game runtime. JOB_ARGS {job:'shots2.js', kind, shots:[{id,url,weapon,disguise,clip,t,target:'head'|'chest'|bone,size,views:[[yaw,elev],..]}]}
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeRuntime } from '/chars/fit/rt.js';
const ONCE = new Set(['die', 'dead', 'die_prone', 'dead_prone', 'kneel_shoot']);
export default async function (canvas, W, H) {
  const A = window.__args;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.setScissorTest(true);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.0); scene.add(sun, sun.target); scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.8));
  const RT = await makeRuntime(A.kind); const cache = new Map();
  async function one(i) {
    const s = A.shots[i]; const key = s.url + (s.disguise || '') + (s.weapon || '');
    if (!cache.has(key)) cache.set(key, (await RT.make(s)).h);
    const h = cache.get(key); scene.add(h.object);
    h.setAnim('idle', { fade: 0 }); if ('_prone' in h) h._prone = !!s.prone;
    if (s.prone) { h.setAnim('crawl', { fade: 0 }); h._prone = true; }
    const a = h.setAnim(s.clip, { fade: 0, loop: !ONCE.has(s.clip) });
    const act = (a && a.isAnimationAction) ? a : h.mixer.existingAction(h.clip ? h.clip(s.clip) : RT.lib.clips.get(s.clip));
    if (act) act.time = s.t; h.update(0); h.object.updateMatrixWorld(true);
    const tb = s.target === 'head' ? 'Head' : s.target === 'chest' ? 'spine_03' : s.target;
    const p = Array.isArray(tb) ? new THREE.Vector3(...tb) : h.bones[tb].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, tb === 'Head' ? 0.06 : 0, 0));
    const views = s.views || [[0, 10], [90, 10], [180, 20], [270, 10]]; const tw = W / views.length;
    r.setScissor(0, 0, W, H); r.setViewport(0, 0, W, H); r.setClearColor(0x333333); r.clear();
    views.forEach(([yaw, el], k) => {
      const sz = s.size || 0.35; const cam = new THREE.OrthographicCamera(-sz / 2, sz / 2, sz / 2 * H / tw, -sz / 2 * H / tw, 0.01, 20);
      const y = THREE.MathUtils.degToRad(yaw), e = THREE.MathUtils.degToRad(el);
      const d = new THREE.Vector3(Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e));
      cam.position.copy(p).addScaledVector(d, 3); if (Math.abs(el) > 80) cam.up.set(0, 0, -1); cam.lookAt(p);
      sun.position.copy(p).addScaledVector(d, 3).add(new THREE.Vector3(0, 3, 0)); sun.target.position.copy(p);
      r.setViewport(k * tw, 0, tw, H); r.setScissor(k * tw + 1, 1, tw - 2, H - 2); r.render(scene, cam);
    });
    scene.remove(h.object);
    return { label: s.id, res: { clip: h.animClip || null } };
  }
  return { count: A.shots.length, render: one };
}
