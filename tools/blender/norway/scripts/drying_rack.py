"""Hjell: stockfish drying rack (Lofoten / Finnmark, cf. hjell at Vadso). Heavy A-frame pole trestles (bukker) dug
into the ground (a few stone cairns weighting the feet), 5 levels of horizontal rails on both faces (4.4 m tall),
ridge rail, diagonal wind braces; dense irregular pairs of tail-tied split cod (torrfisk) hanging over every rail.
Variants: a = 9 m rack, full; b = 6 m rack, half-empty (early season) + slatted fish crates and a salt barrel.
Usage: blender -b --python drying_rack.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('drying_rack')
name = 'drying_rack_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'coast', snow=SNOW)
r = K.rng()
Lr = 9.0 if VAR == 'a' else 6.0
nb = 4 if VAR == 'a' else 3
H = 4.4
LEV = (1.3, 2.05, 2.8, 3.55)
SP = 1.25                                     # half-spread of the A-frame feet
xs = [-Lr / 2 + Lr * i / (nb - 1) for i in range(nb)]


def rail_y(z, s):
    return s * SP * (1 - z / (H + 0.2)) + s * 0.08


bm = K.bm_new()
for x in xs:
    for s in (-1, 1):                          # A-frame: two heavy poles crossing just below the ridge rail
        K.cyl_bm(bm, (x + r.uniform(-0.06, 0.06), s * SP, 0.0), (x, -s * 0.22, H + 0.3), 0.09, 7, r1=0.065)
    K.cyl_bm(bm, (x, -SP * 0.72, 1.0), (x, SP * 0.72, 1.0), 0.05, 6)       # collar ties
    K.cyl_bm(bm, (x, -SP * 0.4, 2.35), (x, SP * 0.4, 2.35), 0.045, 6)
for z in LEV:                                  # rails on both faces
    for s in (-1, 1):
        yy = rail_y(z, s)
        K.cyl_bm(bm, (xs[0] - 0.55, yy, z), (xs[-1] + 0.55, yy, z + r.uniform(-0.03, 0.03)), 0.05, 6)
K.cyl_bm(bm, (xs[0] - 0.6, 0, H), (xs[-1] + 0.6, 0, H), 0.06, 6)            # ridge rail in the crossings
for i in range(nb - 1):                        # wind braces in the ridge plane
    K.cyl_bm(bm, (xs[i], 0.0, 0.1), (xs[i + 1], 0.0, H - 0.2), 0.05, 5)
K.part(bm, 'log_hewn', name='rack', uv='beam', axis=(0, 0, 1), smooth=True, jitter=0.12, mat_tint=(0.66, 0.62, 0.58))
bm = K.bm_new()                                # stone cairns weighting some feet
for x in xs[::2]:
    for s in (-1, 1):
        for k in range(4):
            K.box_bm(bm, (x + r.uniform(-0.25, 0.25), s * SP + r.uniform(-0.25, 0.25), 0.1 + (k // 3) * 0.16),
                     (r.uniform(0.25, 0.4), r.uniform(0.2, 0.35), 0.22), rot_z=r.uniform(0, 3), taper=(0.75, 0.75))
K.part(bm, 'granite', name='cairns', jitter=0.15)


FISH = []                                     # (centre, tone) for per-fish colouring
TONES = [(0.82, 0.72, 0.55), (0.7, 0.6, 0.45), (0.58, 0.5, 0.4), (0.76, 0.72, 0.64), (0.5, 0.43, 0.35),
         (0.86, 0.77, 0.6), (0.64, 0.6, 0.54), (0.72, 0.66, 0.52)]           # pale straw -> grey -> smoky brown


def fish(bm, top, side, ln, twist, head_w, bend=0.0):
    """One split, dried cod hanging head-down from its tail tie: a closed, thin volume (flat flesh side toward the
    rail, rounded skin side outward), forked tail fin flaring at the tie, slim tail stock, broad shoulders, small
    head; slight twist + curl so neighbours catch the light differently."""
    ax = V((math.cos(twist), side * 0.22, 0)).normalized()
    out = V((-ax.y, ax.x, 0)) * side                  # skin side, away from the rail
    down = V((0, side * 0.1, -1)).normalized()
    rings = [(0.0, 0.07, 0.008), (0.17, 0.022, 0.018), (0.62, head_w * 0.52, 0.045), (1.0, 0.035, 0.03)]
    rs = []
    for t, w, th in rings:
        c = V(top) + down * (t * ln) + out * (bend * math.sin(t * math.pi) * ln)
        a2 = (ax * math.cos(twist * t * 0.8) + out * math.sin(twist * t * 0.8) * 0.3).normalized()
        rs.append([bm.verts.new(c - a2 * w), bm.verts.new(c + a2 * w), bm.verts.new(c + out * th)])
    for i in range(len(rs) - 1):
        for j in range(3):
            k = (j + 1) % 3
            bm.faces.new((rs[i][j], rs[i][k], rs[i + 1][k], rs[i + 1][j]))
    bm.faces.new((rs[0][2], rs[0][1], rs[0][0]))
    bm.faces.new((rs[-1][0], rs[-1][1], rs[-1][2]))
    FISH.append((V(top) + down * ln * 0.5, TONES[r.randrange(len(TONES))], r.uniform(0.85, 1.1)))


full, l1, l2 = K.bm_new(), K.bm_new(), K.bm_new()
fill = 0.92 if VAR == 'a' else 0.45
ties = []
for z in LEV:
    for s in (-1, 1):
        yy = rail_y(z, s)
        x = xs[0] - 0.45
        while x < xs[-1] + 0.45:
            x += r.uniform(0.19, 0.3)
            if r.random() > fill or any(abs(x - xx) < 0.14 for xx in xs):
                if r.random() < 0.3:
                    x += r.uniform(0.2, 0.5)              # gaps
                continue
            rq = r.random()
            target = l2 if rq < 0.26 else (l1 if rq < 0.48 else full)
            ties.append((x, yy, z))
            for side in (-1, 1):                         # pair: one fish each side of the rail, tails tied
                ln = r.uniform(0.5, 0.78)
                fish(target, (x, yy + side * 0.05, z + 0.03), side, ln, r.uniform(-0.6, 0.6), r.uniform(0.1, 0.15),
                     bend=r.uniform(-0.08, 0.12))
for bmx in (full, l1, l2):
    import bmesh as _bmesh
    _bmesh.ops.recalc_face_normals(bmx, faces=bmx.faces)
HASH = {}
for fc, tone, k in FISH:
    HASH.setdefault((round(fc.x / 0.4), round(fc.z / 0.4)), []).append((fc, tone, k))


def fish_col(p, n, c):
    best, bd = None, 9.0
    kx, kz = round(p.x / 0.4), round(p.z / 0.4)
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for fc, tone, k in HASH.get((kx + dx, kz + dz), ()):
                d = (fc - p).length_squared
                if d < bd:
                    bd, best = d, (fc, tone, k)
    if not best:
        return None
    fc, tone, k = best
    head = max(0.0, min(1.0, (fc.z - p.z) / 0.35))        # head end (lower) darker, dried blood/skin
    g = k * (1.0 - 0.3 * head) * (0.9 + 0.2 * N.noise01(p, 9.0, 1.0))
    return (tone[0] * g, tone[1] * g * (1 - 0.04 * head), tone[2] * g * (1 - 0.08 * head))


for nm, bmx, keep in (('stockfish', full, 'drop'), ('stockfish_l1', l1, 'lod1'), ('stockfish_l2', l2, 'keep')):
    ob = K.part(bmx, 'wood_paint', name=nm, grime=0.15, jitter=0.0, bisect=False, smooth=False)
    if keep != 'lod1':
        ob['kit_lod'] = keep          # LOD0 all fish, LOD1 l1+l2 (~half), LOD2 l2 only
    N.recolor(ob, fish_col)

if VAR == 'b':
    bm = K.bm_new()                               # slatted fish crates (3 slats per side, corner posts) + salt barrel
    stack = [(xs[-1] + 1.45, -0.45, 0.0), (xs[-1] + 1.5, -0.45, 0.36), (xs[-1] + 1.45, 0.05, 0.0), (xs[-1] + 2.1, -0.4, 0.0)]
    for (cx, cy, cz) in stack:
        w, d, h = 0.62, 0.42, 0.34
        for k in range(3):
            zz = cz + 0.05 + k * 0.11
            for sy in (-1, 1):
                K.box_bm(bm, (cx, cy + sy * d / 2, zz + 0.04), (w, 0.02, 0.08))
            for sx in (-1, 1):
                K.box_bm(bm, (cx + sx * w / 2, cy, zz + 0.04), (0.02, d, 0.08))
        for sx in (-1, 1):
            for sy in (-1, 1):
                K.box_bm(bm, (cx + sx * (w / 2 - 0.03), cy + sy * (d / 2 - 0.03), cz + h / 2), (0.05, 0.05, h))
        K.box_bm(bm, (cx, cy, cz + 0.02), (w, d, 0.02))
    K.part(bm, 'timber_grey', name='crates', uv='beam', axis=(1, 0, 0), jitter=0.15)
    bm = K.bm_new()
    for k in range(6):                            # a few fish in the top crate
        fish(bm, (xs[-1] + 1.3 + k * 0.05, -0.62, 0.72), 1, 0.45, 1.3, 0.1)
    import bmesh as _b2
    _b2.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'wood_paint', name='crate_fish', mat_tint=(0.8, 0.72, 0.58), bisect=False)
    bm = K.bm_new()
    K.cyl_bm(bm, (xs[-1] + 1.4, 0.75, 0), (xs[-1] + 1.4, 0.75, 0.85), 0.32, 12, r1=0.3)
    K.part(bm, 'timber_tarred', name='salt_barrel', uv='beam', axis=(0, 0, 1), smooth=True, mat_tint=(0.7, 0.6, 0.5))
    bm = K.bm_new()
    for rz in (0.1, 0.72):
        K.cyl_bm(bm, (xs[-1] + 1.4, 0.75, rz), (xs[-1] + 1.4, 0.75, rz + 0.05), 0.33, 12)
    K.part(bm, 'steel_galv', name='barrel_hoops', mat_tint=(0.4, 0.38, 0.36))
    K.footprint(N.rect(xs[-1] + 1.0, -0.8, xs[-1] + 2.5, 1.1), 'HIGH', 'crates')
K.footprint(N.rect(xs[0] - 0.7, -SP - 0.2, xs[-1] + 0.7, SP + 0.2), 'FENCE', 'drying_rack')
if SNOW:
    bm = K.bm_new()                               # snow ridges on the rails and caps on the tied fish pairs
    for z in LEV:
        for s in (-1, 1):
            yy = rail_y(z, s)
            K.cyl_bm(bm, (xs[0] - 0.5, yy, z + 0.05), (xs[-1] + 0.5, yy, z + 0.05), 0.05, 5)
    for (x, yy, z) in ties[::2]:
        K.box_bm(bm, (x, yy, z + 0.08), (0.14, 0.2, 0.06), taper=(0.6, 0.6))
    K.part(bm, 'snow', name='snow_rails', grime=0, bisect=False, smooth=True)
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=512, ao_samples=32, recenter=False)
