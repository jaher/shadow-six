/**
 * Data triggers for set-piece missions (MISSIONS). `mission.triggers[]`:
 *   {on, match?, when?, once?=true, delay?=0, do:[action...]}
 *   on    — any bus event name ('vehicle:enter', 'alarm:zone', 'unit:killed', 'structure:destroyed', …), or
 *           'start' (first tick), 'tick' (polled at 20 Hz, needs `when`), 'area' (polled: `area` {poly|x,z,r|rect}
 *           entered by `who` 'commando'|'enemy'|'any' / `roles`), 'objective' (match {id, status:'done'|'failed'}).
 *   match — {field: want | [wants]}: entity-valued payload fields match by tag, id, role, vehicleType,
 *           soldierType or guestId; plain fields by equality.
 *   when  — (payload, world, director) → bool extra guard.
 * Actions (one verb key each): {fail}, {message, kind?}, {alarm: zoneId|'global', cause?}, {event: 'NAME'},
 *   {objective: id, set:'done'|'failed'|'show'|'hide'}, {door: id, open}, {drive: vehicleId, to:[[x,z]...], speed?},
 *   {send: enemyId|[ids], to:[[x,z]...], loop?:[[x,z]...]}, {hunt: vehicleId, target: id, range?},
 *   {spawnVehicle: type, spawn:{...}}, {setpiece: id, call: 'method', args?:[]}, {noise:{x,z,radius,kind}},
 *   {kill: id}, {taint: vehicleId}, {run: (world, director, payload) => void}.
 * @module missions/setpiece-triggers
 */

import { SetPiece, inArea } from './setpiece-base.js';

/** Hidden set-piece carrying the saved trigger state (fired counts, pending delayed actions, hunts). */
export class TriggerState extends SetPiece {
  constructor(spec) {
    super(spec);
    this.fired = {};
    this.pending = [];
    this.hunts = [];
    this.inside = {};
  }
  save() { return { fired: { ...this.fired }, pending: this.pending.map((p) => ({ k: p.k, t: p.t })), hunts: this.hunts.map((h) => ({ ...h })), inside: { ...this.inside } }; }
  load(s) {
    this.fired = { ...(s.fired || {}) };
    this.pending = (s.pending || []).map((p) => ({ ...p }));
    this.hunts = (s.hunts || []).map((h) => ({ ...h }));
    this.inside = { ...(s.inside || {}) };
  }
}

const ENTITY_KEYS = ['tag', 'id', 'role', 'vehicleType', 'soldierType', 'guestId'];

/** Does payload value `v` match `want` (scalar or array)? */
export function matchValue(v, want) {
  if (Array.isArray(want)) return want.some((w) => matchValue(v, w));
  if (v && typeof v === 'object') {
    if (ENTITY_KEYS.some((k) => v[k] != null && v[k] === want)) return true;
    return v.def?.type === want; // canonical vehicle type (tank → panzer2)
  }
  return v === want;
}

export function matches(payload, match) {
  if (!match) return true;
  for (const [k, want] of Object.entries(match)) if (!matchValue(payload?.[k], want)) return false;
  return true;
}

function fire(dir, t, payload) {
  const st = dir.tstate;
  const once = t.once !== false;
  if (once && st.fired[t.k]) return;
  if (t.when && !t.when(payload, dir.world, dir)) return;
  st.fired[t.k] = (st.fired[t.k] || 0) + 1;
  if (t.delay > 0) st.pending.push({ k: t.k, t: t.delay, payload });
  else runActions(dir, t.do || [], payload);
}

/** Subscribe every event trigger (called once, on the director's first tick). */
export function installTriggers(dir) {
  const w = dir.world;
  for (const t of dir.triggers) {
    if (t.on === 'start') fire(dir, t, {});
    else if (t.on === 'tick' || t.on === 'area') continue; // polled in runDelayed
    else if (t.on === 'objective') {
      w.listen('objective:update', ({ objective: o }) => {
        const status = o.done ? 'done' : o.failed ? 'failed' : null;
        if (matches({ id: o.id, status }, t.match)) fire(dir, t, { objective: o });
      });
    } else w.listen(t.on, (p) => { if (matches(p, t.match)) fire(dir, t, p); });
  }
}

const areaWho = (t, u) => {
  if (!u.alive || u.removed) return false;
  if (t.roles) return t.roles.includes(u.role);
  const who = t.who || 'commando';
  return who === 'any' || (who === 'commando' ? u.faction === 'player' : u.faction === 'enemy');
};

/** Per 20 Hz tick: delayed actions, polled triggers, hunts. */
export function runDelayed(dir, dt) {
  const st = dir.tstate;
  if (!st) return;
  const w = dir.world;
  for (const p of [...st.pending]) {
    p.t -= dt;
    if (p.t > 1e-9) continue;
    st.pending.splice(st.pending.indexOf(p), 1);
    const t = dir.triggers.find((x) => x.k === p.k);
    if (t) runActions(dir, t.do || [], p.payload || {});
  }
  for (const t of dir.triggers) {
    if (t.on === 'tick') fire(dir, t, {});
    else if (t.on === 'area') {
      const u = [...w.commandos, ...w.enemies].find((x) => areaWho(t, x) && x.state !== 'inVehicle' && inArea(t.area, x.x, x.z));
      const was = !!st.inside[t.k];
      st.inside[t.k] = !!u;
      if (u && !was) fire(dir, t, { unit: u });
    }
  }
  for (const h of st.hunts) {
    const v = w.byId(h.vehicle), tg = w.byId(h.target);
    if (!v || v.destroyed || !tg || tg.destroyed || tg.alive === false) continue;
    if (Math.hypot(v.x - tg.x, v.z - tg.z) <= (h.range ?? 40)) v.fireAt?.(tg);
  }
}

// actions live in setpiece-actions.js
import { runActions } from './setpiece-actions.js';
export { runActions };
