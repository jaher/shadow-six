"""Bridges rework round 2 (art director review 2) - bridge-only overrides on top of brfix (kit NOT edited):
- export: the 'Col' colour attribute is made active so Blender 4.2 writes COLOR_0 (before this, every bridge GLB
  shipped without vertex colours: tide/algae bands, wet tints, grime and per-part tints never reached the shader)
- AO: bake ground = banks at z=0 outside the river + a plane at the water level (the old z=0 plane cut through the
  arch openings and crushed the soffit crowns to black)
- decals: every decal is ray-tested against the solid geometry and trimmed / deleted where it would hang in air
- deck: approach ramps (raised deck ends, ramp down to the ground), embankments with earth fill against the wings
- riprap: rounded, smooth-shaded, wet-dark boulders sunk into the water; scuppers: bigger spouts with a lip
- debris: mixed dressed blocks, wedge voussoirs, dark wet fill, setts, spread fan into the water"""
import math, time
import bpy, bmesh
from mathutils import Vector as V, noise as N, Euler, Matrix
from mathutils.bvhtree import BVHTree
import brlib as BL
from brlib import K, C
import kit_bridge as KB
import kit_weather as W
import kit_export as KE
import brfix as F

part = F.part2

# ------------------------------------------------------------------ export: COLOR_0 must be the active colour
_orig_export = KE.export_glb


def export_glb(path, objs):
    for o in objs:
        ca = o.data.color_attributes
        if 'Col' in ca:
            ca.active_color = ca['Col']
            try:
                ca.render_color_index = ca.find('Col')
            except Exception:
                pass
    return _orig_export(path, objs)


KE.export_glb = export_glb

# ------------------------------------------------------------------ AO bake with a bridge-aware ground
AO_AUTO = True          # no AO_GROUND set -> derive banks/water from bridge_meta (river_width, water_level)
AO_GROUND = {}          # set by scripts: {'banks': (xw, xe), 'water': z, 'z_bank': 0.0}
_orig_bake = KE.bake_ao


def bake_ao(objs, res=1024, samples=96, dist=2.0, out=None):
    if not AO_GROUND and AO_AUTO:
        br = C.A.meta.get('bridge') or {}
        if br.get('river_width') and br.get('water_level') is not None:
            AO_GROUND.update({'banks': (-br['river_width'] / 2, br['river_width'] / 2), 'water': br['water_level']})
    if not AO_GROUND:
        return _orig_bake(objs, res, samples, dist, out)
    t0 = time.time()
    KE._setup_cycles(samples)
    bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new('W')
    img = bpy.data.images.new('ao_bake', res, res, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    xw, xe = AO_GROUND['banks']
    zb, zw = AO_GROUND.get('z_bank', 0.0) - 0.005, AO_GROUND['water'] - 0.05
    bm = bmesh.new()
    for (a, b, z) in ((-300, xw, zb), (xe, 300, zb), (xw, xe, zw)):
        vs = [bm.verts.new(p) for p in ((a, -300, z), (b, -300, z), (b, 300, z), (a, 300, z))]
        bm.faces.new(vs)
    me = bpy.data.meshes.new('ao_ground')
    bm.to_mesh(me)
    bm.free()
    ground = bpy.data.objects.new('ao_ground', me)
    bpy.context.scene.collection.objects.link(ground)
    added = []
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['AO']
        for m in o.data.materials:
            if m and m.name not in added:
                n = m.node_tree.nodes.new('ShaderNodeTexImage')
                n.image = img
                n.name = 'AO_BAKE'
                m.node_tree.nodes.active = n
                added.append(m.name)
    KE._select(objs)
    bpy.context.scene.cycles.bake_type = 'AO'
    bpy.context.scene.world.light_settings.distance = dist
    bpy.context.scene.render.bake.margin = 6
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    import os
    out = out or os.path.join(bpy.app.tempdir, 'ao.png')
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
        for m in o.data.materials:
            if m and 'AO_BAKE' in m.node_tree.nodes:
                m.node_tree.nodes.remove(m.node_tree.nodes['AO_BAKE'])
    bpy.data.objects.remove(ground)
    C.log('AO baked (bridge ground) %dpx in %.1fs' % (res, time.time() - t0))
    return out


KE.bake_ao = bake_ao


# ------------------------------------------------------------------ deck with approach ramps
RAMP = {'on': False, 'z_end': 0.5, 'L': 7.0, 'z0': 0.03}
_Deck = KB.Deck


class RampDeck(_Deck):
    """Kit deck (camber between the abutments) whose ends are raised to RAMP z_end, continued beyond the abutments
    by straight approach ramps that fall to the ground (z0) over RAMP L metres."""

    def __init__(s, x0, x1, z_end=0.05, camber=0.5):
        super().__init__(x0, x1, RAMP['z_end'] if RAMP['on'] else z_end, camber)
        s.ramp = dict(RAMP) if RAMP['on'] else None

    def z(s, x):
        if s.ramp and abs(x) > s.half:
            t = min(1.0, (abs(x) - s.half) / s.ramp['L'])
            t = t * t * (3 - 2 * t)                                   # eased toe and head
            return s.z_end + (s.ramp['z0'] - s.z_end) * t
        return super().z(x)


KB.Deck = RampDeck


# ------------------------------------------------------------------ decals: trim / delete where they would hang in air
def _solid_bvh():
    verts, polys = [], []
    for o in C.A.parts:
        if o.name not in bpy.data.objects or o.get('kit_node', 'main') == 'decals' or o.name.startswith(('decal', 'snow', 'ice', 'icicle')):
            continue
        mw = o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


def cull_decals(tol=0.22, min_keep=0.35, rows=7, cols=4, log=True):
    """Ray-test a rows x cols grid on every decal quad against the solid parts: rows (bottom->top) that are not
    fully backed are trimmed from the decal, keeping the longest backed run (streaks keep their top); decals with
    less than min_keep of their height backed are deleted. Also trims columns the same way."""
    bvh = _solid_bvh()
    nk = nt = 0
    for o in list(C.A.parts):
        if o.name not in bpy.data.objects or not o.name.startswith('decal') or o.get('kit_node', 'main') != 'decals':
            continue
        me = o.data
        if len(me.vertices) != 4 or len(me.polygons) != 1:
            continue
        mw = o.matrix_world
        P = [mw @ v.co for v in me.vertices]
        n = (P[1] - P[0]).cross(P[3] - P[0]).normalized()
        e_u, e_v = P[1] - P[0], P[3] - P[0]           # width, height edges (vertex order of W.decal)

        def backed(s, t):
            p = P[0] + e_u * s + e_v * t
            for sg in (1, -1):
                hit = bvh.ray_cast(p + n * sg * tol, -n * sg, tol * 2.2)
                if hit[0] is not None:
                    return True
            return False
        ok = [[backed((j + 0.5) / cols, (i + 0.5) / rows) for j in range(cols)] for i in range(rows)]
        rok = [all(r) for r in ok]
        best, cur, bs = (0, -1), 0, 0
        for i, v in enumerate(rok):
            if v:
                if cur == 0:
                    bs = i
                cur += 1
                if cur > best[1] - best[0] + 1:
                    best = (bs, i)
            else:
                cur = 0
        kept = best[1] - best[0] + 1
        if kept / rows < min_keep:
            C.A.parts.remove(o)
            bpy.data.objects.remove(o)
            nk += 1
            continue
        if kept == rows:
            continue
        t0, t1 = best[0] / rows, (best[1] + 1) / rows
        uvl = me.uv_layers[0].data
        cuv = {}
        for li, l in enumerate(me.loops):
            cuv[l.vertex_index] = V(uvl[li].uv)
        U = [cuv[i] for i in range(4)]

        def bil(s, t):
            return (U[0] * (1 - s) + U[1] * s) * (1 - t) + (U[3] * (1 - s) + U[2] * s) * t
        st = [(0, t0), (1, t0), (1, t1), (0, t1)]
        inv = mw.inverted()
        for i, (s, t) in enumerate(st):
            me.vertices[i].co = inv @ (P[0] + e_u * s + e_v * t)
        for li, l in enumerate(me.loops):
            s, t = st[l.vertex_index]
            uvl[li].uv = bil(s, t)
        nt += 1
    if log:
        C.log('cull_decals: deleted %d, trimmed %d' % (nk, nt))


def face_decal(kind, x, y_face, z_top, w, h, alpha=0.5, s=None):
    """Wall decal hanging from z_top on a +-Y face (streaks); cull_decals trims it to the backed masonry."""
    s = s or (1 if y_face > 0 else -1)
    return W.decal(kind, (x, y_face + s * 0.004, z_top - h / 2), (0, s, 0), w, h, alpha=alpha)


# ------------------------------------------------------------------ riprap v2: rounded wet boulders sunk into the water
def riprap_ring(outline, water, n=22, smin=0.35, smax=0.75, off=(0.0, 0.55), mid='granite', name='riprap', tint=None,
                out_dir=None, dry=(0.50, 0.49, 0.46), wet=(0.22, 0.24, 0.19)):
    """Water-worn boulders against a pier / wall foot: 80-face icospheres flattened and noise-displaced, smooth
    shaded, sunk so 3-22 cm break the surface, coloured dry grey on top -> dark wet algae-green at the waterline;
    faces fully below water-0.3 are dropped (never seen, saves triangles)."""
    r = BL.rng()
    per = [(V((*outline[i], 0)), V((*outline[(i + 1) % len(outline)], 0))) for i in range(len(outline))]
    L = sum((b - a).length for a, b in per)
    c = sum((a for a, _ in per), V()) / len(per)
    bm = bmesh.new()
    for i in range(n):
        d = r.uniform(0, L)
        for a, b in per:
            sl = (b - a).length
            if d <= sl:
                p = a.lerp(b, d / max(sl, 1e-6))
                break
            d -= sl
        out = (p - c)
        out.z = 0
        out = out.normalized() if out.length > 1e-6 else V((1, 0, 0))
        if out_dir is not None:
            out = V(out_dir)
        o = r.uniform(*off)
        s = r.uniform(smin, smax)
        sq = (1, r.uniform(0.7, 0.95), r.uniform(0.5, 0.72))
        emerge = (0.22 - 0.19 * (o - off[0]) / max(1e-6, off[1] - off[0])) * r.uniform(0.5, 1.0)
        q = p + out * (o + s * 0.45) + V((0, 0, water + emerge - s * sq[2]))
        cb = W._blob_bm(q, s, r.random() * 10, sq, 2, 0.2)
        bmesh.ops.rotate(cb, verts=cb.verts, cent=q, matrix=Matrix.Rotation(r.uniform(0, 6.3), 3, 'Z'))
        tmp = bpy.data.meshes.new('rr')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    kill = [f for f in bm.faces if all(v.co.z < water - 0.3 for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    col = bm.loops.layers.color.new('Col2')
    dry, wet = V(dry), V(wet)
    for f in bm.faces:
        for l in f.loops:
            p = l.vert.co
            h = p.z - water
            k = max(0.0, min(1.0, (h - 0.02) / 0.2))
            cc = wet.lerp(dry, k) * (0.85 + 0.3 * (0.5 + 0.5 * N.noise(p * 3.1)))
            l[col] = (cc.x, cc.y, cc.z, 1.0)
    ob = part(bm, mid, name=name, grime=0, tint=tint, bisect=False, smooth=True, jitter=0.0)
    return F.apply_col2(ob)


F.riprap_ring = riprap_ring


# ------------------------------------------------------------------ scuppers v2: cast-iron spout with a lip + flange
def scuppers(deck, y_face, xs, dz=-0.3, mid='cast_iron', streaks=True):
    s = 1 if y_face > 0 else -1
    bm = bmesh.new()
    for x in xs:
        z = deck.z(x) + dz
        C.box_bm(bm, (x, y_face + s * 0.02, z + 0.02), (0.42, 0.04, 0.34))                    # wall flange plate
        KB.cyl_bm(bm, (x, y_face + s * 0.03, z), (x, y_face + s * 0.42, z - 0.07), 0.11, 8)   # spout
        KB.cyl_bm(bm, (x, y_face + s * 0.40, z - 0.066), (x, y_face + s * 0.46, z - 0.078), 0.15, 8)   # lip
        if streaks:
            face_decal('streak_long', x, y_face, z - 0.14, 0.55, 1.5, alpha=0.4)
    ob = part(bm, mid, name='scuppers_%d' % s, grime=0.2, bisect=False, mat_tint=(0.62, 0.6, 0.57))
    return ob


BL.scuppers = scuppers


# ------------------------------------------------------------------ triangle housekeeping
def strip_bottoms(prefixes, nz=-0.9):
    """Delete downward faces of resting blocks (kerbs, coping) - they sit on the road / wall and are never seen."""
    n0 = 0
    for o in C.A.parts:
        if o.name in bpy.data.objects and o.name.startswith(tuple(prefixes)):
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bm.normal_update()
            kill = [f for f in bm.faces if f.normal.z < nz]
            n0 += len(kill)
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            bm.to_mesh(o.data)
            bm.free()
    C.log('strip_bottoms removed %d faces' % n0)


def kerbs(deck, x0, x1, width, mid='granite', kerb_w=0.3, kerb_h=0.12, stone=1.5, name='road_kerbs'):
    """Replacement for the kit kerbs (0.9 m stones): 1.5 m dressed kerbs (half the triangles), bottoms dropped."""
    for o in [o for o in C.A.parts if o.name.startswith(name)]:
        C.A.parts.remove(o)
        bpy.data.objects.remove(o)
    rw = width - 2 * kerb_w
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * (rw / 2 + kerb_w / 2)
        n = max(2, int((x1 - x0) / stone))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n + 0.006, x0 + (x1 - x0) * (i + 1) / n - 0.006
            KB.beam_bm(bm, (xa, y, deck.z(xa) + kerb_h / 2 - 0.05), (xb, y, deck.z(xb) + kerb_h / 2 - 0.05), kerb_w, kerb_h + 0.1)
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context='FACES')
    return part(bm, mid, name=name)


# ------------------------------------------------------------------ approach: embankment + earth fill against the wings
def embankment(deck, tot, width, wing_len, parapet_h, side, mid='sod', cell=0.8, thick=0.75, steps=3, L=None,
               slope=1.7, name='embank', tint=None):
    """Heightfield earth embankment on one bank (side -1 west / +1 east): carries the approach ramp (1:slope side
    slopes under the road edge) and fills against the land side of the stepped wing walls, feathering into the
    ground; cells that stay at ground level are dropped."""
    half = deck.half
    L = L if L is not None else (deck.ramp['L'] if getattr(deck, 'ramp', None) else 3.5)
    xe = tot / 2
    zt0 = deck.z(side * xe) + parapet_h - 0.05
    tops = [zt0 + (0.35 - zt0) * k / (steps - 1) for k in range(steps)]
    xa, xb = xe + 0.55, half + L + 3.5
    Y = width / 2 + wing_len + 3.5
    nx, ny = max(3, int((xb - xa) / cell)), max(6, int(2 * Y / cell))

    zre = deck.z(side * xe)

    def H(ax, y):
        ay = abs(y)
        zr = deck.z(side * ax) - 0.12
        hr = zr if ay <= width / 2 + 0.2 else zr - (ay - width / 2 - 0.2) / slope
        if ax < half:                 # beside the masonry body: fill only against the wings
            hr = min(hr, deck.z(side * ax) - 0.3)
        dx = max(0.0, ax - (xe + thick))
        if ay <= width / 2 + wing_len:
            k = min(steps - 1, int((ay - width / 2) / (wing_len / steps))) if ay > width / 2 else 0
            hw = min(tops[k] - 0.3, zre - 0.1 - 0.12 * (ay - width / 2)) - dx / 1.6
        else:
            hw = min(tops[-1] - 0.3, zre - 0.1 - 0.12 * wing_len) - (ay - width / 2 - wing_len) / 1.6 - dx / 1.6
        h = max(hr, hw)
        n = N.noise(V((ax * 0.45, y * 0.45, 7.7)))
        return max(-0.06, h + 0.07 * n * min(1.0, max(0.0, h) / 0.3))
    bm = bmesh.new()
    g = []
    for i in range(nx + 1):
        ax = xa + (xb - xa) * i / nx
        g.append([bm.verts.new((side * ax, -Y + 2 * Y * j / ny, H(ax, -Y + 2 * Y * j / ny))) for j in range(ny + 1)])
    for i in range(nx):
        for j in range(ny):
            q = (g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])
            if all(v.co.z < -0.03 for v in q):
                continue
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return part(bm, mid, name='%s_%d' % (name, side), grime=0.6, bisect=False, tint=tint, smooth=True, lod='keep')


def ramp_walls(deck, width, x_start, side, length=3.6, h=0.62, t=0.42, mid='fieldstone', coping='ashlar', name='rampwall'):
    """Low retaining parapets continuing the bridge parapets down the approach ramp, ending in capped piers."""
    for s in (-1, 1):
        y = s * (width / 2 - t / 2)
        bm = bmesh.new()
        n = 6
        xs = [side * (x_start + length * i / n) for i in range(n + 1)]
        rows = []
        for x in xs:
            zb, zt = deck.z(x) - 0.5, deck.z(x) + h * (1 - 0.35 * abs(x - xs[0]) / length)
            rows.append([bm.verts.new((x, y - t / 2, zb)), bm.verts.new((x, y - t / 2, zt)),
                         bm.verts.new((x, y + t / 2, zt)), bm.verts.new((x, y + t / 2, zb))])
        for i in range(n):
            a, b = rows[i], rows[i + 1]
            for k in range(3):
                bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.normal_update()
            if f.calc_center_median().z > max(v.co.z for v in f.verts) - 1e-4 and f.normal.z < 0:
                f.normal_flip()
        tops = [r_[1].co.copy() for r_ in rows]
        part(bm, mid, name='%s_%d_%d' % (name, side, s))
        cp = bmesh.new()
        for i in range(n):
            a, b = tops[i], tops[i + 1]
            KB.beam_bm(cp, V((a.x, y, a.z + 0.06)), V((b.x - side * 0.012, y, b.z + 0.06)), t + 0.08, 0.12, up=(0, 0, 1))
        xe = xs[-1] + side * 0.3
        ze = deck.z(xe)
        C.box_bm(cp, (xe, y, ze + 0.35), (0.6, 0.6, 1.3))
        b0 = [V((xe - 0.36, y - 0.36, ze + 1.0)), V((xe + 0.36, y - 0.36, ze + 1.0)), V((xe + 0.36, y + 0.36, ze + 1.0)), V((xe - 0.36, y + 0.36, ze + 1.0))]
        C.hexa_bm(cp, b0 + [p + V((0, 0, 0.1)) for p in b0])
        vs = [cp.verts.new(p + V((0, 0, 0.1))) for p in b0]
        ap = cp.verts.new(V((xe, y, ze + 1.36)))
        for k in range(4):
            cp.faces.new((vs[k], vs[(k + 1) % 4], ap))
        bmesh.ops.recalc_face_normals(cp, faces=cp.faces)
        cp.normal_update()
        bmesh.ops.delete(cp, geom=[f for f in cp.faces if f.normal.z < -0.9], context='FACES')
        part(cp, coping, name='%s_cop_%d_%d' % (name, side, s))


# ------------------------------------------------------------------ soffit v2: coursed barrel, per-course tone, not crushed
F.WING_OVS = 0.8
SOFFIT = {'course': 0.36, 'tone': 0.16, 'lift': 1.0}


def soffit(xc, span, spring, rise, width, mid='ashlar', name='voussoirs_soffit'):
    """Barrel soffit built course by course (each course its own strip, split into staggered blocks across the
    barrel) so every course carries its own stone tone in COLOR_0; UVs by arc length (courses run along the
    texture rows). Faces point into the opening."""
    at, L = F._arch_sampler(xc, span, spring, rise)
    nc = max(8, int(L / SOFFIT['course']))
    r = BL.rng()
    bm = bmesh.new()
    lay = bm.loops.layers.uv.new('UVMap')
    col = bm.loops.layers.color.new('Col2')
    tl = F.tile(mid)
    blk = SOFFIT.get('blk', 1.25)
    for k in range(nc):
        t0, t1 = k / nc, (k + 1) / nc
        x0, z0, nx0, nz0 = at(t0)
        x1, z1, nx1, nz1 = at(t1)
        off = (0.5 if k % 2 else 0.0) * blk
        ys = [-width / 2] + [y for y in [-width / 2 + off + blk * i for i in range(1, int(width / blk) + 2)] if -width / 2 + 0.2 < y < width / 2 - 0.2] + [width / 2]
        for j in range(len(ys) - 1):
            tone = SOFFIT['lift'] * (1 - SOFFIT['tone'] * r.random())
            cc = (tone, tone * (0.99 - 0.03 * r.random()), tone * (0.96 - 0.05 * r.random()), 1.0)
            vs = [bm.verts.new((x0 - nx0 * 0.015, ys[j], z0 - nz0 * 0.015)), bm.verts.new((x1 - nx1 * 0.015, ys[j], z1 - nz1 * 0.015)),
                  bm.verts.new((x1 - nx1 * 0.015, ys[j + 1], z1 - nz1 * 0.015)), bm.verts.new((x0 - nx0 * 0.015, ys[j + 1], z0 - nz0 * 0.015))]
            f = bm.faces.new(vs)
            f.normal_update()
            inward = V((-(nx0 + nx1), 0, -(nz0 + nz1)))
            if f.normal.dot(inward) < 0:
                f.normal_flip()
            for l in f.loops:
                tt = t0 if (l.vert is vs[0] or l.vert is vs[3]) else t1
                l[lay].uv = (l.vert.co.y / tl + 0.37, (L * tt) / tl + 0.21)
                l[col] = cc
    ob = part(bm, mid, name=name, uv='keep', bisect=False, grime=0)
    return F.apply_col2(ob)


_ring1 = F.arch_ring


def arch_ring(xc, span, spring, rise, width, mid='ashlar', depth=0.55, proud=0.035, block=0.34, key=True, soffit_=True,
              name='voussoirs', archivolt=True, **kw):
    ob = _ring1(xc, span, spring, rise, width, mid, depth, proud, block, key, False, name, archivolt)
    if kw.get('soffit', soffit_):
        soffit(xc, span, spring, rise, width, mid, name + '_soffit')
    return ob


KB.arch_ring = arch_ring
F.arch_ring = arch_ring


# ------------------------------------------------------------------ demolition: fracture faces, ragged edge, debris v2
def fix_fracture(fill_mid, rough=0.22, tone=(0.62, 0.56, 0.48)):
    """After F.breach: every face on a fill material (material index >= 1) or with collapsed UVs / black COLOR_0
    gets world UVs on the fill texture, is subdivided and noise-displaced in x-z (a torn, not planar, face) and
    coloured fresh-broken tan with dark voids (cavities in the rubble core)."""
    for o in C.A.parts:
        if o.name not in bpy.data.objects or o.get('kit_node', 'main') != 'main' or len(o.data.materials) < 2:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        fs = [f for f in bm.faces if f.material_index >= 1]
        if not fs:
            bm.free()
            continue
        edges = list({e for f in fs for e in f.edges})
        res = bmesh.ops.subdivide_edges(bm, edges=edges, cuts=2, use_grid_fill=True)
        fs = [f for f in bm.faces if f.material_index >= 1]
        vs = {v for f in fs for v in f.verts}
        for v in vs:
            p = v.co
            d = V((N.noise(p * 0.9 + V((1, 2, 3))), 0, N.noise(p * 0.9 + V((4, 5, 6)))))
            v.co = p + d * rough
        bm.normal_update()
        K.uv_faces(bm, fs, fill_mid, 'aligned')
        col = bm.loops.layers.color.get('Col')
        t = V(tone)
        for f in fs:
            for l in f.loops:
                p = l.vert.co
                cav = max(0.0, N.noise(p * 1.7 + V((9, 9, 9))) - 0.15) * 2.2
                c = t * (0.85 + 0.25 * N.noise(p * 3.0)) * (1 - min(0.75, cav))
                l[col] = (max(0, min(1, c.x)), max(0, min(1, c.y)), max(0, min(1, c.z)), 1.0)
        bm.to_mesh(o.data)
        bm.free()


def ragged_edge(poly, width, mid='ashlar', body='fieldstone', n_per_m=1.7, hang=4, xc=None, z_ring=None, name='breach_blocks'):
    """Loose masonry around the tear: blocks half bedded in the fracture on both spandrel faces and through the
    core (projecting, tilted, some dropped a little), plus a few voussoirs hanging from the ring stumps."""
    r = BL.rng()
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    segs = [(V((poly[i - 1][0], 0, poly[i - 1][1])), V((poly[i][0], 0, poly[i][1]))) for i in range(len(poly))]
    for a, b in segs:
        L = (b - a).length
        for k in range(max(1, int(L * n_per_m))):
            p = a.lerp(b, (k + r.random()) / max(1, int(L * n_per_m)))
            for yy in (-width / 2 + 0.25, width / 2 - 0.25, r.uniform(-width / 3, width / 3)):
                if r.random() < 0.3:
                    continue
                sz = V((r.uniform(0.32, 0.7), r.uniform(0.3, 0.55), r.uniform(0.22, 0.38)))
                c = V((p.x, yy + (0.02 if yy > 0 else -0.02), p.z + r.uniform(-0.1, 0.05)))
                rot = Euler((r.uniform(-0.35, 0.35), r.uniform(-0.45, 0.45), r.uniform(-0.3, 0.3))).to_matrix()
                _block(bm, col, c, rot, sz / 2, 0.62 + 0.3 * r.random())
    if xc is not None and z_ring is not None:          # voussoirs hanging from the two ring stumps
        for s in (-1, 1):
            xs_ = min((p[0] for p in poly), key=lambda x: abs(x - (xc + s * 99))) if False else (min(p[0] for p in poly) if s < 0 else max(p[0] for p in poly))
            for k in range(hang):
                y = -width / 2 + 0.4 + (width - 0.8) * r.random()
                c = V((xs_ - s * r.uniform(0.3, 0.8), y, z_ring - r.uniform(0.2, 0.6)))
                rot = Euler((r.uniform(-0.3, 0.3), s * r.uniform(0.4, 0.9), 0)).to_matrix()
                _block(bm, col, c, rot, V((0.2, 0.25, 0.3)), 0.62 + 0.3 * r.random(), taper=0.8)
    return F.apply_col2(part(bm, mid, name=name, grime=0, bisect=False, jitter=0.0))


_CORNERS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))


def _block(bm, col, c, rot, half, tone, taper=1.0, wet_z=None, tint=(1.0, 0.97, 0.92)):
    """One closed block (8 verts, outward normals) with a per-block COLOR_0 tone; below wet_z it darkens (wet)."""
    vs = [bm.verts.new(c + rot @ V((sx * half.x * (taper if sz > 0 else 1), sy * half.y, sz * half.z))) for sx, sy, sz in _CORNERS]
    for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        f = bm.faces.new([vs[i] for i in q])
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - c) < 0:
            f.normal_flip()
        for l in f.loops:
            t = tone
            if wet_z is not None and l.vert.co.z < wet_z + 0.15:
                t *= 0.45 + 0.55 * max(0.0, min(1.0, (l.vert.co.z - wet_z + 0.1) / 0.25))
            l[col] = (t * tint[0], t * tint[1], t * tint[2], 1.0)


def debris_pile(xc, yc, rx, ry, z_base, z_top, mids=('ashlar', 'fieldstone'), n=60, name='debris', tint=None,
                slabs=2, slab_mid=None, water=None, fan=1.7, steel=0, setts=0, fill_mid='scree_grey', flow=1):
    """Demolition debris in the river v2: a low, irregular fill mound of dark wet broken stone (scree texture)
    fanning downstream (flow = +1 -> +Y), a jumble of dressed blocks, wedge voussoirs and small spalls of mixed
    sizes bedded into the mound surface (wet-dark below the water line), a scatter of blocks carried out into the
    water, tilted parapet slabs, optional road setts and torn steel sections (I-beam stubs, bent plates)."""
    r = BL.rng()
    water = C.A.water if water is None else water

    def hgt(x, y):
        dy = (y - yc) / (ry * (fan if (y - yc) * flow > 0 else 1.0))
        d = math.sqrt(((x - xc) / rx) ** 2 + dy ** 2)
        k = 1 + 0.28 * N.noise(V((x * 0.5, y * 0.5, 3.3)))
        return z_base + (z_top - z_base) * max(0.0, 1 - d * k) ** 1.25
    # fill mound (heightfield ellipse, dropped where under the bed)
    bm = bmesh.new()
    colm = bm.loops.layers.color.new('Col2')
    m_ = 20
    Rx, Ry = rx * 1.15, ry * max(1.0, fan) * 1.15
    g = [[bm.verts.new((xc - Rx + 2 * Rx * i / m_, yc - Ry + 2 * Ry * j / m_, 0)) for j in range(m_ + 1)] for i in range(m_ + 1)]
    for row in g:
        for v in row:
            v.co.z = hgt(v.co.x, v.co.y) + 0.12 * N.noise(v.co * 1.3)
    for i in range(m_):
        for j in range(m_):
            q = (g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])
            if all(v.co.z <= z_base + 0.05 for v in q):
                continue
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for f in bm.faces:
        for l in f.loops:
            p = l.vert.co
            t = (0.46 + 0.1 * N.noise(p * 1.1)) * (0.42 if p.z < water + 0.08 else (0.7 if p.z < water + 0.3 else 1.0))
            l[colm] = (t, t * 0.95, t * 0.86, 1.0)
    F.apply_col2(part(bm, fill_mid, name=name + '_mound', grime=0, bisect=False, jitter=0.0, smooth=True, lod='keep'))
    # blocks: dressed, wedges, spalls
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    for i in range(n):
        big = r.random() < 0.35
        a, d = r.uniform(0, 2 * math.pi), math.sqrt(r.random()) * (1.25 if i % 5 == 0 else 0.95)
        x = xc + math.cos(a) * rx * d
        y = yc + math.sin(a) * ry * d * (fan if math.sin(a) * flow > 0 else 1.0)
        if big:
            half = V((r.uniform(0.3, 0.55), r.uniform(0.18, 0.3), r.uniform(0.14, 0.22)))
        elif r.random() < 0.5:
            half = V((r.uniform(0.18, 0.3), r.uniform(0.12, 0.2), r.uniform(0.1, 0.16)))
        else:
            half = V((r.uniform(0.08, 0.15), r.uniform(0.07, 0.12), r.uniform(0.05, 0.1)))
        z = hgt(x, y) + half.z * r.uniform(-0.2, 0.5)
        rot = Euler((r.uniform(-0.7, 0.7), r.uniform(-0.7, 0.7), r.uniform(0, 3.14))).to_matrix()
        tap = r.uniform(0.65, 0.9) if r.random() < 0.3 else 1.0
        _block(bm, col, V((x, y, z)), rot, half, (0.55 + 0.35 * r.random()) * (tint[0] if tint else 1.0), taper=tap, wet_z=water)
    for i in range(setts):
        a, d = r.uniform(0, 2 * math.pi), math.sqrt(r.random()) * 0.8
        x, y = xc + math.cos(a) * rx * d, yc + math.sin(a) * ry * d
        _block(bm, col, V((x, y, hgt(x, y) + 0.04)), Euler((r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(0, 3))).to_matrix(),
               V((0.09, 0.07, 0.07)), 0.35 + 0.2 * r.random(), wet_z=water, tint=(1.0, 1.0, 1.02))
    F.apply_col2(part(bm, mids[0], name=name + '_blocks', grime=0, bisect=False, jitter=0.0))
    if slabs:
        bm = bmesh.new()
        col = bm.loops.layers.color.new('Col2')
        for i in range(slabs):
            s = -1 if i % 2 == 0 else 1
            x, y = xc + r.uniform(-rx * 0.4, rx * 0.4), yc + s * ry * 0.55
            c = V((x, y, hgt(x, y) + 0.2))
            rot = Euler((s * r.uniform(0.35, 0.6), r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3))).to_matrix()
            _block(bm, col, c, rot, V((r.uniform(1.2, 1.7), 0.24, 0.5)), 0.75, wet_z=water)
        F.apply_col2(part(bm, slab_mid or mids[1], name=name + '_slabs', grime=0, bisect=False, jitter=0.0))
    if steel:
        bm = bmesh.new()
        for i in range(steel):
            a, d = r.uniform(0, 2 * math.pi), math.sqrt(r.random()) * 0.85
            x, y = xc + math.cos(a) * rx * d, yc + math.sin(a) * ry * d
            L = r.uniform(1.2, 3.2)
            h = hgt(x, y)
            ang = r.uniform(0, 3.14)
            p0 = V((x, y, h + 0.1))
            p1 = p0 + V((math.cos(ang) * L, math.sin(ang) * L, r.uniform(-0.2, 0.9)))
            if r.random() < 0.6:
                KB.ibeam_bm(bm, p0, p1, r.uniform(0.2, 0.32), r.uniform(0.14, 0.2)) if hasattr(KB, 'ibeam_bm') else KB.beam_bm(bm, p0, p1, 0.2, 0.3)
            else:
                KB.beam_bm(bm, p0, p1, r.uniform(0.6, 1.2), 0.02, up=(r.uniform(-1, 1), r.uniform(-1, 1), 1))
        part(bm, 'steel_painted', name=name + '_steel', grime=1.0, bisect=False, tint=(0.42, 0.45, 0.43), mat_tint=(0.5, 0.56, 0.52))


F.debris_pile = debris_pile


# ------------------------------------------------------------------ snow v3: matte snow, pillowed caps, thick blue-grey ice
def snow_mode():
    F.ALIAS['snow'] = ('snow_soft', (1.0, 1.0, 1.0), 1.0)
    F.DRIFT_W, F.RUT_DEPTH = 0.95, 0.97
    F.FLOE = (0.9, 2.1)


def pillow(ob, lift=0.07, over=0.045, min_nz=0.6):
    """Round the snow caps: top faces subdivided once; interior top vertices lifted (pillow), border vertices of the
    top region pushed out over the edge (overhang) and slightly down (rounded lip)."""
    if ob is None:
        return
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    top = [f for f in bm.faces if f.normal.z > min_nz and f.calc_area() > 0.02]
    bmesh.ops.subdivide_edges(bm, edges=list({e for f in top for e in f.edges}), cuts=1, use_grid_fill=True)
    bm.normal_update()
    topset = {f for f in bm.faces if f.normal.z > min_nz}
    moves = {}
    for v in {v for f in topset for v in f.verts}:
        side = [f for f in v.link_faces if f not in topset]
        if side:
            d = sum((f.normal for f in side), V())
            d.z = 0
            if d.length > 1e-6:
                moves[v] = d.normalized() * over + V((0, 0, -0.01))
        else:
            moves[v] = V((0, 0, lift * (0.7 + 0.6 * (0.5 + 0.5 * N.noise(v.co * 2.0)))))
    for v, d in moves.items():
        v.co += d
    bm.to_mesh(ob.data)
    bm.free()


def ice_col(ob, deep=(0.34, 0.45, 0.52), edge=(0.22, 0.3, 0.36)):
    """Blue-grey ice with snow-dusted patches (overrides the ice colours)."""
    me = ob.data
    ca = me.color_attributes.get('Col')
    if not ca:
        return
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            if poly.normal.z > 0.5:
                sn = max(0.0, min(1.0, -0.2 + 1.3 * N.noise(p * 0.7 + V((2, 3, 4)))))
                c = V(deep).lerp(V((0.9, 0.93, 0.96)), sn) * (0.92 + 0.08 * N.noise(p * 2.0))
            else:
                c = V(edge)
            ca.data[li].color = (c.x, c.y, c.z, 1.0)


# ------------------------------------------------------------------ LODs: LOD2 collapse not blocked by world-UV seams
LOD_DELIMIT = {1: {'UV', 'SHARP', 'MATERIAL'}, 2: {'MATERIAL'}}


def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    """kit build_lod with a per-level decimate delimit: at LOD2 (0.5x zoom) the world-projected UV seams around
    every block face stall the collapse at ~40 %; delimiting by material only lets it reach the ratio (UVs are
    interpolated - invisible at 0.5x). 'keep' parts (cambered road, embankments) are still joined undecimated."""
    import math as _m
    groups = {}
    for o in parts:
        node = o.get('kit_node', 'main')
        if level > 0 and node == 'decals' and KE.part_size(o) < (1.0 if level == 1 else 1e9):
            continue
        if level > 0 and (o.get('kit_lod') == 'drop' or (KE.part_size(o) < min_size and node == 'main' and o.get('kit_lod') != 'keep')):
            continue
        groups.setdefault(node, []).append(o)
    out = []
    for node, objs in groups.items():
        keep = [o for o in objs if level > 0 and o.get('kit_lod') == 'keep']
        cp = [KE._copy(o) for o in objs if o not in keep]
        piv = objs[0].get('kit_pivot')
        if not cp:
            cp, keep = [KE._copy(o) for o in keep], []
        ob = KE.join(cp, node if level == 0 else '%s_lod%d' % (node, level))
        if dissolve_deg > 0 and node != 'decals':
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)     # densify leaves split verts: they block collapse
            bmesh.ops.dissolve_limit(bm, angle_limit=_m.radians(dissolve_deg), verts=bm.verts, edges=bm.edges,
                                     delimit={'MATERIAL', 'UV'} if level < 2 else {'MATERIAL'})
            bm.to_mesh(ob.data)
            bm.free()
        if ratio and ratio < 1 and node != 'decals':
            m = ob.modifiers.new('dec', 'DECIMATE')
            m.ratio = ratio
            m.use_collapse_triangulate = True
            m.delimit = LOD_DELIMIT.get(level, {'UV', 'SHARP', 'MATERIAL'})
            KE._select([ob])
            bpy.ops.object.modifier_apply(modifier='dec')
        if keep:
            ob = KE.join([ob] + [KE._copy(o) for o in keep], ob.name)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(ob.data)
        bm.free()
        if piv:
            d = V(piv)
            ob.data.transform(Matrix.Translation(-d))
            ob.location = d
        out.append(ob)
    return out


KE.build_lod = build_lod


# ---- round-3: budget trim. Collapse-decimate the densified secondary parts (kerbs, copings, snow caps, wings, rubble)
# proportionally until the main node is under `target` triangles. Weathering vcols survive collapse (interpolated).
def trim_to(target, prefixes, floor=0.35):
    import bpy
    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    parts = [o for o in C.A.parts if o.type == 'MESH' and o.get('kit_node', 'main') == 'main' and not o.name.startswith('decal')]
    tot = sum(tri(o) for o in parts)
    cand = [o for o in parts if o.name.startswith(tuple(prefixes))]
    cs = sum(tri(o) for o in cand)
    ex = tot - target
    print('[trim] main %d target %d cand %d' % (tot, target, cs))
    if ex <= 0 or not cs:
        return tot
    ratio = max(floor, 1.0 - ex / cs)
    for o in cand:
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('trim', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    tot2 = sum(tri(o) for o in parts)
    print('[trim] ratio %.2f -> main %d' % (ratio, tot2))
    return tot2
