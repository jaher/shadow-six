"""Garrison firing range (M20 castle courtyard range; generic Schiessstand): earth stop-butt berm with a timber-revetted
face, six target stands (posts, cross rail, board with a head-and-shoulders Kopfscheibe and ring target), marker's
trench with plank revetment and duckboards, distance posts, roofed firing shed with sandbag rests and benches on the
firing line, range hut, red-flag mast, warning signs. Range runs north: firing line at y=-12, targets at y=+14.
Variants: a (frost), b (worn: fewer targets, shot-up boards, second seed), snow.
Usage: blender -b --factory-startup --python firing_range.py -- [a|b|snow] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 111)
K.begin('firing_range' + ('' if VAR == 'a' else '_' + VAR), SEED if VAR != 'b' else SEED + 7,
        theater='snow' if VAR == 'snow' else 'frost', snow=VAR == 'snow')
r = K.rng()
YT, YF = 14.0, -12.0                         # target line, firing line
BX = 11.0                                    # half length of the berm

# ------------------------------------------------------------------ stop-butt berm (3.4 m) with revetted face
M.berm([(-BX, YT + 3.2), (BX, YT + 3.2)], [(-BX, YT + 1.9), (BX, YT + 1.9)], 3.4, 'mud', 'berm_face', taper_end=0.12, rows=6, toe=0.0, undulate=0.04)
M.berm([(BX, YT + 4.2), (-BX, YT + 4.2)], [(BX + 1.5, YT + 10.0), (-BX - 1.5, YT + 10.0)], 3.4, 'sod', 'berm_back', taper_end=0.15, rows=7, step=0.8)
bm = bmesh.new()
K.box_bm(bm, (0, YT + 3.7, 3.3), (2 * BX * 0.8, 1.1, 0.14))
K.part(bm, 'sod', name='berm_top', grime=0.3, smooth=True)
bm = bmesh.new()                                                 # timber revetment on the face: posts + horizontal planks
for i in range(12):
    x = -BX * 0.84 + i * (2 * BX * 0.84) / 11
    K.beam_bm(bm, (x, YT + 1.85, -0.2), (x, YT + 3.05, 3.1), 0.16, 0.16)
K.part(bm, 'timber_tarred', name='revet_posts', uv='beam', axis=(0, 0, 1))
bm = bmesh.new()
for k in range(12):
    z = 0.1 + k * 0.25
    y = YT + 1.72 + z / 3.2 * 1.2
    K.box_bm(bm, (0, y, z), (2 * BX * 0.84, 0.05, 0.23))
K.part(bm, 'timber_siding', name='revet_planks', uv='beam', axis=(1, 0, 0))

# ------------------------------------------------------------------ marker's trench in front of the berm
bm = bmesh.new()
K.box_bm(bm, (0, YT + 1.0, 0.45), (2 * BX * 0.75, 0.12, 0.9))
for i in range(14):
    x = -BX * 0.72 + i * BX * 1.44 / 13
    K.box_bm(bm, (x, YT + 1.0, 0.5), (0.12, 0.22, 1.0))
K.part(bm, 'timber_grey', name='trench_wall', uv='beam', axis=(1, 0, 0))
bm = bmesh.new()
for i in range(28):
    x = -BX * 0.72 + i * BX * 1.44 / 27
    K.box_bm(bm, (x, YT + 1.45, 0.06), (0.22, 0.75, 0.04))
K.part(bm, 'deck_planks', name='duckboards', uv='beam', axis=(0, 1, 0), lod='drop')

# ------------------------------------------------------------------ target stands
NT = 6 if VAR != 'b' else 5
def dface(b, pts):
    b.faces.new([b.verts.new(p) for p in pts])
    b.faces.new([b.verts.new(p + V((0, -0.001, 0))) for p in reversed(pts)])
bm, bw, bk = bmesh.new(), bmesh.new(), bmesh.new()
for i in range(NT):
    x = -7.5 + i * 3.0
    if VAR == 'b' and i == 2:
        continue
    for s in (-1, 1):
        K.box_bm(bm, (x + s * 0.55, YT + 0.2, 1.1), (0.1, 0.1, 2.2))
    K.box_bm(bm, (x, YT + 0.2, 2.05), (1.3, 0.08, 0.1))
    K.box_bm(bm, (x, YT + 0.2, 0.9), (1.3, 0.08, 0.08))
    tilt = r.uniform(-0.04, 0.04)
    K.box_bm(bw, (x, YT + 0.13, 1.45), (1.0, 0.03, 1.1), tilt)
    fy = YT + 0.11
    if i % 2 == 0:                                              # Kopfscheibe silhouette (head + shoulders)
        sil = [(-0.42, 0.95), (0.42, 0.95), (0.4, 1.35), (0.2, 1.48), (0.14, 1.6), (0.12, 1.78), (0.0, 1.86), (-0.12, 1.78), (-0.14, 1.6), (-0.2, 1.48), (-0.4, 1.35)]
        dface(bk, [V((x + sx, fy, sz)) for sx, sz in sil])
    else:                                                       # ring target: concentric discs
        for k, rr in enumerate((0.42, 0.3, 0.18, 0.07)):
            if k % 2 == 0:
                ring_ = [V((x + math.cos(2 * math.pi * j / 20) * rr, fy - 0.002 * k, 1.45 + math.sin(2 * math.pi * j / 20) * rr)) for j in range(20)]
                dface(bk, ring_)
    K.anchor('target', (x, YT + 0.1, 1.45), (0, -1, 0), kind='range_target')
K.part(bm, 'timber_grey', name='target_frames', uv='beam', axis=(0, 0, 1))
K.part(bw, 'wood_paint', name='target_boards', mat_tint=(0.95, 0.92, 0.82), grime=0.3)
K.part(bk, 'cast_iron', name='target_prints', grime=0, bisect=False)
if VAR == 'b':
    for i in range(10):
        K.decal('crack', (r.uniform(-8, 8), YT + 0.1, r.uniform(1.0, 1.9)), (0, -1, 0), 0.4, 0.4, alpha=0.7)

# ------------------------------------------------------------------ numbered lane boards on the butt + in the marker pit
bm, bn = bmesh.new(), bmesh.new()
for i in range(6):
    x = -7.5 + i * 3.0
    K.box_bm(bm, (x, YT + 2.3, 3.0), (0.9, 0.06, 0.7))
    K.box_bm(bm, (x, YT + 2.36, 2.4), (0.1, 0.1, 1.2))
    M.digit(bn, str(i + 1), (x, YT + 2.26, 3.0), 0.5)
K.part(bm, 'wood_paint', name='lane_boards', mat_tint=(0.92, 0.9, 0.84), grime=0.4)
K.part(bn, 'cast_iron', name='lane_numbers', grime=0, bisect=False)
# ------------------------------------------------------------------ overhead safety baffle (Hochblende), rework 2: a massive
# earth-filled timber box (two plank walls 0.9 m apart, sod-capped fill, sandbag coping) on raking shores, with an
# overhead deflector panel canted DOWN towards the firing line on its own struts -> reads as a baffle, not a fence
YB, ZB0, ZB1 = 0.5, 2.3, 4.3
bm, bp, bs = bmesh.new(), bmesh.new(), bmesh.new()
for x in (-BX + 0.5, -BX / 2, 0.0, BX / 2, BX - 0.5):
    for dy in (-0.45, 0.45):
        K.beam_bm(bm, (x, YB + dy, -0.2), (x, YB + dy, ZB1 + 0.1), 0.22, 0.22)
    K.beam_bm(bm, (x, YB - 2.2, -0.1), (x, YB - 0.45, ZB0 + 0.4), 0.16, 0.16)                  # raking shores
    K.beam_bm(bm, (x, YB + 2.0, -0.1), (x, YB + 0.45, ZB0 + 0.4), 0.16, 0.16)
    K.beam_bm(bm, (x, YB - 0.45, ZB1 + 0.05), (x, YB - 2.9, ZB1 - 0.75), 0.14, 0.18)            # deflector rafters
    K.beam_bm(bm, (x, YB - 2.6, ZB1 - 0.7), (x, YB - 1.9, ZB0 + 0.1), 0.1, 0.1)
for dy in (-0.45, 0.45):
    K.beam_bm(bm, (-BX + 0.3, YB + dy, ZB0), (BX - 0.3, YB + dy, ZB0), 0.14, 0.24)
K.part(bm, 'timber_tarred', name='baffle_frame', uv='beam', axis=(0, 0, 1))
for dy in (-0.53, 0.53):                                        # plank walls (boards come from the siding texture)
    K.box_bm(bp, (0, YB + dy, (ZB0 + ZB1) / 2), (2 * BX - 1.0, 0.06, ZB1 - ZB0))
K.box_bm(bp, (0, YB - 1.72, ZB1 - 0.38), (2 * BX - 0.6, 2.55, 0.06))
for v in bp.verts:                                              # cant the deflector panel down towards the firing line
    if v.co.y < YB - 0.6:
        v.co.z += (v.co.y - (YB - 0.45)) * 0.28
K.part(bp, 'timber_siding', name='baffle_boards', uv='aligned', bisect=False, mat_tint=(0.8, 0.76, 0.7))
bm = bmesh.new()                                                 # earth fill + sod cap, sandbag coping on top
rows = []
for i in range(13):
    x = -BX + 0.55 + (2 * BX - 1.1) * i / 12
    hz = ZB1 + 0.25 + 0.12 * math.sin(i * 1.3)
    rows.append([bm.verts.new((x, YB - 0.5, ZB1)), bm.verts.new((x, YB, hz)), bm.verts.new((x, YB + 0.5, ZB1))])
for a_, b_ in zip(rows[:-1], rows[1:]):
    for k in range(2):
        bm.faces.new((a_[k], b_[k], b_[k + 1], a_[k + 1]))
for f in bm.faces:
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
K.part(bm, 'sod', name='baffle_fill', grime=0.3, smooth=True, bisect=False)
bags = bmesh.new()
for i in range(18):
    x = -BX + 1.0 + (2 * BX - 2.0) * i / 17
    M.bag_bm(bags, (x, YB + 0.38 * (1 if i % 2 else -1), ZB1 + 0.12), 0.0, 0.58, 0.31, 0.15, r)
M.sandbags_part(bags, 'baffle_bags')
# lane markers: white-topped posts with lane numbers + low earth FIRING MOUNDS (prone points at 100 / 200 m) per lane
bm, bw, bn = bmesh.new(), bmesh.new(), bmesh.new()
for i in range(7):
    x = -9.0 + i * 3.0
    for y in (YF + 7.0, YF + 17.5):
        K.box_bm(bm, (x, y, 0.55), (0.12, 0.12, 1.1))
        K.box_bm(bw, (x, y - 0.07, 1.0), (0.34, 0.03, 0.26))
M.digit(bn, '1', (-10.2, YF + 6.92, 1.0), 0.18)
M.digit(bn, '2', (-10.2, YF + 17.42, 1.0), 0.18)
K.part(bm, 'timber_grey', name='lane_posts', uv='beam', axis=(0, 0, 1), lod='drop')
K.part(bw, 'wood_paint', name='lane_markers', mat_tint=(0.95, 0.94, 0.9), grime=0.2, lod='drop')
K.part(bn, 'cast_iron', name='marker_digits', grime=0, bisect=False, lod='drop')
from mathutils import noise as NZ
bm, bd = bmesh.new(), bmesh.new()
for i in range(6):
    x = -7.5 + i * 3.0
    for y in (YF + 8.5, YF + 19.0):
        ring = []
        for k in range(12):
            a = 2 * math.pi * k / 12
            ring.append((x + math.cos(a) * 1.0, y + math.sin(a) * 1.5))
        top = [bm.verts.new((px * 0.55 + x * 0.45, py * 0.6 + y * 0.4, 0.32 + 0.03 * NZ.noise(V((px, py, 1.0))))) for px, py in ring]
        bot = [bm.verts.new((px, py, -0.03)) for px, py in ring]
        for k in range(12):
            bm.faces.new((bot[k], bot[(k + 1) % 12], top[(k + 1) % 12], top[k]))
        bm.faces.new(top)
        K.box_bm(bd, (x, y - 0.1, 0.35), (0.8, 1.6, 0.04), r.uniform(-0.1, 0.1))             # plank mat on the mound
for f in bm.faces:
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
M.planar_uv(K.part(bm, 'sod', name='firing_mounds', grime=0.3, smooth=True, bisect=False), 'sod')
K.part(bd, 'deck_planks', name='mound_mats', uv='beam', axis=(0, 1, 0), lod='drop')
bm, be = bmesh.new(), bmesh.new()                                 # gravel walks with timber edging, worn earth lane paths
for x in (-BX - 0.2, BX + 0.2):
    K.box_bm(bm, (x, (YF + YT) / 2 + 1.0, 0.02), (1.6, YT - YF, 0.04))
    for sx in (-1, 1):
        K.box_bm(be, (x + sx * 0.84, (YF + YT) / 2 + 1.0, 0.05), (0.08, YT - YF, 0.1))
K.part(bm, 'gravel', name='walks', mat_tint=(0.82, 0.8, 0.76), grime=0.2, bisect=False)
K.part(be, 'timber_tarred', name='walk_edging', uv='beam', axis=(0, 1, 0), bisect=False)
for x in (-BX - 0.2, BX + 0.2):
    for k in range(5):
        K.decal('dirt_splash', (x + r.uniform(-0.3, 0.3), YF + 3 + k * 5.2, 0.045), (0, 0, 1), 2.2, 2.6, up=(0, 1, 0), alpha=0.6)
for i in range(6):
    for k in range(4):
        K.decal('dirt_splash', (-7.5 + i * 3.0 + r.uniform(-0.2, 0.2), YF + 3.5 + k * 4.4, 0.02 + k * 0.001), (0, 0, 1), 0.9, 3.4, up=(0, 1, 0), alpha=0.5)
# mantlet: earth bank in front of the butts - the targets rise from the marker gallery behind it
M.berm([(-BX * 0.8, YT - 0.25), (BX * 0.8, YT - 0.25)], [(-BX * 0.8, YT - 2.6), (BX * 0.8, YT - 2.6)], 1.15, 'sod', 'mantlet', taper_end=0.1, rows=6, toe=0.3, undulate=0.08)
bm = bmesh.new()
K.box_bm(bm, (0, YT - 0.2, 0.55), (2 * BX * 0.8, 0.08, 1.1))
K.part(bm, 'timber_siding', name='mantlet_revet', uv='aligned', bisect=False, mat_tint=(0.75, 0.72, 0.66))
# ------------------------------------------------------------------ side traverses (earth banks) framing the range
M.berm([(-BX - 1.2, YF + 2.5), (-BX - 1.2, YT + 2.0)], [(-BX - 4.0, YF + 2.0), (-BX - 4.0, YT + 3.5)], 1.6, 'sod', 'traverse_w', taper_end=0.18, rows=6, step=0.9)
M.berm([(BX + 1.2, YT + 2.0), (BX + 1.2, YF + 2.5)], [(BX + 4.0, YT + 3.5), (BX + 4.0, YF + 2.0)], 1.6, 'sod', 'traverse_e', taper_end=0.18, rows=6, step=0.9)

# ------------------------------------------------------------------ distance posts
bm = bmesh.new()
for y in (YT - 8.0, YT - 17.0):
    for x in (-BX, BX):
        K.box_bm(bm, (x, y, 0.5), (0.14, 0.14, 1.0))
        K.box_bm(bm, (x, y - 0.08, 0.9), (0.5, 0.03, 0.3))
K.part(bm, 'wood_paint', name='distance_posts', mat_tint=(0.9, 0.88, 0.8), lod='drop')

# ------------------------------------------------------------------ firing shed over the firing line
SX = 9.5
bm = bmesh.new()
for x in (-SX, -SX / 2, 0.0, SX / 2, SX):
    K.box_bm(bm, (x, YF + 1.6, 1.4), (0.16, 0.16, 2.8))
    K.box_bm(bm, (x, YF - 1.4, 1.2), (0.16, 0.16, 2.4))
    K.beam_bm(bm, (x, YF + 1.9, 2.85), (x, YF - 1.8, 2.45), 0.1, 0.2)
for y, z in ((YF + 1.6, 2.72), (YF - 1.4, 2.35)):
    K.beam_bm(bm, (-SX - 0.3, y, z), (SX + 0.3, y, z), 0.14, 0.2)
for x in (-SX, -SX / 2, 0.0, SX / 2, SX):                          # knee braces post -> eave beams
    for y, z, dy in ((YF + 1.6, 2.72, 0), (YF - 1.4, 2.35, 0)):
        for sx in (-1, 1):
            if abs(x + sx * 0.6) > SX + 0.01:
                continue
            K.beam_bm(bm, (x, y, z - 0.75), (x + sx * 0.6, y, z - 0.08), 0.09, 0.09)
K.beam_bm(bm, (-SX, YF + 1.75, 1.05), (SX, YF + 1.75, 1.05), 0.1, 0.14)          # rest rail along the firing line
K.part(bm, 'timber_beam', name='shed_frame', uv='beam', axis=(0, 0, 1))
bm = bmesh.new()                                                   # fascia / barge boards: the roof reads as a real roof
K.beam_bm(bm, (-SX - 0.35, YF - 1.97, 2.42), (SX + 0.35, YF - 1.97, 2.42), 0.04, 0.24)
K.beam_bm(bm, (-SX - 0.35, YF + 2.17, 3.0), (SX + 0.35, YF + 2.17, 3.0), 0.04, 0.24)
for x in (-SX - 0.37, SX + 0.37):
    K.beam_bm(bm, (x, YF - 1.97, 2.47), (x, YF + 2.17, 3.05), 0.04, 0.24)
K.part(bm, 'wood_paint', name='shed_fascia', mat_tint=(0.42, 0.45, 0.38), uv='beam', axis=(1, 0, 0))
K.roof_shed(-SX, YF - 1.6, SX, YF + 1.8, 2.5, 2.95, 'tar_paper' if VAR != 'b' else 'corrugated_rust', low_side='-y', oh=0.35, name='shed_roof', gutters=False)
bm = bmesh.new()                                                  # felt battens (roll laps) + ridge capping: a roof, not a box
for k in range(12):
    x = -SX - 0.2 + k * (2 * SX + 0.4) / 11
    K.beam_bm(bm, (x, YF - 1.95, 2.49), (x, YF + 2.15, 3.0), 0.05, 0.05)
K.beam_bm(bm, (-SX - 0.35, YF + 2.1, 3.02), (SX + 0.35, YF + 2.1, 3.02), 0.3, 0.06)
K.part(bm, 'timber_tarred', name='roof_battens', uv='beam', axis=(0, 1, 0), bisect=False)
bm = bmesh.new()                                                  # back wall boards (behind the shooters)
K.box_bm(bm, (0, YF - 1.45, 0.75), (2 * SX, 0.04, 1.5))
K.part(bm, 'timber_siding', name='shed_back', uv='aligned', bisect=False)
bm = bmesh.new()                                                  # shooting benches (table + seat) per lane
bags = bmesh.new()
for i in range(6):
    x = -7.5 + i * 3.0
    K.box_bm(bm, (x, YF + 0.9, 0.78), (1.0, 0.7, 0.06))
    for sx in (-1, 1):
        for sy in (-1, 1):
            K.box_bm(bm, (x + sx * 0.42, YF + 0.9 + sy * 0.28, 0.38), (0.07, 0.07, 0.76))
    K.box_bm(bm, (x, YF - 0.1, 0.45), (0.9, 0.3, 0.05))
    K.box_bm(bm, (x, YF - 0.1, 0.22), (0.08, 0.2, 0.44))
    M.bag_bm(bags, (x, YF + 1.05, 0.81), 0.0, 0.5, 0.26, 0.13, r)
    M.bag_bm(bags, (x - 0.9, YF + 1.9, 0.0), 0.2, 0.58, 0.31, 0.15, r)
    K.anchor('firing_point', (x, YF, 0.0), (0, 1, 0), kind='firing_point', lane=i)
K.part(bm, 'timber_grey', name='benches', uv='beam', axis=(1, 0, 0))
M.sandbags_part(bags, 'rests')
bm = bmesh.new()                                                  # ammo boxes + rifle rack
for i in range(3):
    K.box_bm(bm, (-SX + 1.0 + i * 0.45, YF - 1.1, 0.12), (0.4, 0.22, 0.24))
K.part(bm, 'steel_painted', name='ammo', mat_tint=(0.6, 0.62, 0.5), bisect=False, lod='drop')

# ------------------------------------------------------------------ range hut, flag mast, signs
hp = [(12.5, -15.5), (16.5, -15.5), (16.5, -12.0), (12.5, -12.0)]
hd = K.opening(hp, 3, 1.6, 0.9, 2.0, 0.1, 0.2, 'rect', 'door')
hw = [K.opening(hp, 0, 2.0, 1.0, 0.9, 1.1, 0.2), K.opening(hp, 2, 2.0, 1.0, 0.9, 1.1, 0.2)]
K.wall_ring(hp, 2.5, 0.2, 'timber_siding', [hd] + hw, plinth=('concrete_bunker', 0.25, 0.03), name='hut')
for f in hw:
    K.window(f, 'casement', (1, 2), frame=(0.8, 0.78, 0.7), sill=None, lintel=None, shutters='open', shutter_color=(0.35, 0.4, 0.33), name='hwin')
K.door(hd, 'range_hut', 'plank', (0.35, 0.3, 0.24), step='concrete_bunker')
K.roof_gable(14.5, -13.75, 4.0, 3.5, 2.5, 35, 'roof_shingle', eave_oh=0.45, gable_oh=0.35, thick=0.08, gutters=True, fascia='wood_paint', barge='wood_paint')
K.chimney(15.6, -13.2, 2.9, 4.4, 0.22, 0.22, 'steel_painted', cap='steel_painted', pots=0)
bm = bmesh.new()                                                   # porch canopy on brackets over the hut door + step
K.box_bm(bm, (12.2, -13.9, 2.35), (0.9, 1.5, 0.06))
for yb in (-14.5, -13.3):
    K.beam_bm(bm, (12.5, yb, 1.75), (11.85, yb, 2.3), 0.07, 0.07)
K.part(bm, 'timber_beam', name='porch', uv='beam', axis=(0, 1, 0))
bm = bmesh.new()
K.cyl_bm(bm, (-13.5, YF + 2.5, 0.0), (-13.5, YF + 2.5, 8.0), 0.08, 8, r1=0.05)
K.cyl_bm(bm, (-13.5, YF + 2.5, 8.0), (-13.5, YF + 2.5, 8.1), 0.1, 8)
K.part(bm, 'wood_paint', name='flag_mast', mat_tint=(0.85, 0.84, 0.8), smooth=True)
K.anchor('flag', (-13.45, YF + 2.5, 7.6), (1, 0, 0), kind='flag_red', w=1.2, h=0.8)
bm = bmesh.new()                                                  # the red range flag itself (flying east in a breeze)
cols = []
for k in range(7):
    t = k / 6
    x = -13.45 + t * 1.3
    dy = 0.12 * math.sin(t * 5.0) * t
    cols.append([bm.verts.new((x, YF + 2.5 + dy, 7.95 - 0.04 * t)), bm.verts.new((x, YF + 2.5 + dy, 7.1 - 0.12 * t)),
                 bm.verts.new((x, YF + 2.5 + dy + 0.01, 7.95 - 0.04 * t)), bm.verts.new((x, YF + 2.5 + dy + 0.01, 7.1 - 0.12 * t))])
for a_, b_ in zip(cols[:-1], cols[1:]):
    bm.faces.new((a_[1], b_[1], b_[0], a_[0]))
    bm.faces.new((a_[2], b_[2], b_[3], a_[3]))
K.part(bm, 'canvas', name='flag_cloth', mat_tint=(0.75, 0.12, 0.1), grime=0.1, bisect=False)
K.sign((-13.5, YF + 2.35, 2.0), (0, -1, 0), 1.0, 'halt_sperrgebiet', 'timber_grey')
K.sign((BX + 0.5, YT - 4.0, 1.4), (0, -1, 0), 0.9, 'achtung_minen' if VAR == 'b' else 'halt_sperrgebiet', 'timber_grey')
bm = bmesh.new()
K.box_bm(bm, (BX + 0.5, YT - 3.9, 0.7), (0.1, 0.1, 1.4))
K.part(bm, 'timber_grey', name='sign_post')
for i in range(8):
    K.decal('dirt_splash', (r.uniform(-8, 8), r.uniform(YT - 2, YT + 1.5), 0.02), (0, 0, 1), 2.0, 1.5, up=(0, 1, 0), alpha=0.5)
    K.decal('streak_rain', (r.uniform(-BX * 0.8, BX * 0.8), YT + 1.68, 2.0), (0, -0.93, 0.35), 1.2, 1.6, alpha=0.4)

# ------------------------------------------------------------------ metadata
K.footprint([(-BX, YT + 1.8), (BX, YT + 1.8), (BX + 1, YT + 9), (-BX - 1, YT + 9)], 'HIGH', 'berm')
K.footprint([(-BX * 0.75, YT + 0.9), (BX * 0.75, YT + 0.9), (BX * 0.75, YT + 1.1), (-BX * 0.75, YT + 1.1)], 'LOW', 'trench_wall')
K.footprint([(-SX, YF - 1.5), (SX, YF - 1.5), (SX, YF - 1.35), (-SX, YF - 1.35)], 'HIGH', 'shed_back')
K.roof_meta([(-SX - 0.35, YF - 1.95), (SX + 0.35, YF - 1.95), (SX + 0.35, YF + 2.15), (-SX - 0.35, YF + 2.15)], 2.5, kind='shed')
K.A().meta['range'] = {'firing_line_z': -YF, 'target_line_z': -YT, 'silent_pistol_zone': True,
                       'zone': [K.g2(p) for p in ((-BX - 1, YF - 2), (BX + 1, YF - 2), (BX + 1, YT + 2), (-BX - 1, YT + 2))]}
if VAR == 'snow':
    K.snow_pass(thick=0.08, min_area=0.35, min_nz=0.6)
M.finalize(M.outdir(K.A().name), ao_res=2048, ao_samples=40, recenter=False)
