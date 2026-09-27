"""Rework-3 (art director pass 3) change log -> <name>.kit.json 'rework3' (+ re-applies rework-1 entry lost on rebuild)."""
import json, os, sys, datetime
E = '<claude-tmp>'
sys.path.insert(0, E + '/rw')
import changes as C1
ST = ('Eave gutters + downpipes now slim (r 5 cm, was 7 cm) weathered-zinc paint_metal tucked under the slate edge instead of '
      'near-black cast iron -> no more ink outline round the hip roof; hip/ridge rolls in zinc (r 8.5 cm, pale) instead of dark '
      'slate cylinders; every roof facet gets one planar UV basis from its area-weighted normal (slope_uv) so slate courses run '
      'parallel to each eave with no per-face jumps -> the smeared/stretched hip facet is gone.')
CH = {
 'station_rail_a': ST,
 'station_rail_b': ST + ' Eaves cornice lowered 0.26 m: its top step was poking up through the roof slab and drew a thin '
    'dark-red brick line across the whole slope at the foot of the clock pediment.',
 'watermill_a': 'Headrace rebuilt: the 1.6 m pale box leat wall in front of the wheel is now a low rubble wall (top 5 cm above '
    'ground) with individual chamfered coping blocks (two tones, 12 mm joints, iron cramps, moss), a bearing pedestal only '
    'at the axle, algae band + waterline stains + rain streaks on the river face; visible headrace water (water_flow) held '
    'at breast height, spilling as a curved nappe over the stone breast onto the floats, foam boils at the tail; the whole '
    'wheel down to the water is visible from the game camera.',
 'watermill_b': 'Pale scattered single boards replaced by real patched sections: 5 adjacent full-height boards filling a '
    'batten bay (ragged ends, nailed cleat), in greyed-tar or dark fresh-tarred tone, never over windows; same headrace / '
    'leat-wall / water rework as watermill_a.',
 'mill_old_a': 'Random lichen / rain-streak decals and the window sill streaks removed from the intact tower (they read '
    'as two soot smudges beside the door); only the moss band at the north foot remains. Ruin variant unchanged (rng kept).',
 'mill_old_b': 'Buck rebuilt: dark backing wall + real overlapping clapboards (20 cm boards, 35 mm drip edge, 3 tones), '
    'protruding corner posts, sill beam, floor girt and wall plate, pale window/door casings, rear door landing with rail; '
    'curved hull-section roof (steep eaves to a crisp ridge, 2 m rise) in shingles with tarred battens following the curve, '
    'pale ridge capping and curved barge boards, roof carried 0.55 m forward over the windshaft neck; roundhouse: steep shingled cone up to a '
    'tarred-canvas collar round the post (no flat disc), 16 rafter rolls, eave board, brick corbel course, three small lights, '
    'stone step. 3.5k -> 8.7k tris.',
}
for n, txt in CH.items():
    p = os.path.join(E, 'out', n, n + '.kit.json')
    m = json.load(open(p))
    if n in C1.CH:
        m['rework'] = {'pass': 'europe rework 1 (art director)', 'changes': C1.CH[n], 'common': C1.COMMON, 'damage': None}
    m['rework3'] = {'pass': 'europe rework 3 (art director review 2)', 'date': str(datetime.date.today()), 'changes': txt}
    json.dump(m, open(p, 'w'), indent=1)
    print('ok', n, 'rework1' if n in C1.CH else '-')
