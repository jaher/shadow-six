/**
 * Sound catalog (design-spec §9.1–§9.3). Every §9.3 SFX id, music cue and ambience layer is listed
 * here with its bus, loop flag, base gain and a procedural placeholder recipe (src/audio/synth.js).
 *
 * DROP-IN ASSETS: recorded CC0 SFX / TTS voices replace the synth by filename, no code change:
 *   assets/audio/sfx/manifest.json   — the R&D `sfx_build.py` format: {sounds:[{id, category, files:[ogg, mp3], loop}]}.
 *     A sound is used for SFX id X when its `category` is X, or when `category` is listed in X's `alias`
 *     (e.g. R&D category `fs_snow` → `step_snow`). Several files per id = round-robin variants.
 *   assets/audio/music/<cue>.ogg      — §9.1 cues (menu, briefing_1, start_3, …), listed in assets/audio/music/manifest.json
 *   assets/audio/voice/lines.json     — {lines:[{speaker, key, n, text, file}]} (see voice-lines.js for speakers/keys)
 * Missing files silently fall back to the synth recipe.
 * @module audio/manifest
 */

/** Busses under master (§9 engine; `ambience` split out of sfx so "Nature sounds" can gate it). */
export const BUSSES = Object.freeze(['sfx', 'voice', 'ambience', 'music', 'ui']);

// [ids, bus, recipe, gain, extra] rows keep the table compact.
const ROWS = [
  // Movement
  [['step_snow', 'step_sand', 'step_grass', 'step_road', 'step_wood', 'step_metal'], 'sfx', 'step', 0.35],
  [['step_water'], 'sfx', 'splash_small', 0.35],
  [['crawl_rustle', 'body_drag'], 'sfx', 'rustle', 0.3],
  [['climb_scrape', 'ladder'], 'sfx', 'scrape', 0.4],
  [['dig_snow', 'dig_sand'], 'sfx', 'dig', 0.45],
  [['body_drop', 'barrel_set'], 'sfx', 'thud', 0.6],
  [['heartbeat'], 'sfx', 'heartbeat', 0.55, { loop: true }], // bodies-design §C.7 downed man
  [['barrel_lift'], 'sfx', 'grunt', 0.5],
  // Water
  [['splash_in', 'splash_out'], 'sfx', 'splash', 0.6],
  [['dive_bubbles'], 'sfx', 'bubbles', 0.5],
  [['underwater_loop'], 'sfx', 'bubbles', 0.35, { loop: true }],
  [['row_stroke'], 'sfx', 'splash_small', 0.4],
  [['raft_inflate', 'raft_deflate', 'raft_hit_hiss'], 'sfx', 'hiss', 0.45],
  // Weapons
  [['knife_stab', 'syringe', 'cutters_snip'], 'sfx', 'stab', 0.5],
  [['pistol_shot'], 'sfx', 'shot', 0.8],
  [['rifle_shot', 'sniper_shot'], 'sfx', 'shot_big', 0.9],
  [['pistol_draw', 'pistol_holster', 'sniper_bolt', 'grenade_pin', 'trap_set'], 'sfx', 'click', 0.45],
  [['trap_snap'], 'sfx', 'snap', 0.6],
  [['smg_burst'], 'sfx', 'burst', 0.8],
  // recorded bursts: one sustained take per shooter while its rounds keep coming (audio.burst)
  [['mp40_burst', 'mg_burst', 'tank_mg', 'boat_mg'], 'sfx', 'burst', 0.8, { burst: true }],
  [['harpoon_fire', 'grenade_throw', 'torpedo_launch'], 'sfx', 'whoosh', 0.5],
  [['harpoon_hit', 'grenade_bounce'], 'sfx', 'knock', 0.45],
  [['tank_cannon'], 'sfx', 'boom', 1.0],
  [['torpedo_run'], 'sfx', 'engine', 0.4, { loop: true }],
  [['bullet_impact_dirt', 'bullet_impact_wood', 'bullet_impact_metal', 'bullet_impact_flesh'], 'sfx', 'impact', 0.4],
  [['bullet_impact_water'], 'sfx', 'splash_small', 0.35],
  // Explosives
  [['bomb_plant', 'detonator_click', 'switch_throw', 'valve_turn'], 'sfx', 'click', 0.5],
  [['bomb_tick'], 'sfx', 'tick', 0.45],
  [['explosion_small', 'barrel_explode'], 'sfx', 'boom', 0.9, { far: 'explosion_far' }],
  [['explosion_big', 'collapse', 'dam_burst'], 'sfx', 'boom_big', 1.0, { far: 'explosion_far' }],
  [['explosion_far'], 'sfx', 'boom_big', 0.9],
  [['debris_rain'], 'sfx', 'rustle', 0.5],
  [['fire_loop'], 'sfx', 'crackle', 0.35, { loop: true }],
  [['flood_rush'], 'sfx', 'noise_loop', 0.5, { loop: true }],
  // water falling down the M3 dam: a positional ambience layer at its foot (ambienceFor `at`, stopped by `until`)
  [['waterfall'], 'ambience', 'noise_loop', 1.0, { loop: true }],
  // its layers: the low roar of the plunge (the surf sample pitched down) and the tailwater rushing away downstream
  [['waterfall_roar', 'rapids'], 'ambience', 'noise_loop', 1.0, { loop: true }],
  // Devices
  [['decoy_beep'], 'sfx', 'beep', 0.45],
  [['electric_hum'], 'sfx', 'hum', 0.2, { loop: true }],
  [['electric_zap'], 'sfx', 'zap', 0.6],
  [['power_down'], 'sfx', 'power_down', 0.5],
  [['telephone_ring'], 'sfx', 'ring', 0.5],
  [['gate_creak', 'hangar_door', 'barrier_lift', 'lock_gate'], 'sfx', 'creak', 0.45],
  // gate smash (§3.7 ramming addendum): splintering crack, hinge / strap snapping, pieces landing
  [['gate_smash'], 'sfx', 'impact', 0.95],
  [['gate_hinge_snap'], 'sfx', 'snap', 0.5],
  [['gate_thud', 'gate_thud_metal'], 'sfx', 'thud', 0.42],
  [['water_pressure', 'water_jet'], 'sfx', 'hiss', 0.5],
  [['cable_car_motor'], 'sfx', 'engine', 0.35, { loop: true }],
  // Vehicles
  [['truck_start'], 'sfx', 'engine_start', 0.6],
  [['truck_idle', 'truck_drive', 'tank_engine', 'tank_tracks', 'motorbike', 'boat_engine', 'plane_engine', 'autogyro'], 'sfx', 'engine', 0.45, { loop: true }],
  [['turret_whir'], 'sfx', 'whir', 0.4],
  [['brakes'], 'sfx', 'hiss', 0.4],
  [['horn_car', 'horn_train', 'horn_ship'], 'sfx', 'horn', 0.6],
  [['train_pass'], 'sfx', 'noise_swell', 0.8],
  [['runover_thud'], 'sfx', 'thud', 0.7],
  // Alarm
  [['siren'], 'sfx', 'siren', 1.0, { loop: true }],
  // Nature (ambience bus)
  // beds: streamed through a media element (never decoded), 4 s crossfades. The wind beds are procedural soft air
  // (tools/audio/procedural_beds.py wind_air / wind_cold / wind_sand; levels in AMBIENCE, automation in wind-bed.js)
  [['wind', 'wind_snow', 'wind_desert', 'surf', 'river', 'crickets', 'artillery_far'], 'ambience', 'noise_loop', 1.0, { loop: true, bed: true }],
  [['birds'], 'ambience', 'bird', 1.0, { loop: true, bed: true }],
  // step 4w: tied to the mission WindField (world/wind.js): gust whooshes at the view centre, halyard clank at flags.
  // The whoosh is a soft breath over the bed (≈ −46 dBFS peak, a few dB over the snow bed and ≈ 18 dB under a
  // footstep at the view; the old one peaked at −16 dBFS, as loud as the footsteps; wind-bed.js GUST)
  [['wind_gust'], 'ambience', 'gust', 0.03],
  [['flag_clank'], 'sfx', 'halyard', 0.35],
  [['dog_bark', 'dog_growl'], 'sfx', 'dog', 0.6],
  // UI
  [['ui_click', 'ui_hover', 'cursor_forbidden'], 'ui', 'click', 0.4],
  [['knapsack_open', 'notebook_flip', 'pencil_scratch'], 'ui', 'rustle', 0.4],
  [['stamp'], 'ui', 'thud', 0.7],
  [['promotion'], 'ui', 'fanfare', 0.7],
  [['pause_on', 'pause_off'], 'ui', 'beep', 0.3],
  // menus (docs/menus-art-direction.md §1.8 ui.* set; mapped by src/ui/ui-sound.js)
  [['ui_safety'], 'ui', 'safety', 0.12],
  [['ui_bolt'], 'ui', 'bolt', 0.5],
  [['ui_latch'], 'ui', 'bolt', 0.36],
  [['ui_toggle'], 'ui', 'bakelite', 0.4],
  [['ui_detent'], 'ui', 'detent', 0.16],
  [['ui_type'], 'ui', 'typestrike', 0.32],
  [['ui_type_back'], 'ui', 'typeback', 0.24],
  [['ui_bell'], 'ui', 'bell', 0.3],
  [['ui_paper'], 'ui', 'paper', 0.32],
  [['ui_clink'], 'ui', 'clink', 0.4],
  [['ui_deny'], 'ui', 'wooddeny', 0.26],
  [['ui_error'], 'ui', 'telegraph', 0.3],
  [['ui_projector'], 'ui', 'projector', 0.14, { loop: true }],
  [['ui_lamp'], 'ui', 'chain', 0.36],
];

/**
 * Shipped categories (assets/audio/sfx/manifest.json, built by tools/audio/build_assets.py) → §9.3 ids.
 * `fs_*` = Freesound CC0 recordings, `k_*` = Kenney CC0 packs; several categories per id = one round-robin pool.
 */
const ALIASES = {
  step_snow: ['fs_snow', 'k_step_snow'], step_sand: ['fs_sand'], step_grass: ['fs_grass', 'k_step_grass'],
  step_road: ['fs_gravel', 'k_step_concrete'], step_wood: ['fs_wood', 'k_step_wood'], step_metal: ['fs_metal'],
  crawl_rustle: ['k_cloth'], body_drag: ['crawl'], body_drop: ['body_fall'], barrel_set: ['k_barrel_set'],
  climb_scrape: ['k_thud_wood'], ladder: ['k_thud_wood'], dig_snow: ['k_dig'], dig_sand: ['k_dig'],
  splash_in: ['splash'], splash_out: ['splash'], underwater_loop: ['swim'],
  knife_stab: ['knife_stab', 'k_knife'], syringe: ['k_metal_click'], cutters_snip: ['k_metal_latch'],
  pistol_shot: ['pistol'], rifle_shot: ['rifle_lee_enfield', 'rifle_m1'], sniper_shot: ['sniper_echo'],
  sniper_bolt: ['rifle_bolt_cycle'], pistol_draw: ['k_draw'], pistol_holster: ['k_belt'], grenade_pin: ['k_metal_latch'],
  trap_set: ['k_metal_click'], smg_burst: ['smg_thompson_single'], mg_burst: ['mg_period_craigsmith', 'mg_heavy'],
  mp40_burst: ['mg_period_craigsmith'], tank_mg: ['mg_heavy'], boat_mg: ['mg_heavy'],
  bullet_impact_metal: ['ricochet', 'k_hit_metal'], bullet_impact_wood: ['k_hit_wood'], bullet_impact_dirt: ['k_hit_soft'],
  bullet_impact_flesh: ['k_hit_flesh'], grenade_bounce: ['k_hit_soft'], harpoon_hit: ['k_hit_wood'],
  bomb_plant: ['k_pouch'], detonator_click: ['k_metal_click'], switch_throw: ['metal_small'], valve_turn: ['metal_small'],
  bomb_tick: ['bomb_tick1'], explosion_small: ['explosion_grenade'], barrel_explode: ['explosion_grenade'],
  explosion_big: ['explosion_large', 'explosion_grenade'], collapse: ['explosion_large'], dam_burst: ['explosion_large'],
  explosion_far: ['explosion_distant'], tank_cannon: ['explosion_grenade'],
  siren: ['siren_airraid', 'siren_handcrank'], gate_creak: ['door_wood', 'k_creak'], hangar_door: ['door_metal'],
  barrier_lift: ['k_creak'], gate_smash: ['gate_splinter'], gate_hinge_snap: ['k_metal_latch', 'k_hit_metal'],
  gate_thud: ['gate_debris', 'k_thud_wood'], gate_thud_metal: ['k_hit_metal', 'metal_small'], lock_gate: ['door_metal'], truck_idle: ['truck_engine'], truck_drive: ['truck_engine'],
  tank_engine: ['tank_engine'], tank_tracks: ['tank_engine'], boat_engine: ['truck_engine'], dog_bark: ['dog'], dog_growl: ['dog'],
  wind: ['wind_air'], wind_snow: ['wind_cold'], wind_desert: ['wind_sand'], surf: ['surf'], river: ['river'], waterfall: ['river'], waterfall_roar: ['surf'], rapids: ['river'],
  birds: ['birds'], crickets: ['crickets'], artillery_far: ['artillery_period'],
  ui_click: ['k_ui_click'], ui_hover: ['k_ui_tick'], cursor_forbidden: ['k_ui_error'], knapsack_open: ['k_book_open', 'k_cloth'],
  notebook_flip: ['k_page'], pencil_scratch: ['k_ui_scratch'], stamp: ['k_stamp'], pause_on: ['k_ui_toggle'], pause_off: ['k_ui_switch'],
};

/**
 * Distance classes (realism-pipeline v2 §1.5.0 "Distance model"): per-category reference distance and
 * `max` audible distance in m. Playback is NOT culled at the AI hearing radius; air absorption and the
 * far layers carry distance. `lp` = air-absorption low-pass applies.
 */
export const DISTANCE = Object.freeze({
  foley: { ref: 3, max: 30 }, // footsteps, cloth, knife, body, small clicks
  mech: { ref: 8, max: 80 }, // impacts, doors, devices, ticks
  voice: { ref: 6, max: 60 },
  animal: { ref: 8, max: 150 },
  vehicle: { ref: 12, max: 300 },
  small: { ref: 25, max: 400 }, // small arms
  heavy: { ref: 40, max: 1500 }, // MG, explosions, cannon, siren
});
const CLASS_RULES = [
  [/^(step_|crawl|body_|climb|ladder|dig_|barrel_|knife|syringe|cutters|pistol_draw|pistol_holster|grenade_pin|trap_set|bomb_plant|detonator|row_stroke|dive_|underwater|raft_|splash)/, 'foley'],
  [/^(mg_burst|tank_mg|boat_mg|explosion|collapse|dam_burst|tank_cannon|siren|debris|flood|artillery)/, 'heavy'],
  [/(_shot$|^smg_burst|^mp40_burst|^harpoon_fire|^sniper_bolt)/, 'small'],
  [/(engine|^truck_|tank_tracks|motorbike|plane|autogyro|train|horn|brakes|turret|torpedo|cable_car|runover)/, 'vehicle'],
  [/^dog/, 'animal'],
  [/^waterfall/, 'small'], // a steady roar heard across the gorge (ref 25 m)
  [/^rapids/, 'vehicle'], // the tailwater: heard along the bank (ref 12 m)
];
/** Distance class name for an SFX id (voices use 'voice'). */
export function classOf(id) {
  if (String(id).startsWith('voice:')) return 'voice';
  for (const [re, c] of CLASS_RULES) if (re.test(id)) return c;
  return 'mech';
}

/** id → {id, bus, recipe, gain, loop, alias[]} for every §9.3 SFX id. */
export const SFX = Object.freeze(Object.fromEntries(ROWS.flatMap(([ids, bus, recipe, gain, extra = {}]) =>
  ids.map((id) => [id, Object.freeze({ id, bus, recipe, gain, loop: !!extra.loop, bed: !!extra.bed, burst: !!extra.burst,
    far: extra.far || null, cls: classOf(id), alias: ALIASES[id] || [] })]))));

/**
 * §9.1 music cues (music bus). `loop` cues are beds; the rest are one-shot stingers; `mission` cues are the in-mission
 * suspense score (music-director.js: tension segments chained + the alert layer). `mood` names the old synth
 * placeholder recipe — NOT used on the music bus any more (a cue without a recorded file is silence).
 */
export const MUSIC = Object.freeze({
  menu: { loop: true, mood: 'march' },
  campaign_norway: { loop: true, mood: 'cold' }, campaign_africa: { loop: true, mood: 'modal' },
  campaign_normandy: { loop: true, mood: 'hopeful' }, campaign_rhine: { loop: true, mood: 'grim' },
  campaign_reich: { loop: true, mood: 'grim' }, campaign_end: { loop: true, once: true, mood: 'hopeful' }, // end: once → menu
  tutorial: { loop: true, mood: 'march' },
  briefing_1: { loop: true, mood: 'ostinato' }, briefing_2: { loop: true, mood: 'ostinato' }, briefing_3: { loop: true, mood: 'ostinato' },
  start_1: { mood: 'stinger' }, start_2: { mood: 'stinger' }, start_3: { mood: 'stinger' },
  start_4: { mood: 'stinger' }, start_5: { mood: 'stinger' }, start_6: { mood: 'stinger' },
  success_1: { mood: 'success' }, success_2: { mood: 'success' }, success_3: { mood: 'success' },
  fail_1: { mood: 'fail' }, fail_2: { mood: 'fail' }, fail_3: { mood: 'fail' },
  credits: { loop: true, once: true, mood: 'march' }, // plays once, then the menu theme (music-cues ONCE_THEN)
  exit: { mood: 'success', stopsBed: true }, debrief_promotion: { mood: 'success' },
  drone: { loop: true, mood: 'drone' }, // option "cinematic ambience" (off by default; superseded by missionMusic)
  mission_tension_a: { mission: true, mood: 'drone' }, mission_tension_b: { mission: true, mood: 'drone' },
  mission_tension_c: { mission: true, mood: 'drone' }, mission_bridge_1: { mission: true, mood: 'drone' },
  mission_bridge_2: { mission: true, mood: 'drone' }, mission_bridge_3: { mission: true, mood: 'drone' },
  mission_alert: { mission: true, loop: true, mood: 'ostinato' },
});

/**
 * §9.2 ambience layers per theater: [sfxId, gain, opts]. Beds (loop ids) are streamed and crossfade over
 * ~4 s; `sparse: s` layers are positional one-shot "sweeteners" every ~s seconds (0.5–1.5×), placed `far`
 * [min, max] m from the listener in a random direction (a distant dog, far shelling). `day` / `night`
 * restrict a layer to the lighting. Gains are for the recorded beds (≈ −20 dBFS RMS); the ambience bus
 * (Options → AMBIENCE) and the "Nature sounds" option scale them.
 *
 * Wind (user 2026-10-02: "too intense, as if in a terror movie"): background air you notice only when the game is
 * quiet. The wind beds are mastered at −24 LUFS (sfx manifest `lufs`); the in-mission music bed is ≈ −34 LUFS (tension
 * cues at −22 LUFS × TENSION_TRIM 0.42 × MUSIC 0.6), so gain g puts the wind 34 − 24 + 20·log10(g) dB under the
 * score: snow 13 dB (the most present, never dominant), fjord 14, desert 15 (the sand hiss lighter), temperate 16,
 * coast and urban 17 (under the surf / the far guns). The old recorded beds sat 4–8 dB OVER the score (measured in
 * game, K-weighted; the howling snow take +8 dB).
 */
const MUSIC_BED_LUFS = -33.9, WIND_BED_LUFS = -24;
/** Gain that sets a wind bed `db` dB under the in-mission music bed. */
const WIND_UNDER = (db) => +(10 ** ((MUSIC_BED_LUFS - db - WIND_BED_LUFS) / 20)).toFixed(3);
export const AMBIENCE = Object.freeze({
  snow: [['wind_snow', WIND_UNDER(13)], ['dog_bark', 0.5, { sparse: 35, far: [90, 160] }]],
  temperate: [['wind', WIND_UNDER(16)], ['birds', 0.34, { day: true }], ['crickets', 0.3, { night: true }],
    ['dog_bark', 0.45, { sparse: 30, far: [90, 160] }]],
  coast: [['surf', 0.42], ['wind', WIND_UNDER(17)], ['birds', 0.2, { day: true }]],
  fjord: [['wind_snow', WIND_UNDER(14)], ['surf', 0.3]],
  desert: [['wind_desert', WIND_UNDER(15)], ['crickets', 0.22, { night: true }]],
  summer: [['birds', 0.3, { day: true }], ['crickets', 0.32]],
  urban: [['wind', WIND_UNDER(17)], ['artillery_far', 0.16], ['dog_bark', 0.4, { sparse: 22, far: [70, 140] }]],
});
/** Mission-specific extra layers (§9.2): river rush M2/M3/M19, dog barks M19. */
export const MISSION_AMBIENCE = Object.freeze({
  m02: [['river', 0.3]], m03: [['river', 0.34]], m19: [['river', 0.26], ['dog_bark', 0.45, { sparse: 14, far: [40, 90] }]],
});

/** Layers for a mission definition (theater + mission extras). */
export function ambienceFor(def = {}) {
  const t = AMBIENCE[def.theater] || AMBIENCE.temperate;
  const id = String(def.id || '').toLowerCase().replace(/^(m)(\d)$/, 'm0$2');
  return [...t, ...(MISSION_AMBIENCE[id] || []), ...(def.ambience || [])];
}
