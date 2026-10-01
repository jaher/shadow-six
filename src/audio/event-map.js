/**
 * Canonical event → sound handlers (the runtime side of sfx-events.js). Each handler resolves the
 * payload to §9.3 SFX ids / §9.4 voice keys and calls the audio object's playSfx / startLoop / say.
 * @module audio/event-map
 */

import { SFX } from './manifest.js';

/** CONFIG.weapons keys (and vehicle weapons) → shot SFX. */
export const WEAPON_SFX = Object.freeze({
  pistol: 'pistol_shot', rifle: 'rifle_shot', sniper: 'sniper_shot', smg: 'smg_burst', thompson: 'smg_burst',
  mp40: 'mp40_burst', mg: 'mg_burst', mg42: 'mg_burst', machinegun: 'mg_burst', harpoon: 'harpoon_fire',
  tank_mg: 'tank_mg', tankmg: 'tank_mg', boat_mg: 'boat_mg', cannon: 'tank_cannon', tank_cannon: 'tank_cannon',
  torpedo: 'torpedo_launch', grenade: 'grenade_throw',
});
export function weaponSfx(w) {
  const k = String(w || 'rifle').toLowerCase();
  return WEAPON_SFX[k] || (k.includes('mg') ? 'mg_burst' : k.includes('pistol') ? 'pistol_shot' : k.includes('sniper') ? 'sniper_shot' : 'rifle_shot');
}

/** Ability id (substring match, first wins) → [start sfx, end sfx]. */
const ABILITY_SFX = [
  ['dig', ['dig_snow', null]], ['bury', ['dig_snow', null]], ['carry', ['body_drag', 'body_drop']], ['drag', ['body_drag', 'body_drop']],
  ['barrel', ['barrel_lift', 'barrel_set']], ['bomb', ['bomb_plant', null]], ['trap', ['trap_set', null]],
  ['cutter', ['cutters_snip', null]], ['wire', ['cutters_snip', null]], ['raft', ['raft_inflate', 'raft_deflate']],
  ['syringe', ['syringe', null]], ['inject', ['syringe', null]], ['knife', ['knife_stab', null]], ['grenade', ['grenade_pin', null]],
  ['pistol', ['pistol_draw', 'pistol_holster']], ['decoy', ['decoy_beep', null]], ['switch', ['switch_throw', null]],
  ['valve', ['valve_turn', null]], ['climb', ['climb_scrape', null]],
];
export function abilitySfx(id, phase) {
  const k = String(id || '').toLowerCase();
  const row = ABILITY_SFX.find(([m]) => k.includes(m));
  return row ? row[1][phase === 'end' ? 1 : 0] : null;
}
/** Ability id → role special_* voice key (§9.4). */
const ABILITY_VOICE = { decoy: 'special_decoy', dig: 'special_dig', barrel: 'special_barrel', raft: 'special_raft', dive: 'special_dive',
  detonat: 'special_detonate', drive: 'special_drive', heal: 'special_heal', uniform: 'special_uniform', distract: 'special_distract' };
function abilityVoice(id) {
  const k = String(id || '').toLowerCase();
  const m = Object.keys(ABILITY_VOICE).find((s) => k.includes(s));
  return m ? ABILITY_VOICE[m] : 'ack_act';
}

/** Vehicle type → [start one-shot, idle loop, drive loop]. */
export function vehicleSfx(v) {
  const t = String(v?.type || v?.vehicleType || '').toLowerCase();
  if (t.includes('tank') || t.includes('halftrack')) return [null, 'tank_engine', 'tank_tracks'];
  if (t.includes('boat') || t.includes('launch')) return [null, 'boat_engine', 'boat_engine'];
  if (t.includes('raft')) return [null, null, null];
  if (t.includes('motor') || t.includes('bike')) return [null, 'motorbike', 'motorbike'];
  if (t.includes('autogyro')) return [null, 'autogyro', 'autogyro'];
  if (t.includes('plane')) return [null, 'plane_engine', 'plane_engine'];
  if (v?.vehicleKind === 'emplacement') return [null, null, null];
  return ['truck_start', 'truck_idle', 'truck_drive'];
}

/**
 * Per-vehicle engine audible radius (m) from the mission spawn (`engineAudible`, e.g. M2 pboat 60 m,
 * §7.5 "Engine audible at 60 m"), or undefined → the generic view-width falloff.
 */
export function engineRange(v) {
  const r = Number(v?.spawn?.engineAudible ?? v?.engineAudible);
  return r > 0 ? r : undefined;
}

const STEP_TERRAIN = { snow: 'step_snow', sand: 'step_sand', mud: 'step_grass', grass: 'step_grass', road: 'step_road',
  rock: 'step_road', gravel: 'step_road', concrete: 'step_road', wood: 'step_wood', water: 'step_water', shallow: 'step_water' };
export function stepSfx(terrain, stance) {
  if (stance === 'crawl') return 'crawl_rustle';
  return STEP_TERRAIN[String(terrain || '').toLowerCase()] || 'step_grass';
}

const THEATER_STEP = { snow: 'step_snow', desert: 'step_sand' };
const ROLES = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'];
/**
 * What a mission needs decoded (per-mission loading, realism-pipeline v2 §1.5.0): every one-shot the
 * gameplay can emit, footsteps only for the surfaces present, vehicle engines only for the vehicle types
 * present, water foley only with water; beds are streamed and excluded here. `speakers` = voice packs.
 * @returns {{ids:string[], speakers:string[]}}
 */
export function missionAudio(def = {}) {
  const terr = (def.terrain || []).map((t) => String(t.terrain || '').toLowerCase());
  const water = !!def.water || terr.some((t) => t === 'water' || t === 'shallow');
  const ids = new Set();
  for (const [id, d] of Object.entries(SFX)) {
    if (d.bed || /^step_/.test(id) || d.cls === 'vehicle') continue;
    if (!water && /^(underwater|dive_|row_stroke|splash_|raft_|bullet_impact_water)/.test(id)) continue;
    ids.add(id);
  }
  ids.add(THEATER_STEP[def.theater] || 'step_grass');
  for (const t of terr) { const st = STEP_TERRAIN[t]; if (st) ids.add(st); }
  ['step_road', 'step_wood', 'crawl_rustle'].forEach((i) => ids.add(i));
  for (const v of def.vehicles || []) for (const i of vehicleSfx(v)) if (i) ids.add(i);
  if ((def.vehicles || []).some((v) => /train/.test(String(v.type || v.vehicleType)))) ids.add('train_pass');
  const roles = new Set((def.commandos || []).map((c) => c.role).filter((r) => ROLES.includes(r)));
  const speakers = [...(roles.size ? roles : ROLES), 'ger'];
  return { ids: [...ids], speakers };
}

/** Enemy brain state → German bark (§9.4) on entering it. */
export const STATE_BARK = Object.freeze({
  INVESTIGATE: 'ger_suspicious', TRACKS: 'ger_suspicious', DECOY: 'ger_suspicious', COMBAT: 'ger_combat',
  ARREST: 'ger_arrest', DISTRACTED: 'ger_distracted', ALARM_RUN: 'courier',
  suspicious: 'ger_suspicious', investigate: 'ger_suspicious', combat: 'ger_combat',
});
const SILENT_KILLS = new Set(['knife', 'syringe', 'strangle', 'garrote', 'harpoon', 'trap']);
const key = (o, p) => `${p}:${o?.id ?? o?.tag ?? `${Math.round(o?.x ?? 0)},${Math.round(o?.z ?? 0)}`}`;
const isCommando = (u) => u?.kind === 'commando';
const isEnemy = (u) => u?.kind === 'enemy';

/**
 * Subscribe every SFX/voice handler. Returns the unsubscribe functions.
 * @param {object} a the audio object (createAudio)
 * @param {import('../core/events.js').EventBus} events
 */
export function installHandlers(a, events) {
  const subs = [];
  const on = (t, fn) => subs.push(events.on(t, (e = {}) => fn(e, t)));
  const sfx = (id, pos, event, o) => id && a.playSfx(id, pos, { event, ...o });

  // Wind (step 4w): gust whooshes (ambience bus, gated by "nature sounds") and the halyard clank at flags
  on('wind:gust', (e, t) => { if (a.options?.natureSounds !== false) sfx('wind_gust', null, t, { bus: 'ambience', gain: Math.min(1.5, (0.35 + (e.gust || 0)) * Math.min(1.6, (e.speed || 6) / 7)), dedupe: 0 }); });
  on('wind:flag', (e, t) => sfx('flag_clank', e, t, { gain: 0.6 + 0.4 * Math.min(1, e.gust || 0) }));
  // Movement / bodies
  on('unit:step', (e, t) => { a.lastStepEvent = a.now(); sfx(stepSfx(e.terrain, e.stance ?? e.unit?.stance), e.unit, t); });
  on('footprint', (e, t) => { if (a.now() - a.lastStepEvent > 2) sfx(stepSfx(e.terrain), e, t, { gain: 0.8 }); });
  on('unit:stance', (e, t) => { if ((e.stance ?? e.to) === 'crawl') sfx('crawl_rustle', e.unit, t); });
  on('unit:climb', (e, t) => sfx(e.kind === 'ladder' ? 'ladder' : 'climb_scrape', e.unit, t));
  on('ability:start', (e, t) => sfx(abilitySfx(e.id, 'start'), e.target && Number.isFinite(e.target.x) ? e.target : e.unit, t));
  on('ability:end', (e, t) => sfx(abilitySfx(e.id, 'end'), e.unit, t));
  // Water
  on('unit:water', (e, t) => {
    const u = e.unit, k = key(u, 'uw');
    if (e.what === 'enter') sfx('splash_in', u, t);
    else if (e.what === 'exit') { sfx('splash_out', u, t); a.stopLoop(k); }
    else if (e.what === 'dive') { sfx('dive_bubbles', u, t); a.startLoop(k, 'underwater_loop', u, { follow: u, event: t }); }
    else if (e.what === 'surface') { a.stopLoop(k); sfx('splash_out', u, t); }
    else if (e.what === 'row') sfx('row_stroke', u, t);
  });
  // Weapons
  on('shot', (e, t) => {
    const pos = e.from || e.shooter;
    const id = weaponSfx(e.weapon);
    if (SFX[id]?.burst && (a.engine?.files?.has(id) ?? false)) a.burst(key(e.shooter || pos, 'burst'), id, pos, { event: t });
    else sfx(id, pos, t);
    if (id === 'sniper_shot') a.after(0.8, () => sfx('sniper_bolt', pos, t));
  });
  on('hit', (e, t) => {
    let id = `bullet_impact_${e.surface || 'dirt'}`;
    if (e.target && (isCommando(e.target) || isEnemy(e.target))) id = 'bullet_impact_flesh';
    if (/raft/.test(e.target?.type || '')) id = 'raft_hit_hiss';
    if (e.weapon === 'harpoon') id = 'harpoon_hit';
    sfx(id, Number.isFinite(e.x) ? e : e.target, t);
  });
  on('projectile:bounce', (e, t) => sfx('grenade_bounce', e, t));
  on('trap:sprung', (e, t) => sfx('trap_snap', e.trap || e.victim, t));
  // Explosives
  on('bomb:armed', (e, t) => {
    const b = e.bomb || e;
    sfx('bomb_plant', b, t);
    if ((e.kind || b.kind) !== 'remote') a.bombs.set(key(b, 'bomb'), { bomb: b, start: a.simNow(), fuse: e.fuse ?? b.fuse ?? 10, next: a.simNow() });
  });
  on('bomb:detonate', (e, t) => sfx('detonator_click', e.unit, t));
  on('bomb:exploded', (e, t) => { a.bombs.delete(key(e.bomb || e, 'bomb')); sfx('explosion_big', e, t); });
  on('explosion', (e, t) => {
    const k = String(e.kind || '');
    const id = /grenade|shell/.test(k) ? 'explosion_small' : /barrel/.test(k) ? 'barrel_explode' : 'explosion_big';
    sfx(id, e, t);
    if (id === 'explosion_big') a.after(0.6, () => sfx('debris_rain', e, t));
  });
  on('structure:destroyed', (e, t) => {
    const pos = e.x != null ? e : e.structure || e.prop;
    if (/dam/.test(e.type || '')) { sfx('dam_burst', pos, t); a.startLoop(key(e, 'flood'), 'flood_rush', pos, { event: t }); } else sfx('collapse', pos, t);
  });
  on('fire', (e, t) => (e.on === false ? a.stopLoop(key(e, 'fire'), 1) : a.startLoop(key(e, 'fire'), 'fire_loop', e, { event: t })));
  // Devices / doors / noises
  on('device', (e, t) => {
    const id = e.sfx;
    if (!id) return;
    if (SFX_LOOP.has(id)) { if (e.on === false) a.stopLoop(key(e, 'dev')); else a.startLoop(key(e, 'dev'), id, e, { event: t }); } else sfx(id, e, t);
  });
  on('door', (e, t) => sfx(/hangar/.test(String(e.id)) ? 'hangar_door' : 'gate_creak', e.door || e, t));
  on('noise', (e, t) => {
    const id = { decoy: 'decoy_beep', phone: 'telephone_ring', horn: 'horn_car', bark: 'dog_bark', dog: 'dog_bark' }[e.kind];
    sfx(id, e, t);
  });
  // Vehicles
  on('vehicle:enter', (e, t) => {
    const v = e.vehicle, [start, idle] = vehicleSfx(v);
    sfx(start, v, t);
    if (idle) a.startLoop(key(v, 'veh'), idle, v, { follow: v, event: t, fadeIn: start ? 0.8 : 0.2, range: engineRange(v) });
  });
  on('vehicle:move', (e, t) => {
    const v = e.vehicle, [, , drive] = vehicleSfx(v);
    if (drive) a.startLoop(key(v, 'veh'), drive, v, { follow: v, event: t, rate: 0.8 + Math.min(0.6, (e.speed || 0) / 15), range: engineRange(v) });
  });
  on('vehicle:stop', (e, t) => {
    const v = e.vehicle, [, idle] = vehicleSfx(v);
    if (idle) { sfx('brakes', v, t); a.startLoop(key(v, 'veh'), idle, v, { follow: v, event: t, range: engineRange(v) }); }
  });
  on('vehicle:exit', (e) => { if (!e.vehicle?.crew?.length && !e.vehicle?.operator) a.stopLoop(key(e.vehicle, 'veh'), 0.6); });
  on('vehicle:fire', (e, t) => sfx(weaponSfx(e.weapon), e.vehicle, t));
  on('vehicle:runover', (e, t) => sfx('runover_thud', e.victim || e.vehicle, t));
  on('vehicle:destroyed', (e, t) => { a.stopLoop(key(e.vehicle, 'veh'), 0.1); sfx('explosion_big', e.vehicle, t); a.startLoop(key(e.vehicle, 'fire'), 'fire_loop', e.vehicle, { event: t }); });
  on('train:pass', (e, t) => { sfx('horn_train', e.train, t); sfx('train_pass', e.train, t); });
  // Alarm (§4.9)
  on('alarm:start', (e) => {
    a._sirenStart(e);
    const w = a.world;
    const man = (w?.commandos || []).find((c) => c.alive !== false && c.selected) || (w?.commandos || []).find((c) => c.alive !== false);
    if (man) a.after(1.2, () => a.say(man, 'alarm'));
  });
  on('alarm:end', () => a._sirenStop(1.5));
  // UI / flow
  on('ui:click', (e, t) => sfx(SFX_UI.has(e.sfx) ? e.sfx : 'ui_click', null, t, { dedupe: 0.03 }));
  on('objective:update', (e, t) => sfx('pencil_scratch', null, t));
  on('mission:won', (e, t) => { sfx('stamp', null, t); if (e.promoted || e.rankUp) a.after(0.8, () => sfx('promotion', null, t)); });

  // Voices (§9.4)
  on('bark', (e) => a._bark(e));
  on('unit:selected', (e) => { const u = (e.units || [])[0]; if (isCommando(u) && (e.units.length === 1 || !e.silent)) a.say(u, 'select'); });
  on('unit:order', (e) => {
    const o = e.order || {};
    if (o.type === 'move') a.say(e.unit, 'ack_move');
    else if (o.type === 'ability') { if (!a.say(e.unit, abilityVoice(o.id))) a.say(e.unit, 'ack_act'); }
  });
  // bodies-design §C.7: a downed man's heartbeat follows him (faster once he fades); the carry thumps and drags
  const hb = (u) => `downed:${u?.id}`;
  on('unit:downed', (e, t) => { if (e.unit) a.startLoop(hb(e.unit), 'heartbeat', e.unit, { follow: e.unit, event: t }); });
  on('unit:revived', (e) => a.stopLoop(hb(e.unit), 0.6));
  on('bark', (e) => { if (e?.line === 'hurry' && e.about?.downed) a.startLoop(hb(e.about), 'heartbeat', e.about, { follow: e.about, rate: 1.7 }); });
  on('load:picked', (e, t) => sfx(e.mode === 'drag' ? 'body_drag' : 'barrel_lift', e.carrier, t));
  on('load:dropped', (e, t) => { if (e.how !== 'vehicle') sfx('body_drop', e.load || e.carrier, t); });
  // A hit commando grunts at once in his own voice ('pain', prio 5: cuts a select/ack line; his portrait flinches on
  // the same event, docs/talking-portraits.md §9). His "I'm hit!" ('hurt', 1.5 s cooldown) follows once the grunt
  // has finished, so the two never overlap; a hit inside the grunt's 0.4 s cooldown adds nothing.
  on('unit:damaged', (e) => {
    const u = e.unit;
    if (!u || (u.hp ?? 1) <= 0) return;
    if (isEnemy(u)) { a.say(u, 'ger_hurt'); return; }
    const g = a.say(u, 'pain');
    if (g) a.after(Math.max(0.3, g.duration || 0.6), () => { if (u.alive !== false && (u.hp ?? 1) > 0) a.say(u, 'hurt'); });
  });
  on('unit:killed', (e) => {
    const u = e.unit, silent = SILENT_KILLS.has(String(e.cause || ''));
    if (isEnemy(u) && !silent) a.say(u, 'ger_death');
    else if (isCommando(u) || u?.kind === 'guest') a.say(u, 'death', { force: true });
    if (isEnemy(u) && silent && isCommando(e.killer)) a.say(e.killer, 'act_kill');
  });
  on('unit:held', (e) => { if (e.held !== false) a.say(e.unit, 'spotted'); });
  on('unit:captured', (e) => a.say(e.by?.[0] || e.by, 'ger_arrest'));
  on('enemy:challenge', (e) => { a.say(e.enemy, 'ger_halt'); if (isCommando(e.target)) a.after(0.5, () => a.say(e.target, 'spotted')); });
  on('enemy:state', (e) => {
    const k = STATE_BARK[e.to];
    if (k) a.say(e.enemy, k);
    else if ((e.to === 'RETURN' || e.to === 'return') && /SEARCH|INVESTIGATE|TRACKS|search|investigate/.test(e.from || '')) a.say(e.enemy, 'ger_giveup');
  });
  on('enemy:distracted', (e) => a.say(e.enemy, 'ger_distracted'));
  on('enemy:unmasked-spy', (e) => a.say(e.enemy, 'spy_unmask', { force: true }));
  on('reinforcements', (e) => { const u = e.units?.[0] || e.squad?.[0]; if (u) a.say(u, 'sergeant_order'); });
  return subs;
}

const SFX_LOOP = new Set(Object.values(SFX).filter((d) => d.loop).map((d) => d.id));
const SFX_UI = new Set(Object.values(SFX).filter((d) => d.bus === 'ui').map((d) => d.id));
