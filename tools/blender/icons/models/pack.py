# pack.py - the knapsack face the item icons are laid on (menus-art-direction §3: webbing, brass, leather): olive
# canvas rucksack with a stitched body, a rounded top flap on two leather straps with brass buckles, D-rings.
# 1 unit = 1 ref px = 1 mm; faces -Y (front ortho camera). Box 112 x 149 ref px.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector
from guns import sl, bx, cy, MM
from tools import ring, rsec, brass_mat


def canvas():
    return M.textured('pack_canvas3', 'hessian_230', tint=(0.21, 0.25, 0.10), scale=0.012, nstrength=1.1, sheen=0.35, rough_add=0.12)


def stitch_line(name, pts, mat, step=3.2, closed=False):
    """Row of raised stitches along a 2D polyline (x, z) on the front face (y)."""
    P = []; segs = list(zip(pts, pts[1:] + (pts[:1] if closed else [])))
    k = 0
    for (x0, z0), (x1, z1) in segs:
        L = math.hypot(x1 - x0, z1 - z0); n = max(1, int(L / step)); a = math.degrees(math.atan2(z1 - z0, x1 - x0))
        for i in range(n):
            t = (i + 0.5) / n
            P.append(D.box(f'{name}{k}', (1.8 * MM, 0.6 * MM, 0.55 * MM), mat, loc=((x0 + (x1 - x0) * t) * MM, -9.6 * MM, (z0 + (z1 - z0) * t) * MM),
                           rot=(0, -a, 0), bevel=0.2 * MM)); k += 1
    return P


def rucksack():
    cv = canvas()
    thread = M.solid('pack_thread2', M.lin((0.62, 0.58, 0.38)), rough=0.8, var=0.1)
    lt = M.textured('pack_leather', 'brown_leather', tint=(0.55, 0.36, 0.22), scale=0.03, nstrength=1.0, coat=0.25)
    br = brass_mat()
    P = []
    body = [(-54, -72), (54, -72), (56, 30), (54, 48), (44, 60), (-44, 60), (-54, 48), (-56, 30)]
    b = sl('body', D.chaikin(body, 3, True), 18, cv, bevel=6, segs=4)
    b.location.y = 0.0; P.append(b)
    P += stitch_line('bst', [(x * 0.925, z * 0.94 - 1.5) for x, z in D.chaikin(body, 3, True)], thread, closed=True)
    # top flap: rounded, overlapping the body, its own seam
    flap = [(-50, 38), (50, 38), (52, 50), (46, 60), (34, 66), (-34, 66), (-46, 60), (-52, 50)]
    f = sl('flap', D.chaikin(flap, 3, True), 8, cv, y=-10 * 1.0, bevel=3.5, segs=4)
    P.append(f)
    P += stitch_line('fst', [(x * 0.9, z * 0.92 + 3.5) for x, z in D.chaikin(flap, 3, True)], thread, closed=True)
    for sx in (-1, 1):     # leather straps from the flap down onto the body, brass buckles
        x = sx * 30
        # the straps close the flap on its lower edge: buckles sit on the flap, the pack body below stays free for the kit
        P.append(bx(f'strap{sx}', x - 4.5, 38, x + 4.5, 62, 2.2, lt, y=-15.5, bevel=0.8))
        P.append(bx(f'tip{sx}', x - 4.5, 34.5, x + 4.5, 42, 2.4, lt, y=-15.6, bevel=1.5))
        fr = ring(f'buckle{sx}', 5.0, rsec(1.5, 1.3, 8), br, segs=32, loc=(x * MM, -17.2 * MM, 45 * MM), rot=(90, 0, 0))
        fr.scale = (1.1, 1.0, 0.8); P.append(fr)
        P.append(cy(f'prong{sx}', 0.6, 8, br, x, -17.6, 45, 'Z', 12, 0.2))
        P.append(bx(f'keeper{sx}', x - 5.5, 52, x + 5.5, 55.5, 2.8, lt, y=-16.0, bevel=0.8))
    return P


@S.shot('pack')
def _pack(mode):
    D.group('pack', rucksack())
    S.shoot('pack', 'tool', box=(112, 149), preset='front', elev=0, margin=0.0, shadow=False, scale=6,
            extra={'nocrop': True, 'tiers': [2, 3, 4], 'edge_light': 0.0}, light={'rim': 0.35, 'fill': 0.3})


@S.shot('tag')
def _tag(mode):
    """Count badge: a stamped brass tag with a rivet at each end (CSS border-image stretches the plain middle)."""
    br = M.metal('tag_brass', M.lin((0.74, 0.57, 0.30)), rough=0.3, wear=0.9, wear_color=M.lin((0.95, 0.84, 0.58)), grain=0.6)
    dk = M.solid('tag_rivet_dark', M.lin((0.10, 0.08, 0.05)), rough=0.5)
    P = [sl('plate', D.chaikin([(-23, -9), (23, -9), (23, 9), (-23, 9)], 3, True), 1.6, br, bevel=0.5, plane='XY')]
    for sx in (-1, 1):
        P.append(D.lathe(f'rivet{sx}', [(0, 0), (2.2 * MM, 0), (1.8 * MM, 1.0 * MM), (0, 1.4 * MM)], br, segs=24, loc=(sx * 19 * MM, 0, 0.8 * MM)))
        P.append(ring(f'rim{sx}', 2.6, rsec(0.6, 0.4, 6), dk, segs=24, loc=(sx * 19 * MM, 0, 0.81 * MM)))
    D.group('tagg', P, rot=(90, 0, 0))
    S.shoot('tag', 'tool', box=(24, 9), preset='front', elev=0, margin=0.0, shadow=False, scale=16,
            extra={'nocrop': True, 'tiers': [2, 3, 4, 6], 'halo': [0.5, 0.6]}, light={'rim': 0.5})
