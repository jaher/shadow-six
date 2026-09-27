# blades.py - Fairbairn-Sykes knife (item + cursor). Built along +X (point at +X), laid flat, profile up.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector


def fs_blade(L=0.175, w0=0.0145, t0=0.005):
    """Double-edged dagger blade: diamond section, straight taper to the point, short ricasso."""
    bm = bmesh.new(); rows = []
    n = 24
    for i in range(n + 1):
        u = i / n; x = u * L
        w = w0 * (1 - u) ** 0.92 if u > 0.06 else w0 * (1 - 0.06) ** 0.92
        t = t0 * (1 - u) ** 0.8 if u > 0.06 else t0 * 0.94 ** 0.8
        if i == n: w = t = 0.0
        rows.append([bm.verts.new((x, 0, w)), bm.verts.new((x, t, 0)), bm.verts.new((x, 0, -w)), bm.verts.new((x, -t, 0))])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            q = (a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k])
            if len(set(q)) == 4 and (b[k].co - b[(k + 1) % 4].co).length > 1e-9: bm.faces.new(q)
            else: bm.faces.new((a[k], a[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0][::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def knife():
    steel = M.metal('fs_steel2', M.lin((0.50, 0.51, 0.53)), rough=0.24, wear=1.0, wear_color=M.lin((0.92, 0.92, 0.94)), wear_rough=0.08, bevel=0.0007)
    brass = M.metal('fs_brass', M.lin((0.52, 0.42, 0.25)), rough=0.36, wear=0.7, wear_color=M.lin((0.80, 0.70, 0.48)))
    blade = D.from_bm('blade', fs_blade(), steel, bevel=0.00025, segs=2, angle=20)
    guard = D.lathe('guard', [(0, -0.0015), (0.006, -0.0016), (0.0068, -0.0012), (0.0068, 0.0012), (0.006, 0.0016), (0, 0.0015)], steel, segs=48, bevel=0.0)
    guard.scale = (1.0, 5.6, 1.0); guard.rotation_euler = (0, math.radians(90), 0); guard.location = (-0.0015, 0, 0)
    guard.scale = (5.6, 1.0, 1.0)   # after rotation: local X becomes world -Z -> oval tall in Z
    # grip: ringed "bottle" (lathe along -X)
    prof = []
    for i in range(0, 121):
        u = i / 120; z = -0.003 - u * 0.108
        base = 0.0078 + 0.0052 * math.sin(math.pi * min(1, u * 1.15)) ** 0.8 if u < 0.87 else 0.0082
        ring = 0.0011 * (0.5 + 0.5 * math.cos(u * 2 * math.pi * 15)) ** 3 if 0.02 < u < 0.86 else 0
        prof.append((base + ring, z))
    prof = [(0, -0.003)] + prof + [(0.0086, -0.1125), (0.0098, -0.116), (0.0098, -0.12), (0.0078, -0.1235), (0, -0.1245)]
    grip = D.lathe('grip', prof, brass, segs=64, bevel=0.0)
    grip.rotation_euler = (0, math.radians(90), 0)   # local +Z -> world +X ; profile z was negated -> grip extends to -X
    grip.location = (0, 0, 0)
    return [blade, guard, grip]


@S.shot('knife')
def _knife(mode):
    parts = knife()
    root = D.group('knife', parts, rot=(0, -24, 0) if mode == 'item' else (90, 0, 0))   # item: upright, point up-right
    D.hot((0.175, 0, 0), parent=root)
    if mode == 'item':
        S.shoot('knife', 'item', box=(48, 26))
