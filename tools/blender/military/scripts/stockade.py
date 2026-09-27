"""Prisoner stockade kit (M10 desert cage, M17 Riveauvillé camp; Stalag-type): 12 m double barbed-wire fence (posts with
angled outriggers, horizontal + diagonal strands, concertina between the fences, warning rail inside, floodlight pole)
and a gate set (sally-port: outer + inner double gates with braced frames and wire mesh, guard hut, striped barrier
boom, sign, lamp). Towers = watchtower asset. Outside = south (-Y); segment runs along X centred on the pivot.
Variants: fence, gate, fence_desert, gate_desert (steel angle pickets, sand), fence_snow.
Usage: blender -b --factory-startup --python stockade.py -- [fence|gate|fence_desert|gate_desert|fence_snow] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('fence', 121)
DES = 'desert' in VAR
GATE = VAR.startswith('gate')
theater = 'desert' if DES else ('snow' if 'snow' in VAR else 'temperate')
K.begin('stockade_' + VAR, SEED, theater=theater, snow='snow' in VAR)
r = K.rng()
L = 12.0
YO, YI = -0.8, 0.8                       # outer / inner fence lines
HP = 2.7
POST = 'steel_galv' if DES else 'timber_grey'
PT = (0.55, 0.5, 0.45) if DES else (0.78, 0.76, 0.72)
GW = 4.2                                 # gate opening width (gate variant)


def post(bm, x, y, out):
    if DES:                                  # steel angle picket
        K.box_bm(bm, (x, y, HP / 2), (0.07, 0.07, HP + 0.1))
    else:
        K.box_bm(bm, (x, y, HP / 2 - 0.02), (0.14, 0.14, HP + 0.06))
    a = V((x, y, HP - 0.05))
    K.beam_bm(bm, a, a + V((0, out * 0.5, 0.5)), 0.06, 0.06)


def strands(bw, x0, x1, y, out, diag=True):
    for k in range(10):
        z = 0.15 + k * 0.27
        M.wire_line(bw, (x0, y, z), (x1, y, z), barbs=0.5 if k % 2 == 0 else 0)
    for k in range(3):                       # outrigger strands
        M.wire_line(bw, (x0, y + out * 0.17 * (k + 1), HP + 0.17 * (k + 1)), (x1, y + out * 0.17 * (k + 1), HP + 0.17 * (k + 1)), barbs=0.5)
    if diag:
        M.wire_line(bw, (x0, y, 0.15), (x1, y, HP - 0.1), barbs=0)
        M.wire_line(bw, (x0, y, HP - 0.1), (x1, y, 0.15), barbs=0)


spans = [(-L / 2, L / 2)] if not GATE else [(-L / 2, -GW / 2), (GW / 2, L / 2)]
bm, bw = bmesh.new(), bmesh.new()
for x0, x1 in spans:
    nb = max(1, int(round((x1 - x0) / 3.0)))
    xs = [x0 + (x1 - x0) * i / nb for i in range(nb + 1)]
    for y, out in ((YO, -1), (YI, 1)):
        for x in xs:
            post(bm, x, y, out)
        for a, b in zip(xs[:-1], xs[1:]):
            strands(bw, a, b, y, out)
    M.concertina(bw, (x0 + 0.2, 0.0, 0), (x1 - 0.2, 0.0, 0), radius=0.4, pitch=0.3, segs=8)
    if not GATE or True:                     # warning rail 3 m inside
        for x in xs[::2] + ([xs[-1]] if len(xs) % 2 == 0 else []):
            K.box_bm(bm, (x, 3.6, 0.3), (0.08, 0.08, 0.6))
        K.beam_bm(bm, (x0, 3.6, 0.55), (x1, 3.6, 0.55), 0.06, 0.06)
K.part(bm, POST, name='posts', uv='beam', axis=(0, 0, 1), mat_tint=PT)
M.wire_part(bw, 'wire')['kit_lod'] = 'keep'
if DES:
    M.berm([(-L / 2, YO - 0.3), (L / 2, YO - 0.3)], [(-L / 2, YO - 1.3), (L / 2, YO - 1.1)], 0.3, 'sand', 'drift', taper_end=0.25)
# floodlight pole
bm = bmesh.new()
px = -L / 2 + 1.5
K.cyl_bm(bm, (px, YI + 0.5, 0), (px, YI + 0.5, 4.6), 0.1, 8, r1=0.07)
K.beam_bm(bm, (px, YI + 0.5, 4.5), (px, YI - 0.2, 4.5), 0.05, 0.05)
K.cyl_bm(bm, (px, YI - 0.25, 4.55), (px, YI - 0.25, 4.3), 0.06, 8, r1=0.28)
K.part(bm, 'timber_tarred' if not DES else 'steel_galv', name='lamp_pole', smooth=True)
K.anchor('light', (px, YI - 0.25, 4.25), (0, -1, 0), kind='floodlight', radius=10.0)
K.footprint([(-L / 2, YO - 0.1), (L / 2, YO - 0.1), (L / 2, YI + 0.1), (-L / 2, YI + 0.1)] if not GATE else
            [(-L / 2, YO - 0.1), (-GW / 2, YO - 0.1), (-GW / 2, YI + 0.1), (-L / 2, YI + 0.1)], 'FENCE', 'wire_fence')
if GATE:
    K.footprint([(GW / 2, YO - 0.1), (L / 2, YO - 0.1), (L / 2, YI + 0.1), (GW / 2, YI + 0.1)], 'FENCE', 'wire_fence')
K.anchor('end_w', (-L / 2, 0, 0), (-1, 0, 0), kind='fence_joint')
K.anchor('end_e', (L / 2, 0, 0), (1, 0, 0), kind='fence_joint')
K.A().meta['modular'] = {'length': L, 'axis': 'x', 'outside': 'south'}

# ------------------------------------------------------------------ gate set
if GATE:
    bm = bmesh.new()
    for y in (YO, YI):
        for s in (-1, 1):
            K.box_bm(bm, (s * (GW / 2 + 0.1), y, 1.6), (0.22, 0.22, 3.6))
        K.box_bm(bm, (0, y, 3.35), (GW + 0.6, 0.2, 0.22))
        for s in (-1, 1):
            K.beam_bm(bm, (s * (GW / 2 + 0.1), y, 2.6), (s * (GW / 2 - 0.6), y, 3.3), 0.1, 0.1)
    K.part(bm, POST, name='gate_posts', uv='beam', axis=(0, 0, 1), mat_tint=PT)
    K.sign((0, YO - 0.12, 3.35), (0, -1, 0), 1.6, 'halt_sperrgebiet', 'timber_grey')
    ang = {('o', -1): 0.0, ('o', 1): 0.0, ('i', -1): 70.0, ('i', 1): 12.0}
    for tag, y in (('o', YO), ('i', YI)):
        for s in (-1, 1):
            hinge = V((s * (GW / 2 - 0.02), y, 0.08))
            lw, lh = GW / 2 - 0.06, 2.5
            bmf, bwm = bmesh.new(), bmesh.new()
            loc = [((0, 0.05), (lw, 0.05)), ((0, lh), (lw, lh)), ((0.04, 0), (0.04, lh)), ((lw - 0.04, 0), (lw - 0.04, lh)),
                   ((0.1, 0.1), (lw - 0.1, lh - 0.1)), ((0, lh / 2), (lw, lh / 2))]
            a = math.radians(ang[(tag, s)]) * (1 if tag == 'i' else -1)
            ca, sa = math.cos(a), math.sin(a)
            def W(u, z, s=s, hinge=hinge, ca=ca, sa=sa):
                d = V((-s * ca, s * sa if False else sa * (1 if s < 0 else -1) * 0 + sa, 0))
                d = V((-s * ca, sa, 0))
                return hinge + d * u + V((0, 0, z))
            for (u0, z0), (u1, z1) in loc:
                K.beam_bm(bmf, W(u0, z0), W(u1, z1), 0.09, 0.09)
            for k in range(1, 9):
                z = k * lh / 9
                M.wire_line(bwm, W(0.05, z), W(lw - 0.05, z), barbs=0)
            for k in range(1, 6):
                u = k * lw / 6
                M.wire_line(bwm, W(u, 0.08), W(u, lh - 0.05), barbs=0)
            M.wire_line(bwm, W(0.02, lh + 0.1), W(lw, lh + 0.1), barbs=0.3)
            node = 'door_gate_%s%d' % (tag, s + 1)
            o1 = K.part(bmf, 'timber_grey' if not DES else 'steel_galv', name=node + '_frame', node=node, uv='beam', axis=(0, 0, 1), mat_tint=PT)
            o2 = K.part(bwm, 'steel_galv', name=node + '_mesh', node=node, mat_tint=(0.55, 0.45, 0.38), grime=0, bisect=False)
            for o in (o1, o2):
                o['kit_pivot'] = list(hinge)
        K.door_meta('gate_' + tag, (0, y, 0), (0, -1, 0), GW, 2.6, kind='gate', node='door_gate_%s' % tag)
    # guard hut outside the gate (east)
    hp = [(GW / 2 + 1.2, YO - 4.4), (GW / 2 + 3.8, YO - 4.4), (GW / 2 + 3.8, YO - 1.4), (GW / 2 + 1.2, YO - 1.4)]
    hd = K.opening(hp, 3, 1.6, 0.85, 2.0, 0.1, 0.18, 'rect', 'door')
    hw = [K.opening(hp, 3, 0.55, 0.6, 0.8, 1.1, 0.18), K.opening(hp, 0, 1.3, 0.9, 0.8, 1.1, 0.18)]
    K.wall_ring(hp, 2.4, 0.18, 'timber_siding' if not DES else 'plaster_limewash', [hd] + hw, plinth=('concrete_bunker', 0.2, 0.03), name='hut')
    for f in hw:
        K.window(f, 'single', (2, 2), frame=(0.8, 0.78, 0.72), sill=None, lintel=None, curtain=0.2, name='hwin')
    K.door(hd, 'guard_hut', 'plank', (0.36, 0.32, 0.26), step='concrete_bunker')
    K.roof_shed(hp[0][0], hp[0][1], hp[2][0], hp[2][1], 2.35, 2.75, 'roof_shingle' if not DES else 'corrugated_rust', low_side='+x', oh=0.3, name='hut_roof')
    K.wall_lantern((GW / 2 + 1.2, YO - 2.1, 0), (-1, 0, 0), 2.2, name='hut_lamp')
    # barrier boom (black / white) across the approach
    bb = bmesh.new()
    bs = {0: bmesh.new(), 1: bmesh.new()}
    px, py = -GW / 2 - 0.8, YO - 5.0
    K.box_bm(bb, (px, py, 0.5), (0.25, 0.25, 1.0))
    K.box_bm(bb, (GW / 2 + 0.8, py, 0.45), (0.15, 0.25, 0.9))
    K.part(bb, 'timber_grey', name='boom_posts', mat_tint=PT)
    n = 8
    for i in range(n):
        x0 = px - 0.9 + i * (GW + 2.6) / n
        x1 = x0 + (GW + 2.6) / n
        K.cyl_bm(bs[i % 2], (x0, py, 1.0), (x1, py, 1.0), 0.06, 8)
    for i, b in bs.items():
        K.part(b, 'wood_paint', name='boom_%d' % i, mat_tint=[(0.12, 0.12, 0.12), (0.86, 0.85, 0.8)][i], smooth=True)
    K.anchor('barrier', (px, py, 1.0), (1, 0, 0), kind='barrier_boom', length=GW + 2.6)
    K.footprint(hp, 'HIGH', 'guard_hut')
    K.footprint([(-GW / 2, YO - 0.1), (GW / 2, YO - 0.1), (GW / 2, YI + 0.1), (-GW / 2, YI + 0.1)], 'NONE', 'gate_passage')
if 'snow' in VAR:
    K.snow_pass(thick=0.06, min_area=0.004)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40, recenter=False)
