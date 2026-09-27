import { THREE, ROSTER, group, makeChar } from './common.js';
import { snap, run, start, r2 } from './metrics.js';
const J = ['pelvis', 'Head', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'upperarm_r', 'clavicle_r', 'spine_03'];
const acts = (h) => h.mixer._actions.filter(a => a.isRunning()).map(a => a.getClip().name + ':' + r2(a.getEffectiveWeight(), 2) + '@' + r2(a.time, 2)).join(' ');
export default async function (canvas, W, H, args) {
  const res = {};
  for (const id of args.ids) {
    const R = ROSTER.find(r => r.id === id); const h = await makeChar(R); const out = res[id] = { aim: [], rdie: [] };
    start(h, 'idle'); run(h, 0.6); h.setAnim('aim', { loop: true });
    let prev = snap(h);
    for (let i = 0; i < 20; i++) { run(h, 1 / 60 - 1e-6); h.update(0); const s = snap(h); let mx = 0, at = '';
      for (const j of J) { const a = s[j].clone().sub(s.pelvis), b = prev[j].clone().sub(prev.pelvis); const d = a.distanceTo(b); if (d > mx) { mx = d; at = j; } }
      out.aim.push([i, r2(mx), at, acts(h)]); prev = s; }
    start(h, 'run'); run(h, 0.5); h.setAnim('die', { loop: false });
    for (let i = 0; i < 150; i += 1) { h.update(1 / 60); if (i % 10 === 0) { const s = snap(h); out.rdie.push([i, r2(s.pelvis.y), r2(s.Head.y), acts(h)]); } }
    h.setAnim('dead', { loop: true }); for (let i = 0; i < 30; i++) h.update(1 / 60); const s = snap(h); out.rdie.push(['dead', r2(s.pelvis.y), r2(s.Head.y), acts(h)]);
  }
  return { count: 0, result: () => res };
}
