"""Dock cargo stacks (M13 Le Havre quays; reusable at any port, depot or railhead):
 a    dock_cargo_a    3 x 3 m: two battened shipping cases side by side, a smaller case on top, a pallet under them
 b    dock_cargo_b    4 x 3 m: a pallet of jute sacks, two cases and a pair of oil drums
 c    dock_cargo_c    4 x 5 m: a big machinery case on skids, crates beside it, half covered by a roped tarpaulin
 row  dock_cargo_row  15 x 2 m: the barrel-and-crate row along a quay edge, crate stacks between drum clusters
Cases: planked sides with edge battens and diagonal braces, steel corner straps, rope lifting slings, stencil panels.
Footprint = the variant's rect (LOW). Front faces -Y (game south).
Usage: blender -b --factory-startup --python dock_cargo.py -- [a|b|c|row] [seed]"""
import sys, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1361)
NAME = {'a': 'dock_cargo_a', 'b': 'dock_cargo_b', 'c': 'dock_cargo_c', 'd': 'dock_cargo_d', 'e': 'dock_cargo_e', 'f': 'dock_cargo_f', 'row': 'dock_cargo_row'}[VAR]
K.begin(NAME, SEED, theater='coast')
r = K.rng()
SIZE = {'a': (3, 3), 'b': (4, 3), 'c': (4, 5), 'd': (4, 2), 'e': (3, 5), 'f': (3, 3), 'row': (15, 2)}[VAR]

PL, BAT, STR, ROPE, TARP = (bmesh.new() for _ in range(5))
DRUM, SACK, PAL, CLR = bmesh.new(), bmesh.new(), bmesh.new(), []


def case(c, s, rz=0.0, tint=None):
    """Shipping case: centre (x, y, z0 = bottom), size (w, d, h). Planked body + battens + straps + a sling."""
    x, y, z0 = c
    w, d, h = s
    co, si = math.cos(rz), math.sin(rz)

    def P(px, py, pz):
        return (x + px * co - py * si, y + px * si + py * co, z0 + pz)
    K.box_bm(PL, P(0, 0, h / 2), (w, d, h), rot_z=rz)
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


j = lambda a=0.06: (r.random() - 0.5) * 2 * a
if VAR == 'a':
    z = pallet((0, 0.05, 0), 2.7, 1.25)
    case((-0.68, 0.05, z), (1.25, 1.15, 1.0), j())
    case((0.68, 0.0, z), (1.2, 1.2, 0.95), j())
    case((-0.2, 0.1, z + 1.0), (1.3, 1.0, 0.62), 0.12 + j())
    case((0.6, -1.0, 0), (0.9, 0.75, 0.7), -0.25)
    drum((1.1, 1.05, 0))
elif VAR == 'b':
    z = pallet((-1.0, 0.35, 0), 1.6, 1.25)
    sacks((-1.0, 0.35, z), 2, 3, 3)
    case((0.85, 0.5, 0), (1.5, 1.2, 1.1), j())
    case((0.95, 0.45, 1.1), (1.0, 0.9, 0.55), 0.2)
    case((0.6, -0.95, 0), (1.1, 0.8, 0.65), -0.1)
    drum((-1.55, -1.05, 0)); drum((-0.95, -1.15, 0), 0.4, lying=True)
elif VAR == 'c':
    for sx in (-0.8, 0.8):
        K.box_bm(PAL, (sx, 0.6, 0.08), (0.18, 3.6, 0.16))     # skids under the machinery case
    case((0, 0.6, 0.16), (2.6, 3.3, 1.45), 0.0)
    tarp((0, 1.1, 0.16), 2.7, 2.3, 1.45)
    case((1.55, -1.75, 0), (0.85, 0.8, 0.8), 0.1)
    case((-1.2, -1.85, 0), (1.3, 0.9, 0.75), -0.05)
    drum((0.35, -1.95, 0))
elif VAR == 'd':                                           # 4 x 2: a long case, a crate and a drum in a line
    case((-0.75, 0.0, 0), (2.2, 1.3, 1.0), j())
    case((-0.85, 0.05, 1.0), (1.4, 1.0, 0.55), 0.08 + j())
    case((1.0, 0.1, 0), (1.0, 1.0, 0.8), j(0.15))
    drum((1.6, -0.55, 0))
elif VAR == 'e':                                          # 3 x 5: two cases end to end on a pallet, sacks and drums
    z = pallet((0.2, 0.9, 0), 2.6, 1.3, rz=math.pi / 2)
    case((0.2, 1.5, z), (1.25, 1.2, 1.05), math.pi / 2 + j())
    case((0.2, 0.3, z), (1.2, 1.1, 0.9), math.pi / 2 + j())
    case((0.25, 0.85, z + 1.05), (1.0, 1.3, 0.5), math.pi / 2 + 0.1)
    sacks((-0.35, -1.6, 0), 2, 2, 2, rz=math.pi / 2)
    drum((0.85, -1.2, 0)); drum((0.85, -1.85, 0)); drum((0.25, -2.0, 0), 1.2, lying=True)
elif VAR == 'f':                                           # 3 x 3: drums on a pallet, a sack pile, one tall case
    z = pallet((-0.6, -0.55, 0), 1.6, 1.25)
    for dx, dy in ((-0.95, -0.85), (-0.3, -0.85), (-0.95, -0.25), (-0.3, -0.25)):
        drum((dx, dy, z))
    sacks((-0.65, 0.95, 0), 2, 2, 2)
    case((0.85, 0.2, 0), (1.1, 1.6, 1.35), j(0.1))
    drum((0.95, -1.1, 0), 0.3, lying=True)
else:                                                     # row: alternate crate stacks and drum clusters along X
    x = -7.1
    k = 0
    while x < 7.0:
        if k % 2 == 0:
            w = 1.3 + r.random() * 0.4
            case((x + w / 2, j(0.1), 0), (w, 1.1, 0.9 + r.random() * 0.25), j(0.08))
            if r.random() < 0.6:
                case((x + w / 2 + j(0.1), j(0.1), 1.0), (w * 0.7, 0.9, 0.45), j(0.15))
            x += w + 0.25
        else:
            for dx, dy in ((0.3, -0.33), (0.3, 0.33), (0.92, 0.0)):
                if x + dx + 0.3 < 7.4:
                    drum((x + dx, dy + j(0.04), 0))
            x += 1.5
        k += 1

K.part(PL, 'boards_weathered', name='cases', grime=0.8, bisect=False, mat_tint=(0.92, 0.86, 0.74))
K.part(BAT, 'timber_beam', name='battens', grime=0.9, bisect=False, mat_tint=(0.82, 0.74, 0.62))
K.part(STR, 'steel_galv', name='straps', grime=0.5, bisect=False, lod='drop')
if DRUM.faces:
    K.part(DRUM, 'steel_painted', name='drums', grime=0.9, bisect=False, mat_tint=(0.36, 0.42, 0.34), smooth=True)
else:
    DRUM.free()
if PAL.faces:
    K.part(PAL, 'timber_grey', name='pallets', grime=0.9, bisect=False)
else:
    PAL.free()
if SACK.faces:
    M.sandbags_part(SACK, name='sacks', tint=(0.78, 0.68, 0.5))
else:
    SACK.free()
if TARP.faces:
    K.part(TARP, 'canvas', name='tarp', grime=0.8, bisect=False, mat_tint=(0.42, 0.44, 0.36))
    K.part(ROPE, 'hessian', name='ropes', grime=0.4, bisect=False, lod='drop')
else:
    TARP.free(); ROPE.free()
for (p, rz, w, h) in CLR[:6]:                            # weather on the front faces
    K.decal('dirt_splash', (p[0], p[1] - 0.01, p[2] - h * 0.6), (math.sin(rz), -math.cos(rz), 0), w * 1.3, h, alpha=0.6)
sw, sd = SIZE
K.footprint([(-sw / 2, -sd / 2), (sw / 2, -sd / 2), (sw / 2, sd / 2), (-sw / 2, sd / 2)], 'LOW', 'building')
M.finalize(M.outdir(K.A().name), ao_res=512, ao_samples=32)
