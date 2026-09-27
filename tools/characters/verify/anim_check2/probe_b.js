import { THREE, ROSTER, group, makeChar } from './common.js';
export default async function (canvas, W, H, args) {
  const res = {};
  for (const id of args.ids) { const h = await makeChar(ROSTER.find(r => r.id === id)); const s = h.weapon && h.weapon.userData.sockets;
    res[id] = { w: h.weapon && h.weapon.name, sockets: s && Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && (v.type || typeof v)])), bones: typeof h.bones.upperarm_r, B: h.bones.upperarm_r && h.bones.upperarm_r.type }; }
  return { count: 0, result: () => res };
}
