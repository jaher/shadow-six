# pack.py - the knapsack's shared canvas / strap helpers (models/kit.py builds the rucksack and its hanging kit with them)
# and the brass-on-leather count tag (the SMG bursts, first-aid doses, cigarettes, overflow counts on the knapsack).
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import sl, MM
from tools import ring, rsec


def stitches(name, pts, mat, step=2.6, lift=0.35, normal_fn=None):
    """Row of raised stitches along a 3D polyline (mm); each stitch a tiny bevelled box along the line."""
    P = []; k = 0
    for (a, b) in zip(pts, pts[1:]):
        A, B = Vector(a), Vector(b)
        L = (B - A).length; m = max(1, int(L / step))
        for i in range(m):
            c = A + (B - A) * ((i + 0.5) / m)
            d = (B - A).normalized()
            nrm = Vector(normal_fn(c)) if normal_fn else Vector((0, 0, 1))
            side = nrm.cross(d).normalized(); nrm = d.cross(side).normalized()
            rot = Matrix((d, side, nrm)).transposed().to_4x4()
            bmo = bmesh.new(); bmesh.ops.create_cube(bmo, size=1.0)
            for v in bmo.verts:
                v.co = Vector((v.co.x * 1.5, v.co.y * 0.55, v.co.z * 0.5))
            me = bpy.data.meshes.new(f'{name}{k}'); bmo.to_mesh(me); bmo.free()
            o = D.link(bpy.data.objects.new(f'{name}{k}', me))
            o.matrix_world = Matrix.Translation((c + nrm * lift) * MM) @ rot @ Matrix.Scale(MM, 4)
            o.data.materials.append(mat)
            P.append(o)
            k += 1
    if not P:
        return []
    return [D.join(P, name)]


def buckle_parts(name, br, w=12.0, h=9.0, r=1.0):
    """A brass roller buckle lying flat: rounded frame, centre bar, prong (local mm, centred, in the XY plane)."""
    P = []
    pts = []
    for k in range(24):
        a = 2 * math.pi * k / 24
        c, s_ = math.cos(a), math.sin(a)
        pts.append((w / 2 * math.copysign(abs(c) ** 0.45, c) * MM, h / 2 * math.copysign(abs(s_) ** 0.45, s_) * MM, 0))
    P.append(D.tube(f'{name}_frame', pts, r * MM, br, segs=10, closed=True, res=3))
    bar = D.cyl(f'{name}_bar', r * 0.9 * MM, (w - 1) * MM, br, rot=(0, 90, 0), segs=16)
    P.append(bar)
    pr = D.cyl(f'{name}_prong', 0.55 * MM, h / 2 * MM, br, loc=(0, h / 4 * MM, 0.5 * MM), rot=(90, 0, 0), segs=10)
    P.append(pr)
    return P


def canvas_mat(name, tint, fade=0.18, grime=0.5, scale=0.05, wear=0.5):
    """Worn olive canvas: linen weave (CC0 Poly Haven rough_linen), sun-faded patches, grime in the creases (AO)."""
    def mk():
        t = M.NT(name)
        vec = t.coords(scale)
        weave = t.img('rough_linen', 'diff', vec)
        c = t.mix(1.0, weave, tint, 'MULTIPLY')
        c = t.mix(0.55, c, tint)                             # keep the weave subtle: mostly the dyed colour
        big = t.noise(28.0, 4.0, 0.55)
        c = t.mix(t.math('MULTIPLY', t.math('MAXIMUM', t.math('SUBTRACT', big, 0.45), 0.0), fade * 4), c,
                  tuple(min(1, v * 1.55 + 0.02) for v in tint))
        stain = t.noise(45.0, 3.0, 0.5)                     # old water / oil stains: soft dark blotches
        c = t.mix(t.math('MINIMUM', t.math('MULTIPLY', t.math('MAXIMUM', t.math('SUBTRACT', stain, 0.53), 0.0), 4.0 * grime), 0.8), c, tuple(v * 0.6 for v in tint))
        scuff = t.noise(260.0, 4.0, 0.7)                    # rubbed, paler threads
        c = t.mix(t.math('MINIMUM', t.math('MULTIPLY', t.math('MAXIMUM', t.math('SUBTRACT', scuff, 0.6), 0.0), 3.2 * wear), 0.8), c, tuple(min(1, v * 1.5 + 0.03) for v in tint))
        spot = t.noise(140.0, 6.0, 0.6)
        c = t.mix(t.math('MULTIPLY', t.math('MAXIMUM', t.math('SUBTRACT', spot, 0.62), 0.0), 2.2), c, tuple(v * 0.55 for v in tint))
        ao = t.n('ShaderNodeAmbientOcclusion', samples=8, i_Distance=0.006)
        g = t.math('SUBTRACT', 1.0, ao.outputs['AO'])
        c = t.mix(t.math('MINIMUM', t.math('MULTIPLY', g, grime * 1.6), 0.85), c, tuple(v * 0.35 for v in tint))
        cx = t.n('ShaderNodeAmbientOcclusion', samples=8, i_Distance=0.0025, inside=True)   # convex ridges: rubbed pale
        ridge = t.math('MAXIMUM', t.math('SUBTRACT', t.math('SUBTRACT', 1.0, cx.outputs['AO']), 0.25), 0.0)
        c = t.mix(t.math('MINIMUM', t.math('MULTIPLY', ridge, 1.4 * wear), 0.7), c, tuple(min(1, v * 1.9 + 0.05) for v in tint))
        t.L(c, t.p.inputs['Base Color'])
        r = t.img('rough_linen', 'rough', vec, noncolor=True)
        t.L(t.math('MULTIPLY_ADD', r, 0.25, 0.68), t.p.inputs['Roughness'])
        h = t.img('rough_linen', 'disp', vec, noncolor=True)
        t.L(t.bump(t.math('ADD', h, t.math('MULTIPLY', t.noise(900.0, 3.0, 0.5), 0.3)), strength=0.55, dist=0.00035), t.p.inputs['Normal'])
        t.set('Sheen Weight', 0.35); t.set('Sheen Roughness', 0.55)
        t.set('Specular IOR Level', 0.25)
        return t.m
    return M._get(name, mk)


@S.shot('tag')
def _tag(mode):
    """Count tag (§6.4 counts): a stamped plate of the buckles' antique brass riveted on a strip of the straps' leather,
    a rivet at each end (CSS border-image stretches the plain middle: the rivets stay inside its 22 % end slices)."""
    br = M.metal('bag_brass', M.lin((0.60, 0.46, 0.24)), rough=0.36, wear=0.7, wear_color=M.lin((0.86, 0.72, 0.44)), grain=0.55)
    lt = M.textured('bag_leather', 'brown_leather', tint=(0.50, 0.32, 0.19), scale=0.03, nstrength=1.0, coat=0.2)
    dk = M.solid('tag_rivet_dark', M.lin((0.10, 0.08, 0.05)), rough=0.5)
    P = [sl('strap', D.chaikin([(-24, -9.5), (24, -9.5), (24, 9.5), (-24, 9.5)], 3, True), 1.4, lt, y=-0.6, bevel=0.5, plane='XY'),
         sl('plate', D.chaikin([(-20.5, -8), (20.5, -8), (20.5, 8), (-20.5, 8)], 2, True), 1.2, br, y=0.6, bevel=0.45, plane='XY')]
    for sx in (-1, 1):
        P.append(D.lathe(f'rivet{sx}', [(0, 0), (2.2 * MM, 0), (1.8 * MM, 1.0 * MM), (0, 1.4 * MM)], br, segs=24, loc=(sx * 17 * MM, 0, 1.2 * MM)))
        P.append(ring(f'rim{sx}', 2.6, rsec(0.6, 0.4, 6), dk, segs=24, loc=(sx * 17 * MM, 0, 1.21 * MM)))
    D.group('tagg', P, rot=(90, 0, 0))
    S.shoot('tag', 'tool', box=(24, 9), preset='front', elev=0, margin=0.0, shadow=False, scale=16,
            extra={'nocrop': True, 'tiers': [2, 3, 4, 6], 'halo': [0.5, 0.6]}, light={'rim': 0.5})
