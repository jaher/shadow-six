"""M9 tank shed `tank_shed_open` (Bab el Qattara; building-inventory: open-front multi-bay tank shed, timber or
corrugated, some with broken roofs): 21 x 9 m, three 7 m bays open to the front (game S at rot 0; the mission turns it
315 deg so the bays face SE), a timber frame (posts, braced, a front lintel at 4.3 m) clad in sand-painted / rusted
corrugated iron on the back and the two ends, a mono-pitch corrugated roof falling to the back (4.8 -> 4.1 m) with
missing and torn sheets over the E bay (purlins showing) and a sagging patch, a camouflage net hung from the front
eaves (rolled up over the bays: the Panzers drive out under it), workbench, oil drums, jerrycans, spare road wheels,
track links and a hanging inspection lamp along the back wall only (the bays stay clear for the tanks), oil stains.
Footprints: back / end walls and the posts only (the bays are open). Usage: blender -b --python bq_shed.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *

OUT, VAR, SEED = args('a')
NAME = 'tank_shed_open_bq'
K.begin(NAME, 9077 + SEED, theater='desert')
r = K.rng()
HW, HD = 10.5, 4.5
ZF, ZB = 4.8, 4.1                      # roof at the front / back
zr = lambda y: ZF + (ZB - ZF) * (y + HD) / (2 * HD)
BX = [-HW, -3.5, 3.5, HW]              # bay posts (x)
WOOD = (0.7, 0.6, 0.48)
# ---- frame: front posts + lintel, back and end posts, rafters, purlins, knee braces
posts([(x, HD - 0.15) for x in BX] + [(-HW + 0.1, 0), (HW - 0.1, 0)], 0, ZB - 0.1, s=0.24, name='posts_back', tint=WOOD)
posts([(x, -HD + 0.15) for x in BX], 0, zr(-HD) - 0.12, s=0.26, name='posts_front', tint=WOOD)
beams([((-HW - 0.2, -HD + 0.15, zr(-HD) - 0.3), (HW + 0.2, -HD + 0.15, zr(-HD) - 0.3)),
       ((-HW - 0.2, HD - 0.15, ZB - 0.25), (HW + 0.2, HD - 0.15, ZB - 0.25))], s=0.3, name='lintels', tint=WOOD)
bm = bmesh.new()
for x in [-HW + 0.1 + k * (2 * HW - 0.2) / 9 for k in range(10)]:
    C.beam_bm(bm, (x, -HD - 0.3, zr(-HD - 0.3) - 0.1), (x, HD + 0.2, zr(HD + 0.2) - 0.1), 0.12, 0.18)
for y in (-HD + 0.15, -1.5, 1.5, HD - 0.15):
    C.beam_bm(bm, (-HW - 0.2, y, zr(y) + 0.02), (HW + 0.2, y, zr(y) + 0.02), 0.1, 0.1)
for x in BX:                            # knee braces post -> lintel at the front
    for s in (-1, 1):
        if -HW <= x + s * 0.9 <= HW:
            C.beam_bm(bm, (x, -HD + 0.15, zr(-HD) - 1.3), (x + s * 0.95, -HD + 0.15, zr(-HD) - 0.42), 0.1, 0.1)
K.part(bm, 'timber_beam', name='rafters', mat_tint=WOOD, uv='beam', axis=(0, 1, 0), grime=0.7)
# ---- cladding: corrugated sheets on the back and the ends, a few panels rust-coloured / sand-painted / missing
def sheet(bm_g, bm_r, p0, p1, z0, z1, k):
    C.box_bm(bm_r if (k * 7 + SEED) % 5 == 0 else bm_g, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (z0 + z1) / 2),
             (max(0.03, abs(p1[0] - p0[0])), max(0.03, abs(p1[1] - p0[1])), z1 - z0))
bg, br = bmesh.new(), bmesh.new()
k = 0
x = -HW
while x < HW - 0.15:
    w = min(0.9, HW - x)
    if not (2.0 < x < 3.0):              # one missing sheet in the back (light through)
        sheet(bg, br, (x + 0.02, HD + 0.02), (x + w - 0.02, HD + 0.02), 0.25 + 0.05 * (k % 2), ZB - 0.05, k)
    x += w - 0.05
    k += 1
for sx in (-1, 1):
    y = -HD + 0.3
    while y < HD - 0.15:
        w = min(0.9, HD - y)
        sheet(bg, br, (sx * (HW + 0.02), y + 0.02), (sx * (HW + 0.02), y + w - 0.02), 0.25, zr(y + w / 2) - 0.08, k)
        y += w - 0.05
        k += 1
K.part(bg, 'corrugated_galv', name='clad', mat_tint=(0.86, 0.76, 0.58), grime=1.0, bisect=False)
K.part(br, 'corrugated_rust', name='clad_rust', grime=0.9, bisect=False)
# ---- roof: corrugated sheets in courses, three missing + two torn over the E bay, a sagging run in the middle bay
bg, br = bmesh.new(), bmesh.new()
k = 0
y = -HD - 0.35
while y < HD + 0.25 - 0.2:
    L = min(2.2, HD + 0.25 - y)
    x = -HW - 0.25
    while x < HW + 0.25 - 0.15:
        w = min(0.85, HW + 0.25 - x)
        miss = (5.0 < x < 8.6 and -1.2 < y < 2.6 and (k % 3 != 1)) or (x > 9.0 and y > 1.0)
        if not miss:
            sag = 0.18 * math.sin(math.pi * min(1, max(0, (x + 2.6) / 4.2))) * math.sin(math.pi * min(1, max(0, (y + 2.0) / 3.5))) if -2.6 < x < 1.6 and -2 < y < 1.5 else 0
            a, b = V((x, y, zr(y) + 0.1 - sag)), V((x + w, y + L, zr(y + L) + 0.1 - sag))
            bm = br if (k * 3 + SEED) % 7 == 0 else bg
            C.hexa_bm(bm, [V((a.x, a.y, a.z)), V((b.x, a.y, a.z)), V((b.x, b.y, b.z)), V((a.x, b.y, b.z)),
                           V((a.x, a.y, a.z + 0.03)), V((b.x, a.y, a.z + 0.03)), V((b.x, b.y, b.z + 0.03)), V((a.x, b.y, b.z + 0.03))])
        x += w - 0.06
        k += 1
    y += L - 0.12
for (x0, y0, x1, y1) in ((5.3, -0.4, 6.0, 1.9), (8.6, -1.0, 9.4, 0.4)):   # two sheets torn and curled up at an edge
    C.hexa_bm(bg, [V((x0, y0, zr(y0) + 0.12)), V((x1, y0, zr(y0) + 0.12)), V((x1, y1, zr(y1) + 0.75)), V((x0, y1, zr(y1) + 0.6)),
                   V((x0, y0, zr(y0) + 0.15)), V((x1, y0, zr(y0) + 0.15)), V((x1, y1, zr(y1) + 0.78)), V((x0, y1, zr(y1) + 0.63))])
for bm_ in (bg, br):
    bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
K.part(bg, 'corrugated_galv', name='roof', mat_tint=(0.82, 0.74, 0.6), uv='aligned', grime=1.0, bisect=False)
K.part(br, 'corrugated_rust', name='roof_rust', grime=0.9, bisect=False)
# ---- camouflage net: rolled along the front eave, a hanging skirt at the ends
bm = bmesh.new()
C.cyl_bm(bm, V((-HW, -HD - 0.15, zr(-HD) - 0.05)), V((HW, -HD - 0.15, zr(-HD) - 0.05)), 0.22, 10)
K.part(bm, 'camo_netting', name='net_roll', mat_tint=(0.86, 0.78, 0.6), grime=0.4, bisect=False, smooth=True)
for sx in (-1, 1):
    bm = bmesh.new()
    rows = [[V((sx * (HW + 0.15), -HD - 0.15 + 1.6 * i / 4 + (0.2 * j / 3) * (i % 2), zr(-HD) - 0.05 - 2.8 * j / 3 * (1 - 0.15 * i / 4)))
             for j in range(4)] for i in range(5)]
    vv = [[bm.verts.new(p) for p in row] for row in rows]
    for i in range(4):
        for j in range(3):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    K.part(bm, 'camo_netting', name='net_skirt%d' % (sx + 1), mat_tint=(0.86, 0.78, 0.6), grime=0.3, bisect=False)
# ---- along the back wall only: workbench + vice, oil drums, jerrycans, spare road wheels and track links, a lamp
bm = bmesh.new()
C.box_bm(bm, (-6.8, HD - 0.55, 0.85), (2.4, 0.7, 0.08))
for (x, y) in ((-7.9, HD - 0.3), (-5.7, HD - 0.3), (-7.9, HD - 0.8), (-5.7, HD - 0.8)):
    C.box_bm(bm, (x, y, 0.42), (0.09, 0.09, 0.84))
K.part(bm, 'timber_beam', name='bench', mat_tint=WOOD, grime=0.9, bisect=False)
drums([(-0.6, HD - 0.5, 0), (0.05, HD - 0.45, 0), (7.0, HD - 0.5, 0), (-9.8, HD - 0.55, 0)], tint=(0.42, 0.44, 0.38), name='oil_drums')
jerrycans((4.1, HD - 0.4, 0), n=6, rot=0.0)
jerrycans((-3.0, HD - 0.4, 0), n=4, rot=0.0)
bm = bmesh.new()
for k, (x, z) in enumerate(((1.2, 0.36), (1.5, 0.36), (1.35, 0.98))):       # spare road wheels leaning on the wall
    C.cyl_bm(bm, V((x, HD - 0.35 - 0.1 * k, z)), V((x, HD - 0.55 - 0.1 * k, z)), 0.36, 14)
K.part(bm, 'paint_metal', name='roadwheels', mat_tint=(0.62, 0.56, 0.42), grime=1.0, bisect=False, smooth=True)
bm = bmesh.new()
for k in range(10):
    C.box_bm(bm, (6.0 + k * 0.155, HD - 0.75, 0.04), (0.14, 0.5, 0.07))
K.part(bm, 'cast_iron', name='track_links', mat_tint=(0.38, 0.33, 0.28), grime=1.0, bisect=False)
bm = bmesh.new()
C.cyl_bm(bm, V((0.0, 0.0, zr(0) - 0.1)), V((0.0, 0.0, zr(0) - 0.9)), 0.008, 3)
C.cyl_bm(bm, V((0.0, 0.0, zr(0) - 0.9)), V((0.0, 0.0, zr(0) - 1.05)), 0.16, 10, r1=0.06)
K.part(bm, 'cast_iron', name='lamp', mat_tint=(0.3, 0.32, 0.28), bisect=False)
K.anchor('light', (0.0, 0.0, zr(0) - 1.1), (0, 0, -1), kind='light')
for k in range(9):                                                          # oil stains where the tanks stand
    x = [-7, 0, 7][k % 3] + r.uniform(-1.5, 1.5)
    K.decal('stain_blotch', (x, r.uniform(-2.0, 2.5), 0.012), (0, 0, 1), r.uniform(0.8, 1.8), r.uniform(0.6, 1.4), alpha=0.55)
for sx in (-1, 1):
    a, b = (sx * HW, -HD), (sx * HW, HD)
    dz.sand_drift(a, b, (sx, 0, 0), h=0.3, w=0.9, seed=SEED + sx, name='sand_e%d' % (sx + 1))
dz.sand_drift((-HW, HD), (HW, HD), (0, 1, 0), h=0.35, w=1.0, seed=SEED + 5, name='sand_back')
# ---- footprints: back + end walls (HIGH), front posts; the bays stay open
K.footprint(rect(-HW - 0.05, HD - 0.3, HW + 0.05, HD + 0.05), 'HIGH', 'wall')
for sx in (-1, 1):
    K.footprint(rect(sx * HW - 0.15, -HD, sx * HW + 0.15, HD), 'HIGH', 'wall')
for x in BX[1:3]:
    K.footprint(rect(x - 0.15, -HD, x + 0.15, -HD + 0.3), 'HIGH', 'wall')
C.A.meta['notes'].append('open-front 3-bay shed: bays clear for the Panzers; props along the back wall only')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
