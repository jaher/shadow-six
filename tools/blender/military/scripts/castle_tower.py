"""Castle corner tower (M20 octagonal castle kit): octagonal rubble-stone tower 8.4 m across, 16 m to the machicolated
crenellated parapet, battered talus with dressed torus, dressed quoins on every angle, arrow slits low and barred
lancet windows higher, courtyard door, flagged fighting platform, slender octagonal slate spire with lucarnes, finial
and vane. Courtyard (door) side = north (+Y); curtain walls attach on the W and E faces.
Variants: a (ground), moat (talus down into the moat), ruin (spire burnt away, upper shaft broken).
Usage: blender -b --factory-startup --python castle_tower.py -- [a|moat|ruin] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
import castle_lib as CL
K = M.K
import bmesh
from mathutils import Vector as V
import bpy

VAR, SEED = M.args('a', 93)
WATER = -3.6 if VAR == 'moat' else None
K.begin('castle_tower' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost', water_level=WATER)
r = K.rng()
R, H = 4.55, 16.0
ZB = -5.0 if VAR == 'moat' else 0.0
parts0 = len(K.A().parts)
CL.tower(0, 0, R, H, z_bot=ZB, door_n=(0, 1), roof=VAR != 'ruin', name='tower')
for i in range(10):
    a = r.uniform(math.pi * 1.05, math.pi * 1.95)
    n = V((math.cos(a), math.sin(a), 0))
    z = r.uniform(3, H - 2)
    K.decal(r.choice(['streak_long', 'streak_rain', 'lichen', 'moss_patch']), n * (R * 0.93 + 0.03) + V((0, 0, z)), n, 1.4, 2.0, alpha=0.5)
if VAR == 'moat':
    for a in (-2.4, -1.57, -0.7):
        n = V((math.cos(a), math.sin(a), 0))
        K.decal('waterline', n * ((R + 0.73) * 0.924 + 0.04) + V((0, 0, WATER + 0.3)), n, 3.2, 1.5, alpha=0.9)
        K.decal('moss_patch', n * ((R + 0.66) * 0.924 + 0.04) + V((0, 0, WATER + 0.65)), n, 3.0, 0.7, alpha=0.7)
    K.A().meta['review_water'] = {'level': WATER, 'bed': ZB, 'rects': [[-60, 2.05, 60, 16.0]]}
    K.A().meta['moat'] = {'water_level': WATER, 'bed': ZB, 'scarp_z': 2.05, 'axis': 'x'}
if VAR == 'ruin':                                         # hollow shell (2.2 m walls) so the break shows wall thickness
    shaft = [o for o in K.A().parts if o.name.startswith('tower_shaft')][0]
    c = bmesh.new()
    K.prism_bm(c, K.ccw(CL.octagon(0, 0, R - 2.2)), 2.6, H + 3.0)
    K.cut_object(shaft, c)
    for o in [o for o in K.A().parts if o.name.startswith('tower_floor')]:
        K.A().parts.remove(o)
        bpy.data.objects.remove(o)
    # stepped breach in the south (camera) face from the crown down to 5.5 m: the crown ring is cut with it
    M.notch_cut(0.6, -R - 3.0, -0.3, 5.6, H + 0.8, 1.1, 3.4, step=0.7, jag=0.35)
    K.bite((-2.4, 2.2, H + 0.9), 1.8, (1.2, 1.2, 1.1), seed=6)          # ragged crown on the far side too
    bm = bmesh.new()                                      # charred floor joists: stubs still in their sockets, some
    for a, dv in ((-2.45, (1.9, -0.9, -1.0)), (-2.8, (2.2, -0.4, -0.5)), (0.1, (-1.6, -1.0, -0.9)), (0.45, (-1.2, -0.5, -0.4)),
                  (2.6, (0.8, -0.6, -0.2))):
        p0 = V((math.cos(a) * (R - 2.0), math.sin(a) * (R - 2.0), 9.4))
        d = V(dv)
        K.beam_bm(bm, tuple(p0 - d.normalized() * 0.4), tuple(p0 + d), 0.26, 0.28, roll=0.2)
    K.beam_bm(bm, (0.2, -R + 0.3, 5.9), (1.6, -R - 2.2, 1.0), 0.26, 0.28, roll=0.4)   # fallen joist leaning on the scree
    K.part(bm, 'timber_tarred', name='joists', mat_tint=(0.55, 0.5, 0.45), grime=0.2)
    bm = bmesh.new()
    K.prism_bm(bm, K.ccw(CL.octagon(0, 0, R - 2.25)), 2.6, 2.75)
    K.part(bm, 'mud', name='debris_floor', mat_tint=(0.6, 0.58, 0.55))
    M.notch_debris(0.6, -R + 1.0, 5.65, 0.9, n=5, dress=CL.DRESS)
    M.rubble((1.2, -6.4, 0), 3.6, 1.9, mids=(CL.STONE, CL.DRESS), n=46, beams=2, tiles='roof_slate')
    M.rubble((-3.2, -5.4, 0), 1.8, 0.8, mids=(CL.DRESS, CL.STONE), n=14, beams=0, tiles=None, footprint=False)
    K.scorch_openings(1.0, 0.9)
    K.anchor('fire', (0, 0, H - 1), kind='smoulder')
else:
    K.roof_meta(CL.octagon(0, 0, R - 0.7), H + 0.02, walkable=True, kind='tower_platform')
    K.ladder_meta((0, R + 1.4), (0, R - 1.2), H)
K.anchor('guard', (0, -R + 1.0, H), (0, -1, 0), kind='tower_post')
K.anchor('wall_w', (-R * 0.92, 0, 9.0), (-1, 0, 0), kind='curtain_attach')
K.anchor('wall_e', (R * 0.92, 0, 9.0), (1, 0, 0), kind='curtain_attach')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
