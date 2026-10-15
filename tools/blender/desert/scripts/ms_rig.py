"""M11 Maradah `drilling_rig` (objective o_rigs, x4), 6.5 x 6.5 x 22 m: a cable/rotary rig of the late 1930s — a steel
I-beam substructure with cross bracing under a plank drill floor (1.7 m), a tapered four-leg angle-iron derrick to
21 m with girts and X bracing on every face, the monkey board with its fingerboard at 14 m, the crown block and gin pole
on top, the travelling block and hook on the drilling line, a rotary table and kelly, a rack of drill-pipe stands
leaning in the derrick, the drawworks with its cable drum, a corrugated doghouse, a caged ladder up the S-W leg to the
monkey board, a steel stair to the floor, crude-oil stains spreading from the cellar.
_destroyed: the derrick buckled at 8 m, its upper half folded down over the S side, the crown
block in the sand, the doghouse burnt out, the floor charred and holed, scattered pipe — soot only round the blast.
Front (Blender -Y) = game S. Usage: blender -b --python ms_rig.py -- outdir [a|a_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *


def ladder_inclined(p0, p1, normal, name='ladder', cage_from=2.2):
    """Rung ladder on a straight (possibly battered) line p0 -> p1 with a safety cage from `cage_from` up,
    stiles running 0.9 m past the top as grab rails."""
    n = V(normal).normalized(); t = V((-n.y, n.x, 0))
    d = p1 - p0; L = d.length; dn = d / L
    top = p1 + dn * (0.9 / max(dn.z, 0.3))
    bm = bmesh.new()
    for s in (-1, 1):
        C.cyl_bm(bm, p0 + t * 0.22 * s, top + t * 0.22 * s, 0.022, 5)
    k = 1
    while 0.3 * k < L:
        q = p0 + dn * 0.3 * k
        C.cyl_bm(bm, q - t * 0.22, q + t * 0.22, 0.012, 4); k += 1
    hoops = []
    z = cage_from
    while z < L + 0.8:
        q = p0 + dn * z
        pts = [q + t * (0.32 * math.cos(a)) + n * (0.38 + 0.36 * math.sin(a)) for a in [math.pi * i / 6 for i in range(7)]]
        for a, b in zip(pts, pts[1:]):
            C.cyl_bm(bm, a, b, 0.012, 4, caps=False)
        hoops.append(pts); z += 0.9
    for i in (0, 3, 6):
        C.cyl_bm(bm, hoops[0][i], hoops[-1][i], 0.012, 4)
    K.part(bm, 'paint_metal', name=name, mat_tint=STEEL, grime=0.6, bisect=False)


OUT, VAR, SEED = args('a')
DEST = VAR.endswith('destroyed')
NAME = 'drilling_rig_ms' + ('_destroyed' if DEST else '')
K.begin(NAME, 11601 + SEED + (9 if DEST else 0), theater='desert')
r = K.rng()
HW, ZF = 3.2, 1.7                      # substructure half-width, drill floor top
B, T, ZC = 2.7, 0.6, 21.0              # derrick leg half-spread at the floor / crown, crown z
CRUDE = (0.11, 0.095, 0.075)
DERR = (0.62, 0.6, 0.55)

# ---- substructure: I-beam sills, posts, cross bracing, a plank floor (charred and holed when destroyed)
bm = bmesh.new()
for y in (-HW + 0.2, HW - 0.2):
    C.box_bm(bm, (0, y, 0.15), (2 * HW, 0.3, 0.3))
for x in (-HW + 0.2, -0.9, 0.9, HW - 0.2):
    C.box_bm(bm, (x, 0, 0.42), (0.26, 2 * HW, 0.24))
for (x, y) in ((-HW + 0.2, -HW + 0.2), (HW - 0.2, -HW + 0.2), (HW - 0.2, HW - 0.2), (-HW + 0.2, HW - 0.2), (0, -HW + 0.2), (0, HW - 0.2)):
    C.box_bm(bm, (x, y, ZF / 2), (0.24, 0.24, ZF))
K.part(bm, 'paint_metal', name='sub', mat_tint=(0.36, 0.34, 0.31), grime=1.0, bisect=False)
bm = bmesh.new()
for y in (-HW + 0.2, HW - 0.2):
    for s in (-1, 1):
        dz.angle_bm(bm, (s * (HW - 0.2), y, 0.3), (0, y, ZF - 0.2), w=0.1, t=0.01)
        dz.angle_bm(bm, (0, y, 0.3), (s * (HW - 0.2), y, ZF - 0.2), w=0.1, t=0.01)
K.part(bm, 'paint_metal', name='sub_brace', mat_tint=(0.36, 0.34, 0.31), uv='keep', grime=1.0, bisect=False)
bm = bmesh.new()
if not DEST:
    C.prism_bm(bm, rect(-HW, -HW, HW, HW), ZF - 0.1, ZF)
else:
    C.prism_bm(bm, rect(-HW, -HW, 0.4, HW), ZF - 0.1, ZF)
    C.prism_bm(bm, rect(1.6, -HW, HW, HW), ZF - 0.1, ZF)
K.part(bm, 'deck_planks', name='floor', uv='beam', axis=(1, 0, 0), mat_tint=(0.62, 0.55, 0.45) if not DEST else (0.36, 0.32, 0.28), grime=1.0, bisect=False)
dz.patch_quad([(-HW - 1.4, -HW - 0.6, 0), (HW + 0.9, -HW - 1.2, 0), (HW + 1.3, HW + 0.8, 0), (-HW - 0.6, HW + 1.1, 0)], 'mud', 'crude', tint=CRUDE, lift=0.02)
dz.patch_quad([(-0.9, -0.9, ZF), (0.9, -0.9, ZF), (0.9, 0.9, ZF), (-0.9, 0.9, ZF)], 'mud', 'crude_floor', tint=CRUDE, lift=0.012)

# ---- derrick
if not DEST:
    bot = [(-B, -B), (B, -B), (B, B), (-B, B)]
    top = [(-T, -T), (T, -T), (T, T), (-T, T)]
    lattice_tower(bot, top, ZF, ZC, levels=8, w=0.16, name='derrick', tint=DERR)
else:   # standing stub to 8 m (legs bent), the upper part folded over E, lying from 8 m down to the sand at x +9
    zb = 8.0
    tb = B + (T - B) * (zb - ZF) / (ZC - ZF)
    bot = [(-B, -B), (B, -B), (B, B), (-B, B)]
    lattice_tower(bot, [(-tb + 0.3, -tb), (tb + 0.4, -tb + 0.2), (tb + 0.5, tb), (-tb + 0.2, tb - 0.1)], ZF, zb, levels=3, w=0.16, name='derrick', tint=(0.4, 0.37, 0.33))
    bm = bmesh.new()
    ax, az = V((0, -tb, zb)), V((0.5, -6.6, 0.25))                   # the fallen top: from the kink over the S side
    d = (az - ax).normalized()
    side = V((1, 0, 0))
    up = d.cross(side).normalized()
    for k in range(5):
        t0, t1 = k / 5, (k + 1) / 5
        L = (az - ax).length
        w0, w1 = tb * (1 - 0.55 * t0), tb * (1 - 0.55 * t1)
        for s1 in (-1, 1):
            for s2 in (-1, 1):
                dz.angle_bm(bm, ax + d * L * t0 + side * s1 * w0 + up * s2 * w0 * 0.8, ax + d * L * t1 + side * s1 * w1 + up * s2 * w1 * 0.8, w=0.16, t=0.014)
            dz.angle_bm(bm, ax + d * L * t0 + side * s1 * w0 + up * w0 * 0.8, ax + d * L * t1 + side * s1 * w1 - up * w1 * 0.8, w=0.08, t=0.008)
    K.part(bm, 'paint_metal', name='derrick_fallen', mat_tint=(0.38, 0.35, 0.31), uv='keep', grime=1.0, bisect=False)

# ---- crown block, gin pole, travelling block, lines, monkey board, ladder
if not DEST:
    bm = bmesh.new()
    C.box_bm(bm, (0, 0, ZC + 0.15), (2 * T + 0.5, 2 * T + 0.5, 0.3))
    C.box_bm(bm, (0, 0, ZC + 0.55), (0.9, 0.6, 0.5))
    C.cyl_bm(bm, V((-0.3, 0, ZC + 0.6)), V((0.3, 0, ZC + 0.6)), 0.38, 12)
    C.beam_bm(bm, (T, T, ZC + 0.3), (0.1, 0.1, ZC + 2.2), 0.1, 0.1)
    K.part(bm, 'paint_metal', name='crown', mat_tint=(0.48, 0.45, 0.4), grime=0.9, bisect=False)
    railing_pts = rect(-T - 0.25, -T - 0.25, T + 0.25, T + 0.25)
    for e in range(4):
        a, b = railing_pts[e], railing_pts[(e + 1) % 4]
        K.railing((a[0], a[1], ZC + 0.3), (b[0], b[1], ZC + 0.3), h=0.9, style='pipe', name='crown_rail%d' % e)
    ZM = 14.0
    tm = B + (T - B) * (ZM - ZF) / (ZC - ZF)
    bm = bmesh.new()
    C.prism_bm(bm, rect(-tm, tm - 0.1, tm, tm + 1.0), ZM - 0.06, ZM)       # monkey board on the N face (racking side)
    for x in (-0.6, -0.2, 0.2, 0.6):
        C.box_bm(bm, (x, tm - 0.6, ZM + 0.05), (0.05, 1.2, 0.08))          # fingerboard
    K.part(bm, 'deck_planks', name='monkey', mat_tint=(0.6, 0.53, 0.44), grime=0.9, bisect=False)
    K.railing((-tm, tm + 1.0, ZM), (tm, tm + 1.0, ZM), h=1.0, style='pipe', name='monkey_rail')
    bm = bmesh.new()                                                          # drilling lines + travelling block + hook
    for dx in (-0.12, 0, 0.12):
        C.cyl_bm(bm, V((dx, 0, ZC + 0.3)), V((dx * 1.5, 0, 9.4)), 0.015, 4, caps=False)
    C.cyl_bm(bm, V((1.2, 1.3, ZF + 1.1)), V((0.3, 0.1, ZC + 0.2)), 0.015, 4, caps=False)
    K.part(bm, 'cast_iron', name='lines', mat_tint=(0.18, 0.18, 0.17), bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0, 0, 8.8), (0.6, 0.45, 1.2), taper=(0.75, 1.0))
    C.cyl_bm(bm, V((0, 0, 8.2)), V((0, 0, 7.4)), 0.12, 8)
    C.cyl_bm(bm, V((0, 0, 7.4)), V((0, 0, ZF + 0.7)), 0.09, 6)                # kelly down to the rotary table
    K.part(bm, 'paint_metal', name='tblock', mat_tint=(0.7, 0.56, 0.2), grime=0.9, bisect=False)
    # caged ladder up the W face beside the S-W leg, following the leg's batter on standoff brackets, to a landing
    # walkway along the W face that joins the monkey board on the N face
    def wface(z):                                                             # derrick half-spread at height z
        return B + (T - B) * (z - ZF) / (ZC - ZF)
    SO, YF = 0.3, -0.6                                                        # stand-off from the face; y as a fraction of the half-spread
    pa = V((-wface(ZF) - SO, YF * wface(ZF), ZF))
    pb = V((-wface(ZM) - SO, YF * wface(ZM), ZM))
    ladder_inclined(pa, pb, (-1, 0, 0), name='ladder')
    bm = bmesh.new()
    for zb in [ZF + 1.2 + 1.8 * k for k in range(7)] + [ZM - 0.2]:
        if zb > ZM:
            continue
        f = wface(zb); u = (zb - ZF) / (ZM - ZF); pl = pa + (pb - pa) * u
        for sy in (-1, 1):                                                    # a bracket from each stile back to the face
            dz.angle_bm(bm, V((pl.x, pl.y + sy * 0.22, zb)), V((-f + 0.02, pl.y + sy * 0.22, zb)), w=0.06, t=0.008)
        dz.angle_bm(bm, V((-f + 0.02, pl.y - 0.3, zb)), V((-f + 0.02, pl.y + 0.3, zb)), w=0.06, t=0.008)   # clip bar on the face
    LX0, LY0, LY1 = -tm - 0.85, pb.y + 0.26, tm + 1.0
    C.prism_bm(bm, rect(LX0, LY0, -tm + 0.05, LY1), ZM - 0.06, ZM)          # landing plate (joins the board's W end)
    for yk in (LY0 + 0.1, 0.5 * (LY0 + tm), tm - 0.12):                        # knee braces down to the face (the N end rides on the board)
        dz.angle_bm(bm, V((LX0 + 0.05, yk, ZM - 0.06)), V((-wface(ZM - 1.3) + 0.02, yk, ZM - 1.3)), w=0.07, t=0.008)
        dz.angle_bm(bm, V((LX0 + 0.05, yk, ZM - 0.1)), V((-tm + 0.02, yk, ZM - 0.1)), w=0.08, t=0.01)
    C.box_bm(bm, (LX0 + 0.02, 0.5 * (LY0 + LY1), ZM + 0.07), (0.03, LY1 - LY0, 0.14))     # toe board
    K.part(bm, 'paint_metal', name='landing', mat_tint=(0.5, 0.47, 0.42), grime=0.9, bisect=False)
    K.railing((LX0, LY0, ZM), (LX0, LY1, ZM), h=1.0, style='pipe', name='landing_rail')
    K.railing((LX0, LY1, ZM), (-tm, LY1, ZM), h=1.0, style='pipe', name='landing_rail_n')
    bm = bmesh.new()                                                          # pipe stands racked in the derrick (N side)
    for k in range(9):
        x = -0.8 + 0.2 * k
        C.cyl_bm(bm, V((x, 1.4 + 0.03 * (k % 2), ZF)), V((x * 0.6, tm + 0.2, ZM + 0.1)), 0.06, 6)
    K.part(bm, 'paint_metal', name='stands', mat_tint=(0.42, 0.36, 0.3), grime=1.0, bisect=False, smooth=True)

# ---- on the floor: rotary table, drawworks with its drum, doghouse; stair from the ground on the W
bm = bmesh.new()
C.cyl_bm(bm, V((0, 0, ZF)), V((0, 0, ZF + 0.45)), 0.75, 14)
K.part(bm, 'cast_iron', name='rotary', mat_tint=(0.32, 0.31, 0.29), grime=1.0, bisect=False)
bm = bmesh.new()
C.box_bm(bm, (1.2, 2.3, ZF + 0.55), (2.2, 1.1, 1.1))
C.cyl_bm(bm, V((0.2, 2.3, ZF + 1.0)), V((2.2, 2.3, ZF + 1.0)), 0.42, 12)
K.part(bm, 'paint_metal', name='drawworks', mat_tint=(0.36, 0.42, 0.34) if not DEST else (0.25, 0.24, 0.22), grime=1.0, bisect=False)
bm = bmesh.new()
dzx0, dzy0 = -HW + 0.1, HW - 2.0
if not DEST:
    C.prism_bm(bm, rect(dzx0, dzy0, dzx0 + 1.9, HW - 0.1), ZF, ZF + 2.2)
K.part(bm, 'corrugated_galv', name='doghouse', mat_tint=(0.8, 0.76, 0.66), grime=0.9, bisect=False) if not DEST else None
if not DEST:
    bm = bmesh.new()
    C.prism_bm(bm, rect(dzx0 - 0.1, dzy0 - 0.15, dzx0 + 2.0, HW), ZF + 2.2, ZF + 2.3)
    K.part(bm, 'corrugated_rust', name='doghouse_roof', grime=0.8, bisect=False)
    dz.patch_quad([(dzx0 + 1.92, dzy0 + 0.5, ZF + 0.05), (dzx0 + 1.92, dzy0 + 1.4, ZF + 0.05), (dzx0 + 1.92, dzy0 + 1.4, ZF + 2.0), (dzx0 + 1.92, dzy0 + 0.5, ZF + 2.0)],
                  'interior_dark', 'doghouse_door', lift=0.0)
else:
    K.rubble((dzx0 + 1.0, dzy0 + 1.0, ZF), radius=1.0, height=0.4, mids=('corrugated_rust', 'timber_beam'), n=10, beams=2, tiles=None, seed=SEED, name='doghouse_ruin')
    K.rubble((0.8, -HW - 2.5, 0), radius=1.6, height=0.6, mids=('paint_metal', 'deck_planks'), n=18, beams=4, tiles=None, seed=SEED + 2, name='debris_s')
    bm = bmesh.new()
    C.box_bm(bm, (1.6, -HW - 4.6, 0.35), (1.2, 1.2, 0.7), 0.5)
    K.part(bm, 'paint_metal', name='crown_down', mat_tint=(0.34, 0.32, 0.3), grime=1.0, bisect=False)
    for k in range(4):
        K.decal('soot', (r.uniform(-2, 2), r.uniform(-2, 2), ZF + 0.01), (0, 0, 1), 2.2, 2.2, alpha=0.5)
if not DEST:     # steel stair up the W side: channel stringers, chequer-plate treads, a pipe handrail
    bm = bmesh.new()
    x0, y0, y1 = -HW - 0.55, 1.9, -0.6
    for dx in (-0.4, 0.4):
        C.beam_bm(bm, (x0 + dx, y0, 0.0), (x0 + dx, y1, ZF), 0.08, 0.2)
    n = 7
    for i in range(1, n + 1):
        t = i / (n + 1)
        C.box_bm(bm, (x0, y0 + (y1 - y0) * t, ZF * t), (0.82, 0.26, 0.03))
    K.part(bm, 'paint_metal', name='stair', mat_tint=(0.4, 0.38, 0.35), grime=0.9, bisect=False)
    pipe([(x0 - 0.4, y0, 0.95), (x0 - 0.4, y1, ZF + 0.95)], r=0.022, name='stair_rail', tint=(0.45, 0.43, 0.4), flanges=False)
    pipe([(x0 - 0.4, y0, 0), (x0 - 0.4, y0, 0.95)], r=0.022, name='stair_post', tint=(0.45, 0.43, 0.4), flanges=False)
drums([(HW - 0.5, -HW - 0.6, 0), (HW - 1.2, -HW - 0.5, 0)], tint=(0.22, 0.24, 0.22))
K.footprint(rect(-HW - 0.05, -HW - 0.05, HW + 0.05, HW + 0.05), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=32)
