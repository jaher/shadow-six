// poses_b.js - rework clips (commandos_b): prone death, fireman's carry + carried body, sapper trap / wire cutting,
// spy uniform change, corrected kneel. Keyed with poses.js keyedClip on the ORIGINAL UAL frames (CC0, project-authored).
// Directions are character space: +Z forward, +Y up, +X = the character's LEFT.  R() mirrors to the right side.
import { keyedClip } from './poses.js';
const R = (v) => [-v[0], v[1], v[2]];

export function reworkClips(ual, C, X) {   // X: already-built synth clips { carryBase }
  const out = []; const K = (name, o) => out.push(keyedClip(ual, name, o));
  // ---- kneel (right knee down): rear foot toes TUCKED (ankle->ball points back and slightly down), knee on the ground
  const kneel = { thigh_l: [0.12, -0.1, 1], calf_l: [0.05, -1, 0.05], foot_l: [0, -0.25, 1], thigh_r: [-0.12, -1, -0.2], calf_r: [-0.05, -0.12, -1], foot_r: [0, -0.55, -0.85] };
  K('kneel_shoot', { base: C.Idle_Loop, upper: C.Pistol_Aim_Neutral, keys: [{ t: 0, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }, { t: 1.2, base_t: 1.2, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }, { t: 2.4, base_t: 2.4, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }], meta: { pose: 'kneel' } });

  // ---- prone death: part of the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
  //     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)

  // ---- fireman's carry (Spy / Green Beret body carry): victim over the RIGHT shoulder, right arm wrapped round the
  //      back of his knees, left hand holding his dangling wrist in front; carrier leans forward and away from the load
  const fc = { upperarm_r: R([-0.05, 0.25, 1]), lowerarm_r: R([-0.75, 0.6, 0.25]), hand_r: R([-0.6, 0.75, -0.1]),
    upperarm_l: [0.12, -0.85, 0.45], lowerarm_l: [-0.55, -0.15, 0.85], hand_l: [-0.7, -0.1, 0.7] };
  const lean = [11, 0, 5], hd = [-6, 0, 4];
  K('carry_idle', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, dirs: fc, spine: lean, head: hd, pelvisY: -0.015 }, { t: 1.25, base_t: 1.25, dirs: fc, spine: [12, 0, 5], head: hd, pelvisY: -0.02 }, { t: 2.5, base_t: 2.5, dirs: fc, spine: lean, head: hd, pelvisY: -0.015 }], meta: { carry: 'fireman' } });
  const cb = X.carryBase, D = cb.duration;
  const fk = []; for (let i = 0, n = Math.round(D * 30); i <= n; i++) fk.push({ t: (i / n) * D, base_t: (i / n) * D, dirs: fc, spine: lean, head: hd });   // per-frame keys: no ease time-warp
  K('carry_walk', { base: cb, keys: fk, meta: { carry: 'fireman', groundSpeed: cb.userData.groundSpeed, loco: true } });
  // carried body (victim's own clip): folded at the belly over a shoulder, torso and arms hanging down one side,
  // legs down the other. Placed by charkit.carryBody() so that his pelvis rides on the carrier's right shoulder.
  const hang = { upperarm_l: [0.15, -1, 0.1], lowerarm_l: [0.05, -1, 0.05], hand_l: [0, -1, 0], upperarm_r: R([0.1, -1, 0.15]), lowerarm_r: R([0.02, -1, 0.1]), hand_r: R([0, -1, 0]),
    thigh_l: [0.06, -0.55, -1], calf_l: [0.04, -1, -0.15], foot_l: [0, -0.3, -1], thigh_r: R([0.02, -0.5, -1]), calf_r: R([0.03, -1, -0.2]), foot_r: R([0, -0.3, -1]) };
  K('carried', { base: C.Idle_Loop, keys: [{ t: 0, pelvisPitch: 150, dirs: hang, head: [30, 0, 0] }, { t: 1, pelvisPitch: 152, dirs: hang, head: [30, 0, 0] }, { t: 2, pelvisPitch: 150, dirs: hang, head: [30, 0, 0] }], meta: { carriedPivot: 'pelvis' } });

  // ---- sapper: set a trap / mine on one knee, both hands working on the ground in front
  const tr0 = { ...kneel, upperarm_l: [0.2, -0.75, 0.6], lowerarm_l: [-0.05, -0.8, 0.6], hand_l: [-0.1, -0.7, 0.7], upperarm_r: R([0.2, -0.75, 0.6]), lowerarm_r: R([-0.05, -0.8, 0.6]), hand_r: R([-0.1, -0.7, 0.7]) };
  const tr1 = { ...tr0, lowerarm_l: [-0.15, -0.85, 0.45], lowerarm_r: R([0.1, -0.75, 0.7]) };
  K('set_trap', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.6, pelvisY: -0.42, dirs: tr0, spine: [38, 0, 0], head: [18, 0, 0] },
    { t: 1.3, pelvisY: -0.42, dirs: tr1, spine: [40, 0, 0], head: [20, 0, 0] }, { t: 2.0, pelvisY: -0.42, dirs: tr0, spine: [38, 0, 0], head: [20, 0, 0] },
    { t: 2.7, pelvisY: -0.42, dirs: tr1, spine: [40, 0, 0], head: [20, 0, 0] }, { t: 3.4, base_t: 0.5 }], meta: { props: { r: 'time_bomb' } } });
  // ---- sapper: cut a wire fence, kneeling, cutters in both hands at knee-to-waist height, three cuts
  const cw0 = { ...kneel, upperarm_r: R([0.12, -0.55, 0.85]), lowerarm_r: R([-0.3, 0.05, 1]), hand_r: R([-0.3, 0.1, 1]),
    upperarm_l: [0.1, -0.6, 0.8], lowerarm_l: [-0.35, 0.02, 1], hand_l: [-0.3, 0.1, 1] };
  const cw1 = { ...cw0, lowerarm_r: R([-0.12, 0.08, 1]), lowerarm_l: [-0.15, 0.06, 1] };
  const cuts = []; for (let i = 0; i < 3; i++) cuts.push({ t: 0.8 + i * 0.7, pelvisY: -0.42, dirs: cw0, spine: [16, 0, 0], head: [10, 0, 0] }, { t: 1.1 + i * 0.7, pelvisY: -0.42, dirs: cw1, spine: [18, 0, 0], head: [10, 0, 0] });
  K('cut_wire', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.5, pelvisY: -0.42, dirs: cw0, spine: [16, 0, 0], head: [10, 0, 0] }, ...cuts, { t: 3.3, pelvisY: -0.42, dirs: cw0, spine: [14, 0, 0] }, { t: 3.9, base_t: 0.5 }], meta: { props: { r: 'wire_cutters' } } });

  // ---- spy: change into / out of the uniform (3.4 s). charkit swaps the disguise meshes at meta.swapAt.
  const chest = { upperarm_l: [0.3, -0.8, 0.35], lowerarm_l: [-0.7, 0.45, 0.45], hand_l: [-0.7, 0.5, 0.3], upperarm_r: R([0.3, -0.8, 0.35]), lowerarm_r: R([-0.7, 0.45, 0.45]), hand_r: R([-0.7, 0.5, 0.3]) };
  const shrug = { upperarm_l: [0.35, -0.75, -0.55], lowerarm_l: [0.1, -0.9, -0.4], upperarm_r: R([0.35, -0.75, -0.55]), lowerarm_r: R([0.1, -0.9, -0.4]) };
  const low = { upperarm_l: [0.15, -0.8, 0.55], lowerarm_l: [0, -0.8, 0.6], upperarm_r: R([0.15, -0.8, 0.55]), lowerarm_r: R([0, -0.8, 0.6]) };
  const sleeve = { upperarm_l: [0.55, 0.2, 0.8], lowerarm_l: [0.3, 0.3, 1], upperarm_r: R([0.3, -0.7, -0.6]), lowerarm_r: R([0.2, -0.6, -0.8]) };
  const collar = { upperarm_l: [0.55, -0.35, 0.6], lowerarm_l: [-0.55, 0.8, 0.1], hand_l: [-0.5, 0.8, -0.1], upperarm_r: R([0.55, -0.35, 0.6]), lowerarm_r: R([-0.55, 0.8, 0.1]), hand_r: R([-0.5, 0.8, -0.1]) };
  K('change_clothes', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.45, dirs: chest, head: [22, 0, 0] }, { t: 0.95, dirs: chest, head: [24, 5, 0] },
    { t: 1.4, dirs: shrug, spine: [8, 0, 0], head: [5, 0, 0] }, { t: 1.9, dirs: low, spine: [45, 0, 0], head: [15, 0, 0], pelvisY: -0.1 },
    { t: 2.4, dirs: sleeve, spine: [10, -10, 0] }, { t: 2.9, dirs: collar, head: [8, 0, 0] }, { t: 3.4, base_t: 1.0 }], meta: { swapAt: 1.95 } });
  return out;
}
