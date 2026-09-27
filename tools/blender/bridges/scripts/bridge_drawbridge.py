"""Balance-beam drawbridges ("ophaalbrug" type): timber/steel leaf hinged at the abutment, lifted by chains from
overhead balance beams pivoting on a timber gallows portal, counterweight crossbar on the rear arms (parallelogram
linkage: leaf angle == beam angle, chains stay vertical). Masonry abutments with quay walls, fenders, bollards.
Variants:
  bridge_lift_lever   (M17 Alsace) single leaf, tarred timber + grey steel, lever/winch stand on the bank (node 'lever')
  bridge_bascule_double (BCD Nijmegen) double leaf, painted white, brick quays, operator's hut.
Animated nodes (pivot = hinge): leaf_* rotate about game Z (Blender Y); balance_* rotate by the same angle about
their pivots; chains_* translate with the beam tip. Sidecar 'anim' block documents them."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V, part, box_bm, beam_bm, cyl_bm
import bmesh
import kit_weather as W
from kit_detail import railing
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
from mathutils import noise as N
import kit_bridge as KB
part = F.part

a = BL.args()
name = a[0] if a else 'bridge_lift_lever'
double = 'double' in name
WATER, BED, ZD = -2.2, -4.2, 0.35
HALFW = 6.0 if double else 5.0            # abutment faces at +-HALFW
WID = 4.2 if double else 4.0
white = double
TIM = 'wood_paint' if white else 'timber_tarred'
TT = (0.93, 0.93, 0.9) if white else None
QUAY = 'brick_dark' if double else 'fieldstone'
K.begin(name, 17 if not double else 8, theater='temperate', water_level=WATER)
r = K.rng()
anim = {}
leaves = [(-HALFW, 0.0, -1), (HALFW, 0.0, 1)] if double else [(HALFW, -HALFW, 1)]   # (hinge x, tip x, side)
HG = 5.6 if not double else 4.2        # beam pivot height above hinge
for hx, tx, side in leaves:
    Ln = abs(hx - tx)
    tag = 'e' if side > 0 else 'w'
    zh = ZD - 0.25
    # ---------------- leaf (separate node)
    n0 = len(C.A.parts)
    bm = bmesh.new()
    for yy in (-WID / 2 + 0.25, -0.5, 0.5, WID / 2 - 0.25):
        beam_bm(bm, (hx, yy, ZD - 0.45), (tx + side * 0.02, yy, ZD - 0.45), 0.2, 0.36)
    for k in range(int(Ln / 1.2) + 1):
        x = hx - side * (0.15 + k * (Ln - 0.3) / int(Ln / 1.2))
        beam_bm(bm, (x, -WID / 2 - 0.15, ZD - 0.2), (x, WID / 2 + 0.15, ZD - 0.2), 0.16, 0.14)
    for k in range(int(Ln / 1.2)):
        xa = hx - side * (0.15 + k * (Ln - 0.3) / int(Ln / 1.2))
        xb = hx - side * (0.15 + (k + 1) * (Ln - 0.3) / int(Ln / 1.2))
        for ya, yb in ((-WID / 2 + 0.25, -0.5), (0.5, WID / 2 - 0.25)):
            beam_bm(bm, (xa, ya, ZD - 0.55), (xb, yb, ZD - 0.55), 0.08, 0.12)                    # underside X bracing
            beam_bm(bm, (xa, yb, ZD - 0.55), (xb, ya, ZD - 0.55), 0.08, 0.12)
    part(bm, 'timber_beam' if not white else 'wood_paint', name='leaf_girders_' + tag, uv='beam', axis=(1, 0, 0), tint=TT, bisect=False)
    BL_d = bmesh.new()
    nb = int(Ln / 0.28)
    for k in range(nb):
        x = hx - side * (k + 0.5) * Ln / nb
        box_bm(BL_d, (x, r.uniform(-0.04, 0.04), ZD - 0.05), (Ln / nb - 0.012, WID + 0.3, 0.1))
    part(BL_d, 'deck_planks', name='leaf_deck_' + tag, uv='beam', axis=(0, 1, 0), grime=0.5, bisect=False)
    for s in (-1, 1):
        yr = s * (WID / 2 + 0.1)
        F.period_railing((hx - side * 0.1, yr, ZD), (tx + side * 0.1, yr, ZD), 1.05, 1.25,
                         'wood_paint' if white else 'timber_grey', TT or (0.62, 0.58, 0.52), name='leaf_rail_%s%d' % (tag, s + 1),
                         style='cross', post=0.12, iron='cast_iron')
    bm = bmesh.new()
    for s in (-1, 1):
        cyl_bm(bm, (tx + side * 0.25, s * (WID / 2 - 0.1), ZD - 0.3), (tx + side * 0.25, s * (WID / 2 - 0.1), ZD + 0.12), 0.07, 6)  # chain eye
        box_bm(bm, (tx + side * 0.25, s * (WID / 2 - 0.1), ZD + 0.14), (0.16, 0.05, 0.12))
    part(bm, 'cast_iron', name='leaf_eyes_' + tag, grime=0.5, bisect=False)
    piv = (hx, 0, zh)
    BL.mark_node(C.A.parts[n0:], 'leaf_' + tag, piv)
    # ---------------- gallows portal (fixed): two posts with struts + lintel, on the abutment behind the hinge
    gx = hx
    bm = bmesh.new()
    for s in (-1, 1):
        yp = s * (WID / 2 + 0.45)
        beam_bm(bm, (gx, yp, ZD - 0.3), (gx, yp, zh + HG + 0.5), 0.34, 0.34)
        beam_bm(bm, (gx + side * 1.6, yp, ZD), (gx + side * 0.05, yp, zh + HG * 0.55), 0.2, 0.2)          # raking strut
        beam_bm(bm, (gx - side * 0.9, yp, ZD), (gx - side * 0.05, yp, zh + HG * 0.45), 0.18, 0.18)
    beam_bm(bm, (gx, -WID / 2 - 0.8, zh + HG + 0.6), (gx, WID / 2 + 0.8, zh + HG + 0.6), 0.36, 0.3)             # lintel
    for s in (-1, 1):
        beam_bm(bm, (gx, s * (WID / 2 + 0.45), zh + HG - 0.6), (gx, s * (WID / 2 - 0.6), zh + HG + 0.45), 0.14, 0.14)
    part(bm, TIM, name='gallows_' + tag, uv='beam', axis=(0, 0, 1), tint=TT)
    # ---------------- balance beams (node) : front arm to above the leaf tip, rear arm + counterweight crossbar
    n0 = len(C.A.parts)
    pz = zh + HG
    rear = Ln * 0.55
    bm = bmesh.new()
    for s in (-1, 1):
        yp = s * (WID / 2 + 0.45)
        beam_bm(bm, (tx + side * 0.25, yp, pz), (hx + side * rear, yp, pz), 0.24, 0.42)
        beam_bm(bm, (hx - side * Ln * 0.5, yp, pz + 0.2), (hx + side * rear * 0.6, yp, pz + 0.2), 0.12, 0.12)       # top tie
    for fx in (tx + side * 0.3, hx - side * Ln * 0.5):
        beam_bm(bm, (fx, -WID / 2 - 0.6, pz + 0.1), (fx, WID / 2 + 0.6, pz + 0.1), 0.2, 0.2)                    # spreaders
    for s in (-1, 1):
        box_bm(bm, (tx + side * 0.25, s * (WID / 2 - 0.1), pz - 0.3), (0.3, 0.1, 0.18))                   # tip shackle blocks
        beam_bm(bm, (tx + side * 0.25, s * (WID / 2 + 0.45), pz - 0.2), (tx + side * 0.25, s * (WID / 2 - 0.1), pz - 0.2), 0.14, 0.12)
    part(bm, TIM, name='balance_' + tag, uv='beam', axis=(1, 0, 0), tint=TT)
    bm = bmesh.new()
    box_bm(bm, (hx + side * (rear - 0.3), 0, pz - 0.35), (0.9, WID + 1.3, 0.9))
    part(bm, 'cast_iron', name='counterweight_' + tag, grime=0.8)
    bm = bmesh.new()
    for s in (-1, 1):
        cyl_bm(bm, (gx, s * (WID / 2 + 0.2), pz), (gx, s * (WID / 2 + 0.72), pz), 0.1, 8)                     # trunnions
    part(bm, 'cast_iron', name='trunnions_' + tag)
    BL.mark_node(C.A.parts[n0:], 'balance_' + tag, (gx, 0, pz))
    # chains (node): vertical from beam tip to leaf tip eye
    n0 = len(C.A.parts)
    for s in (-1, 1):
        y = s * (WID / 2 - 0.1)
        xc = tx + side * 0.25
        F.chain((xc, y, ZD + 0.2), (xc, y, pz - 0.28), name='chains_%s%d' % (tag, s + 1), link=0.15, wire=0.016)
    BL.mark_node(C.A.parts[n0:], 'chains_' + tag, (tx + side * 0.25, 0, pz - 0.28))
    g = lambda p: [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]
    anim['leaf_' + tag] = {'pivot': g(piv), 'axis_game': [0, 0, -side], 'open_deg': 78, 'note': 'rotate tip upward'}
    anim['balance_' + tag] = {'pivot': g((gx, 0, pz)), 'axis_game': [0, 0, -side], 'open_deg': 78}
    anim['chains_' + tag] = {'follows': 'balance_' + tag, 'pivot': g((tx + side * 0.25, 0, pz - 0.28)), 'keep_vertical': True,
                             'note': 'parallelogram linkage: the chain hangs plumb from the beam tip (pivot) to the leaf eye; '
                                     'move the pivot with the beam tip and keep the chain vertical (length constant)'}
    # fixed deck on the abutment behind the hinge + abutment masonry, quay walls, fenders
    bm = bmesh.new()
    FL = (HALFW + 5.0 + 2.5 - abs(hx)) if double else 5.0
    box_bm(bm, (hx + side * FL / 2, 0, ZD - 0.05), (FL, WID + 0.3, 0.1))
    part(bm, 'deck_planks', name='fixed_deck_' + tag, uv='beam', axis=(0, 1, 0), bisect=False)
# heel knuckles (hinge bearings) + tip rest seats + dolphins (pile clusters) guarding the opening
for hx, tx, side in leaves:
    bm = bmesh.new()
    for yy in (-WID / 2 + 0.25, -0.5, 0.5, WID / 2 - 0.25):
        cyl_bm(bm, (hx - side * 0.05, yy - 0.18, ZD - 0.28), (hx - side * 0.05, yy + 0.18, ZD - 0.28), 0.13, 8)
        box_bm(bm, (hx + side * 0.12, yy, ZD - 0.5), (0.35, 0.42, 0.3))
    part(bm, 'cast_iron', name='hinges', grime=0.7, bisect=False)
    W.decal('streak_rust', (hx - side * 0.01, 0, ZD - 1.1), (-side, 0, 0), WID, 1.2, alpha=0.6)
for s_ in (-1, 1):
    for xd in ((-HALFW + 1.2, HALFW - 1.2) if double else (-HALFW + 1.0, HALFW - 1.0)):
        yd = s_ * (WID / 2 + 3.0)
        bm = bmesh.new()
        for k in range(5):
            ang = 2 * math.pi * k / 5
            px_, py_ = xd + 0.32 * math.cos(ang), yd + 0.32 * math.sin(ang)
            cyl_bm(bm, (px_ + 0.08 * math.cos(ang), py_ + 0.08 * math.sin(ang), BED), (px_ * 0.97 + xd * 0.03, py_, ZD + 0.5 + 0.1 * k % 3), 0.14, 7)
        part(bm, 'timber_tarred', name='dolphin', uv='beam', axis=(0, 0, 1), smooth=True, grime=1.0)
        bm = bmesh.new()
        for zz in (ZD - 0.2, WATER + 0.9):
            cyl_bm(bm, (xd, yd, zz), (xd, yd, zz + 0.25), 0.52, 10)
        part(bm, 'steel_galv', name='dolphin_bands', tint=(0.5, 0.45, 0.4), grime=0.9, bisect=False)
        BL.water_obstacle([(xd - 0.5, yd - 0.5), (xd + 0.5, yd - 0.5), (xd + 0.5, yd + 0.5), (xd - 0.5, yd + 0.5)], 'dolphin', 0.7)
BL.river_stairs(-(HALFW + 5.0) if double else -HALFW, -1, WID / 2 + (5.8 if double else 4.2), WID / 2 + (9.8 if double else 8.2), ZD - 0.1, WATER + 0.25, 1.1, 'granite' if not double else 'ashlar_limestone')
XQ = HALFW + 5.0 if double else HALFW           # quay (bank) faces
if double:   # Magere-Brug style substructure: brick piers with cutwaters flank the opening, segmental side arches
    dk = KB.Deck(-XQ - 3.0, XQ + 3.0, ZD, 0.0)
    for side in (-1, 1):
        arch = (side * (HALFW + 1.4 + 1.8), 3.6, WATER + 0.15, 1.25)
        x_a, x_b = sorted((side * HALFW, side * (XQ + 2.5)))
        dsub = KB.Deck(x_a, x_b, ZD, 0.0)
        bm = bmesh.new()
        KB._prism_xz(bm, [(x_a, BED), (x_b, BED), (x_b, ZD - 0.28), (x_a, ZD - 0.28)], -(WID / 2 + 1.3), WID / 2 + 1.3)
        cut = bmesh.new()
        pts = KB.arch_profile(arch[0], arch[1], arch[2], arch[3], 20)
        KB._prism_xz(cut, [(pts[0][0], BED - 1), (pts[-1][0], BED - 1)] + list(reversed(pts)), -WID, WID)
        part(KB._bool(bm, cut), QUAY, name='sub_body%d' % side)
        F.arch_ring(*arch, WID + 2.6, 'ashlar_limestone', depth=0.36, block=0.3, name='sub_vouss%d' % side)
        KB.cutwater(side * (HALFW + 0.7), 1.4, WID + 2.6, BED, ZD - 0.9, 'ashlar_limestone', upstream=-1, name='sub_cutwater%d' % side)
        for s_ in (-1, 1):
            KB.band(dsub, s_ * (WID / 2 + 1.3), x_a, x_b, -0.5, 0.18, 0.08, 'ashlar_limestone', name='sub_band%d%d' % (side, s_ + 1))
        BL.water_obstacle(BL.pier_outline(side * (HALFW + 0.7), 1.8, WID + 3.0), 'pier', 0.6, block=None)
        F.retaining_wings(dk, side * XQ, side, WID + 2.6, BED, WATER, 4.0, QUAY, 'ashlar_limestone', 'ashlar_limestone', 0.55)
for side in (-1, 1):
    xe = side * HALFW
    AL = (XQ + 2.5 - HALFW) if double else 5.6
    if not double:
        bm = bmesh.new()
        box_bm(bm, (xe + side * 2.8, 0, (BED + ZD - 0.1) / 2), (5.6, WID + 2.6, ZD - 0.1 - BED))
        part(bm, QUAY, name='abut%d' % side)
    bm = bmesh.new()
    box_bm(bm, (xe + side * 0.35, 0, ZD - 0.18), (0.8, WID + 2.8, 0.2))
    for s in (-1, 1):
        box_bm(bm, (xe + side * AL / 2, s * (WID / 2 + 1.2), ZD + 0.1), (AL, 0.4, 0.3))
    part(bm, 'granite', name='abut_coping%d' % side)
    bm = bmesh.new()
    for s in (-1, 1):
        for yy in (s * (WID / 2 + 0.6), s * 0.3):
            beam_bm(bm, (xe - side * 0.14, yy, BED + 0.3), (xe - side * 0.14, yy, ZD - 0.25), 0.26, 0.22)
    part(bm, 'timber_tarred', name='fenders%d' % side, uv='beam', axis=(0, 0, 1), grime=1.0)
    bm = bmesh.new()
    xb_ = side * (XQ + 1.5) if double else xe + side * 4.8
    cyl_bm(bm, (xb_, -(WID / 2 + 0.9), ZD), (xb_, -(WID / 2 + 0.9), ZD + 0.55), 0.14, 8, r1=0.18)
    part(bm, 'cast_iron', name='bollard')
    W.decal('moss_patch', (xe - side * 0.01, 1.4, WATER + 0.8), (-side, 0, 0), 2.0, 1.0, alpha=0.6)
    BL.water_obstacle([(xe, -WID / 2 - 1.3), (xe + side * 5.6, -WID / 2 - 1.3), (xe + side * 5.6, WID / 2 + 1.3), (xe, WID / 2 + 1.3)], 'abutment', 0.4)
if not double:     # single leaf: fixed landing on the far (west) abutment + lever stand on the east bank
    bm = bmesh.new()
    box_bm(bm, (-HALFW - 2.5, 0, ZD - 0.05), (5.0, WID + 0.3, 0.1))
    part(bm, 'deck_planks', name='landing_w', uv='beam', axis=(0, 1, 0), bisect=False)
    lx, ly = HALFW + 3.4, -(WID / 2 + 1.25)
    bm = bmesh.new()
    box_bm(bm, (lx, ly, ZD + 0.35), (0.7, 0.5, 0.7))
    cyl_bm(bm, (lx - 0.3, ly, ZD + 0.9), (lx + 0.3, ly, ZD + 0.9), 0.36, 12)            # gear wheel
    cyl_bm(bm, (lx - 0.45, ly, ZD + 0.9), (lx + 0.45, ly, ZD + 0.9), 0.06, 6)
    part(bm, 'cast_iron', name='winch_stand', grime=0.6)
    n0 = len(C.A.parts)
    bm = bmesh.new()
    beam_bm(bm, (lx + 0.5, ly, ZD + 0.9), (lx + 0.55, ly - 0.2, ZD + 2.1), 0.07, 0.07)
    cyl_bm(bm, (lx + 0.55, ly - 0.2, ZD + 2.05), (lx + 0.55, ly - 0.2, ZD + 2.3), 0.05, 6)
    part(bm, 'steel_painted', name='lever', tint=(0.7, 0.15, 0.12), grime=0.4, bisect=False)
    BL.mark_node(C.A.parts[n0:], 'lever', (lx + 0.5, ly, ZD + 0.9))
    anim['lever'] = {'pivot': [round(lx + 0.5, 3), round(ZD + 0.9, 3), round(-ly, 3)], 'axis_game': [1, 0, 0], 'throw_deg': 70}
    C.anchor('lever', (lx + 1.2, ly, ZD), (1, 0, 0), kind='interact_lever', target='leaf_e')
    C.footprint_rect(lx, ly, 0.9, 0.7, block='LOW', kind='lever_stand')
    K.sign((HALFW + 5.2, WID / 2 + 0.8, ZD + 1.4), (0, -1, 0), 0.9, 'achtung_minen' if False else 'halt_sperrgebiet', 'timber_grey')
else:              # operator's hut on the east quay
    hx0, hy0 = HALFW + 3.2, WID / 2 + 2.6
    bm = bmesh.new()
    box_bm(bm, (hx0, hy0, ZD + 1.15), (2.0, 1.8, 2.3))
    part(bm, 'timber_siding', name='hut', tint=(0.35, 0.45, 0.35))
    fr = None
    bm = bmesh.new()
    pts = [V((hx0 - 1.2, hy0 - 1.1, ZD + 2.3)), V((hx0 + 1.2, hy0 - 1.1, ZD + 2.3)), V((hx0 + 1.2, hy0 + 1.1, ZD + 2.3)), V((hx0 - 1.2, hy0 + 1.1, ZD + 2.3))]
    C.hexa_bm(bm, pts + [p + V((0, 0, 0.12)) for p in pts])
    part(bm, 'roof_shingle', name='hut_roof')
    bm = bmesh.new()
    box_bm(bm, (hx0, hy0 - 0.91, ZD + 1.5), (0.9, 0.04, 0.7))
    part(bm, 'glass_dirty', name='hut_window', bisect=False)
    C.footprint_rect(hx0, hy0, 2.0, 1.8, block='HIGH', kind='hut')
    C.anchor('switch', (hx0, hy0 - 1.0, ZD), (0, -1, 0), kind='interact_switch', target='leaf_w,leaf_e')
K.bridge_meta(K.Deck(-XQ - 5, XQ + 5, ZD, 0.0), -XQ - 5, XQ + 5, WID, WATER, 2 * XQ,
              {'kind': 'drawbridge_double' if double else 'drawbridge_lever', 'movable_span': [-HALFW, HALFW], 'deck_z': ZD,
               'water_x': [-XQ, XQ]})
C.A.meta['anim'] = anim
# ---- weathering: quay masonry tide mark / algae / run-off; timber grime, paint chipping (bare grey wood), rust bleed
F.weather(theme='temperate', deck=KB.Deck(-XQ - 5, XQ + 5, ZD + 0.3, 0.0), lichen=0.4, moss=0.6)
def chips(p, n, c):
    k = N.noise(p * 5.3 + V((1.3, 2.1, 0.7)))
    if white and k > 0.42:
        c = F._mul(c, (0.62, 0.58, 0.52))
    return c * (1 - 0.18 * max(0.0, N.noise(p * 1.6)))
F.weather(mids=('wood_paint', 'timber_beam', 'timber_tarred', 'timber_grey', 'deck_planks'), theme='temperate', lichen=0.25, step=99,
          moss=0.35, base=0.95, extra=chips, skip=('decal',))
for hx, tx, side in leaves:
    for s in (-1, 1):
        W.decal('streak_rust', (hx - side * 0.02, s * (WID / 2 + 0.45) - side * 0.0, ZD + HG * 0.8), (-side, 0, 0), 0.4, 1.4, alpha=0.6)
        W.decal('streak_rust', (tx + side * 0.25, s * (WID / 2 + 0.26), ZD - 0.35), (0, s, 0), 0.35, 0.7, alpha=0.6)
C.A.meta['crush_zone'] = [C.g2(p) for p in ((-HALFW, -WID / 2), (HALFW, -WID / 2), (HALFW, WID / 2), (-HALFW, WID / 2))]
F2.cull_decals()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
