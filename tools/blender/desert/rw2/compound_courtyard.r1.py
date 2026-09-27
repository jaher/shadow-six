"""Walled courtyard compound (M9-M12), rework 1. Two different layouts on the same 18 x 14 m walled plot:
  a: whitewashed dar/haouch (Tunis outskirts): lime-coped perimeter (drip copings, no rolls), skifa gate tower with a
     modelled passage (benches, joist ceiling, paving), north range whose roof is broken by three barrel vaults, a
     hatch and a chimney, lower arcaded portico with a lit gallery (paved floor, benches, doors), paved courtyard with
     well, planted fig, jars, stair to the roofs, east stable shed.
  b: ochre mud ksar-farm (south Tunisia/Libya): eroded mud perimeter with merlons + mud skirt, gate tower with a
     passage, a two-tier barrel-vaulted GHORFA granary along the north wall (palm-peg steps), west room range with a
     frond arbour, beaten-earth yard with an animal pen, oven, fodder.
Usage: blender -b --python compound_courtyard.py -- outdir [a|b] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else {'a': 41, 'b': 43}[VAR]
K.begin('compound_courtyard_' + VAR, SEED, theater='desert')
r = K.rng()
A_ = VAR == 'a'
WALL = 'limewash_worn' if A_ else 'mud_render'
TINT = (0.97, 0.96, 0.93) if A_ else (0.97, 0.95, 0.92)
PST = 'lime' if A_ else 'merlon'
STONE = 'ashlar_limestone'
ROOFM = 'screed_roof' if A_ else 'mud_render'
X, Y, T, H = 9.0, 7.0, 0.5, 3.0
outer = [(-X, -Y), (X, -Y), (X, Y), (-X, Y)]
GW, GD, GH = 4.6, 3.6, 4.9
# ---------------- perimeter wall (gate gap in the south wall)
bm = bmesh.new()
segs = [((-X, -Y), (-GW / 2, -Y)), ((GW / 2, -Y), (X, -Y)), ((X, -Y), (X, Y)), ((X, Y), (-X, Y)), ((-X, Y), (-X, -Y))]
for a, b in segs:
    a, b = V((*a, 0)), V((*b, 0))
    rv = (b - a).normalized()
    n = V((rv.y, -rv.x, 0))
    p0, p1 = a - rv * (T if abs(a.x) == X and abs(a.y) == Y else 0), b
    C.beam_bm(bm, p0 - n * T / 2 + V((0, 0, H / 2)), p1 - n * T / 2 + V((0, 0, H / 2)), T, H)
    K.footprint([tuple(x)[:2] for x in (p0, p1, p1 - n * T, p0 - n * T)], 'HIGH', 'wall')
    K.climb_meta(tuple(p0)[:2], tuple(p1)[:2], H + 0.5, 'wall')
wins = [K.opening(outer, 1, 4.0, 0.45, 0.55, 2.0, T), K.opening(outer, 3, 11.0, 0.45, 0.55, 2.0, T)]
bm = KA.boolean_cut(bm, wins)
K.part(bm, WALL, name='perimeter', mat_tint=TINT)
for f in wins:
    K.window(f, 'fixed', (1, 1), frame=(0.3, 0.28, 0.25), sill=STONE if A_ else None, bars=True, streak=False, curtain=0.0, name='pw%d' % int(f.o.x))
dz.parapet(outer, H, 0.5, T, WALL, gaps={0: [(X - GW / 2 + 0.01, X + GW / 2 - 0.01)]}, style=PST, mat_tint=TINT, climb=False, name='perim_top', mspace=1.6)
dz.spouts(outer, H - 0.1, 5.0, STONE if A_ else 'palm_log', skip=(0,))
if not A_:
    dz.mud_apron(outer, 0.55, 0.32, seed=SEED, name='apron_out', step=1.3)

# ---------------- gate tower (skifa) with a modelled passage
gpoly = [(-GW / 2, -Y - 0.6), (GW / 2, -Y - 0.6), (GW / 2, -Y - 0.6 + GD), (-GW / 2, -Y - 0.6 + GD)]
gate = dz.HFrame(K.opening(gpoly, 0, GW / 2, 2.5, 3.7, 0.0, 0.6, 'arch', 'door'), 0.15)
back = K.opening(gpoly, 2, GW / 2, 2.4, 3.4, 0.0, 0.6, 'arch', 'door')
win = K.opening(gpoly, 0, GW / 2, 0.5, 0.45, 4.05, 0.6, 'arch')
K.wall_ring(gpoly, GH, 0.6, WALL, [gate, back, win], name='gate_walls', footprint=False, mat_tint=TINT)
for sx in (-1, 1):
    K.footprint_rect(sx * (GW / 2 - 0.55), -Y - 0.6 + GD / 2, 1.1, GD, 0, 'HIGH', 'gate_tower')
dz.roof_slab(C.poly_offset(gpoly, -0.3), GH + 0.03, 0.3, ROOFM, name='gate_roof', tint=(0.97, 0.95, 0.92))
K.roof_meta(C.poly_offset(gpoly, -0.3), GH + 0.03, walkable=True, kind='flat')
dz.parapet(gpoly, GH, 0.8, 0.3, WALL, style=PST, mat_tint=TINT, name='gate_par')
dz.course(gpoly, GH - 0.3, 0.14, 0.06, WALL, name='gate_cornice', mat_tint=TINT)
dz.arch_surround(gate, STONE if A_ else 'sandstone_ochre', 0.3, stripes=A_)
K.window(win, 'fixed', (1, 1), frame=(0.3, 0.3, 0.3), sill=STONE, bars=True, interior=True, streak=False, name='gatewin')
OPEN = not A_
K.door(gate, 'gate', 'double', dz.DOORS['green' if A_ else 'brown'], open_deg=70 if OPEN else 0, step=None)
K.anchor('gate', tuple(gate.o), (0, -1, 0), open=OPEN)
gy0, gy1 = -Y, -Y - 0.6 + GD - 0.6
bm = bmesh.new()          # passage: paved floor, side benches (dukkana), timber joist ceiling under the roof slab
C.box_bm(bm, (-GW / 2 + 0.6 + 0.3, (gy0 + gy1) / 2, 0.22), (0.6, gy1 - gy0 - 0.2, 0.44))
C.box_bm(bm, (GW / 2 - 0.6 - 0.3, (gy0 + gy1) / 2, 0.22), (0.6, gy1 - gy0 - 0.2, 0.44))
K.part(bm, WALL, name='skifa_bench', mat_tint=TINT)
dz.patch_quad([(-GW / 2 + 0.6, gy0 - 0.5, 0), (GW / 2 - 0.6, gy0 - 0.5, 0), (GW / 2 - 0.6, gy1 + 0.5, 0), (-GW / 2 + 0.6, gy1 + 0.5, 0)],
              'patio_flags' if A_ else 'cobblestone', 'skifa_floor', lift=0.015)
bm = bmesh.new()
for k in range(6):
    y = gy0 - 0.35 + (gy1 - gy0 + 0.7) * (k + 0.5) / 6
    C.cyl_bm(bm, (-GW / 2 + 0.55, y, 3.95), (GW / 2 - 0.55, y, 3.95), 0.08, 6)
K.part(bm, 'palm_log' if not A_ else 'timber_beam', name='skifa_joists', uv='beam', axis=(1, 0, 0))
dz.patch_quad([(-GW / 2 + 0.6, gy0 - 0.55, 4.02), (-GW / 2 + 0.6, gy1 + 0.55, 4.02), (GW / 2 - 0.6, gy1 + 0.55, 4.02), (GW / 2 - 0.6, gy0 - 0.55, 4.02)],
              'roof_thatch' if not A_ else 'timber_siding', 'skifa_ceiling', tint=(0.8, 0.72, 0.6), lift=0.0)

if A_:
    # ---------------- north range (3.8 m) with barrel vaults on the roof + lower portico (3.0 m) in front
    RH, PHt = 3.8, 3.0
    RY0, RY1 = Y - 4.2, Y - 0.25
    AY = RY0 - 1.9
    AX0 = -X + T + 1.4
    rpoly = [(-X + 0.25, RY0), (X - 0.25, RY0), (X - 0.25, RY1), (-X + 0.25, RY1)]
    rf = []
    for k, t in enumerate((2.2, 5.6, 8.6, 11.6, 15.0)):
        rf.append(K.opening(rpoly, 0, t, 1.0, 2.1, 0.0, 0.5, 'segment', 'door') if k % 2 == 0 else K.opening(rpoly, 0, t, 0.8, 1.1, 1.0, 0.5))
    K.wall_ring(rpoly, RH, 0.5, WALL, rf, name='range_walls', mat_tint=TINT)
    for f in rf:
        if f.kind == 'door':
            dz.studded_door(f, 'room%d' % len(C.A.meta['doors']), r.choice(['blue', 'green', 'brown']), step=None, wicket=False, studs=r.random() < 0.5)
            KA.voussoirs(f, STONE)
        else:
            dz.bow_grille(f, name='rg%d' % int(f.o.x))
            K.window(f, 'casement', (1, 2), frame=dz.DOORS['green'], sill=STONE, curtain=0.4, name='rw%d' % int(f.o.x))
    rroof = C.poly_offset(rpoly, -0.25)
    dz.roof_slab(rroof, RH + 0.03, 0.3, ROOFM, name='range_roof', tint=(0.97, 0.95, 0.92))
    K.roof_meta(rroof, RH + 0.03, walkable=True, kind='flat')
    dz.parapet(rpoly, RH, 0.45, 0.28, WALL, style='lime', mat_tint=TINT, name='range_par', gaps={0: [(0.8, 2.0)]})
    dz.course(rpoly, RH - 0.28, 0.14, 0.06, WALL, name='range_cornice', mat_tint=TINT)
    for k, xc in enumerate((-4.6, 0.2, 4.8)):
        dz.vault_dome((xc, (RY0 + RY1) / 2), 3.4, RY1 - RY0 - 0.8, RH + 0.03, WALL, TINT, name='vault%d' % k, kind='barrel')
    dz.hatch((-7.2, RY1 - 0.9), RH + 0.03, 0.6, curb=WALL, tint=TINT)
    bm = bmesh.new()      # kitchen chimney: plastered stack with a tile hood
    C.box_bm(bm, (7.6, RY1 - 0.7, RH + 0.6), (0.45, 0.45, 1.2))
    C.box_bm(bm, (7.6, RY1 - 0.7, RH + 1.28), (0.6, 0.6, 0.12))
    K.part(bm, WALL, name='chimney', mat_tint=TINT)
    K.decal('soot', (7.6, RY1 - 0.925, RH + 0.95), (0, -1, 0), 0.5, 0.7, alpha=0.7)
    dz.roof_patches([(-8.4, RY0 + 0.4), (8.4, RY0 + 0.4), (8.4, RY1 - 0.4), (-8.4, RY1 - 0.4)], RH + 0.03, 3, SEED)
    # portico: arcade wall + its own lower roof, lit gallery (paved floor, benches, jars)
    apoly = [(AX0, AY), (X - T, AY), (X - T, AY + 0.45), (AX0, AY + 0.45)]
    nb = 5
    bw = (X - T - AX0) / nb
    arches = [dz.HFrame(K.opening(apoly, 0, bw * (k + 0.5), bw - 0.55, 2.45, 0.0, 0.45, 'arch', 'window'), 0.12) for k in range(nb)]
    bm = bmesh.new()
    C.prism_bm(bm, apoly, 0.0, PHt)
    bm = KA.boolean_cut(bm, arches)
    K.part(bm, WALL, name='arcade', mat_tint=TINT)
    for f in arches:
        dz.arch_surround(f, STONE, 0.14, proud=0.02, stripes=True, jambs=False, name='arc%d' % int(f.o.x * 10))
    for k in range(nb + 1):
        x = AX0 + bw * k
        K.footprint_rect(min(max(x, AX0 + 0.28), X - T - 0.28), AY + 0.22, 0.56, 0.45, 0, 'HIGH', 'pier')
    proof = [(-X + T, AY), (X - T, AY), (X - T, RY0 + 0.02), (-X + T, RY0 + 0.02)]
    dz.roof_slab(proof, PHt + 0.03, 0.22, ROOFM, name='portico_roof', tint=(0.97, 0.95, 0.92))
    K.roof_meta(proof, PHt + 0.03, walkable=True, kind='flat')
    dz.parapet([(-X + T, AY), (X - T, AY), (X - T, AY + 0.3), (-X + T, AY + 0.3)], PHt, 0.5, 0.3, WALL,
               gaps={0: [(0.0, 1.4)], 1: [(-1, 1)], 2: [(-1, 30)], 3: [(-1, 1)]}, style='lime', mat_tint=TINT, name='portico_par')
    dz.patch_quad([(AX0, AY + 0.45, 0), (X - T, AY + 0.45, 0), (X - T, RY0, 0), (AX0, RY0, 0)], 'patio_flags', 'gallery_floor', lift=0.03)
    bm = bmesh.new()
    C.box_bm(bm, (1.2, RY0 - 0.3, 0.22), (3.0, 0.5, 0.44))
    K.part(bm, WALL, name='gallery_bench', mat_tint=TINT)
    bm = bmesh.new()
    for k in range(7):
        x = AX0 + 0.3 + (X - T - AX0 - 0.6) * k / 6
        C.cyl_bm(bm, (x, AY + 0.3, PHt - 0.15), (x, RY0, PHt - 0.15), 0.07, 6)
    K.part(bm, 'timber_beam', name='gallery_joists', uv='beam', axis=(0, 1, 0))
    # stair to the portico roof along the west wall
    n = 16
    L = 0.28 * n
    sx = -X + T + 0.52
    dz.stair_flight((sx, AY - L, 0.0), (0, 1, 0), 0.95, PHt + 0.03, n, WALL, TINT, cheek=1, name='stair', seed=SEED)
    K.ladder_meta((sx, AY - L - 0.45), (sx, AY + 0.6), PHt + 0.03)
    K.footprint([(sx - 0.5, AY - L), (sx + 0.72, AY - L), (sx + 0.72, AY), (sx - 0.5, AY)], 'LOW', 'stairs')
    K.ladder((-X + 1.45, RY0 - 0.35, PHt + 0.03), RH - PHt, (0, -1, 0), meta=False)
    K.ladder_meta((-X + 1.45, RY0 - 0.8), (-X + 1.45, RY0 + 0.6), RH + 0.03)
    # courtyard: paving with a beaten-earth border, well, fig in a planter, jars, bench
    dz.patch_quad([(-5.5, -5.9, 0), (6.0, -5.9, 0), (6.0, AY - 0.3, 0), (-5.5, AY - 0.3, 0)], 'patio_flags', 'court_paving', lift=0.02)
    dz.patch_quad([(-0.8, -Y + 0.5, 0), (0.8, -Y + 0.5, 0), (0.8, -5.9, 0), (-0.8, -5.9, 0)], 'patio_flags', 'court_path', lift=0.021)
    dz.well_head((-2.0, -2.2), 0.75, 0.8, STONE, 'stone')
    K.decal('stain_blotch', (-2.0, -3.3, 0.035), (0, 0, 1), 2.4, 1.6, up=(0, 1, 0), alpha=0.45)
    dz.trough((-0.4, -3.1), 1.6, 0.5, 0.5, 0.0)
    dz.planter((2.6, -1.2), 1.0, 0.55, WALL, TINT, name='planter0')
    dz.planter((-5.0, -4.6), 0.8, 0.5, WALL, TINT, name='planter1')
    bm = bmesh.new()
    for k in range(4):
        c = V((2.2 + 0.6 * (k % 2), AY - 0.55 - 0.55 * (k // 2) - 1.2, 0))
        C.cyl_bm(bm, c, c + V((0, 0, 0.2)), 0.14, 10, r1=0.27)
        C.cyl_bm(bm, c + V((0, 0, 0.2)), c + V((0, 0, 0.62)), 0.27, 10, r1=0.11)
    K.part(bm, 'roof_terracotta', name='jars', smooth=True, mat_tint=(1.05, 0.92, 0.8))
    # east stable shed: posts, beam, galvanised sheet roof, manger, straw
    SX0 = X - T - 3.0
    bm = bmesh.new()
    for y in (-Y + T + 0.3, -Y + T + 2.6, AY - 0.5):
        C.cyl_bm(bm, (SX0, y, 0), (SX0, y, 2.35), 0.1, 6)
    C.beam_bm(bm, (SX0, -Y + T + 0.1, 2.4), (SX0, AY - 0.3, 2.4), 0.16, 0.18)
    K.part(bm, 'timber_beam', name='shed_posts', uv='beam', axis=(0, 0, 1))
    K.roof_shed(SX0, -Y + T, X - T, AY - 0.4, 2.45, 2.95, 'corrugated_galv', low_side='-x', oh=0.25, name='shed_roof', gutters=False)
    C.A.meta['roofs'].pop()
    dz.trough((X - T - 0.45, -2.2), 2.0, 0.6, 0.55, math.pi / 2)
    dz.patch_quad([(SX0 + 0.2, -5.8, 0), (X - T - 0.1, -5.8, 0), (X - T - 0.1, -3.4, 0), (SX0 + 0.2, -3.4, 0)], 'roof_thatch', 'straw', tint=(0.95, 0.85, 0.6), lift=0.03)
    bm = bmesh.new()
    dz.crate(bm, (X - T - 0.7, AY - 1.0, 0), (0.9, 0.6, 0.55), 0.1)
    dz.crate(bm, (X - T - 0.75, AY - 1.0, 0.55), (0.8, 0.55, 0.45), -0.15)
    K.part(bm, 'timber_grey', name='crates', uv='beam', axis=(1, 0, 0))
    blocks = [(rpoly, RH)]

else:
    # ---------------- b: two-tier barrel-vaulted ghorfa granary along the north wall
    GY0, GY1 = Y - 4.4, Y - T
    ncell, cw = 5, 2.6
    gx0 = -X + T + 1.2
    gp = [(gx0, GY0), (gx0 + ncell * cw, GY0), (gx0 + ncell * cw, GY1), (gx0, GY1)]
    cells = []
    for tier in range(2):
        z0 = tier * 2.25
        for k in range(ncell - tier):
            xc = gx0 + cw * (k + 0.5 + 0.5 * tier)
            cells.append((xc, z0))
    fr = [K.opening(gp, 0, xc - gx0, 0.75, 1.15, z0 + 0.35, 0.5, 'segment', 'door') for xc, z0 in cells]
    bm = bmesh.new()
    C.prism_bm(bm, gp, 0.0, 2.25)
    C.prism_bm(bm, [(gx0 + cw * 0.5, GY0), (gx0 + cw * (ncell - 0.5), GY0), (gx0 + cw * (ncell - 0.5), GY1), (gx0 + cw * 0.5, GY1)], 2.25, 4.1)
    bm = KA.boolean_cut(bm, fr)
    K.part(bm, WALL, name='ghorfa', mat_tint=TINT)
    K.footprint(gp, 'HIGH', 'granary')
    for k, (xc, z0) in enumerate(cells):      # barrel vault per cell (tier 1 on top of tier 0 where uncovered)
        if z0 > 0:
            dz.vault_dome((xc, (GY0 + GY1) / 2), cw - 0.1, GY1 - GY0, 4.1, WALL, TINT, name='gv%d' % k, kind='barrel')
    K.roof_meta([(gx0, GY0), (gx0 + cw * 0.5, GY0), (gx0 + cw * 0.5, GY1), (gx0, GY1)], 2.25, walkable=True, kind='flat')
    K.roof_meta([(gx0 + cw * (ncell - 0.5), GY0), (gx0 + cw * ncell, GY0), (gx0 + cw * ncell, GY1), (gx0 + cw * (ncell - 0.5), GY1)], 2.25, walkable=True, kind='flat')
    bm = bmesh.new()          # granary cell doors: three rough palm boards each (store rooms, not enterable)
    for k, f in enumerate(fr):
        if k % 4 == 2:
            continue           # one cell stands open (dim interior shows)
        for j in range(3):
            x0 = -f.w / 2 + f.w * j / 3 + 0.01
            KA.lbox(bm, f, x0, x0 + f.w / 3 - 0.02, 0.0, f.h - 0.05 + 0.03 * (j % 2), -0.22, -0.16)
    K.part(bm, 'door_planks', name='cell_doors', uv='beam', axis=(0, 0, 1), mat_tint=(0.62, 0.5, 0.38), grime=0.7)
    for k, f in enumerate(fr):
        if k % 4 == 2:
            dz.recess_room(f, 1.6, 'mud_render', (0.7, 0.62, 0.55), floor='mud_render', name='cellroom%d' % k, margin=0.3)
        bm = bmesh.new()      # palm-trunk lintel + protruding palm pegs as steps to the upper tier
        C.cyl_bm(bm, f.p(-f.w / 2 - 0.25, f.h + 0.08, -0.1), f.p(f.w / 2 + 0.25, f.h + 0.08, -0.1), 0.06, 6)
        if f.o.z > 1.0:
            for j in range(4):
                p = f.p(-f.w / 2 - 0.3 + (j % 2) * 0.25, -1.9 + 0.5 * j, -0.3)
                C.cyl_bm(bm, p, p + f.n * 0.55, 0.05, 6)
        K.part(bm, 'palm_log', name='cellwood%d' % k, uv='beam', axis=tuple(f.r))
    K.ladder_meta((gx0 + cw * 1.0, GY0 - 0.6), (gx0 + cw * 1.0, GY0 + 0.6), 2.25)
    dz.mud_apron([(gx0, GY0), (gx0 + ncell * cw, GY0), (gx0 + ncell * cw, GY1), (gx0, GY1)], 0.4, 0.25, seed=SEED + 2, name='apron_g', skip=(1, 2, 3))
    # west room range (flat mud roof, frond arbour in front), yard life
    WX1 = -X + T + 3.6
    wpoly = [(-X + 0.25, -Y + 0.25), (WX1, -Y + 0.25), (WX1, GY0 - 0.6), (-X + 0.25, GY0 - 0.6)]
    wf = [K.opening(wpoly, 1, 2.0, 1.0, 2.0, 0.0, 0.5, 'rect', 'door'), K.opening(wpoly, 1, 5.6, 0.5, 0.6, 1.4, 0.5)]
    K.wall_ring(wpoly, 3.2, 0.5, WALL, wf, name='wrange_walls', mat_tint=TINT)
    wr = C.poly_offset(wpoly, -0.25)
    dz.roof_slab(wr, 3.23, 0.3, ROOFM, name='wrange_roof', tint=(1.0, 0.97, 0.93))
    K.roof_meta(wr, 3.23, walkable=True, kind='flat')
    dz.parapet(wpoly, 3.2, 0.5, 0.32, WALL, gaps={0: [(-1, 9)], 3: [(-1, 9)]}, style='mud', mat_tint=TINT, name='wrange_par')
    dz.joists(wpoly, 3.0, [1], 0.7, r=0.08, out=0.14, mid='palm_log', name='wjoists')
    dz.mud_apron(wpoly, 0.45, 0.25, seed=SEED + 4, name='apron_w', skip=(0, 3))
    K.door(wf[0], 'wroom', 'plank', (0.42, 0.34, 0.26), step=None)
    K.window(wf[1], 'fixed', (1, 1), frame=(0.4, 0.34, 0.27), sill=None, bars=True, streak=False, name='ww')
    dz.lime_patch(wf[0].p(0, 1.2, 0), wf[0].n, 1.9, 2.7, seed=5, name='limedoor')
    dz.frond_shade(WX1 + 0.4, -3.6, WX1 + 3.2, -0.6, 2.3, name='arbour')
    dz.roof_patches(wr, 3.23, 2, SEED, lime=True, tar=False, lime_mat='mudbrick', lime_tint=(0.97, 0.93, 0.88))
    K.ladder((WX1 + 0.45, -4.6, 0), 3.23, (1, 0, 0), mid='timber_grey')
    dz.well_head((1.5, -2.6), 0.7, 0.75, 'mudbrick', 'timber')
    dz.tabouna((WX1 + 1.8, -5.4), 0.5)
    bm = bmesh.new()          # animal pen: palm-log posts and rails against the east wall
    px0, py0, py1 = X - T - 3.4, -3.8, 0.8
    for k in range(5):
        y = py0 + (py1 - py0) * k / 4
        C.cyl_bm(bm, (px0, y, 0), (px0 + r.uniform(-0.04, 0.04), y, 1.3), 0.07, 5)
    for z in (0.5, 1.1):
        C.cyl_bm(bm, (px0, py0 - 0.1, z), (px0, py1 + 0.1, z + r.uniform(-0.05, 0.05)), 0.05, 5)
        C.cyl_bm(bm, (px0, py0, z), (X - T, py0, z), 0.05, 5)
        C.cyl_bm(bm, (px0, py1, z), (X - T, py1, z), 0.05, 5)
    K.part(bm, 'palm_log', name='pen', uv='beam', axis=(0, 1, 0))
    K.footprint([(px0 - 0.1, py0 - 0.1), (px0 + 0.1, py0 - 0.1), (px0 + 0.1, py1 + 0.1), (px0 - 0.1, py1 + 0.1)], 'FENCE', 'pen')
    dz.patch_quad([(px0 + 0.1, py0 + 0.1, 0), (X - T - 0.1, py0 + 0.1, 0), (X - T - 0.1, py1 - 0.1, 0), (px0 + 0.1, py1 - 0.1, 0)], 'roof_thatch', 'litter',
                  tint=(0.85, 0.75, 0.55), lift=0.03)
    dz.trough((X - T - 0.4, -1.5), 1.8, 0.5, 0.5, math.pi / 2, mid='mudbrick')
    bm = bmesh.new()          # fodder stack and jars
    for k in range(6):
        C.cyl_bm(bm, (X - T - 2.6 + 0.3 * k, -Y + T + 0.5, 0.15), (X - T - 2.6 + 0.3 * k + 0.1, -Y + T + 1.7, 0.15 + 0.1 * (k % 2)), 0.15, 6)
    K.part(bm, 'roof_thatch', name='fodder', uv='beam', axis=(0, 1, 0), mat_tint=(0.9, 0.8, 0.58))
    bm = bmesh.new()
    for k in range(3):
        c = V((-1.2 + 0.6 * k, GY0 - 0.6, 0))
        C.cyl_bm(bm, c, c + V((0, 0, 0.2)), 0.14, 10, r1=0.27)
        C.cyl_bm(bm, c + V((0, 0, 0.2)), c + V((0, 0, 0.62)), 0.27, 10, r1=0.11)
    K.part(bm, 'roof_terracotta', name='jars', smooth=True, mat_tint=(1.05, 0.92, 0.8))
    dz.patch_quad([(0.4, -3.7, 0), (2.6, -3.7, 0), (2.6, -1.5, 0), (0.4, -1.5, 0)], 'cobblestone', 'wellpave', tint=(0.9, 0.85, 0.78), lift=0.02)
    K.decal('stain_blotch', (1.5, -2.6, 0.035), (0, 0, 1), 2.6, 2.2, up=(0, 1, 0), alpha=0.4)
    blocks = [(gp, 2.25), (wpoly, 3.2)]

# ---------------- weathering on the perimeter and blocks
for i in range(4):
    a, b, rv, n_, Le = dz.edge(outer, i)
    for k in range(int(Le / 3)):
        p = a + rv * r.uniform(0.6, Le - 0.6)
        if i == 0 and abs(p.x) < GW / 2 + 0.3:
            continue
        K.decal('damp_base', tuple(p + n_ * 0.003 + V((0, 0, 0.45))), tuple(n_), r.uniform(1.5, 2.5), 0.9, alpha=0.35 if A_ else 0.2)
        K.decal('streak_long', tuple(a + rv * r.uniform(0.6, Le - 0.6) + n_ * 0.004 + V((0, 0, H - 0.8))), tuple(n_), r.uniform(0.3, 0.6), 1.4, alpha=0.2)
        if r.random() < 0.55:
            dz.spall2(p + V((0, 0, r.uniform(0.6, 2.2))), n_, r.uniform(0.6, 1.3), r.uniform(0.35, 0.7), 'fieldstone' if A_ else 'mudbrick', WALL, TINT,
                      seed=SEED + k + 10 * i, name='sp%d_%d' % (i, k))
    if not A_ and i != 0:
        for k in range(2):
            dz.lime_patch(a + rv * r.uniform(1, Le - 1) + n_ * 0.0 + V((0, 0, r.uniform(0.9, 2.0))), n_, r.uniform(0.6, 1.2), r.uniform(0.4, 0.8),
                          seed=SEED + 30 + i * 3 + k, name='lp%d_%d' % (i, k))
for k in range(2):         # inner faces of the perimeter too (seen from the game camera)
    dz.spall2((r.uniform(-6, 6), Y - T - 0.004, r.uniform(1.0, 2.2)), (0, -1, 0), 1.0, 0.6, 'fieldstone' if A_ else 'mudbrick', WALL, TINT, seed=SEED + 70 + k, name='spi%d' % k)
K.decal('poster_fr', (GW / 2 + 1.2, -Y - 0.004, 1.6), (0, -1, 0), 0.55, 0.75, alpha=0.85)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
