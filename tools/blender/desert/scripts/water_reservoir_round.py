"""Squat riveted water reservoir (M8 Tell el Eisa objective o3; reusable at desert camps / pumping stations):
a field-erected steel cistern, 7.4 m across and 4.6 m tall, of five riveted plate courses (lap seams with rivet
rows, vertical butt straps), on a 1 m steel leg frame (I-section stools on a dressed-stone ring footing with a
gravel pad), a shallow conical roof with a vent cap, a manhole and a walkway hand-rail ring, an outside caged ladder
on the S face, an inlet riser with a gate valve, an outlet with a standpipe and a canvas hose, an overflow pipe
down to a soak-away, a level gauge board, faded grey paint with rust runs and a stencilled 'TRINKWASSER'.
  a       intact
  ruin    burst by a blast: roof caved in, the upper courses torn open and peeled outward, plates on the ground,
          a dark wet patch round the base.
Footprint: round, r 3.75 (HIGH). Front = Blender -Y (game S).
Usage: blender -b --python water_reservoir_round.py -- outdir [a|ruin] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, V, bmesh
import kit_bridge as KB

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else 808
RUIN = VAR == 'ruin'
K.begin('water_reservoir_round' + ('_destroyed' if RUIN else ''), SEED, theater='desert')
r = K.rng()
R, Z0, H = 3.6, 1.05, 4.6            # shell radius, shell base (top of the leg frame), shell height
NS = 40                               # shell segments
PAINT = (0.62, 0.63, 0.6)
ZT = Z0 + H


def torn(k, z):
    """Ruin: is the shell plate at segment k, height z torn away? (a ragged hole on the NE / E side)"""
    if not RUIN:
        return False
    a = (k + 0.5) / NS * 2 * math.pi
    d = abs(((a - 0.6) + math.pi) % (2 * math.pi) - math.pi)
    lim = Z0 + 1.2 + 2.2 * (d / 1.4) + 0.5 * math.sin(k * 2.7)
    return d < 1.4 and z > lim


# ---- footing: stone ring + gravel pad; I-section stools under the shell
bm = bmesh.new()
C.cyl_bm(bm, V((0, 0, 0)), V((0, 0, 0.35)), R + 0.45, 36)
K.part(bm, 'ashlar_limestone', name='footing', grime=0.8, tint=(0.95, 0.9, 0.82))
bm = bmesh.new()
for k in range(12):
    a = k / 12 * 2 * math.pi
    for rr in (R - 0.25, R - 1.6):
        c = V((rr * math.cos(a), rr * math.sin(a), 0.35))
        C.beam_bm(bm, c, c + V((0, 0, Z0 - 0.35)), 0.22, 0.22)
for rr in (R - 0.25, R - 1.6):                       # ring girders
    for k in range(12):
        a0, a1 = k / 12 * 2 * math.pi, (k + 1) / 12 * 2 * math.pi
        C.beam_bm(bm, V((rr * math.cos(a0), rr * math.sin(a0), Z0 - 0.12)), V((rr * math.cos(a1), rr * math.sin(a1), Z0 - 0.12)), 0.2, 0.24)
for k in range(6):                                    # cross joists
    a = k / 6 * math.pi
    C.beam_bm(bm, V((-R * 0.95 * math.cos(a), -R * 0.95 * math.sin(a), Z0 - 0.1)), V((R * 0.95 * math.cos(a), R * 0.95 * math.sin(a), Z0 - 0.1)), 0.16, 0.2)
K.part(bm, 'steel_painted', name='frame', mat_tint=(0.36, 0.33, 0.3), grime=1.0, bisect=False)

# ---- shell: 5 plate courses, each a slightly proud ring (lap seam), torn panels skipped on the ruin
bm = bmesh.new()
courses = 5
for c in range(courses):
    za, zb = Z0 + H * c / courses, Z0 + H * (c + 1) / courses
    rc = R + 0.012 * (c % 2)
    for k in range(NS):
        if torn(k, (za + zb) / 2):
            continue
        a0, a1 = k / NS * 2 * math.pi, (k + 1) / NS * 2 * math.pi
        p = [V((rc * math.cos(a0), rc * math.sin(a0), za)), V((rc * math.cos(a1), rc * math.sin(a1), za)),
             V((rc * math.cos(a1), rc * math.sin(a1), zb + 0.03)), V((rc * math.cos(a0), rc * math.sin(a0), zb + 0.03))]
        C.quad(bm, p)
        q = [V((x * 0.985, y * 0.985, z)) for x, y, z in p]       # inner face (seen through the tear)
        C.quad(bm, q, flip=True)
# one continuous skin per course (shared verts): per-quad verts gave every plate its own grime gradient (read as staves)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
# cylindrical UVs (u = arc length round the shell, v = height): one continuous sheet, no per-plate texture jumps
lay = bm.loops.layers.uv.new('UVMap')
tm = K.tile_of('paint_metal') * 1.5
for f in bm.faces:
    fa = math.atan2(sum(l.vert.co.y for l in f.loops), sum(l.vert.co.x for l in f.loops))
    for l in f.loops:
        a = math.atan2(l.vert.co.y, l.vert.co.x)
        a += round((fa - a) / (2 * math.pi)) * 2 * math.pi
        l[lay].uv = (a * R / tm + 0.37, l.vert.co.z / tm + 0.11)
K.part(bm, 'paint_metal', name='shell', mat_tint=(0.47, 0.49, 0.45), grime=0.9, uv='keep')
# rivet rows on every lap seam + vertical butt straps every 8 segments
bm = bmesh.new()
for c in range(courses + 1):
    z = Z0 + H * c / courses + 0.04
    for k in range(NS * 3):
        a = k / (NS * 3) * 2 * math.pi
        kk = int(k / 3)
        if torn(kk, z) or (c == courses and RUIN and torn(kk, z - 0.3)):
            continue
        KB.rivet_bm(bm, V(((R + 0.02) * math.cos(a), (R + 0.02) * math.sin(a), z)), V((math.cos(a), math.sin(a), 0)), r=0.018, h=0.014)
for k in range(0, NS, 8):
    a = k / NS * 2 * math.pi
    for c in range(courses):
        za, zb = Z0 + H * c / courses, Z0 + H * (c + 1) / courses
        if torn(k, (za + zb) / 2):
            continue
        n = V((math.cos(a), math.sin(a), 0))
        C.beam_bm(bm, n * (R + 0.02) + V((0, 0, za)), n * (R + 0.02) + V((0, 0, zb)), 0.02, 0.18, up=(n.x, n.y, 0))
K.part(bm, 'steel_painted', name='rivets', mat_tint=(PAINT[0] * 0.9, PAINT[1] * 0.9, PAINT[2] * 0.9), grime=1.0, bisect=False, lod='drop')
# top angle ring + hand-rail ring on the roof edge
bm = bmesh.new()
for k in range(NS):
    a0, a1 = k / NS * 2 * math.pi, (k + 1) / NS * 2 * math.pi
    if torn(k, ZT - 0.1):
        continue
    C.beam_bm(bm, V(((R + 0.05) * math.cos(a0), (R + 0.05) * math.sin(a0), ZT)), V(((R + 0.05) * math.cos(a1), (R + 0.05) * math.sin(a1), ZT)), 0.1, 0.1)
    if k % 2 == 0 and not RUIN:
        C.cyl_bm(bm, V(((R - 0.1) * math.cos(a0), (R - 0.1) * math.sin(a0), ZT)), V(((R - 0.1) * math.cos(a0), (R - 0.1) * math.sin(a0), ZT + 1.0)), 0.025, 6)
    if not RUIN:
        for zz in (ZT + 0.55, ZT + 1.0):
            C.cyl_bm(bm, V(((R - 0.1) * math.cos(a0), (R - 0.1) * math.sin(a0), zz)), V(((R - 0.1) * math.cos(a1), (R - 0.1) * math.sin(a1), zz)), 0.022, 5)
K.part(bm, 'steel_painted', name='rails', mat_tint=(0.4, 0.4, 0.38), grime=0.9, bisect=False)

# ---- shallow conical roof (radial plate seams), vent cap, manhole; the ruin's roof has caved into the tank
bm = bmesh.new()
RISE = 0.55
sag = -1.7 if RUIN else 0.0
for k in range(NS):
    a0, a1 = k / NS * 2 * math.pi, (k + 1) / NS * 2 * math.pi
    if RUIN and torn(k, ZT - 0.2):
        continue
    C.quad(bm, [V(((R + 0.08) * math.cos(a0), (R + 0.08) * math.sin(a0), ZT + 0.02)), V(((R + 0.08) * math.cos(a1), (R + 0.08) * math.sin(a1), ZT + 0.02)),
                V((0.45 * math.cos(a1), 0.45 * math.sin(a1), ZT + RISE + sag + 0.1 * math.sin(k))), V((0.45 * math.cos(a0), 0.45 * math.sin(a0), ZT + RISE + sag + 0.1 * math.sin(k)))])
K.part(bm, 'steel_painted', name='roof', mat_tint=(0.6, 0.6, 0.57), grime=1.3, bisect=False)
bm = bmesh.new()
for k in range(0, NS, 4):                              # radial roof seams (cover straps)
    a = k / NS * 2 * math.pi
    if RUIN and torn(k, ZT - 0.2):
        continue
    C.beam_bm(bm, V(((R + 0.05) * math.cos(a), (R + 0.05) * math.sin(a), ZT + 0.05)), V((0.5 * math.cos(a), 0.5 * math.sin(a), ZT + RISE + sag + 0.03)), 0.12, 0.03)
if not RUIN:
    C.cyl_bm(bm, V((0, 0, ZT + RISE - 0.05)), V((0, 0, ZT + RISE + 0.55)), 0.28, 12)        # vent stack + mushroom cap
    C.cyl_bm(bm, V((0, 0, ZT + RISE + 0.55)), V((0, 0, ZT + RISE + 0.72)), 0.48, 14, r1=0.1)
    C.box_bm(bm, (1.6, -1.2, ZT + RISE * 0.55 + 0.06), (0.75, 0.75, 0.14))                   # manhole curb + lid
K.part(bm, 'steel_painted', name='roof_fittings', mat_tint=(0.45, 0.45, 0.42), grime=1.0, bisect=False)

# ---- caged ladder on the S face (Blender -Y), rungs, hoops
bm = bmesh.new()
ly = -(R + 0.32)
for sx in (-0.23, 0.23):
    C.beam_bm(bm, V((sx, ly, 0.35)), V((sx, ly, ZT + 1.0)), 0.05, 0.07)
    C.beam_bm(bm, V((sx, ly + 0.3, ZT - 0.6)), V((sx, ly + 0.02, ZT - 0.6)), 0.04, 0.04)       # wall brackets
    C.beam_bm(bm, V((sx, ly + 0.3, Z0 + 0.8)), V((sx, ly + 0.02, Z0 + 0.8)), 0.04, 0.04)
z = 0.6
while z < ZT + 0.8:
    C.cyl_bm(bm, V((-0.23, ly, z)), V((0.23, ly, z)), 0.014, 5)
    z += 0.3
z = 2.4
while z < ZT + 0.8:
    for k in range(8):
        a0, a1 = math.pi + k / 8 * math.pi, math.pi + (k + 1) / 8 * math.pi
        C.cyl_bm(bm, V((0.38 * math.cos(a0), ly + 0.38 * math.sin(a0), z)), V((0.38 * math.cos(a1), ly + 0.38 * math.sin(a1), z)), 0.014, 4)
    z += 0.9
K.part(bm, 'steel_painted', name='ladder', mat_tint=(0.32, 0.32, 0.3), grime=0.8, bisect=False, lod='keep')

# ---- pipework: inlet riser + gate valve (W), outlet + standpipe + hose (E), overflow to a soak-away (N)
bm = bmesh.new()
C.cyl_bm(bm, V((-R - 0.35, 0.4, 0.0)), V((-R - 0.35, 0.4, ZT - 0.4)), 0.11, 10)
C.cyl_bm(bm, V((-R - 0.35, 0.4, ZT - 0.4)), V((-R + 0.05, 0.4, ZT - 0.4)), 0.11, 10)
C.cyl_bm(bm, V((-R - 0.5, 0.4, 1.0)), V((-R - 0.2, 0.4, 1.0)), 0.2, 12)                     # valve body
C.cyl_bm(bm, V((-R - 0.35, 0.4, 1.15)), V((-R - 0.35, 0.4, 1.55)), 0.03, 6)
C.cyl_bm(bm, V((-R - 0.35, 0.4, 1.55)), V((-R - 0.35, 0.4, 1.6)), 0.2, 12)                  # handwheel
C.cyl_bm(bm, V((R * 0.7, -R * 0.72, Z0 + 0.3)), V((R * 0.7 + 0.6, -R * 0.72 - 0.7, Z0 + 0.3)), 0.09, 8)
C.cyl_bm(bm, V((R * 0.7 + 0.6, -R * 0.72 - 0.7, 0.0)), V((R * 0.7 + 0.6, -R * 0.72 - 0.7, Z0 + 0.35)), 0.09, 8)
C.cyl_bm(bm, V((R * 0.7 + 0.6, -R * 0.72 - 0.7, 0.9)), V((R * 0.7 + 0.95, -R * 0.72 - 0.95, 0.9)), 0.05, 8)  # tap spout
C.cyl_bm(bm, V((0.6, R + 0.05, ZT - 0.25)), V((0.6, R + 0.3, ZT - 0.25)), 0.08, 8)
C.cyl_bm(bm, V((0.6, R + 0.3, ZT - 0.25)), V((0.6, R + 0.3, 0.15)), 0.08, 8)
K.part(bm, 'steel_painted', name='pipes', mat_tint=(0.3, 0.3, 0.28), grime=1.2, bisect=False)
bm = bmesh.new()
pts = [V((R * 0.7 + 0.95, -R * 0.72 - 0.95, 0.88)), V((R * 0.7 + 1.1, -R * 0.72 - 1.2, 0.3)), V((R * 0.7 + 1.0, -R * 0.72 - 1.9, 0.06)),
       V((R * 0.7 + 0.2, -R * 0.72 - 2.3, 0.06)), V((R * 0.7 - 0.6, -R * 0.72 - 2.0, 0.06))]
for p0, p1 in zip(pts[:-1], pts[1:]):
    C.cyl_bm(bm, p0, p1, 0.04, 6)
K.part(bm, 'canvas', name='hose', mat_tint=(0.5, 0.46, 0.36), grime=0.8, bisect=False, lod='drop')
bm = bmesh.new()                                        # soak-away: stone-lined pit rim + gravel
C.cyl_bm(bm, V((0.6, R + 0.3, 0.0)), V((0.6, R + 0.3, 0.12)), 0.55, 12)
K.part(bm, 'gravel', name='soakaway', grime=0.6, bisect=False)

# ---- level gauge board (float + pointer) by the ladder, stencil and weathering
# a dark-painted board on two stand-off brackets with a pale scale (ticks every 0.25 m, longer every metre), the float
# wire running down from the roof sheave and a red pointer at the water level
GX, GY = -1.2, -math.sqrt(R * R - 1.2 * 1.2) - 0.09
bm = bmesh.new()
C.box_bm(bm, (GX, GY, Z0 + H * 0.52), (0.16, 0.04, H * 0.62))
for z in (Z0 + H * 0.28, Z0 + H * 0.78):
    C.box_bm(bm, (GX, GY + 0.05, z), (0.05, 0.1, 0.05))
K.part(bm, 'steel_painted', name='gauge', mat_tint=(0.3, 0.3, 0.28), grime=0.8, bisect=False, lod='drop')
bm = bmesh.new()
nt = int(H * 0.6 / 0.25)
for i in range(nt + 1):
    z = Z0 + H * 0.22 + i * 0.25
    big = i % 4 == 0
    C.box_bm(bm, (GX - 0.03 + (0.02 if big else 0), GY - 0.022, z), (0.08 if big else 0.04, 0.006, 0.022))
K.part(bm, 'paint_metal', name='gauge_ticks', mat_tint=(0.8, 0.78, 0.7), grime=0.6, bisect=False, lod='drop')
bm = bmesh.new()
C.cyl_bm(bm, V((GX + 0.05, GY - 0.03, Z0 + H * 0.24)), V((GX + 0.05, GY - 0.03, ZT + 0.05)), 0.006, 4)
C.box_bm(bm, (GX + 0.01, GY - 0.035, Z0 + H * 0.64), (0.14, 0.012, 0.04))
K.part(bm, 'steel_painted', name='gauge_ptr', mat_tint=(0.6, 0.14, 0.1), grime=0.4, bisect=False, lod='drop')
for k in range(9):
    a = r.uniform(0, 2 * math.pi)
    if RUIN and torn(int(a / (2 * math.pi) * NS), ZT - 0.4):
        continue
    n = (math.cos(a), math.sin(a), 0)
    K.decal(r.choice(['streak_long', 'streak_rain', 'rust_run'] if True else []), ((R + 0.03) * n[0], (R + 0.03) * n[1], ZT - 1.2), n, 0.6, 2.0, alpha=0.6)
for k in range(4):
    a = -math.pi / 2 + (k - 1.5) * 0.7
    n = (math.cos(a), math.sin(a), 0)
    K.decal('damp_base', ((R + 0.03) * n[0], (R + 0.03) * n[1], Z0 + 0.4), n, 2.2, 0.6, alpha=0.6)
if RUIN:
    # torn plates peeled outward, plates and roof sheets on the ground, a wet patch
    bm = bmesh.new()
    for k in range(7):
        a = 0.6 + r.uniform(-1.2, 1.2)
        c = V(((R + 1.2 + r.uniform(0, 2.5)) * math.cos(a), (R + 1.2 + r.uniform(0, 2.5)) * math.sin(a), 0.06))
        C.box_bm(bm, tuple(c), (r.uniform(0.8, 1.6), r.uniform(0.6, 1.0), 0.03), rot_z=r.uniform(0, 3))
    for k in range(5):
        a = 0.6 + (k - 2) * 0.45
        p = V((R * math.cos(a), R * math.sin(a), Z0 + 2.4 + r.uniform(0, 1.2)))
        n = V((math.cos(a), math.sin(a), 0.6)).normalized()
        C.quad(bm, [p, p + V((-math.sin(a) * 0.7, math.cos(a) * 0.7, 0)), p + V((-math.sin(a) * 0.7, math.cos(a) * 0.7, 0)) + n * 1.3, p + n * 1.3])
    K.part(bm, 'steel_painted', name='plates', mat_tint=(0.5, 0.48, 0.44), grime=1.5, bisect=False)
    for k in range(4):
        K.decal('stain_blotch', (r.uniform(-1, 4), r.uniform(-4, 1), 0.02), (0, 0, 1), 4.5, 3.5, alpha=0.6)
K.footprint([(R * 1.03 * math.cos(k / 16 * 2 * math.pi), R * 1.03 * math.sin(k / 16 * 2 * math.pi)) for k in range(16)], 'HIGH', 'tank')
K.anchor('explosive_target', (0, -R - 0.6, 0.5), (0, -1, 0), kind='charge_marker')
dz.finalize(OUT, ao_res=1024, ao_samples=48)
