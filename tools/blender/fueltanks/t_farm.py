"""fuel_tank_farm_9x7 / _85x63 (docs/fuel-tanks.md §5.2): M8 desert tank block under a walkable steel deck.
TWIN short, fat, dark maroon-brown tanks side by side (as the original M8: the grating deck sits right on them; axes
along game Z, dished heads facing out on the long faces) on dark concrete saddles with straps, under a steel I-section
frame with end-bay cross bracing and an open grating deck at 4.50 m (toe boards, tube rail, opening at the caged ladder
on the south face, at the mission ladder's x), a manifold header along the north face with gate valves to both tanks and
a dispensing stand, concrete slab + kerb with a ramp notch, drums, sign.
destroyed: SW column buckled, the deck folds along the NW-SE diagonal and its SW half drops onto the west tank (grating
bent, rails folded); the west tank burst on its outer side (petals), the east tank's south head blown off and leaning
against the kerb, both soot-black; scorch. The mission walkway goes in code (fuelWreckNav)."""
import math, random
import ft
from ft import K, C, V, bmn, P, PAL

# R / pitch: the crowns sit 0.28 m under the deck beams (the original's deck rests on the tanks); lx = mission ladder x
SIZES = {'fuel_tank_farm_9x7': dict(W=9.0, D=7.0, R=1.78, pitch=4.3, LC=4.4, HD=0.45, lx=2.0),
         'fuel_tank_farm_85x63': dict(W=8.5, D=6.3, R=1.72, pitch=4.05, LC=3.9, HD=0.42, lx=2.8)}
DECK, SLAB, BOT = 4.5, 0.12, 0.42
MAROON = ft.pm('#3b2b26')                 # dark maroon-brown, low saturation (the original's near-black red-oxide)


def build(out, asset, dest, seed):
    g = SIZES[asset]
    W, D, R, pitch, LC, HD = g['W'], g['D'], g['R'], g['pitch'], g['LC'], g['HD']
    K.begin(asset + ('_destroyed' if dest else ''), seed, theater='desert')
    r = random.Random(seed)
    CZ = BOT + R
    S = ft.NS(W=W, D=D, R=R, LC=LC, HD=HD, CZ=CZ, dest=dest, r=r, seed=seed, xs=[-pitch / 2, pitch / 2], lx=g['lx'])
    paint = MAROON if not dest else ft.BURNT
    smat = 'paint_metal' if not dest else ft.BURNT_MAT
    shell, seams, fit, bolts, sad, strap = bmn(), bmn(), bmn(), bmn(), bmn(), bmn()
    S.burst = {0: (-0.9, 1.3, -2.05, -0.75)} if dest else {}          # west tank: burst on its outer (west) side
    for i, x in enumerate(S.xs):
        ax = ft.Ax((x, 0, CZ), (0, 1, 0))
        hole = S.burst.get(i)
        ft.shell_bm(shell, ax, R, LC, HD, segs=40, courses=8 if hole else 3, open_top=hole, ragged=0.45, seed=seed + i,
                    drop_head=-1 if (dest and i == 1) else 0)
        for k in range(4):
            ft.band_bm(seams, ax, -LC / 2 + LC * k / 3, R, segs=40)
        ft.manhole(fit, bolts, ax.p(0.9, 0.0, R), ax.dir(0.0), r=0.26, neck=0.08)
        ft.vent(fit, ax.p(-1.2, 0.75, R), ax.dir(0.75), h=0.22)
        ft.filler(fit, ax.p(-0.3, -0.6, R), ax.dir(-0.6))
        for ys in (-LC / 2 + 0.6, LC / 2 - 0.6):          # dark concrete saddle (built along x, turned to the tank axis)
            if dest and i == 0 and ys < 0:                # crushed: the west tank's south end sags onto the slab
                for k, (dx, dy, a) in enumerate(((-1.0, 0.1, 0.3), (1.05, -0.15, -0.4))):
                    C.box_bm(sad, (x + dx, ys + dy, SLAB + 0.12), (0.5, 0.45, 0.24), a)
                continue
            n0 = len(sad.verts)
            ft.arc_block(sad, ys - 0.25, ys + 0.25, 0.0, CZ, R, R * 0.8, SLAB)
            ft.xform_new(sad, n0, ft.Matrix.Translation((x, 0, 0)) @ ft.Matrix.Rotation(math.pi / 2, 4, 'Z'))
            sax = ft.Ax((x, ys, CZ), (0, 1, 0))
            ft.band_bm(strap, sax, 0.0, R + 0.002, w=0.07, proud=0.012, a0=-1.9, a1=1.9)
    S.shells = P(shell, smat, 'shells', smooth=True, mat_tint=paint, grime=0.75, lod='keep')
    if dest:
        sh2 = bmn()
        ax = ft.Ax((S.xs[0], 0, CZ), (0, 1, 0))
        ft.shell_bm(sh2, ax, R, LC, HD, segs=40, courses=8, open_top=S.burst[0], ragged=0.45, seed=seed)
        sh3 = bmn()                                     # east tank: open south end, burnt inside visible
        ft.shell_bm(sh3, ft.Ax((S.xs[1], 0, CZ), (0, 1, 0)), R, LC, HD, segs=40, courses=3, seed=seed + 1, drop_head=-1)
        P(ft.inner_skin(sh3), ft.BURNT_MAT, 'shell_inside_e', mat_tint=ft.BURNT, grime=0.3)
        S.inside = P(ft.inner_skin(sh2), ft.BURNT_MAT, 'shell_inside', mat_tint=ft.BURNT_RUST, grime=0.3)
        sh2.free()
    S.seams = P(seams, smat, 'seams', mat_tint=tuple(c * 0.9 for c in paint), grime=0.5)
    S.fit = P(fit, smat, 'fittings', smooth=True, mat_tint=tuple(c * 0.85 for c in paint), grime=0.8)
    S.bolts = P(bolts, 'cast_iron', 'bolts')
    P(sad, 'concrete_formwork', 'saddles', mat_tint=(0.5, 0.48, 0.45) if not dest else (0.3, 0.28, 0.26), grime=0.8)
    S.straps = P(strap, 'paint_metal', 'straps', mat_tint=PAL['blackgrey'] if not dest else ft.BURNT)
    base(S)
    frame_deck(S)
    manifold(S)
    dress(S)
    if dest:
        wreck(S)
    meta(S)
    return ft.finalize(out, 'desert', bounds=(W, D, DECK + 1.05),
                       overlaps=[(('deck', 'frame', 'rails', 'toe_boards', 'columns'), ('shells', 'petals', 'fittings', 'shell_inside', 'blown_head', 'seams')),
                                 (('blown_head', 'petals'), ('saddles', 'kerb', 'slab', 'ladder', 'cage', 'columns', 'manifold'))] if dest else [])


def base(S):
    """Concrete slab, 0.25 m bund kerb on the footprint edge with a ramp notch at the dispensing stand, sand drifts."""
    W, D = S.W, S.D
    bm = bmn()
    C.box_bm(bm, (0, 0, SLAB / 2), (W - 0.02, D - 0.02, SLAB))
    P(bm, 'concrete_slab', 'slab', mat_tint=(0.9, 0.86, 0.78), grime=0.9, lod='keep')
    kb = bmn()
    hw, hd, t = W / 2, D / 2, 0.2
    gx0, gx1 = -hw + 0.4, -hw + 1.6                  # ramp notch on the north edge (dispensing stand)
    for (a, b) in (((-hw, -hd), (hw, -hd)), ((hw, -hd), (hw, hd)), ((-hw, -hd), (-hw, hd))):
        a, b = V((a[0], a[1], 0)), V((b[0], b[1], 0))
        d = (b - a).normalized()
        c = (a + b) / 2
        inward = -c.normalized() if c.length > 0 else V((0, 1, 0))
        off = V((inward.x if abs(inward.x) > abs(inward.y) else 0, inward.y if abs(inward.y) >= abs(inward.x) else 0, 0)).normalized() * t / 2
        C.beam_bm(kb, a + off + V((0, 0, SLAB + 0.125)), b + off + V((0, 0, SLAB + 0.125)), t, 0.25)
    for (x0, x1) in ((-hw, gx0), (gx1, hw)):
        C.box_bm(kb, ((x0 + x1) / 2, hd - t / 2, SLAB + 0.125), (x1 - x0, t, 0.25))
    P(kb, 'concrete_formwork', 'kerb', mat_tint=(0.82, 0.78, 0.7), grime=0.8)
    ft.dz.sand_drift((-hw + 0.25, -hd + 0.25), (hw - 0.25, -hd + 0.25), (0, 1), 0.2, 0.5, seed=S.seed, name='sand_s')
    ft.dz.sand_drift((hw - 0.25, -hd + 0.4), (hw - 0.25, hd - 0.4), (-1, 0), 0.18, 0.45, seed=S.seed + 1, name='sand_e')
    for k in range(6):
        ft.decal('oil_stain', (S.r.uniform(-hw + 0.8, hw - 0.8), S.r.uniform(-hd + 0.8, hd - 0.8), SLAB + 0.004 + 0.001 * k), (0, 0, 1),
                 S.r.uniform(0.8, 1.8), S.r.uniform(0.7, 1.5), up=(S.r.uniform(-1, 1), 1, 0), alpha=0.6)


def fold_setup(S):
    """Wreck fold (destroyed only): the deck hinges on the NW-SE diagonal; its SW half drops until the deck beams rest
    on the west tank's crown. S.fold(p) maps a point of the intact deck/frame/rails to its wrecked position."""
    W, D = S.W, S.D
    a, b = V((-W / 2, D / 2, 0)), V((W / 2, -D / 2, 0))
    u = (b - a).normalized()
    side = lambda p: (b - a).x * (p.y - a.y) - (b - a).y * (p.x - a.x)          # noqa: E731  < 0: SW half
    dist = lambda p: abs(side(p)) / (b - a).length                              # noqa: E731
    # the largest fold that keeps the deck beams (bottom at DECK - 0.24) above both crowns (+0.15 for the fittings),
    # with the west tank sagged onto the slab (sag_setup)
    ang = 0.5
    for i, x in enumerate(S.xs):
        for k in range(41):
            y = -S.LC / 2 - S.HD + (S.LC + 2 * S.HD) * k / 40
            if i == 1 and y < -S.LC / 2:
                continue                                                   # east tank: south head blown off
            yy = max(-S.LC / 2, min(S.LC / 2, y))
            zc = S.CZ + S.R * (1.0 if abs(y) <= S.LC / 2 else math.sqrt(max(0.0, 1 - ((abs(y) - S.LC / 2) / S.HD) ** 2)))
            p = V((x, y, zc + 0.15))
            if i == 0:
                p = S.sag @ p
            if side(p) < 0 and dist(p) > 0.3:
                ang = min(ang, math.asin(max(0.0, min(1.0, ((DECK - 0.24) - p.z) / dist(p)))))
            del yy
    ang *= 0.97
    S.fold_ang = ang
    S.corner_drop = dist(V((-W / 2, -D / 2, 0))) * math.sin(ang)
    M = ft.Matrix.Translation(a + V((0, 0, DECK))) @ ft.Matrix.Rotation(ang, 4, u) @ ft.Matrix.Translation(-(a + V((0, 0, DECK))))
    if (M @ V((-W / 2, -D / 2, DECK))).z > DECK:
        M = ft.Matrix.Translation(a + V((0, 0, DECK))) @ ft.Matrix.Rotation(-ang, 4, u) @ ft.Matrix.Translation(-(a + V((0, 0, DECK))))
    S.fold = lambda p: (M @ V(p)) if side(V(p)) < 0 else V(p)                   # noqa: E731
    S.sw = lambda p: side(V(p)) < 0                                             # noqa: E731


def sag_setup(S):
    """The west tank's south saddle is crushed: the tank pivots on its north saddle until the south end of the shell
    rests on the slab. S.sag = the transform for its parts (x < 0)."""
    yp = S.LC / 2 - 0.6
    a = math.asin((BOT - SLAB - 0.01) / (yp + S.LC / 2))
    S.sag = ft.Matrix.Translation((0, yp, BOT)) @ ft.Matrix.Rotation(a, 4, 'X') @ ft.Matrix.Translation((0, -yp, -BOT))


def sag_obj(S, o):
    if not o:
        return
    for v in o.data.vertices:
        if v.co.x < -0.05:
            v.co = S.sag @ v.co
    o.data.update()


def fold_obj(S, o, rails=False):
    """Apply the wreck fold to a part's vertices; rails on the SW edges are first bent outward and down."""
    if not o:
        return
    W, D = S.W, S.D
    for v in o.data.vertices:
        p = V(v.co)
        if rails and S.sw(p):
            if abs(p.y + D / 2) < 0.2 and p.z > DECK - 0.05:                 # south edge: rail folded over, hanging down
                h = p.z - DECK
                p = V((p.x, -D / 2 + 0.03 - h * math.sin(2.85), DECK + h * math.cos(2.85)))
            elif abs(p.x + W / 2) < 0.2 and p.z > DECK - 0.05:               # west edge
                h = p.z - DECK
                p = V((-W / 2 + 0.03 - h * math.sin(2.85), p.y, DECK + h * math.cos(2.85)))
        v.co = S.fold(p)
    o.data.update()


def frame_deck(S):
    """Six I-section columns, ring + cross beams at the deck, X-bracing in the end bays, open grating deck at DECK
    with toe boards and a 1.0 m tube rail (opening at the ladder head), caged ladder on the south face at the
    mission ladder's x. destroyed: the SW column buckles and the deck folds (fold_setup)."""
    W, D, r = S.W, S.D, S.r
    hw, hd = W / 2 - 0.15, D / 2 - 0.15
    fr, br, rail, toe, ld, cage = bmn(), bmn(), bmn(), bmn(), bmn(), bmn()
    if S.dest:
        sag_setup(S)
        fold_setup(S)
    S.cols = [(x, y) for x in (-hw, 0.0, hw) for y in (-hd, hd)]
    zt = DECK - 0.24
    colb = bmn()
    for (x, y) in S.cols:
        if S.dest and x < 0 and y < 0:                                       # buckled SW column: kinked outward
            top = S.fold(V((x, y, zt)))
            k1 = V((x - 0.35, y - 0.25, SLAB + 1.5))
            ft.ibeam(colb, (x, y, SLAB), k1, h=0.2, b=0.18, up=(1, 0, 0))
            ft.ibeam(colb, k1, top, h=0.2, b=0.18, up=(1, 0, 0))
        else:
            ft.ibeam(colb, (x, y, SLAB), (x, y, zt), h=0.2, b=0.18, up=(1, 0, 0))
        C.box_bm(colb, (x, y, SLAB + 0.015), (0.34, 0.34, 0.03))           # base plate
    for y in (-hd, hd):
        ft.ibeam(fr, (-hw - 0.1, y, zt + 0.1), (hw + 0.1, y, zt + 0.1), h=0.2, b=0.14, up=(0, 0, 1))
    nx = 6
    for k in range(nx + 1):
        x = -hw + 2 * hw * k / nx
        y0, y1 = -hd - 0.08, hd + 0.08
        yc = -x * D / W                                   # where the fold diagonal crosses this beam
        if S.dest and y0 < yc < y1:                       # two pieces, so each follows its half of the deck
            ft.ibeam(fr, (x, y0, zt + 0.1), (x, yc - 0.03, zt + 0.1), h=0.2, b=0.12, up=(0, 0, 1))
            ft.ibeam(fr, (x, yc + 0.03, zt + 0.1), (x, y1, zt + 0.1), h=0.2, b=0.12, up=(0, 0, 1))
        else:
            ft.ibeam(fr, (x, y0, zt + 0.1), (x, y1, zt + 0.1), h=0.2, b=0.12, up=(0, 0, 1))
    for x in (-hw, hw):                                  # end-bay X bracing (the long faces stay open)
        for (y0, y1) in ((-hd, 0.0), (0.0, hd)):
            if S.dest and x < 0 and y0 < 0:
                continue
            ft.flatbar(br, (x, y0, SLAB + 0.3), (x, y1, zt - 0.1), normal=(1, 0, 0))
            ft.flatbar(br, (x, y1, SLAB + 0.3), (x, y0, zt - 0.1), normal=(1, 0, 0))
    gb = bmn()
    g = [(-W / 2 + 0.01, -D / 2 + 0.01), (W / 2 - 0.01, -D / 2 + 0.01), (W / 2 - 0.01, D / 2 - 0.01), (-W / 2 + 0.01, D / 2 - 0.01)]
    tris = [g] if not S.dest else [[g[0], g[1], g[3]], [g[1], g[2], g[3]]]      # split on the fold diagonal
    for poly in tris:
        bot = [gb.verts.new((x, y, DECK - 0.04)) for x, y in poly]
        top = [gb.verts.new((x, y, DECK)) for x, y in poly]
        gb.faces.new(top)
        gb.faces.new(list(reversed(bot)))
        for k in range(len(poly)):
            q = (k + 1) % len(poly)
            gb.faces.new((bot[k], bot[q], top[q], top[k]))
    lx = S.lx
    S.ladder_x = lx
    edge = [(-W / 2 + 0.03, -D / 2 + 0.03), (W / 2 - 0.03, -D / 2 + 0.03), (W / 2 - 0.03, D / 2 - 0.03), (-W / 2 + 0.03, D / 2 - 0.03)]
    if not S.dest:
        run = [(lx + 0.35, edge[0][1]), edge[1], edge[2], edge[3], edge[0], (lx - 0.35, edge[0][1])]
        ft.railing(rail, run, DECK, h=1.0, step=1.5, r=0.024, toe=(toe, 0.1))
    else:
        # the NE half stands; on the dropped SW half the rails are folded over the edge and hang down outside
        ft.railing(rail, [edge[1], edge[2], edge[3]], DECK, h=1.0, step=1.5, r=0.024, toe=(toe, 0.1))
        for (a, b, out) in (((edge[3][0], edge[3][1] - 0.2), (edge[0][0], edge[0][1] + 0.2), (-1, 0)),
                            ((edge[0][0] + 0.2, edge[0][1]), (edge[1][0] - 0.2, edge[1][1]), (0, -1))):
            a, b, o = V((a[0], a[1], DECK)), V((b[0], b[1], DECK)), V((out[0], out[1], 0))
            C.beam_bm(toe, a + V((0, 0, 0.05)), b + V((0, 0, 0.05)), 0.008, 0.1)
            n = max(1, int(round((b - a).length / 1.5)))
            ends = []
            for k in range(n + 1):
                q = a + (b - a) * (k / n)
                tip = q + o * (0.25 + 0.06 * r.random()) + V((0, 0, -0.9 - 0.1 * r.random()))
                ft.tube(rail, q, tip, 0.024)
                ends.append(tip)
            for p0, p1 in zip(ends[:-1], ends[1:]):
                ft.tube(rail, p0, p1, 0.024)
    ft.ladder(ld, (lx, -D / 2 - 0.12, SLAB), DECK, (0, -1, 0), w=0.5, cage_from=2.4, cage=cage, over=1.0, hr=0.32)
    S.deck_parts = [P(gb, 'fuel_grating', 'deck', uv='aligned', grime=0.2),
                    P(rail, 'steel_galv', 'rails', mat_tint=(0.75, 0.72, 0.62) if not S.dest else (0.3, 0.27, 0.25)),
                    P(toe, 'paint_metal', 'toe_boards', mat_tint=PAL['sandsteel'] if not S.dest else ft.CHAR)]
    steel = PAL['sandsteel'] if not S.dest else (0.36, 0.32, 0.29)
    S.frame = P(fr, 'paint_metal', 'frame', mat_tint=steel, grime=0.7)
    P(colb, 'paint_metal', 'columns', mat_tint=steel, grime=0.7)
    P(br, 'paint_metal', 'bracing', mat_tint=steel, grime=0.6)
    S.ladder = [P(ld, 'paint_metal', 'ladder', mat_tint=steel), P(cage, 'paint_metal', 'cage', mat_tint=steel)]
    K.ladder_meta((lx, -D / 2 - 0.6, 0), (lx, -D / 2 + 0.5, DECK), DECK)


def manifold(S):
    """Ø0.15 header along the north face on pipe stools, a branch + red gate valve to every tank's north head,
    dispensing stand (valve, hose on a rack, drum-filling spout, drip tray) at the -X end over the kerb notch."""
    W, D, R, CZ, LC, HD = S.W, S.D, S.R, S.CZ, S.LC, S.HD
    pipe, wheel, stool, hose = bmn(), bmn(), bmn(), bmn()
    yh, zh = D / 2 - 0.42, SLAB + 0.45
    x0, x1 = -W / 2 + 0.75, S.xs[-1] + 0.4
    C.cyl_bm(pipe, (x0, yh, zh), (x1, yh, zh), 0.075, 10)
    for x in [x0 + 0.3 + k * 1.4 for k in range(int((x1 - x0) / 1.4) + 1)]:
        C.box_bm(stool, (x, yh, (SLAB + zh - 0.075) / 2), (0.12, 0.3, zh - 0.075 - SLAB))
    for x in S.xs:
        ya = LC / 2 + 0.12                                  # nozzle low on the north head
        ra = R * math.sqrt(1 - (0.12 / HD) ** 2) * 0.72
        p0 = V((x, ya, CZ - ra))
        e = V((x, ya + 0.1, zh))
        C.cyl_bm(pipe, p0, V((x, ya + 0.1, p0.z)), 0.06, 8)
        C.cyl_bm(pipe, V((x, ya + 0.1, p0.z)), V((x, yh, p0.z)), 0.06, 8)
        C.cyl_bm(pipe, V((x, yh, p0.z)), V((x, yh, zh + 0.075)), 0.06, 8)
        ft.gate_valve(pipe, wheel, (x, (ya + yh) / 2 + 0.05, p0.z), (0, 1, 0), r_pipe=0.06)
    ds = V((-W / 2 + 1.0, yh, SLAB))                         # dispensing stand
    C.cyl_bm(pipe, (x0, yh, zh), (x0, yh, SLAB + 1.1), 0.075, 10)
    C.cyl_bm(pipe, (x0, yh, SLAB + 1.1), (x0 + 0.0, yh - 0.45, SLAB + 1.1), 0.06, 8)
    C.cyl_bm(pipe, (x0, yh - 0.45, SLAB + 1.1), (x0, yh - 0.45, SLAB + 0.85), 0.045, 8)
    ft.gate_valve(pipe, wheel, (x0, yh, SLAB + 0.8), (0, 0, 1), wheel_up=(1, 0, 0), r_pipe=0.075)
    C.box_bm(stool, (x0, yh - 0.45, SLAB + 0.03), (0.7, 0.5, 0.06))   # drip tray
    C.box_bm(stool, (x0 + 0.55, yh + 0.05, SLAB + 0.75), (0.06, 0.06, 1.3))
    ft.hose_run(hose, [(x0 + 0.55, yh - 0.05, SLAB + 1.35), (x0 + 0.62, yh - 0.25, SLAB + 0.9), (x0 + 0.5, yh - 0.35, SLAB + 0.35),
                       (x0 + 0.2, yh - 0.6, SLAB + 0.05)])
    P(pipe, 'paint_metal', 'manifold', smooth=True, mat_tint=PAL['blackgrey'], grime=0.6)
    P(wheel, 'paint_metal', 'valves', mat_tint=PAL['red'], grime=0.3)
    P(stool, 'concrete_formwork', 'stools', mat_tint=(0.7, 0.67, 0.6))
    P(hose, 'bitumen_felt', 'hose', smooth=True, grime=0)
    S.spout = V((x0, yh - 0.45, SLAB + 0.85))


def dress(S):
    """Sign on the ladder cage, head stencils, rust runs + sun-chalked crowns (the M8 drum racks are mission entities)."""
    W, D, R, LC, HD, r = S.W, S.D, S.R, S.LC, S.HD, S.r
    if not S.dest:
        ft.sign_board((0.0, -D / 2 + 0.15 - 0.12, 2.1), (0, -1, 0), 0.8)    # on the middle south column, by the ladder
        for i, x in enumerate(S.xs):
            head = V((x, -(LC / 2 + HD) - 0.004, S.CZ))
            ft.flat_stencil('kraftstoff', head + V((0, 0, 0.25)), (0, -1, 0), 0.3)
            ft.flat_stencil('behaelter_%d' % (i + 1), head - V((0, 0, 0.12)), (0, -1, 0), 0.2, alpha=0.8)
    for i, x in enumerate(S.xs):
        ax = ft.Ax((x, 0, S.CZ), (0, 1, 0))
        for k in range(6):                                   # heavy rust runs down the sides from the crown seams
            ft.wrap_decal('streak_rust', ax, R, r.uniform(-LC / 2 + 0.3, LC / 2 - 0.3), r.choice((-1, 1)) * r.uniform(0.7, 1.3), 0.4, 1.4, alpha=0.7)
        if not S.dest:
            ft.wrap_decal('dust_wash', ax, R, r.uniform(-0.6, 0.6), 0.0, LC * 0.8, 1.6, alpha=0.35)
        ft.wrap_decal('stain_rust_blotch', ax, R, r.uniform(-1, 1), r.uniform(-0.5, 0.5), 1.4, 1.0, alpha=0.5)


def wreck(S):
    """Fold the deck/frame/rails (fold_setup), bend the ladder, west tank petals, east tank's south head blown off and
    leaning on the kerb, soot-black shells, scorch, fire anchors."""
    W, D, R, LC, HD, CZ, r = S.W, S.D, S.R, S.LC, S.HD, S.CZ, S.r
    for o in (S.shells, S.seams, S.fit, S.bolts, S.straps, S.inside):
        sag_obj(S, o)
    for o in S.deck_parts[:1] + [S.frame]:
        fold_obj(S, o)
    for o in S.deck_parts[1:]:
        fold_obj(S, o)
    for o in S.ladder:                                     # ladder wrenched sideways at the cage
        if o:
            o.data.transform(ft.rot_about((S.ladder_x, -D / 2, 2.4), 0.18, 'Y'))
    deb = bmn()                                            # the east tank's south head is gone: torn plate shards
    for k in range(5):
        room = max(0.0, (D / 2 - 0.5) - (LC / 2 + 0.3))          # between the open end and the kerb
        c = V((S.xs[1] + r.uniform(-1.3, 1.3), -(LC / 2 + 0.3) - r.uniform(0, room), SLAB + 0.03))
        C.box_bm(deb, tuple(c), (r.uniform(0.25, 0.45), r.uniform(0.15, 0.3), 0.02), r.uniform(0, 3.1))
    P(deb, ft.BURNT_MAT, 'blown_head', mat_tint=ft.BURNT_RUST, grime=0.9)
    pet = bmn()
    s0, s1, a0, a1 = S.burst[0]
    ft.petals(pet, ft.Ax((S.xs[0], 0, CZ), (0, 1, 0)), R, (s0 + s1) / 2, (a0 + a1) / 2, s1 - s0, (a1 - a0) * R, n=8,
              curl=0.6, seed=S.seed)
    S.petals = P(pet, ft.BURNT_MAT, 'petals', mat_tint=ft.BURNT_RUST, grime=0.9)
    sag_obj(S, S.petals)
    for k in range(10):
        i = k % 2
        ft.wrap_decal('soot_a' if k % 3 else 'soot_b', ft.Ax((S.xs[i], 0, CZ), (0, 1, 0)), R, r.uniform(-1.8, 1.8),
                      r.uniform(-1.6, 1.6), 1.8, 1.6, alpha=0.6)
    for o in list(C.A.parts):                              # shell decals of the west tank sag with it
        if o.name.split('.')[0].startswith(('wd_', 'streak')) and o.name in ft.bpy.data.objects:
            sag_obj(S, o)
    ft.scorch((0, 0, 0), W * 0.9, D * 0.9, seed=S.seed, z=SLAB + 0.008)
    ft.scorch((0, 0, 0), W + 0.6, D + 0.6, seed=S.seed + 2, z=0.008, alpha=0.55)
    for k, x in enumerate(S.xs):
        K.anchor('fire', (x, 0.4 * (2 * k - 1), CZ + 0.4), (0, -1, 0), size=2.4)


def meta(S):
    W, D = S.W, S.D
    K.footprint_rect(0, 0, W, D, 0, 'HIGH', 'building')
    for (x, y) in getattr(S, 'cols', []):
        K.footprint_rect(x, y, 0.3, 0.3, 0, 'HIGH', 'post')
    if not S.dest:
        K.roof_meta([(-W / 2 + 0.05, -D / 2 + 0.05), (W / 2 - 0.05, -D / 2 + 0.05), (W / 2 - 0.05, D / 2 - 0.05), (-W / 2 + 0.05, D / 2 - 0.05)],
                    DECK, walkable=True, kind='deck')
        K.anchor('explosive_target', (0, -D / 2 - 0.3, 0.9), (0, -1, 0), kind='fuel_tank', chain_radius=9.0)
        K.anchor('deck', (0, 0, DECK), (0, -1, 0), y=DECK, walkable=True)
    K.anchor('spout', tuple(S.spout), (-1, 0, 0))
    K.anchor('blast_origin', (0, 0, S.CZ), (0, -1, 0), radius=6.0, size=[W, D, DECK])
    C.A.meta['notes'].append('fuel tank farm (docs/fuel-tanks.md §5.2): walkable grating deck at %.2f m, ladder on the south face' % DECK)
