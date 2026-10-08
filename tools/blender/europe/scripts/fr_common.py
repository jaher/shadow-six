"""Shared helpers for the M15 Compiegne (Second-Empire French town) assets: mansard roofs, stone lucarnes, period shop
fronts with striped awnings and gilt 3D lettering, iron balconies. argv after '--': outroot variant seed."""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
from eu_common import K, V, SHUTTER, DOOR, compact, tag_lod, use_cheap_windows, use_cheap_doors
import kit_core as C
import bmesh
import bpy

STONE, TRIM = 'ashlar_limestone', 'limestone_smooth'
CREAM = (1.0, 0.95, 0.82)          # Compiegne cream limestone / stucco
SLATE, ZINC = 'roof_slate', 'roof_slate_b'


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    root = a[0] if a else '<claude-tmp>'
    return root, (a[1] if len(a) > 1 else 'a'), (int(a[2]) if len(a) > 2 else 1)


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def mansard(x0, y0, x1, y1, z_eave, z_curb, z_top, oh=0.25, inset=1.0, inset_top=2.6, vertical=(), name='mansard'):
    """Mansard roof over the rect wall line: steep slate brisis from the eave (oh outside the wall) to the curb (inset
    inside), then a low zinc terrasson to a flat top. `vertical` = sides ('E','W','N','S') kept as party walls (no slope:
    the roof rises flush with the wall plane there, closed by a brick fire wall). Returns the rings for dormers."""
    def ring(d_out, z):
        xa = x0 if 'W' in vertical else x0 - d_out
        xb = x1 if 'E' in vertical else x1 + d_out
        ya = y0 if 'S' in vertical else y0 - d_out
        yb = y1 if 'N' in vertical else y1 + d_out
        return [V((xa, ya, z)), V((xb, ya, z)), V((xb, yb, z)), V((xa, yb, z))]
    r0, r1, r2 = ring(oh, z_eave), ring(-inset, z_curb), ring(-inset_top, z_top)
    bm = bmesh.new()
    C.loft_bm(bm, [r0, r1], close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, SLATE, name=name + '_brisis', grime=0.6)
    bm = bmesh.new()
    C.loft_bm(bm, [r1, r2], close_start=False, close_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, ZINC, name=name + '_terrasson', mat_tint=(0.78, 0.8, 0.84), grime=0.4)
    bm = bmesh.new()                                    # zinc roll at the curb + lead-capped eave moulding
    for a, b in zip(r1, r1[1:] + r1[:1]):
        C.cyl_bm(bm, a, b, 0.06, 6)
    K.part(bm, 'steel_galv', name=name + '_curb', mat_tint=(0.7, 0.72, 0.75))
    for side in vertical:                                # brick fire wall closing a party side
        bm = bmesh.new()
        idx = {'S': (0, 1), 'E': (1, 2), 'N': (2, 3), 'W': (3, 0)}[side]
        pts = [r0[idx[0]], r0[idx[1]], r1[idx[1]], r2[idx[1]], r2[idx[0]], r1[idx[0]]]
        nrm = {'S': V((0, -1, 0)), 'E': V((1, 0, 0)), 'N': V((0, 1, 0)), 'W': V((-1, 0, 0))}[side]
        C.loft_bm(bm, [[p - nrm * 0.05 for p in pts], [p + nrm * 0.3 for p in pts]], closed=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, 'brick_red', name=name + '_firewall_' + side, mat_tint=(0.85, 0.75, 0.7))
    return r0, r1, r2


def lucarne(o, n, w=1.15, h=1.75, depth=1.1, pediment='segment', name='lucarne', shutter=None):
    """Stone dormer (lucarne) standing on the cornice at o (wall-face point, z = base), facing n: dressed-stone front with a
    segmental or triangular pediment, zinc cheeks and roof running back into the brisis, casement window."""
    o, n = V(o), V(n).normalized()
    r = V((-n.y, n.x, 0))
    ped = 0.38 if pediment == 'segment' else 0.5
    prof = [(-w / 2 - 0.12, 0), (w / 2 + 0.12, 0), (w / 2 + 0.12, h), (0, h + ped), (-w / 2 - 0.12, h)]
    ring0 = [o + r * px + V((0, 0, pz)) + n * 0.12 for px, pz in prof]
    ring1 = [p - n * (0.12 + depth) for p in ring0]
    fr = K.Frame(o + V((0, 0, 0.18)) + n * 0.12, n, r, w - 0.12, h - 0.4, 0.24, 'segment' if pediment == 'segment' else 'rect', 'window')
    bm = bmesh.new()
    C.loft_bm(bm, [ring0, [p - n * 0.24 for p in ring0]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm = K.boolean_cut(bm, [fr])
    K.part(bm, TRIM, name=name + '_front', mat_tint=CREAM)
    bm = bmesh.new()                                     # cheeks + roof (zinc) back into the slope
    C.loft_bm(bm, [[p - n * 0.24 for p in ring0], ring1], close_start=False, close_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, ZINC, name=name + '_cheeks', mat_tint=(0.72, 0.74, 0.78))
    K.window(fr, 'casement', (2, 3), frame='white', recess=0.08, sill=None, lintel=None, shutters=shutter,
             shutter_color=SHUTTER['grey'], curtain=0.5, streak=False, name=name + '_win')


def text3d(txt, o, n, size=0.42, depth=0.05, mid='steel_painted', tint=(0.78, 0.62, 0.28), name='letters'):
    """Raised 3D letters (Blender built-in font) on a wall face at o (centre of the text baseline-ish), facing n."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = txt
    cu.size = size
    cu.resolution_u = 2
    cu.offset = 0.0
    cu.extrude = depth / 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new(name + '_tmp', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    n = V(n).normalized()
    r = V((-n.y, n.x, 0))
    for v in bm.verts:                                   # text plane (x right, y up, z out) -> wall frame
        x, y, z = v.co
        v.co = V(o) + r * x + V((0, 0, y)) + n * (z + depth / 2)
    K.part(bm, mid, name=name, mat_tint=tint, grime=0.2, bisect=False)


def shopfront(F, color, sign=None, awning=(0.62, 0.12, 0.10), stripe=(0.9, 0.86, 0.76), door_x=None, did=None, goods=None,
              awn_depth=1.5, name='shop'):
    """Period shop front inside opening F (local frame F.p(x, z, d)): pilasters, fascia + cornice with gilt 3D lettering,
    display windows over panelled risers, a recessed glazed door (did -> interactable door), a striped canvas awning
    on iron arms (bottom edge >= 2.3 m above the pavement)."""
    bm_s = bmesh.new()
    def lb(a, b, z0, z1, d0, d1):
        K.lbox(bm_s, F, a, b, z0, z1, d0, d1)
    hw, H = F.w / 2, F.h
    zf = H - 0.75                                     # fascia bottom
    for x in (-hw - 0.2, hw + 0.2):                   # pilasters + capitals
        lb(x - 0.2, x + 0.2, 0.0, zf, -0.05, 0.1)
        lb(x - 0.26, x + 0.26, zf - 0.18, zf, -0.05, 0.16)
    lb(-hw - 0.45, hw + 0.45, zf, H - 0.1, -0.05, 0.13)                 # fascia
    lb(-hw - 0.55, hw + 0.55, H - 0.1, H, -0.05, 0.26)                  # cornice
    spans = [(-hw, hw)] if door_x is None else [(-hw, door_x - 0.6), (door_x + 0.6, hw)]
    for (xa, xb) in spans:
        if xb - xa < 0.4:
            continue
        lb(xa, xb, 0.0, 0.6, -0.3, -0.08)                                # stall riser
        for k in range(max(1, int((xb - xa) / 1.1))):
            nn = max(1, int((xb - xa) / 1.1))
            xx = xa + (k + 0.5) * (xb - xa) / nn
            lb(xx - (xb - xa) / nn * 0.36, xx + (xb - xa) / nn * 0.36, 0.12, 0.48, -0.08, -0.05)
        lb(xa, xb, 0.6, 0.7, -0.34, -0.06)                               # sill
        nm = max(2, int(round((xb - xa) / 1.0)))
        for k in range(nm + 1):
            xx = xa + k * (xb - xa) / nm
            lb(xx - 0.045, xx + 0.045, 0.68, zf - 0.02, -0.28, -0.18)
        lb(xa, xb, zf - 0.75, zf - 0.67, -0.28, -0.18)                   # transom
        gl = bmesh.new()
        q = [F.p(xa, 0.7, -0.24), F.p(xb, 0.7, -0.24), F.p(xb, zf, -0.24), F.p(xa, zf, -0.24)]
        gl.faces.new([gl.verts.new(p) for p in q])
        K.part(gl, 'glass_dirty', name=name + '_glass', grime=0.2, bisect=False)
        ib = bmesh.new()
        q = [F.p(xa, 0.6, -1.2), F.p(xb, 0.6, -1.2), F.p(xb, zf, -1.2), F.p(xa, zf, -1.2)]
        ib.faces.new([ib.verts.new(p) for p in q])
        K.part(ib, 'interior_dark', name=name + '_interior', grime=0.0, bisect=False)
        if goods:
            sh = bmesh.new()
            for z in (0.95, 1.5):
                K.lbox(sh, F, xa + 0.1, xb - 0.1, z, z + 0.04, -0.8, -0.4)
            for k in range(int((xb - xa) / 0.32)):
                xx = xa + 0.25 + k * 0.32
                if xx > xb - 0.2:
                    break
                K.lbox(sh, F, xx - 0.1, xx + 0.1, 0.99 + (k % 2) * 0.55, 1.2 + (k % 2) * 0.55, -0.7, -0.5)
            K.part(sh, 'wood_paint', name=name + '_goods', mat_tint=goods)
    if door_x is not None:                                               # recessed entrance
        lb(door_x - 0.62, door_x - 0.52, 0.0, zf, -0.95, -0.05)
        lb(door_x + 0.52, door_x + 0.62, 0.0, zf, -0.95, -0.05)
        lb(door_x - 0.62, door_x + 0.62, 2.35, zf, -0.95, -0.85)
    K.part(bm_s, 'wood_paint', name=name + '_joinery', mat_tint=color)
    if door_x is not None:
        ent = K.Frame(F.p(door_x, 0.0, -0.95), F.n, F.r, 0.95, 2.3, 0.1, 'rect', 'door')
        K.door(ent, did or (name + '_door'), 'glazed', color, step=None, lintel=None)
        K.P('granite', K.box_bm, tuple(F.p(door_x, -0.03, -0.45)), (1.1, 1.0, 0.06), name=name + '_threshold')
    if sign:
        text3d(sign, F.p(0, (zf + H - 0.1) / 2 - 0.05, 0.13), F.n, size=min(0.46, (H - 0.1 - zf) * 0.75),
               depth=0.04, name=name + '_sign')
    if awn_depth > 0:                                                     # striped canvas awning
        a0, a1, zt = -hw - 0.3, hw + 0.3, zf - 0.05
        drop = 0.55
        nstr = max(4, int((a1 - a0) / 0.32))
        for col, par in ((awning, 0), (stripe, 1)):
            cv = bmesh.new()
            for k in range(par, nstr, 2):
                xa, xb = a0 + (a1 - a0) * k / nstr, a0 + (a1 - a0) * (k + 1) / nstr
                q = [F.p(xa, zt, 0.15), F.p(xb, zt, 0.15), F.p(xb, zt - drop, awn_depth), F.p(xa, zt - drop, awn_depth)]
                cv.faces.new([cv.verts.new(p) for p in q])
                cv.faces.new([cv.verts.new(p - V((0, 0, 0.012))) for p in reversed(q)])
                q2 = [F.p(xa, zt - drop, awn_depth), F.p(xb, zt - drop, awn_depth), F.p(xb, zt - drop - 0.28, awn_depth + 0.01),
                      F.p(xa, zt - drop - 0.28, awn_depth + 0.01)]
                cv.faces.new([cv.verts.new(p) for p in q2])
                cv.faces.new([cv.verts.new(p + F.n * -0.012) for p in reversed(q2)])
            K.part(cv, 'canvas', name=name + '_awning%d' % par, mat_tint=col, grime=0.35, bisect=False)
        ir = bmesh.new()
        for x in (a0 + 0.1, (a0 + a1) / 2, a1 - 0.1):
            K.beam_bm(ir, F.p(x, zt - 0.8, 0.12), F.p(x, zt - drop - 0.02, awn_depth - 0.03), 0.022, 0.022)
        C.cyl_bm(ir, F.p(a0, zt + 0.02, 0.18), F.p(a1, zt + 0.02, 0.18), 0.07, 8)
        K.part(ir, 'cast_iron', name=name + '_awning_iron')


def report_tris(top=22):
    import re, collections
    c = collections.Counter()
    for o in C.A.parts:
        if o.type != 'MESH':
            continue
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        c[re.sub(r'\d+', '#', re.sub(r'[\d\.]+$', '', o.name))] += t
    print('TRIS total', sum(c.values()))
    for k, v in c.most_common(top):
        print('TRI %6d %s' % (v, k))


def no_streaks():
    """Clean Compiegne limestone: no rain-streak decal under every sill (they read as soot at game zoom)."""
    import kit_arch as KA
    w = K.window
    def win(fr, *a, **kw):
        kw['streak'] = False
        return w(fr, *a, **kw)
    K.window = win
    KA.window = win
