"""Colt M1911A1 for the menu key art (tools/ui/keyart/render.py): built procedurally in Blender, no external assets.

  import colt1911; root, parts = colt1911.build()      # inside a Blender session (render.py does this)
  blender -b --factory-startup --python tools/ui/keyart/colt1911.py -- <out.png> [W H samples view]   # check render
                                                                       (view: right | left | front | top)
Real proportions in millimetres: 216 mm overall, 192 mm slide 23.4 mm wide, 5" (127 mm) barrel, barrel axis 13.5 mm
above the rails, 18 deg grip angle, 138 mm high. Slide with rear serrations, A1 sights, ejection port, barrel
bushing and recoil-spring plug; frame with dust cover, trigger guard, short A1 trigger, cocked spur hammer, grip
safety with tang, arched serrated mainspring housing with lanyard loop, slide stop, thumb safety, plunger tube,
magazine catch, pins; brown checkered grip panels with screws; magazine floor plate. Parkerized steel with worn edges
(a Cycles bevel-node mask), brown plastic grips with procedural diamond checkering.
Local frame of the returned root empty: +X muzzle, +Z slide top, +Y the pistol's left (thumb-safety) side; the origin
is the web point (deepest point of the grip-safety curve, where the web of the shooting hand sits).
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

S = 0.001                              # mm -> m
RAKE = math.tan(math.radians(18.0))    # grip angle, 18 deg off vertical
WEB = (21.0, -17.0)                    # web point (x, z), profile mm
GB = -105.0                            # bottom of the grip frame


def back_x(z):                         # back-strap line (grip safety / housing) at height z
    return 23.5 + (z + 16.0) * RAKE


def front_x(z):                        # front-strap line at height z
    return 74.0 + (z + 30.0) * RAKE


def arc(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def sk(socks, name):
    """First enabled socket called `name` (the Mix node keeps one per data type)."""
    return next(s for s in socks if s.name == name and s.enabled)


def _finish(bm, name, coll, mat, smooth=35.0):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(smooth)
    except AttributeError:
        pass
    if mat:
        me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def prism(name, pts, y0, y1, coll, mat, bevel=None, smooth=35.0):
    """Extrude a closed XZ profile (mm) between y0..y1 (mm). bevel=(i0, i1, offset_mm, segments) or a list of them
    rounds the cap outline edges of profile segments i0..i1-1 on both caps (front straps, guard, panel cushions)."""
    bm = bmesh.new()
    v0 = [bm.verts.new((x * S, y0 * S, z * S)) for x, z in pts]
    v1 = [bm.verts.new((x * S, y1 * S, z * S)) for x, z in pts]
    n = len(pts)
    bm.faces.new(v0)
    bm.faces.new(v1[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for i0, i1, off, seg in ([bevel] if bevel and not isinstance(bevel[0], (tuple, list)) else (bevel or [])):
        want = set()
        for i in range(i0, i1):
            j = (i + 1) % n
            for y in (y0, y1):
                want.add(frozenset(((round(pts[i][0], 4), round(y, 4), round(pts[i][1], 4)), (round(pts[j][0], 4), round(y, 4), round(pts[j][1], 4)))))
        key = lambda v: (round(v.co.x / S, 4), round(v.co.y / S, 4), round(v.co.z / S, 4))
        es = [e for e in bm.edges if frozenset((key(e.verts[0]), key(e.verts[1]))) in want]
        if es:
            bmesh.ops.bevel(bm, geom=es, offset=off * S, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return _finish(bm, name, coll, mat, smooth)


def cyl(name, p0, p1, r, coll, mat, seg=32, r1=None):
    """Cylinder (cone with r1) between two points in mm."""
    a, b = Vector(p0) * S, Vector(p1) * S
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r * S,
                          radius2=(r1 if r1 is not None else r) * S, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return _finish(bm, name, coll, mat, 50.0)


def box(name, x0, x1, y0, y1, z0, z1, coll, mat=None):
    return prism(name, [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y0, y1, coll, mat)


def torus(name, c, R, r, coll, mat):
    """Ring in the XZ plane (tube axis Y)."""
    bm = bmesh.new()
    seg, ring = 24, 10
    rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(ring):
            b = 2 * math.pi * j / ring
            rr = R + r * math.cos(b)
            row.append(bm.verts.new((Vector(c) + Vector((rr * math.cos(a), r * math.sin(b), rr * math.sin(a)))) * S))
        rows.append(row)
    for i in range(seg):
        for j in range(ring):
            bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % ring], rows[i][(j + 1) % ring]))
    return _finish(bm, name, coll, mat, 60.0)


def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('bool_' + cutter.name, 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = cutter
    cutter.hide_render = True
    cutter.display_type = 'WIRE'
    cutter['cutter'] = True
    return m


def join(objs, name):
    """Merge helper meshes into one cutter object (keeps the first)."""
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    bm.to_mesh(objs[0].data)
    bm.free()
    for o in objs[1:]:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    objs[0].name = name
    return objs[0]


def edge_bevel(o, width_mm=0.35, seg=2, angle=40):
    m = o.modifiers.new('edges', 'BEVEL')
    m.width = width_mm * S
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    return m


# ---------------------------------------------------------------- materials
def _metal(name, base, rough, wear_col, seed=0.0, metal=0.72):
    """Parkerized / blued steel: mottled base, rough variation, bright worn edges (bevel-normal vs true normal)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bs = N['Principled BSDF']
    bev = N.new('ShaderNodeBevel'); bev.name = 'bevel'; bev.samples = 8; bev.inputs['Radius'].default_value = 0.00045
    geo = N.new('ShaderNodeNewGeometry')
    dot = N.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    L.new(bev.outputs['Normal'], dot.inputs[0]); L.new(geo.outputs['Normal'], dot.inputs[1])
    edge = N.new('ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = 0.995; edge.inputs['From Max'].default_value = 0.94
    L.new(dot.outputs['Value'], edge.inputs['Value'])
    tc = N.new('ShaderNodeTexCoord')
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 700.0 + seed * 13; nz.inputs['Detail'].default_value = 6.0
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    nz2 = N.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 120.0 + seed * 7; nz2.inputs['Detail'].default_value = 3.0
    L.new(tc.outputs['Object'], nz2.inputs['Vector'])
    wr = N.new('ShaderNodeMapRange'); wr.inputs['From Min'].default_value = 0.38; wr.inputs['From Max'].default_value = 0.62
    L.new(nz2.outputs['Fac'], wr.inputs['Value'])
    wear = N.new('ShaderNodeMath'); wear.operation = 'MULTIPLY'; wear.use_clamp = True
    L.new(edge.outputs['Result'], wear.inputs[0]); L.new(wr.outputs['Result'], wear.inputs[1])
    col = N.new('ShaderNodeMix'); col.data_type = 'RGBA'
    sk(col.inputs, 'A').default_value = (*base, 1); sk(col.inputs, 'B').default_value = (*wear_col, 1)
    L.new(wear.outputs['Value'], sk(col.inputs, 'Factor'))
    nzr = N.new('ShaderNodeMapRange'); nzr.inputs['To Min'].default_value = 0.82; nzr.inputs['To Max'].default_value = 1.22
    L.new(nz.outputs['Fac'], nzr.inputs['Value'])
    cmb = N.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        L.new(nzr.outputs['Result'], cmb.inputs[k])
    mot = N.new('ShaderNodeMix'); mot.data_type = 'RGBA'; mot.blend_type = 'MULTIPLY'
    sk(mot.inputs, 'Factor').default_value = 0.5
    L.new(sk(col.outputs, 'Result'), sk(mot.inputs, 'A')); L.new(cmb.outputs['Color'], sk(mot.inputs, 'B'))
    L.new(sk(mot.outputs, 'Result'), bs.inputs['Base Color'])
    rgh = N.new('ShaderNodeMapRange')
    rgh.inputs['To Min'].default_value = rough + 0.09; rgh.inputs['To Max'].default_value = rough - 0.09
    L.new(nz.outputs['Fac'], rgh.inputs['Value'])
    rmix = N.new('ShaderNodeMix'); rmix.data_type = 'FLOAT'
    L.new(wear.outputs['Value'], sk(rmix.inputs, 'Factor')); L.new(rgh.outputs['Result'], sk(rmix.inputs, 'A'))
    sk(rmix.inputs, 'B').default_value = 0.24
    L.new(sk(rmix.outputs, 'Result'), bs.inputs['Roughness'])
    mm = N.new('ShaderNodeMix'); mm.data_type = 'FLOAT'
    L.new(wear.outputs['Value'], sk(mm.inputs, 'Factor'))
    sk(mm.inputs, 'A').default_value = metal; sk(mm.inputs, 'B').default_value = 1.0
    L.new(sk(mm.outputs, 'Result'), bs.inputs['Metallic'])
    L.new(bev.outputs['Normal'], bs.inputs['Normal'])
    return m


def _bands(N, L, vec, pitch_mm, rot, axis='X'):
    mp = N.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = rot
    L.new(vec, mp.inputs['Vector'])
    w = N.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = axis; w.wave_profile = 'TRI'
    w.inputs['Scale'].default_value = math.pi / (10.0 * pitch_mm * S)       # Cycles bands: period 2pi / (20 * scale)
    w.inputs['Distortion'].default_value = 0.0
    L.new(mp.outputs['Vector'], w.inputs['Vector'])
    return w


def _grips():
    m = bpy.data.materials.new('colt_grips')
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bs = N['Principled BSDF']
    base = (0.075, 0.028, 0.011, 1)
    bs.inputs['Roughness'].default_value = 0.4
    tc = N.new('ShaderNodeTexCoord')
    g1 = _bands(N, L, tc.outputs['Object'], 1.5, (0, math.radians(45), 0))
    g2 = _bands(N, L, tc.outputs['Object'], 1.5, (0, math.radians(-45), 0))
    mn = N.new('ShaderNodeMath'); mn.operation = 'MINIMUM'
    L.new(g1.outputs['Fac'], mn.inputs[0]); L.new(g2.outputs['Fac'], mn.inputs[1])
    # checkered field on the flat of the panel only: the rounded border stays smooth
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Normal'], sep.inputs['Vector'])
    ab = N.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; L.new(sep.outputs['Y'], ab.inputs[0])
    fld = N.new('ShaderNodeMapRange'); fld.inputs['From Min'].default_value = 0.9; fld.inputs['From Max'].default_value = 0.97
    L.new(ab.outputs['Value'], fld.inputs['Value'])
    hm = N.new('ShaderNodeMath'); hm.operation = 'MULTIPLY'
    L.new(mn.outputs['Value'], hm.inputs[0]); L.new(fld.outputs['Result'], hm.inputs[1])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.7; bump.inputs['Distance'].default_value = 0.0005
    L.new(hm.outputs['Value'], bump.inputs['Height'])
    bev = N.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = 0.0006
    L.new(bev.outputs['Normal'], bump.inputs['Normal'])
    L.new(bump.outputs['Normal'], bs.inputs['Normal'])
    # moulded-plastic colour variation; the diamond tops a touch lighter (worn by the hand)
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 260.0
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
    sk(mx.inputs, 'Factor').default_value = 0.3
    sk(mx.inputs, 'A').default_value = base
    L.new(nz.outputs['Color'], sk(mx.inputs, 'B'))
    tops = N.new('ShaderNodeMix'); tops.data_type = 'RGBA'
    L.new(hm.outputs['Value'], sk(tops.inputs, 'Factor'))
    L.new(sk(mx.outputs, 'Result'), sk(tops.inputs, 'A'))
    sk(tops.inputs, 'B').default_value = (0.13, 0.055, 0.024, 1)
    L.new(sk(tops.outputs, 'Result'), bs.inputs['Base Color'])
    return m


def _serrated(name, base, rough, pitch_mm, rot, seed):
    """Metal with fine straight serrations (mainspring housing, hammer spur, trigger, catch)."""
    m = _metal(name, base, rough, (0.3, 0.3, 0.31), seed)
    N, L = m.node_tree.nodes, m.node_tree.links
    bs = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    w = _bands(N, L, tc.outputs['Object'], pitch_mm, rot, 'Z')
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.65; bump.inputs['Distance'].default_value = 0.0004
    L.new(w.outputs['Fac'], bump.inputs['Height'])
    L.new(N['bevel'].outputs['Normal'], bump.inputs['Normal'])
    L.new(bump.outputs['Normal'], bs.inputs['Normal'])
    return m


# ---------------------------------------------------------------- the pistol
def build(coll=None, name='colt1911'):
    coll = coll or bpy.context.scene.collection
    sub = bpy.data.collections.new(name)
    coll.children.link(sub)
    park = _metal('colt_parkerized', (0.05, 0.052, 0.048), 0.5, (0.3, 0.3, 0.31), 0.0)
    park2 = _metal('colt_slide', (0.045, 0.047, 0.045), 0.46, (0.33, 0.33, 0.34), 5.0)
    steel = _metal('colt_barrel', (0.2, 0.2, 0.2), 0.3, (0.45, 0.45, 0.46), 9.0, 1.0)
    dark = bpy.data.materials.new('colt_bore'); dark.use_nodes = True
    dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.004, 0.004, 0.004, 1)
    dark.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    grip = _grips()
    msh_mat = _serrated('colt_housing', (0.05, 0.052, 0.048), 0.55, 1.3, (0, math.radians(18), 0), 2.0)
    spur_mat = _serrated('colt_spur', (0.05, 0.052, 0.048), 0.5, 1.0, (0, math.radians(-25), 0), 3.0)
    parts = {}

    def P(o):
        parts[o.name] = o
        return o

    # ---- slide: side profile, Y +-11.7, rounded top
    SW, ST, BZ, PZ, LIP = 11.7, 25.0, 13.5, -3.5, -11.5     # half width, top, barrel axis, plug axis, nose bottom
    SR = 22.0                                              # slide rear
    slide_pts = [(SR, 0.0), (180.5, 0.0), (181.5, -1.0), (182.0, LIP + 1.5), (183.0, LIP), (212.3, LIP), (213.5, LIP + 1.2),
                 (213.5, ST), (SR, ST)]
    slide = P(prism('slide', slide_pts, -SW, SW, sub, park2, bevel=(4, 5, 2.2, 3)))
    bm = bmesh.new(); bm.from_mesh(slide.data)
    top = [e for e in bm.edges if all(abs(v.co.z - ST * S) < 1e-7 and abs(abs(v.co.y) - SW * S) < 1e-7 for v in e.verts)
           and abs(e.verts[0].co.x - e.verts[1].co.x) > 0.05]
    bmesh.ops.bevel(bm, geom=top, offset=6.5 * S, segments=10, profile=0.5, affect='EDGES', clamp_overlap=False)
    bm.to_mesh(slide.data); bm.free()
    for p in slide.data.polygons:
        p.use_smooth = True
    cut = []
    for i in range(14):                                    # rear serrations, both sides
        x = SR + 6.0 + i * 2.15
        for sgn in (-1, 1):
            cut.append(prism('serr', [(x, -1.0), (x + 1.1, -1.0), (x + 1.1, 18.0), (x + 0.55, 19.0), (x, 18.0)],
                             min(sgn * (SW - 0.7), sgn * (SW + 3)), max(sgn * (SW - 0.7), sgn * (SW + 3)), sub, None))
    BR = 89.0                                              # breech face (5" barrel)
    cut.append(prism('port', [(BR - 1.0, 12.0), (BR + 31.0, 12.0), (BR + 31.0, 32.0), (BR - 1.0, 32.0)], -SW - 3, -4.6, sub, None))
    cut.append(cyl('tunnel', (BR - 2, 0, BZ), (230, 0, BZ), 8.9, sub, None, 40))
    cut.append(cyl('plugbore', (195, 0, PZ), (230, 0, PZ), 6.2, sub, None, 32))
    SSX = 118.0                                            # slide-stop pin
    cut.append(prism('ssnotch', [(SSX - 26.0, -1.0), (SSX - 16.0, -1.0), (SSX - 17.5, 3.0), (SSX - 24.5, 3.0)], SW - 2.5, SW + 2, sub, None))
    boolean(slide, join(cut, 'slide_cut'))
    edge_bevel(slide, 0.3, 2)

    fs = [(197.5, ST - 1.5), (198.0, ST + 1.8), (199.6, ST + 3.4), (202.0, ST + 4.0), (204.6, ST + 3.4), (206.0, ST + 1.5), (206.5, ST - 1.5)]
    P(prism('front_sight', fs, -1.25, 1.25, sub, park2))
    rs = [(SR + 5.0, ST - 2.5), (SR + 5.0, ST + 4.6), (SR + 6.0, ST + 5.4), (SR + 12.5, ST + 5.4), (SR + 15.5, ST - 2.5)]
    rsight = P(prism('rear_sight', rs, -5.4, 5.4, sub, park2))
    boolean(rsight, box('notch', SR, SR + 20, -1.4, 1.4, ST + 3.2, ST + 8, sub))
    edge_bevel(rsight, 0.3, 2)

    # barrel (muzzle + through the port), bushing, plug
    barrel = P(cyl('barrel', (BR, 0, BZ), (215.6, 0, BZ), 7.35, sub, steel, 40))
    boolean(barrel, cyl('bore', (200, 0, BZ), (230, 0, BZ), 5.6, sub, None, 32))
    P(cyl('bore_dark', (199.5, 0, BZ), (200.5, 0, BZ), 5.7, sub, dark, 24))
    P(box('hood', BR, BR + 22, -6.4, 6.4, BZ, BZ + 7.5, sub, steel))
    bush = P(cyl('bushing', (207.0, 0, BZ), (214.4, 0, BZ), 8.85, sub, park))
    boolean(bush, cyl('bush_in', (200, 0, BZ), (230, 0, BZ), 7.45, sub, None, 40))
    edge_bevel(bush, 0.35, 2)
    plug = P(cyl('plug', (203.0, 0, PZ), (213.2, 0, PZ), 6.1, sub, park))
    boolean(plug, cyl('plug_dimple', (212.4, 0, PZ), (214.5, 0, PZ), 2.6, sub, None, 24, 3.4))
    edge_bevel(plug, 0.45, 3)

    # ---- frame: rails, dust cover, over the trigger, grip
    FW = 10.0
    GF = (front_x(-30.0), -30.0)
    frame_pts = [(14.0, 0.0), (181.0, 0.0), (181.0, -2.0), (179.5, LIP + 0.6), (178.0, LIP), (126.0, LIP),
                 (121.0, -12.5), (100.0, -13.0), (78.5, -13.0), (front_x(-26.0) + 2.4, -26.0), GF,
                 (front_x(GB), GB), (back_x(GB) + 4.0, GB), (back_x(-60) + 3.5, -60.0),
                 (back_x(-30) + 2.0, -30.0), (26.0, -14.0), (20.5, -7.5), (14.0, -4.0)]
    frame = P(prism('frame', frame_pts, -FW, FW, sub, park, bevel=[(4, 6, 2.2, 3), (9, 11, 4.2, 5)]))
    seat = []
    for sgn in (-1, 1):
        seat.append(prism('seat', [(back_x(-20) - 3, -20.0), (front_x(-31) - 3.5, -29.5), (front_x(GB + 2) - 3.5, GB + 2), (back_x(GB + 2) - 6, GB + 2)],
                          min(sgn * 9.4, sgn * 14), max(sgn * 9.4, sgn * 14), sub, None))
    for sgn in (-1, 1):                                    # A1 finger-relief scallops behind the trigger
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=9.0 * S)
        bmesh.ops.scale(bm, vec=(1.0, 1.0, 0.8), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((84.0, sgn * (FW + 7.6), -19.0)) * S, verts=bm.verts)
        seat.append(_finish(bm, 'relief', sub, None))
    boolean(frame, join(seat, 'frame_seat'))
    edge_bevel(frame, 0.35, 2)

    # trigger guard (C-shaped ring merging into the dust cover and the front strap)
    GX = 110.0                                             # centre of the guard's front curve
    tg_out = [(GX + 13.5, -9.0), (GX + 11.6, -13.0)] + arc(GX, -24.0, 11.0, 0, -90, 7)[1:] + [(86.0, -35.0), (79.0, -34.2), (75.0, -30.0)]
    tg_in = [(78.4, -27.5), (81.0, -30.6), (86.0, -31.0)] + arc(GX, -24.0, 7.0, -90, 0, 6)[1:] + [(GX + 7.5, -12.0), (GX + 7.5, -9.0)]
    P(prism('trigger_guard', tg_out + tg_in, -4.4, 4.4, sub, park, bevel=(0, len(tg_out) + len(tg_in), 1.6, 3)))

    trig = [(91.0, -12.5), (91.3, -18.0), (92.3, -23.8), (93.6, -25.2), (96.8, -25.0), (98.0, -19.0), (98.0, -12.5)]
    P(prism('trigger', trig, -3.5, 3.5, sub, spur_mat, bevel=(0, 6, 0.9, 2)))

    # grip safety (tang over the web, leg down the back strap)
    gs = [(SR + 1.0, -1.4), (10.0, -2.0), (4.0, -2.6)] + arc(3.7, -5.4, 2.8, 95, 250, 6)[1:] + \
         [(6.0, -9.4), (11.0, -10.9), (15.5, -12.8), (19.6, -15.0), (22.0, -18.6), (back_x(-22) + 0.1, -22.0),
          (back_x(-30), -30.0), (back_x(-43), -43.0), (back_x(-43) + 7, -43.5), (27.5, -20.0), (26.5, -6.0)]
    P(prism('grip_safety', gs, -8.6, 8.6, sub, park, bevel=(3, 15, 2.6, 4)))

    # arched mainspring housing (serrated), lanyard lug + loop
    def msh_back(z):
        t = max(0.0, min(1.0, (-z - 43.0) / (-GB - 43.0)))
        return back_x(z) - 3.4 * math.sin(math.pi * min(1.0, t * 1.3)) ** 0.8
    zs = [z for z in range(-48, int(GB), -6)]
    msh = [(back_x(-43.5) + 0.3, -43.5)] + [(msh_back(z), z) for z in zs] + \
          [(msh_back(GB + 2.5), GB + 2.5), (back_x(GB) - 1.2, GB), (back_x(GB) + 6.0, GB), (back_x(-43) + 7.0, -43.5)]
    P(prism('mainspring_housing', msh, -8.6, 8.6, sub, msh_mat, bevel=(0, len(msh) - 3, 2.6, 4)))
    lx = back_x(GB) + 0.5
    P(prism('lanyard_lug', [(lx - 4.0, GB + 1.0), (lx + 2.5, GB + 1.0), (lx + 2.0, GB - 2.6), (lx - 3.5, GB - 2.6)], -2.6, 2.6, sub, park))
    P(torus('lanyard_loop', (lx - 1.0, 0, GB - 5.6), 3.8, 0.95, sub, steel))

    mb = [(back_x(GB) + 3.5, GB), (front_x(GB) - 1.5, GB), (front_x(GB) - 0.5, GB - 1.0), (front_x(GB) - 1.0, GB - 3.2),
          (back_x(GB) + 3.0, GB - 3.2)]
    P(prism('magazine_base', mb, -6.6, 6.6, sub, park, bevel=(1, 4, 0.8, 2)))

    # hammer (cocked A1 spur), pins
    ham = [(33.0, -6.0), (32.0, -1.0), (26.0, 3.0), (19.0, 7.2), (13.0, 10.0), (8.0, 11.4), (4.6, 11.2), (2.6, 9.4),
           (3.4, 6.6), (8.0, 4.0), (15.0, 0.4), (20.5, -3.5), (22.5, -8.0), (26.0, -11.0), (31.0, -10.5)]
    P(prism('hammer', ham, -3.2, 3.2, sub, spur_mat, bevel=(3, 9, 0.8, 2)))
    for nm, x, z, r in (('hammer_pin', 27.5, -6.5, 1.7), ('sear_pin', 39.0, -9.0, 1.6), ('slide_stop_pin', SSX, -5.6, 2.4)):
        for sgn in (-1, 1):
            if nm == 'slide_stop_pin' and sgn > 0:
                continue
            P(cyl(f'{nm}_{"l" if sgn > 0 else "r"}', (x, sgn * (FW - 0.5), z), (x, sgn * (FW + 0.45), z), r, sub, steel, 20))

    # slide stop (left): pivot on the pin, lever back to a thumb piece above the trigger
    ss = arc(SSX, -5.6, 3.9, -90, 90, 6) + [(SSX - 12.0, -1.8), (SSX - 22.0, -1.4), (SSX - 26.5, 0.2), (SSX - 30.5, -0.6),
                                            (SSX - 32.0, -3.6), (SSX - 29.5, -8.6), (SSX - 24.0, -8.9), (SSX - 18.0, -6.2), (SSX - 8.0, -8.8)]
    P(prism('slide_stop', ss, FW - 0.2, FW + 2.6, sub, park, bevel=(0, len(ss), 0.7, 2)))
    ts = [(20.5, -10.0), (27.5, -12.5), (33.5, -8.5), (38.0, -4.6), (46.5, -3.4), (48.5, -1.2), (47.0, 0.4), (35.0, 0.4),
          (26.0, -1.0), (20.0, -5.0)]
    P(prism('thumb_safety', ts, FW - 0.2, FW + 2.4, sub, park, bevel=(0, len(ts), 0.7, 2)))
    P(cyl('plunger_tube', (51.0, FW + 1.6, -4.2), (64.0, FW + 1.6, -4.2), 2.3, sub, park, 20))
    MC = (68.0, -25.0)
    P(cyl('mag_catch', (MC[0], FW - 1.0, MC[1]), (MC[0], FW + 1.4, MC[1]), 4.4, sub, spur_mat, 28))

    # grip panels: domed, checkered, two slotted screws each
    gp = [(back_x(-19.5) - 0.6, -19.5), (front_x(-30.0) - 2.6, -29.0)] + [(front_x(z) - 1.8, z) for z in (-40, -60, -80, GB + 9)] + \
         arc(front_x(GB + 5) - 6.0, GB + 5, 4.3, 0, -90, 4)[1:] + [(back_x(GB + 0.7) + 4.5, GB + 0.7)] + \
         arc(back_x(GB + 5) + 4.5, GB + 5, 4.3, -90, -180, 4)[1:] + [(back_x(z) - 0.6, z) for z in (-80, -60, -40)]
    for sgn, side in ((-1, 'r'), (1, 'l')):
        pnl = P(prism(f'grip_panel_{side}', gp, min(sgn * 9.3, sgn * 14.6), max(sgn * 9.3, sgn * 14.6), sub, grip, bevel=(0, len(gp), 3.4, 6), smooth=60))
        if side == 'l':
            boolean(pnl, cyl('catch_clear', (MC[0], 5, MC[1]), (MC[0], 20, MC[1]), 6.0, sub, None, 28))
        for z in (-36.0, GB + 11.0):
            x = (back_x(z) + front_x(z)) / 2 + (1.5 if z > -50 else 2.5)
            yb = sgn * 13.9
            scr = P(cyl(f'screw_{side}{int(-z)}', (x, yb, z), (x, yb + sgn * 1.25, z), 3.3, sub, steel, 24, 2.7))
            boolean(scr, box('slot', x - 3.6, x + 3.6, min(yb + sgn * 0.6, yb + sgn * 2), max(yb + sgn * 0.6, yb + sgn * 2), z - 0.45, z + 0.45, sub))

    root = bpy.data.objects.new(name, None)
    sub.objects.link(root)
    off = Matrix.Translation((-WEB[0] * S, 0, -WEB[1] * S))
    for o in sub.objects:
        if o is not root:
            o.matrix_world = off @ o.matrix_world
            o.parent = root
    return root, parts


def grip_hull(root, below_mm=-29.0):
    """Closed convex proxy (bmesh, world space) of the grip below the trigger guard, for the finger-contact solve."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    Mi = root.matrix_world.inverted()
    for o in root.children:
        if o.type != 'MESH' or o.get('cutter') or not o.name.startswith(('grip_panel', 'frame', 'grip_safety', 'mainspring')):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = o.matrix_world @ v.co
            if (Mi @ w).z < (below_mm - WEB[1]) * S:
                pts.append(w.copy())
        ev.to_mesh_clear()
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


if __name__ == '__main__':
    import sys
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else '/tmp/colt1911.png'
    W = int(argv[1]) if len(argv) > 1 else 1600
    H = int(argv[2]) if len(argv) > 2 else 1000
    spp = int(argv[3]) if len(argv) > 3 else 64
    view = argv[4] if len(argv) > 4 else 'right'
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    root, parts = build()
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = spp; sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.view_settings.view_transform = 'Filmic'; sc.view_settings.look = 'Medium High Contrast'
    world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.02, 0.024, 1)
    tgt = Vector((0.085, 0, -0.03))
    ysg = 1 if view == 'left' else -1

    def light(nm, loc, e, col, size):
        d = bpy.data.lights.new(nm, 'AREA'); d.energy = e; d.color = col; d.size = size
        o = bpy.data.objects.new(nm, d); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (tgt - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light('key', (0.2, ysg * 0.6, 0.5), 9, (1, 0.95, 0.9), 0.5)
    light('rim', (-0.3, -ysg * 0.4, 0.4), 12, (1, 0.6, 0.3), 0.4)
    light('fill', (0.4, ysg * 0.3, -0.2), 2, (0.7, 0.8, 1), 0.6)
    cd = bpy.data.cameras.new('cam'); cd.lens = 85
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam)
    cam.location = tgt + {'right': Vector((0, -0.95, 0.1)), 'left': Vector((0, 0.95, 0.1)), 'front': Vector((0.85, -0.35, 0.18)),
                          'top': Vector((0.05, -0.25, 0.9)), 'rear': Vector((-0.85, -0.35, 0.18))}[view]
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('WROTE', out)
