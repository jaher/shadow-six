"""HQ villa (M4 Stokkan/Trondheim; also usable as a generic Kommandantur): c. 1905 red-brick Nordic villa, two
storeys + attic. Granite plinth, limestone quoins / string course / window surrounds, segmental ground-floor arches,
projecting central risalit with a cross gable and oculus, pillared porch carrying an iron-railed balcony, corner tower
with a steep pyramidal spire and finial, slate hip roof with dormers, chimneys, gutters, flag pole, sentry box, signs.
Variants: a (red brick), b (dark brick, white trim), snow (Norway, a + snow), destroyed (shelled: blast holes,
roof holes, rubble, soot). Usage: blender -b --factory-startup --python villa_hq.py -- [a|b|snow|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 51)
K.begin('villa_hq' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='snow' if VAR == 'snow' else 'temperate', snow=VAR == 'snow')
r = K.rng()
DEAD = VAR == 'destroyed'
BRICK = 'brick_dark' if VAR == 'b' else 'brick_red'
TRIM = 'ashlar_limestone'
PLINTH = 'granite'
FRAME = 'white' if VAR == 'b' else 'cream'
SHUT = (0.3, 0.36, 0.3) if VAR != 'b' else (0.25, 0.25, 0.26)
T = 0.5
ZP, Z1, ZE = 0.6, 3.75, 7.3                  # plinth top (ground floor level), first floor, eave
main = [(-8, -5.5), (8, -5.5), (8, 5.5), (-8, 5.5)]
ris = [(-2.6, -6.8), (2.6, -6.8), (2.6, -5.3), (-2.6, -5.3)]
tow = [(4.9, -6.2), (8.7, -6.2), (8.7, -2.4), (4.9, -2.4)]
ZT = 10.6                                    # tower wall top

# ------------------------------------------------------------------ openings
def win(poly, e, t, lvl, w=1.05, shape=None):
    sill, h = ((ZP + 0.75, 2.05) if lvl == 0 else (Z1 + 0.85, 1.85)) if lvl < 2 else (ZE + 0.55, 1.5)
    return K.opening(poly, e, t, w, h, sill, T, shape or ('segment' if lvl == 0 else 'rect'))
fm, fr_, ft = [], [], []
for t in (1.7, 4.0):
    fm += [win(main, 0, t, 0), win(main, 0, t, 1)]
for t in (4.5, 7.2, 9.6):
    fm += [win(main, 1, t, 0), win(main, 1, t, 1)]
for t in (2.0, 4.9, 11.1, 14.0):
    fm += [win(main, 2, t, 0), win(main, 2, t, 1)]
back_door = K.opening(main, 2, 8.0, 1.2, 2.3, ZP, T, 'segment', 'door')
fm.append(back_door)
for t in (2.5, 5.5, 8.5):
    fm += [win(main, 3, t, 0), win(main, 3, t, 1)]
front_door = K.opening(ris, 0, 2.6, 1.5, 2.75, ZP, T, 'arch', 'door')
bal_door = K.opening(ris, 0, 2.6, 1.3, 2.35, Z1 + 0.15, T, 'rect', 'door')
fr_ += [front_door, bal_door, win(ris, 0, 0.95, 0, 0.85), win(ris, 0, 4.25, 0, 0.85), win(ris, 0, 0.95, 1, 0.85), win(ris, 0, 4.25, 1, 0.85)]
for e in (0, 1):
    ft += [win(tow, e, 1.9, 0, 1.0), win(tow, e, 1.9, 1, 1.0)]
for e in range(4):
    ft.append(K.opening(tow, e, 1.9, 0.9, 1.55, ZE + 0.7, T, 'arch'))

# ------------------------------------------------------------------ walls, trims
K.wall_ring(main, ZE, T, BRICK, fm, plinth=(PLINTH, ZP, 0.06), name='walls_main')
K.wall_ring(ris, ZE, T, BRICK, fr_, plinth=(PLINTH, ZP, 0.06), name='walls_risalit')
K.wall_ring(tow, ZT, T, BRICK, ft, plinth=(PLINTH, ZP, 0.06), name='walls_tower')
for poly, nm, zt in ((main, 'main', ZE), (ris, 'ris', ZE), (tow, 'tow', ZT)):
    if nm != 'ris':                          # dressed quoins on the camera-facing (south) corners only
        K.quoins(poly, ZP, zt - 0.3, TRIM, name='quoins_' + nm, block_h=0.52, long=0.55, short=0.32, corners=(0, 1))
    K.course(poly, Z1 - 0.1, 0.22, 0.07, TRIM, name='course_' + nm)
    K.cornice(poly, zt - 0.45, TRIM, steps=((0.05, 0.12), (0.12, 0.1), (0.22, 0.14)), name='cornice_' + nm)
K.course(tow, ZE + 0.2, 0.2, 0.07, TRIM, name='course_tow2')
# windows
for k, f in enumerate(fm + fr_ + ft):
    if f.kind == 'door':
        continue
    top = f.o.z > ZE
    if f.n.x > 0.5 and not top and VAR not in ('snow', 'destroyed'):   # east facade: sills + lintels only
        K.window(f, 'casement', (1, 3) if f.o.z < Z1 else (1, 2), frame=FRAME, sill=TRIM, lintel=TRIM, surround=None,
                 shutters=None if (f.o.z < Z1 or VAR == 'b') else 'open', shutter_color=SHUT, curtain=0.7, name='w%d' % k)
        continue
    if f.n.y > 0.5 or f.n.x < -0.5 or (f.n.x > 0.5 and VAR in ('snow', 'destroyed')):   # facades away from the camera: plainer
        K.window(f, 'fixed', (1, 2), frame=FRAME, sill=TRIM, lintel=TRIM, surround=None, shutters=None, curtain=0.6, name='w%d' % k)
        continue
    K.window(f, 'casement' if not top else 'fixed', (1, 3) if f.o.z < Z1 else (1, 2), frame=FRAME, sill=TRIM,
             lintel=TRIM if f.shape == 'rect' else TRIM, surround=TRIM if not top else None,
             shutters=None if (top or f.o.z < Z1 or VAR == 'b') else ('open' if k % 4 else 'ajar'),
             shutter_color=SHUT, shutter_style='plank', curtain=0.8, name='w%d' % k)
K.door(front_door, 'front', 'double', (0.28, 0.2, 0.14), surround=TRIM, lintel=TRIM, step=None)
K.door(bal_door, 'balcony', 'glazed', FRAME, surround=None, lintel=TRIM, step=None)
K.door(back_door, 'back', 'panel', (0.3, 0.33, 0.3), lintel=TRIM, step=PLINTH)
# oculus in the risalit gable
Ris = K.roof_gable(0, -3.8, 6.2, 5.2, ZE, 50, 'roof_slate', rot=math.pi / 2, eave_oh=0.35, gable_oh=0.3, thick=0.14,
                   fascia=None, barge='timber_beam', gutters=False, sag=0.02, wobble=0.01, name='roof_ris')
ocu = K.opening(ris, 0, 2.6, 0.9, 0.9, ZE + 0.55, T, 'arch')
K.gable(ris, 0, ZE, Ris.z_ridge - Ris.lift, T, BRICK, [ocu], name='gable_ris')
K.window(ocu, 'fixed', (2, 2), frame=FRAME, sill=TRIM, lintel=TRIM, streak=True, name='oculus')
K.course(ris, ZE, 0.18, 0.08, TRIM, name='gable_foot')
R = K.roof_hip(0, 0, 16, 11, ZE, 40, 'roof_slate', eave_oh=0.5, thick=0.14, fascia='timber_beam', sag=0.03, wobble=0.012)
Rt = K.roof_hip(6.8, -4.3, 3.8 + 0.7, 3.8, ZT, 64, 'roof_slate', eave_oh=0.35, thick=0.1, fascia='timber_beam', gutters=False,
                sag=0.0, wobble=0.004, name='roof_tower')
for lx, side in ((-4.8, -1), (3.2, 1))[:1 if VAR == 'snow' else 2]:
    K.dormer(R, lx, side, 1.3, 1.45, wall=BRICK, roof='roof_slate', pitch=55,
             window_kw=dict(style='casement', panes=(1, 2), frame=FRAME, sill=None, streak=False, curtain=0.5))
K.chimney(-1.6, 1.4, ZE, R.z_ridge + 0.9, 0.9, 0.7, BRICK, cap=TRIM, pots=2)
K.chimney(3.4, 2.4, ZE, R.z_ridge + 0.4, 0.8, 0.6, BRICK, cap=TRIM, pots=1)
K.chimney(-6.2, -1.0, ZE, R.z_ridge - 0.2, 0.7, 0.6, BRICK, cap=TRIM, pots=1)
bm = bmesh.new()                                               # tower finial + flag pole, ridge crestings
apex = V((6.8, -4.3, Rt.z_ridge))
K.cyl_bm(bm, apex - V((0, 0, 0.2)), apex + V((0, 0, 0.35)), 0.09, 8)
K.cyl_bm(bm, apex + V((0, 0, 0.35)), apex + V((0, 0, 0.5)), 0.13, 8, r1=0.02)
if not DEAD:
    K.cyl_bm(bm, apex + V((0, 0, 0.5)), apex + V((0, 0, 3.6)), 0.035, 6)
    K.cyl_bm(bm, apex + V((0, 0, 3.6)), apex + V((0, 0, 3.72)), 0.06, 6)
K.part(bm, 'cast_iron', name='finial', bisect=False)
if not DEAD:
    K.anchor('flag', tuple(apex + V((0.05, 0, 3.5))), (1, 0, 0), kind='flag', w=1.8, h=1.2)

# ------------------------------------------------------------------ porch: landing, steps, columns, balcony over it
bm = bmesh.new()
K.box_bm(bm, (0, -7.7, ZP / 2 - 0.03), (3.8, 1.8, ZP + 0.06))
K.part(bm, PLINTH, name='porch_landing')
K.stairs((0, -9.45, 0), (0, 1, 0), 2.6, ZP, 3, PLINTH, name='porch_steps')
bm = bmesh.new()
for s in (-1, 1):
    b = V((s * 1.55, -8.35, ZP))
    K.box_bm(bm, tuple(b + V((0, 0, 0.12))), (0.46, 0.46, 0.24))
    K.cyl_bm(bm, b + V((0, 0, 0.24)), b + V((0, 0, Z1 - ZP - 0.3)), 0.17, 12, r1=0.145)
    K.box_bm(bm, tuple(b + V((0, 0, Z1 - ZP - 0.18))), (0.42, 0.42, 0.18))
K.part(bm, TRIM, name='porch_columns', smooth=True)
bm = bmesh.new()                                               # balcony slab on the columns + moulded edge
K.box_bm(bm, (0, -7.7, Z1 + 0.07), (3.9, 1.85, 0.22))
K.box_bm(bm, (0, -7.72, Z1 - 0.09), (3.7, 1.75, 0.12))
K.part(bm, TRIM, name='balcony_slab')
ZB = Z1 + 0.18
for a_, b_ in (((-1.85, -6.85), (-1.85, -8.55)), ((-1.85, -8.55), (1.85, -8.55)), ((1.85, -8.55), (1.85, -6.85))):
    K.railing((a_[0], a_[1], ZB), (b_[0], b_[1], ZB), 1.0, 'iron', spacing=0.18, name='bal_rail')
K.roof_meta([(-1.9, -8.6), (1.9, -8.6), (1.9, -6.8), (-1.9, -6.8)], ZB, walkable=True, kind='balcony')
K.sign((3.75, -5.5, 2.35), (0, -1, 0), 1.2, 'kommandantur', 'timber_grey')

# ------------------------------------------------------------------ sentry box (Schilderhaus) with diagonal black-white-red chevrons
def clip(poly, a, b, c):
    """keep part of 2D poly with a*x+b*y <= c"""
    out = []
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        fp, fq = a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c
        if fp <= 0:
            out.append(p)
        if fp * fq < 0:
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out
SB = V((-4.0, -8.6, 0))
cols = [(0.13, 0.13, 0.13), (0.82, 0.8, 0.76), (0.55, 0.12, 0.1)]
bands = {i: bmesh.new() for i in range(3)}
for face in range(3):                                   # left, back, right walls (open front)
    w, h = 0.95, 2.1
    base = [(0, 0), (w, 0), (w, h), (0, h)]
    for k in range(-6, 12):
        c0, c1 = k * 0.3, (k + 1) * 0.3
        pl = clip(clip(base, 1, -1, c1), -1, 1, -c0)       # band c0 <= x - y... sloped stripes
        if len(pl) < 3:
            continue
        if face == 0:
            pts = [SB + V((-w / 2, -w / 2 + x, z + 0.1)) for x, z in pl]
        elif face == 1:
            pts = [SB + V((-w / 2 + x, w / 2, z + 0.1)) for x, z in pl]
        else:
            pts = [SB + V((w / 2, w / 2 - x, z + 0.1)) for x, z in pl]
        bb = bands[k % 3]
        vs = [bb.verts.new(p) for p in pts]
        f = bb.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bb, geom=[f])
        nrm = [(1, 0, 0), (0, -1, 0), (-1, 0, 0)][face]
        for v in [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]:
            v.co += V(nrm) * -0.04
for i, bb in bands.items():
    bmesh.ops.recalc_face_normals(bb, faces=bb.faces)
    K.part(bb, 'wood_paint', name='sentry_band%d' % i, mat_tint=cols[i], grime=0.4, bisect=False)
bm = bmesh.new()
K.box_bm(bm, tuple(SB + V((0, 0, 0.05))), (1.1, 1.1, 0.1))
K.hexa_bm(bm, [SB + V((x, y, 2.2)) for x, y in ((-0.62, -0.7), (0.62, -0.7), (0.62, 0.62), (-0.62, 0.62))] +
          [SB + V((x * 0.1, y * 0.1, 2.75)) for x, y in ((-0.62, -0.7), (0.62, -0.7), (0.62, 0.62), (-0.62, 0.62))])
K.part(bm, 'timber_tarred', name='sentry_roof')
K.anchor('sentry', tuple(SB), (0, -1, 0), kind='guard_post')

# ------------------------------------------------------------------ weathering, damage, metadata
for i in range(8):
    K.decal('moss_patch', (r.uniform(-7, 7), 5.51, r.uniform(0.2, 0.5)), (0, 1, 0), r.uniform(0.8, 1.6), 0.5)
for x in (-7.4, 7.4):
    K.decal('streak_long', (x, -5.51, ZE - 1.2), (0, -1, 0), 0.8, 2.0, alpha=0.5)
K.decal('efflorescence', (-5.2, -5.51, 0.9), (0, -1, 0), 1.5, 0.8, alpha=0.5)
if DEAD:
    K.bite((6.9, -6.2, 9.3), 1.8, (1.2, 1.0, 1.1), seed=4)
    K.bite((-5.6, -5.5, 4.4), 1.7, (1.2, 1.0, 1.3), seed=7)
    K.bite((8.0, 3.0, 2.0), 1.4, (1.0, 1.2, 1.2), seed=9)
    K.roof_holes(R, [(-3.5, -3.0, 2.2), (2.5, 2.5, 2.6), (-6.0, 1.5, 1.6)])
    M.rubble((-5.6, -7.2, 0.05), 2.6, 1.1, mids=(BRICK, TRIM), n=18, beams=4, tiles='roof_slate', mound_tint=(0.86, 0.74, 0.66))
    M.rubble((7.4, -7.4, 0.05), 2.0, 0.8, mids=(BRICK, 'roof_slate'), n=16, beams=2, tiles='roof_slate')
    K.scorch_openings(1.1, 0.7)
    K.anchor('fire', (-3.0, 2.0, ZE), kind='fire_large')
K.anchor('roof_ridge', (0, 0, R.z_ridge))
if VAR == 'snow':
    K.snow_pass(thick=0.1, min_area=0.5)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48)
