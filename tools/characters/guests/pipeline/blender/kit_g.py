# kit_g.py - guest kit (bible §6): silk scarf, sheepskin jacket tied round the waist, RAF rank slides, blanket over the
# shoulders (M17 prisoners), drill-shirt pockets, torn sleeve/lapel patches. Called from kit_b.extra.
import bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo
import materials as MT
from uniform import lin, TORSO, UPPER, LOWER, THIGH
from shell import make_shell


def extra(K, ctx, spec, items):
    m, opts = ctx.m, spec.get('outfit_opts', {})
    chest = ctx.bone['spine_03'][0].z
    if 'drill_pockets' in items:   # two pleated breast pockets + buttons + shoulder straps on the drill shirt
        top = K.garments.get('outfit_tunic')
        K.tunic_details(top.data.materials[0], pleated=True, tabs=False, straps=True, buttons=True, lower_pockets=False,
                        btn_top=chest + 0.02)
    if 'rank_slides' in items:     # RAF blue-grey rank slides on the shoulder straps
        mat = MT.fabric('slides', lin((0.34, 0.39, 0.46)), kind='wool', dirt=0.1)
        bm = bmesh.new()
        for s in (1, -1):
            sh = ctx.bone['upperarm_' + ('l' if s > 0 else 'r')][0]
            p0 = Vector((s * (abs(sh.x) - 0.045), sh.y, sh.z + 0.2))
            hit, n = geo.project(K.torso_tree, p0, (0, 0, -1), far=0.4)
            if hit:
                geo.add_box(bm, (0.07, 0.042, 0.005), geo.M_at(hit + n * 0.005, geo.frame(n, (1, 0, 0))), bevel=0.001)
        K.finish(bm, 'kit_rank_slides', mat)
    if 'silk_scarf' in items:      # silk scarf round the neck, loose knot at the throat, ends tucked into the open collar
        col = lin(opts.get('scarf', (0.80, 0.74, 0.58)))
        mat = MT.fabric('silk', col, kind='canvas', rough=0.45, dirt=0.1, contrast=0.3)
        tree = geo.bvh_of([ctx.human])
        bm = bmesh.new()
        pts = []
        for k in range(22):
            th = math.radians(k * 360 / 21)
            z = m['neck_base_z'] + 0.012 + 0.012 * math.cos(th)
            q, _ = K.at_angle(z, math.degrees(th), tree=tree)
            pts.append(q)
        geo.ribbon(bm, tree, pts, 0.024, 0.006, 0.004, towards=K.inward, closed=True)
        p, n = K.at_angle(m['neck_base_z'] - 0.012, 0, tree=tree)
        n = Vector((n.x, n.y, 0)).normalized()
        geo.add_box(bm, (0.04, 0.03, 0.022), geo.M_at(p + n * 0.016, geo.frame(n)), bevel=0.004)   # knot
        for dx, dz in ((-0.012, -0.05), (0.014, -0.045)):   # tucked ends in the V
            q, nq = K.at_angle(m['neck_base_z'] - 0.02 + dz / 2, math.degrees(math.atan2(dx, 0.1)), tree=K.torso_tree)
            nq = Vector((nq.x, nq.y, 0)).normalized()
            geo.add_box(bm, (0.032, abs(dz) + 0.02, 0.004), geo.M_at(q + nq * 0.008, geo.frame(nq)), bevel=0.001)
        K.finish(bm, 'kit_scarf', mat, bone='spine_03')
    if 'sheepskin_waist' in items:  # Irvin-style sheepskin jacket tied round the waist: body hangs at the back, sleeves knot in front
        brown = MT.leather('sheepskin', lin(opts.get('sheepskin', (0.36, 0.24, 0.14))), rough=0.85)
        belt, crotch = m['belt_z'], m['crotch_z']

        def pred(c, d, idx):
            return (d in TORSO or d in THIGH) and crotch - 0.06 < c.z < belt + 0.03 and c.y > K.cy - 0.03

        def off(co, d):
            return 0.026 + 0.012 * max(0.0, min(1.0, (belt - co.z) / 0.25))
        o = make_shell(ctx, 'kit_sheepskin', pred, offset_fn=off, smooth=6, mat=brown, target_tris=500,
                       cuts=[((0, 0, crotch - 0.06), (0, 0, -1)), ((0, 0, belt + 0.03), (0, 0, 1))])
        K.objs.append(o)
        # sleeves round the waist to a knot at the front
        bm = bmesh.new()
        pts = []
        for k in range(15):
            deg = -100 + k * 200 / 14
            z = belt - 0.03 - 0.035 * math.cos(math.radians(deg * 0.9))
            q, _ = K.at_angle(z, deg, tree=K.tree)
            pts.append(q)
        geo.ribbon(bm, K.tree, pts, 0.075, 0.03, 0.03, towards=K.inward)
        p, n = K.at_angle(belt - 0.07, 0, tree=K.tree)
        geo.add_box(bm, (0.08, 0.06, 0.05), geo.M_at(p + n * 0.045, geo.frame(Vector((n.x, n.y, 0)).normalized())), bevel=0.01)
        K.finish(bm, 'kit_sheepskin_sleeves', brown, weights='body')
    if 'blanket' in items:          # grey-brown wool blanket over the shoulders, open at the front
        col = lin(opts.get('blanket', (0.36, 0.33, 0.29)))
        mat = MT.check_fabric('blanket', col, [lin(c) for c in opts.get('blanket_check', [[0.24, 0.22, 0.2], [0.5, 0.46, 0.4]])], pitch=opts.get('blanket_pitch', 0.045))
        low = m['belt_z'] + opts.get('blanket_drop', 0.02)
        front_open = opts.get('blanket_open', 0.10)

        def pred(c, d, idx):
            if d in TORSO:
                if c.z > m['neck_base_z'] - 0.005:
                    return False
                if c.y < K.cy - 0.02 and abs(c.x) < front_open + max(0.0, (m['neck_base_z'] - c.z)) * 0.25:
                    return False
                return c.z > low
            if d in UPPER:   # shoulder caps only: the blanket hangs outside the arms, not like sleeves
                sh = ctx.bone['upperarm_' + d[-1]][0]
                return (c - sh).length < 0.13 and abs(c.x) > abs(sh.x) - 0.01
            return False

        def off(co, d):
            return 0.024 if d not in ('neck_01',) else 0.02
        o = make_shell(ctx, 'kit_blanket', pred, offset_fn=off, smooth=8, mat=mat, target_tris=900, cuts=[((0, 0, low), (0, 0, -1)), ((0, 0, m['neck_base_z'] - 0.012), (0, 0, 1))])
        K.objs.append(o)
