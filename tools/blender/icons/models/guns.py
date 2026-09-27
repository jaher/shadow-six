# guns.py - hero pistols, rifles, SMG, speargun, .303 round. Built in mm (scaled 0.001) along +X, profile XZ, right side = -Y.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector

MM = 0.001


def mm(pts): return [(x * MM, z * MM) for x, z in pts]


def sl(name, pts, thick, mat, y=0.0, bevel=0.6, smooth=0, **kw):
    """slab from mm outline; smooth = chaikin iterations (keep= corner idx)."""
    keep = kw.pop('keep', ())
    if smooth: pts = D.chaikin(pts, smooth, True, keep)
    return D.slab(name, mm(pts), thick * MM, mat, y=y * MM, bevel=bevel * MM, **kw)


def bx(name, x0, z0, x1, z1, thick, mat, y=0.0, bevel=0.4, **kw):
    return sl(name, [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], thick, mat, y, bevel, **kw)


def cy(name, r, h, mat, x, y, z, axis='X', segs=32, bevel=0.3, r2=None):
    rot = {'X': (0, 90, 0), 'Y': (90, 0, 0), 'Z': (0, 0, 0)}[axis]
    return D.cyl(name, r * MM, h * MM, mat, loc=(x * MM, y * MM, z * MM), rot=rot, segs=segs, bevel=bevel * MM, r2=None if r2 is None else r2 * MM)


def guard(name, pts, r, mat, flat=1.6):
    """Trigger guard: round wire along mm points (XZ), flattened in Y."""
    o = D.tube(name, [(x * MM, 0, z * MM) for x, z in pts], r * MM, mat, segs=16)
    o.scale = (1, flat, 1)
    return o


def mats_gun(kind='park'):
    if kind == 'park':      # WWII Parkerized: matte dark grey-green phosphate
        steel = M.metal('parker', M.lin((0.36, 0.37, 0.35)), rough=0.5, wear=0.45, wear_color=M.lin((0.55, 0.55, 0.54)), wear_rough=0.25, grain=0.3)
    else:                   # blued
        steel = M.metal('blued', M.lin((0.38, 0.40, 0.45)), rough=0.26, wear=0.9, wear_color=M.lin((0.62, 0.62, 0.64)), wear_rough=0.2)
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    return steel, dark


def checker_grip(name, color, cells=900.0):
    """Checkered grip panel: plastic/walnut with a diamond checker bump."""
    t = M.NT(name)
    vec = t.coords(1.0)
    w1 = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', i_Scale=cells, i_Distortion=0.0)
    t.L(vec, w1.inputs['Vector'])
    mp = t.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (-1, 1, 1); t.L(vec, mp.inputs['Vector'])
    w2 = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', i_Scale=cells, i_Distortion=0.0)
    t.L(mp.outputs['Vector'], w2.inputs['Vector'])
    h = t.math('MINIMUM', w1.outputs['Fac'], w2.outputs['Fac'])
    edge, bn = t.edge(radius=0.0008, gain=4.0)
    var = t.noise(80.0)
    c = t.mix(t.math('MULTIPLY', var, 0.3), color, tuple(c * 0.6 for c in color))
    t.L(t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, h), 0.45), c, tuple(v * 0.35 for v in color)), t.p.inputs['Base Color'])
    t.L(t.math('MULTIPLY_ADD', h, 0.2, 0.45), t.p.inputs['Roughness'])
    t.L(t.bump(h, strength=0.6, dist=0.0006, normal=bn), t.p.inputs['Normal'])
    t.set('Specular IOR Level', 0.35)
    return t.m


def grooves(x0, pitch, n, z0, z1, width, y_face, depth, axis_x=True):
    """Cutter boxes for serrations on a side face at y_face (cut `depth` mm into it)."""
    out = []
    for i in range(n):
        x = x0 + i * pitch
        out.append(bx(f'g{i}', x, z0, x + width, z1, depth * 2, None, y=y_face, bevel=0))
    return out


def park():
    return M.gunmetal('parker2', M.lin((0.20, 0.205, 0.19)), coat_metal=0.35, rough=0.4, wear=1.0)


def blue(name='blued2', c=(0.22, 0.235, 0.28)):
    return M.gunmetal(name, M.lin(c), coat_metal=0.75, rough=0.26, wear=0.9, var=0.45)


def colt1911():
    """Colt M1911A1 (GI Parkerized): rounded slide with rear serrations and a cut ejection port showing the barrel
    hood, arched serrated mainspring housing, grip safety, spur hammer, checkered brown 'Coltwood' panels."""
    steel = park(); bl = blue()
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    grip = checker_grip('colt_grip2', M.lin((0.24, 0.12, 0.05)), cells=520.0)
    P = []
    slide = sl('slide', [(0, 105), (1.5, 134), (203, 134), (208, 131), (208, 96), (181, 96), (181, 105)], 23, steel, bevel=2.0, segs=4)
    cutters = grooves(6, 3.0, 9, 107, 135, 1.4, -11.5, 0.9) + grooves(6, 3.0, 9, 107, 135, 1.4, 11.5, 0.9)
    cutters.append(bx('portcut', 74, 114, 118, 136, 14, None, y=-11.5, bevel=0))
    D.cut(slide, cutters); P.append(slide)
    P.append(bx('hood', 70, 113.5, 120, 132.5, 14, steel, y=-2.6, bevel=1.4))                      # barrel hood seen in the port
    P.append(sl('rsight', [(6, 133), (7, 141), (21, 141), (22, 133)], 11, steel, bevel=0.8))
    P.append(sl('fsight', [(195, 133), (197, 140), (201, 140), (203, 133)], 3.5, steel, bevel=0.6))
    P.append(cy('plug', 5.2, 3, steel, 208.5, 0, 101, 'X', 32, 0.6))
    P.append(cy('bushing', 8.5, 4, bl, 209, 0, 117, 'X', 40, 0.8))
    P.append(cy('bore', 3.2, 1.0, dark, 211.2, 0, 117, 'X', 24, 0))
    P.append(sl('frame', [(-4, 104.6), (180, 104.6), (180, 99), (175, 94), (100, 94), (58, 92), (54, 82), (48, 70), (38, 40),
                          (27, 6), (-19, 6), (-17, 14), (-14, 30), (-14, 44), (-8, 62), (-2, 76), (2, 90), (-4, 96)], 22.5, steel, bevel=1.4, segs=3))
    msh = sl('mshousing', [(-19.5, 7), (-13, 7), (-9, 44), (-2, 76), (-6, 80), (-15, 46)], 23.5, steel, bevel=1.0, smooth=1)
    D.cut(msh, [bx(f'm{i}', -30, 10 + i * 2.6, 0, 11.2 + i * 2.6, 3.0, None, y=-11.8, bevel=0) for i in range(12)])
    P.append(msh)
    P.append(sl('gsafety', [(-3, 104), (-16, 101.5), (-19, 98.5), (-15, 96.5), (-4, 95.5), (4, 92)], 21, steel, bevel=1.4, smooth=2))
    P.append(sl('hammer', [(-2, 104), (-5, 117), (-11, 123), (-17, 120), (-9, 104)], 7.5, steel, bevel=1.0, smooth=1))
    P.append(bx('magbase', -19.5, 0, 27.5, 6.2, 21, bl, bevel=1.2))
    P.append(sl('panel', [(-11, 12), (24, 12), (47, 82), (4, 88), (-6, 62)], 29, grip, bevel=2.2, smooth=2, segs=4, taper=0.94))
    for x, z in ((1, 22), (27, 76)):
        P.append(cy(f'ring{z}', 5.0, 0.8, grip, x + 3, -14.6, z, 'Y', 32, 0.3))
        P.append(cy(f'screw{z}', 3.4, 1.4, bl, x + 3, -15.3, z, 'Y', 24, 0.5))
    P.append(guard('tguard', [(58, 92), (60.5, 80), (65, 71.5), (80, 70), (93, 71), (98.5, 79), (100, 93)], 2.6, steel, flat=2.6))
    P.append(sl('trigger', [(63, 92), (63.5, 79), (68, 79), (69.5, 92)], 8, bl, bevel=0.8))
    P.append(cy('slidestop_pin', 3.0, 1.6, bl, 110, -11.8, 98, 'Y', 24, 0.6))
    for x, z in ((44, 98), (150, 98)):
        P.append(cy(f'pin{x}', 2.4, 1.4, bl, x, -11.6, z, 'Y', 20, 0.4))
    return P, (210, 117)


SHOTS = {}


def lay(parts, name, muzzle, flip=False, upright=False):
    """Stand the gun upright, right side (-Y) to the camera (the one inventory view), or lay it flat right side up
    (cursors); hotspot empty at the muzzle."""
    root = D.group(name, parts, rot=(0, 0, 0) if upright else ((-90, 0, 0) if not flip else (90, 0, 0)))
    D.hot((muzzle[0] * MM, 0, muzzle[1] * MM), parent=root)
    return root



def p38():
    """Walther P38 (dark blued, black bakelite): long open-top slide with the barrel standing proud in front, cut
    ejection port, round trigger guard, horizontally grooved grips, external hammer, slide-mounted safety lever."""
    steel = blue('p38_blued2', (0.25, 0.26, 0.30))
    bright = M.gunmetal('p38_barrel', M.lin((0.30, 0.31, 0.34)), coat_metal=0.85, rough=0.22, wear=0.8)
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    bak = grooved_grip('p38_grip2', M.lin((0.05, 0.03, 0.018)), pitch=3.4)
    P = []
    slide = sl('slide', [(0, 104), (0, 128), (2, 131), (104, 131), (111, 123.5), (200, 123.5), (204, 120), (204, 104)], 22, steel, bevel=1.8, segs=4)
    D.cut(slide, [bx('portcut', 60, 113, 96, 132, 12, None, y=-11, bevel=0)]); P.append(slide)
    P.append(bx('pbar', 56, 112, 100, 130, 12, bright, y=-1.5, bevel=1.2))
    P.append(cy('barrel', 8.2, 112, bright, 158, 0, 121, 'X', 40, 0.6))
    P.append(cy('muzzle', 8.4, 3, bright, 213, 0, 121, 'X', 40, 0.8))
    P.append(cy('bore', 3.0, 1.0, dark, 214.6, 0, 121, 'X', 24, 0))
    P.append(sl('fsight', [(193, 127), (195, 135), (199, 135), (201, 127)], 3.5, steel, bevel=0.5))
    P.append(sl('rsight', [(4, 130), (5, 136), (16, 136), (17, 130)], 11, steel, bevel=0.6))
    P.append(sl('frame', [(-6, 104.6), (162, 104.6), (162, 101), (156, 97), (100, 96), (62, 92),
                          (56, 80), (48, 52), (40, 8), (-10, 8), (-8, 30), (-6, 60), (-3, 80), (0, 96)], 21.5, steel, bevel=1.4))
    P.append(sl('hammer', [(-2, 104), (-5, 117), (-11, 123), (-16, 119), (-9, 104)], 7.5, steel, bevel=1.0, smooth=1))
    P.append(bx('magbase', -11, 1, 41, 8.2, 20, steel, bevel=1.2))
    P.append(cy('lanyard', 3.6, 6, bright, -9.5, 0, 12, 'Y', 24, 0.8))
    P.append(sl('panel', [(-5, 13), (37, 13), (51, 82), (-1, 89)], 29, bak, bevel=2.4, smooth=2, segs=4))
    P.append(cy('gscrew', 3.2, 1.4, bright, 22, -15.2, 50, 'Y', 24, 0.5))
    P.append(guard('tguard', [(62, 92), (64, 80), (72, 70.5), (86, 70), (98, 76), (102, 88), (100, 96.5)], 2.6, steel, flat=2.6))
    P.append(sl('trigger', [(70, 94), (69, 84), (73, 77), (76, 79), (74, 86), (76, 94)], 7, bright, bevel=0.8, smooth=1))
    P.append(sl('lever', [(16, 110), (18, 119), (32, 120), (34, 112)], 25, bright, bevel=1.0, smooth=1))   # safety/decocker lever
    for x, z in ((108, 100), (40, 100)):
        P.append(cy(f'pin{x}', 2.6, 1.4, bright, x, -11.1, z, 'Y', 20, 0.5))
    return P, (215, 121)


def grooved_grip(name, color, pitch=1.6):
    """Bakelite grip with horizontal grooves (Walther / Beretta)."""
    t = M.NT(name)
    vec = t.coords(1.0)
    w = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', i_Scale=1.0 / (pitch * MM), i_Distortion=0.0)
    t.L(vec, w.inputs['Vector'])
    h = w.outputs['Fac']
    edge, bn = t.edge(radius=0.0008, gain=4.0)
    var = t.noise(60.0)
    c = t.mix(t.math('MULTIPLY', var, 0.3), color, tuple(v * 1.6 for v in color))
    t.L(t.mix(t.math('MULTIPLY', edge, 0.6), c, tuple(min(1, v * 3) for v in color)), t.p.inputs['Base Color'])
    t.L(t.math('MULTIPLY_ADD', h, 0.15, 0.42), t.p.inputs['Roughness'])
    t.L(t.bump(h, strength=0.9, dist=0.0006, normal=bn), t.p.inputs['Normal'])
    t.set('Specular IOR Level', 0.4)
    return t.m


@S.shot('colt1911')
def _colt(mode):
    parts, mz = colt1911(); lay(parts, 'colt1911', mz, upright=mode == 'item')
    S.shoot('pistol.colt1911' if mode == 'item' else 'pistol', mode, box=(48, 34) if mode == 'item' else (32, 32), azim=0, elev=68, roll=-4)


@S.shot('p38')
def _p38(mode):
    parts, mz = p38(); lay(parts, 'p38', mz, upright=mode == 'item')
    S.shoot('pistol.p38', mode, box=(48, 34))


def walnut():
    return M.wood('walnut', tint=(1.0, 0.70, 0.48), tex='fine_grained_wood', scale=0.22, rough=0.42, coat=0.22, stretch=(4, 1, 1))


def no4(scope=True):
    """Lee-Enfield No.4 Mk I (T): walnut furniture, cheek rest, No.32 scope. Butt at x=0, muzzle x=1130, bore z=0."""
    steel = blue('no4_blued', (0.24, 0.25, 0.27))
    paint = M.paint('scope_paint2', M.lin((0.13, 0.135, 0.13)), rough=0.36, wear=0.9, under=M.lin((0.55, 0.55, 0.56)))
    glass = M.glass('lens', color=(0.55, 0.65, 0.7))
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    wd = walnut(); P = []
    butt = [(0, -32), (60, -28), (300, -20), (330, -24), (372, -26), (378, -40), (366, -58), (352, -86), (338, -90),
            (318, -72), (240, -100), (120, -140), (6, -164), (0, -160)]
    P.append(sl('butt', butt, 40, wd, bevel=7, smooth=2, keep=(0, 13), segs=4))
    P.append(bx('buttplate', -6, -166, 2, -30, 42, steel, bevel=2))
    if scope:
        P.append(sl('cheek', [(130, -30), (140, -12), (290, -8), (310, -22)], 30, wd, y=6, bevel=5, smooth=2, segs=4))
    fore = [(378, -26), (1040, -12), (1046, -16), (1040, -32), (700, -38), (520, -40), (440, -44), (390, -44)]
    P.append(sl('fore', fore, 34, wd, bevel=6, smooth=1, segs=4))
    P.append(sl('guard_up', [(566, -6), (1030, -6), (1034, 6), (1026, 13), (575, 16), (566, 8)], 30, wd, bevel=6, smooth=1, segs=4))
    P.append(cy('receiver', 17, 190, steel, 470, 0, 0, 'X', 40, 1.0))
    P.append(bx('bridge', 540, 8, 566, 22, 30, steel, bevel=1.5))
    P.append(sl('rsight', [(544, 20), (548, 44), (558, 44), (562, 20)], 14, steel, bevel=1))
    P.append(cy('barrel', 8.2, 570, steel, 845, 0, 0, 'X', 32, 0.5))
    P.append(bx('nosecap', 1030, -34, 1060, 16, 34, steel, bevel=3))
    P.append(sl('fsp', [(1096, 4), (1100, 32), (1126, 32), (1130, 4)], 22, steel, bevel=1.5))
    P.append(cy('bore', 3.2, 1, dark, 1138.5, 0, 0, 'X', 24, 0))
    P.append(bx('band', 690, -40, 704, 16, 36, steel, bevel=1.5))
    P.append(sl('mag', [(440, -40), (446, -100), (524, -100), (526, -40)], 28, steel, bevel=2.5))
    P.append(guard('tguard', [(392, -44), (396, -66), (412, -74), (436, -70), (446, -44)], 3, steel, flat=2.0))
    P.append(sl('trigger', [(408, -44), (410, -60), (416, -64), (418, -44)], 6, steel, bevel=1))
    # bolt: handle sweeping down on the right (-Y) side with a round knob
    P.append(D.tube('bolt', [(430 * MM, -14 * MM, 6 * MM), (426 * MM, -34 * MM, -6 * MM), (420 * MM, -42 * MM, -22 * MM)], 4.5 * MM, steel, segs=16))
    k = D.lathe('knob', [(0, 0), (0.011, 0.001), (0.0135, 0.011), (0.011, 0.021), (0, 0.022)], steel, segs=32)
    k.location = (418 * MM, -44 * MM, -32 * MM); P.append(k)
    P.append(cy('boltbody', 9, 120, steel, 440, 0, 12, 'X', 32, 0.8))
    if scope:
        prof = [(0, 0), (25, 0), (25, 8), (21, 13), (18, 30), (18, 240), (22, 256), (24.5, 286), (24.5, 300), (0, 300)]
        sc = D.lathe('scope', [(r * MM, z * MM) for r, z in prof], paint, segs=56)
        sc.rotation_euler = (0, math.radians(90), 0); sc.location = (350 * MM, 0, 70 * MM); P.append(sc)
        P.append(cy('lens_o', 23, 0.6, glass, 350 + 300.2, 0, 70, 'X', 48, 0))
        P.append(cy('lens_e', 22, 0.6, glass, 349.6, 0, 70, 'X', 48, 0))
        P.append(bx('drums', 492, 80, 568, 102, 42, paint, bevel=4))
        P.append(cy('drum_top', 17, 20, paint, 530, 0, 108, 'Z', 40, 2))
        P.append(cy('drum_side', 17, 18, paint, 530, -26, 72, 'Y', 40, 2))
        for x in (445, 612):
            P.append(D.lathe(f'ring{x}', [(0, -11 * MM), (27 * MM, -11 * MM), (27 * MM, 11 * MM), (0, 11 * MM)], steel, segs=48,
                             loc=(x * MM, 0, 70 * MM), rot=(0, 90, 0), bevel=2 * MM))
            P.append(bx(f'base{x}', x - 12, 18, x + 12, 50, 30, steel, bevel=2.5))
            P.append(cy(f'screw{x}', 5, 3, steel, x, -16, 36, 'Y', 24, 0.8))
        P.append(bx('mount', 430, 16, 626, 30, 22, steel, y=4, bevel=2.5))
    for x, z in ((250, -110), (700, -44)):
        P.append(cy(f'swivel{x}', 8, 4, steel, x, -18, z, 'Y', 24, 0.8))
    if not scope:
        web = M.textured('sling_web', 'fabric_leather_02', tint=(0.62, 0.55, 0.36), scale=0.03, nstrength=0.8)
        pts = [(250, -118), (330, -150), (470, -160), (610, -128), (700, -52)]
        sg = D.tube('sling', [(x * MM, -21 * MM, z * MM) for x, z in pts], 5 * MM, web, segs=12)
        sg.scale = (1, 1.0, 1); P.append(sg)
        for x, z in ((250, -110), (700, -44)):
            P.append(bx(f'buckle{x}', x - 10, z - 14, x + 10, z - 4, 9, steel, y=-21, bevel=1))
    return P, (1138, 0)


@S.shot('sniperRifle')
def _sniper(mode):
    parts, mz = no4(True); lay(parts, 'no4', mz, upright=mode == 'item')
    S.shoot('sniperRifle', mode, box=(96, 30), margin=0.03, slot=2)


@S.shot('leeEnfield')
def _lee(mode):
    parts, mz = no4(False); lay(parts, 'no4', mz, upright=mode == 'item')
    S.shoot('leeEnfield', mode, box=(96, 30), margin=0.03, slot=2)


def thompson():
    """Thompson M1928A1: finned barrel, Cutts compensator, vertical foregrip, 20-rd stick magazine, walnut furniture."""
    steel = blue('tsmg_blued2', (0.25, 0.26, 0.29))
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    wd = walnut(); P = []
    P.append(sl('butt', [(0, -18), (230, -8), (292, -6), (292, -44), (250, -58), (12, -150), (0, -148)], 38, wd, bevel=6, smooth=2, keep=(0, 6), segs=4))
    P.append(bx('buttplate', -5, -152, 2, -16, 40, steel, bevel=2))
    rc = sl('receiver', [(290, -32), (290, 22), (298, 30), (552, 30), (560, 22), (560, -32)], 36, steel, bevel=3.5, segs=4)
    D.cut(rc, [bx('ejcut', 380, 0, 450, 21, 16, None, y=-18, bevel=0), bx('slotcut', 452, 22, 540, 34, 10, None, y=0, bevel=0)])
    P.append(rc)
    P.append(bx('bolt', 372, -2, 458, 22, 14, steel, y=-4, bevel=1.5))
    P.append(sl('lower', [(296, -32), (470, -32), (470, -44), (300, -52)], 32, steel, bevel=2))
    P.append(sl('pgrip', [(318, -46), (374, -46), (366, -82), (358, -152), (318, -158), (304, -150), (310, -100)], 32, wd, bevel=6, smooth=2, segs=4))
    P.append(guard('tguard', [(372, -46), (378, -64), (394, -74), (416, -70), (424, -46)], 3, steel, flat=2.4))
    P.append(sl('trigger', [(390, -44), (392, -58), (397, -62), (400, -44)], 6, steel, bevel=1))
    P.append(bx('magwell', 432, -52, 482, -30, 34, steel, bevel=2))
    P.append(sl('mag', [(438, -50), (476, -50), (478, -214), (440, -214)], 22, steel, bevel=2))
    for z in range(-66, -210, -16):
        P.append(bx(f'magrib{z}', 436, z - 3, 480, z, 24, steel, bevel=0.9))
    P.append(sl('rsight', [(304, 28), (306, 50), (330, 50), (334, 28)], 16, steel, bevel=1.5))
    P.append(cy('knob', 7, 16, steel, 470, 0, 36, 'Z', 24, 1.5))
    # barrel with cooling fins
    prof = [(0, 0), (11, 0)]
    for i in range(30):
        z0 = 12 + i * 5.2
        prof += [(11, z0), (16.5, z0 + 0.6), (16.5, z0 + 2.6), (11, z0 + 3.2)]
    prof += [(11, 170), (10, 175), (10, 232), (15.5, 236), (15.5, 294), (0, 294)]
    br = D.lathe('barrel', [(r * MM, z * MM) for r, z in prof], steel, segs=40)
    br.rotation_euler = (0, math.radians(90), 0); br.location = (558 * MM, 0, 0); P.append(br)
    for i in range(4):   # Cutts compensator slots
        P.append(bx(f'cutts{i}', 800 + i * 10, 13, 806 + i * 10, 16.2, 16, dark, bevel=0.3))
    P.append(cy('bore', 4.6, 1, dark, 852.6, 0, 0, 'X', 24, 0))
    P.append(sl('fsight', [(836, 14), (838, 26), (844, 26), (846, 14)], 3, steel, bevel=0.5))
    P.append(sl('fgrip', [(596, -10), (660, -10), (652, -36), (658, -56), (650, -76), (656, -98), (648, -118), (606, -120), (600, -60)],
                32, wd, bevel=6, smooth=2, segs=4))
    P.append(bx('fg_mount', 590, -16, 666, -6, 30, steel, bevel=1.5))
    return P, (853, 0)


@S.shot('smg')
def _smg(mode):
    parts, mz = thompson(); lay(parts, 'thompson', mz, upright=mode == 'item')
    S.shoot('smg', mode, box=(96, 34), margin=0.035, slot=2)


def beretta():
    """Beretta M1935 (7.65 mm), wartime plum-blued with walnut-brown grooved grips: the short open-top slide leaves the
    bright barrel bare along its top (the Beretta signature, distinct from the P38), finger-spur magazine, spur hammer."""
    steel = blue('ber_blued2', (0.27, 0.23, 0.26))
    bright = M.gunmetal('ber_barrel', M.lin((0.52, 0.52, 0.54)), coat_metal=0.95, rough=0.2, wear=0.4)
    dark = M.solid('port_dark', M.lin((0.012, 0.012, 0.012)), rough=0.8, spec=0.0, bevel=0.0001)
    bak = grooved_grip('ber_grip2', M.lin((0.20, 0.09, 0.035)), pitch=2.6)
    P = []
    slide = sl('slide', [(0, 82), (0, 100), (3, 103), (46, 103), (52, 94), (136, 94), (138, 101), (148, 101), (150, 98), (150, 82)], 19, steel, bevel=1.6, segs=4)
    D.cut(slide, [bx(f'g{i}', 5 + i * 3.0, 84, 6.3 + i * 3.0, 104, 3, None, y=sg * 9.5, bevel=0) for i in range(6) for sg in (-1, 1)]); P.append(slide)
    P.append(cy('barrel', 7.0, 96, bright, 100, 0, 94.5, 'X', 40, 0.6))
    P.append(cy('bore', 2.4, 1, dark, 150.6, 0, 92, 'X', 24, 0))
    P.append(sl('frame', [(-4, 82.6), (132, 82.6), (132, 78), (126, 74), (70, 72), (48, 68), (44, 56), (38, 16), (-6, 16), (-5, 40), (-2, 64), (1, 76)], 18.5, steel, bevel=1.3))
    P.append(sl('hammer', [(-1, 82), (-4, 92), (-10, 96), (-13, 91), (-7, 82)], 6.5, steel, bevel=0.9, smooth=1))
    P.append(sl('magbase', [(-7, 8), (-7, 16.5), (40, 16.5), (44, 10), (54, 6), (56, 2), (50, 0), (36, 4), (-4, 8)], 16, steel, bevel=1.2, smooth=1, keep=(0, 1, 2)))
    P.append(sl('panel', [(-3, 20), (35, 20), (43, 64), (0, 74)], 24, bak, bevel=2.0, smooth=2, segs=4))
    P.append(cy('gscrew', 2.8, 1.2, bright, 20, -12.6, 44, 'Y', 24, 0.5))
    P.append(guard('tguard', [(48, 70), (50, 60), (58, 52.5), (72, 52), (84, 58), (88, 66), (86, 73)], 2.4, steel, flat=2.4))
    P.append(sl('trigger', [(58, 72), (57, 63), (61, 57), (64, 59), (62, 65), (64, 72)], 6, bright, bevel=0.7, smooth=1))
    P.append(sl('safety', [(28, 76), (30, 81), (44, 81), (46, 76)], 21, bright, bevel=0.8))
    return P, (151, 93)


@S.shot('beretta')
def _beretta(mode):
    parts, mz = beretta(); lay(parts, 'beretta', mz, upright=mode == 'item')
    S.shoot('beretta', mode, box=(48, 34))


def speargun():
    """1940s rubber-powered speargun: wooden stock + pistol grip, steel spear with barbed head, twin rubbers loaded."""
    steel = M.metal('spear_steel', M.lin((0.62, 0.63, 0.64)), rough=0.3, wear=0.3)
    wd = M.wood('teak', tint=(1.0, 0.8, 0.6), tex='dark_wood', scale=0.4, rough=0.5, coat=0.15, stretch=(3, 1, 1))
    rub = M.solid('rubber', M.lin((0.62, 0.42, 0.22)), rough=0.5, bevel=0.0005, var=0.2)
    brass = M.metal('sg_brass', M.lin((0.62, 0.50, 0.28)), rough=0.35, wear=0.5)
    P = []
    P.append(sl('stock', [(0, -18), (40, 18), (780, 14), (800, 8), (800, -10), (300, -18), (200, -22), (120, -24)], 32, wd, bevel=6, smooth=1, segs=3))
    P.append(sl('grip', [(90, -18), (158, -18), (148, -60), (148, -126), (100, -132), (86, -122), (92, -60)], 32, wd, bevel=7, smooth=2, segs=4))
    P.append(guard('tguard', [(150, -18), (156, -38), (170, -46), (192, -42), (198, -18)], 2.6, steel, flat=2.0))
    P.append(sl('trigger', [(162, -16), (164, -34), (171, -39), (174, -16)], 7, steel, bevel=1.0))
    P.append(cy('muzzle', 16, 18, brass, 796, 0, 2, 'X', 32, 1.5))
    P.append(cy('shaft', 5.5, 950, steel, 540, 0, 20, 'X', 20, 0.4))
    tip = D.lathe('tip', [(0, 0), (7 * MM, 0), (8.5 * MM, 10 * MM), (0, 62 * MM)], steel, segs=24)
    tip.rotation_euler = (0, math.radians(90), 0); tip.location = (1012 * MM, 0, 20 * MM); P.append(tip)
    for sgn in (1, -1):
        P.append(sl(f'barb{sgn}', [(1004, 20), (1050, 20 + sgn * 3.5), (996, 20 + sgn * 24)], 3.5, steel, bevel=0.5))
        P.append(D.tube(f'rubber{sgn}', [(800 * MM, sgn * 17 * MM, 4 * MM), (600 * MM, sgn * 11 * MM, 12 * MM), (430 * MM, sgn * 4 * MM, 20 * MM)], 6.5 * MM, rub, segs=16))
    P.append(cy('wishbone', 3, 14, steel, 428, 0, 22, 'Y', 16, 0.3))
    return P, (1058, 20)


@S.shot('harpoon')
def _harpoon(mode):
    parts, mz = speargun(); lay(parts, 'speargun', mz, upright=mode == 'item')
    S.shoot('harpoon', mode, box=(96, 26), margin=0.03, slot=2)


def cartridge303():
    brass = M.metal('case_brass', M.lin((0.78, 0.60, 0.33)), rough=0.24, wear=0.2)
    cupro = M.metal('cupro', M.lin((0.74, 0.62, 0.52)), rough=0.22, wear=0.1)
    case = [(0, 0), (6.7, 0), (6.8, 1.6), (5.8, 1.9), (5.9, 3.0), (5.8, 42), (5.1, 45), (4.3, 47), (4.3, 56.4), (0, 56.4)]
    bul = [(0, 50), (3.95, 50), (3.95, 62), (3.6, 70), (2.7, 76), (1.3, 80), (0.2, 81.5), (0, 81.6)]
    a = D.lathe('case', [(r * MM, z * MM) for r, z in case], brass, segs=48)
    b = D.lathe('bullet', [(r * MM, z * MM) for r, z in bul], cupro, segs=48)
    p = D.cyl('primer', 2.3 * MM, 0.4 * MM, cupro, loc=(0, 0, -0.1 * MM), segs=32)
    return [a, b, p]


@S.shot('cartridge')
def _cart(mode):
    parts = cartridge303(); D.group('cartridge', parts, rot=(0, 0, 0))
    S.shoot('cartridge', 'item', box=(5, 14), preset='tool', elev=14, azim=-10, lens=85, margin=0.02, shadow=False, scale=12, slot=0)
