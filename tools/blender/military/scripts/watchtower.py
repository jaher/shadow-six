"""German wooden guard tower (Wachturm) as used around POW camps, depots and V2 sites 1940-45:
4 battered square-timber legs on concrete footings, girts + X-bracing on every face, joisted plank deck,
boarded parapet with open observation band, pyramidal hip roof, internal ladder through a trap hatch,
searchlight + MG 34, field telephone box, lamp. Usage:
  blender -b --factory-startup --python watchtower.py -- [variant a|snow|desert|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 11)
theater = {'snow': 'snow', 'desert': 'desert'}.get(VAR, 'temperate')
K.begin('watchtower' + ('' if VAR == 'a' else '_' + VAR), SEED, theater=theater, snow=VAR == 'snow')
r = K.rng()
DEAD = VAR == 'destroyed'
WOOD = {'a': 'timber_creosote', 'snow': 'timber_tarred', 'desert': 'timber_beam', 'destroyed': 'timber_creosote'}[VAR]
WOOD2 = {'a': 'timber_grey', 'snow': 'timber_tarred', 'desert': 'timber_beam', 'destroyed': 'timber_grey'}[VAR]
BOARD = {'a': 'timber_siding', 'snow': 'timber_tarred', 'desert': 'timber_siding', 'destroyed': 'timber_siding'}[VAR]
ROOF = {'a': 'corrugated_rust', 'snow': 'roof_shingle', 'desert': 'canvas', 'destroyed': 'corrugated_rust'}[VAR]

ZD = 5.0                 # deck top
HB, HT = 1.95, 1.3       # half-width of the leg frame at the base / at the deck
HD = 1.7                 # half-width of the deck
ZE = ZD + 2.25           # eave (cabin post tops)


def leg_xy(sx, sy, z):
    t = z / ZD
    h = HB + (HT - HB) * t
    return sx * h, sy * h


# ------------------------------------------------------------------ substructure
bm = bmesh.new()
for sx in (-1, 1):
    for sy in (-1, 1):
        x, y = leg_xy(sx, sy, 0)
        K.box_bm(bm, (x, y, 0.1), (0.55, 0.55, 0.4))
M.conc_part(bm, 'footings', 'concrete_bunker')

legs = bmesh.new()
brace = bmesh.new()
SHARDS = bmesh.new()
broken = {}
for sx in (-1, 1):
    for sy in (-1, 1):
        ztop = ZD - 0.12
        if DEAD:                                   # rework 2: the two NW legs still stand tall (snapped at 2.7-3.5 m), the
            ztop = {(-1, 1): 3.5, (-1, -1): 2.7, (1, 1): 1.5, (1, -1): 0.75}[(sx, sy)]   # SE pair broke low as the cabin fell SE
            broken[(sx, sy)] = ztop
        a = V((*leg_xy(sx, sy, 0.3), 0.3))
        b = V((*leg_xy(sx, sy, ztop), ztop))
        K.beam_bm(legs, a, b, 0.22, 0.22)
        if DEAD:                                   # splintered break: long pale shards (fresh wood) + the lost upper leg
            for k in range(5):                     # lying on the ground, pointing SE the way the tower fell
                off = V((r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), -0.05))
                tip = V((r.uniform(-0.12, 0.12) + 0.08, r.uniform(-0.12, 0.12) - 0.08, r.uniform(0.25, 0.6)))
                K.beam_bm(SHARDS, b + off, b + off + tip, r.uniform(0.05, 0.09), r.uniform(0.04, 0.07), roll=r.random())
            base = V((*leg_xy(sx, sy, 0), 0)) + V((0.5 + 0.3 * sx, -0.5 + 0.3 * sy, 0))
            L_ = (ZD - ztop) * 0.7
            d = V((0.8, -0.55, 0)).normalized()
            p0 = base + V((0, 0, 0.12)) + d * 0.3
            K.beam_bm(legs, p0, p0 + d * L_ + V((0, 0, 0.02)), 0.22, 0.22, roll=r.uniform(0, 0.4))
# girts and X bracing on each face (bolted to the outside of the legs)
levels = [0.35, 1.75, 3.35, ZD - 0.3]
faces = [((-1, -1), (1, -1), (0, -1)), ((1, -1), (1, 1), (1, 0)), ((1, 1), (-1, 1), (0, 1)), ((-1, 1), (-1, -1), (-1, 0))]
for (a, b, n) in faces:
    nv = V((n[0], n[1], 0)) * 0.16
    lim = min(broken.get(a, 99), broken.get(b, 99)) if DEAD else 99
    for z in levels[1:]:
        if z < lim:
            K.beam_bm(brace, V((*leg_xy(*a, z), z)) + nv, V((*leg_xy(*b, z), z)) + nv, 0.08, 0.16, up=(0, 0, 1))
    for i in range(len(levels) - 1):
        z0, z1 = levels[i] + 0.1, levels[i + 1] - 0.05
        if z1 > lim:
            continue
        nv2 = V((n[0], n[1], 0)) * (0.2 if i % 2 else 0.13)
        pa0, pb0 = V((*leg_xy(*a, z0), z0)), V((*leg_xy(*b, z0), z0))
        pa1, pb1 = V((*leg_xy(*a, z1), z1)), V((*leg_xy(*b, z1), z1))
        K.beam_bm(brace, pa0 + nv2, pb1 + nv2, 0.06, 0.14, up=V(n + (0,)))
        K.beam_bm(brace, pb0 + nv2 * 1.4, pa1 + nv2 * 1.4, 0.06, 0.14, up=V(n + (0,)))
WT = {'a': (0.95, 0.9, 0.85), 'destroyed': (0.8, 0.76, 0.72)}.get(VAR)
K.part(legs, WOOD, name='legs', uv='beam', axis=(0, 0, 1), mat_tint=WT)
if DEAD:
    K.part(SHARDS, WOOD2, name='leg_splinters', uv='beam', axis=(0, 0, 1), mat_tint=(1.0, 0.9, 0.72))
K.part(brace, WOOD2, name='bracing', uv='beam', axis=(1, 0, 0), jitter=0.16, mat_tint=(0.78, 0.74, 0.68) if WOOD2 == 'timber_grey' else None)
# bolts at the brace crossings (small dark squares)
bm, bp = bmesh.new(), bmesh.new()                # steel fish plates at every girt/leg joint + bolt heads, crossing bolts
for (a, b, n) in faces:
    ang = math.atan2(n[1], n[0]) + math.pi / 2
    lim = min(broken.get(a, 99), broken.get(b, 99)) if DEAD else 99
    for z in levels[1:]:
        if z > lim:
            continue
        for p in (a, b):
            q = V((*leg_xy(*p, z), z)) + V((n[0], n[1], 0)) * 0.245
            q = q - V((p[0] if n[0] == 0 else 0, p[1] if n[1] == 0 else 0, 0)) * 0.05
            K.box_bm(bp, tuple(q), (0.3, 0.012, 0.3), ang)
            for dz in (-0.08, 0.08):
                K.box_bm(bm, tuple(q + V((n[0], n[1], 0)) * 0.015 + V((0, 0, dz))), (0.045, 0.045, 0.045), ang)
    for i in range(len(levels) - 1):
        zc = (levels[i] + levels[i + 1]) / 2
        if zc > lim:
            continue
        q = (V((*leg_xy(*a, zc), zc)) + V((*leg_xy(*b, zc), zc))) / 2 + V((n[0], n[1], 0)) * 0.3
        K.box_bm(bm, tuple(q), (0.06, 0.06, 0.06), ang)
K.part(bp, 'steel_painted', name='plates', mat_tint=(0.45, 0.42, 0.38), grime=0.6, bisect=False)
K.part(bm, 'cast_iron', name='bolts', grime=0.2, bisect=False, lod='drop')

first_cab = len(K.A().parts)
# ------------------------------------------------------------------ deck
bm = bmesh.new()
for x in (-1.1, -0.35, 0.4, 1.15):          # joists (along Y) on two bearers (along X)
    K.beam_bm(bm, (x, -HD, ZD - 0.2), (x, HD, ZD - 0.2), 0.12, 0.2)
for sy in (-1, 1):
    K.beam_bm(bm, (-HD - 0.05, sy * HT, ZD - 0.38), (HD + 0.05, sy * HT, ZD - 0.38), 0.18, 0.18)
for sx in (-1, 1):                           # knee braces under the overhang
    for sy in (-1, 1):
        a = V((*leg_xy(sx, sy, ZD - 1.1), ZD - 1.1))
        K.beam_bm(bm, a, V((sx * (HD - 0.1), sy * (HD - 0.1), ZD - 0.3)), 0.1, 0.1)
K.part(bm, WOOD, name='deck_frame', uv='beam', axis=(0, 1, 0))
bm = bmesh.new()
n = int(2 * HD / 0.2)
hatch = (0.35, 1.05, -1.2, -0.45)            # x0,x1,y0,y1 trap opening (ladder)
for i in range(n):
    x0 = -HD + i * 0.2 + 0.006
    x1 = x0 + 0.188
    xc = (x0 + x1) / 2
    zj = r.uniform(-0.006, 0.006)
    if hatch[0] < xc < hatch[1]:
        K.box_bm(bm, (xc, (-HD + hatch[2]) / 2, ZD - 0.04 + zj), (0.188, hatch[2] + HD, 0.06))
        K.box_bm(bm, (xc, (hatch[3] + HD) / 2, ZD - 0.04 + zj), (0.188, HD - hatch[3], 0.06))
    else:
        K.box_bm(bm, (xc, 0, ZD - 0.04 + zj), (0.188, 2 * HD + r.uniform(-0.04, 0.04), 0.06))
K.part(bm, 'deck_planks', name='deck', uv='beam', axis=(1, 0, 0), bisect=False)
# trap-door leaf (open, leaning back)
bm = bmesh.new()
K.box_bm(bm, ((hatch[0] + hatch[1]) / 2, hatch[3] + 0.03, ZD + 0.35), (hatch[1] - hatch[0] - 0.04, 0.05, 0.7))
K.part(bm, 'door_planks', name='hatch_leaf', uv='beam', axis=(0, 0, 1))

# ------------------------------------------------------------------ cabin: corner posts, parapet, window band, roof
PH = 1.12                                    # parapet height above deck
bm = bmesh.new()
for sx in (-1, 1):
    for sy in (-1, 1):
        K.box_bm(bm, (sx * (HD - 0.08), sy * (HD - 0.08), (ZD + ZE) / 2), (0.14, 0.14, ZE - ZD))
for sx in (-1, 1):                               # mid posts on each side
    K.box_bm(bm, (sx * (HD - 0.08), 0, (ZD + ZE) / 2), (0.1, 0.1, ZE - ZD))
    K.box_bm(bm, (0, sx * (HD - 0.08), (ZD + ZE) / 2), (0.1, 0.1, ZE - ZD))
for z in (ZD + PH, ZE - 0.08):                   # rail cap + wall plate
    for sy in (-1, 1):
        K.box_bm(bm, (0, sy * (HD - 0.06), z), (2 * HD + 0.06, 0.2 if z < ZE - 1 else 0.14, 0.08))
        K.box_bm(bm, (sy * (HD - 0.06), 0, z), (0.2 if z < ZE - 1 else 0.14, 2 * HD + 0.06, 0.08))
K.part(bm, WOOD, name='cabin_frame', uv='beam', axis=(0, 0, 1))
bm = bmesh.new()                                  # vertical boards with battens (outside face)
for (ax, s) in (('x', -1), ('x', 1), ('y', -1), ('y', 1)):
    nb = int(2 * HD / 0.16)
    for i in range(nb):
        t0 = -HD + i * 2 * HD / nb + 0.004
        t1 = t0 + 2 * HD / nb - 0.008
        h = PH - 0.04 + r.uniform(-0.03, 0.02)
        if ax == 'x':
            K.box_bm(bm, ((t0 + t1) / 2, s * (HD + 0.01), ZD + h / 2), (t1 - t0, 0.03, h))
        else:
            K.box_bm(bm, (s * (HD + 0.01), (t0 + t1) / 2, ZD + h / 2), (0.03, t1 - t0, h))
K.part(bm, BOARD, name='parapet', uv='beam', axis=(0, 0, 1))
if VAR in ('a', 'destroyed', 'desert'):           # window band: glazed drop-sashes on the rear/sides, hinged storm shutters propped open at the front
    bm, bs = bmesh.new(), bmesh.new()
    for (ax, s_) in (('x', 1), ('y', 1), ('y', -1)):
        for k in (-1, 1):
            c = (k * HD / 2, s_ * (HD - 0.02), ZD + PH + 0.35) if ax == 'x' else (s_ * (HD - 0.02), k * HD / 2, ZD + PH + 0.35)
            K.box_bm(bm, c, (HD - 0.2, 0.02, 0.55) if ax == 'x' else (0.02, HD - 0.2, 0.55))
            K.box_bm(bs, (c[0], c[1], c[2] + 0.29), (HD - 0.16, 0.06, 0.05) if ax == 'x' else (0.06, HD - 0.16, 0.05))
            K.box_bm(bs, (c[0], c[1], c[2] - 0.29), (HD - 0.16, 0.06, 0.05) if ax == 'x' else (0.06, HD - 0.16, 0.05))
    for k in (-1, 1):                              # front shutters hinged at the top, propped out 40 degrees
        L = HD - 0.15
        p0 = V((k * HD / 2, -HD - 0.02, ZE - 0.12))
        d = V((0, -math.sin(math.radians(40)), -math.cos(math.radians(40))))
        K.beam_bm(bs, p0, p0 + d * 0.8, L, 0.04, up=(0, 0, 1))
        K.beam_bm(bs, p0 + d * 0.75 + V((k * 0.3, 0, 0)), V((k * HD / 2 + k * 0.3, -HD + 0.02, ZD + PH + 0.02)), 0.025, 0.025)
    K.part(bm, 'glass_dirty', name='cabin_glass', grime=0, bisect=False)
    K.part(bs, 'door_planks', name='sashes_shutters', uv='beam', axis=(1, 0, 0), mat_tint=(0.62, 0.6, 0.5))
if VAR == 'snow':                                 # Norway: window band closed with glazed sashes on 3 sides
    bm = bmesh.new()
    for (ax, s) in (('x', 1), ('y', 1), ('y', -1)):
        for k in (-1, 1):
            c = (k * HD / 2, s * (HD - 0.02), ZD + PH + 0.5) if ax == 'x' else (s * (HD - 0.02), k * HD / 2, ZD + PH + 0.5)
            K.box_bm(bm, c, (HD - 0.15, 0.02, 0.85) if ax == 'x' else (0.02, HD - 0.15, 0.85))
    K.part(bm, 'glass_dirty', name='cabin_glass', grime=0, bisect=False)
R = K.roof_gable(0, 0, 2 * HD + 0.8, 2 * HD, ZE, 28 if ROOF != 'canvas' else 22, ROOF, eave_oh=0.4, gable_oh=0.0, thick=0.06,
                 fascia='timber_beam' if ROOF != 'canvas' else None, barge=None, gutters=False, sag=0.03, wobble=0.01, hip=True)
bm = bmesh.new()                                  # finial + lamp bracket
K.cyl_bm(bm, (0, 0, R.z_ridge - 0.05), (0, 0, R.z_ridge + 0.35), 0.04, 6)
K.part(bm, 'cast_iron', name='finial', bisect=False)
K.wall_lantern((HD, 0.0, 0), (1, 0, 0), ZE - 0.35, name='lamp')

# equipment on the deck
M.searchlight((HD - 0.5, -HD + 0.5, ZD + PH + 0.04), yaw=math.radians(25), r_drum=0.4)
M.mg34((-0.5, -HD + 0.1, ZD + PH + 0.12), yaw=0.0, tripod=False)
bm = bmesh.new()                                  # field telephone box on a post, ammo box
K.box_bm(bm, (-HD + 0.3, HD - 0.25, ZD + 0.9), (0.28, 0.14, 0.34))
K.box_bm(bm, (0.9, HD - 0.5, ZD + 0.13), (0.35, 0.2, 0.22))
K.part(bm, 'steel_painted', name='boxes', mat_tint=(0.9, 0.9, 0.8), bisect=False, lod='drop')

cabin_parts = K.A().parts[first_cab:]
# ------------------------------------------------------------------ ladder (inside the frame, up through the hatch)
if not DEAD:
    K.ladder(((hatch[0] + hatch[1]) / 2, -1.85, 0.0), ZD - 0.5, (0, -1, 0), width=0.5, lean=1.05, mid=WOOD, meta=False)
    K.ladder_meta(((hatch[0] + hatch[1]) / 2, -2.3), ((hatch[0] + hatch[1]) / 2, -0.2), ZD)

# ------------------------------------------------------------------ destroyed: cabin toppled to the SE, scorch, debris
if DEAD:
    import bpy                                     # the cabin smashed on impact: blast/impact bites through roof, walls, deck
    def alive(o):
        try:
            return o.name in bpy.data.objects
        except ReferenceError:
            return False
    for k, (c, rad) in enumerate((((0.5, 0.4, ZE + 0.5), 1.25), ((-1.1, -1.0, ZD + 0.8), 1.05), ((1.3, -1.4, ZD + 1.6), 0.95), ((-0.9, 1.2, ZE), 0.9))):
        K.bite(c, rad, (1.2, 1.0, 1.1), seed=11 + k, parts=[o for o in cabin_parts if alive(o)])
    cabin_parts = [o for o in cabin_parts if alive(o)]
    T = Matrix.Translation((1.6, -1.4, 0.0)) @ Matrix.Rotation(math.radians(64), 4, 'X') @ Matrix.Rotation(math.radians(-22), 4, 'Y') \
        @ Matrix.Rotation(math.radians(17), 4, 'Z') @ Matrix.Translation((0, 0, -ZD))
    M.xform_parts(cabin_parts, T, ground=-0.06)
    sp = bmesh.new()                               # splintered ends: fans of thin shards at the broken members
    for i in range(22):
        c = V((r.uniform(-1.0, 4.0), r.uniform(-3.8, 1.0), 0.05))
        for k in range(3):
            d = V((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(0.0, 0.5))).normalized()
            K.beam_bm(sp, c, c + d * r.uniform(0.25, 0.7), r.uniform(0.02, 0.05), r.uniform(0.015, 0.03), roll=r.uniform(0, 1))
    K.part(sp, WOOD2, name='splinters', uv='beam', axis=(1, 0, 0), mat_tint=(0.7, 0.62, 0.52), lod='drop')
    K.A().meta['anchors'] = [a for a in K.A().meta['anchors'] if a['name'] not in ('searchlight', 'mg', 'light')]
    K.A().meta['roofs'] = []
    rb = bmesh.new()
    for i in range(18):                            # scattered planks and broken bracing
        c = V((r.uniform(-3.5, 4.5), r.uniform(-3.8, 3.2), 0.1))
        a = r.uniform(0, math.pi)
        L = r.uniform(0.8, 2.4)
        d = V((math.cos(a), math.sin(a), r.uniform(-0.02, 0.06)))
        K.beam_bm(rb, c - d * L / 2, c + d * L / 2 + V((0, 0, 0.05)), r.choice([0.06, 0.16, 0.2]), r.choice([0.03, 0.06, 0.12]), roll=r.uniform(0, 0.5))
    K.part(rb, WOOD, name='debris', uv='beam', axis=(1, 0, 0), tint=(0.55, 0.5, 0.46))
    for i in range(3):
        K.decal('soot', (r.uniform(-1, 3), r.uniform(-2, 1), 0.02), (0, 0, 1), r.uniform(2.5, 4), r.uniform(2.5, 4), up=(0, 1, 0), alpha=0.9)
    for (sx, sy), z in broken.items():
        x, y = leg_xy(sx, sy, z - 0.5)
        K.decal('soot', (x + sx * 0.115, y, max(0.46, z - 0.45)), (sx, 0, 0), 0.3, 0.9, alpha=0.9)
    K.footprint([(-1.2, -3.6), (3.8, -3.6), (3.8, 1.4), (-1.2, 1.4)], 'HIGH', 'wreck')
    K.anchor('fire', (2.2, -1.4, 0.5), kind='smoulder')

# ------------------------------------------------------------------ footprints / metadata / weathering
for sx in (-1, 1):
    for sy in (-1, 1):
        x, y = leg_xy(sx, sy, 0)
        K.footprint_rect(x, y, 0.55, 0.55, block='HIGH', kind='tower_leg')
if not DEAD:
    K.roof_meta([(-HD + 0.1, -HD + 0.1), (HD - 0.1, -HD + 0.1), (HD - 0.1, HD - 0.1), (-HD + 0.1, HD - 0.1)], ZD, walkable=True, kind='deck')
    K.anchor('guard', (0.0, -0.6, ZD), (0, -1, 0), kind='tower_post', deckY=ZD)
    K.anchor('roof_ridge', (0, 0, R.z_ridge))
    for s in (-1, 1):
        K.decal('streak_rain', (s * 0.7, -HD - 0.03, ZD + 0.5), (0, -1, 0), 0.9, 1.0, alpha=0.6)
        K.decal('moss_patch' if theater != 'desert' else 'dirt_splash', (s * 1.8, -1.9, 0.25), (0, -1, 0), 0.7, 0.4, alpha=0.6)
if VAR == 'snow':
    K.snow_pass(thick=0.08)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, lods=((0.45, 0.3, 4.0), (0.3, 0.9, 4.0)))
