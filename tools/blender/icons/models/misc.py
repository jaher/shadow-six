# misc.py - Mills bomb, bear trap, dinghy, diving gear, folded tunic, officer's cap, oil drum.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import sl, bx, cy, MM, walnut
from tools import ring, rsec, nickel, brass_mat, od_paint


def mills():
    """No.36M Mills bomb: segmented cast-iron body (8 x 6 pads), fuse plug, striker lever, split pin + ring. Upright (Z)."""
    iron = M.paint('mills_paint2', M.lin((0.36, 0.39, 0.27)), rough=0.38, wear=1.0, under=M.lin((0.62, 0.62, 0.63)), chips=0.22)
    st = M.metal('mills_steel', M.lin((0.45, 0.46, 0.47)), rough=0.35, wear=0.4)
    br = brass_mat()
    prof = []
    for i in range(97):
        t = i / 96; z = -46 + 92 * t
        r = 30.5 * math.sqrt(max(0, 1 - ((z - 2) / 50) ** 2)) ** 0.9
        prof.append((max(r, 9.5 if i in (0, 96) else 0.01), z))
    prof = [(0, -46)] + prof + [(0, 46)]
    body = D.lathe('body', [(r * MM, z * MM) for r, z in prof], iron, segs=96, smooth_angle=80)
    def groove(v):
        r = math.hypot(v.x, v.y)
        if r < 1e-6: return v
        a = math.degrees(math.atan2(v.y, v.x)) % 45; da = min(a, 45 - a) * math.pi / 180 * r / MM   # mm arc distance to groove
        zz = v.z / MM; dz = min(abs(zz - g) for g in (-30, -15, 0, 15, 30))
        g = min(da, dz) if abs(zz) < 40 else 99
        k = 1 - (2.6 * MM / max(r, 1e-6)) * max(0, 1 - g / 2.4) ** 1.5
        return Vector((v.x * k, v.y * k, v.z))
    D.deform(body, groove)
    P = [body]
    P.append(cy('plug', 12, 10, br, 0, 0, -48, 'Z', 40, 1.2))
    P.append(cy('top', 11, 12, st, 0, 0, 50, 'Z', 40, 1.2))
    P.append(cy('striker', 9, 8, st, 0, 0, 58, 'Z', 32, 1.2))
    lever = [(-2, 64), (6, 64), (20, 56), (29, 40), (33, 10), (33, -20), (29, -24), (27, -20), (28, 8), (24, 38), (12, 55), (-2, 58)]
    lv = sl('lever', lever, 14, st, bevel=1.0, smooth=1, keep=(0, 11))
    lv.location.x = 3 * MM; P.append(lv)
    P.append(cy('pin', 1.3, 26, st, -4, 0, 52, 'Y', 12, 0.2))
    P.append(ring('pullring', 11, rsec(2.4, 2.4, 10), st, segs=40, loc=(-10 * MM, -20 * MM, 52 * MM), rot=(90, 30, 0)))
    return P


@S.shot('grenade')
def _grenade(mode):
    D.group('mills', mills(), rot=(0, 0, 200), loc=(0, 0, 0.047))
    S.shoot('grenade', mode, box=(28, 36), margin=0.04, light={'rim': 1.3})


@S.shot('grenade.mini')
def _grenade_mini(mode):
    parts = mills()
    for o in parts:      # count glyph: exaggerated lever + ring so the tiny silhouette still says "grenade"
        if o.name.split('.')[0] in ('lever', 'pullring', 'top', 'striker'):
            o.matrix_world = Matrix.Translation((0, 0, 0.046)) @ Matrix.Scale(1.35, 4) @ Matrix.Translation((0, 0, -0.046)) @ o.matrix_world
    D.group('mills', parts, rot=(0, 0, 200), loc=(0, 0, 0.047))
    S.shoot('grenade.mini', mode, box=(8, 10), margin=0.02, scale=16, shadow=False, slot=0, light={'rim': 1.6, 'key': 1.2})


def trap_steel():
    return M.metal('trap_steel', M.lin((0.42, 0.39, 0.35)), rough=0.45, wear=0.9, wear_color=M.lin((0.72, 0.7, 0.68)), grain=0.5)


def bear_trap():
    """Steel leg-hold trap SET (jaws open flat): two half-ring jaws with tall teeth standing up, the round pan and its
    trigger dog in the middle, twin leaf springs out to the sides, chain and anchor ring. Lying in XY."""
    st = trap_steel(); P = []
    R = 80
    for sgn in (1, -1):
        J = [ring(f'jaw{sgn}', R, rsec(8, 13, 0), st, a0=90 * sgn - 90 + 3, a1=90 * sgn + 90 - 3, segs=40, bevel=0.0008)]
        for k in range(9):
            a = math.radians(90 * sgn - 90 + 14 + k * (180 - 28) / 8)
            tooth = sl(f't{sgn}{k}', [(-7, 0), (7, 0), (1.5, 24), (-1.5, 24)], 6, st, bevel=0.8)
            tooth.matrix_world = Matrix.Translation(((R - 1) * MM * math.cos(a), (R - 1) * MM * math.sin(a), 5 * MM)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z')
            J.append(tooth)
        D.group(f'jawg{sgn}', J, loc=(0, 0, 8 * MM), rot=(sgn * 6, 0, 0))
    P.append(D.box('base', ((2 * R + 40) * MM, 20 * MM, 9 * MM), st, loc=(0, 0, 4.5 * MM), bevel=2 * MM))
    P.append(cy('pan', 36, 4, st, 0, 8, 14, 'Z', 48, 1.2))
    P.append(cy('panpost', 6, 12, st, 0, 8, 8, 'Z', 16, 1.0))
    P.append(D.box('dog', (9 * MM, 64 * MM, 4 * MM), st, loc=(0, -46 * MM, 13 * MM), bevel=1.2 * MM))
    for sgn in (1, -1):   # leaf springs, bent U, eye round the jaw ends
        x0 = sgn * (R + 12)
        spring = [(x0, -13), (x0 + sgn * 80, -10), (x0 + sgn * 108, 0), (x0 + sgn * 80, 10), (x0, 13)]
        sp = D.tube(f'spring{sgn}', [(x * MM, y * MM, (12 + 0.06 * abs(x - x0)) * MM) for x, y in spring], 7 * MM, st, segs=12)
        D.squash(sp, (1, 1, 0.55)); P.append(sp)
        P.append(ring(f'eye{sgn}', 15, rsec(6, 11, 0), st, segs=32, loc=(x0 * MM, 0, 12 * MM)))
    for i in range(5):
        o = ring(f'chain{i}', 8, rsec(4.2, 4.2, 10), st, segs=24, loc=(0, (-24 - i * 19) * MM, 4 * MM))
        o.scale = (1, 1.5, 1); o.rotation_euler = (0, math.radians(90 if i % 2 else 0), 0); P.append(o)
    P.append(ring('ring', 22, rsec(6, 6, 10), st, segs=48, loc=(0, -130 * MM, 3 * MM)))
    return P


@S.shot('bearTrap')
def _trap(mode):
    D.group('beartrap', bear_trap(), rot=(34, 0, 10))       # propped: open jaws, teeth and pan face the camera
    S.shoot('bearTrap', mode, box=(46, 34), margin=0.04)


def rubber_mat(name, color, rough=0.55):
    t = M.NT(name)
    n = t.noise(6.0, 4.0, 0.5); f = t.noise(300.0, 6.0, 0.6)
    t.L(t.mix(t.math('MULTIPLY', n, 0.5), color, tuple(v * 0.75 for v in color)), t.p.inputs['Base Color'])
    t.L(t.math('MULTIPLY_ADD', n, 0.15, rough - 0.07), t.p.inputs['Roughness'])
    t.L(t.bump(f, strength=0.08, dist=0.0005), t.p.inputs['Normal'])
    t.set('Sheen Weight', 0.2)
    return t.m


def dinghy():
    """Recce assault dinghy (inflated): grey-green rubberised tubes that sweep up into a pointed bow, a wooden transom
    at the square stern, rope life-line on cleats, rowlocks, floorboards, and a paddle laid across. Lying in XY, bow +X."""
    rb = rubber_mat('boat_rubber2', M.lin((0.36, 0.38, 0.31)), rough=0.5)
    seam = rubber_mat('boat_seam2', M.lin((0.22, 0.23, 0.19)))
    rope = M.textured('rope', 'wool_boucle', tint=(1.25, 1.1, 0.8), scale=0.02, nstrength=1.0)
    wd = M.wood('paddle_wood2', tint=(2.0, 1.6, 1.15), tex='fine_grained_wood', scale=0.5, rough=0.45, coat=0.3, stretch=(3, 1, 1))
    st = M.metal('rowlock', M.lin((0.62, 0.62, 0.62)), rough=0.3, wear=0.5)
    L, W, r = 1.2, 0.58, 0.16
    def z_at(x): return r + 0.16 * max(0.0, (x - 0.35 * L) / (0.9 * L)) ** 2          # bow sweeps up
    path = [(-L, -W), (-0.2 * L, -W * 1.02), (0.45 * L, -W * 0.9), (0.95 * L, -W * 0.45), (1.25 * L, 0), (0.95 * L, W * 0.45), (0.45 * L, W * 0.9),
            (-0.2 * L, W * 1.02), (-L, W)]
    P = [D.tube('tube', [(x, y, z_at(x)) for x, y in path], r, rb, segs=32, closed=False, res=24)]
    for sg in (1, -1):   # stern tube ends (closed cones)
        c = D.lathe(f'cone{sg}', [(0, 0), (r * 0.98, 0), (r * 0.8, 0.08), (0, 0.13)], rb, segs=32)
        c.rotation_euler = (0, math.radians(-90), 0); c.location = (-L, sg * W, r); P.append(c)
    P.append(D.box('transom', (0.05, 2 * W - 0.1, 0.28), wd, loc=(-L + 0.06, 0, 0.16), bevel=0.012))
    P.append(D.tube('rope', [(x * 1.0 + (0.02 if x > 0 else 0), y * (1 + 0.95 * r / W), z_at(x) + r * 0.55) for x, y in path], 0.013, rope, segs=10, res=24))
    for x in (-0.7, -0.1, 0.5):     # rope cleats / rope loops
        for sg in (1, -1):
            yy = sg * W * (1.02 if x < 0.2 else 0.92) * (1 + 0.95 * r / W)
            P.append(D.box(f'patch{x}{sg}', (0.08, 0.03, 0.05), seam, loc=(x, yy * 0.99, z_at(x) + r * 0.45), bevel=0.01))
    P.append(D.box('floor', (2.0, 0.95, 0.03), seam, loc=(-0.05, 0, 0.03), bevel=0.012, segs=3))
    for k in range(5):
        P.append(D.box(f'board{k}', (1.7, 0.1, 0.02), wd, loc=(-0.1, -0.34 + k * 0.17, 0.055), bevel=0.006))
    for sg in (1, -1):   # rowlocks
        P.append(D.box(f'rlp{sg}', (0.12, 0.06, 0.03), wd, loc=(0.0, sg * (W + 0.02), 2 * r + 0.01), bevel=0.008))
        P.append(ring(f'rl{sg}', 30, rsec(9, 9, 10), st, a0=0, a1=180, segs=24, loc=(0.0, sg * (W + 0.02), 2 * r + 0.03), rot=(90, 0, 0)))
    pad = sl('blade', [(0, -80), (420, -95), (520, -60), (540, 0), (520, 60), (420, 95), (0, 80)], 22, wd, bevel=5, smooth=2, plane='XY')
    ang = 62
    pad.location = (0.50, 0.14, 2 * r + 0.06); pad.rotation_euler = (0, 0, math.radians(ang)); P.append(pad)
    sh = cy('shaft', 20, 1250, wd, 0, 0, 0, 'X', 24, 2)
    sh.location = (0.50 - 0.62 * math.cos(math.radians(ang)), 0.14 - 0.62 * math.sin(math.radians(ang)), 2 * r + 0.06)
    sh.rotation_euler = (0, math.radians(90), math.radians(ang)); P.append(sh)
    P.append(cy('tgrip', 18, 140, wd, 0, 0, 0, 'X', 24, 3)); P[-1].rotation_euler = (0, math.radians(90), math.radians(ang - 90))
    P[-1].location = (0.50 - 1.24 * math.cos(math.radians(ang)), 0.14 - 1.24 * math.sin(math.radians(ang)), 2 * r + 0.06)
    return P


@S.shot('inflatableBoat')
def _boat(mode):
    D.group('boat', dinghy(), rot=(22, 0, 12))        # propped towards the camera: bow, transom and paddle read
    S.shoot('inflatableBoat', mode, box=(48, 32), margin=0.04)


def soft_box(name, size, mat, loc, rot=(0, 0, 0), levels=3):
    o = D.box(name, size, mat, loc=loc, rot=rot, bevel=0.0)
    o.modifiers.clear()
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    return o


def diving_gear():
    """WWII frogman kit, arranged to read at a glance: the khaki rubberised-canvas rebreather counterlung (stitched
    seams, oxygen bottle strapped below, corrugated breathing hose to a mouthpiece), a round-glass face mask with a
    chromed rim in front, and a dark-green rubber fin fanned out behind. Lying in XY."""
    bagm = M.textured('rebreather', 'hessian_230', tint=(1.05, 0.92, 0.62), scale=0.06, nstrength=0.8, coat=0.35)
    seamm = M.solid('bag_seam', M.lin((0.30, 0.24, 0.14)), rough=0.5, var=0.1)
    fin = rubber_mat('fin_green', M.lin((0.16, 0.22, 0.15)), rough=0.42)
    blk = rubber_mat('rubber_mask', M.lin((0.20, 0.24, 0.19)), rough=0.4)      # grey-green rubber: reads on the olive pack
    hose = rubber_mat('hose_brn', M.lin((0.34, 0.22, 0.12)), rough=0.45)
    gl = M.glass('mask_glass2', color=(0.80, 0.92, 0.95), rough=0.01)
    ni = nickel(); P = []
    # fin behind (fanned, ribs raised)
    g = [sl('fin', [(0, -52), (240, -110), (340, -104), (356, 0), (340, 104), (240, 110), (0, 52)], 9, fin, bevel=2.5, smooth=1, plane='XY', taper=0.85)]
    for yy in (-44, 0, 44):
        g.append(D.tube(f'rib{yy}', [(0.02, yy * MM * 0.8, 0.006), (0.2, yy * MM * 1.5, 0.006), (0.33, yy * MM * 2.0, 0.006)], 0.007, fin, segs=10))
    g.append(soft_box('pocket', (0.14, 0.10, 0.055), fin, loc=(-0.03, 0, 0.024)))
    D.group('fing', g, loc=(0.02, 0.14, 0.004), rot=(0, 0, 28))
    # counterlung bag (soft pillow) with a welt seam round it
    bag = soft_box('bag', (0.30, 0.22, 0.08), bagm, loc=(-0.05, -0.02, 0.05)); P.append(bag)
    P.append(D.tube('bagseam', [(-0.05 + 0.128 * math.cos(2 * math.pi * k / 24), -0.02 + 0.088 * math.sin(2 * math.pi * k / 24), 0.052)
                                for k in range(24)], 0.006, seamm, segs=8, closed=True))
    for x in (-0.13, 0.03):   # webbing straps across the bag
        P.append(D.box(f'strap{x}', (0.035, 0.25, 0.012), M.textured('web2', 'hessian_230', tint=(0.62, 0.62, 0.42), scale=0.03, nstrength=0.9), loc=(x, -0.02, 0.09), bevel=0.004))
        P.append(D.box(f'buckle{x}', (0.045, 0.02, 0.016), ni, loc=(x, -0.11, 0.095), bevel=0.003))
    o2 = D.lathe('o2', [(0, 0), (0.035, 0), (0.037, 0.02), (0.037, 0.20), (0.027, 0.23), (0.012, 0.24), (0, 0.24)],
                 M.paint('o2_black', M.lin((0.08, 0.08, 0.08)), rough=0.3, wear=1.0, under=M.lin((0.6, 0.6, 0.6)), chips=0.25), segs=48)
    o2.rotation_euler = (0, math.radians(90), 0); o2.location = (-0.19, -0.17, 0.04); P.append(o2)
    P.append(cy('valve', 14, 30, ni, 0, 0, 0, 'X', 24, 2)); P[-1].rotation_euler = (0, math.radians(90), 0); P[-1].location = (0.065, -0.17, 0.04)
    # corrugated hose from the bag to the mouthpiece
    pts = [(0.09, 0.02, 0.07), (0.17, 0.0, 0.09), (0.21, -0.08, 0.08), (0.2, -0.16, 0.06)]
    P.append(D.tube('hose', pts, 0.016, hose, segs=16))
    for k in range(10):
        t = k / 9; a, b = int(t * 2.999), min(3, int(t * 2.999) + 1); f = t * 3 - a
        p = [pts[a][q] * (1 - f) + pts[b][q] * f for q in range(3)]
        P.append(ring(f'corr{k}', 16.5, rsec(3, 3, 8), hose, segs=24, loc=tuple(p), rot=(0, 90, 0)))
    P.append(soft_box('mouth', (0.05, 0.04, 0.03), blk, loc=(0.2, -0.18, 0.06)))
    # face mask in front, tilted up to the camera
    mask = [ring('skirt', 70, rsec(26, 30, 16), blk, segs=64), ring('rim', 69, rsec(10, 9, 12), ni, segs=64, loc=(0, 0, 16 * MM)),
            cy('glass', 69, 4, gl, 0, 0, 16, 'Z', 64, 0.5),
            cy('lens_back', 66, 2, M.solid('mask_lens2', M.lin((0.52, 0.64, 0.70)), rough=0.05, coat=1.0, var=0.2, vscale=6.0), 0, 0, 12, 'Z', 64, 0)]
    for sg in (1, -1):   # head-strap stubs on the sides (a mask, not a pan)
        mask.append(D.box(f'mstrap{sg}', (0.05, 0.024, 0.008), blk, loc=(sg * 0.095, 0, 0.012), bevel=0.003))
    mg = D.group('maskg', mask, loc=(-0.02, -0.30, 0.07), rot=(38, 0, -4))
    mg.scale = (1.12, 0.86, 0.86)
    return P


@S.shot('divingGear')
def _dive(mode):
    D.group('diving', diving_gear(), rot=(26, 0, 0))
    S.shoot('divingGear', mode, box=(46, 36), margin=0.04)


def wool(name, color, scale=0.05):
    return M.textured(name, 'Fabric030', tint=tuple(c / 0.105 for c in color), scale=scale, nstrength=1.0, sheen=0.12, rough_add=0.15)


def alu():
    return M.metal('alu_button', M.lin((0.66, 0.67, 0.66)), rough=0.35, wear=0.3, grain=0.4)


def pebbled_button(name, x, y, z, r=8.5):
    b = D.lathe(name, [(0, 0), (r * MM, 0), (r * MM, 1.5 * MM), (r * 0.7 * MM, 3.2 * MM), (0, 3.6 * MM)], alu(), segs=32)
    b.location = (x, y, z); return b


def folded_tunic():
    """Folded German M36 field tunic (the enemy disguise; no insignia eagle): field-grey wool with a visible fold,
    dark bottle-green collar with silver Litzen collar tabs, shoulder boards with white piping, big pleated patch
    pockets with scalloped flaps, pebbled aluminium buttons."""
    fg = wool('feldgrau3', M.lin((0.21, 0.225, 0.19)))
    gr = wool('bottlegreen3', M.lin((0.075, 0.13, 0.09)))
    lz = M.metal('litzen2', M.lin((0.80, 0.80, 0.76)), rough=0.35, wear=0.0)
    pip = M.solid('sb_piping', M.lin((0.82, 0.82, 0.76)), rough=0.6)
    P = []
    body = D.box('body', (0.30, 0.24, 0.06), fg, loc=(0, 0, 0.03), bevel=0.018, segs=3)
    m = body.modifiers.new('sub', 'SUBSURF'); m.levels = 2; m.render_levels = 2
    tx = bpy.data.textures.new('cloth_n2', 'CLOUDS'); tx.noise_scale = 0.05
    d = body.modifiers.new('disp', 'DISPLACE'); d.texture = tx; d.strength = 0.005; P.append(body)
    fold = D.tube('fold', [(-0.15, -0.115, 0.045), (0.0, -0.119, 0.048), (0.15, -0.115, 0.045)], 0.022, fg, segs=16)
    D.squash(fold, (1, 1, 0.9)); P.append(fold)
    col = D.tube('collar', [(-0.11, 0.115, 0.066), (-0.075, 0.075, 0.068), (-0.035, 0.052, 0.069), (0.0, 0.046, 0.069), (0.035, 0.052, 0.069), (0.075, 0.075, 0.068), (0.11, 0.115, 0.066)], 0.026, gr, segs=16)
    D.squash(col, (1, 1, 0.4)); P.append(col)
    for sx in (-1, 1):
        sv = D.tube(f'sleeve{sx}', [(sx * 0.13, 0.11, 0.058), (sx * 0.136, 0.0, 0.06), (sx * 0.13, -0.10, 0.058)], 0.03, fg, segs=16)
        D.squash(sv, (1, 1, 0.5)); P.append(sv)
        sb = D.box(f'sboard{sx}', (0.075, 0.034, 0.008), gr, loc=(sx * 0.105, 0.095, 0.068), rot=(0, 0, sx * 38), bevel=0.004)
        P.append(sb)
        P.append(D.tube(f'sbpipe{sx}', [(sx * 0.105 + sx * 0.03 * math.cos(math.radians(38)) + dx, 0.095 + 0.03 * math.sin(math.radians(38)) * 1 + dy, 0.07)
                                         for dx, dy in ((-0.055 * math.cos(math.radians(38)) * sx, -0.055 * math.sin(math.radians(38))), (0, 0))], 0.0028, pip, segs=8))
        P.append(pebbled_button(f'sb{sx}', sx * 0.085, 0.082, 0.073, r=7))
        tab = D.box(f'tab{sx}', (0.048, 0.028, 0.003), gr, loc=(sx * 0.058, 0.064, 0.077), rot=(0, 0, sx * 32), bevel=0.002); P.append(tab)
        for k in (-1, 1):
            P.append(D.box(f'litze{sx}{k}', (0.040, 0.0045, 0.002), lz, loc=(sx * 0.058 - k * 0.004 * sx, 0.064 + k * 0.0065, 0.079), rot=(0, 0, sx * 32), bevel=0.001))
        P.append(D.box(f'pocket{sx}', (0.11, 0.09, 0.01), fg, loc=(sx * 0.068, -0.03, 0.061), bevel=0.005))
        P.append(D.box(f'pleat{sx}', (0.008, 0.08, 0.004), M.solid('pleat_shadow', M.lin((0.06, 0.065, 0.055)), rough=0.8), loc=(sx * 0.068, -0.034, 0.067), bevel=0.001))
        flap = sl(f'flap{sx}', [(-56, 0), (56, 0), (56, -28), (34, -34), (0, -44), (-34, -34), (-56, -28)], 5, fg, bevel=1.5, smooth=1, keep=(0, 1), plane='XY')
        flap.location = (sx * 0.068, 0.018, 0.067); P.append(flap)
        P.append(pebbled_button(f'pb{sx}', sx * 0.068, -0.016, 0.073, r=9))
    for i in range(4):
        P.append(pebbled_button(f'b{i}', 0.0, 0.026 - i * 0.042, 0.064, r=10))
    return P


@S.shot('uniform')
def _uniform(mode):
    D.group('tunic', folded_tunic(), rot=(36, 0, 6))       # propped: collar tabs, shoulder boards and pockets face the camera
    S.shoot('uniform', mode, box=(42, 34), margin=0.04)


def officer_cap():
    """German officer's peaked cap (Schirmmütze), no eagle: field-grey crown with high front saddle, dark-green band,
    white piping, black visor, silver chin cords + buttons, cockade in an oak wreath."""
    fg = wool('cap_grey2', M.lin((0.15, 0.165, 0.14)))
    gr = wool('cap_band2', M.lin((0.10, 0.19, 0.13)))
    pip = M.solid('piping', M.lin((0.85, 0.84, 0.78)), rough=0.6)
    visor = M.solid('visor', M.lin((0.03, 0.03, 0.03)), rough=0.12, coat=0.8, bevel=0.001)
    sil = M.metal('silver', M.lin((0.78, 0.78, 0.76)), rough=0.3, wear=0.2)
    P = []
    RX, RY = 0.100, 0.090
    band = ring('band', 0, [(RX * 1000 - 3, 0), (RX * 1000 + 2, 0), (RX * 1000 + 2, 42), (RX * 1000 - 3, 42)], gr, segs=64)
    band.scale = (1, RY / RX, 1); P.append(band)
    for z in (0.0425, 0.0005):
        o = ring(f'pipe{z}', RX * 1000 + 2.3, rsec(2.4, 2.4, 8), pip, segs=64, loc=(0, 0, z)); o.scale = (1, RY / RX, 1); P.append(o)
    # crown: lofted from the band top to a wider oval top whose front rises into the high "saddle", lightly domed
    N = 72; bm = bmesh.new(); rows = []
    def top_h(th):
        f = max(0.0, -math.sin(th))
        return 0.062 + 0.040 * f ** 1.8
    for k, (t, grow, dz) in enumerate(((0.0, 1.0, 0.0), (0.5, 1.13, 0.0), (0.85, 1.22, 0.0), (1.0, 1.235, 0.0), (1.05, 1.18, 0.003), (1.2, 0.9, 0.008), (1.35, 0.5, 0.011), (1.45, 0.0, 0.012))):
        row = []
        for n in range(N if grow > 0 else 1):
            th = 2 * math.pi * n / N
            if t <= 1.0:
                z = 0.042 + (top_h(th) - 0.042) * (t ** 0.8)
            else:
                z = top_h(th) + dz
            rx, ry = RX * grow, RY * grow
            row.append(bm.verts.new((rx * math.cos(th), ry * math.sin(th) - 0.008 * min(t, 1.0), z)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for n in range(N):
            m = (n + 1) % N
            if len(b) == 1: bm.faces.new((a[n], a[m], b[0]))
            else: bm.faces.new((a[n], a[m], b[m], b[n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cr = D.from_bm('crown', bm, fg, bevel=0.0, angle=70)
    m = cr.modifiers.new('sub', 'SUBSURF'); m.levels = 2; m.render_levels = 2
    P.append(cr)
    rim = [(RX * 1.235 * math.cos(2 * math.pi * n / 48), RY * 1.235 * math.sin(2 * math.pi * n / 48) - 0.008,
            0.062 + 0.040 * max(0.0, -math.sin(2 * math.pi * n / 48)) ** 1.8 + 0.0005) for n in range(48)]
    P.append(D.tube('crownpipe', rim, 0.0026, pip, segs=10, closed=True))
    vz = D.slab('visor', [(0.11 * math.cos(math.radians(a)), -0.085 - 0.07 * math.sin(math.radians(a)) + 0.07 * 0) for a in range(0, 181, 10)][::-1] + [(0.105 * math.cos(math.radians(a)), -0.075 * math.sin(math.radians(a)) * 0.9) for a in range(180, -1, -10)][::-1], 0.003, visor, plane='XY', bevel=0.001)
    vz.location = (0, 0.0, 0.008); vz.rotation_euler = (math.radians(16), 0, 0); vz.scale = (1.0, 0.95, 1.0); P.append(vz)
    for s_ in (-1, 1):
        P.append(D.tube(f'cord{s_}', [(s_ * 0.095, -0.03, 0.012), (s_ * 0.05, -0.088, 0.013), (0, -0.094, 0.013)], 0.0042, sil, segs=10))
        P.append(D.lathe(f'cbtn{s_}', [(0, 0), (0.006, 0), (0.005, 0.003), (0, 0.004)], sil, segs=24, loc=(s_ * 0.096, -0.03, 0.012), rot=(0, s_ * 80, 0)))
    for k, (r, c) in enumerate(((0.013, (0.8, 0.05, 0.04)), (0.009, (0.9, 0.9, 0.88)), (0.005, (0.02, 0.02, 0.02)))):
        P.append(D.lathe(f'cock{k}', [(0, 0), (r, 0), (r, 0.003 + k * 0.0006), (0, 0.004 + k * 0.0006)], M.solid(f'ck{k}', M.lin(c), rough=0.3, coat=0.5), segs=40,
                         loc=(0, -0.0905, 0.022), rot=(90, 0, 0)))
    P.append(ring('wreath', 15, rsec(3.5, 2.5, 8), sil, a0=200, a1=520 - 180, segs=40, loc=(0, -0.089, 0.022), rot=(90, 0, 0)))
    return P


@S.shot('cap')
def _cap(mode):
    D.group('cap', officer_cap(), rot=(-16, 0, -6))       # tipped back a little: saddle, band, cords, cockade face the camera
    S.shoot('cap', mode, box=(40, 32), margin=0.04)


def oil_drum():
    """200 l steel drum, rusty red paint, rolling hoops, bungs. Upright."""
    paint = M.paint('drum_red', M.lin((0.50, 0.14, 0.08)), rough=0.55, wear=1.0, under=M.lin((0.38, 0.24, 0.16)), chips=0.2)
    st = M.metal('drum_steel', M.lin((0.45, 0.44, 0.42)), rough=0.4, wear=0.5)
    R, H = 0.29, 0.88
    prof = [(0, 0), (R - 0.01, 0), (R, 0.012), (R + 0.004, 0.02), (R, 0.028)]
    for zc in (H / 3, 2 * H / 3):
        prof += [(R, zc - 0.02), (R + 0.012, zc - 0.008), (R + 0.012, zc + 0.008), (R, zc + 0.02)]
    prof += [(R, H - 0.028), (R + 0.004, H - 0.02), (R, H - 0.012), (R - 0.01, H), (0, H)]
    P = [D.lathe('drum', prof, paint, segs=72)]
    P.append(cy('bung1', 30, 12, st, 150, 0, 880, 'Z', 6, 2))
    P.append(cy('bung2', 20, 10, st, -170, 60, 880, 'Z', 24, 2))
    return P


# the oil drum is only a cursor (cursors.py c_barrel)
