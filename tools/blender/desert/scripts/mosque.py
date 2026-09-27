"""Tunis medina mosque (M12 landmark, after Hafsid neighbourhood mosques + the Zitouna), rework 1. ONE asset:
prayer hall + courtyard + minaret (mosque_tunis), and the minaret alone (minaret_tunis) for other maps.
- prayer hall: worn lime-wash, buttresses, merlons, spouts; five horseshoe arches opening onto a MODELLED hypostyle
  (reed-mat and carpet floor, marble columns + inner arcade, painted joist ceiling, dim qibla wall) - no black cards;
  roof: green-glazed tile gable over the axial nave, two skylight lanterns, a small dome over the entrance bay,
  screed repairs.
- main dome: ochre ashlar base + octagonal drum with blind arcades and a two-tone (ochre/white) voussoir band,
  3 m ribbed dome with 16 raised ribs, brass jamour.
- courtyard: galleries with paved floors, joist + plank ceilings, blind-arch niches and benches on the back walls,
  patio flags, ablution basin with water, portal with darj-wa-ktaf spandrel panel + studded green doors.
- minaret: ochre sandstone shaft with white limestone bands, darj-wa-ktaf panels framed in limestone on every face,
  paired arched lights at three levels, corbelled balcony, lantern with ablaq arches, green tiled cap + jamour.
Usage: blender -b --python mosque.py -- outdir [all|minaret] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh

av = dz.argv()
OUT = av[0]
PART = av[1] if len(av) > 1 else 'all'
SEED = int(av[2]) if len(av) > 2 else 61
K.begin({'all': 'mosque_tunis', 'minaret': 'minaret_tunis'}[PART], SEED, theater='desert')
r = K.rng()
PL, STONE, SCREED, OCH = 'limewash_worn', 'ashlar_limestone', 'screed_roof', 'sandstone_ochre'
GREEN = (0.42, 0.72, 0.52)
GTILE = (0.62, 1.0, 0.74)       # glazed green tiles = slate texture x green tint (terracotta x green went olive-brown)
X = 8.0
HY0, HY1, HH = 2.0, 12.0, 6.2
CY0, CH = -8.0, 4.4
GD = 2.6
MX, MY, MS = -X - 1.6, CY0 + 1.6, 3.2
ZB, ZC = 15.0, 19.4
ROOF_T = (0.97, 0.95, 0.92)


def blind_arch(c, n, w, h, mid=PL, tint=(0.8, 0.77, 0.72), frame=STONE, name='blind', depth=0.12, n_arc=6, jambs=True):
    """Blind (recessed-looking) arch: darker plaster arch panel + projecting stone frame. No black."""
    n = V(n).normalized()
    rv = V((-n.y, n.x, 0))
    fr = dz.HFrame(KA.Frame(V(c), n, rv, w, h, 0.2, 'arch'), 0.12)
    bm = bmesh.new()
    KA.lpoly(bm, fr, fr.outline(n_arc), 0.004)
    K.part(bm, mid, name=name + '_p', mat_tint=tint, grime=0.6, bisect=False)
    dz.arch_surround(fr, frame, 0.09, proud=0.03, stripes=False, name=name + '_f', n_arc=n_arc, jambs=jambs)
    return fr


def prayer_hall():
    hall = [(-X, HY0), (X, HY0), (X, HY1), (-X, HY1)]
    hf = [dz.HFrame(K.opening(hall, 0, X + dx, 1.7, 3.3, 0.0, 0.7, 'arch', 'door'), 0.14) for dx in (-6.0, -3.0, 0.0, 3.0, 6.0)]
    hw = [K.opening(hall, e, t, 0.7, 1.1, 3.6, 0.7, 'arch') for e, t in ((1, 2.5), (1, 5.0), (1, 7.5), (3, 2.5), (3, 5.0), (3, 7.5), (2, 3.0), (2, 13.0))]
    K.wall_ring(hall, HH, 0.7, PL, hf + hw, name='hall_walls')
    dz.roof_slab(C.poly_offset(hall, -0.3), HH + 0.03, 0.4, SCREED, name='hall_roof', tint=ROOF_T)
    K.roof_meta(C.poly_offset(hall, -0.3), HH + 0.03, walkable=True, kind='flat')
    dz.parapet(hall, HH, 0.9, 0.3, PL, style='merlon', name='hall_par', mspace=1.25)
    dz.course(hall, HH - 0.35, 0.16, 0.08, PL, name='hall_cornice')
    dz.course(hall, HH - 0.55, 0.1, 0.04, OCH, name='hall_band')
    dz.spouts(hall, HH - 0.05, 5.0, STONE, skip=(0,))
    for f in hf:
        dz.arch_surround(f, STONE, 0.24, stripes=True, name='hs%d' % int(f.o.x), n_arc=14)
    K.door_meta('hall', tuple(hf[2].o), hf[2].n, hf[2].w, hf[2].h, kind='arch', node=None)
    for f in hw:
        dz.arch_surround(f, STONE, 0.12, proud=0.02, stripes=False, name='hws%d_%d' % (int(f.o.x), int(f.o.y)), n_arc=8)
        dz.grille_window(f, name='hw%d_%d' % (int(f.o.x), int(f.o.y)))
        K.decal('streak_long', tuple(f.p(0, -0.6, 0.012)), tuple(f.n), f.w, 1.0, alpha=0.2)
    # ---- modelled hypostyle behind the facade arches (what the camera sees through them)
    y0, y1, zc = HY0 + 0.7, HY0 + 6.2, 4.6
    bm = bmesh.new()
    C.box_bm(bm, (0, y1 + 0.15, zc / 2), (2 * X - 1.4, 0.3, zc))              # dim inner wall closing the view
    C.box_bm(bm, (0, (y0 + y1) / 2, zc + 0.12), (2 * X - 1.4, y1 - y0, 0.24))   # ceiling slab
    K.part(bm, 'plaster_rough', name='hyp_shell', mat_tint=(0.78, 0.74, 0.68), lod='drop')
    dz.patch_quad([(-X + 0.7, y0, 0), (X - 0.7, y0, 0), (X - 0.7, y1, 0), (-X + 0.7, y1, 0)], 'patio_flags', 'hyp_floor', tint=(0.62, 0.58, 0.53), lift=0.01)
    bm = bmesh.new()                                                              # rolled-out reed prayer mats (halfa)
    for k in range(14):
        xc = -X + 1.3 + (2 * X - 2.6) * k / 13
        dz.card_bm(bm, (xc, y0 + 0.5, 0.02), (xc + r.uniform(-0.05, 0.05), y1 - 0.4, 0.02), 1.0, droop=0.0, segs=2, cell='reed')
    K.part(bm, 'palm_frond_dz', name='hyp_mats', uv='keep', grime=0.2, bisect=False, lod='drop', mat_tint=(0.72, 0.68, 0.6))
    bm = bmesh.new()                                                              # first column row right behind the facade
    for xc in (-7.2, -4.5, -1.5, 1.5, 4.5, 7.2):
        c = V((xc, HY0 + 1.55, 0))
        C.box_bm(bm, tuple(c + V((0, 0, 0.1))), (0.4, 0.4, 0.2))
        C.cyl_bm(bm, c + V((0, 0, 0.2)), c + V((0, 0, 3.55)), 0.14, 8, caps=False)
        C.box_bm(bm, tuple(c + V((0, 0, 3.63))), (0.38, 0.38, 0.16), taper=(1.2, 1.2))
    K.part(bm, STONE, name='hyp_columns0', mat_tint=(1.0, 0.98, 0.95), bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0, HY0 + 1.55, 3.95), (2 * X - 1.6, 0.36, 0.5))                   # arcade beam / impost over the column row
    K.part(bm, PL, name='hyp_beam', mat_tint=(0.86, 0.83, 0.78))
    ya = HY0 + 3.3                                                                # inner arcade on marble columns
    ap = [(-X + 0.7, ya), (X - 0.7, ya), (X - 0.7, ya + 0.35), (-X + 0.7, ya + 0.35)]
    inner = [dz.HFrame(K.opening(ap, 0, X - 0.7 + dx, 2.3, 3.4, 0.0, 0.35, 'arch', 'window'), 0.12) for dx in (-7.2, -4.5, -1.5, 1.5, 4.5, 7.2)]
    bm = bmesh.new()
    C.prism_bm(bm, ap, 0.0, zc)
    bm = KA.boolean_cut(bm, inner)
    K.part(bm, PL, name='hyp_arcade', mat_tint=(0.9, 0.88, 0.84), lod='drop')
    bm = bmesh.new()
    for f in inner:
        for sx in (-1, 1):
            c = f.p(sx * (f.w / 2 + 0.02), 0, -0.17)
            C.cyl_bm(bm, c, c + V((0, 0, f.h - f.rise)), 0.13, 7, caps=False)
            C.box_bm(bm, tuple(c + V((0, 0, f.h - f.rise + 0.08))), (0.34, 0.34, 0.16))
    K.part(bm, STONE, name='hyp_columns', mat_tint=(1.0, 0.98, 0.95), lod='drop', bisect=False)
    bm = bmesh.new()
    for k in range(12):
        x = -X + 1.2 + (2 * X - 2.4) * k / 11
        C.box_bm(bm, (x, (y0 + y1) / 2, zc - 0.06), (0.16, y1 - y0, 0.14))
    K.part(bm, 'timber_beam', name='hyp_joists', uv='beam', axis=(0, 1, 0), mat_tint=(0.72, 0.5, 0.36), lod='drop')
    bm = bmesh.new()          # lamps hanging on chains
    for xc in (-4.5, 0.0, 4.5):
        C.cyl_bm(bm, (xc, HY0 + 2.2, zc - 0.1), (xc, HY0 + 2.2, 3.3), 0.01, 3, caps=False)
        C.cyl_bm(bm, (xc, HY0 + 2.2, 3.3), (xc, HY0 + 2.2, 3.0), 0.25, 8, r1=0.08)
    K.part(bm, 'steel_galv', name='hyp_lamps', mat_tint=(1.0, 0.85, 0.55), lod='drop')
    return hall


def ribbed_dome(c, R, z0, nrib=16, name='main_dome'):
    """Dome shell (white lime) with raised limestone ribs following the meridians + brass jamour."""
    ztop = dz.dome(c, R, z0, PL, drum_h=0.12, segs=nrib * 2, rings=7, ribbed=False, finial=False, name=name, tint=(0.98, 0.97, 0.95))
    cx, cy = c
    bm = bmesh.new()
    zb = z0 + 0.12 + 0.02
    for k in range(nrib):
        a = 2 * math.pi * k / nrib
        d = V((math.cos(a), math.sin(a), 0))
        s = V((-d.y, d.x, 0))
        rings = []
        for i in range(9):
            t = (math.pi / 2) * i / 8.35
            rad = R * math.cos(t)
            z = zb + R * math.sin(t) * 1.08
            nrm = (d * math.cos(t) + V((0, 0, math.sin(t)))).normalized()
            p = V((cx, cy, 0)) + d * rad + V((0, 0, z))
            w = 0.09 * (1 - 0.6 * i / 8)
            rings.append([p - s * w, p - s * w + nrm * 0.07, p + s * w + nrm * 0.07, p + s * w])
        for i in range(8):
            a0, a1 = rings[i], rings[i + 1]
            for j in range(3):
                bm.faces.new([bm.verts.new(q) for q in (a0[j], a1[j], a1[j + 1], a0[j + 1])])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STONE, name=name + '_ribs', mat_tint=(0.93, 0.88, 0.8), lod='keep', bisect=False)
    top = V((cx, cy, zb + R * 1.08 + 0.02))
    bm = bmesh.new()
    C.cyl_bm(bm, top - V((0, 0, 0.1)), top + V((0, 0, 0.9)), 0.035, 6)
    for zz, rad in ((0.2, 0.13), (0.45, 0.11), (0.68, 0.08)):
        C.cyl_bm(bm, top + V((0, 0, zz - rad)), top + V((0, 0, zz + rad)), rad, 10, r1=rad * 0.35)
    K.part(bm, 'steel_galv', name=name + '_jamour', mat_tint=(1.0, 0.82, 0.45), smooth=True, grime=0.2)
    return top.z + 0.9


def hall_roof_and_dome():
    # green-glazed gable over the axial nave, skylights, entrance-bay dome, repairs
    # (round 2: the green nave gable is gone - from the game camera it buried the dome drum)
    for xs in (-5.0, 5.0):       # skylight lanterns
        bm = bmesh.new()
        C.box_bm(bm, (xs, HY0 + 4.0, HH + 0.45), (1.4, 1.4, 0.8))
        C.box_bm(bm, (xs, HY0 + 4.0, HH + 0.9), (1.6, 1.6, 0.1))
        K.part(bm, PL, name='sky%d' % int(xs))
        for k in range(4):
            a = k * math.pi / 2
            n = V((math.cos(a), math.sin(a), 0))
            fr = KA.Frame(V((xs, HY0 + 4.0, HH + 0.2)) + n * 0.705, n, V((-n.y, n.x, 0)), 0.8, 0.5, 0.1)
            bm = bmesh.new()
            for i in range(5):
                KA.lbox(bm, fr, -0.36 + 0.18 * i - 0.015, -0.36 + 0.18 * i + 0.015, 0.02, 0.48, 0.0, 0.03)
            KA.lbox(bm, fr, -0.4, 0.4, 0.0, 0.5, -0.04, -0.03)
            K.part(bm, 'wood_paint', name='skyg%d_%d' % (int(xs), k), mat_tint=(0.3, 0.5, 0.45))
    dz.dome((0.0, HY0 + 1.6), 1.1, HH + 0.03, PL, drum_h=0.5, segs=16, rings=5, finial=True, name='entry_dome', tint=(0.98, 0.97, 0.95))
    bm = bmesh.new()
    for xr in (-6.0, -4.5, -3.0, 3.0, 4.5, 6.0):
        C.box_bm(bm, (xr, (HY0 + HY1) / 2 - 0.2, HH + 0.07), (0.22, HY1 - HY0 - 1.2, 0.08), taper=(0.6, 1.0))
    for yr in (HY0 + 3.3, HY0 + 6.6):
        for x0_, x1_ in ((-7.5, -2.1), (2.1, 7.5)):
            C.box_bm(bm, ((x0_ + x1_) / 2, yr, HH + 0.07), (x1_ - x0_, 0.22, 0.08))
    K.part(bm, 'screed_lime', name='roof_ridges', mat_tint=(1.0, 0.99, 0.97), grime=0.6)
    dz.roof_patches([(-7.4, HY0 + 0.7), (-2.0, HY0 + 0.7), (-2.0, HY1 - 0.7), (-7.4, HY1 - 0.7)], HH + 0.03, 3, SEED, tar=False)
    dz.roof_patches([(2.0, HY0 + 0.7), (7.4, HY0 + 0.7), (7.4, HY1 - 6.2), (2.0, HY1 - 6.2)], HH + 0.03, 2, SEED + 7, tar=False)
    dz.hatch((6.6, HY1 - 1.0), HH + 0.03, 0.6, curb=PL, name='hall_hatch')
    # main dome over the mihrab bay: ochre ashlar square base -> octagonal drum (blind arcades, ablaq band) -> ribs
    DC = (0.0, HY1 - 3.2)
    bm = bmesh.new()
    C.box_bm(bm, (DC[0], DC[1], HH + 1.2), (5.6, 5.6, 2.4))
    K.part(bm, OCH, name='dome_base', mat_tint=(0.97, 0.95, 0.92))
    dz.course([(DC[0] - 2.8, DC[1] - 2.8), (DC[0] + 2.8, DC[1] - 2.8), (DC[0] + 2.8, DC[1] + 2.8), (DC[0] - 2.8, DC[1] + 2.8)], HH + 2.4, 0.14, 0.08, STONE, name='base_cornice')
    oc = [(DC[0] + 2.75 * math.cos(math.pi / 8 + k * math.pi / 4), DC[1] + 2.75 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    bm = bmesh.new()
    C.prism_bm(bm, oc, HH + 2.4, HH + 4.5)
    K.part(bm, OCH, name='drum')
    for k in range(8):
        a0 = math.pi / 8 + k * math.pi / 4 + math.pi / 8
        n = V((math.cos(a0), math.sin(a0), 0))
        c = V((*DC, 0)) + n * 2.75 * math.cos(math.pi / 8) + V((0, 0, HH + 2.65))
        blind_arch(c, n, 0.9, 1.3, PL, (0.72, 0.66, 0.58), STONE, name='drumarch%d' % k, n_arc=6, jambs=False)
    bm_l, bm_d = bmesh.new(), bmesh.new()          # two-tone voussoir band round the drum top
    for k in range(8):
        a, b = V((*oc[k], 0)), V((*oc[(k + 1) % 8], 0))
        n = V(((a + b) / 2 - V((*DC, 0)))).normalized()
        for j in range(6):
            p0, p1 = a.lerp(b, j / 6), a.lerp(b, (j + 1) / 6)
            C.hexa_bm(bm_d if j % 2 else bm_l, [p0 + V((0, 0, HH + 4.05)), p1 + V((0, 0, HH + 4.05)), p1 + n * 0.05 + V((0, 0, HH + 4.05)), p0 + n * 0.05 + V((0, 0, HH + 4.05)),
                                                 p0 + V((0, 0, HH + 4.45)), p1 + V((0, 0, HH + 4.45)), p1 + n * 0.05 + V((0, 0, HH + 4.45)), p0 + n * 0.05 + V((0, 0, HH + 4.45))])
    K.part(bm_l, STONE, name='band_l', mat_tint=(1.0, 0.98, 0.94))
    K.part(bm_d, OCH, name='band_d', mat_tint=(0.85, 0.7, 0.52))
    dz.course(oc, HH + 4.5, 0.14, 0.1, STONE, name='drum_cornice')
    ztop = ribbed_dome(DC, 2.95, HH + 4.64)
    K.anchor('dome_top', (DC[0], DC[1], ztop))
    # projecting mihrab on the qibla wall + buttresses
    mp = [(-1.4, HY1 - 0.1), (1.4, HY1 - 0.1), (1.0, HY1 + 1.1), (-1.0, HY1 + 1.1)]
    bm = bmesh.new()
    C.prism_bm(bm, C.ccw(mp), 0.0, 4.2)
    K.part(bm, PL, name='mihrab')
    K.footprint(mp, 'HIGH', 'mihrab')
    dz.course(C.ccw(mp), 4.2, 0.18, 0.06, PL, name='mihrab_cornice')
    dz.dome((0.0, HY1 + 0.5), 0.9, 4.38, 'roof_slate', drum_h=0.1, segs=12, rings=4, finial=False, name='mihrab_dome', tint=GTILE)
    bm = bmesh.new()
    for x, y, sx, sy in [(-X - 0.25, HY0 + d, 0.5, 0.8) for d in (3.75, 6.25)] + [(X + 0.25, HY0 + d, 0.5, 0.8) for d in (3.75, 6.25)] + \
            [(d, HY1 + 0.25, 0.8, 0.5) for d in (-5.5, 5.5)]:
        C.box_bm(bm, (x, y, 2.4), (sx, sy, 4.8), taper=(0.6, 1) if sx < 0.6 else (1, 0.6))
    K.part(bm, PL, name='buttresses')


def courtyard():
    bm = bmesh.new()
    T = 0.6
    for a, b in (((-X, HY0), (-X, CY0)), ((-X, CY0), (-2.0, CY0)), ((2.0, CY0), (X, CY0)), ((X, CY0), (X, HY0))):
        a, b = V((*a, 0)), V((*b, 0))
        rv = (b - a).normalized()
        n = V((rv.y, -rv.x, 0))
        C.beam_bm(bm, a - n * T / 2 + V((0, 0, CH / 2)), b - n * T / 2 + V((0, 0, CH / 2)), T, CH)
        K.footprint([tuple(q)[:2] for q in (a, b, b - n * T, a - n * T)], 'HIGH', 'wall')
    cpoly = [(-X, CY0), (X, CY0), (X, HY0), (-X, HY0)]
    ow = [K.opening(cpoly, 1, t, 0.6, 0.9, 2.2, T, 'arch') for t in (3.0, 7.0)]
    bm = KA.boolean_cut(bm, ow)
    K.part(bm, PL, name='court_walls')
    for f in ow:
        dz.grille_window(f, name='cw%d' % int(f.o.y), nb=3)
    dz.parapet(cpoly, CH, 0.6, 0.3, PL, gaps={0: [(X - 2.0, X + 2.0)], 2: [(-1, 2 * X + 1)]}, style='merlon', name='court_par', mspace=1.25)
    dz.spouts(cpoly, CH - 0.1, 5.0, STONE, skip=(0, 2))
    for side in (-1, 1):       # galleries: arcade, roof, joist+plank ceiling, paved floor, blind niches + benches on the back wall
        xa = side * (X - GD)
        ln = [(xa - 0.2, CY0 + 0.6), (xa + 0.2, CY0 + 0.6), (xa + 0.2, HY0), (xa - 0.2, HY0)]
        nb = 4
        L = HY0 - CY0 - 0.6
        frs = [dz.HFrame(K.opening(ln, 1 if side < 0 else 3, (k + 0.5) * L / nb, L / nb - 0.6, 2.7, 0.0, 0.4, 'arch'), 0.12) for k in range(nb)]
        bm = bmesh.new()
        C.prism_bm(bm, ln, 0.0, CH - 0.25)
        bm = KA.boolean_cut(bm, frs)
        K.part(bm, PL, name='gallery%d' % side)
        for f in frs:
            dz.arch_surround(f, STONE, 0.14, proud=0.02, stripes=True, jambs=False, name='gs%d_%d' % (side, int(f.o.y)), n_arc=12)
        for k in range(nb + 1):
            y = CY0 + 0.6 + L * k / nb
            K.footprint_rect(xa, min(max(y, CY0 + 0.9), HY0 - 0.3), 0.4, 0.6, 0, 'HIGH', 'pier')
        x_in, x_out = xa + 0.2 * side, side * (X - 0.6)
        gp = C.ccw([(min(xa, side * X), CY0), (max(xa, side * X), CY0), (max(xa, side * X), HY0), (min(xa, side * X), HY0)])
        dz.roof_slab(gp, CH - 0.2, 0.25, SCREED, name='gallery_roof%d' % side, tint=ROOF_T)
        K.roof_meta(C.poly_offset(gp, -0.3), CH - 0.2, walkable=True, kind='flat')
        g2 = C.ccw([(min(x_in, x_out), CY0 + 0.6), (max(x_in, x_out), CY0 + 0.6), (max(x_in, x_out), HY0), (min(x_in, x_out), HY0)])
        dz.patch_quad([(x, y, 0) for x, y in g2], 'patio_flags', 'gfloor%d' % side, tint=(0.95, 0.92, 0.88), lift=0.07)
        bm = bmesh.new()
        for k in range(9):
            y = CY0 + 0.8 + (L - 0.4) * k / 8
            C.box_bm(bm, ((x_in + x_out) / 2, y, CH - 0.55), (abs(x_out - x_in), 0.14, 0.16))
        K.part(bm, 'timber_beam', name='gjoists%d' % side, uv='beam', axis=(1, 0, 0), mat_tint=(0.75, 0.55, 0.4))
        dz.patch_quad([(x, y, CH - 0.47) for x, y in g2[::-1]], 'door_planks', 'gceil%d' % side, tint=(0.62, 0.5, 0.38), lift=0.0)
        for k in range(nb):
            y = CY0 + 0.6 + L * (k + 0.5) / nb
            blind_arch(V((x_out + side * 0.0 - side * 0.001, y, 0.55)), (-side, 0, 0), 1.2, 2.2, PL, (0.82, 0.78, 0.72), STONE, name='gn%d_%d' % (side, k), n_arc=5, jambs=False)
        bm = bmesh.new()
        C.box_bm(bm, (x_out - side * 0.25, (CY0 + HY0) / 2, 0.25), (0.5, L - 1.0, 0.5))
        K.part(bm, PL, name='gbench%d' % side)
    dz.patch_quad([(-X + GD + 0.2, CY0 + 0.6, 0), (X - GD - 0.2, CY0 + 0.6, 0), (X - GD - 0.2, HY0, 0), (-X + GD + 0.2, HY0, 0)], 'patio_flags', 'paving', lift=0.03)
    ab = [(1.0 * math.cos(math.pi / 8 + k * math.pi / 4), -3.0 + 1.0 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    bm = bmesh.new()
    KA.ring_bm(bm, ab, C.poly_offset(ab, -0.15), 0.0, 0.55)
    K.part(bm, 'ashlar_limestone', name='basin')
    bm = bmesh.new()
    C.prism_bm(bm, C.poly_offset(ab, -0.15), 0.3, 0.42)
    K.part(bm, 'glass_dirty', name='basin_water', grime=0, bisect=False, mat_tint=(0.45, 0.58, 0.55))
    bm = bmesh.new()
    C.cyl_bm(bm, (0, -3.0, 0.3), (0, -3.0, 1.0), 0.12, 8)
    C.cyl_bm(bm, (0, -3.0, 1.0), (0, -3.0, 1.1), 0.3, 10, r1=0.1)
    K.part(bm, 'ashlar_limestone', name='fountain', smooth=True)
    K.footprint(ab, 'LOW', 'basin')
    K.decal('stain_blotch', (0, -3.0, 0.05), (0, 0, 1), 3.4, 3.4, up=(0, 1, 0), alpha=0.35)
    # portal: projecting frontispiece, horseshoe arch, darj-wa-ktaf spandrel panel in a limestone alfiz, studded doors
    pp = [(-2.1, CY0 - 0.9), (2.1, CY0 - 0.9), (2.1, CY0 + 0.1), (-2.1, CY0 + 0.1)]
    pd = dz.HFrame(K.opening(pp, 0, 2.1, 1.9, 3.6, 0.0, 1.0, 'arch', 'door'), 0.16)
    K.wall_ring(pp, 5.6, 1.0, PL, [pd], name='portal', footprint=False)
    for sx in (-1, 1):
        K.footprint_rect(sx * 1.6, CY0 - 0.4, 1.0, 1.0, 0, 'HIGH', 'portal')
    dz.parapet(pp, 5.6, 0.6, 0.25, PL, style='merlon', climb=False, name='portal_par')
    dz.roof_slab(C.poly_offset(pp, -0.25), 5.63, 0.3, SCREED, name='portal_roof', tint=ROOF_T)
    dz.arch_surround(pd, STONE, 0.34, stripes=True)
    dz.studded_door(pd, 'main', 'green', step=STONE)
    bm = bmesh.new()
    KA.lpoly(bm, pd, [(-1.45, pd.h - 0.25), (1.45, pd.h - 0.25), (1.45, 4.35), (-1.45, 4.35)], 0.012)
    K.part(bm, 'darj_panel', name='portal_darj', grime=0.4, bisect=False)
    bm = bmesh.new()
    KA.lbox(bm, pd, -1.55, 1.55, 4.35, 4.5, -0.02, 0.06)
    for sx in (-1, 1):
        KA.lbox(bm, pd, sx * 1.55 - 0.075, sx * 1.55 + 0.075, 0.0, 4.5, -0.02, 0.06)
    K.part(bm, STONE, name='alfiz')
    K.decal('poster_fr', (-3.6, CY0 - 0.004, 1.7), (0, -1, 0), 0.5, 0.7, alpha=0.8)
    return cpoly


def minaret():
    mp = [(MX - MS / 2, MY - MS / 2), (MX + MS / 2, MY - MS / 2), (MX + MS / 2, MY + MS / 2), (MX - MS / 2, MY + MS / 2)]
    mdoor = K.opening(mp, 0, MS / 2, 1.0, 2.2, 0.0, 0.5, 'arch', 'door')
    lights = []
    for e in range(4):
        for z in ((3.8, 7.4) if e % 2 == 0 else (5.4, 8.6)):
            for dx in (-0.2, 0.2):
                lights.append(K.opening(mp, e, MS / 2 + dx, 0.28, 0.85, z, 0.5, 'arch'))
    K.wall_ring(mp, ZB - 0.6, 0.5, OCH, [mdoor] + lights, name='minaret_shaft')
    bm = bmesh.new()          # hollow shaft: central newel of the spiral stair (seen through the lights), dim
    C.box_bm(bm, (MX, MY, (ZB - 0.6) / 2), (0.7, 0.7, ZB - 0.6))
    K.part(bm, 'plaster_rough', name='newel', mat_tint=(0.36, 0.33, 0.3), lod='drop')
    dz.course(mp, 0.0, 0.6, 0.08, STONE, name='mplinth', mat_tint=(0.9, 0.87, 0.82))
    for zc_ in (3.3, 6.9, 9.75):              # white limestone string courses (two-tone banding)
        dz.course(mp, zc_, 0.22, 0.04, STONE, name='mband%d' % int(zc_ * 10), mat_tint=(1.0, 0.98, 0.95))
    dz.arch_surround(mdoor, STONE, 0.2, stripes=True, name='mdoor_s')
    for i in range(0, len(lights), 2):          # one projecting limestone frame round each pair of lights
        f0, f1 = lights[i], lights[i + 1]
        bm = bmesh.new()
        xa = min(f0.p(-f0.w / 2, 0, 0).dot(f0.r), f1.p(-f1.w / 2, 0, 0).dot(f0.r))
        c = (f0.o + f1.o) / 2
        fr = KA.Frame(c, f0.n, f0.r, 0.86, f0.h + 0.12, 0.2)
        for x0_, x1_ in ((-0.5, -0.4), (0.4, 0.5)):
            KA.lbox(bm, fr, x0_, x1_, -0.1, fr.h + 0.1, 0.0, 0.07)
        KA.lbox(bm, fr, -0.5, 0.5, fr.h, fr.h + 0.12, 0.0, 0.07)
        KA.lbox(bm, fr, -0.5, 0.5, -0.12, -0.02, 0.0, 0.09)
        K.part(bm, STONE, name='lfr%d' % i, mat_tint=(1.0, 0.98, 0.95), bisect=False)
    dz.studded_door(mdoor, 'minaret', 'green', step=STONE, wicket=False, tymp='boards', studs=False)
    bm = bmesh.new()
    for f in lights:          # sills + colonnette between each pair
        KA.lbox(bm, f, -0.18, 0.18, -0.06, 0.0, -0.05, 0.06)
    for i in range(0, len(lights), 2):
        f = lights[i]
        c = f.p(0.2, 0.0, 0.0)
        C.cyl_bm(bm, c, c + V((0, 0, f.h - f.rise)), 0.05, 6)
    K.part(bm, STONE, name='light_stone', mat_tint=(1.0, 0.98, 0.95))
    for e in range(4):        # darj-wa-ktaf panel in a limestone frame on every face, small blind arcade frieze above
        a, b, rv, n, L = dz.edge(mp, e)
        z0, z1 = 10.1, 13.4
        fr = KA.Frame(a + rv * (L / 2) + V((0, 0, z0)), n, rv, 2.4, z1 - z0, 0.2)
        bm = bmesh.new()
        KA.lpoly(bm, fr, [(-1.1, 0.0), (1.1, 0.0), (1.1, z1 - z0), (-1.1, z1 - z0)], 0.012)
        K.part(bm, 'darj_panel', name='darj%d' % e, grime=0.5, bisect=False, mat_tint=(0.8, 0.74, 0.66))
        bm = bmesh.new()      # darj-wa-ktaf in relief: zigzag lozenge ribs standing 6 cm proud (front + 2 sides only)
        cols, rows = 3, 3
        cw_, rh_ = 2.2 / cols, (z1 - z0) / rows
        for i in range(cols + 1):
            for dx in (-1, 1):
                pts = []
                for j in range(rows * 2 + 1):
                    xx = -1.1 + i * cw_ + (dx * cw_ / 2 if j % 2 else 0.0)
                    pts.append((max(-1.1, min(1.1, xx)), 0.02 + j * (rh_ / 2) * (z1 - z0 - 0.04) / (z1 - z0)))
                for (xa_, za_), (xb_, zb_) in zip(pts[:-1], pts[1:]):
                    if abs(xa_ - xb_) < 1e-3 and (abs(xa_) > 1.09):
                        continue
                    pa, pb = fr.p(xa_, za_, 0.012), fr.p(xb_, zb_, 0.012)
                    t = (pb - pa).normalized()
                    sd = t.cross(fr.n).normalized() * 0.03
                    q = [pa - sd, pb - sd, pb + sd, pa + sd]
                    vs = [bm.verts.new(v) for v in q] + [bm.verts.new(v + fr.n * 0.06) for v in q]
                    bm.faces.new((vs[4], vs[5], vs[6], vs[7]))
                    bm.faces.new((vs[0], vs[1], vs[5], vs[4]))
                    bm.faces.new((vs[3], vs[7], vs[6], vs[2]))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, OCH, name='darjr%d' % e, mat_tint=(1.02, 0.95, 0.84), grime=0.4, bisect=False)
        bm = bmesh.new()
        for x0 in (-1.25, 1.1):
            KA.lbox(bm, fr, x0, x0 + 0.15, -0.15, z1 - z0 + 0.15, 0.0, 0.07)
        KA.lbox(bm, fr, -1.25, 1.25, -0.15, 0.0, 0.0, 0.07)
        KA.lbox(bm, fr, -1.25, 1.25, z1 - z0, z1 - z0 + 0.15, 0.0, 0.07)
        K.part(bm, STONE, name='darjf%d' % e, mat_tint=(1.0, 0.98, 0.95))
        for k in range(5):
            blind_arch(fr.p(-0.96 + 0.48 * k, z1 - z0 + 0.25, 0.0), n, 0.3, 0.52, OCH, (0.62, 0.5, 0.36), STONE, name='fr%d_%d' % (e, k), n_arc=4, jambs=False)
    for k, (dzz, pr) in enumerate(((-0.6, 0.08), (-0.45, 0.2), (-0.3, 0.34))):
        dz.course(mp, ZB + dzz, 0.15, pr, STONE, name='corbel%d' % k)
    bp = C.poly_offset(mp, 0.45)
    dz.roof_slab(bp, ZB, 0.18, STONE, name='balcony')
    dz.parapet(bp, ZB, 0.95, 0.22, OCH, style='merlon', name='balcony_par', mspace=0.8)
    K.roof_meta(C.poly_offset(bp, -0.22), ZB, walkable=True, kind='balcony')
    K.ladder_meta((MX, MY - MS / 2 - 0.7), (MX + 1.0, MY - MS / 2 + 0.2), ZB)
    C.A.meta['notes'].append('minaret: internal spiral stair modelled as a ladder link from the street door to the balcony (elev %.1f)' % ZB)
    lp = [(MX - 0.95, MY - 0.95), (MX + 0.95, MY - 0.95), (MX + 0.95, MY + 0.95), (MX - 0.95, MY + 0.95)]
    lf = [K.opening(lp, e, 0.95, 0.7, 1.7, 0.6, 0.35, 'arch') for e in range(4)]
    for f in lf:
        f.o = f.o + V((0, 0, ZB))
    bm = bmesh.new()
    KA.ring_bm(bm, lp, C.poly_offset(lp, -0.3), ZB, ZC)
    bm = KA.boolean_cut(bm, lf)
    K.part(bm, OCH, name='lantern')
    bm = bmesh.new()
    C.box_bm(bm, (MX, MY, (ZB + ZC) / 2), (0.5, 0.5, ZC - ZB))
    K.part(bm, 'plaster_rough', name='lantern_core', mat_tint=(0.62, 0.58, 0.52), lod='drop')
    for f in lf:
        dz.arch_surround(f, STONE, 0.12, proud=0.03, stripes=True, name='ls%d' % int(f.o.x * 10 + f.o.y), n_arc=10)
    dz.course(lp, ZC - 0.25, 0.18, 0.12, STONE, name='lantern_cornice')
    dz.parapet(lp, ZC, 0.45, 0.18, OCH, style='merlon', climb=False, name='lantern_par', mspace=0.7)
    ztop = dz.dome((MX, MY), 0.72, ZC, 'roof_slate', drum_h=0.2, segs=12, rings=5, finial=False, name='minaret_cap', tint=GTILE, bulb=0.12)
    top = V((MX, MY, ztop))
    bm = bmesh.new()
    C.cyl_bm(bm, top - V((0, 0, 0.05)), top + V((0, 0, 0.8)), 0.03, 6)
    for zz, rad in ((0.18, 0.1), (0.4, 0.085), (0.6, 0.065)):
        C.cyl_bm(bm, top + V((0, 0, zz - rad)), top + V((0, 0, zz + rad)), rad, 10, r1=rad * 0.35)
    K.part(bm, 'steel_galv', name='minaret_jamour', mat_tint=(1.0, 0.82, 0.45), smooth=True, grime=0.2)
    K.anchor('minaret_top', (MX, MY, ztop + 0.8))
    K.anchor('muezzin_balcony', (MX, MY - MS / 2 - 0.2, ZB))
    for e in range(4):
        a, b, rv, n, Le = dz.edge(mp, e)
        K.decal('streak_long', tuple(a + rv * 0.5 + n * 0.004 + V((0, 0, ZB - 1.6))), tuple(n), 0.5, 2.0, alpha=0.3)
        K.decal('streak_long', tuple(b - rv * 0.5 + n * 0.004 + V((0, 0, ZB - 1.6))), tuple(n), 0.4, 1.6, alpha=0.25)
    return mp


def weather(poly, zmax, skip=(), n_sp=0.35):
    for i in range(len(poly)):
        if i in skip:
            continue
        a, b, rv, n, Le = dz.edge(poly, i)
        for k in range(int(Le / 3)):
            p = a + rv * r.uniform(0.6, Le - 0.6)
            K.decal('damp_base', tuple(p + n * 0.003 + V((0, 0, 0.45))), tuple(n), r.uniform(1.5, 2.5), 0.9, alpha=0.35)
            K.decal('streak_long', tuple(a + rv * r.uniform(0.6, Le - 0.6) + n * 0.004 + V((0, 0, zmax - 0.6))), tuple(n), r.uniform(0.3, 0.6), 1.6, alpha=0.2)
            if r.random() < n_sp:
                dz.spall2(p + V((0, 0, r.uniform(0.7, zmax - 0.8))), n, r.uniform(0.6, 1.3), r.uniform(0.35, 0.7), 'fieldstone', PL, None,
                          seed=SEED + k + i * 9, name='sp%d_%d_%d' % (int(zmax), i, k))


if PART == 'all':
    hall = prayer_hall()
    hall_roof_and_dome()
    cpoly = courtyard()
    weather(hall, HH, n_sp=0.45)
    weather(cpoly, CH, skip=(0, 2), n_sp=0.4)
    weather([(-2.0, CY0), (2.0, CY0), (2.0, HY0), (-2.0, HY0)], CH, skip=(1, 2, 3), n_sp=0.0)
mp = minaret()
dz.finalize(OUT, ao_res=1024 if PART == 'minaret' else 2048, ao_samples=48)
