# Bismarck-class battleship replica (M13 Le Havre, objective: torpedo to the forward hull), reasonable detail + LODs.
# blender -b ... --python battleship.py -- grey|camo|burnt|all
# Real dims (Bismarck 1941): L 251 m, B 36 m, draught 9.3 m, freeboard ~8 m amidships / ~14 m at the Atlantic bow.
# 4 twin 38 cm SK C/34 turrets (Anton, Bruno, Caesar, Dora), 6 twin 15 cm, 8 twin 10.5 cm Flak; Hellgrau 50 upper
# works, dark grey turret roofs, black boot-top, red-brown anti-fouling. 'camo' = Baltic black/white dazzle bands.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['grey', 'camo', 'burnt']
PAL = {'ara': (96, 108, 90), 'boat': (150, 153, 152), 'hull': (108, 112, 112), 'super': (116, 120, 120), 'deck': (84, 86, 86), 'roof': (70, 72, 72), 'below': (92, 42, 34),
       'boot': (28, 28, 29), 'dark': (50, 52, 52), 'black_band': (30, 30, 31), 'white_band': (200, 200, 196)}
# Hull as functions of y (bow = -Y). Atlantic bow (1940 refit): stem raked ~20 deg above the waterline with strong
# flare, forefoot curving back under water; deck flat from the stern to Bruno, then a concave sheer rising ever more
# steeply to 14.6 m at the stem head; cruiser stern.
Y0, Y1 = -125.5, 125.5


def _s(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def deck_z(y):
    if y < -45.0:
        return 8.0 + 6.6 * ((-45.0 - y) / 80.5) ** 1.8
    return 8.0 - 0.7 * _s((y - 40.0) / 85.5)


def keel_z(y):
    if y < -120.3:                                      # raked stem above the waterline
        return min(deck_z(y) - 0.3, (-120.3 - y) / 0.36)
    if y < -111.3:                                      # forefoot sweeping back to the keel
        return -9.3 * ((y + 120.3) / 9.0) ** (1 / 1.6)
    if y > 95.0:
        return -9.3 + 9.9 * _s((y - 95.0) / 30.5) ** 1.2
    return -9.3


def beams(y):
    """(half beam at deck edge, half beam at the waterline, bottom fullness n, bilge height)."""
    if y < -50.0:
        t = (-50.0 - y) / 70.3
        hw = 18.0 * max(0.0, 1 - t ** 2.0) ** 0.9
        td = (-50.0 - y) / 75.5
        hd = max(0.3, 18.0 * max(0.0, 1 - td ** 2.6) ** 0.7)
        n = 5.5 - 4.2 * _s(t * 1.1)
        bh = 3.5 + (deck_z(y) + 9.3) * _s(t)
    elif y > 35.0:
        t = (y - 35.0) / 90.5
        hw = 2.4 + 15.6 * (1 - t ** 2.3)
        hd = 6.6 + 11.4 * (1 - t ** 2.0)
        n = 5.5 - 3.3 * _s(t)
        bh = 3.5 + 4.0 * _s(t)
    else:
        hw = hd = 18.0
        n, bh = 5.5, 3.5
    return hd, hw, n, bh


def hx(y, z):
    """Half-breadth of the shell at (y, z): flare above the waterline, bilge / V below (never below the keel)."""
    hd, hw, n, bh = beams(y)
    zd, zk = deck_z(y), keel_z(y)
    z = min(max(z, zk), zd)
    xs = hw + (hd - hw) * (max(0.0, z) / zd) ** 1.4 if z >= 0 else hw
    t = (z - zk) / max(0.5, bh)
    g = 1.0 if t >= 1 else (1 - (1 - t) ** n) ** (1 / n)
    return max(0.02, xs * g)


def prof_y(y):
    zd, zk = deck_z(y), keel_z(y)
    pts = [(0.0, zd + 0.45), (hx(y, zd) * 0.5, zd + 0.34), (hx(y, zd), zd)]
    for k in range(1, 11):
        u = (k / 11) ** 1.25
        z = zd + (zk - zd) * u
        pts.append((hx(y, z), z))
    pts.append((0.0, zk))
    return pts


YS = [Y0, -125.0, -124.2, -123.2, -122.0, -120.6, -119.0, -117.0, -114.5, -111.5] + [-108.0 + 8.0 * i for i in range(28)] + \
     [115.0, 118.5, 121.5, 124.0, Y1]


def half_beam(y):
    return hx(y, deck_z(y))


def hull(var):
    secs = [(y, prof_y(y)) for y in YS]
    bm = bmesh.new()
    N.section_loft(bm, secs)
    # deck faces (the first 2 segments each side) -> teak; the rest is hull, split at the waterline
    deck = bmesh.new()
    top = [f for f in bm.faces if f.normal.z > 0.55 and f.calc_center_median().z > 5.0]
    dm = {}
    for f in top:
        vs = []
        for v in f.verts:
            if v.index not in dm:
                dm[v.index] = deck.verts.new(v.co)
            vs.append(dm[v.index])
        deck.faces.new(vs)
    bmesh.ops.delete(bm, geom=top, context='FACES')
    np_(deck, 'teak' if var != 'burnt' else 'wood', 'deck_teak', uv_scale=1.0)
    # boot-topping: split the hull at +0.9 m first (black band 0..0.9 m), then at the waterline
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0.9), plane_no=(0, 0, 1))
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]          # and at the waterline, so no band face reaches below it
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0.0), plane_no=(0, 0, 1))
    band = bmesh.new()
    sel = [f for f in bm.faces if 0.0 < f.calc_center_median().z < 0.9]
    bm2 = bm.copy()
    bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if not (-0.02 < f.calc_center_median().z < 0.9)], context='FACES')
    bmesh.ops.delete(bm, geom=sel, context='FACES')
    np_(bm2, 'boot', 'boot_top', smooth=True)
    N.split_z(bm, 0.0, 'hull', 'below', 'hull', 'hull_below', smooth=True)
    if var == 'camo':
        camo_bands()
    # bow breakwater, anchor hawses + chains, capstans, bilge keel, stern
    # breakwater: V-shaped plate fence forward of Anton, following the deck sheer, with triangular stiffeners
    bm = bmesh.new()
    for sx in (-1, 1):
        pts = []
        for t in (k / 8 for k in range(9)):
            x, y = sx * 11.0 * (1 - t), -85.0 - 6.5 * t
            pts.append(V((x, y, deck_z(y) - 0.1)))
        for a_, b_ in zip(pts[:-1], pts[1:]):
            q = [a_, b_, b_ + V((0, 0, 1.4)), a_ + V((0, 0, 1.4))]
            C.quad(bm, q if sx > 0 else list(reversed(q)))
    N._thicken(bm, 0.06)
    np_(bm, 'super', 'breakwater')
    for sx in (-1, 1):
        y = -114.0
        x = half_beam(y)
        NP('dark', cyl, (sx * (x - 0.1), y, deck_z(y) - 1.6), (sx * (x + 0.2), y, deck_z(y) - 1.6), 0.9, 10, name='hawse')
        stockless_anchor(V((sx * (hx(y + 1.6, deck_z(y) - 3.6) + 0.35), y + 1.6, deck_z(y) - 3.6)), sx)
        if sx < 0:                                       # second (sheet) anchor to starboard (-X = right)
            stockless_anchor(V((sx * (hx(y + 7.0, deck_z(y) - 4.2) + 0.35), y + 7.0, deck_z(y) - 4.2)), sx)
            NP('dark', cyl, (sx * (hx(y + 5.4, deck_z(y) - 1.9) - 0.1), y + 5.4, deck_z(y) - 1.9), (sx * (hx(y + 5.4, deck_z(y) - 1.9) + 0.2), y + 5.4, deck_z(y) - 1.9), 0.8, 10, name='hawse')
        # armour belt top: a slight step/ledge along the hull side over the citadel
        bm = bmesh.new()
        rows = []
        for yy in range(-88, 84, 7):
            xx = hx(yy, 3.2)
            rows.append([V((sx * (xx + 0.16), yy, 3.2)), V((sx * (xx + 0.02), yy, 3.45))])
        N._strip(bm, rows if sx > 0 else [list(reversed(r)) for r in rows])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        for f in bm.faces:
            if f.normal.x * sx < 0:
                f.normal_flip()
        np_(bm, 'hull', 'belt_step')
        # degaussing cable: external loop run along the hull just below the deck edge, in clips
        bm = bmesh.new()
        pts = [V((sx * (hx(yy, deck_z(yy) - 1.4) + 0.12), yy, deck_z(yy) - 1.4)) for yy in range(-112, 118, 9)]
        for q0, q1 in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, q0, q1, 0.13, 3, caps=False)
        np_(bm, 'dark', 'degaussing_cable', lod='drop2')
        # anchor cable: deck hawse pipe (bolster) -> chain stopper -> capstan -> spurling pipe, lying ON the sheered deck
        hp = V((sx * 3.2, -112.0, deck_z(-112.0)))
        NP('dark', cyl, hp - V((0, 0, 0.2)), hp + V((0, 0, 0.25)), 0.75, 12, name='deck_hawse')
        cp = V((sx * 3.6, -101.0, deck_z(-101.0)))
        NP('dark', cyl, cp, cp + V((0, 0, 1.2)), 0.9, 12, name='capstan')
        NP('dark', cyl, cp + V((0, 0, 1.2)), cp + V((0, 0, 1.45)), 1.05, 12, name='capstan_head', lod='drop')
        NP('dark', box, (sx * 3.35, -106.5, deck_z(-106.5) + 0.25), (0.6, 1.4, 0.5), name='chain_stopper', lod='drop')
        chain_run([hp + V((0, 0.4, 0.2)), V((sx * 3.35, -106.5, 0)), cp + V((0, -0.9, 0.2))], sx)
        NP('dark', cyl, (sx * 3.6, -99.0, deck_z(-99.0) - 0.1), (sx * 3.6, -99.0, deck_z(-99.0) + 0.35), 0.45, 10, name='spurling_pipe')
        bm = bmesh.new()
        C.beam_bm(bm, V((sx * 17.6, -50, -6.8)), V((sx * 17.6, 40, -6.8)), 0.1, 1.0, roll=math.radians(sx * 45))
        np_(bm, 'below', 'bilge_keel_below')
    VH.contact('keel_fwd', (0, -100, -9.3), width=2.0)
    VH.contact('keel_aft', (0, 90, -8.5), width=2.0)


def chain_run(pts, sx, pitch=1.0):
    """Stud-link anchor cable lying on the deck: alternating flat / upright links along a polyline (z from the deck)."""
    bm = bmesh.new()
    path = []
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int((V((b.x, b.y, 0)) - V((a.x, a.y, 0))).length / pitch))
        for i in range(n):
            q = a.lerp(b, i / n)
            path.append(V((q.x, q.y, deck_z(q.y) + 0.18)))
    for k, q in enumerate(path[:-1]):
        d = (path[k + 1] - q).normalized()
        side = V((0, 0, 1)) if k % 2 else d.cross(V((0, 0, 1))).normalized()
        c = q + d * pitch * 0.5
        for o in (-1, 1):
            C.beam_bm(bm, c - d * 0.45 + side * o * 0.16, c + d * 0.45 + side * o * 0.16, 0.1, 0.1)
    np_(bm, 'dark', 'anchor_chain', lod='drop')


def stockless_anchor(p, sx):
    """Hall-type stockless anchor housed in the hawse on the bow flare: shank up the hawse pipe, crown + two flukes."""
    bm = bmesh.new()
    C.beam_bm(bm, p + V((0, 0, 0.9)), p + V((0, 0, -1.1)), 0.35, 0.35)
    C.beam_bm(bm, p + V((0, -1.1, -1.25)), p + V((0, 1.1, -1.25)), 0.5, 0.45)
    for d in (-1, 1):
        C.beam_bm(bm, p + V((0, d * 1.0, -1.3)), p + V((sx * 0.25, d * 1.15, -0.2)), 0.55, 0.22)
    np_(bm, 'dark', 'anchor')


def camo_bands():
    """Baltic 1941 dazzle: black-white-black slanted bands fore and aft on the hull sides (painted out before Rheinuebung)."""
    for y0, lean in ((-96.0, -4.0), (-78.0, -4.0), (70.0, 4.0), (88.0, 4.0)):
        for k, key in enumerate(('black_band', 'white_band', 'black_band')):
            for sx in (-1, 1):
                bm = bmesh.new()
                rows = []
                zt = deck_z(y0) - 0.1
                for i in range(7):
                    z = 0.95 + (zt - 0.95) * i / 6
                    ya = y0 + k * 2.6 + lean * (z / zt)
                    yb = ya + 2.6
                    rows.append([V((sx * (hx(ya, z) + 0.06), ya, z)), V((sx * (hx(yb, z) + 0.06), yb, z))])
                N._strip(bm, rows if sx > 0 else [list(reversed(r)) for r in rows])
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
                for f in bm.faces:
                    if f.normal.x * sx < 0:
                        f.normal_flip()
                np_(bm, key, 'camo_band', lod='drop2', grime=0.6)


TURRETS = []


def turret(name, pos, yaw, size=1.0, barrel=19.8, br=0.55, roof='roof', guns=2, gap=None, rf=True, zb_h=3.0):
    """Twin gun turret on a barbette. yaw 0 = guns forward (-Y). Nodes: <name> (yaw), <name>_guns (pitch, child)."""
    s = size
    TURRETS.append((name, V(pos), yaw, s))
    T = N.Tf(pos, yaw)
    bx, by, bz = pos
    NP('super', cyl, (bx, by, bz - zb_h), (bx, by, bz), 5.2 * s, 18, name=name + '_barbette')
    kw = dict(node=name, pivot=tuple(pos))
    # turret house as a side-profile prism: raked face plate, sloped roof-front plate, flat roof, vertical rear;
    # the sides lean in towards the roof (Bismarck 38 cm Drh LC/34 / 15 cm Drh LC/34 shape)
    prof = [(-4.6, 0.0), (6.6, 0.0), (6.6, 3.8), (-1.0, 3.8), (-3.2, 2.9)]
    bm = bmesh.new()
    wb, wt = 5.1, 4.45
    L, R = [], []
    for y, z in prof:
        w = wb - (wb - wt) * z / 3.8
        L.append(bm.verts.new(V(T((-w * s, y * s, z * s)))))
        R.append(bm.verts.new(V(T((w * s, y * s, z * s)))))
    bm.faces.new(L)
    bm.faces.new(list(reversed(R)))
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((L[i], L[j], R[j], R[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    np_(bm, 'super', name + '_house', **kw)
    NP(roof, box, T((0, 2.8 * s, 3.84 * s)), (8.7 * s, 7.4 * s, 0.1 * s), math.radians(yaw), name=name + '_roof', **kw)
    for sx in (-1, 1):                               # commander's / layer's periscope hoods on the roof front slope
        NP('dark', box, T((sx * 2.4 * s, -1.4 * s, 3.75 * s)), (0.9 * s, 1.1 * s, 0.5 * s), math.radians(yaw), name=name + '_scope_hood', lod='drop', **kw)
    if rf:
        # rangefinder through the rear of the house: armoured tube 'ears' each side ending in hooded heads
        NP('super', cyl, T((-6.3 * s, 4.6 * s, 2.7 * s)), T((6.3 * s, 4.6 * s, 2.7 * s)), 0.5 * s, 10, name=name + '_rf', **kw)
        for sx in (-1, 1):
            NP('super', box, T((sx * 6.35 * s, 4.6 * s, 2.75 * s)), (0.9 * s, 1.5 * s, 1.35 * s), math.radians(yaw), name=name + '_rf_hood', **kw)
            NP('dark', box, T((sx * 6.35 * s, 3.83 * s, 2.85 * s)), (0.7 * s, 0.06 * s, 0.35 * s), math.radians(yaw), name=name + '_rf_port', lod='drop', **kw)
    VH.moving(name, 'turret_yaw', pos, (0, 0, 1), limits=(-150, 150) if yaw in (0, 180) else (-80, 80))
    tp = V(T((0, -3.6 * s, 1.6 * s)))
    kg = dict(node=name + '_guns', pivot=tuple(tp))
    gap = gap or 2.4 * s
    for k in range(guns):
        dx = (k - (guns - 1) / 2) * gap
        a, b = V(T((dx, -3.4 * s, 1.6 * s))), V(T((dx, -3.4 * s - barrel, 1.6 * s)))
        d = (b - a).normalized()
        L = (b - a).length
        at = lambda f: a + d * (L * f)
        # gun port recess in the face plate + canvas blast bag (Schutzbalg) round the barrel root
        NP('black', box, T((dx, -3.86 * s, 1.6 * s)), (br * 3.4, 0.12 * s, br * 4.2), math.radians(yaw), name=name + '_port', lod='drop', **kw)
        big = s >= 0.8
        sg = 12 if big else 8                              # 15 cm guns: lighter meshes (budget)
        NP('tarcanvas', cyl, at(0.0), at(0.06), br * 1.95, sg, r1=br * 1.4, name=name + '_blast_bag', **kg)
        if big:
            NP('tarcanvas', cyl, at(0.03), at(0.036), br * 1.72, sg, name=name + '_bag_fold', lod='drop', **kg)
        # tapered barrel: reinforce + chase (taper to the muzzle) + muzzle swell
        NP('super', cyl, at(0.055), at(0.36), br * 1.3, sg, r1=br * 1.1, name=name + '_barrel', **kg)
        NP('super', cyl, at(0.36), at(0.94), br * 1.02, sg, r1=br * 0.74, name=name + '_barrel', **kg)
        NP('super', cyl, at(0.94), at(1.0), br * 0.8, sg, r1=br * 0.86, name=name + '_muzzle_swell', **kg)
        if big:
            NP('super', cyl, at(0.355), at(0.365), br * 1.14, sg, name=name + '_barrel_step', lod='drop', **kg)
        NP('black', cyl, at(1.0), at(1.0) + d * 0.02, br * 0.55, sg, name=name + '_bore', lod='drop', **kg)
        VH.socket('muzzle_%s_%d' % (name, k), tuple(b), tuple(d), node=name + '_guns')
    # turret house detail: roof edge rim, rear access doors + rungs, roof vents, face-plate bolt strip
    NP('dark', box, T((0, 6.55 * s, 1.5 * s)), (3.2 * s, 0.1 * s, 2.2 * s), math.radians(yaw), name=name + '_rear_door', lod='drop', **kw)
    for z in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0):
        NP('dark', box, T((3.4 * s, 6.65 * s, z * s)), (0.8 * s, 0.1 * s, 0.07 * s), math.radians(yaw), name=name + '_rung', lod='drop', **kw)
    for sx_ in (-1, 1):
        NP('dark', box, T((sx_ * 4.52 * s, 1.0 * s, 3.86 * s)), (0.14 * s, 11.0 * s, 0.14 * s), math.radians(yaw), name=name + '_roof_rim', lod='drop', **kw)
        NP('super', cyl, V(T((sx_ * 1.6 * s, 4.8 * s, 3.9 * s))), V(T((sx_ * 1.6 * s, 4.8 * s, 4.5 * s))), 0.35 * s, 8, name=name + '_vent', lod='drop', **kw)
    NP('dark', box, T((0, -4.3 * s, 0.45 * s)), (9.6 * s, 0.14 * s, 0.14 * s), math.radians(yaw), name=name + '_face_strip', lod='drop', **kw)
    VH.moving(name + '_guns', 'gun_pitch', tp, V(T((1, 0, 0))) - V(T((0, 0, 0))), limits=(-8, 30), parent=name)
    return name


def flak_mount(name, pos, yaw):
    """Twin 10.5 cm SK C/33 in its Dopp. LC/31 mount: raised round platform with a rim, pedestal, and the shielded
    gunhouse (sloped front, sides, roof; open at the rear) carrying the twin barrels. Nodes <name> yaw, <name>_guns pitch."""
    T = N.Tf(pos, yaw)
    p0 = V(pos)
    NP('super', cyl, p0 - V((0, 0, 0.9)), p0 + V((0, 0, 0.35)), 3.1, 16, name=name + '_platform')
    NP('dark', cyl, p0 + V((0, 0, 0.35)), p0 + V((0, 0, 0.45)), 3.2, 16, name=name + '_platform_rim')
    kw = dict(node=name, pivot=tuple(pos))
    NP('super', cyl, p0 + V((0, 0, 0.35)), p0 + V((0, 0, 1.0)), 1.3, 12, name=name + '_pedestal', **kw)
    prof = [(-1.7, 0.9), (2.3, 0.9), (2.3, 3.1), (-0.4, 3.1), (-1.4, 2.6)]
    bm = bmesh.new()
    Lv = [bm.verts.new(V(T((-2.05, y, z)))) for y, z in prof]
    Rv = [bm.verts.new(V(T((2.05, y, z)))) for y, z in prof]
    bm.faces.new(Lv)
    bm.faces.new(list(reversed(Rv)))
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        if i == 1:
            continue                                     # open rear
        bm.faces.new((Lv[i], Lv[j], Rv[j], Rv[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    N._thicken(bm, 0.05)
    np_(bm, 'super', name + '_shield', **kw)
    NP('dark', box, T((0, 0.4, 1.0)), (2.4, 2.6, 0.3), math.radians(yaw), name=name + '_cradle_base', **kw)
    VH.moving(name, 'gun_yaw', pos, (0, 0, 1), limits=(-160, 160))
    tp = V(T((0, -0.6, 2.0)))
    kg = dict(node=name + '_guns', pivot=tuple(tp))
    NP('super', box, T((0, 0.4, 2.0)), (1.9, 2.4, 0.7), math.radians(yaw), name=name + '_cradle', **kg)
    for dx in (-0.62, 0.62):
        NP('super', cyl, V(T((dx, -1.4, 2.0))), V(T((dx, -1.9, 2.0))), 0.3, 10, name=name + '_mantlet', **kg)
        NP('super', cyl, V(T((dx, -1.9, 2.0))), V(T((dx, -6.9, 2.0))), 0.15, 8, r1=0.11, name=name + '_barrel', **kg)
    VH.moving(name + '_guns', 'gun_pitch', tp, V(T((1, 0, 0))) - V(T((0, 0, 0))), limits=(-8, 80), parent=name)


def house(name, y0, y1, hw0, hw1, z0, z1, key='super', r=0.6, win=False):
    """Deck house block (rounded ends via bevel) from y0..y1, half widths hw0 (fore) -> hw1 (aft)."""
    bm = bmesh.new()
    C.hexa_bm(bm, [V((-hw0, y0, z0)), V((hw0, y0, z0)), V((hw1, y1, z0)), V((-hw1, y1, z0)),
                   V((-hw0 * 0.97, y0 + 0.3, z1)), V((hw0 * 0.97, y0 + 0.3, z1)), V((hw1 * 0.97, y1 - 0.3, z1)), V((-hw1 * 0.97, y1 - 0.3, z1))])
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.5], offset=r, segments=2, affect='EDGES', clamp_overlap=True)
    np_(bm, key, name)
    if win:                                              # bridge windows / scuttles: a dark band near the top
        for sx in (-1, 1):
            NP('glass', box, (sx * (hw0 + hw1) / 2 * 0.985, (y0 + y1) / 2, z1 - 0.9), (0.06, (y1 - y0) * 0.8, 0.8), name=name + '_windows', lod='drop2')
        NP('glass', box, (0, y0 + 0.2, z1 - 0.9), (hw0 * 1.7, 0.06, 0.8), name=name + '_windows', lod='drop2')


def rangefinder(name, pos, arm=5.25, r=2.4, hood=False, hood_len=None):
    """Rotating rangefinder cupola (dome + 10.5 m base arms), node yaws about its centre."""
    kw = dict(node=name, pivot=tuple(pos))
    if hood:     # foretop: long armoured hood over the whole 10.5 m base, with rounded ends and a dark optics slot
        NP('super', VH.bevel_box, V(pos) + V((0, 0, 1.0)), (hood_len or arm * 2 + 1.0, 2.2, 1.9), 0.5, 2, name=name + '_hood_long', **kw)
        NP('black', box, V(pos) + V((0, -1.12, 1.3)), (arm * 1.6, 0.06, 0.25), name=name + '_slot', lod='drop', **kw)
    NP('super', cyl, pos, V(pos) + V((0, 0, 1.6)), r, 16, name=name + '_drum', **kw)
    bm = bmesh.new()
    C.cyl_bm(bm, V(pos) + V((0, 0, 1.6)), V(pos) + V((0, 0, 2.6)), r, 16, r1=r * 0.45)
    np_(bm, 'super', name + '_dome', **kw)
    NP('super', cyl, V(pos) + V((-arm, 0, 1.0)), V(pos) + V((arm, 0, 1.0)), 0.5, 10, name=name + '_arms', **kw)
    for sx in (-1, 1):
        NP('dark', box, V(pos) + V((sx * arm, 0, 1.0)), (0.3, 1.2, 1.2), name=name + '_hood', lod='drop', **kw)
    VH.moving(name, 'rangefinder', pos, (0, 0, 1), limits=(-180, 180))


def win_band(y0, y1, hw, z, h=0.75, front=True, sides=True, mull=2.2, name='bridge_windows'):
    """Continuous dark window band round a bridge level (front + sides) with frame mullions every `mull` m."""
    if front:
        NP('glass', box, (0, y0 - 0.03, z), (hw * 1.9, 0.08, h), name=name, lod='drop2')
    if sides:
        for sx in (-1, 1):
            NP('glass', box, (sx * (hw + 0.03), (y0 + y1) / 2, z), (0.08, (y1 - y0) * 0.86, h), name=name, lod='drop2')
    bm = bmesh.new()
    n = int(hw * 1.9 / mull)
    for k in range(1, n):
        x = -hw * 0.95 + hw * 1.9 * k / n
        C.beam_bm(bm, V((x, y0 - 0.09, z - h / 2)), V((x, y0 - 0.09, z + h / 2)), 0.14, 0.08)
    if n > 1:
        np_(bm, 'super', name + '_mullions', lod='drop')


def block(name, y0, y1, hw, z0, z1, key='super', r=0.9, front_hw=None, fl=0.0):
    """Superstructure level: rounded-front block; the front part (length fl) may have its own half width."""
    fw = front_hw or hw
    st = [(y0, fw * 0.8, z0, z1, r), (y0 + 1.6, fw, z0, z1, r * 0.8)]
    if fl:
        st += [(y0 + fl, fw, z0, z1, r * 0.8), (y0 + fl + 5.0, hw, z0, z1, r * 0.6)]
    st += [(y1 - 1.0, hw, z0, z1, r * 0.5), (y1, hw * 0.96, z0, z1 - 0.1, r * 0.4)]
    bm = bmesh.new()
    VH.body_loft(bm, st, n=2)
    np_(bm, key, name)
    NP('dark', box, (0, (y0 + y1) / 2, z1 + 0.05), (2 * hw + 0.4, y1 - y0 + 0.2, 0.12), name=name + '_deck_edge', lod='drop2')


def superstructure(var):
    burnt = var == 'burnt'
    # 01 level: long superstructure deck from Bruno's barbette to Caesar's (15 cm turrets + 10.5 cm Flak stand on it)
    house('house_mid', -55, 47, 11.8, 11.8, 8.0, 11.0)
    # 02 level: the massive central block, forward bridge structure to the aft control position
    block('block_02', -53.0, 11.5, 6.4, 11.0, 14.0, front_hw=9.6, fl=8.0)
    block('block_02_aft', 17.5, 44.0, 6.4, 11.0, 14.0)          # (gap: the athwartships catapult crosses at y 15)
    # forward structure: armoured conning tower (with its own rangefinder hood) at the front of the bridge, then the
    # admiral's bridge, navigating bridge and upper bridge levels, each with a window band and wings
    NP('super', cyl, (0, -50.5, 11.0), (0, -50.5, 17.6), 4.4, 20, name='conning_tower')
    NP('dark', cyl, (0, -50.5, 17.6), (0, -50.5, 17.8), 4.6, 20, name='conning_tower_roof')
    rangefinder('rf_conning', V((0, -50.5, 17.8)), arm=3.7, r=2.1, hood=True, hood_len=8.4)
    for sx in (-1, 1):
        NP('black', box, (sx * 3.0, -54.0, 16.2), (1.6, 0.4, 0.35), name='ct_vision_slit', lod='drop')
    NP('black', box, (0, -54.9, 16.2), (2.6, 0.2, 0.35), name='ct_vision_slit', lod='drop')
    levels = ((-49.0, -24.0, 8.2, 14.0, 17.2, 12.0), (-46.5, -27.0, 6.8, 17.2, 20.4, 11.2), (-44.0, -29.0, 5.6, 20.4, 23.5, 8.4))
    for i, (y0, y1, hw, z0, z1, wing) in enumerate(levels):
        if burnt and i == 2:
            block('bridge_%d' % i, y0 + 3.0, y1, hw * 0.8, z0, z0 + 1.6)          # upper bridge shot away
            continue
        block('bridge_%d' % i, y0, y1, hw, z0, z1, front_hw=hw * 0.92)
        if not burnt:
            win_band(y0 + 0.1, y1 - 3.0, hw * 0.93, z1 - 1.05, 0.8)
        else:
            win_band(y0 + 0.1, y1 - 3.0, hw * 0.93, z1 - 1.05, 0.9, name='bridge_windows_burnt')
        for sx in (-1, 1):                                  # open bridge wings with bulwarks
            if burnt and (i + (sx > 0)) % 2:
                continue
            NP('super', box, (sx * (hw + (wing - hw) / 2), y0 + 3.5, z1 - 0.05), (wing - hw, 3.4, 0.3), name='bridge_wing')
            NP('super', box, (sx * (wing - 0.06), y0 + 3.5, z1 + 0.55), (0.12, 3.4, 1.1), name='wing_bulwark')
            NP('super', box, (sx * (hw + (wing - hw) / 2), y0 + 1.84, z1 + 0.55), (wing - hw, 0.12, 1.1), name='wing_bulwark')
            NP('dark', beam, (sx * (hw - 0.3), y0 + 3.5, z1 - 2.3), (sx * (wing - 0.5), y0 + 3.5, z1 - 0.25), 0.3, 0.3, name='wing_bracket')
    # tower mast (Turmmast): near-constant oval section rising from the upper bridge to the foretop
    tz0, tz1 = 23.5, 31.8 if not burnt else 29.0
    bm = bmesh.new()
    rings = []
    for z, hw, hl in ((17.2, 4.2, 4.8), (tz0, 4.1, 4.7), (tz1, 3.9, 4.45)):
        rings.append([V((hw * math.copysign(abs(math.cos(t)) ** 0.6, math.cos(t)), -35.5 + hl * math.copysign(abs(math.sin(t)) ** 0.6, math.sin(t)), z))
                      for t in (2 * math.pi * k / 20 + 0.08 for k in range(20))])
    C.loft_bm(bm, rings, close_end=True)
    np_(bm, 'super', 'tower_mast')
    for z in (25.6, 28.6):                                 # platform rings + rails round the tower
        NP('super', cyl, (0, -35.5, z - 0.2), (0, -35.5, z), 5.1, 16, name='tower_gallery')
        if not burnt:
            N.rail([(5.0 * math.cos(t), -35.5 + 5.0 * math.sin(t), z) for t in (math.pi * k / 8 for k in range(17))], 1.0, 1.4, key='super', wires=2, lod2=False)
    for k in range(4):                                     # scuttles / vision ports on the tower
        NP('black', box, (0, -40.22, 24.6 + 2.2 * k), (1.0, 0.1, 0.5), name='tower_port', lod='drop')
    if not burnt:
        NP('super', cyl, (0, -35.5, 31.8), (0, -35.5, 32.2), 5.3, 18, name='foretop_platform')
        NP('super', cyl, (0, -35.5, 32.2), (0, -35.5, 34.5), 3.8, 18, name='foretop')
        rangefinder('rf_foretop', V((0, -35.5, 34.5)), arm=5.25, r=2.6, hood=True)
        NP('dark', cyl, (0, -34.2, 36.9), (0, -34.2, 45.5), 0.35, 8, r1=0.2, name='foremast')
        NP('dark', cyl, (-4, -34.2, 43.0), (4, -34.2, 43.0), 0.15, 6, name='fore_yard')
    else:
        foretop_wreck()
    for sx in (-1, 1):                                     # searchlight platforms on the tower sides
        NP('super', box, (sx * 5.9, -33.5, 26.6), (3.0, 3.0, 0.3), name='searchlight_platform')
        if not burnt:
            NP('super', cyl, (sx * 6.1, -33.5, 26.75), (sx * 6.1, -33.5, 28.2), 0.9, 10, name='searchlight_fwd')
            VH.light('searchlight_fwd_%s' % ('l' if sx > 0 else 'r'), (sx * 5.6, -34.5, 27.5), (0, -1, 0), True, kind='searchlight')
            N.rail([(sx * 4.5, -34.9, 26.75), (sx * 7.3, -34.9, 26.75), (sx * 7.3, -32.1, 26.75)], 1.0, 1.2, key='super', wires=2, lod2=False)
    # aft structure on the 02 block: after control position with its own bridge level
    block('aft_03', 34.0, 44.0, 5.2, 14.0, 17.2, front_hw=4.6)
    win_band(34.1, 40.0, 4.9, 16.3, 0.7)
    # funnel with cap and searchlight platform, boat cranes, boats
    bm = bmesh.new()
    rings = []
    for z, sc, dy in ((11.0, 1.0, 0.0), (20.0, 0.97, 0.65), (27.6, 0.93, 1.3)):
        rings.append([V((4.2 * sc * math.cos(t), -5.0 + dy + 6.8 * sc * math.sin(t), z)) for t in (2 * math.pi * k / 20 for k in range(20))])
    C.loft_bm(bm, rings, close_end=False)
    np_(bm, 'super', 'funnel', smooth=True)
    if not burnt:
        # funnel cap: flared cowl with a rolled rim, black throat and the radial/cross grille over the uptakes
        ct = V((0, -3.7, 27.5))
        bm = bmesh.new()
        rr = [[ct + V((rx * math.cos(t), ry * math.sin(t), dz)) for t in (2 * math.pi * k / 24 for k in range(24))]
              for rx, ry, dz in ((4.0, 6.5, 0.0), (4.3, 6.9, 0.9), (4.2, 6.8, 1.2))]
        C.loft_bm(bm, rr, close_start=False, close_end=False)
        np_(bm, 'dark', 'funnel_cap', smooth=True)
        NP('black', cyl, ct + V((0, 0, 0.3)), ct + V((0, 0, 0.35)), 3.9, 20, name='funnel_mouth')
        bm = bmesh.new()
        for k in range(-5, 6):
            C.beam_bm(bm, ct + V((k * 0.72, -6.5 * math.sqrt(max(0.05, 1 - (k * 0.72 / 4.0) ** 2)), 1.0)),
                      ct + V((k * 0.72, 6.5 * math.sqrt(max(0.05, 1 - (k * 0.72 / 4.0) ** 2)), 1.0)), 0.12, 0.25)
        for k in range(-4, 5):
            C.beam_bm(bm, ct + V((-4.0 * math.sqrt(max(0.05, 1 - (k * 1.4 / 6.5) ** 2)), k * 1.4, 1.1)),
                      ct + V((4.0 * math.sqrt(max(0.05, 1 - (k * 1.4 / 6.5) ** 2)), k * 1.4, 1.1)), 0.1, 0.12)
        np_(bm, 'dark', 'funnel_grille', lod='drop2')
    else:                                                # cap + grille blown off: black open uptake, torn rim
        NP('black', cyl, (0, -3.7, 27.2), (0, -3.7, 27.3), 3.8, 20, name='funnel_mouth')
        bm = bmesh.new()
        for k in range(12):
            t = 2 * math.pi * k / 12
            p0 = V((3.9 * math.cos(t), -3.7 + 6.3 * math.sin(t), 27.55))
            h = 0.4 + 1.2 * ((k * 5) % 4) / 3
            C.quad(bm, [p0 + V((-math.sin(t) * 1.4, math.cos(t) * 1.6, 0)), p0 - V((-math.sin(t) * 1.4, math.cos(t) * 1.6, 0)),
                        p0 + V((math.cos(t) * 0.4, math.sin(t) * 0.5, h)), p0 + V((math.cos(t) * 0.2, math.sin(t) * 0.3, h * 0.7))])
        N._thicken(bm, 0.08)
        np_(bm, 'super', 'funnel_torn_rim')
    for sx in (-1, 1):                                   # siren / steam pipes up the funnel's aft face
        NP('metal', cyl, (sx * 1.2, 2.6, 11.0), (sx * 1.2, 3.3, 28.5), 0.22, 8, name='steam_pipe')
    VH.emitter('funnel_smoke', (0, -3.7, 28.7), (0, 0.3, 1), kind2='boiler smoke (steam up)')
    NP('super', cyl, (0, -4.6, 19.8), (0, -4.6, 20.2), 6.3, 20, name='funnel_platform')
    for k in range(4):                                   # 4 searchlight platforms (150 cm) cantilevered round the funnel
        a = math.radians(45 + 90 * k)
        p = V((7.0 * math.cos(a), -4.6 + 8.0 * math.sin(a), 20.2))
        NP('super', cyl, p - V((0, 0, 0.4)), p, 2.0, 12, name='searchlight_platform')
        NP('dark', beam, p - V((0, 0, 0.3)), V((4.0 * math.cos(a), -4.6 + 6.5 * math.sin(a), 17.8)), 0.3, 0.3, name='platform_strut')
        NP('super', cyl, p, p + V((0, 0, 0.7)), 0.5, 8, name='searchlight_pedestal')
        NP('super', cyl, p + V((-0.9 * math.cos(a), -0.9 * math.sin(a), 1.4)), p + V((0.7 * math.cos(a), 0.7 * math.sin(a), 1.4)), 0.85, 12, name='searchlight_funnel')
        NP('dark', cyl, p + V((0.7 * math.cos(a), 0.7 * math.sin(a), 1.4)), p + V((0.78 * math.cos(a), 0.78 * math.sin(a), 1.4)), 0.8, 12, name='searchlight_shutter', lod='drop')
        ring = [p + V((1.9 * math.cos(t), 1.9 * math.sin(t), 0)) for t in (a + math.radians(d) for d in range(-110, 111, 44))]
        N.rail([tuple(q) for q in ring], 1.0, 1.4, key='super', wires=2, lod2=False)
        VH.light('searchlight_funnel_%d' % k, tuple(p + V((0.8 * math.cos(a), 0.8 * math.sin(a), 1.4))), (math.cos(a), math.sin(a), 0), True, kind='searchlight')
    for sx in (-1, 1):
        cp = V((sx * 10.3, 0.0, 11.0))
        NP('super', cyl, cp, cp + V((0, 0, 7.0)), 0.7, 10, name='crane_post')
        n = 'crane_' + ('l' if sx > 0 else 'r')
        NP('super', beam, cp + V((0, 0, 6.5)), cp + V((sx * -2.5, -9.0, 10.5)), 0.6, 0.8, name='crane_jib', node=n, pivot=tuple(cp))
        NP('dark', cyl, cp + V((sx * -2.5, -9.0, 10.3)), cp + V((sx * -2.5, -9.0, 4.0)), 0.05, 4, name='crane_hook_line', node=n, pivot=tuple(cp), lod='drop')
        VH.moving(n, 'crane_yaw', cp, (0, 0, 1), limits=(-170, 170))
    # boat deck abreast the funnel (above the 15 cm turrets): pinnaces / launches / cutters on chocks, crane-served
    for sx in (-1, 1):
        NP('super', box, (sx * 6.3, -2.0, 13.95), (3.9, 24.0, 0.3), name='boat_deck')
        for y in (-12.5, -4.0, 4.5):
            NP('super', cyl, (sx * 7.6, y, 11.0), (sx * 7.6, y, 13.8), 0.3, 8, name='boat_deck_pillar')
        N.rail([(sx * 8.2, -14.0, 14.1), (sx * 8.2, 10.0, 14.1)], 1.0, 1.6, key='super', wires=2, lod2=False)
        for yb, L, bw in ((-9.5, 9.0, 1.3), (-0.5, 8.0, 1.2), (6.8, 6.0, 1.05)):
            if burnt and yb > 0:
                continue
            z0 = 14.3
            bm = bmesh.new()
            VH.body_loft(bm, [(yb - L / 2, 0.15, z0 + 0.3, z0 + 1.3, 0.1), (yb - L / 2 + 1.2, bw * 0.85, z0 + 0.05, z0 + 1.35, 0.35),
                              (yb + L / 2 - 1.5, bw, z0 + 0.05, z0 + 1.3, 0.35), (yb + L / 2, bw * 0.75, z0 + 0.25, z0 + 1.25, 0.2)], n=2)
            VH.xf_bm(bm, Matrix.Translation((sx * 6.0, 0, 0)))
            np_(bm, 'boat' if not burnt else 'dark', 'ships_boat', smooth=True)
            NP('dark', box, (sx * 6.0, yb, z0 + 1.33), (bw * 1.9, L * 0.8, 0.08), name='boat_gunwale')
            if not burnt:
                NP('tarcanvas', box, (sx * 6.0, yb + 0.3, z0 + 1.42), (bw * 1.6, L * 0.55, 0.12), name='boat_cover')
            for yc in (yb - L * 0.3, yb + L * 0.3):
                NP('dark', box, (sx * 6.0, yc, z0 + 0.1), (bw * 1.7, 0.3, 0.3), name='boat_chock')
            # radial boat davit pair (for the cutters) swung in over each boat
            for yd in (yb - L * 0.38, yb + L * 0.38):
                bm = bmesh.new()
                pts = [V((sx * 8.0, yd, 14.1)), V((sx * 8.0, yd, 17.0)), V((sx * 7.3, yd, 17.8)), V((sx * 6.2, yd, 17.7))]
                for q0, q1 in zip(pts[:-1], pts[1:]):
                    C.cyl_bm(bm, q0, q1, 0.13, 4)
                np_(bm, 'super', 'boat_davit')
                NP('dark', cyl, (sx * 6.2, yd, 17.6), (sx * 6.1, yd, z0 + 1.4), 0.03, 4, name='davit_fall', lod='drop')


def aft_and_guns(var):
    burnt = var == 'burnt'
    # cross-deck catapult, hangar + mainmast, aft superstructure + aft fire-control station
    NP('dark', box, (0, 15.0, 11.4), (32.0, 1.4, 0.8), name='catapult')
    NP('dark', box, (0, 15.0, 11.9), (2.6, 3.0, 0.4), name='catapult_trolley', lod='drop')
    house('hangar', 19, 33, 6.5, 6.5, 11.0, 16.0)
    NP('dark', box, (0, 19.0, 13.2), (8.0, 0.1, 4.2), name='hangar_door', node='hangar_door', pivot=(0, 19.0, 11.0))
    VH.moving('hangar_door', 'door', (0, 19.0, 11.0), (1, 0, 0), limits=(0, 80), note='roller door: slide up')
    if not burnt:
        NP('dark', cyl, (0, 26.0, 16.0), (0, 26.0, 36.0), 0.7, 10, r1=0.35, name='mainmast')
    else:                                                # mainmast shot through above the platform, top hanging over
        NP('dark', cyl, (0, 26.0, 16.0), (0, 26.0, 27.0), 0.7, 10, r1=0.5, name='mainmast')
        NP('dark', cyl, (0, 26.0, 27.0), (3.5, 33.0, 21.0), 0.45, 8, r1=0.3, name='mainmast_fallen')
    for sx in (-1, 1):                                   # tripod-like legs bracing the mainmast base on the hangar roof
        NP('dark', cyl, (sx * 4.6, 30.5, 16.0), (0, 26.3, 24.5), 0.4, 8, r1=0.3, name='mainmast_leg')
    NP('super', box, (0, 26.0, 24.4), (4.2, 3.6, 0.3), name='mainmast_platform')
    NP('dark', cyl, (0, 23.5, 16.0), (0, 25.8, 22.0), 0.35, 8, name='mainmast_strut')
    # two Arado Ar 196 on the athwartships catapult, noses outboard
    arado196((-8.5, 15.0, 12.0), (-1, 0, 0), burnt)
    if not burnt:
        arado196((8.5, 15.0, 12.0), (1, 0, 0), burnt)
    # 2 cm single Flak C/38 x 12 round the superstructure decks
    for sx in (-1, 1):
        for x, y, z in ((9.0, -46.0, 14.1), (5.6, -16.5, 14.1), (9.2, -13.0, 11.0), (9.4, 10.5, 11.0), (7.2, 39.0, 11.0), (5.6, 21.5, 16.0)):
            light_flak_2cm((sx * x, y, z), -90 if sx < 0 else 90)
    if not burnt:
        NP('dark', cyl, (-5, 26.0, 31.0), (5, 26.0, 31.0), 0.2, 6, name='main_yard')
    NP('super', cyl, (0, 41.0, 17.2), (0, 41.0, 21.6), 3.0, 14, name='aft_fc_tower')
    rangefinder('rf_aft', V((0, 41.0, 21.6)))
    # main battery: Anton, Bruno (superfiring) forward; Caesar (superfiring), Dora aft
    turret('turret_anton', V((0, -80.0, deck_z(-80) + 1.2)), 0, zb_h=1.2)
    turret('turret_bruno', V((0, -63.0, deck_z(-63) + 4.4)), 0, zb_h=4.4)
    turret('turret_caesar', V((0, 57.0, deck_z(57) + 4.4)), 180, zb_h=4.4)
    turret('turret_dora', V((0, 75.0, deck_z(75) + 1.2)), 180, zb_h=1.2)
    # 15 cm secondaries (twin, 3 per side) and 10.5 cm Flak (twin, 4 per side)
    for sx in (-1, 1):
        s = 'l' if sx > 0 else 'r'
        for i, (y, z, yaw) in enumerate(((-30.0, 11.0, 0), (-8.0, 11.0, 90 * sx), (32.0, 11.0, 180))):
            turret('sec15_%s%d' % (s, i), V((sx * 9.2, y, z)), yaw if i != 1 else (-90 if sx < 0 else 90), size=0.52, barrel=8.2, br=0.24, roof='roof', rf=True, zb_h=0.6)
        for i, y in enumerate((-19.0, 3.5, 22.0, 30.0)):
            if i == 3:
                continue
            flak_mount('flak105_%s%d' % (s, i), V((sx * 10.2, y, 11.0)), -90 if sx < 0 else 90)
        flak_mount('flak105_%s3' % s, V((sx * 10.0, -52.0, deck_z(-52) + 0.1)), -90 if sx < 0 else 90)
    # light Flak: 3.7 cm twin (SK C/30) and 2 cm single / quad mounts on the superstructure decks
    for sx in (-1, 1):
        for i, (x, y, z) in enumerate(((6.0, -20.5, 14.1), (5.9, 35.5, 14.1), (7.7, -32.0, 17.3), (8.5, 40.0, 11.0))):
            flak37('flak37_%s%d' % ('l' if sx > 0 else 'r', i), V((sx * x, y, z)), -90 if sx < 0 else 90)
    # scuttles: two rows along the hull sides
    for sx in (-1, 1):
        bm = bmesh.new()
        for row, zz in ((0, 3.2), (1, 5.4)):
            for y in range(-100, 110, 4):
                if row == 0 and not (-80 < y < 90):
                    continue
                yy = y + 2 * row
                x = hx(yy, zz) + 0.04
                q = [V((sx * x, yy - 0.2, zz - 0.2)), V((sx * x, yy + 0.2, zz - 0.2)), V((sx * x, yy + 0.2, zz + 0.2)), V((sx * x, yy - 0.2, zz + 0.2))]
                C.quad(bm, q if sx > 0 else list(reversed(q)))
        np_(bm, 'black', 'scuttles', lod='drop', grime=0.3)
    # rails along the main deck edge, bollards
    for sx in (-1, 1):
        pts = [(sx * (half_beam(y) - 0.4), y, deck_z(y)) for y in range(-118, 121, 8)]
        N.rail(pts, 1.1, 4.4, key='super', wires=1, lod='drop2')
        for y in (-105, -70, 64, 100):
            N.bollard((sx * (half_beam(y) - 1.4), y, deck_z(y)), 0.35, 0.7, 1.1, yaw=90)
    NP('dark', cyl, (0, 110.0, deck_z(110)), (0, 110.0, deck_z(110) + 1.0), 0.9, 12, name='capstan_aft')


def flak37(name, pos, yaw):
    """3.7 cm SK C/30 twin on a stabilised mount: small open mount with shield (node yaw) + barrels (pitch)."""
    T = N.Tf(pos, yaw)
    kw = dict(node=name, pivot=tuple(pos))
    NP('super', cyl, pos, V(pos) + V((0, 0, 0.9)), 0.8, 10, name=name + '_base', **kw)
    NP('super', box, T((0, -0.2, 1.3)), (1.8, 0.1, 0.9), math.radians(yaw), name=name + '_shield', **kw)
    VH.moving(name, 'gun_yaw', pos, (0, 0, 1), limits=(-170, 170))
    tp = V(T((0, 0.0, 1.2)))
    for dx in (-0.35, 0.35):
        NP('gunmetal', cyl, V(T((dx, 0.3, 1.2))), V(T((dx, -2.9, 1.2))), 0.06, 6, name=name + '_barrel', node=name + '_guns', pivot=tuple(tp))
    VH.moving(name + '_guns', 'gun_pitch', tp, V(T((1, 0, 0))) - V(T((0, 0, 0))), limits=(-10, 85), parent=name)


def arado196(pos, heading, burnt=False):
    """Arado Ar 196 A-3 shipboard floatplane (L 11.0 m, span 12.4 m): fuselage, BMW 132 cowling + 2-blade prop, wings
    with Balkenkreuz, twin floats on N-struts, tailplane + fin. heading = unit vector of the nose (plan)."""
    h = V(heading).normalized()
    side = V((-h.y, h.x, 0))
    P0 = V(pos)

    def W(f, s_, z):                  # local (forward, side, up) -> world
        return P0 + h * f + side * s_ + V((0, 0, z))
    k = 'ara' if not burnt else 'dark'
    st = [(5.3, 0.55, 0.55), (4.7, 0.62, 0.62), (3.0, 0.58, 0.7), (0.5, 0.5, 0.72), (-2.5, 0.35, 0.5), (-5.6, 0.1, 0.25)]
    bm = bmesh.new()
    rings = [[W(f, w * math.cos(t), 2.6 + hgt * math.sin(t)) for t in (2 * math.pi * j / 10 for j in range(10))] for f, w, hgt in st]
    C.loft_bm(bm, rings)
    np_(bm, k, 'arado_fuselage', smooth=True)
    NP('dark', cyl, W(5.3, 0, 2.6), W(5.7, 0, 2.6), 0.62, 12, name='arado_cowl')
    NP('glass' if not burnt else 'soot', box, W(1.6, 0, 3.35), (0.9, 0.9, 0.35), name='arado_canopy', lod='drop')
    if not burnt:
        for a in (0, math.pi):
            NP('dark', beam, W(5.8, 0, 2.6), W(5.8, 1.4 * math.cos(a), 2.6 + 1.4 * math.sin(a)), 0.18, 0.04, name='arado_prop')
    for sgn in (-1, 1):
        bm = bmesh.new()
        C.quad(bm, [W(3.9, sgn * 0.4, 2.35), W(3.7, sgn * 6.2, 2.55), W(2.6, sgn * 6.2, 2.55), W(2.0, sgn * 0.4, 2.35)])
        N._thicken(bm, 0.14)
        np_(bm, k, 'arado_wing')
        if not burnt:
            VH.balkenkreuz(W(3.0, sgn * 4.4, 2.57 + 0.08), (0, 0, 1), 0.9)
        NP(k, box, W(-4.9, sgn * 1.1, 2.75), (2.2, 0.9, 0.07) if abs(h.x) < 0.5 else (0.9, 2.2, 0.07), name='arado_tailplane')
        # float + struts
        bm = bmesh.new()
        fr = [[W(f, sgn * 1.7 + r * math.cos(t), 0.55 + r * 0.8 * math.sin(t)) for t in (2 * math.pi * j / 8 for j in range(8))]
              for f, r in ((5.4, 0.05), (4.8, 0.36), (2.5, 0.42), (-0.5, 0.3), (-1.6, 0.05))]
        C.loft_bm(bm, fr)
        np_(bm, k, 'arado_float', smooth=True)
        for f in (3.9, 2.3):
            NP('dark', beam, W(f, sgn * 1.7, 0.85), W(f - 0.3, sgn * 1.2, 2.35), 0.08, 0.08, name='arado_strut')
    NP(k, beam, W(-4.6, 0, 2.8), W(-5.6, 0, 3.9), 0.08, 0.9, name='arado_fin')


def light_flak_2cm(pos, yaw):
    """2 cm Flak C/38 single on its pedestal with a curved splinter shield (static dressing)."""
    T = N.Tf(pos, yaw)
    NP('dark', cyl, pos, V(pos) + V((0, 0, 0.9)), 0.18, 5, name='flak20_pedestal', lod='drop2')
    NP('super', box, T((0, -0.35, 1.05)), (1.0, 0.06, 0.8), math.radians(yaw), name='flak20_shield', lod='drop2')
    NP('gunmetal', cyl, T((0, 0.3, 1.1)), T((0, -1.7, 1.25)), 0.05, 4, name='flak20_barrel', lod='drop')
    NP('gunmetal', box, T((0, 0.25, 1.1)), (0.18, 0.6, 0.22), math.radians(yaw), name='flak20_receiver', lod='drop')


def foretop_wreck():
    """Final-battle damage aloft: tower mast torn open at 29 m, foretop knocked askew and burnt out, rangefinder hood
    and foremast gone, plating petalled round the stump."""
    c = V((0, -35.5, 29.0))
    bm = bmesh.new()
    for k in range(10):                                   # jagged torn plates round the stump
        t = 2 * math.pi * k / 10
        p0 = c + V((3.2 * math.cos(t), 3.9 * math.sin(t), 0))
        h = 0.8 + 1.6 * ((k * 7) % 5) / 4
        o = V((math.cos(t), math.sin(t), 0)) * (0.3 + 0.5 * (k % 3) / 2)
        C.quad(bm, [p0 - V((-math.sin(t), math.cos(t), 0)) * 0.9, p0 + V((-math.sin(t), math.cos(t), 0)) * 0.9, p0 + o + V((0, 0, h)), p0 + o * 0.5 + V((0, 0, h * 0.6))])
    N._thicken(bm, 0.1)
    np_(bm, 'super', 'tower_torn_plates')
    bm = bmesh.new()                                      # the foretop drum, knocked over and hanging off the stump
    C.cyl_bm(bm, c + V((0.6, 0.2, 0.3)), c + V((2.4, 1.3, 2.3)), 3.1, 16)
    bm.transform(Matrix.Translation((0, 0, 0)))
    np_(bm, 'super', 'foretop_wreck')
    NP('black', cyl, c + V((2.4, 1.3, 2.31)), c + V((2.45, 1.33, 2.36)), 2.8, 16, name='foretop_gutted', lod='drop')
    NP('black', cyl, c + V((0, 0, -0.2)), c + V((0, 0, 0.05)), 3.0, 16, name='tower_stump_hole')
    NP('dark', cyl, c + V((-1.0, 1.0, 1.0)), c + V((-5.5, 4.0, -3.5)), 0.3, 8, r1=0.2, name='foremast_fallen')


def funnel_ring(z):
    """Funnel section scale + aft offset at height z (matches the funnel loft)."""
    if z < 20.0:
        f = (z - 11.0) / 9.0
        return 1.0 - 0.03 * f, 0.65 * f
    f = (z - 20.0) / 7.6
    return 0.97 - 0.04 * f, 0.65 + 0.65 * f


def wreck_topsides():
    """Shell hits: black holes torn in the superstructure walls and funnel, gutted bridge windows, twisted plates."""
    holes = [(-1, -40.0, 12.5, 2.2, 1.3, lambda y, z: 6.4), (1, -22.0, 12.3, 1.8, 1.1, lambda y, z: 6.4), (1, -44.0, 15.6, 2.0, 1.2, lambda y, z: 8.2),
             (-1, -33.0, 18.8, 1.6, 1.0, lambda y, z: 7.2), (-1, 25.0, 12.6, 2.0, 1.2, lambda y, z: 6.4), (1, 38.0, 15.8, 1.5, 1.0, lambda y, z: 5.2),
             (1, -45.0, 9.5, 2.4, 1.3, lambda y, z: 11.8), (-1, 5.0, 9.6, 2.0, 1.1, lambda y, z: 11.8)]
    for sx, yc, zc, ry, rz, hxf in holes:
        bm = bmesh.new()
        pts = [(yc + ry * math.cos(t) * (1 + 0.3 * math.sin(3 * t + yc)), zc + rz * math.sin(t) * (1 + 0.25 * math.cos(5 * t)))
               for t in (2 * math.pi * k / 12 for k in range(12))]
        N.hull_hole(bm, pts, sx, hxf, depth=0.06)
        VH.vp(bm, 'black', 'shell_hole')
    for k, (yc, zc, a0) in enumerate(((-5.5, 22.0, 0.4), (-2.0, 17.0, 2.2), (-7.0, 25.2, 4.0))):    # funnel holed
        bm = bmesh.new()
        for j in range(10):
            t = 2 * math.pi * j / 10
            z = zc + 1.2 * math.sin(t)
            sc, dy = funnel_ring(z)
            a = a0 + 0.22 * math.cos(t) * (1 + 0.3 * math.sin(3 * t))
            bm.verts.new(V((4.2 * sc * math.cos(a) * 1.012, -5.0 + dy + 6.8 * sc * math.sin(a) * 1.012, z)))
        bm.faces.new(bm.verts[:])
        VH.vp(bm, 'black', 'funnel_hole')


def torpedo_breach():
    """Burnt: torpedo hit on the starboard bow (-X) - ragged hole in the side plating, dark flooded compartments behind it,
    shell plates petalled outward, scorched forecastle deck with buckled plates."""
    yc, zc = -93.0, 7.5
    bm = bmesh.new()
    ring = []
    for k in range(18):
        t = 2 * math.pi * k / 18
        r = 1.0 + 0.28 * math.sin(3 * t + 0.7) + 0.18 * math.sin(7 * t)
        y, z = yc + 4.6 * r * math.cos(t), zc + 2.7 * r * math.sin(t)
        ring.append(V((-(hx(y, z) + 0.05), y, z)))
    c = V((-(hx(yc, zc) + 0.12), yc, zc))
    cv = bm.verts.new(c)
    inner = [bm.verts.new(c.lerp(q, 0.55) - V((0.1, 0, 0))) for q in ring]
    vs = [bm.verts.new(q - V((0.07, 0, 0))) for q in ring]
    for i in range(len(vs)):
        j = (i + 1) % len(vs)
        bm.faces.new((cv, inner[j], inner[i]))
        bm.faces.new((inner[i], inner[j], vs[j], vs[i]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.x > 0:
            f.normal_flip()
    np_(bm, 'black', 'breach_hole', grime=0.0)
    # scorched, rust-streaked plating round the hole (burn field) + oil slick streak down to the waterline
    for k in range(0, 18, 2):                            # petalled plates bent outward round the rim
        a, b = ring[k], ring[(k + 1) % 18]
        o = (a + b) / 2 - c
        o = V((o.x * 0, o.y, o.z)).normalized()
        out = V((-1, 0, 0))
        bm = bmesh.new()
        C.quad(bm, [a, b, b + o * 1.6 + out * 1.6, a + o * 1.4 + out * 1.9])
        N._thicken(bm, 0.08)
        np_(bm, 'hull', 'torn_plate')
    for k, (x, y, rx) in enumerate(((-4.0, -100.0, 18), (3.0, -96.0, -22), (-7.5, -88.0, 25), (1.0, -104.0, 15))):
        bm = bmesh.new()
        C.quad(bm, [V((-1.8, -1.2, 0)), V((1.8, -1.2, 0)), V((1.6, 1.3, 0.3)), V((-1.7, 1.2, 0))])
        N._thicken(bm, 0.08)
        bm.transform(Matrix.Translation((x, y, deck_z(y) + 0.9)) @ Matrix.Rotation(math.radians(rx), 4, 'Y') @ Matrix.Rotation(math.radians(rx * 0.7), 4, 'X'))
        np_(bm, 'deck', 'buckled_deck_plate')


def main(var, out_root):
    N.setup('battleship_bismarck', var, PAL, scale=4.0, seed=61, heights=[-2.0, -0.4, 0.45, 2.0, 5.0, 12.0])
    burnt = var == 'burnt'
    N.BURN_L, N.BURN_MAXF = 10.0, 40
    N.RAIL_SEG, N.RAIL_R, N.RAIL_SP, N.BOLLARD_SEG = (3, 3), 1.6, 1.5, 5
    N.FIRE[:] = [(-16.0, -93.0, 8.0, 11.0), (0, -82.0, 13.0, 9.0), (0, -36.0, 20.0, 10.0), (0, -4.0, 20.0, 8.0),
                 (0, 15.0, 13.0, 8.0), (0, -60.0, 12.0, 6.0)] if burnt else []
    hull(var)
    if burnt:
        torpedo_breach()
    TURRETS.clear()
    superstructure(var)
    aft_and_guns(var)
    if burnt:      # after the final battle: turrets knocked off their training at random, barrels drooped, topsides holed
        wreck_topsides()
        rnd = {'turret_anton': (35, 7), 'turret_bruno': (-62, 11), 'turret_caesar': (48, 4), 'turret_dora': (-28, 9)}
        for k, (name, pos, yaw, sz) in enumerate(TURRETS):
            dyaw, droop = rnd.get(name, ((k * 37) % 70 - 35, 3 + k % 5))
            T = N.Tf(pos, yaw)
            tp = V(T((0, -3.6 * sz, 1.6 * sz)))
            N.pose([name + '_guns'], tp, droop, axis=tuple(V(T((1, 0, 0))) - V(T((0, 0, 0)))))
            N.pose([name, name + '_guns'], pos, dyaw)
    N.wake((0, 125.5, 0.0), (0, -123.0, 0.1), 36.0)
    for sx in (-1, 1):
        VH.emitter('prop_wash', (sx * 5.0, 110.0, -6.0), (0, 1, 0))
        VH.socket('gangway_%s' % ('l' if sx > 0 else 'r'), (sx * 18.2, 10.0, deck_z(10)), (sx, 0, 0), note='brow to the quay')
    VH.socket('torpedo_target', (0, -90.0, -3.0), (0, -1, 0), objective=True,
              note='M13 objective: torpedo hit zone on the forward hull (port or starboard, y -100..-80 m)')
    for i, (x, y) in enumerate(((-12, -95), (12, -95), (-14, 0), (14, 0), (-12, 95), (12, 95))):
        VH.socket('sentry_%d' % i, (x, y, deck_z(y)), (0, -1, 0), pose='stand_rifle')
    VH.emitter('fire', (0, -85.0, 10.0), (0, 0, 1), when='destroyed', note='forward magazine / torpedo hit')
    VH.emitter('secondary_explosions', (0, -60.0, 12.0), (0, 0, 1), when='destroyed')
    if burnt:      # torpedoed forward (starboard bow): down by the bow, 4.5 deg list to starboard, smoke columns
        VH.emitter('smoke', (0, -70.0, 16.0), (0, 0, 1), kind2='wreck_smoke_column')
        VH.emitter('smoke', (0, -5.0, 27.0), (0, 0, 1), kind2='wreck_smoke_column')
        VH.apply_T(Matrix.Translation((0, 0, -0.6)) @ Matrix.Rotation(math.radians(2.0), 4, 'X') @ Matrix.Rotation(math.radians(-4.5), 4, 'Y'))
    dims = {'length': 251.0, 'beam': 36.0, 'draft': 9.3, 'freeboard_midships': 8.0, 'freeboard_bow': 14.2,
            'main_battery': '4 x 2 x 38 cm SK C/34', 'secondary': '6 x 2 x 15 cm', 'flak': '8 x 2 x 10.5 cm'}
    par = {}
    for m in VH.VM['moving']:
        if m.get('parent'):
            par[m['node']] = m['parent']
    N.finalize(out_root, 'battleship_bismarck', 'battleship', dims, 9.3, var, ALL, 'Bismarck-class battleship (replica, 1941 fit)',
               extra={'catalogue': 'battleship_replica', 'objective_socket': 'torpedo_target', 'crew': 2065,
                      'staging': {
                          'decision': 'TRUE SCALE, never rescaled: M13 is laid out around the ship, not the ship around the map',
                          'placement': 'moored port side (+X) to the north quay of the battleship basin, bow (+Z) toward the '
                                       'lock / torpedo approach; the basin water must reach >= 45 m off its starboard side',
                          'map_extent_m': [300, 110],
                          'playfield': 'only the forward 60 m (bow, Anton, breakwater, forecastle sentries, torpedo_target) '
                                       'is walkable/visible at 1x-2x; the rest is a block footprint (HIGH) running along the quay',
                          'camera': '40 px/m at 1x shows ~48 x 27 m: the bow fills ~1 screen; mission intro pans the full length '
                                    'at the dedicated zoom-out 0.2x (8 px/m, 2000 px) with LOD1/LOD2',
                          'lod_rule': 'LOD0 within 120 m of the camera focus, LOD1 to 300 m, LOD2 beyond / intro pan'}},
               ao_res=1024 if not burnt else 768, ao_dist=8.0, parents=par, lods=((0.58, 0.3), (0.32, 0.8)))


if __name__ == '__main__':
    N.run(main, ALL)
