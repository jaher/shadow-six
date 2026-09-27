"""Fuel depot shed (M8 'Pyrotechnics' depot, M9/M11 camps; a demolition target): open-sided shed on timber posts
with knee braces and king-post trusses, corrugated-iron gable roof, back wall and one gable clad with corrugated
sheet, concrete bund slab with kerb, 200 l drums stacked on timber skids (pyramid rows) and upright, jerrycan
stacks, hand pump on a drum, fire point (sand buckets + beaters), sandbag blast walls, spill stains, sign.
destroyed: roof blown off (sheets scattered/bent), posts snapped/leaning, burst blackened drums, scorch + crater.
Usage: blender -b --python fuel_depot.py -- outdir [intact|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'intact'
DEST = VAR == 'destroyed'
SEED = int(av[2]) if len(av) > 2 else 101
K.begin('fuel_depot' + ('_destroyed' if DEST else ''), SEED, theater='desert')
r = K.rng()
L, W, HP, PITCH = 12.0, 6.0, 3.0, 14.0
TIM = 'timber_beam'
TT = (0.85, 0.75, 0.6)
DR = [(0.36, 0.4, 0.3), (0.45, 0.42, 0.3), (0.5, 0.2, 0.15), (0.55, 0.52, 0.42)]     # olive, sand, red (petrol), grey


def drum_lo(bm, c, lying=False, axis=(1, 0, 0), r_=0.29, h=0.88):
    c = V(c)
    if lying:
        ax = V(axis).normalized()
        a, b = c - ax * h / 2 + V((0, 0, r_)), c + ax * h / 2 + V((0, 0, r_))
    else:
        a, b = c, c + V((0, 0, h))
    d = (b - a).normalized()
    C.cyl_bm(bm, a, b, r_, 10)
    for t in (0.33, 0.66):
        m = a + (b - a) * t
        C.cyl_bm(bm, m - d * 0.015, m + d * 0.015, r_ + 0.012, 10, caps=False)


# ---------------- slab + bund kerb
bm = dz.bmesh.new()
C.prism_bm(bm, [(-L / 2 - 0.4, -W / 2 - 0.4), (L / 2 + 0.4, -W / 2 - 0.4), (L / 2 + 0.4, W / 2 + 0.4), (-L / 2 - 0.4, W / 2 + 0.4)], -0.05, 0.1)
K.part(bm, 'concrete_slab', name='slab', mat_tint=(0.97, 0.93, 0.86), grime=0.8)
bm = dz.bmesh.new()
kp = [(-L / 2 - 0.4, -W / 2 - 0.4), (L / 2 + 0.4, -W / 2 - 0.4), (L / 2 + 0.4, W / 2 + 0.4), (-L / 2 - 0.4, W / 2 + 0.4)]
KA.ring_bm(bm, kp, C.poly_offset(kp, -0.2), 0.1, 0.3)
bm = KA.boolean_cut(bm, [K.opening(kp, 0, L / 2 + 0.4, 3.0, 1.0, 0.0, 0.2)])
K.part(bm, 'concrete_formwork', name='kerb', mat_tint=(0.95, 0.92, 0.86))
# ---------------- structure
posts = [(x, y) for x in [-L / 2 + k * L / 4 for k in range(5)] for y in (-W / 2, W / 2)]
bm, bb = dz.bmesh.new(), dz.bmesh.new()
broken = set()
if DEST:
    broken = {i for i in range(len(posts)) if r.random() < 0.45}
for i, (x, y) in enumerate(posts):
    if i in broken:
        h = r.uniform(0.6, 1.8)
        C.box_bm(bm, (x, y, h / 2 + 0.1), (0.16, 0.16, h))
        lean = V((r.uniform(-1, 1), r.uniform(-1, 1), 0)).normalized() * r.uniform(1.2, 2.2)
        C.beam_bm(bm, V((x, y, 0.15)) + lean * 0.2, V((x, y, 0.35)) + lean + V((0, 0, 0.1)), 0.15, 0.15)
        continue
    C.box_bm(bm, (x, y, HP / 2 + 0.1), (0.16, 0.16, HP))
    s = 1 if y < 0 else -1
    for dx in (-1, 1):        # knee braces
        if -L / 2 <= x + dx * 0.8 <= L / 2:
            C.beam_bm(bm, (x, y, HP - 0.8), (x + dx * 0.8, y, HP + 0.02), 0.1, 0.08)
if not DEST:
    for y in (-W / 2, W / 2):
        C.beam_bm(bm, (-L / 2 - 0.1, y, HP + 0.1), (L / 2 + 0.1, y, HP + 0.1), 0.18, 0.2)          # wall plates
    rise = W / 2 * math.tan(math.radians(PITCH))
    for x in [-L / 2 + k * L / 4 for k in range(5)]:        # king-post trusses
        C.beam_bm(bm, (x, -W / 2 - 0.1, HP + 0.2), (x, W / 2 + 0.1, HP + 0.2), 0.12, 0.16)
        C.beam_bm(bm, (x, -W / 2 - 0.3, HP + 0.18), (x, 0, HP + 0.2 + rise), 0.12, 0.14)
        C.beam_bm(bm, (x, W / 2 + 0.3, HP + 0.18), (x, 0, HP + 0.2 + rise), 0.12, 0.14)
        C.beam_bm(bm, (x, 0, HP + 0.2), (x, 0, HP + 0.2 + rise), 0.1, 0.1)
        for s in (-1, 1):
            C.beam_bm(bm, (x, 0, HP + 0.25), (x, s * W / 4, HP + 0.2 + rise / 2), 0.08, 0.08)
    for yy in (-W / 2 + 0.6, -W / 4, 0.0, W / 4, W / 2 - 0.6):       # purlins
        z = HP + 0.2 + rise * (1 - abs(yy) / (W / 2)) + 0.12
        C.beam_bm(bb, (-L / 2 - 0.4, yy, z), (L / 2 + 0.4, yy, z), 0.08, 0.1)
K.part(bm, TIM, name='frame', uv='beam', axis=(0, 0, 1), mat_tint=TT)
if bb.verts:
    K.part(bb, TIM, name='purlins', uv='beam', axis=(1, 0, 0), mat_tint=TT)
else:
    bb.free()
for (x, y) in posts:
    K.footprint_rect(x, y, 0.3, 0.3, 0, 'HIGH', 'post')
RISE = W / 2 * math.tan(math.radians(PITCH))
ZE, ZR = HP + 0.22, HP + 0.2 + RISE + 0.22          # sheet line at the eave / ridge


def roof_sheets(ok=lambda i, s: True):
    """Real corrugated sheets (0.15 m 'big six' profile, visible at the eaves), 0.9 m wide, lapped, galvanised with
    some rusty replacements; bent ridge flashing."""
    bg, brs = dz.bmesh.new(), dz.bmesh.new()
    for s in (-1, 1):
        for i in range(15):
            if not ok(i, s):
                continue
            x0 = -L / 2 - 0.45 + i * 0.86
            o = V((x0, s * (W / 2 + 0.45), ZE - 0.45 * math.tan(math.radians(PITCH)) + 0.004 * (i % 2)))
            top = V((x0, 0.0, ZR + 0.004 * (i % 2)))
            dz.corrugated_bm(brs if (i * 7 + (s > 0) * 3) % 5 == 0 else bg, o, (1, 0, 0), top - o, 0.9, (top - o).length, 0.15, 0.022)
    K.part(bg, 'corrugated_galv', name='roof_galv', uv='beam', axis=(0, 1, 0), grime=0.5, bisect=False, uv_scale=2.0)
    if brs.verts:
        K.part(brs, 'corrugated_rust', name='roof_rust', uv='beam', axis=(0, 1, 0), grime=0.5, bisect=False, uv_scale=2.0)
    bm = dz.bmesh.new()
    for s in (-1, 1):
        C.beam_bm(bm, (-L / 2 - 0.45, s * 0.12, ZR + 0.01), (L / 2 + 0.45, s * 0.12, ZR + 0.01), 0.26, 0.012, roll=s * math.radians(PITCH))
    K.part(bm, 'corrugated_galv', name='ridge_flash', grime=0.4)


if not DEST:
    roof_sheets()
    C.roof_meta([(-L / 2 - 0.45, -W / 2 - 0.45), (L / 2 + 0.45, -W / 2 - 0.45), (L / 2 + 0.45, W / 2 + 0.45), (-L / 2 - 0.45, W / 2 + 0.45)], ZE, walkable=False, kind='gable')
    bm = dz.bmesh.new()      # east gable: framing + corrugated cladding in the triangle
    for yy in (-W / 4, 0.0, W / 4):
        C.beam_bm(bm, (L / 2, yy, HP + 0.2), (L / 2, yy, HP + 0.2 + RISE * (1 - abs(yy) / (W / 2))), 0.08, 0.08)
    K.part(bm, TIM, name='gable_studs', uv='beam', axis=(0, 0, 1), mat_tint=TT)
    bm = dz.bmesh.new()
    for k in range(6):
        y0 = -W / 2 + k * 1.0
        zt = HP + 0.2 + RISE * (1 - max(abs(y0), abs(y0 + 1.0)) / (W / 2))
        dz.corrugated_bm(bm, (L / 2 + 0.1, y0, HP + 0.2), (0, 1, 0), (0, 0, 1), 1.02, max(0.1, zt - HP - 0.2), 0.15, 0.02, under=True)
    K.part(bm, 'corrugated_galv', name='gable_clad', uv='beam', axis=(0, 0, 1), grime=0.6, bisect=False, uv_scale=2.0)
# ---------------- cladding: back wall (north) full height corrugated sheet on rails, east wall half clad
bm, bmr = dz.bmesh.new(), dz.bmesh.new()
rails = dz.bmesh.new()
for k in range(12):
    x0 = -L / 2 + k * 1.0
    if DEST and r.random() < 0.5:
        continue
    zt = HP + 0.1 if not DEST else r.uniform(1.0, 2.6)
    dz.corrugated_bm(bmr if k % 4 == 1 else bm, (x0 - 0.02, W / 2 + 0.12, 0.25), (1, 0, 0), (0, 0.02 if not DEST else r.uniform(0.05, 0.3), 1), 1.04, zt - 0.25, 0.15, 0.02,
                     under=True, bend=0.0 if not DEST else r.uniform(-0.2, 0.1))
for z in (0.7, 1.8, 2.8):
    C.beam_bm(rails, (-L / 2, W / 2 + 0.03, z), (L / 2, W / 2 + 0.03, z), 0.08, 0.1)
for k in range(6):
    y0 = -W / 2 + k * 1.0
    if DEST and r.random() < 0.6:
        continue
    dz.corrugated_bm(bm, (L / 2 + 0.12, y0 - 0.02, 0.25), (0, 1, 0), (0, 0, 1), 1.04, 1.55, 0.15, 0.02, under=True)
K.part(bm, 'corrugated_galv', name='cladding', uv='beam', axis=(0, 0, 1), grime=0.7, bisect=False, uv_scale=2.0)
if bmr.verts:
    K.part(bmr, 'corrugated_rust', name='cladding_rust', uv='beam', axis=(0, 0, 1), grime=0.7, bisect=False)
K.part(rails, TIM, name='rails', uv='beam', axis=(1, 0, 0), mat_tint=TT)
K.footprint([(-L / 2, W / 2 - 0.1), (L / 2, W / 2 - 0.1), (L / 2, W / 2 + 0.25), (-L / 2, W / 2 + 0.25)], 'HIGH', 'wall')
# ---------------- stock: drum pyramids on skids (lying), upright drum blocks, jerrycan stacks
bd, bs, bj = dz.bmesh.new(), dz.bmesh.new(), dz.bmesh.new()
cols = {k: dz.bmesh.new() for k in range(len(DR))}
def dcol():
    return cols[r.choice([0, 0, 1, 2, 3])]
BURST = dz.bmesh.new()
for blk, (bx, by) in enumerate(((-4.0, 1.4), (0.2, 1.4))):
    for sgn in (-1, 1):
        C.beam_bm(bs, (bx - 1.6, by + sgn * 0.3, 0.15), (bx + 1.6, by + sgn * 0.3, 0.15), 0.14, 0.1)
    for tier in range(3):
        n = 5 - tier
        for k in range(n):
            x = bx - (n - 1) * 0.3 + k * 0.6
            if DEST and r.random() < 0.4:
                continue
            drum_lo(dcol(), (x, by, 0.2 + tier * 0.52), lying=True, axis=(0, 1, 0))
for i in range(3):                       # upright block (3 x 4) front right
    for j in range(4):
        c = (2.8 + i * 0.62, -1.9 + j * 0.62, 0.1)
        if DEST:
            c = (c[0] + r.uniform(-1.5, 2.5), c[1] + r.uniform(-2.5, 1.0), 0.1)
            if (i + j) % 2:
                dz.burst_drum_bm(BURST, c, seed=i * 4 + j, lying=r.random() < 0.5, axis=(r.uniform(-1, 1), r.uniform(-1, 1), 0))
            else:
                drum_lo(dcol(), c, lying=r.random() < 0.6, axis=(r.uniform(-1, 1), r.uniform(-1, 1), 0))
        else:
            drum_lo(dcol(), c)
for k in range(4 if not DEST else 1):
    for j in range(3):
        for i in range(6):
            dz.jerrycan(bj, (-5.2 + i * 0.36, -2.3 + j * 0.2, 0.1 + k * 0.48), math.pi / 2 * 0)
for k, b in cols.items():
    if b.verts:
        K.part(b, 'steel_painted', name='drums%d' % k, smooth=True, mat_tint=DR[k] if not DEST else [(0.3, 0.26, 0.23), (0.42, 0.28, 0.19), (0.26, 0.28, 0.22), (0.36, 0.3, 0.26)][k])
    else:
        b.free()
if BURST.verts:
    K.part(BURST, 'corrugated_rust', name='burst_drums', mat_tint=(0.55, 0.45, 0.4), grime=0.5, bisect=False)
K.part(bs, TIM, name='skids', uv='beam', axis=(1, 0, 0), mat_tint=TT)
K.part(bj, 'steel_painted', name='jerrycans', mat_tint=(0.55, 0.52, 0.38) if not DEST else (0.5, 0.38, 0.3))
for (x0, y0, x1, y1) in ((-5.6, 0.7, -2.4, 2.1), (-1.4, 0.7, 1.8, 2.1), (2.4, -2.4, 4.8, 0.2), (-5.5, -2.5, -3.2, -1.7)):
    K.footprint([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 'LOW', 'stock')
# hand pump on a drum, fire point, sign, sandbag blast walls
bm = dz.bmesh.new()
C.cyl_bm(bm, (1.9, -2.2, 0.98), (1.9, -2.2, 1.9), 0.03, 6)
C.box_bm(bm, (1.9, -2.2, 1.5), (0.14, 0.12, 0.25))
C.beam_bm(bm, (1.9, -2.2, 1.62), (2.25, -2.2, 1.85), 0.025, 0.025)
C.cyl_bm(bm, (1.9, -2.2, 1.4), (1.6, -2.45, 1.2), 0.015, 5)
C.box_bm(bm, (-5.9 - 0.2, -W / 2 - 0.15, 1.25), (0.08, 1.4, 1.1))
for k in range(4):
    C.cyl_bm(bm, (-6.1, -W / 2 - 0.65 + k * 0.33, 0.95), (-6.1, -W / 2 - 0.65 + k * 0.33, 1.2), 0.1, 8, r1=0.12)
K.part(bm, 'steel_painted', name='pump_firepoint', mat_tint=(0.5, 0.18, 0.12))
bm = dz.bmesh.new()
drum_lo(bm, (1.9, -2.2, 0.1))
K.part(bm, 'steel_painted', name='pump_drum', smooth=True, mat_tint=DR[2])
K.sign((-6.07, -W / 2 - 0.15, 2.1), (-1, 0, 0), 0.9, 'halt_sperrgebiet', board='timber_grey')
dz.sandbags((-L / 2 - 1.2, -W / 2 - 0.6), (-L / 2 - 1.2, W / 2 + 0.6), 5, name='sb_w', thick=1)
dz.sandbags((L / 2 + 1.2, W / 2 + 0.6), (L / 2 + 1.2, -W / 2 - 0.6), 5, name='sb_e', thick=1)
for k in range(8):          # oil / fuel spill stains (soft-edged decals), darkest round the pump and drum stacks
    p = r.choice([(1.9, -2.2), (-4.0, 1.4), (0.2, 1.4), (3.4, -1.0), (r.uniform(-5, 5), r.uniform(-2.5, 2.5))])
    dz.decal_dz('oil_stain' if k % 3 else 'wet_ground', (p[0] + r.uniform(-0.6, 0.6), p[1] + r.uniform(-0.6, 0.6), 0.105 + 0.001 * k), (0, 0, 1),
                r.uniform(0.9, 2.0), r.uniform(0.8, 1.6), up=(r.uniform(-1, 1), 1, 0), alpha=0.6)
for k in range(5):          # tyre/foot wear and dust on the slab so it is not a flat uniform plane
    dz.decal_dz(r.choice(['roof_stain_a', 'roof_stain_b', 'dust_wash']), (r.uniform(-5.5, 5.5), r.uniform(-2.8, 2.8), 0.1 + 0.0005 * k), (0, 0, 1),
                r.uniform(1.5, 3.0), r.uniform(1.2, 2.4), up=(r.uniform(-1, 1), 1, 0), alpha=0.5)
bm = dz.bmesh.new()         # slab: sealed expansion joints (3 m grid) + front drain channel grating
for x in (-3.0, 0.0, 3.0):
    C.box_bm(bm, (x, 0, 0.101), (0.035, W + 0.6, 0.004))
C.box_bm(bm, (0, -1.5, 0.101), (L + 0.6, 0.035, 0.004))
C.box_bm(bm, (0, 1.5, 0.101), (L + 0.6, 0.035, 0.004))
K.part(bm, 'bitumen_felt', name='joints', grime=0, bisect=False, lod='drop')
bm = dz.bmesh.new()
for k in range(40):
    C.box_bm(bm, (-L / 2 + 0.15 + k * (L / 40), -W / 2 - 0.2, 0.102), (0.03, 0.22, 0.01))
K.part(bm, 'cast_iron', name='drain_grate', grime=0.3, bisect=False, lod='drop')
if not DEST:
    bm = dz.bmesh.new()     # fuel dispensing hand pump on a stand with crank wheel, hose to the jerrycan stack, funnels
    C.box_bm(bm, (2.9, -2.75, 0.55), (0.35, 0.3, 0.9))
    C.cyl_bm(bm, (3.08, -2.75, 0.85), (3.14, -2.75, 0.85), 0.22, 12)
    C.beam_bm(bm, (3.14, -2.75, 0.85), (3.2, -2.75, 1.0), 0.03, 0.03)
    for k in range(3):
        c = V((3.35 + 0.62 * (k % 3), -1.9, 0.99))
        C.cyl_bm(bm, c, c + V((0, 0, 0.18)), 0.03, 6, r1=0.14)
    K.part(bm, 'steel_painted', name='pump_stand', mat_tint=(0.55, 0.2, 0.14), bisect=False)
    hb = dz.rope((2.9, -2.9, 0.9), (-2.9, -2.4, 0.12), 0.7, 0.028, 10)
    dz.rope((2.75, -2.75, 0.3), (2.2, -2.3, 0.12), 0.1, 0.028, 3, bm=hb)
    K.part(hb, 'bitumen_felt', name='hose', smooth=True, grime=0, bisect=False)
    bm = dz.bmesh.new()     # fire point: sand bin with lid + shovel, fire beaters
    C.box_bm(bm, (-6.1, -W / 2 + 0.9, 0.45), (0.5, 1.0, 0.7))
    C.box_bm(bm, (-6.12, -W / 2 + 0.9, 0.83), (0.56, 1.06, 0.05), 0.0)
    K.part(bm, 'wood_paint', name='sand_bin', mat_tint=(0.62, 0.2, 0.14))
    bm = dz.bmesh.new()
    for k in range(2):
        C.cyl_bm(bm, (-6.28, -W / 2 + 0.5 + k * 0.3, 0.1), (-6.2, -W / 2 + 0.55 + k * 0.3, 1.6), 0.02, 4)
        C.box_bm(bm, (-6.28, -W / 2 + 0.5 + k * 0.3, 0.2), (0.03, 0.25, 0.3))
    K.part(bm, 'timber_grey', name='beaters', bisect=False)
dz.sand_drift((-L / 2 - 0.3, -W / 2 - 0.2), (-L / 2 - 0.3, W / 2 + 0.2), (-1, 0), 0.2, 0.7, seed=SEED)
dz.sand_drift((L / 2 - 1.5, -W / 2 - 0.45), (L / 2 + 0.4, -W / 2 - 0.45), (0, -1), 0.15, 0.6, seed=SEED + 2)
if DEST:
    bm = dz.bmesh.new()       # blown-off roof sheets: crumpled on the ground, thrown downwind (east / south-east), 2 leaning
    for k in range(11):
        a = r.uniform(-0.9, 0.5)
        d = r.uniform(L / 2 - 1.0, L / 2 + 5.5)
        c = V((math.cos(a) * d, math.sin(a) * d * 0.8 + r.uniform(-1.5, 1.5), 0.0))
        dz.crumpled_sheet(bm, c, r.uniform(0, math.pi), 0.9, r.uniform(1.4, 2.2), seed=SEED + k)
    dz.crumpled_sheet(bm, V((L / 2 + 1.0, 1.2, 0.0)), 0.3, 0.9, 1.8, seed=SEED + 40, lean=(L / 2 + 1.1, 1.3, 1.2))
    dz.crumpled_sheet(bm, V((-2.0, -W / 2 - 0.9, 0.0)), 1.4, 0.9, 1.6, seed=SEED + 41, lean=(-2.0, -W / 2 - 0.5, 0.9))
    K.part(bm, 'corrugated_rust', name='sheets', uv='beam', axis=(0, 1, 0), mat_tint=(0.85, 0.78, 0.7), bisect=False, uv_scale=2.0)
    bm = dz.bmesh.new()
    for x in (-L / 2, -L / 4, L / 4):     # surviving trusses (charred) holding a few twisted sheets
        C.beam_bm(bm, (x, -W / 2 - 0.1, HP + 0.2), (x, W / 2 + 0.1, HP + 0.2), 0.12, 0.16)
        C.beam_bm(bm, (x, W / 2 + 0.3, HP + 0.18), (x, 0.3, HP + 0.2 + RISE * 0.8), 0.12, 0.14)
    for k in range(6):
        a = r.uniform(0, math.pi)
        p = V((r.uniform(-4, 4), r.uniform(-2.5, 2.5), 0.3))
        d = V((math.cos(a), math.sin(a), r.uniform(-0.2, 0.3))).normalized()
        dz.broken_log(bm, p - d * 1.2, p + d * 1.2, 0.08, 5)
    K.part(bm, TIM, name='charred_timber', uv='beam', axis=(1, 0, 0), mat_tint=(0.24, 0.2, 0.17))
    bm = dz.bmesh.new()
    dz.corrugated_bm(bm, (-L / 2 - 0.2, 0.4, HP + 0.35), (1, 0, 0), (0, 1, -0.35), 1.8, 2.4, 0.15, 0.02, bend=-0.3, twist=0.5, nrows=3)
    K.part(bm, 'corrugated_rust', name='hanging_sheet', uv='beam', axis=(0, 1, 0), mat_tint=(0.7, 0.62, 0.55), bisect=False)
    dz.crater((0.6, 0.4, 0.1), 2.3, seed=SEED)
    dz.decal_dz('scorch_b', (0.0, W / 2 + 0.1, 1.5), (0, -1, 0), 7.0, 3.2, alpha=0.7)
    K.decal('soot', (-2.0, W / 2 + 0.09, 2.2), (0, -1, 0), 2.6, 2.4, alpha=0.6)
    C.A.meta['notes'].append('destroyed variant of fuel_depot: roof blown off, burst drums, crater + radial scorch; fire anchors')
    for k in range(3):
        K.anchor('fire', (r.uniform(-4, 4), r.uniform(-2, 2), 0.3), (0, -1, 0), size=r.uniform(1.0, 2.0))
else:
    K.anchor('explosive_target', (0.0, 1.4, 0.8), (0, -1, 0), kind='fuel_depot', chain_radius=6.0)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
