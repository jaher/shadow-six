"""Castle gatehouse with moat bridge (M20 octagonal castle kit): rubble-stone gatehouse (10.4 x 9 m, 13 m) with an arched
passage, half-raised iron-shod portcullis, open double gates, machicolated crenellated parapets, bretèche over the arch,
blank heraldic shield, slate hip roof; two octagonal flanking towers with slate spires; timber drawbridge (separate
node, hinge pivot) over the drawbridge pit; two-arch masonry bridge across the wet moat (voussoir rings, cutwater,
string course, parapets with coping, cobbled cambered deck, kerbs), revetted scarp + counterscarp, splayed wing walls.
Outside = south (-Y); the bridge runs south from the gate. Variants: a, ruin (gate blown, drawbridge down in the moat).
Usage: blender -b --factory-startup --python castle_gate.py -- [a|ruin] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
import castle_lib as CL
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 95)
WATER, BED = -3.6, -5.2
K.begin('castle_gate' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost', water_level=WATER)
r = K.rng()
RUIN = VAR == 'ruin'
GX, GY0, GY1, GH = 5.2, -4.0, 5.0, 13.0

# ------------------------------------------------------------------ gatehouse body with the passage
bm = bmesh.new()
K.box_bm(bm, (0, (GY0 + GY1) / 2, (BED + GH) / 2), (2 * GX, GY1 - GY0, GH - BED))
body = K.part(bm, CL.STONE, name='gatehouse')
bm = bmesh.new()                                        # fill between the gatehouse and the land behind the scarp
passage = K.Frame((0, GY0 - 0.01, 0.0), (0, -1, 0), (1, 0, 0), 4.0, 5.6, GY1 - GY0 + 0.02, 'arch', 'door')
K.cut_object(body, CL._frame_cutter(passage))
CL.talus((-GX, GY0), (GX, GY0), (0, -1), BED, 1.5, 1.2, 0.2, name='gate_talus')
K.cut_object(K.A().parts[-1], M.cutter_box(-2.1, GY0 - 2, 0.0, 2.1, GY0 + 0.5, 6.0))
K.voussoirs(passage, CL.DRESS, depth=0.55, name='gate_voussoirs')
K.jamb_blocks(passage, CL.DRESS, name='gate_jambs')
bm = bmesh.new()
K.box_bm(bm, (0, (GY0 + GY1) / 2, 0.02), (4.0, GY1 - GY0, 0.06))
K.part(bm, 'cobblestone', name='passage_floor', grime=0.4)
bm = bmesh.new()                                        # portcullis grooves + murder-hole slot (dark)
for s in (-1, 1):
    K.box_bm(bm, (s * 2.005, -2.8, 2.8), (0.02, 0.22, 5.6))
K.box_bm(bm, (0, -1.6, 5.595), (3.4, 0.5, 0.02))
K.part(bm, 'interior_dark', name='grooves', grime=0, bisect=False)
# portcullis (oak lattice shod with iron, spiked foot), half raised
bm = bmesh.new()
zb = 2.9 if not RUIN else 0.0
for i in range(9):
    x = -1.8 + i * 0.45
    K.box_bm(bm, (x, -2.8, zb + 2.6), (0.12, 0.12, 5.2))
    K.cyl_bm(bm, (x, -2.8, zb), (x, -2.8, zb - 0.3), 0.06, 4, r1=0.0)
for k in range(7):
    K.box_bm(bm, (0, -2.72, zb + 0.3 + k * 0.78), (3.95, 0.1, 0.1))
K.part(bm, 'timber_tarred', name='portcullis', uv='beam', axis=(0, 0, 1))
gate = K.Frame((0, 1.5, 0), (0, -1, 0), (1, 0, 0), 4.0, 5.6, 0.4, 'arch', 'door')
K.door(gate, 'gate', 'double', (0.33, 0.24, 0.16), open_deg=78 if not RUIN else 0, step=None, lintel=None)
if RUIN:
    K.A().meta['doors'] = [d for d in K.A().meta['doors'] if d['id'] != 'gate']

# ------------------------------------------------------------------ parapets, bretèche, shield, windows, roof
CL.crenellation((-GX, GY0), (GX, GY0), (0, -1), GH, name='par_s')
CL.crenellation((GX, GY1), (-GX, GY1), (0, 1), GH, mach=0.0, name='par_n')
CL.crenellation((-GX, GY1), (-GX, GY0), (-1, 0), GH, mach=0.0, name='par_w', slits=False)
CL.crenellation((GX, GY0), (GX, GY1), (1, 0), GH, mach=0.0, name='par_e', slits=False)
bm = bmesh.new()                                        # bretèche: box balcony on corbels over the arch
p0, t, n = V((-1.6, GY0, 0)), V((1, 0, 0)), V((0, -1, 0))
CL.quad_block(bm, p0, t, n, 0, 3.2, -0.2, 1.1, 8.3, 10.6)
CL.quad_block(bm, p0, t, n, -0.1, 3.3, -0.2, 1.2, 10.6, 11.4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, CL.STONE, name='breteche')
bm = bmesh.new()
for u in (0.2, 1.0, 1.8, 2.6):
    for k, (dz, pj) in enumerate(((0.0, 0.35), (0.25, 0.7), (0.5, 1.1))):
        CL.quad_block(bm, p0, t, n, u, u + 0.4, -0.05, pj, 7.5 + dz, 7.78 + dz)
CL.quad_block(bm, p0, t, n, -0.15, 3.35, -0.25, 1.25, 11.4, 11.55)
# blank heraldic shield under the bretèche
sh = [(-0.55, 0.6), (0.55, 0.6), (0.55, 0.0), (0.0, -0.75), (-0.55, 0.0)]
ring0 = [V((x, GY0 - 0.02, 6.7 + z)) for x, z in sh]
ring1 = [V((x, GY0 - 0.2, 6.7 + z)) for x, z in sh]
K.loft_bm(bm, [ring1, ring0])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, CL.DRESS, name='breteche_dress')
bm = bmesh.new()
for x in (-0.9, 0.9):
    q = [V((x - 0.06, GY0 - 1.11, 9.2)), V((x + 0.06, GY0 - 1.11, 9.2)), V((x + 0.06, GY0 - 1.11, 10.3)), V((x - 0.06, GY0 - 1.11, 10.3))]
    bm.faces.new([bm.verts.new(p) for p in q])
K.part(bm, 'interior_dark', name='breteche_slits', grime=0, bisect=False)
CL.slit_cards((-GX, GY0), (-2.4, GY0), (0, -1), (4.0,), spacing=2.8, name='slits_w')
CL.slit_cards((2.4, GY0), (GX, GY0), (0, -1), (4.0,), spacing=2.8, name='slits_e')
wins = [K.Frame((x, GY1 + 0.01, z), (0, 1, 0), (-1, 0, 0), 0.8, 1.6, 1.2, 'pointed') for x in (-3.0, 3.0) for z in (10.0,)]
K.cut_object(body, CL._frames_cutter(wins))
for f in wins:
    K.window(f, 'casement', (1, 2), frame=(0.3, 0.26, 0.2), sill=CL.DRESS, lintel=CL.DRESS, surround=CL.DRESS, curtain=0.4, name='gwin')
R = K.roof_hip(0, 0.5, 9.9, 8.4, GH + 0.2, 50, 'roof_slate', eave_oh=0.05, thick=0.14, fascia=None, gutters=False, sag=0.02)
bm = bmesh.new()
K.prism_bm(bm, [(-GX + 0.1, GY0 + 0.1), (GX - 0.1, GY0 + 0.1), (GX - 0.1, GY1 - 0.1), (-GX + 0.1, GY1 - 0.1)], GH - 0.2, GH + 0.02)
K.part(bm, 'cobblestone', name='gate_walk', grime=0.3)
for s in (-1, 1):
    K.wall_lantern((s * 2.9, GY0 - 0.02, 0), (0, -1, 0), 4.2, name='gate_lamp')

# ------------------------------------------------------------------ flanking towers
for s in (-1, 1):
    CL.tower(s * 6.3, -2.6, 3.4, 15.5, z_bot=BED, door_n=None, quoin_dir=(s * 0.6, -0.8), windows=((6.0, 0.16, 1.4), (11.2, 0.6, 1.5)),
             roof=True, name='gtower%d' % (s + 1))

# ------------------------------------------------------------------ drawbridge (node door_drawbridge, hinge at the threshold)
HY = GY0 - 0.05
YE = -9.0                                                 # drawbridge rests on the north pier head
bm = bmesh.new()
lay = bm.loops.layers.uv.new('UVMap')
TB = K.MATS['timber_beam']['tile_m']
for i in range(16):                                       # oak planks with 20 mm gaps, grain along each plank
    x = -2.0 + i * 0.25 + 0.125
    nb = len(bm.faces)
    if not RUIN:
        K.box_bm(bm, (x, (HY + YE) / 2, -0.04 + r.uniform(-0.006, 0.006)), (0.23, HY - YE, 0.08))
    else:
        K.beam_bm(bm, (x, HY - 0.3, -0.6), (x + r.uniform(-0.2, 0.2), YE + 0.4, WATER + 0.1), 0.23, 0.08)
    bm.faces.ensure_lookup_table()
    K.uv_faces(bm, bm.faces[nb:], 'timber_beam', 'beam', axis=(0, 1, 0), rot90=True,
               offset=(0.1 + x / TB + 0.2 * r.randint(0, 4), r.random() * 3))
dbp = K.part(bm, 'timber_beam', name='drawbridge', node='door_drawbridge', uv='keep', mat_tint=(0.92, 0.8, 0.66), grime=0.6)
if not RUIN:
    dbp['kit_pivot'] = [0.0, HY, 0.0]
    bm = bmesh.new()
    for s in (-1, 1):                                     # iron edge plates, lifting chains to the chain slots
        K.beam_bm(bm, (s * 2.03, YE + 0.05, -0.02), (s * 2.03, HY, -0.02), 0.04, 0.14)
        K.cyl_bm(bm, (s * 2.0, YE + 0.25, 0.04), (s * 2.25, GY0 - 0.1, 7.6), 0.03, 4)
    for y in (YE + 0.35, (YE + HY) / 2, HY - 0.35):      # transverse iron straps with a bolt through every plank
        K.box_bm(bm, (0, y, 0.006), (4.0, 0.1, 0.014))
        for i in range(0, 16, 4):
            K.box_bm(bm, (-2.0 + i * 0.25 + 0.25, y, 0.02), (0.05, 0.05, 0.022))
    K.box_bm(bm, (0, YE + 0.06, -0.03), (4.06, 0.12, 0.1))      # iron shoe on the landing edge
    ir = K.part(bm, 'cast_iron', name='drawbridge_iron', node='door_drawbridge')
    ir['kit_pivot'] = [0.0, HY, 0.0]
    K.door_meta('drawbridge', (0.0, HY, 0.0), (0, -1, 0), 4.0, 0.3, kind='drawbridge', node='door_drawbridge')
    K.A().meta['doors'][-1].update({'hinge_axis': 'x', 'raise_deg': 80})
bm = bmesh.new()
for s in (-1, 1):
    q = [V((s * 2.25 - 0.12, GY0 - 0.01, 7.4)), V((s * 2.25 + 0.12, GY0 - 0.01, 7.4)), V((s * 2.25 + 0.12, GY0 - 0.01, 7.8)), V((s * 2.25 - 0.12, GY0 - 0.01, 7.8))]
    bm.faces.new([bm.verts.new(p) for p in q])
K.part(bm, 'interior_dark', name='chain_slots', grime=0, bisect=False)

# ------------------------------------------------------------------ masonry moat bridge (moat_bridge.py) + moat revetments
import moat_bridge as MB
bparts = MB.build(BED, WATER, RUIN)
if RUIN:                                                  # blown first arch at the drawbridge end
    K.bite((0.0, -11.2, -0.5), 1.7, (1.6, 1.3, 1.5), seed=2, parts=bparts)
K.footprint([(-1.55, -9.0), (1.55, -9.0), (1.55, -MB.S_RAMP), (-1.55, -MB.S_RAMP)], 'NONE', 'bridge_deck')
for yc in (-(MB.S_PIER[0] + MB.S_PIER[1]) / 2, -(MB.S_N + 0.75)):
    for s in (-1, 1):
        K.footprint([(s * 2.55, yc + 0.75), (s * 4.3, yc), (s * 2.55, yc - 0.75)], 'HIGH', 'cutwater')
K.footprint([(-2.0, GY0), (2.0, GY0), (2.0, -9.0), (-2.0, -9.0)], 'NONE', 'drawbridge')
MOAT_N, MOAT_S = -4.2, -MB.S_CS                            # water from the gatehouse talus to the counterscarp
bm = bmesh.new()                                          # counterscarp revetment (faces north), battered, with coping
for xa, xb in ((-18.0, -2.4), (2.4, 18.0)):
    K.hexa_bm(bm, [V((xa, MOAT_S - 0.9, BED)), V((xb, MOAT_S - 0.9, BED)), V((xb, MOAT_S + 0.5, BED)), V((xa, MOAT_S + 0.5, BED)),
                   V((xa, MOAT_S - 0.9, 0.25)), V((xb, MOAT_S - 0.9, 0.25)), V((xb, MOAT_S, 0.25)), V((xa, MOAT_S, 0.25))])
for s in (-1, 1):                                         # scarp revetment beyond the towers (curtain line), faces south
    xa, xb = s * 9.4, s * 18.0
    K.hexa_bm(bm, [V((xa, -3.2, BED)), V((xb, -3.2, BED)), V((xb, -5.6, BED)), V((xa, -5.6, BED)),
                   V((xa, -3.2, 0.3)), V((xb, -3.2, 0.3)), V((xb, -4.3, 0.3)), V((xa, -4.3, 0.3))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, CL.STONE, name='revetments')
bm = bmesh.new()
for xa, xb, y, w in ((-18.0, -2.6, MOAT_S - 0.35, 0.9), (2.6, 18.0, MOAT_S - 0.35, 0.9), (-18.0, -9.6, -3.8, 1.1), (9.6, 18.0, -3.8, 1.1)):
    n = int((xb - xa) / 2.4)
    for i in range(n):
        a, b = xa + (xb - xa) * i / n + 0.01, xa + (xb - xa) * (i + 1) / n - 0.01
        z = 0.25 if y < -10 else 0.3
        K.beam_bm(bm, (a, y, z + 0.08), (b, y, z + 0.08), w, 0.16)
K.part(bm, 'ashlar', name='revet_coping', mat_tint=MB.COP_TINT, smooth=False)
bm = bmesh.new()                                          # algae band + tide mark along the revetment faces at the water line
za, zb_ = WATER - 0.25, WATER + 0.26
yc = lambda z: MOAT_S + 0.5 - 0.5 * (z - BED) / (0.25 - BED) + 0.015          # counterscarp face (battered, faces N)
ys = lambda z: -5.6 + 1.3 * (z - BED) / (0.3 - BED) - 0.015                    # scarp face (faces S)
for xa, xb in ((-18.0, -2.4), (2.4, 18.0)):
    q = [bm.verts.new((xa, yc(za), za)), bm.verts.new((xa, yc(zb_), zb_)), bm.verts.new((xb, yc(zb_), zb_)), bm.verts.new((xb, yc(za), za))]
    bm.faces.new(q)
for s_ in (-1, 1):
    xa, xb = sorted((s_ * 9.4, s_ * 18.0))
    q = [bm.verts.new((xa, ys(za), za)), bm.verts.new((xb, ys(za), za)), bm.verts.new((xb, ys(zb_), zb_)), bm.verts.new((xa, ys(zb_), zb_))]
    bm.faces.new(q)
K.part(bm, 'fieldstone_grey', name='revet_algae', mat_tint=MB.ALGAE, grime=0.2, bisect=False)
bm = bmesh.new()                                          # grass verge behind the counterscarp coping + land beyond the curtain
K.box_bm(bm, (0, MOAT_S - 3.4, -0.02), (36.0, 5.2, 0.04))
K.part(bm, 'sod', name='verge', grime=0.2, bisect=False)

# ------------------------------------------------------------------ weathering, damage, metadata
def wl(c, n, w, h=1.5):                                   # waterline stain + algae band just above it
    n = V(n).normalized()
    K.decal('waterline', (c[0], c[1], WATER + 0.3), n, w, h, alpha=0.9)
    K.decal('moss_patch', (c[0] + n.x * 0.01, c[1] + n.y * 0.01, WATER + 0.55), n, w * 0.9, 0.7, alpha=0.7)
for x in (-3.4, 0.0, 3.4):
    if abs(x) > 2.3:
        wl((x, -4.93), (0, -0.98, 0.18), 2.4)
for s in (-1, 1):
    wl((s * 13.7, -5.2), (0, -0.9, 0.42), 8.0)
    for a in (-135, -90, -45):
        d = V((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        wl((s * 6.3 + d.x * 3.84, -2.6 + d.y * 3.84), d, 2.6)
    for yc, pw, nose in ((-(MB.S_PIER[0] + MB.S_PIER[1]) / 2, 1.4, 1.5), (-(MB.S_N + 0.75), 1.5, 1.2)):
        a, b = V((s * 2.55, yc - pw / 2 - 0.45, 0)), V((s * (2.55 + nose + 0.77), yc, 0))
        d = (b - a).normalized()
        n = V((d.y, -d.x, 0)) if V((d.y, -d.x, 0)).y < 0 else V((-d.y, d.x, 0))
        m = (a + b) / 2 + n * 0.03
        wl((m.x, m.y), n, (b - a).length)
for i in range(10):
    x = r.uniform(-GX + 0.3, GX - 0.3)
    if abs(x) < 2.4:
        continue
    K.decal(r.choice(['streak_long', 'lichen', 'streak_rain']), (x, GY0 - 0.01, r.uniform(6, 11)), (0, -1, 0), 1.2, 2.0, alpha=0.5)
if RUIN:
    import bpy
    def drop(pred):
        for o in [o for o in K.A().parts if pred(o)]:
            K.A().parts.remove(o)
            bpy.data.objects.remove(o)
    def centre(o):
        bb = [o.matrix_world @ V(b) for b in o.bound_box]
        return sum(bb, V()) / 8
    # east tower: spire burnt and fallen in, upper shaft hollow and broken open on the SE, crown ring broken there
    TX, TY, TR, TH = 6.3, -2.6, 3.4, 15.5
    drop(lambda o: o.name.startswith(('gtower2_spire', 'gtower2_floor')))
    WINS = []                                            # R4: remember the burnt-out windows for soot plumes above them
    for o in K.A().parts:
        if o.name.startswith(('gtower2_win', 'gtower0_win', 'gwin')) and 'lintel' not in o.name and 'sill' not in o.name:
            cc = centre(o)
            best = max(o.data.polygons, key=lambda p_: p_.area) if len(o.data.polygons) else None
            nrm = (o.matrix_world.to_3x3() @ best.normal).normalized() if best else V((0, -1, 0))
            if abs(nrm.z) < 0.5:
                if (V((cc.x, cc.y, 0)) - V((0, 0, 0))).dot(V((nrm.x, nrm.y, 0))) < 0:
                    nrm = -nrm
                WINS.append((cc, V((nrm.x, nrm.y, 0)).normalized()))
    drop(lambda o: o.name.startswith(('gtower2_win', 'gtower0_win', 'gwin')) and 'lintel' not in o.name and 'sill' not in o.name)   # burnt-out windows
    drop(lambda o: o.name.startswith(('gtower0_spire_finial', 'portcullis')))   # + portcullis blown out with the gate (budget)   # R4: vane of the snapped west spire (it floated over the stump)
    drop(lambda o: o.name.startswith('bridge_lamp'))      # lamp standards shot away
    shaft = [o for o in K.A().parts if o.name.startswith('gtower2_shaft')][0]
    c = bmesh.new()
    K.prism_bm(c, K.ccw(CL.octagon(TX, TY, TR - 1.3)), 9.0, TH + 4.0)
    K.cut_object(shaft, c)
    def in_breach(o, a0=-100, a1=10):
        p = centre(o) - V((TX, TY, 0))
        a = math.degrees(math.atan2(p.y, p.x))
        return a0 < a < a1 and p.z > TH - 1.5
    drop(lambda o: o.name.startswith('gtower2_par') and in_breach(o))
    K.bite((TX + 2.0, TY - 2.4, TH + 0.5), 2.2, (1.2, 1.2, 1.9), seed=11)
    K.bite((TX + 3.0, TY - 0.2, TH - 0.6), 1.5, (1.0, 1.0, 1.4), seed=12)
    bm = bmesh.new()                                      # charred spire rafters: stubs leaning out of the broken top
    for k in range(6):
        a = math.radians(-160 + k * 45 + r.uniform(-12, 12))
        p0 = V((TX + math.cos(a) * (TR - 1.5), TY + math.sin(a) * (TR - 1.5), TH - 0.4))
        p1 = V((TX + math.cos(a) * 0.4, TY + math.sin(a) * 0.4, TH + r.uniform(1.6, 3.2)))
        K.beam_bm(bm, tuple(p0), tuple(p1), 0.2, 0.22, roll=r.random())
    K.part(bm, 'timber_tarred', name='charred_rafters', mat_tint=(0.36, 0.33, 0.31), grime=0.2)
    # west tower: spire snapped at mid height (upper cone gone, open rafters), scorched
    K.bite((-TX, TY, TH + 5.4), 2.6, (1.3, 1.3, 1.1), seed=13, parts=[o for o in K.A().parts if o.name.startswith('gtower0_spire')])
    bm = bmesh.new()
    for k in range(5):
        a = math.radians(20 + k * 70)
        K.beam_bm(bm, (-TX + math.cos(a) * 1.4, TY + math.sin(a) * 1.4, TH + 3.2), (-TX + math.cos(a) * 0.3, TY + math.sin(a) * 0.3, TH + 5.4 + r.uniform(0, 0.8)), 0.14, 0.16)
    K.part(bm, 'timber_tarred', name='charred_rafters', mat_tint=(0.36, 0.33, 0.31), grime=0.2)
    # gatehouse: roof holed with rafters showing, merlons shot away, gate blown and the passage scorched
    for bx, by in ((-3.9, GY0), (-0.6, GY0), (3.4, GY0), (GX, -1.8), (GX, 2.9), (-GX, 0.6)):
        K.bite((bx, by, GH + 1.3), 0.95, (1.1, 1.1, 1.3), seed=int(bx * 7 + by * 3) % 97)
    drop(lambda o: o.name.startswith('door_gate_leaf'))            # gate leaves blown off their pintles
    K.bite((0.0, GY0, 4.5), 2.8, (1.4, 1.2, 1.3), seed=7, parts=[body] + [o for o in K.A().parts if o.name.startswith(('gate_', 'breteche', 'portcullis', 'door_gate'))])
    import kit_weather as KW                             # roof holes AFTER the bites (rafters must not be cut)
    KW.roof_holes(R, [(1.6, -0.8, 2.1), (-2.6, 1.4, 1.4)])
    K.decal('soot', (0.0, GY0 - 0.03, 5.8), (0, -1, 0), 7.5, 7.0, alpha=0.95)
    K.decal('soot', (0.0, GY0 - 0.03, 9.2), (0, -1, 0), 5.0, 4.0, alpha=0.8)
    K.decal('soot', (0.0, 0.5, 0.06), (0, 0, 1), 3.8, 8.5, up=(0, 1, 0), alpha=0.9)
    for s_ in (-1, 1):
        K.decal('soot', (s_ * 1.98, 0.5, 2.8), (-s_, 0, 0), 8.0, 5.0, alpha=0.85)
        K.decal('soot', (TX * s_ + s_ * 0.2, TY - TR * 0.95, TH - 2.0), (0, -1, 0), 3.0, 4.0, alpha=0.85)
    # bridge: east parapet of the landward span thrown into the moat, first arch half blown (west half still passable)
    def _alive(o):
        try:
            return o.name in bpy.data.objects
        except ReferenceError:
            return False
    bparts = [o for o in bparts if _alive(o)]
    K.bite((2.75, -21.0, 1.5), 1.2, (1.0, 1.9, 1.0), seed=21, parts=bparts)
    K.bite((1.9, -12.4, -0.9), 2.2, (1.0, 1.3, 1.1), seed=22, parts=bparts)
    # rubble: in the passage, in the moat under the tower and the bridge breaks (grey masonry scree, stones show above water)
    M.rubble((0.0, 3.0, 0.05), 3.0, 1.2, mids=(CL.STONE, CL.DRESS), n=7, beams=2, tiles=None, block_tint=(0.8, 0.8, 0.78), pile=True)
    M.rubble((8.4, -7.2, BED), 3.4, 3.2, mids=(CL.STONE, CL.DRESS), n=8, beams=2, tiles='roof_slate', footprint=False, mound_tint=(0.62, 0.64, 0.6), pile=True)
    M.rubble((4.2, -21.0, BED), 1.8, 2.7, mids=(CL.DRESS, CL.STONE), n=6, beams=0, tiles=None, footprint=False, mound_tint=(0.62, 0.64, 0.6), pile=True)
    M.rubble((2.6, -12.4, BED), 2.2, 2.9, mids=(CL.STONE, CL.DRESS), n=6, beams=0, tiles=None, footprint=False, mound_tint=(0.62, 0.64, 0.6), pile=True)
    K.footprint([(2.6, -12.4 - 1.6), (4.8, -12.4), (2.6, -12.4 + 1.6), (0.2, -12.4)], 'HIGH', 'bridge_breach')
    K.scorch_openings(1.4, 1.0)
    M.DECAL_RIM = 0.6
    for cc, nrm in WINS:                                 # R4: soot licking up the wall from every burnt-out window
        K.decal('soot', tuple(cc + nrm * 0.05 + V((0, 0, 1.3))), tuple(nrm), 2.2, 3.6, alpha=0.97)
    for sx_, sy_ in ((-GX, GY0), (GX, GY0), (-GX, GY1), (GX, GY1)):          # cracked quoins on the gatehouse corners
        for nrm in ((0, -1 if sy_ == GY0 else 1, 0), (1 if sx_ > 0 else -1, 0, 0)):
            off = V(nrm) * 0.02 + V((-0.35 * (1 if sx_ > 0 else -1), 0, 0) if nrm[0] == 0 else (0, 0.35 * (1 if sy_ < 0 else -1), 0))
            K.decal('crack', tuple(V((sx_, sy_, r.uniform(3.0, 7.0))) + off), nrm, 0.9, 2.6, alpha=0.8)
    for k in range(4):                                   # more merlons shot away on the gatehouse and tower parapets
        bx, by = r.choice(((r.uniform(-GX + 0.8, GX - 0.8), GY0), (r.uniform(-GX + 0.8, GX - 0.8), GY1), (GX, r.uniform(GY0 + 0.8, GY1 - 0.8)), (-GX, r.uniform(GY0 + 0.8, GY1 - 0.8))))
        K.bite((bx, by, GH + 1.2), 0.7, (1.0, 1.0, 1.2), seed=70 + k)
    for s_ in (-1, 1):
        for k, fk in enumerate((-1, -2, -3, -2, -1, -3)):  # smoke-blackened tower shafts: plumes on the S / SE / SW faces
            a = fk * math.pi / 4
            K.decal('soot', (s_ * TX + math.cos(a) * (TR * 0.924 + 0.03), TY + math.sin(a) * (TR * 0.924 + 0.03), 4.5 + k * 1.7 + r.uniform(0, 1.0)),
                    (math.cos(a), math.sin(a), 0), 2.3, 3.8, alpha=0.9)
            if k < 3:
                K.decal('crack', (s_ * TX + math.cos(a) * (TR * 0.924 + 0.035), TY + math.sin(a) * (TR * 0.924 + 0.035), r.uniform(3.0, 9.0)),
                        (math.cos(a), math.sin(a), 0), 1.2, 2.4, alpha=0.8)
    for x_, z_ in ((-3.6, 10.2), (3.4, 9.6), (-1.2, 11.8), (2.0, 7.6)):   # gatehouse facade: fire plumes up to the parapet
        K.decal('soot', (x_, GY0 - 0.035, z_), (0, -1, 0), 2.6, 3.4, alpha=0.9)
    M.DECAL_RIM = 0.0
    K.anchor('fire', (0.0, 1.0, 0.5), kind='smoulder')
    K.anchor('fire2', (TX, TY, TH), kind='smoulder')
K.footprint([(-GX, GY0), (-2.0, GY0), (-2.0, GY1), (-GX, GY1)], 'HIGH', 'gatehouse')
K.footprint([(2.0, GY0), (GX, GY0), (GX, GY1), (2.0, GY1)], 'HIGH', 'gatehouse')
K.footprint([(-2.0, GY0), (2.0, GY0), (2.0, GY1), (-2.0, GY1)], 'NONE', 'gate_passage')
K.roof_meta([(-GX + 0.4, GY0 + 0.4), (GX - 0.4, GY0 + 0.4), (GX - 0.4, GY1 - 0.4), (-GX + 0.4, GY1 - 0.4)], GH, walkable=False, kind='gatehouse_roof')
K.A().meta['moat'] = {'water_level': WATER, 'bed': BED, 'scarp_z': 4.2, 'counterscarp_z': MB.S_CS, 'axis': 'x'}
K.A().meta['moat_bridge'] = {'deck': [[0.0, 9.0], [0.0, MB.S_RAMP]], 'deck_top': round(MB.zd(0.6), 3), 'water_level': WATER,
                        'river_width': round(MB.S_CS - 4.2, 2), 'spans': [[10.2, 16.4], [17.8, 24.0]], 'piers': [[8.7, 10.2], [16.4, 17.8]],
                        'axis': 'z', 'width': 4.2}
K.A().meta['review_water'] = {'level': WATER, 'bed': BED, 'rects': [[-60, 4.2, 60, MB.S_CS]]}
K.anchor('portcullis', (0, -2.8, 2.9), (0, -1, 0), kind='portcullis', raised=True)          # R4: ruin: portcullis blown out -> passage open
M.finalize(M.outdir(K.A().name), ao_res=512 if RUIN else 896, ao_samples=40, recenter=False)
