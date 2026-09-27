import { THREE, ROSTER, ENEMY_CLIPS, group, makeChar } from './common.js';
import { snap, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const res = {};
  for (const id of args.ids) {
    const R = ROSTER.find(r => r.id === id); const out = res[id] = {};
    for (const c of ENEMY_CLIPS) {
      const h = await makeChar(R); h.setAnim('idle'); for (let i = 0; i < 20; i++) h.update(1 / 60);
      const loop = !/^(die|dead|shoot|rifle_shoot|detonate|hit|reload|salute|surrender)$/.test(c) || c === 'dead';
      h.setAnim(c, { loop }); const ys = [];
      for (let i = 1; i <= 240; i++) { h.update(1 / 60); if (i === 30 || i === 120 || i === 240) ys.push(r2(snap(h).pelvis.y, 2)); }
      out[c] = ys; h.object.removeFromParent();
    }
  }
  return { count: 0, result: () => res };
}
