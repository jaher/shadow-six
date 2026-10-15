"""M10 El Agheila single-bay tank sheds (dossier §5.4 `tank_shed`, building-inventory `tank_shed_open`: timber or
corrugated, some with broken roofs). One open front (Blender -Y = game S at rot 0); the mission's three gameplay walls
stand on the other three sides (0.6 m thick, centred on the perimeter), so cladding sits ON the perimeter and the frame
inside it; NO posts across the open front (the Panzer IV drives out under a long lintel at 4.3 m).
Variants: a  11 x 12  sand-painted corrugated iron, mono-pitch roof, a few sheets missing, camouflage net rolled on the eave
          b  12 x 11  rust-streaked corrugated iron, a sagging roof run, canvas tarp hung on one side
          c  10 x 12  timber plank walls (boards on a frame), corrugated roof holed by splinters, sandbag skirts
          d  12 x 15  the bombed shed (vacant Panzer): roof half gone (charred rafters, twisted sheets), scorched walls,
                      debris heaped along the back corner only
Footprints: the three walls only. Usage: blender -b --python ic_shed.py -- outdir VAR [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('a')
W, D, CLAD = {'a': (11, 12, 'galv'), 'b': (12, 11, 'rust'), 'c': (10, 12, 'plank'), 'd': (12, 15, 'galv')}[VAR]
BOMBED = VAR == 'd'
NAME = 'tank_shed_ic_' + VAR
K.begin(NAME, 10501 + SEED + 31 * 'abcd'.index(VAR), theater='desert')
r = K.rng()
HW, HD = W / 2, D / 2
ZF, ZB = 4.75, 4.15                        # roof at the front / back (falls to the back)
zr = lambda y: ZF + (ZB - ZF) * (y + HD) / (2 * HD)
WOOD = (0.7, 0.6, 0.48) if not BOMBED else (0.5, 0.44, 0.38)
SAND = (1.12, 0.98, 0.74)
# ---- frame: back / side posts inside the walls, corner posts at the front, a long front lintel, rafters, purlins
nb = max(2, int(round(W / 3.6)))
ns = max(2, int(round(D / 3.6)))
pb = [(-HW + 0.35 + (W - 0.7) * k / nb, HD - 0.35) for k in range(nb + 1)]
ps = [(sx * (HW - 0.35), -HD + 0.35 + (D - 0.7) * k / ns) for sx in (-1, 1) for k in range(1, ns)]
posts(pb + ps, 0, ZB - 0.1, s=0.22, name='posts', tint=WOOD)
posts([(-HW + 0.3, -HD + 0.3), (HW - 0.3, -HD + 0.3)], 0, zr(-HD) - 0.1, s=0.3, name='posts_front', tint=WOOD)
beams([((-HW, -HD + 0.3, zr(-HD) - 0.35), (HW, -HD + 0.3, zr(-HD) - 0.35))], s=0.32, name='lintel', tint=WOOD)
bm = bmesh.new()
nr = int(W / 1.2)
for k in range(nr + 1):
    x = -HW + 0.15 + (W - 0.3) * k / nr
    if BOMBED and x > 0.8 and k % 2:
        continue                           # the bomb took every other rafter over the E half
    y1 = HD + 0.2 if not (BOMBED and x > 0.8) else r.uniform(-1.5, 2.5)
    C.beam_bm(bm, (x, -HD - 0.3, zr(-HD - 0.3) - 0.1), (x, y1, zr(y1) - 0.1), 0.12, 0.18)
for y in [-HD + 0.3 + (D - 0.6) * k / 4 for k in range(5)]:
    x1 = HW + 0.2 if not BOMBED else 0.9
    C.beam_bm(bm, (-HW - 0.2, y, zr(y) + 0.02), (x1, y, zr(y) + 0.02), 0.1, 0.1)
for sx in (-1, 1):                         # knee braces at the front corners
    C.beam_bm(bm, (sx * (HW - 0.3), -HD + 0.3, zr(-HD) - 1.4), (sx * (HW - 1.3), -HD + 0.3, zr(-HD) - 0.5), 0.1, 0.1)
K.part(bm, 'timber_beam', name='rafters', mat_tint=WOOD, uv='beam', axis=(0, 1, 0), grime=0.8)


# ---- cladding on the back and the two sides (ON the perimeter: inside the gameplay walls' 0.6 m)
def clad_run(p0, p1, ztop, bg, br, k0):
    a, b = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    L = (b - a).length
    u = (b - a) / L
    t, k = 0.0, k0
    while t < L - 0.1:
        w = min(0.9, L - t)
        c = a + u * (t + w / 2)
        zt = ztop(c.y) - 0.06
        hole = BOMBED and c.x > HW - 0.5 and -1.6 < c.y < 0.9          # one torn-out stretch of the E side
        if not hole:
            sz = (max(0.03, abs(u.x) * (w - 0.04)), max(0.03, abs(u.y) * (w - 0.04)), zt - 0.22)
            bm = br if r.random() < (0.35 if CLAD == 'rust' else 0.12) else bg
            C.box_bm(bm, (c.x, c.y, 0.22 + sz[2] / 2), (sz[0] + (0.03 if abs(u.y) > 0.5 else 0), sz[1] + (0.03 if abs(u.x) > 0.5 else 0), sz[2]))
        t += w - 0.05
        k += 1
    return k


bg, br = bmesh.new(), bmesh.new()
k = clad_run((-HW, HD), (HW, HD), lambda y: ZB, bg, br, 0)
for sx in (-1, 1):
    k = clad_run((sx * HW, -HD + 0.2), (sx * HW, HD), zr, bg, br, k)
if CLAD == 'plank':
    K.part(bg, 'boards_weathered', name='clad', mat_tint=(0.78, 0.7, 0.58), uv='aligned', grime=1.0, bisect=False)
    K.part(br, 'timber_siding', name='clad_b', mat_tint=(0.7, 0.62, 0.5), grime=1.0, bisect=False)
else:
    K.part(bg, 'corrugated_galv', name='clad', mat_tint=SAND if CLAD == 'galv' else (0.78, 0.72, 0.62), grime=1.0, bisect=False)
    K.part(br, 'corrugated_rust', name='clad_rust', grime=0.9, bisect=False)
# ---- roof sheets in courses (missing / torn sheets, a sag in b, the bombed half gone in d)
bg, br = bmesh.new(), bmesh.new()
y, k = -HD - 0.35, 0
while y < HD + 0.25 - 0.2:
    L = min(2.2, HD + 0.25 - y)
    x = -HW - 0.25
    while x < HW + 0.25 - 0.15:
        w = min(0.85, HW + 0.25 - x)
        if BOMBED:
            miss = x > 0.6 + 1.2 * math.sin(y * 0.9) or (x > -1.5 and k % 5 == 0)
        else:
            miss = (VAR == 'a' and 1.5 < x < 3.4 and -0.5 < y < 1.8 and k % 3 != 1) or (VAR == 'c' and k % 11 == 3)
        if not miss:
            sag = 0.2 * math.sin(math.pi * min(1, max(0, (x + 3) / 4))) * math.sin(math.pi * min(1, max(0, (y + 2) / 4))) if VAR == 'b' and -3 < x < 1 and -2 < y < 2 else 0
            a, b = V((x, y, zr(y) + 0.1 - sag)), V((x + w, y + L, zr(y + L) + 0.1 - sag))
            bm = br if r.random() < (0.3 if CLAD == 'rust' else 0.12) else bg
            C.hexa_bm(bm, [V((a.x, a.y, a.z)), V((b.x, a.y, a.z)), V((b.x, b.y, b.z)), V((a.x, b.y, b.z)),
                           V((a.x, a.y, a.z + 0.03)), V((b.x, a.y, a.z + 0.03)), V((b.x, b.y, b.z + 0.03)), V((a.x, b.y, b.z + 0.03))])
        x += w - 0.06
        k += 1
    y += L - 0.12
torn = [(1.0, -1.0, 1.8, 1.0), (2.2, 2.0, 3.0, 3.6)] if BOMBED else ([(3.4, 0.0, 4.1, 1.9)] if VAR == 'a' else [])
for (x0, y0, x1, y1) in torn:              # sheets torn and curled up off their purlins
    C.hexa_bm(bg, [V((x0, y0, zr(y0) + 0.12)), V((x1, y0, zr(y0) + 0.12)), V((x1, y1, zr(y1) + 0.8)), V((x0, y1, zr(y1) + 0.65)),
                   V((x0, y0, zr(y0) + 0.15)), V((x1, y0, zr(y0) + 0.15)), V((x1, y1, zr(y1) + 0.83)), V((x0, y1, zr(y1) + 0.68))])
for bm_ in (bg, br):
    bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
K.part(bg, 'corrugated_galv', name='roof', mat_tint=(1.05, 0.95, 0.78) if not BOMBED else (0.62, 0.58, 0.52), uv='aligned', grime=1.0, bisect=False)
K.part(br, 'corrugated_rust', name='roof_rust', grime=0.9, bisect=False)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_shed_b.py')).read())
