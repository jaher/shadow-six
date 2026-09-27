import { THREE, ROSTER, makeChar } from './common.js';
import { snap, minVertY, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const res = {};
  for (const [id, c] of args.pairs) { const h = await makeChar(ROSTER.find(r => r.id === id)); h.setAnim('idle'); for (let i = 0; i < 30; i++) h.update(1 / 60);
    h.setAnim(c, { loop: false }); const out = []; for (let i = 1; i <= 150; i++) { h.update(1 / 60); if (i % 10 === 0) { const v = minVertY(h); out.push([r2(i / 60, 2), r2(v[0]), v[2], r2(snap(h).pelvis.y)]); } }
    res[id + ':' + c] = out; }
  return { count: 0, result: () => res };
}
