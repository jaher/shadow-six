import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWalk, makeRun } from '../ca_loco.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
export default async function (c, W, H, args) {
  const u1 = await new GLTFLoader().loadAsync(U1); const C = {}; for (const c of u1.animations) C[c.name] = c;
  const res = {};
  for (const p of args.walk || []) { const r = makeWalk(u1, C, p); res['walk ' + JSON.stringify(p)] = [r.V0, r.contactFrac, r.dist]; }
  if (args.run) { const r = makeRun(u1, C, {}); res.run = [r.V0, r.contactFrac, r.dist]; }
  return { count: 0, result: () => res };
}
