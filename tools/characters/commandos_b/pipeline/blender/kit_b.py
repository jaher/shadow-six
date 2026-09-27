# kit_b.py - extra kit for the Sapper / Driver / Spy (commandos_b build group)
# tie, chest grenades (No.36-type ovoids on the braces), charge satchel, medic bag, goggles at the throat, SMG sling.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo
import materials as MT
from uniform import lin


def grenade(bm, M):
    """No.36-style ovoid grenade (segmented body, fly-off lever, ring) hanging from a strap; local z = out of body."""
    prof = [(0.0, 0.048)]
    for k in range(1, 6):
        z = 0.048 - k * 0.018
        r = 0.031 * math.sin(math.pi * k / 6) ** 0.8
        prof.append((r * (0.93 if k % 2 == 0 else 1.0), z))
    prof.append((0.0, -0.06))
    geo.add_lathe(bm, prof, M @ Matrix.Translation((0, -0.055, 0.03)) @ Matrix.Rotation(math.radians(-90), 4, 'X'), segs=8)
    geo.add_box(bm, (0.012, 0.07, 0.008), M @ Matrix.Translation((0.024, -0.05, 0.05)), bevel=0.002)   # lever
    geo.add_cyl(bm, 0.009, 0.009, 0.01, M @ Matrix.Translation((0, 0.0, 0.03)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=8)


def satchel(bm, M):
    geo.add_box(bm, (0.25, 0.20, 0.09), M @ Matrix.Translation((0, -0.12, 0.045)), bevel=0.018, segs=2)
    geo.add_box(bm, (0.255, 0.11, 0.096), M @ Matrix.Translation((0, -0.07, 0.049)), bevel=0.012, segs=2)   # flap
    for x in (-0.07, 0.07):   # buckle straps
        geo.add_box(bm, (0.022, 0.12, 0.1), M @ Matrix.Translation((x, -0.1, 0.05)), bevel=0.003)


def medic_bag(bm, M):
    geo.add_box(bm, (0.22, 0.17, 0.085), M @ Matrix.Translation((0, -0.1, 0.043)), bevel=0.02, segs=2)
    geo.add_box(bm, (0.225, 0.08, 0.09), M @ Matrix.Translation((0, -0.05, 0.046)), bevel=0.012, segs=2)


def red_cross(bm, M):
    for sz in ((0.07, 0.02), (0.02, 0.07)):
        geo.add_box(bm, (sz[0], sz[1], 0.003), M @ Matrix.Translation((0, -0.115, 0.0885)))


def extra(K, ctx, spec, items):
    m, opts = ctx.m, spec.get('outfit_opts', {})
    chest = ctx.bone['spine_03'][0].z
    if 'tie' in items:   # knitted tie down the shirt front, knot at the collar
        shirt = K.garments.get('outfit_shirt')
        tree = geo.bvh_of([shirt]) if shirt else K.torso_tree
        bm = bmesh.new()
        top = m['neck_base_z'] + 0.02
        bot = chest - 0.02
        geo.conform_patch(bm, tree, Vector((0, K.cy - 0.5, top - 0.012)), (0, 1, 0), (0, 0, 1), 0.03, 0.026, 0.004, 0.006, nu=2, nv=1)
        L = top - 0.025 - bot
        geo.conform_patch(bm, tree, Vector((0, K.cy - 0.5, bot + L / 2)), (0, 1, 0), (0, 0, 1), 0.042, L, 0.0025, 0.003, nu=2, nv=5,
                          shape=lambda u, v: (u * (0.003 - 0.03 * v), (-0.016 * (1 - 2 * abs(u)) if v < -0.49 else 0.0), 0))
        K.finish(bm, 'kit_tie', MT.fabric('tie', lin(opts.get('tie', (0.14, 0.10, 0.09))), kind='wool', rough=0.9, dirt=0.0), weights='body')
    if 'chest_grenades' in items:
        steel = MT.paint('grenade', lin((0.30, 0.33, 0.24)), rough=0.55)
        for deg, dz in ((-24, 0.03), (-38, -0.03), (24, 0.03), (38, -0.03)):
            p, n = K.at_angle(chest + dz, deg)
            n = Vector((n.x, n.y, 0)).normalized()
            bm = bmesh.new(); grenade(bm, geo.M_at(p + n * 0.004, geo.frame(n, (0, 0, 1))))
            K.finish(bm, f'kit_grenade_{deg}', steel, bone='spine_03')
    if 'satchel_l' in items:   # canvas charge satchel on the left hip + shoulder strap
        canvas = MT.fabric('satchel', lin(opts.get('satchel', (0.50, 0.45, 0.30))), kind='canvas', rough=0.95, dirt=0.3)
        K.hang('kit_satchel', 78, 0.07, satchel, canvas, out=0.01)
        bm = bmesh.new()
        sh_z = max(v.co.z for v in K.top.data.vertices if abs(v.co.x) < 0.2)
        pts = K._dense([Vector((-0.10, K.cy - 0.5, chest + 0.12)), Vector((-0.02, K.cy - 0.5, chest - 0.02)), Vector((0.10, K.cy - 0.5, m['belt_z'] + 0.02)),
                        Vector((0.17, K.cy - 0.3, m['belt_z'] - 0.03))])
        top = [Vector((-0.11, K.cy - 0.05, sh_z + 0.1)), Vector((-0.11, K.cy + 0.05, sh_z + 0.1))]
        back = K._dense([Vector((-0.08, K.cy + 0.5, chest + 0.08)), Vector((0.10, K.cy + 0.5, m['belt_z'] + 0.02)), Vector((0.17, K.cy + 0.3, m['belt_z'] - 0.03))])
        geo.ribbon(bm, K.torso_tree, list(reversed(pts)) + top + back, 0.04, 0.009, 0.004, towards=lambda p: K._to_core(p))
        K.finish(bm, 'kit_satchel_strap', canvas)
    if 'medic_bag' in items:
        white = MT.fabric('medic', lin((0.80, 0.78, 0.70)), kind='canvas', rough=0.95, dirt=0.35)
        K.hang('kit_medic', -118, 0.05, medic_bag, white, out=0.005)
        K.hang('kit_medic_cross', -118, 0.05, red_cross, MT.solid('redcross', lin((0.62, 0.08, 0.06)), rough=0.8), out=0.005)
    if 'sling_chest' in items:   # SMG sling: left shoulder -> right hip, over the chest
        bm = bmesh.new()
        sh_z = max(v.co.z for v in K.top.data.vertices if abs(v.co.x) < 0.2)
        front = [Vector((0.10, K.cy - 0.5, chest + 0.12)), Vector((0.0, K.cy - 0.5, chest - 0.03)), Vector((-0.12, K.cy - 0.5, m['belt_z'] + 0.05))]
        top = [Vector((0.11, K.cy - 0.05, sh_z + 0.1)), Vector((0.11, K.cy + 0.05, sh_z + 0.1))]
        back = [Vector((0.08, K.cy + 0.5, chest + 0.06)), Vector((-0.12, K.cy + 0.5, m['belt_z'] + 0.06))]
        geo.ribbon(bm, K.torso_tree, K._dense(list(reversed(front)) + top + back), 0.03, 0.008, 0.003, towards=lambda p: K._to_core(p))
        K.finish(bm, 'kit_sling', MT.fabric('sling', lin((0.45, 0.42, 0.28)), kind='canvas', rough=0.95))
    if 'goggles_neck' in items:   # driving goggles hanging at the throat (bible 1.5)
        bm = bmesh.new()
        p, n = K.at_angle(m['neck_base_z'] - 0.03, 0)
        n = Vector((n.x, n.y, 0)).normalized()
        R = geo.frame(n, (0, 0, 1))
        for s in (-1, 1):
            M = geo.M_at(p + n * 0.02 + Vector((s * 0.036, 0, 0)), R) @ Matrix.Rotation(math.radians(s * 12), 4, 'Y')
            geo.add_cyl(bm, 0.026, 0.022, 0.024, M, segs=12)
        geo.add_box(bm, (0.02, 0.008, 0.008), geo.M_at(p + n * 0.024, R))
        K.finish(bm, 'kit_goggles', MT.leather('goggles', lin((0.20, 0.13, 0.08)), rough=0.5), bone='spine_03')
        bm = bmesh.new()
        for s in (-1, 1):
            M = geo.M_at(p + n * 0.034 + Vector((s * 0.036, 0, 0)), R) @ Matrix.Rotation(math.radians(s * 12), 4, 'Y')
            geo.add_cyl(bm, 0.019, 0.019, 0.004, M, segs=12)
        K.finish(bm, 'kit_goggle_lens', MT.solid('goggle_glass', lin((0.10, 0.12, 0.12)), rough=0.08, metal=0.3), bone='spine_03')
        bm = bmesh.new()   # strap round the neck (collar level)
        pts = []
        for k in range(20):
            q, _ = K.at_angle(m['neck_base_z'] + 0.005, 30 + k * 300 / 19)
            pts.append(q)
        geo.ribbon(bm, K.torso_tree, pts, 0.018, 0.006, 0.003, towards=K.inward)
        K.finish(bm, 'kit_goggle_strap', MT.fabric('gstrap', lin((0.22, 0.2, 0.16)), kind='canvas'), bone='spine_03')
