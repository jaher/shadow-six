# ca_headgear.py - commandos_a headgear shapes (patched into pipeline headgear.BUILDERS; the fit guarantee
# (push-out, eye-ray check, auto-lift) in headgear.build_headgear still runs on these unchanged)
#  - beret: lower crown, disc set back and sloping down to the front so there is no tall "wall" over the brow
#  - watch_cap: snug knitted crown (5 mm), thin rolled cuff (8 mm), cuff 4 cm deep over the ear tops
import math
from mathutils import Vector
from common import *
import headgear as HG
import headfit as HF

SEG = HG.SEG


def build_beret(fit, bm, o):
    """soft beret: headband level all round just above the brows/ears; the crown hugs the skull at the front and
    the badge side and billows out + droops over the wearer's right ear (pulled right), flat on top."""
    zb = HF.rim_profile(fit, fit.brow + 0.013, fit.brow + 0.008, fit.nape + 0.04, a_front=10, a_side=95)
    side_deg = 270 if o.get('pulled', 'right') == 'right' else 90      # 0 = front, +90 = wearer's left
    puff = o.get('puff', 0.036)
    droop = o.get('droop', 0.018)

    def sa(t):   # 0..1 weight toward the pulled side (and a little toward the back)
        c = math.cos(math.radians(t - side_deg))
        return max(0.0, c) ** 1.4 * 0.85 + max(0.0, math.cos(math.radians(t - 180))) * 0.25

    top = fit.crown + o.get('crown_gap', 0.010)
    rows = [Vector((0, fit.yc + 0.01, top + 0.004))]
    for f in (0.18, 0.36, 0.52, 0.66, 0.78, 0.88, 0.95):
        def zf(t, f=f):
            z = top + (zb(t) - top) * (f ** 1.6)                    # flat top, then down the sides
            return z - droop * sa(t) * min(1.0, f / 0.6) ** 1.5              # the pulled side folds down over the band
        def rf(t, f=f, zf=zf):
            g = min(1.0, f / 0.5) * (1 - 0.35 * max(0.0, (f - 0.8) / 0.15))
            bulge = 0.006 + puff * sa(t) * g + 0.010 * math.sin(math.pi * f)
            return max(0.02, fit.req_max(t, zf(t) - 0.01, zf(t) + 0.01) + bulge)
        rows.append(HG._ring(fit, zf, rf))
    rows.append(HG._ring(fit, lambda t: zb(t) + 0.012, HG._band(fit, zb, 0.005, 0.012)))    # headband (leather binding)
    rows.append(HG._ring(fit, zb, HG._band(fit, zb, 0.004)))
    HF.rows_mesh(bm, rows, SEG)


def build_watch_cap(fit, bm, o, cuff=True):
    zb = HF.rim_profile(fit, fit.brow + o.get('brow_gap', 0.016), fit.brow + 0.007, fit.nape + 0.03, a_front=10, a_side=95)
    rows = [Vector((0, fit.yc + 0.005, fit.crown + 0.009))]
    for f in (0.2, 0.42, 0.62, 0.8, 0.92, 1.0):
        zf = lambda t, f=f: fit.crown + (zb(t) - fit.crown) * (f ** 1.25)
        rows.append(HG._ring(fit, zf, lambda t, f=f, zf=zf: max(0.02, fit.req(t, zf(t)) + 0.005 + 0.004 * (1 - f))))
    if cuff:   # rolled cuff: out, up 4 cm, rounded top edge, back in
        rows.append(HG._ring(fit, zb, HG._band(fit, zb, 0.0085)))
        rows.append(HG._ring(fit, lambda t: zb(t) + 0.036, HG._band(fit, zb, 0.0095, 0.036)))
        rows.append(HG._ring(fit, lambda t: zb(t) + 0.041, HG._band(fit, zb, 0.0065, 0.041)))
        rows.append(HG._ring(fit, lambda t: zb(t) + 0.042, HG._band(fit, zb, 0.004, 0.042)))
    HF.rows_mesh(bm, rows, SEG)


def install():
    HG.BUILDERS['beret'] = build_beret
    HG.BUILDERS['watch_cap'] = build_watch_cap
