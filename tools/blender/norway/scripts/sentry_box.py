"""Schilderhaus (German sentry box) for guard_hut b - rework 2: concrete plinth, timber floor, framed box with
proud corner posts, recessed plank panels, vision slits with reveals and hinged flaps on both sides, frieze board,
overhanging pyramid roof of sheet steel with hip rolls, fascia and finial; black-white-red chevrons run continuously
round posts and panels (stripes are bisected geometry, so they stay crisp at every zoom)."""
import math
import bmesh
from mathutils import Vector as V
import nlib as N
from nlib import K, C

COLS = [(0.05, 0.05, 0.05), (0.88, 0.88, 0.85), (0.6, 0.08, 0.06)]
import nfx as _F
_F.LOD_DROP[1] = _F.LOD_DROP[1] + ('plank_joints', 'phone_cable')
_F.LOD_DROP[2] = _F.LOD_DROP[2] + ('plank_joints', 'phone_', 'seat', 'slit_reveals', 'roof_trim', 'duckboard', 'frieze')
PER = 0.22


def _perim(p, S):
    """Unrolled perimeter coordinate W wall -> back -> E wall -> front lintel."""
    h = S / 2
    ax, ay = abs(p.x), abs(p.y)
    if p.x < -h + 0.07 and ax >= ay - 0.02:
        return p.y + h
    if p.y > h - 0.07:
        return S + (p.x + h)
    if p.x > h - 0.07:
        return 2 * S + (h - p.y)
    return 3 * S + (h - p.x)


def _striped(bm, S, name, dirs):
    """Bisect bm with 45-deg planes z + s = j*PER per wall direction (dirs = list of (dirv, s_offset)), part it
    and colour faces by stripe index."""
    for dirv, off in dirs:
        nrm = (dirv + V((0, 0, 1))).normalized()
        for j in range(-12, 50):
            const = j * PER - off
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, const), plane_no=nrm)
    ob = K.part(bm, 'wood_paint', name=name, bisect=False, grime=0.5, lod='keep')
    N._face_colors(ob, lambda p: COLS[int(math.floor((p.z + _perim(p, S)) / PER)) % 3])
    return ob


def build(r, snow=False):
    S, ZF, ZE = 1.2, 0.16, 2.35
    h = S / 2
    x0, x1, y0, y1 = -h, h, -h, h
    # plinth + floor
    bm = K.bm_new()
    K.box_bm(bm, (0, 0.05, 0.06), (1.6, 1.7, 0.12), taper=(0.96, 0.96))
    K.part(bm, 'concrete_bunker', name='plinth')
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, ZF - 0.02), (S - 0.1, S - 0.1, 0.05))
    K.part(bm, 'deck_planks', name='floor', uv='beam', axis=(1, 0, 0))
    # wall panels (set back 0.03 from the post faces), W/E with vision slits (z 1.45..1.62, y -0.18..0.18)
    t = 0.045
    zs0, zs1, ys0, ys1 = 1.45, 1.62, -0.18, 0.18
    # per-wall stripe coordinate s(p) = a + p.dirv; bisect planes z + p.dirv = j*PER - a
    dir_w, off_w = V((0, 1, 0)), h            # W: s = p.y + h
    dir_b, off_b = V((1, 0, 0)), S + h        # back: s = S + p.x + h
    dir_e, off_e = V((0, -1, 0)), 2 * S + h   # E: s = 2S + h - p.y
    dir_f, off_f = V((-1, 0, 0)), 3 * S + h   # front: s = 3S + h - p.x
    for side, dv, off in ((-1, dir_w, off_w), (1, dir_e, off_e)):
        bm = K.bm_new()
        xc = side * (h - 0.03 - t / 2)
        K.box_bm(bm, (xc, 0, (ZF + zs0) / 2), (t, S - 0.2, zs0 - ZF))
        K.box_bm(bm, (xc, 0, (zs1 + ZE - 0.16) / 2), (t, S - 0.2, ZE - 0.16 - zs1))
        K.box_bm(bm, (xc, (ys0 - h + 0.1) / 2, (zs0 + zs1) / 2), (t, ys0 + h - 0.1, zs1 - zs0))
        K.box_bm(bm, (xc, (ys1 + h - 0.1) / 2, (zs0 + zs1) / 2), (t, h - 0.1 - ys1, zs1 - zs0))
        _striped(bm, S, 'panel_%s' % ('w' if side < 0 else 'e'), [(dv, off)])
    bm = K.bm_new()
    K.box_bm(bm, (0, h - 0.03 - t / 2, (ZF + ZE - 0.16) / 2), (S - 0.2, t, ZE - 0.16 - ZF))
    _striped(bm, S, 'panel_back', [(dir_b, off_b)])
    # corner posts (proud) + front lintel, striped continuously
    bm = K.bm_new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            K.box_bm(bm, (sx * (h - 0.05), sy * (h - 0.05), (ZF + ZE) / 2), (0.1, 0.1, ZE - ZF))
    K.box_bm(bm, (0, y0 + 0.05, ZE - 0.15), (S - 0.2, 0.1, 0.22))
    _striped(bm, S, 'posts', [(dir_w, off_w), (dir_e, off_e), (dir_b, off_b), (dir_f, off_f)])
    # plank joints on the panels (thin dark grooves read as boards), slit reveals + hinged flaps
    bm = K.bm_new()
    for side in (-1, 1):
        xo = side * (h - 0.03 + 0.002)
        for k in range(1, 5):
            yy = -h + 0.1 + k * (S - 0.2) / 5
            if ys0 - 0.02 < yy < ys1 + 0.02:
                continue
            K.box_bm(bm, (xo, yy, (ZF + ZE - 0.16) / 2), (0.006, 0.012, ZE - 0.16 - ZF))
    for k in range(1, 5):
        xx = -h + 0.1 + k * (S - 0.2) / 5
        K.box_bm(bm, (xx, h - 0.03 + 0.002, (ZF + ZE - 0.16) / 2), (0.012, 0.006, ZE - 0.16 - ZF))
    K.part(bm, 'timber_tarred', name='plank_joints', grime=0.2)
    bm = K.bm_new()
    for side in (-1, 1):
        xc = side * (h - 0.03 - t / 2)
        K.box_bm(bm, (xc, 0, zs0 - 0.015), (t + 0.05, ys1 - ys0 + 0.06, 0.03))       # sill
        K.box_bm(bm, (xc, 0, zs1 + 0.015), (t + 0.05, ys1 - ys0 + 0.06, 0.03))       # head
        for yy in (ys0 - 0.015, ys1 + 0.015):
            K.box_bm(bm, (xc, yy, (zs0 + zs1) / 2), (t + 0.05, 0.03, zs1 - zs0))
    K.part(bm, 'timber_tarred', name='slit_reveals', grime=0.3, mat_tint=(0.5, 0.48, 0.45))
    bm = K.bm_new()
    for side in (-1, 1):                         # flap hinged at the head, propped open 35 deg
        a = math.radians(35)
        xo = side * (h - 0.03 + 0.02)
        p0 = V((xo, 0, zs1 + 0.03))
        p1 = p0 + V((side * math.sin(a) * 0.24, 0, -math.cos(a) * 0.24))
        K.beam_bm(bm, p0, p1, 0.42, 0.02, up=(side, 0, 0))
    _striped(bm, S, 'slit_flaps', [(dir_w, off_w), (dir_e, off_e)])
    # frieze + roof: overhanging steel pyramid, fascia, hip rolls, finial
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, ZE - 0.02), (S + 0.06, S + 0.06, 0.1))
    K.part(bm, 'timber_beam', name='frieze', mat_tint=(0.3, 0.3, 0.28))
    e, ap, th = h + 0.2, ZE + 0.62, 0.05
    bm = K.bm_new()
    top = [bm.verts.new((sx * e, sy * e, ZE + 0.06)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bot = [bm.verts.new((sx * e, sy * e, ZE + 0.06 - th)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    a1 = bm.verts.new((0, 0, ap))
    a0 = bm.verts.new((0, 0, ap - th * 1.3))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top[i], top[j], a1))
        bm.faces.new((bot[j], bot[i], a0))
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    K.part(bm, 'steel_painted', name='roof', mat_tint=(0.42, 0.46, 0.42), grime=0.6)
    bm = K.bm_new()
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        K.cyl_bm(bm, (sx * e, sy * e, ZE + 0.08), (0, 0, ap + 0.01), 0.018, 5)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        nx, ny = ((1, -1), (1, 1), (-1, 1), (-1, -1))[i]
        K.box_bm(bm, ((sx * e + nx * e) / 2, (sy * e + ny * e) / 2, ZE + 0.0), (abs(nx * e - sx * e) + 0.02 or 0.03,
                 abs(ny * e - sy * e) + 0.02 or 0.03, 0.1))
    K.cyl_bm(bm, (0, 0, ap - 0.02), (0, 0, ap + 0.16), 0.03, 8)
    K.cyl_bm(bm, (0, 0, ap + 0.16), (0, 0, ap + 0.24), 0.06, 8, r1=0.02)
    K.part(bm, 'steel_painted', name='roof_trim', mat_tint=(0.3, 0.32, 0.3), smooth=False, grime=0.4)
    # interior: bench, rifle hook, shelf; outside: lantern on the front post, field telephone on the E wall
    bm = K.bm_new()
    K.box_bm(bm, (0, h - 0.28, 0.62), (S - 0.25, 0.3, 0.05))
    for sx in (-0.4, 0.4):
        K.box_bm(bm, (sx, h - 0.28, 0.39), (0.05, 0.26, 0.45))
    K.box_bm(bm, (0, h - 0.14, 1.75), (0.6, 0.18, 0.03))
    K.part(bm, 'timber_grey', name='seat')
    K.wall_lantern((x1 - 0.05, y0 - 0.05, 0), (0, -1, 0), 2.0)
    bm = K.bm_new()
    K.box_bm(bm, (x1 + 0.12, 0.15, 1.25), (0.16, 0.3, 0.38))
    K.box_bm(bm, (x1 + 0.21, 0.15, 1.32), (0.03, 0.24, 0.26))
    K.part(bm, 'wood_paint', name='phone_box', mat_tint=(0.34, 0.37, 0.3))
    bm = K.bm_new()
    K.cyl_bm(bm, (x1 + 0.2, 0.15, 1.05), (x1 + 0.05, 0.4, 0.2), 0.008, 4)
    K.cyl_bm(bm, (x1 + 0.05, 0.4, 0.2), (x1 + 0.05, 1.6, 0.02), 0.008, 4)
    K.part(bm, 'cast_iron', name='phone_cable')
    # duckboard + worn trampled patch in front
    bm = K.bm_new()
    for i in range(6):
        K.box_bm(bm, (0, y0 - 0.25 - i * 0.2, 0.05), (1.3, 0.15, 0.04), rot_z=r.uniform(-0.02, 0.02))
    for sx in (-0.5, 0.5):
        K.box_bm(bm, (sx, y0 - 0.75, 0.015), (0.07, 1.25, 0.04))
    K.part(bm, 'timber_grey', name='duckboard', uv='beam', axis=(1, 0, 0))
    K.decal('dirt_splash', (0, y0 - 0.8, 0.01), (0, 0, 1), 1.8, 1.4, alpha=0.6)
    K.footprint(N.rect(-0.8, -0.8, 0.8, 0.9), 'HIGH', 'sentry_box')
    K.anchor('sentry_post', (0, 0, ZF), (0, -1, 0))
    K.roof_meta(N.rect(x0, y0, x1, y1), ZE, walkable=False, kind='pyramid')
    return ZE
