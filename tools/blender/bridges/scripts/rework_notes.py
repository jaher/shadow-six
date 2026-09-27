"""Write the art-director round-2 rework notes into each sidecar (<name>.kit.json 'rework') and print a summary."""
import json, os
OUT = '<claude-tmp>'
STONE = ['wing walls rebuilt as battered (1:9) retaining walls along the bank that step down from parapet height in 3 coping-capped steps to a terminal pier, with a projecting footing into the river and quoins',
         'voussoirs of equal depth (smooth extrados) + projecting archivolt band; soffit re-mapped by arc length (stone courses run along the barrel, no stripes)',
         'granite_wall texture (plank-like courses) retired for bridges: granite = dressed ashlar blocks tinted granite-grey at the correct ~0.3 m course scale; cutwaters darkened',
         'riprap rebuilt as rounded boulders piled against the pier foot, sunk so only 10-35 cm break the surface, wet/algae-dark (toe riprap along banks removed)',
         'vertex-colour weathering pass: dark algae band + pale tide line + damp fade at the waterline, per-stone tone/hue breakup, lichen, north-face moss, deck run-off streaks, darker damp soffits']
NOTES = {
 'bridge_stone_arch1_a': STONE + ['stronger lichen on the grey fieldstone'],
 'bridge_stone_arch1_b': STONE + ['desert limestone: sun bleaching of south/top faces, sandy dust build-up at the base, no moss'],
 'bridge_stone_arch3_a': STONE,
 'bridge_stone_arch3_b': STONE + ['brick: repointed / newer-brick patches and efflorescence patches break the uniform brick'],
 'bridge_stone_arch5_a': STONE + ['patch repairs and tonal breakup along the 76 m; hidden voussoir/archivolt faces trimmed to stay in budget'],
 'bridge_stone_arch3_a_destroyed': STONE + ['breach cut at block level: whole voussoirs / coping / kerb stones removed, torn blocks at the edge displaced (hanging masonry); fracture faces re-materialed as brown rubble fill; torn parapet',
                                             'river debris = grey ashlar blocks + wedge voussoirs + tilted wall slabs on a stone-fill mound (no gravel blob); spilled blocks on the deck stumps',
                                             'soot is a directional vertex-colour gradient around the blast (rises upward), no splat decals; floating sheets removed (decals/road/base trimmed by face)'],
 'bridge_stone_arch3_a_snow': STONE + ['road snow sheet with drifts against the kerbs and wheel ruts (slush-grey), snow caps on coping, string courses, cutwater caps, lamps, wing copings',
                                        'shore-fast ice shelves around piers and banks (grey-blue with snow patches) + floes, icicles under the string course'],
 'bridge_timber_road': ['cambered deck (0.45 m rise) with stringers, planks, running boards, guards and rails following the camber',
                        'ice-breakers rebuilt: framed raked nose, horizontal plank sheathing, corner posts, iron-shod nose with bolts (no flat black slabs)',
                        'bents: heavier weathered-grey X-bracing + girts contrasting with tarred posts; tall capped rail posts + flat-bar lattice',
                        'deck planks now weathered grey timber (not pinkish); railing kept un-decimated in LODs (no striping at 0.5x), lattice dropped from LOD1+'],
 'bridge_timber_road_snow': ['inherits timber_road fixes', 'drifted deck snow with wheel ruts, caps on bent caps / bracing / rails / ice-breakers, ice collars on every post, icicles, bank ice + floes'],
 'bridge_rail_trestle': ['pedestals and pillars re-textured as dressed granite blocks (correct scale), pillar back walls carry the timber approaches',
                         'plate girders: stiffener pairs, cover plates, camera-side rivet rows, rocker bearing shoes on lowered bridge seats',
                         'riprap hugs the pillar feet; tide mark / algae weathering; period flat-bar handrail'],
 'bridge_rail_trestle_snow': ['inherits trestle fixes', 'snow on track between exposed rails, caps on bent caps and braces, grey-blue ice shelves + floes, icicles'],
 'bridge_truss_maas': ['truss rebuilt (truss_span2): box chords with cover plates, LACED built-up verticals, gusset plates at every node with rivet grids, rivet rows along the chords, rocker bearings on lowered pier seats',
                       'piers: dark weathered ashlar, moulded cap cornice, granite starlings, tide mark; riprap against the starlings',
                       'sett roadway darker and finer; lattice footway railings; members kept in every LOD (diagonals survive at 0.5x)',
                       'new references: HAER Enterprise Parker truss + rocker (PD), Nationaal Archief Venlo 1944-45 blown Maas spans (CC0)'],
 'bridge_truss_maas_destroyed': ['inherits truss fixes', 'collapsed halves buckled (sag + sideways bow), twisted, crumpled toward the tear, members torn away, dangling stringers and bent deck plates',
                                 'river debris = granite/ashlar blocks + slabs (no peach blob); no stray wires'],
 'bridge_lift_lever': ['modelled chain links (real alternating links) hanging plumb from shackle blocks; anim documents keep_vertical parallelogram behaviour',
                       'period timber railings with St Andrew crosses + bolts; underside X-bracing on the leaf; vertex weathering + rust bleed'],
 'bridge_bascule_double': ['masonry substructure: brick piers with limestone cutwaters and segmental side arches with voussoirs; retaining walls at the quays',
                           'modelled chain links, period painted-timber railings, paint chipping (bare wood), grime and rust bleed under trunnions / eyes'],
 'lock_gates': ['timber mitre gates with heavy BALANCE BEAMS (defining silhouette), framed rails, plank skin, iron diagonal, paddle frames + rack-and-pinion paddle gear',
                'heavy jointed granite coping (bull-nosed), dressed-stone walls with ladder recesses, paved lock side, raised sett foot-stop arcs, capstans',
                'push-pull struts removed (beam-operated); tide mark + algae at both pool levels'],
 'lock_gates_open': ['same as lock_gates; open state shows the balance beams swung onto the lock side'],
 'dam_arch': ['orientation fixed: downstream face toward the yaw-0 camera (-Y blender / south), reservoir north',
              'gorge walls and rim crags of jointed rock with a new CC0 rock texture (Poly Haven cliff_side) replace the boulder "potatoes"',
              'spillway works: training walls, stilling basin with baffle blocks, end sill, apron riprap; lift-joint lines, weep-hole drains, bottom-outlet valve house, calcite streaks',
              'reference: HAER Little Rock Creek dam spillway (PD)'],
 'dam_arch_snow': ['inherits dam fixes', 'snow caps on crest / parapets / hoists / crags, icicle curtains on the spillway lip and lift joints, frozen tailwater with floes'],
 'dam_arch_destroyed': ['inherits dam fixes', 'V-breach cut at the crest with fracture faces, exposed bent rebar, torn lift joints; fractured concrete blocks + slabs debris',
                        'released-water sheet pouring through the notch + spray billows at the impact zone'],
 'footbridge_plank': ['one continuous tapered/sagging log per stringer (no mid-span seam)', 'handrails on both sides with thicker rails, more posts, knee braces, bolts and rope lashings',
                      'cross-bearers, braced mid bent with cap/sill, stacked dry-stone sills'],
 'footbridge_plank_snow': ['inherits plank fixes', 'trodden snow path on the planks, caps on rails / posts / logs, ice collar, icicles'],
 'moat_bridge_draw': ['Buntsandstein: real sandstone texture (bedded blocks) tinted deep red + bedding bands, erosion and soot', 'battered stepped retaining walls replace the flat pink slabs',
                      'framed oak leaf: side sills, heel/tip beams, joists, cross beams + braces, iron straps wrapping the tip, tip shoe, strap hinges, pintle and knuckles',
                      'modelled chains over sheaves on free-standing gate piers (node gate_frame) down to counterweights (no chains ending in mid-air)'],
 'moat_bridge_fixed': ['Buntsandstein texture + bedding / erosion / soot', 'green moss strip decal removed; tide mark via vertex colour', 'retaining wing walls; pier footings'],
}
COMMON3 = ['r3 pipeline: vertex colours now exported (COLOR_0) so tide/algae bands, per-stone tone breakup, lichen, soot gradients and riprap/debris tints actually ship (were lost before)',
           'r3: AO baked with bank planes + water plane instead of a z=0 ground (no black arch soffits); rain-streak/damp decals ray-culled so none float in arch openings or over water',
           'r3: approach ramps with kerbs + embankments, soffit re-mapped per course, LOD2 ~12-15% with welded seams; all LOD0 <25k tris, GLB <2.2 MB']
NOTES['dam_arch_destroyed'] = NOTES['dam_arch_destroyed'] + ['r4: spray billows re-made as low smooth churned-water boils in the water_flow material (were opaque white snow blobs reading as rocks)']
S4 = ['r4: scupper spouts and X pattress plates removed from the pier heads (they read as black chevron glyphs at 1x); haunch streak decals removed (smudges)',
      'r4: cutwaters rebuilt (brfix3.cutwater): coursed ashlar with real course grooves and per-course tone, a plinth/starling with a sloped weathering all round the pier, projecting drip course and three stepped cap stones with an apex stone (no bare prism + pyramid)',
      'r4: waterline painted into the cutwaters/plinths and every masonry part: wet foot, ragged dark-green algae band to ~0.9 m, pale tide line, damp fade to 2.6 m (the old band sat under the starling top and never showed)',
      'r4: riprap = rounded lumpy boulders heaped against the plinth, 28-62 % of their height out of the water, dry grey tops over a thin wet line (no flat dark discs)',
      'r4: soffit AO floor 0.58 applied to the baked AO map under the barrel soffits (they only receive indirect light) - soffits read as stone, not black',
      'r4: LODs rebuilt by per-part proportional decimation (every part keeps ~r of its triangles, simple parts >= 60 tris; big surfaces no longer starved) with the ratio lowered until the target is met, then only loose pieces < 1.2 m culled: LOD1 32-40 %, LOD2 11.5-12.7 % (was 18-25 %)']
R4 = {
 'bridge_stone_arch3_a': S4 + ['r4: pilaster/dressed "granite" tint lifted (0.55 -> 0.66) so the pier heads no longer read as dark vertical streaks'],
 'bridge_stone_arch3_b': S4 + ['r4: efflorescence decals (bright white blobs) replaced by a soft, low-contrast vertex-colour salt bloom under the string course and over the haunches (1.3 m weathering grid)'],
 'bridge_stone_arch5_a': S4 + ['r4: pilaster tint lifted; pier-head streak decals removed'],
 'bridge_stone_arch3_a_destroyed': S4 + ['r4: loose blocks around the tear are kept only where bedded in / resting on masonry (BVH test: within 0.3 m of a surface and supported within 0.7 m below) - no ring of hanging voussoirs, no blocks in the sky above the deck',
                                        'r4: river debris = slumped talus (brfix3.debris_pile): ridged, multi-lobe fill heaped against both arch stumps with a downstream tongue, crest ~1 m out of the water, covered with ~190 resting blocks, bonded voussoir-ring chunks, wall slabs and setts; off-heap blocks mostly dropped, the rest sunk and tipped so only an edge breaks the surface (no dome, no plates floating flat)',
                                        'r4: road kerbs split at the breach (the thin bar spanning the gap at deck level is gone)'],
 'bridge_stone_arch3_a_snow': S4 + ['r4: deck snow: four wandering wheel ruts (slush-brown) + trodden grey patches, 1.1 m grid, not decimated by the budget trim (no rectangular slab seams)',
                                   'r4: ice collars v3: thick (0.28 m) rounded rims in 4 rings tapering into the water with a noisy outline, grey-blue ice, snow dust only in patches (no flat white planes)',
                                   'r4: lamp standards v2: painted dark green-grey, stepped plinth, three collars, ladder bar with ball ends, scroll brackets, larger lantern with pagoda cap; snow cones on the cap / collar / plinth'],
 'bridge_timber_road_snow': ['r4: approach pads are snow-covered: the drifted, rutted snow sheet runs on down both ramps (ramp surface itself is snow material) - no bare orange pads on the snowfield',
                             'r4: ice collars v3 (thick rounded grey-blue rims, tapered lips) at every post and ice-breaker',
                             'r4: LODs by per-part proportional decimation: LOD1 29 % (was 52 %), LOD2 11.4 % (was 40 %); budget trim of snow caps / bracing keeps LOD0 at 24.3k'],
 'bridge_truss_maas_destroyed': ['r4: rubble dome replaced by a slumped multi-lobe talus of granite/ashlar blocks and setts with torn steel sections (I-beams, bent plates) lying on it; blocks off the heap sunk/tipped',
                                 'r4: LODs by per-part proportional decimation: LOD1 31 %, LOD2 15.9 % (was 33 %) - further collapse would dissolve the lattice members'],
}
D4 = ['r4: the soft rectangular dirt decals are gone. New shared lib material concrete_dam (tools2/make_dam_tex.py, own work CC0, derived from CC0 concrete_board): 6.4 m tile with 1.6 m lifts, dark cold-joint lines, laitance + patchy efflorescence bloom under every joint, staggered formwork panel joints, 0.2 m board marks, vertical leaching streaks (grime / rust / calcite) hanging from the joints and from weep holes. The face UVs are computed by arc length and height (dam_uv) so the texture lifts register with the geometric lift bands',
      'r4: rock abutments unified: both gorge walls and both rim crags use one explicit UV projection (the aligned projection mirrored/rotated the texture + normal map on the east bank), smooth shading, no per-part colour jitter, orientation enforced',
      'r4: toe apron paved: 16 jointed concrete_slab panels with nosing, a coped edge kerb and cast-iron bollards; toe ledge face in concrete_dam; waterline band on the toe',
      'r4: spillway training walls: concrete_dam board-marked faces, coping, four counterfort buttresses each side, weep pipes (no plain boxes)']
R4['dam_arch'] = D4
R4['dam_arch_snow'] = D4 + ['r4: rim-crag snow = a snow mantle following the rock heightfield, lifted on flat ground and sunk below the rock on slopes so its edge is the irregular intersection contour (no flat white quads); no snow bars on the lift joints, toe ledge or basin walls; copings get pillowed caps',
                            'r4: budget trim to 24.3k (was 25.6k)']
D4.append('r4: LODs by per-part proportional decimation (rock walls and the dam face keep proportional density): LOD1 ~40 %, LOD2 12-13.6 %')
R4['dam_arch_destroyed'] = D4 + ['r4: LOD2 13.6 % (was 17 %)']
for n, notes in NOTES.items():
    notes = notes + COMMON3 + R4.get(n, [])
    p = os.path.join(OUT, n, n + '.kit.json')
    if not os.path.exists(p):
        print('missing', n)
        continue
    m = json.load(open(p))
    m['rework'] = {'round': 4 if n in R4 else 3, 'date': '2026-09-26', 'changes': notes}
    json.dump(m, open(p, 'w'), indent=1)
print('ok', len(NOTES))
