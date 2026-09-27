"""Military group helpers on top of the SHADOW SIX kit: sandbags, barbed wire, searchlight, MG on pintle,
timber posts, board walls, concrete blocks with chamfers, camouflage tints, arg parsing."""
import sys, os, math
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/blender')
import kit as K
import bmesh
from mathutils import Vector as V, Matrix

OUTROOT = '<claude-tmp>'


def args(default_var='a', default_seed=1):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    var = a[0] if a else default_var
    seed = int(a[1]) if len(a) > 1 else default_seed
    return var, seed


def outdir(name):
    return os.path.join(OUTROOT, name)


# ------------------------------------------------------------------ sandbags
BAGS = []          # (centre, shade) of every bag built since the last sandbags_part() -> per-bag tone variation


def bag_bm(bm, c, ang, L=0.58, W=0.32, H=0.15, r=None, tilt=0.0):
    """One filled sandbag: 5-ring loft (tied end pinched with an ear, folded end squarish), settled flat top, bulging
    sides, random size / rotation / roll / slump / bend so no two bags match."""
    r = r or K.rng()
    L, W, H = L * r.uniform(0.9, 1.08), W * r.uniform(0.9, 1.1), H * r.uniform(0.85, 1.15)
    ang += r.uniform(-0.1, 0.1)
    R = Matrix.Rotation(ang, 3, 'Z') @ Matrix.Rotation(tilt + r.uniform(-0.07, 0.07), 3, 'X') @ Matrix.Rotation(r.uniform(-0.05, 0.05), 3, 'Y')
    c = V(c)
    flip = 1 if r.random() < 0.5 else -1
    slump, bend = r.uniform(0.0, 0.025), r.uniform(-0.025, 0.025)
    prof = ((-0.54, 0.3, 0.35, 0.0), (-0.36, 0.92, 0.88, 0.5), (0.0, 1.0, 1.0, 1.0), (0.36, 0.97, 0.93, 0.5), (0.5, 0.78, 0.6, 0.0))
    rings = []
    for t, sw, sh, k in prof:
        ring = []
        for j in range(6):
            a = 2 * math.pi * j / 6 + math.pi / 6
            y = math.cos(a) * W / 2 * sw * (1.08 if abs(math.sin(a)) < 0.6 else 1.0)
            z = math.sin(a) * H / 2 * sh
            z = z * (0.72 if z > 0 else 1.0) - slump * k
            ring.append(c + R @ V((flip * t * L, y + bend * k, z + H / 2)))
        rings.append(ring)
    K.loft_bm(bm, rings)
    BAGS.append((c.copy(), r.uniform(0.78, 1.06)))
def sandbag_wall(bm, pts, courses=5, L=0.58, W=0.32, H=0.15, z0=0.0, closed=False, batter=0.04, r=None, skip=None):
    """Stretcher-bond sandbag wall along polyline pts (x,y); each course offset half a bag, battered inward."""
    r = r or K.rng()
    segs = list(zip(pts[:-1], pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
    n = 0
    for (a, b) in segs:
        a, b = V((*a, 0)), V((*b, 0))
        d = b - a
        Ls = d.length
        ang = math.atan2(d.y, d.x)
        nrm = V((d.y, -d.x, 0)).normalized()
        for k in range(courses):
            off = (L / 2) * (k % 2)
            m = int((Ls - off) / (L * 0.97))
            for i in range(m):
                t = off + (i + 0.5) * Ls / max(1, int(Ls / (L * 0.97)))
                if t > Ls:
                    break
                if skip and skip(a + d.normalized() * t, k):
                    continue
                p = a + d.normalized() * t + nrm * (batter * k) + V((r.uniform(-0.02, 0.02), r.uniform(-0.02, 0.02), z0 + k * H * 0.92))
                bag_bm(bm, p, ang + r.uniform(-0.08, 0.08), L, W, H, r, r.uniform(-0.05, 0.05))
                n += 1
    return n


def sandbag_ring(bm, c, radius, courses=5, gap_ang=None, gap_w=1.2, L=0.58, W=0.32, H=0.15, rings=1, r=None, z0=0.0):
    """Circular sandbag emplacement (optionally open behind: gap centred at angle gap_ang, width gap_w metres)."""
    r = r or K.rng()
    c = V(c)
    for ring in range(rings):
        rad = radius + ring * W * 1.02
        for k in range(courses - ring):
            rr = rad - k * 0.035
            n = max(6, int(2 * math.pi * rr / (L * 0.96)))
            for i in range(n):
                a = 2 * math.pi * (i + 0.5 * (k % 2)) / n
                if gap_ang is not None:
                    da = math.atan2(math.sin(a - gap_ang), math.cos(a - gap_ang))
                    if abs(da) * rr < gap_w / 2:
                        continue
                p = c + V((math.cos(a) * rr, math.sin(a) * rr, z0 + k * H * 0.92)) + V((r.uniform(-0.02, 0.02), r.uniform(-0.02, 0.02), 0))
                bag_bm(bm, p, a + math.pi / 2 + r.uniform(-0.06, 0.06), L, W, H, r, r.uniform(-0.05, 0.05))


def sandbags_part(bm, name='sandbags', tint=None, keep=False):
    from mathutils import kdtree
    ob = K.part(bm, 'burlap_bag', name=name, uv='aligned', mat_tint=tint or (0.8, 0.76, 0.66), grime=0.9, smooth=True, bisect=False, jitter=0.05)
    if BAGS:
        kd = kdtree.KDTree(len(BAGS))
        for i, (p, sh) in enumerate(BAGS):
            kd.insert(p, i)
        kd.balance()
        me = ob.data
        col = me.color_attributes.get('Col')
        if col is not None:
            for poly in me.polygons:
                sh = BAGS[kd.find(poly.center)[1]][1]
                for li in poly.loop_indices:
                    cc = list(col.data[li].color)
                    col.data[li].color = (cc[0] * sh, cc[1] * sh, cc[2] * sh * 0.98, cc[3])
    if not keep:
        BAGS.clear()
    return ob


# ------------------------------------------------------------------ barbed wire
def wire_line(bm, p0, p1, r=0.007, barbs=0.35):
    """Straight barbed-wire strand (3-sided tube) with small barb crosses every `barbs` metres."""
    p0, p1 = V(p0), V(p1)
    K.cyl_bm(bm, p0, p1, r, 3, caps=False)
    if barbs:
        d = (p1 - p0)
        L = d.length
        n = int(L / barbs)
        ax = d.normalized()
        s = ax.orthogonal().normalized()
        for i in range(1, n):
            q = p0 + d * (i / n)
            s2 = (Matrix.Rotation(i * 1.3, 3, ax) @ s) * 0.045
            K.cyl_bm(bm, q - s2, q + s2, 0.004, 3, caps=False)


def concertina(bm, p0, p1, radius=0.45, pitch=0.22, segs=10, r=0.006):
    """Concertina coil lying along p0->p1 on the ground (helix with slightly jittered loops)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    L = d.length
    ax = d.normalized()
    up = V((0, 0, 1))
    s = ax.cross(up).normalized()
    rng = K.rng()
    n = int(L / pitch * segs)
    pts = []
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * t * L / pitch
        rr = radius * (1 + 0.06 * math.sin(i * 0.37))
        q = p0 + d * t + s * math.cos(a) * rr + up * (radius + math.sin(a) * rr * 0.95)
        q += V((rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01), 0))
        pts.append(q)
    for a, b in zip(pts[:-1], pts[1:]):
        K.cyl_bm(bm, a, b, r, 3, caps=False)


def wire_part(bm, name='wire'):
    return K.part(bm, 'steel_galv', name=name, uv='aligned', mat_tint=(0.55, 0.45, 0.38), grime=0, bisect=False, lod='drop')


# ------------------------------------------------------------------ equipment
def searchlight(p, yaw=0.0, name='searchlight', r_drum=0.32):
    """60 cm Flak-style searchlight on a pedestal: drum with cooling fins, lens (glass), yoke, base."""
    p = V(p)
    R = Matrix.Rotation(yaw, 3, 'Z')
    bm = bmesh.new()
    K.cyl_bm(bm, p, p + V((0, 0, 0.5)), 0.08, 8)
    K.cyl_bm(bm, p, p + V((0, 0, 0.06)), 0.22, 8)
    c = p + V((0, 0, 0.85))
    fwd = R @ V((0, -1, 0))
    side = R @ V((1, 0, 0))
    for s in (-1, 1):                                  # yoke arms
        K.beam_bm(bm, p + V((0, 0, 0.5)) + side * s * 0.05, c + side * s * (r_drum + 0.05), 0.04, 0.06)
    K.cyl_bm(bm, c - fwd * 0.35, c + fwd * 0.3, r_drum, 12)
    for k in range(4):                                 # fins at the back
        q = c - fwd * (0.2 + k * 0.05)
        K.cyl_bm(bm, q, q - fwd * 0.018, r_drum + 0.03, 12)
    K.cyl_bm(bm, c + fwd * 0.3, c + fwd * 0.34, r_drum + 0.02, 12, r1=r_drum + 0.02)
    K.part(bm, 'steel_painted', name=name, mat_tint=(0.72, 0.75, 0.7), grime=0.4, bisect=False, smooth=True)
    bm = bmesh.new()
    K.cyl_bm(bm, c + fwd * 0.33, c + fwd * 0.345, r_drum - 0.02, 12)
    K.part(bm, 'glass_dirty', name=name + '_lens', grime=0, bisect=False)
    K.anchor('searchlight', tuple(c), tuple(fwd), kind='searchlight', radius=18.0)


def mg34(p, yaw=0.0, name='mg', tripod=True):
    """MG 34 on a Lafette tripod (or a pintle when tripod=False). p = centre of the gun cradle."""
    p = V(p)
    R = Matrix.Rotation(yaw, 3, 'Z')
    f = R @ V((0, -1, 0))
    s = R @ V((1, 0, 0))
    bm = bmesh.new()
    K.cyl_bm(bm, p - f * 0.3, p + f * 0.68, 0.042, 8)                   # perforated barrel jacket (read at 1x)
    K.box_bm(bm, tuple(p - f * 0.35 + V((0, 0, 0.01))), (0.09, 0.3, 0.1), yaw)                  # receiver
    K.cyl_bm(bm, p + f * 0.68, p + f * 0.82, 0.022, 6)                  # muzzle booster
    K.beam_bm(bm, p - f * 0.45, p - f * 0.85 - V((0, 0, 0.06)), 0.07, 0.13)   # stock
    K.beam_bm(bm, p - f * 0.1 - V((0, 0, 0.02)), p - f * 0.1 - V((0, 0, 0.14)), 0.03, 0.05)
    K.cyl_bm(bm, p + s * 0.06, p + s * 0.06 + V((0, 0, 0.1)), 0.05, 8)        # drum mag
    if tripod:
        base = p - V((0, 0, 0.08))
        for a in (0.0, 2.3, -2.3):
            d = R @ V((math.sin(a), -math.cos(a), 0))
            K.beam_bm(bm, base, V((base.x, base.y, 0)) + d * 0.7 + V((0, 0, p.z - 0.45 if p.z > 0.6 else 0)), 0.05, 0.05)
    else:
        K.cyl_bm(bm, p - V((0, 0, 0.05)), p - V((0, 0, 0.9)), 0.025, 6)
    K.part(bm, 'cast_iron', name=name, grime=0.1, bisect=False, lod='drop')
    K.anchor('mg', tuple(p), tuple(f), kind='mg34')


# ------------------------------------------------------------------ concrete
def chamfer_block(bm, x0, y0, x1, y1, z0, z1, ch=0.15, top_ch=True):
    """Box with chamfered vertical and top edges (Regelbau look)."""
    c = ch
    ring = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]
    inner = [(x0 + c * 2, y0 + c), (x1 - c * 2, y0 + c), (x1 - c, y0 + c * 2), (x1 - c, y1 - c * 2), (x1 - c * 2, y1 - c), (x0 + c * 2, y1 - c),
             (x0 + c, y1 - c * 2), (x0 + c, y0 + c * 2)] if top_ch else ring
    rings = [[V((x, y, z0)) for x, y in ring], [V((x, y, z1 - (c if top_ch else 0))) for x, y in ring], [V((x, y, z1)) for x, y in inner]]
    K.loft_bm(bm, rings)


def conc_part(bm, name, mid='concrete_board', tint=None, **kw):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, mat_tint=tint, **kw)


CAMO = {'grey': None, 'ochre': (1.05, 0.95, 0.78), 'green': (0.82, 0.9, 0.78), 'desert': (1.12, 1.0, 0.82)}


def camo_patches(poly_faces, colors, n=10, r=None):
    """Painted camouflage: decal-free - returns list of (center, normal, w, h) for 'stain_blotch' decals."""
    r = r or K.rng()
    out = []
    for i in range(n):
        c, nrm, w, h = r.choice(poly_faces)
        out.append((c, nrm, w, h))
    return out


def berm(inner, outer, h, mid='sod', name='berm', n=6, jitter=0.1, bulge=0.12, taper_end=None, closed=False, rows=9, step=0.55,
         toe=0.6, undulate=0.16):
    """Earth mound banked from an inner polyline (against a wall; crest height h or h(seg, t)) out to an outer
    polyline on the ground. Convex settled crest, profile z = h (1 - u^1.7)^1.8 that runs out TANGENT to the ground
    (plus a `toe` overshoot sunk 5 cm) so it blends into the terrain; value-noise undulation, smooth shading.
    taper_end: fraction of the first/last segment over which the crest falls to 0 (open ends)."""
    from mathutils import noise
    r = K.rng()
    sd = r.uniform(0, 100)
    segs = list(range(len(inner) - 1)) + ([len(inner) - 1] if closed else [])
    cols = []
    for si in segs:
        a, b = si, (si + 1) % len(inner)
        L = max(V((*inner[a], 0)) - V((*inner[b], 0)), V((*outer[a], 0)) - V((*outer[b], 0)), key=lambda v: v.length).length
        m = max(2, int(L / step))
        last = si == segs[-1]
        for i in range(m + (1 if last and not closed else 0)):
            t = i / m
            ca = V((*inner[a], 0)).lerp(V((*inner[b], 0)), t)
            oa = V((*outer[a], 0)).lerp(V((*outer[b], 0)), t)
            hh = (h(si, t) if callable(h) else h) + r.uniform(-jitter, jitter * 0.6) * 0.5
            if taper_end and last and not closed and t > 1 - taper_end:
                hh *= max(0.04, (1 - t) / taper_end)
            if taper_end and si == segs[0] and not closed and t < taper_end:
                hh *= max(0.04, t / taper_end + 0.04)
            cols.append((ca, oa, hh))
    if closed:
        cols.append(cols[0])
    bm = bmesh.new()
    grid = []
    for ca, oa, hh in cols:
        d = oa - ca
        dl = d.length
        dn = d.normalized() if dl > 1e-4 else V((0, 0, 0))
        row = []
        for k in range(rows + 1):
            u = k / rows
            p = ca + d * u + dn * (toe * u ** 3)
            z = hh * (1 - u ** 1.7) ** 1.8
            nz = noise.noise(V((p.x * 0.55 + sd, p.y * 0.55, 0.3)))
            z += undulate * max(hh, 0.4) * nz * math.sin(math.pi * min(1.0, u * 1.1))
            z -= 0.05 * u ** 2
            jx = noise.noise(V((p.x * 0.9, p.y * 0.9 + sd, 1.7))) * 0.12 * u
            row.append(bm.verts.new((p.x + jx, p.y - jx, max(-0.06, z))))
        grid.append(row)
    for i in range(len(grid) - 1):
        for k in range(rows):
            bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    ob = K.part(bm, mid, name=name, grime=0.0, smooth=True, bisect=False)          # no damp-base band at the toe
    planar_uv(ob, mid)            # rework 2: top-down UVs at the ground's tile -> texture runs on into the terrain
    return ob


def planar_uv(ob, mid, tile=None):
    """World XY planar UVs (1 unit = one tile) - mounds, spills, turf: no stretching on slopes, no seam at the toe."""
    t = tile or K.MATS[mid]['tile_m']
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers[0]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = ob.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co.x / t, co.y / t)


def cutter_box(x0, y0, z0, x1, y1, z1):
    c = bmesh.new()
    K.box_bm(c, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0))
    return c


def xform_parts(parts, T, ground=None):
    """Apply a 4x4 transform to already-built parts (collapse / topple for destroyed variants).
    ground: afterwards lift/drop everything so the lowest vertex sits at this z."""
    for o in parts:
        o.data.transform(T)
        if o.get('kit_pivot'):
            del o['kit_pivot']
    if ground is not None:
        mz = min(v.co.z for o in parts for v in o.data.vertices)
        for o in parts:
            o.data.transform(Matrix.Translation((0, 0, ground - mz)))


def finalize(outdir, merge=True, **kw):
    """K.finalize after dropping empty parts (booleans / skipped geometry can leave meshes with no faces)."""
    import bpy
    A = K.A()
    keep = []
    for o in A.parts:
        if o.name not in bpy.data.objects:
            continue
        if len(o.data.polygons) == 0:
            K.log('drop empty part', o.name)
            bpy.data.objects.remove(o)
            continue
        keep.append(o)
    A.parts[:] = keep
    fix_cut_faces()
    concrete_remap()
    st = {}
    for o in A.parts:
        k = o.name.rstrip('0123456789.-_')
        st[k] = st.get(k, 0) + _tris(o)
    K.log('PARTSTATS', sorted(st.items(), key=lambda t: -t[1])[:30])
    keep = list(A.parts)
    for o in keep:                               # rubble stones / debris half-buried: clamp to just below the ground
        if ('rubble' in o.name or 'debris' in o.name or 'wreck' in o.name) and A.water is None:
            for v in o.data.vertices:
                if v.co.z < -0.08:
                    v.co.z = -0.08
    if merge:
        merge_parts()
    for o in A.parts:                             # kit fix: decal quads must not occlude the AO bake (dark rectangles)
        if o.get('kit_node', 'main') == 'decals':
            o.hide_render = True
    meta = K.finalize(outdir, **kw)
    import glb_color8, json as _j                # 8-bit vertex colours (see glb_color8.py)
    for l in meta['lods']:
        p = os.path.join(outdir, l['file'])
        glb_color8.pack(p)
        l['bytes'] = os.path.getsize(p)
    sc = os.path.join(outdir, A.name + '.kit.json')
    m = _j.load(open(sc))
    m['lods'] = meta['lods']
    _j.dump(m, open(sc, 'w'), indent=1)
    K.log('color8 sizes', [(l['file'], l['bytes']) for l in meta['lods']])
    return meta


# ------------------------------------------------------------------ concrete re-materialisation (rework 1)
# The library concretes (concrete_board / concrete_bunker) have ~3 % contrast and read as untextured grey. At finalize
# every part using them is split by face orientation: walls -> CONC_WALL (board-formwork with tie holes, lifts, rust
# weeping, efflorescence), up-facing faces -> CONC_TOP (weathered slab: water stains, lichen, cracks). UVs are redone
# with the new tile sizes. Set CONC_WALL = CONC_TOP = 'concrete_camo' for painted camouflage variants.
CONC_WALL, CONC_TOP = 'concrete_formwork', 'concrete_slab'
_CONC_OLD = ('concrete_board', 'concrete_bunker', 'concrete_formwork', 'concrete_slab', 'concrete_camo', 'concrete_camo_heer')


def concrete_remap():
    import bpy
    A = K.A()
    for o in list(A.parts):
        if o.name not in bpy.data.objects or not o.data.materials or o.get('kit_node', 'main') == 'decals':
            continue
        m = o.data.materials[0]
        if m.get('kit_id') not in _CONC_OLD or o.get('conc_fixed'):
            continue
        tint = tuple(m['kit_tint']) if 'kit_tint' in m.keys() else None
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        tops = [f for f in bm.faces if f.normal.z > 0.75]
        if not tops or len(tops) == len(bm.faces) or CONC_TOP == CONC_WALL:
            mid = CONC_TOP if tops and len(tops) == len(bm.faces) else CONC_WALL
            K.uv_faces(bm, bm.faces, mid, 'aligned')
            bm.to_mesh(o.data)
            bm.free()
            o.data.materials[0] = K.mat(mid, tint)
            o['conc_fixed'] = 1
            continue
        bt = bm.copy()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.75], context='FACES')
        bt.normal_update()
        bmesh.ops.delete(bt, geom=[f for f in bt.faces if f.normal.z <= 0.75], context='FACES')
        K.uv_faces(bm, bm.faces, CONC_WALL, 'aligned')
        K.uv_faces(bt, bt.faces, CONC_TOP, 'aligned')
        bm.to_mesh(o.data)
        bm.free()
        o.data.materials[0] = K.mat(CONC_WALL, tint)
        o['conc_fixed'] = 1
        me = bpy.data.meshes.new(o.name + '_top')
        bt.to_mesh(me)
        bt.free()
        ob = bpy.data.objects.new(o.name + '_top', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.matrix_world = o.matrix_world
        ob.data.materials.append(K.mat(CONC_TOP, tint))
        for k in ('kit_node', 'kit_lod', 'kit_pivot'):
            if k in o.keys():
                ob[k] = o[k]
        ob['conc_fixed'] = 1
        A.parts.append(ob)


# ------------------------------------------------------------------ kit fix (local): boolean break faces
# Faces created by EXACT boolean cuts (blast bites, hollowing) inherit the cutter's empty attributes: UVs collapse to a
# point and COLOR_0 is black -> "flat untextured cardboard". Re-project their UVs with the part's material and give
# them a fresh-fracture tint (slightly lighter, dusty) with the usual vertex grime.
def fix_cut_faces(tint=(0.92, 0.9, 0.86)):
    import bpy
    import kit_core as C
    for o in K.A().parts:
        if o.name not in bpy.data.objects or not o.data.materials or o.get('kit_node', 'main') == 'decals':
            continue
        mid = o.data.materials[0].get('kit_id')
        if not mid:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        uv = bm.loops.layers.uv.get('UVMap')
        col = bm.loops.layers.color.get('Col') or bm.loops.layers.float_color.get('Col')
        if uv is None:
            bm.free()
            continue
        bad = []
        for f in bm.faces:
            u0 = f.loops[0][uv].uv
            if all((l[uv].uv - u0).length < 1e-7 for l in f.loops) or (col is not None and all(sum(l[col][:3]) < 0.02 for l in f.loops)):
                bad.append(f)
        if bad:
            bm.normal_update()
            K.uv_faces(bm, bad, mid, 'aligned')
            if col is not None:
                for f in bad:
                    for l in f.loops:
                        c = C.grime_color(l.vert.co, f.normal, 0.8, tint)
                        l[col] = (min(c.x, 1), min(c.y, 1), min(c.z, 1), 1.0)
            bm.to_mesh(o.data)
            K.log('fixed %d cut faces on %s' % (len(bad), o.name))
        bm.free()


def merge_parts():
    """Join parts that share node + material + LOD flag + size class (<0.3 m, <0.9 m, larger) so the per-object AO bake
    and scene syncs stay fast on assets with hundreds of parts. Small-part groups are flagged kit_lod='drop' so LOD1/2
    still lose them (the kit drops parts < 0.3 m at LOD1)."""
    import bpy
    import kit_export as KE
    A = K.A()
    groups = {}
    for o in A.parts:
        node = o.get('kit_node', 'main')
        if o.get('kit_pivot'):
            groups.setdefault(('pivot', o.name), []).append(o)
            continue
        mat = o.data.materials[0].name if o.data.materials else ''
        sz = KE.part_size(o)
        cls = 'a' if sz < 0.3 else ('b' if sz < 0.9 else 'c')
        groups.setdefault((node, mat, o.get('kit_lod', ''), cls), []).append(o)
    out = []
    n0 = len(A.parts)
    for key, objs in groups.items():
        if len(objs) == 1 or key[0] == 'pivot':
            out += objs
            continue
        lod = key[2]
        KE._select(objs)
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = '%s_%s_%s' % (key[0], key[1].replace('kit:', '')[:24], key[3])
        if key[3] == 'a' and key[0] == 'main' and lod != 'keep':
            ob['kit_lod'] = 'drop'
        out.append(ob)
    A.parts[:] = out
    K.log('merged parts %d -> %d' % (n0, len(out)))


# ------------------------------------------------------------------ kit fix (local): export COLOR_0
# kit_export.export_glb passes export_vertex_color='ACTIVE' + export_all_vertex_colors=False, which in Blender 4.2 drops
# the 'Col' attribute (no COLOR_0 in any GLB -> no vertex grime, no decal opacity). Patch the call for this group.
def _patch_export():
    import bpy
    import kit_export as KE
    if getattr(KE, '_mil_patched', False):
        return
    orig = bpy.ops.export_scene.gltf

    def export_glb(path, objs):
        for o in objs:
            ca = o.data.color_attributes
            if 'Col' in ca:
                ca.active_color = ca['Col']
                ca.render_color_index = [c.name for c in ca].index('Col')   # 'ACTIVE' export uses the render colour
        KE._select(objs)
        kw = dict(filepath=path, use_selection=True, export_format='GLB', export_yup=True, export_apply=True,
                  export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
                  export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
                  export_image_format='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                  export_active_vertex_color_when_no_material=True)
        orig(**kw)
    KE.export_glb = export_glb
    KE._mil_patched = True


_patch_export()


# ------------------------------------------------------------------ kit fix (local): soft-edged decals
# The shared decal atlas cells keep 0.5-0.9 alpha at their borders, so every decal quad shows a hard square edge.
# Replacement decal(): 4x4-vertex grid (9 quads) whose border vertices get vertex alpha 0 -> edges fade out.
DECAL_RIM = 0.0


def _soft_decal(kind, center, normal, w, h, up=(0, 0, 1), offset=0.006, flip=False, name=None, node='decals', alpha=0.85):
    import kit_weather as W
    import kit_core as C
    n = V(normal).normalized()
    u = V(up)
    rr = u.cross(n)
    if rr.length < 1e-4:
        rr = V((1, 0, 0))
    rr.normalize()
    u = n.cross(rr).normalized()
    c = V(center) + n * offset
    rc = list(W.rects()['decals'].get(kind, [0, 0, 0.25, 0.25]))
    if flip:
        rc[0], rc[2] = rc[2], rc[0]
    fr = (0.0, 0.5, 1.0)                        # 2x2 quads, alpha 0 at the rim -> soft, shapeless edge
    ng = len(fr) - 1
    bm = bmesh.new()
    vs = [[bm.verts.new(c + rr * (fx - 0.5) * w + u * (fy - 0.5) * h) for fx in fr] for fy in fr]
    lay = bm.loops.layers.uv.new('UVMap')
    for j in range(ng):
        for i in range(ng):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[lay].uv = (rc[0] + fr[a] * (rc[2] - rc[0]), rc[1] + fr[b] * (rc[3] - rc[1]))
    ob = C.part(bm, 'decals', name=name or 'decal_' + kind, uv='keep', grime=0, node=node, bisect=False, jitter=0.0, alpha=alpha)
    me = ob.data
    col = me.color_attributes.get('Col')
    if col:
        for poly in me.polygons:
            for li in poly.loop_indices:
                p = me.vertices[me.loops[li].vertex_index].co - c
                dx, dy = abs(p.dot(rr)) / (w / 2), abs(p.dot(u)) / (h / 2)
                if dx > 0.99 or dy > 0.99:
                    cc = list(col.data[li].color)
                    cc[3] = cc[3] * DECAL_RIM              # R4: DECAL_RIM > 0 = stronger decal (rim not fully faded)
                    col.data[li].color = cc
    return ob


def rubble(center, radius=2.0, height=0.9, mids=('concrete_bunker',), mound_tint=(0.9, 0.9, 0.9), n=40, beams=3, tiles='roof_slate',
           seed=None, name='rubble', footprint=True, block_tint=(0.86, 0.86, 0.84), scree='scree_grey', clip=None, pile=False):
    """Rework 2: grey masonry rubble instead of the kit's faceted orange gravel cone. Smooth-shaded 10x28 scree mound
    (scree_grey: broken grey stone) with a noisy, lobed, tangent-to-ground outline; squared masonry blocks and slabs
    (mids) resting ON the mound surface, partly buried; beams (if any) lie on the slope (both ends on the surface);
    thick slate/tile shards lie on the surface. clip(x, y) -> bool drops blocks where it returns False."""
    from mathutils import noise as N
    r = K.rng()
    c = V(center)
    sd = r.uniform(0, 50) if seed is None else seed
    lob = lambda a: 1 + 0.22 * N.noise(V((math.cos(a) * 1.6 + sd, math.sin(a) * 1.6, 0.7))) + 0.1 * math.sin(3 * a + sd)

    def zs(x, y):
        d = V((x - c.x, y - c.y, 0))
        a = math.atan2(d.y, d.x)
        t = d.length / (radius * lob(a))
        if t >= 1:
            return c.z - 0.05
        lump = (0.3 * N.noise(V((x * 2.3 + sd, y * 2.3, 4.4))) + 0.18 * N.noise(V((x * 0.8 + sd, y * 0.8, 2.2)))) if pile else 0.18 * N.noise(V((x * 0.8 + sd, y * 0.8, 2.2)))
        return c.z - 0.05 + height * (0.85 if pile else 1.0) * (1 - t * t) ** 1.4 * (1 + lump)
    bm = bmesh.new()
    # R4 pile=True: a low, faceted, lumpy core (few facets) buried under several courses of individual blocks
    rings, segs = (4, 11) if pile else (max(6, min(10, int(radius * 3))), max(14, min(28, int(radius * 8))))
    top = bm.verts.new((c.x, c.y, zs(c.x, c.y)))
    prev = None
    for i in range(1, rings + 1):
        t = (i / rings) ** 0.8
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            rr = radius * lob(a) * min(1.06, t * 1.06)
            x, y = c.x + math.cos(a) * rr, c.y + math.sin(a) * rr
            ring.append(bm.verts.new((x, y, zs(x, y) if i < rings else c.z - 0.06)))
        for j in range(segs):
            k = (j + 1) % segs
            if prev is None:
                bm.faces.new((top, ring[j], ring[k]))
            else:
                bm.faces.new((prev[j], ring[j], ring[k], prev[k]))
        prev = ring
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, scree, name=name + '_mound', mat_tint=mound_tint, grime=0.35, smooth=not pile, bisect=False)
    bm = bmesh.new()
    for i in range(n * 3 if pile else n):
        a, d = r.uniform(0, 2 * math.pi), radius * (r.random() ** (0.7 if pile else 0.5)) * 0.95
        x, y = c.x + math.cos(a) * d, c.y + math.sin(a) * d
        if clip and not clip(x, y):
            continue
        L = r.uniform(0.35, 0.95) if pile else r.uniform(0.25, 0.7)
        sz = (L, L * r.uniform(0.45, 0.8), L * r.uniform(0.3, 0.55))
        nb = len(bm.verts)
        stack = r.choice((0.0, 0.0, 0.35, 0.6)) * L if pile else 0.0      # blocks resting on blocks
        K.box_bm(bm, (x, y, zs(x, y) + sz[2] * 0.15 + stack), sz, r.uniform(0, math.pi))
        tilt = 0.7 if pile else 0.45
        R = Matrix.Rotation(r.uniform(-tilt, tilt), 4, 'X') @ Matrix.Rotation(r.uniform(-tilt, tilt), 4, 'Y')
        bm.verts.ensure_lookup_table()
        vs = bm.verts[nb:]
        cc = sum((v.co for v in vs), V()) / len(vs)
        for v in vs:
            v.co = cc + (R @ (v.co - cc))
    if len(bm.faces):
        half = len(bm.faces) // 12 * 6
        bm2 = bm.copy()
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=list(bm.faces)[half:], context='FACES')
        bmesh.ops.delete(bm2, geom=list(bm2.faces)[:half], context='FACES')
        K.part(bm, mids[0], name=name + '_stones', mat_tint=block_tint, grime=0.6)
        K.part(bm2, mids[-1], name=name + '_stones', mat_tint=tuple(x * 0.93 for x in block_tint), grime=0.6)
    if beams:
        bm = bmesh.new()
        for i in range(beams):
            a = r.uniform(0, math.pi)
            L = r.uniform(1.4, radius * 1.5)
            p = c + V((r.uniform(-0.4, 0.4) * radius, r.uniform(-0.4, 0.4) * radius, 0))
            d = V((math.cos(a), math.sin(a), 0))
            p0, p1 = p - d * L / 2, p + d * L / 2
            K.beam_bm(bm, (p0.x, p0.y, zs(p0.x, p0.y) + 0.06), (p1.x, p1.y, zs(p1.x, p1.y) + 0.06), 0.18, 0.2, roll=r.uniform(0, 1))
        K.part(bm, 'timber_tarred', name=name + '_beams', uv='beam', axis=(1, 0, 0), mat_tint=(0.7, 0.66, 0.62))
    if tiles:
        bm = bmesh.new()
        for i in range(n // 3):
            a, d = r.uniform(0, 2 * math.pi), radius * r.uniform(0.2, 1.0)
            x, y = c.x + math.cos(a) * d, c.y + math.sin(a) * d
            K.box_bm(bm, (x, y, zs(x, y) + 0.02), (r.uniform(0.22, 0.34), r.uniform(0.15, 0.24), 0.04), r.uniform(0, 3))
        K.part(bm, tiles, name=name + '_shards', grime=0.3)
    if footprint:
        K.footprint([(c.x + math.cos(a) * radius * 0.8, c.y + math.sin(a) * radius * 0.8) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')
    return zs


def _patch_decal():
    import kit_weather as W
    if getattr(W, '_mil_soft', False):
        return
    W.decal = _soft_decal
    K.decal = _soft_decal
    W._mil_soft = True


_patch_decal()


# ------------------------------------------------------------------ kit fix (local): LOD2 at ~11 % of LOD0
# The kit's LOD2 keeps every merged part > 0.9 m and decimates with a UV delimit; world-projected UVs make almost
# every edge a seam, so LOD2 stalls at 20-30 %. For this group LOD2 drops small/medium parts (< 1.2 m) and decals,
# decimates everything (incl. lod='keep' parts) with a MATERIAL-only delimit and an adaptive ratio aimed at 11 %.
LOD2_TARGET = 0.11


def _tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def _slab_hull(ob):
    """Door leaves at LOD2: replace a slab-like node (thinnest principal extent < 0.3 m) by its convex hull."""
    me = ob.data
    if not me.vertices:
        return False
    import numpy as np
    P = np.array([v.co[:] for v in me.vertices])
    c = P - P.mean(0)
    w, vec = np.linalg.eigh(c.T @ c)
    ext = (c @ vec).ptp(0)
    if ext.min() > 0.3:
        return False
    mid = me.materials[0].get('kit_id', 'wood_paint') if me.materials else 'wood_paint'
    bm = bmesh.new()
    bm.from_mesh(me)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.delete(bm, geom=[g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)], context='VERTS')
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(g for g in res['geom'] if isinstance(g, bmesh.types.BMFace))], context='FACES')
    for f in bm.faces:
        f.material_index = 0
        f.smooth = False
    bm.normal_update()
    K.uv_faces(bm, bm.faces, mid, 'aligned', offset=(0.3, 0.7))
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.float_color.get('Col')
    if col is not None:
        for f in bm.faces:
            for l in f.loops:
                l[col] = (0.82, 0.8, 0.78, 1.0)
    bm.to_mesh(me)
    bm.free()
    return True


def _cull_islands(ob, goal, max_keep):
    """Delete the smallest loose pieces (by surface area, never those > max_keep m^2) until tris <= goal."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    seen, isl = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        st, comp = [f], []
        seen.add(f.index)
        while st:
            g = st.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        st.append(h)
        isl.append((sum(g.calc_area() for g in comp), comp))      # metric: surface area (m^2)
    isl.sort(key=lambda t: t[0])
    tot = sum(len(f.verts) - 2 for f in bm.faces)
    kill = []
    for d, comp in isl:
        if tot <= goal or d > max_keep:
            break
        nt = sum(len(f.verts) - 2 for f in comp)
        if tot - nt < goal * 0.6:
            continue                                           # never overshoot: keep the big pieces
        kill += comp
        tot -= nt
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


def _patch_lod():
    import bpy
    import kit_export as KE
    if getattr(KE, '_mil_lod', False):
        return
    orig = KE.build_lod

    def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
        if level < 2:
            return orig(level, parts, ratio, min_size, dissolve_deg)
        solid = [o for o in parts if o.get('kit_node', 'main') != 'decals']
        t0 = sum(_tris(o) for o in solid)
        groups = {}
        for o in solid:
            node = o.get('kit_node', 'main')
            if o.get('kit_lod') == 'drop':
                continue
            if node == 'main' and o.get('kit_lod') != 'keep2' and KE.part_size(o) < 1.2:
                continue
            groups.setdefault(node, []).append(o)
        t1 = sum(_tris(o) for objs in groups.values() for o in objs)
        rr = max(0.02, min(1.0, LOD2_TARGET * t0 / max(1, t1)))
        K.log('mil LOD2: lod0 %d tris, kept %d -> ratio %.3f' % (t0, t1, rr))
        out = []
        budget = LOD2_TARGET * t0
        order = sorted(groups.items(), key=lambda kv: kv[0] == 'main')          # doors first, main gets the rest
        for node, objs in order:
            ob = KE.join([KE._copy(o) for o in objs], '%s_lod2' % node)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(max(dissolve_deg, 8.0)), verts=bm.verts, edges=bm.edges,
                                     delimit={'MATERIAL'})
            bm.to_mesh(ob.data)
            bm.free()
            goal = max(budget, 0.05 * t0) if node == 'main' else sum(_tris(o) for o in objs) * rr
            if node != 'main' and _tris(ob) > goal * 1.5 and _slab_hull(ob):
                pass
            elif _tris(ob) > goal * 1.08:
                # 1) drop the smallest loose pieces first (collapse would crush small closed boxes to nothing)
                _cull_islands(ob, goal * 2.5, 1e9 if node == 'main' else 0.5)
                # 2) one moderate collapse of what is left (big surfaces: roofs, walls, mounds)
                cur = _tris(ob)
                if cur > goal * 1.08:
                    m = ob.modifiers.new('dec', 'DECIMATE')
                    m.ratio = max(0.3, goal / cur)
                    m.use_collapse_triangulate = True
                    m.delimit = {'MATERIAL'}
                    KE._select([ob])
                    bpy.ops.object.modifier_apply(modifier='dec')
                # 3) final trim, smallest pieces first, down to the goal
                if _tris(ob) > goal * 1.1:
                    _cull_islands(ob, goal, 1e9 if node == 'main' else 0.5)
            K.log('lod2 %s: %d tris (goal %d)' % (node, _tris(ob), goal))
            if node != 'main':
                budget -= _tris(ob)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
            bm.to_mesh(ob.data)
            bm.free()
            piv = objs[0].get('kit_pivot')
            if piv:
                d = V(piv)
                ob.data.transform(Matrix.Translation(-d))
                ob.location = d
            out.append(ob)
        return out
    KE.build_lod = build_lod
    KE._mil_lod = True


_patch_lod()


def camo_net(x0, y0, x1, y1, support, cell=0.3, holes=0.12, drop=None, tint=(0.62, 0.66, 0.46), name='camo_net', sag=0.18,
             poles=None, garnish=0.45):
    """Garnished camouflage net (rework 2). The net hangs from pole tops [(x, y, z_top)] with catenary-like sag
    between them (z = max(surface + 8 cm, pole_top - 0.42 d^1.15)), rests on `support(x, y)` elsewhere, edges pegged
    down to drop(x, y). Garnish: on ~55 % of the cells a tuft of 2-3 crossed scrim strips (hessian, three dye lots:
    green / brown / sand) standing 12-25 cm proud of the mesh -> real volume and broken silhouette from above."""
    from mathutils import noise
    r = K.rng()
    poles = poles or []
    nx, ny = max(2, int((x1 - x0) / cell)), max(2, int((y1 - y0) / cell))

    def zf(x, y):
        z = support(x, y) + 0.08
        for px, py, pz in poles:
            d = math.hypot(x - px, y - py)
            z = max(z, pz - 0.42 * d ** 1.15)
        return z - sag * 0.4 * (0.5 + 0.5 * noise.noise(V((x * 0.7, y * 0.7, 3.1))))
    bm = bmesh.new()
    g = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x, y = x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny
            edge = min(i, nx - i, j, ny - j)
            z = zf(x, y)
            if edge == 0:
                z = drop(x, y) if drop else 0.05
            elif edge == 1:
                z = (z + (drop(x, y) if drop else 0.05)) / 2 + 0.1
            row.append(bm.verts.new((x + r.uniform(-0.06, 0.06), y + r.uniform(-0.06, 0.06), z + r.uniform(-0.03, 0.03))))
        g.append(row)
    cells = []
    for j in range(ny):
        for i in range(nx):
            n = noise.noise(V((i * 0.45, j * 0.45, 7.7)))
            if r.random() < holes * 0.2 * (1.6 if n > 0.3 else 0.3):     # R4: alpha netting; only rare tears
                continue
            f = bm.faces.new((g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            cells.append(f)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    tufts = [bmesh.new() for _ in range(3)]
    for f in cells:
        if r.random() > garnish:
            continue
        c = f.calc_center_median()
        nrm = f.normal.copy()
        tb = tufts[r.randint(0, 2)]
        for k in range(r.randint(2, 3)):
            a = r.uniform(0, math.pi)
            u = V((math.cos(a), math.sin(a), 0)) * r.uniform(0.2, 0.34)
            hgt = nrm * r.uniform(0.12, 0.25) + V((r.uniform(-0.06, 0.06), r.uniform(-0.06, 0.06), 0))
            q = [c - u, c + u, c + u * 0.6 + hgt, c - u * 0.6 + hgt]
            vs = [tb.verts.new(p) for p in q]
            tb.faces.new(vs)                                          # R4: double-sided alpha material
    # R4: alpha-tested garnished netting (twine mesh + scrim, cut-out holes) instead of an opaque hessian sheet;
    # callers' tints were for plain hessian -> map relative to the temperate default (texture is already coloured).
    base = (0.56, 0.6, 0.42)
    nt = tuple(min(1.0, a / b) for a, b in zip(tint, base)) if tint else None
    nt = None if nt and min(nt) > 0.97 else nt
    net = K.part(bm, 'camo_netting', name=name, mat_tint=nt, grime=0.15, smooth=True, bisect=False)
    for k, tb in enumerate(tufts):
        if not len(tb.faces):
            continue
        tt = [(0.86, 0.92, 0.8), (0.95, 0.82, 0.66), (1.06, 1.02, 0.86)][k]
        K.part(tb, 'camo_netting', name=name + '_garnish', mat_tint=tuple(min(1.0, a * b) for a, b in zip(nt or (1, 1, 1), tt)), grime=0.1,
               bisect=False, uv_scale=0.5, lod='drop')
    if poles:
        pb = bmesh.new()
        for px, py, pz in poles:
            K.cyl_bm(pb, (px, py, support(px, py) - 0.05), (px, py, pz - 0.02), 0.035, 5)
            K.cyl_bm(pb, (px, py, pz - 0.03), (px, py, pz + 0.02), 0.09, 6, r1=0.03)       # spreader board / crown
        K.part(pb, 'timber_grey', name=name + '_poles', bisect=False)
    return net


# ------------------------------------------------------------------ kit extension (local): pointed (Gothic) arches
# Frame(shape='pointed'): two-centred arch, default rise 0.8 w (lancet-ish); outline() used by cutters/frames/glass.
def _patch_pointed():
    import kit_arch as KA
    F = KA.Frame
    if getattr(F, '_mil_pointed', False):
        return
    oi, oo = F.__init__, F.outline

    def __init__(s, o, n, r, w, h, depth, shape='rect', kind='window', rise=None):
        oi(s, o, n, r, w, h, depth, shape, kind, rise)
        if shape == 'pointed' and rise is None:
            s.rise = w * 0.8

    def outline(s, n_arc=10, inset=0.0):
        if s.shape != 'pointed':
            return oo(s, n_arc, inset)
        w2 = s.w / 2 - inset
        rs = max(1e-3, s.rise - inset)
        spring = s.h - s.rise
        c = (w2 * w2 - rs * rs) / (2 * w2)
        R = w2 - c
        a1 = math.atan2(rs, -c)
        m = max(3, n_arc // 2)
        right = [(c + R * math.cos(a1 * i / m), spring + R * math.sin(a1 * i / m)) for i in range(m + 1)]
        left = [(-x, z) for x, z in reversed(right)][1:]
        return [(-w2, inset), (w2, inset)] + right + left

    F.__init__, F.outline = __init__, outline
    F._mil_pointed = True


_patch_pointed()


# ------------------------------------------------------------------ kit fix (local): tints > 1.0
# kit_core.mat() encodes tints as ~rrggbb with int(c*255); a component > 1.0 gives 3 hex digits, glb_post then misreads
# the colour (the "teal plastic" desert sandbags). Clamp every tint component to 1.0 (brighten via the texture instead).
def _patch_tint():
    import kit_core as C
    if getattr(C, '_mil_tint', False):
        return
    orig = C.mat

    def mat(mid, tint=None):
        if tint is not None:
            tint = tuple(min(1.0, max(0.0, float(c))) for c in tint)
        return orig(mid, tint)
    C.mat = mat
    K.mat = mat
    C._mil_tint = True


_patch_tint()


SEG7 = {'0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'}


def digit(bm, ch, c, h, right=(1, 0, 0), normal=(0, -1, 0), t=0.03):
    """Stencil-style 7-segment digit of height h centred at c on a face (right = along the face, normal = outward)."""
    c, rt, nm = V(c), V(right).normalized(), V(normal).normalized()
    w, tk = h * 0.55, h * 0.14
    segs = {'a': (0, h / 2 - tk / 2, w, tk), 'g': (0, 0, w, tk), 'd': (0, -h / 2 + tk / 2, w, tk),
            'b': (w / 2 - tk / 2, h / 4, tk, h / 2), 'c': (w / 2 - tk / 2, -h / 4, tk, h / 2),
            'e': (-w / 2 + tk / 2, -h / 4, tk, h / 2), 'f': (-w / 2 + tk / 2, h / 4, tk, h / 2)}
    ang = math.atan2(rt.y, rt.x)
    for sg in SEG7[ch]:
        dx, dz, sw, sh = segs[sg]
        K.box_bm(bm, tuple(c + rt * dx + V((0, 0, dz)) + nm * t / 2), (sw, t, sh), ang)


def cyl_uv_smooth(bm, mid, sharp_deg=35.0, scale=1.0):
    """Continuous cylindrical UVs around the Z axis (u = arc length, v = z; no per-facet seams) + sharp edges only
    where faces meet at > sharp_deg (so a smooth-shaded tower keeps crisp window reveals)."""
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    t = K.MATS[mid]['tile_m'] * scale
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        ac = math.atan2(c.y, c.x)
        rr = max(0.3, math.hypot(c.x, c.y))
        for l in f.loops:
            p = l.vert.co
            a = math.atan2(p.y, p.x)
            da = (a - ac + math.pi) % (2 * math.pi) - math.pi
            if abs(f.normal.z) > 0.9:
                l[lay].uv = (p.x / t, p.y / t)
            else:
                l[lay].uv = ((ac + da) * rr / t, p.z / t)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_deg):
            e.smooth = False


# ------------------------------------------------------------------ rework 2: stepped masonry breach
def notch_cut(cx, y0, y1, z_bot, z_top, w_bot, w_top, step=0.55, jag=0.35, parts=None, keep=()):
    """Masonry breach: a STEPPED V-notch (breaks follow the courses: vertical + horizontal faces only, so the
    re-projected masonry UVs never stretch). Profile in XZ (centre cx, half-width w_bot at z_bot growing to w_top at
    z_top, steps of `step` m with +-jag random widths), extruded from y0 to y1 and subtracted from every intersecting
    part. Everything above the notch inside its width is removed (no floating crowns / merlons). Thin card parts
    (interior_dark, decals, glass) just lose the faces whose centre lies inside the notch. Returns inside(p)."""
    import bpy
    r = K.rng()
    zs = []
    z = z_bot
    while z < z_top:
        zs.append(z)
        z += step * r.uniform(0.7, 1.3)
    wl = [w_bot + (w_top - w_bot) * (z - z_bot) / (z_top - z_bot) + r.uniform(-jag, jag) for z in zs]
    wr = [w_bot + (w_top - w_bot) * (z - z_bot) / (z_top - z_bot) + r.uniform(-jag, jag) for z in zs]
    ztop = z_top + 6.0
    left = [(cx - wl[0], zs[0])]
    for k in range(1, len(zs)):
        left += [(cx - wl[k - 1], zs[k]), (cx - wl[k], zs[k])]
    left.append((cx - wl[-1], ztop))
    right = [(cx + wr[0], zs[0])]
    for k in range(1, len(zs)):
        right += [(cx + wr[k - 1], zs[k]), (cx + wr[k], zs[k])]
    right.append((cx + wr[-1], ztop))
    prof = list(reversed(left)) + right                    # clockwise in XZ from top-left down and up to top-right
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in prof]
    b = [bm.verts.new((x, y1, z)) for x, z in prof]
    n = len(prof)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    def inside(p):
        if not (min(y0, y1) <= p[1] <= max(y0, y1)) or p[2] < z_bot:
            return False
        k = max(0, min(len(zs) - 1, sum(1 for z in zs if z <= p[2]) - 1))
        return cx - wl[k] < p[0] < cx + wr[k]
    for o in list(parts or K.A().parts):
        if o.name not in bpy.data.objects or o in keep:
            continue
        bb = [o.matrix_world @ V(c) for c in o.bound_box]
        mn = V([min(p[i] for p in bb) for i in range(3)])
        mx = V([max(p[i] for p in bb) for i in range(3)])
        if mx.z < z_bot or mn.x > cx + max(wr) + 0.5 or mx.x < cx - max(wl) - 0.5 or mx.y < min(y0, y1) or mn.y > max(y0, y1):
            continue
        kid = o.data.materials[0].get('kit_id') if o.data.materials else ''
        thin = kid in ('interior_dark', 'decals', 'glass_dirty', 'curtain') or min(mx - mn) < 0.03
        if thin:
            obm = bmesh.new()
            obm.from_mesh(o.data)
            dead = [f for f in obm.faces if inside(o.matrix_world @ f.calc_center_median())]
            if dead:
                bmesh.ops.delete(obm, geom=dead, context='FACES')
                obm.to_mesh(o.data)
            obm.free()
            continue
        if all(inside(o.matrix_world @ V(c)) for c in o.bound_box):
            K.A().parts.remove(o)
            bpy.data.objects.remove(o)
            continue
        c = bm.copy()
        K.cut_object(o, c)
    bm.free()
    return inside


def notch_debris(cx, y, z_bot, w, n=10, mid='fieldstone_grey', dress='ashlar', tint=(0.84, 0.84, 0.82), name='breach_blocks'):
    """Loose squared blocks hanging on the steps of a breach (a few, partly projecting) - reads as broken courses."""
    r = K.rng()
    bm = bmesh.new()
    for i in range(n):
        x = cx + r.uniform(-w, w)
        K.box_bm(bm, (x, y + r.uniform(-0.6, 0.6), z_bot + r.uniform(0, 0.3)), (r.uniform(0.3, 0.6), r.uniform(0.25, 0.45), r.uniform(0.2, 0.3)), r.uniform(-0.4, 0.4))
    K.part(bm, dress, name=name, mat_tint=tint)


# ------------------------------------------------------------------ kit fix (local, rework 2): robust boolean cuts
# Parts are built from overlapping boxes (merlons on a breastwork, stacked buttress stages): EXACT without self-
# intersection handling returns garbage (breastwork deleted, merlons floating, cutter-shaped blobs). Use use_self +
# hole_tolerant; if a cut still destroys the part (< 25 % of its faces left), fall back to deleting faces inside.
def _patch_cut():
    import bpy
    import kit_arch as KA
    if getattr(KA, '_mil_cut', False):
        return

    def cut_object(ob, cutter_bm):
        if ob.name.startswith(('wire', 'guy_ropes', 'roofdmg', 'camo_net', 'charred_rafters')):   # thin lines: never cut
            return
        n0 = len(ob.data.polygons)
        keep = ob.data.copy()
        cme = bpy.data.meshes.new('tmp_cut')
        cb = cutter_bm.copy()
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        cb.to_mesh(cme)
        inside_test = cb.copy()
        cb.free()
        cob = bpy.data.objects.new('tmp_cut', cme)
        bpy.context.scene.collection.objects.link(cob)
        m = ob.modifiers.new('cut', 'BOOLEAN')
        m.operation, m.solver, m.object = 'DIFFERENCE', 'EXACT', cob
        m.use_self, m.use_hole_tolerant = True, True
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier='cut')
        bpy.data.objects.remove(cob)
        bpy.data.meshes.remove(cme)
        if len(ob.data.polygons) > 2.5 * n0 + 150:           # boolean blew up (wire coils, rafters): keep the original
            K.log('cut exploded, kept original', ob.name, n0, len(ob.data.polygons))
            old = ob.data
            ob.data = keep
            bpy.data.meshes.remove(old)
            inside_test.free()
            return
        if n0 > 12 and len(ob.data.polygons) < 0.25 * n0:
            K.log('cut fallback (face delete)', ob.name, n0, len(ob.data.polygons))
            from mathutils.bvhtree import BVHTree
            tree = BVHTree.FromBMesh(inside_test)
            old = ob.data
            ob.data = keep
            bpy.data.meshes.remove(old)
            obm = bmesh.new()
            obm.from_mesh(ob.data)
            dead = []
            for f in obm.faces:
                p = ob.matrix_world @ f.calc_center_median()
                loc, nrm, idx, dist = tree.find_nearest(p)
                if loc is not None and (p - loc).dot(nrm) < 0:
                    dead.append(f)
            bmesh.ops.delete(obm, geom=dead, context='FACES')
            obm.to_mesh(ob.data)
            obm.free()
        else:
            bpy.data.meshes.remove(keep)
        inside_test.free()
    KA.cut_object = cut_object
    K.cut_object = cut_object
    KA._mil_cut = True


_patch_cut()


def wall_strip(bm, pts, h_of_s, t, side=1, z0=-0.08, step=0.25, ch=0.05):
    """Continuous wall of thickness t along a 2D polyline (face at pts, body offset to the LEFT (side=1) or RIGHT
    (side=-1) of the direction of travel), top height h_of_s(arc length), mitred corners, small top chamfer."""
    P = [V((p[0], p[1], 0)) for p in pts]
    S = [(P[0], 0.0, 0)]
    acc = 0.0
    for k, (a, b) in enumerate(zip(P[:-1], P[1:])):
        L = (b - a).length
        n = max(1, int(L / step))
        for i in range(1, n + 1):
            S.append((a + (b - a) * i / n, acc + L * i / n, k + (1 if i == n else 0)))
        acc += L
    def nrm(k):
        d = (P[min(k + 1, len(P) - 1)] - P[min(k, len(P) - 2)]).normalized()
        return V((-d.y, d.x, 0)) * side
    rows = []
    for p, s_, k in S:
        segs = [k - 1, k] if (0 < k < len(P) - 1 and any((p - q).length < 1e-6 for q in P[1:-1])) else [min(k, len(P) - 2)]
        ns = [nrm(max(0, g)) for g in segs]
        m = (ns[0] + ns[-1]).normalized()
        o = m * t / max(0.4, m.dot(ns[0]))
        h = h_of_s(s_)
        c = o.normalized() * ch
        rows.append([bm.verts.new((p.x, p.y, z0)), bm.verts.new((p.x, p.y, h - ch)), bm.verts.new((p.x + c.x, p.y + c.y, h)),
                     bm.verts.new((p.x + o.x - c.x, p.y + o.y - c.y, h)), bm.verts.new((p.x + o.x, p.y + o.y, h - ch)),
                     bm.verts.new((p.x + o.x, p.y + o.y, z0))])
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(6):
            bm.faces.new((a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def berm_outline(poly, dist=3.4, side=1, step=1.6, fan=3, var=0.22, end_sweep=0.35, seed=4.2):
    """Inner/outer polylines for berm(): inner follows `poly` (wall foot), outer is offset outward (right-hand side of
    travel for side=1) by dist * (1 +- var noise), with FANNED rounded corners and ends swept round towards the wall
    -> an irregular, rounded toe line instead of a rectangle."""
    from mathutils import noise as NZ
    P = [V((p[0], p[1], 0)) for p in poly]
    nr = lambda a, b: V(((b - a).y, -(b - a).x, 0)).normalized() * side
    D = lambda p: dist * (1 + var * NZ.noise(V((p.x * 0.3, p.y * 0.3, seed))))
    inner, outer = [], []
    for k in range(len(P) - 1):
        a, b = P[k], P[k + 1]
        n = nr(a, b)
        m = max(1, int((b - a).length / step))
        for i in range(m + (1 if k == len(P) - 2 else 0)):
            t = i / m
            p = a + (b - a) * t
            nn = n.copy()
            if k == 0 and i == 0:                      # start end swept back along the wall
                nn = (n - (b - a).normalized() * end_sweep).normalized()
            if k == len(P) - 2 and i == m:
                nn = (n + (b - a).normalized() * end_sweep).normalized()
            inner.append((p.x, p.y))
            q = p + nn * D(p)
            outer.append((q.x, q.y))
            if i == m and k < len(P) - 2:
                pass
        if k < len(P) - 2:                             # corner fan at P[k+1]
            n2 = nr(P[k + 1], P[k + 2])
            for j in range(1, fan + 1):
                nn = n.lerp(n2, j / (fan + 1)).normalized()
                inner.append((P[k + 1].x, P[k + 1].y))
                q = P[k + 1] + nn * D(P[k + 1]) * 1.06
                outer.append((q.x, q.y))
    return inner, outer
