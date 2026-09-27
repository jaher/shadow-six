"""Stamp art-rework-2 notes (on top of rework-1, via rw/sidecar_notes.py) into the military sidecars."""
import json, glob, os
N = {
 'castle_gate': 'parapet coping = individual ashlar stones in 3 tone lots, parapets in fieldstone_grey (matches the gatehouse), deck in setts_granite with wheel ruts + gutters, kerbs stop at the wing walls, algae bands on starlings/piers/revetments, corbel courses under the refuges; ruin: E spire gone + hollow broken crown, W spire snapped, roof holes, merlon bites, soot, parapet/arch bites, grey scree rubble in the moat.',
 'castle_wall': 'ruin: stepped notch breach (mil.notch_cut) with grey scree rubble + blocks; no floating parapet/merlons across the gap.',
 'castle_tower': 'ruin: stepped notch breach, crown removed over the breach, grey scree rubble.',
 'lighthouse': 'destroyed: shaft chunks and lantern cage lying on grey scree rubble.',
 'watchtower': 'destroyed: NW legs still standing as 3.5/2.7 m stumps with splinters, fallen leg logs.',
 'mg_nest': 'destroyed: lobed sand spills and flattened burst sacks (no plates).',
 'bunker': 'rounded berm toe (berm_outline), planar turf UVs, gravel berm on desert, dog-leg continuous entrance walls, garnished net on poles with sag + tufts, soot.',
 'casemate': 'full-roof mounded turf overhanging W/E, rounded berms on both sides, gun girth x1.5, soot on visor/soffit/jambs/splays.',
 'hangar': 'canvas UVs follow each cloth, rib sag 0.3 m, closed door leaves (no glass on canvas doors), random apron decals, rust decals (a), soot rings round the holes (destroyed).',
 'uboat_pen': 'Fangrost in 3 tone lots with per-rib UV offsets, 4 flak positions, tar patches, puddle/moss decals, debris, cables, MG nests, ammo, camo nets, pilasters, louvred vents + hoods, side doors + baffles, pen soffit lamps; snow: trough drifts, icicles, melt streaks.',
 'firing_range': 'earth-filled overhead baffle with deflector, lane markers, firing mounds, mantlet, edged walks, tar-paper shed roof with battens, flag cloth.',
 'v2_pad': 'Meillerwagen moved to the NW (behind the rocket from the game camera) so the A4 reads in front of its cradle; lighter splinter camouflage.',
}
COMMON = 'art-rework-2: new shared materials scree_grey, setts_granite (Poly Haven CC0), concrete_camo v2, tent_canvas v2; rubble rewritten (grey scree + blocks).'
for d in sorted(glob.glob('out/*/')):
    n = os.path.basename(d.rstrip('/'))
    base = next((k for k in sorted(N, key=len, reverse=True) if n.startswith(k)), None)
    p = os.path.join(d, n + '.kit.json')
    if not base or not os.path.exists(p):
        continue
    m = json.load(open(p))
    notes = [x for x in m.get('notes', []) if not str(x).startswith('art-rework-2')]
    notes += ['art-rework-2 (%s): %s' % (base, N[base]), COMMON]
    m['notes'] = notes
    json.dump(m, open(p, 'w'), indent=1)
    print('noted2', n)
