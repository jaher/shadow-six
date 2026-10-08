"""Riveted steel harbour lock gate (M13 Le Havre basin gates; reusable for docks / sea locks):
 a   sea_lock_gate   10.5 m span, two steel leaves (5.25 m) hinged on heel posts at both quay faces, closing straight
     across: riveted skin plates with horizontal girders and vertical stiffeners on the outer face, heavy heel and
     mitre posts, a 1.1 m plank catwalk on top with stanchion-and-chain railings, rack-and-pinion paddle gear, tide
     marks, weed and barnacle line at the waterline, rust runs. The leaves are door nodes 'door_gate_w' / 'door_gate_e'
     (pivots at the heel posts) so the game swings them open with the set-piece (kind 'leaf').
Footprint = the 10.5 x 1.4 closed gate (NONE: the set-piece owns the water cells).
Usage: blender -b --factory-startup --python sea_lock_gate.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1341)
K.begin('sea_lock_gate', SEED, theater='coast', water_level=-0.1)
r = K.rng()
SPAN, ZB, ZT = 10.5, -2.6, 1.15                 # span, leaf bottom (under water), leaf top
HW, LT = SPAN / 2, 0.55                          # half span, leaf thickness
GREY = (0.42, 0.44, 0.43)


def leaf(sgn):
    """Leaf hinged at x = sgn * HW, reaching to the mitre at x = 0 (minus a 2 cm gap)."""
    node = 'door_gate_' + ('w' if sgn < 0 else 'e')
    x_h, x_m = sgn * (HW - 0.12), sgn * 0.02
    x0, x1 = min(x_h, x_m), max(x_h, x_m)
    piv = (sgn * HW, 0.0, 0.0)
    obs = []
    bm = bmesh.new()                                    # skin plate (both faces), heel + mitre posts
    K.box_bm(bm, ((x0 + x1) / 2, 0, (ZB + ZT) / 2), (x1 - x0, LT, ZT - ZB))
    obs.append(K.part(bm, 'steel_painted', name='leaf_skin', node=node, mat_tint=GREY, grime=1.0, bisect=False))
    bm = bmesh.new()
    for x in (x_h, x_m):
        K.box_bm(bm, (x, 0, (ZB + ZT) / 2 + 0.05), (0.3, LT + 0.16, ZT - ZB + 0.1))
    for z in (ZB + 0.4, -1.0, 0.0, 0.85):                    # horizontal girders, both faces
        for s in (-1, 1):
            K.box_bm(bm, ((x0 + x1) / 2, s * (LT / 2 + 0.07), z), (x1 - x0, 0.14, 0.22))
    for k in range(1, 5):                                     # vertical stiffeners
        x = x0 + (x1 - x0) * k / 5
        for s in (-1, 1):
            K.box_bm(bm, (x, s * (LT / 2 + 0.05), (ZB + ZT) / 2), (0.1, 0.1, ZT - ZB - 0.2))
    obs.append(K.part(bm, 'steel_painted', name='leaf_frame', node=node, mat_tint=(0.36, 0.37, 0.36), grime=1.0, bisect=False))
    bm = bmesh.new()                                    # rivet rows along the girders (outer face, above water)
    for z in (0.0, 0.85):
        for k in range(int((x1 - x0) / 0.22)):
            x = x0 + 0.11 + k * 0.22
            for s in (-1, 1):
                K.box_bm(bm, (x, s * (LT / 2 + 0.15), z + 0.06), (0.04, 0.03, 0.04))
                K.box_bm(bm, (x, s * (LT / 2 + 0.15), z - 0.06), (0.04, 0.03, 0.04))
    obs.append(K.part(bm, 'steel_painted', name='rivets', node=node, mat_tint=(0.34, 0.35, 0.34), grime=1.0, bisect=False, lod='drop'))
    bm = bmesh.new()                                    # catwalk planks on top
    K.box_bm(bm, ((x0 + x1) / 2, 0, ZT + 0.05), (x1 - x0, 1.1, 0.08))
    obs.append(K.part(bm, 'deck_planks', name='catwalk', node=node, uv='beam', axis=(1, 0, 0), grime=0.8, bisect=False))
    bm = bmesh.new()                                    # railing: stanchions both sides, top + mid rail
    for s in (-1, 1):
        y = s * 0.52
        n = int((x1 - x0) / 1.3) + 1
        for k in range(n + 1):
            x = x0 + 0.1 + (x1 - x0 - 0.2) * k / n
            K.cyl_bm(bm, V((x, y, ZT + 0.09)), V((x, y, ZT + 1.05)), 0.025, 6)
        K.cyl_bm(bm, V((x0 + 0.1, y, ZT + 1.03)), V((x1 - 0.1, y, ZT + 1.03)), 0.022, 6)
        K.cyl_bm(bm, V((x0 + 0.1, y, ZT + 0.58)), V((x1 - 0.1, y, ZT + 0.58)), 0.015, 5)
    # paddle gear: rack pillar + handwheel near the heel
    xg = x_h - sgn * 0.9
    K.box_bm(bm, (xg, -0.3, ZT + 0.55), (0.18, 0.14, 1.0))
    K.cyl_bm(bm, V((xg, -0.42, ZT + 0.95)), V((xg, -0.5, ZT + 0.95)), 0.28, 12)
    obs.append(K.part(bm, 'steel_painted', name='railing', node=node, mat_tint=(0.2, 0.2, 0.19), grime=0.5, bisect=False))
    for o in obs:
        o['kit_pivot'] = list(piv)
    # weathering on both faces: waterline band, weed, rust runs from the rivet rows
    for s in (-1, 1):
        K.decal('waterline', ((x0 + x1) / 2, s * (LT / 2 + 0.006), 0.05), (0, s, 0), x1 - x0, 0.7, alpha=0.8)
        for k in range(3):
            K.decal('streak_rust', (x0 + (x1 - x0) * (k + r.uniform(0.2, 0.8)) / 3, s * (LT / 2 + 0.2), 0.45), (0, s, 0), 0.4, 0.9, alpha=0.6)
    K.door_meta('gate_' + ('w' if sgn < 0 else 'e'), (sgn * HW, 0, 0), (0, -1, 0), HW, ZT, kind='leaf', node=node)


leaf(-1)
leaf(1)
# fixed heel recesses: granite quoin blocks at both ends (inside the span), fenders
bm = bmesh.new()
for s in (-1, 1):
    M.chamfer_block(bm, s * HW - 0.12 if s > 0 else -HW, -0.95, s * HW if s > 0 else -HW + 0.12, 0.95, ZB, ZT - 0.02, ch=0.02)
K.part(bm, 'granite', name='quoins', grime=0.9, bisect=False)
K.footprint([(-HW, -0.7), (HW, -0.7), (HW, 0.7), (-HW, 0.7)], 'NONE', 'gate')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
