# ca_kit.py - commandos_a kit items (monkey-patched around pipeline kit.build_kit; pipeline files untouched)
# items: bandolier (Sniper), belt_pouch, knife_belt, mask_chest (Marine land), mask_face + rebreather + weight_belt (diver)
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo, kit
import materials as MT
from uniform import lin

_orig_build = kit.build_kit
mat = kit.mat


def _surface_top(K, garments):
    """wetsuit: hang kit on the suit, not on the body under it"""
    suit = [g for g in garments if g.get('garment') == 'fullsuit']
    if suit and K.top is K.ctx.human:
        K.top = suit[0]
        K.tree = geo.bvh_of([suit[0]]); K.torso_tree = K.tree
        band = [v.co for v in suit[0].data.vertices if abs(v.co.z - K.m['belt_z']) < 0.015 and abs(v.co.x) < 0.25]
        K.cy = sum(c.y for c in band) / max(1, len(band)) if band else K.cy


def bandolier(K, leather, brass, n_pockets=9):
    """leather cartridge bandolier over the LEFT shoulder to the RIGHT hip, with brass rounds in loops on the front."""
    m, ctx = K.m, K.ctx
    belt = m['belt_z']; chest = ctx.bone['spine_03'][0].z
    sh_z = max(v.co.z for v in K.top.data.vertices if abs(v.co.x) < 0.2)
    cy = K.cy
    front = [Vector((-0.15, cy - 0.5, belt + 0.02)), Vector((-0.08, cy - 0.5, belt + 0.15)), Vector((0.0, cy - 0.5, chest - 0.02)),
             Vector((0.07, cy - 0.5, chest + 0.09)), Vector((0.11, cy - 0.5, chest + 0.16))]
    top = [Vector((0.12, cy - 0.06, sh_z + 0.1)), Vector((0.12, cy, sh_z + 0.1)), Vector((0.12, cy + 0.06, sh_z + 0.1))]
    back = [Vector((0.10, cy + 0.5, chest + 0.12)), Vector((0.0, cy + 0.5, chest - 0.02)), Vector((-0.09, cy + 0.5, belt + 0.14)),
            Vector((-0.15, cy + 0.5, belt + 0.02))]
    pts = K._dense(front + top + back)
    bm = bmesh.new()
    geo.ribbon(bm, K.torso_tree, pts, 0.05, 0.007, 0.004, towards=lambda p: K._to_core(p))
    K.finish(bm, 'kit_bandolier', leather)
    # cartridge loops + rounds along the front run (sternum to the lower ribs)
    run = K._dense(front[1:4], step=0.01)
    L = [0.0]
    for a, b in zip(run, run[1:]):
        L.append(L[-1] + (b - a).length)
    bmL, bmB = bmesh.new(), bmesh.new()
    for k in range(n_pockets):
        s = L[-1] * (0.12 + 0.8 * k / (n_pockets - 1))
        i = next(j for j in range(len(L)) if L[j] >= s)
        p = run[i]; d = (run[min(i + 1, len(run) - 1)] - run[max(i - 1, 0)]).normalized()
        hit, n = geo.project(K.torso_tree, p, K._to_core(p), far=0.6)
        if not hit:
            continue
        n = Vector(n)
        up = n.cross(d).normalized()                                    # across the strap
        if up.z < 0:
            up = -up
        R = geo.frame(n, up)
        M = geo.M_at(hit + n * 0.017, R)
        geo.add_box(bmL, (0.024, 0.036, 0.014), M, bevel=0.003)          # leather loop
        for t in (-0.0055, 0.0055):                                      # two rounds per loop, tips poking out
            geo.add_cyl(bmB, 0.0045, 0.0028, 0.022, M @ Matrix.Translation((t, 0.026, 0.001)) @ Matrix.Rotation(math.radians(-90), 4, 'X'), segs=6)
    K.finish(bmL, 'kit_bandolier_loops', leather)
    K.finish(bmB, 'kit_bandolier_rounds', brass)


def pouch(bm, M):
    geo.add_box(bm, (0.10, 0.11, 0.045), M @ Matrix.Translation((0, -0.045, 0.023)), bevel=0.008, segs=2)
    geo.add_box(bm, (0.104, 0.04, 0.048), M @ Matrix.Translation((0, 0.005, 0.026)), bevel=0.005)


def lead_block(bm, M):
    geo.add_box(bm, (0.075, 0.05, 0.022), M @ Matrix.Translation((0, 0.0, 0.013)), bevel=0.004)


def _oval(a, b, n, c, fn=None):
    return [c + Vector((a * math.cos(2 * math.pi * k / n), 0, b * math.sin(2 * math.pi * k / n))) for k in range(n)]


def _rings_mesh(bm, rings, cap_last=None):
    """quad strip between consecutive closed rings (same vertex count); cap_last = centre point -> fan"""
    V = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for A, B in zip(V, V[1:]):
        for k in range(n):
            bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
    if cap_last is not None:
        c = bm.verts.new(cap_last)
        for k in range(n):
            bm.faces.new((V[-1][k], V[-1][(k + 1) % n], c))
    return V


def _ell(c, xa, ya, a, b, n=20, s=1.0):
    return [c + xa * (a * s * math.cos(2 * math.pi * k / n)) + ya * (b * s * math.sin(2 * math.pi * k / n)) for k in range(n)]


def mask(bmR, bmG, tree, c, fwd, xa, ya, a, b, depth, n=20, contact_off=0.003):
    """1940s oval diving mask: rubber skirt from a contact ring (projected on `tree` along -fwd) to a framed oval glass.
    c = glass centre (world), fwd = outward normal of the glass."""
    fwd = Vector(fwd).normalized()
    front = _ell(c, xa, ya, a, b, n)
    contact = []
    for p in _ell(c, xa, ya, a * 1.06, b * 1.08, n):
        hit, nn = geo.project(tree, p + fwd * 0.05, -fwd, far=0.25)
        contact.append((hit + fwd * contact_off) if hit is not None else p - fwd * depth)
    mid = [q.lerp(f, 0.55) + (q - c).normalized() * 0.004 for q, f in zip(contact, _ell(c, xa, ya, a * 1.05, b * 1.05, n))]
    rim_o = _ell(c + fwd * 0.002, xa, ya, a, b, n, 1.05)
    rim_f = _ell(c + fwd * 0.006, xa, ya, a, b, n, 1.02)
    rim_i = _ell(c + fwd * 0.006, xa, ya, a, b, n, 0.93)
    glass = _ell(c + fwd * 0.003, xa, ya, a, b, n, 0.93)
    _rings_mesh(bmR, [contact, mid, rim_o, rim_f, rim_i, glass])
    _rings_mesh(bmG, [_ell(c + fwd * 0.0035, xa, ya, a, b, n, 0.935)], cap_last=c + fwd * 0.0045)


def mask_mats():
    rub = mat('mask_rubber', lambda: MT.solid('kit_mask_rubber', lin((0.07, 0.07, 0.075)), rough=0.45, bump=0.05))
    gl = mat('mask_glass', lambda: MT.solid('kit_mask_glass', lin((0.16, 0.20, 0.22)), rough=0.08, metal=0.6))
    return rub, gl


def mask_chest(K):
    """Marine (land): diving mask hanging on the chest on its strap around the neck"""
    ctx, m = K.ctx, K.m
    chest = ctx.bone['spine_03'][0].z
    p, n = K.at_angle(chest + 0.05, 0)
    n = Vector((n.x, n.y, n.z * 0.3)).normalized()
    R = geo.frame(n, (0, 0, 1))
    xa, ya = R.col[0], R.col[1]
    c = p + n * 0.034
    bmR, bmG = bmesh.new(), bmesh.new()
    mask(bmR, bmG, K.torso_tree, c, n, xa, ya, 0.058, 0.04, 0.03, contact_off=0.004)
    # strap: from the mask sides up over the collar and round the back of the neck
    neck = ctx.bone['neck_01'][0]
    zc = m['neck_base_z'] + 0.005
    for s in (1, -1):
        pts = [c + xa * s * 0.062, Vector((s * 0.075, p.y + 0.01, chest + 0.12)), Vector((s * 0.085, neck.y - 0.03, zc)),
               Vector((s * 0.08, neck.y + 0.03, zc + 0.005)), Vector((s * 0.03, neck.y + 0.07, zc + 0.01)), Vector((0, neck.y + 0.075, zc + 0.01))]
        geo.ribbon(bmR, K.torso_tree, K._dense(pts, 0.025), 0.016, 0.006, 0.003,
                   towards=lambda q: Vector((0, neck.y, q.z)) - q if q.z > chest + 0.1 else -n)
    rub, gl = mask_mats()
    K.finish(bmR, 'kit_mask', rub, bone='spine_03')
    K.finish(bmG, 'kit_mask_glass', gl, bone='spine_03')


def mask_face(K, garments):
    """diver: mask worn over eyes and nose, strap round the hood"""
    ctx, m = K.ctx, K.m
    h = ctx.human
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    ez = (el.z + er.z) / 2
    nose = [v.co for v in h.data.vertices if abs(v.co.x) < 0.012 and ez - 0.065 < v.co.z < ez - 0.01 and ctx.dom[v.index] == 'head']
    nose_y = min(q.y for q in nose) if nose else m['eye_front_y'] - 0.03
    suit = [g for g in garments if g.get('garment') == 'fullsuit']
    tree = geo.bvh_of(suit + [h])                     # the skirt sits on the hood edge where the hood reaches it
    c = Vector((0, nose_y - 0.006, ez - 0.016))
    X, Z, F = Vector((1, 0, 0)), Vector((0, 0.15, 1)).normalized(), Vector((0, -1, 0.15)).normalized()
    bmR, bmG = bmesh.new(), bmesh.new()
    mask(bmR, bmG, tree, c, F, X, Z, 0.055, 0.041, 0.04, contact_off=0.0025)
    hc = Vector(m['skull_center'])
    zs = ez + 0.004
    pts = [c + X * 0.057 - F * 0.01, Vector((0.075, c.y + 0.03, zs))]
    for k in range(13):   # round the back of the head (hood) from the wearer's left to right
        th = math.radians(100 + 160 * k / 12)
        d = Vector((math.sin(th), -math.cos(th), 0))
        pts.append(Vector((hc.x, hc.y, zs + 0.03 * max(0, -math.cos(th)))) + d * 0.2)
    pts += [Vector((-0.075, c.y + 0.03, zs)), c - X * 0.057 - F * 0.01]
    geo.ribbon(bmR, tree, K._dense(pts, 0.02), 0.018, 0.003, 0.003, towards=lambda q: Vector((hc.x, hc.y, q.z)) - q)
    rub, gl = mask_mats()
    K.finish(bmR, 'kit_mask', rub, bone='head')
    K.finish(bmG, 'kit_mask_glass', gl, bone='head')
    log('ca_kit: face mask glass y %.3f nose %.3f eyes %.3f' % (c.y, nose_y, m['eye_front_y']))


def _tube(bm, pts, r, segs=8, ridges=False):
    """tube along a polyline (corrugated when ridges=True)"""
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        R = geo.frame(d, (0, 0, 1) if abs(d.z) < 0.9 else (0, 1, 0))
        rr = r * (1.18 if ridges and i % 2 else 1.0)
        rings.append([p + R.col[0] * rr * math.cos(2 * math.pi * k / segs) + R.col[1] * rr * math.sin(2 * math.pi * k / segs) for k in range(segs)])
    _rings_mesh(bm, rings)


def _bez(a, b, c, n):
    return [a * (1 - t) ** 2 + b * 2 * t * (1 - t) + c * t * t for t in (k / (n - 1) for k in range(n))]


def rebreather(K):
    """closed-circuit oxygen set (Davis/Amphibian type): counter-lung bag on the chest, breathing hoses to a
    mouthpiece, small oxygen cylinder on the back, harness straps."""
    ctx, m = K.ctx, K.m
    chest = ctx.bone['spine_03'][0].z
    bagc = mat('bag_rubber', lambda: MT.fabric('kit_rebreather_bag', lin((0.30, 0.30, 0.25)), kind='rubber', rough=0.6, dirt=0.1, contrast=0.4))
    steel = mat('cyl_steel', lambda: MT.paint('kit_cylinder', lin((0.20, 0.22, 0.20)), rough=0.5))
    black = mat('black_leather', lambda: MT.leather('kit_leather', lin((0.045, 0.04, 0.035)), rough=0.4))
    p, n = K.at_angle(chest - 0.06, 0)
    n = Vector((n.x, n.y, 0)).normalized()
    R = geo.frame(n, (0, 0, 1))
    bm = bmesh.new()
    geo.add_box(bm, (0.25, 0.21, 0.07), geo.M_at(p + n * 0.037, R), bevel=0.028, segs=3)          # counter-lung
    geo.add_box(bm, (0.07, 0.05, 0.05), geo.M_at(p + n * 0.05 + Vector((0, 0, 0.115)), R), bevel=0.01)   # absorbent canister neck
    K.finish(bm, 'kit_rebreather_bag', bagc, bone='spine_03')
    # hoses: bag top -> mouthpiece, weights from the body (chest -> head blend)
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    ez = (el.z + er.z) / 2
    h = ctx.human
    mouth = [v.co for v in h.data.vertices if abs(v.co.x) < 0.01 and ez - 0.095 < v.co.z < ez - 0.07 and ctx.dom[v.index] == 'head']
    my = min(q.y for q in mouth) if mouth else m['eye_front_y'] - 0.02
    mp = Vector((0, my - 0.012, ez - 0.083))
    bm = bmesh.new()
    top = p + n * 0.05 + Vector((0, 0, 0.14))
    for s in (1, -1):
        a = top + Vector((s * 0.02, 0, 0))
        _tube(bm, _bez(a, a + n * 0.07 + Vector((s * 0.06, 0, 0.1)), mp + Vector((s * 0.022, -0.01, -0.005)), 12), 0.011, ridges=True)
    geo.add_box(bm, (0.065, 0.022, 0.024), geo.M_at(mp + Vector((0, -0.006, 0)), geo.frame((0, -1, 0))), bevel=0.006)
    o = K.finish(bm, 'kit_rebreather_hose', black, weights='body')
    # cylinder on the back + harness
    pb, nb = K.at_angle(chest - 0.08, 180)
    nb = Vector((nb.x, nb.y, 0)).normalized()
    bm = bmesh.new()
    for s in (1, -1):
        geo.add_cyl(bm, 0.045, 0.045, 0.30, geo.M_at(pb + nb * 0.052 + Vector((s * 0.05, 0, 0))), segs=12, bevel=0.01)
        geo.add_cyl(bm, 0.012, 0.012, 0.04, geo.M_at(pb + nb * 0.052 + Vector((s * 0.05, 0, 0.17))), segs=6)
    K.finish(bm, 'kit_rebreather_cyl', steel, bone='spine_03')
    K.ystraps(black, width=0.034, front_x=0.10, cross=False)


def build_kit(ctx, garments, spec):
    objs = _orig_build(ctx, garments, dict(spec, kit=[i for i in spec.get('kit', []) if i not in EXT]))
    items = [i for i in spec.get('kit', []) if i in EXT]
    if not items:
        return objs
    K = kit.Kit(ctx, garments)
    _surface_top(K, garments)
    leather = mat('brown_leather', lambda: MT.leather('kit_brown_leather', lin((0.26, 0.15, 0.08)), rough=0.5))
    black = mat('black_leather', lambda: MT.leather('kit_leather', lin((0.045, 0.04, 0.035)), rough=0.4))
    brass = mat('brass', lambda: MT.metal('kit_brass', lin((0.62, 0.52, 0.30)), rough=0.4))
    web = mat('webbing', lambda: MT.fabric('kit_webbing', lin(spec.get('outfit_opts', {}).get('webbing', (0.50, 0.46, 0.31))), kind='canvas', rough=0.95))
    for it in items:
        if it == 'bandolier':
            bandolier(K, leather, brass)
        elif it == 'belt_pouch':
            K.hang('kit_pouch', 40, 0.0, pouch, web)
        elif it == 'knife_belt':
            K.hang('kit_knife', -118, 0.02, kit.knife_sheath, black)
        elif it == 'mask_chest':
            mask_chest(K)
        elif it == 'mask_face':
            mask_face(K, garments)
        elif it == 'rebreather':
            rebreather(K)
        elif it == 'weight_belt':
            K.belt(black, buckle_mat=mat('fg_steel', lambda: MT.paint('kit_steel', lin((0.33, 0.35, 0.30)), rough=0.6)), width=0.05)
            lead = mat('lead', lambda: MT.metal('kit_lead', lin((0.30, 0.31, 0.32)), rough=0.7, metal=0.5))
            for k, a in enumerate((50, 130, -50, -130)):
                K.hang('kit_lead_%d' % k, a, -0.004, lead_block, lead)
    log('ca_kit: ' + ', '.join(f'{o.name}:{tri_count(o)}' for o in K.objs))
    return objs + K.objs


EXT = {'bandolier', 'belt_pouch', 'knife_belt', 'mask_chest', 'mask_face', 'rebreather', 'weight_belt'}


def install():
    kit.build_kit = build_kit
