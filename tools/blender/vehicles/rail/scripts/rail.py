"""rail.py - SHADOW SIX railway layer on top of veh.py (kit + vehicle metadata).
Convention: Blender Z up, metres; ORIGIN = TOP OF RAIL at the vehicle centre (z=0 is the rail head), front faces -Y
(= glTF +Z = game south at rot 0). Standard gauge 1.435 m (mine railway 0.6 m). Every wheelset is its own node
(spins about local X); coupling faces carry 'coupler_front' / 'coupler_rear' sockets so the game can chain a train.
Weathering (COLOR_0): brake dust (rusty brown) low on wheels/frames, soot + ash on tops (steam), dust, snow, burnt.
"""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import box, beam, cyl, V
import bmesh, bpy
from mathutils import Matrix
import kit_core as C

PAL = {}
WHITEWASH = set()      # palette keys whitewashed in the winter variant (military equipment only)
WOODY = set()          # palette keys that are painted boards (wood_paint texture)
SHEEN = set()          # palette keys with an oily / worn-gloss finish (distinct material, lower roughness in post_rail)
SHEEN_TINT = (0.992, 0.992, 0.992)                  # marker tint -> material 'kit:veh_paint~fcfcfc'
HEAT = set()           # burnt variant: palette keys that get the heat-discoloured steel set (SWAP 'veh_burnt~fbfbfb' -> heat)
HEAT_TINT = (0.988, 0.988, 0.988)
# HANDEDNESS: Blender -Y = vehicle front (glTF +Z), so Blender/glTF +X = vehicle LEFT, -X = vehicle RIGHT.
SOOTY = [0.0]          # 0..1 extra soot on up-facing faces (steam locos)
DUST_LOW = [None]      # optional light dust (sRGB multiplier) rising up the lower walls of dark-painted stock
GAUGE = [1.435]
RIVETED = set()        # palette keys built on riveted plate (carrier material air_skin -> rivet textures in post_rail)
SWAP = {}              # GLB material prefix -> rail lib texture set ('rivet', 'k5camo', 'k5ww'), applied in post_rail
CARRIER_TILE = {'veh_paint': 1.5, 'air_skin': 1.5, 'limewash_worn': 2.5, 'veh_burnt': 2.0}
SET_TILE = {'heat': 3.0}                            # tile (m) of lib sets other than the 6 m riveted-plate family
SET_MAPS = {'heat': ('heat_nor', 'heat_arm')}
RIVET_TILE = 6.0
RAIL_HALF = lambda: GAUGE[0] / 2 + 0.035          # rail head centre (gauge is measured between the inner head edges)

# Deutsche Reichsbahn colours (as seen, weathered)
DR = {'black': (34, 33, 32), 'red': (150, 36, 28), 'smokebox': (44, 44, 43), 'brown': (92, 50, 38), 'green': (46, 60, 48),
      'roof': (70, 68, 64), 'frame': (30, 29, 28), 'grey': (58, 60, 59), 'dark': (36, 36, 36), 'buffer': (40, 40, 40)}
BRAKE = V((0.34, 0.20, 0.12))       # brake-block dust (iron oxide)
ASH = V((0.17, 0.165, 0.16))


def setup(name, variant, pal, seed=7, gauge=1.435, sooty=0.0, woody=()):
    a = VH.setup(name, variant, seed=seed)
    PAL.clear()
    PAL.update(pal)
    WOODY.clear()
    SHEEN.clear()
    HEAT.clear()
    WHITEWASH.clear()
    RIVETED.clear()
    SWAP.clear()
    WOODY.update(woody)
    SOOTY[0] = sooty
    DUST_LOW[0] = None
    GAUGE[0] = gauge
    C.grime_color = grime_rail
    a.grime_heights = [0.6, 1.5]
    VH.GROUND_Z = -0.45
    return a


def base():
    return VH.paint_base()


def _n(p, s):
    return VH._n(p, s)


def _lin(c):
    """The palette tints and weathering targets are sRGB-space multipliers of the (sRGB) texture mean; COLOR_0
    multiplies in linear space, so convert - otherwise mid/dark paints render ~2x too light (grey tank read as silver)."""
    return V((max(0.0, c.x) ** 2.2, max(0.0, c.y) ** 2.2, max(0.0, c.z) ** 2.2))


def grime_rail(p, n, amt=1.0, tint=(1, 1, 1)):
    return _lin(_grime_rail(p, n, amt, tint))


def _grime_rail(p, n, amt=1.0, tint=(1, 1, 1)):
    c = V(tint)
    if amt <= 0:
        return c
    b = base()
    z = p.z
    side = 1 - abs(n.z)
    top = max(0.0, n.z - 0.3) / 0.7
    # brake dust + track grime: strongest around wheel height, fading by 1.4 m
    k = max(0.0, 1 - z / 1.4) ** 1.3 * (0.35 + 0.8 * _n(p, 2.7)) * 0.75 * amt
    if n.z < -0.3:
        k += 0.3 * amt
    c = c.lerp(BRAKE if b != 'burnt' else V((0.08, 0.07, 0.06)), min(0.8, k))
    # body weathering gradient: road dirt / brake dust haze rising up the sides, strongest at the solebar
    if b not in ('winter', 'burnt') and 0.9 < z < 2.8:
        g = max(0.0, 1 - (z - 0.9) / 1.9) ** 1.6 * side * amt
        c = c.lerp(V((0.30, 0.25, 0.20)), min(0.4, 0.45 * g * (0.6 + 0.6 * _n(p, 1.3))))
        if DUST_LOW[0] is not None:                             # light ballast/road dust on dark paint (K5)
            c = c.lerp(DUST_LOW[0], min(0.55, 0.7 * g * (0.5 + 0.8 * _n(p + V((1.7, 0, 0)), 0.9))))
    # run-off streaks down the sides
    st = max(0.0, _n(V((p.x * 1.5, p.y * 7, p.z * 0.35)), 1.0) - 0.55) * 1.6
    c = c.lerp(V((0.30, 0.25, 0.20)), min(0.45, st * side * amt * 0.7))
    if SOOTY[0] > 0 and b not in ('winter',):
        c = c.lerp(ASH, min(0.45, top * SOOTY[0] * amt * (0.3 + 0.7 * _n(p, 1.9))))
    if b == 'winter':
        c = c.lerp(V((1.0, 1.0, 1.0)), min(0.9, top ** 1.2 * amt * (0.5 + 0.7 * _n(p, 2.0))))
        c = c.lerp(V((0.9, 0.92, 0.95)), side * max(0.0, _n(p, 4.0) - 0.6) * 0.8 * amt)        # rime
    elif b == 'burnt':
        soot = V((0.03, 0.028, 0.026))
        c = c.lerp(soot, min(1.0, (0.3 + 0.6 * _n(p, 1.3) + 0.3 * top) * amt) * 0.6)
        c = c.lerp(V((0.5, 0.48, 0.45)), max(0.0, _n(p, 5.0) - 0.62) * 1.5 * top)
    elif b == 'dak':
        c = c.lerp(V((0.95, 0.83, 0.62)), min(0.6, top * 0.6 * amt * (0.35 + 0.9 * _n(p, 3.2))))
    else:
        c = c.lerp(V((0.70, 0.65, 0.56)), min(0.3, top * 0.3 * amt * (0.3 + _n(p, 3.2))))           # dust on tops
    c *= 0.9 + 0.16 * _n(p, 0.8)
    return V((min(c.x, 1.0), min(c.y, 1.0), min(c.z, 1.0)))


TEX = {'planks': ('deck_planks', (0.86, 0.84, 0.8)), 'wood': ('timber_grey', (0.85, 0.8, 0.74)),
       'boards': ('boards_weathered', (0.9, 0.88, 0.84)), 'tarred': ('timber_tarred', None), 'sleeper': ('timber_creosote', None),
       'canvas': ('tent_canvas', (0.62, 0.64, 0.56)), 'tarp': ('canvas', (0.42, 0.44, 0.36)), 'rope': ('hessian', (0.85, 0.78, 0.62)),
       'metal': ('cast_iron', None), 'rust': ('corrugated_rust', None), 'galv': ('steel_galv', None),
       'felt': ('bitumen_felt', (0.52, 0.51, 0.5)), 'ice': ('snow_soft', (0.86, 0.9, 0.96)), 'snowcap': ('snow_soft', None), 'coal': ('gravel_grey', (0.085, 0.085, 0.09)), 'sand': ('sand', None)}


def rp_(bm, key, name=None, node='main', pivot=None, uv='aligned', grime=None, smooth=False, lod=None, axis=None,
        rot90=False, uv_scale=1.0, jitter=0.03, bisect=True):
    """Rail part. key = palette key (painted steel, or painted boards when in WOODY), a TEX kind, or a veh FLAT kind."""
    b = base()
    if key in TEX:
        mid, t = TEX[key]
        if b == 'burnt' and key in ('planks', 'wood', 'boards', 'canvas', 'tarp', 'rope'):
            mid, t = 'timber_creosote', (0.36, 0.33, 0.30)
        if b == 'winter' and key in ('tarp', 'canvas'):
            t = (0.7, 0.72, 0.7)
        ob = C.part(bm, mid, name, uv=uv, node=node, grime=grime, smooth=smooth, lod=lod, mat_tint=t, axis=axis,
                    rot90=rot90, uv_scale=uv_scale, jitter=jitter, bisect=bisect)
    elif key in PAL:
        rgb = PAL[key]
        if b == 'burnt' and not key.startswith('keep'):
            mid, vc = 'veh_burnt', (0.8, 0.8, 0.8)
        elif b == 'winter' and key in WHITEWASH:
            mid, vc = 'limewash_worn', (0.95, 0.95, 0.93)
        else:
            mid = 'wood_paint' if key in WOODY else ('air_skin' if key in RIVETED else 'veh_paint')
            vc = tuple(min(1.0, rgb[i] / 255.0 / C.MATS[mid]['mean'][i]) for i in range(3))
        mt = SHEEN_TINT if (key in SHEEN and mid == 'veh_paint') else (HEAT_TINT if (key in HEAT and mid == 'veh_burnt') else None)
        ob = C.part(bm, mid, name, uv=uv, node=node, grime=grime, smooth=smooth, lod=lod, axis=axis, rot90=rot90,
                    uv_scale=uv_scale, jitter=jitter, tint=vc, bisect=bisect, mat_tint=mt)
    else:
        return VH.vp(bm, key, name, node=node, pivot=pivot, uv=uv, grime=grime, smooth=smooth, lod=lod)
    if pivot is not None:
        ob['kit_pivot'] = list(pivot)
    return ob


def RP(key, builder, *a, **kw):
    pkw = {k: kw.pop(k) for k in list(kw) if k in ('name', 'node', 'pivot', 'uv', 'grime', 'smooth', 'lod', 'axis', 'rot90', 'uv_scale', 'bisect')}
    bm = bmesh.new()
    builder(bm, *a, **kw)
    return rp_(bm, key, **pkw)


def run(main, allv):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else allv[0]).split(',')
    for v in (allv if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))


# ------------------------------------------------------------------ running gear
def lathe_bm(bm, c, prof, segs=20, side=1, closed=True, a0=0.0, a1=None):
    """Revolve a profile [(x_off, r), ...] around the X axis through c. x_off is measured outward (multiplied by side).
    closed = full revolution; else arc from a0 to a1 (radians, 0 = -Y front, pi/2 = up)."""
    c = V(c)
    full = a1 is None
    n = segs if full else segs + 1
    rings = []
    for i in range(n):
        t = a0 + (2 * math.pi if full else (a1 - a0)) * i / segs
        d = V((0, -math.cos(t), math.sin(t)))
        rings.append([bm.verts.new(c + V((side * x, 0, 0)) + d * r) for x, r in prof])
    m = len(prof)
    for i in range(n if full else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(m - 1 + (1 if closed else 0)):
            j = (k + 1) % m
            try:
                bm.faces.new((a[k], a[j], b[j], b[k]))
            except ValueError:
                pass
    return rings


def wheel_bm(bm, c, r, side, style='disc', spokes=12, segs=20, flange=0.03, tread=0.135, cw=0.0, crank_a=0.0, hub=0.12):
    """Railway wheel at c (centre on the axle), tread radius r, flange on the inner side (toward x=0).
    style 'disc' (pressed web) | 'spoked' (spokes + optional counterweight cw = angular span deg, opposite crank_a)."""
    s = side
    hub = min(hub, r * 0.3)
    fl = r + flange
    rim_in = r - min(0.055, 0.22 * r) - r * 0.02          # small (600 mm gauge) wheels: thinner tyre, open spokes
    # profile from the inner face (x_off negative = toward the track centre) around the tyre to the outer face
    if style == 'simple':                                  # low-poly wheel (outside-frame trucks): tyre, dished web, hub
        prof = [(-0.045, rim_in), (-0.045, fl), (-0.012, r + 0.004), (tread - 0.03, r), (tread - 0.03, rim_in),
                (0.0, rim_in * 0.8), (0.03, hub * 1.4), (0.08, hub)]
        lathe_bm(bm, c, [(x + tread / 2 - 0.02, rr) for x, rr in prof], segs, s, closed=False)
        return
    if style == 'disc':
        prof = [(-0.015, hub), (-0.03, rim_in), (-0.045, rim_in), (-0.045, fl - 0.008), (-0.03, fl), (-0.012, r + 0.004),
                (tread - 0.03, r), (tread - 0.03, rim_in), (0.03, rim_in * 0.92), (0.05, hub + 0.02), (0.07, hub * 0.7)]
        lathe_bm(bm, c, [(x + tread / 2 - 0.02, rr) for x, rr in prof], segs, s, closed=False)
        C.cyl_bm(bm, V(c) + V((s * (tread / 2 + 0.04), 0, 0)), V(c) + V((s * (tread / 2 + 0.11), 0, 0)), hub * 0.6, 8)
        return
    prof = [(-0.045, rim_in), (-0.045, fl), (-0.012, r + 0.004), (tread - 0.03, r), (tread - 0.03, rim_in)]
    lathe_bm(bm, c, [(x + tread / 2 - 0.02, rr) for x, rr in prof], segs, s, closed=True)
    xs = s * (tread / 2 - 0.02 + 0.03)                     # spoke plane
    cc = V(c) + V((xs, 0, 0))
    C.cyl_bm(bm, V(c) + V((s * (tread / 2 - 0.08), 0, 0)), V(c) + V((s * (tread / 2 + 0.1), 0, 0)), hub, 8)
    for k in range(spokes):
        t = 2 * math.pi * k / spokes
        d = V((0, -math.cos(t), math.sin(t)))
        e = V((0, math.sin(t), math.cos(t)))                   # tangential: tapered 4-sided spoke, no end caps
        w0, w1, th = (0.06 * max(r, 0.6), 0.04 * max(r, 0.6), 0.025) if r >= 0.35 else (0.1 * r, 0.07 * r, 0.015)
        a0, a1 = cc + d * (hub * 0.9), cc + d * (rim_in + 0.01)
        q = [bm.verts.new(a0 + e * w0 + V((th, 0, 0))), bm.verts.new(a0 - e * w0 + V((th, 0, 0))),
             bm.verts.new(a0 - e * w0 - V((th, 0, 0))), bm.verts.new(a0 + e * w0 - V((th, 0, 0)))]
        q2 = [bm.verts.new(a1 + e * w1 + V((th, 0, 0))), bm.verts.new(a1 - e * w1 + V((th, 0, 0))),
              bm.verts.new(a1 - e * w1 - V((th, 0, 0))), bm.verts.new(a1 + e * w1 - V((th, 0, 0)))]
        for i in range(4):
            bm.faces.new((q2[i], q2[(i + 1) % 4], q[(i + 1) % 4], q[i]))
    if cw > 0:                                             # counterweight crescent opposite the crank
        ca = crank_a + math.pi
        h = math.radians(cw) / 2
        n = 6
        outer = [ca - h + 2 * h * i / n for i in range(n + 1)]
        pts = [cc + V((0, -math.cos(t), math.sin(t))) * (rim_in + 0.005) for t in outer]
        inner = [cc + V((0, -math.cos(t), math.sin(t))) * (rim_in * 0.45) for t in reversed(outer)]
        ring = pts + inner
        a = [bm.verts.new(p + V((s * 0.035, 0, 0))) for p in ring]
        b = [bm.verts.new(p - V((s * 0.035, 0, 0))) for p in ring]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            bm.faces.new((a[i], b[i], b[j], a[j]))


def wheelset(node, y, r, style='disc', spokes=12, segs=20, cw=0.0, crank=None, key='wheel', axle_key='dark',
             contact=True, parent=None, zc=None, width=None):
    """Two wheels + axle as one spinning node (pivot = axle centre, axis X). crank = (radius, angle_rad) adds crankpins
    on both sides (right leads left by 90 deg, German practice). Returns axle centre."""
    zc = r if zc is None else zc
    g = GAUGE[0]
    x0 = g / 2 + 0.0675 * (g / 1.435)                     # wheel tread centre
    ctr = V((0, y, zc))
    for s in (-1, 1):
        ca = 0.0 if crank is None else crank[1] + (math.pi / 2 if s < 0 else 0.0)
        RP(key, wheel_bm, ctr + V((s * x0, 0, 0)), r, s, style, spokes, segs, cw=cw, crank_a=ca, name=node + '_wheel',
           node=node, pivot=tuple(ctr), bisect=False, smooth=True)
        if crank:
            cp = ctr + V((s * (x0 + 0.13), 0, 0)) + V((0, -math.cos(ca), math.sin(ca))) * crank[0]
            RP('dark', cyl, cp - V((s * 0.02, 0, 0)), cp + V((s * 0.12, 0, 0)), 0.065, 8, name=node + '_crankpin', node=node,
               pivot=tuple(ctr), bisect=False)
        if contact:
            VH.contact('%s_%s' % (node, 'r' if s < 0 else 'l'), (s * RAIL_HALF(), y, 0.0), node=None, width=0.07)   # +X = vehicle left
    RP(axle_key, cyl, ctr - V((x0 + 0.02, 0, 0)), ctr + V((x0 + 0.02, 0, 0)), 0.08 * max(0.5, r), 8, name=node + '_axle',
       node=node, pivot=tuple(ctr), bisect=False, lod='drop')
    VH.moving(node, 'wheel', ctr, (1, 0, 0), radius=round(r, 3), parent=parent,
              note='spin = distance / radius; rails: no steering')
    return ctr


def axlebox(y, zc, x, key='frame', spring=True, span=1.1, z_top=None, guard=True):
    """Axlebox, W-iron axle guard and a leaf spring (hung from the solebar) outside the wheel at +/-x."""
    for s in (-1, 1):
        xx = s * x
        RP(key, VH.bevel_box, (xx, y, zc + 0.02), (0.2, 0.26, 0.3), r=0.025, name='axlebox', bisect=False)
        RP('dark', cyl, (xx + s * 0.1, y, zc), (xx + s * 0.13, y, zc), 0.08, 8, name='axlebox_cap', bisect=False, lod='drop')
        if guard:
            for dy in (-0.2, 0.2):
                RP(key, beam, (xx, y + dy * 1.4, (z_top or zc + 0.55)), (xx, y + dy, zc - 0.18), 0.05, 0.02, name='axleguard', bisect=False)
            RP(key, beam, (xx, y - 0.22, zc - 0.2), (xx, y + 0.22, zc - 0.2), 0.05, 0.03, name='axleguard_tie', bisect=False, lod='drop')
        if spring:
            zs = zc + 0.2
            bm = bmesh.new()
            for k in range(6):                               # leaf stack: shorter leaves toward the bottom
                L = span * (1 - k * 0.13)
                zz = zs + 0.02 + k * 0.022 - 0.0 * k
                sag = 0.07 * (1 - k * 0.1)
                pts = [V((xx, y - L / 2 + L * i / 6, zz + sag * (2 * i / 6 - 1) ** 2)) for i in range(7)]
                for a, b in zip(pts[:-1], pts[1:]):
                    C.beam_bm(bm, a, b, 0.09, 0.018)
            rp_(bm, 'dark', 'leaf_spring', bisect=False)
            RP('dark', box, (xx, y, zs + 0.05), (0.11, 0.1, 0.16), name='spring_buckle', bisect=False)
            for dy in (-span / 2, span / 2):                   # spring shackles to the solebar
                RP('dark', beam, (xx, y + dy, zs + 0.09), (xx, y + dy * 1.06, (z_top or zs + 0.35)), 0.03, 0.03, name='shackle', bisect=False, lod='drop')


def buffer(x, y, z=1.06, facing=-1, head_r=0.19, length=0.62, key='buffer'):
    """Side buffer (Hülsenpuffer): base plate, casing, plunger and round head; facing -1 = front (-Y)."""
    f = facing
    RP(key, box, (x, y + f * 0.02, z), (0.42, 0.04, 0.42), name='buffer_plate', bisect=False)
    RP(key, cyl, (x, y + f * 0.03, z), (x, y + f * length * 0.55, z), 0.1, 10, r1=0.085, name='buffer_casing', bisect=False)
    RP('metal', cyl, (x, y + f * length * 0.55, z), (x, y + f * (length - 0.05), z), 0.06, 8, name='buffer_plunger', bisect=False)
    RP('metal', cyl, (x, y + f * (length - 0.05), z), (x, y + f * length, z), head_r, 14, name='buffer_head', bisect=False)


def coupling(y, z=1.06, facing=-1, key='dark'):
    """Draw hook + screw coupling hanging on it + two brake hoses; returns the coupling point (socket)."""
    f = facing
    RP(key, beam, (0, y, z), (0, y + f * 0.34, z), 0.1, 0.07, name='draw_hook', bisect=False)
    RP(key, beam, (0, y + f * 0.34, z), (0, y + f * 0.4, z + 0.08), 0.07, 0.05, name='hook_tip', bisect=False, lod='drop')
    for sx in (-0.07, 0.07):
        RP(key, beam, (sx, y + f * 0.3, z - 0.02), (sx, y + f * 0.45, z - 0.45), 0.03, 0.03, name='screw_link', bisect=False, lod='drop')
    RP(key, cyl, (-0.12, y + f * 0.43, z - 0.3), (0.12, y + f * 0.43, z - 0.3), 0.03, 6, name='coupling_screw', bisect=False, lod='drop')
    for sx in (-0.38, 0.38):
        bm = bmesh.new()
        pts = [V((sx, y + f * 0.02, z - 0.1)), V((sx, y + f * 0.22, z - 0.2)), V((sx * 1.1, y + f * 0.3, z - 0.42)), V((sx * 1.15, y + f * 0.25, z - 0.62))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.025, 6)
        rp_(bm, 'rubber', 'brake_hose', lod='drop', bisect=False)
    return (0, y + f * 0.62, z)


def headstock(y, z=1.06, w=2.9, h=0.32, facing=-1, key='frame', buffers=True, bx=0.875, blen=0.62):
    """Buffer beam across the frame end + buffers + coupling + sockets; returns buffer-face y."""
    RP(key, box, (0, y + facing * 0.08, z), (w, 0.16, h), name='headstock', bisect=False)
    if buffers:
        for s in (-1, 1):
            buffer(s * bx, y + facing * 0.16, z, facing, length=blen)
    cp = coupling(y + facing * 0.16, z, facing)
    yf = y + facing * (0.16 + blen)
    VH.socket('coupler_' + ('front' if facing < 0 else 'rear'), (0, yf, z), (0, facing, 0), note='buffer face; chain vehicles buffer-to-buffer')
    return yf


def solebars(y0, y1, x, z_top, depth=0.3, key='frame'):
    """U-channel solebars both sides (flanges facing out) from y0 to y1."""
    for s in (-1, 1):
        RP(key, box, (s * x, (y0 + y1) / 2, z_top - depth / 2), (0.02, y1 - y0, depth), name='solebar', bisect=False)
        for dz in (0.0, -depth):
            RP(key, box, (s * (x + 0.04), (y0 + y1) / 2, z_top + dz - (0.01 if dz == 0 else -0.01)), (0.09, y1 - y0, 0.02), name='solebar_flange', bisect=False)


def brake_blocks(y, zc, r, x, key='dark'):
    for s in (-1, 1):
        for f in (-1, 1):
            a = math.radians(18)
            p = V((s * x, y + f * (r + 0.05) * math.cos(a), zc + (r + 0.05) * math.sin(a) * 0.3))
            RP(key, box, tuple(p), (0.09, 0.08, 0.34), name='brake_block', bisect=False, lod='drop')


def handrail(pts, r=0.016, key='dark', stanchions=True, lod='drop'):
    bm = bmesh.new()
    P = [V(p) for p in pts]
    for a, b in zip(P[:-1], P[1:]):
        C.cyl_bm(bm, a, b, r, 6)
    rp_(bm, key, 'handrail', bisect=False, lod=lod)


def step(x, y, z, w=0.4, d=0.22, key='frame', hang=0.3):
    """Stirrup step hanging from the solebar at z (tread z - hang)."""
    s = 1 if x > 0 else -1
    RP(key, box, (x, y, z - hang), (d, w, 0.03), name='step_tread', bisect=False)
    for dy in (-w / 2, w / 2):
        RP(key, beam, (x - s * 0.08, y + dy, z), (x, y + dy, z - hang), 0.04, 0.02, name='step_hanger', bisect=False, lod='drop')


def lamp(p, direction=(0, -1, 0), name='lamp', key='dark', node='main', lit=True, r=0.13):
    """DR electric headlamp: drum body with rear dome, vented top cap, carrying handle, foot bracket, rim, and the
    wartime blackout cover (Tarnkappe): a steel cap over the lens leaving a narrow horizontal slit under a visor."""
    p, d = V(p), V(direction).normalized()
    u = V((0, 0, 1))
    sd = d.cross(u).normalized()
    kw = dict(node=node, bisect=False)
    RP(key, cyl, p - d * 0.12, p + d * 0.1, r, 12, caps=False, name=name + '_body', smooth=True, **kw)
    RP(key, cyl, p - d * 0.12, p - d * 0.2, r * 0.9, 12, r1=r * 0.35, name=name + '_back', smooth=True, **kw)
    RP(key, cyl, p + u * (r - 0.01), p + u * (r + 0.06), 0.045, 6, caps=False, name=name + '_vent', lod='drop', **kw)
    RP(key, cyl, p + u * (r + 0.06), p + u * (r + 0.08), 0.07, 6, name=name + '_vent_cap', lod='drop', **kw)
    bm = bmesh.new()
    hp = [p - d * 0.06 + sd * 0.09 + u * r, p - d * 0.06 + sd * 0.09 + u * (r + 0.1), p - d * 0.06 - sd * 0.09 + u * (r + 0.1), p - d * 0.06 - sd * 0.09 + u * r]
    for a, b in zip(hp[:-1], hp[1:]):
        C.cyl_bm(bm, a, b, 0.012, 5)
    rp_(bm, key, name + '_handle', lod='drop', **kw)
    RP(key, beam, p - u * r, p - u * (r + 0.12), 0.08, 0.05, name=name + '_bracket', **kw)
    RP(key, cyl, p + d * 0.1, p + d * 0.13, r + 0.005, 12, name=name + '_blackout_cover', **kw)
    RP('lens', box, tuple(p + d * 0.135 - u * 0.02), (abs(sd.x) * 0.17 + abs(d.x) * 0.01 + 0.005, abs(sd.y) * 0.17 + abs(d.y) * 0.01 + 0.005, 0.022),
       name=name + '_slit', lod='drop', **kw)
    RP(key, beam, p + d * 0.13 - u * 0.0 + sd * 0.1, p + d * 0.13 - sd * 0.1, 0.07, 0.012, up=d, name=name + '_slit_visor', lod='drop', **kw)
    VH.light(name, p + d * 0.14, direction, True, kind='headlight', node=None if node == 'main' else node)


def bogie(node, y, wb, r, zc=None, frame_w=None, key='frame', wkey='wheel', style='disc', axles=2, parent=None, spring=True):
    """Plate-frame bogie (tender / Goerlitz type): side frames with a dipped lower chord and lightening holes (built
    as chords + posts, so they read open), axleboxes with hinged lids + bolts, laminated springs over the boxes with
    hangers, brake blocks + hangers, bolster with side bearers and centre plate. node pivots about Z at the bogie
    centre; wheelsets are child nodes. Returns list of wheelset nodes."""
    zc = r if zc is None else zc
    g = GAUGE[0]
    fx = frame_w or (g / 2 + 0.28 * g / 1.435)
    kw = dict(node=node, pivot=(0, y, zc + 0.2))
    L = wb + 2 * r * 0.9
    ya = [y - wb / 2 + wb * k / max(1, axles - 1) for k in range(axles)]
    for s in (-1, 1):
        x = s * fx
        RP(key, box, (x, y, zc + 0.44), (0.05, L, 0.1), name='bogie_side', bisect=False, **kw)           # top chord
        RP(key, box, (x + s * 0.04, y, zc + 0.48), (0.1, L, 0.02), name='bogie_flange', bisect=False, lod='drop', **kw)
        bm = bmesh.new()                                                                                  # lower chord
        pts = [V((x, y - L / 2, zc + 0.36)), V((x, ya[0] + 0.35, zc + 0.02)), V((x, ya[-1] - 0.35, zc + 0.02)), V((x, y + L / 2, zc + 0.36))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.05, 0.1, up=V((1, 0, 0)))
        rp_(bm, key, 'bogie_side_low', bisect=False, **kw)
        for yy in ya:
            for dy in (-0.2, 0.2):                                                                        # horn cheeks
                RP(key, box, (x, yy + dy, zc + 0.2), (0.06, 0.07, 0.48), name='bogie_horn', bisect=False, **kw)
            RP(key, VH.bevel_box, (x + s * 0.06, yy, zc + 0.04), (0.18, 0.3, 0.3), r=0.025, name='axlebox', bisect=False, **kw)
            RP('dark', box, (x + s * 0.155, yy, zc + 0.04), (0.02, 0.22, 0.22), name='axlebox_lid', bisect=False, lod='drop', **kw)
            if spring:                                                                                    # laminated spring
                bm = bmesh.new()
                for k in range(4):
                    Ls = 0.8 * (1 - k * 0.16)
                    zz = zc + 0.56 + k * 0.024
                    q = [V((x + s * 0.02, yy - Ls / 2 + Ls * i / 4, zz + 0.05 * (2 * i / 4 - 1) ** 2)) for i in range(5)]
                    for a, b in zip(q[:-1], q[1:]):
                        C.beam_bm(bm, a, b, 0.09, 0.02)
                rp_(bm, 'dark', 'bogie_spring', bisect=False, **kw)
                for dy in (-0.4, 0.4):
                    RP('dark', beam, (x + s * 0.02, yy + dy, zc + 0.6), (x + s * 0.02, yy + dy, zc + 0.48), 0.03, 0.03, name='spring_hanger', bisect=False, lod='drop', **kw)
            for f in (-1, 1):                                                                             # brake blocks
                if abs(yy + f * (r + 0.06) - y) < abs(yy - y):
                    pb = V((s * (g / 2 + 0.07), yy + f * (r + 0.05) * 0.96, zc + 0.08))
                    RP('dark', box, tuple(pb), (0.1, 0.08, 0.32), name='brake_block', bisect=False, lod='drop', **kw)
                    RP('dark', beam, pb + V((0, 0, 0.16)), pb + V((0, f * 0.05, 0.42)), 0.03, 0.03, name='brake_hanger', bisect=False, lod='drop', **kw)
        for dy in (-0.33, 0.0, 0.33):                                                                     # lightening posts
            RP(key, box, (x, y + dy * wb / 1.8, zc + 0.3), (0.05, 0.08, 0.26), name='bogie_post', bisect=False, lod='drop', **kw)
        RP(key, box, (s * (fx - 0.25), y, zc + 0.56), (0.25, 0.3, 0.1), name='side_bearer', bisect=False, **kw)
    RP(key, box, (0, y, zc + 0.36), (2 * fx, 0.4, 0.2), name='bolster', bisect=False, **kw)
    RP('dark', cyl, (0, y, zc + 0.46), (0, y, zc + 0.52), 0.22, 12, name='centre_plate', bisect=False, **kw)
    for dy in (-wb / 2 - 0.1, wb / 2 + 0.1):
        RP(key, box, (0, y + dy * 0.98, zc + 0.3), (2 * fx, 0.08, 0.12), name='bogie_transom', bisect=False, lod='drop', **kw)
    VH.moving(node, 'bogie_yaw', (0, y, zc + 0.2), (0, 0, 1), limits=(-8, 8), parent=parent, note='yaw to follow track curvature')
    out = []
    for k in range(axles):
        n = '%s_ws%d' % (node, k)
        wheelset(n, ya[k], r, style, key=wkey, parent=node, zc=zc)
        out.append(n)
    return out


def finalize(out_root, key, vtype, dims, var, allv, real, extra=None, ao_res=1024, ao_dist=0.8,
             lods=((0.55, 0.06), (0.22, 0.3)), parents=None, frames=None, destroyed=None):
    ex = {'real_name': real, 'destroyed': var == 'burnt' if destroyed is None else destroyed, 'rotation_order': 'YXZ',
          'side': 'axis', 'origin': 'top of rail (y=0 = rail head) at the vehicle centre; front faces +Z',
          'gauge_m': GAUGE[0], 'rail_top_y': 0.0,
          'track_note': 'place on the track polyline with rail head at the anchor height (trestle train_path y=0.95)'}
    ex.update(extra or {})
    fast = bool(os.environ.get('RAIL_FAST'))
    if fast:                                                   # quick look: no AO bake, separate folder
        agg = {}
        for o in C.A.parts:
            if o.name in bpy.data.objects:
                k = o.name.split('.')[0]
                agg[k] = agg.get(k, 0) + sum(len(pp.vertices) - 2 for pp in o.data.polygons)
        print('TRIS_BY_PART', sum(agg.values()), sorted(agg.items(), key=lambda kv: -kv[1])[:70])
        out_root = os.path.join(os.path.dirname(os.path.abspath(out_root)), 'fast')
    outdir = os.path.join(out_root, key)
    nodes = {o.get('kit_node', 'main') for o in C.A.parts if o.name in bpy.data.objects}
    auto = {m['node']: m['parent'] for m in VH.VM['moving'] if m.get('parent') and m['parent'] in nodes and m['node'] in nodes}
    auto.update(parents or {})
    parents = auto
    meta = VH.vfinalize(outdir, vtype, dims, parents=parents, frames=frames, lods=lods, ao_res=ao_res, ao_dist=ao_dist,
                        variants=allv, extra=ex, skip_ao=fast)
    f = os.path.join(outdir, C.A.name + '.kit.json')
    m = json.load(open(f))
    import glbnames
    for lod in m['lods']:
        glbnames.fix(os.path.join(outdir, lod['file']), set(m['nodes']) | {'main'})
        post_rail(os.path.join(outdir, lod['file']))
    m['materials'] = [('rail:coal' if x.startswith('kit:gravel_grey') or x.startswith('gravel_grey') else x) for x in m['materials']]
    m['pivot'] = 'top of rail at the vehicle centre; model front faces +Z (game south at rot 0); wheelsets spin about local +X'
    g = GAUGE[0]
    m['review_track'] = {'gauge': g, 'ground': -0.45 if g > 1 else -0.2, 'sleeper_top': -0.17 if g > 1 else -0.08,
                         'sleeper_len': 2.6 if g > 1 else 1.1, 'sleeper_w': 0.26 if g > 1 else 0.16, 'sleeper_pitch': 0.65 if g > 1 else 0.7,
                         'rail_w': 0.07 if g > 1 else 0.045, 'ballast': 3.0 if g > 1 else 1.4,
                         'ballast_mat': 'gravel_grey'}
    json.dump(m, open(f, 'w'), indent=1)
    return m


RAIL_LIB = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))


def post_rail(p):
    """Rail material pass on an exported GLB (group textures in vehicles/rail/lib, relative URIs):
    - kit:veh_paint / kit:wood_paint -> matt weathered paint: roughnessFactor 1.6 / 1.25 + KHR specular 0.35 (no
      plastic sheen on DR black; the veh_paint ARM texture averages ~0.52)
    - kit:gravel_grey (coal key) -> rail:coal lump textures (coal_diff/nor/arm, procedural CC0, make_rail_tex.py),
      specular 0.5 so the near-black albedo is not washed grey by the sky reflection"""
    import glb_post
    js, bin_ = glb_post.read_glb(p)
    base = os.path.relpath(RAIL_LIB, os.path.dirname(os.path.abspath(p))).replace(os.sep, '/') + '/'
    js.setdefault('images', [])
    js.setdefault('textures', [])
    if not js.get('samplers'):
        js['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    idx = {}

    def tex(name):
        uri = base + name + '.jpg'
        if uri not in idx:
            js['images'].append({'uri': uri, 'name': name})
            js['textures'].append({'sampler': 0, 'source': len(js['images']) - 1})
            idx[uri] = len(js['textures']) - 1
        return idx[uri]
    ext = set(js.get('extensionsUsed', []))
    for mt in js.get('materials', []):
        nm = mt.get('name', '')
        pb = mt.setdefault('pbrMetallicRoughness', {})
        spec = None
        if nm.startswith('kit:veh_paint~fcfcfc'):              # SHEEN: oily boiler / worn gloss (reads as a value break)
            pb['roughnessFactor'] = 1.1
            spec = 0.45
        elif nm.startswith('kit:veh_paint'):
            pb['roughnessFactor'] = 1.6
            spec = 0.35
        elif nm.startswith('kit:wood_paint'):
            pb['roughnessFactor'] = 1.25
            spec = 0.4
        elif nm.startswith('kit:gravel_grey'):
            pb.update(baseColorTexture={'index': tex('coal_diff')}, metallicRoughnessTexture={'index': tex('coal_arm')},
                      baseColorFactor=[0.2, 0.2, 0.21, 1], metallicFactor=0.0, roughnessFactor=0.72)
            mt['normalTexture'] = {'index': tex('coal_nor'), 'scale': 1.0}
            mt['name'] = 'rail:coal'
            mt.setdefault('extras', {})['rail_tex'] = 'coal'
            spec = 0.5                                         # glossy facets glint; lower keeps the sky from greying the heap
        if nm == 'veh:glass':                                   # real glazing: see the dim interior through it
            pb.update(baseColorFactor=[0.012, 0.016, 0.018, 0.5], metallicFactor=0.0, roughnessFactor=0.06)
            mt['alphaMode'] = 'BLEND'
            mt['doubleSided'] = True
            mt.pop('occlusionTexture', None)
            spec = 1.0
        carrier = nm[4:].split('~')[0] if nm.startswith('kit:') else ''
        tset = SWAP.get(nm[4:]) or SWAP.get(carrier) or ('rivet' if carrier == 'air_skin' else None)
        if tset and carrier in CARRIER_TILE:
            sc = CARRIER_TILE[carrier] / SET_TILE.get(tset, RIVET_TILE)
            tt = {'KHR_texture_transform': {'scale': [sc, sc]}}
            nor, arm = SET_MAPS.get(tset, ('rivet_nor', 'rivet_arm'))
            pb.update(baseColorTexture={'index': tex(tset + '_diff'), 'extensions': tt},
                      metallicRoughnessTexture={'index': tex(arm), 'extensions': tt}, metallicFactor=0.0, roughnessFactor=1.3)
            if tset == 'heat':
                pb['baseColorFactor'] = [1.0, 1.0, 1.0, 1.0]
            mt['normalTexture'] = {'index': tex(nor), 'scale': 1.0, 'extensions': tt}
            mt['name'] = 'rail:' + tset
            mt.setdefault('extras', {})['rail_tex'] = tset
            ext.add('KHR_texture_transform')
            spec = 0.3
        if spec is not None:
            mt.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': spec}
            ext.add('KHR_materials_specular')
    if ext:
        js['extensionsUsed'] = sorted(ext)
    glb_post.write_glb(p, js, bin_)


def snow_cover(min_z=0.9, depth=0.03, cover=0.3, skip=('handrail', 'lens', 'wheel', 'axle', 'rod', 'hose', 'glass', 'lamp', 'wire', 'spoke', 'crank',
               'plug', 'band', 'stud', 'louvre', 'boss', 'bolt', 'clip', 'rivet', 'seam', 'lumps', 'pipe', 'hinge', 'hasp', 'strap', 'lettering', 'border', 'icicle',
               'snow', 'coal_load'), min_area=0.012):
    """Winter: lay snow slabs (library 'snow_soft') on the up-facing faces above the waterline, patchy by noise."""
    parts = list(C.A.parts)
    for o in parts:
        if o.name not in bpy.data.objects or any(s in o.name for s in skip):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        keep = [f for f in bm.faces if f.normal.z > 0.72 and f.calc_center_median().z > min_z and f.calc_area() > min_area
                and _n(f.calc_center_median(), 0.9 / 1.0) > cover]
        if not keep:
            bm.free()
            continue
        nb = bmesh.new()
        vm = {}
        for f in keep:
            vs = []
            for v in f.verts:
                if v.index not in vm:
                    vm[v.index] = nb.verts.new(v.co + V((0, 0, depth)))
                vs.append(vm[v.index])
            try:
                nb.faces.new(vs)
            except ValueError:
                pass
        bm.free()
        # thickness: extrude down the edges of the big slabs so they read as a layer from the 40 deg camera (small
        # slabs stay a single offset sheet - saves the side walls' triangles)
        if sum(f.calc_area() for f in nb.faces) > 0.35:
            r = bmesh.ops.extrude_face_region(nb, geom=nb.faces[:])
            for v in [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]:
                v.co.z -= depth * 1.2
        bmesh.ops.recalc_face_normals(nb, faces=nb.faces[:])
        ob = C.part(nb, 'snow_soft', o.name + '_snow', node=o.get('kit_node', 'main'), grime=0.0, jitter=0.02, bisect=False)
        if o.get('kit_pivot'):
            ob['kit_pivot'] = list(o['kit_pivot'])
        if o.get('kit_lod'):
            ob['kit_lod'] = o['kit_lod']


def two_axle_underframe(L_frame, wb, r=0.5, z_top=1.22, key='frame', wkey='wheel', brake=True, sx=None, blen=0.62,
                        hand_brake=True):
    """Standard 2-axle wagon underframe: solebars, headstocks + buffers + couplings, W-irons + leaf springs,
    wheelsets 'ws0' (front) / 'ws1', brake blocks, truss rods, steps. Returns (y_front_buffer, y_rear_buffer)."""
    x = sx or 0.98
    solebars(-L_frame / 2, L_frame / 2, x, z_top, 0.3, key)
    for y in (-L_frame / 2 * 0.5, 0.0, L_frame / 2 * 0.5):                 # cross members
        RP(key, box, (0, y, z_top - 0.15), (2 * x, 0.1, 0.22), name='crossmember', bisect=False, lod='drop')
    yf = headstock(-L_frame / 2, 1.06, 2 * x + 0.3, 0.32, -1, key, blen=blen)
    yr = headstock(L_frame / 2, 1.06, 2 * x + 0.3, 0.32, 1, key, blen=blen)
    for i, y in enumerate((-wb / 2, wb / 2)):
        wheelset('ws%d' % i, y, r, 'spoked', spokes=10, segs=16, key=wkey)
        axlebox(y, r, x + 0.02, key, spring=True, span=1.2, z_top=z_top - 0.3)
        if brake:
            brake_blocks(y, r, r, 0.72)
        VH.emitter('rail_dust', (0, y, 0.05), (0, 0, 1), note='dust/snow kicked up at speed')
    for s in (-1, 1):                                                   # queen-post truss rods under the solebars
        bm = bmesh.new()
        pts = [V((s * (x - 0.1), -wb / 2 + 0.7, z_top - 0.3)), V((s * (x - 0.1), -wb / 4, z_top - 0.62)),
               V((s * (x - 0.1), wb / 4, z_top - 0.62)), V((s * (x - 0.1), wb / 2 - 0.7, z_top - 0.3))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.018, 6)
        rp_(bm, key, 'truss_rod', lod='drop', bisect=False)
        for yy in (-L_frame / 2 + 0.35, L_frame / 2 - 0.35):
            step(s * (x + 0.06), yy, z_top - 0.3, 0.36, 0.2, key, 0.32)
    if brake:                                                           # brake cylinder + reservoir (Kunze-Knorr)
        RP(key, cyl, (-0.35, 0.3, z_top - 0.45), (-0.35, 0.8, z_top - 0.45), 0.17, 10, name='brake_cyl', bisect=False)
        RP(key, cyl, (0.35, -0.9, z_top - 0.42), (0.35, 0.1, z_top - 0.42), 0.2, 10, name='air_reservoir', bisect=False)
        RP('dark', cyl, (0, -L_frame / 2, z_top - 0.36), (0, L_frame / 2, z_top - 0.36), 0.025, 6, name='brake_pipe', bisect=False, lod='drop')
    if hand_brake:                                                      # handbrake wheel on the solebar end
        p = V((x + 0.12, L_frame / 2 - 0.9, z_top - 0.1))
        RP('dark', VH.ring_torus, p, 0.16, 0.012, (1, 0, 0), 12, 4, name='handbrake_wheel', bisect=False, lod='drop')
    return yf, yr


def label_block(p, normal, w, h, rows=3, key='white'):
    """Stencilled lettering suggestion (DR / wagon number / class) as thin bars on a surface (no real text)."""
    p, n = V(p), V(normal).normalized()
    u = n.cross(V((0, 0, 1))).normalized()
    bm = bmesh.new()
    r = C.rng()
    for k in range(rows):
        z = h / 2 - (k + 0.5) * h / rows
        x = -w / 2
        lw = w * (1.0 if k == 0 else (0.55 + 0.4 * r.random()))
        while x < -w / 2 + lw:
            cw = 0.04 + 0.08 * r.random()
            q = p + n * 0.006 + u * (x + cw / 2) + V((0, 0, z))
            hh = h / rows * 0.55
            C.quad(bm, [q - u * cw / 2 - V((0, 0, hh / 2)), q + u * cw / 2 - V((0, 0, hh / 2)), q + u * cw / 2 + V((0, 0, hh / 2)), q - u * cw / 2 + V((0, 0, hh / 2))])
            x += cw + 0.03 + (0.06 if r.random() < 0.18 else 0)
    for f in bm.faces:                                        # face the surface normal (single-sided materials)
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
    rp_(bm, key, 'lettering', lod='drop', bisect=False, grime=0.6)


def coal_heap(x0, x1, y0, y1, zfn, node='load', pivot=None, step=0.11, lumps=110, lump_r=(0.05, 0.28), name='coal_load',
              key='coal', seed=0):
    """Lump-coal load: fine smooth-shaded height grid (zfn(x, y, u, v) -> z; u, v in 0..1 across the load) with
    multi-octave lumpy noise, plus scattered irregular lumps (dropped at LOD1) on the surface. Material 'coal' ->
    rail:coal textures (post_rail). Returns the height function actually used (for placing lumps / snow)."""
    nx = max(4, int(round((x1 - x0) / step)))
    ny = max(4, int(round((y1 - y0) / step)))

    def h(x, y):
        u, v = (x - x0) / (x1 - x0), (y - y0) / (y1 - y0)
        z = zfn(x, y, u, v)
        edge = min(u, 1 - u, v, 1 - v)
        k = min(1.0, edge * 12)                                   # no noise on the rim (meets the walls cleanly)
        p = V((x, y, seed))
        z += k * (0.09 * (_n(p, 2.2) - 0.5) + 0.07 * (_n(p + V((3.3, 1.1, 0)), 6.5) - 0.5) + 0.035 * (_n(p, 15.0) - 0.5))
        return z
    bm = bmesh.new()
    g = [[bm.verts.new(V((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, 0))) for i in range(nx + 1)] for j in range(ny + 1)]
    for row in g:
        for v in row:
            v.co.z = h(v.co.x, v.co.y)
    for j in range(ny):
        for i in range(nx):
            a, b, c, d = g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]
            if (i + j) % 2:                                       # alternate diagonals: no diamond pattern
                bm.faces.new((a, b, c)); bm.faces.new((a, c, d))
            else:
                bm.faces.new((a, b, d)); bm.faces.new((b, c, d))
    kw = dict(node=node, bisect=False, uv='aligned')
    if pivot is not None:
        kw['pivot'] = pivot
    rp_(bm, key, name, smooth=False, lod='keep', **kw)       # faceted fine-coal surface (+ coal normal map)
    r = C.rng()
    bm = bmesh.new()
    for k in range(lumps):                                    # fractured lumps, varied size, partly sunk, inside the rim
        rr = lump_r[0] + (lump_r[1] - lump_r[0]) * r.random() ** 2.4
        mx, my = min(0.45 * (x1 - x0), rr * 1.3 + 0.03), min(0.45 * (y1 - y0), rr * 1.3 + 0.03)
        x = x0 + mx + (x1 - x0 - 2 * mx) * r.random()
        y = y0 + my + (y1 - y0 - 2 * my) * r.random()
        c = V((x, y, h(x, y) + rr * (0.05 - 0.3 * r.random())))
        lump_bm(bm, c, rr, r)
    rp_(bm, key, name + '_lumps', lod='drop', **kw)
    if base() == 'winter':
        snow_heap(x0 + 0.05, x1 - 0.05, y0 + 0.05, y1 - 0.05, h, step=max(0.12, min(0.3, (x1 - x0) / 8)), node=node,
                  pivot=pivot, name=name + '_snow')
    return h


def deform(match, fn, node=None):
    """Wreck damage: move the vertices of every part whose name contains one of `match` through fn(V) -> V
    (world coordinates; parts are built in world space)."""
    ms = (match,) if isinstance(match, str) else match
    for o in C.A.parts:
        if o.name not in bpy.data.objects or not any(m in o.name for m in ms):
            continue
        if node is not None and o.get('kit_node', 'main') != node:
            continue
        for v in o.data.vertices:
            v.co = fn(V(v.co))
        o.data.update()


def wreck_pose(T, unsprung=('ws', 'bissel', 'bogie', 'truck'), names=('axlebox', 'brake_block', 'brake_hanger')):
    """Burnt wreck left ON the track: slump/tilt only the sprung mass (T), the wheelsets (+ bogies/trucks and any part
    whose node starts with an `unsprung` prefix or whose name contains one of `names`) keep their treads on the rail
    heads, and the wheel contacts stay put. Metadata of the moved parts is transformed like VH.apply_T."""
    def uns(node, name=''):
        node = node or 'main'
        return any(node.startswith(u) for u in unsprung) or any(n in name for n in names)
    for o in C.A.parts:
        if o.name not in bpy.data.objects or uns(o.get('kit_node', 'main'), o.name):
            continue
        o.data.transform(T)
        if o.get('kit_pivot'):
            o['kit_pivot'] = list(T @ V(o['kit_pivot']))

    def tg(p):
        return VH.G(T @ V((p[0], -p[2], p[1])))
    for key in ('sockets', 'emitters', 'moving', 'lights'):
        for d in VH.VM[key]:
            if uns(d.get('node')) and d.get('node'):
                continue
            k = 'pivot' if 'pivot' in d else 'pos'
            d[k] = tg(d[k])
    VH.VM['_blender'] = [(n, tuple(T @ V(p)) if not (nd and uns(nd)) else p, nd) for n, p, nd in VH.VM.get('_blender', [])]
    VH.VM['wreck_pose'] = 'on the rails: sprung body slumped/tilted, wheelsets + bogies seated on the rail heads'


def lump_bm(bm, c, rr, r, flat=0.6):
    """One fractured coal lump: convex hull of 7-11 random points on a squashed, randomly rotated ellipsoid
    (3-8 visible facets, no box shape)."""
    n = 7 + int(r.random() * 5)
    rot = Matrix.Rotation(r.random() * 6.28, 3, 'Z') @ Matrix.Rotation((r.random() - 0.5) * 1.2, 3, 'X')
    ax = V((1.0 + 0.4 * r.random(), 0.7 + 0.4 * r.random(), flat * (0.7 + 0.5 * r.random())))
    vs = []
    for i in range(n):
        z = 2 * r.random() - 1
        a = r.random() * 6.2832
        q = math.sqrt(max(0.0, 1 - z * z))
        d = V((q * math.cos(a) * ax.x, q * math.sin(a) * ax.y, z * ax.z)) * (0.75 + 0.25 * r.random())
        vs.append(bm.verts.new(c + rot @ (d * rr)))
    res = bmesh.ops.convex_hull(bm, input=vs)
    for gg in res.get('geom_interior', []) + res.get('geom_unused', []):
        if isinstance(gg, bmesh.types.BMVert) and gg.is_valid:
            bm.verts.remove(gg)


def streak(p0, down, length, w0, key, name, n=3, bulge=None, node='main', lod='drop', out=None):
    """Tapered run-off streak (limescale / dust / rust) laid on a surface: starts w0 wide at p0 and narrows to a point
    `length` along `down` (a list of points may be given instead via bulge=callable(t)->V offset)."""
    bm = bmesh.new()
    down = V(down).normalized()
    side = down.cross(V((0, 0, 1))) if abs(down.z) < 0.99 else V((0, 1, 0))
    if side.length < 1e-4:
        side = V((0, 1, 0))
    side.normalize()
    rows = []
    for k in range(n + 1):
        t = k / n
        c = bulge(t) if bulge else p0 + down * (length * t)
        w = w0 * (1 - t) ** 0.8 * 0.5 + 0.002
        rows.append((bm.verts.new(c - side * w), bm.verts.new(c + side * w)))
    for a, b in zip(rows[:-1], rows[1:]):
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        f.normal_update()
        o = out(f.calc_center_median()) if callable(out) else (V(out) if out is not None else None)
        if o is not None and f.normal.dot(o) < 0:
            f.normal_flip()
    return rp_(bm, key, name, node=node, bisect=False, lod=lod)


def icicles(p0, p1, n=12, length=(0.06, 0.26), r=0.018, name='icicles'):
    """Winter: a row of icicles (thin cones, lengths varied by noise) hanging under an edge from p0 to p1."""
    p0, p1 = V(p0), V(p1)
    bm = bmesh.new()
    rr = C.rng()
    for k in range(n):
        t = (k + 0.2 + 0.6 * rr.random()) / n
        q = p0.lerp(p1, t)
        L = length[0] + (length[1] - length[0]) * rr.random() ** 1.5
        w = r * (0.6 + 0.8 * rr.random())
        b = [bm.verts.new(q + V((w * math.cos(a), w * math.sin(a), 0))) for a in (0.3, 2.4, 4.5)]
        tip = bm.verts.new(q - V((0.01 * rr.random(), 0, L)))
        for i in range(3):
            bm.faces.new((b[i], tip, b[(i + 1) % 3]))
    return rp_(bm, 'ice', name, lod='drop', bisect=False, grime=0.0)


def gear(c, r, w, teeth, key, name, kw, axis_x=True):
    """Spur gear about the X axis: toothed rim (extruded outline), web and hub."""
    bm = bmesh.new()
    pts = []
    for k in range(teeth * 2):
        a = math.pi * k / teeth
        rr = r if k % 2 == 0 else r * 0.92
        pts.append(V((0, math.cos(a) * rr, math.sin(a) * rr)))
    f = [bm.verts.new(V(c) + p + V((-w / 2, 0, 0))) for p in pts]
    b = [bm.verts.new(V(c) + p + V((w / 2, 0, 0))) for p in pts]
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((f[i], f[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    rp_(bm, key, name, bisect=False, **kw)
    RP('dark', cyl, V(c) - V((w * 0.9, 0, 0)), V(c) + V((w * 0.9, 0, 0)), r * 0.2, 8, name=name + '_hub', bisect=False, **kw)


def snow_cap_cyl(y0, y1, zc, r, a_half=0.8, depth=0.05, segs=8, ny=10, node='main', name='snow_cap', xc=0.0):
    """Winter: ragged snow blanket on the top of a horizontal cylinder (boiler, tank) - thicker along the crown,
    thinning and fraying toward +-a_half (rad) from the top."""
    bm = bmesh.new()
    rows = []
    for j in range(ny + 1):
        y = y0 + (y1 - y0) * j / ny
        row = []
        for i in range(segs + 1):
            a = -a_half + 2 * a_half * i / segs
            edge = abs(a) / a_half
            fr = 0.75 + 0.35 * _n(V((y, a * 3, zc)), 3.0)                  # fray the edge
            aa = a * min(1.0, fr)
            t = depth * max(0.15, 1 - edge ** 2)
            row.append(bm.verts.new(V((xc + math.sin(aa) * (r + t), y, zc + math.cos(aa) * (r + t)))))
        rows.append(row)
    for j in range(ny):
        for i in range(segs):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    return rp_(bm, 'snowcap', name, node=node, smooth=True, bisect=False, grime=0.0)


def snow_heap(x0, x1, y0, y1, hfn, step=0.3, node='main', pivot=None, name='snow_load', lift=0.035):
    """Winter: patchy snow over a load (coal) - coarse grid on the load height function, holes where noise is low."""
    nx = max(3, int(round((x1 - x0) / step)))
    ny = max(3, int(round((y1 - y0) / step)))
    bm = bmesh.new()
    g = [[bm.verts.new(V((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, 0))) for i in range(nx + 1)] for j in range(ny + 1)]
    for row in g:
        for v in row:
            v.co.z = hfn(v.co.x, v.co.y) + lift
    for j in range(ny):
        for i in range(nx):
            c = (g[j][i].co + g[j + 1][i + 1].co) / 2
            if _n(c, 1.6) > 0.36:
                bm.faces.new((g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]))
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    kw = dict(node=node, bisect=False, grime=0.0, smooth=True)
    if pivot is not None:
        kw['pivot'] = pivot
    return rp_(bm, 'snowcap', name, **kw)
