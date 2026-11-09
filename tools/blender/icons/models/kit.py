# kit.py - the knapsack as ONE physical object (user 2026-11-08, after "Backpack doesn't look nice, look at original":
# "Items should be in 3d hanging from backpack"). A closed, voluminous olive-drab rucksack seen from the front (flap,
# leather straps with brass buckles, steel D-rings, side pockets) and every item the HUD can show built IN PLACE on it:
# the pistol in a holster on the left D-ring, the knife in its sheath, Mills bombs clipped to the webbing, the long gun
# hanging across the front on its sling, the first-aid pouch buckled under the pack, ... all lit by the one rig.
# Our own design (no sprite of the 1998 game copied, traced or sampled).
#
# Renders (masters/kit/): `pack` (the bare rucksack), one layer per item mount (`<item>`: the item + its strap / cord /
# holster, with the pack as a shadow catcher: its shadow on the pack, and the pack's straps in front of it cut out) and
# its silhouette mask (`<item>.mask`: the pack as a holdout, what is visible of the object alone; post_kit.py turns it
# into the hit polygon). Count layers (`round.N`, `grenade.N`, `charge.N`, `rcharge.N`) are the extra rounds / bombs /
# charges, shown one per unit. `MIRROR=1` renders the mirrored set (`*.left`) for Tab: geometry and camera mirrored,
# the key light still upper left. Frame: FRAME ref px (box 112 x 149 at BOX_AT), 1 ref px = K mm.
import sys, os, math, json, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix, noise
from guns import sl, bx, cy, MM
from tools import ring, rsec
from pack import canvas_mat, stitches, buckle_parts

K = 4.8                                  # mm per ref px
BOX = (112, 149)
FRAME = (156, 168)                       # rendered frame (ref px): the box plus room to spill left and up
BOX_AT = (44, 19)                        # the box's top-left inside the frame
PACK_AT = (55, 66)                       # box ref px of the pack's centre point PC (kit stays >= 4 ref px off the screen's edge)
PC = Vector((0, 0, 215))                 # mm
ELEV, AZIM = 13, -16                     # camera: a little above, a little from the left (the side with the holster)
MIRROR = os.environ.get('MIRROR') == '1'
SCALE = int(os.environ.get('KIT_SCALE', '6'))
OUT = os.path.join(S.MASTERS, 'kit')


def nz(x, y, z, f=1.0):
    return noise.noise(Vector((x * f, y * f, z * f)))


def se(th, a, b, n):
    c, s = math.cos(th), math.sin(th)
    return a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s)


# ---------------------------------------------------------------- the rucksack body
H = 400.0


def body_xy(th, t):
    """Plan point of the body at angle th (0 = +x, -pi/2 = the front), height fraction t: a stuffed canvas sack."""
    a = 168 + 12 * math.sin(math.pi * t) - 10 * t
    b = 74 + 20 * math.sin(math.pi * min(1.0, t * 1.1))
    n = 3.0 + 0.8 * t
    x, y = se(th, a, b, n)
    if y < 0:                                            # the front bellies out (full of kit)
        y -= 26 * math.sin(math.pi * min(1, 0.15 + t * 0.9)) * (1 - (x / a) ** 2) ** 1.3
    foot = min(1.0, t / 0.07)                            # rounded bottom edge
    k = 0.86 + 0.14 * math.sqrt(foot)
    return x * k, y * k


def body_point(th, t):
    x, y = body_xy(th, t)
    z = H * t
    if t < 0.02:
        z -= 6 * (1 - (x / 170) ** 2)
    L = math.hypot(x, y) or 1
    w = 2.2 * nz(math.cos(th) * 3, math.sin(th) * 3, t * 4) + 1.2 * nz(math.cos(th) * 9, math.sin(th) * 9, t * 9)
    fold = 3.0 * (1 - abs(math.sin(5 * th + 1.3 + 2.0 * t))) ** 6 * math.sin(math.pi * t)      # soft vertical folds
    return (x + x / L * (w + fold), y + y / L * (w + fold), z)


def body(cv):
    N, KU = 160, 26
    bm = bmesh.new()
    ths = [2 * math.pi * i / N for i in range(N)]
    rings = [[bm.verts.new(tuple(v * MM for v in body_point(th, k / KU))) for th in ths] for k in range(KU + 1)]
    for k in range(KU):
        for i in range(N):
            bm.faces.new((rings[k][i], rings[k][(i + 1) % N], rings[k + 1][(i + 1) % N], rings[k + 1][i]))
    for zz, rr in ((0, rings[0]), (H, rings[-1])):
        c = bm.verts.new((0, 0, (zz + (-4 if zz == 0 else 6)) * MM))
        for i in range(N):
            f = (c, rr[(i + 1) % N], rr[i]) if zz == 0 else (c, rr[i], rr[(i + 1) % N])
            bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('kit_body'); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new('kit_body', me)); o.data.materials.append(cv)
    for p in o.data.polygons: p.use_smooth = True
    ss = o.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
    return o


def front_y(x, z):
    """Front surface y of the body at (x, z), found by marching the plan section (mm)."""
    t = max(0.0, min(1.0, z / H))
    best = None
    for i in range(240):
        th = -math.pi + math.pi * i / 239
        px, py = body_xy(th, t)
        if best is None or abs(px - x) < abs(best[0] - x):
            best = (px, py)
    return best[1]


# ---------------------------------------------------------------- side pockets
def side_pocket(name, sx, cv, tape, leather, br):
    """A bulging pocket on the side: soft box, a small flap with a strap and buckle."""
    P = []
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        r = max(abs(x), abs(y), abs(z)) or 1
        s = Vector((x, y, z)).normalized() * 0.5
        q = Vector((x, y, z)).lerp(s * 1.25, 0.55)            # pillow
        v.co = Vector((q.x * 46, q.y * 104, q.z * 150)) * MM
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new(name, me)); o.data.materials.append(cv)
    for p in o.data.polygons: p.use_smooth = True
    o.location = (sx * 176 * MM, -6 * MM, 128 * MM)
    ss = o.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
    P.append(o)
    # pocket flap (a rounded slab over the top of the pocket) and its strap + buckle
    fl = sl(f'{name}_flap', D.chaikin([(-50, 0), (50, 0), (48, -38), (30, -52), (-30, -52), (-48, -38)], 2, True), 9, cv, bevel=3.5)
    fl.rotation_euler = (0, 0, math.radians(90)); fl.location = (sx * 201 * MM, -6 * MM, 214 * MM)
    P.append(fl)
    st = D.box(f'{name}_strap', (5 * MM, 16 * MM, 70 * MM), leather, loc=(sx * 205 * MM, -6 * MM, 178 * MM), bevel=0.8 * MM)
    P.append(st)
    for q in buckle_parts(f'{name}_bk', br, w=20, h=14, r=1.6):
        q.matrix_world = Matrix.Translation((sx * 208 * MM, -6 * MM, 160 * MM)) @ Matrix.Rotation(math.radians(90), 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'Z') @ q.matrix_world
        P.append(q)
    return P


# ---------------------------------------------------------------- the lid flap
FW, FL = 172.0, 330.0                     # half width, length along the flap from the back edge


def flap_path(s):
    """Flap centreline (y, z) at arc length s (mm) from its back edge: over the top and down the front."""
    pts = [(78, 392), (40, 418), (0, 428), (-48, 422), (-92, 398), (-112, 350), (-121, 300), (-124, 250), (-122, 215)]
    seg = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    tot = sum(seg); s = s / FL * tot
    for (a, b), L in zip(zip(pts, pts[1:]), seg):
        if s <= L:
            u = s / L
            return a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u
        s -= L
    return pts[-1]


def flap_half(s):
    rc = 52.0
    if s > FL - rc:
        d = s - (FL - rc)
        return FW - rc + math.sqrt(max(0.0, rc * rc - d * d))
    return FW


def flap_point(u, s):
    y, z = flap_path(s)
    hw = flap_half(min(s, FL - 0.2))
    x = u * hw
    # the flap follows the front bulge and curves round the sides
    curve = (1 - u * u)
    front = s > FL * 0.35
    if front:
        y -= 16 * curve
    else:
        z += 6 * curve
    edge = abs(u) ** 3
    y += 18 * edge if front else 0
    z -= 22 * edge if not front else 0
    w = 1.6 * nz(x * 0.03, s * 0.03, 2.2) + 0.8 * nz(x * 0.09, s * 0.09, 5.1)
    return (x, y + (-w if front else 0), z + (w if not front else 0))


def flap(cv, cv_in, tape, thread):
    NU, NS = 60, 70
    bm = bmesh.new()
    G = [[bm.verts.new(tuple(v * MM for v in flap_point(-1 + 2 * j / NU, FL * i / NS))) for j in range(NU + 1)] for i in range(NS + 1)]
    for i in range(NS):
        for j in range(NU):
            bm.faces.new((G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]))
    bm.normal_update()
    out = sum((f.normal.dot(Vector((0, -1, 0.6)))) for f in bm.faces)
    if out < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('kit_flap'); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new('kit_flap', me)); o.data.materials.append(cv); o.data.materials.append(cv_in)
    for p in o.data.polygons: p.use_smooth = True
    so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = 7 * MM; so.offset = -1.0; so.material_offset = 1; so.material_offset_rim = 0
    ss = o.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
    P = [o]
    edge = [flap_point(-1, FL * i / NS) for i in range(8, NS + 1)] + [flap_point(-1 + 2 * j / NU, FL) for j in range(1, NU)] + \
           [flap_point(1, FL * i / NS) for i in range(NS, 7, -1)]
    P.append(D.tube('flap_bind', [tuple(v * MM for v in p) for p in edge[::2]], 3.2 * MM, tape, segs=10, res=3))
    hem = [flap_point(-0.93, FL * i / NS) for i in range(22, NS - 4)] + [flap_point(-0.93 + 1.86 * j / 30, FL - 14) for j in range(1, 30)] + \
          [flap_point(0.93, FL * i / NS) for i in range(NS - 4, 21, -1)]
    P += stitches('flap_st', [(x, y - 3.8, z) for x, y, z in hem], thread, step=6.5, lift=0.0, normal_fn=lambda c: (0, -1, 0.15))
    return P


# ---------------------------------------------------------------- straps, buckles, D-rings, webbing
STRAP_X = (-92.0, 92.0)
STRAP_W = 30.0


def ribbon(name, pts, w, mat, th=2.4, up=(0, -1, 0)):
    """Flat strap (width w mm) along 3D mm points, its face towards `up`."""
    bm = bmesh.new(); rows = []
    U = Vector(up).normalized()
    for k, p in enumerate(pts):
        p = Vector(p)
        d = (Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])).normalized()
        side = d.cross(U).normalized()
        rows.append([bm.verts.new((p + side * (u * w / 2)) * MM) for u in (-1, 1)])
    for k in range(len(rows) - 1):
        bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
    bm.normal_update()
    if sum(f.normal.dot(U) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new(name, me)); o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = True
    so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = th * MM; so.offset = -1.0
    bv = o.modifiers.new('bev', 'BEVEL'); bv.width = 0.6 * MM; bv.segments = 2
    return o


def surf_y(x, z):
    """Front surface y (mm) of the pack at (x, z): the lid flap's face above its edge, else the body."""
    if z > 224:
        best = None
        u = x / FW if abs(x) < FW else math.copysign(0.99, x)
        for k in range(160):
            sv = FL * (0.3 + 0.7 * k / 159)
            y, zz = flap_point(u, sv)[1:]
            if best is None or abs(zz - z) < abs(best[1] - z):
                best = (y, zz)
        return best[0] - 7
    return front_y(x, z)


def surf_line(x, z0, z1, n=40, lift=4.0):
    """Points down the front of flap + body at x from z0 to z1 (mm), lifted `lift` off the surface."""
    out = []
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        if z > 222:                                    # on the flap: find s whose z matches
            best = None
            for k in range(200):
                s = FL * k / 199
                y, zz = flap_point(x / FW if abs(x) < FW else math.copysign(0.99, x), s)[1:]
                if s > FL * 0.3 and (best is None or abs(zz - z) < abs(best[1] - z)):
                    best = (y, zz)
            y = best[0] - 7 - lift
        else:
            y = front_y(x, z) - lift
        out.append((x, y, z))
    return out


def straps(leather, br):
    P = []
    for k, x in enumerate(STRAP_X):
        top = surf_line(x, 420, 228, 30, 3.0)
        # over the top of the flap from the back
        lid = [(x, flap_path(s)[0] - 4, flap_path(s)[1] + 4) for s in (20, 45, 70, 95)]
        P.append(ribbon(f'strap{k}', lid + top + surf_line(x, 222, 128, 20, 3.0), STRAP_W, leather, th=3.2))
        # buckle on a short tab sewn to the body, the tongue through it
        yb = front_y(x, 150) - 8
        for q in buckle_parts(f'sbk{k}', br, w=STRAP_W + 8, h=24, r=2.3):
            q.matrix_world = Matrix.Translation(Vector((x, yb, 152)) * MM) @ Matrix.Rotation(math.radians(90), 4, 'X') @ q.matrix_world
            P.append(q)
        P.append(ribbon(f'stab{k}', surf_line(x, 160, 100, 8, 1.5), STRAP_W - 2, leather, th=3.0))
        for zz in (196, 176):                                 # rivets on the strap above the buckle
            P.append(D.cyl(f'srv{k}{zz}', 3.2 * MM, 2.5 * MM, br, loc=(x * MM, (front_y(x, zz) - 7) * MM, zz * MM), rot=(90, 0, 0), segs=16))
    return P


def d_ring(name, loc, steel, rot=(0, 0, 0), size=22):
    """A steel D-ring (half round, half straight) at loc (mm), in the XZ plane rotated by rot (deg)."""
    pts = []
    for k in range(18):
        a = math.pi * k / 17
        pts.append((size / 2 * math.cos(a), 0, size * 0.75 * math.sin(a)))
    pts += [(-size / 2, 0, 0)]
    o = D.tube(name, [tuple(v * MM for v in p) for p in pts], 2.4 * MM, steel, segs=10, closed=True, res=3)
    o.matrix_world = Matrix.Translation(Vector(loc) * MM) @ Matrix.Rotation(math.radians(rot[2]), 4, 'Z') @ Matrix.Rotation(math.radians(rot[0]), 4, 'X') @ o.matrix_world
    return o


RINGS = {  # anchor points (mm) for hanging kit: D-rings on webbing tabs
    'left': (-196, -40, 318), 'right': (196, -40, 318), 'top': (0, -40, 438), 'lowleft': (-150, None, 70), 'lowright': (150, None, 70),
}


def hardware(web, steel, leather, br, thread):
    P = []
    for nm in ('left', 'right'):
        x, y, z = RINGS[nm]
        sx = 1 if nm == 'right' else -1
        P.append(ribbon(f'tab_{nm}', [(x - sx * 14, y + 8, z + 26), (x - sx * 6, y - 2, z + 12), (x, y - 4, z + 2)], 18, web, th=2.6, up=(sx * 0.6, -1, 0)))
        P.append(d_ring(f'dring_{nm}', (x, y - 4, z - 4), steel, rot=(0, 0, sx * -35), size=26))
    # carry loop with a D-ring on top of the flap
    x, y, z = RINGS['top']
    P.append(ribbon('tab_top', [(-16, 20, 428), (-10, -10, 440), (10, -10, 440), (16, 20, 428)], 22, web, th=2.6, up=(0, -0.3, 1)))
    P.append(d_ring('dring_top', (0, -22, 436), steel, rot=(-70, 0, 0), size=30))
    # the lower webbing strap across the front (grenades clip to it, the rounds sit in its loops)
    zz = 88
    pts = [(x, front_y(x, zz) - 3, zz + 2 * math.sin(x * 0.02)) for x in range(-176, 177, 8)]
    P.append(ribbon('lowstrap', pts, 28, web, th=2.8))
    P += stitches('lowst', [(x, y - 2.8, z + 11) for x, y, z in pts], thread, step=7, lift=0.0, normal_fn=lambda c: (0, -1, 0))
    P += stitches('lowst2', [(x, y - 2.8, z - 11) for x, y, z in pts], thread, step=7, lift=0.0, normal_fn=lambda c: (0, -1, 0))
    for sx in (-1, 1):
        P.append(d_ring(f'dring_low{sx}', (sx * 150, front_y(sx * 150, 70) - 6, 68), steel, rot=(-10, 0, 0), size=20))
    return P


def materials():
    od = M.lin((0.205, 0.20, 0.115))            # olive drab canvas (about rgb(48,47,29) after the scene's lift)
    return dict(
        cv=canvas_mat('kit_canvas', od, fade=0.32, grime=0.55, scale=0.08, wear=0.8),
        cv_in=canvas_mat('kit_canvas_in', tuple(v * 0.8 for v in od), fade=0.05, grime=0.6, scale=0.08, wear=0.4),
        tape=canvas_mat('kit_tape', M.lin((0.16, 0.15, 0.085)), fade=0.25, grime=0.4, scale=0.03, wear=1.0),
        web=canvas_mat('kit_web', M.lin((0.30, 0.28, 0.16)), fade=0.2, grime=0.5, scale=0.012, wear=0.6),
        thread=M.solid('kit_thread', M.lin((0.40, 0.38, 0.26)), rough=0.85, var=0.15, bevel=0.0001),
        leather=M.textured('kit_leather', 'brown_leather', tint=(0.46, 0.29, 0.17), scale=0.06, nstrength=1.0, coat=0.2),
        br=M.metal('kit_brass', M.lin((0.60, 0.46, 0.24)), rough=0.34, wear=0.7, wear_color=M.lin((0.86, 0.72, 0.44)), grain=0.55),
        steel=M.metal('kit_steel', M.lin((0.34, 0.34, 0.33)), rough=0.36, wear=0.8, wear_color=M.lin((0.62, 0.62, 0.62))),
    )


def rucksack(m):
    P = [body(m['cv'])]
    for sx, nm in ((-1, 'pocketL'), (1, 'pocketR')):
        P += side_pocket(nm, sx, m['cv'], m['tape'], m['leather'], m['br'])
    P += flap(m['cv'], m['cv_in'], m['tape'], m['thread'])
    P += straps(m['leather'], m['br'])
    P += hardware(m['web'], m['steel'], m['leather'], m['br'], m['thread'])
    return P


# ---------------------------------------------------------------- camera
def camera():
    cam = S.camera('front', elev=ELEV, azim=-AZIM if MIRROR else AZIM)
    R = cam.matrix_world.to_3x3(); right, up = R.col[0], R.col[1]
    d = Vector(cam['dir'])
    # frame centre in box ref px -> world point on the plane through PC
    fc = (FRAME[0] / 2 - BOX_AT[0], FRAME[1] / 2 - BOX_AT[1])
    px = PACK_AT[0] if not MIRROR else BOX[0] - PACK_AT[0]
    T = PC + right * (K * (fc[0] - px)) - up * (K * (fc[1] - PACK_AT[1]))
    if MIRROR:
        fc_m = (FRAME[0] / 2 - (FRAME[0] - BOX_AT[0] - BOX[0]), fc[1])     # the mirrored frame spills right
        T = PC + right * (K * (fc_m[0] - px)) - up * (K * (fc[1] - PACK_AT[1]))
    cam.location = (T + d * 3000) * MM
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = FRAME[0] * K * MM; cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.clip_start = 0.01; cam.data.clip_end = 10
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = FRAME[0] * SCALE, FRAME[1] * SCALE
    bpy.context.view_layer.update()
    return cam


def to_box(cam, p):
    """World mm point -> box ref px (x right, y down)."""
    R = cam.matrix_world.to_3x3(); right, up = R.col[0], R.col[1]
    q = Vector(p) - PC
    px = PACK_AT[0] if not MIRROR else BOX[0] - PACK_AT[0]
    return (px + q.dot(right) / K, PACK_AT[1] - q.dot(up) / K)


# ---------------------------------------------------------------- placing the kit
from guns import colt1911, p38, beretta, no4, thompson, speargun, cartridge303
from blades import knife as fs_knife
from tools import shovel, wire_cutters, handcuffs, hanger, lipstick, syringe, stones
from misc import mills, bear_trap, diving_gear, folded_tunic, rubber_mat
from boxes import time_bomb, remote_bomb, detonator, first_aid, cigarettes, decoy, activator, charge


def parts_of(r):
    return list(r[0] if isinstance(r, tuple) else r)


def built(fn):
    """Call a model builder; every root object it created (the parts it returns AND any group it made on the side, like
    the diving gear's mask and fin) as one part list."""
    before = set(bpy.data.objects)
    fn()
    bpy.context.view_layer.update()
    return [o for o in bpy.data.objects if o not in before and o.parent is None]


def rrect(xa, za, xb, zb, r, n=5):
    """Rounded-rectangle outline (mm) with corner radius r."""
    r = min(r, (xb - xa) / 2, (zb - za) / 2)
    out = []
    for cx, cz, a0 in ((xb - r, za + r, -90), (xb - r, zb - r, 0), (xa + r, zb - r, 90), (xa + r, za + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            out.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return out


def bbox(objs):
    pts = S._mesh_points(objs)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def meshes(root):
    return [o for o in root.children_recursive if o.type in ('MESH', 'CURVE', 'FONT')]


def mount(name, parts, canon=(0, 0, 0), size=200.0, at=(0, 0, 0), anchor='top', swing=0.0, tilt=0.0, turn=False):
    """Group `parts` (built in their model's frame), turn them to `canon` (deg XYZ: read face to -Y, up +Z), scale the
    longest side to `size` mm, put the bbox `anchor` ('top' / 'center' / 'back' / 'bottom') at `at` (mm) and swing them
    there by `swing` deg in the picture plane (hanging under gravity) and `tilt` deg about x. MIRROR: the mount is
    mirrored, the object is not (labels stay readable); `turn`: chiral kit (a gun, a knife) shows its other side so it
    still points the mirrored way."""
    root = D.group(name, parts, rot=canon)
    if MIRROR and turn:
        root.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ root.matrix_world
    bpy.context.view_layer.update()
    lo, hi = bbox(meshes(root))
    c = (lo + hi) / 2
    a = {'top': Vector((c.x, c.y, hi.z)), 'center': c, 'back': Vector((c.x, hi.y, c.z)), 'bottom': Vector((c.x, c.y, lo.z))}[anchor]
    k = size * MM / max(hi - lo)
    sw = -swing if MIRROR else swing
    A = Vector(at); A.x = -A.x if MIRROR else A.x
    T = Matrix.Translation(A * MM) @ Matrix.Rotation(math.radians(sw), 4, 'Y') @ Matrix.Rotation(math.radians(tilt), 4, 'X') @ Matrix.Scale(k, 4) @ Matrix.Translation(-a)
    root.matrix_world = T @ root.matrix_world
    bpy.context.view_layer.update()
    return root


def mx(x):
    return -x if MIRROR else x


def cord(name, a, b, mat, r=2.0, sag=6.0):
    """A cord from a to b (mm, a and b already mirrored), sagging a little."""
    a, b = Vector(a), Vector(b)
    m = (a + b) / 2 + Vector((0, -2, -sag))
    return D.tube(name, [tuple(v * MM for v in q) for q in (a, a.lerp(m, 0.5), m, m.lerp(b, 0.5), b)], r * MM, mat, segs=8, res=4)


def ring_at(nm):
    x, y, z = RINGS[nm]
    if y is None: y = front_y(x, z) - 6
    return Vector((mx(x), y - 4, z - 10))


def shell(name, objs, mat, x0=0.3, x1=1.04, z0=0.55, z1=1.03, pad=6.0, rc=0.35):
    """Leather shell (holster / sheath) over a fraction of a part list's bbox, in its build frame (profile in XZ)."""
    lo, hi = bbox(objs)
    L, Dd, Hh = (hi - lo) / MM
    xa, xb = lo.x / MM + L * x0, lo.x / MM + L * x1
    za, zb = lo.z / MM + Hh * z0, lo.z / MM + Hh * z1
    r = min(xb - xa, zb - za) * rc
    o = sl(name, rrect(xa, za, xb, zb, r), Dd + pad, mat, y=(lo.y + hi.y) / 2 / MM, bevel=3.0)
    return o


def sheath_for(name, objs, mat, x0=0.43, w0=17.0, w1=8.0):
    """Tapered leather sheath over a blade lying along +X (its axis at the bbox centre height), a welt at the throat."""
    lo, hi = bbox(objs)
    L = (hi.x - lo.x) / MM
    xa, xb, zc = lo.x / MM + L * x0, hi.x / MM + 5, (lo.z + hi.z) / 2 / MM
    pts = D.chaikin([(xa, zc - w0), (xb - 16, zc - w1), (xb, zc - 2), (xb, zc + 2), (xb - 16, zc + w1), (xa, zc + w0)], 2, True, keep=(0, 5))
    o = sl(name, pts, (hi.y - lo.y) / MM + 9, mat, y=(lo.y + hi.y) / 2 / MM, bevel=2.5)
    return o


def ties(name, root, mat, br, at_fracs=(0.3, 0.75), w=18.0, along='z'):
    """Webbing ties holding a strapped item against the pack: bands across the item at fractions of its height."""
    lo, hi = bbox(meshes(root))
    P = []
    for k, f in enumerate(at_fracs):
        z = (lo.z + (hi.z - lo.z) * f) / MM
        xa, xb = lo.x / MM - 6, hi.x / MM + 6
        y0 = lo.y / MM - 3
        pts = [(xa, surf_y(xa, z) - 2, z), (xa + 4, y0 + 2, z), ((xa + xb) / 2, y0, z), (xb - 4, y0 + 2, z), (xb, surf_y(xb, z) - 2, z)]
        P.append(ribbon(f'{name}_tie{k}', pts, w, mat, th=2.4))
    return P


def boat_roll(m):
    """The rolled-up rubber dinghy (its paddle alongside), strapped under the pack like a bedroll."""
    rub = rubber_mat('roll_rubber', M.lin((0.20, 0.21, 0.19)))
    P = []
    body = D.cyl('roll', 46 * MM, 330 * MM, rub, rot=(0, 90, 0), segs=48, bevel=6 * MM)
    P.append(body)
    for sx in (-1, 1):
        for k, r in enumerate((40, 30, 20, 10)):
            P.append(ring(f'rollend{sx}{k}', r, rsec(3.4, 3.0, 8), rub, segs=48, loc=(sx * 166 * MM, 0, 0), rot=(0, 90, 0)))
    pad = M.wood('roll_paddle', tint=(0.85, 0.62, 0.42), tex='fine_grained_wood', scale=0.2, rough=0.5, coat=0.15, stretch=(4, 1, 1))
    P.append(D.cyl('paddle_shaft', 9 * MM, 300 * MM, pad, loc=(-30 * MM, -48 * MM, 22 * MM), rot=(0, 90, 0), segs=16))
    P.append(sl('paddle_blade', D.chaikin([(120, -16), (210, -22), (232, 0), (210, 22), (120, 16)], 2, True), 6, pad, y=-48, bevel=1.5))
    for x in (-110, 110):
        P.append(ring(f'rollstrap{x}', 49, rsec(4.5, 22, 0), m['leather'], segs=48, loc=(x * MM, 0, 0), rot=(0, 90, 0)))
    return P


def stones_pouch(m):
    """A small canvas pouch of throwing stones (BCD), its neck tied, two stones showing."""
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * 46 * (1 - 0.25 * max(0, z)), y * 34, z * 50 - 6 * x * x)) * MM
    me = bpy.data.meshes.new('pouch'); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new('pouch', me)); o.data.materials.append(m['web'])
    for p in o.data.polygons: p.use_smooth = True
    P = [o]
    st = built(stones)
    g = D.group('pstones', st, loc=(0, 0, 44 * MM), scale=0.42)
    P.append(g)
    P.append(ring('pouchneck', 18, rsec(4, 6, 8), m['tape'], segs=32, loc=(0, 0, 42 * MM)))
    return P


# each mount: build (parts in the model's frame), how it sits, its hardware; z = stacking order in the HUD
def gun_holster(m, build, size, name):
    gp = built(build)
    hol = shell(f'{name}_holster', gp, m['leather'], x0=0.40, x1=1.05, z0=0.56, z1=1.04, pad=12, rc=0.3)
    root = mount(name, gp + [hol], canon=(0, 90, 0), size=size, at=(-232, -60, 292), anchor='top', swing=9, turn=True)
    lo, hi = bbox(meshes(root))
    top = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)) / MM
    rg = ring_at('left')
    strap = ribbon(f'{name}_loop', [tuple(rg + Vector((0, -2, -2))), tuple((rg + top) / 2 + Vector((0, -4, 0))), tuple(top + Vector((0, 0, -8)))], 16, m['leather'], th=3.0)
    return [root, strap]


def knife_sheath(m, name='knife'):
    kp = built(fs_knife)
    sh = sheath_for('sheath', kp, m['leather'])
    root = mount(name, kp + [sh], canon=(0, 90, 0), size=300, at=(140, surf_y(140, 312) - 16, 312), anchor='top', swing=-4, turn=True)
    return [root] + ties(name, root, m['web'], m['br'], (0.42, 0.78), w=16)


def hang(m, name, parts, ring_name, size, drop=18.0, canon=(0, 0, 0), swing=0.0, dy=-10.0, turn=False):
    rg = ring_at(ring_name)
    if ring_name == 'top':     # down the face of the lid: the item rests on the flap below its ring
        root = mount(name, parts, canon=canon, size=size, at=(0, 0, 0), anchor='center', turn=turn)
        lo, hi = bbox(meshes(root))
        zc = rg.z - drop - (hi.z - lo.z) / MM / 2
        root.matrix_world = Matrix.Translation(Vector((0, (surf_y(0, zc) - (hi.y - lo.y) / MM / 2 - 5) - (lo.y + hi.y) / 2 / MM, zc)) * MM) @ \
            Matrix.Rotation(math.radians(-swing if MIRROR else swing), 4, 'Y') @ root.matrix_world
        bpy.context.view_layer.update()
    else:
        at = rg + Vector((0, dy, -drop))
        at.x = -at.x if MIRROR else at.x      # mount() mirrors x again
        root = mount(name, parts, canon=canon, size=size, at=tuple(at), anchor='top', swing=swing, turn=turn)
    lo, hi = bbox(meshes(root))
    top = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z)) / MM
    return [root, cord(f'{name}_cord', tuple(rg), tuple(top + Vector((0, 0, -2))), m['cord'], r=2.0, sag=3.0)]


def against(m, name, parts, x, z, size, canon=(0, 0, 0), swing=0.0, gap=4.0, tie=(0.5,), turn=False, tilt=0.0):
    root = mount(name, parts, canon=canon, size=size, at=(x, surf_y(x, z) - gap, z), anchor='back', swing=swing, turn=turn, tilt=tilt)
    return [root] + (ties(name, root, m['web'], m['br'], tie) if tie else [])


LOW_Z = 88.0                              # the lower webbing strap
ROUND_X = [-150 + 17 * i for i in range(10)]
GRENADE_X = [-62 + 41 * i for i in range(5)]
CHARGE_AT = [(0, 168), (-138, 150), (112, 150), (0, 238)]


def stencil(loc, paint='dark'):
    """Where a count is painted on the kit (the HUD stencils the number there): an empty at loc (mm, world; mirrored by
    the caller), `paint` dark (on khaki, paper, wood) or light (on olive)."""
    return D.empty(f'stencil.{paint}', tuple(v * MM for v in loc))


def front_anchor(root, fz=0.3, paint='dark'):
    """A stencil anchor on the front face of a mounted item, `fz` up its height."""
    lo, hi = bbox(meshes(root))
    return stencil(((lo.x + hi.x) / 2 / MM, lo.y / MM - 1.5, (lo.z + (hi.z - lo.z) * fz) / MM), paint)


def soft_block(name, size, mat, loc=(0, 0, 0), round_=0.35, cuts=5):
    """A stuffed webbing block (pouch body): a subdivided cube pushed towards a sphere, mm."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        q = v.co.copy()
        q = q.lerp(q.normalized() * 0.5 * 1.2, round_)
        v.co = Vector((loc[0] + q.x * size[0], loc[1] + q.y * size[1], loc[2] + q.z * size[2])) * MM
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = D.link(bpy.data.objects.new(name, me)); o.data.materials.append(mat)
    for pl in o.data.polygons: pl.use_smooth = True
    ss = o.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
    return o


def aid_pouch(m):
    """First-aid pouch: a khaki webbing pouch with a press-stud flap, a white patch with the red cross on the flap; it
    rides on the lower webbing strap. Front face to -Y, mm."""
    web = canvas_mat('aid_web', M.lin((0.40, 0.36, 0.21)), fade=0.2, grime=0.45, scale=0.03, wear=0.7)
    white = M.solid('aid_white', M.lin((0.78, 0.76, 0.68)), rough=0.85, var=0.18, vscale=90.0, bump=0.15)
    red = M.solid('aid_red', M.lin((0.58, 0.06, 0.05)), rough=0.8, var=0.12, vscale=90.0, bump=0.1)
    P = [soft_block('aid_body', (150, 58, 118), web)]
    P.append(sl('aid_flap', D.chaikin([(-78, 62), (78, 62), (78, 8), (60, -6), (-60, -6), (-78, 8)], 2, True), 8, web, y=-30, bevel=3.0))
    P.append(D.cyl('aid_stud', 6 * MM, 3 * MM, m['br'], loc=(0, -35.5 * MM, 4 * MM), rot=(90, 0, 0), segs=24, bevel=1.0 * MM))
    P.append(D.box('aid_patch', (52 * MM, 1.2 * MM, 46 * MM), white, loc=(0, -35 * MM, 32 * MM), bevel=0.8 * MM))
    P.append(D.box('aid_crossv', (11 * MM, 1.4 * MM, 34 * MM), red, loc=(0, -35.7 * MM, 32 * MM), bevel=0.3 * MM))
    P.append(D.box('aid_crossh', (34 * MM, 1.4 * MM, 11 * MM), red, loc=(0, -35.7 * MM, 32 * MM), bevel=0.3 * MM))
    return P


def mag_pouch(m):
    """A three-cell webbing magazine pouch (the SMG's 20-round sticks), its flaps buttoned. Front face to -Y, mm."""
    web = canvas_mat('mag_web', M.lin((0.26, 0.26, 0.15)), fade=0.25, grime=0.5, scale=0.03, wear=0.7)
    P = []
    for k, x in enumerate((-34, 0, 34)):
        P.append(soft_block(f'mag{k}', (32, 30, 120), web, loc=(x, 0, 0), round_=0.3, cuts=3))
        P.append(sl(f'magflap{k}', D.chaikin([(x - 16, 62), (x + 16, 62), (x + 16, 30), (x, 22), (x - 16, 30)], 1, True), 5, web, y=-17, bevel=1.6))
        P.append(D.cyl(f'magbtn{k}', 3.5 * MM, 2.5 * MM, m['br'], loc=(x * MM, -20 * MM, 30 * MM), rot=(90, 0, 0), segs=16, bevel=0.6 * MM))
    return P


def pouch_on(m, name, parts, x, z, size, fz, paint, swing=0.0):
    root = mount(name, parts, size=size, at=(x, front_y(x, z) - 3, z), anchor='back', swing=swing)
    return [root, front_anchor(root, fz, paint)]


def smg_pouch(m):
    """The SMG's magazine pouch on the lower webbing (its burst count stencilled on it)."""
    root = mount('smg_pouch', mag_pouch(m), size=120, at=(-118, front_y(-118, 98) - 3, 98), anchor='back', swing=3)
    return [root, front_anchor(root, 0.32, 'light')]


def lee_with_mark(m):
    P = long_gun(m, 'leeEnfield', lambda: no4(False), 540)
    lo, hi = bbox(meshes(P[0]))
    L = hi - lo
    x = lo.x + L.x * (0.16 if not MIRROR else 0.84)
    P.append(stencil((x / MM, lo.y / MM - 2, (lo.z + L.z * 0.3) / MM), 'light'))     # on the butt
    return P


def long_gun(m, name, build, size, swing=-21):
    gp = built(build)
    root = mount(name, gp, size=size, at=(-34, -150, 222), anchor='center', swing=swing, turn=True)
    lo, hi = bbox(meshes(root))
    # the sling: from the butt and the fore-end up to the side D-rings
    L = hi - lo
    butt = Vector((lo.x + L.x * (0.12 if not MIRROR else 0.88), (lo.y + hi.y) / 2, lo.z + L.z * 0.25)) / MM
    fore = Vector((lo.x + L.x * (0.72 if not MIRROR else 0.28), (lo.y + hi.y) / 2, lo.z + L.z * 0.72)) / MM
    P = [root, ribbon(f'{name}_sling0', [tuple(butt), tuple((butt + ring_at('left')) / 2 + Vector((0, -6, -12))), tuple(ring_at('left'))], 16, m['web'], th=2.4),
         ribbon(f'{name}_sling1', [tuple(fore), tuple((fore + ring_at('right')) / 2 + Vector((0, -8, -6))), tuple(ring_at('right'))], 16, m['web'], th=2.4)]
    return P


def rounds_loops(m):
    """The sniper's bandolier: a leather loop for each round on the lower strap."""
    P = []
    for i, x in enumerate(ROUND_X):
        y = front_y(x, LOW_Z) - 6
        P.append(ring(f'loop{i}', 7.5, rsec(1.6, 12, 0), m['leather'], segs=24, loc=(mx(x) * MM, y * MM, LOW_Z * MM), rot=(0, 0, 0)))
    return P


MOUNTS = {
    # item id: (build(m) -> objects, z)
    'pistol.colt1911': (lambda m: gun_holster(m, colt1911, 250, 'pistol.colt1911'), 9),
    'pistol.p38': (lambda m: gun_holster(m, p38, 250, 'pistol.p38'), 9),
    'beretta': (lambda m: gun_holster(m, beretta, 205, 'beretta'), 9),
    'knife': (lambda m: knife_sheath(m), 6),
    'sniperRifle': (lambda m: long_gun(m, 'sniperRifle', lambda: no4(True), 540) + rounds_loops(m)
                    + [stencil((mx(ROUND_X[-1] + 26), front_y(ROUND_X[-1] + 26, LOW_Z) - 4.5, LOW_Z))], 10),
    'leeEnfield': (lambda m: lee_with_mark(m), 10),
    'smg': (lambda m: long_gun(m, 'smg', thompson, 440, -17) + smg_pouch(m), 10),
    'harpoon': (lambda m: long_gun(m, 'harpoon', speargun, 540, -19), 10),
    'shovel': (lambda m: against(m, 'shovel', built(shovel), -128, 215, 330, canon=(0, 90, 0), swing=5, tie=(0.3, 0.7), turn=True), 5),
    'wireCutters': (lambda m: hang(m, 'wireCutters', built(wire_cutters), 'right', 230, canon=(0, 90, 0), swing=-6, turn=True), 6),
    'decoy': (lambda m: hang(m, 'decoy', built(decoy), 'top', 118, drop=26, swing=4), 7),
    'decoyActivator': (lambda m: hang(m, 'decoyActivator', built(activator), 'top', 100, drop=26, swing=-5), 7),
    'detonator': (lambda m: hang(m, 'detonator', built(detonator), 'right', 120, drop=24, swing=-7), 7),
    'detonator@charge': (lambda m: against(m, 'detonator@charge', built(detonator), *CHARGE_AT[0], 118, tie=(0.3,)), 4),
    'timeBomb': (lambda m: (lambda P: P + [front_anchor(P[0], 0.2)])(against(m, 'timeBomb', built(time_bomb), *CHARGE_AT[0], 150, canon=(90, 0, 0), swing=-3, tie=(0.5,))), 4),
    'remoteBomb': (lambda m: (lambda P: P + [front_anchor(P[0], 0.2)])(against(m, 'remoteBomb', built(remote_bomb), *CHARGE_AT[0], 150, canon=(90, 0, 0), swing=3, tie=(0.5,))), 4),
    'grenade': (lambda m: grenade_at(m, 'grenade', 0) + [stencil((mx(GRENADE_X[4] + 34), front_y(GRENADE_X[4] + 34, LOW_Z) - 4.5, LOW_Z))], 5),
    'bearTrap': (lambda m: against(m, 'bearTrap', built(bear_trap), -34, 338, 190, canon=(90, 0, 0), swing=6, tie=(0.5,)), 6),   # strapped open on the lid
    'firstAid': (lambda m: pouch_on(m, 'firstAid', aid_pouch(m), 82, 116, 150, 0.22, 'dark'), 5),
    'divingGear': (lambda m: hang(m, 'divingGear', built(diving_gear), 'top', 220, drop=22, canon=(90, 0, 0), swing=-5), 7),
    'inflatableBoat': (lambda m: [mount('inflatableBoat', boat_roll(m), size=380, at=(0, 6, 426), anchor='bottom')], 3),   # rolled on top of the lid
    'uniform': (lambda m: against(m, 'uniform', built(folded_tunic), 0, 318, 270, canon=(90, 0, 0), tie=(0.5,)), 5),
    'lethalInjection': (lambda m: against(m, 'lethalInjection', built(syringe), 132, 240, 230, canon=(0, 90, 0), swing=-4, tie=(0.5,), turn=True), 6),
    'handcuffs': (lambda m: against(m, 'handcuffs', built(handcuffs), -22, 66, 150, canon=(90, 0, 0), swing=4, tie=None), 6),   # clipped across the webbing
    'hanger': (lambda m: [mount('hanger', built(hanger), size=250, at=(92, -60, 452), anchor='top', swing=-14)], 8),
    'stones': (lambda m: hang(m, 'stones', stones_pouch(m), 'lowright', 105, drop=14, swing=-5), 6),
    'cigarettes': (lambda m: against(m, 'cigarettes', built(cigarettes), 64, 372, 92, swing=-8, tie=(0.62,)) + [stencil((mx(64), surf_y(64, 318) - 3, 318), 'light')], 7),
    'lipstick': (lambda m: against(m, 'lipstick', built(lipstick), 64, 372, 72, swing=-14, tie=(0.5,)), 7),
}


def grenade_at(m, name, i):
    """A Mills bomb hung by its lever from the lower webbing strap (a steel snap through the ring)."""
    gp = built(mills)
    x = GRENADE_X[i]
    root = mount(name, gp, canon=(0, 0, 200), size=96, at=(x, front_y(x, LOW_Z) - 30, LOW_Z + 8), anchor='top', swing=(-1) ** i * 4)
    return [root]


COUNTS = {  # extra units shown one per round / bomb / charge (the item's own layer is the first)
    **{f'round.{i + 1}': (lambda m, i=i: [mount(f'round.{i + 1}', built(cartridge303), size=78, at=(ROUND_X[i], front_y(ROUND_X[i], LOW_Z) - 8, LOW_Z - 22), anchor='bottom', swing=(i % 3 - 1) * 2)], 3) for i in range(10)},
    **{f'grenade.{i + 1}': (lambda m, i=i: grenade_at(m, f'grenade.{i + 1}', i), 5) for i in range(1, 5)},
    **{f'charge.{i + 1}': (lambda m, i=i: against(m, f'charge.{i + 1}', charge_parts(), *CHARGE_AT[i], 150, canon=(90, 0, 0), swing=(-1) ** i * 5, tie=(0.5,)), 4) for i in range(1, 4)},
}


def charge_parts():
    return built(lambda: charge([]))


# ---------------------------------------------------------------- rendering
def render_layers(names, preview=False):
    m = materials()
    m['cord'] = M.solid('kit_cord', M.lin((0.36, 0.32, 0.21)), rough=0.85, var=0.25, vscale=300.0, bump=0.2, spec=0.2)
    pack = rucksack(m)
    proot = D.group('kit', pack)
    if MIRROR: proot.scale = (-1, 1, 1)
    bpy.context.view_layer.update()
    cam = camera()
    S.lights(cam, S.subjects(), key=1.3, fill=0.2, rim=0.45, top=0.04, key_size=0.5, key_elev=0.25)
    # warm bounce from the ground in front of / under the pack (not seen)
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0, -0.3, -0.24))
    gnd = bpy.context.active_object; gnd.name = 'bounce_ground'
    gm = bpy.data.materials.new('bounce_ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.13, 0.07, 1)
    gnd.data.materials.append(gm); gnd.visible_camera = False
    pack_objs = [o for o in proot.children_recursive] + [proot]
    layers = {}
    table = {**MOUNTS, **COUNTS}
    for nm in names:
        if nm == 'pack' or nm not in table: continue
        before = set(bpy.data.objects)
        table[nm][0](m)
        allo = [o for o in bpy.data.objects if o not in before]
        layers[nm] = allo
        for o in allo: o.hide_render = True
    sc = bpy.context.scene
    os.makedirs(OUT, exist_ok=True)
    suf = '.left' if MIRROR else ''
    n0 = sc.cycles.samples
    meta = {}
    def out(name, kind=''):
        return os.path.join(OUT, f'{name}{suf}{kind}.png')
    if preview:   # everything at once (composition check)
        for allo in layers.values():
            for o in allo: o.hide_render = False
        sc.render.filepath = out('preview')
        bpy.ops.render.render(write_still=True)
        return
    if 'pack' in names:
        sc.render.filepath = out('pack')
        bpy.ops.render.render(write_still=True)
        meta['pack'] = dict(z=0)
    if 'pack' in names or 'pack.catcher' in names:
        # the pack's own shadows as the shadow catcher sees them with no kit on it: post_kit.py divides them out of each
        # layer, so a layer keeps only the shadow its item casts on the pack
        for o in pack_objs:
            if o.type in ('MESH', 'CURVE'): o.is_shadow_catcher = True
        sc.render.filepath = out('pack', '.catcher')
        bpy.ops.render.render(write_still=True)
        for o in pack_objs:
            if o.type in ('MESH', 'CURVE'): o.is_shadow_catcher = False
    for nm, allo in layers.items():
        for o in allo: o.hide_render = False
        for o in pack_objs:
            if o.type in ('MESH', 'CURVE'): o.is_shadow_catcher = True
        sc.cycles.samples = n0
        sc.render.filepath = out(nm)
        bpy.ops.render.render(write_still=True)
        # the silhouette: the object alone where it is seen (the pack a holdout), for the hit polygon
        for o in pack_objs:
            if o.type in ('MESH', 'CURVE'): o.is_shadow_catcher = False; o.is_holdout = True
        sc.cycles.samples = 8; sc.cycles.use_denoising = False
        sc.render.filepath = out(nm, '.mask')
        bpy.ops.render.render(write_still=True)
        sc.cycles.use_denoising = True
        for o in pack_objs:
            if o.type in ('MESH', 'CURVE'): o.is_holdout = False
        for o in allo: o.hide_render = True
        meta[nm] = dict(z=table[nm][1])
        from bpy_extras.object_utils import world_to_camera_view
        for o in allo:
            if o.type == 'EMPTY' and o.name.startswith('stencil'):
                co = world_to_camera_view(sc, cam, o.matrix_world.translation)
                meta[nm]['anchor'] = [round(co.x * FRAME[0] * SCALE, 1), round((1 - co.y) * FRAME[1] * SCALE, 1)]
                meta[nm]['paint'] = o.name.split('.')[1]
        print('SHOT', out(nm))
    mp = os.path.join(OUT, f'layers{suf}.json')
    old = json.load(open(mp)) if os.path.exists(mp) else {}
    old.update(meta)
    json.dump(dict(old, _frame=dict(frame=FRAME, box_at=BOX_AT if not MIRROR else [FRAME[0] - BOX_AT[0] - BOX[0], BOX_AT[1]], box=BOX, scale=SCALE)), open(mp, 'w'), indent=1)


@S.shot('kit')
def _kit(mode):
    """KIT_LAYERS=pack,pistol.colt1911,... (default: all); KIT_PREVIEW=1: one render of the listed kit on the pack."""
    want = os.environ.get('KIT_LAYERS', '')
    names = want.split(',') if want else ['pack'] + list(MOUNTS) + list(COUNTS)
    render_layers(names, preview=os.environ.get('KIT_PREVIEW') == '1')
