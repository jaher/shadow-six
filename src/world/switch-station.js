/**
 * Switch stations (user 2026-10-12: "in mission 3 there should be small station with a lever to deactivate the
 * electricity from the fence. Right now the spy pulls a lever in the void"). A mission switch carried by a structure
 * (`switches: [{id, x, z, controls, …}]`, M3's fence switch on the admin house) is drawn as a small concrete switch
 * kiosk standing at the switch point, its back to the host building, its front facing away from it: a steel door, an
 * operating housing with a big hand lever on its side (up = on, down = off), and on the roof a two-pole disconnector
 * whose knife blades the lever opens (art/switch-station.js). Before, the switch interactable had no model at all.
 *
 * This module is the shared, three.js-free geometry: where the kiosk stands (local frame u = out of its front,
 * v = across it, the lever on its +v side), the nav cells it blocks, the spot the operator stands on to work the lever
 * (in front of it, the lever beside his left shoulder, facing the kiosk), and the lever's timeline over the 'use'
 * action (abilities/shared.js): reach, grip, the swing from one stop to the other — ending as the switch flips at the
 * end of the action — and the let-go. The sim only uses the stand spot and the nav cells; the lever and the hand are
 * drawn from the switch state and the user's action clock (no visual state feeds back).
 * Opt out per switch with `station: false`; `face` (rad) overrides the facing.
 * @module world/switch-station
 */
import { B } from './grid.js';

/** Kiosk geometry (m; local u = out of the front face, v = across it, y = up from the ground). */
export const STATION = Object.freeze({
  d: 0.72,        // body depth (u)
  w: 1.5,         // body width (v)
  h: 2.0,         // body height (to the roof slab)
  plinth: 0.06,   // plinth margin round the body
  // the operating housing on the front face (+v half) and the lever pivot on its +v side
  house: Object.freeze({ v0: 0.16, v1: 0.44, y0: 0.98, y1: 1.4, out: 0.2 }),
  pivot: Object.freeze({ u: 0.47, v: 0.475, y: 1.18 }),
  arm: 0.36,      // pivot → the grip's inner end (m)
  gripLen: 0.13,  // the grip (a turned handle on the end of the arm)
  // lever angle from straight up toward the front (+u), rad: on = up and slightly out, off = down and out
  on: 0.22,
  off: 2.46,
  // the operator: in front of the kiosk, the lever plane beside his left shoulder, facing the front face
  stand: Object.freeze({ u: 1.07, v: 0.19 }),
});

/** Lever timeline over the use action (s, for a 1 s activation; scaled with the switch's activation time). */
export const PULL = Object.freeze({
  reach: [0.0, 0.3],   // the hand from his side up to the grip
  grip: 0.34,          // fingers closed round it
  swing: [0.42, 0.97], // the throw, one stop to the other (the switch flips at 1.0: the clack of the stop)
  out: 0.28,           // after the action: the hand back to his side
  back: 0.3,           // a pull broken off (a move order): the lever springs back to its stop
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** Lever angle (rad from up toward the front) at rest in state `on`. */
export const leverRest = (on) => (on ? STATION.on : STATION.off);

/**
 * Share of the throw done `t` s into a use action of duration `dur` (0 before the swing, 1 at its end): a heavy start
 * (breaking the contacts) then a quick finish into the stop.
 */
export function swingK(t, dur = 1) {
  const k = dur > 0 ? 1 / dur : 1, s = clamp((t * k - PULL.swing[0]) / (PULL.swing[1] - PULL.swing[0]), 0, 1);
  return smooth(s) * 0.55 + s * s * 0.45;
}

/** Lever angle `t` s into a use action that started in state `on0`. */
export const leverAt = (on0, t, dur = 1) => leverRest(on0) + (leverRest(!on0) - leverRest(on0)) * swingK(t, dur);

/** Does this switch spec get a station? (`station: false` opts out) */
export const hasStation = (sw) => !!sw && sw.station !== false;

/**
 * Where a switch's kiosk stands: at the switch point, its front facing away from its host structure along the host's
 * nearest axis (or `sw.face`, rad). @param {{x:number, z:number, face?:number}} sw @param {{x?:number, z?:number,
 * rot?:number}|null} host @returns {{x:number, z:number, rot:number, at:(u:number, v:number)=>[number, number],
 *   stand:{x:number, z:number, h:number}, cells:{x:number, z:number, l:number, w:number, rot:number},
 *   solid:{x:number, z:number, h:number, hl:number, hw:number}}}
 */
export function stationLayout(sw, host = null) {
  let rot = Number.isFinite(sw.face) ? sw.face : 0;
  if (!Number.isFinite(sw.face) && host && Number.isFinite(host.x) && Number.isFinite(host.z)) {
    const hr = host.rot ?? 0, dx = sw.x - host.x, dz = sw.z - host.z;
    // the host's axes (its local +x = heading hr): the one pointing most toward the switch
    const a = Math.cos(hr) * dx + Math.sin(hr) * dz, b = -Math.sin(hr) * dx + Math.cos(hr) * dz;
    rot = Math.abs(a) >= Math.abs(b) ? (a >= 0 ? hr : hr + Math.PI) : (b >= 0 ? hr + Math.PI / 2 : hr - Math.PI / 2);
  }
  rot = Math.atan2(Math.sin(rot), Math.cos(rot));
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (u, v) => [sw.x + u * c - v * s, sw.z + u * s + v * c];
  const [sx, sz] = at(STATION.stand.u, STATION.stand.v);
  const S = STATION, m = S.plinth;
  // nav: the kiosk with its plinth (u -d/2-m … the front of the operating housing), v ±(w/2 + m)
  const u0 = -S.d / 2 - m, u1 = S.d / 2 + S.house.out;
  const [cx, cz] = at((u0 + u1) / 2, 0);
  // body clearance (world/body-clearance.js static solid): the kiosk on its plinth. (Not the housing: a path keeps its
  // inflation + half a cell's diagonal off a solid, which would shut the stand spot's cell; the housing's 0.14 m past
  // the plinth stays well inside that margin for anyone walking by.)
  const [bx, bz] = at(0, 0);
  return {
    x: sw.x, z: sw.z, rot, at,
    stand: { x: sx, z: sz, h: rot + Math.PI },
    cells: { x: cx, z: cz, l: u1 - u0, w: S.w + 2 * m, rot },
    solid: { x: bx, z: bz, h: rot, hl: S.d / 2 + m, hw: S.w / 2 + m, top: S.h + 0.6 },
  };
}

/** Nav: the kiosk blocks its cells (movement and sight: a 2 m concrete box). */
export function stampStation(grid, L) {
  if (!grid || !L) return;
  grid.fillOrientedRect(L.cells.x, L.cells.z, L.cells.l, L.cells.w, L.cells.rot, 'block', B.HIGH);
  grid.version = (grid.version || 0) + 1;
}
