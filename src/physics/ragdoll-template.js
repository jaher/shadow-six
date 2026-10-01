/**
 * The 11-body ragdoll of the UAL skeleton (bodies-design §A.4), as pure data. Local frame of the unit: +X = the
 * character's left, +Y up, +Z forward (three.js character convention), origin at the feet. Every body's frame is the
 * unit frame in the template (the standing idle pose, arms down), so every joint's reference is the identity and the
 * limits are measured from that pose. Signs (checked against Rapier): a rotation about +X moves a -Y segment's tip to
 * -Z (backwards) and a +Y segment's tip to +Z (forwards); a rotation about +Z moves a -Y tip to +X (the left side).
 * @module physics/ragdoll-template
 */

const D = Math.PI / 180;
/** Limits per joint: [min, max] radians about the parent's X, Y, Z axes. */
const lim = (x, y, z) => [x.map((v) => v * D), y.map((v) => v * D), z.map((v) => v * D)];

/**
 * @type {{name:string, bone:string, parent:number, at:number[], mass:number,
 *   col:{shape:'box'|'cap'|'ball', h?:number[], len?:number, r?:number, off?:number[]}[], limits?:number[][]}[]}
 *   at = joint origin in the template; col offsets are body-local; `cap` runs along -Y from the origin unless `up`
 */
export const PARTS = [
  { name: 'pelvis', bone: 'pelvis', parent: -1, at: [0, 0.95, 0], mass: 11,
    col: [{ shape: 'box', h: [0.16, 0.1, 0.1], off: [0, 0.02, 0] }] },
  { name: 'chest', bone: 'spine_03', parent: 0, at: [0, 1.08, 0], mass: 25,
    col: [{ shape: 'box', h: [0.17, 0.2, 0.11], off: [0, 0.2, 0] }], limits: lim([-20, 40], [-25, 25], [-25, 25]) },
  { name: 'head', bone: 'head', parent: 1, at: [0, 1.5, 0], mass: 5.5,
    col: [{ shape: 'ball', r: 0.11, off: [0, 0.13, 0.01] }], limits: lim([-35, 40], [-50, 50], [-30, 30]) },
  { name: 'upperarm_l', bone: 'upperarm_l', parent: 1, at: [0.2, 1.42, 0], mass: 2.2,
    col: [{ shape: 'cap', len: 0.29, r: 0.05 }], limits: lim([-100, 45], [-40, 40], [-10, 85]) },
  { name: 'lowerarm_l', bone: 'lowerarm_l', parent: 3, at: [0.2, 1.13, 0], mass: 1.7,
    col: [{ shape: 'cap', len: 0.4, r: 0.045 }], limits: lim([-145, 0], [-15, 15], [-8, 8]) },
  { name: 'upperarm_r', bone: 'upperarm_r', parent: 1, at: [-0.2, 1.42, 0], mass: 2.2,
    col: [{ shape: 'cap', len: 0.29, r: 0.05 }], limits: lim([-100, 45], [-40, 40], [-85, 10]) },
  { name: 'lowerarm_r', bone: 'lowerarm_r', parent: 5, at: [-0.2, 1.13, 0], mass: 1.7,
    col: [{ shape: 'cap', len: 0.4, r: 0.045 }], limits: lim([-145, 0], [-15, 15], [-8, 8]) },
  { name: 'thigh_l', bone: 'thigh_l', parent: 0, at: [0.1, 0.92, 0], mass: 7.5,
    col: [{ shape: 'cap', len: 0.44, r: 0.075 }], limits: lim([-90, 25], [-30, 30], [-15, 45]) },
  { name: 'shin_l', bone: 'calf_l', parent: 7, at: [0.1, 0.48, 0], mass: 4.6,
    col: [{ shape: 'cap', len: 0.42, r: 0.055 }, { shape: 'box', h: [0.05, 0.035, 0.11], off: [0, -0.44, 0.05] }],
    limits: lim([0, 140], [-12, 12], [-8, 8]) },
  { name: 'thigh_r', bone: 'thigh_r', parent: 0, at: [-0.1, 0.92, 0], mass: 7.5,
    col: [{ shape: 'cap', len: 0.44, r: 0.075 }], limits: lim([-90, 25], [-30, 30], [-45, 15]) },
  { name: 'shin_r', bone: 'calf_r', parent: 9, at: [-0.1, 0.48, 0], mass: 4.6,
    col: [{ shape: 'cap', len: 0.42, r: 0.055 }, { shape: 'box', h: [0.05, 0.035, 0.11], off: [0, -0.44, 0.05] }],
    limits: lim([0, 140], [-12, 12], [-8, 8]) },
];

/** Number of rigid bodies per ragdoll. */
export const NPARTS = PARTS.length;
/** Total template mass (kg) before scaling to CONFIG.physics.ragdoll.mass. */
export const TEMPLATE_MASS = PARTS.reduce((s, p) => s + p.mass, 0);
/** Rough bounding radius of each part (m), for ground clearance at spawn. */
export const PART_RADIUS = PARTS.map((p) => Math.max(...p.col.map((c) => c.r ?? Math.max(...c.h))));
