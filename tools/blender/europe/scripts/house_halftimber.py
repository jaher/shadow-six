"""Half-timbered town / village house (colombage / Fachwerk), rework 1 after the art-director pass.
 a = Norman, Pays d'Auge (Beuvron-en-Auge): dense close studding (pans serres, stud = gap) in dark oak, cream lime infill,
     fieldstone plinth, jettied upper storey on a carved sill beam (sabliere sculptee), slate-hung gable (essentage),
     thatch with a rounded eave roll, layered verge and a turf ridge planted with iris; two big thatched dormers.
 b = Alsatian (Colmar): masonry ground floor, TWO timber storeys each jettied, St Andrew's crosses + 'Mann' bracing,
     carved corner posts, an oriel (Erker) on a corbel, steep 58 deg beaver-tail tile roof (roof_tile_flat) with a row of
     dormers + eyebrow vents and snow hooks.
 c = Picard / Flemish border: square framing with brick nogging, deep jetty on a moulded bressummer + joist ends,
     slate roof with ridge tiles / repairs / dormer, downpipes that follow the jettied wall line.
 d = Breisgau (Freiburg, M20 range barracks): red-sandstone ground floor, one jettied Fachwerk storey with Mann bracing,
     dark slate roof with dormers, a round corner turret (stair tower) with a slate cone and the flag on its finial
 e = Baden village house with a Dachreiter (small bell turret on the ridge, louvred, slate spire, weathervane)
 suffix '-ruin': shelled (stepped blast through the frame with broken studs + hanging nogging, splintered roof, heaps)
usage: blender -b --python house_halftimber.py -- outdir variant seed"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import (K, V, args, SHUTTER, DOOR, ruin_pass, timber_face, finish, roof_tone, roof_patches, roof_ridge,
                       roof_decals, eave_streaks, use_cheap_windows)
use_cheap_windows()
import kit_core as C
import kit_roof as KR
import eu_common as EC

OUT, VAR, SEED = args('house_halftimber_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('house_halftimber_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
rr = random.Random(SEED)
CFG = {
    'a': dict(L=10.0, W=6.0, stor=[(0.0, 3.0, 0.0), (3.2, 5.6, 0.55)], masonry0=False, infill='plaster_rough',
              itint=(1.0, 0.95, 0.85), wood=(0.30, 0.22, 0.16), style='close', gap=0.3, post=0.17, braces=False,
              roof='thatch', pitch=55, plinth='fieldstone', shut=None, door='brown', dormers=(-2.4, 2.3)),
    'b': dict(L=8.6, W=7.0, stor=[(0.0, 2.9, 0.0), (3.1, 5.6, 0.38), (5.8, 8.2, 0.34)], masonry0=True, infill='plaster_limewash',
              itint=(1.0, 0.86, 0.6), wood=(0.40, 0.27, 0.19), style='cross', gap=0.75, post=0.2, braces=True,
              roof='roof_tile_flat', pitch=58, plinth='ashlar', shut='green', door='green', dormers=(-2.0, 2.0)),
    'c': dict(L=10.2, W=6.2, stor=[(0.0, 2.75, 0.0), (2.95, 5.35, 0.5)], masonry0=False, infill='brick_red', itint=None,
              wood=(0.30, 0.27, 0.24), style='square', gap=0.75, post=0.2, braces=True,
              roof='roof_slate', pitch=48, plinth='fieldstone_grey', shut='grey', door='black', dormers=(-2.2,)),
    'd': dict(L=11.0, W=8.6, stor=[(0.0, 3.0, 0.0), (3.2, 5.8, 0.3)], masonry0=True, infill='plaster_limewash',
              itint=(1.0, 0.94, 0.8), wood=(0.34, 0.22, 0.16), style='cross', gap=0.75, post=0.2, braces=True,
              roof='roof_slate', pitch=52, plinth='ashlar', shut='green', door='brown', dormers=(-2.6, 1.4)),
    'e': dict(L=10.0, W=7.0, stor=[(0.0, 2.9, 0.0), (3.1, 5.4, 0.3)], masonry0=False, infill='plaster_limewash',
              itint=(0.98, 0.95, 0.88), wood=(0.3, 0.24, 0.19), style='square', gap=0.75, post=0.2, braces=True,
              roof='roof_slate', pitch=50, plinth='fieldstone_grey', shut='oxblood', door='green', dormers=(2.4,)),
}[base]
L, W = CFG['L'], CFG['W']
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
WOOD, INF, ITINT = CFG['wood'], CFG['infill'], CFG['itint']
ST = CFG['stor']
JC = [sum(s[2] for s in ST[:k + 1]) for k in range(len(ST))]          # cumulative jetty of storey k (front)
PL = [[(x0, y0 - j), (x1, y0 - j), (x1, y1), (x0, y1)] for j in JC]  # storey footprints
TW = 0.3                                                              # wall thickness (timber storeys)
ZE = ST[-1][1]                                                        # wall plate of the top storey
Wr = W + JC[-1]                                                       # roof span
ycr = (y0 - JC[-1] + y1) / 2
TANP = math.tan(math.radians(CFG['pitch']))
ZR = ZE + (Wr / 2) * TANP                                             # ridge line (under the covering)
sc = SHUTTER[CFG['shut']] if CFG['shut'] else None


def moulded_beam(xa, xb, y_face, z, h=0.3, proj=0.14, carved=True, name='sill_beam'):
    """Bressummer / sabliere under a jetty: ogee-moulded profile lofted along X on the face y_face (front, -Y outward),
    optional carved rosettes + dentils (Pays d'Auge / Colmar carving) - gives the jetty line real depth and shadow."""
    prof = [(0.0, 0.0), (0.05, 0.02), (0.1, 0.07), (proj, 0.13), (proj * 0.8, 0.19), (proj, 0.24), (0.04, h), (0.0, h)]
    bm = K.bm_new()
    rings = [[V((x, y_face - py, z + pz)) for py, pz in prof] + [V((x, y_face + 0.12, z + h)), V((x, y_face + 0.12, z))] for x in (xa, xb)]
    K.loft_bm(bm, rings)
    import bmesh
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'timber_beam', name=name, uv='beam', axis=(1, 0, 0), tint=WOOD, grime=0.5)
    if carved:
        bm = K.bm_new()
        n = int((xb - xa) / 0.5)
        for i in range(n):
            x = xa + (i + 0.5) * (xb - xa) / n
            K.cyl_bm(bm, (x, y_face - proj * 0.8 + 0.01, z + 0.16), (x, y_face - proj * 0.8 - 0.035, z + 0.16), 0.055, 6, r1=0.03)   # rosette
            K.box_bm(bm, (x + 0.25, y_face - 0.06, z + 0.035), (0.07, 0.07, 0.05))                                          # dentil
        K.part(bm, 'timber_beam', name=name + '_carving', tint=tuple(c * 0.85 for c in WOOD), grime=0.3)


def jetty(k):
    """Floor band where storey k overhangs storey k-1 at the front: joist ends, carved bressummer, consoles at posts."""
    zb = ST[k - 1][1]
    ja, jb = JC[k - 1], JC[k]
    bm = K.bm_new()
    n = int(L / 0.5)
    for i in range(n + 1):
        x = x0 + 0.12 + i * (L - 0.24) / n
        K.beam_bm(bm, (x, y0 - ja + 0.1, zb + 0.07), (x, y0 - jb - 0.02, zb + 0.07), 0.13, 0.15)
    for x in (x0 + 0.12, x1 - 0.12) + ((0.0,) if base != 'a' else ()):
        K.beam_bm(bm, (x, y0 - ja - 0.02, zb - 0.85), (x, y0 - jb + 0.12, zb - 0.02), 0.16, 0.15)          # console brace
    K.part(bm, 'timber_beam', name='jetty%d' % k, uv='beam', axis=(0, 1, 0), tint=WOOD)
    bm = K.bm_new()
    K.prism_bm(bm, [(x0, y0 - jb), (x1, y0 - jb), (x1, y0 - ja), (x0, y0 - ja)], zb + 0.13, zb + 0.155)
    K.part(bm, 'deck_planks', name='jetty_soffit%d' % k, tint=WOOD)
    moulded_beam(x0 - 0.06, x1 + 0.06, y0 - jb, zb + 0.14, carved=base != 'c', name='sill_beam%d' % k)


# ---- storeys: openings, walls, timber framing ------------------------------------------------------------------------
FR = {}                                    # storey -> dict(face -> frames)
for k, (z0, z1, _) in enumerate(ST):
    P = PL[k]
    h = z1 - z0
    sill = z0 + (0.95 if k == 0 else 0.8)
    wh = min(1.25, h - (sill - z0) - 0.35)
    f = {0: [], 1: [], 2: [], 3: []}
    if k == 0:
        ts = [1.5, L / 2 + 1.6, L - 1.4] if base != 'b' else [1.3, L - 1.5]
        ww = 0.85
        if base == 'a':                                   # Pays d'Auge: generous, closely spaced ground-floor casements
            ts, ww, wh = [1.25, 2.75, L / 2 + 1.35, L - 1.25], 1.05, min(1.4, h - 0.9 - 0.35)
            sill = z0 + 0.9
        f[0] = [K.opening(P, 0, t, ww, wh, sill, TW + 0.02) for t in ts]
        gd = K.opening(P, 0, L / 2 - 0.5 if base != 'b' else L / 2 - 0.2, 1.0 if base != 'b' else 1.3, 2.1, 0.0, TW + 0.02,
                       'rect' if base != 'b' else 'arch', 'door')
        f[0].append(gd)
        bd = K.opening(P, 2, L / 2, 0.9, 1.95, 0.0, TW + 0.02, 'rect', 'door')
        f[2] = [K.opening(P, 2, 2.0, 0.8, 1.0, 1.0, TW + 0.02), bd]
        f[1] = [K.opening(P, 1, W / 2, 0.7, 0.9, 1.1, TW + 0.02)]
    else:
        ts = [1.4, L / 2 - 1.1, L / 2 + 1.3, L - 1.4] if base != 'b' else [1.2, L / 2 - 0.9, L / 2 + 0.9, L - 1.2]
        if base == 'b' and k == 1:
            ts = [1.2, L - 1.2]                              # the oriel takes the middle of the first floor
        f[0] = [K.opening(P, 0, t, 0.8 if base != 'b' else 0.75, wh, sill, TW) for t in ts]
        f[2] = [K.opening(P, 2, 2.2, 0.8, 1.0, sill + 0.1, TW), K.opening(P, 2, L - 2.2, 0.8, 1.0, sill + 0.1, TW)]
        if base == 'b':
            f[1] = [K.opening(P, 1, (W + JC[k]) / 2, 0.7, 1.0, sill, TW)]
    if base == 'd':                                       # the SE corner turret takes the east bay of the front
        f[0] = [x for x in f[0] if x.kind == 'door' or x.o.x < x1 - 2.2]
    FR[k] = f
    allf = f[0] + f[1] + f[2] + f[3]
    if k == 0 and CFG['masonry0']:                         # Alsace: pink sandstone ground floor with dressed quoins
        K.wall_ring(P, h, 0.5, 'ashlar', allf, z0=z0, name='walls0', mat_tint=(1.0, 0.8, 0.72), plinth=('ashlar', 0.5, 0.04))
        K.quoins(P, 0.5, h, 'ashlar', block_h=0.35, name='quoins0')
        continue
    if k == 0:
        K.wall_ring(P, 0.6, TW + 0.1, CFG['plinth'], [x for x in allf if x.kind == 'door'], name='plinth_wall')
        K.wall_ring(P, h - 0.6, TW, INF, allf, z0=0.6, name='walls0', mat_tint=ITINT)
        zz0 = 0.6
    else:
        K.wall_ring(P, h, TW, INF, allf, z0=z0, name='walls%d' % k, mat_tint=ITINT, footprint=False)
        zz0 = z0
    for e in range(4):
        a, b = P[e], P[(e + 1) % 4]
        timber_face(a, b, zz0, z1, f[e], style=CFG['style'], tint=WOOD, name='tf%d_%d' % (k, e), seed=SEED + k * 4 + e,
                    post=CFG['post'], stud_gap=CFG['gap'], braces=CFG['braces'])
K.footprint(PL[-1], 'HIGH')
for k in range(1, len(ST)):
    jetty(k)

# carved corner posts (b): full-height moulded posts at the front corners of every timber storey
if base == 'b':
    import bmesh
    bm = K.bm_new()
    for k in range(1, len(ST)):
        z0, z1, _ = ST[k]
        for x in (x0 + 0.02, x1 - 0.02):
            p = V((x, y0 - JC[k] - 0.02, 0))
            K.box_bm(bm, tuple(p + V((0, 0, (z0 + z1) / 2))), (0.3, 0.26, z1 - z0))
            for zz in (z0 + 0.35, (z0 + z1) / 2, z1 - 0.35):                      # carved rings / capitals
                K.cyl_bm(bm, p + V((0, -0.02, zz - 0.07)), p + V((0, -0.02, zz + 0.07)), 0.19, 8)
    K.part(bm, 'timber_beam', name='corner_posts', tint=tuple(c * 0.9 for c in WOOD), uv='beam', axis=(0, 0, 1))


# ---- thatch (a): lofted section with a rounded eave roll, softened layered verges, turf + iris ridge -------------------
def thatch_roof(oh=0.4, goh=0.45, tn=0.4, NS=10, NX=26):
    """Lofted thatch with an eave roll, layered verges; the surface undulates (large + medium noise, wavy eave line) and
    carries vertex-colour weathering (age, combed streaks, greyer eaves, mossy north slope, fresher re-thatched strips)."""
    import bmesh
    from mathutils import noise as NZ
    p = math.radians(CFG['pitch'])
    thv = tn / math.cos(p)
    Ye = Wr / 2 + oh
    zO = lambda ly: ZE + (Wr / 2 - abs(ly)) * TANP + thv
    ring = []
    for side in (-1, 1):                                  # outer surface: eave -> ridge (front), ridge -> eave (back)
        lys = [side * Ye + (-side) * Ye * (0.93 * i / (NS - 1)) for i in range(NS)]
        pts = [(ly, zO(ly)) for ly in lys]
        ring += pts if side < 0 else list(reversed(pts))
    ring.insert(NS, (0.0, zO(0) - 0.02))
    def roll(side):                                       # semicircular eave roll from outer to underside
        d = V((side * math.cos(p), -math.sin(p)))
        n = V((side * math.sin(p), math.cos(p)))
        ce = V((side * Ye, zO(side * Ye) - thv / 2))
        return [tuple(ce + n * math.cos(a) * thv * 0.5 + d * math.sin(a) * thv * 0.5) for a in [math.pi * i / 6 for i in range(1, 6)]]
    front = ring[:NS]
    uf = [(ly, z - thv) for ly, z in reversed(ring[:NS])]
    ub = [(ly, z - thv) for ly, z in reversed(ring[NS + 1:])]
    prof = front + [ring[NS]] + ring[NS + 1:] + roll(1) + ub + [(0.0, zO(0) - thv - 0.02)] + uf + list(reversed(roll(-1)))
    xs = [-L / 2 - goh, -L / 2 - goh + 0.15] + [-L / 2 + L * i / NX for i in range(1, NX)] + [L / 2 + goh - 0.15, L / 2 + goh]

    def dz(x, ly):                                        # undulation, faded under the turf ridge
        f = min(1.0, max(0.0, (abs(ly) - 0.55) / 0.8))
        v = 0.085 * NZ.noise(V((x * 0.55 + SEED, ly * 0.55, 1.3))) + 0.035 * NZ.noise(V((x * 1.7, ly * 1.7 + SEED, 4.1)))
        v += 0.03 * math.sin(x * 2.3 + SEED) * max(0.0, (abs(ly) - Wr / 2 + 0.6)) / (oh + 0.6)    # wavy eave line
        return v * f
    rings = []
    for x in xs:
        e = min(abs(x - xs[0]), abs(x - xs[-1]))
        k = 1.0 if e > 0.1 else (0.86 if e > 0.01 else 0.7)          # softened, layered verge
        zm_ = lambda ly: zO(min(abs(ly), Ye)) - thv / 2
        rings.append([V((x, ycr + ly * (1 - (1 - k) * 0.08), zm_(ly) + (z - zm_(ly)) * k + dz(x, ly))) for ly, z in prof])
    bm = K.bm_new()
    K.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = K.part(bm, 'roof_thatch', name='thatch_slope', grime=0.2, smooth=True)
    thatch_tone(ob, Ye)
    # turf ridge crest (faitage en terre) planted with iris + grass clumps (alpha cards, grey-green)
    bm = K.bm_new()
    zt = zO(0) - 0.08
    cr = [(-0.55, zt - 0.3), (-0.35, zt + 0.08), (-0.12, zt + 0.2), (0.12, zt + 0.2), (0.35, zt + 0.08), (0.55, zt - 0.3), (0, zt - 0.4)]
    K.loft_bm(bm, [[V((x, ycr + a, b)) for a, b in cr] for x in (-L / 2 - goh + 0.1, L / 2 + goh - 0.1)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'sod', name='ridge_turf', grime=0.3, mat_tint=(0.9, 0.95, 0.8))
    sp, x = [], -L / 2 - goh + 0.35
    while x < L / 2 + goh - 0.3:
        sp.append((x + rr.uniform(-0.1, 0.1), ycr + rr.uniform(-0.12, 0.12), zt + 0.18, rr.uniform(0.42, 0.62), rr.uniform(0.5, 0.75)))
        x += rr.uniform(0.32, 0.5)
    EC.foliage(sp, cell=(0, 0, 0, 1), name='ridge_iris', tint=(0.95, 1.0, 0.92), lod='keep', seed=SEED + 5, lean=0.1)
    C.roof_meta([(x0 - goh, ycr - Ye), (x1 + goh, ycr - Ye), (x1 + goh, ycr + Ye), (x0 - goh, ycr + Ye)], ZE, kind='gable')
    R = KR.Roof(c=V((0, ycr, 0)), ax=V((1, 0, 0)), ay=V((0, 1, 0)), L=L, W=Wr, z_eave=ZE, z_ridge=zO(0), pitch=CFG['pitch'],
                rot=0.0, mid='roof_thatch', lift=thv)
    R.parts = [ob]
    return R


def thatch_tone(ob, Ye):
    import bmesh
    from mathutils import noise as NZ
    bm = bmesh.new(); bm.from_mesh(ob.data)
    col = bm.loops.layers.color.get('Col')
    fresh = [(rr.uniform(-L / 2 + 1, L / 2 - 2.5), rr.uniform(1.2, 2.2), -1) for _ in range(2)] + [(rr.uniform(-L / 2, L / 2 - 2), 1.8, 1)]
    for f in bm.faces:
        for l in f.loops:
            q = l.vert.co
            ly = q.y - ycr
            s = 1 if ly > 0 else -1
            t = min(1.0, abs(ly) / Ye)                                   # 0 ridge .. 1 eave
            k = 0.86 + 0.12 * NZ.noise(V((q.x * 0.4 + SEED, ly * 0.5, 7.0))) + 0.05 * NZ.noise(V((q.x * 5.0, 0.3, SEED)))
            k -= 0.14 * max(0.0, t - 0.7) / 0.3                          # eaves weathered darker
            c = V((k, k * 0.98, k * 0.93))
            m = max(0.0, NZ.noise(V((q.x * 0.7, ly * 0.9, 11.0 + SEED)))) * (1.6 if s > 0 else 0.7)
            c = V((c.x * (1 - 0.22 * m), c.y * (1 - 0.08 * m), c.z * (1 - 0.3 * m)))       # moss / algae (north slope)
            for fx, fw, fs in fresh:
                if fs == s and fx < q.x < fx + fw and 0.25 < t < 0.95:
                    c = V((min(1, c.x * 1.12), min(1, c.y * 1.08), c.z * 0.98))            # newer golden re-thatch strip
            c0 = l[col]
            l[col] = (c0[0] * c.x, c0[1] * c.y, c0[2] * c.z, c0[3])
    bm.to_mesh(ob.data); bm.free()


def vent_dormer(R, lx, ly, w=0.7, h=0.42, mid='roof_tile_flat'):
    """Small triangular roof vent (Ochsenauge / chien-assis) sitting on slope R at roof-local (lx, ly)."""
    import bmesh
    s = 1 if ly > 0 else -1
    zs = lambda y: R.z_eave + (R.W / 2 - abs(y)) * TANP + R.lift
    A, B = R.w(lx - w / 2, ly, zs(ly)), R.w(lx + w / 2, ly, zs(ly))
    T = R.w(lx, ly, zs(ly) + h)
    Tb = R.w(lx, ly - s * (h / TANP) * 1.05, zs(ly) + h + 0.02)
    bm = K.bm_new()
    for q in ((A, T, Tb), (T, B, Tb)):
        f = bm.faces.new([bm.verts.new(p) for p in q])
    K.part(bm, mid, name='vent_roof', grime=0.4, bisect=False, tint=(0.9, 0.9, 0.9))
    bm = K.bm_new()
    nn = V((0, s * 0.03, 0))
    bm.faces.new([bm.verts.new(p + nn) for p in (A.lerp(T, 0.12), B.lerp(T, 0.12), T.lerp(A.lerp(B, 0.5), 0.15))])
    K.part(bm, 'interior_dark', name='vent_hole', grime=0, bisect=False)


def gutters_jettied(R, eave_oh):
    """Front + back eave gutters with downpipes that follow the jettied wall line down to the ground (no floating pipes)."""
    bm = K.bm_new()
    ze = R.z_eave - eave_oh * TANP + R.lift
    for s in (-1, 1):
        yg = ycr + s * (Wr / 2 + eave_oh + 0.08)
        K.cyl_bm(bm, (x0 - 0.3, yg, ze - 0.12), (x1 + 0.3, yg, ze - 0.12), 0.065, 8)
        for xp in (x0 + 0.35, x1 - 0.35):
            pts = [V((xp, yg, ze - 0.14))]
            if s < 0:
                for k in range(len(ST) - 1, -1, -1):
                    yw = y0 - JC[k] - 0.07
                    pts.append(V((xp, yw, pts[-1].z - 0.35)))
                    pts.append(V((xp, yw, (ST[k][0] + 0.25) if k > 0 else 0.25)))
                pts.append(V((xp, y0 - 0.35, 0.08)))
            else:
                pts += [V((xp, y1 + 0.07, ze - 0.5)), V((xp, y1 + 0.07, 0.25)), V((xp, y1 + 0.35, 0.08))]
            for a, b in zip(pts[:-1], pts[1:]):
                K.cyl_bm(bm, a, b, 0.045, 6)
    K.part(bm, 'cast_iron', name='gutters', smooth=True, grime=0.5)


# ---- gables --------------------------------------------------------------------------------------------------------
P = PL[-1]
gz = lambda t: ZE + (Wr / 2 - abs(t - Wr / 2)) * TANP - 0.08
gab = {1: K.opening(P, 1, Wr / 2, 0.6, 0.8, ZE + 0.9, TW), 3: K.opening(P, 3, Wr / 2, 0.75, 0.9, ZE + 0.75, TW)}
for e in (1, 3):
    if base == 'a':        # essentage: slate-hung gable over a thin sill board
        K.gable(P, e, ZE, ZR, TW, 'roof_slate_b', [gab[e]], name='gable%d' % e)
        a_, b_ = V((*P[e], 0)), V((*P[(e + 1) % 4], 0))
        nrm = V(((b_ - a_).y, -(b_ - a_).x, 0)).normalized()
        K.P('timber_beam', K.beam_bm, a_ + nrm * 0.05 + V((0, 0, ZE + 0.05)), b_ + nrm * 0.05 + V((0, 0, ZE + 0.05)), 0.12, 0.16,
            uv='beam', axis=tuple((b_ - a_).normalized()), tint=WOOD, name='gable_sill%d' % e)
    else:
        K.gable(P, e, ZE, ZR, TW, INF, [gab[e]], name='gable%d' % e, mat_tint=ITINT)
        timber_face(P[e], P[(e + 1) % 4], ZE, ZR, [gab[e]], ztop=gz, style=CFG['style'], tint=WOOD, name='tf_gab%d' % e,
                    seed=SEED + 20 + e, post=CFG['post'], stud_gap=CFG['gap'], braces=CFG['braces'])

# ---- windows / doors -------------------------------------------------------------------------------------------------
wk = 0
for k in FR:
    for e, frs in FR[k].items():
        for f in frs:
            if f.kind == 'door':
                front = e == 0
                K.door(f, 'front' if front else 'back', ('plank' if base == 'a' else 'panel') if front else 'plank',
                       DOOR[CFG['door']] if front else DOOR['brown'], step='ashlar' if front else None, lintel=None)
                continue
            K.window(f, 'casement', (2, 3) if base == 'a' else (1, 3), frame='white' if base != 'c' else (0.75, 0.74, 0.7),
                     sill='timber_beam', lintel=None, recess=0.06, curtain=0.7, name='w%d' % wk, streak=e == 0 and base != 'a',
                     shutters=(('open' if wk % 4 else 'closed') if (sc and e == 0) else None), shutter_color=sc, shutter_style='plank')
            wk += 1
for e in (1, 3):
    K.window(gab[e], 'casement', (1, 2), frame=(0.7, 0.68, 0.62), sill='timber_beam', lintel=None, name='wgab%d' % e, recess=0.06,
             streak=False)


# ---- roof ------------------------------------------------------------------------------------------------------------
EOH = 0.4
wkw = dict(style='casement', panes=(1, 2), frame='white', sill=None, streak=False, curtain=0.5)
if base == 'a':
    R = thatch_roof()
    # roof dormers set 0.9 m back up the slope: the thatch eave runs unbroken in front of them (no exposed studs /
    # 'balcony rail' band under the windows); dormer front stands on the thatch surface, no cut into the thatch
    dsb = 0.9
    R2 = KR.Roof(c=R.c, ax=R.ax, ay=R.ay, L=R.L, W=Wr - 2 * dsb, z_eave=ZE + dsb * TANP + R.lift + 0.1, z_ridge=R.z_ridge,
                 pitch=R.pitch, rot=0.0, mid='roof_thatch', lift=0.0)
    R2.parts = []
    for lx in CFG['dormers']:
        K.dormer(R2, lx, -1, 1.45, 1.3, wall='plaster_rough', roof='roof_thatch', pitch=55, oh=0.3, window_kw=dict(wkw, panes=(2, 2)))
    K.chimney(x1 - 0.9, ycr + 0.7, ZE - 1.0, R.z_ridge + 0.7, 0.8, 0.6, 'brick_red', cap='ashlar', pots=1)
    roof_decals(R, 6, seed=SEED, kinds=('moss_patch', 'lichen'), alpha=0.3, avoid=CFG['dormers'])
else:
    R = K.roof_gable(0, ycr, L, Wr, ZE, CFG['pitch'], CFG['roof'], eave_oh=EOH, gable_oh=0.35, thick=0.14,
                     fascia='timber_beam', barge='timber_beam', gutters=False, sag=0.04, wobble=0.015)
    gutters_jettied(R, EOH)
    for lx in CFG['dormers']:
        K.dormer(R, lx, -1, 1.0 if base == 'b' else 1.2, 1.15, wall='plaster_limewash' if base == 'b' else 'timber_siding',
                 roof=CFG['roof'], pitch=58 if base == 'b' else 50, window_kw=dict(wkw, frame='white' if base == 'b' else (0.75, 0.74, 0.7)))
    vents = [(-2.8, -1.5), (0.0, -2.1), (2.8, -1.5), (-1.6, 1.8), (1.6, 1.8)] if base == 'b' else [(0.6, -1.2), (-1.2, 1.4)]
    if not RUIN:
        for lx, ly in vents:
            vent_dormer(R, lx, ycr * 0 + ly * (Wr / 2) / 3.5 if base == 'b' else ly)
    K.chimney(x1 - 1.4, ycr + 0.6, ZE - 0.5, R.z_ridge + 0.6, 0.7, 0.55, 'brick_red' if base == 'c' else 'ashlar',
              cap='ashlar', pots=1)
    roof_tone(R, amp=0.18, seed=SEED)
    if not RUIN and base == 'c':
        roof_patches(R, 2, 'roof_slate_b', (0.84, 0.86, 0.9), seed=SEED, avoid=CFG['dormers'], size=((0.6, 1.2), (0.5, 0.9)))
    roof_ridge(R, mid='roof_tile_flat', tint=(0.9, 0.8, 0.72) if base == 'c' else (0.8, 0.7, 0.64), overhang=0.3,
               crest=base == 'b', finials=True)
    roof_decals(R, 4, seed=SEED, avoid=CFG['dormers'])
K.anchor('roof_ridge', (0, ycr, R.z_ridge))

# ---- Breisgau corner turret (d) / Dachreiter on the ridge (e) ------------------------------------------------------
if base == 'd' and not RUIN:
    import bmesh as _bm
    TC, TR, TZ = V((x1 + 0.35, y0 - JC[-1] - 0.35, 0)), 1.85, ZE + 1.6
    bm = K.bm_new(); K.cyl_bm(bm, TC + V((0, 0, -0.1)), TC + V((0, 0, 3.1)), TR, 18); K.part(bm, 'ashlar', name='turret0', mat_tint=(1.0, 0.8, 0.72))
    bm = K.bm_new(); K.cyl_bm(bm, TC + V((0, 0, 3.1)), TC + V((0, 0, TZ)), TR - 0.05, 18); K.part(bm, 'plaster_limewash', name='turret1', mat_tint=ITINT)
    bm = K.bm_new()
    for z in (3.05, TZ - 0.2):
        K.cyl_bm(bm, TC + V((0, 0, z)), TC + V((0, 0, z + 0.22)), TR + 0.08, 18)
    for k_ in range(8):
        a = 2 * math.pi * k_ / 8
        K.box_bm(bm, tuple(TC + V((math.cos(a) * (TR - 0.02), math.sin(a) * (TR - 0.02), (3.3 + TZ) / 2))), (0.18, 0.18, TZ - 3.3), a)
    K.part(bm, 'timber_beam', name='turret_frame', tint=WOOD, uv='beam', axis=(0, 0, 1))
    bm = K.bm_new(); K.cyl_bm(bm, TC + V((0, 0, TZ)), TC + V((0, 0, TZ + 4.6)), TR + 0.35, 18, r1=0.03); K.part(bm, 'roof_slate', name='turret_cone', smooth=True)
    bm = K.bm_new()
    for k_ in range(5):
        a = -math.pi / 2 + (k_ - 2) * 0.6
        for z in (1.3, 4.0):
            K.box_bm(bm, tuple(TC + V((math.cos(a) * (TR + 0.01), math.sin(a) * (TR + 0.01), z + 0.5))), (0.5, 0.12, 1.0), a + math.pi / 2)
    K.part(bm, 'interior_dark', name='turret_lights', bisect=False)
    apex = TC + V((0, 0, TZ + 4.6))
    bm = K.bm_new(); K.cyl_bm(bm, apex - V((0, 0, 0.2)), apex + V((0, 0, 3.2)), 0.04, 6); K.part(bm, 'cast_iron', name='turret_pole', bisect=False)
    K.anchor('flag', tuple(apex + V((0.05, 0, 3.1))), (1, 0, 0), kind='flag', w=1.6, h=1.05)
    K.footprint([(TC.x + TR * math.cos(a), TC.y + TR * math.sin(a)) for a in [2 * math.pi * i / 12 for i in range(12)]], 'HIGH', 'turret')
if base == 'e' and not RUIN:
    DC, DS = V((-2.2, ycr, R.z_ridge - 0.6)), 1.25
    bm = K.bm_new(); K.box_bm(bm, tuple(DC + V((0, 0, 1.1))), (DS, DS, 2.2)); K.part(bm, 'timber_siding', name='dachreiter', mat_tint=(0.5, 0.4, 0.32))
    bm = K.bm_new()
    for (dx, dy) in ((0, -1), (0, 1), (1, 0), (-1, 0)):
        K.box_bm(bm, tuple(DC + V((dx * (DS / 2 + 0.01), dy * (DS / 2 + 0.01), 1.55))), (0.5 if dx == 0 else 0.04, 0.04 if dx == 0 else 0.5, 0.75))
    K.part(bm, 'interior_dark', name='dachreiter_louvres', bisect=False)
    bm = K.bm_new(); K.cyl_bm(bm, DC + V((0, 0, 2.2)), DC + V((0, 0, 4.4)), DS * 0.8, 4, r1=0.02)
    K.part(bm, 'roof_slate', name='dachreiter_spire')
    bm = K.bm_new(); K.cyl_bm(bm, DC + V((0, 0, 4.3)), DC + V((0, 0, 5.4)), 0.03, 6)
    K.box_bm(bm, tuple(DC + V((0.2, 0, 5.2))), (0.5, 0.02, 0.22)); K.part(bm, 'cast_iron', name='weathervane', bisect=False)

# ---- Alsatian oriel (Erker) on a stone corbel, first floor --------------------------------------------------------------
if base == 'b':
    zb, zt = ST[1][0] + 0.3, ST[1][1] - 0.15
    yF = y0 - JC[1]
    xa, xb, dp = -1.05, 1.05, 0.62
    op = K.ccw([(xa, yF + 0.05), (xa + 0.38, yF - dp), (xb - 0.38, yF - dp), (xb, yF + 0.05)])
    frs = []
    for e in range(4):
        a_, b_ = V((*op[e], 0)), V((*op[(e + 1) % 4], 0))
        mid_ = (a_ + b_) / 2
        if mid_.y > yF - 0.02:
            continue
        frs.append(K.opening(op, e, (b_ - a_).length / 2, min(0.95, (b_ - a_).length - 0.3), 1.1, zb + 0.7, 0.12))
    K.wall_ring(op, zt - zb, 0.12, INF, frs, z0=zb, name='oriel', mat_tint=ITINT, footprint=False)
    for f in frs:
        K.window(f, 'fixed', (2, 3), frame='white', sill='timber_beam', lintel=None, recess=0.03, curtain=0.8, name='oriel_w', streak=False)
    import bmesh
    bm = K.bm_new()
    for p_ in op:                                          # corner posts + sill / head rails
        K.box_bm(bm, (p_[0], p_[1], (zb + zt) / 2), (0.14, 0.14, zt - zb))
    K.part(bm, 'timber_beam', name='oriel_posts', tint=WOOD)
    bm = K.bm_new()
    K.loft_bm(bm, [[V((x, y, zb)) for x, y in K.poly_offset(op, 0.06)], [V((x * 0.35, yF + (y - yF) * 0.3, zb - 0.75)) for x, y in op]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'ashlar', name='oriel_corbel', mat_tint=(1.0, 0.8, 0.72))
    E = [V((x, y, zt)) for x, y in K.poly_offset(op, 0.12)]
    E.sort(key=lambda v: v.x)
    Ta, Tb = V((xa + 0.55, yF, zt + 0.62)), V((xb - 0.55, yF, zt + 0.62))
    bm = K.bm_new()
    fl, fr_, bl, br = E[0], E[-1], E[1], E[2]
    for q in ((fl, bl, Ta), (bl, br, Tb, Ta), (br, fr_, Tb)):
        bm.faces.new([bm.verts.new(p_) for p_ in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'roof_tile_flat', name='oriel_roof', bisect=False)

if base == 'b':
    K.sign((0.0 - 1.9, y0 - 0.05, 2.45), (0, -1, 0), 0.9, 'estaminet', hanging=True)
if base == 'c':   # pentice (small slate canopy) over the front door
    gd = [f for f in FR[0][0] if f.kind == 'door'][0]
    K.roof_shed(gd.o.x - 0.9, y0 - 0.8, gd.o.x + 0.9, y0, 2.35, 2.7, 'roof_slate', low_side='-y', oh=0.05, name='pentice', gutters=False)

# ---- small props + weathering ------------------------------------------------------------------------------------------
bm = K.bm_new()
for dx in (-0.7, 0.7):
    K.box_bm(bm, (x0 + 2.6 + dx, y0 - 0.35, 0.22), (0.08, 0.3, 0.44))
K.box_bm(bm, (x0 + 2.6, y0 - 0.35, 0.46), (1.7, 0.34, 0.05))
K.part(bm, 'timber_grey', name='bench', uv='beam', axis=(1, 0, 0))
bm = K.bm_new()
for i in range(15):
    K.cyl_bm(bm, (x1 + 0.2, y1 - 1.7 + (i % 5) * 0.26, 0.13 + (i // 5) * 0.24), (x1 + 0.75, y1 - 1.7 + (i % 5) * 0.26, 0.13 + (i // 5) * 0.24), 0.12, 6)
K.part(bm, 'timber_beam', name='woodpile', uv='beam', axis=(1, 0, 0), tint=(0.85, 0.75, 0.62))
for i in range(3):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y0 - 0.02, 0.45), (0, -1, 0), r.uniform(1.4, 2.4), 0.9, alpha=0.6)
K.decal('moss_patch', (x0 - 0.02, 0, 0.32), (-1, 0, 0), 1.6, 0.6)
eave_streaks([(P[0], P[1]), (P[2], P[3])], ZE - 0.1, n=2, seed=SEED, alpha=0.3)

if RUIN:
    import eu_dmg
    from eu_common import floor_slab
    eu_dmg.strip_shutters(0.6, SEED)
    for k, (z0_, z1_, _) in enumerate(ST):            # interior floors (seen through the breaches, cut by them)
        floor_slab(K.poly_offset(K.ccw(PL[max(0, k - 1)]), -TW), z0_ + (0.06 if k == 0 else 0.12), name='floor%d' % k, joists=k > 0,
                   tint=(0.45, 0.4, 0.36))
    import eu_dmg as _D
    _D.heap(V((x0 + 1.9, y0 + 1.4, 0.08)), 1.3, 0.7, stone=CFG['plinth'], dress=None, brick='brick_red' if INF == 'brick_red' else None,
            tiles=CFG['roof'] if CFG['roof'] != 'thatch' else None, seed=SEED + 21, name='heap_in', footprint=False, n=12)
    zk = ST[-1][0]
    ruin_pass(hits=[((x0 + 1.9, y0 - JC[-1], zk + 0.6), 1.7, (1.25, 1.3, 1.25)), ((x1 - 0.2, 0.6, ZE + 0.8), 1.5, (1.0, 1.3, 1.2))],
              rubble_at=[((x0 + 2.0, y0 - 1.9, 0), 2.1, 0.9)], holes=[(-2.0, -Wr * 0.2, 1.6), (2.5, Wr * 0.2, 1.3)], R=R,
              mids=(CFG['plinth'], 'plaster_rough'), tiles=CFG['roof'] if CFG['roof'] != 'thatch' else None,
              brick='brick_red' if INF == 'brick_red' else None, timber='timber_tarred', seed=SEED)
finish(OUT)
