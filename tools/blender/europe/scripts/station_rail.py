"""Railway station building (French Nord / Belgian rural 'gare', c. 1880-1910; M18 Maas station, M16 map): two-storey
station-master's block with hipped slate roof flanked by single-storey waiting-room / ticket-office wings, timber goods
shed with loading dock at the east end, raised platform with dressed edge on the track side (north), cast-iron
column canopy (marquise) with saw-tooth valance, clock, station lamps, benches, signs.
 a = red brick + limestone dressings   b = cream render + brick quoins/surrounds (PLM style)
Tracks run along X north of the platform (not included). usage: blender -b --python station_rail.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import (K, V, args, DOOR, SHUTTER, pick, finish, use_cheap_windows, roof_tone, roof_ridge, ridge_tiles, roof_decals,
                       eave_streaks)
use_cheap_windows()

OUT, VAR, SEED = args('station_rail_a')
K.begin('station_rail_' + VAR, SEED, theater='temperate')
r = K.rng()
WALL = 'brick_red' if VAR == 'a' else 'plaster_limewash'
WT = None if VAR == 'a' else (1.0, 0.93, 0.8)
DR = 'ashlar_limestone' if VAR == 'a' else 'brick_red'
T = 0.45
FC = (0.30, 0.36, 0.34) if VAR == 'a' else (0.55, 0.30, 0.22)          # joinery colour
ZINC = (0.70, 0.72, 0.73)          # rework3: weathered zinc gutters / hip rolls (were near-black cast iron -> ink outlines)
ZINC_RIDGE = (0.62, 0.64, 0.66)


def block(x0, x1, y0, y1, ze, storeys, name, roof='hip', pitch=38, doors_front=(), doors_back=(), wins=None, ends=(1, 3), end_sill=1.0, nb=None):
    poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    L = x1 - x0
    nb = nb or max(2, int(round(L / 2.8)))
    fr, wl, dl = [], [], []
    for side, edge, dset in (('f', 0, doors_front), ('b', 2, doors_back)):
        for k in range(nb):
            t = L * (k + 0.5) / nb
            if k in dset:
                f = K.opening(poly, edge, t, 1.3, 2.9, 0.12, T, 'segment', 'door')
                dl.append((f, '%s_%s%d' % (name, side, k)))
            else:
                f = K.opening(poly, edge, t, 1.2, 2.4, 0.9, T, 'segment')
                wl.append(f)
            fr.append(f)
            if storeys > 1:
                f = K.opening(poly, edge, t, 1.1, 1.9, 4.1, T, 'segment')
                fr.append(f); wl.append(f)
    for edge in ends:
        f = K.opening(poly, edge, (y1 - y0) / 2, 1.1, 2.2 if end_sill < 2 else 1.9, end_sill, T, 'segment')
        fr.append(f); wl.append(f)
    K.wall_ring(poly, ze, T, WALL, fr, plinth=('granite', 0.5, 0.04), name=name + '_walls', mat_tint=WT)
    K.quoins(poly, 0.5, ze, DR, block_h=0.62, long=0.55, short=0.3, name=name + '_quoins')
    if storeys > 1:
        K.course(poly, 3.55, 0.2, 0.06, DR, name=name + '_course')
    K.cornice(poly, ze - 0.54, DR, steps=((0.05, 0.1), (0.12, 0.1), (0.2, 0.08)), name=name + '_cornice')
    for k, f in enumerate(wl):
        K.window(f, 'casement', (2, 2), frame=FC if VAR == 'a' else 'white', sill=DR, lintel=None, surround=None,
                 shutters=('open' if k % 4 else 'closed') if (VAR == 'b' and f.o.z > 3) else None, shutter_color=SHUTTER['grey'],
                 shutter_style='plank', curtain=0.6 if f.o.z > 3 else 0.2, name='%s_w%d' % (name, k))
    for f, did in dl:
        K.door(f, did, 'glazed', FC, step='granite', lintel=DR)
    if roof == 'hip':
        R = K.roof_hip((x0 + x1) / 2, (y0 + y1) / 2, L, y1 - y0, ze, pitch, 'roof_slate', eave_oh=0.45, thick=0.12,
                       fascia='wood_paint', gutters=False, sag=0.02, wobble=0.008, name=name + '_roof')
        eave_gutter(poly, ze, 0.45, pitch, hip=True)
    else:
        R = K.roof_gable((x0 + x1) / 2, (y0 + y1) / 2, L, y1 - y0, ze, pitch, 'roof_slate', eave_oh=0.45, gable_oh=0.35,
                         fascia='wood_paint', barge='wood_paint', gutters=False, sag=0.02, name=name + '_roof')
        K.gable(poly, 1, ze, R.z_ridge - R.lift, T, WALL, name=name + '_ge', mat_tint=WT)
        K.gable(poly, 3, ze, R.z_ridge - R.lift, T, WALL, name=name + '_gw', mat_tint=WT)
        eave_gutter(poly, ze, 0.45, pitch, hip=False)
    slope_uv(R)
    roof_tone(R, amp=0.2, scale=0.4, seed=len(name))
    roof_ridge(R, eave_oh=0.45, mid='paint_metal', tint=ZINC_RIDGE, r=0.085, hip=roof == 'hip', finials=roof == 'hip',
               crest=False, overhang=0.35, seg=0.75)
    roof_decals(R, 3, seed=len(name))
    return R


def eave_gutter(poly, ze, eoh, pitch, hip=True):
    """Ogee zinc gutter along the long eaves (and hip ends) + two downpipes with shoes; cheap (6-sided)."""
    (x0, y0), (x1, _), (_, y1) = poly[0], poly[1], poly[2]
    zg = ze - eoh * math.tan(math.radians(pitch)) - 0.01          # rework3: slimmer, tucked under the slate edge
    bm = bmesh.new()
    for yy in (y0 - eoh - 0.03, y1 + eoh + 0.03):
        K.cyl_bm(bm, (x0 - eoh, yy, zg), (x1 + eoh, yy, zg), 0.05, 6)
    if hip:
        for xx in (x0 - eoh - 0.03, x1 + eoh + 0.03):
            K.cyl_bm(bm, (xx, y0 - eoh, zg), (xx, y1 + eoh, zg), 0.05, 6)
    for xx, yy, s_ in ((x0 + 0.3, y0, -1), (x1 - 0.3, y1, 1)):
        yw = yy + s_ * 0.07
        for a_, b_ in (((xx, yy + s_ * (eoh + 0.03), zg), (xx, yw, zg - 0.35)), ((xx, yw, zg - 0.35), (xx, yw, 0.3)), ((xx, yw, 0.3), (xx, yw + s_ * 0.25, 0.08))):
            K.cyl_bm(bm, a_, b_, 0.05, 6)
    K.part(bm, 'paint_metal', name='gutter', smooth=True, grime=0.35, mat_tint=ZINC)


def slope_uv(R):
    """rework3: one planar UV basis per roof facet (area-weighted facet normal) instead of per-face bases: the sagged /
    wobbled faces each got a slightly rotated basis -> slate courses jumped between faces and the hip facets (with their
    collapsed apex row) looked smeared/stretched. Courses now run parallel to each eave, 1 UV = tile_m metres."""
    import kit_core as KC
    t = KC.tile_of('roof_slate')
    for o in R.parts:
        if not ('slope' in o.name or 'hip' in o.name):
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
        top = [f for f in bm.faces if f.normal.z > 0.25]
        n = V((0, 0, 0))
        for f in top:
            n += f.normal * f.calc_area()
        n.normalize()
        bu = V((0, 0, 1)).cross(n).normalized()
        bv = n.cross(bu).normalized()
        for f in top:
            for l in f.loops:
                p = l.vert.co
                l[lay].uv = (p.dot(bu) / t + 0.37, p.dot(bv) / t + 0.21)
        bm.to_mesh(o.data); bm.free()


def clock_aedicule(x, yf, ze, n=-1, w=1.9):
    """Stone clock pediment rising through the eaves (fronton horloge): pilasters, cornice, triangular pediment with
    coping, a white enamel dial in a moulded bezel with 12 hour marks and shaped hands."""
    t = 0.4
    yc = yf + n * 0.02
    bm = bmesh.new()
    K.box_bm(bm, (x, yc - n * t / 2, ze + 0.75), (w, t, 1.9))
    K.hexa_bm(bm, [(x - w / 2, yc - n * t, ze + 1.7), (x + w / 2, yc - n * t, ze + 1.7), (x + w / 2, yc, ze + 1.7), (x - w / 2, yc, ze + 1.7),
                   (x - 0.02, yc - n * t, ze + 2.45), (x + 0.02, yc - n * t, ze + 2.45), (x + 0.02, yc, ze + 2.45), (x - 0.02, yc, ze + 2.45)])
    K.part(bm, WALL if VAR == 'a' else 'plaster_limewash', name='clock_wall', mat_tint=WT)
    bm = bmesh.new()
    for sx in (-1, 1):
        K.box_bm(bm, (x + sx * (w / 2 - 0.12), yc + n * 0.04, ze + 0.75), (0.26, 0.1, 1.9))                       # pilasters
        K.beam_bm(bm, V((x + sx * (w / 2 + 0.12), yc + n * 0.06, ze + 1.72)), V((x, yc + n * 0.06, ze + 2.52)), 0.16, 0.22)   # raking coping
    K.box_bm(bm, (x, yc + n * 0.06, ze + 1.64), (w + 0.3, 0.2, 0.16))                                           # cornice
    K.box_bm(bm, (x, yc + n * 0.02, ze + 2.62), (0.2, 0.2, 0.3), taper=(0.3, 0.3))                             # acroterion
    K.part(bm, DR, name='clock_dress')
    c = V((x, yc + n * 0.05, ze + 0.85))
    nv = V((0, n, 0))
    K.P(DR, K.cyl_bm, tuple(c - nv * 0.05), tuple(c + nv * 0.07), 0.62, 20, name='clock_bezel')
    K.P('plaster_white', K.cyl_bm, tuple(c + nv * 0.07), tuple(c + nv * 0.09), 0.52, 20, name='clock_face', mat_tint=(1.0, 0.98, 0.92))
    bm = bmesh.new()
    for k in range(12):
        a = 2 * math.pi * k / 12
        d = V((math.sin(a), 0, math.cos(a)))
        L_ = 0.1 if k % 3 == 0 else 0.06
        K.beam_bm(bm, c + nv * 0.1 + d * (0.46 - L_), c + nv * 0.1 + d * 0.46, 0.035 if k % 3 == 0 else 0.022, 0.01, up=nv)
    K.cyl_bm(bm, c + nv * 0.09, c + nv * 0.13, 0.04, 8)
    for ang, L_, wd in ((0.35, 0.28, 0.05), (-2.2, 0.42, 0.03)):
        d = V((math.sin(ang), 0, math.cos(ang)))
        K.hexa_bm(bm, [c + nv * 0.11 - d * 0.06 + V((d.z, 0, -d.x)) * wd, c + nv * 0.11 + d * L_, c + nv * 0.12 + d * L_, c + nv * 0.12 - d * 0.06 + V((d.z, 0, -d.x)) * wd,
                       c + nv * 0.11 - d * 0.06 - V((d.z, 0, -d.x)) * wd, c + nv * 0.11 + d * L_ * 0.98, c + nv * 0.12 + d * L_ * 0.98, c + nv * 0.12 - d * 0.06 - V((d.z, 0, -d.x)) * wd])
    K.part(bm, 'cast_iron', name='clock_hands_marks', grime=0.0, bisect=False)


GOODS = VAR == 'goods'
if GOODS:
    VAR = 'a'
Y0, Y1 = -3.6, 3.6
if not GOODS:
    Rm = block(-4.2, 4.2, Y0 - 0.3, Y1 + 0.3, 7.0, 2, 'main', 'hip', 40, doors_front=(1,), doors_back=(1,), end_sill=4.1)
    Rw = block(-12.0, -4.25, Y0, Y1 - 0.4, 4.0, 1, 'wingw', 'gable', 30, doors_front=(1,), doors_back=(0,), ends=(3,), nb=2)
    Re = block(4.25, 11.0, Y0, Y1 - 0.4, 4.0, 1, 'winge', 'gable', 30, doors_front=(), doors_back=(1,), ends=(1,), nb=2)
    K.chimney(-2.2, 0.8, 7.0, Rm.z_ridge + 0.6, 0.7, 0.5, 'brick_red', cap='ashlar', pots=2)
    K.chimney(2.2, -0.8, 7.0, Rm.z_ridge + 0.4, 0.7, 0.5, 'brick_red', cap='ashlar', pots=2)
    K.chimney(-9.5, 0.4, 4.0, Rw.z_ridge + 0.5, 0.6, 0.45, 'brick_red', cap='ashlar', pots=1, name='chim_w')
    K.chimney(8.5, 0.4, 4.0, Re.z_ridge + 0.5, 0.6, 0.45, 'brick_red', cap='ashlar', pots=1, name='chim_e')
    from eu_common import skylights
    skylights(Rw, [(-1.2, -1.6), (1.6, 1.6)], 0.55, 0.75, name='sky_w')
    skylights(Re, [(0.8, -1.6), (-1.4, 1.6)], 0.55, 0.75, name='sky_e')
    K.anchor('roof_ridge', (0, 0, Rm.z_ridge))
    # clock pediments (street front + platform side) cut through the hip-roof eaves like wall dormers
    import eu_dmg
    for yf, n in ((Y0 - 0.3, -1), (Y1 + 0.3, 1)):
        eu_dmg.carve([eu_dmg.Box((0, yf + n * 0.14, 7.0 + 1.3), (1, 0, 0), (0, 1, 0), (0, 0, 1), (1.0, 0.56, 1.5))],
                     only=lambda o: o.name.startswith(('main_roof', 'gutter')))
        clock_aedicule(0.0, yf, 7.0 - 0.1, n)
    K.sign((0, Y0 - 0.33, 3.85), (0, -1, 0), 3.2, 'cafe_gare', board='wood_paint')
    K.sign((-8.1, Y1 - 0.38, 3.2), (0, 1, 0), 1.6, 'post', board='wood_paint')
    K.wall_lantern((-4.25, Y0, 0), (0, -1, 0), 3.2)
    K.wall_lantern((4.25, Y0, 0), (0, -1, 0), 3.2)

if GOODS:
    # ---- goods shed (halle) with loading dock -----------------------------------------------------------------------------
    gx0, gx1, gy0, gy1 = 11.6, 21.6, -3.0, 3.0
    gp = [(gx0, gy0), (gx1, gy0), (gx1, gy1), (gx0, gy1)]
    gdf = K.opening(gp, 0, 5.0, 3.0, 3.0, 1.1, 0.3, 'rect', 'door')
    gdb = K.opening(gp, 2, 5.0, 3.0, 3.0, 1.1, 0.3, 'rect', 'door')
    K.P('ashlar', K.box_bm, ((gx0 + gx1) / 2, 0, 0.55), (gx1 - gx0 + 0.3, gy1 - gy0 + 0.3, 1.1), name='dock_base')
    K.wall_ring(gp, 5.0 - 1.1, 0.3, 'timber_siding', [gdf, gdb], z0=1.1, name='shed_walls', footprint=False, mat_tint=(0.75, 0.62, 0.5))
    K.footprint(gp, 'HIGH')
    for f, did in ((gdf, 'goods_s'), (gdb, 'goods_n')):
        K.door(f, did, 'barn', (0.42, 0.33, 0.25), step=None, lintel='timber_beam')
    bm = bmesh.new()
    for x in [gx0 + 0.1 + k * 2.0 for k in range(6)]:
        for y in (gy0 - 0.05, gy1 + 0.05):
            K.beam_bm(bm, (x, y, 1.1), (x, y, 5.0), 0.16, 0.12)
    K.part(bm, 'timber_beam', name='shed_posts', uv='beam', axis=(0, 0, 1))
    Rg = K.roof_gable((gx0 + gx1) / 2, 0, gx1 - gx0, gy1 - gy0, 5.0, 22, 'roof_slate', eave_oh=1.2, gable_oh=0.4, thick=0.1,
                      fascia='wood_paint', barge='wood_paint', gutters=False, sag=0.04, name='shed_roof')
    K.gable(gp, 1, 5.0, Rg.z_ridge - Rg.lift, 0.3, 'timber_siding', name='shed_ge', mat_tint=(0.75, 0.62, 0.5))
    K.gable(gp, 3, 5.0, Rg.z_ridge - Rg.lift, 0.3, 'timber_siding', name='shed_gw', mat_tint=(0.75, 0.62, 0.5))
    K.stairs((gx0 + 2.0, gy0 - 1.9, 0), (0, 1, 0), 1.4, 1.1, 6, 'ashlar', name='dock_steps')
    roof_tone(Rg, amp=0.2, seed=3)
    slope_uv(Rg)
    roof_ridge(Rg, mid='paint_metal', tint=ZINC_RIDGE, r=0.085, finials=False, overhang=0.4)
    bm = bmesh.new()                                    # two louvred ridge ventilators
    for xv in (gx0 + 3.0, gx1 - 3.0):
        zr_ = Rg.z_ridge
        K.box_bm(bm, (xv, 0, zr_ + 0.25), (0.9, 0.9, 0.5))
        K.hexa_bm(bm, [(xv - 0.6, -0.6, zr_ + 0.5), (xv + 0.6, -0.6, zr_ + 0.5), (xv + 0.6, 0.6, zr_ + 0.5), (xv - 0.6, 0.6, zr_ + 0.5),
                       (xv - 0.6, -0.02, zr_ + 0.85), (xv + 0.6, -0.02, zr_ + 0.85), (xv + 0.6, 0.02, zr_ + 0.85), (xv - 0.6, 0.02, zr_ + 0.85)])
    K.part(bm, 'timber_siding', name='ridge_vents', mat_tint=(0.7, 0.6, 0.5))
    bm = bmesh.new()
    for xv in (gx0 + 3.0, gx1 - 3.0):
        for sy in (-1, 1):
            for k in range(3):
                z_ = Rg.z_ridge + 0.08 + k * 0.14
                K.beam_bm(bm, (xv - 0.4, sy * 0.46, z_), (xv + 0.4, sy * 0.46, z_), 0.1, 0.02, up=V((0, sy * 0.7, 0.7)))
    K.part(bm, 'timber_tarred', name='vent_louvres')
    bm = bmesh.new()                                    # sliding-door tracks with hangers
    for f in (gdf, gdb):
        a_ = f.p(-f.w / 2 - f.w, f.h + 0.12, 0.08); b_ = f.p(f.w / 2 + 0.2, f.h + 0.12, 0.08)
        K.beam_bm(bm, a_, b_, 0.06, 0.12)
        for x_ in (-f.w / 2 + 0.3, f.w / 2 - 0.3):
            K.beam_bm(bm, f.p(x_, f.h + 0.2, 0.1), f.p(x_, f.h - 0.15, 0.1), 0.05, 0.02)
            K.cyl_bm(bm, f.p(x_, f.h + 0.2, 0.14), f.p(x_, f.h + 0.2, 0.06), 0.07, 8)
        K.box_bm(bm, tuple(f.p(-f.w / 2 - f.w + 0.05, f.h / 2, 0.04)), (0.08, 0.08, 0.3))           # stop
    K.part(bm, 'cast_iron', name='door_tracks', grime=0.3)
    # dock canopy on the track side (iron brackets), awning over the road-side dock door
    bm = bmesh.new()
    for yy, sgn, L_ in ((gy1, 1, 2.6), (gy0, -1, 1.6)):
        for k in range(6 if sgn > 0 else 2):
            x_ = gx0 + 0.5 + k * (gx1 - gx0 - 1.0) / 5 if sgn > 0 else gdf.o.x + (k - 0.5) * 2.6
            K.beam_bm(bm, (x_, yy + sgn * 0.02, 3.7), (x_, yy + sgn * L_, 4.55), 0.06, 0.14)
            K.beam_bm(bm, (x_, yy + sgn * 0.02, 2.7), (x_, yy + sgn * L_ * 0.6, 4.3), 0.05, 0.1)
    K.part(bm, 'steel_painted', name='canopy_iron', mat_tint=FC)
    K.roof_shed(gx0 - 0.2, gy1, gx1 + 0.2, gy1 + 2.7, 4.35, 4.85, 'corrugated_galv', low_side='+y', oh=0.05, name='dock_canopy', gutters=True)
    K.roof_shed(gdf.o.x - 2.3, gy0 - 1.7, gdf.o.x + 2.3, gy0, 4.1, 4.6, 'corrugated_galv', low_side='-y', oh=0.05, name='door_awning', gutters=False)
    # hand crane on the dock + platform weighbridge (pont-bascule) with its little scale house
    bm = bmesh.new()
    cx_, cy_ = gx1 - 1.2, gy1 + 0.7
    K.cyl_bm(bm, (cx_, cy_, 1.1), (cx_, cy_, 4.0), 0.12, 8)
    K.cyl_bm(bm, (cx_, cy_, 1.1), (cx_, cy_, 1.35), 0.3, 8)
    K.beam_bm(bm, (cx_, cy_, 3.9), (cx_ + 2.2, cy_ + 1.2, 3.6), 0.12, 0.18)
    K.beam_bm(bm, (cx_, cy_, 2.2), (cx_ + 2.0, cy_ + 1.1, 3.55), 0.08, 0.1)
    K.cyl_bm(bm, (cx_ + 2.1, cy_ + 1.15, 3.55), (cx_ + 2.1, cy_ + 1.15, 1.9), 0.02, 4)
    K.box_bm(bm, (cx_ + 2.1, cy_ + 1.15, 1.85), (0.12, 0.05, 0.14))
    K.cyl_bm(bm, (cx_ + 0.15, cy_ - 0.25, 2.0), (cx_ + 0.15, cy_ + 0.25, 2.0), 0.22, 10)                     # winch drum
    K.part(bm, 'steel_painted', name='dock_crane', mat_tint=(0.25, 0.27, 0.26))
    K.P('steel_grating', K.box_bm, (gx0 - 3.2, gy0 - 2.5, 0.02), (3.2, 2.2, 0.04), name='weighbridge', mat_tint=(0.7, 0.7, 0.7))
    sp_ = [(gx0 - 5.4, gy0 - 3.4), (gx0 - 4.4, gy0 - 3.4), (gx0 - 4.4, gy0 - 2.2), (gx0 - 5.4, gy0 - 2.2)]
    swin = K.opening(sp_, 1, 0.6, 0.6, 0.6, 1.0, 0.15)
    K.wall_ring(sp_, 2.3, 0.15, 'timber_siding', [swin], name='scale_house', mat_tint=(0.75, 0.62, 0.5))
    K.window(swin, 'fixed', (1, 1), frame='white', sill=None, name='scale_win', streak=False)
    K.roof_shed(sp_[0][0], sp_[0][1], sp_[1][0], sp_[2][1], 2.3, 2.6, 'corrugated_galv', low_side='-y', oh=0.12, name='scale_roof', gutters=False)
    K.roof_meta([(gx0 - 0.15, gy0 - 0.15), (gx1 + 0.15, gy0 - 0.15), (gx1 + 0.15, gy1 + 0.15), (gx0 - 0.15, gy1 + 0.15)], 1.1, walkable=True, kind='dock')
    # crates / sacks on the dock
    bm = bmesh.new()
    for k in range(5):
        K.box_bm(bm, (gx0 + 6.5 + (k % 3) * 0.75, gy0 - 0.1 - 0.4, 1.1 + 0.3 + (k // 3) * 0.6), (0.7, 0.7, 0.6), r.uniform(-0.1, 0.1))
    K.part(bm, 'door_planks', name='crates', uv='beam', axis=(1, 0, 0), tint=(0.8, 0.72, 0.6))

if not GOODS:
    # ---- platform + marquise (canopy) on the track side --------------------------------------------------------------------
    px0, px1, py0, py1, pz = -20.0, 24.0, Y1 - 0.4, Y1 + 5.0, 0.55
    bm = bmesh.new()
    K.box_bm(bm, ((px0 + px1) / 2, py1 - 0.3, pz / 2), (px1 - px0, 0.6, pz))
    K.part(bm, 'ashlar_limestone', name='platform_edge')
    K.P('gravel', K.box_bm, ((px0 + px1) / 2, (py0 + py1 - 0.6) / 2, pz / 2 - 0.02), (px1 - px0, py1 - py0 - 0.6, pz - 0.04), name='platform_fill', grime=0.3)
    K.P('cobblestone', K.box_bm, ((px0 + px1) / 2, py1 - 0.9, pz - 0.02), (px1 - px0, 0.6, 0.05), name='platform_paving')
    for sx, xe in ((-1, px0), (1, px1)):     # end ramps
        bm = bmesh.new()
        K.hexa_bm(bm, [(xe, py0, 0), (xe + sx * 4, py0, 0), (xe + sx * 4, py1, 0), (xe, py1, 0),
                       (xe, py0, pz), (xe + sx * 4, py0, 0.02), (xe + sx * 4, py1, 0.02), (xe, py1, pz)] if sx > 0 else
                  [(xe + sx * 4, py0, 0), (xe, py0, 0), (xe, py1, 0), (xe + sx * 4, py1, 0),
                   (xe + sx * 4, py0, 0.02), (xe, py0, pz), (xe, py1, pz), (xe + sx * 4, py1, 0.02)])
        K.part(bm, 'ashlar', name='ramp')
    K.roof_meta([(px0, py0), (px1, py0), (px1, py1), (px0, py1)], pz, walkable=True, kind='platform')
    K.footprint([(px0, py0), (px1, py0), (px1, py1), (px0, py1)], 'NONE', 'platform')
    cx0, cx1, cz_hi, cz_lo, cy1 = -11.0, 10.5, 4.25, 3.75, py1 - 0.9
    # marquise: alternating zinc and glazed bays (reads as a rhythm from the game camera), gutter, decorative iron
    IRONC = FC if VAR == 'a' else (0.30, 0.36, 0.34)
    nbay = 18
    bz, bg = bmesh.new(), bmesh.new()
    for k in range(nbay):
        xa, xb = cx0 - 0.15 + (cx1 - cx0 + 0.3) * k / nbay, cx0 - 0.15 + (cx1 - cx0 + 0.3) * (k + 1) / nbay
        bm_ = bg if k % 3 == 1 else bz
        K.hexa_bm(bm_, [(xa, Y1, cz_hi - 0.05), (xb, Y1, cz_hi - 0.05), (xb, cy1 + 0.15, cz_lo - 0.05), (xa, cy1 + 0.15, cz_lo - 0.05),
                        (xa, Y1, cz_hi), (xb, Y1, cz_hi), (xb, cy1 + 0.15, cz_lo), (xa, cy1 + 0.15, cz_lo)])
    K.part(bz, 'corrugated_galv', name='marquise_zinc', rot90=True, grime=0.5)
    K.part(bg, 'glass_dirty', name='marquise_glass', grime=0.0, bisect=False)
    bm = bmesh.new()
    for k in range(nbay + 1):                                   # glazing / zinc bay ribs (T-irons)
        x = cx0 - 0.15 + (cx1 - cx0 + 0.3) * k / nbay
        K.beam_bm(bm, (x, Y1, cz_hi + 0.03), (x, cy1 + 0.15, cz_lo + 0.03), 0.06, 0.06)
    K.cyl_bm(bm, (cx0 - 0.2, cy1 + 0.22, cz_lo - 0.06), (cx1 + 0.2, cy1 + 0.22, cz_lo - 0.06), 0.08, 6)          # gutter
    for k in range(7):
        x = cx0 + 0.6 + k * (cx1 - cx0 - 1.2) / 6
        K.cyl_bm(bm, (x, cy1 - 0.5, pz), (x, cy1 - 0.5, cz_lo - 0.15), 0.08, 6, caps=False)
        K.cyl_bm(bm, (x, cy1 - 0.5, pz), (x, cy1 - 0.5, pz + 0.45), 0.14, 6)                      # base
        K.cyl_bm(bm, (x, cy1 - 0.5, cz_lo - 0.55), (x, cy1 - 0.5, cz_lo - 0.3), 0.08, 6, r1=0.17)   # capital
        pts = [V((x, cy1 - 0.5, cz_lo - 1.3)), V((x, cy1 - 0.2, cz_lo - 0.6)), V((x, Y1 + 1.2, cz_lo - 0.35)), V((x, Y1 + 0.1, cz_hi - 0.5))]
        for p0, p1 in zip(pts[:-1], pts[1:]):                                                      # curved bracket
            K.beam_bm(bm, p0, p1, 0.05, 0.1)
        K.beam_bm(bm, (x, cy1 + 0.1, cz_lo - 0.12), (x, Y1, cz_hi - 0.12), 0.08, 0.2)               # rafter
    K.beam_bm(bm, (cx0, cy1 - 0.5, cz_lo - 0.1), (cx1, cy1 - 0.5, cz_lo - 0.1), 0.12, 0.25)
    K.part(bm, 'steel_painted', name='marquise_iron', mat_tint=IRONC, smooth=False)
    bm = bmesh.new()                                   # saw-tooth valance (lambrequin) along the front and both ends
    yv = cy1 + 0.3
    def tooth(p, d, n_):
        a0, a1 = p, p + d * 0.36
        K.hexa_bm(bm, [a0 + V((0, 0, -0.62)) + d * 0.18 - d * 0.04, a0 + V((0, 0, -0.62)) + d * 0.18 + d * 0.04,
                       a0 + V((0, 0, -0.62)) + d * 0.18 + d * 0.04 + n_ * 0.03, a0 + V((0, 0, -0.62)) + d * 0.18 - d * 0.04 + n_ * 0.03,
                       a0, a1, a1 + n_ * 0.03, a0 + n_ * 0.03])
    n = int((cx1 - cx0 + 0.3) / 0.36)
    for k in range(n):
        tooth(V((cx0 - 0.15 + k * 0.36, yv, cz_lo + 0.02)), V((1, 0, 0)), V((0, 1, 0)))
    for xe, sgn in ((cx0 - 0.17, -1), (cx1 + 0.17, 1)):
        m_ = int((yv - Y1) / 0.36)
        for k in range(m_):
            y_ = Y1 + k * 0.36
            tooth(V((xe, y_, cz_hi - (cz_hi - cz_lo) * (y_ - Y1) / (yv - Y1) + 0.02)), V((0, 1, 0)), V((sgn, 0, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'wood_paint', name='valance', mat_tint=(0.86, 0.83, 0.72) if VAR == 'a' else (0.62, 0.34, 0.25), uv='beam', axis=(0, 0, 1))
    K.roof_meta([(cx0, Y1), (cx1, Y1), (cx1, cy1), (cx0, cy1)], cz_lo, kind='canopy')
    # benches, lamps, sign on the platform
    for x in (-7.5, -1.5, 6.5):
        bm = bmesh.new()
        for dx in (-0.8, 0.8):
            K.box_bm(bm, (x + dx, Y1 + 0.7, pz + 0.22), (0.06, 0.4, 0.44))
        K.box_bm(bm, (x, Y1 + 0.7, pz + 0.46), (1.9, 0.4, 0.05)); K.box_bm(bm, (x, Y1 + 0.52, pz + 0.75), (1.9, 0.04, 0.35))
        K.part(bm, 'wood_paint', name='bench', mat_tint=(0.35, 0.4, 0.3), uv='beam', axis=(1, 0, 0))
    for x in (-17.0, 17.0):
        K.lamp_post((x, py1 - 1.4, pz), 4.2, name='plat_lamp')
    K.sign((-14.5, py1 - 1.2, pz + 2.3), (0, 1, 0), 2.0, 'brucke_12t' if False else 'pont', board='wood_paint')
    K.P('cast_iron', K.box_bm, (-14.5, py1 - 1.26, pz + 1.1), (0.08, 0.08, 2.2), name='sign_post')
    # weathering
    for i in range(5):
        K.decal('soot', (r.uniform(-11, 10), Y1 + 0.02 if i % 2 else Y0 - 0.02, 3.2), (0, 1 if i % 2 else -1, 0), 2.0, 1.4, alpha=0.5)
        K.decal('damp_base', (r.uniform(-11, 10), Y0 - 0.06, 0.55), (0, -1, 0), 2.4, 1.0, alpha=0.6)
    K.decal('poster_fr', (-5.2, Y0 - 0.33, 1.8), (0, -1, 0), 0.7, 0.95)
    K.decal('poster_de', (5.2, Y1 + 0.33, 1.8), (0, 1, 0), 0.7, 0.95)
    K.anchor('platform_centre', (0, py1 - 1.5, pz), (0, 1, 0), kind='platform')
finish(OUT, ao_res=1024 if not GOODS else 768)
