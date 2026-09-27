"""M3 Sysendam-type concrete arch-gravity dam (27 m crest x 4 m x 14.5 m), reworked. The DOWNSTREAM face now faces
the fixed yaw-0 camera (Blender -Y = game south); the reservoir is north (+Y). Curved in plan (convex upstream),
battered downstream face with lift-joint lines, contraction-joint ribs, weep-hole drains, calcite streaks; gated
spillway (2 bays, vertical-lift gates, hoist frames, walkway bridge) discharging into a stepped concrete CHUTE with
training walls, a STILLING BASIN (baffle blocks, end sill, apron) and riprap; bottom-outlet valve house; crest road
with parapets, coping and lamps; toe ledge (bomb marker); gorge walls of real jointed rock (Poly Haven 'cliff_side',
CC0) instead of boulders; control shack on the east bank. Reservoir level -1.2, tailwater -12.3.
Variants: dam_arch | dam_arch_snow | dam_arch_destroyed (V-breach with torn lift joints + rebar, fractured blocks,
released water sheet + spray)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
import brfix3 as F3   # round-4: waterline band, LOD triangle targets, ice v3, lamp v2
from brlib import K, C, V, box_bm, beam_bm, cyl_bm
import bmesh, bpy
from mathutils import noise as N
import kit_weather as W
from kit_bridge import lamp_post
part = F.part
F.ALIAS.update({'conc': ('concrete_board', (0.78, 0.78, 0.76), 1.0), 'conc_dark': ('concrete_bunker', (0.62, 0.62, 0.6), 1.0),
                'rock': ('rock_cliff', None, 2.2), 'conc_dam': ('concrete_dam', (0.84, 0.84, 0.82), 1.0),
                'conc_slab': ('concrete_slab', (0.7, 0.7, 0.68), 1.0)})

a = BL.args()
name = a[0] if a else 'dam_arch'
snow, destroyed = name.endswith('_snow'), name.endswith('_destroyed')
RES, TAIL, BASE = -1.2, -12.3, -14.5
RP, HALF = 22.0, 13.5
TH0 = math.asin(HALF / RP)
YC = -2.0 + RP
FL = -1.0                                       # plan flip: downstream toward -Y (camera)
K.begin(name, 3, theater='snow' if snow else 'frost', snow=snow, water_level=TAIL)
r = K.rng()
SPW = math.radians(7.5)


def P(th, t, z):
    """Plan position at arc angle th, t metres downstream of the upstream face (downstream = -Y)."""
    return V((math.sin(th) * (RP - t), FL * (YC - math.cos(th) * (RP - t)), z))


def loft(th0, th1, sec, n, mid, nm, **kw):
    rings = [[P(th0 + (th1 - th0) * i / n, t, z) for t, z in sec] for i in range(n + 1)]
    bm = bmesh.new()
    C.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return part(bm, mid, name=nm, **kw)


NOF = [(0, 0.0), (4.0, 0.0), (4.0, -2.2)] + [(4.0 + 4.6 * k / 7, -2.2 + (BASE + 2.2) * k / 7) for k in range(1, 8)] + [(0, BASE)]   # dense face rows: vertex weathering gradients
OGEE = [(0, -2.5), (1.0, -2.4), (2.0, -2.7), (3.2, -3.8), (4.6, -6.0), (6.6, -10.4), (8.6, BASE), (0, BASE)]
def dam_uv(ob, z0=-2.2, tile=6.4):
    """r4: face UVs for concrete_dam - u = arc length at the vertex radius, v = height above the crest lift line, so
    the texture's 1.6 m lift joints / efflorescence / streaks line up with the geometric lift bands."""
    me = ob.data
    uv = me.uv_layers.active
    for poly in me.polygons:
        for li in poly.loop_indices:
            q = ob.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            c = YC - q.y / FL
            th = math.atan2(q.x, c)
            uv.data[li].uv = (th * math.hypot(q.x, c) / tile + 0.31, (q.z - z0) / tile)
    return ob


for s in (-1, 1):
    ta, tb = sorted((s * SPW, s * TH0))
    dam_uv(loft(ta, tb, NOF, 26, 'conc_dam', 'dam_body_%d' % (s + 1), uv='keep' if False else 'aligned'))
loft(-SPW, SPW, OGEE, 8, 'conc', 'dam_spillway', grime=1.2)
dam_uv(loft(-TH0 * 0.92, TH0 * 0.92, [(7.3, TAIL + 0.3), (9.8, TAIL + 0.3), (9.8, BASE), (7.3, BASE)], 20, 'conc_dam', 'toe_ledge'))
npan = 16                                            # r4: paved toe walk - jointed slabs, nosing, edge kerb, bollards
bm = bmesh.new()
for i in range(npan):
    ta = -TH0 * 0.92 + 1.84 * TH0 * i / npan + 0.0012
    tb = -TH0 * 0.92 + 1.84 * TH0 * (i + 1) / npan - 0.0012
    rings = [[P(ta + (tb - ta) * k / 2, t, z) for t, z in ((7.32, TAIL + 0.37), (9.86, TAIL + 0.37), (9.86, TAIL + 0.27), (7.32, TAIL + 0.27))]
             for k in range(3)]
    C.loft_bm(bm, rings)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
part(bm, 'conc_slab', name='toe_walk', bisect=False)
loft(-TH0 * 0.92, TH0 * 0.92, [(9.5, TAIL + 0.37), (9.84, TAIL + 0.37), (9.84, TAIL + 0.55), (9.56, TAIL + 0.55)], 20, 'conc_dark', 'toe_kerb', bisect=False)
bm = bmesh.new()
for th in (-TH0 * 0.7, -TH0 * 0.3, TH0 * 0.3, TH0 * 0.7):
    q = P(th, 9.2, TAIL + 0.37)
    cyl_bm(bm, q, q + V((0, 0, 0.45)), 0.13, 8, r1=0.1)
    cyl_bm(bm, q + V((0, 0, 0.45)), q + V((0, 0, 0.52)), 0.16, 8, r1=0.12)
part(bm, 'cast_iron', name='toe_bollards', bisect=False, grime=0.6)
# lift-joint lines (thin projecting bands every 1.6 m) + contraction-joint ribs on the downstream face
bm = bmesh.new()
z = -2.2 - 1.6
while z > TAIL + 0.6:
    t = 4.0 + (8.6 - 4.0) * (-2.2 - z) / (-2.2 - BASE)
    for s in (-1, 1):
        ta, tb = sorted((s * (SPW + 0.02), s * TH0 * 0.99))
        rows = [[P(ta + (tb - ta) * i / 14, t - 0.02, z), P(ta + (tb - ta) * i / 14, t + 0.035, z + 0.02),
                 P(ta + (tb - ta) * i / 14, t + 0.035, z + 0.09), P(ta + (tb - ta) * i / 14, t - 0.02, z + 0.1)] for i in range(15)]
        C.loft_bm(bm, rows, closed=False, close_start=False, close_end=False)
    z -= 1.6
for f in bm.faces:
    f.normal_update()
part(bm, 'conc_dark', name='dam_lifts', bisect=False, grime=0.6)
bm = bmesh.new()
for i in range(1, 9):
    th = -TH0 + 2 * TH0 * i / 9
    if abs(th) < SPW + 0.02:
        continue
    beam_bm(bm, P(th, 4.05, -2.2), P(th, 8.1 + 0.05, TAIL + 0.3), 0.3, 0.08, up=tuple(P(th, 1, 0) - P(th, 0, 0)))
part(bm, 'conc', name='dam_joint_ribs', uv='beam', axis=(0, 0, 1), bisect=False)
bm = bmesh.new()                                     # weep-hole drains above the toe ledge
for i in range(16):
    th = -TH0 * 0.88 + 1.76 * TH0 * i / 15
    if abs(th) < SPW + 0.04:
        continue
    zz = TAIL + 1.4
    tz = 4.0 + 4.6 * (-2.2 - zz) / (-2.2 - BASE)
    p, q = P(th, tz - 0.1, zz), P(th, tz + 0.32, zz - 0.04)
    cyl_bm(bm, p, q, 0.07, 6)
part(bm, 'cast_iron', name='weep_pipes', grime=0.5, bisect=False)
# ---- spillway works: training walls, stilling basin (floor, baffle blocks, end sill), apron riprap
XW = math.sin(SPW) * RP + 0.25
ys = lambda t: P(0, t, 0).y                                   # plan y of the spillway axis at distance t
bm, wm, cm, pm = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
for s in (-1, 1):
    prof = [(0.2, 0.9), (3.2, -2.3), (4.6, -4.5), (6.6, -8.9), (8.6, TAIL + 1.6), (19.5, TAIL + 1.6)]
    for (ta, za), (tb, zb) in zip(prof[:-1], prof[1:]):
        p8 = [V((s * XW, ys(ta), BASE)), V((s * XW, ys(tb), BASE)), V((s * (XW + 0.6), ys(tb), BASE)), V((s * (XW + 0.6), ys(ta), BASE)),
              V((s * XW, ys(ta), za)), V((s * XW, ys(tb), zb)), V((s * (XW + 0.6), ys(tb), zb)), V((s * (XW + 0.6), ys(ta), za))]
        C.hexa_bm(wm, p8)
        c8 = [V((s * (XW - 0.1), ys(ta), za)), V((s * (XW - 0.1), ys(tb), zb)), V((s * (XW + 0.7), ys(tb), zb)), V((s * (XW + 0.7), ys(ta), za)),
              V((s * (XW - 0.1), ys(ta), za + 0.16)), V((s * (XW - 0.1), ys(tb), zb + 0.16)), V((s * (XW + 0.7), ys(tb), zb + 0.16)),
              V((s * (XW + 0.7), ys(ta), za + 0.16))]
        C.hexa_bm(cm, c8)                                                                                # coping
    for tc in (10.2, 13.2, 16.2, 19.0):                                                                  # counterforts
        zt = TAIL + 1.5
        yy = ys(tc)
        C.hexa_bm(wm, [V((s * (XW + 0.6), yy - 0.25, BASE)), V((s * (XW + 0.6), yy + 0.25, BASE)), V((s * (XW + 2.4), yy + 0.25, BASE)),
                       V((s * (XW + 2.4), yy - 0.25, BASE)), V((s * (XW + 0.6), yy - 0.25, zt)), V((s * (XW + 0.6), yy + 0.25, zt)),
                       V((s * (XW + 0.9), yy + 0.25, zt)), V((s * (XW + 0.9), yy - 0.25, zt))])
    for tc in (11.7, 14.7, 17.7):                                                                        # weep pipes
        cyl_bm(pm, V((s * XW + s * 0.05, ys(tc), TAIL + 0.7)), V((s * XW - s * 0.25, ys(tc), TAIL + 0.66)), 0.06, 6)
bmesh.ops.recalc_face_normals(wm, faces=wm.faces)
bmesh.ops.recalc_face_normals(cm, faces=cm.faces)
part(wm, 'conc_dam', name='spill_walls')
part(cm, 'conc_dark', name='spill_wall_coping', bisect=False)
part(pm, 'cast_iron', name='spill_weeps', bisect=False, grime=0.6)
box_bm(bm, (0, ys(14.0), TAIL - 1.6), (2 * XW, abs(ys(19.5) - ys(8.6)), 0.8))                          # basin floor
box_bm(bm, (0, ys(19.2), TAIL - 0.55), (2 * XW, 0.6, 1.3))                                             # end sill
for k in range(5):
    box_bm(bm, (-XW + (k + 0.5) * 2 * XW / 5, ys(12.5), TAIL - 0.75), (0.7, 0.7, 1.0))                  # baffle blocks
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
part(bm, 'conc_dark', name='spill_basin')
F.riprap_ring([(-XW - 1, ys(20.2)), (XW + 1, ys(20.2))], TAIL, n=16, smin=0.4, smax=0.8, off=(0.0, 1.2), name='apron_riprap',
              mid='rock', out_dir=(0, -1, 0))
# ---- crest: road, parapets + coping, lamps
for s in (-1, 1):
    ta, tb = sorted((s * (SPW + 0.03), s * TH0))
    loft(ta, tb, [(0.55, 0.06), (3.45, 0.06), (3.45, -0.02), (0.55, -0.02)], 12, 'conc_dark', 'crest_road%d' % s, bisect=False, lod='keep')
    for t0 in (0.0, 3.55):
        loft(ta, tb, [(t0, 0.0), (t0 + 0.45, 0.0), (t0 + 0.45, 1.0), (t0, 1.0)], 12, 'conc', 'parapet', bisect=False)
        loft(ta, tb, [(t0 - 0.06, 1.0), (t0 + 0.51, 1.0), (t0 + 0.51, 1.12), (t0 - 0.06, 1.12)], 12, 'conc_dark', 'coping', bisect=False)
    lamp_post(tuple(P(s * (SPW + 0.35), 3.25, 0.06)), 4.0, name='lamp')
    lamp_post(tuple(P(s * TH0 * 0.95, 0.8, 0.06)), 4.0, name='lamp')
# ---- spillway gate piers, gates, hoist frames, walkway bridge
bm, gm, hm = bmesh.new(), bmesh.new(), bmesh.new()
for th in (-SPW, 0.0, SPW):
    box_bm(bm, tuple(P(th, 2.2, -1.25)), (0.9, 5.4, 2.6), rot_z=FL * th)
    cyl_bm(bm, P(th, 4.6, -3.2), P(th, 4.6, 0.0), 0.45, 8)
for th0, th1 in ((-SPW, 0.0), (0.0, SPW)):
    tm = (th0 + th1) / 2
    wbay = (th1 - th0) * RP - 0.9
    box_bm(gm, tuple(P(tm, 0.7, -1.55)), (wbay + 0.2, 0.14, 2.1), rot_z=FL * tm)
    for zz in (-2.3, -1.8, -1.3, -0.8):
        box_bm(gm, tuple(P(tm, 0.83, zz)), (wbay + 0.1, 0.12, 0.12), rot_z=FL * tm)
    for dx in (-0.3, 0.3):
        box_bm(hm, tuple(P(tm + dx / RP, 0.7, 1.4)), (0.14, 0.14, 2.8), rot_z=FL * tm)
    box_bm(hm, tuple(P(tm, 0.7, 2.85)), (1.0, 0.5, 0.35), rot_z=FL * tm)
    cyl_bm(hm, P(tm, 0.7, -0.4), P(tm, 0.7, 2.7), 0.05, 6)
    cyl_bm(hm, P(tm - 0.25 / RP, 1.05, 2.85), P(tm + 0.25 / RP, 1.05, 2.85), 0.32, 12)
part(bm, 'conc', name='spill_piers')
part(gm, 'steel_painted', name='gates', tint=(0.5, 0.55, 0.5), grime=1.0)
part(hm, 'cast_iron', name='hoists', grime=0.6, bisect=False)
loft(-SPW - 0.03, SPW + 0.03, [(0.2, 0.06), (3.8, 0.06), (3.8, -0.35), (0.2, -0.35)], 8, 'conc_dark', 'walkway', bisect=False, lod='keep')
for t0 in (0.25, 3.75):
    pts = [P(-SPW + 2 * SPW * i / 6, t0, 0.06) for i in range(7)]
    for p0, p1 in zip(pts[:-1], pts[1:]):
        BL.rail_simple(p0, p1, 1.05, 1.2, 'steel_painted', (0.5, 0.55, 0.5), name='walk_rail')
# ---- bottom outlet: valve house on the toe ledge (west), outlet pipe + gate valve discharging into the tailwater
vt = -TH0 * 0.55
c = P(vt, 8.6, TAIL + 0.3)
bm = bmesh.new()
box_bm(bm, (c.x, c.y, c.z + 1.3), (2.6, 2.0, 2.6), rot_z=FL * vt)
pl = P(vt + 0.06, 10.7, TAIL - 0.6)
box_bm(bm, (pl.x, pl.y, pl.z), (1.6, 1.8, 1.8), rot_z=FL * vt)
part(bm, 'conc', name='valve_house')
bm = bmesh.new()
C.box_bm(bm, (c.x, c.y, c.z + 2.72), (3.0, 2.6, 0.22), FL * vt)
part(bm, 'conc_dark', name='valve_house_roof')
bm = bmesh.new()
cyl_bm(bm, P(vt + 0.06, 8.0, TAIL - 0.2), P(vt + 0.06, 12.2, TAIL - 0.2), 0.45, 12)
cyl_bm(bm, P(vt + 0.06, 11.0, TAIL - 0.2), P(vt + 0.06, 11.25, TAIL - 0.2), 0.62, 12)
cyl_bm(bm, P(vt + 0.06, 11.1, TAIL + 0.3), P(vt + 0.06, 11.1, TAIL + 1.4), 0.05, 6)
cyl_bm(bm, P(vt + 0.06, 11.1, TAIL + 1.4) - V((0.3, 0, 0)), P(vt + 0.06, 11.1, TAIL + 1.4) + V((0.3, 0, 0)), 0.3, 10)
part(bm, 'cast_iron', name='outlet', grime=0.8)
dr = P(vt, 9.48, TAIL + 0.3)
W.decal('streak_rust', (dr.x, dr.y - 0.03, dr.z + 1.0), (0, -1, 0), 0.9, 1.8, alpha=0.5)
def orient(ob, ok):
    """Force face orientation after part() (its recalc can flip an open sheet inside out)."""
    me = ob.data
    bm_ = bmesh.new()
    bm_.from_mesh(me)
    bm_.normal_update()
    nf = 0
    for f in bm_.faces:
        if not ok(f.normal, f.calc_center_median()):
            f.normal_flip()
            nf += 1
    bm_.to_mesh(me)
    bm_.free()
    C.log('orient %s flipped %d/%d' % (ob.name, nf, len(me.polygons)))
    return ob


def rock_uv(ob, f, tile=1.83 * 2.2):
    me = ob.data
    uv = me.uv_layers.active
    for poly in me.polygons:
        for li in poly.loop_indices:
            a_, b_ = f(me.vertices[me.loops[li].vertex_index].co)
            uv.data[li].uv = (a_ / tile, b_ / tile)
    return ob


def crag_snow(g, s):
    """Snow mantle on the rim crags: a copy of the crag heightfield lifted on flat ground and sunk below the rock on
    slopes / noisy spots, so the snow edge is the irregular intersection contour (no flat quads, no hard borders)."""
    sm = bmesh.new()
    col = sm.loops.layers.color.new('Col2')
    G = []
    for i, row in enumerate(g):
        R = []
        for j, v in enumerate(row):
            a = g[max(0, i - 1)][j]
            b = g[min(len(g) - 1, i + 1)][j]
            c_ = row[max(0, j - 1)]
            d_ = row[min(len(row) - 1, j + 1)]
            nrm = (b - a).cross(d_ - c_)
            nz = abs(nrm.normalized().z) if nrm.length > 1e-6 else 1.0
            off = 0.16 * max(0.0, min(1.0, (nz - 0.72) / 0.18)) - 0.06 + 0.07 * N.noise(v * 0.9 + V((4, 4, 4)))
            R.append((sm.verts.new(v + V((0, 0, off))), off))
        G.append(R)
    for i in range(len(G) - 1):
        for j in range(len(G[i]) - 1):
            q = (G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1])
            if all(o < 0 for _, o in q):
                continue
            f = sm.faces.new([v for v, _ in q])
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            for l in f.loops:
                t = 0.9 + 0.08 * N.noise(l.vert.co * 1.3)
                l[col] = (t * 0.97, t * 0.98, t, 1.0)
    bmesh.ops.delete(sm, geom=[v for v in sm.verts if not v.link_faces], context='VERTS')
    F.apply_col2(part(sm, 'snow', name='snow_crag_%d' % (s + 1), grime=0, bisect=False, smooth=True, jitter=0.0))


# ---- gorge walls of jointed rock: the valley narrows onto the dam flanks (rock keying), crags on the rim
def x_wall(y):
    if y > -2.0:
        return HALF
    if y > -9.6:
        return HALF + (8.4 - HALF) * (-2.0 - y) / 7.6
    return 8.4 + (HALF + 1.5 - 8.4) * min(1.0, (-9.6 - y) / 11.0)


for s in (-1, 1):
    bm = bmesh.new()
    ys_ = [8.0 - k * 1.1 for k in range(28)]
    zs_ = [BASE + 1.0, TAIL - 1.2, TAIL + 0.4, TAIL + 2.0, -8.5, -6.5, -4.6, -2.8, -1.2, 0.0, 0.35]
    grid = []
    for y in ys_:
        row = []
        for z in zs_:
            if y > 3.0 and z < RES - 1.5:
                z = RES - 1.5 + (z - BASE) * 0.02          # reservoir side: only the rim shows
            strata = 0.35 * math.floor(z / 1.3 + 0.5 * N.noise(V((y * 0.1, 0, 0))))
            off = 1.1 * N.noise(V((y * 0.35, z * 0.3, s * 3.1))) + 0.4 * N.noise(V((y * 1.1, z * 0.9, 7.0))) + strata * 0.4
            row.append(bm.verts.new((s * (x_wall(y) - 0.6 + off), y, z)))
        grid.append(row)
    for i in range(len(ys_) - 1):
        for j in range(len(zs_) - 1):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.normal_update()
            if f.normal.x * s > 0:
                f.normal_flip()
    g_ob = part(bm, 'rock', name='gorge_%d' % (s + 1), grime=0.7, bisect=False, smooth=True, jitter=0.0)
    orient(g_ob, lambda n, c, s=s: n.x * s < 0)            # r4: both walls face the gorge
    rock_uv(g_ob, lambda q, s=s: (-s * q.y, q.z))            # r4: right-handed (T x B = N) on both banks - the east wall's
                                                             # mirrored UVs inverted its normal map (dark blue-grey look)
    bm = bmesh.new()                                         # rim crags (leave the crest-road gap y -6.6..-1.6)
    grids = []
    for y0, y1 in ((-24.0, -7.2), (-1.0, 9.0)):
        ny, nx = int((y1 - y0) / 0.9), 7
        g = []
        for i in range(ny + 1):
            y = y0 + (y1 - y0) * i / ny
            row = []
            for j in range(nx + 1):
                u = j / nx
                x = x_wall(y) - 0.5 + u * 6.0 + 0.25 * N.noise(V((y * 0.7, j, 3.0)))
                edge = max(0.0, min(1.0, (y - y0) / 2.5, (y1 - y) / 2.5))
                q = V((x * 0.22, y * 0.22, 5.0 + s))            # same rock family both banks: smooth fbm outcrops +
                h = 0.5 + 0.5 * N.noise(q) + 0.25 * N.noise(q * 2.3) + 0.12 * N.noise(q * 5.1)     # soft bedding ledges
                h = (0.25 + 2.4 * (1 - u) ** 0.8 * edge) * (0.55 + 0.7 * h)
                h += 0.18 * math.sin(h * 4.2) if u < 0.8 else 0.0
                h = h if u < 0.95 else 0.04
                row.append(bm.verts.new((s * x, y, max(0.04, h))))
            g.append(row)
        grids.append([[v.co.copy() for v in row_] for row_ in g])
        for i in range(ny):
            for j in range(nx):
                f = bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]))
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
    rock_uv(orient(part(bm, 'rock', name='crags_%d' % (s + 1), grime=0.8, bisect=False, smooth=True, jitter=0.0), lambda n, c: n.z > 0),
            lambda q: (q.y, -q.x))
    if snow:
        for gi, gg in enumerate(grids):
            crag_snow(gg, s * (gi + 1))
# ---- r4: the rectangular streak decals are gone - leaching streaks, efflorescence and weep holes are in the
# concrete_dam texture, registered to the lift joints by dam_uv()
BL.control_shack(HALF + 4.2, -1.5 - 6.5, 3.4, 2.8, 2.7, 'conc', 'dam_shack', door_edge=3)
K.sign((HALF + 4.9, -8.0 - 1.4 - 0.03, 1.9), (0, -1, 0), 1.1, 'halt_sperrgebiet', 'timber_grey')
crest = [tuple(P(-TH0 + 2 * TH0 * i / 12, 0.5, 0))[:2] for i in range(13)] + [tuple(P(TH0 - 2 * TH0 * i / 12, 3.5, 0))[:2] for i in range(13)]
K.bridge_meta(K.Deck(-HALF, HALF, 0.06, 0.0), -HALF, HALF, 3.0, TAIL, 2 * HALF,
              {'kind': 'dam', 'orientation': 'downstream face toward -Z game (south, camera side); reservoir north',
               'reservoir': {'level': RES, 'z0': -400.0, 'z1': round(-(-FL * (YC - RP)) - 0.1, 3)},
               'tailwater': TAIL, 'destructible': True, 'crest_poly': [C.g2(p) for p in crest]})
C.A.meta['footprints'] = [f for f in C.A.meta['footprints'] if f.get('kind') != 'bridge_deck']
C.footprint(crest, 'NONE', 'bridge_deck')
ledge = [tuple(P(-TH0 * 0.9 + 1.8 * TH0 * i / 10, 7.4, 0))[:2] for i in range(11)] + [tuple(P(TH0 * 0.9 - 1.8 * TH0 * i / 10, 9.7, 0))[:2] for i in range(11)]
C.A.meta.setdefault('ledges', []).append({'points': [C.g2(p) for p in ledge], 'elev': TAIL + 0.3, 'kind': 'toe_ledge'})
C.anchor('dam_charge', tuple(P(0.12, 8.6, TAIL + 0.3)), (0, -1, 0), kind='charge_marker', radius=3.0)
for s in (-1, 1):
    C.climb_meta(tuple(P(s * TH0, 0, 0))[:2], tuple(P(0, 0, 0))[:2], 1.0, 'parapet')
BL.water_obstacle([tuple(P(-TH0 + 2 * TH0 * i / 12, 8.6, 0))[:2] for i in range(13)] + [tuple(P(TH0 - 2 * TH0 * i / 12, 0, 0))[:2] for i in range(13)], 'dam', 0.0, block=None)
if destroyed:
    yb = P(0, 0, 0).y
    poly = F.breach_outline(0.0, 4.6, 1.2, 2.5, -9.0, step=0.8)
    F.breach(poly, 60.0, fill_mid='conc_dark', fill_tint=(0.5, 0.49, 0.47),
             solid=('dam_body', 'dam_spillway', 'parapet', 'coping', 'crest_road', 'walkway', 'spill_piers', 'gates', 'hoists'))
    bm = bmesh.new()                                        # exposed, bent reinforcement at the tear
    for i in range(1, len(poly) - 1):
        (xa, za), (xb, zb) = poly[i - 1], poly[i]
        for k in range(2):
            x, z = xa + (xb - xa) * (k + 0.5) / 2, za + (zb - za) * (k + 0.5) / 2
            for t in (0.6, 2.2, 3.4):
                y0 = P(0, t, 0).y
                d = V((0.0 if abs(x) < 0.1 else -math.copysign(1, x) * 0.2, 0, 0)) + V((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(-0.2, 0.4)))
                p0 = V((x - math.copysign(0.15, x) * 0 + d.x * 0.1, y0, z))
                cyl_bm(bm, p0, p0 + d.normalized() * r.uniform(0.4, 1.1) + V((-math.copysign(0.3, x), 0, 0)), 0.018, 4, caps=False)
    part(bm, 'cast_iron', name='rebar', grime=0.4, bisect=False, tint=(0.55, 0.4, 0.3))
    F.debris_pile(0.0, P(0, 11.5, 0).y, 6.0, 4.0, TAIL - 2.0, TAIL + 1.2, mids=('conc', 'conc_dark'), n=46, name='breach_debris',
                  slabs=3, slab_mid='conc')
    bm = bmesh.new()                                        # released water: a curved sheet pouring through the notch
    lip, nx_, nz_ = RES - 0.3, 8, 10
    g = []
    for i in range(nz_ + 1):
        u = i / nz_
        t = 1.5 + 10.5 * u
        z = lip - (lip - TAIL) * u ** 1.6
        hw = 2.2 - 0.5 * u
        g.append([bm.verts.new((-hw + 2 * hw * j / nx_ + 0.15 * N.noise(V((j, i, 2.0))), P(0, t, 0).y, z)) for j in range(nx_ + 1)])
    for i in range(nz_):
        for j in range(nx_):
            f = bm.faces.new((g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]))
            f.normal_update()
            if f.normal.y > 0:
                f.normal_flip()
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    vid = {v: (j, i) for i, row in enumerate(g) for j, v in enumerate(row)}
    for f in bm.faces:                                       # u across the nappe, v along the flow (water_flow grain)
        for lo in f.loops:
            j, i = vid[lo.vert]
            lo[uvl].uv = (j / nx_ * 1.1, i / nz_ * 0.98)   # r4: single v tile (texture not v-tileable -> seam)
    part(bm, 'water_flow', name='water_sheet', uv='keep', grime=0, bisect=False, jitter=0.0)
    bm = bmesh.new()                                        # spray / foam billows at the impact zone
    for k in range(12):                                     # r4: low smooth churned-water boils (not white rocks)
        c = V((r.uniform(-2.8, 2.8), P(0, r.uniform(11.0, 15.0), 0).y, TAIL + r.uniform(-0.15, 0.25)))
        cb = W._blob_bm(c, r.uniform(0.6, 1.2), k * 3.1, (1.5, 1.2, 0.32), 2, 0.18)
        tmp = bpy.data.meshes.new('sp')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    part(bm, 'water_flow', name='spray', grime=0, bisect=False, tint=(1.0, 1.0, 1.0))
    BL.prune_empty()
    gap = [-4.6, 4.6]
    C.A.meta['bridge'].update({'destroyed': True, 'gap_x': gap, 'released_water': {'sheet': 'water_sheet', 'spray': 'spray'}})
    C.footprint([(gap[0], yb - 4.5), (gap[1], yb - 4.5), (gap[1], yb + 0.5), (gap[0], yb + 0.5)], 'HIGH', 'bridge_gap')
if snow:
    caps = [o for o in C.A.parts if o.name.startswith(('parapet', 'coping', 'crest_road', 'walkway', 'hoists', 'spill_piers', 'lamp',
                                                        'valve_house', 'walk_rail', 'spill_wall_coping'))
            and not o.name.startswith('lamp_glass')]
    F2.pillow(F.snow_caps(caps, thick=0.12, min_nz=0.4))
    for s in (-1, 1):                                        # drifted crest road with a trodden track
        ta, tb = sorted((s * (SPW + 0.03), s * TH0))
    bm = bmesh.new()                                         # frozen tailwater: ice sheet with snow patches + cracks
    F.ice_shelf([(-8.0, P(0, 9.9, 0).y), (8.0, P(0, 9.9, 0).y), (HALF - 1.0, -16.0), (-HALF + 1.0, -16.0)], TAIL, reach=(1.0, 3.0),
                name='ice_tail', floes=6, bounds=(-11, -24, 11, -14))
    ic = []                                                  # icicle curtains: spillway lip, lift-joint ledges, gates
    for i in range(14):
        th = -SPW + 2 * SPW * (i + 0.5) / 14
        ic.append(tuple(P(th, 1.6, -2.45)))
    for i in range(10):                                      # a few icicles at weep holes / lift joints (no snow bars on the face)
        th = r.uniform(-TH0 * 0.85, TH0 * 0.85)
        zc = -2.2 - 1.6 * r.randint(4, 6)
        tz = 4.0 + 4.6 * (-2.2 - zc) / (-2.2 - BASE)
        ic.append(tuple(P(th, tz + 0.03, zc)))
    F.icicles(ic, (0.3, 1.4))
F.weather(theme='temperate', step=2.6, lichen=0.3, moss=0.45, mids=F.MASONRY + ('rock_cliff',),
          soot=((0.0, P(0, 4, 0).y, -4.0), 8.0, 1) if destroyed else None, skip=('decal', 'snow', 'ice', 'spray', 'water_sheet', 'lamp'))
for o in [o for o in C.A.parts if o.name.startswith(('gorge', 'crags')) and o.name in bpy.data.objects]:
    ca = o.data.color_attributes.get('Col')                  # r4: rock albedo lifted (vcol mean 0.38 -> ~0.6) so the
    if ca:                                                    # shaded bank reads grey rock, not dark blue-grey
        for d_ in ca.data:
            c_ = d_.color
            d_.color = (min(1, c_[0] * 1.6), min(1, c_[1] * 1.6), min(1, c_[2] * 1.6), c_[3])
F2.cull_decals()
C.A.meta['review'] = {'detail': {'target': [2.5, TAIL + 3.5, 9.0], 'dir': [0.3, 0.5, 0.81], 'dist': 26.0}}   # spillway chute + basin
F2.trim_to(24300, ('gorge', 'crags', 'snow_crag', 'snow_caps', 'toe_', 'dam_lifts', 'ice_', 'breach_debris', 'rebar'))
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
