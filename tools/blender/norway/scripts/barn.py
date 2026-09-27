"""Norwegian barn (lave + fjos): mortared fieldstone ground floor (byre) with small windows and plank doors,
timber upper storey with vertical boards (tommermannskledning), white corner boards and door trims, big double
threshing doors with white X-bracing reached by a lavebru (earth ramp with stone retaining walls + timber bridge),
hay hatch in the gable, ventilation louvre. Variants:
  a = Falu red, dark slate roof;  b = weathered unpainted grey boards, rusty corrugated iron roof
Usage: blender -b --python barn.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('barn')
name = 'barn_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
L, W = (16.0, 9.6) if VAR == 'a' else (14.0, 9.0)
ZS, ZE, PITCH = 2.6, 6.0, 40 if VAR == 'a' else 35
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
CL = 'batten'
CT = (0.66, 0.17, 0.12) if VAR == 'a' else (0.64, 0.62, 0.57)
TRIM = None if VAR == 'a' else (0.8, 0.78, 0.74)
zr = ZE + (W / 2) * math.tan(math.radians(PITCH))

# ---- ground floor: stone byre -----------------------------------------------------------------------------
gf = []
for t in (1.6, 4.0, L - 4.0, L - 1.6):
    gf.append(K.opening(poly, 0, t, 1.0, 0.75, 1.2, 0.55))
d_byre1 = K.opening(poly, 0, 5.4, 1.0, 1.95, 0.0, 0.55, 'segment', 'door')
d_byre2 = K.opening(poly, 0, L - 5.4, 1.0, 1.95, 0.0, 0.55, 'segment', 'door')
back = [K.opening(poly, 2, t, 1.0, 0.75, 1.2, 0.55) for t in (2.0, 6.0, 10.0, L - 2.0)]
side = [K.opening(poly, 1, W / 2, 1.1, 2.0, 0.0, 0.55, 'segment', 'door')]
K.wall_ring(poly, ZS, 0.55, 'fieldstone', gf + [d_byre1, d_byre2] + back + side, name='byre_walls')
for k, f in enumerate(gf + back):
    K.window(f, 'fixed', (3, 2), frame='white', recess=0.2, sill='granite', lintel='timber_beam', curtain=0,
             streak=False, name='bw%d' % k)
K.door(d_byre1, 'byre1', 'plank', (0.5, 0.3, 0.22), step=None, lintel='timber_beam')
K.door(d_byre2, 'byre2', 'plank', (0.5, 0.3, 0.22), step=None, lintel='timber_beam')
K.door(side[0], 'byre3', 'plank', (0.5, 0.3, 0.22), step=None, lintel='timber_beam')

# ---- upper storey: timber barn ----------------------------------------------------------------------------
up = K.opening(poly, 0, L / 2, 3.4, 3.2, ZS, 0.2, 'rect', 'door')
hay = K.opening(poly, 1, W / 2, 1.2, 1.2, ZE + 0.6, 0.2)
hay2 = K.opening(poly, 3, W / 2, 1.2, 1.2, ZE + 0.6, 0.2)
N.board_walls(poly, ZS, ZE - ZS, 0.2, [up], CL, CT, footprint=False)
N.board_gable(poly, 1, ZE, zr, 0.2, [hay], CL, CT, name='gable_e')
N.board_gable(poly, 3, ZE, zr, 0.2, [hay2], CL, CT, name='gable_w')
N.band(poly, ZS - 0.04, 0.16, 0.05, tint=TRIM, name='sill_band')
# real cover battens on the long walls and gables (board-and-batten relief that reads at 1x)
_tz = math.tan(math.radians(PITCH))
N.battens((x0, y0), (x1, y0), (0, -1, 0), ZS + 0.1, lambda t: ZE - 0.27, holes=[(L / 2 - 1.85, L / 2 + 1.85, 0, 99)],
          tint=CT, name='battens_s')
N.battens((x1, y1), (x0, y1), (0, 1, 0), ZS + 0.1, lambda t: ZE - 0.27, tint=CT, name='battens_n')
for gx, gn, nm in ((x1, 1, 'battens_e'), (x0, -1, 'battens_w')):
    N.battens((gx, y0 if gn > 0 else y1), (gx, y1 if gn > 0 else y0), (gn, 0, 0), ZS + 0.1,
              lambda t: ZE + (W / 2 - abs(t - W / 2)) * _tz - 0.18,
              holes=[(W / 2 - 0.7, W / 2 + 0.7, ZE + 0.5, ZE + 1.9)], tint=CT, name=nm)
N.corner_boards(poly, ZS, ZE, w=0.24, proud=0.05, tint=TRIM)
N.band(poly, ZE - 0.26, 0.26, 0.05, tint=TRIM, name='frieze')
node = K.door(up, 'threshing', 'barn', (1.0, 0.36, 0.26) if VAR == 'a' else (0.75, 0.7, 0.62), step=None)
N.casing(up, w=0.16, crown=False, tint=TRIM, name='cas_up')
# white X bracing + perimeter on each leaf (same node as its leaf)
fw = 0.085
w = up.w - 2 * fw
for s in (-1, 1):
    bm = K.bm_new()
    xa, xb = s * w / 2, s * 0.02
    d = -0.12 - 0.1 + 0.07
    za, zb = 0.12, up.h - fw - 0.1
    pts = [up.p(xa, za, d), up.p(xb, za, d), up.p(xb, zb, d), up.p(xa, zb, d)]
    for i in range(4):
        K.beam_bm(bm, pts[i], pts[(i + 1) % 4], 0.03, 0.14, up=tuple(up.n))
    K.beam_bm(bm, pts[0], pts[2], 0.03, 0.14, up=tuple(up.n))
    K.beam_bm(bm, pts[1], pts[3], 0.03, 0.14, up=tuple(up.n))
    ob = K.part(bm, 'wood_paint', name='brace%d' % s, node=node + str(s), uv='beam', axis=(0, 0, 1),
                **N.trim_mat(TRIM))
for f, nm in ((hay, 'hay_e'), (hay2, 'hay_w')):
    bm = K.bm_new()
    from kit_arch import lbox
    lbox(bm, f, -f.w / 2, f.w / 2, 0, f.h, -0.12, -0.06)
    K.part(bm, 'door_planks', name=nm, mat_tint=(1.0, 0.4, 0.3) if VAR == 'a' else None)
    N.casing(f, crown=False, apron=False, tint=TRIM, name='cas_' + nm)

# hay-loft pulley beams projecting from both gable apexes (heisebom) with block + rope
for sx in (-1, 1):
    bm = K.bm_new()
    xg = sx * (L / 2)
    K.box_bm(bm, (xg + sx * 0.55, 0, zr - 0.55), (1.5, 0.2, 0.24))
    K.beam_bm(bm, (xg + sx * 0.05, 0, zr - 1.45), (xg + sx * 0.9, 0, zr - 0.7), 0.1, 0.12)
    K.part(bm, 'timber_beam', name='hoist%d' % (sx + 1), uv='beam', axis=(1, 0, 0), mat_tint=(0.8, 0.75, 0.7))
    bm = K.bm_new()
    K.cyl_bm(bm, (xg + sx * 1.15, -0.06, zr - 0.78), (xg + sx * 1.15, 0.06, zr - 0.78), 0.13, 10)
    K.cyl_bm(bm, (xg + sx * 1.22, 0, zr - 0.85), (xg + sx * 1.22, 0, ZE + 0.2), 0.014, 4)
    K.part(bm, 'cast_iron', name='pulley%d' % (sx + 1), grime=0.3)
# damp band on the byre and a white gable-foot trim board
N.weather_gradient(('byre_walls',), 0.0, 1.1, low=(0.62, 0.64, 0.58), seed=SEED)
for i in range(5):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y0 - 0.001, 0.45), (0, -1, 0), r.uniform(1.6, 2.6), 0.9)
# ---- roof ---------------------------------------------------------------------------------------------------
if VAR == 'a':
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'roof_slate', eave_oh=0.5, gable_oh=0.4, thick=0.12, fascia='wood_paint',
                     barge='wood_paint', gutters=False, sag=0.07, wobble=0.015)
    for p in R.parts:
        if p.data.materials[0].get('kit_id') == 'roof_slate':
            p.data.materials[0] = K.mat('roof_slate', (0.72, 0.72, 0.76))
    N.dress_roof(R, moss=0.7, guards=True, ridge=('steel_galv', (0.4, 0.42, 0.44)), rafters=True, seed=SEED)
    # a big slate roof must not read as one flat sheet: re-laid courses (lighter blue-grey), older rusty-brown
    # slates, moss bands at the eaves, lichen, run-off streaks, two cast-iron roof lights and a roof ladder
    N.roof_patches(R, 'roof_slate', (0.9, 0.93, 1.0), fixed=[(0, 0.22, 0.35, 3.2, 1.8), (0, 0.78, 0.62, 2.4, 1.4),
                   (1, 0.4, 0.5, 3.0, 2.0)], name='slate_relaid')
    N.roof_patches(R, 'roof_slate', (0.62, 0.56, 0.5), fixed=[(0, 0.55, 0.2, 2.8, 1.2), (1, 0.8, 0.3, 2.2, 1.4)],
                   name='slate_old')
    N.roof_decals(R, n=14, seed=SEED)
    for lx in (-4.5, 4.5):
        N.skylight(R, lx, -1)
    if not SNOW:
        N.roof_ladder(R, -2.0)
else:
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'corrugated_galv', eave_oh=0.4, gable_oh=0.3, thick=0.06,
                     fascia='timber_grey', barge='timber_grey', gutters=False, sag=0.09, wobble=0.02)
    N.dress_roof(R, moss=0.15, guards=False, ridge=('steel_galv', (0.55, 0.56, 0.57)), rafters=True,
                 rafter_mid='timber_grey', seed=SEED)
    N.rust_patches(R, seed=SEED)
    # replaced sheets (brighter zinc / darker rust), translucent roof sheets, run-off streaks
    N.roof_patches(R, 'corrugated_galv', (1.0, 1.0, 1.0), fixed=[(0, 0.3, 0.5, 1.8, 3.6), (1, 0.7, 0.5, 1.8, 3.6)],
                   off=0.03, name='sheets_new')
    N.roof_patches(R, 'corrugated_rust', (0.9, 0.85, 0.8), fixed=[(0, 0.72, 0.4, 2.7, 2.6), (1, 0.15, 0.5, 1.8, 3.0)],
                   off=0.028, name='sheets_rust')
    N.roof_decals(R, kinds=(('streak_rust', 0.6, (0.8, 1.4)), ('lichen', 0.35, (1.0, 2.0))), n=10, seed=SEED)
    for lx in (-3.6, 3.6):
        N.skylight(R, lx, -1, w=0.9, h=1.6)
# ridge ventilation louvre
bm = K.bm_new()
K.box_bm(bm, (2.5, 0, R.z_ridge + 0.35), (1.2, 0.9, 0.7))
K.part(bm, 'board_batten', name='vent_box', mat_tint=CT)
K.roof_gable(2.5, 0, 1.6, 1.1, R.z_ridge + 0.7, 35, 'roof_slate' if VAR == 'a' else 'corrugated_galv', eave_oh=0.15,
             gable_oh=0.1, thick=0.05, fascia=None, barge=None, gutters=False, ridge=None, name='vent_roof')
C.A.meta['roofs'].pop()
K.anchor('roof_ridge', (0, 0, R.z_ridge))

# ---- lavebru: earth ramp with dry-stone retaining walls, then a timber bridge to the threshing doors ----------
RW = 3.8
ya, yb = y0 - 9.0, y0 - 2.4                          # ramp from ya (ground) up to yb (at ZS)
def rz(yy):                                          # ramp crown height along y
    return max(0.0, min(1.0, (yy - ya) / (yb - ya))) * (ZS - 0.12)
# sloped dry-stone wing walls: battered outer face, top following the ramp grade, splaying outward at the foot
import bmesh as _bm
def wing_wall(sx):
    bm = K.bm_new()
    nk = 16
    rows = []
    for k in range(nk + 1):
        t = k / nk
        yy = ya - 0.7 + (yb - ya + 0.7) * t
        fl = max(0.0, (ya + 0.4 - yy) / 1.1)                  # splay outward below the ramp foot
        xin = sx * (RW / 2 - 0.5 + 0.9 * fl ** 1.3)
        yy2 = yy - 0.2 * fl
        ztop = max(0.22, rz(yy) + 0.16) * (1 - 0.55 * fl)
        bat = 0.08 + 0.05 * ztop                               # batter: outer face leans in
        wob = 0.03 * math.sin(k * 2.3 + sx)
        ring = [(xin, yy2, -0.12), (xin + sx * (0.62 + wob), yy2, -0.12),
                (xin + sx * (0.62 - bat + wob), yy2, ztop), (xin - sx * 0.02, yy2, ztop + 0.01)]
        rows.append([bm.verts.new(p) for p in ring])
    for k in range(nk):
        for i in range(4):
            j = (i + 1) % 4
            f = (rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i])
            bm.faces.new(f if sx > 0 else tuple(reversed(f)))
    bm.faces.new(tuple(reversed(rows[0]) if sx > 0 else rows[0]))
    bm.faces.new(tuple(rows[-1] if sx > 0 else reversed(rows[-1])))
    _bm.ops.recalc_face_normals(bm, faces=bm.faces)
    return rows, bm
tops = {}
for sx in (-1, 1):
    rows, bm = wing_wall(sx)
    tops[sx] = [((r_[2].co + r_[3].co) / 2) for r_ in rows]
    K.part(bm, 'fieldstone_grey', name='ramp_wall%d' % (sx + 1), grime=1.0, bisect=False)
bm = K.bm_new()                                      # coping slabs laid along the sloping wall head
for sx in (-1, 1):
    tp = tops[sx]
    for k in range(len(tp) - 1):
        a_, b_ = tp[k] + V((0, 0, 0.07)), tp[k + 1] + V((0, 0, 0.07))
        K.beam_bm(bm, a_ + (b_ - a_) * 0.02, b_ - (b_ - a_) * 0.02, 0.56 + r.uniform(-0.04, 0.04), 0.14,
                  roll=r.uniform(-0.04, 0.04))
K.part(bm, 'granite', name='ramp_coping', jitter=0.06)
# earth fill: gravel crown, two wheel ruts, grass verges along the walls
rows = 18
def strip(x0_, x1_, dz, mid, nm, tint=None, ext=0.0):
    b_ = K.bm_new()
    vs = []
    for k in range(rows + 1):
        yy = ya - 0.6 + (yb - ya + 0.6) * k / rows
        z = rz(yy) + dz
        vs.append((b_.verts.new((x0_, yy, z)), b_.verts.new((x1_, yy, z))))
    for k in range(rows):
        b_.faces.new((vs[k][0], vs[k][1], vs[k + 1][1], vs[k + 1][0]))
    kw = {'mat_tint': tint} if tint else {}
    return K.part(b_, mid, name=nm, grime=0.2, bisect=False, **kw)
xs = [-(RW / 2 - 0.52), -1.05, -0.65, 0.65, 1.05, RW / 2 - 0.52]
strip(xs[0], xs[1], 0.05, 'turf_grass', 'ramp_verge_l')
strip(xs[1], xs[2], -0.03, 'mud', 'ramp_rut_l', (0.75, 0.68, 0.6))
strip(xs[2], xs[3], 0.02, 'gravel', 'ramp_crown', (0.8, 0.78, 0.74))
strip(xs[3], xs[4], -0.03, 'mud', 'ramp_rut_r', (0.75, 0.68, 0.6))
strip(xs[4], xs[5], 0.05, 'turf_grass', 'ramp_verge_r')
bm = K.bm_new()                                      # grass tufts along the wall foot and the verges
for k in range(70):
    yy = r.uniform(ya - 0.4, yb)
    sx = r.choice((-1, 1))
    x = sx * r.uniform(RW / 2 - 0.95, RW / 2 - 0.55)
    base = V((x, yy, rz(yy) + 0.04))
    N.pyr(bm, base, base + V((r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), r.uniform(0.15, 0.3))), 0.1, V((1, 0, 0)))
K.part(bm, 'turf_grass', name='ramp_tufts', grime=0, bisect=False)
bm = K.bm_new()                                       # bridge beams + planks
for sx in (-1.3, -0.45, 0.45, 1.3):
    K.box_bm(bm, (sx, (yb + y0) / 2, ZS - 0.22), (0.18, y0 - yb + 0.4, 0.22))
K.part(bm, 'timber_beam', name='bridge_beams', uv='beam', axis=(0, 1, 0))
bm = K.bm_new()
n = int((y0 - yb) / 0.22)
for k in range(n):
    yy = yb + (k + 0.5) * (y0 - yb) / n
    K.box_bm(bm, (r.uniform(-0.03, 0.03), yy, ZS - 0.06), (RW - 0.5 + r.uniform(-0.08, 0.08), 0.2, 0.06))
K.part(bm, 'deck_planks', name='bridge_planks', uv='beam', axis=(1, 0, 0))
for sx in (-1, 1):
    K.railing((sx * (RW / 2 - 0.3), yb, ZS - 0.03), (sx * (RW / 2 - 0.3), y0 - 0.05, ZS - 0.03), 0.95, 'timber')
K.footprint(N.rect(-RW / 2, ya, RW / 2, y0), 'NONE', 'ramp')
K.ladder_meta((0, ya - 0.5), (0, y0 - 0.3), ZS)
K.climb_meta((-RW / 2, ya + 2), (-RW / 2, yb), ZS * 0.6)

for i in range(5):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y1 + 0.001, 0.5), (0, 1, 0), r.uniform(1.6, 2.6), 1.0)
for i in range(3):
    K.decal('efflorescence', (r.uniform(x0 + 1, x1 - 1), y0 - 0.001, r.uniform(0.6, 1.8)), (0, -1, 0), 0.7, 0.5)
if SNOW:
    N.snow(exclude=N.SNOW_EXCLUDE + ('ramp_verge', 'ramp_rut', 'ramp_crown', 'ramp_tufts'))
    N.ramp_snow(ya - 0.6, yb, rz, xs, seed=SEED)
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
