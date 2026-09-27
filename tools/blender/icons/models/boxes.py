# boxes.py - charges, timers, radios, detonator, first-aid tin, cigarettes, chloroform, blackjack, knuckles.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import sl, bx, cy, MM, walnut
from tools import ring, rsec, nickel, brass_mat, od_paint


def paper(name, color, wrinkle=0.5, rough=0.55):
    t = M.NT(name)
    n = t.noise(40.0, 6.0, 0.6); w = t.noise(9.0, 4.0, 0.5)
    c = t.mix(t.math('MULTIPLY', n, 0.5), color, tuple(v * 0.7 for v in color))
    edge, bn = t.edge(radius=0.002, gain=3.0, noise=0.6, nscale=200.0)
    t.L(t.mix(t.math('MULTIPLY', edge, 0.6), c, tuple(min(1, v * 1.4) for v in color)), t.p.inputs['Base Color'])
    t.L(t.math('MULTIPLY_ADD', n, 0.2, rough - 0.1), t.p.inputs['Roughness'])
    wr = t.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=14.0); t.L(t.coords(1.0), wr.inputs['Vector'])
    h = t.math('ADD', t.math('MULTIPLY', w, 0.6), t.math('MULTIPLY', t.math('POWER', wr.outputs['Distance'], 0.3), 0.4))
    t.L(t.bump(h, strength=wrinkle, dist=0.001, normal=bn), t.p.inputs['Normal'])
    t.set('Coat Weight', 0.25); t.set('Coat Roughness', 0.35)
    return t.m


def charge(P, L=150, W=90, H=55):
    """Waxed-paper demolition block tied with cord; returns top z (mm)."""
    pap = paper('waxpaper', M.lin((0.50, 0.38, 0.22)), wrinkle=1.2)
    cord = M.textured('cord', 'wool_boucle', tint=(1.1, 1.0, 0.8), scale=0.02, nstrength=1.0)
    P.append(D.box('block', (L * MM, W * MM, H * MM), pap, loc=(0, 0, H / 2 * MM), bevel=5 * MM, segs=4))
    for x in (-L * 0.28, L * 0.28):
        pts = [(x * MM, (-W / 2 - 1.5) * MM, 1 * MM), (x * MM, (-W / 2 - 1.5) * MM, (H + 1.5) * MM), (x * MM, (W / 2 + 1.5) * MM, (H + 1.5) * MM),
               (x * MM, (W / 2 + 1.5) * MM, 1 * MM)]
        P.append(D.tube(f'cord{x}', pts, 2.2 * MM, cord, segs=12, closed=True))
    return H


def det_cap(P, x, y, z, ang=0):
    al = M.metal('alu', M.lin((0.72, 0.72, 0.70)), rough=0.35, wear=0.2)
    red = M.paint('cap_red', M.lin((0.62, 0.08, 0.06)), rough=0.5, wear=0.4)
    o = cy('detcap', 3.6, 40, al, x, y, z, 'Z', 24, 0.5); o.rotation_euler = (0, math.radians(ang), 0); P.append(o)
    o2 = cy('detcap_end', 4.2, 8, red, x + 20 * math.sin(math.radians(ang)), y, z + 20 * math.cos(math.radians(ang)), 'Z', 24, 0.8)
    o2.rotation_euler = (0, math.radians(ang), 0); P.append(o2)


def wire(name, pts, col, r=1.6):
    m = M.solid('wire_' + name, M.lin(col), rough=0.35, var=0.05, bevel=0.0003)
    return D.tube(name, [(x * MM, y * MM, z * MM) for x, y, z in pts], r * MM, m, segs=12)


def time_bomb():
    P = []; top = charge(P)
    br = brass_mat()
    dial = M.image('dial', os.path.join(S.LABELS, 'dial.png'), rough=0.35, coat=0.0, alpha=True)
    gl = M.glass('watchglass', rough=0.01)
    case = [(0, 0), (27, 0), (29, 3), (29, 11), (27, 14), (25, 14), (25, 12), (0, 12)]
    P.append(D.lathe('watch', [(r * MM, z * MM) for r, z in case], br, segs=64, loc=(-18 * MM, -4 * MM, top * MM)))
    P.append(D.decal('dialface', dial, 50 * MM, 50 * MM, loc=(-18 * MM, -4 * MM, (top + 12.2) * MM)))
    P.append(D.lathe('crystal', [(0, 16 * MM), (25.5 * MM, 12.5 * MM), (25.5 * MM, 12 * MM), (0, 12 * MM)], gl, segs=64, loc=(-18 * MM, -4 * MM, top * MM)))
    P.append(cy('crown', 4, 7, br, -18, 32, top + 7, 'Y', 24, 0.8))
    P.append(ring('bow', 9, rsec(2.6, 2.6, 8), br, segs=32, loc=(-18 * MM, 40 * MM, (top + 7) * MM), rot=(0, 90, 90)))
    det_cap(P, 48, 10, top + 6, ang=60)
    P.append(wire('red', [(-2, -20, top + 8), (20, -30, top + 16), (40, -8, top + 20), (58, 10, top + 16)], (0.62, 0.08, 0.06)))
    P.append(wire('blk', [(-2, 10, top + 8), (18, 22, top + 18), (40, 22, top + 20), (58, 14, top + 18)], (0.12, 0.11, 0.10)))
    return P


@S.shot('timeBomb')
def _tb(mode):
    D.group('timebomb', time_bomb(), rot=(24, 0, 8))          # propped: the watch face is the read
    S.shoot('timeBomb', mode, box=(40, 32), margin=0.04)


def remote_bomb():
    P = []; top = charge(P)
    od = od_paint(); ni = nickel()
    blk = M.solid('bakelite', M.lin((0.06, 0.05, 0.045)), rough=0.3, coat=0.2)
    P.append(D.box('rx', (64 * MM, 46 * MM, 32 * MM), od, loc=(-20 * MM, -2 * MM, (top + 16) * MM), bevel=3 * MM))
    P.append(cy('knob', 7, 6, blk, -34, -2, top + 34, 'Z', 32, 1.5))
    P.append(cy('lamp', 4.5, 4, M.emission('pilot', M.lin((1.0, 0.25, 0.1)), 3.0), -12, -2, top + 33, 'Z', 24, 1.0))
    P.append(cy('ant_base', 4, 8, ni, 4, 12, top + 36, 'Z', 16, 0.8))
    segs_ = ((4.2, 36), (3.4, 34), (2.8, 30))
    for i, (r, h) in enumerate(segs_):
        z = top + 40 + sum(v[1] for v in segs_[:i]) + h / 2
        P.append(cy(f'ant{i}', r, h, ni, 4, 12, z, 'Z', 12, 0.3))
    P.append(cy('ant_tip', 5.0, 7, ni, 4, 12, top + 142, 'Z', 16, 1.6))
    det_cap(P, 48, 10, top + 6, ang=55)
    P.append(wire('red', [(12, -12, top + 12), (30, -24, top + 14), (50, 0, top + 18), (56, 10, top + 16)], (0.62, 0.08, 0.06), r=2.8))
    P.append(wire('blk2', [(12, 8, top + 12), (28, 26, top + 16), (48, 20, top + 18), (56, 14, top + 16)], (0.10, 0.09, 0.08), r=2.8))
    return P


@S.shot('remoteBomb')
def _rb(mode):
    root = D.group('remotebomb', remote_bomb(), rot=(18, 0, 8))
    S.shoot('remoteBomb', mode, box=(40, 34), margin=0.04)


def detonator():
    """Plunger exploder: varnished wooden box, steel T-handle plunger, two brass binding posts."""
    wd = M.wood('box_wood2', tint=(1.5, 1.05, 0.7), tex='dark_wood', scale=0.16, rough=0.38, coat=0.4, stretch=(1, 1, 2.5))
    steel = M.metal('det_steel', M.lin((0.40, 0.41, 0.42)), rough=0.3, wear=0.5)
    br = brass_mat(); blk = M.solid('bakelite', M.lin((0.06, 0.05, 0.045)), rough=0.3, coat=0.2)
    P = [D.box('box', (110 * MM, 100 * MM, 130 * MM), wd, loc=(0, 0, 65 * MM), bevel=4 * MM)]
    P.append(D.box('lid', (116 * MM, 106 * MM, 10 * MM), wd, loc=(0, 0, 133 * MM), bevel=3 * MM))
    for z in (8, 122):
        P.append(D.box(f'band{z}', (112 * MM, 102 * MM, 8 * MM), steel, loc=(0, 0, z * MM), bevel=1.5 * MM))
    P.append(cy('rod', 7, 100, steel, 0, 0, 180, 'Z', 24, 0.6))
    P.append(cy('guide', 16, 12, steel, 0, 0, 142, 'Z', 32, 1.5))
    P.append(cy('tbar', 10, 130, blk, 0, 0, 232, 'X', 32, 2.0))
    for x in (-36, 36):
        P.append(cy(f'post{x}', 6, 14, br, x, 30, 145, 'Z', 24, 0.8))
        P.append(cy(f'nut{x}', 9, 6, br, x, 30, 152, 'Z', 6, 0.8))
    return P


@S.shot('detonator')
def _det(mode):
    D.group('detonator', detonator(), rot=(0, 0, 24))
    S.shoot('detonator', mode, box=(32, 40), margin=0.04)


def enamel(name, color, rough=0.18, chip_to=(0.05, 0.05, 0.06), chips=0.45):
    return M.paint(name, color, rough=rough, wear=0.8, under=chip_to, chips=chips, sheen_var=0.04)


def first_aid():
    """White enamelled tin first-aid box with a red cross on the lid and a brass latch."""
    wh = M.paint('aged_enamel', M.lin((0.80, 0.76, 0.64)), rough=0.34, wear=1.0, under=M.lin((0.10, 0.10, 0.11)), chips=0.22, sheen_var=0.2)
    red = M.paint('red_enamel2', M.lin((0.62, 0.07, 0.05)), rough=0.4, wear=1.0, under=M.lin((0.10, 0.10, 0.11)), chips=0.35)
    br = brass_mat()
    P = [D.box('tin', (140 * MM, 100 * MM, 38 * MM), wh, loc=(0, 0, 19 * MM), bevel=7 * MM, segs=5)]
    P.append(D.box('lid', (143 * MM, 103 * MM, 12 * MM), wh, loc=(0, 0, 38 * MM), bevel=5 * MM, segs=5))
    P.append(D.box('crossH', (62 * MM, 20 * MM, 1.2 * MM), red, loc=(0, 0, 44.3 * MM), bevel=0.4 * MM))
    P.append(D.box('crossV', (20 * MM, 62 * MM, 1.2 * MM), red, loc=(0, 0, 44.3 * MM), bevel=0.4 * MM))
    P.append(D.box('latch', (14 * MM, 3 * MM, 14 * MM), br, loc=(0, -52.2 * MM, 36 * MM), bevel=1.0 * MM))
    P.append(D.box('bead', (146 * MM, 106 * MM, 2.4 * MM), M.metal('tin_steel', M.lin((0.45, 0.45, 0.46)), rough=0.4, wear=0.8), loc=(0, 0, 32.5 * MM), bevel=1.0 * MM))
    P.append(cy('hinge', 3, 120, br, 0, 51.5, 40, 'X', 16, 0.5))
    return P


@S.shot('firstAid')
def _aid(mode):
    D.group('firstaid', first_aid(), rot=(26, 0, 10))
    S.shoot('firstAid', mode, box=(40, 32), margin=0.04)


def cigarettes():
    """Soft paper pack (own generic design), foil top torn open, three cigarettes drawn out."""
    lab = M.image('cig_label', os.path.join(S.LABELS, 'cig_front.png'), rough=0.45, coat=0.1)
    pap = paper('cig_paper', M.lin((0.80, 0.75, 0.60)), wrinkle=0.4)
    foil = M.metal('foil', M.lin((0.78, 0.76, 0.70)), rough=0.28, wear=0.0)
    cpap = M.solid('cig_white', M.lin((0.93, 0.92, 0.88)), rough=0.6, var=0.03, bevel=0.0006)
    filt = M.solid('cig_tobacco', M.lin((0.45, 0.28, 0.12)), rough=0.8, var=0.3)
    P = [D.box('pack', (55 * MM, 21 * MM, 80 * MM), pap, loc=(0, 0, 40 * MM), bevel=3 * MM, segs=4)]
    P.append(D.decal('front', lab, 51 * MM, 78 * MM, loc=(0, -10.8 * MM, 40 * MM), rot=(90, 0, 0)))
    P.append(D.box('foil', (53 * MM, 19 * MM, 6 * MM), foil, loc=(0, 0, 81 * MM), bevel=1.5 * MM))
    for i, (x, h) in enumerate(((-15, 22), (-3, 32), (10, 14))):
        P.append(cy(f'cig{i}', 4.1, 80, cpap, x, 0, 40 + h, 'Z', 24, 0.4))
        P.append(cy(f'end{i}', 3.7, 0.6, filt, x, 0, 80 + h + 0.1, 'Z', 24, 0))
    return P


@S.shot('cigarettes')
def _cig(mode):
    D.group('cigarettes', cigarettes(), rot=(0, 0, 16))
    S.shoot('cigarettes', mode, box=(30, 36), margin=0.04)


def chloroform():
    """Brown glass apothecary bottle with ground-glass stopper and label, beside a folded white cloth pad."""
    bg = M.glass('amber_glass', color=(0.55, 0.28, 0.08), rough=0.04, ior=1.5)
    liq = M.glass('chl_liquid', color=(0.9, 0.85, 0.7), rough=0.01, ior=1.44)
    lab = M.image('chl_label', os.path.join(S.LABELS, 'chloro_label.png'), rough=0.6)
    cloth = M.textured('cloth', 'wool_boucle', tint=(1.9, 1.9, 1.85), scale=0.03, nstrength=0.6, sheen=0.5)
    b = [(0, 0), (26, 0), (28, 2), (28, 70), (26, 78), (12, 88), (10, 92), (10, 100), (11.5, 102), (11.5, 104), (0, 104)]
    P = [D.lathe('bottle', [(r * MM, z * MM) for r, z in b], bg, segs=64)]
    P.append(D.lathe('liquid', [(0, 3 * MM), (25 * MM, 3 * MM), (25 * MM, 58 * MM), (0, 58 * MM)], liq, segs=48))
    st = [(0, 96), (8.5, 96), (9, 104), (14, 106), (14, 118), (10, 122), (0, 123)]
    P.append(D.lathe('stopper', [(r * MM, z * MM) for r, z in st], M.glass('stopper_glass', color=(0.5, 0.26, 0.08), rough=0.25), segs=48))
    P.append(D.decal('label', lab, 60 * MM, 36 * MM, loc=(0, -28.2 * MM, 38 * MM), rot=(90, 0, 0), bend=28.2 * MM))
    pad = D.box('pad', (80 * MM, 60 * MM, 10 * MM), cloth, loc=(62 * MM, -10 * MM, 5 * MM), rot=(0, 0, -18), bevel=4 * MM, segs=4)
    m = pad.modifiers.new('sub', 'SUBSURF'); m.levels = 2; m.render_levels = 2
    tx = bpy.data.textures.new('padn', 'CLOUDS'); tx.noise_scale = 0.02
    d = pad.modifiers.new('disp', 'DISPLACE'); d.texture = tx; d.strength = 0.004
    P.append(pad)
    return P


@S.shot('chloroform')
def _chl(mode):
    D.group('chloroform', chloroform(), rot=(0, 0, 0))
    S.shoot('chloroform', mode, box=(40, 34), margin=0.04)


def blackjack():
    """Leather cosh (sap): lead-weighted teardrop head sewn from two leather halves (raised welt seam with saddle
    stitches), flexible stitched shaft, wrapped grip bands and a flat wrist-strap loop. Along +X, head at +X."""
    lt = M.textured('bj_leather2', 'brown_leather', tint=(0.42, 0.30, 0.22), scale=0.05, nstrength=0.9, coat=0.35)
    dk = M.textured('bj_leather_dk', 'brown_leather', tint=(0.22, 0.16, 0.12), scale=0.05, nstrength=0.9, coat=0.2)
    thread = M.solid('bj_thread', M.lin((0.78, 0.70, 0.52)), rough=0.7, var=0.1, bevel=0.0002)
    P = []
    prof = [(0, 0), (10, 1), (11, 30), (11.5, 100), (14, 122), (22, 146), (27, 170), (28, 186), (25, 202), (15, 214), (0, 219)]
    h = D.lathe('cosh', [(r * MM, z * MM) for r, z in prof], lt, segs=48)
    h.rotation_euler = (0, math.radians(90), 0); h.scale = (1, 0.82, 1); P.append(h)
    # welt seam along the top of the head/shaft + stitches
    seam = [(x, 0, r * 1.0 + 1.2) for r, x in prof[1:-1]]
    P.append(D.tube('welt', [(x * MM, y * MM, z * MM) for x, y, z in seam], 2.0 * MM, dk, segs=10))
    for k in range(14):
        x = 20 + k * 14.5
        r = next(rr for rr, xx in reversed(prof) if xx <= x) if x < 214 else 10
        P.append(D.box(f'st{k}', (5 * MM, 7 * MM, 1.6 * MM), thread, loc=(x * MM, 0, (r + 2.4) * MM), bevel=0.5 * MM))
    for x in (8, 26, 44, 62, 80):   # wrapped grip bands
        P.append(cy(f'band{x}', 12.6, 7, dk, x, 0, 0, 'X', 32, 1.2))
    lp = D.tube('loop', [(-2 * MM, 0, 0), (-30 * MM, 0, 16 * MM), (-66 * MM, 0, 22 * MM), (-90 * MM, 0, 6 * MM), (-80 * MM, 0, -16 * MM),
                         (-44 * MM, 0, -18 * MM), (-12 * MM, 0, -8 * MM), (-2 * MM, 0, 0)], 4.2 * MM, dk, segs=12)
    D.squash(lp, (1, 2.4, 0.55)); P.append(lp)
    return P


@S.shot('blackjack')
def _bj(mode):
    root = D.group('blackjack', blackjack(), rot=(0, -26, 0))
    D.hot((0.22, 0, 0.016), parent=root)
    S.shoot('blackjack', mode, box=(46, 28), margin=0.04)


def knuckles():
    """Brass knuckle duster, polished with handling wear: four finger rings standing proud of a curved palm bar,
    stood on edge and turned so the ring thickness shows (3/4)."""
    br = M.metal('kn_brass', M.lin((0.84, 0.66, 0.34)), rough=0.16, wear=0.9, wear_color=M.lin((0.98, 0.86, 0.60)), wear_rough=0.08, grain=0.5)
    xs = (-37.5, -12.5, 12.5, 37.5); R = 13.0
    top = []
    for k, cx in enumerate(xs):   # scalloped finger-ring crown, left to right
        a0 = 180 if k == 0 else 158; a1 = 0 if k == 3 else 22
        top += [(cx + R * math.cos(math.radians(a)), R * math.sin(math.radians(a)) + 2) for a in range(int(a0), int(a1) - 1, -6)]
    body = top + [(52, -14), (54, -26), (46, -38), (24, -45), (0, -47), (-24, -45), (-46, -38), (-54, -26), (-52, -14)]
    o = sl('duster', body, 14, br, bevel=0.0)
    cut = [D.cyl(f'hole{k}', 9.2 * MM, 40 * MM, None, loc=(cx * MM, 0, 2 * MM), rot=(90, 0, 0), segs=48, bevel=0) for k, cx in enumerate(xs)]
    slot = sl('palmslot', D.chaikin([(-44, -18), (44, -18), (44, -30), (-44, -30)], 3, True), 40, None, bevel=0.0)
    D.cut(o, cut + [slot])
    m = o.modifiers.new('bev', 'BEVEL'); m.width = 3.2 * MM; m.segments = 5; m.limit_method = 'ANGLE'; m.harden_normals = False
    o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    return [o]


@S.shot('knuckles')
def _kn(mode):
    D.group('knuckles', knuckles(), rot=(0, 0, -26))
    S.shoot('knuckles', mode, box=(40, 30), margin=0.05)


def toggle(P, x, y, z, ni, ang=25):
    P.append(cy('tg_nut', 6, 4, ni, x, y, z + 2, 'Z', 6, 0.6))
    lever = D.lathe('tg_lever', [(0, 0), (1.8 * MM, 0), (1.4 * MM, 18 * MM), (2.6 * MM, 20 * MM), (0, 22 * MM)], ni, segs=20)
    lever.location = (x * MM, y * MM, (z + 3) * MM); lever.rotation_euler = (math.radians(-ang), 0, 0); P.append(lever)


def decoy():
    """Decoy noise-maker: brown leatherette box radio with a big round speaker grille, knob, toggle, whip aerial."""
    lt = M.textured('leatherette', 'fabric_leather_02', tint=(0.62, 0.42, 0.28), scale=0.08, nstrength=0.8, coat=0.15, bevel=0.002)
    ni = nickel(); blk = M.solid('bakelite', M.lin((0.06, 0.05, 0.045)), rough=0.3, coat=0.2)
    cloth = M.textured('grille_cloth', 'wool_boucle', tint=(0.45, 0.38, 0.28), scale=0.015, nstrength=1.0)
    P = [D.box('case', (110 * MM, 70 * MM, 120 * MM), lt, loc=(0, 0, 60 * MM), bevel=8 * MM, segs=5)]
    P.append(D.box('trimT', (112 * MM, 72 * MM, 4 * MM), ni, loc=(0, 0, 118 * MM), bevel=1.5 * MM))
    P.append(ring('bezel', 40, rsec(8, 5, 12), ni, segs=64, loc=(0, -35.5 * MM, 56 * MM), rot=(90, 0, 0)))
    P.append(cy('cloth', 38, 3, cloth, 0, -34, 56, 'Y', 64, 0))
    for i in range(-4, 5):   # grille bars
        L = 2 * math.sqrt(max(0, 38 ** 2 - (i * 8) ** 2))
        P.append(bx(f'bar{i}', -L / 2, 56 + i * 8 - 1.6, L / 2, 56 + i * 8 + 1.6, 3, ni, y=-36.2, bevel=0.8))
    P.append(cy('knob', 9, 10, blk, -30, 10, 125, 'Z', 32, 2))
    toggle(P, 22, -6, 120, ni)
    P.append(cy('ant_base', 5, 10, ni, 40, 22, 125, 'Z', 20, 1))
    a = D.tube('whip', [(40 * MM, 22 * MM, 125 * MM), (46 * MM, 26 * MM, 180 * MM), (58 * MM, 34 * MM, 232 * MM)], 2.8 * MM, ni, segs=10)
    P.append(a); P.append(D.lathe('whip_tip', [(0, 0), (3 * MM, 0), (3 * MM, 4 * MM), (0, 5 * MM)], ni, segs=16, loc=(58.5 * MM, 34.5 * MM, 231 * MM)))
    return P


@S.shot('decoy')
def _decoy(mode):
    D.group('decoy', decoy(), rot=(0, 0, 18))
    S.shoot('decoy', mode, box=(32, 40), margin=0.04)


def activator():
    """Hand-held decoy transmitter: olive-drab enamelled steel case (chipped), brass name plate, a big chrome toggle
    with a red tip under a guard, red pilot lamp and a telescopic aerial with a ball tip."""
    case = M.paint('act_case', M.lin((0.50, 0.50, 0.34)), rough=0.5, wear=1.0, under=M.lin((0.7, 0.7, 0.7)), chips=0.2)
    ni = nickel(); br = brass_mat()
    red = M.solid('act_red', M.lin((0.72, 0.08, 0.05)), rough=0.3, coat=0.5)
    P = [D.box('body', (60 * MM, 36 * MM, 96 * MM), case, loc=(0, 0, 48 * MM), bevel=8 * MM, segs=5)]
    P.append(D.box('plate', (44 * MM, 1.6 * MM, 54 * MM), br, loc=(0, -18.4 * MM, 54 * MM), bevel=1.2 * MM))
    for x, z in ((-18, 30), (18, 30), (-18, 78), (18, 78)):
        P.append(cy(f'screw{x}{z}', 2.2, 1.2, ni, x, -19.4, z, 'Y', 16, 0.4))
    P.append(cy('tg_nut', 7, 5, ni, 0, -21, 62, 'Y', 6, 0.6))
    lever = D.lathe('tg_lever', [(0, 0), (2.6 * MM, 0), (2.0 * MM, 26 * MM), (0, 27 * MM)], ni, segs=20)
    lever.location = (0, -22 * MM, 62 * MM); lever.rotation_euler = (math.radians(115), 0, 0); P.append(lever)
    tip = D.lathe('tg_tip', [(0, 0), (5 * MM, 0), (5.2 * MM, 8 * MM), (0, 10 * MM)], red, segs=24)
    tip.location = (0, (-22 - 24 * math.sin(math.radians(65))) * MM, (62 - 24 * math.cos(math.radians(65))) * MM)
    tip.rotation_euler = (math.radians(115), 0, 0); P.append(tip)
    P.append(D.tube('guard', [(-14 * MM, -19 * MM, 50 * MM), (-14 * MM, -34 * MM, 58 * MM), (14 * MM, -34 * MM, 58 * MM), (14 * MM, -19 * MM, 50 * MM)], 1.8 * MM, ni, segs=10))
    P.append(cy('lampbezel', 8, 4, ni, 0, -19.5, 38, 'Y', 32, 0.8))
    P.append(cy('lamp', 6.2, 3, M.emission('act_lamp', M.lin((1.0, 0.18, 0.08)), 6.0, base=M.lin((0.7, 0.05, 0.03))), 0, -21, 38, 'Y', 32, 1.2))
    P.append(cy('ant_base', 6, 10, ni, 20, 6, 100, 'Z', 16, 1))
    for k, (r, z0, h) in enumerate(((4.0, 105, 34), (3.2, 139, 34), (2.5, 173, 30))):
        P.append(cy(f'ant{k}', r, h, ni, 20, 6, z0 + h / 2, 'Z', 16, 0.3))
    P.append(D.lathe('ant_ball', [(0, 0), (4 * MM, 1 * MM), (5 * MM, 5 * MM), (4 * MM, 9 * MM), (0, 10 * MM)], ni, segs=24, loc=(20 * MM, 6 * MM, 202 * MM)))
    return P


@S.shot('decoyActivator')
def _act(mode):
    D.group('activator', activator(), rot=(0, 0, 14))
    S.shoot('decoyActivator', mode, box=(28, 40), margin=0.04)


@S.shot('charge.mini')
def _cmini(mode):
    """Count glyph for time/remote bombs: the bare waxed-paper charge with its cord."""
    P = []; charge(P)
    D.group('chargemini', P, rot=(0, 0, 8))
    S.shoot('charge.mini', 'item', box=(9, 7), margin=0.02, scale=16, shadow=False, slot=0)
