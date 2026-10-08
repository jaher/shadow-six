/**
 * AUDIO contract (ARCHITECTURE "Cross-team interfaces" → Audio): the audio system is EVENT-DRIVEN
 * ONLY. This table lists every world.events event it reacts to and the design-spec §9.3 SFX ids it
 * plays (ids = files under assets/audio/sfx/). Nothing else calls audio except Game (music) and UI
 * clicks (ui_click/ui_hover). Emitters own the payloads; see docs/ARCHITECTURE.md event table.
 * `pick` documents how the payload selects among the listed ids.
 * @module audio/sfx-events
 */

export const SFX_EVENTS = Object.freeze([
  // Movement / bodies / footprints
  { event: 'footprint', sfx: ['step_snow', 'step_sand', 'step_grass', 'step_road', 'step_wood', 'step_water'], pick: 'payload.terrain (also emitted only on SNOW/SAND/MUD; other steps via unit:step)' },
  { event: 'unit:step', sfx: ['step_snow', 'step_sand', 'step_grass', 'step_road', 'step_wood', 'step_water', 'crawl_rustle'], pick: '{unit, terrain, stance} — optional, emitted by the renderer/anim at footfalls' },
  { event: 'unit:stance', sfx: ['crawl_rustle'], pick: 'stance === "crawl"' },
  { event: 'unit:climb', sfx: ['climb_scrape', 'ladder'], pick: 'payload.kind: climb | ladder' },
  { event: 'ability:start', sfx: ['dig_snow', 'dig_sand', 'body_drag', 'barrel_lift', 'bomb_plant', 'trap_set', 'cutters_snip', 'raft_inflate', 'syringe', 'knife_stab', 'grenade_pin', 'grenade_throw', 'pistol_draw', 'decoy_beep', 'switch_throw', 'valve_turn'], pick: '{unit, id, target} ability id' },
  { event: 'ability:end', sfx: ['body_drop', 'barrel_set', 'raft_deflate', 'pistol_holster'], pick: '{unit, id, result}' },
  // Water
  { event: 'unit:water', sfx: ['splash_in', 'splash_out', 'dive_bubbles', 'underwater_loop', 'row_stroke'], pick: '{unit, what: enter|exit|dive|surface|row}' },
  // Weapons
  { event: 'shot', sfx: ['pistol_shot', 'sniper_shot', 'sniper_bolt', 'smg_burst', 'harpoon_fire', 'rifle_shot', 'mp40_burst', 'mg_burst', 'tank_mg', 'boat_mg', 'tank_cannon', 'torpedo_launch'], pick: 'payload.weapon (CONFIG.weapons key)' },
  { event: 'hit', sfx: ['bullet_impact_dirt', 'bullet_impact_wood', 'bullet_impact_metal', 'bullet_impact_water', 'bullet_impact_flesh', 'harpoon_hit', 'raft_hit_hiss'], pick: '{x, z, surface, target}' },
  { event: 'projectile:bounce', sfx: ['grenade_bounce'] },
  { event: 'trap:sprung', sfx: ['trap_snap'] },
  // Explosives
  { event: 'bomb:armed', sfx: ['bomb_plant', 'bomb_tick'], pick: '{bomb, kind: time|remote, fuse} — tick loop 2 Hz → 4 Hz until bomb:exploded' },
  { event: 'bomb:detonate', sfx: ['detonator_click'] },
  { event: 'bomb:exploded', sfx: ['explosion_big'] },
  { event: 'explosion', sfx: ['explosion_small', 'explosion_big', 'barrel_explode', 'debris_rain'], pick: 'payload.kind: grenade|shell → small; bomb|vehicle → big; barrel → barrel_explode' },
  { event: 'structure:destroyed', sfx: ['collapse', 'fire_loop', 'dam_burst', 'flood_rush'], pick: '{id, type, cause} (cause ram: silent here, the gate:smash sounds play; type fence-gap: silent, the cutters snipped)' },
  { event: 'gate:smash', sfx: ['gate_smash', 'gate_hinge_snap', 'gate_thud', 'gate_thud_metal'], pick: '{x, z, outcome, kind}: the crack, then the hinges snapping (the heavier the hit, the more)' },
  { event: 'gate:hold', sfx: ['gate_creak', 'gate_thud'], pick: '{x, z}: the bumper against a gate that holds' },
  { event: 'gate:thud', sfx: ['gate_thud', 'gate_thud_metal'], pick: '{x, z, v, heavy, material}' },
  { event: 'fire', sfx: ['fire_loop'], pick: '{x, z, on}' },
  // Devices
  { event: 'device', sfx: ['switch_throw', 'electric_hum', 'electric_zap', 'power_down', 'telephone_ring', 'gate_creak', 'barrier_lift', 'lock_gate', 'water_pressure', 'water_jet', 'valve_turn', 'cable_car_motor', 'cutters_snip'], pick: '{id, sfx, x, z, on} (cutters_snip: each strand the Sapper cuts)' },
  { event: 'noise', sfx: ['decoy_beep', 'telephone_ring', 'horn_car', 'horn_ship', 'dog_bark'], pick: 'kind: decoy | phone | horn | bark (others are silent: the gunshot SFX comes from shot)' },
  // Vehicles
  { event: 'vehicle:enter', sfx: ['truck_start', 'tank_engine', 'boat_engine', 'motorbike', 'plane_engine'] },
  { event: 'vehicle:move', sfx: ['truck_idle', 'truck_drive', 'tank_tracks', 'turret_whir', 'boat_engine', 'motorbike', 'plane_engine', 'autogyro'], pick: '{vehicle, speed} continuous loop while speed > 0' },
  { event: 'vehicle:stop', sfx: ['brakes'] },
  { event: 'vehicle:exit', sfx: [], pick: 'engine loop stops when the vehicle is empty' },
  { event: 'vehicle:fire', sfx: ['tank_mg', 'tank_cannon', 'mg_burst', 'boat_mg'], pick: 'payload.weapon' },
  { event: 'vehicle:runover', sfx: ['runover_thud'] },
  { event: 'vehicle:destroyed', sfx: ['explosion_big', 'fire_loop'] },
  { event: 'train:pass', sfx: ['train_pass', 'horn_train'] },
  { event: 'door', sfx: ['gate_creak', 'hangar_door'], pick: '{id, open}' },
  // Alarm
  { event: 'alarm:start', sfx: ['siren'], pick: 'gain 0.75 → 0 over 25 s (world.alarm.siren.gain)' },
  { event: 'alarm:zone', sfx: [], pick: 'no sound (silent release); RINT starts the siren via alarm:start' },
  { event: 'alarm:end', sfx: [], pick: 'stop siren' },
  // Voice (§9.4) — bark lines resolved by the voice bank
  { event: 'bark', sfx: [], pick: '{unit, line} → voice line (ack, halt, suspicious, mandown, alarm, hurt, arrest, …)' },
  { event: 'unit:selected', sfx: [], pick: 'voice acknowledgement' },
  { event: 'unit:order', sfx: [], pick: 'voice acknowledgement' },
  { event: 'enemy:challenge', sfx: [], pick: 'voice ger_halt' },
  { event: 'enemy:state', sfx: [], pick: 'voice barks by state (event-map STATE_BARK; RETURN after a search → ger_giveup)' },
  { event: 'enemy:distracted', sfx: [], pick: 'voice ger_distracted' },
  { event: 'enemy:unmasked-spy', sfx: [], pick: 'voice spy_unmask' },
  { event: 'unit:held', sfx: [], pick: 'commando voice spotted' },
  { event: 'unit:captured', sfx: [], pick: 'voice ger_arrest' },
  { event: 'reinforcements', sfx: [], pick: 'voice sergeant_order' },
  { event: 'unit:damaged', sfx: [], pick: 'hurt grunt' },
  { event: 'unit:killed', sfx: [], pick: 'death cry (none for knife/syringe)' },
  // UI / flow
  { event: 'ui:click', sfx: ['ui_click', 'ui_hover', 'knapsack_open', 'notebook_flip', 'pencil_scratch', 'cursor_forbidden'], pick: '{sfx}' },
  { event: 'game:state', sfx: ['pause_on', 'pause_off'], pick: 'also drives music (§9.1: menu/briefing/debrief only) and ambience' },
  { event: 'flow:state', sfx: [], pick: 'music cue for title/select/briefing/debrief' },
  { event: 'mission:loaded', sfx: [], pick: 'theater ambience layers (§9.2), resets voices/siren' },
  { event: 'mission:won', sfx: ['stamp', 'promotion'], pick: 'stars/rank change' },
  { event: 'mission:lost', sfx: [], pick: 'failure stinger (music channel)' },
  { event: 'objective:update', sfx: ['pencil_scratch'] },
  { event: 'wind:gust', sfx: ['wind_gust'], pick: 'strong gust front at the view centre (world/wind.js; ≥ 45 s apart, soft: audio/wind-bed.js)' },
  { event: 'wind:flag', sfx: ['flag_clank'], pick: 'gust filling a flag: halyard snap-hook on the pole' },
]);

/** Every event name the audio system subscribes to. */
export const AUDIO_EVENT_NAMES = Object.freeze([...new Set(SFX_EVENTS.map((e) => e.event))]);
