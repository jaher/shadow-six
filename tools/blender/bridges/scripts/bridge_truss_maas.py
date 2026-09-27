"""Maas bridge (M16/M18): three riveted through-truss spans (Pratt side spans, Parker/camelback centre span) on
dark ashlar river piers with cutwaters, starlings and a moulded cap cornice, rocker bearings on lowered bridge seats,
masonry abutments with back walls, approach ramps with retaining walls, sett roadway with kerbs, cantilevered plank
footways with lattice railings, lamps, portal signs. References: HAER Enterprise Parker truss (laced verticals,
gussets, rocker bearings), Nationaal Archief 'Vernielingen Venlo' 900-5734/5735 (CC0, blown Maas truss spans).
Variants: bridge_truss_maas (intact) | bridge_truss_maas_destroyed (centre span blown: buckled, twisted, torn halves)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
import brfix3 as F3   # round-4: talus debris v3 (no dome), LOD triangle targets
F3.RATIO_FLOOR[2] = 0.02   # beam/box assemblies survive deep collapse (checked at 0.5x)
from brlib import K, C, V, box_bm, beam_bm, cyl_bm
from mathutils import Matrix, noise as N
import bmesh, bpy
import kit_weather as W
from kit_bridge import abutment, lamp_post, ibeam_bm
part = F.part
F.ALIAS.update({'setts': ('cobblestone', (0.7, 0.68, 0.66), 0.6), 'ashlar_pier': ('ashlar', (0.5, 0.5, 0.48), 1.35)})

a = BL.args()
name = a[0] if a else 'bridge_truss_maas'
destroyed = name.endswith('_destroyed')
WATER, BED, ZD = -4.8, -8.0, 1.2
SPAN, PW, TW = 36.0, 3.6, 7.4                 # span, pier width (x), truss spacing (c-c)
ZSEAT = ZD - 1.5                              # bridge seat (top of pier cap / abutment shelf) under the rocker bearings
K.begin(name, 16, theater='temperate', water_level=WATER)
r = K.rng()
L = 3 * SPAN + 2 * PW
xs = [-L / 2, -L / 2 + SPAN, -L / 2 + SPAN + PW, L / 2 - SPAN - PW, L / 2 - SPAN, L / 2]
spans = [(xs[0], xs[1], 5.6, 5.6), (xs[2], xs[3], 5.6, 7.8), (xs[4], xs[5], 5.6, 5.6)]
piers = [(xs[1] + xs[2]) / 2, (xs[3] + xs[4]) / 2]
GREY = (0.5, 0.56, 0.52)
for k, (x0, x1, he, hm) in enumerate(spans):
    if destroyed and k == 1:
        continue
    F.truss_span2(x0 + 0.3, x1 - 0.3, ZD, he, hm, TW, 8, sign='brucke_12t' if k != 1 else None, name='truss%d' % k, tint=GREY)
    BL.slab_road(x0 + 0.3, x1 - 0.3, ZD, TW - 0.9, mid='setts', walk=TW / 2 + 0.85, name='road%d' % k)


def wreck(objs, piv, t_of, twist, bow, sag, seed):
    """Buckle / twist / crumple a truss half before it is dropped: sag + sideways bow of the top chord growing toward
    the torn end, twist about the span axis, noisy crumpling of the last 25 %, members near the tear torn away."""
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        islands, seen = [], set()
        for v in bm.verts:
            if v.index in seen:
                continue
            st, isl = [v], []
            seen.add(v.index)
            while st:
                u = st.pop()
                isl.append(u)
                for e in u.link_edges:
                    w = e.other_vert(u)
                    if w.index not in seen:
                        seen.add(w.index)
                        st.append(w)
            islands.append(isl)
        kill = []
        for isl in islands:
            c = sum((v.co for v in isl), V()) / len(isl)
            if t_of(c.x) > 0.86 and r.random() < 0.45 and len(islands) > 3:
                kill += isl
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
        for v in bm.verts:
            p = v.co
            t = max(0.0, min(1.0, t_of(p.x)))
            hz = max(0.0, p.z - (ZD - 0.45)) / 7.0
            p.z -= sag * math.sin(math.pi * t * 0.5) ** 2
            p.y += bow * math.sin(math.pi * t) * hz
            a_ = twist * t * t
            y, z = p.y, p.z - (ZD + 2.0)
            p.y, p.z = y * math.cos(a_) - z * math.sin(a_), y * math.sin(a_) + z * math.cos(a_) + ZD + 2.0
            if t > 0.72:
                k = (t - 0.72) / 0.28
                p += V((N.noise(p * 0.55 + V((seed, 0, 0))), N.noise(p * 0.55 + V((0, seed, 0))), N.noise(p * 0.55 + V((0, 0, seed))))) * 0.9 * k
        bm.to_mesh(o.data)
        bm.free()
    for o in objs:
        M = Matrix.Translation(V(piv[0])) @ piv[1] @ Matrix.Translation(-V(piv[0]))
        o.data.transform(M)
        o.data.update()


if destroyed:                                   # centre span: blown at mid-span, halves hinge down into the river
    x0, x1, he, hm = spans[1]
    xm = (x0 + x1) / 2
    for half, (ia, ib) in ((0, (0, 4)), (1, (4, 8))):
        n0 = len(C.A.parts)
        F.truss_span2(x0 + 0.3, x1 - 0.3, ZD, he, hm, TW, 8, name='wreck%d' % half, i_range=(ia, ib), tint=GREY, detail=False)
        BL.slab_road(x0 + 0.3 if half == 0 else xm + 0.6, xm - 0.6 if half == 0 else x1 - 0.3, ZD, TW - 0.9, mid='setts',
                     walk=TW / 2 + 0.85, name='wroad%d' % half)
        bm = bmesh.new()                                  # dangling stringers + torn, bent deck plates at the tear
        xt = xm - 0.4 if half == 0 else xm + 0.4
        sd = 1 if half == 0 else -1
        for yy in (-2.2, 0.75, 2.2):
            ibeam_bm(bm, (xt, yy, ZD - 0.1), (xt + sd * r.uniform(0.8, 2.0), yy + r.uniform(-0.8, 0.8), ZD - r.uniform(3.0, 5.0)), 0.3, 0.16)
        for yy in (-1.8, 1.2):
            pa, pb, pc = V((xt - sd * 0.8, yy, ZD)), V((xt, yy + 0.3, ZD - 0.1)), V((xt + sd * 0.5, yy + 0.6, ZD - 1.6))
            for dy in (0,):
                q = [bm.verts.new(p + V((0, dy + o_, 0))) for p in (pa, pb, pc) for o_ in (-0.7, 0.7)]
                bm.faces.new((q[0], q[2], q[3], q[1]))
                bm.faces.new((q[2], q[4], q[5], q[3]))
        part(bm, 'steel_painted', name='wreck_torn%d' % half, tint=(0.4, 0.38, 0.35), grime=0.9, bisect=False)
        piv = (x0 + 0.3, 0, ZD - 0.45) if half == 0 else (x1 - 0.3, 0, ZD - 0.45)
        ang = math.atan2(ZD - (WATER - 2.0), SPAN / 2) * (1 if half == 0 else -1) * 0.95
        R = Matrix.Rotation(ang, 4, 'Y') @ Matrix.Rotation(math.radians(r.uniform(5, 9) * (1 if half else -1)), 4, 'X')
        t_of = (lambda x, a0=x0 + 0.3: (x - a0) / (xm - a0)) if half == 0 else (lambda x, a1=x1 - 0.3: (a1 - x) / (a1 - xm))
        wreck(C.A.parts[n0:], (piv, R), t_of, math.radians(14 if half else -18), 1.2 if half else -0.9, 0.5, 3 + half)
    F.debris_pile(xm, 0.5, 5.0, TW / 2 + 2.5, BED + 0.5, WATER + 0.9, mids=('granite', 'ashlar_pier'), n=70,
                  name='wreck_debris', slabs=2, slab_mid='setts', steel=7, bonded=0, setts=20,
                  lobes=[(xm - 2.6, -0.4, 0.85), (xm + 2.4, 0.9, 0.75), (xm + 0.3, 3.2, 0.55)])
# ---- piers: dark ashlar shaft + pointed/round cutwaters, granite starling, moulded cap cornice, waterline
for i, px in enumerate(piers):
    bm = bmesh.new()
    C.prism_bm(bm, BL.pier_outline(px, PW, TW + 1.6, PW * 1.0), BED, ZSEAT - 0.45)
    part(bm, 'ashlar_pier', name='pier%d' % i)
    bm = bmesh.new()
    C.prism_bm(bm, BL.pier_outline(px, PW + 0.5, TW + 2.1, PW * 1.15), BED, WATER + 0.4)
    part(bm, 'granite_dark', name='pier%d_starling' % i)
    bm = bmesh.new()                                         # cornice: bed mould + projecting cap
    C.prism_bm(bm, BL.pier_outline(px, PW + 0.22, TW + 1.82, PW * 1.06), ZSEAT - 0.45, ZSEAT - 0.3)
    C.prism_bm(bm, BL.pier_outline(px, PW + 0.5, TW + 2.1, PW * 1.12), ZSEAT - 0.3, ZSEAT)
    part(bm, 'granite', name='pier%d_cap' % i)
    for s in (-1, 1):
        for bx in (px - 0.9, px + 0.9):
            W.decal('streak_rust', (px + (bx - px) * 0.9, s * (TW / 2 + 0.82), ZSEAT - 1.3), (0, s, 0), 0.6, 1.8, alpha=0.6)
    F.riprap_ring(BL.pier_outline(px, PW + 0.5, TW + 2.1, PW * 1.15), WATER, n=12, smin=0.45, smax=0.85, name='riprap%d' % i, mid='granite')
    BL.water_obstacle(BL.pier_outline(px, PW + 0.5, TW + 2.1, PW * 1.15), 'pier', 0.8)
    C.anchor('charge_%s' % 'AB'[i], (px, -TW / 2 - 1.2, ZSEAT - 0.6), kind='charge_marker')
    BL.iron_ladder(px + PW / 2, -TW / 2 + 1.0, WATER + 0.3, ZSEAT, (1, 0, 0), top_pos=(px + PW / 2 + 0.3, -TW / 2 - 0.6, ZD))
    if destroyed:
        W.bite((px + (PW / 2 if i == 0 else -PW / 2), -TW / 2 - 0.6, ZSEAT - 0.3), 1.3, squash=(1.2, 1, 0.8), seed=int(px))
BL.gauge_board(piers[0] - PW * 0.2, -TW / 2 - 0.8 - 0.02, WATER, (0, -1, 0))
C.anchor('charge_C', (0, 0, ZD - 0.5), kind='charge_marker')
# ---- abutments (bridge seat + back wall), approach ramps with retaining walls
RW = TW + 3.2
for side in (-1, 1):
    xe = side * L / 2
    abutment(xe, side, RW - 1.2, ZSEAT - 0.12, BED, depth=4.0, mid='ashlar_pier', coping='granite', wings=False)
    bm = bmesh.new()
    box_bm(bm, (xe + side * 2.45, 0, (ZSEAT + ZD - 0.2) / 2), (3.1, RW - 1.2, ZD - 0.2 - ZSEAT))
    part(bm, 'ashlar_pier', name='backwall%d' % side)
    BL.slab_road(min(xe + side * 0.9, xe + side * 4), max(xe + side * 0.9, xe + side * 4), ZD, TW - 0.9, mid='setts', walk=TW / 2 + 0.85,
                 name='abut_road%d' % side)
    xr0, xr1 = xe + side * 4, xe + side * 16             # ramp: ZD -> 0.05
    bm = bmesh.new()
    zf = lambda x: ZD + (0.05 - ZD) * (x - xr0) / (xr1 - xr0)
    ys = (-(TW - 0.9) / 2, (TW - 0.9) / 2)
    q = [bm.verts.new((x, y, zf(x))) for x in (xr0, xr1) for y in ys]
    bm.faces.new((q[0], q[2], q[3], q[1]) if side > 0 else (q[0], q[1], q[3], q[2]))
    part(bm, 'setts', name='ramp%d' % side, grime=0.4, bisect=False, lod='keep')
    bm = bmesh.new()
    for s in (-1, 1):
        yw = s * (RW / 2 - 0.35)
        p8 = [V((xr0, yw - 0.35, -2.0)), V((xr1, yw - 0.35, -2.0)), V((xr1, yw + 0.35, -2.0)), V((xr0, yw + 0.35, -2.0))]
        p8 += [V((xr0, yw - 0.35, ZD + 0.9)), V((xr1, yw - 0.35, 0.95)), V((xr1, yw + 0.35, 0.95)), V((xr0, yw + 0.35, ZD + 0.9))]
        C.hexa_bm(bm, p8)
        fw = bmesh.new()
        box_bm(fw, ((xr0 + xr1) / 2, s * (TW / 2 + 0.55), (zf(xr0) + zf(xr1)) / 2 + 0.05), (abs(xr1 - xr0), 1.3, 0.1))
        part(fw, 'gravel', name='rampwalk', bisect=False, grime=0.3)
        C.footprint([(xr0, yw - 0.35), (xr1, yw - 0.35), (xr1, yw + 0.35), (xr0, yw + 0.35)], 'LOW', 'parapet')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, 'fieldstone_grey', name='ramp_walls%d' % side)
    for s in (-1, 1):
        bm = bmesh.new()
        n = 6
        for i in range(n):
            xa, xb = xr0 + (xr1 - xr0) * i / n, xr0 + (xr1 - xr0) * (i + 1) / n
            za, zb = ZD + 0.9 + (0.95 - ZD - 0.9) * i / n, ZD + 0.9 + (0.95 - ZD - 0.9) * (i + 1) / n
            beam_bm(bm, (xa, s * (RW / 2 - 0.35), za + 0.07), (xb, s * (RW / 2 - 0.35), zb + 0.07), 0.8, 0.14)
        part(bm, 'granite', name='ramp_coping')
        W.decal('lichen', (xe + side * 8, s * (RW / 2 + 0.01), -0.6), (0, s, 0), 4.0, 1.5, alpha=0.5)
    BL.water_obstacle([(xe, -RW / 2), (xe + side * 1.2, -RW / 2), (xe + side * 1.2, RW / 2), (xe, RW / 2)], 'abutment', 0.5, block=None)
    F.retaining_wings(K.Deck(-L / 2 - 16, L / 2 + 16, ZD, 0.0), xe, side, RW - 1.2, BED, WATER, 4.5, 'ashlar_pier', 'granite', 'granite', 0.9, steps=2)
# ---- footway lattice railings + lamps along the deck
for s in (-1, 1):
    yr = s * (TW / 2 + 1.5)
    for k, (x0, x1, he, hm) in enumerate(spans):
        if destroyed and k == 1:
            continue
        F.period_railing((x0 + 0.3, yr, ZD + 0.1), (x1 - 0.3, yr, ZD + 0.1), 1.05, 2.25, 'steel_painted', GREY, name='rail',
                         style='flat', post=0.08)
    for j, x in enumerate(piers):
        if (j == 0) == (s < 0):
            lamp_post((x + s * 1.2, yr - s * 0.25, ZD + 0.1), 4.4, name='lamp')
K.bridge_meta(K.Deck(-L / 2 - 16, L / 2 + 16, ZD, 0.0), -L / 2 - 16, L / 2 + 16, TW - 0.9 + 2.6, WATER, L,
              {'spans': [list(sp) for sp in spans], 'piers': piers, 'kind': 'steel_truss', 'destructible': True,
               'ramps': [[-L / 2 - 16, -L / 2 - 4], [L / 2 + 4, L / 2 + 16]], 'deck_z': ZD})
if destroyed:
    gap = [spans[1][0], spans[1][1]]
    BL.bmeta().update({'destroyed': True, 'gap_x': gap})
    fp = C.A.meta['footprints']
    C.A.meta['footprints'] = [f for f in fp if f.get('kind') != 'bridge_deck']
    for xa, xb in ((-L / 2 - 16, gap[0]), (gap[1], L / 2 + 16)):
        C.footprint([(xa, -TW / 2 - 1.3), (xb, -TW / 2 - 1.3), (xb, TW / 2 + 1.3), (xa, TW / 2 + 1.3)], 'NONE', 'bridge_deck')
    C.footprint([(gap[0], -TW / 2), (gap[1], -TW / 2), (gap[1], TW / 2), (gap[0], TW / 2)], 'HIGH', 'bridge_gap')
BL.prune_empty()
F.weather(theme='temperate', deck=K.Deck(-L / 2 - 16, L / 2 + 16, ZD, 0.0), step=3.6, lichen=0.4, moss=0.5,
          soot=((0, 0, ZD - 1.0), 16.0, 1) if destroyed else None)
F.weather(mids=('steel_painted',), theme='temperate', step=99, lichen=0.0, moss=0.2, base=0.95,
          soot=((0, 0, ZD - 1.0), 14.0, 1) if destroyed else None, skip=('decal', 'sign'))
F2.cull_decals()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
