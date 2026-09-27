"""Village church with a west bell tower (Normandy / Picardy, 12th-15th c. fabric as seen in 1944): rubble-stone nave
with stepped buttresses and lancet windows, lower chancel with a three-sided apse, square tower with paired louvred
belfry openings, clock, octagonal slate spire with lucarnes, weather-cock cross; south porch in timber on a stone dwarf
wall; west portal with moulded voussoirs.
 a = limestone ashlar dressings + fieldstone, slate spire   b = grey granite (Brittany/Cotentin), saddle-back tower roof
 '-ruin' = shelled: spire shot off, nave roof holed, rubble (destroyed variant)
usage: blender -b --python church_village.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import (K, V, args, DOOR, ruin_pass, finish, roof_tone, roof_patches, ridge_tiles, roof_decals, scorch_openings,
                       floor_slab)

OUT, VAR, SEED = args('church_village_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('church_village_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
STONE = 'fieldstone' if base == 'a' else 'fieldstone_grey'
DRESS = 'ashlar_limestone' if base == 'a' else 'granite'
T = 0.9
# nave
NL, NW, NZ = 17.0, 8.4, 7.2
nx0, nx1, ny0, ny1 = -NL / 2, NL / 2, -NW / 2, NW / 2
nave = [(nx0, ny0), (nx1, ny0), (nx1, ny1), (nx0, ny1)]
# chancel with 3-sided apse (east)
CW, CL, CZ = 6.2, 6.0, 6.0
cx0, cx1 = nx1 - 0.3, nx1 + CL
ap = 1.6
chan = [(cx0, -CW / 2), (cx1, -CW / 2), (cx1 + ap, -CW / 2 + ap), (cx1 + ap, CW / 2 - ap), (cx1, CW / 2), (cx0, CW / 2)]
# tower (west)
TS, TZ = 5.6, 17.5
tx1 = nx0 + 0.3
tx0 = tx1 - TS
tower = [(tx0, -TS / 2), (tx1, -TS / 2), (tx1, TS / 2), (tx0, TS / 2)]

from eu_common import install_lancet, lancet_dressing, roof_weather, LANCET
install_lancet()
# ---- openings --------------------------------------------------------------------------------------------------
nf = []
for k in range(4):
    t = 2.3 + k * 4.1
    if k == 1:
        nf.append(K.opening(nave, 0, t, 1.4, 2.8, 0.25, T, 'arch', 'door'))         # south door (in the porch)
    else:
        nf.append(K.opening(nave, 0, t, 0.95, 3.2, 2.8, T, 'lancet', rise=LANCET * 0.95))
    nf.append(K.opening(nave, 2, t + 0.3, 0.95, 3.2, 2.8, T, 'lancet', rise=LANCET * 0.95))
cf = [K.opening(chan, 0, CL / 2, 0.8, 2.6, 2.4, T, 'lancet', rise=LANCET * 0.8), K.opening(chan, 4, CL / 2 + 0.3, 0.8, 2.6, 2.4, T, 'lancet', rise=LANCET * 0.8),
      K.opening(chan, 2, (CW - 2 * ap) / 2, 1.0, 3.0, 2.2, T, 'lancet', rise=LANCET * 1.0)]
wp = K.opening(tower, 3, TS / 2, 1.8, 3.6, 0.3, T, 'arch', 'door')                    # west portal
tf = [wp, K.opening(tower, 3, TS / 2, 0.7, 1.8, 6.5, T, 'arch')]
bel = []
for e in range(4):
    for dx in (-0.65, 0.65):
        f = K.opening(tower, e, TS / 2 + dx, 0.9, 2.4, 12.6, T, 'arch')
        bel.append(f)
tf += bel

K.wall_ring(nave, NZ, T, STONE, nf, plinth=(DRESS, 0.95, 0.16), name='nave_walls')
K.course(nave, 0.95, 0.14, 0.2, DRESS, name='plinth_chamfer')
K.course(nave, 2.62, 0.16, 0.12, DRESS, name='sill_course')
K.wall_ring(chan, CZ, T, STONE, cf, plinth=(DRESS, 0.95, 0.16), name='chancel_walls', footprint=True)
K.course(chan, 2.25, 0.16, 0.12, DRESS, name='chan_sill_course')
K.wall_ring(tower, TZ, T + 0.2, STONE, tf, plinth=(DRESS, 0.8, 0.1), name='tower_walls')
K.quoins(tower, 0.8, TZ, DRESS, block_h=0.5, long=0.75, short=0.42)
K.quoins(nave, 0.6, NZ, DRESS, corners=(1, 2), block_h=0.4, long=0.6, short=0.35, name='nave_quoins')
K.course(tower, 11.9, 0.25, 0.12, DRESS, name='belfry_course')
K.course(tower, 6.0, 0.2, 0.1, DRESS, name='tower_course')
K.cornice(tower, TZ - 0.45, DRESS, steps=((0.08, 0.15), (0.16, 0.15), (0.26, 0.15)), name='tower_cornice')
K.cornice(nave, NZ - 0.3, DRESS, steps=((0.08, 0.12), (0.16, 0.12)), name='nave_cornice')

# buttresses: three stages with set-offs, sloped ashlar weatherings with projecting drips, chamfered plinth
BUT = 'ashlar' if base == 'a' else 'granite'
BT = (0.8, 0.78, 0.72) if base == 'a' else (0.85, 0.85, 0.85)
def buttress(p, n, h, w=0.9, d=1.1, name='butt'):
    p, n = V((*p, 0)), V((*n, 0)).normalized()
    rt = V((-n.y, n.x, 0))
    bm, bw = bmesh.new(), bmesh.new()
    stages = ((0, h * 0.42, d, w), (h * 0.42, h * 0.72, d * 0.72, w * 0.92), (h * 0.72, h * 0.95, d * 0.45, w * 0.84))
    for (za, zb, dd, ww) in stages:
        a = p + n * dd
        pts = [p - rt * ww / 2, a - rt * ww / 2, a + rt * ww / 2, p + rt * ww / 2]
        K.hexa_bm(bm, [q + V((0, 0, za)) for q in pts] + [q + V((0, 0, zb)) for q in pts])
        # weathering (sloped cap) with a drip overhanging the face below
        a2 = p + n * (dd + 0.07)
        cp = [p - rt * (ww / 2 + 0.05), a2 - rt * (ww / 2 + 0.05), a2 + rt * (ww / 2 + 0.05), p + rt * (ww / 2 + 0.05)]
        K.hexa_bm(bw, [q + V((0, 0, zb - 0.08)) for q in cp] + [cp[0] + V((0, 0, zb + dd * 0.55)), cp[1] + V((0, 0, zb + 0.02)),
                  cp[2] + V((0, 0, zb + 0.02)), cp[3] + V((0, 0, zb + dd * 0.55))])
    a = p + n * (d + 0.12)                                   # chamfered plinth block
    pp = [p - rt * (w / 2 + 0.12), a - rt * (w / 2 + 0.12), a + rt * (w / 2 + 0.12), p + rt * (w / 2 + 0.12)]
    K.hexa_bm(bw, [q + V((0, 0, 0)) for q in pp] + [pp[0] + V((0, 0, 0.9)), pp[1] - n * 0.12 + V((0, 0, 0.75)),
              pp[2] - n * 0.12 + V((0, 0, 0.75)), pp[3] + V((0, 0, 0.9))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bw, faces=bw.faces)
    K.part(bm, STONE, name=name, grime=1.0)
    K.part(bw, DRESS, name=name + '_weath', mat_tint=BT, grime=1.2)

for k in range(5):
    x = nx0 + 0.8 + k * 4.1 - 0.35
    if 0 < k < 5:
        buttress((x, ny0), (0, -1), NZ - 0.6, name='bs%d' % k)
        buttress((x, ny1), (0, 1), NZ - 0.6, name='bn%d' % k)
buttress((cx1 + ap * 0.5, -CW / 2 + ap * 0.5), (0.7, -0.7), CZ - 0.5, name='ba0')
buttress((cx1 + ap * 0.5, CW / 2 - ap * 0.5), (0.7, 0.7), CZ - 0.5, name='ba1')
for (px, py, nx_, ny_) in ((tx0, -TS / 2 + 0.6, -1, 0), (tx0, TS / 2 - 0.6, -1, 0), (tx0 + 0.6, -TS / 2, 0, -1), (tx0 + 0.6, TS / 2, 0, 1)):
    buttress((px, py), (nx_, ny_), 9.5, 1.0, 1.3, name='bt')

# ---- windows, louvres, doors -------------------------------------------------------------------------------------
GL = (0.55, 0.62, 0.66)
for k, f in enumerate([f for f in nf + cf if f.kind == 'window']):
    K.window(f, 'fixed', (2, 5), frame=(0.3, 0.3, 0.3), sill=DRESS, lintel=None, surround=None, curtain=0.0, name='lan%d' % k,
             recess=0.3, interior=True)
_lw = [f for f in nf + cf if f.kind == 'window']
lancet_dressing([f for f in _lw if f.n.y < 0.5], DRESS, tint=BT, name='lan_dress')
lancet_dressing([f for f in _lw if f.n.y >= 0.5], DRESS, tint=BT, name='lan_dress_n', jambs=False)   # north: unseen from the game camera
K.window(tf[1], 'fixed', (1, 3), frame=(0.3, 0.3, 0.3), sill=DRESS, curtain=0.0, name='tw', recess=0.35)
bm = bmesh.new()
for f in bel:                                        # abat-sons (inclined louvre boards)
    for j in range(8):
        z = 0.25 + j * 0.23
        K.beam_bm(bm, f.p(-f.w / 2, z, -0.35), f.p(f.w / 2, z, -0.35), 0.24, 0.025, up=V((0, 0, 1)) + f.n * 0.9)
K.part(bm, 'timber_grey', name='louvres', uv='beam', axis=(1, 0, 0), tint=(0.8, 0.8, 0.8))
for k, f in enumerate(bel):
    K.voussoirs(f, DRESS, name='bvs%d' % k)
K.door(wp, 'west', 'double', (0.30, 0.22, 0.16), step=DRESS, lintel=DRESS)
K.door(nf[2], 'south', 'plank', (0.32, 0.24, 0.17), step=DRESS, lintel=DRESS)
K.stairs((wp.o.x - 1.4, 0, 0), (1, 0, 0), 2.6, 0.3, 2, DRESS, name='west_steps')
import eu_dmg
_sd = nf[2]
eu_dmg.carve([eu_dmg.Box(_sd.p(0, 1.6, -0.2), (1, 0, 0), (0, 1, 0), (0, 0, 1), (_sd.w / 2 + 0.05, 0.6, 1.6))],
             only=lambda o: o.name.startswith(('sill_course', 'plinth_chamfer')))
# clock face on the south side of the tower
cc = V((tx0 + TS / 2, -TS / 2 - 0.12, 10.2))
K.P(DRESS, K.cyl_bm, tuple(cc + V((0, 0.1, 0))), tuple(cc - V((0, 0.05, 0))), 0.72, 16, name='clock_ring')
K.P('plaster_white', K.cyl_bm, tuple(cc - V((0, 0.05, 0))), tuple(cc - V((0, 0.07, 0))), 0.6, 16, name='clock_face', mat_tint=(0.95, 0.93, 0.85))
bm = bmesh.new()
K.beam_bm(bm, cc - V((0, 0.09, 0)), cc + V((0.05, -0.09, 0.45)), 0.05, 0.015, up=V((0, -1, 0)))
K.beam_bm(bm, cc - V((0, 0.1, 0)), cc + V((0.3, -0.1, -0.12)), 0.06, 0.015, up=V((0, -1, 0)))
K.part(bm, 'cast_iron', name='clock_hands')

# ---- roofs ----------------------------------------------------------------------------------------------------------
R = K.roof_gable((nx0 + nx1) / 2 + 0.2, 0, NL - 0.4, NW, NZ, 52, 'roof_slate', eave_oh=0.35, gable_oh=0.3, thick=0.15, fascia=None,
                 barge=None, gutters=False, sag=0.07, wobble=0.02, name='nave_roof')
K.gable(nave, 1, NZ, R.z_ridge - R.lift, T, STONE, name='nave_gable_e')
Rc = K.roof_gable((cx0 + cx1) / 2, 0, CL, CW, CZ, 52, 'roof_slate', eave_oh=0.3, gable_oh=0.0, thick=0.14, fascia=None,
                  barge=None, gutters=False, sag=0.05, name='chancel_roof')
# apse half-pyramid: three triangular slopes from the chancel ridge end down to the apse eaves
zr = Rc.z_ridge
bm = bmesh.new()
top = V((cx1, 0, zr))
e = [(cx1, -CW / 2 - 0.3), (cx1 + ap + 0.3, -CW / 2 + ap), (cx1 + ap + 0.3, CW / 2 - ap), (cx1, CW / 2 + 0.3)]
ze_ = CZ - 0.3 * math.tan(math.radians(52)) + Rc.lift
for a_, b_ in zip(e[:-1], e[1:]):
    K.loft_bm(bm, [[V((*a_, ze_)), V((*b_, ze_)), top], [V((*a_, ze_ - 0.15)), V((*b_, ze_ - 0.15)), top - V((0, 0, 0.15))]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'roof_slate', name='apse_roof')
K.cornice(chan, CZ - 0.3, DRESS, steps=((0.08, 0.12), (0.16, 0.12)), name='chan_cornice')
# roof dressing: tone field, re-slated patches, terracotta crest ridge with finials, lichen, lead flashings
tp = math.tan(math.radians(52))
SKY = [(-4.5, -NW * 0.22), (1.5, -NW * 0.3), (5.5, NW * 0.25)]
for RR, nm in ((R, 'nave'), (Rc, 'chancel')):
    roof_tone(RR, amp=0.22, scale=0.3, streak=0.1, seed=SEED + len(nm))
    roof_weather(RR, seed=SEED + len(nm), bay=3.8 if nm == 'nave' else 3.0, sag=0.06 if nm == 'nave' else 0.045,
                 keep=SKY if nm == 'nave' and not RUIN else ())
    roof_decals(RR, 6 if nm == 'nave' else 2, seed=SEED + 2, alpha=0.3)
ridge_tiles(R.w(-(NL - 0.4) / 2 - 0.05, 0, R.z_ridge + 0.03), R.w((NL - 0.4) / 2 + 0.3, 0, R.z_ridge + 0.03), mid='roof_tile_flat',
            tint=(0.85, 0.72, 0.62), r=0.16, crest=True, finials=True, name='nave_crest')
ridge_tiles(Rc.w(-CL / 2 - 0.2, 0, Rc.z_ridge + 0.03), Rc.w(CL / 2, 0, Rc.z_ridge + 0.03), mid='roof_tile_flat', tint=(0.85, 0.72, 0.62),
            r=0.14, crest=True, finials=False, name='chancel_crest')
bm = bmesh.new()                                         # lead flashings: nave roof against the tower, chancel against the nave
for xw_, half, zr_, ze_w in ((tx1 + 0.04, TS / 2 + 0.1, R.z_ridge, NZ + R.lift), (nx1 + 0.04, CW / 2 + 0.3, Rc.z_ridge, CZ + Rc.lift)):
    for s_ in (-1, 1):
        a_ = V((xw_, s_ * half, zr_ - half * tp + 0.02))
        K.beam_bm(bm, a_, V((xw_, 0, zr_ + 0.02)), 0.34, 0.03, up=V((1, 0, 0)))
K.part(bm, 'steel_galv', name='lead_flashing', mat_tint=(0.5, 0.52, 0.56), grime=0.4)
if not RUIN:
    from eu_common import skylights
    skylights(R, SKY)
# tower roof
tc = V((tx0 + TS / 2, 0, TZ))
if base == 'a' and RUIN:       # spire shot away (stub + shattered belfry built in the ruin pass)
    z_top = TZ + 0.5
elif base == 'a':
    SP = 11.5
    K.P('roof_slate', K.cyl_bm, tuple(tc - V((0, 0, 0.05))), tuple(tc + V((0, 0, SP))), TS * 0.62, 8, r1=0.02, name='spire')
    for e_ in range(4):     # corner broaches
        a = math.pi / 4 + e_ * math.pi / 2
        pc = tc + V((math.cos(a) * TS * 0.48, math.sin(a) * TS * 0.48, 0))
        K.P('roof_slate', K.cyl_bm, tuple(pc), tuple(pc + V((0, 0, 1.6))), 0.7, 4, r1=0.02, name='broach%d' % e_)
    for e_ in range(4):     # spire lucarnes
        a = e_ * math.pi / 2
        d = V((math.cos(a), math.sin(a), 0))
        p = tc + d * TS * 0.42 + V((0, 0, 2.6))
        K.P('timber_grey', K.box_bm, tuple(p), (0.6 if abs(d.x) < 0.5 else 0.5, 0.5 if abs(d.x) < 0.5 else 0.6, 1.1), name='luc%d' % e_)
        K.P('roof_slate', K.cyl_bm, tuple(p + V((0, 0, 0.55))), tuple(p + V((0, 0, 1.2))), 0.5, 4, r1=0.02, name='lucr%d' % e_)
    z_top = TZ + SP
else:   # saddle-back (batiere) roof with gables on the tower
    Rt = K.roof_gable(tc.x, 0, TS + 0.2, TS + 0.2, TZ, 55, 'roof_slate', rot=math.pi / 2, eave_oh=0.25, gable_oh=0.0, fascia=None,
                      barge=None, gutters=False, name='tower_roof')
    K.gable(tower, 0, TZ, Rt.z_ridge - Rt.lift, T + 0.2, STONE, name='tg_s')
    K.gable(tower, 2, TZ, Rt.z_ridge - Rt.lift, T + 0.2, STONE, name='tg_n')
    z_top = Rt.z_ridge
    for yy in (-TS / 2 + (T + 0.2) / 2, TS / 2 - (T + 0.2) / 2):   # gable copings, kneelers and apex crosses
        for sx in (-1, 1):
            a_ = V((tc.x + sx * (TS / 2 + 0.12), yy, TZ + 0.05))
            b_ = V((tc.x, yy, Rt.z_ridge - Rt.lift + 0.12))
            K.P(DRESS, K.beam_bm, a_ + V((0, 0, 0.1)), b_ + V((0, 0, 0.1)), T + 0.45, 0.16, name='tg_coping')
            K.P(DRESS, K.box_bm, (tc.x + sx * (TS / 2 - 0.2), yy, TZ + 0.05), (0.75, T + 0.45, 0.45), name='tg_kneeler')
        K.P(DRESS, K.box_bm, (tc.x, yy, Rt.z_ridge - Rt.lift + 0.45), (0.35, 0.3, 0.55), name='tg_apex', taper=(0.6, 0.6))
if not RUIN:
  bm = bmesh.new()                                   # iron cross + cockerel vane
  K.cyl_bm(bm, tuple(tc + V((0, 0, z_top - TZ - 0.2))), tuple(tc + V((0, 0, z_top - TZ + 2.0))), 0.04, 6)
  K.beam_bm(bm, tc + V((-0.45, 0, z_top - TZ + 1.3)), tc + V((0.45, 0, z_top - TZ + 1.3)), 0.06, 0.06)
  K.box_bm(bm, tuple(tc + V((0.1, 0, z_top - TZ + 2.1))), (0.45, 0.04, 0.3))
  K.part(bm, 'cast_iron', name='cross')
K.anchor('bell', tuple(tc - V((0, 0, TZ - 13.5))), kind='bell')
K.anchor('roof_ridge', (0, 0, R.z_ridge))
K.anchor('sniper_nest', tuple(tc - V((0, 0, TZ - 12.7))), (0, -1, 0), kind='belfry')

# ---- south porch (timber on a dwarf wall) -------------------------------------------------------------------------
px, pw, pd = nf[2].o.x, 3.2, 3.0
bm = bmesh.new()
for sx in (-1, 1):
    K.box_bm(bm, (px + sx * (pw / 2 - 0.2), ny0 - pd / 2, 0.45), (0.4, pd, 0.9))
K.part(bm, DRESS, name='porch_dwarf')
bm = bmesh.new()
for sx in (-1, 1):
    for yy in (ny0 - pd + 0.1, ny0 - 0.3):
        K.beam_bm(bm, (px + sx * (pw / 2 - 0.2), yy, 0.9), (px + sx * (pw / 2 - 0.2), yy, 2.9), 0.16, 0.16)
    K.beam_bm(bm, (px + sx * (pw / 2 - 0.2), ny0 - pd + 0.1, 2.95), (px + sx * (pw / 2 - 0.2), ny0, 2.95), 0.18, 0.18)
    for yy in (ny0 - pd + 0.6, ny0 - pd / 2, ny0 - 0.8):
        K.beam_bm(bm, (px + sx * (pw / 2 - 0.2), yy, 0.95), (px + sx * (pw / 2 - 0.2), yy, 2.8), 0.06, 0.05, up=V((1, 0, 0)))
K.beam_bm(bm, (px - pw / 2, ny0 - pd + 0.1, 2.95), (px + pw / 2, ny0 - pd + 0.1, 2.95), 0.2, 0.2)
K.part(bm, 'timber_beam', name='porch_frame', uv='beam', axis=(0, 0, 1), tint=(0.8, 0.72, 0.62))
Rp = K.roof_gable(px, ny0 - pd / 2 + 0.1, pd + 0.2, pw, 3.05, 48, 'roof_slate', rot=math.pi / 2, eave_oh=0.3, gable_oh=0.3,
                  fascia=None, barge='timber_beam', gutters=False, name='porch_roof')
K.footprint([(px - pw / 2, ny0 - pd), (px + pw / 2, ny0 - pd), (px + pw / 2, ny0), (px - pw / 2, ny0)], 'LOW', 'porch')
K.footprint([(px - pw / 2 + 0.4, ny0 - pd), (px + pw / 2 - 0.4, ny0 - pd), (px + pw / 2 - 0.4, ny0), (px - pw / 2 + 0.4, ny0)], 'NONE', 'porch_passage')

# ---- weathering ---------------------------------------------------------------------------------------------------------
for i in range(8):
    K.decal('lichen', (r.uniform(nx0 + 1, nx1 - 1), ny0 - 0.1, r.uniform(1.5, 6.0)), (0, -1, 0), r.uniform(0.8, 1.6), r.uniform(0.8, 1.6), alpha=0.6)
for i in range(4):
    K.decal('streak_long', (tx0 - 0.12, r.uniform(-2, 2), r.uniform(8, 14)), (-1, 0, 0), 0.8, 3.5, alpha=0.6)
    K.decal('damp_base', (r.uniform(nx0 + 1, nx1 - 1), ny1 + 0.1, 0.6), (0, 1, 0), 2.5, 1.2)
K.decal('moss_patch', (tx0 + TS / 2, TS / 2 + 0.12, 0.6), (0, 1, 0), 2.4, 0.9)
K.decal('poster_fr', (nx0 + 1.2, ny0 - 0.1, 1.6), (0, -1, 0), 0.6, 0.85)

if RUIN:   # St-Lo 1944: gutted, roofless nave with jagged wall heads, shattered belfry, chancel holed, heaps inside and out
    import random
    rq = random.Random(SEED)
    eu_dmg.remove_parts(lambda o: o.name.startswith(('nave_roof', 'nave_crest', 'lead_flashing', 'roof_patches')) or
                        (o.name.startswith('lan') and o.data.materials and o.data.materials[0].get('kit_id') in
                         ('glass_dirty', 'interior_dark', 'wood_paint', 'curtain')))     # burnt-out lancets: empty openings
    floor_slab(K.poly_offset(K.ccw(nave), -T), 0.12, name='nave_floor', joists=False, mid='ashlar_limestone')
    own = lambda o: o.name.startswith(('nave_', 'bs', 'bn', 'sill_course', 'plinth_chamfer', 'lan', 'porch'))
    bx = []
    for e_ in range(4):
        a_, b_ = nave[e_], nave[(e_ + 1) % 4]
        if e_ == 0:     # south wall (faces the camera): deep jagged loss down to the lancet sills, two V-shaped bites
            bxe, _ = eu_dmg.ragged_boxes(a_, b_, NZ - 0.4, 2.9, thick=T + 1.4, seed=SEED + 21, seg=(0.5, 1.4), step=1.8, keep_ends=1.2)
        elif e_ == 2:
            bxe, _ = eu_dmg.ragged_boxes(a_, b_, NZ - 0.6, 3.6, thick=T + 1.4, seed=SEED + 23, seg=(0.5, 1.5), step=1.5, keep_ends=1.0)
        else:           # gable ends: stepped down from the lost gable
            bxe, _ = eu_dmg.ragged_boxes(a_, b_, NZ + 0.2, NZ - 2.8, thick=T + 1.4, seed=SEED + e_, seg=(0.6, 1.6), step=1.2)
        bx += bxe
    for (bxx, bz, bw) in ((nx0 + 6.4, 2.6, 1.6), (nx1 - 2.4, 3.4, 1.2)):          # V-shaped bites into the south wall head
        for j in range(5):
            bx.append(eu_dmg.Box(V((bxx + (j % 2) * 0.15, ny0, bz + j * 0.5 + 6)), (1, 0, 0), (0, 1, 0), (0, 0, 1),
                                 (0.3 + j * bw * 0.22, (T + 1.4) / 2, 6)))
    eu_dmg.carve(bx, only=own)
    tb = []
    for e_ in range(4):                                   # shattered belfry: stepped breaks down into the belfry stage
        a_, b_ = tower[e_], tower[(e_ + 1) % 4]
        bxe, _ = eu_dmg.ragged_boxes(a_, b_, TZ - 0.6, 12.0, thick=T + 1.2, seed=SEED + 10 + e_, seg=(0.6, 1.5), keep_ends=0.9)
        tb += bxe
    eu_dmg.carve(tb, only=lambda o: o.name.startswith(('tower', 'bvs', 'louvres', 'belfry', 'quoins', 'clock', 'bt')))
    eu_dmg.blast((nx1 - 3.2, ny0, 3.6), 1.8, 0.0, (1.1, 1.3, 1.2), SEED + 1, mids=(STONE,))
    eu_dmg.blast((tx0 + 1.0, -TS / 2, 4.0), 1.5, 0.0, (1.2, 1.4, 1.1), SEED + 2, mids=(STONE,))
    eu_dmg.roof_breach(Rc, [(-0.8, -CW * 0.2, 1.4)], seed=SEED)
    bm, bc = bmesh.new(), bmesh.new()                     # charred trusses: surviving tie beams, fallen principals
    # tie beams dropped when the roof burnt: one end still lodged in the north wall, the other on the floor / heaps,
    # skewed along the nave (a level N-S beam reads as an upright pole from the 40 deg camera)
    for (x0_, z0_, x1_, y1_, z1_) in ((nx0 + 3.2, 3.2, nx0 + 6.6, ny0 + 1.6, 0.9), (nx1 - 4.2, 3.4, nx1 - 7.4, ny0 + 2.2, 0.35)):
        eu_dmg.splinter_bm(bm, V((x0_, ny1 - T + 0.35, z0_)), V((x1_, y1_, z1_)), 0.28, 0.32, rq, 0.5)
    for k in range(4):
        x = nx0 + 3.0 + k * 3.8
        a_ = V((x + rq.uniform(-0.4, 0.4), ny0 + 1.0, rq.uniform(0.4, 1.4)))       # fallen principals resting on the heaps
        b_ = V((x + rq.uniform(-2.0, 2.0), rq.uniform(0.0, 2.5), rq.uniform(0.2, 0.9)))
        eu_dmg.splinter_bm(bc, a_, b_, 0.22, 0.26, rq, 0.4)
    K.part(bm, 'timber_tarred', name='truss_ties', uv='beam', axis=(0, 1, 0))
    K.part(bc, 'timber_tarred', name='truss_fallen', uv='beam', axis=(0, 1, 0), tint=(0.7, 0.65, 0.6))
    bm = bmesh.new()                                      # spire gone: charred stub frame inside the broken belfry
    for k in range(5):
        a = k * math.pi / 2.5
        K.beam_bm(bm, tc + V((math.cos(a) * 1.8, math.sin(a) * 1.8, -4.5)), tc + V((math.cos(a) * 0.6, math.sin(a) * 0.6, -2.2 + 0.5 * (k % 3))), 0.2, 0.22)
    K.part(bm, 'timber_tarred', name='spire_stub', uv='beam', axis=(0, 0, 1), tint=(0.5, 0.45, 0.4))
    eu_dmg.heap((nx0 + 4.5, 0.5, 0.1), 2.8, 1.6, stone=STONE, dress=DRESS, tiles='roof_slate', seed=SEED + 3, name='heap_nave', footprint=False, n=20)
    eu_dmg.heap((nx1 - 5.0, -0.8, 0.1), 2.4, 1.2, stone=STONE, dress=DRESS, tiles='roof_slate', seed=SEED + 4, name='heap_nave2', footprint=False, n=14)
    eu_dmg.heap((tx0 - 1.8, -TS / 2 - 1.2, 0), 2.8, 1.3, stone=STONE, dress=DRESS, tiles='roof_slate', seed=SEED + 5, name='heap_tower', elong=1.3, n=20)
    eu_dmg.heap((nx1 - 3.2, ny0 - 1.8, 0), 2.0, 0.9, stone=STONE, dress=DRESS, tiles=None, seed=SEED + 6, name='heap_south', n=12)
    scorch_openings(0.8)
finish(OUT)
