/**
 * LIGHTS OUT e06 "Thin Ice" mission scripts (docs/expansion/e06.md §9): pure logic over the world, polled by the
 * mission's data triggers (src/missions/expansion/e06_thin_ice.js). Nothing here draws.
 *   - the span master raises the link-span again a while after it comes down, unless he is out cold, cuffed or dead;
 *   - the berth's alarm: the shunting engine pulls out (after a delay) if its driver is awake and free, runs up to the
 *     sealed wagon, couples and pulls it inland; the wagon gone past the yard's end is the mission lost;
 *   - the moles' or the quay's alarm swings the searchlight crew onto the basin;
 *   - the quay's alarm sends the duty officer to the span cabin, where he raises the span if it is down and clear;
 *   - the searchlight tower is out once its crew are dead or cuffed (objective o2).
 * Every rule is derived from saved state (the alarm's `zonesFired`, the drawbridge's `downAt`, the pushables'
 * positions and hauls, the units' knock-out state), so a quick save / load mid-way restores it exactly.
 * Ids are the mission's (E06 below). Timings depend on the difficulty variant (world.mission.difficulty).
 * @module missions/scripts/e06
 */

const deg = (d) => (d * Math.PI) / 180;

export const E06 = Object.freeze({
  span: 'span', spanSwitch: 'span_switch', wagon: 'wag_n', shunter: 'shunter', master: 'k1', engineDriver: 'sh1',
  dutyOfficer: 't1',
  /** The searchlight tower's crew (o2): the two on the deck, and on Hard the man at the ladder's foot. */
  crew: ['sl1', 'sl2', 'sl3'],
  /** The two at the light: on the moles' or the quay's alarm their cone turns from the sea to the basin. */
  lightCrew: ['sl1', 'sl2'],
  basinHeading: deg(90),
  /** The wagon's centre past this z (south) is the wagon gone inland (§9). */
  inlandZ: 106,
  /** Where the engine runs to on the berth track: the yard's south end (its body stays on the map). */
  inland: Object.freeze({ x: 168, z: 116 }),
  /** Shunting speed (m/s) and the coupling slack between the engine's buffers and the wagon's (m). */
  shuntSpeed: 3, slack: 0.4,
  /** How close to the span switch the duty officer must be to work it (m). */
  switchReach: 2.5,
  /** The mission's once trigger that latches the engine's disarm (its count is saved with the game). */
  disarmed: 'shunter_disarmed',
});

const easy = (w) => w?.mission?.difficulty === 'easy';
/** Seconds the span stays down before its master raises it again (Hard 60, Easy 120). */
export const reraiseDelay = (w) => (easy(w) ? 120 : 60);
/** Seconds from the berth's alarm to the shunting engine pulling out (Hard 10, Easy 30). */
export const shuntDelay = (w) => (easy(w) ? 30 : 10);

/** World time of the first alarm event named in `events` (saved: world.alarm.zonesFired), or null. */
export function alarmTime(w, events) {
  const list = Array.isArray(events) ? events : [events];
  const f = (w?.alarm?.zonesFired || []).find((q) => list.includes(q.event));
  return f ? f.t : null;
}

/** A man on his feet and free to act: alive, not knocked out, not cuffed, not on puppet strings. */
export function awake(e) {
  return !!e && e.alive !== false && !e.removed && !e.ko && !e.puppetOf;
}

/** Is (x, z) on the deck of drawbridge `span`? */
function onDeck(span, x, z) {
  const R = span.rect, c = Math.cos(R.rot ?? 0), s = Math.sin(R.rot ?? 0), dx = x - R.x, dz = z - R.z;
  return Math.abs(dx * c + dz * s) <= R.w / 2 && Math.abs(-dx * s + dz * c) <= R.d / 2;
}

/** Nothing on the lowered span (no wagon, no man on its deck): a span master never lifts it under a load. */
export function spanClear(w, span = w.byId(E06.span)) {
  if (!span) return false;
  if ((w.interactables || []).some((p) => p.interactKind === 'pushable' && !p.destroyed && p.overSpan?.(span))) return false;
  return ![...w.commandos, ...w.enemies].some((u) => u.alive !== false && !u.removed && u.state !== 'inVehicle' && onDeck(span, u.x, u.z));
}

/** §9 the span master's timer: the span down for `reraiseDelay`, its master awake and the deck clear. */
export function reraiseDue(w) {
  const span = w.byId(E06.span);
  if (!span || !span.down || span.downAt == null) return false;
  if (w.time - span.downAt < reraiseDelay(w)) return false;
  return awake(w.byId(E06.master)) && spanClear(w, span);
}

/** Somebody works the span switch: the span goes up (5 s). Seeing it move raises nothing. */
export function reraise(w, text = 'The span master is raising the link-span.') {
  const span = w.byId(E06.span);
  if (!span?.down || !span.toggle()) return false;
  w.events.emit('device', { id: E06.spanSwitch, sfx: 'switch_throw', x: span.x, z: span.z, on: true });
  w.events.emit('message', { text, kind: 'hint' });
  return true;
}

/** Has the engine left its spawn (it only ever moves under its own steam: nobody can push it)? */
export function shunterMoved(s) {
  return !!s && Math.hypot(s.x - s.params.x, s.z - s.params.z) > 0.3;
}

/** The shunting engine can make its next move: its driver awake and free, the engine intact and standing. */
export function shunterReady(w) {
  const s = w.byId(E06.shunter);
  return awake(w.byId(E06.engineDriver)) && !!s && !s.destroyed && !s.removed && !s.hauling;
}

/** Is the wagon still on the berth track south of the span's end (where the engine can reach it)? */
export function wagonOnBerth(w) {
  const g = w.byId(E06.wagon);
  return !!g && !g.destroyed && !g.dropped && !g.removed;
}

/** Has the mission's once trigger `id` fired? Its count is saved with the game (setpiece-triggers TriggerState). */
export function triggerFired(w, id) {
  const dir = w?.setpieces, t = dir?.triggers?.find((q) => q.id === id);
  return !!(t && dir.tstate?.fired?.[t.k]);
}

/**
 * §9 "With sh1 bound or the shunter destroyed, the script never starts": the moment the engine's driver is cuffed (or
 * on strings), dead, or the engine wrecked. The mission's once trigger `E06.disarmed` latches it — a berth squad that
 * cuts the driver loose later does not set the engine going again.
 */
export function shuntDisarmNow(w) {
  const d = w.byId(E06.engineDriver), s = w.byId(E06.shunter);
  if (!s || s.destroyed || s.removed) return true;
  return !d || d.alive === false || d.removed || d.ko === 'bound' || !!d.puppetOf;
}
/** The disarm's word to the player (the trigger's `run`). */
export function shuntDisarmed(w) {
  const d = w.byId(E06.engineDriver), s = w.byId(E06.shunter);
  const text = !s || s.destroyed ? 'The shunting engine is wrecked: it will not pull the wagon anywhere.'
    : !d || d.alive === false ? 'The engine driver is dead: the shunting engine will not pull out.'
      : 'The engine driver is in cuffs: the shunting engine will not pull out now.';
  w.events.emit('message', { text, kind: 'info' });
  return true;
}

/**
 * §9 the engine's next move is due: the berth's alarm sounded `shuntDelay` ago (or it is already underway), its
 * driver is awake and free, it is standing short of the yard's end, and it was never disarmed (`shuntDisarmNow`).
 */
export function shuntDue(w) {
  if (triggerFired(w, E06.disarmed)) return false;
  if (!shunterReady(w)) return false;
  const s = w.byId(E06.shunter);
  if (s.z >= E06.inland.z - 0.05) return false; // run out to the yard's end: done
  if (shunterMoved(s)) return true; // underway: the next leg
  const t0 = alarmTime(w, 'RB');
  return t0 != null && w.time - t0 >= shuntDelay(w);
}

/**
 * The engine's next leg: with the wagon gone into the harbour it leaves alone; else it runs up to the wagon (wherever
 * the wagon now stands), or, buffers to buffers, couples and pulls it south. Returns 'alone' | 'runUp' | 'pull' | null.
 */
export function shuntLeg(w) {
  if (!shunterReady(w)) return null;
  const s = w.byId(E06.shunter), g = w.byId(E06.wagon);
  if (!shunterMoved(s)) w.events.emit('message', { text: 'The shunting engine is pulling out!', kind: 'warn' });
  if (!wagonOnBerth(w)) { s.haul({ x: s.x, z: E06.inland.z }, E06.shuntSpeed); return 'alone'; }
  const gap = (s.z - s.size[0] / 2) - (g.z + g.size[0] / 2);
  if (gap > E06.slack + 0.3) { // runs up to the wagon first
    s.haul({ x: s.x, z: g.z + g.size[0] / 2 + s.size[0] / 2 + E06.slack }, E06.shuntSpeed);
    return 'runUp';
  }
  s.haul({ x: s.x, z: E06.inland.z }, E06.shuntSpeed, [g]);
  w.events.emit('message', { text: 'The engine has coupled up to the sealed wagon.', kind: 'warn' });
  return 'pull';
}

/** §9 the wagon is lost: its centre past the yard's end on its way inland. */
export function wagonInland(w) {
  const g = w.byId(E06.wagon);
  return !!g && !g.destroyed && g.z > E06.inlandZ;
}

/** o2: every searchlight crewman placed in this variant is dead or cuffed. */
export function searchlightOut(w) {
  const crew = E06.crew.map((id) => w.byId(id)).filter(Boolean);
  return crew.length > 0 && crew.every((e) => e.alive === false || e.removed || e.ko === 'bound');
}

/** The moles' or the quay's alarm has sounded and a man at the light still looks out to sea. */
export function swingDue(w) {
  if (alarmTime(w, ['RM', 'RQ']) == null) return false;
  return E06.lightCrew.some((id) => { const e = w.byId(id); return e?.alive && e.post && e.post.heading !== E06.basinHeading; });
}
/** The searchlight swings onto the basin: the crew's posts turn south (their brains turn them to it). */
export function swingCrew(w) {
  for (const id of E06.lightCrew) { const e = w.byId(id); if (e?.post) e.post.heading = E06.basinHeading; }
  return true;
}

/** §8 the quay's alarm: the duty officer has reached the span switch, the span is down and nothing is on it. */
export function dutyRaiseDue(w) {
  if (alarmTime(w, 'RQ') == null) return false;
  const t = w.byId(E06.dutyOfficer), sw = w.byId(E06.spanSwitch), span = w.byId(E06.span);
  if (!awake(t) || !sw || !span?.down) return false;
  return Math.hypot(t.x - sw.x, t.z - sw.z) <= E06.switchReach && spanClear(w, span);
}
