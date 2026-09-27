// guest_board.js - boarding clips for the guests (M17: raft + truck, M12: Kubelwagen, M10: McRae into the Ju 52 door).
// Key poses on UAL frames (guest_synth.poseClip), limbs IK-planted on the vehicle. Each boarding clip ends exactly in
// the first frame of its `next` clip displaced by meta.travel (character space, metres) and turned by meta.travelYaw
// (deg); guestkit.js moves/turns the root by that amount when the clip ends and starts `next` with no fade.
// Vehicle dimensions assumed (character space, +Z = toward the vehicle, start standing at the origin):
//   raft: near tube z 0.35-0.6, tube top y 0.38, floor y 0.05      -> board_boat -> boat_sit (sits on the floor, knees up)
//   truck (Opel Blitz): bed floor y 1.05 at z >= 0.5, rear step y 0.55 at z 0.3 -> board_truck -> idle (on the bed)
//   car (Kubelwagen, from its side, car forward = +X): sill y 0.45 at z 0.35, floor y 0.2, seat y 0.55 at z 0.65
//        -> board_car (turns 90 deg while sitting down) -> sit     (charkit.sitOn(seat,{floorY}) then fits the seat)
import { poseClip } from './guest_synth.js';

export function boardClips(U, C, L) {
  const I = C.Idle_Loop, S = L.get('sit') || C.Sitting_Idle_Loop, out = [];
  // ---- raft: sit on the floor, knees up, hands on the side tubes (slow breathing from Sitting_Idle)
  const bs = (t) => ({ t, src: [S, t], pel: [0, 0.2, 0], foot_l: [0.17, 0.07, 0.52], foot_r: [-0.17, 0.07, 0.5], hand_l: [0.36, 0.3, 0.02], hand_r: [-0.36, 0.3, 0.02], spine: [6, 0, 0], ease: 'lin' });
  const dS = S.duration; const sitKeys = []; for (let i = 0; i <= 8; i++) sitKeys.push(bs((i / 8) * dS));
  sitKeys[8] = { ...sitKeys[0], t: dS };
  out.push(poseClip(U, 'boat_sit', sitKeys, { loop: true, easeEnds: false, meta: { seat: 'raft floor', pelvisOverFloor: 0.2 } }));
  const tb = [0, 0, 0.8];   // travel: seated 0.8 m ahead (inside the raft)
  const at = (p) => [p[0] + tb[0], p[1] + tb[1], p[2] + tb[2]];
  out.push(poseClip(U, 'board_boat', [
    { t: 0, src: [I, 0], foot_l: 'src', foot_r: 'src' },
    { t: 0.4, src: [I, 0.4], pel: [-0.04, 0.9, 0.1], foot_l: [0.14, 0.52, 0.42], foot_r: 'src', spine: [6, 0, 0] },
    { t: 0.8, src: [I, 0.8], pel: [0, 0.8, 0.46], foot_l: [0.16, 0.07, 0.8], foot_r: [-0.22, 0.1, 0.26], spine: [26, 0, 0] },
    { t: 1.15, src: [I, 1.1], pel: [0.02, 0.74, 0.7], foot_l: [0.16, 0.07, 0.8], foot_r: [-0.15, 0.52, 0.5], spine: [22, 0, 0] },
    { t: 1.5, src: [S, 0], pel: [0, 0.5, 0.85], foot_l: [0.17, 0.07, 1.05], foot_r: [-0.17, 0.07, 1.0], hand_l: [0.36, 0.4, 0.95], hand_r: [-0.36, 0.4, 0.95], spine: [18, 0, 0] },
    { t: 2.0, src: [S, 0], pel: at([0, 0.2, 0]), foot_l: at([0.17, 0.07, 0.52]), foot_r: at([-0.17, 0.07, 0.5]), hand_l: at([0.36, 0.3, 0.02]), hand_r: at([-0.36, 0.3, 0.02]), spine: [6, 0, 0] },
  ], { meta: { travel: tb, next: 'boat_sit', vehicle: 'raft' } }));
  // ---- truck bed from the tailgate: hands on the bed edge, right foot on the step, pull up, left foot on the bed
  const tt = [0, 1.05, 0.9];
  out.push(poseClip(U, 'board_truck', [
    { t: 0, src: [I, 0], foot_l: 'src', foot_r: 'src' },
    { t: 0.35, src: [I, 0.3], pel: [0, 0.9, 0.08], foot_l: 'src', foot_r: [-0.14, 0.6, 0.3], hand_l: [0.28, 1.1, 0.5], hand_r: [-0.28, 1.1, 0.5], spine: [14, 0, 0], head: [-8, 0, 0] },
    { t: 0.8, src: [I, 0.6], pel: [0.02, 1.25, 0.34], foot_l: [0.15, 1.1, 0.72], foot_r: [-0.14, 0.6, 0.3], hand_l: [0.28, 1.1, 0.55], hand_r: [-0.28, 1.1, 0.55], spine: [30, 0, 0] },
    { t: 1.2, src: [I, 0.9], pel: [0, 1.72, 0.74], foot_l: [0.15, 1.1, 0.72], foot_r: [-0.16, 1.28, 0.5], spine: [16, 0, 0] },
    { t: 1.6, src: [I, 0], off: tt, foot_l: 'src+', foot_r: 'src+' },
  ], { meta: { travel: tt, next: 'idle', vehicle: 'truck' } }));
  // ---- Kubelwagen from its right side: left leg over the sill into the footwell, lower onto the seat while turning
  //      to face the car's forward (+X), right leg follows; ends in the 'sit' pose (turned 90 deg, 0.62 m in)
  const tc = [0.06, 0, 0.62];
  out.push(poseClip(U, 'board_car', [
    { t: 0, src: [I, 0], foot_l: 'src', foot_r: 'src' },
    { t: 0.4, src: [I, 0.4], yaw: 40, pel: [-0.03, 0.88, 0.14], foot_l: [0.26, 0.55, 0.42], foot_r: 'src', hand_l: [0.3, 1.0, 0.4], spine: [8, 0, 0] },
    { t: 0.8, src: [I, 0.8], yaw: 70, pel: [0.02, 0.74, 0.42], foot_l: [0.42, 0.21, 0.74], foot_r: [-0.2, 0.14, 0.22], hand_l: [0.34, 0.95, 0.55], spine: [22, 0, 0] },
    { t: 1.2, src: [S, 0], yaw: 88, pel: [0.07, 0.6, 0.6], foot_l: [0.5, 0.22, 0.7], foot_r: [0.15, 0.52, 0.42], spine: [8, 0, 0] },
    { t: 1.6, src: [S, 0], yaw: 90, off: tc, foot_l: 'src+', foot_r: 'src+', hand_l: 'src+', hand_r: 'src+' },
  ], { meta: { travel: tc, travelYaw: 90, next: 'sit', vehicle: 'car' } }));
  return out;
}
