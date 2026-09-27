# hudtools.py - top-right HUD tools as real objects: 1940s newsreel camera, alarm beacon (off/on), brass "?" badge, notebook.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import sl, bx, cy, MM
from tools import ring, rsec, nickel, brass_mat, pencil
from misc import rubber_mat


def crinkle(name='crinkle', color=(0.06, 0.06, 0.06)):
    """Black crinkle-finish paint (fine wrinkled texture) with worn edges to bare aluminium."""
    t = M.NT(name)
    edge, bn = t.edge(radius=0.0015, gain=4.0, noise=0.7, nscale=300.0)
    vr = t.n('ShaderNodeTexVoronoi', feature='F1', i_Scale=2600.0); t.L(t.coords(1.0), vr.inputs['Vector'])
    w = t.math('GREATER_THAN', t.math('MULTIPLY', edge, 1.0), 0.5)
    t.L(t.mix(w, M.lin((0.11, 0.11, 0.11)), M.lin((0.62, 0.62, 0.6))), t.p.inputs['Base Color'])
    t.L(t.mix(w, (0.5, 0.5, 0.5), (0.3, 0.3, 0.3)), t.p.inputs['Roughness'])
    t.L(w, t.p.inputs['Metallic'])
    t.L(t.bump(vr.outputs['Distance'], strength=0.5, dist=0.0003, normal=bn), t.p.inputs['Normal'])
    return t.m


def reel(name, R, mat_side, film, ni, loc):
    """Spoked film reel (seen side-on along X): pressed-steel flanges with five cut-outs round a hub, a wound
    film pack between them (visible through the cut-outs) and a knurled hub cap."""
    P = []
    for sx in (-1, 1):
        fl = D.cyl(f'{name}_fl{sx}', R * MM, 2.2 * MM, mat_side, loc=(sx * 13 * MM, 0, 0), rot=(0, 90, 0), segs=72, bevel=0.6 * MM)
        P.append(fl)
        for k in range(5):   # cut-outs: film seen through the flange (inset windows with a rolled lip)
            a = 2 * math.pi * k / 5 + 0.3
            yy, zz = R * 0.56 * MM * math.cos(a), R * 0.56 * MM * math.sin(a)
            P.append(D.cyl(f'{name}_w{sx}{k}', R * 0.22 * MM, 2.4 * MM, film, loc=(sx * 13.2 * MM, yy, zz), rot=(0, 90, 0), segs=32, bevel=0.2 * MM))
            P.append(ring(f'{name}_lip{sx}{k}', R * 0.22 + 0.8, rsec(1.6, 1.4, 8), mat_side, segs=32, loc=(sx * 14.3 * MM, yy, zz), rot=(0, 90, 0)))
    P.append(D.cyl(f'{name}_film', R * 0.82 * MM, 24 * MM, film, rot=(0, 90, 0), segs=64, bevel=0.3 * MM))
    P.append(D.cyl(f'{name}_hub', R * 0.2 * MM, 32 * MM, ni, rot=(0, 90, 0), segs=32, bevel=1 * MM))
    for o in P: o.location = Vector(o.location) + Vector(loc)
    return P


def movie_camera():
    """1930s newsreel camera (the tracking-camera metaphor): black leather-covered body with nickel edge trim and a
    brass maker's plate, twin spoked film reels on top with the film running between them, a lens turret with
    brass-ringed lenses, side crank with a turned wooden knob and a finder tube."""
    ni = nickel(); br = brass_mat(); gl = M.glass('lens_glass', color=(0.55, 0.68, 0.78), rough=0.0)
    lt = M.textured('cam_leather2', 'brown_leather', tint=(0.20, 0.17, 0.15), scale=0.05, nstrength=0.9, coat=0.3)
    blk = M.solid('lens_black', M.lin((0.05, 0.05, 0.05)), rough=0.35, bevel=0.0005)
    enam = M.solid('cam_enamel', M.lin((0.06, 0.06, 0.065)), rough=0.25, coat=0.6, bevel=0.001)
    film = M.solid('film_pack2', M.lin((0.42, 0.24, 0.09)), rough=0.25, coat=0.7, var=0.2, vscale=400.0)
    flange = M.paint('reel_steel', M.lin((0.22, 0.22, 0.23)), rough=0.35, wear=1.0, under=M.lin((0.7, 0.7, 0.72)), chips=0.25)
    wd = M.wood('knob_wood', tint=(1.3, 0.9, 0.6), tex='fine_grained_wood', scale=0.05, rough=0.35, coat=0.5)
    P = [D.box('body', (0.080, 0.150, 0.118), lt, loc=(0, 0, 0.059), bevel=0.010, segs=4)]
    for z in (0.002, 0.116):
        P.append(D.box(f'trim{z}', (0.084, 0.154, 0.006), ni, loc=(0, 0, z), bevel=0.0025))
    P.append(D.box('plate', (0.002, 0.07, 0.022), br, loc=(-0.041, 0.005, 0.085), bevel=0.0008))
    P.append(D.box('door', (0.003, 0.118, 0.090), enam, loc=(0.041, 0.0, 0.060), bevel=0.003))
    for y in (-0.06, 0.06):
        P += reel(f'reel{int(y * 100)}', 58, flange, film, ni, (0, y, 0.182))
        P.append(D.box(f'arm{y}', (0.03, 0.018, 0.07), flange, loc=(0, y * 0.9, 0.14), bevel=0.004))
    P.append(D.tube('filmstrip', [(0.0, -0.06, 0.232), (0.0, -0.02, 0.21), (0.0, 0.0, 0.16), (0.0, 0.02, 0.21), (0.0, 0.06, 0.232)], 0.0035, film, segs=8))
    # lens turret (front, -Y)
    P.append(cy('turret', 44, 10, enam, 0, -80, 58, 'Y', 48, 2))
    for k, (x, z, L, r) in enumerate(((0.0, 0.080, 0.058, 0.020), (-0.028, 0.040, 0.030, 0.014), (0.028, 0.040, 0.038, 0.015))):
        P.append(D.lathe(f'lens{k}', [(0, 0), (r, 0), (r, L * 0.8), (r * 1.15, L * 0.85), (r * 1.15, L), (0, L)], blk, segs=48,
                         loc=(x, -0.085, z - 0.02), rot=(90, 0, 0)))
        P.append(cy(f'glass{k}', r * 900, 1, gl, x * 1000, -85 - L * 1000 - 0.6, (z - 0.02) * 1000, 'Y', 48, 0))
        P.append(D.lathe(f'brass{k}', [(0, 0), (r * 1.2, 0), (r * 1.2, 0.004), (0, 0.004)], br, segs=48, loc=(x, -0.085 - L + 0.004, z - 0.02), rot=(90, 0, 0)))
    # finder tube on top-front, crank on the +X side
    P.append(cy('finder', 11, 110, enam, 30, -10, 124, 'Y', 32, 2))
    P.append(cy('finder_lens', 12, 4, br, 30, -66, 124, 'Y', 32, 1))
    P.append(cy('crank_hub', 12, 10, ni, 45, 10, 60, 'X', 32, 1.5))
    P.append(D.box('crank_arm', (0.006, 0.012, 0.05), ni, loc=(0.051, 0.010, 0.040), bevel=0.002))
    P.append(cy('crank_knob', 7, 26, wd, 64, 10, 18, 'X', 24, 2.5))
    return P


@S.shot('camera')
def _camera(mode):
    D.group('moviecam', movie_camera(), rot=(0, 0, 58))
    S.shoot('camera', 'tool', box=(48, 41), preset='tool', margin=0.03, shadow=False, light={'rim': 1.0})


def lamp(on=False):
    """Red glass alarm beacon on a steel base with a wire guard cage (off: dark ruby glass; on: lit filament)."""
    st = M.paint('lamp_base', M.lin((0.28, 0.29, 0.27)), rough=0.45, wear=0.9, under=M.lin((0.6, 0.6, 0.6)))
    ni = nickel()
    # off: dark, unlit smoked ruby (reads as "no alarm" at a glance); on: bright lit red
    glass = M.glass('ruby_on' if on else 'ruby_off2', color=(0.95, 0.12, 0.08) if on else (0.22, 0.035, 0.03), rough=0.08 if on else 0.18, ior=1.5)
    P = [D.lathe('base', [(0, 0), (0.042, 0), (0.044, 0.004), (0.044, 0.016), (0.036, 0.022), (0.034, 0.03), (0, 0.03)], st, segs=64)]
    P.append(D.lathe('dome', [(0.0305, 0.03), (0.0305, 0.085), (0.029, 0.098), (0.022, 0.110), (0.012, 0.116), (0, 0.118),
                              (0, 0.114), (0.011, 0.112), (0.020, 0.106), (0.027, 0.095), (0.0285, 0.085), (0.0285, 0.03)], glass, segs=64, cap=False, smooth_angle=80))
    P.append(ring('collar', 31, rsec(3, 6, 0), ni, segs=64, loc=(0, 0, 0.032)))
    for k in range(6):   # guard cage
        a = 2 * math.pi * k / 6
        pts = [(0.034 * math.cos(a), 0.034 * math.sin(a), 0.033), (0.034 * math.cos(a), 0.034 * math.sin(a), 0.088),
               (0.026 * math.cos(a), 0.026 * math.sin(a), 0.113), (0.0, 0.0, 0.123)]
        P.append(D.tube(f'wire{k}', pts, 0.0016, ni, segs=8))
    P.append(ring('hoop', 34, rsec(3.2, 3.2, 8), ni, segs=64, loc=(0, 0, 0.062)))
    P.append(cy('socket', 10, 22, ni, 0, 0, 42, 'Z', 32, 1))
    fil = M.emission('filament', M.lin((1.0, 0.55, 0.3)), 60.0 if on else 0.0, base=M.lin((0.4, 0.3, 0.2)))
    bulb = D.lathe('bulb', [(0, 0.052), (0.012, 0.058), (0.016, 0.07), (0.013, 0.082), (0, 0.086)],
                   M.emission('bulb_on' if on else 'bulb_off', M.lin((1.0, 0.12, 0.05)), 3.5 if on else 0.0, base=M.lin((0.8, 0.75, 0.7))), segs=32)
    P.append(bulb)
    if on:
        ld = bpy.data.lights.new('glow', 'POINT'); ld.energy = 2.5; ld.color = (1.0, 0.12, 0.05); ld.shadow_soft_size = 0.01
        lo = bpy.data.objects.new('glow', ld); bpy.context.scene.collection.objects.link(lo); lo.location = (0, 0, 0.07)
    return P


@S.shot('lamp')
def _lamp(mode):
    for on in (False, True):
        if on: S.reset()
        D.group('beacon', lamp(on))
        S.shoot('lamp.on' if on else 'lamp.off', 'tool', box=(26, 41), preset='tool', margin=0.03, shadow=False,
                extra={'glow': [1.0, 0.25, 0.1]} if on else None)


ANTON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'assets', 'fonts', 'Anton-Regular.ttf')


def help_badge():
    """Die-struck brass '?' on an oxblood vitreous-enamel plaque with a raised brass rim."""
    br = M.metal('badge_brass', M.lin((0.80, 0.63, 0.32)), rough=0.24, wear=0.9, wear_color=M.lin((0.98, 0.88, 0.6)), grain=0.3)
    en = M.solid('enamel_oxblood', M.lin((0.36, 0.05, 0.05)), rough=0.08, coat=1.0, var=0.12, vscale=90.0, bevel=0.0003)
    W, H = 34, 58
    outer = D.chaikin([(-W / 2, -H / 2), (W / 2, -H / 2), (W / 2, H / 2), (-W / 2, H / 2)], 4, True)
    P = [sl('plate', [(x, y) for x, y in outer], 3.0, br, bevel=0.9, plane='XY')]
    inner = D.chaikin([(-W / 2 + 3, -H / 2 + 3), (W / 2 - 3, -H / 2 + 3), (W / 2 - 3, H / 2 - 3), (-W / 2 + 3, H / 2 - 3)], 4, True)
    e = sl('enamel', [(x, y) for x, y in inner], 1.0, en, bevel=0.2, plane='XY'); e.location.z = 1.6 * MM; P.append(e)
    ivory = M.solid('ivory_enamel', M.lin((0.93, 0.88, 0.74)), rough=0.12, coat=1.0, var=0.05, bevel=0.0003)
    q = D.text('q', '?', 0.050, ivory, loc=(0, -0.0015, 0.0021), extrude=0.0012, font=ANTON, bevel=0.0005)
    q.data.bevel_resolution = 3
    P.append(q)
    return P


@S.shot('help')
def _help(mode):
    D.group('badge', help_badge(), rot=(90 - 8, 0, 0))
    S.shoot('help', 'tool', box=(24, 41), preset='badge', margin=0.03, shadow=False)


def spiral_strip(H=216.0, pitch=7.0):
    """Notebook binding (1 unit = 1 ref px = 1 mm): steel wire coils wrapping the page edge through punched holes,
    with the Spy's pencil tucked down the coil at the top. Faces -Y (front, 'front' ortho camera)."""
    ni = M.metal('coil_steel', M.lin((0.70, 0.70, 0.70)), rough=0.22, wear=0.3)
    hole = M.solid('punch', M.lin((0.03, 0.025, 0.02)), rough=0.8, spec=0.0)
    edge = paper_mat('nb_edge')
    P = [D.box('edge', (6 * MM, 1.0 * MM, H * MM), edge, loc=(-4 * MM, 1.0 * MM, H / 2 * MM), bevel=0.3 * MM)]
    n = int((H - 6) // pitch)
    for k in range(n):
        z = (6 + k * pitch) * MM
        P.append(D.cyl(f'hole{k}', 1.3 * MM, 0.4 * MM, hole, loc=(-3.2 * MM, 0.3 * MM, z), rot=(90, 0, 0), segs=16, bevel=0))
        P.append(ring(f'coil{k}', 3.4, rsec(1.3, 1.3, 8), ni, a0=-110, a1=200, segs=24, loc=(0.2 * MM, 0.0, z), rot=(90, 0, 0), bevel=0.0))
    pc = pencil((0.20, 0.34, 0.20))
    D.group('pencilg', pc, loc=(-6.0 * MM, -6 * MM, 201 * MM), rot=(0, 90, 0), scale=0.85)   # tucked in the coil, tip down
    return P


def paper_mat(name, rules=False):
    """Field-notebook paper: aged cream with fibre mottling, darker handled edges; optional feint blue rules
    every 10 mm and a red margin (the open page)."""
    t = M.NT(name)
    vec = t.coords(1.0)
    fib = t.noise(900.0, 8.0, 0.6); blot = t.noise(25.0, 4.0, 0.5)
    c = t.mix(t.math('MULTIPLY', blot, 0.35), M.lin((0.84, 0.80, 0.66)), M.lin((0.70, 0.64, 0.48)))
    c = t.mix(t.math('MULTIPLY', fib, 0.15), c, M.lin((0.62, 0.58, 0.46)))
    if rules:
        w = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', i_Scale=100.0, i_Distortion=0.0)
        t.L(vec, w.inputs['Vector'])
        line = t.math('GREATER_THAN', w.outputs['Fac'], 0.93)
        c = t.mix(t.math('MULTIPLY', line, 0.45), c, M.lin((0.30, 0.40, 0.62)))
    t.L(c, t.p.inputs['Base Color'])
    t.set('Roughness', 0.85); t.set('Specular IOR Level', 0.2)
    t.L(t.bump(fib, strength=0.05, dist=0.0003), t.p.inputs['Normal'])
    return t.m


@S.shot('notebook')
def _nb(mode):
    D.group('spiral', spiral_strip())
    S.shoot('notebook', 'tool', box=(16, 216), preset='front', margin=0.0, shadow=False, scale=6, extra={'nocrop': True})


@S.shot('notebook.page')
def _nbpage(mode):
    """The page (177 x 215 ref px) for the open and closed notebook: rendered paper, rules, red margin, soft curl."""
    pm = paper_mat('nb_page', rules=True)
    pg = D.box('page', (177 * MM, 0.6 * MM, 215 * MM), pm, loc=(0, 0, 0), bevel=0.2 * MM)
    m = pg.modifiers.new('sub', 'SUBSURF'); m.levels = 3; m.subdivision_type = 'SIMPLE'
    D.deform(pg, lambda v: Vector((v.x, v.y + 0.0025 * max(0.0, (v.x / 0.0885) - 0.55) ** 2, v.z)))   # page lifts at the free edge
    red = M.solid('margin_red', M.lin((0.62, 0.18, 0.15)), rough=0.8)
    P = [pg, D.box('margin', (0.5 * MM, 0.2 * MM, 215 * MM), red, loc=(-60 * MM, -0.45 * MM, 0), bevel=0)]
    D.group('pageg', P)
    S.shoot('notebook.page', 'tool', box=(177, 215), preset='front', margin=0.0, shadow=False, scale=4, extra={'nocrop': True, 'tiers': [2, 3, 4]},
            light={'rim': 0.0})


def eye_disc(name, img_path, rx, ry, z):
    """Elliptical disc (rx, ry metres) in XZ facing -Y, UV-mapped to `img_path` and shown as emission (the render of
    the eye, unrelit) so it sits behind the porthole glass like a painted enamel plate."""
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=1.0, fill_type='TRIFAN')
    o = bpy.context.active_object; o.name = name
    me = o.data; uv = me.uv_layers.new(name='UV')
    for v in me.vertices: v.co = Vector((v.co.x * rx, 0.0, v.co.y * ry))
    im = bpy.data.images.load(img_path, check_existing=True); ia = im.size[0] / im.size[1]
    # cover-fit the image into the ellipse box
    su, sv = (1.0, (2 * rx / (2 * ry)) / ia) if (2 * rx) / (2 * ry) > ia else (ia / ((2 * rx) / (2 * ry)), 1.0)
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (0.5 + co.x / (2 * rx) / (su * 1.22), 0.47 + co.z / (2 * ry) / (sv * 1.22))   # zoom onto the eye
    t = M.NT(name + '_m')
    tx = t.n('ShaderNodeTexImage', image=im, interpolation='Cubic', extension='EXTEND')
    em = t.n('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.92
    t.L(tx.outputs['Color'], em.inputs['Color'])
    out = t.nt.nodes['Material Output']; t.L(em.outputs[0], out.inputs['Surface'])
    me.materials.append(t.m)
    o.location = (0, z, 0)
    return o


def porthole(eye_png):
    """Brass oval porthole (bezel with four slotted screws, dark enamel back ring) framing the eye behind a slightly
    domed glass: the eye tool sits in its own frame like the original's framed slot."""
    br = M.metal('port_brass', M.lin((0.72, 0.56, 0.30)), rough=0.3, wear=0.9, wear_color=M.lin((0.95, 0.84, 0.58)), grain=0.5)
    en = M.solid('port_enamel', M.lin((0.05, 0.045, 0.04)), rough=0.3, coat=0.6)
    gl = M.glass('port_glass', color=(0.97, 0.98, 0.98), rough=0.02)
    SX = 1.30
    P = []
    back = ring('backring', 18.5, [(-4, -1.5), (3, -1.5), (3, 1.5), (-4, 1.5)], en, segs=96, loc=(0, 0.004, 0), rot=(90, 0, 0), bevel=0.0003)
    back.scale = (SX, 1, 1); P.append(back)
    bez = ring('bezel', 18.2, rsec(4.4, 3.4, 16), br, segs=96, loc=(0, -0.0012, 0), rot=(90, 0, 0), bevel=0.0)
    bez.scale = (SX, 1, 1); P.append(bez)
    inner = ring('lip', 15.6, rsec(1.2, 2.2, 8), br, segs=96, loc=(0, -0.0006, 0), rot=(90, 0, 0), bevel=0.0)
    inner.scale = (SX, 1, 1); P.append(inner)
    P.append(eye_disc('eyeimg', eye_png, 15.9 * SX * MM, 15.9 * MM, 0.0022))
    dome = D.lathe('dome', [(0, -0.0012), (0.0158, 0.0), (0.0158, 0.0004), (0, -0.0008)], gl, segs=96, rot=(90, 0, 0))
    dome.scale = (SX, 1, 1); P.append(dome)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        x, z = 18.2 * SX * math.cos(a) * MM, 18.2 * math.sin(a) * MM
        P.append(cy(f'screw{k}', 1.5, 1.2, br, x * 1000, -3.2, z * 1000, 'Y', 24, 0.4))
        P.append(D.box(f'slot{k}', (2.6 * MM, 0.5 * MM, 0.45 * MM), en, loc=(x, -3.85 * MM, z), rot=(0, 30 + 40 * k, 0), bevel=0))
    return P


@S.shot('eyeport')
def _eyeport(mode):
    for tag in ('open', 'closed'):
        S.reset()
        D.group('porthole', porthole(os.path.join(S.MASTERS, 'raw', f'eye.{tag}.png')))
        S.shoot(f'eye.{tag}', 'tool', box=(52, 41), preset='front', elev=5, azim=-6, margin=0.02, shadow=False)
        S.shoot(f'eye.{tag}', 'cursor', box=(32, 26), preset='front', elev=5, azim=-6, margin=0.02, shadow=False)   # eye tool cursor
