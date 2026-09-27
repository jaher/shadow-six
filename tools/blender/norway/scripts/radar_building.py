"""Radar station operations building (M5 Herdla summit): board-formed concrete block with a flat walkable roof and
parapet, armoured steel doors, barred windows with steel shutters, sandbag blast wall at the entrance, generator
exhaust, cable entries, and a 16 m four-legged lattice aerial mast with a dipole (Yagi) array and guy wires.
Variants: a = intact, ad = destroyed (blast holes, burnt, mast toppled across the site, rubble).
Usage: blender -b --python radar_building.py -- outdir a|ad seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C
import bmesh
from mathutils import Matrix

OUT, VAR, SEED, SNOW = N.args('radar_building')
DEST = VAR.endswith('d')
name = 'radar_building_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
L, W, H, T = 9.0, 6.0, 3.2, 0.45
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
door = K.opening(poly, 0, 2.2, 1.1, 2.1, 0.0, T, 'rect', 'door')
door2 = K.opening(poly, 1, 4.2, 1.0, 2.0, 0.0, T, 'rect', 'door')
wins = [K.opening(poly, 0, 5.0, 1.2, 0.85, 1.35, T), K.opening(poly, 0, 7.3, 1.2, 0.85, 1.35, T),
        K.opening(poly, 2, 3.0, 1.2, 0.85, 1.35, T), K.opening(poly, 2, 6.5, 1.2, 0.85, 1.35, T),
        K.opening(poly, 3, 3.0, 1.2, 0.85, 1.35, T)]
K.wall_ring(poly, H, T, 'concrete_camo', [door, door2] + wins, name='walls', plinth=('concrete_bunker', 0.35, 0.05))
K.roof_flat(poly, H + 0.25, 'concrete_bunker', parapet_h=0.6, parapet_t=0.25, parapet_mid='concrete_camo',
            coping='concrete_slab', walkable=True, spouts=True)
N.flat_roof_dress(poly, H + 0.25, 0.25, seed=SEED, hatch=(x0 + 1.4, y1 - 1.2), vents=[(1.6, 1.2), (2.6, -1.4)],
                  drains=[(x0 + 0.7, y0 + 0.7), (x1 - 0.7, y0 + 0.7)],
                  cable=((x0 + 2.6, 0.9), (x0 + 0.25, 0.9), (-1, 0)), ladder_head=(x1 - 0.1, -0.5, 1, 0),
                  moss=0.0, dirt=1, seams=0.9)
for k, f in enumerate(wins):
    K.window(f, 'fixed', (2, 1), frame=(0.4, 0.42, 0.38), recess=0.25, sill='concrete_bunker', bars=True, curtain=0,
             streak=True, name='w%d' % k)
    bm = K.bm_new()                                 # hinged armoured shutter, swung open against the wall
    p = f.p(-f.w / 2 - 0.02, 0, 0.03)
    K.box_bm(bm, (p.x - f.r.x * f.w / 2 + f.n.x * 0.02, p.y - f.r.y * f.w / 2 + f.n.y * 0.02, f.o.z + f.h / 2),
             (abs(f.r.x) * f.w + abs(f.n.x) * 0.03 + 0.001, abs(f.r.y) * f.w + abs(f.n.y) * 0.03 + 0.001, f.h + 0.05))
    K.part(bm, 'steel_painted', name='shutter%d' % k, mat_tint=(0.55, 0.58, 0.52))
K.door(door, 'main', 'plank', (0.35, 0.38, 0.33), step='concrete_bunker')
K.door(door2, 'side', 'plank', (0.35, 0.38, 0.33), step='concrete_bunker')
# sandbag blast wall (L) in front of the main door
bm = K.bm_new()
dx = door.o.x
for row in range(5):
    for i in range(7):
        xx = dx - 1.5 + (i + 0.5 * (row % 2)) * 0.48
        K.box_bm(bm, (xx, y0 - 1.6 + r.uniform(-0.02, 0.02), 0.11 + row * 0.21), (0.46, 0.34, 0.2), rot_z=r.uniform(-0.08, 0.08), taper=(0.85, 0.9))
for row in range(4):                                # revetment under the south windows
    for i in range(10):
        xx = x0 + 4.2 + (i + 0.5 * (row % 2)) * 0.46
        K.box_bm(bm, (xx, y0 - 0.45 + r.uniform(-0.02, 0.02), 0.11 + row * 0.21), (0.44, 0.5, 0.2), rot_z=r.uniform(-0.08, 0.08), taper=(0.85, 0.9))
K.part(bm, 'hessian', name='sandbags', mat_tint=(0.8, 0.72, 0.56), jitter=0.12)
K.footprint(N.rect(dx - 1.6, y0 - 1.8, dx + 1.9, y0 - 1.4), 'LOW', 'sandbags')
K.footprint(N.rect(x0 + 4.1, y0 - 0.75, x0 + 8.9, y0 - 0.15), 'LOW', 'sandbags')
bm = K.bm_new()                                     # splinter-protection wall in front of the side door
K.box_bm(bm, (x1 + 1.3, y0 + 4.2, 1.0), (0.4, 2.2, 2.0))
K.box_bm(bm, (x1 + 1.3, y0 + 4.2, 2.03), (0.5, 2.3, 0.08))
K.part(bm, 'concrete_formwork', name='blastwall')
K.footprint(N.rect(x1 + 1.1, y0 + 3.1, x1 + 1.5, y0 + 5.3), 'HIGH', 'blastwall')
bm = K.bm_new()                                     # ground cable tray on posts from the building to the mast
for k in range(4):
    xx = x0 - 0.4 - k * 0.8
    K.box_bm(bm, (xx, 0.9, 0.25), (0.06, 0.06, 0.5))
K.box_bm(bm, (x0 - 1.6, 0.9, 0.52), (2.6, 0.35, 0.05))
for off in (-0.1, 0.0, 0.1):
    K.cyl_bm(bm, (x0 - 0.2, 0.9 + off, 0.58), (x0 - 2.9, 0.9 + off, 0.58), 0.025, 5)
K.part(bm, 'cast_iron', name='cable_tray', mat_tint=(0.55, 0.55, 0.52))
# generator exhaust + cable entries + roof hatch/ladder
bm = K.bm_new()
K.cyl_bm(bm, (x1 + 0.15, y1 - 0.8, 0.8), (x1 + 0.15, y1 - 0.8, H + 1.4), 0.09, 10)
K.cyl_bm(bm, (x1 + 0.15, y1 - 0.8, 0.8), (x1 - 0.1, y1 - 0.8, 0.8), 0.09, 10)
for k in range(3):
    K.cyl_bm(bm, (x0 + 1.0 + k * 0.25, y1 + 0.02, 0.6), (x0 + 1.0 + k * 0.25, y1 + 0.02, H - 0.2), 0.03, 6)
K.part(bm, 'cast_iron', name='pipes', smooth=True)
K.anchor('smoke', (x1 + 0.15, y1 - 0.8, H + 1.5))
K.ladder((x1 + 0.35, -0.5, 0), H + 0.85, (1, 0, 0), mid='steel_galv')
K.sign((door.o.x + 1.2, y0 - 0.01, 1.9), (0, -1, 0), 0.9, 'halt_sperrgebiet')

# ---- lattice aerial mast ---------------------------------------------------------------------------------
MH = 16.0


def mast_bm():
    bm = bmesh.new()
    b0, b1 = 1.2, 0.35
    levels = 8
    def leg(k, z):
        s = b0 + (b1 - b0) * z / MH
        return V(((1 if k in (0, 3) else -1) * s / 2, (1 if k in (0, 1) else -1) * s / 2, z))
    for k in range(4):
        K.beam_bm(bm, leg(k, 0), leg(k, MH), 0.08, 0.08)
    for i in range(levels):
        za, zb = MH * i / levels, MH * (i + 1) / levels
        for k in range(4):
            j = (k + 1) % 4
            K.beam_bm(bm, leg(k, zb), leg(j, zb), 0.04, 0.04)
            K.beam_bm(bm, leg(k, za), leg(j, zb), 0.03, 0.03)
    # bedspring array: 4 x 3 dipoles in front of a mesh reflector on a frame + a small platform
    K.box_bm(bm, (0, 0, MH), (1.0, 1.0, 0.06))
    K.cyl_bm(bm, (0, 0, MH), (0, 0, MH + 1.0), 0.07, 8)
    for zz in (MH + 0.35, MH + 1.1, MH + 1.85):
        K.beam_bm(bm, V((0, -1.5, zz)), V((0, 1.5, zz)), 0.05, 0.05)
        for i in range(4):
            y = -1.1 + i * 0.73
            K.cyl_bm(bm, (0.35, y - 0.3, zz), (0.35, y + 0.3, zz), 0.02, 5)
            K.cyl_bm(bm, (0.0, y, zz), (0.35, y, zz), 0.015, 4)
    for y in (-1.5, 1.5):
        K.beam_bm(bm, V((0, y, MH + 0.2)), V((0, y, MH + 2.0)), 0.05, 0.05)
    return bm


MX, MY = x0 - 3.2, 1.0
if not DEST:
    bm = mast_bm()
    bmesh.ops.translate(bm, vec=(MX, MY, 0), verts=bm.verts)
    K.part(bm, 'steel_galv', name='mast', uv='beam', axis=(0, 0, 1), bisect=False, grime=0.4, mat_tint=(0.82, 0.82, 0.8))
    bm = K.bm_new()
    q = [bm.verts.new(p) for p in ((MX - 0.08, MY - 1.5, MH + 0.2), (MX - 0.08, MY + 1.5, MH + 0.2), (MX - 0.08, MY + 1.5, MH + 2.0), (MX - 0.08, MY - 1.5, MH + 2.0))]
    bm.faces.new(q)
    bm.faces.new([bm.verts.new(v.co - V((0.02, 0, 0))) for v in reversed(q)])
    K.part(bm, 'mesh_screen', name='array_screen', bisect=False, grime=0.1, lod='keep')
    bm = K.bm_new()
    for a in (0.5, 2.6, 4.7):
        gx, gy = MX + math.cos(a) * 7, MY + math.sin(a) * 7
        K.cyl_bm(bm, (MX, MY, MH * 0.7), (gx, gy, 0.2), 0.012, 4)
        K.box_bm(bm, (gx, gy, 0.1), (0.4, 0.4, 0.25))
    K.part(bm, 'steel_galv', name='guys', grime=0.2)
    K.anchor('antenna_top', (MX, MY, MH + 0.7))
else:
    bm = mast_bm()                                  # buckled at 6 m: stump leans, upper section folded over the roof
    # buckled at 1.5 m and toppled north-west: the upper lattice lies flat on the ground in one coherent piece
    # (reads as a fallen mast, not as loose lines in the air); the stump leans the other way
    D_ = V((-0.3, 1.0, 0)).normalized()
    K1 = V((MX, MY, 0)) + V((0.1, -0.12, 1.0)).normalized() * 1.5
    G = V((MX, MY, 0)) + D_ * 1.3
    LA = (V((G.x, G.y, 0.55)) - K1).length
    def seg(p0, d, za):
        R_ = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix()
        return lambda co: p0 + R_ @ V((co.x, co.y, co.z - za))
    f0 = seg(V((MX, MY, 0)), V((0.1, -0.12, 1.0)), 0.0)
    fA = seg(K1, V((G.x, G.y, 0.55)) - K1, 1.5)
    fB = seg(V((G.x, G.y, 0.55)), D_ + V((0, 0, -0.012)), 1.5 + LA)
    for v in bm.verts:
        z = v.co.z
        v.co = f0(v.co) if z < 1.5 else (fA(v.co) if z < 1.5 + LA else fB(v.co))
        v.co.z = max(0.03, v.co.z)
    tipP = V((G.x, G.y, 0)) + D_ * (MH + 2.0 - 1.5 - LA)
    K.footprint([(G.x - 0.7, G.y), (G.x + 0.7, G.y), (tipP.x + 0.7, tipP.y), (tipP.x - 0.7, tipP.y)], 'LOW', 'mast_fallen')
    K.part(bm, 'steel_galv', name='mast_fallen', uv='beam', axis=(0, 0, 1), bisect=False, grime=0.8, mat_tint=(0.7, 0.7, 0.68))
    N.blast((x0 + 2.5, y0, 1.4), 1.9, (0, -1, 0), seed=SEED, floor=0.0, splinters='concrete')
    N.blast((x1 - 1.5, y1, H - 0.3), 1.6, (0, 1, 0), seed=SEED + 1, splinters='concrete')
    # roof slab over the front hole cracks and sags into the room, with a broken slab piece hanging on rebar
    for ob in list(C.A.parts):
        if ob.name.startswith('flatroof') or ob.name.startswith('roofdeck'):
            for v in ob.data.vertices:
                d = math.hypot(v.co.x - (x0 + 2.5), v.co.y - (y0 + 0.4))
                if d < 2.6:
                    v.co.z -= 0.55 * (1 - d / 2.6) ** 2
    cut, pts = N.star_cutter(V((x0 + 2.5, y0 + 0.9, H)), (0, 0, 1), 1.1, SEED, 1.5, spikes=12)
    import kit_arch as KA
    for ob in list(C.A.parts):
        if ob.name.startswith('flatroof_slab') or ob.name.startswith('roofdeck'):
            KA.cut_object(ob, cut)
    cut.free()
    bm = K.bm_new()
    K.box_bm(bm, (x0 + 2.4, y0 + 0.8, H - 0.6), (1.6, 1.2, 0.22))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(x0 + 2.4, y0 + 0.8, H - 0.6), matrix=Matrix.Rotation(math.radians(38), 3, 'X'))
    K.part(bm, 'concrete_bunker', name='slab_hanging')
    bm = K.bm_new()
    for k in range(10):
        a_ = V((x0 + 1.8 + k * 0.14, y0 + 1.25, H + 0.05))
        K.cyl_bm(bm, a_, a_ + V((r.uniform(-0.1, 0.1), -0.25, -0.5)), 0.012, 4)
    K.part(bm, 'steel_galv', name='rebar_roof', mat_tint=(0.45, 0.3, 0.22))
    # second roof breach over the rear blast, rubble + soot on the deck, a broken parapet run at the front hole
    for ob in list(C.A.parts):
        if ob.name.startswith('flatroof') or ob.name.startswith('roofdeck') or ob.name.startswith('felt_seams'):
            for v in ob.data.vertices:
                d = math.hypot(v.co.x - (x1 - 1.6), v.co.y - (y1 - 1.0))
                if d < 1.9:
                    v.co.z -= 0.4 * (1 - d / 1.9) ** 2
    cut2, _p2 = N.star_cutter(V((x1 - 1.6, y1 - 1.1, H)), (0, 0, 1), 0.85, SEED + 5, 1.5, spikes=12)
    cut3, _p3 = N.star_cutter(V((x0 + 2.5, y0 + 0.05, H + 0.6)), (0, -1, 0), 0.9, SEED + 6, 0.6, spikes=10)
    for ob in list(C.A.parts):
        if ob.name.startswith('flatroof') or ob.name.startswith('roofdeck') or ob.name.startswith('felt_seams'):
            KA.cut_object(ob, cut2)
            KA.cut_object(ob, cut3)
    cut2.free()
    cut3.free()
    rb = K.bm_new()
    for k in range(26):
        a_ = r.uniform(0, 6.28)
        cx_, cy_ = (x0 + 2.5, y0 + 0.9) if k % 2 else (x1 - 1.6, y1 - 1.1)
        rad = r.uniform(1.0, 2.3)
        px, py = cx_ + math.cos(a_) * rad, cy_ + math.sin(a_) * rad * 0.8
        if not (x0 + 0.35 < px < x1 - 0.35 and y0 + 0.35 < py < y1 - 0.35):
            continue
        sz = r.uniform(0.12, 0.4)
        K.box_bm(rb, (px, py, H + 0.3 + sz * 0.3), (sz, sz * r.uniform(0.6, 1.2), sz * 0.6), rot_z=r.uniform(0, 3),
                 taper=(0.8, 0.8))
    K.part(rb, 'concrete_bunker', name='roof_rubble', jitter=0.25, mat_tint=(0.75, 0.74, 0.72))
    for (cx_, cy_, rs) in ((x0 + 2.5, y0 + 0.9, 3.4), (x1 - 1.6, y1 - 1.1, 2.6)):
        K.decal('soot', (cx_, cy_, H + 0.3), (0, 0, 1), rs, rs * 0.85, up=(0.3, 1, 0), alpha=0.85, offset=0.02)
    N.debris((x0 + 2.5, y0 - 1.6, 0), 2.1, 0.8, 'concrete', seed=SEED)
    N.debris((x1 - 1.5, y1 + 1.3, 0), 1.6, 0.6, 'concrete', seed=SEED + 4, name='debris2')
    N.debris((x0 + 2.3, y0 + 1.4, 0), 1.2, 0.5, 'concrete', seed=SEED + 8, name='debris_in', footprint=False)
    K.scorch_openings(1.2, prob=0.5)
    N.char_blasts(0.9, 2.4, 0.22)
    for ob in C.A.parts:                                  # the fallen mast lies away from the fire: keep it galvanised
        if ob.name.startswith('mast_fallen'):
            N.recolor(ob, lambda p, n, c: (0.8, 0.8, 0.78))
K.footprint_rect(MX, MY, 1.4, 1.4, 0, 'HIGH', 'mast')
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
