/**
 * Visible vehicle crews (art integration 2 + vehicle integration ambient step): a realistic figure
 *  - per crew RECORD (vehicle.crew entries that are not a mission Enemy of their own) at the model's crew socket:
 *    the patrol boat's bow gunner and stern hand, the tank / 8-Rad commander in the hatch, the motorcycle rider and
 *    sidecar passenger, the driver (and co-driver) of cars and lorries, the 251's driver;
 *  - per OCCUPANT (a commando or an enemy soldier who got in) at the model's boarding seat in order, driver first —
 *    on vehicles whose seats are seen (cars, lorry cabs, the R75, the 251; not under a canvas, not in a tank).
 * Seated figures sit on the seat: the clip ('drive' / 'sit') is posed once and the figure lowered so its pelvis sits
 * just above the cushion; under a closed roof (Opel Blitz cab, Citroën) it is lowered further until the head clears
 * the roof lining — no head through the roof. Weapons are put away while seated. A figure disappears when its
 * record dies, its occupant gets out (he stands at the door, entities/vehicle.js exit) or the vehicle is destroyed.
 * Open boats without crew records (the raft, the rowboat, the escape boat) draw their men through art/boat-crew.js:
 * seated / kneeling on the hull's own layout, the Marine paddling or rowing, stepping in and out.
 * Nothing is built when the character library is not active (placeholders / node tests).
 * @module art/vehicle-crew
 */
import { Vector3 } from 'three';
import { createUnitModel, characterContext } from './unit-model.js';
import { createBoatCrew } from './boat-crew.js';
import { bodyCapsules } from './strap-curtain.js';
import { closeKey, openKey, shutKey, reachDoor, doorPoint, turnWorld, fitGrip, crouch } from './door-hand.js';

/** Seats per art/vehicles.js model key (placeholder models): [x, y, z] in model space, clip, parent ('turret'). */
export const CREW_SEATS = {
  patrolboat: [{ p: [0, 1.1, 3.0], anim: 'idle' }, { p: [0.5, 1.1, -3.4], anim: 'look_around' }],
  tank: [{ p: [0, -0.18, -0.15], anim: 'look_around', parent: 'turret' }],
  armoredcar: [{ p: [0, -0.2, 0], anim: 'look_around', parent: 'turret' }],
  motorcycle: [{ p: [-0.3, 0.45, -0.25], anim: 'drive' }, { p: [0.45, 0.2, -0.2], anim: 'sit' }],
};

/** Occupants are drawn in these registry model keys only (open seats or glazed cabs). */
const OCCUPANT_MODELS = new Set(['car', 'truck', 'fuel_truck', 'motorcycle', 'armoredcar']);
/** Hip joint above the seat cushion (m) and head top above the head bone (m). */
const HIP_ABOVE_SEAT = 0.1, HEAD_TOP = 0.14;

/**
 * Getting in and out (user request 2026-10-07 "when commandos enter the car it should be realistic"), seconds per
 * phase. Into a seat: he stands at the open door (wait), climbs up into the doorway (climb: hands on the frame,
 * a step up onto the sill), then lowers himself onto the seat (sit). Out: up off the seat (rise), down from the sill
 * (climb). Into the back of a lorry: up over the tailgate (climb), a step forward under the canvas (step).
 */
export const BOARD_TIMES = Object.freeze({ wait: 0.2, climb: 0.8, sit: 0.45, rise: 0.4, down: 0.65, step: 0.4 });
const smooth = (k) => { const e = Math.max(0, Math.min(1, k)); return e * e * (3 - 2 * e); };
const lerp3 = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/**
 * Pose of a figure getting into (dir 'in') or out of ('out') a cab seat, in the seat holder's frame: S the door point
 * on the ground outside, D the doorway (on the sill, half-way in), Z the seated spot. Feet rise with the step up
 * (eased: the lift comes in the middle of the climb), never below S.y or above D.y before the seat.
 * @returns {{p:{x,y,z}, clip:string, seated:boolean, done:boolean}}
 */
export function seatMotion(dir, t, S, D, Z) {
  const T = BOARD_TIMES;
  if (dir === 'in') {
    if (t < T.wait) return { p: { ...S }, clip: 'idle', seated: false, done: false };
    const c = t - T.wait;
    if (c < T.climb) { const k = c / T.climb; const p = lerp3(S, D, smooth(k)); p.y = S.y + (D.y - S.y) * smooth(k * 1.4 - 0.2); return { p, clip: 'climb', seated: false, done: false }; }
    const k = (c - T.climb) / T.sit;
    return { p: lerp3(D, Z, smooth(k)), clip: 'seat', seated: true, done: k >= 1 };
  }
  if (t < T.rise) return { p: lerp3(Z, D, smooth(t / T.rise)), clip: 'idle', seated: false, done: false };
  const k = (t - T.rise) / T.down;
  const p = lerp3(D, S, smooth(k)); p.y = D.y + (S.y - D.y) * smooth(k * 1.4);
  return { p, clip: 'climb', seated: false, done: k >= 1 };
}

/**
 * Lorry passengers over the tailgate, in the model frame: S on the ground behind, G on top of the tailgate, B inside the
 * bay under the canvas (hidden there). 'in': S → G (climb), G → B (step); 'out' the reverse.
 */
export function tailgateMotion(dir, t, S, G, B) {
  const T = BOARD_TIMES;
  const climb = (a, b, k, up) => { const p = lerp3(a, b, smooth(k)); p.y = a.y + (b.y - a.y) * smooth(up ? k * 1.5 - 0.1 : k * 1.5 - 0.5); return p; };
  if (dir === 'in') {
    if (t < T.climb) return { p: climb(S, G, t / T.climb, true), clip: 'climb', done: false };
    const k = (t - T.climb) / T.step;
    return { p: lerp3(G, B, smooth(k)), clip: 'walk', done: k >= 1 };
  }
  if (t < T.step) return { p: lerp3(B, G, smooth(t / T.step)), clip: 'walk', done: false };
  const k = (t - T.step) / T.climb;
  return { p: climb(G, S, k, false), clip: 'climb', done: k >= 1 };
}

const _hp = new Vector3(), _sp = new Vector3(), _up = new Vector3(), _fw = new Vector3(), _bx = new Vector3();
const STOOP = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];
/** Upper-body points that must clear a ceiling: bone, how far its surface stands above the joint (m). */
const CROWN = [['Head', 0.13], ['neck_01', 0.09], ['spine_03', 0.15], ['upperarm_l', 0.08], ['upperarm_r', 0.08]];
/**
 * Under a roof he stoops: his crown, neck, upper back and shoulders are kept under the ceiling there (`ceil(x, z)`:
 * model-frame height of the rolled-up flap over a lorry's rear opening, of the canvas or a cab's roof inside;
 * Infinity outside) — first bending forward at the waist (≤ 40°, the head kept up), then crouching (the pelvis
 * lowered ≤ 0.45 m, knees bent, each foot left where the clip put it). `frame` = the vehicle model object.
 * @returns {boolean} posed
 */
export function stoopUnder(m, frame, ceil, guard = null) {
  const B = m.real?.inner?.bones;
  if (!B?.Head || !B.spine_01 || !B.pelvis) return false;
  m.root.updateWorldMatrix(true, true);
  const over = () => {
    let worst = -Infinity;
    for (const [n, r] of CROWN) {
      const b = B[n]; if (!b) continue;
      const p = frame.worldToLocal(b.getWorldPosition(_hp)), o = p.y + r - ceil(p.x, p.z);
      if (o > worst) worst = o;
    }
    return worst;
  };
  let o = over();
  if (!(o > 0.004)) return false;
  // 1. bend forward at the waist (the head mostly: what the bend can do)
  m.root.getWorldDirection(_fw); _fw.y = 0; _fw.normalize();
  const axis = _bx.crossVectors(_up.set(0, 1, 0), _fw).normalize();
  let bent = 0;
  for (let it = 0; it < 3 && o > 0.004; it++) {
    const h = frame.worldToLocal(B.Head.getWorldPosition(_hp)), sp = frame.worldToLocal(B.spine_01.getWorldPosition(_sp));
    const L = Math.hypot(h.x - sp.x, h.y - sp.y, h.z - sp.z) || 0.5, c0 = Math.max(-1, Math.min(1, (h.y - sp.y) / L));
    const a0 = Math.acos(c0), want = Math.acos(Math.max(-1, Math.min(1, c0 - o / L))) - a0;
    const ang = Math.min(STOOP_MAX - bent, want);
    if (ang <= 1e-4) break;
    for (const [n, k] of STOOP) { if (B[n]) { guard?.touch(B[n]); turnWorld(B[n], axis, ang * k); } }
    if (B.neck_01) { guard?.touch(B.neck_01); turnWorld(B.neck_01, axis, -ang * 0.35); } // eyes ahead
    bent += ang;
    o = over();
  }
  if (!(o > 0.004)) return true;
  // 2. crouch: the pelvis down by what is left, the legs folding to keep the feet where they are
  crouch(B, Math.min(0.45, o + 0.01), _fw, guard);
  return true;
}
const STOOP_MAX = 40 * Math.PI / 180;
/** Slope (m up per m out) of the ceiling a man ducks under on his way into a doorway / the rear opening. */
const DUCK = 1.6;
/**
 * Ceiling over a covered lorry's bay (model frame, `model.canopy`): under the rolled-up flap at the rear opening, the
 * canvas roof inside, sloping up behind the opening (he ducks on his way in).
 */
export const canopyCeil = (can) => (x, z) => {
  if (z > can.zFront) return Infinity;
  const low = can.roll - 0.09, a = can.zRear - 0.06, b = can.zRear + 0.16;
  if (z < a) return low + (a - z) * DUCK; // behind the opening: ducking on the way to it
  if (z < b) return low; // under the rolled-up flap
  return Math.min(can.roof - 0.07, low + (z - b) * DUCK); // inside: up to the roof, ducking on the way out to the flap
};

/** Seconds to turn round and pull / push a pair of rear doors (art/door-hand.js closeKey / openKey). */
export const REAR_HOLD = Object.freeze({ pull: 1.15, push: 0.8 });
/**
 * In / out through rear doors (the Sd.Kfz. 251's), in the frame the figure stands in: S outside behind, G just inside
 * the doors on the floor, P where he goes to (beside his seat / the troop bench), Z his seat (null: none, he stays at P).
 * 'in': wait, climb S→G, `hold` s at G (the last man in turns and pulls the doors shut), walk G→P, sit P→Z.
 * 'out': rise Z→P, walk P→G, `hold` s at G (the first man out pushes the doors open), climb down G→S.
 * @returns {{p:{x,y,z}, clip:string, seated:boolean, done:boolean, holding:number}} holding = seconds into the hold (−1: not)
 */
export function rearDoorMotion(dir, t, S, G, P, Z, hold = 0) {
  const T = BOARD_TIMES, walk = Math.max(0.3, Math.hypot(P.x - G.x, P.z - G.z) / 1.3);
  const climb = (a, b, k, up) => { const p = lerp3(a, b, smooth(k)); p.y = a.y + (b.y - a.y) * smooth(up ? k * 1.5 - 0.1 : k * 1.5 - 0.5); return p; };
  const at = (p, clip, seated = false, done = false, holding = -1) => ({ p, clip, seated, done, holding });
  if (dir === 'in') {
    if (t < T.wait) return at({ ...S }, 'idle');
    let c = t - T.wait;
    if (c < T.climb) return at(climb(S, G, c / T.climb, true), 'climb');
    c -= T.climb;
    if (c < hold) return at({ ...G }, 'idle', false, false, c);
    c -= hold;
    if (c < walk) return at(lerp3(G, P, smooth(c / walk)), 'walk');
    c -= walk;
    if (!Z) return at({ ...P }, 'idle', false, true);
    const k = c / T.sit;
    return at(lerp3(P, Z, smooth(k)), 'seat', true, k >= 1);
  }
  let c = t;
  if (Z) { if (c < T.rise) return at(lerp3(Z, P, smooth(c / T.rise)), 'idle'); c -= T.rise; }
  if (c < walk) return at(lerp3(P, G, smooth(c / walk)), 'walk');
  c -= walk;
  if (c < hold) return at({ ...G }, 'idle', false, false, c);
  c -= hold;
  const k = c / T.down;
  return at(climb(G, S, k, false), 'climb', false, k >= 1);
}

/** Model options that reproduce a unit's own look (entities/enemy.js, commando.js modelOpts). */
function lookOf(u) {
  const s = u.spawn || {};
  if (u.faction === 'player') return { faction: 'player', role: u.role, colors: s.colors, guestId: u.role === 'guest' ? s.guestId ?? s.id ?? null : null };
  return { faction: 'enemy', soldierType: u.soldierType || 'crew', colors: s.colors, spawnId: s.id ?? u.id ?? null, squad: s.squad?.id ?? s.squad ?? null, x: s.x, z: s.z };
}

/**
 * Seat a figure: clip, weapon away. A fixed `seat.dy` (standing hatch / cupola poses) places it at once; a seated
 * seat (dy null) is settled once the clip has blended in (settle()), hidden until then.
 */
function seatFigure(m, seat) {
  m.setAnim(seat.anim);
  const f = { m, seat, t: 0, settled: seat.dy != null || !m.isReal };
  if (f.settled) m.root.position.y = seat.dy ?? 0;
  else m.root.visible = false;
  m.ready?.then?.(() => { if (seat.anim === 'drive' || seat.anim === 'sit') m.real?.setWeapon?.(null); });
  return f;
}

const _v = new Vector3();
/**
 * Seated figure on its seat, measured in the posed clip: the pelvis just above the cushion (the socket), right over
 * it (seated clips carry the pelvis ~0.27 m behind the feet-root), and under a closed roof the head top below the lining.
 */
function settle(f) {
  const m = f.m, s = f.seat, par = m.root.parent;
  const pel = m.real?.getSocket?.('pelvis'), head = m.real?.getSocket?.('head');
  f.settled = true;
  if (!pel || !par) { m.root.position.y = -0.45; return; }
  m.root.position.set(0, 0, 0);
  par.updateWorldMatrix(true, false);
  m.root.updateMatrixWorld(true);
  const lp = par.worldToLocal(pel.getWorldPosition(_v)).clone();
  let dy = -(lp.y - HIP_ABOVE_SEAT);
  if (s.roof != null && head && s.holder) {
    const top = par.worldToLocal(head.getWorldPosition(_v)).y + HEAD_TOP + dy + s.holder.matrix.elements[13];
    if (top > s.roof) dy -= top - s.roof;
  }
  m.root.position.set(-lp.x, dy, -lp.z);
  f.dy = dy;
}

/**
 * Build the crew figures of a vehicle (or null when there is nothing to show now or later).
 * @param {object} v Vehicle entity (crew, occupants, model, def, vehicleType, linkedCrew)
 * @returns {{figures:object[], update:(dt:number)=>void, dispose:()=>void}|null}
 */
export function createCrewFigures(v) {
  if (!characterContext().ready || !v?.model?.root) return null;
  const key = v.def?.model || v.vehicleType;
  const lib = !!v.model.crewSeats;
  if (v.def?.kind === 'boat' && !v.crew?.length) return lib ? createBoatCrew(v, { createUnitModel, lookOf }) : null;
  const figures = [];
  // crew records: the model's crew sockets (library) or the fixed placeholder seats
  if (v.crew?.length) {
    const libSeats = lib ? v.model.crewSeats(key) : null;
    const seats = libSeats?.length ? libSeats.map((q) => ({ anim: q.anim, dy: q.dy, holder: q.object, roof: q.roof }))
      : (CREW_SEATS[key] || []).map((q) => ({ ...q, dy: q.p[1] }));
    v.crew.forEach((c, i) => {
      const seat = seats[i];
      if (!seat || v.linkedCrew?.(c)) return;
      const m = createUnitModel({ faction: 'enemy', soldierType: c.soldierType || 'crew', spawnId: c.ref ?? `${v.tag ?? v.id}:crew${i}` });
      if (!m.isReal) return;
      if (seat.p) m.root.position.set(seat.p[0], 0, seat.p[2]);
      const hull = v.model.root.children[0] || v.model.root;   // the hull group (boats bob with it)
      const parent = seat.holder || (seat.parent === 'turret' && v.model.turret ? v.model.turret : hull);
      parent.add(m.root);
      figures.push({ ...seatFigure(m, seat), c });
    });
  }
  const occ = new Map(); // unit → figure (occupants shown only on vehicles without crew records)
  const showOcc = lib && !figures.length && !v.crew?.length && OCCUPANT_MODELS.has(key) && !!v.model.seatHolder;
  if (!figures.length && !showOcc) return null;
  let pushed = false; // bodies were handed to the rear strap curtain last frame
  const moving = new Set(); // figures getting in / out (cab seats after they left, the lorry bay)
  const now = () => v.world?.time ?? 0;
  const groundAt = (x, z) => v.world?.groundY?.(x, z) || 0;
  const localOf = (obj, x, y, z) => { obj.updateWorldMatrix(true, false); const p = obj.worldToLocal(_v.set(x, y, z)); return { x: p.x, y: p.y, z: p.z }; };
  /** He just got in from (near) here — show the climb (not on a load, a quick-load or a scripted spawn inside). */
  const fresh = (u) => { const b = u.boardFrom; return b && !b.swim && now() - b.t < 1 && now() > 0.3 && !u.downed && Math.hypot(b.x - v.x, b.z - v.z) < 8 ? b : null; };
  const vis0 = () => v.model.visual?.object3d || v.model.root;
  /**
   * His hand on the door of `doorSeat` (art/door-hand.js): the side door nearest him, the hand on that side. null when
   * the model has no rigged side door for it. `own` = his own seat's socket (a door across the cab: he slides over).
   */
  const handFor = (doorSeat, k) => {
    const rig = (v.model.doorRigs?.(doorSeat) || []).find((r) => r.alongZ && r.seat);
    if (!rig) return null;
    const mine = v.model.doorRigs?.(k)?.[0]?.seat || rig.seat;
    return { rig, s: rig.side > 0 ? 'l' : 'r', t: 0, phase: 'hold', key: { w: 0, door: 1, lean: 0 }, frac: rig.frac, f0: rig.frac,
      slide: { x: rig.seat[0] - mine[0], y: rig.seat[1] - mine[1], z: rig.seat[2] - mine[2] }, which: 'in' };
  };
  /**
   * A figure's skeleton overlay (after the clip): stooping under a roof / the canvas (`ceil`), then his hand on a door
   * (`hand`). Returns the figure's overlay state; an overlay with neither is removed.
   */
  const figOverlay = (m) => {
    if (!m._fig) {
      m._fig = { ceil: null, hand: null };
      m.overlay = (mm, dt, guard) => {
        const F = mm._fig;
        let on = F.ceil ? stoopUnder(mm, vis0(), F.ceil, guard) : false;
        const h = F.hand;
        if (h?.key && h.key.w > 0.001) {
          h.err = null;
          for (const d of h.pair || [h]) { // one door, or a pair of rear doors (a hand on each)
            // where along the door his fist goes: chosen once per hold, from where it will be furthest from him
            const stand = h.stand ?? h.which === 'out';
            if (d.edge == null) d.edge = fitGrip(mm, vis0(), d.rig, [h.f0, h.start ?? 0], h.which, d.s, stand);
            const r = reachDoor(mm, vis0(), d.rig, h.frac, h.which, d.s, h.key.w, h.key.lean ?? 0, guard, d.edge, stand);
            if (r) { h.err = Math.max(h.err ?? 0, r.err); h.lean = Math.max(r.lean, h.pair ? h.lean ?? 0 : 0); on = true; } // grip error (m), lean (rad): tests
          }
        }
        return on;
      };
    }
    return m._fig;
  };
  const tidyOverlay = (m) => { if (m._fig && !m._fig.ceil && !m._fig.hand) { m.overlay = null; m._fig = null; } };
  const handOverlay = (m, h) => { figOverlay(m).hand = h; };
  const letGo = (m, h) => {
    if (m._fig) { m._fig.hand = null; tidyOverlay(m); }
    if (h?.held) { for (const d of h.pair || [h]) v.model.handDoor?.(d.rig.node, null); h.held = false; }
  };
  /** The door(s) in his hand to opening fraction f. */
  const setDoors = (h, f) => { for (const d of h.pair || [h]) v.model.handDoor(d.rig.node, f); };
  /**
   * Rear doors a seat is boarded through (the Sd.Kfz. 251's pair, across the hull), model frame: the rigs, the floor at
   * their sill (y), their plane (zd), inward (+1 toward the front), G just inside them, L just outside. null: none.
   */
  const rearOf = (seat) => {
    const rigs = (v.model.doorRigs?.(seat) || []).filter((r) => !r.alongZ);
    if (!rigs.length) return null;
    const zd = rigs.reduce((a, r) => a + r.pivot[2], 0) / rigs.length, y = Math.min(...rigs.map((r) => r.y0)), dirIn = zd < 0 ? 1 : -1;
    return { rigs, zd, y, dirIn, G: { x: 0, y, z: zd + dirIn * 0.32 }, L: { x: 0, y: 0, z: zd - dirIn * 0.32 } };
  };
  /**
   * Hands on a pair of rear doors: facing them from inside (`inside`) the door on his right takes his right hand; from
   * outside, his left.
   */
  const pairHands = (R, inside, which) => ({ pair: R.rigs.map((rig) => ({ rig, s: (rig.pivot[0] > 0) === inside ? 'r' : 'l' })),
    rig: R.rigs[0], t: 0, phase: 'hold', key: { w: 0, door: 1, lean: 0 }, frac: R.rigs[0].frac, f0: R.rigs[0].frac, which, slide: { x: 0, y: 0, z: 0 } });
  /** A model-frame point in the frame `obj` (a seat holder / the model object) a figure stands in. */
  const inFrame = (obj, p) => { const w = vis0().localToWorld(new Vector3(p.x, p.y, p.z)); return localOf(obj, w.x, w.y, w.z); };
  /**
   * Ceiling over a cab seat (model frame): the roof lining inside the cab, sloping up out of the doorway (he ducks his
   * head as he comes to it, not at once); none for an open car.
   */
  const cabCeil = (roof) => {
    if (roof == null) return null;
    const half = Math.max(0.5, ...(v.model.doorRigs?.(0) || []).map((r) => Math.abs(r.pivot[0]))) + 0.04;
    return (x) => roof + Math.max(0, Math.abs(x) - half) * DUCK;
  };
  /** Lorry bay points in the model frame: on top of the tailgate, inside under the canvas. */
  const bay = () => {
    const meta = v.model.meta, tg = meta?.parts?.find((p) => p.kind === 'tailgate')?.pivot, cb = meta?.sockets?.find((q) => /cargo|bay/.test(q.name))?.pos;
    const zt = tg ? tg[2] : -(v.model.dims?.l || 6) / 2, yt = tg ? tg[1] + 0.05 : 1.15;
    return { G: { x: 0, y: yt, z: zt + 0.15 }, B: { x: 0, y: (cb?.[1] ?? yt) - 0.05, z: cb ? Math.min(cb[2], zt + 1.4) : zt + 1.4 } };
  };
  const startBay = (u, dir, at, seat = null) => {
    const m = createUnitModel(lookOf(u));
    if (!m.isReal) { m.dispose?.(); return; }
    const par = vis0();
    par.add(m.root);
    let S = localOf(par, at.x, groundAt(at.x, at.z), at.z), { G, B } = bay();
    const R = rearOf(seat ?? 2);
    if (R) { G = { ...R.G }; B = { x: 0, y: R.y, z: R.zd + R.dirIn * 1.6 }; } // through the half-track's rear doors, on its floor
    m.root.position.set(dir === 'in' ? S.x : B.x, dir === 'in' ? S.y : B.y, dir === 'in' ? S.z : B.z);
    m.ready?.then?.(() => m.real?.setWeapon?.(null));
    if (dir === 'out' && u.object3d) u.object3d.visible = false;
    // under the canvas he keeps his head below the rolled-up flap and the roof (no head through the cloth)
    const can = v.model.canopy;
    if (can) figOverlay(m).ceil = canopyCeil(can);
    const q = { m, u, dir, t: 0, kind: 'bay', S, G, B, par };
    if (R && dir === 'in') {
      q.rear = { R, G, P: B, last: !v._boarders?.size };
      if (q.rear.last) { q.hand = pairHands(R, true, 'in'); q.hand.stand = true; q.hand.held = true; for (const r of R.rigs) v.model.claimDoor(r.node); }
    } else if (R) rearOut(q, R, m, v.occupants || [], () => B);
    moving.add(q);
  };
  /**
   * Out through the rear doors (seat or bench figure `q`, in its frame): he walks to them; shut, he pushes them open
   * (a hand on each); the last man out steps down outside, turns and swings them shut, then walks to where he stands.
   * `P()` = where he starts walking from (model frame).
   */
  const rearOut = (q, R, m, list, P) => {
    const cur = Math.max(...R.rigs.map((r) => v.model.doorFrac(r.node)));
    const others = list.some((o) => o !== q.u && rearOf(seatOf(o))) || [...moving].some((o) => o !== q && o.rear && o.dir === 'out');
    q.rear = { R, G: inFrame(q.par, R.G), P: inFrame(q.par, P()), hold: cur < 0.3 ? REAR_HOLD.push : 0 };
    const h = pairHands(R, true, 'in');
    h.stand = true; h.held = true; h.start = cur; h.f0 = Math.max(cur, R.rigs[0].frac);
    for (const r of R.rigs) v.model.handDoor(r.node, cur); // the doors the sim opened are his hands' now
    q.hand = h;
    if (!others) { // last out: down outside the doors, shut them, then to his spot
      const L = inFrame(q.par, { ...R.L, y: 0 }), Lw = q.par.localToWorld(new Vector3(L.x, L.y, L.z));
      L.y = localOf(q.par, Lw.x, groundAt(Lw.x, Lw.z), Lw.z).y;
      q.shut = { L, S: q.S, pair: true };
      q.S = L;
    }
  };
  /** One frame of a figure through rear doors (in or out; seat or bench). @returns {object} the motion sample */
  const rearStep = (q, f, dt) => {
    const b = q.rear, h = q.hand, inSeat = !!f;
    const hold = q.dir === 'in' ? (b.last ? REAR_HOLD.pull : 0) : b.hold;
    const Z = inSeat && q.dir === 'in' ? (f.board.Z || b.P) : q.Z || null; // (a seat: sat on once he is beside it)
    const r = rearDoorMotion(q.dir, q.t, q.S, b.G, b.P, Z, hold);
    const m = q.m;
    const clip = r.clip === 'seat' ? (inSeat ? f.seat.anim : 'idle') : r.clip;
    if (m.anim !== clip) m.setAnim(clip);
    m.root.position.set(r.p.x, r.p.y, r.p.z);
    // facing: where he goes; at the doors, the doors (the rear: back the way he came in / on out)
    const doorsAt = inFrame(q.par, { x: 0, y: b.R.y, z: b.R.zd });
    const tgt = r.holding >= 0 ? doorsAt : r.clip === 'climb' ? (q.dir === 'in' ? b.G : q.S) : r.clip === 'walk' ? (q.dir === 'in' ? b.P : b.G) : null;
    const yaw = tgt && Math.hypot(tgt.x - r.p.x, tgt.z - r.p.z) > 0.05 ? Math.atan2(tgt.x - r.p.x, tgt.z - r.p.z) : r.clip === 'seat' ? 0 : m.root.rotation.y;
    m.root.rotation.y += Math.atan2(Math.sin(yaw - m.root.rotation.y), Math.cos(yaw - m.root.rotation.y)) * Math.min(1, dt * 10);
    if (h && h.held) {
      if (r.holding >= 0) { // the doors in his hands
        if (!m._fig?.hand) { for (const d of h.pair) d.edge = null; handOverlay(m, h); }
        h.phase = q.dir === 'in' ? 'close' : 'push';
        h.key = q.dir === 'in' ? closeKey(r.holding) : openKey(r.holding);
        h.frac = q.dir === 'in' ? h.key.door * h.f0 : h.start + (h.f0 - h.start) * h.key.door;
        setDoors(h, h.frac);
      } else if (m._fig?.hand && q.t > 0.05) { // done with them: shut behind him (in) / left open for the next man (out)
        if (q.dir === 'in') { setDoors(h, 0); letGo(m, h); } else { m._fig.hand = null; tidyOverlay(m); }
      }
    }
    return r;
  };
  let prev = [], prevSeat = new Map();
  const seatOf = (u) => (v.seatOf ? v.seatOf(u) : (v.occupants || []).indexOf(u));
  const syncOccupants = () => {
    const list = v.occupants || [];
    for (const [u, f] of occ) {
      if (list.includes(u) && f.k === seatOf(u)) continue;
      occ.delete(u);
      letGo(f.m, f.hand); f.hand = null;
      // he got out at his door: the seated figure climbs down to where he stands, then his own model takes over
      // (a commando, who stands where he got out; an enemy rider sent off on an errand walks off at once)
      const out = !list.includes(u) && u.vehicle !== v && u.alive !== false && !u.downed && f.settled && !v.destroyed
        && u.faction === 'player' && Number.isFinite(u.x) && Math.hypot(u.x - v.x, u.z - v.z) < 7;
      if (!out) { f.m.dispose(); f.m.root.removeFromParent(); continue; }
      const par = f.m.root.parent, Z = { x: f.m.root.position.x, y: f.m.root.position.y, z: f.m.root.position.z };
      const S = localOf(par, u.x, groundAt(u.x, u.z), u.z), D = { x: S.x * 0.35, y: Math.max(S.y, -0.55), z: S.z * 0.35 };
      if (u.object3d) u.object3d.visible = false;
      f.m.root.visible = true;
      const q = { m: f.m, u, dir: 'out', t: 0, kind: 'seat', S, D, Z, par, yaw: f.m.root.rotation.y };
      figOverlay(f.m).ceil = cabCeil(f.seat.roof); tidyOverlay(f.m); // head under the cab roof as he gets out
      const R = rearOf(f.k);
      if (R) { rearOut(q, R, f.m, list, () => { const p = vis0().worldToLocal(f.m.root.parent.getWorldPosition(new Vector3())); return { x: p.x, y: R.y, z: p.z - 0.5 * R.dirIn }; }); moving.add(q); continue; }
      // his hand pushes his door open before he rises (the door the sim opened is his hand's from now on)
      const h = handFor(f.k, f.k);
      if (h && !h.slide.x && !h.slide.z) {
        q.hand = h; h.phase = 'push'; h.held = true; h.edge = null;
        h.start = v.model.doorFrac(h.rig.node) > h.f0 * 0.5 ? v.model.doorFrac(h.rig.node) : 0; // left open by the man before him
        v.model.handDoor(h.rig.node, h.start);
        handOverlay(f.m, h);
        // the last man out through that door shuts it behind him: he steps down by it instead of where he will stand
        const others = list.some((o) => (v.model.doorRigs?.(seatOf(o)) || []).some((r) => r.node === h.rig.node))
          || [...moving].some((o) => o.hand?.rig.node === h.rig.node);
        if (!others) {
          const P = shutSpot(h.rig);
          const Pw = vis0().localToWorld(_v.set(P.x, P.y, P.z));
          const L = localOf(par, Pw.x, groundAt(Pw.x, Pw.z), Pw.z);
          q.shut = { L, S };
          q.S = L; q.D = { x: L.x * 0.35, y: Math.max(L.y, -0.55), z: L.z * 0.35 };
        }
      }
      moving.add(q);
    }
    // lorry passengers: in over the tailgate, out the same way
    for (const u of list) if (!prev.includes(u) && !v.model.seatHolder(seatOf(u)) && fresh(u)) startBay(u, 'in', fresh(u), seatOf(u));
    for (const u of prev) {
      if (list.includes(u) || occ.has(u) || u.vehicle === v || u.alive === false || u.downed || v.destroyed) continue;
      if (u.faction === 'player' && !v.model.seatHolder(prevSeat.get(u)) && Number.isFinite(u.x) && Math.hypot(u.x - v.x, u.z - v.z) < 9) startBay(u, 'out', { x: u.x, z: u.z }, prevSeat.get(u));
    }
    prev = [...list];
    prevSeat = new Map(list.map((u) => [u, seatOf(u)]));
    list.forEach((u) => {
      const k = seatOf(u);
      if (occ.has(u) || u.alive === false) return;
      const seat = v.model.seatHolder(k);
      if (!seat) return;
      const m = createUnitModel(lookOf(u));
      if (!m.isReal) return;
      seat.object.add(m.root);
      const f = { ...seatFigure(m, { anim: seat.anim, dy: seat.dy, holder: seat.object, roof: seat.roof }), k, u };
      const from = fresh(u);
      if (from && f.seat.dy == null) { // he climbs in from the door he opened (the seat is measured when he sits)
        const S = localOf(seat.object, from.x, groundAt(from.x, from.z), from.z);
        f.board = { t: 0, S, D: { x: S.x * 0.35, y: Math.max(S.y, -0.55), z: S.z * 0.35 } };
        m.root.position.set(S.x, S.y, S.z);
        m.root.rotation.y = Math.atan2(-S.x, -S.z);
        m.root.visible = true;
        m.setAnim('idle');
        figOverlay(m).ceil = cabCeil(f.seat.roof); tidyOverlay(m); // head under the cab roof as he climbs in
        const R = rearOf(from.door ?? k);
        if (R) { // in through the rear doors (the half-track): over the sill, (the last man in shuts them), up to his seat
          const sp = vis0().worldToLocal(seat.object.getWorldPosition(new Vector3()));
          f.board.rear = { R, G: inFrame(seat.object, R.G), P: inFrame(seat.object, { x: sp.x, y: R.y, z: sp.z - 0.5 * R.dirIn }), last: !v._boarders?.size };
          if (f.board.rear.last) { f.hand = pairHands(R, true, 'in'); f.hand.stand = true; f.hand.held = true; for (const r of R.rigs) v.model.claimDoor(r.node); }
        } else {
          // the door he opened stays open (no timer shuts it) until his hand pulls it shut from the seat
          const h = handFor(from.door ?? k, k);
          if (h) { f.hand = h; v.model.claimDoor(h.rig.node); h.held = true; }
        }
      }
      occ.set(u, f);
    });
  };
  /** One frame of a figure getting in (its seated pose measured once it starts to sit). */
  const boardStep = (f, dt) => {
    const b = f.board;
    b.t += dt;
    if (b.rear) { // in through rear doors, up the floor to his seat
      const T = BOARD_TIMES, walk = Math.max(0.3, Math.hypot(b.rear.P.x - b.rear.G.x, b.rear.P.z - b.rear.G.z) / 1.3);
      if (!b.Z && b.t >= T.wait + T.climb + (b.rear.last ? REAR_HOLD.pull : 0) + walk) b.Z = { x: 0, y: -(0.45 - HIP_ABOVE_SEAT), z: 0.27 };
      const r = rearStep({ m: f.m, u: f.u, dir: 'in', t: b.t, S: b.S, rear: b.rear, hand: f.hand, par: f.m.root.parent }, f, dt);
      if (r.done) {
        f.board = null; f.m.root.rotation.y = 0; f.hand = null;
        if (f.m._fig) { f.m._fig.ceil = null; f.m._fig.hand = null; tidyOverlay(f.m); f.m._guard?.restore(); }
        settle(f);
      }
      return;
    }
    if (!b.Z && b.t >= BOARD_TIMES.wait + BOARD_TIMES.climb) {
      // he lowers himself onto the seat: the seated clip blends in on the way down; the exact seated spot is measured
      // (settle) once it has, a few cm from this estimate (pelvis ~0.45 m over the feet, ~0.27 m behind them)
      f.m.setAnim(f.seat.anim);
      b.Z = { x: 0, y: -(0.45 - HIP_ABOVE_SEAT), z: 0.27 };
    }
    const r = seatMotion('in', b.t, b.S, b.D, b.Z ? slideZ(f, b.Z) : b.D);
    if (r.clip === 'climb' && f.m.anim !== 'climb') f.m.setAnim('climb');
    f.m.root.position.set(r.p.x, r.p.y, r.p.z);
    const k = r.seated ? Math.min(1, (b.t - BOARD_TIMES.wait - BOARD_TIMES.climb) / BOARD_TIMES.sit) : 0;
    const yaw0 = Math.atan2(-b.S.x, -b.S.z);
    f.m.root.rotation.y = yaw0 * (1 - smooth(k));
    if (r.done) {
      f.board = null; f.m.root.rotation.y = 0;
      // the seat is measured on the clip's own pose: this frame's stoop / crouch taken back first
      if (f.m._fig) { f.m._fig.ceil = null; tidyOverlay(f.m); f.m._guard?.restore(); }
      settle(f);
      const h = f.hand;
      if (h) { // seated: he reaches out and pulls the door shut (from the seat by that door when it is across the cab)
        h.phase = 'close'; h.t = 0; h.edge = null; h.f0 = Math.max(0.05, v.model.doorFrac(h.rig.node) || h.rig.frac);
        h.Z = f.m.root.position.clone();
        f.m.root.position.x += h.slide.x; f.m.root.position.z += h.slide.z;
        handOverlay(f.m, h);
      }
    }
  };
  /** Seat in the sit / slide target while he pulls a door across the cab shut. */
  const slideZ = (f, Z) => (f.hand ? { x: Z.x + f.hand.slide.x, y: Z.y, z: Z.z + f.hand.slide.z } : Z);
  /** One frame of a seated man's hand on the door he came in by: reach, pull it shut, let go (slide over). */
  const handStep = (f, dt) => {
    const h = f.hand;
    h.t += dt;
    if (h.phase === 'close') {
      h.key = closeKey(h.t);
      h.frac = h.key.door * h.f0;
      setDoors(h, h.frac);
      if (h.key.done) {
        setDoors(h, 0); letGo(f.m, h);
        if (h.slide.x || h.slide.z) { h.phase = 'slide'; h.t = 0; } else f.hand = null;
      }
    } else if (h.phase === 'slide') { // along the bench to his own seat
      const k = smooth(h.t / 0.55);
      f.m.root.position.set(h.Z.x + h.slide.x * (1 - k), h.Z.y, h.Z.z + h.slide.z * (1 - k));
      if (k >= 1) f.hand = null;
    }
  };
  /** One frame of a figure on its way in / out that is no longer a seated occupant. */
  const moveStep = (q, dt) => {
    const h = q.hand;
    if (q.rear) { rearMove(q, dt); return; }
    if (h && (h.phase === 'push' || h.phase === 'shut' || h.phase === 'walk')) { handMove(q, dt); return; }
    q.t += dt;
    if (h?.phase === 'let') { // rising: the hand comes off the open door
      h.t += dt; h.key = { w: 1 - smooth(h.t / 0.3), door: 1, lean: 0 };
      if (h.t >= 0.3) { if (q.m._fig) q.m._fig.hand = null; h.phase = 'off'; }
    }
    let r;
    if (q.kind === 'bay') r = tailgateMotion(q.dir, q.t, q.S, q.G, q.B);
    else r = seatMotion('out', q.t, q.S, q.D, q.Z);
    const clip = r.clip === 'seat' ? 'idle' : r.clip;
    if (q.m.anim !== clip) q.m.setAnim(clip);
    q.m.root.position.set(r.p.x, r.p.y, r.p.z);
    const to = q.dir === 'in' ? (r.clip === 'climb' ? q.G : q.B) : q.S, from = q.m.root.position;
    if (Math.hypot(to.x - from.x, to.z - from.z) > 0.05) q.m.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    q.m.root.visible = true;
    q.m.update(dt); // posed where he is this frame (the stoop under the canvas / the roof measures from there)
    // getting out: he is given an order before the figure is down — his own model takes over at once
    const gone = q.dir === 'out' && (q.u.vehicle || (q.at && Math.hypot(q.u.x - q.at.x, q.u.z - q.at.z) > 0.3));
    q.at ||= { x: q.u.x, z: q.u.z };
    if (r.done && q.shut && !gone && !v.destroyed && q.u.alive !== false) { // down by the door: he swings it shut
      h.phase = 'shut'; h.t = 0; h.which = 'out'; h.edge = null; h.start = 0; h.f0 = Math.max(0.05, v.model.doorFrac(h.rig.node) || h.f0);
      h.s = shutHand(h.rig, q.m.root, q.par); h.key = { w: 0, door: 1, lean: 0 }; handOverlay(q.m, h);
      return;
    }
    if (r.done || gone || v.destroyed || q.u.alive === false) {
      if (q.hand) letGo(q.m, q.hand);
      moving.delete(q);
      q.m.dispose(); q.m.root.removeFromParent();
      // out: his own model takes over where the figure stops (in: he is under the canvas now)
      if (q.dir === 'out' && q.u.object3d && q.u.state !== 'inVehicle' && !q.u.vehicle) q.u.object3d.visible = true;
    }
  };
  /** One frame of a figure going in / out through rear doors that is not (or no longer) a seated occupant. */
  const rearMove = (q, dt) => {
    const h = q.hand;
    if (h && (h.phase === 'shut' || h.phase === 'walk')) { handMove(q, dt); return; }
    q.t += dt;
    const r = rearStep(q, null, dt);
    q.m.root.visible = true;
    q.m.update(dt);
    const gone = q.dir === 'out' && (q.u.vehicle || (q.at && Math.hypot(q.u.x - q.at.x, q.u.z - q.at.z) > 0.3));
    q.at ||= { x: q.u.x, z: q.u.z };
    if (r.done && q.shut && h && !gone && !v.destroyed && q.u.alive !== false) { // down outside: he shuts them behind him
      h.phase = 'shut'; h.t = 0; h.which = 'out'; h.stand = true; h.start = 0;
      h.f0 = Math.max(0.05, ...h.pair.map((d) => v.model.doorFrac(d.rig.node)));
      for (const d of h.pair) { d.edge = null; d.s = d.rig.pivot[0] > 0 ? 'l' : 'r'; } // facing them from outside
      h.key = { w: 0, door: 1, lean: 0 }; handOverlay(q.m, h);
      return;
    }
    if (r.done || gone || v.destroyed || q.u.alive === false) {
      letGo(q.m, h);
      moving.delete(q);
      q.m.dispose(); q.m.root.removeFromParent();
      if (q.dir === 'out' && q.u.object3d && q.u.state !== 'inVehicle' && !q.u.vehicle) q.u.object3d.visible = true;
    }
  };
  /**
   * Getting out with his hand on the door: pushes it open from the seat (then rises: moveStep), and — the last man
   * out by it — swings it shut from outside by its outer edge, then walks to where he stands.
   */
  const handMove = (q, dt) => {
    const h = q.hand;
    h.t += dt;
    const gone = q.u.vehicle || (q.at && Math.hypot(q.u.x - q.at.x, q.u.z - q.at.z) > 0.3);
    q.at ||= { x: q.u.x, z: q.u.z };
    if (gone || v.destroyed || q.u.alive === false) {
      letGo(q.m, h); moving.delete(q); q.m.dispose(); q.m.root.removeFromParent();
      if (q.u.object3d && q.u.state !== 'inVehicle' && !q.u.vehicle) q.u.object3d.visible = true;
      return;
    }
    if (h.phase === 'push') {
      h.key = openKey(h.t); h.frac = h.start + (h.f0 - h.start) * h.key.door;
      setDoors(h, h.frac);
      q.m.update(dt);
      if (h.key.done) { h.phase = 'let'; h.t = 0; }
      return;
    }
    if (h.phase === 'shut') {
      // he turns to the door's free edge (a pair: their middle), takes it and swings it shut
      const E = new Vector3();
      for (const d of h.pair || [h]) E.add(q.par.worldToLocal(vis0().localToWorld(doorPoint(d.rig, h.frac, 'out', new Vector3()))));
      E.multiplyScalar(1 / (h.pair || [h]).length);
      const p = q.m.root.position, want = Math.atan2(E.x - p.x, E.z - p.z);
      q.m.root.rotation.y += Math.atan2(Math.sin(want - q.m.root.rotation.y), Math.cos(want - q.m.root.rotation.y)) * Math.min(1, dt * 8);
      h.key = shutKey(h.t); h.key.lean = h.key.w; h.frac = h.key.door * h.f0;
      setDoors(h, h.frac);
      if (q.m.anim !== 'idle') q.m.setAnim('idle');
      q.m.update(dt);
      if (h.key.done) { setDoors(h, 0); letGo(q.m, h); h.phase = 'walk'; h.t = 0; q.walk = { from: { x: p.x, y: p.y, z: p.z }, to: q.shut.S }; }
      return;
    }
    // walk from the door to the spot he stands on (where his own model takes over)
    const W = q.walk, d = Math.hypot(W.to.x - W.from.x, W.to.z - W.from.z), T = Math.max(0.2, d / 1.4), k = Math.min(1, h.t / T);
    if (q.m.anim !== 'walk') q.m.setAnim('walk');
    q.m.root.position.set(W.from.x + (W.to.x - W.from.x) * k, W.from.y + (W.to.y - W.from.y) * k, W.from.z + (W.to.z - W.from.z) * k);
    if (d > 0.05) q.m.root.rotation.y = Math.atan2(W.to.x - W.from.x, W.to.z - W.from.z);
    q.m.update(dt);
    if (k >= 1) {
      moving.delete(q); q.m.dispose(); q.m.root.removeFromParent();
      if (q.u.object3d && q.u.state !== 'inVehicle' && !q.u.vehicle) q.u.object3d.visible = true;
    }
  };
  /** Where a man stands to swing a door shut from outside (model frame): just beyond its free edge's arc, half-way round. */
  const shutSpot = (rig) => {
    const P = rig.pivot, mid = doorPoint(rig, rig.frac * 0.5, 'out', new Vector3());
    const dx = mid.x - P[0], dz = mid.z - P[2], l = Math.hypot(dx, dz) || 1, r = rig.len + 0.26;
    return { x: P[0] + (dx / l) * r, y: 0, z: P[2] + (dz / l) * r };
  };
  /**
   * The hand he swings a door shut with, standing at `root` (in `par`) facing the middle of its swing: the one on the
   * side the door shuts toward (it stays on that side of him all the way).
   */
  const shutHand = (rig, root, par) => {
    const E = par.worldToLocal(vis0().localToWorld(doorPoint(rig, rig.frac * 0.5, 'out', new Vector3())));
    const p = root.position, fx = E.x - p.x, fz = E.z - p.z, l = Math.hypot(fx, fz) || 1;
    const C = par.worldToLocal(vis0().localToWorld(doorPoint(rig, 0, 'out', new Vector3())));
    const side = (C.x - p.x) * (fz / l) - (C.z - p.z) * (fx / l); // > 0: the shut door is on his left (+x of his facing)
    return side > 0 ? 'l' : 'r';
  };
  return {
    figures,
    occupants: occ,
    get moving() { return moving; },
    update(dt) {
      if (showOcc && !v.destroyed) syncOccupants();
      const tick = (f, on) => {
        if (on) {
          f.m.update(dt);
          // seated: settle once the clip has blended in (0.35 s of animation; the model steps off screen too)
          if (!f.settled && f.m.real?.inner && (f.t += dt) > 0.35) settle(f);
        }
        const vis = on && f.settled;
        if (f.m.root.visible !== vis) f.m.root.visible = vis;
      };
      for (const f of figures) tick(f, f.c.alive !== false && !v.destroyed);
      for (const f of occ.values()) {
        const on = !v.destroyed && f.u.alive !== false && f.u.vehicle === v;
        if (f.board && on) { boardStep(f, dt); f.m.update(dt); continue; }
        if (f.hand && f.hand.phase !== 'hold' && on) handStep(f, dt);
        tick(f, on);
      }
      for (const q of [...moving]) moveStep(q, dt);
      // men climbing over the tailgate part the rear straps (art/strap-curtain.js): their bodies as they are drawn now
      const frame = v.model.curtainFrame;
      if (frame) {
        const caps = [];
        frame.updateWorldMatrix(true, false);
        for (const q of moving) {
          if (q.kind !== 'bay' || !q.m.root.visible) continue;
          q.m.root.updateMatrixWorld(true);
          bodyCapsules(q.m, frame, caps, q.u.id ?? '');
        }
        if (caps.length || pushed) v.model.curtainPush(caps);
        pushed = caps.length > 0;
      }
    },
    dispose() {
      for (const f of figures) f.m.dispose();
      for (const f of occ.values()) { letGo(f.m, f.hand); f.m.dispose(); }
      for (const q of moving) { q.m.dispose(); if (q.dir === 'out' && q.u.object3d && !q.u.vehicle) q.u.object3d.visible = true; }
      figures.length = 0; occ.clear(); moving.clear();
    },
  };
}
