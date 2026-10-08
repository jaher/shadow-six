"""Field works and wrecks for the M16/M18 Maas bridge map, Belgium 1944.
 r  pillbox_round_be   round concrete pillbox, 5 m across, 3 m high: board-marked concrete in a faded 3-tone camouflage,
                       a thick overhanging roof slab with an earth-and-turf cap, three stepped embrasures with steel
                       shutters (S, SE, SW), a sunken rear entrance with a steel door (N), sandbags against the base
 n  tent_ridge_field   German ridge tent 5 x 3.5 m: canvas on a ridge pole and two uprights, low side walls, guy ropes
                       and pegs inside the footprint, a door flap rolled up at the S end, ditched hem
 d  bulldozer_rusty    abandoned 1930s crawler tractor with a cable-lift angledozer, 4.5 x 2.6 m (maas_dozer.py: shoe-by-
                       shoe track belts with grousers, sprockets, idlers, rollers, louvred hood, barred radiator, exposed
                       engine, cable control unit, ribbed mouldboard; faded ochre paint worn to rust, weeds)
usage: blender -b --python maas_mil.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, DOOR, finish, use_cheap_doors
import bmesh
use_cheap_doors()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'r'), (int(a[2]) if len(a) > 2 else 1)
NAME = {'r': 'pillbox_round_be', 'n': 'tent_ridge_field', 'd': 'bulldozer_rusty'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()


def ring_pts(rad, n=24, z=0.0, a0=0.0):
    return [V((rad * math.cos(a0 + 2 * math.pi * k / n), rad * math.sin(a0 + 2 * math.pi * k / n), z)) for k in range(n)]


if VAR == 'r':
    RO, RI, H, N = 2.2, 1.5, 2.35, 28                  # wall outer radius, inner, wall top, segments
    EMB = [-90, -45, -135]                             # embrasure headings (Blender: -90 = -Y = front / game S)
    bm = bmesh.new()
    C = __import__('kit_core')
    rings = [ring_pts(RO + 0.15, N, -0.1), ring_pts(RO + 0.08, N, 0.35), ring_pts(RO, N, 0.5), ring_pts(RO, N, H)]
    C.loft_bm(bm, rings)
    K.part(bm, 'concrete_camo', name='wall', grime=0.7, uv='aligned')
    # roof slab (overhang 0.35) + chamfer + earth cap with turf
    bm = bmesh.new()
    C.loft_bm(bm, [ring_pts(RO + 0.35, N, H - 0.02), ring_pts(RO + 0.35, N, H + 0.42), ring_pts(RO + 0.1, N, H + 0.55)],
              close_start=True, close_end=True)
    K.part(bm, 'concrete_formwork', name='roof_slab', mat_tint=(0.78, 0.77, 0.72), grime=0.8)
    bm = bmesh.new()
    C.loft_bm(bm, [ring_pts(RO + 0.05, N, H + 0.5), ring_pts(1.6, N, H + 0.78), ring_pts(0.6, N, H + 0.88)], close_start=True, close_end=True)
    K.part(bm, 'sod', name='turf_cap', mat_tint=(0.75, 0.8, 0.62), grime=0.2)
    # embrasures: dark recessed slot boxes + stepped concrete reveals + a steel shutter plate above
    for hdeg in EMB:
        h = math.radians(hdeg); c, s = math.cos(h), math.sin(h)
        o = V((c * (RO + 0.02), s * (RO + 0.02), 1.35))
        bm = bmesh.new()
        K.box_bm(bm, o, (0.8, 0.12, 0.2), rot_z=h + math.pi / 2)
        K.part(bm, 'interior_dark', name='slot', mat_tint=(0.06, 0.06, 0.06))
        bm = bmesh.new()
        for dz, w in ((0.19, 1.2), (-0.19, 1.2)):
            K.box_bm(bm, o + V((c * 0.06, s * 0.06, dz)), (w, 0.2, 0.18), rot_z=h + math.pi / 2)
        for side in (-1, 1):
            K.box_bm(bm, o + V((-s * side * 0.6 + c * 0.06, c * side * 0.6 + s * 0.06, 0)), (0.14, 0.2, 0.52), rot_z=h + math.pi / 2)
        K.part(bm, 'concrete_formwork', name='reveal', mat_tint=(0.7, 0.69, 0.65), grime=0.8)
        bm = bmesh.new()
        K.box_bm(bm, o + V((c * 0.2, s * 0.2, 0.4)), (0.86, 0.04, 0.16), rot_z=h + math.pi / 2)
        K.part(bm, 'steel_painted', name='shutter', mat_tint=(0.52, 0.52, 0.44), lod='drop')
        K.anchor('mg', (o.x, o.y, 1.35), (c, s, 0), kind='mg_post')
    # rear entrance: a sunken stair pocket walled in concrete and a steel door in a frame (N side, +Y)
    bm = bmesh.new()
    for x in (-0.65, 0.65):
        K.box_bm(bm, (x, RO - 0.05, 0.95), (0.25, 0.5, 1.9))
    K.box_bm(bm, (0, RO - 0.05, 2.0), (1.55, 0.5, 0.25))
    K.part(bm, 'concrete_formwork', name='door_frame', mat_tint=(0.72, 0.71, 0.66))
    bm = bmesh.new()
    K.box_bm(bm, (0, RO + 0.17, 0.95), (1.0, 0.06, 1.8))
    for z in (0.4, 0.95, 1.5):
        K.box_bm(bm, (0, RO + 0.21, z), (0.95, 0.04, 0.06))
    K.part(bm, 'steel_painted', name='rear_door', mat_tint=(0.3, 0.33, 0.29))
    # sandbags against the base on the front arc + a few loose ones
    bm = bmesh.new()
    for k in range(16):
        ang = math.radians(-160 + k * 9.5)
        if any(abs(ang - math.radians(e)) < 0.2 for e in EMB):
            continue
        for row in range(2):
            rad = RO + 0.2 - row * 0.04
            K.box_bm(bm, (rad * math.cos(ang), rad * math.sin(ang), 0.13 + row * 0.24), (0.55, 0.3, 0.22), rot_z=ang + math.pi / 2 + (row * 0.1))
    K.part(bm, 'burlap_bag', name='sandbags', mat_tint=(0.72, 0.66, 0.52), grime=0.5, lod='drop')
    K.decal('moss_patch', (0, -RO - 0.02, 0.4), (0, -1, 0), 1.5, 0.6, alpha=0.4)
    K.decal('streak_long', (0.8, -RO - 0.02, 1.8), (0, -1, 0), 0.8, 1.2, alpha=0.4)
    K.footprint([((RO + 0.1) * math.cos(t), (RO + 0.1) * math.sin(t)) for t in [2 * math.pi * k / 16 for k in range(16)]], 'HIGH', 'bunker')
    K.anchor('roof_ridge', (0, 0, H + 0.88))

if VAR == 'n':
    C = __import__('kit_core')
    L, Wd, HW, HR = 4.8, 3.0, 0.75, 2.15              # body length (x), width (y), wall height, ridge height
    x0, x1, y0, y1 = -L / 2, L / 2, -Wd / 2, Wd / 2
    TINT = (0.62, 0.6, 0.48)
    sag = lambda x: -0.06 * math.cos(math.pi * x / L * 2) * 0.5   # canvas sags between the uprights
    xs = [x0 + L * k / 8 for k in range(9)]
    for side in (-1, 1):                                # side walls (shaded tone) and roof slopes, sagging mid-slope
        bmw, bmr = bmesh.new(), bmesh.new()
        for xa, xb in zip(xs, xs[1:]):
            def ring(x):
                mid = 0.0 if abs(x - x0) < 1e-3 or abs(x - x1) < 1e-3 else 1.0
                sg = 0.11 * mid * (0.6 + 0.4 * math.sin(math.pi * ((x - x0) / L * 2 % 1)))
                return [V((x, side * (Wd / 2), 0.02)), V((x, side * (Wd / 2 + 0.03), HW)),
                        V((x, side * (Wd / 4 + 0.06), (HW + HR) / 2 - sg)), V((x, 0, HR))]
            a, b = ring(xa), ring(xb)
            C.quad(bmw, [a[0], b[0], b[1], a[1]], flip=side > 0)
            for k in (1, 2):
                C.quad(bmr, [a[k], b[k], b[k + 1], a[k + 1]], flip=side > 0)
        K.part(bmw, 'tent_canvas', name='walls%d' % side, mat_tint=(0.5, 0.49, 0.39), grime=0.7)
        K.part(bmr, 'tent_canvas', name='roof%d' % side, mat_tint=TINT, grime=0.4)
    bm = bmesh.new()                                    # eave valance strips + a ridge cap
    for side in (-1, 1):
        K.beam_bm(bm, (x0, side * (Wd / 2 + 0.05), HW + 0.02), (x1, side * (Wd / 2 + 0.05), HW + 0.02), 0.03, 0.14)
    K.beam_bm(bm, (x0, 0, HR + 0.03), (x1, 0, HR + 0.03), 0.22, 0.04)
    K.part(bm, 'tent_canvas', name='valance', mat_tint=(0.44, 0.43, 0.34), lod='drop')
    # end walls: W closed; E with the door flaps rolled up (an opening with a dark interior behind it)
    bm = bmesh.new()
    pent = lambda x: [V((x, -Wd / 2, 0.02)), V((x, -Wd / 2, HW)), V((x, 0, HR)), V((x, Wd / 2, HW)), V((x, Wd / 2, 0.02))]
    p = pent(x0)
    C.quad(bm, [p[0], p[1], p[3], p[4]]); bm.faces.new([bm.verts.new(p[1]), bm.verts.new(p[2]), bm.verts.new(p[3])])
    p = pent(x1)
    C.quad(bm, [p[4], p[3], V((x1, 0.45, 1.75)), V((x1, 0.45, 0.02))])
    C.quad(bm, [V((x1, -0.45, 0.02)), V((x1, -0.45, 1.75)), p[1], p[0]])
    bm.faces.new([bm.verts.new(V((x1, -0.45, 1.75))), bm.verts.new(V((x1, 0.45, 1.75))), bm.verts.new(p[2])])
    K.part(bm, 'tent_canvas', name='ends', mat_tint=TINT, grime=0.5)
    bm = bmesh.new()
    K.box_bm(bm, (x1 - 0.25, 0, 0.88), (0.04, 0.9, 1.72))
    K.part(bm, 'interior_dark', name='inside', mat_tint=(0.08, 0.08, 0.07))
    bm = bmesh.new()                                    # rolled flaps tied above the door
    for s in (-1, 1):
        K.cyl_bm(bm, (x1 + 0.06, s * 0.5, 0.6), (x1 + 0.06, s * 0.5, 1.7), 0.09, 8)
    K.part(bm, 'tent_canvas', name='flaps', mat_tint=(0.55, 0.53, 0.42), smooth=True)
    bm = bmesh.new()                                    # ridge pole + two uprights
    K.cyl_bm(bm, (x0 - 0.12, 0, HR + 0.02), (x1 + 0.12, 0, HR + 0.02), 0.035, 6)
    for x in (x0 + 0.02, x1 - 0.02):
        K.cyl_bm(bm, (x, 0, 0), (x, 0, HR + 0.15), 0.03, 6)
    K.part(bm, 'timber_beam', name='poles', mat_tint=(0.45, 0.38, 0.3), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()                                    # guy ropes from the eaves / pole tops to pegs (inside 5 x 3.5)
    for x in (x0 + 0.3, 0.0, x1 - 0.3):
        for s in (-1, 1):
            K.cyl_bm(bm, (x, s * (Wd / 2 + 0.02), HW), (x, s * 1.72, 0.05), 0.02, 4)
    K.cyl_bm(bm, (x0, 0, HR + 0.1), (x0 - 0.06, 0, 0.05), 0.012, 4)
    K.part(bm, 'hessian', name='ropes', mat_tint=(0.7, 0.66, 0.55), lod='drop')
    bm = bmesh.new()
    for x in (x0 + 0.3, 0.0, x1 - 0.3):
        for s in (-1, 1):
            K.box_bm(bm, (x, s * 1.72, 0.06), (0.04, 0.04, 0.16))
    K.part(bm, 'timber_beam', name='pegs', mat_tint=(0.5, 0.42, 0.32), lod='drop')
    bm = bmesh.new()                                    # ditched hem: a darker earth band dug round the tent
    K.prism_bm(bm, K.poly_offset([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 0.18), -0.02, 0.03)
    K.part(bm, 'mud', name='ditch', mat_tint=(0.55, 0.47, 0.38), grime=0.2)
    bm = bmesh.new()                                    # kit by the door: an ammunition box and a jerrycan
    K.box_bm(bm, (x1 - 0.1, 1.55, 0.16), (0.5, 0.3, 0.32))
    K.box_bm(bm, (x1 - 0.2, -1.6, 0.24), (0.35, 0.18, 0.48))
    K.part(bm, 'steel_painted', name='kit', mat_tint=(0.35, 0.37, 0.3), lod='drop')
    K.footprint_rect(0, 0, 5.0, 3.5, 0, 'HIGH', 'tent')
    K.anchor('roof_ridge', (0, 0, HR))

if VAR == 'd':                                          # the rebuilt crawler: maas_dozer.py (running gear, body, dozer)
    import maas_dozer as DZ
    from eu_common import foliage
    C = __import__('kit_core')
    DZ.build(K, C, V, r, foliage)
    DZ.build_body(K, C, V, r)
    DZ.build_works(K, C, V, r)
    DZ.build_blade(K, C, V, r, foliage)

finish(os.path.join(ROOT, NAME))
