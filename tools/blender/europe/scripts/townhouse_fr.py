"""Compiegne Second-Empire town blocks (M15 "The End of the Butcher"; building-inventory `townhouse_corner_turret`,
`townhouse_stucco`). Cream limestone, channelled ground floor with period shop fronts (striped awnings, gilt lettering),
two dressed-stone upper floors with French windows and iron balconettes, slate mansard with stone lucarnes and a zinc
top, brick fire walls on the party sides, chimney stacks. Pivot = ground centre, front (game south) = Blender -Y.
 w      corner block W part 14 x 22 x 16: ground floor runs 2.2 m further S than the upper floors -> the y 4.5 terrace
        (mission walkway B) along the S front with an iron railing; "CAFE DE LA PAIX"; door D1 at x -3 on the S front
 flat   corner block E part 12 x 19.8, flat walkable roof at 12.5 behind a 0.8 m balustrade (mission roof R), iron
        balcony in front of the S face at 4.5 (walkway B continued), party wall W
 turret round corner turret r 2.2, 16 m, slate dome + lantern finial (stands on the walkway strip's E end)
 stucco townhouse 14 x 14 x 13 (cream render) with a shop front "... A LA CONSOMMATION", door D2 at x -3
Usage: blender -b --factory-startup --python townhouse_fr.py -- <outroot> <variant> <seed>"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fr_common import (no_streaks, K, V, C, bmesh, args, rect, mansard, lucarne, text3d, shopfront, compact, tag_lod, report_tris, SHUTTER, DOOR,
                       STONE, TRIM, CREAM, SLATE, use_cheap_windows, use_cheap_doors)
use_cheap_windows()
use_cheap_doors()
no_streaks()

ROOT, VAR, SEED = args()
NAME = {'w': 'townhouse_corner_w', 'flat': 'townhouse_corner_flat', 'turret': 'townhouse_corner_turret',
        'stucco': 'townhouse_fr_stucco'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
T = 0.45
Z1, Z2 = 4.5, 7.9                    # floor levels (terrace / balcony B = Z1)


def upper_windows(poly, edge, ts, z0, ze, french_first=False, balconette=(), shutters=0.0):
    """Two upper floors of windows on one edge; returns the frames (cut by the caller's wall_ring)."""
    out = []
    for t in ts:
        if french_first:
            out.append(K.opening(poly, edge, t, 1.2, 2.55, z0 + 0.1, T, 'segment', 'window'))
        else:
            out.append(K.opening(poly, edge, t, 1.15, 2.2, z0 + 0.75, T, 'segment', 'window'))
        if Z2 + 2.9 < ze:
            out.append(K.opening(poly, edge, t, 1.1, 2.05, Z2 + 0.7, T, 'segment', 'window'))
    for f in out:
        f._bal = (edge, round(f.o.z, 1)) in balconette
        f._shut = r.random() < shutters
    return out


def dress_windows(frames, prefix):
    for k, f in enumerate(frames):
        K.window(f, 'casement', (2, 4) if f.h > 2.4 else (2, 3), frame='white', recess=0.14, sill=TRIM, lintel=None,
                 surround=TRIM if f.n.y < -0.5 else None, shutters='open' if f._shut else None, shutter_color=SHUTTER['grey'], shutter_style='plank',
                 curtain=0.7, name='%s%d' % (prefix, k))
        if f._bal:                                        # cast-iron balconette on a stone sill slab
            K.railing(f.p(-f.w / 2 - 0.12, 0.02, 0.22), f.p(f.w / 2 + 0.12, 0.02, 0.22), 0.95, 'iron', name='%s_bal%d' % (prefix, k))
            K.P(TRIM, K.box_bm, tuple(f.p(0, -0.04, 0.12)), (f.w + 0.4, 0.3, 0.1), math.atan2(f.r.y, f.r.x), name='%s_bslab%d' % (prefix, k))


def facade_trim(poly, z_band, ze, corners=(0, 1, 2, 3)):
    K.course(poly, z_band, 0.24, 0.07, TRIM, name='band_%d' % int(z_band * 10))
    K.cornice(poly, ze - 0.5, TRIM, steps=((0.06, 0.12), (0.14, 0.12), (0.26, 0.16), (0.32, 0.1)), name='cornice_%d' % int(ze * 10))


def weather(x0, x1, y_front, ze):
    for i in range(3):
        K.decal('streak_rain', (r.uniform(x0 + 0.5, x1 - 0.5), y_front - 0.02, ze - r.uniform(0.8, 2.0)), (0, -1, 0), 0.5, 1.6, alpha=0.28)
    for i in range(4):
        K.decal('damp_base', (r.uniform(x0 + 0.5, x1 - 0.5), y_front - 0.02, 0.45), (0, -1, 0), 1.8, 0.8, alpha=0.6)


if VAR == 'w':
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'th_w.py')).read())
elif VAR == 'flat':
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'th_flat.py')).read())
elif VAR == 'turret':
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'th_turret.py')).read())
else:
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'th_stucco.py')).read())

report_tris()
tag_lod()
compact()
K.finalize(os.path.join(ROOT, NAME), ao_res=1024, ao_samples=48, lods=((0.4, 0.3, 4.0), (0.28, 1.0, 6.0)), recenter=False)
