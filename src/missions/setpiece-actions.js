/**
 * Trigger actions (see setpiece-triggers.js for the verb list). Owned by MISSIONS.
 * @module missions/setpiece-actions
 */

const pt = (p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z });
const ids = (v) => [].concat(v ?? []);

/** Run a list of actions. Unknown verbs throw (caught by validateSetpieces at load in tests). */
export function runActions(dir, list, payload = {}) {
  for (const a of list) {
    try { runAction(dir, a, payload); } catch (err) { console.error('[setpieces] action failed', a, err); }
  }
}

export function runAction(dir, a, payload) {
  const w = dir.world;
  const ev = w.events;
  if (a.fail !== undefined) return dir.fail(a.fail);
  if (a.message !== undefined) return ev.emit('message', { text: a.message, kind: a.kind || 'info' });
  if (a.alarm !== undefined) {
    const x = a.x ?? payload?.x ?? payload?.unit?.x ?? 0, z = a.z ?? payload?.z ?? payload?.unit?.z ?? 0;
    return w.alarm?.raise(a.alarm, a.cause || 'script', x, z, { sensor: 'seen' });
  }
  if (a.event !== undefined) return w.alarm?.fireEvent(a.event, { zoneId: a.zone ?? null, cause: a.cause || 'script', x: a.x ?? 0, z: a.z ?? 0 });
  if (a.objective !== undefined) {
    const o = (w.objectives || []).find((x) => x.id === a.objective);
    if (!o) return;
    const set = a.set || 'done';
    if (set === 'done') { o.done = true; o.hidden = false; } else if (set === 'failed') o.failed = true;
    else if (set === 'show') o.hidden = false; else if (set === 'hide') o.hidden = true;
    return ev.emit('objective:update', { objective: o });
  }
  if (a.door !== undefined) return ids(a.door).forEach((id) => w.byId(id)?.setOpen?.(a.open !== false));
  if (a.drive !== undefined) {
    const v = w.byId(a.drive);
    if (!v || v.destroyed) return;
    v.brain && (v.brain.state = 'done'); // the scripted drive overrides patrol/standby
    return v.followPath((a.to || []).map(pt), { speed: a.speed });
  }
  if (a.send !== undefined) {
    for (const id of ids(a.send)) {
      const e = w.byId(id);
      if (e?.alive && e.brain?.reinforce) e.brain.reinforce((a.to || []).map(pt), (a.loop || []).map(pt));
    }
    return;
  }
  if (a.hunt !== undefined) return dir.tstate?.hunts.push({ vehicle: a.hunt, target: a.target, range: a.range ?? 40 });
  if (a.spawnVehicle !== undefined) return w.spawnVehicle?.(a.spawnVehicle, { ...(a.spawn || {}) });
  if (a.setpiece !== undefined) {
    const p = dir.get(a.setpiece);
    return p?.[a.call]?.(...(a.args || []));
  }
  if (a.noise !== undefined) return w.emitNoise(a.noise.x, a.noise.z, a.noise.radius ?? 20, a.noise.kind || 'horn', null, a.noise.level);
  if (a.kill !== undefined) return ids(a.kill).forEach((id) => { const u = w.byId(id); if (u?.alive) u.die?.(a.cause || 'script', null); });
  if (a.taint !== undefined) return w.byId(a.taint)?.taint?.(null);
  if (typeof a.run === 'function') return a.run(w, dir, payload);
  throw new Error(`[setpieces] unknown action ${JSON.stringify(Object.keys(a))}`);
}

/** Verbs understood by runAction (schema validation). */
export const ACTION_VERBS = ['fail', 'message', 'alarm', 'event', 'objective', 'door', 'drive', 'send', 'hunt', 'spawnVehicle', 'setpiece', 'noise', 'kill', 'taint', 'run'];
