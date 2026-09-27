"""Octagonal camp enclosure kit (M9 'A Courtesy Call': desert camp in stone and wire walls). Modular pieces meeting
at 135 deg: rubble-stone footing + battered mud-brick upper wall with hand-made wobble, rounded mud coping,
buttresses on the inner face, weep holes, iron pickets with barbed-wire strands; octagon corner tower with loopholes.
Pieces (variant arg): seg (8 m straight), corner (135 deg joint tower), gate (seg with a wire-and-timber gate,
open-able), breach (destroyed seg: blown gap + rubble, for demolition objectives).
Segment runs along X from -4 to +4, outside face = -Y (south). Corner: centred at origin, the two walls leave
towards -X and along the 135 deg direction. Usage: blender -b --python wall_octagon.py -- outdir [seg|corner|gate|breach] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V
from mathutils import noise

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'seg'
SEED = int(av[2]) if len(av) > 2 else {'seg': 71, 'corner': 72, 'gate': 73, 'breach': 71}[VAR]
K.begin('wall_octagon_' + VAR, SEED, theater='desert')
r = K.rng()
H, B0, B1, FH = 2.7, 0.8, 0.5, 0.65       # height, base width, top width, stone footing height
L = 8.0


MUD, MT = 'mud_render', (0.98, 0.96, 0.94)


def gully(t, seed):
    """Rain-gully strength along the run (0..1): a few narrow eroded channels at seeded positions."""
    rr = __import__('random').Random(seed)
    g = 0.0
    for k in range(4):
        tg = rr.uniform(0.4, 7.6)
        g = max(g, math.exp(-((t - tg) / rr.uniform(0.08, 0.16)) ** 2) * rr.uniform(0.5, 1.0))
    return g


def wall_run(p0, p1, gaps=(), name='wall', wire=True, seed=0):
    """Rubble-stone footing + hand-built battered mud wall with an eroded rounded crown, vertical rain gullies (deeper
    at the top), an undercut where the mud meets the stones, buttresses inside, palm-log weep spouts, angle-iron
    pickets with barbed wire. Outside = right-hand side of p0->p1."""
    p0, p1 = V((*p0, 0)), V((*p1, 0))
    d = (p1 - p0)
    Lr = d.length
    d.normalize()
    n = V((d.y, -d.x, 0))
    runs = dz.segs_minus(Lr, gaps)
    for t0, t1 in runs:
        ns = max(2, int((t1 - t0) / 0.5))
        rings = []
        for i in range(ns + 1):
            t = t0 + (t1 - t0) * i / ns
            c = p0 + d * t
            z1 = FH + 0.06 * noise.noise(V((t * 1.3 + SEED, 0.5, 2.0)))
            prof = [(B0 / 2 + 0.05, -0.05), (-B0 / 2 - 0.05, -0.05), (-B0 / 2 + 0.01, z1), (B0 / 2 - 0.01, z1)]
            rings.append([c + n * x + V((0, 0, z)) for x, z in prof])
        bm = dz.bmesh.new()
        C.loft_bm(bm, rings)
        dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, 'fieldstone', name=name + '_foot%d' % int(t0), mat_tint=(1.0, 0.93, 0.82))
        ns = max(2, int((t1 - t0) / 0.22))
        rings = []
        for i in range(ns + 1):
            t = t0 + (t1 - t0) * i / ns
            c = p0 + d * t
            go, gi = gully(t, SEED + seed), gully(t, SEED + seed + 50) * 0.6
            wob = 0.035 * noise.noise(V((t * 0.9 + SEED, 0.3, 0.3)))
            zt = H + 0.06 * noise.noise(V((t * 0.6, SEED * 0.1, 1.0))) - 0.14 * max(go, gi)
            wm = (B0 + B1) / 2
            prof = [(B0 / 2 - 0.02, FH), (B0 / 2 - 0.06, FH + 0.08), (wm / 2 - 0.03 * go + wob, FH + 1.0), (B1 / 2 - 0.09 * go + wob, zt - 0.12),
                    (B1 * 0.22, zt), (-B1 * 0.22, zt), (-B1 / 2 + 0.06 * gi + wob, zt - 0.12), (-wm / 2 + 0.02 * gi + wob, FH + 1.0),
                    (-B0 / 2 + 0.06, FH + 0.08), (-B0 / 2 + 0.02, FH)]
            rings.append([c + n * x + V((0, 0, z)) for x, z in prof])
        bm = dz.bmesh.new()
        C.loft_bm(bm, rings)
        dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, MUD, name=name + '_mud%d' % int(t0), mat_tint=MT, smooth=True)
        q = [p0 + d * t0 + n * B0 / 2, p0 + d * t1 + n * B0 / 2, p0 + d * t1 - n * B0 / 2, p0 + d * t0 - n * B0 / 2]
        K.footprint([tuple(x)[:2] for x in q], 'HIGH', 'wall')
        for s_ in (1, -1):
            K.climb_meta(tuple(p0 + d * t0 + n * s_ * B0 / 2)[:2], tuple(p0 + d * t1 + n * s_ * B0 / 2)[:2], H + 0.3, 'wall')
        bm, bh = dz.bmesh.new(), dz.bmesh.new()
        k = int((t1 - t0) / 4.0)
        for j in range(k):
            t = t0 + (t1 - t0) * (j + 0.5) / k
            c = p0 + d * t - n * (B0 / 2 + 0.25)
            C.box_bm(bm, tuple(c + V((0, 0, (H - 0.4) / 2))), (0.6, 0.5, H - 0.4), math.atan2(d.y, d.x), taper=(0.8, 0.4))
        for j in range(int((t1 - t0) / 1.6)):
            t = t0 + 0.8 + 1.6 * j
            c = p0 + d * t + V((0, 0, FH + 0.14))
            C.cyl_bm(bh, c + n * (B0 / 2 - 0.1), c + n * (B0 / 2 + 0.12), 0.05, 6)
        if bm.verts:
            K.part(bm, MUD, name=name + '_butt%d' % int(t0), mat_tint=MT)
        K.part(bh, 'palm_log', name=name + '_weep%d' % int(t0), grime=0.4, uv='beam', axis=tuple(n))
        if wire:
            bp, bw = dz.bmesh.new(), dz.bmesh.new()
            npk = max(1, int((t1 - t0) / 2.0))
            tops = []
            for j in range(npk + 1):
                t = t0 + 0.15 + (t1 - t0 - 0.3) * j / npk
                c = p0 + d * t + n * 0.12 + V((0, 0, H - 0.05))
                lean = n * 0.2
                dz.angle_bm(bp, c, c + V((0, 0, 0.85)) + lean, 0.05, 0.007, n)
                tops.append((c, lean))
            for zz in (0.3, 0.55, 0.8):
                for (ca, la), (cb, lb) in zip(tops[:-1], tops[1:]):
                    dz.barbed_bm(bw, ca + V((0, 0, zz)) + la * zz / 0.85, cb + V((0, 0, zz)) + lb * zz / 0.85, 0.035)
            dz.bmesh.ops.recalc_face_normals(bp, faces=bp.faces)
            K.part(bp, 'cast_iron', name=name + '_pick%d' % int(t0), uv='keep', grime=0.2, mat_tint=(0.55, 0.42, 0.33), bisect=False)
            K.part(bw, 'steel_galv', name=name + '_wire%d' % int(t0), grime=0.1, mat_tint=(0.6, 0.55, 0.5), bisect=False)
        rr = K.rng()
        for j in range(max(1, int((t1 - t0) / 3.5))):
            t = t0 + rr.uniform(0.6, max(0.7, t1 - t0 - 0.6))
            z = rr.uniform(1.0, 2.0)
            dz.spall2(p0 + d * t + n * (B0 / 2 - 0.12 * (z - FH) / (H - FH) - 0.06) + V((0, 0, z)), n + V((0, 0, 0.12)), rr.uniform(0.5, 1.2), rr.uniform(0.35, 0.7),
                      'mudbrick', MUD, MT, seed=int(t * 10) + SEED, name=name + '_sp%d_%d' % (int(t0), j))
        dz.sand_drift(tuple(p0 + d * (t0 + 0.2) + n * 0.35), tuple(p0 + d * (t1 - 0.2) + n * 0.35), tuple(n), 0.3, 1.0, seed=SEED + int(t0), name=name + '_sand_o%d' % int(t0))
        dz.sand_drift(tuple(p0 + d * (t1 - 0.2) - n * 0.35), tuple(p0 + d * (t0 + 0.2) - n * 0.35), tuple(-n), 0.2, 0.7, seed=SEED + 5 + int(t0), name=name + '_sand_i%d' % int(t0))
    return d, n


def corner_tower(c, rad=1.65, h=4.3):
    """Octagonal corner bastion: stone footing, strongly battered mud body with a wobble, rounded eroded merlons with
    embrasures, splayed loopholes with a dim recess and palm-log lintels, walkable top with a hatch."""
    cx, cy = c
    oc = lambda r_, z: [(cx + r_ * math.cos(math.pi / 8 + k * math.pi / 4), cy + r_ * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    bm = dz.bmesh.new()
    C.loft_bm(bm, [[V((x, y, -0.05)) for x, y in oc(rad + 0.05, 0)], [V((x, y, FH + 0.1)) for x, y in oc(rad - 0.02, 0)]])
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'fieldstone', name='tower_foot', mat_tint=(1.0, 0.93, 0.82))
    rings = []
    for k, (z, rr_) in enumerate(((FH + 0.1, rad - 0.06), (FH + 1.4, rad - 0.16), (h - 0.8, rad - 0.3), (h, rad - 0.36))):
        rings.append([V((x + 0.03 * noise.noise(V((x, y, z))), y + 0.03 * noise.noise(V((y, x, z))), z)) for x, y in oc(rr_, z)])
    bm = dz.bmesh.new()
    C.loft_bm(bm, rings)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, MUD, name='tower_body', mat_tint=MT)
    top = oc(rad - 0.36, h)
    gaps = {}
    for k in range(8):
        a, b = V((*top[k], 0)), V((*top[(k + 1) % 8], 0))
        Le = (b - a).length
        gaps[k] = [(Le / 2 - 0.16, Le / 2 + 0.16)]
    dz.parapet(top, h, 0.6, 0.3, MUD, gaps=gaps, style='mud', climb=False, name='tower_par', mat_tint=MT)
    dz.roof_slab(C.poly_offset(C.ccw(top), -0.28), h + 0.04, 0.2, MUD, name='tower_top', tint=(1.0, 0.97, 0.93))
    K.roof_meta(C.poly_offset(C.ccw(top), -0.3), h + 0.04, walkable=True, kind='tower')
    dz.hatch((cx + 0.3, cy + 0.3), h + 0.04, 0.5, curb=MUD, tint=MT, name='tower_hatch')
    bl, bk, bj_ = dz.bmesh.new(), dz.bmesh.new(), dz.bmesh.new()
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4 + math.pi / 8
        nn = V((math.cos(a), math.sin(a), 0))
        rz = rad - 0.16 - (0.14 * (2.5 - FH - 1.4) / (h - 0.8 - FH - 1.4))
        p = V((cx, cy, 0)) + nn * (rz * math.cos(math.pi / 8)) + V((0, 0, 2.2))
        s_ = V((-nn.y, nn.x, 0))
        # slit: dim panel just proud of the battered face, framed by raised mud jambs + sill (reads as a recess)
        bk.faces.new([bk.verts.new(x) for x in (p + nn * 0.015 - s_ * 0.07, p + nn * 0.015 + s_ * 0.07, p + nn * 0.015 + s_ * 0.07 + V((0, 0, 0.75)),
                                                p + nn * 0.015 - s_ * 0.07 + V((0, 0, 0.75)))])
        for sx in (-1, 1):
            C.box_bm(bj_, tuple(p + s_ * sx * 0.14 + nn * 0.03 + V((0, 0, 0.38))), (0.14, 0.12, 0.85), math.atan2(s_.y, s_.x))
        C.box_bm(bj_, tuple(p + nn * 0.04 - V((0, 0, 0.05))), (0.42, 0.14, 0.1), math.atan2(s_.y, s_.x))
        C.cyl_bm(bl, p + nn * 0.05 - s_ * 0.35 + V((0, 0, 0.85)), p + nn * 0.05 + s_ * 0.35 + V((0, 0, 0.85)), 0.06, 6)
    for f in bk.faces:
        f.normal_update()
    K.part(bk, MUD, name='loopholes', mat_tint=(0.4, 0.34, 0.28), grime=0.3, bisect=False)
    K.part(bj_, MUD, name='loop_jambs', mat_tint=MT)
    K.part(bl, 'palm_log', name='loop_lintels', uv='beam', axis=(1, 0, 0), grime=0.5)
    K.footprint(oc(rad + 0.05, 0), 'HIGH', 'tower')
    o8 = oc(rad, 0)
    for i in range(8):
        K.climb_meta(o8[i], o8[(i + 1) % 8], h + 0.6, 'tower')
    for k in range(3):
        a = math.pi / 8 + (k * 3 + 5) * math.pi / 4
        nn = V((math.cos(a), math.sin(a), 0))
        dz.spall2(V((cx, cy, 0)) + nn * (rad - 0.18) + V((0, 0, 1.3 + 0.6 * k)), nn + V((0, 0, 0.15)), 0.6, 0.45, 'mudbrick', MUD, MT, seed=SEED + k, name='tsp%d' % k)


def broken_end(p, d, n, side, seed=0, name='bend'):
    """Ragged broken wall end: mud-brick courses (0.12 m) receding in steps, bricks visible in section."""
    rr = K.rng()
    bm = dz.bmesh.new()
    z = FH
    rec = 0.0
    while z < H - 0.1:
        rec += rr.uniform(-0.05, 0.22)
        rec = max(0.0, rec)
        w = B0 - (B0 - B1) * (z - FH) / (H - FH) - 0.06
        nb = int(w / 0.2)
        for j in range(nb):
            y = -w / 2 + (j + 0.5) * w / nb
            L_ = rr.uniform(0.25, 0.4)
            c = p + d * side * (rec + L_ / 2) + n * y + V((0, 0, z + 0.06))
            dz.chunk_bm(bm, c, (L_, w / nb - 0.02, 0.11), (rr.uniform(-0.05, 0.05), rr.uniform(-0.05, 0.05), math.atan2(d.y, d.x)), seed + j, 0.25)
        z += 0.12
    K.part(bm, 'mudbrick', name=name, mat_tint=(1.0, 0.95, 0.9), bisect=False)


def decals_run(x0, x1, y_out, y_in):
    rr = K.rng()
    for j in range(2):
        x = rr.uniform(x0 + 0.8, x1 - 0.8)
        K.decal(rr.choice(['crack', 'efflorescence', 'crack']), (x, y_out - 0.005, rr.uniform(1.2, 2.2)), (0, -1, 0), rr.uniform(0.5, 1.0),
                rr.uniform(0.7, 1.3), alpha=0.3)



if VAR == 'seg':
    wall_run((-L / 2, 0), (L / 2, 0), name='wall')
    decals_run(-L / 2, L / 2, -B0 / 2, B0 / 2)
elif VAR == 'breach':
    G0, G1 = 2.1, 5.7                      # gap along the run (x = -1.9 .. 1.7)
    wall_run((-L / 2, 0), (L / 2, 0), gaps=[(G0, G1)], name='wall', wire=True)
    d, n = V((1, 0, 0)), V((0, -1, 0))
    broken_end(V((-L / 2 + G0, 0, 0)), d, n, -1, SEED, 'bend_w')
    broken_end(V((-L / 2 + G1, 0, 0)), d, n, 1, SEED + 9, 'bend_e')
    bm = dz.bmesh.new()                     # stump: surviving footing with a ragged top in the gap
    rings = []
    for i in range(9):
        x = -L / 2 + G0 + (G1 - G0) * i / 8
        z1 = 0.2 + 0.35 * abs(noise.noise(V((x * 1.7, SEED, 0.4))))
        rings.append([V((x, y, z)) for y, z in ((B0 / 2 + 0.05, -0.05), (-B0 / 2 - 0.05, -0.05), (-B0 / 2 + 0.02, z1), (B0 / 2 - 0.02, z1 * 0.8))])
    C.loft_bm(bm, rings)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'fieldstone', name='stump', mat_tint=(1.0, 0.93, 0.82))
    dz.rubble_mud((-0.1, -1.1, 0), 2.0, 1.1, 0.7, seed=SEED, bricks=34, logs=0, reeds=0, name='rub_o', slump=(0.0, -0.4))
    dz.rubble_mud((0.0, 0.9, 0), 1.7, 0.9, 0.55, seed=SEED + 4, bricks=22, logs=0, reeds=0, name='rub_i')
    bm = dz.bmesh.new()                     # fieldstones knocked out of the footing
    rr = K.rng()
    for k in range(12):
        dz.chunk_bm(bm, (rr.uniform(-1.8, 1.6), rr.uniform(-1.6, 1.4), 0.12), (rr.uniform(0.2, 0.35), rr.uniform(0.15, 0.28), rr.uniform(0.12, 0.2)),
                    (rr.uniform(-0.4, 0.4), rr.uniform(-0.4, 0.4), rr.uniform(0, 3)), k, 0.35)
    K.part(bm, 'fieldstone', name='stones', mat_tint=(1.0, 0.93, 0.82))
    bm = dz.bmesh.new()                     # cut barbed wire: strands droop from the last pickets onto the rubble
    for side, x in ((-1, -L / 2 + G0 - 0.15), (1, -L / 2 + G1 + 0.15)):
        for k, zz in enumerate((0.3, 0.55, 0.8)):
            a = V((x, -0.12 - 0.2 * zz / 0.85, H - 0.05 + zz))
            g = V((x - side * rr.uniform(0.6, 1.6), rr.uniform(-1.6, 0.6), 0.5 * rr.random()))
            dz.hang_wire_bm(bm, a, g, 0.5)
    K.part(bm, 'steel_galv', name='cut_wire', grime=0.1, mat_tint=(0.6, 0.55, 0.5), bisect=False)
    K.decal('soot', (-0.1, -B0 / 2 - 0.3, 0.03), (0, 0, 1), 4.0, 3.0, up=(1, 0, 0), alpha=0.5)
    decals_run(-L / 2, -L / 2 + G0, -B0 / 2, B0 / 2)
    C.A.meta['footprints'] = [f for f in C.A.meta['footprints'] if f['kind'] != 'rubble']
    K.footprint_rect(-L / 2 + (G0 + G1) / 2, 0, G1 - G0, 3.0, 0, 'LOW', 'rubble')
    C.A.meta['notes'].append('destroyed variant of wall_octagon_seg: gap x -1.9..1.7 is passable (LOW rubble); cut wire hangs, no wire over the gap')
elif VAR == 'gate':
    GW = 3.2
    wall_run((-L / 2, 0), (L / 2, 0), gaps=[(L / 2 - GW / 2 - 0.7, L / 2 + GW / 2 + 0.7)], name='wall')
    for s_ in (-1, 1):                      # masonry piers: stone base, mud-rendered shaft, lime band, stepped cap, dome
        x = s_ * (GW / 2 + 0.35)
        bm = dz.bmesh.new()
        C.box_bm(bm, (x, 0, 0.45), (0.95, 1.1, 0.95))
        K.part(bm, 'fieldstone', name='pier_base%d' % s_, mat_tint=(1.0, 0.93, 0.82))
        bm = dz.bmesh.new()
        C.box_bm(bm, (x, 0, 0.9 + 1.1), (0.8, 0.95, 2.2), taper=(0.92, 0.92))
        C.box_bm(bm, (x, 0, 3.17), (0.92, 1.05, 0.14))
        K.part(bm, MUD, name='pier%d' % s_, mat_tint=MT)
        bm = dz.bmesh.new()
        C.box_bm(bm, (x, 0, 2.85), (0.76, 0.91, 0.22))
        K.part(bm, 'limewash_worn', name='pier_band%d' % s_, mat_tint=(0.92, 0.9, 0.85))
        dz.dome((x, 0), 0.33, 3.24, MUD, drum_h=0.08, segs=10, rings=3, finial=False, name='pier_cap%d' % s_, tint=MT)
        K.footprint_rect(x, 0, 0.95, 1.1, 0, 'HIGH', 'pier')
        dz.spall2((x + 0.1 * s_, -0.48, 1.6), (0, -1, 0), 0.4, 0.5, 'mudbrick', MUD, MT, seed=SEED + s_, name='psp%d' % s_)
    OPEN = SEED % 2 == 0
    for s_ in (-1, 1):                      # leaves: galvanised tube frame + barbed-wire mesh, strap hinges, latch
        hp = V((s_ * (GW / 2 - 0.05), -0.1, 0.1))
        bm, bw, bi = dz.bmesh.new(), dz.bmesh.new(), dz.bmesh.new()
        lw = GW / 2 - 0.1
        ang = math.radians(100 if OPEN else 0) * (-s_)
        R = dz.Matrix.Rotation(ang, 3, 'Z')
        P = lambda x, z: hp + R @ V((-s_ * x, 0, z))
        for (xa, za, xb, zb) in ((0, 0, lw, 0), (0, 2.1, lw, 2.1), (0, 0, 0, 2.1), (lw, 0, lw, 2.1), (0, 0, lw, 2.1), (0, 1.05, lw, 1.05)):
            C.cyl_bm(bm, P(xa, za), P(xb, zb), 0.03, 6)
        for z in (0.35, 0.7, 1.4, 1.75):
            dz.barbed_bm(bw, P(0.03, z), P(lw - 0.03, z), 0.02)
        for xx in (0.45, 0.9, 1.3):
            dz.barbed_bm(bw, P(xx, 0.05), P(xx, 2.05), 0.0, spacing=0.3, n=3)
        for z in (0.35, 1.8):              # strap hinges on the leaf + pintles in the pier
            C.box_bm(bi, tuple(P(0.3, z) + V((0, -0.035, 0))), (0.6, 0.012, 0.06), ang)
            C.cyl_bm(bi, hp + V((0, 0, z - 0.1)), hp + V((0, 0, z + 0.1)), 0.02, 6)
            C.box_bm(bi, tuple(hp + V((s_ * 0.12, 0.02, z))), (0.25, 0.05, 0.05))
        if not OPEN and s_ > 0:            # latch bar + chain + padlock at the meeting stiles
            C.box_bm(bi, tuple(P(lw, 1.1) + V((-0.12, -0.05, 0))), (0.3, 0.02, 0.04))
            C.box_bm(bi, tuple(P(lw, 1.02) + V((-0.02, -0.07, 0))), (0.06, 0.03, 0.08))
        for b_, mid, nm in ((bm, 'steel_galv', 'frame'), (bw, 'steel_galv', 'wire'), (bi, 'cast_iron', 'iron')):
            ob = K.part(b_, mid, name='gate_%s%d' % (nm, s_), node='door_gate%d' % s_, grime=0.2, bisect=False,
                        mat_tint=(0.7, 0.68, 0.64) if nm != 'iron' else (0.35, 0.3, 0.27))
            ob['kit_pivot'] = list(hp)
    C.door_meta('gate', (0, 0, 0), (0, -1, 0), GW, 2.2, kind='gate', node='door_gate')
    K.sign((GW / 2 + 0.35, -0.55, 1.9), (0, -1, 0), 0.6, 'halt_sperrgebiet', board='timber_grey')
    K.anchor('gate', (0, 0, 0), (0, -1, 0), open=OPEN)
    for xr in (-0.75, 0.75):                # wheel ruts + worn ground through the gateway
        K.decal('dirt_splash', (xr, -1.5, 0.02), (0, 0, 1), 0.45, 5.0, up=(0, 1, 0), alpha=0.55)
        K.decal('stain_blotch', (xr, 1.5, 0.021), (0, 0, 1), 0.4, 4.0, up=(0, 1, 0), alpha=0.4)
    dz.patch_quad([(-GW / 2 + 0.1, -2.6, 0), (GW / 2 - 0.1, -2.6, 0), (GW / 2 - 0.1, 2.6, 0), (-GW / 2 + 0.1, 2.6, 0)], 'mud', 'worn', tint=(0.95, 0.85, 0.72), lift=0.012)
    decals_run(-L / 2, -GW / 2 - 0.8, -B0 / 2, B0 / 2)
    decals_run(GW / 2 + 0.8, L / 2, -B0 / 2, B0 / 2)
else:   # corner
    corner_tower((0, 0))
    wall_run((-4.0, 0), (-1.2, 0), name='wall_w', seed=1)
    d2 = V((math.cos(math.radians(45)), math.sin(math.radians(45)), 0))
    wall_run(tuple((d2 * 1.2)[:2]), tuple((d2 * 4.0)[:2]), name='wall_ne', seed=2)
    C.A.meta['notes'].append('corner: pivot deliberately at the wall joint (not bbox centre) for snapping; walls leave along -X and along +45 deg (interior angle 135 deg); segment ends at 4 m')
    K.anchor('joint', (0, 0, 0), (0, -1, 0), snap=['-x', '+45deg'])
dz.finalize(OUT, ao_res=1024, ao_samples=48, recenter=VAR != 'corner')
