# SHADOW SIX - rail group (locomotive, rolling stock, tram, mine wagons, K5 railway gun, crane, handcar)

Build: `bash scripts/run.sh <script>.py <variant|all>` (background Blender 4.2, log in `logs/`), or sequentially
`scripts/chain.sh a.py:all b.py:grey,...` (log `logs/chain.log`).
Review: `bash scripts/review.sh out/<asset>/<asset>_<variant>.glb [views]` (kit renderer, real 1.8 m soldier, ballasted
track under the vehicle from the sidecar `review_track`); `python3 scripts/multi.py out.jpg <name>...` multi-asset sheet.
Summary: `python3 scripts/summary.py`; credits: `python3 scripts/credits.py` -> `out/credits_rail.json`.

Pipeline = cars_moto/naval `veh.py` (kit parts, COLOR_0 weathering, LOD0-2, baked AO on UV1, `.kit.json` sidecar with a
`vehicle` block) + `rail.py`:
- ORIGIN = TOP OF RAIL at the vehicle centre (y=0 is the rail head; the trestle bridge `train_path` anchor gives the
  rail-head height); front faces glTF +Z. Standard gauge 1.435 m (tram 1.0 m, mine wagons 0.6 m) in `vehicle.gauge_m`.
- Every wheelset is a node `ws*` (spins about local X, `radius` in `moving[]`); bogies/trucks/Bissel are yaw nodes and
  the wheelsets are glTF children of them (`moving[].parent`). Contacts = both rail heads under every wheel.
- `coupler_front` / `coupler_rear` sockets on the buffer faces (loco rear = drawbar to `tender_t30.coupler_front`):
  chain a train by placing each vehicle so the couplers meet.
- Weathering: brake dust (iron oxide) low on wheels/frames, run-off streaks, ash/soot on steam loco tops, dust on tops,
  snow slabs (`snow_soft`) + rime for winter, `veh_burnt` + wreck pose for burnt.
- Loco rods: `rod_c_l/r` (coupling rods translate with the crank vector), `rod_m_l/r` (main rod, big end on the ws3
  crankpin), `xhead_l/r` (crosshead slides along the loco axis); the left crank leads the right by 90 deg.

| asset | script | variants | notes |
|---|---|---|---|
| loco_br52 (DR BR 52 Kriegslok 2-10-0) | loco_br52.py | dr, winter, burnt | 5 coupled + Bissel, rods, smokebox door, chimney smoke/sparks/steam emitters, blackout lamps |
| tender_t30 (2'2' T30 Wannentender) | tender_t30.py | dr, winter, burnt | 2 bogies, coal load toggle, water filler hatch |
| wagon_covered (G10) | wagon_covered.py | brown, winter, burnt | sliding doors (slide 2.0 m), hide-inside socket; burnt = steel skeleton |
| wagon_open (Omm 33 Linz) | wagon_open.py | brown, winter, burnt | hinged double doors, coal load toggle |
| wagon_flat (R10 + military load) | wagon_flat.py | brown, winter, burnt | tarpaulin stack + ammunition boxes (`load` toggle) |
| wagon_tank (Kesselwagen) | wagon_tank.py | grey, winter, burnt | dome hatch, outlet valve socket + fuel_leak emitter; burnt = torn tank |
| coach (Donnerbuechse) | coach.py | green, winter, burnt | end doors, platforms, seats, hide-inside |
| tram_fr (French 2-axle motrice, metre gauge) | tram_fr.py | green, burnt | trolley pole + retrievers (node trolley_pole: pitch/yaw), tall wooden-framed windows, route board, lifeguard trays, resistor grids, sliding bulkhead doors, M15 hide socket |
| mine_tipper (Muldenkipper V-skip, 600 mm) | mine_carts.py | rust, winter | deep V skip on rocker arcs rolling on cradle rails: tip +-48 deg = rotate about the rocker centre + translate R*theta; coal toggle, push socket |
| mine_cart (box coal tub, 600 mm) | mine_carts.py | rust, winter | end door, coal toggle |
| railgun_k5 (K5(E) "Leopold") | railgun_k5.py | grey, dak, winter, burnt | 2 x 12-wheel bogies (4 trucks), gun node elevation 0..50, hoist, ladder_foot socket (M6 charge) |
| rail_crane (10 t steam crane) | rail_crane.py | black, winter | slew -> jib luff -> hook pendulum (counter-rotate hook.x = -jib.x); travel pose 12 deg on the idler's rest; visible drums/gears/engines, cast counterweight, jacks with timber pads |
| rail_crane_idler (match wagon) | crane_idler.py | black, winter | jib-rest trestle (socket jib_rest), tool boxes, rope drum; couples ahead of the crane |
| handcar (pump Draisine) | handcar.py | wood, winter | pump beam see-saw, brake lever |

No swastikas/SS runes; railway stock carries no Balkenkreuz (not used on it historically). Lettering is suggested
with abstract stencil bars (no readable text).

## Rework 1 (review feedback)
- `post_rail()` (rail.py) patches every exported GLB: matt paint (veh_paint roughnessFactor 1.6 + KHR spec 0.35), glass
  alpha-blend, coal -> `lib/coal_*` lump textures, riveted plate -> `lib/rivet_*` (K5 all paint, tank wagon shell),
  K5 DAK -> `lib/k5camo_diff` (tan + red-brown/olive blotches, Italy 1943-44), K5 winter -> `lib/k5ww_diff` (worn
  whitewash, streaks). Textures are procedural CC0 (`make_rail_tex.py`, `make_k5_tex.py`), manifest `lib/materials_add.json`,
  referenced by relative URI with KHR_texture_transform where the carrier tile differs.
- Vertex tints are now converted to linear (`_lin` in grime_rail): palette colours render as specified (the tank/K5
  grey no longer read silver).
- Helpers: `coal_heap` (smooth lumpy grid + scattered lumps), `deform` (wreck damage), `icicles`, `gear`, detailed
  `bogie`, DR headlamp with Tarnkappe blackout cover.
- Tools: `scripts/fast.sh <script> <vars>` (no AO -> fast/, prints TRIS_BY_PART), `scripts/rvall.sh <out|fast> <views> names...`,
  `scripts/docs.sh` (docs/screenshots/veh-rail-*.jpg). Review renderer: meshopt decoder, rails without the blue sky cast.

## Rework 2 (review 2 feedback)
- HANDEDNESS: Blender -Y = front (glTF +Z), so glTF **+X = vehicle LEFT**, -X = RIGHT. Wheel contacts are now
  `ws*_l` at +X / `ws*_r` at -X; loco rods `rod_*_l` (+X) / `rod_*_r` (-X, leads by 90 deg, DR practice).
  BR 52 is right-hand drive (DR): `driver` socket at -X (right) with the air pump + reach rod; `fireman` socket at +X
  (left) with the feed-water pump, injector and turbo-generator. Other side-named sockets (cab doors, entrances,
  pumpers, wagon doors, lamps) renamed to match.
- Wrecks stay on the rails: `rail.wreck_pose(T)` slumps/tilts only the sprung body; wheelsets, bogies/trucks,
  Bissel, coupling rods, axleboxes and brake blocks keep the treads on the rail heads (checked with
  `scripts/wheelcheck.py out`: tread-rail = 0.000 for every wheel of every variant). The K5 blown-off barrel section
  lies flat on the ground beside the ballast (x 2.6-3.1) in a long earth scar, clear of carriage and rails.
- Coal: `rail.lump_bm` fractured lumps (7-11 point hulls, 3-8 facets, 0.05-0.28 m, partly sunk, inside the rim) on a
  flat-shaded faceted heap; rail:coal darker (0.2) with glossy facets. Tender / open wagon / mine wagons.
- Value breaks: `rail.SHEEN` keys get an oily-gloss material (`kit:veh_paint~fcfcfc`, BR 52 boiler); loco limescale
  and dust streaks (`rail.streak`) below domes, safety valves and washout plugs, worn running-board edges, bright
  handrails. K5: flanges / T-ribs `rib` key lighter than the web, dusty deck (`deckdust`), DAK flange no longer a
  dark stripe.
- `rail.label_block` faces now point along the surface normal (lettering was back-facing and invisible on some
  sides); open wagon has a black data panel + stencil blocks.
- Burnt tank wagon: heat-discoloured steel set `lib/heat_*` (make_heat_tex.py, CC0) on continuous cylindrical UVs,
  sooted black interior behind the tear, 8 torn petals peeled outward, straps sag with the shell, front strap snapped.
- New toggles/nodes: K5 `ladder` (slide, stowed by default; `ladder_deployed`), crane `outrigger_*` / `jack_*`
  (stowed by default; `outriggers_deployed`), tender `coal_door` (vertical slide), idler `lashing` chain + socket
  `hook_lash`; crane hook rope 0.8 m in the travel pose (block clears the idler).
- Review: `scripts/rvset.sh <out|fast> name:views ...` (per-asset view lists; side_e now rendered for every variant),
  `scripts/mont.py` quick montage, `docs.sh` adds veh-rail-side.jpg + veh-rail-wrecks.jpg.
