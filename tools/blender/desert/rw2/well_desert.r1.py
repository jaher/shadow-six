"""Desert well (catalogue type `well`), rework 1.
a = village / oasis well: curb of individually laid, worn limestone blocks with rope-worn notches in the coping,
    block-built posts + palm beam with rope grooves + pulley, rope, leather bucket; apron of irregular flags dished to
    a stone drain channel, wet dark ground and algae where water spills, block-built troughs with water (not black),
    jars, an eroded mud windbreak (no roll cap) with sand drift.
b = military water point (1942, cf. Capuzzo): board-formed concrete well chamber with a steel hatch and a cast-iron
    hand pump, canvas water tank (panel seams, frame straps, sagging rim, lacing), standpipe manifold with four taps
    over drip trays, spilt-water puddles and wet sand, jerrycan rows on a stand, sandbag wall, sign.
Usage: blender -b --python well_desert.py -- outdir [a|b] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh
from mathutils import noise

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else {'a': 121, 'b': 123}[VAR]
K.begin('well_desert_' + VAR, SEED, theater='desert')
r = K.rng()
STONE = 'ashlar_limestone'


def wet(c, w, h, seed, name, tint=(0.62, 0.55, 0.47)):
    """Wet, darkened ground where water is spilt (sand-coloured mud patch, irregular edge)."""
    pts = dz._blob_outline(V((c[0], c[1], 0.0)), V((1, 0, 0)), V((0, 1, 0)), w, h, seed, 16, 0.4)
    dz.patch_quad(pts, 'mud', name, tint=tint, lift=c[2] if len(c) > 2 else 0.015)


def puddle(c, w, h, seed, name):
    pts = dz._blob_outline(V((c[0], c[1], 0.0)), V((1, 0, 0)), V((0, 1, 0)), w, h, seed, 14, 0.45)
    dz.patch_quad(pts, 'glass_dirty', name, tint=(0.42, 0.46, 0.42), lift=c[2] if len(c) > 2 else 0.02)


def block_ring(c, r0, r1, z0, z1, courses, mid=STONE, name='curb', tint=None, notch=()):
    """Octagonal curb built of individual stone blocks per course (joints staggered, slight jitter/wear)."""
    bm = dz.bmesh.new()
    cx, cy = c
    for k in range(courses):
        za, zb = z0 + (z1 - z0) * k / courses, z0 + (z1 - z0) * (k + 1) / courses
        nb = 10
        off = (k % 2) * 0.5
        for j in range(nb):
            a0, a1 = 2 * math.pi * (j + off) / nb + 0.015, 2 * math.pi * (j + 1 + off) / nb - 0.015
            jit = r.uniform(-0.015, 0.015)
            ro = r1 + jit
            pts = []
            for rr_, zz in ((r0, za), (ro, za), (ro, zb - 0.008), (r0, zb - 0.008)):
                pass
            q = lambda a, rad, z: V((cx + rad * math.cos(a), cy + rad * math.sin(a), z))
            dz.C.hexa_bm(bm, [q(a0, r0, za), q(a1, r0, za), q(a1, ro, za), q(a0, ro, za),
                              q(a0, r0, zb - 0.01), q(a1, r0, zb - 0.01), q(a1, ro - 0.01, zb - 0.01), q(a0, ro - 0.01, zb - 0.01)])
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, mat_tint=tint, grime=0.9)


def block_trough(p, L=2.0, w=0.6, h=0.55, rot=0.0, name='trough'):
    """Trough of four dressed blocks + base, worn rim, water surface, algae line and damp on the outside."""
    cx, cy = p[:2]
    c_, s_ = math.cos(rot), math.sin(rot)
    R = lambda x, y, z=0.0: V((cx + x * c_ - y * s_, cy + x * s_ + y * c_, z))
    bm = dz.bmesh.new()
    for (x0, x1, y0, y1, z1) in ((-L / 2, L / 2, -w / 2, -w / 2 + 0.11, h), (-L / 2, L / 2, w / 2 - 0.11, w / 2, h - 0.02),
                                 (-L / 2, -L / 2 + 0.12, -w / 2 + 0.11, w / 2 - 0.11, h - 0.01), (L / 2 - 0.12, L / 2, -w / 2 + 0.11, w / 2 - 0.11, h),
                                 (-L / 2, L / 2, -w / 2, w / 2, 0.14)):
        j = r.uniform(-0.01, 0.01)
        dz.C.hexa_bm(bm, [R(x0, y0, 0), R(x1, y0, 0), R(x1, y1, 0), R(x0, y1, 0), R(x0 + j, y0, z1), R(x1 - j, y0, z1 + j), R(x1, y1, z1), R(x0, y1, z1 - j)])
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STONE, name=name, grime=1.0, mat_tint=(0.95, 0.93, 0.88))
    bm = dz.bmesh.new()
    bm.faces.new([bm.verts.new(R(x, y, h - 0.12)) for x, y in ((-L / 2 + 0.12, -w / 2 + 0.11), (L / 2 - 0.12, -w / 2 + 0.11), (L / 2 - 0.12, w / 2 - 0.11), (-L / 2 + 0.12, w / 2 - 0.11))])
    K.part(bm, 'glass_dirty', name=name + '_water', grime=0, bisect=False, mat_tint=(0.5, 0.6, 0.55))
    K.decal('moss_patch', tuple(R(0, -w / 2 + 0.115, h - 0.14)), tuple(R(0, 1, 0) - R(0, 0, 0)), L - 0.3, 0.12, alpha=0.6)
    K.decal('damp_base', tuple(R(0, -w / 2 - 0.004, 0.25)), tuple(R(0, -1, 0) - R(0, 0, 0)), L, 0.5, alpha=0.5)
    wet(tuple(R(0, -w / 2 - 0.35)[:2]), L + 0.4, 0.9, int(cx * 7), name + '_wet')
    K.footprint([tuple(R(-L / 2, -w / 2))[:2], tuple(R(L / 2, -w / 2))[:2], tuple(R(L / 2, w / 2))[:2], tuple(R(-L / 2, w / 2))[:2]], 'LOW', 'trough')


if VAR == 'a':
    # apron of irregular flags dished toward the drain, low stone kerb round it, drain channel with stone edges
    ap = [(2.35 * math.cos(math.pi / 8 + k * math.pi / 4), 2.35 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    bm = dz.bmesh.new()
    C.loft_bm(bm, [[V((x, y, 0.1)) for x, y in ap], [V((x * 0.42, y * 0.42, 0.05)) for x, y in ap]], close_start=False, close_end=True)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'patio_flags', name='apron', grime=0.6, mat_tint=(0.95, 0.9, 0.82))
    block_ring((0, 0), 2.3, 2.52, -0.03, 0.14, 1, name='kerb', tint=(0.92, 0.88, 0.82))
    bm = dz.bmesh.new()
    for s_ in (-1, 1):
        for k in range(4):
            dz.chunk_bm(bm, (s_ * 0.24, -2.6 - 0.42 * k, 0.07), (0.16, 0.4, 0.14), (0, 0, r.uniform(-0.05, 0.05)), k, 0.15)
    K.part(bm, STONE, name='channel', mat_tint=(0.92, 0.88, 0.82))
    wet((0.0, -3.2, 0.012), 0.5, 2.0, 3, 'channel_wet', tint=(0.5, 0.45, 0.4))
    puddle((0.1, -4.5, 0.02), 1.3, 0.8, 5, 'drain_pool')
    wet((0.1, -4.5, 0.012), 2.4, 1.6, 6, 'drain_wet')
    # curb of laid blocks, coping with rope notches, lining + water far down
    block_ring((0, 0), 0.6, 0.9, 0.05, 0.8, 3, name='curb')
    block_ring((0, 0), 0.56, 0.98, 0.8, 0.92, 1, name='coping', tint=(1.0, 0.98, 0.95))
    inn = [(0.58 * math.cos(math.pi / 8 + k * math.pi / 4), 0.58 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    bm = dz.bmesh.new()
    KA.ring_bm(bm, inn, C.poly_offset(inn, -0.03), -0.05, 0.9)
    K.part(bm, STONE, name='lining', mat_tint=(0.4, 0.38, 0.35), grime=1.0)
    bm = dz.bmesh.new()
    C.prism_bm(bm, inn, -0.05, -0.04)
    K.part(bm, 'glass_dirty', name='well_water', grime=0, bisect=False, mat_tint=(0.2, 0.25, 0.23))
    for a in (0.1, math.pi + 0.1):         # rope-worn notches polished into the coping edge
        p = V((0.6 * math.cos(a), 0.6 * math.sin(a), 0.925))
        dz.patch_quad([p + V((-0.06, -0.06, 0)), p + V((0.06, -0.06, 0)), p + V((0.06, 0.06, 0)), p + V((-0.06, 0.06, 0))], 'palm_log', 'notch%d' % int(a * 10),
                      tint=(0.5, 0.42, 0.35), lift=0.002)
    # posts of stacked blocks, palm beam with rope grooves, pulley, rope, buckets
    bm = dz.bmesh.new()
    zt = 2.6
    for s_ in (-1, 1):
        for k in range(6):
            z0 = k * zt / 6
            dz.chunk_bm(bm, (s_ * 1.02 + r.uniform(-0.015, 0.015), r.uniform(-0.015, 0.015), z0 + zt / 12), (0.32, 0.32, zt / 6 - 0.012),
                        (0, 0, r.uniform(-0.04, 0.04)), k, 0.12)
    K.part(bm, STONE, name='posts', grime=1.0, mat_tint=(0.93, 0.9, 0.85))
    bm = dz.bmesh.new()
    C.cyl_bm(bm, (-1.35, 0, zt + 0.12), (1.35, 0, zt + 0.12), 0.12, 8)
    K.part(bm, 'palm_log', name='beam', uv='beam', axis=(1, 0, 0), grime=0.6)
    bm = dz.bmesh.new()
    for x in (-0.12, 0.14):
        C.cyl_bm(bm, (x - 0.035, 0, zt + 0.12), (x + 0.035, 0, zt + 0.12), 0.125, 8, caps=False)
    K.part(bm, 'palm_log', name='rope_grooves', mat_tint=(0.55, 0.45, 0.36), bisect=False)
    bm = dz.bmesh.new()
    C.cyl_bm(bm, (0, -0.05, zt - 0.12), (0, 0.05, zt - 0.12), 0.17, 12)
    C.box_bm(bm, (0, 0, zt - 0.02), (0.06, 0.14, 0.2))
    K.part(bm, 'timber_grey', name='pulley', smooth=True)
    bm = dz.rope((0.15, 0, zt - 0.12), (0.15, 0, 1.25), 0.0, 0.012, 2)
    dz.rope((-0.15, 0, zt - 0.12), (-1.3, 0.1, 1.0), 0.0, 0.012, 2, bm=bm)
    for k in range(5):                      # rope coil on the coping
        a0 = k * 0.9
        C.cyl_bm(bm, (-0.75 + 0.1 * math.cos(a0), 0.55 + 0.1 * math.sin(a0), 0.95 + 0.015 * k), (-0.75 + 0.1 * math.cos(a0 + 1.2), 0.55 + 0.1 * math.sin(a0 + 1.2), 0.95 + 0.015 * k), 0.015, 4, caps=False)
    K.part(bm, 'hessian', name='rope', grime=0, bisect=False)
    bm = dz.bmesh.new()
    C.cyl_bm(bm, (0.15, 0, 0.95), (0.15, 0, 1.25), 0.12, 10, r1=0.15)
    C.cyl_bm(bm, (0.55, -0.55, 0.92), (0.55, -0.55, 1.18), 0.13, 10, r1=0.16)
    K.part(bm, 'canvas', name='buckets', smooth=True, mat_tint=(0.5, 0.36, 0.24))
    C.footprint([(1.0 * math.cos(math.pi / 8 + k * math.pi / 4), 1.0 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)], 'LOW', 'well')
    for s_ in (-1, 1):
        K.footprint_rect(s_ * 1.02, 0, 0.34, 0.34, 0, 'HIGH', 'post')
    wet((0.0, -1.5, 0.105), 2.2, 1.2, 9, 'apron_wet', tint=(0.66, 0.6, 0.52))
    block_trough((1.9, -2.7), 2.0, 0.6, 0.55, 0.0, 'trough1')
    block_trough((-2.55, -1.2), 1.6, 0.55, 0.5, math.pi / 2, 'trough2')
    bm = dz.bmesh.new()
    for k, (x, y) in enumerate(((-1.6, 1.4), (-1.1, 1.75), (-1.95, 0.95))):
        c = V((x, y, 0.08))
        C.cyl_bm(bm, c, c + V((0, 0, 0.2)), 0.14, 10, r1=0.27)
        C.cyl_bm(bm, c + V((0, 0, 0.2)), c + V((0, 0, 0.62)), 0.27, 10, r1=0.11)
        C.cyl_bm(bm, c + V((0, 0, 0.62)), c + V((0, 0, 0.72)), 0.11, 10, r1=0.13)
    K.part(bm, 'roof_terracotta', name='jars', smooth=True, mat_tint=(1.0, 0.88, 0.76))
    wp = [(-3.6, 2.6), (3.6, 2.6), (3.6, 3.2), (-3.6, 3.2)]
    bm = dz.bmesh.new()                    # windbreak: dry-laid fieldstone wall with a hand-rounded mud capping
    rings = []
    for i in range(13):
        x = -3.6 + 7.2 * i / 12
        z1 = 1.15 + 0.08 * noise.noise(V((x * 1.1, SEED, 0.3)))
        rings.append([V((x, y, z)) for y, z in ((2.6, -0.05), (3.2, -0.05), (3.12, z1), (2.68, z1))])
    C.loft_bm(bm, rings)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'fieldstone', name='windbreak', mat_tint=(1.0, 0.93, 0.82))
    bm = dz.bmesh.new()
    dz.mud_wall_bm(bm, V((-3.6, 2.9, 0)), V((3.6, 2.9, 0)), 1.1, 0.3, 0.5, seed=SEED, erosion=0.5)
    K.part(bm, 'mud_render', name='windbreak_cap', mat_tint=(0.97, 0.95, 0.92), smooth=True)
    dz.mud_apron([(-3.6, 2.6), (3.6, 2.6), (3.6, 3.2), (-3.6, 3.2)], 0.35, 0.22, seed=SEED, name='wb_apron', skip=(1, 3))
    K.footprint(wp, 'LOW', 'wall')
    dz.sand_drift((3.4, 3.25), (-3.4, 3.25), (0, 1), 0.5, 1.4, seed=SEED)

else:
    # board-formed concrete chamber (chamfered top), steel hatch, cast-iron pump
    bm = dz.bmesh.new()
    C.box_bm(bm, (0, 0, 0.3), (1.8, 1.8, 0.6))
    C.box_bm(bm, (0, 0, 0.66), (1.8, 1.8, 0.12), taper=(0.93, 0.93))
    K.part(bm, 'concrete_board', name='chamber', mat_tint=(0.95, 0.93, 0.88))
    bm = dz.bmesh.new()
    C.prism_bm(bm, [(-2.6, -2.6), (2.6, -2.6), (2.6, 2.6), (-2.6, 2.6)], -0.05, 0.05)
    K.part(bm, 'concrete_bunker', name='pad', mat_tint=(0.93, 0.9, 0.84), grime=0.6)
    bm = dz.bmesh.new()
    C.box_bm(bm, (-0.35, 0.25, 0.735), (0.7, 0.7, 0.03))
    C.cyl_bm(bm, (-0.72, 0.0, 0.74), (-0.72, 0.5, 0.74), 0.025, 6)
    C.box_bm(bm, (-0.15, 0.25, 0.76), (0.12, 0.04, 0.03))
    K.part(bm, 'steel_galv', name='hatch', mat_tint=(0.7, 0.68, 0.62), bisect=False)
    K.footprint([(-0.95, -0.95), (0.95, -0.95), (0.95, 0.95), (-0.95, 0.95)], 'LOW', 'well')
    bm = dz.bmesh.new()
    px, py = 0.35, -0.3
    C.cyl_bm(bm, (px, py, 0.72), (px, py, 0.8), 0.18, 10)
    C.cyl_bm(bm, (px, py, 0.8), (px, py, 1.65), 0.085, 10, r1=0.07)
    for zz in (0.95, 1.3, 1.6):
        C.cyl_bm(bm, (px, py, zz), (px, py, zz + 0.04), 0.1, 10, caps=False)
    C.cyl_bm(bm, (px, py, 1.65), (px, py, 1.85), 0.1, 10, r1=0.06)
    C.cyl_bm(bm, (px, py - 0.05, 1.45), (px, py - 0.42, 1.28), 0.04, 6)
    C.cyl_bm(bm, (px, py - 0.42, 1.28), (px, py - 0.46, 1.18), 0.045, 6)
    C.beam_bm(bm, (px, py + 0.05, 1.83), (px, py + 0.95, 1.4), 0.04, 0.05)
    C.beam_bm(bm, (px, py + 0.08, 1.9), (px, py + 0.2, 1.8), 0.025, 0.08)
    K.part(bm, 'cast_iron', name='hand_pump', mat_tint=(0.4, 0.45, 0.4), bisect=False)
    wet((px, py - 0.5, 0.06), 0.8, 0.6, 2, 'pump_wet', tint=(0.5, 0.48, 0.44))
    # canvas tank on a timber frame: panel seams, straps, sagging laced rim
    cx, cy = 2.8, 1.2
    bm = dz.bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            C.beam_bm(bm, (cx + sx * 1.02, cy + sy * 1.02, 0), (cx + sx * 1.02, cy + sy * 1.02, 1.4), 0.1, 0.1)
    for z in (0.5, 1.35):
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            C.beam_bm(bm, (cx + a[0] * 1.02, cy + a[1] * 1.02, z), (cx + b[0] * 1.02, cy + b[1] * 1.02, z), 0.07, 0.07)
    K.part(bm, 'timber_beam', name='tank_frame', uv='beam', axis=(0, 0, 1), mat_tint=(0.85, 0.75, 0.6))
    bm = dz.bmesh.new()
    segs = 16
    rings = []
    for k, (rad, z) in enumerate(((0.9, 0.12), (0.98, 0.4), (1.0, 0.8), (0.97, 1.15), (0.93, 1.28))):
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            corner = abs(math.cos(2 * a))       # sag between the four frame posts
            zz = z - (0.0 if k < 4 else 0.1 * (1 - corner))
            ring.append(V((cx + rad * math.cos(a), cy + rad * math.sin(a), zz)))
        rings.append(ring)
    C.loft_bm(bm, rings, close_start=True, close_end=False)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'canvas', name='canvas_tank', mat_tint=(0.82, 0.74, 0.56), smooth=True)
    bm = dz.bmesh.new()
    for i in range(0, segs, 2):             # panel seams
        a = 2 * math.pi * i / segs
        pts = [V((cx + (rad + 0.012) * math.cos(a), cy + (rad + 0.012) * math.sin(a), z)) for rad, z in ((0.9, 0.12), (0.98, 0.4), (1.0, 0.8), (0.97, 1.15))]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            s_ = V((-math.sin(a), math.cos(a), 0)) * 0.02
            bm.faces.new([bm.verts.new(q) for q in (p0 - s_, p0 + s_, p1 + s_, p1 - s_)][::-1])
    for z, rad in ((0.55, 0.995), (1.0, 0.995)):      # straps
        C.cyl_bm(bm, (cx, cy, z - 0.03), (cx, cy, z + 0.03), rad + 0.012, segs, caps=False)
    K.part(bm, 'hessian', name='tank_seams', mat_tint=(0.6, 0.52, 0.38), bisect=False)
    bm = dz.bmesh.new()
    for i in range(segs):                   # rim lacing to the frame rail
        a = 2 * math.pi * (i + 0.5) / segs
        p = V((cx + 0.93 * math.cos(a), cy + 0.93 * math.sin(a), 1.25))
        q = V((cx + max(-1.02, min(1.02, 1.3 * math.cos(a))), cy + max(-1.02, min(1.02, 1.3 * math.sin(a))), 1.35))
        C.cyl_bm(bm, p, q, 0.007, 3, caps=False)
    K.part(bm, 'hessian', name='lacing', grime=0, bisect=False)
    bm = dz.bmesh.new()
    C.cyl_bm(bm, (cx, cy, 0.9), (cx, cy, 0.91), 0.9, segs)
    K.part(bm, 'glass_dirty', name='tank_water', grime=0, bisect=False, mat_tint=(0.45, 0.5, 0.45))
    K.footprint([(cx - 1.12, cy - 1.12), (cx + 1.12, cy - 1.12), (cx + 1.12, cy + 1.12), (cx - 1.12, cy + 1.12)], 'HIGH', 'tank')
    # standpipe manifold: outlet from the tank to a header on trestles, four taps over drip trays
    bm, bt = dz.bmesh.new(), dz.bmesh.new()
    C.cyl_bm(bm, (cx, cy - 0.95, 0.25), (cx, cy - 1.6, 0.25), 0.045, 8)
    C.cyl_bm(bm, (cx, cy - 1.6, 0.25), (cx, cy - 1.6, 0.8), 0.045, 8)
    C.cyl_bm(bm, (cx + 0.6, cy - 1.6, 0.8), (cx - 2.2, cy - 1.6, 0.8), 0.045, 8)
    for k in range(4):
        x = cx + 0.3 - k * 0.75
        C.cyl_bm(bm, (x, cy - 1.6, 0.78), (x, cy - 1.75, 0.66), 0.025, 6)
        C.cyl_bm(bm, (x - 0.06, cy - 1.62, 0.88), (x + 0.06, cy - 1.62, 0.88), 0.015, 4)
        C.cyl_bm(bm, (x, cy - 1.62, 0.8), (x, cy - 1.62, 0.9), 0.012, 4)
        C.box_bm(bt, (x, cy - 1.75, 0.08), (0.5, 0.4, 0.06))
        puddle((x + r.uniform(-0.2, 0.2), cy - 2.05, 0.02), r.uniform(0.6, 1.0), r.uniform(0.4, 0.7), k + 7, 'pud%d' % k)
    for x in (cx + 0.45, cx - 2.05):
        C.box_bm(bm, (x, cy - 1.6, 0.4), (0.08, 0.35, 0.8), taper=(1.0, 0.4))
    K.part(bm, 'steel_painted', name='manifold', mat_tint=(0.5, 0.52, 0.42), bisect=False)
    K.part(bt, 'steel_galv', name='drip_trays', mat_tint=(0.7, 0.68, 0.62), bisect=False)
    wet((cx - 0.8, cy - 2.1, 0.012), 4.0, 1.6, 11, 'manifold_wet', tint=(0.66, 0.58, 0.48))
    bm, bj = dz.bmesh.new(), dz.bmesh.new()      # jerrycan stand + cans
    C.box_bm(bm, (-2.6, 0.0, 0.3), (0.8, 3.2, 0.06))
    for y in (-1.5, 1.5):
        C.box_bm(bm, (-2.6, y, 0.15), (0.8, 0.08, 0.3))
    K.part(bm, 'timber_grey', name='can_stand', uv='beam', axis=(0, 1, 0))
    for k in range(12):
        dz.jerrycan(bj, (-2.6 + (0.18 if k % 2 else -0.18), -1.35 + (k // 2) * 0.5, 0.33), math.pi / 2)
    K.part(bj, 'steel_painted', name='jerrycans', mat_tint=(0.55, 0.58, 0.45))
    K.footprint([(-3.0, -1.6), (-2.2, -1.6), (-2.2, 1.6), (-3.0, 1.6)], 'LOW', 'stand')
    dz.sandbags((-3.6, 2.6), (3.9, 2.8), 4, name='sb_n', thick=1)
    K.sign((-1.4, -2.55, 1.0), (0, -1, 0), 0.7, 'wache', board='timber_grey')
    bm = dz.bmesh.new()
    C.cyl_bm(bm, (-1.4, -2.5, 0), (-1.4, -2.5, 1.3), 0.04, 6)
    K.part(bm, 'timber_beam', name='sign_post', uv='beam', axis=(0, 0, 1))
    for k in range(3):
        K.decal('stain_blotch', (r.uniform(-1.5, 1.5), r.uniform(-2.2, -1.2), 0.055 + 0.001 * k), (0, 0, 1), 1.0, 0.8, up=(0, 1, 0), alpha=0.45)
K.anchor('water', (0, 0, 0.9), (0, -1, 0), kind='well')
dz.finalize(OUT, ao_res=1024, ao_samples=48)
