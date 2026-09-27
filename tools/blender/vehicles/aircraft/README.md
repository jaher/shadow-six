# SHADOW SIX - aircraft group (vehicles/aircraft)

Blender 4.2 scripts (reproducible) -> glTF LOD0-2 + sidecar per asset and paint variant. Built on the building kit
(`art/kit`, shared tiling CC0 textures referenced by relative URI) through the cars_moto vehicle layer
(`scripts/veh.py`, copied) plus the aircraft layer `scripts/ac.py`.

## Assets (`out/<name>/<name>_<variant>{,_lod1,_lod2}.glb` + `.kit.json` sidecar + `.credits.json`)
| name | script | variants | what |
|---|---|---|---|
| ju52_3m | ju52.py | grey dak winter burnt | Junkers Ju 52/3m g4e transport (M10 escape, McRae): slab-sided fuselage, corrugated skin as real geometry, NACA nose cowl vs Townend-ring wing engines |
| ju87_b | ju87.py | grey dak winter burnt | Junkers Ju 87 B-2 Stuka (M10 airfield), gull wing, spats, dive brakes, SC 250 + 4x SC 50 |
| bf109_e | bf109.py | grey dak winter burnt | Messerschmitt Bf 109 E-4 (parked airfield dressing; hood modelled OPEN, `rest_deg` 100) |
| fi156_storch | storch.py | grey dak winter burnt | Fieseler Fi 156 C-3 Storch; burnt = bare tube frame |
| fw_c30_autogiro | c30.py | grey dak winter burnt | Focke-Wulf C 30 Heuschrecke (licence Cierva C.30A) - M5 summit escape autogyro |
| fuel_bowser | props.py | grey dak winter burnt | 2-axle aviation-fuel trailer (B6 pushable fuel tank) |
| bomb_trolley | props.py | grey dak winter burnt | 4-wheel bomb carrier with SC 250 (toggle node `bomb`) |
| chocks | props.py | grey winter | pair of timber wheel chocks with rope |
| windsock | props.py | grey dak winter | 6 m mast, slewing sock (`sock_yaw`) + 4 chained bend segments |
| starter_cart | props.py | grey dak winter burnt | 2-wheel 24 V battery starter cart |

Variants are separate GLB sets (geometry differs for burnt; paint lives in COLOR_0): `grey` = temperate Luftwaffe
scheme (RLM 70/71 splinter over 65; Bf 109 RLM 02/71 over 65; ground equipment RAL 7021), `dak` = RLM 79/78 +
white Mediterranean fuselage band (ground equipment RAL 8020), `winter` = worn white distemper, `burnt` = wreck.
Insignia: Balkenkreuz + unit codes only (no swastika on the fin, spec 10.6).

## Conventions (sidecar `vehicle` block, game coords x east, y up, z south; model front = +Z)
- Three-point ground attitude baked in (`ground_angle_deg`), pivot = ground centre of the bbox.
- `moving[]`: node, kind (prop, rotor, aileron, flap, elevator, rudder, dive_brake, slat, canopy, canopy_slide, door,
  hatch, gun_yaw_pitch, wheel, castor, steer, bomb_trapeze, windsock_yaw, sock_bend), `pivot`, node-local `axis`
  (hinged / spinning nodes have a rotated frame: local +X = hinge or spin axis), `axis_world`, `hinge` endpoints,
  `limits_deg`. Props: `rpm_idle/rpm_max`, rotor `rpm_flight`.
- `sockets[]` pilot/crew/passengers/troops (Ju 52: 16 bench seats), gunners, muzzles (weapon), exits, ground crew,
  interaction points (fuel nozzle, starter plug, push/tow handles).
- `emitters[]` exhaust (per engine), prop_wash / rotor_wash (ground dust radius), dust, fire/smoke/fuel_leak
  (when destroyed/damaged), explosion (bowser, bomb trolley).
- `lights[]` nav_red/green/white + landing lights (aircraft lights are not blackout-covered).
- `contacts[]` wheel ground points for the trail stamper.

## Rebuild / review
```
scripts/chain.sh ju52.py:all ju87.py:grey,dak   # sequential background builds -> logs/
scripts/final_review.sh ju87_b 320,210 480,320  # review sheet (game1/game2/close/close_se + 1.8 m soldier) + variants grid
python3 scripts/summary.py; python3 scripts/credits.py
python3 scripts/make_air_tex.py                  # regenerates lib materials air_corr / air_fabric / air_skin
```
New CC0 library materials (own work, procedural): `air_corr` (Junkers corrugated duralumin, 50 mm pitch),
`air_fabric` (doped fabric over ribs), `air_skin` (stressed skin, panel lines + rivets) in `art/kit/lib`.
References (internal only): `vehicles/refs/aircraft/` (+ `refs.json`).

## Rework 1 (2026-09-27)
- `blockfont.py`: Luftwaffe block stencil font for code letters / tactical numbers (`AC.letters(..., outline=)`), replaces the stroke font.
- `AC.cross` projects all three insignia layers in ONE frame (no misregistration on narrow fuselages); `lift`/`tree` put
  paint on the ridge crests of corrugated skins.
- Corrugation: `ju52.py slab_ring()` (fuselage, flat-shaded triangle wave, 144/72 pts per ring) and `AC.corr_surface()`
  (wing / tail upper skins, smooth trapezoid profile, continuous UVs; the base wing's upper faces are removed). Paint class
  uses the smoothed normal (`cls_smooth`) so ridge facets do not flip top/side/bottom.
- `quantize.py` (Ju 52 only, `vfin(quant=True)`): KHR_mesh_quantization (NORMAL int8, TEXCOORD_1 uint16), AO JPEG 768 px,
  materials tinted `~fffffd` (corrugation overlays) carry no baked AO. three.js GLTFLoader reads this natively.
- `AC.cut_opening / cockpit_tub / insert_stations`: open cockpits cut into the skin with an inner tub that cannot poke
  through (C 30, Bf 109); `AC.scale_y` (length correction about the rotor mast), `level(sym=True)` keeps pivots symmetric.

## Rework 2 (2026-09-27)
- Exporter: `veh._strip_suffix` removes Blender `.NNN` suffixes from glTF node/mesh names (sidecar `nodes` now match:
  `rudder`, `aileron_l`, ...). `scripts/fixnames.py` applied the same fix to every GLB already in `out/` (fi156, ju87, props too).
- `AC.ground_snap` (in `vfin`): exit sockets (`role: exit` / `on_ground`) and dust / prop / rotor-wash emitters go back to
  ground level after levelling. `AC.warp` / `AC.pw_y`: piecewise length corrections. `AC.reaim`: re-aims a spinning node
  after levelling. `AC.canopy_glass` (all LODs): see-through glazing `veh:canopy_glass` (alpha 0.14 BLEND + clear coat);
  `scripts/glassfix.py` re-applies it without Blender. `AC.mat_fix` (vfin `matfix=`): uniform per-asset material finish.
- Ju 52: body length 19.72 -> 18.98 m (nose section -0.35 m, tail cone -0.45 m); underwing crosses projected onto the real
  lower wing surface; hook-on alu boarding ladder standing on the ground; fuselage cross moved aft of the door;
  corrugation shallower + smooth-shaded, airframe materials matt (roughness 0.85, specular 0.5, no metal chips); LODs 0.38/0.15.
- Bf 109: body length 9.19 -> 8.72 m (rear fuselage `TM` 0.77); slat pivots on the slat LE, `motion: translate`; wheels
  cambered 8 deg (node frame tilted); round heat-blued exhaust stubs + soot stain; E-7/Trop sand filter on the dak variant.
- C 30: rotor parked with a 4 deg head tilt (spin axis near vertical), identical blade sag; burnt tail = charred tube frames,
  all three blades broken, drooping, bare spars. `board_step` socket on the ground.
- Fuel bowser: `+x = left` like the aircraft (`wheel_fl`/`wheel_rl` at +x); burnt: rests on its rims, dense buckled shell,
  ragged blow-out with bright torn lips, heat-scaled matt steel, warped rails, charred lids (one blown open).
- `scripts/check.py` (names / bbox / sockets / pivots), `scripts/mini.py` (review grids), `scripts/docs.sh` (docs sheets).
