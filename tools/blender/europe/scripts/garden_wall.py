"""Garden / farmyard boundary walls with gates (France, Belgium), modular 12 m runs along X (front faces -Y):
 a = 2.1 m rubble wall with ashlar coping, stone piers with pyramid caps, timber double cart-gate (interactable), buttresses
 b = 0.9 m brick dwarf wall + cast-iron railings, brick piers with stone caps + ball finials, wrought-iron double gate
 c = 1.8 m limewashed stone wall with a small arched wicket door (plank, interactable), a collapsed / shell-breached
     section with rubble, ivy/moss (half-ruined)
Walls register HIGH (a, c) or FENCE (b) footprints with a gap at the gate, and climbable top edges.
usage: blender -b --python garden_wall.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, finish, iron_fence, ridge_tiles
import eu_dmg, random

OUT, VAR, SEED = args('garden_wall_a')
K.begin('garden_wall_' + VAR, SEED, theater='temperate')
r = K.rng()
L, T = 12.0, 0.5
CFG = {'a': dict(h=2.1, mid='rubble_stone', cope='plaster_rough', gw=3.2, gx=1.5),
       'b': dict(h=0.9, mid='brick_red', cope='ashlar_limestone', gw=2.4, gx=-1.0),
       'c': dict(h=1.8, mid='plaster_limewash', cope='fieldstone', gw=0.95, gx=2.6)}[VAR]
H, GW, GX = CFG['h'], CFG['gw'], CFG['gx']
x0, x1 = -L / 2, L / 2
pier = 0.7 if VAR != 'c' else 0.0
rq = random.Random(SEED)


def mortar_cap(xa, xb, z, t, mid='plaster_rough', tint=(0.78, 0.76, 0.7), name='mortar_cap'):
    """Rounded lime-mortar cap (chaperon) with a drip overhang on both faces."""
    prof = [(-t / 2 - 0.05, -0.02), (-t / 2 - 0.05, 0.03), (-t * 0.35, 0.12), (0, 0.18), (t * 0.35, 0.12), (t / 2 + 0.05, 0.03), (t / 2 + 0.05, -0.02)]
    bm = K.bm_new()
    rings = []
    n = max(2, int((xb - xa) / 1.5))
    for i in range(n + 1):
        x = xa + (xb - xa) * i / n
        w = rq.uniform(-0.02, 0.02)
        rings.append([V((x, py, z + pz + (w if 0 < i < n else 0))) for py, pz in prof])
    K.loft_bm(bm, rings)
    import bmesh as _b
    _b.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, mat_tint=tint, grime=1.0)


def weeds(xa, xb, y, z=0.0, n=10, name='weeds', tint=(1.0, 1.0, 1.0)):
    """Grass / weed / fern clumps along a wall foot or wall top: alpha cross-cards from the shared foliage atlas
    (leafy green-grey clumps instead of solid dark spikes)."""
    import eu_common as EC
    sp = [(rq.uniform(xa, xb), y + rq.uniform(-0.08, 0.08), z, rq.uniform(0.22, 0.42) if z < 0.5 else rq.uniform(0.16, 0.3))
          for _ in range(max(1, int(n * 0.8)))]
    return EC.foliage(sp, cell=(1, 1, 2, 3) if z < 0.5 else (1, 1, 3), name=name, tint=tint, lod='drop', seed=int(rq.random() * 1e6))


def wall_run(xa, xb, name, tint=None):
    bm = bmesh.new()
    K.box_bm(bm, ((xa + xb) / 2, 0, H / 2), (xb - xa, T, H))
    K.part(bm, CFG['mid'], name=name, mat_tint=tint)
    # coping: rounded lime-mortar cap with moss + weeds (a) / flat stone (b)
    if VAR == 'b':
        bm = bmesh.new()
        K.box_bm(bm, ((xa + xb) / 2, 0, H + 0.06), (xb - xa, T + 0.12, 0.12))
        K.part(bm, CFG['cope'], name=name + '_cope')
    else:
        mortar_cap(xa, xb, H, T, name=name + '_cope')
        weeds(xa + 0.2, xb - 0.2, 0.0, H + 0.12, int((xb - xa) * 0.8), name=name + '_topweeds', tint=(0.95, 0.95, 0.85))
        for k in range(int((xb - xa) / 2.5)):
            K.decal('moss_patch', ((xa + 0.5) + rq.random() * (xb - xa - 1), -T / 2 - 0.01, H - 0.25), (0, -1, 0), rq.uniform(0.8, 1.6), 0.5, alpha=0.55)
    # ground contact: splash-back dirt, moss at the foot, weeds both sides
    weeds(xa + 0.1, xb - 0.1, -T / 2 - 0.12, 0.0, int((xb - xa) * 1.1), name=name + '_weeds_f')
    weeds(xa + 0.1, xb - 0.1, T / 2 + 0.12, 0.0, int((xb - xa) * 0.9), name=name + '_weeds_b')


if VAR == 'c':
    # arched wicket door in the wall itself + a breached section
    poly = [(x0, -T / 2), (x1, -T / 2), (x1, T / 2), (x0, T / 2)]
    wd = K.opening(poly, 0, GX + L / 2, GW, 1.75, 0.0, T, 'arch', 'door')
    bm = bmesh.new()
    K.box_bm(bm, (0, 0, H / 2), (L, T, H))
    bm = K.boolean_cut(bm, [wd])
    K.part(bm, CFG['mid'], name='wall', mat_tint=(0.95, 0.92, 0.85))
    # coping: mortar bed + half-round clay tiles (tuiles canal) with mortared joints
    mortar_cap(x0, x1, H, T, tint=(0.8, 0.78, 0.72), name='wall_bed')
    ridge_tiles((x0, 0, H + 0.1), (x1, 0, H + 0.1), mid='roof_terracotta', tint=(0.82, 0.62, 0.5), r=0.17, seg=0.45, finials=False,
                name='wall_tiles')
    K.door(wd, 'wicket', 'plank', (0.30, 0.36, 0.30), step='fieldstone', lintel=None)
    K.jamb_blocks(wd, 'ashlar_limestone', name='wicket_jambs')                  # dressed surround + arch voussoirs
    K.voussoirs(wd, 'ashlar_limestone', name='wicket_arch')
    bm = bmesh.new()                                                           # little tiled hood over the wicket
    hx, hz, hw = wd.o.x, wd.o.z + wd.h + 0.35, wd.w / 2 + 0.35
    for s_ in (-1, 1):
        K.hexa_bm(bm, [(hx - hw, -T / 2 - 0.45, hz), (hx + hw, -T / 2 - 0.45, hz), (hx + hw, 0, hz + 0.4), (hx - hw, 0, hz + 0.4),
                       (hx - hw, -T / 2 - 0.45, hz + 0.05), (hx + hw, -T / 2 - 0.45, hz + 0.05), (hx + hw, 0, hz + 0.45), (hx - hw, 0, hz + 0.45)]
                  if s_ < 0 else [(hx - hw, 0, hz + 0.4), (hx + hw, 0, hz + 0.4), (hx + hw, T / 2 + 0.3, hz + 0.1), (hx - hw, T / 2 + 0.3, hz + 0.1),
                                  (hx - hw, 0, hz + 0.45), (hx + hw, 0, hz + 0.45), (hx + hw, T / 2 + 0.3, hz + 0.15), (hx - hw, T / 2 + 0.3, hz + 0.15)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'roof_terracotta', name='wicket_hood', mat_tint=(0.85, 0.66, 0.55))
    # shell breach: stepped break along the courses, loose stones on the ledges, a real rubble heap
    eu_dmg.blast((-2.8, 0, 1.4), 1.5, 0.0, (1.25, 1.3, 1.25), SEED, mids=('fieldstone',), course=0.26)
    eu_dmg.heap((-2.8, -0.95, 0), 1.7, 0.7, stone='fieldstone', dress=None, tiles='roof_terracotta', timber='timber_grey', seed=SEED,
                name='breach', n=22, beams=1, planks=1, footprint=False, elong=1.2)
    weeds(x0 + 0.2, x1 - 0.2, -T / 2 - 0.12, 0.0, 12, name='weeds_f')
    weeds(x0 + 0.2, x1 - 0.2, T / 2 + 0.12, 0.0, 10, name='weeds_b')
    for k in range(4):
        K.decal('moss_patch', (r.uniform(x0 + 0.5, x1 - 0.5), -T / 2 - 0.01, 0.35), (0, -1, 0), r.uniform(1.0, 1.8), 0.6)
        K.decal('lichen', (r.uniform(x0 + 0.5, x1 - 0.5), T / 2 + 0.01, r.uniform(0.6, 1.4)), (0, 1, 0), 1.0, 0.9, alpha=0.6)
    K.decal('streak_long', (GX + 0.9, -T / 2 - 0.01, 1.0), (0, -1, 0), 0.6, 1.6, alpha=0.5)
    K.footprint([(x0, -T / 2), (-4.3, -T / 2), (-4.3, T / 2), (x0, T / 2)], 'HIGH', 'wall')
    K.footprint([(-1.3, -T / 2), (GX - GW / 2, -T / 2), (GX - GW / 2, T / 2), (-1.3, T / 2)], 'HIGH', 'wall')
    K.footprint([(GX + GW / 2, -T / 2), (x1, -T / 2), (x1, T / 2), (GX + GW / 2, T / 2)], 'HIGH', 'wall')
    K.footprint([(-4.3, -T / 2 - 0.3), (-1.3, -T / 2 - 0.3), (-1.3, T / 2 + 0.3), (-4.3, T / 2 + 0.3)], 'LOW', 'breach')
    K.climb_meta((x0, 0), (-4.3, 0), H + 0.2)
    K.climb_meta((-1.3, 0), (x1, 0), H + 0.2)
else:
    ga, gb = GX - GW / 2 - pier / 2, GX + GW / 2 + pier / 2          # pier centres
    wall_run(x0, ga - pier / 2, 'wall_l')
    wall_run(gb + pier / 2, x1, 'wall_r')
    ph = H + (0.5 if VAR == 'a' else 0.9)
    for k, px in enumerate((ga, gb, x0 + 0.2, x1 - 0.2) if VAR == 'b' else (ga, gb)):
        pm = CFG['mid'] if VAR == 'b' else 'ashlar'
        pw = pier if k < 2 else 0.5
        K.P(pm, K.box_bm, (px, 0, ph / 2), (pw, pw, ph), name='pier%d' % k)
        K.P(CFG['cope'], K.box_bm, (px, 0, ph + 0.07), (pw + 0.14, pw + 0.14, 0.14), name='pcap%d' % k)
        if VAR == 'a':
            K.P(CFG['cope'], K.box_bm, (px, 0, ph + 0.3), (pw, pw, 0.34), taper=(0.1, 0.1), name='ppyr%d' % k)
        else:
            K.P(CFG['cope'], K.cyl_bm, (px, 0, ph + 0.14), (px, 0, ph + 0.5), 0.17, 10, r1=0.06, smooth=True, name='pball%d' % k)
    if VAR == 'a':
        for bx in (x0 + 1.2, x1 - 1.4, x1 - 3.8):                    # raking buttresses on the back face
            if abs(bx - GX) > GW:
                bm = bmesh.new()
                K.hexa_bm(bm, [(bx - 0.25, T / 2, 0), (bx + 0.25, T / 2, 0), (bx + 0.25, T / 2 + 0.8, 0), (bx - 0.25, T / 2 + 0.8, 0),
                               (bx - 0.25, T / 2, H - 0.2), (bx + 0.25, T / 2, H - 0.2), (bx + 0.25, T / 2 + 0.12, H - 0.35), (bx - 0.25, T / 2 + 0.12, H - 0.35)])
                K.part(bm, 'fieldstone', name='buttress')
        # timber double cart-gate: plank leaves on a braced frame (Z-brace), strap hinges
        for s in (-1, 1):
            hp = V((GX + s * GW / 2, -0.05, 0.05))
            d = V((-s, 0, 0))
            lw = GW / 2 - 0.02
            bm = bmesh.new()
            n = int(lw / 0.16)
            for k in range(n):
                p = hp + d * (0.08 + k * (lw - 0.1) / (n - 1))
                K.box_bm(bm, tuple(p + V((0, 0, 1.0))), (0.15, 0.05, 1.95 + 0.08 * math.sin(k)))
            for z in (0.35, 1.65):
                K.box_bm(bm, tuple(hp + d * lw / 2 + V((0, -0.05, z))), (lw, 0.05, 0.16))
            K.beam_bm(bm, hp + d * 0.1 + V((0, -0.05, 0.4)), hp + d * (lw - 0.1) + V((0, -0.05, 1.6)), 0.14, 0.05, up=V((0, 1, 0)))
            ob = K.part(bm, 'door_planks', name='gate_leaf%d' % s, node='gate%d' % s, mat_tint=(0.55, 0.47, 0.38), uv='beam', axis=(0, 0, 1))
            ob['kit_pivot'] = list(hp)
            bm = bmesh.new()
            for z in (0.35, 1.65):
                K.box_bm(bm, tuple(hp + d * lw * 0.3 + V((0, -0.085, z))), (lw * 0.6, 0.012, 0.05))
            ob = K.part(bm, 'cast_iron', name='gate_iron%d' % s, node='gate%d' % s)
            ob['kit_pivot'] = list(hp)
        K.door_meta('gate', (GX, -T / 2, 0), (0, -1, 0), GW, 2.0, kind='gate', node='gate-1')
        blk = 'HIGH'
    else:
        # railings on the dwarf wall + wrought-iron double gate with scroll top
        iron_fence((x0 + 0.45, 0), (ga - pier / 2 - 0.05, 0), H + 0.12, 1.2, 0.15, name='rail_l')
        iron_fence((gb + pier / 2 + 0.05, 0), (x1 - 0.45, 0), H + 0.12, 1.2, 0.15, name='rail_r')
        for s in (-1, 1):
            hp = V((GX + s * GW / 2, 0, 0.05))
            d = V((-s, 0, 0))
            lw = GW / 2 - 0.02
            bm = bmesh.new()
            for z in (0.12, 0.9, 1.75):
                K.beam_bm(bm, hp + V((0, 0, z)), hp + d * lw + V((0, 0, z)), 0.035, 0.03)
            n = int(lw / 0.12)
            for k in range(n + 1):
                p = hp + d * (0.02 + k * (lw - 0.04) / n)
                tz = 1.85 + 0.35 * math.sin(math.pi * (k / n if s < 0 else 1 - k / n) * 0.5)
                K.beam_bm(bm, p + V((0, 0, 0.08)), p + V((0, 0, tz)), 0.02, 0.02)
                K.cyl_bm(bm, p + V((0, 0, tz)), p + V((0, 0, tz + 0.1)), 0.028, 4, r1=0.0)
            for k in range(3):                                              # scroll rings in the frieze
                c = hp + d * (lw * (k + 0.5) / 3) + V((0, 0, 1.32))
                ring = [c + V((math.cos(a) * 0.17, 0, math.sin(a) * 0.17)) for a in [2 * math.pi * j / 10 for j in range(11)]]
                for a_, b_ in zip(ring[:-1], ring[1:]):
                    K.beam_bm(bm, a_, b_, 0.018, 0.018, up=V((0, 1, 0)))
            ob = K.part(bm, 'cast_iron', name='gate_leaf%d' % s, node='gate%d' % s, grime=0.2)
            ob['kit_pivot'] = list(hp)
        K.door_meta('gate', (GX, -T / 2, 0), (0, -1, 0), GW, 2.0, kind='gate', node='gate-1')
        blk = 'FENCE'
    K.footprint([(x0, -T / 2), (ga + pier / 2, -T / 2), (ga + pier / 2, T / 2), (x0, T / 2)], blk, 'wall')
    K.footprint([(gb - pier / 2, -T / 2), (x1, -T / 2), (x1, T / 2), (gb - pier / 2, T / 2)], blk, 'wall')
    if VAR == 'a':
        K.climb_meta((x0, 0), (ga - pier / 2, 0), H + 0.22)
        K.climb_meta((gb + pier / 2, 0), (x1, 0), H + 0.22)
    for k in range(3):
        pass
        if VAR == 'a':
            K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), T / 2 + 0.01, 0.35), (0, 1, 0), 1.6, 0.6)
finish(OUT, ao_res=512, ao_samples=48)
