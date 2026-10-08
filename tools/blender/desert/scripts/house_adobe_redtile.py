"""Egyptian coast adobe row house with a red-tile pent roof (M8 Tell el Eisa, the five hideout houses S of the depot;
building-inventory `house_adobe_redtile`): 6 x 5 m, mud-brick walls under a worn mud render (some lime-washed, some
with a whitened dado), a mono-pitch roof of pantiles on palm-log rafters falling from 3.95 m (N) to 3.2 m (S) with
stepped mud verges, palm-wood lintels, shuttered windows with blue-washed surrounds, a plank door (hinge node: the
hideout door swings) CENTRED on the mission's door side (map-builder doorPoint stands mid-wall), a mud bench (mastaba)
and a water jar by the door, a frond shade over it. Five builds, each with its own yard life on the faces the default
camera sees (S, E):
  n1: door N; palm-frond awning on posts along the S face, bench and jars under it, bread oven, ladder to the E eave,
      firewood
  n2: door N; lime-washed; the E third a flat-roofed annex (2.7 m) with a mud parapet, a mud stair up the E face to
      its roof, sacks and drying fronds on the terrace, a timber window box (mashrabiya) on the S face
  n3: door N; ochre render, whitened dado, a palm-rib lean-to against the S face over a feed trough, oven on the E
  w1: door W; pinkish render; a flat annex on the E with a mud dovecote tower (pots, perches) on its roof and a ladder
  w2: door W; whitened dado; frond awning, oven, mashrabiya, water-jar stand (zir) on the E face, firewood
Footprint 6 x 5 (HIGH). Front (Blender -Y) = game S. Usage: blender -b --python house_adobe_redtile.py -- outdir VAR [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh
import kit_roof as KR

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'n1'
SEEDS = {'n1': 811, 'n2': 813, 'n3': 815, 'w1': 812, 'w2': 814}
SEED = int(av[2]) if len(av) > 2 else SEEDS[VAR]
K.begin('house_adobe_redtile_' + VAR, SEED, theater='desert')
r = K.rng()
DOOR = VAR[0]
TIM = 'palm_log'
CFG = {
    'n1': dict(tint=(1.0, 0.96, 0.9), blue=(0.25, 0.42, 0.52), awning=(-2.6, 1.6), oven=(2.35, -3.25), ladder_e=True, wood=(3.35, 1.3)),
    'n2': dict(mud='limewash_lumpy', tint=(0.97, 0.95, 0.9), blue=(0.22, 0.4, 0.58), annex=True, stair=True, mashr=True),
    'n3': dict(mud='adobe_ochre', tint=(1.0, 0.95, 0.88), blue=(0.3, 0.46, 0.56), dado=True, leanto=True, oven=(3.55, -1.0)),
    'w1': dict(mud='mud_render2', tint=(1.0, 0.9, 0.86), blue=(0.32, 0.45, 0.36), annex=True, dove=True),
    'w2': dict(tint=(0.95, 0.9, 0.84), blue=(0.24, 0.44, 0.6), dado=True, awning=(-1.4, 2.6), oven=(-2.3, -3.25), mashr=True, zir=True,
               wood=(3.35, 1.4)),
}[VAR]
TINT, BLUE = CFG['tint'], CFG['blue']
MUD = CFG.get('mud', 'mud_render')
WOOD = (0.5, 0.42, 0.33)
HW, HD, T = 3.0, 2.5, 0.42
ZL, ZH = 3.2, 3.95                    # pent roof: low (S) and high (N) wall heads
ANX = CFG.get('annex', False)
XA, ZA = (0.6, 2.7) if ANX else (HW, ZL)   # main block x -HW..XA under the pent; the annex XA..HW, flat at ZA
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]      # edges 0 S, 1 E, 2 N, 3 W


def lintel(f, over=0.22):
    bm = bmesh.new()
    for dd in (-0.1, -0.3):
        C.cyl_bm(bm, f.p(-f.w / 2 - over, f.h + 0.07, dd), f.p(f.w / 2 + over, f.h + 0.07 + r.uniform(-0.02, 0.02), dd), 0.06, 6)
    K.part(bm, TIM, name='lint%d' % int(abs(f.o.x * 10 + f.o.y * 7)), uv='beam', axis=tuple(f.r), grime=0.6)


REED = dict(mid='timber_beam', mat_tint=(0.98, 0.88, 0.64))     # split-cane / reed matting (solid: no alpha cards)


def mat_sheet(bm_pts, name, grain=(1, 0, 0), thick=0.05):
    """A sagging reed / cane mat: quads given as rows of points; solidified, cane grain along `grain`."""
    bm = bmesh.new()
    vv = [[bm.verts.new(p) for p in row] for row in bm_pts]
    for i in range(len(vv) - 1):
        for j in range(len(vv[0]) - 1):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thick)
    K.part(bm, REED['mid'], name=name, uv='beam', axis=grain, grime=0.35, mat_tint=REED['mat_tint'], bisect=False)


def awning(x0, y0, x1, y1, z, name='awning'):
    """Palm-log arbour (posts, beams, palm-rib poles) under a reed mat with ragged, sagging edges."""
    bm = bmesh.new()
    nx = 2 if x1 - x0 < 3.5 else 3
    for i in range(nx):
        x = x0 + (x1 - x0) * i / (nx - 1)
        for y in (y0, y1):
            C.cyl_bm(bm, V((x, y, 0)), V((x + r.uniform(-0.04, 0.04), y, z)), 0.08, 6)
    for y in (y0, y1):
        C.beam_bm(bm, (x0 - 0.2, y, z + 0.06), (x1 + 0.2, y, z + 0.06), 0.14, 0.12)
    K.part(bm, TIM, name=name + '_frame', uv='beam', axis=(0, 0, 1))
    bm = bmesh.new()
    k = int((x1 - x0 + 0.4) / 0.4)
    for i in range(k):
        x = x0 - 0.2 + (x1 - x0 + 0.4) * (i + 0.5) / k
        C.cyl_bm(bm, V((x, y0 - 0.25, z + 0.19)), V((x + r.uniform(-0.05, 0.05), y1 + 0.25, z + 0.19)), 0.05, 5)
    K.part(bm, 'timber_beam', name=name + '_poles', uv='beam', axis=(0, 1, 0), grime=0.4, mat_tint=(0.9, 0.78, 0.62))
    nx_, ny_ = 6, 3
    rows = [[V((x0 - 0.3 + (x1 - x0 + 0.6) * i / nx_ + r.uniform(-0.06, 0.06), y0 - 0.3 + (y1 - y0 + 0.6) * j / ny_ + r.uniform(-0.06, 0.06),
                z + 0.27 - (0.05 if 0 < j < ny_ else 0) + r.uniform(-0.02, 0.03))) for j in range(ny_ + 1)] for i in range(nx_ + 1)]
    mat_sheet(rows, name + '_mat', grain=(0, 1, 0))


# ---- openings: the door centred on its side; windows on every face, the camera faces (S, E) get two / one
if DOOR == 'n':
    door = K.opening(poly, 2, 3.0, 0.95, 2.0, 0.0, T, 'rect', 'door')
    wins = [K.opening(poly, 2, 4.6, 0.55, 0.65, 1.4, T)]
else:
    door = K.opening(poly, 3, 2.5, 0.95, 2.0, 0.0, T, 'rect', 'door')
    wins = [K.opening(poly, 2, 1.6 if ANX else 3.0, 0.55, 0.65, 1.4, T)]
SW = {'n1': (1.3, 4.2), 'n2': (1.1, 3.0), 'n3': (2.0, 4.6), 'w1': (1.2, 2.6), 'w2': (1.5, 4.4)}[VAR]
wins += [K.opening(poly, 0, SW[0], 0.6, 0.75, 1.25, T), K.opening(poly, 0, SW[1], 0.6, 0.75, 1.25, T)]
if not CFG.get('stair'):
    wins.append(K.opening(poly, 1, 2.9 if VAR != 'n1' else 3.4, 0.5, 0.6, 1.45, T))
frs = [door] + wins
K.wall_ring(poly, ZA, T, MUD, frs, plinth=('mudbrick', 0.45, 0.03), name='walls', mat_tint=TINT)
bm = bmesh.new()
if ANX:     # the main block's walls on up from the annex roof to the pent's wall heads (E wall = the party wall)
    C.box_bm(bm, ((-HW + XA) / 2, -HD + T / 2, (ZA + ZL) / 2), (XA + HW, T, ZL - ZA))
    C.box_bm(bm, ((-HW + XA) / 2, HD - T / 2, (ZA + ZL) / 2), (XA + HW, T, ZL - ZA))
    C.box_bm(bm, (-HW + T / 2, 0, (ZA + ZL) / 2), (T, 2 * HD - 2 * T, ZL - ZA))
    C.box_bm(bm, (XA - T / 2, 0, (ZA + ZL) / 2), (T, 2 * HD - 2 * T, ZL - ZA))
# raised N wall head + sloping side-wall verges (the pent's triangles), stepped mud coping on top
C.box_bm(bm, ((-HW + XA) / 2, HD - T / 2, (ZL + ZH) / 2), (XA + HW, T, ZH - ZL))
for x in (-HW + T / 2, XA - T / 2):
    p8 = [V((x - T / 2, -HD, ZL)), V((x + T / 2, -HD, ZL)), V((x + T / 2, HD, ZL)), V((x - T / 2, HD, ZL)),
          V((x - T / 2, -HD, ZL + 0.02)), V((x + T / 2, -HD, ZL + 0.02)), V((x + T / 2, HD, ZH)), V((x - T / 2, HD, ZH))]
    C.hexa_bm(bm, p8)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, MUD, name='wallhead', mat_tint=TINT, grime=0.9)
bm = bmesh.new()
for x in (-HW + T / 2, XA - T / 2):
    n = 6
    for k in range(n):
        y0, y1 = -HD + 2 * HD * k / n, -HD + 2 * HD * (k + 1) / n
        z = ZL + (ZH - ZL) * (k + 1) / n
        C.box_bm(bm, (x, (y0 + y1) / 2, z + 0.06), (T + 0.08, y1 - y0 + 0.02, 0.14))
K.part(bm, 'mudbrick', name='verge', mat_tint=(0.88, 0.8, 0.72), grime=0.7, bisect=False)
# palm-log rafters on the wall heads (ends out under the eaves), then the tile pent
bm = bmesh.new()
nr = 9 if not ANX else 6
for k in range(nr):
    x = -HW + 0.35 + (XA + HW - 0.7) * k / (nr - 1)
    C.cyl_bm(bm, V((x + r.uniform(-0.04, 0.04), -HD - 0.32, ZL - 0.08)), V((x, HD + 0.05, ZH - 0.02)), 0.075, 6)
K.part(bm, TIM, name='rafters', uv='beam', axis=(0, 1, 0), grime=0.7)
KR.roof_shed(-HW + 0.1, -HD - 0.25, XA - 0.1, HD - T + 0.05, ZL + 0.08, ZH + 0.02, mid='roof_terracotta', thick=0.1, oh=0.12,
             low_side='-y', name='tiles', gutters=False)
bm = bmesh.new()                                         # ridge / verge tile rolls
C.cyl_bm(bm, V((-HW + 0.05, HD - T + 0.1, ZH + 0.1)), V((XA - 0.05, HD - T + 0.1, ZH + 0.1)), 0.09, 8)
K.part(bm, 'roof_terracotta', name='ridge_roll', grime=0.6, bisect=False, mat_tint=(0.82, 0.62, 0.52))
for k in range(3):
    K.decal('stain_blotch', (r.uniform(-2.2, XA - 0.8), r.uniform(-1.8, 1.4), (ZL + ZH) / 2 + 0.25), (0, -0.19, 0.98), 0.8, 0.6, alpha=0.22)

# ---- the flat annex: palm-joist roof, mud parapet (open where the stair / ladder lands), spouts
if ANX:
    inner = [(XA, -HD + T), (HW - T, -HD + T), (HW - T, HD - T), (XA, HD - T)]
    dz.roof_slab([(XA - 0.05, -HD), (HW, -HD), (HW, HD), (XA - 0.05, HD)], ZA + 0.12, 0.2, MUD, name='anx_roof', tint=TINT)
    dz.joists([(XA, -HD), (HW, -HD), (HW, HD), (XA, HD)], ZA - 0.16, [0], 0.55, r=0.07, out=0.16, mid=TIM, name='anx_joists')
    bm = bmesh.new()
    land = (-0.2, 0.75) if CFG.get('stair') else (-1.3, -0.4)       # gap in the E parapet (stair top / ladder)
    dz.mud_wall_bm(bm, V((XA, -HD + 0.17, 0)), V((HW - 0.17, -HD + 0.17, 0)), ZA + 0.12, 0.5, 0.34, seed=SEED)
    dz.mud_wall_bm(bm, V((HW - 0.17, -HD + 0.17, 0)), V((HW - 0.17, land[0], 0)), ZA + 0.12, 0.5, 0.34, seed=SEED + 1)
    dz.mud_wall_bm(bm, V((HW - 0.17, land[1], 0)), V((HW - 0.17, HD - 0.17, 0)), ZA + 0.12, 0.5, 0.34, seed=SEED + 2)
    dz.mud_wall_bm(bm, V((HW - 0.17, HD - 0.17, 0)), V((XA, HD - 0.17, 0)), ZA + 0.12, 0.5, 0.34, seed=SEED + 3)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, MUD, name='anx_parapet', mat_tint=TINT, grime=0.8, bisect=False)
    bm = bmesh.new()                                     # palm-trunk spouts through the parapet foot
    for (x, y, d) in ((1.8, -HD, (0, -1, 0)), (HW, 1.6, (1, 0, 0))):
        p = V((x, y, ZA + 0.2))
        C.cyl_bm(bm, p - V(d) * 0.2, p + V(d) * 0.45, 0.07, 6)
        K.decal('streak_rain', tuple(p + V(d) * 0.012 - V((0, 0, 0.7))), d, 0.35, 1.2, alpha=0.45)
    K.part(bm, TIM, name='anx_spouts', uv='beam', axis=(0, 1, 0), grime=0.8, bisect=False)

# ---- openings: plank door (hinge node), shuttered windows, palm lintels, lime round the door, blue-washed surrounds
K.door(door, 'main', 'plank', BLUE, step=None, hinge='left', node='door_main')
dz.lime_patch(door.p(0, door.h * 0.55, 0.0), door.n, door.w + 0.8, door.h + 0.6, seed=SEED, name='limedoor')
for k, f in enumerate(wins):
    K.window(f, 'fixed', (1, 1), frame=WOOD, sill=None, lintel=None, shutters=['open', 'ajar', 'closed', 'open'][(k + SEED) % 4],
             shutter_color=BLUE, bars=k % 2 == 0, curtain=0.3, streak=False, name='w%d' % k)
    K.decal('streak_long', tuple(f.p(0, -0.5, 0.012)), tuple(f.n), f.w + 0.1, 0.9, alpha=0.25)
    if k and (k + SEED) % 3 != 0:      # a blue-washed surround (an old charm against the evil eye)
        dz.lime_patch(f.p(0, f.h * 0.5, 0.0), f.n, f.w + 0.45, f.h + 0.45, seed=SEED + 7 * k, name='blue%d' % k,
                      tint=tuple(0.55 + 0.7 * c for c in BLUE))
if CFG.get('mashr'):
    dz.window_box(wins[1], color=(0.36, 0.3, 0.24), depth=0.42, name='mashr')
for f in frs:
    lintel(f)
dz.mud_apron(poly, 0.5, 0.28, seed=SEED)
# whitened dado on the yard faces, fallen render showing the mud bricks, damp foot, streaks under the eaves
if CFG.get('dado'):
    from mathutils import noise as NZ
    for nm, a, b, nrm in (('dado_s', V((-HW + 0.1, -HD - 0.035, 0)), V((HW - 0.1, -HD - 0.035, 0)), (0, -1, 0)),
                          ('dado_e', V((HW + 0.035, -HD + 0.1, 0)), V((HW + 0.035, HD - 0.1, 0)), (1, 0, 0))):
        L, n = (b - a).length, 24          # a whitewashed band, its top edge brushed unevenly, worn off near the ground
        top = [a.lerp(b, i / n) + V((0, 0, 1.2 + 0.09 * NZ.noise(V((i * 0.6 + SEED, 0.3, 0.7))) + 0.04 * math.sin(i * 2.1)))
               for i in range(n + 1)]
        bot = [a.lerp(b, i / n) + V((0, 0, 0.5 + 0.06 * NZ.noise(V((i * 0.9, SEED * 0.1, 1.3))))) for i in range(n + 1)]
        bm = bmesh.new()
        vt, vb = [bm.verts.new(p) for p in top], [bm.verts.new(p) for p in bot]
        for i in range(n):
            f = bm.faces.new([vb[i], vb[i + 1], vt[i + 1], vt[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            if f.normal.dot(V(nrm)) < 0:
                f.normal_flip()
        K.part(bm, 'limewash_worn', name=nm, grime=0.5, bisect=False, mat_tint=(1.0, 0.99, 0.96))['dz_noao'] = 1
for k in range(5):
    e = [0, 1, 0, 1, 2][k] if DOOR == 'n' else [0, 1, 0, 1, 3][k]
    a, b = V(poly[e]), V(poly[(e + 1) % 4])
    t = r.uniform(0.15, 0.85)
    p = a.lerp(b, t)
    n = V(((b - a).y, -((b - a).x), 0)).normalized()
    dz.spall2(V((p.x, p.y, r.uniform(0.9, 2.3 if ANX else 2.6))) + n * 0.005, n, r.uniform(0.45, 0.95), r.uniform(0.35, 0.75), mid='mudbrick',
              skin=MUD, skin_tint=TINT, seed=SEED + k, name='spall%d' % k)
for nrm, (cx, cy), w in (((0, -1, 0), (0, -HD - 0.006), 2 * HW), ((0, 1, 0), (0, HD + 0.006), 2 * HW),
                         ((-1, 0, 0), (-HW - 0.006, 0), 2 * HD), ((1, 0, 0), (HW + 0.006, 0), 2 * HD)):
    K.decal('damp_base', (cx, cy, 0.35), nrm, w * 0.95, 0.6, alpha=0.6)
    K.decal('streak_rain', (cx + (r.uniform(-0.3, 0.3) * w if nrm[0] == 0 else 0), cy + (r.uniform(-0.3, 0.3) * w if nrm[1] == 0 else 0), ZA - 0.6),
            nrm, 0.9, 1.0, alpha=0.4)
# a palm-log bracket shelf with pots and a tethering ring by one S window
bm = bmesh.new()
f = wins[2]
for dx in (-0.35, 0.35):
    C.cyl_bm(bm, f.p(dx, -0.35, 0.02), f.p(dx, -0.35, 0.3), 0.04, 5)
C.box_bm(bm, tuple(f.p(0, -0.27, 0.17)), (0.95, 0.24, 0.05) if abs(f.n.y) > 0.5 else (0.24, 0.95, 0.05))
K.part(bm, TIM, name='shelf', grime=0.6, bisect=False)
bm = bmesh.new()
for k, dx in enumerate((-0.25, 0.05, 0.3)):
    c = f.p(dx, -0.25, 0.17)
    prof = [(0.05, 0.0), (0.1, 0.05), (0.11, 0.14), (0.07, 0.22), (0.06, 0.26)]
    C.loft_bm(bm, [[V((c.x + rr * math.cos(a), c.y + rr * math.sin(a), c.z + z)) for a in [q / 10 * 2 * math.pi for q in range(10)]] for rr, z in prof],
              close_start=True, close_end=False)
K.part(bm, 'mud', name='pots', mat_tint=(0.8, 0.52, 0.38), grime=0.4, bisect=False, smooth=True)


def jar(bm, jx, jy, s=1.0, z0=0.0):
    C.cyl_bm(bm, V((jx, jy, z0)), V((jx, jy, z0 + 0.12 * s)), 0.2 * s, 10)
    prof = [(0.06, 0.12), (0.2, 0.22), (0.26, 0.42), (0.24, 0.6), (0.12, 0.74), (0.1, 0.8), (0.13, 0.84)]
    rings = [[V((jx + rr * s * math.cos(a), jy + rr * s * math.sin(a), z0 + z * s)) for a in [k / 12 * 2 * math.pi for k in range(12)]] for rr, z in prof]
    C.loft_bm(bm, rings, close_start=True, close_end=False)


def woodpile(x, y, along, n=9, name='wood'):
    """Stacked acacia / palm firewood against a wall (`along` = the wall's direction)."""
    bm = bmesh.new()
    a = V(along).normalized()
    for k in range(n):
        row, col = divmod(k, 4)
        c = V((x, y, 0.09 + row * 0.15)) + a * ((col - 1.5) * 0.17 + row * 0.08) + V((a.y, -a.x, 0)) * r.uniform(-0.05, 0.05)
        d = V((a.y, -a.x, 0)) * 0.55 + V((r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), 0))
        C.cyl_bm(bm, c - d, c + d, r.uniform(0.05, 0.08), 6)
    K.part(bm, 'timber_beam', name=name, uv='beam', axis=tuple(V((a.y, -a.x, 0))), mat_tint=(0.72, 0.6, 0.48), grime=0.7, bisect=False)


# ---- by the door: mud bench (mastaba), water jar, frond shade (all clear of the neighbour each side)
bm = bmesh.new()
if DOOR == 'n':
    mx = {'n1': -1.75, 'n2': -1.75, 'n3': 1.45}[VAR]
    C.box_bm(bm, (mx, HD + 0.28, 0.24), (1.3, 0.5, 0.48))
else:
    C.box_bm(bm, (-HW - 0.28, -1.35, 0.24), (0.5, 1.3, 0.48))
K.part(bm, 'mud_render', name='mastaba', mat_tint=(0.86, 0.8, 0.72), grime=0.7, bisect=False)
bm = bmesh.new()
if DOOR == 'n':
    jar(bm, -0.95 if VAR != 'n3' else 0.85, HD + 0.35)
else:
    jar(bm, -HW - 0.35, 0.95)
K.part(bm, 'mud', name='jar', mat_tint=(0.78, 0.55, 0.4), grime=0.4, bisect=False, smooth=True)
if DOOR == 'n':
    awning(-1.1 if VAR != 'n3' else -0.9, HD + 0.15, 0.55 if VAR == 'n1' else 0.9, HD + 0.95, 2.15, name='shade')
else:
    bm = bmesh.new()
    for k, (x, y, z) in enumerate(((-HW - 0.4, 1.9, 0.18), (-HW - 0.45, 1.45, 0.18), (-HW - 0.42, 1.68, 0.48))):
        C.box_bm(bm, (x, y, z), (0.55, 0.42, 0.34), rot_z=r.uniform(-0.3, 0.3))
    K.part(bm, 'burlap_bag', name='sacks', grime=0.6, bisect=False)

# ---- the yard faces (S, E): each house its own
if CFG.get('awning'):
    x0, x1 = CFG['awning']
    awning(x0, -HD - 0.85, x1, -HD - 0.05, 2.25, name='awning')
    bm = bmesh.new()
    C.box_bm(bm, ((x0 + x1) / 2 - 0.3, -HD - 0.27, 0.22), (min(2.2, x1 - x0 - 0.8), 0.44, 0.44))
    K.part(bm, 'mud_render', name='bench_s', mat_tint=(0.86, 0.8, 0.72), grime=0.7, bisect=False)
    bm = bmesh.new()
    jar(bm, x1 - 0.45, -HD - 0.45, 0.8)
    jar(bm, x1 - 0.85, -HD - 0.38, 0.65)
    K.part(bm, 'mud', name='jars_s', mat_tint=(0.74, 0.5, 0.36), grime=0.4, bisect=False, smooth=True)
    K.decal('stain_blotch', ((x0 + x1) / 2, -HD - 0.45, 0.02), (0, 0, 1), x1 - x0, 0.9, alpha=0.3)
if CFG.get('oven'):
    dz.tabouna(CFG['oven'] if CFG['oven'][1] > -3 else (CFG['oven'][0], -HD - 0.6), r=0.48, name='oven')
if CFG.get('wood'):
    woodpile(*CFG['wood'], (0, 1, 0), n=10, name='wood')
if CFG.get('ladder_e'):
    K.ladder((HW + 0.55, -0.6, 0), ZL - 0.1, (1, 0, 0), width=0.45, lean=0.5, mid='timber_grey', name='ladder', meta=False)
if CFG.get('leanto'):      # palm-rib lean-to against the S wall over a feed trough, a low palm-rib screen at its end
    bm = bmesh.new()
    x0, x1, y1 = -0.6, 2.7, -HD - 0.85
    for x in (x0, (x0 + x1) / 2, x1):
        C.cyl_bm(bm, V((x, y1, 0)), V((x + r.uniform(-0.03, 0.03), y1, 1.75)), 0.06, 6)
    C.cyl_bm(bm, V((x0 - 0.1, y1, 1.75)), V((x1 + 0.1, y1, 1.8)), 0.06, 6)
    for k in range(12):
        x = x0 + (x1 - x0) * (k + 0.5) / 12
        C.cyl_bm(bm, V((x, y1 - 0.12, 1.72)), V((x + r.uniform(-0.05, 0.05), -HD + 0.02, 2.35)), 0.025, 4)
    K.part(bm, TIM, name='leanto', uv='beam', axis=(0, 1, 0), grime=0.6, bisect=False)
    rows = [[V((x0 - 0.15 + (x1 - x0 + 0.3) * i / 6 + r.uniform(-0.05, 0.05), y1 - 0.3 + (-HD + 0.02 - y1 + 0.3) * jj / 2,
                1.74 + (2.38 - 1.74) * jj / 2 + 0.04 + r.uniform(-0.02, 0.02))) for jj in range(3)] for i in range(7)]
    mat_sheet(rows, 'leanto_mat', grain=(0, 1, 0.6))
    bm = bmesh.new()
    for k in range(9):
        y = -HD - 0.05 - 0.8 * (k + 0.5) / 9
        C.cyl_bm(bm, V((x1 + 0.05, y, 0)), V((x1 + 0.05, y, 1.1 + r.uniform(-0.1, 0.1))), 0.03, 4)
    K.part(bm, 'timber_beam', name='screen', mat_tint=(0.76, 0.64, 0.5), grime=0.6, bisect=False)
    dz.trough((0.9, -HD - 0.45), L=1.7, w=0.5, h=0.45, mid='mud_render', name='trough')
    bm = bmesh.new()
    for k in range(5):
        C.box_bm(bm, (r.uniform(0.2, 1.6), -HD - 0.45 + r.uniform(-0.1, 0.1), 0.42), (0.35, 0.3, 0.06), rot_z=r.uniform(0, 3))
    K.part(bm, 'burlap_bag', name='fodder', mat_tint=(1.0, 0.92, 0.6), grime=0.3, bisect=False)
if CFG.get('stair'):       # mud stair up the E face to the annex roof (rising S, landing at the parapet gap)
    dz.stair_flight((HW + 0.4, 1.0, 0), (0, -1, 0), 0.7, ZA + 0.12, 8, mid=MUD, tint=TINT, cheek=1, rail_h=0.0, niche=True,
                    name='stair', seed=SEED)
if ANX:                    # the terrace in use: sacks, drying fronds, a jar
    bm = bmesh.new()
    for k in range(3):
        C.box_bm(bm, (1.2 + 0.45 * k, 1.5 + r.uniform(-0.1, 0.1), ZA + 0.3), (0.5, 0.4, 0.34), rot_z=r.uniform(-0.3, 0.3))
    K.part(bm, 'burlap_bag', name='anx_sacks', grime=0.6, bisect=False)
    bm = bmesh.new()                                     # two rolled reed mats and a bundle of palm ribs
    for k, (x, y) in enumerate(((1.3, -1.5), (2.2, -1.2))):
        C.cyl_bm(bm, V((x - 0.55, y + 0.1 * k, ZA + 0.3)), V((x + 0.55, y + 0.1 * k, ZA + 0.3)), 0.16, 10)
    K.part(bm, REED['mid'], name='mats_rolled', uv='beam', axis=(0, 1, 0), grime=0.3, mat_tint=REED['mat_tint'], bisect=False)
    bm = bmesh.new()
    for k in range(9):
        C.cyl_bm(bm, V((0.9 + r.uniform(0, 0.25), 0.3 + 0.05 * k, ZA + 0.2 + 0.03 * (k % 3))), V((2.6 + r.uniform(-0.2, 0.1), 0.2 + 0.06 * k, ZA + 0.2)), 0.025, 4)
    K.part(bm, 'timber_beam', name='ribs', uv='beam', axis=(1, 0, 0), grime=0.4, mat_tint=(0.9, 0.8, 0.6), bisect=False)
if CFG.get('dove'):        # Egyptian mud dovecote (burg hamam) on the annex roof: tapered tower set with pot mouths,
    cx, cy, z0, R0, R1, H = 1.8, -0.75, ZA + 0.12, 0.72, 0.5, 2.1      # palm-stick perches, a whitened crenellated top
    ns = 14
    bm = bmesh.new()
    rings = [[V((cx + (R0 + (R1 - R0) * t) * math.cos(a), cy + (R0 + (R1 - R0) * t) * math.sin(a), z0 + H * t))
              for a in [k / ns * 2 * math.pi for k in range(ns)]] for t in (0, 0.33, 0.66, 1.0)]
    C.loft_bm(bm, rings, close_start=True, close_end=True)
    K.part(bm, MUD, name='dove', mat_tint=TINT, grime=0.8, bisect=False)
    bm, bp = bmesh.new(), bmesh.new()
    for row in range(4):
        t = 0.2 + row * 0.2
        rr = R0 + (R1 - R0) * t + 0.01
        for k in range(10):
            a = (k + 0.5 * (row % 2)) / 10 * 2 * math.pi
            n = V((math.cos(a), math.sin(a), 0))
            c = V((cx, cy, z0 + H * t)) + n * rr
            C.cyl_bm(bm, c - n * 0.03, c + n * 0.035, 0.055, 6)
        a = (row * 0.7) % (2 * math.pi)
        n = V((math.cos(a), math.sin(a), 0))
        c = V((cx, cy, z0 + H * t - 0.12))
        C.cyl_bm(bp, c - n * 0.2 - V((-n.y, n.x, 0)) * 0.4, c + n * 0.9 + V((-n.y, n.x, 0)) * 0.4, 0.018, 4)
    K.part(bm, 'interior_dark', name='dove_pots', grime=0, bisect=False)
    K.part(bp, TIM, name='dove_perch', uv='beam', axis=(1, 0, 0), grime=0.6, bisect=False)
    bm = bmesh.new()
    zt = z0 + H
    C.cyl_bm(bm, V((cx, cy, zt - 0.05)), V((cx, cy, zt + 0.12)), R1 + 0.06, ns)
    for k in range(8):
        a = k / 8 * 2 * math.pi
        C.box_bm(bm, (cx + (R1 - 0.05) * math.cos(a), cy + (R1 - 0.05) * math.sin(a), zt + 0.28), (0.16, 0.16, 0.3), rot_z=a)
    K.part(bm, 'limewash_worn', name='dove_top', mat_tint=(0.95, 0.93, 0.88), grime=0.5, bisect=False)
    K.ladder((HW + 0.55, -0.85, 0), ZA + 0.1, (1, 0, 0), width=0.45, lean=0.5, mid='timber_grey', name='ladder', meta=False)
if CFG.get('zir'):         # water-jar stand (zir) against the E wall: a timber frame with two big jars and a dipper
    bm = bmesh.new()
    for y in (0.15, 1.35):
        for x in (HW + 0.12, HW + 0.62):
            C.box_bm(bm, (x, y, 0.4), (0.07, 0.07, 0.8))
    for y in (0.15, 1.35):
        C.box_bm(bm, (HW + 0.37, y, 0.62), (0.6, 0.06, 0.06))
    for x in (HW + 0.12, HW + 0.62):
        C.box_bm(bm, (x, 0.75, 0.62), (0.06, 1.25, 0.06))
    K.part(bm, 'timber_grey', name='zir_frame', grime=0.6, bisect=False)
    bm = bmesh.new()
    jar(bm, HW + 0.37, 0.45, 1.05, 0.3)
    jar(bm, HW + 0.37, 1.05, 0.95, 0.3)
    K.part(bm, 'mud', name='zir', mat_tint=(0.8, 0.62, 0.46), grime=0.3, bisect=False, smooth=True)
    K.decal('stain_blotch', (HW + 0.37, 0.75, 0.02), (0, 0, 1), 0.9, 1.6, alpha=0.5)

K.footprint(poly, 'HIGH', 'building')
dz.desert_tone(0.8)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
