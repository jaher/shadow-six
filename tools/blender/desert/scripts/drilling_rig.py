"""Oil drilling rig (M11 'In the Soup', Maradah oil field; 4 demolition targets): 1930s-40s rotary rig.
Steel I-beam substructure with X-bracing and a planked derrick floor, 4-leg lattice derrick (angle-iron legs,
girts, X-braces per panel) tapering to a crown platform with railing + crown block, monkey board, climbing ladder,
travelling block + hook + kelly on wire lines, rotary table; corrugated drawworks house and doghouse, catwalk ramp
and pipe rack with drill pipe, mud pits + pump, horizontal fuel tank on saddles, crude spills, sandbag MG sangar.
destroyed: derrick buckled and toppled across the site, burning wellhead (fire anchors), scorched wreckage.
Usage: blender -b --python drilling_rig.py -- outdir [intact|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, Matrix

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'intact'
DEST = VAR == 'destroyed'
SEED = int(av[2]) if len(av) > 2 else 111
K.begin('drilling_rig' + ('_destroyed' if DEST else ''), SEED, theater='desert')
r = K.rng()
ZF = 2.6                    # derrick floor
B0, B1, HD = 7.2, 1.7, 24.0  # derrick base / top width, height above floor
STEEL = 'wood_paint'           # painted steel is a dielectric paint film: pale paint base x red-oxide tint (steel_painted read black)
ST = (0.66, 0.42, 0.32)      # faded red-oxide
NP = 8                      # panels


FALL = V((0.45, -0.89, 0)).normalized()        # destroyed: falls SSE, clear of the catwalk, pipe rack, sheds and tank
ZSNAP = HD * (2 / NP) ** 0.92
PIV = V((FALL.x * B0 / 2 * 0.9, FALL.y * B0 / 2 * 0.9, ZF + ZSNAP))
ROT = Matrix.Rotation(math.radians(110), 3, V((0, 0, 1)).cross(FALL).normalized())


SIDE = FALL.cross(V((0, 0, 1))).normalized()
# crumple path of the fallen upper derrick (distance along FALL from the pivot, height): steep kink off the stump,
# a buckled middle, then the top section crushed flat on the sand
PATH = [(0.0, ZF + ZSNAP), (2.6, 3.4), (8.2, 0.95), (13.0, 0.55), (21.0, 0.4)]
PLAT = [0.0, 0.35, -0.6, 0.9, 0.2]          # sideways zig-zag of the kinks (m)


def _path(sv):
    """Point + frame on the crumple path at arc length sv."""
    pts = [PIV + FALL * d + SIDE * sd + V((0, 0, z - PIV.z)) for (d, z), sd in zip(PATH, PLAT)]
    acc = 0.0
    for i in range(len(pts) - 1):
        seg = pts[i + 1] - pts[i]
        L = seg.length
        if sv <= acc + L or i == len(pts) - 2:
            t = (sv - acc) / L
            T = seg.normalized()
            Nn = SIDE.cross(T).normalized()
            if Nn.z < 0:
                Nn = -Nn
            return pts[i] + seg * t, T, Nn, i + min(1.0, max(0.0, t))
        acc += L


def fallen(p, bend=True):
    """Pose of a point of the upper derrick after the collapse: arc length above the snap maps onto the crumple
    path; the cross-section is crushed flat progressively (lattice squashed where it hit the ground), twisted and
    jittered, never below the ground."""
    from mathutils import noise
    p = V(p)
    sv = max(0.0, p.z - (ZF + ZSNAP))
    c, T, Nn, seg = _path(sv)
    u1 = p.x * SIDE.x + p.y * SIDE.y
    u2 = p.x * FALL.x + p.y * FALL.y
    crush = 1.0 if seg < 1 else max(0.28, 1.0 - 0.3 * (seg - 1))
    tw = 0.25 * max(0.0, seg - 1)
    ca, sa = math.cos(tw), math.sin(tw)
    a1, a2 = u1 * ca - u2 * sa, u1 * sa + u2 * ca
    q = c + SIDE * a1 * (1.0 + 0.15 * max(0.0, seg - 2)) - Nn * a2 * crush
    if bend:
        q += V((noise.noise(p * 0.9), noise.noise(p * 0.9 + V((5, 1, 3))), 0.6 * noise.noise(p * 0.9 + V((2, 7, 1))))) * (0.12 + 0.1 * seg)
    if q.z < 0.1:
        q.z = 0.1 + 0.08 * abs(noise.noise(q * 0.7))
    return q


def derrick():
    members = []           # (p0, p1, out, kind)
    def corner(k, z):
        w = B0 + (B1 - B0) * (z / HD)
        sx, sy = ((-1, -1), (1, -1), (1, 1), (-1, 1))[k]
        return V((sx * w / 2, sy * w / 2, ZF + z))
    zs = [HD * (i / NP) ** 0.92 for i in range(NP + 1)]
    for k in range(4):
        sx, sy = ((-1, -1), (1, -1), (1, 1), (-1, 1))[k]
        for i in range(NP):
            members.append((corner(k, zs[i]), corner(k, zs[i + 1]), V((sx, sy, 0)), 'leg'))
    for i in range(1, NP + 1):
        for k in range(4):
            a, b = corner(k, zs[i]), corner((k + 1) % 4, zs[i])
            a0, b0 = corner(k, zs[i - 1]), corner((k + 1) % 4, zs[i - 1])
            nrm = ((a + b) / 2 - V((0, 0, a.z))).normalized()
            members += [(a, b, nrm, 'girt'), (a0, b, nrm, 'brace'), (b0, a, nrm, 'brace')]
    bl, bb, bg = dz.bmesh.new(), dz.bmesh.new(), dz.bmesh.new()
    rr = K.rng()
    for p0, p1, out, kind in members:
        tgt = bl if kind == 'leg' else bb
        w = 0.2 if kind == 'leg' else 0.11
        if not DEST:
            dz.angle_bm(tgt, p0, p1, w, 0.02 if kind == 'leg' else 0.014, out)
            continue
        lo, hi = ZF + ZSNAP - 0.01, ZF + ZSNAP + 0.01
        if max(p0.z, p1.z) <= hi:          # standing stump: lower panel intact, upper stump panel torn / bent
            if max(p0.z, p1.z) > ZF + zs[1] + 0.05 and kind != 'leg':
                if rr.random() < 0.45:
                    continue
                m = p0.lerp(p1, rr.uniform(0.35, 0.65)) + V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-0.6, 0.2))) * 0.35
                dz.angle_bm(tgt, p0, m, w, 0.014, out)
                if rr.random() < 0.6:
                    dz.angle_bm(tgt, m, p1, w, 0.014, out)
                continue
            if kind == 'leg' and max(p0.z, p1.z) > ZF + zs[1] + 0.05:
                a, b = (p0, p1) if p0.z < p1.z else (p1, p0)
                t = rr.uniform(0.35, 1.0)              # each leg torn at its own height, stub bent out/over
                m = a.lerp(b, t)
                dz.angle_bm(tgt, a, m, w, 0.02, out)
                dz.angle_bm(tgt, m, m + (V((out.x, out.y, 0)) * rr.uniform(0.2, 0.6) + FALL * rr.uniform(0.2, 0.8) + V((0, 0, rr.uniform(-0.4, 0.3)))), w, 0.02, out)
                continue
            dz.angle_bm(tgt, p0, p1, w, 0.02, out)
            continue
        if min(p0.z, p1.z) < lo:           # member crossing the snap: torn stub below + torn end above
            a, b = (p0, p1) if p0.z < p1.z else (p1, p0)
            t = (ZF + ZSNAP - a.z) / (b.z - a.z)
            m = a.lerp(b, t)
            hinge = (m - PIV).length < B0 * 0.7 and kind == 'leg'
            dz.angle_bm(tgt, a, m - (b - a).normalized() * (0 if hinge else rr.uniform(0.1, 0.6)), w, 0.02, out)
            if hinge:
                dz.angle_bm(tgt, m, fallen(m + (b - m) * 0.3, False), w, 0.02, out)   # bent-over hinge leg
            p0, p1 = m + (b - m) * (0.3 if hinge else rr.uniform(0.15, 0.5)), b
            if kind != 'leg' and rr.random() < 0.6:
                continue
        if kind != 'leg' and rr.random() < 0.28:
            continue                       # braces torn off
        q0, q1 = fallen(p0), fallen(p1)
        mid = (q0 + q1) / 2 + V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-0.5, 0.2))) * (0.25 if kind != 'leg' else 0.08)
        dz.angle_bm(tgt, q0, mid, w, 0.02, out)            # buckled: every member kinked in two
        dz.angle_bm(tgt, mid, q1, w, 0.02, out)
    for b_ in (bl, bb):
        dz.bmesh.ops.recalc_face_normals(b_, faces=b_.faces)
    K.part(bl, STEEL, name='derrick_legs', uv='keep', mat_tint=ST, grime=0.5, bisect=False)
    K.part(bb, STEEL, name='derrick_braces', uv='keep', mat_tint=ST, grime=0.4, bisect=False)
    for i in range(1, NP + 1):             # gusset plates + bolts at every leg/girt joint (both faces)
        if DEST and i > 2:
            continue
        for k in range(4):
            c = corner(k, zs[i])
            for f in (0, 1):
                n = (corner((k + f) % 4, zs[i]) + corner((k + f + 1) % 4, zs[i])) / 2 if f == 0 else (corner((k - 1) % 4, zs[i]) + corner(k, zs[i])) / 2
                n = (n - V((0, 0, c.z))).normalized()
                dz.gusset_bm(bg, c + (V((0, 0, c.z)) - c).normalized() * 0.0, n, 0.32 if i < 4 else 0.24)
    K.part(bg, STEEL, name='gussets', mat_tint=(0.66, 0.56, 0.45), grime=0.5, bisect=False, lod='drop')
    # crown platform + railing + crown block with sheaves + gin pole; racking (monkey) board with fingers; ladder
    bm, bsh = dz.bmesh.new(), dz.bmesh.new()
    zt = ZF + HD
    top = [V((x, y, zt)) for x, y in ((-1.4, -1.4), (1.4, -1.4), (1.4, 1.4), (-1.4, 1.4))]
    C.hexa_bm(bm, [p - V((0, 0, 0.12)) for p in top] + top)
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        for t in range(4):
            c = a.lerp(b, t / 4)
            C.beam_bm(bm, c, c + V((0, 0, 1.0)), 0.05, 0.05)
        C.beam_bm(bm, a + V((0, 0, 1.0)), b + V((0, 0, 1.0)), 0.05, 0.05)
    for sx in (-0.45, 0.45):               # crown block frame
        C.box_bm(bm, (sx, 0, zt + 0.5), (0.12, 1.0, 1.0))
    C.beam_bm(bm, V((0, 0, zt)), V((0, 0, zt + 3.0)), 0.12, 0.12)
    C.beam_bm(bm, V((-0.5, 0, zt + 2.9)), V((0.5, 0, zt + 2.9)), 0.1, 0.1)
    for k in range(5):                     # sheaves on the crown shaft
        x = -0.32 + 0.16 * k
        C.cyl_bm(bsh, (x - 0.03, 0, zt + 0.55), (x + 0.03, 0, zt + 0.55), 0.38, 10)
    C.cyl_bm(bsh, (-0.5, 0, zt + 0.55), (0.5, 0, zt + 0.55), 0.06, 8)
    zm = ZF + HD * 0.62
    wm = B0 + (B1 - B0) * 0.62
    C.hexa_bm(bm, [V((x, y, zm - 0.08)) for x, y in ((-wm / 2 - 0.1, wm / 2 - 1.3), (wm / 2 + 0.1, wm / 2 - 1.3), (wm / 2 + 0.1, wm / 2 + 0.7), (-wm / 2 - 0.1, wm / 2 + 0.7))] +
              [V((x, y, zm)) for x, y in ((-wm / 2 - 0.1, wm / 2 - 1.3), (wm / 2 + 0.1, wm / 2 - 1.3), (wm / 2 + 0.1, wm / 2 + 0.7), (-wm / 2 - 0.1, wm / 2 + 0.7))])
    for k in range(9):                     # fingerboard fingers
        x = -wm / 2 + 0.3 + k * (wm - 0.6) / 8
        C.box_bm(bm, (x, wm / 2 - 1.9, zm + 0.05), (0.06, 1.2, 0.08))
    for sx in (-1, 1):
        C.beam_bm(bm, V((sx * wm / 2, wm / 2 + 0.7, zm)), V((sx * wm / 2, wm / 2 + 0.7, zm + 1.0)), 0.05, 0.05)
    C.beam_bm(bm, V((-wm / 2, wm / 2 + 0.7, zm + 1.0)), V((wm / 2, wm / 2 + 0.7, zm + 1.0)), 0.05, 0.05)
    if DEST:
        for bmx in (bm, bsh):
            for v in bmx.verts:
                v.co = fallen(v.co)
    K.part(bm, STEEL, name='crown_monkeyboard', mat_tint=ST, bisect=False)
    K.part(bsh, 'cast_iron', name='sheaves', mat_tint=(0.5, 0.45, 0.4), smooth=True, bisect=False)
    if not DEST:                           # stands of drill pipe racked against the monkey board
        bm = dz.bmesh.new()
        for k in range(9):
            x = -wm / 2 + 0.5 + k * (wm - 1.0) / 8
            for dd in (-0.045, 0.045):
                C.cyl_bm(bm, (x * 0.6 + dd, 1.4 + 0.02 * k, ZF + 0.05), (x + dd, wm / 2 - 1.9, zm + 0.2 + 0.1 * (k % 3)), 0.032, 5, caps=False)
        K.part(bm, STEEL, name='pipe_stands', mat_tint=(0.62, 0.6, 0.56), bisect=False, grime=0.5)    # dielectric paint: never a black curtain
    bm = dz.bmesh.new()                    # ladder up the west face
    for i in range(NP):
        z0, z1 = zs[i], zs[i + 1]
        w0, w1 = B0 + (B1 - B0) * z0 / HD, B0 + (B1 - B0) * z1 / HD
        for sgn in (-0.25, 0.25):
            a, b = V((-w0 / 2 - 0.15, sgn, ZF + z0)), V((-w1 / 2 - 0.15, sgn, ZF + z1))
            if DEST and i >= 2:
                a, b = fallen(a), fallen(b)
            elif DEST and i == 1:
                continue
            C.beam_bm(bm, a, b, 0.04, 0.04)
        n = int((z1 - z0) / 0.6)
        for j in range(n if not (DEST and i >= 1) else 0):
            z = z0 + (z1 - z0) * j / n
            w = B0 + (B1 - B0) * z / HD
            C.cyl_bm(bm, V((-w / 2 - 0.15, -0.25, ZF + z)), V((-w / 2 - 0.15, 0.25, ZF + z)), 0.014, 4, caps=False)
    K.part(bm, 'steel_galv', name='derrick_ladder', grime=0.3, bisect=False)
    if not DEST:                           # guy lines to buried deadmen
        bm = dz.bmesh.new()
        for gx, gy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            top_p = V((gx * 1.0, gy * 1.0, ZF + HD * 0.72))
            anc = V((gx * 16.0, gy * 16.0, 0.3))
            C.cyl_bm(bm, top_p, anc, 0.012, 3, caps=False)
            C.box_bm(bm, tuple(anc - V((0, 0, 0.15))), (0.8, 0.8, 0.4))
        K.part(bm, 'steel_galv', name='guy_lines', grime=0.2, bisect=False)
        K.ladder_meta((-B0 / 2 - 0.7, 0.0), (-B1 / 2 + 0.2, 0.0), ZF + HD)
        K.roof_meta([(p.x, p.y) for p in top], ZF + HD, walkable=True, kind='crown')
        K.anchor('crown', (0, 0, ZF + HD + 0.5))


derrick()
# ---------------- substructure (I-beam sills, posts, X-bracing) + planked derrick floor + stairs
bm = dz.bmesh.new()
H2 = B0 / 2 + 0.6
for x in (-H2, -H2 / 3, H2 / 3, H2):
    C.beam_bm(bm, (x, -H2, 0.15), (x, H2, 0.15), 0.3, 0.3)                          # sills
    for y in (-H2, 0, H2):
        C.beam_bm(bm, (x, y, 0.3), (x, y, ZF - 0.25), 0.22, 0.22)                    # posts
    C.beam_bm(bm, (x, -H2, 0.4), (x, 0, ZF - 0.3), 0.1, 0.1)
    C.beam_bm(bm, (x, 0, 0.4), (x, -H2, ZF - 0.3), 0.1, 0.1)
    C.beam_bm(bm, (x, 0, 0.4), (x, H2, ZF - 0.3), 0.1, 0.1)
    C.beam_bm(bm, (x, H2, 0.4), (x, 0, ZF - 0.3), 0.1, 0.1)
for y in (-H2, H2):
    C.beam_bm(bm, (-H2, y, ZF - 0.2), (H2, y, ZF - 0.2), 0.25, 0.3)
K.part(bm, STEEL, name='substructure', uv='beam', axis=(1, 0, 0), mat_tint=(0.55, 0.5, 0.45))
bm = dz.bmesh.new()
C.box_bm(bm, (0, 0, ZF - 0.05), (2 * H2 + 0.3, 2 * H2 + 0.3, 0.1))
K.part(bm, 'deck_planks', name='rig_floor', uv='beam', axis=(1, 0, 0))
K.roof_meta([(-H2, -H2), (H2, -H2), (H2, H2), (-H2, H2)], ZF, walkable=not DEST, kind='rig_floor')
K.footprint([(-H2, -H2), (H2, -H2), (H2, H2), (-H2, H2)], 'HIGH', 'rig')
K.railing((-H2, H2 + 0.1, ZF), (H2, H2 + 0.1, ZF), 1.0, 'pipe', name='rail_n')
K.railing((H2 + 0.1, -H2, ZF), (H2 + 0.1, H2, ZF), 1.0, 'pipe', name='rail_e')
top = K.stairs((-H2 - 0.28 * 14, -H2 + 0.7, 0.0), (1, 0, 0), 0.9, ZF, 14, 'steel_galv', solid=False, name='rig_stairs', meta=False)
K.ladder_meta((-H2 - 0.28 * 14 - 0.4, -H2 + 0.7), (-H2 + 0.5, -H2 + 0.7), ZF)
K.footprint_rect(-H2 - 0.28 * 7, -H2 + 0.7, 0.28 * 14, 1.0, 0, 'LOW', 'stairs')
# rotary table, kelly, travelling block + hook, drill lines, dead-line anchor
bm = dz.bmesh.new()
C.box_bm(bm, (0, 0, ZF + 0.25), (1.4, 1.4, 0.4))
C.cyl_bm(bm, (0, 0, ZF + 0.45), (0, 0, ZF + 0.52), 0.5, 12)
if not DEST:
    zb = ZF + 12.0
    C.beam_bm(bm, (0, 0, ZF + 0.5), (0, 0, zb - 1.5), 0.14, 0.14)                    # kelly
    C.cyl_bm(bm, (0, 0, zb - 1.5), (0, 0, zb - 0.6), 0.22, 8)                        # swivel
    C.box_bm(bm, (0, 0, zb + 0.3), (0.9, 0.5, 1.4), taper=(0.7, 0.9))                # travelling block
    for dx in (-0.3, -0.1, 0.1, 0.3):
        dz.rope(V((dx, 0.0, zb + 1.0)), V((dx * 1.5, 0.0, ZF + HD + 0.1)), 0.0, 0.015, 2, bm=bm)
    dz.rope(V((0.6, 0.0, ZF + HD + 0.1)), V((H2 - 0.3, 1.0, ZF + 1.2)), 0.0, 0.015, 2, bm=bm)   # fast line to drawworks
    C.cyl_bm(bm, (0.0, 0.0, zb - 0.6), (0.9, 1.2, ZF + 1.2), 0.04, 6)                  # mud hose
K.part(bm, STEEL, name='rotary_blocks', mat_tint=(0.35, 0.33, 0.3), grime=0.3)
# ---------------- drawworks on the floor (north) + engine house on the ground (east)
bm, bd_ = dz.bmesh.new(), dz.bmesh.new()     # drawworks: side frames, hoist drum with wire wraps, brake rims, chain guard, levers
for sx in (-1.55, 1.55):
    C.box_bm(bm, (sx, H2 - 1.0, ZF + 0.6), (0.12, 1.3, 1.2))
C.box_bm(bm, (0.0, H2 - 0.45, ZF + 0.25), (3.2, 0.25, 0.5))
C.box_bm(bm, (2.0, H2 - 1.0, ZF + 0.7), (0.5, 1.1, 1.0))
for sx in (-1.3, 1.3):
    C.cyl_bm(bm, (sx - 0.08, H2 - 1.0, ZF + 0.8), (sx + 0.08, H2 - 1.0, ZF + 0.8), 0.58, 14)
C.beam_bm(bm, (-0.6, H2 - 1.8, ZF + 0.1), (-0.8, H2 - 1.9, ZF + 1.3), 0.05, 0.05)
C.beam_bm(bm, (0.4, H2 - 1.8, ZF + 0.1), (0.3, H2 - 1.95, ZF + 1.1), 0.04, 0.04)
K.part(bm, STEEL, name='drawworks', mat_tint=(0.42, 0.44, 0.36), bisect=False)
C.cyl_bm(bd_, (-1.2, H2 - 1.0, ZF + 0.8), (1.2, H2 - 1.0, ZF + 0.8), 0.45, 14)
for k in range(8):
    x = -1.1 + k * 0.3
    C.cyl_bm(bd_, (x - 0.1, H2 - 1.0, ZF + 0.8), (x + 0.1, H2 - 1.0, ZF + 0.8), 0.47, 14, caps=False)
K.part(bd_, 'cast_iron', name='hoist_drum', mat_tint=(0.45, 0.42, 0.38), smooth=True, bisect=False)
EX0, EX1, EY0, EY1 = H2 + 0.4, H2 + 5.4, -1.5, 3.0
epoly = [(EX0, EY0), (EX1, EY0), (EX1, EY1), (EX0, EY1)]
ed = K.opening(epoly, 0, 2.5, 2.2, 2.4, 0.0, 0.12, 'rect', 'door')
ew = K.opening(epoly, 1, 2.2, 1.2, 0.6, 1.7, 0.12)
K.wall_ring(epoly, 3.0, 0.12, 'corrugated_rust', [ed, ew], name='engine_house', rot90=True)
K.roof_shed(EX0, EY0, EX1, EY1, 3.05, 3.5, 'corrugated_rust', low_side='+x', oh=0.3, name='engine_roof', gutters=False)
C.A.meta['roofs'][-1]['walkable'] = False
K.door(ed, 'engine', 'barn', (0.45, 0.42, 0.35), open_deg=35 if not DEST else 80, step=None)
K.window(ew, 'fixed', (3, 1), frame=(0.3, 0.3, 0.3), sill=None, streak=False, name='ew')
bm = dz.bmesh.new()      # engine inside (seen through the barn door): block, flywheel, radiator
C.box_bm(bm, (EX0 + 2.5, 0.6, 0.7), (2.4, 1.0, 1.1))
C.box_bm(bm, (EX0 + 1.0, 0.6, 1.0), (0.3, 1.1, 1.3))
C.cyl_bm(bm, (EX0 + 3.8, 0.6, 0.8), (EX0 + 3.95, 0.6, 0.8), 0.6, 14)
K.part(bm, STEEL, name='engine', mat_tint=(0.35, 0.38, 0.32), bisect=False, lod='drop')
bm = dz.bmesh.new()      # exhaust stacks
for y in (0.0, 1.6):
    C.cyl_bm(bm, (EX1 - 1.0, y, 2.5), (EX1 - 1.0, y, 4.8), 0.1, 8)
K.part(bm, 'cast_iron', name='exhausts', grime=0.3)
K.decal('soot', (EX1 - 1.0, 0.8, 3.52), (0, 0, 1), 2.0, 2.5, alpha=0.6)
# doghouse (driller's shack, timber) west of the floor
dpoly = [(-H2 - 4.2, H2 - 3.0), (-H2 - 1.0, H2 - 3.0), (-H2 - 1.0, H2), (-H2 - 4.2, H2)]
dd = K.opening(dpoly, 1, 1.5, 0.9, 2.0, 0.0, 0.1, 'rect', 'door')
dw = K.opening(dpoly, 0, 1.6, 1.0, 0.8, 1.2, 0.1)
K.wall_ring(dpoly, 2.5, 0.1, 'timber_siding', [dd, dw], name='doghouse', mat_tint=(0.9, 0.82, 0.62))
K.roof_shed(dpoly[0][0], dpoly[0][1], dpoly[1][0], dpoly[2][1], 2.55, 2.85, 'timber_tarred', low_side='-y', oh=0.2, name='dog_roof', gutters=False)
C.A.meta['roofs'][-1]['walkable'] = False
K.door(dd, 'doghouse', 'plank', (0.5, 0.44, 0.33), step=None)
K.window(dw, 'casement', (2, 2), frame=(0.5, 0.45, 0.35), sill='timber_beam', streak=False, name='dw')
# catwalk ramp (V-door) + pipe rack with drill pipe (south)
bm = dz.bmesh.new()
C.hexa_bm(bm, [V((-0.9, -H2 - 7.0, 0.0)), V((0.9, -H2 - 7.0, 0.0)), V((0.9, -H2, ZF - 0.1)), V((-0.9, -H2, ZF - 0.1)),
               V((-0.9, -H2 - 7.0, 0.15)), V((0.9, -H2 - 7.0, 0.15)), V((0.9, -H2, ZF)), V((-0.9, -H2, ZF))][:4] +
          [V((-0.9, -H2 - 7.0, 0.15)), V((0.9, -H2 - 7.0, 0.15)), V((0.9, -H2, ZF)), V((-0.9, -H2, ZF))])
dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'deck_planks', name='catwalk', uv='beam', axis=(0, 1, 0))
K.footprint_rect(0, -H2 - 3.5, 1.8, 7.0, 0, 'LOW', 'catwalk')
bm, bp = dz.bmesh.new(), dz.bmesh.new()
for y in (-H2 - 2.0, -H2 - 6.0):
    for x in (-5.8, -2.0):
        C.box_bm(bm, (x, y, 0.35), (0.25, 0.25, 0.7))
    C.beam_bm(bm, (-6.1, y, 0.75), (-1.7, y, 0.75), 0.25, 0.12)
for k in range(18 if not DEST else 10):
    x = -5.7 + (k % 10) * 0.22 + (0.11 * ((k // 10) % 2))
    z = 0.93 + 0.19 * (k // 10)
    C.cyl_bm(bp, (x, -H2 - 8.4 + r.uniform(0, 0.3), z), (x, -H2 + 0.5 - r.uniform(0, 0.4), z), 0.085, 8)
K.part(bm, TIMB := 'timber_beam', name='pipe_rack', uv='beam', axis=(1, 0, 0), mat_tint=(0.8, 0.7, 0.55))
K.part(bp, STEEL, name='drill_pipe', smooth=True, mat_tint=(0.5, 0.45, 0.4), grime=0.4)
K.footprint([(-6.2, -H2 - 8.5), (-1.6, -H2 - 8.5), (-1.6, -H2 + 0.5), (-6.2, -H2 + 0.5)], 'LOW', 'pipe_rack')
# mud pits + pump (north), fuel tank on saddles (east)
bm, bmud = dz.bmesh.new(), dz.bmesh.new()
for k, x in enumerate((-4.0, 1.0)):
    pp = [(x - 2.3, H2 + 1.2), (x + 2.3, H2 + 1.2), (x + 2.3, H2 + 3.2), (x - 2.3, H2 + 3.2)]
    KA.ring_bm(bm, pp, C.poly_offset(pp, -0.08), 0.0, 1.3)
    C.prism_bm(bmud, C.poly_offset(pp, -0.08), 0.0, 1.05)
    K.footprint(pp, 'HIGH', 'mud_pit')
C.box_bm(bm, (6.0, H2 + 2.2, 0.6), (2.4, 1.2, 1.2))
C.cyl_bm(bm, (4.8, H2 + 2.0, 0.8), (3.4, H2 + 2.0, 0.8), 0.2, 8)
K.footprint_rect(6.0, H2 + 2.2, 2.4, 1.2, 0, 'HIGH', 'pump')
K.part(bm, STEEL, name='mud_pits', mat_tint=(0.5, 0.48, 0.42))
K.part(bmud, 'mud', name='mud', grime=0, bisect=False, mat_tint=(0.55, 0.5, 0.45))
bm = dz.bmesh.new()      # plank walkway across the pits + suction/return pipes to the pump
for k in range(10):
    C.box_bm(bm, (-6.2 + k * 0.95, H2 + 2.2, 1.34), (0.9, 0.6, 0.05))
K.part(bm, 'deck_planks', name='pit_walk', uv='beam', axis=(1, 0, 0))
bm = dz.bmesh.new()
C.cyl_bm(bm, (3.3, H2 + 2.0, 0.8), (3.3, H2 + 2.0, 1.5), 0.1, 8)
C.cyl_bm(bm, (3.3, H2 + 2.0, 1.5), (1.0, H2 + 2.0, 1.5), 0.1, 8)
C.cyl_bm(bm, (6.0, H2 + 1.6, 1.2), (6.0, H2 - 0.5, ZF + 0.3), 0.1, 8)
C.cyl_bm(bm, (6.0, H2 - 0.5, ZF + 0.3), (0.9, 1.2, ZF + 0.3), 0.1, 8)
K.part(bm, STEEL, name='mud_lines', mat_tint=(0.4, 0.38, 0.34), bisect=False)
bm = dz.bmesh.new()
TX = EX1 + 3.0
C.cyl_bm(bm, (TX, -3.0, 1.35), (TX, 2.5, 1.35), 1.1, 16)
for y in (-2.2, 1.7):
    C.box_bm(bm, (TX, y, 0.4), (1.9, 0.4, 0.8))
C.cyl_bm(bm, (TX, -0.3, 2.4), (TX, -0.3, 2.62), 0.28, 8)
K.part(bm, STEEL, name='fuel_tank', mat_tint=(0.62, 0.6, 0.52))
K.footprint_rect(TX, -0.25, 2.3, 5.6, 0, 'HIGH', 'tank')
dz.sandbags((-H2 - 6.5, -H2 - 9.5), (-H2 - 2.5, -H2 - 9.5), 4, name='sangar_s', thick=1)
dz.sandbags((-H2 - 6.8, -H2 - 9.2), (-H2 - 6.8, -H2 - 6.8), 4, name='sangar_w', thick=1)
K.sign((EX0 - 0.03, 2.2, 2.0), (-1, 0, 0), 0.8, 'halt_sperrgebiet', board='timber_grey')
for k in range(7):     # crude spills / drilling mud splashes
    dz.decal_dz('oil_stain' if k % 2 else 'wet_ground', (r.uniform(-H2 - 2, H2 + 2), r.uniform(-H2 - 3, H2 + 3), 0.02 + 0.0005 * k), (0, 0, 1),
                r.uniform(1.5, 3.5), r.uniform(1.5, 3.0), up=(r.uniform(-1, 1), 1, 0), alpha=0.7)
if DEST:
    dz.safe_bite((EX0 + 2.5, 0.8, 1.5), 1.6, seed=3)
    bm = dz.bmesh.new()      # wreckage: torn angle-iron pieces, bent sheets from the engine house
    for k in range(18):
        c = V((r.uniform(-4, 14), r.uniform(-16, 2), 0.12))
        a = r.uniform(0, math.pi)
        d = V((math.cos(a), math.sin(a), r.uniform(-0.1, 0.25)))
        L = r.uniform(0.8, 3.0)
        m = c + d * L / 2 + V((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0, 0.3)))
        dz.angle_bm(bm, c, m, 0.12, 0.014, (0, 0, 1))
        dz.angle_bm(bm, m, c + d * L, 0.12, 0.014, (0, 0, 1))
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STEEL, name='wreck_iron', uv='keep', mat_tint=(0.55, 0.42, 0.34), bisect=False)
    bm = dz.bmesh.new()
    for k in range(6):
        c = V((EX0 + r.uniform(-1, 7), r.uniform(-5, 4), 0.1))
        a = r.uniform(0, math.pi)
        u, v = V((math.cos(a), math.sin(a), 0)), V((-math.sin(a), math.cos(a), 0.15))
        dz.corrugated_bm(bm, c, u, v, 0.9, r.uniform(1.2, 2.0), 0.15, 0.02, bend=r.uniform(0.2, 0.8), twist=r.uniform(-0.4, 0.4), nrows=3)
    K.part(bm, 'corrugated_rust', name='wreck_sheets', uv='beam', axis=(0, 1, 0), mat_tint=(0.75, 0.68, 0.6), bisect=False)
    bm = dz.bmesh.new()      # crude pooling round the wellhead and under the rotary (glossy black-brown liquid)
    for (cx, cy, rx, ry) in ((0.0, -H2 - 1.5, 3.2, 2.0), (1.8, -H2 - 3.8, 1.8, 1.2), (-2.2, -2.0, 1.5, 1.1)):
        pts = dz._blob_outline(V((cx, cy, 0.035)), V((1, 0, 0)), V((0, 1, 0)), rx * 2, ry * 2, int(cx * 3), 16, 0.35)
        bm.faces.new([bm.verts.new(p_) for p_ in pts])
    K.part(bm, 'bitumen_felt', name='crude_pool', mat_tint=(0.42, 0.34, 0.26), grime=0, bisect=False)   # crude-soaked sand: dark brown, never a black hole
    dz.decal_dz('scorch_a', (0.0, 0.0, 0.03), (0, 0, 1), 14.0, 14.0, up=(0, 1, 0), alpha=0.85)
    dz.decal_dz('scorch_b', (0.0, 0.0, ZF + 0.02), (0, 0, 1), 8.0, 8.0, up=(1, 0, 0), alpha=0.9)
    for k in range(6):
        dz.decal_dz(r.choice(['scorch_a', 'scorch_b', 'ash']), (r.uniform(-8, 12), r.uniform(-16, 4), 0.032 + 0.001 * k), (0, 0, 1), r.uniform(3, 6), r.uniform(3, 6),
                    up=(r.uniform(-1, 1), 1, 0), alpha=0.7)
    fp = []
    for s_, t_ in ((-1, 0), (1, 0), (1, 18), (-1, 18)):
        fp.append((FALL.x * (4 + t_) + s_ * FALL.y * 2.5, FALL.y * (4 + t_) - s_ * FALL.x * 2.5))
    K.footprint(fp, 'LOW', 'wreck')
    for p_, sz in (((0, 0, ZF + 0.5), 3.0), ((0.0, -H2 - 1.5, 0.3), 2.5), ((EX0 + 2, 0.5, 1.0), 1.5)):
        K.anchor('fire', p_, (0, -1, 0), size=sz)
    C.A.meta['notes'].append('destroyed variant: derrick snapped above the second panel and fell SE (buckled, crushed flat where it hit the ground; LOW wreck cover); wellhead burning in a crude pool')
else:
    K.anchor('explosive_target', (0, 0, ZF + 0.5), (0, -1, 0), kind='drilling_rig')
dz.finalize(OUT, ao_res=1024, ao_samples=48)
