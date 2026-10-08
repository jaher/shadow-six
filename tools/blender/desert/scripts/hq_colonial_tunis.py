"""Tunis harbour HQ (M12 'Up on the Roof', the SE garrison by the getaway car): a French-protectorate colonial
office block on the quay, requisitioned as a German harbour command post (Hafenkommandantur) in 1943.
- two storeys (3.0 + 2.6 m) of worn lime-wash over rubble, ochre sandstone quoins, plinth, string course, a band
  of green glazed tiles under a moulded cornice, a balustraded parapet over a flat screed roof (not walkable);
- a projecting centre bay (avant-corps): horseshoe-arch street door with striped voussoirs, studded green door,
  green-tiled door hood on timber brackets, a first-floor French window with a wrought-iron balcony;
- ground floor: arched windows behind bowed iron grilles; first floor: casements with louvred blue shutters;
- military dress: a KOMMANDANTUR board, a blackout wall lantern, a field-telephone wire run, a wire aerial mast on
  the roof, posters, rain streaks, damp base, fallen render.
Footprint 10 x 7 m (front = south, door centred). No walkable roof / ladders (the mission owns the nav).
Usage: blender -b --python hq_colonial_tunis.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V

av = dz.argv()
OUT = av[0]
SEED = int(av[2]) if len(av) > 2 else 1943
K.begin('hq_colonial_tunis', SEED, theater='desert')
r = K.rng()
WASH = dz.WASH['cream']
PL, STONE, SCREED, OCH = 'limewash_worn', 'ashlar_limestone', 'screed_roof', 'sandstone_ochre'
BLUE = dz.DOORS['blue']
GTILE = (0.45, 0.72, 0.55)
T = 0.5
Z1, Z2 = 3.0, 5.6                     # first floor level, roof level
W, D = 9.6, 6.6                       # main block (leaves room for the bay / cornice inside 10 x 7)
x0, x1, y0, y1 = -W / 2, W / 2, -D / 2 + 0.2, D / 2 + 0.2
main = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
BW = 3.0                              # centre bay width, projection 0.4 m

# ---- openings ------------------------------------------------------------------------------------------
gf = [K.opening(main, 0, t, 0.95, 1.55, 0.95, T, 'arch') for t in (1.15, 2.85, W - 2.85, W - 1.15)]
ff = [K.opening(main, 0, t, 0.9, 1.45, Z1 + 0.55, T) for t in (1.15, 2.85, W - 2.85, W - 1.15)]
side = [K.opening(main, 1, D * 0.3, 0.9, 1.45, 0.95, T, 'arch'), K.opening(main, 1, D * 0.7, 0.9, 1.4, Z1 + 0.55, T),
        K.opening(main, 3, D * 0.5, 0.9, 1.45, 0.95, T, 'arch'), K.opening(main, 3, D * 0.5, 0.9, 1.4, Z1 + 0.55, T),
        K.opening(main, 3, D * 0.2, 0.9, 1.4, Z1 + 0.55, T)]
back = [K.opening(main, 2, W * 0.3, 0.6, 0.7, Z1 + 1.0, T), K.opening(main, 2, W * 0.7, 0.6, 0.7, Z1 + 1.0, T)]
door = dz.HFrame(K.opening(main, 0, W / 2, 1.35, 2.75, 0.0, T, 'arch', 'door'))
fwin = K.opening(main, 0, W / 2, 1.1, 2.0, Z1 + 0.15, T, 'segment', 'door')

K.wall_ring(main, Z2, T, PL, gf + ff + side + back + [door, fwin], plinth=(OCH, 0.55, 0.05), name='walls_main', mat_tint=WASH)
# the avant-corps: sandstone pilasters either side of the door/window column and an attic panel over the cornice
bm = dz.bmesh.new()
for s_ in (-1, 1):
    C.box_bm(bm, (s_ * (BW / 2 - 0.3), y0 - 0.2, (Z2 + 0.5) / 2), (0.6, 0.4, Z2 + 0.5))
C.box_bm(bm, (0, y0 - 0.2, Z2 + 0.05), (BW, 0.4, 0.9))
K.part(bm, OCH, name='bay_pilasters', grime=0.5)
dz.roof_slab(C.poly_offset(main, -0.3), Z2 + 0.03, 0.35, SCREED, name='roof_main', tint=(0.96, 0.94, 0.9))

# ---- mouldings: quoins, string course, tile band, cornice -------------------------------------------------
K.quoins(main, 0.55, Z2 - 0.4, OCH)
dz.course(main, Z1 - 0.1, 0.18, 0.07, OCH, name='string')
dz.course(main, Z2 - 0.62, 0.28, 0.02, 'roof_terracotta', name='tile_band', mat_tint=GTILE)
dz.course(main, Z2 - 0.32, 0.16, 0.1, PL, name='cornice', mat_tint=WASH)
dz.course(main, Z2 - 0.16, 0.08, 0.16, STONE, name='cornice2')


def balustrade(poly, z, h=0.75, gaps=(), name='bal'):
    """Pedestal rail + turned balusters + sandstone coping on every edge of poly (outer face)."""
    bm = dz.bmesh.new()
    bt = dz.bmesh.new()
    for i in range(len(poly)):
        a, b, rr, nn, Le = dz.edge(poly, i)
        if i in gaps:
            continue
        a2 = a - nn * 0.16
        C.beam_bm(bm, tuple(a2 + V((0, 0, z + 0.08))), tuple(a2 + rr * Le + V((0, 0, z + 0.08))), 0.32, 0.16)
        C.beam_bm(bm, tuple(a2 + V((0, 0, z + h - 0.04))), tuple(a2 + rr * Le + V((0, 0, z + h - 0.04))), 0.36, 0.1)
        n = max(2, int(Le / 0.3))
        for k in range(1, n):
            p = a2 + rr * (Le * k / n)
            C.cyl_bm(bt, tuple(p + V((0, 0, z + 0.16))), tuple(p + V((0, 0, z + h - 0.09))), 0.055, 6, r1=0.035)
        for t in (0.0, Le):
            p = a2 + rr * t
            C.box_bm(bm, tuple(p + V((0, 0, z + h / 2))), (0.36, 0.36, h))
    K.part(bm, STONE, name=name + '_rail', grime=0.5)
    K.part(bt, PL, name=name + '_balusters', mat_tint=WASH, smooth=True, lod='drop')


balustrade(main, Z2, name='bal_main')

# ---- the centre bay: door, hood, balcony ---------------------------------------------------------------
dz.arch_surround(door, STONE, 0.28, stripes=True)
dz.studded_door(door, 'front', 'green')
K.roof_shed(-1.15, y0 - 0.7, 1.15, y0 - 0.02, 3.0 - 0.15, 3.0, 'roof_terracotta', low_side='-y', oh=0.06, name='door_hood', gutters=False)
C.A.meta['roofs'].pop()
bm = dz.bmesh.new()
for s in (-1, 1):
    C.beam_bm(bm, (s * 1.0, y0 - 0.02, 2.55), (s * 1.0, y0 - 0.62, 2.86), 0.07, 0.1)
K.part(bm, 'timber_beam', name='hood_brackets', uv='beam', axis=(0, 1, 0))
K.window(fwin, 'casement', (2, 4), frame=BLUE, sill=None, shutters='open', shutter_color=BLUE, shutter_style='louvred', curtain=0.6,
         name='fwin')
bm = dz.bmesh.new()
C.box_bm(bm, (0, y0 - 0.4, Z1 + 0.08), (2.3, 0.8, 0.14))
K.part(bm, STONE, name='balcony_slab', grime=0.5)
K.railing((-1.08, y0 - 0.74, Z1 + 0.15), (1.08, y0 - 0.74, Z1 + 0.15), 0.95, 'iron')
K.railing((-1.08, y0 - 0.74, Z1 + 0.15), (-1.08, y0 - 0.42, Z1 + 0.15), 0.95, 'iron')
K.railing((1.08, y0 - 0.74, Z1 + 0.15), (1.08, y0 - 0.42, Z1 + 0.15), 0.95, 'iron')

# ---- windows -------------------------------------------------------------------------------------------
for k, f in enumerate(gf + side[0::2]):
    K.window(f, 'casement', (2, 3), frame=BLUE, sill=STONE, curtain=0.5, name='gw%d' % k)
    dz.bow_grille(f, name='gg%d' % k)
    KA.voussoirs(f, STONE)
for k, f in enumerate(ff + side[1::2] + back):
    st = ['open', 'ajar', 'closed', 'open'][k % 4]
    K.window(f, 'casement' if f.w > 0.7 else 'single', (2, 3) if f.w > 0.7 else (1, 2), frame=BLUE, sill=STONE,
             shutters=st if f.w > 0.7 else None, shutter_color=BLUE, shutter_style='louvred', curtain=0.5, name='fw%d' % k)

# ---- military dress ------------------------------------------------------------------------------------
K.sign((x0 + 2.0, y0 - 0.02, 2.45), (0, -1, 0), 1.3, 'kommandantur')
K.wall_lantern((1.95, y0, 0), (0, -1, 0), 2.6)
bm = dz.bmesh.new()                   # field-telephone wire along the facade on porcelain knobs, into a first-floor window
for k in range(6):
    x = x1 - 0.3 - k * 0.55
    C.cyl_bm(bm, (x, y0 - 0.0, Z1 - 0.32), (x, y0 - 0.08, Z1 - 0.32), 0.025, 6)
C.cyl_bm(bm, (x1 - 0.2, y0 - 0.07, Z1 - 0.32), (x1 - 3.0, y0 - 0.07, Z1 - 0.32), 0.008, 4)
C.cyl_bm(bm, (x1 + 0.05, y0 - 0.07, 0.4), (x1 + 0.05, y0 - 0.07, Z1 - 0.32), 0.008, 4)
K.part(bm, 'steel_galv', name='phone_wire', mat_tint=(0.25, 0.24, 0.22), grime=0, lod='drop')
bm = dz.bmesh.new()                   # wire aerial: two masts on the roof, a sagging antenna between them
for p in ((x0 + 1.0, y1 - 1.0), (x1 - 1.0, y1 - 1.0)):
    C.cyl_bm(bm, (p[0], p[1], Z2), (p[0], p[1], Z2 + 3.2), 0.045, 6, r1=0.03)
dz.rope((x0 + 1.0, y1 - 1.0, Z2 + 3.15), (x1 - 1.0, y1 - 1.0, Z2 + 3.15), sag=0.25, r=0.01, n=9, bm=bm)
dz.rope((x0 + 1.0 + 3.0, y1 - 1.0, Z2 + 2.95), (1.0, y0 + 1.6, Z2 + 0.05), sag=0.1, r=0.01, n=5, bm=bm)
K.part(bm, 'steel_galv', name='aerial', mat_tint=(0.35, 0.34, 0.32), grime=0.2, lod='drop')
dz.hatch((x0 + 1.4, y0 + 1.5), Z2 + 0.03, 0.7, tint=WASH)
dz.roof_patches(C.poly_offset(main, -0.7), Z2 + 0.03, 4, SEED)
dz.spouts(main, Z2 - 0.02, 3.2, STONE, skip=(0,))

# ---- weathering ----------------------------------------------------------------------------------------
for i, (e, t, z) in enumerate([(0, 0.6, 0.7), (1, D - 0.8, 1.8), (3, 1.2, 0.6), (0, W - 0.5, 4.2), (2, 2.0, 1.0)]):
    a, b, rr, nn, Le = dz.edge(main, e)
    dz.spall2(a + rr * t + V((0, 0, z)), nn, r.uniform(0.6, 1.1), r.uniform(0.35, 0.6), 'fieldstone', PL, WASH, seed=SEED + i, name='sp%d' % i)
for i in range(4):
    a, b, rr, nn, Le = dz.edge(main, i)
    for k in range(max(1, int(Le / 2.5))):
        t = r.uniform(0.5, Le - 0.5)
        K.decal('damp_base', tuple(a + rr * t + nn * 0.003 + V((0, 0, 0.45))), tuple(nn), r.uniform(1.6, 2.4), 0.8, alpha=0.35)
        K.decal('streak_long', tuple(a + rr * r.uniform(0.4, Le - 0.4) + nn * 0.004 + V((0, 0, Z2 - 1.0))), tuple(nn), 0.6, 1.5, alpha=0.22)
K.decal('poster_de', (x1 - 1.0, y0 - 0.006, 1.6), (0, -1, 0), 0.55, 0.75, alpha=0.9)
K.decal('poster_fr', (x0 + 0.55, y0 - 0.006, 1.5), (0, -1, 0), 0.5, 0.7, alpha=0.75)
dz.flagpole((0, y0 + 1.0, Z2 + 0.03), 4.2)          # the garrison flag on the roof over the entrance (cloth in-game)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
