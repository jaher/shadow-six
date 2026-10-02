"""Vertical tanks (docs/fuel-tanks.md §5.4): oil_tank_column / _b (M11 desert process columns, circle r 1.75 h 7) and
fuel_tank_vertical_t (temperate squat vertical tank for round `fueltank` footprints such as the sandbox depot, r 2).
Riveted shell with hoop bands + staggered vertical seams on a round concrete plinth, torispherical dome (column) or
cone roof (squat), gooseneck vent arching over the rim down to a valve box, side manhole flange (16 bolts), nozzle
stub + red-handwheel gate valve, level gauge board; _b / squat: rung ladder + crown platform with rail.
destroyed: roof blown clean off (gone: the plinth fills the footprint), torn rim, shell split and peeled outward over its upper half, gooseneck torn, pipes charred,
plinth intact, soot rising from the base."""
import math, random
import ft
from ft import K, C, V, bmn, P, PAL

TYPES = {
    'oil_tank_column': dict(R=1.5, z0=0.35, z1=5.75, roof='dome', rh=0.95, pr=1.75, th='desert', col='ivory', ladder=False, nz=0.0),
    'oil_tank_column_b': dict(R=1.5, z0=0.35, z1=5.75, roof='dome', rh=0.95, pr=1.75, th='desert', col='ivory', ladder=True, nz=2.2),
    'fuel_tank_vertical_t': dict(R=1.8, z0=0.3, z1=3.35, roof='cone', rh=0.45, pr=2.0, th='temperate', col='fieldgrey', ladder=True, nz=0.8),
}


def profile(t):
    """Lathe rings (h, r) from the plinth top: floor, wall, roof."""
    R, z0, z1, rh = t['R'], t['z0'], t['z1'], t['rh']
    ring = [(z0, 0.0), (z0, R), (z1, R)]
    if t['roof'] == 'dome':
        for i in range(1, 7):
            a = i / 6 * math.pi / 2
            ring.append((z1 + rh * math.sin(a), R * math.cos(a) + (0.12 if i == 6 else 0) * 0))
        ring[-1] = (z1 + rh, 0.0)
    else:
        ring += [(z1 + 0.03, R + 0.04), (z1 + rh, 0.25), (z1 + rh + 0.02, 0.0)]
    return ring


def build(out, asset, dest, seed):
    t = TYPES[asset]
    R, z0, z1, rh, pr = t['R'], t['z0'], t['z1'], t['rh'], t['pr']
    K.begin(asset + ('_destroyed' if dest else ''), seed, theater=t['th'])
    r = random.Random(seed)
    paint = PAL[t['col']] if not dest else ft.BURNT
    smat = 'paint_metal' if not dest else ft.BURNT_MAT
    up = V((0, 0, 1))
    pl = bmn()                                            # plinth with chamfer
    ft.stack_bm(pl, (0, 0, 0), up, [(0, pr), (z0 - 0.06, pr), (z0, pr - 0.06), (z0, 0.0)], 32)
    P(pl, 'concrete_slab', 'plinth', mat_tint=(0.86, 0.82, 0.74), grime=0.9)
    shell, seams, fit, bolts, pipe, wheel = bmn(), bmn(), bmn(), bmn(), bmn(), bmn()
    prof = profile(t)
    wedge = (-2.2, -1.1) if dest else None                  # split wedge (angles) above zsplit
    zsplit = (z0 + z1) / 2
    ft.stack_bm(shell, (0, 0, 0), up, prof if not dest else prof[:3], 32)
    if dest:
        top_cap = [f for f in shell.faces if len(f.verts) > 4 and f.calc_center_median().z > z1 - 0.01]
        ft.bmesh.ops.delete(shell, geom=top_cap, context='FACES_ONLY')   # open top
        for v in shell.verts:                              # ragged top rim (the roof tore off along it)
            if abs(v.co.z - z1) < 1e-4:
                v.co.z -= 0.08 + 0.45 * abs(math.sin(math.atan2(v.co.y, v.co.x) * 3.0 + seed)) * r.uniform(0.4, 1.0)
        kill = []
        shell.faces.ensure_lookup_table()
        for f in shell.faces:
            c = f.calc_center_median()
            a = math.atan2(c.y, c.x)
            if c.z > zsplit + r.uniform(-0.3, 0.3) and wedge[0] < a < wedge[1] and math.hypot(c.x, c.y) > R * 0.9:
                kill.append(f)
        ft.bmesh.ops.delete(shell, geom=kill, context='FACES')
        pet = bmn()
        for a, d in ((wedge[0], 1), (wedge[1], -1)):      # the two torn edges peel outward, away from the split
            rows = []
            for j in range(4):
                z = zsplit + (z1 - zsplit) * j / 3
                out_ = 0.1 + 0.3 * (j / 3) ** 1.5
                aa = a + d * 0.2 * (j / 3)
                rows.append([V((math.cos(aa) * (R + out_), math.sin(aa) * (R + out_), z)),
                             V((math.cos(aa + d * 0.3) * (R + out_ * 0.4), math.sin(aa + d * 0.3) * (R + out_ * 0.4), z))])
            ft.two_sided(pet, rows)
        P(pet, ft.BURNT_MAT, 'petals', mat_tint=ft.BURNT_RUST)
        P(ft.inner_skin(shell), ft.BURNT_MAT, 'shell_inside', mat_tint=ft.BURNT_RUST)
        # the roof is gone (blown clear of the plinth, which fills the whole footprint): open, torn top
    nb = max(1, int((z1 - z0) / 1.2))
    vax = ft.Ax((0, 0, (z0 + z1) / 2), (0, 0, 1))
    for k in range(1, nb + 1):
        z = z0 + (z1 - z0) * k / (nb + 1)
        ft.band_bm(seams, vax, z - (z0 + z1) / 2, R, w=0.06, proud=0.012, segs=32)
    for k in range(6):
        a = k * math.pi / 3 + (0.3 if k % 2 else 0)
        za, zb = z0 + 0.05, (z1 - 0.05) if not dest or not (wedge[0] < a < wedge[1]) else zsplit
        ft.long_seam_bm(seams, vax, za - (z0 + z1) / 2, zb - (z0 + z1) / 2, R, a)
    P(shell, smat, 'shell', smooth=True, mat_tint=paint, grime=0.7, lod='keep')
    P(seams, smat, 'seams', mat_tint=tuple(c * 0.92 for c in paint), grime=0.6)
    S = ft.NS(t=t, R=R, z0=z0, z1=z1, rh=rh, pr=pr, r=r, dest=dest, seed=seed, paint=paint, smat=smat, asset=asset)
    fittings(S, fit, bolts, pipe, wheel)
    weather(S)
    K.footprint([(math.cos(a) * pr, math.sin(a) * pr) for a in [k * math.pi / 8 for k in range(16)]], 'HIGH', 'tank')
    K.anchor('blast_origin', (0, 0, (z0 + z1) / 2), (0, -1, 0), radius=4.0, size=[2 * R, 2 * R, z1 + rh])
    if not dest:
        K.anchor('explosive_target', (0, -pr - 0.2, 0.9), (0, -1, 0), kind='fuel_tank', chain_radius=7.0)
    else:
        for k in range(2):
            K.anchor('fire', (0.3 * k, -0.2, z0 + 0.6 + k * 1.5), (0, -1, 0), size=2.0)
    ov = [(('petals',), ('shell', 'shell_inside', 'plinth', 'pipework', 'ladder', 'rail', 'platform', 'gauge_board', 'seams', 'fittings'))] if dest else []
    return ft.finalize(out, t['th'], bounds=(2 * pr, 2 * pr, z1 + rh + 0.4, pr), overlaps=ov)


def rad(a, r_, z):
    return V((math.cos(a) * r_, math.sin(a) * r_, z))


def fittings(S, fit, bolts, pipe, wheel):
    R, z0, z1, rh, pr, t, dest = S.R, S.z0, S.z1, S.rh, S.pr, S.t, S.dest
    top = z1 + rh
    ag = -0.75                                            # gooseneck down the SE side (seen from the game camera)
    rv = R + 0.16
    if not dest:
        pts = [V((0, 0, top - 0.05)), V((0, 0, top + 0.12))]
        for i in range(1, 7):                             # arc over the rim
            f = i / 6
            pts.append(rad(ag, rv * f, top + 0.12 + 0.1 * math.sin(f * math.pi) - (top - z1 + 0.1) * f ** 3))
        pts.append(rad(ag, rv, z0 + 0.45))
        for a_, b_ in zip(pts[:-1], pts[1:]):
            C.cyl_bm(pipe, a_, b_, 0.075, 8)
    else:                                                 # torn stub hanging from the rim
        C.cyl_bm(pipe, rad(ag, rv, z0 + 0.45), rad(ag, rv, z1 - 0.6), 0.075, 8)
        C.cyl_bm(pipe, rad(ag, rv, z1 - 0.6), rad(ag + 0.15, rv + 0.22, z1 - 1.5), 0.075, 8)
    C.box_bm(pipe, tuple(rad(ag, rv, z0 + 0.22)), (0.4, 0.4, 0.44), ag)
    for k in range(3):                                    # brackets tying the down-pipe to the shell
        z = z0 + 0.9 + k * (z1 - z0 - 1.2) / 2
        C.beam_bm(pipe, rad(ag, R + 0.005, z), rad(ag, rv, z), 0.05, 0.05)
    am = -2.0
    ft.manhole(fit, bolts, rad(am, R, z0 + 0.9), rad(am, 1, 0), r=0.3, neck=0.12, nb=16)
    an = t['nz'] if t['nz'] else 0.35
    b0 = rad(an, R - 0.02, z0 + 1.1)
    b1 = rad(an, R + 0.42, z0 + 1.1)
    C.cyl_bm(pipe, b0, b1, 0.1, 10)
    C.cyl_bm(pipe, b1, rad(an, R + 0.48, z0 + 1.1), 0.17, 12)
    ft.gate_valve(pipe, wheel, rad(an, R + 0.27, z0 + 1.1), rad(an, 1, 0), r_pipe=0.1)
    gb = bmn()                                            # level gauge board (camera side)
    ag2 = -0.3
    c = rad(ag2, R + 0.1, (z0 + z1) / 2)
    C.box_bm(gb, tuple(c), (0.28, 0.05, z1 - z0 - 0.6), ag2 + math.pi / 2)
    C.box_bm(wheel, tuple(rad(ag2, R + 0.14, z0 + (z1 - z0) * 0.62)), (0.16, 0.04, 0.06), ag2 + math.pi / 2)
    P(gb, 'paint_metal' if not dest else ft.BURNT_MAT, 'gauge_board', mat_tint=(0.9, 0.88, 0.8) if not dest else ft.BURNT)
    if t['ladder'] and dest:                              # platform blown away; the ladder ends torn at the split
        ld = bmn()
        al = -2.55
        lr = R + 0.18 if pr > R + 0.3 else pr + 0.08
        zl = z0 if lr < pr else 0.0
        ft.ladder(ld, rad(al, lr, zl), (z0 + z1) / 2, rad(al, 1, 0), w=0.42, over=0.0)
        P(ld, 'steel_galv', 'ladder', mat_tint=(0.2, 0.18, 0.17))
    elif t['ladder']:
        ld, rail, plat = bmn(), bmn(), bmn()
        al = -2.55
        lr = R + 0.18 if pr > R + 0.3 else pr + 0.08
        zl = z0 if lr < pr else 0.0
        ft.ladder(ld, rad(al, lr, zl), z1 + 0.15, rad(al, 1, 0), w=0.42, over=0.0)
        for k in range(3):
            z = zl + 1.0 + k * (z1 - zl - 1.2) / 2
            for s in (-0.2, 0.2):
                C.beam_bm(ld, rad(al + s / R, R, z), rad(al + s / R, lr, z), 0.04, 0.04)
        # crown platform: a small grating landing at the rim with a rail
        zc = z1 + 0.15 if t['roof'] == 'cone' else z1 + 0.35
        for i in range(5):
            a0, a1 = al - 0.45 + i * 0.18, al - 0.45 + (i + 1) * 0.18
            q = [rad(a0, R * 0.62, zc), rad(a1, R * 0.62, zc), rad(a1, lr, zc), rad(a0, lr, zc)]
            ft.bmesh.ops.contextual_create(plat, geom=[plat.verts.new(p) for p in q])
        ft.railing(rail, [tuple(rad(al - 0.45 + i * 0.3, lr, 0))[:2] for i in range(4)], zc, h=min(1.0, z1 + rh + 0.25 - zc), step=0.6, r=0.022)
        P(ld, 'steel_galv', 'ladder', mat_tint=(0.5, 0.5, 0.48) if not dest else (0.2, 0.18, 0.17))
        P(rail, 'steel_galv', 'rail', mat_tint=(0.5, 0.5, 0.48) if not dest else (0.2, 0.18, 0.17))
        P(plat, 'fuel_grating', 'platform', grime=0.2)
        K.ladder_meta(tuple(rad(al, lr + 0.6, 0)), tuple(rad(al, R * 0.8, zc)), zc)
    P(fit, S.smat, 'fittings', smooth=True, mat_tint=tuple(c * 0.9 for c in S.paint), grime=0.7)
    P(bolts, 'cast_iron', 'bolts')
    if not dest:
        P(pipe, 'paint_metal', 'pipework', smooth=True, mat_tint=(0.75, 0.74, 0.7) if t['col'] == 'ivory' else PAL['blackgrey'], grime=0.6)
        P(wheel, 'paint_metal', 'valves', mat_tint=PAL['red'])
    else:                                                 # charred: blistered paint, soot
        P(pipe, ft.BURNT_MAT, 'pipework', smooth=True, mat_tint=ft.BURNT, grime=0.8)
        P(wheel, ft.BURNT_MAT, 'valves', mat_tint=ft.BURNT_RUST)
    K.anchor('spout', tuple(rad(an, R + 0.5, z0 + 1.1)), tuple(rad(an, 1, 0)))


def weather(S):
    R, z0, z1, r = S.R, S.z0, S.z1, S.r
    vax = ft.Ax((0, 0, (z0 + z1) / 2), (0, 0, 1))
    if not S.dest:
        word = 'oel_1' if S.asset != 'fuel_tank_vertical_t' else 'kraftstoff'
        ft.stencil(word, vax, R, 0.6, -1.5, 0.42 if word == 'oel_1' else 0.34, mode='around')
    zc = (z0 + z1) / 2
    for k in range(8):                                   # grime / oil runs from the roof edge down
        ft.wrap_decal('streak_long' if k % 2 else 'streak_rain', vax, R, z1 - 0.9 - zc, r.uniform(-math.pi, math.pi), 1.6, 0.5, alpha=0.5, vert=True)
    for k in range(5):
        ft.wrap_decal('damp_rise' if not S.dest else 'soot_a', vax, R, z0 + 0.5 - zc, r.uniform(-math.pi, math.pi), 1.0, 1.1, alpha=0.6, vert=True)
    if S.dest:
        ft.scorch((0, 0, 0), 2 * S.pr + 2.0, 2 * S.pr + 2.0, seed=S.seed, z=0.01)
        ft.scorch((0, 0, 0), 2 * S.pr - 0.2, 2 * S.pr - 0.2, seed=S.seed + 1, z=S.z0 + 0.006, alpha=0.6)
    elif S.t['th'] == 'desert':
        ft.dz.sand_drift(tuple(rad(1.9, S.pr - 0.1, 0))[:2], tuple(rad(3.2, S.pr - 0.1, 0))[:2], tuple(rad(2.55, 1, 0))[:2], 0.22, 0.3, seed=S.seed)
