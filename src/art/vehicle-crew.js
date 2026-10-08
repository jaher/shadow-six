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
  const moving = new Set(); // figures getting in / out (cab seats after they left, the lorry bay)
  const now = () => v.world?.time ?? 0;
  const groundAt = (x, z) => v.world?.groundY?.(x, z) || 0;
  const localOf = (obj, x, y, z) => { obj.updateWorldMatrix(true, false); const p = obj.worldToLocal(_v.set(x, y, z)); return { x: p.x, y: p.y, z: p.z }; };
  /** He just got in from (near) here — show the climb (not on a load, a quick-load or a scripted spawn inside). */
  const fresh = (u) => { const b = u.boardFrom; return b && !b.swim && now() - b.t < 1 && now() > 0.3 && !u.downed && Math.hypot(b.x - v.x, b.z - v.z) < 8 ? b : null; };
  const vis0 = () => v.model.visual?.object3d || v.model.root;
  /** Lorry bay points in the model frame: on top of the tailgate, inside under the canvas. */
  const bay = () => {
    const meta = v.model.meta, tg = meta?.parts?.find((p) => p.kind === 'tailgate')?.pivot, cb = meta?.sockets?.find((q) => /cargo|bay/.test(q.name))?.pos;
    const zt = tg ? tg[2] : -(v.model.dims?.l || 6) / 2, yt = tg ? tg[1] + 0.05 : 1.15;
    return { G: { x: 0, y: yt, z: zt + 0.15 }, B: { x: 0, y: (cb?.[1] ?? yt) - 0.05, z: cb ? Math.min(cb[2], zt + 1.4) : zt + 1.4 } };
  };
  const startBay = (u, dir, at) => {
    const m = createUnitModel(lookOf(u));
    if (!m.isReal) { m.dispose?.(); return; }
    const par = vis0();
    par.add(m.root);
    const S = localOf(par, at.x, groundAt(at.x, at.z), at.z), { G, B } = bay();
    m.root.position.set(dir === 'in' ? S.x : B.x, dir === 'in' ? S.y : B.y, dir === 'in' ? S.z : B.z);
    m.ready?.then?.(() => m.real?.setWeapon?.(null));
    if (dir === 'out' && u.object3d) u.object3d.visible = false;
    moving.add({ m, u, dir, t: 0, kind: 'bay', S, G, B, par });
  };
  let prev = [], prevSeat = new Map();
  const seatOf = (u) => (v.seatOf ? v.seatOf(u) : (v.occupants || []).indexOf(u));
  const syncOccupants = () => {
    const list = v.occupants || [];
    for (const [u, f] of occ) {
      if (list.includes(u) && f.k === seatOf(u)) continue;
      occ.delete(u);
      // he got out at his door: the seated figure climbs down to where he stands, then his own model takes over
      // (a commando, who stands where he got out; an enemy rider sent off on an errand walks off at once)
      const out = !list.includes(u) && u.vehicle !== v && u.alive !== false && !u.downed && f.settled && !v.destroyed
        && u.faction === 'player' && Number.isFinite(u.x) && Math.hypot(u.x - v.x, u.z - v.z) < 7;
      if (!out) { f.m.dispose(); f.m.root.removeFromParent(); continue; }
      const par = f.m.root.parent, Z = { x: f.m.root.position.x, y: f.m.root.position.y, z: f.m.root.position.z };
      const S = localOf(par, u.x, groundAt(u.x, u.z), u.z), D = { x: S.x * 0.35, y: Math.max(S.y, -0.55), z: S.z * 0.35 };
      if (u.object3d) u.object3d.visible = false;
      f.m.root.visible = true;
      moving.add({ m: f.m, u, dir: 'out', t: 0, kind: 'seat', S, D, Z, par, yaw: f.m.root.rotation.y });
    }
    // lorry passengers: in over the tailgate, out the same way
    for (const u of list) if (!prev.includes(u) && !v.model.seatHolder(seatOf(u)) && fresh(u)) startBay(u, 'in', fresh(u));
    for (const u of prev) {
      if (list.includes(u) || occ.has(u) || u.vehicle === v || u.alive === false || u.downed || v.destroyed) continue;
      if (u.faction === 'player' && !v.model.seatHolder(prevSeat.get(u)) && Number.isFinite(u.x) && Math.hypot(u.x - v.x, u.z - v.z) < 9) startBay(u, 'out', { x: u.x, z: u.z });
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
      }
      occ.set(u, f);
    });
  };
  /** One frame of a figure getting in (its seated pose measured once it starts to sit). */
  const boardStep = (f, dt) => {
    const b = f.board;
    b.t += dt;
    if (!b.Z && b.t >= BOARD_TIMES.wait + BOARD_TIMES.climb) {
      // he lowers himself onto the seat: the seated clip blends in on the way down; the exact seated spot is measured
      // (settle) once it has, a few cm from this estimate (pelvis ~0.45 m over the feet, ~0.27 m behind them)
      f.m.setAnim(f.seat.anim);
      b.Z = { x: 0, y: -(0.45 - HIP_ABOVE_SEAT), z: 0.27 };
    }
    const r = seatMotion('in', b.t, b.S, b.D, b.Z || b.D);
    if (r.clip === 'climb' && f.m.anim !== 'climb') f.m.setAnim('climb');
    f.m.root.position.set(r.p.x, r.p.y, r.p.z);
    const k = r.seated ? Math.min(1, (b.t - BOARD_TIMES.wait - BOARD_TIMES.climb) / BOARD_TIMES.sit) : 0;
    const yaw0 = Math.atan2(-b.S.x, -b.S.z);
    f.m.root.rotation.y = yaw0 * (1 - smooth(k));
    if (r.done) { f.board = null; f.m.root.rotation.y = 0; settle(f); }
  };
  /** One frame of a figure on its way in / out that is no longer a seated occupant. */
  const moveStep = (q, dt) => {
    q.t += dt;
    q.m.update(dt);
    let r;
    if (q.kind === 'bay') r = tailgateMotion(q.dir, q.t, q.S, q.G, q.B);
    else r = seatMotion('out', q.t, q.S, q.D, q.Z);
    const clip = r.clip === 'seat' ? 'idle' : r.clip;
    if (q.m.anim !== clip) q.m.setAnim(clip);
    q.m.root.position.set(r.p.x, r.p.y, r.p.z);
    const to = q.dir === 'in' ? (r.clip === 'climb' ? q.G : q.B) : q.S, from = q.m.root.position;
    if (Math.hypot(to.x - from.x, to.z - from.z) > 0.05) q.m.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    q.m.root.visible = true;
    // getting out: he is given an order before the figure is down — his own model takes over at once
    const gone = q.dir === 'out' && (q.u.vehicle || (q.at && Math.hypot(q.u.x - q.at.x, q.u.z - q.at.z) > 0.3));
    q.at ||= { x: q.u.x, z: q.u.z };
    if (r.done || gone || v.destroyed || q.u.alive === false) {
      moving.delete(q);
      q.m.dispose(); q.m.root.removeFromParent();
      // out: his own model takes over where the figure stops (in: he is under the canvas now)
      if (q.dir === 'out' && q.u.object3d && q.u.state !== 'inVehicle' && !q.u.vehicle) q.u.object3d.visible = true;
    }
  };
  return {
    figures,
    occupants: occ,
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
        if (f.board && on) { f.m.update(dt); boardStep(f, dt); continue; }
        tick(f, on);
      }
      for (const q of [...moving]) moveStep(q, dt);
    },
    dispose() {
      for (const f of figures) f.m.dispose();
      for (const f of occ.values()) f.m.dispose();
      for (const q of moving) { q.m.dispose(); if (q.dir === 'out' && q.u.object3d && !q.u.vehicle) q.u.object3d.visible = true; }
      figures.length = 0; occ.clear(); moving.clear();
    },
  };
}
