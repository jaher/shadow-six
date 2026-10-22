"""M11 Maradah second art pass: the drilling site's ground gear in the sealed quarry (late-1930s cable / rotary rigs).
  pipes: `pipe_rack_ms`, 9.6 x 2.2 x 1.0: a rack of 9 m drill-pipe joints (three layers, tool joints at the ends) on three
     timber cribs with chocks, two joints rolled off on the sand, a casing elevator and a pipe wrench on the sleepers.
  mud: `mud_tank_ms`, 6.2 x 3.0 x 1.6: the riveted steel slush pit tank on timber skids with a plank catwalk along its
     rim and a ladder, a duplex mud pump with a flywheel and its stationary engine on a skid beside it, the suction pipe
     into the tank and the discharge line off to the rig, a drum of oil and a shovel.
Front (Blender -Y) = game S. Usage: blender -b --python ms_site.py -- outdir [pipes|mud] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('pipes')
NAME = {'pipes': 'pipe_rack_ms', 'mud': 'mud_tank_ms'}[VAR]
K.begin(NAME, 11901 + SEED + 7 * ['pipes', 'mud'].index(VAR), theater='desert')
r = K.rng()
PIPE_T = (0.42, 0.36, 0.3)       # mill-scale / rust brown drill pipe
TIMBER = (0.62, 0.52, 0.4)

if VAR == 'pipes':
    L, HW = 9.0, 1.0
    bm = bmesh.new()                                         # three cribs: two sleepers crossed by a cap timber
    for x in (-3.6, 0.0, 3.6):
        for y in (-0.75, 0.75):
            C.box_bm(bm, (x, y, 0.09), (0.7, 0.2, 0.18))
        C.box_bm(bm, (x, 0, 0.27), (0.24, 2.3, 0.18))
    K.part(bm, 'timber_beam', name='cribs', mat_tint=TIMBER, grime=0.9, bisect=False)
    pr = 0.065
    bm, bj = bmesh.new(), bmesh.new()
    for layer, n in enumerate((13, 12, 9)):
        z = 0.36 + pr + layer * (2 * pr - 0.012)
        y0 = -(n - 1) * pr - (0 if layer % 2 == 0 else 0)
        for i in range(n):
            y = y0 + i * 2 * pr + (pr if layer % 2 else 0)
            dx = r.uniform(-0.25, 0.25)
            C.cyl_bm(bm, V((-L / 2 + dx, y, z)), V((L / 2 + dx, y, z)), pr, 8)
            C.cyl_bm(bj, V((L / 2 + dx - 0.35, y, z)), V((L / 2 + dx, y, z)), pr * 1.35, 8)    # box end (tool joint)
            C.cyl_bm(bj, V((-L / 2 + dx, y, z)), V((-L / 2 + dx + 0.3, y, z)), pr * 1.3, 8)   # pin end
    for (y, a) in ((1.45, 0.06), (-1.5, -0.04)):              # two joints rolled off onto the sand
        ca, sa = math.cos(a), math.sin(a)
        p0, p1 = V((-L / 2 * ca, y - L / 2 * sa, pr)), V((L / 2 * ca, y + L / 2 * sa, pr))
        C.cyl_bm(bm, p0, p1, pr, 8)
        C.cyl_bm(bj, p1 - (p1 - p0).normalized() * 0.35, p1, pr * 1.35, 8)
    K.part(bm, 'paint_metal', name='drill_pipe', mat_tint=PIPE_T, grime=1.0, bisect=False, smooth=True)
    K.part(bj, 'paint_metal', name='tool_joints', mat_tint=(0.3, 0.28, 0.26), grime=1.0, bisect=False, smooth=True)
    bm = bmesh.new()                                         # chocks at the crib ends
    for x in (-3.6, 0.0, 3.6):
        for s in (-1, 1):
            C.box_bm(bm, (x, s * 1.06, 0.42), (0.2, 0.12, 0.12))
    K.part(bm, 'timber_beam', name='chocks', mat_tint=(0.55, 0.45, 0.34), grime=0.9, bisect=False)
    bm = bmesh.new()                                         # a casing elevator (hinged ring with two links) and a pipe wrench
    C.cyl_bm(bm, V((-1.8, -1.55, 0.0)), V((-1.8, -1.55, 0.16)), 0.26, 12)
    C.box_bm(bm, (-1.8, -1.95, 0.05), (0.08, 0.6, 0.06))
    C.box_bm(bm, (1.6, 1.5, 0.39), (0.9, 0.07, 0.05))
    C.box_bm(bm, (2.03, 1.5, 0.39), (0.08, 0.2, 0.07))
    K.part(bm, 'cast_iron', name='tools', mat_tint=(0.3, 0.29, 0.27), grime=0.8, bisect=False)
    K.footprint(rect(-4.8, -1.15, 4.8, 1.15), 'LOW', 'building')

if VAR == 'mud':
    bm = bmesh.new()                                         # timber skids
    for y in (-0.8, 0.8):
        C.box_bm(bm, (-0.9, y, 0.1), (4.6, 0.25, 0.2))
    C.box_bm(bm, (2.3, 0.2, 0.08), (1.5, 1.6, 0.16))           # the pump / engine skid
    K.part(bm, 'timber_beam', name='skids', mat_tint=TIMBER, grime=0.9, bisect=False)
    # the slush tank: a steel box with riveted seams and an angle-iron rim
    tx0, tx1, ty0, ty1, z0, z1 = -3.1, 1.3, -1.1, 1.1, 0.2, 1.45
    bm = bmesh.new()
    C.box_bm(bm, ((tx0 + tx1) / 2, (ty0 + ty1) / 2, (z0 + z1) / 2), (tx1 - tx0, ty1 - ty0, z1 - z0))
    K.part(bm, 'paint_metal', name='tank', mat_tint=(0.46, 0.42, 0.36), grime=1.0, bisect=False)
    bm = bmesh.new()
    for x in (tx0 + 1.1, tx0 + 2.2, tx0 + 3.3):
        for y in (ty0 - 0.01, ty1 + 0.01):
            C.box_bm(bm, (x, y, (z0 + z1) / 2), (0.06, 0.02, z1 - z0))
    for y in (ty0, ty1):
        C.box_bm(bm, ((tx0 + tx1) / 2, y, z1 + 0.02), (tx1 - tx0 + 0.06, 0.08, 0.05))
    for x in (tx0, tx1):
        C.box_bm(bm, (x, 0, z1 + 0.02), (0.08, ty1 - ty0 + 0.06, 0.05))
    K.part(bm, 'cast_iron', name='rim', mat_tint=(0.3, 0.29, 0.27), grime=0.9, bisect=False)
    bm = bmesh.new()                                         # the mud inside, a little below the rim
    C.box_bm(bm, ((tx0 + tx1) / 2, 0, z1 - 0.2), (tx1 - tx0 - 0.1, ty1 - ty0 - 0.1, 0.04))
    K.part(bm, 'mud', name='mud', mat_tint=(0.45, 0.38, 0.3), grime=0.3, bisect=False)
    bm = bmesh.new()                                         # the plank catwalk along the S rim on brackets
    C.box_bm(bm, ((tx0 + tx1) / 2, ty0 - 0.3, z1 - 0.1), (tx1 - tx0, 0.5, 0.05))
    for x in (tx0 + 0.3, (tx0 + tx1) / 2, tx1 - 0.3):
        C.box_bm(bm, (x, ty0 - 0.3, z1 - 0.18), (0.08, 0.55, 0.08))
    K.part(bm, 'planks', name='catwalk', mat_tint=(0.7, 0.62, 0.5), grime=0.9, bisect=False)
    K.ladder((tx0 + 0.4, ty0 - 0.6, 0), z1 - 0.1, (0, -1, 0), width=0.4, lean=0.35, mid='timber_grey', name='ladder', meta=False)
    # the duplex pump (block + fluid end + flywheel) and its stationary engine
    bm = bmesh.new()
    C.box_bm(bm, (2.15, 0.55, 0.5), (1.1, 0.6, 0.6))
    C.cyl_bm(bm, V((1.6, 0.35, 0.5)), V((1.6, 0.35, 0.95)), 0.16, 10)
    C.cyl_bm(bm, V((1.6, 0.75, 0.5)), V((1.6, 0.75, 0.95)), 0.16, 10)
    C.box_bm(bm, (2.4, -0.3, 0.55), (0.8, 0.7, 0.75))
    C.cyl_bm(bm, V((2.4, -0.3, 0.93)), V((2.4, -0.3, 1.5)), 0.06, 8)
    K.part(bm, 'paint_metal', name='pump', mat_tint=(0.3, 0.36, 0.3), grime=1.0, bisect=False)
    bm = bmesh.new()
    C.cyl_bm(bm, V((2.85, 0.12, 0.62)), V((2.95, 0.12, 0.62)), 0.48, 18)
    C.cyl_bm(bm, V((2.7, 0.12, 0.62)), V((3.0, 0.12, 0.62)), 0.07, 8)
    K.part(bm, 'cast_iron', name='flywheel', mat_tint=(0.25, 0.24, 0.22), grime=0.8, bisect=False)
    pipe([(1.6, 0.55, 0.6), (1.1, 0.55, 0.6), (0.7, 0.55, 1.6), (-0.2, 0.55, 1.6), (-0.2, 0.55, 0.9)], r=0.07, name='suction', tint=(0.4, 0.37, 0.33))
    pipe([(2.0, 0.85, 0.85), (2.0, 1.45, 0.85), (2.0, 1.45, 0.1), (3.1, 1.45, 0.1)], r=0.06, name='discharge', tint=(0.4, 0.37, 0.33))
    drums([(3.15, -1.0, 0)], tint=(0.33, 0.36, 0.3), name='oil_drum')
    K.footprint(rect(-3.2, -1.5, 3.2, 1.5), 'LOW', 'building')

dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
