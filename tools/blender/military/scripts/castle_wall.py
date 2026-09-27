"""Castle curtain wall segment (M20 octagonal castle kit): 16 m of rubble-stone wall, 2.6 m thick, 9 m high, battered
talus with a dressed torus, arrow slits, machicolated crenellated parapet with coping and merlon slits, flagged
wall-walk, two inner buttresses, putlog holes, moss / damp / streaks. Outer face = south (-Y).
Variants: a (on ground), stair (with a flight of steps up to the wall-walk), moat (talus runs down 5 m into a wet moat, waterline), ruin (breached: blast gap + rubble).
Usage: blender -b --factory-startup --python castle_wall.py -- [a|stair|moat|ruin] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
import castle_lib as CL
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 91)
WATER = -3.6 if VAR == 'moat' else None
K.begin('castle_wall' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost', water_level=WATER)
r = K.rng()
L, T, H = 16.0, 2.6, 9.0
ZB = -5.0 if VAR == 'moat' else 0.0
x0, x1, y0, y1 = -L / 2, L / 2, -T / 2, T / 2
bm = bmesh.new()
K.box_bm(bm, (0, 0, (ZB + H) / 2), (L, T, H - ZB))
wall = K.part(bm, CL.STONE, name='wall')
CL.talus((x0, y0), (x1, y0), (0, -1), ZB, 3.0, 1.3 if VAR != 'moat' else 1.9, 0.2, name='talus')
bm = bmesh.new()
CL.quad_block(bm, V((x0, y0, 0)), V((1, 0, 0)), V((0, -1, 0)), 0, L, -0.05, 0.14, 2.95, 3.2)
K.part(bm, CL.DRESS, name='torus')
loop_specs = [(u + r.uniform(-0.5, 0.5), z + r.uniform(-0.25, 0.25), 0.12, 1.3 + r.uniform(-0.15, 0.2))
              for u, z in ((2.1, 4.4), (5.9, 6.7), (7.4, 4.1), (11.2, 6.5), (13.6, 4.5))]
CL.loops(wall, (x0, y0), (x1, y0), (0, -1), loop_specs)
bm = bmesh.new()                                         # two shallow outer buttresses with stepped weatherings
for xb, wb in ((-5.6, 1.5), (3.1, 1.3)):
    for z0_, z1_, pj in ((ZB, 5.4, 0.55), (5.4, 7.2, 0.32)):
        K.hexa_bm(bm, [V((xb - wb / 2, y0 + 0.05, z0_)), V((xb + wb / 2, y0 + 0.05, z0_)), V((xb + wb / 2, y0 - pj, z0_)), V((xb - wb / 2, y0 - pj, z0_)),
                       V((xb - wb / 2, y0 + 0.05, z1_)), V((xb + wb / 2, y0 + 0.05, z1_)), V((xb + wb / 2, y0 - pj * 0.35, z1_ + 0.3)), V((xb - wb / 2, y0 - pj * 0.35, z1_ + 0.3))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, CL.STONE, name='outer_buttresses')

CL.crenellation((x0, y0), (x1, y0), (0, -1), H, ends=(False, False))
bm = bmesh.new()
K.box_bm(bm, (0, 0.25, H - 0.1), (L, T - 0.5, 0.24))
K.part(bm, 'cobblestone', name='walk', grime=0.4)
bm = bmesh.new()                                         # inner buttresses (courtyard side)
for x in (-4.5, 4.5):
    pts = [V((x - 0.7, y1, 0)), V((x + 0.7, y1, 0)), V((x + 0.7, y1 + 1.6, 0)), V((x - 0.7, y1 + 1.6, 0))]
    K.hexa_bm(bm, pts + [pts[0] + V((0, 0, H - 1.5)), pts[1] + V((0, 0, H - 1.5)), pts[2] + V((0, -1.3, 2.5)), pts[3] + V((0, -1.3, 2.5))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, CL.STONE, name='buttresses')
bm = bmesh.new()                                         # putlog holes: irregular rows, some filled, varied size
for s_, yy in ((-1, y0 - 0.01), (1, y1 + 0.01)):
    for z in (3.9, 6.1, 8.0):
        x = x0 + r.uniform(0.6, 2.2)
        while x < x1 - 0.6:
            zz = z + r.uniform(-0.12, 0.12)
            hw, hh = r.uniform(0.07, 0.12), r.uniform(0.14, 0.24)
            if r.random() > 0.3 and not (s_ < 0 and any(abs(x - xb) < 1.0 for xb in (-5.6, 3.1)) and zz < 7.4):
                q = [V((x - hw, yy, zz)), V((x + hw, yy, zz)), V((x + hw, yy, zz + hh)), V((x - hw, yy, zz + hh))]
                if s_ > 0:
                    q.reverse()
                bm.faces.new([bm.verts.new(p) for p in q])
            x += r.uniform(1.6, 3.6)
K.part(bm, 'interior_dark', name='putlogs', grime=0, bisect=False, lod='drop')
bm = bmesh.new()                                         # stone rain spouts through the breastwork
for x in ((-5.0, 5.0) if VAR == 'ruin' else (-5.0, 0.0, 5.0)):
    K.beam_bm(bm, (x, y0 + 0.4, H + 0.12), (x, y0 - 1.25, H - 0.05), 0.22, 0.18)
K.part(bm, CL.DRESS, name='spouts')
bm = bmesh.new()                                         # iron cressets on the courtyard face
for x in (-7.0, 7.0):
    K.beam_bm(bm, (x, y1, 6.0), (x, y1 + 0.5, 6.0), 0.05, 0.05)
    K.cyl_bm(bm, (x, y1 + 0.55, 5.95), (x, y1 + 0.55, 6.3), 0.06, 6, r1=0.16)
K.part(bm, 'cast_iron', name='cressets', lod='drop')
K.anchor('light', (-7.0, y1 + 0.55, 6.3), (0, 1, 0), kind='cresset')
if VAR == 'stair':                                       # stair head on the wall-walk (seen from outside) + flight down the courtyard face
    bm = bmesh.new()
    K.box_bm(bm, (x1 - 1.5, 0.35, H + 1.2), (2.2, 2.2, 2.6))
    body_sh = K.part(bm, CL.STONE, name='stairhead')
    dfr = K.Frame((x1 - 2.61, 0.35, H), (-1, 0, 0), (0, -1, 0), 0.9, 1.9, 0.5, 'pointed', 'door')
    K.cut_object(body_sh, CL._frame_cutter(dfr))
    bm = bmesh.new()
    K.box_bm(bm, (x1 - 1.9, 0.35, H + 0.95), (0.02, 0.9, 1.9))
    K.part(bm, 'interior_dark', name='stairhead_dark', grime=0, bisect=False)
    K.voussoirs(dfr, CL.DRESS, depth=0.3, name='stairhead_vous')
    K.roof_hip(x1 - 1.5, 0.35, 2.5, 2.5, H + 2.5, 45, 'roof_slate', eave_oh=0.15, thick=0.1, fascia=None, gutters=False)
    K.quoins([(x1 - 2.6, -0.75), (x1 - 0.4, -0.75), (x1 - 0.4, 1.45), (x1 - 2.6, 1.45)], H, H + 2.5, CL.DRESS)
    top = K.stairs((x1 - 0.6, y1 + 0.67, 0), (-1, 0, 0), 1.3, H, 44, CL.DRESS, name='wall_stair')
    bm = bmesh.new()
    pts = [V((x1 - 0.6, y1 + 1.35, 0)), V((x1 - 0.6 - 44 * 0.28, y1 + 1.35, 0))]
    K.hexa_bm(bm, [pts[0], pts[1], pts[1] + V((0, 0.3, 0)), pts[0] + V((0, 0.3, 0)),
                   pts[0] + V((0, 0, 0.9)), pts[1] + V((0, 0, H + 0.9)), pts[1] + V((0, 0.3, H + 0.9)), pts[0] + V((0, 0.3, 0.9))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, CL.STONE, name='stair_parapet')
for i in range(8):
    x = r.uniform(x0 + 1, x1 - 1)
    K.decal(r.choice(['streak_long', 'streak_rain', 'lichen']), (x, y0 - 0.45 - 0.01, H - 1.5), (0, -1, 0), r.uniform(1, 2), 2.5, alpha=0.5)
    K.decal(r.choice(['moss_patch', 'damp_base']), (r.uniform(x0 + 1, x1 - 1), y1 + 0.01, 0.6), (0, 1, 0), 2.0, 1.2, alpha=0.6)
if VAR == 'moat':
    for i in range(3):
        K.decal('waterline', (x0 + 3 + i * 5, y0 - 1.6, WATER + 0.3), (0, -0.96, 0.28), 5.2, 1.5, alpha=0.9)
        K.decal('moss_patch', (x0 + 3 + i * 5, y0 - 1.46, WATER + 0.65), (0, -0.96, 0.28), 4.6, 0.7, alpha=0.7)
    K.A().meta['review_water'] = {'level': WATER, 'bed': ZB, 'rects': [[-60, -y0 + 0.75, 60, 14.0]]}
    K.A().meta['moat'] = {'water_level': WATER, 'bed': ZB, 'scarp_z': round(-y0 + 0.75, 2), 'axis': 'x'}
if VAR == 'ruin':
    # stepped breach through the full thickness: 2.4 m wide at the rubble line, ~7 m at the wall-walk; nothing is left
    # spanning the gap (crenellation, walk, spouts all cut), the break follows the courses
    M.notch_cut(1.5, y0 - 4.0, y1 + 3.0, 1.1, H + 1.0, 1.2, 3.6, step=0.6, jag=0.3)
    M.notch_debris(1.5, 0.0, 1.15, 1.0, n=6, dress=CL.DRESS)
    M.rubble((1.5, 0.0, 0.2), 3.0, 1.9, mids=(CL.STONE, CL.DRESS), n=26, beams=0, tiles=None, footprint=False)
    M.rubble((1.2, -3.4, 0), 3.6, 1.8, mids=(CL.STONE, CL.DRESS), n=40, beams=1, tiles=None)
    M.rubble((1.8, 3.4, 0), 2.7, 1.2, mids=(CL.DRESS, CL.STONE), n=24, beams=0, tiles=None)
    for dx in (-1.6, 1.8):
        K.decal('dirt_splash', (1.5 + dx, y0 - 1.5, 0.03), (0, 0, 1), 3.5, 2.5, up=(0, 1, 0), alpha=0.6)
    K.A().meta['notes'].append('breach: walkable gap between x=-1..4 over the rubble (LOW footprints)')
K.footprint([(x0, y0 - (1.0 if VAR != 'moat' else 1.6)), (x1, y0 - (1.0 if VAR != 'moat' else 1.6)), (x1, y1), (x0, y1)], 'HIGH', 'curtain_wall')
K.roof_meta([(x0, y0 + 0.1), (x1, y0 + 0.1), (x1, y1), (x0, y1)], H + 0.02, walkable=VAR != 'ruin', kind='wall_walk')
K.anchor('walk_w', (x0, 0.3, H), (-1, 0, 0), kind='wall_walk_end')
K.anchor('walk_e', (x1, 0.3, H), (1, 0, 0), kind='wall_walk_end')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
