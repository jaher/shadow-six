"""Bridges-group helpers on top of the SHADOW SIX kit: water-obstacle metadata (pier footprints for flow foam),
animated sub-nodes, blown-span damage, riprap, scuppers, pattress plates, river stairs, gauge boards.
Convention (kit): road along X, river flows along Y (upstream = -Y by default), banks z=0, water negative."""
import sys, os, math
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/blender')
import bpy, bmesh
from mathutils import Vector as V
import kit as K
import kit_core as C
from kit_core import part, box_bm, beam_bm, cyl_bm, rng

OUTROOT = '<claude-tmp>'


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return a


def bmeta():
    if not C.A.meta.get('bridge'):
        C.A.meta['bridge'] = {}
    return C.A.meta['bridge']


def water_obstacle(poly, kind='pier', foam=1.0, block='HIGH'):
    """Register a pier/abutment outline AT THE WATERLINE (Blender XY) for the water system (flow foam, wakes)
    and as a nav footprint. foam = relative foam strength (cutwater noses split flow -> less)."""
    C.A.meta.setdefault('water_obstacles', []).append({'kind': kind, 'points': [C.g2(p) for p in poly],
                                                       'foam': foam, 'water_level': C.A.water})
    if block:
        C.footprint(poly, block, kind)


def pier_outline(x, pier_w, width, nose=None, upstream=-1, round_down=True, n=6):
    """Plan outline of a pier with pointed upstream cutwater and rounded downstream one."""
    nose = nose or pier_w * 0.9
    h = pier_w / 2
    yu = upstream * width / 2
    pts = [(x - h, yu), (x, yu + upstream * nose), (x + h, yu)]
    yd = -yu
    if round_down:
        pts += [(x + h * math.cos(math.pi * i / n), yd - upstream * h * math.sin(math.pi * i / n)) for i in range(n + 1)]
    else:
        pts += [(x + h, yd), (x - h, yd)]
    return C.ccw(pts)


def set_pivot(objs, pivot):
    for o in objs:
        o['kit_pivot'] = list(pivot)


def nodes_since(n0):
    return C.A.parts[n0:]


def mark_node(objs, node, pivot=None):
    """Move already-built parts into a separate glTF node (animated leaf, gate, lever) pivoted at `pivot`."""
    for o in objs:
        o['kit_node'] = node
        if not o.name.startswith('p_'):
            o.name = 'p_' + o.name          # keep the joined node name free (no '.001' suffix in the GLB)
        if pivot is not None:
            o['kit_pivot'] = list(pivot)


def riprap(xc, yc, rx, ry, z, n=30, smin=0.25, smax=0.6, mid='granite', name='riprap', tint=None):
    """Scatter of boulders around a pier base / bank toe at the waterline (breaks the water/stone seam)."""
    import kit_weather as W
    r = rng()
    bm = bmesh.new()
    for i in range(n):
        a = r.uniform(0, 2 * math.pi)
        d = math.sqrt(r.uniform(0.35, 1.0))
        p = V((xc + math.cos(a) * rx * d, yc + math.sin(a) * ry * d, z + r.uniform(-0.25, 0.05)))
        s = r.uniform(smin, smax)
        cb = W._blob_bm(p, s, r.random() * 10, (1, r.uniform(0.6, 1), r.uniform(0.45, 0.7)), 1, 0.3)
        tmp = bpy.data.meshes.new('rr')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return part(bm, mid, name=name, grime=0.8, tint=tint)


def scuppers(deck, y_face, xs, dz=-0.3, mid='cast_iron', streaks=True):
    """Small cast-iron drain spouts projecting from the face under the parapet, with a rust/lime streak below."""
    import kit_weather as W
    s = 1 if y_face > 0 else -1
    bm = bmesh.new()
    for x in xs:
        z = deck.z(x) + dz
        cyl_bm(bm, (x, y_face - s * 0.05, z), (x, y_face + s * 0.28, z - 0.04), 0.06, 6)
        if streaks:
            W.decal('streak_long', (x, y_face + s * 0.004, z - 1.1), (0, s, 0), 0.7, 2.0, alpha=0.55)
    part(bm, mid, name='scuppers_%d' % s, grime=0.5, bisect=False)


def pattress(x, y_face, z, kind='x', mid='cast_iron'):
    """Tie-rod anchor plate (pattress) on a spandrel face: X or round plate + nut."""
    s = 1 if y_face > 0 else -1
    bm = bmesh.new()
    if kind == 'x':
        for a in (45, -45):
            c, sn = math.cos(math.radians(a)), math.sin(math.radians(a))
            beam_bm(bm, (x - 0.35 * c, y_face + s * 0.02, z - 0.35 * sn), (x + 0.35 * c, y_face + s * 0.02, z + 0.35 * sn), 0.08, 0.035, up=(0, s, 0))
    else:
        cyl_bm(bm, (x, y_face - s * 0.01, z), (x, y_face + s * 0.035, z), 0.26, 10)
    cyl_bm(bm, (x, y_face, z), (x, y_face + s * 0.09, z), 0.045, 6)
    part(bm, mid, name='pattress', grime=0.4, bisect=False)
    import kit_weather as W
    W.decal('streak_rust', (x, y_face + s * 0.004, z - 0.55), (0, s, 0), 0.35, 0.9, alpha=0.6)


def gauge_board(x, y, z_water, face=(0, -1, 0), h=3.0, name='gauge'):
    """Painted river-level gauge board fixed to a pier face (white board with black/red bands)."""
    n = V(face).normalized()
    bm = bmesh.new()
    box_bm(bm, (x + n.x * 0.03, y + n.y * 0.03, z_water - 0.6 + h / 2), (0.22 if abs(n.y) > 0.5 else 0.05, 0.05 if abs(n.y) > 0.5 else 0.22, h))
    part(bm, 'wood_paint', name=name, tint=(0.95, 0.95, 0.92), grime=0.6, bisect=True)
    bm = bmesh.new()
    for k in range(int(h / 0.2)):
        if k % 2:
            continue
        zz = z_water - 0.6 + k * 0.2 + 0.05
        box_bm(bm, (x + n.x * 0.058, y + n.y * 0.058, zz + 0.05), (0.14 if abs(n.y) > 0.5 else 0.01, 0.01 if abs(n.y) > 0.5 else 0.14, 0.1))
    part(bm, 'wood_paint', name=name + '_marks', tint=(0.08, 0.08, 0.08), mat_tint=(0.12, 0.12, 0.12), grime=0.2, bisect=False)


def river_stairs(x_face, side, y0, y1, z_top, z_bot, width=1.1, mid='ashlar', rail=True):
    """Stone steps descending along a wing/abutment face (x_face) from the bank (z_top at y0) to a landing just
    above the water (z_bot at y1): cantilevered treads + iron handrail. Registers a ladder-like link for pathing."""
    n = max(3, int(abs(z_top - z_bot) / 0.2))
    bm = bmesh.new()
    xo = x_face - side * width / 2
    for i in range(n):
        t = i / n
        y = y0 + (y1 - y0) * (i + 0.5) / n
        z = z_top + (z_bot - z_top) * (i + 1) / n
        box_bm(bm, (xo, y, z - 0.1), (width, abs(y1 - y0) / n + 0.04, 0.2 + 0.02 * (i % 2)))
    ydir = 1 if y1 > y0 else -1
    box_bm(bm, (xo, y1 + ydir * 0.7, z_bot - 0.12), (width, 1.4, 0.24))            # landing
    # solid support under the steps (reads as masonry, stops floating treads)
    sup = [(y0, z_top - 0.2), (y1 + ydir * 1.4, z_bot - 0.24), (y1 + ydir * 1.4, z_bot - 1.2), (y0, z_bot - 1.2)]
    a = [bm.verts.new((xo - side * width / 2 + side * 0.02, y, z)) for y, z in sup]
    b = [bm.verts.new((xo + side * width / 2 - side * 0.02, y, z)) for y, z in sup]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((a[j], a[i], b[i], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, mid, name='river_stairs')
    if rail:
        from kit_detail import railing
        xr = xo - side * (width / 2 - 0.08)
        railing((xr, y0, z_top), (xr, y1, z_bot), 0.95, 'pipe', name='stair_rail')
    C.ladder_meta((xo, y1 + ydir * 0.7, z_bot), (xo, y0 - ydir * 0.3, z_top), z_top)


# ------------------------------------------------------------------ riveted through truss (Pratt / Parker)
def truss_span(x0, x1, z_deck, h_end=5.0, h_mid=None, width=7.4, panels=8, mid='steel_painted', rivets=True,
               portal=True, sign=None, name='truss', i_range=None, grid=(3, 3), tint=None):
    """Riveted through-truss span (bearings x0/x1). Parker polygonal top chord when h_mid > h_end.
    Box-section chords with cover plates, I-section verticals, doubled flat eye-bar diagonals (Pratt: slope toward
    the centre), gusset plates + rivet grids, floor beams, stringers, top lateral X-bracing, portal frames with
    knee braces. i_range=(a, b) builds only panels a..b-1 (for a broken/collapsed span). Returns list of parts."""
    from kit_bridge import ibeam_bm, gusset_bm
    h_mid = h_mid or h_end
    zb = z_deck - 0.45
    L = x1 - x0
    px = [x0 + L * i / panels for i in range(panels + 1)]
    ht = [h_end + (h_mid - h_end) * math.sin(math.pi * i / panels) for i in range(panels + 1)]
    ia, ib = i_range or (0, panels)
    n0 = len(C.A.parts)
    bm, rv = bmesh.new(), bmesh.new()
    top = lambda i, y: V((px[i], y, zb + ht[i]))
    bot = lambda i, y: V((px[i], y, zb))
    for s in (-1, 1):
        y = s * width / 2
        for i in range(ia, ib):
            beam_bm(bm, bot(i, y) + V((0.02, 0, 0)), bot(i + 1, y) - V((0.02, 0, 0)), 0.42, 0.5)            # bottom chord
            beam_bm(bm, bot(i, y) + V((0, 0, 0.27)), bot(i + 1, y) + V((0, 0, 0.27)), 0.5, 0.04)          # cover plate
            if 1 <= i < panels - 1:
                beam_bm(bm, top(i, y), top(i + 1, y), 0.5, 0.48)                                        # top chord
                beam_bm(bm, top(i, y) + V((0, 0, 0.26)), top(i + 1, y) + V((0, 0, 0.26)), 0.6, 0.035)
            if i == 0:
                beam_bm(bm, bot(0, y), top(1, y), 0.5, 0.5)                                             # end posts
            if i == panels - 1:
                beam_bm(bm, bot(panels, y), top(panels - 1, y), 0.5, 0.5)
            for j in (i, i + 1):
                if 1 <= j <= panels - 1 and (j > ia or i == ia) and not (j == i + 1 and j < ib and False):
                    pass
            if 1 <= i <= panels - 1:
                ibeam_bm(bm, bot(i, y) + V((0, 0, 0.25)), top(i, y) - V((0, 0, 0.25)), 0.34, 0.26, up=(1, 0, 0))  # vertical
            left = i < panels / 2
            if 1 <= i < panels - 1 or (i in (0, panels - 1) and False):
                a, b = (top(i, y), bot(i + 1, y)) if left else (top(i + 1, y), bot(i, y))
                for dy in (-0.13, 0.13):
                    beam_bm(bm, a + V((0, dy, -0.2)), b + V((0, dy, 0.22)), 0.035, 0.24, up=(0, 1, 0))       # eye-bars
                if i in (panels // 2 - 1, panels // 2):                                                  # counters
                    a2, b2 = (top(i + 1, y), bot(i, y)) if left else (top(i, y), bot(i + 1, y))
                    beam_bm(bm, a2 + V((0, 0, -0.2)), b2 + V((0, 0, 0.2)), 0.05, 0.05)
        nodes = [bot(i, y) for i in range(ia, ib + 1)] + [top(i, y) for i in range(max(1, ia), min(panels - 1, ib) + 1)]
        for p in nodes:
            gusset_bm(bm, p + V((0, s * 0.23, 0)), (0, s, 0), 0.9, 0.8, rivets=rv if rivets else None, grid=grid)
    ob = part(bm, mid, name=name + '_members', uv='beam', axis=(1, 0, 0), grime=0.6, tint=tint, bisect=False)
    if rivets:
        part(rv, mid, name=name + '_rivets', grime=0.4, bisect=False, tint=tint)
    bm = bmesh.new()                                         # floor system + cantilever brackets
    for i in range(ia, ib + 1):
        ibeam_bm(bm, (px[i], -width / 2 - 1.5, zb + 0.05), (px[i], width / 2 + 1.5, zb + 0.05), 0.55, 0.26)
        for s in (-1, 1):
            beam_bm(bm, (px[i], s * (width / 2 + 0.2), zb - 0.45), (px[i], s * (width / 2 + 1.55), zb + 0.2), 0.12, 0.12)
    xa, xb2 = px[ia], px[ib]
    for yy in (-2.2, -0.75, 0.75, 2.2):
        ibeam_bm(bm, (xa, yy, zb + 0.43), (xb2, yy, zb + 0.43), 0.28, 0.16)
    for s in (-1, 1):
        ibeam_bm(bm, (xa, s * (width / 2 + 1.5), zb + 0.2), (xb2, s * (width / 2 + 1.5), zb + 0.2), 0.3, 0.15)
    for i in range(max(1, ia), min(panels - 1, ib) + 1):             # top struts + lateral X bracing
        ibeam_bm(bm, top(i, -width / 2) + V((0, 0.25, 0)), top(i, width / 2) - V((0, 0.25, 0)), 0.3, 0.2)
        if i < min(panels - 1, ib):
            for s in (-1, 1):
                beam_bm(bm, top(i, s * width / 2) + V((0, -s * 0.25, 0.05)), top(i + 1, -s * width / 2) + V((0, s * 0.25, 0.05)), 0.12, 0.09)
    if portal:
        for i, e in ((1, 0), (panels - 1, panels)):
            if not (ia <= i <= ib):
                continue
            mid_top = top(i, 0)
            zz = mid_top.z - 0.35
            xx = (px[i] * 0.8 + px[e] * 0.2)
            dz_ = (mid_top.z - zb) * 0.2
            bm2 = bm
            ibeam_bm(bm2, (xx, -width / 2 + 0.25, zz - dz_ - 0.55), (xx, width / 2 - 0.25, zz - dz_ - 0.55), 0.5, 0.2)
            for s in (-1, 1):
                beam_bm(bm2, (xx, s * (width / 2 - 0.25), zz - dz_ - 1.6), (xx, s * (width / 2 - 1.3), zz - dz_ - 0.6), 0.1, 0.14)
            if sign:
                K.sign((xx - (0.3 if e == 0 else -0.3), 0, zz - dz_ - 0.15), (-1 if e == 0 else 1, 0, 0), 1.4, sign, 'steel_painted')
    part(bm, mid, name=name + '_floor', uv='beam', axis=(0, 1, 0), grime=0.7, tint=tint, bisect=False)
    return C.A.parts[n0:], {'zb': zb, 'px': px, 'ht': ht}


def slab_road(x0, x1, z, width, mid='cobblestone', kerb='granite', walk=None, walk_w=1.4, walk_mid='deck_planks', name='road'):
    """Flat road slab (cheap): surface + kerbs; optional cantilevered footways at +-walk (y of footway centre)."""
    bm = bmesh.new()
    box_bm(bm, ((x0 + x1) / 2, 0, z - 0.1), (x1 - x0, width, 0.2))
    part(bm, mid, name=name, grime=0.4, bisect=False, lod='keep')
    bm = bmesh.new()
    for s in (-1, 1):
        n = max(2, int((x1 - x0) / 3.0))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n + 0.006, x0 + (x1 - x0) * (i + 1) / n - 0.006
            box_bm(bm, ((xa + xb) / 2, s * (width / 2 - 0.15), z + 0.04), (xb - xa, 0.3, 0.2))
    part(bm, kerb, name=name + '_kerbs', bisect=False)
    if walk:
        bm = bmesh.new()
        for s in (-1, 1):
            box_bm(bm, ((x0 + x1) / 2, s * walk, z + 0.05), (x1 - x0, walk_w, 0.1))
        part(bm, walk_mid, name=name + '_walks', uv='beam', axis=(0, 1, 0), grime=0.5, bisect=False, lod='keep')


def iron_ladder(x, y, z0, z1, normal=(0, -1, 0), w=0.5, mid='cast_iron', name='iron_ladder', meta=True, top_pos=None):
    """Iron rung ladder fixed to a vertical face (x, y on the face), stand-off brackets, hoop-free (period)."""
    n = V(normal).normalized()
    t = V((-n.y, n.x, 0))
    b = V((x, y, 0)) + n * 0.16
    bm = bmesh.new()
    for s in (-1, 1):
        beam_bm(bm, b + t * s * w / 2 + V((0, 0, z0)), b + t * s * w / 2 + V((0, 0, z1 + 0.9)), 0.06, 0.02, up=tuple(n))
        for zz in (z0 + 0.4, (z0 + z1) / 2, z1 - 0.3):
            beam_bm(bm, b - n * 0.16 + t * s * w / 2 + V((0, 0, zz)), b + t * s * w / 2 + V((0, 0, zz)), 0.04, 0.04)
    k = int((z1 - z0) / 0.3)
    for i in range(1, k + 1):
        z = z0 + i * 0.3
        cyl_bm(bm, b - t * w / 2 + V((0, 0, z)), b + t * w / 2 + V((0, 0, z)), 0.014, 4, caps=False)
    part(bm, mid, name=name, grime=0.5, bisect=False)
    import kit_weather as W
    W.decal('streak_rust', tuple(V((x, y, (z0 + z1) / 2)) + n * 0.005), tuple(n), w + 0.3, (z1 - z0) * 0.8, alpha=0.5)
    if meta:
        C.ladder_meta(tuple(b + n * 0.4 + V((0, 0, z0))), tuple(top_pos or (b - n * 0.6 + V((0, 0, z1)))), z1)


def control_shack(cx, cy, w=3.2, d=2.6, h=2.7, mid='concrete_board', did='shack', door_edge=0, z0=0.0,
                  roof='concrete_bunker', door_color='green', stovepipe=True):
    """Small operator's / control shack built with the kit (true openings, door node, windows with bars,
    flat roof with parapet + spout, stove pipe). Edge 0 = -Y face, 1 = +X, 2 = +Y, 3 = -X."""
    import kit_arch as KA
    from kit_roof import roof_flat
    poly = [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]
    L = [w, d, w, d]
    fr = []
    dr = KA.opening(poly, door_edge, L[door_edge] * 0.3, 0.9, 2.05, 0.0, 0.3, 'rect', 'door')
    fr.append(dr)
    wins = []
    for e in range(4):
        if e == door_edge:
            wins.append(KA.opening(poly, e, L[e] * 0.72, 0.8, 0.9, 1.0, 0.3))
        elif e % 2 != door_edge % 2:
            wins.append(KA.opening(poly, e, L[e] * 0.5, 0.9, 0.9, 1.0, 0.3))
    KA.wall_ring(poly, h, 0.3, mid, fr + wins, z0=z0, plinth=('concrete_bunker', 0.3, 0.03))
    for f in wins:
        KA.window(f, 'casement', (2, 2), frame=(0.25, 0.3, 0.25), sill='concrete_bunker', lintel='concrete_bunker', bars=True, curtain=0.0)
    KA.door(dr, did, 'plank', door_color, step='concrete_bunker')
    roof_flat(poly, z0 + h, roof, parapet_h=0.25, parapet_t=0.2, coping='concrete_bunker', walkable=True, spouts=True)
    if stovepipe:
        bm = bmesh.new()
        cyl_bm(bm, (cx + w / 2 - 0.5, cy + d / 2 - 0.5, z0 + h), (cx + w / 2 - 0.5, cy + d / 2 - 0.5, z0 + h + 1.1), 0.08, 8)
        cyl_bm(bm, (cx + w / 2 - 0.5, cy + d / 2 - 0.5, z0 + h + 1.1), (cx + w / 2 - 0.5, cy + d / 2 - 0.5, z0 + h + 1.2), 0.15, 8, r1=0.02)
        part(bm, 'steel_galv', name='stovepipe', grime=0.8, bisect=False)
        C.anchor('smoke', (cx + w / 2 - 0.5, cy + d / 2 - 0.5, z0 + h + 1.2), kind='stove')
    return poly


def rail_simple(p0, p1, h=1.05, spacing=2.4, mid='steel_painted', tint=None, name='rail', mid_rail=True, post=0.07):
    """Cheap iron railing: square posts, flat top rail, mid rail (box sections, ~12 tris each)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    n = max(1, int(round(d.length / spacing)))
    bm = bmesh.new()
    for i in range(n + 1):
        c = p0.lerp(p1, i / n)
        box_bm(bm, tuple(c + V((0, 0, h / 2))), (post, post, h), math.atan2(d.y, d.x))
    beam_bm(bm, p0 + V((0, 0, h)), p1 + V((0, 0, h)), 0.08, 0.05)
    if mid_rail:
        beam_bm(bm, p0 + V((0, 0, h * 0.5)), p1 + V((0, 0, h * 0.5)), 0.03, 0.05)
    return part(bm, mid, name=name, uv='beam', axis=tuple(d.normalized()), tint=tint, grime=0.5, bisect=False)


def prune_empty():
    """Drop parts left without faces (e.g. fully eaten by a bite())."""
    for o in list(C.A.parts):
        if o.name in bpy.data.objects and len(o.data.polygons) == 0:
            C.A.parts.remove(o)
            bpy.data.objects.remove(o)
