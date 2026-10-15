"""M10 airfield dugout `dugout` (dossier §5.1 `dugout_airfield`, 14 x 6 x 2.5, building-inventory critic: a long, low
log-and-sandbag dugout with earth on the roof, NOT concrete): half sunk in the shelf, walls of horizontal log cribbing
on sandbag courses, a roof of logs laid across under a sand-and-earth mound, two entrances in the S face (local x -4 and
+3: the mission's garrison doors) framed by timber posts and a log lintel with sandbag cheeks and a dark way down, a
stovepipe, a whip aerial, a camouflage net thrown over the W end, a short flagpole at the NE corner (animated flag
anchor), jerrycans and an ammunition box by the E door, sand at every foot.
Front (Blender -Y) = game S. Usage: blender -b --python ic_dugout.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('a')
NAME = 'dugout_log_ic'
K.begin(NAME, 11001 + SEED, theater='desert')
r = K.rng()
HW, HD, ZW = 7.0, 3.0, 1.45                # half sizes, wall-top height above the shelf
LOG = (0.72, 0.62, 0.5)
DOORS = (-4.0, 3.0)
# ---- sandbag base course + log cribbing above it (gaps at the two doors)
for (a, b) in (((-HW, HD), (HW, HD)), ((-HW, -HD), (HW, -HD)), ((-HW, -HD), (-HW, HD)), ((HW, -HD), (HW, HD))):
    segs = [(a, b)]
    if a[1] == -HD and b[1] == -HD:
        segs = [((-HW, -HD), (DOORS[0] - 0.75, -HD)), ((DOORS[0] + 0.75, -HD), (DOORS[1] - 0.75, -HD)), ((DOORS[1] + 0.75, -HD), (HW, -HD))]
    for k, (p0, p1) in enumerate(segs):
        dz.sandbags(p0, p1, rows=3, name='base%d_%d' % (int(a[0] + a[1] + 20), k), thick=2, footprint=False)
bm = bmesh.new()
for side in ('n', 's', 'w', 'e'):
    for k in range(3):
        z = 0.72 + k * 0.24
        if side in ('n', 's'):
            y = HD if side == 'n' else -HD
            spans = [(-HW - 0.25, HW + 0.25)] if side == 'n' else [(-HW - 0.25, DOORS[0] - 0.75), (DOORS[0] + 0.75, DOORS[1] - 0.75), (DOORS[1] + 0.75, HW + 0.25)]
            for (xa, xb) in spans:
                C.cyl_bm(bm, V((xa, y, z)), V((xb, y, z)), 0.12 + 0.02 * r.random(), 7)
        else:
            x = -HW if side == 'w' else HW
            C.cyl_bm(bm, V((x, -HD - 0.25, z + 0.12)), V((x, HD + 0.25, z + 0.12)), 0.12 + 0.02 * r.random(), 7)
for x in DOORS:                            # door frames: two posts + a log lintel each
    for s in (-1, 1):
        C.cyl_bm(bm, V((x + s * 0.7, -HD, 0.0)), V((x + s * 0.7, -HD, ZW)), 0.13, 7)
    C.cyl_bm(bm, V((x - 1.0, -HD - 0.05, ZW + 0.05)), V((x + 1.0, -HD - 0.05, ZW + 0.05)), 0.15, 7)
K.part(bm, 'palm_log', name='cribbing', mat_tint=LOG, grime=0.9, bisect=False, smooth=True)
# ---- roof: logs laid across, then the sand-and-earth mound over them
bm = bmesh.new()
for k in range(int(2 * HW / 0.42) + 1):
    x = -HW - 0.1 + k * 0.42
    C.cyl_bm(bm, V((x, -HD - 0.15, ZW + 0.12)), V((x, -HD + 0.6, ZW + 0.12)), 0.14, 5)   # the log ends under the eave (the rest is under the mound)
K.part(bm, 'palm_log', name='roof_logs', mat_tint=(0.66, 0.57, 0.46), grime=0.9, bisect=False)
bm = dz.mound_bm((0, 0.15, ZW + 0.2), HW + 0.3, HD + 0.2, 0.85, seed=SEED, rings=6, segs=24, slump=(0.0, 0.1))
K.part(bm, 'sand', name='earth_roof', mat_tint=(0.96, 0.88, 0.72), grime=0.6, bisect=False, smooth=True)
# ---- the two ways down: dark recess, two steps, sandbag cheeks out front
for x in DOORS:
    bm = bmesh.new()
    C.box_bm(bm, (x, -HD + 0.6, 0.62), (1.3, 1.2, 1.24))
    K.part(bm, 'interior_dark', name='way%d' % int(x + 10), mat_tint=(0.18, 0.16, 0.14), bisect=False)
    bm = bmesh.new()
    for k in range(2):
        C.box_bm(bm, (x, -HD - 0.15 + 0.35 * k, 0.03 - 0.12 * k), (1.2, 0.35, 0.1))
    K.part(bm, 'deck_planks', name='steps%d' % int(x + 10), mat_tint=(0.7, 0.62, 0.5), grime=1.0, bisect=False)
    for s in (-1, 1):
        dz.sandbags((x + s * 0.95, -HD - 0.3), (x + s * 0.95, -HD - 1.5), rows=4, name='cheek%d_%d' % (int(x + 10), s + 1), thick=1, footprint=False)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_dugout_b.py')).read())
