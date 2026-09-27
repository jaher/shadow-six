"""M20 castle moat bridges (Gundelfingen, red Black-Forest sandstone). Road along X from the counterscarp (x<-8)
to the gate threshold (castle side, x>+8.5); moat still water at -3.0.
  moat_bridge_draw : two segmental sandstone arches + rounded pier, parapets, cobbles, then an open drawbridge pit
                     spanned by an iron-strapped oak leaf hinged at the gate threshold (node 'leaf', pivot at the
                     hinge, raises toward the gate) with lifting chains (node 'chains') to the gate wall.
  moat_bridge_fixed: three-arch sandstone bridge (kit stone_arch_bridge) re-tinted to red sandstone.
Both: scarp revetment walls at both ends with waterline/algae, water obstacles, iron-ring bollards."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V, part, box_bm, beam_bm, cyl_bm
import bmesh
import kit_weather as W
import kit_bridge as KB
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
from mathutils import noise as N
part = F.part
F.ALIAS.update({'sandstone_red_d': ('sandstone_ochre', (0.66, 0.41, 0.36), 0.55),
                'sandstone_red_c': ('sandstone_ochre', (0.82, 0.58, 0.5), 0.55)})
RED, RED_D, RED_C = 'sandstone_red', 'sandstone_red_d', 'sandstone_red_c'

a = BL.args()
name = a[0] if a else 'moat_bridge_draw'
fixed = name.endswith('fixed')
WATER, BED = -3.0, -5.2
SAND = (0.93, 0.66, 0.56)
K.begin(name, 20 if not fixed else 21, theater='temperate', water_level=WATER)
r = K.rng()
WID = 4.6


def sandstone():
    for o in C.A.parts:
        if o.name in bpy.data.objects and o.data.materials:
            m = o.data.materials[0]
            kid = m.get('kit_id', m.name) if m else ''
            if kid in ('ashlar', 'ashlar_limestone'):
                o.data.materials[0] = K.mat(kid, SAND if kid == 'ashlar' else (0.95, 0.78, 0.7))


import bpy
if fixed:
    B = F.stone_arch_bridge(spans=((5.0, 2.0), (5.6, 2.3), (5.0, 2.0)), pier_w=1.5, width=WID, water=WATER, bed=BED,
                            spring=-2.7, camber=0.3, abut=1.8, approach=2.5, body=RED, dressed=RED_D,
                            coping=RED_C, parapet_h=0.9, road_mid='cobblestone', kerb='granite', wing_len=5.5,
                            lamps=False, decals=False)
    XL, XR = -B['tot'] / 2, B['tot'] / 2
    piers = B['piers']
    for px in piers:
        BL.water_obstacle(BL.pier_outline(px, 1.5 + 0.36, WID + 0.36), 'pier', 0.3, block=None)
else:
    XL, XR, XPIT, XG = -8.0, 8.5, 4.2, 8.5
    deck = KB.Deck(XL - 2.0, XPIT, 0.05, 0.0)
    arches = [(-5.6, 4.8, -2.55, 1.75), (0.6, 4.8, -2.55, 1.75)]
    KB.masonry_body(deck, arches, WID, BED, RED)
    for ar in arches:
        F.arch_ring(*ar, WID, RED_D, depth=0.42, block=0.3)
    for s in (-1, 1):
        KB.band(deck, s * WID / 2, XL - 2.0, XPIT, -0.42, 0.2, 0.08, RED_C, name='band%d' % s)
        KB.parapet(deck, s * WID / 2, XL - 2.2, XPIT, 0.85, 0.4, RED, RED_C, name='parapet%d' % s)
    KB.road(deck, XL - 4.0, XPIT, WID - 0.8, 'cobblestone', 'granite')
    px = -2.5
    bm = bmesh.new()                                         # rounded pier ends (no current in a moat)
    for s in (-1, 1):
        cyl_bm(bm, (px, s * WID / 2, BED), (px, s * WID / 2, -1.2), 0.7, 12)
        cyl_bm(bm, (px, s * WID / 2, -1.2), (px, s * WID / 2, -0.8), 0.78, 12, r1=0.1)
        cyl_bm(bm, (px, s * WID / 2, BED), (px, s * WID / 2, WATER + 0.25), 0.92, 12)          # footing course
        cyl_bm(bm, (px, s * WID / 2, WATER + 0.25), (px, s * WID / 2, WATER + 0.4), 0.92, 12, r1=0.72)
    part(bm, RED_D, name='pier_ends')
    BL.water_obstacle([(px - 0.7, -WID / 2 - 0.7), (px + 0.7, -WID / 2 - 0.7), (px + 0.7, WID / 2 + 0.7), (px - 0.7, WID / 2 + 0.7)], 'pier', 0.2)
    # pit face (leaf rest) with iron rest plate
    bm = bmesh.new()
    box_bm(bm, (XPIT - 0.05, 0, 0.0), (0.3, WID - 0.2, 0.08))
    part(bm, 'cast_iron', name='rest_plate', bisect=False)
    W.decal('streak_rust', (XPIT + 0.01, 0.8, -1.0), (1, 0, 0), 0.8, 1.8, alpha=0.6)
    # gate threshold block (castle side) with hinge knuckles
    bm = bmesh.new()
    box_bm(bm, (XG + 1.0, 0, (BED + 0.0) / 2), (2.0, WID + 2.0, -BED))
    part(bm, RED, name='threshold')
    # leaf (node): framed oak leaf - side sills, heel / tip beams, cross beams + diagonal braces underneath, plank deck,
    # iron straps wrapping the tip, iron tip shoe, strap hinges on a pintle, chain eyes, worn wheel tracks
    n0 = len(C.A.parts)
    Ln = XG - XPIT - 0.05
    x0l, x1l = XPIT + 0.05, XG - 0.05
    bm = bmesh.new()
    nb = int(Ln / 0.28)
    for k in range(nb):
        x = x1l - (k + 0.5) * Ln / nb
        box_bm(bm, (x, r.uniform(-0.03, 0.03), -0.05), (Ln / nb - 0.012, WID - 0.5, 0.12))
    part(bm, 'deck_planks', name='leaf_planks', uv='beam', axis=(0, 1, 0), grime=0.8, bisect=False)
    bm = bmesh.new()
    for s in (-1, 1):
        beam_bm(bm, (x0l, s * (WID / 2 - 0.12), -0.12), (x1l, s * (WID / 2 - 0.12), -0.12), 0.24, 0.38)       # side sills
    beam_bm(bm, (x0l + 0.12, -WID / 2, -0.14), (x0l + 0.12, WID / 2, -0.14), 0.24, 0.34)                     # tip beam
    beam_bm(bm, (x1l - 0.14, -WID / 2, -0.16), (x1l - 0.14, WID / 2, -0.16), 0.28, 0.38)                     # heel beam
    for yy in (-0.75, 0.75):
        beam_bm(bm, (x0l + 0.2, yy, -0.3), (x1l - 0.2, yy, -0.3), 0.22, 0.28)                                 # joists
    for k in range(1, 4):
        x = x0l + Ln * k / 4
        beam_bm(bm, (x, -WID / 2 + 0.25, -0.4), (x, WID / 2 - 0.25, -0.4), 0.18, 0.2)                         # cross beams
    for k in range(4):
        xa, xb = x0l + Ln * k / 4 + 0.1, x0l + Ln * (k + 1) / 4 - 0.1
        for s in (-1, 1):
            beam_bm(bm, (xa, s * (WID / 2 - 0.3), -0.42), (xb, s * 0.75, -0.42), 0.1, 0.12)                    # braces
    part(bm, 'timber_beam', name='leaf_frame', uv='beam', axis=(1, 0, 0), grime=0.9, bisect=False, tint=(0.8, 0.74, 0.66))
    bm = bmesh.new()
    for yy in (-WID / 2 + 0.6, -0.8, 0.8, WID / 2 - 0.6):
        box_bm(bm, ((x0l + x1l) / 2 + 0.05, yy, 0.02), (Ln - 0.02, 0.1, 0.014))                             # straps
        box_bm(bm, (x0l - 0.005, yy, -0.12), (0.014, 0.1, 0.3))                                               # wrap over tip
        for k in range(9):
            xx = x0l + 0.2 + k * (Ln - 0.4) / 8
            cyl_bm(bm, (xx, yy, 0.02), (xx, yy, 0.045), 0.028, 5)                                              # bolt heads
    box_bm(bm, (x0l - 0.01, 0, 0.03), (0.1, WID - 0.3, 0.03))                                                 # tip shoe (angle)
    box_bm(bm, (x0l - 0.04, 0, -0.08), (0.03, WID - 0.3, 0.2))
    for s in (-1, 1):
        cyl_bm(bm, (x0l + 0.15, s * (WID / 2 - 0.3), 0.03), (x0l + 0.15, s * (WID / 2 - 0.3), 0.2), 0.09, 8)   # chain eyes
        box_bm(bm, (x0l + 0.5, s * (WID / 2 - 0.3), 0.02), (0.8, 0.14, 0.02))
    for yy in (-WID / 2 + 0.6, -0.8, 0.8, WID / 2 - 0.6):                                                      # strap hinges
        box_bm(bm, (x1l - 0.6, yy, -0.36), (1.2, 0.12, 0.018))
    part(bm, 'cast_iron', name='leaf_iron', bisect=False, grime=0.6)
    piv = (XG - 0.05, 0, -0.12)
    BL.mark_node(C.A.parts[n0:], 'leaf', piv)
    bm = bmesh.new()
    for yy in (-WID / 2 + 0.6, -0.8, 0.8, WID / 2 - 0.6):
        cyl_bm(bm, (XG + 0.02, yy - 0.2, -0.12), (XG + 0.02, yy + 0.2, -0.12), 0.12, 10)                      # knuckles
        box_bm(bm, (XG + 0.3, yy, -0.12), (0.5, 0.36, 0.1))                                                  # hinge seat
    cyl_bm(bm, (XG + 0.02, -WID / 2 + 0.2, -0.12), (XG + 0.02, WID / 2 - 0.2, -0.12), 0.045, 8)             # pintle
    part(bm, 'cast_iron', name='hinge_knuckles', bisect=False)
    # gate frame (node 'gate_frame', hide when the castle gatehouse asset provides its own): two sandstone gate piers
    # with iron pulley brackets and sheaves; the chains run from the leaf eyes over the sheaves down to counterweights
    n0 = len(C.A.parts)
    bm = bmesh.new()
    for s in (-1, 1):
        box_bm(bm, (XG + 0.75, s * (WID / 2 + 0.55), 2.3), (1.1, 1.0, 4.6))
    part(bm, RED, name='gate_piers')
    bm = bmesh.new()
    for s in (-1, 1):
        box_bm(bm, (XG + 0.75, s * (WID / 2 + 0.55), 4.68), (1.3, 1.2, 0.16))
        box_bm(bm, (XG + 0.75, s * (WID / 2 + 0.55), 4.86), (1.1, 1.0, 0.2), 0, (0.4, 0.4))
    part(bm, RED_C, name='gate_caps')
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * (WID / 2 - 0.3)
        beam_bm(bm, (XG + 0.35, s * (WID / 2 + 0.1), 4.15), (XG + 0.35, y - s * 0.08, 4.15), 0.12, 0.1)          # bracket arm
        beam_bm(bm, (XG + 0.35, s * (WID / 2 + 0.1), 3.5), (XG + 0.35, y - s * 0.08, 4.1), 0.06, 0.06)            # stay
        cyl_bm(bm, (XG + 0.35, y - 0.05, 3.95), (XG + 0.35, y + 0.05, 3.95), 0.24, 12)                          # sheave
        cyl_bm(bm, (XG + 0.35, y - 0.09, 3.95), (XG + 0.35, y + 0.09, 3.95), 0.05, 6)
        box_bm(bm, (XG + 0.6, y, 2.4), (0.34, 0.3, 0.6))                                                       # counterweight
    part(bm, 'cast_iron', name='gate_iron', bisect=False, grime=0.7)
    BL.mark_node(C.A.parts[n0:], 'gate_frame', None)
    n0 = len(C.A.parts)
    for s in (-1, 1):
        y = s * (WID / 2 - 0.3)
        F.chain((x0l + 0.15, y, 0.22), (XG + 0.35 - 0.2, y, 3.95 + 0.12), name='chain_lift%d' % (s + 1), link=0.15, wire=0.016)
        F.chain((XG + 0.35 + 0.24, y, 3.95), (XG + 0.6, y, 2.72), name='chain_cw%d' % (s + 1), link=0.15, wire=0.016)
    BL.mark_node(C.A.parts[n0:], 'chains', (XG + 0.35, 0, 3.95))
    for s in (-1, 1):
        W.decal('streak_rust', (XG + 0.75 - 0.56, s * (WID / 2 + 0.55), 3.4), (-1, 0, 0), 0.5, 1.6, alpha=0.55)
    g = lambda p: [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]
    C.A.meta['anim'] = {'leaf': {'pivot': g(piv), 'axis_game': [0, 0, 1], 'open_deg': 85, 'note': 'tip rises toward the gate'},
                        'chains': {'note': 'lift chains run leaf eye -> sheave (pivot); while the leaf rises rotate the lift chain '
                                           'about the sheave and scale its length to the eye; counterweight chains drop'},
                        'gate_frame': {'note': 'free-standing gate piers + sheaves; hide if the castle gatehouse provides them'}}
    C.anchor('chain_slot_n', (XG + 0.35, WID / 2 - 0.3, 3.95), kind='gate_wall_slot')
    C.anchor('chain_slot_s', (XG + 0.35, -WID / 2 + 0.3, 3.95), kind='gate_wall_slot')
    C.footprint_rect(XG + 0.75, WID / 2 + 0.55, 1.1, 1.0, block='HIGH', kind='gate_pier')
    C.footprint_rect(XG + 0.75, -WID / 2 - 0.55, 1.1, 1.0, block='HIGH', kind='gate_pier')
    piers = [px]
# scarp / counterscarp: battered, stepped retaining walls either side of the bridge (moat walls) + water obstacles
if not fixed:
    dk = KB.Deck(XL - 2.0, XPIT, 0.05, 0.0)
    for side, xf in ((-1, XL), (1, XR)):
        F.retaining_wings(dk, xf, side, WID if side < 0 else WID + 2.0, BED, WATER, 5.5, RED, RED_C, RED_D, 0.85)
for side, xf in ((-1, XL), (1, XR)):
    for s in (-1, 1):
        y0, y1 = s * (WID / 2 + 0.05), s * (WID / 2 + 6.0)
        BL.water_obstacle([(xf, y0), (xf + side * 0.9, y0), (xf + side * 0.9, y1), (xf, y1)], 'bank', 0.2, block=None)

def bedding(p, n, c):
    """Buntsandstein bedding: thin horizontal bands of lighter / purplish beds + cross-bedding, eroded softer beds."""
    b = N.noise(V((p.x * 0.12, p.y * 0.12, p.z * 2.6)))
    e = N.noise(V((p.x * 0.5, p.y * 0.5, p.z * 5.0)))
    c = F._mul(c, (1 + 0.1 * b, 1 + 0.06 * b, 1 + 0.12 * b))
    return c * (1 - 0.12 * max(0.0, e))
F.weather(theme='temperate', deck=KB.Deck(XL - 4, XR + 1, 0.05, 0.0) if not fixed else B['deck'], lichen=0.45, moss=0.6,
          soot=((XR + 1.0, 0, 2.5), 5.0, 1), extra=bedding, skip=('decal', 'snow', 'lamp', 'gate_iron'))
K.bridge_meta(K.Deck(XL - 4, XR + 1, 0.05, 0.0), XL - 4, XR + (0.5 if not fixed else 2.5), WID - 0.8, WATER, XR - XL,
              {'kind': 'moat_draw' if not fixed else 'moat_fixed', 'piers': piers,
               'movable_span': None if fixed else [4.2, 8.5], 'water_x': [XL, XR]})
F2.cull_decals()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
