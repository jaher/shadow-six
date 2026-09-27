import { THREE, ROSTER, group, makeChar } from './common.js';
import { snap, minVertY, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const res = {};
  for (const id of args.ids) {
    const h = await makeChar(ROSTER.find(r => r.id === id)); const out = res[id] = [];
    h.setAnim('idle'); for (let i = 0; i < 30; i++) h.update(1 / 60);
    h.setAnim('die', { loop: false });
    for (let i = 0; i <= 600; i++) { h.update(1 / 60); if (i % 60 === 0) { const s = snap(h); out.push(['die', i / 60, r2(s.pelvis.y), r2(minVertY(h)[0])]); } }
    h.setAnim('dead', { loop: true });
    for (let i = 0; i <= 600; i++) { h.update(1 / 60); if (i % 120 === 0) { const s = snap(h); out.push(['dead', i / 60, r2(s.pelvis.y), r2(minVertY(h)[0])]); } }
  }
  return { count: 0, result: () => res };
}
