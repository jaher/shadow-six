# SHADOW SIX - naval group (boats, subs, ships)

Build: `bash scripts/run.sh <script>.py <variant|all>` (background Blender 4.2, log in `logs/`).
Review: `bash scripts/review.sh out/<asset>/<asset>_<variant>.glb [views]` (kit renderer + 1.8 m soldier on a quay; water pit from the sidecar `review_water`).
Summary: `python3 scripts/summary.py`.

Pipeline = cars_moto `veh.py` (kit parts, COLOR_0 weathering, LOD0-2, AO, `.kit.json` sidecar with a `vehicle` block) + `nav.py`:
- origin = design waterline at midships (y=0 is the water surface), bow faces glTF +Z; hull below y=0 lives in parts/materials named `*_below`
  (anti-fouling colour + algae/slime band) so the water shader can clip/tint it; sidecar `vehicle.draft_m`, `waterline_y`.
- weathering: algae band, oily scum line, rust streaks and grimy run-off, salt bloom; winter = snow slabs (`snow_soft`) on up-facing faces; burnt = `veh_burnt` + settled/listing wreck pose.
- `Hull` (parametric stations, clinker option), `section_loft` (subs/big ships), fittings (MG 34 pedestal, rails, cowl vents, bollards, fenders, nav lights).
- open boats (rowboat, raft) carry `water_mask_y`: floorboards just above the waterline hide the water plane inside the hull.

| asset | script | variants |
|---|---|---|
| patrol_boat (Hafenschutzboot HS 114, MG 34) | patrol_boat.py | grey, winter, burnt |
| rowboat (faering) | rowboat.py | wood, painted, winter, burnt (swamped) |
| raft (Marine's inflatable) | raft.py | deployed, deflated, packed |
| minisub_biber (2 x G7e) | biber.py | grey, burnt |
| uboat_viic | uboat.py | grey, winter, burnt (stern charges) |
| battleship_bismarck | battleship.py | grey, camo (Baltic 1941), burnt (torpedoed forward) |
| fishing_boat | fishing_boat.py | white, tarred, winter, burnt |
| harbour_tug | tug.py | civil, grey (Kriegsmarine), winter, burnt |

No DAK tan on naval craft (not used historically). No flags/emblems (spec 10.6); ships carry no Balkenkreuz.

## Rework 1 (naval review fixes)
- Rig names: `veh._claim()` gives every exported node/socket its exact name (no Blender `.001`); `nav.check_rig()` fails the
  build (RIG_ERROR) if any sidecar node / socket / moving node does not resolve in the GLB. Patrol boat wheel node = `helm_wheel`,
  driver socket = `helm`.
- Burnt = `nav.burn_field()` on `veh_paint` (no tiling `veh_burnt` texture): per-asset `N.FIRE` sources -> bare dark steel +
  heat rust, blistered paint rings, upward soot plumes, surviving smoke-stained paint; parts densified for vertex resolution.
- Decks: `timber_grey` planking (small craft grey-brown, VIIC near black, Bismarck bleached pale teak).
- LOD: `kit_lod='lodonly'/'lodonly1'/'keep'` parts (rail stand-ins survive LOD1/2 undecimated).
- GLBs over 1.95 MB get EXT_meshopt_compression (`scripts/mo_keepuri.mjs` + `mo_fix.py`, external texture uris kept;
  8-bit COLOR_0 fallback if still > 2 MB): battleship x3, uboat_viic_winter LOD0. Engine loader has the meshopt decoder.
- Tools: `scripts/fast.sh` (no-AO build to fast/), `scripts/rc.sh` (Blender close-up), `scripts/docs.sh` (docs sheets).

## Rework 2 (naval review 2 fixes)
- Handedness: Blender +X = glTF +X = vehicle LEFT (port). All `_l`/`_r` nodes/sockets now follow it (sx > 0 -> `_l`),
  port nav light red on +X, starboard green on -X; Bismarck's sheet anchor on the starboard (-X) bow.
- `nav.stern_gear()`: single-screw stern gear that is structurally attached: full-length keel + deadwood slab buried in the
  shell (no gap), propeller aperture between the deadwood and the sternpost, sole piece carrying the rudder heel bearing,
  unbalanced rudder hung on the post under the counter with its stock rising into the hull. Used by fishing_boat, tug, patrol_boat.
- `veh.vfinalize(lod_target=...)` / `nav.LOD_TARGET = (0.41, 0.15)`: LOD1/LOD2 decimation ratio solved from a probe build
  (dissolve disabled when drops alone undershoot), so every variant lands at ~40 % / ~15 %.
- `nav.check_rig()` requires the moving (rig) nodes at every LOD, not only LOD0.
- patrol_boat rebuilt as HS 114 (13.5 x 3.0 m, raked straight stem, sheer, long foredeck, pole mast forward, low deckhouse,
  round-fronted steering shelter aft). Biber: knife-bow hull with keel line and torpedo recesses (overall 9.04 x 1.57 m).
  VIIC: knife stern over the twin screws (A-brackets, split rudders), saddle-tank bulge, Turm II rounded front + flared
  deflector. Bismarck: Atlantic bow + concave sheer, multi-level superstructure, conning tower with RF hood, bridge window
  bands, constant-section tower mast, taller funnel, tapered 38 cm barrels with blast bags, anchor cables on the deck.
- Burnt variants show the damage at game zoom: Bismarck (foretop wrecked, turrets trained at random with drooped barrels,
  funnel cap blown off + holed, shell holes, masts down), VIIC (oil-soaked, 7 m stern breach, blast holes), tug (gutted
  wheelhouse, buckled rails, bent davit), patrol boat (shelter stump, fallen mast, scorched number).
- `NAV_STATS=1` logs the triangle budget per part name.
- Bismarck M13 staging decision: sidecar `vehicle.staging` (true scale; M13 laid out around the ship).
