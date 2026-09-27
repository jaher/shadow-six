"""Stamp art-rework-3 (review round R3 rejects) notes into the military sidecars. Run from art/military after
rw/sidecar_notes.py and rw2/sidecar_notes2.py (a rebuild writes a fresh sidecar with empty notes)."""
import json, glob, os
N = {
 'castle_gate_ruin': 'floating vane of the snapped W spire removed; soot plumes above every burnt-out window, on the S/SE/SW tower faces and the gatehouse facade; cracked quoins; 4 more merlons shot away; moat/passage rubble = piles of individual blocks (mil.rubble pile=True: low faceted core under stacked tilted blocks, tops above water); portcullis blown out (anchor raised=True); budget kept by fewer blocks.',
 'uboat_pen': 'Fangrost ribs split at expansion joints into segments, 4 tone lots, own UV offset/rotation per segment, tops weathered concrete / faces board-formed, world-space vertex-colour mottle; 6 bomb craters + 4 blast-broken rib ends with rebar; 2 more MG/AA posts, torn net remnants; 44 strong top decals + 40 rib-face decals, darker/more tar patches; long walls: formwork lift-line bands (decals), downpipes + service pipes, second (west) stair tower; murky water body in the basins, pen interiors dim concrete instead of black; review water edge moved under the facade.',
 'bunker': 'camo paint = concrete_camo_heer (dunkelgelb / olive / chocolate, sprayed edges, no board/scanline streaks); camouflage net = alpha-tested camo_netting (twine mesh + scrim, see-through drape) instead of an opaque sheet.',
 'casemate': 'visor: board-formed texture with arc-length UVs, vertex-colour AO gradient (dark under the drip), black soffit, spalled rim, cracks / rust bleed / efflorescence / damp decals; gun barrel girth x1.4, darker; alpha camo_netting draped onto the berm; camo: concrete_camo_heer; destroyed: gun slewed off its racer ring, barrel burst with the muzzle half on the apron, embrasure blown open with rebar, turf cratered to the slab, bent rails, extra soot and spall piles.',
}
COMMON = 'art-rework-3: new shared materials concrete_camo_heer, camo_netting (alpha MASK, double sided; own work CC0, art/military/tools/make_mil_tex4.py).'
for d in sorted(glob.glob('out/*/')):
    n = os.path.basename(d.rstrip('/'))
    base = next((k for k in sorted(N, key=len, reverse=True) if n.startswith(k)), None)
    if n.startswith('bunker_') and n != 'bunker':
        base = None                                  # desert / snow / destroyed were approved and not rebuilt
    p = os.path.join(d, n + '.kit.json')
    if not base or not os.path.exists(p):
        continue
    m = json.load(open(p))
    notes = [x for x in m.get('notes', []) if not str(x).startswith('art-rework-3')]
    notes += ['art-rework-3 (%s): %s' % (base, N[base]), COMMON]
    m['notes'] = notes
    json.dump(m, open(p, 'w'), indent=1)
    print('noted3', n)
