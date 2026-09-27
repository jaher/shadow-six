"""M13 harbour lock head (Le Havre), reworked: dressed-stone lock walls with a heavy granite coping (bull-nosed,
jointed blocks), hollow quoins, gate recesses and ladder recesses, a pair of timber-framed mitre gates (heel / mitre
posts, rails, vertical plank skin, iron diagonal strap, paddle frames + rack-and-pinion paddle gear), each with a
long BALANCE BEAM (the defining lock silhouette) and a plank walkway with an iron handrail; raised sett foot-stops
in an arc where the lock-keeper pushes the beam, capstans, bollards, lamps, control shack; tide-mark / algae
weathering at both pool levels. Upper pool (-Y, level -1.0) / lower pool (+Y, -4.0).
Nodes gate_w / gate_e (leaf + balance beam) pivot at the quoins (rotate about game Y; open = into the recess).
Variants: lock_gates | lock_gates_open."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
from brlib import K, C, V, box_bm, beam_bm, cyl_bm
import bmesh
from mathutils import Matrix, noise as N
import kit_weather as W
from kit_bridge import lamp_post
part = F.part

a = BL.args()
name = a[0] if a else 'lock_gates'
opened = name.endswith('_open')
UP, LOW, FLOOR = -1.0, -4.0, -9.0
HW, WW, YL = 6.0, 4.0, 14.0
MITRE = math.radians(18)
K.begin(name, 13, theater='coast', water_level=LOW)
r = K.rng()
REC0, REC1, RD = 0.4, 7.2, 0.9
LADDERS = (-7.5, 10.5)
F2.AO_GROUND.update({'banks': (-HW, HW), 'water': LOW, 'z_bank': -0.32})   # below the paved lock sides (top -0.01)
F.ALIAS.update({'lock_stone': ('ashlar', (0.66, 0.65, 0.61), 1.0), 'setts': ('cobblestone', (0.7, 0.68, 0.66), 0.6)})
for s in (-1, 1):
    face = [(s * HW, YL)]                                     # chamber face from +YL to -YL with recesses
    for y0, y1, dp in sorted([(REC0, REC1, RD)] + [(ly * (s if ly < 0 else 1) - 0.45, ly * (s if ly < 0 else 1) + 0.45, 0.28) for ly in LADDERS],
                             key=lambda t: -t[0]):
        face += [(s * HW, y1), (s * (HW + dp), y1), (s * (HW + dp), y0), (s * HW, y0)]
    face += [(s * HW, -YL)]
    poly = face + [(s * (HW + WW), -YL), (s * (HW + WW), YL)]
    bm = bmesh.new()
    C.prism_bm(bm, C.ccw(poly), FLOOR - 0.6, -0.3)
    part(bm, 'lock_stone', name='wall%d' % s)
    cp = bmesh.new()                                          # coping: jointed granite blocks, bull-nose over the face
    for (xa, ya), (xb, yb) in zip(face[:-1], face[1:]):
        Lseg = math.hypot(xb - xa, yb - ya)
        if Lseg < 0.2:
            continue
        nb = max(1, int(Lseg / 1.2))
        dx, dy = (xb - xa) / Lseg, (yb - ya) / Lseg
        nx, ny = -dy, dx
        mx, my = (xa + xb) / 2, (ya + yb) / 2
        if not F._pip((mx + nx * 0.3, my + ny * 0.3), poly):
            nx, ny = -nx, -ny                                # n points into the wall mass
        for k in range(nb):
            ta, tb = k / nb * Lseg + 0.01, (k + 1) / nb * Lseg - 0.01
            cx, cy = xa + dx * (ta + tb) / 2 + nx * 0.4, ya + dy * (ta + tb) / 2 + ny * 0.4
            box_bm(cp, (cx, cy, -0.12), (abs(dx) * (tb - ta) + abs(nx) * 0.95 + 0.001, abs(dy) * (tb - ta) + abs(ny) * 0.95 + 0.001, 0.36))
    part(cp, 'granite', name='coping%d' % s)
    bm = bmesh.new()
    box_bm(bm, (s * (HW + WW / 2 + 0.45), 0, -0.16), (WW - 0.9, 2 * YL, 0.3))           # paved lock side behind the coping
    part(bm, 'setts', name='lockside%d' % s, bisect=False, lod='keep')
    bm = bmesh.new()
    for y in [-12.0, -9.0, -4.5, 12.5]:
        beam_bm(bm, (s * (HW - 0.1), y, FLOOR + 1.0), (s * (HW - 0.1), y, -0.4), 0.25, 0.2)
    part(bm, 'timber_tarred', name='rubbing%d' % s, uv='beam', axis=(0, 0, 1), grime=1.0)
    for ly in LADDERS:
        y = ly * (s if ly < 0 else 1)
        BL.iron_ladder(s * (HW + 0.28), y, LOW - 0.6, -0.3, (-s, 0, 0), top_pos=(s * (HW + 0.9), y, 0.0))
    BL.water_obstacle([(s * HW, -YL), (s * (HW + WW), -YL), (s * (HW + WW), YL), (s * HW, YL)], 'lock_wall', 0.3, block=None)
    C.climb_meta((s * HW, -YL), (s * HW, YL), 0.0, 'quay_edge')
bm = bmesh.new()
box_bm(bm, (0, -1.3, FLOOR + 0.3), (2 * HW, 1.6, 0.6))
part(bm, 'granite', name='sill')
# ---------------- timber mitre gates with balance beams (nodes)
anim = {}
ztop = 0.25
for s in (-1, 1):
    tag = 'e' if s > 0 else 'w'
    n0 = len(C.A.parts)
    hinge = V((s * (HW + 0.3), 0.0, 0))
    d = V((-s * math.cos(MITRE), -math.sin(MITRE), 0))
    nrm = V((d.y, -d.x, 0))
    if nrm.y > 0:
        nrm = -nrm                                          # upstream (skin) side
    L = (HW + 0.3) / math.cos(MITRE) - 0.03
    ang = math.atan2(d.y, d.x)
    mid = hinge + d * L / 2
    fr = bmesh.new()
    for t, w_ in ((0.25, 0.5), (L - 0.22, 0.44)):                                                     # heel / mitre posts
        box_bm(fr, tuple(hinge + d * t + V((0, 0, (FLOOR + ztop + 0.15) / 2))), (w_, 0.62, ztop + 0.15 - FLOOR), rot_z=ang)
    for z in (FLOOR + 0.35, FLOOR + 2.6, UP - 1.4, UP + 0.2, ztop - 0.12):                               # rails
        box_bm(fr, tuple(mid - nrm * 0.02 + V((0, 0, z))), (L - 0.4, 0.5, 0.32), rot_z=ang)
    for k in (1, 2):                                                                                   # muntins
        box_bm(fr, tuple(hinge + d * (L * k / 3) - nrm * 0.05 + V((0, 0, (FLOOR + ztop) / 2))), (0.24, 0.42, ztop - FLOOR - 0.3), rot_z=ang)
    part(fr, 'timber_beam', name='gate_frame_%s' % tag, uv='beam', axis=(0, 0, 1), grime=1.0, tint=(0.78, 0.72, 0.64))
    sk = bmesh.new()                                                                                   # vertical plank skin
    box_bm(sk, tuple(mid + nrm * 0.27 + V((0, 0, (FLOOR + ztop) / 2))), (L - 0.3, 0.08, ztop - FLOOR), rot_z=ang)
    part(sk, 'deck_planks', name='gate_skin_%s' % tag, rot90=True, grime=1.1, tint=(0.72, 0.66, 0.58))
    ir = bmesh.new()
    beam_bm(ir, hinge + d * 0.45 - nrm * 0.27 + V((0, 0, FLOOR + 0.5)), hinge + d * (L - 0.4) - nrm * 0.27 + V((0, 0, ztop - 0.25)), 0.03, 0.2, up=tuple(nrm))
    for k in range(2):                                                                                 # paddle frames + rack rods
        pc = hinge + d * (L * (0.45 + 0.25 * k)) - nrm * 0.3
        box_bm(ir, tuple(pc + V((0, 0, UP - 2.0))), (0.9, 0.06, 0.8), rot_z=ang)
        cyl_bm(ir, pc + V((0, 0, UP - 1.6)), pc + V((0, 0, ztop + 1.0)), 0.035, 5)
        box_bm(ir, tuple(pc + V((0, 0, ztop + 0.5))), (0.28, 0.2, 0.62), rot_z=ang)                   # pinion stand
        cyl_bm(ir, pc + V((0, 0, ztop + 0.72)) - d * 0.2, pc + V((0, 0, ztop + 0.72)) + d * 0.2, 0.16, 10)   # gear wheel
        cyl_bm(ir, pc + V((0, 0, ztop + 0.72)) - nrm * 0.1, pc + V((0, 0, ztop + 0.72)) - nrm * 0.45, 0.03, 5)  # windlass spindle
    part(ir, 'cast_iron', name='gate_iron_%s' % tag, grime=0.8, bisect=False)
    wk = bmesh.new()
    box_bm(wk, tuple(mid - nrm * 0.22 + V((0, 0, ztop + 0.08))), (L - 0.2, 0.9, 0.08), rot_z=ang)
    part(wk, 'timber_grey', name='gate_walk_%s' % tag, uv='beam', axis=tuple(nrm), bisect=False)
    F.period_railing(hinge + d * 0.6 - nrm * 0.62 + V((0, 0, ztop + 0.12)), hinge + d * (L - 0.1) - nrm * 0.62 + V((0, 0, ztop + 0.12)),
                     1.0, 1.4, 'steel_painted', (0.22, 0.22, 0.22), name='gate_rail_%s' % tag, style='flat', post=0.06)
    bb = bmesh.new()                                                                                   # balance beam
    b0 = hinge + d * 0.9 + V((0, 0, ztop + 0.45))
    b1 = hinge - d * 6.4 + V((0, 0, ztop + 0.55))
    beam_bm(bb, b0, b1, 0.42, 0.44)
    beam_bm(bb, hinge + d * 0.25 + V((0, 0, ztop + 0.15)), hinge + d * 0.25 + V((0, 0, ztop + 0.3)), 0.4, 0.4)
    part(bb, 'timber_grey', name='balance_beam_%s' % tag, uv='beam', axis=tuple(d), grime=0.8, tint=(0.8, 0.78, 0.74))
    bw = bmesh.new()
    for t in (1.3, 3.5, 5.8):
        p = hinge - d * t + V((0, 0, ztop + 0.52))
        box_bm(bw, tuple(p), (0.07, 0.47, 0.49), rot_z=ang)                                          # iron bands
    box_bm(bw, tuple(b1 - d * 0.02), (0.06, 0.46, 0.46), rot_z=ang)
    part(bw, 'wood_paint', name='beam_bands_%s' % tag, tint=(0.92, 0.92, 0.9), grime=0.5, bisect=False)
    piv = (hinge.x, hinge.y, 0.0)
    BL.mark_node(C.A.parts[n0:], 'gate_' + tag, piv)
    beam_end = hinge - d * 6.2
    if opened:
        M = Matrix.Translation(V(piv)) @ Matrix.Rotation(math.radians(-s * 108), 4, 'Z') @ Matrix.Translation(-V(piv))
        for o in C.A.parts[n0:]:
            o.data.transform(M)
        beam_end = M @ beam_end
    g = lambda p: [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]
    anim['gate_' + tag] = {'pivot': g(piv), 'axis_game': [0, 1, 0], 'open_deg': -108 * s, 'state': 'open' if opened else 'closed',
                           'note': 'leaf + balance beam rotate together about +Y (game); the keeper pushes the beam end'}
    C.anchor('gate_beam_%s' % tag, tuple(beam_end), (0, 1, 0), kind='interact_lock', target='gate_' + tag)
    sb = bmesh.new()                                                                                   # raised granite foot-stops
    a_0, a_sw = ang + math.pi, math.radians(-s * 108)
    for k in range(16):
        a0 = a_0 + a_sw * k / 15
        p = hinge + V((math.cos(a0), math.sin(a0), 0)) * 5.6
        box_bm(sb, (p.x, p.y, 0.03), (0.3, 0.62, 0.1), rot_z=a0)
    part(sb, 'granite', name='footstops_%s' % tag, bisect=False, tint=(1.1, 1.08, 1.04))
    pv = bmesh.new()                                                                                   # sett-paved quadrant the beam sweeps
    ring = []
    for k in range(19):
        a0 = a_0 + (a_sw * 1.06) * (k / 18) - a_sw * 0.06
        ring.append(hinge + V((math.cos(a0), math.sin(a0), 0)) * 7.0)
    pts = [(hinge.x, hinge.y)] + [(q.x, q.y) for q in ring]
    C.prism_bm(pv, C.ccw(pts), -0.3, -0.005)
    part(pv, 'setts', name='sweep_pave_%s' % tag, bisect=False, lod='keep')
    for y in (-11.0, 8.0):
        bm = bmesh.new()
        c0 = V((s * (HW + 0.9), y, 0.0))
        cyl_bm(bm, c0, c0 + V((0, 0, 0.5)), 0.2, 10, r1=0.17)
        cyl_bm(bm, c0 + V((0, 0, 0.5)), c0 + V((0, 0, 0.62)), 0.26, 10, r1=0.24)
        part(bm, 'cast_iron', name='bollard')
    bm = bmesh.new()                                                                                   # capstan
    c0 = V((s * (HW + 2.4), 4.6, 0.0))                          # clear of the beam sweep
    cyl_bm(bm, c0, c0 + V((0, 0, 0.8)), 0.32, 12, r1=0.26)
    cyl_bm(bm, c0 + V((0, 0, 0.8)), c0 + V((0, 0, 0.95)), 0.4, 12)
    part(bm, 'cast_iron', name='capstan')
    lamp_post((s * (HW + 3.6), 3.4, 0.0), 4.2, name='lamp')
BL.control_shack(HW + 2.4, -9.0, 3.0, 2.6, 2.7, 'brick_red', 'lock_shack', door_edge=3, door_color='green')
K.sign((HW + 2.4, -9.0 - 1.3 - 0.03, 2.0), (0, -1, 0), 1.0, 'halt_sperrgebiet', 'timber_grey')
K.bridge_meta(K.Deck(-HW - WW, HW + WW, 0.3, 0.0), -HW, HW, 0.9, LOW, 2 * HW,
              {'kind': 'lock_head', 'reservoir': {'level': UP, 'z0': 1.9, 'z1': 400.0}, 'upper_level': UP, 'lower_level': LOW,
               'crossing': 'walkway on top of the closed gate leaves (deck_top 0.33)'})
C.A.meta['footprints'] = [f for f in C.A.meta['footprints'] if f.get('kind') != 'bridge_deck']
for s in (-1, 1):
    h = (s * (HW + 0.3), 0.0)
    m = (0.0, -math.tan(MITRE) * (HW + 0.3))
    C.footprint([(h[0], h[1] - 0.5), (m[0], m[1] - 0.5), (m[0], m[1] + 0.5), (h[0], h[1] + 0.5)], 'NONE', 'bridge_deck')
C.A.meta['anim'] = anim
C.A.meta['review'] = {'detail': {'target': [3.0, -0.6, 1.2], 'dir': [0.4, 0.55, 0.73], 'dist': 13.0}}
C.anchor('boat_path', (0, -YL - 10, UP), (0, 1, 0), kind='boat', end=[0.0, LOW, -(YL + 10)])


def upper_pool(p, n, c):
    """Second tide mark / algae band at the upper pool level (upstream of the gates)."""
    if p.y < -1.2:
        hw = p.z - UP
        if hw < 0.4:
            c = c.lerp(F._mul(c, (0.36, 0.4, 0.28)), 0.9 * (1.0 if hw < 0.1 else 1 - (hw - 0.1) / 0.3))
        elif hw < 2.2:
            c *= 1 - 0.28 * (1 - (hw - 0.4) / 1.8) ** 1.4
    return c


F.weather(theme='temperate', step=2.2, lichen=0.4, moss=0.6, extra=upper_pool, skip=('decal', 'lamp', 'lock_shack', 'wall_', 'roof'))
F.weather(mids=('timber_tarred', 'timber_grey'), theme='temperate', step=99, lichen=0.3, moss=0.6, base=0.95,
          extra=upper_pool, skip=('decal',))
F2.cull_decals()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
