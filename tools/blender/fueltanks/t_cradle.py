"""fuel_tank_h_cradle (docs/fuel-tanks.md §5.1): M2 field depot tank, footprint 9.0 x 3.4 x 3.5 m.
Pale cream civil tank (Ø 2.30, 7.0 m with 2:1 dished heads) on timber cribs with bolsters + hold-down straps,
crown manhole / filler / flame-arrestor vent / dip hatch, plank catwalk on clamped brackets with a low tube rail,
timber trestle stand with ladder at the +X end (mirror `_m`: -X end), outlet -> gate valve -> wing pump, timber-plank
bund on the footprint edge, gravel floor, drums, sign, fire bucket. snow: caps, icicles, drifts.
destroyed: crown burst with peeled petals, far head blown off, shell sagging onto one crib, catwalk hanging, stand
leaning and charred, bund burnt to stumps, scorch + oil-burn pool."""
import math, random
import ft
from ft import K, C, V, bmn, P, PAL

W, D, H = 9.0, 3.4, 3.5
R, LC, HD = 1.15, 6.2, 0.40
CX0, CZ = -0.55, 1.60                 # shell centre (Blender x, z) for the stand at +X
DECK = 2.85


def build(out, dest, seed, snow, mirror=False, theater='snow', name='fuel_tank_h_cradle', paint='cream'):
    mx = -1.0 if mirror else 1.0
    X = lambda x: mx * x                        # noqa: E731  every x goes through X() so `_m` is a true mirror
    K.begin(name + ('_m' if mirror else '') + ('_destroyed' if dest else '') + ('_snow' if snow else ''), seed,
            theater='snow' if snow else theater, snow=snow)
    r = random.Random(seed)
    cx = X(CX0)
    ax = ft.Ax((cx, 0, CZ), (1, 0, 0))          # right-handed frame always; stand-end offsets go through mx * s
    paint_t = PAL[paint] if not dest else ft.pm('#2b2622')
    tilt = []                                   # parts that sag with the shell when destroyed

    # ------------------------------------------------ shell, seams, crown fittings
    shell, seams, fit, bolts = bmn(), bmn(), bmn(), bmn()
    hole = (min(0.0, 2.2 * mx), max(0.0, 2.2 * mx), -0.75, 0.95) if dest else None
    ft.shell_bm(shell, ax, R, LC, HD, segs=32, courses=12 if dest else 4, open_top=hole, ragged=0.45, seed=seed,
                drop_head=-int(mx) if dest else 0)
    if dest:
        tilt.append(P(ft.inner_skin(shell), ft.BURNT_MAT, 'shell_inside', mat_tint=ft.BURNT_RUST, grime=0.2))
    for k in range(5):
        s = -LC / 2 + LC * k / 4
        ft.band_bm(seams, ax, s, R, segs=32)
    for k in range(4):
        s0, s1 = -LC / 2 + LC * k / 4 + 0.03, -LC / 2 + LC * (k + 1) / 4 - 0.03
        a = -0.55 if k % 2 else 0.55
        if not dest or not (hole[0] - 0.3 < (s0 + s1) / 2 < hole[1] + 0.3):
            ft.long_seam_bm(seams, ax, s0, s1, R, a)
    up = lambda s, a: ax.dir(a)                 # noqa: E731
    s_man, s_fill, s_vent, s_dip = (mx * v for v in (1.15, -1.05, -2.45, 1.75))
    if not dest:
        ft.manhole(fit, bolts, ax.p(s_man, 0.32, R), up(s_man, 0.32), r=0.3, neck=0.16)
        ft.dip_hatch(fit, ax.p(s_dip, 0.45, R), up(s_dip, 0.45))
    ft.filler(fit, ax.p(s_fill, 0.3, R), up(s_fill, 0.3))
    ft.vent(fit, ax.p(s_vent, 0.0, R), up(s_vent, 0.0), h=0.62)
    # outlet: sump nozzle low on the stand-end head -> elbow -> gate valve -> down to the wing pump
    so = mx * (LC / 2 + 0.22)
    ro = R * math.sqrt(1 - (0.22 / HD) ** 2)
    p_out = ax.p(so, math.pi, ro * 0.82)
    pipe, wheel = bmn(), bmn()
    e1 = V((X(3.42), 0.0, p_out.z))
    C.cyl_bm(pipe, p_out - V((mx * 0.05, 0, 0)), e1, 0.055, 10)
    ft.gate_valve(pipe, wheel, (X(3.08), 0.0, p_out.z), (1, 0, 0), r_pipe=0.055)
    e2 = V((X(3.42), -0.95, p_out.z))
    C.cyl_bm(pipe, e1, e2, 0.055, 10)
    C.cyl_bm(pipe, e2, V((X(3.42), -0.95, 0.52)), 0.055, 10)
    for q in (e1, e2):
        C.cyl_bm(pipe, q - V((0, 0, 0.07)), q + V((0, 0, 0.07)), 0.075, 10)
    smat = 'paint_metal' if not dest else ft.BURNT_MAT
    if dest:
        paint_t = ft.BURNT
    tilt += [P(shell, smat, 'shell', smooth=True, mat_tint=paint_t, grime=0.55, lod='keep'),
             P(seams, smat, 'seams', mat_tint=tuple(c * 0.95 for c in paint_t), grime=0.35),
             P(fit, smat, 'fittings', smooth=True, mat_tint=tuple(c * 0.8 for c in paint_t), grime=0.8),
             P(bolts, 'cast_iron', 'bolts', grime=0.3)]
    P(pipe, 'paint_metal', 'outlet', smooth=True, mat_tint=PAL['blackgrey'], grime=0.6)
    P(wheel, 'paint_metal', 'valve_wheel', mat_tint=PAL['red'], grime=0.3)
    S = ft.NS(mx=mx, X=X, ax=ax, r=r, tilt=tilt, paint_t=paint_t, hole=hole, s_man=s_man, s_vent=s_vent, s_fill=s_fill,
              dest=dest, snow=snow, seed=seed, theater=theater, cx=cx)
    supports(S)
    catwalk_stand(S)
    bund_dressing(S)
    weather(S)
    if dest:
        wreck(S)
    meta(S)
    ov = [(('blown_head',), ('shell', 'seams', 'fittings', 'straps')),
          (('shell', 'blown_head', 'petals', 'fittings', 'seams', 'shell_inside'), ('cribs', 'bolsters', 'gravel', 'bund', 'bund_tar',
           'bund_posts', 'stand', 'catwalk', 'catwalk_brackets', 'rails', 'pump', 'drums0', 'drums1', 'drums2', 'drums3'))] if dest else []
    return ft.finalize(out, S.theater, bounds=(W, D, H), overlaps=ov)


def supports(S):
    """Timber cribs: a course of squared logs across the tank, a course of chock logs along it, a curved bolster
    fitted to the shell arc, and a flat-bar hold-down strap over the crown bolted to the chocks."""
    X, ax = S.X, S.ax
    logs, bol, strap, bolts = bmn(), bmn(), bmn(), bmn()
    for xc in (S.cx - 1.86 * S.mx, S.cx + 1.86 * S.mx):
        if S.dest and abs(xc - X(CX0 - 1.86)) < 0.01:
            # far crib crushed: logs splayed and charred, the shell end rests on them
            for k, (dx, dy, a) in enumerate(((-0.3, 1.05, 1.35), (0.35, -1.0, 1.75), (0.1, 1.35, 0.4))):
                c = V((xc + dx, dy, 0.11))
                d = V((math.sin(a), math.cos(a), 0))
                C.beam_bm(logs, c - d * 0.6, c + d * 0.6, 0.22, 0.22)     # splayed out from under the shell
            continue
        for dx in (-0.3, 0.3):                          # course A: across
            C.box_bm(logs, (xc + dx, 0, 0.11), (0.22, 2.0, 0.22))
        for dy in (-0.85, 0.85):                        # course B: chocks along the axis
            C.box_bm(logs, (xc, dy, 0.33), (0.9, 0.22, 0.22))
        ft.arc_block(bol, xc - 0.16, xc + 0.16, 0.0, CZ, R, 0.72, 0.22)
        a0, a1 = -2.25, 2.25
        ft.band_bm(strap, ft.Ax((xc, 0, CZ), (1, 0, 0)), 0.0, R + 0.002, w=0.07, proud=0.012, a0=a0, a1=a1)
        for sg in (-1, 1):
            p = V((xc, sg * R * math.sin(2.25), CZ + R * math.cos(2.25)))
            q = V((xc, sg * 0.86, 0.44))
            C.beam_bm(strap, p, q, 0.07, 0.014, up=(0, sg, 0))
            C.cyl_bm(bolts, q + V((0, sg * 0.02, 0.0)), q + V((0, sg * 0.06, 0.0)), 0.02, 6)
    logt = ft.TIMBER if not S.dest else ft.CHAR
    P(logs, 'log_hewn', 'cribs', uv='beam', axis=(0, 1, 0), mat_tint=logt, grime=0.8)
    P(bol, 'timber_tarred', 'bolsters', uv='beam', axis=(0, 1, 0), mat_tint=ft.TARRED if not S.dest else ft.CHAR)
    S.tilt += [P(strap, 'paint_metal', 'straps', mat_tint=ft.PAL['blackgrey'], grime=0.7), P(bolts, 'cast_iron', 'strap_bolts')]


def catwalk_stand(S):
    """Plank catwalk on clamped brackets (off-crown toward the far side), low tube rail, timber stand + ladder."""
    X, ax, mx = S.X, S.ax, S.mx
    ang_c = -0.42                                       # catwalk centre angle (far side = north)
    yc = R * math.sin(-ang_c)                           # ax.dir(-0.42).y = +sin(0.42): north of the crown
    y0, y1 = yc - 0.28, yc + 0.28
    xa, xb = X(-1.9), X(3.15)
    deck, brk, rail, srail = bmn(), bmn(), bmn(), bmn()
    # destroyed: the blast tore the catwalk away over the burst (hole + petal reach), the rest burnt through in places
    gap = (S.cx + S.hole[0] - 0.7, S.cx + S.hole[1] + 0.7) if S.dest else (1e9, 1e9)
    x0_, x1_ = min(xa, xb), max(xa, xb)
    if not S.dest:
        ft.plank_deck(deck, x0_, x1_, y0, y1, DECK, along='x', seed=S.seed)
    else:
        k, x = 0, x0_
        while x < x1_ - 0.05:
            L = min(x1_ - x, S.r.uniform(0.6, 1.3))
            if k % 3 != 1 and (x + L < gap[0] or x > gap[1]):
                ft.plank_deck(deck, x, x + L, y0, y1, DECK, along='x', seed=S.seed + k)
            x += L
            k += 1
    for xb_ in [X(x) for x in (-1.6, -0.4, 0.8, 2.0)]:
        if gap[0] - 0.1 < xb_ < gap[1] + 0.1:
            continue
        for yy in (y0 + 0.05, y1 - 0.05):
            zs = CZ + math.sqrt(max(0.0, R * R - (abs(yy) - 0.026) ** 2))   # highest shell point under the post
            C.box_bm(brk, (xb_, yy, (zs + 0.004 + DECK - 0.05) / 2), (0.05, 0.05, DECK - 0.05 - zs - 0.004))
        C.box_bm(brk, (xb_, yc, DECK - 0.07), (0.06, 0.6, 0.04))
    xe = X(3.15)
    if not S.dest:
        ft.railing(rail, [(xa, y1 + 0.02), (xe, y1 + 0.02)], DECK, h=0.62, step=1.0, r=0.022)
    else:
        for a_, b_ in ((x0_, gap[0]), (gap[1], x1_)):
            if b_ - a_ > 0.5:
                ft.railing(rail, [(a_, y1 + 0.02), (b_, y1 + 0.02)], DECK, h=0.45, step=1.0, r=0.022)   # bent down
    hr = 0.62 if not S.dest else 0.55
    ft.railing(srail, [(xe, y1 + 0.02), (X(4.25), y1 + 0.02)], DECK, h=hr, step=1.0, r=0.022)
    # stand: four 0.15 posts, X braces, platform, ladder on the outer face
    st, ld = bmn(), bmn()
    sx0, sx1 = sorted((X(3.15), X(4.25)))
    sy0, sy1 = -0.45, 0.75
    for x in (sx0 + 0.075, sx1 - 0.075):
        for y in (sy0 + 0.075, sy1 - 0.075):
            C.box_bm(st, (x, y, (DECK - 0.05) / 2), (0.15, 0.15, DECK - 0.05))
        C.beam_bm(st, (x, sy0 + 0.075, 0.3), (x, sy1 - 0.075, DECK - 0.4), 0.08, 0.05)
    for y in (sy0 + 0.075, sy1 - 0.075):
        C.beam_bm(st, (sx0 + 0.075, y, 0.3), (sx1 - 0.075, y, DECK - 0.4), 0.05, 0.08)
        C.box_bm(st, ((sx0 + sx1) / 2, y, DECK - 0.15), (sx1 - sx0, 0.1, 0.12))
    plat = bmn()
    ft.plank_deck(plat, sx0, sx1, sy0, sy1, DECK, along='y', seed=S.seed + 1)
    ft.railing(srail, [(sx0 if mx > 0 else sx1, sy0), ((sx1 if mx > 0 else sx0), sy0)], DECK, h=hr, step=0.55, r=0.022)
    lx = sx1 + 0.04 if mx > 0 else sx0 - 0.04
    ft.ladder(ld, (lx, 0.15, 0.0), DECK, (mx, 0, 0), w=0.45, over=0.58)
    K.ladder_meta((lx + mx * 0.5, 0.15, 0), (lx - mx * 0.4, 0.15, DECK), DECK)
    tim = ft.TIMBER if not S.dest else ft.CHAR
    S.catwalk = [P(deck, 'boards_weathered', 'catwalk', uv='beam', axis=(0, 1, 0), mat_tint=tim),
                 P(brk, 'paint_metal', 'catwalk_brackets', mat_tint=ft.PAL['blackgrey']),
                 P(rail, 'steel_galv', 'rails', mat_tint=(0.55, 0.55, 0.55) if not S.dest else (0.3, 0.28, 0.26), grime=0.5)]
    S.stand = [P(srail, 'steel_galv', 'stand_rails', mat_tint=(0.55, 0.55, 0.55) if not S.dest else (0.3, 0.28, 0.26), grime=0.5),
               P(st, 'timber_beam', 'stand', uv='beam', axis=(0, 0, 1), mat_tint=tim),
               P(plat, 'boards_weathered', 'stand_deck', uv='beam', axis=(1, 0, 0), mat_tint=tim),
               P(ld, 'timber_beam', 'ladder', uv='beam', axis=(0, 0, 1), mat_tint=tim)]
    S.stand_box = (sx0, sx1, sy0, sy1)
    K.anchor('catwalk', ((xa + xb) / 2, yc, DECK), (0, -1, 0), y=DECK, walkable=False)


def bund_dressing(S):
    """Low timber-plank bund on the footprint edge (tarred bottom board, posts at 1.5 m, stile on the south side),
    gravel floor with oil stains, wing pump on its board, drums, sign, fire bucket, hose coil on the stand."""
    X, mx, r = S.X, S.mx, S.r
    hw, hd = W / 2, D / 2
    boards, tar, posts = bmn(), bmn(), bmn()
    gap = (X(3.45), X(4.05))
    g0, g1 = min(gap), max(gap)
    edges = [((-hw, -hd), (hw, -hd)), ((hw, -hd), (hw, hd)), ((hw, hd), (-hw, hd)), ((-hw, hd), (-hw, -hd))]
    for ei, (a, b) in enumerate(edges):
        a, b = V((a[0], a[1], 0)), V((b[0], b[1], 0))
        d = (b - a).normalized()
        n = V((d.y, -d.x, 0))                              # outward normal (CCW ring)
        L = (b - a).length
        segs = [(0.0, L)]
        if ei == 0:                                          # stile gap on the south edge
            segs = [(0.0, g0 + hw), (g1 + hw, L)]
            if S.dest:                                       # the blown head lies there: bund flattened
                h0, h1 = sorted((S.cx - mx * LC / 2, S.cx - mx * LC / 2 + mx * 2.4))
                segs = [(a_, b_) for (a_, b_) in ((t0, min(t1, h0 - 0.2 + hw)) for (t0, t1) in segs) if b_ - a_ > 0.2] + \
                       [(a_, b_) for (a_, b_) in ((max(t0, h1 + 0.2 + hw), t1) for (t0, t1) in segs) if b_ - a_ > 0.2]
        for (t0, t1) in segs:
            for k, z in enumerate((0.1, 0.3, 0.5)):
                if S.dest and k > 0 and r.random() < 0.6:
                    continue
                bmx = tar if k == 0 else boards
                p0, p1 = a + d * (t0 + 0.03) - n * 0.03, a + d * (t1 - 0.03) - n * 0.03
                hh = 0.19 if not S.dest else r.uniform(0.08, 0.19)
                C.beam_bm(bmx, p0 + V((0, 0, z)), p1 + V((0, 0, z)), 0.05, hh)
        k = 0
        while k * 1.5 <= L + 0.01:
            p = a + d * min(k * 1.5, L) - n * 0.1
            skip_h = S.dest and ei == 0 and min(S.cx - mx * LC / 2, S.cx - mx * LC / 2 + mx * 2.4) - 0.2 < p.x < max(S.cx - mx * LC / 2, S.cx - mx * LC / 2 + mx * 2.4) + 0.2
            if not (ei == 0 and g0 - 0.1 < p.x < g1 + 0.1) and not skip_h:
                hgt = 0.62 if not S.dest else r.uniform(0.2, 0.55)
                C.box_bm(posts, (p.x, p.y, hgt / 2), (0.12, 0.12, hgt))
            k += 1
    for z, x in ((0.18, g0 - 0.25), (0.36, g0 - 0.05)):    # stile: two steps each side of the bund
        C.box_bm(posts, ((g0 + g1) / 2, -hd - 0.08 + (0.0 if z < 0.3 else 0.2), z / 2), (g1 - g0, 0.24, z))   # ≤ 0.2 m out
    tim = ft.TIMBER if not S.dest else ft.CHAR
    P(boards, 'boards_weathered', 'bund', uv='beam', axis=(1, 0, 0), mat_tint=(0.86, 0.8, 0.72) if not S.dest else ft.CHAR, grime=0.6)
    P(tar, 'timber_tarred', 'bund_tar', uv='beam', axis=(1, 0, 0), mat_tint=ft.TARRED if not S.dest else ft.CHAR)
    P(posts, 'timber_beam', 'bund_posts', uv='beam', axis=(0, 0, 1), mat_tint=tim)
    fl = bmn()
    C.box_bm(fl, (0, 0, 0.015), (W - 0.24, D - 0.24, 0.03))
    P(fl, 'gravel', 'gravel', mat_tint=(1.0, 0.97, 0.92) if not S.dest else (0.42, 0.38, 0.34), grime=0.4, lod='keep')
    if S.snow and not S.dest:                              # trodden snow lying on the gravel in patches
        sn = bmn()
        for k in range(7):
            c = (r.uniform(-3.8, 3.8), r.choice((-1, 1)) * r.uniform(1.25, 1.5))
            C.box_bm(sn, (c[0], c[1], 0.045), (r.uniform(0.8, 1.8), 0.32, 0.03), r.uniform(-0.2, 0.2))
        P(sn, 'snow', 'floor_snow', grime=0, lod='drop')
    iron, wood, hose = bmn(), bmn(), bmn()
    ft.wing_pump(iron, wood, (X(3.55) - mx * 0.15, -1.05, 0.03), facing=0.0 if mx > 0 else math.pi)
    ft.hose_run(hose, [(X(3.4), -1.05, 0.42), (X(3.0), -1.35, 0.07), (X(2.2), -1.45, 0.06), (X(1.9), -1.2, 0.06)])
    ft.bucket(iron, (X(4.17), S.stand_box[2] - 0.2, 1.1))
    P(iron, 'cast_iron', 'pump', grime=0.4)
    P(wood, 'timber_tarred', 'pump_board', uv='beam', axis=(1, 0, 0))
    P(hose, 'bitumen_felt', 'hose', smooth=True, grime=0)
    sp = [(X(4.05), -1.25, 0.03, False, 0), (X(3.45), 1.3, 0.03, False, 0), (X(4.05), 1.3, 0.03, False, 0),
          (X(2.75), 1.3, 0.03, True, 0.0)]
    if not S.dest:
        ft.drums(sp, S.theater, seed=S.seed)
        ft.sign_board((X(3.7), S.stand_box[2] - 0.02, 1.55), (0, -1, 0), 0.9)
    else:
        ft.drums(sp, S.theater, burst=True, seed=S.seed)
    for k in range(5):
        p = r.choice([(X(3.5), -1.0), (X(2.9), 0.0), (r.uniform(-3.5, 3.0), r.uniform(-1.3, 1.3))])
        ft.decal('oil_stain', (p[0] + r.uniform(-0.3, 0.3), max(-0.9, min(0.9, p[1] + r.uniform(-0.3, 0.3))), 0.032 + 0.001 * k), (0, 0, 1),
                 r.uniform(0.7, 1.2), r.uniform(0.6, 1.0), up=(r.uniform(-1, 1), 1, 0), alpha=0.65)


def weather(S):
    """Stencils (camera side + mirrored far side), rust runs from fittings/seams, primer spots, snow."""
    ax, r = S.ax, S.r
    num = 'behaelter_2' if S.mx < 0 else 'behaelter_1'
    if not S.dest:
        ft.stencil('kraftstoff', ax, R, -0.4 * S.mx, 1.05, 0.40)
        ft.stencil(num, ax, R, -0.4 * S.mx, 1.42, 0.24, alpha=0.8)
        ft.stencil('kraftstoff', ax, R, -0.4 * S.mx, -1.1, 0.40, flip=True, alpha=0.8)
        ft.flat_stencil('27000l', ax.p(S.mx * (-LC / 2 - HD - 0.002), 0, 0), (-S.mx, 0, 0), 0.22)
        ft.shell_streaks(ax, R, [S.s_man, S.s_fill, -LC / 4, LC / 4], ang=0.45, length=1.0, alpha=0.55, seed=S.seed)
        ft.shell_streaks(ax, R, [-LC / 2 + 0.1, LC / 2 - 0.1], ang=1.0, length=0.9, kind='streak_rain', alpha=0.45, seed=S.seed + 3)
        for k in range(4):                                   # worn paint -> red-oxide primer on the crown
            s = r.uniform(-LC / 2 + 0.4, LC / 2 - 0.4)
            ft.wrap_decal('stain_rust_blotch', ax, R, s, r.uniform(-0.2, 0.6), r.uniform(0.3, 0.6), r.uniform(0.25, 0.5), alpha=0.6)
    if S.snow and not S.dest:
        skip = [(S.s_man, 0.42), (S.s_vent, 0.16)]
        ft.snow_cap_shell(ax, R, -LC / 2 - 0.05, LC / 2 + 0.05, half_ang=1.0, thick=0.13, skip=skip, seed=S.seed, rim_tint=S.paint_t)
        flat = [o for o in C.A.parts if o.name.split('.')[0] in ('cribs', 'bund', 'bund_tar', 'bund_posts', 'stand_deck',
                                                                     'catwalk', 'pump_board', 'drums0', 'drums1', 'drums2')]
        K.snow_pass(thick=0.08, min_nz=0.5, parts=flat)
        ic = bmn()
        cw = [o for o in S.catwalk if o]
        yc = R * math.sin(0.42)
        x0, x1 = sorted((S.X(-1.9), S.X(3.15)))
        ft.icicles(ic, (x0, yc + 0.28, 2.8), (x1, yc + 0.28, 2.8), n=12, seed=S.seed)
        sb = S.stand_box
        ft.icicles(ic, (sb[0], sb[2], 2.8), (sb[1], sb[2], 2.8), n=4, seed=S.seed + 1)
        P(ic, 'snow', 'icicles', mat_tint=(0.9, 0.95, 1.0), lod='drop')


    if S.snow:                                            # drifts outside the bund (they survive the fire)
        drift = bmn()
        for (a, b, n) in (((-W / 2 - 0.05, -D / 2), (W / 2 + 0.05, -D / 2), (0, -1)), ((-W / 2, D / 2), (W / 2, D / 2), (0, 1)),
                          ((-W / 2, -D / 2), (-W / 2, D / 2), (-1, 0)), ((W / 2, -D / 2), (W / 2, D / 2), (1, 0))):
            ft.drift_bm(drift, a, b, n, h=0.26, w=0.25, seed=S.seed + len(drift.verts))
        P(drift, 'snow', 'drifts', smooth=True, grime=0, lod='keep')
    if S.snow and S.dest:                                 # melt ring: wet dark ground inside the bund
        for k in range(5):
            ft.decal('wet_ground', (r.uniform(-3.3, 3.3), r.uniform(-0.6, 0.6), 0.04 + 0.001 * k), (0, 0, 1), r.uniform(1.5, 2.4),
                     r.uniform(1.0, 1.6), up=(1, r.uniform(-0.3, 0.3), 0), alpha=0.6)


def wreck(S):
    """Burst crown with peeled petals, the far (-s) head blown off onto the ground, shell sagging onto the crushed
    crib, catwalk wrenched off and hanging, stand leaning, scorch + oil-burn pool, fire anchors."""
    ax, r, X, mx = S.ax, S.r, S.X, S.mx
    pet = bmn()
    hs, he = S.hole[0], S.hole[1]
    ft.petals(pet, ax, R, (hs + he) / 2, 0.1, he - hs, 2.0, n=9, curl=0.7, seed=S.seed)
    S.tilt.append(P(pet, ft.BURNT_MAT, 'petals', mat_tint=ft.BURNT_RUST, grime=0.9))
    # far head blown open: torn off its seam and hanging on a twisted hinge at the south side of the far end, swung
    # back along the south flank (no room to lie 1-2 m beyond the end: the M2 pair stands 1 m apart, end to end)
    hd = bmn()
    xf = S.cx - mx * LC / 2
    ft.dish(hd, (xf, 0.0, CZ), (-mx, 0, 0), R * 0.99, HD)
    hinge = V((xf, -R - HD - 0.06, CZ))                   # torn off: standing on its rim, propped against the flank
    ft.xform_new(hd, 0, ft.Matrix.Translation((0, -HD - 0.04, 0)))  # (it flattened the bund there: bund_dressing)
    ft.xform_new(hd, 0, ft.rot_about(hinge, -mx * math.radians(91), 'Z'))
    ft.xform_new(hd, 0, ft.Matrix.Translation((0, 0, -(CZ - R * 0.99) + 0.03)))   # on the ground (not sagged)
    P(hd, ft.BURNT_MAT, 'blown_head', mat_tint=ft.BURNT, grime=0.9)
    # sag: the shell group pivots on the near crib so the far end comes down onto the crushed crib / the ground
    piv = V((S.cx + (1.86 - 0.17) * mx, 0, CZ - R))
    ang = -math.asin((CZ - R - 0.04) / (1.86 + LC / 2)) * mx
    M = ft.Matrix.Translation(piv) @ ft.Matrix.Rotation(ang, 4, 'Y') @ ft.Matrix.Translation(-piv)
    for o in S.tilt:
        if o:
            o.data.transform(M)
    for o in list(C.A.parts):                             # shell decals sag with it
        if o.name in ft.bpy.data.objects and o.name.split('.')[0].startswith(('wd_', 'streak')):
            o.data.transform(M)
    # catwalk: bracketed to the shell, it comes down with the sag and twists off toward the far (north) side, more
    # toward the far end; burnt planks gone in places (the catwalk deck part is rebuilt with gaps in catwalk_stand)
    yc = R * math.sin(0.42)
    for o in S.catwalk:
        if not o:
            continue
        brk = o.name.split('.')[0] == 'catwalk_brackets'
        for v in o.data.vertices:
            p = M @ V(v.co)
            t = max(0.0, min(1.0, (S.cx + 1.86 * mx - p.x) * mx / (LC / 2 + 1.86)))     # 0 at the near crib .. 1 far end
            tw = -0.42 * t if not brk else 0.0                                           # roll: north edge down
            q = V((0, p.y - (yc - 0.28), p.z - DECK))
            c, s_ = math.cos(tw), math.sin(tw)
            v.co = (p.x, yc - 0.28 + q.y * c - q.z * s_, DECK + q.y * s_ + q.z * c)
        o.data.update()
    sb = S.stand_box
    foot = V(((sb[0] + sb[1]) / 2, (sb[2] + sb[3]) / 2, 0))
    for o in S.stand:
        if o:
            o.data.transform(ft.Matrix.Translation(foot) @ ft.Matrix.Rotation(0.12 * mx, 4, 'Y') @ ft.Matrix.Translation(-foot))
    ft.scorch((0, 0, 0), W * 0.95, D * 0.9, seed=S.seed, z=0.036)
    ft.scorch((0, 0, 0), W + 0.5, D + 0.5, seed=S.seed + 1, z=0.008, alpha=0.6)
    for k in range(9):
        o = ft.wrap_decal('soot_a' if k % 2 else 'soot_b', ax, R, r.uniform(-2.8, 2.8), r.uniform(-1.6, 1.6), r.uniform(1.2, 2.2), r.uniform(1.0, 1.7), alpha=0.6)
        o and o.data.transform(M)
    for k in range(4):                                     # rust at the hole rim
        o = ft.wrap_decal('stain_rust_blotch', ax, R, r.uniform(hs - 0.3, he + 0.3) * 1.0, r.choice((-1, 1)) * r.uniform(0.9, 1.2), 0.7, 0.6, alpha=0.7)
        o and o.data.transform(M)
    for k, (s, a) in enumerate(((0.9, 0.0), (-1.8, 0.6), (2.6, -0.5))):
        p = ax.p(s * mx, a, R * 0.5)
        K.anchor('fire', (p.x, p.y, max(0.3, p.z - 0.6)), (0, -1, 0), size=2.4 - k * 0.5)


def meta(S):
    """Sidecar: main 'tank' footprint = the gameplay footprint; stand legs; blast origin + spout anchors."""
    K.footprint_rect(0, 0, W, D, 0, 'HIGH', 'tank')
    sb = S.stand_box
    K.footprint_rect((sb[0] + sb[1]) / 2, (sb[2] + sb[3]) / 2, sb[1] - sb[0], sb[3] - sb[2], 0, 'HIGH', 'post')
    K.anchor('blast_origin', (S.cx, 0, CZ), (0, -1, 0), radius=4.5, size=[2 * (LC / 2 + HD), 2 * R, 2.75])
    if not S.dest:
        K.anchor('explosive_target', (S.cx, -R - 0.2, 0.9), (0, -1, 0), kind='fuel_tank', chain_radius=7.0)
        K.anchor('spout', (S.X(3.42), -0.95, 0.5), (S.mx, 0, 0))
    C.A.meta['notes'].append('fuel_tank_h_cradle (docs/fuel-tanks.md §5.1): pivot = footprint centre, +X long axis, '
                               'stand at %s' % ('-X (mirror)' if S.mx < 0 else '+X'))
