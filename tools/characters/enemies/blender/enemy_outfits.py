# enemy_outfits.py - extra German outfits on top of pipeline/blender/outfits.py (bible §5.3, §5.5):
#   greatcoat     - M40 field-grey greatcoat to mid-calf, dark-green fold-down collar, double-breasted (Norway sentries)
#   general_coat  - grey leather greatcoat over breeches + riding boots (SS-Gruppenfuehrer Schleper, M15), no runes
import bpy, bmesh, math
from mathutils import Vector
from common import *
import uniform as U
import materials as MT
import outfits
import geo

EXT = ('greatcoat', 'general_coat', 'officer_heer', 'panzer', 'winter_smock')

# officer tunic with a NARROW open-collar V (pipeline uniform.top cuts the V almost to the shoulders): same code,
# slope parameterised - compiled from uniform.top's source so it stays in sync with pipeline fixes.
import inspect
_src = inspect.getsource(U.top).replace('def top(', 'def top_v(', 1)
assert '(c.z - (chest + 0.02)) * 0.9' in _src
_src = _src.replace('(c.z - (chest + 0.02)) * 0.9', '(c.z - (chest + 0.02)) * V_SLOPE', 1)
_ns = dict(U.__dict__); _ns['V_SLOPE'] = 0.30
exec(_src, _ns)
top_v = _ns['top_v']


LEGB = ('thigh_l', 'thigh_r', 'calf_l', 'calf_r')


def skirt(ctx, name, mat, over, z_top, z_hem, flare_frac=0.10, ease=0.03, segs=28, rings=7, sway=0.7):
    """coat/smock skirt as a closed flared tube (a garment shell over two thighs splits into 'bloomers').
    Top ring = radius of the garment `over` at z_top minus 3 mm (tucked under it); each ring encloses both legs
    (rest pose) + 2.5 cm and flares; weights blend pelvis -> thighs (left/right by angle) with depth `sway`."""
    ov = [v.co for v in over.data.vertices if abs(v.co.z - z_top) < 0.02]
    cy = sum(c.y for c in ov) / max(1, len(ov))
    def bins(pts, z0, band):
        rb = [0.0] * segs
        for c in pts:
            if abs(c.z - z0) < band:
                a = math.atan2(c.x, -(c.y - cy)); k = int((a + math.pi) / (2 * math.pi) * segs) % segs
                rb[k] = max(rb[k], math.hypot(c.x, c.y - cy))
        for _ in range(2):
            rb = [max(rb[k], (rb[k - 1] + rb[(k + 1) % segs]) / 2) for k in range(segs)]
        return [(rb[k - 1] + 2 * rb[k] + rb[(k + 1) % segs]) / 4 for k in range(segs)]
    r0 = [max(0.08, r - 0.003) for r in bins(ov, z_top, 0.02)]
    legs = [ctx.human.data.vertices[i].co for i in ctx.visible if ctx.dom[i] in LEGB]
    bm = bmesh.new(); R = []
    for j in range(rings + 1):
        t = j / rings; z = z_top + (z_hem - z_top) * t
        lr = bins(legs, z, 0.03) if t > 0 else [0.0] * segs
        row = []
        for k in range(segs):
            a = -math.pi + (k + 0.5) * 2 * math.pi / segs
            rr = max(r0[k] * (1 + flare_frac * t) + ease * t, (lr[k] + 0.025) if lr[k] > 0 else 0.0)
            row.append(bm.verts.new((math.sin(a) * rr, cy - math.cos(a) * rr, z)))
        R.append(row)
    outer = []
    for j in range(rings):
        for k in range(segs):
            a, b, c, d = R[j][k], R[j][(k + 1) % segs], R[j + 1][(k + 1) % segs], R[j + 1][k]
            outer.append(bm.faces.new((a, d, c, b)))
    bm.normal_update()
    f0 = outer[0]; ctr = f0.calc_center_median(); rad = Vector((ctr.x, ctr.y - cy, 0))
    if f0.normal.dot(rad) < 0:
        for f in outer:
            f.normal_flip()
    # inner copy (reversed) so the lining shows from below / through the front vent
    inner = bmesh.ops.duplicate(bm, geom=outer)['geom']
    ifaces = [g for g in inner if isinstance(g, bmesh.types.BMFace)]
    for v in [g for g in inner if isinstance(g, bmesh.types.BMVert)]:
        d = Vector((v.co.x, v.co.y - cy, 0)); v.co -= d.normalized() * 0.004 if d.length > 1e-6 else Vector()
    for f in ifaces:
        f.normal_flip()
    o = geo.obj_from_bm(name, bm, mat, recalc=False)
    for b in ('pelvis', 'thigh_l', 'thigh_r'):
        o.vertex_groups.new(name=b)
    zs = [v.co.z for v in o.data.vertices]
    for v in o.data.vertices:
        t = max(0.0, min(1.0, (z_top - v.co.z) / max(0.01, z_top - z_hem)))
        x = v.co.x / max(0.02, math.hypot(v.co.x, v.co.y - cy))
        wl = max(0.0, min(1.0, (x + 0.35) / 0.7)); wl = wl * wl * (3 - 2 * wl)
        fr = max(0.0, -(v.co.y - cy) / max(0.02, math.hypot(v.co.x, v.co.y - cy)))   # 1 = front centre
        leg = min(0.97, (sway + 0.3 * fr) * t ** 0.7)   # the front follows the thighs harder (knees must not poke through)
        o.vertex_groups['pelvis'].add([v.index], max(1e-3, 1 - leg), 'REPLACE')
        if leg * wl > 1e-3:
            o.vertex_groups['thigh_l'].add([v.index], leg * wl, 'REPLACE')
        if leg * (1 - wl) > 1e-3:
            o.vertex_groups['thigh_r'].add([v.index], leg * (1 - wl), 'REPLACE')
    geo.bind_rig(o, ctx.rig)
    o['garment'] = 'skirt'
    log(f'skirt {name}: {tri_count(o)} tris, z {z_top:.2f}->{z_hem:.2f}')
    return o


def build_outfit(ctx, name, opts):
    C = outfits.C
    c = lambda k, d: U.lin(opts.get(k, C[d] if isinstance(d, str) else d))
    L = []
    L_ = U.levels(ctx)
    if name in ('greatcoat', 'general_coat'):
        gen = name == 'general_coat'
        if gen:
            L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('breeches', c('trousers', 'stone_grey'), kind='wool'), bottom='riding', style='breeches'))
            L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', c('boots', 'black_leather'), rough=0.22), style='riding'))
            cm = MT.leather('coat_leather', c('coat', (0.40, 0.41, 0.39)), rough=0.42)
        else:
            L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('trousers', c('trousers', 'stone_grey'), kind='wool'), bottom='boot'))
            L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', c('boots', 'black_leather'), rough=0.38), style='jack'))
            cm = MT.fabric('coat', c('coat', 'feldgrau_m40'), kind='wool', rough=0.95)
        coat = U.top(ctx, 'outfit_coat', cm, hem='hip', sleeves='long', collar='stand', ease=0.026, flare=0.03, flare_frac=0.10, skirt_ease=0.02, target=2000)
        L.append(coat)
        hem = L_['knee_z'] - (0.12 if gen else 0.2) * ctx.m['height'] / 1.8
        L.append(skirt(ctx, 'outfit_coatskirt', cm, coat, L_['hip_z'] + 0.02, hem, flare_frac=0.12, ease=0.045, sway=0.65))
    elif name == 'winter_smock':   # white smock over field grey: smock body + closed skirt to mid-thigh (tunic hidden -> omitted)
        L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('trousers', c('trousers', 'feldgrau_m40'), kind='wool', rough=0.9), bottom='boot'))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', c('boots', 'black_leather'), rough=0.38), style='jack'))
        sm = MT.fabric('smock', c('smock', 'snow_white'), kind='canvas', rough=0.95, dirt=0.25)
        top = U.top(ctx, 'outfit_tunic', sm, hem='hip', sleeves='long', collar='hood', ease=0.024, flare=0.03)
        L.append(top)
        L.append(skirt(ctx, 'outfit_smockskirt', sm, top, L_['hip_z'] + 0.02, L_['thigh_z'] - 0.03, flare_frac=0.08, ease=0.02, sway=0.8))
    elif name == 'officer_heer':
        L.append(U.top(ctx, 'outfit_shirt', MT.fabric('shirt', c('shirt', (0.60, 0.60, 0.54)), kind='canvas', rough=0.8), hem='waist', sleeves='none', collar='stand', ease=0.005))
        L.append(top_v(ctx, 'outfit_tunic', MT.fabric('tunic', c('tunic', 'officer_grey'), kind='wool', rough=0.8), hem='hip', sleeves='long', collar='none', open_v=True))
        L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('breeches', c('trousers', 'stone_grey'), kind='wool'), bottom='riding', style='breeches'))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', c('boots', 'black_leather'), rough=0.28), style='riding'))
    elif name == 'panzer':   # black wrap jacket to the waist + high-waisted black trousers (no skin gap) + ankle boots
        blk = c('tunic', 'panzer_black')
        L.append(U.top(ctx, 'outfit_tunic', MT.fabric('tunic', blk, kind='wool', rough=0.9), hem='waist', sleeves='long', collar='stand', ease=0.016))
        L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('trousers', c('trousers', 'panzer_black'), kind='wool', rough=0.9), bottom='ankle', top_z=ctx.m['belt_z'] + 0.05))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', c('boots', 'black_leather')), style='ankle'))
    else:
        raise ValueError(name)
    return L
