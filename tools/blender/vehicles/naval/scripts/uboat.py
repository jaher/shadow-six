# Type VIIC U-boat, early-1942 fit (Turm II with Wintergarten, 8.8 cm deck gun still carried), surfaced trim - M7 docked in the open finger pens (x2, objective:
# demolition charges at the stern torpedo room). blender -b ... --python uboat.py -- grey|winter|burnt|all
# Real dims: L 67.1 m, B 6.18 m, pressure hull 4.7 m, draught 4.74 m, height keel->bridge ~9.6 m; 8.8 cm SK C/35 deck
# gun, 2 cm Flak C/30 on the Wintergarten, 4 bow + 1 stern tubes, twin screws/rudders. Paint: Hellgrau 50 upper
# works, Dunkelgrau 51 casing deck edge, black-grey anti-fouling below the waterline. No unit emblems / flags.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['grey', 'winter', 'burnt']
VH.FLAT['oil'] = ((14, 13, 12), 0.2, 0.0)          # fuel-oil soaked, glossy black-brown
PAL_BURNT = {'hull': (66, 66, 64), 'super': (70, 70, 68), 'deck': (50, 48, 46), 'below': (44, 44, 46), 'dark': (40, 40, 40), 'boot': (30, 30, 31)}
PAL = {'hull': (98, 102, 103), 'super': (108, 112, 112), 'deck': (74, 76, 76), 'below': (44, 44, 46),
       'dark': (46, 48, 48), 'boot': (30, 30, 31)}
# stations: (y, width factor, z deck, z keel, saddle-tank blend)
# Fine entry, distinct saddle-tank bulge amidships (y -12..+12), long fine run into a deep narrow knife stern that
# carries on aft over the twin screws (planes + split rudders tucked under it); casing tapers to a point both ends.
ST = [(-33.5, 0.02, 2.55, 1.2, 0.0), (-32.2, 0.18, 2.2, -1.6, 0.0), (-28.0, 0.40, 1.85, -3.5, 0.0), (-21.0, 0.64, 1.62, -4.3, 0.0),
      (-15.0, 0.82, 1.50, -4.6, 0.2), (-10.0, 0.95, 1.47, -4.72, 1.0), (-2.0, 1.0, 1.45, -4.74, 1.0), (7.0, 1.0, 1.45, -4.72, 1.0),
      (12.0, 0.9, 1.42, -4.6, 0.55), (17.0, 0.72, 1.38, -4.35, 0.0), (23.0, 0.46, 1.30, -3.85, 0.0), (28.0, 0.22, 1.22, -3.2, 0.0),
      (31.5, 0.09, 1.16, -2.85, 0.0), (33.6, 0.025, 1.10, -2.35, 0.0)]
SADDLE = [(0, 0), (1.3, 0), (1.45, 0.025), (1.6, 0.09), (2.5, 0.16), (3.09, 0.30), (3.02, 0.47), (2.45, 0.66), (1.5, 0.86), (0.55, 0.98), (0, 1.0)]
SLIM = [(0, 0), (1.3, 0), (1.45, 0.025), (1.55, 0.09), (1.85, 0.20), (2.08, 0.36), (2.08, 0.55), (1.8, 0.72), (1.15, 0.88), (0.42, 0.98), (0, 1.0)]
YS = [-33.5, -33.0, -32.2, -31.0, -29.5, -28.0] + [-26 + 2.0 * i for i in range(27)] + [29.0, 30.0, 31.0, 32.0, 32.8, 33.6]
SS = N.interp_stations(ST, YS)


def prof(s):
    y, wf, zd, zk, sd = s
    out = []
    for (xa, na), (xb, nb) in zip(SADDLE, SLIM):
        x = (xa * sd + xb * (1 - sd)) * wf
        n = na * sd + nb * (1 - sd)
        out.append((max(0.0, x) if 0 < len(out) < 10 else 0.0, zd - n * (zd - zk)))
    return out


def deck_z(y):
    return N.interp_stations(ST, [y])[0][2]


def hull(var):
    secs = [(s[0], prof(s)) for s in SS]
    # pressure/outer hull (everything below the casing top), waterline split
    bm = bmesh.new()
    N.section_loft(bm, secs)
    N.split_z(bm, 0.0, 'hull', 'below', 'hull', 'hull_below', smooth=True)
    # boot-topping band (black) 0.35 m above the waterline, just proud of the hull
    bm = bmesh.new()
    rows = []
    burnt = var == 'burnt'
    for y, p in secs[2:-1]:
        zt = 0.35 if not burnt else min(p[1][1] - 0.1, 0.95 + 0.3 * math.sin(y * 0.55) + 0.15 * math.sin(y * 1.7))   # oil-soaked tide line
        x0 = _x_at(p, 0.0) + 0.012
        x1 = _x_at(p, zt) + 0.012
        rows.append([V((x1, y, zt)), V((x0, y, 0.0))])
    for sx in (1, -1):
        rr = [[V((sx * q.x, q.y, q.z)) for q in r] for r in rows]
        N._strip(bm, rr if sx > 0 else [list(reversed(r)) for r in rr])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.x * f.calc_center_median().x < 0:
            f.normal_flip()
    np_(bm, 'boot', 'boot_top', smooth=True) if not burnt else VH.vp(bm, 'oil', 'oil_band', smooth=True)
    # wooden deck slats on the casing top (flat, between the casing edges)
    bm = bmesh.new()
    rows = [[V((-p[1][0] + 0.02, y, p[1][1] + 0.03)), V((0, y, p[0][1] + 0.05)), V((p[1][0] - 0.02, y, p[1][1] + 0.03))] for y, p in secs[1:-1]]
    if burnt:                                            # slats blown away over the stern torpedo room
        N._strip(bm, [r for r in rows if r[0].y < 21.5])
        rows = [r for r in rows if r[0].y > 28.5]
    N._strip(bm, rows)
    np_(bm, 'planks_dark' if var != 'burnt' else 'wood', 'deck_slats', uv_scale=0.8)
    # flooding (limber) holes along the casing sides: dark slots
    for sx in (-1, 1):
        for y in [-24 + 1.2 * k for k in range(40)]:
            if -4.0 < y < 5.5:
                continue
            p = prof(N.interp_stations(ST, [y])[0])
            x, z = p[3][0], p[3][1]
            if x < 0.6:
                continue
            NP('black', box, (sx * (x + 0.005), y, z + 0.12), (0.02, 0.62, 0.16), name='limber_hole', lod='drop')
    # bow net cutter + jumping wires over the tower, bow stem bar
    NP('dark', beam, (0, -33.4, 2.55), (0, -33.9, 3.3), 0.08, 0.1, name='net_cutter')
    NP('dark', beam, (0, -33.8, 3.25), (0, -3.7, 5.2), 0.03, 0.03, name='jumping_wire', lod='drop2')
    NP('dark', beam, (0, 5.7, 4.6), (0, 33.2, 1.3), 0.03, 0.03, name='jumping_wire', lod='drop2')
    VH.contact('keel_fwd', (0, -20.0, -4.35), width=0.4)
    VH.contact('keel_aft', (0, 15.0, -4.40), width=0.4)


def _x_at(p, z):
    for (xa, za), (xb, zb) in zip(p[1:-1], p[2:]):
        if zb <= z <= za or za <= z <= zb:
            f = (z - za) / (zb - za) if zb != za else 0
            return xa + (xb - xa) * f
    return p[3][0]


def plan_ring(cy, hl, hw, z, n=3.0, segs=28, front=1.0):
    """Superellipse plan section (tower): centre y, half length/width; front (-Y) end scaled by `front`."""
    pts = []
    for k in range(segs):
        t = 2 * math.pi * k / segs
        c, s = math.cos(t), math.sin(t)
        x = hw * abs(c) ** (2 / n) * (1 if c >= 0 else -1)
        y = hl * abs(s) ** (2 / n) * (1 if s >= 0 else -1)
        if y < 0:
            y *= front
            x *= 1 - 0.25 * (abs(s) ** 3)
        pts.append(V((x, cy + y, z)))
    return pts


def tower(var):
    zd = 1.45
    bm = bmesh.new()
    # Turm II: rounded front whose face leans forward as it rises (overhanging bridge front), flared spray deflector
    C.loft_bm(bm, [plan_ring(-0.2, 3.3, 1.35, zd - 0.1, n=2.4), plan_ring(-0.3, 3.2, 1.33, 3.2, n=2.4),
                   plan_ring(-0.5, 3.05, 1.28, 4.4, n=2.3, front=1.08), plan_ring(-0.55, 2.97, 1.26, 4.72, n=2.3, front=1.12)],
              close_start=False, close_end=False)
    np_(bm, 'super', 'tower', smooth=True)
    bm = bmesh.new()                                   # coaming inner face + bridge floor
    C.loft_bm(bm, [plan_ring(-0.55, 2.92, 1.2, 5.06, n=2.3, front=1.14), plan_ring(-0.55, 2.89, 1.18, 4.1, n=2.3, front=1.1)], close_start=False)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    np_(bm, 'super', 'bridge_inner')
    bm = bmesh.new()                                   # Wellenabweiser: flares out ~0.3 m round the bridge top, turned-down lip
    C.loft_bm(bm, [plan_ring(-0.55, 2.97, 1.26, 4.72, n=2.3, front=1.12), plan_ring(-0.55, 3.12, 1.38, 4.9, n=2.3, front=1.14),
                   plan_ring(-0.55, 3.27, 1.52, 5.0, n=2.3, front=1.15), plan_ring(-0.55, 3.25, 1.5, 5.08, n=2.3, front=1.15),
                   plan_ring(-0.55, 2.92, 1.2, 5.06, n=2.3, front=1.14)], close_start=False, close_end=False)
    np_(bm, 'super', 'spray_deflector', smooth=True)
    # Wintergarten: lower aft platform with rails, carried on a fairing
    bm = bmesh.new()
    C.loft_bm(bm, [plan_ring(3.9, 1.7, 1.05, zd - 0.1), plan_ring(3.9, 1.6, 1.0, 3.6)], close_start=False)
    np_(bm, 'super', 'wintergarten_base')
    NP('dark', cyl, (0, 3.9, 3.6), (0, 3.9, 3.66), 1.25, 20, name='wintergarten_deck')
    ring = [V((1.2 * math.cos(t), 3.9 + 1.85 * math.sin(t), 3.66)) for t in (math.pi * (k / 10 - 1.1) for k in range(0, 13))]
    ring = [p for p in ring if p.y > 2.8]
    N.rail([tuple(p) for p in ring], 0.95, 0.5, key='super', wires=3, lod='drop2')
    # bridge floor, tower hatch, UZO post, periscope standards, RDF loop, compass
    NP('dark', box, (0, -0.55, 4.1), (2.3, 5.4, 0.05), name='bridge_floor')
    hp = V((0, 0.65, 4.13))
    NP('super', cyl, (0, 0.95, 4.13), (0, 0.95, 4.28), 0.36, 14, name='tower_hatch', node='hatch_tower', pivot=tuple(hp))
    VH.moving('hatch_tower', 'hatch', hp, (1, 0, 0), limits=(0, 100))
    NP('super', cyl, (0, -2.55, 4.1), (0, -2.55, 5.25), 0.07, 8, name='uzo_post')
    NP('dark', box, (0, -2.6, 5.3), (0.26, 0.12, 0.10), name='uzo_head', lod='drop')
    NP('super', cyl, (0, -1.8, 4.1), (0, -1.8, 4.9), 0.18, 10, name='compass_housing')
    for y, zt, r, nm in ((-0.9, 6.3, 0.16, 'periscope_sky'), (0.1, 5.9, 0.13, 'periscope_attack')):
        NP('super', cyl, (0, y, 4.1), (0, y, zt - 0.8), r + 0.1, 10, name='periscope_standard')
        NP('metal', cyl, (0, y, zt - 0.8), (0, y, zt), r * 0.6, 8, r1=r * 0.4, name=nm, node=nm, pivot=(0, y, zt - 0.8))
        VH.moving(nm, 'periscope', (0, y, zt - 0.8), (0, 0, 1), limits=(-180, 180), raise_m=4.0)
    NP('metal', VH.ring_torus, (-0.75, -1.5, 5.75), 0.28, 0.02, (0, 1, 0), 14, 4, name='rdf_loop', node='rdf_loop', pivot=(-0.75, -1.5, 5.3))
    NP('metal', cyl, (-0.75, -1.5, 4.9), (-0.75, -1.5, 5.47), 0.03, 6, name='rdf_post')
    VH.moving('rdf_loop', 'antenna', (-0.75, -1.5, 5.3), (0, 0, 1), limits=(-180, 180))
    for sx in (-1, 1):                                # handholds / step rungs on the tower sides
        for z in (2.0, 2.6, 3.2):
            NP('dark', beam, (sx * 1.34, -2.2, z), (sx * 1.34, -1.8, z), 0.03, 0.03, name='rung', lod='drop')
    for i, (x, y) in enumerate(((-0.8, -2.2), (0.8, -2.2), (-0.8, 0.9), (0.8, 0.9))):
        VH.socket('lookout_%d' % i, (x, y, 4.12), (x, -1, 0), pose='stand_binoculars')
    VH.socket('commander', (0, -1.3, 4.12), (0, -1, 0), pose='stand')


def deck_gun(var):
    """8.8 cm SK C/35 on its pedestal forward of the tower (no shield)."""
    y0, z0 = -7.6, deck_z(-7.6) + 0.05
    NP('dark', cyl, (0, y0, z0 - 0.02), (0, y0, z0 + 0.03), 1.0, 20, name='gun_platform')
    NP('super', cyl, (0, y0, z0), (0, y0, z0 + 0.85), 0.32, 12, r1=0.26, name='gun_pedestal')
    yp = V((0, y0, z0 + 0.9))
    kw = dict(node='deck_gun', pivot=tuple(yp))
    NP('super', cyl, yp, yp + V((0, 0, 0.12)), 0.36, 12, name='gun_training_ring', **kw)
    for sx in (-1, 1):
        NP('super', box, yp + V((sx * 0.26, 0.05, 0.40)), (0.07, 0.55, 0.62), name='gun_bracket', **kw)
        NP('dark', cyl, yp + V((sx * 0.55, 0.35, 0.35)), yp + V((sx * 0.62, 0.35, 0.35)), 0.14, 10, name='handwheel', lod='drop', **kw)
        NP('dark', box, yp + V((sx * 0.62, 0.62, 0.05)), (0.32, 0.22, 0.05), name='layer_seat', lod='drop', **kw)
    VH.moving('deck_gun', 'gun_yaw', yp, (0, 0, 1), limits=(-180, 180))
    tp = yp + V((0, 0.0, 0.62))
    kb = dict(node='deck_gun_barrel', pivot=tuple(tp))
    NP('super', box, tp + V((0, 0.35, 0)), (0.36, 1.1, 0.34), name='gun_cradle', **kb)
    NP('super', box, tp + V((0, 0.95, 0)), (0.3, 0.4, 0.3), name='gun_breech', **kb)
    NP('super', cyl, tp + V((0, 0.2, 0.22)), tp + V((0, -1.2, 0.22)), 0.07, 8, name='recoil_cyl', **kb)
    NP('super', cyl, tp + V((0, -0.2, 0)), tp + V((0, -3.9, 0)), 0.105, 12, r1=0.075, name='gun_barrel', **kb)
    NP('dark', cyl, tp + V((0, -3.9, 0)), tp + V((0, -3.96, 0)), 0.08, 12, name='tampion', lod='drop', **kb)
    VH.moving('deck_gun_barrel', 'gun_pitch', tp, (1, 0, 0), limits=(-10, 30), parent='deck_gun')
    VH.socket('muzzle_deck_gun', tp + V((0, -3.96, 0)), (0, -1, 0), node='deck_gun_barrel', weapon='8.8 cm SK C/35')
    for i, (x, y) in enumerate(((-0.75, 0.9), (0.75, 0.9), (0.0, 1.7))):
        VH.socket('gun_crew_%d' % i, (x, y0 + y, z0 + 0.03), (0, -1, 0), pose='stand_gun')
    # 2 cm Flak C/30 on the Wintergarten
    fp = V((0, 4.3, 3.66))
    NP('dark', cyl, fp, fp + V((0, 0, 0.7)), 0.12, 10, name='flak_pedestal')
    fy = fp + V((0, 0, 0.72))
    kf = dict(node='flak', pivot=tuple(fy))
    NP('dark', cyl, fy, fy + V((0, 0, 0.1)), 0.2, 10, name='flak_ring', **kf)
    bm = bmesh.new()
    C.quad(bm, [fy + V((-0.55, -0.35, 0.05)), fy + V((0.55, -0.35, 0.05)), fy + V((0.5, -0.45, 0.85)), fy + V((-0.5, -0.45, 0.85))])
    N._thicken(bm, 0.01)
    np_(bm, 'super', 'flak_shield', **kf)
    VH.moving('flak', 'gun_yaw', fy, (0, 0, 1), limits=(-180, 180))
    tp = fy + V((0, 0, 0.35))
    kb = dict(node='flak_barrel', pivot=tuple(tp))
    NP('gunmetal', box, tp + V((0, 0.1, 0)), (0.16, 0.7, 0.2), name='flak_receiver', **kb)
    NP('gunmetal', cyl, tp + V((0, -0.25, 0)), tp + V((0, -1.35, 0)), 0.03, 8, name='flak_barrel', **kb)
    NP('gunmetal', cyl, tp + V((0, -1.35, 0)), tp + V((0, -1.45, 0)), 0.045, 8, r1=0.03, name='flak_flash_hider', **kb)
    NP('gunmetal', box, tp + V((0.12, 0.0, 0.05)), (0.08, 0.3, 0.14), name='flak_magazine', **kb)
    NP('dark', beam, tp + V((0, 0.45, -0.05)), tp + V((0, 0.75, -0.1)), 0.35, 0.05, name='flak_shoulder_rests', **kb)
    VH.moving('flak_barrel', 'gun_pitch', tp, (1, 0, 0), limits=(-10, 85), parent='flak')
    VH.socket('muzzle_flak', tp + V((0, -1.45, 0)), (0, -1, 0), node='flak_barrel', weapon='2 cm Flak C/30')
    VH.socket('flak_gunner', (0, 5.1, 3.66), (0, -1, 0), pose='stand_flak')


def deck_fittings(var):
    for nm, y, sx in (('hatch_torpedo_fwd', -15.0, 0.0), ('hatch_galley', 9.5, 0.0), ('hatch_torpedo_aft', 24.0, 0.0)):
        z = deck_z(y) + 0.05
        hp = V((sx, y + 0.45, z + 0.05))
        NP('super', box, (sx, y, z), (0.9, 1.0, 0.1), name=nm + '_coaming')
        NP('dark', cyl, (sx, y, z + 0.05), (sx, y, z + 0.14), 0.36, 12, name=nm, node=nm, pivot=tuple(hp))
        VH.moving(nm, 'hatch', hp, (1, 0, 0), limits=(0, 95))
    VH.socket('charge_stern_torpedo_room', (0, 25.5, deck_z(25.5) + 0.05), (0, 0, 1), node=None, objective=True,
              note='M7 objective: demolition charge placement point (stern torpedo room below the aft hatch)')
    for y in (-26.0, -22.0, 20.0, 27.5):
        for sx in (-1, 1):
            N.bollard((sx * 0.9, y, deck_z(y) + 0.04), 0.07, 0.22, 0.25, yaw=0)
    NP('dark', cyl, (0, -24.0, deck_z(-24) + 0.04), (0, -24.0, deck_z(-24) + 0.34), 0.18, 10, name='capstan_fwd')
    NP('dark', cyl, (0, 29.5, deck_z(29.5) + 0.04), (0, 29.5, deck_z(29.5) + 0.34), 0.18, 10, name='capstan_aft')
    for sx in (-1, 1):
        NP('dark', box, (sx * 1.55, -31.0, 0.9), (0.1, 0.5, 0.35), name='hawse', lod='drop')
        NP('black', box, (sx * 2.35, 12.0, 0.75), (0.04, 0.9, 0.22), name='exhaust_outlet', lod='drop')
        VH.emitter('exhaust', (sx * 2.4, 12.0, 0.75), (sx, 0.3, 0.1), kind2='diesel (surfaced)')
        # bow + stern hydroplanes, twin screws, twin rudders (below the waterline)
        n = 'bow_plane_' + ('l' if sx > 0 else 'r')
        p = V((sx * 1.2, -27.0, -2.3))
        NP('below', box, (sx * 1.9, -27.0, -2.3), (1.5, 0.9, 0.08), name='bow_plane_below', node=n, pivot=tuple(p))
        VH.moving(n, 'hydroplane', p, (1, 0, 0), limits=(-25, 25))
        # twin screws either side of the knife stern on shafts leaving the hull at y 25 (A-brackets at y 30.8), stern
        # planes on the knife behind the screws, split twin rudders (blade above + below the plane) directly behind each screw
        zp = -2.1
        n = 'stern_plane_' + ('l' if sx > 0 else 'r')
        p = V((sx * 0.2, 33.0, zp))
        NP('below', box, (sx * 1.35, 33.25, zp), (2.3, 0.75, 0.08), name='stern_plane_below', node=n, pivot=tuple(p))
        NP('below', box, (sx * 1.35, 32.92, zp), (2.3, 0.12, 0.12), name='stern_plane_below', node=n, pivot=tuple(p))
        VH.moving(n, 'hydroplane', p, (1, 0, 0), limits=(-25, 25))
        n = 'propeller_' + ('l' if sx > 0 else 'r')
        pp = V((sx * 1.15, 32.0, zp))
        NP('metal', cyl, (sx * 0.55, 25.0, zp), pp, 0.09, 8, name='shaft_below')
        bm = bmesh.new()                               # A-bracket: two struts from the knife to the shaft boss
        bs = V((sx * 1.0, 30.8, zp))
        C.beam_bm(bm, V((sx * 0.1, 30.8, zp + 0.9)), bs, 0.1, 0.35)
        C.beam_bm(bm, V((sx * 0.1, 30.8, zp - 0.7)), bs, 0.1, 0.35)
        C.cyl_bm(bm, bs - V((0, 0.25, 0)), bs + V((0, 0.25, 0)), 0.17, 10)
        np_(bm, 'below', 'shaft_bracket_below')
        NP('brass', cyl, pp - V((0, 0.2, 0)), pp + V((0, 0.2, 0)), 0.18, 10, name='prop_hub_below', node=n, pivot=tuple(pp))
        for k in range(3):
            a = math.radians(k * 120 + 20 * sx)
            d = V((math.cos(a), 0, math.sin(a)))
            bm = bmesh.new()
            C.quad(bm, [pp + d * 0.15 - V((0, 0.15, 0)), pp + d * 0.7 + d.cross(V((0, 1, 0))) * 0.25 * sx, pp + d * 0.8 + V((0, 0.08, 0)), pp + d * 0.15 + V((0, 0.15, 0))])
            N._thicken(bm, 0.03)
            np_(bm, 'brass', 'prop_blade_below', node=n, pivot=tuple(pp))
        VH.moving(n, 'propeller', pp, (0, 1, 0), rpm_max=470, direction=sx)
        n = 'rudder_' + ('l' if sx > 0 else 'r')
        rp = V((sx * 1.15, 33.02, zp))
        for z0, z1 in ((zp + 0.1, zp + 0.95), (zp - 0.95, zp - 0.1)):
            NP('below', box, (sx * 1.15, 33.38, (z0 + z1) / 2), (0.08, 0.72, z1 - z0), name='rudder_below', node=n, pivot=tuple(rp))
        NP('metal', cyl, (sx * 1.15, 33.05, zp - 0.95), (sx * 1.15, 33.05, zp + 0.95), 0.05, 8, name='rudder_stock_below', node=n, pivot=tuple(rp))
        VH.moving(n, 'rudder', rp, (0, 0, 1), limits=(-35, 35))
        bm = bmesh.new()                               # rudder heel/head bearings carried on the knife + plane
        C.beam_bm(bm, V((sx * 0.1, 32.95, zp + 1.0)), V((sx * 1.15, 33.05, zp + 1.0)), 0.12, 0.1)
        np_(bm, 'below', 'rudder_bearing_below')
        for z in (-1.3, -2.3):                         # bow torpedo tube muzzle doors
            NP('black', box, (sx * 0.42, -31.6, z), (0.12, 0.75, 0.5), name='tube_door_below', lod='drop')
            VH.socket('tube_%s%d' % ('l' if sx > 0 else 'r', 1 if z > -2 else 2), (sx * 0.42, -32.2, z), (0, -1, 0), weapon='G7e torpedo')
    NP('black', box, (0, 33.52, -0.9), (0.1, 0.12, 0.55), name='stern_tube_door', lod='drop')


def details(var):
    """Deck-edge stanchion rails fore + aft, bow net-cutter teeth, spray-deflector ribs, tower hand-holds / steps,
    tower-base flood slots, lower spray lip on the Turm II front."""
    burnt = var == 'burnt'
    for sx in (-1, 1):
        for ys in ([-30.5 + 1.5 * k for k in range(17)], [6.5 + 1.5 * k for k in range(16)]):
            pts = []
            for y in ys:
                p = prof(N.interp_stations(ST, [y])[0])
                pts.append((sx * (p[1][0] - 0.12), y, p[1][1] + 0.02))
            if burnt and ys[0] > 0:
                pts = pts[:5]                                   # aft rails torn away by the blast
            N.rail(pts, 0.85, 1.5, key='dark', wires=2, lod2=False)
    # net cutter: saw-toothed stem bar from the bow casing up to the jumping-wire head
    A, B = V((0, -33.15, 2.35)), V((0, -33.95, 3.35))
    bm = bmesh.new()
    n = 7
    d = (B - A)
    fwd = V((0, -0.8, -0.6)).normalized()
    pts = [A + fwd * 0.02]
    for k in range(n):
        a, b = A + d * (k / n), A + d * ((k + 1) / n)
        pts += [a + fwd * 0.05, a.lerp(b, 0.25) + fwd * 0.32, b + fwd * 0.05]
    pts += [B + V((0, 0.2, 0.05)), A + V((0, 0.35, 0.05))]
    bm.faces.new([bm.verts.new(q + V((0.0, 0, 0))) for q in pts])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for v in bm.verts:
        v.co.x = -0.03
    r = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    for v in [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]:
        v.co.x = 0.03
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    np_(bm, 'dark', 'net_cutter_teeth')
    # spray deflector (Wellenabweiser) lip carried on radial ribs round the bridge top
    wall = plan_ring(-0.55, 2.97, 1.26, 4.5, n=2.3, front=1.1, segs=30)
    lip = plan_ring(-0.55, 3.24, 1.49, 4.98, n=2.3, front=1.15, segs=30)
    bm = bmesh.new()
    for a, b in zip(wall, lip):
        C.beam_bm(bm, a, b, 0.04, 0.03)
    np_(bm, 'super', 'deflector_ribs', lod='drop')
    # lower spray lip round the tower front (Turm II)
    ring = [q for q in plan_ring(-0.35, 3.18, 1.34, 3.7, n=2.4, front=1.04, segs=32) if q.y < -0.3]
    ring.sort(key=lambda q: math.atan2(q.y + 0.3, q.x))
    bm = bmesh.new()
    for a, b in zip(ring[:-1], ring[1:]):
        o = V((a.x, a.y + 0.3, 0)).normalized() * 0.16
        C.quad(bm, [a, b, b + V((o.x, o.y, 0.05)), a + V((o.x, o.y, 0.05))])
    N._thicken(bm, 0.02)
    np_(bm, 'super', 'spray_lip_lower')
    # hand-holds (U bars) and foot steps up the tower sides, aft ladder to the Wintergarten
    bm = bmesh.new()
    for sx in (-1, 1):
        for y, zs in ((-2.0, (2.0, 2.6, 3.2)), (1.6, (1.9, 2.45, 3.0, 3.55)), (-0.2, (4.35,))):
            xw = 1.33 if y < 1 else 1.3
            for z in zs:
                a, b = V((sx * (xw + 0.1), y - 0.2, z)), V((sx * (xw + 0.1), y + 0.2, z))
                C.beam_bm(bm, a, b, 0.03, 0.03)
                C.beam_bm(bm, a - V((sx * 0.1, 0, 0)), a, 0.025, 0.025)
                C.beam_bm(bm, b - V((sx * 0.1, 0, 0)), b, 0.025, 0.025)
    for z in (2.0, 2.4, 2.8, 3.2):                          # aft ladder rungs on the Wintergarten fairing
        C.beam_bm(bm, V((-0.2, 5.62, z)), V((0.2, 5.62, z)), 0.03, 0.03)
    np_(bm, 'dark', 'handholds', lod='drop')
    for sx in (-1, 1):                                      # flood slots round the tower base
        for y in (-2.6, -1.8, -1.0, -0.2, 0.6, 1.4, 2.2):
            NP('black', box, (sx * 1.355, y, 1.62), (0.02, 0.5, 0.14), name='tower_flood_slot', lod='drop')
    if burnt:     # demolition charges in the stern torpedo room: casing blown open over 7 m, plates peeled up and
        # outward round a black cavity (frames showing), holes torn in both sides at the waterline, stern planes bent
        NP('black', box, (0.1, 25.0, deck_z(25.0) - 0.3), (2.1, 6.6, 0.05), name='breach')
        bm = bmesh.new()
        for y in (22.6, 23.8, 25.0, 26.2, 27.4):                  # exposed pressure-hull frames in the cavity
            hw = prof(N.interp_stations(ST, [y])[0])[1][0]
            C.beam_bm(bm, V((-hw * 0.8, y, deck_z(y) - 0.25)), V((hw * 0.8, y, deck_z(y) - 0.25)), 0.08, 0.14)
        np_(bm, 'dark', 'breach_frames')
        plates = ((-0.9, 22.4, 55, 10, 1.2), (0.95, 23.2, -62, -12, 1.1), (-0.8, 24.8, 70, -25, 1.3), (1.0, 25.6, -48, 30, 1.2),
                  (-0.6, 27.2, 40, 35, 1.0), (0.7, 27.9, -35, -20, 0.9), (0.1, 21.9, 12, 48, 1.1), (0.0, 28.4, -8, -52, 1.0))
        for k, (x, y, ry, rx, sz) in enumerate(plates):
            bm = bmesh.new()
            C.quad(bm, [V((-0.5 * sz, -0.4 * sz, 0)), V((0.5 * sz, -0.35 * sz, 0.04)), V((0.42 * sz, 0.4 * sz, 0.1)), V((-0.55 * sz, 0.33 * sz, 0))])
            for v in bm.verts:
                v.co.z += 0.12 * sz * math.sin(v.co.x * 3.0 + k)          # buckled
            N._thicken(bm, 0.03)
            bm.transform(Matrix.Translation((x, y, deck_z(y) + 0.1 + 0.25 * sz)) @ Matrix.Rotation(math.radians(ry), 4, 'Y') @ Matrix.Rotation(math.radians(rx), 4, 'X'))
            np_(bm, 'hull', 'torn_plate')
        hx = lambda y, z: _x_at(prof(N.interp_stations(ST, [y])[0]), z)
        for sx in (-1, 1):
            bm = bmesh.new()
            pts = [(24.0 + 1.5 * math.cos(t) * (1 + 0.25 * math.sin(5 * t + sx)), 0.35 + 0.75 * math.sin(t) * (1 + 0.2 * math.cos(7 * t)))
                   for t in (2 * math.pi * k / 14 for k in range(14))]
            N.hull_hole(bm, pts, sx, hx)
            VH.vp(bm, 'black', 'blast_hole')


def main(var, out_root):
    N.setup('uboat_viic', var, PAL if var != 'burnt' else PAL_BURNT, scale=2.2, seed=51)
    burnt = var == 'burnt'
    N.FIRE[:] = [(0, 25.0, 1.4, 6.5), (0, 0.9, 4.2, 2.6), (0, 9.5, 1.5, 3.4), (0.3, 18.0, 1.3, 4.5), (0, 3.9, 3.7, 2.0), (0, -7.6, 2.2, 2.2)] if burnt else []
    hull(var)
    tower(var)
    deck_gun(var)
    deck_fittings(var)
    details(var)
    N.wake((0, 33.6, 0.0), (0, -33.0, 0.02), 6.2)
    for sx in (-1, 1):
        VH.emitter('prop_wash', (sx * 1.15, 32.3, -2.1), (0, 1, 0))
    VH.emitter('dive_vent_spray', (0, -10.0, 1.5), (0, 0, 1), when='diving', note='also at y=+10')
    VH.emitter('fire', (0, 25.0, 1.4), (0, 0, 1), when='destroyed', note='stern torpedo room charge')
    if var == 'winter':
        N.snow_cover(min_z=0.6, cover=0.22)
    if burnt:      # stern blown by the charges: flooded aft, settled by the stern with a slight list, smoke from the hatches
        VH.emitter('smoke', (0, 24.0, 1.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('smoke', (0, 0.9, 4.3), (0, 0, 1), kind2='tower_hatch_smoke')
        VH.emitter('oil_slick', (0, 20.0, 0.0), (0, 0, 1), kind2='spreading fuel-oil slick + bubbling', width=14.0)
        N.pose(['deck_gun_barrel'], (0, -7.6, deck_z(-7.6) + 1.57), 9, axis=(1, 0, 0))              # barrel drooped
        N.pose(['deck_gun', 'deck_gun_barrel'], (0, -7.6, deck_z(-7.6) + 0.95), 38)           # gun knocked round
        # down by the stern 2.5 deg (aft casing awash, the breach just above the water), 5 deg list to starboard
        VH.apply_T(Matrix.Translation((0, 0, -0.15)) @ Matrix.Rotation(math.radians(-2.5), 4, 'X') @ Matrix.Rotation(math.radians(-5), 4, 'Y'))
    dims = {'length': 67.1, 'beam': 6.18, 'pressure_hull_d': 4.7, 'draft': 4.74, 'height_keel_to_bridge': 9.6,
            'deck_gun': '8.8 cm SK C/35', 'flak': '2 cm Flak C/30'}
    N.finalize(out_root, 'uboat_viic', 'uboat', dims, 4.74, var, ALL, 'Type VIIC U-boat (Turm II, early-1942 fit: 8.8 cm SK C/35 + 2 cm Flak C/30), surfaced',
               extra={'crew': 44, 'objective_socket': 'charge_stern_torpedo_room', 'catalogue': 'uboat_docked'},
               ao_res=2048, ao_dist=3.0, lods=((0.8, 0.03), (0.62, 0.05)), parents={'deck_gun_barrel': 'deck_gun', 'flak_barrel': 'flak'})


if __name__ == '__main__':
    N.run(main, ALL)
