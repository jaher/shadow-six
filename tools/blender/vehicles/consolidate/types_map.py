"""Game vehicle types (src/entities/vehicle.js VEHICLE_TYPES + design-spec 7.7 additions) -> library assets.
assets[0] is the default; the others are alternatives a spawn can name (`asset:`) or the seed picks when `pool` is set."""
# default paint when a theater has no dedicated variant (first match wins)
PAINT_ORDER = ['grey', 'dr', 'od', 'civil', 'tarred', 'wood', 'green', 'brown', 'rust', 'black', 'deployed', 'white', 'painted', 'camo']

T = lambda *a, **k: dict(assets=list(a), **k)
TYPES = {
    # --- water craft ---
    'raft': T('raft', note='deployed; destroyed -> raft_deflated (the raft deflates, spec 4.3); packed = carried state'),
    'rowboat': T('rowboat'),
    'patrolboat': T('patrol_boat', note='Hafenschutzboot HS 114, 13.5 x 3.0 m (registry size 8 x 2.6)'),
    'minisub': T('minisub_biber'),
    'uboat': T('uboat_viic', new=True), 'battleship': T('battleship_bismarck', new=True, note='M13 staging: true scale'),
    'fishing_boat': T('fishing_boat', new=True), 'tug': T('harbour_tug', new=True),
    # --- land ---
    'truck': T('opel_blitz_cargo'), 'opel_blitz': T('opel_blitz_cargo', alias='truck'),
    'opel_blitz_tanker': T('opel_blitz_tanker'), 'fuel_truck': T('opel_blitz_tanker', alias='opel_blitz_tanker'),
    'kubelwagen': T('kubelwagen', pool=True, note='seed may pick the canvas-top variant (grey_top / dak_top)'),
    'willys': T('willys_mb'), 'horch': T('horch901', pool=True), 'citroen15': T('citroen11', note='Traction Avant 11 B stands in for the 15-Six'),
    'car': T('citroen11', note='civilian car: black paint in every theater', paint='black'),
    'motorcycle': T('r75_sidecar'),
    'panzer2': T('panzer2_f'), 'panzer3': T('panzer3_j', 'panzer3_l'), 'panzer4': T('panzer4_g', 'panzer4_f2'),
    'tank': T('panzer2_f', alias='panzer2'),
    'sdkfz': T('sdkfz251_c', 'sdkfz231_8rad', note='half-track by default; armoredcar -> Sd.Kfz. 231 8-Rad'),
    'halftrack': T('sdkfz251_c', alias='sdkfz'), 'armoredcar': T('sdkfz231_8rad', alias='sdkfz'),
    # --- aircraft ---
    'autogyro': T('fw_c30_autogiro'), 'ju52': T('ju52_3m'), 'ju87': T('ju87_b'), 'plane': T('ju52_3m', alias='ju52'),
    'bf109': T('bf109_e', new=True), 'storch': T('fi156_storch', new=True),
    'fuel_bowser': T('fuel_bowser', new=True), 'bomb_trolley': T('bomb_trolley', new=True),
    'starter_cart': T('starter_cart', new=True), 'chocks': T('chocks', new=True), 'windsock': T('windsock', new=True),
    # --- rail ---
    'train': T('loco_br52', 'tender_t30', 'coach', 'wagon_covered', 'wagon_open', 'wagon_flat', 'wagon_tank',
               consist=['loco_br52', 'tender_t30', 'wagon_covered', 'wagon_open', 'wagon_flat', 'wagon_tank', 'coach'],
               note='locomotive + cars: createVehicleVisual("train") builds the consist along -z with coupler gaps'),
    'tram': T('tram_fr'), 'railway_gun': T('railgun_k5', new=True), 'rail_crane': T('rail_crane', 'rail_crane_idler', new=True),
    'coach': T('coach', new=True), 'wagon': T('wagon_covered', 'wagon_open', 'wagon_flat', 'wagon_tank', new=True),
    'handcar': T('handcar', new=True), 'mine_cart': T('mine_cart', 'mine_tipper', new=True),
    # --- fixed guns / emplacements ---
    'mgNest': T('mgnest_ring', 'mgnest_horseshoe', 'mg42_tripod', 'mg34_tripod'),
    'cannon': T('flak88', 'flak88_noshield', note='8.8 cm Flak 18/36 emplacement'),
    'mortar210': T('morser18_21cm'), 'mortar': T('morser18_21cm', alias='mortar210'),
    'mg_tripod': T('mg42_tripod', 'mg34_tripod', new=True),
    # atgunM20 / van: no dedicated model yet -> the caller keeps its placeholder
}
