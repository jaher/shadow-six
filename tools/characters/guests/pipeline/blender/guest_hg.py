# guest_hg.py - guest headgear (guests build group): RAF leather flying helmet + goggles pushed up, Tunisian chechia.
# Registers into headgear.BUILDERS / DEFAULT_MAT. Built around the measured skull like every other type (headfit.py).
import bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo, headfit as HF
import headgear as HG

SEG = HG.SEG


def build_flying_helmet(fit, bm, o):
    """RAF Type B/C leather helmet: close skull cap, front edge 12 mm over the brow, ear flaps down to the jaw behind
    the temples, round earphone housings; goggles pushed up on the forehead (lenses = badge material, frame = visor mat)."""
    front = fit.brow + o.get('front_dz', 0.013)
    jaw = fit.ear_bot - 0.022
    zb = HF.rim_profile(fit, front, jaw, fit.nape - 0.005, a_front=42, a_side=92)
    cl = o.get('clear', 0.006)

    def smooth_ring(zf, extra):
        R = [fit.req_max(360 * k / SEG, zf(360 * k / SEG) - 0.01, zf(360 * k / SEG) + 0.01) + extra for k in range(SEG)]
        for _ in range(3):
            R = [max(R[k], (R[(k - 1) % SEG] + 2 * R[k] + R[(k + 1) % SEG]) / 4) if True else R[k] for k in range(SEG)]
            R = [(R[(k - 1) % SEG] + 2 * R[k] + R[(k + 1) % SEG]) / 4 for k in range(SEG)]
        return [fit.pt(360 * k / SEG, max(0.02, R[k]), zf(360 * k / SEG)) for k in range(SEG)]
    rows = [Vector((0, fit.yc, fit.crown + cl + 0.002))]
    for f in (0.2, 0.4, 0.6, 0.78, 0.9, 1.0):
        rows.append(smooth_ring(lambda t, f=f: fit.crown + (zb(t) - fit.crown) * (f ** 1.25), cl + 0.002))
    # rolled leather edge (thickness): out and back up 6 mm
    rows.append(smooth_ring(lambda t: zb(t) - 0.002, cl + 0.007))
    rows.append(smooth_ring(lambda t: zb(t) + 0.006, cl + 0.005))
    HF.rows_mesh(bm, rows, SEG)
    # earphone housings (domed leather cups over the ears)
    ez = (fit.ear_top + fit.ear_bot) / 2
    for th in (90, -90):
        r = fit.req_max(th, ez - 0.01, ez + 0.01) + cl
        p = fit.pt(th, r, ez)
        nrm = (p - Vector((0, fit.yc, ez))); nrm.z = 0; nrm.normalize()
        prof = [(0.032, 0.0), (0.031, 0.008), (0.024, 0.015), (0.012, 0.019), (0.0, 0.02)]
        geo.add_lathe(bm, prof, geo.M_at(p - nrm * 0.004, geo.frame(nrm)), segs=12)
    if o.get('goggles', True):
        _goggles_up(fit, bm, o, cl)


def _goggles_up(fit, bm, o, cl):
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromBMesh(bm)
    gz = fit.brow + o.get('goggle_dz', 0.042)     # lens centre height: on the forehead, well above the eye line
    n0 = len(bm.faces)
    lens_faces = []
    for th in (19, -19):
        r = fit.req(th, gz, 1, 2) + cl + 0.004
        p = fit.pt(th, r, gz)
        nrm = (p - Vector((0, fit.yc, gz))); nrm.z = 0; nrm.normalize()
        nrm = (nrm + Vector((0, 0, 0.35))).normalized()    # tilted up: resting on the forehead
        M = geo.M_at(p + nrm * 0.006, geo.frame(nrm))
        geo.add_cyl(bm, 0.024, 0.021, 0.016, M, segs=14)         # rubber/leather eye cup
        k = len(bm.faces)
        geo.add_cyl(bm, 0.019, 0.019, 0.003, M @ Matrix.Translation((0, 0, 0.0085)), segs=14)
        lens_faces += list(range(k, len(bm.faces)))
    # bridge between the cups
    p = fit.pt(0, fit.req(0, gz, 1, 2) + cl + 0.012, gz)
    geo.add_box(bm, (0.022, 0.008, 0.006), geo.M_at(p, geo.frame(Vector((0, -1, 0.35)).normalized())))
    # elastic strap round the helmet at goggle height, from cup to cup round the back
    pts = []
    for k in range(15):
        th = 36 + k * (288 / 14)
        z = gz + 0.012 * math.sin(math.radians(th))
        c0 = Vector((0, fit.yc, z)); d = fit.pt(th, 1.0, z) - c0
        hit = None
        for rr in range(60):   # walk inwards from outside until we are on the helmet surface
            q = c0 + d * (0.16 - rr * 0.002)
            loc, nn, ii, dist = tree.find_nearest(q, 0.004)
            if loc is not None:
                hit = loc; break
        pts.append((hit or fit.pt(th, fit.req(th, z, 1, 1) + cl + 0.004, z)) + d * 0.0025)
    up, dn = [], []
    for q in pts:
        nrm = q - Vector((0, fit.yc, q.z)); nrm.normalize()
        up.append(q + Vector((0, 0, 0.009)) + nrm * 0.001); dn.append(q - Vector((0, 0, 0.009)) + nrm * 0.001)
    HF.strip_mesh(bm, [up, dn])
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]:
        f.material_index = 1
    for i in lens_faces:
        bm.faces[i].material_index = 2


def build_chechia(fit, bm, o):
    """Tunisian chechia: soft red felt skull cap, rounded crown, sits high (front rim 3 cm over the brow), ~7 cm tall
    above the rim, top slightly flattened."""
    zb = HF.rim_profile(fit, fit.brow + o.get('front_dz', 0.03), fit.ear_top + 0.018, fit.nape + 0.04)
    cl = o.get('clear', 0.007)
    ztop = fit.crown + o.get('rise', 0.022)
    base = lambda t: max(0.02, fit.req_max(t, zb(t), zb(t) + 0.03) + cl)
    rows = [Vector((0, fit.yc + 0.004, ztop + 0.002))]
    # flat, slightly domed top (radius fraction, height below top) then a near-vertical soft wall down to the rim
    for rf, dz in ((0.45, 0.001), (0.75, 0.004), (0.9, 0.009), (0.98, 0.017)):
        rows.append(HG._ring(fit, lambda t, dz=dz: ztop - dz, lambda t, rf=rf: base(t) * rf * 1.02, cy=fit.yc + 0.004))
    for f in (0.35, 0.7, 1.0):
        zf = lambda t, f=f: (ztop - 0.017) + (zb(t) - (ztop - 0.017)) * f
        rows.append(HG._ring(fit, zf, lambda t, f=f: base(t) * (1.02 - 0.02 * f)))
    rows.append(HG._ring(fit, lambda t: zb(t) + 0.004, lambda t: base(t) - 0.002))
    HF.rows_mesh(bm, rows, SEG)


def build_basque_beret(fit, bm, o):
    """civilian Basque beret: tight band, flat wide crown overhanging ~2.5 cm all round, worn level and pulled a
    little to one side, small stalk (txertena) on top. Much flatter than the military beret."""
    zb = HF.rim_profile(fit, fit.brow + 0.022, fit.ear_top + 0.02, fit.nape + 0.045)
    band = lambda t: fit.req(t, zb(t) + 0.01, 1, 1) + 0.006
    side = 1 if o.get('pulled', 'right') == 'left' else -1
    over = lambda t: 0.024 + 0.008 * math.sin(math.radians(t)) * side      # droops/overhangs more on one side
    zo = lambda t: max(zb(t) + 0.028, fit.crown - 0.035) - 0.006 * math.sin(math.radians(t)) * side
    ztop = fit.crown + 0.018
    rows = [Vector((0, fit.yc, ztop + 0.002))]
    rows.append(HG._ring(fit, lambda t: ztop, lambda t: band(t) * 0.45))
    rows.append(HG._ring(fit, lambda t: ztop - 0.004, lambda t: band(t) * 0.8))
    rows.append(HG._ring(fit, lambda t: (ztop + zo(t)) / 2 + 0.002, lambda t: band(t) + over(t) * 0.8))
    rows.append(HG._ring(fit, zo, lambda t: band(t) + over(t)))
    rows.append(HG._ring(fit, lambda t: zo(t) - 0.012, lambda t: band(t) + over(t) * 0.55))
    rows.append(HG._ring(fit, lambda t: zb(t) + 0.004, lambda t: band(t) + 0.002))
    rows.append(HG._ring(fit, zb, band))
    HF.rows_mesh(bm, rows, SEG)
    geo.add_cyl(bm, 0.003, 0.002, 0.012, geo.M_at(Vector((0, fit.yc, ztop + 0.006))), segs=6)


HG.BUILDERS.update({'flying_helmet': build_flying_helmet, 'chechia': build_chechia, 'basque_beret': build_basque_beret})
HG.DEFAULT_MAT.update({'flying_helmet': ('leather', (0.24, 0.14, 0.075)), 'chechia': ('wool', (0.55, 0.08, 0.06)), 'basque_beret': ('wool', (0.08, 0.09, 0.12))})


def trim_hair(hg, hair, fit):
    """delete hair-cap faces hidden under the headgear (outward ray from the skull axis hits the headgear within 4 cm)."""
    import bmesh as B
    tree = geo.bvh_of([hg])
    me = hair.data
    cov = []
    C = Vector((0, fit.yc, fit.brow - 0.015))
    for v in me.vertices:
        d = v.co - C
        hit, n, i, dist = tree.ray_cast(C, d.normalized(), d.length + 0.04)
        cov.append(hit is not None)
    bm = B.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dead = [f for f in bm.faces if all(cov[v.index] for v in f.verts)]
    B.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me); bm.free()
    log('trim_hair: removed', len(dead), 'hair faces under headgear')
