"""Watermill on a river bank (M17 'old mill', M19; generic northern France / Alsace / Belgium): three-storey mill house,
breast-shot timber water wheel (5.6 m, separate rotating node 'wheel' pivoted on the axle) between the mill wall and a
stone wheel pier, stone quay/retaining wall down into the river with water-line staining, timber sluice gate with
windlass, loading doors stacked under a hoist lucarne with beam and pulley, lean-to store, landing stage.
 a = stone mill (rubble + dressed quoins, slate)   b = M17 look: stone ground floor, tarred-plank upper storeys, shingle roof,
 timber landing deck on piles.   River runs along Y on the +X (east) side; bank top z=0, water at WATER.
usage: blender -b --python watermill.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, DOOR, SHUTTER, finish, timber_face, roof_tone, roof_ridge, roof_decals, rotate_asset_cw90, use_cheap_windows
use_cheap_windows()

OUT, VAR, SEED = args('watermill_a')
WATER, BED = -1.1, -2.6
K.begin('watermill_' + VAR, SEED, theater='temperate', water_level=WATER)
r = K.rng()
L, W = 9.0, 7.0
x0, x1, y0, y1 = -5.0, 4.0, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
T = 0.65
STONE = 'fieldstone' if VAR == 'a' else 'fieldstone_grey'
DR = 'ashlar_limestone' if VAR == 'a' else 'ashlar'
ZS = 8.2 if VAR == 'a' else 2.8          # top of stone
ZE = 8.2

# ---- openings ------------------------------------------------------------------------------------------------------
front = [K.opening(poly, 0, 2.2, 1.3, 2.3, 0.15, T, 'segment', 'door'),
         K.opening(poly, 0, 5.0, 0.9, 1.3, 1.1, T), K.opening(poly, 0, 7.4, 0.9, 1.3, 1.1, T),
         K.opening(poly, 0, 2.2, 1.2, 1.9, 3.1, T), K.opening(poly, 0, 5.0, 0.9, 1.2, 3.6, T), K.opening(poly, 0, 7.4, 0.9, 1.2, 3.6, T),
         K.opening(poly, 0, 2.2, 1.2, 1.9, 5.8, T), K.opening(poly, 0, 5.0, 0.9, 1.1, 6.2, T), K.opening(poly, 0, 7.4, 0.9, 1.1, 6.2, T)]
east = [K.opening(poly, 1, 1.5, 0.8, 1.1, 3.8, T), K.opening(poly, 1, 5.5, 0.8, 1.1, 3.8, T), K.opening(poly, 1, 1.5, 0.8, 1.0, 6.3, T)]
back = [K.opening(poly, 2, 3.0, 0.9, 1.2, 3.6, T), K.opening(poly, 2, 6.5, 0.9, 1.2, 6.2, T), K.opening(poly, 2, 6.2, 1.0, 2.1, 0.1, T, 'rect', 'door')]
west = [K.opening(poly, 3, 3.5, 1.0, 2.1, 0.1, T, 'rect', 'door'), K.opening(poly, 3, 2.0, 0.8, 1.1, 3.8, T),
        K.opening(poly, 3, W / 2, 0.7, 0.9, ZE + 1.0, T, 'segment')]
allf = front + east + back + west
if VAR == 'a':
    K.wall_ring(poly, ZE, T, STONE, allf, plinth=(DR, 0.5, 0.06), name='walls')
    K.quoins(poly, 0.5, ZE, DR, block_h=0.35, long=0.6, short=0.35)
    K.course(poly, 2.95, 0.15, 0.06, DR, name='course1')
else:
    K.wall_ring(poly, ZS, T, STONE, [f for f in allf if f.o.z < ZS], plinth=(DR, 0.5, 0.06), name='walls')
    K.wall_ring(poly, ZE - ZS - 0.1, 0.3, 'timber_tarred', [f for f in allf if f.o.z >= ZS], z0=ZS + 0.1, name='walls_up', footprint=False)
    bm = bmesh.new()                                   # vertical battens + corner boards over the cladding
    for (a, b) in zip(poly, poly[1:] + poly[:1]):
        a3, b3 = V((*a, 0)), V((*b, 0))
        d = (b3 - a3); Ln = d.length; d.normalize(); n = V((d.y, -d.x, 0))
        for k in range(int(Ln / 1.2) + 1):
            p = a3 + d * min(Ln - 0.05, 0.05 + k * 1.2) + n * 0.03
            K.beam_bm(bm, p + V((0, 0, ZS + 0.1)), p + V((0, 0, ZE)), 0.1, 0.05, up=n)
    K.part(bm, 'timber_tarred', name='battens', uv='beam', axis=(0, 0, 1))
    K.course(poly, ZS, 0.2, 0.12, 'timber_beam', name='sole_plate')
zr = ZE + (W / 2) * math.tan(math.radians(45))
if VAR == 'a':
    K.gable(poly, 1, ZE, zr, T, STONE, name='gable_e')
    K.gable(poly, 3, ZE, zr, T, STONE, [west[2]], name='gable_w')
else:            # M17: half-timbered gables (square framing, lime infill) over the tarred-plank storeys
    gz = lambda t: ZE + (W / 2 - abs(t - W / 2)) - 0.08
    K.gable(poly, 1, ZE, zr, 0.3, 'plaster_rough', name='gable_e', mat_tint=(0.95, 0.9, 0.8))
    K.gable(poly, 3, ZE, zr, 0.3, 'plaster_rough', [west[2]], name='gable_w', mat_tint=(0.95, 0.9, 0.8))
    for e, frs in ((1, []), (3, [west[2]])):
        timber_face(poly[e], poly[(e + 1) % 4], ZE, zr, frs, ztop=gz, style='square', tint=(0.3, 0.25, 0.2), name='tf_gab%d' % e, seed=e)
    rr_ = __import__('random').Random(5)
    # rework3: patches = whole replaced sections of cladding, 4-5 adjacent full boards filling one batten bay (1.2 m),
    # ragged top/bottom per board, tone close to the tarred planks (greyed or fresh-sawn but tarred-over), never loose
    # single sticks; skipped where they would cross a window/door
    bm, bm2, girt = bmesh.new(), bmesh.new(), bmesh.new()
    upf = [f for f in allf if f.o.z >= ZS - 0.5]
    for ei, (a, b) in enumerate(zip(poly, poly[1:] + poly[:1])):
        a3, b3 = V((*a, 0)), V((*b, 0))
        d = (b3 - a3); Ln = d.length; d.normalize(); n = V((d.y, -d.x, 0))
        bays = list(range(int((Ln - 0.1) / 1.2)))
        rr_.shuffle(bays)
        placed = 0
        for bay in bays:
            if placed >= (2 if Ln > 8 else 1):
                break
            t0 = 0.05 + bay * 1.2 + 0.07
            h = rr_.uniform(1.3, 2.4)
            z0 = rr_.choice((ZS + 0.12, ZS + 2.8, rr_.uniform(ZS + 0.3, ZE - h - 0.2)))
            z0 = min(z0, ZE - h - 0.1)
            hit = False
            for f in upf:
                ft = (f.o - a3).dot(d)
                if ft + f.w / 2 + 0.1 > t0 and ft - f.w / 2 - 0.1 < t0 + 1.06 and f.o.z < z0 + h + 0.1 and f.o.z + f.h + 0.1 > z0:
                    hit = True
            if hit:
                continue
            placed += 1
            tgt = bm if rr_.random() < 0.5 else bm2
            nbd = 5
            for kb in range(nbd):
                zb0 = z0 + rr_.uniform(-0.08, 0.08)
                zb1 = z0 + h + rr_.uniform(-0.1, 0.1)
                K.box_bm(tgt, tuple(a3 + d * (t0 + (kb + 0.5) * 1.06 / nbd) + n * 0.035 + V((0, 0, (zb0 + zb1) / 2))),
                         (1.06 / nbd - 0.012, 0.025, zb1 - zb0), math.atan2(d.y, d.x))
            K.box_bm(tgt, tuple(a3 + d * (t0 + 0.53) + n * 0.055 + V((0, 0, z0 + h * 0.5))), (1.0, 0.02, 0.1), math.atan2(d.y, d.x))  # cleat
        K.beam_bm(girt, a3 + n * 0.05 + V((0, 0, ZS + 2.7)), b3 + n * 0.05 + V((0, 0, ZS + 2.7)), 0.16, 0.1, up=n)   # floor girt
    K.part(bm, 'timber_tarred', name='boards_weathered', uv='beam', axis=(0, 0, 1), tint=(1.45, 1.38, 1.3), grime=0.4, bisect=False)
    K.part(bm2, 'timber_siding', name='boards_patched', uv='beam', axis=(0, 0, 1), tint=(0.52, 0.45, 0.38), grime=0.6, bisect=False)
    K.part(girt, 'timber_tarred', name='floor_girt', uv='beam', axis=(1, 0, 0), grime=0.5, bisect=False)

for k, f in enumerate(allf):
    if f.kind == 'door':
        continue
    loading = f.w > 1.1 and f.o.z > 2
    K.window(f, 'casement', (2, 2) if not loading else (1, 1), frame=(0.62, 0.6, 0.55), sill=DR if VAR == 'a' or f.o.z < ZS else 'timber_beam',
             lintel='timber_beam', shutters='closed' if loading else (None if k % 3 else 'open'), shutter_color=SHUTTER['brown'],
             shutter_style='plank', curtain=0.0, interior=True, name='w%d' % k, streak=False)
K.door(front[0], 'front', 'double', (0.36, 0.28, 0.2), step=DR, lintel='timber_beam', open_deg=0)
K.door(back[2], 'back', 'plank', DOOR['brown'], step=None, lintel='timber_beam')
K.door(west[0], 'west', 'plank', DOOR['green'], step=DR, lintel='timber_beam')

# ---- roof, hoist lucarne ---------------------------------------------------------------------------------------------
R = K.roof_gable((x0 + x1) / 2, 0, L, W, ZE, 45, 'roof_slate' if VAR == 'a' else 'roof_shingle', eave_oh=0.4, gable_oh=0.3,
                 thick=0.13, fascia='timber_beam', barge='timber_beam', gutters=VAR == 'a', sag=0.07, wobble=0.02)
lx = front[0].o.x - (x0 + x1) / 2
K.dormer(R, lx, -1, 1.6, 1.9, wall='timber_tarred', roof=R.mid, pitch=45,
         window_kw=dict(style='casement', panes=(1, 1), frame=(0.45, 0.4, 0.35), sill=None, streak=False, curtain=0.0, shutters='closed',
                        shutter_color=SHUTTER['brown']))
hx = front[0].o.x
bm = bmesh.new()
K.beam_bm(bm, (hx, y0 + 0.8, ZE + 1.9), (hx, y0 - 1.3, ZE + 1.9), 0.22, 0.24)
K.beam_bm(bm, (hx, y0 + 0.2, ZE + 1.1), (hx, y0 - 0.9, ZE + 1.85), 0.12, 0.12)
K.part(bm, 'timber_beam', name='hoist_beam', uv='beam', axis=(0, 1, 0))
bm = bmesh.new()
K.cyl_bm(bm, (hx - 0.06, y0 - 1.15, ZE + 1.6), (hx + 0.06, y0 - 1.15, ZE + 1.6), 0.16, 10)
K.cyl_bm(bm, (hx, y0 - 1.3, ZE + 1.6), (hx, y0 - 1.3, 3.5), 0.015, 4)
K.box_bm(bm, (hx, y0 - 1.3, 3.4), (0.12, 0.12, 0.2))
K.part(bm, 'cast_iron', name='pulley')
K.chimney(x0 + 0.5, 1.4, ZE, R.z_ridge + 0.7, 0.7, 0.6, 'brick_red', cap='ashlar', pots=1)
K.anchor('roof_ridge', ((x0 + x1) / 2, 0, R.z_ridge))

# ---- lean-to store on the north side ----------------------------------------------------------------------------------
lp = [(x0 + 0.5, y1 - 0.05), (x0 + 5.0, y1 - 0.05), (x0 + 5.0, y1 + 3.0), (x0 + 0.5, y1 + 3.0)]
lpd = K.opening(lp, 3, 1.5, 1.0, 2.0, 0.0, 0.35, 'rect', 'door')
K.wall_ring(lp, 2.6, 0.35, STONE, [lpd], name='store_walls')
K.door(lpd, 'store', 'plank', (0.4, 0.34, 0.27), step=None, lintel='timber_beam')
K.roof_shed(x0 + 0.5, y1, x0 + 5.0, y1 + 3.0, 2.6, 3.5, 'corrugated_rust', low_side='+y', oh=0.25, name='store_roof')

# ---- river works: quay wall, wheel pier, bearings, sluice ------------------------------------------------------------
qx = x1 + 0.0
bm = bmesh.new()
K.box_bm(bm, (qx - 0.5, 0, (BED + 0.3) / 2), (1.0, 16.0, -BED + 0.3))
K.part(bm, DR if VAR == 'a' else 'ashlar', name='quay_wall')
K.P('ashlar_limestone', K.box_bm, (qx - 0.5, y0 - 4.3, 0.15), (1.1, 1.4, 0.3), name='quay_cope_s')
K.P('ashlar_limestone', K.box_bm, (qx - 0.5, y1 + 4.3, 0.15), (1.1, 1.4, 0.3), name='quay_cope_n')
WX0, WX1 = x1 + 0.35, x1 + 1.65          # wheel between wall and pier
AX = V(((WX0 + WX1) / 2, 0.0, 0.85))
RAD = 2.8
px = WX1 + 0.6
# rework3: the leat wall was a 1.6 m high pale box right in front of the wheel (after the 90 deg turn it sits between the
# camera and the wheel) -> low rubble leat wall (top just above the headrace water), dressed coping blocks with drip
# projection + joints + cramps, a raised bearing pedestal at the axle only, visible headrace water feeding the wheel.
PT = 0.05                                           # top of the leat-wall masonry (coping sits on it)
PY0, PY1 = -8.4, 3.2
bm = bmesh.new()
K.box_bm(bm, (px, (PY0 + PY1) / 2, (BED + PT) / 2), (0.9, PY1 - PY0, PT - BED))
K.part(bm, STONE, name='wheel_pier', mat_tint=(0.9, 0.88, 0.84))
bm, bmc = bmesh.new(), bmesh.new()
y = PY0
while y < PY1 - 0.05:                               # coping: individual dressed blocks, chamfered top, 12 mm joints
    ln = min(PY1 - y, r.uniform(0.75, 1.1))
    b0, b1 = y + 0.006, y + ln - 0.006
    hw, ht = 0.53, 0.2
    K.hexa_bm(bm if r.random() < 0.7 else bmc,
              [V((px - hw, b0, PT)), V((px + hw, b0, PT)), V((px + hw, b1, PT)), V((px - hw, b1, PT)),
               V((px - hw + 0.06, b0, PT + ht)), V((px + hw - 0.06, b0, PT + ht)), V((px + hw - 0.06, b1, PT + ht)), V((px - hw + 0.06, b1, PT + ht))])
    y += ln
K.part(bm, DR if VAR == 'a' else 'ashlar', name='pier_coping', mat_tint=(0.86, 0.85, 0.82), grime=0.8)
K.part(bmc, 'ashlar', name='pier_coping_b', mat_tint=(0.74, 0.74, 0.7), grime=0.9)
bm = bmesh.new()                                    # iron cramps across the coping joints (rust-dark dots from above)
y = PY0 + 0.9
while y < PY1 - 0.5:
    K.box_bm(bm, (px, y, PT + 0.205), (0.22, 0.05, 0.012))
    y += r.uniform(1.6, 2.4)
K.part(bm, 'steel_painted', name='coping_cramps', mat_tint=(0.35, 0.2, 0.12), grime=0.2, bisect=False)
bm = bmesh.new()                                    # bearing pedestal: only where the axle crosses the leat wall
K.box_bm(bm, (px - 0.05, AX.y, (PT + AX.z - 0.5) / 2 + 0.1), (0.8, 0.9, AX.z - 0.5 - PT + 0.2))
K.box_bm(bm, (px - 0.05, AX.y, AX.z - 0.46), (0.95, 1.05, 0.12))
K.part(bm, DR if VAR == 'a' else 'ashlar', name='bearing_pedestal', mat_tint=(0.84, 0.83, 0.8))
K.cutwater(px, 0.9, -2 * PY0, BED, PT, STONE, upstream=-1, name='pier_cw')
bm = bmesh.new()
for x in (x1 + 0.12, px - 0.2):
    K.box_bm(bm, (x, 0, AX.z - 0.25), (0.35, 0.6, 0.35))
K.part(bm, 'timber_beam', name='bearings', uv='beam', axis=(1, 0, 0))
# headrace water held up by the sluice + falling sheet over the stone breast onto the floats
HW = -0.12
HY1 = AX.y - math.cos(math.radians(20)) * (RAD + 0.15)
bm = bmesh.new()
vs = [bm.verts.new(p_) for p_ in ((x1 + 0.02, PY0, HW), (px - 0.45, PY0, HW), (px - 0.45, HY1, HW), (x1 + 0.02, HY1, HW))]
f_ = bm.faces.new(vs)
nsteps = 7
prev = [vs[3], vs[2]]
for k in range(1, nsteps + 1):                      # nappe following the breast (200 -> 262 deg)
    a = math.radians(200 + 62 * k / nsteps)
    rr_ = RAD + 0.14 - 0.02 * k
    yy, zz = AX.y + math.cos(a) * rr_, AX.z + math.sin(a) * rr_
    cur = [bm.verts.new((x1 + 0.35, yy, zz)), bm.verts.new((px - 0.55, yy, zz))]
    bm.faces.new((prev[0], prev[1], cur[1], cur[0]))
    prev = cur
uvl = bm.loops.layers.uv.new('UVMap')
for f_ in bm.faces:
    for lo in f_.loops:
        lo[uvl].uv = ((lo.vert.co.x - x1) / 2.0, lo.vert.co.y / 4.0 + lo.vert.co.z * 0.2)
K.part(bm, 'water_flow', name='headrace_water', uv='keep', grime=0, bisect=False, jitter=0.0, mat_tint=(0.62, 0.72, 0.74))
bm = bmesh.new()                                    # churn where the nappe meets the floats / tail water
for k in range(7):
    c = V((r.uniform(x1 + 0.5, px - 0.6), AX.y + r.uniform(-1.2, 0.6), WATER + 0.03))
    K.cyl_bm(bm, c, c + V((0, 0, r.uniform(0.05, 0.12))), r.uniform(0.25, 0.45), 8, r1=0.12)
K.part(bm, 'water_flow', name='wheel_foam', grime=0, bisect=False, jitter=0.0, tint=(1.0, 1.0, 1.0), smooth=True)
# sluice gate upstream (south) between quay and pier
sy = -3.6
bm = bmesh.new()
for x in (x1 + 0.2, px - 0.4):
    K.beam_bm(bm, (x, sy, BED), (x, sy, 1.9), 0.25, 0.25)
K.beam_bm(bm, (x1, sy, 1.9), (px - 0.2, sy, 1.9), 0.25, 0.3)
K.beam_bm(bm, (x1, sy - 0.8, 0.3), (px, sy - 0.8, 0.3), 0.4, 0.12, up=V((0, 1, 0)))        # footboard
for k in range(3):
    K.beam_bm(bm, (x1 + 0.35, sy - 0.1, WATER - 0.5 + k * 0.33), (px - 0.55, sy - 0.1, WATER - 0.5 + k * 0.33), 0.32, 0.06, up=V((0, 1, 0)))
K.part(bm, 'timber_tarred', name='sluice', uv='beam', axis=(1, 0, 0))
bm = bmesh.new()                                    # breast apron (curved stone breast under the wheel) + tail boards
for k in range(6):
    a0, a1 = math.radians(200 + k * 12), math.radians(212 + k * 12)
    pa = AX + V((0, math.cos(a0) * (RAD + 0.12), math.sin(a0) * (RAD + 0.12)))
    pb = AX + V((0, math.cos(a1) * (RAD + 0.12), math.sin(a1) * (RAD + 0.12)))
    K.hexa_bm(bm, [V((WX0 - 0.05, pa.y, pa.z)), V((WX1 + 0.05, pa.y, pa.z)), V((WX1 + 0.05, pb.y, pb.z)), V((WX0 - 0.05, pb.y, pb.z)),
                   V((WX0 - 0.05, pa.y, pa.z - 0.4)), V((WX1 + 0.05, pa.y, pa.z - 0.4)), V((WX1 + 0.05, pb.y, pb.z - 0.4)), V((WX0 - 0.05, pb.y, pb.z - 0.4))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'ashlar', name='wheel_breast', grime=1.0)
bm = bmesh.new()
for x in ((x1 + px) / 2 - 0.25, (x1 + px) / 2 + 0.25):
    K.cyl_bm(bm, (x, sy - 0.1, 0.2), (x, sy - 0.1, 2.3), 0.04, 6)
K.cyl_bm(bm, ((x1 + px) / 2 - 0.45, sy - 0.1, 2.2), ((x1 + px) / 2 + 0.45, sy - 0.1, 2.2), 0.09, 8)
K.cyl_bm(bm, ((x1 + px) / 2 + 0.45, sy - 0.1, 2.2), ((x1 + px) / 2 + 0.55, sy - 0.1, 2.2), 0.35, 12, caps=True)
K.part(bm, 'cast_iron', name='windlass', grime=0.3)
K.anchor('sluice_lever', ((x1 + px) / 2, sy - 0.8, 0.3), (0, -1, 0), kind='lever')
K.footprint([(x1 - 0.05, sy - 1.0), (px + 0.45, sy - 1.0), (px + 0.45, sy - 0.6), (x1 - 0.05, sy - 0.6)], 'NONE', 'footboard')

# ---- water wheel (separate node, pivot on the axle) ----------------------------------------------------------------
def wheel_part(bm, mid, name):
    ob = K.part(bm, mid, name=name, node='wheel', uv='beam', axis=(0, 0, 1), grime=0.7, bisect=False)
    ob['kit_pivot'] = list(AX)
    ob['eu_lod'] = 'all'            # never decimated: LOD2 used to tear it into dangling beams
    return ob

NS = 16
bm = bmesh.new()
for x in (WX0 + 0.08, WX1 - 0.08):
    for i in range(NS):
        a0, a1 = 2 * math.pi * i / NS, 2 * math.pi * (i + 1) / NS
        p0 = AX + V((x - AX.x, math.cos(a0) * RAD, math.sin(a0) * RAD))
        p1 = AX + V((x - AX.x, math.cos(a1) * RAD, math.sin(a1) * RAD))
        K.beam_bm(bm, p0, p1, 0.12, 0.28, up=V((1, 0, 0)).cross(p1 - p0))
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        K.beam_bm(bm, V((x, AX.y, AX.z)), V((x, AX.y + math.cos(a) * (RAD - 0.1), AX.z + math.sin(a) * (RAD - 0.1))), 0.14, 0.1, up=V((1, 0, 0)))
wheel_part(bm, 'timber_tarred', 'wheel_frame')
bm = bmesh.new()
NP = 28
for i in range(NP):
    a = 2 * math.pi * i / NP
    d = V((0, math.cos(a), math.sin(a)))
    t = V((0, -math.sin(a), math.cos(a)))
    pa = AX + d * (RAD - 0.55) + t * 0.1
    pb = AX + d * (RAD + 0.12)
    for x in (WX0 + 0.02,):
        K.hexa_bm(bm, [V((WX0 + 0.02, pa.y, pa.z)) - t * 0.025, V((WX0 + 0.02, pb.y, pb.z)) - t * 0.025, V((WX0 + 0.02, pb.y, pb.z)) + t * 0.025,
                       V((WX0 + 0.02, pa.y, pa.z)) + t * 0.025,
                       V((WX1 - 0.02, pa.y, pa.z)) - t * 0.025, V((WX1 - 0.02, pb.y, pb.z)) - t * 0.025, V((WX1 - 0.02, pb.y, pb.z)) + t * 0.025,
                       V((WX1 - 0.02, pa.y, pa.z)) + t * 0.025])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
wheel_part(bm, 'deck_planks', 'wheel_floats')
bm = bmesh.new()
K.cyl_bm(bm, V((x1 + 0.05, AX.y, AX.z)), V((px - 0.1, AX.y, AX.z)), 0.16, 10)
for x in (WX0 + 0.08, WX1 - 0.08):
    K.cyl_bm(bm, V((x - 0.15, AX.y, AX.z)), V((x + 0.15, AX.y, AX.z)), 0.34, 10)
wheel_part(bm, 'cast_iron', 'wheel_axle')
K.anchor('wheel_axle', tuple(AX), (1, 0, 0), kind='rotor', axis=[1, 0, 0], rpm=6)

# ---- landing stage on piles (b) / steps down to the water (a) -----------------------------------------------------------
if VAR == 'b':   # M17: large plank deck over the water on tarred piles (downstream bay + walkway beyond the leat wall)
    bm, bp = bmesh.new(), bmesh.new()
    for (dx0, dx1, dy0, dy1) in ((x1, x1 + 4.2, 3.3, y1 + 7.0), (px + 0.45, px + 2.8, -8.2, y1 + 7.0)):
        n = int((dy1 - dy0) / 0.26)
        for k in range(n):
            y = dy0 + k * 0.26 + 0.12
            K.box_bm(bm, ((dx0 + dx1) / 2, y, 0.22), (dx1 - dx0 + r.uniform(-0.1, 0.1), 0.24, 0.05), r.uniform(-0.01, 0.01))
        for x in (dx0 + 0.25, dx1 - 0.15):
            for k in range(int((dy1 - dy0) / 2.2) + 1):
                y = dy0 + 0.2 + k * (dy1 - dy0 - 0.4) / max(1, int((dy1 - dy0) / 2.2))
                K.cyl_bm(bp, (x, y, BED - 0.5), (x, y, 0.2 if x < dx1 - 0.2 else 1.15), 0.13, 6)
            K.beam_bm(bp, (x, dy0, 0.1), (x, dy1, 0.1), 0.14, 0.2)
        K.roof_meta([(dx0, dy0), (dx1, dy0), (dx1, dy1), (dx0, dy1)], 0.25, walkable=True, kind='landing')
        K.footprint([(dx0, dy0), (dx1, dy0), (dx1, dy1), (dx0, dy1)], 'NONE', 'landing')
    K.part(bm, 'deck_planks', name='landing_deck', uv='beam', axis=(1, 0, 0))
    K.part(bp, 'timber_tarred', name='landing_piles', uv='beam', axis=(0, 0, 1))
    K.railing((px + 2.7, -8.0, 0.25), (px + 2.7, y1 + 6.8, 0.25), 1.0, 'timber', name='landing_rail')
    bm = bmesh.new()
    for k in range(4):                                  # sacks / crates on the deck
        K.box_bm(bm, (x1 + 1.0 + (k % 2) * 0.8, y1 + 1.5 + (k // 2) * 0.7, 0.55), (0.7, 0.6, 0.6), r.uniform(-0.2, 0.2))
    K.part(bm, 'door_planks', name='deck_crates', uv='beam', axis=(1, 0, 0), tint=(0.8, 0.72, 0.6))
    K.anchor('boat_mooring', (px + 3.4, 2.0, WATER), (1, 0, 0), kind='boat')
else:
    bm = bmesh.new()
    for k in range(6):
        K.box_bm(bm, (x1 + 0.35, y1 + 1.2 + k * 0.32, -k * 0.2 - 0.1), (0.7, 0.34, 0.2))
    K.part(bm, DR, name='water_steps')
    K.anchor('boat_mooring', (x1 + 1.2, y1 + 2.5, WATER), (1, 0, 0), kind='boat')
# wall-top: quay edge is climbable from the water
K.climb_meta((x1, y0 - 5.0), (x1, y1 + 5.0), 0.0, kind='quay')
K.footprint([(x1, y0 - 5), (px + 0.45, y0 - 5), (px + 0.45, y1 + 5), (x1, y1 + 5)], 'NONE', 'water')
# weathering: water-line stain + green algae band on the quay, the leat wall and the wheel pit; streaks, moss
bm = bmesh.new()
for xf, sgn, ya, yb, wl in ((x1 + 0.006, 1, 3.0, y1 + 5.0, WATER), (x1 + 0.006, 1, y0 - 5.0, HY1, HW), (px - 0.456, -1, -8.2, HY1, HW),
                            (px + 0.456, 1, -8.2, 3.2, WATER)):
    q = [V((xf, ya, wl - 0.08)), V((xf, yb, wl - 0.08)), V((xf, yb, min(wl + 0.32, PT - 0.02))), V((xf, ya, min(wl + 0.32, PT - 0.02)))]
    if sgn < 0:
        q.reverse()
    bm.faces.new([bm.verts.new(p) for p in q])
K.part(bm, 'sod', name='algae_band', mat_tint=(0.42, 0.5, 0.3), grime=0.3, bisect=False, uv_scale=0.5)
for y in (-5.5, -1.5, 2.5, 5.5):
    K.decal('waterline', (x1 + 0.012, y, WATER + 0.55), (1, 0, 0), 4.0, 1.0, alpha=0.85)
for y in (-6.5, -3.0, 0.8):                         # rework3: river face of the leat wall = the face the camera sees
    K.decal('waterline', (px + 0.462, y, WATER + 0.5), (1, 0, 0), 3.6, 0.9, alpha=0.85)
for k in range(6):
    K.decal('streak_long', (px + 0.463, r.uniform(-8.0, 2.8), -0.45), (1, 0, 0), r.uniform(0.3, 0.6), 0.9, alpha=0.55)
for k in range(4):
    K.decal('moss_patch', (px + r.uniform(-0.25, 0.25), r.uniform(-8.0, 2.8), PT + 0.21), (0, 0, 1), r.uniform(0.35, 0.7), r.uniform(0.3, 0.5), up=(0, 1, 0), alpha=0.7)
for i in range(5):
    K.decal('streak_long', (x1 + 0.012, r.uniform(-5, 5), -0.3), (1, 0, 0), 0.8, 1.4, alpha=0.5)
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), y1 + 0.01, 0.35), (0, 1, 0), 1.5, 0.6, alpha=0.6)
K.decal('damp_base', (x1 + 0.012, 1.0, 0.9), (1, 0, 0), 2.6, 1.6, alpha=0.6)       # spray behind the wheel
roof_tone(R, amp=0.2, seed=SEED)
roof_ridge(R, mid='roof_tile_flat' if VAR == 'a' else 'roof_shingle', tint=(0.85, 0.75, 0.68) if VAR == 'a' else (0.8, 0.75, 0.7),
           r=0.13, finials=False, overhang=0.3)
roof_decals(R, 3, seed=SEED, kinds=('moss_patch',), alpha=0.25)
# present the wheel + headrace to the south-facing game camera: river south of the mill, flowing along X
rotate_asset_cw90()
import kit_export as KE, kit_core as KC
KE.recenter_parts([o for o in KC.A.parts])
sh = KC.A.meta.get('recentered_by', [0, 0])[1]
KC.A.meta['river'] = {'bank_z': round(x1 + sh, 3), 'side': '+z', 'width': 12.0, 'water_level': WATER, 'bed': BED,
                      'note': 'bank-side asset: river flows along game X south of bank_z (wheel + headrace face the camera); carve terrain there'}
KC.A.meta['mission_use'] = 'M17 old mill = watermill_b (timber-framed mill on a plank deck over the water); M19 = watermill_a'
finish(OUT)
