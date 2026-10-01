# vlib.py - SHADOW SIX armour/vehicle builder on top of realism/blender-modeling/blib.py (Opel Blitz pipeline).
# Parts are built in WORLD metres (Blender X right, -Y forward, Z up, ground z=0) and registered to named NODES
# (hull, turret, gun, wheel_L1, hatch_*...). finalize: unwrap one atlas, bake per paint variant (procedural paint +
# grime -> albedo/ORM, shared normal/AO), stamp decals (position-map projection), LOD0-2 GLBs with external
# textures, <name>.veh.json sidecar (nodes+pivots, sockets, emitters, contacts, variants), credits.
import sys, os, math, json, time, random
SCR = os.environ.get('VEH_WORK', os.path.join(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), *['..'] * 5)), 'tools/blender/vehicles/.work'))
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..'))  # tools/blender/vehicles (blib.py)
import bpy, bmesh
from mathutils import Vector, Matrix
import blib as B
import numpy as np

VROOT = os.path.abspath(os.path.join(HERE, '..'))
VARIANTS = ('grey', 'dak', 'winter', 'burnt')
# paint (sRGB): RAL 7021 Dunkelgrau as it reads faded in period photos; RAL 8000 Gelbbraun (DAK 1941-42)
PAINT = {'grey': (56, 60, 62), 'dak': (150, 126, 84), 'winter': (56, 60, 62), 'burnt': (60, 50, 44)}
DUST = {'grey': (0.20, 0.175, 0.14), 'dak': (0.46, 0.37, 0.25), 'winter': (0.19, 0.175, 0.155), 'burnt': (0.05, 0.045, 0.04)}
DUST_SCALE = 1.0              # small ground-level assets (MG tripods/nests) set this lower before finalize
THEATER = {'grey': 'temperate', 'dak': 'desert', 'winter': 'snow', 'burnt': 'temperate'}


class Asset:
    def __init__(self, name, seed=1):
        self.name, self.rng = name, random.Random(seed)
        self.parts = []            # dict(ob, node, keys, lod, inst)
        self.nodes = {}            # name -> dict(pivot, parent, kind, axis, extra)
        self.meta = dict(name=name, sockets=[], emitters=[], contacts=[], muzzles=[], lights=[], tracks=[],
                         decals=[])
        self.inst_src = {}         # mesh-data name -> representative object (shared instanced meshes)
        self.details = []          # detail-only meshes (welds, bolts, rivets): baked high->low into the normal map
        self.out = os.path.join(VROOT, 'out', name)
        os.makedirs(self.out, exist_ok=True)

A = None
def begin(name, seed=1):
    global A
    B.reset()
    A = Asset(name, seed)
    node('hull', (0, 0, 0), None, 'body')
    return A

def node(name, pivot, parent='hull', kind='part', axis=None, **extra):
    """Register a moving part node. pivot = world point (Blender coords); axis = rotation axis (Blender coords)."""
    A.nodes[name] = dict(pivot=tuple(pivot), parent=parent, kind=kind, axis=axis, extra=extra)
    return name

def P(ob, node='hull', key='paint', lod=2, uv=1.0):
    """Register part: key = material key (all faces) or list per slot; lod = highest LOD it appears in (0,1,2)."""
    if ob is None:
        return None
    keys = [key] if isinstance(key, str) else list(key)
    ob.data.materials.clear()
    for k in keys:
        ob.data.materials.append(mat_placeholder(k))
    A.parts.append(dict(ob=ob, node=node, keys=keys, lod=lod, uv=uv))
    return ob

def D(ob, key='paint'):
    """Detail-only geometry (weld beads, bolt/rivet heads, hinge knuckles, grab handles, plate edges): baked
    high->low into the normal map (+ a cavity/dirt accent in albedo) of the surfaces under it; never exported."""
    if ob is None:
        return None
    B.apply_all(ob)
    set_mats(ob, [key])
    A.details.append(ob)
    return ob

def weld(p0, p1, w=0.016, h=0.009, n=None):
    """Weld bead along a plate joint p0 -> p1 (detail only): a row of overlapping flattened beads (ripple)."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    k = max(1, int(L / 0.03))
    d = (p1 - p0).normalized()
    up = Vector(n) if n else (Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0)))
    parts = []
    for i in range(k):
        a = p0 + (p1 - p0) * (i / k); b = p0 + (p1 - p0) * ((i + 1) / k)
        parts.append(B.beam('weld', a - d * 0.004, b + d * 0.004, w, h * 2, up=up))
    D(B.join(parts, 'weld') if len(parts) > 1 else parts[0])

def bolt_row(p0, p1, n, spacing=0.1, r=0.014, h=0.012, hexa=True, end=True):
    """Row of bolt heads (detail only) from p0 to p1 on a surface with outward normal n."""
    p0, p1, n = Vector(p0), Vector(p1), Vector(n).normalized()
    L = (p1 - p0).length
    k = max(1, int(round(L / spacing)))
    parts = []
    for i in range(k + (1 if end else 0)):
        c = p0 + (p1 - p0) * (i / k)
        o = B.cylinder('bolt', r, h * 2, (0, 0, 0), 'Z', 6 if hexa else 8)
        B.apply_all(o)
        q = Vector((0, 0, 1)).rotation_difference(n)
        o.data.transform(Matrix.Translation(c) @ q.to_matrix().to_4x4())
        parts.append(o)
    D(B.join(parts, 'bolts') if len(parts) > 1 else parts[0])

def plate_edge(p0, p1, n, w=0.03, h=0.006):
    """Raised edge of an overlapping plate / cover (detail only)."""
    D(B.beam('pedge', Vector(p0), Vector(p1), w, h * 2, up=Vector(n)))

_PH = {}
def mat_placeholder(key):
    if key not in _PH:
        m = bpy.data.materials.new('K_' + key)
        _PH[key] = m
    return _PH[key]

def mirror(ob, node=None, key=None, lod=None):
    """Mirror a registered part across X=0 and register the copy (node name L<->R swapped if given)."""
    src = next(p for p in A.parts if p['ob'] is ob)
    o2 = B.mirror_x(ob)
    for m in ob.data.materials:
        o2.data.materials.append(m) if len(o2.data.materials) < len(ob.data.materials) else None
    nd = node or src['node']
    A.parts.append(dict(ob=o2, node=nd, keys=key and [key] or src['keys'], lod=src['lod'] if lod is None else lod, uv=src['uv']))
    return o2

def instance(src_ob, name, loc, node, rot=(0, 0, 0), key='paint', lod=2, merge=False):
    """Linked duplicate of an origin-centred mesh (wheels, bolts, road wheels) placed at loc."""
    o = B.link(bpy.data.objects.new(name, src_ob.data))
    if src_ob.data.name not in A.inst_src:          # first placed copy = bake representative; source hidden
        A.inst_src[src_ob.data.name] = o
        src_ob.hide_render = src_ob.hide_viewport = True
        if not src_ob.data.materials:
            src_ob.data.materials.append(mat_placeholder(key))
    o.location = Vector(loc)
    o.rotation_euler = rot
    keys = [m.name[2:] for m in src_ob.data.materials] if src_ob.data.materials else [key]
    A.parts.append(dict(ob=o, node=node, keys=keys, lod=lod, uv=1.0, inst=True, merge=merge))
    return o

def socket(name, pos, node='hull', heading=None, **kw):
    A.meta['sockets'].append(dict(name=name, node=node, pos=pos, heading=heading, **kw))

def emitter(name, pos, node='hull', dirv=(0, 0, 1), kind='dust', **kw):
    A.meta['emitters'].append(dict(name=name, node=node, pos=pos, dir=dirv, kind=kind, **kw))

def muzzle(name, pos, node, dirv=(0, -1, 0), weapon='mg', **kw):
    A.meta['muzzles'].append(dict(name=name, node=node, pos=pos, dir=dirv, weapon=weapon, **kw))

def light(name, pos, node='hull', dirv=(0, -1, 0), kind='headlight', cover='blackout', **kw):
    A.meta['lights'].append(dict(name=name, node=node, pos=pos, dir=dirv, kind=kind, cover=cover, **kw))

def contact(name, pos, kind='wheel', node='hull', **kw):
    A.meta['contacts'].append(dict(name=name, node=node, pos=pos, kind=kind, **kw))

def decal(img, center, normal, up, w, h, node='hull', variants=('grey', 'dak', 'winter')):
    """Planar decal stamped into the albedo atlas: img = key in DECALS, center/normal/up in Blender world."""
    A.meta['decals'].append(dict(img=img, center=tuple(center), normal=tuple(normal), up=tuple(up), w=w, h=h,
                                 node=node, variants=list(variants)))

def g2(v):
    """Blender (x, y, z) -> glTF/game (x, y_up, z_south) = (x, z, -y)."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


# ============================================================== materials (per variant)
lin = B.srgb2lin

def _whitewash(g, col, r):
    """Winter: lime whitewash brushed over Dunkelgrau - streaky coverage, thin/scrubbed patches, worn edges,
    mud-worn low hull, grey showing around handholds; loose snow on up-facing faces."""
    geo = g.geo(); pos = g.sepxyz(geo.outputs['Position']); nz = g.sepxyz(geo.outputs['Normal'])[2]
    brush = g.noise(6.0, 3, 0.5, stretch=(1.0, 1.0, 9.0))           # vertical brush strokes
    brush2 = g.noise(7.0, 3, 0.5, stretch=(9.0, 1.0, 1.0))
    big = g.noise(0.9, 4, 0.6)
    bb = g.mixf(g.smooth(nz, 0.5, 0.9), brush, brush2)
    cov = g.add(g.mul(bb, 0.9), g.mul(big, 0.8))
    wm = g.smooth(cov, 0.66, 0.86)                                    # 1 = full white
    low = g.smooth(pos[2], 0.35, 1.05)                                # mud-scrubbed low hull
    wm = g.mul(wm, g.add(g.mul(low, 0.75), 0.25))
    edge = g.ao(0.02, inside=True, samples=12, only_local=True)
    e = g.smooth(edge, 0.8, 0.4)
    wm = g.mul(wm, g.sub(1.0, g.mul(e, g.smooth(g.noise(20.0, 6, 0.7), 0.4, 0.6))))
    white = g.mixc(g.smooth(g.noise(3.0, 5, 0.6), 0.3, 0.7), g.rgb(lin((214, 214, 206))), g.rgb(lin((188, 190, 184))))
    c = g.mixc(g.mul(wm, 0.94), col, white)
    thin = g.mul(g.smooth(cov, 0.5, 0.66), g.sub(1.0, wm))            # half-covered grey = milky
    c = g.mixc(g.mul(thin, 0.45), c, white)
    snow = g.mul(g.smooth(nz, 0.55, 0.9), g.smooth(g.add(g.noise(2.5, 5, 0.6), g.mul(big, 0.4)), 0.5, 0.7))
    c = g.mixc(snow, c, g.rgb(lin((236, 238, 242))))
    rr = g.mixf(g.add(wm, snow, clamp=True), r, 0.9)
    return c, rr

def _burnt(g, col, r, base=(84, 72, 60)):
    """Destroyed by fire (rework2): paint burnt off in a height/noise heat field -> dark brown rusted steel with
    orange only in the hottest spots, heavy black soot (burn-front band, smoke-blackened upper faces, broad
    stains), grey-white ash lying on up-facing faces and scorched paint remnants low down."""
    geo = g.geo(); pos = g.sepxyz(geo.outputs['Position']); nz = g.sepxyz(geo.outputs['Normal'])[2]
    n1 = g.noise(0.8, 4, 0.55); n2 = g.noise(3.5, 6, 0.65); n3 = g.noise(12.0, 4, 0.6); n4 = g.noise(1.7, 5, 0.6)
    heat = g.smooth(g.add(g.mul(pos[2], 0.45), g.mul(n1, 0.9)), 0.40, 0.85)
    lum = g.math('MULTIPLY_ADD', g.bw(col), 0.25 / B.tex_mean('rust_coarse_01'), 0.75)
    paint = g.mixc(1.0, g.rgb(lin(base)), lum, 'MULTIPLY')
    rust = g.mixc(1.0, col, g.rgb(lin((104, 74, 56))), 'MULTIPLY')                 # dark brown burnt steel
    hot = g.mul(g.smooth(n4, 0.62, 0.78), heat)
    rust = g.mixc(g.mul(hot, 0.6), rust, g.mixc(1.0, col, g.rgb(lin((150, 96, 60))), 'MULTIPLY'))
    c = g.mixc(heat, paint, rust)
    front = g.sub(1.0, g.math('ABSOLUTE', g.sub(g.mul(heat, 2.0), 1.0)))
    soot = g.smooth(g.add(g.mul(front, 0.6), g.mul(n2, 0.7)), 0.42, 0.6)
    soot = g.add(soot, g.mul(g.smooth(pos[2], 0.8, 1.8), g.smooth(n1, 0.25, 0.45)), clamp=True)   # smoke-blackened top
    soot = g.add(soot, g.mul(g.smooth(n3, 0.58, 0.7), g.mul(heat, 0.6)), clamp=True)
    soot = g.add(soot, g.mul(g.smooth(g.add(n1, g.mul(n4, 0.5)), 0.52, 0.72), 0.75), clamp=True)   # broad smoke staining
    c = g.mixc(g.mul(soot, 0.82), c, g.rgb((0.012, 0.011, 0.010)))
    up = g.smooth(nz, 0.45, 0.85)
    ash = g.mul(g.mul(up, g.smooth(g.add(n2, g.mul(n4, 0.4)), 0.74, 0.88)), g.sub(1.0, soot))   # ash only on up-faces
    c = g.mixc(g.mul(ash, 0.45), c, g.rgb(lin((104, 100, 94))))
    return c, g.mixf(soot, g.add(r, 0.15, clamp=True), 0.97)

def _scorch(g, col, r):
    """rework2: burnt/blasted earth + sandbags: keeps the soil/fabric colour (was turned uniform grey), darkened by
    heat, black soot fans and blast scorch patches, a few pale ash flecks."""
    geo = g.geo(); pos = g.sepxyz(geo.outputs['Position'])
    n1 = g.noise(0.9, 4, 0.55); n2 = g.noise(4.0, 5, 0.6); n3 = g.noise(14.0, 3, 0.6)
    c = g.mixc(1.0, col, g.rgb(lin((150, 138, 124))), 'MULTIPLY')
    soot = g.smooth(g.add(n1, g.mul(n2, 0.5)), 0.45, 0.72)
    soot = g.add(soot, g.mul(g.smooth(pos[2], 0.1, 0.5), g.smooth(n2, 0.4, 0.6)), clamp=True)
    c = g.mixc(g.mul(soot, 0.85), c, g.rgb((0.018, 0.016, 0.014)))
    ash = g.mul(g.smooth(n3, 0.66, 0.74), g.sub(1.0, soot))
    c = g.mixc(g.mul(ash, 0.5), c, g.rgb(lin((120, 116, 110))))
    return c, g.mixf(soot, r, 0.95)

WEATHER = 1.0          # scale of the non-uniform weathering layer (set per asset before finalize)

def _weather_extra(g, alb, r, var):
    """Non-uniform weathering on paint: faded/darkened panels, rain streaks under ledges, mud spray kicked up by
    the running gear (low, speckled), fuel/oil stains on top faces, scuffed high-traffic areas."""
    geo = g.geo(); pos = g.sepxyz(geo.outputs['Position']); nz = g.sepxyz(geo.outputs['Normal'])[2]
    W = WEATHER * DUST_SCALE
    big = g.noise(0.45, 3, 0.5); mid = g.noise(1.6, 4, 0.6)
    fine = g.noise(4.5, 4, 0.6)
    # rework2: panel-scale fade made whole parts (251 hood) read as a different colour -> fine mottling only
    fade = g.mul(g.smooth(g.add(mid, g.mul(fine, 0.5)), 0.62, 0.95), 0.10 * W)       # sun-faded / chalky mottling
    c = g.mixc(fade, alb, g.rgb(lin({'dak': (196, 176, 136), 'burnt': (60, 52, 46)}.get(var, (104, 106, 104)))))
    dk = g.mul(g.smooth(g.add(g.mul(big, 0.4), g.mul(fine, 0.8)), 0.42, 0.18), 0.22 * W)   # grimy darker smudges
    c = g.mixc(dk, c, g.rgb(lin((40, 36, 31))), 'MULTIPLY')
    vert = g.smooth(g.math('ABSOLUTE', nz), 0.45, 0.15)                                # vertical faces
    sn = g.noise(5.5, 3, 0.55, stretch=(14.0, 14.0, 0.25))
    st = g.mul(g.mul(g.smooth(sn, 0.56, 0.74), vert), 0.45 * W)                        # rain / grime streaks
    grime = tuple(x * 0.45 for x in DUST[var])
    c = g.mixc(st, c, g.rgb(grime))
    sp = g.noise(14.0, 5, 0.75)
    low = g.smooth(pos[2], 1.0, 0.15)
    mud = g.mul(g.mul(low, g.smooth(g.add(sp, g.mul(low, 0.45)), 0.62, 0.8)), 0.85 * W)   # speckled mud spray
    mc = tuple(x * 0.62 for x in DUST[var])
    c = g.mixc(mud, c, g.rgb(mc))
    rr = g.mixf(g.add(mud, st, clamp=True), r, 0.95)
    up = g.smooth(nz, 0.6, 0.95)
    oil = g.mul(g.mul(up, g.smooth(g.noise(2.2, 4, 0.6), 0.70, 0.78)), 0.55 * W)       # fuel / oil stains
    c = g.mixc(oil, c, g.rgb(lin((26, 22, 18))), 'MULTIPLY')
    rr = g.mixf(oil, rr, 0.35)
    return c, rr

def paint_mat(name, color, var, dark=1.0, wear=0.55, dust=0.85, bottom_h=1.0, tex='green_metal_rust', tscale=1.4):
    m, g = B.new_mat(name)
    if var == 'burnt':
        tex = 'rust_coarse_01'
    col, rr, nrm = B.pbr_layer(g, tex, tscale, 'UVMap', 0.55)
    lum = g.bw(col)
    v = g.math('MULTIPLY_ADD', lum, 0.3 / B.tex_mean(tex), 0.7)
    base = g.rgb(lin(tuple(int(c * dark) for c in color)))
    alb = g.mixc(1.0, base, v, blend='MULTIPLY')
    r = g.math('MULTIPLY_ADD', rr, 0.22, 0.68)        # rework2: matte field paint (was satin 0.55-0.85)
    if var == 'winter':
        alb, r = _whitewash(g, alb, r)
    elif var == 'burnt':
        alb, r = _burnt(g, col, r)
    if var != 'burnt' and WEATHER > 0:
        alb, r = _weather_extra(g, alb, r, var)
    alb, r, met = B.grime(g, alb, r, 0.0, dust=dust * (0.4 if var == 'burnt' else 1.0) * DUST_SCALE,
                          edge_wear=wear if var != 'burnt' else 0.0, wear_metal=0.5, dust_col=DUST[var],
                          bottom_h=bottom_h, streaks=0.7, top_dust=0.9 if var == 'dak' else 0.38, cavity=0.8,
                          wear_col=(0.035, 0.032, 0.03))
    return B.finish(g, alb, r, met, nrm)

def make_mats(var):
    """Real materials for every placeholder key, for paint variant var."""
    PC = PAINT[var]; D = DUST[var]; BURNT = var == 'burnt'
    t = lambda name, tex, **kw: B.mat_tex(name, tex, dust_col=D, **kw)
    M = {}
    M['paint'] = paint_mat('paint', PC, var)
    M['paint_dark'] = paint_mat('paint_dark', PC, var, dark=0.72, wear=0.25, bottom_h=1.4)
    M['interior'] = paint_mat('interior', (214, 204, 172) if not BURNT else PC, 'grey' if not BURNT else var, wear=0.35, dust=0.9)
    burn = (lambda g, c, r: _burnt(g, c, r, (60, 56, 52))) if BURNT else None
    M['gunmetal'] = t('gunmetal', 'rust_coarse_01', tscale=0.8, sat=0.15, bright=0.28, metal=0.6, rough_add=-0.1,
                      dust=0.6, edge_wear=0.5, wear_col=(0.3, 0.3, 0.3), wear_metal=1.0, albedo_fn=burn)
    M['steel'] = t('steel', 'rust_coarse_01', tscale=0.8, sat=0.5, bright=0.55, metal=0.3, dust=0.7, albedo_fn=burn)
    M['rubber'] = t('rubber', 'Rubber004', tscale=0.25, tint=(46, 45, 44) if not BURNT else (30, 28, 26), sat=0.0,
                    bright=0.45, dust=0.35, bottom_h=0.5, top_dust=0.6, rough_add=0.1)
    M['tyre'] = t('tyre', 'Rubber004', tscale=0.25, tint=(44, 43, 42) if not BURNT else (26, 24, 22), sat=0.0,
                  bright=0.38, dust=0.2, bottom_h=0.35, top_dust=0.3, rough_add=0.1)
    M['wood'] = t('wood', 'weathered_planks', tscale=1.5, tint=(150, 120, 90) if not BURNT else (30, 26, 22), sat=0.4,
                  bright=1.1, dust=0.6)
    M['canvas'] = t('canvas', 'Fabric045', tscale=0.35, tint=(150, 138, 104) if var != 'grey' else (112, 108, 86),
                    sat=0.0, bright=1.2, dust=0.9, top_dust=0.9, albedo_fn=burn)
    M['sandbag'] = t('sandbag', 'Fabric045', tscale=1.8, nstr=1.6,           # rework2: visible hessian weave tint={'dak': (188, 160, 114), 'winter': (160, 146, 120)}.get(var, (160, 130, 88)),   # rework2: warmer hessian, less pale
                     sat=0.1, bright=0.86, dust=0.1 if var == 'winter' else 0.3, top_dust=0.12, bottom_h=0.4, albedo_fn=(_whitewash_snow if var == 'winter' else _scorch if BURNT else None))
    M['earth'] = t('earth', 'dense_sand' if var == 'dak' else 'sand_01', tscale=1.2,
                   tint={'dak': (200, 176, 140), 'winter': (120, 110, 96)}.get(var, (120, 104, 84)), sat=0.6, bright=1.0,
                   dust=0.05 if var == 'winter' else 0.2, albedo_fn=(_whitewash_snow if var == 'winter' else _scorch if BURNT else None))
    M['glass'] = B.mat_flat('glass', (26, 32, 30) if not BURNT else (14, 12, 10), rough=0.08 if not BURNT else 0.9, dust=0.3, dust_col=D, bottom_h=0.0)
    M['lens'] = B.mat_flat('lens', (80, 80, 74) if not BURNT else (14, 12, 10), rough=0.1, dust=0.3, dust_col=D, bottom_h=0.0)
    M['black'] = B.mat_flat('black', (12, 12, 11), rough=0.85)
    M['brass'] = B.mat_flat('brass', (170, 130, 60) if not BURNT else (40, 34, 26), rough=0.35, metal=1.0 if not BURNT else 0.0)
    M['red'] = B.mat_flat('red', (120, 12, 10) if not BURNT else (20, 16, 14), rough=0.3)
    M['rope'] = t('rope', 'Fabric030', tscale=0.1, tint=(120, 104, 80), sat=0.2, bright=0.9, dust=0.6)
    for k, m in M.items():
        m['vkey'] = k
    return M

def _whitewash_snow(g, col, r):
    """Snow for non-painted surfaces (sandbags/earth): top-facing snow cover with noise edges."""
    geo = g.geo(); nz = g.sepxyz(geo.outputs['Normal'])[2]
    snow = g.mul(g.smooth(nz, 0.1, 0.5), g.smooth(g.add(g.noise(1.8, 5, 0.6), g.mul(nz, 0.3)), 0.38, 0.52))
    return g.mixc(snow, col, g.rgb(lin((232, 236, 240)))), g.mixf(snow, r, 0.8)

def assign_mats(M, objs=None):
    for p in (objs or A.parts):
        ob = p['ob'] if isinstance(p, dict) else p
        for i, s in enumerate(ob.material_slots):
            if s.material and s.material.get('vkey') and not s.material.name.startswith('K_'):
                s.material = M.get(s.material['vkey'], s.material)
                continue
            k = s.material.name[2:] if s.material and s.material.name.startswith('K_') else None
            if k is None and s.material:
                k = s.material.get('vkey')
            if k in M:
                s.material = M[k]
                M[k]['vkey'] = k


# ============================================================== geometry helpers
def hexa(name, p8, bevel=0.0, segs=1):
    """Box from 8 corners: bottom 4 CCW seen from above, then top 4 in the same order (sloped armour)."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in p8]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = B.obj_from_bm(name, bm)
    if bevel > 0:
        B.add_bevel(ob, bevel, segs, angle=30)
    return ob

def slab(name, y0, y1, prof0, prof1=None, bevel=0.0, segs=1):
    """Loft between two cross-sections (list of (x, z), CCW seen from the front) at stations y0 -> y1 (Blender Y)."""
    prof1 = prof1 or prof0
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in prof0]
    b = [bm.verts.new((x, y1, z)) for x, z in prof1]
    n = len(a)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = B.obj_from_bm(name, bm)
    if bevel > 0:
        B.add_bevel(ob, bevel, segs, angle=30)
    return ob

def lathe_mat(name, prof, segs, axis='X', split_r=None, cap_center=True):
    """Lathe around origin; faces whose mean radius > split_r get material slot 1 (rubber/tyre)."""
    ob = B.lathe(name, prof, segs=segs, axis=axis, smooth=True)
    if split_r is not None:
        me = ob.data
        ax = {'X': 0, 'Y': 1, 'Z': 2}[axis]
        for p in me.polygons:
            c = p.center
            r = math.sqrt(sum(c[i] ** 2 for i in range(3) if i != ax))
            p.material_index = 1 if r > split_r else 0
    return ob

def road_wheel(name, r, w_tyre, gap, segs=12, hub=0.09, dish=0.05):
    """Dual rubber-tyred road wheel (Pz III/IV), axis X, centred at origin, outer face +X (slot 1 = rubber)."""
    ao, ai = gap / 2 + w_tyre, gap / 2
    prof = [(0.0, ao + dish + 0.02), (hub, ao + dish), (hub * 1.35, ao + 0.015), (r - 0.035, ao), (r, ao - 0.02),
            (r, ai + 0.02), (r - 0.035, ai), (hub * 1.3, ai - 0.01), (hub * 1.3, -ai + 0.01), (r - 0.035, -ai),
            (r, -ai - 0.02), (r, -ao + 0.02)]
    return lathe_mat(name, prof, segs, 'X', split_r=r - 0.04)

def road_wheel2(name, r, w_tyre, gap, segs=10, cap=0.06):
    """Twin rubber-tyred road wheel pair (Pz III/IV): outer disc with bolted hub cap, rubber tyre (slot 1), inner
    tyre visible in the gap. Axis X, outer face +X, centred at origin."""
    ao, ai = gap / 2 + w_tyre, gap / 2
    prof = [(0.0, ao + 0.07), (cap, ao + 0.07), (cap + 0.022, ao + 0.03), (0.125, ao + 0.016), (r - 0.065, ao + 0.004),
            (r - 0.055, ao + 0.013), (r, ao - 0.025), (r, ai + 0.015), (r - 0.045, ai),
            (r - 0.045, -ai), (r, -ai - 0.015), (r, -ao + 0.01)]      # inner face (towards the hull) left open
    ob = lathe_mat(name, prof, segs, 'X', split_r=r - 0.052)
    B.auto_smooth(ob.data, 40)                  # flat disc / cap faces, smooth tyre
    return ob

def return_roller(name, r, w, segs=8, hub=0.05):
    """Rubber-tyred return roller: flat disc, hub cap, tyre (slot 1). Axis X, +X outer."""
    prof = [(0.0, w / 2 + 0.04), (hub, w / 2 + 0.04), (hub + 0.012, w / 2), (r - 0.03, w / 2), (r, w / 2 - 0.02),
            (r, -w / 2 + 0.02), (r - 0.03, -w / 2)]
    ob = lathe_mat(name, prof, segs, 'X', split_r=r - 0.028)
    B.auto_smooth(ob.data, 40)
    return ob

def spoked_idler(name, r, w, spokes=8, segs=12, hub=0.1, rim_w=0.05):
    """Welded tubular-spoke idler (Pz IV G / Pz III): two narrow rims, hub, spokes on both rims. Axis X, +X out."""
    parts = []
    for sx in (1, -1):
        x = sx * (w / 2 - rim_w / 2)
        parts.append(B.lathe(name + '_rim', [(r - 0.05, x + rim_w / 2), (r, x + rim_w / 2), (r, x - rim_w / 2),
                                              (r - 0.05, x - rim_w / 2)], segs=segs, axis='X'))
        for i in range(spokes):
            a = 2 * math.pi * (i + (0.5 if sx < 0 else 0)) / spokes
            d = Vector((0, math.cos(a), math.sin(a)))
            parts.append(B.beam('spoke', Vector((x * 0.6, 0, 0)) + d * hub * 0.9, Vector((x, 0, 0)) + d * (r - 0.045),
                                0.045, 0.035, up=Vector((1, 0, 0))))
    parts.append(B.lathe(name + '_hub', [(0.0, w / 2 + 0.05), (hub * 0.6, w / 2 + 0.05), (hub, w / 2 + 0.01),
                                          (hub, -w / 2 - 0.01), (0.0, -w / 2 - 0.02)], segs=10, axis='X'))
    for o in parts:
        B.auto_smooth(o.data, 40)
    return B.join(parts, name)

def sprocket2(name, r, w, teeth=20, hub=0.13, holes=8, capz=0.07):
    """Pz IV/III drive sprocket: two toothed rings, dished spider with round lightening holes (read as dark
    recesses through slots), large hub cap. Axis X, +X outer."""
    parts = []
    for sx in (1, -1):
        pts = []
        for i in range(teeth * 2):
            a = math.pi * 2 * i / (teeth * 2)
            rr = r if i % 2 == 0 else r * 0.87
            for da in ((-0.22, 0.22) if i % 2 == 0 else (0,)):
                aa = a + da * math.pi * 2 / (teeth * 2)
                pts.append((rr * math.cos(aa), rr * math.sin(aa)))
        if sx > 0 and teeth:                    # inner ring hidden behind the track horns
            parts.append(B.prism(name + '_ring', pts, 0.045, plane='YZ', offset=sx * (w / 2 - 0.03)))
    parts.append(B.lathe(name + '_spider', [(0.0, w / 2 + capz), (hub * 0.55, w / 2 + capz), (hub * 0.8, w / 2 + 0.05),
                                             (hub, w / 2 + 0.05), (r * 0.55, w / 2 + 0.01), (r * 0.8, w / 2 - 0.02),
                                             (r * 0.85, w / 2 - 0.04), (r * 0.85, -w / 2 + 0.04), (hub, -w / 2)],
                         segs=12, axis='X'))
    for o in parts:
        set_mats(o, ['paint'])
        B.auto_smooth(o.data, 40)
    rh = (r * 0.55 + hub) / 2
    for i in range(holes):                         # lightening holes in the dished spider (slot 1 = black)
        a = 2 * math.pi * (i + 0.5) / holes
        xh = w / 2 + 0.01 + 0.04 * (1 - (rh - hub) / (r * 0.55 - hub)) + 0.004
        o = B.cylinder('hole', (r * 0.55 - hub) * 0.36, 0.01, (xh, rh * math.cos(a), rh * math.sin(a)), 'X', 6)
        set_mats(o, ['black'])
        parts.append(o)
    return B.join(parts, name)

def spoked_wheel(name, r, w, segs=16, spokes=8, hub=0.1, rubber=True):
    """Idler / 251 road wheel style: rim + dished face + hub; axis X, outer face +X."""
    prof = [(0.0, w / 2 + 0.06), (hub * 0.7, w / 2 + 0.06), (hub, w / 2 + 0.03), (r * 0.8, w / 2 - 0.01),
            (r - 0.02, w / 2), (r, w / 2 - 0.015), (r, -w / 2 + 0.015), (r - 0.02, -w / 2), (r * 0.8, -w / 2 + 0.02), (hub, -w / 2)]
    return lathe_mat(name, prof, segs, 'X', split_r=(r - 0.03) if rubber else 99)

def sprocket(name, r, w, teeth=20, hub=0.12):
    """Drive sprocket: hub lathe + two toothed rings (star prism), axis X, centred at origin."""
    parts = [B.lathe(name + '_hub', [(0.0, w / 2 + 0.08), (hub * 0.7, w / 2 + 0.08), (hub, w / 2 + 0.05), (r * 0.72, w / 2),
                                     (r * 0.72, -w / 2), (hub, -w / 2 - 0.02)], segs=16, axis='X')]
    for sx in (-1, 1):
        pts = []
        for i in range(teeth * 2):
            a = math.pi * 2 * i / (teeth * 2)
            rr = r if i % 2 == 0 else r * 0.86
            for da in (-0.25, 0.25) if i % 2 == 0 else (0,):
                aa = a + da * math.pi * 2 / (teeth * 2)
                pts.append((rr * math.cos(aa), rr * math.sin(aa)))
        if sx > 0:
            parts.append(B.prism(name + '_ring', pts, w * 0.55, plane='YZ', offset=w * 0.2))
    return B.join(parts, name)

def pneu_tyre(name, r, w, rim_r, segs=18):
    """Pneumatic (or solid cross-country) tyre + disc wheel, axis X, outer face +X; slot 1 = tyre."""
    prof = [(0.0, w / 2 - 0.02), (0.07, w / 2 - 0.02), (0.09, w / 2 - 0.05), (rim_r - 0.02, w / 2 - 0.06), (rim_r, w / 2 - 0.02),
            (rim_r + 0.01, w / 2), (r - 0.06, w / 2 + 0.01), (r - 0.02, w / 2 - 0.02), (r, w / 2 - 0.06), (r, -w / 2 + 0.06),
            (r - 0.02, -w / 2 + 0.02), (r - 0.06, -w / 2 - 0.01), (rim_r + 0.01, -w / 2), (rim_r, -w / 2 + 0.02), (0.1, -w / 2 + 0.04)]
    return lathe_mat(name, prof, segs, 'X', split_r=rim_r + 0.005)

def track_path(circles, thick, sag=0.03, max_seg=0.1):
    """circles: [(y, z, r)] wheels the belt wraps (r = belt inner radius). Returns closed CCW (in y,z with z up)
    centre-line points [(y, z, ny, nz)] + total length. Straight upper runs sag between supports."""
    pts = []
    for y, z, r in circles:
        R = r + thick / 2
        for i in range(40):
            a = 2 * math.pi * i / 40
            pts.append((y + R * math.cos(a), z + R * math.sin(a)))
    pts = sorted(set((round(a, 5), round(b, 5)) for a, b in pts))
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    hull = lo[:-1] + up[:-1]
    out = []
    n = len(hull)
    for i in range(n):
        a, b = Vector(hull[i]), Vector(hull[(i + 1) % n])
        L = (b - a).length
        k = max(1, int(math.ceil(L / max_seg))) if L > 0.05 else 1
        t = (b - a).normalized() if L > 0 else Vector((1, 0))
        nrm = Vector((t.y, -t.x))
        for j in range(k):
            f = j / k
            p = a.lerp(b, f)
            if L > 0.25 and nrm.y > 0.6:        # upper run between supports: sag
                p = p - Vector((0, 1)) * sag * min(1.0, L / 0.9) * math.sin(math.pi * f)
            out.append(p)
    res, tot = [], 0.0
    m = len(out)
    for i in range(m):
        a, b = out[i - 1], out[(i + 1) % m]
        t = (b - a).normalized()
        res.append((out[i].x, out[i].y, t.y, -t.x, tot))
        tot += (out[(i + 1) % m] - out[i]).length
    return res, tot

def _path_at(path, total, s):
    """Interpolate the closed belt centre-line (from track_path) at arc length s -> (y, z, ny, nz)."""
    s = s % total
    ss = [p[4] for p in path]
    import bisect
    i = bisect.bisect_right(ss, s) - 1
    j = (i + 1) % len(path)
    s1 = path[j][4] if j else total
    f = (s - ss[i]) / max(1e-6, s1 - ss[i])
    a, b = path[i], path[j]
    y = a[0] + (b[0] - a[0]) * f; z = a[1] + (b[1] - a[1]) * f
    n = Vector((a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f))
    n = n.normalized() if n.length > 1e-6 else Vector((a[2], a[3]))
    return y, z, n.x, n.y

def track_belt(name, x0, circles, width, thick=0.06, tile_links=4, pitch=0.12, sag=0.03, relief=True):
    """Closed track belt with link relief: two rows per link (link body / hinge joint). At each joint the outer
    tread face dips (groove between links) and the sides bulge (hinge pin bosses) so the belt silhouette reads as
    individual links at close zoom. Rows are aligned with the texture link period (joint at f=0.95); when a vehicle
    stops the game may snap texture offset.y to a multiple of `snap` so texture joints line up with the grooves."""
    if not relief:
        return track_belt_flat(name, x0, circles, width, thick, tile_links, pitch, sag)
    path, total = track_path(circles, thick, sag, max_seg=0.02)
    nt = max(1, round(total / (tile_links * pitch)))
    tile = total / nt
    nl = nt * tile_links; pe = total / nl
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('bake')
    rows, vs = [], []
    for i in range(nl):
        for f, joint in ((0.45, False), (0.95, True)):
            sp = (i + f) * pe
            y, z, ny, nz = _path_at(path, total, sp)
            if nz < -0.9 and (joint or i % 3):          # ground run (hidden under the wheels): coarse rows
                continue
            n = Vector((0, ny, nz))
            to = thick / 2 - (thick * 0.38 if joint else 0.0)        # outer face dips at the joint
            ti = thick / 2 - (thick * 0.12 if joint else 0.0)
            hw = width / 2 + (0.008 if joint else 0.0)               # hinge pin bosses
            po, pi_ = n * to, n * -ti
            rows.append([bm.verts.new((x0 - hw, y + po.y, z + po.z)), bm.verts.new((x0 + hw, y + po.y, z + po.z)),
                         bm.verts.new((x0 + hw, y + pi_.y, z + pi_.z)), bm.verts.new((x0 - hw, y + pi_.y, z + pi_.z))])
            vs.append(sp / tile)
    n = len(rows)
    bands = [(0, 1, 0.0, 0.62), (2, 3, 0.62, 0.9), (1, 2, 0.9, 0.95), (3, 0, 0.95, 1.0)]
    for i in range(n):
        j = (i + 1) % n
        v0 = vs[i]; v1 = vs[j] if j else vs[0] + nt
        for a, b, u0, u1 in bands:
            f = bm.faces.new((rows[i][a], rows[i][b], rows[j][b], rows[j][a]))
            for l, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                l[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = B.obj_from_bm(name, bm)
    A.meta['tracks'].append(dict(node=name, x=x0, width=width, length=round(total, 4), v_per_m=round(1 / tile, 5),
                                 pitch=round(pe, 4), links=nl, snap=round(1 / tile_links, 5), relief=True))
    return ob, path, total

def track_belt_flat(name, x0, circles, width, thick=0.06, tile_links=4, pitch=0.12, sag=0.03):
    """Closed track belt at lateral centre x0; UV layer 'bake' = track texture space (u: 0-.62 outer tread face,
    .62-.9 inner face with guide horns, .9-1 edges; v = distance / (tile_links*pitch), seamless)."""
    path, total = track_path(circles, thick, sag)
    nt = max(1, round(total / (tile_links * pitch)))
    tile = total / nt
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('bake')
    rows = []
    for y, z, ny, nz, s in path:
        o = Vector((0, ny, nz)) * thick / 2
        rows.append([bm.verts.new((x0 + dx, y + sgn * o.y, z + sgn * o.z)) for dx, sgn in
                     ((-width / 2, 1), (width / 2, 1), (width / 2, -1), (-width / 2, -1))])
    n = len(rows)
    bands = [(0, 1, 0.0, 0.62), (2, 3, 0.62, 0.9), (1, 2, 0.9, 0.95), (3, 0, 0.95, 1.0)]
    for i in range(n):
        j = (i + 1) % n
        v0 = path[i][4] / tile
        v1 = (path[j][4] if j else total) / tile
        for a, b, u0, u1 in bands:
            f = bm.faces.new((rows[i][a], rows[i][b], rows[j][b], rows[j][a]))
            for l, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                l[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = B.obj_from_bm(name, bm)
    A.meta['tracks'].append(dict(node=name, x=x0, width=width, length=round(total, 4), v_per_m=round(1 / tile, 5),
                                 pitch=pitch, links=int(round(total / pitch))))
    return ob, path, total


# ============================================================== accessories
def _xf(ob, loc, rz=0.0, rx=0.0, ry=0.0):
    """Transform an origin-built mesh into world: rotate X, Y, then Z (radians), then translate."""
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
    ob.data.transform(M)
    return ob

def mg(kind, loc, node, rz=0.0, rx=0.0, full=True, lod=2, jacket_only=False, bipod=True):
    """MG34 / MG42 (7.92 mm), built along -Y (muzzle forward), loc = receiver rear-centre (pivot for mounts).
    full=False: ball/coax mount (jacket + muzzle only). Returns muzzle world point."""
    parts = []
    L = 1.22 if kind == 'mg34' else 1.22
    def stock(name, key, prof):                     # side-profile prism (y, z) 4 cm thick
        return (key, B.prism(name, prof, 0.042, plane='YZ', offset=0.0, bevel=0.004, segs=1))
    if kind == 'mg34':
        rec = [('gunmetal', B.box('rec', (0.05, 0.36, 0.07), (0, -0.20, 0.0), bevel=0.006, segs=1)),
               ('gunmetal', B.cylinder('jacket', 0.024, 0.46, (0, -0.60, 0.0), 'Y', 14)),
               ('gunmetal', B.cylinder('jacket_ring', 0.027, 0.03, (0, -0.37, 0.0), 'Y', 14)),
               ('gunmetal', B.cylinder('muzzle', 0.02, 0.12, (0, -0.89, 0.0), 'Y', 10, r2=0.016)),
               ('gunmetal', B.cylinder('cone', 0.028, 0.04, (0, -0.84, 0.0), 'Y', 12)),
               ('gunmetal', B.box('front_sight', (0.008, 0.02, 0.04), (0, -0.82, 0.04)))]
        for k in range(6):
            rec.append(('black', B.cylinder('jholes', 0.0245, 0.022, (0, -0.42 - k * 0.07, 0.0), 'Y', 14)))
        if full:
            rec += [stock('stock', 'wood', [(0.0, 0.02), (0.30, -0.01), (0.31, -0.1), (0.26, -0.12), (0.12, -0.05), (0.0, -0.04)]),
                    stock('grip', 'wood', [(-0.04, -0.02), (-0.08, -0.02), (-0.06, -0.14), (-0.02, -0.14)]),
                    ('gunmetal', B.box('trigger_guard', (0.012, 0.06, 0.03), (0, -0.1, -0.05))),
                    ('gunmetal', B.box('cover', (0.056, 0.22, 0.028), (0, -0.25, 0.048), bevel=0.004, segs=1)),
                    ('gunmetal', B.box('rear_sight', (0.02, 0.04, 0.03), (0, -0.38, 0.06))),
                    ('gunmetal', B.cylinder('drum', 0.055, 0.06, (0.065, -0.22, -0.02), 'X', 14)),
                    ('gunmetal', B.beam('bipod', (0, -0.72, -0.01), (0.07, -0.78, -0.3), 0.012)),
                    ('gunmetal', B.beam('bipod', (0, -0.72, -0.01), (-0.07, -0.78, -0.3), 0.012))]
    else:
        rec = [('gunmetal', B.box('rec', (0.06, 0.40, 0.085), (0, -0.22, 0.0), bevel=0.006, segs=1)),
               ('gunmetal', B.box('jacket', (0.05, 0.44, 0.05), (0, -0.62, 0.0), bevel=0.012, segs=1)),
               ('black', B.box('jslot', (0.052, 0.3, 0.022), (0, -0.62, 0.0))),
               ('black', B.box('jslot_side', (0.053, 0.16, 0.03), (0.0, -0.46, -0.005))),
               ('gunmetal', B.cylinder('muzzle', 0.021, 0.12, (0, -0.90, 0.0), 'Y', 12, r2=0.017)),
               ('gunmetal', B.cylinder('bbl', 0.012, 0.44, (0.0, -0.62, 0.0), 'Y', 8)),
               ('gunmetal', B.box('front_sight', (0.01, 0.02, 0.05), (0, -0.82, 0.045)))]
        if full:
            rec += [stock('stock', 'black', [(0.0, 0.02), (0.28, -0.01), (0.29, -0.1), (0.24, -0.12), (0.1, -0.06), (0.0, -0.045)]),
                    stock('grip', 'black', [(-0.05, -0.03), (-0.09, -0.03), (-0.07, -0.15), (-0.03, -0.15)]),
                    ('gunmetal', B.box('trigger_guard', (0.012, 0.06, 0.03), (0, -0.12, -0.055))),
                    ('gunmetal', B.box('cover', (0.066, 0.22, 0.03), (0, -0.28, 0.057), bevel=0.004, segs=1)),
                    ('gunmetal', B.box('rear_sight', (0.02, 0.05, 0.035), (0, -0.44, 0.065))),
                    ('gunmetal', B.box('feed_tray', (0.12, 0.08, 0.03), (0.05, -0.28, 0.02))),
                    ('brass', B.box('belt', (0.13, 0.03, 0.02), (0.1, -0.28, 0.0), rot=('Y', 25))),
                    ('gunmetal', B.beam('bipod', (0, -0.78, -0.02), (0.07, -0.80, -0.3), 0.012)),
                    ('gunmetal', B.beam('bipod', (0, -0.78, -0.02), (-0.07, -0.80, -0.3), 0.012))]
    if jacket_only:
        rec = [r for r in rec if r[1].name.startswith(('jacket', 'jslot', 'muzzle', 'cone', 'bbl')) and not r[1].name.startswith(('jacket_ring', 'jslot_side'))]
    if not bipod:
        drop = [r for r in rec if r[1].name.startswith('bipod')]
        rec = [r for r in rec if not r[1].name.startswith('bipod')]
        for k, o in drop:
            bpy.data.objects.remove(o)
    for k, o in rec:
        B.apply_all(o)
        _xf(o, loc, rz, rx)
        P(o, node, k, lod=lod if o.name.startswith(('rec', 'jacket', 'stock', 'muzzle')) else min(lod, 1))
    mz = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X') @ Vector((0, -0.96, 0))
    return tuple(mz)

def headlight(loc, node='hull', r=0.085, cover=True, lod=1):
    """Bosch headlamp on a stalk; WWII blackout: Tarnkappe slot cover over the lens."""
    lamp = B.lathe('headlamp', [(0.0, 0.1), (r * 0.6, 0.095), (r, 0.06), (r * 1.08, 0.0), (r * 1.02, -0.02), (0.0, -0.02)],
                   segs=12, axis='Y')
    P(_xf(lamp, loc), node, 'paint', lod)
    P(_xf(B.cylinder('lens', r * 0.9, 0.01, (0, 0, 0), 'Y', 12), (loc[0], loc[1] - 0.025, loc[2])), node, 'lens', lod)
    if cover:
        P(B.box('bo_cover', (r * 2.1, 0.03, r * 0.9), (loc[0], loc[1] - 0.04, loc[2] + r * 0.55)), node, 'paint', lod)
        P(B.box('bo_cover', (r * 2.1, 0.03, r * 0.9), (loc[0], loc[1] - 0.04, loc[2] - r * 0.55)), node, 'paint', lod)
    light('headlight', loc, node, (0, -1, 0), 'headlight', 'blackout' if cover else 'none')

def notek(loc, node='hull'):
    P(B.box('notek', (0.11, 0.08, 0.07), loc, bevel=0.015, segs=1), node, 'paint', 1)
    P(B.box('notek_slit', (0.08, 0.01, 0.012), (loc[0], loc[1] - 0.041, loc[2] - 0.01)), node, 'lens', 1)
    light('notek', loc, node, (0, -1, -0.3), 'convoy', 'notek')

def tool(kind, p0, p1, node='hull', up=(0, 0, 1)):
    """Pioneer tools strapped flat: shovel, pick, axe, crowbar, wire_cutter, jack, cleaning_rod."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    if kind in ('shovel', 'pick', 'axe'):
        P(B.beam(kind + '_h', p0, p0 + d * 0.72, 0.035, 0.028, up=up), node, 'wood', 1)
        hd = p0 + d * 0.72
        if kind == 'shovel':
            P(B.beam('blade', hd, p1, 0.2, 0.015, up=up), node, 'steel', 1)
        else:
            c = hd + d.normalized() * 0.03
            s = d.normalized().cross(Vector(up)).normalized()
            P(B.beam('head', c - s * (0.25 if kind == 'pick' else 0.08), c + s * (0.25 if kind == 'pick' else 0.1), 0.04, 0.03, up=up), node, 'steel', 1)
    elif kind == 'jack':
        P(B.cylinder('jack', 0.06, d.length, tuple((p0 + p1) / 2), 'Y' if abs(d.y) > abs(d.x) else 'X', 10), node, 'paint', 1)
    elif kind == 'cable':
        P(B.beam('cable', p0, p1, 0.028, 0.028, up=up), node, 'steel', 1)
    else:
        P(B.beam(kind, p0, p1, 0.03, 0.03, up=up), node, 'steel', 1)
    for f in (0.2, 0.8):
        c = p0 + d * f
        D(B.box('strap', (0.05, 0.03, 0.05) if abs(d.y) > abs(d.x) else (0.03, 0.05, 0.05), tuple(c)), 'steel')

def jerrycan(loc, node='hull', rz=0.0, key='paint', lying=False):
    """20 l Wehrmacht-Einheitskanister (0.165 x 0.345 x 0.47 m); lying = on its broad side."""
    ry = math.pi / 2 if lying else 0.0
    o = B.box('jerrycan', (0.165, 0.345, 0.47), (0, 0, 0.235), bevel=0.02, segs=1)
    B.apply_all(o)
    l2 = (loc[0], loc[1], loc[2] + (0.0825 if lying else 0))
    if lying:
        o.data.transform(Matrix.Translation((0, 0, -0.235)))
    P(_xf(o, l2, rz, 0, ry), node, key, 1)
    h = B.box('jc_handle', (0.15, 0.1, 0.03), (0, 0.07, 0.49 - (0.235 if lying else 0)))
    P(_xf(h, l2, rz, 0, ry), node, key, 0)

def spare_links(loc, n, node='hull', pitch=0.12, width=0.4, rz=0.0, rx=0.0, ry=0.0):
    """Row of spare track links (link width along local X, rows along local Y, 35 mm thick along Z)."""
    for i in range(n):
        o = B.box('spare_link', (width, pitch * 0.92, 0.035), (0, i * pitch - (n - 1) * pitch / 2, 0))
        B.apply_all(o)
        P(_xf(o, loc, rz, rx, ry), node, 'steel', 1)
        o2 = B.box('spare_horn', (0.03, pitch * 0.5, 0.07), (0, i * pitch - (n - 1) * pitch / 2, 0.04))
        D(_xf(o2, loc, rz, rx, ry), 'steel')

def antenna(base, h, node='hull', lean=0.0):
    P(B.cylinder('ant_base', 0.03, 0.08, (base[0], base[1], base[2] + 0.04), 'Z', 8), node, 'paint', 1)
    top = (base[0], base[1] + lean, base[2] + h)
    P(B.beam('antenna', base, top, 0.008), node, 'gunmetal', 1)

def bolts(pts, node='hull', r=0.018, key='paint', axis='Z'):
    for p in pts:
        P(B.cylinder('bolt', r, 0.02, p, axis, 6), node, key, 0)


def set_mats(ob, keys):
    # rework2 BUGFIX: materials.clear() drops the mesh 'material_index' attribute in Blender 4.x, so every
    # lathe_mat split (tyre/rubber = slot 1) was lost and wheels baked in body paint. Save + restore it.
    idx = [p.material_index for p in ob.data.polygons]
    ob.data.materials.clear()
    for k in keys:
        ob.data.materials.append(mat_placeholder(k))
    for p, i in zip(ob.data.polygons, idx):
        p.material_index = min(i, len(keys) - 1)
    return ob


# ============================================================== bake
def _emit_expr_bake(objs, img, fn):
    """Bake an arbitrary per-point colour expression fn(g) -> colour socket via EMIT (e.g. world position)."""
    B._bake_setup(1)
    mats = B._target_nodes(objs, img)
    saved = []
    for m in mats:
        g = B.NG(m)
        out = next(n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        prev = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
        em = g.new('ShaderNodeEmission'); g.s(em, 'Color', fn(g)); g.s(em, 'Strength', 1.0)
        m.node_tree.links.new(em.outputs[0], out.inputs['Surface'])
        saved.append((m.node_tree, out, prev, em))
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='EMIT', uv_layer='bake', use_clear=False, margin=4)
    B._emit_restore(saved)

def _px(im, res):
    a = np.empty(res * res * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(res, res, 4)[::-1]          # row 0 = top (image space)

def _img(name, res, color=(0, 0, 0, 1), noncolor=True, flt=False):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, res, res, alpha=True, float_buffer=flt)
    im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    im.generated_color = color
    return im

def _fill(arr, cov):
    """rework2: push-pull fill of the atlas background (unbaked texels) with the nearest island colours, so
    decimated LOD1/2 UVs and mip levels never sample the black background (LOD2 blotches)."""
    a = arr[..., :3].astype(np.float32); m = cov.astype(np.float32)
    lv = [(a * m[..., None], m)]
    while lv[-1][1].shape[0] > 1:
        c, w = lv[-1]; h = c.shape[0] // 2
        lv.append((c.reshape(h, 2, h, 2, 3).sum((1, 3)), w.reshape(h, 2, h, 2).sum((1, 3))))
    c, w = lv[-1]; f = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(lv[:-1]):
        up = np.repeat(np.repeat(f, 2, 0), 2, 1)
        k = np.clip(w, 0, 1)[..., None]
        f = np.where(w[..., None] > 0, c / np.maximum(w, 1e-6)[..., None], up) * 1.0
        f = np.where(w[..., None] > 0, f * k + up * (1 - k), up)
    out = arr.copy(); out[..., :3] = np.where(m[..., None] > 0.5, a, f)
    return out

def _save(arr, path, q=90, sub=2, size=None):
    from PIL import Image
    a = np.clip(arr[..., :3] * 255 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(a)
    if size and size != im.size[0]:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path, quality=q, optimize=True, subsampling=sub)

def _bake_normal_high(targets, img, high, extrude=0.022, dist=0.045):
    """Tangent normal bake of `high` (proxy copy + weld/bolt details, same shading) onto the low proxy."""
    B._bake_setup(8)
    B._target_nodes(targets, img)
    bpy.ops.object.select_all(action='DESELECT')
    high.hide_render = False
    high.select_set(True)
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    t = time.time()
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', uv_layer='bake', use_clear=False, margin=8,
                        use_selected_to_active=True, cage_extrusion=extrude, max_ray_distance=dist)
    high.hide_render = True
    B.log('baked normal (details high->low)', len(A.details), 'details', '%.1fs' % (time.time() - t))

def bake_variant(var, uniq, reps, res, first):
    """Bake one paint variant into numpy arrays. uniq = unique-mesh parts, reps = instance representatives.
    Returns dict(albedo, rough, metal[, normal, ao, pos, nrm, mask]) as float arrays (image space, top row first)."""
    M = make_mats(var)
    assign_mats(M)
    if not getattr(A, 'bake_proxy', None):        # one joined copy: Cycles bakes per object (268 parts = 268 syncs)
        cp = [_dup(o) for o in uniq]
        A.bake_proxy = B.join(cp, '__bake_proxy')
        for o in uniq:
            o.hide_render = True
    if reps and not getattr(A, 'rep_proxy', None):    # instanced meshes: unique copies joined (same UVs)
        cp = []
        for o in reps:
            c = o.copy(); c.data = o.data.copy(); B.link(c); cp.append(c)
            o.hide_render = True
        A.rep_proxy = B.join(cp, '__rep_proxy') if len(cp) > 1 else cp[0]
    if reps:
        assign_mats(M, [A.rep_proxy])
        reps = [A.rep_proxy]
    assign_mats(M, [A.bake_proxy])
    uniq = [A.bake_proxy]
    kinds = ['albedo', 'rough', 'metal'] + (['normal', 'ao'] if first else [])
    imgs = {k: _img(f'{A.name}_{k}', res, {'normal': (0.5, 0.5, 1, 1), 'rough': (0.8, 0.8, 0.8, 1), 'ao': (1, 1, 1, 1)}.get(k, (0, 0, 0, 1)),
                    noncolor=k != 'albedo') for k in kinds}
    w = bpy.context.scene.world or bpy.data.worlds.new('W')
    bpy.context.scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    w.light_settings.distance = 0.9
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    gp = B.obj_from_bm('__ground', bm)
    t = time.time()
    high = None
    if first and A.details:                       # detail geometry: high = proxy copy + details, normal only
        hc = A.bake_proxy.copy(); hc.data = A.bake_proxy.data.copy(); B.link(hc)
        dets = [_dup(o) for o in A.details]
        high = B.join([hc] + dets, '__bake_high')
        assign_mats(M, [high])
        high.hide_render = True
    for targets in (uniq, reps):
        if not targets:
            continue
        for k in kinds:
            if k == 'normal' and high is not None and targets is uniq:
                _bake_normal_high(targets, imgs[k], high)
            else:
                B.bake_pass(targets, k, imgs[k], 16 if k != 'ao' else 48)
    if high is not None:
        bpy.data.objects.remove(high)
    out = {k: _px(imgs[k], res) for k in kinds}
    if first:
        pos = _img(f'{A.name}_pos', res, (0, 0, 0, 0), flt=True)
        allt = uniq + reps
        _emit_expr_bake(allt, pos, lambda g: g.mixc(1.0, g.rgb((0, 0, 0)), g.geo().outputs['Position'], 'ADD'))
        nrm = _img(f'{A.name}_nrm', res, (0, 0, 0, 0), flt=True)
        _emit_expr_bake(allt, nrm, lambda g: g.mixc(1.0, g.rgb((0, 0, 0)), g.geo().outputs['Normal'], 'ADD'))
        out['pos'], out['nrm'] = _px(pos, res), _px(nrm, res)
    bpy.data.objects.remove(gp)
    B.log('baked variant', var, '%.1fs' % (time.time() - t))
    return out

# ============================================================== decals
def decal_rgba(key, px=256):
    """Procedural markings (own work): 'bk' Balkenkreuz black+white border; 'bko' open white-outline cross;
    'num:<digits>:<style>' tactical numbers, style r (red, white outline), w (white outline), b (black, white outline)."""
    from PIL import Image, ImageDraw, ImageFont
    if key == 'ring':
        a = np.zeros((32, 256, 4), np.float32); a[:, :, :3] = 0.9; a[:, :, 3] = 1.0
        return a
    if key.startswith('bk'):
        im = Image.new('RGBA', (px, px), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        s = px / 10.0
        def cross(rw, rl, col):   # arms of half-width rw, half-length rl (flared Balkenkreuz: straight arms)
            c = px / 2
            d.rectangle((c - rl, c - rw, c + rl, c + rw), fill=col); d.rectangle((c - rw, c - rl, c + rw, c + rl), fill=col)
        cross(2.4 * s, 4.9 * s, (236, 236, 230, 255))
        cross(1.25 * s, 4.9 * s - 0.1 * s, (236, 236, 230, 255))
        # white border only on the arm ends/sides (classic: black cross, white L-shaped flanks)
        d.rectangle((px / 2 - 2.4 * s, px / 2 - 2.4 * s, px / 2 + 2.4 * s, px / 2 + 2.4 * s), fill=(236, 236, 230, 255))
        cross(1.25 * s, 4.9 * s, (18, 18, 18, 255) if key == 'bk' else (0, 0, 0, 0))
        if key == 'bko':
            d.rectangle((px / 2 - 1.25 * s, px / 2 - 4.9 * s, px / 2 + 1.25 * s, px / 2 + 4.9 * s), fill=(0, 0, 0, 0))
            d.rectangle((px / 2 - 4.9 * s, px / 2 - 1.25 * s, px / 2 + 4.9 * s, px / 2 + 1.25 * s), fill=(0, 0, 0, 0))
        return np.asarray(im).astype(np.float32) / 255
    _, txt, style = key.split(':')
    W, H = px * len(txt) // 2, px // 2
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', int(H * 0.95))
    fill = {'r': (150, 22, 18, 255), 'w': (0, 0, 0, 0), 'b': (20, 20, 20, 255)}[style]
    d.text((W / 2, H / 2), txt, font=f, anchor='mm', fill=fill, stroke_width=max(2, H // 14), stroke_fill=(232, 232, 226, 255))
    if style == 'w':
        d.text((W / 2, H / 2), txt, font=f, anchor='mm', fill=(0, 0, 0, 0))
    return np.asarray(im).astype(np.float32) / 255

def stamp_decals(alb, pos, nrm, var, rng):
    """Project each registered decal onto atlas texels whose baked world position lies on its plane."""
    H, W = alb.shape[:2]
    P3, N3 = pos[..., :3], nrm[..., :3]
    valid = pos[..., 3] > 0.5
    for d in A.meta['decals']:
        if var not in d['variants']:
            continue
        img = decal_rgba(d['img'])
        n = Vector(d['normal']).normalized(); up = Vector(d['up']).normalized()
        right = up.cross(n).normalized(); up = n.cross(right)
        c = np.array(d['center'], np.float32)
        rel = P3 - c
        dist = rel @ np.array(n, np.float32)
        u = rel @ np.array(right, np.float32) / d['w'] + 0.5
        v = rel @ np.array(up, np.float32) / d['h'] + 0.5
        facing = N3 @ np.array(n, np.float32)
        m = valid & (np.abs(dist) < 0.04) & (facing > 0.55) & (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
        if not m.any():
            print('decal missed', d['img'], d['center']); continue
        ih, iw = img.shape[:2]
        xi = np.clip((u[m] * iw).astype(int), 0, iw - 1); yi = np.clip(((1 - v[m]) * ih).astype(int), 0, ih - 1)
        rgba = img[yi, xi]
        chip = np.clip(0.75 + rng.random(len(xi)) * 0.6, 0, 1)
        a = rgba[:, 3:4] * 0.93 * chip[:, None]
        lum = alb[m][:, :3].mean(1, keepdims=True)
        base = rgba[:, :3] * np.clip(0.72 + lum * 0.6, 0.7, 1.12)      # sRGB; keep some dirt modulation
        alb[m, :3] = alb[m, :3] * (1 - a) + base * a
    return alb


# ============================================================== track texture (procedural, own work + CC0 rust)
def make_track_tex(style, var, prefix, links=4, W=256, H=512):
    """Tiling track-link texture for track_belt UVs (see track_belt). style 'kgs' dry-pin steel links with cleats +
    centre guide horn (Pz II/III/IV); 'zpw' Sd.Kfz. 251 lubricated links with rubber pads. Writes
    <prefix>_{albedo,normal,orm}.jpg; returns the paths."""
    from PIL import Image, ImageFilter
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    f = (V * links) % 1.0
    h = np.zeros((H, W), np.float32)
    polish = np.zeros_like(h); rubber = np.zeros_like(h)
    gap = (f > 0.9)
    # outer face
    o = U < 0.62; uo = U / 0.62
    body = o & ~gap
    h[body] = 0.45
    if style == 'kgs':
        cleat = body & (np.abs(f - 0.45) < 0.13) & (np.abs(uo - 0.5) < 0.44)
        h[cleat] = 1.0; polish[cleat] = 1.0
        boss = o & (f > 0.8) & ((uo < 0.1) | (uo > 0.9))
        h[boss] = 0.75
    else:
        pad = body & (np.abs(f - 0.42) < 0.3) & (np.abs(uo - 0.5) < 0.4)
        h[pad] = 1.0; rubber[pad] = 1.0
    # inner face: wheel paths polished, guide horn raised in the middle
    i = (U >= 0.62) & (U < 0.9); ui = (U - 0.62) / 0.28
    h[i & ~gap] = 0.5
    horn = i & (np.abs(ui - 0.5) < 0.09) & (np.abs(f - 0.45) < 0.25)
    h[horn] = 1.0
    path = i & ~gap & (np.abs(np.abs(ui - 0.5) - 0.27) < 0.12)
    polish[path] = 0.8
    # edges: link side with pin heads
    e = U >= 0.9
    h[e & ~gap] = 0.55
    pin = e & (np.abs(f - 0.93) < 0.06)
    h[pin] = 0.9
    hb = np.asarray(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    rust = np.asarray(Image.open(os.path.join(B.TEX, 'rust_coarse_01', 'diff.jpg')).convert('RGB').resize((W, H))).astype(np.float32) / 255
    lum = rust.mean(2, keepdims=True) / max(1e-3, rust.mean())
    steel = np.array({'burnt': (0.36, 0.22, 0.14)}.get(var, (0.25, 0.22, 0.19)), np.float32)
    col = steel * (0.6 + 0.4 * lum) * (0.85 + 0.15 * rust / max(1e-3, rust.mean()))
    col = np.where(rubber[..., None] > 0, np.array((0.13, 0.125, 0.12)) * (0.8 + 0.2 * lum), col)
    shine = np.array((0.40, 0.39, 0.37), np.float32)
    if var == 'burnt':
        polish *= 0.15
    col = col * (1 - polish[..., None] * 0.6) + shine * polish[..., None] * 0.6
    cav = np.clip(1.0 - hb * 1.6, 0, 1)[..., None]
    dirt = np.array({'grey': (0.33, 0.29, 0.24), 'dak': (0.62, 0.53, 0.39), 'winter': (0.34, 0.32, 0.29),
                     'burnt': (0.10, 0.09, 0.08)}[var], np.float32)
    rng = np.random.default_rng(5)
    blot = np.asarray(Image.fromarray((rng.random((H // 16, W // 16)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32)[..., None] / 255
    amt = np.clip(cav * 1.1 + (blot - 0.4) * 0.8, 0, 1) * (0.9 if var == 'dak' else 0.75)
    amt[..., 0] *= (1 - polish * 0.8)
    col = col * (1 - amt) + dirt * amt
    if var == 'winter':
        snow = np.clip(cav[..., 0] * 1.5 + (blot[..., 0] - 0.55) * 1.2, 0, 1)[..., None] * 0.8
        col = col * (1 - snow) + np.array((0.88, 0.9, 0.92)) * snow
    ao = np.clip(0.55 + hb * 0.5, 0, 1)
    rough = np.clip(0.85 - polish * 0.3 + rubber * 0.08, 0, 1)
    metal = np.clip(0.1 + polish * 0.35 - rubber * 0.1, 0, 1) * (0.3 if var == 'burnt' else 1.0)
    gy, gx = np.gradient(hb * 14.0)
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    paths = {k: f'{prefix}_{k}.jpg' for k in ('albedo', 'normal', 'orm')}
    _save(np.clip(col, 0, 1), paths['albedo'], 88)
    _save(n * 0.5 + 0.5, paths['normal'], 92, 0)
    _save(np.stack([ao, rough, metal], -1), paths['orm'], 90, 0)
    return paths

def tex_material(name, paths, uv='bake'):
    """glTF-ready material from albedo/normal/orm files (occlusion via glTF Material Output group)."""
    m = B.final_material(name, paths)
    for n in m.node_tree.nodes:
        if n.type == 'UVMAP':
            n.uv_map = uv
    return m


# ============================================================== export
LOD_RATIO = {0: 1.0, 1: 0.45, 2: 0.16}

def _dup(ob):
    o = ob.copy(); o.data = ob.data.copy(); B.link(o)
    return o

def _decimate(ob, ratio):
    if ratio >= 0.999 or len(ob.data.polygons) < 24:
        return
    m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    B.apply_all(ob)
    # rework2: collapse drops the sharp-edge marks -> LOD1/2 were smooth-shaded across plate edges (dark, blotchy
    # hull at 0.5x, visible LOD pop). Re-derive hard edges by angle so the shading matches LOD0.
    for pg in ob.data.polygons:
        pg.use_smooth = True
    B.auto_smooth(ob.data, 32)

def _set_single_mat(ob, mat):
    ob.data.materials.clear(); ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.material_index = 0
    for nm in [l.name for l in ob.data.uv_layers if l.name != 'bake' and not l.name.startswith('.')]:
        ob.data.uv_layers.remove(ob.data.uv_layers[nm])

def build_lod(level, atlas_mat, track_mat, pose=None, drop=(), burnt=False):
    """Create the node hierarchy for one LOD; returns list of objects to export."""
    pose = pose or {}
    dropped = lambda p: any(p['name'].startswith(d) or p['node'] == d or p['node'].startswith(d + '_gun') for d in drop)   # rework2: whole nodes too
    objs, nob = [], {}
    inst_mesh = {}
    for nname, nd in A.nodes.items():
        parts = [p for p in A.parts if p['node'] == nname and p['lod'] >= level and not dropped(p)]
        uniq = [p for p in parts if not p.get('inst')]
        merged = [p for p in parts if p.get('inst') and p.get('merge')]      # shared-UV copies baked once
        insts = [p for p in parts if p.get('inst') and not p.get('merge')]
        pv = Vector(nd['pivot'])
        mcp = []
        for p in merged:
            o = B.link(bpy.data.objects.new('__m', p['ob'].data.copy()))
            o.matrix_world = p['ob'].matrix_world.copy()
            B.apply_xform(o)
            mcp.append(o)
        if uniq or mcp:
            cp = [_dup(p['ob']) for p in uniq] + mcp
            ob = B.join(cp, nname) if len(cp) > 1 else cp[0]
            ob.name = nname
            is_track = nname.startswith('track')
            _decimate(ob, LOD_RATIO[level] if not is_track else max(0.35, LOD_RATIO[level]))
            _set_single_mat(ob, track_mat if is_track else atlas_mat)
            ob.data.transform(Matrix.Translation(-pv)); ob.location = pv
        elif len(insts) == 1 and nname != 'hull':
            ob = None
        else:
            ob = B.link(bpy.data.objects.new(nname, None)); ob.location = pv
        kids = []
        for p in insts:
            src = p['ob'].data
            if burnt:                    # rework2: burnt-only replacement meshes (burnt-off tyres -> bare rims)
                src = getattr(A, 'burnt_swap', {}).get(src.name, src)
            key = (src.name, level)
            if key not in inst_mesh:
                me = src.copy()
                tmp = B.link(bpy.data.objects.new('__tmp', me))
                _decimate(tmp, max(0.25, LOD_RATIO[level]))
                _set_single_mat(tmp, atlas_mat)
                inst_mesh[key] = tmp.data
                bpy.data.objects.remove(tmp)
            o = B.link(bpy.data.objects.new(p['name'], inst_mesh[key]))
            o.location = p['ob'].location.copy(); o.rotation_euler = p['ob'].rotation_euler.copy()
            kids.append(o)
        if ob is None:
            ob = kids.pop(0); ob.name = nname
            off = pv - ob.location
            if off.length > 1e-4:     # instance node: pivot must be the instance origin
                print('WARN node pivot != instance origin', nname, tuple(off))
        for k in kids:
            k.location = k.location - pv
            k.parent = ob
            objs.append(k)
        nob[nname] = ob
        objs.append(ob)
    for nname, nd in A.nodes.items():
        ob = nob[nname]
        if nd['parent']:
            par = nob[nd['parent']]
            wl = ob.location.copy()
            ob.parent = par
            ob.location = wl - Vector(A.nodes[nd['parent']]['pivot'])
        if nname in pose:
            ps = pose[nname]
            if 'rot' in ps:
                ob.rotation_euler = tuple(math.radians(a) for a in ps['rot'])
            if 'off' in ps:
                ob.location = ob.location + Vector(ps['off'])
    return objs

def _feather(J, binc):
    """rework2: soft terrain blend for ground-hugging nodes (A.feather = {node: (h0, h1)}): adds COLOR_0 (RGBA, alpha =
    smoothstep(h0, h1, height)) and a copy of the material with alphaMode BLEND, so the spoil apron fades into the
    terrain instead of ending in a hard cookie-cutter edge. three.js GLTFLoader turns on vertexColors (+alpha)."""
    import struct
    fe = getattr(A, 'feather', None)
    if not fe:
        return binc
    binc = bytearray(binc)
    fmat = {}
    for n in J.get('nodes', []):
        if n.get('name') not in fe or 'mesh' not in n:
            continue
        h0, h1 = fe[n['name']]
        for pr in J['meshes'][n['mesh']]['primitives']:
            acc = J['accessors'][pr['attributes']['POSITION']]
            bv = J['bufferViews'][acc['bufferView']]
            o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0); st = bv.get('byteStride', 12)
            ys = [struct.unpack_from('<f', binc, o + i * st + 4)[0] for i in range(acc['count'])]
            col = bytearray()
            for y in ys:
                t = min(1.0, max(0.0, (y - h0) / (h1 - h0))); a = t * t * (3 - 2 * t)
                col += struct.pack('<4f', 1.0, 1.0, 1.0, a)
            while len(binc) % 4:
                binc += b'\0'
            J['bufferViews'].append(dict(buffer=0, byteOffset=len(binc), byteLength=len(col), target=34962))
            binc += col
            J['accessors'].append(dict(bufferView=len(J['bufferViews']) - 1, componentType=5126, count=acc['count'], type='VEC4'))
            pr['attributes']['COLOR_0'] = len(J['accessors']) - 1
            mi = pr.get('material', 0)
            if mi not in fmat:
                m = json.loads(json.dumps(J['materials'][mi])); m['name'] = m.get('name', 'm') + '_feather'
                m['alphaMode'] = 'BLEND'; J['materials'].append(m); fmat[mi] = len(J['materials']) - 1
            pr['material'] = fmat[mi]
    J['buffers'][0]['byteLength'] = len(binc)
    return bytes(binc)

def glb_externalize(path, relmap):
    """Rewrite a GLB so images reference external files (relmap: image name -> relative uri), dropping the
    embedded bytes. Returns (bytes, tris)."""
    import struct
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    J = json.loads(d[20:20 + jl])
    binc = d[20 + jl + 8:]
    binc = _feather(J, binc)
    drop = set()
    for im in J.get('images', []):
        nm = im.get('name')
        if nm in relmap and 'bufferView' in im:
            drop.add(im.pop('bufferView')); im.pop('mimeType', None); im['uri'] = relmap[nm]
    # rebuild the buffer without dropped views
    new, remap = bytearray(), {}
    for i, bv in enumerate(J['bufferViews']):
        if i in drop:
            continue
        o = bv.get('byteOffset', 0)
        chunk = binc[o:o + bv['byteLength']]
        while len(new) % 4:
            new += b'\0'
        bv['byteOffset'] = len(new); new += chunk
        remap[i] = len(remap)
    J['bufferViews'] = [bv for i, bv in enumerate(J['bufferViews']) if i not in drop]
    for acc in J.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] = remap[acc['bufferView']]
    for im in J.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = remap[im['bufferView']]
    while len(new) % 4:
        new += b'\0'
    J['buffers'][0]['byteLength'] = len(new)
    js = json.dumps(J, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
        + struct.pack('<II', len(new), 0x004E4942) + bytes(new)
    open(path, 'wb').write(out)
    tris = 0
    for n in J.get('nodes', []):
        if 'mesh' in n:
            for pr in J['meshes'][n['mesh']]['primitives']:
                tris += J['accessors'][pr['indices']]['count'] // 3
    return len(out), tris


def burnt_swap(intact_src, burnt_src, key='paint'):
    """Register burnt_src (origin-centred mesh object) to replace every instance of intact_src in the *_burnt
    GLBs. It is baked into the shared atlas through a never-exported representative (lod -1)."""
    if not hasattr(A, 'burnt_swap'):
        A.burnt_swap = {}
    instance(burnt_src, burnt_src.name + '_rep', (6.0, 0, 0.3), 'hull', key=key, lod=-1)
    A.burnt_swap[intact_src.data.name] = burnt_src.data

def mirrored_mesh(src, name):
    """Left-hand copy of an origin-centred +X-facing mesh (mirror X, normals fixed) for instancing."""
    me = src.data.copy(); me.name = name
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0))); me.flip_normals()
    o = B.link(bpy.data.objects.new(name, me))
    o.hide_render = o.hide_viewport = True
    return o

CREDITS = [
    dict(asset='green_metal_rust (paint breakup/normal)', source='Poly Haven', license='CC0'),
    dict(asset='rust_coarse_01 (bare steel, tracks)', source='Poly Haven', license='CC0'),
    dict(asset='Rubber004 (tyres)', source='ambientCG', license='CC0'),
    dict(asset='weathered_planks (tool handles, stocks)', source='Poly Haven', license='CC0'),
    dict(asset='Fabric030 / Fabric045 (sandbags, canvas)', source='ambientCG', license='CC0'),
    dict(asset='sand_01 / dense_sand (earth)', source='Poly Haven', license='CC0'),
    dict(asset='geometry, procedural paint/whitewash/burn shaders, track texture, markings (Balkenkreuz, tactical numbers)',
         source='own work (SHADOW SIX, Blender script)', license='CC0'),
]

def finalize(res=2048, dims=None, burnt_pose=None, burnt_drop=(), track_style='kgs', info=None, variants=VARIANTS,
             destructible=True):
    t0 = time.time()
    name, out = A.name, A.out
    TG = lambda sz: f'{sz // 1024}k' if sz >= 1024 else str(sz)
    HI, LO = TG(res), TG(res // 2)
    tex = os.path.join(out, 'tex'); os.makedirs(tex, exist_ok=True)
    for f in os.listdir(tex):                  # stale maps from earlier builds
        os.remove(os.path.join(tex, f))
    for p in A.parts:                  # free clean names for the exported nodes
        p['name'] = p['ob'].name.split('.')[0]
        p['ob'].name = '~' + p['name']
        if not p.get('inst'):
            B.apply_all(p['ob'])
    tracks = [p for p in A.parts if p['node'].startswith('track')]
    uniq = [p['ob'] for p in A.parts if not p.get('inst') and p not in tracks]
    reps = list(A.inst_src.values())
    for o in uniq:
        B.box_uv(o, 1.0)
    for o in reps:
        B.box_uv(o, 1.0, world=False)
    B.unwrap_atlas(uniq + reps, angle=60, margin=0.003)
    wts = {p['ob'].data.name: p['uv'] for p in A.parts if p.get('uv', 1.0) != 1.0 and not p.get('inst')}
    if wts:                            # texel-density weights (large flat ground parts get less atlas), then repack
        for o in uniq:
            w = wts.get(o.data.name)
            if w:
                uvl = o.data.uv_layers['bake']
                for d in uvl.data:
                    d.uv = d.uv * w
        bpy.ops.object.select_all(action='DESELECT')
        for o in uniq + reps:
            o.select_set(True); o.data.uv_layers.active = o.data.uv_layers['bake']
        bpy.context.view_layer.objects.active = uniq[0]
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.select_all(action='SELECT')
        except Exception as e:
            print('uv select_all skipped', e)
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', margin=0.003, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    for p in tracks:
        p['ob'].data.uv_layers.new(name='UVMap')
    B.log('unwrapped', len(uniq), 'parts', len(reps), 'instanced meshes')
    rng = np.random.default_rng(3)
    files, first, geo = {}, True, {}
    for var in variants:
        if var == 'burnt' and not destructible:
            continue
        r = bake_variant(var, uniq, reps, res, first)
        if first:
            geo = dict(normal=r['normal'], ao=r['ao'], pos=r['pos'], nrm=r['nrm'])
            cov = r['pos'][..., 3] > 0.5
            if cov.mean() < 0.05 or cov.mean() > 0.995:     # alpha not written by the bake -> any baked colour
                cov = r['albedo'][..., :3].sum(-1) > 1e-4
            B.log('atlas coverage %.3f' % cov.mean())
            geo['normal'] = _fill(geo['normal'], cov); geo['ao'] = _fill(geo['ao'], cov)
            first = False
            for sz in (res, res // 2):
                _save(geo['normal'], os.path.join(tex, f'{name}_normal_{TG(sz)}.jpg'), 92, 0, sz)
        alb = r['albedo']
        if var != 'burnt':
            alb = stamp_decals(alb, geo['pos'], geo['nrm'], var, rng)
        ao = geo['ao'][..., :1]
        alb = alb.copy(); alb[..., :3] *= (0.55 + 0.45 * ao) ** 0.5
        if A.details:                              # weld/bolt relief: dark grime rim + lighter crest
            nz = geo['normal'][..., 2:3] * 2 - 1
            cav = np.clip((1.0 - nz) * 7.0, 0, 1)
            dc = np.array([DUST[var][0] * 0.55, DUST[var][1] * 0.55, DUST[var][2] * 0.55], np.float32) ** (1 / 2.2)
            alb[..., :3] = alb[..., :3] * (1 - cav * 0.38) + dc * cav * 0.38
        orm = np.concatenate([geo['ao'][..., :1], r['rough'][..., :1], r['metal'][..., :1]], -1)
        alb = _fill(alb, cov); orm = _fill(orm, cov)
        for sz in (res, res // 2):
            k = TG(sz)
            _save(alb, os.path.join(tex, f'{name}_{var}_albedo_{k}.jpg'), 88, 2, sz)
            if sz == res // 2:          # ORM (AO/rough/metal) is low-frequency: one half-res map for every LOD
                _save(orm, os.path.join(tex, f'{name}_{var}_orm_{k}.jpg'), 88, 0, sz)
        if tracks:
            make_track_tex(track_style, var, os.path.join(tex, f'track_{track_style}_{var}'))
        files[var] = dict(albedo=f'tex/{name}_{var}_albedo_{HI}.jpg', orm=f'tex/{name}_{var}_orm_{LO}.jpg',
                          normal=f'tex/{name}_normal_{HI}.jpg', albedo_lo=f'tex/{name}_{var}_albedo_{LO}.jpg',
                          orm_lo=f'tex/{name}_{var}_orm_{LO}.jpg', normal_lo=f'tex/{name}_normal_{LO}.jpg',
                          theater=THEATER[var])
        if tracks:
            files[var]['track'] = {k: f'tex/track_{track_style}_{var}_{k}.jpg' for k in ('albedo', 'normal', 'orm')}
    B.log('textures done %.1fs' % (time.time() - t0))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, name + '.blend'))
    for o in [p['ob'] for p in A.parts]:
        o.hide_render = True; o.hide_viewport = False
    lods, relmap = [], {}
    sets = [('', 'grey', {}, ())] + ([('_burnt', 'burnt', burnt_pose or {}, burnt_drop)] if destructible and 'burnt' in variants else [])
    for suffix, var, pose, drop in sets:
        for lv in (0, 1, 2):
            k = HI if lv == 0 else LO
            paths = {'albedo': os.path.join(tex, f'{name}_{var}_albedo_{k}.jpg'), 'orm': os.path.join(tex, f'{name}_{var}_orm_{LO}.jpg')}
            paths['normal'] = os.path.join(tex, f'{name}_normal_{k}.jpg')
            am = tex_material(f'{name}_{var}_{k}', paths)
            tm = None
            if tracks:
                tm = tex_material(f'track_{track_style}_{var}', {m: os.path.join(tex, f'track_{track_style}_{var}_{m}.jpg') for m in ('albedo', 'normal', 'orm')})
            for pth in list(paths.values()) + ([os.path.join(tex, f'track_{track_style}_{var}_{m}.jpg') for m in ('albedo', 'normal', 'orm')] if tracks else []):
                relmap[os.path.splitext(os.path.basename(pth))[0]] = 'tex/' + os.path.basename(pth)
            objs = build_lod(lv, am, tm, pose, drop, burnt=suffix == '_burnt')
            fn = os.path.join(out, f'{name}{suffix}_lod{lv}.glb')
            B.export_glb(fn, objs)
            size, tris = glb_externalize(fn, relmap)
            lods.append(dict(file=os.path.basename(fn), variant=var, lod=lv, tris=tris, bytes=size))
            B.log('LOD', fn, tris, 'tris', size // 1024, 'KB')
            for o in objs:
                bpy.data.objects.remove(o)
    write_sidecar(dims, files, lods, info)
    B.log('finalize total %.1fs' % (time.time() - t0))


def _bbox():
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for p in A.parts:
        o = p['ob']
        if o.hide_viewport and not p.get('inst'):
            pass
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

def write_sidecar(dims, files, lods, info):
    lo, hi = _bbox()
    def loc(pos, nd):
        pv = Vector(A.nodes[nd]['pivot']) if nd in A.nodes else Vector()
        return g2(Vector(pos) - pv)
    nodes = []
    for n, nd in A.nodes.items():
        par = nd['parent']
        pp = Vector(A.nodes[par]['pivot']) if par else Vector()
        e = dict(name=n, parent=par, kind=nd['kind'], pivot=g2(nd['pivot']), local=g2(Vector(nd['pivot']) - pp))
        if nd['axis']:
            e['axis'] = g2(nd['axis'])
        e.update(nd['extra'])
        nodes.append(e)
    for L in ('sockets', 'muzzles', 'emitters', 'lights', 'contacts'):     # unique names
        seen = {}
        for d in A.meta[L]:
            k = d['name']; seen[k] = seen.get(k, 0) + 1
        cnt = {}
        for d in A.meta[L]:
            k = d['name']
            if seen[k] > 1:
                cnt[k] = cnt.get(k, 0) + 1
                x = d['pos'][0]
                d['name'] = f"{k}_{'L' if x > 0.05 else 'R' if x < -0.05 else 'C'}{cnt[k]}"
    conv = lambda L: [dict(d, pos=g2(d['pos']), local=loc(d['pos'], d['node']),
                           **({'dir': g2(d['dir'])} if 'dir' in d else {}),
                           **({'heading': d['heading']} if d.get('heading') is not None else {})) for d in L]
    M = dict(name=A.name, generator='vehicles/armour/scripts (vlib.py on blib.py), Blender 4.2',
             coords='glTF/game metres: +x = vehicle LEFT (east when facing south at rot 0), y up, +z = vehicle front; root pivot = ground centre',
             dims_real=dims, bbox_game=dict(min=g2((lo.x, hi.y, lo.z)), max=g2((hi.x, lo.y, hi.z))),
             size=[round(hi.x - lo.x, 3), round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)],
             nodes=nodes, tracks=[dict(t, material='track (UV-scroll: offset.y += v_per_m * distance)') for t in A.meta['tracks']],
             sockets=conv(A.meta['sockets']), muzzles=conv(A.meta['muzzles']), emitters=conv(A.meta['emitters']),
             lights=conv(A.meta['lights']), contacts=conv(A.meta['contacts']),
             markings=[dict(img=d['img'], node=d['node'], center=g2(d['center'])) for d in A.meta['decals']],
             variants=files, default_variant='grey',
             variant_note='LOD GLBs reference the grey set by relative URI; swap map/roughnessMap/metalnessMap/aoMap for '
                          'dak (desert) / winter (snow). Burnt = separate <name>_burnt_lod*.glb (posed, parts dropped).',
             lods=lods, credits=CREDITS, info=info or {})
    json.dump(M, open(os.path.join(A.out, A.name + '.veh.json'), 'w'), indent=1)
    json.dump(dict(asset=A.name, credits=CREDITS), open(os.path.join(A.out, A.name + '.credits.json'), 'w'), indent=1)
    print('SIDECAR', A.name, json.dumps([(l['file'], l['tris'], l['bytes']) for l in lods]))


# ============================================================== tracked running gear (Pz II/III/IV, 251 rear)
def running_gear(xc, road, road_src, spr, spr_src, idl, idl_src, rollers=(), roll_src=None, track_w=0.4, thick=0.05,
                 pitch=0.12, sag=0.03, tile_links=4, style='kgs'):
    """xc = |x| of the track centre; road = [(y, z)] road-wheel centres (radius from road_src['r']);
    spr/idl = (y, z, r_belt); rollers = [(y, z, r)]. *_src = dict(ob=origin mesh (+X outer face), r=radius).
    Vehicle LEFT = +X (Blender, facing -Y). Registers wheel/sprocket/idler/roller nodes, both belts, contacts."""
    meshes = {}
    for key, src in (('road', road_src), ('spr', spr_src), ('idl', idl_src), ('roll', roll_src)):
        if src:
            meshes[key] = (src['ob'], mirrored_mesh(src['ob'], src['ob'].name + '_L'))
    for side, sx in (('L', 1), ('R', -1)):
        mi = 0 if sx > 0 else 1          # source meshes face +X = vehicle left
        x = sx * xc
        circ = []
        for i, (y, z) in enumerate(road):
            nn = node(f'wheel_{side}{i + 1}', (x, y, z), 'hull', 'wheel', (1, 0, 0), radius=road_src['r'])
            instance(meshes['road'][mi], nn, (x, y, z), nn)
            circ.append((y, z, road_src['r']))
        for nm, (y, z, rb), key in (('sprocket', spr, 'spr'), ('idler', idl, 'idl')):
            nn = node(f'{nm}_{side}', (x, y, z), 'hull', 'wheel', (1, 0, 0), radius=rb, drives_track=nm == 'sprocket')
            instance(meshes[key][mi], nn, (x, y, z), nn)
            circ.append((y, z, rb))
        for i, (y, z, rr) in enumerate(rollers):
            nn = node(f'roller_{side}{i + 1}', (x, y, z), 'hull', 'wheel', (1, 0, 0), radius=rr)
            instance(meshes['roll'][mi], nn, (x, y, z), nn)
            circ.append((y, z, rr))
        tn = node(f'track_{side}', (x, 0, 0), 'hull', 'track')
        belt, path, total = track_belt(tn, x, circ, track_w, thick, tile_links, pitch, sag)
        P(belt, tn, 'track', lod=2)
        ys = [c[0] for c in road]
        contact(f'track_{side}_front', (x, min(ys), 0.0), 'track', track_w=track_w)
        contact(f'track_{side}_rear', (x, max(ys), 0.0), 'track', track_w=track_w)
        emitter(f'dust_{side}', (x, max(ys) + road_src['r'], 0.1), 'hull', (0, 1, 0.4), 'dust')
        emitter(f'mud_{side}', (x, spr[0], spr[1]), f'sprocket_{side}', (0, -0.3, 1), 'mud')
    return meshes
