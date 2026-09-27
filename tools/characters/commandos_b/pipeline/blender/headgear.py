# headgear.py - parametric period headgear built around the measured skull (headfit.py), rigid on the 'head' bone.
# types: m35 (M35/M40 steel helmet), mk3 (domed short-brim British helmet), pith, beret, watch_cap, comforter,
#        officer_cap (peaked Schirmmuetze), field_cap (soft peaked: DAK M41 / camo / Bergmuetze), flat_cap, side_cap
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo, headfit as HF
import materials as MT
from uniform import lin

SEG = 28


def _ring(fit, zf, rf, segs=SEG, cx=0.0, cy=None):
    return [fit.pt(360 * k / segs, rf(360 * k / segs), zf(360 * k / segs), cx, cy) for k in range(segs)]


def _band(fit, zf, extra, dz=0.0):
    """ring hugging the skull at height zf(th)+dz with `extra` clearance"""
    return lambda th: fit.req(th, zf(th) + dz, 1, 1) + extra


# ---------------- helmets ----------------
def helmet(fit, bm, front, side, back, flare=(0.018, 0.028, 0.032), skirt=(0.028, 0.042, 0.045), gap=0.016, top_gap=0.026, rolled=True):
    zr = HF.rim_profile(fit, front, side, back)
    fl = HF.rim_profile(fit, *flare)
    sk = HF.rim_profile(fit, *skirt)
    zb = lambda th: zr(th) + sk(th)
    ztop = fit.crown + top_gap
    Req = {}
    for k in range(SEG):
        th = 360 * k / SEG
        Req[k] = max(fit.req_max(th, zb(th) - 0.01, fit.crown - 0.015) + gap, 0.07)
    # smooth Req around the ring (a helmet is a smooth shell)
    Rs = [(Req[(k - 1) % SEG] + 2 * Req[k] + Req[(k + 1) % SEG]) / 4 for k in range(SEG)]
    Rs = [max(Rs[k], (Rs[k] + Rs[(k + SEG // 2) % SEG]) / 2 * 0.95) for k in range(SEG)]
    rows = [Vector((0, fit.yc, ztop))]
    for phi in (18, 36, 52, 66, 78, 90):
        p = math.radians(phi)
        rows.append([fit.pt(360 * k / SEG, Rs[k] * math.sin(p), zb(360 * k / SEG) + (ztop - zb(360 * k / SEG)) * math.cos(p)) for k in range(SEG)])
    for s in (0.35, 0.7, 1.0):
        rows.append([fit.pt(360 * k / SEG, Rs[k] + fl(360 * k / SEG) * s ** 1.6, zb(360 * k / SEG) - sk(360 * k / SEG) * s) for k in range(SEG)])
    if rolled:
        rows.append([fit.pt(360 * k / SEG, Rs[k] + fl(360 * k / SEG) - 0.003, zr(360 * k / SEG) + 0.003) for k in range(SEG)])
    rows.append([fit.pt(360 * k / SEG, Rs[k] + fl(360 * k / SEG) * 0.4 - 0.004, zr(360 * k / SEG) + 0.018) for k in range(SEG)])
    HF.rows_mesh(bm, rows, SEG)
    return zr


def build_m35(fit, bm, o):
    zr = helmet(fit, bm, front=fit.brow + 0.010, side=(fit.ear_top + fit.ear_bot) / 2 + 0.004, back=fit.nape + 0.004)
    # air vents (lugs) on both sides + chin-strap stubs
    for s in (1, -1):
        th = s * 90
        z = fit.crown - 0.045
        p = fit.pt(th, fit.req(th, z) + 0.019, z)
        geo.add_cyl(bm, 0.006, 0.005, 0.006, geo.M_at(p, geo.frame(Vector((s, 0, 0)))), segs=6)


def build_mk3(fit, bm, o):
    helmet(fit, bm, front=fit.brow + 0.012, side=fit.ear_top - 0.004, back=fit.nape + 0.018,
           flare=(0.02, 0.024, 0.026), skirt=(0.016, 0.02, 0.022), gap=0.017, top_gap=0.03)


def build_pith(fit, bm, o):
    # tall dome + wide brim (front/back longer); brim tip clamped above the eyes in front view
    zr = HF.rim_profile(fit, fit.brow + 0.02, fit.ear_top + 0.004, fit.nape + 0.03)
    helmet(fit, bm, front=fit.brow + 0.02, side=fit.ear_top + 0.004, back=fit.nape + 0.03,
           flare=(0.075, 0.05, 0.08), skirt=(0.028, 0.02, 0.03), gap=0.024, top_gap=0.05, rolled=False)


# ---------------- soft caps ----------------
def build_beret(fit, bm, o):
    zb = HF.rim_profile(fit, fit.brow + 0.016, fit.ear_top + 0.012, fit.nape + 0.045)
    band_r = _band(fit, zb, 0.004)
    rows = [_ring(fit, zb, band_r), _ring(fit, lambda t: zb(t) + 0.014, _band(fit, zb, 0.004, 0.014))]
    # crown: a flat disc (beret diameter ~ 1.35 x skull length) pulled to the wearer's right and draped down
    L = fit.m['skull_back_y'] - fit.m['forehead_front_y']
    Rb = 0.62 * L + 0.01
    drape = o.get('drape_deg', 22)
    side = -1 if o.get('pulled', 'right') == 'right' else 1
    cx, cy = side * 0.042, fit.yc + 0.004
    ztop = fit.crown + 0.022
    hx = side * 0.02                      # hinge line: the crown stays flat on the far side, the excess droops
    tn = math.tan(math.radians(drape))
    def Rm_(p):
        d = max(0.0, (p.x - hx) * side)
        a = math.atan2(p.x - cx, -(p.y - cy))                     # angle around the disc centre (0 = front)
        wside = 0.25 + 0.75 * abs(math.sin(a))                     # droop over the ear, not over the brow
        return Vector((p.x - side * d * 0.12, p.y, p.z - tn * d * min(1.0, d / 0.05) * wside))
    class _R:
        def __matmul__(self, p):
            return Rm_(p)
    Rm = _R()
    def disc(r, z):
        return [Rm @ Vector((cx + math.sin(2 * math.pi * k / SEG) * r, cy - math.cos(2 * math.pi * k / SEG) * r * 1.04, z)) for k in range(SEG)]
    rows.append(disc(Rb * 0.9, ztop - 0.034))
    rows.append(disc(Rb, ztop - 0.012))
    rows.append(disc(Rb * 0.9, ztop - 0.001))
    rows.append(disc(Rb * 0.55, ztop + 0.004))
    rows.append(Rm @ Vector((cx, cy, ztop + 0.006)))
    rows.reverse()
    log('beret rows z', [round((r.z if isinstance(r, Vector) else sum(p.z for p in r) / len(r)), 3) for r in rows], 'Rb', round(Rb, 3), 'L', round(L, 3))
    HF.rows_mesh(bm, rows, SEG)


def build_watch_cap(fit, bm, o, cuff=True):
    zb = HF.rim_profile(fit, fit.brow + 0.03, fit.ear_top + 0.006, fit.nape + 0.035)
    rows = [Vector((0, fit.yc, fit.crown + 0.012))]
    for f in (0.25, 0.5, 0.72, 0.88, 1.0):
        rows.append(_ring(fit, lambda t, f=f: fit.crown + (zb(t) - fit.crown) * (f ** 1.3), lambda t, f=f: max(0.02, fit.req(t, fit.crown + (zb(t) - fit.crown) * (f ** 1.3)) + 0.007)))
    if cuff:   # rolled cuff: out, up, back in
        rows.append(_ring(fit, zb, _band(fit, zb, 0.018)))
        rows.append(_ring(fit, lambda t: zb(t) + 0.04, _band(fit, zb, 0.019, 0.04)))
        rows.append(_ring(fit, lambda t: zb(t) + 0.042, _band(fit, zb, 0.008, 0.042)))
    HF.rows_mesh(bm, rows, SEG)


def build_comforter(fit, bm, o):
    build_watch_cap(fit, bm, o, cuff=False)


def _visor(fit, bm, z_root, length, droop_deg, half_angle=70, width_scale=1.0, root_r=None, root_z=None):
    """stiff peak from the band front; the tip is clamped to stay above the eye line (front view).
    root_r/root_z(th): the band's own bottom-ring functions, so the peak root follows the band exactly (no saw-tooth gaps);
    a first row is tucked 5 mm inside the band so no seam can open between the band and the peak."""
    n = 13
    min_tip = fit.eye_top + 0.008
    rr = root_r or (lambda th: fit.req(th, z_root) + 0.006)
    rz = root_z or (lambda th: z_root)
    sm = lambda f, th: (f(th - 6) + 2 * f(th) + f(th + 6)) / 4     # smooth the 10-degree req bins
    rows = []
    for j, f in enumerate((-0.12, 0.0, 0.5, 1.0)):
        row = []
        for k in range(n):
            th = -half_angle + 2 * half_angle * k / (n - 1)
            base_r = sm(rr, th)
            z0 = sm(rz, th)
            L = length * math.cos(math.radians(th)) ** 0.7 * width_scale
            if f < 0:
                row.append(fit.pt(th, base_r - 0.006, z0 + 0.004))
                continue
            drop = L * f * math.tan(math.radians(droop_deg))
            z = max(z0 - drop, min_tip) if f > 0 else z0
            row.append(fit.pt(th, base_r + L * f, z))
        rows.append(row)
    n0 = len(bm.faces)
    HF.strip_mesh(bm, rows, flip=True)
    HF.strip_mesh(bm, [[p - Vector((0, 0, 0.004)) for p in r] for r in rows])
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]:
        f.material_index = 1
    return rows


def build_officer_cap(fit, bm, o):
    """Schirmmuetze: 3.5 cm band, soft wall flaring out to a large oval top that rises at the front (saddle)"""
    zb = HF.rim_profile(fit, fit.brow + 0.013, fit.ear_top + 0.014, fit.nape + 0.04)
    hb = 0.034
    band = lambda t: fit.req(t, zb(t) + 0.02, 1, 2) + 0.006
    L = fit.m['skull_back_y'] - fit.m['forehead_front_y']
    Rx, Ry = 0.70 * L, 0.76 * L   # wide flat top overhanging the band all round
    cy = fit.yc - 0.014
    z0 = zb(0) + hb
    T0 = max(z0 + 0.026, fit.crown + 0.008)   # flat top always clears the crown (+hair) on tall heads
    def top_z(th):
        c = math.cos(math.radians(th))
        return T0 + 0.016 * max(0.0, c) ** 1.5 - 0.004 * max(0.0, -c)
    def ell(th, f):
        a = math.radians(th)
        return math.hypot(math.sin(a) * Rx, math.cos(a) * Ry) * f
    rows = [Vector((0, cy, T0 + 0.003))]
    rows.append(_ring(fit, lambda t: top_z(t) - 0.003, lambda t: ell(t, 0.55), cy=cy))
    rows.append(_ring(fit, top_z, lambda t: ell(t, 0.97), cy=cy))
    rows.append(_ring(fit, lambda t: top_z(t) - 0.008, lambda t: ell(t, 1.0), cy=cy))       # piped edge
    rows.append(_ring(fit, lambda t: top_z(t) - 0.018, lambda t: ell(t, 0.96), cy=cy))                              # rounded overhang
    rows.append(_ring(fit, lambda t: zb(t) + hb + 0.45 * (top_z(t) - 0.02 - zb(t) - hb), lambda t: band(t) + 0.012 + 0.25 * max(0.0, ell(t, 1.0) - band(t)),
                      cy=(cy + fit.yc) / 2))                                                                                 # pinched soft wall
    rows.append(_ring(fit, lambda t: zb(t) + hb, lambda t: band(t) + 0.004))
    rows.append(_ring(fit, zb, band))
    HF.rows_mesh(bm, rows, SEG)
    o['_visor'] = _visor(fit, bm, zb(0) + 0.002, 0.056, 26, root_r=lambda t: band(t) + 0.001, root_z=lambda t: zb(t) + 0.002)


def build_field_cap(fit, bm, o):
    """soft peaked field cap: DAK M41 / camo field cap (Driver) / Bergmuetze"""
    zb = HF.rim_profile(fit, fit.brow + 0.014, fit.ear_top + 0.01, fit.nape + 0.04)
    rows = [Vector((0, fit.yc - 0.005, fit.crown + 0.03))]
    for f, e in ((0.3, 0.012), (0.6, 0.012), (0.85, 0.01), (1.0, 0.007)):
        rows.append(_ring(fit, lambda t, f=f: fit.crown + 0.025 + (zb(t) - fit.crown - 0.025) * f ** 1.2,
                          lambda t, f=f, e=e: max(0.03, fit.req(t, fit.crown + (zb(t) - fit.crown) * f ** 1.2) + e + 0.01 * (1 - f))))
    HF.rows_mesh(bm, rows, SEG)
    o['_visor'] = _visor(fit, bm, zb(0) + 0.003, o.get('peak', 0.065), o.get('peak_droop', 22), half_angle=62,
                         root_r=lambda t: max(0.03, fit.req(t, zb(t)) + 0.008), root_z=lambda t: zb(t) + 0.003)


def build_flat_cap(fit, bm, o):
    """eight-panel flat cap: low flat crown, highest at the back, pulled forward so its front edge lies on the short peak"""
    zb = HF.rim_profile(fit, fit.brow + 0.013, fit.ear_top + 0.012, fit.nape + 0.04)
    band = lambda t: fit.req(t, zb(t) + 0.012, 1, 1) + 0.005
    c_ = lambda t: math.cos(math.radians(t))
    # widest ring: at the front it lies on the peak (band + 1 cm), at the back it rides just under the crown
    top = lambda t: HF.blend(zb(t) + 0.010, fit.crown - 0.010, min(1.0, ((1 - c_(t)) / 2) ** 0.5 * 1.25))
    rows = [Vector((0, fit.yc - 0.012, fit.crown + 0.009))]
    rows.append(_ring(fit, lambda t: max(top(t) + 0.010, fit.crown + 0.002), lambda t: band(t) * 0.6, cy=fit.yc - 0.012))
    rows.append(_ring(fit, lambda t: top(t) + 0.004, lambda t: band(t) + 0.016 + 0.014 * max(0.0, c_(t)), cy=fit.yc - 0.008))
    rows.append(_ring(fit, lambda t: zb(t) + 0.008 - 0.002 * max(0.0, c_(t)), lambda t: band(t) + 0.004 + 0.006 * max(0.0, c_(t))))
    rows.append(_ring(fit, zb, band))
    HF.rows_mesh(bm, rows, SEG)
    o['_visor'] = _visor(fit, bm, zb(0) + 0.002, 0.048, 24, half_angle=58, root_r=lambda t: band(t) + 0.002, root_z=lambda t: zb(t) + 0.002)


def build_side_cap(fit, bm, o):
    """M34/M38 Feldmuetze: boat-shaped cap sitting on top of the head (band above the ears), tilted right"""
    zb = HF.rim_profile(fit, fit.brow + 0.03, fit.ear_top + 0.028, fit.ear_top + 0.018)
    band = lambda t: fit.req(t, zb(t), 1, 1) + 0.005
    ring = _ring(fit, zb, band)
    up = _ring(fit, lambda t: zb(t) + 0.03, lambda t: band(t) + 0.006)
    def ridge(p):
        dy = p.y - fit.yc
        return Vector((0.006 if p.x > 0 else -0.006, p.y * 0.93 + fit.yc * 0.07, fit.crown + 0.028 - 2.2 * dy * dy))
    top = [ridge(p) for p in up]
    mid = [p.lerp(q, 0.55) + Vector((0, 0, 0.006)) for p, q in zip(up, top)]
    HF.rows_mesh(bm, [top, mid, up, ring], SEG)
    o.setdefault('roll_deg', -7)


BUILDERS = {'m35': build_m35, 'm40': build_m35, 'mk3': build_mk3, 'pith': build_pith, 'beret': build_beret,
            'watch_cap': build_watch_cap, 'comforter': build_comforter, 'officer_cap': build_officer_cap,
            'field_cap': build_field_cap, 'dak_cap': build_field_cap, 'camo_cap': build_field_cap, 'flat_cap': build_flat_cap,
            'side_cap': build_side_cap}
DEFAULT_MAT = {'m35': ('paint', (0.36, 0.38, 0.33)), 'mk3': ('paint', (0.24, 0.30, 0.20)), 'pith': ('canvas', (0.72, 0.64, 0.46)),
               'beret': ('wool', (0.17, 0.29, 0.18)), 'watch_cap': ('wool', (0.05, 0.05, 0.055)), 'comforter': ('wool', (0.45, 0.40, 0.27)),
               'officer_cap': ('wool', (0.40, 0.42, 0.38)), 'field_cap': ('canvas', (0.55, 0.50, 0.33)), 'flat_cap': ('wool', (0.42, 0.26, 0.15)),
               'side_cap': ('wool', (0.37, 0.38, 0.32))}


def _badge(fit, bm, th, dz_above_brow, size, depth=0.004, idx=2):
    z = fit.brow + dz_above_brow
    n0 = len(bm.faces)
    r = fit.req(th, z) + 0.01
    p = fit.pt(th, r + 0.012, z)
    nrm = (p - Vector((0, fit.yc, z))).normalized()
    geo.add_box(bm, (size[0], size[1], depth), geo.M_at(p, geo.frame(nrm)), bevel=0.001)
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]:
        f.material_index = idx
    return p


def push_radial(bm, fit, clearance=0.005):
    """push verts out of the scalp/hair RADIALLY (horizontal, from the skull axis; upward near the crown) instead of along
    the nearest-surface normal, which near the hairline tilts up/down and turns a clean band edge into a saw-tooth."""
    n = 0
    for v in bm.verts:
        d = Vector((v.co.x, v.co.y - fit.yc, 0.0))
        if d.length < 1e-4 or v.co.z > fit.crown - 0.02:
            d = Vector((d.x, d.y, 0.0)) * 0.3 + Vector((0, 0, 1))
        d.normalize()
        moved = False
        for it in range(40):
            bad = False
            for tree in (fit.tree, fit.hair_tree):
                if tree is None:
                    continue
                loc, nrm, i, dist = tree.find_nearest(v.co, 0.05)
                if loc is not None and (v.co - loc).dot(nrm) < clearance:
                    bad = True
                    break
            if not bad:
                break
            v.co += d * 0.001
            moved = True
        n += moved
    return n


def build_headgear(ctx, parts, spec):
    hg = dict(spec.get('headgear') or {})
    t = hg.get('type')
    if not t:
        return None, None
    o = dict(hg.get('offset', {}))
    o.update({k: v for k, v in hg.items() if k not in ('offset', 'type', 'color', 'badge')})
    fit = HF.HeadFit(ctx, parts)
    bm = bmesh.new()
    BUILDERS[t](fit, bm, o)
    # badge on the band: beret dagger over the left eye, officer/cap cockade at the front
    if hg.get('badge'):
        if t == 'beret':
            _badge(fit, bm, 32, 0.028, (0.022, 0.034))
        else:
            _badge(fit, bm, 0, 0.03, (0.018, 0.018))
    HF.apply_offset(bm, fit, o)
    npush = push_radial(bm, fit, clearance=0.005)
    kind, col = DEFAULT_MAT.get(t, ('wool', (0.3, 0.3, 0.3)))
    col = hg.get('color', col)
    if kind == 'paint':
        m0 = MT.paint('hg_' + t, lin(col), rough=0.62)
    else:
        m0 = MT.fabric('hg_' + t, lin(col), kind='canvas' if kind == 'canvas' else 'wool', rough=0.95, dirt=0.05,
                       camo=[lin(c) for c in hg['camo']] if hg.get('camo') else None)
    if hg.get('check'):
        m0 = MT.check_fabric('hg_' + t, lin(col), [lin(c) for c in hg['check']], pitch=hg.get('check_pitch', 0.014))
    m1 = MT.leather('hg_visor', lin(hg.get('visor_color', (0.03, 0.03, 0.03) if t == 'officer_cap' else col)), rough=0.3 if t == 'officer_cap' else 0.8)
    if (hg.get('check') or hg.get('camo')) and t != 'officer_cap':
        m1 = m0   # cloth-covered peak
    m2 = MT.metal('hg_badge', lin(hg.get('badge_color', (0.80, 0.79, 0.74))), rough=0.45, metal=0.35)
    ob = geo.obj_from_bm('headgear_' + t, bm, m0, recalc=False)
    ob.data.materials.append(m1); ob.data.materials.append(m2)
    geo.rigid_weights(ob, 'head', ctx.rig)
    # ---- fit verification + auto-correction (lift) ----
    lift = 0.0
    for it in range(16):
        tree = geo.bvh_of([ob])
        ok, dmin = HF.eye_check(tree, fit)
        fz = HF.front_edge_z(ob, fit)
        gap = (fz - fit.brow) if fz is not None else 1.0
        if ok and gap >= 0.0:
            break
        ob.data.transform(Matrix.Translation((0, 0, 0.002)))
        lift += 0.002
    rep = {'type': t, 'eyes_clear': ok, 'front_edge_above_brow_m': round(gap, 4), 'auto_lift_m': round(lift, 4),
           'pushed_verts': npush, 'tris': tri_count(ob), 'brow_z': round(fit.brow, 4), 'eye_top_z': round(fit.eye_top, 4)}
    log('headgear fit', rep)
    return ob, rep
