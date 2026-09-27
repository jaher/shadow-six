"""Old windmill (M17 'old mill' landmark; Normandy / Flanders / Picardy):
 a = stone tower mill: tapered rubble tower with dressed door + window surrounds, timber reefing stage on brackets,
     ogee boat cap in shingles, tail pole with chain wheel, inclined windshaft, 4 common sails (lattice of sail bars
     and hemlocks, two sails with furled canvas) as a separate rotating node 'sails'
 b = Flemish post mill: brick roundhouse with conical roof, weatherboarded buck on the post, curved roof, rear
     ladder-stair + tail pole, same sails
 '-ruin' (a-ruin / b-ruin): shell-damaged - sails broken, cap holed, scorched (destroyed variant)
usage: blender -b --python mill_old.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, DOOR, finish, scorch_openings
import eu_dmg

OUT, VAR, SEED = args('mill_old_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('mill_old_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
SEG = 20


def ring(c, rad, z, n=SEG, a0=0.0):
    return [V((c[0] + math.cos(a0 + 2 * math.pi * k / n) * rad, c[1] + math.sin(a0 + 2 * math.pi * k / n) * rad, z)) for k in range(n)]


def lathe(mid, prof, name, c=(0, 0), n=SEG, **kw):
    """Surface of revolution from a (radius, z) profile (bottom -> top)."""
    bm = bmesh.new()
    rings = [ring(c, max(rad, 0.005), z, n) for rad, z in prof]
    K.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, **kw)


if base == 'a':
    R0, R1, H = 3.4, 2.5, 11.0                     # tower base / top radius, height
    tower = lathe('fieldstone', [(R0 + 0.12, 0), (R0 + 0.12, 0.6), (R0, 0.6), (R1, H)], 'tower')
    rad_at = lambda z: R0 + (R1 - R0) * z / H
    # openings: door S, windows spiralling up; cut real recesses into the solid tower
    frames = []
    for (ang, z, w, h, kind) in ((-90, 0.1, 1.2, 2.3, 'door'), (90, 0.1, 1.1, 2.2, 'door'), (-40, 2.6, 0.8, 1.1, 'window'),
                                 (-140, 5.0, 0.8, 1.1, 'window'), (-90, 7.4, 0.8, 1.1, 'window'), (30, 5.0, 0.7, 1.0, 'window'),
                                 (150, 7.9, 0.7, 1.0, 'window'), (-90, 4.3, 1.0, 2.0, 'door_stage')):
        a = math.radians(ang)
        n = V((math.cos(a), math.sin(a), 0))
        rr = V((-n.y, n.x, 0))
        o = n * (rad_at(z) + 0.02) + V((0, 0, z))
        f = K.Frame(o, n, rr, w, h, 0.6, 'segment', 'door' if kind != 'window' else 'window')
        frames.append((f, kind))
    import kit_arch as KA
    KA.cut_object(tower, KA._cutter_bm([f for f, k in frames]))
    for f, kind in frames:
        if kind == 'window':
            K.window(f, 'casement', (1, 2), frame=(0.6, 0.58, 0.52), sill='ashlar_limestone', lintel='ashlar_limestone', curtain=0.0,
                     name='mw', recess=0.2, streak=RUIN)   # rework3: sill streaks read as soot on the intact tower
        else:
            K.door(f, 'mill_%s' % ('s' if f.n.y < 0 and kind == 'door' else ('stage' if kind == 'door_stage' else 'n')),
                   'plank', (0.33, 0.27, 0.2), step='ashlar_limestone' if f.o.z < 1 else None, lintel='ashlar_limestone')
    K.footprint([(p.x, p.y) for p in ring((0, 0), R0 + 0.15, 0, 12)], 'HIGH', 'mill')
    # reefing stage at z=4.3: ring deck on brackets with a railing
    ZS = 4.3
    rs0, rs1 = rad_at(ZS) - 0.05, rad_at(ZS) + 1.4
    bm = bmesh.new()
    K.loft_bm(bm, [ring((0, 0), rs0, ZS - 0.12, 24), ring((0, 0), rs1, ZS - 0.12, 24), ring((0, 0), rs1, ZS, 24), ring((0, 0), rs0, ZS, 24)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'deck_planks', name='stage_deck', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    for k in range(12):
        a = 2 * math.pi * k / 12
        d = V((math.cos(a), math.sin(a), 0))
        K.beam_bm(bm, d * rad_at(ZS - 1.4) + V((0, 0, ZS - 1.4)), d * (rs1 - 0.1) + V((0, 0, ZS - 0.15)), 0.12, 0.12)
        K.beam_bm(bm, d * rad_at(ZS) + V((0, 0, ZS - 0.2)), d * (rs1 - 0.05) + V((0, 0, ZS - 0.2)), 0.1, 0.16)
        K.beam_bm(bm, d * (rs1 - 0.06) + V((0, 0, ZS)), d * (rs1 - 0.06) + V((0, 0, ZS + 1.0)), 0.07, 0.07)
    pr = ring((0, 0), rs1 - 0.06, ZS + 1.0, 24)
    for a_, b_ in zip(pr, pr[1:] + pr[:1]):
        K.beam_bm(bm, a_, b_, 0.07, 0.06)
        K.beam_bm(bm, a_ - V((0, 0, 0.5)), b_ - V((0, 0, 0.5)), 0.05, 0.04)
    K.part(bm, 'timber_grey', name='stage_frame', uv='beam', axis=(0, 0, 1))
    K.roof_meta([(p.x, p.y) for p in ring((0, 0), rs1, 0, 12)], ZS, walkable=True, kind='stage')
    # curb + ogee cap
    ZC = H
    lathe('timber_tarred', [(R1 + 0.25, ZC - 0.05), (R1 + 0.25, ZC + 0.35)], 'curb')
    CAPP = [(R1 + 0.35, ZC + 0.3), (R1 + 0.32, ZC + 0.9), (R1 * 0.92, ZC + 1.6), (R1 * 0.7, ZC + 2.25), (R1 * 0.42, ZC + 2.75),
            (R1 * 0.22, ZC + 3.2), (0.12, ZC + 3.7), (0.1, ZC + 3.95)]                       # ogee boat-cap section
    cap = lathe('timber_siding', CAPP, 'cap', n=24, uv='beam', axis=(0, 0, 1), mat_tint=(0.62, 0.5, 0.38))   # vertical boarding
    bm = bmesh.new()                                     # cap ribs (tarred battens over the board joints)
    for k in range(12):
        a0 = 2 * math.pi * k / 12
        pts = [V((math.cos(a0) * (rad + 0.03), math.sin(a0) * (rad + 0.03), z)) for rad, z in CAPP[:-1]]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            K.beam_bm(bm, p0, p1, 0.07, 0.05)
    K.part(bm, 'timber_tarred', name='cap_ribs', uv='beam', axis=(0, 0, 1))
    bm = bmesh.new()                                     # cap gallery: walkway + balusters around the curb
    gp = ring((0, 0), R1 + 0.75, ZC + 0.25, 20)
    K.loft_bm(bm, [ring((0, 0), R1 + 0.3, ZC + 0.2, 20), ring((0, 0), R1 + 0.8, ZC + 0.2, 20), ring((0, 0), R1 + 0.8, ZC + 0.28, 20), ring((0, 0), R1 + 0.3, ZC + 0.28, 20)])
    for a_, b_ in zip(gp, gp[1:] + gp[:1]):
        K.beam_bm(bm, a_ + V((0, 0, 0.75)), b_ + V((0, 0, 0.75)), 0.05, 0.05)
        K.beam_bm(bm, a_, a_ + V((0, 0, 0.75)), 0.05, 0.05)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'timber_grey', name='cap_gallery', uv='beam', axis=(0, 0, 1), tint=(0.8, 0.75, 0.68))
    K.P('cast_iron', K.cyl_bm, (0, 0, ZC + 3.85), (0, 0, ZC + 4.3), 0.12, 8, r1=0.02, name='finial')
    hub = V((0, -(R1 + 1.0), ZC + 1.35))
    shaft_top = V((0, R1 * 0.2, ZC + 1.55))
    # tail pole with chain wheel down to the ground at the back (north)
    bm = bmesh.new()
    tp0 = V((0, R1 + 0.2, ZC + 0.6)); tp1 = V((0, R0 + 5.5, 1.1))
    K.beam_bm(bm, tp0, tp1, 0.22, 0.22)
    for s in (-1, 1):
        K.beam_bm(bm, V((s * 1.2, R1 + 0.2, ZC + 0.3)), tp0.lerp(tp1, 0.45), 0.14, 0.14)
    K.cyl_bm(bm, tp1 + V((-0.1, 0.1, -0.4)), tp1 + V((0.1, 0.1, -0.4)), 0.55, 12)
    K.part(bm, 'timber_tarred', name='tailpole', uv='beam', axis=(0, 1, 0))
    K.footprint_rect(0, R0 + 5.4, 1.2, 1.2, block='LOW', kind='tailpole')
else:
    # --- Flemish post mill: brick roundhouse + weatherboarded buck ------------------------------------------------------------
    RR, HR = 3.1, 2.0
    rpoly = [(p.x, p.y) for p in ring((0, 0), RR, 0, 16)]
    rh = [K.opening(rpoly, 12, 0.97, 1.0, 2.0, 0.1, 0.4, 'segment', 'door')]
    rwin = [K.opening(rpoly, e_, 0.6, 0.5, 0.6, 1.0, 0.4, 'segment') for e_ in (0, 5, 9)]      # rework3: small lights
    K.wall_ring(rpoly, HR, 0.4, 'brick_red', rh + rwin, plinth=('ashlar', 0.4, 0.05), name='roundhouse')
    K.door(rh[0], 'roundhouse', 'plank', (0.35, 0.3, 0.24), step='ashlar', lintel='brick_dark')
    for k_, f in enumerate(rwin):
        K.window(f, 'fixed', (1, 2), frame=(0.8, 0.78, 0.72), sill='ashlar_limestone', lintel=None, curtain=0.0, name='rw%d' % k_, streak=False)
    K.cornice(rpoly, HR - 0.32, 'brick_dark', steps=((0.05, 0.08), (0.1, 0.08), (0.14, 0.08)), name='rh_corbel')
    # rework3: the roundhouse roof ended in a pale flat disc at r=1.25. Now a steeper cone rising to the underside of the
    # buck, closing on a tarred-canvas collar ('petticoat') round the main post, with rafter-rolls every 22.5 deg.
    lathe('roof_shingle', [(RR + 0.4, HR - 0.08), (RR + 0.1, HR + 0.12), (1.6, HR + 1.2), (0.62, 3.72)], 'rh_roof', n=32,
          mat_tint=(0.62, 0.56, 0.5))
    bm = bmesh.new()
    K.loft_bm(bm, [ring((0, 0), 0.66, 3.66, 16), ring((0, 0), 0.5, 3.95, 16), ring((0, 0), 0.42, 4.02, 16)], close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'canvas', name='rh_collar', mat_tint=(0.35, 0.33, 0.3), grime=0.3, smooth=True, bisect=False)
    bm = bmesh.new()
    for k_ in range(16):
        a_ = 2 * math.pi * (k_ + 0.5) / 16
        d_ = V((math.cos(a_), math.sin(a_), 0))
        p0_, p1_ = d_ * (RR + 0.36) + V((0, 0, HR - 0.02)), d_ * 0.7 + V((0, 0, 3.66))
        K.beam_bm(bm, p0_ + V((0, 0, 0.05)), p1_ + V((0, 0, 0.05)), 0.07, 0.05, up=V((0, 0, 1)))
    K.loft_bm(bm, [ring((0, 0), RR + 0.42, HR - 0.2, 32), ring((0, 0), RR + 0.42, HR - 0.02, 32)], close_start=False, close_end=False)   # eave board
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'timber_tarred', name='rh_roof_rolls', uv='beam', axis=(0, 0, 1), grime=0.4, bisect=False)
    bm = bmesh.new()                                     # main post, crosstrees and quarterbars (visible above the low roundhouse roof)
    K.beam_bm(bm, (0, 0, 0.3), (0, 0, 4.25), 0.55, 0.55)
    for a in (0.0, math.pi / 2):
        d = V((math.cos(a), math.sin(a), 0))
        K.beam_bm(bm, -d * (RR - 0.35) + V((0, 0, 0.75)), d * (RR - 0.35) + V((0, 0, 0.75)), 0.35, 0.35)
    for k in range(4):
        d = V((math.cos(k * math.pi / 2), math.sin(k * math.pi / 2), 0))
        K.beam_bm(bm, d * (RR - 0.5) + V((0, 0, 0.9)), d * 0.3 + V((0, 0, 3.6)), 0.26, 0.26)
    K.part(bm, 'timber_beam', name='trestle', uv='beam', axis=(0, 0, 1), tint=(0.75, 0.68, 0.6))
    K.P('timber_tarred', K.cyl_bm, (0, 0, 3.9), (0, 0, 4.1), 0.9, 12, name='crown_tree')
    bx0, bx1, by0, by1, bz0, bz1 = -2.1, 2.1, -2.8, 2.8, 4.1, 9.3
    bp = [(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)]
    bw = [K.opening(bp, 0, 2.1, 0.7, 0.9, 2.2, 0.25, 'rect'), K.opening(bp, 1, 2.0, 0.6, 0.8, 1.2, 0.25, 'rect'),
          K.opening(bp, 3, 3.2, 0.6, 0.8, 1.2, 0.25, 'rect')]
    bd = K.opening(bp, 2, 2.1, 0.9, 1.9, 0.0, 0.25, 'rect', 'door')
    bw = [K.Frame(f.o + V((0, 0, bz0)), f.n, f.r, f.w, f.h, f.depth) for f in bw]
    bd = K.Frame(bd.o + V((0, 0, bz0)), bd.n, bd.r, bd.w, bd.h, bd.depth, 'rect', 'door')
    # rework3: the buck was a plain dark box with a flat-reading gable roof. Now: dark backing wall + real overlapping
    # clapboards (bottom edge 35 mm proud, per-board tone), protruding corner posts, sill beam, floor girt and wall
    # plate, pale window casings, a curved (hull-section) roof with tarred battens, pale ridge capping and curved
    # barge boards, front hood over the windshaft neck, door landing with rail.
    K.wall_ring(bp, bz1 - bz0, 0.25, 'timber_tarred', bw + [bd], z0=bz0, name='buck', footprint=False, mat_tint=(0.55, 0.5, 0.45))
    import bpy
    BOARD, PROUD = 0.2, 0.035
    RW = bx1 - bx0 + 0.6                              # roof span incl. 0.3 eaves
    RZ0, RH = bz1 - 0.12, 2.05                        # eave line, rise of the curved roof

    def roof_prof(k_=14, off=0.0):
        """(x, z) of the curved roof section: steep at the eaves, flattening to a crisp ridge (ogee-less hull curve)."""
        pts = []
        for i in range(k_ + 1):
            t = i / k_
            x = -RW / 2 + t * RW
            u = abs(x) / (RW / 2)
            z = RZ0 + RH * (1 - u ** 1.55) - off
            pts.append((x * (1 - off * 0.35), z))
        return pts

    def gable_half_w(z):
        """Half-width of the buck's gable wall at height z (under the curved roof)."""
        if z <= bz1:
            return (bx1 - bx0) / 2
        u = max(0.0, 1 - (z - RZ0 + 0.1) / RH)
        return min((bx1 - bx0) / 2, (RW / 2) * u ** (1 / 1.55) - 0.12)

    def clapboards(a2, b2, z0, z1, frames, gable=False):
        a3, b3 = V((*a2, 0)), V((*b2, 0))
        d = b3 - a3; Ln = d.length; d.normalize(); n = V((d.y, -d.x, 0))
        mid = a3 + d * (Ln / 2)
        bms = [bmesh.new() for _ in range(3)]
        z = z0
        while z < z1 - 0.03:
            zt = min(z + BOARD + 0.02, z1)
            hw = min(gable_half_w(zt) + 0.02, Ln / 2 - 0.12) if gable else Ln / 2 - 0.12
            if hw < 0.1:
                break
            cuts = []
            for f in frames:
                ft = (f.o - mid).dot(d)
                if f.o.z - 0.1 < zt and f.o.z + f.h + 0.1 > z:
                    cuts.append((ft - f.w / 2 - 0.1, ft + f.w / 2 + 0.1))
            segs, lo = [], -hw
            for c0, c1 in sorted(cuts):
                if c0 > lo:
                    segs.append((lo, c0))
                lo = max(lo, c1)
            if lo < hw:
                segs.append((lo, hw))
            for s0, s1 in segs:
                if s1 - s0 < 0.08:
                    continue
                bmx = bms[r.randrange(3)]
                q = [mid + d * s0 + n * PROUD + V((0, 0, z)), mid + d * s1 + n * PROUD + V((0, 0, z)),
                     mid + d * s1 + n * 0.006 + V((0, 0, zt)), mid + d * s0 + n * 0.006 + V((0, 0, zt))]
                vv = [bmx.verts.new(p) for p in q]
                bmx.faces.new(vv)
                w0, w1 = bmx.verts.new(mid + d * s0 + V((0, 0, z))), bmx.verts.new(mid + d * s1 + V((0, 0, z)))
                bmx.faces.new((w1, w0, vv[0], vv[1]))            # drip edge (shadow line under each board)
            z += BOARD
        return bms

    CLAP = [bmesh.new() for _ in range(3)]
    for ei in range(4):
        a2, b2 = bp[ei], bp[(ei + 1) % 4]
        fr_ = [f for f in bw + [bd] if abs(f.n.dot(V((b2[1] - a2[1], a2[0] - b2[0], 0)).normalized()) - 1) < 1e-3]
        parts_ = clapboards(a2, b2, bz0 + 0.12, bz1 - 0.08, fr_)
        if ei in (0, 2):
            parts_ += clapboards(a2, b2, bz1 - 0.08, RZ0 + RH - 0.15, [], gable=True)
        for k_, bmx in enumerate(parts_):
            tmp = bpy.data.meshes.new('tmp'); bmx.to_mesh(tmp); bmx.free(); CLAP[k_ % 3].from_mesh(tmp); bpy.data.meshes.remove(tmp)
    for k_, (bmx, tn) in enumerate(zip(CLAP, ((1.02, 0.93, 0.82), (0.9, 0.82, 0.72), (1.12, 1.02, 0.9)))):
        K.part(bmx, 'timber_grey', name='buck_clap%d' % k_, uv='beam', axis=(1, 0, 0), mat_tint=tn, grime=0.7, bisect=False)
    for f in bw:
        K.window(f, 'fixed', (1, 1), frame=(0.3, 0.3, 0.3), sill=None, lintel=None, curtain=0.0, name='bw', streak=False)
    K.door(bd, 'buck', 'plank', (0.3, 0.28, 0.25), step=None, lintel=None)
    # frame: corner posts, sill beam, floor girt, wall plate (proud of the boards -> relief + shadow lines)
    FT = (0.42, 0.36, 0.3)
    bm = bmesh.new()
    for (cx_, cy_) in bp:
        sx, sy = (1 if cx_ > 0 else -1), (1 if cy_ > 0 else -1)
        K.box_bm(bm, (cx_ + sx * 0.02, cy_ + sy * 0.02, (bz0 - 0.25 + bz1 + 0.05) / 2), (0.26, 0.26, bz1 - bz0 + 0.3))
    for zb, hb, pj in ((bz0 + 0.05, 0.26, 0.07), (bz0 + 2.55, 0.16, 0.055), (bz1 - 0.09, 0.18, 0.06)):
        for ei in range(4):
            a2, b2 = V((*bp[ei], zb)), V((*bp[(ei + 1) % 4], zb))
            d = (b2 - a2).normalized(); n = V((d.y, -d.x, 0))
            K.beam_bm(bm, a2 + n * pj, b2 + n * pj, hb, 0.1, up=n)
    for f in bw + [bd]:                               # casings
        for x_, z_, w_, h_ in ((-f.w / 2 - 0.05, f.h / 2, 0.1, f.h + 0.2), (f.w / 2 + 0.05, f.h / 2, 0.1, f.h + 0.2), (0, f.h + 0.05, f.w + 0.2, 0.1), (0, -0.05, f.w + 0.26, 0.1)):
            c_ = f.p(x_, z_, 0.06)
            K.box_bm(bm, tuple(c_), (abs(f.r.x) * w_ + abs(f.n.x) * 0.06, abs(f.r.y) * w_ + abs(f.n.y) * 0.06, h_))
    K.part(bm, 'timber_beam', name='buck_frame', uv='beam', axis=(0, 0, 1), mat_tint=FT, grime=0.8, bisect=False)
    # curved hull-section roof (ridge along y), extended at the front into a hood over the windshaft neck
    ry0, ry1 = by0 - 0.55, by1 + 0.35
    top = roof_prof(); bot = roof_prof(off=0.09)
    bm = bmesh.new()
    rings = [[V((x_, y_, z_)) for x_, z_ in top] + [V((x_, y_, z_)) for x_, z_ in reversed(bot)] for y_ in (ry0, ry1)]
    fs = K.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'roof_shingle', name='buck_roof_slope', mat_tint=(0.82, 0.76, 0.7), grime=0.6)
    bm = bmesh.new()                                  # tarred battens over the board joints, following the curve
    nb_ = int((ry1 - ry0) / 0.62)
    for kb in range(nb_ + 1):
        y_ = ry0 + 0.08 + kb * (ry1 - ry0 - 0.16) / nb_
        for (xa, za), (xb, zb) in zip(top[:-1], top[1:]):
            K.beam_bm(bm, V((xa, y_, za + 0.03)), V((xb, y_, zb + 0.03)), 0.07, 0.05, up=V((0, 0, 1)))
    K.part(bm, 'timber_tarred', name='buck_roof_battens', uv='beam', axis=(1, 0, 0), grime=0.4, bisect=False)
    bm = bmesh.new()                                  # ridge capping (pale weathered board, reads as a crisp ridge line)
    zr_ = RZ0 + RH
    K.hexa_bm(bm, [V((-0.2, ry0 - 0.05, zr_ - 0.08)), V((-0.2, ry1 + 0.05, zr_ - 0.08)), V((0.2, ry1 + 0.05, zr_ - 0.08)), V((0.2, ry0 - 0.05, zr_ - 0.08)),
                   V((-0.06, ry0 - 0.05, zr_ + 0.08)), V((-0.06, ry1 + 0.05, zr_ + 0.08)), V((0.06, ry1 + 0.05, zr_ + 0.08)), V((0.06, ry0 - 0.05, zr_ + 0.08))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for y_ in (ry0 - 0.02, ry1 + 0.02):               # curved barge boards on both gables
        for (xa, za), (xb, zb) in zip(top[:-1], top[1:]):
            K.beam_bm(bm, V((xa, y_, za - 0.06)), V((xb, y_, zb - 0.06)), 0.05, 0.24, up=V((0, 0, 1)))
    K.part(bm, 'timber_grey', name='buck_ridge_barge', uv='beam', axis=(1, 0, 0), mat_tint=(1.25, 1.2, 1.12), grime=0.5, bisect=False)
    # backing gable walls (filled polygon under the curve) behind the clapboards
    for yg, s_ in ((by0, -1), (by1, 1)):
        bm = bmesh.new()
        pts = [(x_, z_) for x_, z_ in bot if abs(x_) <= (bx1 - bx0) / 2]
        ring_ = [V((bx0, yg, bz1 - 0.1))] + [V((x_, yg, z_ - 0.03)) for x_, z_ in pts] + [V((bx1, yg, bz1 - 0.1))]
        K.loft_bm(bm, [ring_, [p + V((0, -s_ * 0.2, 0)) for p in ring_]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, 'timber_tarred', name='buck_gable%d' % (s_ + 1), mat_tint=(0.55, 0.5, 0.45), bisect=False)
    # landing at the rear door (top of the ladder) with a rail
    bm = bmesh.new()
    K.box_bm(bm, (0, by1 + 0.45, bz0 - 0.05), (1.5, 0.9, 0.08))
    for sx in (-0.7, 0.7):
        K.beam_bm(bm, (sx, by1 + 0.05, bz0 - 0.9), (sx, by1 + 0.85, bz0 - 0.1), 0.08, 0.08)          # brackets
        K.beam_bm(bm, (sx, by1 + 0.85, bz0 - 0.05), (sx, by1 + 0.85, bz0 + 1.0), 0.07, 0.07)
        K.beam_bm(bm, (sx, by1 + 0.05, bz0 + 1.0), (sx, by1 + 0.85, bz0 + 1.0), 0.06, 0.06)
    K.part(bm, 'timber_grey', name='buck_landing', uv='beam', axis=(1, 0, 0), tint=(0.8, 0.75, 0.68))
    K.roof_meta([(bx0, by0 - 0.55), (bx1, by0 - 0.55), (bx1, by1 + 0.35), (bx0, by1 + 0.35)], bz1, walkable=False, kind='gable')

    bm = bmesh.new()                                     # ladder-stair from the buck door down to the ground at the tail
    lx0, lz0, lx1 = by1 + 0.05, bz0, by1 + 4.4
    for sx in (-0.55, 0.55):
        K.beam_bm(bm, (sx, lx0, lz0), (sx, lx1, 0.0), 0.08, 0.24)
        K.beam_bm(bm, (sx * 1.05, lx0, lz0 + 1.0), (sx * 1.05, lx1, 1.0), 0.05, 0.05)          # handrails
        K.beam_bm(bm, (sx * 1.05, lx1, 0.0), (sx * 1.05, lx1, 1.0), 0.06, 0.06)
    for k in range(1, 15):
        t_ = k / 15
        K.box_bm(bm, (0, lx0 + (lx1 - lx0) * t_, lz0 * (1 - t_) + 0.06), (1.1, 0.24, 0.04))
    K.part(bm, 'timber_grey', name='buck_ladder', uv='beam', axis=(1, 0, 0), tint=(0.8, 0.75, 0.68))
    K.ladder_meta((0, lx1 + 0.3, 0), (0, lx0, bz0), bz0)
    bm = bmesh.new()
    K.beam_bm(bm, (0, by1, bz0 - 0.3), (0, by1 + 6.5, 0.9), 0.24, 0.24)
    K.cyl_bm(bm, (-0.1, by1 + 6.5, 0.6), (0.1, by1 + 6.5, 0.6), 0.5, 12)
    K.part(bm, 'timber_tarred', name='tailpole', uv='beam', axis=(0, 1, 0))
    K.footprint([(p.x, p.y) for p in ring((0, 0), RR + 0.1, 0, 12)], 'HIGH', 'mill')
    ZC = bz1
    hub = V((0, by0 - 0.9, 7.7))
    shaft_top = V((0, by0 + 1.5, 8.0))

# ---- windshaft + sails (separate node pivoted on the hub) ---------------------------------------------------------------
tilt = math.radians(10)
ax = (hub - shaft_top).normalized()
K.P('timber_beam', K.cyl_bm, tuple(shaft_top), tuple(hub - ax * 0.0), 0.2, 10, name='windshaft')
up = V((0, 0, 1)) - ax * ax.z
up.normalize()
side = ax.cross(up).normalized()
SAIL, SW = (10.5 if base == 'a' else 7.0), 2.1        # b: sail tips must clear the ground at every rotation
broken = {1: 0.45, 3: 0.0} if RUIN else {}


def sails_part(bm, mid, name):
    ob = K.part(bm, mid, name=name, node='sails', uv='beam', axis=(0, 0, 1), grime=0.6, bisect=False)
    ob['kit_pivot'] = list(hub)
    return ob

bm, bm_c = bmesh.new(), bmesh.new()
K.cyl_bm(bm, hub - ax * 0.3, hub + ax * 0.45, 0.42, 12)                                          # poll end / canister
for k in range(4):
    a = math.radians(45 + 90 * k)
    d = up * math.cos(a) + side * math.sin(a)
    t = d.cross(ax).normalized()                                                                  # trailing direction
    Lk = SAIL * (broken.get(k, 1.0))
    if Lk < 0.5:
        continue
    whip0, whip1 = hub + ax * 0.2, hub + ax * 0.2 + d * Lk
    K.beam_bm(bm, whip0, whip1, 0.22, 0.26, up=ax)                                                 # whip / stock
    for s_off in (SW * 0.35, SW):                                                                 # hemlock + outer sail rail
        a0 = hub + ax * 0.12 + d * 2.0 + t * s_off
        a1 = hub + ax * 0.12 + d * Lk + t * s_off
        K.beam_bm(bm, a0, a1, 0.06, 0.08, up=ax)
    nb = int((Lk - 2.0) / 0.55)
    for j in range(nb + 1):
        p = hub + ax * 0.12 + d * (2.0 + j * (Lk - 2.0) / max(1, nb))
        K.beam_bm(bm, p - t * 0.35, p + t * SW, 0.05, 0.05, up=ax)                                  # sail bars
    if k in (0, 2) and not RUIN:                                                                  # furled / half-spread canvas
        c0, c1 = hub + ax * 0.08 + d * 2.1, hub + ax * 0.08 + d * (Lk - 0.1)
        spread = SW * (0.95 if k == 0 else 0.4)
        q = [c0 + t * 0.05, c1 + t * 0.05, c1 + t * spread, c0 + t * spread]
        f = bm_c.faces.new([bm_c.verts.new(p) for p in q])
        f2 = bm_c.faces.new([bm_c.verts.new(p - ax * 0.01) for p in reversed(q)])
sails_part(bm, 'timber_grey', 'sail_frames')
if len(bm_c.faces):
    sails_part(bm_c, 'curtain', 'sail_cloth')
K.anchor('sails_hub', tuple(hub), tuple(ax), kind='rotor', axis=[round(ax.x, 3), round(ax.z, 3), round(-ax.y, 3)], rpm=0 if RUIN else 8)
K.anchor('roof_ridge', (0, 0, ZC + 3.0))
K.anchor('lookout', (0, 0, ZC - 0.5), (0, -1, 0), kind='sniper_nest')

# weathering (intact: lichen + faint rain streaks only, no soot)
# rework3: the random lichen / rain-streak decals on the tower read as two soot smudges beside the door from the game
# camera -> removed; the intact tower keeps only the moss band at the (north) foot.
for i in range(6):                                   # keep the rng stream (ruin variant layout unchanged)
    r.uniform(0, 2 * math.pi)
    if base == 'a':
        r.uniform(1.0, 9.0)
if base == 'a':
    K.decal('moss_patch', V((0, R0 + 0.2, 0.4)), (0, 1, 0), 2.2, 0.7, alpha=0.6)
import kit_core as C
C.A.meta['mission_use'] = 'generic Normandy / Flanders windmill landmark; the M17 "old mill" is watermill_b (timber mill on a deck)'
if RUIN:   # shelled: cap torn open (stepped hole, splintered ribs), tower breached with loose stones, a sail down, heaps
    import random
    rq = random.Random(SEED)
    cb, _ = eu_dmg.blast_boxes(V((1.2, -1.3, ZC + 1.9)), 1.5, 0.6, (1.2, 1.2, 1.1), 0.28, 0.4, SEED)
    eu_dmg.carve(cb, only=lambda o: o.name.startswith(('cap', 'curb', 'windshaft', 'buck')))
    bm = bmesh.new()
    for k in range(7):                                  # splintered cap ribs / rafters poking out of the hole
        a0 = math.radians(-70 + k * 12)
        p0 = V((math.cos(a0) * (R1 + 0.2 if base == 'a' else 2.0), math.sin(a0) * (R1 + 0.2 if base == 'a' else 2.0), ZC + 0.6))
        p1 = p0 * 0.55 + V((0, 0, ZC * 0.45 + rq.uniform(1.5, 2.6)))
        eu_dmg.splinter_bm(bm, p0, p1, 0.08, 0.1, rq, 0.3)
    K.part(bm, 'timber_tarred', name='cap_splinters', uv='beam', axis=(0, 0, 1))
    if base == 'a':
        eu_dmg.blast(V((-R0 * 0.95, 0.5, 6.2)), 1.4, 0.0, (1.2, 1.2, 1.3), SEED + 1, mids=('fieldstone',),
                     only=lambda o: o.name.startswith(('tower', 'stage', 'mw')))
        eu_dmg.blast(V((R0 * 0.6, -R0 * 0.75, 2.2)), 1.1, 0.8, (1.2, 1.2, 1.2), SEED + 2, mids=('fieldstone',),
                     only=lambda o: o.name.startswith(('tower', 'mw')))
    bm = bmesh.new()                                    # the lost sail, broken, lying against the tower foot
    base_p = V((-(R0 + 1.0) if base == 'a' else -3.4, -2.0, 0.15))
    d = V((0.25, 1.0, 0.0)).normalized()
    t = V((d.y, -d.x, 0))
    K.beam_bm(bm, base_p, base_p + d * 7.5 + V((0, 0, 0.9)), 0.22, 0.26)
    for j in range(10):
        p = base_p + d * (1.2 + j * 0.62) + V((0, 0, 0.1 + j * 0.1))
        if rq.random() < 0.8:
            K.beam_bm(bm, p - t * 0.3, p + t * rq.uniform(0.8, 2.0), 0.05, 0.05)
    K.beam_bm(bm, base_p + t * 1.9 + d * 1.2, base_p + t * 1.7 + d * 5.0 + V((0, 0, 0.5)), 0.06, 0.08)
    K.part(bm, 'timber_grey', name='fallen_sail', uv='beam', axis=(0, 1, 0))
    eu_dmg.heap(V((-(R0 + 1.3) if base == 'a' else -3.3, 1.3, 0)), 1.9, 0.9, stone='fieldstone', dress='ashlar_limestone',
                tiles='roof_shingle', timber='timber_grey', seed=SEED, name='heap', n=26)
    scorch_openings(0.9)
finish(OUT)
