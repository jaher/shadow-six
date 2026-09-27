import { THREE, loadLib, makeChar, ROSTER } from './common.js';
import { run, start, slide, r2 } from './metrics.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resampleLoco } from '/chars/commandos_b/pipeline/web/synth.js';
import { adaptClip } from '/chars/commandos_b/pipeline/web/charkit.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
export default async function (canvas, W, H, args) {
  const u1 = await new GLTFLoader().loadAsync(U1); const C = {}; for (const c of u1.animations) C[c.name] = c;
  const lib = await loadLib(); const specs = args.specs;
  const res = {};
  for (const sp of specs) {
    const t0 = performance.now();
    const c = resampleLoco(u1.scene, adaptClip(C[sp.src]), sp); lib.clips.set(sp.name, c); lib.meta[sp.name] = { groundSpeed: sp.v, loop: true };
    res[sp.name] = { ud: c.userData, ms: Math.round(performance.now() - t0) };
  }
  const h = await makeChar(ROSTER.find(r => r.id === (args.char || 'sapper')), lib, null);
  for (const sp of specs) for (const v of sp.test || [sp.v]) {
    h.object.position.set(0, 0, 0); const a = start(h, sp.name, { speed: v }); const ts = a.getEffectiveTimeScale(); const cy = h.clip(sp.name).duration / ts;
    const fr = run(h, cy * 2, v); const s = slide(fr, ['ball_l', 'ball_r', 'foot_l', 'foot_r']);
    res[sp.name]['v' + v] = { ts: r2(ts, 2), spm: Math.round(120 / cy), slide: Object.fromEntries(Object.entries(s).map(([k, x]) => [k, [x.slide, x.fwd, x.minY]])), pelvis: [r2(Math.min(...fr.map(f => f.pelvis.y)), 2), r2(Math.max(...fr.map(f => f.pelvis.y)), 2)] };
  }
  return { count: 0, result: () => res };
}
