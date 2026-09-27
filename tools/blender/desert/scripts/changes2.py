"""Art-director round 2 fixes per desert asset (written into the sidecars by sidecar_notes2.py)."""
COMMON2 = ("LOD1/LOD2 rebuilt with a shape-preserving per-part reducer (lodfix.py): planar dissolve per part delimited by "
           "material, UV seams and vertex-colour bands; only curved parts are collapse-decimated, each on its own with a "
           "size-aware floor; no joined-mesh collapse, so walls, courtyards, minaret shafts and tanks keep their shape "
           "(no holes, sliver fans or UV smears). LOD2 drops sub-pixel parts (wire, ladders, rope). Weathering decals use "
           "a soft desert atlas (decals_dz: 2 variants per kind, random mirror, feathered, no hard quads); roof patches are "
           "soft stains plus one feathered relief repair; render loss shows rubble (never orange brick) with a 3.5 cm "
           "broken edge. New shared CC0 materials: mud_render2 (Poly Haven dirt_floor, darker/redder than the sand, "
           "2x the fine detail), screed_lime (grey_plaster_02, no craze pattern), limewash_lumpy (medieval_wall_01), "
           "corrugated_zinc (corrugated_iron_02), palm_frond_dz (alpha-tested frond / reed-mat atlas, own work). "
           "Stronger warm ground bounce in shade (limewash no longer turns blue). Water jars are lathe-turned buff "
           "clay (belly, neck, lugs); sandbags are individual pillow bags (squash, sag, pinched tied ends, random "
           "bond); sand drifts are low wind ramps feathering into the ground; debris mounds have a soft toe (no rim).")
CHANGES2 = {
 'house_flat_white_a': "LOD2 intact (no holes); soft grime streaks instead of repeated soot blotches; no brick stickers (low render loss near corners/base with a relief edge); terrace in limestone flags, main roof in patchy lime screed; jars, reed mat card.",
 'house_flat_white_b': "LOD2 intact; street stair cheek moved into the annex wall so the treads read from the game camera, plus a stair-cupboard door, damp base and render loss on the stair face; roofs furnished (jars, firewood, flue with tile cap, fronds, coop); soft weathering.",
 'house_flat_white_c': "LOD2 intact; qubba rebuilt: plastered base with two-step cornice, octagonal drum with four arched vents and a moulded ring, smooth slightly pointed lime dome (no noise) + brass finial; arbour roofed with alpha reed mats + fronds; lathe jars.",
 'house_adobe_a': "mud_render2 (sharp, clearly darker than the sand); no dark parallelogram roof patches (soft stains + one feathered mud repair); lime splats replaced by a soft pale wash; palm-frond arbour made of alpha-tested pinnate frond cards.",
 'house_adobe_b': "stair cheek hidden in the store wall (no dark sloping stringer strip), damp band + render loss on the stair face; soft roof stains; frond pergola of real frond cards; sharper mud.",
 'house_adobe_c': "rubble heaps: lumpy soft-toed mounds + flat earth spill, bricks sunk and tilted (whole, halves, bonded clumps), clods; broken wall heads show exposed mud-brick courses with ragged uneven tops; soot plumes (tapered, broken up) instead of a dark band; scorched roof decal.",
 'compound_courtyard_a': "LOD2 intact; walls in lumpy lime render (no grey tile grid); warm bounce in shaded portico; court furnished (stone drain gutter, wet stains, reed mat, basin, jars) and roof laundry; roof in patchy lime screed.",
 'compound_courtyard_b': "rounded eroded mud parapets (no Moroccan sawtooth merlons); mud_render2; soft stains; pen litter as decals + frond cards; frond arbour of real fronds.",
 'mosque_tunis': "LOD2 intact (courtyard, front walls, minaret); hypostyle seen through the arches: first column row + impost beam, flag floor with reed mats (no red/brown rug panels); green nave gable removed and the dome base + drum raised 0.6 m so the drum reads at game zoom; lime roof bay ridges + patchy screed break up the hall roof; warm bounce in shade.",
 'minaret_tunis': "LOD1/LOD2 without UV smears (per-part dissolve, no collapse on the darj panels); darj-wa-ktaf lattice in 6 cm relief over a darker panel; projecting limestone frames round every pair of lights; darker hollow core so the lights read deep.",
 'barracks_desert_a': "roof in patchy lime screed with 0.5 m raised tarred expansion joints, precast walkway tiles, soft stains; flag fixed (cross was buried inside the cloth): larger Balkenkreuz 2 cm proud on both faces.",
 'barracks_desert_a_destroyed': "collapse heap in fractured-concrete aggregate with sunk limestone blocks, clods, jagged render sheets and jagged screed slabs with rebar; roof hole with jagged zig-zag edges and 14 mm rebar; fallen slabs jagged with rebar along the breaks.",
 'barracks_desert_b': "felt roof laid in 1 m strips between wider battens, each strip its own age (old / faded / fresh tar paper), dust on the lower slopes; flag fixed.",
 'barracks_desert_b_destroyed': "wall breach cut board by board (each 15 cm board broken at its own height with V-splintered ends) + charred splinters at every board end; scorch = soft plume + irregular scorch cell (no smooth rust blob).",
 'tent_command': "plain sand-khaki duck canvas (no camo print) with dust/stain weathering; front fly with catenary sag, scalloped valance and seams; irregular sandbag revetments.",
 'tent_command_destroyed': "slim 3 cm tent poles (no logs); ragged burnt shreds draped on the ash (dense grid, torn borders); irregular scorch + ash decals; sandbags are bags.",
 'fuel_depot': "galvanised corrugated iron (corrugated_zinc, texture corrugation matched to the 0.15 m geometry); weathered concrete slab + formwork kerb with oil/wet/wear decals; irregular sandbag blast walls.",
 'fuel_depot_destroyed': "burst drums are straight charred/rusted steel with hoops, a pressure-domed lid and one torn side (no loaves, no starbursts); crater with lumpy rim, clods and irregular scorch tongues; sheets crumpled on the ground downwind, two leaning.",
 'drilling_rig': "LOD2 tank keeps its cylinder (size-aware LOD floor); racked drill pipe as thin paired stands; spill decals soft.",
 'drilling_rig_destroyed': "derrick falls SSE clear of floor, sheds, catwalk and tank; upper derrick follows a crumple path (steep kink off the stump, buckled middle, crushed flat and twisted on the sand, members kinked); stump legs torn at different heights and bent over, upper braces missing or buckled; scorch decals.",
 'well_desert_a': "irregular dished flag apron sinking into a sand/earth skirt (no hard octagon plate), loose flags at the rim; wet ground as soft decals; lighter trough water; ragged dry-stone windbreak with capstones and a gap; lathe jars.",
 'well_desert_b': "individual sandbags; weathered concrete pad with soft stains; drip trays in pale concrete with puddles; formwork-concrete chamber with iron rungs, inlet pipe + valve wheel, grime runs and a corrugated sun shade on posts.",
 'wall_octagon_seg': "mud_render2 (sharp); rounded crown with an irregular ridge and height variation; soft crack/dust decals (no dark smeared poster); low wind ramps of sand instead of pillows.",
 'wall_octagon_corner': "mud_render2; low sand ramps; rounded crown on the adjoining runs.",
 'wall_octagon_gate': "no square damp blotches (subtle render loss); stepped pyramidal pier caps with pointed finials (no helmet domes); ruts and trodden ground as soft decals (no rectangular ground plane); low sand ramps.",
 'wall_octagon_breach': "broken ends step down course by course over 1.4 m in exposed mud brick with loose bricks on the heads; rubble = lumpy soft-toed mounds with spill, sunk bricks and clods (no pancakes / brick cards); scorch decal.",
}
