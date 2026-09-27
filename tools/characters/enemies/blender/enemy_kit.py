# enemy_kit.py - German enemy kit beyond pipeline/blender/kit.py (bible §5.3-5.5). No swastikas, eagles, runes or skulls:
# insignia are plain braid, plain collar tabs, plain boards. Items (spec['kit']):
#  holster_l / holster_l_brown, belt_brown, coat_belt / coat_belt_brown, map_case, binoculars, tresse (NCO braid),
#  mp_pouches, mg_tool_pouch, barrel_case, satchel_charge, work_gloves, headphones, ystraps_web, tabs_general, boards_silver
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo, kit, shell
import materials as MT
from uniform import lin

EXTRA = {'holster_l', 'holster_l_brown', 'belt_brown', 'coat_belt', 'coat_belt_brown', 'map_case', 'binoculars', 'tresse', 'mp_pouches',
         'mg_tool_pouch', 'barrel_case', 'satchel_charge', 'work_gloves', 'headphones', 'ystraps_web', 'tabs_general', 'boards_silver'}
HANDS = ('hand_', 'thumb', 'index', 'middle', 'ring', 'pinky')


def sweep(bm, pts, hw, ht, side=Vector((0, 1, 0))):
    """rectangular tube along a polyline (headphone band): width 2*hw along `side`, thickness 2*ht"""
    rings = []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        a2 = t.cross(side).normalized()
        rings.append([bm.verts.new(p + side * sx * hw + a2 * sy * ht) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(4):
            bm.faces.new((r0[i], r0[(i + 1) % 4], r1[(i + 1) % 4], r1[i]))
    for r in (rings[0], rings[-1][::-1]):
        bm.faces.new(r)


def mp_pouch(bm, M):
    for i in (-1, 0, 1):
        geo.add_box(bm, (0.032, 0.21, 0.034), M @ Matrix.Translation((i * 0.034, -0.085, 0.018)), bevel=0.004)
    geo.add_box(bm, (0.105, 0.05, 0.038), M @ Matrix.Translation((0, 0.0, 0.02)), bevel=0.004)


def map_case(bm, M):
    geo.add_box(bm, (0.2, 0.25, 0.025), M @ Matrix.Translation((0, -0.15, 0.015)), bevel=0.006)
    geo.add_box(bm, (0.2, 0.08, 0.028), M @ Matrix.Translation((0, -0.06, 0.017)), bevel=0.004)


def tool_pouch(bm, M):
    geo.add_box(bm, (0.12, 0.08, 0.045), M @ Matrix.Translation((0, -0.045, 0.024)), bevel=0.008)


def satchel(bm, M):
    geo.add_box(bm, (0.22, 0.15, 0.085), M @ Matrix.Translation((0, -0.12, 0.045)), bevel=0.012, segs=2)
    geo.add_box(bm, (0.23, 0.06, 0.09), M @ Matrix.Translation((0, -0.06, 0.047)), bevel=0.008)
    geo.add_box(bm, (0.05, 0.075, 0.007), M @ Matrix.Translation((0, -0.012, 0.0035)), bevel=0.002)   # belt loop tab (satchel hangs from the belt)
    geo.add_box(bm, (0.09, 0.02, 0.012), M @ Matrix.Translation((0, -0.028, 0.012)), bevel=0.004)   # grab handle on the flap top


def build_extra(ctx, garments, spec):
    items = set(spec.get('kit', [])) & EXTRA
    if spec['outfit'] == 'officer_heer':
        items.add('tie')
    if not items:
        return []
    K = kit.Kit(ctx, garments)
    m = ctx.m
    black = kit.mat('black_leather', lambda: MT.leather('kit_leather', lin((0.045, 0.04, 0.035)), rough=0.4))
    brown = kit.mat('brown_leather', lambda: MT.leather('kit_brown', lin((0.26, 0.14, 0.07)), rough=0.35))
    web = kit.mat('webbing', lambda: MT.fabric('kit_webbing', lin((0.50, 0.46, 0.31)), kind='canvas', rough=0.95))
    steel = kit.mat('fg_steel', lambda: MT.paint('kit_steel', lin((0.33, 0.35, 0.30)), rough=0.6))
    silver = kit.mat('silver', lambda: MT.metal('kit_silver', lin((0.70, 0.70, 0.66)), rough=0.35, metal=0.6))
    braid = kit.mat('tresse', lambda: MT.fabric('tresse', lin((0.66, 0.67, 0.62)), kind='canvas', rough=0.5, dirt=0.0, contrast=1.2))
    canvas = kit.mat('canvas_fg', lambda: MT.fabric('kit_canvas', lin((0.40, 0.40, 0.32)), kind='canvas'))
    chest = ctx.bone['spine_03'][0].z
    if 'belt_brown' in items:
        K.belt(brown, buckle_mat=silver, buckle=(0.05, 0.05))
    if 'coat_belt' in items:
        K.belt(black, buckle_mat=steel)
    if 'coat_belt_brown' in items:
        K.belt(brown, buckle_mat=silver, buckle=(0.05, 0.05), width=0.05)
    if 'ystraps_web' in items:
        K.ystraps(web)
    if 'holster_l' in items:
        K.hang('kit_holster_l', 58, 0.0, kit.holster, black)
    if 'holster_l_brown' in items:
        K.hang('kit_holster_l', 58, 0.0, kit.holster, brown)
    if 'mp_pouches' in items:
        for s in (1, -1):
            K.hang('kit_mppouch_' + ('l' if s > 0 else 'r'), s * 30, 0.0, mp_pouch, web)
    if 'map_case' in items:
        K.hang('kit_mapcase', -100, 0.05, map_case, black)
    if 'mg_tool_pouch' in items:
        K.hang('kit_mgpouch', 22, 0.0, tool_pouch, black)
    if 'satchel_charge' in items:
        K.hang('kit_satchel', -95, 0.03, satchel, canvas, out=0.0)
        # carrying strap from the left shoulder across the chest to the satchel on the right hip
        sh_z = max(v.co.z for v in K.top.data.vertices if abs(v.co.x) < 0.2)
        pts = K._dense([Vector((-0.17, K.cy - 0.5, m['belt_z'] - 0.01)), Vector((-0.06, K.cy - 0.5, chest - 0.04)),
                        Vector((0.07, K.cy - 0.5, chest + 0.12)), Vector((0.1, K.cy, sh_z + 0.1)), Vector((0.08, K.cy + 0.5, chest + 0.1)),
                        Vector((-0.05, K.cy + 0.5, chest - 0.1)), Vector((-0.17, K.cy + 0.5, m['belt_z'] + 0.02))])
        bm = bmesh.new()
        geo.ribbon(bm, K.torso_tree, pts, 0.03, 0.009, 0.004, towards=lambda p: K._to_core(p))
        K.finish(bm, 'kit_satchel_strap', web)
    if 'binoculars' in items:
        p, n = K.at_angle(chest - 0.06, 0)
        R = geo.frame(Vector((n.x, n.y, 0)).normalized(), (0, 0, 1))
        M = geo.M_at(p + n * 0.035, R)
        bm = bmesh.new()
        for s in (-1, 1):
            geo.add_cyl(bm, 0.022, 0.024, 0.11, M @ Matrix.Translation((s * 0.03, -0.01, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=10)
        geo.add_box(bm, (0.035, 0.05, 0.02), M @ Matrix.Translation((0, 0.02, 0)))
        K.finish(bm, 'kit_binoculars', black, bone='spine_03')
        # neck strap
        nk = ctx.bone['neck_01'][0]
        pts = [p + n * 0.03 + Vector((0.035, 0, 0.05)), Vector((0.06, nk.y - 0.03, m['neck_base_z'] - 0.02)), Vector((0.065, nk.y + 0.04, m['neck_base_z'] + 0.0)),
               Vector((0.0, nk.y + 0.07, m['neck_base_z'] - 0.02)), Vector((-0.065, nk.y + 0.04, m['neck_base_z'] + 0.0)),
               Vector((-0.06, nk.y - 0.03, m['neck_base_z'] - 0.02)), p + n * 0.03 + Vector((-0.035, 0, 0.05))]
        bm = bmesh.new()
        geo.ribbon(bm, K.torso_tree, K._dense(pts, 0.03), 0.012, 0.006, 0.003, towards=lambda q: Vector((0, nk.y, q.z)) - q)
        K.finish(bm, 'kit_binostrap', black)
    if 'tresse' in items or 'tabs_general' in items:
        # NCO braid (Tresse) along the collar edge / general's plain silver-grey collar tabs (no runes)
        z = m['neck_base_z'] + 0.03
        bm = bmesh.new()
        if 'tresse' in items:
            pts = []
            for k in range(-9, 10):
                q, nn = K.at_angle(z, k * 12)
                pts.append(q + nn * 0.01)
            geo.ribbon(bm, K.torso_tree, pts, 0.011, 0.006, 0.002, towards=lambda q: Vector((0, K.cy, q.z)) - q)
        else:
            for s in (1, -1):
                c = Vector((s * 0.05, K.cy - 0.5, z - 0.012))
                geo.conform_patch(bm, K.torso_tree, c, (-s * 0.5, 1, 0), (0, 0, 1), 0.055, 0.04, 0.004, 0.003, nu=2, nv=2)
        K.finish(bm, 'kit_tresse', braid)
    if 'boards_silver' in items:
        bm = bmesh.new()
        for s in (1, -1):
            sh = ctx.bone['upperarm_' + ('l' if s > 0 else 'r')][0]
            nk = ctx.bone['neck_01'][0]
            c = (sh * 0.62 + nk * 0.38); c = Vector((c.x, c.y, c.z + 0.25))
            geo.conform_patch(bm, K.torso_tree, c, (0, 0, -1), (s, 0, 0), 0.055, 0.12, 0.005, 0.006, nu=2, nv=3)
        K.finish(bm, 'kit_boards', silver)
    if 'barrel_case' in items:
        p, n = K.at_angle(chest - 0.08, 180)
        R = geo.frame(Vector((n.x, n.y, 0)).normalized(), (0, 0, 1))
        M = geo.M_at(p + n * 0.05, R) @ Matrix.Rotation(math.radians(38), 4, 'Z')
        bm = bmesh.new()
        geo.add_cyl(bm, 0.036, 0.036, 0.64, M @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=10)
        for t in (-0.3, 0.3):
            geo.add_cyl(bm, 0.039, 0.039, 0.03, M @ Matrix.Translation((0, t, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=10)
        K.finish(bm, 'kit_barrelcase', steel, bone='spine_03')
    if 'headphones' in items and not spec.get('headgear'):   # with a cap they are built on the cap (enemy_headgear)
        bm = bmesh.new()
        ez = (m.get('ear_top_z', m['eye_top_z']) + m.get('ear_bot_z', m['eye_top_z'] - 0.06)) / 2
        ex = m.get('ear_x', 0.075) + 0.014
        ey = m.get('ear_y', m['skull_center'][1])
        top = m['crown_z'] + 0.034
        for s in (1, -1):
            geo.add_cyl(bm, 0.036, 0.034, 0.026, geo.M_at(Vector((s * ex, ey, ez))) @ Matrix.Rotation(math.radians(90 * s), 4, 'Y'), segs=12)
        arc = [Vector((math.sin(a) * (ex - 0.004), ey, ez + 0.03 + (top - ez - 0.03) * math.cos(a))) for a in [math.radians(d) for d in range(-90, 91, 6)]]
        sweep(bm, arc, 0.009, 0.0025)
        o = geo.obj_from_bm('kit_headphones', bm, black)
        geo.rigid_weights(o, 'head', ctx.rig)
        K.objs.append(o)
    if 'work_gloves' in items:
        gl = kit.mat('glove', lambda: MT.leather('kit_gloves', lin((0.30, 0.22, 0.14)), rough=0.6))
        g = shell.make_shell(ctx, 'kit_gloves', lambda c, d, idx: d.startswith(HANDS) or (d.startswith('lowerarm') and (c - ctx.bone['hand_' + d[-1]][0]).length < 0.06),
                             offset=0.0035, smooth=2, mat=gl, target_tris=520, min_off=0.002, cover=False)
        K.objs.append(g)
    if 'tie' in items:   # officer's tie in the open collar (shirt is its own garment)
        sh = [g for g in garments if g.name.startswith('outfit_shirt')]
        if sh:
            st = geo.bvh_of(sh)
            zt, zb = m['neck_base_z'] + 0.01, chest - 0.03
            bm = bmesh.new()
            geo.conform_patch(bm, st, Vector((0, K.cy - 0.5, (zt + zb) / 2)), (0, 1, 0), (0, 0, 1), 0.03, zt - zb, 0.004, 0.003, nu=2, nv=4,
                              shape=lambda u, v: ((-0.012 if v > 0.3 else 0.004) * u, 0, 0))
            K.finish(bm, 'kit_tie', kit.mat('tie', lambda: MT.fabric('tie', lin((0.30, 0.31, 0.27)), kind='wool', dirt=0.0)))
    log('enemy kit: ' + ', '.join(f'{o.name}:{tri_count(o)}' for o in K.objs))
    return K.objs


def coat_details(ctx, garments, spec, collar_col=(0.14, 0.20, 0.15)):
    """greatcoat: dark-green fold-down collar, double-breasted buttons, slanted hip-pocket flaps, plain shoulder straps"""
    K = kit.Kit(ctx, garments)
    m = ctx.m
    top = K.top
    cloth = top.data.materials[0]
    t = K.torso_tree
    btn = kit.mat('coat_btn', lambda: MT.paint('kit_btn', lin((0.30, 0.31, 0.27)), rough=0.5))
    bm = bmesh.new()
    zt, zb = m['neck_base_z'] - 0.07, m['belt_z'] - 0.02
    for k in range(6):
        z = zt - k * (zt - zb) / 5
        for x in (0.065 - 0.012 * k / 5, -0.065 + 0.012 * k / 5):
            hit, n = geo.project(t, Vector((x, K.cy - 0.5, z)), (0, 1, 0))
            if hit:
                geo.add_cyl(bm, 0.009, 0.009, 0.006, geo.M_at(hit + n * 0.005, geo.frame(n)), segs=8)
    K.finish(bm, 'coat_buttons', btn)
    bm = bmesh.new()
    for s in (1, -1):
        c = Vector((s * 0.14, K.cy - 0.5, m['belt_z'] - 0.1))
        geo.conform_patch(bm, t, c, (0, 1, 0), (-s * 0.35, 0, 1), 0.16, 0.05, 0.005, 0.004, nu=3, nv=1)
    K.finish(bm, 'coat_flaps', cloth)
    if collar_col:
        z = m['neck_base_z'] + 0.0
        pts = []
        for k in range(-22, 23):
            q, nn = K.at_angle(z + 0.01 * abs(k) / 22, k * 7)
            pts.append(q)
        bm = bmesh.new()
        geo.ribbon(bm, t, pts, 0.05, 0.007, 0.004, towards=lambda q: Vector((0, K.cy, q.z)) - q)
        K.finish(bm, 'coat_collar', kit.mat('collar_green', lambda: MT.fabric('collar', lin(collar_col), kind='wool', dirt=0.05)))
    bm = bmesh.new()
    for s in (1, -1):
        sh = ctx.bone['upperarm_' + ('l' if s > 0 else 'r')][0]
        nk = ctx.bone['neck_01'][0]
        c = (sh * 0.62 + nk * 0.38); c = Vector((c.x, c.y, c.z + 0.25))
        geo.conform_patch(bm, t, c, (0, 0, -1), (s, 0, 0), 0.045, 0.11, 0.005, 0.004, nu=2, nv=3)
    K.finish(bm, 'coat_straps', kit.mat('strap', lambda: MT.fabric('strap', lin((0.30, 0.32, 0.27)), kind='wool')))
    return K.objs


def snap_islands(ctx, objs, garments, max_gap=0.003, keep=0.0015, reach=0.05):
    """rigid kit parts (boxes, handles, pouches) that hang 6-50 mm off the belt / tunic are moved onto it: each loose
    island is translated toward its nearest support (body, garments, the other kit) until it rests `keep` above it"""
    moved = []
    for o in objs:
        if o.type != 'MESH' or o.name.startswith(('kit_glasses', 'facial', 'kit_gloves')):
            continue
        others = [x for x in objs + garments + [ctx.human] if x is not o and x.type == 'MESH']
        tree = geo.bvh_of(others)
        bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
        seen, isls = set(), []
        for v0 in bm.verts:
            if v0.index in seen:
                continue
            isl, stack = [], [v0]
            seen.add(v0.index)
            while stack:
                v = stack.pop(); isl.append(v)
                for e in v.link_edges:
                    w = e.other_vert(v)
                    if w.index not in seen:
                        seen.add(w.index); stack.append(w)
            isls.append(isl)
        # islands whose boxes touch (bag body + flap, satchel + tab) form one rigid item and move together
        bb = [(Vector([min(v.co[k] for v in i) - 0.004 for k in range(3)]), Vector([max(v.co[k] for v in i) + 0.004 for k in range(3)])) for i in isls]
        par = list(range(len(isls)))
        def root(a):
            while par[a] != a:
                par[a] = par[par[a]]; a = par[a]
            return a
        for a in range(len(isls)):
            for b in range(a + 1, len(isls)):
                if all(bb[a][0][k] <= bb[b][1][k] and bb[b][0][k] <= bb[a][1][k] for k in range(3)):
                    par[root(a)] = root(b)
        groups = {}
        for a, i in enumerate(isls):
            groups.setdefault(root(a), []).extend(i)
        for isl in groups.values():
            if len(isl) > 1500:
                continue
            best = None
            for v in isl:
                loc, n, i, d = tree.find_nearest(o.matrix_world @ v.co, reach)
                if loc is not None and (best is None or d < best[0]):
                    best = (d, loc, o.matrix_world @ v.co)
            if best is None or best[0] <= max_gap:
                continue
            d, loc, p = best
            step = (loc - p).normalized() * (d - keep)
            inv = o.matrix_world.inverted().to_3x3()
            for v in isl:
                v.co += inv @ step
            moved.append(f'{o.name}[{len(isl)}v {d * 1000:.0f}mm]')
        bm.to_mesh(o.data); o.data.update(); bm.free()
    log('kit islands snapped:', ', '.join(moved) or 'none')
    return moved


def rigidify_islands(ctx, objs, garments, min_depth=0.014, max_extent=0.27):
    """box-like kit (pouches, satchel, cases, holsters) got per-vertex weights from the tunic, so their far faces follow
    other bones than the face that rests on the belt and the box drifts 10-15 mm off it when the spine bends: give every
    vertex of such an item the weights of its contact vertex (the one nearest the support), so it rides as one piece"""
    done = []
    for o in objs:
        if o.type != 'MESH' or o.name.startswith(('kit_glasses', 'facial', 'kit_gloves', 'outfit_details')) or not o.vertex_groups:
            continue
        others = [x for x in objs + garments + [ctx.human] if x is not o and x.type == 'MESH']
        tree = geo.bvh_of(others)
        sup_co, sup_w = [], []
        bones = set(ctx.rig.data.bones.keys())
        for x in others:
            if not x.vertex_groups or x.name.startswith(('kit_glasses', 'facial')):
                continue
            names = {g.index: g.name for g in x.vertex_groups}
            for v in x.data.vertices:
                sup_co.append(x.matrix_world @ v.co); sup_w.append({names[g.group]: g.weight for g in v.groups if g.weight > 1e-4 and names[g.group] in bones})
        from mathutils.kdtree import KDTree
        sup_kd = KDTree(len(sup_co))
        for k, c in enumerate(sup_co):
            sup_kd.insert(c, k)
        sup_kd.balance()
        me = o.data; mw = o.matrix_world
        bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
        seen, isls = set(), []
        for v0 in bm.verts:
            if v0.index in seen:
                continue
            isl, stack = [], [v0]; seen.add(v0.index)
            while stack:
                v = stack.pop(); isl.append(v.index)
                for e in v.link_edges:
                    w = e.other_vert(v)
                    if w.index not in seen:
                        seen.add(w.index); stack.append(w)
            isls.append(isl)
        co = [mw @ v.co for v in bm.verts]; bm.free()
        bb = [(Vector([min(co[i][k] for i in L) - 0.004 for k in range(3)]), Vector([max(co[i][k] for i in L) + 0.004 for k in range(3)])) for L in isls]
        par = list(range(len(isls)))
        def root(a):
            while par[a] != a:
                par[a] = par[par[a]]; a = par[a]
            return a
        for a in range(len(isls)):
            for b in range(a + 1, len(isls)):
                if all(bb[a][0][k] <= bb[b][1][k] and bb[b][0][k] <= bb[a][1][k] for k in range(3)):
                    par[root(a)] = root(b)
        groups = {}
        for a, L in enumerate(isls):
            groups.setdefault(root(a), []).extend(L)
        for L in groups.values():
            if len(L) > 1500 or len(L) < 8:
                continue
            ext = max(max(co[i][k] for i in L) - min(co[i][k] for i in L) for k in range(3))
            if ext > (0.6 if o.name.startswith(('kit_shovel', 'kit_gasmask', 'kit_barrelcase')) else max_extent):
                continue
            ds = []
            for i in L:
                loc, n, fi, d = tree.find_nearest(co[i], 0.2)
                ds.append(d if d is not None else 0.2)
            if max(ds) < min_depth:
                continue          # thin conforming patch (pocket, tab): keeps its per-vertex weights
            # weights = the hanger's: mean support weights at the item's 4 contact vertices (the loop / tab on the belt or strap)
            acc = {}
            near = sorted(range(len(L)), key=lambda j: ds[j])[:4]
            for j in near:
                for (_, idx, _) in sup_kd.find_n(tree.find_nearest(co[L[j]], 0.2)[0] or co[L[j]], 3):
                    for nm, wt in sup_w[idx].items():
                        acc[nm] = acc.get(nm, 0.0) + wt
            tot = sum(acc.values()) or 1.0
            for nm in acc:
                if nm not in o.vertex_groups:
                    o.vertex_groups.new(name=nm)
            for vg in o.vertex_groups:
                if vg.name in acc and acc[vg.name] / tot > 1e-3:
                    vg.add(L, acc[vg.name] / tot, 'REPLACE')
                else:
                    vg.remove(L)
            done.append(f'{o.name}[{len(L)}v {ext * 100:.0f}cm]')
    log('kit items rigidified:', ', '.join(done) or 'none')
    return done


def fix_collar_tabs(ctx, garments, kit_objs, spec):
    """pipeline tunic_details projects the collar tabs from 0.5 m in front along a fixed slant onto the torso-only tree:
    grid points that miss the collar stay out there and render as long silver blades. Rebuild them on the collar
    itself: centre found by a ray at the tab spot, patch conformed along that point's own normal, 3 mm stand-off cap.
    Snow smocks carry no insignia (tabs removed)."""
    old = [o for o in kit_objs if o.name.startswith('outfit_tabs')]
    if not old:
        return kit_objs
    mat = old[0].data.materials[0] if old[0].data.materials else None
    for o in old:
        kit_objs.remove(o); bpy.data.objects.remove(o, do_unlink=True)
    if spec['outfit'] in ('winter_smock',):
        log('collar tabs: removed (snow smock)')
        return kit_objs
    K = kit.Kit(ctx, garments)
    tops = [g for g in garments if g.get('garment') in ('top', 'coat', 'outer')] or [K.top]
    officer = spec['outfit'] == 'officer_heer'
    if officer:   # open collar: the tabs sit on the tunic's lapel collar, not on the shirt in the V
        tops = [g for g in tops if g.name.startswith('outfit_tunic')] or tops
    tree = geo.bvh_of(tops)
    z = ctx.m['neck_base_z'] + (0.0 if officer else 0.02)
    xo = 0.068 if officer else 0.045
    bm = bmesh.new(); made = 0
    for sd in (1, -1):
        cands = [(xo, z)] if not officer else [(x_, z + dz) for dz in (-0.01, -0.03, -0.05, -0.07) for x_ in (0.06, 0.075, 0.09)]
        hit = None
        for x_, z_ in cands:
            d = Vector((-sd * (0.45 if not officer else 0.25), 1, 0)).normalized()
            hit, n, i, dist = tree.ray_cast(Vector((sd * x_, K.cy - 0.25, z_)), d, 0.4)
            if hit is not None:
                break
        if hit is None:
            continue
        if n.dot(d) > 0:
            n = -n
        geo.conform_patch(bm, tree, hit + n * 0.03, -n, (0, 0, 1), 0.042, 0.018, 0.0012, 0.0016, nu=4, nv=2)
        made += 1
    for v in bm.verts:   # safety: any grid point that missed stays within 6 mm of the collar or is pulled onto it
        loc, nn, i, dd = tree.find_nearest(v.co, 0.2)
        if loc is not None and dd > 0.006:
            v.co = loc + (v.co - loc).normalized() * 0.004
    o = K.finish(bm, 'outfit_tabs', mat)
    kit_objs.append(o)
    log('collar tabs rebuilt on the collar:', made)
    return kit_objs


def trim_covered(garments, under='outfit_shirt', over='outfit_tunic', margin=0.025, reach=0.05, keep_box=None):
    """an under-layer (officer's shirt) that is covered by the tunic everywhere except the open V pokes through the
    tunic in bent poses (white shards over the tunic front in die): keep only the shirt faces that are visible (no
    tunic along the outward normal within `reach`) plus a `margin` band tucked under the tunic edge"""
    from mathutils.kdtree import KDTree
    U_ = [g for g in garments if g.name.startswith(under)]
    O_ = [g for g in garments if g.name.startswith(over)]
    if not U_ or not O_:
        return 0
    u = U_[0]; tree = geo.bvh_of(O_)
    bm = bmesh.new(); bm.from_mesh(u.data); bm.faces.ensure_lookup_table()
    mw = u.matrix_world; nm = mw.to_3x3()
    vis = []
    for f in bm.faces:
        c = mw @ f.calc_center_median(); n = (nm @ f.normal).normalized()
        # shell normals may face either way: covered = tunic within `reach` on either side of the face
        hit = tree.ray_cast(c + n * 0.0005, n, reach)[0] or tree.ray_cast(c - n * 0.0005, -n, reach)[0]
        vis.append(hit is None)
    kd = KDTree(sum(vis) or 1)
    for f, v in zip(bm.faces, vis):
        if v:
            kd.insert(mw @ f.calc_center_median(), f.index)
    kd.balance()
    kill = [f for f, v in zip(bm.faces, vis) if not v and (not any(vis) or kd.find(mw @ f.calc_center_median())[2] > margin)]
    if keep_box is not None:   # hard limit: nothing of the under-layer outside the open-collar region survives
        (x0, x1), (y0, y1), (z0, z1) = keep_box
        ks = set(kill)
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            if f not in ks and not (x0 <= c.x <= x1 and y0 <= c.y <= y1 and z0 <= c.z <= z1):
                kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(u.data); u.data.update(); bm.free()
    log('trimmed covered', under, 'faces:', len(kill), 'kept', sum(vis), 'visible')
    # lapel edges of the V: the tunic boundary lies ON the shirt (2 mm), no flaring shards; boundary loop smoothed first
    ut = geo.bvh_of(U_)
    o = O_[0]; ob = bmesh.new(); ob.from_mesh(o.data); omw = o.matrix_world; inv = omw.inverted()
    bnd = [v for v in ob.verts if v.is_boundary]
    moved = 0
    for v in bnd:
        c = omw @ v.co
        if keep_box is not None:
            (x0, x1), (y0, y1), (z0, z1) = keep_box
            if not (x0 <= c.x <= x1 and z0 <= c.z <= z1):
                continue
        loc, n, i, d = ut.find_nearest(c, 0.03)
        if loc is None or d < 0.0035:
            continue
        side = (c - loc).normalized()
        v.co = inv @ (loc + side * 0.0022); moved += 1
    ob.to_mesh(o.data); o.data.update(); ob.free()
    log('lapel edge verts laid on the shirt:', moved)
    return len(kill)


def smooth_hems(garments, iters=6):
    """open garment edges (rolled sleeves, collars, cuffs) come out zig-zagged from the shell cut: Taubin-smooth each
    boundary loop along itself (no shrink)"""
    n = 0
    for o in garments:
        if o.type != 'MESH':
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        bnd = [v for v in bm.verts if v.is_boundary]
        nb = {v: [e.other_vert(v) for e in v.link_edges if e.is_boundary] for v in bnd}
        nb = {v: w for v, w in nb.items() if len(w) == 2}
        for it in range(iters * 2):
            lam = 0.5 if it % 2 == 0 else -0.53
            new = {v: v.co + ((w[0].co + w[1].co) * 0.5 - v.co) * lam for v, w in nb.items()}
            for v, c in new.items():
                v.co = c
        n += len(nb)
        bm.to_mesh(o.data); o.data.update(); bm.free()
    log('hem verts smoothed:', n)
    return n


def fix_buckles(ctx, kit_objs):
    """kit.belt builds the buckle as add_box((w, 0.006, h), frame(n)): local Z = n, so the plate came out as a 6 mm
    horizontal SHELF sticking 2 cm out of (and 1.5 cm into) the belt. Swap its height and depth axes in place (same
    vertices, same weights) and seat its back face 0.5 mm on the belt's outer surface."""
    belts = [o for o in kit_objs if o.name.startswith('kit_belt')]
    if not belts:
        return []
    tree = geo.bvh_of(belts)
    bc = sum((b.matrix_world @ Vector(c) for b in belts for c in b.bound_box), Vector()) / (8 * len(belts))
    done = []
    for o in kit_objs:
        if not o.name.startswith('kit_buckle'):
            continue
        mw = o.matrix_world; inv = mw.inverted()
        co = [mw @ v.co for v in o.data.vertices]
        c = sum(co, Vector()) / len(co)
        n = Vector((c.x - bc.x, c.y - bc.y, 0)).normalized()
        X = Vector((0, 0, 1)).cross(n).normalized(); Y = n.cross(X)
        hit = tree.ray_cast(c + n * 0.1, -n, 0.3)[0]
        if hit is None:
            continue
        c2 = hit + n * 0.0035
        for v, p in zip(o.data.vertices, co):
            d = p - c
            v.co = inv @ (c2 + X * d.dot(X) + Y * d.dot(n) + n * d.dot(Y))
        o.data.update()
        done.append(f'{o.name}[{(c2 - c).length * 1000:.0f}mm]')
    log('buckles re-seated', done)
    return done
