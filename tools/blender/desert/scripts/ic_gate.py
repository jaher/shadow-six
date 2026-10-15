"""M10 compound gates in sun-dried mud brick (dossier §5.5). Local X runs along the wall; Blender -Y = the compound side.
  gate  arch_gate_mud_ic (`gate_n`, `arch_gate_mudbrick`): the N main gate, a 4.9 m passage (the Panzers pass) between two
        battered mud-brick piers 1.3 x 1.6, a segmental arch (spring 3.7, crown 4.6) under a crenellated parapet (top 5.6),
        render worn off the brick in patches, timber double doors on iron straps standing OPEN against the inner face,
        a lantern bracket, a painted board, wheel-rut wear and sand at the piers' feet.
  arch  arch_mud_ic (`arch_w`, `arch_mudbrick`): the W foot gate, an open 3.9 m segmental arch (crown 3.5) on 0.6 m piers,
        no doors, eroded top, a few bricks fallen.
Footprints: the piers. Usage: blender -b --python ic_gate.py -- outdir [gate|arch] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('gate')
NAME = {'gate': 'arch_gate_mud_ic', 'arch': 'arch_mud_ic'}[VAR]
K.begin(NAME, 10901 + SEED + 7 * len(VAR), theater='desert')
r = K.rng()
if VAR == 'gate':
    HP, PW, PD, SPRING, RISE, TOP = 2.45, 1.3, 1.6, 3.7, 0.9, 5.0
else:
    HP, PW, PD, SPRING, RISE, TOP = 1.95, 0.6, 1.1, 2.6, 0.9, 4.0
BR, BR_T = 'mudbrick', (0.98, 0.92, 0.84)
REND, REND_T = 'mud_render', (1.0, 0.93, 0.8)
# segmental arch: the circle through (+-HP, SPRING) and (0, SPRING + RISE)
RAD = (HP * HP + RISE * RISE) / (2 * RISE)
zc = SPRING + RISE - RAD
zi = lambda x: zc + math.sqrt(max(0.0, RAD * RAD - x * x))
bm = bmesh.new()
for s in (-1, 1):                          # the piers, battered (wider at the foot)
    cx = s * (HP + PW / 2)
    C.box_bm(bm, (cx, 0, TOP / 2), (PW, PD, TOP), taper=(0.88, 0.92))
n = 14
for i in range(n):                         # spandrel + arch ring as slices with the intrados underneath
    xa, xb = -HP + 2 * HP * i / n, -HP + 2 * HP * (i + 1) / n
    hd = PD / 2 - 0.05
    C.hexa_bm(bm, [V((xa, -hd, zi(xa))), V((xb, -hd, zi(xb))), V((xb, hd, zi(xb))), V((xa, hd, zi(xa))),
                   V((xa, -hd, TOP - 0.02)), V((xb, -hd, TOP - 0.02)), V((xb, hd, TOP - 0.02)), V((xa, hd, TOP - 0.02))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, REND, name='masonry', mat_tint=REND_T, grime=1.0, uv='aligned')
bm = bmesh.new()                           # the voussoir ring (brick on edge), proud 3 cm of the render, both faces
for sy in (-1, 1):
    for i in range(18):
        a0 = math.asin(-HP / RAD) + (2 * math.asin(HP / RAD)) * i / 18
        a1 = math.asin(-HP / RAD) + (2 * math.asin(HP / RAD)) * (i + 1) / 18
        p = lambda a, rr: (rr * math.sin(a), zc + rr * math.cos(a))
        (xa, za), (xb, zb) = p(a0, RAD), p(a1, RAD)
        (xc, zc2), (xd, zd) = p(a1, RAD + 0.36), p(a0, RAD + 0.36)
        y0_, y1_ = sy * (PD / 2 - 0.02), sy * (PD / 2 + 0.03)
        C.hexa_bm(bm, [V((xa, y0_, za)), V((xb, y0_, zb)), V((xb, y1_, zb)), V((xa, y1_, za)),
                       V((xd, y0_, zd)), V((xc, y0_, zc2)), V((xc, y1_, zc2)), V((xd, y1_, zd))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, BR, name='voussoirs', mat_tint=BR_T, grime=0.9, bisect=False)
# render worn off: brick showing in patches on both faces, damp at the foot
for sy in (-1, 1):
    for k in range(4 if VAR == 'gate' else 3):
        x = r.choice((-1, 1)) * (HP + r.uniform(0.2, PW - 0.2))
        dz.spall2(V((x, sy * (PD / 2 + 0.01), r.uniform(0.6, TOP - 1.0))), V((0, sy, 0)), r.uniform(0.4, 0.8), r.uniform(0.3, 0.6),
                  mid=BR, skin=REND, skin_tint=REND_T, seed=SEED + 11 * k + (sy + 1), name='spall%d_%d' % (k, sy + 1))
    for s_ in (-1, 1):                     # damp at each pier's foot (never across the open passage)
        K.decal('damp_base', (s_ * (HP + PW / 2), sy * (PD / 2 + 0.012), 0.4), (0, sy, 0), PW * 0.95, 0.7, alpha=0.4)
# crown: merlons on the gate, an eroded rounded top on the arch
bm = bmesh.new()
if VAR == 'gate':
    xs = [-(HP + PW) + 0.35 + k * 0.95 for k in range(int(2 * (HP + PW) / 0.95) + 1)]
    for x in xs:
        if abs(x) < HP + PW - 0.2:
            C.box_bm(bm, (x, 0, TOP + 0.3), (0.5, PD - 0.3, 0.6), taper=(0.85, 0.85))
    C.box_bm(bm, (0, 0, TOP + 0.03), (2 * (HP + PW) - 0.1, PD - 0.1, 0.1))
else:
    for k in range(9):
        x = -(HP + PW) + 0.3 + k * (2 * (HP + PW) - 0.6) / 8
        C.box_bm(bm, (x, 0, TOP + 0.04), (0.7, PD - 0.25, 0.18 + 0.12 * r.random()), rot_z=r.uniform(-0.1, 0.1))
K.part(bm, REND, name='crown', mat_tint=(0.96, 0.9, 0.78), grime=1.0, bisect=False)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_gate_b.py')).read())
