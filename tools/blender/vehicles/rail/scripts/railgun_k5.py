# Krupp K5(E) 28 cm railway gun "Leopold" (M6 Masi objective): box-girder carriage on two 12-wheel bogies
# (each = two 3-axle trucks under a span bolster), 283 mm L/76 barrel (21.5 m) in a cradle, elevation 0..50 deg.
# blender -b ... --python railgun_k5.py -- grey|dak|winter|burnt|all
# Dims: length 30.0 m travel (carriage 26.4 m over buffers + muzzle overhang), width 3.15 m, deck 2.6 m,
# trunnion 4.1 m above rail, 218 t. Ladder at the left (+X) front, stowed for travel (M6: the charge goes at its foot).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
YB = 8.6                       # bogie centres +-YB
YT, ZT = 1.0, 4.1              # trunnion (y, z): muzzle -17.8, rear buffer +13.68 -> 31.5 m in travel order
LBAR = 21.5
EL = 0.0                       # modelled elevation (deg); travel/rest pose
HW = 1.35                      # girder half width


def pal(var):
    # dak: neutral paint tint - the colour (tan + red-brown / olive blotches, Italy 1943-44) is in the k5camo texture
    base = {'grey': (54, 56, 55), 'dak': (203, 201, 199), 'winter': (54, 56, 55), 'burnt': (60, 60, 60)}[var]
    fk = 0.72 if var == 'dak' else 0.8
    # value breaks for the game camera: flanges / T-ribs / rivet rows read lighter (worn, dusty edges) than the web
    rib = {'grey': (112, 114, 108), 'dak': (226, 208, 176), 'winter': (84, 86, 82), 'burnt': (60, 60, 60)}[var]
    deckdust = {'grey': (96, 92, 84), 'dak': (230, 214, 184), 'winter': (84, 86, 82), 'burnt': (60, 60, 60)}[var]
    return dict(R.DR, body=base, frame=tuple(int(c * fk) for c in base), wheel=(62, 52, 46), buffer=R.DR['dark'],
                barrel=base, white=(200, 196, 186), bore=(10, 10, 10), rib=rib, deckdust=deckdust)


def truck3(node, y, parent):
    """3-axle truck with outside plate frames cut into chords + horn guides (big openings: the wheels read through
    them and below the lower chord), axleboxes with lids, leaf springs + equalising beams, brake blocks."""
    r, wb = 0.45, 1.45
    kw = dict(node=node, pivot=(0, y, 0.9))
    for s in (-1, 1):
        x = s * 1.02
        RP('frame', box, (x, y, 0.93), (0.05, 4.0, 0.18), name='truck_top_chord', bisect=False, **kw)
        RP('frame', box, (x + s * 0.05, y, 1.0), (0.12, 4.0, 0.04), name='truck_top_flange', bisect=False, **kw)
        for k in (-1, 0, 1):
            yy = y + k * wb
            for dy in (-0.22, 0.22):
                RP('frame', box, (x, yy + dy, 0.55), (0.05, 0.1, 0.62), name='truck_horn', bisect=False, **kw)
            RP('frame', box, (x, yy, 0.22), (0.05, 0.56, 0.08), name='truck_horn_stay', bisect=False, **kw)
            RP('frame', box, (x + s * 0.07, yy, r + 0.04), (0.12, 0.34, 0.34), name='axlebox', bisect=False, **kw)
            RP('dark', box, (x + s * 0.14, yy, r + 0.04), (0.02, 0.24, 0.24), name='axlebox_lid', bisect=False, lod='drop', **kw)
            bm = bmesh.new()                                   # laminated spring pack (bent) + buckle over the box
            q = [V((x + s * 0.08, yy - 0.45, r + 0.4)), V((x + s * 0.08, yy, r + 0.3)), V((x + s * 0.08, yy + 0.45, r + 0.4))]
            for a, b in zip(q[:-1], q[1:]):
                C.beam_bm(bm, a, b, 0.1, 0.08)
            rp_(bm, 'dark', 'truck_spring', bisect=False, **kw)
            if k < 1:                                          # lower chord + diagonal between the horns
                ya, yb = yy + 0.27, yy + wb - 0.27
                RP('frame', box, (x, (ya + yb) / 2, 0.3), (0.05, yb - ya, 0.1), name='truck_low_chord', bisect=False, **kw)
                RP('frame', beam, (x, ya, 0.35), (x, yb, 0.84), 0.05, 0.08, name='truck_diag', up=V((1, 0, 0)), bisect=False, **kw)
                RP('dark', beam, (x + s * 0.08, yy + 0.45, r + 0.36), (x + s * 0.08, yy + wb - 0.45, r + 0.36), 0.05, 0.06, name='equaliser', bisect=False, lod='drop', **kw)
        for yy in (y - 2.0, y + 2.0):
            RP('frame', box, (x, yy, 0.6), (0.05, 0.08, 0.8), name='truck_end_post', bisect=False, **kw)
    for dy in (-1.95, 1.95):
        RP('frame', box, (0, y + dy, 0.75), (2.2, 0.14, 0.5), name='truck_headstock', bisect=False, **kw)
    for k in (-1, 0, 1):                                       # brake blocks on the inner wheel faces
        for s in (-1, 1):
            RP('dark', box, (s * 0.8, y + k * wb + 0.52, r + 0.05), (0.09, 0.08, 0.3), name='brake_block', bisect=False, lod='drop', **kw)
    VH.moving(node, 'bogie_yaw', (0, y, 0.9), (0, 0, 1), limits=(-6, 6), parent=parent)
    for k in (-1, 0, 1):
        R.wheelset('%s_ws%d' % (node, k + 1), y + k * wb, r, 'simple', segs=12, key='wheel', axle_key='dark', parent=node)


def bogies():
    for f, nb in ((-1, 'bogie_f'), (1, 'bogie_r')):
        yb = f * YB
        kw = dict(node=nb, pivot=(0, yb, 1.3))
        RP('frame', box, (0, yb, 1.28), (2.3, 5.4, 0.32), name='span_bolster', **kw)
        RP('frame', cyl, (0, yb, 1.44), (0, yb, 1.6), 0.7, 16, name='centre_pivot', bisect=False, **kw)
        VH.moving(nb, 'bogie_yaw', (0, yb, 1.3), (0, 0, 1), limits=(-4, 4), note='12-wheel bogie (span bolster) under the carriage')
        for g in (-1, 1):
            truck3('%s_t%d' % (nb, 0 if g < 0 else 1), yb + g * 2.35, nb)
        VH.emitter('rail_dust', (0, yb, 0.05), (0, 0, 1))


def carriage(burnt):
    """Riveted box girder: low ends over the bogies, deep centre with high cradle cheeks around the trunnions."""
    ye = 12.9
    y1, y2 = -6.2, 5.2                                        # raised centre deck (3.05) around the cradle
    prof = [(-ye, 1.62), (-4.3, 1.62), (-2.9, 1.08), (2.9, 1.08), (4.3, 1.62), (ye, 1.62), (ye, 2.55), (y2 + 0.6, 2.55),
            (y2, 3.05), (YT + 2.6, 3.05), (YT + 1.6, 4.3), (YT - 0.9, 4.3), (YT - 2.4, 3.05), (y1, 3.05), (y1 - 0.6, 2.55), (-ye, 2.55)]
    for s in (-1, 1):
        bm = bmesh.new()
        VH.side_prism(bm, prof, s * HW - 0.03, s * HW + 0.03)
        rp_(bm, 'body', 'girder_side')
        for y in [-12.2 + 1.22 * k for k in range(21)]:           # vertical web stiffeners (T-ribs) along the whole girder
            zb = 1.62 if abs(y) > 4.3 else (1.08 if abs(y) < 2.9 else 1.08 + (abs(y) - 2.9) / 1.4 * 0.54)
            zt = 2.55 if (y < y1 - 0.6 or y > y2 + 0.6) else 3.05
            RP('rib', box, (s * (HW + 0.05), y, (zb + zt) / 2), (0.08, 0.06, zt - zb - 0.06), name='stiffener')
        RP('rib', box, (s * (HW + 0.06), 0, 2.53), (0.12, 2 * ye, 0.06), name='top_flange')
        for ya, yb2, za, zb2 in ((-ye, -4.3, 1.64, 1.64), (-4.3, -2.9, 1.64, 1.1), (-2.9, 2.9, 1.1, 1.1), (2.9, 4.3, 1.1, 1.64), (4.3, ye, 1.64, 1.64)):
            RP('rib', beam, (s * (HW + 0.06), ya, za), (s * (HW + 0.06), yb2, zb2), 0.12, 0.06, name='bottom_flange', up=V((0, 0, 1)))
        RP('rib', box, (s * (HW + 0.06), (y1 + y2) / 2, 3.03), (0.12, y2 - y1, 0.06), name='top_flange_mid')
        for ya, yb2 in ((YT - 2.4, YT - 0.9), (YT + 1.6, YT + 2.6)):  # cheek edge flanges
            RP('rib', beam, (s * (HW + 0.06), ya, 3.05 if ya < YT else 4.3), (s * (HW + 0.06), yb2, 4.3 if ya < YT else 3.05), 0.12, 0.06, name='cheek_flange')
        RP('rib', box, (s * (HW + 0.06), YT + 0.35, 4.28), (0.12, 2.5, 0.06), name='cheek_top_flange')
        for y in (YT - 0.6, YT + 0.3, YT + 1.2):
            RP('rib', box, (s * (HW + 0.05), y, 3.7), (0.08, 0.08, 1.15), name='stiffener_c')
        R.label_block((s * (HW + 0.1), -9.6, 2.05), (s, 0, 0), 1.1, 0.34, 3)
        # side walkways on outrigger brackets + railings (not over the cradle cheeks)
        for ya, yb in ((-ye + 0.3, -0.3), (6.0, ye - 0.3)):
            RP('steel_grate', box, (s * (HW + 0.3), (ya + yb) / 2, 2.52), (0.5, yb - ya, 0.04), name='walkway')
            for y in [ya + k * (yb - ya) / 6 for k in range(7)]:
                RP('body', beam, (s * (HW + 0.02), y, 2.2), (s * (HW + 0.52), y, 2.5), 0.05, 0.06, name='outrigger', lod='drop', up=V((0, 1, 0)))
            R.handrail([(s * (HW + 0.54), ya, 2.54), (s * (HW + 0.54), ya, 3.5), (s * (HW + 0.54), yb, 3.5), (s * (HW + 0.54), yb, 2.54)], r=0.02)
            R.handrail([(s * (HW + 0.54), ya, 3.0), (s * (HW + 0.54), yb, 3.0)], r=0.014)
    # deck plates (top of the girder) + cradle well between the cheeks
    RP('deckdust', box, (0, (-ye + y1) / 2, 2.57), (2 * HW + 0.06, y1 - (-ye), 0.04), name='deck_front')
    RP('deckdust', box, (0, (y2 + ye) / 2, 2.57), (2 * HW + 0.06, ye - y2, 0.04), name='deck_rear')
    RP('deckdust', box, (0, (y1 + YT - 2.4) / 2, 3.07), (2 * HW + 0.06, YT - 2.4 - y1, 0.04), name='deck_mid')
    RP('deckdust', box, (0, (YT + 2.6 + y2) / 2, 3.07), (2 * HW + 0.06, y2 - YT - 2.6, 0.04), name='deck_mid_r')
    RP('dark', box, (0, 0.0, 1.12), (2 * HW, 5.8, 0.04), name='belly_plate')
    for y in (-2.2, 0.0, 2.2):
        RP('body', box, (0, y, 1.6), (2 * HW, 0.08, 0.9), name='belly_diaphragm', lod='drop')
    for f in (-1, 1):
        y = f * ye
        RP('body', box, (0, y, 2.08), (2 * HW + 0.06, 0.06, 0.95), name='girder_end')
        yy = R.headstock(y, 1.06 + 0.1, 3.0, 0.4, f, 'frame', blen=0.62)
        RP('frame', box, (0, y + f * 0.1, 1.45), (1.2, 0.2, 0.4), name='end_bracket', lod='drop')
        RP('body', box, (0, y - f * 0.02, 2.08), (2 * HW + 0.1, 0.04, 0.9), name='girder_end_plate', lod='drop')
    # stabilising jacks (outriggers lowered in firing position) at the girder ends
    for f in (-1, 1):
        for s in (-1, 1):
            RP('dark', cyl, (s * (HW + 0.2), f * 11.5, 1.9), (s * (HW + 0.2), f * 11.5, 0.9), 0.12, 8, name='jack', bisect=False)
            RP('dark', box, (s * (HW + 0.2), f * 11.5, 0.84), (0.4, 0.4, 0.06), name='jack_foot', bisect=False, lod='drop')
    # boarding ladder at the front, LEFT side (+X), outside the walkway railing. Node 'ladder' slides vertically in
    # guides: modelled STOWED (raised 1.9 m: foot 1.6 m above the rail head, inside the +-1.91 m walkway envelope)
    # for travel; toggle ladder_deployed lowers it by 1.9 m so the foot stands on the ballast shoulder.
    lx, ly, up = HW + 0.6, -12.1, 1.9
    z0, z1 = -0.3, 2.54
    bm = bmesh.new()
    for dy in (-0.22, 0.22):
        C.cyl_bm(bm, V((lx, ly + dy, z0 + up)), V((lx, ly + dy, z1 + up)), 0.02, 5)
    for k in range(9):
        z = z0 + up + (z1 - z0) * (k + 0.5) / 9
        C.cyl_bm(bm, V((lx, ly - 0.22, z)), V((lx, ly + 0.22, z)), 0.016, 5)
    rp_(bm, 'dark', 'ladder', bisect=False, node='ladder', pivot=(lx, ly, z1 + up))
    for dy in (-0.26, 0.26):                                   # fixed guide brackets on the railing post
        RP('dark', box, (lx - 0.05, ly + dy, 2.75), (0.1, 0.05, 0.1), name='ladder_guide', bisect=False, lod='drop')
        RP('dark', box, (lx - 0.05, ly + dy, 3.4), (0.1, 0.05, 0.1), name='ladder_guide', bisect=False, lod='drop')
    VH.moving('ladder', 'slide', (lx, ly, z1 + up), (0, 0, 1), travel_m=[-up, 0.0],
              note='boarding ladder: default = stowed (travel); deployed = translate -1.9 m along local Y (glTF up)')
    VH.VM['toggles']['ladder_deployed'] = {'default': False, 'node': 'ladder', 'translate_m': [0, -up, 0],
                                           'note': 'lower the ladder (firing position / M6 objective); sockets ladder_* assume deployed'}
    VH.socket('ladder_foot', (lx + 0.6, ly, -0.3), (-1, 0, 0), pose='kneel', note='M6: explosive charge at the foot of the (deployed) ladder destroys the gun')
    VH.socket('ladder_top', (lx - 0.2, ly, 2.55), (-1, 0, 0), pose='stand')
    VH.VM.setdefault('ladders', []).append({'a': VH.G((lx, ly, z0)), 'b': VH.G((lx, ly, z1)), 'requires': 'ladder_deployed'})


def muzzle_face(ym, kw):
    """Square-cut muzzle: 35 mm chamfer ring, flat annular face, open 283 mm bore 0.3 m deep (inward-facing walls, dark
    rifled-bore end disc) - flat shaded, faces oriented so single-sided rendering shows the opening."""
    rb, n = 0.1415, 20
    ring = lambda r, y: [V((r * math.cos(2 * math.pi * i / n), y, ZT + r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    def band(bm, ra, rb_, out):
        va, vb = [bm.verts.new(p) for p in ra], [bm.verts.new(p) for p in rb_]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((va[i], va[j], vb[j], vb[i]))
            f.normal_update()
            if f.normal.dot(out(f.calc_center_median())) < 0:
                f.normal_flip()
    bm = bmesh.new()
    band(bm, ring(0.34, ym + 0.035), ring(0.305, ym), lambda c: V((c.x, -0.6, c.z - ZT)))           # chamfer
    band(bm, ring(0.305, ym), ring(rb, ym), lambda c: V((0, -1, 0)))                                  # flat face
    rp_(bm, 'barrel', 'muzzle_face', bisect=False, **kw)
    bm = bmesh.new()
    band(bm, ring(rb, ym), ring(rb, ym + 0.3), lambda c: V((-c.x, 0, -(c.z - ZT))))                   # bore walls
    vs = [bm.verts.new(p) for p in ring(rb, ym + 0.3)]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    rp_(bm, 'bore', 'bore', bisect=False, **kw)


def gun(burnt):
    """Cradle + barrel as node 'gun' (pivot = trunnion axis, rotates about X for elevation)."""
    piv = V((0, YT, ZT))
    kw = dict(node='gun', pivot=tuple(piv))
    # trunnion bearings on the cheeks (static)
    for s in (-1, 1):
        RP('body', cyl, (s * (HW - 0.05), YT, ZT), (s * (HW + 0.12), YT, ZT), 0.42, 16, name='trunnion_bearing', bisect=False)
        RP('dark', cyl, (s * (HW + 0.12), YT, ZT), (s * (HW + 0.18), YT, ZT), 0.25, 12, name='trunnion_cap', bisect=False, lod='drop')
    # cradle: low open trough slung between the cheeks (trunnion arms), front + rear barrel sleeves; the recoil gear
    # (2 recoil brakes above, recuperator below) is exposed along the cradle, with piston rods to the breech ring
    bm = bmesh.new()
    VH.side_prism(bm, [(YT - 4.4, ZT - 0.72), (YT + 1.3, ZT - 0.72), (YT + 1.3, ZT - 0.1), (YT - 4.4, ZT - 0.1)], -0.62, -0.56)
    VH.side_prism(bm, [(YT - 4.4, ZT - 0.72), (YT + 1.3, ZT - 0.72), (YT + 1.3, ZT - 0.1), (YT - 4.4, ZT - 0.1)], 0.56, 0.62)
    rp_(bm, 'body', 'cradle_cheek', **kw)
    RP('body', box, (0, YT - 1.55, ZT - 0.7), (1.24, 5.7, 0.06), name='cradle_floor', **kw)
    for yy in (YT + 1.1, YT - 4.2):
        RP('body', cyl, (0, yy - 0.18, ZT), (0, yy + 0.18, ZT), 0.64, 18, name='cradle_sleeve', smooth=True, bisect=False, **kw)
    for s in (-1, 1):
        RP('body', cyl, (s * 0.62, YT, ZT), (s * 1.18, YT, ZT), 0.24, 12, name='trunnion_arm', bisect=False, **kw)
    for dx, dz, rr in ((-0.42, 0.66, 0.2), (0.42, 0.66, 0.2), (0.0, -0.86, 0.23)):
        RP('body', cyl, (dx, YT + 0.9, ZT + dz), (dx, YT - 4.3, ZT + dz), rr, 12, name='recoil_cylinder', smooth=True, bisect=False, **kw)
        RP('dark', cyl, (dx, YT + 0.9, ZT + dz), (dx, YT + 2.2, ZT + dz), 0.07, 8, name='recoil_piston_rod', bisect=False, **kw)
        for yy in (YT - 1.2, YT - 3.2):
            RP('dark', cyl, (dx, yy - 0.04, ZT + dz), (dx, yy + 0.04, ZT + dz), rr + 0.03, 12, caps=False, name='recoil_band', bisect=False, lod='drop', **kw)
        RP('dark', box, (dx, YT + 2.2, ZT + dz * 0.6), (0.2, 0.12, abs(dz) * 0.8), name='rod_yoke', bisect=False, lod='drop', **kw)
    RP('dark', cyl, (0.3, YT - 2.0, ZT + 0.95), (0.3, YT + 0.6, ZT + 0.95), 0.05, 6, name='recoil_pipe', bisect=False, lod='drop', **kw)
    # elevating arc (toothed sector) under the cradle
    bm = bmesh.new()
    pts = [piv + V((0, math.sin(a) * 2.2 * -1, -math.cos(a) * 2.2)) for a in [math.radians(-10 + 7 * k) for k in range(10)]]
    for a, b in zip(pts[:-1], pts[1:]):
        C.beam_bm(bm, a, b, 0.12, 0.3, up=V((1, 0, 0)))
    rp_(bm, 'body', 'elevating_arc', bisect=False, **kw)
    # barrel: breech ring + tapering tube with a muzzle swell (lofted circles), 21.5 m
    yb0 = YT + 2.3                                   # breech face (rear)
    stations = [(yb0, 0.62), (yb0 - 0.9, 0.62), (yb0 - 0.95, 0.52), (yb0 - 6.0, 0.47), (yb0 - 12.0, 0.4),
                (yb0 - 18.0, 0.33), (yb0 - LBAR + 0.9, 0.3), (yb0 - LBAR + 0.5, 0.34), (yb0 - LBAR + 0.035, 0.34)]
    if burnt:
        stations = stations[:4] + [(yb0 - 9.0, 0.44)]
    bm = bmesh.new()
    rings = [[V((r * math.cos(2 * math.pi * i / 20), y, ZT + r * math.sin(2 * math.pi * i / 20))) for i in range(20)] for y, r in stations]
    C.loft_bm(bm, rings, True, False)
    rp_(bm, 'barrel', 'barrel', smooth=True, **kw)
    if not burnt:
        muzzle_face(yb0 - LBAR, kw)
        # barrel support rib + tensioning brace ahead of the cradle (K5 barrel droop support)
        RP('body', box, (0, YT - 7.0, ZT + 0.55), (0.12, 3.0, 0.2), name='barrel_rib', **kw)
        RP('body', beam, (0, YT - 4.2, ZT + 0.95), (0, YT - 8.4, ZT + 0.6), 0.14, 0.12, name='barrel_brace', **kw)
        muz = V((0, yb0 - LBAR, ZT))
        VH.socket('muzzle', tuple(muz), (0, -1, 0), node='gun', weapon='28 cm K5', calibre_mm=283, shell_kg=255)
        VH.emitter('muzzle_blast', tuple(muz), (0, -1, 0), node='gun', size='huge', note='smoke ring + dust over ~40 m')
    else:
        # blown-off barrel section (10.7 m, muzzle end) thrown clear and lying FLAT on the ground beside the ballast
        # shoulder (+X side, x 2.6..3.1), half sunk in a long gouged earth scar; no contact with the carriage or rails
        g = -0.45                                                 # review/game ground plane under the ballast
        frag = [V((2.6, YT - 7.4, g + 0.44 - 0.12)), V((3.1, YT - 18.1, g + 0.31 - 0.1))]
        bm = bmesh.new()
        C.cyl_bm(bm, frag[0], frag[1], 0.44, 16, r1=0.31)
        rp_(bm, 'barrel', 'barrel_fragment', smooth=True)
        RP('bore', cyl, frag[0] + V((0, 0.02, 0)), frag[0] - V((0, 0.03, 0)), 0.36, 12, name='fragment_break', bisect=False)
        RP('dark', cyl, frag[0] + V((0, 0.03, 0)), frag[0] - V((0, 0.02, 0)), 0.45, 12, name='fragment_break_rim', bisect=False, lod='drop')
        bm = bmesh.new()                                          # long low scar mound (ploughed earth) under the fragment
        c = (frag[0] + frag[1]) / 2
        c.z = g
        L2 = (frag[0] - frag[1]).length / 2 + 0.9
        rings = [[c + V((rr * 0.95 * math.cos(2 * math.pi * i / 12), rr2 * math.sin(2 * math.pi * i / 12), zz)) for i in range(12)]
                 for rr, rr2, zz in ((1.0, L2, -0.02), (0.8, L2 * 0.92, 0.1), (0.45, L2 * 0.8, 0.16))]
        C.loft_bm(bm, rings, False, True)
        rp_(bm, 'mud', 'ground_scar', bisect=False)
        VH.VM['wreck_note'] = ('barrel_fragment (10.7 m muzzle section) lies flat on the ground beside the ballast at x 2.6-3.1 m '
                               '(glTF y -0.45..+0.3), half sunk in the ground_scar mound on the ground plane y=-0.45; it touches '
                               'neither the carriage nor the rails. The carriage stays on the rails (burnt springs: body slumped 5 cm).')
    # breech block + loading tray (move with the gun)
    RP('dark', box, (0, yb0 + 0.25, ZT), (0.9, 0.5, 0.9), name='breech_block', **kw)
    RP('dark', box, (0.55, yb0 + 0.3, ZT - 0.3), (0.3, 0.2, 0.1), name='breech_lever', lod='drop', **kw)
    VH.moving('gun', 'gun_pitch', tuple(piv), (1, 0, 0), limits=(0, 50), note='elevation about the trunnions (+ = muzzle up)')
    VH.socket('breech', (0, yb0 + 1.2, 3.05), (0, -1, 0), pose='stand', note='loader position behind the breech')


def rear_platform(burnt):
    """Loading platform over the rear bogie: shell hoist davit, loading trolley rails, ammunition on trays."""
    RP('steel_grate', box, (0, 8.5, 2.62), (2 * HW + 0.9, 5.0, 0.04), name='loading_platform')
    # hoist davit (rotating jib) with chain + shell
    pv = V((-0.9, 7.2, 2.62))
    kw = dict(node='hoist', pivot=tuple(pv))
    RP('body', cyl, pv, pv + V((0, 0, 2.6)), 0.1, 10, name='davit_post', bisect=False, **kw)
    RP('body', beam, pv + V((0, 0, 2.5)), pv + V((1.4, -0.6, 2.4)), 0.1, 0.14, name='davit_jib', bisect=False, **kw)
    RP('dark', cyl, pv + V((1.35, -0.58, 2.35)), pv + V((1.35, -0.58, 1.0)), 0.012, 4, name='hoist_chain', bisect=False, lod='drop', **kw)
    VH.moving('hoist', 'crane_slew', tuple(pv), (0, 0, 1), limits=(-120, 120))
    if not burnt:
        sh = pv + V((1.35, -0.58, 0.95))
        RP('brass', cyl, sh - V((0, 0, 0.6)), sh, 0.14, 10, r1=0.07, name='shell_hoisted', bisect=False, node='hoist', pivot=tuple(pv))
        for k in range(3):                                   # shells on a tray + cartridge cases
            y = 9.5 + 0.35 * k
            RP('brass', cyl, (0.3, y, 2.8), (1.3, y, 2.8), 0.14, 10, r1=0.14, name='shell', bisect=False, lod='drop')
            RP('brass', cyl, (1.3, y, 2.8), (1.55, y, 2.8), 0.14, 10, r1=0.03, name='shell_nose', bisect=False, lod='drop')
        RP('frame', box, (0.9, 9.85, 2.68), (1.4, 1.2, 0.1), name='shell_tray')
    RP('dark', box, (0, 7.6, 3.1), (0.1, 1.8, 0.06), name='loading_rail', lod='drop')
    for k, (x, y) in enumerate(((-1.8, -6.0), (1.8, -4.5), (-1.8, 7.5), (1.8, 8.5), (0.6, 10.5), (-0.6, 10.5))):
        VH.socket('crew_%d' % k, (x, y, 2.55), (0, -1, 0), pose='stand')


def deck_details(burnt):
    """Deck plating seams, hatches, lockers, compressed-air bottles, rammer staff, barrel travel crutch, cable reels."""
    rn = C.rng()
    for y in [-12.0 + 1.6 * k for k in range(6)] + [7.2 + 1.6 * k for k in range(4)]:
        RP('frame', box, (0, y, 2.595), (2 * HW, 0.03, 0.012), name='deck_seam', lod='drop')
    for y in (-10.6, -6.0, 8.2):
        RP('body', box, (0.55, y, 2.62), (0.8, 0.9, 0.05), name='deck_hatch', lod='drop')
        RP('dark', box, (0.55, y - 0.35, 2.66), (0.3, 0.04, 0.04), name='hatch_handle', lod='drop')
    for k, y in enumerate((-11.5, -9.6, -7.7)):                      # stowage lockers along the -X (right) side
        RP('body', VH.bevel_box, (-0.75, y, 2.85), (0.9, 1.5, 0.55), r=0.03, name='locker')
        RP('dark', box, (-0.3, y, 2.9), (0.02, 0.6, 0.04), name='locker_hasp', lod='drop')
    for k in range(3):                                               # compressed-air bottles (recoil system top-up)
        RP('body', cyl, (0.95, -8.6 + k * 0.32, 2.75), (0.95, -8.6 + k * 0.32, 3.9), 0.13, 10, name='air_bottle', bisect=False)
    RP('wood', cyl, (-1.15, -6.5, 2.66), (-1.15, -1.8, 2.66), 0.05, 6, name='rammer_staff', bisect=False, lod='drop')
    RP('dark', cyl, (0.95, -5.4, 2.62), (0.95, -5.4, 3.3), 0.35, 14, r1=0.35, name='cable_reel', bisect=False, lod='drop')
    if not burnt:                                                    # barrel travel crutch (lowered barrel rests on it)
        y = -9.2
        rb = 0.43
        for s in (-1, 1):
            RP('frame', beam, (s * 0.8, y, 2.6), (s * 0.3, y, ZT - rb - 0.05), 0.16, 0.2, name='crutch_leg')
        RP('frame', box, (0, y, ZT - rb - 0.1), (0.9, 0.25, 0.12), name='crutch_saddle')
        RP('wood', box, (0, y, ZT - rb - 0.02), (0.6, 0.22, 0.06), name='crutch_pad', lod='drop')
    # telephone / sighting post near the cradle
    RP('dark', cyl, (-1.0, 5.6, 3.05), (-1.0, 5.6, 4.0), 0.05, 6, name='sight_post', bisect=False, lod='drop')
    RP('dark', box, (-1.0, 5.6, 4.05), (0.25, 0.35, 0.2), name='panoramic_sight', lod='drop')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('railgun_k5', var, pal(var), seed=5)
    R.WHITEWASH.update(('body', 'barrel', 'rib', 'deckdust'))
    R.DUST_LOW[0] = {'grey': V((0.78, 0.74, 0.66)), 'dak': V((0.95, 0.86, 0.7))}.get(var)
    R.TEX['steel_grate'] = ('steel_grating', (0.4, 0.4, 0.4))
    R.TEX['mud'] = ('mud', (0.8, 0.75, 0.7))
    # riveted carriage: rivet/plate-seam textures on all paint; camouflage (dak) / worn whitewash (winter) sets
    R.SWAP.update({'veh_paint': {'dak': 'k5camo'}.get(var, 'rivet'), 'limewash_worn': 'k5ww'})
    bogies()
    carriage(burnt)
    gun(burnt)
    rear_platform(burnt)
    deck_details(burnt)
    if var == 'winter':
        R.snow_cover(min_z=1.8, cover=0.3)
    if burnt:
        VH.emitter('fire', (0, YT, ZT), (0, 0, 1), when='destroyed', note='propellant fire in the cradle')
        VH.emitter('smoke', (0, 4.0, 5.0), (0, 0, 1), kind2='wreck_black')
        pv = Matrix.Translation((0, 0, 1.3))
        R.wreck_pose(Matrix.Translation((0, 0, -0.05)) @ pv @ Matrix.Rotation(math.radians(-1.5), 4, 'Y') @ pv.inverted(),
                     names=('axlebox', 'brake_block', 'brake_hanger', 'barrel_fragment', 'fragment_break', 'ground_scar'))
    dims = {'length_travel': 30.0, 'carriage_over_buffers': 26.44, 'width': 3.15, 'height_travel': round(ZT + 0.62, 2),
            'barrel_m': LBAR, 'calibre_mm': 283, 'trunnion': [YT, ZT], 'bogie_centres': 2 * YB, 'mass_t': 218}
    R.finalize(out_root, 'railgun_k5', 'railgun', dims, var, ALL, 'Krupp K5(E) 28 cm railway gun "Leopold"',
               extra={'objective': 'M6', 'elevation_deg': [0, 50], 'traverse_deg': 1, 'range_km': 64, 'rate_rph': 15},
               ao_dist=1.5, ao_res=1536)


if __name__ == '__main__':
    R.run(main, ALL)
