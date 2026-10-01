/**
 * BEL Mission 18 "The Force of Circumstance": mission-local helpers (docs/missions/m18.md §6.2, §10, §11, §14).
 * Owned by MISSIONS.
 *
 *  - MARKERS: the three weak points of the span (A, B, C). The `multi_charge` set-piece (window 1e9, bombs and
 *    shells) keeps each hit and drops the bridge on the third;
 *  - m18Tick(world) (per 20 Hz tick, idempotent, safe after a quick load):
 *      · the team starts prone behind the SE wall (the spawn `stance` is not read by the engine);
 *      · the Panzer III ignores every explosion (only the fallen span can take it);
 *      · the first time the Sapper holds the German charges: say what they are for (dossier §11 T1);
 *      · a marker hit for the first time: "Charge A has gone off (1 of 3)." (T4, read from the set-piece);
 *      · the scripted drive-off: the straight [exit, leave] run the engine starts is replaced by a path-found one,
 *        so a lorry boarded anywhere still gets out by the S road; the win is recorded at boarding (`drivenOff`, as M16);
 *  - onBridgeDown(world): the span is gone (the deck over the river reverts to deep water): anyone standing on it
 *    goes down with it, and a vehicle left on it is lost with its crew.
 * @module missions/scripts/m18
 */

import { T } from '../../world/grid.js';

/** Deck ends of the truss bridge (m16.md §5.1) and its half width. */
export const DECK = { a: { x: 25.7, z: 54 }, b: { x: 91.5, z: 108.5 }, half: 4.5 };
/** Demolition markers A/B/C on the deck (dossier §5.1; C pulled 2 m in from the S girder). */
export const MARKERS = [
  { id: 'A', x: 51.5, z: 78.5, r: 3 },
  { id: 'B', x: 63.5, z: 88.5, r: 3 },
  { id: 'C', x: 77.3, z: 99.3, r: 3 },
];

/** Distance from (x, z) to the deck axis. */
export function deckDistance(x, z) {
  const { a, b } = DECK, dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function state(w) {
  w._m18 ||= { bombsSaid: false, said: {} };
  return w._m18;
}

function tickBombs(w, s) {
  if (s.bombsSaid) return;
  const sa = (w.commandos || []).find((c) => c.role === 'sapper' && c.alive !== false);
  if (!sa || !((sa.inventory?.get?.('remoteBomb') ?? 0) > 0)) return;
  s.bombsSaid = true;
  w.events.emit('message', { text: 'Three German charges. One on each marked point of the bridge.', kind: 'info' });
}

function tickMarkers(w, s) {
  const sp = w.byId?.('abc');
  if (!sp?.hits) return;
  const hit = MARKERS.filter((m) => sp.hits[m.id] != null);
  for (const m of hit) {
    if (s.said[m.id]) continue;
    s.said[m.id] = true;
    if (hit.length < 3) w.events.emit('message', { text: `Charge ${m.id} has gone off (${hit.length} of 3).`, kind: 'info' });
  }
}

/**
 * The drive-off starts (the engine's leave run: o1 done, everyone aboard). Dossier §10.2: the win is recorded at
 * boarding (M18 review g1: the path-found run pushed through P41/P40, the dodge rule tainted the lorry and an MP40
 * lost a won mission). `drivenOff` latches `passedExit`, so o2 completes on this tick's objective check; the drive,
 * replaced by a path-found one to the S road exit, is scenery (as M16).
 */
function tickDriveOff(w) {
  const ex = w.mission?.extraction, v = ex && w.byId?.(ex.vehicleId);
  if (!v || v.destroyed || !v.path?.length || !ex.leave) return;
  const last = v.path[v.path.length - 1];
  if (v._m18Routed || Math.hypot(last.x - ex.leave.x, last.z - ex.leave.z) > 0.5) return;
  v._m18Routed = true;
  v.drivenOff = true;
  const road = w.findPath?.(v.x, v.z, ex.exit.x, ex.exit.z, { swim: false }) || [{ x: ex.exit.x, z: ex.exit.z }];
  v.followPath([...road.map((p) => ({ x: p.x, z: p.z })), { x: ex.leave.x, z: ex.leave.z }], { speed: ex.leave.speed });
}

/** The Panzer III: "completely indestructible to everything else in this mission" [ooc] (bombs and shells too). */
export const TANK = 'pz3';
function tickTank(w) {
  const v = w.byId?.(TANK);
  if (!v || v._m18Immune) return;
  v._m18Immune = true;
  v.explosionHit = () => false;
}

/** "Begin by dropping everybody prone" [P]: the team starts crawling behind the SE wall (first tick only). */
function tickStart(w, s) {
  if (s.proned) return;
  s.proned = true;
  if ((w.time ?? 0) > 0.5) return; // a quick load keeps whatever stance the player chose
  for (const c of w.commandos || []) if (c.alive !== false && c.stance === 'stand') c.setStance?.('crawl');
}

/** Per-tick mission glue (trigger `tick`, once: false). */
export function m18Tick(world) {
  const s = state(world);
  tickStart(world, s);
  tickTank(world);
  tickBombs(world, s);
  tickMarkers(world, s);
  tickDriveOff(world);
}

/** Is (x, z) on the fallen span: within the deck and over what is now open water? */
export function onFallenSpan(w, x, z) {
  if (deckDistance(x, z) > DECK.half + 0.5) return false;
  const g = w.grid, i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  return g.inBounds(i, j) && g.terrain[g.idx(i, j)] === T.WATER && !g.bridge[g.idx(i, j)];
}

/** The span has fallen (structure:destroyed 'bridge'). */
export function onBridgeDown(w) {
  for (const v of w.vehicles || []) {
    if (v.removed || v.destroyed || v.def?.kind !== 'land' || !onFallenSpan(w, v.x, v.z)) continue;
    for (const u of [...(v.occupants || [])]) u.takeDamage?.(1e5, null, 'explosion');
    v.destroy?.(null, 'explosion');
  }
  for (const u of [...(w.commandos || []), ...(w.enemies || [])]) {
    if (!u.alive || u.removed || u.state === 'inVehicle' || u.role === 'diver') continue;
    if (onFallenSpan(w, u.x, u.z)) u.takeDamage?.(1e5, null, 'explosion');
  }
  w.events.emit('message', { text: 'The span goes into the Maas.', kind: 'info' });
}
