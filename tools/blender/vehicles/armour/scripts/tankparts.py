# tankparts.py - shared tank-building helpers (hull lofts, hatches, vision ports, bogies) for pz2/pz3/pz4 scripts.
import math
import bpy, bmesh
from mathutils import Vector, Matrix
import vlib as V
from vlib import B, P

def loft_z(name, poly0, z0, poly1, z1, bevel=0.0):
    """Vertical loft between two plan polygons (x, y) with equal vertex counts (CCW from above)."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z0)) for x, y in poly0]
    b = [bm.verts.new((x, y, z1)) for x, y in poly1]
    n = len(a)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = B.obj_from_bm(name, bm)
    if bevel:
        B.add_bevel(ob, bevel, 1, angle=25)
    return ob

def side_prism(name, pts_yz, x0, x1, bevel=0.0):
    """Side-profile polygon [(y, z)] extruded from x0 to x1."""
    return B.prism(name, pts_yz, abs(x1 - x0), plane='YZ', offset=(x0 + x1) / 2, bevel=bevel, segs=1)

def plate_on(name, origin, u, v, w, h, t=0.015, bevel=0.0):
    """Thin plate in the plane spanned by unit vectors u (width) and v (height), centred at origin, pushed out
    along u x v by t/2 (so it sits on the surface)."""
    u, v = Vector(u).normalized(), Vector(v).normalized()
    n = u.cross(v).normalized()
    c = Vector(origin) + n * t / 2
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix((u * w, v * h, n * t)).transposed().to_4x4()
    M.translation = c
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    ob = B.obj_from_bm(name, bm)
    if bevel:
        B.add_bevel(ob, bevel, 1, angle=40)
    return ob

def vision_port(center, normal, w=0.2, h=0.09, node='hull', slit=True):
    """Armoured visor block with a dark slit (Sehklappe) on a surface with outward normal."""
    n = Vector(normal).normalized()
    up = Vector((0, 0, 1)) - n * n.z
    up = up.normalized() if up.length > 1e-3 else Vector((0, 1, 0))
    u = up.cross(n).normalized()
    P(plate_on('visor', center, u, up, w, h, 0.05), node, 'paint', 1)
    if slit:
        P(plate_on('visor_slit', Vector(center) + n * 0.05, u, up, w * 0.7, 0.012, 0.004, 0), node, 'black', 1)

def hinge(p0, p1, node='hull', r=0.018):
    P(B.beam('hinge', p0, p1, r * 2, r * 2), node, 'paint', 0)

def grille(center, w, d, n=6, node='hull', along='X'):
    """Louvred vent grille lying flat (engine deck / air intake): frame + slats."""
    x, y, z = center
    P(B.box('grille_fr', (w, d, 0.03), (x, y, z + 0.015), bevel=0.006, segs=1), node, 'paint', 1)
    P(B.box('grille_hole', (w * 0.9, d * 0.86, 0.01), (x, y, z + 0.031)), node, 'black', 1)
    for i in range(n):
        if along == 'X':
            yy = y - d * 0.4 + d * 0.8 * i / (n - 1)
            P(B.box('slat', (w * 0.88, 0.02, 0.012), (x, yy, z + 0.038), rot=('X', 30)), node, 'paint', 0)
        else:
            xx = x - w * 0.4 + w * 0.8 * i / (n - 1)
            P(B.box('slat', (0.02, d * 0.84, 0.012), (xx, y, z + 0.038), rot=('Y', 30)), node, 'paint', 0)

def lift_hook(p, node='hull'):
    P(B.box('hook', (0.02, 0.08, 0.06), (p[0], p[1], p[2] + 0.03)), node, 'paint', 0)

def tow_shackle(p, node='hull', rz=0.0):
    o = B.lathe('shackle', [(0.05, 0.015), (0.065, 0.0), (0.05, -0.015), (0.035, 0.0), (0.05, 0.015)], segs=6, axis='X')
    P(V._xf(o, p, rz), node, 'steel', 1)

def bogie(x, y, z, sx, node='hull', span=0.5, wz=None):
    """Pz IV leaf-spring bogie: cast bracket bolted to the hull side, two trailing arms down to the twin-wheel
    axles, quarter-elliptic leaf-spring pack (stacked leaves) between them, bump-stop pad; bolt heads as details.
    x = arm plane, y = bogie centre, z = pivot height, wz = wheel axle height."""
    wz = z - 0.135 if wz is None else wz
    xb = x - sx * 0.07
    P(V.hexa('bogie_bracket', [(xb - 0.07, y - 0.2, z - 0.02), (xb + 0.07, y - 0.2, z - 0.02), (xb + 0.07, y + 0.2, z - 0.02),
                               (xb - 0.07, y + 0.2, z - 0.02), (xb - 0.07, y - 0.13, z + 0.2), (xb + 0.07, y - 0.13, z + 0.2),
                               (xb + 0.07, y + 0.13, z + 0.2), (xb - 0.07, y + 0.13, z + 0.2)]), node, 'paint_dark', 1)
    for d in (-1, 1):
        P(B.beam('bogie_arm', (x, y + d * 0.06, z), (x, y + d * span / 2, wz), 0.075, 0.07), node, 'paint_dark', 1)
        V.D(B.cylinder('arm_pivot', 0.045, 0.1, (x, y + d * 0.06, z), 'X', 8), 'paint_dark')
    for k, (L, dz) in enumerate(((span * 0.78, 0.0), (span * 0.5, -0.03))):
        P(B.box('leaf', (0.09, L, 0.02), (x, y, z - 0.07 + dz)), node, 'steel' if k == 0 else 'paint_dark', 1 if k < 2 else 0)
    P(B.box('bumpstop', (0.08, 0.08, 0.06), (x, y, z + 0.14)), node, 'paint_dark', 0)
    V.bolt_row((xb + sx * 0.075, y - 0.12, z + 0.1), (xb + sx * 0.075, y + 0.12, z + 0.1), (sx, 0, 0), 0.08)
    V.bolt_row((xb + sx * 0.075, y - 0.16, z + 0.0), (xb + sx * 0.075, y + 0.16, z + 0.0), (sx, 0, 0), 0.08)
