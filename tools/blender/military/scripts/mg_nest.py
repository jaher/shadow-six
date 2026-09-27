"""MG nest emplacement (Feldstellung): double ring of stretcher-bonded sandbags open at the rear, timber revetment
(posts + planks) lining the inside, firing step, overhead log-and-sandbag cover over the rear half, MG 34 on a
Lafette tripod, ammo boxes, jerrycan, spent-casing patch. Variants: a (temperate), snow, desert (sand-tint bags,
no roof, stone-filled), destroyed (blown ring, bags scattered, MG toppled, scorch).
Usage: blender -b --factory-startup --python mg_nest.py -- [a|snow|desert|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 41)
theater = {'snow': 'snow', 'desert': 'desert'}.get(VAR, 'temperate')
K.begin('mg_nest' + ('' if VAR == 'a' else '_' + VAR), SEED, theater=theater, snow=VAR == 'snow')
r = K.rng()
DEAD = VAR == 'destroyed'
BAGT = {'desert': (1.0, 0.95, 0.84), 'snow': (0.84, 0.84, 0.8)}.get(VAR, None)
WOOD = 'timber_beam' if VAR != 'snow' else 'timber_tarred'
RIN = 1.55                              # inner radius of the ring
GAP = math.radians(90)                  # rear opening faces north (+Y)
GAPW = 1.1


def blown(p, k):
    """destroyed: a breach on the south-west + randomly missing top bags"""
    if not DEAD:
        return False
    a = math.atan2(p.y, p.x)
    da = abs(math.atan2(math.sin(a - math.radians(-120)), math.cos(a - math.radians(-120))))
    return (da < 0.55 and k >= 1) or (k >= 3 and r.random() < 0.45)


# ------------------------------------------------------------------ sandbag rings (built bag by bag; top course separate for snow)
bm = bmesh.new()
btop = bmesh.new()
for ring, courses in ((0, 5), (1, 4)):
    rad = RIN + 0.18 + ring * 0.33
    for k in range(courses):
        rr = rad - k * 0.03
        n = max(6, int(2 * math.pi * rr / 0.56))
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * ((k + ring) % 2)) / n
            da = math.atan2(math.sin(a - GAP), math.cos(a - GAP))
            if abs(da) * rr < GAPW / 2 + ring * 0.35:
                continue
            p = V((math.cos(a) * rr, math.sin(a) * rr, k * 0.138))
            if blown(p, k):
                continue
            M.bag_bm(btop if k == courses - 1 else bm, p + V((r.uniform(-0.035, 0.035), r.uniform(-0.035, 0.035), r.uniform(-0.012, 0.01))), a + math.pi / 2 + r.uniform(-0.07, 0.07),
                     0.58, 0.31, 0.15, r, r.uniform(-0.05, 0.05))
# ends of the rear opening: headers (bags laid across)
for s in (-1, 1):
    a = GAP + s * (GAPW / 2 + 0.25) / (RIN + 0.35)
    for k in range(4):
        p = V((math.cos(a) * (RIN + 0.35), math.sin(a) * (RIN + 0.35), k * 0.138))
        M.bag_bm(bm, p, a + r.uniform(-0.05, 0.05), 0.58, 0.31, 0.15, r)
if DEAD:                                 # bags thrown out of the breach
    for i in range(16):
        a = math.radians(-120) + r.uniform(-0.6, 0.6)
        d = r.uniform(2.3, 4.2)
        M.bag_bm(bm, (math.cos(a) * d, math.sin(a) * d, -0.035), r.uniform(0, 3.14), 0.58, 0.31, 0.12, r, r.uniform(-0.12, 0.12))
    from mathutils import noise as NZ
    sp = bmesh.new()                     # rework 2: burst bags = emptied, flattened sacks (burlap, same part as the bags)
    for i in range(5):                   # at the head of soft, lobed, sand-textured spill mounds fanning away from them
        a = math.radians(-120) + r.uniform(-0.5, 0.5)
        d = r.uniform(2.0, 3.2)
        c = V((math.cos(a) * d, math.sin(a) * d, -0.03))
        u = V((math.cos(a), math.sin(a), 0))
        M.bag_bm(bm, c - u * 0.62 + V((0, 0, 0.0)), a + math.pi / 2 + r.uniform(-0.5, 0.5), 0.66, 0.4, 0.07, r, r.uniform(-0.2, 0.2))
        R0, hh, sd = r.uniform(0.4, 0.62), r.uniform(0.2, 0.3), r.uniform(0, 40)
        K.decal('dirt_splash', (c.x + u.x * 0.3, c.y + u.y * 0.3, 0.012), (0, 0, 1), R0 * 3.2, R0 * 2.4, up=(u.x, u.y, 0), alpha=0.55)
        top = sp.verts.new(c + u * 0.1 + V((0, 0, hh)))
        prev = None
        for k in range(1, 5):
            t = k / 4
            ring = []
            for j in range(16):
                th = 2 * math.pi * j / 16
                el = 1.0 + 0.35 * max(0.0, math.cos(th - a))        # fan stretched away from the burst bag
                rr = R0 * t * el * (1 + 0.25 * NZ.noise(V((math.cos(th) * 1.5 + sd, math.sin(th) * 1.5, t))))
                z = hh * (1 - t * t) ** 1.6 - 0.03 * t
                ring.append(sp.verts.new(c + V((math.cos(th) * rr, math.sin(th) * rr, z))))
            for j in range(16):
                jj = (j + 1) % 16
                sp.faces.new((top, ring[j], ring[jj]) if prev is None else (prev[j], ring[j], ring[jj], prev[jj]))
            prev = ring
    for f in sp.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(sp, 'sand', name='spill', mat_tint=(0.74, 0.67, 0.52) if VAR != 'desert' else (1.0, 0.95, 0.85), grime=0.25, smooth=True,
           bisect=False, uv_scale=0.6)
M.sandbags_part(bm, 'sandbags', BAGT, keep=True)
top_bags = M.sandbags_part(btop, 'sandbags_top', BAGT)

# ------------------------------------------------------------------ timber revetment inside + firing step
bm = bmesh.new()
posts = []
NP = 14
for i in range(NP):
    a = 2 * math.pi * i / NP
    da = math.atan2(math.sin(a - GAP), math.cos(a - GAP))
    if abs(da) * RIN < GAPW / 2 + 0.1:
        continue
    posts.append(a)
    h = 0.78 + r.uniform(-0.04, 0.05)
    if DEAD and abs(math.atan2(math.sin(a + 2.1), math.cos(a + 2.1))) < 0.6:
        h = r.uniform(0.2, 0.4)
    c = V((math.cos(a) * (RIN + 0.02), math.sin(a) * (RIN + 0.02), 0))
    K.cyl_bm(bm, c - V((0, 0, 0.05)), c + V((0, 0, h)), 0.06, 6)
K.part(bm, WOOD, name='revet_posts', uv='beam', axis=(0, 0, 1), smooth=True)
bm = bmesh.new()                         # horizontal planks between posts
for a0, a1 in zip(posts[:-1], posts[1:]):
    if a1 - a0 > 2 * math.pi / NP * 1.5:
        continue
    for k in range(4):
        z = 0.1 + k * 0.17
        if DEAD and abs(math.atan2(math.sin(a0 + 2.1), math.cos(a0 + 2.1))) < 0.7 and k > 0:
            continue
        p0 = V((math.cos(a0) * (RIN + 0.07), math.sin(a0) * (RIN + 0.07), z))
        p1 = V((math.cos(a1) * (RIN + 0.07), math.sin(a1) * (RIN + 0.07), z + r.uniform(-0.01, 0.01)))
        K.beam_bm(bm, p0, p1, 0.035, 0.16, up=(0, 0, 1))
K.part(bm, 'timber_siding', name='revet_planks', uv='beam', axis=(1, 0, 0))
bm = bmesh.new()                         # firing step (plank bench) along the front arc
for i in range(5):
    a = math.radians(-90 - 50 + i * 25)
    c = V((math.cos(a) * (RIN - 0.3), math.sin(a) * (RIN - 0.3), 0.18))
    K.box_bm(bm, tuple(c), (0.5, 0.36, 0.06), a + math.pi / 2)
    K.box_bm(bm, tuple(c - V((0, 0, 0.1))), (0.08, 0.08, 0.16), a)
K.part(bm, 'deck_planks', name='firing_step', uv='beam', axis=(1, 0, 0))

# ------------------------------------------------------------------ overhead cover (rear half): logs on stringers + bags on top
if VAR not in ('desert', 'destroyed'):
    bm = bmesh.new()
    zc = 1.05
    for x in (-1.2, 1.2):
        K.cyl_bm(bm, (x, 0.1, -0.02), (x, 0.1, zc - 0.12), 0.08, 6)
        K.cyl_bm(bm, (x, 0.1, zc - 0.1), (x, RIN + 0.6, zc - 0.1), 0.09, 6)
    for i in range(10):
        y = 0.2 + i * 0.16
        K.cyl_bm(bm, (-1.7 + r.uniform(-0.05, 0.05), y, zc), (1.7 + r.uniform(-0.05, 0.05), y, zc + r.uniform(-0.02, 0.02)), 0.08, 6)
    K.part(bm, WOOD, name='roof_logs', uv='beam', axis=(1, 0, 0), smooth=True)
    bm = bmesh.new()
    for row in range(3):
        for i in range(5):
            x = -1.2 + i * 0.6 + (0.3 if row % 2 else 0)
            if x > 1.4:
                continue
            M.bag_bm(bm, (x, 0.45 + row * 0.42, zc + 0.08), 0.0 + r.uniform(-0.06, 0.06), 0.58, 0.31, 0.14, r)
    for i in range(4):
        M.bag_bm(bm, (-0.9 + i * 0.6, 0.66, zc + 0.21), r.uniform(-0.06, 0.06), 0.58, 0.31, 0.14, r)
    M.sandbags_part(bm, 'roof_bags', BAGT)
    K.roof_meta([(-1.7, 0.1), (1.7, 0.1), (1.7, 1.75), (-1.7, 1.75)], zc + 0.2, walkable=False, kind='mg_cover')
elif VAR == 'desert':                    # desert: stones piled at the foot, camouflage netting poles
    bm = bmesh.new()
    for i in range(26):
        a = r.uniform(0, 2 * math.pi)
        if abs(math.atan2(math.sin(a - GAP), math.cos(a - GAP))) < 0.4:
            continue
        d = RIN + 0.95 + r.uniform(0, 0.3)
        K.box_bm(bm, (math.cos(a) * d, math.sin(a) * d, 0.1), (r.uniform(0.2, 0.4), r.uniform(0.2, 0.35), r.uniform(0.15, 0.25)), r.uniform(0, 3))
    K.part(bm, 'fieldstone', name='stones', tint=(1.1, 1.0, 0.85), bisect=False)

# ------------------------------------------------------------------ weapon + kit
if not DEAD:
    M.mg34((0.0, -RIN + 0.25, 0.78), yaw=0.0, tripod=True)
else:
    bm = bmesh.new()                     # MG 34 knocked over on its side
    K.cyl_bm(bm, (-0.5, -0.4, 0.05), (0.5, -0.9, 0.08), 0.03, 6)
    K.beam_bm(bm, (-0.5, -0.4, 0.06), (-0.85, -0.25, 0.08), 0.045, 0.1)
    for d in ((0.3, 0.5), (-0.4, 0.4), (0.5, -0.3)):
        K.beam_bm(bm, (0, -0.5, 0.05), (d[0], -0.5 + d[1], 0.03), 0.03, 0.03)
    K.part(bm, 'cast_iron', name='mg_wreck', bisect=False)
bm = bmesh.new()
for i, (x, y) in enumerate(((0.9, 0.2), (1.05, -0.2), (-1.0, -0.1))):
    K.box_bm(bm, (x, y, 0.1 + (0.2 if i == 1 and not DEAD else 0)), (0.3, 0.14, 0.2), r.uniform(-0.3, 0.3))
K.part(bm, 'steel_painted', name='ammo_boxes', mat_tint=(0.75, 0.78, 0.62), bisect=False)
bm = bmesh.new()
K.box_bm(bm, (-0.95, 0.55, 0.24), (0.36, 0.17, 0.48), 0.4)
K.part(bm, 'steel_painted', name='jerrycan', mat_tint=(0.7, 0.75, 0.6), bisect=False)
K.decal('dirt_splash', (0.0, -0.6, 0.02), (0, 0, 1), 2.4, 2.0, up=(0, 1, 0), alpha=0.7)
if DEAD:
    K.decal('soot', (-1.3, -1.6, 0.03), (0, 0, 1), 3.6, 3.6, up=(0, 1, 0), alpha=0.95)
    K.decal('soot', (0.3, -0.2, 0.03), (0, 0, 1), 2.2, 2.2, up=(0, 1, 0), alpha=0.8)
    K.anchor('fire', (-1.0, -1.0, 0.3), kind='smoulder')

# ------------------------------------------------------------------ metadata: ring segments = LOW cover (crawl behind), gap walkable
NS = 18
for i in range(NS):
    a0, a1 = 2 * math.pi * i / NS, 2 * math.pi * (i + 1) / NS
    am = (a0 + a1) / 2
    if abs(math.atan2(math.sin(am - GAP), math.cos(am - GAP))) * RIN < GAPW / 2:
        continue
    if DEAD and abs(math.atan2(math.sin(am + 2.1), math.cos(am + 2.1))) < 0.5:
        continue
    ri, ro = RIN, RIN + 0.85
    K.footprint([(math.cos(a0) * ri, math.sin(a0) * ri), (math.cos(a0) * ro, math.sin(a0) * ro),
                 (math.cos(a1) * ro, math.sin(a1) * ro), (math.cos(a1) * ri, math.sin(a1) * ri)], 'LOW', 'sandbags')
K.A().meta['ring'] = {'r': RIN + 0.4, 'gap_heading': 'north', 'gap_width': GAPW}
K.anchor('gunner', (0.0, -0.6, 0.0), (0, -1, 0), kind='mg_post', arc=120)
if VAR == 'snow':                        # snow: cushions along the ring tops + on the cover (not per-bag: too many faces)
    import mil as _m
    sn = bmesh.new()
    if VAR not in ('desert', 'destroyed'):          # pillowy snow on the bagged roof: noisy sheet draping over the edges
        from mathutils import noise as NZ
        g = []
        for j in range(9):
            row = []
            for i in range(13):
                x, y = -1.85 + 3.7 * i / 12, 0.05 + 1.8 * j / 8
                edge = min(i, 12 - i, j, 8 - j)
                z = 1.05 + 0.3 + 0.08 * NZ.noise(V((x * 2.1, y * 2.1, 0.4))) + (0.04 if edge > 1 else (-0.08 if edge == 1 else -0.2))
                row.append(sn.verts.new((x, y, z)))
            g.append(row)
        for j in range(8):
            for i in range(12):
                sn.faces.new((g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]))
    for f in sn.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(sn, 'snow', name='snow_caps', grime=0, bisect=False, smooth=True)
    K.snow_pass(thick=0.035, min_nz=0.55, noise=0.8, parts=[o for o in K.A().parts if o.data.materials and o.data.materials[0].get('kit_id') not in ('snow', 'burlap_bag')] + [top_bags])
    inner = [(math.cos(a) * (RIN + 0.75), math.sin(a) * (RIN + 0.75)) for a in [GAP + 0.6 + (2 * math.pi - 1.2) * i / 12 for i in range(13)]]
    outer = [(math.cos(a) * (RIN + 1.7), math.sin(a) * (RIN + 1.7)) for a in [GAP + 0.6 + (2 * math.pi - 1.2) * i / 12 for i in range(13)]]
    M.berm(inner, outer, lambda si, t: 0.28 + 0.12 * math.sin(si * 1.7 + t * 3), 'snow', 'drift', taper_end=0.25, rows=5, step=0.5, undulate=0.3)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
