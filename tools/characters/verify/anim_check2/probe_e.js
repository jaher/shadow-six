import { THREE, group, spawnSquadMember, assignSquadVariants } from './common.js';
export default async function (canvas, W, H, args) {
  const E = (await group('enemy')).E; const types = ['rifleman', 'rifleman', 'trooper', 'sergeant', 'mg', 'officer'];
  const spawns = types.map((t, i) => ({ id: 'p' + i, type: t, squad: 'B', x: i * 3, z: 0 })); const picks = assignSquadVariants('pr', spawns, E.variantsByType);
  const acc = {}; const hs = [];
  for (const s of spawns) { const h = await spawnSquadMember(E, 'pr', s, picks.get(s.id)); h.setAnim(s.id === 'p1' ? 'walk' : 'idle', { speed: 0.9 }); hs.push(h);
    h._post = h._post.map((fn, k) => { const key = k + ':' + fn.toString().replace(/\s+/g, ' ').slice(0, 70); return (dt) => { const t = performance.now(); const r = fn(dt); acc[key] = (acc[key] || 0) + performance.now() - t; return r; }; }); }
  let tot = 0; for (let f = 0; f < 240; f++) for (const h of hs) { const t = performance.now(); h.update(1 / 60); tot += performance.now() - t; }
  const res = { perEnemyTotal: tot / 240 / hs.length, post: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +(v / 240 / hs.length).toFixed(4)])) };
  return { count: 0, result: () => res };
}
