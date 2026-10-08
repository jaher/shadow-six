"""Afrika Korps field supply dump (M8 Tell el Eisa depot dressing; reusable in M9-M11 desert camps): pallets of
20 l Wehrmachtkanister (sand-yellow and field-grey cans, a few white-crossed water cans), stencilled ammunition and
ration crates on timber dunnage, a half-pulled tarpaulin on the crate stack weighed down with a sandbag, a low
sandbag blast wall on the weather side. Kept inside its footprint (the dump blocks like a crate stack).
  a   2.6 x 1.6 m: two jerrycan pallets + a crate stack with a tarp, sandbag wall on the N side
  b   3.2 x 1.4 m: a long jerrycan row two cans high + crates at one end, no wall
Footprint rect (HIGH). Usage: blender -b --python supply_dump_desert.py -- outdir [a|b] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, V, bmesh

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else {'a': 821, 'b': 822}[VAR]
K.begin('supply_dump_desert_' + VAR, SEED, theater='desert')
r = K.rng()
HW, HD = (1.3, 0.8) if VAR == 'a' else (1.6, 0.7)
SAND, GREY, WATER = (0.78, 0.66, 0.44), (0.42, 0.44, 0.4), (0.5, 0.5, 0.46)


def pallet(x0, y0, w, d):
    bm = bmesh.new()
    for yy in (y0 + 0.06, y0 + d / 2, y0 + d - 0.06):
        C.box_bm(bm, (x0 + w / 2, yy, 0.05), (w, 0.1, 0.1))
    n = int(w / 0.16)
    for k in range(n):
        C.box_bm(bm, (x0 + (k + 0.5) * w / n, y0 + d / 2, 0.115), (w / n - 0.03, d, 0.03))
    K.part(bm, 'timber_beam', name='pallet%d' % int(x0 * 10 + 50), mat_tint=(0.82, 0.72, 0.58), grime=0.6, bisect=False)


def cans(x0, y0, nx, ny, layers, z0=0.13, tint=SAND, water=0):
    bms = {}
    for L in range(layers):
        for i in range(nx):
            for j in range(ny):
                if L == layers - 1 and r.random() < 0.18:
                    continue
                col = 'w' if water and r.random() < water else ('g' if r.random() < 0.3 else 's')
                bm = bms.setdefault(col, bmesh.new())
                dz.jerrycan(bm, (x0 + 0.19 + i * 0.36, y0 + 0.1 + j * 0.18, z0 + L * 0.5), r.uniform(-0.04, 0.04))
    for col, bm in bms.items():
        K.part(bm, 'steel_painted', name='cans_%s_%d' % (col, int(x0 * 10 + 50)), mat_tint={'s': tint, 'g': GREY, 'w': WATER}[col],
               grime=0.9, bisect=False)


if VAR == 'a':
    pallet(-HW + 0.05, -HD + 0.05, 1.1, 0.75)
    cans(-HW + 0.05, -HD + 0.07, 3, 4, 2)
    pallet(-HW + 0.05, 0.02, 1.1, 0.72)
    cans(-HW + 0.05, 0.04, 3, 4, 1, water=0.5)
    bm = bmesh.new()
    C.box_bm(bm, (0.68, -0.2, 0.05), (1.1, 1.1, 0.1))
    K.part(bm, 'timber_beam', name='dunnage', mat_tint=(0.7, 0.6, 0.48), grime=0.7, bisect=False)
    bm = bmesh.new()
    stack = [((0.45, -0.45, 0.1), (0.75, 0.5, 0.42)), ((0.45, 0.07, 0.1), (0.75, 0.5, 0.42)), ((1.0, -0.2, 0.1), (0.45, 0.95, 0.5)),
             ((0.45, -0.2, 0.52), (0.8, 0.55, 0.38)), ((0.98, -0.25, 0.6), (0.5, 0.6, 0.3))]
    for c, s in stack:
        dz.crate(bm, c, s, r.uniform(-0.05, 0.05))
    K.part(bm, 'timber_beam', name='crates', mat_tint=(0.72, 0.66, 0.5), grime=0.8, bisect=False)
    # tarp half over the crate stack, draped to the S, with a sandbag on top
    bm = bmesh.new()
    pts = [V((0.02, -0.62, 0.92)), V((1.28, -0.62, 0.92)), V((1.28, 0.25, 0.92)), V((0.02, 0.25, 0.92))]
    C.quad(bm, pts)
    C.quad(bm, [V((0.02, 0.25, 0.92)), V((1.28, 0.25, 0.92)), V((1.3, 0.42, 0.35)), V((0.0, 0.42, 0.35))])
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.62, 0.55, 0.4), grime=0.6, bisect=False)
    dz.sandbags((-HW, HD - 0.18), (HW, HD - 0.18), rows=3, name='blastwall', thick=1, footprint=False)
else:
    for k in range(3):
        pallet(-HW + 0.05 + k * 0.95, -HD + 0.08, 0.92, 0.72)
        cans(-HW + 0.05 + k * 0.95, -HD + 0.1, 2, 4, 2 if k < 2 else 1, water=0.4 if k == 1 else 0)
    bm = bmesh.new()
    for c, s in (((-HW + 0.45, 0.35, 0.0), (0.8, 0.5, 0.42)), ((-HW + 1.35, 0.35, 0.0), (0.8, 0.5, 0.42)), ((-HW + 0.9, 0.35, 0.42), (0.75, 0.48, 0.38))):
        dz.crate(bm, c, s, r.uniform(-0.05, 0.05))
    K.part(bm, 'timber_beam', name='crates', mat_tint=(0.72, 0.66, 0.5), grime=0.8, bisect=False)
    bm = bmesh.new()                                     # a loose can on its side and an empty, dented one
    dz.jerrycan(bm, (HW - 0.3, 0.42, 0.0), 0.7)
    K.part(bm, 'steel_painted', name='loose_can', mat_tint=SAND, grime=1.0, bisect=False)
for k in range(2):
    K.decal('oil_stain', (r.uniform(-HW, HW) * 0.7, r.uniform(-HD, HD) * 0.7, 0.012), (0, 0, 1), 1.0, 0.8, up=(0, 1, 0), alpha=0.4)
K.footprint([(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)], 'HIGH', 'building')
dz.desert_tone(0.7)
dz.finalize(OUT, ao_res=512, ao_samples=48)
