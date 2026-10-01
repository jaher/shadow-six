"""Atlantic Wall beach and anti-tank obstacles (M14 La Riviere; also M6/M8/M10/M11/M15 belts):
 tetra    = concrete tetrahedron (Tetraeder), 1.4 m, chamfered edges, wet/weed tide band, a Teller mine strapped on top
 teeth    = one dragon's tooth (Hoeckerhindernis), 1.2 m truncated pyramid on its footing, formwork lifts, moss
 hedgehog = Czech hedgehog: three 1.8 m L-angle steel beams riveted through gusset plates, rusted, sand drift
 atwall   = free-standing anti-tank wall segment, 8 x 1.2 x 2.5 m, battered seaward face, chamfered coping, two
            landward buttresses, expansion joints, weep holes; tiled along a mission polyline
Usage: blender -b --factory-startup --python beach_obstacles.py -- [tetra|teeth|hedgehog|atwall] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('tetra', 141)
NAME = {'tetra': 'beach_tetrahedron', 'teeth': 'dragons_teeth', 'hedgehog': 'czech_hedgehog', 'atwall': 'at_wall_segment'}[VAR]
K.begin(NAME, SEED, theater='coast')
r = K.rng()
CT = (0.84, 0.84, 0.81)


def sand_skirt(rad, h=0.12, n=14, name='sand_drift', sx=1.0, sy=1.0):
    """Low wind-blown sand heaped against the base (hides the ground seam)."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, h))
    ring = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + 0.18 * math.sin(3 * a + SEED) + r.uniform(-0.08, 0.08)
        ring.append(bm.verts.new((math.cos(a) * rad * k * sx, math.sin(a) * rad * k * sy, -0.04)))
    for i in range(n):
        bm.faces.new((c, ring[i], ring[(i + 1) % n]))
    M.planar_uv(K.part(bm, 'sand', name=name, grime=0.1, smooth=True, bisect=False), 'sand')


if VAR == 'tetra':
    H = 1.4
    base = [V((math.cos(a) * 0.86, math.sin(a) * 0.86, 0)) for a in (math.radians(90), math.radians(210), math.radians(330))]
    apex = V((0, 0, H))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in base] + [bm.verts.new(apex)]
    bm.faces.new(vs[:3][::-1])
    for i in range(3):
        bm.faces.new((vs[i], vs[(i + 1) % 3], vs[3]))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.05, segments=1, affect='EDGES')
    tet = M.conc_part(bm, 'tetra', 'concrete_board', CT)
    for i in range(3):                                   # tide band, weed and rust on each face
        a = math.radians(90 + 120 * i + 60)
        n = V((math.cos(a), math.sin(a), 0.42)).normalized()
        c = V((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.32))
        K.decal('damp_base', tuple(c), tuple(n), 1.3, 0.55, alpha=0.85)
        K.decal(r.choice(['lichen', 'moss_patch', 'stain_blotch']), tuple(c + V((0, 0, 0.35))), tuple(n), 0.7, 0.5, alpha=0.6)
        K.decal('streak_rust', tuple(c + V((0, 0, 0.6))), tuple(n), 0.25, 0.7, alpha=0.6)
    bm = bmesh.new()                                     # Teller mine on a timber cradle at the apex
    K.cyl_bm(bm, (0, 0, H - 0.08), (0, 0, H + 0.02), 0.17, 16)
    K.cyl_bm(bm, (0, 0, H + 0.02), (0, 0, H + 0.05), 0.07, 10)
    K.part(bm, 'steel_painted', name='teller_mine', mat_tint=(0.5, 0.52, 0.42), smooth=True, grime=0.8, lod='drop')
    sand_skirt(1.05, 0.14)
    K.footprint([(-0.75, -0.5), (0.75, -0.5), (0.75, 0.86), (-0.75, 0.86)], 'LOW', 'obstacle')

elif VAR == 'teeth':
    H, B0, T0 = 1.2, 1.1, 0.42
    bm = bmesh.new()
    M.chamfer_block(bm, -0.75, -0.75, 0.75, 0.75, -0.1, 0.14, ch=0.06)     # footing slab
    M.conc_part(bm, 'footing', 'concrete_bunker', (0.8, 0.8, 0.78))
    bm = bmesh.new()
    rings = []
    for z, hw in ((0.12, B0 / 2), (0.55, B0 / 2 - (B0 - T0) / 2 * 0.43 / 1.08), (H - 0.06, T0 / 2 + 0.03), (H, T0 / 2 - 0.03)):
        rings.append([V((-hw, -hw, z)), V((hw, -hw, z)), V((hw, hw, z)), V((-hw, hw, z))])
    K.loft_bm(bm, rings)
    tooth = M.conc_part(bm, 'tooth', 'concrete_board', CT)
    K.bite((0.38, -0.4, H - 0.05), 0.16, (1, 1, 1), seed=SEED, parts=[tooth])
    for i, (nx, ny) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
        n = V((nx, ny, 0.32)).normalized()
        c = V((nx * 0.4, ny * 0.4, 0.45))
        K.decal(['moss_patch', 'lichen', 'stain_blotch', 'crack'][i], tuple(c), tuple(n), 0.6, 0.5, alpha=0.6)
        K.decal('damp_base', tuple(c - V((0, 0, 0.25))), tuple(n), 0.9, 0.3, alpha=0.7)
    sand_skirt(0.95, 0.1)
    K.footprint([(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)], 'LOW', 'obstacle')

elif VAR == 'hedgehog':
    Rt = Matrix.Rotation(math.atan(math.sqrt(2)), 3, V((1, -1, 0)).normalized()) @ Matrix.Rotation(math.radians(r.uniform(0, 120)), 3, 'Z')
    Rt = Matrix.Rotation(math.radians(r.uniform(0, 360)), 3, 'Z') @ Rt
    LEG, FW, TH = 0.95, 0.1, 0.012
    axes = [Rt @ V(a) for a in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    lift = max(abs(a.z) for a in axes) * LEG - 0.04
    O = V((0, 0, lift))
    bm = bmesh.new()
    for k, d in enumerate(axes):
        u = axes[(k + 1) % 3]; w = axes[(k + 2) % 3]
        p0, p1 = O - d * LEG, O + d * LEG
        K.beam_bm(bm, p0 + u * FW / 2, p1 + u * FW / 2, FW, TH, up=tuple(w))          # L-angle: flange 1
        K.beam_bm(bm, p0 + w * FW / 2, p1 + w * FW / 2, FW, TH, up=tuple(u))          # flange 2
    K.part(bm, 'steel_painted', name='hedgehog_angles', mat_tint=(0.48, 0.36, 0.27), grime=0.9, bisect=False)
    bm = bmesh.new()                                         # gusset plates + rivet heads at the crossing
    for k, d in enumerate(axes):
        n = axes[(k + 2) % 3]
        K.box_bm(bm, tuple(O + n * 0.07), (0.26, 0.26, 0.014))
        for s in (-1, 1):
            for t in (-1, 1):
                K.cyl_bm(bm, O + n * 0.08 + d * (s * 0.08) + axes[(k + 1) % 3] * (t * 0.08), O + n * 0.1 + d * (s * 0.08) + axes[(k + 1) % 3] * (t * 0.08), 0.016, 6)
    K.part(bm, 'cast_iron', name='gussets', mat_tint=(0.5, 0.38, 0.3), bisect=False, lod='drop')
    sand_skirt(0.8, 0.08)
    K.footprint([(-0.7, -0.7), (0.7, -0.7), (0.7, 0.7), (-0.7, 0.7)], 'LOW', 'obstacle')

elif VAR == 'atwall':
    L, ZT = 8.0, 2.5
    bm = bmesh.new()                                         # battered seaward face (Blender -Y = game south)
    prof = [(-0.6, -0.1), (0.36, -0.1), (0.36, ZT - 0.12), (0.24, ZT), (-0.2, ZT), (-0.3, ZT - 0.12)]
    rings = [[V((x, y, z)) for y, z in prof] for x in (-L / 2, L / 2)]
    K.loft_bm(bm, rings)
    wall = M.conc_part(bm, 'wall', 'concrete_board', CT)
    bm = bmesh.new()                                         # landward buttresses
    for bx in (-2.2, 2.2):
        K.hexa_bm(bm, [V((bx - 0.3, 0.36, -0.1)), V((bx + 0.3, 0.36, -0.1)), V((bx + 0.3, 0.6, -0.1)), V((bx - 0.3, 0.6, -0.1)),
                       V((bx - 0.3, 0.36, ZT - 0.5)), V((bx + 0.3, 0.36, ZT - 0.5)), V((bx + 0.3, 0.38, ZT - 0.45)), V((bx - 0.3, 0.38, ZT - 0.45))])
    M.conc_part(bm, 'buttress', 'concrete_board', CT)
    bm = bmesh.new()                                         # spalled shell / bullet strikes with sprung rebar
    for k in range(3):
        x, z = r.uniform(-3.2, 3.2), r.uniform(0.9, 2.1)
        K.bite((x, -0.6 + 0.3 * (z / ZT), z), r.uniform(0.18, 0.3), (1.2, 0.7, 1.0), seed=SEED + k, parts=[wall])
        for i in range(3):
            a = r.uniform(0, 6.28)
            K.cyl_bm(bm, V((x + math.cos(a) * 0.12, -0.5, z + math.sin(a) * 0.12)), V((x + math.cos(a) * 0.3, -0.75, z + math.sin(a) * 0.25)), 0.008, 4)
    K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.55, 0.38, 0.26), grime=0, bisect=False, lod='drop')
    bm = bmesh.new()                                         # formwork lift lines + tie-rod plugs on the seaward face
    for z in (0.8, 1.6):
        K.box_bm(bm, (0, -0.6 + 0.3 * (z / ZT) - 0.012, z), (L - 0.1, 0.02, 0.03))
    for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
        for z in (0.45, 1.25, 2.05):
            K.cyl_bm(bm, V((x, -0.6 + 0.3 * (z / ZT) + 0.01, z)), V((x, -0.6 + 0.3 * (z / ZT) - 0.02, z)), 0.03, 6)
    K.part(bm, 'concrete_bunker', name='lifts', tint=(0.6, 0.6, 0.58), grime=0.2, bisect=False, lod='drop')
    bm = bmesh.new()                                         # weep holes
    for x in (-3.0, -1.0, 1.0, 3.0):
        K.cyl_bm(bm, V((x, -0.55, 0.35)), V((x, -0.45, 0.35)), 0.05, 8)
    K.part(bm, 'interior_dark', name='joints', grime=0, bisect=False, lod='drop')
    for k in range(9):
        x = -L / 2 + 0.6 + k * (L - 1.2) / 8 + r.uniform(-0.2, 0.2)
        K.decal(r.choice(['streak_long', 'streak_rain', 'streak_rust', 'efflorescence']), (x, -0.62 + 0.36 * 0.5, ZT * 0.55), (0, -0.99, 0.11), r.uniform(0.5, 1.1), 1.4, alpha=0.5)
        K.decal(r.choice(['lichen', 'moss_patch', 'stain_blotch', 'crack']), (x + 0.3, -0.58, 0.8), (0, -0.99, 0.11), 0.8, 0.6, alpha=0.55)
    for x in (-2.6, 0.0, 2.6):
        K.decal('damp_base', (x, -0.64, 0.3), (0, -0.99, 0.11), 2.8, 0.6, alpha=0.75)
        K.decal('damp_base', (x, 0.37, 0.3), (0, 1, 0), 2.8, 0.5, alpha=0.6)
    bm = bmesh.new()                                         # sand drifted against the seaward foot
    for k in range(4):
        x0 = -L / 2 + k * 2.0
        K.hexa_bm(bm, [V((x0, -0.6, -0.04)), V((x0 + 2.0, -0.6, -0.04)), V((x0 + 2.0, -1.1 - 0.2 * (k % 2), -0.04)), V((x0, -1.0 - 0.2 * ((k + 1) % 2), -0.04)),
                       V((x0, -0.59, 0.2 + 0.08 * (k % 2))), V((x0 + 2.0, -0.59, 0.22)), V((x0 + 2.0, -0.95, 0.0)), V((x0, -0.95, 0.0))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    M.planar_uv(K.part(bm, 'sand', name='sand_drift', grime=0.1, bisect=False), 'sand')
    K.footprint([(-L / 2, -0.6), (L / 2, -0.6), (L / 2, 0.6), (-L / 2, 0.6)], 'HIGH', 'wall')

M.finalize(M.outdir(K.A().name), ao_res=512 if VAR != 'atwall' else 1024, ao_samples=32)
