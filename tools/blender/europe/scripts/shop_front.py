"""Village / small-town shop house with a period shop front (France / Belgium 1920-40): two storeys + slate mansard-like
roof with dormers; ground floor timber shop front - pilasters with capitals, deep fascia with painted sign, cornice,
two display windows over panelled stall risers, recessed glazed entrance (interactable door), canvas awning on iron
arms; enamel advertising plates, side-wall painted advert, upper windows with shutters + balconette.
 a = boulangerie (cream render, green shopfront)     b = cafe / estaminet (brick, oxblood shopfront, terrace tables)
 c = epicerie (grey render, blue shopfront, crates of produce)       '-ruin' = shelled / looted
usage: blender -b --python shop_front.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, SHUTTER, DOOR, ruin_pass, compact

OUT, VAR, SEED = args('shop_front_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('shop_front_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
CFG = {'a': dict(wall='plaster_limewash', wt=(1.0, 0.94, 0.82), shop=(0.24, 0.36, 0.28), sign='boulangerie', awn=(0.55, 0.28, 0.22), shut='cream'),
       'b': dict(wall='brick_red', wt=None, shop=(0.42, 0.16, 0.13), sign='estaminet', awn=(0.30, 0.38, 0.30), shut='green'),
       'c': dict(wall='plaster_white', wt=(0.86, 0.87, 0.85), shop=(0.22, 0.30, 0.42), sign='epicerie', awn=(0.62, 0.55, 0.40), shut='grey')}[base]
L, W, T = 7.4, 8.0, 0.45
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
Z1, ZE = 3.9, 6.9
SC = CFG['shop']
# ---- openings ------------------------------------------------------------------------------------------------------
shop = K.opening(poly, 0, L / 2, 5.8, 3.05, 0.0, T, 'rect', 'window')
up = [K.opening(poly, 0, t, 1.1, 1.9, Z1 + 0.55, T) for t in (1.3, L / 2, L - 1.3)]
back = [K.opening(poly, 2, 2.0, 0.9, 1.3, 1.1, T), K.opening(poly, 2, 2.0, 0.9, 1.3, Z1 + 0.8, T), K.opening(poly, 2, 5.2, 0.9, 1.3, Z1 + 0.8, T),
        K.opening(poly, 2, 5.2, 0.95, 2.1, 0.1, T, 'rect', 'door')]
side = [K.opening(poly, 3, 6.0, 0.8, 1.1, Z1 + 0.9, T)]
K.wall_ring(poly, ZE, T, CFG['wall'], [shop] + up + back + side, plinth=('granite', 0.35, 0.03), name='walls', mat_tint=CFG['wt'])
K.quoins(poly, 3.9, ZE, 'ashlar_limestone' if base != 'b' else 'brick_dark', corners=(0, 1))
K.course(poly, Z1 + 0.25, 0.16, 0.05, 'ashlar_limestone', name='band')
K.cornice(poly, ZE - 0.32, 'ashlar_limestone', steps=((0.05, 0.1), (0.12, 0.1), (0.2, 0.12)))
for k, f in enumerate(up):
    K.window(f, 'casement', (2, 3), frame='white', sill='ashlar_limestone', lintel='ashlar_limestone', shutters='open' if k != 1 else 'ajar',
             shutter_color=SHUTTER[CFG['shut']], shutter_style='plank', curtain=0.8, name='wu%d' % k)
K.railing(up[1].p(-0.65, 0.0, 0.25), up[1].p(0.65, 0.0, 0.25), 0.9, 'iron', name='balconette')
for k, f in enumerate(back):
    if f.kind == 'door':
        K.door(f, 'back', 'plank', DOOR['brown'], step=None, lintel=None)
    else:
        K.window(f, 'casement', (1, 2), frame=(0.7, 0.68, 0.64), sill='ashlar_limestone', name='wb%d' % k, streak=False)
K.window(side[0], 'casement', (1, 2), frame='white', sill='ashlar_limestone', name='ws')

# ---- shop front (inside the big opening; local frame of `shop`) ---------------------------------------------------------
F = shop
bm_s = bmesh.new()             # painted joinery
def lb(x0_, x1_, z0_, z1_, d0_, d1_):
    K.lbox(bm_s, F, x0_, x1_, z0_, z1_, d0_, d1_)
hw = F.w / 2
for x in (-hw - 0.25, hw + 0.25):                                            # pilasters + capitals + plinths
    lb(x - 0.25, x + 0.25, 0.0, 3.05, -0.05, 0.12)
    lb(x - 0.32, x + 0.32, 3.0, 3.2, -0.05, 0.2)
    lb(x - 0.3, x + 0.3, 0.0, 0.35, -0.05, 0.17)
lb(-hw - 0.55, hw + 0.55, 3.05, 3.75, -0.05, 0.14)                           # fascia
lb(-hw - 0.65, hw + 0.65, 3.75, 3.85, -0.05, 0.3)                            # cornice
lb(-hw - 0.6, hw + 0.6, 3.85, 3.92, -0.05, 0.25)
DX = hw - 1.3                                                                # recessed door on the right
for (xa, xb) in ((-hw, DX - 0.55),):
    lb(xa, xb, 0.0, 0.65, -0.35, -0.1)                                       # stall riser (panelled)
    for k in range(3):
        xx = xa + (k + 0.5) * (xb - xa) / 3
        lb(xx - (xb - xa) / 7, xx + (xb - xa) / 7, 0.14, 0.52, -0.1, -0.07)
    lb(xa, xb, 0.65, 0.75, -0.38, -0.08)                                     # sill
    n = 3
    for k in range(n + 1):                                                   # mullions
        xx = xa + k * (xb - xa) / n
        lb(xx - 0.05, xx + 0.05, 0.7, 2.95, -0.3, -0.2)
    lb(xa, xb, 2.35, 2.45, -0.3, -0.2)                                       # transom
    lb(xa, xb, 2.9, 3.05, -0.32, -0.15)
    gl = bmesh.new()
    q = [F.p(xa, 0.75, -0.26), F.p(xb, 0.75, -0.26), F.p(xb, 2.95, -0.26), F.p(xa, 2.95, -0.26)]
    gl.faces.new([gl.verts.new(p) for p in q])
    K.part(gl, 'glass_dirty', name='shop_glass', grime=0.2, bisect=False)
    ib = bmesh.new()
    q = [F.p(xa, 0.7, -0.95), F.p(xb, 0.7, -0.95), F.p(xb, 2.9, -0.95), F.p(xa, 2.9, -0.95)]
    ib.faces.new([ib.verts.new(p) for p in q])
    K.part(ib, 'interior_dark', name='shop_interior', grime=0.0, bisect=False)
    sh = bmesh.new()                                                         # display shelves + goods
    for z in (0.95, 1.45):
        K.lbox(sh, F, xa + 0.1, xb - 0.1, z, z + 0.04, -0.75, -0.35)
    for k in range(9):
        xx = xa + 0.3 + k * (xb - xa - 0.6) / 8
        K.lbox(sh, F, xx - 0.1, xx + 0.1, 0.99 + (k % 2) * 0.5, 1.15 + (k % 2) * 0.5, -0.65, -0.45)
    K.part(sh, 'wood_paint', name='shelves', mat_tint=(0.7, 0.55, 0.35))
# recess side walls + entrance door
lb(DX - 0.55, DX - 0.45, 0.0, 3.05, -0.95, -0.1)
lb(DX + 0.45, hw, 0.0, 3.05, -0.95, -0.1)
lb(DX - 0.55, DX + 0.55, 2.35, 3.05, -0.95, -0.85)
K.part(bm_s, 'wood_paint', name='shopfront', mat_tint=SC)
ent = K.Frame(F.p(DX, 0.0, -0.95), F.n, F.r, 0.9, 2.3, 0.1, 'rect', 'door')
K.door(ent, 'shop', 'glazed', SC, step=None, lintel=None)
K.P('granite', K.box_bm, tuple(F.p(DX, -0.03, -0.45)), (1.0, 1.0, 0.06), name='threshold')
K.sign(tuple(F.p(0, 3.4, 0.16)), tuple(F.n), 3.8, CFG['sign'], board='wood_paint')
# awning: canvas on iron arms, valance
aw0, aw1, zt = -hw - 0.3, hw + 0.3, 3.0
depth = 1.6 if not RUIN else 0.0
if depth > 0:
    cv = bmesh.new()
    q = [F.p(aw0, zt, 0.15), F.p(aw1, zt, 0.15), F.p(aw1, zt - 0.7, depth), F.p(aw0, zt - 0.7, depth)]
    cv.faces.new([cv.verts.new(p) for p in q])
    cv.faces.new([cv.verts.new(p + V((0, 0, -0.01))) for p in reversed(q)])
    q2 = [F.p(aw0, zt - 0.7, depth), F.p(aw1, zt - 0.7, depth), F.p(aw1, zt - 1.0, depth + 0.01), F.p(aw0, zt - 1.0, depth + 0.01)]
    cv.faces.new([cv.verts.new(p) for p in q2])
    cv.faces.new([cv.verts.new(p + F.n * -0.01) for p in reversed(q2)])
    K.part(cv, 'curtain', name='awning', mat_tint=CFG['awn'], grime=0.4, bisect=False)
    ir = bmesh.new()
    for x in (aw0 + 0.1, 0.0, aw1 - 0.1):
        K.beam_bm(ir, F.p(x, zt - 0.9, 0.12), F.p(x, zt - 0.72, depth - 0.02), 0.025, 0.025)
    K.cyl_bm(ir, F.p(aw0, zt - 0.7, depth), F.p(aw1, zt - 0.7, depth), 0.03, 6)
    K.cyl_bm(ir, F.p(aw0, zt + 0.02, 0.18), F.p(aw1, zt + 0.02, 0.18), 0.07, 8)
    K.part(ir, 'cast_iron', name='awning_iron')
# enamel plates + lantern
K.decal('poster_fr', tuple(F.p(-hw - 0.25, 1.9, 0.125)), tuple(F.n), 0.42, 0.6, alpha=0.95)
K.decal('poster_fr', tuple(F.p(hw + 0.25, 1.9, 0.125)), tuple(F.n), 0.42, 0.6, alpha=0.95)
K.wall_lantern((x1 - 0.6, y0, 0), (0, -1, 0), 4.5)
K.decal('poster_fr', (x0 - 0.01, -1.0, 4.8), (-1, 0, 0), 4.0, 2.6, alpha=0.55)                # ghost-sign advert on the gable
# ---- roof ------------------------------------------------------------------------------------------------------------
R = K.roof_gable(0, 0, L, W, ZE, 55, 'roof_slate', eave_oh=0.3, gable_oh=0.1, thick=0.13, fascia=None, barge=None, gutters=True,
                 sag=0.03, wobble=0.01)
K.gable(poly, 1, ZE, R.z_ridge - R.lift, T, CFG['wall'], name='gable_e', mat_tint=CFG['wt'])
K.gable(poly, 3, ZE, R.z_ridge - R.lift, T, CFG['wall'], name='gable_w', mat_tint=CFG['wt'])
for lx in (-1.8, 1.8):
    K.dormer(R, lx, -1, 1.0, 1.25, wall='plaster_white', roof='roof_slate',
             window_kw=dict(style='casement', panes=(2, 2), frame='white', sill=None, streak=False, curtain=0.5))
K.chimney(x1 - 0.45, 1.0, ZE, R.z_ridge + 0.8, 0.8, 0.55, 'brick_red', cap='ashlar', pots=2)
K.anchor('roof_ridge', (0, 0, R.z_ridge))
# ---- street furniture ----------------------------------------------------------------------------------------------------
bm = bmesh.new()
if base == 'b':      # cafe terrace: 3 tables, 8 chairs, A-board
    for k, tx in enumerate((-2.4, -0.6, 1.2)):
        c = V((tx, y0 - 1.6, 0))
        K.cyl_bm(bm, c + V((0, 0, 0.72)), c + V((0, 0, 0.75)), 0.35, 12)
        K.cyl_bm(bm, c, c + V((0, 0, 0.72)), 0.03, 6)
        K.cyl_bm(bm, c, c + V((0, 0, 0.03)), 0.22, 8)
        for a in (0.3 + k, 2.2 + k, 4.0 + k):
            if r.random() < 0.8:
                p = c + V((math.cos(a) * 0.62, math.sin(a) * 0.62, 0))
                K.box_bm(bm, tuple(p + V((0, 0, 0.45))), (0.38, 0.38, 0.03), a)
                for dx, dy in ((-0.16, -0.16), (0.16, -0.16), (-0.16, 0.16), (0.16, 0.16)):
                    K.cyl_bm(bm, p + V((dx, dy, 0)), p + V((dx, dy, 0.45)), 0.012, 4)
                d = (c - p).normalized()
                K.box_bm(bm, tuple(p - d * 0.18 + V((0, 0, 0.72))), (0.36, 0.03, 0.5), math.atan2(d.y, d.x) + math.pi / 2)
    K.part(bm, 'steel_painted', name='terrace', mat_tint=(0.35, 0.4, 0.33))
    K.footprint_rect(-0.6, y0 - 1.6, 5.0, 1.8, block='LOW', kind='terrace')
elif base == 'c':    # produce crates on trestles
    for k in range(5):
        K.box_bm(bm, (-2.4 + k * 0.6, y0 - 0.55, 0.62), (0.55, 0.4, 0.22), r.uniform(-0.05, 0.05))
    K.part(bm, 'door_planks', name='crates', uv='beam', axis=(1, 0, 0), tint=(0.85, 0.75, 0.6))
    bm = bmesh.new()
    for k in range(5):
        K.box_bm(bm, (-2.4 + k * 0.6, y0 - 0.55, 0.76), (0.5, 0.35, 0.08))
    K.part(bm, 'curtain', name='produce', mat_tint=(0.45, 0.5, 0.25), grime=0.2)
    bm = bmesh.new()
    for x in (-2.6, 0.0):
        K.beam_bm(bm, (x - 0.2, y0 - 0.55, 0), (x, y0 - 0.55, 0.5), 0.05, 0.05)
        K.beam_bm(bm, (x + 0.2, y0 - 0.55, 0), (x, y0 - 0.55, 0.5), 0.05, 0.05)
    K.beam_bm(bm, (-2.9, y0 - 0.55, 0.5), (0.3, y0 - 0.55, 0.5), 0.45, 0.04)
    K.part(bm, 'timber_grey', name='trestles', uv='beam', axis=(1, 0, 0))
    K.footprint_rect(-1.2, y0 - 0.55, 3.4, 0.6, block='LOW', kind='stall')
else:                # bakery: bench + bicycle-less barrels
    for k in range(2):
        K.cyl_bm(bm, (-2.8 + k * 0.7, y0 - 0.45, 0), (-2.8 + k * 0.7, y0 - 0.45, 0.8), 0.3, 12, r1=0.28)
    K.part(bm, 'timber_beam', name='barrels', uv='beam', axis=(0, 0, 1), tint=(0.7, 0.55, 0.4))
    K.footprint_rect(-2.45, y0 - 0.45, 1.4, 0.7, block='LOW', kind='barrels')
for i in range(3):
    K.decal('damp_base', (r.uniform(x0 + 0.5, x1 - 0.5), y1 + 0.01, 0.5), (0, 1, 0), 2.0, 0.9)
    K.decal('streak_rain', (r.uniform(x0 + 0.5, x1 - 0.5), y0 - 0.01, ZE - 0.9), (0, -1, 0), 0.6, 1.4, alpha=0.5)
if RUIN:
    ruin_pass(hits=[((x1 - 1.5, y0, 5.5), 2.0, (1.2, 1.1, 1.3)), ((-1.0, 0.5, ZE + 1.5), 2.2, (1.3, 1.6, 1.0))],
              rubble_at=[((1.5, y0 - 1.5, 0), 1.8, 0.7)], holes=[(-1.5, -W * 0.2, 1.4), (1.5, W * 0.22, 1.2)], R=R,
              mids=(CFG['wall'] if base == 'b' else 'fieldstone', 'ashlar_limestone'))
compact()
K.finalize(OUT, ao_res=1024, ao_samples=64)
