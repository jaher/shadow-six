"""M10 `wreck_2` (dossier §5.2 `aircraft_wreck`, in the crater S of the ruins; the notebook hints it may be McRae's own):
a burnt-out single-seat RAF fighter-reconnaissance machine (Hurricane-type: metal front fuselage, fabric over a tubular
frame aft) after a belly-in crash: the nose section with the engine and the bent three-blade propeller ploughed into the
crater, the cockpit frame open, the rear fuselage broken off and lying askew with its fabric burnt away to the welded
tube frame and stringers, the fin and tailplane standing, one wing torn off and lying flat with a faded, scorched roundel,
scattered panels, soot and scorched sand. Main footprint 6 x 3 (local X = the fuselage line).
Usage: blender -b --python ic_wreck.py -- outdir [plane] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('plane')
NAME = 'aircraft_wreck_ic'
K.begin(NAME, 11101 + SEED, theater='desert')
r = K.rng()
CH = (0.34, 0.32, 0.3)                     # charred paint
GREEN = (0.4, 0.38, 0.32)                 # dark earth / mid stone, faded and sooted
# ---- nose section: engine cowling (tapered), spinner, bent prop, nose down 8 deg, front half in the crater
bm = bmesh.new()
nose = [(-3.0, 0.0, 0.55, 0.42), (-2.2, 0.0, 0.62, 0.55), (-0.6, 0.0, 0.85, 0.6), (0.6, 0.0, 0.95, 0.58)]   # x, y, z, r
for a, b in zip(nose, nose[1:]):
    C.cyl_bm(bm, V(a[:3]), V(b[:3]), a[3], 12, r1=b[3])
K.part(bm, 'paint_metal', name='nose', mat_tint=GREEN, grime=1.2, bisect=False, smooth=True)
bm = bmesh.new()
C.cyl_bm(bm, V((-3.0, 0, 0.55)), V((-3.35, 0, 0.53)), 0.2, 10, r1=0.04)
for k in range(3):
    a = 2 * math.pi * k / 3 + 0.4
    tip = V((-3.25 + 0.35 * (k == 0), 1.3 * math.cos(a), 0.55 + 1.3 * math.sin(a)))
    if tip.z < 0.05:
        tip = V((tip.x - 0.5, tip.y * 0.8, 0.06))          # the blade that hit the ground is bent back
    C.beam_bm(bm, (-3.22, 0, 0.55), tuple(tip), 0.2, 0.03)
K.part(bm, 'paint_metal', name='prop', mat_tint=(0.22, 0.21, 0.2), grime=0.8, bisect=False)
# ---- cockpit frame (canopy gone), the rear fuselage broken off: tube frame + stringers, a few fabric scraps
bm = bmesh.new()
for x in (0.0, 0.7):
    C.beam_bm(bm, (x, -0.45, 1.25), (x + 0.15, 0.0, 1.75), 0.05, 0.05)
    C.beam_bm(bm, (x, 0.45, 1.25), (x + 0.15, 0.0, 1.75), 0.05, 0.05)
K.part(bm, 'cast_iron', name='canopy_frame', mat_tint=(0.25, 0.25, 0.24), bisect=False)
ax0, ay0, ang = 1.4, 0.25, math.radians(14)       # the break: the tail section lies askew from here
u = V((math.cos(ang), math.sin(ang), 0))
rings = []
for k in range(7):
    t = k / 6
    c = V((ax0, ay0, 0)) + u * (4.2 * t)
    rad = 0.55 * (1 - 0.6 * t)
    rings.append((c + V((0, 0, 0.45 + 0.3 * (1 - t))), rad))
bm = bmesh.new()
for (c, rad) in rings:                     # formers (frames)
    for i in range(8):
        a0, a1 = 2 * math.pi * i / 8, 2 * math.pi * (i + 1) / 8
        p0 = c + V((-u.y, u.x, 0)) * rad * math.cos(a0) + V((0, 0, rad * math.sin(a0)))
        p1 = c + V((-u.y, u.x, 0)) * rad * math.cos(a1) + V((0, 0, rad * math.sin(a1)))
        C.cyl_bm(bm, p0, p1, 0.022, 4, caps=False)
for i in range(8):                         # longerons / stringers
    a = 2 * math.pi * i / 8
    pts = [c + V((-u.y, u.x, 0)) * rad * math.cos(a) + V((0, 0, rad * math.sin(a))) for (c, rad) in rings]
    for p0, p1 in zip(pts, pts[1:]):
        C.cyl_bm(bm, p0, p1, 0.025, 4, caps=False)
K.part(bm, 'cast_iron', name='tube_frame', mat_tint=(0.3, 0.29, 0.27), bisect=False)
tail = rings[-1][0]
bm = bmesh.new()                           # fin + rudder and the tailplane (metal-framed, fabric half burnt)
C.hexa_bm(bm, [tail + V((-0.6, 0, 0.1)), tail + V((0.5, 0, 0.1)), tail + V((0.45, 0, 1.3)), tail + V((-0.2, 0, 1.15)),
               tail + V((-0.6, 0.04, 0.1)), tail + V((0.5, 0.04, 0.1)), tail + V((0.45, 0.04, 1.3)), tail + V((-0.2, 0.04, 1.15))])
for s in (-1, 1):
    C.hexa_bm(bm, [tail + V((-0.5, 0, 0.12)), tail + V((0.35, 0, 0.12)), tail + V((0.25, s * 1.7, 0.12)), tail + V((-0.2, s * 1.6, 0.12)),
                   tail + V((-0.5, 0, 0.16)), tail + V((0.35, 0, 0.16)), tail + V((0.25, s * 1.7, 0.16)), tail + V((-0.2, s * 1.6, 0.16))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'canvas', name='tail', mat_tint=(0.5, 0.48, 0.4), grime=1.1, bisect=False)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_wreck_b.py')).read())
