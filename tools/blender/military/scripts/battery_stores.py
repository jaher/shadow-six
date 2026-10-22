"""Atlantic Wall battery stores (M14 La Riviere art pass 2; any coastal or field battery): ammunition dumps beside the
guns and the garrisons, sized to M14's gameplay crate piles (block HIGH, drawn to the same rect and height):
 a    battery_stores_a  6 x 4 m, 1.5 m: two rows of field-grey ammunition cases under a roped tarpaulin, a pallet of
                        wicker shell baskets (Geschosskoerbe, 15 cm) and steel cartridge containers on a pallet
 b    battery_stores_b  3 x 2 m, 1.6 m: ammunition cases two high with a short case on top, a cartridge container
 c    battery_stores_c  4 x 3 m, 1.6 m: a pallet of shell baskets, cases two high, cartridge containers
Cases: planked sides with edge battens, diagonal braces and steel straps (the dock_cargo case), painted field grey or
left as bare boards. Footprint = the variant's rect. Front faces -Y (game south).
Usage: blender -b --factory-startup --python battery_stores.py -- [a|b|c] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
M.OUTROOT = os.environ.get('OUTROOT', M.OUTROOT)
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1480)
NAME = {'a': 'battery_stores_a', 'b': 'battery_stores_b', 'c': 'battery_stores_c'}[VAR]
K.begin(NAME, SEED, theater='coast')
r = K.rng()
SIZE = {'a': (6, 4), 'b': (3, 2), 'c': (4, 3)}[VAR]

PL, BAT, STR, ROPE, TARP, GREY, WICK, CYL = (bmesh.new() for _ in range(8))
DRUM, SACK, PAL, CLR = bmesh.new(), bmesh.new(), bmesh.new(), []


def case(c, s, rz=0.0, tint=None, body=None):
    """Shipping case: centre (x, y, z0 = bottom), size (w, d, h). Planked body + battens + straps + a sling."""
    x, y, z0 = c
    w, d, h = s
    co, si = math.cos(rz), math.sin(rz)

    def P(px, py, pz):
        return (x + px * co - py * si, y + px * si + py * co, z0 + pz)
    K.box_bm(PL if body is None else body, P(0, 0, h / 2), (w, d, h), rot_z=rz)
    t = 0.05
    for sx in (-1, 1):                                  # vertical edge battens (all 4 corners, both faces)
        for sy in (-1, 1):
            K.box_bm(BAT, P(sx * (w / 2 - 0.05), sy * (d / 2 + t / 2), h / 2), (0.1, t, h), rot_z=rz)
            K.box_bm(BAT, P(sx * (w / 2 + t / 2), sy * (d / 2 - 0.05), h / 2), (t, 0.1, h), rot_z=rz)
    for zz in (0.06, h - 0.06):                         # top and bottom rails round the case
        for sy in (-1, 1):
            K.box_bm(BAT, P(0, sy * (d / 2 + t / 2), zz), (w, t, 0.1), rot_z=rz)
        for sx in (-1, 1):
            K.box_bm(BAT, P(sx * (w / 2 + t / 2), 0, zz), (t, d, 0.1), rot_z=rz)
    for sy in (-1, 1):                                  # diagonal brace on the long faces
        a, b = V(P(-w / 2 + 0.1, sy * (d / 2 + t / 2), 0.1)), V(P(w / 2 - 0.1, sy * (d / 2 + t / 2), h - 0.1))
        K.beam_bm(BAT, a, b, 0.09, t)
    for k in (-1, 1):                                   # steel straps over the lid
        sx = k * w * 0.28
        K.box_bm(STR, P(sx, 0, h + 0.006), (0.04, d + 0.02, 0.012), rot_z=rz)
        for sy in (-1, 1):
            K.box_bm(STR, P(sx, sy * (d / 2 + t + 0.004), h / 2), (0.04, 0.012, h), rot_z=rz)
    CLR.append((P(0, -(d / 2 + t + 0.01), h * 0.55), rz, min(w, 1.2) * 0.6, h * 0.35))


def drum(c, rz=0.0, lying=False):
    x, y, z0 = c
    if lying:
        a = V((x - 0.42 * math.cos(rz), y - 0.42 * math.sin(rz), z0 + 0.29))
        b = V((x + 0.42 * math.cos(rz), y + 0.42 * math.sin(rz), z0 + 0.29))
    else:
        a, b = V((x, y, z0)), V((x, y, z0 + 0.88))
    K.cyl_bm(DRUM, a, b, 0.29, 16)
    for f in (0.33, 0.66):                              # rolling hoops
        p = a.lerp(b, f)
        K.cyl_bm(DRUM, p - (b - a).normalized() * 0.015, p + (b - a).normalized() * 0.015, 0.302, 16)


def pallet(c, w, d, rz=0.0):
    x, y, z0 = c
    co, si = math.cos(rz), math.sin(rz)
    for k in range(3):                                  # bearers
        py = -d / 2 + 0.06 + k * (d - 0.12) / 2
        K.box_bm(PAL, (x - py * si, y + py * co, z0 + 0.05), (w, 0.1, 0.1), rot_z=rz)
    n = max(4, int(w / 0.16))
    for k in range(n):                                  # deck boards
        px = -w / 2 + 0.06 + k * (w - 0.12) / (n - 1)
        K.box_bm(PAL, (x + px * co, y + px * si, z0 + 0.12), (0.1, d, 0.025), rot_z=rz)
    return z0 + 0.135


def sacks(c, nx, ny, layers, rz=0.0):
    x, y, z0 = c
    co, si = math.cos(rz), math.sin(rz)
    for l in range(layers):
        for i in range(nx):
            for j in range(ny):
                px = (i - (nx - 1) / 2) * 0.62 + (0.15 if l % 2 else 0)
                py = (j - (ny - 1) / 2) * 0.42
                if l and (i == nx - 1 and l % 2):
                    continue
                M.bag_bm(SACK, (x + px * co - py * si, y + px * si + py * co, z0 + l * 0.22), rz + (r.random() - 0.5) * 0.15,
                         L=0.6, W=0.4, H=0.22, r=r)


def tarp(c, w, d, h, rz=0.0):
    """Tarpaulin thrown over a stack: draped lid + skirts falling short on two sides, ropes over it."""
    x, y, z0 = c
    co, si = math.cos(rz), math.sin(rz)
    P = lambda px, py, pz: (x + px * co - py * si, y + px * si + py * co, z0 + pz)
    K.box_bm(TARP, P(0, 0, h + 0.03), (w + 0.12, d + 0.12, 0.04), rot_z=rz)
    for sy in (-1, 1):
        K.box_bm(TARP, P(0, sy * (d / 2 + 0.07), h - h * 0.3), (w + 0.1, 0.03, h * 0.62), rot_z=rz)
    K.box_bm(TARP, P(w / 2 + 0.07, 0, h - h * 0.22), (0.03, d + 0.1, h * 0.45), rot_z=rz)
    for k in (-0.3, 0.05, 0.38):
        px = k * w
        K.beam_bm(ROPE, V(P(px, -(d / 2 + 0.1), 0.15)), V(P(px, -(d / 2 + 0.1), h + 0.06)), 0.025, 0.025)
        K.beam_bm(ROPE, V(P(px, -(d / 2 + 0.1), h + 0.06)), V(P(px, d / 2 + 0.1, h + 0.06)), 0.025, 0.025)
        K.beam_bm(ROPE, V(P(px, d / 2 + 0.1, h + 0.06)), V(P(px, d / 2 + 0.1, 0.15)), 0.025, 0.025)



def basket(c):
    """Wicker shell basket (Geschosskorb) standing upright: woven body, two bands, a rope grip on the lid."""
    x, y, z0 = c
    a, b = V((x, y, z0)), V((x, y, z0 + 0.74))
    K.cyl_bm(WICK, a, b, 0.13, 6)
    for f in (0.2, 0.8):
        p = a.lerp(b, f)
        K.cyl_bm(BAT, p - V((0, 0, 0.02)), p + V((0, 0, 0.02)), 0.137, 6)
    K.beam_bm(ROPE, V((x - 0.06, y, z0 + 0.75)), V((x + 0.06, y, z0 + 0.75)), 0.03, 0.03)


def cartridge(c, lying=False, rz=0.0):
    """Steel cartridge container (Kartuschbehaelter): a painted tube with a lid ring."""
    x, y, z0 = c
    if lying:
        dx, dy = 0.5 * math.cos(rz), 0.5 * math.sin(rz)
        a, b = V((x - dx, y - dy, z0 + 0.15)), V((x + dx, y + dy, z0 + 0.15))
    else:
        a, b = V((x, y, z0)), V((x, y, z0 + 1.0))
    K.cyl_bm(CYL, a, b, 0.15, 8)
    e = (b - a).normalized()
    K.cyl_bm(STR, b - e * 0.06, b - e * 0.02, 0.162, 8)


def cases_row(x0, x1, y, d, h, layers, grey=True):
    """Ammunition cases end to end from x0 to x1, `layers` high (field grey or bare boards)."""
    for l in range(layers):
        x = x0 + (0.15 if l % 2 else 0)
        while x < x1 - 0.5:
            w = min(x1 - x, 0.95 + r.random() * 0.3)
            case((x + w / 2, y + j(0.03), l * h), (w - 0.06, d, h), j(0.03), body=GREY if grey else None)
            x += w


j = lambda a=0.06: (r.random() - 0.5) * 2 * a
if VAR == 'a':                                            # 6 x 4, 1.5 m
    cases_row(-2.9, 1.3, 1.05, 1.6, 0.68, 2)              # back rows under the tarpaulin
    tarp((-0.8, 1.05, 0), 4.2, 1.7, 1.36)
    z = pallet((-1.9, -0.95, 0), 1.9, 1.3)                 # shell baskets, 5 x 3 on a pallet
    for i in range(5):
        for k in range(3):
            basket((-2.65 + i * 0.37, -1.35 + k * 0.38, z))
    cases_row(-0.75, 0.95, -1.0, 1.0, 0.62, 2, grey=False)  # bare-board cases, two high
    case((0.1, -0.95, 1.24), (0.9, 0.8, 0.26), 0.15 + j())
    z = pallet((2.25, 0.3, 0), 1.3, 2.8)   # cartridge containers upright on a pallet, two lying on top
    for i in range(3):
        for k in range(6):
            cartridge((1.85 + i * 0.36 + (0.08 if k % 2 else 0), -0.9 + k * 0.42, z))
    cartridge((2.4, -1.6, 0), lying=True, rz=0.2)
elif VAR == 'b':                                          # 3 x 2, 1.6 m
    cases_row(-1.45, 0.75, 0.0, 1.8, 0.66, 2)
    case((-0.4, 0.05, 1.32), (1.2, 1.1, 0.28), 0.1 + j())
    z = pallet((1.12, 0.0, 0), 0.8, 1.85)
    for k in range(4):
        cartridge((0.95 + (0.3 if k % 2 else 0), -0.62 + k * 0.4, z))
elif VAR == 'c':                                          # 4 x 3, 1.6 m
    z = pallet((-1.15, -0.55, 0), 1.6, 1.7)
    for i in range(4):
        for k in range(4):
            basket((-1.7 + i * 0.37, -1.1 + k * 0.37, z))
    cases_row(-1.95, 0.8, 0.9, 1.1, 0.7, 2)
    case((-0.5, 0.9, 1.4), (1.1, 0.9, 0.2), j())
    z = pallet((1.35, -0.3, 0), 1.0, 2.2)
    for i in range(2):
        for k in range(5):
            cartridge((1.15 + i * 0.36, -1.1 + k * 0.38, z))

K.part(PL, 'boards_weathered', name='cases', grime=0.8, bisect=False, mat_tint=(0.92, 0.86, 0.74))
K.part(GREY, 'wood_paint', name='cases_grey', grime=0.7, bisect=False, mat_tint=(0.82, 0.84, 0.74))
K.part(BAT, 'timber_beam', name='battens', grime=0.9, bisect=False, mat_tint=(0.7, 0.68, 0.6))
K.part(STR, 'steel_galv', name='straps', grime=0.5, bisect=False, lod='drop')
K.part(CYL, 'steel_painted', name='cartridges', grime=0.8, bisect=False, mat_tint=(0.4, 0.44, 0.38))
for bm_, nm, mid, tint in ((WICK, 'baskets', 'hessian', (1.0, 0.88, 0.62)), (DRUM, 'drums', 'steel_painted', (0.36, 0.42, 0.34)),
                           (PAL, 'pallets', 'timber_grey', None), (TARP, 'tarp', 'canvas', (0.7, 0.68, 0.54)), (ROPE, 'ropes', 'hessian', None)):
    if bm_.faces:
        K.part(bm_, mid, name=nm, grime=0.8, bisect=False, mat_tint=tint, **({'lod': 'drop'} if nm == 'ropes' else {}))
    else:
        bm_.free()
SACK.free()
for (p, rz, w, h) in CLR[:6]:                            # weather on the front faces
    K.decal('dirt_splash', (p[0], p[1] - 0.01, p[2] - h * 0.6), (math.sin(rz), -math.cos(rz), 0), w * 1.3, h, alpha=0.6)
sw, sd = SIZE
K.footprint([(-sw / 2, -sd / 2), (sw / 2, -sd / 2), (sw / 2, sd / 2), (-sw / 2, sd / 2)], 'HIGH', 'building')
# the kit's joined-mesh collapse LOD shreds thin case boards and battens into open frames, and the per-part lodfix
# drops the basket / cartridge parts whole: these stacks are boxes and prisms, so the LODs only leave parts out —
# LOD1 without the straps, ropes and decals, LOD2 without the battens too — each kept part planar-dissolved (lossless)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'desert', 'scripts'))
import bpy
import kit_export as KE
import lodfix
_orig = KE.build_lod
LOD_DROP = {1: ('straps', 'ropes'), 2: ('straps', 'ropes', 'battens')}


def build_lod_parts(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    if level == 0:
        return _orig(level, parts)
    groups = {}
    for o in parts:
        if o.get('kit_node', 'main') == 'decals' or any(k in o.name for k in LOD_DROP[level]):
            continue
        c = KE._copy(o)
        lodfix._dissolve(c, 2.0, None)
        groups.setdefault(c.get('kit_node', 'main'), []).append(c)
    out = []
    for node, objs in groups.items():
        ob = KE.join(objs, '%s_lod%d' % (node, level))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        out.append(ob)
    return out


KE.build_lod = build_lod_parts
M.finalize(M.outdir(K.A().name), ao_res=512, ao_samples=32)
