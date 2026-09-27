"""Desert barracks (M8-M11 garrison buildings; the flag marks a reinforcement building, spec 2.4), rework 1.
a = Italian colonial caserma (Libya 1930s): stone plinth, ochre-cream render with pilasters, moulded cornice, painted
    fascia band, moulded window surrounds, green persiane; LOWER arcaded veranda (real step to the main roof, no stray
    parapet line); main roof in cracked screed with tar expansion strips, hatch, vent stacks, water tank, radio mast,
    sandbagged MG nest; flag (field-grey + Balkenkreuz stand-in) with halyard.
b = DAK prefab timber hut on concrete piers + sill plate: sand-painted boards bleached at the top, tar-felt roof in
    lapped strips with battens, felt ridge roll and patches, gable louvres, stove pipes, porches, sand drifts, flag.
_destroyed: a = roof slab broken and hinged into the room, modelled interior (floor, bunks, lockers, partition),
    limestone/plaster/screed/rebar rubble; b = roof hole onto a modelled interior (floor, bunks, stove), charred
    splintered boards round the breach, plank/felt/stud debris.
Usage: blender -b --python barracks_desert.py -- outdir [a|b|a_destroyed|b_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
KIND, DEST = VAR[0], VAR.endswith('destroyed')
SEED = int(av[2]) if len(av) > 2 else {'a': 81, 'b': 83}[KIND]
K.begin('barracks_desert_' + VAR, SEED, theater='desert')
r = K.rng()
STONE = 'ashlar'


def bunks(x0, y0, n, dx, rot=0.0, name='bunks', z=0.0, charred=False):
    """Double bunk frames (steel) with mattresses and grey blankets along a wall."""
    bm, bmm = bmesh.new(), bmesh.new()
    for k in range(n):
        cx, cy = x0 + dx * k, y0
        for zz in (0.35, 1.25):
            C.box_bm(bmm, (cx, cy, z + zz + 0.07), (0.8, 1.9, 0.14))
        for sx in (-0.4, 0.4):
            for sy in (-0.95, 0.95):
                C.box_bm(bm, (cx + sx, cy + sy, z + 0.85), (0.04, 0.04, 1.7))
        for zz in (0.35, 1.25):
            C.box_bm(bm, (cx, cy - 0.95, z + zz), (0.84, 0.04, 0.05))
            C.box_bm(bm, (cx, cy + 0.95, z + zz), (0.84, 0.04, 0.05))
    K.part(bm, 'steel_painted', name=name + '_frames', mat_tint=(0.25, 0.25, 0.22) if charred else (0.5, 0.52, 0.45), bisect=False, lod='drop')
    K.part(bmm, 'canvas', name=name + '_matt', mat_tint=(0.2, 0.18, 0.16) if charred else (0.55, 0.55, 0.5), bisect=False, lod='drop')


def lockers(x0, y, n, name='lockers', z=0.0):
    bm = bmesh.new()
    for k in range(n):
        C.box_bm(bm, (x0 + 0.62 * k, y, z + 0.9), (0.6, 0.5, 1.8))
    K.part(bm, 'steel_painted', name=name, mat_tint=(0.5, 0.55, 0.45), bisect=False, lod='drop')


if KIND == 'a':
    L, Dp, H, T, HV = 20.0, 8.0, 4.8, 0.55, 3.3
    REND, RT = 'plaster_rough', (1.0, 0.9, 0.74)
    poly = [(-L / 2, 0.0), (L / 2, 0.0), (L / 2, Dp), (-L / 2, Dp)]
    HOLE = (1.2, 7.0, 0.7, Dp - 0.45) if DEST else None
    fr = []
    for k in range(6):
        t = 1.6 + k * (L - 3.2) / 5
        fr.append(K.opening(poly, 0, t, 1.5, 2.5, 0.3, T, 'segment', 'door') if k in (1, 4) else K.opening(poly, 0, t, 1.0, 1.8, 1.0, T, 'segment'))
    clere = [K.opening(poly, 0, 1.6 + k * (L - 3.2) / 5, 0.9, 0.55, HV + 0.45, T) for k in range(6)]
    back = [K.opening(poly, 2, 1.6 + k * (L - 3.2) / 5, 1.0, 1.4, 1.6, T) for k in range(6)]
    side = [K.opening(poly, 1, Dp / 2, 1.2, 2.5, 0.3, T, 'segment', 'door'), K.opening(poly, 3, Dp / 2, 1.0, 1.8, 1.1, T, 'segment')]
    K.wall_ring(poly, H, T, REND, fr + clere + back + side, name='walls', mat_tint=RT, plinth=(STONE, 0.7, 0.05))
    inner = C.poly_offset(poly, -0.3)
    if HOLE:
        hx0, hx1, hy0, hy1 = HOLE
        for pts in ([(-L / 2 + 0.3, 0.3), (hx0 + 0.3, 0.3), (hx0 - 0.2, 2.5), (hx0 + 0.25, 5.0), (hx0 - 0.1, Dp - 0.3), (-L / 2 + 0.3, Dp - 0.3)],
                    [(hx1 - 0.2, 0.3), (L / 2 - 0.3, 0.3), (L / 2 - 0.3, Dp - 0.3), (hx1 + 0.1, Dp - 0.3), (hx1 - 0.35, 4.2), (hx1 + 0.2, 1.8)]):
            dz.roof_slab(pts, H + 0.03, 0.35, 'screed_roof', name='roof%d' % len(C.A.parts), tint=(0.95, 0.92, 0.88))
            K.roof_meta(pts, H + 0.03, walkable=True, kind='flat')
    else:
        dz.roof_slab(inner, H + 0.03, 0.35, 'screed_roof', name='roof', tint=(0.95, 0.92, 0.88))
        K.roof_meta(inner, H + 0.03, walkable=True, kind='flat')
    K.cornice(poly, H - 0.45, REND, steps=((0.05, 0.08), (0.11, 0.07), (0.18, 0.1)), name='cornice')
    dz.course(poly, H - 0.95, 0.42, 0.015, REND, name='fascia', mat_tint=(0.97, 0.82, 0.62))
    dz.parapet(poly, H, 0.75, 0.3, REND, style='crenel', gaps={0: [(L / 2 - 0.7, L / 2 + 0.7)]}, mat_tint=RT, name='parapet', mspace=1.3)
    dz.spouts(poly, H - 0.05, 5.0, 'cast_iron', skip=(0,))
    bm = bmesh.new()             # pilasters dividing the bays (front + ends)
    for k in range(7):
        x = -L / 2 + 0.15 + k * (L - 0.3) / 6
        C.box_bm(bm, (x, -0.05, (0.7 + H - 0.45) / 2), (0.42, 0.12, H - 0.45 - 0.7))
    K.part(bm, REND, name='pilasters', mat_tint=(0.98, 0.9, 0.78))
    # lower arcaded veranda with its own walkable roof (a real step below the main roof)
    VD = 2.6
    vl = [(-L / 2, -VD), (L / 2, -VD), (L / 2, -VD + 0.5), (-L / 2, -VD + 0.5)]
    nb = 7
    bw = L / nb
    arcs = [K.opening(vl, 0, bw * (k + 0.5), bw - 0.65, 2.55, 0.0, 0.5, 'arch', 'window') for k in range(nb)]
    bm = bmesh.new()
    C.prism_bm(bm, vl, 0.0, HV - 0.3)
    bm = KA.boolean_cut(bm, arcs)
    K.part(bm, REND, name='veranda_arcade', mat_tint=RT)
    for f in arcs:
        KA.voussoirs(f, STONE, n=9, depth=0.5)
    for k in range(nb + 1):
        x = -L / 2 + bw * k
        K.footprint_rect(min(max(x, -L / 2 + 0.3), L / 2 - 0.3), -VD + 0.25, 0.6, 0.5, 0, 'HIGH', 'pier')
    bm = bmesh.new()
    C.prism_bm(bm, [(-L / 2, -VD), (L / 2, -VD), (L / 2, 0.0), (-L / 2, 0.0)], HV - 0.3, HV)
    K.part(bm, 'concrete_bunker', name='veranda_roof', mat_tint=(0.95, 0.9, 0.82))
    dz.patch_quad([(-L / 2 + 0.2, -VD + 0.2, HV), (L / 2 - 0.2, -VD + 0.2, HV), (L / 2 - 0.2, -0.1, HV), (-L / 2 + 0.2, -0.1, HV)], 'screed_roof', 'vroof_top',
                  tint=(0.93, 0.9, 0.86), lift=0.01)
    dz.parapet([(-L / 2, -VD), (L / 2, -VD), (L / 2, 0.2), (-L / 2, 0.2)], HV, 0.7, 0.3, REND, style='crenel', gaps={2: [(-1, L + 1)]}, mat_tint=RT, name='veranda_par', mspace=1.3)
    K.roof_meta([(-L / 2 + 0.3, -VD + 0.3), (L / 2 - 0.3, -VD + 0.3), (L / 2 - 0.3, 0.0), (-L / 2 + 0.3, 0.0)], HV, walkable=True, kind='flat')
    dz.patch_quad([(-L / 2 + 0.3, -VD + 0.5, 0), (L / 2 - 0.3, -VD + 0.5, 0), (L / 2 - 0.3, -0.05, 0), (-L / 2 + 0.3, -0.05, 0)], 'patio_flags', 'veranda_floor',
                  tint=(0.92, 0.9, 0.85), lift=0.06)
    bm = bmesh.new()             # veranda life: benches, ammo crates, hanging lamps
    for x in ((-6.5, 1.0, 7.5) if not DEST else (-6.5,)):
        C.box_bm(bm, (x, -0.45, 0.25), (1.8, 0.4, 0.06))
        for sx in (-0.8, 0.8):
            C.box_bm(bm, (x + sx, -0.45, 0.12), (0.06, 0.35, 0.24))
    K.part(bm, 'timber_grey', name='benches', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    for k in range(3):
        dz.crate(bm, (-3.0 + 0.1 * k, -1.2 + 0.05 * k, 0.55 * (k == 2)), (0.8, 0.45, 0.4) if k < 2 else (0.7, 0.45, 0.35), 0.05 * k)
    K.part(bm, 'timber_siding', name='ammo_crates', uv='beam', axis=(1, 0, 0), mat_tint=(0.7, 0.72, 0.55))
    bm = bmesh.new()
    for x in ((-5.7, 0.0, 5.7) if not DEST else (-5.7,)):
        C.cyl_bm(bm, (x, -1.3, HV - 0.3), (x, -1.3, HV - 0.7), 0.01, 3, caps=False)
        C.cyl_bm(bm, (x, -1.3, HV - 0.7), (x, -1.3, HV - 0.85), 0.18, 8, r1=0.05)
    K.part(bm, 'steel_painted', name='lamps', mat_tint=(0.4, 0.45, 0.38), bisect=False)
    for f in fr + side:
        if f.kind == 'door':
            K.door(f, 'd%d' % len(C.A.meta['doors']), ('glazed' if f.n.y < -0.5 else 'panel') if not DEST else 'plank', (0.3, 0.36, 0.3),
                   step=None, surround=None, open_deg=0 if not DEST else 70)
            KA.voussoirs(f, STONE)
        else:
            front = f.n.y < -0.5
            K.window(f, 'casement', (1, 2 if DEST else 3), frame=(0.62, 0.6, 0.55), sill=STONE, surround='ashlar_limestone' if front else None,
                     shutters=r.choice(['open', 'open', 'closed', 'ajar']) if front else None, shutter_color=(0.3, 0.4, 0.3),
                     shutter_style='louvred' if int(abs(f.o.x)) % 3 == 0 else 'plank', bars=not front, curtain=0.3, name='w%d_%d' % (int(f.o.x), int(f.o.y)))
    for f in clere + back:
        dz.grille_window(f, color=(0.3, 0.38, 0.3), name='gw%d_%d' % (int(f.o.x), int(f.o.y)), nb=3)
    # ---- roof: tar expansion strips, repairs, hatch, vent stacks, water tank, radio mast, sandbagged MG nest
    for k in range(1, 4):
        x = -L / 2 + k * L / 4 + 0.3
        if HOLE and HOLE[0] - 0.5 < x < HOLE[1] + 0.5:
            continue
        dz.patch_quad([(x - 0.16, 0.35, H + 0.03), (x + 0.16, 0.35, H + 0.03), (x + 0.16, Dp - 0.35, H + 0.03), (x - 0.16, Dp - 0.35, H + 0.03)],
                      'bitumen_felt', 'tarstrip%d' % k, lift=0.008)
    dz.roof_patches([(-L / 2 + 0.8, 0.8), (-2.5, 0.8), (-2.5, Dp - 0.8), (-L / 2 + 0.8, Dp - 0.8)], H + 0.03, 3, SEED, lime=True, tar=True,
                    lime_mat='screed_roof', lime_tint=(1.0, 0.98, 0.95))
    dz.hatch((-L / 2 + 2.0, Dp - 1.1), H + 0.03, 0.7, curb='concrete_bunker', name='roofhatch')
    bm = bmesh.new()
    for x in (-5.5, 4.5 if not HOLE else 8.0):
        C.box_bm(bm, (x, Dp - 0.9, H + 0.5), (0.45, 0.45, 1.0))
        C.box_bm(bm, (x, Dp - 0.9, H + 1.06), (0.62, 0.62, 0.08))
        C.box_bm(bm, (x, Dp - 0.9, H + 1.2), (0.3, 0.3, 0.2))
    K.part(bm, REND, name='vents', mat_tint=RT)
    bm = bmesh.new()
    tx, ty = L / 2 - 2.2, Dp - 2.0
    for sx in (-0.7, 0.7):
        for sy in (-0.7, 0.7):
            C.beam_bm(bm, (tx + sx, ty + sy, H + 0.03), (tx + sx * 0.9, ty + sy * 0.9, H + 1.3), 0.08, 0.08)
    C.beam_bm(bm, (tx - 0.8, ty - 0.63, H + 0.7), (tx + 0.8, ty - 0.63, H + 0.7), 0.05, 0.05)
    C.cyl_bm(bm, (tx, ty, H + 1.3), (tx, ty, H + 2.9), 0.95, 16)
    C.cyl_bm(bm, (tx, ty, H + 2.9), (tx, ty, H + 3.05), 0.97, 16, r1=0.4)
    K.part(bm, 'steel_painted', name='water_tank', mat_tint=(0.62, 0.6, 0.5))
    K.decal('streak_rust', (tx, ty - 0.955, H + 1.9), (0, -1, 0), 0.8, 1.2, alpha=0.6)
    bm = bmesh.new()             # radio mast with guys and an aerial wire to the tank (toppled in the destroyed state)
    mx, my = -L / 2 + 4.0, Dp - 1.2
    C.cyl_bm(bm, (mx, my, H + 0.03), (mx, my, H + 6.0) if not DEST else (mx + 3.5, my - 1.5, H + 0.4), 0.045, 6)
    for gx, gy in (((-1.6, -0.9), (1.6, -0.9), (0.0, 0.9)) if not DEST else ()):
        C.cyl_bm(bm, (mx, my, H + 4.5), (mx + gx, my + gy, H + 0.05), 0.006, 3, caps=False)
    K.part(bm, 'steel_galv', name='radio_mast', bisect=False)
    if not DEST:
        bm = dz.rope((mx, my, H + 5.9), (tx, ty, H + 3.0), 0.5, 0.005, 8)
        K.part(bm, 'cast_iron', name='aerial', grime=0, bisect=False)
    nx0, ny0 = L / 2 - 2.6, 0.9                 # MG nest (sandbag U facing south-east); blown away when destroyed
    dz.sandbags((nx0, ny0 - 0.3 + 0.0), (nx0 + 2.0, ny0 - 0.3), 3, name='mg_s', footprint=False)
    dz.sandbags((nx0 + 2.0, ny0 - 0.3), (nx0 + 2.0, ny0 + 1.4), 3 if not DEST else 1, name='mg_e', footprint=False)
    dz.sandbags((nx0, ny0 + 1.4), (nx0, ny0 - 0.3), 3 if not DEST else 1, name='mg_w', footprint=False)
    for o in C.A.parts[-3:]:
        for v in o.data.vertices:
            v.co.z += H + 0.03
    if not DEST:          # (destroyed: the iron ladder was torn off by the blast; roof reached over the rubble ramp)
        K.ladder((-L / 2 + 2.0, Dp + 0.55, 0), H + 0.75, (0, 1, 0), mid='steel_galv', meta=False)
        K.ladder_meta((-L / 2 + 2.0, Dp + 1.0), (-L / 2 + 2.0, Dp - 0.6), H + 0.03)
    if not DEST:
        K.ladder((L / 2 - 0.9, -VD - 0.5, 0), HV, (0, -1, 0), mid='timber_grey', meta=False)
        K.ladder_meta((L / 2 - 0.9, -VD - 0.9), (L / 2 - 0.9, -VD + 0.6), HV)
    dz.flagpole((L / 2 + 1.5, -VD - 1.2, 0), 8.0)
    dz.sandbags((L / 2 + 0.25, -VD - 0.5), (L / 2 + 0.25, 1.5) if not DEST else (L / 2 + 0.25, -0.6), 6, name='sb_e', thick=1)
    K.sign((-bw * 1.5, -VD - 0.01, HV - 0.55), (0, -1, 0), 1.3, 'kommandantur', board='timber_grey')
    main_poly, zroof = poly, H
    if DEST:
        hx0, hx1, hy0, hy1 = HOLE
        # interior of the room under the hole: floor, partition with a doorway, bunks, lockers
        dz.patch_quad([(hx0 - 1.0, 0.55, 0), (hx1 + 1.0, 0.55, 0), (hx1 + 1.0, Dp - 0.55, 0), (hx0 - 1.0, Dp - 0.55, 0)], 'patio_flags', 'room_floor',
                      tint=(0.8, 0.76, 0.7), lift=0.05)
        bm = bmesh.new()
        C.box_bm(bm, (hx1 + 0.4, Dp / 2 + 1.6, H / 2), (0.18, Dp - 4.2, H))
        C.box_bm(bm, (hx1 + 0.4, 1.2, H / 2), (0.18, 1.3, H))
        K.part(bm, 'plaster_rough', name='partition', mat_tint=(0.9, 0.86, 0.78))
        bunks(hx0 + 0.8, Dp - 1.6, 4, 1.3, name='bunks', charred=False)
        lockers(hx0 + 0.4, 1.0, 3)
        # roof slab broken and hinged into the room (two plates + rebar along the snapped edge)
        bm = bmesh.new()
        dz.chunk_bm(bm, ((hx0 + hx1) / 2 - 1.2, (hy0 + hy1) / 2 + 0.8, H * 0.55), (2.6, 4.6, 0.3), (0.72, 0.1, 0.05), SEED, 0.2)
        dz.chunk_bm(bm, ((hx0 + hx1) / 2 + 1.5, (hy0 + hy1) / 2 - 0.2, H * 0.35), (2.4, 3.8, 0.3), (-0.55, -0.15, -0.1), SEED + 1, 0.2)
        K.part(bm, 'screed_roof', name='fallen_slab', mat_tint=(0.9, 0.87, 0.82))
        bm = bmesh.new()
        for k in range(10):
            p = V((hx0 + 0.4 + (hx1 - hx0 - 0.8) * k / 9, Dp - 0.5, H - 0.1))
            dz.rebar_bm(bm, p, p + V((r.uniform(-0.2, 0.2), -r.uniform(0.5, 1.1), -r.uniform(0.3, 0.9))), r.uniform(-0.3, 0.6))
        K.part(bm, 'cast_iron', name='rebar', mat_tint=(0.45, 0.28, 0.18), bisect=False, lod='drop')
        dz.safe_bite((-3.5, 0.0, 2.2), 1.9, (1.2, 1.3, 1.2), seed=5)
        dz.safe_bite((6.5, -2.6, 2.6), 1.5, (1.2, 1.0, 1.0), seed=13)
        dz.rubble_stone((-3.5, -1.0, 0), 2.2, 1.4, 0.9, seed=SEED, blocks=15, slabs=1, beams=1, rebar=2, plaster=6, name='rub0')
        dz.rubble_stone(((hx0 + hx1) / 2, 2.2, 0), 2.6, 1.3, 0.8, seed=SEED + 3, blocks=12, slabs=1, beams=2, rebar=2, plaster=5, name='rub1')
        dz.rubble_stone((6.6, -3.2, 0), 1.4, 1.0, 0.6, seed=SEED + 5, blocks=8, slabs=0, beams=0, rebar=0, plaster=3, name='rub2')

else:
    L, Dp, T = 16.0, 7.0, 0.16
    ZF, HW = 0.55, 2.6
    BOARD, BT = 'wood_paint', (0.9, 0.8, 0.6)          # sand-yellow paint over boards (timber_siding read dark brown)
    poly = [(-L / 2, 0.0), (L / 2, 0.0), (L / 2, Dp), (-L / 2, Dp)]
    fr = [K.opening(poly, 0, 1.4 + k * (L - 2.8) / 5, 1.0, 1.1, ZF + 0.95, T) for k in range(6)]
    fb = [K.opening(poly, 2, 1.4 + k * (L - 2.8) / 5, 1.0, 1.1, ZF + 0.95, T) for k in range(6)]
    de = K.opening(poly, 1, Dp / 2, 1.1, 2.05, ZF, T, 'rect', 'door')
    dw = K.opening(poly, 3, Dp / 2, 1.0, 2.0, ZF, T, 'rect', 'door')
    K.wall_ring(poly, HW, T, BOARD, fr + fb + [de, dw], z0=ZF, name='walls', mat_tint=BT)
    bm = bmesh.new()             # sill plate + skirting + concrete piers
    KA.ring_bm(bm, C.poly_offset(poly, 0.05), C.poly_offset(poly, -0.12), ZF - 0.16, ZF + 0.02)
    K.part(bm, 'timber_beam', name='sillplate', mat_tint=(0.62, 0.54, 0.42), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(poly, 0.03), C.poly_offset(poly, -0.05), ZF + 0.02, ZF + 0.24)
    K.part(bm, 'timber_beam', name='skirting', mat_tint=(0.8, 0.72, 0.55))
    bm = bmesh.new()
    for i in range(7):
        for y in (0.3, Dp / 2, Dp - 0.3):
            C.box_bm(bm, (-L / 2 + 0.3 + i * (L - 0.6) / 6, y, (ZF - 0.16) / 2 - 0.03), (0.42, 0.42, ZF - 0.1), taper=(0.85, 0.85))
    K.part(bm, 'concrete_bunker', name='piers')
    bm = bmesh.new()             # crawlspace: underside of the floor (dim boards), no void
    C.prism_bm(bm, C.poly_offset(poly, -0.06), ZF - 0.2, ZF - 0.16)
    K.part(bm, 'timber_grey', name='floor_under', mat_tint=(0.5, 0.46, 0.4), grime=0.6, lod='drop')
    bm = bmesh.new()
    for x in [-L / 2 + k * L / 8 for k in range(9)]:
        for y, s in ((0.0, -1), (Dp, 1)):
            C.box_bm(bm, (x, y + s * 0.02, ZF + HW / 2), (0.1, 0.04, HW))
    K.part(bm, 'timber_beam', name='battens', mat_tint=(0.85, 0.76, 0.56), uv='beam', axis=(0, 0, 1))
    R = K.roof_gable(0, Dp / 2, L, Dp, ZF + HW, 22, 'bitumen_felt', rot=0, eave_oh=0.45, gable_oh=0.35, thick=0.1,
                     ridge='angle', gutters=False, sag=0.035, wobble=0.012, fascia='timber_siding', barge='timber_siding')
    for e in (1, 3):
        g = K.gable(poly, e, ZF + HW, R.z_ridge - R.lift, T, BOARD, name='gable%d' % e, mat_tint=BT)
    bm = bmesh.new()             # felt laps: battens running down the slope every 1 m (the felt is laid in strips)
    for k in range(17):
        x = -L / 2 - 0.3 + k * (L + 0.6) / 16
        for s in (-1, 1):
            a = V((x, Dp / 2 + s * (Dp / 2 + 0.42), ZF + HW - 0.16))
            b = V((x, Dp / 2, R.z_ridge + 0.02))
            C.beam_bm(bm, a, b, 0.045, 0.035)
    K.part(bm, 'timber_tarred', name='roof_battens', uv='beam', axis=(0, 1, 0))
    bm = bmesh.new()             # felt ridge roll
    C.cyl_bm(bm, (-L / 2 - 0.35, Dp / 2, R.z_ridge + 0.02), (L / 2 + 0.35, Dp / 2, R.z_ridge + 0.02), 0.09, 6)
    K.part(bm, 'bitumen_felt', name='ridge_roll', smooth=True, uv='beam', axis=(1, 0, 0))
    for (px, py, w, h) in ((-4.3, 1.6, 1.4, 1.0), (2.5, 5.3, 1.1, 0.9), (5.8, 2.1, 0.9, 0.7)):     # felt patches on the slopes
        s = -1 if py < Dp / 2 else 1
        zf = lambda y: ZF + HW - 0.16 + (R.z_ridge - (ZF + HW - 0.16)) * (1 - abs(y - Dp / 2) / (Dp / 2 + 0.42)) + 0.05
        pts = [(px - w / 2, py - h / 2), (px + w / 2, py - h / 2), (px + w / 2, py + h / 2), (px - w / 2, py + h / 2)]
        dz.patch_quad([(x, y, zf(y)) for x, y in pts], 'bitumen_felt', 'fpatch%d' % int(px), tint=(0.8, 0.78, 0.72), lift=0.0)
    for x in (-L / 4, L / 4):
        K.chimney(x, Dp / 2 + 1.0, ZF + HW, R.z_ridge + 0.9, 0.18, 0.18, 'cast_iron', cap=None, pots=0, name='stovepipe')
    for e, x in ((1, L / 2), (3, -L / 2)):   # gable louvre vents
        bm = bmesh.new()
        sx = 1 if e == 1 else -1
        for k in range(5):
            z = R.z_ridge - 1.25 + 0.14 * k
            C.box_bm(bm, (x + sx * 0.06, Dp / 2, z), (0.03, 0.7, 0.1))
        C.box_bm(bm, (x + sx * 0.03, Dp / 2, R.z_ridge - 0.95), (0.03, 0.85, 0.8))
        K.part(bm, 'timber_siding', name='louvre%d' % e, mat_tint=(0.7, 0.62, 0.46), uv='beam', axis=(0, 1, 0))
    for f in fr + fb:
        K.window(f, 'casement', (2, 2), frame=(0.55, 0.5, 0.38), sill='timber_beam', shutters=r.choice(['open', 'open', 'closed']) if f.n.y < 0 else None,
                 shutter_color=(0.52, 0.46, 0.34), shutter_style='plank', curtain=0.25, streak=False, name='w%d_%d' % (int(f.o.x), int(f.o.y)))
    for f, did in ((de, 'east'), (dw, 'west')):
        K.door(f, did, 'plank', (0.5, 0.45, 0.33), step=None)
        nx = f.n.x
        K.stairs((f.o.x + nx * 1.7, f.o.y, 0.0), (-nx, 0, 0), 1.2, ZF, 3, 'timber_beam', solid=False, name='steps_' + did, meta=False)
        bm = bmesh.new()
        C.box_bm(bm, (f.o.x + nx * 0.45, f.o.y, ZF - 0.05), (0.9, 1.6, 0.1))
        K.part(bm, 'deck_planks', name='landing_' + did, uv='beam', axis=(0, 1, 0))
        K.roof_shed(min(f.o.x, f.o.x + nx * 1.2), f.o.y - 1.0, max(f.o.x, f.o.x + nx * 1.2), f.o.y + 1.0, ZF + 2.45, ZF + 2.75,
                    'bitumen_felt', low_side='+x' if nx > 0 else '-x', oh=0.05, name='porch_' + did, gutters=False)
        C.A.meta['roofs'].pop()
        K.footprint_rect(f.o.x + nx * 1.0, f.o.y, 2.0, 1.4, 0, 'LOW', 'porch')
    dz.flagpole((-L / 2 - 2.5, -2.0, 0), 7.5)
    dz.sandbags((-L / 2 + 1.0, -1.1), (-2.0, -1.1), 6, name='sb_front')
    dz.sandbags((L / 2 + 1.5, 1.3), (L / 2 + 1.5, Dp - 1.3), 6, name='sb_e')
    K.sign((0.0, -0.1, ZF + 2.2), (0, -1, 0), 1.1, 'wache', board='timber_grey')
    bm = bmesh.new()             # fire bucket rack + jerrycans by the door
    for k in range(3):
        c = V((L / 2 - 1.0 + 0.3 * k, -0.35, ZF + 0.9))
        C.cyl_bm(bm, c, c + V((0, 0, 0.26)), 0.12, 8, r1=0.15)
    K.part(bm, 'steel_painted', name='fire_buckets', mat_tint=(0.55, 0.16, 0.12), bisect=False)
    main_poly, zroof = poly, R.z_ridge
    K.anchor('roof_ridge', (0, Dp / 2, R.z_ridge))
    if DEST:
        # interior revealed by the roof hole: floor boards, bunks, stove, table; charred splinters round the breach
        dz.patch_quad([(-L / 2 + 0.2, 0.2, ZF), (L / 2 - 0.2, 0.2, ZF), (L / 2 - 0.2, Dp - 0.2, ZF), (-L / 2 + 0.2, Dp - 0.2, ZF)], 'deck_planks', 'floor',
                      tint=(0.7, 0.62, 0.52), lift=0.01)
        bunks(-5.8, Dp - 1.2, 4, 1.05, name='bunks', z=ZF, charred=True)
        bunks(2.2, Dp - 1.2, 4, 1.05, name='bunks2', z=ZF)
        bm = bmesh.new()
        C.box_bm(bm, (1.2, 2.6, ZF + 0.75), (1.8, 0.8, 0.06))
        C.cyl_bm(bm, (-4.0, 4.5, ZF), (-4.0, 4.5, ZF + 0.8), 0.25, 8)
        K.part(bm, 'timber_grey', name='table_stove', bisect=False, lod='drop')
        K.roof_holes(R, [(1.5, -1.8, 2.2), (-4.0, 1.5, 1.6), (4.5, 1.2, 1.4)])
        dz.safe_bite((2.0, 0.0, 1.8), 1.7, (1.3, 1.2, 1.3), seed=5)
        bm = bmesh.new()             # charred, splintered board ends sticking out round the wall breach
        for k in range(14):
            a = math.pi * (k / 13)
            p = V((2.0 + math.cos(a) * 1.9, -0.02, 1.8 + math.sin(a) * 1.7))
            if p.z < ZF + 0.1:
                continue
            d = V((math.cos(a), 0, math.sin(a)))
            C.box_bm(bm, tuple(p - d * 0.15 - V((0, 0.03, 0))), (0.12, 0.03, r.uniform(0.3, 0.55)), 0.0)
            C.cyl_bm(bm, p - d * 0.3, p - d * r.uniform(0.45, 0.7) + V((0, -0.05, 0)), 0.03, 4, r1=0.004)
        K.part(bm, 'timber_siding', name='charred_ends', mat_tint=(0.2, 0.17, 0.15), bisect=False, lod='drop')
        K.decal('soot', (2.0, -0.03, 2.4), (0, -1, 0), 4.2, 2.8, alpha=0.7)
        dz.debris_timber((2.2, -1.4, 0), 2.2, 1.3, seed=SEED, planks=16, felt=3, studs=6, name='deb0', mid='timber_siding', tint=BT, charred=0.5)
        dz.debris_timber((-3.8, 1.4, ZF), 1.5, 1.2, seed=SEED + 2, planks=9, felt=2, studs=3, name='deb1', mid='timber_siding', tint=BT, footprint=False, h=0.3)
        dz.debris_timber((4.6, 1.3, ZF), 1.2, 1.0, seed=SEED + 4, planks=7, felt=2, studs=3, name='deb2', mid='timber_siding', tint=(0.35, 0.3, 0.25), footprint=False, h=0.3)

# ---------------- shared weathering
for i in range(4):
    a, b, rv, n, Le = dz.edge(main_poly, i)
    if KIND == 'b' or i != 0:
        dz.sand_drift(tuple(a + rv * 0.5), tuple(b - rv * 0.5), tuple(n), r.uniform(0.25, 0.4), r.uniform(0.8, 1.3), seed=SEED + i)
    for k in range(int(Le / 4)):
        p = a + rv * r.uniform(0.6, Le - 0.6)
        K.decal('damp_base' if KIND == 'a' else 'dirt_splash', tuple(p + n * 0.02 + V((0, 0, 0.6))), tuple(n), r.uniform(1.5, 2.5), 1.0, alpha=0.35)
        if KIND == 'a' and r.random() < 0.6:
            dz.spall2(p + V((0, 0, r.uniform(1.0, 3.5))), n, r.uniform(0.5, 1.1), r.uniform(0.3, 0.6), 'brick_red', REND, RT, seed=SEED + k + 5 * i, name='sp%d_%d' % (i, k))
        if KIND == 'a':
            K.decal('streak_long', tuple(a + rv * r.uniform(0.6, Le - 0.6) + n * 0.005 + V((0, 0, H - 1.2))), tuple(n), 0.5, 1.6, alpha=0.22)
if KIND == 'b':             # sun-bleached paint: upper boards paler (vertex colour darkens the lower two thirds slightly)
    for o in C.A.parts:
        if o.name in ('walls', 'gable1', 'gable3'):
            ca = o.data.color_attributes.get('Col')
            for poly_ in o.data.polygons:
                for li in poly_.loop_indices:
                    z = o.data.vertices[o.data.loops[li].vertex_index].co.z
                    k = max(0.0, min(1.0, (ZF + HW - z) / HW))
                    c = list(ca.data[li].color)
                    ca.data[li].color = (c[0] * (1 - 0.1 * k), c[1] * (1 - 0.12 * k), c[2] * (1 - 0.14 * k), c[3])
if DEST:
    K.scorch_openings(1.0, 0.7)
    C.A.meta['notes'].append('destroyed variant: breach + roof hole onto a modelled interior; rubble = LOW cover; flag anchor kept')
dz.finalize(OUT, ao_res=1024, ao_samples=48)
