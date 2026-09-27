"""Tunis medina house (M12 'Up on the Roof'), rework 1. Worn lime-wash over rubble (stone showing where the render
has fallen), crowned lime copings with drip lips (no pipe rolls), cracked roof screed with lime/tar repairs, hatches,
stair kiosks, a qubba dome, laundry and jars on the terraces, gargoyle spouts with rain streaks, horseshoe door with a
painted boarded fanlight + iron sunburst grille. Three different PLANS:
  a: L-plan, 2-storey block + SW one-storey wing with terrace; external stair on the wing's EAST side (climbs north).
  b: 2-storey block with a corbelled street bay + 3rd-storey ghorfa room; jogged one-storey annex to the east whose
     stair runs along its SOUTH front (climbs west); ladder annex -> main roof.
  c: long single-storey house with a qubba dome, a two-storey tower room at the EAST end and a walled forecourt with
     a gate; external stair on the WEST gable (climbs north).
Usage: blender -b --python house_flat_white.py -- outdir [a|b|c] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else {'a': 11, 'b': 23, 'c': 37}[VAR]
K.begin('house_flat_white_' + VAR, SEED, theater='desert')
C.A.grime_heights = sorted(set(list(C.A.grime_heights) + [2.2, 3.4]))
r = K.rng()
CFG = {'a': dict(wash='white', door='blue', shut='blue', dado=None),
       'b': dict(wash='cream', door='green', shut='green', dado=None),
       'c': dict(wash='bone', door='yellow', shut='teal', dado=(0.66, 0.76, 0.84))}[VAR]
WASH = dz.WASH[CFG['wash']]
PL, SCREED, STONE = 'limewash_worn', 'screed_roof', 'ashlar_limestone'
T, PH = 0.5, 0.85
shut_c = dz.DOORS[CFG['shut']]
ROOF_T = (0.97, 0.95, 0.92)


def block(poly, H, name, frames, gaps=None, t=T, cornice=True, spout_skip=(), par=True, par_h=PH, roof=None, roof_tint=None):
    """Walls + roof slab (screed) + lime-coped parapet + cornice band + spouts + roof metadata."""
    K.wall_ring(poly, H, t, PL, frames, name='walls_' + name, mat_tint=WASH)
    inner = C.poly_offset(poly, -t + 0.22)
    dz.roof_slab(inner, H + 0.03, 0.35, roof or SCREED, name='roof_' + name, tint=roof_tint or ROOF_T)
    if par:
        dz.parapet(poly, H, par_h, 0.28, PL, gaps=gaps or {}, style='lime', mat_tint=WASH, name='par_' + name)
    K.roof_meta(C.poly_offset(poly, -0.28), H + 0.03, walkable=True, kind='flat')
    if cornice:
        dz.course(poly, H - 0.3, 0.16, 0.08, PL, name='cornice_' + name, mat_tint=WASH)
        dz.course(poly, H - 0.14, 0.06, 0.04, 'ashlar_limestone', name='cornice2_' + name)
    dz.spouts(poly, H - 0.02, 4.0, STONE, skip=spout_skip)
    return inner


def dress(frames, sill_z=2.5, boxed=(), grilles=True):
    """Windows: upper = casement + louvred shutters (open/ajar/closed) + stone sill; low = projecting iron grille."""
    for k, f in enumerate(frames):
        low = f.o.z < sill_z
        if k in boxed:
            K.window(f, 'casement', (1, 3), frame=shut_c, sill=None, curtain=0.5, name='wb%d' % k)
            dz.window_box(f, shut_c, name='mashr%d' % k)
            continue
        K.window(f, 'casement' if f.w > 0.85 else 'single', (1, 3 if f.h > 1.25 else 2), frame=shut_c, sill=None if low else STONE,
                 shutters=None if low else r.choice(['open', 'ajar', 'closed', 'open']), shutter_color=shut_c,
                 shutter_style='louvred' if k % 3 == 0 else 'plank', curtain=0.5, name='w%d' % k)
        if low and grilles:
            dz.bow_grille(f, name='g%d' % k)


def weather(polys_h, n_spall=5, seed=0):
    """Fallen render (stone/brick showing), damp/dirt base, cracks, rain streaks down from copings."""
    for i in range(n_spall):
        poly, h = polys_h[i % len(polys_h)]
        e = r.randrange(len(poly))
        a, b, rr, nn, Le = dz.edge(poly, e)
        if Le < 2.0:
            continue
        tt = r.choice([r.uniform(0.5, 1.4), r.uniform(Le - 1.4, Le - 0.5), r.uniform(0.7, Le - 0.7)])
        p = a + rr * tt + V((0, 0, r.choice([r.uniform(0.35, 1.1), r.uniform(0.35, 1.1), r.uniform(1.2, h - 1.0)])))
        dz.spall2(p, nn, r.uniform(0.6, 1.2), r.uniform(0.35, 0.7), 'fieldstone', PL, WASH,
                  seed=seed + i, name='sp%d' % i)
    for poly, h in polys_h:
        for i in range(len(poly)):
            a, b, rr, nn, Le = dz.edge(poly, i)
            for k in range(max(1, int(Le / 3.0))):
                t = r.uniform(0.5, Le - 0.5)
                K.decal('damp_base', tuple(a + rr * t + nn * 0.003 + V((0, 0, 0.42))), tuple(nn), r.uniform(1.6, 2.6), 0.85, alpha=0.35)
                K.decal('streak_long', tuple(a + rr * r.uniform(0.4, Le - 0.4) + nn * 0.004 + V((0, 0, h - 0.9))), tuple(nn),
                        r.uniform(0.4, 0.8), 1.4, alpha=0.22)
                if r.random() < 0.6:
                    K.decal(r.choice(['crack', 'efflorescence', 'crack']), tuple(a + rr * r.uniform(0.6, Le - 0.6) + nn * 0.004 +
                            V((0, 0, r.uniform(1, h - 1)))), tuple(nn), r.uniform(0.7, 1.4), r.uniform(0.7, 1.4), alpha=0.35)


def door_hood(door, z, w=2.0):
    K.roof_shed(door.o.x - w / 2, door.o.y - 0.62, door.o.x + w / 2, door.o.y, z, z + 0.2, 'roof_terracotta', low_side='-y', oh=0.08,
                name='door_hood', gutters=False)
    C.A.meta['roofs'].pop()
    bm = dz.bmesh.new()
    for s in (-1, 1):
        C.beam_bm(bm, (door.o.x + s * (w / 2 - 0.1), door.o.y - 0.02, z - 0.3), (door.o.x + s * (w / 2 - 0.1), door.o.y - 0.6, z), 0.07, 0.1)
    K.part(bm, 'timber_beam', name='hood_brackets', uv='beam', axis=(0, 1, 0))


def kiosk(cx, cy, w, d, h, z0, face=0, name='kiosk'):
    """Roof stair-head room (douira): small block with its own coping, boarded door on edge `face`, vent slit."""
    poly = [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]
    L = w if face % 2 == 0 else d
    df = K.opening(poly, face, L / 2, 0.8, 1.85, z0, 0.3, 'segment', 'door')
    sl = K.opening(poly, (face + 2) % 4, L / 2, 0.14, 0.45, z0 + 1.3, 0.3)
    K.wall_ring(poly, h, 0.3, PL, [df, sl], z0=z0, name=name + '_walls', mat_tint=WASH, footprint=False)
    dz.roof_slab(poly, z0 + h + 0.12, 0.14, SCREED, name=name + '_roof', oh=0.06, tint=ROOF_T)
    bm = dz.bmesh.new()
    for i in range(4):
        a, b, rr, nn, Le = dz.edge(C.poly_offset(poly, 0.06), i)
        dz.coping_bm(bm, a - rr * 0.02 - nn * 0.12, b + rr * 0.02 - nn * 0.12, z0 + h + 0.12, 0.26, seed=i)
    K.part(bm, PL, name=name + '_cope', mat_tint=WASH)
    K.door(df, name, 'plank', CFG['door'], step=None)
    K.window(sl, 'fixed', (1, 1), frame=shut_c, sill=None, bars=True, streak=False, name=name + '_slit')
    return poly


def clutter(poly, z, n_jars=2, mat=True, wood=True, seed=0):
    """Terrace life: water jars, a reed mat of drying red peppers, firewood bundle, a basket."""
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    x0, x1, y0, y1 = min(xs) + 0.6, max(xs) - 0.6, min(ys) + 0.6, max(ys) - 0.6
    if n_jars:
        dz.jars([(x0 + 0.1 + 0.5 * k, y0 + 0.1 + (0.18 if k % 2 else 0), z) for k in range(n_jars)], name='jars_%d' % int(z * 10), seed=seed + int(x0 * 7))
    if mat:
        cx, cy = x1 - 1.0, y0 + 0.7
        bmm = dz.bmesh.new()
        dz.card_bm(bmm, (cx - 0.75, cy, z + 0.015), (cx + 0.75, cy, z + 0.015), 1.05, droop=0.0, segs=2, cell='reed')
        K.part(bmm, 'palm_frond_dz', name='reedmat_%d' % int(z * 10), uv='keep', grime=0.2, bisect=False)
        bm = dz.bmesh.new()
        rr = K.rng()
        for i in range(22):
            p = V((cx + rr.uniform(-0.6, 0.6), cy + rr.uniform(-0.38, 0.38), z + 0.035))
            C.box_bm(bm, tuple(p), (rr.uniform(0.09, 0.14), 0.035, 0.03), rr.uniform(0, 3.1))
        K.part(bm, 'canvas', name='peppers', mat_tint=(0.75, 0.18, 0.1), grime=0, bisect=False, lod='drop')
    if wood:
        bm = dz.bmesh.new()
        rr = K.rng()
        for i in range(9):
            p = V((x0 + 0.2 + rr.uniform(-0.05, 0.05), y1 - 0.3 + rr.uniform(-0.1, 0.1), z + 0.06 + 0.08 * (i // 4)))
            C.cyl_bm(bm, p - V((0.5, rr.uniform(-0.05, 0.05), 0)), p + V((0.5, rr.uniform(-0.05, 0.05), 0)), rr.uniform(0.03, 0.05), 5)
        K.part(bm, 'palm_log', name='firewood', uv='beam', axis=(1, 0, 0), grime=0.4, lod='drop')


def stair_side(x0, y_face, L, rise):
    """Street face of a solid stair: stepped plaster profile is visible now; add a darker damp base, a small
    arched storage niche with a wooden door and a grime run so the face never reads as a blank wedge."""
    K.decal('damp_base', (x0 - L * 0.5, y_face - 0.006, 0.35), (0, -1, 0), L * 0.9, 0.7, alpha=0.5)
    fr = KA.Frame(V((x0 - L * 0.62, y_face, 0.0)), V((0, -1, 0)), V((1, 0, 0)), 0.7, 1.05, 0.3, 'arch', 'window')
    bm = dz.bmesh.new()
    KA.lbox(bm, fr, -0.38, 0.38, -0.02, 1.1, -0.01, 0.03)
    K.part(bm, STONE, name='stair_door_sur', grime=0.6)
    bm = dz.bmesh.new()
    KA.lbox(bm, fr, -0.3, 0.3, 0.0, 0.95, 0.0, 0.035)
    K.part(bm, 'door_planks', name='stair_door', mat_tint=dz.DOORS[CFG['door']], uv='aligned', grime=0.7)
    dz.spall2(V((x0 - L * 0.3, y_face - 0.002, 0.55)), (0, -1, 0), 0.5, 0.35, 'fieldstone', PL, WASH, seed=SEED + 77, name='stair_sp')


def flue(c, z):
    """Plastered kitchen flue with a pitched tile cap and soot at the mouth."""
    bm = dz.bmesh.new()
    C.box_bm(bm, (c[0], c[1], z + 0.5), (0.42, 0.42, 1.0))
    C.box_bm(bm, (c[0], c[1], z + 1.04), (0.52, 0.52, 0.08))
    K.part(bm, PL, name='flue', mat_tint=WASH)
    K.roof_shed(c[0] - 0.3, c[1] - 0.3, c[0] + 0.3, c[1] + 0.3, z + 1.22, z + 1.3, 'roof_terracotta', low_side='-y', oh=0.02, name='flue_cap', gutters=False)
    C.A.meta['roofs'].pop()
    K.decal('soot', (c[0], c[1] - 0.215, z + 0.85), (0, -1, 0), 0.4, 0.5, alpha=0.5)


# ================================================================== variant a: L-plan, SW terrace wing, stair EAST of wing
if VAR == 'a':
    Z1, Z2 = 3.5, 6.8
    W, D, WW, WD = 9.0, 5.5, 4.5, 5.5
    x0, x1 = -W / 2, W / 2
    main = [(x0, 0.0), (x1, 0.0), (x1, D), (x0, D)]
    wing = [(x0, -WD), (x0 + WW, -WD), (x0 + WW, 0.25), (x0, 0.25)]
    dx = x0 + WW + (W - WW) * 0.55
    door = dz.HFrame(K.opening(main, 0, dx - x0, 1.25, 2.75, 0.0, T, 'arch', 'door'))
    g1 = K.opening(main, 0, dx - x0 + 1.4, 0.7, 0.9, 1.35, T)
    up = [K.opening(main, 0, t, 0.9, 1.35, Z1 + 0.9, T) for t in (1.3, WW - 0.9, dx - x0)]
    fe = [K.opening(main, 1, D * 0.5, 0.8, 1.1, 1.5, T), K.opening(main, 1, D * 0.5, 0.9, 1.3, Z1 + 0.95, T)]
    fn = [K.opening(main, 2, W * 0.3, 0.6, 0.7, 2.2, T), K.opening(main, 2, W * 0.7, 0.8, 1.2, Z1 + 1.0, T)]
    fw = [K.opening(main, 3, D * 0.55, 0.8, 1.2, Z1 + 1.0, T)]
    LADX = x0 + WW * 0.5
    block(main, Z2, 'main', [door, g1] + up + fe + fn + fw, gaps={0: [(LADX - x0 - 0.35, LADX - x0 + 0.35)]}, spout_skip=(0,))
    wdoor = K.opening(wing, 0, WW * 0.4, 1.6, 2.35, 0.0, 0.45, 'segment', 'door')
    wwin = K.opening(wing, 3, WD * 0.45, 0.7, 0.9, 1.4, 0.45)
    wwin2 = K.opening(wing, 0, WW * 0.82, 0.6, 0.7, 1.6, 0.45)
    block(wing, Z1, 'wing', [wdoor, wwin, wwin2], gaps={1: [(WD - 1.45, WD + 0.3)], 2: [(-1, WW + 1)]}, t=0.45, spout_skip=(1, 2),
          roof='patio_flags', roof_tint=(0.97, 0.93, 0.88))
    # stair: along the wing's east wall, climbing north to the terrace
    sx = x0 + WW + 0.55
    n = int(round((Z1 + 0.03) / 0.18))
    L = 0.28 * n
    SY = -0.35 - L
    dz.stair_flight((sx, SY, 0.0), (0, 1, 0), 1.0, Z1 + 0.03, n, PL, WASH, cheek=1, name='stair_ext', seed=SEED)
    K.ladder_meta((sx, SY - 0.45), (x0 + WW - 0.7, -0.75), Z1 + 0.03)
    K.footprint([(sx - 0.5, SY), (sx + 0.75, SY), (sx + 0.75, -0.35), (sx - 0.5, -0.35)], 'LOW', 'stairs')
    K.ladder((LADX, -0.9, Z1 + 0.03), Z2 - Z1, (0, -1, 0), meta=False)
    K.ladder_meta((LADX, -1.3), (LADX, 0.6), Z2 + 0.03)
    dz.arch_surround(door, STONE, 0.26, stripes=True)
    dz.studded_door(door, 'front', CFG['door'])
    door_hood(door, 3.25)
    dz.studded_door(wdoor, 'wing', 'brown', tymp='boards', wicket=False)
    KA.voussoirs(wdoor, STONE)
    dress([g1] + up + fe + fn + fw + [wwin, wwin2], boxed=(2,))
    # roofs: kiosk over the inner stair (NE), hatch, repairs, laundry, flue; terrace life on the wing
    kiosk(x1 - 1.5, D - 1.4, 2.2, 1.9, 2.3, Z2 + 0.03, face=3)
    dz.hatch((x0 + 1.4, D - 1.3), Z2 + 0.03, 0.7, tint=WASH)
    dz.roof_patches(C.poly_offset(main, -0.6), Z2 + 0.03, 4, SEED)
    dz.laundry((x0 + 3.2, D - 0.7, Z2 + 0.03), (x0 + 3.2, 0.9, Z2 + 0.03), n=3)
    dz.hatch((x0 + WW - 1.1, -WD + 1.1), Z1 + 0.03, 0.6, tint=WASH, name='hatch_w')
    dz.roof_patches(C.poly_offset(wing, -0.6), Z1 + 0.03, 2, SEED + 9, lime=True, tar=False)
    clutter(C.poly_offset(wing, -0.35), Z1 + 0.03, 3, mat=True, wood=True)
    weather([(main, Z2), (wing, Z1)], 6, SEED)
    K.decal('poster_fr', (x0 + WW * 0.78, -WD - 0.004, 1.55), (0, -1, 0), 0.55, 0.75, alpha=0.9)
    K.anchor('roof_main', (0, D / 2, Z2 + 0.03))
    K.anchor('roof_terrace', (x0 + WW / 2, -WD / 2, Z1 + 0.03))


# ================================================================== variant b: tall block + ghorfa + corbelled bay; annex stair on its SOUTH front
if VAR == 'b':
    Z1, Z2, Z3 = 3.3, 6.6, 9.3
    main = [(-4.8, 0.0), (2.2, 0.0), (2.2, 6.5), (-4.8, 6.5)]
    annex = [(1.95, 1.6), (6.8, 1.6), (6.8, 6.5), (1.95, 6.5)]
    door = dz.HFrame(K.opening(main, 0, 1.4, 1.2, 2.7, 0.0, T, 'arch', 'door'))
    gw = [K.opening(main, 0, 3.0, 0.6, 0.75, 1.5, T), K.opening(main, 0, 6.0, 0.6, 0.75, 1.5, T)]
    upw = [K.opening(main, 0, 1.4, 0.8, 1.2, Z1 + 1.0, T)]
    fe = [K.opening(main, 1, 0.8, 0.7, 1.1, Z1 + 0.9, T), K.opening(main, 2, 2.5, 0.6, 0.8, 2.0, T), K.opening(main, 2, 5.0, 0.8, 1.2, Z1 + 1.0, T),
          K.opening(main, 3, 3.2, 0.8, 1.2, Z1 + 1.0, T), K.opening(main, 3, 1.6, 0.6, 0.7, 1.6, T)]
    block(main, Z2, 'main', [door] + gw + upw + fe, gaps={0: [(-1, 3.45)], 1: [(4.1, 4.9)], 3: [(3.25, 7)]}, spout_skip=(0,))
    adoor = K.opening(annex, 1, 2.2, 1.3, 2.3, 0.0, 0.45, 'segment', 'door')
    aw = [K.opening(annex, 0, 1.2, 0.55, 0.65, 1.6, 0.45), K.opening(annex, 2, 2.4, 0.6, 0.7, 1.6, 0.45)]
    block(annex, Z1, 'annex', [adoor] + aw, gaps={0: [(-1, 0.9)], 3: [(-1, 6)]}, t=0.45, spout_skip=(3,))
    # ghorfa: third-storey room on the SW corner of the main roof
    gh = [(-4.8, 0.0), (-1.4, 0.0), (-1.4, 3.2), (-4.8, 3.2)]
    gdoor = K.opening(gh, 1, 1.9, 0.85, 1.9, Z2 + 0.03, 0.35, 'segment', 'door')
    gwin = [K.opening(gh, 0, 1.7, 0.8, 1.1, Z2 + 0.95, 0.35), K.opening(gh, 3, 1.6, 0.6, 0.8, Z2 + 1.1, 0.35)]
    K.wall_ring(gh, Z3 - Z2 + 0.3, 0.35, PL, [gdoor] + gwin, z0=Z2 - 0.3, name='walls_ghorfa', mat_tint=WASH, footprint=False)
    dz.roof_slab(C.poly_offset(gh, -0.12), Z3 + 0.03, 0.3, SCREED, name='roof_gh', tint=ROOF_T)
    dz.parapet(gh, Z3, 0.45, 0.24, PL, style='lime', mat_tint=WASH, name='par_gh', climb=False)
    dz.course(gh, Z3 - 0.25, 0.14, 0.07, PL, name='cornice_gh', mat_tint=WASH)
    K.door(gdoor, 'ghorfa', 'plank', CFG['door'], step=None)
    dress(gwin)
    # corbelled first-floor bay (kbu) over the street, on timber joists
    bx0, bx1 = -1.2, 1.6
    bay = [(bx0, -0.65), (bx1, -0.65), (bx1, 0.25), (bx0, 0.25)]
    bw = [K.opening(bay, 0, 0.7, 0.62, 1.15, Z1 + 0.9, 0.22), K.opening(bay, 0, 2.1, 0.62, 1.15, Z1 + 0.9, 0.22),
          K.opening(bay, 1, 0.45, 0.4, 1.0, Z1 + 1.0, 0.22), K.opening(bay, 3, 0.45, 0.4, 1.0, Z1 + 1.0, 0.22)]
    K.wall_ring(bay, Z2 - 0.9 - Z1 - 0.3, 0.22, PL, bw, z0=Z1 + 0.3, name='walls_bay', mat_tint=WASH, footprint=False)
    dz.roof_slab(C.poly_offset(bay, 0.08), Z2 - 0.78, 0.12, 'roof_terracotta', name='bay_roof', tint=(0.95, 0.85, 0.78))
    bm = dz.bmesh.new()
    for k in range(6):
        x = bx0 + 0.1 + (bx1 - bx0 - 0.2) * k / 5
        C.beam_bm(bm, (x, 0.2, Z1 + 0.22), (x, -0.8, Z1 + 0.22), 0.1, 0.14)
        C.beam_bm(bm, (x, 0.0, Z1 - 0.35), (x, -0.55, Z1 + 0.15), 0.08, 0.08)
    C.beam_bm(bm, (bx0 - 0.1, -0.72, Z1 + 0.3), (bx1 + 0.1, -0.72, Z1 + 0.3), 0.08, 0.1)
    K.part(bm, 'timber_beam', name='bay_joists', uv='beam', axis=(0, 1, 0), mat_tint=(0.85, 0.72, 0.58))
    for k, f in enumerate(bw):
        K.window(f, 'single', (1, 3), frame=shut_c, sill=None, shutters='open' if f.w > 0.5 else None, shutter_color=shut_c,
                 shutter_style='louvred', curtain=0.5, name='bw%d' % k)
    # stair along the annex's street front, climbing west to the annex terrace (cheek on the street side)
    n = int(round((Z1 + 0.03) / 0.185))
    L = 0.28 * n
    sx0 = 2.25 + L
    dz.stair_flight((sx0, 1.6 - 0.58, 0.0), (-1, 0, 0), 1.0, Z1 + 0.03, n, PL, WASH, cheek=1, name='stair_ext', seed=SEED, niche=False)
    stair_side(sx0, 1.6 - 0.58 - 0.5, L, Z1 + 0.03)
    K.ladder_meta((sx0 + 0.45, 1.02), (2.8, 2.3), Z1 + 0.03)
    K.footprint([(2.25, 0.3), (sx0, 0.3), (sx0, 1.6), (2.25, 1.6)], 'LOW', 'stairs')
    K.ladder((2.2 + 0.45, 4.5, Z1 + 0.03), Z2 - Z1, (1, 0, 0), meta=False)
    K.ladder_meta((3.1, 4.5), (1.4, 4.5), Z2 + 0.03)
    dz.arch_surround(door, STONE, 0.26, stripes=True)
    dz.studded_door(door, 'front', CFG['door'])
    dz.studded_door(adoor, 'annex', 'brown', tymp='boards', wicket=False)
    KA.voussoirs(adoor, STONE)
    dress(gw + upw + fe + aw)
    dz.hatch((0.8, 5.2), Z2 + 0.03, 0.7, tint=WASH)
    dz.roof_patches([(-1.2, 0.4), (1.9, 0.4), (1.9, 6.1), (-4.5, 6.1), (-4.5, 3.6), (-1.2, 3.6)], Z2 + 0.03, 4, SEED)
    dz.laundry((-4.2, 4.0, Z2 + 0.03), (1.6, 4.3, Z2 + 0.03), n=4)
    dz.vault_dome((4.4, 4.1), 2.6, 2.6, Z1 + 0.03, PL, WASH, name='qubba', kind='barrel')
    clutter([(2.4, 1.9), (6.5, 1.9), (6.5, 2.9), (2.4, 2.9)], Z1 + 0.03, 2, mat=False, wood=True)
    dz.roof_patches(C.poly_offset(gh, -0.4), Z3 + 0.03, 1, SEED + 4, lime=False)
    clutter([(-1.1, 3.4), (1.8, 3.4), (1.8, 6.2), (-1.1, 6.2)], Z2 + 0.03, 3, mat=False, wood=True, seed=5)
    flue((1.55, 0.75), Z2 + 0.03)
    dz.jars([(-4.3, 2.6, Z3 + 0.03)], name='jar_gh', seed=3)
    bm = dz.bmesh.new()
    dz.card_bm(bm, (-2.2, 2.6, Z3 + 0.06), (-1.9, 0.6, Z3 + 0.1), 0.9, droop=-0.02, cell='dry')
    dz.card_bm(bm, (-2.5, 2.4, Z3 + 0.09), (-2.6, 0.5, Z3 + 0.12), 0.8, droop=-0.02, cell='brown')
    K.part(bm, 'palm_frond_dz', name='fronds_gh', uv='keep', grime=0.2, bisect=False)
    bm = dz.bmesh.new()       # tv-less 1943 roof: a cane pigeon cote / chicken coop crate on the ghorfa roof
    dz.crate(bm, (-3.2, 1.5, Z3 + 0.03), (1.0, 0.7, 0.6), 0.3)
    K.part(bm, 'timber_grey', name='coop', uv='beam', axis=(1, 0, 0), grime=0.6)
    weather([(main, Z2), (annex, Z1)], 6, SEED)
    K.decal('poster_fr', (-0.2, -0.004, 1.6), (0, -1, 0), 0.55, 0.75, alpha=0.9)
    K.anchor('roof_main', (-1.0, 4.5, Z2 + 0.03))
    K.anchor('roof_terrace', (4.4, 2.3, Z1 + 0.03))


# ================================================================== variant c: long low house + qubba + EAST tower room + walled forecourt, stair on WEST gable
if VAR == 'c':
    Z1, Z2 = 3.8, 7.2
    low = [(-5.5, 0.0), (1.9, 0.0), (1.9, 6.0), (-5.5, 6.0)]
    tower = [(1.65, 0.0), (5.5, 0.0), (5.5, 6.0), (1.65, 6.0)]
    door = dz.HFrame(K.opening(low, 0, 3.4, 1.25, 2.8, 0.0, T, 'arch', 'door'))
    lw = [K.opening(low, 0, 1.4, 0.8, 1.1, 1.4, T), K.opening(low, 0, 5.5, 0.8, 1.1, 1.4, T), K.opening(low, 2, 2.0, 0.6, 0.7, 2.1, T),
          K.opening(low, 2, 5.4, 0.6, 0.7, 2.1, T)]
    block(low, Z1, 'low', [door] + lw, gaps={3: [(1.2, 2.1)], 1: [(-1, 7)]}, spout_skip=(1,))
    tw = [K.opening(tower, 0, 1.9, 0.9, 1.2, 1.5, T), K.opening(tower, 0, 1.9, 0.9, 1.35, Z1 + 0.9, T), K.opening(tower, 1, 3.0, 0.8, 1.2, Z1 + 0.9, T),
          K.opening(tower, 1, 3.0, 0.7, 0.9, 1.6, T), K.opening(tower, 2, 1.9, 0.8, 1.2, Z1 + 0.9, T),
          K.opening(tower, 3, 1.5, 0.8, 1.2, Z1 + 0.95, T)]
    block(tower, Z2, 'tower', tw, gaps={3: [(2.6, 3.4)]}, spout_skip=())
    if CFG['dado']:
        dz.course(low, 0.0, 1.05, 0.012, PL, name='dado_low', mat_tint=CFG['dado'])
        dz.course(tower, 0.0, 1.05, 0.012, PL, name='dado_tw', mat_tint=CFG['dado'])
    # qubba dome over the reception room (on a square drum), second smaller barrel vault
    dz.qubba((-1.8, 3.0), 3.0, Z1 + 0.03, r=1.25, tint=(0.99, 0.985, 0.97), name='qubba')
    # forecourt wall with an arched gate (skifa)
    Y = -4.2
    court = [(-5.5, Y), (1.65, Y), (1.65, 0.0), (-5.5, 0.0)]
    gate = K.opening(court, 0, 2.2, 1.6, 2.35, 0.0, 0.4, 'arch', 'door')
    cwin = K.opening(court, 0, 5.4, 0.5, 0.5, 1.5, 0.4)
    K.wall_ring(court, 2.6, 0.4, PL, [gate, cwin], name='walls_court', mat_tint=WASH, footprint=False)
    for i in range(3):             # HIGH footprints of the three free-standing court walls
        a, b, rr, nn, Le = dz.edge(court, i)
        K.footprint([tuple(a)[:2], tuple(b)[:2], tuple(b - nn * 0.4)[:2], tuple(a - nn * 0.4)[:2]], 'HIGH', 'wall')
    bm = dz.bmesh.new()
    for i in range(3):
        a, b, rr, nn, Le = dz.edge(court, i)
        for t0, t1 in dz.segs_minus(Le, [(2.2 - 0.8, 2.2 + 0.8)] if i == 0 else []):
            dz.coping_bm(bm, a + rr * t0 - nn * 0.2, a + rr * t1 - nn * 0.2, 2.6, 0.4, seed=i)
    K.part(bm, PL, name='court_cope', mat_tint=WASH)
    for i in range(3):
        a, b, rr, nn, Le = dz.edge(court, i)
        C.climb_meta(tuple(a)[:2], tuple(b)[:2], 2.6, 'wall')
    KA.voussoirs(gate, STONE)
    K.door(gate, 'gate', 'double', 'brown', open_deg=70, step=STONE)
    K.window(cwin, 'fixed', (1, 1), frame=shut_c, sill=None, bars=True, streak=False, name='cwin')
    dz.patch_quad([(-5.1, Y + 0.4, 0), (1.25, Y + 0.4, 0), (1.25, -0.05, 0), (-5.1, -0.05, 0)], 'patio_flags', 'court_floor', lift=0.02)
    dz.shade(-4.4, -1.9, -2.2, -0.4, 2.4, name='vine')
    bm = dz.bmesh.new()       # masonry bench (mastaba) along the house front
    C.box_bm(bm, (0.3, -0.35, 0.22), (2.2, 0.5, 0.44))
    K.part(bm, PL, name='mastaba', mat_tint=WASH)
    # stair up the west gable, climbing north, cheek on the outer (west) side
    n = int(round((Z1 + 0.03) / 0.185))
    L = 0.28 * n
    dz.stair_flight((-5.5 - 0.55, 5.95 - L, 0.0), (0, 1, 0), 1.0, Z1 + 0.03, n, PL, WASH, cheek=-1, name='stair_ext', seed=SEED)
    K.ladder_meta((-6.05, 5.95 - L - 0.45), (-4.9, 5.6), Z1 + 0.03)
    K.footprint([(-6.8, 5.95 - L), (-5.5, 5.95 - L), (-5.5, 5.95), (-6.8, 5.95)], 'LOW', 'stairs')
    K.ladder((1.65 - 0.45, 3.0, Z1 + 0.03), Z2 - Z1, (-1, 0, 0), meta=False)
    K.ladder_meta((0.8, 3.0), (2.4, 3.0), Z2 + 0.03)
    dz.arch_surround(door, STONE, 0.26, stripes=True)
    dz.studded_door(door, 'front', CFG['door'])
    dress(lw + tw, boxed=(5,))
    dz.hatch((4.3, 4.6), Z2 + 0.03, 0.7, tint=WASH)
    dz.roof_patches(C.poly_offset(tower, -0.6), Z2 + 0.03, 2, SEED)
    dz.roof_patches([(-5.0, 0.5), (-3.4, 0.5), (-3.4, 5.5), (-5.0, 5.5)], Z1 + 0.03, 2, SEED + 3)
    dz.roof_patches([(-0.1, 0.5), (1.3, 0.5), (1.3, 5.5), (-0.1, 5.5)], Z1 + 0.03, 1, SEED + 5, lime=False)
    clutter([(-5.0, 0.4), (-3.3, 0.4), (-3.3, 5.6), (-5.0, 5.6)], Z1 + 0.03, 2, mat=True, wood=False)
    dz.laundry((2.4, 0.7, Z2 + 0.03), (2.4, 5.0, Z2 + 0.03), n=3)
    weather([(low, Z1), (tower, Z2), (court, 2.6)], 7, SEED)
    K.anchor('roof_main', (-1.8, 1.0, Z1 + 0.03))
    K.anchor('roof_terrace', (3.6, 3.0, Z2 + 0.03))

dz.finalize(OUT, ao_res=1024, ao_samples=48)
